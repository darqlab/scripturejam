/**
 * Integration test suite — full session lifecycle.
 *
 * Runs against real Redis and Postgres (no mocks).  The suite is silently
 * skipped when REDIS_URL or DATABASE_URL is not set so that plain `pnpm test`
 * (without Docker services) still passes.
 *
 * To run locally:
 *   REDIS_URL=redis://localhost:6379 \
 *   DATABASE_URL=postgresql://sj:sj@localhost:5432/sj \
 *   IP_HASH_SECRET=test-secret-at-least-16-chars \
 *   pnpm --filter @scripturejam/server test:integration
 */

// Set env vars BEFORE any server module is imported (config singleton reads
// process.env at import time).
process.env.IP_HASH_SECRET =
  process.env.IP_HASH_SECRET ?? "test-secret-at-least-16-chars";
process.env.QUESTION_DURATION_MS = "500"; // short timer — early-reveal path dominates
process.env.MIN_QUESTIONS_TO_START = "1"; // allow small packs
process.env.NODE_ENV = "test";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as ioc } from "socket.io-client";
import type { Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  QuestionPayload,
  RevealPayloadHost,
  RevealPayloadPlayer,
  FinalPayloadHost,
  FinalPayloadPlayer,
  JoinAck,
  HostConnectAck,
  AnswerAck,
  AdvanceAck,
  EndAck,
} from "@scripturejam/types";
import { startTestServer } from "./helpers/server.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const hasRedis = Boolean(process.env.REDIS_URL);
const hasDb = Boolean(process.env.DATABASE_URL);
const skipIntegration = !hasRedis || !hasDb;

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Open a socket.io-client connection and wait for it to be connected. */
function connect(port: number): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const sock = ioc(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      reconnection: false,
    }) as ClientSocket;
    sock.once("connect", () => resolve(sock));
    sock.once("connect_error", reject);
  });
}

/** Wrap a socket.io acknowledged emit into a promise. */
function emit<R>(
  sock: ClientSocket,
  event: keyof ClientToServerEvents,
  ...args: unknown[]
): Promise<R> {
  return new Promise((resolve) => {
    // @ts-expect-error dynamic emit — call-site types are verified by callers
    sock.emit(event, ...args, (result: R) => resolve(result));
  });
}

/** Wait for the next occurrence of a server-to-client event. */
function waitFor<K extends keyof ServerToClientEvents>(
  sock: ClientSocket,
  event: K
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve) => {
    sock.once(event as string, (payload: Parameters<ServerToClientEvents[K]>[0]) =>
      resolve(payload)
    );
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe.skipIf(skipIntegration)("Integration — session lifecycle", () => {
  let port: number;
  let baseUrl: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const server = await startTestServer();
    port = server.port;
    baseUrl = server.baseUrl;
    cleanup = server.cleanup;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 15_000);

  // ── GET /api/packs ──────────────────────────────────────────────────────────

  it("GET /api/packs returns available packs", async () => {
    const res = await fetch(`${baseUrl}/api/packs`);
    expect(res.status).toBe(200);
    const packs = (await res.json()) as Array<{
      id: string;
      title: string;
      questionCount: number;
    }>;
    expect(Array.isArray(packs)).toBe(true);
    expect(packs.length).toBeGreaterThan(0);
    const nc = packs.find((p) => p.id === "named_characters");
    expect(nc).toBeDefined();
    expect(nc!.questionCount).toBeGreaterThan(0);
  });

  // ── POST /api/sessions ──────────────────────────────────────────────────────

  it("POST /api/sessions creates a session and returns required fields", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      code: string;
      hostToken: string;
      joinUrl: string;
      qrUrl: string;
    };
    expect(body.code).toMatch(/^[346789ACDEFGHJKMNPQRTUVWXY]{6}$/);
    expect(typeof body.hostToken).toBe("string");
    expect(body.hostToken.length).toBeGreaterThan(0);
    expect(body.joinUrl).toContain(body.code);
    expect(body.qrUrl).toContain(body.code);
  });

  // ── Full game flow ──────────────────────────────────────────────────────────
  //
  // Option (b) from the task spec: all 5 players answer before the timer fires.
  // This triggers the early-reveal path (clearTimer + revealQuestion) and keeps
  // the test fast even with a 500 ms QUESTION_DURATION_MS.

  it(
    "full game flow: lobby → question × 2 → reveal × 2 → END → FINAL → Postgres persisted",
    async () => {
      // 1. Create session ──────────────────────────────────────────────────────
      const createRes = await fetch(`${baseUrl}/api/sessions`, { method: "POST" });
      expect(createRes.status).toBe(200);
      const { code, hostToken } = (await createRes.json()) as {
        code: string;
        hostToken: string;
      };

      // 2. Connect host socket ─────────────────────────────────────────────────
      const hostSock = await connect(port);

      const hostConnectAck = await emit<HostConnectAck>(hostSock, "HOST_CONNECT", {
        code,
        hostToken,
      });
      expect(hostConnectAck).toEqual({ ok: true });

      const playerJoinEvents: string[] = [];
      hostSock.on("PLAYER_JOIN", ({ playerId }) => playerJoinEvents.push(playerId));

      // 3. Five players JOIN ───────────────────────────────────────────────────
      const PLAYER_COUNT = 5;
      const playerSockets: ClientSocket[] = [];
      const avatars = ["adam", "moses", "david", "esther", "ruth"];
      const nicknames = ["Alice", "Bob", "Carol", "Dan", "Eve"];

      for (let i = 0; i < PLAYER_COUNT; i++) {
        const sock = await connect(port);
        const ack = await emit<JoinAck>(sock, "JOIN", {
          code,
          nickname: nicknames[i],
          avatarId: avatars[i],
        });
        expect(ack.ok).toBe(true);
        if (!ack.ok) throw new Error(`Player ${i} JOIN failed: ${ack.reason}`);
        playerSockets.push(sock);
      }

      // Host must have received PLAYER_JOIN for all 5
      expect(playerJoinEvents.length).toBe(PLAYER_COUNT);

      // 4. Start the session ───────────────────────────────────────────────────
      // Register listeners BEFORE calling start so no events are missed.
      const hostQuestion1P = waitFor(hostSock, "QUESTION");
      const playerQ1Promises = playerSockets.map((s) => waitFor(s, "QUESTION"));

      const startRes = await fetch(`${baseUrl}/api/sessions/${code}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostToken,
          scope: { type: "pack", packId: "named_characters" },
          translation: "KJV",
          mode: "individual",
        }),
      });
      expect(startRes.status).toBe(200);
      const { ok: startOk, questionCount } = (await startRes.json()) as {
        ok: boolean;
        questionCount: number;
      };
      expect(startOk).toBe(true);
      expect(questionCount).toBeGreaterThan(0);

      // 5. QUESTION event — host and all players ───────────────────────────────
      const q1 = (await hostQuestion1P) as QuestionPayload;
      expect(q1.index).toBe(0);
      expect(q1.questionId).toBeTruthy();
      expect(q1.options.length).toBeGreaterThan(0);

      const playerQ1s = await Promise.all(playerQ1Promises);
      for (const p of playerQ1s) {
        expect((p as QuestionPayload).questionId).toBe(q1.questionId);
      }

      // 6. All 5 players ANSWER → early reveal ─────────────────────────────────
      const hostReveal1P = waitFor(hostSock, "REVEAL");
      const playerReveal1Promises = playerSockets.map((s) => waitFor(s, "REVEAL"));

      // Use the first option id — correct or not doesn't matter for the flow test
      const pick1 = q1.options[0].id;
      await Promise.all(
        playerSockets.map((sock) =>
          emit<AnswerAck>(sock, "ANSWER", { questionId: q1.questionId, optionId: pick1 })
        )
      );

      // 7. REVEAL — verify scoring fields ─────────────────────────────────────
      const hostReveal1 = (await hostReveal1P) as RevealPayloadHost;
      expect(hostReveal1.questionId).toBe(q1.questionId);
      expect(typeof hostReveal1.correctOptionId).toBe("string");
      expect(hostReveal1.answeredCount).toBe(PLAYER_COUNT);
      expect(hostReveal1.playerCount).toBe(PLAYER_COUNT);

      const playerReveal1s = await Promise.all(playerReveal1Promises);
      for (const raw of playerReveal1s) {
        const p = raw as RevealPayloadPlayer;
        expect(p.questionId).toBe(q1.questionId);
        expect(typeof p.yourCorrect).toBe("boolean");
        expect(p.totalPlayers).toBe(PLAYER_COUNT);
        expect(p.yourRank).toBeGreaterThan(0);
        // Score correctness check
        if (pick1 === hostReveal1.correctOptionId) {
          expect(p.yourAwarded).toBeGreaterThanOrEqual(500);
        } else {
          expect(p.yourAwarded).toBe(0);
        }
      }

      // 8. Host ADVANCEs to question 2 ─────────────────────────────────────────
      const hostQuestion2P = waitFor(hostSock, "QUESTION");
      const playerQ2Promises = playerSockets.map((s) => waitFor(s, "QUESTION"));

      const advanceAck = await emit<AdvanceAck>(hostSock, "ADVANCE");
      expect(advanceAck).toEqual({ ok: true });

      const q2 = (await hostQuestion2P) as QuestionPayload;
      expect(q2.index).toBe(1);
      await Promise.all(playerQ2Promises);

      // 9. All players ANSWER question 2 ──────────────────────────────────────
      const hostReveal2P = waitFor(hostSock, "REVEAL");
      const playerReveal2Promises = playerSockets.map((s) => waitFor(s, "REVEAL"));

      const pick2 = q2.options[0].id;
      await Promise.all(
        playerSockets.map((sock) =>
          emit<AnswerAck>(sock, "ANSWER", { questionId: q2.questionId, optionId: pick2 })
        )
      );

      const hostReveal2 = (await hostReveal2P) as RevealPayloadHost;
      expect(hostReveal2.questionId).toBe(q2.questionId);
      await Promise.all(playerReveal2Promises);

      // 10. Host emits END → FINAL ─────────────────────────────────────────────
      const hostFinalP = waitFor(hostSock, "FINAL");
      const playerFinalPromises = playerSockets.map((s) => waitFor(s, "FINAL"));

      const endAck = await emit<EndAck>(hostSock, "END");
      expect(endAck).toEqual({ ok: true });

      const hostFinal = (await hostFinalP) as FinalPayloadHost;
      expect(hostFinal.questionCount).toBe(2);
      expect(hostFinal.playerCount).toBe(PLAYER_COUNT);
      expect(hostFinal.top10.length).toBeGreaterThan(0);
      expect(hostFinal.top10[0]).toMatchObject({
        playerId: expect.any(String),
        nickname: expect.any(String),
        score: expect.any(Number),
        rank: 1,
      });

      const playerFinals = await Promise.all(playerFinalPromises);
      for (const raw of playerFinals) {
        const p = raw as FinalPayloadPlayer;
        expect(p.totalPlayers).toBe(PLAYER_COUNT);
        expect(p.yourFinalRank).toBeGreaterThan(0);
        expect(p.yourFinalRank).toBeLessThanOrEqual(PLAYER_COUNT);
        expect(p.yourAnsweredCorrect).toBeGreaterThanOrEqual(0);
      }

      // 11. Postgres persistence ────────────────────────────────────────────────
      // persistResults runs asynchronously after FINAL; give it time to land.
      await new Promise((r) => setTimeout(r, 300));

      const { db } = await import("../src/db/client.js");
      const { sessionResults, sessionPlayerResults } = await import(
        "../src/db/schema.js"
      );
      const { eq } = await import("drizzle-orm");

      const [resultRow] = await db
        .select()
        .from(sessionResults)
        .where(eq(sessionResults.code, code));
      expect(resultRow).toBeDefined();
      expect(resultRow.code).toBe(code);
      expect(resultRow.playerCount).toBe(PLAYER_COUNT);
      expect(resultRow.questionCount).toBe(2);

      const playerRows = await db
        .select()
        .from(sessionPlayerResults)
        .where(eq(sessionPlayerResults.sessionCode, code));
      expect(playerRows.length).toBe(PLAYER_COUNT);
      for (const row of playerRows) {
        expect(row.answeredTotal).toBeGreaterThan(0);
        expect(row.finalRank).toBeGreaterThan(0);
      }

      // 12. Disconnect all sockets ──────────────────────────────────────────────
      hostSock.disconnect();
      for (const sock of playerSockets) sock.disconnect();
    },
    30_000
  );
});

// ── Sanity test — always runs ─────────────────────────────────────────────────

describe("Integration skip guard", () => {
  it.skipIf(!skipIntegration)(
    "reports that integration tests are being skipped (no Redis/Postgres in env)",
    () => {
      expect(skipIntegration).toBe(true);
    }
  );
});
