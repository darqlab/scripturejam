import type { FastifyRequest } from "fastify";
import { createHmac } from "node:crypto";
import { redis } from "../redis/client.js";
import { config } from "../config.js";

// task 2.8 — per-IP and global rate limit on session creation (DEC-009)

function hashIp(ip: string): string {
  return createHmac("sha256", config.IP_HASH_SECRET).update(ip).digest("hex");
}

export interface RateLimitResult {
  allowed: boolean;
  ipHash: string;
}

export async function checkSessionCreationRateLimit(
  req: FastifyRequest
): Promise<RateLimitResult> {
  const ip = req.ip;
  const ipHash = hashIp(ip);
  const hourKey = Math.floor(Date.now() / 3_600_000);
  const ipKey = `rl:ip:${ipHash}:${hourKey}`;
  const globalKey = `rl:global:${hourKey}`;
  const ttl = 3600;

  const [ipCount, globalCount] = await Promise.all([
    redis.incr(ipKey),
    redis.incr(globalKey),
  ]);

  await Promise.all([redis.expire(ipKey, ttl), redis.expire(globalKey, ttl)]);

  const allowed =
    ipCount <= config.RATE_LIMIT_PER_IP_PER_HOUR &&
    globalCount <= config.RATE_LIMIT_GLOBAL_PER_HOUR;

  return { allowed, ipHash };
}
