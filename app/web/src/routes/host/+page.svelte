<script lang="ts">
  import { onMount } from "svelte";
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

  interface PackSummary {
    id: string;
    title: string;
    description: string;
    ageBand: string;
    questionCount: number;
  }

  interface DraftQuestion {
    id: string;
    prompt: string;
    options: [string, string, string, string];
    correctIndex: number;
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd?: number;
    difficulty: Difficulty;
    themes: string; // comma-separated
  }

  let translation = $state<Translation>("WEB");
  let mode = $state<SessionMode>("individual");
  let scopeTab = $state<"pack" | "filter" | "custom" | "generate">("pack");
  let creating = $state(false);
  let createError = $state<string | null>(null);

  let packs = $state<PackSummary[]>([]);
  let selectedPackId = $state<string | null>(null);
  let filterBooks = $state("");

  // Pack authoring state
  let customTitle = $state("");
  let customDescription = $state("");
  let customAgeBand = $state<"youth" | "all-ages">("all-ages");
  let customQuestions = $state<DraftQuestion[]>([]);

  // Generate-from-a-book state
  let generateBook = $state("");
  let generateCount = $state(10);
  let generateAgeBand = $state<"youth" | "all-ages">("all-ages");
  let generating = $state(false);
  let generateError = $state<string | null>(null);

  // Question editor state
  let showQEditor = $state(false);
  let editingIndex = $state<number | null>(null);

  // Draft question form
  let draftPrompt = $state("");
  let draftOptions = $state(["", "", "", ""]);
  let draftCorrectIndex = $state(0);
  let draftBook = $state("");
  let draftChapter = $state(1);
  let draftVerseStart = $state(1);
  let draftVerseEnd = $state<number | undefined>(undefined);
  let draftDifficulty = $state<Difficulty>("medium");
  let draftThemes = $state("");

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
    if (scopeTab === "generate") {
      // No real scope exists yet — the pack is generated live inside
      // createSession(). canCreate below gates on generateBook instead.
      return null;
    }
    // custom tab
    if (customTitle.trim() === "" || customQuestions.length === 0) return null;
    return {
      type: "custom" as const,
      customPack: {
        id: "custom-draft",
        title: customTitle.trim(),
        description: customDescription.trim(),
        ageBand: customAgeBand,
        questionIds: customQuestions.map((q) => q.id),
      },
    };
  });

  let canCreate = $derived(
    !creating && (scopeTab === "generate" ? generateBook !== "" : scope !== null)
  );

  function resetDraftForm() {
    draftPrompt = "";
    draftOptions = ["", "", "", ""];
    draftCorrectIndex = 0;
    draftBook = "";
    draftChapter = 1;
    draftVerseStart = 1;
    draftVerseEnd = undefined;
    draftDifficulty = "medium";
    draftThemes = "";
  }

  function openAddQuestion() {
    editingIndex = null;
    resetDraftForm();
    showQEditor = true;
  }

  function openEditQuestion(i: number) {
    const q = customQuestions[i];
    editingIndex = i;
    draftPrompt = q.prompt;
    draftOptions = [...q.options] as [string, string, string, string];
    draftCorrectIndex = q.correctIndex;
    draftBook = q.book;
    draftChapter = q.chapter;
    draftVerseStart = q.verseStart;
    draftVerseEnd = q.verseEnd;
    draftDifficulty = q.difficulty;
    draftThemes = q.themes;
    showQEditor = true;
  }

  function deleteQuestion(i: number) {
    customQuestions = customQuestions.filter((_, idx) => idx !== i);
  }

  let importError = $state<string | null>(null);
  let importFileInput = $state<HTMLInputElement | null>(null);

  function handleImportFile(e: Event) {
    importError = null;
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = ev.target?.result as string;
        const data = JSON.parse(raw) as { pack?: unknown; questions?: unknown[] };
        if (!data.pack || !Array.isArray(data.questions)) {
          importError = "Invalid pack file — expected { pack, questions }";
          return;
        }
        const pack = data.pack as QuestionPack;
        const questions = data.questions as Question[];

        customTitle = pack.title ?? "";
        customDescription = pack.description ?? "";
        customAgeBand = pack.ageBand === "youth" ? "youth" : "all-ages";

        customQuestions = questions.map((q): DraftQuestion => {
          const opts = q.options ?? [];
          const correctIdx = opts.findIndex((o) => o.id === q.correctOptionId);
          const ref = q.references?.[0];
          return {
            id: q.id ?? crypto.randomUUID(),
            prompt: q.prompt ?? "",
            options: [
              opts[0]?.text ?? "",
              opts[1]?.text ?? "",
              opts[2]?.text ?? "",
              opts[3]?.text ?? "",
            ],
            correctIndex: correctIdx >= 0 ? correctIdx : 0,
            book: ref?.book ?? "",
            chapter: ref?.chapter ?? 1,
            verseStart: ref?.verse_start ?? 1,
            verseEnd: ref?.verse_end,
            difficulty: (["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium") as Difficulty,
            themes: (q.themes ?? []).join(", "),
          };
        });

        // Reset the file input so the same file can be re-imported
        if (importFileInput) importFileInput.value = "";
      } catch {
        importError = "Could not parse file — is it a valid scripturejam pack JSON?";
      }
    };
    reader.readAsText(file);
  }

  let draftError = $state<string | null>(null);

  function saveQuestion() {
    draftError = null;
    if (!draftPrompt.trim()) {
      draftError = "Question prompt is required.";
      return;
    }
    if (draftOptions.some((o) => !o.trim())) {
      draftError = "All four answer options must be filled in.";
      return;
    }
    if (!draftBook.trim()) {
      draftError = "Book is required for the scripture reference.";
      return;
    }
    if (!draftChapter || draftChapter < 1) {
      draftError = "Chapter must be at least 1.";
      return;
    }
    if (!draftVerseStart || draftVerseStart < 1) {
      draftError = "Verse start must be at least 1.";
      return;
    }

    const dq: DraftQuestion = {
      id: editingIndex !== null ? customQuestions[editingIndex].id : crypto.randomUUID(),
      prompt: draftPrompt.trim(),
      options: draftOptions.map((o) => o.trim()) as [string, string, string, string],
      correctIndex: draftCorrectIndex,
      book: draftBook.trim(),
      chapter: draftChapter,
      verseStart: draftVerseStart,
      verseEnd: draftVerseEnd && draftVerseEnd >= draftVerseStart ? draftVerseEnd : undefined,
      difficulty: draftDifficulty,
      themes: draftThemes,
    };

    if (editingIndex !== null) {
      customQuestions = customQuestions.map((q, i) => (i === editingIndex ? dq : q));
    } else {
      customQuestions = [...customQuestions, dq];
    }

    showQEditor = false;
    editingIndex = null;
    resetDraftForm();
  }

  function cancelEditor() {
    showQEditor = false;
    editingIndex = null;
    draftError = null;
    resetDraftForm();
  }

  const DIFFICULTY_LABELS: Record<Difficulty, string> = {
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
  };

  const DIFFICULTY_COLORS: Record<Difficulty, string> = {
    easy: "bg-green-100 text-green-700",
    medium: "bg-yellow-100 text-yellow-700",
    hard: "bg-red-100 text-red-700",
  };

  const GENERATE_ERROR_MESSAGES: Record<string, string> = {
    generation_not_configured: "AI question generation isn't configured on this server",
    generation_failed: "Couldn't generate questions for that book — try again or pick another book",
    unknown_book: "Unrecognized book name",
  };

  async function createSession() {
    if (scopeTab === "generate") {
      if (generateBook === "") return;
    } else if (!scope) {
      return;
    }
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

      if (scopeTab === "generate") {
        generating = true;
        const genRes = await fetch(`/api/sessions/${code}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hostToken,
            book: generateBook,
            count: generateCount,
            ageBand: generateAgeBand,
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
        return;
      } else if (scopeTab === "custom") {
        const packId = `custom-${code}`;
        const pack: QuestionPack = {
          id: packId,
          title: customTitle.trim(),
          description: customDescription.trim(),
          ageBand: customAgeBand,
          questionIds: customQuestions.map((q) => q.id),
        };
        const questions: Question[] = customQuestions.map((dq) => ({
          id: dq.id,
          prompt: dq.prompt,
          options: dq.options.map((text, i) => ({ id: `opt-${dq.id}-${i}`, text })),
          correctOptionId: `opt-${dq.id}-${dq.correctIndex}`,
          references: [
            {
              book: dq.book,
              chapter: dq.chapter,
              verse_start: dq.verseStart,
              ...(dq.verseEnd ? { verse_end: dq.verseEnd } : {}),
            },
          ],
          difficulty: dq.difficulty,
          themes: dq.themes
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }));

        const packRes = await fetch(`/api/sessions/${code}/pack`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostToken, pack, questions }),
        });
        if (!packRes.ok) {
          const body = (await packRes.json().catch(() => ({}))) as { error?: string };
          createError = body.error ?? "Failed to upload custom pack";
          creating = false;
          return;
        }

        const realScope: SessionScope = { type: "custom", customPack: pack };
        storageSet(`sj_host_token_${code}`, hostToken);
        storageSet(`sj_host_scope_${code}`, JSON.stringify({ scope: realScope, translation, mode }));
        await goto(`/host/${code}`);
        return;
      }

      storageSet(`sj_host_token_${code}`, hostToken);
      storageSet(`sj_host_scope_${code}`, JSON.stringify({ scope, translation, mode }));

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
      <div class="flex border-b border-gray-200">
        {#each [["pack", "Curated pack"], ["filter", "Custom filter"], ["custom", "Author your own"], ["generate", "Generate from a book"]] as [tab, label]}
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
        {:else if scopeTab === "generate"}
          <!-- Generate from a book tab -->
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
        {:else}
          <!-- Author your own tab -->
          <div class="space-y-5">
            <!-- Import from JSON -->
            <div class="border border-dashed border-gray-200 rounded-xl p-4 space-y-2 bg-gray-50">
              <p class="text-xs font-medium text-gray-600">Import from a previously exported pack</p>
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  bind:this={importFileInput}
                  type="file"
                  accept=".json,application/json"
                  onchange={handleImportFile}
                  class="text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-50 file:cursor-pointer"
                />
              </label>
              {#if importError}
                <p class="text-red-600 text-xs font-medium" role="alert">{importError}</p>
              {/if}
            </div>

            <!-- Pack metadata -->
            <div class="space-y-3">
              <h3 class="text-sm font-semibold text-gray-700">Pack details</h3>
              <div>
                <label for="custom-title" class="block text-xs font-medium text-gray-600 mb-1">
                  Pack title <span class="text-red-500">*</span>
                </label>
                <input
                  id="custom-title"
                  type="text"
                  bind:value={customTitle}
                  placeholder="e.g. Acts of the Apostles"
                  maxlength="80"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
                  autocomplete="off"
                />
              </div>
              <div>
                <label for="custom-desc" class="block text-xs font-medium text-gray-600 mb-1">
                  Description <span class="text-gray-400">(optional)</span>
                </label>
                <input
                  id="custom-desc"
                  type="text"
                  bind:value={customDescription}
                  placeholder="Short description for players"
                  maxlength="200"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
                  autocomplete="off"
                />
              </div>
              <fieldset>
                <legend class="text-xs font-medium text-gray-600 mb-1">Age band</legend>
                <div class="flex gap-4">
                  {#each [["all-ages", "All ages"], ["youth", "Youth"]] as [val, lbl]}
                    <label class="flex items-center gap-2 cursor-pointer min-h-[36px]">
                      <input
                        type="radio"
                        bind:group={customAgeBand}
                        value={val}
                        class="w-4 h-4 accent-blue-600"
                      />
                      <span class="text-sm">{lbl}</span>
                    </label>
                  {/each}
                </div>
              </fieldset>
            </div>

            <!-- Question list -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <h3 class="text-sm font-semibold text-gray-700">
                  Questions ({customQuestions.length})
                </h3>
                {#if customQuestions.length > 0 && customQuestions.length < 5}
                  <span class="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                    Need {5 - customQuestions.length} more to start
                  </span>
                {/if}
              </div>

              {#if customQuestions.length === 0}
                <div class="text-center py-6 border border-dashed border-gray-200 rounded-lg text-sm text-gray-400">
                  No questions yet — add one below.
                </div>
              {:else}
                <div class="space-y-2 mb-3">
                  {#each customQuestions as q, i}
                    <div class="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                      <span class="text-xs text-gray-400 w-5 shrink-0">{i + 1}.</span>
                      <p class="flex-1 text-sm text-gray-800 truncate">{q.prompt}</p>
                      <span class="text-xs px-2 py-0.5 rounded-full shrink-0 {DIFFICULTY_COLORS[q.difficulty]}">
                        {DIFFICULTY_LABELS[q.difficulty]}
                      </span>
                      <button
                        type="button"
                        onclick={() => openEditQuestion(i)}
                        class="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded shrink-0"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onclick={() => deleteQuestion(i)}
                        class="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded shrink-0"
                      >
                        Delete
                      </button>
                    </div>
                  {/each}
                </div>
              {/if}

              {#if !showQEditor}
                <button
                  type="button"
                  onclick={openAddQuestion}
                  class="w-full border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 rounded-lg py-2.5 text-sm font-medium transition-colors"
                >
                  + Add question
                </button>
              {/if}
            </div>

            <!-- Question editor panel -->
            {#if showQEditor}
              <div class="border border-blue-200 bg-blue-50/40 rounded-xl p-4 space-y-4">
                <h4 class="text-sm font-semibold text-gray-800">
                  {editingIndex !== null ? "Edit question" : "Add question"}
                </h4>

                <!-- Prompt -->
                <div>
                  <label for="draft-prompt" class="block text-xs font-medium text-gray-600 mb-1">
                    Question prompt <span class="text-red-500">*</span>
                  </label>
                  <textarea
                    id="draft-prompt"
                    bind:value={draftPrompt}
                    placeholder="e.g. Who was the first king of Israel?"
                    maxlength="500"
                    rows="3"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
                  ></textarea>
                </div>

                <!-- Options A–D -->
                <div>
                  <p class="text-xs font-medium text-gray-600 mb-2">
                    Answer options <span class="text-red-500">*</span>
                    <span class="text-gray-400 font-normal ml-1">(select the correct one)</span>
                  </p>
                  <div class="space-y-2">
                    {#each ["A", "B", "C", "D"] as letter, i}
                      <label class="flex items-center gap-2">
                        <input
                          type="radio"
                          bind:group={draftCorrectIndex}
                          value={i}
                          class="w-4 h-4 accent-blue-600 shrink-0"
                        />
                        <span class="text-xs font-bold text-gray-500 w-4 shrink-0">{letter}</span>
                        <input
                          type="text"
                          bind:value={draftOptions[i]}
                          placeholder="Option {letter}"
                          class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[40px]"
                          autocomplete="off"
                        />
                      </label>
                    {/each}
                  </div>
                </div>

                <!-- Scripture reference -->
                <div>
                  <p class="text-xs font-medium text-gray-600 mb-2">
                    Scripture reference <span class="text-red-500">*</span>
                  </p>
                  <div class="flex flex-wrap gap-2 items-end">
                    <div class="flex-1 min-w-[120px]">
                      <label for="draft-book" class="block text-xs text-gray-500 mb-1">Book</label>
                      <input
                        id="draft-book"
                        type="text"
                        bind:value={draftBook}
                        placeholder="e.g. John"
                        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[40px]"
                        autocomplete="off"
                      />
                    </div>
                    <div class="w-20">
                      <label for="draft-chapter" class="block text-xs text-gray-500 mb-1">Chapter</label>
                      <input
                        id="draft-chapter"
                        type="number"
                        bind:value={draftChapter}
                        min="1"
                        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[40px]"
                      />
                    </div>
                    <div class="w-20">
                      <label for="draft-verse-start" class="block text-xs text-gray-500 mb-1">Verse</label>
                      <input
                        id="draft-verse-start"
                        type="number"
                        bind:value={draftVerseStart}
                        min="1"
                        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[40px]"
                      />
                    </div>
                    <div class="w-24">
                      <label for="draft-verse-end" class="block text-xs text-gray-500 mb-1">
                        – end verse <span class="text-gray-400">(opt.)</span>
                      </label>
                      <input
                        id="draft-verse-end"
                        type="number"
                        bind:value={draftVerseEnd}
                        min={draftVerseStart}
                        placeholder="–"
                        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[40px]"
                      />
                    </div>
                  </div>
                </div>

                <!-- Difficulty -->
                <fieldset>
                  <legend class="text-xs font-medium text-gray-600 mb-2">Difficulty</legend>
                  <div class="flex gap-4">
                    {#each (["easy", "medium", "hard"] as Difficulty[]) as d}
                      <label class="flex items-center gap-2 cursor-pointer min-h-[36px]">
                        <input
                          type="radio"
                          bind:group={draftDifficulty}
                          value={d}
                          class="w-4 h-4 accent-blue-600"
                        />
                        <span class="text-sm">{DIFFICULTY_LABELS[d]}</span>
                      </label>
                    {/each}
                  </div>
                </fieldset>

                <!-- Themes -->
                <div>
                  <label for="draft-themes" class="block text-xs font-medium text-gray-600 mb-1">
                    Themes <span class="text-gray-400">(optional, comma-separated)</span>
                  </label>
                  <input
                    id="draft-themes"
                    type="text"
                    bind:value={draftThemes}
                    placeholder="e.g. faith, prayer, miracles"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[40px]"
                    autocomplete="off"
                  />
                </div>

                {#if draftError}
                  <p class="text-red-600 text-xs font-medium" role="alert">{draftError}</p>
                {/if}

                <!-- Editor actions -->
                <div class="flex gap-3 pt-1">
                  <button
                    type="button"
                    onclick={saveQuestion}
                    class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors min-h-[40px]"
                  >
                    Save question
                  </button>
                  <button
                    type="button"
                    onclick={cancelEditor}
                    class="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors min-h-[40px]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            {/if}
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
