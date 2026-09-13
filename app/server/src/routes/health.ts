import type { FastifyInstance } from "fastify";
import { redis } from "../redis/client.js";
import { pool } from "../db/client.js";
import { config } from "../config.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/healthz", async (_req, reply) => {
    const generation = config.NVIDIA_API_KEY ? "configured" : "unconfigured";
    try {
      await Promise.all([redis.ping(), pool.query("SELECT 1")]);
      return reply.send({ ok: true, generation });
    } catch (err) {
      return reply.status(503).send({ ok: false, error: String(err), generation });
    }
  });
}
