<script lang="ts">
  /**
   * Countdown bar. `progress` is the server-derived percentage remaining
   * (100 → 0); the RAF loop that produces it stays in the route so the timer
   * keeps its single source of truth.
   */
  let { progress, height = 14 }: { progress: number; height?: number } = $props();
  const clamped = $derived(Math.max(0, Math.min(100, progress)));
</script>

<div
  class="timerbar"
  style="height: {height}px"
  role="progressbar"
  aria-label="Time remaining"
  aria-valuenow={Math.round(clamped)}
  aria-valuemin="0"
  aria-valuemax="100"
>
  <div style="width: {clamped}%"></div>
</div>
