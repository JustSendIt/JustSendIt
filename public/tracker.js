/* ===== Advanced on-chain wallet tracker for Robinhood Chain =====
 * For any address: holdings, full trade history, average-cost basis, realized + unrealized PNL, activity stats.
 * The wallet's whole history is read from the CHAIN by this site's server (GET /api/chain/wallet: every token
 * transfer it ever made, every token it ever touched with its live balance, and — for the wallet's own
 * transactions — what each swap paid and received), prices come from Dexscreener through the same server — so
 * neither learns which IP looks at which wallets — and the report is computed in your browser.
 */

const TRK = {
  prefs: { hideDust: true, showHoldings: true, showTrades: true, showActivity: true, usd: true },
};

/* The server reads the chain as a job (a busy wallet's first read can take a minute or more): it answers 202 with how
   far it has got, then 200 with the history. A busy or throttled answer is waited out; the page only gives up when
   the server reports no progress for five minutes, or says the wallet is too large to read in full. */
async function trkChainWallet(addr, say, fresh, isStale) {
  const STALL = 5 * 60 * 1000;
  let until = Date.now() + STALL, last = '', wait = 0;
  for (let n = 0; ; n++) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    if (isStale && isStale()) throw Object.assign(new Error('superseded'), { superseded: true });   // nobody is waiting for this one any more: stop asking, and the server stops reading
    let res = null, j = null;
    try { res = await fetch('/api/chain/wallet?address=' + encodeURIComponent(addr) + (fresh && n === 0 ? '&fresh=1' : ''), { credentials: 'same-origin', headers: { accept: 'application/json' } }); } catch {}
    if (res) { try { j = await res.json(); } catch {} }
    if (res && res.status === 200 && j && Array.isArray(j.transfers)) { j.ageMs = Math.max(0, Number(res.headers.get('x-read-age-ms')) || 0); return j; }
    if (res && res.status === 202 && j && j.pending) {
      const sig = (j.stage || '') + '|' + (j.done || 0);
      if (sig !== last || j.stage === 'waiting for a turn') { last = sig; until = Date.now() + STALL; }   // progress, or a place in the queue (the server bounds it), resets the clock
      if (say) say(j.ahead ? 'waiting for ' + j.ahead + ' other read' + (j.ahead === 1 ? '' : 's') + ' to finish first…'
        : (j.stage || 'reading the chain') + (j.total ? '… ' + Math.floor(100 * (j.done || 0) / j.total) + '%' : '…'));
      wait = j.stage === 'waiting for a turn' ? 4000 : 2000;
    } else if (res && res.status === 422) {
      const e = new Error((j && j.error) || 'this wallet has too many token transfers to read in full here'); e.permanent = true; throw e;
    } else if (!res || res.status === 429 || res.status === 503 || res.status === 504) {   // busy, throttled or a dropped connection: wait it out
      if (say) say(((j && j.error) || 'the chain reader is busy') + ' — waiting…');
      if (j && j.code === 'mine') until = Date.now() + STALL;               // queued behind another of your own reads: that is progress too
      wait = Math.min(30000, Math.max(2000, wait * 2));
    } else {
      throw new Error((j && j.error) || 'the chain could not be read right now — try again in a minute');
    }
    if (Date.now() > until) throw new Error('the chain read made no progress for five minutes — try again later');
  }
}

/* Build the full report for one address. onProgress(msg) streams status; opts.fresh asks for a new read. */
async function trackerReport(addr, onProgress, opts) {
  addr = addr.toLowerCase();
  const say = m => { if (onProgress) onProgress(m); };

  say('reading the wallet’s whole history from the chain…');
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
    tokenMap[t.address] = { address: t.address, symbol: t.symbol || '?', name: t.name || 'Unknown token', decimals: dec, held, balanceUnread: unread, market: t.market };
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
  say('pricing ' + toPrice.length + ' tokens…');
  const priceFailed = [];
  const prices = await dexPricesFor(toPrice, priceFailed);
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

  say('reconstructing trades…');
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

    const inSide = (g, sum, unread) => {
      const qty = q(g.inRaw);
      if (sum && sum[0] === 1 && !(sum[7] & 1)) {                   // a buy: what the swap took in, in ETH
        const eth = asEth(BigInt(sum[1]), BigInt(sum[2]));
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
      held, balanceUnread: tok.balanceUnread, priceUsd, priceEth, valueUsd, priceUnread,
      pair, hasMarket: !!pair || cash || priceUnread || tok.market === true,
      buys, sells, xfersIn, xfersOut,
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

  return {
    address: addr, source: 'chain', readAt: Date.now() - (Number(h.ageMs) || 0),
    info, ethUsd,
    ethValueUsd: info.ethBalance != null && ethUsd != null ? info.ethBalance * ethUsd : null,
    totalTokenValueUsd: tokens.reduce((s, t) => s + (t.valueUsd || 0), 0),
    tokens, tradedCount: tradedT.length, wins,
    totalRealizedUsd, totalUnrealizedUsd,
    firstSeen, lastSeen,
    transfersAnalyzed: h.transfers.length, historyComplete: !!h.complete,
    holdingsFailed, // true when no balance could be read — render a warning, not zeros
    balancesUnread, portfolioPartial, pricePartial, pricesUnread: priceFailed.length, pnlUnknown,
    legsCapped: !!h.legsCapped, legsRead: Number(h.legsRead) || 0, txsMissing: (h.txsMissing || []).length,
  };
}

/* ===================== rendering ===================== */
function trkUsd(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const s = '$' + abs.toLocaleString('en-US', { maximumFractionDigits: abs < 1 ? 4 : 2 });
  return (n < 0 ? '−' : '') + s;
}
function trkEth(n) {
  if (n == null || isNaN(n)) return '—';
  return (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 4 }) + ' ETH';
}
function trkDate(ts) { return ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }
function trkEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// URL path segments from third-party APIs (addresses, tx hashes, pair ids) — neutralize any breakout chars
function trkSeg(s) { return encodeURIComponent(String(s == null ? '' : s)); }
function pnlSpan(n, fmt) {
  if (n == null) return '<span class="t-pnl">—</span>';
  const cls = n >= 0 ? 'pos' : 'neg';
  const arrow = n >= 0 ? '▲ +' : '▼ ';
  return '<span class="t-pnl ' + cls + '">' + arrow + fmt(Math.abs(n)).replace('−', '') + '</span>';
}

function renderTracker(zone, r, prefs) {
  const P = { ...TRK.prefs, ...(prefs || {}) };
  const money = P.usd ? trkUsd : trkEth;
  const exp = 'https://robinhoodchain.blockscout.com';
  let html = '';

  // customization bar
  html += '<div class="trk-bar" role="group" aria-label="Tracker display options">' +
    trkToggle('hideDust', P.hideDust, 'Hide dust (<$1)') +
    trkToggle('showHoldings', P.showHoldings, 'Holdings') +
    trkToggle('showTrades', P.showTrades, 'Trade history') +
    trkToggle('showActivity', P.showActivity, 'Activity') +
    trkToggle('usd', P.usd, 'Show $ (off = ETH)') +
    '</div>';

  // overview — when the balance read failed, the figures that depend on it are unknown, not $0 (and the warning must show
  // regardless of the Holdings toggle)
  if (r.holdingsFailed) html += '<p class="modal-note trk-warn" role="status">⚠️ Token balances could not be read (the chain didn’t answer) — held amounts show as “unread”, and portfolio value / unrealized PNL are unavailable. Try again in a minute.</p>';
  else if (r.portfolioPartial) html += '<p class="modal-note trk-warn" role="status">⚠️ ' + [r.balancesUnread ? r.balancesUnread + ' token balance' + (r.balancesUnread === 1 ? '' : 's') + ' could not be read' : '', r.pricePartial ? 'some token prices could not be read' : ''].filter(Boolean).join(' and ') + ' — the portfolio value leaves them out, so it is a partial total.</p>';
  if (r.ethUsd == null && r.source === 'chain') html += '<p class="modal-note trk-warn" role="status">⚠️ The ETH price could not be read just now, so dollar figures are unavailable — ETH figures are shown where known.</p>';
  const total = (r.ethValueUsd || 0) + r.totalTokenValueUsd;
  const noPrice = r.source === 'chain' && r.ethUsd == null;
  html += '<div class="trk-grid">' +
    trkStat('Portfolio value', r.holdingsFailed || noPrice ? '—' : trkUsd(total) + (r.portfolioPartial ? ' (partial)' : ''), r.holdingsFailed || noPrice ? '' : 'green') +
    trkStat('ETH balance', (r.info.ethBalance != null ? r.info.ethBalance.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—') + ' ETH', '') +
    trkStat('Unrealized PNL', r.holdingsFailed || r.totalUnrealizedUsd == null ? '—' : money(P.usd ? r.totalUnrealizedUsd : r.totalUnrealizedUsd / (r.ethUsd || 1)), r.holdingsFailed || r.totalUnrealizedUsd == null ? '' : (r.totalUnrealizedUsd >= 0 ? 'green' : 'red')) +
    trkStat('Realized PNL', r.totalRealizedUsd == null ? '—' : money(P.usd ? r.totalRealizedUsd : r.totalRealizedUsd / (r.ethUsd || 1)), r.totalRealizedUsd == null ? '' : (r.totalRealizedUsd >= 0 ? 'green' : 'red')) +
    '</div>';

  if (P.showActivity) {
    html += '<div class="trk-grid">' +
      trkStat('Tokens traded', r.tradedCount + (r.tradedCount && r.wins != null && !(r.source === 'chain' && r.ethUsd == null) ? ' (' + r.wins + ' in profit' + (r.pnlUnknown ? ', ' + r.pnlUnknown + ' unknown' : '') + ')' : ''), '') +
      trkStat(r.source === 'chain' ? 'Transactions sent' : 'Transactions', r.info.txCount.toLocaleString(), '') +   // a report saved before the chain read counted both directions
      trkStat('First activity', trkDate(r.firstSeen), '') +
      trkStat('Last activity', trkDate(r.lastSeen), '') +
      '</div>';
    if (r.info.isContract) html += '<p class="modal-note">⚠️ This address is a smart contract, not a personal wallet.</p>';
    else if (r.info.delegated) html += '<p class="modal-note">This wallet has delegated to smart-account code (EIP-7702) — it is still a personal wallet.</p>';
  }

  if (P.showHoldings) {
    html += '<h4 class="trk-h">Holdings & PNL by token</h4>';
    let shown = 0;
    for (const t of r.tokens) {
      if (P.hideDust && !(t.balanceUnread && t.hasMarket) && !(t.priceUnread && t.held > 0) && (t.valueUsd == null || t.valueUsd < 1) && t.buys + t.sells === 0) continue;   // the rows a partial total is warning about stay visible
      shown++;
      // the token's PNL as the report knows it: null (shown "—") when any part is unknown; a report saved before this read summed the parts
      const pnlShown = 'pnlEth' in t ? (P.usd ? t.pnlUsd : t.pnlEth) : (r.ethUsd != null ? (P.usd ? (t.realizedUsd || 0) + (t.unrealizedUsd || 0) : ((t.realizedUsd || 0) + (t.unrealizedUsd || 0)) / r.ethUsd) : null);
      html += '<details class="trk-token" data-tok="' + trkEsc(t.address) + '">' +
        '<summary>' +
          '<span class="t-sym">' + trkEsc(t.symbol) + '</span>' +
          '<span class="t-bal">' + (t.balanceUnread ? 'unread' : t.held.toLocaleString('en-US', { maximumFractionDigits: t.held < 1 ? 6 : 0 })) + '</span>' +   // unread: no balance, or no decimals to scale it by
          (t.cash ? '<span class="t-pnl">cash</span>' : t.buys + t.sells > 0 ? pnlSpan(pnlShown, money) : '<span class="t-pnl">' + (t.priceUnread ? 'price unread' : t.hasMarket ? 'no trades' : 'no market') + '</span>') +
          '<span class="t-val">' + trkUsd(t.valueUsd) + '</span>' +
        '</summary>' +
        '<div class="trk-token-body">' +
          '<div class="trk-grid trk-grid-tight">' +
            trkStat('Avg entry', t.avgCostEth != null && t.avgCostEth > 0 ? t.avgCostEth.toExponential(3) + ' ETH' : '—', '') +
            trkStat('Spent on buys', trkEth(t.ethSpent || null), '') +
            trkStat('Sell proceeds', trkEth(t.ethReceived || null), '') +
            trkStat('Realized', pnlRaw(P.usd ? t.realizedUsd : t.realizedEth, money), (t.realizedUsd || 0) >= 0 ? 'green' : 'red') +
            trkStat('Unrealized', pnlRaw(P.usd ? t.unrealizedUsd : t.unrealizedEth, money), (t.unrealizedUsd || 0) >= 0 ? 'green' : 'red') +
            trkStat('Buys / Sells / Xfers', t.buys + ' / ' + t.sells + ' / ' + (t.xfersIn + t.xfersOut), '') +
          '</div>' +
          (t.costUnknown ? '<p class="modal-note">Some of this token\'s trades could not be valued (a receipt the chain did not give, a swap that cannot be split, or a leg with no ETH price right now)' + (t.pnlEth == null ? ' — so its PNL is unknown, and left out of the totals.' : ' — PNL is partial.') + '</p>' : '') +
          (t.fromOthers ? '<p class="modal-note">' + t.fromOthers + ' transfer' + (t.fromOthers === 1 ? '' : 's') + ' in came from a swap in someone else\'s transaction (a reward, a gift, or a bridge or solver fill) — counted at zero cost, like any transfer in.</p>' : '') +
          (t.legsUnread ? '<p class="modal-note">' + t.legsUnread + ' transaction' + (t.legsUnread === 1 ? '' : 's') + ' of this token could not be read (or lie beyond the newest ' + (r.legsRead || 0).toLocaleString('en-US') + ' read) — listed as transfers, not valued.</p>' : '') +
          (P.showTrades && t.trades.length ? trkTradeTable(t, exp) : '') +
          '<p class="modal-note"><a href="' + exp + '/token/' + trkSeg(t.address) + '" target="_blank" rel="noopener">token on explorer ↗</a>' +
          (t.pair ? ' · <a href="https://dexscreener.com/robinhood/' + trkSeg(t.pair) + '" target="_blank" rel="noopener">chart ↗</a>' : '') + '</p>' +
        '</div>' +
      '</details>';
    }
    if (!shown) html += '<p class="modal-note">Nothing above the dust filter — toggle it off to see everything.</p>';
  }

  html += '<p class="modal-note">Analyzed ' + Number(r.transfersAnalyzed || 0).toLocaleString('en-US') + ' token transfers' +
    (r.historyComplete ? ' — the full history, read from the chain' : ' (most recent — very deep histories are truncated)') +
    (r.legsCapped ? ' · trades older than the newest ' + Number(r.legsRead || 0).toLocaleString('en-US') + ' transactions are not valued' : '') +
    (r.txsMissing ? ' · ' + r.txsMissing + ' transaction' + (r.txsMissing === 1 ? '' : 's') + ' could not be read — not valued' : '') +
    (r.pricesUnread ? ' · some prices could not be read' : '') +
    (r.lookupsCapped ? ' · some trade legs unvalued (lookup cap)' : '') +
    (r.balancesUnread ? ' · ' + r.balancesUnread + ' token balance' + (r.balancesUnread === 1 ? '' : 's') + ' could not be read' : '') +
    (r.info && r.info.nftTransfers ? ' · ' + r.info.nftTransfers.toLocaleString('en-US') + ' NFT transfer' + (r.info.nftTransfers === 1 ? '' : 's') + ' (not valued)' : '') +
    ' · a buy or sell is a swap in a transaction the wallet sent, straight with a pool or through any router; tax is part of its cost · WETH and USDG count as cash · average-cost basis · transfers-in count as zero-cost · USD uses today\'s ETH price · plain ETH sent between wallets leaves no log, so only the live ETH balance is shown · <a href="' + exp + '/address/' + trkSeg(r.address) + '" target="_blank" rel="noopener">full explorer view ↗</a></p>';

  zone.innerHTML = html;

  // wire toggles
  zone.querySelectorAll('[data-trk-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.trkToggle;
      P[k] = !P[k];
      renderTracker(zone, r, P);
      const nb = zone.querySelector('[data-trk-toggle="' + k + '"]'); if (nb) nb.focus();   // the zone re-rendered under the pressed toggle
      if (window.saveTrackerPrefs) window.saveTrackerPrefs(P);
    });
  });
}
function pnlRaw(n, fmt) { return n == null ? '—' : (n >= 0 ? '+' : '−') + fmt(Math.abs(n)).replace('−', ''); }
function trkStat(label, val, cls) {
  return '<div class="hstat"><div class="lbl">' + label + '</div><div class="val ' + (cls || '') + '">' + val + '</div></div>';
}
function trkToggle(key, on, label) {
  return '<button class="react-btn' + (on ? ' lit' : '') + '" data-trk-toggle="' + key + '" aria-pressed="' + on + '" data-tip="Turns this report option on or off and remembers your choice">' + (on ? '✓ ' : '') + label + '</button>';
}
function trkTradeTable(t, exp) {
  const rows = t.trades.slice(0, 40).map(tr => {
    const label = { buy: '🟢 Buy', sell: '🔴 Sell', in: '📥 In', out: '📤 Out' }[tr.side];
    return '<tr><td>' + label + '</td>' +
      '<td>' + (tr.qty == null ? '—' : tr.qty.toLocaleString('en-US', { maximumFractionDigits: 0 })) + '</td>' +
      '<td>' + (tr.eth != null ? tr.eth.toLocaleString('en-US', { maximumFractionDigits: 5 }) + ' ETH' : '—') + '</td>' +
      '<td>' + (tr.ts ? new Date(tr.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—') + '</td>' +
      '<td><a href="' + exp + '/tx/' + trkSeg(tr.hash) + '" target="_blank" rel="noopener" aria-label="View transaction on explorer">tx ↗</a></td></tr>';
  }).join('');
  return '<div style="overflow-x:auto;"><table class="trk-table"><thead><tr><th>Side</th><th>Amount</th><th>ETH leg</th><th>Date</th><th>Tx</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    (t.trades.length > 40 ? '<p class="modal-note">Showing latest 40 of ' + t.trades.length + ' trades.</p>' : '') + '</div>';
}
