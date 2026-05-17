import type { FastifyInstance } from "fastify";
import { checkSessionCreationRateLimit } from "../middleware/rate-limit.js";
import { generateCode } from "../session/codes.js";
import { generateToken, getSession, saveSession } from "../session/store.js";
import { resolveScope, ScopeTooSmallError } from "../session/scope.js";
import { startQuestion } from "../game/engine.js";
import { getContent } from "../content/loader.js";
import { db } from "../db/client.js";
import { sessionAudit } from "../db/schema.js";
import { redis } from "../redis/client.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { SessionScope, Translation, SessionMode } from "@scripturejam/types";

export async function sessionRoutes(app: FastifyInstance) {
  app.post("/api/sessions", async (req, reply) => {
    const { allowed, ipHash } = await checkSessionCreationRateLimit(req);

    await db.insert(sessionAudit).values({
      hostIpHash: ipHash,
      outcome: allowed ? "created" : "rate_limited",
    });

    if (!allowed) {
      return reply.status(429).send({ error: "rate_limited" });
    }

    // Generate unique code (3 attempts)
    let code = "";
    for (let i = 0; i < 3; i++) {
      const candidate = generateCode();
      const existing = await redis.get(`session:${candidate}`);
      if (!existing) { code = candidate; break; }
    }
    if (!code) {
      return reply.status(503).send({ error: "Could not generate unique session code" });
    }

    const hostToken = generateToken();
    const baseUrl = config.PUBLIC_URL ?? `http://localhost:${config.PORT}`;

    await saveSession({
      code,
      hostToken,
      hostIpHash: ipHash,
      hostSocketId: null,
      state: "lobby",
      mode: "individual",
      translation: "KJV",
      scope: { type: "pack", packId: "" },
      questionIds: [],
      currentIndex: -1,
      questionStartedAt: null,
      gameStartedAt: null,
      players: {},
      createdAt: Date.now(),
    });

    logger.info("Session created", { code });
    return reply.send({
      code,
      hostToken,
      joinUrl: `${baseUrl}/j/${code}`,
      qrUrl: `/api/sessions/${code}/qr.svg`,
    });
  });

  app.post<{
    Params: { code: string };
    Body: { hostToken: string; scope: SessionScope; translation?: Translation; mode?: SessionMode };
  }>("/api/sessions/:code/start", async (req, reply) => {
    const { code } = req.params;
    const { hostToken, scope, translation, mode } = req.body;

    const session = await getSession(code);
    if (!session) return reply.status(404).send({ error: "session_not_found" });
    if (session.hostToken !== hostToken) return reply.status(403).send({ error: "invalid_host_token" });
    if (session.state !== "lobby") return reply.status(409).send({ error: "session_already_started" });

    let questionIds: string[];
    try {
      const { questions, packs } = getContent();
      questionIds = resolveScope(scope, questions, packs);
    } catch (err) {
      if (err instanceof ScopeTooSmallError) {
        return reply.status(422).send({ error: "scope_too_small", matched: err.matched, min: err.min });
      }
      return reply.status(503).send({ error: "content_not_available" });
    }

    session.scope = scope;
    session.translation = translation ?? "KJV";
    session.mode = mode ?? "individual";
    session.questionIds = questionIds;
    await saveSession(session);

    await startQuestion(code);

    return reply.send({ ok: true, questionCount: questionIds.length });
  });

}
