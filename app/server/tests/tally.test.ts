import { describe, it, expect } from "vitest";
import { tallyOptionCounts } from "../src/game/tally.js";
import type { LivePlayerState } from "../src/session/store.js";

const OPTIONS = ["a", "b", "c", "d"];

function player(id: string, answers: Record<string, string>): LivePlayerState {
  return {
    id,
    nickname: id,
    avatarId: "moses",
    resumeToken: "t",
    score: 0,
    status: "joined",
    socketId: null,
    joinedAt: 0,
    answers: Object.fromEntries(
      Object.entries(answers).map(([qid, optionId]) => [
        qid,
        { optionId, msToAnswer: 1000, correct: false, awarded: 0 },
      ]),
    ),
  };
}

describe("tallyOptionCounts", () => {
  it("counts each option's votes", () => {
    const players = [
      player("p1", { q1: "a" }),
      player("p2", { q1: "c" }),
      player("p3", { q1: "a" }),
    ];
    expect(tallyOptionCounts(players, "q1", OPTIONS)).toEqual({ a: 2, b: 0, c: 1, d: 0 });
  });

  it("includes every option id, zeros and all, so the host layout stays stable", () => {
    const counts = tallyOptionCounts([player("p1", { q1: "b" })], "q1", OPTIONS);
    expect(Object.keys(counts).sort()).toEqual(OPTIONS);
  });

  it("excludes players who did not answer this question", () => {
    const players = [
      player("p1", { q1: "a" }),
      player("p2", {}), // never answered anything
      player("p3", { q2: "d" }), // answered a different question
    ];
    const counts = tallyOptionCounts(players, "q1", OPTIONS);
    expect(counts).toEqual({ a: 1, b: 0, c: 0, d: 0 });
  });

  it("sums to the same answeredCount the REVEAL payload reports", () => {
    const players = [
      player("p1", { q1: "a" }),
      player("p2", { q1: "b" }),
      player("p3", { q1: "b" }),
      player("p4", {}),
    ];
    const answeredCount = players.filter((p) => p.answers["q1"]).length;
    const total = Object.values(tallyOptionCounts(players, "q1", OPTIONS)).reduce((a, b) => a + b, 0);
    expect(total).toBe(answeredCount);
    expect(total).toBe(3);
  });

  it("ignores an answer whose optionId is not in the question's options", () => {
    const players = [player("p1", { q1: "a" }), player("p2", { q1: "zzz" })];
    const counts = tallyOptionCounts(players, "q1", OPTIONS);
    expect(counts).toEqual({ a: 1, b: 0, c: 0, d: 0 });
    expect(counts).not.toHaveProperty("zzz");
  });

  it("handles a 2-option question", () => {
    const players = [player("p1", { q1: "a" }), player("p2", { q1: "b" })];
    expect(tallyOptionCounts(players, "q1", ["a", "b"])).toEqual({ a: 1, b: 1 });
  });
});
