/* ===== Advanced on-chain wallet tracker for Robinhood Chain =====
 * For any address: holdings, full trade history, average-cost basis, realized + unrealized PNL, every transaction
 * that moved a token to or from it, and a chart of its token holdings' value over time (walletchart.js).
 * The wallet's whole history is read from the CHAIN by this site's server (GET /api/chain/wallet: every token
 * transfer it ever made, every token it ever touched with its live balance, and — for the wallet's own
 * transactions — what each swap paid and received), prices come from Dexscreener or the pool's own reserves through
 * the same server — so neither learns which IP looks at which wallets — and the report is computed in your browser.
 *
 * Honesty rules, in code: a figure the chain did not give is null and is shown as "—" / "unread" / "not valued",
 * never 0; every simplification (USD at today's ETH price, average-cost basis, transfers-in at zero cost) is said
 * beside the figure it affects; a change in holdings value is never called a gain or a loss.
 *
 * Nothing at the top level of this file touches `window` or `document`: tests run it in a bare vm context with
 * only WETH, toNum, fetch and dexPricesFor supplied (tests/walletchain.mjs, tests/trackerui.mjs).
 */

const TRK = {
  prefs: { hideDust: true, showHoldings: true, showChart: true, showTxs: true, showActivity: true, usd: true },
};
const TRK_ZERO = '0x0000000000000000000000000000000000000000';
const TRK_DEAD = '0x000000000000000000000000000000000000dead';
const TRK_EXPLORER = 'https://robinhoodchain.blockscout.com';
const TRK_PAGE = 50;          // transactions per page
const TRK_CHART_MAX = 8;      // tokens charted at most (the rest are named as not charted)
const TRK_THROTTLE_SAID_MS = 20000;   // a wait on the node shorter than this is the pace's routine (the node refuses most batches once); only a longer one is said, so the line does not flicker

/* The server reads the chain as a job (a first read is about an hour on the public node — it reads history 30,000
   blocks at a time, twice, and the node refuses every batch of windows once — and later reads are incremental, in
   seconds): it answers 202 with how far it has got, then 200 with
   the history. A busy or throttled answer is waited out — the server itself waits out the node's refusals for up to ten
   minutes a read and says so (throttled: how long), and when it still had to give up (a 502 that names a throttle or a
   timeout) the page asks again a minute later, up to three times: the read goes on from the checkpoint it wrote. The
   page only gives up when the server reports no progress for five minutes, says the wallet is too large to read in
   full, or fails for another reason.
   say(msg, info): the string first (profile.js shows it as is), then the 202's structured progress:
   { stage, done, total, eta, ahead, stageOf, progressed, resuming, queueFull, startedAt, incremental, readFrom, throttled }. */
async function trkChainWallet(addr, say, fresh, isStale) {
  const STALL = 5 * 60 * 1000;
  let until = Date.now() + STALL, last = '', wait = 0, accepted = false, retried = 0;   // accepted: the server has taken the job (a 202 arrived)
  const infoOf = (j, extra) => Object.assign({
    stage: (j && j.stage) || '', done: (j && j.done) || 0, total: (j && j.total) || 0,
    eta: j && j.eta != null ? j.eta : null, ahead: (j && j.ahead) || 0,
    stageOf: (j && j.stageOf) || null, progressed: !!(j && j.progressed), resuming: !!(j && j.resuming),
    queueFull: false, startedAt: j && j.startedAt != null ? j.startedAt : null,
    incremental: !!(j && j.incremental), readFrom: j && j.readFrom != null ? j.readFrom : null,
    throttled: j && j.throttled >= TRK_THROTTLE_SAID_MS ? Number(j.throttled) : 0,
    reason: (j && j.reason) || null, resumable: !!(j && j.resumable), saved: (j && j.saved) || null,
  }, extra || {});
  for (let n = 0; ; n++) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    if (isStale && isStale()) throw Object.assign(new Error('superseded'), { superseded: true });   // nobody is waiting for this one any more: stop asking, and the server stops reading
    let res = null, j = null;
    // the refresh/rebuild flag is sent until the server has actually taken the job: a 503 busy, a 429 or a dropped
    // connection must not quietly turn a Refresh or a Rebuild into a plain read answered from the server's copy
    // (and once accepted it is dropped, or the poll after completion would start a second rebuild)
    try { res = await fetch('/api/chain/wallet?address=' + encodeURIComponent(addr) + (fresh && !accepted ? '&fresh=' + (fresh === 2 ? '2' : '1') : ''), { credentials: 'same-origin', headers: { accept: 'application/json' } }); } catch {}
    if (res) { try { j = await res.json(); } catch {} }
    if (res && res.status === 200 && j && Array.isArray(j.transfers)) { j.ageMs = Math.max(0, Number(res.headers.get('x-read-age-ms')) || 0); return j; }
    if (res && res.status === 202 && j && j.pending) {
      accepted = true;
      const sig = (j.stage || '') + '|' + (j.done || 0);
      if (sig !== last || j.stage === 'waiting for a turn') { last = sig; until = Date.now() + STALL; }   // progress, or a place in the queue (the server bounds it), resets the clock
      if (j.throttled > 0) until = Date.now() + STALL;   // the server is waiting out the node's refusals and says so — bounded there, so not a stall here
      if (say) say(j.ahead ? 'waiting for ' + j.ahead + ' other read' + (j.ahead === 1 ? '' : 's') + ' to finish first…'
        : (j.stage || 'reading the chain') + (j.total ? '… ' + Math.floor(100 * (j.done || 0) / j.total) + '%' : '…') + (j.throttled >= TRK_THROTTLE_SAID_MS ? ' · the chain node is refusing reads — waiting it out' : ''), infoOf(j));
      wait = j.stage === 'waiting for a turn' ? 4000 : 2000;
    } else if (res && res.status === 429 && j && j.code === 'rebuild_limit') {   // the rebuild was refused: say so and keep the saved report — never answer it from the copy as if it ran
      const e = new Error(j.error || 'a rebuild from scratch is limited to two an hour — Refresh reads only what is new'); e.permanent = true; throw e;
    } else if (res && res.status === 422) {
      const e = new Error((j && j.error) || 'this wallet has too many token transfers to read in full here'); e.permanent = true; throw e;
    } else if (res && res.status === 503 && j && j.queueFull) {       // the reader's line is full: say so plainly, and ask again in a while
      if (say) say((j.error || 'the chain reader has a long line right now') + ' — waiting…', infoOf(j, { stage: 'queue full', queueFull: true }));
      wait = 30000;
    } else if (!res || res.status === 429 || res.status === 503 || res.status === 504) {   // busy, throttled or a dropped connection: wait it out
      if (say) say(((j && j.error) || 'the chain reader is busy') + ' — waiting…', infoOf(j, { stage: 'busy' }));
      if (j && j.code === 'mine') until = Date.now() + STALL;               // queued behind another of your own reads: that is progress too
      wait = Math.min(30000, Math.max(2000, wait * 2));
    } else if (res && res.status === 502 && j && (j.reason === 'throttled' || j.reason === 'timeout') && fresh === 2 && !j.resumable) {
      /* a Rebuild that left no checkpoint is not asked again by itself: it starts over from block 0 and spends one of the two
         an hour — the member's call, said plainly (the one just made counted) */
      throw new Error((j.reason === 'timeout' ? 'the chain read timed out' : 'the chain node refused the rebuild') + ' before it got anywhere — it counted as one of your two rebuilds this hour. Try Rebuild again in a minute, or Refresh');
    } else if (res && res.status === 502 && j && (j.reason === 'throttled' || j.reason === 'timeout') && retried < 3) {
      /* the node refused the read for longer than the server waits, or it timed out: the server keeps that answer for a
         minute, then a new ask. The server says what it goes on from — resumable: a checkpoint (a Rebuild is asked again as
         a Refresh, so it resumes rather than starting over); saved 'complete': the finished history, read on from its head;
         neither: it starts over — and the words say which. */
      retried++; accepted = false; if (fresh === 2) fresh = 1;
      const how = j.resumable ? 'it goes on from where it stopped' : j.saved === 'complete' ? 'it reads on from the saved history — only what is new' : 'it starts over';
      if (say) say((j.reason === 'timeout' ? 'the chain read timed out' : 'the chain node refused the read for too long') + ' — asking again in a minute (' + how + ')', infoOf(j, { stage: 'throttled', throttled: 1 }));
      wait = 65000; until = Date.now() + STALL + wait;
    } else if (res && res.status === 502 && !(j && j.error) && retried < 3) {
      /* Cloudflare answers an origin 502 with its own "error code: 502" in place of the server's JSON, so the reason and
         the checkpoint never arrive. The likeliest cause is the node refusing reads, so it is treated as that: asked again
         in a minute, as a Refresh (never a second Rebuild), at most three times. */
      retried++; accepted = false; if (fresh === 2) fresh = 1;
      if (say) say('the chain could not be read just now — asking again in a minute' + (fresh === 1 && retried === 1 ? ', as a Refresh that reads on from what is saved' : ''), infoOf(j, { stage: 'throttled', throttled: 1 }));
      wait = 65000; until = Date.now() + STALL + wait;
    } else {
      throw new Error((j && j.error) || 'the chain could not be read right now — try again in a minute');
    }
    if (Date.now() > until) throw new Error('the chain read made no progress for five minutes — try again later');
  }
}

/* ===================== pure helpers (lifted by tests/trackerui.mjs by name) ===================== */

/* Every transaction that moved a token to or from the wallet, whoever sent it — one row per tx hash, newest first.
   kind: 'buy' when a token's swap summary says the wallet bought (bought === 1), 'sell' when it sold, both → 'swap';
   bought/sold === 2 (a swap in SOMEONE ELSE's transaction paid or took from the wallet) → 'in'/'out' with viaOthers;
   otherwise from the legs: only ins from 0x0 → 'mint'; only outs to 0x0/0xdead → 'burn'; only ins → 'in'; only outs
   → 'out'; both → 'mixed'; a tx whose only legs are from === to → 'self' (listed, excluded from the counts). */
function activityFrom(h, addr) {
  addr = String(addr || '').toLowerCase();
  const meta = {};
  for (const t of h.tokens || []) meta[t.address] = t;
  const isCash = a => !!(h.quotes && h.quotes[a]);
  const usdgDec = (() => { const q = h.quotes && Object.values(h.quotes).find(x => x && x.symbol === 'USDG'); return q && q.decimals != null ? q.decimals : null; })();
  const groups = new Map();
  for (const [block, li, hash, token, from, to, amount, ts] of h.transfers || []) {
    let g = groups.get(hash);
    if (!g) { g = { hash, block, li, ts: ts || null, legs: new Map(), selfOnly: true }; groups.set(hash, g); }
    if (block > g.block || (block === g.block && li > g.li)) { g.block = block; g.li = li; }
    if (ts && !g.ts) g.ts = ts;
    if (from === to) continue;                                        // a self-transfer leg moves nothing in or out
    const dir = to === addr ? 'in' : from === addr ? 'out' : null;
    if (!dir) continue;
    g.selfOnly = false;
    const key = token + '|' + dir;
    let leg = g.legs.get(key);
    if (!leg) {
      const m = meta[token] || {};
      leg = { token, symbol: m.symbol || '?', decimals: m.decimals != null ? m.decimals : null, raw: 0n, dir, cash: isCash(token), n: 0, mintish: 0, burnish: 0 };
      g.legs.set(key, leg);
    }
    leg.raw += BigInt(amount); leg.n++;
    if (dir === 'in' && from === TRK_ZERO) leg.mintish++;
    if (dir === 'out' && (to === TRK_ZERO || to === TRK_DEAD)) leg.burnish++;
  }
  const rows = [];
  for (const g of groups.values()) {
    const legs = [...g.legs.values()].sort((a, b) => (a.dir === b.dir ? 0 : a.dir === 'out' ? -1 : 1))   // what left, then what arrived
      .map(l => ({ token: l.token, symbol: l.symbol, decimals: l.decimals, qty: l.decimals == null ? null : toNum(l.raw, l.decimals), raw: l.raw.toString(), dir: l.dir, cash: l.cash, mint: l.mintish === l.n, burn: l.burnish === l.n }));
    const sums = (h.txs && h.txs[g.hash]) || null;
    let bought = false, sold = false, via = false, unvalued = false, valued = false;
    let wethPaid = 0n, usdgPaid = 0n, wethGot = 0n, usdgGot = 0n;
    if (sums) for (const a of Object.keys(sums)) {
      const s = sums[a]; if (!Array.isArray(s)) continue;
      if (s[0] === 1) { bought = true; if (s[7] & 1) unvalued = true; else { valued = true; wethPaid += BigInt(s[1] || 0); usdgPaid += BigInt(s[2] || 0); } }
      if (s[3] === 1) { sold = true; if (s[7] & 2) unvalued = true; else { valued = true; wethGot += BigInt(s[4] || 0); usdgGot += BigInt(s[5] || 0); } }
      if (s[0] === 2 || s[3] === 2) via = true;
    }
    const ins = legs.filter(l => l.dir === 'in'), outs = legs.filter(l => l.dir === 'out');
    let kind, viaOthers = false;
    if (g.selfOnly) kind = 'self';
    else if (bought && sold) kind = 'swap';
    else if (bought) kind = 'buy';
    else if (sold) kind = 'sell';
    else if (via) { viaOthers = true; kind = ins.length && !outs.length ? 'in' : outs.length && !ins.length ? 'out' : 'mixed'; }
    else if (ins.length && !outs.length) kind = ins.every(l => l.mint) ? 'mint' : 'in';
    else if (outs.length && !ins.length) kind = outs.every(l => l.burn) ? 'burn' : 'out';
    else kind = 'mixed';
    const usdgNum = (raw) => usdgDec == null ? null : toNum(raw, usdgDec);
    rows.push({
      hash: g.hash, block: g.block, li: g.li, ts: g.ts, kind,
      legs: legs.map(l => ({ token: l.token, symbol: l.symbol, decimals: l.decimals, qty: l.qty, raw: l.raw, dir: l.dir, cash: l.cash })),
      wethPaid: bought && valued ? toNum(wethPaid, 18) : null, usdgPaid: bought && valued ? usdgNum(usdgPaid) : null,
      wethGot: sold && valued ? toNum(wethGot, 18) : null, usdgGot: sold && valued ? usdgNum(usdgGot) : null,
      unvalued, viaOthers, self: kind === 'self',
    });
  }
  rows.sort((a, b) => (b.block - a.block) || (b.li || 0) - (a.li || 0));
  return rows;
}

/* The chart's inputs: each token's held amount as a step function of block (the wallet's own transfers, self-transfers
   excluded, reconciled against the live balance) and the ETH the pools took/paid for its own valued trades.
   Tokens charted: non-cash tokens with a pool, known decimals and something to value, ranked by
   max(valueUsd, ethSpent × ethUsd) (ethUsd unknown → ethSpent and held × priceEth), up to TRK_CHART_MAX. */
function seriesFrom(h, addr, tokens, ethUsd, prices) {
  addr = String(addr || '').toLowerCase();
  const meta = {};
  for (const t of h.tokens || []) meta[t.address] = t;
  const steps = {}, blockOf = {};
  const ordered = (h.transfers || []).slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));   // oldest first
  for (const [block, li, hash, token, from, to, amount] of ordered) {
    if (blockOf[hash] == null) blockOf[hash] = block;
    if (from === to) continue;
    const d = to === addr ? 1n : from === addr ? -1n : 0n;
    if (!d) continue;
    const s = steps[token] || (steps[token] = { cum: 0n, pts: [], neg: false });
    s.cum += d * BigInt(amount);
    if (s.cum < 0n) s.neg = true;                                     // more left than ever arrived: the history is not whole
    const last = s.pts[s.pts.length - 1];
    if (last && last[0] === block) last[1] = s.cum; else s.pts.push([block, s.cum]);
  }
  const usdgDec = (() => { const q = h.quotes && Object.values(h.quotes).find(x => x && x.symbol === 'USDG'); return q && q.decimals != null ? q.decimals : null; })();
  const asEth = (wRaw, uRaw) => { let e = toNum(wRaw, 18); if (uRaw > 0n) { if (usdgDec == null || !ethUsd) return null; e += toNum(uRaw, usdgDec) / ethUsd; } return e; };
  const notCharted = [], cands = [];
  for (const t of tokens) {
    if (t.cash) { if (t.held > 0) notCharted.push({ symbol: t.symbol, why: 'cash, not charted' }); continue; }   // WETH and USDG are what the chart is drawn in, not positions — named when held
    const s = steps[t.address];
    if (!s) continue;
    const p = prices && prices[t.address];
    const labels = ((p && p.labels) || []).map(x => String(x).toLowerCase());
    if (t.decimals == null) { notCharted.push({ symbol: t.symbol, why: 'amount unread (unknown decimals)' }); continue; }
    if (!t.pair) { notCharted.push({ symbol: t.symbol, why: t.priceUnread ? 'its price could not be read' : 'no pool found for it' }); continue; }
    if (labels.some(l => /^v[34]$|^cl$|solidly/.test(l))) { notCharted.push({ symbol: t.symbol, why: 'no v2 price history' }); continue; }
    const quote = p && p.quoteToken && p.quoteToken.symbol ? String(p.quoteToken.symbol).toUpperCase() : null;
    const priceNative = p && Number(p.priceNative) > 0 ? Number(p.priceNative) : null;
    const rank = ethUsd != null ? Math.max(t.valueUsd || 0, (t.ethSpent || 0) * ethUsd)
      : Math.max(t.ethSpent || 0, quote === 'WETH' && priceNative != null && !t.balanceUnread ? (t.held || 0) * priceNative : 0);
    if (!(rank > 0)) { notCharted.push({ symbol: t.symbol, why: 'nothing to value' }); continue; }
    const m = meta[t.address] || {};
    let reconciles = false;
    if (!t.balanceUnread && m.balance != null && !s.neg) {
      const bal = BigInt(m.balance), diff = s.cum > bal ? s.cum - bal : bal - s.cum;
      reconciles = diff === 0n || (bal > 0n && diff * 1000000n <= bal);   // within a millionth: float dust, not a missing transfer
    }
    const invest = [];
    let investUnvalued = 0;
    for (const hash of Object.keys(h.txs || {})) {
      const sum = h.txs[hash] && h.txs[hash][t.address];
      if (!Array.isArray(sum)) continue;
      const block = blockOf[hash];
      if (block == null) continue;
      if (sum[0] === 1) { const e = (sum[7] & 1) ? null : asEth(BigInt(sum[1] || 0), BigInt(sum[2] || 0)); if (e == null) investUnvalued++; else invest.push([block, e]); }
      if (sum[3] === 1) { const e = (sum[7] & 2) ? null : asEth(BigInt(sum[4] || 0), BigInt(sum[5] || 0)); if (e == null) investUnvalued++; else invest.push([block, -e]); }
    }
    invest.sort((a, b) => a[0] - b[0]);
    cands.push({
      address: t.address, symbol: t.symbol, pair: t.pair, quote, source: (p && p.source) || 'dexscreener',
      priceUsd: t.priceUsd, priceNative, decimals: t.decimals, heldNow: t.balanceUnread ? null : t.held,
      held: s.pts.map(([b, c]) => [b, toNum(c, t.decimals)]), reconciles, invest, investUnvalued, rank,
    });
  }
  cands.sort((a, b) => b.rank - a.rank);
  const charted = cands.slice(0, TRK_CHART_MAX);
  for (const c of cands.slice(TRK_CHART_MAX)) notCharted.push({ symbol: c.symbol, why: 'not in the top ' + TRK_CHART_MAX });
  // net invested to date over the charted, reconciling tokens: cumulative ETH the pools took − ETH they paid out
  const deltas = [];
  let investedUnvalued = 0;
  for (const c of charted) { if (!c.reconciles) continue; for (const d of c.invest) deltas.push(d); investedUnvalued += c.investUnvalued; }
  deltas.sort((a, b) => a[0] - b[0]);
  const invested = [];
  let cum = 0;
  for (const [b, e] of deltas) { cum += e; const last = invested[invested.length - 1]; if (last && last[0] === b) last[1] = cum; else invested.push([b, cum]); }
  return {
    tokens: charted.map(c => { const o = { ...c }; delete o.rank; return o; }),
    invested, investedUnvalued, notCharted,
    firstBlock: ordered.length ? ordered[0][0] : null, lastBlock: h.head != null ? Number(h.head) : null,
  };
}

/* The CSV of every listed transaction, one row per leg. Text cells are quoted, and a cell that starts with = + - @ tab
   or CR gets a leading apostrophe so a spreadsheet reads it as text, never as a formula (CSV injection). Amounts are
   unsigned numbers with the direction in its own column, so nothing numeric ever starts with a minus. */
function csvFrom(activity, exp) {
  exp = exp || TRK_EXPLORER;
  const cell = (v) => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const num = (v) => (v == null || isNaN(v)) ? '' : String(Math.abs(Number(v)));
  const KIND = { buy: 'buy', sell: 'sell', swap: 'swap', in: 'transfer in', out: 'transfer out', mint: 'mint', burn: 'burn', mixed: 'mixed', self: 'self-transfer' };
  const lines = ['time,hash,type,token,symbol,direction,amount,wethPaid,usdgPaid,wethGot,usdgGot,explorerUrl'];
  for (const a of activity || []) {
    const when = a.ts ? new Date(a.ts).toISOString() : 'block ' + a.block;
    const type = (KIND[a.kind] || a.kind) + (a.viaOthers ? ' (via someone else\'s swap)' : '');
    const legs = a.legs && a.legs.length ? a.legs : [{ token: '', symbol: '', dir: '', qty: null, raw: '' }];
    for (const l of legs) {
      lines.push([cell(when), cell(a.hash), cell(type), cell(l.token), cell(l.symbol), cell(l.dir),
        l.qty == null ? cell(l.raw ? 'raw:' + l.raw : '') : num(l.qty),
        num(a.wethPaid), num(a.usdgPaid), num(a.wethGot), num(a.usdgGot), cell(exp + '/tx/' + encodeURIComponent(a.hash))].join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

/* Build the full report for one address. onProgress(msg, info) streams status; opts.fresh asks for a new read
   (1 = incremental from the saved history, 2 = rebuild from scratch). */
async function trackerReport(addr, onProgress, opts) {
  addr = addr.toLowerCase();
  const say = (m, info) => { if (onProgress) onProgress(m, info || null); };

  say('reading the wallet’s whole history from the chain…', { stage: 'starting', done: 0, total: 0, eta: null, ahead: 0, stageOf: null, progressed: false, resuming: false, queueFull: false });
  const isStale = opts && opts.isStale;
  const h = await trkChainWallet(addr, say, opts && opts.fresh, isStale);
  if (isStale && isStale()) throw Object.assign(new Error('superseded'), { superseded: true });
  const W = WETH.toLowerCase();
  const isCash = a => !!(h.quotes && h.quotes[a]);                  // WETH and USDG are money here, not positions
  const meta = {};
  for (const t of h.tokens) meta[t.address] = t;
  const decOf = a => (meta[a] && meta[a].decimals != null ? meta[a].decimals : null);   // a scale is read, never guessed
  const info = {
    ethBalance: h.ethBalance != null ? toNum(BigInt(h.ethBalance), 18) : null,
    isContract: !!h.isContract, delegated: !!h.delegated,
    txCount: Number(h.txSent) || 0,            // transactions this wallet has SENT (its nonce) — what the chain can count
    transferCount: h.transfers.length,
    nftTransfers: Number(h.nftTransfers) || 0,
  };
  // a balance (or a scale) the chain would not give is unknown, never "0 held"
  const unreadT = t => t.balance == null || decOf(t.address) == null;
  const balancesUnread = h.tokens.filter(unreadT).length;
  const holdingsFailed = h.tokens.length > 0 && balancesUnread === h.tokens.length;

  const tokenMap = {};
  for (const t of h.tokens) {
    const dec = decOf(t.address), unread = unreadT(t);
    const held = unread ? 0 : toNum(BigInt(t.balance), dec);
    if (isCash(t.address) && !unread && !(held > 0)) continue;      // spent cash is not a holding
    tokenMap[t.address] = { address: t.address, symbol: t.symbol || '?', name: t.name || 'Unknown token', decimals: dec, held, balanceUnread: unread, market: t.market, balanceAt: t.balanceAt != null ? Number(t.balanceAt) : null };
  }
  const tokenAddrs = Object.keys(tokenMap);

  // the wallet's own transfers, per token per transaction (a taxed sell is one sale, not a sale and a "sale" of its tax)
  const byToken = {};
  let firstSeen = null, lastSeen = null;
  for (const [block, li, hash, token, from, to, amount, ts] of h.transfers) {
    if (ts) { if (!firstSeen || ts < firstSeen) firstSeen = ts; if (!lastSeen || ts > lastSeen) lastSeen = ts; }
    if (from === to || !tokenMap[token] || isCash(token)) continue;
    const m = byToken[token] || (byToken[token] = new Map());
    let g = m.get(hash);
    if (!g) { g = { hash, block, li, ts, inRaw: 0n, outRaw: 0n }; m.set(hash, g); }
    if (to === addr) g.inRaw += BigInt(amount);
    if (from === addr) g.outRaw += BigInt(amount);
    if (block < g.block || (block === g.block && li < g.li)) { g.block = block; g.li = li; }
  }
  const traded = new Set();
  for (const sum of Object.values(h.txs || {})) for (const a of Object.keys(sum)) traded.add(a);

  // prices: only what can carry a value — held, unread, or traded — and WETH itself, whose pool is the ETH price
  const toPrice = [W].concat(tokenAddrs.filter(a => a !== W && tokenMap[a].market !== false && (tokenMap[a].held > 0 || tokenMap[a].balanceUnread || traded.has(a))));
  say('pricing ' + toPrice.length + ' tokens…', { stage: 'pricing ' + toPrice.length + ' tokens', done: 0, total: toPrice.length, eta: null, ahead: 0, stageOf: null, progressed: true, resuming: false, queueFull: false });
  const priceFailed = [];
  const prices = await dexPricesFor(toPrice, priceFailed);
  // a token the server names as unread (its pool would not answer just now) is a failed price, not a token with no pool
  for (const a of Object.keys(prices)) if (prices[a] && prices[a].unread && prices[a].priceUsd == null) { priceFailed.push(a); delete prices[a]; }
  let ethUsd = null;
  const pw = prices[W];
  if (pw && ((pw.baseToken && pw.baseToken.address) || '').toLowerCase() === W && Number(pw.priceUsd) > 0) ethUsd = Number(pw.priceUsd);
  if (ethUsd == null) for (const a of Object.keys(prices)) {       // else any WETH-quoted pool (priceNative is in the pool's quote)
    const p = prices[a], q = ((p.quoteToken && p.quoteToken.address) || '').toLowerCase();
    if (q === W && Number(p.priceUsd) > 0 && Number(p.priceNative) > 0) { ethUsd = Number(p.priceUsd) / Number(p.priceNative); break; }
  }
  if (ethUsd == null && Number(h.ethUsd) > 0) ethUsd = Number(h.ethUsd);   // the site's own ETH price, read with the history
  const usdgDec = (() => { const q = h.quotes && Object.values(h.quotes).find(x => x.symbol === 'USDG'); return q ? q.decimals : null; })();
  const asEth = (wRaw, uRaw) => {                                   // null when a USDG leg cannot be put in ETH today
    let e = toNum(wRaw, 18);
    if (uRaw > 0n) { if (usdgDec == null || !ethUsd) return null; e += toNum(uRaw, usdgDec) / ethUsd; }
    return e;
  };
  const missing = new Set(h.txsMissing || []), priceMiss = new Set(priceFailed);
  const lf = h.legsFrom || (h.legsFromBlock != null ? [h.legsFromBlock, -1] : null);   // the oldest transaction whose receipt was read

  say('reconstructing trades…', { stage: 'reconstructing trades', done: 0, total: 0, eta: null, ahead: 0, stageOf: null, progressed: true, resuming: false, queueFull: false });
  const tokens = [];
  for (const a of tokenAddrs) {
    const tok = tokenMap[a];
    const p = prices[a];
    const cash = isCash(a);
    const pair = p && p.pairAddress ? p.pairAddress.toLowerCase() : null;
    let priceUsd = p && p.priceUsd != null ? Number(p.priceUsd) : null;
    if (a === W) priceUsd = ethUsd;
    else if (cash && priceUsd == null) priceUsd = 1;               // USDG is only ever the quote on Dexscreener; it is the dollar the server's legs are read in
    const priceUnread = priceMiss.has(a) && priceUsd == null;       // the price read failed: unknown, not "no market"
    const priceThin = !!(p && p.thin && priceUsd == null);          // a pool found, but too shallow to be a price
    const priceEth = priceUsd != null && ethUsd ? priceUsd / ethUsd : null;
    const scale = tok.decimals != null ? tok.decimals : 18;         // a placeholder only: realized PNL (avg × qty) does not depend on it; amounts and the per-token average do, and are hidden when it is unknown
    const q = r => toNum(r, scale);

    const groups = [...(byToken[a] ? byToken[a].values() : [])].sort((x, y) => (x.block - y.block) || (x.li - y.li));   // oldest first
    const trades = [];
    let qtyHeldCalc = 0, avgCostEth = 0;          // running average-cost basis (ETH per token)
    let buys = 0, sells = 0, xfersIn = 0, xfersOut = 0;
    let ethSpent = 0, ethReceived = 0, realizedEth = 0;
    let costUnknown = false, legsUnread = 0;
    let basisUnknown = false, realizedUnknown = false;             // a lot of unknown cost makes the PNL unknown — never a guess dressed as a number
    let fromOthers = 0;                                             // lots that arrived from a swap in someone else's transaction
    let usdgLegs = 0;                                               // buys or sells paid in USDG, converted at today's ETH price

    const inSide = (g, sum, unread) => {
      const qty = q(g.inRaw);
      if (sum && sum[0] === 1 && !(sum[7] & 1)) {                   // a buy: what the swap took in, in ETH
        const eth = asEth(BigInt(sum[1]), BigInt(sum[2]));
        if (BigInt(sum[2]) > 0n) usdgLegs++;
        buys++;
        if (eth != null && eth > 0) { avgCostEth = (avgCostEth * qtyHeldCalc + eth) / (qtyHeldCalc + qty || 1); ethSpent += eth; }
        else { costUnknown = true; basisUnknown = true; }
        qtyHeldCalc += qty;
        trades.push({ side: 'buy', qty, eth: eth != null && eth > 0 ? eth : null, ts: g.ts, hash: g.hash });
      } else if (sum && sum[0] === 1 && (sum[7] & 1)) {             // the wallet's own buy through a shared vault whose cost cannot be split
        buys++; costUnknown = true; basisUnknown = true;
        qtyHeldCalc += qty;
        trades.push({ side: 'buy', qty, eth: null, ts: g.ts, hash: g.hash, unread: true });
      } else if (sum && sum[0] === 2) {                              // a swap in someone else's transaction paid this wallet (a reward, a gift, a bridge or solver fill):
        xfersIn++; fromOthers++;                                    // the wallet paid nothing in it, so it is a transfer in like any other — zero cost — and named as such
        qtyHeldCalc += qty;
        avgCostEth = qtyHeldCalc > 0 ? (avgCostEth * (qtyHeldCalc - qty)) / qtyHeldCalc : 0;
        trades.push({ side: 'in', qty, eth: null, ts: g.ts, hash: g.hash, viaOthers: true });
      } else {
        xfersIn++;
        if (unread) { costUnknown = true; basisUnknown = true; }
        qtyHeldCalc += qty; // a zero-cost lot: pulls the average down honestly
        avgCostEth = qtyHeldCalc > 0 ? (avgCostEth * (qtyHeldCalc - qty)) / qtyHeldCalc : 0;
        trades.push({ side: 'in', qty, eth: null, ts: g.ts, hash: g.hash, unread });
      }
    };
    const outSide = (g, sum, unread) => {
      const qty = q(g.outRaw);
      if (sum && sum[3] === 1 && !(sum[7] & 2)) {                   // a sell: what the swap paid out, for everything the wallet parted with (tax included)
        const eth = asEth(BigInt(sum[4]), BigInt(sum[5]));
        if (BigInt(sum[5]) > 0n) usdgLegs++;
        sells++;
        if (eth != null) { ethReceived += eth; if (!basisUnknown) realizedEth += eth - avgCostEth * qty; else realizedUnknown = true; }
        else { costUnknown = true; realizedUnknown = true; }
        trades.push({ side: 'sell', qty, eth, ts: g.ts, hash: g.hash });
      } else if (sum && sum[3] === 1) {                              // a sell whose proceeds cannot be split
        sells++; costUnknown = true; realizedUnknown = true;
        trades.push({ side: 'sell', qty, eth: null, ts: g.ts, hash: g.hash, unread: true });
      } else {
        xfersOut++;
        if (unread) { costUnknown = true; realizedUnknown = true; }
        trades.push({ side: 'out', qty, eth: null, ts: g.ts, hash: g.hash, unread });
      }
      qtyHeldCalc = Math.max(0, qtyHeldCalc - qty);
      if (qtyHeldCalc <= 1e-12 * Math.max(1, qty)) { qtyHeldCalc = 0; avgCostEth = 0; basisUnknown = false; }   // a position fully closed: the next one starts from a known basis
    };
    for (const g of groups) {
      const sum = h.txs && h.txs[g.hash] ? h.txs[g.hash][a] : null;
      const beyond = h.legsCapped && lf && (g.block < lf[0] || (g.block === lf[0] && g.li < lf[1]));
      const unread = !sum && (missing.has(g.hash) || (beyond && tok.market !== false));
      if (unread) legsUnread++;
      const sellFirst = !!(sum && sum[6]);                          // a sell before a rebuy in the same transaction
      if (sellFirst && g.outRaw > 0n) outSide(g, sum, unread);
      if (g.inRaw > 0n) inSide(g, sum, unread);
      if (!sellFirst && g.outRaw > 0n) outSide(g, sum, unread);
    }
    if (tok.decimals == null) for (const t of trades) t.qty = null;   // unknown scale: the amounts are not shown

    const held = tok.held || 0;
    const valueUsd = priceUsd != null && !tok.balanceUnread ? held * priceUsd : null;
    const unrealizedEth = (!cash && !basisUnknown && priceEth != null && held > 0 && !tok.balanceUnread) ? held * priceEth - avgCostEth * held : null;
    const traded = buys + sells > 0;
    const realizedKnown = traded && !realizedUnknown;
    // the token's whole PNL, known only when every part of it is: cash has none; a position still held needs its unrealized part
    const unrealKnown = cash || unrealizedEth != null || (!tok.balanceUnread && held === 0);
    const pnlEth = traded && realizedKnown && unrealKnown ? realizedEth + (unrealizedEth || 0) : null;
    tokens.push({
      address: a, symbol: tok.symbol, name: tok.name, decimals: tok.decimals, cash,
      held, balanceUnread: tok.balanceUnread, balanceAt: tok.balanceAt, priceUsd, priceEth, valueUsd, priceUnread, priceThin,
      priceSource: p && p.source === 'reserves' ? 'reserves' : (p ? 'market' : null),
      pair, hasMarket: !!pair || cash || priceUnread || tok.market === true,
      buys, sells, xfersIn, xfersOut, usdgLegs,
      ethSpent, ethReceived,
      avgCostEth: tok.decimals != null && !basisUnknown && avgCostEth ? avgCostEth : null,   // ETH per token depends on the scale
      realizedEth: realizedKnown ? realizedEth : null,
      unrealizedEth,
      realizedUsd: realizedKnown && ethUsd != null ? realizedEth * ethUsd : null,
      unrealizedUsd: unrealizedEth != null && ethUsd != null ? unrealizedEth * ethUsd : null,
      pnlEth, pnlUsd: pnlEth != null && ethUsd != null ? pnlEth * ethUsd : null,
      costUnknown, legsUnread, fromOthers,
      trades: trades.reverse(), // newest first for display
    });
  }

  tokens.sort((x, y) => (y.valueUsd || 0) - (x.valueUsd || 0));
  const tradedT = tokens.filter(t => t.buys + t.sells > 0);
  // totals over what is known; a token whose PNL is unknown is left out and counted, never added in as a guess
  const totalRealizedUsd = ethUsd == null ? null : tradedT.reduce((s, t) => s + (t.realizedUsd || 0), 0);
  const totalUnrealizedUsd = ethUsd == null ? null : tokens.reduce((s, t) => s + (t.unrealizedUsd || 0), 0);
  const pnlUnknown = tradedT.filter(t => t.pnlEth == null).length;
  const wins = tradedT.filter(t => t.pnlEth != null && t.pnlEth > 0).length;
  // a total that leaves out a token with a market whose balance or price could not be read is a partial total, and says so
  const pricePartial = tokens.some(t => t.priceUnread && (t.held > 0 || t.balanceUnread));
  const portfolioPartial = !holdingsFailed && (tokens.some(t => t.balanceUnread && t.hasMarket) || pricePartial);

  say('listing transactions…', { stage: 'listing transactions', done: 0, total: 0, eta: null, ahead: 0, stageOf: null, progressed: true, resuming: false, queueFull: false });
  const activity = activityFrom(h, addr);
  const series = seriesFrom(h, addr, tokens, ethUsd, prices);
  const txCounts = {
    sent: h.txSent != null ? Number(h.txSent) : null,
    listed: activity.filter(a => !a.self).length,
    nft: Number(h.nftTransfers) || 0,
    isContract: !!h.isContract, delegated: !!h.delegated,
  };

  return {
    address: addr, source: 'chain', readAt: Date.now() - (Number(h.ageMs) || 0),
    head: h.head != null ? Number(h.head) : null,
    incremental: !!h.incremental, readFrom: h.readFrom != null ? h.readFrom : null,
    saved: h.saved != null ? !!h.saved : null, savedWhy: h.savedWhy || null,
    info, ethUsd,
    ethValueUsd: info.ethBalance != null && ethUsd != null ? info.ethBalance * ethUsd : null,
    totalTokenValueUsd: tokens.reduce((s, t) => s + (t.valueUsd || 0), 0),
    tokens, tradedCount: tradedT.length, wins,
    totalRealizedUsd, totalUnrealizedUsd,
    firstSeen, lastSeen,
    transfersAnalyzed: h.transfers.length, historyComplete: !!h.complete,
    holdingsFailed, // true when no balance could be read — render a warning, not zeros
    balancesUnread, portfolioPartial, pricePartial, pricesUnread: priceFailed.length, pnlUnknown,
    reservesPriced: tokens.filter(t => t.priceSource === 'reserves' && t.priceUsd != null).length,
    legsCapped: !!h.legsCapped, legsRead: Number(h.legsRead) || 0, txsMissing: (h.txsMissing || []).length,
    activity, series, txCounts,
  };
}

/* ===================== formatting ===================== */
/* Money: 0 decimals at ≥ $1,000, 2 below, up to 4 below $1. A minus is the real minus sign. */
function trkUsd(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const s = abs >= 1000 ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : abs >= 1 ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return (n < 0 ? '−' : '') + '$' + s;
}
function trkEth(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const s = abs >= 1 ? abs.toLocaleString('en-US', { maximumFractionDigits: 4 })
    : abs >= 0.001 ? abs.toLocaleString('en-US', { maximumFractionDigits: 6 })
    : abs === 0 ? '0' : String(Number(abs.toPrecision(3)));
  return (n < 0 ? '−' : '') + s + ' ETH';
}
/* A price: enough figures to mean something — $0.000108 is a price, "$0.00" is not. */
function trkPrice(p) {
  if (p == null || isNaN(p) || !(p > 0)) return p === 0 ? '$0' : '—';
  if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 4 });
  const d = Math.max(2, Math.min(12, Math.ceil(-Math.log10(p)) + 3));
  let s = p.toFixed(d).replace(/0+$/, '');                          // significant figures, without a tail of zeros
  if (s.endsWith('.')) s += '00'; else if (/\.\d$/.test(s)) s += '0';
  return '$' + s;
}
function trkPriceEth(p) {
  if (p == null || isNaN(p) || !(p > 0)) return p === 0 ? '0 ETH' : '—';
  return (p >= 0.001 ? p.toLocaleString('en-US', { maximumFractionDigits: 6 }) : p.toExponential(3)) + ' ETH';
}
function trkQty(q) {
  if (q == null || isNaN(q)) return '—';
  const abs = Math.abs(q);
  if (abs >= 1000) return abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (abs >= 1) return abs.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (abs === 0) return '0';
  return String(Number(abs.toPrecision(4)));
}
function trkPct(x) { return x == null || !isFinite(x) ? '—' : (x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2)) + '%'; }
function trkDate(ts) { return ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }
function trkTime(ts) { return ts ? new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) : ''; }
function trkEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// URL path segments from third-party APIs (addresses, tx hashes, pair ids) — neutralize any breakout chars
function trkSeg(s) { return encodeURIComponent(String(s == null ? '' : s)); }
const trkN = (n) => Number(n || 0).toLocaleString('en-US');
const trkPlural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
/* A gain or loss is never colour alone: the arrow and the sign carry it too. */
function pnlSpan(n, fmt) {
  if (n == null) return '<span class="t-pnl">—</span>';
  if (n === 0) return '<span class="t-pnl">' + fmt(0) + '</span>';
  const cls = n > 0 ? 'pos' : 'neg';
  const arrow = n > 0 ? '▲ +' : '▼ −';
  return '<span class="t-pnl ' + cls + '">' + arrow + fmt(Math.abs(n)).replace('−', '') + '</span>';
}
function pnlRaw(n, fmt) { return n == null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n)).replace('−', ''); }
function pnlArrow(n) { return n == null || n === 0 ? '' : n > 0 ? '▲ ' : '▼ '; }

/* ===================== rendering ===================== */
/* The dashboard. UI state lives on the zone (zone._trk) so a re-render — a toggle, a filter, a live report landing on
   top of a saved one — keeps what the reader opened, keeps their place on the page and puts focus back where it was,
   by the stable data-trk-key every control carries. */
function trkState(zone) {
  if (!zone._trk) zone._trk = { openToks: new Set(), actKinds: new Set(), actToken: '', actRange: 'all', actFrom: '', actTo: '', actPages: 1, wcRange: '7d', wcSeries: { value: true, invested: true }, tableOpen: false, focusKey: null, defsOpen: false, uid: 'trk' + Math.floor(Math.random() * 1e6) };
  return zone._trk;
}
function trkFindKey(zone, key) {
  if (!key) return null;
  for (const el of zone.querySelectorAll('[data-trk-key]')) if (el.dataset.trkKey === key) return el;
  return null;
}

function renderTracker(zone, r, prefs) {
  const P = { ...TRK.prefs, ...(prefs || {}) };
  if (P.showTxs == null) P.showTxs = true;                           // prefs saved before the transactions section existed
  const S = trkState(zone);
  // the zone's UI state belongs to one wallet: a different wallet rendered into the same zone (the tracker page's
  // report zone, the profile's wallet picker) starts with its own filters, pages and open rows — a token chosen for
  // wallet A must not filter wallet B's list down to "Showing 0 of 0". Display choices (range, series, unit) stay.
  if (S.addr !== r.address) { S.addr = r.address; S.openToks = new Set(); S.actKinds = new Set(); S.actToken = ''; S.actRange = 'all'; S.actFrom = ''; S.actTo = ''; S.actPages = 1; S.defsOpen = false; S.focusKey = null; }
  const money = P.usd ? trkUsd : trkEth;
  const inUnit = (usd) => usd == null ? null : (P.usd ? usd : (r.ethUsd ? usd / r.ethUsd : null));   // a USD figure in the chosen unit
  const exp = TRK_EXPLORER;
  const chartable = typeof window !== 'undefined' && typeof window.mountWalletChart === 'function';
  const noPrice = r.source === 'chain' && r.ethUsd == null;
  const txc = r.txCounts || null;

  /* keep-place: where focus should land (the control that asked for this render, else the one that had focus) and
     where that control sat on screen, by key */
  let focusKey = S.focusKey, anchorEl = null;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (focusKey) anchorEl = trkFindKey(zone, focusKey);
  else if (active && active !== zone && zone.contains(active)) {
    const keyed = active.closest ? active.closest('[data-trk-key]') : null;
    if (keyed) { focusKey = keyed.dataset.trkKey; anchorEl = keyed; }
  }
  const anchorTop = anchorEl ? anchorEl.getBoundingClientRect().top : null;
  S.focusKey = null;

  let html = '<div class="trk-dash">';

  // report options
  html += '<div class="trk-bar" role="group" aria-label="Report options">' +
    trkToggle('hideDust', P.hideDust, 'Hide dust (under $1)', 'Hides tokens worth under $1 that were never traded') +
    trkToggle('showHoldings', P.showHoldings, 'Holdings', 'Shows or hides the holdings and PNL table') +
    trkToggle('showChart', P.showChart, 'Chart', 'Shows or hides the value-over-time chart') +
    trkToggle('showTxs', P.showTxs, 'Transactions', 'Shows or hides the list of transactions') +
    trkToggle('showActivity', P.showActivity, 'Facts', 'Shows or hides the wallet facts tiles') +
    trkToggle('usd', P.usd, 'Show $ (off = ETH)', 'Switches every figure between US dollars and ETH') +
    '</div>';

  // honesty warnings — when the balance read failed, the figures that depend on it are unknown, not $0 (and the warning
  // must show regardless of the Holdings toggle)
  if (r.holdingsFailed) html += '<p class="trk-warn modal-note" role="status">⚠️ Token balances could not be read (the chain didn’t answer) — held amounts show as “unread”, and portfolio value / unrealized PNL are unavailable. Try again in a minute.</p>';
  else if (r.portfolioPartial) html += '<p class="trk-warn modal-note" role="status">⚠️ ' + [r.balancesUnread ? trkPlural(r.balancesUnread, 'token balance') + ' could not be read' : '', r.pricePartial ? 'some token prices could not be read' : ''].filter(Boolean).join(' and ') + ' — the portfolio value leaves them out, so it is a partial total.</p>';
  if (noPrice) html += '<p class="trk-warn modal-note" role="status">⚠️ The ETH price could not be read just now, so dollar figures are unavailable — ETH figures are shown where known.</p>';
  if (r.source === 'chain' && r.saved === false && r.savedWhy === 'too large') html += '<p class="trk-warn modal-note" role="status">This wallet’s history is too large to save on the server, so the next read starts from scratch.</p>';

  // KPIs
  const total = r.holdingsFailed || noPrice ? null : (r.ethValueUsd || 0) + (r.totalTokenValueUsd || 0);
  const unit = P.usd ? 'USD' : 'ETH';
  const unitNote = P.usd ? '' : ' at today’s ETH price';
  const heldN = r.tokens.filter(t => t.unrealizedUsd != null || t.unrealizedEth != null).length;
  const soldN = r.tokens.filter(t => t.sells > 0 && (t.realizedEth != null || t.realizedUsd != null)).length;
  const realUnknown = r.tokens.filter(t => t.buys + t.sells > 0 && t.realizedEth == null).length;   // traded, but its realized figure is unknown (an unread sell or transfer out, an unsplittable sell, a USDG sell with no ETH price)
  const unreal = r.holdingsFailed ? null : inUnit(r.totalUnrealizedUsd);
  const real = inUnit(r.totalRealizedUsd);
  const realAllUnknown = real != null && soldN === 0 && realUnknown > 0;   // nothing valued was sold: the total is unknown, not $0
  html += '<section class="trk-kpis" aria-label="Summary">' +
    trkKpi('Portfolio value', unit, total == null ? '—' : money(inUnit(total)) + (r.portfolioPartial ? ' (partial)' : ''), '',
      total == null ? (r.holdingsFailed ? 'balances unread' : 'no ETH price right now') :
        // the reason is built from the same parts as the warning line above: balances unread and/or prices unread
        'ETH ' + money(inUnit(r.ethValueUsd)) + ' · tokens ' + money(inUnit(r.totalTokenValueUsd)) + (r.portfolioPartial ? ' · partial: ' + [r.balancesUnread ? trkPlural(r.balancesUnread, 'balance') + ' unread' : '', r.pricePartial ? 'some prices unread' : ''].filter(Boolean).join(', ') : '') + unitNote, true) +
    trkKpi('ETH balance', null, r.info.ethBalance != null ? trkEth(r.info.ethBalance) : '—', '',
      r.ethValueUsd != null ? trkUsd(r.ethValueUsd) + ' at today’s ETH price' : (r.info.ethBalance == null ? 'not read' : 'no ETH price right now')) +
    trkKpi('Unrealized PNL', unit, unreal == null ? '—' : pnlArrow(unreal) + pnlRaw(unreal, money), unreal == null ? '' : unreal > 0 ? 'pos' : unreal < 0 ? 'neg' : '',
      unreal == null ? (r.holdingsFailed ? 'balances unread' : 'needs an ETH price') : 'on ' + trkPlural(heldN, 'token') + ' held' + (r.pnlUnknown ? ' · ' + r.pnlUnknown + ' unknown' : '')) +
    trkKpi('Realized PNL', unit, real == null || realAllUnknown ? '—' : pnlArrow(real) + pnlRaw(real, money), real == null || realAllUnknown ? '' : real > 0 ? 'pos' : real < 0 ? 'neg' : '',
      real == null ? 'needs an ETH price' : realAllUnknown ? trkPlural(realUnknown, 'token') + ' sold or sent out, not valued' : 'from ' + trkPlural(soldN, 'token') + ' sold' + (realUnknown ? ' · ' + realUnknown + ' unknown' : '')) +
    '</section>';

  // the chart
  if (P.showChart) {
    html += '<section class="trk-chart" aria-labelledby="' + S.uid + '-chart-h"><div class="trk-h-row"><h3 id="' + S.uid + '-chart-h" class="trk-h">Value over time</h3></div>' +
      (chartable ? '<div class="wc" data-wc-host></div>' : '<p class="modal-note"><a href="/tracker">Chart available on the Wallet Tracker page →</a></p>') +
      '</section>';
  }

  // wallet facts
  if (P.showActivity) {
    const sent = txc ? txc.sent : (r.info ? r.info.txCount : null);
    const listed = txc ? txc.listed : null;
    const isC = txc ? txc.isContract : !!(r.info && r.info.isContract);
    const deleg = txc ? txc.delegated : !!(r.info && r.info.delegated);
    html += '<section class="trk-facts" aria-label="Wallet facts">' +
      trkFact('Transactions sent', isC ? '—' : (sent == null ? '—' : trkN(sent)), isC ? 'a contract’s nonce counts contracts it created' : deleg ? 'its nonce · smart-account operations run inside other transactions and are not counted' : 'its nonce, read from the chain') +
      trkFact('Token transactions', listed == null ? '—' : trkN(listed), listed == null ? 'not in this saved report — refresh' : 'whoever sent them') +
      trkFact('Tokens traded', trkN(r.tradedCount), r.tradedCount ? (noPrice ? 'PNL needs an ETH price' : trkN(r.wins) + ' with positive total PNL' + (r.pnlUnknown ? ' · ' + r.pnlUnknown + ' unknown' : '')) : 'no swaps found') +
      trkFact('First activity', trkDate(r.firstSeen), r.firstSeen ? 'first token transfer' : 'no token transfer found') +
      trkFact('Last activity', trkDate(r.lastSeen), r.lastSeen ? 'latest token transfer' : '') +
      trkFact('Account', isC ? 'Contract' : deleg ? 'Smart account (EIP-7702)' : 'Wallet', isC ? 'a smart contract, not a personal wallet' : deleg ? 'a personal wallet that delegated to smart-account code' : 'a personal wallet') +
      '</section>';
  }

  // holdings & PNL by token
  if (P.showHoldings) html += trkHoldingsHTML(r, P, S, money, exp);

  // transactions
  if (P.showTxs) html += trkActivityHTML(r, P, S, exp);

  // method note
  html += '<p class="trk-foot modal-note">Analyzed ' + trkN(r.transfersAnalyzed) + ' token transfers' +
    (r.historyComplete ? ' — the full history, read from the chain' : ' (most recent — very deep histories are truncated)') +
    (r.incremental && r.readFrom != null ? ' · updated from block ' + trkN(r.readFrom) : '') +
    (r.legsCapped ? ' · trades older than the newest ' + trkN(r.legsRead) + ' transactions are not valued' : '') +
    (r.txsMissing ? ' · ' + trkPlural(r.txsMissing, 'transaction') + ' could not be read — not valued' : '') +
    (r.pricesUnread ? ' · some prices could not be read' : '') +
    (r.reservesPriced ? ' · ' + trkPlural(r.reservesPriced, 'price') + ' from the pool’s own reserves' : '') +
    (r.lookupsCapped ? ' · some trade legs unvalued (lookup cap)' : '') +
    (r.balancesUnread ? ' · ' + trkPlural(r.balancesUnread, 'token balance') + ' could not be read' : '') +
    (r.info && r.info.nftTransfers ? ' · ' + trkPlural(r.info.nftTransfers, 'NFT transfer') + ' (not valued)' : '') +
    ' · a buy or sell is a swap in a transaction the wallet sent, straight with a pool or through any router; tax is part of its cost · WETH and USDG count as cash · average-cost basis · transfers-in count as zero-cost · USD uses today\'s ETH price · plain ETH sent between wallets leaves no log, so only the live ETH balance is shown · <a href="' + exp + '/address/' + trkSeg(r.address) + '" target="_blank" rel="noopener">full explorer view ↗</a></p>';
  html += '</div>';

  zone.innerHTML = html;
  zone._trkCtx = { r, P };
  trkWire(zone);

  // the chart mounts into its host; it reads and keeps its range/series state on zone._trk
  const host = zone.querySelector('[data-wc-host]');
  if (host && chartable) { host._trkState = S; try { window.mountWalletChart(host, r, P); } catch (e) { host.innerHTML = '<p class="modal-note">⚠️ The chart could not be drawn: ' + trkEsc(e && e.message) + '</p>'; } }

  // keep-place: focus back on the same control, at the same place on screen
  if (focusKey) {
    const el = trkFindKey(zone, focusKey);
    if (el) {
      try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }
      if (anchorTop != null && typeof window !== 'undefined' && window.scrollBy) {
        const d = el.getBoundingClientRect().top - anchorTop;
        if (Math.abs(d) > 1) window.scrollBy(0, d);
      }
    }
  }
}

function trkKpi(label, unit, val, cls, sub, main) {
  return '<div class="hstat kpi' + (main ? ' kpi-main' : '') + '"><div class="lbl" data-def="' + trkEsc(label) + '">' + trkEsc(label) + (unit ? ' <span class="unit">(' + trkEsc(unit) + ')</span>' : '') + '</div>' +
    '<div class="val ' + (cls || '') + '">' + val + '</div>' + (sub ? '<div class="sub">' + trkEsc(sub) + '</div>' : '') + '</div>';
}
function trkFact(label, val, sub) {
  return '<div class="hstat fact"><div class="lbl" data-def="' + trkEsc(label) + '">' + trkEsc(label) + '</div><div class="val">' + trkEsc(val) + '</div>' + (sub ? '<div class="sub">' + trkEsc(sub) + '</div>' : '') + '</div>';
}
function trkStat(label, val, cls) {
  return '<div class="hstat"><div class="lbl" data-def="' + trkEsc(label) + '">' + label + '</div><div class="val ' + (cls || '') + '">' + val + '</div></div>';
}
function trkToggle(key, on, label, tip) {
  return '<button class="react-btn' + (on ? ' lit' : '') + '" data-tip="' + trkEsc(tip || 'Turns this report option on or off and remembers your choice') + '" type="button" data-trk-toggle="' + key + '" data-trk-key="toggle:' + key + '" aria-pressed="' + on + '">' + (on ? '✓ ' : '') + label + '</button>';
}

/* ---- holdings table ---- */
function trkHoldingsHTML(r, P, S, money, exp) {
  const share = (v) => trkShare(r, v);
  const val = (usd) => usd == null ? '—' : (P.usd ? trkUsd(usd) : (r.ethUsd ? trkEth(usd / r.ethUsd) : '—'));
  const price = (t) => trkPriceCell(r, P, t);
  let html = '<section class="trk-holdings" aria-labelledby="' + S.uid + '-hold-h"><div class="trk-h-row"><h3 id="' + S.uid + '-hold-h" class="trk-h">Holdings &amp; PNL by token</h3>' +
    '<button class="trk-defs-btn" data-tip="Shows or hides what each column means" type="button" data-trk-defs data-trk-key="defs:holdings" aria-expanded="' + !!S.defsOpen + '" aria-controls="' + S.uid + '-defs" aria-label="What do the columns mean?">ⓘ</button></div>' +
    '<div class="trk-defs" id="' + S.uid + '-defs"' + (S.defsOpen ? '' : ' hidden') + '><dl>' +
      '<dt>Held</dt><dd>How many of the token the wallet holds right now, read from the chain.</dd>' +
      '<dt>Price</dt><dd>Today’s price from its deepest market, or from its pool’s own reserves (“pool”) when no market lists it.</dd>' +
      '<dt>Value</dt><dd>Held × price. USD at today’s ETH price.</dd>' +
      '<dt>Share of portfolio</dt><dd>This value as a share of the ETH balance plus every valued token' + (r.portfolioPartial ? ' — shares of a partial total' : '') + '.</dd>' +
      '<dt>Avg entry</dt><dd>Average cost in ETH per token across the wallet’s own buys; transfers in count as free and pull it down; buys paid in USDG converted at today’s ETH price.</dd>' +
      '<dt>PNL</dt><dd>Realized (sales minus the average cost of what was sold) plus unrealized (today’s value of what is held minus its average cost); “—” when any part is unknown.</dd>' +
    '</dl></div>';
  const rows = [];
  // the ETH row first, so Share adds up
  rows.push('<tr role="row" class="trk-hrow trk-hrow-eth"><td role="cell" data-l="Token"><span class="t-sym">ETH</span><span class="t-name">native balance</span></td>' +
    '<td role="cell" data-l="Held" class="num">' + (r.info.ethBalance != null ? trkQty(r.info.ethBalance) : '—') + '</td>' +
    '<td role="cell" data-l="Price" class="num c-price">' + (r.ethUsd != null ? (P.usd ? trkPrice(r.ethUsd) : '1 ETH') : '—') + '</td>' +
    '<td role="cell" data-l="Value" class="num">' + (r.ethValueUsd != null ? val(r.ethValueUsd) : (r.info.ethBalance != null && !P.usd ? trkEth(r.info.ethBalance) : '—')) + '</td>' +
    '<td role="cell" data-l="Share" class="num c-share">' + share(r.ethValueUsd) + '</td>' +
    '<td role="cell" data-l="Avg entry" class="num c-avg">—</td>' +
    '<td role="cell" data-l="PNL" class="num"><span class="t-pnl">—</span></td><td role="cell" class="c-more"></td></tr>');
  let shown = 0;
  for (const t of r.tokens) {
    if (P.hideDust && !(t.balanceUnread && t.hasMarket) && !(t.priceUnread && t.held > 0) && (t.valueUsd == null || t.valueUsd < 1) && t.buys + t.sells === 0) continue;   // the rows a partial total is warning about stay visible
    shown++;
    const id = S.uid + '-tok-' + t.address;
    const open = S.openToks.has(t.address);
    // the token's PNL as the report knows it: null (shown "—") when any part is unknown; a report saved before this read summed the parts
    const pnlShown = 'pnlEth' in t ? (P.usd ? t.pnlUsd : t.pnlEth) : (r.ethUsd != null ? (P.usd ? (t.realizedUsd || 0) + (t.unrealizedUsd || 0) : ((t.realizedUsd || 0) + (t.unrealizedUsd || 0)) / r.ethUsd) : null);
    const pnlCell = t.cash ? '<span class="t-pnl">cash</span>' : t.buys + t.sells > 0 ? pnlSpan(pnlShown, money) : '<span class="t-pnl">' + (t.priceUnread ? 'price unread' : t.hasMarket ? 'no trades' : 'no market') + '</span>';
    rows.push('<tr role="row" class="trk-hrow" data-tok="' + trkEsc(t.address) + '">' +
      '<td role="cell" data-l="Token"><span class="t-sym">$' + trkEsc(t.symbol) + '</span><span class="t-name">' + trkEsc(t.name) + '</span></td>' +
      '<td role="cell" data-l="Held" class="num">' + (t.balanceUnread ? 'unread' : trkQty(t.held)) + (t.balanceAt != null ? ' <span class="t-src">as of block ' + trkN(t.balanceAt) + '</span>' : '') + '</td>' +
      '<td role="cell" data-l="Price" class="num c-price">' + price(t) + '</td>' +
      '<td role="cell" data-l="Value" class="num">' + val(t.valueUsd) + '</td>' +
      '<td role="cell" data-l="Share" class="num c-share">' + share(t.valueUsd) + '</td>' +
      '<td role="cell" data-l="Avg entry" class="num c-avg">' + (t.avgCostEth != null && t.avgCostEth > 0 ? trkPriceEth(t.avgCostEth) : '—') + '</td>' +
      '<td role="cell" data-l="PNL" class="num">' + pnlCell + '</td>' +
      '<td role="cell" class="c-more"><button class="trk-more" data-tip="Shows this token’s trades and figures" type="button" data-trk-more="' + trkEsc(t.address) + '" data-trk-key="more:' + trkEsc(t.address) + '" aria-expanded="' + open + '" aria-controls="' + id + '" aria-label="Details, $' + trkEsc(t.symbol) + '">▾</button></td></tr>');
    // the detail panel is built only when it is open (a report with 60 tokens is 60 trade tables nobody asked for on
    // every toggle); a closed row is emitted empty — same id and aria-controls — and filled on its first open by trkWire
    rows.push('<tr role="row" class="trk-hdetail" id="' + id + '"' + (open ? '' : ' hidden') + '><td role="cell" colspan="8">' + (open ? trkDetailHTML(r, t, P) : '') + '</td></tr>');
  }
  html += '<div class="trk-scroll"><table class="trk-htable" role="table"><thead role="rowgroup"><tr role="row">' +
    '<th role="columnheader" scope="col">Token</th><th role="columnheader" scope="col" class="num">Held</th><th role="columnheader" scope="col" class="num c-price">Price</th><th role="columnheader" scope="col" class="num">Value</th>' +
    '<th role="columnheader" scope="col" class="num c-share">Share of portfolio</th><th role="columnheader" scope="col" class="num c-avg">Avg entry</th><th role="columnheader" scope="col" class="num">PNL</th><th role="columnheader" scope="col"><span class="sr-only">Details</span></th></tr></thead>' +
    '<tbody role="rowgroup">' + rows.join('') + '</tbody></table></div>';
  if (!shown) html += '<p class="modal-note">Nothing above the dust filter — toggle it off to see everything.</p>';
  if (r.portfolioPartial) html += '<p class="modal-note">Shares are of a partial total — ' + (r.balancesUnread ? trkPlural(r.balancesUnread, 'balance') + ' could not be read' : 'some prices could not be read') + '.</p>';
  if (!P.usd) html += '<p class="modal-note">ETH figures: USDG-quoted pools and USDG legs converted at today’s ETH price.</p>';
  html += '</section>';
  return html;
}
/* the three cell builders a lazily filled detail panel needs after trkHoldingsHTML has returned */
function trkShare(r, v) {
  const noPrice = r.source === 'chain' && r.ethUsd == null;
  const totalUsd = (r.holdingsFailed || noPrice) ? null : (r.ethValueUsd || 0) + (r.totalTokenValueUsd || 0);
  return (v == null || totalUsd == null || !(totalUsd > 0)) ? '—' : trkPct(100 * v / totalUsd);
}
function trkPriceCell(r, P, t) {
  return t.priceUsd == null ? (t.priceUnread ? 'unread' : t.priceThin ? 'pool too thin' : t.hasMarket ? '—' : 'no market')
    : (P.usd ? trkPrice(t.priceUsd) : (t.priceEth != null ? trkPriceEth(t.priceEth) : '—')) + (t.priceSource === 'reserves' ? ' <span class="t-src">· pool</span>' : t.priceSource === 'market' ? ' <span class="t-src">· market</span>' : '');
}
function trkDetailHTML(r, t, P) {
  return trkTokenDetail(r, t, P, P.usd ? trkUsd : trkEth, TRK_EXPLORER, trkPriceCell(r, P, t), trkShare(r, t.valueUsd));
}
function trkTokenDetail(r, t, P, money, exp, priceHtml, shareTxt) {
  return '<div class="trk-tgrid">' +
      trkStat('Price', priceHtml, '') +
      trkStat('Share', shareTxt, '') +
      trkStat('Avg entry', t.avgCostEth != null && t.avgCostEth > 0 ? trkPriceEth(t.avgCostEth) : '—', '') +
      trkStat('Spent on buys', trkEth(t.ethSpent || null), '') +
      trkStat('Sell proceeds', trkEth(t.ethReceived || null), '') +
      trkStat('Realized', pnlRaw(P.usd ? t.realizedUsd : t.realizedEth, money), (t.realizedUsd || 0) > 0 ? 'pos' : (t.realizedUsd || 0) < 0 ? 'neg' : '') +
      trkStat('Unrealized', pnlRaw(P.usd ? t.unrealizedUsd : t.unrealizedEth, money), (t.unrealizedUsd || 0) > 0 ? 'pos' : (t.unrealizedUsd || 0) < 0 ? 'neg' : '') +
      trkStat('Buys / Sells / Xfers', t.buys + ' / ' + t.sells + ' / ' + (t.xfersIn + t.xfersOut), '') +
    '</div>' +
    (t.balanceAt != null ? '<p class="modal-note">Balance as of block ' + trkN(t.balanceAt) + ' — not re-read on this refresh (no market, nothing moved).</p>' : '') +
    (t.usdgLegs ? '<p class="modal-note">' + trkPlural(t.usdgLegs, 'trade') + ' paid or received USDG — converted at today’s ETH price for the ETH figures.</p>' : '') +
    (t.costUnknown ? '<p class="modal-note">Some of this token\'s trades could not be valued (a receipt the chain did not give, a swap that cannot be split, or a leg with no ETH price right now)' + (t.pnlEth == null ? ' — so its PNL is unknown, and left out of the totals.' : ' — PNL is partial.') + '</p>' : '') +
    (t.fromOthers ? '<p class="modal-note">' + trkPlural(t.fromOthers, 'transfer') + ' in came from a swap in someone else\'s transaction (a reward, a gift, or a bridge or solver fill) — counted at zero cost, like any transfer in.</p>' : '') +
    (t.legsUnread ? '<p class="modal-note">' + trkPlural(t.legsUnread, 'transaction') + ' of this token could not be read (or lie beyond the newest ' + trkN(r.legsRead) + ' read) — listed as transfers, not valued.</p>' : '') +
    (t.trades && t.trades.length ? trkTradeTable(t, exp) : '') +
    '<p class="modal-note"><a href="/newpairs?scan=' + trkSeg(t.address) + '">📊 token dashboard</a> · <a href="' + exp + '/token/' + trkSeg(t.address) + '" target="_blank" rel="noopener">token on explorer ↗</a>' +
    (t.pair ? ' · <a href="https://dexscreener.com/robinhood/' + trkSeg(t.pair) + '" target="_blank" rel="noopener">chart ↗</a>' : '') + '</p>';
}
function trkTradeTable(t, exp) {
  const rows = t.trades.slice(0, 40).map(tr => {
    const label = { buy: '<span aria-hidden="true">🟢</span> Buy', sell: '<span aria-hidden="true">🔴</span> Sell', in: '<span aria-hidden="true">📥</span> In', out: '<span aria-hidden="true">📤</span> Out' }[tr.side];
    return '<tr role="row"><td role="cell" data-l="Side">' + label + (tr.viaOthers ? ' <span class="t-src">via someone else’s swap</span>' : '') + '</td>' +
      '<td role="cell" data-l="Amount" class="num">' + (tr.qty == null ? '—' : trkQty(tr.qty)) + '</td>' +
      '<td role="cell" data-l="ETH leg" class="num">' + (tr.eth != null ? trkEth(tr.eth) : (tr.unread ? 'unread' : '—')) + '</td>' +
      '<td role="cell" data-l="Date">' + (tr.ts ? new Date(tr.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—') + '</td>' +
      '<td role="cell" data-l="Tx"><a href="' + exp + '/tx/' + trkSeg(tr.hash) + '" target="_blank" rel="noopener" aria-label="View transaction on explorer">tx ↗</a></td></tr>';
  }).join('');
  return '<div class="trk-scroll"><table class="trk-table" role="table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Side</th><th role="columnheader" scope="col" class="num">Amount</th><th role="columnheader" scope="col" class="num">ETH leg</th><th role="columnheader" scope="col">Date</th><th role="columnheader" scope="col">Tx</th></tr></thead><tbody role="rowgroup">' + rows + '</tbody></table>' +
    (t.trades.length > 40 ? '<p class="modal-note">Showing latest 40 of ' + t.trades.length + ' trades — every one is in the Transactions list below.</p>' : '') + '</div>';
}

/* ---- transactions ---- */
const TRK_KINDS = {
  buy: ['🟢', 'Buy'], sell: ['🔴', 'Sell'], swap: ['🔁', 'Swap'], in: ['📥', 'Transfer in'], out: ['📤', 'Transfer out'],
  mint: ['✨', 'Mint'], burn: ['🔥', 'Burn'], mixed: ['🔀', 'Mixed'], self: ['↩️', 'Self-transfer'],
};
/* The filters (owner, 2026-10-22: "filter transactions by transfers in, transfers out, buys, sells, and other"), in that
   order. Any number may be on at once — a transaction shows when it is in ANY chosen one; none on is everything ("All").
   A swap of one token for another is in both Buys and Sells (it buys one and sells the other); a mint arrives like a
   transfer in and a burn leaves like a transfer out; Other is the rest: a transaction that moved tokens both ways and was
   not read as a buy or a sell (its receipt unread, or a swap in someone else's transaction), and a self-transfer. */
const TRK_ACT_CATS = [
  ['in', 'Transfers in', 'tokens received (and minted)'], ['out', 'Transfers out', 'tokens sent (and burned)'],
  ['buy', 'Buys', 'buys, and swaps of one token for another'], ['sell', 'Sells', 'sells, and swaps of one token for another'],
  ['other', 'Other', 'transactions that moved tokens both ways and were not read as a buy or a sell (Mixed), and self-transfers'],
];
function trkActCats(a) {
  switch (a.kind) {
    case 'buy': return ['buy'];
    case 'sell': return ['sell'];
    case 'swap': return ['buy', 'sell'];
    case 'in': case 'mint': return ['in'];
    case 'out': case 'burn': return ['out'];
    default: return ['other'];
  }
}
// `cats`: the chosen filters (a Set, or one filter's name); none chosen — or 'all' — matches everything
function trkActMatches(a, cats) {
  if (cats == null || cats === 'all') return true;
  const set = typeof cats === 'string' ? new Set([cats]) : cats;
  return !set.size || trkActCats(a).some(c => set.has(c));
}
/* The date range (owner, 2026-10-22: "add a date range filter to the wallet tracker transactions"): a span back from now,
   or chosen days in the reader's own time zone — the zone the rows' dates are shown in — From's first moment to To's last
   (either may be left empty: open-ended; From after To is read the other way round). A transaction whose block time was
   not read has no date, so a range leaves it out, and the list says how many. */
const TRK_ACT_RANGES = [['all', 'All time'], ['1d', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['365d', 'Last 12 months'], ['custom', 'Choose dates…']];
const trkDayStart = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };
const trkYmd = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
// { from, to } in ms (either may be null: open-ended), or null when every date counts
function trkActBounds(S, nowMs) {
  const r = S.actRange || 'all';
  if (r === 'all') return null;
  if (r !== 'custom') { const days = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365 }[r]; return days ? { from: nowMs - days * 864e5, to: null } : null; }
  let a = trkDayStart(S.actFrom), b = trkDayStart(S.actTo);
  if (a != null && b != null && a > b) { const t = a; a = b; b = t; }
  if (a == null && b == null) return null;
  // To's last moment: the next local midnight, less one (a day is not always 24 hours where clocks change)
  const end = b == null ? null : (() => { const d = new Date(b); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1; })();
  return { from: a, to: end };
}
const trkActInRange = (a, b) => !b || (a.ts != null && (b.from == null || a.ts >= b.from) && (b.to == null || a.ts <= b.to));
function trkLegLine(l) {
  const sign = l.dir === 'in' ? '+' : '−';
  const name = (l.cash ? '' : '$') + trkEsc(l.symbol);
  if (l.qty == null) return '<div class="a-leg">' + sign + ' ' + name + ' — amount unread (unknown decimals), raw <code>' + trkEsc(l.raw) + '</code></div>';
  return '<div class="a-leg">' + sign + trkQty(l.qty) + ' ' + name + '</div>';
}
function trkValuation(a) {
  const eth = (w, u) => [w > 0 ? trkEth(w) : '', u > 0 ? '$' + u.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDG' : ''].filter(Boolean).join(' + ');
  const paid = eth(a.wethPaid, a.usdgPaid), got = eth(a.wethGot, a.usdgGot);
  if (a.kind === 'buy') return paid ? 'paid ' + paid + (a.unvalued ? ' · partly not valued' : '') : 'not valued';
  if (a.kind === 'sell') return got ? 'got ' + got + (a.unvalued ? ' · partly not valued' : '') : 'not valued';
  if (a.kind === 'swap') {
    const outs = a.legs.filter(l => l.dir === 'out' && !l.cash).map(l => '$' + l.symbol), ins = a.legs.filter(l => l.dir === 'in' && !l.cash).map(l => '$' + l.symbol);
    const through = paid && got && paid !== got ? got + ' out → ' + paid + ' in' : (paid || got);
    return 'swapped −' + trkEsc(outs.join(', ') || '…') + ' → +' + trkEsc(ins.join(', ') || '…') + (through ? ' (' + through + ' through the pools)' : ' (not valued)');
  }
  return '';
}
function trkActivityHTML(r, P, S, exp) {
  let html = '<section class="trk-activity" aria-labelledby="' + S.uid + '-act-h"><div class="trk-h-row"><h3 id="' + S.uid + '-act-h" class="trk-h">Transactions</h3></div>';
  const txc = r.txCounts;
  const all = Array.isArray(r.activity) ? r.activity : null;
  if (!all) {
    html += '<p class="modal-note">' + (r.activityTrimmed ? 'This saved copy left out its ' + trkN(r.activityTrimmed) + ' transactions (too large to keep) — hit Refresh to read them from the chain.' : 'This saved report predates the transactions list — hit Refresh to read it from the chain.') + '</p></section>';
    return html;
  }
  const tokens = new Map();
  for (const a of all) for (const l of a.legs) if (!tokens.has(l.token)) tokens.set(l.token, l.symbol);
  const bounds = trkActBounds(S, Date.now());
  const tokenRows = S.actToken ? all.filter(a => a.legs.some(l => l.token === S.actToken)) : all;
  const ofToken = bounds ? tokenRows.filter(a => trkActInRange(a, bounds)) : tokenRows;   // the token and the dates: what the type counts are of
  const untimed = bounds ? tokenRows.filter(a => a.ts == null).length : 0;
  const filtered = ofToken.filter(a => trkActMatches(a, S.actKinds));
  const shown = filtered.slice(0, TRK_PAGE * S.actPages);
  // how many of the chosen token's transactions in the chosen dates each filter holds (a swap counts in Buys and in Sells)
  const counts = { in: 0, out: 0, buy: 0, sell: 0, other: 0 };
  for (const a of ofToken) for (const c of trkActCats(a)) counts[c]++;
  // the count is a number on screen; a screen reader hears "Transfers in (3 transactions)"
  const chip = (k, lbl, tip, on, n) => '<button class="react-btn' + (on ? ' lit' : '') + '" data-tip="' + tip + '" type="button" data-act-filter="' + k + '" data-trk-key="act:' + k + '" aria-pressed="' + on + '">' + (on ? '✓ ' : '') + lbl +
    (n == null ? '' : ' <span class="trk-act-n"><span class="sr-only">(</span>' + trkN(n) + '<span class="sr-only"> ' + (n === 1 ? 'transaction' : 'transactions') + ')</span></span>') + '</button>';
  // each tip says what a click on it does from here: narrow to it, add it, take it out, or (the last one on) show every type again
  const sw = { buy: 'sell', sell: 'buy' }, swName = { buy: 'Buys', sell: 'Sells' };
  const tipFor = (k, what) => {
    if (!S.actKinds.size) return 'Shows only ' + what;
    if (!S.actKinds.has(k)) return 'Also includes ' + what;
    if (S.actKinds.size === 1) return 'Turns this filter off and shows every type again';
    return 'Stops including ' + what + (sw[k] && S.actKinds.has(sw[k]) ? ' (swaps stay while ' + swName[sw[k]] + ' is on)' : '');
  };
  html += '<div class="trk-act-tools" role="group" aria-label="Filter transactions — choose one or more">' +
    // a pressed filter carries the same "✓ " text prefix as the report toggles: its state is never fill colour alone
    chip('all', 'All', S.actToken || bounds ? 'Clears the type filters (the ' + (S.actToken && bounds ? 'token and date choices stay' : S.actToken ? 'token choice stays' : 'date choice stays') + ')' : 'Clears the type filters and shows every transaction', !S.actKinds.size, null) +
    TRK_ACT_CATS.map(([k, lbl, what]) => chip(k, lbl, tipFor(k, what), S.actKinds.has(k), counts[k])).join('') +
    '<span class="trk-act-tokwrap"><label class="trk-act-tok" for="' + S.uid + '-act-token">Token</label>' +
    '<select id="' + S.uid + '-act-token" data-tip="Shows only transactions that moved the chosen token" data-act-token data-trk-key="act:token"><option value="">All tokens</option>' +
    [...tokens.entries()].sort((x, y) => String(x[1]).localeCompare(String(y[1]))).map(([addr, sym]) => '<option value="' + trkEsc(addr) + '"' + (S.actToken === addr ? ' selected' : '') + '>' + trkEsc(sym) + '</option>').join('') +
    '</select></span>' +   // the label and its select wrap as one, never "Token" at a line's end and the select on the next
    // the date controls go together: the span and, when days are chosen, From and To — never To alone on the next line
    '<span class="trk-act-dates"><span class="trk-act-tokwrap"><label class="trk-act-tok" for="' + S.uid + '-act-range">Dates</label>' +
    '<select id="' + S.uid + '-act-range" data-tip="Shows only transactions from the chosen span of time" data-act-range data-trk-key="act:range">' +
    TRK_ACT_RANGES.map(([k, lbl]) => '<option value="' + k + '"' + ((S.actRange || 'all') === k ? ' selected' : '') + '>' + lbl + '</option>').join('') + '</select></span>' +
    (S.actRange === 'custom'
      // native date fields: the reader's own calendar and locale; each bounds the other in the picker
      ? '<span class="trk-act-tokwrap"><label class="trk-act-tok" for="' + S.uid + '-act-from">From</label><input type="date" id="' + S.uid + '-act-from" value="' + trkEsc(S.actFrom || '') + '"' + (S.actTo ? ' max="' + trkEsc(S.actTo) + '"' : '') + ' data-tip="The first day to include, in your own time zone (leave empty for no start)" data-act-from data-trk-key="act:from"></span>' +
        '<span class="trk-act-tokwrap"><label class="trk-act-tok" for="' + S.uid + '-act-to">To</label><input type="date" id="' + S.uid + '-act-to" value="' + trkEsc(S.actTo || '') + '"' + (S.actFrom ? ' min="' + trkEsc(S.actFrom) + '"' : '') + ' data-tip="The last day to include, in your own time zone (leave empty for up to today)" data-act-to data-trk-key="act:to"></span>'
      : '') + '</span>' +
    // no role=status: the zone is rebuilt by innerHTML on every re-render, so a live region here would be a new one each
    // time (re-spoken on an unrelated toggle on VoiceOver, never on NVDA/JAWS); the count is announced by trkWire
    // through the page's one persistent live region (window.announce) when a filter, the token or the page changes
    '<p class="trk-act-count">Showing ' + trkN(shown.length) + ' of ' + trkN(filtered.length) + '</p></div>';
  if (untimed) html += '<p class="modal-note">' + trkPlural(untimed, 'transaction') + ' with no block time read ' + (untimed === 1 ? 'is' : 'are') + ' left out while a date range is on — ' + (untimed === 1 ? 'its' : 'their') + ' date is not known.</p>';
  if (!filtered.length) html += '<p class="modal-note">No transactions match ' + (S.actKinds.size + (S.actToken ? 1 : 0) + (bounds ? 1 : 0) > 1 ? 'these filters' : 'this filter') + '.</p>';
  else {
    const rows = shown.map((a, i) => {
      const K = TRK_KINDS[a.kind] || TRK_KINDS.mixed;
      const kindTxt = a.viaOthers ? (a.kind === 'in' ? 'Transfer in (from a swap in someone else’s transaction)' : a.kind === 'out' ? 'Transfer out (by a swap in someone else’s transaction)' : K[1] + ' (in someone else’s transaction)') : K[1];
      const valn = trkValuation(a);
      return '<tr role="row" class="trk-arow kind-' + trkEsc(a.kind) + '" data-i="' + i + '">' +
        '<td role="cell" data-l="When" class="c-when">' + (a.ts ? '<span class="a-date">' + trkEsc(trkDate(a.ts)) + '</span><span class="a-time">' + trkEsc(trkTime(a.ts)) + '</span>' : '<span class="a-date">block ' + trkN(a.block) + '</span>') + '</td>' +
        '<td role="cell" data-l="Type"><span class="a-kind a-kind-' + trkEsc(a.kind) + '"><span aria-hidden="true">' + K[0] + '</span> ' + trkEsc(kindTxt) + '</span></td>' +
        '<td role="cell" data-l="What moved">' + a.legs.map(trkLegLine).join('') + (valn ? '<div class="a-val">' + valn + '</div>' : '') + '</td>' +
        '<td role="cell" data-l="Tx" class="c-tx"><a class="a-tx" href="' + exp + '/tx/' + trkSeg(a.hash) + '" target="_blank" rel="noopener" data-trk-key="tx:' + trkEsc(a.hash) + '" aria-label="Transaction ' + trkEsc(a.hash.slice(0, 10)) + '… on the explorer">↗</a></td></tr>';
    }).join('');
    html += '<div class="trk-scroll"><table class="trk-atable" role="table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">When</th><th role="columnheader" scope="col">Type</th><th role="columnheader" scope="col">What moved</th><th role="columnheader" scope="col">Tx</th></tr></thead><tbody role="rowgroup">' + rows + '</tbody></table></div>';
  }
  html += '<div class="trk-act-btns">' +
    (filtered.length > shown.length ? '<button class="btn btn-ghost btn-sm" data-tip="Shows the next 50 transactions" type="button" data-act-more data-trk-key="act:more">Show 50 more</button>' : '') +
    (filtered.length ? '<button class="btn btn-ghost btn-sm" data-tip="' + (filtered.length < all.length ? 'Downloads the ' + trkPlural(filtered.length, 'transaction') + ' the filters show as a CSV file' : 'Downloads every listed transaction as a CSV file') + '" type="button" data-act-csv data-trk-key="act:csv">Download CSV</button>' : '') +
    '</div>';
  const sent = txc ? txc.sent : null, isC = txc ? txc.isContract : false, deleg = txc ? txc.delegated : false;
  const listed = txc ? txc.listed : all.filter(a => !a.self).length, nft = txc ? txc.nft : (r.info && r.info.nftTransfers) || 0;
  html += '<p class="modal-note">' + (isC ? '— (a contract’s nonce counts contracts it created)' : (sent == null ? '—' : trkN(sent)) + ' transactions sent by this wallet (its nonce)') +
    (deleg ? ' · smart-account operations run inside other transactions and are not counted' : '') +
    ' · ' + trkN(listed) + ' transactions moved a token to or from it, whoever sent them — those are listed. Plain ETH transfers and contract calls that move no token leave no log on the chain and are not listed.' +
    (nft ? ' ' + trkN(nft) + ' NFT transfers counted, not listed.' : '') + '</p>';
  if (r.activityTrimmed) html += '<p class="modal-note">This saved copy keeps the newest ' + trkN(all.length) + ' of its ' + trkN(r.activityTrimmed) + ' transactions — hit Refresh to read the full list from the chain.</p>';
  html += '</section>';
  return html;
}

/* ---- wiring: one delegated listener per zone, reading the latest report from zone._trkCtx ---- */
function trkWire(zone) {
  if (zone._trkWired) return;
  zone._trkWired = true;
  const rerender = (key) => {
    const S = trkState(zone); if (key) S.focusKey = key;
    const c = zone._trkCtx; if (!c) return;
    renderTracker(zone, c.r, c.P);
  };
  // the transactions count ("Showing 50 of 61") is spoken through the page's one persistent live region, only when a
  // filter, the token or the page changed it — never on an unrelated toggle's re-render
  const sayCount = () => {
    const p = zone.querySelector('.trk-act-count');
    if (p && typeof window !== 'undefined' && typeof window.announce === 'function') window.announce(p.textContent);
  };
  zone.addEventListener('click', (e) => {
    const c = zone._trkCtx; if (!c) return;
    const S = trkState(zone);
    const tog = e.target.closest('[data-trk-toggle]');
    if (tog && zone.contains(tog)) {
      const k = tog.dataset.trkToggle;
      c.P[k] = !c.P[k];
      // the zone is redrawn below, so the generic switch sound would read the old button's state: say the new one here
      if (typeof window !== 'undefined' && window.SFX) { if (c.P[k]) window.SFX.play('on'); else window.SFX.play('off'); }
      rerender('toggle:' + k);
      if (typeof window !== 'undefined' && window.saveTrackerPrefs) window.saveTrackerPrefs(c.P);
      return;
    }
    const more = e.target.closest('[data-trk-more]');
    if (more && zone.contains(more)) {
      const a = more.dataset.trkMore, open = more.getAttribute('aria-expanded') !== 'true';
      if (open) S.openToks.add(a); else S.openToks.delete(a);
      more.setAttribute('aria-expanded', String(open));
      const panel = zone.querySelector('#' + more.getAttribute('aria-controls').replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
      if (panel) {
        // a closed row is emitted empty: build the token's panel on its first open (the page's ⓘ observer decorates it)
        if (open && panel.firstElementChild && !panel.firstElementChild.childElementCount) { const t = c.r.tokens.find(x => x.address === a); if (t) panel.firstElementChild.innerHTML = trkDetailHTML(c.r, t, c.P); }
        panel.hidden = !open;
      }
      return;
    }
    const defs = e.target.closest('[data-trk-defs]');
    if (defs && zone.contains(defs)) {
      S.defsOpen = defs.getAttribute('aria-expanded') !== 'true';
      defs.setAttribute('aria-expanded', String(S.defsOpen));
      const panel = zone.querySelector('#' + defs.getAttribute('aria-controls').replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
      if (panel) panel.hidden = !S.defsOpen;
      return;
    }
    const f = e.target.closest('[data-act-filter]');
    if (f && zone.contains(f)) {
      const k = f.dataset.actFilter;
      if (k === 'all') S.actKinds.clear();
      else if (S.actKinds.has(k)) S.actKinds.delete(k);
      else S.actKinds.add(k);
      S.actPages = 1;
      // the zone is redrawn with every chip's state (aria-pressed, the lit fill and the "✓ " prefix together), and the
      // focus stays on the chip pressed
      rerender('act:' + k); sayCount(); return;
    }
    const m = e.target.closest('[data-act-more]');
    if (m && zone.contains(m)) {
      const before = zone.querySelectorAll('.trk-arow').length;
      S.actPages++;
      rerender('act:more');
      const rows = zone.querySelectorAll('.trk-arow');
      const first = rows[before] || rows[rows.length - 1];
      const link = first && first.querySelector('.a-tx');
      if (link) link.focus();                                           // the first new row's Tx link; window.announce speaks the new total
      sayCount();
      return;
    }
    const csv = e.target.closest('[data-act-csv]');
    if (csv && zone.contains(csv)) { trkDownloadCsv(c.r, trkActShown(c.r, S)); return; }
  });
  zone.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.closest || !zone.contains(t)) return;
    const S = trkState(zone);
    if (t.closest('[data-act-token]')) { S.actToken = t.value; S.actPages = 1; rerender('act:token'); sayCount(); return; }
    if (t.closest('[data-act-range]')) {
      S.actRange = t.value; S.actPages = 1;
      // choosing dates starts from the last 30 days, today included, for the reader to move
      if (S.actRange === 'custom' && !S.actFrom && !S.actTo) { const n = Date.now(); S.actFrom = trkYmd(n - 30 * 864e5); S.actTo = trkYmd(n); }
      rerender('act:range'); sayCount(); return;
    }
    if (t.closest('[data-act-from]') || t.closest('[data-act-to]')) {
      const from = !!t.closest('[data-act-from]');
      const v = /^\d{4}-\d{2}-\d{2}$/.test(t.value) ? t.value : '';   // a cleared field is open-ended
      if (from) S.actFrom = v; else S.actTo = v;
      S.actPages = 1;
      rerender(from ? 'act:from' : 'act:to'); sayCount();
    }
  });
}
// the transactions the filters and the token choice let through, all pages of them
function trkActShown(r, S, nowMs) {
  const all = Array.isArray(r && r.activity) ? r.activity : [];
  const b = trkActBounds(S, nowMs == null ? Date.now() : nowMs);
  return all.filter(a => trkActMatches(a, S.actKinds) && (!S.actToken || a.legs.some(l => l.token === S.actToken)) && trkActInRange(a, b));
}
function trkDownloadCsv(r, rows) {
  if (typeof document === 'undefined' || !r || !Array.isArray(r.activity)) return;
  const csv = csvFrom(rows || r.activity, TRK_EXPLORER);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'wallet-' + String(r.address || '').slice(0, 10) + '-transactions.csv';
  document.body.appendChild(a); a.click(); a.remove();
  if (typeof window !== 'undefined' && window.SFX) window.SFX.play('success');   // the file is saved
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

if (typeof window !== 'undefined') window.TRK = Object.assign(TRK, { activityFrom, seriesFrom, csvFrom, trkUsd, trkEth, trkPrice, trkQty });
