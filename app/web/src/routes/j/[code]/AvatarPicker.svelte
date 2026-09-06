<script lang="ts">
  import { onMount } from "svelte";
  import type { AvatarEntity, AvatarCategory, Testament } from "@scripturejam/types";

  let {
    onSelect,
    mode,
    onBack,
  }: {
    onSelect: (avatarId: string) => void;
    mode: "individual" | "group";
    onBack: () => void;
  } = $props();

  let avatars = $state<AvatarEntity[]>([]);
  let loading = $state(true);
  let fallbackMode = $state(false);
  let fallbackText = $state("");
  let search = $state("");
  let categoryFilter = $state<AvatarCategory | "all">("all");
  $effect(() => { categoryFilter = mode === "group" ? "people" : "all"; });
  let testamentFilter = $state<Testament | "all">("all");

  const categories: Array<{ value: AvatarCategory | "all"; label: string }> = [
    { value: "all", label: "All" },
    { value: "person", label: "Person" },
    { value: "people", label: "People/Group" },
    { value: "animal", label: "Animal" },
    { value: "object", label: "Object" },
  ];

  const testaments: Array<{ value: Testament | "all"; label: string }> = [
    { value: "all", label: "All" },
    { value: "OT", label: "Old Testament" },
    { value: "NT", label: "New Testament" },
    { value: "both", label: "Both" },
  ];

  onMount(async () => {
    try {
      const res = await fetch("/api/avatars");
      if (res.ok) {
        const data: AvatarEntity[] = await res.json();
        avatars = data;
        if (data.length === 0) fallbackMode = true;
      } else {
        fallbackMode = true;
      }
    } catch {
      fallbackMode = true;
    }
    loading = false;
  });

  let filtered = $derived(
    avatars.filter((a) => {
      if (mode === "group" && a.category !== "people") return false;
      if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
      if (testamentFilter !== "all" && a.testament !== testamentFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          a.displayName.toLowerCase().includes(q) ||
          a.aliases.some((alias) => alias.toLowerCase().includes(q)) ||
          (a.disambiguation ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    })
  );

  function surpriseMe() {
    if (filtered.length === 0) return;
    const pick = filtered[Math.floor(Math.random() * filtered.length)];
    onSelect(pick.id);
  }
</script>

<div class="picker">
  <header class="picker-header">
    <button type="button" onclick={onBack} class="back" aria-label="Back">
      ← Back
    </button>
    <h2>Choose your avatar</h2>
    {#if !fallbackMode && filtered.length > 0}
      <button type="button" onclick={surpriseMe} class="surprise">
        Surprise me
      </button>
    {/if}
  </header>

  {#if loading}
    <div class="center-fill">
      <p class="muted pulse">Loading avatars…</p>
    </div>
  {:else if fallbackMode}
    <div class="center-fill fallback">
      <p class="muted">Type any name to use as your avatar</p>
      <input
        type="text"
        bind:value={fallbackText}
        placeholder="Avatar name…"
        class="text-input"
        maxlength="32"
        autocomplete="off"
      />
      {#if fallbackText.trim()}
        <div class="fallback-preview">
          <img
            src="/api/avatars/{encodeURIComponent(fallbackText.trim())}/monogram.svg?name={encodeURIComponent(fallbackText.trim())}"
            alt={fallbackText.trim()}
          />
          <span class="muted">{fallbackText.trim()}</span>
        </div>
      {/if}
      <button
        type="button"
        onclick={() => onSelect(fallbackText.trim())}
        disabled={!fallbackText.trim()}
        class="use-name-btn"
      >
        Use this name
      </button>
    </div>
  {:else}
    <div class="filters">
      <input
        type="search"
        bind:value={search}
        placeholder="Search avatars…"
        class="text-input"
        autocomplete="off"
      />
      <div class="chips">
        {#if mode !== "group"}
          {#each categories as cat}
            <button
              type="button"
              onclick={() => (categoryFilter = cat.value)}
              class="chip"
              class:is-active={categoryFilter === cat.value}
            >
              {cat.label}
            </button>
          {/each}
        {/if}
      </div>
      <div class="chips">
        {#each testaments as t}
          <button
            type="button"
            onclick={() => (testamentFilter = t.value)}
            class="chip"
            class:is-active={testamentFilter === t.value}
          >
            {t.label}
          </button>
        {/each}
      </div>
    </div>

    {#if filtered.length === 0}
      <div class="center-fill">
        <p class="muted">No avatars match your filters</p>
      </div>
    {:else}
      <div class="avatar-grid">
        {#each filtered as avatar (avatar.id)}
          <button type="button" onclick={() => onSelect(avatar.id)} class="avatar-card">
            <img
              src="/api/avatars/{avatar.id}/monogram.svg?name={encodeURIComponent(avatar.displayName)}"
              alt={avatar.displayName}
            />
            <span class="name">{avatar.displayName}</span>
            {#if avatar.disambiguation}
              <span class="disambig">{avatar.disambiguation}</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* Full-bleed by design: the player side fills the viewport. */
  .picker {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--white);
    color: var(--ink);
    border-top: 6px solid var(--gold);
  }

  .picker-header {
    background: var(--white);
    border-bottom: 1px solid rgba(42, 26, 94, 0.12);
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .picker-header h2 {
    flex: 1;
    text-align: center;
    font-size: 18px;
    font-weight: 700;
    margin: 0;
    color: var(--ink);
  }
  .back {
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 0 12px;
    background: transparent;
    color: var(--ink);
    font-weight: 600;
    border: 0;
    transition: background 0.16s ease;
  }
  .back:hover {
    background: rgba(42, 26, 94, 0.06);
  }
  .surprise {
    min-height: 44px;
    padding: 0 14px;
    background: var(--grad-a);
    color: #fff;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 700;
    border: 0;
    transition: background 0.16s ease;
  }
  .surprise:hover {
    background: var(--grad-b);
  }

  .center-fill {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 24px;
  }
  .fallback {
    padding: 24px;
  }

  .muted {
    color: var(--ink-soft);
  }
  .pulse {
    animation: pulseMsg 1.6s ease-in-out infinite;
  }
  @keyframes pulseMsg {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.55; }
  }

  .text-input {
    width: 100%;
    max-width: 360px;
    min-height: 44px;
    border: 2px solid rgba(42, 26, 94, 0.16);
    border-radius: 10px;
    padding: 8px 14px;
    font-size: 16px;
    background: var(--white);
    color: var(--ink);
    outline: none;
    transition: border-color 0.16s ease, box-shadow 0.16s ease;
  }
  .text-input:focus {
    border-color: var(--grad-a);
    box-shadow: 0 0 0 4px rgba(123, 47, 247, 0.15);
  }

  .fallback-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .fallback-preview img {
    width: 64px;
    height: 64px;
    border-radius: 50%;
  }

  .use-name-btn {
    width: 100%;
    max-width: 360px;
    min-height: 44px;
    border: 0;
    border-radius: 10px;
    padding: 12px 16px;
    background: var(--grad-a);
    color: #fff;
    font-weight: 700;
    transition: background 0.16s ease;
  }
  .use-name-btn:hover:not(:disabled) {
    background: var(--grad-b);
  }
  .use-name-btn:disabled {
    opacity: 0.5;
  }

  .filters {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-bottom: 1px solid rgba(42, 26, 94, 0.12);
    background: rgba(42, 26, 94, 0.02);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    padding: 6px 14px;
    min-height: 36px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 700;
    border: 2px solid rgba(42, 26, 94, 0.16);
    background: var(--white);
    color: var(--ink);
    transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease;
  }
  .chip:hover {
    background: rgba(42, 26, 94, 0.06);
  }
  .chip.is-active {
    background: var(--grad-a);
    border-color: var(--grad-a);
    color: #fff;
  }

  .avatar-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 16px;
    overflow-y: auto;
  }
  .avatar-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 14px;
    min-height: 100px;
    background: var(--white);
    border: 2px solid rgba(42, 26, 94, 0.12);
    border-radius: 16px;
    transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
  }
  .avatar-card:hover {
    border-color: var(--grad-a);
    box-shadow: 0 8px 20px rgba(42, 26, 94, 0.12);
  }
  .avatar-card:active {
    transform: scale(0.98);
  }
  .avatar-card img {
    width: 52px;
    height: 52px;
    border-radius: 999px;
    flex-shrink: 0;
    background: rgba(42, 26, 94, 0.06);
  }
  .avatar-card .name {
    font-size: 15px;
    font-weight: 700;
    text-align: center;
    line-height: 1.2;
    color: var(--ink);
  }
  .avatar-card .disambig {
    font-size: 12px;
    color: var(--ink-soft);
    text-align: center;
    line-height: 1.2;
  }
</style>
