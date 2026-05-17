// Shared types consumed by both server and web packages.
// Mirrors the event contract defined in planning/03-architecture.md.

// ── Domain primitives ───────────────────────────────────────────────────────

export type Translation = "KJV" | "WEB" | "ASV";

export type SessionState = "lobby" | "question" | "reveal" | "final";

export type SessionMode = "individual" | "group";

export type Difficulty = "easy" | "medium" | "hard";

export type AvatarCategory = "person" | "people" | "animal" | "object";

export type Testament = "OT" | "NT" | "both";

export interface Reference {
  book: string;
  chapter: number;
  verse_start: number;
  verse_end?: number;
}

// ── Content types ────────────────────────────────────────────────────────────

export interface AvatarEntity {
  id: string;
  displayName: string;
  disambiguation?: string;
  category: AvatarCategory;
  testament: Testament | null;
  tags: string[];
  blurb: string;
  aliases: string[];
  illustration: string | null;
}

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  prompt: string;
  options: QuestionOption[];
  correctOptionId: string;
  references: Reference[];
  difficulty: Difficulty;
  themes: string[];
}

export interface QuestionPack {
  id: string;
  title: string;
  description: string;
  ageBand: "youth" | "all-ages";
  questionIds: string[];
}

// ── Session scope ────────────────────────────────────────────────────────────

export interface BookChapterRange {
  start: number;
  end: number;
}

export interface ScopeBook {
  book: string;
  chapters?: BookChapterRange[];
}

export interface ScopeFilter {
  books: ScopeBook[];
}

export type SessionScope =
  | { type: "pack"; packId: string }
  | { type: "filter"; filter: ScopeFilter }
  | { type: "custom"; customPack: QuestionPack };

// ── Socket.IO event payloads — server → host ─────────────────────────────────

export interface PlayerJoinPayload {
  playerId: string;
  nickname: string;
  avatarId: string;
  joinedAt: number;
}

export interface PlayerLeavePayload {
  playerId: string;
  reason: "disconnect" | "kicked" | "session_ended";
}

export interface QuestionPayload {
  questionId: string;
  index: number;
  total: number;
  prompt: string;
  options: QuestionOption[];
  startedAt: number;
  durationMs: number;
}

export interface RevealPayloadHost {
  questionId: string;
  correctOptionId: string;
  references: Reference[];
  perQuestionTop5: Array<{
    playerId: string;
    nickname: string;
    avatarId: string;
    awarded: number;
  }>;
  answeredCount: number;
  playerCount: number;
}

export interface FinalPayloadHost {
  top10: Array<{
    playerId: string;
    nickname: string;
    avatarId: string;
    score: number;
    rank: number;
  }>;
  questionCount: number;
  playerCount: number;
}

export interface SessionStatePayloadHost {
  state: SessionState;
  mode: SessionMode;
  translation: Translation;
  currentIndex: number;
  players: Array<{
    playerId: string;
    nickname: string;
    avatarId: string;
    score: number;
    status: "joined" | "answered" | "disconnected";
  }>;
  currentQuestion?: QuestionPayload;
  msRemaining?: number;
}

// ── Socket.IO event payloads — server → player ───────────────────────────────

export interface RevealPayloadPlayer {
  questionId: string;
  correctOptionId: string;
  references: Reference[];
  yourPick?: string;
  yourCorrect: boolean;
  yourAwarded: number;
  yourCumulative: number;
  yourRank: number;
  totalPlayers: number;
  verseText: string;
  translation: Translation;
}

export interface FinalPayloadPlayer {
  yourFinalRank: number;
  yourFinalScore: number;
  yourAnsweredCorrect: number;
  totalPlayers: number;
  top10: Array<{
    nickname: string;
    avatarId: string;
    score: number;
    rank: number;
  }>;
}

export interface KickedPayload {
  reason: string;
}

export interface SessionStatePayloadPlayer {
  state: SessionState;
  mode: SessionMode;
  currentIndex: number;
  total?: number;
  currentQuestion?: QuestionPayload;
  msRemaining?: number;
  yourPick?: string;
  yourLocked: boolean;
}

// ── Socket.IO event payloads — client → server ───────────────────────────────

export interface JoinRequest {
  code: string;
  nickname: string;
  avatarId: string;
  resumeToken?: string;
}

export type JoinAck =
  | { ok: true; playerId: string; resumeToken: string }
  | {
      ok: false;
      reason:
        | "session_not_found"
        | "session_full"
        | "nickname_taken"
        | "avatar_invalid"
        | "wrong_mode_avatar"
        | "session_ended";
    };

export interface HostConnectRequest {
  code: string;
  hostToken: string;
}

export type HostConnectAck =
  | { ok: true }
  | { ok: false; reason: "session_not_found" | "invalid_host_token" };

export interface AnswerRequest {
  questionId: string;
  optionId: string;
}

export type AnswerAck =
  | { ok: true; lockedAt: number }
  | { ok: false; reason: "wrong_question" | "already_answered" | "timed_out" };

export type AdvanceAck = { ok: true } | { ok: false; reason: "wrong_state" };

export type EndAck = { ok: true } | { ok: false; reason: "wrong_state" };

export interface KickRequest {
  playerId: string;
}

export type KickAck =
  | { ok: true }
  | { ok: false; reason: "player_not_found" };

// ── Server → client event map ────────────────────────────────────────────────

export interface ServerToClientEvents {
  PLAYER_JOIN: (payload: PlayerJoinPayload) => void;
  PLAYER_LEAVE: (payload: PlayerLeavePayload) => void;
  QUESTION: (payload: QuestionPayload) => void;
  REVEAL: (payload: RevealPayloadHost | RevealPayloadPlayer) => void;
  FINAL: (payload: FinalPayloadHost | FinalPayloadPlayer) => void;
  KICKED: (payload: KickedPayload) => void;
  SESSION_STATE: (
    payload: SessionStatePayloadHost | SessionStatePayloadPlayer
  ) => void;
}

// ── Client → server event map ────────────────────────────────────────────────

export interface ClientToServerEvents {
  JOIN: (request: JoinRequest, ack: (result: JoinAck) => void) => void;
  HOST_CONNECT: (
    request: HostConnectRequest,
    ack: (result: HostConnectAck) => void
  ) => void;
  ANSWER: (request: AnswerRequest, ack: (result: AnswerAck) => void) => void;
  ADVANCE: (ack: (result: AdvanceAck) => void) => void;
  END: (ack: (result: EndAck) => void) => void;
  KICK: (request: KickRequest, ack: (result: KickAck) => void) => void;
}
