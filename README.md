# scripturejam

scripturejam is a self-hosted Kahoot-style Bible quiz app for live church events. Host runs a session on a big screen; players join from their mobile browsers with a QR scan or short code. Scripture reference shown on every answer reveal — the teaching moment is the point.

---

## Requirements

- Docker and Docker Compose (v2)
- A public hostname (for Cloudflare Tunnel or Caddy path)

---

## Install

### Raspberry Pi (one-line installer)

Installs Docker, clones the repo, generates secrets, and starts the stack — all in one command.

```bash
curl -fsSL https://raw.githubusercontent.com/darqlab/scripturejam/main/scripts/install.sh | sudo bash
```

The installer will offer to download the Bible texts during setup. Once complete, open the host console in a browser on the same network:

```
http://<pi-ip>:4000/host
```

Players join at `http://<pi-ip>:4000/j/<code>` or by scanning the QR code shown on the host screen.

**Manage the stack:**

```bash
/opt/yard/scripturejam/scripts/up.sh       # start
/opt/yard/scripturejam/scripts/down.sh     # stop
/opt/yard/scripturejam/scripts/deploy.sh   # rebuild + restart
/opt/yard/scripturejam/scripts/backup.sh   # pg_dump → backups/
```

> Re-running the installer on an existing installation pulls the latest code and skips secret generation. Your data and `.env` are preserved.

---

### Cloudflare Tunnel (no inbound ports required)

```bash
git clone <repo-url> && cd scripturejam/deploy
cp ../.env.example .env
```

Edit `.env` — fill in `IP_HASH_SECRET`, Postgres password, and `TUNNEL_TOKEN`.
In Nginx Proxy Manager, add a proxy host pointing at `app:3000` on the `scripturejam_internal` network.

```bash
docker compose -f docker-compose.yml -f compose.cloudflare.yml up -d
```

Visit your public URL at `/host` to create a session.

### Caddy (direct internet, needs static IP)

```bash
git clone <repo-url> && cd scripturejam/deploy
cp ../.env.example .env
```

Edit `.env` — fill in `IP_HASH_SECRET`, Postgres password, and `PUBLIC_HOSTNAME=quiz.example.com`.

```bash
docker compose -f docker-compose.yml -f compose.caddy.yml up -d
```

Caddy handles Let's Encrypt automatically. Visit `https://quiz.example.com/host` to create a session.

---

## Bible texts

Verse text is shown on every answer reveal — the core teaching moment. The three translations (KJV, WEB, ASV) are not bundled in the repo but must be generated once and baked into the Docker image.

**Requirements:** Python 3.10+, [uv](https://docs.astral.sh/uv/), curl

```bash
bash content-tools/scripts/install-bible-texts.sh
```

The script downloads KJV, WEB, and ASV from [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases) (public domain), indexes them into `content/bible/*.yaml` (~17 MB total), and prints next steps.

After running, rebuild the image to bake the texts in:

```bash
cd /opt/yard/scripturejam && ./scripts/deploy.sh
```

> The generated YAML files are not committed to the repo. Re-run the script after a fresh clone.

---

## Upgrade

```bash
docker compose pull && docker compose up -d
```

Migrations run automatically on app start.

---

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

---

## Tech stack

Node.js 22, Fastify, Socket.IO, SvelteKit (static), PostgreSQL 16, Redis 7, Docker Compose.
