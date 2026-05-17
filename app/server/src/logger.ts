import { config } from "./config.js";

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  level: LogLevel;
  time: string;
  msg: string;
  [key: string]: unknown;
}

function log(level: LogLevel, msg: string, fields?: Record<string, unknown>) {
  if (level === "debug" && config.NODE_ENV === "production") return;
  const entry: LogEntry = {
    level,
    time: new Date().toISOString(),
    msg,
    ...fields,
  };
  process.stdout.write(JSON.stringify(entry) + "\n");
}

export const logger = {
  info: (msg: string, fields?: Record<string, unknown>) =>
    log("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) =>
    log("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) =>
    log("error", msg, fields),
  debug: (msg: string, fields?: Record<string, unknown>) =>
    log("debug", msg, fields),
};
