# Prompt — Non-person entity generation

**Feeds:** task 1.3 (AI-augment peoples / animals / objects)
**Output:** full `AvatarEntity` records for non-person categories
**Run mode:** one API call per category, generating the full list

> Easton's covers persons exhaustively but is uneven for non-person entries.
> The non-person scope (DEC-014) is small and bounded: ~20 named peoples /
> tribes, ~15 symbolic animals, ~25 symbolic objects. Generate the full list
> in one pass per category, then human-review against scripture.
>
> **Note (DEC-024):** the `people` category does double duty — it powers the
> general avatar picker AND is the *only* avatar pool available in group/team
> play sessions. That makes coverage and quality of the `people` list more
> load-bearing than the other non-person categories: skipping a major
> tribe/nation hurts more than skipping a symbolic object. Bias toward
> completeness when generating `people`; lean toward conservatism for
> `animal` and `object`.

---

## Inputs (template variables)

| Var | Meaning | Example |
|-----|---------|---------|
| `{{category}}` | Which non-person category to generate | `people` / `animal` / `object` |
| `{{target_count}}` | Approximate list size for this category | `20` / `15` / `25` |
| `{{exclusion_examples}}` | Things that look like they'd belong but don't | "individual people, places (cities/countries), abstract concepts like 'love'" |
| `{{inclusion_examples}}` | Anchor examples for the model | "people: Ammonites, Philistines, Samaritans; animal: dove, serpent, lamb; object: ark, manna, brazen serpent" |

---

## System prompt

```
You generate the canonical list of non-person avatar entries for a Bible quiz
game. Players pick an entity as their visual identity in a session — so the
list must be made up of distinctive, recognizable named entities from the Bible.

Categories you generate:
- "people" — named peoples / tribes / collective groups treated as a unit
  in scripture (e.g., Ammonites, Philistines, Samaritans, the twelve tribes).
- "animal" — animals that appear with symbolic or narrative significance
  (e.g., the dove of Genesis 8 and Matthew 3, the serpent of Genesis 3,
  the ram of Genesis 22). Generic animals named only in lists (clean/unclean,
  sacrifices) without a specific narrative role are excluded.
- "object" — physical or symbolic objects with named significance (e.g., the
  ark of the covenant, manna, the brazen serpent, the burning bush, the
  twelve loaves of showbread).

Hard rules:
1. Excluded: places (cities, countries, geographic features), abstract
   concepts ("love", "faith", "kingdom"), individual people (covered by the
   person path), groups defined only by occupation ("scribes", "priests")
   unless they are also a named ethnic/tribal group, and anything tied
   specifically to Jesus's identity (Lamb of God as a title is excluded —
   the literal Passover lamb / ram of sacrifice is included).
2. Each entry needs a stable canonical id (kebab-case), a displayName, and
   a category. Disambiguation suffix is required only if the displayName
   collides with a person entry (e.g., "Lamb" the object vs. specific persons).
3. Testament tag: "OT", "NT", "both", or null. Use null for entries with no
   clear testament home (rare).
4. Blurb ≤80 characters — follow the same rule as the person-blurb prompt.
5. Aliases (≤8) where common alternates exist; empty list otherwise.
6. Tags: free-form short tokens describing role or scene context
   (e.g., "exodus", "passover", "creation", "covenant", "sacrifice").

Output a single YAML document with a top-level `entities:` list. No prose,
no markdown code fences.
```

---

## User prompt template

```
Generate the canonical list of "{{category}}" entries.

Target count: approximately {{target_count}} entries. It's acceptable to
return slightly fewer if you can't justify additional entries from scripture,
or slightly more if there are genuinely additional significant ones — but
do not pad the list.

Examples of what belongs in this category:
{{inclusion_examples}}

Examples of what does NOT belong:
{{exclusion_examples}}

Output schema (YAML):

entities:
  - id: <kebab-case canonical id>
    displayName: <human-readable>
    disambiguation: <suffix shown next to displayName, if needed; else empty>
    category: {{category}}
    testament: OT | NT | both | null
    blurb: <≤80 char description; factual, neutral>
    aliases: [<lowercase ASCII alias>, ...]      # empty list ok
    tags: [<short tokens>, ...]
    illustration: null                            # always null at generation time
    primary_reference:
      book: <KJV book>
      chapter: <int>
      verse_start: <int>
      verse_end: <int, optional>
    # primary_reference is your single best scripture pointer for the entry —
    # used by the reviewer to anchor verification. Not stored in the runtime
    # AvatarEntity (the schema there doesn't include it), but required here.

Self-check before responding:
- No entry duplicates another by id, displayName, or primary_reference.
- Each entry has a clear scriptural anchor — if you cannot cite a specific
  passage, do not include the entry.
- All blurbs are ≤80 characters.
```

---

## Notes / known failure modes

- **Padding to hit the target count.** The "do not pad" instruction is explicit but the model still tries. Reviewer's primary job here: cut padding.
- **Category leakage.** "Lamb of God" creeps in as an object — it's a title, not an object. Caught by the exclusion rules and reviewer.
- **Vague tags.** Tags should be scene-anchors, not abstractions. Reviewer normalizes the tag vocabulary across categories.
- **Inconsistent ids.** Run a post-generation pass to lowercase and kebab-case all ids; reject the response if the model used spaces or underscores.

## Generation workflow

1. Operator runs the generator once per category (`people`, then `animal`, then `object`).
2. Each run produces a staging YAML file in `content-tools/staging/non-person-{category}.yaml`.
3. Reviewer walks the staging file, accepting/rejecting/editing each entry.
4. Accepted entries are merged into the canonical `content/avatar-entities.yaml`.
5. The `aliases` field on each entry is regenerated with the alias prompt (`avatar-aliases.md`) after the entries themselves are stabilized — keeps alias generation deterministic relative to the canonical list.
