import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
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
import { BIBLE_BOOKS } from "@scripturejam/types";
import type { SessionScope, Translation, SessionMode, Question, QuestionPack } from "@scripturejam/types";
import { questionSchema, questionPackSchema } from "../content/schemas.js";
import {
  generateQuestionsForBook,
  GenerationNotConfiguredError,
  GenerationFailedError,
} from "../content/generate.js";

const bookChapterRangeSchema = z.object({
  start: z.number().int(),
  end: z.number().int(),
});

const scopeBookSchema = z.object({
  book: z.string(),
  chapters: z.array(bookChapterRangeSchema).optional(),
});

const scopeFilterSchema = z.object({
  books: z.array(scopeBookSchema),
});

const sessionScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pack"), packId: z.string() }),
  z.object({ type: z.literal("filter"), filter: scopeFilterSchema }),
  z.object({
    type: z.literal("custom"),
    customPack: z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string(),
      ageBand: z.enum(["youth", "all-ages"]),
      questionIds: z.array(z.string()).min(1),
    }),
  }),
]);

const startSessionBodySchema = z.object({
  hostToken: z.string().min(16).max(128),
  scope: sessionScopeSchema,
  translation: z.enum(["KJV", "WEB", "ASV"]).optional(),
  mode: z.enum(["individual", "group"]).optional(),
});

const customPackPayloadSchema = z.object({
  pack: questionPackSchema,
  questions: z.array(questionSchema),
}).superRefine((payload, ctx) => {
  const questionMap = new Map(payload.questions.map((q) => [q.id, q]));
  for (const id of payload.pack.questionIds) {
    if (!questionMap.has(id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `questionId "${id}" not found in questions array`, path: ["pack", "questionIds"] });
    }
  }
});

async function applyCustomPack(
  code: string,
  hostToken: string,
  pack: QuestionPack,
  questions: Question[],
  reply: FastifyReply
) {
  const session = await getSession(code);
  if (!session) return reply.status(404).send({ error: "session_not_found" });
  if (session.hostToken !== hostToken) return reply.status(403).send({ error: "invalid_host_token" });
  if (session.state !== "lobby") return reply.status(409).send({ error: "session_already_started" });

  if (questions.length > config.MAX_QUESTIONS_PER_CUSTOM_PACK) {
    return reply.status(422).send({ error: "pack_too_large", limit: config.MAX_QUESTIONS_PER_CUSTOM_PACK });
  }

  session.scope = { type: "custom", customPack: pack };
  session.customPackQuestions = Object.fromEntries(questions.map((q) => [q.id, q]));
  await saveSession(session);

  return reply.send({ ok: true });
}

export async function sessionRoutes(app: FastifyInstance) {
  app.get("/api/packs", async (_req, reply) => {
    try {
      const { packs, questions } = getContent();
      const result = Array.from(packs.values()).map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        ageBand: p.ageBand,
        questionCount: p.questionIds.filter((id) => questions.has(id)).length,
      }));
      return reply.send(result);
    } catch {
      return reply.status(503).send({ error: "content_not_available" });
    }
  });

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

    const bodyParsed = startSessionBodySchema.safeParse(req.body);
    if (!bodyParsed.success) return reply.status(400).send({ error: "invalid_request" });

    const { hostToken, scope, translation, mode } = bodyParsed.data;

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

  app.post<{ Params: { code: string }; Body: { hostToken: string; pack: unknown; questions: unknown } }>(
    "/api/sessions/:code/pack",
    async (req, reply) => {
      const { code } = req.params;
      const { hostToken, pack, questions } = req.body;

      const parsed = customPackPayloadSchema.safeParse({ pack, questions });
      if (!parsed.success) {
        return reply.status(422).send({ error: "invalid_pack", details: parsed.error.flatten() });
      }

      return applyCustomPack(code, hostToken, parsed.data.pack, parsed.data.questions, reply);
    }
  );

  const generateBodySchema = z.object({
    hostToken: z.string().min(16).max(128),
    book: z.string().min(1),
    count: z.coerce.number().int().positive().optional(),
    ageBand: z.enum(["youth", "all-ages"]).optional(),
  });

  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/generate",
    async (req, reply) => {
      const { code } = req.params;

      const parsed = generateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const { hostToken, book, count, ageBand } = parsed.data;

      const session = await getSession(code);
      if (!session) return reply.status(404).send({ error: "session_not_found" });
      if (session.hostToken !== hostToken) return reply.status(403).send({ error: "invalid_host_token" });
      if (session.state !== "lobby") return reply.status(409).send({ error: "session_already_started" });

      const canonicalBook = BIBLE_BOOKS.find((b) => b.toLowerCase() === book.trim().toLowerCase());
      if (!canonicalBook) {
        return reply.status(422).send({ error: "unknown_book" });
      }

      const maxAllowed = Math.min(config.MAX_GENERATE_QUESTIONS, config.MAX_QUESTIONS_PER_CUSTOM_PACK);
      const requestedCount = Math.max(5, Math.min(count ?? 10, maxAllowed));

      try {
        const { pack, questions } = await generateQuestionsForBook(
          canonicalBook,
          requestedCount,
          ageBand ?? "all-ages"
        );
        return reply.send({ pack, questions });
      } catch (err) {
        if (err instanceof GenerationNotConfiguredError) {
          return reply.status(503).send({ error: "generation_not_configured" });
        }
        if (err instanceof GenerationFailedError) {
          logger.error("Question generation failed", { code, book: canonicalBook, cause: err.cause });
          return reply.status(502).send({ error: "generation_failed" });
        }
        logger.error("Question generation failed (unexpected)", { code, book: canonicalBook, err });
        return reply.status(502).send({ error: "generation_failed" });
      }
    }
  );

  app.post<{ Params: { code: string } }>(
    "/api/sessions/:code/pack/upload",
    async (req, reply) => {
      const { code } = req.params;

      const data = await req.file();
      if (!data) {
        return reply.status(400).send({ error: "no_file" });
      }

      if ((data.file as NodeJS.ReadableStream & { truncated?: boolean }).truncated) {
        return reply.status(413).send({ error: "upload_too_large" });
      }

      const buf = await data.toBuffer();
      if (buf.length > config.MAX_CUSTOM_PACK_UPLOAD_BYTES) {
        return reply.status(413).send({ error: "upload_too_large" });
      }

      const hostToken = data.fields["hostToken"] as import("@fastify/multipart").MultipartValue<string> | undefined;
      const hostTokenValue = hostToken?.value;
      if (!hostTokenValue) {
        return reply.status(400).send({ error: "missing_host_token" });
      }

      let body: unknown;
      try {
        body = JSON.parse(buf.toString("utf-8"));
      } catch {
        return reply.status(422).send({ error: "invalid_json" });
      }

      const parsed = customPackPayloadSchema.safeParse(body);
      if (!parsed.success) {
        return reply.status(422).send({ error: "invalid_pack", details: parsed.error.flatten() });
      }

      return applyCustomPack(code, hostTokenValue, parsed.data.pack, parsed.data.questions, reply);
    }
  );

  app.get<{ Params: { code: string }; Querystring: { hostToken: string } }>(
    "/api/sessions/:code/pack.json",
    async (req, reply) => {
      const { code } = req.params;
      const { hostToken } = req.query;

      const session = await getSession(code);
      if (!session) return reply.status(404).send({ error: "session_not_found" });
      if (session.hostToken !== hostToken) return reply.status(403).send({ error: "invalid_host_token" });
      if (session.scope.type !== "custom" || !session.customPackQuestions) {
        return reply.status(400).send({ error: "no_custom_pack" });
      }

      const questions = Object.values(session.customPackQuestions);
      return reply.send({ pack: session.scope.customPack, questions });
    }
  );

}
