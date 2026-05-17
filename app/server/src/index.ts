import Fastify from "fastify";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { connectRedis } from "./redis/client.js";
import { runMigrations } from "./db/migrate.js";
import { loadContent } from "./content/loader.js";
import { healthRoutes } from "./routes/health.js";
import { sessionRoutes } from "./routes/sessions.js";
import { svgRoutes } from "./routes/svg.js";
import { attachSocketServer } from "./socket/index.js";

const app = Fastify({ logger: false });

await app.register(healthRoutes);
await app.register(sessionRoutes);
await app.register(svgRoutes);

await connectRedis();
await runMigrations();

try {
  loadContent();
} catch (err) {
  logger.warn("Content load failed — session start will be unavailable", { error: String(err) });
}

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../public");
if (existsSync(publicDir)) {
  const fastifyStatic = (await import("@fastify/static")).default;
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    wildcard: false,
    index: false,
    serve: true,
  });
  app.get("/*", async (_req, reply) => {
    return reply.sendFile("index.html");
  });
} else {
  app.get("/", async (_req, reply) => {
    return reply.send({ app: "scripturejam", version: "0.1.0", env: config.NODE_ENV });
  });
}

await app.listen({ port: config.PORT, host: "0.0.0.0" });
logger.info("Server listening", { port: config.PORT, env: config.NODE_ENV });

attachSocketServer(app.server);
