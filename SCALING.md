# Scaling $Send to millions of users — the honest plan

**Straight talk first:** a single Node.js process with an embedded SQLite database — what $Send runs today — **cannot** serve *millions of concurrent users at the same instant*. No single process or single database file can. Anyone who tells you otherwise is selling something. What you *can* do is (1) make the current app **refuse to crash** under load spikes — it degrades gracefully instead of falling over — and (2) follow a well-worn path to a horizontally‑scaled architecture that genuinely handles millions concurrent. This doc covers both: what's already done, and exactly what to change.

---

## Part 1 — Crash‑resistance under load (DONE, in the code today)

These make the current single box survive traffic spikes, slow clients, and bad input without the process dying:

- **The process never dies on a stray error.** Global `uncaughtException` / `unhandledRejection` handlers log and keep serving; every HTTP request is wrapped in a top‑level `try/catch` that returns `500` instead of crashing; malformed HTTP triggers a `clientError → 400` instead of a socket crash.
- **Connections can't pile up forever.** `keepAliveTimeout` (30s), `headersTimeout` (35s, slowloris protection) and `requestTimeout` (60s) shed idle/stuck sockets.
- **SQLite is tuned for concurrency.** `WAL` journal (concurrent readers + one writer), `busy_timeout=5000` (writers wait instead of throwing `SQLITE_BUSY`), `synchronous=NORMAL` (fast + safe under WAL).
- **No unbounded memory growth.** A periodic sweeper prunes every in‑memory map (rate‑limit buckets, OAuth states, pending logins, anti‑gaming activity logs). Per‑user history is capped (notifications ≤ 50, watchlist ≤ 500). Caches carry TTLs (nav balances 60s, on‑chain pair data 30s, watchlist enrichment 60s **shared across all users watching the same token**).
- **Expensive work is centralized + cached, not per‑request.** The on‑chain sweep (RPC + Blockscout + Dexscreener) runs at most once per 30s and every client is served the cached result — a spike of readers does **not** multiply into a spike of chain reads. External calls have abort timeouts so one slow upstream can't wedge a request.
- **Abuse is rate‑limited** per IP/user on every mutating endpoint.

Pair this with a **process manager** (systemd / pm2 / a container orchestrator) that auto‑restarts on a truly fatal exit, and the app stays up.

**Realistic capacity of the current design, tuned:** comfortably **thousands** of concurrent users on one modest box (most traffic is cached reads + static files). That is *not* millions — for that, read Part 2.

---

## Part 2 — The architecture for millions concurrent

The rule that forces every change below: **make the app tier stateless and move all shared state to services that scale independently.** Then you run many identical app instances behind a load balancer and add instances as traffic grows.

```
                       ┌───────────── CDN (static + edge cache) ─────────────┐
   millions of users → │  Cloudflare / Fastly: serves HTML/CSS/JS/images,    │
                       │  caches GET /api/pairs/new at the edge (~5–10s TTL)  │
                       └───────────────────────┬─────────────────────────────┘
                                               │  (only uncached / write traffic)
                                        ┌──────▼──────┐  Load Balancer (L7)
                                        └──────┬──────┘
                    ┌──────────────┬───────────┼───────────┬──────────────┐
                 app inst 1     app inst 2   app inst 3   …            app inst N   ← stateless, autoscaled
                    └──────┬───────────┬───────────┬───────────┬──────────┘
                           │           │           │           │
              ┌────────────▼───┐  ┌────▼─────┐  ┌──▼─────────┐  ┌▼───────────────┐
              │  Postgres      │  │  Redis   │  │ Object store│  │ On‑chain worker│
              │ (primary +     │  │ sessions │  │ (S3/R2) for │  │ (1–few procs)  │
              │  read replicas)│  │ + rate   │  │  uploads    │  │ sweeps chain,  │
              │  users/posts/  │  │  limits  │  │             │  │ writes pairs → │
              │  watchlist/    │  │ + caches │  │             │  │ Redis/Postgres │
              │  notifications │  │ + pub/sub│  │             │  │                │
              └────────────────┘  └──────────┘  └─────────────┘  └────────────────┘
```

### What must change (and why)

| Piece | Today | Change to | Why |
|---|---|---|---|
| **Database** | embedded SQLite (local file, single writer) | **Postgres** (or MySQL/Cloud SQL), primary + read replicas | A file DB can't be shared by many app instances and serializes all writes. Postgres does connection pooling, replication, and high write concurrency. This is the #1 change. |
| **Sessions** | `sessions` table + in‑proc reads | **Redis** (or stateless signed JWT cookies) | Any instance must resolve any user's session without hitting the primary DB every request. |
| **Rate limits / anti‑gaming buckets / OAuth state / pending logins** | in‑process `Map`s | **Redis** (with TTLs) | In‑memory state is per‑instance — limits leak and CSRF/login state breaks the moment there's more than one instance. Redis makes them shared + atomic (`INCR`/`EXPIRE`). |
| **Static assets** | served by Node | **CDN** | Offloads the overwhelming majority of requests (HTML/CSS/JS/images) to edge PoPs near users; Node never sees them. |
| **`GET /api/pairs/new`** | per‑instance 30s cache | **edge‑cache at the CDN (~5–10s)** + a shared cache in Redis | It's identical for everyone — cache it once at the edge and a million readers cost you ~nothing. |
| **On‑chain sweep + enrichment** | runs inside the web process | a **dedicated worker** (1–few) writing results to Redis/Postgres | You want the chain scanned once globally, not once per app instance. Web instances just read the shared result. |
| **Uploads (avatars/post images)** | local `data/uploads` | **object storage (S3/Cloudflare R2)** + CDN | Local disk isn't shared across instances and doesn't scale. |
| **Watchlist enrichment** | in‑proc `Map` cache | **Redis** cache (already keyed by token, already TTL'd — just move the store) | Shared across instances; popular tokens enriched once globally. |
| **Real‑time updates** | client polls every 5s | optional: **SSE / WebSockets** via a pub/sub layer, or keep polling but serve it from the edge cache | Polling is fine at the edge; push cuts origin load further if needed. |
| **Deploy** | one process | **N stateless containers**, autoscaled (Kubernetes / ECS / Fly / Render), health checks + rolling deploys | Add capacity by adding instances; the LB spreads load; a dying instance is replaced automatically. |

### The migration is mechanical, not a rewrite
The app is already close to stateless: it's a thin HTTP router over a data layer. The work is (a) swap the `node:sqlite` calls for a Postgres client (same SQL, prepared statements port directly), (b) move the handful of in‑memory `Map`s to Redis, (c) point uploads at object storage, (d) split the on‑chain refresher into its own worker, and (e) put a CDN in front. None of it changes the product; all of it is standard, boring infrastructure.

### Bottom line
- **Right now:** the app won't crash on a load spike — it sheds load and degrades gracefully — and one tuned box handles thousands of concurrent users.
- **For millions concurrent:** do Part 2. It's a known, low‑risk path (stateless app tier + Postgres + Redis + CDN + object storage + an autoscaler). Until that infra is in place, "millions at once" is an infrastructure goal, not a code toggle — and this doc is the checklist to get there.
