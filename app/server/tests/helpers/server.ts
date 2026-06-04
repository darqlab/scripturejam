/**
 * Test server startup helper.
 *
 * Spins up the real Fastify + Socket.IO app on a random free port against real
 * Redis and Postgres instances.  Call startTestServer() at the top of an
 * integration test suite; call the returned cleanup() in afterAll.
 *
 * The helper deliberately re-uses the real app wiring (routes, socket handlers,
 * content loader, DB migrations) so there is nothing mocked except the port.
 */

import Fastify from "fastify";
import type { AddressInfo } from "node:net";

// ── Lazy module imports so the config singleton is only evaluated after
//    the caller has set the required env vars. ──────────────────────────────

export interface TestServer {
  port: number;
  baseUrl: string;
  cleanup: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  // Import side-effectful modules only now (config singleton reads env at
  // import time, so env vars must already be set before this function runs).
  const { connectRedis, redis } = await import("../../src/redis/client.js");
  const { runMigrations } = await import("../../src/db/migrate.js");
  const { pool } = await import("../../src/db/client.js");
  const { loadContent } = await import("../../src/content/loader.js");
  const { healthRoutes } = await import("../../src/routes/health.js");
  const { sessionRoutes } = await import("../../src/routes/sessions.js");
  const { svgRoutes } = await import("../../src/routes/svg.js");
  const { attachSocketServer } = await import("../../src/socket/index.js");

  // Connect to real Redis
  await connectRedis();

  // Run DB migrations so tables exist
  await runMigrations();

  // Load question packs and avatars from the real content directory
  try {
    loadContent();
  } catch {
    // Content load failures are non-fatal — tests that need content will fail
    // with a descriptive error from getContent() instead.
  }

  const { default: multipart } = await import("@fastify/multipart");
  const { config } = await import("../../src/config.js");

  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: config.MAX_CUSTOM_PACK_UPLOAD_BYTES } });
  await app.register(healthRoutes);
  await app.register(sessionRoutes);
  await app.register(svgRoutes);

  // Listen on a random port (port 0 → OS picks one)
  await app.listen({ port: 0, host: "127.0.0.1" });

  const address = app.server.address() as AddressInfo;
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Attach Socket.IO to the same http.Server
  const io = attachSocketServer(app.server);

  const cleanup = async () => {
    // Close all Socket.IO connections (the redis-adapter pub/sub duplicates are
    // internal and will be garbage-collected when the process exits).
    await new Promise<void>((resolve) => io.close(() => resolve()));

    // Close Fastify (and its underlying http.Server)
    await app.close();

    // Disconnect the main Redis client (best-effort)
    try {
      await redis.quit();
    } catch {
      // ignore — may already be disconnected
    }

    // Close the Postgres connection pool
    try {
      await pool.end();
    } catch {
      // ignore — may already be closed
    }
  };

  return { port, baseUrl, cleanup };
}
