<script lang="ts">
  /**
   * The gradient page shell shared by every screen: decorative floating
   * glyphs, an optional top bar with the wordmark, and a slot for content.
   *
   * The gradient itself lives on `html` in app.css so it never seams at a
   * scroll boundary; this component supplies the layers above it.
   */
  import type { Snippet } from "svelte";

  let {
    children,
    meta,
    confetti = true,
    topbar = true,
  }: {
    children: Snippet;
    /** Right-hand side of the top bar — status pills, question counter, etc. */
    meta?: Snippet;
    confetti?: boolean;
    topbar?: boolean;
  } = $props();
</script>

{#if confetti}
  <!-- Decorative only: the shapes echo the answer glyphs but carry no meaning. -->
  <div class="confetti" aria-hidden="true">
    <span class="c1">▲</span><span class="c2">●</span><span class="c3">■</span
    ><span class="c4">◆</span><span class="c5">▲</span>
  </div>
{/if}

<div class="stage">
  {#if topbar}
    <div class="topbar">
      <div class="brand"><span class="logo">SJ</span>ScriptureJam</div>
      {#if meta}
        <div class="flex items-center gap-2">{@render meta()}</div>
      {/if}
    </div>
  {/if}
  {@render children()}
</div>
