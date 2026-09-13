/**
 * Unit tests for GET /api/generation/status — the runtime reachability probe
 * added for DEC-034/ADR-0001 §6b. Unlike /healthz (config-only), this
 * endpoint does a live fetch against NVIDIA_BASE_URL, so `global.fetch` is
 * mocked here rather than exercising a real network call.
 */

// Config singleton reads env vars at import time — set before any server
// module import, same pattern as tests/generate.test.ts.
process.env.IP_HASH_SECRET =
  process.env.IP_HASH_SECRET ?? "test-secret-at-least-16-chars";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://sj:sj@localhost:5432/sj";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
process.env.NVIDIA_API_KEY = "test-key-not-real";

import Fastify from "fastify";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Dynamic import (not a static top-level import) so this module's env-var
// assignments above run before config.ts is ever loaded — static imports
// are hoisted above other statements, which would otherwise trip config's
// required-var validation. Same pattern as tests/generate.test.ts.
async function buildApp() {
  const { sessionRoutes } = await import("../src/routes/sessions.js");
  const app = Fastify();
  app.register(sessionRoutes);
  return app;
}

describe("GET /api/generation/status", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns available:true when the endpoint responds ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/generation/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: true });
    await app.close();
  });

  it("returns available:false when the endpoint responds non-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/generation/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false });
    await app.close();
  });

  it("returns available:false when the fetch throws (unreachable/timeout)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as unknown as typeof fetch;
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/generation/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false });
    await app.close();
  });
});
