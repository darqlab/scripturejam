import type { FastifyInstance } from "fastify";
import { redis } from "../redis/client.js";
import { pool } from "../db/client.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/healthz", async (_req, reply) => {
    try {
      await Promise.all([redis.ping(), pool.query("SELECT 1")]);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.status(503).send({ ok: false, error: String(err) });
    }
  });
}
