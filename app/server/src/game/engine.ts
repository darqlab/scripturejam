import { getIo } from "../socket/io.js";
import { getSession, saveSession } from "../session/store.js";
import { canTransition } from "../session/state-machine.js";
import { computeScore } from "../scoring/index.js";
import { getContent } from "../content/loader.js";
import { persistResults } from "../db/persist.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { QuestionPayload } from "@scripturejam/types";

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
  const question = questions.get(questionId);
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
  const payload: QuestionPayload = {
    questionId: question.id,
    index: nextIndex,
    total: session.questionIds.length,
    prompt: question.prompt,
    options: question.options,
    startedAt: now,
    durationMs: config.QUESTION_DURATION_MS,
  };

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
  const question = questions.get(questionId);
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

  // Resolve verse text for first reference
  let verseText = "";
  const ref = question.references[0];
  if (ref) {
    const bibleIndex = bible.get(session.translation);
    const chap = bibleIndex?.[ref.book]?.[ref.chapter];
    if (chap) {
      const parts: string[] = [];
      for (let v = ref.verse_start; v <= (ref.verse_end ?? ref.verse_start); v++) {
        if (chap[v]) parts.push(chap[v]);
      }
      verseText = parts.join(" ");
    }
  }

  const io = getIo();
  const answeredCount = Object.values(session.players).filter((p) => p.answers[questionId]).length;

  io.to(`host:${code}`).emit("REVEAL", {
    questionId: question.id,
    correctOptionId: question.correctOptionId,
    references: question.references,
    perQuestionTop5: perQTop.slice(0, 5),
    answeredCount,
    playerCount: ranked.length,
  });

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
