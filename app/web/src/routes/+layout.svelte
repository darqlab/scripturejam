<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { storageGet } from "$lib/storage.js";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  onMount(() => {
    const raw = storageGet("sj_a11y");
    if (!raw) return;
    try {
      const prefs = JSON.parse(raw) as { largeText?: boolean; highContrast?: boolean };
      document.documentElement.classList.toggle("large-text", prefs.largeText ?? false);
      document.documentElement.classList.toggle("high-contrast", prefs.highContrast ?? false);
    } catch {
      // ignore corrupt pref
    }
  });
</script>

{@render children()}
