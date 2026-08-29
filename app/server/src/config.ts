import { z } from "zod";

const schema = z.object({
  // Required
  IP_HASH_SECRET: z.string().min(16),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // Game knobs
  MIN_QUESTIONS_TO_START: z.coerce.number().int().positive().default(5),
  MAX_QUESTIONS_PER_SESSION: z.coerce.number().int().positive().default(20),
  QUESTION_DURATION_MS: z.coerce.number().int().positive().default(20_000),
  MAX_QUESTIONS_PER_CUSTOM_PACK: z.coerce
    .number()
    .int()
    .positive()
    .default(50),
  MAX_CUSTOM_PACK_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(262_144),

  // TTLs
  SESSION_TTL_EMPTY_SECONDS: z.coerce.number().int().positive().default(900),
  SESSION_TTL_ACTIVE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(14_400),

  // Rate limits — only meaningful once the deployment is reachable from the
  // public internet (DEC-009). LAN-only/local testing deployments should set
  // RATE_LIMIT_ENABLED=false rather than raising the thresholds.
  RATE_LIMIT_ENABLED: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("true"),
  RATE_LIMIT_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_GLOBAL_PER_HOUR: z.coerce.number().int().positive().default(100),

  // Results
  RESULTS_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),

  // LLM generation — NVIDIA's OpenAI-compatible endpoint (verified working
  // against nvidia/nemotron-3-ultra-550b-a55b, 2026-08-29:
  // ~/devops/scratchpad/2026-08-29_scripturejam-nvidia-generation-test.py)
  NVIDIA_API_KEY: z.string().min(1).optional(),
  NVIDIA_BASE_URL: z.string().url().default("https://integrate.api.nvidia.com/v1"),
  NVIDIA_MODEL: z.string().default("nvidia/nemotron-3-ultra-550b-a55b"),
  MAX_GENERATE_QUESTIONS: z.coerce.number().int().positive().default(20),

  // Observability
  ENABLE_METRICS: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("false"),

  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PUBLIC_URL: z.string().url().optional(),
});

function loadConfig() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const missing = Object.entries(errors)
      .map(([k, v]) => `  ${k}: ${v?.join(", ")}`)
      .join("\n");
    throw new Error(`Config validation failed:\n${missing}`);
  }
  return result.data;
}

// Singleton — loaded once at startup; throws if any required var is absent.
export const config = loadConfig();

export type Config = typeof config;
