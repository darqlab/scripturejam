import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type { ServerToClientEvents, ClientToServerEvents } from "@scripturejam/types";
import { redis } from "../redis/client.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getSession, saveSession, generateToken, generatePlayerId } from "../session/store.js";
import { startQuestion, revealQuestion, finalizeSession, clearTimer } from "../game/engine.js";
import { getContent } from "../content/loader.js";
import { setIo, type SocketData, type TypedServer } from "./io.js";

export type { TypedServer };

export function attachSocketServer(httpServer: HttpServer): TypedServer {
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  void pubClient.connect();
  void subClient.connect();

  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    httpServer,
    { cors: { origin: false }, transports: ["websocket", "polling"] }
  );

  io.adapter(createAdapter(pubClient, subClient));
  setIo(io);

  io.on("connection", (socket) => {
    socket.data.code = null;
    socket.data.playerId = null;
    socket.data.role = null;
    logger.debug("Socket connected", { socketId: socket.id });

    // ── JOIN (player) ─────────────────────────────────────────────────────
    socket.on("JOIN", async ({ code, nickname, avatarId, resumeToken }, ack) => {
      const session = await getSession(code);
      if (!session) return ack({ ok: false, reason: "session_not_found" });
      if (session.state === "final") return ack({ ok: false, reason: "session_ended" });

      // Resume path
      if (resumeToken) {
        const existing = Object.values(session.players).find(
          (p) => p.resumeToken === resumeToken
        );
        if (existing) {
          existing.socketId = socket.id;
          if (existing.status === "disconnected") existing.status = "joined";
          await saveSession(session);

          socket.data.code = code;
          socket.data.playerId = existing.id;
          socket.data.role = "player";
          socket.join(`player:${code}`);

          const qId = session.questionIds[session.currentIndex];
          socket.emit("SESSION_STATE", {
            state: session.state,
            mode: session.mode,
            currentIndex: session.currentIndex,
            total: session.questionIds.length,
            yourPick: qId ? existing.answers[qId]?.optionId : undefined,
            yourLocked: qId ? !!existing.answers[qId] : false,
          });

          return ack({ ok: true, playerId: existing.id, resumeToken: existing.resumeToken });
        }
        // Stale token — fall through to fresh join
      }

      // Avatar validation (graceful if content not loaded)
      try {
        const { avatars } = getContent();
        if (avatars.size > 0) {
          const avatar = avatars.get(avatarId);
          if (!avatar) return ack({ ok: false, reason: "avatar_invalid" });
          if (session.mode === "group" && avatar.category !== "people") {
            return ack({ ok: false, reason: "wrong_mode_avatar" });
          }
        }
      } catch {
        // Content not loaded — skip avatar validation
      }

      const taken = Object.values(session.players).some(
        (p) => p.nickname.toLowerCase() === nickname.toLowerCase()
      );
      if (taken) return ack({ ok: false, reason: "nickname_taken" });

      const playerId = generatePlayerId();
      const playerResumeToken = generateToken();
      const joinedAt = Date.now();

      session.players[playerId] = {
        id: playerId,
        nickname,
        avatarId,
        resumeToken: playerResumeToken,
        score: 0,
        status: "joined",
        socketId: socket.id,
        joinedAt,
        answers: {},
      };
      await saveSession(session);

      socket.data.code = code;
      socket.data.playerId = playerId;
      socket.data.role = "player";
      socket.join(`player:${code}`);

      io.to(`host:${code}`).emit("PLAYER_JOIN", { playerId, nickname, avatarId, joinedAt });
      logger.info("Player joined", { code, playerId, nickname });
      ack({ ok: true, playerId, resumeToken: playerResumeToken });
    });

    // ── HOST_CONNECT ──────────────────────────────────────────────────────
    socket.on("HOST_CONNECT", async ({ code, hostToken }, ack) => {
      const session = await getSession(code);
      if (!session) return ack({ ok: false, reason: "session_not_found" });
      if (session.hostToken !== hostToken) return ack({ ok: false, reason: "invalid_host_token" });

      session.hostSocketId = socket.id;
      await saveSession(session);

      socket.data.code = code;
      socket.data.role = "host";
      socket.join(`host:${code}`);

      const players = Object.values(session.players).map((p) => ({
        playerId: p.id,
        nickname: p.nickname,
        avatarId: p.avatarId,
        score: p.score,
        status: p.status,
      }));

      socket.emit("SESSION_STATE", {
        state: session.state,
        mode: session.mode,
        translation: session.translation,
        currentIndex: session.currentIndex,
        players,
      });

      logger.info("Host connected", { code });
      ack({ ok: true });
    });

    // ── ANSWER (player) ───────────────────────────────────────────────────
    socket.on("ANSWER", async ({ questionId, optionId }, ack) => {
      const { code, playerId } = socket.data;
      if (!code || !playerId) return ack({ ok: false, reason: "wrong_question" });

      const session = await getSession(code);
      if (!session || session.state !== "question") {
        return ack({ ok: false, reason: "wrong_question" });
      }

      const currentQId = session.questionIds[session.currentIndex];
      if (questionId !== currentQId) return ack({ ok: false, reason: "wrong_question" });

      const player = session.players[playerId];
      if (!player) return ack({ ok: false, reason: "wrong_question" });
      if (player.answers[questionId]) return ack({ ok: false, reason: "already_answered" });

      const elapsed = Date.now() - (session.questionStartedAt ?? 0);
      if (elapsed > config.QUESTION_DURATION_MS + 500) {
        return ack({ ok: false, reason: "timed_out" });
      }

      const lockedAt = Date.now();
      player.answers[questionId] = {
        optionId,
        msToAnswer: elapsed,
        correct: false, // resolved at reveal
        awarded: 0,
      };
      player.status = "answered";
      await saveSession(session);
      ack({ ok: true, lockedAt });

      // Early reveal if all active players answered
      const active = Object.values(session.players).filter((p) => p.status !== "disconnected");
      const allAnswered = active.length > 0 && active.every((p) => p.answers[currentQId]);
      if (allAnswered) {
        clearTimer(code);
        await revealQuestion(code);
      }
    });

    // ── ADVANCE (host) ────────────────────────────────────────────────────
    socket.on("ADVANCE", async (ack) => {
      const { code, role } = socket.data;
      if (!code || role !== "host") return ack({ ok: false, reason: "wrong_state" });

      const session = await getSession(code);
      if (!session) return ack({ ok: false, reason: "wrong_state" });

      if (session.state === "reveal" || (session.state === "lobby" && session.questionIds.length > 0)) {
        ack({ ok: true });
        await startQuestion(code);
      } else {
        ack({ ok: false, reason: "wrong_state" });
      }
    });

    // ── END (host) ────────────────────────────────────────────────────────
    socket.on("END", async (ack) => {
      const { code, role } = socket.data;
      if (!code || role !== "host") return ack({ ok: false, reason: "wrong_state" });

      const session = await getSession(code);
      if (!session || session.state === "final") return ack({ ok: false, reason: "wrong_state" });

      ack({ ok: true });
      await finalizeSession(code);
    });

    // ── KICK (host) ───────────────────────────────────────────────────────
    socket.on("KICK", async ({ playerId }, ack) => {
      const { code, role } = socket.data;
      if (!code || role !== "host") return ack({ ok: false, reason: "player_not_found" });

      const session = await getSession(code);
      if (!session) return ack({ ok: false, reason: "player_not_found" });

      const player = session.players[playerId];
      if (!player) return ack({ ok: false, reason: "player_not_found" });

      if (player.socketId) {
        const playerSocket = io.sockets.sockets.get(player.socketId);
        playerSocket?.emit("KICKED", { reason: "kicked by host" });
        playerSocket?.disconnect(true);
      }

      delete session.players[playerId];
      await saveSession(session);

      io.to(`host:${code}`).emit("PLAYER_LEAVE", { playerId, reason: "kicked" });
      logger.info("Player kicked", { code, playerId });
      ack({ ok: true });
    });

    // ── DISCONNECT ────────────────────────────────────────────────────────
    socket.on("disconnect", async () => {
      const { code, playerId, role } = socket.data;
      if (!code) return;

      const session = await getSession(code);
      if (!session) return;

      if (role === "player" && playerId) {
        const player = session.players[playerId];
        if (player && player.socketId === socket.id) {
          player.status = "disconnected";
          player.socketId = null;
          await saveSession(session);
          io.to(`host:${code}`).emit("PLAYER_LEAVE", { playerId, reason: "disconnect" });
          logger.debug("Player disconnected", { code, playerId });
        }
      } else if (role === "host" && session.hostSocketId === socket.id) {
        session.hostSocketId = null;
        await saveSession(session);
        logger.debug("Host disconnected", { code });
      }
    });
  });

  return io;
}
