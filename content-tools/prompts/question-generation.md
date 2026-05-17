# Prompt — Question generation

**Feeds:** task 1.8 (Question generation script)
**Output:** staging YAML matching the `Question` schema in `planning/03-architecture.md` §Data Model
**Run mode:** batched per pack theme; one API call yields N candidate questions

---

## Inputs (template variables)

| Var | Meaning | Example |
|-----|---------|---------|
| `{{pack_title}}` | Pack being generated | `Parables of Jesus` |
| `{{pack_description}}` | One-paragraph theme description | "Questions on the parables in the Synoptic Gospels..." |
| `{{age_band}}` | Target audience | `youth` / `all-ages` |
| `{{scope_books_chapters}}` | Which passages questions may cite | `Matthew 13, Mark 4, Luke 8, Luke 15` |
| `{{count}}` | Number of candidate questions to generate this call | `10` |
| `{{difficulty_mix}}` | Target difficulty distribution | `{ easy: 3, medium: 5, hard: 2 }` |
| `{{already_generated_prompts}}` | Prompts already in the staging file (de-dup hint) | bullet list of prior `prompt` fields |

---

## System prompt

```
You are a careful Bible-quiz question writer for a live multiplayer quiz game.
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

Output a single YAML document with a top-level `questions:` list. No prose
before or after. No markdown code fences around the YAML.
```

---

## User prompt template

```
Pack: {{pack_title}}
Description: {{pack_description}}
Audience: {{age_band}}
Allowed scope (questions may only cite these passages):
{{scope_books_chapters}}

Generate {{count}} candidate questions for this pack. Target difficulty mix:
- easy:   {{difficulty_mix.easy}}
- medium: {{difficulty_mix.medium}}
- hard:   {{difficulty_mix.hard}}

Difficulty definitions:
- easy:   a regular church-goer should know without looking it up
- medium: requires reading the passage; a Bible-study attendee would get most
- hard:   specific detail; rewards careful reading of the cited verses

Avoid duplicating these prompts already generated for this pack:
{{already_generated_prompts}}

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
- No duplicate `prompt` text within this batch or against the prior-generated list.
- The difficulty mix matches the requested distribution within ±1.
```

---

## Notes / known failure modes

- **Hallucinated verse refs.** Mitigated downstream by the review CLI (task 1.9), which renders the actual KJV verse from the bundled text and asks the reviewer to compare. The prompt itself can't prevent it.
- **"Trick" questions.** The "distractors from within scripture" rule catches most. The review checklist (`review-checklist.md`) has a dedicated "is this a trick question?" gate.
- **Doctrinal drift.** Spotted in review; the hard-rule list above is the first line of defense.
- **Off-scope refs.** The self-check step is the model's first chance to catch it; the generator script also schema-validates and rejects any reference outside `{{scope_books_chapters}}`.
- **Duplicate prompts across pack runs.** `{{already_generated_prompts}}` is rebuilt from the staging file before each call; for long-running pack generation, this list grows — eventually move dedup to embedding-based similarity if exact-match dedup stops being enough.

## Prompt-caching strategy

- System prompt + book-list reference block are stable across all pack runs → mark for caching.
- `{{already_generated_prompts}}` and per-call vars are not cached.
- Cache hit target: ≥80% after the first call in any pack run.
