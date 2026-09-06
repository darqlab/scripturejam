<script lang="ts">
  import { goto } from "$app/navigation";
  import { storageSet } from "$lib/storage.js";
  import Stage from "$lib/components/Stage.svelte";
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

<Stage confetti={false}>
  <div class="main">
    <div class="header">
      <p class="eyebrow">ScriptureJam</p>
      <h1>Create a new quiz session</h1>
    </div>

    <div class="layout">
      <div class="left-col">
        <fieldset class="card panel">
          <legend>Bible translation</legend>
          <div class="options">
            {#each ["KJV", "WEB", "ASV"] as t}
              <label class="radio-row">
                <input type="radio" bind:group={translation} value={t} />
                <span class="opt-title">{t}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <fieldset class="card panel">
          <legend>Play mode</legend>
          <div class="options">
            <label class="radio-row">
              <input type="radio" bind:group={mode} value="individual" />
              <div>
                <span class="opt-title">Individual</span>
                <span class="opt-sub">Each player picks their own answer</span>
              </div>
            </label>
            <label class="radio-row">
              <input type="radio" bind:group={mode} value="group" />
              <div>
                <span class="opt-title">Group / teams</span>
                <span class="opt-sub">Teams discuss, one device per group</span>
              </div>
            </label>
          </div>
        </fieldset>
      </div>

      <div class="card panel generate-panel">
        <div class="panel-title">Generate from a book</div>

        <div class="panel-body">
          <div class="field">
            <label for="generate-book">Bible book</label>
            <select id="generate-book" bind:value={generateBook}>
              <option value="" disabled selected>Choose a book…</option>
              {#each BIBLE_BOOKS as book}
                <option value={book}>{book}</option>
              {/each}
            </select>
          </div>

          <div class="chapter-row">
            <div class="field narrow">
              <label for="generate-chapter-start">
                From chapter <span class="opt">(opt.)</span>
              </label>
              <input
                id="generate-chapter-start"
                type="number"
                min="1"
                bind:value={generateChapterStart}
                placeholder="e.g. 1"
              />
            </div>
            <div class="field narrow">
              <label for="generate-chapter-end">
                To chapter <span class="opt">(opt.)</span>
              </label>
              <input
                id="generate-chapter-end"
                type="number"
                min={generateChapterStart ?? 1}
                bind:value={generateChapterEnd}
                placeholder="e.g. 5"
              />
            </div>
          </div>
          <p class="helper">
            Leave both blank to draw from the whole book — e.g. Genesis chapter 1 to chapter 5
            restricts every generated question to that range.
          </p>

          <div class="field">
            <label for="generate-count">Number of questions</label>
            <input
              id="generate-count"
              type="number"
              min="5"
              max="30"
              bind:value={generateCount}
              class="count-input"
            />
          </div>

          <fieldset class="sub-fieldset">
            <legend>Difficulty</legend>
            <div class="chip-row">
              {#each [["mixed", "Mixed"], ...Object.entries(DIFFICULTY_LABELS)] as [val, lbl]}
                <label class="chip-radio">
                  <input type="radio" bind:group={generateDifficulty} value={val} />
                  <span>{lbl}</span>
                </label>
              {/each}
            </div>
          </fieldset>

          <fieldset class="sub-fieldset">
            <legend>Age band</legend>
            <div class="chip-row">
              {#each [["all-ages", "All ages"], ["youth", "Youth"]] as [val, lbl]}
                <label class="chip-radio">
                  <input type="radio" bind:group={generateAgeBand} value={val} />
                  <span>{lbl}</span>
                </label>
              {/each}
            </div>
          </fieldset>

          <p class="helper">
            Questions are generated live by AI when you create the session — this can take a few seconds.
          </p>
          {#if generateError}
            <p class="error" role="alert">{generateError}</p>
          {/if}
          {#if generating}
            <p class="generating">Generating questions…</p>
          {/if}
        </div>
      </div>
    </div>

    {#if createError}
      <p class="error create-error" role="alert">{createError}</p>
    {/if}

    <button type="button" onclick={createSession} disabled={!canCreate} class="create-btn">
      {creating ? "Creating session…" : generating ? "Generating questions…" : "Create session →"}
    </button>
  </div>
</Stage>

<style>
  .main {
    flex: 1;
    padding: 24px 24px 48px;
    max-width: 1080px;
    width: 100%;
    margin: 0 auto;
    position: relative;
    z-index: 10;
  }

  .header {
    margin-bottom: 32px;
  }
  .eyebrow {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.75);
    margin: 0;
  }
  .header h1 {
    font-size: 42px;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.15;
    margin: 10px 0 0;
    color: #fff;
  }

  .layout {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 20px;
    margin-bottom: 24px;
  }
  @media (max-width: 800px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }

  .left-col {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .panel {
    border: 0;
    padding: 20px;
    margin: 0;
  }
  /* A <legend> is laid out ON the fieldset's border box by default, so on a
     white card it renders half outside and reads as clipped text. Floating it
     takes it out of that special layout and back into normal flow. */
  .panel legend {
    float: left;
  }
  .panel legend + * {
    clear: both;
  }
  .panel legend,
  .panel-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--grad-a);
    border-bottom: 1px solid rgba(42, 26, 94, 0.12);
    padding-bottom: 10px;
    margin-bottom: 12px;
    width: 100%;
  }
  .generate-panel {
    padding: 0;
    overflow: hidden;
  }
  .generate-panel .panel-title {
    padding: 14px 20px;
    margin: 0;
    border-bottom: 1px solid rgba(42, 26, 94, 0.12);
  }
  .panel-body {
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .radio-row {
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    min-height: 44px;
  }
  .radio-row input[type="radio"] {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    accent-color: var(--grad-a);
  }
  .opt-title {
    font-size: 17px;
    font-weight: 700;
    color: var(--ink);
    display: block;
  }
  .opt-sub {
    font-size: 13px;
    color: var(--ink-soft);
    display: block;
  }

  label,
  legend {
    color: var(--ink-soft);
  }
  .field label {
    display: block;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-soft);
    margin-bottom: 6px;
  }
  .field select,
  .field input {
    width: 100%;
    min-height: 44px;
    border: 2px solid rgba(42, 26, 94, 0.16);
    border-radius: 10px;
    padding: 8px 12px;
    font-size: 15px;
    background: var(--white);
    color: var(--ink);
    outline: none;
  }
  .field select:focus,
  .field input:focus {
    border-color: var(--grad-a);
    box-shadow: 0 0 0 4px rgba(123, 47, 247, 0.15);
  }
  .count-input {
    max-width: 200px;
  }

  .chapter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .field.narrow {
    width: 150px;
  }
  .field .opt {
    color: var(--ink-soft);
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
  }

  .helper {
    font-size: 13px;
    color: var(--ink-soft);
    margin: 0;
  }

  .sub-fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  .sub-fieldset legend {
    float: left;
    width: 100%;
    font-size: 12px;
    font-weight: 700;
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 6px;
    padding: 0;
    border: 0;
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
  }
  .chip-radio {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    min-height: 36px;
    font-size: 14px;
    color: var(--ink);
  }
  .chip-radio input {
    width: 16px;
    height: 16px;
    accent-color: var(--grad-a);
  }

  .error {
    color: var(--color-option-a);
    font-size: 13px;
    font-weight: 600;
    margin: 0;
  }
  .create-error {
    margin-bottom: 16px;
  }
  .generating {
    font-size: 13px;
    font-weight: 600;
    color: var(--grad-a);
    margin: 0;
  }

  .create-btn {
    width: 100%;
    max-width: 340px;
    padding: 18px 40px;
    border: 0;
    border-radius: 14px;
    background: var(--grad-a);
    color: #fff;
    font-weight: 800;
    font-size: 22px;
    box-shadow: 0 8px 20px rgba(123, 47, 247, 0.35);
    transition: transform 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
  }
  .create-btn:hover:not(:disabled) {
    transform: translateY(-3px);
    box-shadow: 0 14px 30px rgba(123, 47, 247, 0.42);
    background: var(--grad-b);
  }
  .create-btn:disabled {
    opacity: 0.4;
  }
</style>