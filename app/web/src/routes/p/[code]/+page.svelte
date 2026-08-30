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
  // Keys map to CSS custom properties --color-option-{a,b,c,d} (a=navy/▲, b=clay/●, c=bronze/■, d=vine/◆)
  const OPTION_KEYS = ["a", "b", "c", "d"] as const;

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
  <div class="fixed inset-0 z-50 bg-[rgba(35,32,27,.55)] flex items-center justify-center">
    <div class="bg-paper rounded-[16px] p-[30px_34px] text-center shadow-xl max-w-[280px] mx-4">
      <p class="text-[30px] font-semibold mb-2 text-ink">Reconnecting…</p>
      <p class="text-[20px] text-ink-60">Your score is safe</p>
    </div>
  </div>
{/if}

{#if kicked}
  <main class="min-h-screen flex flex-col items-center justify-center p-6 bg-[rgba(154,52,18,.1)]">
    <div class="max-w-sm w-full text-center space-y-4">
      <div class="text-6xl">✕</div>
      <h1 class="text-2xl font-bold text-clay">Removed from session</h1>
      <p class="text-ink-60">{kickedReason || "You were removed from this session."}</p>
      <a href="/" class="inline-block mt-4 px-6 py-3 bg-navy text-paper rounded-[10px] font-semibold min-h-[44px] hover:bg-navy/90 transition-colors">
        Go home
      </a>
    </div>
  </main>
{:else if $gameStore.sessionState === "lobby"}
  <main class="min-h-screen flex flex-col items-center justify-center p-6 bg-paper text-ink">
    <div class="max-w-sm w-full text-center space-y-6">
      {#if $gameStore.avatarId}
        <img
          src="/api/avatars/{$gameStore.avatarId}/monogram.svg?name={encodeURIComponent($gameStore.nickname ?? '')}"
          alt={$gameStore.nickname ?? "You"}
          class="w-24 h-24 rounded-full mx-auto ring-4 ring-navy-8"
        />
      {:else}
        <div class="w-24 h-24 rounded-full bg-navy-8 mx-auto ring-4 ring-navy-8"></div>
      {/if}
      <div>
        <p class="text-2xl font-bold text-ink">{$gameStore.nickname ?? "Player"}</p>
        <p class="text-ink-60 text-sm mt-1">You're in!</p>
      </div>
      <div class="bg-navy-8 rounded-[10px] p-6 border border-[rgba(30,58,95,.2)]">
        <p class="text-lg font-semibold text-navy animate-pulse">Waiting for host to start…</p>
        <p class="text-ink-60 text-sm mt-2">Get ready for the quiz</p>
      </div>
    </div>
  </main>
{:else if $gameStore.sessionState === "question" && $gameStore.currentQuestion}
  {@const q = $gameStore.currentQuestion}
  <main class="min-h-screen flex flex-col bg-paper text-ink">
    <div class="px-[18px] pt-4 pb-2">
      <div class="flex items-center justify-between text-sm text-ink-60 mb-2">
        <span class="font-medium">Question {q.index + 1} / {q.total}</span>
        <span class="font-mono text-vine font-medium">{$gameStore.yourLocked ? "Locked in ✓" : ""}</span>
      </div>
      <div class="w-full bg-[rgba(35,32,27,.12)] rounded-full h-[11px] overflow-hidden">
        <div
          class="h-full rounded-full transition-none bg-vine"
          style="width: {timerProgress}%"
        ></div>
      </div>
    </div>

    <div class="flex-1 flex flex-col px-[16px] pb-4 justify-center">
      <p class="text-center text-ink-38 text-sm mb-6">Look at the host screen for the question</p>

      <div class="grid grid-cols-2 gap-3 max-w-sm mx-auto w-full">
        {#each q.options as option, i}
          {@const locked = $gameStore.yourLocked}
          {@const isPick = $gameStore.yourPick === option.id}
          <button
            type="button"
            onclick={() => submitAnswer(option.id)}
            disabled={locked || answerSubmitting}
            style="background-color: var(--color-option-{OPTION_KEYS[i]})"
            class="
              flex items-center justify-center px-4 py-3 rounded-[18px] border-2 border-[rgba(35,32,27,.18)] font-semibold text-paper
              min-h-[170px] transition-all active:scale-[.95]
              {!locked ? 'hover:brightness-90' : ''}
              {locked && isPick ? 'ring-4 ring-[rgba(246,242,232,.9)] ring-offset-2 ring-offset-[rgba(35,32,27,.18)] scale-[.95]' : ''}
              {locked && !isPick ? 'opacity-35' : ''}
            "
            aria-label="{SHAPE_LABELS[i]}: {option.text}"
          >
            <span class="text-[58px] w-[72px] text-center flex-shrink-0" aria-hidden="true">{SHAPES[i]}</span>
          </button>
        {/each}
      </div>

      {#if $gameStore.yourLocked}
        <p class="text-center text-vine text-sm font-medium mt-4">Answer locked in — waiting for reveal</p>
      {/if}
    </div>

    <footer class="px-[18px] pt-4 border-t border-rule">
      <p class="text-center text-[19px] text-ink-38">Answers are on the big screen</p>
    </footer>
  </main>
{:else if $gameStore.sessionState === "reveal" && $gameStore.revealData}
  {@const r = $gameStore.revealData}
  <main class="min-h-screen flex flex-col bg-paper text-ink px-[18px] py-6">
    <div class="max-w-sm mx-auto w-full space-y-5">
      <div class="rounded-[18px] p-[28px_20px] text-center {r.yourCorrect ? 'bg-vine' : 'bg-clay'} text-paper">
        <p class="text-[46px] mb-2">{r.yourCorrect ? "✓" : "✗"}</p>
        <p class="text-[38px] font-bold">{r.yourCorrect ? "Correct!" : "Wrong"}</p>
        {#if r.yourAwarded > 0}
          <p class="text-[24px] mt-1 opacity-90">+{r.yourAwarded} points</p>
        {/if}
      </div>

      <p class="text-center text-ink-38 text-sm">See the host screen for the correct answer and scripture</p>

      <div class="bg-paper-2 rounded-[14px] border border-rule p-4 flex items-center justify-between">
        <div>
          <p class="text-xs text-ink-38 uppercase tracking-wide">Your rank</p>
          <p class="text-[34px] font-bold text-ink">{ordinal(r.yourRank)}</p>
          <p class="text-xs text-ink-38">of {r.totalPlayers}</p>
        </div>
        <div class="text-right">
          <p class="text-xs text-ink-38 uppercase tracking-wide">Score</p>
          <p class="text-[34px] font-bold text-navy">{r.yourCumulative}</p>
        </div>
      </div>
    </div>
  </main>
{:else if $gameStore.sessionState === "final" && $gameStore.finalData}
  {@const f = $gameStore.finalData}
  <main class="min-h-screen flex flex-col bg-[linear-gradient(180deg,var(--navy),#1a2d4a)] text-paper px-4 py-8">
    <div class="max-w-sm mx-auto w-full space-y-6 text-center">
      <div>
        <p class="text-5xl mb-3">🏆</p>
        <h1 class="text-3xl font-bold">Quiz complete!</h1>
      </div>

      <div class="bg-white/10 rounded-[18px] p-6 space-y-2 border border-white/10">
        <p class="text-5xl font-black">{ordinal(f.yourFinalRank)}</p>
        <p class="text-white/70">of {f.totalPlayers} players</p>
        <div class="border-t border-white/20 pt-3 mt-3">
          <p class="text-2xl font-bold">{f.yourFinalScore} pts</p>
          <p class="text-white/70 text-sm">{f.yourAnsweredCorrect} correct answers</p>
        </div>
      </div>

      <a
        href="/r/{code}"
        class="block w-full bg-paper text-navy font-bold rounded-[18px] px-4 py-4 min-h-[44px] hover:bg-paper/90 transition-colors"
      >
        Open scoreboard →
      </a>
    </div>
  </main>
{:else}
  <main class="min-h-screen flex flex-col items-center justify-center p-6 bg-paper text-ink">
    <div class="text-center space-y-3">
      <div class="w-10 h-10 border-4 border-navy border-t-transparent rounded-full animate-spin mx-auto"></div>
      <p class="text-ink-60">Connecting…</p>
    </div>
  </main>
{/if}