<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { hostStore } from "$lib/stores/host.js";
  import { connectSocket, getSocket } from "$lib/socket/client.js";
  import { storageGet } from "$lib/storage.js";
  import { flip } from "svelte/animate";
  import { fly } from "svelte/transition";
  import Stage from "$lib/components/Stage.svelte";
  import ConnectionPill from "$lib/components/ConnectionPill.svelte";
  import AnswerGrid from "$lib/components/AnswerGrid.svelte";
  import TimerBar from "$lib/components/TimerBar.svelte";
  import JoinCard from "$lib/components/JoinCard.svelte";
  import { createRevealChoreography } from "$lib/reveal-choreography.svelte.js";
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


  let timerProgress = $state(100);
  let timerRaf = $state<number | null>(null);
  let starting = $state(false);
  let startError = $state<string | null>(null);
  let advancing = $state(false);
  let advanceError = $state<string | null>(null);
  let copyDone = $state(false);
  let isCustomPack = $state(false);
  let joinHost = $state("");

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

    // Session-scoped: fetched once, never per-render, per DEC-034-adjacent
    // guidance against a "growing" fetch pattern here.
    fetch("/api/config/join-host")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { joinHost?: string } | null) => {
        if (data?.joinHost) joinHost = data.joinHost;
      })
      .catch(() => { /* keep the empty fallback; caption just hides itself */ });

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
      advanceError = null;
      hostStore.setQuestion(payload);
      startTimer(payload.startedAt, payload.durationMs);
    });

    socket.on("REVEAL", (payload) => {
      advanceError = null;
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
    advanceError = null;
    const socket = getSocket();
    socket.emit("ADVANCE", (ack: AdvanceAck) => {
      advancing = false;
      if (!ack.ok) {
        advanceError = "Could not advance — please try again";
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


  // ── Reveal choreography ────────────────────────────────────────────────────
  // The actual state + sequencing lives in reveal-choreography.svelte.ts so it
  // can be mounted and exercised in isolation (via `$effect.root`) in a
  // Vitest regression test — see reveal-choreography.test.ts (1.4). This
  // component just wires it to `hostStore` and the template.
  const REORDER_MS = 600; // FLIP slide, matches animate:flip below

  let burstCanvas = $state<HTMLCanvasElement | null>(null);
  const reveal = createRevealChoreography(() => burstCanvas);

  // Re-runs whenever a new REVEAL lands; the cleanup cancels a sequence that is
  // still mid-flight when the host advances.
  $effect(() => {
    const r = $hostStore.revealData;
    const q = $hostStore.currentQuestion;
    if ($hostStore.state !== "reveal" || !r || !q) {
      reveal.cancel();
      return;
    }
    reveal.start(r, q.options);
    return reveal.cancel;
  });

  onDestroy(reveal.cancel);

  function fmt(n: number): string {
    return n.toLocaleString();
  }

  /**
   * Scales a base font-size down as text length grows, so a long question
   * or verse shrinks to fit its card instead of wrapping to enough lines to
   * force the page to scroll. Below `shortLen` chars: full size (1). At or
   * above `longLen` chars: `minScale`. Linear in between.
   */
  function textScale(len: number, shortLen: number, longLen: number, minScale = 0.6): number {
    if (len <= shortLen) return 1;
    if (len >= longLen) return minScale;
    const t = (len - shortLen) / (longLen - shortLen);
    return 1 - t * (1 - minScale);
  }

  let visiblePlayers = $derived(
    $hostStore.players.filter((p) => p.status !== "disconnected")
  );

  let answeredCount = $derived($hostStore.revealData?.answeredCount ?? 0);
  let playerCount = $derived($hostStore.revealData?.playerCount ?? $hostStore.players.length);
</script>


{#snippet meta()}
  <ConnectionPill connected={$hostStore.connected} />
  {#if $hostStore.total > 0}
    <span class="pill">Question {$hostStore.currentIndex + 1} / {$hostStore.total}</span>
  {/if}
  <span class="pill">{$hostStore.translation}</span>
  <span class="pill">Session {code}</span>
{/snippet}

<Stage {meta}>
  {#if $hostStore.state === null || $hostStore.state === "lobby"}
    <!-- ── Lobby ────────────────────────────────────────────────────────── -->
    <div class="main">
      <div class="lobby-split">
        <div class="qr-col">
          <JoinCard {code} {joinHost} hero size={440} codeSize={90} />
          {#if joinHost}
            <p class="scan-label">or type the code at {joinHost}/join</p>
          {/if}
        </div>

        <div class="players-col">
          <h2 class="col-title">Joining players · {visiblePlayers.length}</h2>
          <!-- Newest first, so an arriving player appears at the top and the
               list slides down beneath them (host-lobby-flow.md §Flow). -->
          <div class="pgrid">
            {#each [...visiblePlayers].reverse() as player (player.playerId)}
              <div class="prow" animate:flip={{ duration: 400 }} in:fly={{ y: -34, duration: 450 }}>
                <img
                  src="/api/avatars/{player.avatarId}/monogram.svg?name={encodeURIComponent(player.nickname)}"
                  alt=""
                />
                <span>{player.nickname}</span>
              </div>
            {/each}
            {#if visiblePlayers.length === 0}
              <p class="empty">Waiting for players…</p>
            {/if}
          </div>
        </div>
      </div>
    </div>

    <div class="dock">
      {#if startError}
        <span class="dock-error" role="alert">{startError}</span>
      {/if}
      <button type="button" onclick={endSession}>End</button>
      {#if isCustomPack}
        <button type="button" onclick={downloadPack}>Download pack</button>
      {/if}
      <button type="button" class="primary" onclick={startQuiz} disabled={starting}>
        {starting ? "Starting…" : "Start first question →"}
      </button>
    </div>

  {:else if $hostStore.state === "question" && $hostStore.currentQuestion}
    {@const q = $hostStore.currentQuestion}
    <!-- ── Question ─────────────────────────────────────────────────────── -->
    <div class="main">
      <div class="reveal-layout">
        <div class="reveal-main-col">
          <div class="card">
            <TimerBar progress={timerProgress} />
            <h2 class="qtext" style="--qscale: {textScale(q.prompt.length, 50, 180, 0.55)}">{q.prompt}</h2>
            <AnswerGrid options={q.options} variant="host" />
          </div>
        </div>

        <!-- Same side column shape as the reveal screen, so the question
             screen doesn't jump in layout/size when it advances. No live
             "answered" counter here on purpose: the server sends no
             per-answer event to the host, so it stays 0 until REVEAL. -->
        <div class="side-col">
          <div class="hud reveal-hud">
            <h4>{visiblePlayers.length} playing</h4>
            <TimerBar progress={timerProgress} height={10} />
            <p class="seconds">
              {Math.ceil((q.durationMs * (timerProgress / 100)) / 1000)}s remaining
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="dock">
      {#if advanceError}
        <span class="dock-error" role="alert">{advanceError}</span>
      {/if}
      <button type="button" class="primary" onclick={advance} disabled={advancing}>
        {advancing ? "Loading…" : "Reveal answer →"}
      </button>
    </div>

  {:else if $hostStore.state === "reveal" && $hostStore.revealData && $hostStore.currentQuestion}
    {@const r = $hostStore.revealData}
    {@const q = $hostStore.currentQuestion}
    <!-- ── Reveal (choreographed — see runChoreography above) ────────────── -->
    <canvas bind:this={burstCanvas} class="burst" aria-hidden="true"></canvas>

    <div class="main">
      <div class="reveal-layout">
        <div class="reveal-main-col">
          <div class="card">
            <h2 class="qtext" style="--qscale: {textScale(q.prompt.length, 50, 180, 0.55)}">{q.prompt}</h2>
            <AnswerGrid
              options={q.options}
              variant="host"
              counts={r.optionCounts}
              countsShown={reveal.countsShown}
              correctOptionId={reveal.revealedCorrectId}
            />
          </div>

          <!-- Its own card, outside/below the answer card — kept in the DOM
               but hidden until stage 4, so this column does not jump when
               the verse arrives. -->
          <div class="scripture-card" class:is-shown={reveal.showVerse} aria-live="polite">
            <p class="ref">
              {r.references
                .map(
                  (ref) =>
                    `${ref.book} ${ref.chapter}:${ref.verse_start}${ref.verse_end && ref.verse_end !== ref.verse_start ? "–" + ref.verse_end : ""}`,
                )
                .join("; ")} · {r.translation}
            </p>
            {#if r.verseText}
              <p class="verse" style="--vscale: {textScale(r.verseText.length, 100, 500, 0.55)}">{r.verseText}</p>
            {/if}
          </div>
        </div>

        <!-- Standings live beside the card, not below it — keeps the reveal
             from growing tall enough to need scrolling or run under the dock. -->
        <div class="side-col">
          <div class="hud reveal-hud">
            <h4>Top 5</h4>
            {#each reveal.standingsOrder as s, i (s.playerId)}
              <div class="row" animate:flip={{ duration: REORDER_MS }}>
                <span class="rank">{i + 1}</span>
                <img
                  src="/api/avatars/{s.avatarId}/monogram.svg?name={encodeURIComponent(s.nickname)}"
                  alt=""
                />
                <span class="name">{s.nickname}</span>
                <span class="score">{fmt(reveal.scoresShown[s.playerId] ?? s.previousScore)}</span>
                {#if reveal.showGains && s.awarded > 0}
                  <span class="gain">+{s.awarded}</span>
                {/if}
              </div>
            {/each}
            <p class="answered">{answeredCount} of {playerCount} answered</p>
          </div>
        </div>
      </div>
    </div>

    <div class="dock">
      {#if advanceError}
        <span class="dock-error" role="alert">{advanceError}</span>
      {/if}
      <button
        type="button"
        class="primary"
        onclick={advance}
        disabled={advancing || reveal.isAnimating}
      >
        {advancing
          ? "Loading…"
          : reveal.isAnimating
            ? "Celebrating…"
            : q.index + 1 < q.total
              ? "Next question →"
              : "Show final scores →"}
      </button>
    </div>

  {:else if $hostStore.state === "final" && $hostStore.finalData}
    {@const f = $hostStore.finalData}
    <!-- ── Final ────────────────────────────────────────────────────────── -->
    <div class="main">
      <div class="hud"><h4>{f.questionCount} questions · {f.playerCount} players</h4></div>

      <div class="card">
        <h2 class="final-title">Final Scores</h2>
        {#if f.top10.length >= 3}
          <div class="podium" aria-hidden="true">
            <span class="p2">2</span><span class="p1">1</span><span class="p3">3</span>
          </div>
        {/if}
        <div class="scorelist">
          {#each f.top10 as entry (entry.playerId)}
            <div class="srow" class:first={entry.rank === 1}>
              <span class="rank">{entry.rank}</span>
              <img
                src="/api/avatars/{entry.avatarId}/monogram.svg?name={encodeURIComponent(entry.nickname)}"
                alt=""
              />
              <span class="name">{entry.nickname}</span>
              <span class="score">{fmt(entry.score)}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="dock">
      <a href="/host" class="dock-link">New session</a>
      <button type="button" onclick={endSession}>End session</button>
      <button type="button" class="primary" onclick={copyShareLink}>
        {copyDone ? "Copied ✓" : "Copy share link"}
      </button>
    </div>

  {:else}
    <div class="main">
      <div class="connecting">
        <div class="spinner" aria-hidden="true"></div>
        <p>Connecting to session {code}…</p>
      </div>
    </div>
  {/if}
</Stage>

<style>
  /* Big-screen host layout. Ported from host-lobby / host-question /
     host-reveal4 / host-final in the design package. The shared shell
     (.stage/.topbar/.brand/.pill/.answer/.timerbar/.confetti) lives in
     app.css; only what is specific to the projector view is here. */

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px 40px 96px;
    position: relative;
    z-index: 10;
    min-height: 0;
  }
  /* Question and reveal cards are short enough (no more tall single-column
     reveal stack) that centering them vertically left a large empty band
     under the topbar — sit them near the top instead. Targets both states
     via `.qtext` (lobby/final don't have one) without a wrapper class. */
  .main:has(.qtext) {
    justify-content: flex-start;
    padding-top: 36px;
  }

  /* White content card */
  .card {
    background: var(--white);
    color: var(--ink);
    border-radius: 26px;
    padding: 34px 40px;
    box-shadow: 0 26px 70px rgba(42, 26, 94, 0.28);
    width: 100%;
    max-width: 1320px;
    text-align: center;
  }
  /* The floating HUD (.hud, question/lobby state) reserves a fixed strip on
     the right; a direct-child card (question/final states) must not grow
     into it. The reveal card is nested inside .reveal-layout instead and
     uses the flex side-col, so it is unaffected by this narrower cap. */
  .main > .card {
    max-width: 980px;
  }

  .qtext {
    font-weight: 900;
    /* --qscale (set inline per-question, from its character length) shrinks
       long prompts instead of letting them wrap to enough lines to push the
       card past the viewport and force a scroll. */
    font-size: calc(clamp(32px, 4.4vw, 56px) * var(--qscale, 1));
    line-height: 1.12;
    margin: 22px 0 34px;
    text-wrap: pretty;
  }

  /* ── Floating HUD ─────────────────────────────────────────────────── */
  .hud {
    position: absolute;
    top: 24px;
    right: 22px;
    z-index: 30;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 20px;
    padding: 18px 20px;
    backdrop-filter: blur(8px);
    min-width: 300px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .hud h4 {
    margin: 0 0 4px;
    font-size: 13px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    opacity: 0.8;
  }
  .hud .seconds,
  .hud .answered {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    opacity: 0.8;
  }
  .hud .row {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 19px;
    font-weight: 700;
  }
  .hud .row img {
    width: 44px;
    height: 44px;
    border-radius: 999px;
    border: 2px solid rgba(255, 255, 255, 0.45);
    flex-shrink: 0;
  }
  .hud .row .rank {
    width: 22px;
    text-align: center;
    font-weight: 900;
    color: var(--gold);
    flex-shrink: 0;
  }
  .hud .row .name {
    flex: 1;
    text-align: left;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hud .row .score {
    color: var(--gold);
    font-weight: 900;
  }
  .hud .row .gain {
    margin-left: 10px;
    color: var(--gold);
    font-weight: 900;
    font-size: 14px;
    animation: gainPop 0.4s ease;
  }
  @keyframes gainPop {
    0% { transform: scale(0); opacity: 0; }
    70% { transform: scale(1.3); }
    100% { transform: scale(1); opacity: 1; }
  }

  /* ── Lobby ────────────────────────────────────────────────────────── */
  .lobby-split {
    display: flex;
    width: 100%;
    max-width: 1280px;
    gap: 44px;
    align-items: stretch;
    min-height: 0;
  }
  .qr-col {
    flex: 1.5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .scan-label {
    color: rgba(255, 255, 255, 0.72);
    font-size: 15px;
    font-weight: 600;
    margin: 0;
  }
  .players-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .col-title {
    font-weight: 900;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-size: 18px;
    color: rgba(255, 255, 255, 0.85);
    margin: 0 0 18px;
    text-align: center;
  }
  .pgrid {
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow: hidden;
    min-height: 0;
  }
  .prow {
    display: flex;
    align-items: center;
    gap: 14px;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.24);
    border-radius: 14px;
    padding: 8px 14px;
    flex-shrink: 0;
  }
  .prow img {
    width: 42px;
    height: 42px;
    border-radius: 10px;
    border: 2px solid rgba(255, 255, 255, 0.45);
    flex-shrink: 0;
  }
  .prow span {
    font-weight: 700;
    font-size: 16px;
    color: rgba(255, 255, 255, 0.95);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The list is capped by fading the oldest rows rather than scrolling — a
     projected screen must never need a scrollbar. */
  .pgrid .prow:nth-child(n + 10) { opacity: 0.5; }
  .pgrid .prow:nth-child(n + 12) { opacity: 0.24; }
  .pgrid .prow:nth-child(n + 14) { display: none; }
  .empty {
    color: rgba(255, 255, 255, 0.7);
    text-align: center;
    font-weight: 600;
  }

  /* ── Reveal ───────────────────────────────────────────────────────── */
  .burst {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 50;
  }
  /* Card + standings/verse side by side, so the reveal uses the screen's
     width instead of growing tall enough to need scrolling or to run under
     the fixed dock. */
  .reveal-layout {
    display: flex;
    align-items: flex-start;
    gap: 32px;
    /* Fills the full width of .main's padded content box, so the standings
       column sits flush against the same right margin the dock uses
       (right: 40px) instead of floating in a centered, capped-width row. */
    width: 100%;
  }
  .reveal-main-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .reveal-layout .card {
    max-width: none;
  }
  .side-col {
    flex: 0 0 400px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  /* `.hud` is normally a floating overlay (question/lobby); here it is a
     normal flex child stacked above the verse instead. */
  .side-col .reveal-hud {
    position: static;
    min-width: 0;
    width: 100%;
  }
  .scripture-card {
    background: linear-gradient(135deg, #fff, #fff8e0);
    border: 0;
    border-top: 6px solid var(--gold);
    border-radius: 24px;
    padding: 26px 36px;
    box-shadow: 0 22px 60px rgba(42, 26, 94, 0.24);
    margin-top: 22px;
    text-align: center;
    /* Hidden, not absent: keeping it in flow stops the card resizing when the
       verse arrives at stage 4. */
    opacity: 0;
    visibility: hidden;
    transform: translateY(12px);
    transition: opacity 0.8s ease, transform 0.8s ease;
  }
  .scripture-card.is-shown {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }
  .scripture-card .ref {
    font-size: 14px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    font-weight: 800;
    color: var(--grad-a);
    margin: 0;
  }
  /* high-contrast flips --ink to WHITE (it is the on-gradient text colour
     there), which would make this always-light card white-on-white. The card
     inverts instead, keeping the verse the most legible thing on screen. */
  :global(html.high-contrast) .scripture-card {
    background: #000;
    border: 2px solid var(--gold);
    border-top-width: 6px;
  }
  :global(html.high-contrast) .scripture-card .ref {
    color: var(--gold);
  }
  :global(html.high-contrast) .scripture-card .verse {
    color: #fff;
  }

  .scripture-card .verse {
    font-family: "EB Garamond", Georgia, serif;
    font-style: italic;
    /* --vscale (set inline, from the verse's character length) shrinks a
       long multi-verse passage instead of letting the card grow tall
       enough to force a scroll. */
    font-size: calc(clamp(20px, 2vw, 30px) * var(--vscale, 1));
    line-height: 1.4;
    color: var(--ink);
    margin-top: 14px;
    white-space: pre-line;
  }

  /* ── Final ────────────────────────────────────────────────────────── */
  .final-title {
    font-weight: 900;
    font-size: clamp(30px, 4vw, 46px);
    margin: 0 0 6px;
  }
  .podium {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 20px;
    margin-bottom: 34px;
  }
  .podium .p1 {
    font-weight: 900;
    font-size: clamp(66px, 10vw, 120px);
    color: var(--gold);
    text-shadow: 0 6px 0 rgba(42, 26, 94, 0.18);
    line-height: 1;
    animation: pop 1.6s ease-in-out infinite;
  }
  .podium .p2,
  .podium .p3 {
    font-weight: 900;
    font-size: clamp(36px, 5vw, 60px);
    color: var(--ink-soft);
  }
  @keyframes pop {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.06); }
  }
  .scorelist {
    display: grid;
    gap: 10px;
    max-width: 720px;
    margin: 0 auto;
  }
  .srow {
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--white);
    border-radius: 16px;
    padding: 12px 16px;
    font-weight: 800;
    color: var(--ink);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.1);
  }
  .srow.first { box-shadow: 0 0 0 4px var(--gold); }
  .srow .rank { width: 34px; text-align: center; font-weight: 900; color: var(--ink-soft); }
  .srow img { width: 36px; height: 36px; border-radius: 999px; }
  .srow .name { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .srow .score { color: var(--grad-a); font-weight: 900; }

  /* ── Host control dock ────────────────────────────────────────────── */
  /* Legible at rest — a projector has no cursor to hover with, so the host
     must be able to read/hit these without hovering. Hover/focus stays as a
     subtle emphasis on top. */
  .dock {
    position: fixed;
    /* Right-aligned, under the standings/verse column, rather than centered
       over the question card or the verse text. */
    right: 40px;
    bottom: 16px;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.96);
    color: var(--ink);
    border-radius: 999px;
    padding: 8px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
    opacity: 0.9;
    transition: opacity 0.2s ease;
  }
  .dock:hover,
  .dock:focus-within {
    opacity: 1;
  }
  .dock button,
  .dock .dock-link {
    background: transparent;
    border: 0;
    color: inherit;
    padding: 10px 16px;
    border-radius: 999px;
    font-weight: 700;
    font-size: 14px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }
  .dock button:hover:not(:disabled),
  .dock .dock-link:hover {
    background: var(--ink);
    color: #fff;
  }
  .dock button:disabled { opacity: 0.5; }
  .dock button.primary { background: var(--grad-a); color: #fff; }
  .dock button.primary:hover:not(:disabled) { background: var(--grad-b); }
  .dock-error {
    padding: 0 14px;
    font-size: 13px;
    font-weight: 700;
    color: var(--color-option-a);
    max-width: 420px;
  }

  /* ── Connecting ───────────────────────────────────────────────────── */
  .connecting { text-align: center; }
  .spinner {
    width: 40px;
    height: 40px;
    border: 4px solid rgba(255, 255, 255, 0.4);
    border-top-color: var(--gold);
    border-radius: 50%;
    margin: 0 auto 12px;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 900px) {
    .lobby-split { flex-direction: column; }
    .hud { position: static; min-width: 0; margin-bottom: 16px; }
    .reveal-layout { flex-direction: column; }
    .side-col { max-width: none; }
  }
</style>
