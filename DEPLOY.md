# Deploying JustSendIt

This app is a **single long-running Node process** backed by an on-disk SQLite database
(`node:sqlite`). That shapes every hosting choice:

- **Node ≥ 24 required** (`node:sqlite` / `DatabaseSync`). On 24 it works flag-free; on 22.5–23.x it exists only
  behind `--experimental-sqlite`, so pin **Node 24** to keep `node server.js` simple. (`npm start` and the systemd
  unit below pass `--disable-warning=ExperimentalWarning` to silence the harmless "SQLite is experimental" line.)
- **State lives on local disk** — the DB (`data/app.db` + WAL) and user uploads (`data/uploads/`).
  So it needs **one instance with a persistent volume**, *not* serverless functions and *not*
  multiple auto-scaled instances sharing nothing. (See **Scaling to millions** at the bottom.)
- It speaks **plain HTTP**; TLS is terminated by a reverse proxy / platform in front of it.
- **No custody, no private keys** — all chain data is read from public RPC/Blockscout/Dexscreener.

Two good paths: **(A) a small VPS + Caddy** (recommended, cheapest, full control) or
**(B) a managed platform with a volume** (Fly.io / Render / Railway). Pick one.

---

## What you must provide manually

| Thing | Needed? | Notes |
|---|---|---|
| **A domain name** | Yes | Point its DNS at your server. |
| **A host** | Yes | VPS ($6–12/mo) or a PaaS with a persistent disk. |
| `BASE_URL` | Yes | Your `https://` origin. Drives OAuth redirects + Secure cookies. |
| Social login keys | Optional | Google / Facebook / X / Instagram OAuth app IDs + secrets. Each provider is **auto-enabled only if both its ID and secret are set**. Redirect URL to register: `https://sendrh.com/api/auth/<provider>/callback`. Providers require moving the app from "testing" to "published/verified" before the public can log in — **start that review early**. |
| `MOONPAY_API_KEY` | Optional | Enables the in-page fiat "Buy" widget; without it the site links to MoonPay's generic buy page. Requires a MoonPay account. |

Everything else (wallet login, email/password, 2FA, the whole app) works with **zero** third-party keys.

---

## A. VPS + Caddy (recommended)

### 1. Provision
Create an Ubuntu 22.04/24.04 box (Hetzner, DigitalOcean, Linode). SSH in as a sudo user.

### 2. Install Node 24
```
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs
```

### 3. Get the code + install deps
Copy the project to `/opt/justsendit` (git, `scp`, or `rsync`). Then:
```
cd /opt/justsendit && npm ci --omit=dev
```
> **Do not copy your local `data/` folder** — it holds *your* dev accounts. The app creates a fresh
> `data/app.db` on first boot. (`.gitignore` already excludes `data/`, `.env`, and `node_modules/`.)

### 4. Configure env
```
cp .env.example .env && nano .env
```
Set at least:
```
DATA_KEY=<64 hex chars — node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
BASE_URL=https://sendrh.com
NODE_ENV=production
PORT=8642
COOKIE_SECURE=1
TRUST_PROXY=1
```
`BASE_URL` also drives every absolute SEO / share URL (canonical, og:*, twitter:*, JSON-LD, sitemap.xml, robots.txt) —
they are rewritten at serve time, so nothing in `public/` needs editing on deploy.
(Plus any OAuth / MoonPay keys you have.)

### 5. Run it under systemd (auto-restart + starts on boot)
Create `/etc/systemd/system/justsendit.service`:
```
[Unit]
Description=JustSendIt
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/justsendit
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server.js
Restart=always
RestartSec=2
# systemd sends SIGTERM on stop/restart; the app drains, checkpoints SQLite, and exits cleanly.
KillSignal=SIGTERM
TimeoutStopSec=15
User=www-data
Group=www-data
# EnvironmentFile is optional — the app also reads ./.env itself.
EnvironmentFile=/opt/justsendit/.env

[Install]
WantedBy=multi-user.target
```
Make sure the data dir is writable by the service user, then enable it:
```
sudo chown -R www-data:www-data /opt/justsendit/data && sudo systemctl enable --now justsendit
```
Check: `sudo systemctl status justsendit` and `curl localhost:8642/healthz` → `{"ok":true}`.

### 6. TLS + domain with Caddy
Point an **A record** for `sendrh.com` at the server's IP, and a second one (or a CNAME) for
`www.sendrh.com`. Install Caddy, then `/etc/caddy/Caddyfile`:
```
sendrh.com {
	encode zstd gzip
	reverse_proxy localhost:8642
}

# One canonical hostname, and it is the apex. Do not skip this block.
www.sendrh.com {
	redir https://sendrh.com{uri} permanent
}
```
`sudo systemctl reload caddy` — Caddy fetches and auto-renews a Let's Encrypt cert for both names. Done: the
site is live at `https://sendrh.com`. (Caddy sets `X-Forwarded-For`, which the app reads because
`TRUST_PROXY=1`.)

**Why the `www` redirect is not optional.** `BASE_URL` is the site's single identity: the app compares every
write request's `Origin` header against it and rejects a mismatch as cross-origin. So if someone reaches the
app on `www.sendrh.com` while `BASE_URL=https://sendrh.com`, the pages render fine and then **every POST
returns 403** — no signup, no login, no posting — which looks like the site is broken rather than like a DNS
problem. Serving both names is the failure; redirecting one to the other is the fix. (It is also what keeps
Google from indexing two copies and splitting the ranking between them.) If you would rather have `www` be
the canonical name, that is fine too — just flip both the redirect and `BASE_URL` together, and never run
them on different hostnames.

---

## B. Managed platform (Fly.io / Render / Railway)

Same app, less server admin. The key requirement: **attach a persistent volume mounted at the
project's `data/` path**, or the DB and uploads vanish on redeploy.

- **Start command:** `npm start` (i.e. `node server.js`).
- **Node version:** pin 24 (via `engines` in `package.json`, already set, or the platform's runtime setting).
- **Env vars:** set `BASE_URL`, `COOKIE_SECURE=1`, `TRUST_PROXY=1` (+ optional keys) in the dashboard.
- **Health check path:** `/healthz`.
- **Volume:** mount a disk at `data/` (e.g. Fly `[mounts] destination="/app/data"`, Render "Disk", Railway volume).
- **Scaling:** keep it at **exactly one instance** — multiple instances would each get their own SQLite
  file and in-memory caches (see below).

`fly.toml` in the repo is a working Fly config with all of that already set. Two lines in it are load-bearing
and easy to "optimize" into a bug: `auto_stop_machines = false` and `min_machines_running = 1`. Seventeen
background timers record price and runner history on a clock; a machine asleep at 3am does not miss requests,
it misses **history**, and nothing can backfill it. On Fly, set the key as a secret rather than an env entry:

```bash
fly secrets set DATA_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

---

## C. Docker / Compose

`Dockerfile`, `.dockerignore` and `docker-compose.yml` are in the repo. On a box with Docker:

```bash
cp .env.example .env    # set DATA_KEY at minimum
docker compose up -d --build
```

That publishes the app on `127.0.0.1:8642` only — put Caddy (section A.6) or Cloudflare in front for TLS —
and keeps `/app/data` on a named volume. A few things worth knowing before you change any of it:

- **The volume is the site.** Database, WAL, uploads, the encryption key and the backups all live there.
  `docker compose down -v` deletes it. There is no undo.
- **The container starts as root and immediately drops to `node`.** That is not sloppiness: a fresh volume
  or bind mount arrives root-owned, and a container that has already dropped privileges cannot fix it, so
  `scripts/entrypoint.sh` chowns `/app/data` and then `exec gosu node`. Nothing that serves traffic is root.
- **tini is PID 1** so `docker stop` sends a SIGTERM that actually reaches node, which is what lets SQLite
  checkpoint instead of dying mid-write.
- **One container.** Scaling the service to 2 gives you two databases, not twice the capacity.

---

## Backups that survive losing the box

The app already snapshots SQLite hourly, safely (an online backup between 256-page steps, so requests never
stall), keeping the last 7 days. By default those land in `data/backups` — **on the same volume as the
database they protect**. That covers corruption and a bad migration. It does not cover losing the volume,
which is the failure that actually ends a site.

Point `BACKUP_DIR` at something outside the volume and copy it off the host:

```
BACKUP_DIR=/backups
```

Then, whichever of these fits your host:

```bash
# object storage (S3, Cloudflare R2, Backblaze) — cheapest and least to go wrong
0 * * * * rclone sync /backups remote:sendrh-backups --max-age 8d

# or pull them somewhere else entirely
0 * * * * rsync -az --delete user@host:/backups/ /local/sendrh-backups/
```

**Back up `DATA_KEY` separately, somewhere the database backups are not.** A backup you cannot decrypt is
not a backup — emails, wallet links, tracked wallets and 2FA secrets are all encrypted at rest with it. If
the key sits in the same bucket as the dump, one leaked credential loses both halves at once.

**Test a restore before you need one.** Copy a snapshot to a scratch host, set the same `DATA_KEY`, boot it,
and sign in. An untested backup is a hypothesis.

## Telegram scanner bot (optional)

The token scanner can run as a Telegram bot that anyone can add to their own group, so a contract address
pasted into a chat can be checked without leaving it. It is off unless you configure it, and the site is
completely unaffected either way.

1. Message **@BotFather** on Telegram, send `/newbot`, and follow the prompts.
2. Put the token it gives you in `.env`:

   ```
   TELEGRAM_BOT_TOKEN=1234567890:AA...
   ```

3. Still in @BotFather, run `/setjoingroups` for your bot and **allow** groups. Leave **privacy mode ON**
   (the default): the bot then only ever receives messages addressed to it, not everything said in the group.
4. Restart. The log will say `🤖 Telegram scanner live as @yourbot`.

**Webhook vs polling is automatic.** With a public `https://` `BASE_URL` the bot registers a webhook at
`/api/telegram/webhook`, authenticated with a secret header derived from the bot token — there is nothing
extra to set. Without one (local dev, or before you have a domain) it long-polls instead, which needs no
public URL at all. The two are mutually exclusive and the app handles the switch.

**Usage:** `/scan <address>` in any chat, or just send an address in a DM. `t.me/yourbot?start=<address>`
deep-links straight to a scan of that token — the New Pairs page uses this for its per-token
"📡 Scan in Telegram" link.

**Limits:** 6 scans per chat per minute, because each one is a real read of the chain and the explorer.

**Note on the token:** it is the entire credential for the bot. It lives only in `.env` (git-ignored), is
never written to a log line, and is never sent anywhere but Telegram. If it leaks, run `/revoke` in
@BotFather immediately.

## Operate

- **Health:** `GET /healthz` → `200 {"ok":true}` (answered before any DB work — perfect for LB/uptime probes).
- **Logs:** `journalctl -u justsendit -f` (VPS) or the platform's log view. Whenever the process looks like
  production (`NODE_ENV=production`, an `https` `BASE_URL`, or `COOKIE_SECURE`/`TRUST_PROXY` set) the boot prints
  `⚠️` warnings if `BASE_URL`/`COOKIE_SECURE`/`TRUST_PROXY` look misconfigured — including a forgotten `BASE_URL`.
- **Restart / deploy:** `sudo systemctl restart justsendit`. The app catches SIGTERM, finishes in-flight
  requests, checkpoints the WAL, and exits cleanly — no corruption, no WAL bloat.
- **Backups (built in):** `data/app.db` is your entire user base. The server itself writes one consistent snapshot
  per UTC day to `data/backups/app-YYYY-MM-DD.db` (SQLite's online backup API via `node:sqlite` — safe while
  running, never blocks requests; the last 7 are kept; set `BACKUP_DIR` to move them). **Copy that directory
  off-box** (object storage / rsync) on a schedule, and copy `data/uploads/` alongside it — avatars, headers and
  post media live there and are referenced from the DB.
- **The data key:** personal data in `app.db` is encrypted under `DATA_KEY`. Keep the key in the environment (not in
  `data/`), store a copy in your password manager, and never put it next to the backups — a backup plus the key is the
  whole user base; a backup alone is unreadable. Rotating the key is not supported in place (it would need a re‑encrypt
  pass), so treat it as permanent.
- **Restore:** `sudo systemctl stop justsendit` → copy the snapshot over `data/app.db` → **delete** any
  `data/app.db-wal` and `data/app.db-shm` left beside it (a stale WAL from the old file would corrupt the restored
  one) → restore `data/uploads/` → `chown -R www-data data` → `sudo systemctl start justsendit`. Never copy a
  snapshot over a running server's DB.

## What's already built in (performance)

- **gzip** on static assets and large API JSON (≈80% smaller payloads → fewer packets, faster loads).
- **In-memory static cache** — hot CSS/JS/HTML served from RAM (pre-gzipped), no per-request disk read.
- **Batched feed queries** — the Send Wall does ~5 DB queries per page instead of ~5 per post.
- **Indexed hot paths** — Wall (score/new), profile walls, comment counts, leaderboard, followers.
- **Tuned SQLite** (WAL, 16 MB cache, 256 MB mmap, memory temp store, auto-checkpoint) + an 8s
  leaderboard cache + periodic WAL checkpointing so the DB file stays small and fast.
- **Crash-resistant** — process-level error handlers, socket timeouts, slowloris protection, graceful shutdown.

---

## Scaling to millions (the honest part)

One well-tuned node handles a **real launch** — comfortably thousands of concurrent users and millions of
requests/day. It does **not** serve *millions concurrently*, because two things are fundamentally single-node:

1. **`node:sqlite` is synchronous** — every query briefly blocks the event loop. Great latency at low/medium
   load; a hard ceiling under massive concurrency.
2. **State is local** — the SQLite file, the uploads folder, and in-memory state live inside one process, so you
   can't just run 10 copies behind a load balancer. Some of that state is only a **staleness** problem
   (`lbCache`, `lookupCache`, `pairsCache`, rate-limit buckets), but some is **correctness-critical for auth** and
   would cause hard login failures the instant a second instance exists: **sessions** (in SQLite), and the
   in-memory **`oauthStates`** and **`pendingLogins`** maps (an OAuth callback or 2FA step could land on a
   different instance than the one that started it). This is why **"exactly one instance" is load-bearing** until
   you move that state to a shared store.

To actually reach millions concurrent (the plan in `SCALING.md`), provision and migrate to:

- **Managed Postgres** (or libSQL/Turso) in place of the local SQLite file — shared, async, replicated.
- **Redis** for sessions, the OAuth-state + pending-2FA-login maps, rate limits, and the shared caches (so many
  app instances stay consistent and logins don't fail across instances).
- **Object storage** (S3/R2) + **CDN** for uploads and static assets, so files aren't tied to one box and
  edges absorb read traffic.
- **N stateless app instances** behind a load balancer, health-checked at `/healthz`, autoscaled.
- A **background worker** for the chain scans (New Pairs / holder refresh) instead of doing them in-request.

That's an infrastructure build (managed services + cost), not a code tweak — but the app is already
structured to slot into it (env-driven config, `/healthz`, graceful shutdown, `TRUST_PROXY`, no in-request
secrets). Do it when real traffic demands it; ship on one node first.
