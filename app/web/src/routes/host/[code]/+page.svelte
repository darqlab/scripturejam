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
  const OPTION_BG = ["bg-red-500", "bg-blue-500", "bg-amber-400", "bg-green-500"];

  let timerProgress = $state(100);
  let timerRaf = $state<number | null>(null);
  let starting = $state(false);
  let startError = $state<string | null>(null);
  let advancing = $state(false);
  let copyDone = $state(false);

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
        const body = await res.json().catch(() => ({}));
        startError = (body as { message?: string }).message ?? "Failed to start quiz";
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
</script>

<div class="min-h-screen bg-gray-950 text-white">
  <header class="flex items-center justify-between px-6 py-4 bg-gray-900 border-b border-gray-800">
    <div class="flex items-center gap-3">
      <h1 class="text-xl font-bold text-blue-400">scripturejam</h1>
      <span class="text-gray-500 text-sm">host</span>
    </div>
    <div class="flex items-center gap-3">
      <span
        class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full {$hostStore.connected ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}"
      >
        <span class="w-1.5 h-1.5 rounded-full {$hostStore.connected ? 'bg-green-400' : 'bg-red-400'}"></span>
        {$hostStore.connected ? "Connected" : "Offline"}
      </span>
      <span class="font-mono text-gray-400 text-sm">Session {code}</span>
    </div>
  </header>

  {#if $hostStore.state === null || $hostStore.state === "lobby"}
    <div class="flex flex-col lg:flex-row min-h-[calc(100vh-65px)]">
      <div class="lg:w-80 bg-gray-900 border-r border-gray-800 p-6 flex flex-col gap-6">
        <div class="text-center">
          <img
            src="/api/sessions/{code}/qr.svg"
            alt="QR code to join session {code}"
            class="w-56 h-56 mx-auto rounded-xl bg-white p-1"
          />
          <div class="mt-4">
            <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">Join at</p>
            <p class="text-sm text-gray-300">{typeof window !== "undefined" ? window.location.origin : ""}/j/{code}</p>
          </div>
        </div>

        <div class="text-center bg-gray-800 rounded-xl p-5">
          <p class="text-xs text-gray-400 uppercase tracking-wide mb-2">Session code</p>
          <p class="text-6xl font-black font-mono tracking-widest text-white">{code}</p>
        </div>

        <div class="text-center text-sm text-gray-400">
          <span class="text-2xl font-bold text-white">{visiblePlayers.length}</span> player{visiblePlayers.length === 1 ? "" : "s"} joined
        </div>

        {#if startError}
          <p class="text-red-400 text-sm" role="alert">{startError}</p>
        {/if}

        <button
          type="button"
          onclick={startQuiz}
          disabled={starting || visiblePlayers.length === 0}
          class="w-full bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-bold py-4 rounded-xl text-lg min-h-[52px] transition-colors"
        >
          {starting ? "Starting…" : "Start quiz ▶"}
        </button>
        {#if visiblePlayers.length === 0}
          <p class="text-xs text-gray-500 text-center">Waiting for players to join…</p>
        {/if}
      </div>

      <div class="flex-1 p-6">
        <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
          Players ({visiblePlayers.length})
        </h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {#each $hostStore.players as player (player.playerId)}
            {#if player.status !== "disconnected"}
              <div class="bg-gray-800 rounded-xl p-3 flex flex-col items-center gap-2 relative group">
                <img
                  src="/api/avatars/{player.avatarId}/monogram.svg?name={encodeURIComponent(player.nickname)}"
                  alt={player.nickname}
                  class="w-12 h-12 rounded-full"
                />
                <p class="text-sm font-medium text-center leading-tight truncate w-full text-center">
                  {player.nickname}
                </p>
                <button
                  type="button"
                  onclick={() => kickPlayer(player.playerId)}
                  class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  aria-label="Kick {player.nickname}"
                  title="Remove player"
                >
                  ✕
                </button>
              </div>
            {/if}
          {/each}
        </div>
      </div>
    </div>

  {:else if $hostStore.state === "question" && $hostStore.currentQuestion}
    {@const q = $hostStore.currentQuestion}
    <div class="flex flex-col min-h-[calc(100vh-65px)]">
      <div class="px-6 py-4 bg-gray-900 border-b border-gray-800">
        <div class="flex items-center justify-between text-sm text-gray-400 mb-2">
          <span>Question {q.index + 1} of {q.total}</span>
          <span>{$hostStore.players.length} players</span>
        </div>
        <div class="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
          <div
            class="h-full rounded-full transition-none {timerProgress > 30 ? 'bg-green-500' : timerProgress > 10 ? 'bg-amber-400' : 'bg-red-500'}"
            style="width: {timerProgress}%"
          ></div>
        </div>
      </div>

      <div class="flex-1 flex flex-col items-center justify-center px-6 py-8 gap-8">
        <p class="text-3xl font-bold text-center max-w-2xl leading-snug">{q.prompt}</p>

        <div class="grid grid-cols-2 gap-4 w-full max-w-2xl">
          {#each q.options as option, i}
            <div class="flex items-center gap-3 px-5 py-4 rounded-xl {OPTION_BG[i]} font-semibold text-white text-lg">
              <span class="text-2xl" aria-hidden="true">{SHAPES[i]}</span>
              <span class="flex-1 text-base leading-snug">{option.text}</span>
            </div>
          {/each}
        </div>

        <p class="text-gray-500 text-sm">Waiting for answers…</p>
      </div>
    </div>

  {:else if $hostStore.state === "reveal" && $hostStore.revealData && $hostStore.currentQuestion}
    {@const r = $hostStore.revealData}
    {@const q = $hostStore.currentQuestion}
    <div class="flex flex-col min-h-[calc(100vh-65px)]">
      <div class="px-6 py-5 bg-gray-900 border-b border-gray-800 flex items-center justify-between">
        <div>
          <p class="text-sm text-gray-400">Question {q.index + 1} of {q.total}</p>
          <p class="text-gray-300 text-sm mt-0.5">{r.answeredCount} / {r.playerCount} answered</p>
        </div>
        <button
          type="button"
          onclick={advance}
          disabled={advancing}
          class="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold px-6 py-3 rounded-xl min-h-[44px] transition-colors"
        >
          {advancing ? "Loading…" : q.index + 1 < q.total ? "Next question →" : "Show final scores →"}
        </button>
      </div>

      <div class="flex-1 flex flex-col lg:flex-row gap-6 p-6">
        <div class="flex-1 space-y-4">
          <div class="grid grid-cols-2 gap-3">
            {#each q.options as option, i}
              {@const isCorrect = option.id === r.correctOptionId}
              <div
                class="flex items-center gap-3 px-4 py-4 rounded-xl border-2 font-semibold text-lg transition-all
                  {isCorrect
                    ? OPTION_BG[i] + ' border-white ring-4 ring-white/30 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400'}"
              >
                <span class="text-2xl" aria-hidden="true">{SHAPES[i]}</span>
                <span class="flex-1 text-base leading-snug">{option.text}</span>
                {#if isCorrect}
                  <span class="text-xl">✓</span>
                {/if}
              </div>
            {/each}
          </div>

          <div class="bg-blue-950/60 border border-blue-800/40 rounded-xl p-4 space-y-1">
            <p class="text-xs text-blue-300 uppercase tracking-wide font-medium">
              {r.references.map((ref) => `${ref.book} ${ref.chapter}:${ref.verse_start}${ref.verse_end && ref.verse_end !== ref.verse_start ? '–' + ref.verse_end : ''}`).join("; ")}
            </p>
          </div>
        </div>

        <div class="lg:w-72 space-y-3">
          <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide">Top 5 this round</h3>
          {#each r.perQuestionTop5 as entry, i}
            <div class="bg-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">
              <span class="text-lg font-bold text-gray-400 w-6">{i + 1}</span>
              <img
                src="/api/avatars/{entry.avatarId}/monogram.svg?name={encodeURIComponent(entry.nickname)}"
                alt={entry.nickname}
                class="w-8 h-8 rounded-full flex-shrink-0"
              />
              <span class="flex-1 text-sm font-medium truncate">{entry.nickname}</span>
              <span class="text-green-400 font-bold text-sm">+{entry.awarded}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>

  {:else if $hostStore.state === "final" && $hostStore.finalData}
    {@const f = $hostStore.finalData}
    <div class="flex flex-col min-h-[calc(100vh-65px)] p-6">
      <div class="max-w-2xl mx-auto w-full space-y-6">
        <div class="text-center">
          <h2 class="text-4xl font-black">Final Scores</h2>
          <p class="text-gray-400 mt-1">{f.questionCount} questions · {f.playerCount} players</p>
        </div>

        <div class="space-y-2">
          {#each f.top10 as entry}
            <div
              class="flex items-center gap-4 bg-gray-800 rounded-xl px-5 py-4 {entry.rank === 1 ? 'ring-2 ring-yellow-400' : ''}"
            >
              <span class="text-2xl font-black w-8 text-center {entry.rank === 1 ? 'text-yellow-400' : entry.rank === 2 ? 'text-gray-300' : entry.rank === 3 ? 'text-amber-600' : 'text-gray-500'}">
                {entry.rank}
              </span>
              <img
                src="/api/avatars/{entry.avatarId}/monogram.svg?name={encodeURIComponent(entry.nickname)}"
                alt={entry.nickname}
                class="w-10 h-10 rounded-full flex-shrink-0"
              />
              <span class="flex-1 font-semibold text-lg truncate">{entry.nickname}</span>
              <span class="text-xl font-bold text-green-400">{entry.score}</span>
            </div>
          {/each}
        </div>

        <div class="bg-gray-800 rounded-xl p-4 space-y-3">
          <p class="text-sm text-gray-400">Share results</p>
          <div class="flex items-center gap-3">
            <code class="flex-1 text-sm text-blue-300 bg-gray-900 rounded-lg px-3 py-2 truncate">
              {typeof window !== "undefined" ? window.location.origin : ""}/r/{code}
            </code>
            <button
              type="button"
              onclick={copyShareLink}
              class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium min-h-[44px] min-w-[44px] transition-colors"
            >
              {copyDone ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>

        <div class="flex gap-3">
          <a
            href="/host"
            class="flex-1 text-center py-4 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl min-h-[52px] transition-colors"
          >
            New session
          </a>
          <button
            type="button"
            onclick={endSession}
            class="flex-1 py-4 bg-red-700 hover:bg-red-600 text-white font-semibold rounded-xl min-h-[52px] transition-colors"
          >
            End session
          </button>
        </div>
      </div>
    </div>

  {:else}
    <div class="flex-1 flex items-center justify-center min-h-[calc(100vh-65px)]">
      <div class="text-center space-y-3">
        <div class="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p class="text-gray-400">Connecting to session {code}…</p>
      </div>
    </div>
  {/if}
</div>
