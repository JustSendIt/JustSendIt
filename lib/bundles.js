'use strict';
/* ===== Bundlers: who bought and moved tokens in the same block =========================================
   Owner, 2026-10-17: "in the on-chain token details, pull all buy side transactions and transfers and determine
   whether there is a bundler in token, how many bundlers there are and how much they still hold vs sold and their
   PNL" — then: "only pick out transactions that bought and transferred in the same block to determine bundlers",
   and "allow the user to expand and see all the wallets that the bundler has in the token and show … how much each
   wallet holds and how much each has sold".

   This file is the pure part: it takes every Transfer the token ever emitted and every Swap and Mint its pool ever
   emitted, and says which blocks hold a bundle. No chain reads happen here (server.js reads the logs, the balances
   and the price), so the rules are tested exactly as they run (tests/bundlers.mjs).

   A bundle is a buy and a transfer in the same block, tied together by the same wallet or the same transaction:
     · 'block' — a wallet bought from the pool and, in that same block, sent tokens on to other wallets;
     · 'tx'    — one transaction bought from the pool AND moved somebody's own tokens: to another wallet, or into the
                 pool as liquidity (a launch that funds the pool and buys for several wallets in one go);
     · 'split' — a contract took the pool's tokens and, inside that same transaction, handed them to two or more
                 wallets (a bundler's buy-and-distribute contract).

   Measured on the chain before any of this was written ($SEND's 10,367 transfers, $GWC's 5,402, 30 recent launches):
   most buys do NOT go straight from the pool to the buyer. A router takes the pool's tokens and passes them on in the
   same transaction, often paying a slice to a trading bot's fee wallet on the way (168 of $SEND's 1,955 buys did).
   Read naively, every router "bought and transferred in the same block" on every buy. So, per transaction, the
   tokens are followed to where they END: a contract that only passes the pool's tokens through is the buy's
   plumbing, and the wallet the tokens stop at is the buyer. A router (it carried buys in ROUTER_TXS or more
   transactions of this token) and a fee wallet (it took a side slice alongside FEE_PARTIES or more different buyers
   or sellers) are never a bundle, and never link two bundles together.

   Sold and paid are the pool's own Swap events in the quote asset (WETH or USDG) — exact, with no historical dollar
   price anywhere. A transaction that paid several wallets shares its cost out by the tokens each one received. */

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';   // Swap(address,uint256,uint256,uint256,uint256,address)
const MINT_TOPIC = '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f';   // Mint(address,uint256,uint256): liquidity added
const LIMITS = {
  SPLIT_SHARE_PCT: 10n,  // a 'split' wallet took at least this share of what the transaction's buyers took (a fee slice is smaller)
  ROUTER_TXS: 3,         // a contract that carried single-buyer buys for this many DIFFERENT buyers of the token is a router
  ROUTER_SPLIT_WALLETS: 3, // one buy a router carried counts as a split only when it reached this many wallets (two may be a fee)
  FEE_PARTIES: 3,        // a wallet that took a side slice alongside this many different buyers or sellers is a fee wallet; an address
                         // that was sent tokens by this many different wallets is a hub (a staking, lock or exchange address)
  CLOSURE_DEPTH: 3,      // in a 'block' bundle, tokens are followed this many hops onward inside the same block
  MAX_EVENTS: 5000,      // bundle events kept for one token (any beyond are counted, and the read says it is incomplete) — high, because
                         // the server drops events led by another pool only AFTER the fold, and pool noise must not crowd real bundles out
};

const lc = (a) => String(a || '').toLowerCase();
const topicToAddr = (t) => lc('0x' + String(t).slice(26));
const add = (m, k, v) => m.set(k, (m.get(k) || 0n) + v);
const hexNum = (h) => parseInt(h, 16);
function word(data, i) { const s = String(data || '').replace(/^0x/, ''); const w = s.slice(i * 64, i * 64 + 64); return w.length === 64 ? BigInt('0x' + w) : null; }
const cmpBig = (a, b) => (b > a ? 1 : b < a ? -1 : 0);   // largest first
const sumMap = (m) => { let t = 0n; for (const v of m.values()) t += v; return t; };
function memberSums(m) { m.bought = sumMap(m.buys); m.received = sumMap(m.recv); m.moved = sumMap(m.moves); return m; }

/* One transaction, in log order: where did the pool's tokens end up, and whose own tokens moved where?
   Each address holds, inside this transaction, three kinds of token: the pool's (paid out by a buy, `d` straight from
   the pool or `c` carried there by a contract), other wallets' own (`held`, by origin), and its own. Passing tokens on
   spends them in that order, so a router that is handed the pool's tokens and forwards them forwards the POOL's
   tokens — never "its own" — and a wallet → router → pool sale is still the wallet's sale. */
function decomposeTx(logs, pair, isSys) {
  const pool = new Map();       // addr -> { d, c }: the pool's tokens it holds right now
  const held = new Map();       // addr -> Map(origin -> amount): other wallets' own tokens it holds right now
  const carried = new Map();    // contract -> the pool's tokens it passed on to a wallet
  const poolward = new Map();   // origin -> own tokens that reached the pool
  let poolOut = 0n;
  const bucket = (a) => { let b = pool.get(a); if (!b) pool.set(a, b = { d: 0n, c: 0n }); return b; };
  for (const l of logs) {
    const f = l.from, t = l.to, v = l.value;
    if (v === 0n || f === t) continue;
    if (f === pair) { poolOut += v; if (!isSys(t)) bucket(t).d += v; continue; }
    /* a mint, the token's own tax or its swap-and-liquify: nobody's buy and nobody's own tokens. Where they go next is
       still followed (origin: that system address), so a helper the token contract funds and that puts them into the
       pool is never read as somebody moving "their own" tokens in a buy's transaction. */
    if (isSys(f)) { if (t !== pair && !isSys(t)) { let ht = held.get(t); if (!ht) held.set(t, ht = new Map()); ht.set(f, (ht.get(f) || 0n) + v); } continue; }
    let rest = v, fromPool = 0n;
    const b = pool.get(f);
    if (b) for (const k of ['d', 'c']) { if (!rest) break; const n = b[k] < rest ? b[k] : rest; b[k] -= n; rest -= n; fromPool += n; }
    const parts = [];
    const h = held.get(f);
    if (h) for (const [o, a] of h) { if (!rest) break; const n = a < rest ? a : rest; if (!n) continue; h.set(o, a - n); rest -= n; parts.push([o, n]); }
    if (rest) parts.push([f, rest]);
    if (t === pair) { for (const [o, a] of parts) add(poolward, o, a); continue; }
    if (isSys(t)) continue;            // a tax paid to the token contract
    if (fromPool) { bucket(t).c += fromPool; add(carried, f, fromPool); }
    if (parts.length) { let ht = held.get(t); if (!ht) held.set(t, ht = new Map()); for (const [o, a] of parts) if (o !== t) ht.set(o, (ht.get(o) || 0n) + a); }
  }
  const takers = [];
  for (const [a, b] of pool) if (b.d + b.c > 0n) takers.push({ addr: a, v: b.d + b.c, carried: b.c });
  takers.sort((x, y) => cmpBig(x.v, y.v));
  const transfers = [];
  for (const [t, h] of held) for (const [o, a] of h) if (a > 0n && o !== t) transfers.push({ from: o, to: t, v: a });
  return { poolOut, takers, transfers, poolward, carried };
}

/* Every Transfer of the token and every Swap / Mint of its pool → the bundle events and every wallet's flows.
   ctx = { token, pair, tokenIsZero, isSys(addr) }. Throws on a log it cannot decode — never a silent zero. */
function bundleFold(tokenLogs, pairLogs, ctx) {
  const pair = lc(ctx.pair), isSys = ctx.isSys;
  const txs = new Map();        // tx hash -> { block, first, logs, swap }
  for (const l of tokenLogs) {
    if (l.removed) continue;
    if (!l.topics || l.topics.length < 3 || lc(l.topics[0]) !== TRANSFER_TOPIC || !l.data || l.data === '0x') throw new Error('a transfer this reader cannot decode');
    const k = lc(l.transactionHash), b = hexNum(l.blockNumber), i = hexNum(l.logIndex);
    let r = txs.get(k); if (!r) txs.set(k, r = { tx: k, block: b, first: i, logs: [], swap: null });
    if (i < r.first) r.first = i;
    r.logs.push({ i, from: topicToAddr(l.topics[1]), to: topicToAddr(l.topics[2]), value: BigInt(l.data) });
  }
  for (const l of pairLogs) {
    if (l.removed || !l.topics || !l.topics.length) continue;
    const k = lc(l.transactionHash), r = txs.get(k);
    const s = r ? (r.swap || (r.swap = { buyTok: 0n, cost: 0n, soldTok: 0n, proceeds: 0n, mint: false })) : null;
    if (!s) continue;                 // a pool event with no transfer of this token in it (a quote-only Sync, say)
    const t0 = lc(l.topics[0]);
    if (t0 === MINT_TOPIC) { s.mint = true; continue; }
    if (t0 !== SWAP_TOPIC) continue;
    const a0In = word(l.data, 0), a1In = word(l.data, 1), a0Out = word(l.data, 2), a1Out = word(l.data, 3);
    if (a0In == null || a1In == null || a0Out == null || a1Out == null) throw new Error('a swap this reader cannot decode');
    const tokIn = ctx.tokenIsZero ? a0In : a1In, tokOut = ctx.tokenIsZero ? a0Out : a1Out;
    const qIn = ctx.tokenIsZero ? a1In : a0In, qOut = ctx.tokenIsZero ? a1Out : a0Out;
    if (tokOut > 0n) { s.buyTok += tokOut; s.cost += qIn; }
    if (tokIn > 0n) { s.soldTok += tokIn; s.proceeds += qOut; }
  }
  const order = [...txs.values()].sort((a, b) => (a.block - b.block) || (a.first - b.first));

  // pass 1 — each transaction on its own, and who the routers and fee wallets are
  const recs = [];
  const parties = new Map();
  const party = (a, main) => { if (!main || a === main) return; let s = parties.get(a); if (!s) parties.set(a, s = new Set()); s.add(main); };
  for (const r of order) {
    r.logs.sort((a, b) => a.i - b.i);
    const d = decomposeTx(r.logs, pair, isSys);
    const sw = r.swap || { buyTok: 0n, cost: 0n, soldTok: 0n, proceeds: 0n, mint: false };
    let takers = d.takers;
    if (!(sw.buyTok > 0n)) takers = [];   // the pool paid out without a buy swap: liquidity taken out, not a purchase
    else if (d.poolOut > sw.buyTok) takers = takers.map((x) => ({ ...x, v: x.v * sw.buyTok / d.poolOut, carried: x.carried * sw.buyTok / d.poolOut }));   // a buy and a withdrawal in one transaction: only the bought part
    const rec = { tx: r.tx, block: r.block, takers, transfers: d.transfers, poolward: d.poolward, carried: d.carried, sw };
    recs.push(rec);
    if (takers.length) {
      const main = takers[0].addr;
      for (const x of takers.slice(1)) party(x.addr, main);
      for (const t of d.transfers) if (!isSys(t.from)) party(t.to, main);
    }
    if (sw.soldTok > 0n && d.poolward.size) {
      const main = [...d.poolward].sort((a, b) => cmpBig(a[1], b[1]))[0][0];
      for (const t of d.transfers) if (!isSys(t.from)) party(t.to, main);   // a sell tax paid by the seller to a wallet
    }
  }
  const fees = new Set([...parties].filter(([, s]) => s.size >= LIMITS.FEE_PARTIES).map(([a]) => a));
  /* A fee wallet is set aside only in that role — a side slice of someone else's buy, or a recipient of their tokens.
     Its OWN buys (it took the most in that transaction) and its own sends still count: a deployer who is also the
     token's tax wallet and bundles at launch is the bundler most worth showing. */
  const sideTaker = (x, i) => i > 0 && fees.has(x.addr);
  // hubs: sent tokens by FEE_PARTIES or more different wallets (staking, locks, exchange deposits) — never part of a
  // bundle, so they cannot tie unrelated wallets together or have everyone's deposits counted as one bundle's holdings
  const senders = new Map();
  for (const r of recs) for (const t of r.transfers) if (!isSys(t.from) && !isSys(t.to)) { let x = senders.get(t.to); if (!x) senders.set(t.to, x = new Set()); x.add(t.from); }
  const hubs = new Set([...senders].filter(([, x]) => x.size >= LIMITS.FEE_PARTIES).map(([a]) => a));
  /* Routers: a contract that handed the pool's tokens to ONE buyer — and did that for ROUTER_TXS or more DIFFERENT buyers.
     That is what a router is: everyone's way in. A bundler's buy-and-split contract hands each buy to several wallets,
     so it never becomes a "router" however often it does it; a real router carries hundreds of single buys for
     different people, and the odd one where a trading bot's solver took a big slice (seen on $GWC: 25% to 0xaaaaaace)
     changes nothing. */
  const served = new Map();
  for (const r of recs) {
    if (!r.takers.length || !r.carried.size) continue;
    const side = r.takers.filter((x, i) => !isSys(x.addr) && !sideTaker(x, i));
    const total = side.reduce((t, x) => t + x.v, 0n);
    const carriers = [...r.carried].filter(([, v]) => v > 0n).map(([a]) => a);
    const fed = side.filter((x) => (x.carried > 0n || carriers.includes(x.addr)) && x.v * 100n >= total * LIMITS.SPLIT_SHARE_PCT);
    if (fed.length === 1) for (const a of carriers) { if (a === fed[0].addr) continue; let x = served.get(a); if (!x) served.set(a, x = new Set()); x.add(fed[0].addr); }
  }
  const routers = new Set([...served].filter(([, x]) => x.size >= LIMITS.ROUTER_TXS).map(([a]) => a));
  const notMember = (a) => isSys(a) || routers.has(a) || hubs.has(a);
  const realOf = (takers) => takers.filter((x, i) => !notMember(x.addr) && !sideTaker(x, i));
  const eventMove = (t) => !notMember(t.from) && !notMember(t.to) && !fees.has(t.to);

  // pass 2 — every wallet's flows through this pool, and the bundle events, block by block
  const flows = new Map();
  const F = (a) => { let f = flows.get(a); if (!f) flows.set(a, f = { bought: 0n, cost: 0n, sold: 0n, proceeds: 0n, liquidity: 0n, sent: 0n, received: 0n, sentTo: new Map(), buys: 0, sells: 0 }); return f; };
  let buyTxs = 0, sellTxs = 0, firstBuyBlock = null;
  const events = [];
  let eventsDropped = 0;
  const push = (e) => { if (events.length < LIMITS.MAX_EVENTS) events.push(e); else eventsDropped++; };
  /* A member of a bundle event. What it bought, was sent and moved is kept per TRANSACTION (buys by tx hash, transfers by
     tx|from|to), so one buy that two kinds of event both see — a launch transaction that is also a split, a 'tx' bundle
     whose buyer also sent on in that block — is counted once when the events are joined, never twice. The totals are
     worked out from those maps (memberSums), never added up event by event. */
  const member = () => ({ roles: new Set(), buys: new Map(), recv: new Map(), moves: new Map(), bought: 0n, received: 0n, moved: 0n });
  const finish = (members) => { for (const m of members.values()) memberSums(m); return members; };
  for (let i = 0; i < recs.length;) {
    const block = recs[i].block, inBlock = [];
    while (i < recs.length && recs[i].block === block) inBlock.push(recs[i++]);
    const boughtTx = new Map();   // wallet -> Map(tx -> amount) bought in this block
    const sentHere = new Map();   // wallet -> [{ to, v, tx }] own tokens sent to other wallets in this block
    for (const r of inBlock) {
      const sw = r.sw;
      const real = realOf(r.takers), realSet = new Set(real.map((x) => x.addr));
      if (r.takers.length) {
        buyTxs++; if (firstBuyBlock == null) firstBuyBlock = block;
        const denom = (real.length ? real : r.takers).reduce((s, x) => s + x.v, 0n);
        for (const x of r.takers) {
          const f = F(x.addr); f.bought += x.v; f.buys++;
          if ((real.length ? realSet.has(x.addr) : true) && denom > 0n) f.cost += sw.cost * x.v / denom;
        }
        for (const x of real) { let m = boughtTx.get(x.addr); if (!m) boughtTx.set(x.addr, m = new Map()); add(m, r.tx, x.v); }
      }
      let liq = null;
      if (r.poolward.size) {
        const pw = [...r.poolward].filter(([o]) => !isSys(o)), sum = [...r.poolward].reduce((s, [, v]) => s + v, 0n);
        if (sw.soldTok > 0n) sellTxs++;
        for (const [o, v] of pw) {
          const sold = sw.soldTok <= 0n ? 0n : sum <= sw.soldTok ? v : sw.soldTok * v / sum;
          const f = F(o);
          if (sold > 0n) { f.sold += sold; f.sells++; f.proceeds += sw.proceeds * sold / sw.soldTok; }
          if (sw.mint && v > sold) { f.liquidity += v - sold; if (!notMember(o)) (liq || (liq = new Map())).set(o, v - sold); }
        }
      }
      for (const t of r.transfers) {
        const f = F(t.from); f.sent += t.v; add(f.sentTo, t.to, t.v); F(t.to).received += t.v;
        if (!eventMove(t)) continue;
        let l = sentHere.get(t.from); if (!l) sentHere.set(t.from, l = []); l.push({ to: t.to, v: t.v, tx: r.tx });
      }
      // 'tx': this one transaction bought AND moved somebody's own tokens (to a wallet, or into the pool as liquidity)
      const moves = r.transfers.filter(eventMove);
      if (real.length && (moves.length || liq)) {
        const members = new Map();
        const mem = (a, role) => { let m = members.get(a); if (!m) members.set(a, m = member()); m.roles.add(role); return m; };
        for (const x of real) mem(x.addr, 'bought').buys.set(r.tx, x.v);
        const movedBy = new Map();
        for (const t of moves) { const k = r.tx + '|' + t.from + '|' + t.to; mem(t.from, 'sent').moves.set(k, t.v); mem(t.to, 'received').recv.set(k, t.v); add(movedBy, t.from, t.v); }
        if (liq) for (const [o, v] of liq) { mem(o, 'pooled').moves.set(r.tx + '|' + o + '|pool', v); add(movedBy, o, v); }
        const lead = [...movedBy].sort((a, b) => cmpBig(a[1], b[1]))[0][0];
        push({ kind: 'tx', block, txs: [r.tx], lead, members: finish(members) });
      }
      /* 'split': one transaction bought for two or more wallets, each taking SPLIT_SHARE_PCT or more of it — paid straight
         from the pool (a bundler's contract calling the pool once per wallet), or handed out by a contract that took the
         pool's tokens (a buy-and-distribute contract, or a wallet that bought and passed part on). A router hands a buy
         to ONE buyer and a fee wallet's slice is set aside, so an ordinary routed buy is never a split. Led by the
         contract that handed the tokens out when there is one, else by the wallet that took most. Through a ROUTER it
         takes three wallets: what a router hands one second address is its own business (a fee, a solver's cut — seen
         on $GWC at 25%), not the buyer's, but a router paying out to three or more wallets at once is one buy for many. */
      const viaRouter = [...r.carried].some(([a, v]) => v > 0n && routers.has(a));
      if (real.length >= (viaRouter ? LIMITS.ROUTER_SPLIT_WALLETS : 2)) {
        const total = real.reduce((t, x) => t + x.v, 0n);
        const fed = real.filter((x) => x.v * 100n >= total * LIMITS.SPLIT_SHARE_PCT);
        if (fed.length >= (viaRouter ? LIMITS.ROUTER_SPLIT_WALLETS : 2)) {
          const carriers = [...r.carried].filter(([a, v]) => v > 0n && !notMember(a) && !fees.has(a)).sort((a, b) => cmpBig(a[1], b[1]));
          const members = new Map();
          let lead = fed[0].addr;
          if (carriers.length) { lead = carriers[0][0]; const m = member(); m.roles.add('split'); m.moves.set(r.tx + '|' + lead + '|split', carriers[0][1]); members.set(lead, m); }
          for (const x of real) { const m = members.get(x.addr) || member(); m.roles.add('bought'); m.buys.set(r.tx, x.v); members.set(x.addr, m); }
          push({ kind: 'split', block, txs: [r.tx], lead, members: finish(members) });
        }
      }
    }
    // 'block': a wallet that bought in this block AND sent tokens on to other wallets in this block
    for (const [w, buys] of boughtTx) {
      if (!sentHere.has(w)) continue;
      const lead = member(); lead.roles.add('bought'); lead.roles.add('sent');
      for (const [tx, v] of buys) lead.buys.set(tx, v);
      const members = new Map([[w, lead]]);
      const txSet = new Set(buys.keys());
      let frontier = [w];
      for (let hop = 0; hop < LIMITS.CLOSURE_DEPTH && frontier.length; hop++) {
        const next = [];
        for (const a of frontier) {
          for (const s2 of sentHere.get(a) || []) {
            const k = s2.tx + '|' + a + '|' + s2.to;
            txSet.add(s2.tx);
            members.get(a).moves.set(k, s2.v);
            let m = members.get(s2.to);
            if (!m) { members.set(s2.to, m = member()); next.push(s2.to); }
            m.roles.add('received'); m.recv.set(k, s2.v);
            const tb = boughtTx.get(s2.to);
            if (tb) { m.roles.add('bought'); for (const [tx, v] of tb) { m.buys.set(tx, v); txSet.add(tx); } }
          }
        }
        frontier = next;
      }
      push({ kind: 'block', block, txs: [...txSet], lead: w, members: finish(members) });
    }
  }
  return { events, eventsDropped, flows, routers, fees, hubs, buyTxs, sellTxs, firstBuyBlock, transfers: tokenLogs.length };
}

/* Bundle events → bundlers. Events that share a wallet are the same bundler (one actor working across several
   blocks, or one launch with a follow-up), so they are joined. `notWallets` = addresses the server found to be
   something other than a holder (another pool of this token): an event led by one is not a bundle, and one is never
   a member, so it can neither be counted as holding the bundle's tokens nor tie two bundles together. */
function bundleGroup(fold, notWallets) {
  const skip = notWallets || new Set();
  const events = [];
  for (const e of fold.events) {
    if (skip.has(e.lead)) continue;
    const members = new Map([...e.members].filter(([a]) => !skip.has(a)));
    // with another pool taken out, what is left must still be two wallets: a buy here and a sale on the other pool in
    // the same block is one trader's trade, not a bundle
    if (members.size >= 2) events.push({ ...e, members });
  }
  const parent = new Map();
  const find = (a) => { let r = a; while (parent.get(r) !== r) r = parent.get(r); let x = a; while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; } return r; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  for (const e of events) for (const a of e.members.keys()) if (!parent.has(a)) parent.set(a, a);
  for (const e of events) { const ks = [...e.members.keys()]; for (let i = 1; i < ks.length; i++) union(ks[0], ks[i]); }
  const groups = new Map();
  for (const e of events) {
    const root = find(e.lead);
    let g = groups.get(root);
    if (!g) groups.set(root, g = { events: [], members: new Map() });
    g.events.push(e);
    for (const [a, m] of e.members) {
      let x = g.members.get(a);
      if (!x) g.members.set(a, x = { roles: new Set(), buys: new Map(), recv: new Map(), moves: new Map() });
      for (const r of m.roles) x.roles.add(r);
      // keyed by transaction: the same buy or transfer seen by two events is the same buy or transfer
      for (const [k, v] of m.buys) x.buys.set(k, v);
      for (const [k, v] of m.recv) x.recv.set(k, v);
      for (const [k, v] of m.moves) x.moves.set(k, v);
    }
  }
  for (const g of groups.values()) for (const m of g.members.values()) memberSums(m);
  const out = [];
  for (const g of groups.values()) {
    const blocks = [...new Set(g.events.map((e) => e.block))].sort((a, b) => a - b);
    const txs = [...new Set([].concat(...g.events.map((e) => e.txs)))];
    const kinds = [...new Set(g.events.map((e) => e.kind))];
    const lead = g.events[0].lead;
    const wallets = [...g.members].map(([addr, m]) => {
      const f = fold.flows.get(addr) || { bought: 0n, cost: 0n, sold: 0n, proceeds: 0n, liquidity: 0n, sent: 0n, received: 0n, sentTo: new Map(), buys: 0, sells: 0 };
      // tokens it sent to wallets OUTSIDE this bundle (neither held nor sold here, and said so), and into another pool
      let sentOutside = 0n, soldElsewhere = 0n;
      for (const [to, v] of f.sentTo) { if (skip.has(to)) soldElsewhere += v; else if (!g.members.has(to)) sentOutside += v; }
      /* What of its holding came through this bundle: its buys from this pool and what other members sent it, less what it
         sold, put into the pool and sent on. P&L values at most this much of what it holds now — tokens it got from
         another pool or from outside the bundle cost nothing here, and counting them would inflate the result. */
      let fromMembers = 0n;
      for (const o of g.members.keys()) if (o !== addr) { const fo = fold.flows.get(o); if (fo) fromMembers += fo.sentTo.get(addr) || 0n; }
      const own = f.bought + fromMembers - f.sold - f.liquidity - f.sent;
      return { addr, roles: [...m.roles], inBundle: { bought: m.bought, received: m.received, moved: m.moved },
        bought: f.bought, cost: f.cost, sold: f.sold, proceeds: f.proceeds, liquidity: f.liquidity, sentOutside, soldElsewhere,
        attributable: own > 0n ? own : 0n, buys: f.buys, sells: f.sells };
    });
    const took = wallets.reduce((s, w) => s + w.inBundle.bought, 0n);
    wallets.sort((a, b) => (a.addr === lead ? -1 : b.addr === lead ? 1 : 0) || cmpBig(a.inBundle.bought + a.inBundle.received, b.inBundle.bought + b.inBundle.received));
    out.push({ lead, kinds, firstBlock: blocks[0], blocks, txs, took, wallets });
  }
  out.sort((a, b) => cmpBig(a.took, b.took) || a.firstBlock - b.firstBlock);
  return out;
}

module.exports = { bundleFold, bundleGroup, decomposeTx, LIMITS, TRANSFER_TOPIC, SWAP_TOPIC, MINT_TOPIC };
