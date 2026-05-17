import { randomBytes } from "node:crypto";
import { redis } from "../redis/client.js";
import { config } from "../config.js";
import type { SessionState, SessionMode, Translation, SessionScope } from "@scripturejam/types";

export interface LiveAnswerRecord {
  optionId: string;
  msToAnswer: number;
  correct: boolean;
  awarded: number;
}

export interface LivePlayerState {
  id: string;
  nickname: string;
  avatarId: string;
  resumeToken: string;
  score: number;
  status: "joined" | "answered" | "disconnected";
  socketId: string | null;
  joinedAt: number;
  answers: Record<string, LiveAnswerRecord>;
}

export interface LiveSession {
  code: string;
  hostToken: string;
  hostIpHash: string;
  hostSocketId: string | null;
  state: SessionState;
  mode: SessionMode;
  translation: Translation;
  scope: SessionScope;
  questionIds: string[];
  currentIndex: number;
  questionStartedAt: number | null;
  gameStartedAt: number | null;
  players: Record<string, LivePlayerState>;
  createdAt: number;
}

const key = (code: string) => `session:${code}`;

export async function getSession(code: string): Promise<LiveSession | null> {
  const raw = await redis.get(key(code));
  return raw ? (JSON.parse(raw) as LiveSession) : null;
}

export async function saveSession(session: LiveSession): Promise<void> {
  const hasPlayers = Object.keys(session.players).length > 0;
  const ttl = hasPlayers
    ? config.SESSION_TTL_ACTIVE_SECONDS
    : config.SESSION_TTL_EMPTY_SECONDS;
  await redis.setex(key(session.code), ttl, JSON.stringify(session));
}

export async function deleteSession(code: string): Promise<void> {
  await redis.del(key(code));
}

export function generateToken(): string {
  return randomBytes(24).toString("hex");
}

export function generatePlayerId(): string {
  return randomBytes(8).toString("hex");
}
