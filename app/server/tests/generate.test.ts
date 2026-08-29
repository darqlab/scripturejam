/**
 * Unit tests for content/generate.ts — validation/filtering logic only.
 *
 * The NVIDIA (OpenAI-compatible) client is mocked (never a real network
 * call); it returns a hand-written YAML string standing in for a model
 * response. This exercises schema validation and the book-mismatch filter
 * described in content-tools/prompts/question-generation.md's "known
 * failure modes".
 */

// Config singleton reads env vars at import time — set before any server
// module import, same pattern as tests/session.integration.test.ts.
process.env.IP_HASH_SECRET =
  process.env.IP_HASH_SECRET ?? "test-secret-at-least-16-chars";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://sj:sj@localhost:5432/sj";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
process.env.NVIDIA_API_KEY = "test-key-not-real";

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockCreate: ReturnType<typeof vi.fn>;

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: (...args: unknown[]) => mockCreate(...args),
        },
      };
    },
  };
});

function yamlResponse(text: string) {
  return {
    choices: [{ message: { content: text } }],
  };
}

const VALID_YAML = `
questions:
  - id: q1
    prompt: "Who led the Israelites out of Egypt?"
    options:
      - id: a
        text: Moses
      - id: b
        text: Aaron
    correctOptionId: a
    references:
      - book: Exodus
        chapter: 3
        verse_start: 10
    difficulty: easy
    themes:
      - narrative
`;

describe("generateQuestionsForBook", () => {
  beforeEach(() => {
    mockCreate = vi.fn();
    vi.resetModules();
  });

  it("returns validated questions for a valid model response", async () => {
    mockCreate.mockResolvedValue(yamlResponse(VALID_YAML));
    const { generateQuestionsForBook } = await import("../src/content/generate.js");

    const { pack, questions } = await generateQuestionsForBook("Exodus", 5, "all-ages");

    expect(questions).toHaveLength(1);
    expect(questions[0].id).toMatch(/^gen-\d+-q1$/);
    expect(questions[0].correctOptionId).toBe("a");
    expect(pack.questionIds).toEqual(questions.map((q) => q.id));
    expect(pack.title).toBe("Generated: Exodus");
  });

  it("drops questions whose references don't match the requested book", async () => {
    const wrongBookYaml = `
questions:
  - id: q1
    prompt: "Who led the Israelites out of Egypt?"
    options:
      - id: a
        text: Moses
      - id: b
        text: Aaron
    correctOptionId: a
    references:
      - book: Genesis
        chapter: 1
        verse_start: 1
    difficulty: easy
    themes:
      - narrative
`;
    mockCreate.mockResolvedValue(yamlResponse(wrongBookYaml));
    const { generateQuestionsForBook, GenerationFailedError } = await import(
      "../src/content/generate.js"
    );

    // Every candidate is filtered out (wrong book) -> empty batch -> throws.
    await expect(generateQuestionsForBook("Exodus", 5, "all-ages")).rejects.toBeInstanceOf(
      GenerationFailedError
    );
  });

  it("drops schema-invalid questions but keeps valid ones in the same batch", async () => {
    const mixedYaml = `
questions:
  - id: bad-question
    prompt: "This one is missing options"
    options:
      - id: a
        text: Only one option
    correctOptionId: a
    references:
      - book: Exodus
        chapter: 3
        verse_start: 10
    difficulty: easy
    themes: []
  - id: good-question
    prompt: "Who led the Israelites out of Egypt?"
    options:
      - id: a
        text: Moses
      - id: b
        text: Aaron
    correctOptionId: a
    references:
      - book: Exodus
        chapter: 3
        verse_start: 10
    difficulty: easy
    themes:
      - narrative
`;
    mockCreate.mockResolvedValue(yamlResponse(mixedYaml));
    const { generateQuestionsForBook } = await import("../src/content/generate.js");

    const { questions } = await generateQuestionsForBook("Exodus", 5, "all-ages");

    expect(questions).toHaveLength(1);
    expect(questions[0].id).toMatch(/^gen-\d+-good-question$/);
  });

  it("throws GenerationNotConfiguredError when NVIDIA_API_KEY is unset", async () => {
    const original = process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    vi.resetModules();

    const { config } = await import("../src/config.js");
    expect(config.NVIDIA_API_KEY).toBeUndefined();

    const { generateQuestionsForBook, GenerationNotConfiguredError } = await import(
      "../src/content/generate.js"
    );

    await expect(generateQuestionsForBook("Exodus", 5, "all-ages")).rejects.toBeInstanceOf(
      GenerationNotConfiguredError
    );

    process.env.NVIDIA_API_KEY = original;
  });

  it("throws GenerationFailedError on invalid YAML", async () => {
    mockCreate.mockResolvedValue(yamlResponse("not: valid: yaml: at: all: ["));
    const { generateQuestionsForBook, GenerationFailedError } = await import(
      "../src/content/generate.js"
    );

    await expect(generateQuestionsForBook("Exodus", 5, "all-ages")).rejects.toBeInstanceOf(
      GenerationFailedError
    );
  });
});
