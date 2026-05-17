<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { storageSet } from "$lib/storage.js";
  import type { Translation, SessionMode, SessionScope } from "@scripturejam/types";

  interface PackSummary {
    id: string;
    title: string;
    description: string;
    ageBand: string;
    questionCount: number;
  }

  let translation = $state<Translation>("WEB");
  let mode = $state<SessionMode>("individual");
  let scopeTab = $state<"pack" | "filter" | "custom">("pack");
  let creating = $state(false);
  let createError = $state<string | null>(null);

  let packs = $state<PackSummary[]>([]);
  let selectedPackId = $state<string | null>(null);
  let filterBooks = $state("");

  onMount(async () => {
    try {
      const res = await fetch("/api/packs");
      if (res.ok) {
        packs = await res.json();
        if (packs.length > 0) selectedPackId = packs[0].id;
      }
    } catch {
      // packs stay empty; user can still use filter/custom tabs
    }
  });

  let scope = $derived.by<SessionScope | null>(() => {
    if (scopeTab === "pack") {
      if (!selectedPackId) return null;
      return { type: "pack" as const, packId: selectedPackId };
    }
    if (scopeTab === "filter") {
      const books = filterBooks
        .split(",")
        .map((b) => b.trim())
        .filter(Boolean)
        .map((book) => ({ book }));
      if (books.length === 0) return null;
      return { type: "filter" as const, filter: { books } };
    }
    return {
      type: "custom" as const,
      customPack: {
        id: "custom-" + Date.now(),
        title: "Custom",
        description: "",
        ageBand: "all-ages" as const,
        questionIds: [],
      },
    };
  });

  let canCreate = $derived(!creating && scope !== null);

  async function createSession() {
    if (!scope) return;
    creating = true;
    createError = null;

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string; error?: string };
        if (res.status === 429 || body.error === "rate_limited") {
          createError = "Too many sessions created — please wait a few minutes and try again";
        } else {
          createError = body.message ?? body.error ?? "Failed to create session";
        }
        creating = false;
        return;
      }
      const data = (await res.json()) as { code: string; hostToken: string };
      const { code, hostToken } = data;

      storageSet(`sj_host_token_${code}`, hostToken);
      storageSet(`sj_host_scope_${code}`, JSON.stringify({ scope, translation, mode }));

      await goto(`/host/${code}`);
    } catch (err) {
      console.error("createSession error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      createError = msg.includes("fetch") ? "Network error — please try again" : `Error: ${msg}`;
      creating = false;
    }
  }
</script>

<div class="min-h-screen bg-gray-50 p-6">
  <div class="max-w-3xl mx-auto">
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900">scripturejam</h1>
      <p class="text-gray-500 mt-1">Create a new quiz session</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
      <fieldset class="bg-white border border-gray-200 rounded-xl p-4">
        <legend class="text-sm font-semibold text-gray-700 px-1">Bible translation</legend>
        <div class="mt-2 space-y-2">
          {#each ["KJV", "WEB", "ASV"] as t}
            <label class="flex items-center gap-3 cursor-pointer min-h-[44px]">
              <input
                type="radio"
                bind:group={translation}
                value={t}
                class="w-4 h-4 accent-blue-600"
              />
              <span class="text-sm font-medium">{t}</span>
            </label>
          {/each}
        </div>
      </fieldset>

      <fieldset class="bg-white border border-gray-200 rounded-xl p-4">
        <legend class="text-sm font-semibold text-gray-700 px-1">Play mode</legend>
        <div class="mt-2 space-y-2">
          <label class="flex items-center gap-3 cursor-pointer min-h-[44px]">
            <input
              type="radio"
              bind:group={mode}
              value="individual"
              class="w-4 h-4 accent-blue-600"
            />
            <div>
              <span class="text-sm font-medium block">Individual</span>
              <span class="text-xs text-gray-400">Each player picks their own answer</span>
            </div>
          </label>
          <label class="flex items-center gap-3 cursor-pointer min-h-[44px]">
            <input
              type="radio"
              bind:group={mode}
              value="group"
              class="w-4 h-4 accent-blue-600"
            />
            <div>
              <span class="text-sm font-medium block">Group / teams</span>
              <span class="text-xs text-gray-400">Teams discuss, one device per group</span>
            </div>
          </label>
        </div>
      </fieldset>
    </div>

    <div class="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
      <div class="flex border-b border-gray-200">
        {#each [["pack", "Curated pack"], ["filter", "Custom filter"], ["custom", "Author your own"]] as [tab, label]}
          <button
            type="button"
            class="flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors min-h-[44px] {scopeTab === tab ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-transparent text-gray-600 hover:bg-gray-50'}"
            onclick={() => (scopeTab = tab as typeof scopeTab)}
          >
            {label}
          </button>
        {/each}
      </div>

      <div class="p-5">
        {#if scopeTab === "pack"}
          {#if packs.length === 0}
            <div class="text-center py-6 space-y-2">
              <p class="text-gray-500 font-medium">No packs available</p>
              <p class="text-sm text-gray-400">
                Use the Custom filter tab to select questions by Bible book.
              </p>
            </div>
          {:else}
            <div class="space-y-2">
              {#each packs as pack}
                <label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer min-h-[52px] transition-colors {selectedPackId === pack.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}">
                  <input
                    type="radio"
                    bind:group={selectedPackId}
                    value={pack.id}
                    class="mt-1 w-4 h-4 accent-blue-600"
                  />
                  <div>
                    <span class="text-sm font-semibold block">{pack.title}</span>
                    <span class="text-xs text-gray-500">{pack.description} · {pack.questionCount} questions · {pack.ageBand}</span>
                  </div>
                </label>
              {/each}
            </div>
          {/if}
        {:else if scopeTab === "filter"}
          <div class="space-y-3">
            <div>
              <label for="filter-books" class="block text-sm font-medium text-gray-700 mb-1">
                Bible books (comma-separated)
              </label>
              <input
                id="filter-books"
                type="text"
                bind:value={filterBooks}
                placeholder="e.g. Genesis, Psalms, John, Romans"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
                autocomplete="off"
              />
              <p class="text-xs text-gray-400 mt-1">
                Questions will be drawn from all available questions in these books.
              </p>
            </div>
            {#if filterBooks.trim()}
              <div class="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
                Books: {filterBooks.split(",").map((b) => b.trim()).filter(Boolean).join(", ")}
              </div>
            {/if}
          </div>
        {:else}
          <div class="text-center py-6 space-y-2">
            <p class="text-gray-500 font-medium">Pack authoring</p>
            <p class="text-sm text-gray-400">
              Full pack authoring (task 3.15) is not yet available. This will create an empty
              custom pack — questions can be authored after the session is created.
            </p>
            <div class="inline-block mt-2 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
              Coming in a future phase
            </div>
          </div>
        {/if}
      </div>
    </div>

    {#if createError}
      <p class="text-red-600 text-sm font-medium mb-4" role="alert">{createError}</p>
    {/if}

    <button
      type="button"
      onclick={createSession}
      disabled={!canCreate}
      class="w-full sm:w-auto bg-blue-600 text-white px-8 py-4 rounded-xl font-bold text-base min-h-[52px] disabled:opacity-40 hover:bg-blue-700 transition-colors"
    >
      {creating ? "Creating session…" : "Create session →"}
    </button>

    {#if scopeTab === "pack" && packs.length === 0 && !creating}
      <p class="text-sm text-amber-600 mt-3">
        Select the "Custom filter" or "Author your own" tab to continue — no packs are loaded.
      </p>
    {/if}
  </div>
</div>
