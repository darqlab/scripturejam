import Fastify from "fastify";
import multipart from "@fastify/multipart";
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

const CSP_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

app.addHook("onSend", async (_req, reply, payload) => {
  const ct = reply.getHeader("content-type");
  if (typeof ct === "string" && ct.startsWith("text/html")) {
    reply.header("Content-Security-Policy", CSP_POLICY);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  return payload;
});

await app.register(multipart, { limits: { fileSize: config.MAX_CUSTOM_PACK_UPLOAD_BYTES } });
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
