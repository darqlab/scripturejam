# content-tools

Offline content pipeline for scripturejam. **Never ships in the runtime image.**

## Setup (uv)

```bash
cd content-tools
uv sync
```

## Scripts

| Command | Purpose |
|---------|---------|
| `uv run sj-ingest` | Parse Easton's Bible Dictionary → raw entity records |
| `uv run sj-generate` | AI question generation (Anthropic SDK, cost-capped) |
| `uv run sj-review` | Interactive review CLI — accept / reject / edit candidates |

## Pipeline flow

1. **Ingest** — `sj-ingest` reads Easton's and outputs `staging/entities_raw.yaml`
2. **Augment** — `sj-generate` produces question candidates in `staging/candidates_*.yaml`
3. **Review** — `sj-review` walks the reviewer through each candidate; approved ones
   are appended to `../content/packs/<pack-id>.yaml`
4. **Validate** — CI runs `jsonschema` against `../content/packs/schema.json` and
   `../content/avatars/schema.json` on every push that touches `content/`

## Prompts

LLM prompt templates live in `prompts/`. See the planning docs for the prompt
strategy and cost-cap guidance.

## Required environment variables

| Var | Purpose |
|-----|---------|
| `ANTHROPIC_API_KEY` | Required for `sj-generate`. Never used at runtime. |
