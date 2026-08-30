<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { hostStore } from "$lib/stores/host.js";
  import { connectSocket, getSocket } from "$lib/socket/client.js";
  import { storageGet } from "$lib/storage.js";
  import type {
    QuestionPayload,
    RevealPayloadHost,
    FinalPayloadHost,
    SessionStatePayloadHost,
    PlayerJoinPayload,
    PlayerLeavePayload,
    HostConnectAck,
    AdvanceAck,
    EndAck,
    KickAck,
  } from "@scripturejam/types";

  let code = $derived($page.params.code ?? "");

  const SHAPES = ["▲", "●", "■", "◆"];
  const SHAPE_LABELS = ["Triangle", "Circle", "Square", "Diamond"];
  const OPTION_COLORS = ["var(--color-option-a)", "var(--color-option-b)", "var(--color-option-c)", "var(--color-option-d)"];

  let timerProgress = $state(100);
  let timerRaf = $state<number | null>(null);
  let starting = $state(false);
  let startError = $state<string | null>(null);
  let advancing = $state(false);
  let copyDone = $state(false);
  let isCustomPack = $state(false);

  function startTimer(startedAt: number, durationMs: number) {
    if (timerRaf !== null) cancelAnimationFrame(timerRaf);
    function tick() {
      const elapsed = Date.now() - startedAt;
      const pct = Math.max(0, 100 - (elapsed / durationMs) * 100);
      timerProgress = pct;
      if (pct > 0) {
        timerRaf = requestAnimationFrame(tick);
      } else {
        timerRaf = null;
      }
    }
    timerRaf = requestAnimationFrame(tick);
  }

  function stopTimer() {
    if (timerRaf !== null) {
      cancelAnimationFrame(timerRaf);
      timerRaf = null;
    }
  }

  onMount(() => {
    const hostToken = storageGet(`sj_host_token_${code}`);
    if (!hostToken) {
      goto("/host");
      return;
    }

    hostStore.setCredentials(code, hostToken);

    const scopeRaw = storageGet(`sj_host_scope_${code}`);
    if (scopeRaw) {
      try {
        const parsed = JSON.parse(scopeRaw) as { scope?: { type?: string } };
        isCustomPack = parsed.scope?.type === "custom";
      } catch { /* ignore */ }
    }

    const socket = connectSocket();

    socket.on("connect", () => {
      hostStore.setConnected(true);
      socket.emit(
        "HOST_CONNECT",
        { code, hostToken },
        (ack: HostConnectAck) => {
          if (!ack.ok) {
            goto("/host");
          }
        }
      );
    });

    socket.on("disconnect", () => {
      hostStore.setConnected(false);
    });

    socket.on("SESSION_STATE", (payload) => {
      const p = payload as SessionStatePayloadHost;
      hostStore.setSessionState(p);
      if (p.state === "question" && p.currentQuestion) {
        const msRemaining = p.msRemaining ?? p.currentQuestion.durationMs;
        const startedAt = Date.now() - (p.currentQuestion.durationMs - msRemaining);
        startTimer(startedAt, p.currentQuestion.durationMs);
      }
    });

    socket.on("QUESTION", (payload: QuestionPayload) => {
      hostStore.setQuestion(payload);
      startTimer(payload.startedAt, payload.durationMs);
    });

    socket.on("REVEAL", (payload) => {
      stopTimer();
      hostStore.setReveal(payload as RevealPayloadHost);
    });

    socket.on("FINAL", (payload) => {
      stopTimer();
      hostStore.setFinal(payload as FinalPayloadHost);
    });

    socket.on("PLAYER_JOIN", (payload: PlayerJoinPayload) => {
      hostStore.addPlayer(payload);
    });

    socket.on("PLAYER_LEAVE", (payload: PlayerLeavePayload) => {
      hostStore.removePlayer(payload);
    });

    if (!socket.connected) {
      socket.connect();
    } else {
      hostStore.setConnected(true);
      socket.emit(
        "HOST_CONNECT",
        { code, hostToken },
        (ack: HostConnectAck) => {
          if (!ack.ok) {
            goto("/host");
          }
        }
      );
    }
  });

  onDestroy(() => {
    stopTimer();
    const socket = getSocket();
    socket.off("connect");
    socket.off("disconnect");
    socket.off("SESSION_STATE");
    socket.off("QUESTION");
    socket.off("REVEAL");
    socket.off("FINAL");
    socket.off("PLAYER_JOIN");
    socket.off("PLAYER_LEAVE");
  });

  async function startQuiz() {
    starting = true;
    startError = null;
    const hostToken = storageGet(`sj_host_token_${code}`);
    const scopeRaw = storageGet(`sj_host_scope_${code}`);
    if (!hostToken || !scopeRaw) {
      startError = "Session data missing — please create a new session";
      starting = false;
      return;
    }
    try {
      const { scope, translation, mode } = JSON.parse(scopeRaw) as {
        scope: unknown;
        translation: string;
        mode: string;
      };
      const res = await fetch(`/api/sessions/${code}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostToken, scope, translation, mode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; message?: string; matched?: number; min?: number };
        if (body.error === "scope_too_small") {
          startError = `Not enough questions — found ${body.matched}, need at least ${body.min}. Try a broader selection.`;
        } else if (body.error === "content_not_available") {
          startError = "Question content unavailable — please try again";
        } else {
          startError = body.message ?? body.error ?? "Failed to start quiz";
        }
        starting = false;
      }
    } catch {
      startError = "Network error — please try again";
      starting = false;
    }
  }

  function advance() {
    if (advancing) return;
    advancing = true;
    const socket = getSocket();
    socket.emit("ADVANCE", (ack: AdvanceAck) => {
      advancing = false;
      if (!ack.ok) {
        // state mismatch — server will send SESSION_STATE update
      }
    });
  }

  function endSession() {
    const socket = getSocket();
    socket.emit("END", (_ack: EndAck) => {
      // SERVER will emit FINAL or SESSION_STATE
    });
  }

  function kickPlayer(playerId: string) {
    const socket = getSocket();
    socket.emit("KICK", { playerId }, (_ack: KickAck) => {
      // Player will be removed via PLAYER_LEAVE event
    });
  }

  async function downloadPack() {
    const hostToken = storageGet(`sj_host_token_${code}`);
    if (!hostToken) return;
    const res = await fetch(`/api/sessions/${code}/pack.json?hostToken=${encodeURIComponent(hostToken)}`);
    if (!res.ok) return;
    const json = await res.text();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scripturejam-pack-${code}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyShareLink() {
    const link = `${window.location.origin}/r/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      copyDone = true;
      setTimeout(() => (copyDone = false), 2000);
    } catch {
      // clipboard not available
    }
  }

  function ordinal(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
  }

  let visiblePlayers = $derived(
    $hostStore.players.filter((p) => p.status !== "disconnected")
  );

  let answeredCount = $derived($hostStore.revealData?.answeredCount ?? 0);
  let playerCount = $derived($hostStore.revealData?.playerCount ?? $hostStore.players.length);
</script>

<div class="min-h-screen bg-paper text-ink">
  <header class="flex items-center justify-between px-[56px] py-[44px] border-b border-rule">
    <div class="flex items-center gap-3">
      <h1 class="text-[23px] font-medium uppercase tracking-[.28em] text-ink-38">scripturejam</h1>
    </div>
    <div class="flex items-center gap-3">
      <span
        class="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full border border-rule {$hostStore.connected ? 'text-navy' : 'text-clay'}"
      >
        <span class="w-1.5 h-1.5 rounded-full {$hostStore.connected ? 'bg-vine' : 'bg-clay'}"></span>
        {$hostStore.connected ? "Connected" : "Offline"}
      </span>
      <span class="font-mono text-ink-38 text-sm">Session {code}</span>
    </div>
  </header>

  {#if $hostStore.state === null || $hostStore.state === "lobby"}
    <div class="grid grid-cols-[1fr_400px] grid-rows-[112px_1fr_92px] min-h-[calc(100vh-142px)]">
      <!-- Left column: Header + Main -->
      <div class="col-span-1 row-span-2 flex flex-col min-h-0">
        <!-- Header row -->
        <div class="flex items-center justify-between px-[56px] py-4 flex-shrink-0">
          <p class="text-[31px] font-semibold uppercase tracking-[.1em] text-ink-38">Waiting to begin</p>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full border border-rule text-navy">
              {$hostStore.currentIndex + 1} / {$hostStore.total} questions
            </span>
            <span class="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full border border-rule text-navy">
              {$hostStore.translation}
            </span>
          </div>
        </div>

        <!-- Main content -->
        <div class="flex-1 flex items-center justify-center px-[56px] gap-[76px] min-h-0 overflow-hidden">
          <div class="text-center flex flex-col items-center justify-center min-h-0 flex-1">
            <img
              src="/api/sessions/{code}/qr.svg"
              alt="QR code to join session {code}"
              class="max-w-[660px] max-h-[660px] w-[50vh] h-[50vh] rounded-[14px] border border-rule bg-paper-2 p-2 flex-shrink-0"
            />
            <div class="mt-4 flex-shrink-0">
              <p class="text-[26px] text-ink-60 leading-relaxed">scan, or go to / quiz.local and enter</p>
              <p class="text-[172px] font-medium tracking-[.14em] leading-tight mt-2" style="font-weight: 500;">{code}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Right rail: spans all three rows -->
      <div class="col-span-1 row-span-3 bg-[rgba(35,32,27,.018)] border-l border-rule flex flex-col">
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          <p class="text-[21px] font-semibold uppercase tracking-[.2em] text-ink-38">Joined · {visiblePlayers.length}</p>
          <div class="space-y-0">
            {#each visiblePlayers as player, i (player.playerId)}
              <div class="px-[20px] py-[20px] border-b border-rule flex items-center gap-3 {i >= visiblePlayers.length - 2 ? 'opacity-' + (i === visiblePlayers.length - 2 ? '50' : '24') : ''}">
                <img
                  src="/api/avatars/{player.avatarId}/monogram.svg?name={encodeURIComponent(player.nickname)}"
                  alt={player.nickname}
                  class="w-8 h-8 rounded-full flex-shrink-0"
                />
                <span class="text-[29px] font-medium text-ink truncate">{player.nickname}</span>
              </div>
            {/each}
            {#if visiblePlayers.length === 0}
              <p class="text-[29px] text-ink-60 px-[20px] py-[20px] text-center">Waiting for players…</p>
            {/if}
          </div>
          <p class="text-[21px] font-medium uppercase tracking-[.2em] text-ink-38 opacity-50">names scroll as people arrive</p>
        </div>

        <!-- Persistent join block - stays visible in every big-screen state -->
        <div class="border-t border-rule p-4 flex-shrink-0">
          <div class="flex items-center justify-center gap-4">
            <img
              src="/api/sessions/{code}/qr.svg"
              alt="QR code to join session {code}"
              class="w-[112px] h-[112px] rounded-[10px] border border-rule bg-paper-2 p-1"
            />
            <div class="text-center">
              <p class="text-[24px] font-semibold uppercase tracking-[.1em] text-ink-38">JOIN AT QUIZ.LOCAL</p>
              <p class="text-[42px] font-medium tracking-[.14em] text-ink mt-1">{code}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer spanning both columns -->
      <div class="col-span-2 row-span-1 bg-paper-2 border-t border-rule flex items-center justify-between px-[56px] py-4">
        <div class="flex items-center gap-3">
          <button type="button" class="px-4 py-2 text-sm font-medium text-ink-60 hover:text-ink transition-colors min-h-[44px]">Settings</button>
          <button type="button" class="px-4 py-2 text-sm font-medium text-ink-60 hover:text-ink transition-colors min-h-[44px]">End</button>
        </div>
        <button
          type="button"
          onclick={startQuiz}
          disabled={starting || visiblePlayers.length === 0}
          class="bg-navy text-paper px-6 py-3 rounded-[6px] font-bold text-[25px] min-h-[44px] disabled:opacity-40 hover:bg-navy/90 transition-colors"
        >
          {starting ? "Starting…" : "Start first question →"}
        </button>
      </div>
    </div>

  {:else if $hostStore.state === "question" && $hostStore.currentQuestion}
    {@const q = $hostStore.currentQuestion}
    <div class="grid grid-cols-[1fr_400px] grid-rows-[112px_1fr_92px] min-h-[calc(100vh-142px)]">
      <!-- Left column: Header + Main -->
      <div class="col-span-1 row-span-2 flex flex-col min-h-0">
        <!-- Header row -->
        <div class="flex items-center justify-between px-[56px] py-4 flex-shrink-0">
          <p class="text-[31px] font-semibold uppercase tracking-[.1em] text-ink-38">Question {q.index + 1} of {q.total}</p>
          <div class="flex items-center justify-center w-[88px] h-[88px] relative" style="background: conic-gradient(var(--navy) 0 {timerProgress}%, rgba(30,58,95,.15) {timerProgress}% 100%); border-radius: 50%;">
            <div class="absolute inset-[9px] rounded-full bg-paper flex items-center justify-center">
              <span class="text-[37px] font-medium text-navy">{Math.ceil(q.durationMs * (1 - timerProgress / 100) / 1000)}</span>
            </div>
          </div>
        </div>

        <!-- Main content -->
        <div class="flex-1 flex flex-col items-center justify-center px-[56px] gap-[36px] min-h-0 overflow-hidden">
          <h2 class="text-[60px] font-semibold leading-[1.16] tracking-[-.01em] max-w-[1250px] text-wrap-pretty text-center">{q.prompt}</h2>

          <div class="grid grid-cols-2 gap-[22px] w-full max-w-[1250px]">
            {#each q.options as option, i}
              <div class="bg-paper-2 border border-rule rounded-[10px] px-[34px] gap-[26px] py-6 flex items-center text-[38px] font-medium shadow-hairline" style="background-color: var(--color-option-{OPTION_COLORS[i].split('-').pop()});">
                <span class="text-[28px] w-[56px] h-[56px] rounded-[8px] flex items-center justify-center text-paper" style="background-color: var(--color-option-{OPTION_COLORS[i].split('-').pop()});" aria-hidden="true">{SHAPES[i]}</span>
                <span class="flex-1 text-base leading-snug text-paper">{option.text}</span>
              </div>
            {/each}
          </div>

          <p class="text-ink-60">Waiting for answers…</p>
        </div>
      </div>

      <!-- Right rail: spans all three rows -->
      <div class="col-span-1 row-span-3 bg-[rgba(35,32,27,.018)] border-l border-rule flex flex-col">
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          <p class="text-[21px] font-semibold uppercase tracking-[.2em] text-ink-38">Top 5</p>
          <div class="space-y-3">
            {#each $hostStore.revealData?.perQuestionTop5 ?? [] as entry, i}
              <div class="bg-paper-2 rounded-[10px] px-4 py-3 flex items-center gap-3">
                <span class="text-[26px] font-medium text-ink-38 w-[30px] text-right">{i + 1}</span>
                <img
                  src="/api/avatars/{entry.avatarId}/monogram.svg?name={encodeURIComponent(entry.nickname)}"
                  alt={entry.nickname}
                  class="w-8 h-8 rounded-full flex-shrink-0"
                />
                <span class="flex-1 text-[29px] font-medium truncate text-ink">{entry.nickname}</span>
                <span class="text-[27px] font-bold text-navy">+{entry.awarded}</span>
              </div>
            {/each}
          </div>

          <div class="pt-4 border-t border-rule">
            <p class="text-[21px] font-medium uppercase tracking-[.2em] text-ink-38">Answered · {answeredCount} of {playerCount}</p>
            <div class="mt-2 h-[6px] rounded-[3px] bg-[rgba(35,32,27,.1)] overflow-hidden">
              <div class="h-full rounded-[3px] bg-navy transition-all" style="width: {playerCount > 0 ? (answeredCount / playerCount) * 100 : 0}%"></div>
            </div>
          </div>
        </div>

        <!-- Persistent join block -->
        <div class="border-t border-rule p-4 flex-shrink-0">
          <div class="flex items-center justify-center gap-4">
            <img
              src="/api/sessions/{code}/qr.svg"
              alt="QR code to join session {code}"
              class="w-[112px] h-[112px] rounded-[10px] border border-rule bg-paper-2 p-1"
            />
            <div class="text-center">
              <p class="text-[24px] font-semibold uppercase tracking-[.1em] text-ink-38">JOIN AT QUIZ.LOCAL</p>
              <p class="text-[42px] font-medium tracking-[.14em] text-ink mt-1">{code}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="col-span-2 row-span-1 bg-paper-2 border-t border-rule flex items-center justify-between px-[56px] py-4">
        <div class="flex items-center gap-3">
          <button type="button" class="px-4 py-2 text-sm font-medium text-ink-60 hover:text-ink transition-colors min-h-[44px]">Pause</button>
          <button type="button" class="px-4 py-2 text-sm font-medium text-ink-60 hover:text-ink transition-colors min-h-[44px]">Skip</button>
        </div>
        <button
          type="button"
          onclick={advance}
          disabled={advancing}
          class="bg-navy text-paper px-6 py-3 rounded-[6px] font-bold text-[25px] min-h-[44px] disabled:opacity-40 hover:bg-navy/90 transition-colors"
        >
          {advancing ? "Loading…" : "Reveal answer →"}
        </button>
      </div>
    </div>

  {:else if $hostStore.state === "reveal" && $hostStore.revealData && $hostStore.currentQuestion}
    {@const r = $hostStore.revealData}
    {@const q = $hostStore.currentQuestion}
    <div class="grid grid-cols-[1fr_400px] grid-rows-[112px_1fr_92px] min-h-[calc(100vh-142px)]">
      <!-- Left column: Header + Main -->
      <div class="col-span-1 row-span-2 flex flex-col min-h-0">
        <!-- Header row -->
        <div class="flex items-center justify-between px-[56px] py-4 flex-shrink-0">
          <p class="text-[31px] font-semibold uppercase tracking-[.1em] text-ink-38">Question {q.index + 1} of {q.total}</p>
          <span class="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full border border-[rgba(63,98,18,.4)] text-vine">
            {r.answeredCount} correct · {r.playerCount - r.answeredCount} missed
          </span>
        </div>

        <!-- Main content -->
        <div class="flex-1 flex flex-col lg:flex-row gap-6 p-[56px] min-h-0 overflow-hidden">
          <div class="flex-1 space-y-4 overflow-y-auto">
            <!-- Answer grid - fixed 300px row height -->
            <div class="grid grid-cols-2 gap-3 h-[300px] flex-shrink-0">
              {#each q.options as option, i}
                {@const isCorrect = option.id === r.correctOptionId}
                <div
                  class="flex items-center gap-3 px-4 py-4 rounded-[10px] border-2 font-semibold text-[38px] transition-all shadow-hairline
                    {isCorrect
                      ? 'bg-[rgba(63,98,18,.07)] border-vine ring-4 ring-[rgba(63,98,18,.3)] text-vine'
                      : 'opacity-32 bg-paper-2 border-rule text-ink-38'}"
                >
                  <span class="text-[28px] w-[56px] h-[56px] rounded-[8px] flex items-center justify-center text-paper" style="background-color: var(--color-option-{OPTION_COLORS[i].split('-').pop()});" aria-hidden="true">{SHAPES[i]}</span>
                  <span class="flex-1 text-base leading-snug">{option.text}</span>
                  {#if isCorrect}
                    <span class="text-xl">✓</span>
                  {/if}
                </div>
              {/each}
            </div>

            <!-- Verse block -->
            <div class="bg-navy-8 border-t-[2px] border-navy border-b border-[rgba(30,58,95,.2)] rounded-none mx-[-56px] px-[56px] py-[34px_44px] max-h-[50vh] overflow-y-auto" style="max-width: 1220px;">
              <p class="text-[26px] font-semibold uppercase tracking-[.18em] text-navy mb-2">
                {r.references.map((ref) => `${ref.book} ${ref.chapter}:${ref.verse_start}${ref.verse_end && ref.verse_end !== ref.verse_start ? '–' + ref.verse_end : ''}`).join("; ")} · {r.translation}
              </p>
              {#if r.verseText}
                <p class="text-[41px] leading-[1.38] italic text-navy whitespace-pre-line">{r.verseText}</p>
              {/if}
            </div>
          </div>

          <div class="lg:w-[300px] space-y-3">
            <h3 class="text-[21px] font-semibold uppercase tracking-[.2em] text-ink-38">Top 5</h3>
            {#each r.perQuestionTop5 as entry, i}
              <div class="bg-paper-2 rounded-[10px] px-4 py-3 flex items-center gap-3 {i === 0 ? 'bg-navy-8' : ''}">
                <span class="text-[26px] font-bold {i === 0 ? 'text-navy' : 'text-ink-38'} w-[30px] text-right">{i + 1}</span>
                <img
                  src="/api/avatars/{entry.avatarId}/monogram.svg?name={encodeURIComponent(entry.nickname)}"
                  alt={entry.nickname}
                  class="w-8 h-8 rounded-full flex-shrink-0"
                />
                <span class="flex-1 text-[29px] font-medium truncate text-ink">{entry.nickname}</span>
                <span class="text-[27px] font-bold text-navy">+{entry.awarded}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <!-- Right rail -->
      <div class="col-span-1 row-span-3 bg-[rgba(35,32,27,.018)] border-l border-rule flex flex-col">
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          <p class="text-[21px] font-semibold uppercase tracking-[.2em] text-ink-38">Top 5</p>
          <div class="space-y-3">
            {#each r.perQuestionTop5 as entry, i}
              <div class="bg-paper-2 rounded-[10px] px-4 py-3 flex items-center gap-3 {i === 0 ? 'bg-navy-8' : ''}">
                <span class="text-[26px] font-bold {i === 0 ? 'text-navy' : 'text-ink-38'} w-[30px] text-right">{i + 1}</span>
                <img
                  src="/api/avatars/{entry.avatarId}/monogram.svg?name={encodeURIComponent(entry.nickname)}"
                  alt={entry.nickname}
                  class="w-8 h-8 rounded-full flex-shrink-0"
                />
                <span class="flex-1 text-[29px] font-medium truncate text-ink">{entry.nickname}</span>
                <span class="text-[27px] font-bold text-navy">+{entry.awarded}</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- Persistent join block -->
        <div class="border-t border-rule p-4 flex-shrink-0">
          <div class="flex items-center justify-center gap-4">
            <img
              src="/api/sessions/{code}/qr.svg"
              alt="QR code to join session {code}"
              class="w-[112px] h-[112px] rounded-[10px] border border-rule bg-paper-2 p-1"
            />
            <div class="text-center">
              <p class="text-[24px] font-semibold uppercase tracking-[.1em] text-ink-38">JOIN AT QUIZ.LOCAL</p>
              <p class="text-[42px] font-medium tracking-[.14em] text-ink mt-1">{code}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="col-span-2 row-span-1 bg-paper-2 border-t border-rule flex items-center justify-between px-[56px] py-4">
        <div class="flex items-center gap-3">
          <button type="button" class="px-4 py-2 text-sm font-medium text-ink-60 hover:text-ink transition-colors min-h-[44px]">Re-read verse</button>
          <button type="button" class="px-4 py-2 text-sm font-medium text-ink-60 hover:text-ink transition-colors min-h-[44px]">Standings</button>
        </div>
        <button
          type="button"
          onclick={advance}
          disabled={advancing}
          class="bg-navy text-paper px-6 py-3 rounded-[6px] font-bold text-[25px] min-h-[44px] disabled:opacity-40 hover:bg-navy/90 transition-colors"
        >
          {advancing ? "Loading…" : q.index + 1 < q.total ? "Next question →" : "Show final scores →"}
        </button>
      </div>
    </div>

  {:else if $hostStore.state === "final" && $hostStore.finalData}
    {@const f = $hostStore.finalData}
    <div class="grid grid-cols-[1fr_400px] grid-rows-[112px_1fr_92px] min-h-[calc(100vh-142px)]">
      <div class="col-span-1 row-span-2 flex flex-col">
        <div class="flex items-center justify-between px-[56px] py-4">
          <p class="text-[31px] font-semibold uppercase tracking-[.1em] text-ink-38">Final Scores</p>
        </div>

        <div class="flex-1 flex flex-col items-center justify-center px-[56px] gap-8">
          <div class="text-center">
            <h2 class="text-[60px] font-semibold tracking-[-.02em]">Final Scores</h2>
            <p class="text-ink-60 mt-1">{f.questionCount} questions · {f.playerCount} players</p>
          </div>

          <div class="w-full max-w-[1250px] space-y-3">
            {#each f.top10 as entry}
              <div class="bg-paper-2 border border-rule rounded-[10px] px-5 py-4 flex items-center gap-4 {entry.rank === 1 ? 'ring-2 ring-navy' : ''}">
                <span class="text-[27px] font-bold w-[38px] text-center {entry.rank === 1 ? 'text-navy' : entry.rank === 2 ? 'text-ink-38' : entry.rank === 3 ? 'text-bronze' : 'text-ink-60'}">{entry.rank}</span>
                <img
                  src="/api/avatars/{entry.avatarId}/monogram.svg?name={encodeURIComponent(entry.nickname)}"
                  alt={entry.nickname}
                  class="w-10 h-10 rounded-full flex-shrink-0"
                />
                <span class="flex-1 font-semibold text-[29px] truncate text-ink">{entry.nickname}</span>
                <span class="text-[27px] font-bold text-navy">{entry.score}</span>
              </div>
            {/each}
          </div>

          <div class="bg-paper-2 border border-rule rounded-[10px] p-4 space-y-3 w-full max-w-[1250px]">
            <p class="text-sm text-ink-60">Share results</p>
            <div class="flex items-center gap-3">
              <code class="flex-1 text-sm text-navy bg-paper border border-rule rounded-[6px] px-3 py-2 truncate">
                {typeof window !== "undefined" ? window.location.origin : ""}/r/{code}
              </code>
              <button
                type="button"
                onclick={copyShareLink}
                class="px-4 py-2 bg-navy hover:bg-navy/90 text-paper rounded-[6px] text-sm font-medium min-h-[44px] min-w-[44px] transition-colors"
              >
                {copyDone ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>

          <div class="flex gap-3 w-full max-w-[1250px]">
            <a
              href="/host"
              class="flex-1 text-center py-4 bg-paper-2 hover:bg-paper text-ink font-semibold rounded-[10px] min-h-[52px] border border-rule transition-colors"
            >
              New session
            </a>
            <button
              type="button"
              onclick={endSession}
              class="flex-1 py-4 bg-clay hover:bg-clay/90 text-paper font-semibold rounded-[10px] min-h-[52px] transition-colors"
            >
              End session
            </button>
          </div>
        </div>
      </div>

      <!-- Right rail with persistent join block -->
      <div class="col-span-1 row-span-3 bg-[rgba(35,32,27,.018)] border-l border-rule flex flex-col">
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          <p class="text-[21px] font-semibold uppercase tracking-[.2em] text-ink-38">Final Top 5</p>
          <div class="space-y-3">
            {#each f.top10.slice(0, 5) as entry, i}
              <div class="bg-paper-2 rounded-[10px] px-4 py-3 flex items-center gap-3 {i === 0 ? 'bg-navy-8' : ''}">
                <span class="text-[26px] font-bold {i === 0 ? 'text-navy' : 'text-ink-38'} w-[30px] text-right">{i + 1}</span>
                <img
                  src="/api/avatars/{entry.avatarId}/monogram.svg?name={encodeURIComponent(entry.nickname)}"
                  alt={entry.nickname}
                  class="w-8 h-8 rounded-full flex-shrink-0"
                />
                <span class="flex-1 text-[29px] font-medium truncate text-ink">{entry.nickname}</span>
                <span class="text-[27px] font-bold text-navy">{entry.score}</span>
              </div>
            {/each}
          </div>
        </div>

        <div class="border-t border-rule p-4 flex-shrink-0">
          <div class="flex items-center justify-center gap-4">
            <img
              src="/api/sessions/{code}/qr.svg"
              alt="QR code to join session {code}"
              class="w-[112px] h-[112px] rounded-[10px] border border-rule bg-paper-2 p-1"
            />
            <div class="text-center">
              <p class="text-[24px] font-semibold uppercase tracking-[.1em] text-ink-38">JOIN AT QUIZ.LOCAL</p>
              <p class="text-[42px] font-medium tracking-[.14em] text-ink mt-1">{code}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="col-span-2 row-span-1 bg-paper-2 border-t border-rule px-[56px] py-4"></div>
    </div>

  {:else}
    <div class="flex-1 flex items-center justify-center min-h-[calc(100vh-142px)]">
      <div class="text-center space-y-3">
        <div class="w-10 h-10 border-4 border-navy border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p class="text-ink-60">Connecting to session {code}…</p>
      </div>
    </div>
  {/if}
</div>