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
const { verifyMessage } = require('ethers');
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
  address TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL
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
  // Convicted In: reference price/mcap captured when the token was pinned (basis for "Xs up since you convicted")
  "ALTER TABLE pinned_tokens ADD COLUMN pin_price REAL",                      // USD price at pin time (0/NULL = no baseline, e.g. legacy pin)
  "ALTER TABLE pinned_tokens ADD COLUMN pin_mc REAL",                         // market cap at pin time (for reference)
  "ALTER TABLE community_members ADD COLUMN qual_check_at INTEGER",           // last time we re-verified this member still holds the community's token (drives the holder-continuity sweep)
  "ALTER TABLE users ADD COLUMN upload_bytes INTEGER NOT NULL DEFAULT 0",     // running total of stored upload bytes for this user (per-account media quota)
]) { try { db.exec(col); } catch {} }

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
`);
// idx_hops_call duplicated call_hops' own PRIMARY KEY index — pure write overhead, so drop the one already on disk
try { db.exec('DROP INDEX IF EXISTS idx_hops_call'); } catch {}
db.exec('PRAGMA optimize;'); // let SQLite build/refresh stat samples for the query planner on boot
// One-time repair: OG badges left on accounts with NO linked wallet (the badge now follows the wallet — see /api/wallet/disconnect).
// Not a revoke: relinking the early-buyer wallet re-verifies on-chain and re-grants.
try { db.prepare("UPDATE users SET og = 0 WHERE og = 1 AND og_revoked = 0 AND id NOT IN (SELECT user_id FROM identities WHERE type = 'wallet')").run(); } catch {}

// Moderation (mutes) + per-user wallet-tracker report cache (encrypted at rest)
db.exec(`
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
function sessionCookie(token) {
  // Secure whenever we serve https OR are told we sit behind TLS termination (COOKIE_SECURE=1)
  const secure = (BASE_URL.startsWith('https') || process.env.COOKIE_SECURE === '1') ? '; Secure' : '';
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`;
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
  return u ? { ...u, sid: cookies.sid } : null;
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
// SIWE-style, domain-bound messages: a wallet shows the user WHICH site is asking, so a signature phished on another
// site can never open a session here (the server only accepts the exact message it issued, and that names this host)
function signInMessage(address, nonce, statement) {
  return `${SITE_HOST} wants you to sign in with your wallet.\n\n${statement || 'Read-only sign-in to JustSendIt. This signature never moves funds and grants no token approvals.'}\n\nURI: ${BASE_URL.replace(/\/+$/, '')}\nAddress: ${address}\nChain ID: 4663\nNonce: ${nonce}\nIssued At: ${new Date(now()).toISOString()}\nExpiration Time: ${new Date(now() + 6e5).toISOString()}`;
}
function issueNonce(address, statement) {
  const nonce = rand(16), message = signInMessage(address, nonce, statement);
  db.prepare('INSERT INTO nonces (address, nonce, expires_at, msg) VALUES (?,?,?,?) ON CONFLICT(address) DO UPDATE SET nonce=excluded.nonce, expires_at=excluded.expires_at, msg=excluded.msg')
    .run(bidx(address), nonce, now() + 6e5, encField(message));
  return message;
}
// verify a signature against the message we issued for this address; returns the recovered address or an error string
function consumeNonce(address, signature) {
  const n = db.prepare('SELECT * FROM nonces WHERE address = ? AND expires_at > ?').get(bidx(address), now());
  if (!n) return { error: 'request a wallet signature first — it may have expired' };
  const message = decField(n.msg); if (!message) return { error: 'request a wallet signature first' };
  let recovered;
  try { recovered = verifyMessage(message, String(signature || '')).toLowerCase(); } catch { return { error: 'bad signature' }; }
  if (recovered !== address) return { error: 'signature does not match that address' };
  db.prepare('DELETE FROM nonces WHERE address = ?').run(bidx(address));
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
const PTS = { post: 25, first_post: 50, comment: 8, react_give: 2, react_get: 3, vote_give: 2, vote_get: 4, follow: 6, be_followed: 5, track_wallet: 15, watch_token: 5, connect_wallet: 50, customize: 10, daily: 20, swap: 150, send_call: 40, hop_on: 10, call_x: 60 };
// anti-farm: max awards of this kind per rolling 24h (per recipient user).
// Every point-earning kind is capped so no single action can be farmed unbounded.
const DAILY_CAP = { post: 40, first_post: 1, comment: 20, react_give: 40, react_get: 60, vote_give: 60, vote_get: 100, follow: 10, be_followed: 30, track_wallet: 10, watch_token: 30, connect_wallet: 5, customize: 2, swap: 20, send_call: 20, hop_on: 30, community_founder: 1 }; // call_x (milestone payouts) is uncapped — earned by real performance
const PTS_EVENT_CAP = 500000; // hard ceiling on any single points event (backstop against the size × holder multiplier stack)
// ===== Communities: token-address communities that go live at 10 opt-ins; being in one = a flat 10× Send Power =====
const COMMUNITY_MULT = 10;       // flat 10× on EVERY action while a verified holder in ≥1 LIVE community (NOT per-community, NOT 10^n)

/* ===== Arcade: Rocket Run (crash game) =====
   One run per UTC day. The rocket's multiplier is a pure function of ELAPSED SERVER TIME, and the crash point is
   generated server-side and never sent to the browser until the run is over — so the client can animate freely but
   can never know (or fake) when it blows. Cashing out converts the multiplier you stopped at into a Send Power
   boost that stacks on your Holder/OG/community multipliers for 24 hours. No stakes, no money — a daily bonus game. */
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
// THE multiplier every point is paid at — the single source of truth for awardPoints, the dashboard and the nav badge,
// so the number a user sees can never drift from the number they're actually paid.
function effectiveMult(userId) {
  const holder = holderMultiplier(userId);
  const row = db.prepare('SELECT og, live_comm_count FROM users WHERE id = ?').get(userId);
  let og = 1; // OGs earn 10× — but ONLY while their holdings are recently on-chain-verified AND non-zero (still holding both)
  if (row && row.og) {
    const h = db.prepare('SELECT send_tok, gwc_tok, last_check FROM holder_state WHERE user_id = ?').get(userId);
    if (h && h.last_check && now() - h.last_check <= HOLDER_TTL && (h.send_tok || 0) > OG_DUST && (h.gwc_tok || 0) > OG_DUST) og = OG_BONUS;
  }
  const community = (row && row.live_comm_count > 0) ? COMMUNITY_MULT : 1; // flat, not per-community and not 10^n
  const arcade = arcadeBoostOf(userId);                                    // today's Rocket Run cash-out, until it expires
  const total = holder * og * community * arcade;
  return { holder, og, community, arcade, total: Math.round(total * 100) / 100 };
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
const FOUNDER_BONUS = 5000;     // one-time base, flows through awardPoints (multiplied + PTS_EVENT_CAP-clamped)
const MIN_COMMUNITY_LIQ = 500;  // no communities on a dust pool (same floor as Send Calls)
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
  const c = db.prepare('SELECT id, status, member_count, qual_count, official FROM communities WHERE token_addr = ? COLLATE NOCASE').get(String(addr || '').toLowerCase());
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
    const cur = db.prepare('SELECT og FROM users WHERE id = ?').get(userId);
    if (cur && cur.og) {
      db.prepare('UPDATE users SET og = 0, og_revoked = 1 WHERE id = ?').run(userId);
      notify(userId, '💔', 'OG status removed — OG requires holding BOTH $SEND and $GWC, and you sold out of one of them. It can’t be reclaimed.', 'og');
    }
  }
  const freshH = { streak_start: streakStart, gwc_streak_start: gwcStreak, last_check: now() };
  const hd = streakStart ? (now() - streakStart) / 864e5 : 0;
  return { hasWallet: true, multiplier: holderMultiplier(userId), pct: score, pctSend, pctGwc, holdDays: hd, gwcDays: gwcDaysOf(freshH), sendTok, gwcTok, streakStart, fresh: true, diamond: diamondInfo(effHoldDays(freshH)) };
}

// ===== OG detection: did any of the user's linked wallets BUY $SEND/$GWC in its first month? (read-only, on-chain) =====
// A "buy" = an ERC-20 transfer of the token OUT of its LP pool TO the wallet, timestamped within [launch, launch+30d].
async function boughtInFirstMonth(wallet, token, pair, launchMs) {
  const w = wallet.toLowerCase(), pl = pair.toLowerCase(), end = launchMs + OG_WINDOW_MS;
  const base = BLOCKSCOUT + '/api/v2/addresses/' + w + '/token-transfers?type=ERC-20&filter=to&token=' + token;
  let url = base;
  for (let page = 0; page < 12 && url; page++) {          // transfers come newest-first; page back until we pass the window
    const j = await jget(url);
    if (!j || !Array.isArray(j.items)) throw new Error('og scan incomplete'); // a Blockscout hiccup must NOT read as "no early buy" — let checkOg retry instead of locking in the wrong answer
    for (const it of j.items) {
      const to = ((it.to && it.to.hash) || '').toLowerCase();
      const from = ((it.from && it.from.hash) || '').toLowerCase();
      const ts = Date.parse(it.timestamp || it.block_timestamp || '') || 0;
      if (to === w && from === pl && ts >= launchMs && ts <= end) return true;   // a genuine pool buy inside the first month
      if (ts && ts < launchMs - 864e5) return false;      // paged a full day past the window's start → no earlier buys exist
    }
    const np = j.next_page_params;
    url = np ? base + '&' + new URLSearchParams(np).toString() : null;
  }
  return false;
}
const _ogScanning = new Set(); // coalesce concurrent scans of the same user
async function checkOg(userId) {
  const u = db.prepare('SELECT og, og_revoked FROM users WHERE id = ?').get(userId);
  if (!u || u.og) return !!(u && u.og);         // already an OG — permanent unless revoked by a full sell-out
  if (u.og_revoked) return false;               // sold out completely once → OG is gone for good, never re-granted
  if (_ogScanning.has(userId)) return false;
  _ogScanning.add(userId);
  try {
    const addrs = walletAddresses(userId).slice(0, OG_MAX_WALLETS); // must have a connected (read-only) wallet; cap the scan
    if (!addrs.length) return false;
    // OG requires holding BOTH $SEND AND $GWC now (not either/or). Read current balances first; if they don't hold
    // both, don't grant. Fail-closed: an errored read returns WITHOUT stamping → retried later.
    let holdsSend = false, holdsGwc = false;
    try {
      for (const a of addrs) {
        if (!holdsSend && (await erc20Balance(TOK.SEND, a)) > OG_DUST_WEI) holdsSend = true;
        if (!holdsGwc && (await erc20Balance(TOK.GWC, a)) > OG_DUST_WEI) holdsGwc = true;
        if (holdsSend && holdsGwc) break;
      }
    } catch { return false; }
    if (!(holdsSend && holdsGwc)) { db.prepare('UPDATE users SET og_checked_at = ? WHERE id = ?').run(now(), userId); return false; }
    // ...and must have BOUGHT BOTH within their first month (across any linked wallet).
    let boughtSend = false, boughtGwc = false, scanFailed = false;
    for (const a of addrs) {
      if (!boughtSend) { try { if (await boughtInFirstMonth(a, TOK.SEND, OG_PAIR.SEND, OG_LAUNCH.SEND)) boughtSend = true; } catch { scanFailed = true; } }
      if (!boughtGwc) { try { if (await boughtInFirstMonth(a, TOK.GWC, OG_PAIR.GWC, OG_LAUNCH.GWC)) boughtGwc = true; } catch { scanFailed = true; } }
      if (boughtSend && boughtGwc) break;
    }
    if (boughtSend && boughtGwc) {
      // grant only while the invariant holds: still un-granted, never revoked, and a wallet is STILL linked — a disconnect that
      // landed during this multi-second scan must not leave a wallet-less account wearing the badge
      const g = db.prepare("UPDATE users SET og = 1, og_checked_at = ? WHERE id = ? AND og = 0 AND og_revoked = 0 AND EXISTS (SELECT 1 FROM identities WHERE user_id = users.id AND type = 'wallet')").run(now(), userId);
      if (!g.changes) return false;
      notify(userId, '🏅', 'OG unlocked! You bought BOTH $SEND and $GWC in their first month and still hold both — permanent OG badge + a 10× Send Power bonus on everything. 🚀', 'og');
      return true;
    }
    if (!scanFailed) db.prepare('UPDATE users SET og_checked_at = ? WHERE id = ?').run(now(), userId); // only record a CLEAN "not both" result
    return false;
  } finally { _ogScanning.delete(userId); }
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
function awardPoints(userId, kind, base, ref) {
  if (!userId || !(base > 0)) return 0;
  if (ref && db.prepare('SELECT 1 FROM points_events WHERE ref = ?').get(ref)) return 0;
  if (DAILY_CAP[kind]) {
    const cnt = db.prepare('SELECT COUNT(*) n FROM points_events WHERE user_id=? AND kind=? AND created_at>?').get(userId, kind, now() - 864e5).n;
    if (cnt >= DAILY_CAP[kind]) return 0;
  }
  const effMult = effectiveMult(userId).total;
  const amount = Math.min(PTS_EVENT_CAP, Math.max(1, Math.round(base * effMult))); // clamp any single event (size × holder × OG stack) to a sane ceiling
  try {
    db.exec('BEGIN');
    db.prepare('INSERT INTO points_events (user_id, kind, amount, base, mult, ref, created_at) VALUES (?,?,?,?,?,?,?)').run(userId, kind, amount, base, effMult, ref || null, now());
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(amount, userId);
    db.exec('COMMIT');
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
async function holdsToken(uid, tokenAddr) {
  const t = String(tokenAddr || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(t)) return false;
  const key = uid + ':' + t;
  const addrs = walletAddresses(uid).slice(0, MAX_LINKED_WALLETS); // EVERY linkable wallet — a bag sitting in wallet #4 must count (refreshHolder reads the same set)
  if (!addrs.length) { tokenHoldCache.delete(key); return false; } // no linked wallet = verifiably holds nothing — and a cached "held" from before a disconnect must not outlive it
  const c = tokenHoldCache.get(key);
  if (c && now() - c.at < HOLDS_TTL) return c.held;
  let held = false, failed = 0;
  for (const a of addrs) {
    try { if ((await erc20Balance(t, a)) > OG_DUST_WEI) { held = true; break; } } catch { failed++; }
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
  if (!holds) return 'You must hold $' + c.symbol + ' (verified on-chain from a linked wallet).'; // MUST hold the community's own token — read-only
  const ipk = ip ? bidx(ip) : null; // IPs are stored only as blind indexes
  const ipUses = db.prepare("SELECT COUNT(*) n FROM community_members WHERE community_id=? AND qualified=1 AND join_ip=?").get(c.id, ipk).n;
  if (ipUses >= 2) return 'You hold $' + c.symbol + ', but 2 verified members already opted in from your network (the anti-sybil cap). You’re in as a member — posting and the 10× need a verified slot.'; // ≤2 qualifying opt-ins per IP
  if (ipk && ipk === c.creator_ip && me.id !== c.creator_id) return 'Opt-ins from the starter’s own network don’t count as verified (anti-sybil) — you’re in as a member, without the 10×.'; // founder-IP opt-ins don't count toward their own go-live
  return null;
}
function qualifyOptIn(me, c, ip, holds) { return !qualifyReason(me, c, ip, holds); }
function commBrand(c) { try { return JSON.parse(c.brand || 'null') || {}; } catch { return {}; } }
function commLevelInfo(xp) { const lvl = levelForXp(xp); const base = xpForLevel(lvl), next = xpForLevel(lvl + 1); return { level: lvl, xp: xp, intoLevel: xp - base, spanLevel: next != null ? next - base : null }; }
function communityCardView(c, me) {
  const b = commBrand(c), act = decayedActivity(c);
  return {
    id: c.id, token: c.token_addr, pair: c.pair_addr, symbol: c.symbol, name: c.name,
    image: b.imageUrl || null, banner: b.header || null,
    status: c.status, memberCount: c.member_count, qualCount: c.qual_count, need: LIVE_THRESHOLD, remaining: Math.max(0, LIVE_THRESHOLD - c.qual_count),
    holders: c.c_holders, mcap: c.c_mc, price: c.c_price, priceChange: c.c_pc24, liq: c.c_liq,
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
const demoToken = () => WETH_ADDR.toLowerCase();   // resolved lazily: WETH_ADDR is declared further down
function seedDemoCommunity() {
  try {
    let owner = db.prepare('SELECT id FROM users WHERE system = 1').get();
    if (!owner) return; // the official seeder creates the system account; it runs first
    const ex = db.prepare('SELECT id FROM communities WHERE token_addr = ? COLLATE NOCASE').get(demoToken());
    if (ex) { db.prepare("UPDATE communities SET demo=1, official=1, status='live' WHERE id=?").run(ex.id); return; }
    db.prepare(`INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, brand, status, official, demo,
                founder_paid, went_live_at, creator_ip, created_at)
                VALUES (?,?,?,?,?,?,'live',1,1,1,?,NULL,?)`)
      .run(owner.id, demoToken(), demoToken(), 'RHC', 'Robinhood Chain',
           JSON.stringify({ enhanced: false, boosted: 0, imageUrl: null, header: null, websites: [], socials: [] }),
           now(), now());
    console.log('🏘️ seeded the open Robinhood Chain sandbox community');
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
      founderPaid = awardPoints(fresh.creator_id, 'community_founder', FOUNDER_BONUS, 'commfound:' + cid);
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
  const rows = db.prepare("SELECT id, token_addr FROM communities").all();
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
// Continuously re-verify qualified community members STILL hold the community's token — a sell or a recycled-bag move
// revokes their qualification + the flat 10×, so holding is an ongoing requirement, not a one-time point-in-time check.
let communityHolderSweeping = false;
async function sweepCommunityHolders() {
  if (communityHolderSweeping) return; communityHolderSweeping = true;
  try {
    const rows = db.prepare("SELECT cm.community_id, cm.user_id, c.token_addr FROM community_members cm JOIN communities c ON c.id = cm.community_id WHERE cm.qualified = 1 AND c.status = 'live' AND c.demo = 0 ORDER BY COALESCE(cm.qual_check_at, 0) ASC LIMIT 40").all();
    for (const r of rows) {
      let holds; try { holds = await holdsToken(r.user_id, r.token_addr); } catch { continue; } // RPC error → skip (never revoke on a transient failure)
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
    let gain, baseAt, exact;
    if (wkey === '24h' && r.cur_pc24 != null) { gain = r.cur_pc24 / 100; baseAt = now() - 864e5; exact = true; }
    else {
      const snap = ms ? db.prepare('SELECT price, at FROM runner_snaps WHERE token_addr=? AND at >= ? ORDER BY at ASC LIMIT 1').get(r.token_addr, since) : null;
      const earliest = db.prepare('SELECT price, at FROM runner_snaps WHERE token_addr=? ORDER BY at ASC LIMIT 1').get(r.token_addr);
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
    const ath = (r.peak_price > 0 && r.first_price > 0) ? (r.peak_price / r.first_price - 1) : null; // all-time-high multiple since first seen (peak vs the all-time baseline)
    scored.push({ token: r.token_addr, pair: r.pair_addr, symbol: r.symbol, name: r.name, brand: runnerBrand(r.brand), mcap: r.cur_mc, liq: r.cur_liq, holders: r.cur_holders, health: r.cur_health, priceChange24: r.cur_pc24, gain, ath, exact, depthDays: Math.max(0, Math.round((now() - baseAt) / 864e5)), firstSeenAt: r.first_seen_at });
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
    og: !!u.og, ogBonus: OG_BONUS, // verified OG (early buyer) → 10× Send Power on everything
    ogRevoked: !!u.og_revoked, // lost OG by selling out completely (can't be reclaimed)
    communityMult: (db.prepare('SELECT live_comm_count c FROM users WHERE id=?').get(u.id).c > 0) ? COMMUNITY_MULT : 1, // 10× while in ≥1 live community
    arcade: arcadeState(u.id),        // today's Rocket Run boost — stacks on Holder × OG × community
    checkedInToday: !!db.prepare('SELECT 1 FROM points_events WHERE ref = ?').get('daily:' + u.id + ':' + ymd()),
    communities: db.prepare('SELECT c.id, c.name, c.symbol, c.token_addr, c.xp, c.status, cm.conviction_xp FROM community_members cm JOIN communities c ON c.id = cm.community_id WHERE cm.user_id = ? AND cm.qualified = 1 ORDER BY cm.conviction_xp DESC').all(u.id).map(c => {
      const cl = commLevelInfo(c.xp), cv = commLevelInfo(c.conviction_xp);
      return { id: c.id, name: c.name, symbol: c.symbol, status: c.status, commLevel: cl.level, commInto: cl.intoLevel, commSpan: cl.spanLevel, conviction: { level: cv.level, title: convictionTitleFor(cv.level), into: cv.intoLevel, span: cv.spanLevel } };
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
const OG_DUST = 1e-9;                          // treat balances at/under this (in tokens) as fully sold out (OG revocation)
const OG_DUST_WEI = 1000000000n;               // same threshold in wei (1e9 wei = 1e-9 tokens) — keeps checkOg's "holds" test consistent with refreshHolder's revocation, so a dust balance can't be granted-then-whipsaw-revoked
const MAX_LINKED_WALLETS = 5;                   // cap wallets per account: every holder refresh / balance read iterates them (bounds RPC load + sweep time)
const OG_MAX_WALLETS = 3;                      // cap wallets scanned per OG check (bounds latency + Blockscout load)
const PIN_MAX = 12;                            // how many tokens a user can pin to their public wall ("Convicted In")
const PAIRS_KEEP = 48;      // how many newest pairs to track/enrich
const PAIRS_TTL = 30 * 1000; // background refresh cadence (demand-driven: re-sweeps on the next request once stale)

async function jget(url) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
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
  try { meta = await jget(BLOCKSCOUT + '/api/v2/tokens/' + token); } catch {}
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
const DEFAULT_CHAIN = 'robinhood';
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
};

function num(x) { const n = Number(x); return isFinite(n) ? n : 0; }
function numN(x) { const n = Number(x); return isFinite(n) ? n : null; }

// --- extra read-only on-chain reads for the tracker (all cached in the 90s pairs refresh) ---
async function ethCall(to, data) { return rpc('eth_call', [{ to, data }, 'latest']).catch(() => null); }
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
  };
  r.dataScore = Object.values(r.dataKnown).filter(Boolean).length;   // 0..5
  // liquidity + holders + an index entry are the minimum needed to say anything at all
  r.thinData = !(r.dataKnown.indexed && r.dataKnown.liquidity && r.dataKnown.holders);
  if (r.thinData && r.triage === 'ok') r.triage = 'caution';
  // honesty floor: a token carrying a high/critical-severity flag can never read as the green "Looks OK" tier
  const SEV_RANK = { low: 1, medium: 2, high: 3, critical: 4 };
  const worst = Object.keys(RISK).reduce((m, k) => r[k] ? Math.max(m, SEV_RANK[RISK[k].sev] || 0) : m, 0);
  if (worst >= 3 && r.triage === 'ok') r.triage = 'caution';
  e.risk = r;
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
  // Dexscreener batch (up to 30 tokens/call), matched back by pair address
  const dexByPair = {};
  const toks = valid.map(t => t.token);
  for (let i = 0; i < toks.length; i += 30) {
    const arr = await jget('https://api.dexscreener.com/tokens/v1/robinhood/' + toks.slice(i, i + 30).join(',')) || [];
    for (const pr of arr) if (pr && pr.pairAddress) dexByPair[pr.pairAddress.toLowerCase()] = pr;
  }
  if (usdgDecimals == null) { const d = await tokenDecimals(USDG_ADDR); if (d != null) usdgDecimals = d; } // cache only a successful read (retry next refresh)
  const enriched = (await mapLimit(valid, 6, async (t) => {
    const [meta, addr, holders, ts, reserves, ownerInfo, tokenDec] = await Promise.all([
      jget(BLOCKSCOUT + '/api/v2/tokens/' + t.token),
      jget(BLOCKSCOUT + '/api/v2/addresses/' + t.token),
      jget(BLOCKSCOUT + '/api/v2/tokens/' + t.token + '/holders?items_count=10'),
      blockTimestamp(t.block),
      getReserves(t.pair),        // pooled reserves (read-only)
      tokenOwner(t.token),        // owner()/renounced (read-only)
      tokenDecimals(t.token),     // authoritative decimals (read-only)
    ]);
    const p = buildPair(t, dexByPair[t.pair.toLowerCase()], meta, addr, holders, ts, reserves, ownerInfo, tokenDec);
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
  for (const e of enriched) applyRisk(e, deployerCounts, deployerDied);
  try { recordRunners(enriched); } catch {} // feed the Best Runners store (baseline + snapshots)
  try { cacheTokensFromPairs(enriched); } catch {} // persist each to the token-detail cache → the popup opens any of them instantly
  enriched.sort((a, b) => (b.pair.createdAt || 0) - (a.pair.createdAt || 0));
  pairsCache = { pairs: enriched, updatedAt: now(), building: false, error: null };
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
    jget(BLOCKSCOUT + '/api/v2/tokens/' + t.token),
    jget(BLOCKSCOUT + '/api/v2/addresses/' + t.token),
    jget(BLOCKSCOUT + '/api/v2/tokens/' + t.token + '/holders?items_count=10'),
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
  try { const pair = JSON.parse(row.pair_json); return pair ? { pair } : null; } catch { return null; } // corrupt row → treat as miss
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
    if (!(cur && cur.updated_at > startedAt)) tokenCachePut(tok, res); // don't clobber a row refreshed (e.g. by the radar) while we were fetching
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
async function factoryGetPair(a, b) {                          // getPair(address,address) 0xe6a43905 → pool addr or null
  const enc = (x) => x.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const r = await ethCall(FACTORY, '0xe6a43905' + enc(a) + enc(b));
  if (!r || r.length < 66) return null;
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
  const arr = await jget('https://api.dexscreener.com/tokens/v1/robinhood/' + tokenAddr) || [];
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
  // 2) fallback: ask the factory directly for a token/WETH or token/USDG pool (token is the base there by construction)
  if (!pairAddr) { const fb = (await factoryGetPair(tokenAddr, WETH_ADDR)) || (await factoryGetPair(tokenAddr, USDG_ADDR)); if (fb) { pairAddr = fb; tokenIsBase = true; } }
  if (!pairAddr) return { notFound: true };
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
  const author = db.prepare('SELECT username, avatar, avatar_img, accent, og FROM users WHERE id = ?').get(p.user_id);
  const myVote = me ? (db.prepare('SELECT value FROM post_votes WHERE post_id = ? AND user_id = ?').get(p.id, me.id) || {}).value || 0 : 0;
  const out = {
    id: p.id, text: p.text, image: p.image ? '/uploads/' + p.image : null, created_at: p.created_at,
    username: author.username, avatar: author.avatar,
    avatar_img: author.avatar_img ? '/uploads/' + author.avatar_img : null,
    accent: author.accent || '', og: !!author.og,
    reactions: counts, myReactions: mine, comments: cc,
    score: p.score || 0, myVote,
    mine: !!(me && me.id === p.user_id),
    call_id: p.call_id || null,
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
  const authorIds = [...new Set(rows.map(r => r.user_id))];
  const authors = {};
  for (const a of db.prepare(`SELECT id, username, avatar, avatar_img, accent, og FROM users WHERE id IN (${authorIds.map(() => '?').join(',')})`).all(...authorIds)) authors[a.id] = a;
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
      accent: a.accent || '', og: !!a.og,
      reactions: { fire: (rc[p.id] && rc[p.id].fire) || 0, rocket: (rc[p.id] && rc[p.id].rocket) || 0 },
      myReactions: myR[p.id] || [], comments: cc[p.id] || 0,
      score: p.score || 0, myVote: myV[p.id] || 0,
      mine: !!(me && me.id === p.user_id),
      call_id: p.call_id || null,
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

let lbCache = { at: 0, top: null };   // leaderboard top-20 cache (identical for everyone → serve for LB_TTL)
const LB_TTL = 8000;
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
    const sig = consumeNonce(address, b.signature); // domain-bound message we issued for this address
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
// ── Diamond-hands: reward a call that STAYS in positive Xs, the longer AND higher the more (exponentially) ──
// hold_x accumulates ∫ min(curX, cap) dt(hours) while curX>0. Points owed grow super-linearly with hold_x, so
// duration × height compound. Same mechanic rewards hoppers who stay in profit from their hop-in price.
const HOLD_K = 0.5, HOLD_EXP = 1.5;   // owed = HOLD_K · hold_x^HOLD_EXP  (super-linear ⇒ "exponentially more")
const HOLD_X_CAP = 50;                // cap the per-tick X height so one glitch tick can't spike the integral
const HOLD_DT_CAP_H = 0.5;            // credit at most 30 min of hold per tick (we never observed the price during a longer gap)
const HOLD_MAX = 250000;             // ceiling on total base hold points per position (bounded even for legendary holds)
const MIN_HOLD_AWARD = 20;           // only pay out once ≥ this is owed, so we don't spam tiny points_events rows
function accrueHold(holdX, holdPaid, curX, dtH) {
  let nx = holdX;
  if (curX > 0 && dtH > 0) nx += Math.min(dtH, HOLD_DT_CAP_H) * Math.min(curX, HOLD_X_CAP);
  const owed = Math.min(HOLD_MAX, HOLD_K * Math.pow(nx, HOLD_EXP));
  const award = (owed - holdPaid >= MIN_HOLD_AWARD) ? Math.floor(owed - holdPaid) : 0;
  return { holdX: nx, award, holdPaid: holdPaid + award };
}
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
    'SELECT h.user_id, h.entry_price, h.spend_usd, h.bought_usd, h.held_usd, h.created_at, u.username, u.avatar, u.avatar_img, u.og ' +
    'FROM call_hops h JOIN users u ON u.id = h.user_id WHERE h.call_id = ?'
  ).all(row.id);
  const supply = (row.entry_mc != null && row.entry_price > 0) ? row.entry_mc / row.entry_price : null;
  const t = now();
  const list = rows.map(h => {
    const holding = (h.held_usd || 0) > 0.01;              // still holds any of the coin
    const everBought = (h.bought_usd || 0) > 0 || (h.spend_usd || 0) > 0;
    return {
      _uid: h.user_id,                                     // diamond level is looked up AFTER the slice (see below)
      username: h.username, avatar: h.avatar, avatarImg: h.avatar_img ? '/uploads/' + h.avatar_img : null, og: !!h.og,
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
    const rows = db.prepare('SELECT id, user_id, token_addr, symbol, entry_price, peak_price, awarded_x, dead, rugged, hold_x, hold_paid, last_check FROM calls ORDER BY id DESC').all();
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
      const hc = liquid ? accrueHold(r.hold_x, r.hold_paid, curX, dtH) : { holdX: r.hold_x, award: 0, holdPaid: r.hold_paid };
      // Finding 1 fix: advance hold_paid ONLY if the credit actually landed. The integral (hold_x) still advances, so a rolled-back
      // award (SQLITE_BUSY/FULL) is simply retried next tick instead of being silently swallowed. No ref: dedup is the hold_paid delta.
      let holdPaid = r.hold_paid;
      if (hc.award > 0 && awardPoints(r.user_id, 'call_hold', hc.award) > 0) holdPaid = hc.holdPaid;
      // peak (the permanent ATH record + leaderboard basis) only advances on a trustworthy price, so a drained-pool pump can't set a fake ATH
      const peak = liquid ? Math.max(r.peak_price, info.price) : r.peak_price, newPeak = peak > r.peak_price;
      if (newPeak) db.prepare('UPDATE calls SET cur_price=?, cur_mc=?, peak_price=?, peak_at=?, dead=0, hold_x=?, hold_paid=?, last_check=? WHERE id=?').run(info.price, info.mc, peak, t, hc.holdX, holdPaid, t, r.id);
      else db.prepare('UPDATE calls SET cur_price=?, cur_mc=?, dead=0, hold_x=?, hold_paid=?, last_check=? WHERE id=?').run(info.price, info.mc, hc.holdX, holdPaid, t, r.id);
      if (liquid) {
        // milestone points off the price SUSTAINED across the last two samples (min of prev cur-price and now), capped — this
        // defeats a one-trade peak spike: a level must survive a full refresh interval with real liquidity before it pays.
        const sustained = Math.min(r.cur_price > 0 ? r.cur_price : info.price, info.price);
        const newMax = Math.min(Math.floor(callX(sustained, r.entry_price)), CALL_X_CAP);
        if (newMax > r.awarded_x && newMax >= 1) {
          for (let m = Math.max(1, r.awarded_x + 1); m <= newMax; m++) awardPoints(r.user_id, 'call_x', PTS.call_x * m, 'callx:' + r.id + ':' + m); // bigger call → more points
          db.prepare('UPDATE calls SET awarded_x=? WHERE id=?').run(newMax, r.id);
          notify(r.user_id, '🚀', 'Your $' + (r.symbol || '') + ' Send Call hit ' + newMax + 'x! Send Power for the call.', 'points');
        }
        // reward hoppers who are ALSO in positive Xs (from their own hop-in price), same diamond-hands mechanic + same Finding-1-safe advance
        const hops = db.prepare('SELECT user_id, entry_price, hold_x, hold_paid, last_check FROM call_hops WHERE call_id=?').all(r.id);
        for (const hop of hops) {
          if (!(hop.entry_price > 0)) continue;
          const ha = accrueHold(hop.hold_x, hop.hold_paid, callX(info.price, hop.entry_price), (t - (hop.last_check || t)) / 3600000);
          let hopPaid = hop.hold_paid;
          if (ha.award > 0 && awardPoints(hop.user_id, 'hop_hold', ha.award) > 0) hopPaid = ha.holdPaid;
          db.prepare('UPDATE call_hops SET hold_x=?, hold_paid=?, last_check=? WHERE call_id=? AND user_id=?').run(ha.holdX, hopPaid, t, r.id, hop.user_id);
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
    SELECT c.user_id, u.username, u.avatar, u.avatar_img, u.accent, u.og,
           COUNT(*) calls, MAX(MIN(c.peak_price / c.entry_price - 1, ?)) best,
           SUM(MIN(c.peak_price / c.entry_price - 1, ?)) totalX
    FROM calls c JOIN users u ON u.id = c.user_id
    WHERE c.created_at > ? AND c.entry_price > 0 AND c.entry_liq >= ?
    GROUP BY c.user_id ORDER BY totalX DESC, best DESC LIMIT 25`).all(CALL_X_CAP, CALL_X_CAP, since, MIN_CALL_LIQ);
  let rank = 0;
  return rows.map(r => ({
    rank: ++rank, username: r.username, avatar: r.avatar,
    avatar_img: r.avatar_img ? '/uploads/' + r.avatar_img : null, accent: r.accent || '', og: !!r.og,
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
    if (!ok) return bad(res, 'cross-origin request rejected', 403);
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
      if (p === '/api/me' && req.method === 'GET') {
        if (!me) return bad(res, 'not signed in', 401);
        return send(res, 200, {
          user: {
            username: me.username, avatar: me.avatar, bio: me.bio, auto_named: !!me.auto_named,
            methods: identityTypes(me.id), wallets: walletAddresses(me.id),
            twofa: me.twofa_method || null,
            mutes: mutedNames(me.id), // usernames this user has muted (private to them)
            theme: themeOf(me),
            tracker_prefs: JSON.parse(me.tracker_prefs || '{}'),
            site_prefs: JSON.parse(me.site_prefs || '{}'),
            twitter: me.twitter_handle || null, instagram: me.ig_handle || null,
            points: me.points, level: levelForXp(me.points), title: titleFor(levelForXp(me.points)), // for the nav badge
            og: !!me.og, // permanent OG badge + 10× Send Power (verified early buyer)
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
            entry.message = extra.message = `${SITE_HOST} wants you to confirm your sign-in with your wallet.\n\nTwo-factor confirmation for JustSendIt — never moves funds.\n\nURI: ${BASE_URL.replace(/\/+$/, '')}\nPending: ${pend}\nIssued At: ${new Date(now()).toISOString()}`;
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
      if (p === '/api/auth/login/wallet2fa' && req.method === 'POST') {
        if (!rateLimit('w2fa:' + clientIp(req), 30, 9e5)) return bad(res, 'too many attempts — slow down', 429);
        const b = await readBody(req);
        const pend = pendingLogins.get(String(b.pending || ''));
        if (!pend || pend.expires < now()) return bad(res, '2FA session expired — sign in again', 401);
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(pend.userId);
        if (!u || u.twofa_method !== 'wallet') return bad(res, 'wallet 2FA not enabled', 400);
        const message = pend.message; if (!message) return bad(res, '2FA session expired — sign in again', 401); // the exact domain-bound text we issued
        let recovered;
        try { recovered = verifyMessage(message, String(b.signature || '')).toLowerCase(); }
        catch { return bad(res, 'bad signature'); }
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
          db.prepare('UPDATE users SET og = 0' + (revokeOg ? ', og_revoked = 1' : '') + ' WHERE id = ?').run(me.id);
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
        // switching from TOTP to wallet 2FA must pass the current factor (else a hijacked session could flip it to a wallet it controls)
        if (me.twofa_method) { let b = {}; try { b = await readBody(req); } catch {} const err = await verifyCurrentFactor(me, b); if (err) return bad(res, err, 401); }
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
        return send(res, 200, { message: issueNonce(address) }); // domain-bound (SIWE-style), stored encrypted, 10-minute expiry
      }
      if (p === '/api/auth/wallet/verify' && req.method === 'POST') {
        if (!rateLimit('wverify:' + clientIp(req), 60, 9e5)) return bad(res, 'slow down', 429);
        const b = await readBody(req);
        const address = String(b.address || '').toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(address)) return bad(res, 'bad address');
        const sig = consumeNonce(address, b.signature);
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
          const u2 = db.prepare('SELECT twofa_method FROM users WHERE id = ?').get(userId);
          if (u2 && u2.twofa_method && u2.twofa_method !== 'wallet') {
            const pend = rand(16);
            pendingLogins.set(pend, { userId, expires: now() + 3e5 });
            return send(res, 200, { twofa: u2.twofa_method, pending: pend, username });
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
          db.prepare('UPDATE users SET tracker_prefs = ? WHERE id = ?').run(j, me.id);
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
          db.prepare('UPDATE users SET site_prefs = ? WHERE id = ?').run(j, me.id);
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
        // profile walls read chronologically (X-style timeline); the Send Wall defaults to Top (most-upvoted)
        const sort = url.searchParams.get('sort') === 'new' ? 'new' : (byUser ? 'new' : 'top');
        let rows;
        if (byUser) {
          const u = db.prepare('SELECT id FROM users WHERE username = ?').get(byUser);
          if (!u) return bad(res, 'no such user', 404);
          rows = db.prepare('SELECT * FROM posts WHERE user_id = ? AND community_id IS NULL AND id < ? ORDER BY id DESC LIMIT 30').all(u.id, beforeId || Number.MAX_SAFE_INTEGER);
        } else {
          const following = feed === 'following';
          if (following && !me) return bad(res, 'sign in to see your following feed', 401);
          const base = (following // community-wall posts (community_id set) stay OFF the Send Wall / following / profile feeds
            ? 'FROM posts po JOIN follows f ON f.followee_id = po.user_id WHERE po.community_id IS NULL AND f.follower_id = ?'
            : 'FROM posts po WHERE po.community_id IS NULL')
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
        return send(res, 200, { posts: postsView(rows, me), sort });
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
        const rt = await resolveTokensInText(String(b.text || '').trim().slice(0, 500));
        const text = rt.text;
        if (!text && !image) return bad(res, 'say something or add a photo, GIF or video');
        const r = db.prepare('INSERT INTO posts (user_id, text, image, tokens, created_at) VALUES (?,?,?,?,?)').run(me.id, text, image, rt.tokens, now());
        const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(r.lastInsertRowid));
        const first = db.prepare('SELECT COUNT(*) n FROM posts WHERE user_id = ?').get(me.id).n === 1;
        const earned = awardPoints(me.id, 'post', PTS.post, 'post:' + row.id) + (first ? awardPoints(me.id, 'first_post', PTS.first_post, 'firstpost:' + me.id) : 0);
        scanWriteAction(me.id, 'post', text);
        return send(res, 200, { post: postView(row, me), pointsEarned: earned });
      }
      let m = /^\/api\/posts\/(\d+)$/.exec(p);
      if (m && req.method === 'GET') { // a single post (for deep-linking to it on the wall)
        const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(m[1]));
        if (!row) return bad(res, 'post not found', 404);
        return send(res, 200, { post: postView(row, me) });
      }
      if (m && req.method === 'DELETE') {
        if (!me) return bad(res, 'sign in first', 401);
        const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(m[1]));
        if (!row) return bad(res, 'not found', 404);
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
        if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(postId)) return bad(res, 'not found', 404);
        const existing = db.prepare('SELECT 1 FROM reactions WHERE post_id = ? AND user_id = ? AND kind = ?').get(postId, me.id, kind);
        let earned = 0;
        if (existing) db.prepare('DELETE FROM reactions WHERE post_id = ? AND user_id = ? AND kind = ?').run(postId, me.id, kind);
        else {
          db.prepare('INSERT INTO reactions (post_id, user_id, kind) VALUES (?,?,?)').run(postId, me.id, kind);
          const author = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);
          if (author && author.user_id !== me.id) { // no points for reacting to your own posts
            // dedupe by (post,user,kind) so toggling a reaction off/on can't farm points
            earned = awardPoints(me.id, 'react_give', PTS.react_give, 'react:' + postId + ':' + me.id + ':' + kind);
            awardPoints(author.user_id, 'react_get', PTS.react_get, 'reactget:' + postId + ':' + me.id + ':' + kind);
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
        const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(postId);
        if (!post) return bad(res, 'not found', 404);
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
        const rows = me
          ? db.prepare('SELECT c.id, c.text, c.tokens, c.created_at, u.username, u.avatar, u.avatar_img, u.og FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? AND c.user_id NOT IN (SELECT muted_id FROM mutes WHERE user_id = ?) ORDER BY c.id ASC LIMIT 100').all(Number(m[1]), me.id)
          : db.prepare('SELECT c.id, c.text, c.tokens, c.created_at, u.username, u.avatar, u.avatar_img, u.og FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id ASC LIMIT 100').all(Number(m[1]));
        return send(res, 200, { comments: rows.map(c => ({ ...c, tokens: parseTokens(c.tokens), avatar_img: c.avatar_img ? '/uploads/' + c.avatar_img : null, og: !!c.og })) });
      }
      if (m && req.method === 'POST') {
        if (!me) return bad(res, 'sign in to comment', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('cmt:' + me.id, 25, 6e5)) return bad(res, 'commenting too fast', 429);
        const b = await readBody(req);
        const rt = await resolveTokensInText(String(b.text || '').trim().slice(0, 300));
        const text = rt.text;
        if (!text) return bad(res, 'empty comment');
        if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(Number(m[1]))) return bad(res, 'not found', 404);
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
          og: !!u.og, // permanent OG badge (verified early buyer of $SEND/$GWC)
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
          accent: u.accent || '', posts: u.posts, followers: u.followers, og: !!u.og,
        })) });
      }

      /* ----- Send Calls ----- */
      if (p === '/api/calls/leaderboard' && req.method === 'GET') {
        maybeRefreshCalls();
        const w = url.searchParams.get('window') || 'all';
        if (!Object.prototype.hasOwnProperty.call(CALL_WINDOWS, w)) return bad(res, 'bad window');
        return send(res, 200, { window: w, top: callLeaderboard(w) });
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
        const earned = awardPoints(me.id, 'send_call', Math.round(PTS.send_call * sm), 'call:' + callId); // bigger on-chain buy → bigger Send Power
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
        if (!me) return bad(res, 'sign in to hop on', 401);
        if (blockReadOnly(res, me)) return;
        if (!rateLimit('hop:' + me.id, 40, 6e5)) return bad(res, 'slow down', 429);
        const callId = Number(cm[1]);
        const c = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
        if (!c) return bad(res, 'call not found', 404);
        if (c.user_id === me.id) return bad(res, 'that’s your own Send Call');
        const isNew = !db.prepare('SELECT 1 FROM call_hops WHERE call_id = ? AND user_id = ?').get(callId, me.id);
        const hopEntry = (c.cur_price > 0 ? c.cur_price : c.entry_price) || null; // hopper's Xs basis = the price when they hopped on
        const tHop = now();
        let earned = 0;
        if (isNew) {
          const pos = await walletTokenPosition(me.id, c.token_addr, c.pair_addr, (c.cur_price > 0 ? c.cur_price : c.entry_price)); // what this follower bought / still holds
          const spendUsd = pos.spendUsd;
          db.prepare('INSERT INTO call_hops (call_id, user_id, created_at, entry_price, last_check, spend_usd, bought_usd, held_usd) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(call_id, user_id) DO NOTHING').run(callId, me.id, tHop, hopEntry, tHop, spendUsd, pos.boughtUsd, pos.heldUsd);
          earned = awardPoints(me.id, 'hop_on', Math.round(PTS.hop_on * sizeMult(spendUsd)), 'hop:' + me.id + ':' + callId); // bigger buy-in → bigger Send Power
          notify(c.user_id, '🚀', 'Someone Sent It on your $' + c.symbol + ' Send Call!' + (spendUsd >= 100 ? ' ($' + Math.round(spendUsd) + ' in)' : ''), 'points');
        } else {
          db.prepare('INSERT INTO call_hops (call_id, user_id, created_at, entry_price, last_check) VALUES (?,?,?,?,?) ON CONFLICT(call_id, user_id) DO NOTHING').run(callId, me.id, tHop, hopEntry, tHop);
        }
        const hops = db.prepare('SELECT COUNT(*) n FROM call_hops WHERE call_id = ?').get(callId).n;
        return send(res, 200, { ok: true, hops, hopped: true, wallet: c.wallet || null, symbol: c.symbol, pointsEarned: earned });
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
        try { const o = db.prepare('SELECT og, og_revoked, og_checked_at FROM users WHERE id=?').get(me.id); if (o && !o.og && !o.og_revoked && now() - (o.og_checked_at || 0) > 6 * 3600 * 1000) await checkOg(me.id); } catch {}
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
        const moved = (rcpt.logs || []).some(l => {
          const la = (l.address || '').toLowerCase();
          if (la !== TOK.SEND && la !== TOK.GWC) return false;
          if (!l.topics || (l.topics[0] || '').toLowerCase() !== TRANSFER_TOPIC) return false;
          const party = (l.topics[1] || '').toLowerCase() === meTopic || (l.topics[2] || '').toLowerCase() === meTopic;
          let val = 0n; try { val = BigInt(l.data || '0x0'); } catch {}
          return party && val > 0n;
        });
        if (!moved) return bad(res, 'that transaction did not move any $Send or $GWC to your wallet');
        if (db.prepare('SELECT 1 FROM points_events WHERE ref = ?').get('swaptx:' + hash)) return send(res, 200, { awarded: 0, already: true });
        return send(res, 200, { awarded: awardPoints(me.id, 'swap', PTS.swap, 'swaptx:' + hash) });
      }
      if (p === '/api/leaderboard' && req.method === 'GET') {
        // The top-20 list is identical for everyone, so cache it briefly (it also runs a publicDiamond() query
        // per row). Only the per-user `me` block is computed fresh. Huge win when many users hit the board at once.
        if (!lbCache.top || now() - lbCache.at > LB_TTL) {
          const rows = db.prepare('SELECT id, username, avatar, avatar_img, accent, points, og FROM users WHERE points > 0 AND system = 0 ORDER BY points DESC, id ASC LIMIT 20').all();
          let rank = 0, prevPts = null, seen = 0; // competition ranking (ties share a rank) so it matches userRank() everywhere
          lbCache = { at: now(), top: rows.map(u => {
            seen++; if (u.points !== prevPts) { rank = seen; prevPts = u.points; }
            return { rank, username: u.username, avatar: u.avatar, avatar_img: u.avatar_img ? '/uploads/' + u.avatar_img : null, accent: u.accent || '', points: u.points, level: levelForXp(u.points), title: titleFor(levelForXp(u.points)), diamond: publicDiamond(u.id), og: !!u.og };
          }) };
        }
        return send(res, 200, { top: lbCache.top, me: me ? { rank: userRank(me.id), points: me.points, level: levelForXp(me.points) } : null });
      }

      /* ----- live new-pairs tracker (PUBLIC, server-cached, read-only on-chain data) ----- */
      if (p === '/api/pairs/new' && req.method === 'GET') {
        // ?chain=<slug> — Robinhood Chain falls through to the deep pipeline below; every other
        // supported chain is served from the Dexscreener-derived cache, with its own honest limits.
        const chainQ = String(url.searchParams.get('chain') || DEFAULT_CHAIN);
        if (chainQ !== DEFAULT_CHAIN) {
          const ch = CHAIN_BY_SLUG[chainQ];
          if (!ch) return bad(res, 'unknown chain');
          const st = foreignCache.get(chainQ) || { pairs: [], updatedAt: 0, building: false, error: null };
          if (!st.updatedAt || now() - st.updatedAt > FOREIGN_TTL) refreshForeignChain(chainQ);
          return send(res, 200, {
            chain: chainQ, chains: CHAINS,
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
        const key = pairsCache.updatedAt + '|' + shown.length + '/' + pairsCache.pairs.length + '|' + (building ? 'b' : '') + '|' + (pairsCache.pairs.length ? '' : (pairsCache.error || ''));
        if (pairsRespCache.key !== key) {
          const json = JSON.stringify({ chain: DEFAULT_CHAIN, chains: CHAINS, deep: true, pairs: shown, updatedAt: pairsCache.updatedAt, ttl: PAIRS_TTL, building, error: pairsCache.pairs.length ? null : pairsCache.error, risk: RISK_PUBLIC });
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
      if (p === '/api/pairs/contract' && req.method === 'GET') { // deep honeypot / contract-code read (lazy, cached)
        const token = String(url.searchParams.get('token') || '').toLowerCase().trim();
        const pair = String(url.searchParams.get('pair') || '').toLowerCase().trim();
        if (!/^0x[0-9a-f]{40}$/.test(token)) return bad(res, 'bad token address');
        if (!rateLimit('contract:' + clientIp(req), 60, 6e4)) return bad(res, 'slow down', 429);
        return send(res, 200, await analyzeContract(token, /^0x[0-9a-f]{40}$/.test(pair) ? pair : null));
      }
      if (p === '/api/pairs/lookup' && req.method === 'GET') {
        const token = String(url.searchParams.get('token') || '').toLowerCase().trim();
        if (!/^0x[0-9a-f]{40}$/.test(token)) return bad(res, 'enter a valid 0x token address');
        if (!rateLimit('lookup:' + clientIp(req), 60, 6e4)) return bad(res, 'too many lookups — slow down', 429);
        try {
          const r = await lookupTokenPair(token);
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
            for (const v of voters) notify(v.user_id, '\uD83D\uDDF3\uFE0F', 'New $' + c.symbol + ' proposal open for your vote: ' + pr.title, 'community');
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
            const rows = db.prepare(`SELECT cm.user_id, cm.conviction_xp, cm.qualified, cm.joined_at, u.username, u.avatar, u.avatar_img, u.og, u.accent
              FROM community_members cm JOIN users u ON u.id = cm.user_id
              WHERE cm.community_id = ? ORDER BY cm.conviction_xp DESC, cm.joined_at ASC LIMIT 200`).all(cid);
            const members = rows.map(r => {
              const lvl = levelForXp(r.conviction_xp);
              return { username: r.username, avatar: r.avatar, avatar_img: r.avatar_img ? '/uploads/' + r.avatar_img : null, og: !!r.og, accent: r.accent || '',
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
              try { holds = await holdsToken(me.id, c.token_addr); } catch { return bad(res, RPC_DOWN_MSG, 503); } // only real, on-chain-verified holders of THIS token can opt in
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
            const rows = me
              ? db.prepare('SELECT * FROM posts WHERE community_id = ? AND id < ? AND user_id NOT IN (SELECT muted_id FROM mutes WHERE user_id = ?) ORDER BY id DESC LIMIT 30').all(cid, beforeId ? Number(beforeId) : Number.MAX_SAFE_INTEGER, me.id)
              : db.prepare('SELECT * FROM posts WHERE community_id = ? AND id < ? ORDER BY id DESC LIMIT 30').all(cid, beforeId ? Number(beforeId) : Number.MAX_SAFE_INTEGER);
            return send(res, 200, { posts: postsView(rows, me), status: c.status });
          }
          if (sub === 'posts' && req.method === 'POST') {
            if (!me) return bad(res, 'sign in first', 401);
            if (blockReadOnly(res, me)) return;
            if (c.status !== 'live') return bad(res, 'this community isn’t live yet — it needs ' + LIVE_THRESHOLD + ' members', 403);
            // posting needs a VERIFIED slot (qualified=1), not just a membership row — the anti-sybil caps must gate the wall too, exactly as the opt-in copy promises
            if (!db.prepare('SELECT 1 FROM community_members WHERE community_id=? AND user_id=? AND qualified=1').get(cid, me.id)) return bad(res, 'posting needs a verified holder slot — opt in (and re-verify if your slot was paused) to post on this wall', 403);
            if (!c.demo) {   // the sandbox has no token to hold, so the holding gate does not apply there
              let holdsP; try { holdsP = await holdsToken(me.id, c.token_addr); } catch { return bad(res, RPC_DOWN_MSG, 503); }
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
            const info = db.prepare('INSERT INTO posts (user_id, text, image, score, created_at, community_id, tokens) VALUES (?,?,?,?,?,?,?)').run(me.id, text, image, 0, now(), cid, rt.tokens);
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
            return send(res, 200, { snapshots: rows.map(s => snapshotView(s, false)) });   // newest first
          }
          if (sub === 'snapshots' && req.method === 'POST') {
            if (!me) return bad(res, 'sign in first', 401);
            if (blockReadOnly(res, me)) return;
            if (c.status !== 'live') return bad(res, 'this community is not live yet', 403);
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

// OG sweep: re-read on-chain holdings for OGs (stalest first) so a full sell-out is caught — badge + 10× removed —
// even if they never re-open the site, and so active OGs stay "fresh" enough to keep the bonus. refreshHolder()
// revokes on a confirmed full sell-out. Bounded per tick (a worker/queue is the real answer at large scale).
const OG_SWEEP_CAP = 25;
let ogSweeping = false;
const ogTimer = setInterval(async () => {
  if (ogSweeping) return; ogSweeping = true;
  try {
    const rows = db.prepare('SELECT u.id FROM users u LEFT JOIN holder_state h ON h.user_id = u.id WHERE u.og = 1 ORDER BY COALESCE(h.last_check, 0) ASC LIMIT ?').all(OG_SWEEP_CAP);
    for (const r of rows) { try { await refreshHolder(r.id); } catch {} }
  } catch {} finally { ogSweeping = false; }
}, 10 * 60 * 1000);
ogTimer.unref();

// Re-verify qualified community members still hold the community's token; revoke the 10× on a sell / recycled-bag move.
const commHolderTimer = setInterval(() => { sweepCommunityHolders().catch(() => {}); }, 10 * 60 * 1000);
// Close proposals whose round has ended, even if nobody visits that community. Cheap: idx_prop_due
// is a PARTIAL index over rows that still have a deadline, so a settled proposal costs nothing.
const propTimer = setInterval(() => { try { resolveDueProposals(null); } catch {} }, 60 * 1000);
propTimer.unref();
commHolderTimer.unref();

// Reap upload-then-abandon media (never attached to a post) so they don't leak disk + quota.
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
  if (prod) {
    if (BASE_URL.includes('localhost')) warn('BASE_URL is still localhost — OAuth redirects and Secure cookies will be wrong in production. Set BASE_URL=https://yourdomain.');
    if (!IS_HTTPS && process.env.COOKIE_SECURE !== '1') warn('Serving over http and COOKIE_SECURE!=1 — session cookies will NOT be marked Secure. Set COOKIE_SECURE=1 behind TLS termination.');
    if (!TRUST_PROXY_HOPS) warn('TRUST_PROXY unset — behind a reverse proxy, rate limits & the community anti-sybil gate will key on the proxy IP, not real clients. Set TRUST_PROXY to your proxy hop count (1 for a single proxy).');
  }
}

server.listen(PORT, () => { console.log(`🚀 JustSendIt running at ${BASE_URL}`); productionChecks(); setTimeout(() => { seedOfficialCommunities().then(seedDemoCommunity).catch(() => {}); }, 2500).unref(); });

// New Pairs Radar is hidden (unlinked from the nav) — no background refresher runs so we don't hit the
// RPC/Blockscout/Dexscreener every 90s for a page nobody can reach. The /api/pairs/new endpoint still
// lazy-builds on first request, so re-linking the page in the nav brings it fully back with no other change.
// To re-enable continuous background refresh, restore:
//   pairsCache.building = true; refreshPairs().catch(() => {});
//   setInterval(() => { refreshPairs().catch(() => {}); }, PAIRS_TTL);
