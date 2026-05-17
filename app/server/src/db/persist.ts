import { db } from "./client.js";
import { sessionResults, sessionPlayerResults } from "./schema.js";
import type { LiveSession, LivePlayerState } from "../session/store.js";

export async function persistResults(
  session: LiveSession,
  ranked: Array<LivePlayerState & { rank: number }>,
  questionCount: number
): Promise<void> {
  await db.insert(sessionResults).values({
    code: session.code,
    hostIpHash: session.hostIpHash,
    translation: session.translation,
    scopeJson: session.scope,
    startedAt: new Date(session.gameStartedAt ?? Date.now()),
    endedAt: new Date(),
    playerCount: ranked.length,
    questionCount,
  });

  for (const player of ranked) {
    const answeredCorrect = Object.values(player.answers).filter((a) => a.correct).length;
    const answeredTotal = Object.values(player.answers).length;
    await db.insert(sessionPlayerResults).values({
      sessionCode: session.code,
      nickname: player.nickname,
      avatarId: player.avatarId,
      finalScore: player.score,
      finalRank: player.rank,
      answeredCorrect,
      answeredTotal,
    });
  }
}
