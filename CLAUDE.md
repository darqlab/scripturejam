# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Global preferences: see /home/dennis/CLAUDE.md

## Project

**scripturejam** — a Kahoot-style live multi-player Bible quiz app. Host runs a session on a big screen; players join from mobile browsers via QR or short code. Scripture reference shown on every answer reveal — the teaching moment is the point. Self-hostable, no native app required.

- **Audience:** youth groups, small groups, whole-congregation events
- **Scale target:** up to 200 concurrent players per session
- **Planning docs:** `/home/dennis/devops/projects/scripturejam/planning/`

## Common Commands

All `pnpm` commands run from `app/`:

```bash
# Install dependencies
cd app && pnpm install

# Run all tests, typecheck, lint across all packages
pnpm test
pnpm typecheck
pnpm -r lint

# Format entire workspace
pnpm format

# Server dev (hot-reload via tsx)
cd app/server && pnpm dev

# Web dev
cd app/web && pnpm dev

# Build server (TypeScript → dist/)
cd app/server && pnpm build

# Run a single test by name
cd app/server && pnpm vitest run --reporter verbose -t "test name substring"

# Drizzle migrations (generate SQL from schema, apply to DB)
cd app/server && pnpm db:generate
cd app/server && pnpm db:migrate
```

**Docker (local full-stack):**
```bash
./run.sh up          # foreground with build
./run.sh start       # background
./run.sh stop
./run.sh logs
```

**Production deploy:**
```bash
# Cloudflare Tunnel (no inbound ports)
docker compose -f deploy/docker-compose.yml -f deploy/compose.cloudflare.yml up -d

# Caddy (direct TLS, static IP)
docker compose -f deploy/docker-compose.yml -f deploy/compose.caddy.yml up -d
```

**Content pipeline (Python, never runs in production):**
```bash
cd content-tools && uv sync
uv run sj-ingest    # Easton's → staging/entities_raw.yaml
uv run sj-generate  # AI question generation (requires ANTHROPIC_API_KEY)
uv run sj-review    # interactive review CLI → appends to content/packs/*.yaml
```

## Architecture

### Monorepo layout

`app/` is a pnpm workspace with three packages:

| Package | Purpose |
|---------|---------|
| `packages/types` | Shared TypeScript types — all Socket.IO event payloads and domain types |
| `server` | Fastify 5 + Socket.IO 4 — game logic, REST API, DB persistence |
| `web` | SvelteKit (static adapter) + Tailwind 4 — host and player UIs |

Both `server` and `web` import `@scripturejam/types` for the event contract. **The types package is the source of truth for the Socket.IO event contract** — changes to it ripple into both sides.

### Server internals

The Fastify server and Socket.IO server share the same Node `http.Server` instance. Socket.IO uses a Redis adapter (`@socket.io/redis-adapter`) so multiple server instances can share room state.

**Session lifecycle:**
- Sessions live in **Redis** (not Postgres) for low-latency real-time access via `session/store.ts`
- Session results are persisted to **Postgres** (via Drizzle ORM) only at `finalizeSession()`
- Migrations run automatically on server startup (`db/migrate.ts`)
- Content (questions, avatars, Bible text) is loaded from YAML at startup into a module-level singleton (`content/loader.ts`) — it is read-only at runtime

**State machine** (`session/state-machine.ts`):
```
lobby → question → reveal → question (loop)
                          → final
```
`canTransition(from, to)` guards every state change. The game engine (`game/engine.ts`) is the only place that drives transitions.

**Socket.IO rooms:**
- `host:<code>` — host browser
- `player:<code>` — all players in the session

**Scoring** (`scoring/index.ts`): `500 + 500 × speedRatio` for correct answers; 0 for wrong. Pure function, unit-tested.

**Rate limiting** (`middleware/rate-limit.ts`): per-IP and global caps on session creation enforced at the HTTP layer before the session is created.

### Content structure

`content/` is baked into the Docker image at build time:
- `content/packs/*.yaml` — question packs (each file: `pack` metadata + `questions[]`)
- `content/avatars/entities.yaml` — avatar entity list
- `content/bible/<TRANSLATION>.yaml` — KJV / WEB / ASV verse text (not in repo — ingest separately; see `content/bible/README.md`)

Content YAML schemas are in `content/packs/schema.json` and `content/avatars/schema.json`. CI validates content on every push that touches `content/`.

### Web routes

| Route | Who sees it |
|-------|-------------|
| `/host` | Create a new session |
| `/host/[code]` | Host game dashboard |
| `/j/[code]` | Player join (nickname + avatar pick) |
| `/p/[code]` | Player game screen |
| `/r/[code]` | Results / final leaderboard |

### Key environment variables

See `.env.example` for the full list. Required at runtime: `IP_HASH_SECRET`, `DATABASE_URL`, `REDIS_URL`, `PUBLIC_URL`. The content-tools pipeline also needs `ANTHROPIC_API_KEY` (never at runtime).
