# Deployment

## Prerequisites

- Docker 24+ and Docker Compose v2
- A `.env` file (copy from `.env.example` and fill in required vars)

## Option A — Cloudflare Tunnel (recommended)

No inbound ports needed on the VM. Requires a Cloudflare account and a Tunnel token.

```bash
cp .env.example .env
# Edit .env: set IP_HASH_SECRET and TUNNEL_TOKEN
docker compose -f deploy/docker-compose.yml -f deploy/compose.cloudflare.yml up -d
```

In Cloudflare Zero Trust → Tunnels → your tunnel, add a public hostname:
- Public hostname: `quiz.yourdomain.com`
- Service: `http://app:3000` (internal docker network)

## Option B — Caddy with Let's Encrypt

Requires a static IP / port-forward and a domain pointed at the host.

```bash
cp .env.example .env
# Edit .env: set IP_HASH_SECRET
# Edit deploy/Caddyfile: replace quiz.example.org with your domain
docker compose -f deploy/docker-compose.yml -f deploy/compose.caddy.yml up -d
```

## Upgrade

```bash
docker compose pull
docker compose up -d
```

Postgres migrations run automatically on app start. In-flight sessions survive
restarts under ~5s (Redis state preserved; Socket.IO clients reconnect).

## Environment variable reference

See `.env.example` — every var is documented inline.

## Backup

```bash
# Postgres
docker compose exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql

# Restore
docker compose exec -T postgres psql -U $POSTGRES_USER $POSTGRES_DB < backup.sql
```

Redis holds only ephemeral session state with TTLs — no backup needed.

## Logs

```bash
docker compose logs -f app
```

The app emits one JSON line per request and one per significant WebSocket event.
