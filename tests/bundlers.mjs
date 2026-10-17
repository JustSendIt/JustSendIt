/* Bundlers (owner, 2026-10-17): "pull all buy side transactions and transfers and determine whether there is a bundler in
   token, how many bundlers there are and how much they still hold vs sold and their PNL" — "only pick out transactions that
   bought and transferred in the same block" — "allow the user to expand and see all the wallets that the bundler has in the
   token and show … how much each wallet holds and how much each has sold" — "make sure this is active for all tokens".

   1. lib/bundles.js, the rules, on hand-built transactions: what is a bundle, and what (routers, fee wallets, taxes,
      liquidity withdrawals, different blocks) is not.
   2. server.js scanBundles, lifted and run against a fake node serving REAL chain data (tests/fixtures/bundles-*.json, read
      from Robinhood Chain on 2026-10-17): a launch that funded its pool and bought ~70.6% of supply for 34 wallets in one
      transaction, and a routed token with no bundle. Every expected figure is worked out here from the raw logs, not taken
      from the code under test.
   3. The API on the runner's throwaway server, the summary every token row carries, the panel's render, and that every page
      showing a block-0 panel shows this one too. Everything it creates it deletes. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const require = createRequire(import.meta.url);
const LIB = require(path.join(ROOT, 'lib', 'bundles.js'));
const PUB = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const grab = (re, what) => { const m = SRC.match(re); if (!m) throw new Error('could not lift ' + what); return m[0]; };

/* ═══ 1. the rules ═══ */
const T = LIB.TRANSFER_TOPIC, SW = LIB.SWAP_TOPIC, MI = LIB.MINT_TOPIC;
const TOKEN = '0x' + 'aa'.repeat(20), PAIR = '0x' + 'bb'.repeat(20), DEAD = '0x000000000000000000000000000000000000dead';
const W = (n) => '0x' + String(n).padStart(40, '0');
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const topic = (a) => '0x' + '0'.repeat(24) + a.slice(2);
const E18 = 10n ** 18n;
/* A hand-built token history. `zero` = the token is token0 of its pool; most pools on this chain have it as token1
   (WETH's address sorts low), so every rule below is run both ways. */
function chain(zero) {
  const tokenLogs = [], pairLogs = []; let li = 0;
  const hx = (n) => '0x' + n.toString(16);
  const swap = (b, tx, a0In, a1In, a0Out, a1Out) => pairLogs.push({ topics: [SW, topic(W(9)), topic(W(9))], data: '0x' + word(a0In) + word(a1In) + word(a0Out) + word(a1Out), blockNumber: hx(b), logIndex: hx(li++), transactionHash: '0x' + String(tx).padStart(64, '0') });
  const api = {
    tokenLogs, pairLogs,
    // a token transfer in tx `tx` of block `b`
    t(b, tx, from, to, v) { tokenLogs.push({ topics: [T, topic(from), topic(to)], data: '0x' + word(v), blockNumber: hx(b), logIndex: hx(li++), transactionHash: '0x' + String(tx).padStart(64, '0') }); return api; },
    // the pool's Swap in that tx: tokens out for quote in (a buy), or tokens in for quote out (a sale)
    buy(b, tx, tokOut, qIn) { if (zero) swap(b, tx, 0n, qIn, tokOut, 0n); else swap(b, tx, qIn, 0n, 0n, tokOut); return api; },
    sell(b, tx, tokIn, qOut) { if (zero) swap(b, tx, tokIn, 0n, 0n, qOut); else swap(b, tx, 0n, tokIn, qOut, 0n); return api; },
    mint(b, tx) { pairLogs.push({ topics: [MI, topic(W(9))], data: '0x' + word(1) + word(1), blockNumber: hx(b), logIndex: hx(li++), transactionHash: '0x' + String(tx).padStart(64, '0') }); return api; },
    fold() { return LIB.bundleFold(tokenLogs, pairLogs, { token: TOKEN, pair: PAIR, tokenIsZero: !!zero, isSys: (a) => !a || a === TOKEN || a === PAIR || a === DEAD || a === W(0) }); },
  };
  return api;
}
const evs = (f) => JSON.stringify(f.events.map((e) => [e.kind, e.lead, [...e.members.keys()]]));
for (const zero of [true, false]) {
  const tag = zero ? '[token0 pool] ' : '[token1 pool] ', chainZ = () => chain(zero);
  try {
    const A = W(0xa1), B2 = W(0xb2), C = W(0xc3), R = W(0x7e), F = W(0xfe), D = W(0xde), L = W(0x1a), K = W(0x6c), H = W(0x4e), S2 = W(0x57), PB = W(0xbb2);
    // a plain buy, and a routed buy with the token's own tax: no bundle, and the buyer is the wallet the tokens end at
    let c = chainZ().t(10, 1, PAIR, A, 100n * E18).buy(10, 1, 100n * E18, E18)
      .t(11, 2, PAIR, R, 100n * E18).t(11, 2, R, TOKEN, 1n * E18).t(11, 2, R, B2, 99n * E18).buy(11, 2, 100n * E18, 2n * E18);
    let f = c.fold();
    check(tag + 'a direct buy and a routed buy (pool → router → token tax + buyer) are no bundle', f.events.length === 0 && f.buyTxs === 2, evs(f));
    check(tag + '  ...the routed buyer bought the 99 that reached it and paid the whole 2 of the swap; the router bought nothing', f.flows.get(B2).bought === 99n * E18 && f.flows.get(B2).cost === 2n * E18 && f.flows.get(A).cost === E18 && !(f.flows.get(R) && f.flows.get(R).bought));
    c = chainZ().t(10, 1, PAIR, R, 100n * E18).t(10, 1, R, F, 1n * E18).t(10, 1, R, A, 99n * E18).buy(10, 1, 100n * E18, E18);
    check(tag + 'a router that pays a fee wallet 1% on the way is not a split (the slice is under ' + LIB.LIMITS.SPLIT_SHARE_PCT + '%)', c.fold().events.length === 0);
    // 'block': bought, then sent on in the same block
    c = chainZ().t(20, 1, PAIR, A, 100n * E18).buy(20, 1, 100n * E18, E18).t(20, 2, A, B2, 30n * E18).t(20, 3, A, C, 20n * E18);
    f = c.fold();
    const e0 = f.events[0];
    check(tag + '"block": a wallet that bought and, in the same block, sent tokens to two wallets is one bundle event led by it', f.events.length === 1 && e0.kind === 'block' && e0.lead === A && e0.members.size === 3 && e0.members.get(B2).received === 30n * E18 && e0.members.get(A).bought === 100n * E18 && e0.members.get(A).moved === 50n * E18, evs(f));
    check(tag + '  ...and it names all three transactions (the buy and both sends)', e0 && e0.txs.length === 3, e0 && e0.txs.length);
    c = chainZ().t(20, 1, PAIR, A, 100n * E18).buy(20, 1, 100n * E18, E18).t(21, 2, A, B2, 30n * E18);
    check(tag + '  ...the same send one block later is not a bundle (only the same block counts)', c.fold().events.length === 0);
    c = chainZ().t(20, 1, D, A, 5n * E18).t(20, 2, A, B2, 5n * E18).t(20, 3, PAIR, A, 100n * E18).buy(20, 3, 100n * E18, E18).t(20, 4, B2, C, 5n * E18);
    f = c.fold();
    check(tag + '  ...a send earlier in the same block counts, and a hop onward inside that block joins the bundle', f.events.length === 1 && f.events[0].members.has(C) && f.events[0].members.has(B2), evs(f));
    // 'tx': the launch — the deployer's tokens go into the pool through a launcher, and the pool pays two wallets, in ONE transaction
    c = chainZ().t(30, 1, W(0), D, 1000n * E18)
      .t(31, 2, D, L, 1000n * E18).t(31, 2, L, PAIR, 1000n * E18).mint(31, 2)
      .t(31, 2, PAIR, A, 400n * E18).buy(31, 2, 400n * E18, 3n * E18).t(31, 2, PAIR, B2, 100n * E18).buy(31, 2, 100n * E18, 1n * E18);
    f = c.fold();
    let lt = f.events.find((e) => e.kind === 'tx'), lg = LIB.bundleGroup(f)[0];
    check(tag + '"tx": funding the pool and buying for two wallets in one transaction is a bundle led by the deployer (and, paying two wallets, a split too)', lt && lt.lead === D && lt.members.get(D).roles.has('pooled') && lt.members.get(A).bought === 400n * E18 && f.events.map((e) => e.kind).sort().join() === 'split,tx', evs(f));
    check(tag + '  ...the launcher contract that only passed the tokens through is not one of its wallets', lt && !lt.members.has(L) && !lg.wallets.some((w) => w.addr === L));
    check(tag + '  ...ONE bundler: took 500 (each buy once, though two kinds of event saw it), the deployer\'s 1000 counted as liquidity, cost 4 shared by tokens (3.2 + 0.8)', LIB.bundleGroup(f).length === 1 && lg.took === 500n * E18 && lg.kinds.sort().join() === 'split,tx' && f.flows.get(D).liquidity === 1000n * E18 && f.flows.get(A).cost === 3200000000000000000n && f.flows.get(B2).cost === 800000000000000000n, JSON.stringify({ took: String(lg.took) }));
    check(tag + '  ...the lead (the deployer) is listed first, though it bought nothing', lg.wallets[0].addr === D);
    // the double count the review found: a later same-block send from one launch buyer to another must not add the buys again
    c.t(31, 3, B2, A, 1n * E18);
    f = c.fold(); lg = LIB.bundleGroup(f)[0];
    check(tag + '  ...a buyer sending another bundle wallet 1 token later in that block adds a "block" event, but took stays 500 — never the 900 that adding per event gave', f.events.some((e) => e.kind === 'block') && LIB.bundleGroup(f).length === 1 && lg.took === 500n * E18 && lg.wallets.find((w) => w.addr === A).inBundle.received === 1n * E18, JSON.stringify({ took: String(lg.took), kinds: f.events.map((e) => e.kind) }));
    c = chainZ().t(31, 2, D, PAIR, 1000n * E18).mint(31, 2).t(31, 3, PAIR, A, 400n * E18).buy(31, 3, 400n * E18, 3n * E18);
    check(tag + 'liquidity in one transaction and an unrelated buy in the next is not a bundle', c.fold().events.length === 0);
    // the token contract funds the pool and the same transaction buys for three wallets (a common launch template)
    c = chainZ().t(40, 1, TOKEN, PAIR, 900n * E18).mint(40, 1).t(40, 1, PAIR, A, 50n * E18).buy(40, 1, 50n * E18, E18).t(40, 1, PAIR, B2, 40n * E18).buy(40, 1, 40n * E18, E18).t(40, 1, PAIR, C, 30n * E18).buy(40, 1, 30n * E18, E18);
    f = c.fold();
    check(tag + '"split": one transaction in which the pool paid three wallets straight out (no contract between) is a bundle — here after the token contract itself funded the pool', f.events.length === 1 && f.events[0].kind === 'split' && f.events[0].members.size === 3 && f.events[0].lead === A, evs(f));
    // 'split' through a contract
    c = chainZ().t(40, 1, PAIR, K, 100n * E18).t(40, 1, K, A, 60n * E18).t(40, 1, K, B2, 40n * E18).buy(40, 1, 100n * E18, E18);
    f = c.fold();
    check(tag + '"split": a contract handing one buy to two wallets (60/40) is a bundle led by that contract', f.events.length === 1 && f.events[0].kind === 'split' && f.events[0].lead === K && f.events[0].members.get(A).bought === 60n * E18, evs(f));
    c = chainZ().t(40, 1, PAIR, A, 100n * E18).t(40, 1, A, B2, 30n * E18).buy(40, 1, 100n * E18, E18);
    f = c.fold();
    check(tag + '  ...a wallet that buys and passes 30% on inside the same transaction is a split too (it kept a real share)', f.events.length === 1 && f.events[0].kind === 'split' && f.events[0].lead === A && f.events[0].members.has(B2), evs(f));
    // a contract that ONLY splits never becomes a "router", however often: its bundles are all found, and joined through it
    c = chainZ();
    for (let i = 0; i < 4; i++) c.t(50 + i, 10 + i, PAIR, K, 100n * E18).t(50 + i, 10 + i, K, W(0x100 + i), 60n * E18).t(50 + i, 10 + i, K, W(0x200 + i), 40n * E18).buy(50 + i, 10 + i, 100n * E18, E18);
    f = c.fold();
    check(tag + '  ...a buy-and-split contract that splits 4 times is never called a router: 4 split events, one bundler through it with 9 wallets', !f.routers.has(K) && f.events.length === 4 && LIB.bundleGroup(f).length === 1 && LIB.bundleGroup(f)[0].wallets.length === 9, JSON.stringify({ routers: [...f.routers], ev: f.events.length }));
    // a real router: many single-buyer buys, and one where a bot's solver took a 25% slice — no bundle
    c = chainZ();
    for (let i = 0; i < 6; i++) c.t(60 + i, 20 + i, PAIR, R, 100n * E18).t(60 + i, 20 + i, R, W(0x300 + i), 100n * E18).buy(60 + i, 20 + i, 100n * E18, E18);
    c.t(70, 30, PAIR, R, 100n * E18).t(70, 30, R, W(0x3aa), 75n * E18).t(70, 30, R, W(0xaaa), 25n * E18).buy(70, 30, 100n * E18, E18);
    f = c.fold();
    check(tag + 'a router (6 single-buyer buys) whose one buy paid a solver 25% is still a router, and that buy is no bundle', f.routers.has(R) && f.events.length === 0, JSON.stringify({ routers: [...f.routers], ev: evs(f) }));
    c.t(71, 31, PAIR, R, 90n * E18).t(71, 31, R, W(0x3b1), 30n * E18).t(71, 31, R, W(0x3b2), 30n * E18).t(71, 31, R, W(0x3b3), 30n * E18).buy(71, 31, 90n * E18, E18);
    f = c.fold();
    check(tag + '  ...but one transaction that buys through that router for THREE wallets at once is a split, led by the wallet that took most (the router is never a member)', f.events.length === 1 && f.events[0].kind === 'split' && f.events[0].members.size === 3 && !f.events[0].members.has(R), evs(f));
    // fee wallets: side slices next to three different buyers; never a member of their buys...
    c = chainZ();
    for (let i = 0; i < 3; i++) c.t(80 + i, 40 + i, PAIR, R, 1n * E18).t(80 + i, 40 + i, R, F, 1n * E18 / 100n).t(80 + i, 40 + i, R, W(0x400 + i), 99n * E18 / 100n).buy(80 + i, 40 + i, 1n * E18, 1n);
    c.t(90, 50, PAIR, W(0x410), 10n * E18).buy(90, 50, 10n * E18, 1n).t(90, 51, W(0x410), F, 1n * E18).t(90, 52, W(0x410), W(0x411), 2n * E18);
    f = c.fold();
    check(tag + 'a wallet taking side slices next to ' + LIB.LIMITS.FEE_PARTIES + ' different buyers is a fee wallet, and is never made a member of someone else\'s bundle', f.fees.has(F) && f.events.length === 1 && !f.events[0].members.has(F), JSON.stringify({ fees: [...f.fees], ev: evs(f) }));
    // ...but its own buy-and-send still counts (a deployer who is also the tax wallet)
    c.t(95, 60, PAIR, F, 300n * E18).buy(95, 60, 300n * E18, 3n * E18).t(95, 61, F, W(0x501), 100n * E18).t(95, 62, F, W(0x502), 100n * E18);
    f = c.fold();
    check(tag + '  ...its OWN buy, then sends to two wallets in that block, is a bundle it leads', f.events.some((e) => e.lead === F && e.kind === 'block' && e.members.has(W(0x501)) && e.members.has(W(0x502))), evs(f));
    // a same-block buy, then a sale through a bot router that pays the fee wallet from the seller's tokens: no bundle
    c.t(99, 70, PAIR, A, 50n * E18).buy(99, 70, 50n * E18, 1n).t(99, 71, A, R, 50n * E18).t(99, 71, R, F, 1n * E18).t(99, 71, R, PAIR, 49n * E18).sell(99, 71, 49n * E18, 1n);
    f = c.fold();
    check(tag + '  ...a buy and a same-block sale whose bot router pays the fee wallet from the seller\'s tokens is no bundle (the fee wallet is no recipient)', !f.events.some((e) => e.lead === A), evs(f));
    // the pool paying out with no buy swap is liquidity being taken out, not a buy
    c = chainZ().t(80, 1, PAIR, A, 50n * E18).t(80, 2, A, B2, 50n * E18);
    f = c.fold();
    check(tag + 'the pool paying out without a buy swap (liquidity removed) is not a buy, so a send after it is no bundle', f.events.length === 0 && !(f.flows.get(A).bought > 0n));
    // sales: through a router it is the seller's; two sellers in one swap share its proceeds by their tokens
    c = chainZ().t(90, 1, PAIR, A, 100n * E18).buy(90, 1, 100n * E18, 2n * E18).t(91, 2, A, R, 40n * E18).t(91, 2, R, PAIR, 40n * E18).sell(91, 2, 40n * E18, 1n * E18);
    f = c.fold();
    check(tag + 'a sale through a router (wallet → router → pool) is the wallet\'s: sold 40, got 1 back', f.flows.get(A).sold === 40n * E18 && f.flows.get(A).proceeds === 1n * E18 && !(f.flows.get(R) && f.flows.get(R).sold > 0n));
    c = chainZ().t(92, 3, A, K, 40n * E18).t(92, 3, B2, K, 60n * E18).t(92, 3, K, PAIR, 100n * E18).sell(92, 3, 100n * E18, 1n * E18);
    f = c.fold();
    check(tag + '  ...two wallets whose tokens one contract sells in one swap: sold 40 and 60, proceeds 0.4 and 0.6 — adding up to the swap', f.flows.get(A).sold === 40n * E18 && f.flows.get(B2).sold === 60n * E18 && f.flows.get(A).proceeds === 400000000000000000n && f.flows.get(B2).proceeds === 600000000000000000n);
    // a swap-and-liquify helper the token contract funds is never read as moving its own tokens in a buy's transaction
    c = chainZ();
    for (let i = 0; i < 5; i++) c.t(100 + i, 80 + i, PAIR, R, 10n * E18).t(100 + i, 80 + i, R, W(0x600 + i), 10n * E18).buy(100 + i, 80 + i, 10n * E18, 1n)
      .t(100 + i, 80 + i, TOKEN, H, 2n * E18).t(100 + i, 80 + i, H, PAIR, 1n * E18).t(100 + i, 80 + i, H, PAIR, 1n * E18).mint(100 + i, 80 + i);
    f = c.fold();
    check(tag + 'a helper the token contract funds, putting those tokens into the pool during ordinary buys, makes none of them a bundle', f.events.length === 0, evs(f));
    // a hub (a staking contract many wallets send to) never ties two traders together
    c = chainZ();
    for (let i = 0; i < 3; i++) c.t(110 + i, 90 + i, W(0x700 + i), S2, E18);
    c.t(120, 95, PAIR, A, 10n * E18).buy(120, 95, 10n * E18, 1n).t(120, 96, A, S2, 5n * E18).t(120, 97, A, C, 1n * E18)
     .t(130, 98, PAIR, B2, 10n * E18).buy(130, 98, 10n * E18, 1n).t(130, 99, B2, S2, 5n * E18).t(130, 100, B2, W(0x7cc), 1n * E18);
    f = c.fold();
    check(tag + 'a staking contract many wallets send to is a hub: never a bundle member, so two traders who stake in their buy blocks stay two bundlers', f.hubs.has(S2) && LIB.bundleGroup(f).length === 2 && !LIB.bundleGroup(f).some((g) => g.wallets.some((w) => w.addr === S2)), JSON.stringify({ hubs: [...f.hubs], n: LIB.bundleGroup(f).length }));
    // grouping: shared wallets join events; a pool taken out leaves only what is still two wallets
    c = chainZ().t(100, 1, PAIR, A, 10n * E18).buy(100, 1, 10n * E18, 1n).t(100, 2, A, C, 1n * E18).t(100, 3, A, W(0x801), 1n * E18)
      .t(200, 4, PAIR, B2, 10n * E18).buy(200, 4, 10n * E18, 1n).t(200, 5, B2, C, 1n * E18).t(200, 6, B2, W(0x802), 1n * E18);
    f = c.fold();
    check(tag + 'two bundle events that share a wallet are one bundler, seen in two blocks', LIB.bundleGroup(f).length === 1 && LIB.bundleGroup(f)[0].blocks.length === 2 && LIB.bundleGroup(f)[0].wallets.length === 5);
    check(tag + '  ...with the shared wallet found to be another pool, they are two bundlers without it', LIB.bundleGroup(f, new Set([C])).length === 2 && LIB.bundleGroup(f, new Set([C])).every((g) => !g.wallets.some((w) => w.addr === C)));
    check(tag + '  ...an event led by an address that is not a holder is not a bundle at all', LIB.bundleGroup(f, new Set([A])).length === 1 && LIB.bundleGroup(f, new Set([A]))[0].lead === B2);
    c = chainZ().t(140, 1, PAIR, A, 100n * E18).buy(140, 1, 100n * E18, 1n).t(140, 2, A, PB, 100n * E18);
    f = c.fold();
    const gPB = LIB.bundleGroup(f, new Set([PB]));
    check(tag + 'a buy here and a sale on the token\'s OTHER pool in the same block is one trader\'s trade: no bundler once that pool is known', f.events.length === 1 && gPB.length === 0, JSON.stringify({ ev: f.events.length, groups: gPB.length }));
    // the wallet list: lead first; sends inside the bundle are not "outside"; P&L is owed only to the bundle's own tokens
    c = chainZ().t(20, 1, PAIR, A, 100n * E18).buy(20, 1, 100n * E18, E18).t(20, 2, A, B2, 30n * E18).t(25, 3, B2, W(0x999), 10n * E18).t(26, 4, W(0x99a), B2, 500n * E18);
    const g1 = LIB.bundleGroup(c.fold())[0], wA = g1.wallets.find((w) => w.addr === A), wB = g1.wallets.find((w) => w.addr === B2);
    check(tag + 'the bundler\'s wallets: the lead first; a later send outside the bundle is "sent outside", not sold — and the lead\'s send to a member is not "outside"', g1.wallets[0].addr === A && wB.sentOutside === 10n * E18 && wB.sold === 0n && wA.sentOutside === 0n);
    check(tag + '  ...what each holds of the bundle\'s own tokens: A 70 (bought 100, sent 30 on); B 20 (30 from A, 10 sent on) — the 500 B got from outside is not the bundle\'s', wA.attributable === 70n * E18 && wB.attributable === 20n * E18, JSON.stringify({ a: String(wA.attributable), b: String(wB.attributable) }));
    // undecodable input is refused, never read as zero
    let threw = null; try { LIB.bundleFold([{ topics: [T, topic(A)], data: '0x', blockNumber: '0x1', logIndex: '0x0', transactionHash: '0x1' }], [], { token: TOKEN, pair: PAIR, tokenIsZero: zero, isSys: () => false }); } catch (e) { threw = e; }
    check(tag + 'a transfer it cannot decode stops the read (never a silent zero)', threw && /cannot decode/.test(threw.message));
  } catch (e) { check(tag + 'the rules section ran to the end', false, e && e.stack); }
}
try {
  // the cap on events is counted, not silent
  const c = chain(true);
  for (let i = 0; i < LIB.LIMITS.MAX_EVENTS + 3; i++) c.t(1000 + i, 50000 + 2 * i, PAIR, W(0x10000 + i), E18).buy(1000 + i, 50000 + 2 * i, E18, 1n).t(1000 + i, 50001 + 2 * i, W(0x10000 + i), W(0x90000 + i), 1n);
  const f = c.fold();
  check('more bundle moments than MAX_EVENTS (' + LIB.LIMITS.MAX_EVENTS + ') are counted as dropped (the read says it is incomplete)', f.events.length === LIB.LIMITS.MAX_EVENTS && f.eventsDropped === 3);
} catch (e) { check('the cap section ran to the end', false, e && e.stack); }

/* ═══ 2. the server's scan, on real chain data ═══ */
const fixture = (n) => JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', n), 'utf8'));
const addrOf = (t) => ('0x' + String(t).slice(26)).toLowerCase();
function fakeNode(fx, opts) {
  opts = opts || {};
  const bal = new Map();
  for (const l of fx.tokenLogs) { const f = addrOf(l.topics[1]), t = addrOf(l.topics[2]), v = BigInt(l.data); bal.set(f, (bal.get(f) || 0n) - v); bal.set(t, (bal.get(t) || 0n) + v); }
  const S = { calls: [], logQueries: 0 };
  const w = (a) => '0x' + '0'.repeat(24) + a.slice(2);
  async function call(m, p) {
    S.calls.push(m);
    if (m === 'eth_blockNumber') return '0x' + fx.head.toString(16);
    if (m === 'eth_getCode') { const a = p[0].toLowerCase(); if (opts.codeFails && opts.codeFails.has(a)) throw new Error('request timed out'); return (opts.codes && opts.codes[a]) || fx.codes[a] || '0x'; }
    if (m === 'eth_getLogs') {
      S.logQueries++;
      const q = p[0], from = parseInt(q.fromBlock, 16), to = parseInt(q.toBlock, 16);
      // the real node's two spans: 10,000,000 blocks with an address and one value per topic position, 100,000 otherwise
      const cap = (q.topics || []).some((t) => Array.isArray(t)) ? 100000 : 10000000;
      if (to - from + 1 > cap) { S.refusedSpans = (S.refusedSpans || 0) + 1; throw new Error('query spans ' + (to - from + 1) + ' blocks (' + from + ' to ' + to + '), but only ' + cap + ' are allowed for this request; narrow the block range, or send one value per position'); }
      const src = q.address === fx.token ? fx.tokenLogs : q.address === fx.pair ? fx.pairLogs : [];
      const pos = (i) => { const t = q.topics && q.topics[i]; return t == null ? null : Array.isArray(t) ? t : [t]; };
      const out = src.filter((l) => { const b = parseInt(l.blockNumber, 16); return b >= from && b <= to && [0, 1, 2].every((i) => { const w2 = pos(i); return !w2 || w2.includes(l.topics[i]); }); });
      if (out.length > (opts.logCap || 10000)) throw new Error('logs matched by query exceeds limit of ' + (opts.logCap || 10000));
      return out;
    }
    if (m === 'eth_call') {
      const to = p[0].to.toLowerCase(), data = p[0].data;
      if (to === fx.pair && data === '0x0dfe1681') return w(fx.token0);
      if (to === fx.pair && data === '0xd21220a7') return w(fx.token1);
      if (to === fx.pair && data === '0x0902f1ac') { if (opts.notV2) throw new Error('execution reverted'); return fx.reserves; }
      if (to === fx.token && data === '0x18160ddd') return fx.supply;
      if (to === fx.token && data.startsWith('0x70a08231')) { const a = '0x' + data.slice(-40); if (opts.unreadable && opts.unreadable.has(a)) throw new Error('execution reverted'); return '0x' + (bal.get(a) || 0n).toString(16).padStart(64, '0'); }
      // another pool of the token: { addr: [token0, token1] }
      if (opts.pools && opts.pools[to] && (data === '0x0dfe1681' || data === '0xd21220a7')) return w(opts.pools[to][data === '0x0dfe1681' ? 0 : 1]);
      throw new Error('execution reverted');
    }
    throw new Error('unexpected ' + m);
  }
  // rpcBatch's contract: a refused item (a revert, or any per-item error that is not a throttle) comes back null, a throttle throws
  async function batch(calls) { S.batches = (S.batches || 0) + 1; return Promise.all(calls.map(([m, p]) => call(m, p).catch((e) => { if (/revert|timed out/.test(e.message)) return null; throw e; }))); }
  return { call, batch, S, bal };
}
function liftScan(node) {
  const ctx = vm.createContext({ BigInt, Number, Math, Set, Map, Array, Object, String, JSON, Promise, Error, parseInt, isFinite, Infinity, console,
    setTimeout: (f) => { f(); return 0; }, rpc: node.call, rpcBatch: node.batch, rpcRetry: (f) => f(),
    SWAP_ROUTER: '0x89e5db8b5aa49aa85ac63f691524311aeb649eba', FACTORY: '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f', WETH_ADDR: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
    QUOTE_SET: new Set(['0x0bd7d308f8e1639fab988df18a8011f41eacad73', '0x5fc5360d0400a0fd4f2af552add042d716f1d168']), TRANSFER_TOPIC: T, BUNDLES: LIB,
    sniperRow: () => null, now: () => 1e12 });
  vm.runInContext([
    grab(/const SNIPE = \{[\s\S]*?\n\};\n/, 'SNIPE'), grab(/const DEAD_ADDRS = [\s\S]*?const hexBlock = [^\n]+\n/, 'address helpers'),
    grab(/function isSystemAddr\(a, token, pair\) \{[\s\S]*?\n\}\n/, 'isSystemAddr'), grab(/const isThrottle = [^\n]+\n/, 'isThrottle'),
    grab(/function sniperBudget\(max\) \{[\s\S]*?\n\}\n/, 'sniperBudget'), grab(/async function sniperBalance\(B, token, addr\) \{[\s\S]*?\n\}\n/, 'sniperBalance'),
    grab(/async function tokenFloat\(B, token, pair, supply\) \{[\s\S]*?\n\}\n/, 'tokenFloat'),
    grab(/const LOG_WINDOWS_PER_BATCH = [^\n]+\n/, 'LOG_WINDOWS_PER_BATCH'), grab(/const TOO_MANY_RE = [^\n]+\n/, 'TOO_MANY_RE'),
    grab(/async function transferLogWalk\(address, topicSets, start, head, max, read, opts\) \{[\s\S]*?\n\}\n/, 'transferLogWalk'),
    grab(/const BUND = \{[\s\S]*?\n\};\n/, 'BUND'), grab(/const EIP7702_CODE = [^\n]+\n/, 'EIP7702_CODE'), grab(/const wordAddr = [^\n]+\n/, 'wordAddr'),
    grab(/async function bundleBatchRead\(B, calls\) \{[\s\S]*?\n\}\n/, 'bundleBatchRead'), grab(/async function scanBundles\(token, pair\) \{[\s\S]*?\n\}\n/, 'scanBundles'),
    grab(/function bundleEntry\(g, id, holds, priceQ\) \{[\s\S]*?\n\}\n/, 'bundleEntry'), grab(/function bundleTotals\(bundlers\) \{[\s\S]*?\n\}\n/, 'bundleTotals'),
    grab(/function bundleSummary\(d\) \{[\s\S]*?\n\}\n/, 'bundleSummary'),
    'this.scan = scanBundles; this.summary = bundleSummary; this.BUND = BUND;',
  ].join(''), ctx);
  return ctx;
}
let launchData = null, unreadData = null, launchX = null;
try {
  const fx = fixture('bundles-launch.json');
  const node = fakeNode(fx), S = liftScan(node);
  const d = await S.scan(fx.token, fx.pair);
  launchData = d;
  // the expected answer, worked out from the raw logs: the one transaction in which the pool both received the
  // supply and paid wallets out
  const LAUNCH = '0x2854314f6f972f4466a47c49e9a9eb2890ae4d2fa54b1654446bd6a1b9579359';
  const inLaunch = fx.tokenLogs.filter((l) => l.transactionHash === LAUNCH);
  const paid = inLaunch.filter((l) => addrOf(l.topics[1]) === fx.pair);
  const took = paid.reduce((s, l) => s + BigInt(l.data), 0n);
  const deployer = addrOf(inLaunch.find((l) => addrOf(l.topics[2]) !== fx.pair && addrOf(l.topics[1]) !== fx.pair).topics[1]);
  const members = new Set([deployer, ...paid.map((l) => addrOf(l.topics[2]))]);
  const heldNow = [...members].reduce((s, a) => s + (node.bal.get(a) || 0n), 0n);
  const b = d.bundlers[0] || {};
  check('real launch (' + fx.token.slice(0, 10) + '…): exactly one bundler — "bought and moved tokens in one transaction", and (34 wallets paid at once) a split — in that launch block', d.bundlers.length === 1 && b.kinds.slice().sort().join() === 'split,tx' && b.firstBlock === parseInt(inLaunch[0].blockNumber, 16) && b.txs[0] === LAUNCH, JSON.stringify({ n: d.bundlers.length, kinds: b.kinds, block: b.firstBlock }));
  check('  ...led by the deployer, whose supply went into the pool, listed first, with all ' + members.size + ' wallets: the deployer plus every wallet the pool paid', b.lead === deployer && b.wallets[0].addr === deployer && b.wallets.length === members.size && b.wallets.every((w) => members.has(w.addr)), JSON.stringify({ lead: b.lead, first: b.wallets && b.wallets[0].addr, n: b.wallets && b.wallets.length }));
  check('  ...took exactly what the pool paid out in that transaction (' + (Number(took * 1000n / BigInt(fx.supply)) / 10) + '% of supply)', b.took === took.toString(), b.took + ' vs ' + took);
  check('  ...still holds exactly the sum of those wallets\' balances now', b.holds === heldNow.toString(), b.holds + ' vs ' + heldNow);
  /* Sold, proceeds and cost worked out HERE from the raw logs, not from the code under test. The token is token1 of this
     pool, so a Swap's amount1 is the token and amount0 is WETH. In each transaction: a member whose tokens left it in a
     sale transaction sold min(what left it, what the pool took in); a member the pool's tokens reached in a buy
     transaction paid its share of that swap's WETH, by tokens. */
  const W64 = (dat, i) => BigInt('0x' + dat.slice(2 + 64 * i, 2 + 64 * i + 64));
  const swaps = new Map();
  for (const l of fx.pairLogs) if (l.topics[0] === SW) { const x = swaps.get(l.transactionHash) || { tokIn: 0n, tokOut: 0n, qIn: 0n, qOut: 0n }; const t1 = fx.token0 !== fx.token; x.tokIn += W64(l.data, t1 ? 1 : 0); x.qIn += W64(l.data, t1 ? 0 : 1); x.tokOut += W64(l.data, t1 ? 3 : 2); x.qOut += W64(l.data, t1 ? 2 : 3); swaps.set(l.transactionHash, x); }
  const byTx = new Map(); for (const l of fx.tokenLogs) { const a = byTx.get(l.transactionHash) || []; a.push(l); byTx.set(l.transactionHash, a); }
  let xSold = 0n, xProceeds = 0n, xCost = 0n;
  const xSoldBy = new Map();
  for (const [h, sw] of swaps) {
    const net = new Map(); for (const l of byTx.get(h) || []) { const f = addrOf(l.topics[1]), t = addrOf(l.topics[2]), v = BigInt(l.data); net.set(f, (net.get(f) || 0n) - v); net.set(t, (net.get(t) || 0n) + v); }
    if (sw.tokIn > 0n) for (const m of members) { const n = net.get(m) || 0n; if (n < 0n) { const sold = -n < sw.tokIn ? -n : sw.tokIn; xSold += sold; xSoldBy.set(m, (xSoldBy.get(m) || 0n) + sold); xProceeds += sw.qOut * sold / sw.tokIn; } }
    if (sw.tokOut > 0n) { let pos = 0n; for (const [a, n] of net) if (n > 0n && a !== fx.pair && a !== fx.token) pos += n; for (const m of members) { const n = net.get(m) || 0n; if (n > 0n && pos > 0n) xCost += sw.qIn * n / pos; } }
  }
  launchX = { supply: BigInt(fx.supply), took, heldNow, xSold, xSoldBy, bal: node.bal, members, xPnlNegative: xProceeds + BigInt(b.unrealised || '0') < xCost };
  const near = (a, x) => { const d = BigInt(a) - x; return (d < 0n ? -d : d) <= 64n; };   // per-wallet integer division, summed in another order: a few wei apart at most
  check('  ...sold ' + (Number(xSold * 100000n / BigInt(fx.supply)) / 1000) + '% of supply and got ' + (Number(xProceeds / 10n ** 12n) / 1e6) + ' WETH back — both worked out here from the pool\'s own Swap logs', BigInt(b.sold) === xSold && near(b.proceeds, xProceeds) && xSold > 0n, JSON.stringify({ sold: b.sold, xSold: String(xSold), proceeds: b.proceeds, xProceeds: String(xProceeds) }));
  check('  ...and paid ' + (Number(xCost / 10n ** 12n) / 1e6) + ' WETH for its buys, worked out the same way', near(b.cost, xCost) && xCost > 0n, b.cost + ' vs ' + xCost);
  // the price, from the pool's reserves in the fixture: WETH reserve ÷ token reserve
  const r0 = BigInt('0x' + fx.reserves.slice(2, 66)), r1 = BigInt('0x' + fx.reserves.slice(66, 130));
  const px = fx.token0 === fx.token ? Number(r1) / Number(r0) : Number(r0) / Number(r1);
  check('  ...P&L = got back + (its own tokens still held × the pool\'s price) − paid, with the price from the pool\'s reserves and the held part never more than it holds', BigInt(b.valued) <= BigInt(b.holds) && b.unrealised === BigInt(Math.round(Number(BigInt(b.valued)) * px)).toString() && b.pnl === (BigInt(b.proceeds) + BigInt(b.unrealised) - BigInt(b.cost)).toString(), JSON.stringify({ valued: b.valued, holds: b.holds, unrealised: b.unrealised, pnl: b.pnl }));
  check('  ...the quote is WETH from the pool itself, and the totals agree with the one bundler', d.quote.symbol === 'WETH' && d.totals.bundlers === 1 && d.totals.wallets === members.size && d.totals.took === b.took && d.totals.pnl === b.pnl && d.totals.sold === b.sold);
  check('  ...it read from the pool\'s first event and stayed far inside its budget — one topic value per query, so the node allows its widest window', d.fromBlock > 0 && d.calls > 0 && d.calls < 60 && !d.capped && (node.S.refusedSpans || 0) <= 4, JSON.stringify({ from: d.fromBlock, calls: d.calls, refused: node.S.refusedSpans }));
  const sm = S.summary(d), pctOf = (v) => Number((Number(v) / Number(fx.supply) * 100).toPrecision(4));
  check('the summary every token row carries: 1 bundler, ' + members.size + ' wallets, and took / still hold / sold as the shares worked out here', sm.bundlers === 1 && sm.wallets === members.size && sm.tookPct === pctOf(took) && sm.holdsPct === pctOf(heldNow) && sm.soldPct === pctOf(xSold) && sm.pnl === b.pnl && sm.buyTxs === d.buyTxs && sm.transfers === d.transfers && sm.quote === 'WETH', JSON.stringify(sm));
  // one wallet's balance unreadable: no "still holds" and no P&L for that bundle — never a zero
  const node2 = fakeNode(fx, { unreadable: new Set([paid[0] && addrOf(paid[0].topics[2])]) });
  const d2 = await liftScan(node2).scan(fx.token, fx.pair);
  unreadData = d2;
  check('  ...a balance that cannot be read leaves the bundle\'s holdings and P&L unknown (null), and the read says so', d2.bundlers[0].holds === null && d2.bundlers[0].pnl === null && d2.totals.holds === null && d2.notes.some((n) => /could not be read/.test(n)) && d2.bundlers[0].wallets.find((w) => w.holds === null));
  // the node failing to say whether an address is a contract — for the LEAD, or for a member — never makes the bundle vanish
  for (const [who, a] of [['the lead (the deployer)', deployer], ['a member', addrOf(paid[2].topics[2])]]) {
    const dn = await liftScan(fakeNode(fx, { codeFails: new Set([a]) })).scan(fx.token, fx.pair);
    const bn = dn.bundlers[0] || {};
    check('  ...when the node will not say whether ' + who + ' is a contract, the bundle is still there, that wallet listed with no balance, the read marked incomplete — never "no bundlers"', dn.bundlers.length === 1 && bn.took === b.took && bn.wallets.length === members.size && bn.wallets.find((w) => w.addr === a).holds === null && bn.holds === null && dn.capped === true && dn.notes.some((n) => /could not be checked/.test(n)), JSON.stringify({ n: dn.bundlers.length, capped: dn.capped, notes: dn.notes }));
  }
  // a member that turns out to be another pool of this token is not a holder of the bundle — in either pool layout
  const anyPaid = addrOf(paid[1].topics[2]), WETHA = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
  for (const [layout, ids] of [['the token as token0', [fx.token, WETHA]], ['the token as token1 (WETH sorts low, so the usual layout)', [WETHA, fx.token]]]) {
    const d3 = await liftScan(fakeNode(fx, { codes: { [anyPaid]: '0x6080604052' }, pools: { [anyPaid]: ids } })).scan(fx.token, fx.pair);
    check('  ...a wallet in the bundle that is really another pool of the token (' + layout + ') is left out of it', d3.bundlers.length === 1 && !d3.bundlers[0].wallets.some((w) => w.addr === anyPaid) && d3.bundlers[0].wallets.length === members.size - 1);
  }
  // a node that caps every answer at 50 logs: the walk splits its windows and the answer is the same
  const node4 = fakeNode(fx, { logCap: 50 });
  const d4 = await liftScan(node4).scan(fx.token, fx.pair);
  check('  ...a node that answers at most 50 logs a query gives the same answer (the walk splits its windows)', d4.bundlers.length === 1 && d4.bundlers[0].took === b.took && d4.bundlers[0].holds === b.holds && node4.S.logQueries > node.S.logQueries, node4.S.logQueries + ' vs ' + node.S.logQueries);
  // more events than the fold keeps, and more bundlers than one answer lists: both said, neither silent
  const keepEv = LIB.LIMITS.MAX_EVENTS; LIB.LIMITS.MAX_EVENTS = 1;
  const d5 = await liftScan(fakeNode(fx)).scan(fx.token, fx.pair); LIB.LIMITS.MAX_EVENTS = keepEv;
  check('  ...more bundle moments than the read keeps marks it incomplete and says so', d5.capped === true && d5.notes.some((n) => /more bundle moments than this read keeps/.test(n)), JSON.stringify(d5.notes));
  const S6 = liftScan(fakeNode(fx)); S6.BUND.MAX_BUNDLERS = 0;
  const d6 = await S6.scan(fx.token, fx.pair);
  check('  ...more bundlers than one answer lists: the list is cut, the totals still count every one, and it says so', d6.bundlers.length === 0 && d6.totals.bundlers === 1 && d6.totals.took === b.took && d6.notes.some((n) => /largest of 1 bundlers/.test(n)), JSON.stringify(d6.notes));
  // pools this read cannot understand are refused with a reason — never stored as "never traded, no bundlers"
  const quoteSide = fx.token0 === fx.token ? 'token1' : 'token0', tokenSide = quoteSide === 'token0' ? 'token1' : 'token0';
  let e1 = null; try { await liftScan(fakeNode({ ...fx, [tokenSide]: '0x' + '12'.repeat(20) })).scan(fx.token, fx.pair); } catch (e) { e1 = e; }
  check('a pool that does not trade the token is refused, with the reason', e1 && /does not trade the token/.test(e1.message), e1 && e1.message);
  let e2 = null; try { await liftScan(fakeNode({ ...fx, [quoteSide]: '0x' + '34'.repeat(20) })).scan(fx.token, fx.pair); } catch (e) { e2 = e; }
  check('  ...a pool whose other side is not WETH or USDG is refused rather than priced in an unknown unit', e2 && /not WETH or USDG/.test(e2.message), e2 && e2.message);
  let e3 = null; try { await liftScan(fakeNode(fx, { notV2: true })).scan(fx.token, fx.pair); } catch (e) { e3 = e; }
  check('  ...a pool that does not answer getReserves() (not Uniswap-v2 style) is refused, not read as "never traded"', e3 && /not a Uniswap-v2-style pool/.test(e3.message), e3 && e3.message);
  let e4 = null; try { await liftScan(fakeNode({ ...fx, pairLogs: [] })).scan(fx.token, fx.pair); } catch (e) { e4 = e; }
  check('  ...a pool that paid tokens out but shows no Swap this read understands is refused, not called "never traded"', e4 && /paid tokens out but emitted no swap/.test(e4.message), e4 && e4.message);
  const fresh = { ...fx, pairLogs: [], tokenLogs: fx.tokenLogs.filter((l) => addrOf(l.topics[1]) !== fx.pair) };
  const d7 = await liftScan(fakeNode(fresh)).scan(fx.token, fx.pair);
  check('  ...a pool that truly never traded: no bundlers, no buys, and its transfers shown as not read (null), not as 0', d7.bundlers.length === 0 && d7.fromBlock === null && d7.buyTxs === 0 && d7.transfers === null, JSON.stringify({ from: d7.fromBlock, t: d7.transfers }));
} catch (e) { check('the launch section ran to the end', false, e && e.stack); }
try {
  const fx = fixture('bundles-routed.json');
  const node = fakeNode(fx);
  const d = await liftScan(node).scan(fx.token, fx.pair);
  const buys = new Set(fx.pairLogs.filter((l) => l.topics[0] === SW).map((l) => l.transactionHash)).size;
  // worked out from the logs: how many of its buys the pool paid to a CONTRACT (a router) rather than to the buyer
  const routed = new Set(fx.tokenLogs.filter((l) => addrOf(l.topics[1]) === fx.pair && fx.codes[addrOf(l.topics[2])] && addrOf(l.topics[2]) !== fx.token).map((l) => l.transactionHash)).size;
  check('real routed token (' + fx.token.slice(0, 10) + '…): no bundler — ' + routed + ' of its buys came through a router contract that carried each to one buyer', d.bundlers.length === 0 && d.totals.bundlers === 0 && d.buyTxs > 0 && routed > 0, JSON.stringify({ n: d.bundlers.length, buys: d.buyTxs, routed }));
  const firstPool = Math.min(...fx.pairLogs.map((l) => parseInt(l.blockNumber, 16)));
  const since = fx.tokenLogs.filter((l) => parseInt(l.blockNumber, 16) >= firstPool).length;
  check('  ...and it read every transfer of the token from the pool\'s first event on (' + since + ' of ' + fx.tokenLogs.length + '; the rest is the mint before the pool) and saw its buys', d.transfers === since && d.fromBlock === firstPool && d.buyTxs > 0 && d.buyTxs <= buys, d.transfers + ' ' + d.buyTxs + ' ' + buys);
} catch (e) { check('the routed section ran to the end', false, e && e.stack); }

/* ═══ 3. the API, the row summary, the panel ═══ */
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const TOS_VERSION = (/const TOS_VERSION = ['"]?([^'";\s]+)/.exec(SRC) || [])[1];
const codes = [], tokens = [];
function freshPass() {
  const code = 'BND' + randomBytes(4).toString('hex').toUpperCase(), tok = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO invite_codes (code, owner_id, created_at, used_at, pass, tos_at, tos_version) VALUES (?,NULL,?,?,?,?,?)')
    .run(code, Date.now(), Date.now(), createHash('sha256').update(tok).digest('hex'), Date.now(), TOS_VERSION);
  codes.push(code);
  return 'jsi_pass=' + tok + '; jsi_age=18';
}
const GATE = freshPass();
const get = async (p) => { const r = await fetch(BASE + p, { headers: { Cookie: GATE, Accept: 'application/json' } }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
try {
  let r = await get('/api/token/bundlers?token=nope');
  check('GET /api/token/bundlers refuses an address that is not one', r.status === 400, r.status);
  const nobody = '0x' + randomBytes(20).toString('hex'); tokens.push(nobody);
  r = await get('/api/token/bundlers?token=' + nobody);
  check('  ...a token with no pool the site knows answers "unknown" — no read, no guess', r.status === 200 && r.j.status === 'unknown' && r.j.bundlers === null && r.j.summary === null, JSON.stringify(r.j));
  check('  ...and nothing was queued or stored for it', !db.prepare('SELECT 1 FROM bundle_scans WHERE token_addr = ?').get(nobody));
  // a stored read is served as it is, with the explorer to link wallets and transactions
  if (launchData) {
    const tok = '0x' + randomBytes(20).toString('hex'), pr = '0x' + randomBytes(20).toString('hex'); tokens.push(tok);
    const d = { ...launchData, token: tok, pair: pr, readAt: Date.now() - 1000 };
    db.prepare("INSERT INTO bundle_scans (token_addr, pair_addr, status, data, summary, calls, started_at, finished_at, retry_at) VALUES (?,?,'done',?,?,?,?,?,?)")
      .run(tok, pr, JSON.stringify(d), JSON.stringify({ bundlers: 1 }), d.calls, Date.now() - 2000, Date.now() - 1000, Date.now() + 3600e3);
    r = await get('/api/token/bundlers?token=' + tok.toUpperCase().replace('0X', '0x'));
    check('  ...a stored read comes back whole: status, every bundler and wallet, the read time, the explorer', r.status === 200 && r.j.status === 'done' && r.j.bundlers.length === 1 && r.j.bundlers[0].wallets.length === launchData.bundlers[0].wallets.length && r.j.scannedAt === d.readAt && /^https:\/\//.test(r.j.explorer) && !r.j.refreshing, JSON.stringify({ s: r.j && r.j.status, n: r.j && r.j.bundlers && r.j.bundlers.length, x: r.j && r.j.explorer }));
    check('  ...the answer carries the same summary every token row carries (so the card can be redrawn from it), with what was read', r.j.summary && r.j.summary.bundlers === 1 && r.j.summary.wallets === launchData.bundlers[0].wallets.length && r.j.summary.buyTxs === launchData.buyTxs && r.j.summary.transfers === launchData.transfers, JSON.stringify(r.j && r.j.summary));
    check('  ...a fresh read is not queued again by looking at it', db.prepare('SELECT status FROM bundle_scans WHERE token_addr = ?').get(tok).status === 'done');
    // older than VIEW_TTL: served as it stands, with a fresh read queued at the front
    db.prepare('UPDATE bundle_scans SET finished_at = ? WHERE token_addr = ?').run(Date.now() - 2 * 3600e3, tok);
    r = await get('/api/token/bundlers?token=' + tok);
    check('  ...an old read is still served, marked refreshing, while a fresh one is queued', r.status === 200 && r.j.refreshing === true && r.j.bundlers.length === 1 && /queued|running|failed/.test(db.prepare('SELECT status FROM bundle_scans WHERE token_addr = ?').get(tok).status), JSON.stringify({ ref: r.j && r.j.refreshing }));
  }
  r = { j: null };
} catch (e) { check('the API section ran to the end', false, e && e.stack); }

// the row summary: informational only — it changes no score and no verdict
try {
  const body = grab(/function applyBundleFlags\(e, r\) \{[\s\S]*?\n\}\n/, 'applyBundleFlags');
  check('every token row carries the bundle summary (applyRisk and the cached-pair rescore both apply it)', (SRC.match(/applyBundleFlags\((e|pair), (r|pair\.risk)\);/g) || []).length === 2);
  check('  ...and it never touches the score, the triage or a risk flag', !/health|triage|RISK\[|dataKnown|sniperOk/.test(body));
  check('  ...it reads only the three small columns it needs, never the full read', /function bundleFlagsRow\(token\) \{\s*\n\s*try \{ return db\.prepare\('SELECT status, summary, finished_at FROM bundle_scans WHERE token_addr = \?'\)/.test(SRC) && /const row = bundleFlagsRow\(e\.token\.address\);/.test(body));
  const ctx = vm.createContext({ JSON, bundleFlagsRow: (t) => ({ status: 'done', summary: JSON.stringify({ bundlers: 2, wallets: 7, tookPct: 12.5 }), finished_at: 5 }) });
  vm.runInContext(body + 'this.f = applyBundleFlags;', ctx);
  const r1 = {}; ctx.f({ token: { address: '0x1' } }, r1);
  const ctx2 = vm.createContext({ JSON, bundleFlagsRow: () => null }); vm.runInContext(body + 'this.f = applyBundleFlags;', ctx2);
  const r2 = {}; ctx2.f({ token: { address: '0x1' } }, r2);
  check('  ...a read token shows its figures; an unread one says "unscanned" with no count (not zero)', r1.bundles.bundlers === 2 && r1.bundles.status === 'done' && r1.bundles.scannedAt === 5 && r2.bundles.status === 'unscanned' && r2.bundles.bundlers === null, JSON.stringify([r1, r2]));
  check('the sweep covers every token on the site: $SEND and $GWC first, then every token with a pool, never-read first, one at a time', /function bundleSweepPick\(\) \{\s*\n\s*for \(const k of \['SEND', 'GWC'\]\)/.test(SRC) && /FROM sniper_scans s LEFT JOIN bundle_scans b ON b\.token_addr = s\.token_addr\s*\n\s*WHERE s\.pair_addr IS NOT NULL/.test(SRC) && /bundleFeedTimer = setInterval\(\(\) => \{ try \{ if \(!bundleQueue\.length\) bundleSweepPick\(\); \} catch \{\} \}, BUND\.FEED_GAP_MS\);/.test(SRC));
  check('  ...and a bundle scan never runs alongside a block-0 scan (one chain scan at a time)', /async function runBundleQueue\(\) \{\s*\n\s*if \(bundleScanning \|\| sniperScanning\) return;/.test(SRC) && /async function runSniperQueue\(\) \{\s*\n\s*if \(sniperScanning \|\| bundleScanning\) return;/.test(SRC));
} catch (e) { check('the summary section ran to the end', false, e && e.stack); }

// "active for all tokens": the queue, the runner and the sweep, run against a real database (in memory, built from the
// server's own table definitions), with the chain scan stubbed — what is picked, in what order, and what is never skipped
try {
  const mem = new DatabaseSync(':memory:');
  mem.exec(grab(/CREATE TABLE IF NOT EXISTS sniper_scans \([\s\S]*?\n\);/, 'sniper_scans DDL') + grab(/CREATE TABLE IF NOT EXISTS bundle_scans \([\s\S]*?\n\);/, 'bundle_scans DDL'));
  let T0 = 1e12;
  const scans = [];
  const qctx = vm.createContext({ db: mem, JSON, Math, Number, String, Set, Array, Object, Promise, Error, console,
    now: () => T0, lcAddr: (a) => String(a || '').toLowerCase(), setTimeout: (f) => { f(); return { unref() {} }; },
    TOK: { SEND: '0x' + '5e'.repeat(20), GWC: '0x' + '6c'.repeat(20) }, OG_PAIR: { SEND: '0x' + '5f'.repeat(20), GWC: '0x' + '6d'.repeat(20) },
    sniperQueue: [], sniperScanning: false, ledgerCoolUntil: 0,
    scanBundles: async (t) => { scans.push(t); if (qctx.failNext) { qctx.failNext = false; throw new Error('fetch failed'); } return { capped: false, notes: [], head: 100000000, lastBlock: qctx.lastBlock, calls: 7, totals: { bundlers: 0 }, supply: '1', bundlers: [] }; },
    bundleSummary: () => ({ bundlers: 0 }) });
  vm.runInContext(grab(/const BUND = \{[\s\S]*?\n\};\n/, 'BUND') + grab(/function bundleRow\(token\) \{[\s\S]*?\n\}\n/, 'bundleRow') +
    grab(/const bundleQueue = \[\];[^\n]*\nlet bundleScanning = false;\n/, 'queue state') +
    grab(/function queueBundleScan\(token, pair, front\) \{[\s\S]*?\n\}\n/, 'queueBundleScan') + grab(/async function runBundleQueue\(\) \{[\s\S]*?\n\}\n/, 'runBundleQueue') +
    grab(/function bundleSweepPick\(\) \{[\s\S]*?\n\}\n/, 'bundleSweepPick') +
    'this.q = queueBundleScan; this.run = runBundleQueue; this.pick = bundleSweepPick; this.queue = bundleQueue; this.BUND = BUND;', qctx);
  const A2 = (n) => '0x' + n.toString(16).padStart(40, '0');
  const tk = { t1: A2(0x101), t2: A2(0x102), t3: A2(0x103), t4: A2(0x104), t5: A2(0x105) };
  for (const [k, t] of Object.entries(tk)) mem.prepare('INSERT INTO sniper_scans (token_addr, pair_addr, status, block0) VALUES (?,?,?,?)').run(t, A2(0x900 + Number(k.slice(1))), 'done', k === 't4' ? null : 5);
  const put = (t, status, fin, retry) => mem.prepare('INSERT OR REPLACE INTO bundle_scans (token_addr, pair_addr, status, finished_at, retry_at, data, attempts) VALUES (?,?,?,?,?,?,0)').run(t, A2(0x999), status, fin, retry, status === 'failed' ? null : '{}');
  put(tk.t2, 'done', T0 - 9e7, T0 - 1);        // read long ago, due again
  put(tk.t3, 'done', T0 - 1e6, T0 + 3600e3);   // read recently, not due
  put(tk.t5, 'failed', T0 - 5e7, T0 - 1);      // failed, its wait is over
  // $SEND and $GWC go first, before anything else on the site
  qctx.pick();
  check('the sweep starts with $SEND (then $GWC): never read, they go first', qctx.queue.length === 1 && qctx.queue[0].token === qctx.TOK.SEND && qctx.queue[0].front === false, JSON.stringify(qctx.queue));
  qctx.queue.length = 0;
  put(qctx.TOK.SEND, 'done', T0, T0 + 3600e3); put(qctx.TOK.GWC, 'done', T0, T0 + 3600e3);
  const picked = [];
  for (let i = 0; i < 8; i++) {
    qctx.queue.length = 0;
    if (!qctx.pick()) break;
    const t = qctx.queue[0].token; picked.push(t);
    mem.prepare("UPDATE bundle_scans SET status = 'done', finished_at = ?, retry_at = ? WHERE token_addr = ?").run(T0, T0 + 3600e3, t);
  }
  const name = (t) => Object.keys(tk).find((k) => tk[k] === t) || t;
  check('  ...then every token with a pool takes its turn: never read first (including one with no block 0), then the oldest read; one not due is never picked, and then it rests', /^(t1,t4|t4,t1),t2,t5$/.test(picked.map(name).join()), picked.map(name).join());   // t2 was read longest ago (before t5)
  // the runner: a quiet token rests 48 h, an active one 6 h; failures back off, capped at 8×
  qctx.queue.length = 0; T0 += 1000;
  qctx.lastBlock = 100000000 - qctx.BUND.QUIET_BLOCKS - 5;
  qctx.q(tk.t3, A2(0x903), true); await qctx.run();
  let row = mem.prepare('SELECT * FROM bundle_scans WHERE token_addr = ?').get(tk.t3);
  check('the runner: a viewer\'s token is read at once; with no transfer for ~3 days it is not swept again for ' + (qctx.BUND.QUIET_TTL / 3600e3) + ' h', scans.at(-1) === tk.t3 && row.status === 'done' && row.retry_at === T0 + qctx.BUND.QUIET_TTL, JSON.stringify(row));
  qctx.lastBlock = 100000000 - 10; T0 += qctx.BUND.VIEW_TTL + 1;   // its last read is older than a viewer's 30 minutes
  qctx.q(tk.t1, A2(0x901), true); await qctx.run();
  row = mem.prepare('SELECT * FROM bundle_scans WHERE token_addr = ?').get(tk.t1);
  check('  ...an active token is swept again after ' + (qctx.BUND.TTL / 3600e3) + ' h', row.retry_at === T0 + qctx.BUND.TTL);
  mem.prepare('UPDATE bundle_scans SET attempts = 9 WHERE token_addr = ?').run(tk.t1);
  T0 += qctx.BUND.VIEW_TTL + 1; qctx.failNext = true;
  qctx.q(tk.t1, A2(0x901), true); await qctx.run();
  row = mem.prepare('SELECT * FROM bundle_scans WHERE token_addr = ?').get(tk.t1);
  check('  ...a failure keeps the last good read, says the node did not answer, and waits at most 8 × ' + (qctx.BUND.RETRY_MS / 60e3) + ' min (not 128×)', row.status === 'failed' && row.data && JSON.parse(row.data).calls === 7 && /the chain node did not answer/.test(row.reason) && row.retry_at === T0 + 8 * qctx.BUND.RETRY_MS, JSON.stringify({ s: row.status, r: row.reason, wait: (row.retry_at - T0) / 60e3 }));
  T0 += qctx.BUND.RETRY_MS - 5;
  check('  ...a viewer cannot re-ask a failed token until ' + (qctx.BUND.RETRY_MS / 60e3) + ' min have passed', qctx.q(tk.t1, A2(0x901), true) === false);
  T0 += 10;
  check('  ...and can after that, whatever the sweep\'s longer wait says', qctx.q(tk.t1, A2(0x901), true) === true && qctx.queue[0].token === tk.t1);
  qctx.queue.length = 0;
  // the sweep waits while block-0 scans are queued or the node is refusing this address; a viewer's read does not
  mem.prepare('UPDATE bundle_scans SET retry_at = ? WHERE token_addr = ?').run(T0 - 1, tk.t2);
  qctx.q(tk.t2, A2(0x902), false);
  qctx.sniperQueue.push({ token: 'x' }); const before = scans.length;
  await qctx.run();
  check('the sweep\'s own read waits while a block-0 scan is queued (one shared node)', scans.length === before && qctx.queue.length === 1);
  qctx.sniperQueue.length = 0; qctx.ledgerCoolUntil = T0 + 60e3;
  await qctx.run();
  check('  ...and while the node is refusing this address', scans.length === before && qctx.queue.length === 1);
  qctx.q(tk.t4, A2(0x904), true);
  await qctx.run();
  check('  ...but a viewer\'s read goes to the front and runs', scans.length === before + 1 && scans.at(-1) === tk.t4);
  check('the timers run the queue every 15 s and add one swept token a minute into an empty queue', /const bundleTimer = setInterval\(\(\) => \{ runBundleQueue\(\)\.catch\(\(\) => \{\}\); \}, 15 \* 1000\);/.test(SRC) && /bundleFeedTimer = setInterval\(\(\) => \{ try \{ if \(!bundleQueue\.length\) bundleSweepPick\(\); \} catch \{\} \}, BUND\.FEED_GAP_MS\);/.test(SRC));
  mem.close();
} catch (e) { check('the queue section ran to the end', false, e && e.stack); }

// the panel: every bundler, and behind its pop-down every wallet with what it holds and sold
try {
  const JS = PUB('bundlers.js');
  const win = {};
  const ctx = vm.createContext({ window: win, document: { querySelectorAll: () => [], addEventListener() {}, documentElement: {} }, BigInt, Number, Math, String, JSON, Date, isFinite, Array, Object, Set, Map, Promise });
  vm.runInContext(JS, ctx);
  const R = win.BUNDLERS && win.BUNDLERS.render;
  check('bundlers.js exposes its renderer and fills every .np-bd placeholder, as block0.js does .np-b0', typeof R === 'function' && /querySelectorAll\('\.np-bd\[data-token\]'\)/.test(JS) && /n\.matches\('\.np-bd\[data-token\]'\)/.test(JS));
  if (launchData) {
    const html = R({ status: 'done', ...launchData, scannedAt: 1e12, explorer: 'https://robinhoodchain.blockscout.com' });
    const b = launchData.bundlers[0];
    check('  ...a token with a bundle: how many bundlers and wallets, then the took / still hold / sold / P&L tiles', /<b>1 bundler<\/b> found, with <b>35 wallets<\/b>/.test(html) && /of supply they took in their bundles/.test(html) && /of supply they still hold/.test(html) && /of supply they sold to the pool/.test(html) && /their total P&amp;L, WETH/.test(html), html.slice(0, 400));
    const list = (html.split('<ul class="bd-wl-list">')[1] || '').split('</ul>')[0];
    check('  ...each bundler opens to ALL its wallets, every one linked to the explorer with what it holds and has sold', (list.match(/<li class="bd-wl">/g) || []).length === b.wallets.length && b.wallets.every((w) => list.includes('/address/' + w.addr)) && (list.match(/holds now <b>/g) || []).length === b.wallets.length && (list.match(/sold to the pool <b>/g) || []).length === b.wallets.length, (list.match(/<li class="bd-wl">/g) || []).length + ' rows');
    check('  ...the pop-down is labelled and described (data-tip), and the launch transaction is linked', /<summary data-tip="[^"]+">All 35 wallets — what each holds and sold<\/summary>/.test(html) && html.includes('/tx/' + b.txs[0]));
    const dust = b.wallets.find((w) => BigInt(w.holds) > 0n && BigInt(w.holds) * 100000n < BigInt(launchData.supply));
    check('  ...a dust holding reads "<0.001%" (escaped), never a rounded 0%', dust && list.includes(dust.addr) && /holds now <b>&lt;0\.001%<\/b>/.test(list), dust && dust.holds);
    // every figure, against the numbers worked out from the raw logs in section 2 (not the scan's own output)
    const X = launchX, fmt = (raw) => { const n = Number(raw * 10000000n / X.supply) / 100000; return n === 0 ? (raw > 0n ? '&lt;0.001%' : '0%') : n < 0.001 ? '&lt;0.001%' : (n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(3)) + '%'; };
    check('  ...the tiles show the took / still hold / sold worked out from the logs (' + fmt(X.took) + ' / ' + fmt(X.heldNow) + ' / ' + fmt(X.xSold) + ')', html.includes('<div class="b0-tile"><b>' + fmt(X.took) + '</b><span>of supply they took') && html.includes('<div class="b0-tile"><b>' + fmt(X.heldNow) + '</b><span>of supply they still hold') && html.includes('<div class="b0-tile"><b>' + fmt(X.xSold) + '</b><span>of supply they sold to the pool'), html.slice(0, 600));
    check('  ...the bundler line says the same: took, still holds, sold', html.includes('took <b>' + fmt(X.took) + '</b>') && html.includes('still holds <b>' + fmt(X.heldNow) + '</b>') && html.includes('sold to the pool <b>' + fmt(X.xSold) + '</b>'));
    const rows = list.split('<li class="bd-wl">').slice(1);
    const rowBad = rows.filter((r2) => { const a = (r2.match(/\/address\/(0x[0-9a-f]{40})/) || [])[1]; if (!a) return true; const h = X.bal.get(a) || 0n, sd = X.xSoldBy.get(a) || 0n; return !r2.includes('holds now <b>' + fmt(h) + '</b>') || !r2.includes('sold to the pool <b>' + fmt(sd) + '</b>'); });
    check('  ...each wallet\'s own row shows ITS holding (its balance from the logs) and ITS sales (from the Swap logs) — all ' + rows.length, rows.length === X.members.size && rowBad.length === 0, rowBad.slice(0, 2).join(' || ').slice(0, 400));
    // a gain or loss: a sign and a word on BOTH figures, not colour alone
    const sign = X.xPnlNegative ? '−' : '+', word2 = X.xPnlNegative ? 'down' : 'up', cls = X.xPnlNegative ? 'b0-down' : 'b0-up';
    check('  ...the total P&L tile has its sign and the word (' + word2 + '), and so does the bundler\'s own P&L', new RegExp('<div class="b0-tile"><b class="' + cls + '">' + sign + '[0-9.]+</b><span>their total P&amp;L, WETH \\(' + word2 + '\\)</span>').test(html) && new RegExp('P&amp;L <b class="' + cls + '">' + sign + '[0-9.]+</b> <i>WETH ' + word2 + '</i>').test(html), (html.match(/their total P&amp;L[^<]*/) || [''])[0]);
  }
  if (unreadData) {
    // one balance unreadable: every figure that depends on it reads "—", never 0%
    const u = R({ status: 'done', ...unreadData, scannedAt: 1e12, explorer: 'https://robinhoodchain.blockscout.com' });
    const ub = unreadData.bundlers[0], uw = ub.wallets.find((w) => w.holds === null);
    const urow = u.split('<li class="bd-wl">').find((r2) => uw && r2.includes('/address/' + uw.addr)) || '';
    check('  ...with one balance unread: the still-hold tile, the bundler\'s holdings, that wallet\'s holding and both P&L figures read "—", never 0%', u.includes('<div class="b0-tile"><b>—</b><span>of supply they still hold') && u.includes('still holds <b>—</b>') && urow.includes('holds now <b>—</b>') && /<div class="b0-tile"><b class="">—<\/b><span>their total P&amp;L, WETH<\/span>/.test(u) && /P&amp;L <b class="">—<\/b> <i>WETH<\/i>/.test(u), urow.slice(0, 300));
  }
  const none = R({ status: 'done', supply: '1000', quote: { symbol: 'WETH', decimals: 18 }, fromBlock: 5, buyTxs: 12, transfers: 40, bundlers: [], totals: { bundlers: 0 }, notes: [], scannedAt: 1e12 });
  check('  ...no bundle: "✔ No bundlers" first, then what was read (12 buys, 40 transfers since the pool first traded), and that it is not the same as safe', /<p class="bd-none-h">✔ No bundlers<\/p><p>In 12 buys and 40 transfers since this pool first traded — no wallet bought and moved tokens in the same block\. That is not the same as safe\.<\/p>/.test(none), none);
  const noneCapped = R({ status: 'partial', capped: true, supply: '1000', quote: { symbol: 'WETH', decimals: 18 }, fromBlock: 5, buyTxs: 3, transfers: 9, bundlers: [], totals: { bundlers: 0 }, notes: ['x'], scannedAt: 1e12 });
  const never = R({ status: 'done', supply: '1000', quote: { symbol: 'WETH', decimals: 18 }, fromBlock: null, buyTxs: 0, transfers: null, bundlers: [], totals: { bundlers: 0 }, notes: ['This pool has never traded — nobody has bought yet.'], scannedAt: 1e12 });
  check('  ...a pool that never traded: "✔ No bundlers — nobody has bought yet", never a count of transfers it did not read', /✔ No bundlers<\/p><p>This pool has never traded, so nobody has bought yet/.test(never) && !/0 transfers/.test(never) && !/Every buy and transfer since this pool first traded was read/.test(never));
  check('  ...and a read that could not cover everything says "No bundlers" only of the part it read', /✔ No bundlers/.test(noneCapped) && /In the part of this token’s history that could be read/.test(noneCapped) && !/since this pool first traded/.test(noneCapped));
  check('  ...not read yet, failed, or no pool: each says so, and none of them is a pass', /check back in a moment/.test(R({ status: 'queued', bundlers: null })) && /not a pass/.test(R({ status: 'failed', reason: 'x', bundlers: null })) && /No indexed pool/.test(R({ status: 'unknown', bundlers: null })));
  const stale = R({ status: 'failed', lastFailed: 'the node refused', supply: '1000', quote: { symbol: 'WETH', decimals: 18 }, buyTxs: 1, transfers: 1, bundlers: [], totals: { bundlers: 0 }, scannedAt: 1e12 });
  check('  ...a newer read that failed is named, and the older read it shows is dated', /latest read could not finish \(the node refused\)/.test(stale));
  // every surface that shows a token's details shows this panel: the same pages and renderers as block 0
  const pages = ['community', 'squad', 'newpairs', 'u', 'support', 'watchlist', 'wall'];
  check('every page that loads block0.js loads bundlers.js right after it', pages.every((p) => /<script src="\/?block0\.js"><\/script>\n<script src="\/?bundlers\.js"><\/script>/.test(PUB(p + '.html'))) &&
    readFileSync(path.join(ROOT, 'public', 'newpairs.html'), 'utf8').length > 0);
  const others = (await import('node:fs')).readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html') && /block0\.js/.test(PUB(f)));
  check('  ...and no page loads block0.js without it', others.every((f) => /bundlers\.js/.test(PUB(f))), others.join(','));
  const NP = PUB('newpairs.js'), WL = PUB('watchlist.js');
  check('every token-detail renderer that has a block-0 placeholder has a bundler one next to it (dashboard, list body, watchlist)', (NP.match(/class="np-b0"/g) || []).length === (NP.match(/class="np-bd"/g) || []).length && (WL.match(/class="np-b0"/g) || []).length === (WL.match(/class="np-bd"/g) || []).length && /cBlock0 \+ cBundles/.test(NP));
} catch (e) { check('the panel section ran to the end', false, e && e.stack); }

// the bundler card: "None" said plainly, and redrawn in place when a read that was running comes back
try {
  const NPJS = PUB('newpairs.js');
  const lift = (re, what) => { const m = NPJS.match(re); if (!m) throw new Error('could not lift ' + what); return m[0]; };
  const cctx = vm.createContext({ Number, Math, String, Object });
  vm.runInContext(lift(/  const npNum = [^\n]+\n/, 'npNum') + lift(/  function pctPlain\(n\) \{[^\n]+\n/, 'pctPlain') + lift(/  const UNREAD = [^\n]+\n/, 'UNREAD') +
    lift(/  function bundleSummaryHTML\(b\) \{[\s\S]*?\n  \}\n/, 'bundleSummaryHTML') + lift(/  function bundleAsideHTML\(b\) \{[\s\S]*?\n  \}\n/, 'bundleAsideHTML') +
    'this.sum = bundleSummaryHTML; this.aside = bundleAsideHTML;', cctx);
  const zero = cctx.sum({ status: 'done', bundlers: 0, wallets: 0, buyTxs: 1957, transfers: 10386 });
  check('the card with no bundlers: "None found", what it was read from (buys · transfers), and "✔ No bundlers" in words', /<dt>Bundlers<\/dt><dd>None found<\/dd>/.test(zero) && /<dt>Read<\/dt><dd>1,957 buys · 10,386 transfers<\/dd>/.test(zero) && /✔ <b>No bundlers\.<\/b>/.test(zero) && /not the same as safe/.test(zero), zero);
  check('  ...its heading says "None"; with bundlers it says how many; unread it says so — never a 0 for a read not made', cctx.aside({ bundlers: 0 }) === '<b>None</b>' && cctx.aside({ bundlers: 3 }) === '<b>3</b> found' && cctx.aside({ bundlers: null, status: 'pending' }) === 'not read yet' && cctx.aside({ status: 'unknown', bundlers: null }) === 'no pool');
  check('  ...unread says the read is under way and is not a pass; no pool says there are no buys to read', /still an open question, not a pass/.test(cctx.sum({ status: 'pending', bundlers: null })) && /No pool the site knows trades this token/.test(cctx.sum({ status: 'unknown', bundlers: null })) && !/None found/.test(cctx.sum({ bundlers: null })));
  check('the dashboard card wraps its summary and heading in placeholders bundlers.js can redraw, for the same token', /dashCard\(u, 'bundles', hc, '📦 Bundlers', '<div class="np-bd-sum" data-token="' \+ esc\(t\.address\) \+ '">' \+ bundleSummaryHTML\(r\.bundles\) \+ '<\/div>',/.test(NPJS) && /'<span class="np-bd-aside" data-token="' \+ esc\(t\.address\) \+ '">' \+ bundleAsideHTML\(r\.bundles\) \+ '<\/span>'\);/.test(NPJS) && /bundleSummaryHTML,[^\n]*\n\s*bundleAsideHTML,/.test(NPJS));
  // drive bundlers.js with a fake page: the panel, the card's summary and its heading, for a token whose read lands as "none"
  const mkEl = (cls, token) => ({ cls, dataset: {}, innerHTML: '', isConnected: true, getAttribute: (k) => (k === 'data-token' ? token : null) });
  const TOK = '0xAbC0000000000000000000000000000000000001';
  const panel = mkEl('np-bd', TOK), sumEl = mkEl('np-bd-sum', TOK.toLowerCase()), asideEl = mkEl('np-bd-aside', TOK), other = mkEl('np-bd-sum', '0x' + '9'.repeat(40));
  other.innerHTML = 'untouched';
  const els = [panel, sumEl, asideEl, other];
  const timers = [];
  let answer = { ok: true, status: 200, body: { status: 'done', token: TOK.toLowerCase(), supply: '1000', quote: { symbol: 'WETH', decimals: 18 }, buyTxs: 40, transfers: 120, bundlers: [], totals: { bundlers: 0 }, notes: [], scannedAt: 1e12, summary: { bundlers: 0, wallets: 0, buyTxs: 40, transfers: 120, capped: false } } };
  const asks = [];
  const fdoc = { querySelectorAll: (sel) => els.filter((e) => sel.startsWith('.' + e.cls + '[')), addEventListener() {}, documentElement: {} };
  const win = { NPCard: { bundleSummaryHTML: cctx.sum, bundleAsideHTML: cctx.aside } };
  const bctx = vm.createContext({ window: win, document: fdoc, BigInt, Number, Math, String, JSON, Date, isFinite, Array, Object, Set, Map, Promise, encodeURIComponent, Error,
    setTimeout: (f, ms) => { timers.push(ms); return 0; },
    fetch: async (u) => { asks.push(u); const a = answer; return { ok: a.ok, status: a.status, json: async () => a.body }; } });
  vm.runInContext(PUB('bundlers.js'), bctx);
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  check('  ...one request for the token fills the panel with "✔ No bundlers" and redraws the card\'s summary and heading in place', asks.length === 1 && /✔ No bundlers/.test(panel.innerHTML) && /None found/.test(sumEl.innerHTML) && /<dt>Read<\/dt><dd>40 buys · 120 transfers<\/dd>/.test(sumEl.innerHTML) && asideEl.innerHTML === '<b>None</b>' && panel.dataset.bdDone === '1', JSON.stringify({ asks, sum: sumEl.innerHTML.slice(0, 80), aside: asideEl.innerHTML }));
  check('  ...a card for a different token is left alone (the address is matched whatever its letter case)', other.innerHTML === 'untouched');
  // a refusal (429): said so, asked again later — never shown as an answer
  const p2 = mkEl('np-bd', '0x' + '7'.repeat(40)); els.push(p2); answer = { ok: false, status: 429, body: { error: 'slow down' } };
  win.BUNDLERS.mount({ querySelectorAll: () => [p2] });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  check('  ...a refused check (429) says "too many checks… trying again shortly", is asked again later, and claims nothing', /Too many checks from here at once/.test(p2.innerHTML) && !/No bundlers/.test(p2.innerHTML) && timers.includes(15000) && p2.dataset.bdDone !== '1', JSON.stringify({ html: p2.innerHTML, timers }));
} catch (e) { check('the card section ran to the end', false, e && e.stack); }

// clean up everything this suite made
try {
  for (const t of tokens) db.prepare('DELETE FROM bundle_scans WHERE token_addr = ?').run(t);
  for (const c of codes) db.prepare('DELETE FROM invite_codes WHERE code = ?').run(c);
  check('cleanup: no bundle rows or passes left behind', tokens.every((t) => !db.prepare('SELECT 1 FROM bundle_scans WHERE token_addr = ?').get(t)) && codes.every((c) => !db.prepare('SELECT 1 FROM invite_codes WHERE code = ?').get(c)));
} catch (e) { check('cleanup ran', false, e && e.stack); }
db.close();

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !x ? '' : '  — ' + x)); if (ok) pass++; }
console.log(`${pass}/${results.length} passed`);
