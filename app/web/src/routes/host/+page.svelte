<script lang="ts">
  import { goto } from "$app/navigation";
  import { storageSet } from "$lib/storage.js";
  import {
    BIBLE_BOOKS,
    type Translation,
    type SessionMode,
    type SessionScope,
    type Question,
    type QuestionPack,
    type Difficulty,
  } from "@scripturejam/types";

  let translation = $state<Translation>("WEB");
  let mode = $state<SessionMode>("individual");
  let creating = $state(false);
  let createError = $state<string | null>(null);

  // Generate-from-a-book state
  let generateBook = $state("");
  let generateCount = $state(10);
  let generateAgeBand = $state<"youth" | "all-ages">("all-ages");
  let generateChapterStart = $state<number | undefined>(undefined);
  let generateChapterEnd = $state<number | undefined>(undefined);
  let generateDifficulty = $state<Difficulty | "mixed">("mixed");
  let generating = $state(false);
  let generateError = $state<string | null>(null);

  let canCreate = $derived(!creating && generateBook !== "");

  const DIFFICULTY_LABELS: Record<Difficulty, string> = {
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
  };

  const GENERATE_ERROR_MESSAGES: Record<string, string> = {
    generation_not_configured: "AI question generation isn't configured on this server",
    generation_failed: "Couldn't generate questions for that book — try again or pick another book",
    unknown_book: "Unrecognized book name",
    invalid_request: "Check the chapter range — start must be less than or equal to end",
  };

  async function createSession() {
    if (generateBook === "") return;
    creating = true;
    createError = null;
    generateError = null;

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
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

      generating = true;
      const genRes = await fetch(`/api/sessions/${code}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostToken,
          book: generateBook,
          count: generateCount,
          ageBand: generateAgeBand,
          ...(generateChapterStart !== undefined && generateChapterEnd !== undefined
            ? { chapterStart: generateChapterStart, chapterEnd: generateChapterEnd }
            : {}),
          difficulty: generateDifficulty,
        }),
      });
      if (!genRes.ok) {
        const body = (await genRes.json().catch(() => ({}))) as { error?: string };
        generateError =
          (body.error && GENERATE_ERROR_MESSAGES[body.error]) ??
          "Couldn't generate questions for that book — try again or pick another book";
        generating = false;
        creating = false;
        return;
      }
      const { pack, questions } = (await genRes.json()) as {
        pack: QuestionPack;
        questions: Question[];
      };
      generating = false;

      const packRes = await fetch(`/api/sessions/${code}/pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostToken, pack, questions }),
      });
      if (!packRes.ok) {
        const body = (await packRes.json().catch(() => ({}))) as { error?: string };
        generateError = body.error ?? "Failed to attach generated pack";
        creating = false;
        return;
      }

      const realScope: SessionScope = { type: "custom", customPack: pack };
      storageSet(`sj_host_token_${code}`, hostToken);
      storageSet(`sj_host_scope_${code}`, JSON.stringify({ scope: realScope, translation, mode }));
      await goto(`/host/${code}`);
    } catch (err) {
      console.error("createSession error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      createError = msg.includes("fetch") ? "Network error — please try again" : `Error: ${msg}`;
      creating = false;
      generating = false;
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
      <div class="border-b border-gray-200 px-5 py-3">
        <span class="text-sm font-medium text-blue-700">Generate from a book</span>
      </div>

      <div class="p-5">
        <div class="space-y-3">
          <div>
            <label for="generate-book" class="block text-sm font-medium text-gray-700 mb-1">
              Bible book
            </label>
            <select
              id="generate-book"
              bind:value={generateBook}
              class="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] text-sm bg-white"
            >
              <option value="" disabled selected>Choose a book…</option>
              {#each BIBLE_BOOKS as book}
                <option value={book}>{book}</option>
              {/each}
            </select>
          </div>

          <div class="flex flex-wrap gap-2 items-end">
            <div class="w-28">
              <label for="generate-chapter-start" class="block text-xs text-gray-500 mb-1">
                From chapter <span class="text-gray-400">(opt.)</span>
              </label>
              <input
                id="generate-chapter-start"
                type="number"
                min="1"
                bind:value={generateChapterStart}
                placeholder="e.g. 1"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[40px]"
              />
            </div>
            <div class="w-28">
              <label for="generate-chapter-end" class="block text-xs text-gray-500 mb-1">
                To chapter <span class="text-gray-400">(opt.)</span>
              </label>
              <input
                id="generate-chapter-end"
                type="number"
                min={generateChapterStart ?? 1}
                bind:value={generateChapterEnd}
                placeholder="e.g. 5"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[40px]"
              />
            </div>
          </div>
          <p class="text-xs text-gray-400">
            Leave both blank to draw from the whole book — e.g. Genesis chapter 1 to chapter 5
            restricts every generated question to that range.
          </p>

          <div>
            <label for="generate-count" class="block text-sm font-medium text-gray-700 mb-1">
              Number of questions
            </label>
            <input
              id="generate-count"
              type="number"
              min="5"
              max="30"
              bind:value={generateCount}
              class="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
            />
          </div>

          <fieldset>
            <legend class="text-xs font-medium text-gray-600 mb-1">Difficulty</legend>
            <div class="flex flex-wrap gap-4">
              {#each [["mixed", "Mixed"], ...Object.entries(DIFFICULTY_LABELS)] as [val, lbl]}
                <label class="flex items-center gap-2 cursor-pointer min-h-[36px]">
                  <input
                    type="radio"
                    bind:group={generateDifficulty}
                    value={val}
                    class="w-4 h-4 accent-blue-600"
                  />
                  <span class="text-sm">{lbl}</span>
                </label>
              {/each}
            </div>
          </fieldset>

          <fieldset>
            <legend class="text-xs font-medium text-gray-600 mb-1">Age band</legend>
            <div class="flex gap-4">
              {#each [["all-ages", "All ages"], ["youth", "Youth"]] as [val, lbl]}
                <label class="flex items-center gap-2 cursor-pointer min-h-[36px]">
                  <input
                    type="radio"
                    bind:group={generateAgeBand}
                    value={val}
                    class="w-4 h-4 accent-blue-600"
                  />
                  <span class="text-sm">{lbl}</span>
                </label>
              {/each}
            </div>
          </fieldset>

          <p class="text-xs text-gray-400">
            Questions are generated live by AI when you click "Create session" below —
            this can take a few seconds.
          </p>
          {#if generateError}
            <p class="text-red-600 text-xs font-medium" role="alert">{generateError}</p>
          {/if}
          {#if generating}
            <p class="text-xs text-blue-600 font-medium">Generating questions…</p>
          {/if}
        </div>
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
  </div>
</div>
