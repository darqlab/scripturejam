import OpenAI from "openai";
import yaml from "js-yaml";
import { z } from "zod";
import type { Question, QuestionPack } from "@scripturejam/types";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { questionSchema } from "./schemas.js";

export class GenerationNotConfiguredError extends Error {}

export class GenerationFailedError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

const SYSTEM_PROMPT = `You are a careful Bible-quiz question writer for a live multiplayer quiz game.
You write factual questions about biblical narratives, characters, parables, and
teachings. Your questions are answerable directly from the King James Version
(KJV) text of the Bible. You do not write interpretive, doctrinal, or theological
questions — only "what does the text say" questions.

Hard rules:
1. Every question must be answerable from a specific KJV passage. You will cite
   the passage as structured references.
2. Use 2–4 answer options. Exactly one is correct.
3. Distractors must be plausible-but-wrong from within scripture itself — not
   invented people, places, or events. A distractor like "Pharaoh's daughter"
   for "Who found Moses in the bulrushes?" is fine. A distractor like
   "Captain America" is not.
4. Never write questions about Jesus's divinity, the Trinity, salvation
   mechanics, or other doctrinal topics that vary across Christian traditions.
   Stay descriptive: who, what, where, when, what happened next.
5. Never write questions about modern application ("what does this mean for
   your life?") — quiz format, not devotional format.
6. Names spell as they appear in the KJV (e.g., "Elias" appears in the NT as
   the Greek form of Elijah — use whichever the cited passage uses).
7. References use the structured form { book, chapter, verse_start, verse_end }
   where verse_end is optional and equals verse_start for single-verse refs.
   Book names use the KJV canonical English form (e.g., "1 Kings" not "I Kgs").

Output a single YAML document with a top-level \`questions:\` list. No prose
before or after. No markdown code fences around the YAML.`;

function buildUserPrompt(
  book: string,
  count: number,
  ageBand: "youth" | "all-ages",
  packTitle: string,
  packDescription: string
): string {
  const easy = Math.round(count * 0.4);
  const medium = Math.round(count * 0.4);
  const hard = Math.max(0, count - easy - medium);

  return `Pack: ${packTitle}
Description: ${packDescription}
Audience: ${ageBand}
Allowed scope (questions may only cite these passages):
${book} (whole book, no chapter restriction)

Generate ${count} candidate questions for this pack. Target difficulty mix:
- easy:   ${easy}
- medium: ${medium}
- hard:   ${hard}

Difficulty definitions:
- easy:   a regular church-goer should know without looking it up
- medium: requires reading the passage; a Bible-study attendee would get most
- hard:   specific detail; rewards careful reading of the cited verses

Avoid duplicating these prompts already generated for this pack:
(none — first batch)

Output schema (YAML):

questions:
  - id: <kebab-case slug, unique within this pack>
    prompt: <the question text — one sentence, ends with "?">
    options:
      - id: a
        text: <option text>
      - id: b
        text: <option text>
      # 2–4 options total
    correctOptionId: <one of a/b/c/d>
    references:
      - book: <KJV canonical book name>
        chapter: <int>
        verse_start: <int>
        verse_end: <int, optional, omit if single verse>
    difficulty: easy | medium | hard
    themes:
      - <one or more tags: parable, prophecy, miracle, narrative, etc.>

Self-check before responding:
- Each question has exactly one correctOptionId.
- Every reference falls within the allowed scope.
- Every correct answer can be verified word-for-word against the cited KJV verse(s).
- No duplicate \`prompt\` text within this batch or against the prior-generated list.
- The difficulty mix matches the requested distribution within ±1.`;
}

const generationResponseSchema = z.object({
  questions: z.array(z.unknown()),
});

export async function generateQuestionsForBook(
  book: string,
  count: number,
  ageBand: "youth" | "all-ages"
): Promise<{ pack: QuestionPack; questions: Question[] }> {
  if (!config.NVIDIA_API_KEY) {
    throw new GenerationNotConfiguredError("NVIDIA_API_KEY is not set");
  }

  const packTitle = `Generated: ${book}`;
  const packDescription = `AI-generated questions from the book of ${book}.`;
  const userPrompt = buildUserPrompt(book, count, ageBand, packTitle, packDescription);

  const client = new OpenAI({ baseURL: config.NVIDIA_BASE_URL, apiKey: config.NVIDIA_API_KEY });

  const startedAt = Date.now();
  let responseText: string;
  try {
    const response = await client.chat.completions.create({
      model: config.NVIDIA_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 4096,
      // Match the working reference script — thinking/reasoning tokens off,
      // we only want the final YAML in `content`. NVIDIA's endpoint expects
      // `chat_template_kwargs` as a top-level body field, not wrapped in
      // `extra_body` (that wrapper is a Python-SDK-only convenience; the
      // Node SDK serializes whatever top-level keys you pass directly).
      // @ts-expect-error chat_template_kwargs isn't in the OpenAI SDK's public types but NVIDIA's endpoint accepts it
      chat_template_kwargs: { enable_thinking: false },
    });
    responseText = response.choices[0]?.message?.content ?? "";
    if (!responseText) {
      throw new Error("Empty response content from NVIDIA endpoint");
    }
  } catch (err) {
    logger.error("NVIDIA API call failed", {
      book,
      count,
      elapsedMs: Date.now() - startedAt,
    });
    throw new GenerationFailedError("NVIDIA API call failed", err);
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = yaml.load(responseText);
  } catch (err) {
    throw new GenerationFailedError("Model did not return valid YAML", err);
  }

  const shapeParsed = generationResponseSchema.safeParse(parsedYaml);
  if (!shapeParsed.success) {
    throw new GenerationFailedError("Model YAML did not match the expected { questions: [...] } shape");
  }

  const candidateQuestions: Question[] = [];
  for (const raw of shapeParsed.data.questions) {
    const result = questionSchema.safeParse(raw);
    if (!result.success) {
      // Drop invalid questions rather than fail the whole batch.
      continue;
    }
    const q = result.data;

    // Known failure mode: don't trust the model's own self-check — verify
    // every reference actually cites the requested book.
    const matchesBook = q.references.some(
      (ref) => ref.book.trim().toLowerCase() === book.trim().toLowerCase()
    );
    if (!matchesBook) {
      continue;
    }

    candidateQuestions.push(q);
  }

  if (candidateQuestions.length === 0) {
    throw new GenerationFailedError("No valid questions survived validation/filtering");
  }

  const timestamp = Date.now();
  // Prefix every question id to guarantee uniqueness across generate calls.
  // Option ids and correctOptionId are untouched — questionSchema already
  // validated that correctOptionId matches one of the options' own ids.
  const questions: Question[] = candidateQuestions.map((q) => ({
    ...q,
    id: `gen-${timestamp}-${q.id}`,
  }));

  logger.info("Question generation succeeded", {
    book,
    requestedCount: count,
    returnedCount: questions.length,
    elapsedMs: Date.now() - startedAt,
  });

  const slug = book
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const pack: QuestionPack = {
    id: `generated-${slug}-${timestamp}`,
    title: packTitle,
    description: packDescription,
    ageBand,
    questionIds: questions.map((q) => q.id),
  };

  return { pack, questions };
}
