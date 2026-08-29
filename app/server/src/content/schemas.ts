import { z } from "zod";

// Shared zod schemas for the `Question` / `QuestionPack` shapes (see
// @scripturejam/types). Extracted from routes/sessions.ts so the live
// generation path (content/generate.ts) can validate against the exact
// same rules as the custom-pack upload path, without duplicating them.

export const referenceSchema = z.object({
  book: z.string(),
  chapter: z.number().int(),
  verse_start: z.number().int(),
  verse_end: z.number().int().optional(),
});

export const questionOptionSchema = z.object({
  id: z.string(),
  text: z.string(),
});

export const questionSchema = z
  .object({
    id: z.string(),
    prompt: z.string(),
    options: z.array(questionOptionSchema).min(2).max(4),
    correctOptionId: z.string(),
    references: z.array(referenceSchema),
    difficulty: z.enum(["easy", "medium", "hard"]),
    themes: z.array(z.string()),
  })
  .superRefine((q, ctx) => {
    const optionIds = q.options.map((o) => o.id);
    if (!optionIds.includes(q.correctOptionId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "correctOptionId must match one of the option ids",
        path: ["correctOptionId"],
      });
    }
  });

export const questionPackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  ageBand: z.enum(["youth", "all-ages"]),
  questionIds: z.array(z.string()).min(1),
});
