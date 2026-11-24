'use strict';
/* ===== What a member BOUGHT: the acquisition engine behind "$100 bought" ===============================================
   Owner, 2026-11-17: "make it $100 of value bought in the token not the current token value, and change that rule across
   the platform" — "make sure transfers do not count as buy but instead follow the transactions back to the original buy
   on-chain and make sure the buy date is correct for all users". Then, answering the open questions: "Count a buy after
   24 h held", "At least $10 of it, at cost", "One other account per wallet; $100 to set date".

   This file is the pure part. It takes what the chain already said — every Transfer of one coin (the coin tape), its
   pools' Swap / Mint / Burn events, the block times the server persisted and an ETH/USD reader — and answers, for ONE
   member (the wallets linked now, plus the wallets Diamond Hands follows for them) and ONE coin: which tokens they
   acquired, which of those were market buys and what each cost in dollars at the block it was bought, what still holds,
   when they first bought, and the Diamond month's flows. No chain read, no database, no clock of its own: lib/tape.js
   reads, server.js stores and decides, and the rules here are tested exactly as they run (tests/acquire.mjs).

   The rules (the decisions document's H1–H7 and H11, with the owner's answers):
     · A BUY is one (transaction, pool) whose Swaps took quote in and paid the coin out, net: token-out minus token-in
       above 0 and quote-in minus quote-out above 0 (a donate + swap + skim nets 0; a same-transaction flip nets ~0).
       Who took the pool's tokens is decided the way lib/bundles.js decomposeTx decides it — tokens are followed through
       routers to the wallet they stop at, and a contract's own stock passed on beside them is a TRANSFER, traced below.
       settleTx re-runs that walk with every pop's destinations kept, and is checked against decomposeTx itself on every
       single-pool transaction: a mismatch makes the transaction unknown, never a guess. Takers are scaled to the Swap's
       amount when the pool paid out more (a Burn or skim beside the buy is never bought), and the quote is split by tokens
       across REAL takers only: the token contract, 0x0, 0x…dEaD, the pools and the caller's system addresses never take
       a token, and a learned fee wallet's side slice is out of the denominator — so a taxed $SEND buy is credited 100% of
       what it paid (receipt 0x3de70b…, tests). Shares of one (transaction, pool) sum to at most 1. Who SENT the
       transaction never matters (a Relay fill is sent by a solver and credited to the wallet the tokens reached).
     · USD at the buy = the credited quote × the quote's dollars at that block: USDG counts $1; WETH asks the injected
       ethUsdAt(block) (lib/ethusd.js's grid). Any other quote: unknown ("can't value buys in this pool yet").
     · LOTS are conserved, FIFO by tokens, per wallet, in chain order. A sale, an LP Mint deposit and a tax or burn leg keep
       their cost in spent; a transfer to an address outside the member's set carries its cost and date out with it (and
       brings them back if it returns), so a buy is counted once however it travels (the loop W→Z→W adds nothing).
     · TRANSFERS are not buys: tokens from an outside address are traced through that address's own FIFO, back to the
       market buys they came from, up to MAX_HOPS outside addresses. EOAs, EIP-7702 wallets, Safes and 4337 accounts
       are traced alike — nothing here asks whether an address has code. "Not a buy" (deterministic): a mint from 0x0,
       the token contract or another system address, a pool paying out with no buy behind it (liquidity taken out, a
       skim), a learned router paying outside a buy, a fee slice, the hop limit, and a hub — measured on the sender's
       history UP TO the transfer being traced (spec R4), so nothing sent to it afterwards can erase a credit: sent the
       coin by HUB_SENDERS or more wallets (a wallet that sent it only dust is not counted), or more than HUB_TXS
       transactions. Unknown, never "not a buy": the tracing budget, a reader that failed, the pool's events not read
       yet for that block (by default every block after the last pool event passed: a pool stream that lags the transfer
       tape never turns a buy into "not a buy") — those are TRANSIENT; a balance that goes below zero or a ledger the
       server marked inconsistent ("balances move without Transfer events") is STRUCTURAL.
     · 24 HOURS (Q1): a buy counts once its coins were held 24 hours. Tokens that LEFT the account within 24 hours of
       their buy add $0 wherever they went — back into the pool (sold, a sale's tax leg, deposited as liquidity,
       donated), burned, or sent to a system address (the v2 router, whose balance anyone holding a little LP can sweep
       out again) — FIFO, same-transaction flips included; after that a buy counts forever, even sold. A held buy
       younger than 24 hours is pending: reported, not counted yet. (Tokens sent to an outside wallet carry their cost
       away from the account whenever they go.)
     · STILL HELD (Q2): the FIFO purchase cost of the counted coins still in the linked wallets must be at least $10.
       Today's price never enters. (OG revocation stays at dust — the server's, not this file's.)
     · CLAIMS (Q3): one OTHER account per (coin, origin wallet), plus the origin's own account. The engine asks the
       injected claims(origin, { own }) — 'mine' | 'free' | 'other' — drops an 'other' origin's lots (listed in
       `conflicts`), and returns `needs`: the origins this verdict used, own first, then traced by date, until the
       thresholds are met (a tip that carried $0 is never needed). The server INSERTs them with a positive verdict.
     · DATES (Q4): every piece carries its origin buy's date (tier, Diamond) and when it reached the member (the gate's
       first-day watch). The coin's date is the earliest own counted buy across the linked wallets; a traced transfer
       sets an earlier date only when it carries at least $100 of the original cost — the earliest date by which $100 of
       what it carried had been bought (every origin whose cost made up that $100 is needed, not only the last). Dates
       come from the persisted block times, never a log's blockTimestamp (0x0). lib/tape.js stores the times of Swap
       blocks; a transfer's arrival usually sits in another block, so every block whose time an answer needs and does not
       have is listed in `needBlocks` (tape.js ensureBlockTimes reads them), and the answer it decides is null until then
       — never the next-best time. Block times never run backwards, so the latest arrival is the latest arrival BLOCK's
       time and the disqualifier's anchor the earliest one's: one stored time each.
     · DIAMOND: monthIn = counted tokens bought inside the window (a round trip zeroed by the 24-hour rule is not; a traced
       piece only when its origin wallet was itself a net accumulator that month); monthOut = the linked wallets' own Swap
       sales in the window (an LP Mint is not out); boughtInMonth needs an own counted buy in the window, or a traced
       transfer carrying $100 of window-dated cost. A sale that may be in the window but could not be read blocks a yes
       (more out can only turn it into a no); an unknown on the way in blocks a no. ogDisqualified (dumped AND not an
       accumulator, "DECIDED 2026-09-08") is kept, measured on the account's path: the linked wallets' summed balance
       after its first counted acquisition.
     · UNKNOWNS (H11): known spent ≥ $100 with $10 held passes. Otherwise the floor is null (not false) only when the
       unknowns could still close the gap: a spent gap needs an unknown piece that could still count, a held gap one that
       is still HELD — a piece that was sold can never add to what is held. Each unknown piece carries its fate, whether
       it is held, the block it arose in (a buy's own transaction, where it could be valued at its execution price; the
       transfer's when nothing better is known), the block it reached the account in and, for a buy whose dollars were
       not read, its pool and quote amount — so the server can value only what could count and keep the previous
       verdict for at most 7 days. `why` is 'transient' or 'structural'. Never a 0 for an unread number.

   Pools are v2 (the official $SEND and $GWC pairs) or v3 (their events decoded too, spec R9). A coin with no full tape (H8)
   runs on its member's own receipt logs with `partial`: own buys are read the same way, a transfer in is unknown. Every
   pool of the coin the server knows must be passed: a sale into an unlisted pool would read as a transfer out (its cost
   carried away), and a buy from one as tokens from a hub. Measured on a synthetic $SEND-sized tape (20,000 transactions,
   3,000 wallets): the index builds in ~0.3 s, and one member's evaluation on it takes ~0.2 ms. =========================== */

const B = require('./bundles.js');
const { TRANSFER_TOPIC, SWAP_TOPIC, MINT_TOPIC } = B;
const BURN_TOPIC = '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496';   // Burn(address,uint256,uint256,address): liquidity taken out
// a v3 / concentrated-liquidity pool's own events (spec R9: "v3 Swap decoded too"); every hash checked with ethers' id()
const V3_SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';   // Swap(address,address,int256,int256,uint160,uint128,int24)
const V3_MINT_TOPIC = '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde';   // Mint(address,address,int24,int24,uint128,uint256,uint256)
const V3_BURN_TOPIC = '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c';   // Burn(address,int24,int24,uint128,uint256,uint256)
const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = '0x000000000000000000000000000000000000dead';
const DAY_MS = 864e5;
const LIMITS = Object.freeze({
  MIN_HOLD_USD: 100,            // server.js MIN_HOLD_USD: the floor, now in dollars SPENT buying
  HELD_COST_MIN_USD: 10,        // Q2: the FIFO purchase cost of what is still held
  SELL_WINDOW_MS: DAY_MS,       // Q1: PROOF_SELL_WINDOW_MS — back into the pool inside this adds $0; held this long counts
  DATE_MIN_USD: 100,            // Q4: a traced transfer sets a date only when it carries this much of the original cost
  MAX_HOPS: 3,                  // outside addresses followed back from the member to the original buy
  HUB_SENDERS: B.LIMITS.HUB_SENDERS,   // sent the coin by this many different wallets: a hub (bundles.js's own measure)
  HUB_TXS: 2000,                // or a history this long: an exchange or a contract, never one person's wallet
  TRACE_TXS: 50000,             // the tracing budget per evaluation: transactions of OUTSIDE addresses replayed (members are free)
  STACK: 1000,                  // tracing recursion this deep is a broken tape, not a history: unknown, never a crash (Node's own
                                // stack held ~3,000 unwarmed levels here; evaluate warms in chain order, so real traces stay a few deep)
  DUST_WEI: 1000000000n,        // OG_DUST_WEI (1e-9 tokens of an 18-decimal coin): "sold out" for the disqualifier's path —
                                // 10^max(0, decimals − 9) for any other coin (opts.decimals)
  MONTH_MS: 30 * DAY_MS,        // OG_MONTH_MS: the disqualifier's month after the first acquisition
});
/* A pool's quote decimals when the server does not pass them: the two quotes this chain's pools are valued in (WETH 18,
   USDG 6 — lib/ethusd.js PAIR). Never a blanket 18: a USDG buy read with 18 decimals is worth a millionth of a millionth
   of its dollars, a made-up $0. Any other quote is not valued at all, so it needs none. */
const QUOTE_DECIMALS = Object.freeze({ WETH: 18, USDG: 6 });
// lib/ethusd.js's no-price codes that reading on never changes (its NULL_KINDS), for an answer that carries a code and no kind
const STRUCTURAL_CODES = new Set(['before-first-sync', 'drained', 'no-block']);

const lc = (a) => String(a == null ? '' : a).toLowerCase();
const isAddr = (a) => /^0x[0-9a-f]{40}$/.test(a);
const topicAddr = (t) => lc('0x' + String(t).slice(26));
function toBig(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string') { const s = v.trim(); if (/^0x[0-9a-f]+$/i.test(s) || /^\d+$/.test(s)) return BigInt(s); }
  return null;
}
function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v.trim())) return parseInt(v, 16);
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v);
  return NaN;
}
function word(data, i) { const s = String(data || '').replace(/^0x/, ''); const w = s.slice(i * 64, i * 64 + 64); return w.length === 64 ? BigInt('0x' + w) : null; }
const addTo = (m, k, v) => m.set(k, (m.get(k) || 0n) + v);
const mapOf = (m, k) => { let x = m.get(k); if (!x) m.set(k, x = new Map()); return x; };
const listOf = (m, k) => { let x = m.get(k); if (!x) m.set(k, x = []); return x; };
const sumVals = (m) => { let t = 0n; for (const v of m.values()) t += v; return t; };
const cmpBig = (a, b) => (b > a ? 1 : b < a ? -1 : 0);   // largest first

/* ----- inputs: the tape's rows, or the raw logs they were read from ----- */
// One Transfer: { block, logIndex (or i, as lib/tape.js tapeRows returns it), tx, from, to, value } as the tape stores it, or
// the eth_getLogs log itself. A row this cannot read throws — a silently dropped transfer would move every balance after it.
function normTransfer(r) {
  if (!r) throw new Error('an empty tape row');
  if (Array.isArray(r.topics)) {
    if (r.removed) return null;
    if (lc(r.topics[0]) !== TRANSFER_TOPIC || r.topics.length < 3) throw new Error('a transfer this reader cannot decode');
    const value = toBig(r.data), block = toNum(r.blockNumber), li = toNum(r.logIndex);
    if (value == null || !Number.isFinite(block) || !Number.isFinite(li) || !r.transactionHash) throw new Error('a transfer this reader cannot decode');
    return { block, li, tx: lc(r.transactionHash), from: topicAddr(r.topics[1]), to: topicAddr(r.topics[2]), value };
  }
  const value = toBig(r.value), block = toNum(r.block), li = toNum(r.logIndex != null ? r.logIndex : r.li != null ? r.li : r.i);
  if (value == null || !Number.isFinite(block) || !Number.isFinite(li) || !r.tx || !isAddr(lc(r.from)) || !isAddr(lc(r.to))) throw new Error('a tape row this engine cannot read');
  return { block, li, tx: lc(r.tx), from: lc(r.from), to: lc(r.to), value };
}
// One pool event: { pool, block, logIndex, tx, kind: 'swap'|'mint'|'burn', a0In, a1In, a0Out, a1Out }, or lib/tape.js poolRows'
// { pool, kind: 'Swap'|'Mint'|'Burn', block, i, tx, data } (the unindexed words as stored: four for a v2 Swap, five for a v3
// one), or the raw log. A Sync (or anything else) is not an event this engine reads: null.
function normPoolEvent(r) {
  if (!r) return null;
  if (Array.isArray(r.topics)) {
    if (r.removed) return null;
    const t0 = lc(r.topics[0]), base = { pool: lc(r.address), block: toNum(r.blockNumber), li: toNum(r.logIndex), tx: lc(r.transactionHash) };
    if (!Number.isFinite(base.block) || !Number.isFinite(base.li) || !base.tx) throw new Error('a pool event this reader cannot decode');
    if (t0 === MINT_TOPIC || t0 === V3_MINT_TOPIC) return { ...base, kind: 'mint' };
    if (t0 === BURN_TOPIC || t0 === V3_BURN_TOPIC) return { ...base, kind: 'burn' };
    if (t0 === V3_SWAP_TOPIC) {   // signed amounts, from the pool's side: positive came in, negative went out
      const a0 = word(r.data, 0), a1 = word(r.data, 1);
      if (a0 == null || a1 == null) throw new Error('a swap this reader cannot decode');
      const s0 = BigInt.asIntN(256, a0), s1 = BigInt.asIntN(256, a1);
      return { ...base, kind: 'swap', a0In: s0 > 0n ? s0 : 0n, a1In: s1 > 0n ? s1 : 0n, a0Out: s0 < 0n ? -s0 : 0n, a1Out: s1 < 0n ? -s1 : 0n };
    }
    if (t0 !== SWAP_TOPIC) return null;
    const a = [0, 1, 2, 3].map((i) => word(r.data, i));
    if (a.some((x) => x == null)) throw new Error('a swap this reader cannot decode');
    return { ...base, kind: 'swap', a0In: a[0], a1In: a[1], a0Out: a[2], a1Out: a[3] };
  }
  const kind = lc(r.kind);
  if (kind !== 'swap' && kind !== 'mint' && kind !== 'burn') return null;
  const e = { pool: lc(r.pool), block: toNum(r.block), li: toNum(r.logIndex != null ? r.logIndex : r.li != null ? r.li : r.i), tx: lc(r.tx), kind };
  if (!Number.isFinite(e.block) || !Number.isFinite(e.li) || !e.tx) throw new Error('a pool event this engine cannot read');
  if (kind !== 'swap') return e;
  if (r.a0In == null && typeof r.data === 'string') {   // stored raw: decoded here exactly as a log's data would be
    const n = String(r.data).replace(/^0x/, '').length / 64;
    const d = n === 4 ? normPoolEvent({ address: e.pool, topics: [SWAP_TOPIC], data: r.data, blockNumber: e.block, logIndex: e.li, transactionHash: e.tx })
      : n === 5 ? normPoolEvent({ address: e.pool, topics: [V3_SWAP_TOPIC], data: r.data, blockNumber: e.block, logIndex: e.li, transactionHash: e.tx }) : null;
    if (!d) throw new Error('a stored swap this engine cannot read (' + n + ' words)');
    return { ...e, a0In: d.a0In, a1In: d.a1In, a0Out: d.a0Out, a1Out: d.a1Out };
  }
  for (const k of ['a0In', 'a1In', 'a0Out', 'a1Out']) { e[k] = toBig(r[k]); if (e[k] == null) throw new Error('a swap this engine cannot read'); }
  return e;
}

/* ----- the index: one coin's tape, read once and shared by every member evaluated on it ----- */
/* opts = { token, tapeRows, poolEvents, pools: { [pool]: { tokenIsZero, quote: 'WETH'|'USDG'|…, quoteDecimals } },
   sys: [addresses that are plumbing, never a person: the v2 router, the factory, WETH — server.js isSystemAddr],
   plumbing (or `known`): { fees, routers } (bundle_plumbing's; else learned here from this tape by bundles.js's own rules),
   coverage(block, tx, pool) → whether that pool's events are read for that block, or { from, to } — the server passes its
   pool streams' cursors. Without it, each pool's events count as read up to the last one passed and no further, so a
   pool stream that trails the transfer stream leaves the newer pool payouts unknown, never "not a buy" (a pool none of
   whose events were passed is read nowhere).
   quoteDecimals: per pool; when left out, WETH 18 and USDG 6 (QUOTE_DECIMALS). A value that contradicts those throws.
   decimals: the coin's own (default 18) — its dust, 10^max(0, decimals − 9), is what the hub test and the disqualifier
   ignore. The caches on the index hold only member-independent work (settlements, pool flows, replays, hub thresholds),
   so one index serves many evaluations. */
function buildIndex(opts) {
  const token = lc(opts.token);
  if (!isAddr(token)) throw new Error('the index needs the token address');
  const pools = new Map();
  for (const [a, m] of Object.entries(opts.pools || {})) {
    if (!isAddr(lc(a))) throw new Error('a pool address this engine cannot read');
    const quote = String(m.quote || '').toUpperCase(), given = Number(m.quoteDecimals);
    const known = Object.prototype.hasOwnProperty.call(QUOTE_DECIMALS, quote) ? QUOTE_DECIMALS[quote] : null;
    const has = m.quoteDecimals != null;
    if (has && !(Number.isInteger(given) && given >= 0 && given <= 36)) throw new Error('pool ' + lc(a) + ': quoteDecimals is not a whole number of decimals');
    if (has && known != null && given !== known) throw new Error('pool ' + lc(a) + ': ' + quote + ' has ' + known + ' decimals, not ' + given);
    pools.set(lc(a), { tokenIsZero: !!m.tokenIsZero, quote, quoteDecimals: has ? given : known });   // null: not valued (priceAt says why)
  }
  const decimals = Number.isInteger(opts.decimals) && opts.decimals >= 0 ? opts.decimals : 18;
  const sys = new Set([ZERO, DEAD, token, ...pools.keys(), ...(opts.sys || []).map(lc)]);
  const byTx = new Map(), seen = new Set();
  for (const raw of opts.tapeRows || []) {
    const r = normTransfer(raw); if (!r) continue;
    const k = r.tx + ':' + r.li; if (seen.has(k)) continue; seen.add(k);   // the same log read twice (overlapping windows) is one log
    let t = byTx.get(r.tx);
    if (!t) byTx.set(r.tx, t = { tx: r.tx, block: r.block, first: r.li, logs: [], ev: null });
    else if (t.block !== r.block) throw new Error('one transaction in two blocks: the tape is inconsistent');
    if (r.li < t.first) t.first = r.li;
    t.logs.push(r);
  }
  const evSeen = new Set(), evLast = new Map();   // pool → the last block any of its events was passed for (the default coverage)
  for (const raw of opts.poolEvents || []) {
    const e = normPoolEvent(raw); if (!e || !pools.has(e.pool)) continue;
    if (!(evLast.get(e.pool) >= e.block)) evLast.set(e.pool, e.block);
    const k = e.tx + ':' + e.li; if (evSeen.has(k)) continue; evSeen.add(k);
    const t = byTx.get(e.tx); if (!t) continue;                       // a pool event with no transfer of this coin in it
    if (t.block !== e.block) throw new Error('a pool event and its transaction in two blocks: the tape is inconsistent');
    let a = (t.ev || (t.ev = new Map())).get(e.pool);
    if (!a) t.ev.set(e.pool, a = { tokIn: 0n, tokOut: 0n, qIn: 0n, qOut: 0n, swaps: 0, mint: false, burn: false });
    if (e.kind === 'mint') a.mint = true;
    else if (e.kind === 'burn') a.burn = true;
    else {
      const z = pools.get(e.pool).tokenIsZero;
      a.swaps++;
      a.tokIn += z ? e.a0In : e.a1In; a.tokOut += z ? e.a0Out : e.a1Out;
      a.qIn += z ? e.a1In : e.a0In; a.qOut += z ? e.a1Out : e.a0Out;
    }
  }
  const txs = [...byTx.values()].sort((a, b) => (a.block - b.block) || (a.first - b.first));
  const addrTx = new Map();
  txs.forEach((t, i) => {
    t.i = i; t.logs.sort((a, b) => a.li - b.li);
    const s = new Set(); for (const l of t.logs) { s.add(l.from); s.add(l.to); }
    for (const a of s) listOf(addrTx, a).push(i);
  });
  const cov = opts.coverage;
  const idx = {
    token, pools, sys, txs, byTx, addrTx, decimals, dust: 10n ** BigInt(Math.max(0, decimals - 9)),
    isSys: (a) => !a || sys.has(a),
    isPool: (a) => pools.has(a),
    covered: typeof cov === 'function' ? (b, tx, p) => !!cov(b, tx, p)
      : cov && typeof cov === 'object' ? (b) => b >= (cov.from || 0) && b <= (cov.to == null ? Infinity : cov.to)
      : (b, tx, p) => evLast.has(p) && b <= evLast.get(p),
    cache: { settle: new Map(), flows: new Map(), replay: new Map(), hub: new Map() },   // member-independent work only
    plumbing: null,
  };
  const known = opts.plumbing || opts.known;   // `known` is bundles.js's (and the decisions document's) name for the same thing
  idx.plumbing = known ? { fees: new Set([...(known.fees || [])].map(lc)), routers: new Set([...(known.routers || [])].map(lc)) } : learnPlumbing(idx);
  return idx;
}

/* Fee wallets and routers, by bundles.js's own rules (bundleFold: a fee wallet took side slices beside FEE_PARTIES or more
   buyers; a router handed the pool's tokens to ROUTER_TXS or more different buyers), run on this tape per pool. The server
   can pass what bundle_plumbing learned instead; this is the fallback so the engine never needs a second source. */
function learnPlumbing(idx) {
  const fees = new Set(), routers = new Set();
  const hx = (n) => '0x' + n.toString(16), w = (v) => v.toString(16).padStart(64, '0'), tp = (a) => '0x' + '0'.repeat(24) + a.slice(2);
  const tokenLogs = [];
  for (const t of idx.txs) for (const l of t.logs) tokenLogs.push({ topics: [TRANSFER_TOPIC, tp(l.from), tp(l.to)], data: '0x' + w(l.value), blockNumber: hx(t.block), logIndex: hx(l.li), transactionHash: t.tx });
  for (const [pool, m] of idx.pools) {
    const pairLogs = [];
    for (const t of idx.txs) {
      const a = t.ev && t.ev.get(pool); if (!a) continue;
      if (a.mint) pairLogs.push({ topics: [MINT_TOPIC], data: '0x', blockNumber: hx(t.block), logIndex: hx(t.first), transactionHash: t.tx });
      if (a.swaps) {   // the transaction's swaps, summed: bundleFold reads buy and sale sides separately, as they are here
        const tIn = a.tokIn, tOut = a.tokOut, qIn = a.qIn, qOut = a.qOut;
        const data = m.tokenIsZero ? w(tIn) + w(qIn) + w(tOut) + w(qOut) : w(qIn) + w(tIn) + w(qOut) + w(tOut);
        pairLogs.push({ topics: [SWAP_TOPIC], data: '0x' + data, blockNumber: hx(t.block), logIndex: hx(t.first), transactionHash: t.tx });
      }
    }
    const f = B.bundleFold(tokenLogs, pairLogs, { token: idx.token, pair: pool, tokenIsZero: m.tokenIsZero, isSys: idx.isSys });
    for (const a of f.fees) fees.add(a);
    for (const a of f.routers) routers.add(a);
  }
  return { fees, routers };
}

/* ----- one transaction, settled ----- */
/* The walk decomposeTx does (lib/bundles.js), with two things kept that it adds up and drops: WHICH pop of a wallet's own
   tokens went where, and pools as a set (a transaction can touch more than one pool of a coin). Each address holds, inside
   the transaction: the pools' tokens it was paid or handed (spent first, oldest first), other wallets' own tokens it is
   passing on (by origin, in the order the origins first reached it — decomposeTx's Map order — oldest pop first within
   one), then its own. A row that spends own tokens is a POP of that wallet; at the end each pop knows its destinations:
   't:'+holder (ended at another address), 'p:'+pool (reached a pool), 's:'+address (the token contract, 0x0, 0x…dEaD —
   a tax or a burn). Own tokens that came back to their own wallet never left (taken off the pop).
   Returns { pops: Map(addr → [{ amt, dests }]), takers: Map(pool → Map(holder → amt)), ownIn: Map(holder → [{ from, pop, amt }]),
   sysIn: Map(holder → Map(sysAddr → amt)), poolward: Map(pool → Map(origin → amt)), poolOut: Map(pool → amt) }. */
function settleTx(logs, isPool, isSys) {
  const pseg = new Map();     // holder → [{ pool, amt }]: pools' tokens it holds now, oldest first
  const held = new Map();     // holder → Map(origin → [{ pop, amt }]): other wallets' own (pop ≥ 0) or system (pop -1) tokens it holds now
  const pops = new Map(), poolward = new Map(), poolOut = new Map();
  const dest = (o, p, key, n) => { if (p < 0) return; const d = pops.get(o)[p].dests; d.set(key, (d.get(key) || 0n) + n); };
  const heldAdd = (t, o, p, n) => { const m = mapOf(held, t); const l = listOf(m, o); const last = l[l.length - 1]; if (last && last.pop === p) last.amt += n; else l.push({ pop: p, amt: n }); };
  for (const l of logs) {
    const f = l.from, t = l.to, v = l.value;
    if (v === 0n || f === t) continue;
    if (isPool(f)) { addTo(poolOut, f, v); if (!isSys(t)) listOf(pseg, t).push({ pool: f, amt: v }); continue; }
    // a mint, the token's own tax or swap-and-liquify: nobody's buy, nobody's own tokens — still followed to where it ends
    if (isSys(f)) { if (!isSys(t)) heldAdd(t, f, -1, v); continue; }
    let rest = v;
    const moved = [], parts = [];
    const segs = pseg.get(f);
    while (rest > 0n && segs && segs.length) { const s = segs[0]; const n = s.amt < rest ? s.amt : rest; s.amt -= n; rest -= n; moved.push({ pool: s.pool, amt: n }); if (s.amt === 0n) segs.shift(); }
    const h = held.get(f);
    if (h) for (const [o, list] of h) { if (rest === 0n) break; while (rest > 0n && list.length) { const s = list[0]; const n = s.amt < rest ? s.amt : rest; s.amt -= n; rest -= n; parts.push({ o, p: s.pop, amt: n }); if (s.amt === 0n) list.shift(); } }
    if (rest > 0n) { const ps = listOf(pops, f); ps.push({ amt: rest, dests: new Map() }); parts.push({ o: f, p: ps.length - 1, amt: rest }); }
    if (isPool(t)) { for (const x of parts) { addTo(mapOf(poolward, t), x.o, x.amt); dest(x.o, x.p, 'p:' + t, x.amt); } continue; }   // pools' own tokens going back in vanish
    if (isSys(t)) { for (const x of parts) dest(x.o, x.p, 's:' + t, x.amt); continue; }                                           // a tax or a burn
    for (const m of moved) listOf(pseg, t).push(m);
    for (const x of parts) { if (x.o === t) { dest(x.o, x.p, 'back', x.amt); continue; } heldAdd(t, x.o, x.p, x.amt); }
  }
  const takers = new Map();
  for (const [a, segs] of pseg) for (const s of segs) if (s.amt > 0n) addTo(mapOf(takers, s.pool), a, s.amt);
  const ownIn = new Map(), sysIn = new Map();
  for (const [t, h] of held) for (const [o, list] of h) for (const s of list) {
    if (s.amt <= 0n) continue;
    if (s.pop < 0) addTo(mapOf(sysIn, t), o, s.amt);
    else { dest(o, s.pop, 't:' + t, s.amt); listOf(ownIn, t).push({ from: o, pop: s.pop, amt: s.amt }); }
  }
  for (const ps of pops.values()) for (const p of ps) { const b = p.dests.get('back'); if (b) { p.amt -= b; p.dests.delete('back'); } }
  return { pops, takers, ownIn, sysIn, poolward, poolOut };
}
// decomposeTx's answer and settleTx's must be the same answer (one pool in the transaction): takers, who ended up with whose
// tokens, and whose tokens reached the pool. Run on every such transaction; a mismatch is reported, never smoothed over.
function sameAsBundles(logs, S, pool, isSys) {
  const d = B.decomposeTx(logs, pool, isSys);
  const eq = (a, b) => { if (a.size !== b.size) return false; for (const [k, v] of a) if (b.get(k) !== v) return false; return true; };
  const tk = new Map(); for (const x of d.takers) tk.set(x.addr, x.v);
  if (!eq(tk, S.takers.get(pool) || new Map())) return false;
  const want = new Map(), got = new Map();
  for (const x of d.transfers) addTo(want, x.from + '>' + x.to, x.v);
  for (const [h, l] of S.ownIn) for (const x of l) addTo(got, x.from + '>' + h, x.amt);
  for (const [h, m] of S.sysIn) for (const [o, v] of m) addTo(got, o + '>' + h, v);
  if (!eq(want, got)) return false;
  const pw = new Map([...d.poolward].filter(([, v]) => v > 0n));
  return eq(pw, new Map([...(S.poolward.get(pool) || new Map())].filter(([, v]) => v > 0n)));
}
const NO_POOL = '0x' + 'f'.repeat(40);   // for the cross-check of a transaction no pool touched: an address no log carries
function settleAt(idx, i) {
  let S = idx.cache.settle.get(i);
  if (S) return S;
  const t = idx.txs[i];
  S = settleTx(t.logs, idx.isPool, idx.isSys);
  const touched = new Set(); for (const l of t.logs) { if (idx.isPool(l.from)) touched.add(l.from); if (idx.isPool(l.to)) touched.add(l.to); }
  S.bad = touched.size <= 1 && !sameAsBundles(t.logs, S, touched.size ? [...touched][0] : NO_POOL, idx.isSys);
  idx.cache.settle.set(i, S);
  return S;
}

/* ----- what each pool did in one transaction: who bought, for how much; who sold, deposited or gave ----- */
function flowsAt(idx, i) {
  let F = idx.cache.flows.get(i);
  if (F) return F;
  F = new Map();
  const t = idx.txs[i], S = settleAt(idx, i);
  const here = new Set([...S.takers.keys(), ...S.poolward.keys(), ...S.poolOut.keys(), ...(t.ev ? t.ev.keys() : [])]);
  for (const p of here) {
    const ev = t.ev && t.ev.get(p);
    const f = { pool: p, buy: false, netTok: 0n, netQ: 0n, credits: new Map(), notBuy: new Map(), pw: new Map(), soldBy: new Map(), liqBy: new Map(), unknown: null };
    F.set(p, f);
    if (S.bad) { f.unknown = { uk: 'structural', why: 'this transaction could not be settled the way bundles.js settles it' }; continue; }
    // outside what the pools' streams have read, an event may be missing (a Swap read, its Mint not yet): unknown, never a guess
    if (!idx.covered(t.block, t.tx, p)) { f.unknown = { uk: 'transient', why: 'the pool’s own events for this block are not read yet' }; continue; }
    const e = ev || { tokIn: 0n, tokOut: 0n, qIn: 0n, qOut: 0n, swaps: 0, mint: false, burn: false };
    f.netTok = e.tokOut - e.tokIn; f.netQ = e.qIn - e.qOut;
    const raw = [...(S.takers.get(p) || new Map())].filter(([, v]) => v > 0n).sort((a, b) => cmpBig(a[1], b[1]));
    if (f.netTok > 0n && f.netQ > 0n && raw.length) {
      f.buy = true;
      // the pool paid out more than its Swaps bought (a Burn or a skim in the same transaction): only the bought part is a buy
      const sum = raw.reduce((s, [, v]) => s + v, 0n);
      const scaled = raw.map(([a, v]) => [a, sum > f.netTok ? v * f.netTok / sum : v, v]);
      const top = scaled[0][0];
      let isFee = (a) => a !== top && idx.plumbing.fees.has(a);
      let real = scaled.filter(([a]) => !isFee(a));
      if (!real.length) { real = scaled; isFee = () => false; }
      const denom = real.reduce((s, [, v]) => s + v, 0n);
      for (const [a, v, rv] of scaled) {
        if (isFee(a)) { f.notBuy.set(a, { tokens: rv, why: 'a fee wallet’s slice of someone else’s buy, not a buy' }); continue; }
        if (v > 0n) f.credits.set(a, { tokens: v, costQ: denom > 0n ? f.netQ * v / denom : 0n });
        if (rv > v) f.notBuy.set(a, { tokens: rv - v, why: 'paid out by the pool beside the buy (liquidity taken out or a skim), not bought' });
      }
    } else {
      for (const [a, v] of raw) f.notBuy.set(a, { tokens: v, why: e.burn ? 'liquidity taken out of the pool (a Burn), not a buy' : 'paid out by the pool with no buy behind it (a skim or a refund), not a buy' });
    }
    /* Into the pool: a sale is the Swaps' token-in side, shared among the wallets whose own tokens reached the pool (as
       bundleFold shares it); what is left is liquidity when the pool minted, else a gift to the pool. Pool tokens handed
       straight back in (a same-transaction flip) never were anyone's own, so they are no sale. */
    const pw = S.poolward.get(p);
    if (pw) {
      const sum = sumVals(pw);
      for (const [o, v] of pw) {
        if (v <= 0n) continue;
        f.pw.set(o, v);
        const sold = e.tokIn <= 0n ? 0n : sum <= e.tokIn ? v : e.tokIn * v / sum;
        if (sold > 0n) f.soldBy.set(o, sold);
        if (e.mint && v > sold) f.liqBy.set(o, v - sold);
      }
    }
  }
  idx.cache.flows.set(i, F);
  return F;
}

/* ----- one address's FIFO, replayed over its whole history (token arithmetic only: nothing traced yet) ----- */
/* Per transaction, its pops leave first (from what it held BEFORE the transaction: what it is handed inside a transaction is
   passed on before its own, by the settle rules), then what ended with it is pushed: the pools' tokens (a buy credit, or not a
   buy), system tokens (not a buy), and other wallets' own tokens (a transfer, traced later only if anyone needs it). */
function replay(idx, addr) {
  let R = idx.cache.replay.get(addr);
  if (R) return R;
  const list = idx.addrTx.get(addr) || [];
  const q = []; let head = 0, underflow = false, bal = 0n;
  const pops = new Map(), steps = [];
  let nextId = 0;
  for (const i of list) {
    const S = settleAt(idx, i), F = flowsAt(idx, i);
    (S.pops.get(addr) || []).forEach((p, k) => {
      let need = p.amt; const segs = [];
      while (need > 0n && head < q.length) { const e = q[head]; const n = e.amt < need ? e.amt : need; e.amt -= n; need -= n; segs.push({ inf: e.inf, amt: n }); if (e.amt === 0n) head++; }
      if (need > 0n) underflow = true;
      pops.set(i + ':' + k, { i, k, amt: p.amt, segs, short: need, dests: p.dests });
    });
    const push = (inf) => { if (inf.amt0 > 0n) { inf.id = nextId++; q.push({ inf, amt: inf.amt0 }); } };
    if (S.bad) {   // never smoothed over: whatever ended here in a transaction the cross-check refused is unknown
      let v = 0n;
      for (const m of S.takers.values()) v += m.get(addr) || 0n;
      for (const x of S.sysIn.get(addr) || new Map()) v += x[1];
      for (const x of S.ownIn.get(addr) || []) v += x.amt;
      push({ kind: 'unknown', i, amt0: v, uk: 'structural', why: 'this transaction could not be settled the way bundles.js settles it' });
    } else {
    for (const [p, f] of F) {
      const raw = (S.takers.get(p) || new Map()).get(addr);
      if (!raw) continue;
      if (f.unknown) { push({ kind: 'unknown', i, amt0: raw, uk: f.unknown.uk, why: f.unknown.why }); continue; }
      const c = f.credits.get(addr);
      if (c) push({ kind: 'buy', i, pool: p, amt0: c.tokens, costQ: c.costQ });
      const nb = f.notBuy.get(addr);
      if (nb) push({ kind: 'notbuy', i, amt0: nb.tokens, why: nb.why });
    }
    for (const [o, v] of S.sysIn.get(addr) || []) push({ kind: 'notbuy', i, amt0: v, why: o === ZERO ? 'minted from 0x0, not a buy' : o === idx.token ? 'sent by the token contract itself, not a buy' : 'sent by a system address, not a buy' });
    for (const x of S.ownIn.get(addr) || []) push({ kind: 'xfer', i, from: x.from, pop: x.pop, amt0: x.amt });
    }
    for (const l of idx.txs[i].logs) { if (l.to === addr && l.from !== addr) bal += l.value; if (l.from === addr && l.to !== addr) bal -= l.value; }
    steps.push([i, bal]);
  }
  R = { pops, queue: q.slice(head).filter((e) => e.amt > 0n), underflow, txs: list.length, steps, bal };
  idx.cache.replay.set(addr, R);
  return R;
}

/* Was `addr` a hub when it made the transfer in transaction `upTo`? Measured on its history up to and including that
   transaction only (spec R4: "read that sender's history up to the transfer"). Measured over the whole tape, ten wallets
   sending it 1 wei a month later turned every bag it had ever passed on into "not a buy" after the fact — a definite no
   for every account it backed. A sender counts toward HUB_SENDERS once what it sent here adds up to more than dust (the
   coin's 10^max(0, decimals − 9)). Per address the engine keeps only the two transaction indexes where it became a hub
   (sender count reached, history too long): one walk, member-independent, cached on the index. */
function hubOf(idx, addr, upTo) {
  let H = idx.cache.hub.get(addr);
  if (!H) {
    const list = idx.addrTx.get(addr) || [];
    H = { txsAt: list.length > LIMITS.HUB_TXS ? list[LIMITS.HUB_TXS] : Infinity, sendersAt: Infinity };
    const sent = new Map(), senders = new Set();
    for (const i of list) {
      if (i >= H.txsAt) break;   // past the history limit the answer is a hub whatever the senders say
      for (const x of settleAt(idx, i).ownIn.get(addr) || []) {
        if (idx.isSys(x.from) || senders.has(x.from)) continue;
        const v = (sent.get(x.from) || 0n) + x.amt; sent.set(x.from, v);
        if (v > idx.dust) senders.add(x.from);
      }
      if (senders.size >= LIMITS.HUB_SENDERS) { H.sendersAt = i; break; }
    }
    idx.cache.hub.set(addr, H);
  }
  if (upTo >= H.txsAt) return 'a hub (a history of more than ' + LIMITS.HUB_TXS + ' transactions before this transfer): not traced, not a buy';
  if (upTo >= H.sendersAt) return 'a hub (sent the coin by ' + LIMITS.HUB_SENDERS + ' or more different wallets before this transfer): not traced, not a buy';
  return null;
}

/* ----- tracing: what tokens really were, followed back lazily (only what a member's lots need is ever resolved) ----- */
// pieces = [{ kind: 'buy'|'notbuy'|'unknown', origin, i (the buy's transaction), pool, tokens, costQ, why, uk, inLinked, arr, hops }]
const pieceKey = (p) => [p.kind, p.origin || '', p.i == null ? '' : p.i, p.at == null ? '' : p.at, p.pool || '', p.why || '', p.uk || '', p.inLinked ? 1 : 0, p.arr ? p.arr.i + '|' + p.arr.from + '|' + p.arr.to : '', p.hops || 0].join('#');
function merge(pieces) {
  const m = new Map();
  for (const p of pieces) {
    if (p.tokens <= 0n) continue;
    const k = pieceKey(p), x = m.get(k);
    if (x) { x.tokens += p.tokens; x.costQ += p.costQ || 0n; } else m.set(k, { ...p, costQ: p.costQ || 0n });
  }
  return [...m.values()];
}
// pro rata in BigInt: a part `num` of `den` tokens takes that share of every piece (the floor of each; dust is lost, never made)
function scale(pieces, num, den) {
  if (num === den) return pieces;
  if (den <= 0n) return [];
  const out = [];
  for (const p of pieces) { const tokens = p.tokens * num / den; if (tokens > 0n) out.push({ ...p, tokens, costQ: (p.costQ || 0n) * num / den }); }
  return out;
}
// a piece that is not a buy, or not known: `at` is the transaction it arose in (where its tokens could be valued, if ever)
const stop = (kind, why, uk, tokens, at) => [{ kind, why, uk: uk || null, tokens, costQ: 0n, inLinked: false, arr: null, hops: 0, at: at == null ? null : at }];

function resolveInflow(C, addr, inf, depth) {
  const key = addr + '|' + inf.id + '|' + depth;
  if (C.memoInf.has(key)) return C.memoInf.get(key);
  let out;
  if (inf.kind === 'buy') out = [{ kind: 'buy', origin: addr, i: inf.i, pool: inf.pool, tokens: inf.amt0, costQ: inf.costQ, inLinked: false, arr: null, hops: depth }];
  else if (inf.kind === 'notbuy') out = stop('notbuy', inf.why, null, inf.amt0, inf.i);
  else if (inf.kind === 'unknown') out = stop('unknown', inf.why, inf.uk, inf.amt0, inf.i);
  else {
    const o = inf.from, total = C.popAmt(o, inf.i, inf.pop);
    if (C.member(o)) {   // inside the member's set: their own lots moving
      out = scale(popPieces(C, o, inf.i, inf.pop, 0), inf.amt0, total);
      // a followed wallet's own tokens were never the account's: reaching a linked wallet is when they arrive
      if (C.linked.has(addr)) out = out.map((p) => (p.inLinked ? p : { ...p, arr: { i: inf.i, from: o, to: addr } }));
    }
    else {
      const d = depth + 1, hub = d <= LIMITS.MAX_HOPS && !C.idx.plumbing.routers.has(o) && C.consistent && !C.partial ? hubOf(C.idx, o, inf.i) : null;
      if (C.partial) out = stop('unknown', 'this coin has no full tape: tokens sent in from another wallet are not traced yet', 'structural', inf.amt0, inf.i);
      else if (d > LIMITS.MAX_HOPS) out = stop('notbuy', 'more than ' + LIMITS.MAX_HOPS + ' hops from a market buy: not traced further, not a buy', null, inf.amt0, inf.i);
      else if (C.idx.plumbing.routers.has(o)) out = stop('notbuy', 'a router paying out with no buy behind it, not a buy', null, inf.amt0, inf.i);
      else if (!C.consistent) out = stop('unknown', 'balances move without Transfer events for this coin (the ledger is inconsistent)', 'structural', inf.amt0, inf.i);
      else if (hub) out = stop('notbuy', hub, null, inf.amt0, inf.i);
      else out = scale(popPieces(C, o, inf.i, inf.pop, d), inf.amt0, total);
      // the moment these tokens crossed into the member's set: the arrival a traced date and the gate's watch are read from
      if (C.member(addr)) out = out.map((p) => ({ ...p, arr: { i: inf.i, from: o, to: addr } }));
    }
  }
  if (C.linked.has(addr)) out = out.map((p) => (p.inLinked ? p : { ...p, inLinked: true }));
  out = merge(out);
  C.memoInf.set(key, out);
  return out;
}
function popPieces(C, o, i, k, depth) {
  const key = o + '|' + i + '|' + k + '|' + depth;
  if (C.memoPop.has(key)) return C.memoPop.get(key);
  const total = C.popAmt(o, i, k);
  let out;
  if (++C.stack > LIMITS.STACK) out = stop('unknown', 'the trace went deeper than this engine follows', 'structural', total, i);
  else if (!C.member(o) && !C.charge(o)) out = stop('unknown', 'the read budget for tracing ran out before this transfer was traced', 'transient', total, i);
  else {
    const R = replay(C.idx, o);
    if (R.underflow && !C.member(o)) out = stop('unknown', 'balances move without Transfer events (the sender’s replay went below zero)', 'structural', total, i);
    else {
      const pop = R.pops.get(i + ':' + k);
      out = [];
      for (const s of pop.segs) out.push(...scale(resolveInflow(C, o, s.inf, depth), s.amt, s.inf.amt0));
      if (pop.short > 0n) out.push(...stop('unknown', 'balances move without Transfer events (more left this wallet than the tape shows arriving)', 'structural', pop.short, i));
      out = merge(out);
    }
  }
  C.stack--;
  C.memoPop.set(key, out);
  return out;
}

/* ----- dollars and dates ----- */
function priceAt(C, pool, block) {
  const k = pool + '@' + block;
  if (C.prices.has(k)) return C.prices.get(k);
  const { quote: q, quoteDecimals } = C.idx.pools.get(pool);
  let r;
  if (q !== 'USDG' && q !== 'WETH') r = { v: null, uk: 'structural', why: 'buys in this pool cannot be valued yet (its quote is neither WETH nor USDG)' };
  else if (!Number.isInteger(quoteDecimals)) r = { v: null, uk: 'structural', why: 'the decimals of this pool’s quote are not known' };
  else if (q === 'USDG') r = { v: 1, src: 'USDG counted at $1' };
  else {
    let x;
    try { x = typeof C.ethUsdAt === 'function' ? C.ethUsdAt(block) : null; } catch { x = undefined; }
    if (x === undefined) r = { v: null, uk: 'transient', why: 'the ETH/USD history could not be read' };
    else if (typeof x === 'number' && Number.isFinite(x) && x > 0) r = { v: x, src: 'ETH/USD at the block' };
    else if (x && typeof x === 'object' && Number.isFinite(x.v) && x.v > 0) r = { v: x.v, src: x.src || 'ETH/USD at the block', provisional: !!x.provisional };
    // lib/ethusd.js's null: { v: null, why, code, kind } — kind 'structural' (before the pool's first Sync, a drain, no block)
    // is re-asked only when the tape moves; anything else is retried (H11). The code decides when a reader leaves kind out.
    else r = { v: null, uk: x && (x.kind === 'structural' || (x.kind == null && STRUCTURAL_CODES.has(x.code))) ? 'structural' : 'transient', why: (x && x.why) || 'no ETH/USD for this block yet' };
  }
  C.prices.set(k, r);
  return r;
}
const usdOf = (costQ, dec, v) => Number(costQ * 1000000n / 10n ** BigInt(dec)) / 1e6 * v;   // dollars: exact to the micro-unit of the quote
function timeKeeper(blockTimes) {
  const exact = (b) => {
    let v;
    if (blockTimes instanceof Map) v = blockTimes.get(b);
    else if (typeof blockTimes === 'function') { try { v = blockTimes(b); } catch { v = null; } }
    else if (blockTimes && typeof blockTimes === 'object') v = blockTimes[b];
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  let known = null;   // sorted [block, ms] for bracketing a block whose time was not stored (block times never run backwards)
  const list = () => {
    if (known) return known;
    known = [];
    if (blockTimes instanceof Map) for (const [b, v] of blockTimes) { if (Number.isFinite(v)) known.push([Number(b), v]); }
    else if (blockTimes && typeof blockTimes === 'object' && typeof blockTimes !== 'function') for (const [b, v] of Object.entries(blockTimes)) { if (Number.isFinite(v)) known.push([Number(b), v]); }
    known.sort((a, b) => a[0] - b[0]);
    return known;
  };
  // the block's time against `ms`: -1 before, 0 at, 1 after — or null when no stored time decides it
  const cmp = (b, ms) => {
    const t = exact(b);
    if (t != null) return t < ms ? -1 : t > ms ? 1 : 0;
    const L = list(); let lo = null, hi = null;
    let a = 0, z = L.length - 1;
    while (a <= z) { const m = (a + z) >> 1; if (L[m][0] <= b) { lo = L[m][1]; a = m + 1; } else z = m - 1; }
    for (let j = a; j < L.length; j++) if (L[j][0] >= b) { hi = L[j][1]; break; }
    if (hi != null && hi < ms) return -1;
    if (lo != null && lo > ms) return 1;
    missing.add(b);
    return null;
  };
  /* Every block whose missing time left an answer undecided (`needBlocks`: the server reads them — lib/tape.js
     ensureBlockTimes — and evaluates again). cmp records its own; `at` is exact() for a time an answer is decided by
     (exact() alone is for the times rows only report). */
  const missing = new Set();
  const at = (b) => { const t = exact(b); if (t == null && Number.isFinite(b)) missing.add(b); return t; };
  return { exact, at, cmp, missing };
}

/* ----- the member's account ----- */
const KEPT = new Set(['held', 'parked', 'sold', 'saletax', 'minted', 'donated', 'pool', 'burned', 'system']);   // 'out' carried its cost away
/* The 24-hour rule (Q1) applies to every fate that LEAVES the account — not only the pool's. Left out, a burn, or a send to
   the v2 router (a system address: its Router02 removeLiquidityETHSupportingFeeOnTransferTokens pays the router's whole
   token balance to whoever removes a little liquidity — read from its code, selector af2979eb), counted the whole buy at
   once: buy $100, send it to the router, sweep it back to another wallet, sell — the wash loop Q1 closed, for one pool fee
   and the tax. Held and parked tokens are the other kept fates: pending until 24 hours old. */
const LEAVES = new Set(['sold', 'saletax', 'minted', 'donated', 'pool', 'burned', 'system']);
const BACK_TO_POOL = new Set(['sold', 'saletax', 'minted', 'donated', 'pool']);   // (copy only: "back into the pool")
const SINKS = new Set([ZERO, DEAD]);   // with the token contract: where tokens are burned; any other system address is 'system'
const FATE_WHY = {
  held: 'held in a linked wallet', parked: 'held in a wallet Diamond Hands follows for this account', sold: 'sold into the pool',
  saletax: 'the tax leg of a sale', minted: 'deposited as liquidity (an LP Mint)', donated: 'sent into the pool with no swap or mint',
  pool: 'sent into the pool (its events for that block not read yet)', burned: 'burned or sent to the token contract',
  system: 'sent to a router, factory or other system address (anyone may be able to sweep it out again)',
  out: 'sent to a wallet outside the account: its cost and date went with it',
};

/* evaluate({ token, tapeRows, poolEvents, pools, blockTimes, ethUsdAt, memberSet, claims, nowMs, diamond: { from, until },
              index?, plumbing? (or known?), sys?, coverage?, consistent?, partial?, decimals?, budget? })
   index: buildIndex()'s answer, shared across members (its tape, pools, sys, plumbing and coverage then come from it).
   partial: true for a coin with no full tape (H8 — its member's own transactions' receipt logs only, with `coverage` naming
   those transactions): own buys are classified as here, a transfer in from anyone else is unknown, never a refusal.
   blockTimes: a Map or object (block → ms) — a block between two stored ones is bracketed for window tests — or a function.
   memberSet: [linked addresses] or { linked: [...], followed: [...] } (followed = dh_follow: inside the set, so a send there
   carries nothing out, but its own buys are not the member's unless they reach a linked wallet — then they are traced).
   claims: (origin, { own }) → 'mine' | 'free' | 'other', or a Map / object of the same; default 'mine' for own, 'free' else.
   Returns JSON-safe figures (wei as decimal strings, dollars as numbers, unknown as null with why):
     { token, spentUsd, pendingUsd, maturesAtMs, heldCostUsd, heldWei, floor (true | false | null), provisional, lots: [row],
       unknown: { n, kind, tokens, reasons, pieces: [{ tokens, block, arrivedBlock, fate, held, why, kind, couldCount,
         couldHold, pool, quote, quoteDecimals, quoteAmt, usd }] },
       firstBuyMs, tierDateMs, tierBasis: { origin, via, tx, origins }, lastArrivedMs, lastArrivedBlock, lastArrivedWhy,
       monthIn, monthOut, boughtInMonth, diamondMonth, dq: { dumped, notAccumulator, disqualified, anchorMs, anchorBlock, why? },
       needs, conflicts, needBlocks, tokens: { acquired, bought, sold }, complete, why, traced: { txs, budget } }
     row = { kind, origin, tx, block, via, originMs, arrivedMs, arrivedBlock, fate, fateMs, wallet, tokens, usd, counted,
       pending, zeroed, open (undecided: a block time missing), conflict, hops, why }.
   floor null, lastArrivedMs null with lastArrivedWhy, dq.disqualified null and diamondMonth null are "no answer yet", never
   a no; needBlocks lists the blocks whose stored time would decide more of them. */
function evaluate(opts) {
  if (!opts || !Number.isFinite(opts.nowMs)) throw new Error('evaluate needs nowMs (the engine has no clock of its own)');
  const idx = opts.index || buildIndex(opts);
  const ms = opts.memberSet;
  const linked = new Set((Array.isArray(ms) ? ms : (ms && ms.linked) || []).map(lc).filter(isAddr));
  const followed = new Set(((ms && !Array.isArray(ms) && ms.followed) || []).map(lc).filter((a) => isAddr(a) && !linked.has(a)));
  const T = timeKeeper(opts.blockTimes);
  const charged = new Set();
  const C = {
    idx, linked, followed, member: (a) => linked.has(a) || followed.has(a),
    consistent: opts.consistent !== false, partial: opts.partial === true, ethUsdAt: opts.ethUsdAt,
    memoInf: new Map(), memoPop: new Map(), prices: new Map(), stack: 0, used: 0,
    budget: Number.isFinite(opts.budget) ? opts.budget : LIMITS.TRACE_TXS,
    // each outside address's history is paid for once per evaluation, whether or not an earlier one replayed it: the answer
    // never depends on which member was evaluated first
    charge(o) { if (charged.has(o)) return true; const n = (idx.addrTx.get(o) || []).length; if (this.used + n > this.budget) return false; this.used += n; charged.add(o); return true; },
    popAmt: (o, i, k) => settleAt(idx, i).pops.get(o)[k].amt,
  };
  const claimOf = (origin, own) => {
    const c = opts.claims;
    let v = typeof c === 'function' ? c(origin, { own }) : c instanceof Map ? c.get(origin) : c && typeof c === 'object' ? c[origin] : undefined;
    if (v !== 'mine' && v !== 'free' && v !== 'other') v = own ? 'mine' : 'free';
    return v;
  };

  /* 0. warm the trace in chain order: every pop of the account's wallets is resolved after every pop it can depend on (a pop
     only ever draws on earlier transactions), so a long history between the account's own wallets recurses one step at a
     time. Measured: resolved cold, a 6,000-transfer ping-pong between two of them overflowed Node's stack. */
  const warm = [];
  for (const w of [...linked, ...followed]) for (const pop of replay(idx, w).pops.values()) if (pop.amt > 0n) warm.push([pop.i, pop.k, w]);
  warm.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [i, k, w] of warm) popPieces(C, w, i, k, 0);

  /* 1. every piece the member's wallets hold or let go of, with its fate */
  const fates = [];
  let heldWei = 0n;
  const pushF = (pieces, fate, i, w) => { for (const p of pieces) if (p.tokens > 0n) fates.push({ p, fate, i, w }); };
  let memberUnderflow = false;
  const linkedSales = [];   // [i, tokens, uk] the linked wallets' own Swap sales (any tokens: an airdropped bag sold is still a sale);
                            // uk set (tokens 0) when tokens went into a pool whose flow is unknown
  for (const w of [...linked, ...followed]) {
    const R = replay(idx, w);
    if (R.underflow) memberUnderflow = true;
    /* A sale's tax leg is its own Transfer log (seller → token contract), so its own pop, beside the pop that reached the
       pool: whether the wallet SOLD is asked of the whole transaction, never of one pop — asked per pop, the tax leg read
       as a burn (40 sales in the real $SEND window carry one). */
    const soldIn = new Map();
    const soldTx = (i) => { if (!soldIn.has(i)) { let s = false; for (const f of flowsAt(idx, i).values()) if ((f.soldBy.get(w) || 0n) > 0n) s = true; soldIn.set(i, s); } return soldIn.get(i); };
    for (const pop of R.pops.values()) {
      if (pop.amt <= 0n) continue;
      const pieces = popPieces(C, w, pop.i, pop.k, 0), F = flowsAt(idx, pop.i);
      for (const [d, amt] of pop.dests) {
        const part = scale(pieces, amt, pop.amt);
        if (d.startsWith('t:')) { if (!C.member(d.slice(2))) pushF(part, 'out', pop.i, w); continue; }
        if (d.startsWith('s:')) { const a = d.slice(2); pushF(part, soldTx(pop.i) ? 'saletax' : SINKS.has(a) || a === idx.token ? 'burned' : 'system', pop.i, w); continue; }
        const f = F.get(d.slice(2));
        if (!f || f.unknown) { pushF(part, 'pool', pop.i, w); continue; }
        const pw = f.pw.get(w) || 0n, sold = f.soldBy.get(w) || 0n, liq = f.liqBy.get(w) || 0n;
        if (pw <= 0n) { pushF(part, 'donated', pop.i, w); continue; }
        if (sold > 0n) pushF(scale(part, sold, pw), 'sold', pop.i, w);
        if (liq > 0n) pushF(scale(part, liq, pw), 'minted', pop.i, w);
        if (pw - sold - liq > 0n) pushF(scale(part, pw - sold - liq, pw), 'donated', pop.i, w);
      }
    }
    if (linked.has(w)) for (const i of new Set([...R.pops.values()].map((p) => p.i))) {
      const S = settleAt(idx, i);
      for (const f of flowsAt(idx, i).values()) {
        const s = f.soldBy.get(w);
        if (s) linkedSales.push([i, s, null]);
        // into a pool whose events are not read (or a transaction that could not be settled): a sale or not, unknown — kept with
        // its kind, so the Diamond month can refuse a yes it may not have
        else if (f.unknown && ((S.poolward.get(f.pool) || new Map()).get(w) || 0n) > 0n) linkedSales.push([i, 0n, f.unknown.uk]);
      }
    }
    for (const e of R.queue) { pushF(scale(resolveInflow(C, w, e.inf, 0), e.amt, e.inf.amt0), linked.has(w) ? 'held' : 'parked', null, w); if (linked.has(w)) heldWei += e.amt; }   // held: the queue itself, exact
  }

  /* 2. each piece counted, pending, zeroed, carried out, conflicted or unknown */
  const blockOf = (i) => idx.txs[i].block;
  const unk = { n: 0, tokens: 0n, transient: false, structural: false, fault: false, reasons: new Set(), pieces: [] };
  /* One unknown piece, with what the server needs to judge it (H11): its fate and whether it is still held; `block`, where it
     arose (a buy's own transaction, where it could be valued at its execution price — the transfer's when nothing better is
     known); `arrivedBlock`, where it reached the account; for a buy, its pool, quote and quote amount (and its dollars when
     only its time is missing). couldCount / couldHold: whether, once known, it could add to spent / to the cost still held —
     a piece that was sold never adds to what is held, and a buy younger than 24 hours adds to spent only later. */
  const addUnknown = (uk, why, tokens, i, x) => {
    x = x || {};
    unk.n++; unk.tokens += tokens; if (uk === 'structural') unk.structural = true; else unk.transient = true; unk.reasons.add(why);
    const q = x.pool ? idx.pools.get(x.pool) : null;
    unk.pieces.push({ tokens: tokens.toString(), block: i == null ? null : blockOf(i), arrivedBlock: x.arrivedBlock == null ? null : x.arrivedBlock,
      fate: x.fate || null, held: x.fate === 'held', why, kind: uk === 'structural' ? 'structural' : 'transient',
      couldCount: x.couldCount !== false, couldHold: x.couldHold === true || (x.couldHold == null && x.fate === 'held'),
      pool: x.pool || null, quote: q ? q.quote : null, quoteDecimals: q ? q.quoteDecimals : null,
      quoteAmt: x.costQ == null ? null : x.costQ.toString(), usd: x.usd == null ? null : x.usd });
  };
  // incomplete for a reason that is no piece of tokens (a time an answer needs, the tape of a linked wallet): never moves the floor
  const open = { transient: false, structural: false };
  const openFor = (uk, why) => { open[uk === 'structural' ? 'structural' : 'transient'] = true; unk.reasons.add(why); };
  const per = new Map();   // origin → what this verdict could use of it
  const rows = [];
  // boughtOwn: every market buy into the linked wallets' own hands — round trips, buys still inside their 24 hours, conflicts and
  // undated ones too — what the gate weighs sales against (acquired leaves those out, and a real holder read as a net seller)
  let spent = 0, pending = 0, heldCost = 0, acquired = 0n, boughtOwn = 0n, provisional = false, maturesAtMs = null;
  for (const { p, fate, i, w } of fates) {
    if (!p.inLinked) continue;                                        // a followed wallet's own coins: never the member's
    const row = { kind: p.kind, origin: p.origin || null, tx: p.i == null ? null : idx.txs[p.i].tx, block: p.i == null ? null : blockOf(p.i), via: null,
      originMs: null, arrivedMs: null, arrivedBlock: null, fate, fateMs: i == null ? null : T.exact(blockOf(i)), wallet: w, tokens: p.tokens.toString(), usd: null,
      counted: false, pending: false, zeroed: false, open: false, conflict: false, hops: p.hops || 0, why: p.why || FATE_WHY[fate] };
    rows.push(row);
    // where these tokens reached the account: the crossing of a traced piece, else an own buy's own transaction
    const ai = p.arr ? p.arr.i : p.kind === 'buy' ? p.i : null;
    if (ai != null) { row.arrivedBlock = blockOf(ai); row._ai = ai; }
    if (p.kind === 'unknown') { if (fate !== 'out') addUnknown(p.uk, p.why, p.tokens, p.at != null ? p.at : p.arr ? p.arr.i : i, { fate, arrivedBlock: row.arrivedBlock }); continue; }
    if (p.kind !== 'buy') continue;
    const own = linked.has(p.origin);
    if (own) boughtOwn += p.tokens;
    row.via = own ? 'own' : 'traced';
    row.originMs = T.exact(blockOf(p.i));
    row.arrivedMs = T.exact(row.arrivedBlock);   // reported; the answers read it per block below (needBlocks when it decides one)
    if (fate === 'out') { row.why = FATE_WHY.out; continue; }
    const pr = priceAt(C, p.pool, blockOf(p.i));
    if (pr.v != null) { row.usd = usdOf(p.costQ, idx.pools.get(p.pool).quoteDecimals, pr.v); if (pr.provisional) provisional = true; }
    if (claimOf(p.origin, own) === 'other') { row.conflict = true; row.why = 'already counted for another account'; const x = per.get(p.origin) || { origin: p.origin, own, conflict: true }; x.conflict = true; per.set(p.origin, x); continue; }
    const lot = { fate, arrivedBlock: row.arrivedBlock, pool: p.pool, costQ: p.costQ, usd: row.usd };
    if (row.originMs == null) {
      T.at(blockOf(p.i));
      row.open = true; row.why = 'the block time of this buy is not stored yet';
      addUnknown('transient', row.why, p.tokens, p.i, lot);
      continue;
    }
    if (LEAVES.has(fate)) {   // left the account: counted only if it had been held 24 hours (Q1)
      const c = T.cmp(blockOf(i), row.originMs + LIMITS.SELL_WINDOW_MS);
      if (c == null) {
        row.open = true; row.why = 'the block time of the transaction these tokens left in is not stored yet';
        addUnknown('transient', row.why, p.tokens, p.i, { ...lot, couldHold: false });
        continue;
      }
      if (c < 0) { row.zeroed = true; row.why = (BACK_TO_POOL.has(fate) ? 'back into the pool' : fate === 'burned' ? 'burned' : 'sent to a system address') + ' within 24 hours of its buy: adds $0'; }
    } else if ((fate === 'held' || fate === 'parked') && opts.nowMs - row.originMs < LIMITS.SELL_WINDOW_MS) { row.pending = true; row.why = 'bought less than 24 hours ago: counts once held 24 hours'; }
    if (row.zeroed) continue;
    if (row.usd == null) { addUnknown(pr.uk, pr.why, p.tokens, p.i, { ...lot, couldCount: !row.pending }); row.why = pr.why; }
    acquired += p.tokens;
    const x = per.get(p.origin) || { origin: p.origin, own, conflict: false, usd: 0, heldUsd: 0, firstMs: Infinity, monthUsd: 0, monthTok: 0n };
    per.set(p.origin, x);
    x.firstMs = Math.min(x.firstMs, row.originMs);
    if (row.pending) { if (row.usd != null) pending += row.usd; const m = row.originMs + LIMITS.SELL_WINDOW_MS; if (maturesAtMs == null || m < maturesAtMs) maturesAtMs = m; }
    else { row.counted = true; if (row.usd != null) { spent += row.usd; x.usd += row.usd; } }
    if (fate === 'held' && row.usd != null) { heldCost += row.usd; x.heldUsd += row.usd; }
    row._p = p;   // for the date and month passes below (removed before returning)
  }
  /* A linked wallet's own replay that went below zero: some tokens reached it without a Transfer event. What left it short is
     already an unknown piece above, with its fate (one that went out carried nothing of the account's) — so this is a flag on
     the tape, never a piece that moves the floor. */
  if (memberUnderflow) openFor('structural', 'balances move without Transfer events in a linked wallet (more left it than the tape shows arriving)');
  /* Each (origin, buy) is capped at what that buy credited the origin. Lots are conserved, so this always holds; it is checked
     anyway, because a breach would mean the same tokens counted twice — reported as unknown, never trimmed into a number. */
  const perBuy = new Map();
  // (only what the account KEPT: the same tokens can leave and come back many times, and each trip out is listed as history)
  for (const { p, fate } of fates) if (p.inLinked && p.kind === 'buy' && KEPT.has(fate)) addTo(perBuy, p.origin + '|' + p.i + '|' + p.pool, p.tokens);
  for (const [k, v] of perBuy) {
    const [o, i, pool] = k.split('|'), c = flowsAt(idx, Number(i)).get(pool).credits.get(o);
    if (!c || v > c.tokens) { unk.fault = true; addUnknown('structural', 'one buy came out larger than its credit (an engine fault: nothing about it is counted twice)', v - (c ? c.tokens : 0n), Number(i), { couldCount: true, couldHold: true }); }
  }

  /* 3. dates: the earliest own counted buy; a traced transfer only with $100 of the original cost behind its date */
  const counted = rows.filter((r) => r.counted);
  let firstBuyMs = null, tierDateMs = null, tierBasis = null;
  for (const r of counted) if (r.via === 'own' && (firstBuyMs == null || r.originMs < firstBuyMs)) { firstBuyMs = r.originMs; tierBasis = { origin: r.origin, via: 'own', tx: r.tx, origins: [r.origin] }; }
  tierDateMs = firstBuyMs;
  const groups = new Map();   // one traced transfer (where it crossed into the account) → its counted, priced pieces
  for (const r of counted) if (r.via === 'traced' && r.usd != null && r._p.arr) listOf(groups, r._p.arr.i + '|' + r._p.arr.from + '|' + r._p.arr.to).push(r);
  /* The date a group's cost reached $100, and EVERY origin whose cost made up that $100: each of them backs the date, so each
     is claimed (Q3). Claimed was only the origin that crossed the line, so one early wallet's $99 plus a fresh $2 sliver
     wallet dated any number of accounts early. */
  const dateOf = (list, keep) => {
    let s = 0; const used = [];
    for (const r of [...list].filter(keep).sort((a, b) => a.originMs - b.originMs)) {
      s += r.usd; if (!used.includes(r.origin)) used.push(r.origin);
      if (s >= LIMITS.DATE_MIN_USD) return { r, origins: used };
    }
    return null;
  };
  for (const list of groups.values()) {
    const d = dateOf(list, () => true);
    if (d && (tierDateMs == null || d.r.originMs < tierDateMs)) { tierDateMs = d.r.originMs; tierBasis = { origin: d.r.origin, via: 'traced', tx: d.r.tx, origins: d.origins }; }
  }
  /* The latest arrival of counted tokens (H12: the gate's first-day watch runs from it). Block times never run backwards, so it
     is the time of the latest arrival BLOCK: one stored time. lib/tape.js stores Swap blocks' times, and a transfer's arrival
     is often in another block — then it is null with why (and the block is in needBlocks), never the next-best arrival: that
     skipped the watch for a bag transferred in today. A buy not decided yet (a time missing) that arrived later leaves it open too. */
  let lastArrivedBlock = null;
  for (const r of rows) if ((r.counted || r.pending) && r.arrivedBlock != null && (lastArrivedBlock == null || r.arrivedBlock > lastArrivedBlock)) lastArrivedBlock = r.arrivedBlock;
  let lastArrivedMs = null, lastArrivedWhy = null;
  if (rows.some((r) => r.open && r.arrivedBlock != null && (lastArrivedBlock == null || r.arrivedBlock > lastArrivedBlock))) lastArrivedWhy = 'a later acquisition is not decided yet (a block time it needs is not stored)';
  else if (lastArrivedBlock != null) { lastArrivedMs = T.at(lastArrivedBlock); if (lastArrivedMs == null) lastArrivedWhy = 'the block time of the latest arrival is not stored yet'; }
  if (lastArrivedWhy) openFor('transient', lastArrivedWhy);

  /* 4. the Diamond month */
  const dm = opts.diamond && Number.isFinite(opts.diamond.from) && Number.isFinite(opts.diamond.until) ? opts.diamond : null;
  let monthIn = 0n, monthOut = 0n, boughtInMonth = null, diamondMonth = null;
  const inOpen = { transient: false, structural: false }, outOpen = { transient: false, structural: false };   // what more could come in / go out
  const monthOrigins = [];
  if (dm) {
    const inM = (t) => t != null && t >= dm.from && t <= dm.until;
    const inWindow = (b) => { const a = T.cmp(b, dm.from), z = T.cmp(b, dm.until); return a == null || z == null ? null : a >= 0 && z <= 0; };
    const accCache = new Map(), accumulator = (o) => originAccumulated(idx, o, dm, T, accCache);   // per evaluation: it reads this evaluation's block times
    boughtInMonth = false;
    for (const r of rows) {
      // COUNTED buys only (R7 "in = counted buys dated in the month"): a round trip the 24-hour rule zeroed, a buy still pending,
      // a conflict or a lot carried out adds nothing — a month-end wash sold after the window closed was month-in, never out
      if (!r.counted || !inM(r.originMs)) continue;
      if (r.via === 'traced') { const a = accumulator(r.origin); if (a == null) { inOpen.transient = true; continue; } if (!a) continue; }
      monthIn += BigInt(r.tokens);
      if (r.via === 'own') boughtInMonth = true;
      if (!monthOrigins.includes(r.origin)) monthOrigins.push(r.origin);
    }
    for (const list of groups.values()) {
      const d = dateOf(list, (x) => inM(x.originMs) && accumulator(x.origin) === true);
      if (d) boughtInMonth = true;
    }
    // sales are NOT always read in full: one into a pool whose events are unread, or whose time is not stored, may be month-out
    for (const [i, s, u] of linkedSales) {
      const w = inWindow(blockOf(i));
      if (w == null) { outOpen.transient = true; continue; }
      if (!w) continue;
      if (u) outOpen[u === 'structural' ? 'structural' : 'transient'] = true; else monthOut += s;
    }
    for (const { p, fate, i, w } of fates) {
      if (!followed.has(w) || !p.inLinked || (fate !== 'sold' && fate !== 'pool')) continue;
      const x = inWindow(blockOf(i));
      if (x == null) { outOpen.transient = true; continue; }
      if (!x) continue;
      if (fate === 'sold') monthOut += p.tokens; else outOpen.transient = true;
    }
    /* More out can only turn a yes into a no, and more in a no into a yes. So a yes stands only when nothing on the way out is
       unknown (it read "sales are read in full", and an unread in-window sale granted Diamond), and a no only when nothing on
       the way in is (an unknown piece, or a traced origin whose month is not decided). */
    const yes = boughtInMonth && monthIn > 0n && monthIn > monthOut;
    const outUnknown = outOpen.transient || outOpen.structural || unk.fault, inUnknown = inOpen.transient || unk.n > 0;
    diamondMonth = yes ? (outUnknown ? null : true) : inUnknown ? null : false;
  }
  const monthOpen = { transient: inOpen.transient || outOpen.transient, structural: outOpen.structural };

  /* 5. ogDisqualified on the account's path: the linked wallets' summed balance after the first counted acquisition */
  const dust = Number.isInteger(opts.decimals) && opts.decimals >= 0 ? 10n ** BigInt(Math.max(0, opts.decimals - 9)) : idx.dust;
  const dq = disqualifier(idx, linked, rows, T, dust);
  if (dq && dq.disqualified == null) openFor('transient', dq.why);

  /* 6. the floor (H1 + Q2), with H11's unknowns: null only when what is unknown could still close the gap */
  const spentGap = spent < LIMITS.MIN_HOLD_USD, heldGap = heldCost < LIMITS.HELD_COST_MIN_USD;
  const couldCount = unk.pieces.some((x) => x.couldCount), couldHold = unk.pieces.some((x) => x.couldHold);
  const floor = unk.fault ? null
    : !spentGap && !heldGap ? true
    : (spentGap && !couldCount) || (heldGap && !couldHold) ? false
    : unk.n > 0 ? null : false;

  /* 7. what this verdict needs claimed, and what it could not use */
  const conflicts = [...per.values()].filter((x) => x.conflict).map((x) => x.origin);
  const usable = [...per.values()].filter((x) => !x.conflict && (x.usd > 0 || x.heldUsd > 0)).sort((a, b) => (b.own - a.own) || (a.firstMs - b.firstMs));
  const needs = [];
  let s = 0, h = 0;
  for (const x of usable) { if (s >= LIMITS.MIN_HOLD_USD && h >= LIMITS.HELD_COST_MIN_USD) break; needs.push(x.origin); s += x.usd; h += x.heldUsd; }
  if (tierBasis) for (const o of tierBasis.origins) if (!needs.includes(o)) needs.push(o);
  if (diamondMonth) for (const o of monthOrigins) if (!needs.includes(o)) needs.push(o);

  for (const r of rows) { delete r._p; delete r._ai; }
  rows.sort((a, b) => (a.originMs == null) - (b.originMs == null) || (a.originMs || 0) - (b.originMs || 0) || (a.block || 0) - (b.block || 0));
  const complete = unk.n === 0 && !open.transient && !open.structural && !monthOpen.transient && !monthOpen.structural;
  const kind = unk.transient ? 'transient' : unk.structural ? 'structural' : null;
  return {
    token: idx.token,
    spentUsd: round2(spent), pendingUsd: round2(pending), maturesAtMs, heldCostUsd: round2(heldCost), heldWei: heldWei.toString(),
    floor, provisional,
    lots: rows,
    unknown: { n: unk.n, kind, tokens: unk.tokens.toString(), reasons: [...unk.reasons], pieces: unk.pieces },
    firstBuyMs, tierDateMs, tierBasis, lastArrivedMs, lastArrivedBlock, lastArrivedWhy,
    monthIn: monthIn.toString(), monthOut: monthOut.toString(), boughtInMonth, diamondMonth,
    dq,
    needs, conflicts,
    // blocks whose time an answer above needs and the caller did not pass (lib/tape.js ensureBlockTimes reads them; evaluate again)
    needBlocks: [...T.missing].sort((a, b) => a - b),
    tokens: { acquired: acquired.toString(), bought: boughtOwn.toString(), sold: linkedSales.reduce((t, [, v]) => t + v, 0n).toString() },
    // 'transient': retried (a budget, a reader, a time or a pool stream not read yet); 'structural': re-asked only when the tape,
    // the wallet set or the rules change
    complete, why: complete ? null : (unk.transient || open.transient || monthOpen.transient) ? 'transient' : 'structural',
    traced: { txs: C.used, budget: C.budget },
  };
}
const round2 = (x) => Math.round(x * 100) / 100;

// Was this origin wallet itself a net accumulator over the window: its own market buys there above its own sales? null when a
// time it needs is not stored. Measured on the origin's own credits and sales, from the same tape.
function originAccumulated(idx, o, dm, T, cache) {
  const k = o + '|' + dm.from + '|' + dm.until;
  if (cache.has(k)) return cache.get(k);
  let net = 0n, known = true;
  for (const i of idx.addrTx.get(o) || []) {
    const b = idx.txs[i].block, F = flowsAt(idx, i);
    let delta = 0n;
    for (const f of F.values()) { const c = f.credits.get(o); if (c) delta += c.tokens; const s = f.soldBy.get(o); if (s) delta -= s; }
    if (delta === 0n) continue;
    const a = T.cmp(b, dm.from), z = T.cmp(b, dm.until);
    if (a == null || z == null) { known = false; continue; }
    if (a >= 0 && z <= 0) net += delta;
  }
  const v = known ? net > 0n : null;
  cache.set(k, v);
  return v;
}

/* dumped        = the linked wallets' summed balance fell to dust inside the 30 days after the account's first counted
                   acquisition (its arrival: an own buy's transaction, a traced piece's crossing);
   notAccumulator = that summed balance is lower today than at the end of those 30 days.
   ogDisqualified = dumped AND notAccumulator (server.js OG_DQ_REQUIRE_BOTH, DECIDED 2026-09-08). Transfers between the account's
   own wallets net to zero in the sum. The window opens at the first acquisition's TRANSACTION (block times never run
   backwards, so it is the earliest arrival) and needs that one block's time to close it: a time not stored makes the answer
   null with why — never "not dumped" (read off the times alone, a traced-only account whose arrival block had no stored time
   had no anchor and came out a definite false). A buy not decided yet (its time missing) that may be earlier does the same. */
function disqualifier(idx, linked, rows, T, dust) {
  let ai = null;
  for (const r of rows) if (r.kind === 'buy' && (r.counted || r.pending) && r._ai != null && (ai == null || r._ai < ai)) ai = r._ai;
  const none = (why, anchorBlock) => ({ dumped: null, notAccumulator: null, disqualified: null, anchorMs: null, anchorBlock, why });
  if (rows.some((r) => r.open && r._ai != null && (ai == null || r._ai < ai))) return none('the account’s first acquisition is not decided yet (a block time it needs is not stored)', null);
  if (ai == null) return { dumped: false, notAccumulator: false, disqualified: false, anchorMs: null, anchorBlock: null };
  const anchorBlock = idx.txs[ai].block, anchor = T.at(anchorBlock);
  if (anchor == null) return none('the block time of the account’s first acquisition is not stored yet', anchorBlock);
  const delta = new Map();
  for (const w of linked) { let prev = 0n; for (const [i, b] of replay(idx, w).steps) { addTo(delta, i, b - prev); prev = b; } }
  let bal = 0n, dumped = false, balEnd = null, open = false;
  const end = anchor + LIMITS.MONTH_MS;
  for (const i of [...delta.keys()].sort((a, b) => a - b)) {
    bal += delta.get(i);
    if (i < ai) continue;
    const z = T.cmp(idx.txs[i].block, end);
    if (z == null) { open = true; continue; }
    if (z <= 0) { if (bal <= dust) dumped = true; balEnd = bal; }
  }
  const notAccumulator = balEnd != null && bal < balEnd;
  if (open) return { ...none('a block time the disqualifier’s window needs is not stored yet', anchorBlock), anchorMs: anchor };
  return { dumped, notAccumulator, disqualified: dumped && notAccumulator, anchorMs: anchor, anchorBlock };
}

module.exports = { evaluate, buildIndex, learnPlumbing, settleTx, sameAsBundles, normTransfer, normPoolEvent, priceAt, LIMITS, BURN_TOPIC, V3_SWAP_TOPIC, V3_MINT_TOPIC, V3_BURN_TOPIC, ZERO, DEAD,
  _internal: { settleAt, flowsAt, replay, hubOf, originAccumulated, disqualifier, timeKeeper, scale, merge } };
