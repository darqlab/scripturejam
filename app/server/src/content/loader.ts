import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { AvatarEntity, Question, QuestionPack, Translation } from "@scripturejam/types";
import { logger } from "../logger.js";

// Content directory is baked into the image at build time (task 4.1).
const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../content");

interface BibleIndex {
  [book: string]: {
    [chapter: number]: {
      [verse: number]: string;
    };
  };
}

interface ContentStore {
  avatars: Map<string, AvatarEntity>;
  questions: Map<string, Question>;
  packs: Map<string, QuestionPack>;
  bible: Map<Translation, BibleIndex>;
}

let store: ContentStore | null = null;

export function getContent(): ContentStore {
  if (!store) throw new Error("Content not loaded — call loadContent() first");
  return store;
}

/**
 * The bundled bible YAMLs (KJV/WEB/ASV, from a shared public-domain source)
 * key numbered books with Roman numerals ("I Kings", "II Samuel") and name
 * Revelation "Revelation of John". Every other book reference in this app —
 * question packs, generated content (generate.ts's prompt explicitly asks
 * for "the KJV canonical English form, e.g. '1 Kings' not 'I Kgs'") — uses
 * Arabic numerals and short names. Left unreconciled, a question on any
 * numbered book or Revelation looked up an index key that didn't exist and
 * silently rendered no verse text at all. Remap once at load time so every
 * consumer can just use the app's own convention.
 */
function normalizeBibleBookKey(book: string): string {
  const romanToArabic: Record<string, string> = { I: "1", II: "2", III: "3" };
  const romanMatch = /^(I{1,3})\s+(.+)$/.exec(book);
  if (romanMatch) {
    const [, roman, rest] = romanMatch;
    return `${romanToArabic[roman]} ${rest}`;
  }
  if (book === "Revelation of John") return "Revelation";
  return book;
}

function normalizeBibleIndexKeys(index: BibleIndex): BibleIndex {
  const normalized: BibleIndex = {};
  for (const [book, chapters] of Object.entries(index)) {
    normalized[normalizeBibleBookKey(book)] = chapters;
  }
  return normalized;
}

export function loadContent() {
  logger.info("Loading content from disk");

  let avatarsRaw: AvatarEntity[] = [];
  try {
    avatarsRaw = yaml.load(
      readFileSync(join(CONTENT_DIR, "avatars/entities.yaml"), "utf8")
    ) as AvatarEntity[];
    if (!Array.isArray(avatarsRaw)) avatarsRaw = [];
  } catch {
    logger.warn("Avatar entities not found — serving without avatars");
  }

  const avatars = new Map(avatarsRaw.map((e) => [e.id, e]));

  const packsDir = join(CONTENT_DIR, "packs");
  const questions = new Map<string, Question>();
  const packs = new Map<string, QuestionPack>();

  try {
    for (const file of readdirSync(packsDir).filter((f) => f.endsWith(".yaml"))) {
      const raw = yaml.load(readFileSync(join(packsDir, file), "utf8")) as {
        pack: QuestionPack;
        questions: Question[];
      };
      packs.set(raw.pack.id, raw.pack);
      for (const q of raw.questions) {
        questions.set(q.id, q);
      }
    }
  } catch {
    logger.warn("No question packs found — session start will require custom packs");
  }

  const bible = new Map<Translation, BibleIndex>();
  for (const translation of ["KJV", "WEB", "ASV"] as Translation[]) {
    const path = join(CONTENT_DIR, `bible/${translation}.yaml`);
    try {
      const raw = yaml.load(readFileSync(path, "utf8")) as BibleIndex;
      bible.set(translation, normalizeBibleIndexKeys(raw));
    } catch {
      logger.warn(`Bible text not found for ${translation} — verse text will be empty`);
    }
  }

  store = { avatars, questions, packs, bible };
  logger.info("Content loaded", {
    avatars: avatars.size,
    questions: questions.size,
    packs: packs.size,
    translations: bible.size,
  });
}
