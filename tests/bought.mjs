/* "$100 bought", the server's side (lib/bought.js): the coin tape, the ETH/USD grid and the acquisition engine joined into
   per-member verdicts kept in acq_state (owner, 2026-11-17: "make it $100 of value bought in the token not the current token
   value" — "Count a buy after 24 h held", "At least $10 of it, at cost", "One other account per wallet").

   Run with no server and no network: the real lib/bought.js, lib/tape.js, lib/ethusd.js and lib/acquire.js against an
   in-memory database and a FAKE node serving a small hand-built chain (every log, call and block here is made up, and said
   so): one coin and its WETH pool, the WETH/USDG pair's Syncs at $3,000 per ETH, and five members' wallets. What it pins:
   the tick walks every stream and folds the grid; a verdict is made in the background and read with no chain call; a buy
   counts once held 24 hours, a round trip inside them adds $0, a transfer carries its cost to the wallet it went to; a
   positive verdict claims what it used, and a claim taken by another account is not used again; a verdict for another
   wallet set is no answer (null, and the worker asked); what cannot be read yet is null with a reason, retried — never 0. */
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { randomBytes, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const require = createRequire(import.meta.url);
const BOUGHT = require(path.join(ROOT, 'lib', 'bought.js'));
const TAPE = require(path.join(ROOT, 'lib', 'tape.js'));
const ETH = require(path.join(ROOT, 'lib', 'ethusd.js'));
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const section = async (name, fn) => { try { await fn(); } catch (e) { check(name + ' ran to the end', false, e && e.stack); } };

/* ═══ the made-up chain ═══ */
const T = TAPE.TOPICS;
const hx = (n) => '0x' + n.toString(16);
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const topic = (a) => '0x' + '0'.repeat(24) + a.slice(2);
const W = (n) => '0x' + n.toString(16).padStart(40, '0');
const txh = (n) => '0x' + n.toString(16).padStart(64, '0');
const lc = (x) => String(x || '').toLowerCase();
const FACTORY = '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f';   // the chain's v2 factory (server.js FACTORY): the tape reads only its pools
const PAIR = ETH.PAIR.address;
const COIN = W(0x7701), POOL = W(0x7702), ROUTER = W(0x7703);
const A = W(0xa1), B = W(0xb2), C = W(0xc3), D = W(0xd4), E = W(0xe5);
const START = 1000000, HEAD = 1200000;
const BASE_S = 1790000000;                                   // the made-up chain's time at START (seconds); ten blocks a second
const tsOf = (b) => BASE_S + Math.floor((b - START) / 10);
const E18 = 10n ** 18n;
let n = 0;
const logs = [];
const transfer = (b, li, tx, from, to, v) => logs.push({ address: COIN, topics: [T.Transfer, topic(from), topic(to)], data: '0x' + word(v), blockNumber: hx(b), logIndex: hx(li), transactionHash: tx, removed: false });
// a v2 Swap with the coin as token0 and WETH as token1: a buy is WETH in (amount1In), coin out (amount0Out)
const swap = (b, li, tx, to, a0In, a1In, a0Out, a1Out) => logs.push({ address: POOL, topics: [T.Swap, topic(ROUTER), topic(to)], data: '0x' + word(a0In) + word(a1In) + word(a0Out) + word(a1Out), blockNumber: hx(b), logIndex: hx(li), transactionHash: tx, removed: false });
const buy = (b, who, tok, weth) => { const tx = txh(++n); transfer(b, 1, tx, POOL, who, tok * E18); swap(b, 2, tx, who, 0n, weth, tok * E18, 0n); };
const sell = (b, who, tok, weth) => { const tx = txh(++n); transfer(b, 1, tx, who, POOL, tok * E18); swap(b, 2, tx, who, tok * E18, 0n, 0n, weth); };
// the pool's first liquidity: a mint from 0x0 to the pool (not a buy)
transfer(START + 10, 0, txh(++n), W(0), POOL, 1000000n * E18);
buy(START + 1000, A, 2000n, E18 / 10n);                      // A: 2,000 for 0.1 WETH = $300
buy(START + 2000, B, 200n, E18 / 100n);                      // B: 200 for 0.01 WETH = $30
transfer(START + 3000, 1, txh(++n), A, C, 400n * E18);       // A → C: 400 of A's (a fifth: $60 of cost goes with them)
buy(START + 4000, D, 1000n, 4n * E18 / 100n);                // D: 1,000 for 0.04 WETH = $120 …
sell(START + 5000, D, 1000n, 4n * E18 / 100n);               // … sold back 100 seconds later: a round trip inside 24 hours adds $0
// the WETH/USDG pair's Syncs: 100 WETH against 300,000 USDG ($3,000 per ETH), one every 500 blocks
const SYNC_DATA = '0x' + word(100n * E18) + word(300000n * 1000000n);
for (let b = START - 50000; b <= HEAD; b += 500) logs.push({ address: PAIR, topics: [T.Sync], data: SYNC_DATA, blockNumber: hx(b), logIndex: '0x0', transactionHash: txh(0x900000 + b), removed: false });

const REVERT = new Error('execution reverted');
const v2Calls = { [TAPE.SEL.factory]: '0x' + word(FACTORY), [TAPE.SEL.getReserves]: '0x' + word(1) + word(2) + word(3) };
function makeNode(opts = {}) {
  const st = { requests: 0, head: HEAD, calls: { [POOL]: v2Calls, [PAIR]: v2Calls, ...(opts.calls || {}) }, logs: opts.logs || logs };
  function answer(method, params) {
    if (method === 'eth_blockNumber') return hx(st.head);
    if (method === 'eth_call') { const it = (st.calls[lc(params[0].to)] || {})[params[0].data]; if (!it) throw REVERT; return it; }
    if (method === 'eth_getLogs') {
      const q = params[0], f = parseInt(q.fromBlock, 16), t = parseInt(q.toBlock, 16);
      if (t - f + 1 > 10000000) throw new Error('query spans too many blocks, only 10000000 are allowed');
      return st.logs.filter((l) => lc(l.address) === lc(q.address) && lc(l.topics[0]) === lc(q.topics[0]) && parseInt(l.blockNumber, 16) >= f && parseInt(l.blockNumber, 16) <= t)
        .map((l) => ({ ...l, topics: l.topics.slice() }));
    }
    if (method === 'eth_getBlockByNumber') { const b = parseInt(params[0], 16); return { number: hx(b), timestamp: hx(tsOf(b)) }; }
    throw new Error('the method does not exist');
  }
  return {
    st,
    rpc: async (m, p) => { st.requests++; return answer(m, p); },
    pacedBatch: async (calls) => { st.requests++; return calls.map(([m, p]) => { try { return answer(m, p); } catch { return null; } }); },
  };
}
const KEY = randomBytes(32), IKEY = randomBytes(32);
const enc = (s) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', KEY, iv), ct = Buffer.concat([c.update(s, 'utf8'), c.final()]); return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); };
const dec = (s) => { const b = Buffer.from(String(s).slice(3), 'base64'), d = createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };
const idx = (s) => createHmac('sha256', IKEY).update(String(s)).digest('hex');
let clock = (tsOf(HEAD) + 3 * 86400) * 1000;
let LEDGER_HEAD = HEAD;                                      // where the made-up coin's ledger has read to (the walker back-fills up to it)                 // three days after the last block: every buy here is past its 24 hours

function setup(opts = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE identities (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, identifier TEXT, identifier_enc TEXT);
    CREATE TABLE dh_follow (user_id INTEGER, token TEXT, addr_idx TEXT, addr_enc TEXT);`);
  const node = makeNode(opts.node || {});
  const tape = TAPE.createTape({ db, rpc: node.rpc, pacedBatch: node.pacedBatch, now: () => clock, coolUntil: () => 0, cool: () => {}, sleep: async () => {}, crypto: { enc, dec, idx }, settle: 0, factories: { [FACTORY]: 'v2' } });
  const wallets = new Map([[1, [A]], [2, [B]], [3, [C]], [4, [D]], [5, [E]]]);
  for (const [uid, ws] of wallets) for (const a of ws) db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc) VALUES (?, 'wallet', ?, ?)").run(uid, idx(a), enc(a));
  const verdicts = [];
  const bought = BOUGHT.createBought({
    db, now: () => clock, tape, enc, dec, idx, coins: { SEND: COIN }, sys: [ROUTER],
    wallets: (uid) => db.prepare("SELECT id, identifier_enc FROM identities WHERE user_id = ? AND type = 'wallet' ORDER BY id").all(uid).map((r) => ({ id: r.id, addr: dec(r.identifier_enc) })),
    followed: () => [],
    refreshLedger: async () => {},
    ledger: () => ({ status: 'ok', firstBlock: START, lastBlock: LEDGER_HEAD, logs: 10, consistent: true, decimals: 18 }),
    poolsFor: async () => [{ pool: POOL, tokenIsZero: true, quote: 'WETH' }],
    plumbing: () => ({ fees: new Set(), routers: new Set([ROUTER]) }),
    claimedElsewhere: opts.claimedElsewhere || (() => false),
    onVerdict: (uid, token, before, after) => verdicts.push({ uid, token, before: before && before.floor, after: after && after.floor }),
  });
  return { db, node, tape, bought, verdicts };
}

try {
  await section('the tick and the grid', async () => {
    const { db, node, bought } = setup();
    const r = await bought.tick({ maxReads: 400 });
    check('one tick reads every stream to the head: the coin\'s Transfers, its pool\'s Swap / Mint / Burn and the WETH/USDG pair\'s Syncs', r.walk && r.walk.complete === true && !r.walk.failed.length, JSON.stringify(r.walk && r.walk.failed));
    const head = TAPE.tapeHead(db, COIN, [POOL]);
    check('  ...the coin\'s tape is complete through the head, every Swap block dated', head.block === HEAD && head.undated === 0, JSON.stringify(head));
    check('  ...and the ETH/USD grid is folded from the Syncs: $3,000 at a buy\'s block', bought.ethUsdAt(START + 1000).v === 3000 && bought.gridNow().to === HEAD, JSON.stringify(bought.ethUsdAt(START + 1000)));
    check('  ...a closed cell keeps no raw Syncs (its points are kept)', db.prepare("SELECT COUNT(*) n FROM pool_events WHERE pool = ? AND kind = 'Sync' AND block < ?").get(PAIR, ETH.cellSpan(ETH.cellOf(HEAD)).from).n === 0
      && db.prepare('SELECT COUNT(*) n FROM ethusd_cells').get().n > 0);
    const before = node.st.requests;
    const t2 = await bought.tick({ maxReads: 400 });
    check('a second tick with nothing new reads only the head (one request per stream batch at most)', node.st.requests - before <= 3 && t2.walk.complete, node.st.requests - before);
  });

  await section('verdicts', async () => {
    const { db, node, bought, verdicts } = setup();
    await bought.tick({ maxReads: 400 });
    const w = await bought.work({ max: 20 });
    const s = (uid) => bought.stateOf(uid, COIN);
    const a = s(1), b = s(2), c = s(3), d = s(4), e = s(5);
    check('the worker makes a verdict for every member with a wallet', w.done === 5 && [a, b, c, d, e].every((x) => x && x.fresh), JSON.stringify(w));
    check('A bought $300 and sent a fifth away: $240 bought, $240 still held at cost — clears $100 bought', a.floor === true && a.spentUsd === 240 && a.heldCostUsd === 240 && a.reason === 'ok' && a.complete, JSON.stringify({ f: a.floor, s: a.spentUsd, h: a.heldCostUsd, r: a.reason }));
    check('B bought $30: short of $100 bought (reason short-spent)', b.floor === false && b.spentUsd === 30 && b.reason === 'short-spent', JSON.stringify({ f: b.floor, s: b.spentUsd, r: b.reason }));
    check('C was sent 400 by A: not a buy of C\'s, but traced back to A\'s — $60 of A\'s cost came with them', c.floor === false && c.spentUsd === 60 && c.heldCostUsd === 60, JSON.stringify({ f: c.floor, s: c.spentUsd, h: c.heldCostUsd }));
    check('D bought $120 and sold it back inside 24 hours: the round trip adds $0', d.floor === false && d.spentUsd === 0, JSON.stringify({ f: d.floor, s: d.spentUsd, r: d.reason }));
    check('E never touched the coin: no, nothing held (reason none-held)', e.floor === false && e.reason === 'none-held', JSON.stringify({ f: e.floor, r: e.reason }));
    check('the plain columns hold the verdict, the spent figure to the $10 below and a reason code — the exact figures only encrypted',
      db.prepare('SELECT verdict, spent_bucket, reason_code FROM acq_state WHERE user_id = 1').get().spent_bucket === 240
      && !/240/.test(db.prepare('SELECT lots_enc, dates_enc, wei_enc FROM acq_state WHERE user_id = 1').get().lots_enc) && /^v1:/.test(db.prepare('SELECT lots_enc FROM acq_state WHERE user_id = 1').get().lots_enc));
    check('the dates are the buy\'s block time (persisted, never a log\'s blockTimestamp)', a.firstBuyMs === tsOf(START + 1000) * 1000 && a.tierDateMs === tsOf(START + 1000) * 1000, a.firstBuyMs);
    check('a positive verdict claims what it used: A\'s own wallet, no via; no claim for a "no"', db.prepare('SELECT COUNT(*) n FROM buy_claims').get().n === 1
      && db.prepare('SELECT user_id, via_idx FROM buy_claims WHERE origin_idx = ?').get(idx(A)).user_id === 1 && db.prepare('SELECT via_idx FROM buy_claims WHERE origin_idx = ?').get(idx(A)).via_idx === null);
    check('every verdict written is handed to the server (onVerdict)', verdicts.length === 5 && verdicts.find((v) => v.uid === 1).after === true);
    const before = node.st.requests;
    const v1 = bought.verdictOf(1, COIN), v2 = bought.verdictOf(2, COIN);
    check('reading a verdict asks the chain nothing (no engine run, no request)', v1 === true && v2 === false && node.st.requests === before);
    // a wallet linked: the row is for wallets the member no longer has — no answer, and the worker is asked
    db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc) VALUES (2, 'wallet', ?, ?)").run(idx(D), enc(D));
    check('a verdict for another wallet set is no answer: null, and the worker is asked for a new one', bought.stateOf(2, COIN).fresh === false && bought.verdictOf(2, COIN) === null && bought.queueSize() >= 1);
    await bought.work({ max: 20 });
    check('  ...the worker makes it for the wallets linked now', bought.stateOf(2, COIN).fresh === true && bought.stateOf(2, COIN).floor === false);
    // the tape moves under a member's wallet: their row is made again
    const b2 = HEAD + 20000; node.st.head = b2; LEDGER_HEAD = b2;
    buy(HEAD + 10000, B, 3000n, E18 / 5n);   // B buys $600 more (made up)
    const t = await bought.tick({ maxReads: 400 });
    LEDGER_HEAD = HEAD;
    check('the tape moving under a member\'s wallet marks their row to be made again', t.moved >= 1 && db.prepare('SELECT dirty FROM acq_state WHERE user_id = 2').get().dirty === 1, JSON.stringify({ moved: t.moved }));
  });

  await section('one other account per wallet', async () => {
    const { db, bought } = setup();
    const claims = (uid) => bought.claimsFor(uid, COIN);
    db.prepare('INSERT INTO buy_claims (token, origin_idx, user_id, via_idx, at) VALUES (?,?,?,?,?)').run(COIN, idx(A), 7, idx(W(0x77)), 1);
    check('a traced buy already counted by ONE other account is not counted for a third', claims(9)(A, { own: false }) === 'other');
    check('  ...it is still the claiming account\'s', claims(7)(A, { own: false }) === 'mine');
    check('  ...and its own wallet\'s account always keeps its own buys', claims(1)(A, { own: true }) === 'mine');
    check('a traced buy nobody else counted is free', claims(9)(B, { own: false }) === 'free');
    db.prepare('INSERT INTO buy_claims (token, origin_idx, user_id, via_idx, at) VALUES (?,?,?,?,?)').run(COIN, idx(B), 8, null, 1);
    check('a wallet whose buys another account counted as ITS OWN (the wallet moved accounts) backs only that one', claims(2)(B, { own: true }) === 'other');
    const x = setup({ claimedElsewhere: (uid, w) => lc(w) === lc(C) && uid !== 3 });
    check('a wallet whose OG badge or verification backs another account backs nothing here', x.bought.claimsFor(5, COIN)(C, { own: true }) === 'other' && x.bought.claimsFor(3, COIN)(C, { own: true }) === 'mine');
  });

  await section('unknown is never a no', async () => {
    // the pair the ETH/USD history comes from cannot be placed: no price for WETH buys yet
    const { db, bought } = setup({ node: { calls: { [PAIR]: {} } } });
    const r = await bought.tick({ maxReads: 400 });
    check('without the ETH/USD history the tick still keeps the coin\'s tape (one stream\'s failure stops no other)', r.walk && r.walk.failed.length === 1 && TAPE.tapeHead(db, COIN, [POOL]).block === HEAD, JSON.stringify(r.walk && r.walk.failed));
    await bought.work({ max: 20 });
    const a = bought.stateOf(1, COIN);
    check('a buy whose dollars cannot be read yet: the verdict is null (not false), why "transient"', a.floor === null && a.why === 'transient' && a.reason === 'unknown', JSON.stringify({ f: a.floor, w: a.why, r: a.reason }));
    check('  ...and asked again in 15 minutes (then 1 h, then 6 h)', a.dueAt > clock && a.dueAt <= clock + 15 * 60e3, a.dueAt - clock);
    check('  ...and no claim is written for an answer not made', bought.claimsFor(9, COIN)(A, { own: false }) === 'free');
    const e = bought.stateOf(5, COIN);
    check('a member with nothing to value is still a definite no (an unknown elsewhere decides nothing for them)', e.floor === false);
  });

  await section('a coin with no tape', async () => {
    const { db, bought } = setup();
    const OTHER = W(0x8801);
    check('a coin nobody put on the tape has no answer: null, and it is taken on (bought_tokens)', bought.verdictOf(1, OTHER) === null && bought.tokenRow(OTHER) && bought.tokenRow(OTHER).state === 'pending');
    await bought.work({ max: 20 });
    check('  ...until its tape is ready the worker writes nothing for it (no row: the features keep what they had), and asking again is still null', bought.stateOf(1, OTHER) === null && bought.verdictOf(1, OTHER) === null);
    db.prepare('UPDATE bought_tokens SET wanted_at = ? WHERE token = ?').run(clock - 31 * 864e5, OTHER);
    await bought.tick({ maxReads: 400 });
    check('  ...a coin nobody has asked about for 30 days leaves the tape (never $SEND or $GWC)', bought.tokenRow(OTHER) === null && bought.tokenRow(COIN) && bought.tokenRow(COIN).core === true);
  });

  await section('pure parts', async () => {
    const rows = [
      { block: 10, from: W(1), to: A, value: 5n }, { block: 20, from: A, to: B, value: 5n }, { block: 20, from: W(1), to: B, value: 0n },
      { block: 30, from: W(1), to: A, value: 7n }, { block: 40, from: A, to: W(2), value: 7n },
    ];
    const times = new Map([[10, 1000], [20, 2000], [30, 3000], [40, 4000]]);
    const h = BOUGHT.heldSpans(rows, [A, B], times, 0n);
    check('heldSpans: a move between linked wallets is no gap — A and B linked, A\'s coins moved to B and A\'s later ones sent out: still held, one open stretch', JSON.stringify(h.spans) === '[[1000,null]]', JSON.stringify(h));
    const h2 = BOUGHT.heldSpans(rows, [A], times, 0n);
    check('  ...with only A linked: held, sent out, held again, sent out', JSON.stringify(h2.spans) === '[[1000,2000],[3000,4000]]', JSON.stringify(h2));
    check('  ...a block with no stored time is asked for, never guessed', JSON.stringify(BOUGHT.heldSpans(rows, [A], new Map([[10, 1000]]), 0n).need.sort()) === '[20,30,40]');
    check('reasonOf: ok, unknown, none held, short of spent (with buys maturing), short of held', BOUGHT.reasonOf({ floor: true }) === 'ok' && BOUGHT.reasonOf({ floor: null, why: 'transient' }) === 'unknown'
      && BOUGHT.reasonOf({ floor: false, heldWei: '0', spentUsd: 0 }) === 'none-held' && BOUGHT.reasonOf({ floor: false, heldWei: '5', spentUsd: 50, pendingUsd: 60 }) === 'short-spent-pending'
      && BOUGHT.reasonOf({ floor: false, heldWei: '5', spentUsd: 150, pendingUsd: 0 }) === 'short-held');
  });
} catch (e) {
  check('the suite ran to the end', false, e && e.stack);
}
let pass = 0;
for (const [nm, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + nm + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
