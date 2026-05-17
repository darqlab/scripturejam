# Prompt — Avatar entity blurb

**Feeds:** tasks 1.2 (Easton's filter/classify), 1.3 (AI-augment non-persons)
**Output:** the `blurb` field on an `AvatarEntity` record — ≤80 characters, plain text
**Run mode:** batched; one API call generates blurbs for N entities at once

> Persons are seeded from Easton's Bible Dictionary (DEC-015), which already has
> long-form entries. This prompt **condenses** Easton's text into the ≤80-char
> blurb; it does **not** invent biographical content. For non-person entities
> (peoples, animals, objects), Easton's coverage is uneven and the blurb may be
> AI-generated from scratch — see `non-person-entities.md` for that path.

---

## Inputs (template variables)

| Var | Meaning | Example |
|-----|---------|---------|
| `{{entries}}` | List of entity records needing a blurb | see schema below |

Each entry in `{{entries}}` has:

```
- id: moses
  displayName: Moses
  disambiguation: ""           # filled if name collides with another entry
  category: person             # person | people | animal | object
  testament: OT                # OT | NT | both | null
  source_text: |               # Easton's entry, lightly trimmed
    "drawn out," the leader of the Israelites in the exodus from Egypt.
    Son of Amram and Jochebed of the tribe of Levi...
```

For non-persons, `source_text` is the operator's seed (a sentence or two
gathered manually) rather than an Easton's quote.

---

## System prompt

```
You write one-line "who they were" blurbs for entries in a Bible quiz game's
avatar picker. The blurbs help players who don't immediately recognize a name
decide whether to pick this avatar.

Hard rules:
1. Maximum 80 characters per blurb, including spaces and punctuation. Count
   precisely. If you exceed 80, you have failed.
2. Plain text. No markdown, no emoji, no quotation marks around the blurb.
3. Factual and neutral. No theological judgment ("the great prophet", "the
   beloved disciple") and no editorializing. Stick to what the cited material
   says they did or were.
4. Use present-tense identification or simple past for actions. Either
   "Israelite leader; led the exodus from Egypt." or "Led Israel out of
   Egypt." is fine. "Was a great man of God." is not.
5. Disambiguation (when present in the input) is shown next to the displayName
   in the UI — do NOT repeat it inside the blurb itself. The blurb adds new
   information.
6. For adversarial figures (Satan, Judas, Herod, etc.), describe their role
   factually without softening or sermonizing.

Output a single YAML document with a top-level `blurbs:` map keyed by entity
id. No prose before or after. No markdown code fences.
```

---

## User prompt template

```
Generate blurbs for the following entries. Each blurb must be ≤80 characters.

Entries:
{{entries}}

Output schema (YAML):

blurbs:
  <entity_id>: <≤80 char blurb>
  <entity_id>: <≤80 char blurb>
  ...

Self-check before responding:
- For each blurb, count characters. Anything >80 must be rewritten.
- No blurb repeats the displayName or the disambiguation suffix.
- No two blurbs are word-for-word identical.
```

---

## Notes / known failure modes

- **80-char overrun.** Most common failure. Generator script must enforce post-hoc and reject + retry per entry that overshoots; do not just truncate (truncation chops mid-word).
- **Sermonizing.** Pattern-match for words like "blessed", "righteous", "wicked" (when used as a moral verdict, not a descriptor) — flag for reviewer attention.
- **Repeating the name.** "Moses was the leader who..." → "Israelite leader; led the exodus from Egypt."
- **Generic blurbs.** "An Old Testament figure." is useless. Reviewer rejects; regenerate with a stricter "must include a specific action or role" instruction.

## Prompt-caching strategy

- System prompt is stable; cache it.
- Per-batch entries are not cached.
- Recommend batches of 20–50 entries per call for token efficiency.
