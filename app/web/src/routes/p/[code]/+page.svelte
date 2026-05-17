<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/stores";
  import { gameStore } from "$lib/stores/game.js";
  import { connectSocket, getSocket } from "$lib/socket/client.js";
  import { storageGet, storageSet } from "$lib/storage.js";
  import type {
    QuestionPayload,
    RevealPayloadPlayer,
    FinalPayloadPlayer,
    SessionStatePayloadPlayer,
    KickedPayload,
    JoinAck,
    AnswerAck,
  } from "@scripturejam/types";

  let code = $derived($page.params.code ?? "");

  const SHAPES = ["▲", "●", "■", "◆"];
  const SHAPE_LABELS = ["Triangle", "Circle", "Square", "Diamond"];
  const OPTION_COLORS = [
    "bg-red-500 hover:bg-red-600 border-red-700",
    "bg-blue-500 hover:bg-blue-600 border-blue-700",
    "bg-amber-400 hover:bg-amber-500 border-amber-600",
    "bg-green-500 hover:bg-green-600 border-green-700",
  ];
  const OPTION_COLORS_LOCKED = [
    "bg-red-300 border-red-400",
    "bg-blue-300 border-blue-400",
    "bg-amber-200 border-amber-400",
    "bg-green-300 border-green-400",
  ];

  let timerProgress = $state(100);
  let timerRaf = $state<number | null>(null);
  let answerSubmitting = $state(false);
  let kicked = $state(false);
  let kickedReason = $state("");

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
    const socket = connectSocket();

    socket.on("connect", () => {
      gameStore.setConnected(true);
      gameStore.setReconnecting(false);
      const raw = storageGet(`sj_resume_${code}`);
      if (raw) {
        try {
          const resume = JSON.parse(raw) as {
            playerId: string;
            resumeToken: string;
            nickname: string;
            avatarId: string;
          };
          socket.emit(
            "JOIN",
            {
              code,
              nickname: resume.nickname,
              avatarId: resume.avatarId,
              resumeToken: resume.resumeToken,
            },
            (ack: JoinAck) => {
              if (ack.ok) {
                gameStore.setJoined(
                  ack.playerId,
                  resume.nickname,
                  resume.avatarId,
                  ack.resumeToken,
                  code
                );
                storageSet(
                  `sj_resume_${code}`,
                  JSON.stringify({
                    playerId: ack.playerId,
                    resumeToken: ack.resumeToken,
                    nickname: resume.nickname,
                    avatarId: resume.avatarId,
                  })
                );
              }
            }
          );
        } catch {
          // ignore corrupt resume
        }
      }
    });

    socket.on("disconnect", () => {
      gameStore.setConnected(false);
      gameStore.setReconnecting(true);
    });

    socket.on("SESSION_STATE", (payload) => {
      const p = payload as SessionStatePayloadPlayer;
      gameStore.setSessionState(p);
      if (p.state === "question" && p.currentQuestion) {
        const msRemaining = p.msRemaining ?? p.currentQuestion.durationMs;
        const startedAt = Date.now() - (p.currentQuestion.durationMs - msRemaining);
        startTimer(startedAt, p.currentQuestion.durationMs);
      }
    });

    socket.on("QUESTION", (payload: QuestionPayload) => {
      gameStore.setQuestion(payload);
      startTimer(payload.startedAt, payload.durationMs);
    });

    socket.on("REVEAL", (payload) => {
      stopTimer();
      gameStore.setReveal(payload as RevealPayloadPlayer);
    });

    socket.on("FINAL", (payload) => {
      stopTimer();
      gameStore.setFinal(payload as FinalPayloadPlayer);
    });

    socket.on("KICKED", (payload: KickedPayload) => {
      kicked = true;
      kickedReason = payload.reason;
      gameStore.setReconnecting(false);
    });

    if (!socket.connected) {
      socket.connect();
    } else {
      gameStore.setConnected(true);
      const raw = storageGet(`sj_resume_${code}`);
      if (raw) {
        try {
          const resume = JSON.parse(raw) as {
            playerId: string;
            resumeToken: string;
            nickname: string;
            avatarId: string;
          };
          socket.emit(
            "JOIN",
            {
              code,
              nickname: resume.nickname,
              avatarId: resume.avatarId,
              resumeToken: resume.resumeToken,
            },
            (ack: JoinAck) => {
              if (ack.ok) {
                gameStore.setJoined(
                  ack.playerId,
                  resume.nickname,
                  resume.avatarId,
                  ack.resumeToken,
                  code
                );
              }
            }
          );
        } catch {
          // ignore
        }
      }
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
    socket.off("KICKED");
  });

  function submitAnswer(optionId: string) {
    if ($gameStore.yourLocked || answerSubmitting) return;
    const q = $gameStore.currentQuestion;
    if (!q) return;
    answerSubmitting = true;
    const socket = getSocket();
    socket.emit("ANSWER", { questionId: q.questionId, optionId }, (ack: AnswerAck) => {
      answerSubmitting = false;
      if (ack.ok) {
        gameStore.setAnswerLocked(optionId);
      }
    });
  }

  function ordinal(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
  }
</script>

{#if $gameStore.reconnecting}
  <div class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
    <div class="bg-white rounded-2xl p-8 text-center shadow-xl max-w-xs mx-4">
      <p class="text-xl font-bold mb-2">Reconnecting…</p>
      <p class="text-sm text-gray-500">Your score is safe</p>
    </div>
  </div>
{/if}

{#if kicked}
  <main class="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50">
    <div class="max-w-sm w-full text-center space-y-4">
      <div class="text-6xl">🚫</div>
      <h1 class="text-2xl font-bold text-red-700">Removed from session</h1>
      <p class="text-gray-600">{kickedReason || "You were removed from this session."}</p>
      <a href="/" class="inline-block mt-4 px-6 py-3 bg-gray-800 text-white rounded-lg font-semibold min-h-[44px]">
        Go home
      </a>
    </div>
  </main>
{:else if $gameStore.sessionState === "lobby"}
  <main class="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-b from-blue-600 to-blue-800 text-white">
    <div class="max-w-sm w-full text-center space-y-6">
      {#if $gameStore.avatarId}
        <img
          src="/api/avatars/{$gameStore.avatarId}/monogram.svg?name={encodeURIComponent($gameStore.nickname ?? '')}"
          alt={$gameStore.nickname ?? "You"}
          class="w-24 h-24 rounded-full mx-auto ring-4 ring-white/40"
        />
      {:else}
        <div class="w-24 h-24 rounded-full bg-blue-500 mx-auto ring-4 ring-white/40"></div>
      {/if}
      <div>
        <p class="text-2xl font-bold">{$gameStore.nickname ?? "Player"}</p>
        <p class="text-blue-200 text-sm mt-1">You're in!</p>
      </div>
      <div class="bg-blue-700/50 rounded-2xl p-6">
        <p class="text-lg font-semibold animate-pulse">Waiting for host to start…</p>
        <p class="text-blue-200 text-sm mt-2">Get ready for the quiz</p>
      </div>
    </div>
  </main>
{:else if $gameStore.sessionState === "question" && $gameStore.currentQuestion}
  {@const q = $gameStore.currentQuestion}
  <main class="min-h-screen flex flex-col bg-gray-900 text-white">
    <div class="px-4 pt-4 pb-2">
      <div class="flex items-center justify-between text-sm text-gray-400 mb-2">
        <span>Question {q.index + 1} / {q.total}</span>
        <span class="font-mono">{$gameStore.yourLocked ? "Locked in ✓" : ""}</span>
      </div>
      <div class="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
        <div
          class="h-full rounded-full transition-none {timerProgress > 30 ? 'bg-green-400' : timerProgress > 10 ? 'bg-amber-400' : 'bg-red-500'}"
          style="width: {timerProgress}%"
        ></div>
      </div>
    </div>

    <div class="flex-1 flex flex-col px-4 pb-4">
      <div class="flex-1 flex items-center justify-center py-6">
        <p class="text-xl font-semibold text-center leading-relaxed max-w-sm">{q.prompt}</p>
      </div>

      <div class="grid grid-cols-1 gap-3 max-w-sm mx-auto w-full">
        {#each q.options as option, i}
          {@const locked = $gameStore.yourLocked}
          {@const isPick = $gameStore.yourPick === option.id}
          <button
            type="button"
            onclick={() => submitAnswer(option.id)}
            disabled={locked || answerSubmitting}
            class="
              flex items-center gap-3 px-4 py-3 rounded-xl border-2 font-semibold text-white
              min-h-[56px] transition-all active:scale-95
              {locked
                ? isPick
                  ? OPTION_COLORS_LOCKED[i] + ' ring-4 ring-white/60 scale-95'
                  : 'bg-gray-700 border-gray-600 opacity-40'
                : OPTION_COLORS[i]}
            "
            aria-label="{SHAPE_LABELS[i]}: {option.text}"
          >
            <span class="text-2xl w-8 text-center flex-shrink-0" aria-hidden="true">{SHAPES[i]}</span>
            <span class="flex-1 text-left text-sm leading-snug">{option.text}</span>
          </button>
        {/each}
      </div>

      {#if $gameStore.yourLocked}
        <p class="text-center text-green-400 text-sm font-medium mt-4">Answer locked in — waiting for reveal</p>
      {/if}
    </div>
  </main>
{:else if $gameStore.sessionState === "reveal" && $gameStore.revealData}
  {@const r = $gameStore.revealData}
  {@const q = $gameStore.currentQuestion}
  <main class="min-h-screen flex flex-col bg-gray-900 text-white px-4 py-6">
    <div class="max-w-sm mx-auto w-full space-y-5">
      <div class="rounded-2xl p-6 text-center {r.yourCorrect ? 'bg-green-600' : 'bg-red-600'}">
        <p class="text-4xl mb-2">{r.yourCorrect ? "✓" : "✗"}</p>
        <p class="text-2xl font-bold">{r.yourCorrect ? "Correct!" : "Wrong"}</p>
        {#if r.yourAwarded > 0}
          <p class="text-lg mt-1">+{r.yourAwarded} points</p>
        {/if}
      </div>

      {#if q}
        {@const correctOpt = q.options.find((o) => o.id === r.correctOptionId)}
        {#if correctOpt}
          <div class="bg-gray-800 rounded-xl p-4">
            <p class="text-xs text-gray-400 uppercase tracking-wide mb-1">Correct answer</p>
            <p class="font-semibold">{correctOpt.text}</p>
          </div>
        {/if}
      {/if}

      {#if r.verseText}
        <div class="bg-blue-900/60 rounded-xl p-4 space-y-2">
          <p class="text-xs text-blue-300 uppercase tracking-wide">
            {r.references.map((ref) => `${ref.book} ${ref.chapter}:${ref.verse_start}${ref.verse_end && ref.verse_end !== ref.verse_start ? '–' + ref.verse_end : ''}`).join("; ")}
            — {r.translation}
          </p>
          <p class="text-sm leading-relaxed italic">{r.verseText}</p>
        </div>
      {/if}

      <div class="bg-gray-800 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p class="text-xs text-gray-400">Your rank</p>
          <p class="text-2xl font-bold">{ordinal(r.yourRank)}</p>
          <p class="text-xs text-gray-400">of {r.totalPlayers}</p>
        </div>
        <div class="text-right">
          <p class="text-xs text-gray-400">Score</p>
          <p class="text-2xl font-bold">{r.yourCumulative}</p>
        </div>
      </div>
    </div>
  </main>
{:else if $gameStore.sessionState === "final" && $gameStore.finalData}
  {@const f = $gameStore.finalData}
  <main class="min-h-screen flex flex-col bg-gradient-to-b from-purple-700 to-purple-900 text-white px-4 py-8">
    <div class="max-w-sm mx-auto w-full space-y-6 text-center">
      <div>
        <p class="text-5xl mb-3">🏆</p>
        <h1 class="text-3xl font-bold">Quiz complete!</h1>
      </div>

      <div class="bg-white/20 rounded-2xl p-6 space-y-2">
        <p class="text-5xl font-black">{ordinal(f.yourFinalRank)}</p>
        <p class="text-purple-200">of {f.totalPlayers} players</p>
        <div class="border-t border-white/20 pt-3 mt-3">
          <p class="text-2xl font-bold">{f.yourFinalScore} pts</p>
          <p class="text-purple-200 text-sm">{f.yourAnsweredCorrect} correct answers</p>
        </div>
      </div>

      <a
        href="/r/{code}"
        class="block w-full bg-white text-purple-800 font-bold rounded-xl px-4 py-4 min-h-[44px] hover:bg-purple-100 transition-colors"
      >
        Open scoreboard →
      </a>
    </div>
  </main>
{:else}
  <main class="min-h-screen flex flex-col items-center justify-center p-6 bg-gray-900 text-white">
    <div class="text-center space-y-3">
      <div class="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
      <p class="text-gray-300">Connecting…</p>
    </div>
  </main>
{/if}
