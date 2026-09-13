<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/stores";
  import { gameStore } from "$lib/stores/game.js";
  import { connectSocket, getSocket } from "$lib/socket/client.js";
  import { storageGet, storageSet } from "$lib/storage.js";
  import Stage from "$lib/components/Stage.svelte";
  import ConnectionPill from "$lib/components/ConnectionPill.svelte";
  import TimerBar from "$lib/components/TimerBar.svelte";
  import AnswerGrid from "$lib/components/AnswerGrid.svelte";
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

  // Reveal count-up (points then cumulative score), matching the host reveal easing.
  let ptsShown = $state(0);
  let scoreShown = $state(0);
  let revealCountKey = $state<string | null>(null);

  $effect(() => {
    const r = $gameStore.revealData;
    if (!r) {
      revealCountKey = null;
      return;
    }
    const key = `${r.yourRank}:${r.yourAwarded}:${r.yourCumulative}`;
    if (revealCountKey === key) return;
    revealCountKey = key;
    ptsShown = 0;
    scoreShown = 0;

    function countUp(target: number, dur: number, set: (v: number) => void) {
      const start = performance.now();
      function step(now: number) {
        const p = Math.min((now - start) / dur, 1);
        set(Math.round(target * p));
        if (p < 1) requestAnimationFrame(step);
        else set(target);
      }
      requestAnimationFrame(step);
    }

    const t1 = setTimeout(() => {
      countUp(r.yourAwarded, 900, (v) => (ptsShown = v));
      const t2 = setTimeout(() => countUp(r.yourCumulative, 900, (v) => (scoreShown = v)), 450);
      return () => clearTimeout(t2);
    }, 400);
    return () => clearTimeout(t1);
  });
</script>

{#if $gameStore.reconnecting}
  <div class="overlay" role="alert">
    <div class="overlay-card card">
      <p class="overlay-title">Reconnecting…</p>
      <p class="overlay-sub">Your score is safe</p>
    </div>
  </div>
{/if}

{#if kicked}
  <Stage confetti={false}>
    {#snippet meta()}
      <ConnectionPill connected={false} label="Removed" />
    {/snippet}
    <div class="center-main">
      <div class="card kicked-card">
        <div class="glyph" aria-hidden="true">✕</div>
        <h1>Removed from session</h1>
        <p class="muted">{kickedReason || "You were removed from this session."}</p>
        <a href="/" class="btn-primary">Go home</a>
      </div>
    </div>
  </Stage>
{:else if $gameStore.sessionState === "lobby"}
  <Stage>
    {#snippet meta()}
      <ConnectionPill connected={$gameStore.connected} label="In lobby" />
    {/snippet}
    <div class="center-main">
      <div class="card lobby-card">
        <div class="avatar">
          {#if $gameStore.avatarId}
            <img
              src="/api/avatars/{$gameStore.avatarId}/monogram.svg?name={encodeURIComponent($gameStore.nickname ?? '')}"
              alt={$gameStore.nickname ?? "You"}
            />
          {/if}
        </div>
        <div>
          <div class="name">{$gameStore.nickname ?? "Player"}</div>
          <div class="in">You're in!</div>
        </div>
        <div class="waiting">
          <div class="msg">Waiting for host to start…</div>
          <div class="sub">Get ready for the quiz</div>
        </div>
      </div>
    </div>
  </Stage>
{:else if $gameStore.sessionState === "question" && $gameStore.currentQuestion}
  {@const q = $gameStore.currentQuestion}
  <Stage confetti={false}>
    {#snippet meta()}
      <span class="pill">Question {q.index + 1} / {q.total}</span>
      {#if $gameStore.yourLocked}
        <span class="pill locked-pill">Locked in ✓</span>
      {/if}
    {/snippet}

    <div class="question-main">
      <TimerBar progress={timerProgress} />
      <div class="answers-fill">
        <AnswerGrid
          options={q.options}
          variant="player"
          picked={$gameStore.yourPick ?? null}
          disabled={$gameStore.yourLocked || answerSubmitting}
          onpick={submitAnswer}
        />
      </div>
    </div>
  </Stage>
{:else if $gameStore.sessionState === "reveal" && $gameStore.revealData}
  {@const r = $gameStore.revealData}
  <Stage confetti={false}>
    {#snippet meta()}
      {#if $gameStore.currentQuestion}
        <span class="pill">Question {$gameStore.currentQuestion.index + 1} / {$gameStore.currentQuestion.total}</span>
      {/if}
    {/snippet}

    <div class="reveal-main">
      <div class="reveal-card">
        <div class="correct" class:is-wrong={!r.yourCorrect}>
          <div class="check">{r.yourCorrect ? "✓" : "✗"}</div>
          <div class="label">{r.yourCorrect ? "Correct!" : "Wrong"}</div>
          {#if r.yourAwarded > 0}
            <div class="pts">+{ptsShown.toLocaleString()} points</div>
          {/if}
        </div>

        <p class="hint">See the host screen for the correct answer and scripture</p>

        <div class="summary">
          <div class="col">
            <div class="col-label">Your rank</div>
            <div class="col-value">{ordinal(r.yourRank)}</div>
            <div class="col-of">of {r.totalPlayers}</div>
          </div>
          <div class="col right">
            <div class="col-label">Score</div>
            <div class="col-value">{scoreShown.toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
  </Stage>
{:else if $gameStore.sessionState === "final" && $gameStore.finalData}
  {@const f = $gameStore.finalData}
  <Stage>
    {#snippet meta()}
      <span class="pill">Finished</span>
    {/snippet}
    <div class="center-main">
      <div class="card final-card">
        <div class="trophy" aria-hidden="true">🏆</div>
        <h1>Quiz complete!</h1>

        <div class="result">
          <div class="place">{ordinal(f.yourFinalRank)}</div>
          <div class="of">of {f.totalPlayers} players</div>
          <div class="divider"></div>
          <div class="pts">{f.yourFinalScore} pts</div>
          <div class="answers">{f.yourAnsweredCorrect} correct answers</div>
        </div>

        <a href="/r/{code}" class="scoreboard-btn">Open scoreboard →</a>
      </div>
    </div>
  </Stage>
{:else}
  <Stage confetti={false}>
    <div class="center-main">
      <div class="connecting">
        <div class="spinner" aria-hidden="true"></div>
        <p class="connecting-text">Connecting…</p>
      </div>
    </div>
  </Stage>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgba(42, 26, 94, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .overlay-card {
    padding: 30px 34px;
    text-align: center;
    max-width: 280px;
    margin: 0 16px;
    box-shadow: 0 22px 60px rgba(0, 0, 0, 0.3);
  }
  .overlay-title {
    font-size: 22px;
    font-weight: 700;
    margin: 0 0 8px;
    color: var(--ink);
  }
  .overlay-sub {
    font-size: 15px;
    color: var(--ink-soft);
    margin: 0;
  }

  .center-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    padding: 16px 16px 24px;
    position: relative;
    z-index: 10;
  }

  .kicked-card,
  .lobby-card,
  .final-card {
    width: 100%;
    flex: 1;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: 40px 28px;
    border-top: 6px solid var(--gold);
  }

  .kicked-card .glyph {
    font-size: 56px;
    color: var(--color-option-a);
  }
  .kicked-card h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 900;
    color: var(--ink);
  }
  .muted {
    color: var(--ink-soft);
  }
  .btn-primary {
    display: inline-block;
    margin-top: 4px;
    padding: 12px 28px;
    background: var(--grad-a);
    color: #fff;
    border-radius: 14px;
    font-weight: 800;
    text-decoration: none;
    transition: background 0.16s ease;
  }
  .btn-primary:hover {
    background: var(--grad-b);
  }

  .lobby-card .avatar {
    width: 96px;
    height: 96px;
    border-radius: 50%;
    overflow: hidden;
    border: 4px solid var(--gold);
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.18);
    background: rgba(42, 26, 94, 0.06);
  }
  .lobby-card .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .lobby-card .name {
    font-weight: 900;
    font-size: 30px;
    color: var(--ink);
  }
  .lobby-card .in {
    color: var(--ink-soft);
    font-size: 15px;
    font-weight: 600;
  }
  .waiting {
    width: 100%;
    background: rgba(123, 47, 247, 0.08);
    border: 2px solid rgba(123, 47, 247, 0.25);
    border-radius: 18px;
    padding: 24px 18px;
  }
  .waiting .msg {
    font-weight: 800;
    font-size: 18px;
    color: var(--grad-a);
    animation: pulseMsg 1.6s ease-in-out infinite;
  }
  .waiting .sub {
    color: var(--ink-soft);
    font-size: 14px;
    margin-top: 6px;
  }
  @keyframes pulseMsg {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.55; }
  }

  .question-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 10px 12px 16px;
    position: relative;
    z-index: 10;
    gap: 18px;
  }
  .answers-fill {
    width: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .locked-pill {
    background: rgba(38, 137, 12, 0.28);
  }

  .reveal-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 12px 14px 18px;
    position: relative;
    z-index: 10;
  }
  .reveal-card {
    width: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 20px;
  }
  .correct {
    background: linear-gradient(135deg, var(--color-option-d), #3aa80c);
    color: #fff;
    border-radius: 24px;
    padding: 30px 24px;
    text-align: center;
    box-shadow: 0 22px 60px rgba(38, 137, 12, 0.4);
  }
  .correct.is-wrong {
    background: linear-gradient(135deg, var(--color-option-a), #ff5470);
    box-shadow: 0 22px 60px rgba(226, 27, 60, 0.4);
  }
  .correct .check {
    font-size: 56px;
    font-weight: 900;
    animation: popCheck 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.4);
  }
  .correct .label {
    font-size: 38px;
    font-weight: 900;
    line-height: 1;
    margin-top: 4px;
  }
  .correct .pts {
    font-size: 24px;
    font-weight: 800;
    margin-top: 8px;
    opacity: 0.92;
  }
  @keyframes popCheck {
    0%  { transform: scale(0); }
    70% { transform: scale(1.25); }
    100% { transform: scale(1); }
  }
  .hint {
    text-align: center;
    color: rgba(255, 255, 255, 0.85);
    font-size: 14px;
    font-weight: 600;
    margin: 0;
  }
  .summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--white);
    color: var(--ink);
    border-radius: 18px;
    padding: 20px 22px;
    box-shadow: 0 10px 30px rgba(42, 26, 94, 0.2);
  }
  .summary .col-label {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
    font-weight: 700;
  }
  .summary .col-value {
    font-size: 34px;
    font-weight: 900;
    color: var(--ink);
  }
  .summary .col-of {
    font-size: 12px;
    color: var(--ink-soft);
    font-weight: 600;
  }
  .summary .right {
    text-align: right;
  }
  .summary .right .col-value {
    color: var(--grad-a);
  }

  .final-card .trophy {
    font-size: 64px;
    animation: floatTrophy 2.4s ease-in-out infinite;
  }
  @keyframes floatTrophy {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-10px); }
  }
  .final-card h1 {
    margin: 0;
    font-weight: 900;
    font-size: 30px;
    color: var(--ink);
  }
  .result {
    width: 100%;
    background: rgba(123, 47, 247, 0.08);
    border: 2px solid rgba(123, 47, 247, 0.22);
    border-radius: 18px;
    padding: 24px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .result .place {
    font-size: 56px;
    font-weight: 900;
    color: var(--grad-a);
    line-height: 1;
  }
  .result .of {
    color: var(--ink-soft);
    font-size: 15px;
    font-weight: 600;
  }
  .result .divider {
    border-top: 2px solid rgba(42, 26, 94, 0.12);
    margin: 10px 0;
  }
  .result .pts {
    font-size: 24px;
    font-weight: 900;
    color: var(--ink);
  }
  .result .answers {
    color: var(--ink-soft);
    font-size: 14px;
    font-weight: 600;
  }
  .scoreboard-btn {
    display: block;
    width: 100%;
    height: 58px;
    line-height: 58px;
    border-radius: 14px;
    background: var(--grad-a);
    color: #fff;
    font-weight: 800;
    font-size: 20px;
    text-decoration: none;
    box-shadow: 0 8px 20px rgba(123, 47, 247, 0.35);
    transition: transform 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
  }
  .scoreboard-btn:hover {
    transform: translateY(-3px);
    box-shadow: 0 14px 30px rgba(123, 47, 247, 0.42);
    background: var(--grad-b);
  }

  /* This state sits directly on the gradient, not on a white card, so it must
     NOT use --ink-soft (an on-white token) — that renders near-invisible. */
  .connecting-text {
    color: rgba(255, 255, 255, 0.9);
    font-weight: 700;
  }
  .connecting {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .spinner {
    width: 40px;
    height: 40px;
    border: 4px solid rgba(255, 255, 255, 0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
