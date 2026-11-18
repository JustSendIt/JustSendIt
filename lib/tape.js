'use strict';
/* ===== The coin tape: a token's transfers and its pools' trades, read once and kept (owner, 2026-11-17) ===============
   Owner: "make it $100 of value bought in the token not the current token value, and change that rule across the
   platform" — "make sure transfers do not count as buy but instead follow the transactions back to the original buy
   on-chain and make sure the buy date is correct for all users". The engine that answers that (lib/acquire.js) replays a
   token's whole history in-process — every Transfer, every Swap, Mint and Burn of its pools, the time of every block a
   trade sat in — so a member's check asks the chain nothing at all (decision H8 of the hold-cost synthesis). This file is
   the I/O half: it reads those logs and keeps them. It reads nothing on its own: the server hands it its node readers,
   its pace and its cool-down (createTape's deps), so the rules are tested exactly as they run (tests/tape.mjs).

   What is kept (public chain data, the same class as holder_balances — no row here names a member):
     · coin_tape     every Transfer of a taped token (from, to, value, block, log index, tx). For $SEND and $GWC these are
                     the very logs the holder ledger already folds (server.js ledgerApply): appendTransfers() writes them
                     inside the ledger's own transaction, so they cost no read of their own. A token whose ledger was built
                     before the tape existed is back-filled once by the walker, only up to where those appends begin.
     · pool_events   each pool's Swap, Mint and Burn (and Sync, when a caller asks for it), raw, as the pool emitted them.
     · block_times   the time of every block a Swap sat in (a buy's date), and of any other block the engine asks for —
                     never every block: this chain makes about ten a second.
     · tape_cursor   per stream, the block it is complete through: a walk the node refuses half-way goes on from there.
     · tape_pools    what each pool is, checked once before its first read: a Uniswap v2 pair, a Uniswap v3 pool, or
                     neither (and why). The events a pool emits depend on its kind, and a query for the wrong kind's
                     topics is answered with nothing at all — a pool walked that way would look complete with no trades,
                     a made-up "spent $0". So a pool the check cannot place gets no cursor, and tapeHead says why.
     · tape_holds    a stream that failed (an answer it cannot keep, a node error on one of its windows): it is not
                     asked again until its hold ends (2 minutes, doubling to 6 hours), and its failure never stops the
                     other streams of a walk.
     · tape_receipts receipts of members' own transactions in tokens with no tape (a Send Call token, a community token
                     past the tape's size). Each receipt is public, but WHICH transactions were read is a member's link to
                     a wallet — so the body (block included) is encrypted and the hash is kept only as a blind index.

   The node's rules, measured, and pinned by tests/tape.mjs:
     · ONE address and ONE value per topic position per query. A query with two values in one position ([Swap, Mint]) is
       capped at 100,000 blocks (measured 2026-10-17, server.js scanBundles); one value gets the 10,000,000-block window
       an address filter allows (measured 2026-09-30, server.js PHIST_WINDOW_MAX). So Swap, Mint and Burn are three
       queries, sent as items of one batch, never one query with three values;
     · at most 10,000 logs an answer: a refused window is quartered and read in pieces, ends still on cell lines;
     · `blockTimestamp` on a log is not a time: eth_getLogs answers carry "0x0" in it, receipts a value. Neither is read
       here (a log's fields are picked one by one, never spread). A date is eth_getBlockByNumber's, kept in block_times.

   Windows end on cell lines — block …9,999 of a 10,000-block cell, the ETH/USD grid's cell (lib/ethusd.js, server.js
   PHIST_CELL) — except a window that reaches the walk's end, which ends there. So a cursor that is behind always sits on
   a cell line, and the tape and the ETH/USD grid split the chain in the same places.

   The walker never reads the newest SETTLE_BLOCKS (5,000, server.js WALLET_REORG_OVERLAP: "a reorg on this chain is
   shallower than that"): its streams end there, about eight minutes behind the head. Its rows go in once and are never
   read again, so a log a reorg later drops (or one a lagging node had not seen yet) would stay wrong for good, and a
   buy claim made on it is never released. Eight minutes costs nothing here: a buy counts only after 24 hours held.
   The ledger's own appends (appendTransfers) are kept as the ledger read them, up to its head — the margin is the
   walker's — but tapeHead is the lowest of a token's streams, so with its pools named it never passes their settled end.

   The tape is background work on the node that answers the reads a person is waiting on, like the ledger: it never
   argues with a refusal. The first one stands it down (deps.cool — the server's ledgerCoolUntil), nothing is asked while
   that lasts, and the next run carries on from the cursors. Unknown is never a number: a block the node did not date has
   no block_times row (not a 0), a receipt it did not have is null. ===================================================== */

const TOPICS = Object.freeze({
  Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',   // Transfer(address indexed, address indexed, uint256)
  Swap: '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',       // Swap(address indexed sender, uint amount0In, amount1In, amount0Out, amount1Out, address indexed to)
  Mint: '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f',       // Mint(address indexed sender, uint amount0, uint amount1): liquidity added
  Burn: '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496',       // Burn(address indexed sender, uint amount0, uint amount1, address indexed to): liquidity taken out
  Sync: '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1',       // Sync(uint112 reserve0, uint112 reserve1)
});
// a v2 pool event's shape: topics (the signature plus its indexed addresses) and data words. One that does not fit is not stored.
const SHAPE = Object.freeze({ Swap: { topics: 3, words: 4 }, Mint: { topics: 2, words: 2 }, Burn: { topics: 3, words: 2 }, Sync: { topics: 1, words: 2 } });
/* A Uniswap v3 pool's own events (spec R9: "v3 Swap decoded too" — lib/acquire.js decodes the 5-word Swap; Mint and Burn
   are read for their kind). They are kept under the same kind names as a v2 pair's, raw. A v3 pool has no Sync. Its
   Collect (where a liquidity provider's tokens actually leave the pool) is not read: the engine has no rule for it. */
const TOPICS_V3 = Object.freeze({
  Swap: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',   // Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
  Mint: '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde',   // Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
  Burn: '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c',   // Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
});
const SHAPE_V3 = Object.freeze({ Swap: { topics: 3, words: 5 }, Mint: { topics: 4, words: 4 }, Burn: { topics: 4, words: 3 } });
const poolEvents = (topics, shape) => ({ topics: Object.fromEntries(Object.keys(shape).map((k) => [k, topics[k]])), shape, kindOf: new Map(Object.keys(shape).map((k) => [topics[k], k])) });
const POOL_EVENTS = Object.freeze({ v2: poolEvents(TOPICS, SHAPE), v3: poolEvents(TOPICS_V3, SHAPE_V3) });
const POOL_KINDS = ['Swap', 'Mint', 'Burn'];   // what the engine needs of a pool; Sync only when a caller asks for it (a v2 pair's)
// the pool check's three calls: factory() both kinds answer; getReserves() only a v2 pair (3 words); slot0() only a v3 pool (7 words)
const SEL = Object.freeze({ factory: '0xc45a0155', getReserves: '0x0902f1ac', slot0: '0x3850c7bd' });

const CELL = 10000;                  // the grid's cell (lib/ethusd.js, server.js PHIST_CELL): windows end on its lines
const WINDOW_MAX = 10000000;         // the node's one-address eth_getLogs span (measured 2026-09-30: 10,000,001 refused)
const MULTI_VALUE_SPAN_MAX = 100000; // the node's span for a query with several values in one topic position — why this file never sends one
const LIMITS = Object.freeze({
  BATCH_WINDOWS: 10,     // log windows one batch carries (measured 2026-09-28: ten answer in ~0.1 s; twenty-five time out, then 429)
  BLOCK_BATCH: 25,       // block reads one batch carries (server.js PACE_BATCH)
  RECEIPT_BATCH: 25,     // receipts one batch carries (the same)
  SMALL_ANSWER: 2500,    // an answer this small (a quarter of the node's 10,000) lets the window double, as server.js indexHolders does
  MIN_WINDOW: 50,        // a window this small that is still refused holds more logs than the node returns: "too dense"
  SETTLE_BLOCKS: 5000,   // the walker stops this far behind the head (server.js WALLET_REORG_OVERLAP): see the header
  HOLD_FIRST_MS: 2 * 60 * 1000,        // a failed stream waits this long before it is asked again (two tail ticks)...
  HOLD_MAX_MS: 6 * 3600 * 1000,        // ...doubling with each failure in a row, up to this
  POOL_RECHECK_MS: 3600 * 1000,        // a pool the check could not place is checked again after this (a refused call is null, like a revert)
  POOL_BATCH: 8,         // pools one check batch carries (three calls each)
  SLOW_TRIES: 2,         // a window that timed out is asked again this many times before it is quartered
  SLOW_WAIT_MS: 300,
  RECEIPT_LOGS_MAX: 600, // a receipt with more Transfers than this is answered but not kept (server.js TX_LEG_ENTRY_MAX)
  RECEIPT_ROWS_MAX: 200000,   // receipts kept; past it the oldest-read go first
  TAPE_MAX_TRANSFERS: 200000, // a community token is taped while its ledger holds at most this many Transfers (H8); the caller decides
});
/* What a read weighs on the server's shared pace (server.js: PACE_LOG_WEIGHT 5 for a log window over 200,000 blocks —
   PHIST_FAR_WINDOW, the wallet read's rule — 1 for a narrower one and for a block, receipt or eth_call read). A caller may
   pass its own. */
const WEIGHTS = Object.freeze({ log: 5, logNear: 1, nearSpan: 200000, block: 1, receipt: 1, call: 1 });

// "the answer is too large (or too slow)": shrink the window (server.js TOO_MANY_RE, word for word)
const TOO_MANY_RE = /exceeds limit|too many results|query returned more|response size|more than \d+ results|limit of \d+|only \d+ (?:blocks )?are allowed|narrow the block range|timed out|timeout|aborted/i;
const SLOW_RE = /timed out|timeout|aborted/i;
const spanOf = (m) => { const sp = /only (\d+) (?:blocks )?are allowed/i.exec(m); return sp ? Number(sp[1]) : 0; };
// the node refusing this address (server.js isThrottle): never argued with — the tape stands down
const isThrottle = (e) => { const m = String((e && e.message) || e); return !/revert/i.test(m) && /\b429\b|\b403\b|too many requests|rate.?limit|capacity/i.test(m); };
const msgOf = (e) => String((e && e.message) || e || '');

// ERC-4337: a UserOperation that succeeded in a transaction means its smart account acted there (server.js receiptLegs)
const ENTRY_POINTS = new Set(['0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789', '0x0000000071727de22e5e9d8baf0edac6f37da032', '0x4337084d9e255ff0702461cf8895ce9e3b5ff108']);
const USEROP_TOPIC = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f';

const ADDR_RE = /^0x[0-9a-f]{40}$/, HASH_RE = /^0x[0-9a-f]{64}$/, TOPIC_RE = /^0x[0-9a-f]{64}$/;
const lc = (x) => String(x == null ? '' : x).toLowerCase();
const hx = (n) => '0x' + n.toString(16);
function hexInt(h) {   // a quantity the node sent; anything else is not a number here
  if (typeof h !== 'string' || !/^0x[0-9a-fA-F]{1,15}$/.test(h)) return null;
  const n = parseInt(h, 16); return Number.isSafeInteger(n) ? n : null;
}
const topicAddr = (t) => '0x' + t.slice(26);
const addrTopic = (a) => '0x' + '0'.repeat(24) + a.slice(2);
function addrOf(a, what) { const x = lc(a); if (!ADDR_RE.test(x)) throw new Error('not an address: ' + (what || 'address')); return x; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ===== The tables ===== */
function migrate(db) {
  db.exec(`
-- every Transfer of a taped token, as the token emitted it: public chain data (what the explorer shows), no member in it
CREATE TABLE IF NOT EXISTS coin_tape (
  token      TEXT NOT NULL,                -- the token's address, lowercase
  block      INTEGER NOT NULL,
  log_index  INTEGER NOT NULL,             -- the log's index in its block: (block, log_index) is one log on this chain
  tx         TEXT NOT NULL,
  from_addr  TEXT NOT NULL,
  to_addr    TEXT NOT NULL,
  value      TEXT NOT NULL,                -- decimal string (BigInt), the token's smallest unit
  PRIMARY KEY (token, block, log_index)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_coin_tape_from ON coin_tape(token, from_addr, block, log_index);
CREATE INDEX IF NOT EXISTS idx_coin_tape_to ON coin_tape(token, to_addr, block, log_index);
CREATE INDEX IF NOT EXISTS idx_coin_tape_tx ON coin_tape(token, tx);
-- a pool's own events: Swap | Mint | Burn | Sync, raw (data is the event's unindexed words, as hex)
CREATE TABLE IF NOT EXISTS pool_events (
  pool       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  block      INTEGER NOT NULL,
  log_index  INTEGER NOT NULL,
  tx         TEXT NOT NULL,
  data       TEXT NOT NULL,
  PRIMARY KEY (pool, block, log_index)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_pool_events_kind ON pool_events(pool, kind, block);
CREATE INDEX IF NOT EXISTS idx_pool_events_tx ON pool_events(pool, tx);
CREATE INDEX IF NOT EXISTS idx_pool_events_swaps ON pool_events(kind, block);   -- the Swap blocks still to date, across every pool
-- a block's time, as eth_getBlockByNumber gave it: ts is in MILLISECONDS (like every date on this site). No row = unknown.
CREATE TABLE IF NOT EXISTS block_times (
  block      INTEGER PRIMARY KEY,
  ts         INTEGER NOT NULL
);
-- per stream ('transfer:<token>', 'transfer-live:<token>', 'pool:<pool>:<Kind>'): complete through \`block\`, read from \`since\`
CREATE TABLE IF NOT EXISTS tape_cursor (
  stream     TEXT PRIMARY KEY,
  block      INTEGER NOT NULL,
  since      INTEGER,
  at         INTEGER NOT NULL
);
-- what a pool is, from its own answers (factory(), getReserves(), slot0()): 'v2' | 'v3', or NULL with why (checked again after POOL_RECHECK_MS)
CREATE TABLE IF NOT EXISTS tape_pools (
  pool       TEXT PRIMARY KEY,
  kind       TEXT,
  factory    TEXT,
  why        TEXT,
  at         INTEGER NOT NULL
);
-- a stream that failed: not asked again before \`until\`; n failures in a row (the wait doubles); block = the window it failed at
CREATE TABLE IF NOT EXISTS tape_holds (
  stream     TEXT PRIMARY KEY,
  block      INTEGER NOT NULL,
  why        TEXT NOT NULL,
  n          INTEGER NOT NULL,
  at         INTEGER NOT NULL,
  until      INTEGER NOT NULL
);
-- members' own receipts in tokens with no tape: tx_idx = blind index of the hash, body_enc = the encrypted compact receipt
CREATE TABLE IF NOT EXISTS tape_receipts (
  tx_idx     TEXT PRIMARY KEY,
  body_enc   TEXT NOT NULL,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tape_receipts_at ON tape_receipts(at);
`);
}
const TABLES = ['coin_tape', 'pool_events', 'block_times', 'tape_cursor', 'tape_pools', 'tape_holds', 'tape_receipts'];

// one prepared statement per (database, text): the tail tick writes every minute
const _stmts = new WeakMap();
function st(db, sql) {
  let m = _stmts.get(db); if (!m) _stmts.set(db, (m = new Map()));
  let s = m.get(sql); if (!s) m.set(sql, (s = db.prepare(sql)));
  return s;
}
/* A write that is all or nothing, inside the caller's transaction or on its own: a savepoint nests in ledgerApply's
   BEGIN (the ledger's batch and its tape rows commit together) and acts as a transaction when there is none. */
let _sp = 0;
function atomic(db, fn) {
  const name = 'tape_' + (++_sp);
  db.exec('SAVEPOINT ' + name);
  try { const r = fn(); db.exec('RELEASE ' + name); return r; }
  catch (e) { try { db.exec('ROLLBACK TO ' + name); db.exec('RELEASE ' + name); } catch {} throw e; }
}

/* ===== Cursors ===== */
const transferKey = (token) => 'transfer:' + token;
const liveKey = (token) => 'transfer-live:' + token;
const poolKey = (pool, kind) => 'pool:' + pool + ':' + kind;
function cursorGet(db, stream) {
  const r = st(db, 'SELECT block, since, at FROM tape_cursor WHERE stream = ?').get(String(stream));
  return r ? { block: r.block, since: r.since, at: r.at } : null;
}
/* A cursor only moves forward: a late or repeated write (a window read twice, the ledger re-folding a batch) can never
   take a stream back over blocks it has already kept — the rows are there, and re-reading them would cost reads. */
function cursorSet(db, stream, block, at, since) {
  if (!Number.isSafeInteger(block) || block < -1) throw new Error('a cursor is a block number');
  st(db, `INSERT INTO tape_cursor (stream, block, since, at) VALUES (?,?,?,?)
    ON CONFLICT(stream) DO UPDATE SET block = MAX(tape_cursor.block, excluded.block), since = COALESCE(tape_cursor.since, excluded.since),
      at = CASE WHEN excluded.block > tape_cursor.block THEN excluded.at ELSE tape_cursor.at END`).run(String(stream), block, since == null ? null : since, at);
}

/* ===== Holds: a stream that failed waits, and never stops the others =====
   One stream's failure is that stream's: a pool that emitted a log this reader cannot decode, a block too dense to read,
   a node error on one window. The walk keeps every other stream's answers and goes on; the failed one keeps what it read
   before the failure (its cursor says where) and is held, so a failure that comes back every time costs one read now and
   then — not a batch a minute. The hold ends on its own; the stream's next kept window clears it. */
function holdGet(db, stream) {
  const r = st(db, 'SELECT block, why, n, at, until FROM tape_holds WHERE stream = ?').get(String(stream));
  return r ? { block: r.block, why: r.why, n: r.n, at: r.at, until: r.until } : null;
}
function holdSet(db, stream, block, why, at) {
  const old = holdGet(db, stream), n = (old ? old.n : 0) + 1;
  const wait = Math.min(LIMITS.HOLD_MAX_MS, LIMITS.HOLD_FIRST_MS * 2 ** Math.min(n - 1, 20));
  st(db, `INSERT INTO tape_holds (stream, block, why, n, at, until) VALUES (?,?,?,?,?,?)
    ON CONFLICT(stream) DO UPDATE SET block = excluded.block, why = excluded.why, n = excluded.n, at = excluded.at, until = excluded.until`)
    .run(String(stream), Number.isSafeInteger(block) ? block : -1, String(why || 'failed').slice(0, 300), n, at, at + wait);
  return { n, until: at + wait };
}

/* ===== Pools: what each one is, checked before its first read =====
   A query for a v2 pair's topics on a v3 pool is answered with [] — no error, no hint. Walked like that, the pool would be
   "complete" with no trades and every buy in it would be a made-up $0. So each pool answers three calls once (factory(),
   getReserves(), slot0()) and only a pool that answers like exactly one kind is read, with that kind's events. The node
   answers a call the contract refused (a revert) with an error, which the server's rpcBatch hands over as null — the
   same null as an item it refused for its own reason — so an answer that places nothing is checked again after
   POOL_RECHECK_MS, and an answer that places a pool is kept for good (a contract's code does not change).
   factories (createTape deps): when given, { factory address → 'v2' | 'v3' }, a pool must also come from one of them —
   a fork with the same functions but its own events (Solidly's Swap, PancakeSwap v3's) is otherwise read as empty. */
function poolKindGet(db, pool) {
  const r = st(db, 'SELECT kind, factory, why, at FROM tape_pools WHERE pool = ?').get(addrOf(pool, 'pool'));
  return r ? { kind: r.kind, factory: r.factory, why: r.why, at: r.at } : null;
}
function poolKindPut(db, pool, v, at) {
  st(db, `INSERT INTO tape_pools (pool, kind, factory, why, at) VALUES (?,?,?,?,?)
    ON CONFLICT(pool) DO UPDATE SET kind = excluded.kind, factory = excluded.factory, why = excluded.why, at = excluded.at`)
    .run(pool, v.kind, v.factory, v.why, at);
}
const wordsOf = (r) => (typeof r === 'string' && /^0x(?:[0-9a-fA-F]{64})+$/.test(r) ? (r.length - 2) / 64 : 0);
/* What a pool's three answers say it is (pure): [factory(), getReserves(), slot0()] as the batch returned them (null:
   refused). Returns { kind: 'v2' | 'v3' | null, factory, why } — why says what it answered when kind is null. */
function poolKindOf(ans, factories) {
  const [fa, ra, sa] = ans || [];
  const factory = wordsOf(fa) === 1 && /^0x0{24}/.test(fa) ? '0x' + fa.slice(26).toLowerCase() : null;
  const v2 = wordsOf(ra) === 3, v3 = wordsOf(sa) === 7;
  const shape = v2 && !v3 ? 'v2' : v3 && !v2 ? 'v3' : null;
  if (factories) {
    const want = factory ? factories.get(factory) : null;
    if (!want) return { kind: null, factory, why: factory ? 'made by a factory this tape does not read (' + factory + ')' : 'no factory() answer: not a pool this tape reads' };
    if (shape !== want) return { kind: null, factory, why: 'its factory makes ' + want + ' pools, but it does not answer like one' };
    return { kind: want, factory, why: null };
  }
  if (shape) return { kind: shape, factory, why: null };
  return { kind: null, factory, why: v2 && v3 ? 'it answers like both a v2 pair and a v3 pool' : 'it answers neither getReserves() nor slot0(): not a v2 pair or a v3 pool' };
}

/* ===== Transfers: the ledger's appends, and how they meet the walker's back-fill =====
   Two cursors per token. 'transfer:<token>' is the tape: complete from the token's start through its block. 'transfer-live:
   <token>' is what the ledger has appended while the tape was behind it: from `since` through `block`, without a gap. When
   the tape reaches since − 1 (the walker's back-fill stops exactly there), the two join and the live cursor goes. So the
   ledger's reads are never repeated, and the walker reads only what the ledger read before the tape existed. */
function mergeLive(db, token, at, start) {
  const live = cursorGet(db, liveKey(token)); if (!live) return false;
  const main = cursorGet(db, transferKey(token));
  const reached = main ? main.block : (Number.isSafeInteger(start) ? start - 1 : null);   // no tape yet: a start at or before `since` means nothing lies between
  if (reached == null || reached < live.since - 1) return false;
  cursorSet(db, transferKey(token), Math.max(reached, live.block), at, main ? main.since : start);
  st(db, 'DELETE FROM tape_cursor WHERE stream = ?').run(liveKey(token));
  return true;
}
// complete through which block, the tape and the ledger's appends together (null: never read)
function transfersThrough(db, token) {
  const tok = addrOf(token, 'token');
  const main = cursorGet(db, transferKey(tok)), live = cursorGet(db, liveKey(tok));
  if (!main) return null;
  return live && main.block >= live.since - 1 ? Math.max(main.block, live.block) : main.block;
}

/* A log, field by field — never spread, never `blockTimestamp` (see the header). Throws on a log it cannot place. */
function pick(l) {
  if (!l || typeof l !== 'object') throw new Error('the chain answered with something that is not a log');
  const block = hexInt(l.blockNumber), i = hexInt(l.logIndex), tx = lc(l.transactionHash);
  if (block == null || i == null || !HASH_RE.test(tx)) throw new Error('a log with no block, index or transaction');
  const topics = Array.isArray(l.topics) ? l.topics.map(lc) : [];
  if (topics.some((t) => !TOPIC_RE.test(t))) throw new Error('a log with a malformed topic');
  const data = lc(l.data == null || l.data === '' ? '0x' : l.data);
  if (!/^0x(?:[0-9a-f]{2})*$/.test(data)) throw new Error('a log with malformed data');
  return { block, i, tx, address: l.address == null ? null : lc(l.address), topics, data, removed: l.removed === true };
}
/* A Transfer as the ledger folds it (server.js ledgerApply): at least three topics, the value in its data ("0x" is 0) —
   the same rule, so the tape and the ledger's balances can never disagree about which logs count. */
function transferRow(p) {
  if (p.topics.length < 3) return null;
  let v; try { v = BigInt(p.data === '0x' ? '0x0' : p.data); } catch { return null; }
  return { block: p.block, i: p.i, tx: p.tx, from: topicAddr(p.topics[1]), to: topicAddr(p.topics[2]), value: v };
}
function putTransfers(db, token, rows) {
  const ins = st(db, 'INSERT OR IGNORE INTO coin_tape (token, block, log_index, tx, from_addr, to_addr, value) VALUES (?,?,?,?,?,?,?)');
  let added = 0;
  for (const r of rows) added += ins.run(token, r.block, r.i, r.tx, r.from, r.to, r.value.toString()).changes;
  return added;
}
/* What the ledger calls with the Transfer logs it has just read, inside its own transaction: ledgerApply(tok, logs, upTo)
   with range = { from, upTo }, the window it read. Synchronous; repeated logs are ignored (a log is (token, block,
   log_index)). Without a range the rows are kept but no cursor moves — nothing says the batch was the whole window.
   Throws on a log it cannot keep (another address or event, a malformed one, one outside the range) before it writes
   anything, and on a failed write after rolling back its own savepoint — so a throw leaves none of this call's rows and
   no cursor moved. The rethrow still reaches the caller: inside ledgerApply's BEGIN the call MUST be wrapped like
   dh_hook (its own SAVEPOINT, try/catch, ROLLBACK TO, a warning), or the ledger's batch rolls back with it and the
   ledger re-reads the same logs and fails the same way on every pass. A batch the tape refused is not lost: the next
   append no longer meets the cursor, the ledger's stretch starts over there, and the walker back-fills the gap. */
function appendTransfers(db, token, logs, range, at) {
  const tok = addrOf(token, 'token');
  const when = Number.isFinite(at) ? at : Date.now();
  const rows = [];
  for (const l of logs || []) {
    const p = pick(l);
    if (p.removed) continue;
    if (p.address != null && p.address !== tok) throw new Error('a log of another address in this token’s transfers');
    if (p.topics[0] !== TOPICS.Transfer) throw new Error('a log that is not a Transfer in this token’s transfers');
    const r = transferRow(p); if (r) rows.push(r);
  }
  const from = range && range.from, upTo = range && range.upTo;
  const ranged = Number.isSafeInteger(from) && Number.isSafeInteger(upTo) && from >= 0 && upTo >= from - 1;
  if (ranged && rows.some((r) => r.block < from || r.block > upTo)) throw new Error('a transfer outside the window it was read for');
  return atomic(db, () => {
    const added = putTransfers(db, tok, rows);
    let cursor = null;
    if (ranged && upTo >= from) {
      const main = cursorGet(db, transferKey(tok)), live = cursorGet(db, liveKey(tok));
      if (main && main.block >= from - 1) { cursorSet(db, transferKey(tok), upTo, when); cursor = 'tape'; }
      else if (live && live.since <= from && live.block >= from - 1) { cursorSet(db, liveKey(tok), upTo, when); cursor = 'live'; }
      else {
        /* the tape is behind the ledger, or the ledger's appends left a gap (a rebuild): they count from here on, and the
           walker's back-fill fills everything before (the rows already kept are simply not added twice) */
        st(db, 'DELETE FROM tape_cursor WHERE stream = ?').run(liveKey(tok));
        st(db, 'INSERT INTO tape_cursor (stream, block, since, at) VALUES (?,?,?,?)').run(liveKey(tok), upTo, from, when);
        cursor = 'live';
      }
      mergeLive(db, tok, when);
    }
    return { rows: rows.length, added, cursor };
  });
}

/* ===== Pool events ===== */
function poolRow(p, wantKind, version) {
  const ev = POOL_EVENTS[version || 'v2'];
  const kind = ev.kindOf.get(p.topics[0]);
  if (!kind || (wantKind && kind !== wantKind)) throw new Error('a pool log of an event this stream did not ask for');
  const sh = ev.shape[kind];
  // a pool event this reader cannot decode is never kept as if it were one (the stream stops with the reason instead)
  if (p.topics.length !== sh.topics || p.data.length !== 2 + 64 * sh.words) throw new Error('a ' + (version === 'v3' ? 'v3 ' : '') + kind + ' this reader cannot decode');
  return { kind, block: p.block, i: p.i, tx: p.tx, data: p.data };
}
function putPoolEvents(db, pool, rows) {
  const ins = st(db, 'INSERT OR IGNORE INTO pool_events (pool, kind, block, log_index, tx, data) VALUES (?,?,?,?,?,?)');
  let added = 0;
  for (const r of rows) added += ins.run(pool, r.kind, r.block, r.i, r.tx, r.data).changes;
  return added;
}

/* ===== Streams ===== */
/* A pool's streams, one per event kind. `topics` names the v2 pair's event; the walk asks a pool the check found to be a
   v3 pool for its own (TOPICS_V3), under the same stream key and kind name. */
function poolStreams(pool, opts) {
  const p = addrOf(pool, 'pool');
  const kinds = (opts && opts.kinds) || POOL_KINDS;
  return kinds.map((kind) => {
    if (!SHAPE[kind]) throw new Error('not a pool event: ' + kind);
    return { key: poolKey(p, kind), type: 'pool', address: p, topics: [TOPICS[kind]], kind, start: (opts && opts.start) || 0 };
  });
}
/* A token's Transfers read by the walker. `until`: the ledger's block when the ledger feeds this token (appendTransfers):
   the walker then only back-fills up to it and leaves everything after to the ledger, so no Transfer is read twice. */
function transferStream(token, opts) {
  const t = addrOf(token, 'token');
  return { key: transferKey(t), type: 'transfer', address: t, topics: [TOPICS.Transfer], token: t, start: (opts && opts.start) || 0,
           until: opts && Number.isSafeInteger(opts.until) ? opts.until : null };
}
/* The pin: one address, one value per topic position (a value or null), nothing else. A query the node would cap at
   100,000 blocks is refused here, before it is sent. */
function assertQuery(q) {
  if (!q || typeof q.address !== 'string' || !ADDR_RE.test(q.address)) throw new Error('a log query names exactly one address');
  if (!Array.isArray(q.topics) || !q.topics.length || q.topics.length > 4) throw new Error('a log query names its event');
  for (const t of q.topics) if (!(t === null || (typeof t === 'string' && TOPIC_RE.test(t)))) throw new Error('one value per topic position: the node caps a query with several at ' + MULTI_VALUE_SPAN_MAX.toLocaleString('en-US') + ' blocks');
  if (q.topics[0] === null) throw new Error('a log query names its event');
}

/* ===== Windows ===== */
// the last block of a window that starts at `from`, at most `span` long: on a cell line (…9,999) when it can be, never past `cap`
function windowEnd(from, span, cap) {
  const next = (Math.floor(from / CELL) + 1) * CELL;
  const to = span >= CELL ? Math.floor((from + span) / CELL) * CELL - 1 : Math.min(from + span - 1, next - 1);
  return cap != null ? Math.min(to, cap) : to;
}
// a refused window's piece size: a quarter, in whole cells while a cell or more
const quarterSize = (span) => (span > CELL ? Math.ceil(span / 4 / CELL) * CELL : Math.max(LIMITS.MIN_WINDOW, Math.ceil(span / 4)));
/* A refused window in about four pieces, each on cell lines while a cell or more (so a quartered read meets the grid too).
   A window that starts off a cell line has a short first piece (up to the line): that is alignment, not the size. */
function quarters(f, t) {
  const size = quarterSize(t - f + 1);
  const out = [];
  for (let a = f; a <= t;) { const b = windowEnd(a, size, t); out.push([a, b]); a = b + 1; }
  return out;
}
// a span the node named, as a window size: whole cells when it is a cell or more
const pinned = (n) => (n >= CELL ? Math.floor(n / CELL) * CELL : n);

/* The run's budget is spent. Every public function turns it into a result ({ stopped: 'budget' }); it is an Error all
   the same, so if one ever escaped, a caller's `'…' + e.message` could still print it (a Symbol would throw there). */
const STOP = Object.assign(new Error('the tape’s read budget for this run is spent'), { budget: true });   // not frozen: a caller may tag an error it catches
const cooling = () => Object.assign(new Error('tape cooling down after a rate limit'), { cooling: true });
// what stops a whole walk: the budget, the cool-down, the node's refusal. Anything else is one stream's failure.
const stopsAll = (e) => e === STOP || !!(e && e.cooling) || isThrottle(e);

/* ===== The tape, with the server's readers =====
   deps:
     db                          node:sqlite DatabaseSync (migrate() is called here)
     rpc(method, params, w)      one read, through the server's pace at weight w; throws with the node's own words
     pacedBatch(calls, w)        one batch ([[method, params], …]) at total weight w; an item the node refused for its own
                                 reason comes back null (server.js rpcBatch), a throttle throws
     coolUntil()                 the ledger's cool-down (server.js ledgerCoolUntil): nothing is asked before it
     cool(err)                   the node refused: stand every ledger-class read down (server: ledgerCoolUntil = now + LEDGER_COOL_MS)
     now(), sleep(ms)            the clock (tests pass their own)
     weights                     the pace weights (WEIGHTS)
     settle                      blocks the walker stays behind the head (default LIMITS.SETTLE_BLOCKS; a walk's opts.settle wins)
     factories                   { factory address → 'v2' | 'v3' }: when given, only pools from these factories are read (see Pools)
     crypto { enc, dec, idx }    the server's encField / decField / bidx — receipts are kept only when given */
function createTape(deps = {}) {
  const db = deps.db;
  if (!db || typeof db.prepare !== 'function') throw new Error('createTape needs the database');
  const now = deps.now || Date.now;
  const nap = deps.sleep || sleep;
  const W = { ...WEIGHTS, ...(deps.weights || {}) };
  const crypto = deps.crypto && typeof deps.crypto.enc === 'function' && typeof deps.crypto.dec === 'function' && typeof deps.crypto.idx === 'function' ? deps.crypto : null;
  const settleOf = (opts) => { const n = opts && opts.settle != null ? opts.settle : deps.settle != null ? deps.settle : LIMITS.SETTLE_BLOCKS; if (!Number.isSafeInteger(n) || n < 0) throw new Error('settle is a number of blocks'); return n; };
  settleOf(null);   // a bad deps.settle fails here, not on the first tick
  let factories = null;
  if (deps.factories) {
    factories = new Map();
    for (const [a, k] of deps.factories instanceof Map ? deps.factories : Object.entries(deps.factories)) {
      if (k !== 'v2' && k !== 'v3') throw new Error('a factory makes v2 or v3 pools');
      factories.set(addrOf(a, 'factory'), k);
    }
  }
  migrate(db);
  const weightOf = (span) => (span > W.nearSpan ? W.log : W.logNear);
  let busy = null;

  // before every request: the cool-down, then the run's budget
  function gate(run) {
    if (deps.coolUntil && now() < deps.coolUntil()) throw cooling();
    if (run.left != null) { if (run.left <= 0) throw STOP; run.left--; }
    run.reads++;
  }
  function refused(e) { if (isThrottle(e) && deps.cool) { try { deps.cool(e); } catch {} } return e; }
  async function one(run, method, params, w) {
    gate(run); run.weight += w;
    try { return await deps.rpc(method, params, w); } catch (e) { throw refused(e); }
  }
  async function batch(run, calls, w) {
    gate(run); run.weight += w;
    let r;
    try { r = await deps.pacedBatch(calls, w); } catch (e) { throw refused(e); }
    if (!Array.isArray(r) || r.length !== calls.length) throw new Error('the chain did not answer');
    return r;
  }
  const query = (s, f, t) => { const q = { address: s.address, topics: s.topics.slice(), fromBlock: hx(f), toBlock: hx(t) }; assertQuery(q); return q; };

  /* One window on its own: a slow answer is asked again (twice), a refused one is quartered (or cut to the span the node
     names) and read piece by piece, each piece kept before the next is asked — so a walk cut off inside a refused window
     still keeps what it read. A window of MIN_WINDOW blocks that is still refused is too dense to read here.
     After a refusal the stream goes on at the quarter's size (not the first piece's, which can be a short stub up to a
     cell line) and doubles again on small answers: a refusal says the window it named is dense, nothing about the blocks
     after it — one busy launch hour must not set the size for tens of millions of quiet blocks. Only a span the node
     itself names ("only N blocks are allowed") is a ceiling for the rest of the walk. */
  async function readAlone(run, s, f, t) {
    for (let tries = 0; ;) {
      let out;
      try { out = await one(run, 'eth_getLogs', [query(s, f, t)], weightOf(t - f + 1)); }
      catch (e) {
        if (stopsAll(e)) throw e;
        const m = msgOf(e), slow = SLOW_RE.test(m), span = t - f + 1, cap = spanOf(m);
        if (slow && tries < LIMITS.SLOW_TRIES) { tries++; await nap(LIMITS.SLOW_WAIT_MS); continue; }
        if (cap >= LIMITS.MIN_WINDOW && cap < span) {
          s.window = s.ceiling = pinned(cap);
          for (let a = f; a <= t;) { const b = windowEnd(a, s.window, t); await readAlone(run, s, a, b); a = b + 1; }
          return;
        }
        if (TOO_MANY_RE.test(m) && span > LIMITS.MIN_WINDOW) {
          for (const [a, b] of quarters(f, t)) await readAlone(run, s, a, b);
          s.window = Math.min(s.ceiling, quarterSize(span));   // set after the pieces, so the outermost refusal's size is the one that stays
          return;
        }
        if (!slow && TOO_MANY_RE.test(m)) throw new Error('too dense: one ' + span + '-block window holds more logs than the node will return');
        throw e;
      }
      if (!Array.isArray(out)) throw new Error('the chain did not answer');
      s.sink(out, t);
      return;
    }
  }

  /* The walk: every stream from its cursor to its end, a round at a time. A round is ONE batch — each active stream's next
     windows, one query per (address, event) — and each answer is kept, with its stream's cursor, before the next is
     asked. An item the batch came back without is read on its own (so its refusal has words); a batch that was too
     slow or too large is read window by window, and the rest of the walk sends smaller batches.
     A stream's own failure (an answer it cannot keep, a window too dense, a node error on its read) is caught right here:
     that stream stops for this walk with its reason (onFail holds it), and every other item of the round — whose answers
     have already arrived — and every later round go on. Only the budget, the cool-down and a throttle stop the walk. A
     whole batch the node failed (an HTTP 502, a malformed answer) names no stream: it ends the walk, as before. */
  async function walkList(list, run, onFail) {
    let perBatch = LIMITS.BATCH_WINDOWS;
    for (;;) {
      const active = list.filter((s) => !s.error && s.from <= s.end);
      if (!active.length) return;
      const share = Math.max(1, Math.floor(perBatch / active.length));
      const items = [];
      for (const s of active) {
        let f = s.from;
        for (let k = 0; k < share && f <= s.end && items.length < perBatch; k++) { const t = windowEnd(f, s.window, s.end); items.push({ s, f, t }); f = t + 1; }
        if (items.length >= perBatch) break;
      }
      const calls = items.map((x) => ['eth_getLogs', [query(x.s, x.f, x.t)]]);
      let outs = null;
      try { outs = await batch(run, calls, items.reduce((w, x) => w + weightOf(x.t - x.f + 1), 0)); }
      catch (e) {
        if (stopsAll(e)) throw e;
        if (!TOO_MANY_RE.test(msgOf(e))) throw e;
        perBatch = Math.max(1, Math.floor(perBatch / 2));   // too slow or too large as a batch: these windows alone, smaller batches after
      }
      for (let k = 0; k < items.length; k++) {
        const { s, f, t } = items[k];
        if (s.error) continue;   // it failed earlier in this round: its later windows wait for the next walk
        const out = outs ? outs[k] : null;
        try {
          if (f !== s.from) throw new Error('the tape lost its place in a stream');   // pieces of a refused window always end where it ended: never expected
          if (Array.isArray(out)) {
            s.sink(out, t);
            if (out.length < LIMITS.SMALL_ANSWER) s.window = Math.min(s.window * 2, s.ceiling);
          } else await readAlone(run, s, f, t);
        } catch (e) {
          if (stopsAll(e)) throw e;
          s.error = msgOf(e) || 'the stream failed';
          if (onFail) onFail(s, e);
        }
      }
    }
  }

  /* Each pool's kind (see Pools), read from tape_pools or checked now: Map(pool → { kind, factory, why, transient? }).
     A check batch the node failed (not a throttle) leaves its pools unplaced for this walk only — nothing is kept. */
  async function checkPools(run, list) {
    const out = new Map(), ask = [];
    for (const p of new Set(list.filter((s) => s.type === 'pool').map((s) => s.address))) {
      const k = poolKindGet(db, p);
      if (k && (k.kind || now() - k.at < LIMITS.POOL_RECHECK_MS)) out.set(p, k); else ask.push(p);
    }
    for (let i = 0; i < ask.length; i += LIMITS.POOL_BATCH) {
      const part = ask.slice(i, i + LIMITS.POOL_BATCH), calls = [];
      for (const p of part) for (const sel of [SEL.factory, SEL.getReserves, SEL.slot0]) calls.push(['eth_call', [{ to: p, data: sel }, 'latest']]);
      let ans;
      try { ans = await batch(run, calls, calls.length * W.call); }
      catch (e) {
        if (stopsAll(e)) throw e;
        for (const p of part) out.set(p, { kind: null, factory: null, why: 'the pool check failed: ' + msgOf(e), transient: true });
        continue;
      }
      const at = now();
      atomic(db, () => part.forEach((p, k) => { const v = poolKindOf(ans.slice(3 * k, 3 * k + 3), factories); poolKindPut(db, p, v, at); out.set(p, { ...v, at }); }));
    }
    return out;
  }

  // a stream's state for one walk: where it goes on from and where it stops (`end`: the head less the settle margin)
  function prepare(s, end, kinds) {
    const st0 = Number.isSafeInteger(s.start) && s.start > 0 ? s.start : 0;
    const x = { ...s, window: WINDOW_MAX, ceiling: WINDOW_MAX, added: 0, first: null, error: null, version: null, hold: holdGet(db, s.key) };
    // a kept window clears the stream's hold (its failure is behind it), inside the same savepoint as the window's rows
    const unhold = () => { if (x.hold) st(db, 'DELETE FROM tape_holds WHERE stream = ?').run(s.key); };
    if (s.type === 'transfer') {
      mergeLive(db, s.token, now(), st0);
      const main = cursorGet(db, transferKey(s.token)), live = cursorGet(db, liveKey(s.token));
      x.from = main ? main.block + 1 : st0;
      x.end = Math.min(end, s.until != null ? s.until : Infinity, live ? live.since - 1 : Infinity);
      x.sink = (logs, upTo) => {
        const rows = [];
        for (const l of logs) {
          const p = pick(l);
          if (p.removed) continue;
          if (p.address !== s.address || p.topics[0] !== TOPICS.Transfer) throw new Error('the chain answered with a log this query did not ask for');
          if (p.block < x.from || p.block > upTo) throw new Error('the chain answered with a log outside the window asked for');
          const r = transferRow(p); if (r) rows.push(r);
        }
        atomic(db, () => {
          x.added += putTransfers(db, s.token, rows);
          cursorSet(db, transferKey(s.token), upTo, now(), st0);
          mergeLive(db, s.token, now(), st0);
          unhold();
        });
        x.hold = null;
        if (x.first == null) x.first = x.from;
        x.from = upTo + 1;
      };
    } else {
      const c = cursorGet(db, s.key);
      x.from = c ? c.block + 1 : st0;
      x.end = end;
      // the pool's kind picks the events asked for; a pool the check could not place is not read at all (no cursor: unknown)
      const pk = kinds.get(s.address), ev = pk && pk.kind ? POOL_EVENTS[pk.kind] : null;
      if (!pk) x.error = 'the pool was not checked';
      else if (!ev) x.error = pk.transient ? pk.why : 'not a pool this tape reads: ' + pk.why;
      else if (!ev.topics[s.kind]) x.error = 'a ' + pk.kind + ' pool has no ' + s.kind + ' event';
      else { x.version = pk.kind; x.topics = [ev.topics[s.kind]]; }
      x.sink = (logs, upTo) => {
        const rows = [];
        for (const l of logs) {
          const p = pick(l);
          if (p.removed) continue;
          if (p.address !== s.address) throw new Error('the chain answered with a log this query did not ask for');
          if (p.block < x.from || p.block > upTo) throw new Error('the chain answered with a log outside the window asked for');
          rows.push(poolRow(p, s.kind, x.version));
        }
        atomic(db, () => { x.added += putPoolEvents(db, s.address, rows); cursorSet(db, s.key, upTo, now(), st0); unhold(); });
        x.hold = null;
        if (x.first == null) x.first = x.from;
        x.from = upTo + 1;
      };
    }
    if (!x.error && x.hold && now() < x.hold.until) x.error = 'held after a failure in the window from block ' + x.hold.block + ' (' + x.hold.why + ') until ' + new Date(x.hold.until).toISOString();
    return x;
  }

  async function headOf(run, opts) {
    if (opts && opts.head != null) { if (!Number.isSafeInteger(opts.head) || opts.head < 0) throw new Error('the head is a block number'); return opts.head; }
    const h = hexInt(await one(run, 'eth_blockNumber', [], 1));
    if (h == null) throw new Error('the chain gave no head block');
    return h;
  }
  const newRun = (opts) => ({ left: opts && Number.isSafeInteger(opts.maxReads) ? opts.maxReads : null, reads: 0, weight: 0 });

  /* Walk streams (poolStreams / transferStream) to the head less the settle margin (opts.head: e.g. the ledger's block, so
     the pools and the transfers end in the same place; else the node's; opts.settle, else deps.settle, else
     SETTLE_BLOCKS). Each pool is checked once before its first read (see Pools). opts.maxReads bounds the requests (a
     tick does a little, the back-fill more): a walk that spends it stops cleanly, stopped 'budget', and the cursors say
     where. One walk at a time per tape (a second one answers busy).
     A stream that fails — or is held, or is a pool the check could not place — is listed in `failed` with its reason and
     the walk goes on without it; complete is true only when every stream reached the end. Throws only when the node
     stood the tape down (cool() called, or still cooling) or failed a whole batch, which names no stream. */
  async function walk(streams, opts = {}) {
    if (busy) return { busy: true, complete: false, stopped: 'busy' };
    const r = newRun(opts);
    busy = (async () => {
      const settle = settleOf(opts);
      let head = null, list = [], stopped = null, dated = null;
      try {
        head = await headOf(r, opts);   // inside the try: a budget of 0 is a result, never a rejection
        const byKey = new Map(); for (const s of streams || []) if (!byKey.has(s.key)) byKey.set(s.key, s);   // a stream named twice is walked once
        const uniq = [...byKey.values()];
        const kinds = await checkPools(r, uniq);
        list = uniq.map((s) => prepare(s, head - settle, kinds));
        await walkList(list, r, (s, e) => { const h = holdSet(db, s.key, s.from, msgOf(e), now()); s.hold = { ...h, block: s.from, why: msgOf(e) }; });
      } catch (e) { if (e === STOP) stopped = 'budget'; else throw e; }
      if (!stopped && opts.date !== false) { const d = await dateSwapRun(r, opts); dated = d; if (d.stopped) stopped = d.stopped; }
      const failed = list.filter((x) => x.error).map((x) => ({ stream: x.key, why: x.error }));
      return { head, settled: head == null ? null : head - settle, complete: !stopped && !failed.length, stopped, failed, reads: r.reads, weight: r.weight, dated,
               streams: list.map((x) => ({ stream: x.key, from: x.first, through: x.from - 1, added: x.added, ...(x.version ? { pool: x.version } : {}), ...(x.error ? { error: x.error } : {}) })) };
    })();
    try { return await busy; } finally { busy = null; }
  }

  /* ----- Block times ----- */
  async function dateBlocks(r, blocks) {
    const want = [...new Set(blocks)].filter((b) => Number.isSafeInteger(b) && b >= 0);
    const have = blockTimesGet(db, want);
    const todo = want.filter((b) => !have.has(b));
    let dated = 0;
    for (let i = 0; i < todo.length; i += LIMITS.BLOCK_BATCH) {
      const part = todo.slice(i, i + LIMITS.BLOCK_BATCH);
      const ans = await batch(r, part.map((b) => ['eth_getBlockByNumber', [hx(b), false]]), part.length * W.block);
      atomic(db, () => {
        const put = st(db, 'INSERT OR IGNORE INTO block_times (block, ts) VALUES (?, ?)');
        part.forEach((b, k) => {
          const a = ans[k];
          /* only the block asked for — its number must be there and be b — with a real time: anything else stays unknown
             and is asked again (never a 0). block_times is INSERT OR IGNORE: a wrong time kept once would never be corrected. */
          if (!a || typeof a !== 'object' || hexInt(a.number) !== b) return;
          const ts = hexInt(a.timestamp);
          if (!(ts > 0)) return;
          put.run(b, ts * 1000); have.set(b, ts * 1000); dated++;
        });
      });
    }
    return { have, dated, asked: todo.length };
  }
  // the blocks a Swap sat in and that have no time yet: oldest first; a block the node would not date this run is not asked again in it
  async function dateSwapRun(r, opts) {
    const limit = opts && Number.isSafeInteger(opts.dateMax) ? opts.dateMax : Infinity;
    let after = -1, dated = 0, asked = 0, stopped = null;
    try {
      for (;;) {
        const room = Math.min(500, limit - asked); if (room <= 0) break;
        const rows = st(db, `SELECT DISTINCT e.block AS b FROM pool_events e WHERE e.kind = 'Swap' AND NOT EXISTS (SELECT 1 FROM block_times t WHERE t.block = e.block)
          AND e.block > ? ORDER BY e.block LIMIT ?`).all(after, room).map((x) => x.b);
        if (!rows.length) break;
        after = rows[rows.length - 1];   // oldest first, and never the same block twice in one run
        const d = await dateBlocks(r, rows); dated += d.dated; asked += d.asked;
      }
    } catch (e) { if (e === STOP) stopped = 'budget'; else throw e; }
    const left = st(db, `SELECT COUNT(DISTINCT e.block) n FROM pool_events e WHERE e.kind = 'Swap' AND NOT EXISTS (SELECT 1 FROM block_times t WHERE t.block = e.block)`).get().n;
    return { dated, asked, undated: left, stopped };
  }
  async function dateSwapBlocks(opts = {}) {
    if (busy) return { busy: true, stopped: 'busy' };
    const r = newRun(opts);
    busy = (async () => ({ ...(await dateSwapRun(r, opts)), reads: r.reads, weight: r.weight }))();
    try { return await busy; } finally { busy = null; }
  }
  /* The blocks the engine needs a time for (a transfer's arrival, say): what is kept, plus a read of the rest. Returns
     Map(block → ms) of every block that has a time now; a block the node did not date is simply not in it. */
  async function ensureBlockTimes(blocks, opts = {}) {
    const r = newRun(opts);
    try { return (await dateBlocks(r, blocks || [])).have; }
    catch (e) { if (e === STOP) return blockTimesGet(db, blocks || []); throw e; }
  }

  /* Logs for a caller that keeps its own cursor (a member's wallet in a token with no tape: its cursor is encrypted in
     acq_state). The same windows, refusals and pin as the tape's own walks; nothing is stored. queries: [{ address,
     topics }] — e.g. [TOPICS.Transfer, addrTopic(wallet)] and [TOPICS.Transfer, null, addrTopic(wallet)]. The caller
     picks `to`: like the walker, it should stop SETTLE_BLOCKS behind the head if it keeps what it reads for good.
     Returns one array per query of { block, logIndex, tx, address, topics, data }, in chain order, and through[n], the
     block query n is complete through. A query that failed is listed in `errors` ({ query, why }) with what it read
     before the failure; the other queries go on (complete: false). Nothing is held: the caller decides when to ask again. */
  async function readLogs(queries, from, to, opts = {}) {
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0) throw new Error('a block range');
    const r = newRun(opts);
    const res = (queries || []).map(() => []);
    const list = (queries || []).map((q, n) => {
      const s = { key: 'read:' + n, address: lc(q.address), topics: (q.topics || []).map((t) => (t == null ? null : lc(t))), window: WINDOW_MAX, ceiling: WINDOW_MAX, from, end: to };
      assertQuery(s);
      const seen = new Set();
      s.sink = (logs, upTo) => {
        const rows = [];   // the whole window checked before any of it is handed back: a window that fails adds nothing
        for (const l of logs) {
          const p = pick(l);
          if (p.removed) continue;
          if (p.address !== s.address || p.topics[0] !== s.topics[0]) throw new Error('the chain answered with a log this query did not ask for');
          if (p.block < s.from || p.block > upTo) throw new Error('the chain answered with a log outside the window asked for');
          rows.push({ block: p.block, logIndex: p.i, tx: p.tx, address: p.address, topics: p.topics, data: p.data });
        }
        for (const x of rows) { const k = x.block + ':' + x.logIndex; if (seen.has(k)) continue; seen.add(k); res[n].push(x); }
        s.from = upTo + 1;
      };
      return s;
    });
    let stopped = null;
    try { await walkList(list, r); } catch (e) { if (e === STOP) stopped = 'budget'; else throw e; }
    for (const a of res) a.sort((x, y) => x.block - y.block || x.logIndex - y.logIndex);
    const errors = list.map((s, n) => (s.error ? { query: n, why: s.error } : null)).filter(Boolean);
    return { logs: res, complete: !stopped && !errors.length, stopped, errors, through: list.map((s) => s.from - 1), reads: r.reads, weight: r.weight };
  }

  /* ----- Receipts (tokens with no tape) -----
     Read in batches, kept once mined (a mined receipt is final). A receipt the node did not have (not mined, or refused) is
     null — unknown, asked again next time, never kept. Kept only with the server's crypto. */
  async function receipts(txs, opts = {}) {
    const want = [...new Set((txs || []).map(lc))];
    for (const h of want) if (!HASH_RE.test(h)) throw new Error('not a transaction hash');
    const out = receiptsGet(db, crypto, want);
    const todo = want.filter((h) => !out.has(h));
    const r = newRun(opts);
    let stopped = null;
    try {
      for (let i = 0; i < todo.length; i += LIMITS.RECEIPT_BATCH) {
        const part = todo.slice(i, i + LIMITS.RECEIPT_BATCH);
        const ans = await batch(r, part.map((h) => ['eth_getTransactionReceipt', [h]]), part.length * W.receipt);
        const keep = [];
        part.forEach((h, k) => { const e = compactReceipt(ans[k], h); out.set(h, e); if (e && e.logs.length <= LIMITS.RECEIPT_LOGS_MAX) keep.push(e); });
        if (crypto && keep.length) receiptsPut(db, crypto, keep, now());
      }
    } catch (e) { if (e === STOP) stopped = 'budget'; else throw e; }
    for (const h of want) if (!out.has(h)) out.set(h, null);
    return opts.withStatus ? { receipts: out, complete: !stopped, stopped, reads: r.reads } : out;
  }

  return {
    walk, dateSwapBlocks, ensureBlockTimes, readLogs, receipts,
    appendTransfers: (token, logs, range) => appendTransfers(db, token, logs, range, now()),
    tapeHead: (token, pools, opts) => tapeHead(db, token, pools, opts),
    transfersThrough: (token) => transfersThrough(db, token),
    poolKind: (pool) => poolKindGet(db, pool),
    busy: () => !!busy,
  };
}

/* ===== Receipts: compact, encrypted ===== */
// what the engine reads of a receipt: who sent it (and whose UserOperations ran in it), and every ERC-20 Transfer in log order
function compactReceipt(rc, want) {
  if (!rc || typeof rc !== 'object' || rc.blockNumber == null) return null;
  if (lc(rc.transactionHash) !== want) throw new Error('the chain answered with another transaction’s receipt');
  const block = hexInt(rc.blockNumber);
  if (block == null) return null;
  const logs = [], ops = [];
  for (const l of rc.logs || []) {
    const p = pick(l);
    if (p.removed) continue;
    if (ENTRY_POINTS.has(p.address) && p.topics.length === 4 && p.topics[0] === USEROP_TOPIC && /^0x[0-9a-f]{256}/.test(p.data)) {
      if (BigInt('0x' + p.data.slice(66, 130)) === 1n) ops.push(topicAddr(p.topics[2]));
      continue;
    }
    // an ERC-20 Transfer: three topics and one word (an NFT's has four topics and no value)
    if (p.topics.length !== 3 || p.topics[0] !== TOPICS.Transfer || p.data.length !== 66 || !ADDR_RE.test(p.address || '')) continue;
    logs.push({ i: p.i, address: p.address, from: topicAddr(p.topics[1]), to: topicAddr(p.topics[2]), value: BigInt(p.data) });
  }
  const status = rc.status == null ? null : hexInt(rc.status);
  return { tx: want, block, status, from: lc(rc.from), to: rc.to ? lc(rc.to) : null, ops, logs };
}
const packReceipt = (e) => JSON.stringify({ v: 1, b: e.block, s: e.status, f: e.from, t: e.to, o: e.ops, l: e.logs.map((x) => [x.i, x.address, x.from, x.to, x.value.toString()]) });
function unpackReceipt(tx, s) {
  let j; try { j = JSON.parse(s); } catch { return null; }
  if (!j || j.v !== 1 || !Number.isSafeInteger(j.b) || !Array.isArray(j.l)) return null;
  return { tx, block: j.b, status: j.s, from: j.f, to: j.t, ops: j.o || [], logs: j.l.map(([i, a, f, t, v]) => ({ i, address: a, from: f, to: t, value: BigInt(v) })) };
}
function receiptsGet(db, crypto, txs) {
  const out = new Map();
  if (!crypto) return out;
  const q = st(db, 'SELECT body_enc FROM tape_receipts WHERE tx_idx = ?');
  for (const h of txs) {
    const r = q.get(crypto.idx(h)); if (!r) continue;
    let plain = null; try { plain = crypto.dec(r.body_enc); } catch {}
    const e = plain == null ? null : unpackReceipt(h, plain);
    if (e) out.set(h, e);   // a row that will not open is read again from the chain (and rewritten)
  }
  return out;
}
function receiptsPut(db, crypto, entries, at) {
  atomic(db, () => {
    const put = st(db, 'INSERT INTO tape_receipts (tx_idx, body_enc, at) VALUES (?,?,?) ON CONFLICT(tx_idx) DO UPDATE SET body_enc = excluded.body_enc, at = excluded.at');
    for (const e of entries) put.run(crypto.idx(e.tx), crypto.enc(packReceipt(e)), at);
    const n = st(db, 'SELECT COUNT(*) n FROM tape_receipts').get().n;
    if (n > LIMITS.RECEIPT_ROWS_MAX) st(db, 'DELETE FROM tape_receipts WHERE rowid IN (SELECT rowid FROM tape_receipts ORDER BY at, rowid LIMIT ?)').run(n - LIMITS.RECEIPT_ROWS_MAX);
  });
}
/* Receipts read before `before` (ms) go. A receipt can always be read again, so this is the safe way to forget: what an
   account's deletion cannot name (receiptsForget needs the hashes) ages out here. */
function receiptsPrune(db, before) {
  if (!Number.isFinite(before)) throw new Error('a time');
  return st(db, 'DELETE FROM tape_receipts WHERE at < ?').run(before).changes;
}
// a deleted account's receipts (the caller knows their hashes from the account's own state before it goes)
function receiptsForget(db, crypto, txs) {
  if (!crypto) return 0;
  let n = 0;
  for (const h of txs || []) n += st(db, 'DELETE FROM tape_receipts WHERE tx_idx = ?').run(crypto.idx(lc(h))).changes;
  return n;
}

/* ===== Reading the tape back (no chain) ===== */
function blockTimesGet(db, blocks) {
  const out = new Map(), q = st(db, 'SELECT ts FROM block_times WHERE block = ?');
  for (const b of new Set(blocks || [])) { if (!Number.isSafeInteger(b)) continue; const r = q.get(b); if (r) out.set(b, r.ts); }
  return out;
}
const inList = (n) => '(' + new Array(n).fill('?').join(',') + ')';
function chunks(a, n) { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }
// opts.fromBlock / opts.toBlock (inclusive), as SQL and its arguments
function rangeSql(o) {
  const r = { sql: '', args: [] };
  if (o && Number.isSafeInteger(o.fromBlock)) { r.sql += ' AND block >= ?'; r.args.push(o.fromBlock); }
  if (o && Number.isSafeInteger(o.toBlock)) { r.sql += ' AND block <= ?'; r.args.push(o.toBlock); }
  return r;
}
/* A token's Transfers in chain order: all of them, one wallet's (from or to it), or those of some transactions. */
function tapeRows(db, token, opts = {}) {
  const tok = addrOf(token, 'token');
  const map = (r) => ({ block: r.block, i: r.log_index, tx: r.tx, from: r.from_addr, to: r.to_addr, value: BigInt(r.value) });
  const range = rangeSql(opts);
  let rows = [];
  if (opts.txs) {
    for (const part of chunks([...new Set(opts.txs.map(lc))], 400))
      rows.push(...db.prepare('SELECT * FROM coin_tape WHERE token = ? AND tx IN ' + inList(part.length) + range.sql).all(tok, ...part, ...range.args));
  } else if (opts.wallet) {
    // from it, or to it (each through its own index); a transfer to itself is one row, so UNION keeps it once
    const w = addrOf(opts.wallet, 'wallet');
    rows = db.prepare('SELECT * FROM coin_tape WHERE token = ? AND from_addr = ?' + range.sql + ' UNION SELECT * FROM coin_tape WHERE token = ? AND to_addr = ?' + range.sql)
      .all(tok, w, ...range.args, tok, w, ...range.args);
  } else rows = db.prepare('SELECT * FROM coin_tape WHERE token = ?' + range.sql).all(tok, ...range.args);
  return rows.map(map).sort((x, y) => x.block - y.block || x.i - y.i);
}
/* A pool's events in chain order: all, some kinds, or those of some transactions. data is raw (the engine decodes it). */
function poolRows(db, pool, opts = {}) {
  const p = addrOf(pool, 'pool');
  const kinds = opts.kinds || null;
  const kindSql = kinds ? ' AND kind IN ' + inList(kinds.length) : '';
  const range = rangeSql(opts);
  let rows = [];
  if (opts.txs) {
    for (const part of chunks([...new Set(opts.txs.map(lc))], 400))
      rows.push(...db.prepare('SELECT * FROM pool_events WHERE pool = ? AND tx IN ' + inList(part.length) + kindSql + range.sql).all(p, ...part, ...(kinds || []), ...range.args));
  } else rows = db.prepare('SELECT * FROM pool_events WHERE pool = ?' + kindSql + range.sql).all(p, ...(kinds || []), ...range.args);
  return rows.map((r) => ({ pool: r.pool, kind: r.kind, block: r.block, i: r.log_index, tx: r.tx, data: r.data })).sort((x, y) => x.block - y.block || x.i - y.i);
}
/* How far a token's tape can be trusted: the lowest cursor of its streams (its transfers, and each named pool's kinds).
   null with a reason while any stream has never been read, or while a pool is one the check could not place (its trades
   are unknown, never none). `undated`: Swaps up to that block whose block has no time yet (their buys cannot be dated
   until it does). `pools`: each pool's kind ('v2' | 'v3', null: not placed, undefined: not checked yet). `held`: the
   token's streams that failed and wait — the tape is complete through `block` all the same, but will not pass the
   held stream's failure until it is read. */
function tapeHead(db, token, pools, opts = {}) {
  const tok = addrOf(token, 'token');
  const kinds = opts.kinds || POOL_KINDS;
  const streams = {}, missing = [], kindOf = {}, notPools = [];
  const tf = transfersThrough(db, tok);
  streams[transferKey(tok)] = tf; if (tf == null) missing.push(transferKey(tok));
  const ps = (pools || []).map((x) => addrOf(x, 'pool'));
  for (const p of ps) {
    const pk = poolKindGet(db, p);
    kindOf[p] = pk ? pk.kind : undefined;
    if (pk && !pk.kind) notPools.push(p + ' (' + pk.why + ')');
    for (const k of kinds) { const c = cursorGet(db, poolKey(p, k)); streams[poolKey(p, k)] = c ? c.block : null; if (!c) missing.push(poolKey(p, k)); }
  }
  const held = [];
  for (const key of Object.keys(streams)) { const h = holdGet(db, key); if (h) held.push({ stream: key, block: h.block, why: h.why, until: h.until }); }
  const heldWhy = held.length ? 'held: ' + held.map((h) => h.stream + ' at block ' + h.block + ' (' + h.why + ')').join(', ') : null;
  if (notPools.length) return { block: null, streams, pools: kindOf, undated: null, held, why: 'not a pool this tape reads: ' + notPools.join(', ') };
  if (missing.length) return { block: null, streams, pools: kindOf, undated: null, held, why: ['not read yet: ' + missing.join(', '), heldWhy].filter(Boolean).join('; ') };
  const block = Math.min(...Object.values(streams));
  let undated = 0;
  for (const p of ps) undated += st(db, `SELECT COUNT(DISTINCT e.block) n FROM pool_events e WHERE e.pool = ? AND e.kind = 'Swap' AND e.block <= ?
    AND NOT EXISTS (SELECT 1 FROM block_times t WHERE t.block = e.block)`).get(p, block).n;
  const why = [undated ? undated + ' swap block(s) not dated yet' : null, heldWhy].filter(Boolean).join('; ') || null;
  return { block, streams, pools: kindOf, undated, held, why };
}
/* A token that leaves the tape (a community token grown past TAPE_MAX_TRANSFERS): its rows, cursors and holds go. What
   each pool IS (tape_pools) stays: it is a fact about the contract, and costs a check to learn again. */
function tapeDrop(db, token, pools) {
  const tok = addrOf(token, 'token');
  return atomic(db, () => {
    let n = st(db, 'DELETE FROM coin_tape WHERE token = ?').run(tok).changes;
    st(db, 'DELETE FROM tape_cursor WHERE stream IN (?, ?)').run(transferKey(tok), liveKey(tok));
    st(db, 'DELETE FROM tape_holds WHERE stream = ?').run(transferKey(tok));
    for (const p of (pools || []).map((x) => addrOf(x, 'pool'))) {
      n += st(db, 'DELETE FROM pool_events WHERE pool = ?').run(p).changes;
      st(db, 'DELETE FROM tape_cursor WHERE stream LIKE ?').run('pool:' + p + ':%');   // an address has no LIKE wildcard in it
      st(db, 'DELETE FROM tape_holds WHERE stream LIKE ?').run('pool:' + p + ':%');
    }
    return n;
  });
}

module.exports = {
  createTape, migrate, appendTransfers, transfersThrough, tapeHead, tapeRows, poolRows, blockTimesGet, tapeDrop,
  poolStreams, transferStream, cursorGet, cursorSet, assertQuery, windowEnd, quarters, compactReceipt, receiptsForget, receiptsPrune,
  addrTopic, isThrottle, poolKindOf, poolKindGet, holdGet, TOPICS, TOPICS_V3, POOL_KINDS, SHAPE, SHAPE_V3, SEL, CELL, WINDOW_MAX,
  MULTI_VALUE_SPAN_MAX, LIMITS, WEIGHTS, TOO_MANY_RE, TABLES,
};
