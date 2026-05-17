# scripturejam

scripturejam is a self-hosted Kahoot-style Bible quiz app for live church events. Host runs a session on a big screen; players join from their mobile browsers with a QR scan or short code. Scripture reference shown on every answer reveal — the teaching moment is the point.

## Requirements

- Docker and Docker Compose (v2)
- A public hostname (for Cloudflare Tunnel or Caddy path)

## Quickstart — Cloudflare Tunnel (no inbound ports required)

1. `git clone <repo-url> && cd scripturejam/deploy`
2. `cp ../.env.example .env` then edit `.env` — fill in `IP_HASH_SECRET`, Postgres password, and `TUNNEL_TOKEN`
3. In Nginx Proxy Manager, add a proxy host pointing at `app:3000` on the `scripturejam_internal` Docker network
4. `docker compose -f docker-compose.yml -f compose.cloudflare.yml up -d`
5. Visit your public URL at `/host` to create a session

## Quickstart — Caddy (direct internet, needs static IP)

1. `git clone <repo-url> && cd scripturejam/deploy`
2. `cp ../.env.example .env` then edit `.env` — fill in `IP_HASH_SECRET`, Postgres password, and `PUBLIC_HOSTNAME=quiz.example.com`
3. `docker compose -f docker-compose.yml -f compose.caddy.yml up -d`
4. Caddy handles Let's Encrypt automatically
5. Visit `https://quiz.example.com/host` to create a session

## Upgrade

```bash
docker compose pull && docker compose up -d
```

Migrations run automatically on app start.

## Environment variables

See `.env.example` for the full list with comments. Key variables:

| Variable | Purpose |
|----------|---------|
| `IP_HASH_SECRET` | HMAC secret for audit-log IP hashing (required) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `PUBLIC_URL` | Public base URL (e.g. `https://quiz.example.com`) |
| `PUBLIC_HOSTNAME` | Domain for Caddy TLS (Caddy path only) |
| `TUNNEL_TOKEN` | Cloudflare Tunnel token (Cloudflare path only) |
| `POSTGRES_USER/PASSWORD/DB` | Postgres credentials for Docker Compose |

## Tech stack

Node.js 22, Fastify, Socket.IO, SvelteKit (static), PostgreSQL 16, Redis 7, Docker Compose.
