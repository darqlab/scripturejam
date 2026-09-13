// Regression test for the host projector freeze (HostRenderFreeze_TM.md 1.1/1.2).
//
// Root cause: `runCount`'s `target <= 0` branch reads AND writes the $state
// variable `countsShown` before any `await`. When that call chain runs
// directly inside the host page's `$effect` (rather than via `untrack`),
// Svelte tracks that read/write pair as a dependency of the SAME effect,
// which re-fires itself and throws `effect_update_depth_exceeded` — killing
// the host's reactivity permanently. This is the class of bug the prior
// integration test (session.integration.test.ts) cannot catch: it never
// renders/mounts anything, so it never reaches Svelte's effect scheduler.
//
// This test mounts the real reveal effect via `$effect.root` (Svelte 5's
// supported way to run rune-based reactivity outside a component) and drives
// it with `optionCounts` where the FIRST option has zero votes — the exact
// case that triggers the bug (Polaris's negative control, 1.1's acceptance
// criterion). A run where option A has votes would prove nothing.
import { describe, it, expect } from "vitest";
import { createRevealChoreography } from "./reveal-choreography.svelte.js";
import type { RevealPayloadHost } from "@scripturejam/types";

function makeReveal(overrides: Partial<RevealPayloadHost> = {}): RevealPayloadHost {
  return {
    questionId: "q1",
    correctOptionId: "a",
    references: [],
    perQuestionTop5: [],
    answeredCount: 2,
    // First option (by render order below) has ZERO votes — this is the
    // case that hits runCount's synchronous target<=0 branch.
    optionCounts: { a: 0, b: 2 },
    standings: [
      { playerId: "p1", nickname: "Alice", avatarId: "av1", score: 100, previousScore: 0, awarded: 100 },
      { playerId: "p2", nickname: "Bob", avatarId: "av2", score: 50, previousScore: 0, awarded: 50 },
    ],
    playerCount: 2,
    verseText: "In the beginning God created the heavens and the earth.",
    translation: "WEB",
    ...overrides,
  };
}

const options = [{ id: "a" }, { id: "b" }];

describe("host reveal choreography effect (regression: effect_update_depth_exceeded)", () => {
  it("does not throw when mounted as an $effect and settles to the reveal end state", async () => {
    // Svelte reports `effect_update_depth_exceeded` through its own internal
    // error channel, not `console.error` and not a normal thrown/rejected
    // value the caller can catch — it surfaces as a process-level uncaught
    // exception. Real timers are used (not `vi.useFakeTimers`) because
    // `requestAnimationFrame`, used by the score count-up, isn't a fake-timer
    // clock and driving it with fake timers previously masked a second class
    // of the same bug (see the `queueMicrotask` note in reveal-choreography.
    // svelte.ts's `start()`): with fake timers collapsing every `setTimeout`
    // to zero real time, a later zero-vote option's resumed write was still
    // sometimes attributed to the effect, reproducing the crash even after
    // the `untrack`-only fix. Real timers exercise the actual browser timing.
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    process.on("uncaughtException", onUncaught);

    let reveal!: ReturnType<typeof createRevealChoreography>;
    let effectThrew: unknown = null;

    // Mirrors host/[code]/+page.svelte's own `$effect` exactly: it calls
    // `reveal.start(r, options)` synchronously whenever reveal data is
    // present. `$effect.root` is what lets this reactive graph run and be
    // torn down outside an actual mounted Svelte component.
    const destroy = $effect.root(() => {
      reveal = createRevealChoreography(() => null);
      $effect(() => {
        try {
          reveal.start(makeReveal(), options);
        } catch (err) {
          effectThrew = err;
        }
      });
    });

    // Real-time budget for the full choreography: 2 options counting up
    // (~1.5s each incl. pause) + verse delay (1s) + score delay/count-up
    // (~1.9s) + confetti delay (0.6s) — comfortably covered by 6s.
    await new Promise((resolve) => setTimeout(resolve, 6000));

    destroy();
    process.off("uncaughtException", onUncaught);

    expect(effectThrew).toBeNull();
    expect(uncaught).toEqual([]);

    // The host screen must reach the correct end state: counts shown
    // (including the zero-vote option), correct answer highlighted, verse
    // shown, and standings sorted by final score.
    expect(reveal.countsShown).toEqual({ a: 0, b: 2 });
    expect(reveal.revealedCorrectId).toBe("a");
    expect(reveal.showGains).toBe(true);
    expect(reveal.showVerse).toBe(true);
    expect(reveal.standingsOrder.map((s) => s.playerId)).toEqual(["p1", "p2"]);
  }, 10000);
});
