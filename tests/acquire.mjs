/* The acquisition engine (lib/acquire.js): what a member BOUGHT — "$100 bought", rebuilt (owner, 2026-11-17).

   1. The rules, on hand-built histories (one block a minute; ETH/USD held at $2,000 so 0.05 ETH is $100 — inputs, chosen so
      every expected figure can be worked out by hand): what a buy is, the taxed buy, the zap's Burn, one swap shared by five
      wallets, the loop W→Z→W, round trips inside 24 hours, the $10 still held, slivers and dates, the origin that sold its
      month, the disqualifier, EIP-7702 and Safe senders, the tracing budget and the hop limit, a Relay-style fill — and the
      attacks the abuse critic found already stopped, kept as regressions. Then the WP2 review's findings ("review: …"),
      each a case that failed on the engine as it stood: arrival times the tape does not store, an unread in-window sale, a
      month-end round trip, every way out inside 24 hours (router sweep, burn, a sale's tax leg), multi-origin dates, hubs
      measured up to the transfer, a lagging pool stream, USDG decimals, what unknown pieces could still change, and
      lib/ethusd.js's own no-price answers.
   2. REAL chain data (tests/fixtures/acquire, measured answers of Robinhood Chain's public node; README there): a 10M-block
      window of the $SEND tape, settled transaction by transaction and checked against lib/bundles.js decomposeTx itself;
      the taxed buy receipt 0x3de70b… credited 100%.
   3. The acceptance case: case-a, one account's two linked wallets, every $SEND/$GWC move in or out of them — comes out
      Diamond-eligible: both coins bought inside $GWC's first month, a net accumulator of both, $100 or more spent on each.
      Its fixture is one member's real wallet moves: a wallet, a transaction hash, a block or an exact amount from it leads back
      to that member on an explorer, and this repo is public, so it lives in tests/fixtures/private/ (gitignored) and the case
      runs only where that file is (a NOTE line says so where it is not; its checks are then not counted, never passed).

   Pure: no server, no database, no network. Run by tests/run.mjs like every suite (it is handed the port and ignores it). */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const require = createRequire(import.meta.url);
const A = require(path.join(ROOT, 'lib', 'acquire.js'));
const BUN = require(path.join(ROOT, 'lib', 'bundles.js'));
const { codeKind } = require(path.join(ROOT, 'lib', 'multichain.js'));
const FIX = (f) => JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'acquire', f), 'utf8'));
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const section = (name, fn) => { try { fn(); } catch (e) { check(name + ' ran to the end', false, e && e.stack); } };

/* ═══ 1. the rules, on hand-built histories ═══ */
const TOKEN = '0x' + 'aa'.repeat(20), POOL = '0x' + 'bb'.repeat(20), WETH = '0x' + '0b'.repeat(20);
const W = (n) => '0x' + n.toString(16).padStart(40, '0');
const E18 = 10n ** 18n;
const T0 = Date.UTC(2026, 7, 9);                 // block 0 of these histories
const MIN = 60000, DAY = 1440 * MIN, BPD = 1440;   // one block a minute: 1,440 blocks a day
const msOf = (b) => T0 + b * MIN;
const NOW = msOf(200 * BPD);
const DIAMOND = { from: msOf(10 * BPD), until: msOf(40 * BPD) };
const PX = 2000;
const ETH = (x) => BigInt(Math.round(x * 1e9)) * 10n ** 9n;
const txh = (n) => '0x' + String(n).padStart(64, '0');
function tape() {
  const rows = [], ev = []; let li = 0;
  const swap = (b, tx, a0In, a1In, a0Out, a1Out) => ev.push({ pool: POOL, kind: 'swap', block: b, logIndex: li++, tx: txh(tx), a0In, a1In, a0Out, a1Out });
  const api = {
    rows, ev,
    t(b, tx, from, to, v) { rows.push({ block: b, logIndex: li++, tx: txh(tx), from, to, value: v }); return api; },
    // the token is token1 of its pool (WETH's address sorts low, as on the chain): a buy takes WETH in (amount0In) and pays the token out
    buy(b, tx, tokOut, qIn) { swap(b, tx, qIn, 0n, 0n, tokOut); return api; },
    sell(b, tx, tokIn, qOut) { swap(b, tx, 0n, tokIn, qOut, 0n); return api; },
    mint(b, tx) { ev.push({ pool: POOL, kind: 'mint', block: b, logIndex: li++, tx: txh(tx) }); return api; },
    burn(b, tx) { ev.push({ pool: POOL, kind: 'burn', block: b, logIndex: li++, tx: txh(tx) }); return api; },
    // a plain market buy: the pool pays the wallet, for `eth` ETH
    mbuy(b, tx, to, tokens, eth) { return api.t(b, tx, POOL, to, tokens).buy(b, tx, tokens, ETH(eth)); },
    msell(b, tx, from, tokens, eth) { return api.t(b, tx, from, POOL, tokens).sell(b, tx, tokens, ETH(eth)); },
    opts(more) { return { token: TOKEN, tapeRows: rows, poolEvents: ev, pools: { [POOL]: { tokenIsZero: false, quote: 'WETH', quoteDecimals: 18 } }, sys: [WETH], blockTimes: (b) => msOf(b), ethUsdAt: () => PX, nowMs: NOW, diamond: DIAMOND, plumbing: { fees: [], routers: [] }, ...more }; },
    eval(member, more) { return A.evaluate(api.opts({ memberSet: member, ...more })); },
  };
  return api;
}
const lotsOf = (r, f) => r.lots.filter(f);
const tok = (n) => (BigInt(n) * E18).toString();
const near = (a, b) => a != null && Math.abs(a - b) < 0.011;

const M = W(0x11), M2 = W(0x12), Z = W(0x2a), O = W(0x0a), R = W(0x7e), C = W(0xc0), FEEW = W(0xfe);

section('the taxed buy', () => {
  // pool → token contract (its own 1% tax), pool → router, router → token contract (1%), router → buyer: one buy, all of its quote
  const c = tape().t(10, 1, POOL, TOKEN, 1n * E18).t(10, 1, POOL, R, 99n * E18).t(10, 1, R, TOKEN, 1n * E18).t(10, 1, R, M, 98n * E18).buy(10, 1, 100n * E18, ETH(0.06));
  const r = c.eval([M]);
  const b = lotsOf(r, (l) => l.kind === 'buy');
  check('a taxed, routed buy is credited 100% of its quote: $120 for 0.06 ETH (tax legs to the token contract take no share)', r.spentUsd === 120 && b.length === 1 && b[0].tokens === tok(98) && b[0].via === 'own', JSON.stringify(r.lots));
  check('  ...the router is no buyer (no credit, nothing held)', !lotsOf(r, (l) => l.wallet === R).length && r.heldWei === tok(98));
});

section('a zap\'s Burn', () => {
  // one transaction: the pool's Swap buys 50, and a Burn pays 30 more of liquidity out — 80 reach the wallet
  let c = tape().t(10, 1, POOL, M, 80n * E18).buy(10, 1, 50n * E18, ETH(0.05)).burn(10, 1);
  let r = c.eval([M]);
  const buy = lotsOf(r, (l) => l.kind === 'buy'), nb = lotsOf(r, (l) => l.kind === 'notbuy');
  check('a zap (buy + Burn in one transaction): only the 50 the Swap bought are a buy, with all of its $100', buy.length === 1 && buy[0].tokens === tok(50) && r.spentUsd === 100, JSON.stringify(r.lots));
  check('  ...the 30 the Burn paid out are not a buy, and say so', nb.length === 1 && nb[0].tokens === tok(30) && /not bought|liquidity/.test(nb[0].why), JSON.stringify(nb));
  c = tape().t(10, 1, POOL, M, 30n * E18).burn(10, 1);
  r = c.eval([M]);
  check('a Burn with no Swap (liquidity taken out) is no buy: $0 spent, a definite "no", not an unknown', r.spentUsd === 0 && r.floor === false && r.complete && /Burn/.test(r.lots[0].why), JSON.stringify(r));
});

section('one swap, five wallets', () => {
  const five = [1, 2, 3, 4, 5].map((n) => W(0x100 + n));
  // a contract takes the pool's 100 and hands 20 to each of five wallets
  let c = tape().t(10, 1, POOL, C, 100n * E18).buy(10, 1, 100n * E18, ETH(0.05));
  for (const w of five) c.t(10, 1, C, w, 20n * E18);
  let total = 0;
  for (const w of five) total += c.eval([w]).spentUsd;
  check('one $100 swap handed to five wallets: each is credited $20, the five sum to exactly $100 (shares ≤ 1)', total === 100 && c.eval([five[2]]).spentUsd === 20, total);
  // the contract also had 400 of its own stock (minted), and sends each wallet 100: only the pool's 100 is a buy
  c = tape().t(5, 9, A.ZERO, C, 400n * E18).t(10, 1, POOL, C, 100n * E18).buy(10, 1, 100n * E18, ETH(0.05));
  for (const w of five) c.t(10, 1, C, w, 100n * E18);
  total = 0; const each = [];
  for (const w of five) { const r = c.eval([w]); total += r.spentUsd; each.push(r.spentUsd); }
  check('one $100 swap plus 400 of the contract\'s own stock sent to five wallets: the five sum to $100, never $500', total === 100, each.join(','));
  check('  ...the stock passed on beside the buy is traced to where it came from (a mint): not a buy', c.eval([five[4]]).lots.every((l) => l.kind === 'notbuy' && /minted/.test(l.why)), JSON.stringify(c.eval([five[4]]).lots));
  const idx = A.buildIndex(c.opts({})), F = A._internal.flowsAt(idx, 1).get(POOL);
  let shares = 0n; for (const x of F.credits.values()) shares += x.costQ;
  check('  ...and the pool flow\'s credits add up to at most what the swap paid', shares <= ETH(0.05) && shares === ETH(0.05), shares);
});

section('the loop W→Z→W', () => {
  const base = () => tape().mbuy(10, 1, M, 100n * E18, 0.075).t(3000, 2, M, Z, 100n * E18);
  let r = base().eval([M]);
  check('a $150 buy sent to an outside wallet carries its cost out with it: $0 kept while it is away', r.spentUsd === 0 && lotsOf(r, (l) => l.fate === 'out').length === 1, JSON.stringify(r.lots));
  r = base().t(5000, 3, Z, M, 100n * E18).eval([M]);
  check('...and back again (W→Z→W): $150 — counted once, never twice (the trip out stays listed as history, uncounted)', r.spentUsd === 150 && r.heldCostUsd === 150 && lotsOf(r, (l) => l.kind === 'buy' && l.counted).length === 1 && lotsOf(r, (l) => l.fate === 'out' && !l.counted).length === 1, JSON.stringify(r.lots));
  check('  ...it is still the member\'s own buy, dated when it was bought (and arrived back on the day it returned)', lotsOf(r, (l) => l.counted)[0].via === 'own' && lotsOf(r, (l) => l.counted)[0].arrivedMs === msOf(5000) && r.firstBuyMs === msOf(10) && r.tierDateMs === msOf(10));
  // while Z holds it, Z's account cannot use it: W's wallet is linked to another account
  r = base().eval([Z], { claims: (o) => (o === M ? 'other' : 'free') });
  check('while Z holds it, an account linking Z cannot count W\'s buy (W backs its own account): conflict, $0', r.spentUsd === 0 && r.conflicts.includes(M), JSON.stringify(r));
});

section('round trips inside 24 hours', () => {
  let c = tape();
  for (let k = 0; k < 10; k++) { const b = 100 + k * 200; c.mbuy(b, 2 * k + 1, M, 10n * E18, 0.005).msell(b + 60, 2 * k + 2, M, 10n * E18, 0.0049); }
  let r = c.eval([M]);
  check('ten $10 buys, each sold an hour later: $0 spent (Q1), not $100', r.spentUsd === 0 && lotsOf(r, (l) => l.zeroed).length === 10 && r.floor === false, r.spentUsd);
  r = tape().mbuy(100, 1, M, 10n * E18, 0.005).msell(100 + BPD + 60, 2, M, 10n * E18, 0.005).eval([M]);
  check('a $10 buy sold 25 hours later counts its $10 forever', r.spentUsd === 10 && lotsOf(r, (l) => l.fate === 'sold' && l.counted).length === 1, JSON.stringify(r.lots));
  r = tape().mbuy(100, 1, M, 10n * E18, 0.005).msell(100 + BPD - 1, 2, M, 10n * E18, 0.005).eval([M]);
  check('...one block short of 24 hours adds $0', r.spentUsd === 0);
  r = tape().t(10, 1, POOL, M, 100n * E18).t(10, 1, M, POOL, 100n * E18).buy(10, 1, 100n * E18, ETH(0.05)).sell(10, 1, 100n * E18, ETH(0.0497)).eval([M]);
  check('a same-transaction flip (buy and sell in one transaction): no buy at all, $0', r.spentUsd === 0 && !lotsOf(r, (l) => l.kind === 'buy').length, JSON.stringify(r.lots));
  r = tape().mbuy(200 * BPD - 120, 1, M, 100n * E18, 0.05).eval([M]);
  check('a $100 buy two hours old and still held is pending: $0 counted yet, $100 pending, counted from its 24th hour', r.spentUsd === 0 && r.pendingUsd === 100 && r.maturesAtMs === msOf(200 * BPD - 120) + DAY && r.floor === false, JSON.stringify(r));
  // sold within 24 h through a Mint (an LP deposit) is no way round it
  r = tape().mbuy(100, 1, M, 100n * E18, 0.05).t(200, 2, M, POOL, 100n * E18).mint(200, 2).eval([M]);
  check('...nor is depositing it as liquidity inside 24 hours (the tokens went back into the pool): $0', r.spentUsd === 0 && r.lots[0].fate === 'minted' && r.lots[0].zeroed);
});

section('still held: $10 at cost', () => {
  let r = tape().mbuy(10, 1, M, 200n * E18, 0.1).msell(10 + BPD + 60, 2, M, 199n * E18, 0.09).eval([M]);
  check('$200 bought, all sold after a day but one token ($1 at cost): spent $200, held $1 — fails the $10 rule (Q2)', r.spentUsd === 200 && r.heldCostUsd === 1 && r.floor === false, JSON.stringify(r));
  r = tape().mbuy(10, 1, M, 200n * E18, 0.1).msell(10 + BPD + 60, 2, M, 190n * E18, 0.09).eval([M]);
  check('...keep ten tokens ($10 at cost) and it passes — today\'s price never enters', r.spentUsd === 200 && r.heldCostUsd === 10 && r.floor === true);
  r = tape().mbuy(10, 1, M, 100n * E18, 0.05).msell(10 + BPD + 60, 2, M, 50n * E18, 0.5).eval([M]);
  check('a sale keeps its cost in spent, at any price (sold 50 for ten times what they cost): spent $100, held $50', r.spentUsd === 100 && r.heldCostUsd === 50 && r.floor === true);
});

section('dates and slivers', () => {
  const own = () => tape().mbuy(100, 1, O, 1000n * E18, 0.25).mbuy(100 + 40 * BPD, 2, M, 100n * E18, 0.05);
  let r = own().t(100 + 50 * BPD, 3, O, M, 10n * E18).eval([M]);
  check('a sliver ($5 of an early buy) cannot set the date: the member\'s own buy (day 40) does', r.tierDateMs === msOf(100 + 40 * BPD) && r.tierBasis.via === 'own' && r.spentUsd === 105, JSON.stringify({ d: r.tierDateMs, b: r.tierBasis, s: r.spentUsd }));
  check('  ...and a tip nobody needed is not claimed: needs is the member\'s own wallet only', r.needs.length === 1 && r.needs[0] === M, r.needs);
  r = own().t(100 + 50 * BPD, 3, O, M, 300n * E18).eval([M]);
  check('a traced transfer carrying $150 of the original cost sets the date: day 0, from that buy', r.tierDateMs === msOf(100) && r.tierBasis.via === 'traced' && r.tierBasis.origin === O && r.needs.includes(O), JSON.stringify(r.tierBasis));
  check('  ...the piece keeps both dates: bought day 0, arrived day 50', (() => { const l = lotsOf(r, (x) => x.origin === O)[0]; return l.originMs === msOf(100) && l.arrivedMs === msOf(100 + 50 * BPD); })());
  r = tape().mbuy(100, 1, O, 10n * E18, 0.0025).mbuy(100 + 30 * BPD, 2, O, 400n * E18, 0.1).t(100 + 50 * BPD, 3, O, M, 410n * E18).eval([M]);
  check('blended ($5 from day 0 + $200 from day 30 in one transfer): dated day 30, when $100 of it had been bought', r.tierDateMs === msOf(100 + 30 * BPD), r.tierDateMs && (r.tierDateMs - T0) / DAY);
  r = tape().mbuy(100 + 300 * BPD, 1, M, 100n * E18, 0.05).eval([M], { nowMs: msOf(400 * BPD) });
  check('a buy dated after a window is dated when it was bought: nothing earlier can be made of it', r.firstBuyMs === msOf(100 + 300 * BPD) && r.tierDateMs === r.firstBuyMs);
  r = tape().mbuy(5000, 1, M2, 100n * E18, 0.05).mbuy(100, 2, M, 1n * E18, 0.0005).mbuy(9000, 3, M2, 10n * E18, 0.005).eval([M2, M]);
  check('the coin\'s date is the earliest own counted buy across ALL linked wallets (not whichever wallet was best)', r.firstBuyMs === msOf(100));
});

section('the Diamond month', () => {
  // the origin had 1,000 from before the window, sold them all inside it, bought 100 inside it and passed those 100 on
  const story = (sellBlock) => tape().mbuy(5 * BPD, 1, O, 1000n * E18, 0.5)
    .msell(sellBlock, 2, O, 1000n * E18, 0.4)
    .mbuy(12 * BPD, 3, O, 100n * E18, 0.05)
    .t(14 * BPD, 4, O, M, 100n * E18)
    .mbuy(11 * BPD, 5, M, 100n * E18, 0.05);
  let r = story(13 * BPD).eval([M]);
  check('an origin that was a net SELLER that month: its month-dated piece is not month-in', r.monthIn === tok(100) && r.boughtInMonth === true && r.diamondMonth === true, JSON.stringify({ i: r.monthIn, o: r.monthOut }));
  r = tape().mbuy(12 * BPD, 3, O, 100n * E18, 0.05).t(14 * BPD, 4, O, M, 100n * E18).mbuy(11 * BPD, 5, M, 100n * E18, 0.05).eval([M]);
  check('...an origin that bought its 100 that month and sold nothing in it (a net accumulator): the piece counts, month-in 200', r.monthIn === tok(200), r.monthIn);
  r = tape().mbuy(11 * BPD, 1, M, 100n * E18, 0.05).msell(13 * BPD, 2, M, 100n * E18, 0.05).mbuy(15 * BPD, 3, M, 50n * E18, 0.025).eval([M]);
  check('own sales in the window are month-out: bought 150, sold 100 → net accumulator, Diamond month holds', r.monthIn === tok(150) && r.monthOut === tok(100) && r.diamondMonth === true);
  r = tape().mbuy(11 * BPD, 1, M, 100n * E18, 0.05).msell(13 * BPD, 2, M, 100n * E18, 0.05).mbuy(41 * BPD, 3, M, 500n * E18, 0.25).eval([M]);
  check('...bought 100, sold 100 inside it (whatever came after): not a net accumulator, no Diamond month', r.diamondMonth === false && r.monthIn === tok(100) && r.monthOut === tok(100));
  r = tape().mbuy(11 * BPD, 1, M, 100n * E18, 0.05).t(13 * BPD, 2, M, POOL, 50n * E18).mint(13 * BPD, 2).eval([M]);
  check('an LP Mint deposit is not month-out', r.monthOut === '0' && r.diamondMonth === true && lotsOf(r, (l) => l.fate === 'minted' && l.counted).length === 1);
  r = tape().mbuy(5 * BPD, 1, M, 100n * E18, 0.05).eval([M]);
  check('no buy in the window: no Diamond month (a definite no on a complete read)', r.boughtInMonth === false && r.diamondMonth === false && r.complete);
});

section('ogDisqualified, on the account\'s path', () => {
  const base = () => tape().mbuy(100, 1, M, 100n * E18, 0.05).msell(100 + 5 * BPD, 2, M, 100n * E18, 0.05).mbuy(100 + 10 * BPD, 3, M, 50n * E18, 0.025);
  let r = base().msell(100 + 40 * BPD, 4, M, 20n * E18, 0.01).eval([M]);
  check('sold out inside 30 days of the first buy AND below the month-end level today: disqualified (dumped AND not an accumulator)', r.dq.dumped === true && r.dq.notAccumulator === true && r.dq.disqualified === true, JSON.stringify(r.dq));
  r = base().mbuy(100 + 40 * BPD, 4, M, 20n * E18, 0.01).eval([M]);
  check('...bought back past the month-end level: dumped but an accumulator — kept (DECIDED 2026-09-08: both are required)', r.dq.dumped === true && r.dq.notAccumulator === false && r.dq.disqualified === false);
  r = tape().mbuy(100, 1, M, 100n * E18, 0.05).t(100 + 3 * BPD, 2, M, M2, 100n * E18).t(100 + 4 * BPD, 3, M2, M, 100n * E18).eval([M, M2]);
  check('moving the bag between the account\'s own wallets is no dip to dust', r.dq.dumped === false && r.spentUsd === 100);
});

section('wallets Diamond Hands follows for the account', () => {
  const F = W(0xf0);
  let r = tape().mbuy(10, 1, M, 100n * E18, 0.05).t(10 + 2 * BPD, 2, M, F, 100n * E18).eval({ linked: [M], followed: [F] });
  check('a send to a followed wallet carries nothing out: $100 still spent, but none of it is held in a LINKED wallet ($10 rule fails)', r.spentUsd === 100 && r.heldCostUsd === 0 && r.floor === false && r.lots[0].fate === 'parked', JSON.stringify(r.lots));
  r = tape().mbuy(10, 1, M, 100n * E18, 0.05).t(20, 2, M, F, 100n * E18).msell(200, 3, F, 100n * E18, 0.05).eval({ linked: [M], followed: [F] });
  check('...its sale of the account’s tokens within 24 hours of their buy adds $0, as the account’s own would', r.spentUsd === 0 && r.lots[0].zeroed && r.lots[0].fate === 'sold');
  r = tape().mbuy(10, 1, F, 500n * E18, 0.25).mbuy(20, 2, M, 100n * E18, 0.05).eval({ linked: [M], followed: [F] });
  check('...and the followed wallet’s OWN buys are never the account’s ($100, not $600)', r.spentUsd === 100 && r.lots.every((l) => l.origin === M));
  r = tape().mbuy(10, 1, F, 500n * E18, 0.25).t(10 + 2 * BPD, 2, F, M, 300n * E18).eval({ linked: [M], followed: [F] });
  check('...until they reach a linked wallet: then traced (300 of its 500, $300), origin the followed wallet, arriving when they reached the linked one', r.spentUsd === 300 && r.lots[0].via === 'traced' && r.lots[0].origin === F && r.needs.includes(F) && r.lots[0].arrivedMs === msOf(10 + 2 * BPD), JSON.stringify(r.lots));
  r = tape().mbuy(11 * BPD, 1, M, 100n * E18, 0.05).t(12 * BPD, 2, M, F, 100n * E18).msell(13 * BPD, 3, F, 60n * E18, 0.03).eval({ linked: [M], followed: [F] }, { diamond: DIAMOND });
  check('...and its sales of the account’s tokens inside the Diamond window are month-out', r.monthOut === tok(60) && r.monthIn === tok(100));
});

section('EIP-7702 and Safe senders', () => {
  const S7702 = W(0x77), SAFE = W(0x5afe);
  const code7702 = '0xef0100' + 'ab'.repeat(20), codeSafe = '0x608060405234801561001057600080fd5b50';
  check('codeKind: a 7702 delegation is a wallet, a Safe is a contract (lib/multichain.js)', codeKind(code7702) === false && codeKind(codeSafe) === true);
  const r = tape().mbuy(100, 1, S7702, 100n * E18, 0.05).mbuy(200, 2, SAFE, 100n * E18, 0.05).t(300, 3, S7702, M, 100n * E18).t(400, 4, SAFE, M, 100n * E18).eval([M]);
  const t = lotsOf(r, (l) => l.via === 'traced');
  check('tokens from an EIP-7702 wallet and from a Safe are both traced to their buys like any wallet (the engine never asks for code)', r.spentUsd === 200 && t.length === 2 && t.some((l) => l.origin === S7702) && t.some((l) => l.origin === SAFE), JSON.stringify(r.lots));
  check('  ...and the evaluation takes no code reader at all', !/getCode|isContract|codeKind/.test(readFileSync(path.join(ROOT, 'lib', 'acquire.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
});

section('budget, hops, unknowns', () => {
  const O1 = W(0x01a), O2 = W(0x02a), O3 = W(0x03a), O0 = W(0x00f);
  const three = () => tape().mbuy(100, 1, O1, 300n * E18, 0.15).t(200, 2, O1, O2, 300n * E18).t(300, 3, O2, O3, 300n * E18).t(400, 4, O3, M, 300n * E18);
  let r = three().eval([M]);
  check('three outside hops back to the buy are traced: $300, origin O1, 3 hops', r.spentUsd === 300 && r.lots[0].origin === O1 && r.lots[0].hops === 3 && r.complete, JSON.stringify(r.lots));
  r = three().eval([M], { budget: 1 });
  check('the tracing budget running out is UNKNOWN (transient), never "not a buy": floor null, not false', r.floor === null && r.unknown.n === 1 && r.unknown.kind === 'transient' && r.why === 'transient' && !r.complete && r.spentUsd === 0, JSON.stringify(r.unknown));
  r = tape().mbuy(50, 9, O0, 300n * E18, 0.15).t(100, 1, O0, O1, 300n * E18).t(200, 2, O1, O2, 300n * E18).t(300, 3, O2, O3, 300n * E18).t(400, 4, O3, M, 300n * E18).eval([M]);
  check('four hops is past MAX_HOPS: deterministic "not a buy" (a complete read, floor false)', r.floor === false && r.complete && /hops/.test(r.lots[0].why), JSON.stringify(r.lots));
  r = three().eval([M], { consistent: false });
  check('a ledger the server marked inconsistent: traced tokens are unknown (structural)', r.floor === null && r.unknown.kind === 'structural' && r.why === 'structural');
  // a sender whose replay goes below zero (tokens left it that the tape never showed arriving)
  r = tape().t(100, 1, O1, M, 300n * E18).eval([M]);
  check('a sender whose balance goes below zero is untraceable: unknown (structural), with the block to value it at', r.floor === null && r.unknown.kind === 'structural' && r.unknown.pieces[0].block === 100, JSON.stringify(r.unknown));
});

section('long histories', () => {
  // 6,000 transfers back and forth between the account's own linked wallet and a wallet Diamond Hands follows, then one on
  // to a second linked wallet: resolved cold, this overflowed Node's stack; evaluate warms the trace in chain order
  const F = W(0xf0), c = tape().mbuy(1, 1, M2, 100n * E18, 0.05);
  for (let k = 0; k < 6000; k++) c.t(10 + k, 10 + k, k % 2 ? F : M2, k % 2 ? M2 : F, 100n * E18);
  let r = c.t(7000, 9999, M2, M, 100n * E18).eval({ linked: [M, M2], followed: [F] });
  check('6,000 transfers between the account\'s own wallets resolve without overflowing: $100, once, held in the last wallet', r.spentUsd === 100 && r.complete && r.lots.length === 1 && r.lots[0].wallet === M, JSON.stringify({ s: r.spentUsd, u: r.unknown.reasons }));
  const d = tape().mbuy(1, 1, M, 100n * E18, 0.05);
  for (let k = 0; k < 500; k++) d.t(10 + k, 10 + k, k % 2 ? Z : M, k % 2 ? M : Z, 100n * E18);
  r = d.eval([M]);
  check('out to an outside wallet and back 250 times: counted once, and no trip out is mistaken for a second count', r.spentUsd === 100 && r.complete && r.unknown.n === 0 && lotsOf(r, (l) => l.counted).length === 1, JSON.stringify(r.unknown));
});

section('a Relay-style fill', () => {
  const SOLVER = W(0x50), RELAY = W(0x52);
  // the solver sends the transaction; the pool pays the Relay router; the router pays the user. The Swap names the router.
  let c = tape().t(10, 1, POOL, RELAY, 100n * E18).t(10, 1, RELAY, M, 100n * E18).buy(10, 1, 100n * E18, ETH(0.05));
  let r = c.eval([M]);
  check('a Relay-style fill credits the wallet the tokens reached, whoever sent the transaction: $100', r.spentUsd === 100 && r.lots[0].via === 'own' && r.lots[0].origin === M);
  check('  ...the solver and the router are credited nothing', c.eval([SOLVER]).spentUsd === 0 && c.eval([RELAY]).spentUsd === 0 && c.eval([RELAY]).lots.length === 0);
  // the router keeps a 25% cut for a fee wallet: a learned fee wallet is out of the denominator
  c = tape().t(10, 1, POOL, RELAY, 100n * E18).t(10, 1, RELAY, FEEW, 25n * E18).t(10, 1, RELAY, M, 75n * E18).buy(10, 1, 100n * E18, ETH(0.05));
  r = c.eval([M], { plumbing: { fees: [FEEW], routers: [RELAY] } });
  check('a learned fee wallet\'s slice takes no share: the user is credited all $100 for its 75 tokens', r.spentUsd === 100 && r.lots[0].tokens === tok(75));
  check('  ...and the fee wallet\'s slice is not its buy', c.eval([FEEW], { plumbing: { fees: [FEEW], routers: [RELAY] } }).spentUsd === 0);
  r = c.eval([M]);
  check('  ...unlearned, the slice is a co-taker: the user gets its 75% share ($75) — fees come from the tape (bundle_plumbing)', r.spentUsd === 75);
  // the router also passes 50 of its own stock: traced to the router, a learned router paying outside a buy
  c = tape().t(5, 9, A.ZERO, RELAY, 50n * E18).t(10, 1, POOL, RELAY, 100n * E18).t(10, 1, RELAY, M, 150n * E18).buy(10, 1, 100n * E18, ETH(0.05));
  r = c.eval([M], { plumbing: { fees: [], routers: [RELAY] } });
  check('  ...a router\'s own stock passed on beside the buy is not bought: credited 100 of 150, $100', r.spentUsd === 100 && lotsOf(r, (l) => l.kind === 'buy')[0].tokens === tok(100) && lotsOf(r, (l) => l.kind === 'notbuy' && /router/.test(l.why)).length === 1, JSON.stringify(r.lots));
});

section('coins without a full tape, v3 pools, other decimals', () => {
  // H8: the member's own transactions' receipts only — own buys classified the same way, a transfer in is unknown
  let r = tape().mbuy(10, 1, M, 100n * E18, 0.05).t(20, 2, O, M, 50n * E18).eval([M], { partial: true });
  check('a coin with no full tape: own buys count ($100), a transfer in is unknown (structural), never "not a buy"', r.spentUsd === 100 && r.floor === true && r.unknown.n === 1 && r.unknown.kind === 'structural' && /no full tape/.test(r.unknown.reasons[0]));
  r = tape().t(20, 2, O, M, 50n * E18).eval([M], { partial: true });
  check('...and with only a transfer in, no refusal: floor null', r.floor === null && r.spentUsd === 0);
  // a v3 Swap as the chain writes it: amount0 +0.05 WETH into the pool, amount1 −100 tokens out of it (two's complement)
  const word = (v) => BigInt.asUintN(256, v).toString(16).padStart(64, '0'), tp = (a) => '0x' + '0'.repeat(24) + a.slice(2);
  const v3 = { address: POOL, topics: [A.V3_SWAP_TOPIC, tp(R), tp(M)], data: '0x' + word(ETH(0.05)) + word(-100n * E18) + word(1n) + word(1n) + word(0n), blockNumber: '0xa', logIndex: '0x5', transactionHash: txh(1) };
  const e = A.normPoolEvent(v3);
  check('a v3 Swap decodes to the same in/out sides as a v2 one (signed amounts, from the pool\'s side)', e.kind === 'swap' && e.a0In === ETH(0.05) && e.a1Out === 100n * E18 && e.a1In === 0n && e.a0Out === 0n);
  r = A.evaluate({ ...tape().t(10, 1, POOL, M, 100n * E18).opts({ poolEvents: [v3] }), memberSet: [M] });
  check('...and a buy through a v3 pool counts like any other: $100', r.spentUsd === 100);
  // a 6-decimal coin: dust is 10^max(0, 6 − 9) = 1 base unit, not 10^9 (which would be a thousand whole tokens)
  const U = 10n ** 6n, base = () => tape().mbuy(100, 1, M, 100n * U, 0.05).msell(100 + 5 * BPD, 2, M, 99n * U, 0.04).msell(100 + 40 * BPD, 3, M, 1n, 0.000001);
  r = base().eval([M], { decimals: 6 });
  check('a 6-decimal coin: one whole token left is not "sold out" (dust is one base unit there, not 10^9)', r.dq.dumped === false, JSON.stringify(r.dq));
  r = base().eval([M]);
  check('...read as an 18-decimal coin it would have been (the reason decimals are passed)', r.dq.dumped === true);
});

section('the shapes lib/tape.js stores', () => {
  // tapeRows → { block, i, tx, from, to, value }; poolRows → { pool, kind: 'Swap'|'Mint'|'Burn', block, i, tx, data }
  const c = tape().t(10, 1, POOL, R, 100n * E18).t(10, 1, R, M, 100n * E18).buy(10, 1, 100n * E18, ETH(0.05)).mbuy(20, 2, M, 50n * E18, 0.025).t(30, 3, M, POOL, 10n * E18).mint(30, 3);
  const wd = (v) => v.toString(16).padStart(64, '0');
  const rows = c.rows.map((r) => ({ block: r.block, i: r.logIndex, tx: r.tx, from: r.from, to: r.to, value: r.value }));
  const evs = c.ev.map((e) => ({ pool: e.pool, kind: e.kind === 'swap' ? 'Swap' : e.kind === 'mint' ? 'Mint' : 'Burn', block: e.block, i: e.logIndex, tx: e.tx, data: e.kind === 'swap' ? '0x' + wd(e.a0In) + wd(e.a1In) + wd(e.a0Out) + wd(e.a1Out) : '0x' + wd(1n) + wd(1n) }));
  const a = c.eval([M]), b = A.evaluate(c.opts({ tapeRows: rows, poolEvents: evs, memberSet: [M] }));
  check('rows as lib/tape.js returns them (log index `i`, stored Swap words, capitalised kinds) give the same answer', JSON.stringify(a) === JSON.stringify(b) && a.spentUsd === 140 && b.lots.some((l) => l.fate === 'minted' && l.zeroed), JSON.stringify([a.spentUsd, b.spentUsd]));   // $150 bought; the 10 deposited 20 minutes after their buy add $0
  let threw = false; try { A.evaluate(c.opts({ tapeRows: rows, poolEvents: [{ ...evs[0], data: '0x' + wd(1n) }], memberSet: [M] })); } catch { threw = true; }
  check('...and a stored Swap it cannot read throws, never a silent zero', threw);
});

/* The abuse critic's "attacks the spec already stops" — kept as regressions, so a later change cannot reopen them. */
section('already stopped (regressions)', () => {
  let r = tape().t(10, 1, A.ZERO, M, 1000n * E18).eval([M]);
  check('[stopped] an airdrop / mint from 0x0 is not a buy', r.spentUsd === 0 && r.floor === false && /minted/.test(r.lots[0].why));
  r = tape().t(10, 1, TOKEN, M, 1000n * E18).eval([M]);
  check('[stopped] tokens from the token contract itself are not a buy', r.spentUsd === 0 && /token contract/.test(r.lots[0].why));
  r = tape().t(5, 9, A.ZERO, C, 1000000n * E18).t(10, 1, POOL, C, 1n * E18).t(10, 1, C, M, 1000001n * E18).buy(10, 1, 1n * E18, ETH(0.0005)).eval([M]);
  check('[stopped] a contract that buys $1 and forwards a million from its own stock is credited $1', r.spentUsd === 1 && lotsOf(r, (l) => l.kind === 'buy')[0].tokens === tok(1));
  r = tape().mbuy(10, 1, M, 100n * E18, 0.05).t(10 + 2 * BPD, 2, M, POOL, 100n * E18).t(10 + 2 * BPD, 2, POOL, M, 95n * E18).buy(10 + 2 * BPD, 2, 95n * E18, 0n).sell(10 + 2 * BPD, 2, 100n * E18, 0n).eval([M]);
  check('[stopped] donate + swap + skim nets no buy: still $100 from the one real buy', r.spentUsd === 100 && lotsOf(r, (l) => l.kind === 'buy').length === 1, JSON.stringify(r.lots));
  r = tape().mbuy(10, 1, M, 100n * E18, 0.05).t(500, 2, M, M, 100n * E18).eval([M]);
  check('[stopped] a wallet paying itself is neither a buy nor a sale', r.spentUsd === 100 && r.tokens.sold === '0' && r.heldWei === tok(100));
  r = tape().mbuy(10, 1, M, 100n * E18, 0.075).t(500, 2, M, M2, 100n * E18).eval([M, M2]);
  check('[stopped] a move between the account\'s own wallets adds nothing: $150 once, held in the second wallet', r.spentUsd === 150 && r.lots.length === 1 && r.lots[0].wallet === M2);
  r = tape().t(10, 1, POOL, R, 100n * E18).t(10, 1, R, M, 60n * E18).t(10, 1, R, M, 40n * E18).buy(10, 1, 100n * E18, ETH(0.05)).eval([M]);
  check('[stopped] one buy delivered in two transfers is one credit: $100, once', r.spentUsd === 100 && lotsOf(r, (l) => l.kind === 'buy').length === 1 && lotsOf(r, (l) => l.kind === 'buy')[0].tokens === tok(100));
  const HUB = W(0x4b), c = tape();
  for (let k = 0; k < 10; k++) c.mbuy(10 + k, 100 + k, W(0x900 + k), 10n * E18, 0.005).t(50 + k, 200 + k, W(0x900 + k), HUB, 10n * E18);
  r = c.t(100, 300, HUB, M, 5n * E18).eval([M]);
  check('[stopped] a bag from a hub (sent the coin by 10 wallets: an exchange-like address) is not a buy', r.spentUsd === 0 && r.complete && /hub/.test(r.lots[0].why), JSON.stringify(r.lots));
  r = tape().mbuy(10, 1, M, 100n * E18, 0.05).eval([M], { claims: () => 'other' });
  check('[stopped] a wallet whose buys already backed another account (unlink / relink to clone a badge): conflict, $0', r.spentUsd === 0 && r.conflicts[0] === M && r.lots[0].conflict && r.floor === false && r.needs.length === 0);
  r = tape().mbuy(10, 1, M, 100n * E18, 0.05).eval([M], { coverage: () => false });
  check('[stopped] a pool payout whose pool events are not read yet is unknown (transient) — never read as "not a buy"', r.floor === null && r.unknown.kind === 'transient' && r.spentUsd === 0);
  r = tape().mbuy(10, 1, M, 100n * E18, 0.05).eval([M], { ethUsdAt: () => null });
  check('[stopped] a buy whose ETH/USD is not read is unknown, never $0: floor null, tokens still counted as acquired', r.floor === null && r.spentUsd === 0 && r.tokens.acquired === tok(100) && r.lots[0].usd === null);
  r = tape().mbuy(10, 1, M, 100n * E18, 0.05).eval([M], { blockTimes: () => null });
  check('[stopped] a buy whose block time is not stored is unknown (never log.blockTimestamp, which is 0x0)', r.floor === null && r.unknown.reasons.some((x) => /block time/.test(x)));
  /* One index serves many members, and the order they are evaluated in never changes an answer: the same members on two
     FRESH indexes, in opposite orders (each one's caches — settlements, replays, hub thresholds — filled by whoever came
     first), and each member alone on a third. A tape where every member's answer reads the others' wallets: M's own buy
     partly sent to Z, O's buy passed through X to both Z and M, and X asked about too. */
  const X2 = W(0x0c), opt = tape().mbuy(10, 1, M, 100n * E18, 0.05).t(20, 2, M, Z, 40n * E18).mbuy(30, 3, O, 200n * E18, 0.1).t(40, 4, O, X2, 200n * E18).t(50, 5, X2, Z, 150n * E18).t(60, 6, X2, M, 50n * E18).opts({});
  const members = [[M], [Z], [X2], [M, Z]];
  const run = (order, idx) => { const out = new Map(); for (const k of order) out.set(k, JSON.stringify(A.evaluate({ ...opt, index: idx, memberSet: members[k] }))); return out; };
  const fwd = run([0, 1, 2, 3], A.buildIndex(opt)), back = run([3, 2, 1, 0], A.buildIndex(opt));
  const alone = members.map((_, k) => run([k], A.buildIndex(opt)).get(k));
  const same = members.every((_, k) => fwd.get(k) === back.get(k) && fwd.get(k) === alone[k]);
  const m = JSON.parse(fwd.get(0)), z = JSON.parse(fwd.get(1));
  check('[stopped] one index serves many members, and order never changes an answer (two fresh indexes in opposite orders, and each member alone, agree)', same && m.spentUsd === 110 && z.spentUsd === 190 && z.needs.includes(M) && z.needs.includes(O), JSON.stringify([m.spentUsd, z.spentUsd, z.needs]));
});

/* The WP2 review (2026-11-17): each of these failed on the engine as it stood, and each names the probe it came from. */
section('review: arrival times the tape does not store', () => {
  // lib/tape.js stores the times of Swap blocks; a plain transfer's block has none until the engine asks for it (needBlocks)
  const c = tape().mbuy(100, 1, O, 300n * E18, 0.15).mbuy(150, 2, M, 300n * E18, 0.15).t(200 * BPD - 30, 3, O, M, 300n * E18);
  const swapTimes = new Map(c.ev.map((e) => [e.block, msOf(e.block)]));
  let r = c.eval([M], { blockTimes: swapTimes });
  check('a bag transferred in 30 minutes ago into a block with no stored time: the latest arrival is null (transient, its block in needBlocks) — never the old own buy\'s, which skipped the first-day watch',
    r.lastArrivedMs === null && r.lastArrivedBlock === 200 * BPD - 30 && r.needBlocks.includes(200 * BPD - 30) && /latest arrival/.test(r.lastArrivedWhy) && !r.complete && r.why === 'transient' && r.floor === true, JSON.stringify({ l: r.lastArrivedMs, n: r.needBlocks, c: r.complete }));
  r = c.eval([M], { blockTimes: new Map([...swapTimes, [200 * BPD - 30, msOf(200 * BPD - 30)]]) });
  check('  ...given that one block\'s time: the latest arrival is 30 minutes ago, and the answer is complete', r.lastArrivedMs === msOf(200 * BPD - 30) && r.complete && r.needBlocks.length === 0, JSON.stringify({ l: r.lastArrivedMs, n: r.needBlocks }));
  // a traced-only account that dumped inside its first 30 days, its arrival in a plain transfer block
  const d = tape().mbuy(10, 1, O, 300n * E18, 0.15).t(3 * BPD, 2, O, M, 300n * E18).t(5 * BPD, 3, M, Z, 300n * E18 - 1n);
  r = d.eval([M], { blockTimes: new Map(d.ev.map((e) => [e.block, msOf(e.block)])) });
  check('a traced-only account that dumped, its arrival block\'s time not stored: the disqualifier is null with why (and the block asked for), never a definite "not dumped"',
    r.dq.disqualified === null && r.dq.dumped === null && /not stored/.test(r.dq.why) && r.needBlocks.includes(3 * BPD) && !r.complete, JSON.stringify(r.dq));
  r = d.eval([M]);
  check('  ...with every time: dumped inside 30 days', r.dq.dumped === true && r.dq.anchorBlock === 3 * BPD && r.dq.anchorMs === msOf(3 * BPD), JSON.stringify(r.dq));
});

section('review: the Diamond month', () => {
  // probe p5: bought 100 on day 11, sold all 100 on day 13 — the pool's events for the sale not read
  const c = tape().mbuy(11 * BPD, 1, M, 100n * E18, 0.05).msell(13 * BPD, 2, M, 100n * E18, 0.05).mbuy(60 * BPD, 3, M, 200n * E18, 0.1);
  let r = c.eval([M]);
  check('bought 100 and sold 100 inside the window, all read: no Diamond month', r.diamondMonth === false && r.monthOut === tok(100));
  r = c.eval([M], { coverage: (b) => b !== 13 * BPD });
  check('...the same sale with its pool events unread: no answer yet (null), never a yes — an unread sale can only add to month-out', r.diamondMonth === null && r.monthOut === '0' && !r.complete && r.why === 'transient', JSON.stringify({ d: r.diamondMonth, o: r.monthOut }));
  // probe p1 A: in 100, out 500 — then 1,000 bought an hour before the window closed, sold 11 hours later (after it): a round trip
  const base = () => tape().mbuy(5 * BPD, 1, M, 500n * E18, 0.25).mbuy(11 * BPD, 2, M, 100n * E18, 0.05).msell(20 * BPD, 3, M, 500n * E18, 0.25);
  const wash = base().mbuy(40 * BPD - 60, 4, M, 1000n * E18, 0.5).msell(40 * BPD + 600, 5, M, 1100n * E18, 0.55).eval([M]);
  check('a month-end round trip (zeroed by the 24-hour rule) is not month-in: in stays 100 against 500 out, no Diamond month',
    base().eval([M]).diamondMonth === false && wash.monthIn === tok(100) && wash.monthOut === tok(500) && wash.diamondMonth === false && lotsOf(wash, (l) => l.zeroed && l.tokens === tok(1000)).length === 1, JSON.stringify({ i: wash.monthIn, d: wash.diamondMonth }));
  // a window still open: a buy two hours old is pending, so not month-in yet
  r = tape().mbuy(200 * BPD - 120, 1, M, 100n * E18, 0.05).eval([M], { diamond: { from: msOf(190 * BPD), until: msOf(210 * BPD) } });
  check('  ...nor is a buy still pending (bought two hours ago, inside a window still open)', r.monthIn === '0' && r.diamondMonth === false, r.monthIn);
});

section('review: every way out within 24 hours', () => {
  const ROUTER = W(0x89e5), sys = [W(0x0b0b), ROUTER];
  // probe p1 B: the v2 router (a system address) pays its whole token balance to whoever removes a little liquidity
  let r = tape().mbuy(10, 1, M, 100n * E18, 0.05).t(20, 2, M, ROUTER, 100n * E18).t(30, 3, ROUTER, M2, 100n * E18).msell(40, 4, M2, 100n * E18, 0.05).eval([M, M2], { sys, nowMs: msOf(50) });
  const b = lotsOf(r, (l) => l.kind === 'buy')[0];
  check('bought, sent to the v2 router 10 minutes later, swept to another wallet and sold: $0 — the 24-hour rule covers every way out, not only the pool', r.spentUsd === 0 && b.fate === 'system' && b.zeroed && !b.counted, JSON.stringify(r.lots));
  r = tape().mbuy(10, 1, M, 100n * E18, 0.05).t(20, 2, M, A.DEAD, 100n * E18).eval([M], { nowMs: msOf(50) });
  check('...a burn 10 minutes after the buy adds $0 too', r.spentUsd === 0 && r.lots[0].fate === 'burned' && r.lots[0].zeroed);
  r = tape().mbuy(10, 1, M, 100n * E18, 0.05).t(10 + BPD + 60, 2, M, A.DEAD, 100n * E18).eval([M]);
  check('...a burn after 24 hours held keeps its $100 (once held 24 hours a buy counts forever)', r.spentUsd === 100 && r.lots[0].fate === 'burned' && r.lots[0].counted);
  // probe p8: a taxed sale is two logs — seller → token contract (the tax) and seller → pool — in either order
  for (const order of ['tax log first', 'sale log first']) {
    const c = tape().mbuy(10, 1, M, 100n * E18, 0.05);
    if (order === 'tax log first') c.t(70, 2, M, TOKEN, 1n * E18).t(70, 2, M, POOL, 99n * E18); else c.t(70, 2, M, POOL, 99n * E18).t(70, 2, M, TOKEN, 1n * E18);
    r = c.sell(70, 2, 99n * E18, ETH(0.049)).eval([M]);
    const tax = lotsOf(r, (l) => l.fate === 'saletax');
    check('a taxed sale an hour after the buy (' + order + '): $0 — the tax leg is read as the sale\'s (\'saletax\'), inside 24 hours like the rest', r.spentUsd === 0 && tax.length === 1 && tax[0].tokens === tok(1) && tax[0].zeroed, JSON.stringify(r.lots.map((l) => [l.fate, l.tokens, l.zeroed])));
  }
});

section('review: dates, claims and hubs', () => {
  // probe p2 D: O (early) $99 and O2 $2 reach M through X in one transfer; M's own first buy is on day 60
  const O2 = W(0x0b), X = W(0x0c);
  const c = () => tape().mbuy(100, 1, O, 990n * E18, 0.495).mbuy(110, 2, O2, 2n * E18, 0.001).t(200, 3, O, X, 99n * E18).t(210, 4, O2, X, 2n * E18).t(300, 5, X, M, 101n * E18).mbuy(60 * BPD, 6, M, 200n * E18, 0.1);
  let r = c().eval([M]);
  check('a traced date made of two origins ($99 + a $2 sliver): BOTH are needed (claimed with the verdict), not only the one that crossed $100',
    r.tierDateMs === msOf(110) && r.tierBasis.origins.length === 2 && r.needs.includes(O) && r.needs.includes(O2), JSON.stringify({ b: r.tierBasis, n: r.needs }));
  r = c().eval([M], { claims: (o) => (o === O ? 'other' : o === M ? 'mine' : 'free') });
  check('  ...so once the early wallet backs another account, the sliver alone dates nothing here: the member\'s own day-60 buy does', r.tierDateMs === msOf(60 * BPD) && r.tierBasis.via === 'own' && r.conflicts.includes(O));
  // probe p7: ten wallets send the sender 1 wei each, a month AFTER it passed its bag on
  const h = tape().mbuy(10, 1, O, 300n * E18, 0.15).t(100, 2, O, M, 300n * E18);
  const before = h.eval([M]);
  for (let k = 0; k < 10; k++) h.t(30 * BPD, 1000 + k, A.ZERO, W(0x7000 + k), 1n).t(30 * BPD + 1 + k, 2000 + k, W(0x7000 + k), O, 1n);
  r = h.eval([M]);
  check('ten wallets sending the sender 1 wei a month after it passed the bag on change nothing: still $300 traced — the hub test reads its history up to the transfer',
    before.spentUsd === 300 && r.spentUsd === 300 && r.floor === true && r.complete && r.lots[0].via === 'traced', JSON.stringify(r.lots.map((l) => l.why)));
  const later = tape().mbuy(10, 1, O, 300n * E18, 0.15).t(100, 2, O, M, 300n * E18);
  for (let k = 0; k < 10; k++) later.mbuy(30 * BPD + k, 3000 + k, W(0x8000 + k), 1n * E18, 0.0005).t(31 * BPD + k, 4000 + k, W(0x8000 + k), O, 1n * E18);
  r = later.eval([M]);
  check('  ...nor do ten real senders after it (the sender turned exchange-like later): a bag it passed on before that stays traced, $300', r.spentUsd === 300 && r.lots[0].via === 'traced' && r.complete, JSON.stringify(r.lots.map((l) => l.why)));
  const g = tape().mbuy(10, 1, O, 300n * E18, 0.15);
  for (let k = 0; k < 10; k++) g.t(20, 1000 + k, A.ZERO, W(0x7000 + k), 1n).t(30 + k, 2000 + k, W(0x7000 + k), O, 1n);
  r = g.t(100, 2, O, M, 300n * E18).eval([M]);
  check('  ...and ten dust senders BEFORE the transfer make no hub either (a sender counts once it sent more than dust)', r.spentUsd === 300 && r.lots[0].via === 'traced');
});

section('review: what the caller leaves out', () => {
  // probe p4: the pool stream lags the transfer stream, and no coverage is passed
  const d = tape().mbuy(10, 1, M, 100n * E18, 0.05).mbuy(20, 2, M, 100n * E18, 0.05);
  let r = A.evaluate(d.opts({ poolEvents: d.ev.filter((e) => e.block < 20), memberSet: [M] }));
  check('the pool\'s events read only up to block 10, the tape to block 20, no coverage passed: the second buy is unknown (transient), never "not a buy"',
    r.spentUsd === 100 && r.unknown.n === 1 && r.unknown.kind === 'transient' && !r.complete && !lotsOf(r, (l) => l.kind === 'notbuy').length, JSON.stringify(r.lots.map((l) => l.why)));
  r = A.evaluate(tape().mbuy(10, 1, M, 100n * E18, 0.05).opts({ poolEvents: [], memberSet: [M] }));
  check('  ...and a $100 buy with none of its pool\'s events passed: floor null, not false', r.floor === null && r.spentUsd === 0 && r.unknown.kind === 'transient');
  // probe p4: a USDG pool passed without quoteDecimals ($150 of USDG, 6 decimals, into the pool)
  const u = tape().t(10, 1, POOL, M, 100n * E18).buy(10, 1, 100n * E18, 150n * 10n ** 6n);
  r = A.evaluate(u.opts({ memberSet: [M], pools: { [POOL]: { tokenIsZero: false, quote: 'USDG' } } }));
  check('a USDG pool passed without quoteDecimals is read with USDG\'s 6: $150 — never a made-up $0 from a blanket 18', r.spentUsd === 150 && r.floor === true && r.unknown.n === 0, r.spentUsd);
  let threw = false; try { A.buildIndex(u.opts({ pools: { [POOL]: { tokenIsZero: false, quote: 'USDG', quoteDecimals: 18 } } })); } catch { threw = true; }
  check('  ...and a quoteDecimals that contradicts the quote (USDG with 18) throws', threw);
  r = A.evaluate(u.opts({ memberSet: [M], pools: { [POOL]: { tokenIsZero: false, quote: 'usdg', quoteDecimals: 6 } } }));
  check('  ...the quote\'s name in any case, with its own decimals passed: $150', r.spentUsd === 150);
});

section('review: unknown pieces say what they could still change', () => {
  const unpriced = { ethUsdAt: (b) => (b === 20 ? null : PX) };
  // probe p6: $1,000 known and an unpriced buy; everything but a few tokens sold after three days
  let r = tape().mbuy(10, 1, M, 1000n * E18, 0.5).mbuy(20, 2, M, 100n * E18, 0.05).msell(10 + 3 * BPD, 3, M, 1100n * E18, 0.5).eval([M], unpriced);
  const p = r.unknown.pieces[0];
  check('an unknown that was SOLD can never close a held gap: $1,000 spent, $0 held, the unpriced buy all sold → floor false, not null',
    r.floor === false && r.unknown.n === 1 && p.fate === 'sold' && p.held === false && p.couldHold === false && p.block === 20 && p.quoteAmt === ETH(0.05).toString() && p.quote === 'WETH', JSON.stringify(r.unknown));
  r = tape().mbuy(10, 1, M, 1000n * E18, 0.5).mbuy(20, 2, M, 100n * E18, 0.05).msell(10 + 3 * BPD, 3, M, 1098n * E18, 0.5).eval([M], unpriced);
  const held = r.unknown.pieces.filter((x) => x.held);
  check('  ...2 of its tokens still held: null (they might), and the pieces say which tokens are held and what they cost in WETH — so only those are valued',
    r.floor === null && held.length === 1 && held[0].tokens === tok(2) && held[0].quoteAmt === ETH(0.001).toString() && r.unknown.pieces.some((x) => x.fate === 'sold' && x.tokens === tok(98)), JSON.stringify(r.unknown.pieces));
  // a traced piece whose ORIGIN buy's pool events are not read: where it could be valued is the buy, not the transfer
  r = tape().mbuy(10, 1, O, 100n * E18, 0.05).t(500, 2, O, M, 100n * E18).eval([M], { coverage: (b) => b !== 10 });
  check('  ...a traced piece unknown at its origin names the buy\'s block (valuable at its execution price) and the block it arrived in',
    r.unknown.pieces[0].block === 10 && r.unknown.pieces[0].arrivedBlock === 500 && r.unknown.pieces[0].held === true && r.floor === null, JSON.stringify(r.unknown.pieces));
  // a linked wallet whose replay goes below zero, the short tokens all sent out: a flag on the tape, not a piece that nulls the floor
  r = tape().mbuy(10, 1, M, 100n * E18, 0.025).t(20 + 2 * BPD, 2, M, Z, 150n * E18).eval([M]);
  check('  ...a linked wallet\'s tape going below zero (what left short went out): incomplete (structural), but a definite floor — no unknown token could count',
    r.floor === false && r.unknown.n === 0 && !r.complete && r.why === 'structural' && r.unknown.reasons.some((x) => /linked wallet/.test(x)), JSON.stringify({ f: r.floor, u: r.unknown }));
});

section('review: lib/ethusd.js\'s no-price answers', () => {
  const E = require(path.join(ROOT, 'lib', 'ethusd.js'));
  // a grid read from the pair's creation (origin) to block 60,000, with one Sync at block 50,000: $2,000 an ETH
  const word = (v) => v.toString(16).padStart(64, '0');
  const cells = new Map();
  E.foldCells(cells, [{ address: E.PAIR.address, topics: [E.SYNC_TOPIC], data: '0x' + word(100n * E18) + word(200000n * 10n ** 6n), blockNumber: '0xc350', logIndex: '0x0', transactionHash: txh(9) }]);
  const grid = E.buildGrid(cells, { from: 0, to: 60000, origin: true }), at = (b) => E.ethUsdAt(grid, b);
  check('ethusd.js: before the pool\'s first Sync is a structural null, past what was read a transient one, inside the read $2,000', at(10).v === null && at(10).kind === 'structural' && at(70000).kind === 'transient' && at(55000).v === 2000, JSON.stringify([at(10), at(70000)]));
  const run = (b, ethUsdAt) => tape().mbuy(b, 1, M, 100n * E18, 0.05).eval([M], { ethUsdAt });
  const before = run(10, at), past = run(70000, at), inside = run(55000, at);
  check('the engine keeps that kind: a buy before the first Sync is a STRUCTURAL unknown (re-asked when the tape moves), one past the read TRANSIENT (retried), one inside $100',
    before.unknown.kind === 'structural' && before.why === 'structural' && past.unknown.kind === 'transient' && past.why === 'transient' && inside.spentUsd === 100, JSON.stringify([before.unknown.kind, past.unknown.kind, inside.spentUsd]));
  const coded = run(10, () => ({ v: null, why: 'drained', code: 'drained' }));
  check('  ...and a reader that gives ethusd.js\'s code but no kind is classed by the code (drained: structural)', coded.unknown.kind === 'structural');
});

/* ═══ 2. real chain data ═══ */
const hexBig = (h) => BigInt(h);
section('a real window of the $SEND tape', () => {
  const F = FIX('send-window.json');
  const rows = F.transfers.map(([block, li, tx, from, to, v]) => ({ block, logIndex: li, tx, from, to, value: hexBig(v) }));
  const evs = F.swaps.map(([block, li, tx, , , a0In, a1In, a0Out, a1Out]) => ({ pool: F.pool, kind: 'swap', block, logIndex: li, tx, a0In: hexBig(a0In), a1In: hexBig(a1In), a0Out: hexBig(a0Out), a1Out: hexBig(a1Out) }));
  const idx = A.buildIndex({ token: F.token, tapeRows: rows, poolEvents: evs, pools: { [F.pool]: { tokenIsZero: F.tokenIsZero, quote: F.quote, quoteDecimals: 18 } }, sys: ['0x89e5db8b5aa49aa85ac63f691524311aeb649eba', '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f', '0x0bd7d308f8e1639fab988df18a8011f41eacad73'] });
  // the same window with no fee wallet known: what the fee rule changes is measured against it below
  const bare = A.buildIndex({ token: F.token, tapeRows: rows, poolEvents: evs, pools: { [F.pool]: { tokenIsZero: F.tokenIsZero, quote: F.quote, quoteDecimals: 18 } }, sys: ['0x89e5db8b5aa49aa85ac63f691524311aeb649eba', '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f', '0x0bd7d308f8e1639fab988df18a8011f41eacad73'], plumbing: { fees: [], routers: [] } });
  let bad = 0, buys = 0, over = 0, taxed = 0, taxedFull = 0, feeSide = 0, feeFull = 0, feeBare = 0;
  for (let i = 0; i < idx.txs.length; i++) {
    if (A._internal.settleAt(idx, i).bad) bad++;
    const f = A._internal.flowsAt(idx, i).get(F.pool);
    if (!f || !f.buy) continue;
    buys++;
    let q = 0n, t = 0n; for (const x of f.credits.values()) { q += x.costQ; t += x.tokens; }
    if (q > f.netQ || t > f.netTok) over++;
    const paidTax = idx.txs[i].logs.some((l) => l.from === F.pool && l.to === F.token);
    if (!paidTax) continue;
    // a taxed buy: the token contract's tax leg takes no share, and the credits share out ALL of the quote (to BigInt rounding)
    taxed++;
    if (!f.credits.has(F.token) && q <= f.netQ && f.netQ - q < BigInt(f.credits.size)) taxedFull++;
    // ...and where a learned fee wallet took a slice beside the buyer, the fee wallet is out of the denominator: the buyer is
    // credited every wei of the quote, the fee wallet none — where, with no fee wallet known, it would have taken a share
    const raw = A._internal.settleAt(idx, i).takers.get(F.pool);
    const fee = raw && raw.size > 1 ? [...raw.keys()].find((a) => idx.plumbing.fees.has(a)) : null;
    if (!fee) continue;
    feeSide++;
    if (!f.credits.has(fee) && f.notBuy.has(fee) && f.credits.size === raw.size - 1 && q === f.netQ) feeFull++;
    const fb = A._internal.flowsAt(bare, i).get(F.pool);
    if (fb && fb.credits.has(fee) && fb.credits.get(fee).costQ > 0n) feeBare++;
  }
  check('every one of the window\'s ' + idx.txs.length + ' transactions settles exactly as bundles.js decomposeTx does (takers, transfers, pool-ward)', bad === 0 && idx.txs.length > 250, bad + ' mismatched');
  check('every one of its ' + buys + ' buys shares out at most what its swaps took in (shares ≤ 1, credits ≤ the bought tokens)', buys > 50 && over === 0, over);
  check('every taxed buy (' + taxed + ' of them) credits all of its quote to its buyers, none to the token contract\'s tax leg — 100%, not 99%', taxed > 100 && taxedFull === taxed, taxedFull + '/' + taxed);
  check('every taxed buy a learned fee wallet took a slice of (' + feeSide + '): the buyer is credited all of the quote and the fee wallet none — ' + feeBare + ' of them would have shared it with the fee wallet had it not been learned',
    feeSide > 20 && feeFull === feeSide && feeBare === feeSide, feeFull + '/' + feeSide + ', bare ' + feeBare);
  const pl = A.learnPlumbing(idx);
  check('bundles.js\'s own rules learn this window\'s routers from the tape (the fallback when the server passes none)', pl.routers.size >= 1, [...pl.routers].join(','));
});

section('the taxed buy receipt 0x3de70b…', () => {
  const F = FIX('taxed-buy.json');
  const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', PAIR = '0xf30bb531d0255969be155533abac34b22bd63414';
  const raw = F.logs.map(([address, blockNumber, logIndex, transactionHash, topics, data]) => ({ address, blockNumber: '0x' + blockNumber.toString(16), logIndex: '0x' + logIndex.toString(16), transactionHash, topics, data }));
  const opts = { token: SEND, tapeRows: raw.filter((l) => l.address === SEND), poolEvents: raw.filter((l) => l.address === PAIR), pools: { [PAIR]: { tokenIsZero: false, quote: 'WETH', quoteDecimals: 18 } }, sys: ['0x89e5db8b5aa49aa85ac63f691524311aeb649eba', '0x0bd7d308f8e1639fab988df18a8011f41eacad73'], plumbing: { fees: [], routers: [] } };
  const idx = A.buildIndex(opts);
  const f = A._internal.flowsAt(idx, 0).get(PAIR);
  const swap = raw.find((l) => l.address === PAIR && l.topics[0] === BUN.SWAP_TOPIC), qIn = BigInt('0x' + swap.data.slice(2, 66));
  const c = f.credits.get(F.sentBy);
  check('the real taxed buy (the pool paid the $SEND contract 3,944.48 and the buyer 390,503.50): the buyer is credited 100% of its WETH', c && c.costQ === qIn && f.credits.size === 1 && c.tokens === BigInt(raw.find((l) => l.address === SEND && l.topics[2].endsWith(F.sentBy.slice(2))).data), c && c.costQ + ' of ' + qIn);
  const px = ethUsdFrom(F.syncs)(F.block);
  const r = A.evaluate({ ...opts, index: idx, memberSet: [F.sentBy], blockTimes: new Map(), ethUsdAt: () => px, nowMs: Date.UTC(2026, 10, 17) });
  check('  ...and with no block time stored for it, the buy is unknown — the engine never borrows the log\'s blockTimestamp (0x0)', r.floor === null && r.unknown.reasons.some((x) => /block time/.test(x)) && raw[0] && true);
  const r2 = A.evaluate({ ...opts, index: idx, memberSet: [F.sentBy], blockTimes: new Map([[F.block, Date.UTC(2026, 10, 15)]]), ethUsdAt: () => px, nowMs: Date.UTC(2026, 10, 17) });
  const want = Math.round(Number(qIn * 1000000n / 10n ** 18n) / 1e6 * px * 100) / 100;
  check('  ...given its block time: spent = its whole WETH × ETH/USD at its block from the WETH/USDG pair ($' + r2.spentUsd + ')', r2.spentUsd === want && px > 0, r2.spentUsd + ' vs ' + want);
});

/* ETH/USD for the fixtures, from the WETH/USDG pair's own Syncs (token0 WETH, 18 decimals; token1 USDG, 6): per 10,000-block
   cell, one price per block (its last Sync), opened by the previous cell's last price, block-weighted median — the rule
   lib/ethusd.js implements for the server (decisions H9). A stand-in here so this suite reads measured prices without
   depending on that package; it returns null where the fixture holds no Sync for the cell. */
function ethUsdFrom(syncs) {
  const last = new Map();
  for (const [b, li, , r0, r1] of syncs) { const p = Number(BigInt(r1) * 10n ** 18n / BigInt(r0)) / 1e6; const x = last.get(b); if (!x || li > x[0]) last.set(b, [li, p]); }
  const blocks = [...last.keys()].sort((a, b) => a - b);
  return (block) => {
    const cell = Math.floor(block / 10000) * 10000, end = cell + 9999;
    const pts = [];
    const before = blocks.filter((b) => b < cell);
    if (before.length && Math.floor(before[before.length - 1] / 10000) * 10000 === cell - 10000) pts.push([cell, last.get(before[before.length - 1])[1]]);
    for (const b of blocks) if (b >= cell && b <= end) pts.push([b, last.get(b)[1]]);
    if (!pts.some(([b]) => b > cell) && !pts.length) return null;
    if (!pts.length) return null;
    const w = pts.map(([b, p], k) => [p, (k + 1 < pts.length ? pts[k + 1][0] : end + 1) - b]).filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]);
    const tot = w.reduce((s, [, n]) => s + n, 0); let acc = 0;
    for (const [p, n] of w) { acc += n; if (acc * 2 >= tot) return p; }
    return null;
  };
}

/* ═══ 3. the acceptance case: case-a ═══ */
const CASE_A = path.join(ROOT, 'tests', 'fixtures', 'private', 'acquire-case-a.json');
if (!existsSync(CASE_A)) console.log('NOTE case-a is not run here: its fixture is one member\'s real wallet moves, kept off the public repo (tests/fixtures/private/acquire-case-a.json)');
else section('case-a: Diamond-eligible', () => {
  const F = JSON.parse(readFileSync(CASE_A, 'utf8'));
  const [WA, WB] = F.wallets;
  /* Block numbers: the fixture's source (the server's saved wallet histories) keeps each move's transaction and the block time
     it persisted, not its block. A transaction whose pool Swap was read has its real block; the others get ORDERING-ONLY
     placeholders (between the real blocks around them, by their persisted time) — the engine reads a block only to order
     transactions and to look its time up, and no buy is valued at a placeholder (each one's pool events were not read, so
     it is unknown). Log indexes likewise follow the source's order within a transaction. */
  const txs = new Map();
  for (const [t, tx, from, to, wei, ts, block] of F.moves) { let x = txs.get(tx); if (!x) txs.set(tx, x = { t, tx, ts, block, rows: [] }); x.rows.push({ from, to, value: BigInt(wei) }); }
  const ordered = [...txs.values()].sort((a, b) => a.ts - b.ts);
  const measured = ordered.filter((x) => x.block != null);
  let last = Math.min(...measured.map((x) => x.block)) - 1000, inOrder = true;
  for (const x of ordered) { if (x.block != null) { if (x.block <= last) inOrder = false; last = x.block; } else x.block = ++last; }
  check('case-a: the persisted block times and the measured blocks agree on the order of every transaction', inOrder);
  const times = new Map(ordered.map((x) => [x.block, x.ts]));
  const swaps = F.swaps.map(([pool, block, li, tx, , , a0In, a1In, a0Out, a1Out]) => ({ pool, kind: 'swap', block, logIndex: li, tx, a0In: BigInt(a0In), a1In: BigInt(a1In), a0Out: BigInt(a0Out), a1Out: BigInt(a1Out) }));
  const swapTx = new Set(swaps.map((s) => s.tx));
  const ethUsd = ethUsdFrom(F.syncs);
  const nowMs = Date.UTC(2026, 10, 17);
  const out = {};
  for (const [coin, m] of Object.entries(F.tokens)) {
    const rows = [];
    for (const x of ordered) if (x.t === coin) x.rows.forEach((r, k) => rows.push({ block: x.block, logIndex: k, tx: x.tx, ...r }));
    const opts = {
      token: m.token, tapeRows: rows, poolEvents: swaps.filter((s) => s.pool === m.pool), pools: { [m.pool]: { tokenIsZero: m.tokenIsZero, quote: m.quote, quoteDecimals: 18 } },
      sys: ['0x89e5db8b5aa49aa85ac63f691524311aeb649eba', '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f', '0x0bd7d308f8e1639fab988df18a8011f41eacad73'],
      plumbing: { fees: [], routers: [] },
      coverage: (b, tx) => swapTx.has(tx),   // the pools' events were read for these transactions only (README)
      blockTimes: times, ethUsdAt: (b) => ethUsd(b), nowMs, diamond: F.diamond, memberSet: [WA, WB],
    };
    out[coin] = { r: A.evaluate(opts), opts, m };
  }
  const BETA_END_MS = F.tokens.GWC.launchMs + 90 * 864e5;   // server.js OG_TIER_CLOSE[GOLD] by default: the beta's end
  const gold = (x) => x.r.tierDateMs != null && x.r.tierDateMs >= x.m.launchMs && x.r.tierDateMs <= BETA_END_MS;
  for (const coin of ['SEND', 'GWC']) {
    const { r } = out[coin];
    const firstOwn = r.lots.filter((l) => l.via === 'own' && l.counted).sort((a, b) => a.originMs - b.originMs)[0];
    check('case-a $' + coin + ': $' + r.spentUsd + ' spent on counted buys (≥ $100), $' + r.heldCostUsd + ' of it still held at cost (≥ $10): the floor clears', r.spentUsd >= 100 && r.heldCostUsd >= 10 && r.floor === true, JSON.stringify({ s: r.spentUsd, h: r.heldCostUsd, f: r.floor, u: r.unknown }));
    check('case-a $' + coin + ': bought inside $GWC\'s first month (first counted buy ' + new Date(r.tierDateMs).toISOString().slice(0, 16) + ' UTC, Gold) and a net accumulator of it that month (in ' + (Number(BigInt(r.monthIn) / 10n ** 18n)).toLocaleString('en-US') + ', out ' + (Number(BigInt(r.monthOut) / 10n ** 18n)).toLocaleString('en-US') + ')',
      r.boughtInMonth === true && r.diamondMonth === true && BigInt(r.monthIn) > BigInt(r.monthOut) && gold(out[coin]) && r.tierDateMs >= F.diamond.from && r.tierDateMs <= F.diamond.until, JSON.stringify({ b: r.boughtInMonth, d: r.diamondMonth, t: r.tierDateMs }));
    check('case-a $' + coin + ': the date is the earliest own buy across BOTH linked wallets (wallet A\'s), never the later wallet\'s', r.tierDateMs === firstOwn.originMs && firstOwn.wallet === WA && r.tierBasis.origin === WA);
    check('case-a $' + coin + ': not disqualified (no dump to dust in its first 30 days)', r.dq && r.dq.disqualified === false && r.dq.dumped === false, JSON.stringify(r.dq));
    check('case-a $' + coin + ': what this fixture could not read (routed legs, pools not read for those transactions) is unknown, never "not a buy"', r.unknown.n > 0 && !r.complete && r.lots.filter((l) => l.kind === 'notbuy').length === 0, JSON.stringify(r.unknown.reasons));
    check('case-a $' + coin + ': the verdict needs only wallet A claimed (its own buys); no conflicts', r.needs.length >= 1 && r.needs.every((x) => x === WA) && !r.conflicts.length, JSON.stringify(r.needs));
  }
  /* worked out here from the raw logs, not taken from the engine: each pool Swap that paid one of the two wallets directly
     (the transactions whose pool events were read), its WETH in × ETH/USD at its block — where the fixture holds that price */
  for (const coin of ['SEND', 'GWC']) {
    const m = F.tokens[coin], direct = new Set(F.moves.filter(([t, , from, to]) => t === coin && from === m.pool && F.wallets.includes(to)).map(([, tx]) => tx));
    let want = 0, priced = 0, unpriced = 0;
    for (const [pool, block, , tx, , , a0In, , , a1Out] of F.swaps) {
      if (pool !== m.pool || !direct.has(tx) || BigInt(a1Out) <= 0n) continue;
      const px = ethUsd(block);
      if (px == null) { unpriced++; continue; }
      priced++; want += Number(BigInt(a0In) * 1000000n / 10n ** 18n) / 1e6 * px;
    }
    check('case-a $' + coin + ': spent equals its ' + priced + ' priced direct buys worked out from the raw Swaps and Syncs ($' + want.toFixed(2) + '); ' + unpriced + ' more with no ETH/USD in the fixture are unknown, not $0',
      Math.abs(out[coin].r.spentUsd - want) < 0.05 && priced > 0, out[coin].r.spentUsd + ' vs ' + want);
  }
  const S = out.SEND.r, G = out.GWC.r;
  const eligible = [S, G].every((r) => r.floor === true && r.diamondMonth === true && r.boughtInMonth === true && !r.dq.disqualified) && gold(out.SEND) && gold(out.GWC);
  check('case-a is Diamond-eligible: both coins bought inside $GWC\'s first month, a net accumulator of both, $' + S.spentUsd + ' / $' + G.spentUsd + ' spent ($SEND / $GWC)', eligible);
  for (const coin of ['SEND', 'GWC']) {
    let raw = 0n;
    for (const [t, , from, to, wei] of F.moves) if (t === coin) { if (F.wallets.includes(to) && !F.wallets.includes(from)) raw += BigInt(wei); if (F.wallets.includes(from) && !F.wallets.includes(to)) raw -= BigInt(wei); }
    check('case-a $' + coin + ': every token the two wallets hold is accounted for (held lots = the transfers\' own sum, ' + (Number(raw / 10n ** 18n)).toLocaleString('en-US') + ')', out[coin].r.heldWei === raw.toString(), out[coin].r.heldWei + ' vs ' + raw);
  }
  const sells = S.lots.filter((l) => l.fate === 'sold' || l.fate === 'saletax');
  check('case-a: the October sales of $SEND (after the window, after 24 h) keep their cost in spent', sells.length > 0 && sells.every((l) => l.counted && !l.zeroed));
  // the same wallet A, linked by ANOTHER account after it backed this one: nothing of it counts there (the WP0 scenario)
  const y = A.evaluate({ ...out.GWC.opts, memberSet: [WA], claims: (o) => (o === WA ? 'other' : 'free') });
  check('case-a: wallet A linked to a second account after backing this one counts $0 there (conflict, never a second Diamond)', y.spentUsd === 0 && y.conflicts.includes(WA) && y.diamondMonth !== true && y.floor !== true, JSON.stringify({ s: y.spentUsd, c: y.conflicts, d: y.diamondMonth }));
});

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !x ? '' : '  — ' + x)); if (ok) pass++; }
console.log(`${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
