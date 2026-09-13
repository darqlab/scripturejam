/**
 * Regression test for the bible-book-key mismatch: the bundled bible YAMLs
 * key numbered books with Roman numerals ("I Kings") and Revelation as
 * "Revelation of John", while every question reference in this app (packs
 * and generated content) uses Arabic numerals and short names ("1 Kings",
 * "Revelation") per generate.ts's documented convention. Left unreconciled,
 * a reveal for any numbered-book or Revelation question rendered no verse
 * text at all — silently, since the lookup just returned undefined.
 */

process.env.IP_HASH_SECRET =
  process.env.IP_HASH_SECRET ?? "test-secret-at-least-16-chars";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://sj:sj@localhost:5432/sj";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

import { describe, it, expect, beforeAll } from "vitest";

let getContent: typeof import("../src/content/loader.js").getContent;

beforeAll(async () => {
  const loader = await import("../src/content/loader.js");
  getContent = loader.getContent;
  loader.loadContent();
});

describe("bible index book-key normalization", () => {
  it("keys numbered books with Arabic numerals, matching pack/generated references", () => {
    const web = getContent().bible.get("WEB");
    expect(web).toBeDefined();

    expect(web?.["1 Kings"]).toBeDefined();
    expect(web?.["1 Samuel"]).toBeDefined();
    expect(web?.["2 Kings"]).toBeDefined();
    expect(web?.["Revelation"]).toBeDefined();

    // The raw YAML forms must not survive normalization — a lookup using
    // one of these would previously succeed and mask the bug.
    expect(web?.["I Kings"]).toBeUndefined();
    expect(web?.["I Samuel"]).toBeUndefined();
    expect(web?.["II Kings"]).toBeUndefined();
    expect(web?.["Revelation of John"]).toBeUndefined();
  });

  it("resolves actual verse text for a numbered-book reference (1 Kings 10:1)", () => {
    const web = getContent().bible.get("WEB");
    const verse = web?.["1 Kings"]?.[10]?.[1];
    expect(verse).toBeTruthy();
    expect(verse).toMatch(/queen of Sheba/i);
  });

  it("leaves un-numbered book names untouched", () => {
    const web = getContent().bible.get("WEB");
    expect(web?.["Genesis"]?.[1]?.[1]).toBeTruthy();
  });
});
