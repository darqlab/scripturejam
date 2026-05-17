# Prompt — Review checklist

**Feeds:** task 1.9 (Review CLI)
**Output:** structured per-question / per-entity review record
**Run mode:** interactive — shown to the human reviewer one item at a time

> Unlike the other prompts in this folder, this is NOT an LLM prompt. It is the
> **human-facing review template** rendered by the review CLI. It lives here
> alongside the generation prompts because the questions a reviewer must
> answer are tightly coupled to the generation rules — keeping them in the
> same folder makes drift between "what we asked the model to do" and "what
> we check the model did" obvious.

---

## Per-question review template

When the review CLI presents a generated question, it renders:

```
╭────────────────────────────────────────────────────────────────╮
│ Pack: {{pack_title}}                  Question {{n}} of {{total}} │
╰────────────────────────────────────────────────────────────────╯

PROMPT
  {{question.prompt}}

OPTIONS
  (a) {{question.options[0].text}}
  (b) {{question.options[1].text}}
  (c) {{question.options[2].text}}     ← marked correct
  (d) {{question.options[3].text}}

REFERENCES
  {{question.references[0]}}    → loaded from KJV bundle:
    "{{verse_text_kjv}}"

  {{question.references[1]}}    → loaded from KJV bundle:
    "{{verse_text_kjv}}"

DIFFICULTY: {{question.difficulty}}     THEMES: {{question.themes}}
```

The reviewer is then prompted with the **checklist below**. Each item is a
y / n / edit prompt; "n" or "edit" rejects the question and routes it back
to staging with a note.

### Checklist

1. **Reference accuracy** — Does each cited KJV verse actually support the
   correct answer? (The CLI shows you the verse text, you don't have to look
   it up.)
2. **Single correct answer** — Is exactly one option correct, with the others
   clearly wrong in light of the cited passage?
3. **Plausible distractors** — Are the wrong options drawn from scripture
   (people, places, events the Bible mentions), not invented?
4. **Not a trick question** — A reasonable reader of the cited passage would
   pick the marked-correct option; the question doesn't rely on misleading
   phrasing or trivia outside the passage.
5. **No doctrinal content** — The question asks "what does the text say",
   not "what does the text mean". (Reject anything about salvation mechanics,
   the Trinity, eschatology, free will vs. predestination, etc.)
6. **KJV-faithful naming** — Names and places match KJV spelling where the
   text uses them.
7. **Difficulty is honest** — `easy` is recognizable to a regular church-goer;
   `medium` needs the passage in hand; `hard` is a careful-reading detail.
   Flag anything that feels mis-tagged.
8. **Themes are useful** — Tags help filter, not just describe. Generic tags
   like "Bible" or "scripture" are not useful — they should be specific
   ("parable", "miracle", "prophecy", "narrative", "memory-verse").
9. **Within scope** — The cited references are inside the pack's declared
   scope (book/chapter range).
10. **No duplicate** — This question's `prompt` is not substantially the same
    as one already accepted into the pack.

Reviewer outcomes per question:
- **accept** — adds to the pack's final YAML.
- **edit** — opens the question in `$EDITOR`; edited version goes back through
  the checklist before acceptance.
- **reject** — moves to a `rejected/` log with the reviewer's free-text reason.
  Generator script can re-prompt with rejection feedback later (out of scope
  for v1 — for now, rejections are just discarded after logging).

---

## Per-avatar-entity review template

When the review CLI presents a generated entity, it renders:

```
╭────────────────────────────────────────────────────────────────╮
│ Avatar review                       Entry {{n}} of {{total}}     │
╰────────────────────────────────────────────────────────────────╯

ID:               {{entity.id}}
DISPLAY:          {{entity.displayName}}  {{entity.disambiguation}}
CATEGORY:         {{entity.category}}    TESTAMENT: {{entity.testament}}
TAGS:             {{entity.tags}}
BLURB ({{blurb_length}}/80):
  {{entity.blurb}}

ALIASES:
  {{entity.aliases}}

PRIMARY REFERENCE: {{entity.primary_reference}}
  → loaded from KJV bundle:
    "{{verse_text_kjv}}"
```

### Checklist

1. **Inclusion policy** — Per DEC-016: Jesus is excluded entirely. Adversarial
   and genealogy entries are included but must be tagged accordingly.
2. **Real biblical entity** — The entry refers to a person, people, animal,
   or object that actually appears in scripture (not a tradition-only figure
   like extra-biblical archangels by name).
3. **Disambiguation** — If the displayName collides with another entry, the
   `disambiguation` suffix uniquely distinguishes them.
4. **Blurb under 80 chars** — Counted at render time; reviewer just confirms
   it reads naturally.
5. **Blurb is factual, not interpretive** — No theological judgment ("the
   great prophet", "the beloved disciple", "the wicked king") unless the
   adjective is the canonical descriptor used in scripture.
6. **Aliases trace to a real source** — Sample-verify obscure aliases. If you
   can't trace where a claimed alias comes from, reject the alias list.
7. **Tags are useful** — Same standard as questions: specific tokens that
   would filter the picker meaningfully.
8. **Primary reference checks out** — The cited KJV passage actually contains
   or refers to this entity.

Reviewer outcomes mirror the question flow: accept / edit / reject.

---

## Pack-level acceptance gate

After all questions in a pack are individually accepted, the reviewer runs a
pack-level check before merging into `content/`:

- **Density floor** — Per scoping success criterion: every chapter in
  Matthew / Mark / Luke / John / Genesis / Psalms / Romans has ≥5 questions
  across all packs. Density audit script (task 1.13) prints the current
  picture; gaps drive the next generation run.
- **Difficulty balance** — Across the whole pack, roughly 30/50/20 easy /
  medium / hard. Way off → flag for regeneration of additional items in the
  under-represented bucket.
- **No duplicates across packs** — A question accepted into "Parables" should
  not also appear in "NT Narratives". Cross-pack dedup runs at this stage.

Outcome: the staging file is promoted to a versioned file in `content/packs/`
with a git commit referencing the reviewer (the operator's git author).
