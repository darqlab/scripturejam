// ── Reveal choreography ────────────────────────────────────────────────────
// Extracted from host/[code]/+page.svelte so the effect at its heart can be
// mounted and exercised in isolation (via `$effect.root`) in a Vitest test —
// see reveal-choreography.test.ts. This is the ONLY copy of the logic; the
// host page just wires it to `hostStore` and the template.
//
// Implements host-reveal3-flow.md §Sequence: the audience must have exactly
// one thing to watch at a time, so each stage awaits the previous one.
//   1 answer counts (sequential)  2 correct highlight  3 points chips
//   4 verse card                  5 score count-up     6 standings re-order
// Stage 6 is handled declaratively by `animate:flip` on the keyed each in the
// host page template.

import { untrack } from "svelte";
import type { RevealPayloadHost } from "@scripturejam/types";
import confettiBurst from "./confetti.js";

const COUNT_DURATION_MS = 1100; // per-answer count-up
const COUNT_PAUSE_MS = 450; // gap between answers
const VERSE_DELAY_MS = 1000; // after the correct answer is highlighted
const SCORE_DELAY_MS = 700; // after the verse appears
const SCORE_DURATION_MS = 1200; // score count-up
const BURST_DELAY_MS = 600; // confetti, last action of the reveal

export function createRevealChoreography(getBurstCanvas: () => HTMLCanvasElement | null) {
  /** Vote counts revealed so far — drives the per-tile number and fill bar. */
  let countsShown = $state<Record<string, number>>({});
  /** Null until every count has run; then the tiles highlight and dim. */
  let revealedCorrectId = $state<string | null>(null);
  let showGains = $state(false);
  let showVerse = $state(false);
  /** Live score per player during the count-up, keyed by playerId. */
  let scoresShown = $state<Record<string, number>>({});
  /** Standings in render order; re-sorted at stage 6. */
  let standingsOrder = $state<RevealPayloadHost["standings"]>([]);
  /**
   * True from the moment a reveal starts until its confetti burst has fired
   * (or the choreography settled early on error) — the host page uses this
   * to keep "Next question" disabled so advancing can't cut the celebration
   * off mid-animation.
   */
  let isAnimating = $state(false);

  /**
   * Every timer/frame the running sequence owns, so it can be torn down
   * wholesale. A host who advances mid-choreography, a late socket event or a
   * navigation must not leave a stray interval ticking against state that has
   * already moved on.
   */
  let choreoTimers: Array<ReturnType<typeof setTimeout>> = [];
  let choreoRaf: number | null = null;
  /** Incremented on every cancel; a stale run sees the token change and exits. */
  let choreoRun = 0;

  function cancel() {
    choreoRun += 1;
    for (const t of choreoTimers) clearTimeout(t);
    choreoTimers = [];
    if (choreoRaf !== null) {
      cancelAnimationFrame(choreoRaf);
      choreoRaf = null;
    }
    isAnimating = false;
  }

  function sleep(ms: number, token: number): Promise<boolean> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(token === choreoRun), ms);
      choreoTimers.push(t);
    });
  }

  /** Counts one option up over COUNT_DURATION_MS, then pauses. */
  async function runCount(optionId: string, target: number, token: number): Promise<boolean> {
    if (target <= 0) {
      countsShown = { ...countsShown, [optionId]: 0 };
      return sleep(COUNT_PAUSE_MS, token);
    }
    const stepMs = Math.max(16, COUNT_DURATION_MS / target);
    for (let n = 1; n <= target; n++) {
      if (!(await sleep(stepMs, token))) return false;
      countsShown = { ...countsShown, [optionId]: n };
    }
    return sleep(COUNT_PAUSE_MS, token);
  }

  /** Animates every standing from previousScore to score in parallel. */
  function runScoreCountUp(
    standings: RevealPayloadHost["standings"],
    token: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        if (token !== choreoRun) {
          resolve(false);
          return;
        }
        const raw = Math.min((now - start) / SCORE_DURATION_MS, 1);
        const eased = 1 - Math.pow(1 - raw, 3); // ease-out cubic
        const next: Record<string, number> = {};
        for (const s of standings) {
          next[s.playerId] = Math.round(
            s.previousScore + (s.score - s.previousScore) * eased,
          );
        }
        scoresShown = next;
        if (raw < 1) {
          choreoRaf = requestAnimationFrame(step);
        } else {
          choreoRaf = null;
          resolve(true);
        }
      };
      choreoRaf = requestAnimationFrame(step);
    });
  }

  /**
   * Forces every reveal-stage variable straight to its final state, derived
   * only from the payload — no animation, no timers. Used both when the
   * choreography throws/rejects and as the one-shot equivalent of "the
   * animation finished" — a projector must never freeze on a dead animation.
   */
  function settleEndState(r: RevealPayloadHost) {
    countsShown = { ...r.optionCounts };
    revealedCorrectId = r.correctOptionId;
    showGains = true;
    showVerse = true;
    scoresShown = Object.fromEntries(r.standings.map((s) => [s.playerId, s.score]));
    standingsOrder = [...r.standings].sort((a, b) => b.score - a.score);
  }

  async function run(r: RevealPayloadHost, options: Array<{ id: string }>) {
    cancel();
    const token = choreoRun;
    isAnimating = true;

    try {
      // Reset to the pre-reveal state: nothing counted, nothing known.
      countsShown = Object.fromEntries(options.map((o) => [o.id, 0]));
      revealedCorrectId = null;
      showGains = false;
      showVerse = false;
      standingsOrder = [...r.standings].sort((a, b) => b.previousScore - a.previousScore);
      scoresShown = Object.fromEntries(r.standings.map((s) => [s.playerId, s.previousScore]));

      // 1 — counts, one option at a time, in the order they appear on screen.
      for (const opt of options) {
        if (!(await runCount(opt.id, r.optionCounts[opt.id] ?? 0, token))) return;
      }

      // 2 + 3 — the correct answer is highlighted and the points chips pop
      // together, so the gain reads as the consequence of the reveal.
      revealedCorrectId = r.correctOptionId;
      showGains = true;

      // 4 — verse, after a beat.
      if (!(await sleep(VERSE_DELAY_MS, token))) return;
      showVerse = true;

      // 5 — scores.
      if (!(await sleep(SCORE_DELAY_MS, token))) return;
      if (!(await runScoreCountUp(r.standings, token))) return;

      // 6 — re-order; animate:flip on the keyed each does the sliding.
      standingsOrder = [...r.standings].sort((a, b) => b.score - a.score);

      if (!(await sleep(BURST_DELAY_MS, token))) return;
      confettiBurst(getBurstCanvas());
      if (token === choreoRun) isAnimating = false;
    } catch (err) {
      // The choreography is cosmetic; it must never be load-bearing for a
      // live room. If it throws for any reason (e.g. a Svelte effect guard),
      // skip straight to the end state so the host screen is still correct.
      console.error("[host] reveal choreography failed — settling to end state", err);
      if (token === choreoRun) {
        settleEndState(r);
        isAnimating = false;
      }
    }
  }

  /** Entry point for the host page's `$effect` — see 1.1's fix note below. */
  function start(r: RevealPayloadHost, options: Array<{ id: string }>) {
    // `run`'s first synchronous branch (runCount's target<=0 case) both reads
    // and writes `countsShown` before any `await` — if invoked directly from
    // inside the caller's `$effect` body, that read/write pair is tracked as
    // a dependency of THIS effect, which self-invalidates it and throws
    // `effect_update_depth_exceeded` (the exact bug this module regression-
    // tests).
    //
    // `untrack()` alone is not enough: it only suspends tracking for `run`'s
    // SYNCHRONOUS prefix (up to its first `await`). Every subsequent
    // zero-vote option resumes on a later microtask, outside the untrack
    // callback's call stack — and empirically (both options at zero votes)
    // that resumed write can still be attributed to the effect and trip the
    // same guard. `queueMicrotask` breaks the call stack chain entirely, so
    // `run`'s synchronous prefix — and every later resumption — executes
    // with no active effect on the stack at all, not merely an untracked one.
    queueMicrotask(() => {
      untrack(() => {
        void run(r, options);
      });
    });
  }

  return {
    get countsShown() {
      return countsShown;
    },
    get revealedCorrectId() {
      return revealedCorrectId;
    },
    get showGains() {
      return showGains;
    },
    get showVerse() {
      return showVerse;
    },
    get scoresShown() {
      return scoresShown;
    },
    get standingsOrder() {
      return standingsOrder;
    },
    get isAnimating() {
      return isAnimating;
    },
    start,
    cancel,
  };
}

export type RevealChoreography = ReturnType<typeof createRevealChoreography>;
