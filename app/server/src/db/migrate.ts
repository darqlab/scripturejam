import { pool } from "./client.js";
import { logger } from "../logger.js";

const DDL = `
  CREATE TABLE IF NOT EXISTS session_results (
    code             TEXT PRIMARY KEY,
    host_ip_hash     TEXT NOT NULL,
    translation      TEXT NOT NULL,
    scope_json       JSONB NOT NULL,
    started_at       TIMESTAMPTZ NOT NULL,
    ended_at         TIMESTAMPTZ NOT NULL,
    player_count     INTEGER NOT NULL,
    question_count   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_player_results (
    id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_code     TEXT NOT NULL REFERENCES session_results(code),
    nickname         TEXT NOT NULL,
    avatar_id        TEXT NOT NULL,
    final_score      INTEGER NOT NULL,
    final_rank       INTEGER NOT NULL,
    answered_correct INTEGER NOT NULL,
    answered_total   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_audit (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    host_ip_hash TEXT NOT NULL,
    outcome      TEXT NOT NULL CHECK (outcome IN ('created', 'rate_limited'))
  );
`;

export async function runMigrations(): Promise<void> {
  logger.info("Running database migrations");
  await pool.query(DDL);
  logger.info("Database migrations complete");
}
