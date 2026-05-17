# Prompt — Avatar entity aliases

**Feeds:** task 1.4 (Generate aliases / alternate spellings)
**Output:** the `aliases` list on an `AvatarEntity` record
**Run mode:** batched; one API call covers N entities

> Reason this matters (DEC-018): players searching for "Elias" should find
> Elijah. The KJV is the canonical spelling source (DEC-011), but cross-
> translation variants, transliteration variants, and common modern spellings
> all need to resolve to the canonical entry.

---

## Inputs (template variables)

| Var | Meaning |
|-----|---------|
| `{{entries}}` | List of entity records needing alias generation |

Each entry has `id`, `displayName`, `disambiguation`, `category`, `testament`, and `source_text` (Easton's entry or operator seed).

---

## System prompt

```
You generate alternate-spelling aliases for Bible quiz avatar entries. The
goal is that a player typing any reasonable variant of a name into a search
box finds the canonical entry.

Sources of aliases (consider all):
1. KJV alternate spellings — same person referred to with a different form
   in the same translation (e.g., "Elias" for Elijah in the NT).
2. Cross-translation variants — how WEB / ASV / NIV / common modern
   translations render the name (e.g., "Hezekiah" / "Chizkiyahu").
3. Transliteration variants — Hebrew or Greek forms commonly seen in study
   contexts (e.g., "Yeshua" for Joshua).
4. Common misspellings — predictable typos a player might enter
   ("Methusela" for Methuselah). Limit to plausible misspellings, not arbitrary
   ones.
5. Genealogy short-forms — where a person is sometimes referenced by patronymic
   ("son of Nun" → Joshua); include only if the form is commonly used as a
   name substitute.

Hard rules:
1. The canonical `displayName` itself is NOT an alias — don't list it.
2. Aliases must be plausible search inputs, not invented synonyms.
3. No transliteration variants for non-person entities unless they are
   genuinely common (most peoples / animals / objects have only a few
   English spellings).
4. Maximum 8 aliases per entry. Most entries need 0–3. Common names like
   "Mary" or "John" need disambiguation in the entry list, not extra aliases.
5. All aliases are lowercase ASCII; the search code lowercases input. No
   diacritics in the alias list (handle diacritics by stripping at search
   time, not by enumerating them here).

Output a single YAML document with a top-level `aliases:` map keyed by
entity id. No prose, no markdown code fences.
```

---

## User prompt template

```
Generate aliases for the following entries.

Entries:
{{entries}}

Output schema (YAML):

aliases:
  <entity_id>:
    - <alias>
    - <alias>
  <entity_id>: []     # empty list if no aliases needed
  ...

Self-check before responding:
- For each entry, every alias is lowercase ASCII.
- The displayName itself is not in the alias list.
- No alias appears in more than one entry's list (alias collisions are a bug
  — flag instead of guessing which entry "owns" it).
```

---

## Notes / known failure modes

- **Over-generation.** Model loves to add 10–15 transliteration variants for "Jesus" or "Moses". The 8-alias cap controls volume; reviewer prunes further.
- **Alias collisions across entries.** Real risk: "John" maps to multiple disambiguated entries. The model is told to flag these instead of guessing — generator script should reject the response if a collision is reported, and the operator resolves manually.
- **Made-up variants.** Reviewer flags anything that isn't traceable to a translation or transliteration tradition.
- **Non-English variants.** Out of scope for v1 (DEC-004); the prompt sticks to English-rendered variants only.

## Review pass

This is the highest-risk prompt for hallucinated content — alias claims are easy to fabricate and hard to spot-check. Reviewer must:
1. Sample-verify obscure aliases against a known source (a Bible name reference, Wikipedia's "biblical name" article, etc.).
2. Confirm no alias claims a name that actually belongs to a different person.
3. Accept the alias list as a whole or reject and regenerate — do not selectively edit, since the cap and collision-detection apply to the batch.
