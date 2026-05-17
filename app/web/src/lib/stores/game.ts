import { writable } from "svelte/store";
import type {
  SessionState,
  SessionMode,
  Translation,
  QuestionPayload,
  RevealPayloadPlayer,
  FinalPayloadPlayer,
  SessionStatePayloadPlayer,
} from "@scripturejam/types";

export interface PlayerGameState {
  sessionCode: string | null;
  sessionState: SessionState | null;
  mode: SessionMode | null;
  translation: Translation | null;
  playerId: string | null;
  nickname: string | null;
  avatarId: string | null;
  resumeToken: string | null;
  currentQuestion: QuestionPayload | null;
  msRemaining: number | null;
  yourPick: string | null;
  yourLocked: boolean;
  score: number;
  rank: number | null;
  totalPlayers: number | null;
  connected: boolean;
  reconnecting: boolean;
  revealData: RevealPayloadPlayer | null;
  finalData: FinalPayloadPlayer | null;
}

function createGameStore() {
  const initial: PlayerGameState = {
    sessionCode: null,
    sessionState: null,
    mode: null,
    translation: null,
    playerId: null,
    nickname: null,
    avatarId: null,
    resumeToken: null,
    currentQuestion: null,
    msRemaining: null,
    yourPick: null,
    yourLocked: false,
    score: 0,
    rank: null,
    totalPlayers: null,
    connected: false,
    reconnecting: false,
    revealData: null,
    finalData: null,
  };

  const { subscribe, update, set } = writable<PlayerGameState>(initial);

  return {
    subscribe,
    reset: () => set(initial),
    setConnected: (connected: boolean) => update((s) => ({ ...s, connected })),
    setReconnecting: (reconnecting: boolean) =>
      update((s) => ({ ...s, reconnecting })),
    setJoined: (
      playerId: string,
      nickname: string,
      avatarId: string,
      resumeToken: string,
      code: string
    ) =>
      update((s) => ({
        ...s,
        playerId,
        nickname,
        avatarId,
        resumeToken,
        sessionCode: code,
      })),
    setQuestion: (q: QuestionPayload, msRemaining?: number) =>
      update((s) => ({
        ...s,
        sessionState: "question",
        currentQuestion: q,
        msRemaining: msRemaining ?? q.durationMs,
        yourPick: null,
        yourLocked: false,
        revealData: null,
      })),
    setAnswerLocked: (optionId: string) =>
      update((s) => ({ ...s, yourPick: optionId, yourLocked: true })),
    setReveal: (data: RevealPayloadPlayer) =>
      update((s) => ({
        ...s,
        sessionState: "reveal",
        revealData: data,
        score: data.yourCumulative,
        rank: data.yourRank,
        totalPlayers: data.totalPlayers,
      })),
    setFinal: (data: FinalPayloadPlayer) =>
      update((s) => ({
        ...s,
        sessionState: "final",
        finalData: data,
        rank: data.yourFinalRank,
        totalPlayers: data.totalPlayers,
        score: data.yourFinalScore,
      })),
    setSessionState: (payload: SessionStatePayloadPlayer) =>
      update((s) => ({
        ...s,
        sessionState: payload.state,
        mode: payload.mode,
        currentQuestion: payload.currentQuestion ?? s.currentQuestion,
        msRemaining: payload.msRemaining ?? s.msRemaining,
        yourPick: payload.yourPick ?? s.yourPick,
        yourLocked: payload.yourLocked,
      })),
  };
}

export const gameStore = createGameStore();
