/* The coin tape (lib/tape.js) — decision H8 of the "$100 bought" rebuild (owner, 2026-11-17: "make it $100 of value bought
   in the token not the current token value" — "follow the transactions back to the original buy on-chain and make sure
   the buy date is correct for all users"). The tape keeps every $SEND / $GWC Transfer and every Swap, Mint and Burn of
   their pools, with the time of every Swap's block, so the engine can replay a member's history without a chain read.

   Run against a fake node, with no server and no network. The fake serves REAL chain answers where one is kept
   (tests/fixtures/tape: 194 Swaps of the $SEND pool and one $SEND buy's receipt, read from Robinhood Chain's public node on
   2026-11-17) and hand-built logs where none is (Mints, Burns, Transfers — said so where they are made). It answers the
   way the node does: a one-address window of at most 10,000,000 blocks, a query with several values in one topic
   position at most 100,000, at most `cap` logs an answer (10,000 on the chain, less here to force refusals), a refused
   batch item as null (server.js rpcBatch), a throttle as a thrown "Too Many Requests". Every log it hands out carries a
   `blockTimestamp` that counts each time it is read: the count must stay 0.

   What it pins: the query shape (one address, one value per topic position); windows that end on cell lines; refusals
   quartered, and the window growing back after one; resume after a throw; one stream's failure never stopping the
   others (it is held, then read again); the cool-down, the budget (0 included) and the pace weights; cursors that never
   go back; appends that never add a row twice, and roll back whole; the ledger's appends meeting the walker's back-fill;
   block times only for Swap blocks (and the ones the engine asks for), never a 0 or another block's time for an unknown
   one; the settle margin behind the head; each pool checked (v2, v3, or not read at all) before its first read; the
   receipt cache encrypted, and never blockTimestamp. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const require = createRequire(import.meta.url);
const TAPE = require(path.join(ROOT, 'lib', 'tape.js'));
const FIX = (f) => JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'tape', f), 'utf8'));
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const section = async (name, fn) => { try { await fn(); } catch (e) { check(name + ' ran to the end', false, e && e.stack); } };

/* ═══ the chain this suite reads ═══ */
const T = TAPE.TOPICS, CELL = TAPE.CELL;
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', POOL = '0xf30bb531d0255969be155533abac34b22bd63414';
const hx = (n) => '0x' + n.toString(16);
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const topic = (a) => '0x' + '0'.repeat(24) + a.slice(2);
const W = (n) => '0x' + n.toString(16).padStart(40, '0');
const txh = (n) => '0x' + n.toString(16).padStart(64, '0');
const START = 100000000, HEAD = 117000000;
const SWAPS = FIX('swaps-send-pool.json').result;           // measured: eth_getLogs, the $SEND pool's Swap topic
const RC = FIX('receipt-3de70b.json').result;               // measured: eth_getTransactionReceipt of one $SEND buy
const RC_BLOCK = parseInt(RC.blockNumber, 16);
/* The fake node's block times: ten blocks a second (this chain's rate), anchored on the time the measured receipt's logs
   carry for its own block (0x6afcbb5d) — a plausible answer for the fake's eth_getBlockByNumber, nothing the library reads. */
const RC_TS = parseInt(RC.logs[0].blockTimestamp, 16);
const tsOf = (b) => RC_TS - Math.round((RC_BLOCK - b) / 10);

// hand-built (no measured Mint, Burn or $SEND Transfer is kept): blocks chosen so none shares a block with a Swap
const MINTS = [101000007, 108500003, 112000009].map((b, k) => ({ address: POOL, topics: [T.Mint, topic(W(0x99))], data: '0x' + word(10n ** 18n) + word(5n * 10n ** 20n), blockNumber: hx(b), logIndex: '0x2', transactionHash: txh(0xa000 + k), removed: false }));
const BURNS = [109000001, 115500005].map((b, k) => ({ address: POOL, topics: [T.Burn, topic(W(0x99)), topic(W(0x98))], data: '0x' + word(10n ** 17n) + word(10n ** 19n), blockNumber: hx(b), logIndex: '0x3', transactionHash: txh(0xb000 + k), removed: false }));
const HAND_TRANSFERS = Array.from({ length: 60 }, (_, k) => ({ address: SEND, topics: [T.Transfer, topic(W(k % 5 + 1)), topic(W(k % 7 + 10))], data: '0x' + word(BigInt(k + 1) * 10n ** 18n),
  blockNumber: hx(START + k * 270000 + 13), logIndex: hx(k % 4), transactionHash: txh(0xc000 + k), removed: false }));
const RC_SEND = RC.logs.filter((l) => l.address === SEND);   // measured: the buy's two $SEND transfers (the tax to the token, the buyer's)
const TRANSFERS = HAND_TRANSFERS.concat(RC_SEND);
const BASE_LOGS = SWAPS.concat(MINTS, BURNS, TRANSFERS);
const SWAP_BLOCKS = new Set(SWAPS.map((l) => parseInt(l.blockNumber, 16)));
/* The pool check (factory(), getReserves(), slot0()) before a pool's first read. Measured for the $SEND pool
   (pool-check-send-pool.json: a v2 pair of the chain's factory; slot0() reverted). Hand-built for the others, in the same
   shapes: a v3 pool (no getReserves(), a 7-word slot0()) and an address that answers none of the three. */
const SEL = TAPE.SEL;
const CHECK = FIX('pool-check-send-pool.json');
const FACTORY = '0x' + CHECK[0].result.slice(26);
const REVERT = { error: { code: 3, message: 'execution reverted', data: '0x' } };
const V2_CALLS = { [SEL.factory]: CHECK[0], [SEL.getReserves]: CHECK[1], [SEL.slot0]: CHECK[2] };
const V3_FACTORY = '0x' + '3'.repeat(40);
const V3_CALLS = { [SEL.factory]: { result: '0x' + word(V3_FACTORY) }, [SEL.getReserves]: REVERT, [SEL.slot0]: { result: '0x' + [1, 2, 3, 4, 5, 6, 1].map(word).join('') } };
const NO_POOL_CALLS = { [SEL.factory]: REVERT, [SEL.getReserves]: REVERT, [SEL.slot0]: REVERT };

/* ═══ the fake node ═══ */
let TRAP = 0;   // every read of any log's blockTimestamp, across every fake node in this suite
const trapped = (o) => Object.defineProperty(o, 'blockTimestamp', { enumerable: true, get() { TRAP++; return '0x1'; } });
const wrapLog = (l) => trapped({ address: l.address, topics: l.topics.slice(), data: l.data, blockNumber: l.blockNumber, transactionHash: l.transactionHash, transactionIndex: l.transactionIndex || '0x0', blockHash: l.blockHash || txh(parseInt(l.blockNumber, 16)), logIndex: l.logIndex, removed: !!l.removed });
const wrapReceipt = (rc) => ({ ...rc, logs: rc.logs.map(wrapLog) });   // a fresh copy each time; the receipt's own fields are plain
const topicsMatch = (lt, qt) => qt.every((q, i) => q === null || (typeof q === 'string' && lc(lt[i]) === lc(q)));
const lc = (x) => String(x || '').toLowerCase();
function makeNode(opts = {}) {
  const st = { requests: [], queries: [], blockItems: [], receiptItems: [], cap: opts.cap || 10000, head: opts.head || HEAD, logs: opts.logs || BASE_LOGS,
    nullBlocks: new Set(opts.nullBlocks || []), failAt: opts.failAt || null, throttleAt: opts.throttleAt || null, n: 0, multiRefused: 0, refusedBig: 0, wrongBlock: new Set(opts.wrongBlock || []),
    noNumber: new Set(opts.noNumber || []), calls: { [POOL]: V2_CALLS, ...(opts.calls || {}) }, callItems: [] };
  function answer(method, params) {
    if (method === 'eth_blockNumber') return hx(st.head);
    if (method === 'eth_call') {   // a reverted call is an error item; server.js rpcBatch (the fake's pacedBatch) hands it over as null
      const to = lc(params[0].to), it = (st.calls[to] || NO_POOL_CALLS)[params[0].data] || REVERT; st.callItems.push(to);
      if (it.error) throw new Error(it.error.message); return it.result;
    }
    if (method === 'eth_getLogs') {
      const q = params[0]; st.queries.push(JSON.parse(JSON.stringify(q)));
      const f = parseInt(q.fromBlock, 16), t = parseInt(q.toBlock, 16), span = t - f + 1;
      if (!(span >= 1)) throw new Error('invalid block range params');
      const multi = Array.isArray(q.address) || !q.address || (q.topics || []).some(Array.isArray);
      if (multi && span > 100000) { st.multiRefused++; throw new Error('query spans ' + span + ' blocks with several values in one position, but only 100000 are allowed'); }
      if (span > 10000000) throw new Error('query spans ' + span + ' blocks, but only 10000000 are allowed');
      const hits = st.logs.filter((l) => lc(l.address) === lc(q.address) && topicsMatch(l.topics, q.topics) && parseInt(l.blockNumber, 16) >= f && parseInt(l.blockNumber, 16) <= t);
      if (hits.length > st.cap) { st.refusedBig++; throw new Error('query returned more than ' + st.cap + ' results'); }
      return hits.map(wrapLog);
    }
    if (method === 'eth_getBlockByNumber') {
      const b = parseInt(params[0], 16); st.blockItems.push(b);
      if (st.nullBlocks.has(b)) return null;
      if (st.noNumber.has(b)) return { timestamp: hx(tsOf(b)) };   // an odd, partial answer: a time, but no number to say whose
      return { number: hx(st.wrongBlock.has(b) ? b + 1 : b), timestamp: hx(tsOf(b)), hash: txh(b) };
    }
    if (method === 'eth_getTransactionReceipt') { st.receiptItems.push(params[0]); return params[0] === RC.transactionHash ? wrapReceipt(RC) : null; }
    throw new Error('the method does not exist');
  }
  const gate = () => { st.n++; if (st.throttleAt && st.n === st.throttleAt) throw new Error('Too Many Requests'); if (st.failAt && st.n === st.failAt) throw new Error('rpc http 502'); };
  return {
    st,
    rpc: async (m, p, w) => { st.requests.push({ kind: 'one', methods: [m], w, n: 1 }); gate(); return answer(m, p); },
    // server.js rpcBatch: a throttle on any item throws the whole batch; any other refusal of an item is null
    pacedBatch: async (calls, w) => {
      st.requests.push({ kind: 'batch', methods: calls.map((c) => c[0]), w, n: calls.length, topics: calls.map((c) => c[0] === 'eth_getLogs' ? c[1][0].topics[0] : null) }); gate();
      return calls.map(([m, p]) => { try { return answer(m, p); } catch (e) { if (/too many requests/i.test(e.message)) throw e; return null; } });
    },
  };
}
let clock = 1.8e12, coolUntil = 0, coolCalls = 0;
const KEY = randomBytes(32), IKEY = randomBytes(32);
// the server's encField / decField / bidx stand-ins: AES-256-GCM and an HMAC, so a stored body really is unreadable without the key
const CRYPTO = {
  enc: (s) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', KEY, iv), ct = Buffer.concat([c.update(s, 'utf8'), c.final()]); return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); },
  dec: (s) => { const b = Buffer.from(String(s).slice(3), 'base64'), d = createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); },
  idx: (s) => createHmac('sha256', IKEY).update(String(s)).digest('hex'),
};
// settle: 0 — these walks end AT the head they are given; the margin the server walks with has its own section (settle)
const mk = (db, node, extra = {}) => TAPE.createTape({ db, rpc: node.rpc, pacedBatch: node.pacedBatch, now: () => clock, coolUntil: () => coolUntil, cool: () => { coolCalls++; coolUntil = clock + 60000; }, sleep: async () => {}, crypto: CRYPTO, settle: 0, ...extra });
const freshDb = () => new DatabaseSync(':memory:');
const STREAMS = () => [...TAPE.poolStreams(POOL, { start: START }), TAPE.transferStream(SEND, { start: START })];
const count = (db, sql, ...a) => db.prepare(sql).get(...a).n;
const dump = (db) => JSON.stringify([db.prepare('SELECT * FROM coin_tape ORDER BY token, block, log_index').all(), db.prepare('SELECT * FROM pool_events ORDER BY pool, block, log_index').all()]);
const logsOnly = (st) => st.queries;
const aligned = (q) => { const t = parseInt(q.toBlock, 16); return (t + 1) % CELL === 0; };

/* ═══ 0. the tables ═══ */
await section('migrate', async () => {
  const db = freshDb();
  TAPE.migrate(db); TAPE.migrate(db);
  const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  check('migrate() makes coin_tape, pool_events, block_times, tape_cursor and tape_receipts, and runs twice', TAPE.TABLES.every((t) => have.has(t)));
  const cols = (t) => db.prepare('PRAGMA table_info(' + t + ')').all().map((r) => r.name).join(',');
  check('...with the agreed columns: coin_tape (token, block, log_index, tx, from_addr, to_addr, value), pool_events (pool, kind, block, log_index, tx, data), block_times (block, ts)',
    cols('coin_tape') === 'token,block,log_index,tx,from_addr,to_addr,value' && cols('pool_events') === 'pool,kind,block,log_index,tx,data' && cols('block_times') === 'block,ts', cols('coin_tape') + ' | ' + cols('pool_events'));
  check('...the receipt cache keeps no plaintext hash and no block (a blind index, an encrypted body, when it was read)', cols('tape_receipts') === 'tx_idx,body_enc,at');
});

/* ═══ 1. a whole walk: shape, cells, weights, dates ═══ */
let REF = null;   // the rows a clean walk keeps: every other walk must end with exactly these
await section('walk', async () => {
  const db = freshDb(), node = makeNode(), tape = mk(db, node);
  const r = await tape.walk(STREAMS().concat(STREAMS().slice(0, 1)), { head: HEAD });   // the Swap stream named twice: walked once
  REF = dump(db);
  check('a walk of the $SEND pool (Swap, Mint, Burn) and the token\'s Transfers finishes', r.complete && !r.stopped, JSON.stringify(r));
  check('...keeps all 194 measured Swaps, the 3 Mints and the 2 Burns as pool events', count(db, "SELECT COUNT(*) n FROM pool_events WHERE kind = 'Swap'") === 194 && count(db, "SELECT COUNT(*) n FROM pool_events WHERE kind = 'Mint'") === 3 && count(db, "SELECT COUNT(*) n FROM pool_events WHERE kind = 'Burn'") === 2);
  check('...and all 62 Transfers (60 built, the measured buy\'s 2) on the tape', count(db, 'SELECT COUNT(*) n FROM coin_tape WHERE token = ?', SEND) === TRANSFERS.length);
  const qs = logsOnly(node.st);
  check('THE PIN: every log query names one address (a string) and one value per topic position (never a list)',
    qs.length > 0 && qs.every((q) => typeof q.address === 'string' && /^0x[0-9a-f]{40}$/.test(q.address) && Array.isArray(q.topics) && q.topics.every((t) => t === null || typeof t === 'string')), JSON.stringify(qs.slice(0, 3)));
  check('...so the node never had to cap a query at 100,000 blocks', node.st.multiRefused === 0);
  const first = node.st.requests.find((x) => x.kind === 'batch' && x.methods[0] === 'eth_getLogs');
  check('...Swap, Mint, Burn and Transfer are separate queries, sent as items of ONE batch (here two windows each: 8 items, at most 10)',
    first && first.n === 8 && [T.Swap, T.Mint, T.Burn, T.Transfer].every((t) => first.topics.filter((x) => x === t).length === 2), first && JSON.stringify(first));
  check('...no window spans more than the node\'s 10,000,000 blocks', qs.every((q) => parseInt(q.toBlock, 16) - parseInt(q.fromBlock, 16) + 1 <= TAPE.WINDOW_MAX));
  check('...every window ends on a cell line (…9,999) or at the head', qs.every((q) => aligned(q) || parseInt(q.toBlock, 16) === HEAD), JSON.stringify(qs.map((q) => q.toBlock)));
  check('...and every stream\'s cursor is at the head', STREAMS().every((s) => (TAPE.cursorGet(db, s.key) || {}).block === HEAD));
  const lb = node.st.requests.filter((x) => x.kind === 'batch' && x.methods[0] === 'eth_getLogs');
  check('...a log window over 200,000 blocks weighs 5 on the pace (server.js PACE_LOG_WEIGHT): eight windows of millions of blocks weigh 40', lb.length && lb[0].w === 40, lb.map((x) => x.w).join(','));
  const bb = node.st.requests.filter((x) => x.kind === 'batch' && x.methods[0] === 'eth_getBlockByNumber');
  check('...a block read weighs 1, at most 25 to a batch', bb.length && bb.every((x) => x.w === x.n && x.n <= 25));
  const sw = db.prepare('SELECT * FROM pool_events WHERE tx = ?').get(RC.transactionHash);
  const fixSwap = SWAPS.find((l) => l.transactionHash === RC.transactionHash);
  check('the measured buy\'s Swap is kept raw: kind, block, log index and data exactly as the node gave them', sw && fixSwap && sw.kind === 'Swap' && sw.block === RC_BLOCK && sw.log_index === parseInt(fixSwap.logIndex, 16) && sw.data === fixSwap.data);
  const tf = db.prepare('SELECT * FROM coin_tape WHERE tx = ? ORDER BY log_index').all(RC.transactionHash);
  check('...and its two $SEND transfers: the tax to the token contract, 390,503.50 $SEND to the buyer (BigInt, as a decimal string)',
    tf.length === 2 && tf[0].to_addr === SEND && tf[1].to_addr === RC.from && tf[1].value === '390503498686261802001972' && tf[0].value === '3944479784709715171737');
  // block times: the Swap blocks only, in milliseconds
  const dated = db.prepare('SELECT block, ts FROM block_times').all();
  check('block times are kept for every block a Swap sat in: 189 blocks for 194 Swaps (several in one block are one read)', dated.length === SWAP_BLOCKS.size && dated.every((d) => SWAP_BLOCKS.has(d.block)), dated.length);
  check('...and for no other block (no Mint, Burn or Transfer block without a Swap in it)', ![...MINTS, ...BURNS, ...HAND_TRANSFERS].some((l) => db.prepare('SELECT 1 FROM block_times WHERE block = ?').get(parseInt(l.blockNumber, 16))));
  check('...each one the node\'s eth_getBlockByNumber time, in milliseconds', dated.every((d) => d.ts === tsOf(d.block) * 1000) && db.prepare('SELECT ts FROM block_times WHERE block = ?').get(RC_BLOCK).ts === RC_TS * 1000);
  check('...asked for once each', node.st.blockItems.length === SWAP_BLOCKS.size);
  const th = tape.tapeHead(SEND, [POOL]);
  check('tapeHead: the transfers and every pool stream are complete to the head, every Swap dated', th.block === HEAD && th.undated === 0 && th.why === null, JSON.stringify(th));
  // the tail tick: a minute later, one new Swap
  const swap2 = { address: POOL, topics: [T.Swap, topic(W(0x77)), topic(W(0x78))], data: '0x' + word(0) + word(10n ** 16n) + word(10n ** 21n) + word(0), blockNumber: hx(HEAD + 100), logIndex: '0x1', transactionHash: txh(0xd001), removed: false };
  node.st.logs = BASE_LOGS.concat([swap2]); node.st.head = HEAD + 1500;
  const before = node.st.requests.length;
  const r2 = await tape.walk(STREAMS(), {});
  const tick = node.st.requests.slice(before);
  check('the tail tick: one head read, ONE batch of four 1,500-block windows (each weighing 1), one block read for the new Swap',
    r2.complete && tick.length === 3 && tick[0].methods[0] === 'eth_blockNumber' && tick[1].n === 4 && tick[1].w === 4 && tick[2].methods[0] === 'eth_getBlockByNumber' && tick[2].n === 1, JSON.stringify(tick));
  check('...the new Swap is kept and dated; the cursors are at the new head', db.prepare('SELECT 1 FROM pool_events WHERE tx = ?').get(txh(0xd001)) && db.prepare('SELECT 1 FROM block_times WHERE block = ?').get(HEAD + 100) && TAPE.cursorGet(db, 'pool:' + POOL + ':Swap').block === HEAD + 1500);
});

/* ═══ 2. refusals: quartered ═══ */
await section('quartering', async () => {
  const db = freshDb(), node = makeNode({ cap: 40 }), tape = mk(db, node);
  const r = await tape.walk(STREAMS(), { head: HEAD });
  const qs = logsOnly(node.st);
  check('a node that answers at most 40 logs: the windows it refuses are quartered and the walk still finishes', r.complete && node.st.refusedBig > 0, node.st.refusedBig + ' refused');
  check('...with exactly the rows of an unrefused walk (nothing lost, nothing twice)', dump(db) === REF);
  check('...the quartered windows still end on cell lines or at the head', qs.every((q) => aligned(q) || parseInt(q.toBlock, 16) === HEAD));
  check('...a refused window is read on its own (with the node\'s words), never sent again in a batch at its old size', node.st.requests.some((x) => x.kind === 'one' && x.methods[0] === 'eth_getLogs'));
  // a dense stretch: 30 transfers in one cell, 12 in one block
  const dense = Array.from({ length: 30 }, (_, k) => ({ address: SEND, topics: [T.Transfer, topic(W(1)), topic(W(2))], data: '0x' + word(k + 1), blockNumber: hx(113000000 + k * 300 + 7), logIndex: '0x0', transactionHash: txh(0xe000 + k), removed: false }));
  const db2 = freshDb(), node2 = makeNode({ cap: 8, logs: dense }), tape2 = mk(db2, node2);
  const r2 = await tape2.walk([TAPE.transferStream(SEND, { start: START })], { head: HEAD });
  const small = logsOnly(node2.st).filter((q) => parseInt(q.toBlock, 16) - parseInt(q.fromBlock, 16) + 1 < CELL);
  check('inside a cell the pieces go below a cell, and never across a cell line', r2.complete && small.length > 0 && small.every((q) => Math.floor(parseInt(q.fromBlock, 16) / CELL) === Math.floor(parseInt(q.toBlock, 16) / CELL)) && count(db2, 'SELECT COUNT(*) n FROM coin_tape') === 30);
  const one = Array.from({ length: 12 }, (_, k) => ({ address: SEND, topics: [T.Transfer, topic(W(1)), topic(W(2))], data: '0x' + word(k + 1), blockNumber: hx(113000007), logIndex: hx(k), transactionHash: txh(0xf000 + k), removed: false }));
  const db3 = freshDb(), tape3 = mk(db3, makeNode({ cap: 8, logs: one }));
  const r3 = await tape3.walk([TAPE.transferStream(SEND, { start: START })], { head: HEAD });
  check('...a block with more logs than the node returns is "too dense" — the stream fails with that reason, never a silent gap', !r3.complete && r3.failed.length === 1 && /too dense/.test(r3.failed[0].why) && count(db3, 'SELECT COUNT(*) n FROM coin_tape') === 0 && (TAPE.cursorGet(db3, 'transfer:' + SEND) || { block: -1 }).block < 113000007, JSON.stringify(r3.failed));
});

/* ═══ 3. resume: after a batch the node failed, after one stream's failed read ═══ */
await section('resume', async () => {
  /* A whole batch the node fails names no stream: the walk throws. A second pool (hand-built: no logs, answering the pool
     check like the measured one) makes seven streams, so the windows go out in two rounds — and the second one fails. */
  const POOL2 = W(0x5002);
  const two = () => STREAMS().concat(TAPE.poolStreams(POOL2, { start: START }));
  const db = freshDb(), node = makeNode({ failAt: 3, calls: { [POOL2]: V2_CALLS } }), tape = mk(db, node);
  let err = null; try { await tape.walk(two(), { head: HEAD }); } catch (e) { err = e; }
  const mid = two().map((s) => [s.key, TAPE.cursorGet(db, s.key)]);
  check('a walk whose log batch the node fails half-way (an HTTP 502) throws, with the node\'s words', err && /502/.test(err.message) && node.st.requests[2].kind === 'batch' && node.st.requests[2].methods[0] === 'eth_getLogs', err && err.message);
  check('...what it read before is kept: the streams have cursors short of the head, on a cell line', mid.every(([, c]) => c && c.block < HEAD && (c.block + 1) % CELL === 0), JSON.stringify(mid));
  const kept = count(db, 'SELECT COUNT(*) n FROM pool_events') + count(db, 'SELECT COUNT(*) n FROM coin_tape');
  check('...and only rows up to those cursors', kept > 0 && kept < 194 + 5 + TRANSFERS.length && db.prepare('SELECT MAX(block) m FROM pool_events WHERE kind = ?').get('Swap').m <= ((mid.find(([k]) => k.endsWith(':Swap'))[1] || { block: -1 }).block));
  node.st.failAt = null;
  const from = node.st.queries.length;
  const r = await tape.walk(two(), { head: HEAD });
  const again = node.st.queries.slice(from);
  const resumedAt = (key) => { const s = two().find((x) => x.key === key); const qs = again.filter((q) => q.address === s.address && q.topics[0] === s.topics[0]); return qs.length ? Math.min(...qs.map((q) => parseInt(q.fromBlock, 16))) : null; };
  check('the next walk goes on from each cursor (its first window starts at cursor + 1), not from the start', r.complete && mid.every(([k, c]) => !c || c.block === HEAD || resumedAt(k) === c.block + 1), JSON.stringify(mid.map(([k, c]) => [k.split(':').pop(), c && c.block, resumedAt(k)])));
  check('...and ends with exactly the rows of a walk that was never cut', dump(db) === REF);
  /* One stream's own read the node fails (a refused window read on its own, the fifth request): that stream's failure. */
  const dbB = freshDb(), nodeB = makeNode({ cap: 40, failAt: 5 }), tapeB = mk(dbB, nodeB);
  const rB = await tapeB.walk(STREAMS(), { head: HEAD });
  const failedKey = rB.failed.length === 1 ? rB.failed[0].stream : null;
  check('a single read the node fails fails that stream only: the walk returns, listing it with the node\'s words', nodeB.st.requests[4].kind === 'one' && !rB.complete && failedKey && /502/.test(rB.failed[0].why), JSON.stringify(rB.failed));
  const hB = failedKey && TAPE.holdGet(dbB, failedKey);
  check('...every other stream is at the head; the failed one keeps what it read, and is held for 2 minutes', STREAMS().every((s) => s.key === failedKey || (TAPE.cursorGet(dbB, s.key) || {}).block === HEAD) && hB && hB.n === 1 && hB.until - hB.at === TAPE.LIMITS.HOLD_FIRST_MS, JSON.stringify(hB));
  const sB = STREAMS().find((s) => s.key === failedKey) || STREAMS()[0];
  const askedFor = (n) => nodeB.st.queries.slice(n).filter((q) => q.address === sB.address && q.topics[0] === sB.topics[0]);
  const qB = nodeB.st.queries.length;
  const rB2 = await tapeB.walk(STREAMS(), { head: HEAD });
  check('...the next walk, inside the hold, asks nothing for it and says why', askedFor(qB).length === 0 && rB2.failed.length === 1 && /held after a failure/.test(rB2.failed[0].why), JSON.stringify(rB2.failed));
  const cB = TAPE.cursorGet(dbB, failedKey);
  clock += TAPE.LIMITS.HOLD_FIRST_MS + 1;
  const qB2 = nodeB.st.queries.length;
  const rB3 = await tapeB.walk(STREAMS(), { head: HEAD });
  const firstB = askedFor(qB2).map((q) => parseInt(q.fromBlock, 16));
  check('...after the hold it goes on from its cursor, ends with the rows of a walk never cut, and the hold is gone', rB3.complete && firstB.length > 0 && Math.min(...firstB) === (cB ? cB.block + 1 : START) && dump(dbB) === REF && !TAPE.holdGet(dbB, failedKey), JSON.stringify([cB, Math.min(...firstB)]));
});

/* ═══ 4. the cool-down, the budget, one walk at a time ═══ */
await section('cool-down', async () => {
  coolUntil = 0; coolCalls = 0;
  const db = freshDb(), node = makeNode({ cap: 40, throttleAt: 3 }), tape = mk(db, node);
  let err = null; try { await tape.walk(STREAMS(), { head: HEAD }); } catch (e) { err = e; }
  check('the node\'s first refusal (429) stands the tape down: the walk throws and cool() is called (the server\'s ledgerCoolUntil)', err && /too many requests/i.test(err.message) && coolCalls === 1 && coolUntil > clock);
  const n = node.st.requests.length;
  let err2 = null; try { await tape.walk(STREAMS(), { head: HEAD }); } catch (e) { err2 = e; }
  check('...while it lasts, a walk asks the node nothing at all', err2 && err2.cooling && node.st.requests.length === n);
  let err3 = null; try { await tape.ensureBlockTimes([RC_BLOCK]); } catch (e) { err3 = e; }
  check('...nor does a block-time read', err3 && err3.cooling && node.st.requests.length === n);
  clock += 61000; node.st.throttleAt = null;
  const r = await tape.walk(STREAMS(), { head: HEAD });
  check('...after it, the walk goes on from its cursors and ends with the same rows', r.complete && dump(db) === REF);
  // the budget
  const db2 = freshDb(), node2 = makeNode({ cap: 40 }), tape2 = mk(db2, node2);
  const b = await tape2.walk(STREAMS(), { head: HEAD, maxReads: 2 });
  check('a walk given a budget of 2 requests sends 2 and stops cleanly: complete false, stopped "budget"', b.complete === false && b.stopped === 'budget' && node2.st.requests.length === 2 && b.reads === 2, JSON.stringify(b));
  const b2 = await tape2.walk(STREAMS(), { head: HEAD });
  check('...the next walk finishes it, with the same rows', b2.complete && dump(db2) === REF);
  // a budget of 0 with no head given: the head read itself is over budget. A result, never a rejection (with a Symbol, a
  // server's `'…' + ((e && e.message) || e)` would itself throw inside its .catch)
  const node4 = makeNode(), tape4 = mk(freshDb(), node4);
  let e4 = null, b4 = null; try { b4 = await tape4.walk(STREAMS(), { maxReads: 0 }); } catch (e) { e4 = e; }
  check('a budget of 0 and no head given: the walk answers stopped "budget", head null — it never rejects, and asks nothing', !e4 && b4 && b4.stopped === 'budget' && b4.complete === false && b4.head === null && node4.st.requests.length === 0, e4 ? typeof e4 + ' ' + String(e4.message) : JSON.stringify(b4));
  let e5 = null; try { await tape4.dateSwapBlocks({ maxReads: 0 }); await tape4.ensureBlockTimes([RC_BLOCK], { maxReads: 0 }); await tape4.receipts([RC.transactionHash], { maxReads: 0 }); await tape4.readLogs([{ address: SEND, topics: [T.Transfer] }], START, HEAD, { maxReads: 0 }); } catch (e) { e5 = e; }
  check('...nor does any other read given a budget of 0 (dating, block times, receipts, a caller\'s windows)', !e5 && node4.st.requests.length === 0, e5 && String(e5.message));
  // one walk at a time
  const db3 = freshDb(), tape3 = mk(db3, makeNode());
  const p1 = tape3.walk(STREAMS(), { head: HEAD }), p2 = await tape3.walk(STREAMS(), { head: HEAD });
  const r1 = await p1;
  check('a second walk while one runs answers busy (the tail tick never stacks up behind a back-fill)', p2.busy === true && r1.complete && !tape3.busy());
});

/* ═══ 5. cursors only go forward; appends never add a row twice ═══ */
await section('cursors', async () => {
  const db = freshDb(); TAPE.migrate(db);
  TAPE.cursorSet(db, 'pool:' + POOL + ':Swap', 115000000, clock);
  TAPE.cursorSet(db, 'pool:' + POOL + ':Swap', 110000000, clock);
  check('a cursor set lower stays where it was', TAPE.cursorGet(db, 'pool:' + POOL + ':Swap').block === 115000000);
  const node = makeNode(), tape = mk(db, node);
  await tape.walk(STREAMS(), { head: HEAD });
  const q0 = node.st.queries.length;
  const r = await tape.walk(STREAMS(), { head: HEAD - 500000 });
  check('a walk to a head below the cursors reads no log and moves no cursor back', node.st.queries.length === q0 && r.complete && STREAMS().every((s) => TAPE.cursorGet(db, s.key).block === HEAD));
  const old = HAND_TRANSFERS.slice(0, 3).map(wrapLog);
  const a = tape.appendTransfers(SEND, old, { from: START, upTo: START + 900000 });
  check('an append for blocks the tape already has adds nothing and leaves the cursor at the head', a.added === 0 && TAPE.cursorGet(db, 'transfer:' + SEND).block === HEAD);
  const swapQ = (from) => node.st.queries.slice(from).filter((q) => q.topics[0] === T.Swap);
  db.prepare('DELETE FROM tape_cursor WHERE stream = ?').run('pool:' + POOL + ':Swap');
  const q1 = node.st.queries.length;
  await tape.walk(STREAMS(), { head: HEAD });
  check('a stream read again from its start (its cursor lost) adds no row twice', swapQ(q1).length > 0 && count(db, "SELECT COUNT(*) n FROM pool_events WHERE kind = 'Swap'") === 194);
});

await section('appends', async () => {
  const db = freshDb(), tape = mk(db, makeNode());
  const batch = HAND_TRANSFERS.filter((l) => parseInt(l.blockNumber, 16) >= 110000000 && parseInt(l.blockNumber, 16) < 111000000);
  const a1 = tape.appendTransfers(SEND, batch.map(wrapLog), { from: 110000000, upTo: 110999999 });
  const a2 = tape.appendTransfers(SEND, batch.map(wrapLog), { from: 110000000, upTo: 110999999 });
  check('the same Transfers appended twice are kept once (a log is token + block + log index)', a1.added === batch.length && a2.added === 0 && count(db, 'SELECT COUNT(*) n FROM coin_tape') === batch.length, JSON.stringify([a1, a2]));
  const over = HAND_TRANSFERS.filter((l) => parseInt(l.blockNumber, 16) >= 110500000 && parseInt(l.blockNumber, 16) < 112000000);
  const a3 = tape.appendTransfers(SEND, over.map(wrapLog), { from: 110500000, upTo: 111999999 });
  check('...an overlapping batch adds only the new ones', a3.added === over.filter((l) => parseInt(l.blockNumber, 16) >= 111000000).length);
  let err = null; try { tape.appendTransfers(SEND, [wrapLog(HAND_TRANSFERS[1]), wrapLog({ ...HAND_TRANSFERS[0], address: POOL })], { from: START, upTo: START + 1000000 }); } catch (e) { err = e; }
  check('a log of another address in a token\'s batch is refused before anything is written: the batch adds nothing', err && /another address/.test(err.message) && count(db, 'SELECT COUNT(*) n FROM coin_tape') === batch.length + a3.added);
  let err2 = null; try { tape.appendTransfers(SEND, batch.map(wrapLog), { from: 110600000, upTo: 110700000 }); } catch (e) { err2 = e; }
  check('...so is a transfer outside the window it was said to come from', err2 && /outside the window/.test(err2.message));
  // inside the caller's transaction, as in ledgerApply: the ledger's ROLLBACK takes the tape rows with it
  db.exec('BEGIN');
  tape.appendTransfers(SEND, HAND_TRANSFERS.slice(40, 45).map(wrapLog), { from: START, upTo: HEAD });
  db.exec('ROLLBACK');
  check('appended inside the ledger\'s transaction, its rows commit or roll back with the ledger\'s batch', count(db, 'SELECT COUNT(*) n FROM coin_tape') === batch.length + a3.added);
  const a4 = tape.appendTransfers(SEND, batch.map(wrapLog));
  check('without a window, the rows are kept and no cursor moves (nothing says the batch was the whole window)', a4.cursor === null);
  /* A write that fails half-way, inside the savepoint: a trigger (made for this test) aborts the insert of the second of
     three rows. Without the savepoint, the first row would stay. */
  const db5 = freshDb(), tape5 = mk(db5, makeNode());
  db5.exec('CREATE TRIGGER boom BEFORE INSERT ON coin_tape WHEN NEW.block = ' + parseInt(HAND_TRANSFERS[11].blockNumber, 16) + " BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  const three = HAND_TRANSFERS.slice(10, 13).map(wrapLog), rng = { from: parseInt(HAND_TRANSFERS[10].blockNumber, 16), upTo: parseInt(HAND_TRANSFERS[12].blockNumber, 16) };
  let e5 = null; try { tape5.appendTransfers(SEND, three, rng); } catch (e) { e5 = e; }
  check('a write that fails half-way (the second of three rows) leaves none of the batch and no cursor: the savepoint takes the first row back too', e5 && /disk full/.test(e5.message) && count(db5, 'SELECT COUNT(*) n FROM coin_tape') === 0 && !TAPE.cursorGet(db5, 'transfer-live:' + SEND) && !TAPE.cursorGet(db5, 'transfer:' + SEND), e5 && e5.message);
  // inside the ledger's transaction, wrapped the way server.js wraps dh_hook: the ledger's own write commits, the tape's rows do not
  db5.exec('CREATE TABLE ledger_rows (n INTEGER)');
  db5.exec('BEGIN');
  db5.prepare('INSERT INTO ledger_rows (n) VALUES (1)').run();
  db5.exec('SAVEPOINT tape_hook');
  try { tape5.appendTransfers(SEND, three, rng); db5.exec('RELEASE tape_hook'); } catch { db5.exec('ROLLBACK TO tape_hook'); db5.exec('RELEASE tape_hook'); }
  db5.exec('COMMIT');
  check('...and inside the ledger\'s transaction, wrapped like dh_hook (its own savepoint and try/catch), the ledger\'s batch commits without the tape\'s rows', count(db5, 'SELECT COUNT(*) n FROM ledger_rows') === 1 && count(db5, 'SELECT COUNT(*) n FROM coin_tape') === 0);
});

/* ═══ 6. the ledger's appends meet the walker's back-fill ═══ */
await section('ledger hook', async () => {
  const db = freshDb(), node = makeNode(), tape = mk(db, node);
  const inRange = (a, b) => TRANSFERS.filter((l) => parseInt(l.blockNumber, 16) >= a && parseInt(l.blockNumber, 16) <= b);
  // the ledger was built before the tape existed: its next window is the first the tape hears of
  const a1 = tape.appendTransfers(SEND, inRange(115000000, 115999999).map(wrapLog), { from: 115000000, upTo: 115999999 });
  check('the ledger\'s first append, with no tape yet, is kept as the ledger\'s own stretch (live), not as the tape', a1.cursor === 'live' && tape.transfersThrough(SEND) === null && TAPE.cursorGet(db, 'transfer-live:' + SEND).since === 115000000);
  const th0 = tape.tapeHead(SEND, [POOL]);
  check('...tapeHead says the tape cannot be used yet, and why', th0.block === null && /transfer:/.test(th0.why));
  const q0 = node.st.queries.length;
  const r = await tape.walk([TAPE.transferStream(SEND, { start: START, until: 115999999 })], { head: HEAD });
  const tq = node.st.queries.slice(q0);
  check('the walker back-fills only what the ledger read before the tape: its windows stop at block 114,999,999', r.complete && tq.length > 0 && Math.max(...tq.map((q) => parseInt(q.toBlock, 16))) === 114999999);
  check('...then the two join: the tape is complete to the ledger\'s block, and the live stretch is gone', tape.transfersThrough(SEND) === 115999999 && !TAPE.cursorGet(db, 'transfer-live:' + SEND));
  const a2 = tape.appendTransfers(SEND, inRange(116000000, HEAD).map(wrapLog), { from: 116000000, upTo: HEAD });
  check('the ledger\'s next append moves the tape itself on', a2.cursor === 'tape' && tape.transfersThrough(SEND) === HEAD && count(db, 'SELECT COUNT(*) n FROM coin_tape') === TRANSFERS.length);
  const q1 = node.st.queries.length;
  await tape.walk([TAPE.transferStream(SEND, { start: START, until: HEAD })], { head: HEAD });
  check('...and a walk after that reads no Transfer the ledger already read', node.st.queries.length === q1);
  await tape.walk(TAPE.poolStreams(POOL, { start: START }), { head: HEAD });
  const th = tape.tapeHead(SEND, [POOL]);
  check('with the pools read too, tapeHead is the head (the lowest of the streams)', th.block === HEAD && th.undated === 0, JSON.stringify(th));
  // a ledger whose appends began at its very first window (a token taped from the start): nothing to back-fill
  const db2 = freshDb(), node2 = makeNode(), tape2 = mk(db2, node2);
  tape2.appendTransfers(SEND, inRange(0, 108999999).map(wrapLog), { from: 0, upTo: 108999999 });
  await tape2.walk([TAPE.transferStream(SEND, { start: START, until: 108999999 })], { head: HEAD });
  check('a ledger appended from block 0: the walker reads nothing and the tape is the ledger\'s', node2.st.queries.length === 0 && tape2.transfersThrough(SEND) === 108999999);
  // a gap in the ledger's appends (it rebuilt): the stretch starts over, the back-fill closes the gap
  const db3 = freshDb(), tape3 = mk(db3, makeNode());
  tape3.appendTransfers(SEND, inRange(105000000, 105999999).map(wrapLog), { from: 105000000, upTo: 105999999 });
  tape3.appendTransfers(SEND, inRange(107000000, 107999999).map(wrapLog), { from: 107000000, upTo: 107999999 });
  check('a gap between two appends starts the live stretch over at the second', TAPE.cursorGet(db3, 'transfer-live:' + SEND).since === 107000000);
  await tape3.walk([TAPE.transferStream(SEND, { start: START, until: 107999999 })], { head: HEAD });
  check('...and the walker fills everything before it', tape3.transfersThrough(SEND) === 107999999 && count(db3, 'SELECT COUNT(*) n FROM coin_tape') === inRange(START, 107999999).length);
});

/* ═══ 7. block times ═══ */
await section('block times', async () => {
  const someSwap = parseInt(SWAPS[10].blockNumber, 16), noNum = parseInt(SWAPS[30].blockNumber, 16);
  const db = freshDb(), node = makeNode({ nullBlocks: [someSwap], wrongBlock: [parseInt(SWAPS[20].blockNumber, 16)], noNumber: [noNum] }), tape = mk(db, node);
  const r = await tape.walk(STREAMS(), { head: HEAD });
  check('a Swap block the node does not date is left unknown — no row, never a 0', r.complete && !db.prepare('SELECT 1 FROM block_times WHERE block = ?').get(someSwap) && count(db, 'SELECT COUNT(*) n FROM block_times WHERE ts <= 0') === 0);
  check('...so is one the node answers for another block', !db.prepare('SELECT 1 FROM block_times WHERE block = ?').get(parseInt(SWAPS[20].blockNumber, 16)));
  check('...and so is one answered with a time but no block number (it cannot say which block the time is for)', !db.prepare('SELECT 1 FROM block_times WHERE block = ?').get(noNum));
  check('...the walk and tapeHead count them as undated', r.dated.undated === 3 && tape.tapeHead(SEND, [POOL]).undated === 3, JSON.stringify(r.dated));
  node.st.nullBlocks.clear(); node.st.wrongBlock.clear(); node.st.noNumber.clear();
  const n0 = node.st.blockItems.length;
  const d = await tape.dateSwapBlocks();
  check('the next dating asks for those three blocks only, and keeps them', d.dated === 3 && d.undated === 0 && node.st.blockItems.length - n0 === 3);
  const tblock = parseInt(HAND_TRANSFERS[5].blockNumber, 16);
  const n1 = node.st.blockItems.length;
  const m = await tape.ensureBlockTimes([tblock, someSwap, RC_BLOCK]);
  check('a block the engine needs (a transfer\'s arrival) is read and kept; blocks already kept are not asked again',
    node.st.blockItems.length - n1 === 1 && m.get(tblock) === tsOf(tblock) * 1000 && m.get(someSwap) === tsOf(someSwap) * 1000 && db.prepare('SELECT ts FROM block_times WHERE block = ?').get(tblock).ts === tsOf(tblock) * 1000);
  await tape.ensureBlockTimes([tblock]);
  check('...and a second ask for it reads nothing', node.st.blockItems.length - n1 === 1);
  const g = TAPE.blockTimesGet(db, [RC_BLOCK, 5]);
  check('blockTimesGet: kept times as a map of milliseconds; an unknown block is simply absent', g.get(RC_BLOCK) === RC_TS * 1000 && !g.has(5));
});

/* ═══ 8. receipts for tokens with no tape ═══ */
await section('receipts', async () => {
  const db = freshDb(), node = makeNode(), tape = mk(db, node);
  const out = await tape.receipts([RC.transactionHash.toUpperCase().replace('0X', '0x'), txh(0x1234)]);
  const e = out.get(RC.transactionHash);
  check('a receipt is read and compacted: block, status, sender, and its ERC-20 Transfers in log order (WETH 2, $SEND 2)',
    e && e.block === RC_BLOCK && e.status === 1 && e.from === RC.from && e.logs.length === 4 && e.logs.map((l) => l.i).join() === '3,4,5,6' && e.logs[3].value === 390503498686261802001972n && e.logs[3].to === RC.from && e.logs[0].address === '0x0bd7d308f8e1639fab988df18a8011f41eacad73');
  check('...the pool\'s Sync and Swap are not Transfers and are left out', !e.logs.some((l) => l.address === POOL));
  check('a transaction the node has no receipt for is null (unknown), and is not kept', out.get(txh(0x1234)) === null && count(db, 'SELECT COUNT(*) n FROM tape_receipts') === 1);
  const row = db.prepare('SELECT * FROM tape_receipts').get();
  check('the kept receipt is encrypted and keyed by a blind index: no hash, no wallet, no block in the clear',
    row && row.tx_idx !== RC.transactionHash && /^[0-9a-f]{64}$/.test(row.tx_idx) && !row.body_enc.includes(RC.from.slice(2)) && !row.body_enc.includes(String(RC_BLOCK)) && !row.body_enc.includes(RC.transactionHash.slice(2, 20)));
  const n0 = node.st.receiptItems.length;
  const again = (await tape.receipts([RC.transactionHash])).get(RC.transactionHash);
  check('...and read back from the cache with no chain read, the same receipt', node.st.receiptItems.length === n0 && JSON.stringify(again, (k, v) => (typeof v === 'bigint' ? v.toString() : v)) === JSON.stringify(e, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  const db2 = freshDb(), tape2 = mk(db2, makeNode(), { crypto: null });
  const o2 = await tape2.receipts([RC.transactionHash]);
  check('without the server\'s crypto a receipt is answered but never kept', o2.get(RC.transactionHash) && count(db2, 'SELECT COUNT(*) n FROM tape_receipts') === 0);
  check('receiptsForget drops a deleted account\'s receipts', TAPE.receiptsForget(db, CRYPTO, [RC.transactionHash]) === 1 && count(db, 'SELECT COUNT(*) n FROM tape_receipts') === 0);
  await tape.receipts([RC.transactionHash]);
  check('...and receiptsPrune ages out the ones read before a time (a receipt can always be read again)', TAPE.receiptsPrune(db, clock - 1) === 0 && TAPE.receiptsPrune(db, clock + 1) === 1 && count(db, 'SELECT COUNT(*) n FROM tape_receipts') === 0);
});

/* ═══ 9. a caller's own windows (a member's wallet in a token with no tape) ═══ */
await section('readLogs', async () => {
  const db = freshDb(), node = makeNode(), tape = mk(db, node);
  let err = null; try { await tape.readLogs([{ address: SEND, topics: [[T.Transfer, T.Swap]] }], START, HEAD); } catch (e) { err = e; }
  check('THE PIN, for callers too: two values in one topic position are refused before anything is asked', err && /one value per topic position/.test(err.message) && node.st.requests.length === 0);
  let err2 = null; try { await tape.readLogs([{ address: [SEND, POOL], topics: [T.Transfer] }], START, HEAD); } catch (e) { err2 = e; }
  check('...and so are two addresses', err2 && /one address/.test(err2.message) && node.st.requests.length === 0);
  const w = W(10);
  const r = await tape.readLogs([{ address: SEND, topics: [T.Transfer, TAPE.addrTopic(w)] }, { address: SEND, topics: [T.Transfer, null, TAPE.addrTopic(w)] }], START, HEAD);
  const want = HAND_TRANSFERS.filter((l) => l.topics[2] === topic(w)).map((l) => l.transactionHash);
  check('a wallet\'s transfers in and out: two queries, one value (or none) per position, in chain order', r.complete && r.logs[0].length === 0 && r.logs[1].map((l) => l.tx).join() === want.join() && node.st.queries.every((q) => q.topics.every((t) => t === null || typeof t === 'string')));
  check('...the logs come back as plain fields (no blockTimestamp carried along), and nothing is stored', r.logs[1].every((l) => !('blockTimestamp' in l) && Number.isInteger(l.block)) && count(db, 'SELECT COUNT(*) n FROM coin_tape') === 0);
});

/* ═══ 10. answers the tape will not keep ═══ */
await section('bad answers', async () => {
  const bad = { address: POOL, topics: [T.Swap, topic(W(1))], data: '0x' + word(1) + word(2) + word(3) + word(4), blockNumber: hx(105000000), logIndex: '0x0', transactionHash: txh(0x9999), removed: false };
  const db = freshDb(), tape = mk(db, makeNode({ logs: BASE_LOGS.concat([bad]) }));
  const r = await tape.walk(TAPE.poolStreams(POOL, { start: START }), { head: HEAD });
  check('a Swap this reader cannot decode (two topics) stops its stream with the reason — it is never kept as a trade', !r.complete && r.failed.length === 1 && /cannot decode/.test(r.failed[0].why) && !db.prepare('SELECT 1 FROM pool_events WHERE tx = ?').get(txh(0x9999)) && !TAPE.cursorGet(db, 'pool:' + POOL + ':Swap'), JSON.stringify(r.failed));
  const removed = { ...HAND_TRANSFERS[3], removed: true };
  const db2 = freshDb(), tape2 = mk(db2, makeNode());
  tape2.appendTransfers(SEND, [wrapLog(removed)], { from: START, upTo: HEAD });
  check('a log the node marks removed (a reorg) is not kept', count(db2, 'SELECT COUNT(*) n FROM coin_tape') === 0);
});

/* ═══ 11. one stream's failure is that stream's ═══ */
await section('isolation', async () => {
  /* Hand-built: a second v2 pair (BAD, answering the pool check like the measured one) whose first Swap has two topics —
     a log this reader cannot decode — walked in ONE walk with the $SEND pool and the $SEND transfers, the bad stream first
     (so its items come before the good ones in every round). */
  const BAD = W(0xbad0);
  const badSwap = { address: BAD, topics: [T.Swap, topic(W(1))], data: '0x' + word(1) + word(2) + word(3) + word(4), blockNumber: hx(105000000), logIndex: '0x0', transactionHash: txh(0x9998), removed: false };
  const db = freshDb(), node = makeNode({ logs: BASE_LOGS.concat([badSwap]), calls: { [BAD]: V2_CALLS } }), tape = mk(db, node);
  const streams = () => TAPE.poolStreams(BAD, { start: START }).concat(STREAMS());
  const badKey = 'pool:' + BAD + ':Swap';
  const r = await tape.walk(streams(), { head: HEAD });
  check('a stream that cannot be kept (a Swap with two topics) does not stop the walk: it alone is in failed, with its reason', !r.complete && !r.stopped && r.failed.length === 1 && r.failed[0].stream === badKey && /cannot decode/.test(r.failed[0].why), JSON.stringify(r.failed));
  check('...every other stream reached the head: the $SEND pool and its transfers are complete, row for row', STREAMS().every((s) => (TAPE.cursorGet(db, s.key) || {}).block === HEAD) && dump(db) === REF && tape.tapeHead(SEND, [POOL]).block === HEAD);
  const h1 = TAPE.holdGet(db, badKey);
  check('...the bad pool\'s other kinds too; its Swap stream keeps no row and no cursor, and is held', TAPE.cursorGet(db, 'pool:' + BAD + ':Mint').block === HEAD && !TAPE.cursorGet(db, badKey) && !db.prepare('SELECT 1 FROM pool_events WHERE pool = ?').get(BAD) && h1 && h1.n === 1);
  const th = tape.tapeHead(SEND, [POOL, BAD]);
  check('tapeHead with the bad pool: unknown (null), saying it is not read yet and that the stream is held', th.block === null && /not read yet/.test(th.why) && /held/.test(th.why) && th.held.length === 1 && th.held[0].stream === badKey, JSON.stringify(th));
  // the next tick: the good streams read their tail, the held one is not asked
  node.st.head = HEAD + 2000;
  const q0 = node.st.queries.length;
  const r2 = await tape.walk(streams(), {});
  const askedBad = (n) => node.st.queries.slice(n).filter((q) => q.address === BAD && q.topics[0] === T.Swap).length;
  check('the next walk, inside the hold, asks nothing of the held stream (a failure that comes back costs no batch a minute), and the others reach the new head', askedBad(q0) === 0 && r2.failed.length === 1 && /held/.test(r2.failed[0].why) && STREAMS().every((s) => TAPE.cursorGet(db, s.key).block === HEAD + 2000));
  clock += TAPE.LIMITS.HOLD_FIRST_MS + 1;
  const q1 = node.st.queries.length;
  await tape.walk(streams(), {});
  const h2 = TAPE.holdGet(db, badKey);
  check('...after the hold it is asked again; failing again, it waits twice as long (4 minutes, doubling to 6 hours)', askedBad(q1) > 0 && h2 && h2.n === 2 && h2.until - h2.at === 2 * TAPE.LIMITS.HOLD_FIRST_MS, JSON.stringify([askedBad(q1), h2]));
  // a caller's own windows: the query that cannot be kept is in errors, the other one is read through (a malformed topic, hand-built)
  const ODD = W(0xbad1);
  node.st.logs = node.st.logs.concat([{ address: ODD, topics: [T.Transfer, '0x1234'], data: '0x', blockNumber: hx(104000000), logIndex: '0x0', transactionHash: txh(0x9997), removed: false }]);
  const rl = await tape.readLogs([{ address: ODD, topics: [T.Transfer] }, { address: SEND, topics: [T.Transfer] }], START, HEAD);
  check('readLogs the same way: the failed query is in errors with its reason, the other is read to the end', !rl.complete && rl.errors.length === 1 && rl.errors[0].query === 0 && /malformed topic/.test(rl.errors[0].why) && rl.logs[0].length === 0 && rl.through[1] === HEAD && rl.logs[1].length === TRANSFERS.length, JSON.stringify(rl.errors));
});

/* ═══ 12. the window after a refusal ═══ */
await section('window after a refusal', async () => {
  /* Hand-built: a launch burst of nine Transfers 1,000 blocks apart (the fake answers at most 8 a window, so the first
     window is refused), then two more in 30,000,000 quiet blocks; walked with the $SEND pool's three streams (no logs here).
     The start is 5 blocks short of a cell line (the first quarter is a 5-block stub), 1,000 short, or on one. */
  const runs = [];
  for (const off of [9995, 9000, 0]) {
    const start = START + off, logs = [];
    const tf = (b, k) => ({ address: SEND, topics: [T.Transfer, topic(W(1)), topic(W(2))], data: '0x' + word(k + 1), blockNumber: hx(b), logIndex: '0x0', transactionHash: txh(0x7000 + k), removed: false });
    for (let k = 0; k < 9; k++) logs.push(tf(start + 1000 * k, k));
    logs.push(tf(start + 15000000, 9), tf(start + 25000000, 10));
    const db = freshDb(), node = makeNode({ cap: 8, logs, head: start + 30000000 }), tape = mk(db, node);
    const r = await tape.walk([TAPE.transferStream(SEND, { start }), ...TAPE.poolStreams(POOL, { start })], { date: false });
    const spans = logsOnly(node.st).filter((q) => q.topics[0] === T.Transfer).map((q) => parseInt(q.toBlock, 16) - parseInt(q.fromBlock, 16) + 1);
    runs.push({ off, complete: r.complete, requests: node.st.requests.length, rows: count(db, 'SELECT COUNT(*) n FROM coin_tape'), widest: Math.max(...spans.slice(-3)) });
  }
  check('one refusal at a launch burst does not shrink the rest of the walk: four streams over 30,000,000 blocks take at most 40 requests from any start (before: 20,044 from 5 short of a cell line, 1,025 from 1,000 short, 428 on one)',
    runs.every((x) => x.complete && x.rows === 11 && x.requests <= 40), JSON.stringify(runs));
  check('...the windows grow back after it: the walk ends reading millions of blocks a window again', runs.every((x) => x.widest >= 1000000), JSON.stringify(runs.map((x) => x.widest)));
  check('quarters() still cuts on cell lines (a window off a line has a short first piece: alignment, not the size the walk goes on with)', JSON.stringify(TAPE.quarters(100009995, 100039999)) === JSON.stringify([[100009995, 100009999], [100010000, 100019999], [100020000, 100029999], [100030000, 100039999]]));
});

/* ═══ 13. the settle margin ═══ */
await section('settle', async () => {
  const S = TAPE.LIMITS.SETTLE_BLOCKS;
  // hand-built: a Swap 100 blocks behind the node's head
  const late = { address: POOL, topics: [T.Swap, topic(W(0x77)), topic(W(0x78))], data: '0x' + word(0) + word(10n ** 16n) + word(10n ** 21n) + word(0), blockNumber: hx(HEAD - 100), logIndex: '0x1', transactionHash: txh(0xd101), removed: false };
  const db = freshDb(), node = makeNode({ logs: BASE_LOGS.concat([late]) }), tape = mk(db, node, { settle: undefined });
  const r = await tape.walk(STREAMS(), {});
  check('with the default margin a walk ends SETTLE_BLOCKS (5,000) behind the node\'s head: every cursor there, no window past it', S === 5000 && r.complete && r.head === HEAD && r.settled === HEAD - S && STREAMS().every((s) => TAPE.cursorGet(db, s.key).block === HEAD - S) && node.st.queries.every((q) => parseInt(q.toBlock, 16) <= HEAD - S), JSON.stringify({ head: r.head, settled: r.settled }));
  check('...so a Swap in the newest 5,000 blocks is not kept yet (a reorg or a lagging node could still take it back), and tapeHead ends there too', !db.prepare('SELECT 1 FROM pool_events WHERE tx = ?').get(txh(0xd101)) && tape.tapeHead(SEND, [POOL]).block === HEAD - S);
  node.st.head = HEAD + S;
  const r2 = await tape.walk(STREAMS(), {});
  check('...once the head is 5,000 blocks past it, the next walk keeps it and dates its block', r2.complete && db.prepare('SELECT 1 FROM pool_events WHERE tx = ?').get(txh(0xd101)) && db.prepare('SELECT 1 FROM block_times WHERE block = ?').get(HEAD - 100) && tape.tapeHead(SEND, [POOL]).block === HEAD);
  const db2 = freshDb(), tape2 = mk(db2, makeNode(), { settle: undefined });
  await tape2.walk(STREAMS(), { head: HEAD });
  const behind = TAPE.cursorGet(db2, 'pool:' + POOL + ':Swap').block;
  const r3 = await tape2.walk(STREAMS(), { head: HEAD, settle: 0 });
  check('...the margin applies to a head the caller gives too (the ledger\'s block is no more settled than the node\'s); opts.settle overrides it for one walk', behind === HEAD - S && r3.complete && TAPE.cursorGet(db2, 'pool:' + POOL + ':Swap').block === HEAD);
});

/* ═══ 14. what a pool is: a v2 pair, a v3 pool, or not one this tape reads ═══ */
await section('pool kinds', async () => {
  const T3 = TAPE.TOPICS_V3, V3 = W(0x3333), NOTPOOL = W(0x4444), OTHER = W(0x5555);
  const tick = (n) => '0x' + word(BigInt.asUintN(256, BigInt(n)));
  // hand-built (no measured v3 pool on this chain is kept): a v3 pool's Swap (signed amounts, price, liquidity, tick), Mint and Burn
  const v3logs = [
    { address: V3, topics: [T3.Mint, topic(W(0x99)), tick(-887220), tick(887220)], data: '0x' + word(BigInt(W(0x98))) + word(10n ** 18n) + word(10n ** 20n) + word(10n ** 18n), blockNumber: hx(103000001), logIndex: '0x2', transactionHash: txh(0x3002), removed: false },
    { address: V3, topics: [T3.Swap, topic(W(0x71)), topic(W(0x72))], data: '0x' + word(BigInt.asUintN(256, -(10n ** 21n))) + word(10n ** 16n) + word(2n ** 96n) + word(10n ** 20n) + word(BigInt.asUintN(256, -5n)), blockNumber: hx(104000003), logIndex: '0x5', transactionHash: txh(0x3001), removed: false },
    { address: V3, topics: [T3.Burn, topic(W(0x99)), tick(-887220), tick(887220)], data: '0x' + word(10n ** 17n) + word(10n ** 19n) + word(10n ** 17n), blockNumber: hx(106000001), logIndex: '0x3', transactionHash: txh(0x3003), removed: false },
  ];
  const v2shape = { [TAPE.SEL.factory]: { result: '0x' + word(BigInt(W(0x7777))) }, [TAPE.SEL.getReserves]: CHECK[1], [TAPE.SEL.slot0]: REVERT };   // a v2-shaped pair of another factory
  const calls = { [V3]: V3_CALLS, [NOTPOOL]: NO_POOL_CALLS, [OTHER]: v2shape };
  const db = freshDb(), node = makeNode({ logs: BASE_LOGS.concat(v3logs), calls }), tape = mk(db, node);
  // the measured $SEND pool: checked once, one batch of three calls before its first log query, then never again
  const r0 = await tape.walk(STREAMS(), { head: HEAD });
  const firstReq = node.st.requests[0];
  check('a pool is checked before its first read: one batch of three calls (factory, getReserves, slot0; weight 1 each), then its logs', firstReq.kind === 'batch' && firstReq.n === 3 && firstReq.w === 3 && firstReq.methods.every((m) => m === 'eth_call') && node.st.requests[1].methods[0] === 'eth_getLogs' && r0.complete);
  const pk = tape.poolKind(POOL);
  check('...the measured $SEND pool answers as a v2 pair of the chain\'s factory, and that is kept: a later walk does not check it again', pk && pk.kind === 'v2' && pk.factory === FACTORY && pk.why === null && (await tape.walk(STREAMS(), { head: HEAD }), node.st.callItems.filter((a) => a === POOL).length === 3), JSON.stringify(pk));
  // a v3 pool: its own events, kept under the same kinds
  const q0 = node.st.queries.length;
  const r = await tape.walk(TAPE.poolStreams(V3, { start: START }), { head: HEAD });
  const v3q = node.st.queries.slice(q0).filter((q) => q.address === V3);
  const rows = TAPE.poolRows(db, V3);
  check('a v3 pool (no getReserves(), a 7-word slot0()) is read with the v3 events: Swap, Mint and Burn, never a v2 topic', r.complete && tape.poolKind(V3).kind === 'v3' && v3q.length > 0 && v3q.every((q) => [T3.Swap, T3.Mint, T3.Burn].includes(q.topics[0])), JSON.stringify(r.failed));
  check('...its Swap is kept raw under kind Swap with its five words (the engine decodes 4 words as v2, 5 as v3), and its Mint and Burn', rows.map((x) => x.kind).join() === 'Mint,Swap,Burn' && rows[1].data.length === 2 + 64 * 5 && rows[1].data === v3logs[1].data);
  check('...a v3 pool asked for a Sync (it has none) fails that stream with the reason, and asks nothing', await (async () => { const n = node.st.queries.length; const x = await tape.walk(TAPE.poolStreams(V3, { start: START, kinds: ['Sync'] }), { head: HEAD }); return x.failed.length === 1 && /v3 pool has no Sync/.test(x.failed[0].why) && node.st.queries.length === n; })());
  // an address that answers none of the three: never read, so never "complete with no trades"
  const c0 = node.st.callItems.length, q1 = node.st.queries.length;
  const rn = await tape.walk(TAPE.poolStreams(NOTPOOL, { start: START }).concat(TAPE.transferStream(SEND, { start: START })), { head: HEAD });
  check('an address that answers neither getReserves() nor slot0() is not read at all: its three streams fail with the reason, no log is asked, no cursor is made', rn.failed.length === 3 && rn.failed.every((x) => /not a pool this tape reads/.test(x.why)) && !node.st.queries.slice(q1).some((q) => q.address === NOTPOOL) && !TAPE.cursorGet(db, 'pool:' + NOTPOOL + ':Swap') && node.st.callItems.length - c0 === 3, JSON.stringify(rn.failed));
  const thn = tape.tapeHead(SEND, [NOTPOOL]);
  check('...tapeHead with it is unknown — block null, "not a pool this tape reads" — never a complete tape with no buys', thn.block === null && /not a pool this tape reads/.test(thn.why) && thn.pools[NOTPOOL] === null, JSON.stringify(thn));
  const c1 = node.st.callItems.length;
  await tape.walk(TAPE.poolStreams(NOTPOOL), { head: HEAD });
  clock += TAPE.LIMITS.POOL_RECHECK_MS + 1;
  await tape.walk(TAPE.poolStreams(NOTPOOL), { head: HEAD });
  check('...it is not checked again for an hour (a refused call is null, like a revert), then it is', node.st.callItems.length - c1 === 3);
  // the factory allow-list: only pools from the factories the server names
  const db2 = freshDb(), node2 = makeNode({ logs: BASE_LOGS.concat(v3logs), calls }), tape2 = mk(db2, node2, { factories: { [FACTORY]: 'v2' } });
  const rf = await tape2.walk(STREAMS().concat(TAPE.poolStreams(V3, { start: START }), TAPE.poolStreams(OTHER, { start: START })), { head: HEAD });
  const whyOf = (p) => (rf.failed.find((x) => x.stream === 'pool:' + p + ':Swap') || {}).why || '';
  check('with factories given, the $SEND pool (made by the named factory) is read, and a v3 pool or a v2-shaped pair of another factory is not', STREAMS().every((s) => (TAPE.cursorGet(db2, s.key) || {}).block === HEAD) && /factory this tape does not read/.test(whyOf(V3)) && /factory this tape does not read/.test(whyOf(OTHER)) && rf.failed.length === 6, JSON.stringify(rf.failed));
  check('poolKindOf: an answer that fits both shapes, or neither, places nothing', TAPE.poolKindOf([CHECK[0].result, CHECK[1].result, V3_CALLS[TAPE.SEL.slot0].result]).kind === null && TAPE.poolKindOf([null, null, null]).kind === null && TAPE.poolKindOf([null, CHECK[1].result, null]).kind === 'v2');
});

/* ═══ 15. never blockTimestamp ═══ */
check('NEVER blockTimestamp: across every walk, append, dating and receipt above, no log\'s blockTimestamp was read once', TRAP === 0, TRAP + ' reads');
const CODE = readFileSync(path.join(ROOT, 'lib', 'tape.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
check('...and lib/tape.js does not name the field anywhere but its comments', !/blockTimestamp/.test(CODE));

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !x ? '' : '  — ' + x)); if (ok) pass++; }
console.log(`${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
