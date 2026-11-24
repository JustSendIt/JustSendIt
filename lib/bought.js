'use strict';
/* ===== "$100 bought", the server's side (owner, 2026-11-17) ============================================================
   Owner: "make it $100 of value bought in the token not the current token value, and change that rule across the platform"
   — "make sure transfers do not count as buy but instead follow the transactions back to the original buy on-chain and make
   sure the buy date is correct for all users". Answers: "Count a buy after 24 h held", "At least $10 of it, at cost", "One
   other account per wallet; $100 to set date", "Switch on at once".

   The three parts below this file do the work and are tested on their own: lib/tape.js reads a coin's Transfers and its
   pools' Swap/Mint/Burn (and the WETH/USDG pair's Sync) and keeps them; lib/ethusd.js turns those Syncs into dollars per
   ETH at any block; lib/acquire.js answers, for one member and one coin, what they BOUGHT. This file joins them to the
   server, which hands it its database, its node readers (through createTape), its keys and the members' wallets:

     · which coins have a tape (bought_tokens): $SEND and $GWC always; a community's or a Send Call's token once someone
       needs its answer, while its ledger is small enough to keep (lib/tape.js TAPE_MAX_TRANSFERS) and its pool is one the
       tape reads. Any other coin has no answer here — never a no.
     · the tape's tick (tick): the coins' ledgers moved forward (the server's indexHolders; ledgerApply appends their
       Transfers to the tape in its own transaction), every stream walked from its cursor, the Swap blocks dated, and the
       ETH/USD grid folded from the pair's Syncs (ethusd_cells; the raw Syncs of a closed cell are not kept after it).
       Paced through the server's shared pace, at its weights, standing down on the node's first refusal.
     · the verdicts (acq_state): one row per (member, coin), written by the worker in the background — never by a request.
       A request reads the row (stateOf / verdictOf) and nothing else: no chain read, no engine run. A row is the answer
       for the wallets linked when it was written (wallets_sig: the identities' ids) under this rule (rule_v); a row for
       another wallet set or rule is no answer, and the worker is asked for a new one.
     · claims (buy_claims): "one other account per wallet" — written with every positive verdict, never released.

   Unknown is never a no. A coin with no tape, a tape not read far enough, a buy whose dollars could not be read: the
   verdict is null with a reason, and the server keeps whatever status the member had (a status they did not have is
   not granted on a null). Wallet addresses are kept only encrypted or as blind indexes; figures a member's wallet could be
   found from (exact dollars, wei, dates) only encrypted.

   READ TO THE SETTLED HEAD (2026-11-18, after the first switch-on was rolled back). The verdicts were made on a tape whose
   back-fill had read $SEND's Transfers to block 55,959,999 while the ledger's appends sat at the head (117,253,605) in a
   stretch of their own: the lowest stream was taken for "how far the tape reaches", and any reach at all for "ready", so the
   engine was handed the coin's first 56M blocks as if they were all of it — and members who bought later were told their
   linked wallets held none. Now:
     · a coin has no verdict at all (nothing written, null: every status stands) until EVERY stream its verdicts read is read
       to the settled head (readiness): its Transfers (the back-fill joined to the ledger's appends — transfersThrough), each
       pool's Swap, Mint and Burn, the WETH/USDG pair's Syncs and the ETH/USD grid folded from them, and every Swap block
       dated. The settled head is the chain's head as the tape's last walk read it, less the settle margin — read within
       HEAD_FRESH_MS, and never further behind the ledger's own head than the margin and HEAD_SLACK. A verdict is made at
       the lowest of those streams (all at or past the settled head), with each pool's own cursor as the engine's coverage,
       so a row up to the verdict's block is never missing and none after it is read: "complete" means complete at the head;
     · the held amount a verdict found must equal the ledger's balance of the same wallets (ledgerCheck — holder_balances,
       folded from the same Transfers on another path): a difference is no answer (null, 'ledger-mismatch', counted on
       /admin), never "holds none";
     · the rule moved to 2: every verdict made under rule 1 is deleted at boot (its figures came from the half-read tape),
       and the switch's log notes which rule decided each row, and whether its loss note went out (server.js holdLog). ===== */
const ethusd = require('./ethusd.js');
const acquire = require('./acquire.js');
const tapeLib = require('./tape.js');

/* The rule a verdict was made under: a row from another is no answer (re-made by the worker). 2 (2026-11-18): only on a tape read
   to the settled head, its held amount checked against the ledger — rule 1's rows were made from a half-read tape and go at boot. */
const RULE_V = 2;
const DAY_MS = 864e5;
const LIMITS = Object.freeze({
  MIN_USD: acquire.LIMITS.MIN_HOLD_USD,          // $100 bought
  HELD_MIN_USD: acquire.LIMITS.HELD_COST_MIN_USD, // $10 still held, at cost
  TAPE_MAX_TRANSFERS: tapeLib.LIMITS.TAPE_MAX_TRANSFERS,
  TICK_READS: 80,                    // requests one tape tick may make (the back-fill is many ticks of this; the tail is a few)
  DATE_MAX: 250,                     // Swap blocks dated in one tick
  WORK_MAX: 20,                      // (member, coin) verdicts one worker pass makes
  NEED_BLOCKS_MAX: 150,              // block times one verdict may ask for before it is written as it stands (and asked again)
  RETRY_MS: [15 * 60e3, 3600e3, 6 * 3600e3],   // a transient unknown is asked again after 15 min, 1 h, then every 6 h (H11)
  RECHECK_MS: 6 * 3600e3,            // a settled verdict is re-made this often all the same (claims elsewhere, a pool stream that moved)
  TAPE_WAIT_MS: 5 * 60e3,            // a coin whose tape is not ready: asked again after this
  HEAD_FRESH_MS: 15 * 60e3,          // the chain's head as the tape's last walk read it: older than this, no coin is "read to the head"
  POOLS_REFRESH_MS: 24 * 3600e3,     // a coin with pools: asked again daily (a pool made later is added)
  POOLS_RETRY_MS: 3600e3,            // a coin with none: asked again hourly, never every tick
  HEAD_SLACK: 3000,                  // blocks the settled head may trail the ledger's head beyond the settle margin (two node reads a tick apart)
  STATE_LOTS_MAX: 2000,              // counted buys kept per row (their arrival time and dollars: a Send Call's size before it)
});

/* ===== tables ===== */
function migrate(db) {
  tapeLib.migrate(db);
  db.exec(`
-- which coins have a tape, and their pools: { pool: { tokenIsZero, quote: 'WETH'|'USDG'|symbol, quoteDecimals } } (public chain facts)
CREATE TABLE IF NOT EXISTS bought_tokens (
  token       TEXT PRIMARY KEY,
  pools       TEXT,                    -- JSON, NULL until read
  decimals    INTEGER,
  state       TEXT NOT NULL,           -- 'pending' | 'ok' | 'too-big' | 'no-pool' | 'error'
  why         TEXT,
  core        INTEGER NOT NULL DEFAULT 0,   -- 1: $SEND / $GWC (always kept)
  wanted_at   INTEGER,                 -- the last time a member needed its answer (a coin nobody asks about leaves the tape)
  at          INTEGER NOT NULL
);
-- the ETH/USD grid's cells (lib/ethusd.js): pts = JSON [[block, logIndex, micro|null]], one per block
CREATE TABLE IF NOT EXISTS ethusd_cells (
  ci          INTEGER PRIMARY KEY,
  pts         TEXT NOT NULL,
  at          INTEGER NOT NULL
);
/* A member's verdict on one coin, for the wallets linked when it was made (wallets_sig: their identities.id, in order — not a
   key-derived value). Plain: the verdict (1 bought ≥ $100 with ≥ $10 still held at cost, 0 not, NULL no answer yet), the
   spent figure to the $10 below (spent_bucket), why an answer is missing ('transient' | 'structural') and a reason code.
   Everything else — exact dollars, wei, dates, the buys — is encrypted (lib/keys.js ENC_FIELDS). */
CREATE TABLE IF NOT EXISTS acq_state (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  token       TEXT NOT NULL,
  wallets_sig TEXT NOT NULL,
  rule_v      INTEGER NOT NULL,
  block       INTEGER,                 -- the tape block the verdict was made at
  verdict     INTEGER,
  spent_bucket INTEGER,
  why         TEXT,
  reason_code TEXT,
  complete    INTEGER NOT NULL DEFAULT 0,
  due_at      INTEGER,                 -- made again at or after this (a buy maturing, an unknown retried)
  dirty       INTEGER NOT NULL DEFAULT 0,   -- the member's wallets moved this coin, or their wallet set changed: made again soon
  conflicts   INTEGER NOT NULL DEFAULT 0,   -- origins this verdict could not use: already counted for another account (a count, nothing else)
  tries       INTEGER NOT NULL DEFAULT 0,
  lots_enc    TEXT,
  cursors_enc TEXT,
  dates_enc   TEXT,
  wei_enc     TEXT,
  at          INTEGER NOT NULL,
  UNIQUE (user_id, token)
);
CREATE INDEX IF NOT EXISTS idx_acq_due ON acq_state(dirty, due_at);
CREATE INDEX IF NOT EXISTS idx_acq_token ON acq_state(token, verdict);
/* One other account per wallet (owner, 2026-11-17): which account a wallet's buys of a coin back. origin_idx: the blind index
   of the wallet that bought; via_idx: of the member's own wallet a traced buy reached them through (NULL: the member's own
   wallet bought). INSERTed with a positive verdict, never released — kept on account deletion, like og_claims. */
CREATE TABLE IF NOT EXISTS buy_claims (
  id          INTEGER PRIMARY KEY,
  token       TEXT NOT NULL,
  origin_idx  TEXT NOT NULL,
  user_id     INTEGER NOT NULL,
  via_idx     TEXT,
  at          INTEGER NOT NULL,
  UNIQUE (token, origin_idx, user_id)
);
CREATE INDEX IF NOT EXISTS idx_buy_claims_user ON buy_claims(user_id);
/* What the switch to "$100 bought" changed, per member and feature (owner: "Switch on at once" — still logged, and counted on
   /admin). was / became: the status under the old rule and under this one; reason: the reason code. No wallet, no figure. */
CREATE TABLE IF NOT EXISTS hold_migration_log (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  feature     TEXT NOT NULL,
  was         TEXT,
  became      TEXT,
  reason      TEXT,
  at          INTEGER NOT NULL,
  rule_v      INTEGER,                 -- the rule that decided it (NULL: rule 1, from verdicts made on a half-read tape — replaced by the first decision under this one)
  noted       INTEGER NOT NULL DEFAULT 0,   -- 1: the member was told of this loss (never told twice)
  UNIQUE (user_id, feature)
);
`);
  /* 2026-11-18: a log from before the fix gets its two columns. Its rows are rule 1's (rule_v NULL); a loss among them was
     told at the time (holder:… and community:… rows went 1 → 0 only with a note), so it is marked noted — the first decision
     under rule 2 replaces the row and tells nobody twice. Returned, so the server resets what it marked with rule 1 too. */
  const cols = db.prepare('PRAGMA table_info(hold_migration_log)').all().map((c) => c.name);
  const upgraded = !cols.includes('rule_v');
  if (upgraded) db.exec('ALTER TABLE hold_migration_log ADD COLUMN rule_v INTEGER');
  if (!cols.includes('noted')) {
    db.exec('ALTER TABLE hold_migration_log ADD COLUMN noted INTEGER NOT NULL DEFAULT 0');
    db.prepare("UPDATE hold_migration_log SET noted = 1 WHERE was = '1' AND became = '0' AND (feature LIKE 'holder:%' OR feature LIKE 'community:%')").run();
  }
  // verdicts made under an older rule: no answer (stateOf), and rule 1's figures came from a half-read tape — they go
  const dropped = db.prepare('DELETE FROM acq_state WHERE rule_v < ?').run(RULE_V).changes;
  return { logUpgraded: upgraded, dropped };
}

const lc = (a) => String(a == null ? '' : a).toLowerCase();
const isAddr = (a) => /^0x[0-9a-f]{40}$/.test(a);
const hx = (n) => '0x' + n.toString(16);
const bucket = (usd) => (Number.isFinite(usd) ? Math.floor(usd / 10) * 10 : null);
const jparse = (s) => { try { return JSON.parse(s); } catch { return null; } };

/* Pure: the stretches the linked wallets held more than dust of a coin, summed ([fromMs, toMs | null = still holding]) — what
   the OG restore pass asks ("held without a break since then?"). rows: the wallets' Transfers in chain order; times: block →
   ms. Coins moving between the linked wallets in one block leave no gap (a moment is judged by its last row). Returns
   { spans } or { spans: null, need: [blocks with no stored time] }. */
function heldSpans(rows, linked, times, dust) {
  const set = new Set([...linked].map(lc));
  let bal = 0n;
  const marks = [], need = new Set();
  for (const r of rows) {
    const f = set.has(r.from), t = set.has(r.to);
    if (f === t) continue;                                  // between two linked wallets (or neither): not a move of the account
    bal += t ? r.value : -r.value;
    const ms = times.get(r.block);
    if (ms == null) need.add(r.block);
    marks.push([r.block, ms, bal > dust ? 1 : 0]);
  }
  if (need.size) return { spans: null, need: [...need] };
  const spans = [];
  for (let i = 0; i < marks.length; i++) {
    if (i + 1 < marks.length && marks[i + 1][0] === marks[i][0]) continue;   // a later row in the same block decides it
    const open = spans.length > 0 && spans[spans.length - 1][1] === null;
    if (marks[i][2] && !open) spans.push([marks[i][1], null]);
    else if (!marks[i][2] && open) spans[spans.length - 1][1] = marks[i][1];
  }
  return { spans };
}

/* Pure: the reason code a verdict is stored with (the copy is the caller's: H13 "a reason code column, not copy text"). */
function reasonOf(r) {
  if (!r) return 'none';
  if (r.floor === true) return 'ok';
  if (r.floor === null) return r.why === 'structural' ? 'unknown-structural' : 'unknown';
  if (r.conflicts && r.conflicts.length && !(r.spentUsd >= LIMITS.MIN_USD)) return 'conflict';   // the buys are counted for another account
  if (BigInt(r.heldWei || '0') <= 0n && !(r.spentUsd > 0)) return 'none-held';
  if (r.spentUsd < LIMITS.MIN_USD) return r.pendingUsd > 0 ? 'short-spent-pending' : 'short-spent';
  return 'short-held';
}

/* ===== the module ===== */
/* deps:
     db, now()
     tape                 createTape(...)'s instance (the server's readers, pace, cool-down, crypto, factories)
     enc(s) / dec(s)      encField / decField     idx(s)  bidx
     coins                { SEND: token, GWC: token } (core coins; their pools are given as pools[token])
     corePools            { [token]: [pool, …] }  the official pairs (more are found by poolsFor)
     diamond              { from, until }        $GWC's first month (the core coins' Diamond question)
     wallets(uid)         [{ id, addr }]          the member's linked wallets, oldest first (identities, decrypted)
     followed(uid, token) [addr]                  wallets Diamond Hands follows for them in this coin (core coins only)
     refreshLedger(token) async                   the server's indexHolders (its batches append to the tape in ledgerApply)
     ledger(token)        { status, firstBlock, lastBlock, logs, consistent, decimals } | null   (holder_index, sync)
     poolsFor(token)      async → [{ pool, tokenIsZero, quote, quoteDecimals }]   the coin's v2 pools (factory pairs)
     plumbing()           { fees, routers }       bundle_plumbing's learned routers and fee wallets (sync)
     sys                  [addresses]             the v2 router, the factory, WETH (server.js isSystemAddr)
     claimedElsewhere(uid, wallet) → bool         og_claims / gate_claims of another account on this wallet (sync)
     onVerdict(uid, token, before, after)         after a verdict is written (sync; the server applies it)
     log(msg)                                                                                              */
function createBought(deps) {
  const { db } = deps;
  const now = deps.now || Date.now;
  const log = deps.log || (() => {});
  migrate(db);
  const CORE = Object.values(deps.coins || {}).map(lc);
  const PAIR = ethusd.PAIR.address;
  const SYNC_KEY = 'pool:' + PAIR + ':Sync';
  const FOLD_KEY = 'ethusd:folded';
  const HEAD_KEY = 'bought:settled';   // the chain's head less the settle margin, as the tape's last walk read it (block), and when (at)
  for (const t of CORE) db.prepare(`INSERT INTO bought_tokens (token, state, core, at) VALUES (?, 'pending', 1, ?) ON CONFLICT(token) DO UPDATE SET core = 1`).run(t, now());

  /* ----- the coins on the tape ----- */
  function tokenRow(token) {
    const r = db.prepare('SELECT * FROM bought_tokens WHERE token = ?').get(lc(token));
    if (!r) return null;
    return { token: r.token, pools: jparse(r.pools), decimals: r.decimals, state: r.state, why: r.why, core: !!r.core, wantedAt: r.wanted_at, at: r.at };
  }
  // a community's or a Send Call's coin: kept on the tape while someone needs its answer (the tick decides whether it can be)
  function wantToken(token) {
    const t = lc(token); if (!isAddr(t)) return;
    db.prepare(`INSERT INTO bought_tokens (token, state, wanted_at, at) VALUES (?, 'pending', ?, ?) ON CONFLICT(token) DO UPDATE SET wanted_at = excluded.wanted_at`).run(t, now(), now());
  }
  const poolList = (row) => (row && row.pools ? Object.keys(row.pools) : []);

  /* ----- the ETH/USD grid ----- */
  let cells = null, grid = null;
  function loadCells() {
    if (cells) return cells;
    cells = new Map();
    for (const r of db.prepare('SELECT ci, pts FROM ethusd_cells').all()) { const pts = jparse(r.pts); if (Array.isArray(pts)) cells.set(r.ci, { ci: r.ci, size: ethusd.CELL, pts }); }
    return cells;
  }
  function gridNow() {
    if (grid) return grid;
    const c = tapeLib.cursorGet(db, FOLD_KEY);
    if (!c) return null;
    try { grid = ethusd.buildGrid(loadCells(), { from: 0, to: c.block, origin: true }); } catch (e) { log('ethusd grid: ' + e.message); grid = null; }
    return grid;
  }
  // the pair's Syncs read since the last fold go into the cells; a cell that has closed keeps no raw Syncs (its points are kept)
  function foldEthUsd() {
    const read = tapeLib.cursorGet(db, SYNC_KEY), done = tapeLib.cursorGet(db, FOLD_KEY);
    if (!read || (done && done.block >= read.block)) return { folded: 0 };
    const from = done ? done.block + 1 : 0;
    const rows = tapeLib.poolRows(db, PAIR, { kinds: ['Sync'], fromBlock: from, toBlock: read.block });
    const m = loadCells();
    const logs = rows.map((r) => ({ address: PAIR, topics: [ethusd.SYNC_TOPIC], data: r.data, blockNumber: r.block, logIndex: r.i, transactionHash: r.tx }));
    const res = ethusd.foldCells(m, logs);
    const touched = new Set(rows.map((r) => ethusd.cellOf(r.block)));
    db.exec('BEGIN');
    try {
      const put = db.prepare('INSERT INTO ethusd_cells (ci, pts, at) VALUES (?,?,?) ON CONFLICT(ci) DO UPDATE SET pts = excluded.pts, at = excluded.at');
      for (const ci of touched) { const c = m.get(ci); if (c) put.run(ci, JSON.stringify(c.pts), now()); else db.prepare('DELETE FROM ethusd_cells WHERE ci = ?').run(ci); }
      tapeLib.cursorSet(db, FOLD_KEY, read.block, now(), 0);
      // a closed cell's Syncs are all in its points now: the raw rows go (the open cell's stay until it closes)
      const openFrom = ethusd.cellSpan(ethusd.cellOf(read.block)).from;
      db.prepare("DELETE FROM pool_events WHERE pool = ? AND kind = 'Sync' AND block < ?").run(PAIR, Math.min(openFrom, read.block + 1));
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
    grid = null;
    return { folded: res.n };
  }
  const NOT_READ = Object.freeze({ v: null, why: 'the ETH/USD history is not read yet', code: 'not-read-yet', kind: 'transient' });
  const ethUsdAt = (b) => { const g = gridNow(); return g ? ethusd.ethUsdAt(g, b) : NOT_READ; };

  /* ----- block times (all of them that are kept: a few thousand rows) ----- */
  let times = null, timesN = -1;
  function blockTimes() {
    const n = db.prepare('SELECT COUNT(*) n FROM block_times').get().n;
    if (times && n === timesN) return times;
    times = new Map(); for (const r of db.prepare('SELECT block, ts FROM block_times').all()) times.set(r.block, r.ts);
    timesN = n;
    return times;
  }

  /* ----- is a coin's tape read to the settled head? (2026-11-18: see the header) ----- */
  // the walk's settled head, kept with the time it was read (a walk stopped by its budget still read the head)
  function recordHead(settled) {
    if (!Number.isSafeInteger(settled) || settled < 0) return;
    db.prepare('INSERT INTO tape_cursor (stream, block, since, at) VALUES (?, ?, NULL, ?) ON CONFLICT(stream) DO UPDATE SET block = MAX(tape_cursor.block, excluded.block), at = excluded.at')
      .run(HEAD_KEY, settled, now());
  }
  /* The block every stream of this coin must reach: the chain's head as the last walk read it, less the settle margin — and
     never further behind the coin's ledger (holder_index, read at the head) than the margin and HEAD_SLACK, so a walk that
     has not run for a while cannot make an old block look like the head. null with why when the head is not known. */
  function settledHead(t) {
    const seen = tapeLib.cursorGet(db, HEAD_KEY);
    if (!seen) return { block: null, why: 'the chain’s head has not been read yet' };
    if (now() - seen.at > LIMITS.HEAD_FRESH_MS) return { block: null, why: 'the chain’s head was last read ' + Math.round((now() - seen.at) / 60e3) + ' min ago' };
    const lg = deps.ledger ? deps.ledger(t) : null;
    if (!lg || !Number.isSafeInteger(lg.lastBlock) || lg.lastBlock <= 0) return { block: null, why: 'this coin’s ledger is not read yet' };
    return { block: Math.max(seen.block, lg.lastBlock - tapeLib.LIMITS.SETTLE_BLOCKS - LIMITS.HEAD_SLACK), ledger: lg.lastBlock };
  }
  const needsEthUsd = (row) => Object.values(row.pools || {}).some((p) => String(p.quote || '').toUpperCase() === 'WETH');
  // every stream a verdict on this coin reads → the block it is complete through (null: never read)
  function streamsOf(row) {
    const s = { transfers: tapeLib.transfersThrough(db, row.token) };   // the back-fill and the ledger's appends, only where they join
    for (const p of poolList(row)) for (const k of tapeLib.POOL_KINDS) { const c = tapeLib.cursorGet(db, 'pool:' + p + ':' + k); s['pool ' + p + ' ' + k] = c ? c.block : null; }
    if (needsEthUsd(row)) {
      const r = tapeLib.cursorGet(db, SYNC_KEY), f = tapeLib.cursorGet(db, FOLD_KEY);
      s['ETH/USD Syncs'] = r ? r.block : null;
      s['ETH/USD grid'] = f ? f.block : null;
    }
    return s;
  }
  const undatedQ = db.prepare(`SELECT 1 FROM pool_events e WHERE e.pool = ? AND e.kind = 'Swap' AND e.block <= ?
    AND NOT EXISTS (SELECT 1 FROM block_times t WHERE t.block = e.block) LIMIT 1`);
  /* { ready: true, row, block, target, streams } — every stream at or past the settled head, every Swap block up to `block`
     (the lowest stream: where the verdict is made) dated — or { ready: false, code, why }. Nothing else may make a verdict. */
  function readiness(token) {
    const row = tokenRow(token);
    if (!row || row.state !== 'ok') return { ready: false, code: row && (row.state === 'too-big' || row.state === 'no-pool') ? row.state : 'tape', why: row ? (row.why || 'this coin is not on the tape yet (' + row.state + ')') : 'this coin is not on the tape' };
    const pools = poolList(row);
    if (!pools.length) return { ready: false, code: 'no-pool', why: 'no pool this tape reads' };
    for (const p of pools) {
      const k = tapeLib.poolKindGet(db, p);
      if (!k || !k.kind) return { ready: false, code: 'tape', why: 'pool ' + p + (k ? ' is not one this tape reads (' + k.why + ')' : ' is not checked yet') };
    }
    const target = settledHead(row.token);
    if (target.block == null) return { ready: false, code: 'head-unknown', why: target.why };
    const streams = streamsOf(row);
    const behind = Object.entries(streams).filter(([, b]) => b == null || b < target.block);
    if (behind.length) return { ready: false, code: 'tape-behind', target: target.block, streams, why: 'not read to the settled head (block ' + target.block + ') yet: ' + behind.map(([k, b]) => k + (b == null ? ' not read' : ' through block ' + b)).join(', ') };
    const block = Math.min(...Object.values(streams));
    const undated = pools.filter((p) => undatedQ.get(p, block));
    if (undated.length) return { ready: false, code: 'undated', target: target.block, streams, why: 'Swap blocks not dated yet (pool ' + undated.join(', ') + ')' };
    return { ready: true, row, block, target: target.block, streams };
  }

  /* ----- one coin's tape at the block a verdict is made (readiness), indexed once (lib/acquire.js buildIndex), shared ----- */
  const indexes = new Map();   // token → { key, idx, block }
  function indexFor(row, rd) {
    const X = rd.block;
    const pl = deps.plumbing ? deps.plumbing() : null;
    const key = X + ':' + (pl ? pl.fees.size + pl.routers.size : 0);   // buildIndex reads no block times: a block dated since does not rebuild it
    const hit = indexes.get(row.token);
    if (hit && hit.key === key) return hit;
    const pools = row.pools || {};
    // the engine's coverage is each pool's own cursor, and nothing is read past X: asked of the cursors again here, so an index
    // can never be built over a stretch some stream has not read (a row there would be taken for one that does not exist)
    const cursors = {};
    for (const p of Object.keys(pools)) cursors[p] = Math.min(...tapeLib.POOL_KINDS.map((k) => { const c = tapeLib.cursorGet(db, 'pool:' + p + ':' + k); return c ? c.block : -1; }));
    const tf = tapeLib.transfersThrough(db, row.token);
    if (tf == null || tf < X || Object.values(cursors).some((c) => c < X)) throw new Error('the tape is not read to block ' + X);
    const tapeRows = tapeLib.tapeRows(db, row.token, { toBlock: X });
    const poolEvents = [];
    for (const p of Object.keys(pools)) poolEvents.push(...tapeLib.poolRows(db, p, { kinds: tapeLib.POOL_KINDS, toBlock: X }));
    const idx = acquire.buildIndex({
      token: row.token, tapeRows, poolEvents, pools, sys: deps.sys || [], decimals: Number.isInteger(row.decimals) ? row.decimals : 18,
      coverage: (b, tx, p) => cursors[p] != null && b <= cursors[p] && b <= X,
    });
    // what bundle_plumbing learned on other coins' reads, beside what this tape teaches (a fee wallet or router seen once elsewhere)
    if (pl) { for (const a of pl.fees) idx.plumbing.fees.add(lc(a)); for (const a of pl.routers) idx.plumbing.routers.add(lc(a)); }
    const v = { key, idx, block: X };
    indexes.set(row.token, v);
    return v;
  }

  // a member's own Transfers of a coin, up to block X: through each wallet's index, not the whole tape filtered here
  function ownRows(t, linked, X) {
    const seen = new Map();
    for (const w of linked) for (const x of tapeLib.tapeRows(db, t, { wallet: w, toBlock: X })) seen.set(x.block + ':' + x.i, x);
    return [...seen.values()].sort((a, b) => a.block - b.block || a.i - b.i);
  }
  /* ----- defence in depth: the held amount against the ledger (2026-11-18) -----
     The holder ledger folds the same Transfers on its own path (server.js ledgerApply → holder_balances) and is read at the
     head; its appends to the tape go in the same transaction as its balances. So the ledger's balance of the wallets, taken
     back to the verdict's block with the tape's Transfers between the two, must be exactly what the verdict found held. null
     when it is; else { code, why } — the verdict is then no answer (null, its reason on /admin), never "holds none". */
  function ledgerCheck(token, addrs, X, heldWei) {
    const lb = deps.balances ? deps.balances(token, addrs) : null;
    if (!lb || !Number.isSafeInteger(lb.block) || typeof lb.wei !== 'bigint') return { code: 'ledger-missing', why: 'no ledger balance to check the held amount against' };
    if (lb.block < X) return { code: 'ledger-behind', why: 'the ledger is read to block ' + lb.block + ', behind the verdict’s block ' + X };
    const tf = tapeLib.transfersThrough(db, token);
    if (tf == null || tf < lb.block) return { code: 'ledger-ahead', why: 'the ledger has read Transfers the tape has not kept yet' };
    const set = new Set(addrs.map(lc));
    let d = 0n;
    if (lb.block > X) {
      const seen = new Set();
      for (const a of set) for (const r of tapeLib.tapeRows(db, token, { wallet: a, fromBlock: X + 1, toBlock: lb.block })) {
        const k = r.block + ':' + r.i; if (seen.has(k)) continue; seen.add(k);
        const f = set.has(r.from), t = set.has(r.to);
        if (t && !f) d += r.value; else if (f && !t) d -= r.value;
      }
    }
    let held; try { held = BigInt(heldWei == null ? 'x' : heldWei); } catch { return { code: 'ledger-mismatch', why: 'the verdict found no held amount to check' }; }
    if (lb.wei - d !== held) return { code: 'ledger-mismatch', why: 'the held amount the tape shows disagrees with the ledger’s balance of the same wallets' };
    return null;
  }

  // a wallet linked to another account, or whose OG badge or verification backs one (a read that fails counts as theirs)
  const otherLinkQ = db.prepare("SELECT 1 FROM identities WHERE type = 'wallet' AND identifier = ? AND user_id <> ? LIMIT 1");
  function ownedElsewhere(uid, addr) {
    try { if (otherLinkQ.get(deps.idx(lc(addr)), uid)) return true; } catch { return true; }
    return !!(deps.claimedElsewhere && deps.claimedElsewhere(uid, addr));
  }
  /* ----- claims: "one other account per wallet" (Q3), and a wallet whose badge or door backs another account (H5) ----- */
  function claimsFor(uid, token) {
    const own = db.prepare('SELECT user_id FROM buy_claims WHERE token = ? AND origin_idx = ? AND via_idx IS NULL AND user_id <> ? LIMIT 1');
    const any = db.prepare('SELECT user_id, via_idx FROM buy_claims WHERE token = ? AND origin_idx = ?');
    return (origin, { own: isOwn }) => {
      const oi = deps.idx(lc(origin));
      if (isOwn) {
        // the member's own wallet: its buys are theirs — unless another account already counted them as ITS own, or the wallet's
        // OG badge or verification backs another account (claims outlive unlinking: the wallet moved, the buys did not)
        if (own.get(token, oi, uid)) return 'other';
        if (deps.claimedElsewhere && deps.claimedElsewhere(uid, origin)) return 'other';
        return 'mine';
      }
      // a traced buy: the origin's own account always keeps its buys; ONE other account may count them
      const rows = any.all(token, oi);
      if (rows.some((r) => r.user_id === uid)) return 'mine';
      if (rows.some((r) => r.user_id !== uid && r.via_idx != null)) return 'other';
      return 'free';
    };
  }
  /* Taken since the engine read the claims (block times are read in between): an origin this verdict needs that another account
     now counts as its own, or that another account now counts as traced — one origin would back two other accounts. */
  function claimTaken(uid, token, r, linked) {
    const ownQ = db.prepare('SELECT 1 FROM buy_claims WHERE token = ? AND origin_idx = ? AND via_idx IS NULL AND user_id <> ? LIMIT 1');
    const tracedQ = db.prepare('SELECT 1 FROM buy_claims WHERE token = ? AND origin_idx = ? AND via_idx IS NOT NULL AND user_id <> ? LIMIT 1');
    for (const o of r.needs || []) {
      const origin = lc(o), oi = deps.idx(origin);
      if (linked.has(origin) ? (ownQ.get(token, oi, uid) || (deps.claimedElsewhere && deps.claimedElsewhere(uid, origin))) : tracedQ.get(token, oi, uid)) return true;
    }
    return false;
  }
  // the origins a positive verdict needs, written with it (INSERT OR IGNORE: a claim already ours stays as it was)
  function writeClaims(uid, token, r, linked) {
    const ins = db.prepare('INSERT OR IGNORE INTO buy_claims (token, origin_idx, user_id, via_idx, at) VALUES (?,?,?,?,?)');
    for (const o of r.needs || []) {
      const origin = lc(o);
      const isOwn = linked.has(origin);
      let via = null;
      if (!isOwn) { const lot = (r.lots || []).find((x) => lc(x.origin) === origin && x.via === 'traced' && x.wallet); via = lot ? deps.idx(lc(lot.wallet)) : null; }
      ins.run(token, deps.idx(origin), uid, isOwn ? null : (via || deps.idx('traced')), now());   // a traced claim always names a via (it is what marks "the other account")
    }
  }

  /* ----- a member's state, as a request reads it (no chain, no engine) ----- */
  function sigOf(ws) { return ws.map((w) => w.id).join(','); }
  function decode(r) {
    if (!r) return null;
    const lots = jparse(r.lots_enc ? deps.dec(r.lots_enc) : 'null') || {};
    const dates = jparse(r.dates_enc ? deps.dec(r.dates_enc) : 'null') || {};
    const wei = jparse(r.wei_enc ? deps.dec(r.wei_enc) : 'null') || {};
    return { userId: r.user_id, token: r.token, sig: r.wallets_sig, ruleV: r.rule_v, block: r.block, verdict: r.verdict == null ? null : !!r.verdict,
             floor: r.verdict == null ? null : !!r.verdict, spentBucket: r.spent_bucket, why: r.why, reason: r.reason_code, complete: !!r.complete,
             dueAt: r.due_at, dirty: !!r.dirty, at: r.at, ...lots, ...dates, ...wei };
  }
  /* The member's state for a coin: { fresh, … } — fresh when it is for the wallets linked now and this rule. null when there
     is no row. A stale row's figures are still what the member's wallets showed then (a dashboard may show them, labelled). */
  function stateOf(uid, token) {
    const r = db.prepare('SELECT * FROM acq_state WHERE user_id = ? AND token = ?').get(uid, lc(token));
    if (!r) return null;
    const s = decode(r);
    // and its coin still on the tape: a coin that left it (nobody asked for 30 days, too long a history, no pool) is no longer kept
    s.fresh = r.rule_v === RULE_V && r.wallets_sig === sigOf(deps.wallets(uid)) && (CORE.includes(r.token) || tapedOk(r.token));
    return s;
  }
  /* true / false / null: does the member clear "$100 bought" for this coin now? null is no answer yet (no row, a stale row, a
     coin with no tape, an unknown the engine could not close) — and asks the worker for one. */
  function verdictOf(uid, token, opts) {
    if (!deps.wallets(uid).length) return false;   // no wallet linked: verifiably bought nothing here (no tape needed to say so)
    const s = stateOf(uid, token);
    if (!s || !s.fresh) { want(uid, token, opts); return null; }
    keepWanted(lc(token));
    return s.floor;
  }

  /* A coin whose answers are read keeps its place on the tape: only want() (a missing or stale answer) marked it wanted, so a
     community's coin with fresh answers left the tape after 30 days and its answers froze (review 2026-11-18). Once an hour. */
  const wantedAt = new Map();
  function keepWanted(t) {
    if (CORE.includes(t) || now() - (wantedAt.get(t) || 0) < 3600e3) return;
    wantedAt.set(t, now());
    db.prepare('UPDATE bought_tokens SET wanted_at = ? WHERE token = ?').run(now(), t);
  }
  /* ----- the worker's queue: who needs a verdict made ----- */
  const queue = new Map();   // `${uid}:${token}` → { uid, token, prio, opts }
  function want(uid, token, opts) {
    const t = lc(token); if (!isAddr(t) || !uid) return;
    if (!CORE.includes(t)) wantToken(t);
    const k = uid + ':' + t, cur = queue.get(k);
    const prio = (opts && opts.prio) || 0;
    // merged whatever the order: the highest priority, and a link's flag kept (raise-on-link needs it — review 2026-11-18)
    const o = { ...(cur && cur.opts), ...(opts || {}) };
    if ((cur && cur.opts && cur.opts.link) || (opts && opts.link)) o.link = true;
    queue.set(k, { uid, token: t, prio: Math.max(prio, cur ? cur.prio : 0), opts: o });
  }
  // the member's wallets changed (a link, an unlink, a disconnect): every row of theirs is made again, the core coins first
  function touch(uid, opts) {
    db.prepare('UPDATE acq_state SET dirty = 1 WHERE user_id = ?').run(uid);
    for (const t of CORE) want(uid, t, { prio: 2, ...(opts || {}) });
  }
  // after a tape tick: members whose wallets (or followed wallets) moved a coin since the last look are made again
  function markMoved(token, fromBlock) {
    const rows = db.prepare('SELECT from_addr, to_addr FROM coin_tape WHERE token = ? AND block >= ?').all(token, fromBlock);
    if (!rows.length) return 0;
    const addrs = new Set(); for (const r of rows) { addrs.add(r.from_addr); addrs.add(r.to_addr); }
    const byId = db.prepare("SELECT user_id FROM identities WHERE type = 'wallet' AND identifier = ?");
    const byFollow = db.prepare('SELECT user_id FROM dh_follow WHERE addr_idx = ?');
    const mark = db.prepare('UPDATE acq_state SET dirty = 1 WHERE user_id = ? AND token = ?');
    let n = 0;
    for (const a of addrs) {
      const i = deps.idx(a);
      let us = []; try { us = byId.all(i).concat(byFollow.all(i)); } catch {}
      for (const u of us) n += mark.run(u.user_id, token).changes;
    }
    return n;
  }

  /* ----- one verdict ----- */
  async function evaluate(uid, token, opts = {}) { return evaluateAt(uid, lc(token), opts || {}, null); }
  // rd0: the coin's readiness as the worker's pass read it (asked again here when it is not given or not ready)
  async function evaluateAt(uid, t, opts, rd0) {
    const ws = deps.wallets(uid);
    const sig = sigOf(ws);
    const before = stateOf(uid, t);
    const row = tokenRow(t);
    const write = (fields, enc) => {
      const prev = db.prepare('SELECT verdict, tries FROM acq_state WHERE user_id = ? AND token = ?').get(uid, t);
      db.prepare(`INSERT INTO acq_state (user_id, token, wallets_sig, rule_v, block, verdict, spent_bucket, why, reason_code, complete, due_at, dirty, tries, conflicts, lots_enc, cursors_enc, dates_enc, wei_enc, at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)
        ON CONFLICT(user_id, token) DO UPDATE SET wallets_sig = excluded.wallets_sig, rule_v = excluded.rule_v, block = excluded.block, verdict = excluded.verdict,
          spent_bucket = excluded.spent_bucket, why = excluded.why, reason_code = excluded.reason_code, complete = excluded.complete, due_at = excluded.due_at,
          dirty = 0, tries = excluded.tries, conflicts = excluded.conflicts, lots_enc = excluded.lots_enc, cursors_enc = excluded.cursors_enc, dates_enc = excluded.dates_enc, wei_enc = excluded.wei_enc, at = excluded.at`)
        .run(uid, t, sig, RULE_V, fields.block == null ? null : fields.block, fields.verdict == null ? null : (fields.verdict ? 1 : 0), fields.spentBucket == null ? null : fields.spentBucket,
          fields.why || null, fields.reason, fields.complete ? 1 : 0, fields.dueAt, fields.tries || 0, fields.conflicts || 0,
          enc && enc.lots ? deps.enc(JSON.stringify(enc.lots)) : null, null,
          enc && enc.dates ? deps.enc(JSON.stringify(enc.dates)) : null, enc && enc.wei ? deps.enc(JSON.stringify(enc.wei)) : null, now());
      return prev;
    };
    if (!ws.length) {
      write({ verdict: false, reason: 'no-wallet', complete: true, dueAt: now() + LIMITS.RECHECK_MS });
      const after = stateOf(uid, t);
      if (deps.onVerdict) try { deps.onVerdict(uid, t, before, after, opts); } catch (e) { log('onVerdict: ' + e.message); }
      return after;
    }
    if (row && (row.state === 'too-big' || row.state === 'no-pool')) {
      // a coin this tape cannot keep: no answer, and its reason (it does not pass on its own while the coin is as it is)
      write({ verdict: null, why: 'transient', reason: row.state, dueAt: now() + LIMITS.TAPE_WAIT_MS });
      return stateOf(uid, t);
    }
    const rd = rd0 && rd0.ready ? rd0 : readiness(t);
    if (!rd.ready) {
      /* Not read to the settled head: no verdict. Nothing is written — what the member had stands (a row made at an earlier
         settled head is still the answer it was) — and the worker makes it once every stream is there. */
      if (!row) wantToken(t);
      want(uid, t, opts);
      return before;
    }
    const X = rd.block;
    const { idx } = indexFor(rd.row, rd);
    const linked = ws.map((w) => lc(w.addr));
    const core = CORE.includes(t);
    /* Diamond Hands follows any wallet a member sent coins to — another member's linked wallet too. Coins there are that
       account's to count (traced to their buy): kept for the sender as well, one $110 buy cleared $100 for both (review
       2026-11-18). So a followed wallet another account has linked, or whose claims back another account, is left out here. */
    const followed = core && deps.followed ? deps.followed(uid, t).map(lc).filter((a) => !linked.includes(a) && !ownedElsewhere(uid, a)) : [];
    const ledger = deps.ledger ? deps.ledger(t) : null;
    const run = () => acquire.evaluate({
      index: idx, memberSet: { linked, followed }, claims: claimsFor(uid, t), nowMs: now(),
      blockTimes: blockTimes(), ethUsdAt, decimals: Number.isInteger(row.decimals) ? row.decimals : 18,
      consistent: ledger ? ledger.consistent !== false : true,
      diamond: core && deps.diamond ? deps.diamond : undefined,
    });
    let r = run();
    // the block times an answer needs and the tape does not have: read (a few, in the background) and asked again
    for (let k = 0; k < 2 && r.needBlocks && r.needBlocks.length && deps.tape && !opts.noReads; k++) {
      try { await deps.tape.ensureBlockTimes(r.needBlocks.slice(0, LIMITS.NEED_BLOCKS_MAX), { maxReads: 8 }); } catch (e) { log('block times: ' + e.message); break; }
      r = run();
    }
    // the stretches held, for the OG restore pass (core coins): from the same tape, on the same times
    let spans = null;
    if (core) {
      const own = ownRows(t, linked, X);
      let hs = heldSpans(own, linked, blockTimes(), idx.dust);
      if (hs.need && deps.tape && !opts.noReads) { try { await deps.tape.ensureBlockTimes(hs.need.slice(0, LIMITS.NEED_BLOCKS_MAX), { maxReads: 8 }); } catch {} hs = heldSpans(own, linked, blockTimes(), idx.dust); }
      spans = hs.spans;
    }
    // the wallets set changed while the block times were read: this answer is about wallets the member no longer has
    if (sigOf(deps.wallets(uid)) !== sig) { want(uid, t, { ...opts, prio: 2 }); return before; }
    // defence in depth: the held amount must be the ledger's balance of the same wallets — else no answer, never "holds none"
    const off = ledgerCheck(t, linked, X, r.heldWei);
    if (off) {
      log('a verdict on ' + t + ' withheld (' + off.code + '): ' + off.why);
      const pr = db.prepare('SELECT tries FROM acq_state WHERE user_id = ? AND token = ?').get(uid, t);
      const n = ((pr && pr.tries) || 0) + 1;
      write({ block: X, verdict: null, why: 'transient', reason: off.code, complete: false, dueAt: now() + LIMITS.RETRY_MS[Math.min(n - 1, LIMITS.RETRY_MS.length - 1)], tries: n });
      const after = stateOf(uid, t);
      if (deps.onVerdict) try { deps.onVerdict(uid, t, before, after, opts); } catch (e) { log('onVerdict: ' + e.message); }
      return after;
    }
    const floor = r.floor;
    const reason = reasonOf(r);
    const prevRow = db.prepare('SELECT tries FROM acq_state WHERE user_id = ? AND token = ?').get(uid, t);
    const tries = floor === null && r.why === 'transient' ? ((prevRow && prevRow.tries) || 0) + 1 : 0;
    let dueAt = now() + LIMITS.RECHECK_MS;
    if (floor === null && r.why === 'transient') dueAt = now() + LIMITS.RETRY_MS[Math.min(tries - 1, LIMITS.RETRY_MS.length - 1)];
    if (r.maturesAtMs && r.maturesAtMs > now()) dueAt = Math.min(dueAt, r.maturesAtMs + 60e3);   // a buy turning 24 hours old: counted then
    if (r.provisional) dueAt = Math.min(dueAt, now() + 30 * 60e3);                                 // a price from the ETH/USD cell still open
    const counted = r.lots.filter((x) => x.counted && Number.isFinite(x.usd)).slice(-LIMITS.STATE_LOTS_MAX);
    const pendingLots = r.lots.filter((x) => x.pending).slice(-LIMITS.STATE_LOTS_MAX);   // bought, still inside its 24 hours
    // the wallets a tier or a Diamond month rests on, to be claimed: linked ones only — a followed wallet's lots sit in someone
    // else's wallet, and claiming it blocked that owner's own buys (or this badge) for good (review 2026-11-18)
    const isLinked = (w) => !!w && linked.includes(lc(w));
    const monthWallets = [...new Set(r.lots.filter((x) => x.counted && deps.diamond && x.originMs != null && x.originMs >= deps.diamond.from && x.originMs <= deps.diamond.until && isLinked(x.wallet)).map((x) => lc(x.wallet)))];
    const tierWallets = r.tierBasis ? [...new Set(r.lots.filter((x) => x.counted && (r.tierBasis.origins || [r.tierBasis.origin]).map(lc).includes(lc(x.origin)) && isLinked(x.wallet)).map((x) => lc(x.wallet)))] : [];
    const enc = {
      lots: { spentUsd: r.spentUsd, pendingUsd: r.pendingUsd, heldCostUsd: r.heldCostUsd, provisional: !!r.provisional, diamondMonth: r.diamondMonth, boughtInMonth: r.boughtInMonth,
              unknown: { n: r.unknown.n, kind: r.unknown.kind, reasons: r.unknown.reasons.slice(0, 8) }, conflicts: r.conflicts.length,
              needs: r.needs.length, monthWallets, tierWallets,
              // [arrived, $, bought at, the member's own buy (1/0), still held (1/0)]: the Send size reads arrivals, the buy-out own buys held
              counted: counted.map((x) => [x.arrivedMs, x.usd, x.originMs, x.via === 'own' ? 1 : 0, x.fate === 'held' ? 1 : 0]),
              pendingLots: pendingLots.map((x) => [x.arrivedMs, Number.isFinite(x.usd) ? x.usd : null]) },
      dates: { firstBuyMs: r.firstBuyMs, tierDateMs: r.tierDateMs, lastArrivedMs: r.lastArrivedMs, maturesAtMs: r.maturesAtMs, spans,
               dq: { dumped: r.dq ? r.dq.dumped : null, notAccumulator: r.dq ? r.dq.notAccumulator : null, disqualified: r.dq ? r.dq.disqualified : null } },
      wei: { heldWei: r.heldWei, acquired: r.tokens.acquired, bought: r.tokens.bought, sold: r.tokens.sold, monthIn: r.monthIn, monthOut: r.monthOut },
    };
    db.exec('BEGIN');
    try {
      // a claim it needs was taken meanwhile: no answer from this read — made again at once, on the claims as they are now
      if (floor === true && claimTaken(uid, t, r, new Set(linked))) { db.exec('ROLLBACK'); want(uid, t, { prio: 2 }); return before; }
      // complete: the engine found nothing unknown on a tape read to the settled head (readiness) — complete at the head
      write({ block: X, verdict: floor, spentBucket: bucket(r.spentUsd), why: r.complete ? null : r.why, reason, complete: r.complete, dueAt, tries, conflicts: r.conflicts.length }, enc);
      if (floor === true) writeClaims(uid, t, r, new Set(linked));
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
    const after = stateOf(uid, t);
    if (deps.onVerdict) try { deps.onVerdict(uid, t, before, after, opts); } catch (e) { log('onVerdict: ' + e.message); }
    return after;
  }

  /* ----- a verdict for a wallet set given on purpose (not the one linked now), stored nowhere -----
     The OG restore pass judges a badge removed before 2026-11-17 on the wallets that were linked WHEN it was removed (server.js
     ogRevokedWallets), some of which may not be linked now. Made here and handed back in stateOf's shape (fresh: it is for those
     wallets) — background work only (the restore runs in the grant sweep). No row is written and no claim; null when the coin's
     tape is not read to the settled head, or when the held amount disagrees with the ledger (as evaluate). */
  async function evaluateSet(uid, token, addrs, opts = {}) {
    const t = lc(token);
    const linked = [...new Set((addrs || []).map(lc).filter(isAddr))];
    if (!linked.length) return null;
    const rd = readiness(t);
    if (!rd.ready) return null;
    const row = rd.row, X = rd.block;
    const { idx } = indexFor(row, rd);
    const core = CORE.includes(t), ledger = deps.ledger ? deps.ledger(t) : null;
    const run = () => acquire.evaluate({ index: idx, memberSet: { linked, followed: [] }, claims: claimsFor(uid, t), nowMs: now(), blockTimes: blockTimes(), ethUsdAt,
      decimals: Number.isInteger(row.decimals) ? row.decimals : 18, consistent: ledger ? ledger.consistent !== false : true, diamond: core && deps.diamond ? deps.diamond : undefined });
    let r = run();
    for (let k = 0; k < 2 && r.needBlocks && r.needBlocks.length && deps.tape && !opts.noReads; k++) {
      try { await deps.tape.ensureBlockTimes(r.needBlocks.slice(0, LIMITS.NEED_BLOCKS_MAX), { maxReads: 8 }); } catch { break; }
      r = run();
    }
    const own = ownRows(t, linked, X);
    let hs = heldSpans(own, linked, blockTimes(), idx.dust);
    if (hs.need && deps.tape && !opts.noReads) { try { await deps.tape.ensureBlockTimes(hs.need.slice(0, LIMITS.NEED_BLOCKS_MAX), { maxReads: 8 }); } catch {} hs = heldSpans(own, linked, blockTimes(), idx.dust); }
    if (ledgerCheck(t, linked, X, r.heldWei)) return null;
    const tierWallets = r.tierBasis ? [...new Set(r.lots.filter((x) => x.counted && (r.tierBasis.origins || [r.tierBasis.origin]).map(lc).includes(lc(x.origin)) && x.wallet && linked.includes(lc(x.wallet))).map((x) => lc(x.wallet)))] : [];
    return { fresh: true, given: true, userId: uid, token: t, block: X, floor: r.floor, verdict: r.floor, complete: r.complete, why: r.complete ? null : r.why, reason: reasonOf(r),
      spentUsd: r.spentUsd, pendingUsd: r.pendingUsd, heldCostUsd: r.heldCostUsd, diamondMonth: r.diamondMonth, monthWallets: [], tierWallets,
      firstBuyMs: r.firstBuyMs, tierDateMs: r.tierDateMs, lastArrivedMs: r.lastArrivedMs, spans: hs.spans,
      dq: { dumped: r.dq ? r.dq.dumped : null, notAccumulator: r.dq ? r.dq.notAccumulator : null, disqualified: r.dq ? r.dq.disqualified : null },
      heldWei: r.heldWei, acquired: r.tokens.acquired, sold: r.tokens.sold, monthIn: r.monthIn, monthOut: r.monthOut };
  }

  /* ----- the worker: a few verdicts a pass, the most wanted first ----- */
  let working = false;
  async function work(opts = {}) {
    if (working) return { busy: true };
    working = true;
    let done = 0;
    try {
      const max = opts.max || LIMITS.WORK_MAX;
      /* A coin whose tape is not read to the settled head (its first back-fill, a stream held after a failure, a pool the tape
         cannot read, the head not read lately) has no answer to make: nothing is written for it (a row saying "no answer" for
         every member would only churn), the features keep what they had, its requests stay queued and its rows are not picked
         — they would take every pass's places from the coins that are ready. */
      const rds = new Map();
      const rdOf = (t) => { if (!rds.has(t)) rds.set(t, readiness(t)); return rds.get(t); };
      const picks = [], seen = new Set();
      const add = (uid, token, o) => { const k = uid + ':' + token; if (picks.length < max && !seen.has(k)) { seen.add(k); picks.push({ uid, token, opts: o || {} }); } };
      for (const x of [...queue.values()].sort((a, b) => b.prio - a.prio)) {
        if (picks.length >= max) break;
        if (!rdOf(x.token).ready) continue;
        queue.delete(x.uid + ':' + x.token);
        add(x.uid, x.token, x.opts);
      }
      const ok = db.prepare('SELECT token FROM bought_tokens').all().map((r) => r.token).filter((t) => rdOf(t).ready);
      // rows made under an older rule, moved, or due (a buy maturing, an unknown retried, the periodic re-check)
      if (ok.length && picks.length < max) {
        for (const r of db.prepare('SELECT user_id, token FROM acq_state WHERE token IN (' + ok.map(() => '?').join(',') + ') AND (dirty = 1 OR rule_v <> ? OR due_at <= ?) ORDER BY dirty DESC, due_at ASC LIMIT ?').all(...ok, RULE_V, now(), max)) add(r.user_id, r.token);
      }
      // members with a wallet and no verdict on a core coin yet
      for (const t of CORE) {
        if (picks.length >= max) break;
        if (!rdOf(t).ready) continue;
        for (const r of db.prepare(`SELECT DISTINCT i.user_id FROM identities i WHERE i.type = 'wallet' AND NOT EXISTS (SELECT 1 FROM acq_state a WHERE a.user_id = i.user_id AND a.token = ?) LIMIT ?`).all(t, max)) add(r.user_id, t);
      }
      for (const x of picks) {
        try { await evaluateAt(x.uid, x.token, x.opts || {}, rdOf(x.token)); done++; }
        catch (e) { log('verdict ' + x.uid + ': ' + ((e && e.message) || e)); try { db.prepare('UPDATE acq_state SET due_at = ?, dirty = 0 WHERE user_id = ? AND token = ?').run(now() + LIMITS.RETRY_MS[0], x.uid, x.token); } catch {} }
      }
    } finally { working = false; }
    return { done };
  }

  /* ----- the tape's tick: ledgers forward, every stream walked, Swap blocks dated, the ETH/USD grid folded ----- */
  let ticking = false;
  const poolAsked = new Map();   // token → when its pools were last asked (this process)
  async function tick(opts = {}) {
    if (ticking) return { busy: true };
    ticking = true;
    const out = { tokens: {}, walk: null, ethusd: null, moved: 0 };
    try {
      // tokens nobody has asked about for 30 days leave the tape (not $SEND or $GWC)
      for (const r of db.prepare("SELECT token, pools FROM bought_tokens WHERE core = 0 AND (wanted_at IS NULL OR wanted_at < ?)").all(now() - 30 * DAY_MS)) {
        try { tapeLib.tapeDrop(db, r.token, Object.keys(jparse(r.pools) || {})); } catch {}
        db.prepare('DELETE FROM bought_tokens WHERE token = ?').run(r.token);
        db.prepare('DELETE FROM acq_state WHERE token = ?').run(r.token);   // no longer kept: no answer, never a frozen one
      }
      const streams = [];
      const before = {};
      for (const row of db.prepare('SELECT token FROM bought_tokens').all().map((x) => tokenRow(x.token))) {
        const t = row.token;
        before[t] = tapeLib.transfersThrough(db, t);   // before the ledger's refresh: its appends are how $SEND and $GWC reach the tape
        try {
          if (deps.refreshLedger) await deps.refreshLedger(t);
        } catch (e) { out.tokens[t] = 'ledger: ' + ((e && e.message) || e); }
        const lg = deps.ledger ? deps.ledger(t) : null;
        if (!row.core && lg && (lg.status === 'too-big' || lg.logs > LIMITS.TAPE_MAX_TRANSFERS)) {
          db.prepare("UPDATE bought_tokens SET state = 'too-big', why = ?, at = ? WHERE token = ?").run('more than ' + LIMITS.TAPE_MAX_TRANSFERS.toLocaleString('en-US') + ' transfers: too long a history to keep here', now(), t);
          try { tapeLib.tapeDrop(db, t, poolList(row)); } catch {}
          db.prepare("DELETE FROM acq_state WHERE token = ? AND reason_code <> 'too-big'").run(t);
          continue;
        }
        if (!lg || lg.firstBlock == null || lg.lastBlock == null) { out.tokens[t] = out.tokens[t] || 'no ledger yet'; continue; }
        let pools = row.pools && Object.keys(row.pools).length ? row.pools : null;
        const asked = poolAsked.get(t) || 0;
        if (now() - asked >= (pools ? LIMITS.POOLS_REFRESH_MS : LIMITS.POOLS_RETRY_MS)) {
          try {
            const found = await deps.poolsFor(t);
            poolAsked.set(t, now());
            const add = found.filter((p) => !pools || !pools[lc(p.pool)]);
            if (add.length) {
              pools = { ...(pools || {}) };
              for (const p of add) pools[lc(p.pool)] = { tokenIsZero: !!p.tokenIsZero, quote: p.quote, ...(p.quoteDecimals != null ? { quoteDecimals: p.quoteDecimals } : {}) };
              db.prepare("UPDATE bought_tokens SET pools = ?, decimals = ?, state = 'ok', why = NULL, at = ? WHERE token = ?").run(JSON.stringify(pools), Number.isInteger(lg.decimals) ? lg.decimals : null, now(), t);
              indexes.delete(t);
            }
          } catch (e) { out.tokens[t] = 'pools: ' + ((e && e.message) || e); if (!pools) continue; }
        }
        if (!pools) { db.prepare("UPDATE bought_tokens SET state = 'no-pool', why = ?, at = ? WHERE token = ?").run('no v2 pool against WETH or USDG', now(), t); continue; }
        if (row.state !== 'ok') db.prepare("UPDATE bought_tokens SET state = 'ok', why = NULL, decimals = COALESCE(decimals, ?), at = ? WHERE token = ?").run(Number.isInteger(lg.decimals) ? lg.decimals : null, now(), t);
        for (const p of Object.keys(pools)) streams.push(...tapeLib.poolStreams(p, { start: lg.firstBlock }));
        streams.push(tapeLib.transferStream(t, { start: lg.firstBlock, until: lg.lastBlock }));
      }
      streams.push(...tapeLib.poolStreams(PAIR, { kinds: ['Sync'], start: 0 }));
      if (deps.tape) {
        try { out.walk = await deps.tape.walk(streams, { maxReads: opts.maxReads || LIMITS.TICK_READS, dateMax: opts.dateMax || LIMITS.DATE_MAX }); }
        catch (e) { out.walk = { error: (e && e.message) || String(e) }; }
        // the head the walk read (a walk its budget stopped read it too): what every stream must reach before a verdict is made
        if (out.walk && Number.isSafeInteger(out.walk.settled)) recordHead(out.walk.settled);
      }
      try { out.ethusd = foldEthUsd(); } catch (e) { out.ethusd = { error: e.message }; }
      for (const [t, b] of Object.entries(before)) {
        const nowThrough = tapeLib.transfersThrough(db, t);
        if (nowThrough != null && (b == null || nowThrough > b)) out.moved += markMoved(t, b == null ? 0 : b + 1);
      }
      indexes.clear();
    } finally { ticking = false; }
    return out;
  }

  /* ----- what /admin shows ----- */
  function stats() {
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const tokens = db.prepare('SELECT token, state, why, core FROM bought_tokens ORDER BY core DESC, token').all().map((r) => {
      const rd = r.state === 'ok' ? readiness(r.token) : null;
      const v = one('SELECT SUM(verdict = 1) yes, SUM(verdict = 0) no, SUM(verdict IS NULL) unknown FROM acq_state WHERE token = ? AND rule_v = ?', r.token, RULE_V) || {};
      // head: the block verdicts are made at, only while every stream is read to the settled head; else why not (headWhy)
      return { token: r.token, core: !!r.core, state: r.state, why: r.why, ready: !!(rd && rd.ready), head: rd && rd.ready ? rd.block : null, target: rd && rd.target != null ? rd.target : null,
               headWhy: rd && !rd.ready ? rd.why : null, yes: v.yes || 0, no: v.no || 0, unknown: v.unknown || 0 };
    });
    const g = gridNow();
    return {
      ruleV: RULE_V, tokens, queue: queue.size,
      // verdicts whose held amount disagreed with the ledger's balance of the same wallets (no answer was given: ledgerCheck)
      mismatches: (one("SELECT COUNT(*) n FROM acq_state WHERE reason_code = 'ledger-mismatch' AND rule_v = ?", RULE_V) || {}).n || 0,
      ethUsd: { through: g ? g.to : null, cells: loadCells().size, firstSync: g ? g.firstSync : null },
      claims: (one('SELECT COUNT(*) n FROM buy_claims') || {}).n || 0,
      conflicts: (one('SELECT COUNT(*) n FROM acq_state WHERE conflicts > 0') || {}).n || 0,   // verdicts that could not use a buy: already counted for another account
      reasons: db.prepare('SELECT token, reason_code reason, COUNT(*) n FROM acq_state WHERE rule_v = ? GROUP BY token, reason_code ORDER BY token, n DESC').all(RULE_V),
    };
  }

  // is this coin's Transfers kept (the ledger's hook appends its batches)? $SEND and $GWC, and a coin taken on and not dropped
  const tapedQ = db.prepare("SELECT 1 FROM bought_tokens WHERE token = ? AND state IN ('pending', 'ok')");
  const taped = (token) => !!tapedQ.get(lc(token));
  const tapedOkQ = db.prepare("SELECT 1 FROM bought_tokens WHERE token = ? AND state = 'ok'");
  const tapedOk = (token) => !!tapedOkQ.get(lc(token));
  // an account deleted: its verdicts go (claims stay, like og_claims)
  function forget(uid) { db.prepare('DELETE FROM acq_state WHERE user_id = ?').run(uid); for (const k of [...queue.keys()]) if (k.startsWith(uid + ':')) queue.delete(k); }

  return { RULE_V, LIMITS, tick, work, taped, evaluate, evaluateSet, stateOf, verdictOf, want, wantToken, touch, forget, stats, tokenRow, ethUsdAt, foldEthUsd, gridNow, markMoved, claimsFor,
           readiness: (token) => readiness(lc(token)), ready: (token) => readiness(lc(token)).ready, queueSize: () => queue.size };
}

module.exports = { createBought, migrate, heldSpans, reasonOf, RULE_V, LIMITS };
