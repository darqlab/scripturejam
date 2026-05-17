import type { SessionScope, Question, QuestionPack } from "@scripturejam/types";
import { config } from "../config.js";

export class ScopeTooSmallError extends Error {
  constructor(public readonly matched: number, public readonly min: number) {
    super(`Scope matched ${matched} question(s); minimum is ${min}`);
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function stratifiedSample(questions: Question[], n: number): string[] {
  const pools: Record<string, Question[]> = {
    easy: [],
    medium: [],
    hard: [],
  };
  for (const q of questions) pools[q.difficulty].push(q);

  const buckets = [shuffle(pools.easy), shuffle(pools.medium), shuffle(pools.hard)];
  const result: Question[] = [];
  let i = 0;
  while (result.length < n) {
    const bucket = buckets[i % 3];
    if (bucket.length > 0) result.push(bucket.shift()!);
    i++;
    if (buckets.every((b) => b.length === 0)) break;
  }
  return result.map((q) => q.id);
}

export function resolveScope(
  scope: SessionScope,
  questions: Map<string, Question>,
  packs: Map<string, QuestionPack>
): string[] {
  if (scope.type === "custom") {
    return scope.customPack.questionIds;
  }

  let candidates: Question[];

  if (scope.type === "pack") {
    const pack = packs.get(scope.packId);
    if (!pack) throw new Error(`Pack not found: ${scope.packId}`);
    candidates = pack.questionIds
      .map((id) => questions.get(id))
      .filter((q): q is Question => q !== undefined);
  } else {
    candidates = [];
    for (const q of questions.values()) {
      const match = q.references.some((ref) => {
        const b = scope.filter.books.find((sb) => sb.book === ref.book);
        if (!b) return false;
        if (!b.chapters) return true;
        return b.chapters.some((r) => ref.chapter >= r.start && ref.chapter <= r.end);
      });
      if (match) candidates.push(q);
    }
  }

  if (candidates.length < config.MIN_QUESTIONS_TO_START) {
    throw new ScopeTooSmallError(candidates.length, config.MIN_QUESTIONS_TO_START);
  }

  if (candidates.length <= config.MAX_QUESTIONS_PER_SESSION) {
    return shuffle(candidates).map((q) => q.id);
  }

  return stratifiedSample(candidates, config.MAX_QUESTIONS_PER_SESSION);
}
