import type { SessionState } from "@scripturejam/types";

// task 2.11 — allowed state transitions

const TRANSITIONS: Record<SessionState, SessionState[]> = {
  lobby: ["question"],
  question: ["reveal"],
  reveal: ["question", "final"],
  final: [],
};

export function canTransition(from: SessionState, to: SessionState): boolean {
  return TRANSITIONS[from].includes(to);
}
