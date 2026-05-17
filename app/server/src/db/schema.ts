import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

// task 2.3 — Drizzle schema; migrations via drizzle-kit

export const sessionResults = pgTable("session_results", {
  code: text("code").primaryKey(),
  hostIpHash: text("host_ip_hash").notNull(),
  translation: text("translation").notNull(),
  scopeJson: jsonb("scope_json").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  playerCount: integer("player_count").notNull(),
  questionCount: integer("question_count").notNull(),
});

export const sessionPlayerResults = pgTable("session_player_results", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sessionCode: text("session_code")
    .notNull()
    .references(() => sessionResults.code),
  nickname: text("nickname").notNull(),
  avatarId: text("avatar_id").notNull(),
  finalScore: integer("final_score").notNull(),
  finalRank: integer("final_rank").notNull(),
  answeredCorrect: integer("answered_correct").notNull(),
  answeredTotal: integer("answered_total").notNull(),
});

export const sessionAudit = pgTable("session_audit", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  hostIpHash: text("host_ip_hash").notNull(),
  outcome: text("outcome", { enum: ["created", "rate_limited"] }).notNull(),
});
