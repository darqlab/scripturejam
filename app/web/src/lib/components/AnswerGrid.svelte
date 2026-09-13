<script lang="ts" module>
  /**
   * The 2×2 answer grid, shared by the host big screen and the player phone.
   *
   * Accessibility contract (do not weaken):
   *  - Each option's identity is carried by SHAPE first (triangle/circle/
   *    square/diamond), color second. High-contrast mode recolors but never
   *    reshapes.
   *  - The player variant is shape-only by design — the answer text lives on
   *    the projected host screen — so every button keeps an aria-label
   *    naming both the shape and the answer text.
   */
  export const SHAPE_CLASSES = ["tri", "circ", "sq", "dia"] as const;
  export const SHAPE_LABELS = ["Triangle", "Circle", "Square", "Diamond"] as const;
  export const OPTION_COLORS = [
    "var(--color-option-a)",
    "var(--color-option-b)",
    "var(--color-option-c)",
    "var(--color-option-d)",
  ] as const;
</script>

<script lang="ts">
  type Option = { id: string; text: string };

  let {
    options,
    /** "host" shows the answer text; "player" is shape-only and tappable. */
    variant = "host",
    /** Option id the player has locked in, if any. */
    picked = null,
    /** Set once the answer is known; dims every non-correct tile. */
    correctOptionId = null,
    /** Suppresses interaction (answered, or revealing). */
    disabled = false,
    onpick,
    /** Per-option vote counts, host reveal only. Rendered as a fill bar. */
    counts = null,
    /** Which options have finished their count-up (host reveal choreography). */
    countsShown = null,
  }: {
    options: Option[];
    variant?: "host" | "player";
    picked?: string | null;
    correctOptionId?: string | null;
    disabled?: boolean;
    onpick?: (optionId: string) => void;
    counts?: Record<string, number> | null;
    countsShown?: Record<string, number> | null;
  } = $props();

  const totalVotes = $derived(
    counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0,
  );

  function tileClass(opt: Option): string {
    const classes = ["answer"];
    if (correctOptionId !== null) {
      if (opt.id === correctOptionId) classes.push("is-correct");
      else classes.push("is-dim");
    } else if (picked === opt.id) {
      classes.push("is-picked");
    }
    return classes.join(" ");
  }
</script>

<div class="answers" class:is-player={variant === "player"}>
  {#each options as opt, i (opt.id)}
    <button
      type="button"
      class={tileClass(opt)}
      style="background: {OPTION_COLORS[i]}"
      disabled={disabled || variant === "host"}
      aria-label="{SHAPE_LABELS[i]} — {opt.text}"
      aria-pressed={variant === "player" ? picked === opt.id : undefined}
      onclick={() => onpick?.(opt.id)}
    >
      <span class="glyph {SHAPE_CLASSES[i]}"></span>
      {#if variant === "host"}
        <span class="label">{opt.text}</span>
      {/if}

      {#if counts}
        <!-- Vote tally for this option. It only climbs when this option's turn
             comes, so the audience watches one number at a time. -->
        <span class="count" aria-hidden="true">{countsShown?.[opt.id] ?? 0}</span>
        <span
          class="fill"
          style="width: {totalVotes > 0
            ? ((countsShown?.[opt.id] ?? 0) / totalVotes) * 100
            : 0}%"
        ></span>
      {/if}

      {#if variant === "host" && correctOptionId !== null && opt.id === correctOptionId}
        <span class="tick" aria-hidden="true">✓</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .answers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
  }
  .answers :global(.answer) {
    /* min-height, not height: at large-text sizes a wrapped answer must be
       able to grow rather than spill outside its own tile. */
    min-height: 120px;
    padding-top: 12px;
    padding-bottom: 12px;
    font-size: 30px;
  }
  .answers :global(.answer .glyph) {
    width: clamp(64px, 8vw, 100px);
    height: clamp(64px, 8vw, 100px);
  }

  /* Player: shape-only, and the pad FILLS the viewport rather than sizing
     itself from its own content. Sizing by aspect-ratio makes the tiles grow
     with width, which pushes the bottom row off-screen on anything wider than
     a phone; two equal 1fr rows always fit exactly. */
  .answers.is-player {
    width: 100%;
    gap: 12px;
    flex: 1;
    min-height: 0;
    grid-template-rows: 1fr 1fr;
  }
  .answers.is-player :global(.answer) {
    height: auto;
    min-height: 0;
    padding: 0;
    justify-content: center;
  }
  .answers.is-player :global(.answer .glyph) {
    width: min(34vw, 30vh);
    height: min(34vw, 30vh);
  }

  .label {
    flex: 1;
    min-width: 0;
  }
  .answers :global(.answer) {
    overflow: hidden;
  }
  .tick {
    flex-shrink: 0;
    margin-left: 10px;
    font-size: 40px;
    line-height: 1;
    color: var(--gold);
  }
  /* An inline pill, as in the mockup — NOT absolutely positioned. Absolute
     placement collides with the answer text as soon as the label wraps, which
     it does at large-text sizes. */
  .count {
    margin-left: auto;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.22);
    border-radius: 999px;
    padding: 6px 16px;
    font-size: 22px;
    font-weight: 900;
  }
  .fill {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 6px;
    background: rgba(255, 255, 255, 0.85);
    transition: width 0.12s linear;
  }
</style>
