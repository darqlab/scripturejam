import { getIo } from "../socket/io.js";
import { getSession, saveSession } from "../session/store.js";
import type { LiveSession } from "../session/store.js";
import { canTransition } from "../session/state-machine.js";
import { computeScore } from "../scoring/index.js";
import { tallyOptionCounts } from "./tally.js";
import { getContent } from "../content/loader.js";
import { persistResults } from "../db/persist.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { QuestionPayload, RevealPayloadHost } from "@scripturejam/types";

/**
 * Builds the host-facing QUESTION payload from a session's current live
 * state — used both for the live QUESTION broadcast and to reconstruct the
 * screen on HOST_CONNECT (rejoin mid-question). Returns null if the current
 * question can't be resolved (e.g. content not loaded).
 */
export function buildHostQuestionPayload(session: LiveSession): QuestionPayload | null {
  const { questions } = getContent();
  const questionId = session.questionIds[session.currentIndex];
  const question =
    session.scope.type === "custom"
      ? session.customPackQuestions?.[questionId]
      : questions.get(questionId);
  if (!question) return null;

  return {
    questionId: question.id,
    index: session.currentIndex,
    total: session.questionIds.length,
    prompt: question.prompt,
    options: question.options,
    startedAt: session.questionStartedAt ?? Date.now(),
    durationMs: config.QUESTION_DURATION_MS,
  };
}

/**
 * Builds the host-facing REVEAL payload from a session's current live state.
 * Assumes scoring for the current question has already run (i.e. this is
 * called either right after `revealQuestion` scores it, or on a HOST_CONNECT
 * rejoin while `session.state === "reveal"`, when the answers are already
 * scored and persisted) — it never re-scores. Returns null if the current
 * question can't be resolved.
 */
export function buildHostRevealPayload(session: LiveSession): RevealPayloadHost | null {
  const questionId = session.questionIds[session.currentIndex];
  const { questions, bible } = getContent();
  const question =
    session.scope.type === "custom"
      ? session.customPackQuestions?.[questionId]
      : questions.get(questionId);
  if (!question) return null;

  const perQTop = Object.values(session.players)
    .map((player) => {
      const ans = player.answers[questionId];
      if (!ans?.correct) return null;
      return { playerId: player.id, nickname: player.nickname, avatarId: player.avatarId, awarded: ans.awarded };
    })
    .filter((x): x is { playerId: string; nickname: string; avatarId: string; awarded: number } => x !== null)
    .sort((a, b) => b.awarded - a.awarded);

  const ranked = Object.values(session.players)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  const bibleIndex = bible.get(session.translation);
  const referenceTexts: string[] = [];
  for (const r of question.references) {
    const chap = bibleIndex?.[r.book]?.[r.chapter];
    if (!chap) continue;
    const parts: string[] = [];
    for (let v = r.verse_start; v <= (r.verse_end ?? r.verse_start); v++) {
      if (chap[v]) parts.push(`${v} ${chap[v]}`);
    }
    if (parts.length === 0) continue;
    const citation = `${r.book} ${r.chapter}:${r.verse_start}${r.verse_end && r.verse_end !== r.verse_start ? "–" + r.verse_end : ""}`;
    referenceTexts.push(question.references.length > 1 ? `${citation}\n${parts.join(" ")}` : parts.join(" "));
  }
  const verseText = referenceTexts.join("\n\n");

  const answeredCount = Object.values(session.players).filter((p) => p.answers[questionId]).length;

  const optionCounts = tallyOptionCounts(
    Object.values(session.players),
    questionId,
    question.options.map((o) => o.id),
  );

  const standings = ranked.slice(0, 5).map((p) => {
    const awarded = p.answers[questionId]?.awarded ?? 0;
    return {
      playerId: p.id,
      nickname: p.nickname,
      avatarId: p.avatarId,
      score: p.score,
      previousScore: p.score - awarded,
      awarded,
    };
  });

  return {
    questionId: question.id,
    correctOptionId: question.correctOptionId,
    references: question.references,
    perQuestionTop5: perQTop.slice(0, 5),
    answeredCount,
    optionCounts,
    standings,
    playerCount: ranked.length,
    verseText,
    translation: session.translation,
  };
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function clearTimer(code: string): void {
  const t = timers.get(code);
  if (t) { clearTimeout(t); timers.delete(code); }
}

export async function startQuestion(code: string): Promise<void> {
  const session = await getSession(code);
  if (!session) return;

  const nextIndex = session.currentIndex + 1;

  if (nextIndex >= session.questionIds.length) {
    await finalizeSession(code);
    return;
  }

  if (!canTransition(session.state, "question")) {
    logger.warn("startQuestion: invalid transition", { code, from: session.state });
    return;
  }

  const { questions } = getContent();
  const questionId = session.questionIds[nextIndex];
  const question =
    session.scope.type === "custom"
      ? session.customPackQuestions?.[questionId]
      : questions.get(questionId);
  if (!question) {
    logger.error("Question not found", { code, questionId });
    return;
  }

  const now = Date.now();
  session.state = "question";
  session.currentIndex = nextIndex;
  session.questionStartedAt = now;
  if (nextIndex === 0) session.gameStartedAt = now;
  for (const p of Object.values(session.players)) {
    if (p.status !== "disconnected") p.status = "joined";
  }
  await saveSession(session);

  const io = getIo();
  const payload = buildHostQuestionPayload(session);
  if (!payload) {
    logger.error("Failed to build question payload", { code, questionId });
    return;
  }

  io.to(`host:${code}`).emit("QUESTION", payload);
  io.to(`player:${code}`).emit("QUESTION", payload);
  logger.info("QUESTION", { code, index: nextIndex, questionId });

  clearTimer(code);
  timers.set(code, setTimeout(() => revealQuestion(code), config.QUESTION_DURATION_MS));
}

export async function revealQuestion(code: string): Promise<void> {
  clearTimer(code);

  const session = await getSession(code);
  if (!session || session.state !== "question") return;
  if (!canTransition(session.state, "reveal")) return;

  const questionId = session.questionIds[session.currentIndex];
  const { questions, bible } = getContent();
  const question =
    session.scope.type === "custom"
      ? session.customPackQuestions?.[questionId]
      : questions.get(questionId);
  if (!question) {
    logger.error("Question not found during reveal", { code, questionId });
    return;
  }

  // Score all players
  const perQTop: Array<{ playerId: string; nickname: string; avatarId: string; awarded: number }> = [];
  for (const player of Object.values(session.players)) {
    const ans = player.answers[questionId];
    if (!ans) continue;
    ans.correct = ans.optionId === question.correctOptionId;
    const awarded = computeScore({
      correct: ans.correct,
      msToAnswer: ans.msToAnswer,
      questionDurationMs: config.QUESTION_DURATION_MS,
    });
    ans.awarded = awarded;
    player.score += awarded;
    if (ans.correct) {
      perQTop.push({ playerId: player.id, nickname: player.nickname, avatarId: player.avatarId, awarded });
    }
  }
  perQTop.sort((a, b) => b.awarded - a.awarded);

  session.state = "reveal";
  await saveSession(session);

  const ranked = Object.values(session.players)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  // Resolve full verse text for every cited reference (not just the first),
  // with verse numbers inline, so the player-specific REVEAL below can reuse it.
  const bibleIndex = bible.get(session.translation);
  const referenceTexts: string[] = [];
  for (const r of question.references) {
    const chap = bibleIndex?.[r.book]?.[r.chapter];
    if (!chap) continue;
    const parts: string[] = [];
    for (let v = r.verse_start; v <= (r.verse_end ?? r.verse_start); v++) {
      if (chap[v]) parts.push(`${v} ${chap[v]}`);
    }
    if (parts.length === 0) continue;
    const citation = `${r.book} ${r.chapter}:${r.verse_start}${r.verse_end && r.verse_end !== r.verse_start ? "–" + r.verse_end : ""}`;
    referenceTexts.push(question.references.length > 1 ? `${citation}\n${parts.join(" ")}` : parts.join(" "));
  }
  const verseText = referenceTexts.join("\n\n");

  const io = getIo();

  // Scoring above has already mutated + persisted session.players' answers,
  // so the host payload can be rebuilt from live state — the same helper
  // HOST_CONNECT uses to restore a mid-reveal rejoin (2.2).
  const hostPayload = buildHostRevealPayload(session);
  if (hostPayload) {
    io.to(`host:${code}`).emit("REVEAL", hostPayload);
  } else {
    logger.error("Failed to build host reveal payload", { code, questionId });
  }

  for (const player of Object.values(session.players)) {
    if (!player.socketId) continue;
    const socket = io.sockets.sockets.get(player.socketId);
    if (!socket) continue;
    const ans = player.answers[questionId];
    const playerRank = ranked.find((p) => p.id === player.id)?.rank ?? ranked.length;
    socket.emit("REVEAL", {
      questionId: question.id,
      correctOptionId: question.correctOptionId,
      references: question.references,
      yourPick: ans?.optionId,
      yourCorrect: ans?.correct ?? false,
      yourAwarded: ans?.awarded ?? 0,
      yourCumulative: player.score,
      yourRank: playerRank,
      totalPlayers: ranked.length,
      verseText,
      translation: session.translation,
    });
  }

  logger.info("REVEAL", { code, questionId, index: session.currentIndex });
}

export async function finalizeSession(code: string): Promise<void> {
  clearTimer(code);

  const session = await getSession(code);
  if (!session) return;

  session.state = "final";
  await saveSession(session);

  const ranked = Object.values(session.players)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  const top10 = ranked.slice(0, 10).map((p) => ({
    playerId: p.id,
    nickname: p.nickname,
    avatarId: p.avatarId,
    score: p.score,
    rank: p.rank,
  }));

  const questionCount = Math.max(0, session.currentIndex + 1);
  const io = getIo();

  io.to(`host:${code}`).emit("FINAL", { top10, questionCount, playerCount: ranked.length });

  for (const player of Object.values(session.players)) {
    if (!player.socketId) continue;
    const socket = io.sockets.sockets.get(player.socketId);
    if (!socket) continue;
    const playerRank = ranked.find((p) => p.id === player.id)?.rank ?? ranked.length;
    const answeredCorrect = Object.values(player.answers).filter((a) => a.correct).length;
    socket.emit("FINAL", {
      yourFinalRank: playerRank,
      yourFinalScore: player.score,
      yourAnsweredCorrect: answeredCorrect,
      totalPlayers: ranked.length,
      top10: top10.map((p) => ({ nickname: p.nickname, avatarId: p.avatarId, score: p.score, rank: p.rank })),
    });
  }

  try {
    await persistResults(session, ranked, questionCount);
  } catch (err) {
    logger.error("Failed to persist results", { code, error: String(err) });
  }

  logger.info("FINAL", { code, players: ranked.length, questions: questionCount });
}
