import { describe, it, expect } from "vitest";
import { computeScore } from "../src/scoring/index.js";

describe("computeScore", () => {
  it("returns 0 for wrong answer", () => {
    expect(computeScore({ correct: false, msToAnswer: 500, questionDurationMs: 20000 })).toBe(0);
  });

  it("returns ~1000 for instant correct answer", () => {
    const score = computeScore({ correct: true, msToAnswer: 0, questionDurationMs: 20000 });
    expect(score).toBe(1000);
  });

  it("returns 500 for correct answer at the buzzer", () => {
    const score = computeScore({ correct: true, msToAnswer: 20000, questionDurationMs: 20000 });
    expect(score).toBe(500);
  });

  it("returns 500 for correct answer after the buzzer (clamped)", () => {
    const score = computeScore({ correct: true, msToAnswer: 25000, questionDurationMs: 20000 });
    expect(score).toBe(500);
  });

  it("is proportional mid-way", () => {
    const score = computeScore({ correct: true, msToAnswer: 10000, questionDurationMs: 20000 });
    expect(score).toBe(750);
  });
});
