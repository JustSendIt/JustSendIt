/* JustSendIt backend — zero-framework Node + built-in SQLite.
 * Auth: wallet signature, email/password (+2FA: TOTP or wallet), Google/Facebook OAuth (env-gated).
 * Public: Send Wall feed + per-user walls (username/avatar/theme only). Everything else private.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync, backup: sqliteBackup } = require('node:sqlite'); // backup() = online, consistent, non-blocking snapshot (Node ≥ 23.8)
const { verifyMessage, getAddress } = require('ethers');   // getAddress: EIP-55 checksum, required by the EIP-4361 parser in wallets
const QRCode = require('qrcode');

// Load a local .env if present (dependency-free) — real environment variables always win over the file.
// Handy for a VPS/systemd deploy; on a PaaS you can just set the vars in its dashboard and skip the file.
(() => {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (let line of txt.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('='); if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch {} // no .env file → rely on the real environment
})();

const PORT = process.env.PORT || 8642;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

/* ===== Encryption at rest =====
   Personal data — emails, wallet↔account links, OAuth subjects, 2FA secrets, tracked wallets, sign-in nonces, tracker
   reports, IPs — is stored AES-256-GCM-encrypted under DATA_KEY, with an HMAC "blind index" wherever the server needs an
   equality lookup (login by email, wallet by address, one-opt-in-per-IP). Session cookies are stored as SHA-256 hashes.
   A stolen app.db without the key is unreadable. Set DATA_KEY (64 hex chars) in production; otherwise a key is generated
   once into data/.data_key (chmod 600) — back it up SEPARATELY from the DB. */
const DATA_KEY = (() => {
  const hex = String(process.env.DATA_KEY || '').trim();
  if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
  const kf = path.join(DATA_DIR, '.data_key');
  try { const t = fs.readFileSync(kf, 'utf8').trim(); if (/^[0-9a-f]{64}$/i.test(t)) return Buffer.from(t, 'hex'); } catch {}
  const k = crypto.randomBytes(32);
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(kf, k.toString('hex') + '\n', { mode: 0o600 }); } catch (e) { console.error('could not persist the data key:', e.message); }
  console.warn('🔐 Generated a new DATA_KEY at ' + kf + ' — back it up SEPARATELY from data/app.db (in production set DATA_KEY in the environment instead). Losing it makes every encrypted field unreadable.');
  return k;
})();
const IDX_KEY = crypto.createHmac('sha256', DATA_KEY).update('blind-index').digest();
function encField(s) {
  if (s == null) return null;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', DATA_KEY, iv);
  const ct = Buffer.concat([c.update(String(s), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decField(s) {
  if (s == null) return null;
  s = String(s); if (!s.startsWith('v1:')) return s; // pre-migration plaintext (migrated at boot; kept for safety)
  try {
    const b = Buffer.from(s.slice(3), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', DATA_KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return null; }
}
const bidx = (s) => crypto.createHmac('sha256', IDX_KEY).update(String(s == null ? '' : s)).digest('hex'); // equality lookups only
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');                     // session cookie → stored form
const safeJson = (s) => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- DB ---------- */
const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
// node:sqlite has no statement cache: every db.prepare() recompiles the SQL, and compilation costs ~2-4× the execution
// itself on our small queries. Memoize by SQL text — the ~340 call sites keep working unchanged, and the cache is
// bounded because even the dynamically-built `IN (?,?,…)` queries only vary over a handful of arities.
// (Safe: nothing in this file uses statement.iterate(), so no cached statement is ever mid-iteration when reused.)
{
  const _prepare = db.prepare.bind(db), _stmts = new Map();
  db.prepare = (sql) => { let st = _stmts.get(sql); if (!st) { st = _prepare(sql); _stmts.set(sql, st); } return st; };
}
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA cache_size = -16000;        -- ~16 MB page cache in RAM (negative value = KiB) → fewer disk reads
PRAGMA mmap_size = 268435456;      -- 256 MB memory-mapped reads → hot pages served straight from the page cache
PRAGMA temp_store = MEMORY;        -- keep temp b-trees / ORDER BY sorts in RAM, not on disk
PRAGMA wal_autocheckpoint = 1000;  -- fold the WAL back into the DB every ~1000 pages so it can't bloat unbounded
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  avatar TEXT NOT NULL DEFAULT '🚀',
  bio TEXT NOT NULL DEFAULT '',
  auto_named INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  identifier TEXT NOT NULL,
  secret TEXT,
  UNIQUE(type, identifier)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nonces (
  address TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'signin',    -- what the signature is allowed to authorise (see NONCE_PURPOSES)
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (address, purpose)             -- one live challenge per wallet PER JOB, not one per wallet
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  image TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reactions (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id, kind)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS post_votes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL,               -- +1 upvote, -1 downvote
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS tracked_wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, address)
);
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE TABLE IF NOT EXISTS points_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  base INTEGER NOT NULL,
  mult REAL NOT NULL DEFAULT 1,
  ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pe_user ON points_events(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pe_ref ON points_events(ref) WHERE ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS holder_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score_bp INTEGER NOT NULL DEFAULT 0,   -- combined (%SEND + %GWC of supply) * 10000
  send_tok REAL NOT NULL DEFAULT 0,
  gwc_tok REAL NOT NULL DEFAULT 0,
  streak_start INTEGER,                  -- start of current no-sell hold streak
  last_check INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS watchlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pair_addr TEXT NOT NULL,
  token_addr TEXT NOT NULL,
  token0 TEXT, token1 TEXT,
  quote_symbol TEXT,
  snapshot TEXT,                          -- last-known enriched pair JSON (fallback when it's aged out of the live set)
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, pair_addr)
);
CREATE INDEX IF NOT EXISTS idx_wl_user ON watchlist(user_id, added_at);
CREATE TABLE IF NOT EXISTS pinned_tokens (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_addr TEXT NOT NULL,
  pair_addr TEXT,
  symbol TEXT,
  name TEXT,
  brand TEXT,                             -- JSON {imageUrl} for the chip logo (sanitized to the Dexscreener CDN)
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, token_addr)       -- pin a token once (public "convicted in" list on your wall)
);
CREATE INDEX IF NOT EXISTS idx_pins_user ON pinned_tokens(user_id, added_at);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  icon TEXT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,  -- the Send Wall widget post
  token_addr TEXT NOT NULL, pair_addr TEXT NOT NULL,
  symbol TEXT, name TEXT, quote_symbol TEXT, token0 TEXT, token1 TEXT,
  entry_price REAL NOT NULL,          -- USD price at call time (basis for Xs)
  entry_mc REAL,                      -- market cap at call time (for display)
  peak_price REAL NOT NULL,           -- highest price observed since the call (ATH-since-call, max Xs)
  peak_at INTEGER,
  cur_price REAL, cur_mc REAL,
  last_check INTEGER,
  awarded_x INTEGER NOT NULL DEFAULT 0, -- highest whole-X milestone already awarded points for
  wallet TEXT,                        -- caller's public wallet (for one-tap tracking / PNL), if they have one linked
  snapshot TEXT,                      -- enriched pair JSON at call time (branding, on-chain data)
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, token_addr)         -- one active call per token per user
);
CREATE INDEX IF NOT EXISTS idx_calls_user ON calls(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_calls_created ON calls(created_at);
CREATE INDEX IF NOT EXISTS idx_calls_token ON calls(token_addr);
CREATE TABLE IF NOT EXISTS call_hops (
  call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (call_id, user_id)
);
-- (no idx_hops_call: call_hops' PRIMARY KEY already indexes call_id first, so a second index was pure write cost)
CREATE INDEX IF NOT EXISTS idx_hops_user ON call_hops(user_id);
CREATE TABLE IF NOT EXISTS communities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_addr    TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- one community per token
  pair_addr     TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  name          TEXT NOT NULL,
  brand         TEXT,                                  -- sanitized JSON {imageUrl,header,websites,socials}
  status        TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'live'
  member_count  INTEGER NOT NULL DEFAULT 0,            -- ALL opt-ins (denormalized)
  qual_count    INTEGER NOT NULL DEFAULT 0,            -- opt-ins that COUNT toward go-live (anti-sybil)
  xp            INTEGER NOT NULL DEFAULT 0,            -- community XP -> levelForXp()
  activity      REAL NOT NULL DEFAULT 0,               -- time-decayed velocity (grid sort only)
  activity_at   INTEGER NOT NULL DEFAULT 0,
  founder_paid  INTEGER NOT NULL DEFAULT 0,            -- 1 once founder bonus awarded
  creator_ip    TEXT,                                  -- clientIp() at create (anti-self-deal)
  c_price REAL, c_mc REAL, c_pc24 REAL, c_liq REAL, c_holders INTEGER, c_at INTEGER,  -- grid market cache
  created_at    INTEGER NOT NULL,
  went_live_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_comm_status_act ON communities(status, activity DESC);
CREATE INDEX IF NOT EXISTS idx_comm_creator ON communities(creator_id);
CREATE TABLE IF NOT EXISTS community_members (
  community_id  INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at     INTEGER NOT NULL,
  conviction_xp INTEGER NOT NULL DEFAULT 0,            -- per-member exponential XP -> levelForXp()
  qualified     INTEGER NOT NULL DEFAULT 0,            -- 1 if this opt-in counted toward go-live
  join_ip       TEXT,
  PRIMARY KEY (community_id, user_id)                  -- one opt-in per user per community
);
CREATE INDEX IF NOT EXISTS idx_cm_user ON community_members(user_id);
CREATE INDEX IF NOT EXISTS idx_cm_comm ON community_members(community_id, conviction_xp DESC);
-- ===== Community proposals: verified holders decide anything, in two rounds =====
-- Round 1 promotes on >=50% of DECISIVE votes (yes+no; abstains are deliberately excluded from the
-- threshold but DO count toward quorum, so "present and neutral" is a real third option rather than
-- a silent No). Round 2 passes on >=75% of decisive votes. Tallies and quorum are frozen at close,
-- so a sell-off after the fact can never rewrite a decided proposal.
CREATE TABLE IF NOT EXISTS proposals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  community_id  INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  author_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  tokens        TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',   -- draft|open|round2|passed|rejected|expired
  electorate    INTEGER NOT NULL DEFAULT 0,      -- qual_count frozen when voting opened (record date)
  quorum_r1     INTEGER NOT NULL DEFAULT 0,
  quorum_r2     INTEGER NOT NULL DEFAULT 0,
  r1_yes INTEGER, r1_no INTEGER, r1_abs INTEGER, -- written ONCE at close, never recomputed
  r2_yes INTEGER, r2_no INTEGER, r2_abs INTEGER,
  reason        TEXT,
  deadline      INTEGER,                         -- next moment this row needs attention; NULL when terminal
  created_at    INTEGER NOT NULL,
  opened_at     INTEGER,                         -- round 1 start AND the electorate record date
  r1_ends_at    INTEGER,
  r2_opened_at  INTEGER,
  r2_ends_at    INTEGER,
  resolved_at   INTEGER,
  author_ip     TEXT                             -- bidx() blind index only, like communities.creator_ip
);
CREATE INDEX IF NOT EXISTS idx_prop_comm   ON proposals(community_id, status, id DESC);
CREATE INDEX IF NOT EXISTS idx_prop_author ON proposals(author_id, community_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_prop_due    ON proposals(deadline) WHERE deadline IS NOT NULL;
CREATE TABLE IF NOT EXISTS proposal_votes (
  proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  round       INTEGER NOT NULL,                  -- round 2 is a FRESH ballot: one row per round
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choice      TEXT NOT NULL,                     -- yes|no|abstain
  created_at  INTEGER NOT NULL,
  vote_ip     TEXT,                              -- bidx() blind index, anti-sybil audit only
  PRIMARY KEY (proposal_id, round, user_id)      -- one vote per holder per round, and it is final
);
-- no idx on proposal_votes(proposal_id): the PK already leads with it, so the tally is covered
CREATE INDEX IF NOT EXISTS idx_pv_user ON proposal_votes(user_id, proposal_id);
-- ===== Community holder snapshots: the chain, frozen at a moment =====
-- Rows are stored as gzipped JSON chunks rather than one row per holder: a token with 30k holders
-- would otherwise add 30k rows per snapshot, and a snapshot is only ever read whole.
CREATE TABLE IF NOT EXISTS holder_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  community_id   INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  token_addr     TEXT NOT NULL,                 -- denormalised so a snapshot survives community edits
  requested_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status         TEXT NOT NULL,                 -- running | complete | partial | failed
  reason         TEXT,                          -- why it is partial/failed, shown to the reader verbatim
  started_at     INTEGER NOT NULL,
  finished_at    INTEGER,
  symbol         TEXT,
  decimals       INTEGER NOT NULL DEFAULT 18,
  total_supply   TEXT,                          -- raw uint256 decimal string
  supply_held    TEXT,                          -- raw sum of stored balances
  holder_count   INTEGER NOT NULL DEFAULT 0,
  expected_count INTEGER,                       -- explorer's own holder count, for the completeness check
  pages          INTEGER NOT NULL DEFAULT 0,
  top20          TEXT                           -- JSON [[addr, rawValue]] so the header renders without unzipping
);
CREATE INDEX IF NOT EXISTS idx_snap_comm ON holder_snapshots(community_id, id DESC);

/* Block-0 sniper scans, one row per token. block0 is IMMUTABLE once found (the first block a pool ever paid
   a token out cannot change), so it is never re-derived; only the balances and the ledger are re-read. */
CREATE TABLE IF NOT EXISTS sniper_scans (
  token_addr   TEXT PRIMARY KEY,
  pair_addr    TEXT,
  status       TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | partial | failed
  reason       TEXT,                             -- why it is partial or failed, in plain words
  block0       INTEGER,
  block0_at    INTEGER,
  data         TEXT,                             -- the JSON payload the API and the panel render
  calls        INTEGER,
  started_at   INTEGER,
  finished_at  INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sniper_status ON sniper_scans(status, finished_at);
CREATE TABLE IF NOT EXISTS holder_snapshot_chunks (
  snapshot_id INTEGER NOT NULL REFERENCES holder_snapshots(id) ON DELETE CASCADE,
  chunk       INTEGER NOT NULL,
  n           INTEGER NOT NULL,                 -- holders in this chunk
  blob        BLOB NOT NULL,                    -- gzip(JSON [[addr, rawValue], ...])
  PRIMARY KEY (snapshot_id, chunk)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS runner_tokens (
  token_addr   TEXT PRIMARY KEY,                     -- lowercased
  pair_addr    TEXT,
  symbol       TEXT,
  name         TEXT,
  brand        TEXT,                                 -- JSON {imageUrl}
  first_price  REAL,                                 -- price the very first time we saw it (all-time baseline)
  first_mc     REAL,
  first_seen_at INTEGER NOT NULL,
  peak_price   REAL,                                 -- highest trustworthy price observed since first seen
  peak_at      INTEGER,
  cur_price    REAL,
  cur_mc       REAL,
  cur_liq      REAL,
  cur_pc24     REAL,                                 -- Dexscreener 24h % change (the accurate 24h figure)
  cur_holders  INTEGER,
  cur_health   INTEGER,
  last_seen_at INTEGER                               -- last time we refreshed its price
);
CREATE INDEX IF NOT EXISTS idx_runner_seen ON runner_tokens(last_seen_at);
CREATE TABLE IF NOT EXISTS runner_snaps (
  token_addr TEXT NOT NULL,                          -- time-series price points (for trailing-window baselines)
  at         INTEGER NOT NULL,
  price      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runner_snaps ON runner_snaps(token_addr, at);
CREATE TABLE IF NOT EXISTS uploads (
  name       TEXT PRIMARY KEY,                       -- the /uploads filename
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bytes      INTEGER NOT NULL,
  kind       TEXT NOT NULL,                          -- image | gif | video
  created_at INTEGER NOT NULL,
  claimed    INTEGER NOT NULL DEFAULT 0              -- 1 once referenced by a post; unclaimed uploads are swept
);
CREATE INDEX IF NOT EXISTS idx_uploads_sweep ON uploads(claimed, created_at);
-- Persistent token-detail cache: every token the scanner surfaces (radar feed OR a /api/pairs/lookup) is stored here as
-- its full enriched pair object, so future reads are INSTANT (served from disk, survive restarts) while a background loop
-- keeps the hot ones fresh from on-chain data. found=0 is a negative cache (looked up, not priced/indexed).
CREATE TABLE IF NOT EXISTS token_cache (
  token_addr   TEXT PRIMARY KEY,                       -- lowercased
  pair_json    TEXT,                                   -- full enriched pair object (what NPCard renders); NULL when found=0
  symbol       TEXT,
  name         TEXT,
  found        INTEGER NOT NULL DEFAULT 1,             -- 0 = looked up but no priced/indexed pair (negative cache)
  reason       TEXT,                                   -- notFound reason (e.g. 'quote'), if any
  updated_at   INTEGER NOT NULL,                       -- last time we refreshed it from on-chain
  last_read_at INTEGER NOT NULL,                       -- last client read (drives refresh priority + pruning)
  reads        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_token_cache_read ON token_cache(last_read_at);
CREATE INDEX IF NOT EXISTS idx_token_cache_fresh ON token_cache(found, updated_at);
`);
// additive migrations (SQLite has no ADD COLUMN IF NOT EXISTS)
for (const col of [
  "ALTER TABLE users ADD COLUMN accent TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN wall_bg TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN avatar_img TEXT",
  "ALTER TABLE users ADD COLUMN header_img TEXT",
  "ALTER TABLE users ADD COLUMN bg_img TEXT",
  "ALTER TABLE users ADD COLUMN twofa_method TEXT",
  "ALTER TABLE users ADD COLUMN twofa_secret TEXT",
  "ALTER TABLE users ADD COLUMN twofa_pending TEXT", // TOTP secret staged by /setup; promoted to twofa_secret only when /enable proves a code
  "ALTER TABLE users ADD COLUMN twofa_enabled_at INTEGER", // when 2FA was turned on — only wallets linked BEFORE this can serve as the wallet factor
  "ALTER TABLE identities ADD COLUMN linked_at INTEGER",   // when a wallet identity was linked (NULL for pre-migration rows = legacy, accepted)
  "ALTER TABLE notifications ADD COLUMN actor_id INTEGER", // who triggered a social notification (per-actor flood cap)
  "ALTER TABLE identities ADD COLUMN identifier_enc TEXT",   // encrypted email / wallet / OAuth subject; `identifier` becomes its blind index
  "ALTER TABLE tracked_wallets ADD COLUMN address_enc TEXT", // encrypted address; `address` becomes its blind index
  "ALTER TABLE sessions ADD COLUMN hashed INTEGER NOT NULL DEFAULT 0", // 1 once `token` holds sha256(cookie) instead of the cookie
  "ALTER TABLE nonces ADD COLUMN msg TEXT",                  // the exact (encrypted) domain-bound message the wallet was asked to sign
  "ALTER TABLE posts ADD COLUMN tokens TEXT",                // JSON [{addr,symbol,name}] — contract addresses in the text resolved to $TICKERs
  "ALTER TABLE comments ADD COLUMN tokens TEXT",
  "ALTER TABLE communities ADD COLUMN official INTEGER NOT NULL DEFAULT 0", // the $Send / $GWC house communities — pinned first, always live
  "ALTER TABLE users ADD COLUMN system INTEGER NOT NULL DEFAULT 0",         // the site's own account (owns official communities; never ranked)
  "ALTER TABLE communities ADD COLUMN xp_week INTEGER NOT NULL DEFAULT 0",  // XP earned inside the CURRENT week (weekly competition)
  "ALTER TABLE communities ADD COLUMN week_key TEXT",                       // which week xp_week belongs to; a new week resets it
  "ALTER TABLE users ADD COLUMN arcade_boost REAL NOT NULL DEFAULT 0",      // Rocket Run cash-out multiplier (0 = none)
  "ALTER TABLE users ADD COLUMN arcade_boost_until INTEGER NOT NULL DEFAULT 0", // when that boost expires (24h after the run)
  "ALTER TABLE users ADD COLUMN arcade_day TEXT",                           // UTC day of the last run — one run per day
  "ALTER TABLE users ADD COLUMN tracker_prefs TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE users ADD COLUMN site_prefs TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE holder_state ADD COLUMN base_bp INTEGER NOT NULL DEFAULT 0", // peak %supply during the current streak (for sell detection vs a baseline, not just the last check)
  "ALTER TABLE holder_state ADD COLUMN send_bp INTEGER NOT NULL DEFAULT 0", // %SEND of supply * 10000 (verified on-chain, for the holdings viz)
  "ALTER TABLE holder_state ADD COLUMN gwc_bp INTEGER NOT NULL DEFAULT 0",  // %GWC of supply * 10000
  "ALTER TABLE holder_state ADD COLUMN gwc_streak_start INTEGER",           // start of the $GWC-only no-sell streak (reward holding $GWC longer, independent of $SEND)
  "ALTER TABLE holder_state ADD COLUMN gwc_base_bp INTEGER NOT NULL DEFAULT 0", // peak %GWC during that streak (for $GWC sell detection)
  "ALTER TABLE posts ADD COLUMN score INTEGER NOT NULL DEFAULT 0",          // denormalized net vote score (up − down) for Top sorting
  "ALTER TABLE posts ADD COLUMN call_id INTEGER",                           // if set, this post is a Send Call widget (references calls.id)
  "ALTER TABLE calls ADD COLUMN entry_liq REAL",                            // pooled liquidity (USD) at call time — anti-farm floor + leaderboard filter
  "ALTER TABLE calls ADD COLUMN dead INTEGER NOT NULL DEFAULT 0",           // 1 when Dexscreener stopped pricing the token (delisted/rugged) → "Now" shown as unknown
  "ALTER TABLE calls ADD COLUMN hold_x REAL NOT NULL DEFAULT 0",            // ∫ (positive Xs × hours held) — diamond-hands accumulator for the caller
  "ALTER TABLE calls ADD COLUMN hold_paid REAL NOT NULL DEFAULT 0",         // base hold-bonus points already paid to the caller (idempotency)
  "ALTER TABLE call_hops ADD COLUMN entry_price REAL",                      // token price when the hopper hopped on (their Xs basis)
  "ALTER TABLE call_hops ADD COLUMN hold_x REAL NOT NULL DEFAULT 0",        // diamond-hands accumulator for the hopper
  "ALTER TABLE call_hops ADD COLUMN hold_paid REAL NOT NULL DEFAULT 0",     // base hold-bonus points already paid to the hopper
  "ALTER TABLE call_hops ADD COLUMN last_check INTEGER",                    // last time the hopper's Xs were sampled (for the time integral)
  // anti-gaming / read-only restriction state
  "ALTER TABLE users ADD COLUMN restricted_until INTEGER NOT NULL DEFAULT 0", // read-only until this ms timestamp (0 = free)
  "ALTER TABLE users ADD COLUMN restrict_level INTEGER NOT NULL DEFAULT 0",   // 0 none · 1 = 24h tier served · 2 = 1-week tier
  "ALTER TABLE users ADD COLUMN restrict_reason TEXT",                        // human-readable why, shown to the user
  "ALTER TABLE users ADD COLUMN strikes INTEGER NOT NULL DEFAULT 0",          // times flagged (drives 24h→1wk→permanent escalation)
  "ALTER TABLE users ADD COLUMN flagged_at INTEGER NOT NULL DEFAULT 0",       // last flag time
  // dynamic Send Call daily limit
  "ALTER TABLE users ADD COLUMN twitter_handle TEXT",                         // public X/Twitter handle (no @), shown on the user's wall
  "ALTER TABLE users ADD COLUMN ig_handle TEXT",                              // public Instagram handle (no @), shown on the user's wall
  "ALTER TABLE users ADD COLUMN call_limit INTEGER NOT NULL DEFAULT 5",       // current EARNED daily call limit (1–5, before diamond boost)
  "ALTER TABLE users ADD COLUMN call_eval_at INTEGER",                        // last time the earned limit was re-evaluated (≤ once/24h); NULL = never
  "ALTER TABLE calls ADD COLUMN scored INTEGER NOT NULL DEFAULT 0",           // 1 once this matured call has been counted toward a daily limit adjustment
  // read-only redemption: buy & hold $SEND to lift a restriction early (sell before the hold is up → it returns, doubled)
  "ALTER TABLE users ADD COLUMN redeem_base_send REAL NOT NULL DEFAULT 0",    // $SEND balance snapshot when the restriction was applied (baseline to detect a genuine buy)
  "ALTER TABLE users ADD COLUMN redeem_hold_until INTEGER NOT NULL DEFAULT 0",// probation end: must hold the bought $SEND until this ms (0 = not in probation)
  "ALTER TABLE users ADD COLUMN redeem_floor REAL NOT NULL DEFAULT 0",        // $SEND balance that must be maintained through probation (sell below → penalty)
  "ALTER TABLE users ADD COLUMN redeem_dur INTEGER NOT NULL DEFAULT 0",       // the restriction's duration (ms) — the required hold length, and doubles on a broken probation
  // Send Call SIZE: how much $ the caller/hopper actually spent buying the token on-chain (each $100 = 1× Send Power boost)
  "ALTER TABLE calls ADD COLUMN entry_spend_usd REAL NOT NULL DEFAULT 0",     // USD the caller spent buying the called token (read on-chain at call time)
  "ALTER TABLE calls ADD COLUMN no_dyor INTEGER NOT NULL DEFAULT 0",          // 1 = caller made this call WITHOUT opening the token's full on-chain detail first
  "ALTER TABLE calls ADD COLUMN rugged INTEGER NOT NULL DEFAULT 0",           // 1 = the token's liquidity was pulled (rug) — permanent record + a −2 caller penalty (applied once)
  "ALTER TABLE call_hops ADD COLUMN spend_usd REAL NOT NULL DEFAULT 0",       // USD this follower spent buying the token (min bought & still held — the size-multiplier basis)
  // OG status: bought $SEND or $GWC within the first month of launch (verified on-chain, read-only) → permanent OG badge + 10× Send Power
  "ALTER TABLE users ADD COLUMN og INTEGER NOT NULL DEFAULT 0",               // 1 = verified OG (early buyer)
  "ALTER TABLE users ADD COLUMN og_checked_at INTEGER NOT NULL DEFAULT 0",    // last time we scanned this (non-OG) user's wallets for an early buy (throttle re-scans)
  "ALTER TABLE users ADD COLUMN og_revoked INTEGER NOT NULL DEFAULT 0",       // 1 = OG was removed for selling out the ENTIRE position — never re-granted
  "ALTER TABLE call_hops ADD COLUMN bought_usd REAL NOT NULL DEFAULT 0",      // USD value of what they bought from the pool (what they "sent" into the coin)
  "ALTER TABLE call_hops ADD COLUMN held_usd REAL NOT NULL DEFAULT 0",        // USD value of what they still HOLD (0 = sold out / no position)
  // Communities: a flat 10× Send Power while qualified in ≥1 live community; posts can belong to a community wall
  "ALTER TABLE users ADD COLUMN live_comm_count INTEGER NOT NULL DEFAULT 0",  // # of LIVE communities this user qualifies in (drives the flat 10× flag)
  "ALTER TABLE communities ADD COLUMN demo INTEGER NOT NULL DEFAULT 0",       // 1 = open sandbox community: no token required, and deliberately grants no 10×
  "ALTER TABLE posts ADD COLUMN community_id INTEGER",                        // NULL = Send Wall / profile; set = a community wall
  "ALTER TABLE posts ADD COLUMN private INTEGER NOT NULL DEFAULT 0",          // 1 = the community's holders-only wall: readable ONLY by its verified holders
  // Support board: the same posts/comments/votes machinery under its own namespace. NULL = the Send Wall
  // (every existing feed query filters on that), 'support' = a question on the help desk. One column instead
  // of a parallel table means comments, voting, muting, reporting, moderation and deletion all work there on
  // day one, with no second implementation to keep in step.
  "ALTER TABLE posts ADD COLUMN board TEXT",
  // Send Power decay: when it was last applied, and how many consecutive days of absence it has seen
  "ALTER TABLE users ADD COLUMN decay_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN decay_streak INTEGER NOT NULL DEFAULT 0",
  /* Wallet challenges are bound to WHAT they authorise. One generic "Read-only sign-in" message used to be
     accepted for signing in, enabling wallet 2FA, DISABLING two-factor and adding an email — so a signature a
     wallet truthfully rendered as a read-only sign-in could strip an account's second factor, and the person
     signing had no way to tell the difference. The purpose is now in the text the wallet shows AND checked on
     the way back in. Keyed per (address, purpose) so a sign-in challenge no longer clobbers a management one. */

  "CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board, score DESC, id DESC)",
  // Convicted In: reference price/mcap captured when the token was pinned (basis for "Xs up since you convicted")
  "ALTER TABLE pinned_tokens ADD COLUMN pin_price REAL",                      // USD price at pin time (0/NULL = no baseline, e.g. legacy pin)
  "ALTER TABLE pinned_tokens ADD COLUMN pin_mc REAL",                         // market cap at pin time (for reference)
  "ALTER TABLE community_members ADD COLUMN qual_check_at INTEGER",           // last time we re-verified this member still holds the community's token (drives the holder-continuity sweep)
  "ALTER TABLE users ADD COLUMN upload_bytes INTEGER NOT NULL DEFAULT 0",     // running total of stored upload bytes for this user (per-account media quota)
  // OG tiers: the same standard, three entry windows. `og` stays as the boolean every existing read
  // depends on; og_tier is the payout. Appended at the tail so no existing statement's position moves.
  "ALTER TABLE users ADD COLUMN og_tier INTEGER NOT NULL DEFAULT 0",          // 0 none · 1 bronze (3×) · 2 silver (5×) · 3 gold (10×)
  "ALTER TABLE users ADD COLUMN og_buy_ms INTEGER NOT NULL DEFAULT 0",        // earliest verified market acquisition of the LATER of the two coins — the timestamp the tier was derived from
  "ALTER TABLE users ADD COLUMN og_dq INTEGER NOT NULL DEFAULT 0",            // 1 = failed the dump / net-accumulator standard (distinct from og_revoked, which is a later sell-out)
  "ALTER TABLE calls ADD COLUMN points_paid INTEGER NOT NULL DEFAULT 0",     // lifetime Send Power this ONE call has paid its caller (post-multiplier) — the basis for CALL_POINTS_CAP
  "ALTER TABLE call_hops ADD COLUMN points_paid INTEGER NOT NULL DEFAULT 0", // same, per hopper on that call
  "ALTER TABLE users ADD COLUMN og_try_at INTEGER NOT NULL DEFAULT 0",
  // Biggest Sender weekly competition: the prize is a Send Power boost, by finishing rank, that lasts the following week
  "ALTER TABLE users ADD COLUMN week_boost REAL NOT NULL DEFAULT 0",          // the prize boost, by last week's finishing rank (0 = none)
  "ALTER TABLE users ADD COLUMN week_boost_until INTEGER NOT NULL DEFAULT 0", // when it expires — the end of the week after the one it was won in
  "ALTER TABLE users ADD COLUMN week_boost_key TEXT",                         // which competition week it was won in
  "ALTER TABLE points_events ADD COLUMN comp_amount INTEGER NOT NULL DEFAULT 0", // what the award would have paid without a Biggest Sender prize — what the weekly board ranks
  "ALTER TABLE api_keys ADD COLUMN wallets_idx TEXT",
  "ALTER TABLE api_keys ADD COLUMN expires_at INTEGER",                        // one year from mint for burn-backed keys; NULL = never (Gold OG)
  "ALTER TABLE api_keys ADD COLUMN source TEXT NOT NULL DEFAULT 'burn'",       // burn | og_gold
  "ALTER TABLE api_keys ADD COLUMN consumed_wei TEXT",
  "CREATE INDEX IF NOT EXISTS idx_arcade_day ON arcade_rounds(day)",                                        // the hub counts today's flights every 8 s
  "CREATE INDEX IF NOT EXISTS idx_users_arcade_boost ON users(arcade_boost_until) WHERE arcade_boost > 1", // …and the pilots boosted right now                         // the $SEND this key spent                          // blind indexes of the linked wallets at mint (a burn backs one live key at a time). CREATE TABLE IF NOT EXISTS carries it on a fresh DB; this lands it on an existing one        // last time a scan was ATTEMPTED, win or lose — og_checked_at only records a CLEAN result, so an always-failing account would sort first forever and block the queue
]) { try { db.exec(col); } catch {} }

/* The nonces table was keyed on (address) alone, so asking for a second challenge for the same wallet
   REPLACED the first. That is why one generic "Read-only sign-in" signature was accepted for signing in, for
   arming two-factor and for turning it off: there was only ever one row, so there was nothing to tell them
   apart. Purposes cannot coexist until the key does, and a column cannot be added to a primary key in place,
   so the table is rebuilt once. Dropping it costs nothing — every row is a single-use challenge that expires
   in ten minutes, so the worst case is someone taps "sign" again. */
try {
  const t = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='nonces'").get();
  if (t && !/PRIMARY KEY \(address, purpose\)/.test(t.sql)) {
    db.exec("DROP TABLE IF EXISTS nonces; CREATE TABLE nonces (address TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'signin', nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, msg TEXT, PRIMARY KEY (address, purpose));");
    console.log('🔑 rebuilt the wallet-challenge table keyed on (address, purpose)');
  }
} catch (e) { console.error('nonces rebuild failed:', e.message); }

// Performance indices — added AFTER the migrations so the score/points columns they reference exist.
// These cover the hottest read paths: the Send Wall (Top = score, New = id), profile walls (user_id),
// per-post comment counts, the leaderboard (points), follower lookups, and session-sweep by expiry.
db.exec(`
CREATE INDEX IF NOT EXISTS idx_comments_post   ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_posts_score     ON posts(score DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user      ON posts(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_users_points    ON users(points DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_posts_comm ON posts(community_id, id DESC) WHERE community_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_runner_snaps_at ON runner_snaps(at);            -- the 60s prune sweep was full-scanning the table
CREATE INDEX IF NOT EXISTS idx_notif_actor ON notifications(user_id, actor_id, created_at); -- notifyOnce dedupe + per-actor flood cap
CREATE INDEX IF NOT EXISTS idx_pe_created ON points_events(created_at);         -- the Biggest Sender week window scans by time, not by user
`);
// idx_hops_call duplicated call_hops' own PRIMARY KEY index — pure write overhead, so drop the one already on disk
try { db.exec('DROP INDEX IF EXISTS idx_hops_call'); } catch {}
db.exec('PRAGMA optimize;'); // let SQLite build/refresh stat samples for the query planner on boot
// One-time repair: OG badges left on accounts with NO linked wallet (the badge now follows the wallet — see /api/wallet/disconnect).
// Not a revoke: relinking the early-buyer wallet re-verifies on-chain and re-grants.
// Backfill first, repair second — in that order. Every existing og=1 row was granted by checkOg()
// under the 30-day rule, which is exactly the gold window, so gold is the correct tier for all of
// them and no chain re-scan is needed. The `og_tier = 0` predicate makes it idempotent and stops it
// ever demoting a tier the new checkOg() has since assigned.
try { db.prepare('UPDATE users SET og_tier = 3 WHERE og = 1 AND og_tier = 0').run(); } catch {}
// Private per-user preference blobs join the encrypted-at-rest set (they were the last private fields
// stored in the clear). One-shot per row: decField() passes legacy plaintext through, so a row is only
// rewritten while it still lacks the v1: prefix.
try { for (const r of db.prepare("SELECT id, tracker_prefs, site_prefs FROM users WHERE tracker_prefs NOT LIKE 'v1:%' OR site_prefs NOT LIKE 'v1:%'").all())
  db.prepare('UPDATE users SET tracker_prefs = ?, site_prefs = ? WHERE id = ?').run(String(r.tracker_prefs || '').startsWith('v1:') ? r.tracker_prefs : encField(r.tracker_prefs || '{}'), String(r.site_prefs || '').startsWith('v1:') ? r.site_prefs : encField(r.site_prefs || '{}'), r.id); } catch {}
// Send Power awards made before comp_amount existed count at face value on the weekly board (no prize
// existed to take out). Community XP, conviction XP and activity rows share this table but are NOT Send
// Power — they never touch users.points — so they are excluded here and in the standings query; without
// that exclusion a restart promoted them onto the board and the settled winner depended on deploy timing.
try { db.prepare("UPDATE points_events SET comp_amount = amount WHERE comp_amount = 0 AND amount > 0 AND kind NOT IN ('commxp','convxp','commact')").run(); } catch {}
// A burn-backed key always carries an expiry: any row minted before expiries existed gets its year from its mint.
try { db.prepare("UPDATE api_keys SET expires_at = minted_at + 31536000000 WHERE expires_at IS NULL AND source = 'burn'").run(); } catch {}
// The repair has to clear the tier too, or a wallet-less account keeps a stale tier (and its payout).
try { db.prepare("UPDATE users SET og = 0, og_tier = 0 WHERE og = 1 AND og_revoked = 0 AND id NOT IN (SELECT user_id FROM identities WHERE type = 'wallet')").run(); } catch {}

// Moderation (mutes) + per-user wallet-tracker report cache (encrypted at rest)
db.exec(`
CREATE TABLE IF NOT EXISTS competitions (
  week_key   TEXT PRIMARY KEY,                       -- ISO week, same key the community board uses
  starts_at  INTEGER NOT NULL,
  ends_at    INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',           -- open | settled
  settled_at INTEGER,
  winners    TEXT                                    -- JSON [{user_id, username, rank, points, boost}] once settled
);
CREATE TABLE IF NOT EXISTS api_keys (
  key_hash     TEXT PRIMARY KEY,                     -- sha256 of the key; the key itself is shown once and never stored
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet       TEXT,                                 -- the linked wallet whose burn qualified it — encField()ed, like every wallet↔account link
  burned_wei   TEXT NOT NULL,                        -- total $SEND sent to the burn address across linked wallets, at mint
  burned_usd   REAL NOT NULL,                        -- its value at mint, at the $SEND price then
  price_usd    REAL NOT NULL,
  minted_at    INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER,
  wallets_idx  TEXT,                                 -- JSON of blind indexes of every linked wallet at mint: a burn backs ONE live key at a time, on any account
  expires_at   INTEGER,                              -- burn-backed keys live one year from mint (renewal adds a year); NULL = never (Gold OG)
  source       TEXT NOT NULL DEFAULT 'burn',         -- burn | og_gold
  consumed_wei TEXT                                  -- the $SEND this key spent (worth its threshold on mint day); the ledger below says from which wallets
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, revoked_at);
CREATE TABLE IF NOT EXISTS api_key_burns (
  key_hash   TEXT NOT NULL,                          -- never deleted: a spent burn stays spent even after the key is revoked
  wallet_idx TEXT NOT NULL,                          -- blind index of the wallet the burn came from
  wei        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_key_burns_wallet ON api_key_burns(wallet_idx);
CREATE TABLE IF NOT EXISTS mutes (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, muted_id)
);
CREATE TABLE IF NOT EXISTS tracker_cache (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addr_idx   TEXT NOT NULL,                 -- blind index of the tracked address
  report     TEXT NOT NULL,                 -- encrypted JSON report (what the browser computed from chain data)
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, addr_idx)
);
CREATE INDEX IF NOT EXISTS idx_mutes_muted ON mutes(muted_id);
-- Rocket Run rounds. crash_x is written at START and never leaves the server until the round resolves, so the
-- browser can animate the climb without ever knowing where it ends. Survives a restart, so a crash mid-round
-- can't strand a player's one daily go.
CREATE TABLE IF NOT EXISTS arcade_rounds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  crash_x    REAL NOT NULL,
  cashed_x   REAL,                              -- NULL until they cash out (or bust)
  boost      REAL,
  ended_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_arcade_user ON arcade_rounds(user_id, id DESC);
`);
// One-time, idempotent: move personal data that is still in the clear under the encryption key (only rows not yet done)
try {
  db.exec('BEGIN');
  for (const r of db.prepare('SELECT id, identifier FROM identities WHERE identifier_enc IS NULL').all())
    db.prepare('UPDATE identities SET identifier_enc = ?, identifier = ? WHERE id = ?').run(encField(r.identifier), bidx(r.identifier), r.id);
  for (const r of db.prepare('SELECT id, address FROM tracked_wallets WHERE address_enc IS NULL').all())
    db.prepare('UPDATE tracked_wallets SET address_enc = ?, address = ? WHERE id = ?').run(encField(r.address), bidx(r.address), r.id);
  for (const r of db.prepare('SELECT token FROM sessions WHERE hashed = 0').all())
    db.prepare('UPDATE sessions SET token = ?, hashed = 1 WHERE token = ?').run(hashToken(r.token), r.token);
  for (const r of db.prepare("SELECT id, twofa_secret, twofa_pending FROM users WHERE (twofa_secret IS NOT NULL AND twofa_secret NOT LIKE 'v1:%') OR (twofa_pending IS NOT NULL AND twofa_pending NOT LIKE 'v1:%')").all())
    db.prepare('UPDATE users SET twofa_secret = ?, twofa_pending = ? WHERE id = ?').run(r.twofa_secret && !r.twofa_secret.startsWith('v1:') ? encField(r.twofa_secret) : r.twofa_secret, r.twofa_pending && !r.twofa_pending.startsWith('v1:') ? encField(r.twofa_pending) : r.twofa_pending, r.id);
  for (const r of db.prepare('SELECT id, creator_ip FROM communities WHERE creator_ip IS NOT NULL AND length(creator_ip) <> 64').all())
    db.prepare('UPDATE communities SET creator_ip = ? WHERE id = ?').run(bidx(r.creator_ip), r.id);
  for (const r of db.prepare('SELECT community_id, user_id, join_ip FROM community_members WHERE join_ip IS NOT NULL AND length(join_ip) <> 64').all())
    db.prepare('UPDATE community_members SET join_ip = ? WHERE community_id = ? AND user_id = ?').run(bidx(r.join_ip), r.community_id, r.user_id);
  db.prepare('DELETE FROM nonces').run(); // ten-minute artifacts; the domain-bound format replaces them
  db.exec('COMMIT');
} catch (e) { try { db.exec('ROLLBACK'); } catch {} console.error('encryption migration failed:', e && e.message); }

/* ---------- helpers ---------- */
const now = () => Date.now();
const rand = (n = 32) => crypto.randomBytes(n).toString('hex');

const MAX_PW = 1024; // cap password length so scrypt can't be weaponized for CPU DoS
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw).slice(0, MAX_PW), salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return test.length === ref.length && crypto.timingSafeEqual(test, ref);
}
// run a scrypt of comparable cost even when the account doesn't exist,
// so response timing can't be used to enumerate emails/usernames
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));
function dummyCheck(pw) { try { checkPassword(pw, DUMMY_HASH); } catch {} }

/* ---------- TOTP (RFC 6238, HMAC-SHA1, 30s steps) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(str) {
  let bits = 0, val = 0; const out = [];
  for (const c of str.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpCode(secretB32, step = Math.floor(Date.now() / 30000)) {
  const key = b32decode(secretB32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24 | h[off + 1] << 16 | h[off + 2] << 8 | h[off + 3]) % 1e6;
  return String(code).padStart(6, '0');
}
function totpVerify(secretB32, code) {
  if (!secretB32) return false;
  const step = Math.floor(Date.now() / 30000);
  const c = String(code || '').replace(/\D/g, ''); // digits only — avoids multibyte length mismatch in timingSafeEqual
  if (c.length !== 6) return false;
  return [step - 1, step, step + 1].some(s => {
    const expect = totpCode(secretB32, s);
    return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(c));
  });
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
function usernameTaken(u) { return !!db.prepare('SELECT 1 FROM users WHERE username = ?').get(u); }
function autoUsername() {
  for (let i = 0; i < 50; i++) {
    const u = 'sender_' + crypto.randomBytes(3).toString('hex');
    if (!usernameTaken(u)) return u;
  }
  return 'sender_' + rand(6);
}
function createUser(username, autoNamed) {
  const r = db.prepare('INSERT INTO users (username, auto_named, created_at) VALUES (?,?,?)').run(username, autoNamed ? 1 : 0, now());
  return Number(r.lastInsertRowid);
}
function createSession(userId) {
  const token = rand();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(hashToken(token), userId, now(), now() + 30 * 864e5); // a DB leak never yields a usable cookie
  return token;
}
// Secure whenever we serve https OR are told we sit behind TLS termination (COOKIE_SECURE=1)
const cookieSecure = () => (BASE_URL.startsWith('https') || process.env.COOKIE_SECURE === '1') ? '; Secure' : '';
function sessionCookie(token) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${cookieSecure()}`;
}
function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const s = part.trim(); if (!s) continue;
    const eq = s.indexOf('=');
    if (eq === -1) continue;
    out[s.slice(0, eq).trim()] = s.slice(eq + 1).trim(); // split on FIRST '=' so values with '=' survive
  }
  return out;
}
function getUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (!cookies.sid) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(hashToken(cookies.sid), now()); // only the hash is stored
  if (!s) return null;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  return u ? { ...u, sid: cookies.sid, sid_at: s.created_at } : null;   // sid_at: credential changes check what predates this session
}
function themeOf(u) {
  return {
    accent: u.accent || '',
    wall_bg: u.wall_bg || '',
    avatar_img: u.avatar_img ? '/uploads/' + u.avatar_img : null,
    header_img: u.header_img ? '/uploads/' + u.header_img : null,
    bg_img: u.bg_img ? '/uploads/' + u.bg_img : null,
  };
}
function identityTypes(userId) {
  return db.prepare('SELECT type FROM identities WHERE user_id = ?').all(userId).map(r => r.type);
}
function walletAddresses(userId) {
  return db.prepare("SELECT identifier_enc FROM identities WHERE user_id = ? AND type = 'wallet' ORDER BY id").all(userId).map(r => decField(r.identifier_enc)).filter(Boolean);
}
// identities are looked up by blind index and stored encrypted — the real value never sits in the clear in the DB
function findIdentity(type, value) { return db.prepare('SELECT * FROM identities WHERE type = ? AND identifier = ?').get(type, bidx(value)); }
function insertIdentity(userId, type, value, secret) {
  db.prepare('INSERT INTO identities (user_id, type, identifier, identifier_enc, secret, linked_at) VALUES (?,?,?,?,?,?)').run(userId, type, bidx(value), encField(value), secret || null, now());
}
function emailIdentity(userId) { return db.prepare("SELECT * FROM identities WHERE type = 'email' AND user_id = ?").get(userId); }
const SITE_HOST = (() => { try { return new URL(BASE_URL).host; } catch { return 'localhost'; } })();
/* Domain-bound sign-in messages, in the EXACT EIP-4361 (Sign-In with Ethereum) layout.
   The format is not cosmetic. Naming the host inside the text only helps a reader who stops to read raw
   hex-prefixed text in a signing dialog, which nobody does. What actually protects them is the wallet
   RECOGNISING the message: MetaMask and friends parse it, and only when it parses do they draw the
   "Sign-in request" panel and — the part that stops the attack — warn when the site asking does not match
   the domain named in the message. A near-miss string gets none of that and renders as an opaque blob.

   So every byte here matters to the parser: line 1 must end "wants you to sign in with your Ethereum
   account:", line 2 must be the bare EIP-55 checksummed address, and `Version: 1` is mandatory. Field
   order is fixed by the ABNF. The server still accepts only the exact string it issued and stores it
   encrypted with a 10-minute expiry, so this changes what the WALLET can tell the user, not what we trust. */
function signInMessage(address, nonce, statement) {
  const at = now();
  return `${SITE_HOST} wants you to sign in with your Ethereum account:\n${getAddress(address)}\n\n` +
    `${statement || 'Read-only sign-in to JustSendIt. This signature never moves funds and grants no token approvals.'}\n\n` +
    `URI: ${BASE_URL.replace(/\/+$/, '')}\n` +
    `Version: 1\n` +
    `Chain ID: 4663\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${new Date(at).toISOString()}\n` +
    `Expiration Time: ${new Date(at + 6e5).toISOString()}`;
}
/* What a wallet signature is allowed to do. The statement is the sentence the WALLET puts in front of the
   person — it has to name the consequence, because that sentence is the only thing they actually see. */
const NONCE_PURPOSES = {
  signin:  'Read-only sign-in to JustSendIt. This signature never moves funds and grants no token approvals.',
  link:    'Link this wallet to your JustSendIt account. This signature never moves funds and grants no token approvals.',
  '2fa-on':  'Turn ON two-factor for JustSendIt, using THIS wallet. After this you will need this wallet to sign in — if you lose it, you lose the account. This signature never moves funds.',
  manage:  'Confirm a security change on your JustSendIt account — two-factor, or how you sign in. This signature never moves funds and grants no token approvals.',
};
function issueNonce(address, purpose) {
  const use = Object.prototype.hasOwnProperty.call(NONCE_PURPOSES, purpose) ? purpose : 'signin';
  const nonce = rand(16), message = signInMessage(address, nonce, NONCE_PURPOSES[use]);
  db.prepare('INSERT INTO nonces (address, purpose, nonce, expires_at, msg) VALUES (?,?,?,?,?) ON CONFLICT(address, purpose) DO UPDATE SET nonce=excluded.nonce, expires_at=excluded.expires_at, msg=excluded.msg')
    .run(bidx(address), use, nonce, now() + 6e5, encField(message));
  return message;
}
// verify a signature against the message we issued for this address; returns the recovered address or an error string
// `purpose` is REQUIRED to match what the challenge was issued for: a signature collected for one job can
// never be replayed to do a different, more dangerous one.
function consumeNonce(address, signature, purpose = 'signin') {
  const use = Object.prototype.hasOwnProperty.call(NONCE_PURPOSES, purpose) ? purpose : 'signin';
  const n = db.prepare('SELECT * FROM nonces WHERE address = ? AND purpose = ? AND expires_at > ?').get(bidx(address), use, now());
  if (!n) return { error: 'request a wallet signature first — it may have expired' };
  const message = decField(n.msg); if (!message) return { error: 'request a wallet signature first' };
  let recovered;
  try { recovered = verifyMessage(message, String(signature || '')).toLowerCase(); } catch { return { error: 'bad signature' }; }
  if (recovered !== address) return { error: 'signature does not match that address' };
  db.prepare('DELETE FROM nonces WHERE address = ? AND purpose = ?').run(bidx(address), use);
  return { recovered };
}
function mutedNames(userId) { return db.prepare('SELECT u.username FROM mutes m JOIN users u ON u.id = m.muted_id WHERE m.user_id = ? ORDER BY u.username').all(userId).map(r => r.username); }

/* ===================== gamification ===================== */
// Send Power levels: an exponential curve with NO level cap — each level costs ~10.4%
// more Power than the last, so it scales infinitely and gets exponentially harder the higher you climb.
// xpForLevel(L) = total Power needed to REACH level L. L1=0, L2=83, L10=1,154, L50=101,333,
// L99≈13.03M, L100≈14.39M, L120≈104M — and it keeps going forever.
const LEVEL_SAFETY = 10000; // absurd upper bound so the level loops can never run away
function xpForLevel(L) {
  if (L <= 1) return 0;
  let s = 0;
  for (let n = 1; n < L; n++) s += Math.floor(n + 300 * Math.pow(2, n / 7));
  return Math.floor(s / 4);
}
function levelForXp(xp) {
  xp = Math.max(0, Number(xp) || 0);
  let L = 1, s = 0;
  while (L < LEVEL_SAFETY) {
    s += Math.floor(L + 300 * Math.pow(2, L / 7)); // Power needed to reach the next level
    if (Math.floor(s / 4) > xp) break;
    L++;
  }
  return L;
}
function titleFor(level) {
  if (level >= 150) return 'Sender Singularity 🌌';
  if (level >= 125) return 'Eternal Sender ♾️';
  if (level >= 110) return 'Send Deity ✨';
  if (level >= 100) return 'Biggest Sender 👑';
  if (level >= 90) return 'Send God';
  if (level >= 80) return 'Send Lord';
  if (level >= 70) return 'Wealth Wizard';
  if (level >= 60) return 'Send Sensei';
  if (level >= 50) return 'Rocket Commander';
  if (level >= 40) return 'Diamond Hands 💎';
  if (level >= 30) return 'Send Sergeant';
  if (level >= 20) return 'Rocket Rider 🚀';
  if (level >= 10) return 'Send Apprentice';
  if (level >= 5) return 'Coin Curious';
  return 'Fresh Sender';
}
// base points per action (before the holder multiplier)
// Every base value is 3x what it launched at. Same ratios between actions; the level curve is
// untouched (thresholds are what people experience as progress, and re-levelling everyone is not a
// tuning change). PACE, with today's caps (audit 2026-09-08): a purely social day (post, comment,
// react, vote, follow, check-in, customize, and what others send back) is 5,040 base; with the three
// real buys a day the swap cap allows, 6,390. At 1x that is Level 100 in ~7.8 years; at the 10x a live
// community pays, ~285 days — and the SOCIAL_DAY_CAP below means no stack, however large, turns a day
// of clicks into more than 73,762. The fast lane is meant to be Send Calls held in profit.
const PTS = { post: 75, first_post: 150, comment: 24, react_give: 6, react_get: 9, vote_give: 6, vote_get: 12, follow: 18, be_followed: 15, track_wallet: 45, watch_token: 15, connect_wallet: 150, customize: 30, daily: 60, swap: 450, send_call: 120, hop_on: 30, call_x: 170 }; // call_x 170: fifty rungs (170 × 1,275 = 216,750) fit inside the ladder's 30% slice of a call's budget, so the documented top rung can actually be paid
// anti-farm: max awards of this kind per rolling 24h (per recipient user).
// Every point-earning kind is capped so no single action can be farmed unbounded.
const DAILY_CAP = { post: 40, first_post: 1, comment: 20, react_give: 40, react_get: 20, vote_give: 60, vote_get: 30, follow: 10, be_followed: 10, track_wallet: 3, watch_token: 5, connect_wallet: 1, customize: 1, swap: 3, send_call: 20, hop_on: 30, community_founder: 1 };
// Economy audit 2026-09-08: the receive-side kinds (react_get / vote_get / be_followed) are what a ring of alts can push into one
// account, and the once-per-object kinds (connect / track / watch) are free to mint objects for — both cut to what a real day needs. // call_x (milestone payouts) is uncapped — earned by real performance
const PTS_EVENT_CAP = Math.floor(xpForLevel(70) * 0.1); // 73,762 — no single award may exceed a tenth of a Send Call's lifetime budget. At 1,500,000 it bound only above a 3,000× stack, i.e. never; one clamped event was Level 77 on its own
// The grind has a ceiling the boosts cannot lift: every daily-capped kind plus the check-in shares ONE rolling-24h budget on
// the PAID amount. A 400× holder still shows 400× and still earns it on Send Call performance; a day of clicks is worth at
// most 73,762 to anyone. Level 100 (14.4M) therefore stays a long climb — ≈195 maxed days of grinding, or ≈20 perfect calls.
const SOCIAL_DAY_CAP = PTS_EVENT_CAP;
const SOCIAL_KINDS = Object.keys(DAILY_CAP).concat(['daily']);
// ===== Communities: token-address communities that go live at 10 opt-ins; being in one = a flat 10× Send Power =====
const COMMUNITY_MULT = 10;       // flat 10× on EVERY action while a verified holder in ≥1 LIVE community (NOT per-community, NOT 10^n)

/* ===== Arcade: Rocket Run (crash game) =====
   One run per UTC day. The rocket's multiplier is a pure function of ELAPSED SERVER TIME, and the crash point is
   generated server-side and never sent to the browser until the run is over — so the client can animate freely but
   can never know (or fake) when it blows. Cashing out converts the multiplier you stopped at into a Send Power
   boost added on top of your Holder/OG/community boosts for 24 hours (boosts add, they do not multiply). No stakes, no money — a daily bonus game. */
const ARCADE_GROWTH = 0.06;          // multiplier(t) = e^(0.06 · seconds) → 1.8× at 10s, 6× at 30s, 36× at 60s
const ARCADE_MAX_X = 50;             // hard ceiling on the crash point (bounds the boost and the round length)
const ARCADE_BOOST_MAX = 5;          // a cash-out can never buy more than a 5× day
const ARCADE_ROUND_TTL = 5 * 60e3;   // an abandoned round expires (and counts as a bust) after 5 minutes
const arcadeX = (ms) => Math.exp(ARCADE_GROWTH * (Math.max(0, ms) / 1000));
// the boost a cash-out at Mx is worth for the next 24h — deliberately gentle: 2× → 1.25×, 9× → 3×, 17×+ → the 5× cap
const arcadeBoostFor = (x) => Math.min(ARCADE_BOOST_MAX, Math.max(1, 1 + (x - 1) / 4));
// Is one of this user's signature-verified wallets the token's deployer or current owner? Both values come from the
// chain (Blockscout's creator_address_hash + the contract's owner()), never from anything the client sends.
function isTokenDev(userId, tok) {
  if (!tok) return false;
  const dev = new Set([tok.deployer, tok.owner].filter(a => /^0x[0-9a-fA-F]{40}$/.test(String(a || ''))).map(a => String(a).toLowerCase()));
  if (!dev.size) return false;
  return walletAddresses(userId).some(w => dev.has(String(w).toLowerCase()));
}
// THE boost every point is paid at (boosts add, they do not multiply) — the single source of truth for awardPoints, the dashboard and the nav badge,
// so the number a user sees can never drift from the number they're actually paid.
function effectiveMult(userId) {
  const holder = holderMultiplier(userId);
  const row = db.prepare('SELECT og, og_tier, live_comm_count FROM users WHERE id = ?').get(userId);
  // The tier decides the bonus — gold 10×, silver 5×, bronze 3× — and ONLY while the holdings behind
  // it are recently on-chain-verified AND non-zero (still holding both). Reading `og` here instead of
  // `og_tier` would pay every silver and bronze the gold multiplier.
  let og = 1;
  const tier = row ? (row.og_tier || 0) : 0;
  if (tier > 0) {
    const h = db.prepare('SELECT send_tok, gwc_tok, last_check FROM holder_state WHERE user_id = ?').get(userId);
    if (h && h.last_check && now() - h.last_check <= HOLDER_TTL && (h.send_tok || 0) > OG_DUST && (h.gwc_tok || 0) > OG_DUST) og = OG_TIER_MULT[tier] || 1;
  }
  const community = (row && row.live_comm_count > 0) ? COMMUNITY_MULT : 1; // flat, not per-community and not 10^n
  const arcade = arcadeBoostOf(userId);                                    // today's Rocket Run cash-out, until it expires
  const weekly = weekBoostOf(userId);                                      // last week's Biggest Sender prize, until the week it covers ends
  // Boosts ADD, they do not multiply. Each active boost contributes what it pays over the base 1x, so
  // a boost on its own still pays exactly its advertised x (OG Gold alone is 10x), OG 10x plus a
  // community 10x is 19x rather than 100x, and an inactive boost (1x) adds nothing. This is the one
  // formula every point is paid at — the dashboard mirrors it, the nav badge reads its total.
  const total = 1 + (holder - 1) + (og - 1) + (community - 1) + (arcade - 1) + (weekly - 1);
  return { holder, og, community, arcade, weekly, total: Math.round(total * 100) / 100 };
}
function weekBoostOf(userId) {
  const u = db.prepare('SELECT week_boost, week_boost_until FROM users WHERE id = ?').get(userId);
  if (!u || !(u.week_boost > 1) || !(u.week_boost_until > now())) return 1;
  return u.week_boost;
}
function arcadeBoostOf(userId) {
  const u = db.prepare('SELECT arcade_boost, arcade_boost_until FROM users WHERE id = ?').get(userId);
  if (!u || !(u.arcade_boost > 1) || !(u.arcade_boost_until > now())) return 1;
  return u.arcade_boost;
}
// what the dashboard/nav show: the live boost plus whether today's run is still available
function arcadeState(userId) {
  const u = db.prepare('SELECT arcade_boost, arcade_boost_until, arcade_day FROM users WHERE id = ?').get(userId) || {};
  const active = !!(u.arcade_boost > 1 && u.arcade_boost_until > now());
  return {
    boost: active ? Math.round(u.arcade_boost * 100) / 100 : 1,
    until: active ? u.arcade_boost_until : null,
    playedToday: u.arcade_day === ymd(),
    maxBoost: ARCADE_BOOST_MAX,
  };
}
const LIVE_THRESHOLD = 10;      // distinct qualified opt-ins to go live
const FOUNDER_BONUS = 15000;    // one-time base, flows through awardPoints (multiplied + PTS_EVENT_CAP-clamped). 3x with every other base
const MIN_COMMUNITY_LIQ = 500;  // no communities on a dust pool (same floor as Send Calls)
const MIN_COMMUNITY_HOLD_USD = 25; // a verified member holds at least this much of the token (1e-9 tokens used to unlock the flat 10×)
const SWAP_MIN_USD = 10;           // a swap pays Send Power only when the wallet RECEIVES at least this much $SEND/$GWC
const OG_MIN_HOLD_USD = 25;        // an OG badge needs a real bag of BOTH coins behind it at grant time, not dust
const COMM_HALFLIFE = 12 * 3600 * 1000;   // grid-activity half-life
const W_join = 5, W_post = 3, W_react = 1; // activity weights (grid sort)
const ACT_TIERS = [[0, 'Dormant'], [5, 'Warm'], [25, 'Active'], [75, 'Hot'], [200, 'Blazing']];
const COMM_XP = { join: 200, wall_post: 30, wall_react_get: 4, wall_comment: 10, send_call: 40 };       // community-XP per action
const COMM_XP_DAILY_CAP = { wall_post: 400, wall_react_get: 300, wall_comment: 200, send_call: 200 };   // per-kind community-XP/day
const COMM_XP_PER_USER_DAY = 250;  // max community-XP one member can push into one community/day (anti-solo-inflate)
const CONV_XP = { join: 40, wall_post: 20, wall_comment: 6, wall_react_give: 2, send_call: 30 };        // per-member conviction XP per action
const CONV_DAILY_CAP = 150;        // max conviction XP a member earns in one community/day

/* ===== Community proposals + two-round voting =====================================================
   THE COUNTING RULE, stated once so nobody has to infer it:
     decisive = yes + no.  Abstains are EXCLUDED from the threshold and INCLUDED in quorum.
     Round 1 promotes when yes*2 >= decisive  (>=50% of decisive votes).
     Round 2 passes   when yes*4 >= decisive*3 (>=75% of decisive votes).
   Abstain therefore means "I turned up and I am neutral" — it helps reach quorum and never counts
   against the motion. A tied 50/50 round 1 promotes, which is safe because round 1 is only a
   promotion gate; the real bar is round 2's supermajority.

   Rounds always run their full clock. An early close would have to be judged against a MOVING
   electorate — holders here sell constantly — which is gameable: dump enough supply and the
   remaining ballots suddenly look decisive. Quorum and tallies are frozen at close for the same
   reason: a decided proposal can never be rewritten by a later sell-off. ================================ */
const PROP_DRAFT_TTL = 24 * 3600 * 1000;   // an unopened draft self-expires after a day
const PROP_R1_MS     = 3 * 864e5;          // round 1 runs 72h — long enough that an every-other-day member still gets a ballot
const PROP_R2_MS     = 2 * 864e5;          // round 2 runs 48h — shorter, the electorate is already engaged
const PROP_QUORUM_R1 = { frac: 0.20, min: 5, max: 50 };
const PROP_QUORUM_R2 = { frac: 0.30, min: 6, max: 60 };
const PROP_OPEN_PER_USER = 1;              // non-terminal proposals one member may run in one community
const PROP_OPEN_PER_COMM = 5;              // non-terminal proposals a community may run at once
const PROP_TITLE_MAX = 120, PROP_BODY_MAX = 2000;
const PROP_NOTIFY_CAP = 200;               // max recipients of one proposal's fan-out
const W_prop = 4;                          // grid-activity weight for opening a proposal
const PROP_LIVE = "('open','round2')";

function quorumFor(qual, q) {
  const n = Math.min(q.max, Math.max(q.min, Math.ceil((qual || 0) * q.frac)));
  return Math.max(1, Math.min(qual || 1, n)); // never demand more ballots than there are eligible voters
}
// The single source of truth for a tally — used live during a round and once at resolution.
// The JOIN on qualified=1 is deliberate: a member who sold their tokens stops being a holder, so
// their ballot stops counting. joined_at <= opened_at is the record date, so nobody can join after
// a vote starts in order to swing it.
function tallyRound(p, round) {
  const rows = db.prepare(`SELECT v.choice, COUNT(*) n FROM proposal_votes v
      JOIN community_members cm ON cm.community_id = ? AND cm.user_id = v.user_id
     WHERE v.proposal_id = ? AND v.round = ? AND cm.qualified = 1 AND cm.joined_at <= ?
     GROUP BY v.choice`).all(p.community_id, p.id, round, p.opened_at);
  const t = { yes: 0, no: 0, abstain: 0 };
  for (const r of rows) if (t[r.choice] != null) t[r.choice] = r.n;
  const decisive = t.yes + t.no, ballots = decisive + t.abstain;
  return { ...t, decisive, ballots, pct: decisive ? Math.round(t.yes / decisive * 100) : 0 };
}
const propPasses = (t, round) => round === 1 ? (t.yes * 2 >= t.decisive) : (t.yes * 4 >= t.decisive * 3);

// Resolve one proposal whose deadline has passed. Synchronous and transactional: the row is re-read
// inside the transaction, so a concurrent request cannot resolve the same proposal twice.
function resolveProposal(id) {
  try {
    db.exec('BEGIN IMMEDIATE');
    const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
    if (!p || !p.deadline || p.deadline > now()) { db.exec('ROLLBACK'); return; }
    if (p.status === 'draft') {
      db.prepare("UPDATE proposals SET status='expired', reason='draft_never_opened', deadline=NULL, resolved_at=? WHERE id=?").run(now(), id);
      db.exec('COMMIT'); return;
    }
    const round = p.status === 'round2' ? 2 : 1;
    const t = tallyRound(p, round);
    const quorum = round === 1 ? p.quorum_r1 : p.quorum_r2;
    let status, reason;
    if (t.ballots < quorum)         { status = 'expired';  reason = 'r' + round + '_no_quorum'; }
    else if (t.decisive === 0)      { status = 'rejected'; reason = 'r' + round + '_no_decisive'; }
    else if (propPasses(t, round))  { status = round === 1 ? 'round2' : 'passed'; reason = round === 1 ? 'promoted' : 'passed'; }
    else                            { status = 'rejected'; reason = 'r' + round + (round === 1 ? '_below_50' : '_below_75'); }

    const froze = round === 1
      ? { r1_yes: t.yes, r1_no: t.no, r1_abs: t.abstain }
      : { r2_yes: t.yes, r2_no: t.no, r2_abs: t.abstain };
    if (round === 1) {
      db.prepare('UPDATE proposals SET r1_yes=?, r1_no=?, r1_abs=? WHERE id=?').run(froze.r1_yes, froze.r1_no, froze.r1_abs, id);
      if (status === 'round2') {
        db.prepare("UPDATE proposals SET status='round2', reason=NULL, r2_opened_at=?, r2_ends_at=?, deadline=? WHERE id=?")
          .run(now(), now() + PROP_R2_MS, now() + PROP_R2_MS, id);
      } else {
        db.prepare('UPDATE proposals SET status=?, reason=?, deadline=NULL, resolved_at=? WHERE id=?').run(status, reason, now(), id);
      }
    } else {
      db.prepare('UPDATE proposals SET r2_yes=?, r2_no=?, r2_abs=?, status=?, reason=?, deadline=NULL, resolved_at=? WHERE id=?')
        .run(froze.r2_yes, froze.r2_no, froze.r2_abs, status, reason, now(), id);
    }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} }
}
// Cheap because idx_prop_due is partial — it indexes only rows that still have a deadline.
function resolveDueProposals(cid) {
  const rows = cid
    ? db.prepare('SELECT id FROM proposals WHERE community_id=? AND deadline IS NOT NULL AND deadline <= ?').all(cid, now())
    : db.prepare('SELECT id FROM proposals WHERE deadline IS NOT NULL AND deadline <= ? LIMIT 200').all(now());
  for (const r of rows) resolveProposal(r.id);
}
// Why this member may or may not vote. Returns null when they may. `cm` is passed in rather than
// re-queried so a 20-row list does not run 20 identical membership lookups.
function voteGateReason(me, c, p, cm) {
  if (!me) return 'Sign in to vote.';
  if (c.status !== 'live') return 'This community is not live yet.';
  if (p.status !== 'open' && p.status !== 'round2') return 'Voting is closed on this proposal.';
  if (!cm) return 'Join this community to vote.';
  if (!cm.qualified) return 'Only verified holders of $' + c.symbol + ' can vote. Re-verify your wallet to get a slot.';
  if (p.opened_at && cm.joined_at > p.opened_at) return 'You joined after this vote opened, so you are not on its roll.';
  const round = p.status === 'round2' ? 2 : 1;
  if (db.prepare('SELECT 1 FROM proposal_votes WHERE proposal_id=? AND round=? AND user_id=?').get(p.id, round, me.id)) {
    return 'You have already voted in this round. Votes are final.';
  }
  return null;
}
function proposalView(p, me, c, cm) {
  const round = p.status === 'round2' ? 2 : 1;
  const live = p.status === 'open' || p.status === 'round2';
  // While a round is live the running tally is sealed — publishing it would let late voters
  // strategise against the count. It opens fully the moment the round closes.
  const frozen1 = p.r1_yes != null ? { yes: p.r1_yes, no: p.r1_no, abstain: p.r1_abs } : null;
  const frozen2 = p.r2_yes != null ? { yes: p.r2_yes, no: p.r2_no, abstain: p.r2_abs } : null;
  const liveT = live ? tallyRound(p, round) : null;
  const mine = me ? db.prepare('SELECT choice FROM proposal_votes WHERE proposal_id=? AND round=? AND user_id=?').get(p.id, round, me.id) : null;
  return {
    id: p.id, communityId: p.community_id, title: p.title, body: p.body,
    tokens: parseTokens(p.tokens),
    status: p.status, reason: p.reason, round,
    electorate: p.electorate, quorumR1: p.quorum_r1, quorumR2: p.quorum_r2,
    ballots: liveT ? liveT.ballots : null,          // turnout is public live; the split is not
    quorumNow: round === 1 ? p.quorum_r1 : p.quorum_r2,
    r1: frozen1, r2: frozen2,
    createdAt: p.created_at, openedAt: p.opened_at, endsAt: p.status === 'round2' ? p.r2_ends_at : p.r1_ends_at,
    resolvedAt: p.resolved_at, deadline: p.deadline,
    author: (() => { const a = db.prepare('SELECT username, avatar, avatar_img FROM users WHERE id=?').get(p.author_id);
                     return a ? { username: a.username, avatar: a.avatar, avatarImg: a.avatar_img ? '/uploads/' + a.avatar_img : null } : null; })(),
    isMine: !!(me && me.id === p.author_id),
    myVote: mine ? mine.choice : null,
    canVote: !voteGateReason(me, c, p, cm),
    gate: voteGateReason(me, c, p, cm),
  };
}

// --- Robinhood Chain reads (server-authoritative → holdings can't be spoofed) ---
const RH_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const TOK = { SEND: '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', GWC: '0x61339f11384dde4b2dc3a33e75b4dc23cc620f22' };
const SWAP_ROUTER = '0x89e5db8b5aa49aa85ac63f691524311aeb649eba';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // keccak256("Transfer(address,address,uint256)")
function addrTopic(a) { return '0x' + a.toLowerCase().replace('0x', '').padStart(64, '0'); }

/* ===== Tokens as social objects =====
   A pasted contract address in a post / comment is resolved on-chain (cached via lookupTokenPair) and rewritten to its
   $TICKER; the row keeps a tokens[] map so the client can render every $TICKER as a chip that opens the same token
   detail popup used everywhere else. $SEND / $GWC mentions always resolve. Max 3 addresses per text; unresolvable ones
   stay as typed. */
const ADDR_IN_TEXT = /0x[0-9a-fA-F]{40}/g;
const SYMBOL_OK = (s) => String(s || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
function parseTokens(s) { try { const v = JSON.parse(s || 'null'); return Array.isArray(v) ? v : []; } catch { return []; } }
async function resolveTokensInText(text) {
  text = String(text || '');
  const found = [...new Set((text.match(ADDR_IN_TEXT) || []).map(a => a.toLowerCase()))].slice(0, 3);
  const tokens = [];
  for (const a of found) {
    try {
      const r = await Promise.race([lookupTokenPair(a), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
      const pr = r && r.pair; if (!pr || r.notFound || r._quoteSide || pr._quoteSide || !pr.token) continue;
      const sym = SYMBOL_OK(pr.token.symbol); if (!sym) continue;
      tokens.push({ addr: a, symbol: sym, name: String(pr.token.name || '').slice(0, 60) });
      text = text.replace(new RegExp(a, 'gi'), '$' + sym);
    } catch {}
  }
  for (const k of ['SEND', 'GWC']) {
    if (new RegExp('\\$' + k + '(?![A-Za-z0-9_])', 'i').test(text) && !tokens.some(t => t.addr === TOK[k].toLowerCase()))
      tokens.push({ addr: TOK[k].toLowerCase(), symbol: k, name: k === 'SEND' ? 'Send It' : 'Generational Wealth Coin' });
  }
  return { text, tokens: tokens.length ? JSON.stringify(tokens) : null };
}
// community for a token (cheap: communities are few) — used to tag tokens site-wide
function communityForToken(addr) {
  const c = db.prepare('SELECT id, status, member_count, qual_count, official, demo FROM communities WHERE token_addr = ? COLLATE NOCASE AND demo = 0').get(String(addr || '').toLowerCase()); // the sandbox has no token: it tags nothing
  return c ? { id: c.id, status: c.status, memberCount: c.member_count, qualCount: c.qual_count, official: !!c.official, demo: !!c.demo } : null;
}
async function rpc(method, params) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 10000); // fast-fail a stalled RPC so a hung read can't freeze the pairs refresher
  try {
    const res = await fetch(RH_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctrl.signal });
    if (!res.ok) throw new Error('rpc http ' + res.status); // an HTTP error (429/500/503) must FAIL, not silently return null (which would read as a 0 balance → false OG revoke / streak reset)
    const j = await res.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  } finally { clearTimeout(to); }
}
async function erc20Balance(token, addr) {
  const data = '0x70a08231' + addr.toLowerCase().replace('0x', '').padStart(64, '0');
  const r = await rpc('eth_call', [{ to: token, data }, 'latest']);
  if (r == null || r === '0x') throw new Error('balance read failed'); // a failed/empty read must not masquerade as a 0 balance (SEND/GWC balanceOf always returns 32 bytes on success)
  return BigInt(r);
}
const supplyCache = {};
const balCache = new Map(); // per-user nav balance cache (userId -> {t, v}); read-only convenience, ~60s TTL
async function totalSupply(token) {
  const c = supplyCache[token];
  if (c && now() - c.t < 36e5) return c.v;
  const v = BigInt(await rpc('eth_call', [{ to: token, data: '0x18160ddd' }, 'latest']) || '0x0');
  supplyCache[token] = { v, t: now() };
  return v;
}

// the boost only counts while your holdings were verified on-chain recently — otherwise a user
// could refresh once while holding, sell, and keep (and grow) the boost forever. Honest holders
// stay fresh because the dashboard re-verifies on every visit.
const HOLDER_TTL = 26 * 3600 * 1000;

// Diamond Hands: an extra boost tier earned purely by holding continuously without selling.
// Level = the highest tier whose day-threshold your (on-chain-verified, sell-reset) hold streak has passed.
// Diamond factor climbs geometrically from ×1 (day 0) to ×100 (2 years, never sold) — each tier ~1.585×
// the last, so conviction is exponentially rewarded and tops out at a ×100 Diamond boost.
const DIAMOND_TIERS = [
  { days: 0,   name: 'Paper Grip',       emoji: '📄', factor: 1 },
  { days: 3,   name: 'Getting a Grip',   emoji: '✊', factor: 1.6 },
  { days: 7,   name: 'Firm Hands',       emoji: '🤝', factor: 2.5 },
  { days: 14,  name: 'Steel Hands',      emoji: '🔩', factor: 4 },
  { days: 30,  name: 'Diamond Forming',  emoji: '💠', factor: 6.3 },
  { days: 60,  name: 'Diamond Hands',    emoji: '💎', factor: 10 },
  { days: 120, name: 'Flawless Diamond', emoji: '💎', factor: 16 },
  { days: 240, name: 'Titanium Grip',    emoji: '🛡️', factor: 25 },
  { days: 365, name: 'Diamond Legend',   emoji: '🏆', factor: 40 },
  { days: 550, name: 'Unbreakable',      emoji: '👑', factor: 63 },
  { days: 730, name: 'Immortal Diamond', emoji: '🔥', factor: 100 },
];
function diamondLevel(holdDays) { let L = 0; for (let i = 1; i < DIAMOND_TIERS.length; i++) if (holdDays >= DIAMOND_TIERS[i].days) L = i; return L; }
function diamondInfo(holdDays) {
  const level = diamondLevel(holdDays);
  const tier = DIAMOND_TIERS[level];
  const next = DIAMOND_TIERS[level + 1] || null;
  const progress = next ? Math.max(0, Math.min(1, (holdDays - tier.days) / (next.days - tier.days))) : 1;
  return { level, maxLevel: DIAMOND_TIERS.length - 1, name: tier.name, emoji: tier.emoji, days: Math.floor(holdDays), nextDays: next ? next.days : null, progress, factor: tier.factor };
}
// verified hold-days for the CURRENT no-sell streak (measured to the last on-chain check, never live now())
function holdDaysOf(h) { return (h && h.streak_start) ? Math.max(0, (Math.min(now(), h.last_check || 0) - h.streak_start) / 864e5) : 0; }
// $GWC ("Generational Wealth Coin") is weighted HEAVIER for Send Power — more per % held, and its hold-time counts extra.
const GWC_SUPPLY_WEIGHT = 3; // 1% of $GWC held counts as this many % toward the supply boost (vs 1× for $SEND)
const GWC_TIME_WEIGHT = 2;   // holding $GWC for N days counts as this × N days toward your Diamond Hands level
function gwcDaysOf(h) { return (h && h.gwc_streak_start) ? Math.max(0, (Math.min(now(), h.last_check || 0) - h.gwc_streak_start) / 864e5) : 0; }
// hold-days that drive the Diamond level/factor: the longer of your combined no-sell streak and your $GWC streak ×2 —
// so holding $GWC for longer reaches higher Diamond levels (and thus more Send Power) faster.
function effHoldDays(h) { return Math.max(holdDaysOf(h), GWC_TIME_WEIGHT * gwcDaysOf(h)); }

// PUBLIC diamond badge (tier only — no % of supply, token amounts, or multiplier). null if not a holder.
function publicDiamond(userId) {
  const h = db.prepare('SELECT * FROM holder_state WHERE user_id = ?').get(userId);
  if (!h || !h.streak_start || h.score_bp <= 0) return null;
  const d = diamondInfo(effHoldDays(h));
  return { level: d.level, maxLevel: d.maxLevel, name: d.name, emoji: d.emoji };
}

// Wallet-tracking capacity scales with VERIFIED $GWC diamond-handing. Everyone gets 10 free; hold $GWC and
// reach Diamond level N (a never-sold streak, read from chain — spoof-proof) → 100 × N, capped at 1000.
const TRACK_BASE = 10;
function trackLimit(userId) {
  const h = db.prepare('SELECT * FROM holder_state WHERE user_id = ?').get(userId);
  const fresh = h && h.last_check && now() - h.last_check <= HOLDER_TTL;
  if (h && h.gwc_tok > 0 && h.streak_start && fresh) {
    const lvl = diamondInfo(effHoldDays(h)).level;
    if (lvl >= 1) return Math.min(1000, lvl * 100);
  }
  return TRACK_BASE;
}

// multiplier from STORED holder state (fast, no RPC) — used when awarding points
function holderMultiplier(userId) {
  const h = db.prepare('SELECT * FROM holder_state WHERE user_id = ?').get(userId);
  if (!h || !h.streak_start || h.score_bp <= 0) return 1;
  if (!h.last_check || now() - h.last_check > HOLDER_TTL) return 1; // stale → no boost until re-verified on-chain
  const weightedPct = ((h.send_bp || 0) + GWC_SUPPLY_WEIGHT * (h.gwc_bp || 0)) / 10000; // $GWC weighted heavier than $SEND
  const supplyBoost = 10 * weightedPct;                           // 10× for each weighted 1% of supply you hold
  const diamondFactor = diamondInfo(effHoldDays(h)).factor;       // Diamond level (boosted by holding $GWC longer) → up to ×100
  return Math.round((1 + supplyBoost * diamondFactor) * 100) / 100; // UNCAPPED — scales with (weighted) supply held × Diamond factor
}

/* ===== Dynamic Send Call daily limit + diamond boost =====
   Base 5/day. A user's EARNED limit floats on their call quality: a day whose matured calls did well
   (peak ≥ 1x = doubled) earns +1 (cap 5); a day whose matured calls only flopped loses 1 (floor 1).
   Diamond-hand holders of $SEND/$GWC then multiply their limit by 2^diamondLevel (Lv0 = 1×, Lv10 = 1024×) —
   spoof-proof + staleness-gated, exactly like trackLimit(). */
const CALL_LIMIT_BASE = 5;      // default & ceiling for the EARNED (pre-boost) limit
const CALL_LIMIT_MIN = 1;       // floor — a persistently-bad caller can still make one call/day
const CALL_GOOD_X = 1;          // a call "did well" once its peak reached ≥ 1x (token doubled, +100%)
const CALL_MATURE_MS = 864e5;   // a call is judged only once it's ≥ 24h old (or dead) — a fair chance to run
const CALL_EVAL_MS = 864e5;     // re-evaluate a user's earned limit at most once per 24h
const CALL_WINDOW_MS = 864e5;   // rolling window the daily allowance is counted over (no midnight double-dump)
const CALL_SPAM_WINDOW_MS = 60 * 60 * 1000; // burning a full day's allowance inside this = spam → read-only
const CALL_SPAM_MIN = 3;        // ...but only if that allowance is ≥ 3 calls (never punish a 1–2 limit for making them)

// current diamond level (0..10) for the boost — STORED read, no RPC, same spoof-proof + 26h staleness gate as trackLimit()
function diamondLevelOf(userId) {
  const h = db.prepare('SELECT * FROM holder_state WHERE user_id = ?').get(userId);
  if (!h || !h.streak_start || h.score_bp <= 0) return 0;            // holds neither $SEND nor $GWC / no streak
  if (!h.last_check || now() - h.last_check > HOLDER_TTL) return 0;  // stale (>26h unverified) → no boost until re-verified on-chain
  return diamondInfo(effHoldDays(h)).level;
}

// lazily re-evaluate a user's EARNED daily call limit (≤ once / 24h) from how their matured, not-yet-scored calls performed.
function evalCallLimit(u) {
  const base = (u.call_limit != null ? u.call_limit : CALL_LIMIT_BASE);
  if (u.call_eval_at && now() - u.call_eval_at < CALL_EVAL_MS) return base; // already evaluated this window
  const matureBefore = now() - CALL_MATURE_MS;
  const rows = db.prepare('SELECT (peak_price / entry_price - 1) mx FROM calls WHERE user_id=? AND scored=0 AND entry_price>0 AND (created_at <= ? OR dead=1)').all(u.id, matureBefore);
  let lim = base;
  if (rows.length) {
    if (rows.some(r => r.mx >= CALL_GOOD_X)) lim = Math.min(CALL_LIMIT_BASE, base + 1);  // ≥1 winner matured this window → +1 (cap 5)
    else lim = Math.max(CALL_LIMIT_MIN, base - 1);                                       // only duds matured → −1 (one step per bad day)
    try {
      db.exec('BEGIN');
      db.prepare('UPDATE calls SET scored=1 WHERE user_id=? AND scored=0 AND entry_price>0 AND (created_at <= ? OR dead=1)').run(u.id, matureBefore);
      db.prepare('UPDATE users SET call_limit=?, call_eval_at=? WHERE id=?').run(lim, now(), u.id);
      db.exec('COMMIT');
    } catch { try { db.exec('ROLLBACK'); } catch {} return base; }
  } else {
    db.prepare('UPDATE users SET call_eval_at=? WHERE id=?').run(now(), u.id); // nothing matured — stamp so we don't re-scan on every call
  }
  u.call_limit = lim; u.call_eval_at = now(); // keep the in-memory row consistent for the rest of this request
  return lim;
}

// full daily allowance for a user: earned limit × diamond boost, minus the calls used in the rolling 24h.
function callAllowance(u) {
  const earned = evalCallLimit(u);
  const dLevel = diamondLevelOf(u.id);
  const boost = Math.pow(2, dLevel);            // 2^level (Lv0=1 … Lv10=1024); level is bounded 0..10 so no overflow
  const limit = earned * boost;
  const recent = db.prepare('SELECT created_at FROM calls WHERE user_id=? AND created_at > ? ORDER BY created_at ASC').all(u.id, now() - CALL_WINDOW_MS);
  const used = recent.length;
  const remaining = Math.max(0, limit - used);
  const resetAt = (remaining <= 0 && used >= limit) ? recent[used - limit].created_at + CALL_WINDOW_MS : null; // when the next slot frees
  return { base: CALL_LIMIT_BASE, earned, diamondLevel: dLevel, boost, limit, used, remaining, resetAt, readOnly: isReadOnly(u) };
}

// read holdings from chain, detect sells, update the no-sell streak (resets the boost on a sell).
// Fail-closed: any RPC read error throws (caller returns 502) so a transient outage can't reset an
// honest holder's streak by mistaking a failed read for a zero balance.
async function refreshHolder(userId) {
  const addrs = walletAddresses(userId).slice(0, MAX_LINKED_WALLETS); // defense-in-depth for rows linked before the cap
  const prev = db.prepare('SELECT * FROM holder_state WHERE user_id = ?').get(userId);
  if (!addrs.length) return { hasWallet: false, multiplier: 1, pct: 0, holdDays: 0, sendTok: 0, gwcTok: 0, streakStart: null };
  let sendWei = 0n, gwcWei = 0n;
  for (const a of addrs) { sendWei += await erc20Balance(TOK.SEND, a); gwcWei += await erc20Balance(TOK.GWC, a); }
  const [ss, gs] = await Promise.all([totalSupply(TOK.SEND), totalSupply(TOK.GWC)]);
  if (ss <= 0n || gs <= 0n) throw new Error('supply read failed');
  const sendTok = Number(sendWei) / 1e18, gwcTok = Number(gwcWei) / 1e18;
  const pctSend = Number(sendWei) / Number(ss) * 100;
  const pctGwc = Number(gwcWei) / Number(gs) * 100;
  const score = pctSend + pctGwc;
  const scoreBp = Math.round(score * 10000);
  const sendBp = Math.round(pctSend * 10000), gwcBp = Math.round(pctGwc * 10000);
  let streakStart = prev && prev.streak_start ? prev.streak_start : null;
  let baseBp = prev ? (prev.base_bp || 0) : 0;                     // peak %supply held during this streak
  if (scoreBp <= 0) { streakStart = null; baseBp = 0; }            // holds nothing → no streak
  else if (!streakStart) { streakStart = now(); baseBp = scoreBp; }             // (re)start a streak
  else if (scoreBp < baseBp * 0.98) { streakStart = now(); baseBp = scoreBp; }  // sold >2% below the streak's peak → reset
  else if (scoreBp > baseBp) baseBp = scoreBp;                     // accumulated more → raise the peak, keep the streak
  // separate $GWC-only no-sell streak (resets only when you sell $GWC, not $SEND) — rewards holding $GWC for longer
  let gwcStreak = prev && prev.gwc_streak_start ? prev.gwc_streak_start : null;
  let gwcBase = prev ? (prev.gwc_base_bp || 0) : 0;
  if (gwcBp <= 0) { gwcStreak = null; gwcBase = 0; }
  else if (!gwcStreak) { gwcStreak = now(); gwcBase = gwcBp; }
  else if (gwcBp < gwcBase * 0.98) { gwcStreak = now(); gwcBase = gwcBp; }      // sold $GWC → reset the $GWC streak
  else if (gwcBp > gwcBase) gwcBase = gwcBp;
  db.prepare(`INSERT INTO holder_state (user_id, score_bp, base_bp, send_tok, gwc_tok, send_bp, gwc_bp, streak_start, gwc_streak_start, gwc_base_bp, last_check, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET score_bp=excluded.score_bp, base_bp=excluded.base_bp, send_tok=excluded.send_tok, gwc_tok=excluded.gwc_tok, send_bp=excluded.send_bp, gwc_bp=excluded.gwc_bp, streak_start=excluded.streak_start, gwc_streak_start=excluded.gwc_streak_start, gwc_base_bp=excluded.gwc_base_bp, last_check=excluded.last_check, updated_at=excluded.updated_at`)
    .run(userId, scoreBp, baseBp, sendTok, gwcTok, sendBp, gwcBp, streakStart, gwcStreak, gwcBase, now(), now());
  checkProbation(userId, sendTok); // enforce any active "hold your bought $SEND" redemption deal against this fresh balance
  // OG revocation: OG requires holding BOTH $SEND and $GWC, so selling out of EITHER (dropping it to ~0) permanently
  // removes OG. These balances are real — rpc() throws on failure (we'd never reach here on a transient error), so a
  // zero here is a true zero, not a glitch.
  if (sendTok <= OG_DUST || gwcTok <= OG_DUST) {
    const cur = db.prepare('SELECT og, og_tier FROM users WHERE id = ?').get(userId);
    if (cur && (cur.og || cur.og_tier)) {
      const lost = OG_TIER_NAME[cur.og_tier] || '';
      db.prepare('UPDATE users SET og = 0, og_tier = 0, og_revoked = 1 WHERE id = ?').run(userId);
      notify(userId, '💔', 'OG' + (lost ? ' ' + lost : '') + ' removed — OG requires holding BOTH $SEND and $GWC, and you sold out of one of them. It can’t be reclaimed.', 'og');
    }
  }
  const freshH = { streak_start: streakStart, gwc_streak_start: gwcStreak, last_check: now() };
  const hd = streakStart ? (now() - streakStart) / 864e5 : 0;
  return { hasWallet: true, multiplier: holderMultiplier(userId), pct: score, pctSend, pctGwc, holdDays: hd, gwcDays: gwcDaysOf(freshH), sendTok, gwcTok, streakStart, fresh: true, diamond: diamondInfo(effHoldDays(freshH)) };
}

/* ===== OG scan: replay a wallet's whole history of one coin, on-chain, read-only ==================
   The old scan asked one yes/no question ("was there a pool buy inside 30 days?") and could answer it
   from the newest page. A tier needs the EARLIEST acquisition, not any acquisition — Blockscout pages
   newest-first, so returning the first match found returned the LATEST qualifying buy and would have
   scored a genuine day-one buyer by their month-eight top-up. And neither new disqualifier is
   answerable from inbound transfers alone: "dumped their whole supply" is a statement about the
   running balance, which needs both directions.

   So this walks the wallet's full transfer list for the coin and replays it oldest-first in BigInt.
   Three facts measured against this explorer drive the details:
     · the amount is at `it.total.value`, NOT `it.value` (which is undefined here). Reading the wrong
       field makes every transfer parse as 0 and every wallet look like a clean non-dumper.
     · rows come strictly newest-first by (block_number, log_index) and the page cursor is exclusive,
       but the replay sorts ascending anyway rather than trusting arrival order.
     · page size is capped at 50 and asking for more is a hard HTTP 422 here — unlike the holders
       endpoint, which answers an oversized request with a silent empty 200.

   FAIL-CLOSED, and it matters more here than anywhere else on the site: this scan can permanently
   deny a badge. Every failure path throws rather than returning a negative. The keystone is the
   balance cross-check in ogScan() — the replayed balance must equal what the chain says the wallet
   holds, read from the RPC, a different host on a different rate limit. Truncated paging, a dropped
   page, or a throttled empty 200 all move that total, so the mismatch catches them without having to
   recognise each failure shape individually. */
/* 20 pages = 1,000 transfers per (wallet, coin). Every real holder sampled fitted in ONE page, so
   this is ~1000× headroom on the measured case — but the cap is not a soft limit: a wallet past it
   cannot be reconciled against its chain balance, so it cannot be judged at all and earns nothing.
   That is the safe direction, and with per-page retries the extra pages actually complete now, but
   it does mean a very high-frequency trader on a single linked wallet is out of reach. Raising this
   moves the threshold; it does not remove the class of problem. */
const OG_SCAN_PAGES = 20;
const OG_SCAN_GAP_MS = 220;      // politeness gap between pages — a burst of back-to-back calls gets a 429
// A market acquisition is tokens leaving the pool for you. Measured on this chain, most buys arrive
// via a router that forwards from the pool, so a pool-only test misses them: on one sampled wallet
// 65.9% of inbound $GWC by value came from RelayRouterV3, not the pair. This list is measured, not
// exhaustive — a buy through some other router is invisible here and simply earns no tier, which is
// the safe direction to be wrong in for something that grants a reward.
const OG_ROUTERS = ['0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f']; // RelayRouterV3 (verified contract)
const OG_PAGE_TRIES = 4;         // this explorer 429s readily; one shot per page meant almost no scan ever finished
async function ogTransfers(wallet, token, opts) {
  const tries = (opts && opts.tries) || OG_PAGE_TRIES, backoff = (opts && opts.backoffMs) || 1500;
  const w = wallet.toLowerCase();
  const base = BLOCKSCOUT + '/api/v2/addresses/' + w + '/token-transfers?type=ERC-20&token=' + token;
  const rows = [];
  let url = base;
  for (let page = 0; page < OG_SCAN_PAGES; page++) {
    if (page) await new Promise(r => setTimeout(r, OG_SCAN_GAP_MS));
    // Retry each page like snapPage() does. Measured driving this endpoint at OG_SCAN_GAP_MS from a
    // cold client: 8 of 8 requests came back 429. A single un-retried jget per page meant a full scan
    // (up to 10 sequential pages) essentially never completed, so the campaign would have granted
    // almost nobody while still spending the requests. Backoff is seconds, not milliseconds, because
    // the throttle here stays cross for tens of seconds.
    let j = null;
    for (let attempt = 0; attempt < tries && !j; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, backoff * Math.pow(2, attempt - 1) + Math.random() * 400));
      j = await jget(url);
      if (j && !Array.isArray(j.items)) j = null;    // a shape we don't recognise is a failure, not an empty history
    }
    if (!j) throw new Error('og scan: explorer unavailable'); // exhausted retries → never a negative answer
    rows.push(...j.items);
    if (!j.next_page_params) return rows;
    url = base + '&' + new URLSearchParams(j.next_page_params).toString();
  }
  throw new Error('og scan: history longer than the page budget'); // unverifiable ≠ disqualified
}
// Replay one (wallet, coin) into the facts the tier rules need. Throws unless the replay reconciles
// with the chain. `launchMs` is that coin's own launch — tier windows are per-coin.
async function ogScan(wallet, token, pair, launchMs) {
  const w = wallet.toLowerCase(), pl = pair.toLowerCase();
  const isAcquisition = (from) => from === pl || OG_ROUTERS.includes(from);
  const rows = await ogTransfers(wallet, token);
  rows.sort((a, b) => (Number(a.block_number) - Number(b.block_number)) || (Number(a.log_index) - Number(b.log_index)));
  let bal = 0n, firstBuyMs = null, dumped = false, balAtMonthEnd = null;
  for (const r of rows) {
    const from = ((r.from && r.from.hash) || '').toLowerCase();
    const to = ((r.to && r.to.hash) || '').toLowerCase();
    const raw = r.total && r.total.value;
    if (raw == null) throw new Error('og scan: transfer with no value');   // never silently read as 0
    const ts = Date.parse(r.timestamp || r.block_timestamp || '') || 0;
    if (!ts) throw new Error('og scan: unparseable timestamp');
    let v;
    try { v = BigInt(raw); } catch { throw new Error('og scan: unparseable value'); }
    if (to === w) {
      bal += v;
      if (firstBuyMs === null && isAcquisition(from)) firstBuyMs = ts;      // EARLIEST market acquisition — the tier basis
    }
    if (from === w) bal -= v;
    if (firstBuyMs !== null) {
      // "dumped their whole supply within the first month": the balance reached ~zero at some point
      // inside the 30 days after this wallet's own first buy. Anchoring to the wallet's own first buy
      // rather than to launch is what makes the standard identical for gold, silver and bronze — a
      // bronze buyer measured against launch+30d could never trip it.
      if (ts <= firstBuyMs + OG_MONTH_MS && bal <= OG_DUST_WEI) dumped = true;
      if (ts <= firstBuyMs + OG_MONTH_MS) balAtMonthEnd = bal;             // last balance still inside month one
    }
  }
  // The keystone. erc20Balance() throws on a failed read (it never reports a failure as 0n), so a
  // transient RPC error throws here too rather than inventing a disqualification.
  const onChain = await erc20Balance(token, wallet);
  if (onChain !== bal) throw new Error('og scan: replay did not reconcile with chain balance');
  return {
    firstBuyMs,
    tier: firstBuyMs === null ? OG_TIER.NONE : ogTierForBuy(firstBuyMs, launchMs),
    holds: bal > OG_DUST_WEI,
    balWei: bal.toString(),   // for the value floor at grant time (strings, never BigInt, so a scan result can be logged/JSON'd)
    dumped,
    // net accumulator, measured the only way that is not a tautology: Σin − Σout IS the balance, so
    // "bought more than you sold" would just re-ask "do you hold any?", which is already required.
    // This asks the question that has an answer — are you above where you stood at the end of month one?
    notAccumulator: balAtMonthEnd !== null && bal < balAtMonthEnd,
  };
}
const _ogScanning = new Set(); // coalesce concurrent scans of the same user
/* Decide (or re-decide) a user's OG tier from chain history. Returns the tier, 0 for none.

   Both coins are scanned across every linked wallet, and the user's tier is the LOWER of the two —
   the standard is "bought BOTH", so the later coin is what you actually qualified on. A wallet only
   contributes its BEST tier for a coin; the disqualifiers are evaluated on the wallet that supplied
   that tier, since the rule is written about "that wallet".

   The short-circuit is on og_tier, not on og. Keying it to `og` (as it used to) would mean an account
   already holding the legacy boolean could never be scanned again, so no tier could ever be derived
   for it — the backfill at boot handles the ones granted before tiers existed, and this handles the
   rest. A tier can never improve on a re-scan (it is fixed by when you bought), so re-entry is safe. */
async function checkOg(userId) {
  const u = db.prepare('SELECT og, og_tier, og_revoked FROM users WHERE id = ?').get(userId);
  if (!u) return 0;
  if (u.og_tier > 0) return u.og_tier;          // already tiered — permanent unless revoked by a full sell-out
  if (u.og_revoked) return 0;                   // sold out completely once → gone for good, never re-granted
  if (now() > OG_GRANT_UNTIL_MS) return 0;      // past the windows AND past the grace — stop paying the explorer
  if (_ogScanning.has(userId)) return 0;
  _ogScanning.add(userId);
  try {
    // Every linked wallet, the same set refreshHolder() sums for revocation. They used to differ
    // (grant read 3, revocation read 5), which let a user qualify on wallets 1-3, park dust in wallet
    // 4 and then dump everything without ever being revoked.
    const addrs = walletAddresses(userId).slice(0, OG_MAX_WALLETS);
    if (!addrs.length) return 0;
    const COINS = [
      { key: 'SEND', token: TOK.SEND, pair: OG_PAIR.SEND, launch: OG_LAUNCH.SEND },
      { key: 'GWC', token: TOK.GWC, pair: OG_PAIR.GWC, launch: OG_LAUNCH.GWC },
    ];
    const best = {};                 // coin -> the best qualifying scan across this user's wallets
    const holdsAny = {};             // coin -> does ANY linked wallet still hold it
    let sawDq = false;               // a wallet bought in a window and still holds, but failed the standard
    let scanFailed = false;          // at least one (wallet, coin) could not be read completely
    for (const c of COINS) {
      for (const a of addrs) {
        let s;
        // Isolate the failure to this ONE wallet-and-coin. Aborting the whole account here (which is
        // what `return 0` did) meant a single 429 on wallet 3 threw away clean results for wallets 1
        // and 2 — and since nothing is then written, the grant sweep re-selected the same account
        // forever and never reached anyone behind it. The pre-tier code isolated failures this way
        // too; losing that was a regression, not a tightening.
        try { s = await ogScan(a, c.token, c.pair, c.launch); }
        catch { scanFailed = true; continue; }
        // "Still holds" is asked across the WALLET SET, not of the wallet that bought — the same way
        // refreshHolder() sums holdings for revocation. Requiring one wallet to both buy and still
        // hold denied anyone who moved their bag to a hardware wallet after buying, which the rules
        // never said and the previous behaviour allowed.
        if (s.holds) holdsAny[c.key] = true;
        if (s.tier === OG_TIER.NONE) continue;
        // this wallet bought inside a window, but fails the standard for this coin
        if (ogDisqualified(s)) { sawDq = true; continue; }
        if (!best[c.key] || s.tier > best[c.key].tier) best[c.key] = s;
      }
    }
    const qualifies = (k) => best[k] && holdsAny[k];
    if (!qualifies('SEND') || !qualifies('GWC')) {
      // Only a COMPLETE read may be recorded as a real "did not qualify" — an incomplete one writes
      // nothing at all, so it is retried rather than frozen in as an answer.
      if (scanFailed) return 0;
      // og_dq records that a wallet was disqualified, so the dashboard can say something rather than
      // leave a window buyer guessing. It is deliberately NOT permanent — unlike og_revoked it is
      // rewritten by every scan, because a wallet that fails the net-accumulator test today can pass
      // it tomorrow by buying back. It never blocks a future grant on its own.
      db.prepare('UPDATE users SET og_checked_at = ?, og_dq = ? WHERE id = ?').run(now(), sawDq ? 1 : 0, userId);
      return 0;
    }
    const tier = Math.min(best.SEND.tier, best.GWC.tier);
    // A badge that pays up to 10× needs a real bag behind it: BOTH coins must be worth at least OG_MIN_HOLD_USD right now
    // (1e-9 tokens of each used to qualify). Priced at the live market; an unreadable price is no answer — retried, never a "no".
    let sendPx = null, gwcPx = null;
    try { sendPx = await sendPriceUsd(); gwcPx = await tokenPriceUsdOf(TOK.GWC); } catch { sendPx = null; }
    if (!(sendPx > 0) || !(gwcPx > 0)) return 0;
    const usdSend = Number(best.SEND.balWei || 0) / 1e18 * sendPx, usdGwc = Number(best.GWC.balWei || 0) / 1e18 * gwcPx;
    if (!(usdSend >= OG_MIN_HOLD_USD && usdGwc >= OG_MIN_HOLD_USD)) {
      db.prepare('UPDATE users SET og_checked_at = ?, og_dq = 0 WHERE id = ?').run(now(), userId); // a complete read with a real answer: below the floor today; a top-up re-qualifies on the next scan
      return 0;
    }
    const buyMs = Math.max(best.SEND.firstBuyMs, best.GWC.firstBuyMs); // when they completed the pair
    // Grant only while the invariant still holds: un-tiered, never revoked, and a wallet is STILL
    // linked — a disconnect landing during this multi-second scan must not leave a wallet-less
    // account wearing a badge.
    const g = db.prepare("UPDATE users SET og = 1, og_tier = ?, og_buy_ms = ?, og_checked_at = ? WHERE id = ? AND og_tier = 0 AND og_revoked = 0 AND EXISTS (SELECT 1 FROM identities WHERE user_id = users.id AND type = 'wallet')")
      .run(tier, buyMs, now(), userId);
    if (!g.changes) return 0;   // the invariant moved under us (disconnect / concurrent grant) — change nothing else
    db.prepare('UPDATE users SET og_dq = 0 WHERE id = ?').run(userId); // qualified — clear any earlier disqualification note
    notify(userId, '🏅', 'OG ' + OG_TIER_NAME[tier] + ' unlocked! You bought BOTH $SEND and $GWC inside the ' +
      OG_TIER_NAME[tier].toLowerCase() + ' window and still hold both (checked on-chain) — a permanent badge and a ' +
      OG_TIER_MULT[tier] + '× Send Power bonus on everything (+' + (OG_TIER_MULT[tier] - 1) + '× on top of any other boosts — boosts add, they don’t multiply). Keep holding both: sell out of either and it goes.', 'og');
    return tier;
  } finally {
    _ogScanning.delete(userId);
    // Stamped on EVERY attempt, success or failure. og_checked_at deliberately still means "last
    // clean result" (a failed read must never look like an answer), but ordering the sweep by that
    // alone meant an account whose scan always fails — a wallet past the page budget, say — stayed
    // at the front of the queue permanently and nobody behind it was ever scanned.
    try { db.prepare('UPDATE users SET og_try_at = ? WHERE id = ?').run(now(), userId); } catch {}
  }
}

// in-app notifications (bounded per user so history can't grow without limit)
const NOTIF_KEEP = 50;
const NOTIF_KEEP_SYSTEM = 200; // level-ups / OG / calls / wallet events are bounded by real events — and must never be evicted by social spam
function notify(userId, icon, text, kind, actorId) {
  if (!userId || !text) return;
  try {
    const k = kind || 'update';
    db.prepare('INSERT INTO notifications (user_id, kind, icon, text, created_at, actor_id) VALUES (?,?,?,?,?,?)').run(userId, k, icon || '🔔', String(text).slice(0, 240), now(), actorId || null);
    // trim social and system rows SEPARATELY so user-triggered notifications can only ever push out other social ones
    if (k === 'social') db.prepare("DELETE FROM notifications WHERE user_id=? AND kind='social' AND id NOT IN (SELECT id FROM notifications WHERE user_id=? AND kind='social' ORDER BY id DESC LIMIT ?)").run(userId, userId, NOTIF_KEEP);
    else db.prepare("DELETE FROM notifications WHERE user_id=? AND kind<>'social' AND id NOT IN (SELECT id FROM notifications WHERE user_id=? AND kind<>'social' ORDER BY id DESC LIMIT ?)").run(userId, userId, NOTIF_KEEP_SYSTEM);
  } catch {}
}
// social notifications (follow / react / upvote / comment) — throttled per identical message so a toggle war can't spam
// the bell, AND capped per actor (3 per window) so distinct-text comments can't flood a victim either
const SOCIAL_PER_ACTOR = 3;
function notifyOnce(userId, icon, text, kind, actorId, windowMs = 10 * 60 * 1000) {
  if (!userId || !text) return;
  const t = String(text).slice(0, 240);
  try {
    if (db.prepare('SELECT 1 FROM notifications WHERE user_id = ? AND text = ? AND created_at > ?').get(userId, t, now() - windowMs)) return;
    if (actorId && db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND actor_id = ? AND created_at > ?').get(userId, actorId, now() - windowMs).n >= SOCIAL_PER_ACTOR) return;
  } catch {}
  notify(userId, icon, t, kind, actorId);
}

// award points (holder-multiplied), deduped by ref, capped per kind/day
function awardPoints(userId, kind, base, ref, maxAmount) {
  if (!userId || !(base > 0)) return 0;
  // maxAmount is a caller-supplied ceiling on the FINAL, post-multiplier amount. It exists for
  // payouts that recur against one long-lived object (a Send Call pays its caller over and over as
  // the price holds up), where capping the base is not enough: the multiplier stack sits on top of
  // it, and the number of payouts is unbounded. Undefined means no extra ceiling.
  if (maxAmount != null && !(maxAmount > 0)) return 0;
  if (ref && db.prepare('SELECT 1 FROM points_events WHERE ref = ?').get(ref)) return 0;
  if (DAILY_CAP[kind]) {
    const cnt = db.prepare('SELECT COUNT(*) n FROM points_events WHERE user_id=? AND kind=? AND created_at>?').get(userId, kind, now() - 864e5).n;
    if (cnt >= DAILY_CAP[kind]) return 0;
  }
  const em = effectiveMult(userId);
  const effMult = em.total;
  let amount = Math.min(PTS_EVENT_CAP, Math.max(1, Math.round(base * effMult))); // clamp any single event (size × holder × OG stack) to a sane ceiling
  if (maxAmount != null) amount = Math.min(amount, Math.floor(maxAmount));
  if (SOCIAL_KINDS.includes(kind)) { // the grind's shared rolling-24h ceiling on what was PAID (see SOCIAL_DAY_CAP)
    const spent = db.prepare(`SELECT COALESCE(SUM(amount), 0) s FROM points_events WHERE user_id = ? AND created_at > ? AND kind IN (${SOCIAL_KINDS.map(() => '?').join(',')})`).get(userId, now() - 864e5, ...SOCIAL_KINDS).s;
    amount = Math.min(amount, SOCIAL_DAY_CAP - spent);
  }
  if (!(amount > 0)) return 0;
  try {
    db.exec('BEGIN');
    // comp_amount is what this award would have paid WITHOUT the Biggest Sender prize — the same base,
    // the same caps, the prize's share taken back out of the (additive) stack. The competition ranks
    // that, so last week's winners race on the same footing as everyone else: the prize pays their
    // level and the all-time board, never their next placing. Equal to amount when there is no prize.
    const compMult = Math.max(1, effMult - ((em.weekly || 1) - 1));
    let compAmount = Math.min(PTS_EVENT_CAP, Math.max(1, Math.round(base * compMult)));
    if (maxAmount != null) compAmount = Math.min(compAmount, Math.floor(maxAmount));
    compAmount = Math.min(compAmount, amount);
    db.prepare('INSERT INTO points_events (user_id, kind, amount, base, mult, comp_amount, ref, created_at) VALUES (?,?,?,?,?,?,?,?)').run(userId, kind, amount, base, effMult, compAmount, ref || null, now());
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(amount, userId);
    db.exec('COMMIT');
    compCache.rows = null; // standings changed — never let a user's own fresh award lag behind the cached board
  } catch { try { db.exec('ROLLBACK'); } catch {} return 0; } // unique-ref collision or crash → neither commits
  // notify on meaningful gains only (level-ups + notable actions) so the bell never floods on micro-actions
  try {
    const after = db.prepare('SELECT points FROM users WHERE id=?').get(userId).points;
    const before = after - amount;
    const lvlA = levelForXp(after), lvlB = levelForXp(before);
    if (lvlA > lvlB) notify(userId, '🎉', 'Level up! You reached Level ' + lvlA + ' — ' + titleFor(lvlA) + '.', 'levelup');
    else if (kind === 'daily') notify(userId, '📅', 'Daily bonus: +' + amount.toLocaleString('en-US') + ' Send Power for showing up.', 'points');
    else if (kind === 'swap') notify(userId, '💱', '+' + amount.toLocaleString('en-US') + ' Send Power for your swap.', 'points');
    else if (kind === 'connect_wallet') notify(userId, '🔗', 'Wallet connected — +' + amount.toLocaleString('en-US') + ' Send Power.', 'points');
    else if (kind === 'track_wallet') notify(userId, '💼', 'Added a wallet to your tracker — +' + amount.toLocaleString('en-US') + ' Send Power.', 'wallet');
  } catch {}
  return amount;
}

/* ===== Communities: XP + conviction + activity + anti-sybil helpers ===== */
const decayedActivity = (c) => (c.activity || 0) * Math.pow(0.5, (now() - (c.activity_at || now())) / COMM_HALFLIFE);
function bumpActivity(id, w) { const c = db.prepare('SELECT activity, activity_at FROM communities WHERE id=?').get(id); if (c) db.prepare('UPDATE communities SET activity=?, activity_at=? WHERE id=?').run(decayedActivity(c) + w, now(), id); }
const actTier = (v) => { let t = 'Dormant'; for (const [n, l] of ACT_TIERS) if (v >= n) t = l; return t; };
function convictionTitleFor(level) {
  if (level >= 99) return 'Ride-or-Die 🪦'; if (level >= 90) return 'True Believer'; if (level >= 75) return 'Zealot';
  if (level >= 60) return 'Devotee'; if (level >= 45) return 'Faithful'; if (level >= 30) return 'Regular';
  if (level >= 15) return 'Committed'; if (level >= 5) return 'Curious'; return 'Newcomer';
}
// --- arbitrary-token holdings (community gate + Convicted-In hover), read-only + cached ---
const HOLDS_TTL = 5 * 60 * 1000;                   // per-(user,token) balance cache
const tokenHoldCache = new Map();                  // `${uid}:${token}` -> { held, at }
// Does this user CURRENTLY hold a non-dust balance of an arbitrary token across their linked wallets?
// minUsd/priceUsd: when both are known the floor is that many dollars of the token at the given price (decimals from the token
// cache, 18 by default); otherwise the dust floor. A price that cannot be read never lowers the bar below dust, and never raises it.
function tokenDecimalsOf(addr) { try { const tc = tokenCacheGet(String(addr || '').toLowerCase()); return tc && tc.decimals != null ? (Number(tc.decimals) || 18) : 18; } catch { return 18; } }
async function tokenPriceUsdOf(addr) { try { const r = await lookupTokenPair(String(addr || '').toLowerCase()); const px = r && r.pair && Number(r.pair.priceUsd); return px > 0 ? px : null; } catch { return null; } }
async function holdsToken(uid, tokenAddr, minUsd, priceUsd) {
  const t = String(tokenAddr || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(t)) return false;
  let need = OG_DUST_WEI;
  if (minUsd > 0 && priceUsd > 0) { const dec = tokenDecimalsOf(t); const n = BigInt(Math.ceil(minUsd / priceUsd * 1e6)) * 10n ** BigInt(Math.max(0, dec - 6)); if (n > need) need = n; }
  const key = uid + ':' + t + ':' + need.toString();
  const addrs = walletAddresses(uid).slice(0, MAX_LINKED_WALLETS); // EVERY linkable wallet — a bag sitting in wallet #4 must count (refreshHolder reads the same set)
  if (!addrs.length) { tokenHoldCache.delete(key); return false; } // no linked wallet = verifiably holds nothing — and a cached "held" from before a disconnect must not outlive it
  const c = tokenHoldCache.get(key);
  if (c && now() - c.at < HOLDS_TTL) return c.held;
  let held = false, failed = 0;
  for (const a of addrs) {
    try { if ((await erc20Balance(t, a)) >= need) { held = true; break; } } catch { failed++; }
  }
  // a disconnect/link that landed while we were awaiting the chain changed the wallet set → the answer is real for the
  // OLD set only; return it but never cache it under the new set
  const same = walletAddresses(uid).slice(0, MAX_LINKED_WALLETS).join() === addrs.join();
  if (held) { if (same) tokenHoldCache.set(key, { held: true, at: now() }); return true; }
  // "not holding" is only VERIFIED when every wallet was actually read. Any failed read means we can't know — throw (503)
  // rather than return false, so the disconnect/sweep callers keep OG / qualification exactly as their try/catch comments
  // promise, and a partial RPC outage can never masquerade as a sell-out (or get cached as one).
  if (failed) { const e = new Error('holdings unreadable — chain RPC unavailable'); e.status = 503; throw e; }
  if (same) tokenHoldCache.set(key, { held: false, at: now() });
  return false;
}
function forgetHoldings(uid) { for (const k of tokenHoldCache.keys()) if (k.startsWith(uid + ':')) tokenHoldCache.delete(k); } // wallet set changed → re-read on next gate
const RPC_DOWN_MSG = "couldn't verify your holdings right now — the chain RPC is unreachable, try again in a minute";
// How much of a token does this user hold, and since when? (Convicted-In hover; public on-chain data of the wall owner's linked wallets.)
const HELD_TTL = 10 * 60 * 1000;
const heldCache = new Map();                        // `${uid}:${token}` -> { data, at }
async function convictionHolding(uid, tokenAddr) {
  const t = String(tokenAddr || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(t)) return { hasWallet: false, held: false };
  const key = uid + ':' + t, c = heldCache.get(key);
  if (c && now() - c.at < HELD_TTL) return c.data;
  const addrs = walletAddresses(uid);
  if (!addrs.length) { const d = { hasWallet: false, held: false }; heldCache.set(key, { data: d, at: now() }); return d; }
  let dec = 18; try { const dd = await tokenDecimals(t); if (dd != null) dec = dd; } catch {}
  let amountRaw = 0n, ok = false, earliest = 0, approx = false;
  for (const a of addrs.slice(0, SIZE_MAX_WALLETS)) {
    const meAddr = a.toLowerCase();
    try { amountRaw += await erc20Balance(t, a); ok = true; } catch {}
    try { // earliest incoming transfer of this token to this wallet (Blockscout is newest-first → page to the end, capped)
      const base = BLOCKSCOUT + '/api/v2/addresses/' + a + '/token-transfers?type=ERC-20&filter=to&token=' + t;
      let url = base, pages = 0, wEarliest = 0;
      while (url && pages < 3) {
        const j = await jget(url);
        if (!j || !Array.isArray(j.items)) break;
        for (const it of j.items) {
          if (((it.to && it.to.hash) || '').toLowerCase() !== meAddr) continue;
          const ts = Date.parse(it.timestamp || it.block_timestamp || '') || 0;
          if (ts && (!wEarliest || ts < wEarliest)) wEarliest = ts;
        }
        const np = j.next_page_params; url = np ? base + '&' + new URLSearchParams(np).toString() : null; pages++;
      }
      if (url) approx = true; // hit the page cap → true first acquisition may be even earlier
      if (wEarliest && (!earliest || wEarliest < earliest)) earliest = wEarliest;
    } catch {}
  }
  // Coarsen the exposed figures: a wall owner's EXACT balance + exact first-held ms would let anyone match the public
  // Blockscout holder list back to their wallet. Round the amount to 3 sig-figs and the first-held time to the day —
  // enough for the "how much / how long convicted" display, without the high-entropy keys that deanonymize a wallet.
  const sig3 = (n) => { if (!(n > 0)) return 0; const f = Math.pow(10, Math.floor(Math.log10(n)) - 2); return Math.round(n / f) * f; };
  const data = { hasWallet: true, held: amountRaw > OG_DUST_WEI, amountTok: sig3(Number(amountRaw) / Math.pow(10, dec)), heldSinceMs: earliest ? Math.floor(earliest / 864e5) * 864e5 : null, approx };
  if (ok) heldCache.set(key, { data, at: now() });
  return data;
}
// Shared current-market cache for arbitrary tokens (Convicted-In current mcap/Xs) — Dexscreener batch, 60s per token.
const MARKET_TTL = 60 * 1000;
const marketCache = new Map();                     // token -> { m:{price,mc,pc24,liq}, at }
async function marketFor(tokens) {
  const out = {}, need = [];
  for (const raw of tokens) { const k = String(raw || '').toLowerCase(); if (!/^0x[0-9a-f]{40}$/.test(k)) continue; const c = marketCache.get(k); if (c && now() - c.at < MARKET_TTL) out[k] = c.m; else if (!need.includes(k)) need.push(k); }
  for (let i = 0; i < need.length; i += 30) {
    const batch = need.slice(i, i + 30);
    let arr = null; try { arr = await jget('https://api.dexscreener.com/tokens/v1/robinhood/' + batch.join(',')); } catch {}
    const byTok = {};
    if (Array.isArray(arr)) for (const pr of arr) {
      const base = ((pr.baseToken && pr.baseToken.address) || '').toLowerCase();
      if (!base) continue;
      const liq = (pr.liquidity && Number(pr.liquidity.usd)) || 0;
      if (!byTok[base] || liq > byTok[base].liq) byTok[base] = { price: pr.priceUsd != null ? Number(pr.priceUsd) : null, mc: pr.marketCap != null ? Number(pr.marketCap) : (pr.fdv != null ? Number(pr.fdv) : null), pc24: pr.priceChange && pr.priceChange.h24 != null ? Number(pr.priceChange.h24) : null, liq };
    }
    for (const k of batch) { const m = byTok[k]; if (m) { marketCache.set(k, { m, at: now() }); out[k] = m; } } // don't cache a miss (transient throttle)
  }
  return out;
}
// Community XP is logged in points_events (kind='commxp') so dedupe + caps reuse existing infra; refs are 'c<cid>:<kind>:...'
function awardCommunityXp(cid, uid, kind, base, ref) {
  if (!cid || !(base > 0)) return 0;
  const c = db.prepare("SELECT status FROM communities WHERE id=?").get(cid);
  if (!c || c.status !== 'live') return 0;                                    // a solo/pending community can't be leveled
  if (ref && db.prepare('SELECT 1 FROM points_events WHERE ref=?').get(ref)) return 0;
  const cap = COMM_XP_DAILY_CAP[kind];
  if (cap) { const n = db.prepare("SELECT COUNT(*) n FROM points_events WHERE kind='commxp' AND ref LIKE ? AND created_at>?").get('c' + cid + ':' + kind + ':%', now() - 864e5).n; if (n >= cap) return 0; }
  const mine = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM points_events WHERE user_id=? AND kind='commxp' AND ref LIKE ? AND created_at>?").get(uid, 'c' + cid + ':%', now() - 864e5).t;
  const amount = Math.min(base, COMM_XP_PER_USER_DAY - mine); if (amount <= 0) return 0; // one member can't push more than COMM_XP_PER_USER_DAY/day
  try {
    db.exec('BEGIN');
    db.prepare('INSERT INTO points_events (user_id,kind,amount,base,mult,ref,created_at) VALUES (?,?,?,?,1,?,?)').run(uid, 'commxp', amount, base, ref || ('c' + cid + ':' + kind + ':' + uid + ':' + now()), now());
    // all-time XP plus the weekly bucket (a new week zeroes xp_week before adding, so the board resets on its own)
    db.prepare('UPDATE communities SET xp = xp + ?, xp_week = CASE WHEN week_key = ? THEN xp_week ELSE 0 END + ?, week_key = ? WHERE id=?')
      .run(amount, weekKey(), amount, weekKey(), cid);
    db.exec('COMMIT');
  } catch { try { db.exec('ROLLBACK'); } catch {} return 0; }
  return amount;
}
// Per-member conviction XP (kind='convxp', refs 'v<cid>:...'); only qualified members accrue it, capped per community/day.
function awardConviction(cid, uid, kind, base, ref) {
  if (!cid || !(base > 0)) return 0;
  if (!db.prepare("SELECT 1 FROM community_members WHERE community_id=? AND user_id=? AND qualified=1").get(cid, uid)) return 0;
  if (ref && db.prepare('SELECT 1 FROM points_events WHERE ref=?').get(ref)) return 0;
  const earned = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM points_events WHERE user_id=? AND kind='convxp' AND ref LIKE ? AND created_at>?").get(uid, 'v' + cid + ':%', now() - 864e5).t;
  const amount = Math.min(base, CONV_DAILY_CAP - earned); if (amount <= 0) return 0;
  try {
    db.exec('BEGIN');
    db.prepare('INSERT INTO points_events (user_id,kind,amount,base,mult,ref,created_at) VALUES (?,?,?,?,1,?,?)').run(uid, 'convxp', amount, base, ref || ('v' + cid + ':' + kind + ':' + uid + ':' + now()), now());
    db.prepare('UPDATE community_members SET conviction_xp = conviction_xp + ? WHERE community_id=? AND user_id=?').run(amount, cid, uid);
    db.exec('COMMIT');
  } catch { try { db.exec('ROLLBACK'); } catch {} return 0; }
  return amount;
}
// Does this opt-in COUNT toward go-live (and grant the 10× / conviction)? Gates the anti-sybil surface in one place.
// `holds` = the caller verified on-chain (via a linked wallet) that this user holds the community's OWN token.
// Why an opt-in does NOT count as a verified holder slot (null = it does). The reason is shown to the member so a
// holder blocked by the anti-sybil caps is never told "Opted in!" and then left wondering why posting/10× are off.
function qualifyReason(me, c, ip, holds) {
  // A demo community is an open sandbox: anyone may join and use every feature. It deliberately
  // skips the holding test AND the per-network anti-sybil cap, which is safe only because a demo
  // membership grants no Send Power multiplier (see joinCommunity) — so there is nothing to farm.
  if (c.demo) return null;
  if (!holds) return 'You must hold at least $' + MIN_COMMUNITY_HOLD_USD + ' of $' + c.symbol + ' (verified on-chain from a linked wallet).'; // MUST hold the community's own token — read-only
  const ipk = ip ? bidx(ip) : null; // IPs are stored only as blind indexes
  const ipUses = db.prepare("SELECT COUNT(*) n FROM community_members WHERE community_id=? AND qualified=1 AND join_ip=?").get(c.id, ipk).n;
  if (ipUses >= 2) return 'You hold $' + c.symbol + ', but 2 verified members already opted in from your network (the anti-sybil cap). You’re in as a member — posting and the 10× need a verified slot.'; // ≤2 qualifying opt-ins per IP
  if (ipk && ipk === c.creator_ip && me.id !== c.creator_id) return 'Opt-ins from the starter’s own network don’t count as verified (anti-sybil) — you’re in as a member, without the 10×.'; // founder-IP opt-ins don't count toward their own go-live
  return null;
}
function qualifyOptIn(me, c, ip, holds) { return !qualifyReason(me, c, ip, holds); }
function commBrand(c) { try { return JSON.parse(c.brand || 'null') || {}; } catch { return {}; } }
/* The community a post came from, in the shape the Send Wall needs to badge it. Public community posts now
   appear on the public wall, so each one has to carry enough of its community to be recognised and followed
   back to — otherwise it lands among strangers' posts with no explanation of where it came from. */
/* An invite on the public Send Wall, so a new community is not a room nobody knows exists.
   Posted AS THE CREATOR and tagged with the community, so it renders with the community's branding and links
   straight back — the same treatment every other community post now gets on the wall.

   Two moments earn one: the day it is started (when it needs people to reach the go-live threshold, which is
   exactly when being seen matters most) and the day it goes live. Each fires once, ever, deduped through a
   marker row in points_events — the same idiom the join/activity markers already use — so a restart, a
   re-join or a second go-live transition cannot repost it.

   It earns no Send Power. It is the site announcing something on a user's behalf, not something they did. */
function communityInvitePost(cid, kind) {
  const ref = 'cinvite:' + cid + ':' + kind;
  try { if (db.prepare('SELECT 1 FROM points_events WHERE ref = ?').get(ref)) return 0; } catch { return 0; }
  const c = db.prepare('SELECT * FROM communities WHERE id = ?').get(cid);
  if (!c) return 0;
  const sym = '$' + c.symbol;
  const text = kind === 'live'
    ? '🎉 The ' + sym + ' community is LIVE. Come say something — hold ' + sym + ' and you are in.'
    : '🏘️ Started a community for ' + sym + '. It needs ' + LIVE_THRESHOLD + ' holders to go live — if you hold ' + sym + ', come and join.';
  try {
    db.exec('BEGIN');
    const r = db.prepare('INSERT INTO posts (user_id, text, community_id, private, created_at) VALUES (?,?,?,0,?)')
      .run(c.creator_id, text, cid, now());
    db.prepare('INSERT INTO points_events (user_id, kind, amount, base, mult, ref, created_at) VALUES (?,?,0,0,1,?,?)')
      .run(c.creator_id, 'cinvite', ref, now());
    db.exec('COMMIT');
    return Number(r.lastInsertRowid);
  } catch { try { db.exec('ROLLBACK'); } catch {} return 0; }
}
function postCommunities(ids) {
  const out = {};
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  const rows = db.prepare(`SELECT id, symbol, name, brand, status, demo, token_addr FROM communities WHERE id IN (${uniq.map(() => '?').join(',')})`).all(...uniq);
  for (const c of rows) {
    const b = commBrand(c);
    out[c.id] = { id: c.id, symbol: c.symbol, name: c.name, image: b.imageUrl || null, status: c.status, demo: !!c.demo, token: c.token_addr };
  }
  return out;
}
function commLevelInfo(xp) { const lvl = levelForXp(xp); const base = xpForLevel(lvl), next = xpForLevel(lvl + 1); return { level: lvl, xp: xp, intoLevel: xp - base, spanLevel: next != null ? next - base : null }; }
function communityCardView(c, me) {
  const b = commBrand(c), act = decayedActivity(c);
  return {
    id: c.id, token: c.token_addr, pair: c.pair_addr, symbol: c.symbol, name: c.name,
    image: b.imageUrl || null, banner: b.header || null,
    status: c.status, memberCount: c.member_count, qualCount: c.qual_count, need: LIVE_THRESHOLD, remaining: Math.max(0, LIVE_THRESHOLD - c.qual_count),
    // the sandbox has no token: its market fields are null and the company's stock quote rides in `stock`
    holders: c.demo ? null : c.c_holders, mcap: c.demo ? null : c.c_mc, price: c.demo ? null : c.c_price, priceChange: c.demo ? null : c.c_pc24, liq: c.demo ? null : c.c_liq,
    stock: c.demo ? stockView() : null,
    level: levelForXp(c.xp), activity: Math.round(act * 10) / 10, activityTier: actTier(act),
    official: !!c.official, // the $Send / $GWC house communities — pinned first, always live
    demo: !!c.demo,         // the open sandbox: joinable with no tokens, and grants no multiplier
    joined: me ? !!db.prepare('SELECT 1 FROM community_members WHERE community_id=? AND user_id=?').get(c.id, me.id) : false,
  };
}
// The house communities: $Send and $GWC exist from day one (owned by the site's own system account), live immediately,
// pinned to the top of the Communities page so a newcomer can see what participating looks like and join in one tap.
let officialSeedTimer = null;
// The open sandbox: a community branded for Robinhood Chain itself that ANYONE can join with no
// tokens at all, so a newcomer can try posting, proposing, voting and snapshots before they own
// anything. It is pointed at the chain's WETH contract so the snapshot feature reads real on-chain
// holders rather than inventing data. Deliberately grants no Send Power multiplier — see joinCommunity.
/* ===== The sandbox's brand: the listed company behind the chain, not a token ==========================
   The open sandbox is branded for Robinhood Markets, Inc. (NASDAQ: HOOD) — the public company whose app and
   chain this site runs on — and the numbers it shows are the STOCK's, read from public quote endpoints,
   never a token's (the first version keyed it to WETH and so wore WETH's price, cap and holder count as if
   they were its own). Sources are tried in order and parsed to one shape; a quote that cannot be read is
   null, never guessed, and one that could not be re-read says it is stale. No Robinhood artwork or marks are
   used anywhere: the site brands it with its own emoji and plain naming, and every view carries the
   not-affiliated line. A stock cannot be bought, held or swapped here, and nothing about it is advice. */
const DEMO_STOCK = { symbol: 'HOOD', name: 'Robinhood Markets', longName: 'Robinhood Markets, Inc.', exchange: 'NASDAQ',
  quoteUrl: 'https://www.nasdaq.com/market-activity/stocks/hood', irUrl: 'https://investors.robinhood.com' };
// a synthetic key: no contract lives at this address, so no real token's tag or market data can ever attach to the sandbox
const DEMO_TOKEN = '0x' + crypto.createHash('sha256').update('justsendit:sandbox:' + DEMO_STOCK.symbol).digest('hex').slice(0, 40);
const demoToken = () => DEMO_TOKEN;
const STOCK_TTL = 5 * 60e3, STOCK_STALE_MAX = 24 * 36e5;
let stockCache = { at: 0, val: null, fetching: false, lastErr: 0 };
const qnum = s => { if (s == null) return null; const t = String(s).replace(/[$,%\s]/g, ''); if (t === '' || t === '-' || t === '+') return null; const n = Number(t); return isFinite(n) ? n : null; }; // a blank field is no figure, not zero
const qcap = s => { const m = /^([\d.]+)([KMBT])?$/i.exec(String(s || '').replace(/[$,\s]/g, '')); if (!m) return null; const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] || '').toUpperCase()] || 1; return Number(m[1]) * mult; };
function parseCnbcQuote(j) {
  const q = j && j.FormattedQuoteResult && j.FormattedQuoteResult.FormattedQuote && j.FormattedQuoteResult.FormattedQuote[0];
  if (!q || !(qnum(q.last) > 0)) return null;
  const t = q.last_time ? Date.parse(q.last_time) : NaN;
  return { price: qnum(q.last), change: qnum(q.change), changePct: qnum(q.change_pct), prevClose: qnum(q.previous_day_closing), open: qnum(q.open), high: qnum(q.high), low: qnum(q.low), volume: qnum(q.volume), marketCap: qcap(q.mktcapView),
    week52High: qnum(q.yrhiprice), week52Low: qnum(q.yrloprice), marketState: q.curmktstatus === 'REG_MKT' ? 'Open' : 'Closed', asOfText: q.last_timedate || null, asOf: isFinite(t) ? t : null,
    exchange: q.exchange || null, currency: q.currencyCode || 'USD', source: 'CNBC' };
}
function parseYahooQuote(j) {
  const r = j && j.chart && j.chart.result && j.chart.result[0], m = r && r.meta; if (!m || !(Number(m.regularMarketPrice) > 0)) return null;
  const prev = m.chartPreviousClose != null ? Number(m.chartPreviousClose) : (m.previousClose != null ? Number(m.previousClose) : null);
  const price = Number(m.regularMarketPrice), change = prev != null ? price - prev : null;
  const n = v => (v != null && isFinite(Number(v)) ? Number(v) : null);
  return { price, change, changePct: change != null && prev ? change / prev * 100 : null, prevClose: prev, open: null, high: n(m.regularMarketDayHigh), low: n(m.regularMarketDayLow), volume: n(m.regularMarketVolume), marketCap: null,
    week52High: n(m.fiftyTwoWeekHigh), week52Low: n(m.fiftyTwoWeekLow), marketState: null, asOfText: null, asOf: m.regularMarketTime ? Number(m.regularMarketTime) * 1000 : null,
    exchange: /NMS|NASDAQ/i.test(m.exchangeName || '') ? 'NASDAQ' : (m.fullExchangeName || m.exchangeName || null), currency: m.currency || 'USD', source: 'Yahoo Finance' };
}
// The site asks for the quote AS ITSELF: a truthful User-Agent, no forged Origin/Referer, no browser impersonation.
// Nasdaq's endpoint only answers requests dressed up as nasdaq.com's own web app, so it is not used. These two answer
// an honest identity today; they are still undocumented, browser-facing feeds, so the source is credited wherever the
// figure appears and the operator can turn the live figure off with STOCK_QUOTE=0 (the page then shows no price at
// all — never a stale or invented one). For production, a licensed quote feed is the right long-term source.
const STOCK_QUOTE_LIVE = process.env.STOCK_QUOTE !== '0';
const STOCK_SOURCES = [
  { url: 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=' + DEMO_STOCK.symbol + '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json', parse: parseCnbcQuote },
  { url: 'https://query1.finance.yahoo.com/v8/finance/chart/' + DEMO_STOCK.symbol + '?range=1d&interval=1d', parse: parseYahooQuote },
];
const QUOTE_MAX_BYTES = 256 * 1024;
async function fetchQuoteJson(url) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'JustSendIt/1.0 (+' + BASE_URL + '; one stock quote for one page, at most once per 5 minutes)', Accept: 'application/json' }, signal: ac.signal, redirect: 'error' });
    if (!r.ok) return null;
    const len = Number(r.headers.get('content-length') || 0); if (len > QUOTE_MAX_BYTES) return null;
    const txt = await r.text(); if (txt.length > QUOTE_MAX_BYTES) return null;
    return JSON.parse(txt);
  } catch { return null; } finally { clearTimeout(tm); }
}
async function refreshStock() {
  if (stockCache.fetching) return;
  stockCache.fetching = true;
  try {
    for (const src of STOCK_SOURCES) {
      const j = await fetchQuoteJson(src.url); let q = null;
      try { q = j && src.parse(j); } catch { q = null; }
      if (q && q.price > 0) { stockCache = { at: now(), val: { ...q, fetchedAt: now() }, fetching: false, lastErr: 0 }; return; }
    }
    stockCache.lastErr = now();           // every source failed: keep whatever we had, and say so
  } finally { stockCache.fetching = false; }
}
function maybeRefreshStock() { if (STOCK_QUOTE_LIVE && now() - stockCache.at > STOCK_TTL && !stockCache.fetching && now() - stockCache.lastErr > 60e3) refreshStock().catch(() => {}); }
// what the sandbox's views carry: the company facts always, the quote only when one was actually read
function stockView() {
  maybeRefreshStock();
  const v = stockCache.val && now() - stockCache.val.fetchedAt <= STOCK_STALE_MAX ? stockCache.val : null;
  // stale = a re-read was attempted and every source failed since this quote was taken (the refresh is lazy, so
  // simply being the first viewer after a quiet spell is not staleness — the as-of time already says how old it is)
  if (!STOCK_QUOTE_LIVE) return { ...DEMO_STOCK, price: null, stale: false, live: false };   // the operator turned the live figure off
  return v ? { ...DEMO_STOCK, ...v, stale: stockCache.lastErr > v.fetchedAt, live: true } : { ...DEMO_STOCK, price: null, stale: false, live: true };
}
function seedDemoCommunity() {
  try {
    let owner = db.prepare('SELECT id FROM users WHERE system = 1').get();
    if (!owner) return; // the official seeder creates the system account; it runs first
    // an existing sandbox (by flag, or by the WETH key the first version used) is re-branded in place, and the
    // token-shaped market fields a real token once filled are cleared — the stock quote replaces them
    const ex = db.prepare('SELECT id FROM communities WHERE demo = 1').get() || db.prepare('SELECT id FROM communities WHERE token_addr = ? COLLATE NOCASE').get(WETH_ADDR.toLowerCase());
    if (ex) {
      // demo, not official: the 🏠 Official badge means "run by the site" beside a token you hold for 10× — neither is true here,
      // and a listed company's name must not sit under anything that reads as an endorsement either way
      db.prepare("UPDATE communities SET demo=1, official=0, status='live', symbol=?, name=?, token_addr=?, pair_addr=?, c_price=NULL, c_mc=NULL, c_pc24=NULL, c_liq=NULL, c_holders=NULL WHERE id=?")
        .run(DEMO_STOCK.symbol, DEMO_STOCK.name, demoToken(), demoToken(), ex.id);
      maybeRefreshStock(); return;
    }
    db.prepare(`INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, brand, status, official, demo,
                founder_paid, went_live_at, creator_ip, created_at)
                VALUES (?,?,?,?,?,?,'live',0,1,1,?,NULL,?)`)
      .run(owner.id, demoToken(), demoToken(), DEMO_STOCK.symbol, DEMO_STOCK.name,
           JSON.stringify({ enhanced: false, boosted: 0, imageUrl: null, header: null, websites: [], socials: [] }),
           now(), now());
    console.log('🏘️ seeded the open sandbox community — branded for ' + DEMO_STOCK.longName + ' (' + DEMO_STOCK.exchange + ': ' + DEMO_STOCK.symbol + ')');
    maybeRefreshStock();
  } catch (e) { console.error('demo community seed failed:', e && e.message); }
}
async function seedOfficialCommunities() {
  try {
    let owner = db.prepare('SELECT id FROM users WHERE system = 1').get();
    if (!owner) {
      const uname = usernameTaken('JustSendIt') ? 'JustSendIt_Official' : 'JustSendIt';
      const r = db.prepare('INSERT INTO users (username, auto_named, created_at, system, bio, avatar) VALUES (?,?,?,?,?,?)').run(uname, 0, now(), 1, 'The site itself — not a person. Owns the official $Send and $GWC communities.', '🚀');
      owner = { id: Number(r.lastInsertRowid) };
    }
    let missing = 0;
    for (const key of ['SEND', 'GWC']) {
      const token = TOK[key].toLowerCase();
      const ex = db.prepare('SELECT id, official, status FROM communities WHERE token_addr = ? COLLATE NOCASE').get(token);
      if (ex) { if (!ex.official || ex.status !== 'live') db.prepare("UPDATE communities SET official = 1, status = 'live', went_live_at = COALESCE(went_live_at, ?), founder_paid = 1 WHERE id = ?").run(now(), ex.id); continue; }
      let r; try { r = await lookupTokenPair(token); } catch { missing++; continue; }
      const pr = r && r.pair; if (!pr || !pr.pair || r.notFound) { missing++; continue; }
      db.prepare('INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, brand, status, official, founder_paid, went_live_at, creator_ip, c_price, c_mc, c_pc24, c_liq, c_holders, c_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(owner.id, token, pr.pair.address, SYMBOL_OK(pr.token && pr.token.symbol) || key, String((pr.token && pr.token.name) || key).slice(0, 60), JSON.stringify(sanitizeBrand(pr.brand || {})), 'live', 1, 1, now(), null,
          pr.market ? pr.market.priceUsd : null, pr.market ? pr.market.marketCap : null, (pr.priceChange && pr.priceChange.h24) || null, pr.market ? pr.market.liquidityUsd : null, (pr.holders && pr.holders.count) || null, now(), now());
      console.log('🏘️ seeded the official $' + key + ' community');
    }
    if (missing && !officialSeedTimer) { officialSeedTimer = setTimeout(() => { officialSeedTimer = null; seedOfficialCommunities().catch(() => {}); }, 10 * 60 * 1000); officialSeedTimer.unref(); } // Dexscreener was unreachable → retry later
  } catch (e) { console.error('official community seed failed:', e && e.message); }
}
function communityDetailView(c, me, ip) {
  const card = communityCardView(c, me);
  const creator = db.prepare('SELECT username FROM users WHERE id=?').get(c.creator_id);
  let mine = null;
  if (me) { const m = db.prepare('SELECT * FROM community_members WHERE community_id=? AND user_id=?').get(c.id, me.id); if (m) { const cvl = commLevelInfo(m.conviction_xp); mine = { joined: true, qualified: !!m.qualified, blockReason: (!m.qualified && ip) ? qualifyReason(me, c, ip, true) : null, /* non-holding block (anti-sybil) shown to the member; null = only holdings are missing */ convictionXp: m.conviction_xp, convictionLevel: cvl.level, convictionTitle: convictionTitleFor(cvl.level), convictionInto: cvl.intoLevel, convictionSpan: cvl.spanLevel, isCreator: me.id === c.creator_id }; } }
  return { ...card, socials: (commBrand(c).socials || []), websites: (commBrand(c).websites || []), communityLevel: commLevelInfo(c.xp), goLive: { qualCount: c.qual_count, need: LIVE_THRESHOLD, remaining: Math.max(0, LIVE_THRESHOLD - c.qual_count) }, creator: creator ? creator.username : null, mine };
}
// The opt-in / go-live / founder-bonus transaction — shared by create (creator auto-opt-in) and the join endpoint.
// `holds` = verified on-chain (by the caller) that this user holds the community's own token.
function joinCommunity(me, cid, ip, holds) {
  const c = db.prepare('SELECT * FROM communities WHERE id=?').get(cid);
  if (!c) return { error: 'not found' };
  // a member whose row was de-qualified (sold, disconnected, moved bags) is NOT a dead end: joining again while holding
  // re-qualifies the same row (the XP/activity refs below are deduped, so a re-qualify can't double-pay)
  const existing = db.prepare('SELECT qualified FROM community_members WHERE community_id=? AND user_id=?').get(cid, me.id);
  if (existing && existing.qualified) return { alreadyMember: true };
  const isNew = !existing;
  const reason = qualifyReason(me, c, ip, holds);
  const qual = !reason;
  if (!isNew && !qual) return { alreadyMember: true, qualified: false, reason };
  const wasLive = c.status === 'live';
  let wentLive = false;
  try {
    db.exec('BEGIN');
    if (isNew) db.prepare('INSERT INTO community_members (community_id, user_id, joined_at, qualified, join_ip) VALUES (?,?,?,?,?)').run(cid, me.id, now(), qual ? 1 : 0, ip ? bidx(ip) : null);
    else db.prepare('UPDATE community_members SET qualified = 1, qual_check_at = ?, join_ip = ? WHERE community_id=? AND user_id=?').run(now(), ip ? bidx(ip) : null, cid, me.id);
    db.prepare('UPDATE communities SET member_count = member_count + ' + (isNew ? 1 : 0) + (qual ? ', qual_count = qual_count + 1' : '') + ' WHERE id=?').run(cid);
    // THE ONE THING A DEMO MEMBERSHIP MUST NOT DO: grant the flat 10× Send Power. Demo members get a
    // qualified row so they can post, vote, propose and take snapshots like anyone else, but
    // live_comm_count is untouched, so joining the sandbox cannot multiply what you earn site-wide.
    if (qual && wasLive && !c.demo) db.prepare('UPDATE users SET live_comm_count = live_comm_count + 1 WHERE id=?').run(me.id);
    if (!wasLive && (c.qual_count + (qual ? 1 : 0)) >= LIVE_THRESHOLD) {
      db.prepare("UPDATE communities SET status='live', went_live_at=? WHERE id=?").run(now(), cid);
      db.prepare('UPDATE users SET live_comm_count = live_comm_count + 1 WHERE id IN (SELECT user_id FROM community_members WHERE community_id=? AND qualified=1)').run(cid); // grant the 10× flag to ALL qualified members on go-live
      wentLive = true;
    }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} return { error: 'join failed' }; }
  // announced only after the go-live actually committed — never for a transaction that rolled back
  if (wentLive) { try { communityInvitePost(cid, 'live'); } catch {} }
  // XP + activity (each its own txn, ref-deduped)
  awardCommunityXp(cid, me.id, 'join', COMM_XP.join, 'c' + cid + ':join:' + me.id);
  if (qual) awardConviction(cid, me.id, 'join', CONV_XP.join, 'v' + cid + ':join:' + me.id);
  // Activity from a join counts only on a member's FIRST-EVER join of this community — a persistent
  // marker (survives leave) makes join→leave→rejoin unable to farm the grid's activity ranking.
  const joinActRef = 'a' + cid + ':join:' + me.id;
  if (!db.prepare("SELECT 1 FROM points_events WHERE ref=?").get(joinActRef)) {
    try { db.prepare("INSERT INTO points_events (user_id,kind,amount,base,mult,ref,created_at) VALUES (?,?,0,0,1,?,?)").run(me.id, 'commact', joinActRef, now()); bumpActivity(cid, W_join); } catch {}
  }
  // founder bonus — paid once, ever, when the community reaches live (idempotent via the unique points_events ref)
  let founderPaid = 0;
  const nowLive = wentLive || wasLive;
  if (nowLive) {
    const fresh = db.prepare('SELECT creator_id, founder_paid FROM communities WHERE id=?').get(cid);
    if (fresh && !fresh.founder_paid) {
      db.prepare('UPDATE communities SET founder_paid=1 WHERE id=? AND founder_paid=0').run(cid);
      founderPaid = awardPoints(fresh.creator_id, 'community_founder', FOUNDER_BONUS, 'commfound:u' + fresh.creator_id); // one founder bonus per ACCOUNT, ever — per community it was farmable daily by the same ten wallets
      if (founderPaid > 0) notify(fresh.creator_id, '🏛️', 'Your community went LIVE — +' + founderPaid.toLocaleString('en-US') + ' Send Power founder bonus 👑', 'community');
    }
  }
  const c2 = db.prepare('SELECT status, member_count, qual_count FROM communities WHERE id=?').get(cid);
  return { joined: true, qualified: qual, reason: reason || null, requalified: !isNew, wentLive, status: c2.status, memberCount: c2.member_count, qualCount: c2.qual_count, remaining: Math.max(0, LIVE_THRESHOLD - c2.qual_count), founder: { awarded: founderPaid > 0, points: founderPaid } };
}
// grid market refresh (mirrors maybeRefreshCalls): batch live communities' tokens against Dexscreener
let lastCommRefresh = 0, commRefreshing = false;
function maybeRefreshCommunities() { if (now() - lastCommRefresh > 45000 && !commRefreshing) { lastCommRefresh = now(); commRefreshing = true; refreshCommunities().catch(() => {}).finally(() => { commRefreshing = false; }); } }
async function refreshCommunities() {
  const rows = db.prepare("SELECT id, token_addr FROM communities WHERE demo = 0").all(); // the sandbox has no token to price
  const tokens = [...new Set(rows.map(r => r.token_addr.toLowerCase()))];
  if (!tokens.length) return;
  const byToken = {};
  for (let i = 0; i < tokens.length; i += 30) {
    const batch = tokens.slice(i, i + 30);
    const arr = await jget('https://api.dexscreener.com/tokens/v1/robinhood/' + batch.join(','));
    if (arr == null) continue;
    for (const pr of arr) {
      const base = pr.baseToken && pr.baseToken.address && pr.baseToken.address.toLowerCase();
      if (!base) continue;
      const liq = (pr.liquidity && Number(pr.liquidity.usd)) || 0;
      if (!byToken[base] || liq > byToken[base].liq) byToken[base] = { price: pr.priceUsd != null ? Number(pr.priceUsd) : null, mc: pr.marketCap != null ? Number(pr.marketCap) : (pr.fdv != null ? Number(pr.fdv) : null), pc24: pr.priceChange && pr.priceChange.h24 != null ? Number(pr.priceChange.h24) : null, liq };
    }
  }
  // Holder counts aren't in the Dexscreener batch — refresh them from Blockscout so the grid's
  // "holders" figure stays live like the rest of the market data (bounded per cycle to be gentle).
  const holdersByToken = {};
  for (const tok of tokens.slice(0, 24)) {
    const meta = await jget(BLOCKSCOUT + '/api/v2/tokens/' + tok);
    if (meta) { const hc = meta.holders_count != null ? Number(meta.holders_count) : (meta.holders != null ? Number(meta.holders) : NaN); if (hc > 0) holdersByToken[tok] = hc; }
  }
  const upd = db.prepare('UPDATE communities SET c_price=?, c_mc=?, c_pc24=?, c_liq=?, c_holders=COALESCE(?, c_holders), c_at=? WHERE id=?');
  for (const r of rows) { const k = r.token_addr.toLowerCase(); const m = byToken[k]; if (m) upd.run(m.price, m.mc, m.pc24, m.liq, holdersByToken[k] != null ? holdersByToken[k] : null, now(), r.id); }
}

/* ===== Best Runners: persistent price baseline + trailing-window snapshots for the New Pairs "Best Runners" tab ===== */
const RUNNER_MIN_LIQ = 300;                         // ignore dust pools when ranking runners / setting peaks
const RUNNER_SNAP_INTERVAL = 20 * 60 * 1000;       // at most one price snapshot per token per 20 min
const RUNNER_SNAP_MAX_AGE = 400 * 864e5;           // prune snapshots older than ~13 months
const RUNNER_KEEP = 600;                            // cap the retained token universe
const RUNNER_MATURE_MS = 30 * 864e5;               // "all-time" gain is only labeled exact once a token has ~30d of tracked history
const RUNNER_WINDOWS = { '24h': 864e5, 'week': 7 * 864e5, 'month': 30 * 864e5, 'year': 365 * 864e5, 'all': null };
function runnerBrand(j) { try { const b = JSON.parse(j || 'null'); return b && b.imageUrl ? { imageUrl: b.imageUrl } : null; } catch { return null; } }
// Upsert freshly-enriched live pairs into the runner store (first-seen baseline + peak + throttled snapshot).
function recordRunners(pairs) {
  for (const p of pairs || []) {
    try {
      const tok = ((p.token && p.token.address) || '').toLowerCase();
      const price = p.market && p.market.priceUsd;
      if (!/^0x[0-9a-f]{40}$/.test(tok) || !(price > 0)) continue;
      const mc = (p.market && p.market.marketCap != null) ? p.market.marketCap : null;
      const liq = (p.market && p.market.liquidityUsd != null) ? p.market.liquidityUsd : null;
      const trustworthy = liq != null && liq >= RUNNER_MIN_LIQ; // a dust/drained pool can't set the ranking baseline, peak, or a snapshot
      const basePrice = trustworthy ? price : null, baseMc = trustworthy ? mc : null;
      const brand = (p.brand && p.brand.imageUrl) ? JSON.stringify({ imageUrl: dexCdnImg(p.brand.imageUrl) }) : null;
      const pair = ((p.pair && p.pair.address) || '').toLowerCase() || null;
      const sym = String((p.token && p.token.symbol) || '').slice(0, 16), name = String((p.token && p.token.name) || '').slice(0, 60);
      const pc24 = (p.priceChange && p.priceChange.h24 != null) ? p.priceChange.h24 : null;
      const holders = (p.holders && p.holders.count != null) ? p.holders.count : null;
      const health = (p.risk && p.risk.health != null) ? p.risk.health : null;
      const ex = db.prepare('SELECT peak_price FROM runner_tokens WHERE token_addr=?').get(tok);
      if (!ex) {
        db.prepare('INSERT INTO runner_tokens (token_addr,pair_addr,symbol,name,brand,first_price,first_mc,first_seen_at,peak_price,peak_at,cur_price,cur_mc,cur_liq,cur_pc24,cur_holders,cur_health,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(tok, pair, sym, name, brand, basePrice, baseMc, now(), basePrice, basePrice != null ? now() : null, price, mc, liq, pc24, holders, health, now());
      } else {
        const oldPeak = ex.peak_price || 0, peak = trustworthy ? Math.max(oldPeak, price) : oldPeak, peakAt = peak > oldPeak ? now() : null;
        db.prepare('UPDATE runner_tokens SET pair_addr=COALESCE(?,pair_addr), symbol=?, name=?, brand=COALESCE(?,brand), first_price=COALESCE(first_price,?), first_mc=COALESCE(first_mc,?), peak_price=?, peak_at=COALESCE(?,peak_at), cur_price=?, cur_mc=?, cur_liq=?, cur_pc24=?, cur_holders=?, cur_health=?, last_seen_at=? WHERE token_addr=?')
          .run(pair, sym, name, brand, basePrice, baseMc, peak, peakAt, price, mc, liq, pc24, holders, health, now(), tok);
      }
      if (trustworthy) { const last = db.prepare('SELECT MAX(at) a FROM runner_snaps WHERE token_addr=?').get(tok).a || 0; if (now() - last >= RUNNER_SNAP_INTERVAL) db.prepare('INSERT INTO runner_snaps (token_addr, at, price) VALUES (?,?,?)').run(tok, now(), price); }
    } catch {}
  }
}
let lastRunnerRefresh = 0, runnersRefreshing = false;
function maybeRefreshRunners() { if (now() - lastRunnerRefresh > 60000 && !runnersRefreshing) { lastRunnerRefresh = now(); runnersRefreshing = true; refreshRunners().catch(() => {}).finally(() => { runnersRefreshing = false; }); } }
// Keep prices fresh for tokens that have aged out of the live 48-pair radar, so 1w/1m/1y/all boards don't go stale; prune.
async function refreshRunners() {
  const stale = db.prepare('SELECT token_addr FROM runner_tokens WHERE last_seen_at < ? ORDER BY last_seen_at ASC LIMIT 120').all(now() - 90000).map(r => r.token_addr);
  if (stale.length) {
    const mkt = await marketFor(stale);
    for (const tok of stale) {
      const m = mkt[tok]; if (!m || m.price == null) continue;
      const ex = db.prepare('SELECT peak_price FROM runner_tokens WHERE token_addr=?').get(tok); if (!ex) continue;
      const trustworthy = m.liq != null && m.liq >= RUNNER_MIN_LIQ;
      const oldPeak = ex.peak_price || 0, peak = trustworthy ? Math.max(oldPeak, m.price) : oldPeak, peakAt = peak > oldPeak ? now() : null;
      db.prepare('UPDATE runner_tokens SET first_price=COALESCE(first_price,?), cur_price=?, cur_mc=?, cur_liq=?, cur_pc24=?, peak_price=?, peak_at=COALESCE(?,peak_at), last_seen_at=? WHERE token_addr=?')
        .run(trustworthy ? m.price : null, m.price, m.mc != null ? m.mc : null, m.liq != null ? m.liq : null, m.pc24 != null ? m.pc24 : null, peak, peakAt, now(), tok);
      if (trustworthy) { const last = db.prepare('SELECT MAX(at) a FROM runner_snaps WHERE token_addr=?').get(tok).a || 0; if (now() - last >= RUNNER_SNAP_INTERVAL) db.prepare('INSERT INTO runner_snaps (token_addr, at, price) VALUES (?,?,?)').run(tok, now(), m.price); }
    }
  }
  try { db.prepare('DELETE FROM runner_snaps WHERE at < ?').run(now() - RUNNER_SNAP_MAX_AGE); } catch {}
  try { // cap the universe by keeping the most-recently-seen RUNNER_KEEP tokens
    const n = db.prepare('SELECT COUNT(*) n FROM runner_tokens').get().n;
    if (n > RUNNER_KEEP) { const cut = db.prepare('SELECT last_seen_at FROM runner_tokens ORDER BY last_seen_at DESC LIMIT 1 OFFSET ?').get(RUNNER_KEEP); if (cut) { db.prepare('DELETE FROM runner_snaps WHERE token_addr IN (SELECT token_addr FROM runner_tokens WHERE last_seen_at < ?)').run(cut.last_seen_at); db.prepare('DELETE FROM runner_tokens WHERE last_seen_at < ?').run(cut.last_seen_at); } }
  } catch {}
}
/* ===== The holders-only wall ==========================================================================
   A community has two walls: the public one anyone can read, and a private one only its VERIFIED holders
   can see. "Verified holder" is the site's existing slot (community_members.qualified = 1) — at least
   $25 of the token, read on-chain, and re-checked continuously by sweepCommunityHolders, so selling the
   token takes the wall with it. The gate lives on the SERVER, on every path that can return a post: the
   wall feed, the single-post route, comments, reactions and votes, and the Data API. A private post that
   a viewer may not read is answered 404, never 403 — a 403 would confirm the post exists. */
function canReadPrivateWall(userId, cid) {
  if (!userId || !cid) return false;
  // `qualified` means "verified holder" everywhere EXCEPT the sandbox, which hands it to anyone who taps
  // Join with no wallet and no token. A holders-only wall there would be open to the whole internet while
  // the page promised an on-chain check — so the sandbox simply has no private wall.
  return !!db.prepare(`SELECT 1 FROM community_members cm JOIN communities c ON c.id = cm.community_id
                       WHERE cm.community_id = ? AND cm.user_id = ? AND cm.qualified = 1 AND c.demo = 0`).get(cid, userId);
}
// The author always keeps sight of their own post (they wrote it, and they may still delete it) even if
// their holder slot lapses; everyone else needs a live slot in that community.
function postVisible(row, me) {
  if (!row || !row.private) return true;
  return !!(me && (me.id === row.user_id || canReadPrivateWall(me.id, row.community_id)));
}
// Continuously re-verify qualified community members STILL hold the community's token — a sell or a recycled-bag move
// revokes their qualification + the flat 10×, so holding is an ongoing requirement, not a one-time point-in-time check.
let communityHolderSweeping = false;
async function sweepCommunityHolders() {
  if (communityHolderSweeping) return; communityHolderSweeping = true;
  try {
    const rows = db.prepare("SELECT cm.community_id, cm.user_id, c.token_addr, c.c_price FROM community_members cm JOIN communities c ON c.id = cm.community_id WHERE cm.qualified = 1 AND c.status = 'live' AND c.demo = 0 ORDER BY COALESCE(cm.qual_check_at, 0) ASC LIMIT 40").all();
    for (const r of rows) {
      let holds; try { holds = await holdsToken(r.user_id, r.token_addr, MIN_COMMUNITY_HOLD_USD, r.c_price); } catch { continue; } // RPC error → skip (never revoke on a transient failure)
      const t = now();
      if (holds) { db.prepare('UPDATE community_members SET qual_check_at=? WHERE community_id=? AND user_id=?').run(t, r.community_id, r.user_id); continue; }
      try { // no longer holds → revoke qualification, the go-live count, and the 10× flag
        db.exec('BEGIN');
        db.prepare('UPDATE community_members SET qualified=0, qual_check_at=? WHERE community_id=? AND user_id=?').run(t, r.community_id, r.user_id);
        db.prepare('UPDATE communities SET qual_count = MAX(qual_count-1,0) WHERE id=?').run(r.community_id);
        db.prepare('UPDATE users SET live_comm_count = MAX(live_comm_count-1,0) WHERE id=?').run(r.user_id);
        db.exec('COMMIT');
      } catch { try { db.exec('ROLLBACK'); } catch {} }
    }
  } finally { communityHolderSweeping = false; }
}

// Rank the retained universe by gain over the requested trailing window; 24h uses the accurate Dexscreener h24, longer windows use the snapshot baseline (honestly flagged when history is shallower than the window).
function bestRunners(wkey) {
  const ms = RUNNER_WINDOWS[wkey], since = ms ? now() - ms : 0;
  const rows = db.prepare('SELECT * FROM runner_tokens WHERE cur_price > 0 AND cur_liq >= ?').all(RUNNER_MIN_LIQ); // unknown-liquidity tokens are untrusted for ranking
  const scored = [];
  for (const r of rows) {
    // "since the scanner caught it" — the first moment we recorded a price we trust for this token. first_price is
    // only written on a trustworthy sighting and the first snapshot is written in the same pass, so the earliest
    // snapshot IS that moment. (Snapshots past RUNNER_SNAP_MAX_AGE are pruned; then we fall back to the row's own
    // baseline, which is the same price.) first_seen_at is NOT used as the moment: on a token first seen with a
    // dust pool we saw it before we could price it, and dating the multiple from then would overstate the run.
    const earliest = db.prepare('SELECT price, at FROM runner_snaps WHERE token_addr=? ORDER BY at ASC LIMIT 1').get(r.token_addr);
    const caughtPrice = earliest ? earliest.price : (r.first_price || 0);
    const caughtAt = earliest ? earliest.at : r.first_seen_at;
    const sinceX = caughtPrice > 0 ? r.cur_price / caughtPrice - 1 : null;   // call convention: +100% = 1x
    let gain, baseAt, exact;
    if (wkey === '24h' && r.cur_pc24 != null) { gain = r.cur_pc24 / 100; baseAt = now() - 864e5; exact = true; }
    else {
      const snap = ms ? db.prepare('SELECT price, at FROM runner_snaps WHERE token_addr=? AND at >= ? ORDER BY at ASC LIMIT 1').get(r.token_addr, since) : null;
      const brow = snap || earliest;
      const baseline = brow ? brow.price : (r.first_price || 0);
      baseAt = brow ? brow.at : r.first_seen_at;
      if (!(baseline > 0)) continue;
      gain = r.cur_price / baseline - 1;
      // exact only when we truly have a price point at the window's start; 'all' needs real tracking depth to read as lifetime
      exact = ms ? (snap != null && baseAt <= since + RUNNER_SNAP_INTERVAL) : (!!earliest && now() - earliest.at >= RUNNER_MATURE_MS);
    }
    if (!(gain > 0)) continue;
    if (!namedToken(r.symbol, r.name)) continue;   // same rule as the radar: nothing unidentifiable on this page
    const ath = (r.peak_price > 0 && caughtPrice > 0) ? (r.peak_price / caughtPrice - 1) : null; // peak since we caught it — same baseline as sinceX, so "peak" can never read below "now"
    scored.push({ token: r.token_addr, pair: r.pair_addr, symbol: r.symbol, name: r.name, brand: runnerBrand(r.brand), mcap: r.cur_mc, liq: r.cur_liq, holders: r.cur_holders, health: r.cur_health, priceChange24: r.cur_pc24, gain, ath, sinceX, caughtAt, exact, depthDays: Math.max(0, Math.round((now() - baseAt) / 864e5)), firstSeenAt: r.first_seen_at });
  }
  scored.sort((a, b) => b.gain - a.gain); // rank by the TRUE (uncapped) gain — the liquidity floor above is the dust guard, so no display cap is needed
  return scored.slice(0, 50);
}

function userRank(userId) {
  const u = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  return db.prepare('SELECT COUNT(*)+1 r FROM users WHERE points > ?').get(u.points).r;
}
function gamifySummary(u) {
  const level = levelForXp(u.points);
  const base = xpForLevel(level);
  const nextXp = xpForLevel(level + 1); // no cap — there is always a next level
  const h = db.prepare('SELECT * FROM holder_state WHERE user_id = ?').get(u.id);
  return {
    points: u.points, level, title: titleFor(level),
    levelXp: base, nextLevelXp: nextXp,
    intoLevel: u.points - base, spanLevel: nextXp != null ? nextXp - base : null,
    rank: userRank(u.id),
    todayPoints: db.prepare('SELECT COALESCE(SUM(amount),0) t FROM points_events WHERE user_id=? AND created_at>?').get(u.id, now() - 864e5).t,
    multiplier: holderMultiplier(u.id),
    // ogBonus is derived from THIS user's tier, never a constant — the dashboard prints it verbatim,
    // so a fixed 10 here would show a silver holder a multiplier they are not being paid.
    og: u.og_tier || 0, ogTier: u.og_tier || 0, ogTierName: OG_TIER_NAME[u.og_tier || 0],
    ogBonus: OG_TIER_MULT[u.og_tier || 0] || 1,
    ogBuyMs: u.og_buy_ms || null,              // when they completed the pair — what the tier was derived from
    ogRevoked: !!u.og_revoked, // lost OG by selling out completely (can't be reclaimed)
    ogDq: !!u.og_dq,           // last clean scan found a wallet that bought in a window but failed the standard (not permanent)
    ogCampaign: ogCampaign(),                  // live windows + multipliers, so no deadline is hard-coded in the UI
    communityMult: (db.prepare('SELECT live_comm_count c FROM users WHERE id=?').get(u.id).c > 0) ? COMMUNITY_MULT : 1, // 10× while in ≥1 live community
    arcade: arcadeState(u.id),        // today's Rocket Run boost — stacks on Holder × OG × community
    weekBoost: weekBoostState(u.id),  // last week's Biggest Sender prize, if any — stacks the same way
    checkedInToday: !!db.prepare('SELECT 1 FROM points_events WHERE ref = ?').get('daily:' + u.id + ':' + ymd()),
    communities: db.prepare('SELECT c.id, c.name, c.symbol, c.token_addr, c.xp, c.status, c.demo, cm.conviction_xp FROM community_members cm JOIN communities c ON c.id = cm.community_id WHERE cm.user_id = ? AND cm.qualified = 1 ORDER BY cm.conviction_xp DESC').all(u.id).map(c => {
      const cl = commLevelInfo(c.xp), cv = commLevelInfo(c.conviction_xp);
      return { id: c.id, name: c.name, symbol: c.symbol, status: c.status, demo: !!c.demo, commLevel: cl.level, commInto: cl.intoLevel, commSpan: cl.spanLevel, conviction: { level: cv.level, title: convictionTitleFor(cv.level), into: cv.intoLevel, span: cv.spanLevel } };
    }),
    callAllowance: callAllowance(u), // dynamic daily Send Call allowance (earned limit × diamond boost, minus today's used)
    holder: h ? {
      scorePct: h.score_bp / 10000, pctSend: (h.send_bp || 0) / 10000, pctGwc: (h.gwc_bp || 0) / 10000,
      splitKnown: !!(h.send_bp || h.gwc_bp), // false only for un-refreshed pre-migration rows (per-token % not yet stored)
      sendTok: h.send_tok, gwcTok: h.gwc_tok, streakStart: h.streak_start,
      holdDays: holdDaysOf(h), gwcDays: gwcDaysOf(h), // real combined streak + the $GWC-only streak (weighted ×2 toward the level)
      fresh: !!(h.last_check && now() - h.last_check <= HOLDER_TTL),
      diamond: diamondInfo(effHoldDays(h)), // level/factor reward holding $GWC longer
    } : null,
    breakdown: db.prepare('SELECT kind, SUM(amount) total, COUNT(*) n FROM points_events WHERE user_id=? GROUP BY kind ORDER BY total DESC').all(u.id),
    // "today" achievement log (resets every 24h); the client toggles between this and the all-time breakdown
    todayBreakdown: db.prepare('SELECT kind, SUM(amount) total, COUNT(*) n FROM points_events WHERE user_id=? AND created_at>? GROUP BY kind ORDER BY total DESC').all(u.id, now() - 864e5),
    recent: db.prepare('SELECT kind, amount, created_at FROM points_events WHERE user_id=? ORDER BY id DESC LIMIT 12').all(u.id),
    perAction: PTS,
  };
}
function ymd() { const d = new Date(now()); return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate(); }
// ISO-ish UTC week key ("2026-W36") — the bucket the weekly community competition scores into
function weekKey(t) {
  const d = new Date(t == null ? now() : t);
  const th = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  th.setUTCDate(th.getUTCDate() + 4 - (th.getUTCDay() || 7));                 // Thursday of this ISO week
  const jan1 = new Date(Date.UTC(th.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((th - jan1) / 864e5 + 1) / 7);
  return th.getUTCFullYear() + '-W' + String(wk).padStart(2, '0');
}
// start (Mon 00:00 UTC) and end of the current competition week
function weekWindow(t) {
  const d = new Date(t == null ? now() : t);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() || 7) - 1));
  return { startsAt: start.getTime(), endsAt: start.getTime() + 7 * 864e5, key: weekKey(t) };
}

/* =========================================================================
   LIVE NEW-PAIRS TRACKER — reads brand-new token pairs straight from the DEX
   factory on-chain, enriches with Dexscreener market data + Blockscout holder/
   verification data, and computes honest risk flags. All reads are public and
   server-cached; the client only ever hits our own /api/pairs/new. Nothing here
   moves funds or trusts client input.
   ========================================================================= */
const BLOCKSCOUT = 'https://robinhoodchain.blockscout.com';
const FACTORY = '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f';           // UniswapV2-style factory (router.factory())
const WETH_ADDR = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const USDG_ADDR = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';         // Global Dollar stablecoin
const QUOTE_SET = new Set([WETH_ADDR, USDG_ADDR]);
const QUOTE_SYMBOL = { [WETH_ADDR]: 'WETH', [USDG_ADDR]: 'USDG' };
const PAIRCREATED_TOPIC = '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9';
// ===== OG status: bought $SEND / $GWC in the first month of launch (verified on-chain) → permanent OG badge + 10× Send Power =====
const OG_PAIR = { SEND: '0xf30bb531d0255969be155533abac34b22bd63414', GWC: '0x22df73eef683a93680dff3b51fdf3ee91e7352d9' }; // the LP pools (a buy = tokens out of the pool to you)
const OG_LAUNCH = { SEND: 1787684270000, GWC: 1787157963000 }; // on-chain pair-creation timestamps (SEND 2026-08-25, GWC 2026-08-19)
const OG_WINDOW_MS = 30 * 24 * 3600 * 1000; // "first month" — a buy within 30 days of launch earns OG
const OG_BONUS = 10;                          // OGs earn 10× Send Power on every gamified action
/* ===== OG tiers: one standard, three entry windows, twelve 30-day months ==========================
   A "month" here is 30 days — the meaning OG_WINDOW_MS has always had on this site, kept so the word
   means one thing everywhere. Windows are measured from EACH TOKEN'S OWN launch, which is how the
   gold rule has always worked (the scan takes launchMs per coin), so nobody's existing
   gold changes. $GWC launched 6 days before $SEND, so its windows sit 6 days earlier.

     gold    days   0 –  30   ×10   (unchanged: the original OG window)
     silver  days  30 –  90   ×5    (the two months after gold closes)
     bronze  days  90 – 360   ×3    (the nine months after silver closes)
     after   day  360+        ×1    no tier is granted, ever

   Your tier is the LOWER of your two coins' tiers, because the standard requires both: buying $SEND
   on day 2 and $GWC on day 100 makes you bronze, not gold. Nothing schedules this — a tier is a pure
   function of an on-chain timestamp, so the campaign advances on its own and closes on its own. */
const OG_MONTH_MS = OG_WINDOW_MS;
const OG_TIER = { GOLD: 3, SILVER: 2, BRONZE: 1, NONE: 0 };
const OG_TIER_END = { 3: 1 * OG_MONTH_MS, 2: 3 * OG_MONTH_MS, 1: 12 * OG_MONTH_MS }; // ms after launch each tier stops accepting entries
const OG_TIER_MULT = { 3: OG_BONUS, 2: 5, 1: 3, 0: 1 };
const OG_TIER_NAME = { 3: 'Gold', 2: 'Silver', 1: 'Bronze', 0: '' };
// Two different "ends", and conflating them would be wrong in both directions.
// OG_LAST_CHANCE_MS is the honest public deadline: a tier is the LOWER of your two coins' tiers, so
// once the EARLIER coin's bronze window shuts nobody can earn anything, whatever $SEND still says.
// OG_CAMPAIGN_END_MS is the internal stop-scanning guard and takes the LATER close, so the sweep can
// never cut a still-earnable window short by six days.
const OG_LAST_CHANCE_MS = Math.min(OG_LAUNCH.SEND, OG_LAUNCH.GWC) + OG_TIER_END[OG_TIER.BRONZE];
const OG_CAMPAIGN_END_MS = Math.max(OG_LAUNCH.SEND, OG_LAUNCH.GWC) + OG_TIER_END[OG_TIER.BRONZE];
// Earning and VERIFYING are separate deadlines, and conflating them would quietly punish people for
// our own outages. What you earned is decided by ogTierForBuy() from your buy timestamp, so no
// amount of late scanning can manufacture a tier — a buy after the window scores NONE forever.
// The only thing a time gate here buys is not paying the explorer forever, so verification stays
// open for a further 90 days: someone who qualified on the last day, but whose scan kept failing
// because the explorer was throttling, still gets the badge they actually earned.
const OG_VERIFY_GRACE_MS = 90 * 864e5;
const OG_GRANT_UNTIL_MS = OG_CAMPAIGN_END_MS + OG_VERIFY_GRACE_MS;
// Which tier a market acquisition at `tsMs` earns for a token launched at `launchMs`. Never consults
// now() — a tier is decided by when you bought, so re-running this years later gives the same answer.
function ogTierForBuy(tsMs, launchMs) {
  const age = tsMs - launchMs;
  if (!(age >= 0)) return OG_TIER.NONE;                 // before launch (or an unparseable stamp) earns nothing
  if (age <= OG_TIER_END[OG_TIER.GOLD]) return OG_TIER.GOLD;
  if (age <= OG_TIER_END[OG_TIER.SILVER]) return OG_TIER.SILVER;
  if (age <= OG_TIER_END[OG_TIER.BRONZE]) return OG_TIER.BRONZE;
  return OG_TIER.NONE;
}
// The live campaign clock, for the UI. Serving this is what stops the countdown drifting: the
// homepage used to hard-code the deadline epochs in HTML beside these constants.
function ogCampaign() {
  const t = now();
  const win = (tok, launch) => ({
    token: tok,
    gold: launch + OG_TIER_END[OG_TIER.GOLD],
    silver: launch + OG_TIER_END[OG_TIER.SILVER],
    bronze: launch + OG_TIER_END[OG_TIER.BRONZE],
  });
  const s = win('SEND', OG_LAUNCH.SEND);
  const g = win('GWC', OG_LAUNCH.GWC);
  return {
    open: t <= OG_LAST_CHANCE_MS,
    // the tier a buyer of BOTH coins right now would earn — the lower of the two, as the rule requires
    tierNow: Math.min(ogTierForBuy(t, OG_LAUNCH.SEND), ogTierForBuy(t, OG_LAUNCH.GWC)),
    endsAt: OG_LAST_CHANCE_MS,
    // the binding deadline per tier is the EARLIER of the two coins', because you need both
    closes: { gold: Math.min(s.gold, g.gold), silver: Math.min(s.silver, g.silver), bronze: Math.min(s.bronze, g.bronze) },
    mult: OG_TIER_MULT,
    name: OG_TIER_NAME,
    windows: { SEND: s, GWC: g },
  };
}
/* The two disqualifiers, applied identically at every tier.
   dumped         = the balance hit ~zero at some point inside the 30 days after that wallet's first
                    market acquisition of the coin — "caught dumping their whole supply in month one".
   notAccumulator = the balance today is BELOW what it was 30 days after that first acquisition —
                    net distributor since month one rather than net accumulator.
   DECIDED (2026-09-08): both are required, as the rule is written ("dumping ... AND was not a net
   accumulator") — a wallet that dumped in month one but has since bought back past its month-one level
   keeps its place. This is the standard every tier applies and every rules page describes; it is a named
   constant only so the test harness can read it, not a toggle. */
const OG_DQ_REQUIRE_BOTH = true;
const ogDisqualified = (f) => OG_DQ_REQUIRE_BOTH ? (f.dumped && f.notAccumulator) : (f.dumped || f.notAccumulator);
const OG_DUST = 1e-9;                          // treat balances at/under this (in tokens) as fully sold out (OG revocation)
const OG_DUST_WEI = 1000000000n;               // same threshold in wei (1e9 wei = 1e-9 tokens) — keeps checkOg's "holds" test consistent with refreshHolder's revocation, so a dust balance can't be granted-then-whipsaw-revoked
const MAX_LINKED_WALLETS = 5;                   // cap wallets per account: every holder refresh / balance read iterates them (bounds RPC load + sweep time)
// Must equal MAX_LINKED_WALLETS. The grant used to scan 3 wallets while revocation summed 5, and that
// gap was an exit hatch: qualify on wallets 1-3, leave dust in wallet 4, then dump 1-3 entirely — the
// revocation sum never reached zero, so the badge and its multiplier survived the sell-out it exists
// to punish. Both sides now read the same wallets. The cost is latency on a rare path, not on a hot one.
const OG_MAX_WALLETS = MAX_LINKED_WALLETS;     // cap wallets scanned per OG check (bounds latency + Blockscout load)
const PIN_MAX = 12;                            // how many tokens a user can pin to their public wall ("Convicted In")
const PAIRS_KEEP = 48;      // how many newest pairs to track/enrich
const PAIRS_TTL = 30 * 1000; // background refresh cadence (demand-driven: re-sweeps on the next request once stale)

/* Blockscout is a shared public service and it answers 429 — and sometimes 200-with-empty — when we
   ask too often. The fix is to ask less, not to disguise who is asking:
     1. identical concurrent requests share ONE upstream call (coalescing), and
     2. a short TTL cache serves repeats, so ten viewers of the same token cost one call.
   This is why the same endpoints that were rate-limiting during development now sit well inside the
   budget: the call volume dropped, rather than the limit being circumvented. */
const jgetInflight = new Map();   // url -> Promise
const jgetCache = new Map();      // url -> { at, val }
const JGET_TTL = 20 * 1000;
const JGET_MAX = 500;
function jgetCached(url, ttl) {
  const t = ttl || JGET_TTL;
  const hit = jgetCache.get(url);
  if (hit && now() - hit.at < t) return Promise.resolve(hit.val);
  const flying = jgetInflight.get(url);
  if (flying) return flying;                      // someone is already asking — wait on their answer
  const pr = jget(url).then((val) => {
    if (jgetCache.size > JGET_MAX) jgetCache.clear();
    jgetCache.set(url, { at: now(), val });
    jgetInflight.delete(url);
    return val;
  }).catch((e) => { jgetInflight.delete(url); throw e; });
  jgetInflight.set(url, pr);
  return pr;
}

/* Two different answers used to collapse into the same `null`:
     "the upstream answered, and there is nothing there"   → the token really is unlisted
     "we could not ask"  (429, 5xx, timeout, DNS, offline)  → we know NOTHING about this token
   Reading the second as the first is how the site ended up telling people a token "may have delisted or
   rugged" when the truth was that Dexscreener rate-limited us — a statement about someone's money that we
   had no evidence for. jgetR keeps them apart; jget stays as the thin wrapper for the many callers that
   genuinely only want the data. */
async function jgetR(url) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return { ok: false, data: null, reason: res.status === 429 ? 'rate-limited' : 'upstream ' + res.status };
    return { ok: true, data: await res.json(), reason: null };
  } catch (e) {
    return { ok: false, data: null, reason: (e && e.name === 'AbortError') ? 'timed out' : 'unreachable' };
  }
}
async function jget(url) { return (await jgetR(url)).data; }
/* ===== Community holder snapshots ==================================================================
   Walks Blockscout's paginated holders endpoint and freezes the full holder list at a moment in time.

   TWO MEASURED FACTS drive this design, both learned the hard way against the live explorer:
   1. items_count > 50 returns HTTP 200 with an EMPTY list and no cursor. The page size is therefore
      hardcoded at 50 and must never be exposed as a tunable — a "faster" value silently returns nothing.
   2. When rate-limited the explorer ALSO answers 200 with an empty list rather than 429. So an empty
      page is genuinely ambiguous: it can mean "end of list" or "please slow down".
   Because of (2) a snapshot can never be marked complete just because the pages ran out. Every walk is
   cross-checked against the explorer's own holder count, and anything short is stored as PARTIAL with
   the reason attached. A partial snapshot is never presented as a complete one. ======================= */
const SNAP_PAGE_SIZE = 50;        // hard limit, measured — larger silently returns an empty page
const SNAP_PAGE_TIMEOUT = 15000;
const SNAP_PAGE_TRIES = 5;        // an empty page is retried with a seconds-long backoff, never trusted
const SNAP_PAGE_GAP_MS = 220;     // politeness gap; the explorer starts returning empties under bursts
const SNAP_MAX_PAGES = 600;       // 30,000 holders ceiling
const SNAP_CHUNK = 1000;          // holders per gzipped blob
const SNAP_MIN_INTERVAL = 10 * 60 * 1000;  // per community
const snapRunning = new Set();

async function snapPage(token, cursor) {
  const qs = new URLSearchParams({ items_count: String(SNAP_PAGE_SIZE) });
  if (cursor) for (const [k, v] of Object.entries(cursor)) qs.set(k, String(v));
  const url = BLOCKSCOUT + '/api/v2/tokens/' + token + '/holders?' + qs.toString();
  let emptyBackoff = false, lastCode = 0;
  for (let attempt = 0; attempt < SNAP_PAGE_TRIES; attempt++) {
    if (attempt) {
      // An EMPTY page means throttling, and the explorer stays cross for tens of seconds, so it needs a
      // far longer wait than a network blip. Measured recovery was ~45s, hence seconds not milliseconds.
      const base = emptyBackoff ? 4000 : 400;
      await new Promise(r => setTimeout(r, base * Math.pow(2, attempt - 1) + Math.random() * 250));
    }
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), SNAP_PAGE_TIMEOUT);
      const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, accept: 'application/json' }, signal: ctrl.signal });
      clearTimeout(to);
      // The explorer throttles in two different shapes: a hard 429, and a soft "200 with an empty list".
      // Both mean slow down, and both are retried with the long backoff rather than believed.
      if (res.status === 429) { emptyBackoff = true; lastCode = 429; continue; }
      if (!res.ok) { lastCode = res.status; continue; }
      const j = await res.json();
      const items = Array.isArray(j.items) ? j.items : [];
      // An empty page is ambiguous (end-of-list vs throttled), so retry it. Only an empty page that
      // survives every retry is treated as the end, and even then the count check has the final say.
      if (!items.length && attempt < SNAP_PAGE_TRIES - 1) { emptyBackoff = true; continue; }
      return { items, next: j.next_page_params || null };
    } catch { /* timeout or network — fall through to the next attempt */ }
  }
  return { failed: true, code: lastCode }; // never treated as end-of-list
}

async function runSnapshot(snapId, cid, token) {
  const seen = new Map();           // address -> raw value string (dedupe: paging can repeat a row)
  let cursor = null, pages = 0, failedAt = null, failCode = 0;
  try {
    for (; pages < SNAP_MAX_PAGES; pages++) {
      const page = await snapPage(token, cursor);
      if (!page || page.failed) { failedAt = pages; failCode = (page && page.code) || 0; break; }
      for (const it of page.items) {
        const a = it && it.address && it.address.hash ? String(it.address.hash).toLowerCase() : null;
        if (a && !seen.has(a)) seen.set(a, String(it.value || '0'));
      }
      if (!page.next || !page.items.length) { cursor = null; break; }
      cursor = page.next;
      await new Promise(r => setTimeout(r, SNAP_PAGE_GAP_MS));
    }
  } catch { failedAt = pages; }

  // The explorer's own count is the yardstick — without it we cannot claim completeness. It comes from
  // the token metadata endpoint, which also carries decimals, symbol and total supply in the same call.
  // (/counters answers "Internal server error" on this chain, so it is deliberately not used.)
  let meta = null;
  try { meta = await jgetCached(BLOCKSCOUT + '/api/v2/tokens/' + token); } catch {}
  const expected = (meta && meta.holders_count != null && Number(meta.holders_count) > 0) ? Number(meta.holders_count) : null;

  const holders = [...seen.entries()].sort((a, b) => (BigInt(b[1]) > BigInt(a[1]) ? 1 : BigInt(b[1]) < BigInt(a[1]) ? -1 : 0));
  let held = 0n; for (const [, v] of holders) { try { held += BigInt(v); } catch {} }

  let status = 'complete', reason = null;
  if (failedAt != null) {
    status = 'partial';
    reason = failCode === 429
      ? 'The public block explorer is rate-limiting us right now, so the holder list could not be read in full. Try again in a few minutes.'
      : 'The chain data source stopped responding part-way through, at page ' + (failedAt + 1) + '.';
  }
  else if (pages >= SNAP_MAX_PAGES)          { status = 'partial'; reason = 'This token has more holders than one snapshot stores (' + (SNAP_MAX_PAGES * SNAP_PAGE_SIZE).toLocaleString('en-US') + ').'; }
  else if (!holders.length)                  { status = 'failed';  reason = 'No holders could be read from the chain data source.'; }
  else if (expected != null && holders.length < Math.floor(expected * 0.98)) {
    status = 'partial'; reason = 'The explorer reports ' + expected.toLocaleString('en-US') + ' holders but only ' + holders.length.toLocaleString('en-US') + ' could be read.';
  }

  try {
    db.exec('BEGIN');
    let chunks = 0;
    for (let i = 0; i < holders.length; i += SNAP_CHUNK) {
      const slice = holders.slice(i, i + SNAP_CHUNK);
      db.prepare('INSERT INTO holder_snapshot_chunks (snapshot_id, chunk, n, blob) VALUES (?,?,?,?)')
        .run(snapId, chunks, slice.length, zlib.gzipSync(Buffer.from(JSON.stringify(slice))));
      chunks++;
    }
    db.prepare(`UPDATE holder_snapshots SET status=?, reason=?, finished_at=?, symbol=?, decimals=?, total_supply=?,
                supply_held=?, holder_count=?, expected_count=?, pages=?, top20=? WHERE id=?`)
      .run(status, reason, now(),
           (meta && meta.symbol) || null,
           meta && meta.decimals != null ? Number(meta.decimals) : 18,
           (meta && meta.total_supply) ? String(meta.total_supply) : null,
           held.toString(), holders.length, expected, pages,
           JSON.stringify(holders.slice(0, 20)), snapId);
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch {}
    try { db.prepare("UPDATE holder_snapshots SET status='failed', reason=?, finished_at=? WHERE id=?").run('Could not store the snapshot.', now(), snapId); } catch {} }
  snapRunning.delete(cid);
}

function snapshotView(s, withHolders, offset, limit) {
  const out = {
    id: s.id, communityId: s.community_id, token: s.token_addr, status: s.status, reason: s.reason,
    startedAt: s.started_at, finishedAt: s.finished_at, symbol: s.symbol, decimals: s.decimals,
    totalSupply: s.total_supply, supplyHeld: s.supply_held, holderCount: s.holder_count,
    expectedCount: s.expected_count, pages: s.pages,
    complete: s.status === 'complete',
    top20: s.top20 ? JSON.parse(s.top20) : [],
  };
  if (!withHolders) return out;
  const rows = db.prepare('SELECT chunk, n, blob FROM holder_snapshot_chunks WHERE snapshot_id=? ORDER BY chunk').all(s.id);
  let all = [];
  for (const r of rows) { try { all = all.concat(JSON.parse(zlib.gunzipSync(r.blob).toString('utf8'))); } catch {} }
  out.holders = all.slice(offset, offset + limit).map((h, i) => ({ rank: offset + i + 1, address: h[0], value: h[1] }));
  out.offset = offset; out.limit = limit; out.total = all.length;
  return out;
}

async function jgetH(url, headers) { // jget with custom headers (for the optional Dextools API key)
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, accept: 'application/json', ...headers }, signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/* ===== Send Call SIZE: read on-chain how much $ a user genuinely put into a token =====
   We credit the live USD value of tokens they BOUGHT from the pool AND STILL HOLD: min(boughtFromPool, heldNow) × price.
   The min() is the anti-cheat: it defeats msg.value spoofing (a router-refund tx shows a huge tx.value but delivers ~no
   tokens → bought≈0), wash-buys / recycled buys (sold back → held≈0), self-pool paper value (must hold real tokens at the
   live aggregated price), seasoned-then-dumped wallets, and airdrops/transfers-in (not counted — only pool buys). You have
   to actually still be holding what you claim to have sent. Best-effort + fail-open to 0 so it never blocks a call. */
const SIZE_MULT_CAP = 100;               // cap the size boost at 100× ($10k+ still held) so one whale call can't mint unbounded points
const SIZE_MAX_WALLETS = 3;              // cap wallets scanned per call
function sizeMult(spendUsd) { return Math.min(SIZE_MULT_CAP, Math.max(1, (spendUsd || 0) / 100)); } // each $100 held-from-buys = 1×, floor 1×
// full on-chain position: what they BOUGHT from the pool, what they still HOLD, and spend = min(both) (the anti-cheat basis).
async function walletTokenPosition(userId, tokenAddr, pairAddr, priceUsd) {
  const addrs = walletAddresses(userId);
  if (!addrs.length || !pairAddr || !(priceUsd > 0)) return { boughtUsd: 0, heldUsd: 0, spendUsd: 0 };
  const pair = pairAddr.toLowerCase();
  let boughtTok = 0, heldTok = 0, spendTok = 0;
  for (const a of addrs.slice(0, SIZE_MAX_WALLETS)) {
    try {
      const me = a.toLowerCase();
      const j = await jget(BLOCKSCOUT + '/api/v2/addresses/' + a + '/token-transfers?token=' + tokenAddr);
      const items = (j && j.items) || [];
      let boughtRaw = 0n, dec = 18;
      for (const it of items) {
        if (it.token && it.token.decimals != null) dec = Number(it.token.decimals) || 18;
        const from = ((it.from && it.from.hash) || '').toLowerCase();
        const to = ((it.to && it.to.hash) || '').toLowerCase();
        if (to === me && from === pair) { try { boughtRaw += BigInt((it.total && it.total.value) || '0'); } catch {} } // token amount received in a buy
      }
      let heldRaw = 0n; try { heldRaw = await erc20Balance(tokenAddr, a); } catch {}
      const div = Math.pow(10, dec);
      boughtTok += Number(boughtRaw) / div;
      heldTok += Number(heldRaw) / div;
      spendTok += Number(boughtRaw < heldRaw ? boughtRaw : heldRaw) / div; // bought AND still held
    } catch {}
  }
  return { boughtUsd: boughtTok * priceUsd, heldUsd: heldTok * priceUsd, spendUsd: spendTok * priceUsd };
}
// USD they bought & still hold (the size-multiplier basis) — thin wrapper so the size feature is unchanged
async function callSpendUsd(userId, tokenAddr, pairAddr, priceUsd) {
  return (await walletTokenPosition(userId, tokenAddr, pairAddr, priceUsd)).spendUsd;
}

/* ===== Honeypot & contract read =====
   Fetch the VERIFIED Solidity source and heuristically flag owner powers that can trap or dump on holders
   (mint, blacklist, trading toggle, tax changes, max limits, pause), plus check if the LP is burned/locked.
   Best-effort — a pattern scan, NOT an audit and NOT a buy/sell simulation. */
const CONTRACT_TTL = 30 * 60 * 1000; // verified/renounced contracts rarely change
const _contractCache = new Map();
const CONTRACT_CHECKS = [
  { key: 'blacklist', sev: 'critical', re: /blacklist|blocklist|denylist|_isBlackListed|isBlacklisted|setBots|_bots\b|isBot\b|excludeFromTrading|_isSniper/i, can: 'Blacklist / block wallets', why: 'wallets can be blocked from selling — a classic honeypot' },
  { key: 'trading', sev: 'high', re: /enableTrading|openTrading|tradingOpen|tradingActive|tradingEnabled\b|swapEnabled\b|setTradingEnabled|canTrade\b|startTrading|tradingStarted/i, can: 'Turn trading on/off', why: 'selling can be switched off at will' },
  { key: 'fees', sev: 'high', re: /function\s+set(?:Fee|Fees|Tax|Taxes|BuyFee|SellFee|BuyTax|SellTax|SwapFee|Rate)s?\b|updateFees?\b|setTaxes\b/i, can: 'Change the buy/sell tax', why: 'the sell tax can be raised toward 100%, trapping sellers' },
  { key: 'mint', sev: 'high', re: /function\s+mint\b|function\s+_?createTokens|function\s+_?mintTo\b/i, can: 'Mint new tokens', why: 'the supply can be inflated and dumped on holders' },
  { key: 'maxlimits', sev: 'medium', re: /maxTx|maxTransaction|maxWallet|maxSell|_maxTxAmount|maxBuyAmount|maxHolding/i, can: 'Cap max buy / sell / wallet', why: 'transfer sizes can be limited, which can also block selling' },
  { key: 'pausable', sev: 'high', re: /whenNotPaused|function\s+pause\b|_pause\s*\(|\bis\s+[A-Za-z, ]*Pausable/i, can: 'Pause all transfers', why: 'every transfer (including sells) can be frozen' },
];
function scanContractSource(src) {
  const hits = [];
  for (const c of CONTRACT_CHECKS) if (c.re.test(src)) hits.push({ key: c.key, sev: c.sev, can: c.can, why: c.why });
  return hits;
}
async function checkLpLock(pairAddr) {
  if (!pairAddr) return { known: false };
  try {
    const lpTok = await jget(BLOCKSCOUT + '/api/v2/tokens/' + pairAddr);
    const supplyRaw = lpTok && lpTok.total_supply ? BigInt(lpTok.total_supply) : 0n;
    if (supplyRaw <= 0n) return { known: false };
    const h = await jget(BLOCKSCOUT + '/api/v2/tokens/' + pairAddr + '/holders?items_count=15');
    const items = (h && h.items) || [];
    const BURN = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);
    let lockedRaw = 0n;
    for (const it of items) {
      const addr = ((it.address && it.address.hash) || '').toLowerCase();
      const name = (it.address && it.address.name) || '';
      const val = it.value ? BigInt(it.value) : 0n;
      if (BURN.has(addr) || /lock|vault|unicrypt|pinksale|team\.?finance|dead/i.test(name)) lockedRaw += val;
    }
    const pct = Number(lockedRaw) / Number(supplyRaw) * 100;
    return { known: true, lockedPct: pct, locked: pct >= 50 };
  } catch { return { known: false }; }
}
function contractSummaryOf(o) {
  if (o.verified === false) return 'The contract source is NOT verified on the explorer — no one can read what it actually does. That is itself a red flag; treat it as high-risk.';
  if (o.verified == null) return 'Couldn’t read the contract source right now.';
  if (!o.powers.length) return 'Heuristic read of the verified source: no obvious owner powers to mint, blacklist, pause, toggle trading, or change taxes were found — the usual honeypot/rug levers weren’t detected. Still DYOR; a scan isn’t an audit.';
  return 'Heuristic read of the verified source — the owner’s code appears able to ' + o.powers.map(p => p.can.toLowerCase()).join(', ') + '. Each is a lever that can trap sellers or dump on holders.';
}
async function analyzeContract(tokenAddr, pairAddr) {
  const key = tokenAddr.toLowerCase();
  const cached = _contractCache.get(key);
  if (cached && now() - cached.t < CONTRACT_TTL) return cached.v;
  const out = { verified: null, name: null, powers: [], liquidity: { known: false }, summary: '' };
  try {
    const sc = await jget(BLOCKSCOUT + '/api/v2/smart-contracts/' + tokenAddr);
    if (sc) { out.verified = !!sc.is_verified; out.name = String(sc.name || '').slice(0, 60); const src = String(sc.source_code || ''); if (out.verified && src) out.powers = scanContractSource(src); }
  } catch {}
  out.liquidity = await checkLpLock(pairAddr);
  out.summary = contractSummaryOf(out);
  _contractCache.set(key, { t: now(), v: out });
  return out;
}

/* ---- Token branding (Dexscreener "Enhanced Token Info" the team paid to add: logo, banner, socials, links) ---- */
function dexCdnImg(u) { // only trust Dexscreener's own CDN so the client CSP img-src stays tight
  return (typeof u === 'string' && /^https:\/\/(cdn|dd)\.dexscreener\.com\//.test(u) && !/["'<>\s]/.test(u)) ? u.slice(0, 400) : null; // no quote/bracket/space chars → can't break out of an attribute even before esc()
}
function safeHttpUrl(u) { // http(s) only — never javascript:/data: — capped length
  if (typeof u !== 'string') return null;
  const s = u.trim();
  return /^https?:\/\/[^\s]+$/i.test(s) ? s.slice(0, 300) : null;
}
function brandLinks(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const w of arr) { const url = safeHttpUrl(w && w.url); if (url) out.push({ url, label: String((w && w.label) || 'Website').slice(0, 24) }); if (out.length >= 4) break; }
  return out;
}
const SOCIAL_TYPES = new Set(['twitter', 'x', 'telegram', 'discord', 'website', 'github', 'medium', 'reddit', 'instagram', 'tiktok', 'youtube', 'facebook']);
function brandSocials(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [], seen = new Set();
  for (const s of arr) {
    const url = safeHttpUrl(s && s.url); if (!url) continue;
    let type = String((s && (s.type || s.platform)) || 'link').toLowerCase().slice(0, 16);
    if (!SOCIAL_TYPES.has(type)) type = 'link';
    const key = type + '|' + url;
    if (seen.has(key)) continue; seen.add(key);
    out.push({ type, url });
    if (out.length >= 6) break;
  }
  return out;
}
function brandFromDex(dex) {
  const info = dex && dex.info;
  const imageUrl = dexCdnImg(info && info.imageUrl);
  const header = dexCdnImg(info && info.header);
  const websites = brandLinks(info && info.websites);
  const socials = brandSocials(info && info.socials);
  return {
    // enhanced reflects what's actually DISPLAYABLE after sanitizing (not raw info presence) so the "has info" badge
    // never shows for a token whose only info was an off-CDN image or a non-http link → badge and detail stay in sync.
    enhanced: !!(imageUrl || header || websites.length || socials.length),
    boosted: (dex && dex.boosts && Number(dex.boosts.active)) || 0,
    imageUrl, header, websites, socials,
    dextools: null, // filled only when DEXTOOLS is configured (see dextoolsInfo)
  };
}
// Re-sanitize a client-supplied watchlist snapshot before we store it (its brand/links are untrusted input,
// and the watchlist renders links as hrefs). Keeps stored data safe even against a hand-crafted POST.
function sanitizeBrand(b) {
  if (!b || typeof b !== 'object') return null;
  const imageUrl = dexCdnImg(b.imageUrl), header = dexCdnImg(b.header);
  const websites = brandLinks(b.websites), socials = brandSocials(b.socials);
  return { enhanced: !!(imageUrl || header || websites.length || socials.length), boosted: Number(b.boosted) > 0 ? Math.min(9999, Math.floor(Number(b.boosted))) : 0, imageUrl, header, websites, socials, dextools: null };
}
function sanitizeSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return snap;
  if ('brand' in snap) snap.brand = sanitizeBrand(snap.brand);
  if (snap.links && typeof snap.links === 'object') snap.links = { dex: safeHttpUrl(snap.links.dex) || null, explorer: safeHttpUrl(snap.links.explorer) || null };
  return snap;
}

/* ---- Dextools status (OPT-IN, env-gated). Dexscreener does not expose Dextools data and Robinhood Chain may
   not be listed on Dextools, so this stays null unless DEXTOOLS_API_KEY + DEXTOOLS_CHAIN are set. It's wired,
   cached, and defensive so it activates cleanly when configured, and never touches the network otherwise. ---- */
const DEXTOOLS_KEY = process.env.DEXTOOLS_API_KEY || '';
const DEXTOOLS_CHAIN = process.env.DEXTOOLS_CHAIN || '';   // the Dextools chain slug for Robinhood Chain, once known
const DEXTOOLS_ON = !!(DEXTOOLS_KEY && DEXTOOLS_CHAIN);
const dextoolsCache = new Map(); // token -> { at, res }
async function dextoolsInfo(tokenAddr) {
  if (!DEXTOOLS_ON) return null;
  tokenAddr = String(tokenAddr).toLowerCase();
  const c = dextoolsCache.get(tokenAddr); if (c && now() - c.at < 600000) return c.res; // 10-min cache (incl. failures)
  let res = null;
  const j = await jgetH('https://public-api.dextools.io/trial/v2/token/' + DEXTOOLS_CHAIN + '/' + tokenAddr, { 'X-API-KEY': DEXTOOLS_KEY });
  if (j && j.data) {
    const d = j.data, social = d.socialInfo || {};
    const hasSocial = Object.values(social).some(v => v && String(v).trim());
    res = { listed: true, updated: !!(d.logo || hasSocial), url: 'https://www.dextools.io/app/en/' + DEXTOOLS_CHAIN + '/pair-explorer/' + tokenAddr };
  } else if (j) { res = { listed: false, updated: false }; } // reached the API, token not listed
  // (network/parse failure → res stays null = "unknown", never fabricated)
  dextoolsCache.set(tokenAddr, { at: now(), res });
  if (dextoolsCache.size > 500) { const k = dextoolsCache.keys().next().value; dextoolsCache.delete(k); }
  return res;
}
async function mapLimit(arr, limit, fn) {
  const out = new Array(arr.length); let i = 0;
  const worker = async () => { while (i < arr.length) { const idx = i++; try { out[idx] = await fn(arr[idx], idx); } catch { out[idx] = null; } } };
  await Promise.all(Array.from({ length: Math.min(limit, arr.length || 1) }, worker));
  return out;
}
async function getLogsChunked(address, topic, from, to) {
  try {
    return await rpc('eth_getLogs', [{ fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), address, topics: [topic] }]);
  } catch (e) {
    if (to - from < 40000) throw e;               // small range still failing → bubble up
    const mid = Math.floor((from + to) / 2);
    const [a, b] = [await getLogsChunked(address, topic, from, mid), await getLogsChunked(address, topic, mid + 1, to)];
    return a.concat(b);
  }
}
const blockTsCache = new Map();
async function blockTimestamp(bn) {
  if (blockTsCache.has(bn)) return blockTsCache.get(bn);
  const b = await rpc('eth_getBlockByNumber', ['0x' + bn.toString(16), false]).catch(() => null);
  const ts = b ? parseInt(b.timestamp, 16) * 1000 : 0;
  blockTsCache.set(bn, ts);
  return ts;
}

let pairsRaw = [];          // [{pair, token0, token1, block}] newest last
let pairsScanBlock = 0;
let pairsCache = { pairs: [], updatedAt: 0, building: false, error: null };
// A pair whose name and symbol never resolved on-chain shows up as "Unknown Token $???" — a row a reader can do
// nothing with. It STAYS in pairsCache (the serial-deployer window and the runners store still need to see it),
// but it is withheld from everything the New Pairs page renders.
const namedToken = (sym, name) => !!(sym && sym !== '???' && name && name !== 'Unknown Token');
const identifiedPair = (p) => !!(p && p.token && namedToken(p.token.symbol, p.token.name));
let pairsRefreshing = false;

async function scanNewPairs() {
  const latest = parseInt(await rpc('eth_blockNumber', []), 16);
  const from = pairsScanBlock ? pairsScanBlock + 1 : Math.max(0, latest - 2500000);
  if (from > latest) return;
  const logs = await getLogsChunked(FACTORY, PAIRCREATED_TOPIC, from, latest);
  for (const l of logs) {
    if (!l.data || !l.topics || l.topics.length < 3) continue;
    pairsRaw.push({
      pair: '0x' + l.data.slice(26, 66),   // PairCreated data = (address pair, uint allPairsLength)
      token0: '0x' + l.topics[1].slice(26),
      token1: '0x' + l.topics[2].slice(26),
      block: parseInt(l.blockNumber, 16),
    });
  }
  pairsScanBlock = latest;
  // de-dupe by pair, keep the newest PAIRS_KEEP
  const seen = new Set(); const dedup = [];
  pairsRaw.sort((a, b) => a.block - b.block);
  for (let i = pairsRaw.length - 1; i >= 0; i--) { const p = pairsRaw[i]; if (p.pair && !seen.has(p.pair)) { seen.add(p.pair); dedup.push(p); } }
  pairsRaw = dedup.reverse().slice(-Math.max(PAIRS_KEEP, 120));
}

/* ===== On-chain price charts ==========================================================
   Charts are built from the pair contract's own Swap events rather than from a third-party chart
   service. That is not a workaround — it is the better source: Dexscreener and every other
   aggregator DERIVE their candles from these same logs, so reading them directly removes a
   dependency, removes a rate limit, and removes a step where the number can drift.

   Robinhood Chain runs ~0.1s blocks, and a 6M-block eth_getLogs (about a week) returns in well
   under a second, so the whole history we care about is one request.

   USD anchoring needs exactly ONE external number for the entire site: ETH/USD. Everything else is
   a ratio we compute from chain data. That call is cached for a minute and shared across every
   token, instead of one third-party lookup per token per view.

   NOT DONE, deliberately: no scraping of DexTools / CoinMarketCap / CoinGecko web pages, and no
   rotating identities to slip past a rate limit. Both breach those services' terms and would get
   the site blocked; the on-chain path above is both legitimate and more accurate. CoinGecko's
   documented free price endpoint is used as the USD anchor, which is what it is published for. */
const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'; // Swap(address,uint,uint,uint,uint,address)
const SYNC_TOPIC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1'; // Sync(uint112,uint112)
const CHART_TF = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
const chartCache = new Map();          // `${pair}:${tf}` -> { at, data }
const CHART_TTL = 30 * 1000;
let ethUsdCache = { at: 0, usd: 0 };

async function ethUsd() {
  if (ethUsdCache.usd && now() - ethUsdCache.at < 60000) return ethUsdCache.usd;
  const j = await jget('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
  const v = j && j.ethereum && Number(j.ethereum.usd);
  if (v > 0) ethUsdCache = { at: now(), usd: v };
  return ethUsdCache.usd || 0;   // 0 means "unknown"; the client shows native units rather than a wrong dollar figure
}

const hexToBig = (h) => { try { return BigInt('0x' + h); } catch { return 0n; } };

/* Decode one Swap log into a price in QUOTE units per TOKEN unit.
   data = amount0In, amount1In, amount0Out, amount1Out (4 x uint256, 32 bytes each). */
function swapPrice(log, tokenIsZero, decToken, decQuote) {
  const d = String(log.data || '').replace(/^0x/, '');
  if (d.length < 256) return null;
  const a0In = hexToBig(d.slice(0, 64)), a1In = hexToBig(d.slice(64, 128));
  const a0Out = hexToBig(d.slice(128, 192)), a1Out = hexToBig(d.slice(192, 256));
  const tokIn = tokenIsZero ? a0In : a1In, tokOut = tokenIsZero ? a0Out : a1Out;
  const quoIn = tokenIsZero ? a1In : a0In, quoOut = tokenIsZero ? a1Out : a0Out;
  const tokAmt = tokIn > 0n ? tokIn : tokOut;
  const quoAmt = tokIn > 0n ? quoOut : quoIn;
  if (tokAmt === 0n || quoAmt === 0n) return null;
  // scale to floats only at the end, after the integer maths, so precision survives 18 decimals
  const t = Number(tokAmt) / Math.pow(10, decToken);
  const q = Number(quoAmt) / Math.pow(10, decQuote);
  if (!(t > 0) || !(q > 0)) return null;
  return q / t;
}

/* Spot price for the live line. This is what a 1-second poll hits, so it has to be genuinely cheap:
   ONE eth_call for getReserves, and price = quoteReserve / tokenReserve adjusted for decimals.
   Coalesced and cached for 900ms, so a hundred viewers of the same pair cost the chain one call per
   second, not a hundred. The chain runs ~0.1s blocks, so a 1s cadence is a real refresh rather than
   a spinning wheel showing the same number. */
const spotCache = new Map();      // pair -> { at, val }
const spotInflight = new Map();
const SPOT_TTL = 900;
const SPOT_BATCH_MAX = 40;        // pairs answered in one /api/spot read — more than fit on any screen
const pairQuoteCache = new Map(); // pair -> quote token address; a pool's two sides never change
/* Which side of the pool is the money side. Needed because spotPrice returns a price DENOMINATED IN THE QUOTE
   ASSET, while every price this site stores and compares against — a Send Call's entry, a market cap — is in
   USD. Dividing one by the other silently produces a number thousands of times wrong, which is exactly the
   sort of figure this site must never put in front of anyone. */
async function pairQuote(pairAddr, tokenAddr) {
  const k = lcAddr(pairAddr);
  if (pairQuoteCache.has(k)) return pairQuoteCache.get(k);
  const { token0, token1 } = await pairTokens(pairAddr);
  if (!token0 || !token1) return null;
  const q = lcAddr(token0) === lcAddr(tokenAddr) ? lcAddr(token1) : lcAddr(token0);
  pairQuoteCache.set(k, q);
  return q;
}
/* The live spot price in USD, or null. Null when the pool is unreadable OR when its quote asset is one we
   cannot price — an unknown quote is reported as unknown rather than passed off as dollars. */
async function spotPriceUsd(pairAddr, tokenAddr) {
  const p = await spotPrice(pairAddr, tokenAddr);
  if (p == null) return null;
  const q = await pairQuote(pairAddr, tokenAddr);
  if (q === WETH_ADDR) { const e = await ethUsd(); return e > 0 ? p * e : null; }
  if (q === USDG_ADDR) return p;               // a dollar stablecoin quote is already in dollars
  return null;
}
async function spotPrice(pairAddr, tokenAddr) {
  const key = pairAddr + ':' + tokenAddr;
  const hit = spotCache.get(key);
  if (hit && now() - hit.at < SPOT_TTL) return hit.val;
  const flying = spotInflight.get(key);
  if (flying) return flying;
  const pr = (async () => {
    const [res, t0, decT] = await Promise.all([
      getReserves(pairAddr),
      ethCall(pairAddr, '0x0dfe1681'),        // token0()
      tokenDecimals(tokenAddr),
    ]);
    if (!res) return null;
    const token0 = t0 ? '0x' + String(t0).slice(-40).toLowerCase() : null;
    const tokenIsZero = token0 === String(tokenAddr).toLowerCase();
    const tokRes = tokenIsZero ? res.r0 : res.r1;
    const quoRes = tokenIsZero ? res.r1 : res.r0;
    if (tokRes === 0n) return null;
    const dT = decT != null ? decT : 18;
    const t = Number(tokRes) / Math.pow(10, dT);
    const q = Number(quoRes) / Math.pow(10, 18);   // WETH/USDG legs are 18 on this chain's pairs
    if (!(t > 0) || !(q > 0)) return null;
    return q / t;
  })().then((val) => {
    if (val != null) spotCache.set(key, { at: now(), val });   // never cache a failure
    spotInflight.delete(key);
    return val;
  }).catch((e) => { spotInflight.delete(key); throw e; });
  spotInflight.set(key, pr);
  return pr;
}

async function buildCandles(pairAddr, tokenAddr, tfKey, hours) {
  const tf = CHART_TF[tfKey] || 3600;
  const key = pairAddr + ':' + tfKey;
  const hit = chartCache.get(key);
  if (hit && now() - hit.at < CHART_TTL) return hit.data;

  const headHex = await rpc('eth_blockNumber', []);
  const head = parseInt(headHex, 16);
  if (!head) return null;
  const BLOCKS_PER_SEC = 10;                      // ~0.1s blocks, measured
  const span = Math.min(head, Math.round(hours * 3600 * BLOCKS_PER_SEC));
  const fromBlock = '0x' + Math.max(0, head - span).toString(16);

  const [logs, t0, t1, decT] = await Promise.all([
    rpc('eth_getLogs', [{ address: pairAddr, topics: [SWAP_TOPIC], fromBlock, toBlock: 'latest' }]),
    ethCall(pairAddr, '0x0dfe1681'),              // token0()
    ethCall(pairAddr, '0xd21220a7'),              // token1()
    tokenDecimals(tokenAddr),
  ]);
  if (!Array.isArray(logs)) return null;
  const token0 = t0 ? '0x' + String(t0).slice(-40).toLowerCase() : null;
  const tokenIsZero = token0 === String(tokenAddr).toLowerCase();
  const decToken = decT != null ? decT : 18;
  const decQuote = 18;                            // WETH/USDG legs are both 18 on this chain's pairs

  // block -> timestamp: sample sparsely and interpolate, rather than one call per log
  const blocks = [...new Set(logs.map(l => parseInt(l.blockNumber, 16)))].sort((a, b) => a - b);
  const marks = [];
  const step = Math.max(1, Math.floor(blocks.length / 12));
  for (let i = 0; i < blocks.length; i += step) marks.push(blocks[i]);
  if (blocks.length && marks[marks.length - 1] !== blocks[blocks.length - 1]) marks.push(blocks[blocks.length - 1]);
  const stamps = new Map();
  await Promise.all(marks.map(async (b) => {
    const blk = await rpc('eth_getBlockByNumber', ['0x' + b.toString(16), false]).catch(() => null);
    if (blk && blk.timestamp) stamps.set(b, parseInt(blk.timestamp, 16) * 1000);
  }));
  const known = [...stamps.entries()].sort((a, b) => a[0] - b[0]);
  // If NONE of the timestamp probes resolved we cannot place a single swap in time. Falling back to
  // "now" would silently pile every trade into one candle and render a confident-looking chart that
  // is entirely wrong — worse than no chart. Say so instead.
  if (logs.length && !known.length) {
    return { pair: pairAddr, token: tokenAddr, tf: tfKey, quote: 'ETH', ethUsd: await ethUsd(),
             candles: [], swaps: logs.length, source: 'on-chain Swap events',
             note: 'Found ' + logs.length + ' swaps but could not read block times from the chain just now, so they cannot be placed on a timeline. Try again in a moment.' };
  }
  const tsFor = (b) => {
    if (!known.length) return now();
    if (b <= known[0][0]) return known[0][1] - (known[0][0] - b) * 100;
    for (let i = 1; i < known.length; i++) {
      if (b <= known[i][0]) {
        const [b0, t0v] = known[i - 1], [b1, t1v] = known[i];
        return b1 === b0 ? t1v : t0v + (t1v - t0v) * ((b - b0) / (b1 - b0));
      }
    }
    const last = known[known.length - 1];
    return last[1] + (b - last[0]) * 100;
  };

  const buckets = new Map();
  for (const l of logs) {
    const px = swapPrice(l, tokenIsZero, decToken, decQuote);
    if (!px) continue;
    const ts = tsFor(parseInt(l.blockNumber, 16));
    const b = Math.floor(ts / 1000 / tf) * tf;
    const c = buckets.get(b);
    if (!c) buckets.set(b, { t: b, o: px, h: px, l: px, c: px, n: 1 });
    else { c.h = Math.max(c.h, px); c.l = Math.min(c.l, px); c.c = px; c.n++; }
  }
  const candles = [...buckets.values()].sort((a, b) => a.t - b.t);
  const usd = await ethUsd();
  const data = {
    pair: pairAddr, token: tokenAddr, tf: tfKey, quote: 'ETH',
    ethUsd: usd || null,
    candles,
    swaps: logs.length,
    source: 'on-chain Swap events',
    // Say plainly when there is nothing to draw, rather than rendering an empty chart that looks broken.
    note: candles.length ? null : 'No swaps on this pair in the window, so there is nothing to chart yet.',
  };
  chartCache.set(key, { at: now(), data });
  return data;
}

/* ===== Multi-chain New Pairs ==========================================================
   Robinhood Chain is the HOME chain and the only one we analyse deeply: we read PairCreated logs
   from its factory over its own RPC, and Blockscout gives us holder counts, contract verification
   and deployer history. None of that exists for other chains here.

   So other chains are supported at the level the data actually supports: Dexscreener gives price,
   liquidity, volume, transaction counts and pair age for every chain it indexes, and those drive
   the checks that only need market data. The checks that need an explorer simply cannot run, and
   are recorded as UNREADABLE rather than as "passed" — which is what dataKnown/thinData already
   express, so a foreign-chain token can never wear the top verdict on data we never had.
   That is the honest shape of multi-chain here, and the UI says so. ====================== */
const CHAINS = [
  { slug: 'robinhood', name: 'Robinhood Chain', emoji: '🏹', deep: true },
  { slug: 'solana',    name: 'Solana',          emoji: '◎',  deep: false },
  { slug: 'base',      name: 'Base',            emoji: '🔵', deep: false },
  { slug: 'ethereum',  name: 'Ethereum',        emoji: 'Ξ',  deep: false },
  { slug: 'bsc',       name: 'BNB Chain',       emoji: '🟡', deep: false },
  { slug: 'arbitrum',  name: 'Arbitrum',        emoji: '🔷', deep: false },
];
const CHAIN_BY_SLUG = Object.fromEntries(CHAINS.map(c => [c.slug, c]));
// Only Robinhood Chain is surfaced. The other-chain pipeline stays built and working behind this
// flag — set MULTICHAIN=1 to advertise them again — because the data there is market-only and the
// home chain is the one this site is actually about.
const DEFAULT_CHAIN = 'robinhood';
const MULTICHAIN = process.env.MULTICHAIN === '1';
const PUBLIC_CHAINS = MULTICHAIN ? CHAINS : CHAINS.filter(c => c.slug === DEFAULT_CHAIN);
const FOREIGN_TTL = 90 * 1000;
const foreignCache = new Map();   // slug -> { pairs, updatedAt, building, error }

// Map a Dexscreener pair onto the same shape the radar already renders, so every downstream
// consumer (risk, sorting, the card, the detail body) works unchanged.
function pairFromDex(d, slug) {
  const bt = d.baseToken || {}, qt = d.quoteToken || {};
  const liq = d.liquidity && d.liquidity.usd != null ? Number(d.liquidity.usd) : null;
  const createdAt = d.pairCreatedAt || 0;
  const txns = d.txns || {}, vol = d.volume || {}, pc = d.priceChange || {};
  const n = (x) => { const v = Number(x); return isFinite(v) ? v : 0; };
  const nn = (x) => { const v = Number(x); return isFinite(v) ? v : null; };
  return {
    token: {
      address: String(bt.address || ''), name: bt.name || 'Unknown Token', symbol: bt.symbol || '???',
      decimals: null, totalSupply: null,
      isVerified: null,     // no explorer for this chain → genuinely unknown, not "unverified"
      deployer: null, owner: null, renounced: null,
    },
    pair: { address: String(d.pairAddress || ''), quoteSymbol: qt.symbol || '?', token0: null, token1: null,
            createdAt, ageMinutes: createdAt ? Math.max(0, Math.round((now() - createdAt) / 60000)) : null },
    market: { priceUsd: d.priceUsd ? Number(d.priceUsd) : null, liquidityUsd: liq,
              fdv: d.fdv != null ? Number(d.fdv) : null, marketCap: d.marketCap != null ? Number(d.marketCap) : null, reserves: null },
    volume: { m5: n(vol.m5), h1: n(vol.h1), h6: n(vol.h6), h24: n(vol.h24) },
    txns: { h1: { buys: n(txns.h1 && txns.h1.buys), sells: n(txns.h1 && txns.h1.sells) },
            h6: { buys: n(txns.h6 && txns.h6.buys), sells: n(txns.h6 && txns.h6.sells) },
            h24: { buys: n(txns.h24 && txns.h24.buys), sells: n(txns.h24 && txns.h24.sells) } },
    priceChange: { h1: nn(pc.h1), h6: nn(pc.h6), h24: nn(pc.h24) },
    holders: { count: null, topHolderPct: null, top10Pct: null, top: [] },  // no explorer → unknown
    indexed: true,
    chain: slug,
    brand: brandFromDex(d),
    links: { dex: d.url || ('https://dexscreener.com/' + slug + '/' + d.pairAddress), explorer: null },
    risk: {},
  };
}

async function refreshForeignChain(slug) {
  const st = foreignCache.get(slug) || { pairs: [], updatedAt: 0, building: false, error: null };
  if (st.building) return st;
  st.building = true; foreignCache.set(slug, st);
  try {
    // Two sources, merged: the cross-chain "latest profiles" feed surfaces genuinely new tokens,
    // and a broad search backfills so a quiet chain is not an empty page.
    const seen = new Map();
    const profiles = await jget('https://api.dexscreener.com/token-profiles/latest/v1');
    const addrs = (Array.isArray(profiles) ? profiles : []).filter(p => p && p.chainId === slug && p.tokenAddress)
      .map(p => p.tokenAddress).slice(0, 30);
    for (let i = 0; i < addrs.length; i += 30) {
      const arr = await jget('https://api.dexscreener.com/tokens/v1/' + slug + '/' + addrs.slice(i, i + 30).join(','));
      for (const d of (Array.isArray(arr) ? arr : [])) if (d && d.pairAddress) seen.set(String(d.pairAddress).toLowerCase(), d);
    }
    const s = await jget('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(slug));
    for (const d of ((s && s.pairs) || [])) {
      if (d && d.chainId === slug && d.pairAddress) seen.set(String(d.pairAddress).toLowerCase(), d);
    }
    const pairs = [...seen.values()]
      .map(d => pairFromDex(d, slug))
      .filter(p => p.token.address && p.pair.address)
      .sort((a, b) => (b.pair.createdAt || 0) - (a.pair.createdAt || 0))
      .slice(0, 120);
    // Same risk model, and every explorer-only signal is null, so dataKnown records them as
    // unreadable and thinData keeps these off the top tier honestly.
    for (const p of pairs) applyRisk(p, {}, {});
    st.pairs = pairs; st.updatedAt = now(); st.error = null;
  } catch (e) { st.error = (e && e.message) || 'refresh failed'; }
  finally { st.building = false; foreignCache.set(slug, st); }
  return st;
}

const RISK = {
  honeypotSuspect: { w: 45, sev: 'critical', label: '🍯 Honeypot risk — buys but no sells' },
  dumping:         { w: 32, sev: 'critical', label: '📉 Price dumping (−50%+ in 1h)' },
  serialDeployer:  { w: 26, sev: 'high',     label: '🚩 Serial deployer' },
  lowLiquidity:    { w: 26, sev: 'high',     label: '💧 Very low liquidity' },
  concentrated:    { w: 20, sev: 'high',     label: '🐋 One wallet holds a huge share' },
  unverified:      { w: 15, sev: 'medium',   label: '❓ Contract not verified' },
  lowHolders:      { w: 15, sev: 'medium',   label: '👤 Very few holders' },
  sellPressure:    { w: 12, sev: 'medium',   label: '🔻 Heavy sell pressure' },
  deadVolume:      { w: 12, sev: 'low',      label: '🥱 Almost no volume' },
  sniperDump:      { w: 28, sev: 'high',     label: '🎯 Block-0 snipers sold out' },
  sniperHeavy:     { w: 14, sev: 'medium',   label: '🎯 Block-0 snipers took a big share' },
};

/* ===== Block-0 snipers: who bought in the very first block, and what they did with it ==================
   The question that decides whether a launch was fair: in the FIRST block the pool ever traded, how many
   wallets got in, how much of the supply they took, and — following the TOKENS, not just the wallet — did
   they keep them or get rid of them?

   Following the tokens is the whole point. A real $GWC block-0 wallet took 2.65% of supply and never sent
   a single token to the pool: it split the bag across five fresh wallets, and those wallets hold zero today.
   "Did this wallet sell?" calls that wallet clean. So a sniper is analysed as a CLUSTER — the block-0
   wallet, everyone it moved tokens to, and everyone they moved to (two hops).

   Everything is read from the chain; nothing is estimated. A read that cannot be completed is recorded as
   partial WITH ITS REASON, and a partial scan can never award the top verdict — it also never takes one
   away, because "we could not read it" is not evidence of anything. The work is bounded and runs in the
   background, never on a request: block 0 is immutable once found, so only balances and the ledger re-read. */
const SNIPE = {
  MAX_SNIPERS: 30,        // block-0 wallets traced in full (any beyond this are counted, never guessed at)
  MAX_CONNECTED: 12,      // wallets followed per hop, per wallet
  MAX_CLUSTER: 150,       // total wallets across every cluster for one token
  MAX_RECEIPTS: 80,       // transaction receipts read for the ETH legs of buys and sells
  HOPS: 2,                // sniper → wallet → wallet
  CALL_BUDGET: 600,       // hard ceiling on RPC calls for one token scan
  WINDOW: 4000000,        // blocks per eth_getLogs window when walking forward to block 0
  TTL: 6 * 3600 * 1000,   // balances and the ledger are re-read this often; block 0 never is
  RETRY_MS: 30 * 60 * 1000, // a failed scan waits this long before another attempt
  TRIES: 6,               // attempts per read when the node is congested (it answers 429 under load)
  BACKOFF_MS: 1500,       // grows linearly with each attempt
  GAP_MS: 45 * 1000,      // rest between whole scans, so the chain is never hammered
  FEED_GAP_MS: 4 * 60e3,  // how often ONE unscanned token from the radar feed is added to the queue
  EARLY_N: 10,            // buys in the "first N" window — block 0 is buy #1, so it stays a subset of this
};
const DEAD_ADDRS = ['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lcAddr = a => String(a || '').toLowerCase();
const topicAddr = a => '0x' + '0'.repeat(24) + lcAddr(a).slice(2);
const addrFromTopic = t => lcAddr('0x' + String(t).slice(26));
const hexBlock = n => '0x' + Number(n).toString(16);

// Addresses that are plumbing, not people. On a taxed token the CONTRACT ITSELF appears as a block-0 buyer
// (it takes its tax straight out of the pool) — counting it as a sniper would put a fair launch's own tax
// mechanism at the top of its own sniper list.
function isSystemAddr(a, token, pair) {
  const x = lcAddr(a);
  return !x || DEAD_ADDRS.includes(x) || x === lcAddr(token) || x === lcAddr(pair)
    || x === SWAP_ROUTER || x === FACTORY || x === WETH_ADDR;
}

/* The shared rpc() is deliberately fail-fast — the pairs refresher must not stall behind a slow node. A
   sniper scan is the opposite: it is a background job with nobody waiting, and the public RPC answers 429
   under load, so it waits and tries again rather than recording "no snipers" for a read it never made. */
function sniperBudget() {
  let n = 0;
  return {
    get used() { return n; },
    spent() { return n >= SNIPE.CALL_BUDGET; },
    async call(m, p) {
      n++;
      if (n > SNIPE.CALL_BUDGET) throw Object.assign(new Error('read budget spent'), { budget: true });
      let last;
      for (let i = 0; i < SNIPE.TRIES; i++) {
        try { return await rpc(m, p); } catch (e) {
          last = e;
          const msg = String((e && e.message) || '');
          if (!/429|timed out|timeout|abort|http 5|ECONNRESET|fetch failed/i.test(msg)) throw e;   // a real error, not congestion
          await sleep(SNIPE.BACKOFF_MS * (i + 1));
        }
      }
      throw last;
    },
  };
}

/* A balance read on the scan's own budget. erc20Balance() goes through the fail-fast rpc(), which is right
   for the pairs refresher and wrong here: one 429 on one wallet made that wallet "not readable", and since
   balances decide accumulator-vs-seller, a single congested moment turned a clean answer into "unknown". */
async function sniperBalance(B, token, addr) {
  const data = '0x70a08231' + lcAddr(addr).replace('0x', '').padStart(64, '0');
  const r = await B.call('eth_call', [{ to: token, data }, 'latest']);
  if (r == null || r === '0x') throw new Error('balance read failed');   // never let an empty read read as zero
  return BigInt(r);
}

// eth_getLogs with an explicit topic array, halving on a node timeout: the node's limit is on the work a
// query does, not on the block range, so the same range usually succeeds once split.
async function sniperLogs(B, address, topics, from, to) {
  try {
    return await B.call('eth_getLogs', [{ fromBlock: hexBlock(from), toBlock: hexBlock(to), address, topics }]);
  } catch (e) {
    if (e.budget || to - from < 20000) throw e;
    const mid = Math.floor((from + to) / 2);
    const a = await sniperLogs(B, address, topics, from, mid);
    const b = await sniperLogs(B, address, topics, mid + 1, to);
    return a.concat(b);
  }
}

// the first block at or after a timestamp, by binary search on block headers (~26 reads on this chain)
async function blockAtTime(B, tsSec, head) {
  let lo = 1, hi = head;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const b = await B.call('eth_getBlockByNumber', [hexBlock(mid), false]);
    if (!b) throw new Error('block header unreadable');
    if (parseInt(b.timestamp, 16) < tsSec) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/* The first N buys a pool ever paid out, in chain order.
   Block 0 answers "who got in at the very first opportunity". It does not answer "who got in early" — a wallet
   that bought in block 1, or was the 4th buy of the first minute, is the same kind of actor and was invisible
   here. This widens the window to the first N payouts while keeping block 0 exactly as it was: buy #1 is by
   definition in block 0, so the block-0 view is a subset of this one and every existing verdict is unchanged.

   System payouts (a taxed token pays its own contract straight out of the pool) are counted toward the tax
   total but never toward the N — they are plumbing, not buyers, and letting them consume the window would
   hide real ones. */
async function findFirstBuys(B, token, pair, createdAtMs, head, want) {
  let from = 1;
  if (createdAtMs > 0) from = Math.max(1, await blockAtTime(B, Math.floor(createdAtMs / 1000), head) - 5000);
  const topics = [TRANSFER_TOPIC, topicAddr(pair)];
  const buys = [];
  let block = null, systemTook = 0n, block0Logs = [], scanned = false;
  for (let b = from; b <= head && buys.length < want; b += SNIPE.WINDOW) {
    const logs = await sniperLogs(B, token, topics, b, Math.min(b + SNIPE.WINDOW - 1, head));
    if (!logs.length) { if (scanned) break; continue; }   // nothing yet: keep walking forward
    scanned = true;
    // chain order: block, then position within the block. A payout's rank is only meaningful in this order.
    logs.sort((x, y) => (parseInt(x.blockNumber, 16) - parseInt(y.blockNumber, 16)) || (parseInt(x.logIndex, 16) - parseInt(y.logIndex, 16)));
    if (block == null) {
      block = parseInt(logs[0].blockNumber, 16);
      block0Logs = logs.filter(l => parseInt(l.blockNumber, 16) === block);
    }
    for (const l of logs) {
      if (buys.length >= want) break;
      const to = addrFromTopic(l.topics[2]), v = BigInt(l.data);
      if (isSystemAddr(to, token, pair)) { systemTook += v; continue; }   // the tax leg never consumes a slot
      buys.push({ to, value: v, block: parseInt(l.blockNumber, 16), tx: l.transactionHash });
    }
  }
  return { block, block0Logs, buys, systemTook };
}

/* One traced wallet, rendered against whatever amount we are measuring it by — the block-0 view measures the
   cluster against what it took in block 0, the first-N view against what it took across those N buys. Same
   cluster, same ledger, two honest denominators. */
function sniperEntry(addr, took, cl, legs, price, extra) {
  const holdsKnown = cl.wallets.every(w => w.holds != null);
  const clusterHolds = cl.wallets.reduce((s, w) => s + (w.holds || 0n), 0n);
  const clusterSold = cl.wallets.reduce((s, w) => s + w.sentToPool, 0n);
  const clusterBought = cl.wallets.reduce((s, w) => s + w.boughtFromPool, 0n);
  const unrealised = price != null && holdsKnown ? BigInt(Math.round(Number(clusterHolds) * price)) : null;
  return {
    addr,
    sniped: took.toString(),
    holds: cl.wallets[0] && cl.wallets[0].holds != null ? cl.wallets[0].holds.toString() : null,
    clusterHolds: holdsKnown ? clusterHolds.toString() : null,
    clusterSold: clusterSold.toString(),
    /* Everything the cluster EVER bought from this pool, not just its early buy. The difference between this
       and `sniped` is the part of the story block 0 could never tell: a wallet that took a small amount early
       and then kept buying is a different actor from one that took the same amount and stopped. */
    clusterBought: clusterBought.toString(),
    /* Supply this cluster sold that it demonstrably never bought here. Selling more than you ever bought from
       the pool is only possible if the tokens arrived some other way — a pre-allocation, an airdrop, a hand-off
       from the deployer. It is a FLOOR, not a total: it says "at least this much came from somewhere else",
       which is provable from these two numbers alone, and claims nothing about where. Measured live on $SEND,
       where the second buyer sold 0.784% of float having bought 0.730%. */
    notFromPool: (clusterSold > clusterBought ? clusterSold - clusterBought : 0n).toString(),
    connected: cl.wallets.filter(w => w.hop > 0).map(w => ({ addr: w.addr, hop: w.hop, holds: w.holds == null ? null : w.holds.toString(), soldToPool: w.sentToPool.toString() })),
    connectedCount: cl.wallets.length - 1,
    // net over the WHOLE cluster: does it still hold at least what it took?
    net: !holdsKnown ? 'unknown' : clusterHolds >= took ? 'accumulator' : clusterHolds === 0n ? 'fully out' : 'seller',
    costWei: legs.cost.toString(),
    proceedsWei: legs.proceeds.toString(),
    unrealisedWei: unrealised == null ? null : unrealised.toString(),
    pnlWei: unrealised == null ? null : (legs.proceeds + unrealised - legs.cost).toString(),
    capped: cl.capped || legs.capped,
    ...(extra || {}),
  };
}

/* The float the percentages are measured against. Total supply flatters a token that keeps most of its
   supply in the pool or has burned some, so both are reported: the raw supply, and the float actually in
   circulation — supply minus the pool, the burn addresses and the token's own tax balance. */
async function tokenFloat(B, token, pair, supply) {
  let held = 0n;
  for (const a of [pair, token, ...DEAD_ADDRS]) {
    try { held += await sniperBalance(B, token, a); } catch { /* one unreadable balance must not zero the float */ }
  }
  const f = supply - held;
  return f > 0n && f <= supply ? f : supply;
}

// one cluster: a block-0 wallet, everyone it moved tokens to, and everyone they moved to
async function traceCluster(B, token, pair, root, fromBlock, head, seenGlobal) {
  const wallets = new Map();
  let capped = false, frontier = [root];
  const seen = new Set([root]);
  for (let hop = 0; hop <= SNIPE.HOPS && frontier.length; hop++) {
    const next = [];
    for (const addr of frontier) {
      if (B.spent()) { capped = true; break; }
      const [out, inFromPool] = await Promise.all([
        sniperLogs(B, token, [TRANSFER_TOPIC, topicAddr(addr)], fromBlock, head),
        sniperLogs(B, token, [TRANSFER_TOPIC, topicAddr(pair), topicAddr(addr)], fromBlock, head),
      ]);
      const rec = { addr, hop, boughtFromPool: 0n, buyTxs: [], sentToPool: 0n, sellTxs: [], sentOn: 0n, holds: null, to: [] };
      for (const l of inFromPool) { rec.boughtFromPool += BigInt(l.data); rec.buyTxs.push(l.transactionHash); }
      const dests = new Map();
      for (const l of out) {
        const d = addrFromTopic(l.topics[2]), v = BigInt(l.data);
        if (d === lcAddr(pair)) { rec.sentToPool += v; rec.sellTxs.push(l.transactionHash); continue; }
        if (isSystemAddr(d, token, pair)) continue;      // the tax leg is not a hop
        rec.sentOn += v;
        dests.set(d, (dests.get(d) || 0n) + v);
      }
      try { rec.holds = await sniperBalance(B, token, addr); } catch { rec.holds = null; }   // null = unread, never 0
      const ranked = [...dests.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
      rec.to = ranked.map(([a, v]) => ({ addr: a, amount: v.toString() }));
      wallets.set(addr, rec);
      if (hop < SNIPE.HOPS) {
        if (ranked.length > SNIPE.MAX_CONNECTED) capped = true;
        for (const [d] of ranked.slice(0, SNIPE.MAX_CONNECTED)) {
          if (seen.has(d) || seenGlobal.has(d)) continue;
          if (seenGlobal.size >= SNIPE.MAX_CLUSTER) { capped = true; break; }
          seen.add(d); seenGlobal.add(d); next.push(d);
        }
      }
    }
    frontier = next;
  }
  return { wallets: [...wallets.values()], capped };
}

/* The ETH side of the ledger, read from the WETH legs of the very transactions the cluster's token moves
   appear in: WETH into the pool is what they paid, WETH out of it is what they were paid. Exact, and in the
   quote asset — no historical USD price is invented anywhere. */
async function sniperEthLegs(B, pair, txHashes) {
  let cost = 0n, proceeds = 0n, read = 0, capped = false;
  for (const h of txHashes) {
    if (read >= SNIPE.MAX_RECEIPTS || B.spent()) { capped = true; break; }
    let rc;
    try { rc = await B.call('eth_getTransactionReceipt', [h]); read++; } catch { capped = true; break; }
    for (const l of (rc && rc.logs) || []) {
      if (lcAddr(l.address) !== WETH_ADDR || lcAddr(l.topics[0]) !== TRANSFER_TOPIC) continue;
      if (addrFromTopic(l.topics[2]) === lcAddr(pair)) cost += BigInt(l.data);
      else if (addrFromTopic(l.topics[1]) === lcAddr(pair)) proceeds += BigInt(l.data);
    }
  }
  return { cost, proceeds, read, capped };
}

// price of one token in WETH, from the pool's own reserves
async function sniperPriceWeth(B, pair, token) {
  const [r, t0] = await Promise.all([
    B.call('eth_call', [{ to: pair, data: '0x0902f1ac' }, 'latest']),
    B.call('eth_call', [{ to: pair, data: '0x0dfe1681' }, 'latest']),
  ]);
  if (!r || r === '0x' || !t0) return null;
  const body = r.slice(2);
  const r0 = BigInt('0x' + body.slice(0, 64)), r1 = BigInt('0x' + body.slice(64, 128));
  const token0 = lcAddr('0x' + t0.slice(26));
  const [tokRes, wethRes] = token0 === lcAddr(token) ? [r0, r1] : [r1, r0];
  if (tokRes === 0n) return null;
  return Number(wethRes) / Number(tokRes);
}

function sniperTotals(snipers) {
  const sum = f => snipers.reduce((s, x) => s + (x[f] == null ? 0n : BigInt(x[f])), 0n);
  const known = snipers.filter(s => s.clusterHolds != null);
  return {
    wallets: snipers.length,
    sniped: sum('sniped').toString(),
    holds: known.reduce((s, x) => s + BigInt(x.clusterHolds), 0n).toString(),
    holdsKnown: known.length === snipers.length,
    sold: sum('clusterSold').toString(),
    connectedWallets: snipers.reduce((s, x) => s + x.connectedCount, 0),
    costWei: sum('costWei').toString(),
    proceedsWei: sum('proceedsWei').toString(),
    unrealisedWei: sum('unrealisedWei').toString(),
    pnlWei: sum('pnlWei').toString(),
    netSellers: snipers.filter(s => s.net === 'seller' || s.net === 'fully out').length,
    netAccumulators: snipers.filter(s => s.net === 'accumulator').length,
    unknown: snipers.filter(s => s.net === 'unknown').length,
  };
}

async function scanSnipers(token, pair, createdAtMs) {
  const B = sniperBudget();
  const notes = [];
  const head = parseInt(await B.call('eth_blockNumber', []), 16);
  const supply = await totalSupply(token);
  if (!(supply > 0n)) throw new Error('total supply unreadable');
  const { block, block0Logs, buys, systemTook: sysEarly } = await findFirstBuys(B, token, pair, createdAtMs, head, SNIPE.EARLY_N);
  if (block == null) {
    return { block0: null, block0At: null, supply: supply.toString(), float: supply.toString(), systemTook: '0',
      snipers: [], totals: sniperTotals([]), early: null, priceWeth: null, capped: false, calls: B.used,
      notes: ['This pool has never paid a token out — nobody has bought yet.'] };
  }
  const blockAt = parseInt((await B.call('eth_getBlockByNumber', [hexBlock(block), false])).timestamp, 16) * 1000;
  const float = await tokenFloat(B, token, pair, supply);
  let price = null;
  try { price = await sniperPriceWeth(B, pair, token); } catch { price = null; }

  // block 0, exactly as before — this is what the verdict gate reads, and its meaning must not drift
  const got = new Map();
  let systemTook = 0n;
  for (const l of block0Logs) {
    const to = addrFromTopic(l.topics[2]), v = BigInt(l.data);
    if (isSystemAddr(to, token, pair)) { systemTook += v; continue; }
    got.set(to, (got.get(to) || 0n) + v);
  }
  if (sysEarly > systemTook) systemTook = sysEarly;   // tax taken across the whole first-N window

  /* The first N buys, folded per wallet. One wallet can occupy several of the N slots — that is itself worth
     showing, so the ranks it took are kept rather than collapsed to a count. */
  const early = new Map();
  buys.forEach((b, i) => {
    const e = early.get(b.to) || { addr: b.to, took: 0n, ranks: [], firstBlock: b.block, lastBlock: b.block };
    e.took += b.value; e.ranks.push(i + 1); e.lastBlock = b.block;
    if (b.block < e.firstBlock) e.firstBlock = b.block;
    early.set(b.to, e);
  });

  /* Every wallet worth tracing, block-0 first so a tight budget always covers the verdict before the extras.
     Each is traced ONCE and then read two ways: against what it took in block 0, and against what it took
     across the first N. Tracing them twice would double the chain reads to say the same thing. */
  const order = [...new Set([
    ...[...got.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).map(([a]) => a),
    ...[...early.values()].sort((a, b) => (b.took > a.took ? 1 : b.took < a.took ? -1 : 0)).map(e => e.addr),
  ])];
  const traced = order.slice(0, SNIPE.MAX_SNIPERS);
  let capped = order.length > traced.length;
  if (capped) notes.push('Traced the ' + traced.length + ' largest of ' + order.length + ' early wallets.');

  const seenGlobal = new Set(traced);
  const cache = new Map();                       // addr -> { cl, legs }
  for (const addr of traced) {
    const cl = await traceCluster(B, token, pair, addr, block, head, seenGlobal);
    if (cl.capped) capped = true;
    const txs = [...new Set([].concat(...cl.wallets.map(w => w.buyTxs.concat(w.sellTxs))))];
    const legs = await sniperEthLegs(B, pair, txs);
    if (legs.capped) capped = true;
    cache.set(addr, { cl, legs });
    if (B.spent()) { capped = true; notes.push('The scan reached its read budget; the remaining early wallets were not traced.'); break; }
  }

  // view 1 — block 0. Same shape, same semantics, same consumers.
  const snipers = [];
  for (const [addr, sniped] of [...got.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))) {
    const c = cache.get(addr); if (!c) continue;
    snipers.push(sniperEntry(addr, sniped, c.cl, c.legs, price));
  }

  // view 2 — the first N buys, block 0 included and labelled as such
  const earlyWallets = [];
  for (const e of [...early.values()].sort((a, b) => a.ranks[0] - b.ranks[0])) {
    const c = cache.get(e.addr); if (!c) continue;
    earlyWallets.push(sniperEntry(e.addr, e.took, c.cl, c.legs, price, {
      ranks: e.ranks,                       // which of the first N buys were this wallet's
      firstBlock: e.firstBlock,
      blocksAfterZero: e.firstBlock - block,
      atBlock0: got.has(e.addr),
    }));
  }
  const earlyOut = {
    want: SNIPE.EARLY_N,
    buys: buys.length,
    wallets: earlyWallets,
    lastBlock: buys.length ? buys[buys.length - 1].block : block,
    spanBlocks: buys.length ? buys[buys.length - 1].block - block : 0,
    totals: sniperTotals(earlyWallets),
    traced: earlyWallets.length,
    untraced: early.size - earlyWallets.length,
  };

  return { block0: block, block0At: blockAt, supply: supply.toString(), float: float.toString(),
    systemTook: systemTook.toString(), snipers, totals: sniperTotals(snipers), early: earlyOut,
    priceWeth: price, notes, capped, calls: B.used };
}

/* The scan store. One row per token; block 0 is written once and never re-derived. Reads are synchronous
   and cheap (a primary-key lookup) because applyRisk runs for every pair on every refresh; the scanning
   itself is a background queue that does one token at a time so the chain is never hammered. */
function sniperRow(token) {
  try { return db.prepare('SELECT * FROM sniper_scans WHERE token_addr = ?').get(lcAddr(token)) || null; } catch { return null; }
}
function sniperData(row) {
  if (!row || !row.data) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}
const sniperQueue = [];                 // [{ token, pair, createdAtMs }] waiting to be scanned
const SNIPE_QUEUE_MAX = 200;
let sniperScanning = false;
function queueSniperScan(token, pair, createdAtMs) {
  const t = lcAddr(token), pr = lcAddr(pair);
  if (!/^0x[0-9a-f]{40}$/.test(t) || !/^0x[0-9a-f]{40}$/.test(pr)) return;
  if (sniperQueue.length >= SNIPE_QUEUE_MAX || sniperQueue.some(q => q.token === t)) return;
  const row = sniperRow(t);
  const age = row && row.finished_at ? now() - row.finished_at : Infinity;
  // re-scan a finished token on the TTL, retry a failure after a pause, and never re-enter one in flight
  if (row) {
    if (row.status === 'running' || row.status === 'queued') return;
    if ((row.status === 'done' || row.status === 'partial') && age < SNIPE.TTL) return;
    if (row.status === 'failed' && age < SNIPE.RETRY_MS) return;
  }
  try {
    db.prepare(`INSERT INTO sniper_scans (token_addr, pair_addr, status, started_at) VALUES (?,?,'queued',?)
                ON CONFLICT(token_addr) DO UPDATE SET pair_addr = excluded.pair_addr, status = 'queued'`).run(t, pr, now());
  } catch { return; }
  sniperQueue.push({ token: t, pair: pr, createdAtMs: Number(createdAtMs) || 0 });
}
async function runSniperQueue() {
  if (sniperScanning) return;
  const job = sniperQueue.shift();
  if (!job) return;
  sniperScanning = true;
  const t0 = now();
  try {
    db.prepare("UPDATE sniper_scans SET status = 'running', started_at = ?, attempts = attempts + 1 WHERE token_addr = ?").run(t0, job.token);
    // block 0 never changes, so a re-scan reuses the one already found and only re-reads the wallets
    const prev = sniperRow(job.token);
    const data = await scanSnipers(job.token, job.pair, prev && prev.block0_at ? prev.block0_at : job.createdAtMs);
    db.prepare(`UPDATE sniper_scans SET status = ?, reason = ?, block0 = ?, block0_at = ?, data = ?, calls = ?, finished_at = ?
                WHERE token_addr = ?`)
      .run(data.capped ? 'partial' : 'done', data.notes.length ? data.notes.join(' ') : null,
           data.block0, data.block0At, JSON.stringify(data), data.calls, now(), job.token);
  } catch (e) {
    // a failed read is recorded as a failure with its reason — never as "no snipers found"
    db.prepare("UPDATE sniper_scans SET status = 'failed', reason = ?, finished_at = ? WHERE token_addr = ?")
      .run(String((e && e.message) || 'the chain could not be read').slice(0, 200), now(), job.token);
  } finally {
    // rest before the next scan even if this one failed — the chain is shared with every other read here
    setTimeout(() => { sniperScanning = false; }, SNIPE.GAP_MS).unref();
  }
}

/* The verdict this feeds into. The three ways a token can still earn the top "Looks Good, Send It":
     · nobody sniped block 0 at all;
     · every block-0 cluster still holds at least what it took (net accumulators);
     · the block-0 clusters are immaterial — they took under 1% of the float AND hold under 1% of it.
   The third is the strict reading of both senses of "less than 1%", so a cluster that took a big share and
   dumped it can never pass on the grounds that it now holds nothing. A scan that is missing or partial
   answers `null` — not checked — which withholds the top verdict without inventing a penalty. */
const SNIPE_MATERIAL_PCT = 1;      // a block-0 cluster under this share of the float is immaterial
const SNIPE_HEAVY_PCT = 5;         // block-0 wallets took this much of the float or more
function sniperVerdict(d) {
  if (!d || d.block0 === undefined) return { ok: null, heavy: false, dump: false };
  const float = Number(d.float || 0) || 0;
  const t = d.totals || {};
  const pct = v => (float > 0 ? Number(v || 0) / float * 100 : null);
  const snipedPct = pct(t.sniped), holdsPct = t.holdsKnown ? pct(t.holds) : null;
  const complete = !d.capped && t.unknown === 0 && t.holdsKnown;
  const immaterial = snipedPct != null && holdsPct != null && snipedPct < SNIPE_MATERIAL_PCT && holdsPct < SNIPE_MATERIAL_PCT;
  const ok = t.wallets === 0 ? true : !complete ? null : (t.netSellers === 0 || immaterial);
  return {
    ok,
    heavy: !!(snipedPct != null && snipedPct >= SNIPE_HEAVY_PCT),
    dump: !!(complete && t.netSellers > 0 && snipedPct != null && snipedPct >= SNIPE_MATERIAL_PCT),
    snipedPct, holdsPct,
  };
}

function num(x) { const n = Number(x); return isFinite(n) ? n : 0; }
function numN(x) { const n = Number(x); return isFinite(n) ? n : null; }

// --- extra read-only on-chain reads for the tracker (all cached in the 90s pairs refresh) ---
async function ethCall(to, data) { return rpc('eth_call', [{ to, data }, 'latest']).catch(() => null); }
/* Same read, but a failure THROWS instead of becoming null. Callers that must distinguish "the chain says no"
   from "the chain did not answer" need this: with the swallowing version, an RPC outage is indistinguishable
   from an authoritative negative, which is how a node being down became "no pool exists for this token". */
async function ethCallStrict(to, data) { return rpc('eth_call', [{ to, data }, 'latest']); }
async function tokenDecimals(token) {                         // decimals() 0x313ce567 — null on failure (never cache/scale a miss)
  const r = await ethCall(token, '0x313ce567');
  if (!r || r === '0x') return null;
  try { return Number(BigInt(r)); } catch { return null; }
}
async function getReserves(pairAddr) {                        // getReserves() 0x0902f1ac → (uint112 r0, uint112 r1, uint32 ts)
  const r = await ethCall(pairAddr, '0x0902f1ac');
  if (!r || r.length < 130) return null;
  try { return { r0: BigInt('0x' + r.slice(2, 66)), r1: BigInt('0x' + r.slice(66, 130)) }; } catch { return null; }
}
async function tokenOwner(token) {                            // owner() 0x8da5cb5b (many tokens lack it → unknown)
  const r = await ethCall(token, '0x8da5cb5b');
  if (!r || r === '0x' || r.length < 66) return { owner: null, renounced: null };
  const a = '0x' + r.slice(26, 66);
  return { owner: a, renounced: /^0x0{40}$/.test(a) };        // zero address = ownership renounced
}
let usdgDecimals = null; // cached once (Global Dollar's decimals — don't hardcode)

function buildPair(t, dex, meta, addr, holdersData, ts, reserves, ownerInfo, tokenDec) {
  const decimals = tokenDec != null ? tokenDec : (meta && meta.decimals != null ? Number(meta.decimals) : 18); // prefer authoritative on-chain decimals
  const totalSupplyRaw = meta && meta.total_supply ? meta.total_supply : null;
  const holdersVal = meta ? (meta.holders_count != null ? meta.holders_count : meta.holders) : null;
  // treat 0 as "not indexed yet" (unknown), not a real zero — brand-new tokens lag Blockscout's holder count
  const count = holdersVal != null && Number(holdersVal) > 0 ? Number(holdersVal) : null;
  let topHolderPct = null, top10Pct = null;
  if (holdersData && Array.isArray(holdersData.items) && totalSupplyRaw && Number(totalSupplyRaw) > 0) {
    const ts0 = Number(totalSupplyRaw);
    const vals = holdersData.items.map(h => Number(h.value) || 0);
    if (vals.length) { topHolderPct = vals[0] / ts0 * 100; top10Pct = vals.slice(0, 10).reduce((a, b) => a + b, 0) / ts0 * 100; }
  }
  // top-10 holder list (no extra network call — reuses the holders fetch already made)
  let topHolders = [];
  if (holdersData && Array.isArray(holdersData.items) && totalSupplyRaw && Number(totalSupplyRaw) > 0) {
    const ts0 = Number(totalSupplyRaw);
    topHolders = holdersData.items.slice(0, 10).map(h => ({
      address: String((h.address && h.address.hash) || h.address || '').toLowerCase(),
      pct: ts0 ? (Number(h.value) || 0) / ts0 * 100 : null,
    })).filter(x => x.address);
  }
  // pooled reserves: token side vs quote side, decimal-adjusted
  let reservesOut = null;
  if (reserves && (t.quoteSymbol === 'WETH' || t.quoteSymbol === 'USDG')) {
    const tokenIsToken0 = t.token === t.token0;
    const tokenRaw = tokenIsToken0 ? reserves.r0 : reserves.r1;
    const quoteRaw = tokenIsToken0 ? reserves.r1 : reserves.r0;
    const qDec = t.quoteSymbol === 'USDG' ? (usdgDecimals != null ? usdgDecimals : 6) : 18;
    reservesOut = { tokenAmount: Number(tokenRaw) / Math.pow(10, decimals), quoteAmount: Number(quoteRaw) / Math.pow(10, qDec), quoteSymbol: t.quoteSymbol };
  }
  const txns = dex && dex.txns ? dex.txns : {}, vol = dex && dex.volume ? dex.volume : {}, pc = dex && dex.priceChange ? dex.priceChange : {};
  const createdAt = (dex && dex.pairCreatedAt) || ts || 0;
  return {
    token: {
      address: t.token,
      name: (meta && meta.name) || (dex && dex.baseToken && dex.baseToken.name) || 'Unknown Token',
      symbol: (meta && meta.symbol) || (dex && dex.baseToken && dex.baseToken.symbol) || '???',
      decimals, totalSupply: totalSupplyRaw,
      isVerified: addr && typeof addr.is_verified === 'boolean' ? addr.is_verified : null,
      deployer: (addr && addr.creator_address_hash) ? String(addr.creator_address_hash).toLowerCase() : null,
      owner: ownerInfo ? ownerInfo.owner : null,
      renounced: ownerInfo ? ownerInfo.renounced : null,
    },
    pair: { address: t.pair, quoteSymbol: t.quoteSymbol, token0: t.token0 || null, token1: t.token1 || null, createdAt, ageMinutes: createdAt ? Math.max(0, Math.round((now() - createdAt) / 60000)) : null },
    market: {
      priceUsd: dex && dex.priceUsd ? Number(dex.priceUsd) : null,
      liquidityUsd: dex && dex.liquidity && dex.liquidity.usd != null ? Number(dex.liquidity.usd) : null,
      fdv: dex && dex.fdv != null ? Number(dex.fdv) : null,
      marketCap: dex && dex.marketCap != null ? Number(dex.marketCap) : null,
      reserves: reservesOut,
    },
    volume: { m5: num(vol.m5), h1: num(vol.h1), h6: num(vol.h6), h24: num(vol.h24) },
    txns: {
      h1: { buys: num(txns.h1 && txns.h1.buys), sells: num(txns.h1 && txns.h1.sells) },
      h6: { buys: num(txns.h6 && txns.h6.buys), sells: num(txns.h6 && txns.h6.sells) },
      h24: { buys: num(txns.h24 && txns.h24.buys), sells: num(txns.h24 && txns.h24.sells) },
    },
    priceChange: { h1: numN(pc.h1), h6: numN(pc.h6), h24: numN(pc.h24) },
    holders: { count, topHolderPct, top10Pct, top: topHolders },
    indexed: !!dex,
    brand: brandFromDex(dex), // Dexscreener logo/banner/socials/enhanced+boosted status (dextools filled later if configured)
    links: { dex: 'https://dexscreener.com/robinhood/' + t.pair, explorer: BLOCKSCOUT + '/token/' + t.token },
    risk: {},
  };
}
// deployerDied heuristic: how many of a deployer's tokens (in this window) already look dead/rugged
function looksDead(e) {
  return (e.priceChange.h24 != null && e.priceChange.h24 <= -80)
    || (e.market.liquidityUsd != null && e.market.liquidityUsd < 500)
    || (e.priceChange.h1 != null && e.priceChange.h1 <= -50);
}
function applyRisk(e, deployerCounts, deployerDied) {
  const r = {};
  const b = e.txns.h24.buys, s = e.txns.h24.sells;
  const liq = e.market.liquidityUsd, ch1 = e.priceChange.h1, hc = e.holders.count, top = e.holders.topHolderPct;
  r.honeypotSuspect = b >= 12 && s === 0;                          // people buy, nobody sells
  r.dumping = ch1 != null && ch1 <= -50;
  r.lowLiquidity = liq != null && liq < 1500;
  r.concentrated = top != null && top >= 30;
  r.unverified = e.token.isVerified === false;
  r.lowHolders = hc != null && hc < 25;
  r.sellPressure = s > b * 2 && s >= 12;
  r.deadVolume = liq != null && e.volume.h24 < 300 && e.pair.ageMinutes != null && e.pair.ageMinutes > 60;
  const dep = e.token.deployer;
  r.serialDeployer = !!(dep && deployerCounts[dep] >= 3);
  if (r.serialDeployer) { r.deployerLaunches = deployerCounts[dep]; r.deployerDied = deployerDied[dep] || 0; }
  applySniperFlags(e, r);
  const penalty = Object.keys(RISK).reduce((a, k) => a + (r[k] ? RISK[k].w : 0), 0);
  r.health = Math.max(0, Math.min(100, 100 - penalty));
  r.triage = r.health >= 70 ? 'ok' : r.health >= 40 ? 'caution' : r.health >= 15 ? 'high' : 'avoid';
  /* DATA COMPLETENESS — the difference between "we checked and it is fine" and "we could not check".
     Every flag above is null-guarded, so a token too new to have liquidity, holder or verification data
     trips NOTHING, scores 100 - 0 = 100, and would otherwise be presented with the greenest verdict on
     the site. That is exactly backwards: least-known reads as safest. We therefore record which signals
     were actually readable, and a token missing the load-bearing ones can never reach the top tier. */
  r.dataKnown = {
    indexed:  !!e.indexed,
    liquidity: e.market.liquidityUsd != null,
    holders:   e.holders.count != null,
    concentration: e.holders.topHolderPct != null,
    verified:  e.token.isVerified != null,
    snipers:   r.sniperOk != null,       // the block-0 scan finished and could answer
  };
  r.dataScore = Object.values(r.dataKnown).filter(Boolean).length;   // 0..6
  // liquidity + holders + an index entry are the minimum needed to say anything at all
  r.thinData = !(r.dataKnown.indexed && r.dataKnown.liquidity && r.dataKnown.holders);
  if (r.thinData && r.triage === 'ok') r.triage = 'caution';
  // honesty floor: a token carrying a high/critical-severity flag can never read as the green "Looks OK" tier
  const SEV_RANK = { low: 1, medium: 2, high: 3, critical: 4 };
  const worst = Object.keys(RISK).reduce((m, k) => r[k] ? Math.max(m, SEV_RANK[RISK[k].sev] || 0) : m, 0);
  if (worst >= 3 && r.triage === 'ok') r.triage = 'caution';
  e.risk = r;
}

/* Block-0 snipers, read from the cached scan — a synchronous primary-key lookup, because this runs for
   every pair on every refresh. A token that has not been scanned yet is `sniperOk: null`: NOT CHECKED,
   which withholds the top verdict without inventing a penalty for a read we have not made. */
function applySniperFlags(e, r) {
  const snipeRow = sniperRow(e.token.address);
  const snipeData = sniperData(snipeRow);
  const sv = sniperVerdict(snipeData);
  r.sniperOk = sv.ok;
  r.sniperDump = sv.dump;
  r.sniperHeavy = sv.heavy;
  r.snipers = snipeData ? {
    status: snipeRow.status, block0: snipeData.block0, block0At: snipeData.block0At,
    wallets: snipeData.totals.wallets, snipedPct: sv.snipedPct, holdsPct: sv.holdsPct,
    netSellers: snipeData.totals.netSellers, netAccumulators: snipeData.totals.netAccumulators,
    connectedWallets: snipeData.totals.connectedWallets, capped: !!snipeData.capped,
  } : { status: snipeRow ? snipeRow.status : 'unscanned', wallets: null };
}
/* Re-score a pair that came out of the token cache. The cached JSON carries the risk flags computed when it
   was written, but a block-0 scan that finished since then must change the verdict immediately — a viewer
   should not have to wait for the market data to age out before the sniper answer appears. Every input this
   needs is already on the cached object, and re-running it changes nothing else. */
function rescoreCachedPair(pair) {
  try {
    if (!pair || !pair.risk || !pair.token) return pair;
    const before = pair.risk.sniperOk;
    applySniperFlags(pair, pair.risk);
    if (before === pair.risk.sniperOk && pair.risk.dataKnown && 'snipers' in pair.risk.dataKnown) return pair;
    const r = pair.risk;
    const penalty = Object.keys(RISK).reduce((a, k) => a + (r[k] ? RISK[k].w : 0), 0);
    r.health = Math.max(0, Math.min(100, 100 - penalty));
    r.triage = r.health >= 70 ? 'ok' : r.health >= 40 ? 'caution' : r.health >= 15 ? 'high' : 'avoid';
    r.dataKnown = { ...(r.dataKnown || {}), snipers: r.sniperOk != null };
    r.dataScore = Object.values(r.dataKnown).filter(Boolean).length;
    if (r.thinData && r.triage === 'ok') r.triage = 'caution';
    const SEV_RANK = { low: 1, medium: 2, high: 3, critical: 4 };
    const worst = Object.keys(RISK).reduce((m, k) => r[k] ? Math.max(m, SEV_RANK[RISK[k].sev] || 0) : m, 0);
    if (worst >= 3 && r.triage === 'ok') r.triage = 'caution';
  } catch {}
  return pair;
}

async function enrichPairs() {
  // prune the block-timestamp memo to only still-tracked blocks (bounds it to ~pairsRaw size)
  const liveBlocks = new Set(pairsRaw.map(p => p.block));
  for (const bn of blockTsCache.keys()) if (!liveBlocks.has(bn)) blockTsCache.delete(bn);
  const targets = pairsRaw.slice(-PAIRS_KEEP).reverse(); // newest first
  const valid = [];
  for (const t of targets) {
    const t0 = t.token0.toLowerCase(), t1 = t.token1.toLowerCase();
    if (QUOTE_SET.has(t0) && QUOTE_SET.has(t1)) continue; // WETH/USDG pair, not a new coin
    t.token = QUOTE_SET.has(t0) ? t.token1 : t.token0;
    const q = QUOTE_SET.has(t0) ? t0 : (QUOTE_SET.has(t1) ? t1 : null);
    t.quoteSymbol = q ? QUOTE_SYMBOL[q] : '?';
    valid.push(t);
  }
  /* Dexscreener batch (up to 30 tokens/call), matched back by pair address.
     A batch that FAILED is recorded, not silently treated as "none of these are listed". Without this the
     radar answered a rate-limit by blanking every price, liquidity and holder count it had, marking the rows
     unindexed, and — because the whole snapshot was replaced — serving that blank to every reader. */
  const dexByPair = {};
  const dexFailed = new Set();
  let dexReason = null;
  const toks = valid.map(t => t.token);
  for (let i = 0; i < toks.length; i += 30) {
    const slice = toks.slice(i, i + 30);
    const r = await jgetR('https://api.dexscreener.com/tokens/v1/robinhood/' + slice.join(','));
    if (!r.ok) { for (const tk of slice) dexFailed.add(tk); dexReason = dexReason || r.reason; continue; }
    for (const pr of (r.data || [])) if (pr && pr.pairAddress) dexByPair[pr.pairAddress.toLowerCase()] = pr;
  }
  if (usdgDecimals == null) { const d = await tokenDecimals(USDG_ADDR); if (d != null) usdgDecimals = d; } // cache only a successful read (retry next refresh)
  const enriched = (await mapLimit(valid, 6, async (t) => {
    const [meta, addr, holders, ts, reserves, ownerInfo, tokenDec] = await Promise.all([
      jgetCached(BLOCKSCOUT + '/api/v2/tokens/' + t.token),
      jgetCached(BLOCKSCOUT + '/api/v2/addresses/' + t.token),
      jgetCached(BLOCKSCOUT + '/api/v2/tokens/' + t.token + '/holders?items_count=10'),
      blockTimestamp(t.block),
      getReserves(t.pair),        // pooled reserves (read-only)
      tokenOwner(t.token),        // owner()/renounced (read-only)
      tokenDecimals(t.token),     // authoritative decimals (read-only)
    ]);
    const p = buildPair(t, dexByPair[t.pair.toLowerCase()], meta, addr, holders, ts, reserves, ownerInfo, tokenDec);
    /* The price feed could not be asked about this token. Carry forward the last reading we actually took
       rather than publishing zeros: a blank row is not neutral, it reads as "dead token" to every reader and
       to our own scoring. The carried numbers are labelled with when they were true, and `priceStale` stops
       anything downstream treating them as current. If we have nothing to carry, the row stays honestly
       unpriced — it is never invented. */
    if (dexFailed.has(t.token)) {
      const prev = (pairsCache.pairs || []).find(x => x && x.pair && x.pair.address && x.pair.address.toLowerCase() === t.pair.toLowerCase());
      if (prev && prev.indexed) {
        p.indexed = true; p.market = prev.market; p.priceChange = prev.priceChange; p.volume = prev.volume;
        p.txns = prev.txns;                       // trade counts drive the honeypot check — carrying price without them was the bug below
        p.holders = p.holders && p.holders.count != null ? p.holders : prev.holders;
        p.priceStale = true; p.priceAsOf = prev.priceAsOf || pairsCache.updatedAt || null;
        p._prevRisk = prev.risk;                  // the verdict this token last EARNED, on data we actually read
      }
      p.priceUnread = dexReason || 'price feed unreachable';
    }
    if (DEXTOOLS_ON) p.brand.dextools = await dextoolsInfo(t.token); // opt-in; no-op unless DEXTOOLS_API_KEY+CHAIN set
    return p;
  })).filter(Boolean);
  // serial-deployer heuristic across the current window
  const deployerCounts = {}, deployerDied = {};
  for (const e of enriched) {
    const d = e.token.deployer; if (!d) continue;
    deployerCounts[d] = (deployerCounts[d] || 0) + 1;
    if (looksDead(e)) deployerDied[d] = (deployerDied[d] || 0) + 1;
  }
  /* Never let an outage IMPROVE a token's verdict. Re-scoring a carried row would run the checks against
     whatever the failed refresh left absent — and a check that cannot see sells does not report a honeypot, it
     reports nothing, which scores better than the truth. So a carried row keeps the verdict it last earned on
     data we actually read, and is marked stale rather than re-judged on the absence of evidence. */
  for (const e of enriched) {
    if (e.priceStale && e._prevRisk) { e.risk = e._prevRisk; delete e._prevRisk; continue; }
    delete e._prevRisk;
    applyRisk(e, deployerCounts, deployerDied);
  }
  // A carried-forward price must never set a Best Runners baseline, a peak, or a snapshot — the store would
  // record an old price as if it were a new observation and bend every "since scanned" X measured against it.
  try { recordRunners(enriched.filter(e => !e.priceStale)); } catch {}
  try { cacheTokensFromPairs(enriched.filter(e => !e.priceStale && !e.priceUnread)); } catch {} // never overwrite a good cached price with an unread one
  enriched.sort((a, b) => (b.pair.createdAt || 0) - (a.pair.createdAt || 0));
  // `degraded` is what the page needs to say "this is the last reading, taken at HH:MM" instead of implying
  // these are live numbers — or worse, that an unpriced token is a dead one.
  pairsCache = { pairs: enriched, updatedAt: now(), building: false, error: null, degraded: dexFailed.size ? (dexReason || 'price feed unreachable') : null };
}

async function refreshPairs() {
  if (pairsRefreshing) return;
  pairsRefreshing = true;
  try { await scanNewPairs(); await enrichPairs(); }
  catch (e) { pairsCache.error = e.message || 'refresh failed'; pairsCache.building = false; }
  finally { pairsRefreshing = false; }
}

/* ---------- watchlist enrichment (reuses the pairs pipeline; cached so it scales) ---------- */
const wlEnrichCache = new Map(); // pairAddr(lc) -> {t, pair} — shared across all users watching the same token
async function enrichOne(item, opts = {}) {
  const t = { token: item.token_addr, pair: item.pair_addr, token0: item.token0, token1: item.token1, quoteSymbol: item.quote_symbol || '?', block: 0 };
  const [meta, addr, holders, reserves, ownerInfo, tokenDec, dexArr] = await Promise.all([
    jgetCached(BLOCKSCOUT + '/api/v2/tokens/' + t.token),
    jgetCached(BLOCKSCOUT + '/api/v2/addresses/' + t.token),
    jgetCached(BLOCKSCOUT + '/api/v2/tokens/' + t.token + '/holders?items_count=10'),
    getReserves(t.pair),
    tokenOwner(t.token),
    tokenDecimals(t.token),
    jget('https://api.dexscreener.com/tokens/v1/robinhood/' + t.token),
  ]);
  if (usdgDecimals == null) { const d = await tokenDecimals(USDG_ADDR); if (d != null) usdgDecimals = d; }
  let dex = null; const arr = dexArr || [];
  for (const pr of arr) if (pr && pr.pairAddress && pr.pairAddress.toLowerCase() === t.pair.toLowerCase()) { dex = pr; break; }
  if (!dex && !opts.strictPair && arr[0]) dex = arr[0]; // strictPair (lookups): never borrow a DIFFERENT pool's market data
  const p = buildPair(t, dex, meta, addr, holders, (dex && dex.pairCreatedAt) || 0, reserves, ownerInfo, tokenDec);
  if (DEXTOOLS_ON) p.brand.dextools = await dextoolsInfo(t.token); // opt-in; no-op unless DEXTOOLS_API_KEY+CHAIN set
  // serial-deployer flag needs a window of other launches; the live New-Pairs set (passed by lookups) supplies one
  let dc = {}, dd = {};
  if (opts.deployerWindow && p.token.deployer) {
    for (const e of opts.deployerWindow) { const d = e.token && e.token.deployer; if (!d) continue; dc[d] = (dc[d] || 0) + 1; if (looksDead(e)) dd[d] = (dd[d] || 0) + 1; }
    const d = p.token.deployer; dc[d] = (dc[d] || 0) + 1; if (looksDead(p)) dd[d] = (dd[d] || 0) + 1; // include this token
  }
  applyRisk(p, dc, dd);
  return p;
}
/* ---------- token lookup: resolve ANY token address → full pair detail (reuses the enrichOne pipeline) ----------
   Powers the token-detail popup + DEX-list search box: paste/click any token and get the same on-chain detail as a
   live new pair. Reads are served instantly from a PERSISTENT stale-while-revalidate cache (token_cache): once the
   scanner has ever surfaced a token it's stored on disk and always pulls up fast, even across restarts, while a
   background loop keeps the hot ones fresh from on-chain data. Only a token's first-ever read pays the live fetch. */
const TOKEN_CACHE_FRESH = 45 * 1000;              // a cached pair older than this is served instantly but revalidated in the background
const TOKEN_CACHE_NOTFOUND_TTL = 5 * 60 * 1000;   // re-check a "not found" address only every 5 min (don't hammer RPC on dead addresses)
const TOKEN_CACHE_KEEP = 3000;                    // cap rows; prune the least-recently-read beyond this
const TOKEN_CACHE_REFRESH_BATCH = 24;             // background loop: max tokens re-fetched per cycle
const TOKEN_CACHE_TOUCH_COALESCE = 30 * 1000;     // collapse a burst of reads of one token to one last_read_at write per this window
const LIVE_LOOKUP_MAX = 6;                         // global cap on concurrent live _doLookup fetches (bounds RPC/Dexscreener load + open sockets)
let liveLookups = 0;
const lookupInflight = new Map();                 // tokenAddr(lc) -> in-flight live-fetch promise (stampede coalescing, shared by reads + bg refresh)
const tokenTouchAt = new Map();                   // tokenAddr(lc) -> last last_read_at write (in-memory coalescer; advisory LRU, not correctness state)
function tokenCacheRes(row) {                      // reconstruct a lookup result from a cached row
  if (!row) return null;
  if (!row.found) return { notFound: true, reason: row.reason || null };
  try { const pair = JSON.parse(row.pair_json); return pair ? { pair: rescoreCachedPair(pair) } : null; } catch { return null; } // corrupt row → treat as miss
}
function tokenCacheTouch(tok) { // coalesced: at most one write per token per TOKEN_CACHE_TOUCH_COALESCE, so a read flood can't write-amplify
  const last = tokenTouchAt.get(tok) || 0;
  if (now() - last < TOKEN_CACHE_TOUCH_COALESCE) return;
  tokenTouchAt.set(tok, now());
  if (tokenTouchAt.size > 5000) { const k = tokenTouchAt.keys().next().value; tokenTouchAt.delete(k); } // bound the coalescer map
  try { db.prepare('UPDATE token_cache SET last_read_at=?, reads=reads+1 WHERE token_addr=?').run(now(), tok); } catch {}
}
function tokenCachePut(tok, res) {                 // write-through a fresh lookup/refresh result (upsert; preserves last_read_at/reads on update)
  try {
    const found = res && res.pair ? 1 : 0;
    // A reason-less "not found" (empty Dexscreener + null factory) can be a TRANSIENT upstream blip, not a real delisting —
    // never let it demote a last-known-good found=1 row to a sticky 5-min negative. Just mark it re-checked so the
    // refresh loop backs off briefly; the next successful fetch heals it. (A deterministic reason like 'quote' still writes.)
    if (!found && !(res && res.reason)) {
      const prev = tokenCacheGet(tok);
      if (prev && prev.found) { try { db.prepare('UPDATE token_cache SET updated_at=? WHERE token_addr=?').run(now(), tok); } catch {} return; }
    }
    const pj = found ? JSON.stringify(res.pair) : null;
    const sym = found ? String((res.pair.token && res.pair.token.symbol) || '').slice(0, 16) : null;
    const nm = found ? String((res.pair.token && res.pair.token.name) || '').slice(0, 60) : null;
    const reason = (res && res.notFound) ? (res.reason || null) : null;
    db.prepare(`INSERT INTO token_cache (token_addr, pair_json, symbol, name, found, reason, updated_at, last_read_at, reads)
      VALUES (?,?,?,?,?,?,?,?,0)
      ON CONFLICT(token_addr) DO UPDATE SET pair_json=excluded.pair_json, symbol=excluded.symbol, name=excluded.name, found=excluded.found, reason=excluded.reason, updated_at=excluded.updated_at`)
      .run(tok, pj, sym, nm, found, reason, now(), now());
  } catch {}
}
function fetchAndStore(tok, opts = {}) {           // single-flight live lookup that writes through to the persistent cache
  let pr = lookupInflight.get(tok);
  if (pr) return pr;                               // already fetching this token → coalesce (no new upstream load)
  if (liveLookups >= LIVE_LOOKUP_MAX) {            // global concurrency cap: bound total live upstream fetches at any instant
    if (opts.failFast) return Promise.reject(new HttpError('busy — lots of lookups right now, try again in a moment', 503)); // request-path miss: don't queue behind a flood
    return Promise.resolve(null);                  // background caller: skip this cycle, try again later
  }
  liveLookups++;
  const startedAt = now();
  pr = _doLookup(tok).then(res => {
    const cur = tokenCacheGet(tok);
    // An "unavailable" answer is the absence of knowledge, not knowledge. Caching it would freeze a transient
    // outage into a stored fact and keep serving it long after the upstream recovered.
    if (!res || !res.unavailable) {
      if (!(cur && cur.updated_at > startedAt)) tokenCachePut(tok, res); // don't clobber a row refreshed (e.g. by the radar) while we were fetching
    }
    return res;
  }).finally(() => { liveLookups--; lookupInflight.delete(tok); });
  lookupInflight.set(tok, pr);
  return pr;
}
async function pairTokens(pairAddr) {                          // token0() 0x0dfe1681 / token1() 0xd21220a7 → authoritative V2 ordering
  const dec = (r) => (r && r.length >= 66) ? ('0x' + r.slice(26, 66)).toLowerCase() : null;
  const [t0, t1] = await Promise.all([ethCall(pairAddr, '0x0dfe1681'), ethCall(pairAddr, '0xd21220a7')]);
  return { token0: dec(t0), token1: dec(t1) };
}
// strict: throw when the chain could not be read, so only a real zero address means "no such pool"
async function factoryGetPair(a, b, strict) {                  // getPair(address,address) 0xe6a43905 → pool addr or null
  const enc = (x) => x.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const r = strict
    ? await ethCallStrict(FACTORY, '0xe6a43905' + enc(a) + enc(b))
    : await ethCall(FACTORY, '0xe6a43905' + enc(a) + enc(b));
  if (!r || r.length < 66) {
    if (strict) throw new Error('the chain did not answer');   // unreadable ≠ "no pool"
    return null;
  }
  const addr = ('0x' + r.slice(26, 66)).toLowerCase();
  return /^0x0{40}$/.test(addr) ? null : addr;                 // zero address = no such pool
}
function livePairFor(tok) {                        // is this token currently in the live radar feed? (freshest possible data)
  for (const p of (pairsCache.pairs || [])) if (p && p.token && String(p.token.address || '').toLowerCase() === tok) return p;
  return null;
}
async function lookupTokenPair(tokenAddr) {
  tokenAddr = tokenAddr.toLowerCase();
  // 1) freshest: the token is in the live radar feed right now → use it, and keep the persistent copy warm for when it ages out
  const live = livePairFor(tokenAddr);
  if (live) {
    const row = tokenCacheGet(tokenAddr);
    if (!row || now() - row.updated_at > TOKEN_CACHE_FRESH) tokenCachePut(tokenAddr, { pair: live }); // only rewrite the JSON when it'd actually refresh
    tokenCacheTouch(tokenAddr);
    return { pair: live };
  }
  // 2) persistent cache hit → serve INSTANTLY (survives restarts, no TTL eviction); revalidate in the background if stale
  const row = tokenCacheGet(tokenAddr);
  if (row) {
    tokenCacheTouch(tokenAddr);
    const ttl = row.found ? TOKEN_CACHE_FRESH : TOKEN_CACHE_NOTFOUND_TTL;
    if (now() - row.updated_at > ttl && !lookupInflight.has(tokenAddr)) fetchAndStore(tokenAddr).catch(() => {}); // non-blocking refresh
    const res = tokenCacheRes(row);
    if (res) return res;                                         // corrupt row falls through to a live fetch
  }
  // 3) first-ever read (or unreadable row) → block on the live fetch once, then it's cached forever.
  //    failFast: if the global live-fetch cap is saturated, 503 rather than pile onto the upstream flood (cache hits stay instant).
  const res = await fetchAndStore(tokenAddr, { failFast: true });
  tokenCacheTouch(tokenAddr);
  return res;
}
function tokenCacheGet(tok) { try { return db.prepare('SELECT * FROM token_cache WHERE token_addr=?').get(tok) || null; } catch { return null; } }
// Background loop: keep the MOST-RECENTLY-VIEWED cached tokens fresh from on-chain data, so the popup always shows
// current numbers without a client ever waiting on Dexscreener/Blockscout/RPC. Bounded batch + concurrency; prunes cold rows.
let tokenCacheRefreshing = false;
async function refreshTokenCache() {
  if (tokenCacheRefreshing) return; tokenCacheRefreshing = true;
  try {
    // Prune FIRST (index-only synchronous deletes, independent of the fetch) so table size is enforced every tick even if
    // the refresh batch below stalls on slow upstreams.
    try { db.prepare('DELETE FROM token_cache WHERE last_read_at < ?').run(now() - 7 * 864e5); } catch {}             // drop tokens nobody viewed in a week
    try { db.prepare('DELETE FROM token_cache WHERE found=0 AND updated_at < ?').run(now() - TOKEN_CACHE_NOTFOUND_TTL); } catch {} // drop drive-by negatives (actively-viewed ones keep updated_at fresh)
    try { // cap the total, evicting found=0 junk before any found=1 row; rowid tiebreak so a same-ms burst can't no-op the cap
      const n = db.prepare('SELECT COUNT(*) n FROM token_cache').get().n;
      if (n > TOKEN_CACHE_KEEP) db.prepare('DELETE FROM token_cache WHERE token_addr IN (SELECT token_addr FROM token_cache ORDER BY found DESC, last_read_at DESC, rowid DESC LIMIT -1 OFFSET ?)').run(TOKEN_CACHE_KEEP);
    } catch {}
    // Now refresh the most-recently-viewed stale tokens from on-chain data (bounded batch + concurrency; radar tokens are
    // skipped since the pairs refresher already updates them).
    const liveSet = new Set((pairsCache.pairs || []).map(p => String((p.token && p.token.address) || '').toLowerCase()));
    const stale = db.prepare('SELECT token_addr FROM token_cache WHERE found=1 AND updated_at < ? ORDER BY last_read_at DESC LIMIT ?')
      .all(now() - TOKEN_CACHE_FRESH, TOKEN_CACHE_REFRESH_BATCH * 3)
      .map(r => r.token_addr).filter(t => !liveSet.has(t)).slice(0, TOKEN_CACHE_REFRESH_BATCH);
    if (stale.length) await mapLimit(stale, 4, async (tok) => { try { await fetchAndStore(tok); } catch {} });
  } finally { tokenCacheRefreshing = false; }
}
// Persist every token the radar surfaces, so ANY scanner-surfaced token opens instantly in the popup (even before an
// individual lookup, and after it ages out of the live feed). Called once per radar refresh with the enriched set.
function cacheTokensFromPairs(pairs) {
  for (const p of (pairs || [])) {
    try { const tok = String((p.token && p.token.address) || '').toLowerCase(); if (/^0x[0-9a-f]{40}$/.test(tok)) tokenCachePut(tok, { pair: p }); } catch {}
  }
}
async function _doLookup(tokenAddr) {
  // A quote/reference asset (WETH/USDG) isn't a memecoin to profile — its "pair" data would be the counter-token's.
  if (QUOTE_SET.has(tokenAddr)) return { notFound: true, reason: 'quote' };
  // 1) Dexscreener: prefer the most-liquid pair where this token is the BASE side (its price/FDV describe the base).
  let pairAddr = null, bestLiq = -1, tokenIsBase = false;
  const dexr = await jgetR('https://api.dexscreener.com/tokens/v1/robinhood/' + tokenAddr);
  const arr = dexr.data || [];
  for (const pr of arr) {
    if (!pr || !pr.pairAddress) continue;
    const base = ((pr.baseToken && pr.baseToken.address) || '').toLowerCase();
    const quote = ((pr.quoteToken && pr.quoteToken.address) || '').toLowerCase();
    const isBase = base === tokenAddr, isQuote = quote === tokenAddr;
    if (!isBase && !isQuote) continue;
    const liq = (pr.liquidity && Number(pr.liquidity.usd)) || 0;
    if (isBase && !tokenIsBase) { pairAddr = pr.pairAddress.toLowerCase(); bestLiq = liq; tokenIsBase = true; }        // first base-side pool wins over any quote-side
    else if (isBase === tokenIsBase && liq > bestLiq) { pairAddr = pr.pairAddress.toLowerCase(); bestLiq = liq; }      // else most-liquid on the same side
  }
  /* 2) fallback: ask the factory directly for a token/WETH or token/USDG pool (token is the base there by
     construction). This read is on-chain, so it is independent of Dexscreener — and it is the only one of the
     two that can AUTHORITATIVELY say "there is no pool". "Not found" is a statement about someone's token, so
     it is only made when the chain itself said so. If neither source could be read we say we could not check,
     which is the difference between "this token does not exist" and "ask again in a minute". */
  let factoryErr = null;
  if (!pairAddr) {
    try {
      const fb = (await factoryGetPair(tokenAddr, WETH_ADDR, true)) || (await factoryGetPair(tokenAddr, USDG_ADDR, true));
      if (fb) { pairAddr = fb; tokenIsBase = true; }
    } catch (e) { factoryErr = (e && e.message) || 'chain unreachable'; }
  }
  if (!pairAddr) {
    if (factoryErr) return { unavailable: true, reason: dexr.ok ? factoryErr : (dexr.reason + ', and the chain was unreachable') };
    return { notFound: true };   // the factory answered: there really is no pool
  }
  const { token0, token1 } = await pairTokens(pairAddr);
  const q = (token0 && QUOTE_SET.has(token0)) ? token0 : ((token1 && QUOTE_SET.has(token1)) ? token1 : null);
  const p = await enrichOne(
    { token_addr: tokenAddr, pair_addr: pairAddr, token0, token1, quote_symbol: q ? QUOTE_SYMBOL[q] : '?' },
    { strictPair: true, deployerWindow: pairsCache.pairs }       // exact-pool market data + serial-deployer window from the live feed
  );
  // if this token is only the QUOTE side of its pool, Dexscreener's price/FDV/mcap describe the OTHER token → drop them
  if (!tokenIsBase) { p.market.priceUsd = null; p.market.fdv = null; p.market.marketCap = null; p.brand = brandFromDex(null); p._quoteSide = true; } // enhanced info/branding belongs to the base token, not this quote-side token
  p._lookup = true; // marks a searched token (not necessarily a brand-new pair)
  return { pair: p };
}
function wlSnapshot(r) {
  try { const p = JSON.parse(r.snapshot || 'null'); if (p && p.token) { p._wl = { added_at: r.added_at, source: 'saved' }; return p; } } catch {}
  return { token: { address: r.token_addr, name: 'Saved token', symbol: '?', decimals: 18, isVerified: null, deployer: null, owner: null, renounced: null },
    pair: { address: r.pair_addr, quoteSymbol: r.quote_symbol || '?', createdAt: 0, ageMinutes: null },
    market: { priceUsd: null, liquidityUsd: null, fdv: null, marketCap: null, reserves: null },
    volume: { m5: 0, h1: 0, h6: 0, h24: 0 }, txns: { h1: { buys: 0, sells: 0 }, h6: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } },
    priceChange: { h1: null, h6: null, h24: null }, holders: { count: null, topHolderPct: null, top10Pct: null, top: [] },
    indexed: false, links: { dex: 'https://dexscreener.com/robinhood/' + r.pair_addr, explorer: BLOCKSCOUT + '/token/' + r.token_addr },
    risk: { health: 0, triage: 'caution' }, _wl: { added_at: r.added_at, source: 'saved' } };
}
async function watchlistView(userId) {
  const rows = db.prepare('SELECT * FROM watchlist WHERE user_id=? ORDER BY added_at DESC').all(userId);
  const live = new Map((pairsCache.pairs || []).map(p => [p.pair.address.toLowerCase(), p]));
  const out = []; const toEnrich = [];
  for (const r of rows) {
    const key = r.pair_addr.toLowerCase();
    const lp = live.get(key);
    if (lp) { out.push(Object.assign({}, lp, { _wl: { added_at: r.added_at, source: 'live' } })); continue; }
    const c = wlEnrichCache.get(key);
    if (c && now() - c.t < 60000) { out.push(Object.assign({}, c.pair, { _wl: { added_at: r.added_at, source: 'cached' } })); continue; }
    toEnrich.push(r);
  }
  const budget = toEnrich.slice(0, 20), rest = toEnrich.slice(20); // bound per-request on-demand work
  const fresh = await mapLimit(budget, 4, async (r) => {
    try {
      const p = await enrichOne(r);
      wlEnrichCache.set(r.pair_addr.toLowerCase(), { t: now(), pair: p });
      try { db.prepare('UPDATE watchlist SET snapshot=? WHERE user_id=? AND pair_addr=?').run(JSON.stringify(p), userId, r.pair_addr); } catch {}
      return Object.assign({}, p, { _wl: { added_at: r.added_at, source: 'fresh' } });
    } catch { return wlSnapshot(r); }
  });
  for (const e of fresh) if (e) out.push(e);
  for (const r of rest) out.push(wlSnapshot(r));
  out.sort((a, b) => ((b._wl && b._wl.added_at) || 0) - ((a._wl && a._wl.added_at) || 0));
  return out;
}

const IS_HTTPS = BASE_URL.startsWith('https');
// Behind a trusted reverse proxy that APPENDS the client IP to X-Forwarded-For (nginx's
// $proxy_add_x_forwarded_for, most CDNs), set TRUST_PROXY to the number of proxy hops (1 for a
// single proxy). We then read the client IP from the RIGHT of the header — the hop your proxy
// appended — NEVER the leftmost token, which is fully client-controllable and would otherwise let a
// spoofed X-Forwarded-For defeat rate-limits and the community anti-sybil IP gate.
const TRUST_PROXY_HOPS = /^\d+$/.test(process.env.TRUST_PROXY || '') ? Number(process.env.TRUST_PROXY) : 0;
function clientIp(req) {
  if (TRUST_PROXY_HOPS > 0) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const parts = String(xff).split(',').map(s => s.trim()).filter(Boolean);
      const ip = parts[parts.length - TRUST_PROXY_HOPS]; // the real client is the hop our own proxy appended
      if (ip) return ip;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  ...(IS_HTTPS ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};
// strict CSP for pages: no inline scripts anywhere on this site
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://cdn.dexscreener.com https://dd.dexscreener.com",
  "media-src 'self' blob: data:",
  "connect-src 'self' https://rpc.mainnet.chain.robinhood.com https://robinhoodchain.blockscout.com https://api.dexscreener.com",
  "frame-src https://dexscreener.com",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');
function send(res, code, body, headers = {}) {
  let data = typeof body === 'string' ? body : JSON.stringify(body);
  // API/JSON responses must never be cached (they carry private, per-session data)
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...headers };
  // gzip larger payloads when the client accepts it (big feeds/leaderboards/pairs) → fewer packets, lower latency.
  // res._gzip is set once per request from Accept-Encoding; skip tiny bodies (gzip overhead isn't worth it < ~1KB).
  // Brotli beats gzip by ~7% on JSON and the client already told us it accepts it (res._enc); quality 5 keeps the
  // per-request CPU close to gzip's (the q9 brc() helper is for the one-time static cache, not this path).
  if (res._enc === 'br' && !h['Content-Encoding'] && typeof data === 'string' && Buffer.byteLength(data) > 1024) {
    data = zlib.brotliCompressSync(Buffer.from(data), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
    h['Content-Encoding'] = 'br';
    h['Vary'] = h['Vary'] ? h['Vary'] + ', Accept-Encoding' : 'Accept-Encoding';
  } else if (res._gzip && !h['Content-Encoding'] && typeof data === 'string' && Buffer.byteLength(data) > 1024) {
    data = zlib.gzipSync(data);
    h['Content-Encoding'] = 'gzip';
    h['Vary'] = h['Vary'] ? h['Vary'] + ', Accept-Encoding' : 'Accept-Encoding';
  }
  res.writeHead(code, h);
  res.end(data);
}
const bad = (res, msg, code = 400) => send(res, code, { error: msg });

class HttpError extends Error {
  constructor(msg, code) { super(msg); this.status = code; }
}
function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError('request too large', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch { reject(new HttpError('malformed JSON body', 400)); }
    });
    req.on('error', () => reject(new HttpError('request stream error', 400)));
  });
}

// Bound how many LARGE (media) uploads are buffered+decoded concurrently, so a burst of parallel uploads can't
// balloon RSS / stall the single event loop. Small (text) posts are never gated.
let mediaInFlight = 0;
const MEDIA_CONCURRENCY = 4;
const MEDIA_GATE_BYTES = 400 * 1024;
// Profile media (avatar/header/bg) — intentionally OUTSIDE the upload_bytes quota + orphan sweep: it's bounded to 3
// replaceable slots per user (the old file is unlinked on replace, see /api/profile/image), so it can't grow unbounded.
function saveImage(dataUrl, maxBytes = 2.5 * 1024 * 1024) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw new Error('image too large');
  const magicOk =
    (buf[0] === 0xff && buf[1] === 0xd8) ||
    (buf[0] === 0x89 && buf[1] === 0x50) ||
    (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP');
  if (!magicOk) throw new Error('not an image');
  const name = rand(12) + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return name;
}
const UPLOAD_MAX_PX = 8000;                 // max width/height of a raster (block "pixel-bomb" images that are tiny on disk but gigabytes decoded)
const UPLOAD_MAX_MEGAPIXELS = 33;           // and a total-area cap
const UPLOAD_USER_QUOTA = 1024 * 1024 * 1024; // per-account cumulative stored-media cap (1 GB)
const DISK_SAFETY_MARGIN = 500 * 1024 * 1024; // refuse writes when free space would drop below this (protects app.db on the shared volume from ENOSPC)
// The streaming /api/upload endpoint (raw binary → disk, no base64) lets these caps go far higher than the JSON path
// safely, because the body is never fully buffered/decoded in memory. magic() validates the leading bytes.
const UPLOAD_KINDS = {
  'image/jpeg': { ext: 'jpg', kind: 'image', cap: 20 * 1024 * 1024, magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/png': { ext: 'png', kind: 'image', cap: 20 * 1024 * 1024, magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/webp': { ext: 'webp', kind: 'image', cap: 20 * 1024 * 1024, magic: (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' },
  'image/gif': { ext: 'gif', kind: 'gif', cap: 25 * 1024 * 1024, magic: (b) => b.slice(0, 3).toString('latin1') === 'GIF' },
  'video/mp4': { ext: 'mp4', kind: 'video', cap: 64 * 1024 * 1024, magic: (b) => b.slice(4, 8).toString('latin1') === 'ftyp' },
  'video/webm': { ext: 'webm', kind: 'video', cap: 64 * 1024 * 1024, magic: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
};
// Read the first N bytes of a file (for magic/dimension checks on a streamed upload without loading the whole file).
function readHead(filePath, n) { try { const fd = fs.openSync(filePath, 'r'); try { const b = Buffer.allocUnsafe(n); const read = fs.readSync(fd, b, 0, n, 0); return b.slice(0, read); } finally { fs.closeSync(fd); } } catch { return Buffer.alloc(0); } } // allocUnsafe: we slice to `read`, so the uninitialized tail is never exposed
// Parse a raster's pixel dimensions from its HEADER only (no full decode) — cheap defense against decompression bombs.
function rasterDims(buf, mime) {
  try {
    if (mime === 'image/png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (mime === 'image/gif') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (mime === 'image/jpeg') { // walk the segment markers to the first SOF (frame header carries dimensions)
      let o = 2;
      while (o + 9 < buf.length) {
        if (buf[o] !== 0xff) { o++; continue; }
        const marker = buf[o + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
        o += 2 + buf.readUInt16BE(o + 2);
      }
      return null;
    }
    if (mime === 'image/webp') { // VP8X/VP8/VP8L chunk after the RIFF+WEBP header
      const c = buf.slice(12, 16).toString('latin1');
      if (c === 'VP8X') return { w: (buf.readUIntLE(24, 3) & 0xffffff) + 1, h: (buf.readUIntLE(27, 3) & 0xffffff) + 1 };
      if (c === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (c === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
      return null;
    }
  } catch { return null; }
  return null;
}
// saveMedia: for POST attachments — a static image (jpeg/png/webp), an animated GIF, or a short video (mp4/webm).
// Magic-byte validated so the declared MIME can't lie; size-capped; dimension-capped (anti pixel-bomb); per-user quota + disk guard.
function saveMedia(dataUrl, opts = {}) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif)|video\/(?:mp4|webm));base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('unsupported media — use JPG, PNG, WebP, GIF, MP4 or WebM');
  const mime = m[1];
  const isVideo = mime[0] === 'v';
  const isGif = mime === 'image/gif';
  const max = isVideo ? (opts.maxVideo || 8 * 1024 * 1024) : isGif ? (opts.maxGif || 8 * 1024 * 1024) : (opts.maxImage || 3.5 * 1024 * 1024);
  const tooBig = () => { throw new Error((isVideo ? 'video' : isGif ? 'GIF' : 'image') + ' too large (max ' + Math.round(max / 1048576) + 'MB)'); };
  if (m[2].length * 0.75 > max + 1024) tooBig();                              // reject from the base64 LENGTH before decoding a huge buffer into memory
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > max) tooBig();
  let ext = null;
  if (mime === 'image/jpeg') { if (buf[0] === 0xff && buf[1] === 0xd8) ext = 'jpg'; }
  else if (mime === 'image/png') { if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ext = 'png'; }
  else if (mime === 'image/webp') { if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') ext = 'webp'; }
  else if (mime === 'image/gif') { if (buf.slice(0, 3).toString('latin1') === 'GIF') ext = 'gif'; }
  else if (mime === 'video/mp4') { if (buf.slice(4, 8).toString('latin1') === 'ftyp') ext = 'mp4'; }        // ISO-BMFF: 'ftyp' box at offset 4
  else if (mime === 'video/webm') { if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) ext = 'webm'; } // EBML magic
  if (!ext) throw new Error('corrupt or mislabeled media');
  if (!isVideo) { // anti-decompression-bomb: a tiny-on-disk raster can decode to gigabytes in every viewer's tab
    const d = rasterDims(buf, mime);
    if (!d || !(d.w > 0) || !(d.h > 0)) throw new Error('could not read the image — try re-exporting it');
    if (d.w > UPLOAD_MAX_PX || d.h > UPLOAD_MAX_PX || (d.w * d.h) / 1e6 > UPLOAD_MAX_MEGAPIXELS) throw new Error('image dimensions too large (max ' + UPLOAD_MAX_PX + 'px per side)');
  }
  if (opts.userId != null) { // per-account cumulative quota
    const cur = db.prepare('SELECT upload_bytes u FROM users WHERE id=?').get(opts.userId);
    if (cur && cur.u + buf.length > UPLOAD_USER_QUOTA) throw new Error('you’ve hit your media storage limit — delete some old posts first');
  }
  try { const st = fs.statfsSync(DATA_DIR); if (st.bavail * st.bsize < DISK_SAFETY_MARGIN + buf.length) throw new Error('storage is full right now — try again later'); } catch (e) { if (String(e.message).includes('storage is full')) throw e; } // ignore statfs-unavailable
  const name = rand(12) + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  if (opts.userId != null) db.prepare('UPDATE users SET upload_bytes = upload_bytes + ? WHERE id=?').run(buf.length, opts.userId);
  return name;
}
// delete an upload and (if we know the owner) credit its bytes back to their quota; also drop its tracking row
function deleteUpload(name, ownerId) {
  if (!name) return;
  try {
    if (ownerId != null) { let sz = 0; try { sz = fs.statSync(path.join(UPLOAD_DIR, name)).size; } catch {} if (sz) db.prepare('UPDATE users SET upload_bytes = MAX(upload_bytes - ?, 0) WHERE id=?').run(sz, ownerId); }
    try { db.prepare('DELETE FROM uploads WHERE name=?').run(name); } catch {}
    fs.unlinkSync(path.join(UPLOAD_DIR, name));
  } catch {}
}
// A post's image can be a freshly-uploaded /uploads path (streaming upload — verify ownership + claim it) OR a data: URI
// (small legacy/compressed path — saveMedia). Returns the bare filename to store in posts.image.
function resolvePostMedia(image, userId) {
  if (!image || typeof image !== 'string') return null;
  if (image.startsWith('/uploads/')) {
    const name = image.slice(9);
    if (!/^[0-9a-f]{24}\.(jpg|png|webp|gif|mp4|webm)$/.test(name)) throw new Error('bad media reference');
    const row = db.prepare('SELECT user_id, claimed FROM uploads WHERE name=?').get(name);
    if (!row || row.user_id !== userId) throw new Error('that upload has expired — re-attach your media'); // can only post your OWN upload
    // Atomic single-use claim: an upload backs AT MOST one post. Without the claimed=0 guard the same file could be
    // attached to two posts, and deleting one would unlink the file the other still references.
    const claim = db.prepare('UPDATE uploads SET claimed=1 WHERE name=? AND user_id=? AND claimed=0').run(name, userId);
    if (claim.changes !== 1) throw new Error('that upload was already used — re-attach your media');
    return name;
  }
  return saveMedia(image, { userId }); // data: URI (quota counted inside saveMedia)
}
// Delete uploads that were never attached to a post (upload-then-abandon) so they don't leak disk/quota.
function sweepOrphanUploads() {
  try { for (const o of db.prepare('SELECT name, user_id FROM uploads WHERE claimed=0 AND created_at < ?').all(now() - 30 * 60 * 1000)) deleteUpload(o.name, o.user_id); } catch {}
  // Also reclaim stale tmp_*.part files left by a crash/kill mid-stream (no uploads row → the query above never sees them).
  // Keyed on mtime with a 1h floor so a currently-writing .part is never removed.
  try { const cutoff = Date.now() - 60 * 60 * 1000; for (const f of fs.readdirSync(UPLOAD_DIR)) { if (f.startsWith('tmp_') && f.endsWith('.part')) { const fp = path.join(UPLOAD_DIR, f); try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch {} } } } catch {}
}

function postView(p, me) {
  const counts = { fire: 0, rocket: 0 };
  for (const r of db.prepare('SELECT kind, COUNT(*) n FROM reactions WHERE post_id = ? GROUP BY kind').all(p.id)) counts[r.kind] = r.n;
  const mine = me ? db.prepare('SELECT kind FROM reactions WHERE post_id = ? AND user_id = ?').all(p.id, me.id).map(r => r.kind) : [];
  const cc = db.prepare('SELECT COUNT(*) n FROM comments WHERE post_id = ?').get(p.id).n;
  const author = db.prepare('SELECT username, avatar, avatar_img, accent, og, og_tier FROM users WHERE id = ?').get(p.user_id);
  const myVote = me ? (db.prepare('SELECT value FROM post_votes WHERE post_id = ? AND user_id = ?').get(p.id, me.id) || {}).value || 0 : 0;
  const out = {
    id: p.id, text: p.text, image: p.image ? '/uploads/' + p.image : null, created_at: p.created_at,
    username: author.username, avatar: author.avatar,
    avatar_img: author.avatar_img ? '/uploads/' + author.avatar_img : null,
    accent: author.accent || '', og: author.og_tier || 0,
    reactions: counts, myReactions: mine, comments: cc,
    score: p.score || 0, myVote,
    mine: !!(me && me.id === p.user_id),
    call_id: p.call_id || null,
    private: !!p.private,          // a holders-only community post — the client badges it 🔒
    community: p.community_id ? (postCommunities([p.community_id])[p.community_id] || null) : null,
    tokens: parseTokens(p.tokens), // [{addr,symbol,name}] → the client renders each $TICKER as a token chip
  };
  attachCalls([out], me); // if this post is a Send Call, attach its live widget data
  return out;
}
// Batched postView for a LIST of posts — collapses ~5 queries/post (≈150 for a 30-post feed) into ~5 total
// via `IN (...)` aggregates. Output is byte-identical in shape to postView() so the front end is untouched.
function postsView(rows, me) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const ph = ids.map(() => '?').join(',');
  const rc = {}; // post_id -> { fire, rocket }
  for (const r of db.prepare(`SELECT post_id, kind, COUNT(*) n FROM reactions WHERE post_id IN (${ph}) GROUP BY post_id, kind`).all(...ids)) (rc[r.post_id] || (rc[r.post_id] = {}))[r.kind] = r.n;
  const cc = {}; // post_id -> comment count
  for (const r of db.prepare(`SELECT post_id, COUNT(*) n FROM comments WHERE post_id IN (${ph}) GROUP BY post_id`).all(...ids)) cc[r.post_id] = r.n;
  const comms = postCommunities(rows.map(r => r.community_id));   // one lookup for the page, not one per post
  const authorIds = [...new Set(rows.map(r => r.user_id))];
  const authors = {};
  for (const a of db.prepare(`SELECT id, username, avatar, avatar_img, accent, og, og_tier FROM users WHERE id IN (${authorIds.map(() => '?').join(',')})`).all(...authorIds)) authors[a.id] = a;
  const myR = {}, myV = {};
  if (me) {
    for (const r of db.prepare(`SELECT post_id, kind FROM reactions WHERE post_id IN (${ph}) AND user_id = ?`).all(...ids, me.id)) (myR[r.post_id] || (myR[r.post_id] = [])).push(r.kind);
    for (const r of db.prepare(`SELECT post_id, value FROM post_votes WHERE post_id IN (${ph}) AND user_id = ?`).all(...ids, me.id)) myV[r.post_id] = r.value;
  }
  const out = rows.map(p => {
    const a = authors[p.user_id] || { username: '?', avatar: '🚀', avatar_img: null, accent: '', og: 0 };
    return {
      id: p.id, text: p.text, image: p.image ? '/uploads/' + p.image : null, created_at: p.created_at,
      username: a.username, avatar: a.avatar,
      avatar_img: a.avatar_img ? '/uploads/' + a.avatar_img : null,
      accent: a.accent || '', og: a.og_tier || 0,
      reactions: { fire: (rc[p.id] && rc[p.id].fire) || 0, rocket: (rc[p.id] && rc[p.id].rocket) || 0 },
      myReactions: myR[p.id] || [], comments: cc[p.id] || 0,
      score: p.score || 0, myVote: myV[p.id] || 0,
      mine: !!(me && me.id === p.user_id),
      call_id: p.call_id || null,
      private: !!p.private,          // a holders-only community post — the client badges it 🔒
      community: p.community_id ? (comms[p.community_id] || null) : null,
      tokens: parseTokens(p.tokens), // $TICKER chips in feeds too, not just single-post views
    };
  });
  attachCalls(out, me); // batch-attach Send Call widgets for any call posts in this feed
  return out;
}

/* ---------- OAuth (env-gated) ---------- */
const OAUTH = {
  google: {
    id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email',
  },
  facebook: {
    id: process.env.FACEBOOK_CLIENT_ID, secret: process.env.FACEBOOK_CLIENT_SECRET,
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userUrl: 'https://graph.facebook.com/me?fields=id,email',
    scope: 'email',
  },
  // X (Twitter) OAuth 2.0 — requires PKCE + HTTP Basic auth on the token exchange; user id is at data.id.
  // X does not return an email via OAuth2, so accounts are keyed by the stable X user id.
  x: {
    id: process.env.X_CLIENT_ID, secret: process.env.X_CLIENT_SECRET,
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    userUrl: 'https://api.twitter.com/2/users/me',
    scope: 'users.read tweet.read', pkce: true, basicAuth: true, subPath: 'data.id',
  },
  // Instagram Login (Meta) — Basic Display was deprecated (Dec 2024); this uses the current Instagram
  // Login API (needs an IG business/creator account + Meta app). No email; keyed by the IG user id.
  instagram: {
    id: process.env.INSTAGRAM_CLIENT_ID, secret: process.env.INSTAGRAM_CLIENT_SECRET,
    authUrl: 'https://www.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    userUrl: 'https://graph.instagram.com/me?fields=id,username',
    scope: 'instagram_business_basic', accessTokenQuery: true, subField: 'id',
  },
};
const csrfWarned = new Set();   // one CSRF-reject log line per offending origin, not one per request
/* Boards that live in the posts table alongside the Send Wall. Allowlisted, never interpolated from raw
   input — the value reaches SQL, so the set IS the validation. */
const BOARDS = new Set(['support']);
const oauthStates = new Map();
const pendingLogins = new Map(); // token -> {userId, expires}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const CLEAR_OAUTH_STATE = 'oauth_state=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0';

async function oauthCallback(provider, code, verifier, res) {
  const p = OAUTH[provider];
  const redirect = `${BASE_URL}/api/auth/${provider}/callback`;
  // token exchange — Basic-auth clients (X) send credentials in the header + PKCE verifier in the body;
  // classic clients (Google/Facebook/Instagram) send client_secret in the body.
  const body = new URLSearchParams({ client_id: p.id, code, grant_type: 'authorization_code', redirect_uri: redirect });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (p.pkce && verifier) body.set('code_verifier', verifier);
  if (p.basicAuth) headers.Authorization = 'Basic ' + Buffer.from(p.id + ':' + p.secret).toString('base64');
  else body.set('client_secret', p.secret);
  const tok = await (await fetch(p.tokenUrl, { method: 'POST', headers, body })).json();
  const accessToken = tok.access_token || (tok.data && tok.data[0] && tok.data[0].access_token);
  if (!accessToken) throw new Error('oauth token exchange failed');
  // userinfo — Instagram takes ?access_token=; the rest take a Bearer header
  const info = p.accessTokenQuery
    ? await (await fetch(p.userUrl + (p.userUrl.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(accessToken))).json()
    : await (await fetch(p.userUrl, { headers: { Authorization: 'Bearer ' + accessToken } })).json();
  // stable subject id (X nests it under data; others are flat)
  let sub = p.subPath === 'data.id' ? (info && info.data && info.data.id) : (info[p.subField || 'sub'] || info.sub || info.id);
  sub = String(sub || '');
  if (!sub || sub === 'undefined') throw new Error('no oauth subject');
  let ident = findIdentity(provider, sub);
  let userId;
  if (ident) userId = ident.user_id;
  else {
    userId = createUser(autoUsername(), true);
    insertIdentity(userId, provider, sub);
  }
  /* Two-factor has to gate THIS door too. Until now a session cookie was issued here the moment the provider
     said who you were, so an account that had switched 2FA on — and whose profile said "Two-factor is
     protecting this account" — could be opened by anyone who got into its Google/X/Facebook/Instagram
     account, second factor never asked for. A factor with an unguarded side entrance is not a factor.
     Only an EXISTING identity is challenged: an account being created right here has no factor yet.
     The pending token rides in a short-lived HttpOnly cookie rather than the redirect URL, so it never
     lands in browser history, a referrer header, or a screenshot of the address bar. */
  const u2 = db.prepare('SELECT twofa_method FROM users WHERE id = ?').get(userId);
  if (ident && u2 && u2.twofa_method) {
    const pend = rand(16);
    const entry = { userId, expires: now() + 3e5 };
    if (u2.twofa_method === 'wallet') {
      entry.messages = {};
      for (const w of walletAddresses(userId)) entry.messages[w] = signInMessage(w, pend, 'Two-factor confirmation for JustSendIt. This signature never moves funds and grants no token approvals.');
    }
    pendingLogins.set(pend, entry);
    res.writeHead(302, {
      'Set-Cookie': [`oauth_2fa=${pend}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=300${cookieSecure()}`, CLEAR_OAUTH_STATE],
      Location: '/?twofa=1',
    });
    return res.end();
  }
  const token = createSession(userId);
  res.writeHead(302, { 'Set-Cookie': [sessionCookie(token), CLEAR_OAUTH_STATE], Location: '/profile.html' });
  res.end();
}

/* ---------- static ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
  '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json', // in COMPRESSIBLE/ASSET_REF → must have a real type (nosniff would block octet-stream)
};
// In-memory static cache: small assets are read + (for text) gzipped ONCE, keyed by path+size+mtime, and then
// served straight from RAM — repeat requests do zero fs reads and zero per-request gzip. It self-refreshes when a
// file changes on disk (size/mtime differ) and is bounded in total bytes. Big/binary files (media, large uploads)
// are never held in RAM — they stream from disk and keep full range-request support.
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.xml', '.webmanifest']);
const STATIC_CACHE = new Map();                    // filePath -> { size, mtimeMs, buf, gz, br }
const STATIC_MAX_FILE = 2 * 1024 * 1024;           // never cache a file bigger than 2 MB
const STATIC_MAX_TOTAL = 96 * 1024 * 1024;         // total RAM budget for the cache
let staticBytes = 0;
const brc = (buf) => zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }); // one-time, so a high quality is fine
const entryBytes = (e) => e.buf.length + (e.gz ? e.gz.length : 0) + (e.br ? e.br.length : 0);
function staticEntry(filePath, ext, st) {
  let e = STATIC_CACHE.get(filePath);
  if (e && e.size === st.size && e.mtimeMs === st.mtimeMs) return e;   // fresh hit
  let buf; try { buf = fs.readFileSync(filePath); } catch { return null; }
  if ((ext === '.xml' || ext === '.txt') && buf.includes(SITE_PLACEHOLDER)) buf = Buffer.from(swapOrigin(buf.toString('utf8'))); // sitemap.xml / robots.txt → real origin (BASE_URL is per-process, so cache-fill substitution is safe)
  const compress = COMPRESSIBLE.has(ext) && ext !== '.html';           // HTML is version-rewritten + compressed per request
  const gz = compress ? zlib.gzipSync(buf, { level: 6 }) : null;
  const br = compress ? brc(buf) : null;
  if (e) staticBytes -= entryBytes(e);                                 // replacing a changed file
  e = { size: st.size, mtimeMs: st.mtimeMs, buf, gz, br };
  STATIC_CACHE.set(filePath, e);
  staticBytes += entryBytes(e);
  while (staticBytes > STATIC_MAX_TOTAL && STATIC_CACHE.size > 1) {     // evict oldest until under budget
    const k = STATIC_CACHE.keys().next().value; if (k === filePath) break;
    const old = STATIC_CACHE.get(k); staticBytes -= entryBytes(old); STATIC_CACHE.delete(k);
  }
  return e;
}
// Build-free asset versioning: a short content-fingerprint (size+mtime) per public file, so HTML asset refs can carry
// ?v=<ver> and be cached IMMUTABLY (forever) yet bust the moment the file changes on a deploy.
const assetVerCache = new Map();                   // relPath -> { ver, at }
function assetVer(rel) {
  const c = assetVerCache.get(rel);
  if (c && Date.now() - c.at < 3000) return c.ver;  // throttle re-stats to avoid a stat storm on the hot path
  let ver = null;
  try { const st = fs.statSync(path.join(PUBLIC_DIR, rel)); ver = (st.size.toString(36) + '-' + Math.round(st.mtimeMs).toString(36)); } catch {}
  assetVerCache.set(rel, { ver, at: Date.now() });
  return ver;
}
// The `[^"?#:]+` naturally skips absolute URLs (the ':' in https:), data:/blob:, and refs that already have a ?query/#hash.
const ASSET_REF = /(\s(?:src|href)=")([^"?#:]+\.(?:js|mjs|css|png|jpe?g|webp|svg|ico|gif|woff2?|mp4|m4v|webm|mov|m4a|mp3|ogg|wav))(")/g;
// Absolute SEO/share URLs (canonical, og:*, twitter:*, JSON-LD, sitemap, robots) are authored against a placeholder
// origin and swapped for the real BASE_URL at serve time — so a deploy never ships a non-resolving og:image.
const SITE_PLACEHOLDER = 'https://justsendit.example';
const SITE_ORIGIN = BASE_URL.replace(/\/+$/, '');
const swapOrigin = (s) => s.split(SITE_PLACEHOLDER).join(SITE_ORIGIN);
function rewriteHtml(buf) {
  return swapOrigin(buf.toString('utf8')).replace(ASSET_REF, (m, pre, url, post) => {
    const ver = assetVer(url.replace(/^\//, ''));   // 'app.js' / '/styles.css' → public-relative path
    return ver ? pre + url + '?v=' + ver + post : m;
  });
}
// A real, branded HTML 404 for unknown PAGE urls (API 404s stay JSON) — a newcomer who mistypes a link gets a way home,
// not a raw {"error":"not found"} blob.
function notFoundPage(res) {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found — $Send</title>' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0e14;color:#e8eefc;font:16px/1.5 Rubik,system-ui,sans-serif;text-align:center;padding:2rem}h1{font-size:2.2rem;margin:0 0 .4rem;color:#b4ff2b}p{color:#aab6cf;margin:0 0 1.2rem}a{display:inline-block;padding:.8rem 1.6rem;border-radius:999px;background:linear-gradient(180deg,#b4ff2b,#5c9a00);color:#12200a;font-weight:800;text-decoration:none}</style></head>' +
    '<body><main><h1>🚀 That page didn’t send.</h1><p>We couldn’t find what you were looking for.</p><a href="/">Back to $Send home →</a></main></body></html>';
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...SEC_HEADERS, 'Content-Security-Policy': CSP, 'Content-Length': Buffer.byteLength(html) });
  res.end(html);
}
function serveFile(req, res, filePath, extraHeaders = {}) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { notFoundPage(res); return; }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';

    // ---- HTML: rewrite asset refs to versioned URLs, ETag from the REWRITTEN bytes (so a changed asset busts the
    // page), compress per request. Kept revalidate-always so a deploy is picked up on the next navigation. ----
    if (ext === '.html') {
      const e = staticEntry(filePath, ext, st);
      if (!e) { notFoundPage(res); return; }
      const html = Buffer.from(rewriteHtml(e.buf), 'utf8');
      const etag = '"' + crypto.createHash('sha1').update(html).digest('base64url').slice(0, 20) + '"';
      const head = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'ETag': etag, 'Vary': 'Accept-Encoding', ...SEC_HEADERS, 'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY', ...extraHeaders };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return; }
      // Compress ONCE per version and cache it on the entry (keyed by the ETag, which already changes when the file OR
      // any referenced asset's version changes). Brotli-q9 is ~2.5ms/call — recomputing it per request let an
      // unauthenticated flood pin the single event-loop thread; the memo makes the hot path a cache hit.
      let body = html;
      if (res._enc === 'br') { if (!e._brC || e._brC.etag !== etag) e._brC = { etag, buf: brc(html) }; body = e._brC.buf; head['Content-Encoding'] = 'br'; }
      else if (res._gzip) { if (!e._gzC || e._gzC.etag !== etag) e._gzC = { etag, buf: zlib.gzipSync(html) }; body = e._gzC.buf; head['Content-Encoding'] = 'gzip'; }
      head['Content-Length'] = body.length;
      res.writeHead(200, head); res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }

    // A versioned asset request is immutable ONLY when its ?v= matches the file's CURRENT version — so a stale/forged
    // ?v (or an unrelated ?utm=… tracking query) is never frozen for a year; it falls through to revalidate instead.
    // (This is the big returning-visitor win. /uploads forces immutable via extraHeaders — content-addressed names.)
    const vm = /[?&]v=([^&]*)/.exec(req.url);
    const immutable = !!(vm && filePath.startsWith(PUBLIC_DIR + path.sep) && vm[1] === assetVer(path.relative(PUBLIC_DIR, filePath)));
    // sitemap.xml / robots.txt are served with the placeholder origin swapped for BASE_URL (staticEntry), so their bytes
    // depend on BASE_URL too: fold it into the validator, skip the mtime-only shortcut, and never serve them by range
    const swapped = ext === '.xml' || ext === '.txt';
    const etag = 'W/"' + st.size.toString(16) + '-' + Math.round(st.mtimeMs).toString(16) + (swapped ? '-' + crypto.createHash('sha1').update(SITE_ORIGIN).digest('hex').slice(0, 8) : '') + '"';
    const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', 'Last-Modified': st.mtime.toUTCString(), 'ETag': etag, ...SEC_HEADERS, ...extraHeaders };
    delete head['X-Frame-Options']; // allow same-origin embedding of media in our own pages
    if (COMPRESSIBLE.has(ext)) head['Vary'] = 'Accept-Encoding'; // set BEFORE the 304 so 200 and 304 advertise the same metadata
    const inm = req.headers['if-none-match'];
    const ims = req.headers['if-modified-since'];
    if ((inm && inm === etag) || (!inm && !swapped && ims && Date.parse(ims) >= Math.floor(st.mtimeMs / 1000) * 1000)) {
      res.writeHead(304, head); res.end(); return;
    }
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    // If-Range: only honor the partial request when the client's validator still matches this file;
    // otherwise fall through to a full 200 so a resumed download can't stitch new bytes onto a stale prefix.
    const ifRange = req.headers['if-range'];
    let doRange = !swapped && !!(range && (range[1] || range[2])); // substituted files must come from the cache, not the raw disk bytes
    if (doRange && ifRange) {
      const isTag = ifRange.startsWith('"') || ifRange.startsWith('W/');
      if (isTag ? ifRange !== etag : !(Date.parse(ifRange) >= Math.floor(st.mtimeMs / 1000) * 1000)) doRange = false;
    }
    if (doRange) {
      let start, end;
      if (range[1] === '' && range[2] !== '') {                    // suffix range "bytes=-N" → the LAST N bytes
        const n = parseInt(range[2]);
        if (isNaN(n) || n <= 0) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
        start = Math.max(0, st.size - n); end = st.size - 1;
      } else {
        start = range[1] ? parseInt(range[1]) : 0;
        end = range[2] ? Math.min(parseInt(range[2]), st.size - 1) : st.size - 1; // clamp overshoot instead of 416ing
      }
      if (isNaN(start) || isNaN(end) || start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, { ...head, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}` });
      if (req.method === 'HEAD') { res.end(); return; }
      const rs = fs.createReadStream(filePath, { start, end });
      res.on('close', () => rs.destroy());                         // client aborted → tear down the read stream (no fd leak)
      rs.on('error', () => res.destroyed || res.destroy());
      rs.pipe(res);
      return;
    }
    // full GET: serve small files from the in-memory cache (Brotli > gzip for text when the client accepts it); stream the rest
    if (st.size <= STATIC_MAX_FILE) {
      const e = staticEntry(filePath, ext, st);
      if (e) {
        if (e.br && res._enc === 'br') { res.writeHead(200, { ...head, 'Content-Encoding': 'br', 'Content-Length': e.br.length }); res.end(req.method === 'HEAD' ? undefined : e.br); }
        else if (e.gz && res._gzip) { res.writeHead(200, { ...head, 'Content-Encoding': 'gzip', 'Content-Length': e.gz.length }); res.end(req.method === 'HEAD' ? undefined : e.gz); }
        else { res.writeHead(200, { ...head, 'Content-Length': e.buf.length }); res.end(req.method === 'HEAD' ? undefined : e.buf); }
        return;
      }
    }
    res.writeHead(200, { ...head, 'Content-Length': st.size });
    if (req.method === 'HEAD') { res.end(); return; }
    const rs = fs.createReadStream(filePath);
    res.on('close', () => rs.destroy());                           // free the fd if the client disconnects mid-download
    rs.on('error', () => res.destroyed || res.destroy());
    rs.pipe(res);
  });
}

/* ===== Biggest Sender — the weekly competition and its game master ==================================
   A fresh race every ISO week (Monday 00:00 UTC, the same weekWindow() the community board runs on).
   Standings are what you EARNED inside the week: SUM(comp_amount), each award taken at what it would
   have paid without a previous week's prize. Taking the prize back out is the fairness mechanism —
   last week's winners race on the same footing as everyone else, so the prize pays their level and the
   all-time board but can never buy the next placing. When the week ends the game master settles it on
   its own: the top WEEK_WINNERS each take a rung of the WEEK_PRIZES ladder by finishing rank — #1 the
   largest, #10 the smallest, recorded in the competitions row — that adds on top of everything they earn
   for the whole of the following week, then the next week opens. It runs from a timer, so it settles whether or not anyone
   visits, and it only ever settles a week it recorded as open — the deploy week is the first race, and
   nothing is retro-paid from history. */
const WEEK_WINNERS = 10;
// The prize ladder, by finishing rank: #1 draws the top of it, #10 the bottom. Tied ranks share a rung.
// The top rung equals ARCADE_BOOST_MAX, so no weekly prize outruns the stack's other bonuses.
const WEEK_PRIZES = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.75, 1.5, 1.25];
let compCache = { at: 0, key: null, rows: null };
const COMP_TTL = 8000;
// every account's earned-inside-the-window total, ranked; any prize's share already taken out
function competitionRows(win) {
  return db.prepare(`SELECT u.id, u.username, u.avatar, u.avatar_img, u.accent, u.og_tier,
      SUM(e.base) pts, COUNT(*) n                              -- BASE points: what you did, with every boost (holder, OG, community, arcade, prize) taken out, so the race is proof of work, not a holdings contest
    FROM points_events e JOIN users u ON u.id = e.user_id
    WHERE e.created_at >= ? AND e.created_at < ? AND u.system = 0
      AND e.kind NOT IN ('commxp','convxp','commact')          -- community XP is not Send Power and never scores here
    GROUP BY e.user_id HAVING pts > 0 ORDER BY pts DESC, u.id ASC`).all(win.startsAt, win.endsAt)
    .map((r, i, arr) => { // competition ranking: ties share a rank, as the all-time board does
      let rank = i + 1; while (rank > 1 && arr[rank - 2].pts === r.pts) rank--;
      return { ...r, rank };
    });
}
function competitionStandings() {
  const win = weekWindow();
  if (compCache.rows && compCache.key === win.key && now() - compCache.at < COMP_TTL) return { win, rows: compCache.rows };
  const rows = competitionRows(win);
  compCache = { at: now(), key: win.key, rows };
  return { win, rows };
}
function weekBoostState(userId) {
  const u = db.prepare('SELECT week_boost, week_boost_until, week_boost_key FROM users WHERE id = ?').get(userId) || {};
  const active = !!(u.week_boost > 1 && u.week_boost_until > now());
  return active ? { boost: u.week_boost, until: u.week_boost_until, wonIn: u.week_boost_key } : null;
}
function ensureCompetitionRow() {
  const w = weekWindow();
  db.prepare("INSERT OR IGNORE INTO competitions (week_key, starts_at, ends_at, status) VALUES (?,?,?,'open')").run(w.key, w.startsAt, w.endsAt);
}
let compSettling = false;
function settleCompetitions() {
  if (compSettling) return; compSettling = true;
  try {
    const due = db.prepare("SELECT * FROM competitions WHERE status = 'open' AND ends_at <= ? ORDER BY ends_at ASC").all(now());
    for (const c of due) {
      const rows = competitionRows({ startsAt: c.starts_at, endsAt: c.ends_at });
      // by RANK, not by list position: everyone whose shared rank is inside the prize places is paid, so two
      // people tied at #10 both get the #10 rung (a positional cut paid only the lower user id while the
      // board told both of them they were inside the prize places)
      // ten prizes, by position: the board is ordered by points then by account age (u.id ASC), so a tie at the edge
      // goes to whoever joined first — a rank predicate alone paid every identical score, without limit
      const winners = rows.filter(r => r.rank <= WEEK_WINNERS).slice(0, WEEK_WINNERS).map(r => ({
        user_id: r.id, username: r.username, rank: r.rank, points: r.pts,
        boost: WEEK_PRIZES[Math.min(r.rank, WEEK_PRIZES.length) - 1],   // by rank, descending — tied ranks share a rung; recorded below
      }));
      // The prize covers the week after the one won. If the server was down long enough that that week has
      // already passed, it covers the rest of the current week instead — a prize must never be paid already
      // expired while the notification and the board say otherwise.
      const until = Math.max(c.ends_at + 7 * 864e5, weekWindow().endsAt);
      const untilTxt = new Date(until).toUTCString().slice(0, 16) + ' 00:00 UTC';
      db.exec('BEGIN');
      try {
        for (const w of winners) db.prepare('UPDATE users SET week_boost = ?, week_boost_until = ?, week_boost_key = ? WHERE id = ?').run(w.boost, until, c.week_key, w.user_id);
        db.prepare("UPDATE competitions SET status = 'settled', settled_at = ?, winners = ? WHERE week_key = ? AND status = 'open'").run(now(), JSON.stringify(winners), c.week_key);
        // inside the transaction, so a crash can never pay a prize without telling its winner
        for (const w of winners) {
          notify(w.user_id, '🏆', 'Biggest Sender: you finished #' + w.rank + ' this week with ' + Number(w.points).toLocaleString('en-US') +
            ' Send Power. Your prize: a ' + w.boost + '× Send Power boost added on top of everything you earn until ' + untilTxt + '. The board has reset — the race is on again. 🚀', 'points');
        }
        db.exec('COMMIT');
      } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
      console.log('🏆 Biggest Sender ' + c.week_key + ' settled: ' + winners.length + ' winner(s)');
    }
    ensureCompetitionRow();
  } catch (e) { console.error('settleCompetitions', e); }
  finally { compSettling = false; }
}
function lastSettledCompetition() {
  const c = db.prepare("SELECT week_key, starts_at, ends_at, settled_at, winners FROM competitions WHERE status = 'settled' ORDER BY ends_at DESC LIMIT 1").get();
  if (!c) return null;
  let winners = []; try { winners = JSON.parse(c.winners || '[]'); } catch {}
  // usernames can change; resolve fresh, and carry the avatar so the board can draw the row
  const users = {}; for (const u of db.prepare(`SELECT id, username, avatar, avatar_img, accent, og_tier FROM users WHERE id IN (${winners.map(() => '?').join(',') || 'NULL'})`).all(...winners.map(w => w.user_id))) users[u.id] = u;
  return { key: c.week_key, startsAt: c.starts_at, endsAt: c.ends_at, settledAt: c.settled_at,
    winners: winners.map(w => { const u = users[w.user_id]; return { rank: w.rank, points: w.points, boost: w.boost,
      username: u ? u.username : w.username, avatar: u ? u.avatar : '🚀', avatar_img: u && u.avatar_img ? '/uploads/' + u.avatar_img : null, accent: u ? (u.accent || '') : '', og: u ? (u.og_tier || 0) : 0 }; }) };
}
/* ===== Arcade hub: every competition on the site in one read =========================================
   The public half (boards, clocks, prizes, today's Rocket Run aggregates) is identical for everyone and
   cached for HUB_TTL; the per-user blocks (your rank, your boosts, your flight) are computed fresh per
   request. Nothing here is typed in — every prize, window and date is the constant the game master pays. */
let hubCache = { at: 0, val: null };
const HUB_TTL = 8000;
function nextUtcMidnight(t) { const d = new Date(t == null ? now() : t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); }
function competitionsPublic() {
  const { win, rows } = competitionStandings();
  const view = r => ({ rank: r.rank, username: r.username, avatar: r.avatar, avatar_img: r.avatar_img ? '/uploads/' + r.avatar_img : null, accent: r.accent || '', og: r.og_tier || 0, points: r.pts, actions: r.n });
  maybeRefreshCalls();
  const calls = callLeaderboard('week');
  const w = weekWindow();
  const comms = db.prepare("SELECT * FROM communities WHERE status='live' AND week_key = ? AND xp_week > 0 ORDER BY xp_week DESC, member_count DESC, id ASC LIMIT 5").all(w.key);
  const day = ymd(), t = now();
  // today's Rocket Run, in aggregate only: counts and the best cash-out, never who flew
  const rr = db.prepare('SELECT COUNT(*) flights, SUM(CASE WHEN cashed_x IS NOT NULL THEN 1 ELSE 0 END) cashed, MAX(cashed_x) bestX, MAX(boost) bestBoost FROM arcade_rounds WHERE day = ?').get(day) || {};
  const boosted = db.prepare('SELECT COUNT(*) n FROM users WHERE arcade_boost > 1 AND arcade_boost_until > ?').get(t).n;
  const og = ogCampaign();
  return {
    biggestSender: { week: { key: win.key, startsAt: win.startsAt, endsAt: win.endsAt }, top: rows.filter(r => r.rank <= WEEK_WINNERS).slice(0, WEEK_WINNERS).map(view), entrants: rows.length, // exactly what the payout pays: ten places, ties to the older account
      last: lastSettledCompetition(), prize: { winners: WEEK_WINNERS, ladder: WEEK_PRIZES, lastsDays: 7, byRank: true, tiesTo: 'joined first', excludedFromStandings: true, rankedBy: 'base' } },
    sendCalls: { window: 'week', top: calls.slice(0, 10), entrants: calls.length, cap: CALL_X_CAP, minLiq: MIN_CALL_LIQ, all: calls },
    communities: { week: w, board: comms.map((c, i) => { const b = commBrand(c); return { id: c.id, symbol: c.symbol, name: c.name, image: b.imageUrl || null, rank: i + 1, xpWeek: c.xp_week, memberCount: c.member_count, level: levelForXp(c.xp), official: !!c.official, demo: !!c.demo }; }) },
    og: { ...og, tierNowName: OG_TIER_NAME[og.tierNow] || '' },
    rocketRun: { day, resetsAt: nextUtcMidnight(t), flightsToday: rr.flights || 0, cashedToday: rr.cashed || 0, bestXToday: rr.bestX == null ? null : Math.round(rr.bestX * 100) / 100, bestBoostToday: rr.bestBoost == null ? null : Math.round(rr.bestBoost * 100) / 100,
      boostedNow: boosted, growth: ARCADE_GROWTH, maxX: ARCADE_MAX_X, maxBoost: ARCADE_BOOST_MAX },
    allTime: { top: allTimeTop().slice(0, 10) },
  };
}
/* ===== Data API — the one sanctioned door to bulk data, behind a burn ================================
   A key is minted only for an account whose LINKED wallets have, between them, sent at least
   DATA_BURN_USD worth of $SEND to the burn address — read on-chain with the same fail-closed walker
   the OG scan uses, and valued at the $SEND price at the moment of minting (a burn is irreversible;
   the price is what it is that day). The key is shown once and stored only as a hash, exactly like a
   session cookie. What it opens: every PUBLIC surface of the site in bulk, structured form, and the
   key holder's OWN private data. What it never opens: anyone else's private fields — emails, linked
   wallets, 2FA, tracked wallets, preferences. Those are encrypted so nobody but their owner can read
   them, and a burn does not change whose data it is. */
const DATA_BURN_ADDR = '0x000000000000000000000000000000000000dead';
const DATA_BURN_USD = 1000;
const DATA_KEY_LIFE_MS = 365 * 864e5;      // a burn-backed key lives a year; renewing adds a year
// OG discounts on the burn: Gold is free forever, Silver pays half, Bronze pays three quarters
const DATA_TIER_DISCOUNT = { 3: 1, 2: 0.5, 1: 0.25, 0: 0 };
function dataThresholdFor(u) {
  const tier = (u && u.og && u.og_tier) || 0;          // an OG discount needs the badge to be LIVE, not just once earned
  const off = DATA_TIER_DISCOUNT[tier] || 0;
  return { tier, tierName: OG_TIER_NAME[tier] || '', discountPct: Math.round(off * 100), free: off >= 1, usd: Math.round(DATA_BURN_USD * (1 - off) * 100) / 100 };
}
// Pure: what each wallet still has unspent, given what earlier keys already consumed from it.
function applyConsumption(byWallet, consumedByIdx) {
  return byWallet.map(w => { const spent = consumedByIdx[w.idx] || 0n; const avail = w.wei > spent ? w.wei - spent : 0n; return { ...w, spent, available: avail }; });
}
// Pure: the wei a mint will spend for `usd` at `priceUsd` — rounded UP to the next micro-token, so a key can never
// be under-paid. Eligibility and the mint gate on THIS number, so the page never says "eligible" for a mint that refuses.
const needWeiFor = (usd, priceUsd) => BigInt(Math.ceil(usd / priceUsd * 1e6)) * 10n ** 12n;
// Pure: spend `needWei` across wallets, largest unspent first. Returns the allocation, or null if short.
function allocateBurn(byWallet, needWei) {
  const alloc = []; let left = needWei;
  for (const w of [...byWallet].sort((x, y) => (y.available > x.available ? 1 : y.available < x.available ? -1 : 0))) {
    if (left <= 0n) break;
    const take = w.available < left ? w.available : left;
    if (take > 0n) { alloc.push({ idx: w.idx, wei: take }); left -= take; }
  }
  return left > 0n ? null : alloc;
}
// Pure: a renewal adds a year to a still-live expiry; a fresh mint (or a lapsed one) starts the year now.
const nextExpiry = (prevExpiresAt, t) => (prevExpiresAt && prevExpiresAt > t ? prevExpiresAt : t) + DATA_KEY_LIFE_MS;
const DATA_KEY_RATE = 120;                 // requests per minute, per key
const DATA_PAGE_MAX = 200;
const DATA_BURN_TTL = 5 * 60 * 1000;
const burnCache = new Map();               // userId -> { at, val }
const _minting = new Set();                // accounts with a mint in flight
const burnBump = new Map();                // userId -> when their unspent balance last changed (a read that started earlier must not be cached)
// Every $SEND transfer from any linked wallet to the burn address, summed. Throws (never guesses) when
// the chain cannot be read completely — the OG walker's own rule.
async function burnedSend(userId, fresh) {
  const hit = burnCache.get(userId);
  if (!fresh && hit && now() - hit.at < DATA_BURN_TTL) return hit.val;
  const startedAt = now();
  const wallets = walletAddresses(userId).slice(0, MAX_LINKED_WALLETS);
  let wei = 0n, topWallet = null, topWei = -1n; const byWallet = [];
  const idxs = wallets.map(w => bidx(w.toLowerCase()));
  const consumedByIdx = {};
  if (idxs.length) for (const r of db.prepare(`SELECT wallet_idx, wei FROM api_key_burns WHERE wallet_idx IN (${idxs.map(() => '?').join(',')})`).all(...idxs)) consumedByIdx[r.wallet_idx] = (consumedByIdx[r.wallet_idx] || 0n) + BigInt(r.wei);
  for (const w of wallets) {
    // a person is waiting on this one, and the explorer's throttle was measured at ~45s: 3, 6, 12, 24, 48s
    // of backoff outlasts it, where the background sweep's short schedule would just report "try again"
    const rows = await ogTransfers(w, TOK.SEND, { tries: 6, backoffMs: 3000 });
    const wl = w.toLowerCase(); let ww = 0n, txs = 0;
    for (const r of rows) {
      const from = ((r.from && r.from.hash) || '').toLowerCase(), to = ((r.to && r.to.hash) || '').toLowerCase();
      if (from === wl && to === DATA_BURN_ADDR && r.total && r.total.value != null) { ww += BigInt(r.total.value); txs++; }
    }
    byWallet.push({ wallet: w, idx: bidx(wl), wei: ww, tokens: Number(ww) / 1e18, txs });
    wei += ww; if (ww > topWei) { topWei = ww; topWallet = w; }
  }
  const spent = applyConsumption(byWallet, consumedByIdx);
  const availableWei = spent.reduce((t, w) => t + w.available, 0n);
  const priceUsd = await sendPriceUsd();                    // null when unknown → usd null → not eligible, never "0 burned"
  const tokens = Number(wei) / 1e18;
  const availableTokens = Number(availableWei) / 1e18;
  const val = { wallets: wallets.length, byWallet: spent.map(w => ({ wallet: w.wallet, idx: w.idx, wei: w.wei.toString(), available: w.available.toString(), tokens: w.tokens, spentTokens: Number(w.spent) / 1e18, txs: w.txs })), // strings, never BigInt: this object is JSON.stringify'd by the eligibility route
    wei: wei.toString(), tokens, priceUsd, usd: priceUsd == null ? null : tokens * priceUsd,
    availableWei: availableWei.toString(), availableTokens, availableUsd: priceUsd == null ? null : availableTokens * priceUsd, topWallet };
  if ((burnBump.get(userId) || 0) <= startedAt) burnCache.set(userId, { at: now(), val }); // a mint landed mid-read → this value is already stale, do not cache it
  return val;
}
// The $SEND price in dollars, from the pair's own reserves. spotPrice() gives quote-units per token;
// which leg is the quote decides what that means — a dollar stable is dollars already, WETH needs
// ETH/USD. Anything else, or any failed read, returns null: a burn is then "cannot be valued", never
// "worth nothing".
/* The spot is a single reserves read on a small pool, and a momentary pump is cheap — measured, a 10x
   spike on the $SEND pair costs a few hundred dollars in tax, fees and gas. So the gate is valued at
   the LOWER of the live spot and the median close of the last 24 hours of on-chain candles, and it
   refuses outright when the spot is more than 3x that median (a pump in progress) or when there are
   too few candles to know. A burner cannot make their burn worth more by moving the price for a
   minute; they can only ever be valued at what the coin has actually traded around all day. */
const PRICE_MEDIAN_HOURS = 24, PRICE_MIN_CANDLES = 6, PRICE_MAX_SPIKE = 3;
async function sendPriceUsd() {
  try {
    const [spot, t0raw, t1raw, chart] = await Promise.all([spotPrice(OG_PAIR.SEND, TOK.SEND), ethCall(OG_PAIR.SEND, '0x0dfe1681'), ethCall(OG_PAIR.SEND, '0xd21220a7'), buildCandles(OG_PAIR.SEND, TOK.SEND, '1h', PRICE_MEDIAN_HOURS).catch(() => null)]);
    if (!(spot > 0) || !t0raw || !t1raw) return null;
    const candles = Array.isArray(chart) ? chart : (chart && (chart.candles || chart.data)) || [];
    const closes = candles.map(c => Number(c && c.c)).filter(v => v > 0).sort((x, y) => x - y);
    if (closes.length < PRICE_MIN_CANDLES) return null;                       // not enough history to know what it trades around
    const median = closes[Math.floor(closes.length / 2)];
    if (spot > median * PRICE_MAX_SPIKE) return null;                         // a spike is in progress — refuse to value anything against it
    const q = Math.min(spot, median);
    const leg = (h) => ('0x' + String(h).slice(-40)).toLowerCase();
    const quote = leg(t0raw) === TOK.SEND.toLowerCase() ? leg(t1raw) : leg(t0raw);
    if (quote === String(USDG_ADDR).toLowerCase()) return q;
    if (quote === String(WETH_ADDR).toLowerCase()) {
      const eth = await ethUsd();
      // ethUsd() deliberately serves its last good value when CoinGecko is down; for a dollar gate that
      // value must be recent, or the burn cannot be valued at all
      if (!(eth > 0) || now() - (ethUsdCache.at || 0) > 10 * 60 * 1000) return null;
      return q * eth;
    }
    return null;
  } catch { return null; }
}
function dataKeyOf(req) {
  const m = /^Bearer\s+(sk_[0-9a-f]{48})$/i.exec(String(req.headers.authorization || '').trim());
  if (!m) return null;
  const row = db.prepare('SELECT k.key_hash, k.user_id, k.last_used_at, k.expires_at, k.source, u.og, u.og_tier FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ? AND k.revoked_at IS NULL').get(hashToken(m[1]));
  if (!row) return null;
  if (row.expires_at != null && row.expires_at <= now()) return null;                 // a year is a year
  // A Gold key is free WHILE the badge is live. If it replaced a paid key, the paid remainder rides along as
  // expires_at, and that remainder is honoured even after the badge goes — nobody loses time they paid for.
  if (row.source === 'og_gold' && !(row.og && row.og_tier === OG_TIER.GOLD) && !(row.expires_at != null && row.expires_at > now())) return null;
  if (now() - (row.last_used_at || 0) > 60000) db.prepare('UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?').run(now(), row.key_hash);
  return row;
}
// the public shape of an account — what its wall already shows anyone
function publicUserView(u) {
  const level = levelForXp(u.points || 0);
  return { id: u.id, username: u.username, avatar: u.avatar, avatar_img: u.avatar_img ? '/uploads/' + u.avatar_img : null, bio: u.bio || '', accent: u.accent || '',
    joined: u.created_at, points: u.points || 0, level, title: titleFor(level), og: u.og_tier || 0, twitter: u.twitter_handle || null, instagram: u.ig_handle || null };
}
// everything the key holder's own account holds, decrypted for them and nobody else
function ownDataView(u) {
  const level = levelForXp(u.points || 0);
  return {
    profile: { ...publicUserView(u), theme: themeOf(u), wallets: walletAddresses(u.id), methods: identityTypes(u.id), twofa: u.twofa_method || null,
      tracker_prefs: safeJson(decField(u.tracker_prefs)), site_prefs: safeJson(decField(u.site_prefs)), rank: userRank(u.id), boost: effectiveMult(u.id),
      ogTier: u.og_tier || 0, ogBuyMs: u.og_buy_ms || null, ogRevoked: !!u.og_revoked, weekBoost: weekBoostState(u.id), arcade: arcadeState(u.id),
      restriction: restrictionOf(u), probation: probationOf(u), callAllowance: callAllowance(u) },
    pointsEvents: db.prepare('SELECT id, kind, amount, base, mult, comp_amount, ref, created_at FROM points_events WHERE user_id = ? ORDER BY id DESC LIMIT 1000').all(u.id),
    posts: db.prepare('SELECT * FROM posts WHERE user_id = ? ORDER BY id DESC LIMIT 500').all(u.id).map(p => postView(p, null)),
    comments: db.prepare('SELECT id, post_id, text, tokens, created_at FROM comments WHERE user_id = ? ORDER BY id DESC LIMIT 500').all(u.id).map(c => ({ ...c, tokens: parseTokens(c.tokens) })),
    calls: db.prepare('SELECT * FROM calls WHERE user_id = ? ORDER BY id DESC LIMIT 200').all(u.id).map(r => callView(r, null)),
    sends: db.prepare('SELECT call_id, created_at, entry_price, spend_usd, bought_usd, held_usd, hold_paid, points_paid FROM call_hops WHERE user_id = ? ORDER BY created_at DESC LIMIT 500').all(u.id),
    watchlist: db.prepare('SELECT pair_addr, token_addr, token0, token1, quote_symbol, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at DESC').all(u.id),
    trackedWallets: db.prepare('SELECT id, address_enc, label, created_at FROM tracked_wallets WHERE user_id = ? ORDER BY id').all(u.id).map(t => ({ id: t.id, address: decField(t.address_enc), label: t.label, created_at: t.created_at })),
    pinnedTokens: db.prepare('SELECT token_addr, pair_addr, symbol, name, added_at, pin_price, pin_mc FROM pinned_tokens WHERE user_id = ? ORDER BY added_at').all(u.id),
    communities: db.prepare('SELECT c.id, c.symbol, c.name, c.token_addr, c.status, cm.joined_at, cm.conviction_xp, cm.qualified FROM community_members cm JOIN communities c ON c.id = cm.community_id WHERE cm.user_id = ?').all(u.id),
    following: db.prepare('SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ?').all(u.id),
    followers: db.prepare('SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ?').all(u.id),
    notifications: db.prepare('SELECT id, kind, icon, text, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 500').all(u.id),
    mutes: mutedNames(u.id),
  };
}
let lbCache = { at: 0, top: null };   // leaderboard top-20 cache (identical for everyone → serve for LB_TTL)
const LB_TTL = 8000;
function allTimeTop() {
  if (!lbCache.top || now() - lbCache.at > LB_TTL) {
    const rows = db.prepare('SELECT id, username, avatar, avatar_img, accent, points, og, og_tier FROM users WHERE points > 0 AND system = 0 ORDER BY points DESC, id ASC LIMIT 20').all();
    let rank = 0, prevPts = null, seen = 0; // competition ranking (ties share a rank) so it matches userRank() everywhere
    lbCache = { at: now(), top: rows.map(u => {
      seen++; if (u.points !== prevPts) { rank = seen; prevPts = u.points; }
      return { rank, username: u.username, avatar: u.avatar, avatar_img: u.avatar_img ? '/uploads/' + u.avatar_img : null, accent: u.accent || '', points: u.points, level: levelForXp(u.points), title: titleFor(levelForXp(u.points)), diamond: publicDiamond(u.id), og: u.og_tier || 0 };
    }) };
  }
  return lbCache.top;
}
const RISK_PUBLIC = Object.fromEntries(Object.entries(RISK).map(([k, v]) => [k, { sev: v.sev, label: v.label }])); // static → build once
let pairsRespCache = { key: null, json: null, gz: null }; // serialized + gzipped /api/pairs/new body, rebuilt only when the cache version changes
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const b = buckets.get(key) || { n: 0, t: now() };
  if (now() - b.t > windowMs) { b.n = 0; b.t = now(); }
  b.n++; buckets.set(key, b);
  return b.n <= max;
}

// live presence ("how many people are actively Sending it"): in-memory key→lastSeen, pruned on read.
// A key is one signed-in user (dedupes their tabs) or one anonymous browser. Ephemeral; resets on restart.
const presence = new Map();
const PRESENCE_WINDOW = 75 * 1000; // considered active if seen within this window (client heartbeats every ~30s)
function presenceTouch(key) { presence.set(key, now()); }
// Anonymous presence is keyed by a client-chosen pid so two devices behind one NAT both count — but unbounded pids per IP
// let one machine inflate "N Sending it" by hundreds. Cap distinct anonymous pids per IP and fold the overflow into one slot.
const ANON_SLOTS_PER_IP = 3;
const anonSlots = new Map(); // ip -> Map<pid, lastSeen>
function presenceAnonKey(ip, pid) {
  if (!pid) return 'ip:' + ip;
  const cutoff = now() - PRESENCE_WINDOW;
  let m = anonSlots.get(ip); if (!m) { m = new Map(); anonSlots.set(ip, m); }
  for (const [k, t] of m) if (t < cutoff) m.delete(k);
  if (!m.has(pid) && m.size >= ANON_SLOTS_PER_IP) return 'ip:' + ip;
  m.set(pid, now()); return 'a:' + ip + ':' + pid;
}
function presenceSweep() { // called from the 5-min maintenance tick so the per-IP maps can't grow unbounded
  const cutoff = now() - PRESENCE_WINDOW;
  for (const [ip, m] of anonSlots) { for (const [k, t] of m) if (t < cutoff) m.delete(k); if (!m.size) anonSlots.delete(ip); }
}
// 2FA: any change of method (enable another, replace the secret, disable) must pass the CURRENT factor, so a hijacked
// session cookie alone can never strip or swap it. Returns null when the factor passes, else the error message.
async function verifyCurrentFactor(me, b) {
  if (me.twofa_method === 'totp') {
    return totpVerify(decField(me.twofa_secret), b.code) ? null : 'enter a valid code from your authenticator app first';
  }
  if (me.twofa_method === 'password') {
    const e = emailIdentity(me.id);
    return (e && checkPassword(String(b.password || ''), e.secret)) ? null : 'enter your account password first';
  }
  if (me.twofa_method === 'wallet') {
    const address = String(b.address || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) return 'request a wallet signature first';
    // Only a wallet linked BEFORE 2FA was turned on counts as the factor: a stolen cookie can link a fresh wallet, so
    // "any linked wallet" would be no factor at all. Pre-migration rows (NULL timestamps) keep the legacy behaviour.
    const w = db.prepare("SELECT linked_at FROM identities WHERE user_id = ? AND type = 'wallet' AND identifier = ?").get(me.id, bidx(address));
    if (!w) return 'sign with a linked wallet first';
    if (w.linked_at && me.twofa_enabled_at && w.linked_at > me.twofa_enabled_at) return 'that wallet was linked after two-factor was turned on — sign with the wallet you enabled it with';
    // this proves the CURRENT factor for a security change (disable 2FA, swap factor, add an email, link a
    // wallet), so a plain sign-in signature must not satisfy it
    const sig = consumeNonce(address, b.signature, 'manage');
    if (sig.error) return sig.error;
  }
  return null;
}
function presenceCount() {
  const cutoff = now() - PRESENCE_WINDOW; let n = 0;
  for (const [k, t] of presence) { if (t < cutoff) presence.delete(k); else n++; }
  return n;
}

/* ===== Anti-gaming: bot/gaming detection + read-only enforcement =====
   Every point must be earned organically. We scan write-action velocity + duplicate spam; a user acting
   inhumanly is put in READ-ONLY — they can't post/comment/react/vote/follow/track/customize, but they can
   still earn Send Power organically (showing up daily, buying & holding $SEND/$GWC, swaps). First offense
   = 24h; a repeat after they're unpaused = 1 week. Thresholds sit far above real human use, so honest
   players are never caught — this protects the people playing by the rules. */
const DAY_MS = 86400000;
const PERM_UNTIL = 32503680000000; // year 3000 sentinel — a "permanent" read-only restriction (restrictionOf never expires it)
// Redemption cost scales with the restriction: $25 per 24h of a timed mute; a flat $1000 to buy out a permanent one.
const REDEEM_RATE_USD = 25;        // $ of $SEND to buy per 24h of a timed restriction
const PERM_REDEEM_USD = 1000;      // flat $ to buy out a PERMANENT (indefinite) restriction
const PERM_HOLD_MS = (PERM_REDEEM_USD / REDEEM_RATE_USD) * DAY_MS; // hold for a permanent buy-out (40 days = $1000 at $25/day)
function redeemCostUsd(u) { // how much MORE $SEND they must buy to lift THIS restriction
  if ((u.restrict_level || 0) >= 3) return PERM_REDEEM_USD;
  return REDEEM_RATE_USD * Math.max(1, Math.round((u.redeem_dur || DAY_MS) / DAY_MS));
}
function redeemHoldMs(u) { // how long they must then hold that $SEND (permanent → 40d; timed → the restriction length)
  return (u.restrict_level || 0) >= 3 ? PERM_HOLD_MS : (u.redeem_dur || DAY_MS);
}
function humanDur(ms) { const h = Math.round(ms / 3600000); if (h < 48) return h + ' hours'; const d = Math.round(ms / DAY_MS); if (d < 14) return d + ' days'; return Math.round(d / 7) + ' weeks'; }
const READONLY_ALLOWED = [
  'Earn your daily "show up" bonus 📅',
  'Buy & hold $SEND / $GWC — your Holder Boost keeps compounding 💎',
  'Swap for $SEND / $GWC — those points still count 🚀',
  'Connect or refresh your wallet 🔗',
  'Browse the Send Wall, profiles, charts & New Pairs Radar 👀',
];
const READONLY_BLOCKED = ['Making Send Calls', 'Sending It on others’ calls', 'Posting', 'Commenting', 'Reacting', 'Upvoting / downvoting', 'Following', 'Tracking wallets', 'Customizing your wall'];

// in-memory behavioral windows (the durable restriction lives in the DB). Heavy = content creation
// (post/comment/track); light = one-tap engagement (react/vote/follow). They have separate, much higher
// ceilings so an enthusiastic human who reacts+votes across a whole session is never mistaken for a bot.
const actHeavy = new Map(); // userId -> [ts,...]
const actLight = new Map(); // userId -> [ts,...]
const postLog = new Map();  // userId -> [{t,h},...] long-post fingerprints (dup/copypasta detection)

function restrictionOf(u) {
  if (!u || !u.restricted_until || u.restricted_until <= now()) return null;
  return {
    until: u.restricted_until, level: u.restrict_level || 1,
    permanent: (u.restrict_level || 0) >= 3, // tier 3 = permanent mute (no countdown; buy-out costs a flat $1000)
    redeemable: true,                        // ANY restriction can be lifted early by buying & holding enough $SEND
    redeemUsd: redeemCostUsd(u),             // $ of $SEND to buy: $25 per 24h (timed) or $1000 flat (permanent)
    holdMs: redeemHoldMs(u),                 // how long the bought $SEND must then be held to clear it for good
    reason: u.restrict_reason || 'Unusual, automation-like activity was detected on your account.',
    allowed: READONLY_ALLOWED, blocked: READONLY_BLOCKED,
  };
}
// probation state after a redemption: must hold the bought $SEND until `until` or read-only returns doubled
function probationOf(u) {
  if (!u || !u.redeem_hold_until || u.redeem_hold_until <= now()) return null;
  return { until: u.redeem_hold_until, floor: u.redeem_floor || 0 };
}
const isReadOnly = (u) => !!restrictionOf(u);

function flagUser(userId, reason) {
  const u = db.prepare('SELECT strikes, restricted_until FROM users WHERE id = ?').get(userId);
  if (!u || u.restricted_until > now()) return; // can't accrue new flags while already blocked
  const strikes = (u.strikes || 0) + 1;
  const level = strikes >= 3 ? 3 : strikes >= 2 ? 2 : 1;                 // 1st offense → 24h, repeat → 1 week, and again → permanent
  const dur = level >= 3 ? 0 : (level >= 2 ? 7 * DAY_MS : DAY_MS);       // permanent has no finite duration → not redeemable
  const until = level >= 3 ? PERM_UNTIL : now() + dur;
  const hs = db.prepare('SELECT send_tok FROM holder_state WHERE user_id = ?').get(userId); // baseline $SEND (to later detect a genuine redemption buy)
  const baseSend = hs ? (hs.send_tok || 0) : -1; // -1 = baseline UNKNOWN (never read on-chain) → redeem must establish it first
  db.prepare('UPDATE users SET strikes=?, restrict_level=?, restrict_reason=?, restricted_until=?, flagged_at=?, redeem_base_send=?, redeem_dur=?, redeem_hold_until=0, redeem_floor=0 WHERE id=?')
    .run(strikes, level, String(reason).slice(0, 200), until, now(), baseSend, dur, userId);
}
// enforce the redemption deal after an on-chain holdings read: hold the bought $SEND to term, or read-only returns doubled.
function checkProbation(userId, sendTok) {
  const u = db.prepare('SELECT redeem_hold_until, redeem_floor, redeem_dur, restrict_level FROM users WHERE id = ?').get(userId);
  if (!u || !u.redeem_hold_until || u.redeem_hold_until <= 0) return; // not in probation
  if (now() >= u.redeem_hold_until) { // held all the way to term → fully cleared
    db.prepare('UPDATE users SET redeem_hold_until=0, redeem_floor=0 WHERE id=?').run(userId);
    notify(userId, '✅', 'You held your $SEND through the probation window — your read-only is fully cleared. Respect. 💎', 'restriction');
    return;
  }
  if (sendTok < u.redeem_floor * 0.98) { // sold >2% below the floor before the hold was up → read-only returns
    if ((u.restrict_level || 0) >= 3) { // a broken PERMANENT buy-out hold → back to permanent (buy-out again costs $1000)
      db.prepare('UPDATE users SET restricted_until=?, restrict_reason=?, redeem_dur=0, redeem_base_send=?, redeem_hold_until=0, redeem_floor=0 WHERE id=?')
        .run(PERM_UNTIL, 'You sold your $SEND before the hold was up — your permanent read-only is back.', sendTok, userId);
      notify(userId, '🔇', 'You sold your $SEND before the hold was up — your permanent read-only is back. Buy & hold $SEND again to lift it.', 'restriction');
      return;
    }
    const newDur = Math.max(DAY_MS, (u.redeem_dur || DAY_MS) * 2); // timed → returns doubled
    db.prepare('UPDATE users SET restricted_until=?, restrict_reason=?, redeem_dur=?, redeem_base_send=?, redeem_hold_until=0, redeem_floor=0 WHERE id=?')
      .run(now() + newDur, 'You sold your $SEND before the hold was up — read-only is back, and the timer is doubled.', newDur, sendTok, userId);
    notify(userId, '🔇', 'You sold your $SEND before the hold was up — read-only is back, and doubled. Buy & hold again to lift it.', 'restriction');
  }
}
const _probTick = new Map();
function probationTick(userId) { // fire-and-forget on-chain re-check for an ACTIVE probation user (throttled 60s) so a sell is caught before their next write, not just on the 5-min sweep
  const u = db.prepare('SELECT redeem_hold_until FROM users WHERE id = ?').get(userId);
  if (!u || u.redeem_hold_until <= now()) return;
  if (now() - (_probTick.get(userId) || 0) < 60000) return;
  _probTick.set(userId, now());
  refreshHolder(userId).catch(() => {});
}

// call AFTER a successful write action; flags + returns true if this tripped the scanner.
// Thresholds sit far above real human use (and above what the per-action rate limits even permit for
// light actions), so honest, enthusiastic members are never caught — bots doing inhuman bursts are.
function scanWriteAction(userId, kind, text) {
  const t = now();
  const heavy = kind === 'post' || kind === 'comment' || kind === 'track';
  const map = heavy ? actHeavy : actLight;
  let win = (map.get(userId) || []).filter(x => t - x < 5 * 60000);
  win.push(t); map.set(userId, win);
  const c60 = win.filter(x => t - x < 60000).length, c300 = win.length;
  let reason = null;
  if (heavy) {
    if (c60 >= 25) reason = 'Too many posts/comments in under a minute — automation-like bursts.';
    else if (c300 >= 60) reason = 'A sustained, inhuman posting rate over several minutes.';
  } else {
    if (c60 >= 60) reason = 'Too many reactions/votes in under a minute — automation-like bursts.';
    else if (c300 >= 180) reason = 'A sustained, inhuman rate of reactions/votes over several minutes.';
  }
  // duplicate/copypasta detection — only LONG posts (never short ritual posts like "gm", "LFG", "🚀")
  if (!reason && kind === 'post' && text) {
    const h = String(text).trim().toLowerCase().slice(0, 200);
    if (h && h.length >= 40) {
      let arr = (postLog.get(userId) || []).filter(x => t - x.t < 36e5);
      arr.push({ t, h }); postLog.set(userId, arr);
      if (arr.filter(x => x.h === h && t - x.t < 3 * 60000).length >= 6) reason = 'The same long post was repeated over and over (spam pattern).';
    }
  }
  if (reason) { flagUser(userId, reason); return true; }
  return false;
}

// endpoint guard for gameable write actions; returns true (and 403s) if the user is read-only
function blockReadOnly(res, me) {
  const r = restrictionOf(me);
  if (r) { send(res, 403, { error: "You're in read-only mode — this action is paused. See the banner up top for why and when it lifts.", readOnly: true, restriction: r }); return true; }
  return false;
}

// periodic sweep: keep in-memory maps and short-lived DB rows from growing without bound
const sweeper = setInterval(() => {
  const t = now();
  for (const [k, v] of pendingLogins) if (v.expires < t) pendingLogins.delete(k);
  for (const [k, v] of oauthStates) if (v.expires < t) oauthStates.delete(k);
  for (const [k, v] of buckets) if (t - v.t > 36e5) buckets.delete(k); // idle >1h
  for (const m of [actHeavy, actLight]) for (const [k, v] of m) { const f = v.filter(x => t - x < 3e5); if (f.length) m.set(k, f); else m.delete(k); }
  for (const [k, v] of postLog) { const f = v.filter(x => t - x.t < 36e5); if (f.length) postLog.set(k, f); else postLog.delete(k); }
  try {
    db.prepare('DELETE FROM nonces WHERE expires_at < ?').run(t);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  } catch {}
}, 6e5); // every 10 min
sweeper.unref?.(); // don't keep the process alive just for the sweeper

/* ---------- router ---------- */
// gzip is acceptable only when the client offers it with a non-zero q-value (RFC 7231): "gzip;q=0" is a refusal.
/* ===========================================================================
   SEND CALLS — a user "calls" a token; it posts a live widget to their wall that
   tracks how many Xs it does (the caller's rule: each +100% = 1x → X = price/entry − 1),
   the peak/ATH since the call, a grade, and points that scale with the call's size.
   All prices are read from public sources; nothing here moves funds.
   =========================================================================== */
const callX = (price, entry) => (entry > 0 && price != null) ? (price / entry - 1) : 0; // +100% = 1.0x
const MIN_CALL_LIQ = 500;   // a token must have ≥ this pooled liquidity (USD) to be callable — stops farming on self-made dust pools
const RUG_LIQ_FLOOR = 100;  // a called token whose live liquidity collapses below this (it started ≥ $500) = liquidity pulled → RUGGED
const RUG_PENALTY = 2;      // calls the caller's daily limit drops when one of their calls rugs
const CALL_X_CAP = 50;      // cap the milestone ladder so a manipulated/glitched peak can't mint unbounded points or spin the loop
/* ===== What ONE Send Call can ever be worth =========================================================
   Everything a call pays — the opening award, the milestone ladder, and the diamond-hands hold bonus —
   comes out of a single lifetime budget per call. Without one the hold bonus is unbounded in practice:
   HOLD_MAX caps the BASE, but it is paid out in chunks of MIN_HOLD_AWARD, so a position can generate
   HOLD_MAX/MIN_HOLD_AWARD separate events (37,500 today), and the multiplier stack sits on top of every
   one of them. PTS_EVENT_CAP bounds each event and not the count — before this budget existed, with
   HOLD_MAX then at 250,000 and the event cap then at 500,000, that was 12,500 x 500,000 = 6.25 BILLION
   Send Power from a single call, or 434x what Level 100 requires.

   The budget is a level rather than a round number so it stays meaningful if the curve ever changes:
   one perfect call is worth at most what it takes to reach Level 70. Level 100 is
   xpForLevel(100) / xpForLevel(70) = about 20 of those, so a great caller genuinely can climb to the
   top on calls — the leaderboard is meant to reward exactly that — but no single call can put anyone
   there, and twenty perfect calls is a career, not a trick. For scale, one perfect call is worth about
   36 days of maxed-out social play at 1x. Senders get a quarter of the caller's budget, matching the
   ratio the opening awards already use (hop_on 30 vs send_call 120). */
const CALL_POINTS_CAP = xpForLevel(70);                       // 737,627 — lifetime Send Power cap for one call, for its caller
const HOP_POINTS_CAP = Math.round(CALL_POINTS_CAP / 4);       // 184,407 — same, per hopper on that call
// The opening award is a participation award, not performance: it scales with the position you actually put in, and a
// boost stack may multiply it at most this much. The 10% budget slice alone was sized for a 1× user — under a large
// stack a $0 call reached the whole 73,762 slice with nothing in the token and no market move at all.
const OPEN_STACK_MAX = 10;
/* A single payout may also take at most CALL_EVENT_SHARE of the whole budget. Without this, the
   budget alone quietly destroys the incentive it is protecting: at a 500x multiplier stack the
   OPENING award already exceeds the entire cap, so one event swallows it and the milestone ladder
   and the diamond-hands hold bonus pay literally nothing for the rest of the call's life. Bounding
   each event to a tenth means a call takes at least ten payouts to exhaust, so holding still pays a
   whale something, while a normal 1x user is nowhere near the per-event bound and sees the reward
   curve they always saw. */
const CALL_EVENT_SHARE = 0.1;
/* The budget is also carved by SOURCE, and the carve is the priority order the site wants: the
   opening award is one event, so it is bounded to a tenth by CALL_EVENT_SHARE; the milestone ladder
   may take at most CALL_X_BUDGET_SHARE cumulatively; everything else — never less than 60% of what a
   call can ever pay — is reserved for the diamond-hands hold bonus, i.e. for staying in profit. Without
   the carve a high-multiplier caller exhausted the whole budget on the ladder in the first hour the
   coin ran and then earned nothing for holding it, which is exactly backwards. */
const CALL_X_BUDGET_SHARE = 0.3;
const callHeadroom = (paid, cap) => Math.min(Math.max(0, cap - (paid || 0)), Math.floor(cap * CALL_EVENT_SHARE));
// ── Diamond-hands: reward a call that STAYS in positive Xs, the longer AND higher the more (exponentially) ──
// hold_x accumulates ∫ min(curX, cap) dt(hours) while curX>0. Points owed grow super-linearly with hold_x, so
// duration × height compound. Same mechanic rewards hoppers who stay in profit from their hop-in price.
/* SEND CALL BONUSES ADD, THEY DO NOT MULTIPLY — the same rule effectiveMult() already applies to the boost
   stack, now applied to the call's own bonuses too. Each contributes what it pays OVER the base 1x, so a call
   with a 4x size bonus and a 3x crew bonus pays 1 + 3 + 2 = 6x its base rather than 12x. Compounding was how
   a single good call could pay a number nobody could justify: size × crew × milestone × the boost stack are
   four factors, and four factors multiplied get away from you fast. */
const addBonus = (...factors) => 1 + factors.reduce((s, f) => s + Math.max(0, (Number(f) || 1) - 1), 0);
/* The X ladder used to pay rung m a multiple of m — so the total to 50x was 1+2+…+50 = 1,275 bases, growing
   with the SQUARE of the call. Now each rung adds a fixed step instead, so the ladder grows in a straight
   line: rung 50 pays 5.9x a rung rather than 50x, and the whole ladder to 50x is ~172 bases, not 1,275. */
const CALL_X_STEP = 0.1;
const HOLD_K = 2, HOLD_EXP = 1.5;      // HOLD_K 2 (was 0.5): a doubled call held a month with no crew now pays ~38,600 base, four times a maxed grind day — holding in profit IS the main event; HOLD_MAX and the budget still bound the top   // owed = HOLD_K · hold_x^HOLD_EXP  (super-linear ⇒ "exponentially more")
const HOLD_X_CAP = 50;                // cap the per-tick X height so one glitch tick can't spike the integral
const HOLD_DT_CAP_H = 0.5;            // credit at most 30 min of hold per tick (we never observed the price during a longer gap)
const HOLD_MAX = 750000;             // ceiling on total BASE hold points per position. 3x with every other base — left at 250,000 it
                                     // bound BEFORE the 60% of the call budget reserved for holding (442,576), so a 1x holder was
                                     // clipped at 250,000 and could never fill the slice that exists for them. The budget, not this,
                                     // is what bounds a whale; this only needs to sit above the reserved slice at 1x.
const MIN_HOLD_AWARD = 20;           // only pay out once ≥ this is owed, so we don't spam tiny points_events rows
/* CREW: the caller's hold accrues faster when the people who Sent It on the call are ALSO in profit
   from their own entry. 1 + 0.1 per hopper in the green, capped at 3x (twenty profitable hoppers).
   It multiplies the RATE the hold integral grows at, after the per-tick time cap — applied to dtH
   before that cap it would be swallowed by it (0.5h x 3 clamps straight back to 0.5h). The intent
   is the site's: a conviction play that carries other people with it is worth more than a lonely
   one, and the way to earn it is to stay in profit long enough for them to be too. */
const CREW_MIN_SPEND_USD = 20;       // a Sender counts toward the crew only with at least this much verified in the token
const CREW_PER_HOPPER = 0.1;
const CREW_MAX = 3;
const crewFactor = (hoppersInProfit) => Math.min(CREW_MAX, 1 + CREW_PER_HOPPER * Math.max(0, hoppersInProfit || 0));
function accrueHold(holdX, holdPaid, curX, dtH, rate) {
  let nx = holdX;
  if (curX > 0 && dtH > 0) nx += Math.min(dtH, HOLD_DT_CAP_H) * Math.min(curX, HOLD_X_CAP);
  /* The crew bonus is applied to the PAYOUT, not folded into the integral. Inside the integral it went
     through the ^1.5 exponent, so a 3x crew was really worth 3^1.5 = 5.2x — a bonus paying 74% more than it
     said it did. Outside it, a 3x crew is worth exactly 3x, which is what the card promises. */
  const bonus = addBonus(rate);
  const owed = Math.min(HOLD_MAX, HOLD_K * Math.pow(nx, HOLD_EXP) * bonus);
  const award = (owed - holdPaid >= MIN_HOLD_AWARD) ? Math.floor(owed - holdPaid) : 0;
  return { holdX: nx, award, holdPaid: holdPaid + award };
}
const LIVE_BATCH_MAX = 40;   // Send Calls answered in one /api/calls/live read — more than fit on any screen
function callGrade(maxX) {
  if (maxX >= 20) return { g: 'S', label: 'Legendary', emoji: '🏆' };
  if (maxX >= 10) return { g: 'A', label: 'Massive', emoji: '🚀' };
  if (maxX >= 5) return { g: 'B', label: 'Big', emoji: '🔥' };
  if (maxX >= 2) return { g: 'C', label: 'Solid', emoji: '💪' };
  if (maxX >= 0.5) return { g: 'D', label: 'Small', emoji: '🌱' };
  if (maxX >= 0) return { g: 'E', label: 'Flat', emoji: '➖' };
  return { g: 'F', label: 'Underwater', emoji: '💀' };
}
// composite rank for "top holders": still-holding senders first, then more money in × longer held × bigger PNL.
function holderScore(s) {
  if (!s.holding) return -1e9 + (s.sentUsd || 0); // sold-out / no-position senders fall below every holder (still ordered by $ in)
  const days = (s.holdMs || 0) / 864e5, x = Math.max(0, s.senderX || 0);
  return (s.sentUsd || 0) * (1 + days) * (1 + x);
}
// the people who Sent It on a call — each with: $ they put in, the MC they got in at, their PNL in Xs, their $SEND/$GWC
// diamond level, how long they've held, and whether they're still holding or sold out. Ranked as top HOLDERS (holderScore).
function callSenders(row, limit) {
  const price = row.cur_price > 0 ? row.cur_price : row.entry_price;
  const rows = db.prepare(
    'SELECT h.user_id, h.entry_price, h.spend_usd, h.bought_usd, h.held_usd, h.created_at, u.username, u.avatar, u.avatar_img, u.og, u.og_tier ' +
    'FROM call_hops h JOIN users u ON u.id = h.user_id WHERE h.call_id = ?'
  ).all(row.id);
  const supply = (row.entry_mc != null && row.entry_price > 0) ? row.entry_mc / row.entry_price : null;
  const t = now();
  const list = rows.map(h => {
    const holding = (h.held_usd || 0) > 0.01;              // still holds any of the coin
    const everBought = (h.bought_usd || 0) > 0 || (h.spend_usd || 0) > 0;
    return {
      _uid: h.user_id,                                     // diamond level is looked up AFTER the slice (see below)
      username: h.username, avatar: h.avatar, avatarImg: h.avatar_img ? '/uploads/' + h.avatar_img : null, og: h.og_tier || 0,
      entryMc: (supply != null && h.entry_price > 0) ? h.entry_price * supply : null,
      sentUsd: (h.bought_usd || h.spend_usd) || 0,         // what they put into the coin
      heldUsd: h.held_usd || 0,
      holding, sold: !holding && everBought,               // sold out = once bought, now holds none
      senderX: (h.entry_price > 0 && price > 0) ? (price / h.entry_price - 1) : null, // their PNL in Xs (+100% = 1x)
      holdMs: holding ? Math.max(0, t - h.created_at) : 0, // how long they've held (since they Sent It), only while still holding
      diamond: 0,
      sentAt: h.created_at,
    };
  });
  list.sort((a, b) => holderScore(b) - holderScore(a));
  // holderScore() never reads .diamond, so resolve the badge only for the senders we actually return — this used to be
  // one holder_state query PER HOP (hundreds per /api/posts) to fill a field all but ~3 rows then threw away.
  const out = limit ? list.slice(0, limit) : list;
  for (const x of out) { const d = publicDiamond(x._uid); x.diamond = d ? d.level : 0; delete x._uid; }
  return out;
}
// demand-driven, throttled, bounded re-read of who's put in what on-chain (freshens spend_usd for the senders list)
const _sendersRefresh = new Map();
const SENDERS_REFRESH_MS = 5 * 60 * 1000, SENDERS_REFRESH_CAP = 30;
async function refreshSenderSpends(row) {
  if (now() - (_sendersRefresh.get(row.id) || 0) < SENDERS_REFRESH_MS) return; // one on-chain sweep per call per 5 min
  _sendersRefresh.set(row.id, now());
  const price = row.cur_price > 0 ? row.cur_price : row.entry_price;
  if (!(price > 0) || !row.pair_addr) return;
  const hoppers = db.prepare('SELECT user_id FROM call_hops WHERE call_id=? ORDER BY created_at DESC LIMIT ?').all(row.id, SENDERS_REFRESH_CAP);
  for (const h of hoppers) {
    try { const pos = await walletTokenPosition(h.user_id, row.token_addr, row.pair_addr, price); db.prepare('UPDATE call_hops SET spend_usd=?, bought_usd=?, held_usd=? WHERE call_id=? AND user_id=?').run(pos.spendUsd, pos.boughtUsd, pos.heldUsd, row.id, h.user_id); } catch {}
  }
}
function callView(row, me) {
  const entry = row.entry_price, cur = row.cur_price != null ? row.cur_price : entry, peak = Math.max(row.peak_price, cur);
  const curX = callX(cur, entry), maxX = callX(peak, entry);
  let snap = null; try { snap = JSON.parse(row.snapshot || 'null'); } catch {}
  const hops = db.prepare('SELECT COUNT(*) n FROM call_hops WHERE call_id=?').get(row.id).n;
  const hopped = me ? !!db.prepare('SELECT 1 FROM call_hops WHERE call_id=? AND user_id=?').get(row.id, me.id) : false;
  const callerSpend = row.entry_spend_usd || 0; // $ the caller spent buying the token (on-chain)
  const hopSpend = db.prepare('SELECT COALESCE(SUM(spend_usd),0) s FROM call_hops WHERE call_id=?').get(row.id).s || 0; // cumulative $ every follower put in
  return {
    id: row.id, postId: row.post_id || null, symbol: row.symbol, name: row.name, token: row.token_addr, pair: row.pair_addr,
    quoteSymbol: row.quote_symbol, wallet: row.wallet || null, calledAt: row.created_at,
    entryPrice: entry, entryMc: row.entry_mc, curPrice: cur, curMc: row.cur_mc,
    peakMc: (row.entry_mc != null && entry > 0) ? row.entry_mc * (peak / entry) : null, // MC scales with price (supply ~constant)
    curX, maxX, grade: callGrade(maxX), hops, hopped, peakAt: row.peak_at || null, lastCheck: row.last_check || null,
    callerSpend, hopSpend, totalSpend: callerSpend + hopSpend, sizeMult: sizeMult(callerSpend), // Send-size: $ in + the caller's Send-Power multiplier
    senders: callSenders(row, 3), // top 3 Send-It senders (ranked by $ in) — expand fetches all via /api/calls/:id/senders
    holdEarned: Math.round(row.hold_paid || 0), // diamond-hands bonus the caller has earned so far for keeping it in profit
    noDyor: !!row.no_dyor, // caller made this call without opening the token's full on-chain detail first
    rugged: !!row.rugged, // the token's liquidity was pulled — a rug
    stale: !!row.dead, // Dexscreener stopped pricing it (delisted/rugged) → "Now" is unknown; the peak record still stands
    brand: (snap && snap.brand) || null,
    links: (snap && snap.links) || { dex: 'https://dexscreener.com/robinhood/' + row.pair_addr, explorer: BLOCKSCOUT + '/token/' + row.token_addr },
  };
}
// attach call widgets to a batch of post rows (postsView / postView reuse this)
function attachCalls(posts, me) {
  const ids = posts.filter(p => p.call_id).map(p => p.call_id);
  if (!ids.length) return;
  const byId = {};
  for (const r of db.prepare(`SELECT * FROM calls WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)) byId[r.id] = r;
  for (const p of posts) if (p.call_id && byId[p.call_id]) p.call = callView(byId[p.call_id], me);
}
let callsRefreshing = false, lastCallsRefresh = 0;
async function refreshCalls() {
  if (callsRefreshing) return; callsRefreshing = true;
  try {
    // Track EVERY call — calls are permanent, so their Xs keep updating and their peak (the final record) is
    // preserved forever. (At very large scale this moves to a background worker per SCALING.md; the peak is
    // never lost regardless.) Newest first so the most-relevant calls refresh even if a batch is throttled.
    const rows = db.prepare('SELECT id, user_id, token_addr, symbol, entry_price, peak_price, awarded_x, dead, rugged, hold_x, hold_paid, points_paid, last_check FROM calls ORDER BY id DESC').all();
    if (!rows.length) return;
    const tokens = [...new Set(rows.map(r => r.token_addr))];
    const byToken = {};
    const fetched = new Set(); // tokens we got a DEFINITIVE (successful) response for this sweep — a failed/rate-limited batch must NOT flip a live token to "dead"
    for (let i = 0; i < tokens.length; i += 30) {
      const batch = tokens.slice(i, i + 30);
      const arr = await jget('https://api.dexscreener.com/tokens/v1/robinhood/' + batch.join(','));
      if (arr == null) continue; // fetch failed (429/timeout/non-200) → these tokens are UNKNOWN this sweep, not rugged (a successful-but-empty [] still counts as definitive)
      for (const tk of batch) fetched.add(tk);
      for (const pr of arr) {
        const base = ((pr.baseToken && pr.baseToken.address) || '').toLowerCase();
        if (!base || pr.priceUsd == null) continue;
        const liq = (pr.liquidity && Number(pr.liquidity.usd)) || 0;
        if (!byToken[base] || liq > byToken[base]._liq) byToken[base] = { price: Number(pr.priceUsd), mc: pr.marketCap != null ? Number(pr.marketCap) : null, _liq: liq };
      }
    }
    const t = now();
    for (const r of rows) {
      const info = byToken[r.token_addr];
      if (!info || !(info.price > 0)) { if (fetched.has(r.token_addr) && !r.dead) db.prepare('UPDATE calls SET dead=1 WHERE id=?').run(r.id); continue; } // only mark stale on a DEFINITIVE unpriced answer — never on a failed fetch (peak is kept either way)
      // ANTI-FARM: rewards (hold + milestones + the ATH record) only accrue while the pool is real. If the live liquidity has
      // fallen below the call-time floor, the last-trade price can be moved for cents, so we PAUSE all crediting for this call
      // this tick (still update the displayed price + timestamp so a paused gap is never back-credited later).
      const liquid = info._liq >= MIN_CALL_LIQ;
      // RUG: the pool started with ≥ $500 (call-time floor) but its live liquidity has now collapsed → liquidity was pulled.
      // Mark it permanently and dock the caller's daily call limit by RUG_PENALTY, ONCE (guarded by the rugged flag).
      if (!r.rugged && info._liq < RUG_LIQ_FLOOR) {
        db.prepare('UPDATE calls SET rugged=1 WHERE id=?').run(r.id);
        db.prepare('UPDATE users SET call_limit = MAX(?, call_limit - ?) WHERE id=?').run(CALL_LIMIT_MIN, RUG_PENALTY, r.user_id);
        notify(r.user_id, '💀', 'Your $' + (r.symbol || '') + ' Send Call just got RUGGED — its liquidity was pulled. Your daily call limit dropped by ' + RUG_PENALTY + '.', 'restriction');
        r.rugged = 1;
      }
      const curX = callX(info.price, r.entry_price);
      const dtH = (t - (r.last_check || t)) / 3600000;
      // diamond-hands: accrue the caller's hold integral (positive Xs × time) and pay out super-linearly — only while liquid
      // Senders are read once here: the caller's accrual needs to know how many are in profit, and the
      // hopper loop below reuses the same rows
      const hops = liquid ? db.prepare('SELECT user_id, entry_price, hold_x, hold_paid, points_paid, last_check, spend_usd FROM call_hops WHERE call_id=?').all(r.id) : [];
      // a crew is people with money in the call, in profit — a tap with no position is not a crew member (twenty free alts tapping once gave the full 3×)
      const crewN = hops.filter(h => h.entry_price > 0 && (h.spend_usd || 0) >= CREW_MIN_SPEND_USD && callX(info.price, h.entry_price) > 0).length;
      const hc = liquid ? accrueHold(r.hold_x, r.hold_paid, curX, dtH, crewFactor(crewN)) : { holdX: r.hold_x, award: 0, holdPaid: r.hold_paid };
      // Finding 1 fix: advance hold_paid ONLY if the credit actually landed. The integral (hold_x) still advances, so a rolled-back
      // award (SQLITE_BUSY/FULL) is simply retried next tick instead of being silently swallowed. No ref: dedup is the hold_paid delta.
      let holdPaid = r.hold_paid, paidPts = r.points_paid || 0;
      if (hc.award > 0) {
        const got = awardPoints(r.user_id, 'call_hold', hc.award, null, callHeadroom(paidPts, CALL_POINTS_CAP));
        // hold_paid advances only if the credit landed, so a rolled-back award is retried rather than
        // swallowed — but a refusal because the call is CAPPED must still advance it, or the same
        // award is re-attempted forever on every 45s refresh for the life of the position.
        if (got > 0) { holdPaid = hc.holdPaid; paidPts += got; }
        else if (callHeadroom(paidPts, CALL_POINTS_CAP) <= 0) holdPaid = hc.holdPaid;
      }
      // peak (the permanent ATH record + leaderboard basis) only advances on a trustworthy price, so a drained-pool pump can't set a fake ATH
      const peak = liquid ? Math.max(r.peak_price, info.price) : r.peak_price, newPeak = peak > r.peak_price;
      if (newPeak) db.prepare('UPDATE calls SET cur_price=?, cur_mc=?, peak_price=?, peak_at=?, dead=0, hold_x=?, hold_paid=?, points_paid=?, last_check=? WHERE id=?').run(info.price, info.mc, peak, t, hc.holdX, holdPaid, paidPts, t, r.id);
      else db.prepare('UPDATE calls SET cur_price=?, cur_mc=?, dead=0, hold_x=?, hold_paid=?, points_paid=?, last_check=? WHERE id=?').run(info.price, info.mc, hc.holdX, holdPaid, paidPts, t, r.id);
      if (liquid) {
        // milestone points off the price SUSTAINED across the last two samples (min of prev cur-price and now), capped — this
        // defeats a one-trade peak spike: a level must survive a full refresh interval with real liquidity before it pays.
        const sustained = Math.min(r.cur_price > 0 ? r.cur_price : info.price, info.price);
        const newMax = Math.min(Math.floor(callX(sustained, r.entry_price)), CALL_X_CAP);
        if (newMax > r.awarded_x && newMax >= 1) {
          // what the ladder has already taken from this call, read off the refs it was paid under. A
          // range on the ref index rather than LIKE, so it stays cheap as points_events grows.
          const xSpent = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM points_events WHERE ref >= ? AND ref < ?").get('callx:' + r.id + ':', 'callx:' + r.id + ';').s;
          let xRoom = Math.max(0, Math.floor(CALL_POINTS_CAP * CALL_X_BUDGET_SHARE) - xSpent);
          for (let m = Math.max(1, r.awarded_x + 1); m <= newMax; m++) {
            const rung = Math.round(PTS.call_x * addBonus(1 + (m - 1) * CALL_X_STEP)); // additive rung, not m× the base
            const got = awardPoints(r.user_id, 'call_x', rung, 'callx:' + r.id + ':' + m, Math.min(callHeadroom(paidPts, CALL_POINTS_CAP), xRoom)); // bigger call → more points, out of the ladder's slice of the budget
            paidPts += got; xRoom -= got;
          }
          db.prepare('UPDATE calls SET awarded_x=?, points_paid=? WHERE id=?').run(newMax, paidPts, r.id);
          notify(r.user_id, '🚀', 'Your $' + (r.symbol || '') + ' Send Call hit ' + newMax + 'x! Send Power for the call.', 'points');
        }
        // reward hoppers who are ALSO in positive Xs (from their own hop-in price), same diamond-hands mechanic + same Finding-1-safe advance
        for (const hop of hops) {
          if (!(hop.entry_price > 0) || !((hop.spend_usd || 0) > 0)) continue; // the Sender hold bonus rewards a real position held in profit, never a tap
          const ha = accrueHold(hop.hold_x, hop.hold_paid, callX(info.price, hop.entry_price), (t - (hop.last_check || t)) / 3600000);
          let hopPaid = hop.hold_paid, hopPts = hop.points_paid || 0;
          if (ha.award > 0) {
            const got = awardPoints(hop.user_id, 'hop_hold', ha.award, null, callHeadroom(hopPts, HOP_POINTS_CAP));
            if (got > 0) { hopPaid = ha.holdPaid; hopPts += got; }
            else if (callHeadroom(hopPts, HOP_POINTS_CAP) <= 0) hopPaid = ha.holdPaid;   // capped, not failed — don't retry forever
          }
          db.prepare('UPDATE call_hops SET hold_x=?, hold_paid=?, points_paid=?, last_check=? WHERE call_id=? AND user_id=?').run(ha.holdX, hopPaid, hopPts, t, r.id, hop.user_id);
        }
      }
    }
  } catch (e) { console.error('refreshCalls', e); }
  finally { callsRefreshing = false; }
}
function maybeRefreshCalls() { if (now() - lastCallsRefresh > 45000 && !callsRefreshing) { lastCallsRefresh = now(); refreshCalls().catch(() => {}); } }
// leaderboard: rank callers over a window by total Xs earned (rewards both big hits and calling often)
const CALL_WINDOWS = { '24h': 864e5, 'week': 7 * 864e5, 'month': 30 * 864e5, 'year': 365 * 864e5, 'all': null };
function callLeaderboard(windowKey) {
  const ms = CALL_WINDOWS[windowKey]; const since = ms ? now() - ms : 0;
  const rows = db.prepare(`
    SELECT c.user_id, u.username, u.avatar, u.avatar_img, u.accent, u.og, u.og_tier,
           COUNT(*) calls, MAX(MIN(c.peak_price / c.entry_price - 1, ?)) best,
           SUM(MIN(c.peak_price / c.entry_price - 1, ?)) totalX
    FROM calls c JOIN users u ON u.id = c.user_id
    WHERE c.created_at > ? AND c.entry_price > 0 AND c.entry_liq >= ?
    GROUP BY c.user_id ORDER BY totalX DESC, best DESC LIMIT 25`).all(CALL_X_CAP, CALL_X_CAP, since, MIN_CALL_LIQ);
  let rank = 0;
  return rows.map(r => ({
    rank: ++rank, username: r.username, avatar: r.avatar,
    avatar_img: r.avatar_img ? '/uploads/' + r.avatar_img : null, accent: r.accent || '', og: r.og_tier || 0,
    calls: r.calls, bestX: r.best, totalX: r.totalX, bestGrade: callGrade(r.best),
  }));
}
function callStats(userId, me) {
  const rows = db.prepare('SELECT * FROM calls WHERE user_id=? ORDER BY created_at DESC').all(userId);
  const views = rows.map(r => callView(r, me));
  const best = views.reduce((m, v) => v.maxX > (m ? m.maxX : -Infinity) ? v : m, null);
  const totalX = views.reduce((s, v) => s + Math.max(0, v.maxX), 0);
  const hits = views.filter(v => v.maxX >= 2).length; // "solid" or better
  return { count: views.length, bestX: best ? best.maxX : 0, bestGrade: best ? best.grade : null, totalX, hits, calls: views };
}

function acceptsGzip(ae) {
  for (const part of (ae || '').split(',')) {
    const segs = part.trim().split(';').map(s => s.trim());
    if (segs[0].toLowerCase() !== 'gzip') continue;
    const q = segs.slice(1).find(s => s.toLowerCase().startsWith('q='));
    return !q || parseFloat(q.slice(2)) > 0;
  }
  return false;
}
// Best content-encoding the client accepts, preferring Brotli (smaller than gzip for text). Used for STATIC assets,
// which are pre-compressed once and cached; dynamic send() responses stay on fast per-request gzip.
function bestEnc(ae) {
  ae = (ae || '').toLowerCase();
  const has = (name) => ae.split(',').some(p => { const s = p.trim().split(';'); if (s[0].trim() !== name) return false; const q = s.slice(1).find(x => x.trim().startsWith('q=')); return !q || parseFloat(q.trim().slice(2)) > 0; });
  return has('br') ? 'br' : has('gzip') ? 'gzip' : null;
}
const server = http.createServer(async (req, res) => {
  res._gzip = acceptsGzip(req.headers['accept-encoding']); // whether we may gzip this response (read by send/serveFile)
  res._enc = bestEnc(req.headers['accept-encoding']);      // best static-asset encoding (br | gzip | null)
  // ultra-cheap health check for load balancers / uptime monitors — answered before any parsing or DB work
  if (req.url === '/healthz' || req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('{"ok":true}');
  }
  const url = new URL(req.url, BASE_URL);
  const p = url.pathname;
  // only API routes read the session — resolving it for every static asset cost 2 SELECTs × ~21 assets per page load
  const me = p.startsWith('/api/') ? getUser(req) : null;

  // cross-site write protection: browsers always send Origin on mutating fetch/XHR.
  // Reject any Origin that isn't our own (including the opaque "null" origin from
  // sandboxed frames / data: URLs). Requests with no Origin at all come from
  // non-browser clients that carry no ambient session cookie, so they can't be CSRF.
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
    let ok = false;
    try { ok = new URL(req.headers.origin).host === new URL(BASE_URL).host; } catch {}
    // A misconfigured BASE_URL rejects every write on the site — signup, login, posting, all of it — and used
    // to do it in total silence, which reads to the operator as "the app is broken" rather than "one env var
    // is wrong". Say exactly what did not match, in the log, once per offending origin.
    if (!ok) {
      // bounded: the key is an attacker-supplied header, so this must never grow without limit
      if (!csrfWarned.has(req.headers.origin) && csrfWarned.size < 50) {
        csrfWarned.add(req.headers.origin);
        console.warn(`⚠️  CSRF reject: Origin ${req.headers.origin} != BASE_URL host ${(() => { try { return new URL(BASE_URL).host; } catch { return BASE_URL; } })()} — ${req.method} ${p}. If that origin is really this site, BASE_URL is wrong.`);
      }
      return bad(res, 'cross-origin request rejected', 403);
    }
  }

  try {
    if (p.startsWith('/api/')) {
      if (p === '/api/config' && req.method === 'GET') {
        return send(res, 200, {
          auth: {
            wallet: true, email: true,
            google: !!(OAUTH.google.id && OAUTH.google.secret),
            facebook: !!(OAUTH.facebook.id && OAUTH.facebook.secret),
            x: !!(OAUTH.x.id && OAUTH.x.secret),
            instagram: !!(OAUTH.instagram.id && OAUTH.instagram.secret),
          },
          moonpay: process.env.MOONPAY_API_KEY
            ? { widget: `https://buy.moonpay.com?apiKey=${encodeURIComponent(process.env.MOONPAY_API_KEY)}&defaultCurrencyCode=eth` }
            : { widget: null, fallback: 'https://www.moonpay.com/buy/eth' },
        });
      }
      // live "who's active" presence: heartbeat in, active count out (real number, never inflated)
      if (p === '/api/presence' && req.method === 'GET') {
        if (!rateLimit('pres:' + clientIp(req), 240, 6e4)) return send(res, 200, { active: presenceCount() }); // over-eager client → still hand back the count, just don't re-touch
        const pid = String(url.searchParams.get('pid') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
        const key = me ? ('u:' + me.id) : presenceAnonKey(clientIp(req), pid); // one slot per signed-in user (dedupes tabs), else per browser — capped per IP
        presenceTouch(key);
        return send(res, 200, { active: presenceCount() });
      }
      // The OG campaign clock. Public and unauthenticated — the homepage banner used to hard-code the
      // deadline epochs in its HTML beside the server constants, which is exactly the kind of duplicated
      // truth that drifts. Serving them means there is one source: OG_LAUNCH + OG_TIER_END.
      if (p === '/api/og/campaign' && req.method === 'GET') return send(res, 200, ogCampaign());

      /* ===== Data API ===== */
      if (p === '/api/data/eligibility' && req.method === 'GET') {
        if (!me) return bad(res, 'sign in first', 401);
        if (!rateLimit('dkelig:' + me.id, 30, 6e5) || (url.searchParams.get('fresh') === '1' && !rateLimit('dkfresh:' + me.id, 6, 6e5))) return bad(res, 'checking too often — try again shortly', 429);
        const key = db.prepare('SELECT wallet, burned_usd, price_usd, minted_at, last_used_at, expires_at, source FROM api_keys WHERE user_id = ? AND revoked_at IS NULL').get(me.id) || null;
        const th = dataThresholdFor(me);
        let burn = null, error = null;
        if (!th.free) { try { burn = await burnedSend(me.id, url.searchParams.get('fresh') === '1'); } catch { error = 'could not read the chain completely right now — nothing is assumed; try again in a minute'; } }
        const keyLive = !!(key && (key.expires_at == null || key.expires_at > now()) && (key.source !== 'og_gold' || th.free || (key.expires_at != null && key.expires_at > now())));
        return send(res, 200, {
          threshold: th.usd, baseThreshold: DATA_BURN_USD, tier: th.tier, tierName: th.tierName, discountPct: th.discountPct, free: th.free,
          lifeDays: 365, burnAddress: DATA_BURN_ADDR, token: TOK.SEND, burn, error,
          eligible: th.free || !!(burn && burn.priceUsd != null && BigInt(burn.availableWei) >= needWeiFor(th.usd, burn.priceUsd)),
          needTokens: (!th.free && burn && burn.priceUsd != null) ? Number(needWeiFor(th.usd, burn.priceUsd)) / 1e18 : null,
          key: key ? { wallet: key.wallet ? decField(key.wallet) : null, burnedUsd: key.burned_usd, priceUsd: key.price_usd, mintedAt: key.minted_at, lastUsedAt: key.last_used_at,
            expiresAt: key.expires_at, source: key.source, live: keyLive, rotatable: keyLive, daysLeft: key.expires_at == null ? null : Math.max(0, Math.floor((key.expires_at - now()) / 864e5)) } : null,
        });
      }
      if (p === '/api/data/key' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('dkmint:' + me.id, 5, 36e5)) return bad(res, 'too many attempts — try again later', 429);
        if (_minting.has(me.id)) return bad(res, 'a mint is already in progress — wait for it', 409); // two tabs must not hand out a key that the other tab's mint has already revoked
        _minting.add(me.id);
        try {
        // Checked BEFORE the chain read: it is one database query, and a request it refuses must not
        // spend explorer calls first.
        // A burn backs ONE live key at a time, whichever account the wallet is linked to. Without this,
        // unlinking the burned wallet and relinking it to a fresh account minted another live key for the
        // same burn, without limit — every key multiplying the per-key rate limit.
        const myIdx = walletAddresses(me.id).map(w => bidx(w.toLowerCase()));
        const clash = db.prepare('SELECT user_id, wallets_idx FROM api_keys WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND user_id != ?').all(now(), me.id) // an expired key backs nothing
          .find(k => { try { return (JSON.parse(k.wallets_idx || '[]')).some(i => myIdx.includes(i)); } catch { return false; } });
        if (clash) return bad(res, 'a wallet linked here already backs a live key on another account — revoke that key first; a burn backs one key at a time', 409);
        const th = dataThresholdFor(me);
        const prev = db.prepare('SELECT expires_at FROM api_keys WHERE user_id = ? AND revoked_at IS NULL').get(me.id);
        const plain = 'sk_' + rand(24), t = now();
        if (th.free) {
          // Gold OG: free, and no expiry — for as long as the badge is live (dataKeyOf re-checks that on every call)
          // carry over a live paid key's remaining time as a fallback expiry (NULL when there is none)
          const carry = prev && prev.expires_at != null && prev.expires_at > t ? prev.expires_at : null;
          db.exec('BEGIN');
          try {
            db.prepare('UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(t, me.id);
            db.prepare("INSERT INTO api_keys (key_hash, user_id, wallet, burned_wei, burned_usd, price_usd, minted_at, wallets_idx, expires_at, source, consumed_wei) VALUES (?,?,?,?,?,?,?,?,?,'og_gold','0')")
              .run(hashToken(plain), me.id, null, '0', 0, 0, t, '[]', carry);
            db.exec('COMMIT');
          } catch (e) { try { db.exec('ROLLBACK'); } catch {} return bad(res, 'could not mint a key', 500); }
          notify(me.id, '🔑', 'Data API key minted — free with your OG Gold, and it never expires while you stay Gold.' + (carry ? ' The time you had already paid for (until ' + new Date(carry).toUTCString() + ') is kept as a fallback if the badge ever goes.' : '') + ' It was shown once and is not stored anywhere readable; anyone holding it can read your own private data, so keep it secret.', 'wallet');
          return send(res, 200, { key: plain, source: 'og_gold', expiresAt: null, paidUntil: carry, spentUsd: 0, priceUsd: null, wallet: null });
        }
        let burn;
        try { burn = await burnedSend(me.id, true); } catch { return bad(res, 'could not read the chain completely right now — try again in a minute', 502); }
        if (!burn.wallets) return bad(res, 'link a wallet first — the burn is read from your linked wallets', 403);
        if (burn.availableUsd == null) return bad(res, 'the $SEND price cannot be read right now, so the burn cannot be valued — try again', 503);
        // Spend the burn: the tokens worth the threshold at today's price, largest unspent wallet first. The
        // gate and the allocation use the same wei, so "eligible" on the page always means the mint succeeds.
        const needWei = needWeiFor(th.usd, burn.priceUsd);
        if (BigInt(burn.availableWei) < needWei) return bad(res, 'not eligible: $' + burn.availableUsd.toFixed(2) + ' of unspent $SEND burn across your linked wallets; $' + th.usd + ' is required' + (th.discountPct ? ' (your OG ' + th.tierName + ' discount of ' + th.discountPct + '% is already applied)' : ''), 403);
        const alloc = allocateBurn(burn.byWallet.map(w => ({ idx: w.idx, available: BigInt(w.available) })), needWei);
        if (!alloc) return bad(res, 'not eligible: the unspent burn does not cover $' + th.usd + ' at the current price', 403);
        const expiresAt = nextExpiry(prev ? prev.expires_at : null, t);
        db.exec('BEGIN');
        try {
          db.prepare('UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(t, me.id); // one live key per account
          db.prepare("INSERT INTO api_keys (key_hash, user_id, wallet, burned_wei, burned_usd, price_usd, minted_at, wallets_idx, expires_at, source, consumed_wei) VALUES (?,?,?,?,?,?,?,?,?,'burn',?)")
            .run(hashToken(plain), me.id, burn.topWallet ? encField(burn.topWallet) : null, burn.wei, th.usd, burn.priceUsd, t, JSON.stringify(myIdx), expiresAt, needWei.toString()); // the wallet is a wallet↔account link: encrypted like every other one
          for (const a of alloc) db.prepare('INSERT INTO api_key_burns (key_hash, wallet_idx, wei) VALUES (?,?,?)').run(hashToken(plain), a.idx, a.wei.toString());
          db.exec('COMMIT');
        } catch (e) { try { db.exec('ROLLBACK'); } catch {} return bad(res, 'could not mint a key', 500); }
        burnCache.delete(me.id); burnBump.set(me.id, now());   // the unspent balance just changed — and any read already in flight must not re-cache the old one
        notify(me.id, '🔑', 'Data API key ' + (prev && prev.expires_at != null && prev.expires_at > t ? 'renewed — a year added, now good until ' : 'minted for a year, until ') + new Date(expiresAt).toUTCString() + ' — it spent $' + th.usd + ' of your $SEND burn. It was shown once and is not stored anywhere readable; anyone holding it can read your own private data, so keep it secret.', 'wallet');
        return send(res, 200, { key: plain, source: 'burn', expiresAt, spentUsd: th.usd, spentTokens: Number(needWei) / 1e18, priceUsd: burn.priceUsd, wallet: burn.topWallet, discountPct: th.discountPct });
        } finally { _minting.delete(me.id); }
      }
      // The answer to a leaked key is a NEW SECRET, not a new purchase: the same expiry, the same source,
      // nothing spent. Revoking and minting again would have cost the paid remainder.
      if (p === '/api/data/key/rotate' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        if (!rateLimit('dkrot:' + me.id, 10, 36e5)) return bad(res, 'rotating too often — try again later', 429);
        const cur = db.prepare('SELECT * FROM api_keys WHERE user_id = ? AND revoked_at IS NULL').get(me.id);
        if (!cur) return bad(res, 'no key to rotate', 404);
        const th = dataThresholdFor(me), t = now();
        const live = (cur.expires_at == null || cur.expires_at > t) && (cur.source !== 'og_gold' || th.free || (cur.expires_at != null && cur.expires_at > t));
        if (!live) return bad(res, 'that key is no longer active — mint a new one', 409);
        const plain = 'sk_' + rand(24);
        db.exec('BEGIN');
        try {
          db.prepare('UPDATE api_keys SET revoked_at = ? WHERE key_hash = ?').run(t, cur.key_hash);
          db.prepare('INSERT INTO api_keys (key_hash, user_id, wallet, burned_wei, burned_usd, price_usd, minted_at, wallets_idx, expires_at, source, consumed_wei) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
            .run(hashToken(plain), me.id, cur.wallet, cur.burned_wei, cur.burned_usd, cur.price_usd, cur.minted_at, cur.wallets_idx, cur.expires_at, cur.source, cur.consumed_wei);
          db.prepare('UPDATE api_key_burns SET key_hash = ? WHERE key_hash = ?').run(hashToken(plain), cur.key_hash); // the ledger follows the key
          db.exec('COMMIT');
        } catch (e) { try { db.exec('ROLLBACK'); } catch {} return bad(res, 'could not rotate the key', 500); }
        notify(me.id, '🔑', 'Data API key rotated — the old secret stops working now; the new one keeps the same expiry and spent nothing. Shown once on the Data API page.', 'wallet');
        return send(res, 200, { key: plain, source: cur.source, expiresAt: cur.expires_at });
      }
      if (p === '/api/data/key/revoke' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        const r = db.prepare('UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now(), me.id);
        return send(res, 200, { ok: true, revoked: r.changes });
      }
      const dm = /^\/api\/data\/v1\/([a-z]+)$/.exec(p);
      if (dm && req.method === 'GET') {
        const k = dataKeyOf(req);
        if (!k) return bad(res, 'a valid Data API key is required — Authorization: Bearer sk_…', 401);
        if (!rateLimit('dk:' + k.key_hash, DATA_KEY_RATE, 60000)) return bad(res, 'rate limit: ' + DATA_KEY_RATE + ' requests per minute per key', 429);
        const limit = Math.min(DATA_PAGE_MAX, Math.max(1, Number(url.searchParams.get('limit')) || 100));
        const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
        const page = (rows, idOf) => ({ data: rows, next: rows.length === limit ? idOf(rows[rows.length - 1]) : null, limit });
        const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(k.user_id);
        if (!owner) return bad(res, 'key owner no longer exists', 401);
        switch (dm[1]) {
          case 'me': return send(res, 200, { data: ownDataView(owner), generatedAt: now() });
          case 'users': { const rows = db.prepare('SELECT * FROM users WHERE system = 0 AND id < ? ORDER BY id DESC LIMIT ?').all(before, limit); return send(res, 200, page(rows.map(publicUserView), r => r.id)); }
          // a holders-only post is another user's private data: the key opens public data in bulk plus the key
          // holder's OWN private data, so the owner's own posts come through and nobody else's do
          case 'posts': { const rows = db.prepare('SELECT * FROM posts WHERE id < ? AND (private = 0 OR user_id = ?) ORDER BY id DESC LIMIT ?').all(before, owner.id, limit); return send(res, 200, page(rows.map(p => ({ ...postView(p, null), community_id: p.community_id || null })), r => r.id)); }
          case 'comments': { const rows = db.prepare('SELECT c.id, c.post_id, c.text, c.tokens, c.created_at, u.username FROM comments c JOIN users u ON u.id = c.user_id JOIN posts po ON po.id = c.post_id WHERE c.id < ? AND (po.private = 0 OR po.user_id = ?) ORDER BY c.id DESC LIMIT ?').all(before, owner.id, limit); return send(res, 200, page(rows.map(c => ({ ...c, tokens: parseTokens(c.tokens) })), r => r.id)); } // the discussion under a holders-only post is private too
          case 'calls': { const rows = db.prepare('SELECT c.*, u.username FROM calls c JOIN users u ON u.id = c.user_id WHERE c.id < ? ORDER BY c.id DESC LIMIT ?').all(before, limit); return send(res, 200, page(rows.map(r => ({ username: r.username, ...callView(r, null) })), r => r.id)); }
          case 'communities': { const rows = db.prepare('SELECT * FROM communities WHERE id < ? ORDER BY id DESC LIMIT ?').all(before, limit); return send(res, 200, page(rows.map(c => communityCardView(c, null)), r => r.id)); }
          case 'leaderboard': { const rows = db.prepare('SELECT * FROM users WHERE points > 0 AND system = 0 ORDER BY points DESC, id ASC LIMIT ?').all(limit); return send(res, 200, { data: rows.map((u, i) => ({ rank: i + 1, ...publicUserView(u) })), limit }); }
          case 'competition': { const { win, rows } = competitionStandings(); return send(res, 200, { data: { week: { key: win.key, startsAt: win.startsAt, endsAt: win.endsAt }, standings: rows.slice(0, 20).map(r => ({ rank: r.rank, username: r.username, points: r.pts })), last: lastSettledCompetition(), prize: { winners: WEEK_WINNERS, ladder: WEEK_PRIZES } } }); } // top 20 only — the same window the public board shows; the key changes the shape, never the scope
          default: return bad(res, 'unknown resource — one of: me, users, posts, comments, calls, communities, leaderboard, competition', 404);
        }
      }
      if (p === '/api/me' && req.method === 'GET') {
        if (!me) return bad(res, 'not signed in', 401);
        return send(res, 200, {
          user: {
            username: me.username, avatar: me.avatar, bio: me.bio, auto_named: !!me.auto_named,
            methods: identityTypes(me.id), wallets: walletAddresses(me.id),
            twofa: me.twofa_method || null,
            mutes: mutedNames(me.id), // usernames this user has muted (private to them)
            theme: themeOf(me),
            tracker_prefs: safeJson(decField(me.tracker_prefs)),
            site_prefs: safeJson(decField(me.site_prefs)),
            twitter: me.twitter_handle || null, instagram: me.ig_handle || null,
            points: me.points, level: levelForXp(me.points), title: titleFor(levelForXp(me.points)), // for the nav badge
            og: me.og_tier || 0, // permanent OG badge + 10× Send Power (verified early buyer)
            restriction: restrictionOf(me), // read-only banner state (null when free to act)
            probation: probationOf(me), // "hold your bought $SEND" window after a redemption (null when none)
            callAllowance: callAllowance(me), // dynamic Send Call allowance (limit/used/remaining/resetAt + diamond boost)
            checkedInToday: !!db.prepare('SELECT 1 FROM points_events WHERE ref = ?').get('daily:' + me.id + ':' + ymd()),
            arcade: arcadeState(me.id),        // today's Rocket Run boost (nav badge + arcade page)
            boost: effectiveMult(me.id),       // {holder, og, community, arcade, total} — the nav badge shows total
          },
        });
      }
      if (p === '/api/username-check' && req.method === 'GET') {
        if (!rateLimit('ucheck:' + clientIp(req), 120, 6e4)) return bad(res, 'slow down', 429);
        const u = url.searchParams.get('u') || '';
        if (!USERNAME_RE.test(u)) return send(res, 200, { available: false, reason: '3–24 chars: letters, numbers, _ . -' });
        return send(res, 200, { available: !usernameTaken(u) || !!(me && me.username.toLowerCase() === u.toLowerCase()) });
      }

      /* ----- email auth (identifier = email OR username) ----- */
      if (p === '/api/auth/register' && req.method === 'POST') {
        if (!rateLimit('reg:' + clientIp(req), 10, 36e5)) return bad(res, 'slow down', 429);
        const b = await readBody(req);
        const email = String(b.email || '').trim().toLowerCase();
        const username = String(b.username || '').trim();
        const password = String(b.password || '');
        if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'enter a valid email');
        if (!USERNAME_RE.test(username)) return bad(res, 'username must be 3–24 chars: letters, numbers, _ . -');
        if (usernameTaken(username)) return bad(res, 'that username is taken — try another');
        if (password.length < 8) return bad(res, 'password needs at least 8 characters');
        if (password.length > MAX_PW) return bad(res, 'password is too long');
        if (findIdentity('email', email)) return bad(res, 'that email already has an account — sign in instead');
        const userId = createUser(username, false);
        insertIdentity(userId, 'email', email, hashPassword(password));
        return send(res, 200, { ok: true, username }, { 'Set-Cookie': sessionCookie(createSession(userId)) });
      }
      if (p === '/api/auth/login' && req.method === 'POST') {
        if (!rateLimit('login:' + clientIp(req), 20, 9e5)) return bad(res, 'slow down', 429);
        const b = await readBody(req);
        const idf = String(b.identifier || b.email || '').trim().slice(0, 254);
        const password = String(b.password || '');
        let ident;
        if (idf.includes('@')) {
          ident = findIdentity('email', idf.toLowerCase());
        } else {
          const u = db.prepare('SELECT id FROM users WHERE username = ?').get(idf);
          if (u) ident = db.prepare('SELECT * FROM identities WHERE type = ? AND user_id = ?').get('email', u.id);
        }
        if (!ident) { dummyCheck(password); return bad(res, 'wrong credentials', 401); } // equalize timing vs real-account path
        if (!checkPassword(password, ident.secret)) return bad(res, 'wrong credentials', 401);
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(ident.user_id);
        if (u.twofa_method && u.twofa_method !== 'password') { // the password was just proven — it can't be the second factor of itself
          const pend = rand(16);
          const entry = { userId: u.id, expires: now() + 3e5 };
          const extra = {};
          if (u.twofa_method === 'wallet') {
            extra.wallets = walletAddresses(u.id);
            /* One EIP-4361 challenge per linked wallet, because the format binds the address in line 2 and any
               of this account's wallets may be the one connected. The client picks the message matching the
               wallet it connected; the server then verifies against THAT message, so a signature for one
               address can never be replayed as another. (Previously this was a single hand-rolled string —
               domain-bound in its text but unparseable, so the wallet drew an opaque blob instead of a
               sign-in panel.) pendingLogins is in-memory, so there is nothing to migrate. */
            entry.messages = {};
            for (const w of extra.wallets) entry.messages[w] = signInMessage(w, pend, 'Two-factor confirmation for JustSendIt. This signature never moves funds and grants no token approvals.');
            extra.messages = entry.messages;
          }
          pendingLogins.set(pend, entry);
          return send(res, 200, { twofa: u.twofa_method, pending: pend, ...extra });
        }
        return send(res, 200, { ok: true, username: u.username }, { 'Set-Cookie': sessionCookie(createSession(u.id)) });
      }
      if (p === '/api/auth/login/totp' && req.method === 'POST') {
        if (!rateLimit('totp:' + clientIp(req), 30, 9e5)) return bad(res, 'too many attempts — slow down', 429);
        const b = await readBody(req);
        const pend = pendingLogins.get(String(b.pending || ''));
        if (!pend || pend.expires < now()) return bad(res, '2FA session expired — sign in again', 401);
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(pend.userId);
        if (!u || u.twofa_method !== 'totp' || !totpVerify(decField(u.twofa_secret), b.code)) {
          // burn one of a small number of tries per pending token, then invalidate it
          pend.tries = (pend.tries || 0) + 1;
          if (pend.tries >= 5) pendingLogins.delete(String(b.pending));
          return bad(res, 'wrong code — try again', 401);
        }
        pendingLogins.delete(String(b.pending));
        return send(res, 200, { ok: true, username: u.username }, { 'Set-Cookie': sessionCookie(createSession(u.id)) });
      }
      /* An OAuth sign-in that hit a second factor parked its challenge in an HttpOnly cookie and bounced the
         browser to /?twofa=1. This hands that challenge to the page so the SAME 2FA panel the email/password
         flow uses can finish it. The cookie is cleared on read: one redirect, one pickup. */
      if (p === '/api/auth/2fa/pending' && req.method === 'GET') {
        const clear = { 'Set-Cookie': `oauth_2fa=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecure()}` };
        const pend = parseCookies(req.headers.cookie).oauth_2fa || '';
        const entry = pend && pendingLogins.get(pend);
        if (!entry || entry.expires < now()) return send(res, 200, { twofa: null }, clear);
        const u = db.prepare('SELECT twofa_method, username FROM users WHERE id = ?').get(entry.userId);
        if (!u || !u.twofa_method) return send(res, 200, { twofa: null }, clear);
        const extra = u.twofa_method === 'wallet' ? { wallets: walletAddresses(entry.userId), messages: entry.messages } : {};
        return send(res, 200, { twofa: u.twofa_method, pending: pend, username: u.username, ...extra }, clear);
      }
      if (p === '/api/auth/login/wallet2fa' && req.method === 'POST') {
        if (!rateLimit('w2fa:' + clientIp(req), 30, 9e5)) return bad(res, 'too many attempts — slow down', 429);
        const b = await readBody(req);
        const pend = pendingLogins.get(String(b.pending || ''));
        if (!pend || pend.expires < now()) return bad(res, '2FA session expired — sign in again', 401);
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(pend.userId);
        if (!u || u.twofa_method !== 'wallet') return bad(res, 'wallet 2FA not enabled', 400);
        // the exact EIP-4361 text we issued FOR THIS ADDRESS — a signature made for one wallet's challenge
        // cannot be presented as another's, because each carries its own address in line 2
        const addr = String(b.address || '').toLowerCase();
        const message = pend.messages && pend.messages[addr];
        if (!message) return bad(res, 'sign with a wallet linked to this account', 401);
        let recovered;
        try { recovered = verifyMessage(message, String(b.signature || '')).toLowerCase(); }
        catch { return bad(res, 'bad signature'); }
        if (recovered !== addr) return bad(res, 'signature does not match that wallet', 401);
        if (!walletAddresses(u.id).includes(recovered)) return bad(res, 'that wallet is not linked to this account', 401);
        // Same rule the 2FA-management path enforces (verifyCurrentFactor): only a wallet linked BEFORE
        // two-factor was switched on counts as the second factor. Without this, an attacker holding a
        // stolen session cookie can link a fresh wallet of their own and then use it to satisfy 2FA —
        // which makes the factor worth nothing. Pre-migration rows (NULL timestamps) keep legacy behaviour.
        const w2 = db.prepare("SELECT linked_at FROM identities WHERE user_id = ? AND type = 'wallet' AND identifier = ?").get(u.id, bidx(recovered));
        if (w2 && w2.linked_at && u.twofa_enabled_at && w2.linked_at > u.twofa_enabled_at) {
          return bad(res, 'that wallet was linked after two-factor was turned on — sign with the wallet you enabled it with', 401);
        }
        pendingLogins.delete(String(b.pending));
        return send(res, 200, { ok: true, username: u.username }, { 'Set-Cookie': sessionCookie(createSession(u.id)) });
      }
      // second factor = the account password (for wallet-first accounts that added an email + password)
      if (p === '/api/auth/login/password2fa' && req.method === 'POST') {
        if (!rateLimit('pw2fa:' + clientIp(req), 20, 9e5)) return bad(res, 'too many attempts — slow down', 429);
        const b = await readBody(req);
        const pend = pendingLogins.get(String(b.pending || ''));
        if (!pend || pend.expires < now()) return bad(res, '2FA session expired — sign in again', 401);
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(pend.userId);
        const e = u && emailIdentity(u.id);
        if (!u || u.twofa_method !== 'password' || !e || !checkPassword(String(b.password || ''), e.secret)) {
          pend.tries = (pend.tries || 0) + 1;
          if (pend.tries >= 5) pendingLogins.delete(String(b.pending));
          return bad(res, 'wrong password — try again', 401);
        }
        pendingLogins.delete(String(b.pending));
        return send(res, 200, { ok: true, username: u.username }, { 'Set-Cookie': sessionCookie(createSession(u.id)) });
      }
      if (p === '/api/auth/logout' && req.method === 'POST') {
        if (me) db.prepare('DELETE FROM sessions WHERE token = ?').run(hashToken(me.sid));
        return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; HttpOnly; Max-Age=0' });
      }
      // Unlink ALL linked wallets from the account (the nav "Disconnect wallet"). Guarded so it can't lock you out or
      // strand wallet-2FA. Reversible — the user can re-link by signing again. Holder streak resets (we can no longer
      // verify holdings), which the boost logic already treats as honest.
      if (p === '/api/wallet/disconnect' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        const wallets = walletAddresses(me.id);
        if (!wallets.length) return send(res, 200, { ok: true, wallets: [] }); // nothing linked → no-op
        if (!identityTypes(me.id).some(m => m !== 'wallet')) return bad(res, 'add an email + password first — your wallet is your only way to sign in, so disconnecting it would lock you out', 400);
        if (me.twofa_method === 'wallet') return bad(res, 'turn off wallet two-factor in your profile settings first, then disconnect', 400);
        // OG = held BOTH $SEND & $GWC early; selling out of EITHER revokes it permanently. Disconnecting while still holding
        // both is honest (keep OG); disconnecting AFTER selling out must still revoke — so check on-chain NOW, while the
        // wallet is still linked/readable (done before BEGIN; a transient RPC error fails safe = keep OG). Closes the
        // sell-then-disconnect-then-relink dodge without punishing honest privacy disconnects.
        let revokeOg = false;
        forgetHoldings(me.id); // decide from the CHAIN, not a ≤5-min cached "held" that may predate a sell
        if (me.og && !me.og_revoked) { try { const [hs, hg] = await Promise.all([holdsToken(me.id, TOK.SEND), holdsToken(me.id, TOK.GWC)]); if (!hs || !hg) revokeOg = true; } catch {} }
        try {
          db.exec('BEGIN');
          // the badge follows the WALLET: it always comes off on disconnect (relinking re-verifies on-chain via checkOg and
          // re-grants honestly), and is only marked permanently revoked when the wallet was found to have sold out.
          // Otherwise one early-buyer wallet could be linked → disconnected → relinked on unlimited accounts, cloning OG.
          // og_tier clears with og: the tier IS the badge, and leaving it set would keep paying the
          // multiplier through effectiveMult() after the wallet behind it is gone.
          db.prepare('UPDATE users SET og = 0, og_tier = 0' + (revokeOg ? ', og_revoked = 1' : '') + ' WHERE id = ?').run(me.id);
          db.prepare("DELETE FROM identities WHERE user_id = ? AND type = 'wallet'").run(me.id);
          forgetHoldings(me.id); // no cached "holds $X" may survive the wallets it was read from
          db.prepare('DELETE FROM holder_state WHERE user_id = ?').run(me.id); // boost was verified against those wallets → reset it honestly
          // Community qualification is holdings-gated (qualifyOptIn requires on-chain holdings); with no wallet the user can
          // hold nothing verifiable, so void it NOW rather than waiting on the 10-min sweep — else the flat 10× lingers and
          // go-live could re-credit a qualified row that no longer holds. Mirrors sweepCommunityHolders' revoke.
          for (const q of db.prepare('SELECT community_id FROM community_members WHERE user_id = ? AND qualified = 1').all(me.id))
            db.prepare('UPDATE communities SET qual_count = MAX(qual_count-1,0) WHERE id = ?').run(q.community_id);
          db.prepare('UPDATE community_members SET qualified = 0, qual_check_at = ? WHERE user_id = ? AND qualified = 1').run(now(), me.id);
          db.prepare('UPDATE users SET live_comm_count = 0 WHERE id = ?').run(me.id);
          db.exec('COMMIT');
        } catch (e) { try { db.exec('ROLLBACK'); } catch {} return bad(res, 'could not disconnect right now — try again', 500); }
        if (me.og && !revokeOg) notify(me.id, '🔌', 'OG badge paused — it follows your wallet. Relink your early-buyer wallet to restore it (verified on-chain).', 'og'); // honest: "permanent" means never expires, not "survives having no wallet"
        return send(res, 200, { ok: true, wallets: [] });
      }

      /* ----- 2FA management ----- */
      if (p === '/api/2fa/totp/setup' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        // replacing an existing factor must pass the current one (a stolen cookie alone can't swap the authenticator)
        if (me.twofa_method) { let b = {}; try { b = await readBody(req); } catch {} const err = await verifyCurrentFactor(me, b); if (err) return bad(res, err, 401); }
        const secret = b32encode(crypto.randomBytes(20));
        db.prepare('UPDATE users SET twofa_pending = ? WHERE id = ?').run(encField(secret), me.id); // staged (encrypted) — the live secret is untouched until /enable proves a code
        const uri = `otpauth://totp/JustSendIt:${encodeURIComponent(me.username)}?secret=${secret}&issuer=JustSendIt&digits=6&period=30`;
        const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
        return send(res, 200, { secret, uri, qr });
      }
      if (p === '/api/2fa/totp/enable' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        const b = await readBody(req);
        if (!me.twofa_pending) return bad(res, 'run setup first');
        if (!totpVerify(decField(me.twofa_pending), b.code)) return bad(res, 'wrong code — check your authenticator app');
        db.prepare("UPDATE users SET twofa_method = 'totp', twofa_secret = twofa_pending, twofa_pending = NULL, twofa_enabled_at = ? WHERE id = ?").run(now(), me.id); // promote only on proof
        return send(res, 200, { ok: true });
      }
      if (p === '/api/2fa/wallet/enable' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        if (!walletAddresses(me.id).length) return bad(res, 'link a wallet to your account first');
        let b = {}; try { b = await readBody(req); } catch {}
        const addr = String(b.address || '').toLowerCase();
        if (!walletAddresses(me.id).includes(addr)) return bad(res, 'sign with a wallet linked to this account to turn wallet two-factor on', 400);

        /* This is the most destructive switch on the site: once it is on, signing in, turning it off and
           disconnecting the wallet ALL require a signature from a qualifying wallet, and there is no password
           reset. So it must be provable that the person flipping it is the account's owner and not somebody
           holding a borrowed session — asking only for a signature from "a linked wallet" is not that, because
           attaching a wallet is itself something a session can do.
             · an account with a password proves it with the password (or its current factor, if it has one)
             · a wallet-only account proves it with a wallet that PREDATES the session making the request,
               so a wallet attached by a stolen cookie can never be the one that locks the door
           Both are checked before anything is written. */
        let alreadyProved = false;   // the current-factor check may itself have proved this exact wallet
        if (me.twofa_method) {
          const cur = b.current || b;
          const err = await verifyCurrentFactor(me, cur); if (err) return bad(res, err, 401);
          // wallet→wallet: verifyCurrentFactor consumed the nonce for this address, and nonces are one row per
          // address, so asking for a second signature here could never succeed. That proof already stands.
          if (me.twofa_method === 'wallet' && String(cur.address || '').toLowerCase() === addr) alreadyProved = true;
        } else if (emailIdentity(me.id)) {
          const e = emailIdentity(me.id);
          if (!checkPassword(String((b.current && b.current.password) || b.password || ''), e.secret)) {
            return bad(res, 'enter your account password to turn wallet two-factor on', 401);
          }
        } else {
          const w0 = db.prepare("SELECT linked_at FROM identities WHERE user_id = ? AND type = 'wallet' AND identifier = ?").get(me.id, bidx(addr));
          if (w0 && w0.linked_at && me.sid_at && w0.linked_at > me.sid_at) {
            return bad(res, 'that wallet was linked during this session — sign in again with it first, so a borrowed session can never lock you out of your own account', 401);
          }
        }

        /* And prove control of the wallet being bound, right now. Without this, one click bound a wallet whose
           seed might already be gone — locking the owner out with no warning. Note the fresh signature is read
           from b.signature; when the account already had wallet 2FA, verifyCurrentFactor above consumed its own
           nonce, so this takes a separate one issued for this address. */
        if (!alreadyProved) {
          const proof = consumeNonce(addr, b.signature, '2fa-on');   // a sign-in signature cannot arm the lock
          if (proof.error) return bad(res, proof.error, 401);
        }
        db.prepare("UPDATE users SET twofa_method = 'wallet', twofa_secret = NULL, twofa_pending = NULL, twofa_enabled_at = ? WHERE id = ?").run(now(), me.id); // wallets linked after this instant can't serve as the factor
        return send(res, 200, { ok: true });
      }
      if (p === '/api/2fa/disable' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        const b = await readBody(req);
        // disabling 2FA must itself pass the second factor, so a hijacked session alone can't strip it
        const err = await verifyCurrentFactor(me, b); if (err) return bad(res, err, 401);
        db.prepare('UPDATE users SET twofa_method = NULL, twofa_secret = NULL, twofa_pending = NULL, twofa_enabled_at = NULL WHERE id = ?').run(me.id);
        return send(res, 200, { ok: true });
      }
      // Password as the second factor for WALLET sign-ins (wallet-first users who added an email + password)
      if (p === '/api/2fa/password/enable' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        const b = await readBody(req);
        const e = emailIdentity(me.id);
        if (!e) return bad(res, 'add an email + password to your account first (Profile → Security)');
        if (!checkPassword(String(b.password || ''), e.secret)) return bad(res, 'wrong password', 401);
        if (me.twofa_method && me.twofa_method !== 'password') { const err = await verifyCurrentFactor(me, b); if (err) return bad(res, err, 401); }
        db.prepare("UPDATE users SET twofa_method = 'password', twofa_secret = NULL, twofa_pending = NULL, twofa_enabled_at = ? WHERE id = ?").run(now(), me.id);
        return send(res, 200, { ok: true });
      }
      // Wallet-first accounts add an email + password: a second way in, and the prerequisite for password-2FA and for
      // disconnecting the wallet without locking yourself out. Never changes an existing email.
      if (p === '/api/account/email' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        if (!rateLimit('addemail:' + me.id, 10, 36e5)) return bad(res, 'slow down', 429);
        const b = await readBody(req);
        if (emailIdentity(me.id)) return bad(res, 'this account already has an email + password');
        const email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
        if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'enter a valid email');
        if (password.length < 8) return bad(res, 'password needs at least 8 characters');
        if (password.length > MAX_PW) return bad(res, 'password is too long');
        if (me.twofa_method) { const err = await verifyCurrentFactor(me, b); if (err) return bad(res, err, 401); } // adding a login credential = a 2FA-gated change
        if (findIdentity('email', email)) return bad(res, 'that email already belongs to another account');
        insertIdentity(me.id, 'email', email, hashPassword(password));
        return send(res, 200, { ok: true, methods: identityTypes(me.id) });
      }
      /* ----- moderation: mute / unmute (private to the muter; the muted user is never told) ----- */
      if (p === '/api/mutes' && req.method === 'GET') {
        if (!me) return bad(res, 'sign in first', 401);
        return send(res, 200, { mutes: mutedNames(me.id) });
      }
      const mmute = /^\/api\/mutes\/([^/]+)$/.exec(p); // (own name: the handler's `let m` is declared further down — TDZ)
      if (mmute && (req.method === 'POST' || req.method === 'DELETE')) {
        if (!me) return bad(res, 'sign in first', 401);
        if (!rateLimit('mute:' + me.id, 60, 6e5)) return bad(res, 'slow down', 429);
        let uname; try { uname = decodeURIComponent(mmute[1]); } catch { return bad(res, 'bad username', 400); }
        const u = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(uname);
        if (!u) return bad(res, 'no such user', 404);
        if (u.id === me.id) return bad(res, 'you cannot mute yourself');
        if (req.method === 'POST') db.prepare('INSERT OR IGNORE INTO mutes (user_id, muted_id, created_at) VALUES (?,?,?)').run(me.id, u.id, now());
        else db.prepare('DELETE FROM mutes WHERE user_id = ? AND muted_id = ?').run(me.id, u.id);
        return send(res, 200, { muted: req.method === 'POST', mutes: mutedNames(me.id) });
      }
      /* ----- wallet-tracker report cache: the browser computes a report from chain data; we keep it (encrypted) so the
              next open is instant, then it refreshes live in the background ----- */
      if (p === '/api/tracker/cache' && req.method === 'GET') {
        if (!me) return bad(res, 'sign in first', 401);
        const address = String(url.searchParams.get('address') || '').toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(address)) return bad(res, 'bad address');
        const row = db.prepare('SELECT report, updated_at FROM tracker_cache WHERE user_id = ? AND addr_idx = ?').get(me.id, bidx(address));
        if (!row) return send(res, 200, { report: null });
        let report = null; try { report = JSON.parse(decField(row.report)); } catch {}
        return send(res, 200, { report, updatedAt: row.updated_at });
      }
      if (p === '/api/tracker/cache' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        if (!rateLimit('trkcache:' + me.id, 60, 6e5)) return bad(res, 'slow down', 429);
        const b = await readBody(req, 1024 * 1024);
        const address = String(b.address || '').toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(address)) return bad(res, 'bad address');
        if (!db.prepare('SELECT 1 FROM tracked_wallets WHERE user_id = ? AND address = ?').get(me.id, bidx(address))) return bad(res, 'track that wallet first', 403);
        const json = JSON.stringify(b.report || null);
        if (!b.report || typeof b.report !== 'object' || json.length > 400 * 1024) return bad(res, 'report missing or too large');
        db.prepare('INSERT INTO tracker_cache (user_id, addr_idx, report, updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id, addr_idx) DO UPDATE SET report = excluded.report, updated_at = excluded.updated_at').run(me.id, bidx(address), encField(json), now());
        return send(res, 200, { ok: true, updatedAt: now() });
      }

      /* ----- wallet auth ----- */
      if (p === '/api/auth/wallet/nonce' && req.method === 'GET') {
        if (!rateLimit('nonce:' + clientIp(req), 60, 9e5)) return bad(res, 'slow down', 429);
        const address = String(url.searchParams.get('address') || '').toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(address)) return bad(res, 'bad address');
        // the purpose decides the sentence the wallet shows AND what the resulting signature may be used for
        return send(res, 200, { message: issueNonce(address, String(url.searchParams.get('purpose') || 'signin')) }); // EIP-4361, stored encrypted, 10-minute expiry
      }
      if (p === '/api/auth/wallet/verify' && req.method === 'POST') {
        if (!rateLimit('wverify:' + clientIp(req), 60, 9e5)) return bad(res, 'slow down', 429);
        const b = await readBody(req);
        const address = String(b.address || '').toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(address)) return bad(res, 'bad address');
        const sig = consumeNonce(address, b.signature, me ? 'link' : 'signin');   // signed in ⇒ this is a link, not a sign-in
        if (sig.error) return bad(res, sig.error, 401);
        let ident = findIdentity('wallet', address);
        // a SIGNED-IN user linking a wallet that already belongs to an account must never be silently switched to that
        // account (a Set-Cookie here would swap their session under the current page)
        if (me && ident) {
          if (ident.user_id === me.id) return send(res, 200, { ok: true, linked: true, alreadyLinked: true, username: me.username });
          return bad(res, 'that wallet is already linked to another account — sign out and sign in with it, or disconnect it from that account first', 409);
        }
        let userId, username;
        if (ident) {
          userId = ident.user_id;
          username = db.prepare('SELECT username FROM users WHERE id = ?').get(userId).username;
        } else if (me) {
          if (walletAddresses(me.id).length >= MAX_LINKED_WALLETS) return bad(res, 'you can link up to ' + MAX_LINKED_WALLETS + ' wallets — tap Disconnect wallet to start over');
          /* Linking a wallet ADDS A WAY INTO THE ACCOUNT, so it has to pass whatever already guards the account.
             Without this, a stolen session cookie was enough to attach an attacker's own wallet — and from there
             to enable wallet 2FA with it and lock the real owner out for good, since every exit then demands a
             signature only the attacker can produce. /api/account/email is gated for exactly this reason; the
             wallet door was not. A curl request sends no Origin header, so the CSRF check never covered it. */
          if (me.twofa_method) { const err = await verifyCurrentFactor(me, b.current || {}); if (err) return bad(res, 'to link a wallet, ' + err, 401); }
          insertIdentity(me.id, 'wallet', address);
          forgetHoldings(me.id); // a cached "doesn't hold" must not hide the bag in the wallet they just linked
          // connect points are earned only by a wallet that actually HOLDS $SEND/$GWC on-chain, and never
          // while read-only — so an empty throwaway keypair (or a flagged account) can't farm the bonus.
          let sendBal = 0, gwcHeld = false;
          try { sendBal = Number(await erc20Balance(TOK.SEND, address)) / 1e18; gwcHeld = (await erc20Balance(TOK.GWC, address)) > 0n; } catch {}
          if ((sendBal > 0 || gwcHeld) && !restrictionOf(me)) awardPoints(me.id, 'connect_wallet', PTS.connect_wallet, 'connect:' + address); // once per address ever
          // if this wallet is linked mid-restriction/probation, its $SEND is PRE-EXISTING — fold it into the redemption
          // baseline (so linking a bag can't fake the "buy $SEND" requirement) and into any active hold floor (so its
          // balance must be maintained too). Only when the baseline is already known (>=0); an unknown baseline is set at redeem.
          if (sendBal > 0 && (restrictionOf(me) || probationOf(me))) {
            db.prepare('UPDATE users SET redeem_base_send = redeem_base_send + ? WHERE id=? AND redeem_base_send >= 0').run(sendBal, me.id);
            db.prepare('UPDATE users SET redeem_floor = redeem_floor + ? WHERE id=? AND redeem_hold_until > 0').run(sendBal, me.id);
          }
          balCache.delete(me.id); // the linked wallet set grew — recompute nav balances on next fetch
          checkOg(me.id).catch(() => {}); // a newly linked wallet might be an early buyer → verify OG in the background
          return send(res, 200, { ok: true, linked: true, username: me.username });
        } else {
          username = autoUsername();
          userId = createUser(username, true);
          insertIdentity(userId, 'wallet', address);
          db.prepare('INSERT OR IGNORE INTO tracked_wallets (user_id, address, address_enc, label, created_at) VALUES (?,?,?,?,?)').run(userId, bidx(address), encField(address), 'My wallet', now());
          awardPoints(userId, 'connect_wallet', PTS.connect_wallet, 'connect:' + address);
          checkOg(userId).catch(() => {}); // brand-new wallet account might be an early buyer → verify OG in the background
        }
        // an existing account with a NON-wallet second factor (authenticator / password) must still pass it — a wallet
        // signature alone is the first factor here, not both
        if (ident) {
          const u2 = db.prepare('SELECT twofa_method, twofa_enabled_at FROM users WHERE id = ?').get(userId);
          if (u2 && u2.twofa_method && u2.twofa_method !== 'wallet') {
            const pend = rand(16);
            pendingLogins.set(pend, { userId, expires: now() + 3e5 });
            return send(res, 200, { twofa: u2.twofa_method, pending: pend, username });
          }
          /* On a wallet-2FA account the wallet IS the factor — but only a wallet linked BEFORE two-factor was
             switched on. verifyCurrentFactor and /api/auth/login/wallet2fa both enforce that; this door did not,
             so a wallet attached with a stolen cookie stayed a factor-free way in long after the session that
             attached it was revoked. Same shape as the OAuth hole: a second factor with an unguarded side
             entrance is not a second factor. */
          if (u2 && u2.twofa_method === 'wallet' && u2.twofa_enabled_at) {
            const w = db.prepare("SELECT linked_at FROM identities WHERE user_id = ? AND type = 'wallet' AND identifier = ?").get(userId, bidx(address));
            if (w && w.linked_at && w.linked_at > u2.twofa_enabled_at) {
              return bad(res, 'that wallet was linked after two-factor was turned on — sign in with the wallet you enabled it with', 401);
            }
          }
        }
        return send(res, 200, { ok: true, username, newAccount: !ident }, { 'Set-Cookie': sessionCookie(createSession(userId)) });
      }

      /* ----- oauth ----- */
      const om = /^\/api\/auth\/(google|facebook|x|instagram)(\/callback)?$/.exec(p);
      if (om && req.method === 'GET') {
        const provider = om[1]; const conf = OAUTH[provider];
        if (!conf.id || !conf.secret) return bad(res, provider + ' sign-in is not configured on this server yet', 501);
        if (!om[2]) {
          if (!rateLimit('oauth:' + clientIp(req), 30, 6e5)) return bad(res, 'slow down', 429);
          const state = rand(16);
          const entry = { provider, expires: now() + 6e5 };
          const q = new URLSearchParams({ client_id: conf.id, redirect_uri: `${BASE_URL}/api/auth/${provider}/callback`, response_type: 'code', scope: conf.scope, state });
          if (conf.pkce) { // X (OAuth 2.0) requires PKCE
            const verifier = rand(32); // 64 hex chars — a valid code_verifier
            entry.verifier = verifier;
            q.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest()));
            q.set('code_challenge_method', 'S256');
          }
          oauthStates.set(state, entry);
          // bind the state to THIS browser (defeats OAuth login-CSRF / session fixation): the callback
          // must present the same value back in a first-party cookie, not just in the URL.
          const stateCookie = `oauth_state=${state}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600` + ((IS_HTTPS || process.env.COOKIE_SECURE === '1') ? '; Secure' : ''); // match sessionCookie()'s Secure gating
          res.writeHead(302, { Location: conf.authUrl + '?' + q, 'Set-Cookie': stateCookie }); res.end(); return;
        }
        const qState = url.searchParams.get('state');
        const cookieState = parseCookies(req.headers.cookie).oauth_state;
        const st = oauthStates.get(qState);
        if (!st || st.provider !== provider || st.expires < now() || !cookieState || cookieState !== qState) return bad(res, 'sign-in link is invalid or expired — please start again', 400);
        oauthStates.delete(qState);
        try { await oauthCallback(provider, url.searchParams.get('code'), st.verifier, res); }
        catch (e) { res.writeHead(302, { Location: '/?autherror=' + encodeURIComponent(provider), 'Set-Cookie': CLEAR_OAUTH_STATE }); res.end(); }
        return;
      }

      /* ----- profile + theme ----- */
      if (p === '/api/profile' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        if (blockReadOnly(res, me)) return;
        const b = await readBody(req);
        if (b.username !== undefined) {
          const u = String(b.username).trim();
          if (!USERNAME_RE.test(u)) return bad(res, 'username must be 3–24 chars: letters, numbers, _ . -');
          if (u.toLowerCase() !== me.username.toLowerCase() && usernameTaken(u)) return bad(res, 'that username is taken');
          db.prepare('UPDATE users SET username = ?, auto_named = 0 WHERE id = ?').run(u, me.id);
        }
        if (b.avatar !== undefined) db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(String(b.avatar).slice(0, 8), me.id);
        if (b.bio !== undefined) db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(String(b.bio).slice(0, 200), me.id);
        const cleanHandle = (v) => { const h = String(v || '').trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?(twitter|x|instagram)\.com\//i, '').replace(/\/.*$/, ''); return h === '' ? '' : (/^[A-Za-z0-9_.]{1,30}$/.test(h) ? h : null); };
        if (b.twitter !== undefined) { const h = cleanHandle(b.twitter); if (h === null) return bad(res, 'that X/Twitter handle isn’t valid'); db.prepare('UPDATE users SET twitter_handle = ? WHERE id = ?').run(h || null, me.id); }
        if (b.instagram !== undefined) { const h = cleanHandle(b.instagram); if (h === null) return bad(res, 'that Instagram handle isn’t valid'); db.prepare('UPDATE users SET ig_handle = ? WHERE id = ?').run(h || null, me.id); }
        if (b.accent !== undefined) {
          const a = String(b.accent);
          if (a !== '' && !HEX_COLOR_RE.test(a)) return bad(res, 'accent must be a hex color like #b4ff2b');
          db.prepare('UPDATE users SET accent = ? WHERE id = ?').run(a, me.id);
        }
        if (b.wall_bg !== undefined) {
          const a = String(b.wall_bg);
          if (a !== '' && !HEX_COLOR_RE.test(a)) return bad(res, 'background must be a hex color');
          db.prepare('UPDATE users SET wall_bg = ? WHERE id = ?').run(a, me.id);
        }
        if (b.tracker_prefs !== undefined) {
          const j = JSON.stringify(b.tracker_prefs || {});
          if (j.length > 4000) return bad(res, 'prefs too large');
          db.prepare('UPDATE users SET tracker_prefs = ? WHERE id = ?').run(encField(j), me.id);
        }
        if (b.site_prefs !== undefined) {
          const sp = b.site_prefs || {};
          if (sp.siteAccent !== undefined && sp.siteAccent !== '' && !HEX_COLOR_RE.test(String(sp.siteAccent))) return bad(res, 'site accent must be a hex color');
          // The colour map is user-controlled and is written straight into a style attribute on the
          // client, so every value is validated as a strict 6-digit hex here and unknown keys are
          // dropped. Anything else would be a CSS-injection sink.
          if (sp.colors !== undefined && sp.colors !== null) {
            if (typeof sp.colors !== 'object' || Array.isArray(sp.colors)) return bad(res, 'colors must be an object');
            const ALLOWED = ['accent', 'background', 'text', 'highlight', 'rare'];
            const clean = {};
            for (const k of ALLOWED) {
              const v = sp.colors[k];
              if (v === undefined || v === null || v === '') continue;
              if (!HEX_COLOR_RE.test(String(v))) return bad(res, k + ' must be a hex colour like #8ee000');
              clean[k] = String(v).toLowerCase();
            }
            sp.colors = clean;
          }
          const j = JSON.stringify(sp);
          if (j.length > 4000) return bad(res, 'prefs too large');
          db.prepare('UPDATE users SET site_prefs = ? WHERE id = ?').run(encField(j), me.id);
        }
        const czEarned = awardPoints(me.id, 'customize', PTS.customize, 'customize:' + me.id + ':' + ymd()); // once/day for tuning your profile
        const u2 = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id);
        return send(res, 200, { ok: true, user: { username: u2.username, avatar: u2.avatar, bio: u2.bio, theme: themeOf(u2) }, pointsEarned: czEarned });
      }
      if (p === '/api/profile/image' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('img:' + me.id, 20, 36e5)) return bad(res, 'too many uploads — try later', 429);
        const b = await readBody(req);
        const kind = { avatar: 'avatar_img', header: 'header_img', background: 'bg_img' }[b.kind];
        if (!kind) return bad(res, 'kind must be avatar, header, or background');
        if (b.remove) {
          deleteUpload(me[kind]);
          db.prepare(`UPDATE users SET ${kind} = NULL WHERE id = ?`).run(me.id);
          return send(res, 200, { ok: true, url: null });
        }
        let name;
        // Two accepted shapes. A data URI still goes through saveImage (that is how a canvas-resized
        // still photo arrives). A /uploads/<name> reference comes from the streaming /api/upload
        // route, which is how GIFs and video get here — they must NOT be re-encoded through a canvas,
        // which would flatten an animation to a single frame and drop a video entirely.
        if (typeof b.image === 'string' && b.image.startsWith('/uploads/')) {
          const ref = b.image.slice('/uploads/'.length);
          if (!/^[a-f0-9]{24}\.(jpg|png|webp|gif|mp4|webm)$/.test(ref)) return bad(res, 'bad media reference');
          if (!db.prepare('SELECT 1 FROM uploads WHERE name = ? AND user_id = ?').get(ref, me.id)) return bad(res, 'that upload is not yours');
          name = ref;
          // claim it, or the orphan sweeper deletes the file out from under the profile
          db.prepare('UPDATE uploads SET claimed = 1 WHERE name = ?').run(ref);
        } else {
          try { name = saveImage(b.image, 3.5 * 1024 * 1024); } catch (e) { return bad(res, e.message); }
          if (!name) return bad(res, 'send a jpeg/png/webp data URL, or an /uploads/ reference'); }
        deleteUpload(me[kind]);
        db.prepare(`UPDATE users SET ${kind} = ? WHERE id = ?`).run(name, me.id);
        awardPoints(me.id, 'customize', PTS.customize, 'customize:' + me.id + ':' + ymd());
        return send(res, 200, { ok: true, url: '/uploads/' + name });
      }

      /* ----- posts ----- */
      if (p === '/api/posts' && req.method === 'GET') {
        maybeRefreshCalls(); // keep live Send Call Xs fresh whenever the wall is viewed (throttled in the background)
        const beforeId = Number(url.searchParams.get('before')) || null;
        const beforeScoreRaw = url.searchParams.get('beforeScore');
        const byUser = url.searchParams.get('user');
        const feed = url.searchParams.get('feed');
        // Boards are separate rooms: a question asked on the help desk must never surface on the Send Wall,
        // a profile timeline or the following feed, and a wall post must never appear among the questions.
        const board = BOARDS.has(String(url.searchParams.get('board') || '')) ? String(url.searchParams.get('board')) : null;
        // profile walls read chronologically (X-style timeline); the Send Wall defaults to Top (most-upvoted)
        const sort = url.searchParams.get('sort') === 'new' ? 'new' : (byUser ? 'new' : 'top');
        let rows;
        if (byUser) {
          const u = db.prepare('SELECT id FROM users WHERE username = ?').get(byUser);
          if (!u) return bad(res, 'no such user', 404);
          rows = db.prepare('SELECT * FROM posts WHERE user_id = ? AND community_id IS NULL AND board IS NULL AND id < ? ORDER BY id DESC LIMIT 30').all(u.id, beforeId || Number.MAX_SAFE_INTEGER);
        } else {
          const following = feed === 'following';
          if (following && !me) return bad(res, 'sign in to see your following feed', 401);
          const boardSql = board ? " AND po.board = '" + board + "'" : ' AND po.board IS NULL';   // board is allowlisted above, never raw input
          /* Community posts now DO appear on the public Send Wall — that is the point of a community being
             public — but a HOLDERS-ONLY post never does. `po.private = 0` is that boundary, and it lives in
             the SQL rather than in the view, because postsView() maps rows without filtering: anything this
             query returns is already considered publishable by everything downstream. The Send Wall shows
             public posts, wall and community alike; the private wall stays exactly as private as it was. */
          const base = (following
            ? 'FROM posts po JOIN follows f ON f.followee_id = po.user_id WHERE po.private = 0' + boardSql + ' AND f.follower_id = ?'
            : 'FROM posts po WHERE po.private = 0' + boardSql)
            + (me ? ' AND po.user_id NOT IN (SELECT muted_id FROM mutes WHERE user_id = ?)' : ''); // muted senders vanish from the feed
          const args = following ? [me.id] : [];
          if (me) args.push(me.id);
          let where = '', order;
          if (sort === 'top') {
            order = 'ORDER BY po.score DESC, po.id DESC';
            if (beforeId != null && beforeScoreRaw != null) { // (score,id) cursor keeps pagination stable under score ties
              const bs = Number(beforeScoreRaw) || 0;
              where = ' AND (po.score < ? OR (po.score = ? AND po.id < ?))';
              args.push(bs, bs, beforeId);
            }
          } else {
            order = 'ORDER BY po.id DESC';
            if (beforeId != null) { where = ' AND po.id < ?'; args.push(beforeId); }
          }
          rows = db.prepare('SELECT po.* ' + base + where + ' ' + order + ' LIMIT 30').all(...args);
        }
        return send(res, 200, { posts: postsView(rows, me), sort, board });
      }
      if (p === '/api/upload' && req.method === 'POST') { // STREAMING binary media upload (raw body → disk, no base64/JSON)
        if (!me) return bad(res, 'sign in first', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('upload:' + me.id, 40, 6e5) || !rateLimit('uploadip:' + clientIp(req), 60, 6e5)) return bad(res, 'uploading too fast — slow down 😅', 429);
        if (mediaInFlight >= MEDIA_CONCURRENCY) return bad(res, 'lots of uploads right now — try again in a moment', 503);
        const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        const spec = UPLOAD_KINDS[mime];
        if (!spec) return bad(res, 'unsupported media type — use JPG, PNG, WebP, GIF, MP4 or WebM', 415);
        const q0 = db.prepare('SELECT upload_bytes u FROM users WHERE id=?').get(me.id);
        if (q0 && q0.u >= UPLOAD_USER_QUOTA) return bad(res, 'you’ve hit your media storage limit — delete some old posts first', 413);
        const clen = Number(req.headers['content-length'] || 0);
        if (clen && clen > spec.cap) return bad(res, spec.kind + ' too large (max ' + Math.round(spec.cap / 1048576) + 'MB)', 413);
        // Reserve worst-case disk for THIS upload plus everything already streaming, BEFORE writing a byte — the shared
        // app.db volume must keep its DISK_SAFETY_MARGIN headroom even with MEDIA_CONCURRENCY uploads in flight (the
        // end-of-stream check alone fires only after the bytes are already on disk).
        try { const st = fs.statfsSync(DATA_DIR); if (st.bavail * st.bsize < DISK_SAFETY_MARGIN + spec.cap * (mediaInFlight + 1)) return bad(res, 'storage is full right now — try again later', 507); } catch {}
        mediaInFlight++;
        const tmp = path.join(UPLOAD_DIR, 'tmp_' + rand(16) + '.part');
        const ws = fs.createWriteStream(tmp);
        let size = 0, head = Buffer.alloc(0), settled = false, idle = null;
        const clearIdle = () => { if (idle) { clearTimeout(idle); idle = null; } };
        const finish = () => { if (!settled) { settled = true; mediaInFlight--; clearIdle(); } };
        const fail = (code, msg) => { finish(); try { ws.destroy(); } catch {} try { fs.unlinkSync(tmp); } catch {} try { req.destroy(); } catch {} if (!res.headersSent) bad(res, msg, code); };
        // Idle-timeout the upload so a stalled / slow-loris client can't pin a mediaInFlight slot (which would 503 every
        // upload AND every >400KB post). Rearmed on each chunk, so a slow-but-progressing large upload is never killed.
        const armIdle = () => { clearIdle(); idle = setTimeout(() => fail(408, 'upload stalled — try again'), 20000); };
        ws.on('error', () => fail(500, 'write failed'));
        req.on('error', () => fail(400, 'upload stream error')); // an aborted body emits 'error' on Node ≥24; the idle timer + requestTimeout are the backstops for a stall
        req.on('data', (chunk) => {
          if (settled) return;
          armIdle();
          size += chunk.length;
          if (size > spec.cap) return fail(413, spec.kind + ' too large (max ' + Math.round(spec.cap / 1048576) + 'MB)');
          if (head.length < 64) head = Buffer.concat([head, chunk.slice(0, 64 - head.length)]);
          if (ws.write(chunk) === false) { req.pause(); ws.once('drain', () => req.resume()); }
        });
        armIdle(); // also covers "headers arrived, then the body never does"
        req.on('end', () => {
          clearIdle();
          if (settled) return;
          ws.end(() => {
            if (settled) return;
            if (!size || !spec.magic(head)) return fail(400, 'corrupt or mislabeled media');
            if (spec.kind !== 'video') { const d = rasterDims(readHead(tmp, 131072), mime); if (!d || !(d.w > 0) || !(d.h > 0) || d.w > UPLOAD_MAX_PX || d.h > UPLOAD_MAX_PX || (d.w * d.h) / 1e6 > UPLOAD_MAX_MEGAPIXELS) return fail(400, 'image dimensions too large (max ' + UPLOAD_MAX_PX + 'px per side)'); }
            const q1 = db.prepare('SELECT upload_bytes u FROM users WHERE id=?').get(me.id);
            if (q1 && q1.u + size > UPLOAD_USER_QUOTA) return fail(413, 'you’ve hit your media storage limit — delete some old posts first');
            try { const st = fs.statfsSync(DATA_DIR); if (st.bavail * st.bsize < DISK_SAFETY_MARGIN) return fail(507, 'storage is full right now — try again later'); } catch {}
            const name = rand(12) + '.' + spec.ext;
            try { fs.renameSync(tmp, path.join(UPLOAD_DIR, name)); } catch { return fail(500, 'save failed'); }
            finish();
            db.prepare('INSERT INTO uploads (name, user_id, bytes, kind, created_at, claimed) VALUES (?,?,?,?,?,0)').run(name, me.id, size, spec.kind, now());
            db.prepare('UPDATE users SET upload_bytes = upload_bytes + ? WHERE id=?').run(size, me.id);
            send(res, 200, { url: '/uploads/' + name, kind: spec.kind });
          });
        });
        return;
      }
      if (p === '/api/posts' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in to post', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('post:' + me.id, 12, 6e5)) return bad(res, 'posting too fast — take a breath 😅', 429);
        const bigUpload = Number(req.headers['content-length'] || 0) > MEDIA_GATE_BYTES;
        if (bigUpload && mediaInFlight >= MEDIA_CONCURRENCY) return bad(res, 'lots of uploads right now — try again in a moment', 503);
        let b, image = null;
        if (bigUpload) mediaInFlight++;
        try { b = await readBody(req, 12 * 1024 * 1024); if (b.image) image = resolvePostMedia(b.image, me.id); } // media is normally a pre-uploaded /uploads URL; data: URIs still accepted
        catch (e) { return bad(res, e.message || 'could not read your post', (e && e.status) || 400); }
        finally { if (bigUpload) mediaInFlight--; }
        const board = BOARDS.has(String(b.board || '')) ? String(b.board) : null;
        const rt = await resolveTokensInText(String(b.text || '').trim().slice(0, 500));
        const text = rt.text;
        if (!text && !image) return bad(res, board ? 'write your question first' : 'say something or add a photo, GIF or video');
        const r = db.prepare('INSERT INTO posts (user_id, text, image, tokens, board, created_at) VALUES (?,?,?,?,?,?)').run(me.id, text, image, rt.tokens, board, now());
        const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(r.lastInsertRowid));
        /* A question earns no Send Power. The help desk has to stay free to use — nobody should hesitate to
           ask because they are unsure it "counts" — and paying for posts on a board with no editorial bar
           would make asking the cheapest farm on the site. The page says this plainly rather than leaving
           people to notice their balance did not move. */
        let earned = 0;
        if (!board) {
          const first = db.prepare('SELECT COUNT(*) n FROM posts WHERE user_id = ? AND board IS NULL').get(me.id).n === 1;
          earned = awardPoints(me.id, 'post', PTS.post, 'post:' + row.id) + (first ? awardPoints(me.id, 'first_post', PTS.first_post, 'firstpost:' + me.id) : 0);
        }
        scanWriteAction(me.id, 'post', text);
        return send(res, 200, { post: postView(row, me), pointsEarned: earned });
      }
      let m = /^\/api\/posts\/(\d+)$/.exec(p);
      if (m && req.method === 'GET') { // a single post (for deep-linking to it on the wall)
        const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(m[1]));
        if (!row || !postVisible(row, me)) return bad(res, 'post not found', 404); // a holders-only post does not exist for anyone else
        return send(res, 200, { post: postView(row, me) });
      }
      if (m && req.method === 'DELETE') {
        if (!me) return bad(res, 'sign in first', 401);
        const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(m[1]));
        if (!row || !postVisible(row, me)) return bad(res, 'not found', 404); // a post you may not read is absent on EVERY verb, or the 403 tells you it exists
        if (row.user_id !== me.id) return bad(res, 'you can only delete your own posts', 403);
        if (row.call_id) return bad(res, 'Send Calls are final — a call can’t be deleted once it’s posted.', 403); // calls are permanent + immutable
        deleteUpload(row.image, row.user_id);
        db.prepare('DELETE FROM posts WHERE id = ?').run(row.id);
        return send(res, 200, { ok: true });
      }
      m = /^\/api\/posts\/(\d+)\/react$/.exec(p);
      if (m && req.method === 'POST') {
        if (!me) return bad(res, 'sign in to react', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('react:' + me.id, 60, 6e5)) return bad(res, 'reacting too fast 😅', 429);
        const b = await readBody(req);
        const kind = b.kind === 'rocket' ? 'rocket' : 'fire';
        const postId = Number(m[1]);
        const pr = db.prepare('SELECT id, user_id, community_id, private FROM posts WHERE id = ?').get(postId);
        if (!pr || !postVisible(pr, me)) return bad(res, 'not found', 404);
        const existing = db.prepare('SELECT 1 FROM reactions WHERE post_id = ? AND user_id = ? AND kind = ?').get(postId, me.id, kind);
        let earned = 0;
        if (existing) db.prepare('DELETE FROM reactions WHERE post_id = ? AND user_id = ? AND kind = ?').run(postId, me.id, kind);
        else {
          db.prepare('INSERT INTO reactions (post_id, user_id, kind) VALUES (?,?,?)').run(postId, me.id, kind);
          const author = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);
          if (author && author.user_id !== me.id) { // no points for reacting to your own posts
            // dedupe by (post,user,kind) so toggling a reaction off/on can't farm points
            earned = awardPoints(me.id, 'react_give', PTS.react_give, 'react:' + postId + ':' + me.id + ':' + kind);
            awardPoints(author.user_id, 'react_get', PTS.react_get, 'reactget:' + postId + ':' + me.id); // once per reactor per post (the kind in the ref let one partner pay twice)
            notifyOnce(author.user_id, kind === 'rocket' ? '🚀' : '🔥', '@' + me.username + ' reacted ' + (kind === 'rocket' ? '🚀' : '🔥') + ' to your post.', 'social', me.id);
          }
          // a reaction on a COMMUNITY wall builds that community too (its own daily caps apply inside these helpers)
          const cpost = db.prepare('SELECT community_id, user_id FROM posts WHERE id = ?').get(postId);
          if (cpost && cpost.community_id) {
            awardCommunityXp(cpost.community_id, cpost.user_id, 'wall_react_get', COMM_XP.wall_react_get, 'c' + cpost.community_id + ':wall_react_get:' + postId + ':' + me.id + ':' + kind);
            awardConviction(cpost.community_id, me.id, 'wall_react_give', CONV_XP.wall_react_give, 'v' + cpost.community_id + ':wall_react_give:' + postId + ':' + me.id + ':' + kind);
            bumpActivity(cpost.community_id, W_react);
          }
        }
        const n = db.prepare('SELECT COUNT(*) n FROM reactions WHERE post_id = ? AND kind = ?').get(postId, kind).n;
        if (!existing) scanWriteAction(me.id, 'react');
        return send(res, 200, { kind, count: n, on: !existing, pointsEarned: earned });
      }
      m = /^\/api\/posts\/(\d+)\/vote$/.exec(p);
      if (m && req.method === 'POST') {
        if (!me) return bad(res, 'sign in to vote', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('vote:' + me.id, 50, 6e5)) return bad(res, 'voting too fast — slow down 😅', 429);
        const b = await readBody(req);
        const dir = b.dir === 'down' ? -1 : (b.dir === 'up' ? 1 : 0);
        const postId = Number(m[1]);
        const post = db.prepare('SELECT id, user_id, community_id, private FROM posts WHERE id = ?').get(postId);
        if (!post || !postVisible(post, me)) return bad(res, 'not found', 404);
        if (post.user_id === me.id) return bad(res, "you can't vote on your own post", 400); // keep score authoritative (no self-inflation)
        const prev = db.prepare('SELECT value FROM post_votes WHERE post_id = ? AND user_id = ?').get(postId, me.id);
        const prevVal = prev ? prev.value : 0;
        let myVote;
        if (dir === 0 || dir === prevVal) {                 // tapping the active arrow again clears your vote
          db.prepare('DELETE FROM post_votes WHERE post_id = ? AND user_id = ?').run(postId, me.id);
          myVote = 0;
        } else {
          db.prepare('INSERT INTO post_votes (post_id, user_id, value, created_at) VALUES (?,?,?,?) ON CONFLICT(post_id, user_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at').run(postId, me.id, dir, now());
          myVote = dir;
        }
        const score = db.prepare('SELECT COALESCE(SUM(value),0) s FROM post_votes WHERE post_id = ?').get(postId).s;
        db.prepare('UPDATE posts SET score = ? WHERE id = ?').run(score, postId);
        if (myVote !== 0) scanWriteAction(me.id, 'vote'); // clearing a vote isn't a farmable action
        // gamify: reward voting (once per post ever, so toggling/flipping can't farm) + reward the author on an upvote
        let earned = 0;
        if (post.user_id !== me.id) {
          earned = awardPoints(me.id, 'vote_give', PTS.vote_give, 'vote:' + postId + ':' + me.id);
          if (myVote === 1) awardPoints(post.user_id, 'vote_get', PTS.vote_get, 'voteget:' + postId + ':' + me.id);
          if (myVote === 1 && prevVal !== 1) notifyOnce(post.user_id, '⬆️', '@' + me.username + ' upvoted your post.', 'social', me.id);
        }
        return send(res, 200, { score, myVote, pointsEarned: earned });
      }
      m = /^\/api\/posts\/(\d+)\/comments$/.exec(p);
      if (m && req.method === 'GET') {
        const cvp = db.prepare('SELECT id, user_id, community_id, private FROM posts WHERE id = ?').get(Number(m[1]));
        if (!cvp || !postVisible(cvp, me)) return bad(res, 'not found', 404); // the discussion under a holders-only post is holders-only too
        const rows = me
          ? db.prepare('SELECT c.id, c.text, c.tokens, c.created_at, u.username, u.avatar, u.avatar_img, u.og, u.og_tier FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? AND c.user_id NOT IN (SELECT muted_id FROM mutes WHERE user_id = ?) ORDER BY c.id ASC LIMIT 100').all(Number(m[1]), me.id)
          : db.prepare('SELECT c.id, c.text, c.tokens, c.created_at, u.username, u.avatar, u.avatar_img, u.og, u.og_tier FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id ASC LIMIT 100').all(Number(m[1]));
        return send(res, 200, { comments: rows.map(c => ({ ...c, tokens: parseTokens(c.tokens), avatar_img: c.avatar_img ? '/uploads/' + c.avatar_img : null, og: c.og_tier || 0 })) });
      }
      if (m && req.method === 'POST') {
        if (!me) return bad(res, 'sign in to comment', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('cmt:' + me.id, 25, 6e5)) return bad(res, 'commenting too fast', 429);
        const b = await readBody(req);
        const rt = await resolveTokensInText(String(b.text || '').trim().slice(0, 300));
        const text = rt.text;
        if (!text) return bad(res, 'empty comment');
        const cPost = db.prepare('SELECT id, user_id, community_id, private FROM posts WHERE id = ?').get(Number(m[1]));
        if (!cPost || !postVisible(cPost, me)) return bad(res, 'not found', 404);
        const cr = db.prepare('INSERT INTO comments (post_id, user_id, text, tokens, created_at) VALUES (?,?,?,?,?)').run(Number(m[1]), me.id, text, rt.tokens, now());
        const cEarned = awardPoints(me.id, 'comment', PTS.comment, 'comment:' + Number(cr.lastInsertRowid));
        const pa = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(Number(m[1]));
        if (pa && pa.user_id !== me.id) { const cp = Array.from(text); notifyOnce(pa.user_id, '💬', '@' + me.username + ' commented on your post: “' + cp.slice(0, 60).join('') + (cp.length > 60 ? '…' : '') + '”', 'social', me.id); } // code-point slice: never cut an emoji in half
        // commenting on a community wall builds that community's level and your member level there
        const cp2 = db.prepare('SELECT community_id FROM posts WHERE id = ?').get(Number(m[1]));
        if (cp2 && cp2.community_id) {
          awardCommunityXp(cp2.community_id, me.id, 'wall_comment', COMM_XP.wall_comment, 'c' + cp2.community_id + ':wall_comment:' + Number(cr.lastInsertRowid));
          awardConviction(cp2.community_id, me.id, 'wall_comment', CONV_XP.wall_comment, 'v' + cp2.community_id + ':wall_comment:' + Number(cr.lastInsertRowid));
          bumpActivity(cp2.community_id, W_react);
        }
        scanWriteAction(me.id, 'comment');
        return send(res, 200, { ok: true, pointsEarned: cEarned });
      }

      /* ----- public profile (username, avatar, bio, theme, counts ONLY) ----- */
      m = /^\/api\/users\/([^/]+)$/.exec(p);
      if (m && req.method === 'GET') {
        let uname; try { uname = decodeURIComponent(m[1]); } catch { return bad(res, 'bad username', 400); }
        const u = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
        if (!u) return bad(res, 'no such user', 404);
        const posts = db.prepare('SELECT COUNT(*) n FROM posts WHERE user_id = ?').get(u.id).n;
        const followers = db.prepare('SELECT COUNT(*) n FROM follows WHERE followee_id = ?').get(u.id).n;
        const following = db.prepare('SELECT COUNT(*) n FROM follows WHERE follower_id = ?').get(u.id).n;
        const fires = db.prepare('SELECT COUNT(*) n FROM reactions r JOIN posts po ON po.id = r.post_id WHERE po.user_id = ?').get(u.id).n;
        const iFollow = me ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(me.id, u.id) : false;
        const level = levelForXp(u.points || 0);
        return send(res, 200, { user: {
          username: u.username, avatar: u.avatar, bio: u.bio, joined: u.created_at,
          posts, followers, following, reactionsReceived: fires,
          iFollow, isMe: !!(me && me.id === u.id),
          theme: themeOf(u),
          twitter: u.twitter_handle || null, instagram: u.ig_handle || null, // public social links
          points: u.points || 0, level, title: titleFor(level), rank: userRank(u.id), // public gamified score
          diamond: publicDiamond(u.id), // public diamond-hands badge (tier only)
          og: u.og_tier || 0, // permanent OG badge (verified early buyer of $SEND/$GWC)
        } });
      }
      m = /^\/api\/users\/([^/]+)\/follow$/.exec(p);
      if (m && req.method === 'POST') {
        if (!me) return bad(res, 'sign in to follow senders', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('follow:' + me.id, 30, 6e4)) return bad(res, 'slow down', 429);
        let uname; try { uname = decodeURIComponent(m[1]); } catch { return bad(res, 'bad username', 400); }
        const u = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
        if (!u) return bad(res, 'no such user', 404);
        if (u.id === me.id) return bad(res, 'you cannot follow yourself (we get it though)');
        const existing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(me.id, u.id);
        let fEarned = 0;
        if (existing) db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(me.id, u.id);
        else {
          db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(me.id, u.id, now());
          notifyOnce(u.id, '⭐', '@' + me.username + ' started following you.', 'social', me.id);
          fEarned = awardPoints(me.id, 'follow', PTS.follow, 'follow:' + me.id + ':' + u.id);       // once per unique followee
          awardPoints(u.id, 'be_followed', PTS.be_followed, 'befollowed:' + me.id + ':' + u.id);
        }
        const followers = db.prepare('SELECT COUNT(*) n FROM follows WHERE followee_id = ?').get(u.id).n;
        if (!existing) scanWriteAction(me.id, 'follow');
        return send(res, 200, { following: !existing, followers, pointsEarned: fEarned });
      }

      /* ----- sender search (public fields only) ----- */
      if (p === '/api/search' && req.method === 'GET') {
        const q = String(url.searchParams.get('q') || '').trim().slice(0, 40);
        if (q.length < 1) return send(res, 200, { users: [] });
        if (!rateLimit('search:' + clientIp(req), 120, 6e4)) return bad(res, 'slow down', 429);
        const like = '%' + q.replace(/[%_]/g, '') + '%';
        const rows = db.prepare(`
          SELECT u.*, (SELECT COUNT(*) FROM posts po WHERE po.user_id = u.id) posts,
                 (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) followers
          FROM users u
          WHERE (u.username LIKE ? OR u.bio LIKE ?) AND u.system = 0
          ORDER BY (u.username LIKE ?) DESC, followers DESC, posts DESC
          LIMIT 12`).all(like, like, q.replace(/[%_]/g, '') + '%');
        return send(res, 200, { users: rows.map(u => ({
          username: u.username, avatar: u.avatar, bio: u.bio,
          avatar_img: u.avatar_img ? '/uploads/' + u.avatar_img : null,
          accent: u.accent || '', posts: u.posts, followers: u.followers, og: u.og_tier || 0,
        })) });
      }

      /* ----- Send Calls ----- */
      if (p === '/api/calls/leaderboard' && req.method === 'GET') {
        maybeRefreshCalls();
        const w = url.searchParams.get('window') || 'all';
        if (!Object.prototype.hasOwnProperty.call(CALL_WINDOWS, w)) return bad(res, 'bad window');
        return send(res, 200, { window: w, top: callLeaderboard(w) });
      }
      /* One read for every Send Call currently on a reader's screen. The card widgets used to poll
         /api/calls/:id one at a time — eight visible cards meant eight round-trips every tick, which is
         why the refresh had to be slow. This answers the whole screen at once, so the Xs can move often
         without the request count moving with them. The payload is the SAME callView the single-call
         route returns, so the client's in-place updater needs no second shape to understand. */
      if (p === '/api/calls/live' && req.method === 'GET') {
        if (!rateLimit('callslive:' + clientIp(req), 150, 60000)) return bad(res, 'slow down', 429);
        const ids = [...new Set(String(url.searchParams.get('ids') || '').split(',')
          .map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0))].slice(0, LIVE_BATCH_MAX);
        if (!ids.length) return send(res, 200, { calls: [], at: now() });
        maybeRefreshCalls();   // same 45s-throttled on-chain re-read the single-call route triggers
        const rows = db.prepare('SELECT * FROM calls WHERE id IN (' + ids.map(() => '?').join(',') + ')').all(...ids);
        return send(res, 200, { calls: rows.map(r => callView(r, me)), at: now() });
      }
      if (p === '/api/calls' && req.method === 'GET') {
        maybeRefreshCalls();
        const uname = url.searchParams.get('user');
        let userId;
        if (uname) { const u = db.prepare('SELECT id FROM users WHERE username = ?').get(uname); if (!u) return bad(res, 'no such user', 404); userId = u.id; }
        else if (me) userId = me.id;
        else return bad(res, 'sign in or pass ?user=', 400);
        return send(res, 200, { stats: callStats(userId, me) });
      }
      if (p === '/api/calls' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in to make a Send Call', 401);
        if (blockReadOnly(res, me)) return;
        probationTick(me.id); // if they lifted a restriction by buying $SEND, re-check on-chain that they still hold it (catches a mid-probation sell fast)
        if (!rateLimit('call:' + me.id, 10, 6e5)) return bad(res, 'slow down — too many calls', 429);
        const b = await readBody(req);
        const token = String(b.token || '').toLowerCase().trim();
        if (!/^0x[0-9a-f]{40}$/.test(token)) return bad(res, 'that is not a valid token address');
        if (db.prepare('SELECT 1 FROM calls WHERE user_id = ? AND token_addr = ?').get(me.id, token)) return bad(res, 'you already have an active Send Call on this token');
        // dynamic daily call limit (earned quality × diamond boost) — reject over-limit BEFORE spending a price lookup
        const allow = callAllowance(me);
        if (allow.remaining <= 0) {
          const left = allow.resetAt ? Math.max(1, Math.ceil((allow.resetAt - now()) / 60000)) : null;
          const when = left == null ? 'soon' : left >= 60 ? Math.floor(left / 60) + 'h ' + (left % 60) + 'm' : left + 'm';
          const earnMore = allow.diamondLevel > 0 ? '' : ', or become a diamond-hand holder of $SEND/$GWC to multiply your daily limit';
          return send(res, 429, {
            error: 'You’ve used all ' + allow.limit + ' of your Send Calls for now — your next one frees up in ' + when + '. Land winners (a call that doubles, 1x+) to earn more calls per day' + earnMore + '.',
            code: 'daily_limit', used: allow.used, limit: allow.limit, remaining: 0, resetAt: allow.resetAt,
          });
        }
        let r; try { r = await lookupTokenPair(token); } catch { return bad(res, 'could not price that token — try again', 502); }
        if (!r || r.notFound || !r.pair) return bad(res, (r && r.reason === 'quote') ? 'that is a base asset (WETH/USDG), not a callable token' : 'no trading pair found for that token');
        const p2 = r.pair, price = p2.market && p2.market.priceUsd;
        if (!(price > 0)) return bad(res, 'no live price for that token yet — can’t track Xs');
        const liq = (p2.market && p2.market.liquidityUsd != null) ? Number(p2.market.liquidityUsd) : 0;
        if (!(liq >= MIN_CALL_LIQ)) return bad(res, 'this token’s pool is too thin to call ($' + Math.round(liq) + ' liquidity, need $' + MIN_CALL_LIQ + '+). Thin pools can be manipulated — call it once it has real liquidity.'); // anti-farm floor
        const mc = (p2.market && p2.market.marketCap != null) ? p2.market.marketCap : null;
        const sym = (p2.token.symbol || '?').slice(0, 16), name = (p2.token.name || 'Token').slice(0, 60);
        const wallet = walletAddresses(me.id)[0] || null; // caller's public wallet (for one-tap tracking), if any
        const note = String(b.note || '').trim().slice(0, 280);
        const text = note || ('📣 Called $' + sym + ' — Just Send It.');
        const t = now();
        // Send Call SIZE: value of tokens the caller bought & still holds → each $100 = 1× Send Power (fail-open to 0)
        const spendUsd = await callSpendUsd(me.id, token, p2.pair.address, price);
        const sm = sizeMult(spendUsd);
        const noDyor = b.viewedDetail ? 0 : 1; // flag calls made WITHOUT opening the token's full on-chain detail first
        let callId, postId;
        try {
          db.exec('BEGIN');
          const cr = db.prepare('INSERT INTO calls (user_id, token_addr, pair_addr, symbol, name, quote_symbol, token0, token1, entry_price, entry_mc, entry_liq, peak_price, cur_price, cur_mc, last_check, wallet, snapshot, created_at, entry_spend_usd, no_dyor) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(me.id, token, p2.pair.address, sym, name, p2.pair.quoteSymbol || '?', p2.pair.token0 || null, p2.pair.token1 || null, price, mc, liq, price, price, mc, null, wallet, JSON.stringify(p2).slice(0, 40000), t, spendUsd, noDyor); // last_check=NULL: the first sweep stamps it and credits 0 hold for the unobserved pre-sample gap
          callId = Number(cr.lastInsertRowid);
          // TOCTOU guard: the allowance was checked before the awaited lookups above, so re-verify under the write lock —
          // two near-simultaneous calls can't both slip past the pre-await remaining>0 check and exceed the daily limit.
          const cntNow = db.prepare('SELECT COUNT(*) n FROM calls WHERE user_id=? AND created_at > ?').get(me.id, now() - CALL_WINDOW_MS).n;
          if (cntNow > allow.limit) { db.exec('ROLLBACK'); return bad(res, 'You’ve just used your last Send Call for now — it frees up soon.', 429); }
          const pr = db.prepare('INSERT INTO posts (user_id, text, created_at, call_id) VALUES (?,?,?,?)').run(me.id, text, t, callId);
          postId = Number(pr.lastInsertRowid);
          db.prepare('UPDATE calls SET post_id = ? WHERE id = ?').run(postId, callId);
          db.exec('COMMIT');
        } catch (e) { try { db.exec('ROLLBACK'); } catch {} return bad(res, 'could not save the call'); }
        // The opening award comes out of the same per-call budget as the milestones and the hold
        // bonus, so CALL_POINTS_CAP really is everything one call can ever be worth — not a cap on
        // part of it with the rest sitting outside.
        const openBase = Math.round(PTS.send_call * sm);
        const earned = awardPoints(me.id, 'send_call', openBase, 'callopen:' + me.id + ':' + token, Math.min(callHeadroom(0, CALL_POINTS_CAP), openBase * OPEN_STACK_MAX)); // bigger on-chain buy → bigger Send Power; ONE opening award per token per caller, ever, and at most 10× the size-scaled base
        if (earned > 0) db.prepare('UPDATE calls SET points_paid = points_paid + ? WHERE id = ?').run(earned, callId);
        // A Send Call on a community's own token IS participation in that community, so it scores for it — but only
        // from a qualified member. Otherwise anyone could push a community up the weekly board from the outside.
        const callComm = communityForToken(token);
        if (callComm && callComm.status === 'live' &&
            db.prepare('SELECT 1 FROM community_members WHERE community_id=? AND user_id=? AND qualified=1').get(callComm.id, me.id)) {
          awardCommunityXp(callComm.id, me.id, 'send_call', COMM_XP.send_call, 'c' + callComm.id + ':send_call:' + callId);
          awardConviction(callComm.id, me.id, 'send_call', CONV_XP.send_call, 'v' + callComm.id + ':send_call:' + callId);
        }
        scanWriteAction(me.id, 'post', text);
        notify(me.id, '📣', 'Send Call posted on $' + sym + ' — your Xs track live on your wall.', 'points');
        // anti-spam: did this call complete a full day's allowance (≥3) inside an hour? If so, mute them (escalating: 24h → 1wk → permanent).
        let restriction = null;
        if (allow.limit >= CALL_SPAM_MIN) {
          const nth = db.prepare('SELECT created_at FROM calls WHERE user_id=? AND created_at>? ORDER BY created_at DESC LIMIT 1 OFFSET ?').get(me.id, now() - CALL_WINDOW_MS, allow.limit - 1);
          if (nth && now() - nth.created_at < CALL_SPAM_WINDOW_MS) { // all `limit` calls landed inside the last hour → burst
            flagUser(me.id, 'Spamming Send Calls — you used a full day of Send Calls in under an hour. A Send Call is a signal, not a firehose.');
            restriction = restrictionOf(db.prepare('SELECT * FROM users WHERE id = ?').get(me.id));
            if (restriction) notify(me.id, '🔇', restriction.permanent ? 'Your account is now permanently muted for repeated Send Call spam.' : 'You’ve been muted for spamming Send Calls — see the banner up top for what happened and when it lifts.', 'restriction');
          }
        }
        return send(res, 200, { post: postView(db.prepare('SELECT * FROM posts WHERE id = ?').get(postId), me), pointsEarned: earned, restriction });
      }
      let cm = /^\/api\/calls\/(\d+)$/.exec(p);
      if (cm && req.method === 'GET') {
        maybeRefreshCalls();
        const c = db.prepare('SELECT * FROM calls WHERE id = ?').get(Number(cm[1]));
        if (!c) return bad(res, 'call not found', 404);
        let snapshot = null; try { snapshot = JSON.parse(c.snapshot || 'null'); } catch {} // call-time enriched pair (fallback detail if the token later delists)
        return send(res, 200, { call: callView(c, me), snapshot });
      }
      // the full ranked list of everyone who Sent It on a call (expand under the top 3) — freshens spends on-chain in the background
      cm = /^\/api\/calls\/(\d+)\/senders$/.exec(p);
      if (cm && req.method === 'GET') {
        const c = db.prepare('SELECT * FROM calls WHERE id = ?').get(Number(cm[1]));
        if (!c) return bad(res, 'call not found', 404);
        refreshSenderSpends(c).catch(() => {}); // fire-and-forget: keeps the amounts current without blocking the expand
        return send(res, 200, { senders: callSenders(c, null) });
      }
      cm = /^\/api\/calls\/(\d+)\/hop$/.exec(p);
      if (cm && req.method === 'POST') {
        if (!me) return bad(res, 'sign in to Send It', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('hop:' + me.id, 40, 6e5)) return bad(res, 'slow down', 429);
        const callId = Number(cm[1]);
        const c = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
        if (!c) return bad(res, 'call not found', 404);
        if (c.user_id === me.id) return bad(res, 'that’s your own Send Call');
        const isNew = !db.prepare('SELECT 1 FROM call_hops WHERE call_id = ? AND user_id = ?').get(callId, me.id);
        // ONE paying Sender position per token, mirroring the caller's one-call-per-token rule. Without it, N calls on the
        // same token (free alt accounts can mint them on demand) gave one account N independent hold budgets off a single
        // real buy. A second Send on the same token still counts socially — it just has no entry price, so it never accrues
        // and never counts toward anyone's crew.
        const dupTok = !!db.prepare('SELECT 1 FROM call_hops h JOIN calls c2 ON c2.id = h.call_id WHERE h.user_id = ? AND c2.token_addr = ? AND h.call_id != ? AND h.entry_price IS NOT NULL').get(me.id, c.token_addr, callId);
        const hopEntry = dupTok ? null : ((c.cur_price > 0 ? c.cur_price : c.entry_price) || null); // hopper's Xs basis = the price when they hopped on
        const tHop = now();
        let earned = 0;
        if (isNew) {
          const pos = dupTok ? { spendUsd: 0, boughtUsd: 0, heldUsd: 0 } // already holding a paying position on this token — no chain read needed
            : await walletTokenPosition(me.id, c.token_addr, c.pair_addr, (c.cur_price > 0 ? c.cur_price : c.entry_price)); // what this follower bought / still holds
          const spendUsd = pos.spendUsd;
          db.prepare('INSERT INTO call_hops (call_id, user_id, created_at, entry_price, last_check, spend_usd, bought_usd, held_usd) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(call_id, user_id) DO NOTHING').run(callId, me.id, tHop, hopEntry, tHop, spendUsd, pos.boughtUsd, pos.heldUsd);
          const hopBase = Math.round(PTS.hop_on * addBonus(sizeMult(spendUsd)));   // one factor today, but the same rule as the rest
          earned = spendUsd > 0 ? awardPoints(me.id, 'hop_on', hopBase, 'hop:' + me.id + ':' + callId, Math.min(callHeadroom(0, HOP_POINTS_CAP), hopBase * OPEN_STACK_MAX)) : 0; // paid on a verified buy only, and at most 10× the size-scaled base — a tap with nothing in the token earns nothing
          if (earned > 0) db.prepare('UPDATE call_hops SET points_paid = points_paid + ? WHERE call_id = ? AND user_id = ?').run(earned, callId, me.id);
          notify(c.user_id, '🚀', 'Someone Sent It on your $' + c.symbol + ' Send Call!' + (spendUsd >= 100 ? ' ($' + Math.round(spendUsd) + ' in)' : ''), 'points');
        } else {
          db.prepare('INSERT INTO call_hops (call_id, user_id, created_at, entry_price, last_check) VALUES (?,?,?,?,?) ON CONFLICT(call_id, user_id) DO NOTHING').run(callId, me.id, tHop, hopEntry, tHop);
        }
        const hops = db.prepare('SELECT COUNT(*) n FROM call_hops WHERE call_id = ?').get(callId).n;
        return send(res, 200, { ok: true, hops, hopped: true, wallet: c.wallet || null, symbol: c.symbol, pointsEarned: earned, paying: !dupTok });
      }

      /* ----- gamification ----- */
      if (p === '/api/gamify/me' && req.method === 'GET') {
        if (!me) return bad(res, 'sign in first', 401);
        // (the daily bonus is NOT granted here any more — it's an explicit "check in" the user taps on their wall)
        const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id); // SELECT * so gamifySummary sees call_limit/call_eval_at for callAllowance
        return send(res, 200, gamifySummary(fresh));
      }
      /* ----- daily check-in: showing up is a thing you DO, not something that happens to you ----- */
      if (p === '/api/checkin' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('checkin:' + me.id, 20, 6e5)) return bad(res, 'slow down', 429);
        const ref = 'daily:' + me.id + ':' + ymd();
        if (db.prepare('SELECT 1 FROM points_events WHERE ref = ?').get(ref)) return send(res, 200, { already: true, awarded: 0, checkedInToday: true });
        const awarded = awardPoints(me.id, 'daily', PTS.daily, ref);          // idempotent per UTC day via the ref
        return send(res, 200, { already: false, awarded, checkedInToday: true });
      }
      if (p === '/api/gamify/refresh' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        if (!rateLimit('gref:' + me.id, 20, 6e5)) return bad(res, 'holdings refresh is throttled — try again shortly', 429);
        let holder;
        try { holder = await refreshHolder(me.id); }
        catch { return bad(res, 'could not read the chain right now — try again', 502); }
        // opportunistically verify OG status (early $SEND/$GWC buyer): instant for existing OGs, and at most a once-per-6h historical scan for others
        try { const o = db.prepare('SELECT og_tier, og_revoked, og_checked_at FROM users WHERE id=?').get(me.id); if (o && !o.og_tier && !o.og_revoked && now() <= OG_GRANT_UNTIL_MS && now() - (o.og_checked_at || 0) > 6 * 3600 * 1000) await checkOg(me.id); } catch {}
        const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id); // SELECT * so gamifySummary sees call_limit/call_eval_at for callAllowance
        return send(res, 200, { ...gamifySummary(fresh), holderLive: holder });
      }
      // lift a read-only restriction early by buying (and then holding) $SEND — verified on-chain, spoof-proof
      if (p === '/api/restriction/redeem' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        const r = restrictionOf(me);
        if (!r) return bad(res, 'you’re not in read-only mode.');
        if (!rateLimit('redeem:' + me.id, 10, 6e5)) return bad(res, 'slow down — try again shortly', 429);
        if (!walletAddresses(me.id).length) return bad(res, 'link a wallet first so we can read your $SEND on-chain.');
        const need = redeemCostUsd(me);   // $25 per 24h of a timed mute, or $1000 flat for a permanent one
        const dur = redeemHoldMs(me);      // permanent → 40-day hold; timed → the restriction length
        const perm = (me.restrict_level || 0) >= 3;
        let holder; try { holder = await refreshHolder(me.id); } catch { return bad(res, 'could not read your wallet on-chain right now — try again', 502); }
        const newSend = holder.sendTok || 0;
        const base = me.redeem_base_send;
        if (base < 0) { // baseline was never captured on-chain → record current holdings now; a genuine NEW buy is required on top
          db.prepare('UPDATE users SET redeem_base_send=? WHERE id=?').run(newSend, me.id);
          return send(res, 400, { error: 'We’ve recorded your current $SEND. Now buy at least $' + need + ' more and tap again to lift your read-only.', code: 'baseline_set' });
        }
        let price = 0; try { const sp = await lookupTokenPair(TOK.SEND); price = (sp && sp.pair && sp.pair.market && sp.pair.market.priceUsd) || 0; } catch {}
        if (!(price > 0)) return bad(res, 'couldn’t verify the $SEND price right now — try again', 502); // fail-closed: never lift without confirming a real buy
        const buyUsd = Math.max(0, newSend - base) * price;
        if (buyUsd < need) {
          return send(res, 400, { error: 'Buy at least $' + need + ' more $SEND to lift your ' + (perm ? 'permanent ' : '') + 'read-only — you’ve added $' + buyUsd.toFixed(2) + ' so far. Buy more, then tap again.', code: 'need_more', addedUsd: Math.round(buyUsd * 100) / 100, needUsd: need });
        }
        // lift now, but start the hold: keep this $SEND for `dur` or read-only returns (doubled if timed, permanent if it was permanent)
        db.prepare('UPDATE users SET restricted_until=0, redeem_hold_until=?, redeem_floor=?, redeem_base_send=? WHERE id=?').run(now() + dur, newSend, newSend, me.id);
        notify(me.id, '🔓', 'You bought $' + Math.round(buyUsd) + ' of $SEND and lifted your ' + (perm ? 'permanent ' : '') + 'read-only. Keep your $SEND (don’t sell any) for ' + humanDur(dur) + ' to clear this for good — sell before then and ' + (perm ? 'the permanent mute returns' : 'read-only returns, doubled') + '.', 'restriction');
        const u2 = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id);
        return send(res, 200, { ok: true, lifted: true, boughtUsd: Math.round(buyUsd * 100) / 100, restriction: restrictionOf(u2), probation: probationOf(u2) });
      }
      if (p === '/api/gamify/swap' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        if (!rateLimit('gswap:' + me.id, 30, 6e5)) return bad(res, 'slow down', 429);
        const b = await readBody(req);
        const hash = String(b.txHash || '').toLowerCase();
        if (!/^0x[0-9a-f]{64}$/.test(hash)) return bad(res, 'bad tx hash');
        let rcpt, head;
        try { rcpt = await rpc('eth_getTransactionReceipt', [hash]); head = BigInt(await rpc('eth_blockNumber', []) || '0x0'); }
        catch { return bad(res, 'could not verify the transaction', 502); }
        if (!rcpt || rcpt.status !== '0x1') return bad(res, 'transaction not found or unsuccessful');
        const from = (rcpt.from || '').toLowerCase(), to = (rcpt.to || '').toLowerCase();
        if (to !== SWAP_ROUTER) return bad(res, 'that transaction is not a $Send / $GWC swap');
        // ownership FIRST — so a non-owner can never learn whether a hash was already claimed (membership oracle)
        if (!walletAddresses(me.id).includes(from)) return bad(res, 'that swap was not from a wallet linked to your account');
        // finality: give it a few blocks so a reorg can't strip a credited swap
        if (head > 0n && head - BigInt(rcpt.blockNumber || '0x0') < 5n) return bad(res, 'give the swap a few blocks to confirm, then try again');
        // require a REAL $Send/$GWC transfer involving the wallet — not just any tx to the router (blocks no-op/dust farming)
        const meTopic = addrTopic(from);
        // the wallet must RECEIVE the coin (a sell moves it the other way and earned the same 450), and it must be a
        // real buy: the received amount is valued at the live price and must clear SWAP_MIN_USD — 1 wei used to qualify
        let movedIn = 0n, movedTok = null;
        for (const l of rcpt.logs || []) {
          const la = (l.address || '').toLowerCase();
          if (la !== TOK.SEND && la !== TOK.GWC) continue;
          if (!l.topics || (l.topics[0] || '').toLowerCase() !== TRANSFER_TOPIC) continue;
          if ((l.topics[2] || '').toLowerCase() !== meTopic) continue;
          let val = 0n; try { val = BigInt(l.data || '0x0'); } catch {}
          if (val > movedIn) { movedIn = val; movedTok = la; }
        }
        if (!(movedIn > 0n)) return bad(res, 'that transaction did not move any $Send or $GWC to your wallet');
        const px = await tokenPriceUsdOf(movedTok);
        if (!(px > 0)) return bad(res, 'the coin price cannot be read right now — try again in a minute', 503);
        if (Number(movedIn) / 1e18 * px < SWAP_MIN_USD) return bad(res, 'that swap brought in under $' + SWAP_MIN_USD + ' of the coin — Send Power is paid on real buys');
        if (db.prepare('SELECT 1 FROM points_events WHERE ref = ?').get('swaptx:' + hash)) return send(res, 200, { awarded: 0, already: true });
        return send(res, 200, { awarded: awardPoints(me.id, 'swap', PTS.swap, 'swaptx:' + hash) });
      }
      // The Biggest Sender board: this week's standings (earned inside the week, prize factor divided out),
      // the clock, last week's winners and what they drew, and the caller's own row. Public — the board is
      // the same for everyone; only `me` needs a session.
      if (p === '/api/competition' && req.method === 'GET') {
        const { win, rows } = competitionStandings();
        const view = r => ({ rank: r.rank, username: r.username, avatar: r.avatar, avatar_img: r.avatar_img ? '/uploads/' + r.avatar_img : null,
          accent: r.accent || '', og: r.og_tier || 0, points: r.pts, actions: r.n });
        const mine = me ? rows.find(r => r.id === me.id) : null;
        return send(res, 200, {
          week: { key: win.key, startsAt: win.startsAt, endsAt: win.endsAt, msLeft: Math.max(0, win.endsAt - now()) },
          top: rows.slice(0, 20).map(view),
          me: me ? (mine ? view(mine) : { rank: null, points: 0, actions: 0, username: me.username }) : null,
          myBoost: me ? weekBoostState(me.id) : null,
          last: lastSettledCompetition(),
          prize: { winners: WEEK_WINNERS, ladder: WEEK_PRIZES, lastsDays: 7, byRank: true, tiesTo: 'joined first', excludedFromStandings: true, rankedBy: 'base' },
        });
      }
      if (p === '/api/competitions' && req.method === 'GET') {
        if (!hubCache.val || now() - hubCache.at > HUB_TTL) hubCache = { at: now(), val: competitionsPublic() };
        const pub = hubCache.val;
        const mine = me ? competitionStandings().rows.find(r => r.id === me.id) : null;
        const myCall = me ? pub.sendCalls.all.find(r => r.username.toLowerCase() === me.username.toLowerCase()) : null; // the board's top 25 — beyond that, unranked
        const { all, ...sendCalls } = pub.sendCalls;
        return send(res, 200, {
          serverNow: now(),
          biggestSender: { ...pub.biggestSender,
            me: me ? (mine ? { rank: mine.rank, points: mine.pts, actions: mine.n } : { rank: null, points: 0, actions: 0 }) : null,
            myBoost: me ? weekBoostState(me.id) : null },
          sendCalls: { ...sendCalls, me: me ? (myCall ? { rank: myCall.rank, calls: myCall.calls, bestX: myCall.bestX, totalX: myCall.totalX, bestGrade: myCall.bestGrade } : { rank: null }) : null },
          communities: { ...pub.communities, board: pub.communities.board.map(c => ({ ...c, joined: me ? !!db.prepare('SELECT 1 FROM community_members WHERE community_id=? AND user_id=?').get(c.id, me.id) : false })) },
          og: { ...pub.og, mine: me ? { og: !!me.og, tier: me.og_tier || 0, name: OG_TIER_NAME[me.og_tier || 0] || '' } : null },
          rocketRun: { ...pub.rocketRun, me: me ? arcadeState(me.id) : null },
          allTime: { ...pub.allTime, me: me ? { rank: userRank(me.id), points: me.points, level: levelForXp(me.points) } : null },
          me: me ? { username: me.username, boost: effectiveMult(me.id) } : null,
        });
      }
      if (p === '/api/leaderboard' && req.method === 'GET') {
        // The top-20 list is identical for everyone, so cache it briefly (it also runs a publicDiamond() query
        // per row). Only the per-user `me` block is computed fresh. Huge win when many users hit the board at once.
        return send(res, 200, { top: allTimeTop(), me: me ? { rank: userRank(me.id), points: me.points, level: levelForXp(me.points) } : null });
      }

      /* ----- live new-pairs tracker (PUBLIC, server-cached, read-only on-chain data) ----- */
      if (p === '/api/pairs/new' && req.method === 'GET') {
        // ?chain=<slug> — Robinhood Chain falls through to the deep pipeline below; every other
        // supported chain is served from the Dexscreener-derived cache, with its own honest limits.
        const chainQ = String(url.searchParams.get('chain') || DEFAULT_CHAIN);
        if (chainQ !== DEFAULT_CHAIN) {
          const ch = CHAIN_BY_SLUG[chainQ];
          if (!ch || !MULTICHAIN) return bad(res, 'unknown chain');   // other chains are off unless MULTICHAIN=1
          const st = foreignCache.get(chainQ) || { pairs: [], updatedAt: 0, building: false, error: null };
          if (!st.updatedAt || now() - st.updatedAt > FOREIGN_TTL) refreshForeignChain(chainQ);
          return send(res, 200, {
            chain: chainQ, chains: PUBLIC_CHAINS,
            pairs: st.pairs.filter(identifiedPair),
            updatedAt: st.updatedAt, ttl: FOREIGN_TTL,
            building: !st.updatedAt, error: st.pairs.length ? null : st.error,
            risk: RISK_PUBLIC,
            deep: false,
            note: 'On ' + ch.name + ' we can read market data but not holders, contract verification or deployer history — those come from a block explorer we only have for Robinhood Chain. Checks that need them are shown as unknown rather than passed.',
          });
        }
        if (!pairsCache.updatedAt && !pairsRefreshing) { pairsCache.building = true; refreshPairs(); } // lazy first build
        else if (pairsCache.updatedAt && now() - pairsCache.updatedAt > PAIRS_TTL && !pairsRefreshing) refreshPairs(); // stale → refresh in bg, serve current
        // This feed is identical for every user, so serialize + gzip it ONCE per cache version instead of per request
        // (it's ~90KB → re-gzipping it on every hit would burn CPU on the event loop under load).
        const building = pairsCache.building && !pairsCache.updatedAt;
        const shown = pairsCache.pairs.filter(identifiedPair);   // never serve a token we couldn't name
        // `degraded` is part of the cache key: an outage must produce a NEW payload, or readers keep getting
        // the pre-outage body from the compressed cache with no sign anything is stale.
        const key = pairsCache.updatedAt + '|' + shown.length + '/' + pairsCache.pairs.length + '|' + (building ? 'b' : '') + '|' + (pairsCache.degraded || '') + '|' + (pairsCache.pairs.length ? '' : (pairsCache.error || ''));
        if (pairsRespCache.key !== key) {
          const json = JSON.stringify({ chain: DEFAULT_CHAIN, chains: PUBLIC_CHAINS, deep: true, pairs: shown, updatedAt: pairsCache.updatedAt, ttl: PAIRS_TTL, building, error: pairsCache.pairs.length ? null : pairsCache.error, degraded: pairsCache.degraded || null, risk: RISK_PUBLIC });
          pairsRespCache = { key, json, gz: zlib.gzipSync(json), br: brc(Buffer.from(json)) }; // compressed once per cache version
        }
        const base = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS };
        if (res._enc === 'br') { res.writeHead(200, { ...base, 'Content-Encoding': 'br', 'Vary': 'Accept-Encoding', 'Content-Length': pairsRespCache.br.length }); res.end(req.method === 'HEAD' ? undefined : pairsRespCache.br); }
        else if (res._gzip) { res.writeHead(200, { ...base, 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding', 'Content-Length': pairsRespCache.gz.length }); res.end(req.method === 'HEAD' ? undefined : pairsRespCache.gz); }
        else { res.writeHead(200, { ...base, 'Content-Length': Buffer.byteLength(pairsRespCache.json) }); res.end(req.method === 'HEAD' ? undefined : pairsRespCache.json); }
        return;
      }

      /* ----- look up ANY token address → full on-chain pair detail (powers the DEX-list search) ----- */
      if (p === '/api/runners' && req.method === 'GET') { // Best Runners: top gainers over a trailing window
        if (!rateLimit('runners:' + clientIp(req), 60, 60000)) return bad(res, 'slow down', 429);
        if (!pairsCache.updatedAt && !pairsRefreshing) { pairsCache.building = true; refreshPairs(); } // ensure the store is being fed
        maybeRefreshRunners();
        const wkey = Object.prototype.hasOwnProperty.call(RUNNER_WINDOWS, url.searchParams.get('window')) ? url.searchParams.get('window') : '24h';
        const tracked = db.prepare('SELECT MIN(first_seen_at) m FROM runner_tokens').get().m || now();
        return send(res, 200, { window: wkey, runners: bestRunners(wkey), trackingSinceMs: tracked, updatedAt: now() });
      }
      /* ----- live spot price: what the 1-second line poll hits ----- */
      if (p === '/api/price' && req.method === 'GET') {
        const pair = String(url.searchParams.get('pair') || '').toLowerCase().trim();
        const token = String(url.searchParams.get('token') || '').toLowerCase().trim();
        if (!/^0x[0-9a-f]{40}$/.test(pair) || !/^0x[0-9a-f]{40}$/.test(token)) return bad(res, 'bad pair or token address');
        // generous, because this is designed to be polled once a second by every open chart
        if (!rateLimit('spot:' + clientIp(req), 240, 6e4)) return bad(res, 'slow down', 429);
        let price = null, why = null;
        try { price = await spotPrice(pair, token); if (price == null) why = 'could not read the pair reserves'; }
        catch (e) { why = (e && e.message) || 'chain read failed'; }
        return send(res, 200, { pair, token, price, why, ethUsd: await ethUsd(), at: now() }, { 'Cache-Control': 'no-store' });
      }
      /* Spot price for many pairs at once, straight from the pool reserves.
         A Send Call's X is price ÷ entry, and until now the price behind it came from Dexscreener through a
         45-second server refresh — so a card could sit a minute behind a chain it claims to be reading. This
         is the same read the live chart already polls once a second, batched so a wall of cards costs one
         request instead of one each. spotPrice is cached (900ms) and single-flighted, so ten cards on the
         same token collapse to one chain read. Returned in USD, so no caller has to know that a pool prices
         its token in WETH while every stored price on this site is in dollars. */
      if (p === '/api/spot' && req.method === 'GET') {
        if (!rateLimit('spotb:' + clientIp(req), 240, 6e4)) return bad(res, 'slow down', 429);
        const want = String(url.searchParams.get('pairs') || '').split(',').map(x => x.trim().toLowerCase())
          .filter(x => /^0x[0-9a-f]{40}:0x[0-9a-f]{40}$/.test(x));
        const uniq = [...new Set(want)].slice(0, SPOT_BATCH_MAX);
        const prices = {};
        await Promise.all(uniq.map(async (k) => {
          const [pair, token] = k.split(':');
          // a pair we cannot read is reported as null, never as a stale or invented number
          try { prices[k] = await spotPriceUsd(pair, token); } catch { prices[k] = null; }
        }));
        return send(res, 200, { prices, at: now() }, { 'Cache-Control': 'no-store' });
      }
      /* ----- on-chain candles: our own chart, no third-party chart service ----- */
      if (p === '/api/chart' && req.method === 'GET') {
        const pair = String(url.searchParams.get('pair') || '').toLowerCase().trim();
        const token = String(url.searchParams.get('token') || '').toLowerCase().trim();
        if (!/^0x[0-9a-f]{40}$/.test(pair) || !/^0x[0-9a-f]{40}$/.test(token)) return bad(res, 'bad pair or token address');
        if (!rateLimit('chart:' + clientIp(req), 90, 6e4)) return bad(res, 'slow down', 429);
        const tf = Object.prototype.hasOwnProperty.call(CHART_TF, url.searchParams.get('tf')) ? url.searchParams.get('tf') : '1h';
        const hours = Math.min(720, Math.max(1, Number(url.searchParams.get('hours')) || 168));
        let data; try { data = await buildCandles(pair, token, tf, hours); } catch (e) { return bad(res, 'could not read the chain', 502); }
        if (!data) return bad(res, 'could not read the chain', 502);
        return send(res, 200, data, { 'Cache-Control': 'public, max-age=30' });
      }
      if (p === '/api/pairs/contract' && req.method === 'GET') { // deep honeypot / contract-code read (lazy, cached)
        const token = String(url.searchParams.get('token') || '').toLowerCase().trim();
        const pair = String(url.searchParams.get('pair') || '').toLowerCase().trim();
        if (!/^0x[0-9a-f]{40}$/.test(token)) return bad(res, 'bad token address');
        if (!rateLimit('contract:' + clientIp(req), 60, 6e4)) return bad(res, 'slow down', 429);
        return send(res, 200, await analyzeContract(token, /^0x[0-9a-f]{40}$/.test(pair) ? pair : null));
      }
      /* The block-0 sniper report for one token: who bought in the first block the pool ever traded, what
         they did with it, and the ledger. Served from the cached scan; a token nobody has asked about yet
         is queued and answers `queued` rather than blocking the request on 30-90 chain reads. */
      if (p === '/api/token/snipers' && req.method === 'GET') {
        const token = String(url.searchParams.get('token') || '').toLowerCase().trim();
        if (!/^0x[0-9a-f]{40}$/.test(token)) return bad(res, 'enter a valid 0x token address');
        if (!rateLimit('snipers:' + clientIp(req), 90, 6e4)) return bad(res, 'slow down', 429);
        const row = sniperRow(token);
        const data = sniperData(row);
        if (!row || (!data && row.status !== 'running')) {
          // find the pair from whatever we already know, so asking never costs a lookup the caller did not pay for
          let pair = row && row.pair_addr ? row.pair_addr : null, createdAt = 0;
          if (!pair) { try { const tc = tokenCacheGet(token); const pj = tc && tc.found ? JSON.parse(tc.pair_json || 'null') : null; if (pj && pj.pair && pj.pair.address) { pair = lcAddr(pj.pair.address); createdAt = Number(pj.pair.createdAt) || 0; } } catch {} }
          if (pair) queueSniperScan(token, pair, createdAt);
          return send(res, 200, { status: pair ? 'queued' : 'unknown', token, snipers: null,
            message: pair ? 'Reading the first block of this pool now — check back in a moment.' : 'No indexed pool for this token, so there is no first block to read.' });
        }
        return send(res, 200, {
          status: row.status, token, reason: row.reason || null,
          scannedAt: row.finished_at || null, calls: row.calls || null,
          verdict: data ? sniperVerdict(data) : null,
          ...(data || {}),
        });
      }
      /* ----- Telegram scanner ----- */
      // Public: what the New Pairs page needs to offer the bot honestly — including saying it is not set up.
      if (p === '/api/telegram/info' && req.method === 'GET') {
        const uname = tgMe && tgMe.username ? tgMe.username : null;
        return send(res, 200, {
          enabled: !!(TG_ON && uname),
          username: uname,
          bot: uname ? 'https://t.me/' + uname : null,
          addToGroup: uname ? 'https://t.me/' + uname + '?startgroup=scan' : null,
          scanPrefix: uname ? 'https://t.me/' + uname + '?start=' : null,   // + a token address
        });
      }
      /* Telegram POSTs updates here. The secret header is the only thing that makes this endpoint ours:
         the URL is guessable, so without it anyone could feed the bot fabricated updates. Compared in
         constant time, and the route stays closed entirely unless a bot token is configured. */
      if (p === '/api/telegram/webhook' && req.method === 'POST') {
        if (!TG_ON) return bad(res, 'not found', 404);
        const got = String(req.headers['x-telegram-bot-api-secret-token'] || '');
        const want = TG_SECRET;
        const ok = got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
        if (!ok) return bad(res, 'not found', 404);
        let u = null; try { u = await readBody(req, 1024 * 1024); } catch { return bad(res, 'bad update'); }
        // answer Telegram immediately; a scan takes seconds and it retries anything it thinks timed out
        send(res, 200, { ok: true });
        handleTgUpdate(u).catch((e) => console.error('telegram update failed:', e.message));
        return;
      }
      if (p === '/api/pairs/lookup' && req.method === 'GET') {
        const token = String(url.searchParams.get('token') || '').toLowerCase().trim();
        if (!/^0x[0-9a-f]{40}$/.test(token)) return bad(res, 'enter a valid 0x token address');
        if (!rateLimit('lookup:' + clientIp(req), 60, 6e4)) return bad(res, 'too many lookups — slow down', 429);
        try {
          const r = await lookupTokenPair(token);
          // "we couldn't check" is not "this token is dead" — the client renders these very differently
          if (r.unavailable) return send(res, 200, {
            unavailable: true, reason: r.reason || null,
            message: 'We couldn\u2019t reach the price feed or the chain just now, so we can\u2019t tell you anything about this token yet. Nothing here is a judgement about it \u2014 try again in a moment.',
          });
          if (r.notFound) return send(res, 200, {
            notFound: true, reason: r.reason || null,
            message: r.reason === 'quote'
              ? 'That’s a base trading asset (WETH/USDG), not a token to profile here.'
              : 'No indexed trading pair or WETH/USDG pool found for this address.',
          });
          return send(res, 200, { pair: r.pair, risk: Object.fromEntries(Object.entries(RISK).map(([k, v]) => [k, { sev: v.sev, label: v.label }])), community: communityForToken(token) });
        } catch (e) { return bad(res, (e && e.message) || 'lookup failed — try again', (e && e.status) || 502); }
      }

      /* ----- same-origin image proxy: lets the client draw a Dexscreener token logo onto a
         share-card <canvas> without CORS-tainting it. Locked to the Dexscreener CDN (no SSRF). ----- */
      if (p === '/api/img' && req.method === 'GET') {
        const u = String(url.searchParams.get('u') || '');
        if (!/^https:\/\/(cdn|dd)\.dexscreener\.com\/[^\s]+$/i.test(u)) return bad(res, 'unsupported image host');
        if (!rateLimit('img:' + clientIp(req), 120, 6e4)) return bad(res, 'slow down', 429);
        try {
          const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 8000);
          const r2 = await fetch(u, { headers: { 'User-Agent': BROWSER_UA, 'Accept': 'image/*' }, signal: ctrl.signal });
          clearTimeout(to);
          if (!r2.ok) return bad(res, 'image fetch failed', 502);
          if (r2.url && !/^https:\/\/(cdn|dd)\.dexscreener\.com\//i.test(r2.url)) return bad(res, 'image redirected off the allowed CDN', 502); // SSRF defense-in-depth: reject a redirect that leaves the Dexscreener CDN
          const ct = r2.headers.get('content-type') || 'image/png';
          if (!/^image\//i.test(ct)) return bad(res, 'not an image', 415);
          const buf = Buffer.from(await r2.arrayBuffer());
          if (buf.length > 3_000_000) return bad(res, 'image too large', 413);
          res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400', 'Content-Length': buf.length });
          res.end(buf);
        } catch { return bad(res, 'image fetch failed', 502); }
        return;
      }

      /* ----- watchlist (personal saved tokens; enriched view reuses the pairs pipeline) ----- */
      if (p === '/api/watchlist/ids' && req.method === 'GET') { // light: just the saved pair addresses (for save-button state)
        if (!me) return send(res, 200, { ids: [] });
        return send(res, 200, { ids: db.prepare('SELECT pair_addr FROM watchlist WHERE user_id=?').all(me.id).map(r => r.pair_addr) });
      }
      if (p === '/api/watchlist' && req.method === 'GET') {
        if (!me) return bad(res, 'sign in first', 401);
        return send(res, 200, { items: await watchlistView(me.id) });
      }
      if (p === '/api/watchlist' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        if (!rateLimit('wl:' + me.id, 60, 60000)) return bad(res, 'slow down', 429);
        const b = await readBody(req);
        const pair = String(b.pair || '').toLowerCase(), token = String(b.token || '').toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(pair) || !/^0x[0-9a-f]{40}$/.test(token)) return bad(res, 'bad address', 400);
        if (db.prepare('SELECT COUNT(*) n FROM watchlist WHERE user_id=?').get(me.id).n >= 500) return bad(res, 'watchlist full (max 500)', 400);
        const t0 = /^0x[0-9a-f]{40}$/.test(String(b.token0 || '').toLowerCase()) ? String(b.token0).toLowerCase() : null;
        const t1 = /^0x[0-9a-f]{40}$/.test(String(b.token1 || '').toLowerCase()) ? String(b.token1).toLowerCase() : null;
        const qs = String(b.quoteSymbol || '?').slice(0, 8);
        let snap = null; try { if (b.snapshot && typeof b.snapshot === 'object') snap = JSON.stringify(sanitizeSnapshot(b.snapshot)).slice(0, 20000); } catch {}
        const isNew = !db.prepare('SELECT 1 FROM watchlist WHERE user_id=? AND pair_addr=?').get(me.id, pair);
        db.prepare('INSERT INTO watchlist (user_id, pair_addr, token_addr, token0, token1, quote_symbol, snapshot, added_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,pair_addr) DO NOTHING')
          .run(me.id, pair, token, t0, t1, qs, snap, now());
        let earned = 0;
        if (isNew) {
          earned = awardPoints(me.id, 'watch_token', PTS.watch_token, 'watch:' + me.id + ':' + pair); // once per token, ever
          const sym = String(b.symbol || '').replace(/[^\w]/g, '').slice(0, 16);
          notify(me.id, '⭐', 'Added ' + (sym ? '$' + sym : 'a token') + ' to your watchlist' + (earned ? ' — +' + earned + ' Send Power' : '') + '.', 'watchlist');
        }
        return send(res, 200, { ok: true, pointsEarned: earned });
      }
      if (p === '/api/watchlist' && req.method === 'DELETE') {
        if (!me) return bad(res, 'sign in first', 401);
        const b = await readBody(req);
        db.prepare('DELETE FROM watchlist WHERE user_id=? AND pair_addr=?').run(me.id, String(b.pair || '').toLowerCase());
        return send(res, 200, { ok: true });
      }

      /* ----- pinned tokens: the "Convicted In" showcase on your public wall (pin from anywhere you see a token) ----- */
      if (p === '/api/pins/ids' && req.method === 'GET') { // light: my pinned token addresses (drives pin-button state)
        if (!me) return send(res, 200, { ids: [] });
        return send(res, 200, { ids: db.prepare('SELECT token_addr FROM pinned_tokens WHERE user_id=?').all(me.id).map(r => r.token_addr) });
      }
      if (p === '/api/pins' && req.method === 'GET') { // PUBLIC: a user's pinned tokens (newest first)
        if (!rateLimit('pinsget:' + clientIp(req), 90, 60000)) return bad(res, 'slow down', 429);
        const uname = String(url.searchParams.get('user') || '').trim();
        const u = uname ? db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(uname) : me;
        if (!u) return send(res, 200, { pins: [], max: PIN_MAX });
        const rows = db.prepare('SELECT token_addr, pair_addr, symbol, name, brand, pin_price, pin_mc, added_at FROM pinned_tokens WHERE user_id=? ORDER BY added_at DESC').all(u.id);
        // attach this user's conviction level in a community for the pinned token (Convicted In badge)
        const convFor = (tok) => {
          const r = db.prepare('SELECT c.id, c.status, cm.conviction_xp FROM communities c JOIN community_members cm ON cm.community_id = c.id AND cm.user_id = ? AND cm.qualified = 1 WHERE c.token_addr = ? COLLATE NOCASE').get(u.id, tok);
          return r ? { communityId: r.id, live: r.status === 'live', level: levelForXp(r.conviction_xp), title: convictionTitleFor(levelForXp(r.conviction_xp)) } : null;
        };
        const mkt = await marketFor(rows.map(r => r.token_addr)); // current mcap / price → "Xs up since you convicted"
        return send(res, 200, { max: PIN_MAX, pins: rows.map(r => {
          let brand = null; try { brand = JSON.parse(r.brand || 'null'); } catch {}
          const m = mkt[r.token_addr.toLowerCase()] || null;
          const curPrice = m && m.price != null ? m.price : null;
          const xs = (r.pin_price > 0 && curPrice != null) ? callX(curPrice, r.pin_price) : null; // +100% = 1.0x (same convention as Send Calls)
          return { token: r.token_addr, pair: r.pair_addr, symbol: r.symbol, name: r.name, brand, conviction: convFor(r.token_addr),
            pinnedAt: r.added_at, pinPrice: r.pin_price || null, pinMc: r.pin_mc || null,
            curMc: m ? m.mc : null, curPrice, priceChange24: m ? m.pc24 : null, xs };
        }) });
      }
      if (p === '/api/pins' && req.method === 'POST') { // pin a token to your wall
        if (!me) return bad(res, 'sign in first', 401);
        if (restrictionOf(me)) return bad(res, 'your account is in read-only mode', 403);
        if (!rateLimit('pin:' + me.id, 60, 60000)) return bad(res, 'slow down', 429);
        if (!rateLimit('pinip:' + clientIp(req), 60, 60000)) return bad(res, 'slow down', 429); // per-IP too (a resolve hits Dexscreener/RPC — don't let cheap accounts bypass the cap)
        const b = await readBody(req);
        const token = String(b.token || '').toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(token)) return bad(res, 'bad token address', 400);
        const existing = db.prepare('SELECT pin_price FROM pinned_tokens WHERE user_id=? AND token_addr=?').get(me.id, token);
        const already = !!existing;
        if (!already && db.prepare('SELECT COUNT(*) n FROM pinned_tokens WHERE user_id=?').get(me.id).n >= PIN_MAX) return bad(res, 'you can pin up to ' + PIN_MAX + ' tokens — remove one first', 400);
        let pair = /^0x[0-9a-f]{40}$/.test(String(b.pair || '').toLowerCase()) ? String(b.pair).toLowerCase() : null;
        let symbol = String(b.symbol || '').replace(/[^\w.\-]/g, '').slice(0, 16);
        let name = String(b.name || '').slice(0, 40);
        let brand = null; try { const img = b.brand && dexCdnImg(b.brand.imageUrl); if (img) brand = JSON.stringify({ imageUrl: img }); } catch {}
        const clientHadMeta = !!(symbol || pair);
        // Resolve on-chain ONLY when we need it — a new pin (for symbol/name/brand + the pin_price baseline) or a re-pin
        // whose baseline is still missing. A benign re-pin that already has a baseline skips the upstream call entirely.
        const needLookup = !already || existing.pin_price == null;
        let pinPrice = null, pinMc = null, resolvedOk = false;
        if (needLookup) {
          try {
            const rr = await lookupTokenPair(token);
            if (rr && rr.pair && !rr.notFound && !rr._quoteSide && !(rr.pair && rr.pair._quoteSide)) {
              const pr = rr.pair; resolvedOk = true;
              if (pr.token && pr.token.symbol && pr.token.symbol !== '???') symbol = String(pr.token.symbol).replace(/[^\w.\-]/g, '').slice(0, 16) || symbol;
              if (pr.token && pr.token.name && pr.token.name !== 'Unknown Token') name = String(pr.token.name).slice(0, 40) || name;
              if (pr.pair && /^0x[0-9a-f]{40}$/.test(String(pr.pair.address || '').toLowerCase())) pair = String(pr.pair.address).toLowerCase();
              try { const img = pr.brand && dexCdnImg(pr.brand.imageUrl); if (img) brand = JSON.stringify({ imageUrl: img }); } catch {}
              if (pr.market) { if (pr.market.priceUsd > 0) pinPrice = pr.market.priceUsd; if (pr.market.marketCap != null) pinMc = pr.market.marketCap; }
            }
          } catch {}
        }
        if (already && !resolvedOk && !clientHadMeta) return send(res, 200, { ok: true, pinned: true, symbol: '', name: '' }); // already convicted; a transient lookup miss shouldn't error or wipe the row
        if (!resolvedOk && !clientHadMeta) return bad(res, 'Couldn’t find a tradeable pair for that token — double-check the contract address.', 400);
        // First pin sets the conviction baseline (pin_price/pin_mc/added_at). A re-pin refreshes display metadata (never with empties) and
        // backfills a missing baseline via COALESCE, but never overwrites an existing one — so "Xs since you convicted" stays anchored.
        db.prepare(`INSERT INTO pinned_tokens (user_id, token_addr, pair_addr, symbol, name, brand, pin_price, pin_mc, added_at) VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT(user_id,token_addr) DO UPDATE SET
            pair_addr = COALESCE(excluded.pair_addr, pair_addr),
            symbol = CASE WHEN excluded.symbol != '' THEN excluded.symbol ELSE symbol END,
            name = CASE WHEN excluded.name != '' THEN excluded.name ELSE name END,
            brand = COALESCE(excluded.brand, brand),
            pin_price = COALESCE(pin_price, excluded.pin_price),
            pin_mc = COALESCE(pin_mc, excluded.pin_mc)`)
          .run(me.id, token, pair, symbol, name, brand, pinPrice, pinMc, now());
        return send(res, 200, { ok: true, pinned: true, symbol, name });
      }
      if (p === '/api/pins' && req.method === 'DELETE') { // unpin
        if (!me) return bad(res, 'sign in first', 401);
        const b = await readBody(req);
        db.prepare('DELETE FROM pinned_tokens WHERE user_id=? AND token_addr=?').run(me.id, String(b.token || '').toLowerCase());
        return send(res, 200, { ok: true, pinned: false });
      }
      if (p === '/api/pins/holding' && req.method === 'GET') { // Convicted-In hover: the wall owner's on-chain holding + how long (scoped to tokens they publicly convicted)
        if (!rateLimit('holding:' + clientIp(req), 15, 60000)) return bad(res, 'slow down', 429); // does heavy on-chain + indexer reads — cap tighter than the cheap lookups
        const uname = String(url.searchParams.get('user') || '').trim();
        const token = String(url.searchParams.get('token') || '').toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(token)) return bad(res, 'bad token', 400);
        const u = uname ? db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(uname) : me;
        if (!u) return send(res, 200, { hasWallet: false, held: false });
        if (!db.prepare('SELECT 1 FROM pinned_tokens WHERE user_id=? AND token_addr=? COLLATE NOCASE').get(u.id, token)) return send(res, 200, { hasWallet: false, held: false }); // only expose holdings for tokens they've publicly convicted
        const h = await convictionHolding(u.id, token);
        let amountUsd = null; if (h.hasWallet && h.amountTok > 0) { try { const m = (await marketFor([token]))[token]; if (m && m.price != null) amountUsd = h.amountTok * m.price; } catch {} }
        return send(res, 200, { ...h, amountUsd });
      }

      /* ===== Communities: token communities that go live at 10 opt-ins; being in one = a flat 10× Send Power ===== */
      if (p === '/api/communities' && req.method === 'POST') { // start a community from a pasted contract address
        if (!me) return bad(res, 'sign in first', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('commcreate:' + me.id, 3, 864e5)) return bad(res, 'you can start up to 3 communities per day', 429);
        if (!rateLimit('commcreateip:' + clientIp(req), 5, 864e5)) return bad(res, 'slow down', 429);
        const b = await readBody(req);
        const token = String(b.token || '').toLowerCase().trim();
        if (!/^0x[0-9a-f]{40}$/.test(token)) return bad(res, 'paste a valid 0x token contract address');
        const existing = db.prepare('SELECT id FROM communities WHERE token_addr = ? COLLATE NOCASE').get(token);
        if (existing) return send(res, 409, { error: 'a community already exists for this token', existingId: existing.id });
        let r; try { r = await lookupTokenPair(token); } catch { return bad(res, 'couldn’t read that token on-chain — try again', 502); }
        if (r.notFound || !r.pair || r._quoteSide || (r.pair && r.pair._quoteSide)) return bad(res, 'no tradeable pair found for that address (or it’s a base asset like WETH)');
        const pr = r.pair;
        if (!(pr.market && pr.market.priceUsd > 0)) return bad(res, 'that token isn’t priced on Dexscreener');
        if (!(pr.market.liquidityUsd != null && pr.market.liquidityUsd >= MIN_COMMUNITY_LIQ)) return bad(res, 'needs at least $' + MIN_COMMUNITY_LIQ + ' pooled liquidity to start a community');
        const brand = JSON.stringify(sanitizeBrand(pr.brand || {}));
        const sym = String(pr.token.symbol || '?').slice(0, 16), name = String(pr.token.name || 'Token').slice(0, 60);
        let holdsC; try { holdsC = await holdsToken(me.id, token); } catch { return bad(res, RPC_DOWN_MSG, 503); }
        // The token's own deployer/owner wallet may start the community WITHOUT holding — a dev often keeps a clean
        // wallet. Verified on-chain (the creator address from the explorer, and owner() from the contract), and only
        // against a wallet they proved control of by signature. It grants the community, NOT a qualified member slot:
        // qualifyOptIn still needs real holdings, so a dev can't tip a community live on their own.
        const devWallet = isTokenDev(me.id, pr.token);
        if (!holdsC && !devWallet) return bad(res, 'You must hold $' + sym + ' to start its community — connect a wallet that holds it. (The token’s own deployer wallet can start it without holding.)', 403);
        const ip = clientIp(req);
        const info = db.prepare('INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, brand, status, creator_ip, c_price, c_mc, c_pc24, c_liq, c_holders, c_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(me.id, token, pr.pair.address, sym, name, brand, 'pending', ip ? bidx(ip) : null, pr.market.priceUsd, pr.market.marketCap, (pr.priceChange && pr.priceChange.h24) || null, pr.market.liquidityUsd, (pr.holders && pr.holders.count) || null, now(), now());
        // auto-opt-in the starter, but pass their REAL holding status: a deployer who started without holding joins as
        // a member and does NOT count toward the 10 verified holders needed to go live
        joinCommunity(me, info.lastInsertRowid, ip, holdsC);
        const c = db.prepare('SELECT * FROM communities WHERE id=?').get(info.lastInsertRowid);
        // announce it on the public wall — a brand-new community needs holders to find it to go live at all
        try { communityInvitePost(c.id, 'new'); } catch {}
        return send(res, 200, { id: c.id, community: communityDetailView(c, me, clientIp(req)) });
      }
      /* ----- Arcade · Rocket Run: one crash run per UTC day, cashed out for a 24h Send Power boost ----- */
      if (p === '/api/arcade/state' && req.method === 'GET') {
        if (!me) return bad(res, 'sign in first', 401);
        const last = db.prepare('SELECT crash_x, cashed_x, boost, ended_at FROM arcade_rounds WHERE user_id=? AND ended_at IS NOT NULL ORDER BY id DESC LIMIT 1').get(me.id);
        return send(res, 200, { ...arcadeState(me.id), growth: ARCADE_GROWTH, maxX: ARCADE_MAX_X, last: last || null });
      }
      if (p === '/api/arcade/start' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in to play', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('arcade:' + me.id, 10, 6e5)) return bad(res, 'slow down', 429);
        const day = ymd();
        // resume an unresolved round instead of burning the day twice (a reload mid-flight lands here)
        const open = db.prepare('SELECT * FROM arcade_rounds WHERE user_id=? AND day=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1').get(me.id, day);
        if (open) {
          if (now() - open.started_at > ARCADE_ROUND_TTL) { // walked away → it crashed without them
            db.prepare('UPDATE arcade_rounds SET ended_at=?, cashed_x=NULL, boost=NULL WHERE id=?').run(now(), open.id);
            return bad(res, 'that run expired — the rocket flew off without you. Come back tomorrow.', 409);
          }
          return send(res, 200, { roundId: open.id, startedAt: open.started_at, serverNow: now(), growth: ARCADE_GROWTH, resumed: true });
        }
        if (db.prepare('SELECT 1 FROM arcade_rounds WHERE user_id=? AND day=?').get(me.id, day)) return bad(res, 'you have already flown today — one run per day. Come back tomorrow 🚀', 429);
        // crash point: the classic 1/(1-r) tail, capped. Written now, revealed only when the round resolves.
        const r = crypto.randomInt(0, 1e9) / 1e9;
        const crash = Math.min(ARCADE_MAX_X, Math.max(1, 1 / Math.max(1e-9, 1 - r)));
        const info = db.prepare('INSERT INTO arcade_rounds (user_id, day, started_at, crash_x) VALUES (?,?,?,?)').run(me.id, day, now(), crash);
        db.prepare('UPDATE users SET arcade_day = ? WHERE id = ?').run(day, me.id); // the daily go is spent at takeoff
        return send(res, 200, { roundId: Number(info.lastInsertRowid), startedAt: now(), serverNow: now(), growth: ARCADE_GROWTH, resumed: false });
      }
      if (p === '/api/arcade/cashout' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        const b = await readBody(req);
        const round = db.prepare('SELECT * FROM arcade_rounds WHERE id=? AND user_id=?').get(Number(b.roundId) || 0, me.id);
        if (!round) return bad(res, 'no such run', 404);
        if (round.ended_at) return bad(res, 'that run is already over', 409);
        // the multiplier is decided by elapsed SERVER time — the browser's number is display only and never trusted
        const at = arcadeX(now() - round.started_at);
        if (at >= round.crash_x) {                                  // too slow: it blew before the tap landed
          db.prepare('UPDATE arcade_rounds SET ended_at=? WHERE id=?').run(now(), round.id);
          return send(res, 200, { busted: true, crashX: Math.round(round.crash_x * 100) / 100, boost: 1 });
        }
        const boost = Math.round(arcadeBoostFor(at) * 100) / 100;
        const until = now() + 864e5;
        db.prepare('UPDATE arcade_rounds SET ended_at=?, cashed_x=?, boost=? WHERE id=?').run(now(), at, boost, round.id);
        db.prepare('UPDATE users SET arcade_boost=?, arcade_boost_until=? WHERE id=?').run(boost, until, me.id);
        notify(me.id, '🚀', 'Rocket Run: cashed out at ' + at.toFixed(2) + '× — a ' + boost.toFixed(2) + '× Send Power boost for the next 24h.', 'points');
        // mult is the WHOLE multiplier stack after this cash-out, so the nav badge can repaint without a reload
        return send(res, 200, { busted: false, cashedX: Math.round(at * 100) / 100, crashX: Math.round(round.crash_x * 100) / 100, boost, until, mult: effectiveMult(me.id) });
      }
      /* ----- weekly community competition: who gained the most community XP this week ----- */
      if (p === '/api/communities/weekly' && req.method === 'GET') {
        const w = weekWindow();
        const rows = db.prepare("SELECT * FROM communities WHERE status='live' AND week_key = ? AND xp_week > 0 ORDER BY xp_week DESC, member_count DESC, id ASC LIMIT 20").all(w.key);
        return send(res, 200, {
          week: w,
          serverNow: now(),   // so the client's countdown can't be thrown off by a skewed device clock
          board: rows.map((c, i) => ({ ...communityCardView(c, me), rank: i + 1, xpWeek: c.xp_week })),
        });
      }
      // token → community tag (single or batch), for the tag shown on every token card / detail popup
      if (p === '/api/communities/lookup' && req.method === 'GET') {
        const token = String(url.searchParams.get('token') || '').toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(token)) return bad(res, 'bad token address');
        return send(res, 200, { community: communityForToken(token) });
      }
      if (p === '/api/communities/lookup' && req.method === 'POST') {
        if (!rateLimit('clookup:' + clientIp(req), 120, 6e4)) return bad(res, 'slow down', 429);
        const b = await readBody(req);
        const list = Array.isArray(b.tokens) ? [...new Set(b.tokens.map(t => String(t || '').toLowerCase()).filter(t => /^0x[0-9a-f]{40}$/.test(t)))].slice(0, 200) : [];
        const map = {}; for (const t of list) { const c = communityForToken(t); if (c) map[t] = c; }
        return send(res, 200, { map });
      }
      if (p === '/api/communities' && req.method === 'GET') {
        const uname = String(url.searchParams.get('user') || '').trim();
        if (uname) { // a user's qualified memberships (for their "Convicted In" section)
          const u = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(uname);
          if (!u) return send(res, 200, { communities: [] });
          const rows = db.prepare('SELECT c.id, c.token_addr, c.symbol, c.name, c.brand, c.status, cm.conviction_xp FROM community_members cm JOIN communities c ON c.id = cm.community_id WHERE cm.user_id = ? AND cm.qualified = 1 ORDER BY cm.conviction_xp DESC').all(u.id);
          return send(res, 200, { communities: rows.map(c => ({ id: c.id, token: c.token_addr, symbol: c.symbol, name: c.name, status: c.status, convictionLevel: levelForXp(c.conviction_xp), convictionTitle: convictionTitleFor(levelForXp(c.conviction_xp)) })) });
        }
        maybeRefreshCommunities();
        const status = url.searchParams.get('status') === 'pending' ? 'pending' : 'live';
        const sort = url.searchParams.get('sort') || 'active';
        let rows = db.prepare('SELECT * FROM communities WHERE status=?').all(status);
        if (sort === 'members') rows.sort((a, b) => (b.qual_count - a.qual_count) || (b.member_count - a.member_count)); // rank by the anti-sybil-vetted count, not the raw one
        else if (sort === 'mcap') rows.sort((a, b) => (b.c_mc || 0) - (a.c_mc || 0));
        else if (sort === 'new') rows.sort((a, b) => b.created_at - a.created_at);
        else rows.sort((a, b) => decayedActivity(b) - decayedActivity(a)); // 'active' = most-active first (default)
        rows.sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0)); // stable: the house communities stay on top of any sort
        const officials = db.prepare('SELECT * FROM communities WHERE official = 1 ORDER BY id').all().map(c => communityCardView(c, me)); // always returned, whatever tab/sort
        return send(res, 200, { status, sort, officials, communities: rows.slice(0, 120).map(c => communityCardView(c, me)) });
      }
      /* ----- snapshot-scoped: /api/communities/:cid/snapshots/:sid ----- */
      {
        const sm = /^\/api\/communities\/(\d+)\/snapshots\/(\d+)$/.exec(p);
        if (sm) {
          if (req.method !== 'GET') return bad(res, 'method not allowed', 405);
          const cid = Number(sm[1]), sid = Number(sm[2]);
          const s = db.prepare('SELECT * FROM holder_snapshots WHERE id=? AND community_id=?').get(sid, cid);
          if (!s) return bad(res, 'snapshot not found', 404);
          const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
          const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
          // A finished snapshot never changes, so it is safe to cache hard — this is what makes an old
          // snapshot open instantly instead of unzipping on every view.
          const headers = s.finished_at ? { 'Cache-Control': 'private, max-age=86400' } : {};
          return send(res, 200, { snapshot: snapshotView(s, true, offset, limit) }, headers);
        }
      }
      /* ----- proposal-scoped: /api/communities/:cid/proposals/:pid[/vote|/open] -----
         Placed BEFORE the /:cid(/join|posts|members|proposals) matcher because that regex ends in $
         and can never match a second path segment. Has its own 405 tail — do not share m's. */
      {
        const pm = /^\/api\/communities\/(\d+)\/proposals\/(\d+)(?:\/(vote|open))?$/.exec(p);
        if (pm) {
          const cid = Number(pm[1]), pid = Number(pm[2]), act = pm[3];
          const c = db.prepare('SELECT * FROM communities WHERE id=?').get(cid);
          if (!c) return bad(res, 'community not found', 404);
          resolveDueProposals(cid);
          const pr = db.prepare('SELECT * FROM proposals WHERE id=? AND community_id=?').get(pid, cid);
          if (!pr) return bad(res, 'proposal not found', 404);
          // a draft is author-visible only, and 404s for everyone else so its existence stays private
          if (pr.status === 'draft' && (!me || me.id !== pr.author_id)) return bad(res, 'proposal not found', 404);
          const cmRow = me ? db.prepare('SELECT qualified, joined_at FROM community_members WHERE community_id=? AND user_id=?').get(cid, me.id) : null;

          if (!act && req.method === 'GET') return send(res, 200, { proposal: proposalView(pr, me, c, cmRow) });

          if (!act && req.method === 'DELETE') {          // only an unopened draft can be withdrawn
            if (!me || me.id !== pr.author_id) return bad(res, 'not your proposal', 403);
            if (pr.status !== 'draft') return bad(res, 'a proposal that has opened for voting can never be withdrawn', 409);
            db.prepare('DELETE FROM proposals WHERE id=?').run(pid);
            return send(res, 200, { ok: true });
          }
          if (act === 'open' && req.method === 'POST') {  // opening freezes the electorate, so it is a deliberate act
            if (!me) return bad(res, 'sign in first', 401);
            if (blockReadOnly(res, me)) return;
            if (me.id !== pr.author_id) return bad(res, 'not your proposal', 403);
            if (pr.status !== 'draft') return bad(res, 'already open', 409);
            if (!cmRow || !cmRow.qualified) return bad(res, 'you must be a verified holder of $' + c.symbol + ' to open a vote', 403);
            const t0 = now();
            db.prepare(`UPDATE proposals SET status='open', opened_at=?, r1_ends_at=?, deadline=?,
                        electorate=?, quorum_r1=?, quorum_r2=? WHERE id=?`)
              .run(t0, t0 + PROP_R1_MS, t0 + PROP_R1_MS, c.qual_count,
                   quorumFor(c.qual_count, PROP_QUORUM_R1), quorumFor(c.qual_count, PROP_QUORUM_R2), pid);
            bumpActivity(cid, W_prop);
            // tell the roll a vote has opened — capped, and only people who can actually vote
            const voters = db.prepare('SELECT user_id FROM community_members WHERE community_id=? AND qualified=1 AND user_id<>? LIMIT ?').all(cid, me.id, PROP_NOTIFY_CAP);
            for (const v of voters) notify(v.user_id, '\uD83D\uDDF3\uFE0F', 'New ' + (c.demo ? 'sandbox' : '$' + c.symbol) + ' proposal open for your vote: ' + pr.title, 'community');
            const fresh = db.prepare('SELECT * FROM proposals WHERE id=?').get(pid);
            return send(res, 200, { proposal: proposalView(fresh, me, c, cmRow) });
          }
          if (act === 'vote' && req.method === 'POST') {
            if (!me) return bad(res, 'sign in first', 401);
            if (blockReadOnly(res, me)) return;
            if (!rateLimit('propvote:' + me.id, 30, 6e5)) return bad(res, 'slow down', 429);
            const why = voteGateReason(me, c, pr, cmRow);
            if (why) return bad(res, why, 403);
            const b = await readBody(req);
            const choice = String(b.choice || '');
            if (choice !== 'yes' && choice !== 'no' && choice !== 'abstain') return bad(res, 'choose yes, no or abstain');
            const round = pr.status === 'round2' ? 2 : 1;
            try {
              db.prepare('INSERT INTO proposal_votes (proposal_id, round, user_id, choice, created_at, vote_ip) VALUES (?,?,?,?,?,?)')
                .run(pid, round, me.id, choice, now(), bidx(clientIp(req)));
            } catch { return bad(res, 'you have already voted in this round', 409); } // PK collision = double vote
            awardCommunityXp(cid, me.id, 'wall_react_get', COMM_XP.wall_react_get, 'c' + cid + ':prop_vote:' + pid + ':' + round + ':' + me.id);
            awardConviction(cid, me.id, 'wall_react_give', CONV_XP.wall_react_give, 'v' + cid + ':prop_vote:' + pid + ':' + round + ':' + me.id);
            const fresh = db.prepare('SELECT * FROM proposals WHERE id=?').get(pid);
            return send(res, 200, { proposal: proposalView(fresh, me, c, cmRow) });
          }
          return bad(res, 'method not allowed', 405);
        }
      }
      {
        const m = /^\/api\/communities\/(\d+)(?:\/(join|posts|members|proposals|snapshots))?$/.exec(p);
        if (m) {
          const cid = Number(m[1]), sub = m[2];
          const c = db.prepare('SELECT * FROM communities WHERE id=?').get(cid);
          if (!c) return bad(res, 'community not found', 404);
          if (!sub && req.method === 'GET') return send(res, 200, { community: communityDetailView(c, me, clientIp(req)) });
          // PUBLIC: the full member roster, ranked by each member's community level (conviction earned by participating).
          if (sub === 'members' && req.method === 'GET') {
            const rows = db.prepare(`SELECT cm.user_id, cm.conviction_xp, cm.qualified, cm.joined_at, u.username, u.avatar, u.avatar_img, u.og, u.og_tier, u.accent
              FROM community_members cm JOIN users u ON u.id = cm.user_id
              WHERE cm.community_id = ? ORDER BY cm.conviction_xp DESC, cm.joined_at ASC LIMIT 200`).all(cid);
            const members = rows.map(r => {
              const lvl = levelForXp(r.conviction_xp);
              return { username: r.username, avatar: r.avatar, avatar_img: r.avatar_img ? '/uploads/' + r.avatar_img : null, og: r.og_tier || 0, accent: r.accent || '',
                level: lvl, title: convictionTitleFor(lvl), xp: r.conviction_xp, qualified: !!r.qualified, isCreator: r.user_id === c.creator_id };
            });
            return send(res, 200, { members, memberCount: c.member_count, qualCount: c.qual_count, status: c.status });
          }
          if (sub === 'join' && req.method === 'POST') {
            if (!me) return bad(res, 'sign in first', 401);
            if (blockReadOnly(res, me)) return;
            probationTick(me.id);
            if (!rateLimit('commjoin:' + me.id, 30, 6e5)) return bad(res, 'slow down', 429);
            let holds;
            if (c.demo) holds = true;   // the open sandbox: no token, no wallet, no chain call — anyone may walk in
            else {
              try { holds = await holdsToken(me.id, c.token_addr, MIN_COMMUNITY_HOLD_USD, c.c_price); } catch { return bad(res, RPC_DOWN_MSG, 503); } // only real, on-chain-verified holders of THIS token can opt in — at least $25 of it
              if (!holds) return bad(res, 'You must hold $' + c.symbol + ' to join this community — connect a wallet that holds it.', 403);
            }
            const j = joinCommunity(me, cid, clientIp(req), holds);
            if (j.error) return bad(res, j.error === 'not found' ? 'community not found' : 'could not join', j.error === 'not found' ? 404 : 500);
            if (j.alreadyMember) return send(res, 200, { joined: true, alreadyMember: true, qualified: j.qualified !== false, reason: j.reason || null, community: communityDetailView(c, me, clientIp(req)) }); // a member who holds but can't re-qualify gets the honest reason, not "Opted in!"
            return send(res, 200, { ...j, community: communityDetailView(db.prepare('SELECT * FROM communities WHERE id=?').get(cid), me, clientIp(req)) });
          }
          if (sub === 'join' && req.method === 'DELETE') { // leave — never un-goes-live, never claws back the founder bonus
            if (!me) return bad(res, 'sign in first', 401);
            if (!rateLimit('commjoin:' + me.id, 30, 6e5)) return bad(res, 'slow down', 429); // shares the join budget so join↔leave can't be looped
            const row = db.prepare('SELECT qualified FROM community_members WHERE community_id=? AND user_id=?').get(cid, me.id);
            if (!row) return send(res, 200, { left: true, noop: true, community: communityDetailView(c, me, clientIp(req)) });
            try {
              db.exec('BEGIN');
              db.prepare('DELETE FROM community_members WHERE community_id=? AND user_id=?').run(cid, me.id);
              db.prepare('UPDATE communities SET member_count = MAX(member_count-1,0)' + (row.qualified ? ', qual_count = MAX(qual_count-1,0)' : '') + ' WHERE id=?').run(cid);
              if (row.qualified && c.status === 'live' && !c.demo) db.prepare('UPDATE users SET live_comm_count = MAX(live_comm_count-1,0) WHERE id=?').run(me.id);
              db.exec('COMMIT');
            } catch { try { db.exec('ROLLBACK'); } catch {} return bad(res, 'could not leave', 500); }
            return send(res, 200, { left: true, community: communityDetailView(db.prepare('SELECT * FROM communities WHERE id=?').get(cid), me, clientIp(req)) });
          }
          if (sub === 'posts' && req.method === 'GET') {
            const beforeId = url.searchParams.get('before');
            const canHolders = canReadPrivateWall(me && me.id, cid);
            const holders = url.searchParams.get('wall') === 'holders';
            // the private feed is refused outright, not filtered — a non-holder never receives one of these rows
            if (holders && c.demo) return bad(res, 'the sandbox has no token, so it has no holders-only wall — everything here is public', 400);
            if (holders && !canHolders) return bad(res, 'the holders-only wall is for verified holders of $' + c.symbol + ' — opt in with the token in a linked wallet to read it', 403);
            const before = beforeId ? Number(beforeId) : Number.MAX_SAFE_INTEGER, priv = holders ? 1 : 0;
            const rows = me
              ? db.prepare('SELECT * FROM posts WHERE community_id = ? AND private = ? AND id < ? AND user_id NOT IN (SELECT muted_id FROM mutes WHERE user_id = ?) ORDER BY id DESC LIMIT 30').all(cid, priv, before, me.id)
              : db.prepare('SELECT * FROM posts WHERE community_id = ? AND private = ? AND id < ? ORDER BY id DESC LIMIT 30').all(cid, priv, before);
            return send(res, 200, { posts: postsView(rows, me), status: c.status, wall: holders ? 'holders' : 'public', canReadHolders: canHolders, hasPrivateWall: !c.demo });
          }
          if (sub === 'posts' && req.method === 'POST') {
            if (!me) return bad(res, 'sign in first', 401);
            if (blockReadOnly(res, me)) return;
            if (c.status !== 'live') return bad(res, 'this community isn’t live yet — it needs ' + LIVE_THRESHOLD + ' members', 403);
            // posting needs a VERIFIED slot (qualified=1), not just a membership row — the anti-sybil caps must gate the wall too, exactly as the opt-in copy promises
            if (!db.prepare('SELECT 1 FROM community_members WHERE community_id=? AND user_id=? AND qualified=1').get(cid, me.id)) return bad(res, 'posting needs a verified holder slot — opt in (and re-verify if your slot was paused) to post on this wall', 403);
            if (!c.demo) {   // the sandbox has no token to hold, so the holding gate does not apply there
              let holdsP; try { holdsP = await holdsToken(me.id, c.token_addr, MIN_COMMUNITY_HOLD_USD, c.c_price); } catch { return bad(res, RPC_DOWN_MSG, 503); }
              if (!holdsP) return bad(res, 'You need to hold $' + c.symbol + ' to post on its community wall.', 403);
            }
            if (!rateLimit('commpost:' + me.id, 12, 6e5)) return bad(res, 'slow down', 429);
            const bigUpload = Number(req.headers['content-length'] || 0) > MEDIA_GATE_BYTES;
            if (bigUpload && mediaInFlight >= MEDIA_CONCURRENCY) return bad(res, 'lots of uploads right now — try again in a moment', 503);
            let b, image = null;
            if (bigUpload) mediaInFlight++;
            try { b = await readBody(req, 12 * 1024 * 1024); if (b.image) image = resolvePostMedia(b.image, me.id); }
            catch (e) { return bad(res, e.message || 'bad media', (e && e.status) || 400); }
            finally { if (bigUpload) mediaInFlight--; }
            const rt = await resolveTokensInText(String(b.text || '').trim().slice(0, 500));
            const text = rt.text;
            if (!text && !image) return bad(res, 'write something or attach a photo, GIF or video');
            // the holders-only wall needs exactly what posting already needs (a verified slot + a live holding, both
            // checked above), so no extra gate — only the flag
            const isPrivate = (!c.demo && (b.private === true || b.private === 1 || b.private === '1')) ? 1 : 0; // the sandbox has no holders-only wall to post to
            const info = db.prepare('INSERT INTO posts (user_id, text, image, score, created_at, community_id, tokens, private) VALUES (?,?,?,?,?,?,?,?)').run(me.id, text, image, 0, now(), cid, rt.tokens, isPrivate);
            const earned = awardPoints(me.id, 'post', PTS.post, 'post:' + info.lastInsertRowid); // gets the community 10× via commMult
            awardCommunityXp(cid, me.id, 'wall_post', COMM_XP.wall_post, 'c' + cid + ':wall_post:' + info.lastInsertRowid);
            awardConviction(cid, me.id, 'wall_post', CONV_XP.wall_post, 'v' + cid + ':wall_post:' + info.lastInsertRowid);
            bumpActivity(cid, W_post); scanWriteAction(me.id, 'post', text);
            const row = db.prepare('SELECT * FROM posts WHERE id=?').get(info.lastInsertRowid);
            return send(res, 200, { post: postView(row, me), pointsEarned: earned });
          }
          if (sub === 'proposals' && req.method === 'GET') {
            resolveDueProposals(cid);
            // one membership lookup for the whole page, not one per proposal
            const cmRow = me ? db.prepare('SELECT qualified, joined_at FROM community_members WHERE community_id=? AND user_id=?').get(cid, me.id) : null;
            const rows = db.prepare(`SELECT * FROM proposals WHERE community_id=? AND (status <> 'draft' OR author_id = ?)
                                     ORDER BY (status IN ('open','round2')) DESC, id DESC LIMIT 40`).all(cid, me ? me.id : -1);
            return send(res, 200, { proposals: rows.map(r => proposalView(r, me, c, cmRow)) });
          }
          if (sub === 'proposals' && req.method === 'POST') {
            if (!me) return bad(res, 'sign in first', 401);
            if (blockReadOnly(res, me)) return;
            if (c.status !== 'live') return bad(res, 'this community is not live yet', 403);
            const cmRow = db.prepare('SELECT qualified, joined_at FROM community_members WHERE community_id=? AND user_id=?').get(cid, me.id);
            if (!cmRow || !cmRow.qualified) return bad(res, 'only verified holders of $' + c.symbol + ' can start a proposal', 403);
            if (!rateLimit('propnew:' + me.id, 5, 864e5)) return bad(res, 'slow down', 429);
            const mineOpen = db.prepare("SELECT COUNT(*) n FROM proposals WHERE community_id=? AND author_id=? AND resolved_at IS NULL").get(cid, me.id).n;
            if (mineOpen >= PROP_OPEN_PER_USER) return bad(res, 'you already have a proposal running here — finish it first', 429);
            const commOpen = db.prepare("SELECT COUNT(*) n FROM proposals WHERE community_id=? AND status IN ('open','round2')").get(cid).n;
            if (commOpen >= PROP_OPEN_PER_COMM) return bad(res, 'this community already has ' + PROP_OPEN_PER_COMM + ' votes running — wait for one to close', 429);
            const b = await readBody(req);
            const title = String(b.title || '').trim().slice(0, PROP_TITLE_MAX);
            if (title.length < 4) return bad(res, 'give your proposal a title of at least 4 characters');
            const rt = await resolveTokensInText(String(b.body || '').trim().slice(0, PROP_BODY_MAX));
            const info = db.prepare('INSERT INTO proposals (community_id, author_id, title, body, tokens, status, deadline, created_at, author_ip) VALUES (?,?,?,?,?,?,?,?,?)')
              .run(cid, me.id, title, rt.text, rt.tokens, 'draft', now() + PROP_DRAFT_TTL, now(), bidx(clientIp(req)));
            scanWriteAction(me.id, 'post', title);
            const fresh = db.prepare('SELECT * FROM proposals WHERE id=?').get(Number(info.lastInsertRowid));
            return send(res, 200, { proposal: proposalView(fresh, me, c, cmRow) });
          }
          if (sub === 'snapshots' && req.method === 'GET') {
            const rows = db.prepare('SELECT * FROM holder_snapshots WHERE community_id=? ORDER BY id DESC LIMIT 40').all(cid);
            return send(res, 200, { snapshots: rows.map(s => snapshotView(s, false)), sandbox: !!c.demo });   // newest first; the sandbox has no token, so its page hides the feature
          }
          if (sub === 'snapshots' && req.method === 'POST') {
            if (!me) return bad(res, 'sign in first', 401);
            if (blockReadOnly(res, me)) return;
            if (c.status !== 'live') return bad(res, 'this community is not live yet', 403);
            if (c.demo) return bad(res, 'the sandbox has no token, so there is nothing to snapshot', 400); // a walk of a synthetic address would end in a stored record blaming the explorer
            const cmS = db.prepare('SELECT qualified FROM community_members WHERE community_id=? AND user_id=?').get(cid, me.id);
            if (!cmS || !cmS.qualified) return bad(res, 'only verified members of this community can take a snapshot', 403);
            if (snapRunning.has(cid)) return bad(res, 'a snapshot is already running for this community', 409);
            // A snapshot is hundreds of calls to a shared public explorer, so it is throttled per
            // community rather than per user — otherwise ten members could each start one.
            const last = db.prepare('SELECT started_at FROM holder_snapshots WHERE community_id=? ORDER BY id DESC LIMIT 1').get(cid);
            if (last && now() - last.started_at < SNAP_MIN_INTERVAL) {
              return bad(res, 'a snapshot was taken recently — you can take another in ' + Math.ceil((SNAP_MIN_INTERVAL - (now() - last.started_at)) / 60000) + ' minutes', 429);
            }
            const info = db.prepare("INSERT INTO holder_snapshots (community_id, token_addr, requested_by, status, started_at) VALUES (?,?,?,'running',?)")
              .run(cid, c.token_addr, me.id, now());
            const snapId = Number(info.lastInsertRowid);
            snapRunning.add(cid);
            runSnapshot(snapId, cid, c.token_addr).catch(() => { snapRunning.delete(cid); });   // walks in the background
            const s = db.prepare('SELECT * FROM holder_snapshots WHERE id=?').get(snapId);
            return send(res, 202, { snapshot: snapshotView(s, false) });
          }
          return bad(res, 'method not allowed', 405);
        }
      }

      /* ----- notifications (header bell dropdown) ----- */
      if (p === '/api/notifications' && req.method === 'GET') {
        if (!me) return bad(res, 'sign in first', 401);
        return send(res, 200, { items: db.prepare('SELECT id, kind, icon, text, created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(me.id) });
      }
      if (p === '/api/notifications' && req.method === 'DELETE') { // clear all
        if (!me) return bad(res, 'sign in first', 401);
        db.prepare('DELETE FROM notifications WHERE user_id=?').run(me.id);
        return send(res, 200, { ok: true });
      }
      if (/^\/api\/notifications\/\d+$/.test(p) && req.method === 'DELETE') { // clear one
        if (!me) return bad(res, 'sign in first', 401);
        db.prepare('DELETE FROM notifications WHERE user_id=? AND id=?').run(me.id, Number(p.split('/').pop()));
        return send(res, 200, { ok: true });
      }

      /* ----- connected-wallet balances for the nav (PRIVATE, read-only, cached) ----- */
      if (p === '/api/wallet/balances' && req.method === 'GET') {
        if (!me) return bad(res, 'sign in first', 401);
        if (!rateLimit('bal:' + me.id, 30, 6e4)) return bad(res, 'slow down', 429);
        const addrs = walletAddresses(me.id).slice(0, MAX_LINKED_WALLETS);
        if (!addrs.length) return send(res, 200, { wallets: 0, send: 0, gwc: 0, eth: 0 });
        const c = balCache.get(me.id);
        if (c && now() - c.t < 60000) return send(res, 200, c.v);
        try {
          let sendWei = 0n, gwcWei = 0n, ethWei = 0n;
          for (const a of addrs) {
            sendWei += await erc20Balance(TOK.SEND, a);
            gwcWei += await erc20Balance(TOK.GWC, a);
            ethWei += BigInt(await rpc('eth_getBalance', [a, 'latest']) || '0x0');
          }
          const v = { wallets: addrs.length, send: Number(sendWei) / 1e18, gwc: Number(gwcWei) / 1e18, eth: Number(ethWei) / 1e18 };
          balCache.set(me.id, { t: now(), v });
          return send(res, 200, v);
        } catch (e) { return bad(res, 'could not read balances right now', 502); }
      }

      /* ----- tracked wallets (PRIVATE) ----- */
      if (p === '/api/wallets' && req.method === 'GET') {
        if (!me) return bad(res, 'sign in first', 401);
        const h = db.prepare('SELECT * FROM holder_state WHERE user_id = ?').get(me.id);
        // Gate diamondLevel/holdsGwc on the SAME freshness rule trackLimit() uses, so the tier the UI shows can
        // never contradict the limit (a stale holder would otherwise get limit:10 but diamondLevel:>=1 → a
        // nonsensical "Diamond unlocked 10 slots" display). Stale → present as free tier until re-verified on-chain.
        const holderFresh = !!(h && h.last_check && now() - h.last_check <= HOLDER_TTL);
        const activeHolder = !!(h && h.gwc_tok > 0 && holderFresh);
        const dLvl = (activeHolder && h.streak_start) ? diamondInfo(effHoldDays(h)).level : 0;
        return send(res, 200, {
          wallets: db.prepare('SELECT id, address_enc, label FROM tracked_wallets WHERE user_id = ? ORDER BY id').all(me.id).map(w => ({ id: w.id, address: decField(w.address_enc), label: w.label })).filter(w => w.address),
          limit: trackLimit(me.id), base: TRACK_BASE, diamondLevel: dLvl, holdsGwc: activeHolder,
        });
      }
      if (p === '/api/wallets' && req.method === 'POST') {
        if (!me) return bad(res, 'sign in first', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('wallet:' + me.id, 20, 6e5)) return bad(res, 'slow down', 429);
        const b = await readBody(req);
        const address = String(b.address || '').toLowerCase().trim();
        if (!/^0x[0-9a-f]{40}$/.test(address)) return bad(res, 'that does not look like an EVM address');
        const count = db.prepare('SELECT COUNT(*) n FROM tracked_wallets WHERE user_id = ?').get(me.id).n;
        const limit = trackLimit(me.id);
        if (count >= limit) return bad(res, `you can track up to ${limit} wallets right now — hold $GWC and diamond-hand it to unlock more`);
        try {
          const r = db.prepare('INSERT INTO tracked_wallets (user_id, address, address_enc, label, created_at) VALUES (?,?,?,?,?)').run(me.id, bidx(address), encField(address), String(b.label || '').slice(0, 40), now());
          const tEarned = awardPoints(me.id, 'track_wallet', PTS.track_wallet, 'track:' + me.id + ':' + address); // once per address ever
          scanWriteAction(me.id, 'track');
          return send(res, 200, { wallet: { id: Number(r.lastInsertRowid), address, label: String(b.label || '').slice(0, 40) }, pointsEarned: tEarned });
        } catch { return bad(res, 'you are already tracking that wallet'); }
      }
      m = /^\/api\/wallets\/(\d+)$/.exec(p);
      if (m && (req.method === 'PATCH' || req.method === 'DELETE')) {
        if (!me) return bad(res, 'sign in first', 401);
        const row = db.prepare('SELECT * FROM tracked_wallets WHERE id = ? AND user_id = ?').get(Number(m[1]), me.id);
        if (!row) return bad(res, 'not found', 404);
        if (req.method === 'DELETE') { db.prepare('DELETE FROM tracked_wallets WHERE id = ?').run(row.id); db.prepare('DELETE FROM tracker_cache WHERE user_id = ? AND addr_idx = ?').run(me.id, row.address); return send(res, 200, { ok: true }); } // the cached report goes with it
        const b = await readBody(req);
        db.prepare('UPDATE tracked_wallets SET label = ? WHERE id = ?').run(String(b.label || '').slice(0, 40), row.id);
        return send(res, 200, { ok: true });
      }

      return bad(res, 'unknown endpoint', 404);
    }

    if (p.startsWith('/uploads/')) {
      const f = path.normalize(p.replace('/uploads/', ''));
      if (f.includes('..') || f.includes('/') || f.endsWith('.part')) return bad(res, 'nope', 400); // never serve in-progress temp uploads
      // uploaded media is content-addressed by a random name → its bytes never change → cache it forever (immutable, no revalidation)
      return serveFile(req, res, path.join(UPLOAD_DIR, f), { 'Cache-Control': 'public, max-age=31536000, immutable' });
    }
    let rel = p === '/' ? '/index.html' : p;
    if (/^\/u\/[^/]+$/.test(rel)) rel = '/u.html';
    const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) return bad(res, 'nope', 400);
    return serveFile(req, res, filePath);
  } catch (e) {
    if (res.headersSent) { try { res.destroy(); } catch {} return; } // response already streaming → can't send an error body
    if (e instanceof HttpError) return bad(res, e.message, e.status);
    console.error(e);
    return bad(res, 'server error', 500); // don't leak internal detail to clients
  }
});

// --- crash-resistance under load: a single bad request or stray async error must never take the whole server down ---
process.on('uncaughtException', (e) => { console.error('uncaughtException (kept alive):', e && e.stack || e); });
process.on('unhandledRejection', (e) => { console.error('unhandledRejection (kept alive):', e && e.stack || e); });
server.on('clientError', (err, socket) => { try { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {} }); // malformed HTTP → 400, no crash
server.keepAliveTimeout = 65000;   // keep sockets warm a bit longer than a typical LB (60s) so we don't 502 on reuse
server.headersTimeout = 66000;     // must exceed keepAliveTimeout (slowloris protection on the header phase)
server.requestTimeout = 60000;     // hard cap on any single request
server.maxRequestsPerSocket = 0;   // unlimited keep-alive requests per connection (0 = no cap)

// Fold the WAL back into the main DB periodically so it stays small (fast reads, bounded disk) even under
// sustained writes; PASSIVE never blocks writers. On shutdown we do a TRUNCATE checkpoint for a clean file.
const walTimer = setInterval(() => {
  try { db.exec('PRAGMA wal_checkpoint(PASSIVE); PRAGMA optimize;'); } catch {}
  // sweep stale rate-limit buckets so the map can't grow unbounded with one entry per IP/user over time
  const cutoff = now() - 3600000; // older than the longest rate-limit window (1h)
  for (const [k, b] of buckets) if (b.t < cutoff) buckets.delete(k);
  presenceSweep();
}, 5 * 60 * 1000);
walTimer.unref();

// Daily on-disk snapshot of the DB via node:sqlite's online backup API — consistent, and it yields to the event loop
// between 256-page steps so requests never stall. One file per UTC day in data/backups (or BACKUP_DIR), last 7 kept,
// written to .part and renamed so a crash can't leave a half-written snapshot. RESTORE: stop the server, copy the
// snapshot over data/app.db, delete any app.db-wal / app.db-shm beside it, start. data/uploads still needs its own copy.
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const BACKUP_KEEP = 7;
async function snapshotDb() {
  if (typeof sqliteBackup !== 'function') return;
  try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
  const f = path.join(BACKUP_DIR, 'app-' + new Date().toISOString().slice(0, 10) + '.db');
  const tmp = f + '.part';
  try { for (const n of fs.readdirSync(BACKUP_DIR)) if (n.endsWith('.db.part') && path.join(BACKUP_DIR, n) !== tmp) fs.unlinkSync(path.join(BACKUP_DIR, n)); } catch {} // a .part orphaned by a hard kill on an earlier day
  if (fs.existsSync(f)) return; // today's snapshot already exists
  try {
    await sqliteBackup(db, tmp, { rate: 256 });
    fs.renameSync(tmp, f);
    const old = fs.readdirSync(BACKUP_DIR).filter(n => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort().slice(0, -BACKUP_KEEP);
    for (const n of old) { try { fs.unlinkSync(path.join(BACKUP_DIR, n)); } catch {} }
  } catch (e) { try { fs.unlinkSync(tmp); } catch {} console.error('db snapshot failed:', e && e.message); }
}
const backupTimer = setInterval(() => { snapshotDb().catch(() => {}); }, 60 * 60 * 1000);
backupTimer.unref();
setTimeout(() => { snapshotDb().catch(() => {}); }, 15000).unref(); // first snapshot shortly after boot

// Refresh Send Calls on a reliable cadence (not just on page views) so the diamond-hands hold integral accrues
// steadily over real time. refreshCalls() returns immediately when there are no calls, so this is idle-cheap.
const callsTimer = setInterval(() => { refreshCalls().catch(() => {}); }, 5 * 60 * 1000);
callsTimer.unref();

// Keep the token-detail cache fresh from on-chain data: every ~60s re-fetch the most-recently-viewed cached tokens
// (bounded batch + concurrency; radar tokens are skipped since the pairs refresher already updates them). Idle-cheap —
// does nothing when no one has viewed a token recently, and prunes cold rows.
const tokenCacheTimer = setInterval(() => { refreshTokenCache().catch(() => {}); }, 60 * 1000);
tokenCacheTimer.unref();

// Probation sweep: re-read on-chain holdings for users who bought $SEND to lift a restriction, so a sell is
// caught (read-only returns doubled) even if they never re-open the site. refreshHolder() calls checkProbation().
// Bounded — only users currently mid-probation are read; the token cost is negligible when nobody is redeeming.
let probationSweeping = false; // a slow tick (RPC stalls) must never overlap the next one
const probationTimer = setInterval(async () => {
  if (probationSweeping) return; probationSweeping = true;
  try {
    const rows = db.prepare('SELECT id FROM users WHERE redeem_hold_until > 0').all();
    for (const r of rows) {
      try {
        const h = await refreshHolder(r.id); // calls checkProbation() when a wallet is readable
        if (h && h.hasWallet === false) checkProbation(r.id, 0); // no readable wallet during probation → can't prove the hold → treat as sold
      } catch {}
    }
  } catch {} finally { probationSweeping = false; }
}, 5 * 60 * 1000);
probationTimer.unref();

/* OG freshness sweep: re-read on-chain holdings for tiered users (stalest first) so a full sell-out is
   caught — badge and multiplier removed — even if they never re-open the site, and so active OGs stay
   "fresh" enough to keep the bonus. refreshHolder() revokes on a confirmed full sell-out.

   CAPACITY, because this is a real ceiling and not a tuning knob: effectiveMult() only pays the bonus
   while holder_state.last_check is inside HOLDER_TTL (26h). At CAP per tick every 10 minutes the sweep
   refreshes CAP × 144 accounts/day, so it can keep about CAP × 144 × (26/24) accounts inside that
   window. At 25 that was ~3,900 — fine for one gold cohort, but silver and bronze are exactly the
   tiers that grow the population past it, and past it a tiered user who does not visit silently drops
   to 1× with nothing in the UI to explain why. 60 lifts the ceiling to ~9,360. Each refresh costs up
   to MAX_LINKED_WALLETS × 2 eth_calls, so 60/tick is ~8,640 refreshes/day ≈ 1 RPC/sec sustained.
   Beyond that ceiling the honest answer is a worker/queue, not a bigger number here. */
const OG_SWEEP_CAP = 60;
let ogSweeping = false;
const ogTimer = setInterval(async () => {
  if (ogSweeping) return; ogSweeping = true;
  try {
    const rows = db.prepare('SELECT u.id FROM users u LEFT JOIN holder_state h ON h.user_id = u.id WHERE u.og_tier > 0 ORDER BY COALESCE(h.last_check, 0) ASC LIMIT ?').all(OG_SWEEP_CAP);
    for (const r of rows) { try { await refreshHolder(r.id); } catch {} }
  } catch {} finally { ogSweeping = false; }
}, 10 * 60 * 1000);
ogTimer.unref();

/* Campaign sweep — this is what "auto-run over the next year" actually means in code.
   The tier windows are pure functions of time, so nothing has to schedule them opening or closing.
   What does need a heartbeat is granting: a user who linked a wallet, qualified, and then never came
   back would otherwise wait for their next visit to be scanned. This walks wallet-holding, un-tiered,
   un-revoked accounts oldest-checked-first and runs the same checkOg() the site runs interactively.

   It stops itself. Once now() passes OG_CAMPAIGN_END_MS no tier can be granted, checkOg() returns 0
   immediately, and the sweep stops scheduling scans rather than burning explorer calls forever. The
   batch is small because each scan is up to MAX_LINKED_WALLETS × 2 explorer walks plus the same
   number of RPC reconciliation reads, and Blockscout rate-limits per IP across all its endpoints. */
const OG_GRANT_SWEEP_CAP = 3;
const OG_RESCAN_MS = 6 * 3600 * 1000;    // re-test a clean "did not qualify" this often (same as the interactive path)
const OG_RETRY_MS = 3600 * 1000;         // but retry a FAILED scan within the hour
let ogGrantSweeping = false;
const ogGrantTimer = setInterval(async () => {
  if (ogGrantSweeping) return;
  if (now() > OG_GRANT_UNTIL_MS) return;                  // windows closed and the grace is up — nothing left to verify
  ogGrantSweeping = true;
  try {
    // Ordered by og_try_at, not og_checked_at. A scan that fails writes no og_checked_at (by design —
    // a failed read is not an answer), so ordering by it put every permanently-failing account at the
    // head of the queue forever. og_try_at moves on every attempt, so failures rotate to the back and
    // the queue always drains. The two windows differ on purpose: a clean "did not qualify" is worth
    // re-testing every 6h, but a failure is worth retrying within the hour.
    const rows = db.prepare(`SELECT u.id FROM users u
      WHERE u.og_tier = 0 AND u.og_revoked = 0 AND u.system = 0
        AND u.og_checked_at < ? AND u.og_try_at < ?
        AND EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.type = 'wallet')
      ORDER BY u.og_try_at ASC LIMIT ?`).all(now() - OG_RESCAN_MS, now() - OG_RETRY_MS, OG_GRANT_SWEEP_CAP);
    for (const r of rows) { try { await checkOg(r.id); } catch {} }
  } catch {} finally { ogGrantSweeping = false; }
}, 15 * 60 * 1000);
ogGrantTimer.unref();

// Biggest Sender game master. Once a minute: settle any week that has ended, then make sure the current
// week has its open row. Cheap when nothing is due (one indexed SELECT), and it never depends on a visit.
try { ensureCompetitionRow(); } catch {}
const compTimer = setInterval(() => { try { settleCompetitions(); } catch {} }, 60 * 1000);
compTimer.unref();

// Re-verify qualified community members still hold the community's token; revoke the 10× on a sell / recycled-bag move.
const commHolderTimer = setInterval(() => { sweepCommunityHolders().catch(() => {}); }, 10 * 60 * 1000);
// Close proposals whose round has ended, even if nobody visits that community. Cheap: idx_prop_due
// is a PARTIAL index over rows that still have a deadline, so a settled proposal costs nothing.
const propTimer = setInterval(() => { try { resolveDueProposals(null); } catch {} }, 60 * 1000);
// one block-0 scan at a time, with a gap between them — the chain is shared with every other read on the site
const sniperTimer = setInterval(() => { runSniperQueue().catch(() => {}); }, 20 * 1000);
sniperTimer.unref();
/* Every token in the radar feed gets scanned eventually, but ONE at a time and slowly: a page render must
   never schedule a hundred chain scans, and a viewer who opens a token jumps the queue through the API. */
const sniperFeedTimer = setInterval(() => {
  try {
    if (sniperQueue.length) return;
    for (const e of (pairsCache.pairs || [])) {
      if (!e || !e.token || !e.pair || !e.pair.address) continue;
      const row = sniperRow(e.token.address);
      if (row && (row.status === 'done' || row.status === 'partial') && now() - (row.finished_at || 0) < SNIPE.TTL) continue;
      queueSniperScan(e.token.address, e.pair.address, e.pair.createdAt);
      if (sniperQueue.length) break;      // exactly one per tick
    }
  } catch {}
}, SNIPE.FEED_GAP_MS);
sniperFeedTimer.unref();
propTimer.unref();
commHolderTimer.unref();

// Reap upload-then-abandon media (never attached to a post) so they don't leak disk + quota.

/* ===== Telegram: the scanner, in anyone's chat ==========================================================
   The radar's whole value is reading a token BEFORE someone buys it, and the moment that decision gets made
   is usually in a Telegram group where a contract address just landed — not on a website someone remembers
   to open. So the same scan the New Pairs page runs is available as a bot that anyone can add to any group.

   It is the SAME scan: lookupTokenPair → the identical risk engine, the identical verdict rule, the identical
   refusal to guess. Nothing is softened for chat. In particular the bot inherits the two rules that matter:
   "Looks Good, Send It" needs a clean block-0 result, and an upstream we could not read is reported as
   unknown, never as a verdict about someone's token.

   Off unless TELEGRAM_BOT_TOKEN is set, exactly like the OAuth providers. Two ways to receive updates:
   a webhook when the site has a public https origin, long-polling otherwise (which is what works from a
   laptop with no domain — the state this project is in today). Both feed one handler.
   ======================================================================================================== */
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_ON = /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(TG_TOKEN);
// Telegram signs webhook deliveries with a header we choose. Derived from the bot token so an operator has
// nothing extra to configure, and never sent anywhere except back to us by Telegram.
const TG_SECRET = TG_ON ? crypto.createHash('sha256').update('tgwh:' + TG_TOKEN).digest('hex').slice(0, 32) : '';
const TG_PUBLIC = TG_ON && /^https:\/\//i.test(BASE_URL) && !/localhost|127\.0\.0\.1|yourdomain\.com/i.test(BASE_URL);
let tgMe = null;                  // { id, username } once getMe answers
let tgOffset = 0;                 // long-poll cursor
let tgPolling = false;
const TG_SCAN_CAP = 6;            // scans per chat per minute — a scan costs real upstream reads

async function tgApi(method, params, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.telegram.org/bot' + TG_TOKEN + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}), signal: ctrl.signal,
    });
    const j = await r.json();
    // never let the bot token reach a log line — it is the whole credential
    if (!j.ok) throw new Error(method + ': ' + (j.description || 'telegram refused'));
    return j.result;
  } finally { clearTimeout(to); }
}
const tgEsc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function tgSend(chatId, html, extra) {
  return tgApi('sendMessage', {
    chat_id: chatId, text: html, parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(extra || {}),
  }).catch((e) => { console.error('telegram send failed:', e.message); });
}

/* The verdict rule, server-side. It mirrors verdictOf() in public/newpairs.js deliberately — the two must
   agree, because the same token read in a group and on the site giving different answers would make both
   untrustworthy. If you change one, change the other. */
function scanVerdict(p) {
  const r = p.risk || {};
  const health = Math.round(r.health || 0);
  if (r.thinData) return { emoji: '🌫️', word: 'Not enough data yet', note: 'Too little is readable about this token to judge it. That is not a pass — it is an unknown.' };
  if (r.triage === 'ok' && health >= 100 && r.sniperOk !== true) {
    const st = r.snipers && r.snipers.status;
    return (st === 'done' || st === 'partial')
      ? { emoji: '🎯', word: 'Block-0 snipers sold', note: 'Everything else looks clean, but the wallets that bought in the very first block are net sellers.' }
      : { emoji: '🌫️', word: 'Checking block 0…', note: 'Everything else looks clean; the first-block check has not finished, so the top verdict is withheld.' };
  }
  if (r.triage === 'ok' && health >= 100 && r.sniperOk === true) return { emoji: '🚀', word: 'Looks Good, Send It', note: 'Nothing we can check tripped a flag. That is not a promise — most new tokens still go to zero.' };
  if (r.triage === 'ok') return { emoji: '🙂', word: 'Nothing obvious tripped', note: '' };
  if (r.triage === 'caution') return { emoji: '⚠️', word: 'Be careful', note: '' };
  if (r.triage === 'high') return { emoji: '🚨', word: 'High risk', note: '' };
  return { emoji: '☠️', word: 'Avoid', note: '' };
}

const tgUsd = (n) => n == null ? 'unknown' : (n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'k' : '$' + n.toFixed(2));
const tgAge = (m) => m == null ? 'unknown' : m < 60 ? Math.round(m) + 'm old' : m < 1440 ? Math.round(m / 60) + 'h old' : Math.round(m / 1440) + 'd old';

function tgScanMessage(p) {
  const r = p.risk || {}, v = scanVerdict(p);
  const sym = p.token.symbol ? '$' + p.token.symbol : 'this token';
  const L = [];
  L.push('<b>' + tgEsc(p.token.name || 'Unnamed token') + ' ' + tgEsc(sym) + '</b>');
  L.push(v.emoji + ' <b>' + tgEsc(v.word) + '</b> · health ' + Math.round(r.health || 0) + '/100');
  if (v.note) L.push('<i>' + tgEsc(v.note) + '</i>');
  L.push('');
  L.push('💰 Market cap: ' + tgEsc(tgUsd(p.market.marketCap)) + '   💧 Liquidity: ' + tgEsc(tgUsd(p.market.liquidityUsd)));
  L.push('👥 Holders: ' + (p.holders.count == null ? 'unknown' : p.holders.count) + '   🕐 ' + tgEsc(tgAge(p.pair.ageMinutes)));

  // every flag that actually tripped, in the site's own words
  const tripped = Object.keys(RISK).filter(k => r[k]);
  if (tripped.length) {
    L.push('');
    L.push('<b>What tripped:</b>');
    for (const k of tripped.slice(0, 8)) L.push('• ' + tgEsc(RISK[k].label));
  }

  /* What we could NOT read, said out loud. A check that did not run is not a check that passed, and a chat
     is exactly where that difference gets lost. */
  const unknown = [];
  const dk = r.dataKnown || {};
  if (!dk.liquidity) unknown.push('liquidity');
  if (!dk.holders) unknown.push('holder count');
  if (!dk.concentration) unknown.push('holder concentration');
  if (!dk.verified) unknown.push('contract verification');
  if (!dk.snipers) unknown.push('the block-0 buyers');
  if (unknown.length) {
    L.push('');
    L.push('❓ <b>Could not read:</b> ' + tgEsc(unknown.join(', ')) + ' — treated as unknown, not as passed.');
  }
  if (p.priceStale) L.push('⏳ The price feed was unreachable on the last sweep; the figures above are the last reading we actually took.');

  L.push('');
  L.push('<code>' + tgEsc(p.token.address) + '</code>');
  const site = BASE_URL.replace(/\/+$/, '');
  L.push('🔎 <a href="' + tgEsc(site + '/newpairs.html') + '">Full scan on the radar</a> · <a href="' + tgEsc(BLOCKSCOUT + '/token/' + p.token.address) + '">Explorer</a>');
  L.push('');
  L.push('<i>🎉 Entertainment only — not financial advice, and never a signal to buy. Most new tokens go to zero. Do your own research.</i>');
  return L.join('\n');
}

/* One scan, shared by every entry point. Returns the message text. */
async function tgScan(addr) {
  let out;
  try { out = await lookupTokenPair(addr); }
  catch (e) {
    return '⏳ Couldn’t read that token just now (' + tgEsc((e && e.message) || 'upstream error') +
      '). Nothing here is a judgement about it — try again in a moment.';
  }
  if (out && out.unavailable) return '⏳ ' + tgEsc(out.reason ? 'Couldn’t reach the price feed or the chain (' + out.reason + ').' : 'Couldn’t check that token just now.') + ' Nothing here is a judgement about it — try again in a moment.';
  if (out && out.notFound) return '🤷 No trading pool exists for that address on Robinhood Chain — the chain itself says so. It may never have launched, or its pool may be gone.';
  if (!out || !out.pair) return '⏳ Couldn’t read that token just now. Nothing here is a judgement about it — try again in a moment.';
  return tgScanMessage(out.pair);
}

const TG_HELP = [
  '👋 <b>I scan tokens on Robinhood Chain.</b>',
  '',
  'Send me a contract address — or use <code>/scan &lt;address&gt;</code> — and I’ll read it straight from the chain: liquidity, holders, who bought in the very first block, and the traps worth knowing about.',
  '',
  '<b>In a group:</b> add me and I’ll answer <code>/scan &lt;address&gt;</code> for anyone. I only reply when asked, and I never read anything else.',
  '',
  'I say what I <i>could not</i> check as clearly as what I did. A check that did not run is never reported as one that passed.',
  '',
  '<i>🎉 Entertainment only — not financial advice, and never a signal to buy.</i>',
].join('\n');

const TG_ADDR_RE = /0x[0-9a-fA-F]{40}/;

async function handleTgUpdate(u) {
  const msg = u && (u.message || u.channel_post || u.edited_message);
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  const text = String(msg.text || msg.caption || '').trim();
  if (!text) return;

  // /command, /command@thisbot — ignore a command explicitly aimed at a DIFFERENT bot in the same group
  const cmd = /^\/([a-z_]+)(?:@([A-Za-z0-9_]+))?\b\s*(.*)$/s.exec(text);
  if (cmd && cmd[2] && tgMe && cmd[2].toLowerCase() !== String(tgMe.username || '').toLowerCase()) return;
  const name = cmd ? cmd[1].toLowerCase() : null;
  const rest = cmd ? cmd[3] : '';

  if (name === 'start' || name === 'help') {
    // a deep link (t.me/bot?start=<address>) arrives as /start <address> — scan it straight away
    const deep = TG_ADDR_RE.exec(rest || '');
    if (name === 'start' && deep) return void tgSend(chatId, await tgScanGuarded(chatId, deep[0]));
    return void tgSend(chatId, TG_HELP);
  }

  let addr = null;
  if (name === 'scan') {
    const m = TG_ADDR_RE.exec(rest || '');
    if (!m) return void tgSend(chatId, 'Send it like this: <code>/scan 0x…</code> — a token contract address on Robinhood Chain.');
    addr = m[0];
  } else if (!cmd && msg.chat.type === 'private') {
    // in a DM, a bare address is obviously a scan request; in a group it is not — groups must ask
    const m = TG_ADDR_RE.exec(text);
    if (m) addr = m[0];
  }
  if (!addr) return;
  return void tgSend(chatId, await tgScanGuarded(chatId, addr));
}

// per-chat budget: a scan costs real upstream reads, and the bot can be in any number of groups
async function tgScanGuarded(chatId, addr) {
  if (!rateLimit('tgscan:' + chatId, TG_SCAN_CAP, 60000)) {
    return '🧊 That’s a lot of scans at once — give me a minute. (Each one is a fresh read of the chain.)';
  }
  return tgScan(addr.toLowerCase());
}

/* Long-poll loop: the only mode that works without a public https origin, which is where this project is
   today. getUpdates holds the connection open for up to 50s, so this is one idle request at a time, not a
   busy loop. Switched off automatically when a webhook is in use. */
async function tgPoll() {
  if (!TG_ON || tgPolling || TG_PUBLIC) return;
  tgPolling = true;
  try {
    const ups = await tgApi('getUpdates', { offset: tgOffset, timeout: 50, allowed_updates: ['message', 'channel_post'] }, 60000);
    for (const u of ups || []) {
      tgOffset = Math.max(tgOffset, u.update_id + 1);
      try { await handleTgUpdate(u); } catch (e) { console.error('telegram update failed:', e.message); }
    }
  } catch (e) {
    if (!/aborted|abort/i.test(e.message || '')) console.error('telegram poll:', e.message);
    await new Promise(r => setTimeout(r, 5000));   // back off before the next attempt
  } finally { tgPolling = false; }
}

async function tgStart() {
  if (!TG_ON) return;
  try {
    tgMe = await tgApi('getMe');
    console.log('🤖 Telegram scanner live as @' + tgMe.username + (TG_PUBLIC ? ' (webhook)' : ' (polling)'));
    if (TG_PUBLIC) {
      await tgApi('setWebhook', {
        url: BASE_URL.replace(/\/+$/, '') + '/api/telegram/webhook',
        secret_token: TG_SECRET,
        allowed_updates: ['message', 'channel_post'],
      });
    } else {
      await tgApi('deleteWebhook', {}).catch(() => {});   // polling and a webhook are mutually exclusive
      setInterval(() => { tgPoll().catch(() => {}); }, 1000).unref();
    }
  } catch (e) {
    console.error('⚠️  Telegram bot could not start:', e.message, '— the site runs fine without it.');
  }
}


/* ===== Send Power decays when you stop showing up ==========================================================
   Send Power only ever went up. That makes it a record of what someone did once, not of what they are doing —
   an account that made three good calls a year ago outranks one that shows up daily, forever, and there is no
   way for the second to catch up except by out-grinding a number that never moves.

   So it leaks. A day missed costs a little; each further consecutive day costs a little more, because the
   point is to make coming back matter, not to punish one quiet afternoon. Three things drain it:
     · not checking in — the everyday one, and the only one that accelerates
     · being in read-only mode — you are not participating, by the site's own decision
     · calls that went underwater — a bad call should cost something, or a call is a free lottery ticket

   Deliberate limits, because this takes something away from people:
     · GRACE_DAYS of absence cost nothing at all. A weekend is not a lapse.
     · MAX_PCT caps a single day, however long the streak, so nobody loses a level overnight.
     · FLOOR protects a beginner's balance entirely — there is nothing to gain by draining someone who has
       barely started, and plenty to lose.
     · Every drain is written to points_events as a NEGATIVE amount, so the dashboard's own maths still adds
       up and a user can see exactly what happened and when.
     · One notification per drain. Losing Send Power silently would be the worst version of this.
   ======================================================================================================== */
const DECAY = {
  GRACE_DAYS: 2,        // consecutive days away before anything is taken
  BASE_PCT: 0.4,        // % of the balance lost on the first day past grace
  ACCEL_PCT: 0.2,       // added per further consecutive day away
  MAX_PCT: 4,           // ceiling for one day's total drain, however long the absence
  READONLY_PCT: 1.0,    // added while the account is in read-only mode
  BAD_CALL_PCT: 0.3,    // added per call currently underwater, up to BAD_CALL_MAX
  BAD_CALL_MAX: 1.5,
  FLOOR: 5000,          // balances at or under this are never touched
  MIN_DRAIN: 1,         // below one whole point, take nothing rather than round up
};

// UTC day number — the same clock the daily check-in ref uses, so "a day" means one thing across the site
const dayNo = (t) => Math.floor((t || now()) / 864e5);

/* One account's decay for today. Returns what was taken (0 if nothing). Idempotent per UTC day: decay_at
   records the last day applied, so a restart, a double-fire or a manual run can never charge twice. */
function decayUser(u, today) {
  if (!u || !(u.points > DECAY.FLOOR)) {
    // still advance the marker so a beginner who crosses the floor later doesn't get charged for the
    // whole quiet stretch behind them in one go
    db.prepare('UPDATE users SET decay_at = ?, decay_streak = 0 WHERE id = ?').run(today, u.id);
    return 0;
  }
  const checkedInToday = !!db.prepare('SELECT 1 FROM points_events WHERE user_id = ? AND kind = ? AND created_at > ?')
    .get(u.id, 'daily', now() - 864e5);
  if (checkedInToday) {
    db.prepare('UPDATE users SET decay_at = ?, decay_streak = 0 WHERE id = ?').run(today, u.id);
    return 0;   // showed up: the streak resets and nothing is taken
  }

  const streak = (u.decay_streak || 0) + 1;
  let pct = 0;
  if (streak > DECAY.GRACE_DAYS) pct += DECAY.BASE_PCT + (streak - DECAY.GRACE_DAYS - 1) * DECAY.ACCEL_PCT;

  // read-only: the site has already judged this account is not participating
  const readOnly = !!restrictionOf(u);
  if (readOnly) pct += DECAY.READONLY_PCT;

  /* Underwater calls. Only calls still open and still below their entry count — a call that recovered is not
     a bad call, and one already written off as rugged is charged once through this same route rather than
     twice. Counted from the stored prices, so this costs no chain reads. */
  const bad = db.prepare(`SELECT COUNT(*) n FROM calls
                          WHERE user_id = ? AND cur_price > 0 AND entry_price > 0 AND cur_price < entry_price`).get(u.id).n;
  if (bad > 0) pct += Math.min(DECAY.BAD_CALL_MAX, bad * DECAY.BAD_CALL_PCT);

  pct = Math.min(DECAY.MAX_PCT, pct);
  if (!(pct > 0)) {
    db.prepare('UPDATE users SET decay_at = ?, decay_streak = ? WHERE id = ?').run(today, streak, u.id);
    return 0;   // inside the grace window with nothing else against the account
  }

  // never below the floor, and never a fractional nibble
  const drain = Math.min(Math.floor(u.points * pct / 100), u.points - DECAY.FLOOR);
  if (!(drain >= DECAY.MIN_DRAIN)) {
    db.prepare('UPDATE users SET decay_at = ?, decay_streak = ? WHERE id = ?').run(today, streak, u.id);
    return 0;
  }
  try {
    db.exec('BEGIN');
    db.prepare('UPDATE users SET points = MAX(0, points - ?), decay_at = ?, decay_streak = ? WHERE id = ?')
      .run(drain, today, streak, u.id);
    // negative amount, so every dashboard that sums this ledger stays correct without knowing about decay
    db.prepare('INSERT INTO points_events (user_id, kind, amount, base, mult, ref, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(u.id, 'decay', -drain, -drain, 1, 'decay:' + u.id + ':' + today, now());
    db.exec('COMMIT');
  } catch { try { db.exec('ROLLBACK'); } catch {} return 0; }

  const why = [];
  if (streak > DECAY.GRACE_DAYS) why.push(streak + ' days without checking in');
  if (readOnly) why.push('read-only mode');
  if (bad > 0) why.push(bad + ' call' + (bad === 1 ? '' : 's') + ' underwater');
  notify(u.id, '📉', 'Send Power decayed by ' + drain.toLocaleString('en-US') + ' (' + (Math.round(pct * 10) / 10) +
    '%) — ' + why.join(', ') + '. Check in to stop it.', 'points');
  return drain;
}

/* The sweep. Bounded per run so one pass can never lock the database for long, and it only ever looks at
   accounts that have not already been charged today. */
const DECAY_BATCH = 200;
let decayRunning = false;
function runDecaySweep() {
  if (decayRunning) return { users: 0, drained: 0 };
  decayRunning = true;
  const today = dayNo();
  let users = 0, drained = 0;
  try {
    const rows = db.prepare(`SELECT id, points, decay_streak, restricted_until, restrict_level
                             FROM users WHERE decay_at < ? AND system = 0 ORDER BY id LIMIT ?`).all(today, DECAY_BATCH);
    for (const u of rows) {
      try { const d = decayUser(u, today); users++; drained += d; } catch {}
    }
  } catch (e) { console.error('decay sweep', e.message); }
  finally { decayRunning = false; }
  return { users, drained };
}

const decayTimer = setInterval(() => { try { runDecaySweep(); } catch {} }, 5 * 60 * 1000);
const uploadSweepTimer = setInterval(sweepOrphanUploads, 15 * 60 * 1000);
uploadSweepTimer.unref();

// Graceful shutdown: stop taking new connections, let in-flight requests finish, then checkpoint + close SQLite
// cleanly (folds the WAL back in — prevents bloat/corruption across zero-downtime deploys) and exit.
// The DB close is idempotent and runs on BOTH the clean-drain path AND the force backstop, so a real deploy
// (which sends SIGTERM while requests are in-flight and keep-alive sockets linger) still gets a clean DB.
let shuttingDown = false, dbClosed = false;
function closeDb() {
  if (dbClosed) return; dbClosed = true;
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); db.close(); } catch (e) { console.error('db close error', e); }
}
function shutdown(signal) {
  if (shuttingDown) return; shuttingDown = true;
  console.log(`↩︎ ${signal} — draining and shutting down…`);
  const force = setTimeout(() => { console.error('drain timeout — closing forcibly'); try { server.closeAllConnections(); } catch {} closeDb(); process.exit(0); }, 10000);
  force.unref();
  server.close(() => { closeDb(); clearTimeout(force); process.exit(0); });
  // Free idle keep-alive sockets immediately, and forcibly close any that linger after in-flight requests finish,
  // so server.close()'s callback actually fires promptly instead of waiting out keepAliveTimeout (65s).
  try { server.closeIdleConnections(); } catch {}
  setTimeout(() => { try { server.closeAllConnections(); } catch {} }, 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Boot-time config sanity — loud warnings (never fatal) so a misconfigured production deploy is obvious in the logs.
function productionChecks() {
  // any production signal counts — an operator who set COOKIE_SECURE/TRUST_PROXY but forgot BASE_URL is exactly who needs the warning
  const prod = IS_HTTPS || process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1' || !!TRUST_PROXY_HOPS;
  const warn = (m) => console.warn('⚠️  ' + m);
  // The .env.example placeholder is the single likeliest deploy mistake, and its symptom is silent: every
  // browser POST is rejected as cross-origin, so signup and login just fail with no clue why. Checked
  // unconditionally — a placeholder is wrong in every environment.
  if (/yourdomain\.com|example\.com|justsendit\.example/i.test(BASE_URL)) {
    warn('BASE_URL is still the .env.example placeholder (' + BASE_URL + ') — every browser POST will be rejected as cross-origin (403), so nobody can sign up or log in. Set it to your real https origin.');
  }
  if (prod) {
    if (BASE_URL.includes('localhost')) warn('BASE_URL is still localhost — OAuth redirects and Secure cookies will be wrong in production. Set BASE_URL=https://yourdomain.');
    if (!IS_HTTPS && process.env.COOKIE_SECURE !== '1') warn('Serving over http and COOKIE_SECURE!=1 — session cookies will NOT be marked Secure. Set COOKIE_SECURE=1 behind TLS termination.');
    if (!TRUST_PROXY_HOPS) warn('TRUST_PROXY unset — behind a reverse proxy, rate limits & the community anti-sybil gate will key on the proxy IP, not real clients. Set TRUST_PROXY to your proxy hop count (1 for a single proxy).');
  }
}

server.listen(PORT, () => { console.log(`🚀 JustSendIt running at ${BASE_URL}`); productionChecks(); tgStart().catch(() => {}); setTimeout(() => { seedOfficialCommunities().then(seedDemoCommunity).catch(() => {}); }, 2500).unref(); });

// New Pairs Radar is hidden (unlinked from the nav) — no background refresher runs so we don't hit the
// RPC/Blockscout/Dexscreener every 90s for a page nobody can reach. The /api/pairs/new endpoint still
// lazy-builds on first request, so re-linking the page in the nav brings it fully back with no other change.
// To re-enable continuous background refresh, restore:
//   pairsCache.building = true; refreshPairs().catch(() => {});
//   setInterval(() => { refreshPairs().catch(() => {}); }, PAIRS_TTL);
