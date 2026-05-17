import Redis from "ioredis";
import { config } from "../config.js";
import { logger } from "../logger.js";

// Singleton Redis client — shared across rate-limiter, session state, and Socket.IO adapter.
export const redis = new Redis(config.REDIS_URL, {
  lazyConnect: true,
  enableReadyCheck: true,
});

redis.on("error", (err) => {
  logger.error("Redis error", { error: err.message });
});

export async function connectRedis() {
  await redis.connect();
  logger.info("Redis connected");
}
