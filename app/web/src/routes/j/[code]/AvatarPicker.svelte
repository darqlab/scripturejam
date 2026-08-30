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

<div class="min-h-screen bg-paper flex flex-col">
  <header class="bg-paper-2 border-b border-rule px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
    <button
      type="button"
      onclick={onBack}
      class="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-[6px] hover:bg-[rgba(35,32,27,.05)] transition-colors text-ink font-medium"
      aria-label="Back"
    >
      ← Back
    </button>
    <h2 class="text-lg font-semibold flex-1 text-center text-ink">Choose your avatar</h2>
    {#if !fallbackMode && filtered.length > 0}
      <button
        type="button"
        onclick={surpriseMe}
        class="min-h-[44px] px-3 bg-navy text-paper rounded-[6px] text-sm font-medium hover:bg-navy/90 transition-colors"
      >
        Surprise me
      </button>
    {/if}
  </header>

  {#if loading}
    <div class="flex-1 flex items-center justify-center">
      <p class="text-ink-60 animate-pulse">Loading avatars…</p>
    </div>
  {:else if fallbackMode}
    <div class="flex-1 flex flex-col items-center justify-center p-6 gap-4">
      <p class="text-ink-60 text-center">Type any name to use as your avatar</p>
      <input
        type="text"
        bind:value={fallbackText}
        placeholder="Avatar name…"
        class="w-full max-w-sm border border-rule rounded-[6px] px-3 py-2 min-h-[44px] text-base bg-paper-2 text-ink"
        maxlength="32"
        autocomplete="off"
      />
      {#if fallbackText.trim()}
        <div class="flex flex-col items-center gap-2">
          <img
            src="/api/avatars/{encodeURIComponent(fallbackText.trim())}/monogram.svg?name={encodeURIComponent(fallbackText.trim())}"
            alt={fallbackText.trim()}
            class="w-16 h-16 rounded-full"
          />
          <span class="text-sm text-ink-60">{fallbackText.trim()}</span>
        </div>
      {/if}
      <button
        type="button"
        onclick={() => onSelect(fallbackText.trim())}
        disabled={!fallbackText.trim()}
        class="w-full max-w-sm bg-navy text-paper rounded-[6px] px-4 py-3 min-h-[44px] font-semibold disabled:opacity-50 hover:bg-navy/90 transition-colors"
      >
        Use this name
      </button>
    </div>
  {:else}
    <div class="p-4 space-y-3 bg-paper-2 border-b border-rule">
      <input
        type="search"
        bind:value={search}
        placeholder="Search avatars…"
        class="w-full border border-rule rounded-[6px] px-3 py-2 min-h-[44px] text-base bg-paper-2 text-ink"
        autocomplete="off"
      />
      <div class="flex gap-2 flex-wrap">
        {#if mode !== "group"}
          {#each categories as cat}
            <button
              type="button"
              onclick={() => (categoryFilter = cat.value)}
              class="px-3 py-1 rounded-full text-sm font-medium min-h-[36px] border border-rule transition-colors {categoryFilter === cat.value ? 'bg-navy text-paper border-navy' : 'bg-paper-2 text-ink hover:bg-[rgba(35,32,27,.05)]'}"
            >
              {cat.label}
            </button>
          {/each}
        {/if}
      </div>
      <div class="flex gap-2 flex-wrap">
        {#each testaments as t}
          <button
            type="button"
            onclick={() => (testamentFilter = t.value)}
            class="px-3 py-1 rounded-full text-sm font-medium min-h-[36px] border border-rule transition-colors {testamentFilter === t.value ? 'bg-vine text-paper border-vine' : 'bg-paper-2 text-ink hover:bg-[rgba(35,32,27,.05)]'}"
          >
            {t.label}
          </button>
        {/each}
      </div>
    </div>

    {#if filtered.length === 0}
      <div class="flex-1 flex items-center justify-center p-6">
        <p class="text-ink-60">No avatars match your filters</p>
      </div>
    {:else}
      <div class="grid grid-cols-2 gap-3 p-4 overflow-y-auto">
        {#each filtered as avatar (avatar.id)}
          <button
            type="button"
            onclick={() => onSelect(avatar.id)}
            class="flex flex-col items-center gap-2 p-3 bg-paper-2 rounded-[12px] border border-rule hover:border-navy hover:bg-[rgba(35,32,27,.05)] transition-colors min-h-[100px] active:scale-[.98]"
          >
            <img
              src="/api/avatars/{avatar.id}/monogram.svg?name={encodeURIComponent(avatar.displayName)}"
              alt={avatar.displayName}
              class="w-[52px] h-[52px] rounded-full flex-shrink-0 border border-[rgba(30,58,95,.2)] bg-navy-8"
            />
            <span class="text-[19px] font-medium text-center leading-[1.2] text-ink">{avatar.displayName}</span>
            {#if avatar.disambiguation}
              <span class="text-[15px] text-ink-60 text-center leading-tight">{avatar.disambiguation}</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>