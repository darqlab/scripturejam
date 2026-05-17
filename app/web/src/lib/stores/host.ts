import { writable } from "svelte/store";
import type {
  SessionState,
  SessionMode,
  Translation,
  QuestionPayload,
  RevealPayloadHost,
  FinalPayloadHost,
  SessionStatePayloadHost,
  PlayerJoinPayload,
  PlayerLeavePayload,
} from "@scripturejam/types";

export interface HostPlayer {
  playerId: string;
  nickname: string;
  avatarId: string;
  score: number;
  status: "joined" | "answered" | "disconnected";
}

export interface HostGameState {
  code: string | null;
  hostToken: string | null;
  state: SessionState | null;
  mode: SessionMode;
  translation: Translation;
  currentIndex: number;
  total: number;
  players: HostPlayer[];
  currentQuestion: QuestionPayload | null;
  answeredCount: number;
  revealData: RevealPayloadHost | null;
  finalData: FinalPayloadHost | null;
  connected: boolean;
}

function createHostStore() {
  const initial: HostGameState = {
    code: null,
    hostToken: null,
    state: null,
    mode: "individual",
    translation: "WEB",
    currentIndex: 0,
    total: 0,
    players: [],
    currentQuestion: null,
    answeredCount: 0,
    revealData: null,
    finalData: null,
    connected: false,
  };

  const { subscribe, update, set } = writable<HostGameState>(initial);

  return {
    subscribe,
    reset: () => set(initial),
    setConnected: (connected: boolean) => update((s) => ({ ...s, connected })),
    setCredentials: (code: string, hostToken: string) =>
      update((s) => ({ ...s, code, hostToken })),
    setSessionState: (payload: SessionStatePayloadHost) =>
      update((s) => ({
        ...s,
        state: payload.state,
        mode: payload.mode,
        translation: payload.translation,
        currentIndex: payload.currentIndex,
        currentQuestion: payload.currentQuestion ?? s.currentQuestion,
        players: payload.players.map((p) => ({
          playerId: p.playerId,
          nickname: p.nickname,
          avatarId: p.avatarId,
          score: p.score,
          status: p.status,
        })),
      })),
    setQuestion: (q: QuestionPayload) =>
      update((s) => ({
        ...s,
        state: "question",
        currentQuestion: q,
        currentIndex: q.index,
        total: q.total,
        answeredCount: 0,
        revealData: null,
      })),
    setReveal: (data: RevealPayloadHost) =>
      update((s) => ({
        ...s,
        state: "reveal",
        revealData: data,
        answeredCount: data.answeredCount,
      })),
    setFinal: (data: FinalPayloadHost) =>
      update((s) => ({
        ...s,
        state: "final",
        finalData: data,
      })),
    addPlayer: (payload: PlayerJoinPayload) =>
      update((s) => {
        const exists = s.players.some((p) => p.playerId === payload.playerId);
        if (exists) return s;
        return {
          ...s,
          players: [
            ...s.players,
            {
              playerId: payload.playerId,
              nickname: payload.nickname,
              avatarId: payload.avatarId,
              score: 0,
              status: "joined" as const,
            },
          ],
        };
      }),
    removePlayer: (payload: PlayerLeavePayload) =>
      update((s) => ({
        ...s,
        players: s.players.map((p) =>
          p.playerId === payload.playerId
            ? { ...p, status: "disconnected" as const }
            : p
        ),
      })),
  };
}

export const hostStore = createHostStore();
