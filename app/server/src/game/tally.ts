import type { LivePlayerState } from "../session/store.js";

/**
 * Per-option answer distribution for one question.
 *
 * Host-only data: the reveal choreography counts each option's votes up in turn.
 * It is deliberately never sent to players, who must not learn how the room voted.
 *
 * Every option id is present (zeros included) so the host renders a stable
 * four-block layout without back-filling missing keys.
 */
export function tallyOptionCounts(
  players: LivePlayerState[],
  questionId: string,
  optionIds: string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of optionIds) counts[id] = 0;
  for (const player of players) {
    const ans = player.answers[questionId];
    if (!ans) continue;
    if (ans.optionId in counts) counts[ans.optionId] += 1;
  }
  return counts;
}
