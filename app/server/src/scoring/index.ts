// task 2.13 — pure scoring function, unit-tested

export interface ScoreInput {
  correct: boolean;
  msToAnswer: number;
  questionDurationMs: number;
}

export function computeScore({ correct, msToAnswer, questionDurationMs }: ScoreInput): number {
  if (!correct) return 0;
  const speedRatio = Math.max(0, 1 - msToAnswer / questionDurationMs);
  return Math.round(500 + 500 * speedRatio);
}
