/* ===== Advanced on-chain wallet tracker for Robinhood Chain =====
 * For any address: holdings, full trade history vs DEX pools, average-cost
 * basis, realized + unrealized PNL, activity stats. All data straight from
 * the public RPC / Blockscout / Dexscreener — computed in your browser.
 */

const TRK = {
  MAX_TRANSFER_PAGES: 8,   // 50 per page => up to 400 transfers analyzed
  MAX_TX_LOOKUPS: 60,      // per wallet: buy/sell ETH-leg lookups
  txCache: {},
  prefs: { hideDust: true, showHoldings: true, showTrades: true, showActivity: true, usd: true },
};

async function trkAddressInfo(addr) {
  const [info, counters] = await Promise.all([
    bsFetch('/api/v2/addresses/' + addr).catch(() => ({})),
    bsFetch('/api/v2/addresses/' + addr + '/counters').catch(() => ({})),
  ]);
  return {
    ethBalance: info.coin_balance != null ? toNum(BigInt(info.coin_balance), 18) : null,
    isContract: !!info.is_contract,
    txCount: Number(counters.transactions_count) || 0,
    transferCount: Number(counters.token_transfers_count) || 0,
    gasUsed: Number(counters.gas_usage_count) || 0,
  };
}

async function trkAllTransfers(addr, onProgress) {
  const items = [];
  let params = '';
  for (let page = 0; page < TRK.MAX_TRANSFER_PAGES; page++) {
    const j = await bsFetch('/api/v2/addresses/' + addr + '/token-transfers' + params);
    items.push(...(j.items || []));
    if (onProgress) onProgress('reading history… ' + items.length + ' transfers');
    if (!j.next_page_params) return { items, complete: true };
    params = '?' + new URLSearchParams(j.next_page_params).toString();
  }
  return { items, complete: false };
}

async function trkTxEthLegs(hash) {
  // ETH spent (tx.value) and WETH received-from-pool (sell proceeds) for one tx
  if (TRK.txCache[hash]) return TRK.txCache[hash];
  const out = { ethIn: 0, wethLegs: [] };
  try {
    const tx = await bsFetch('/api/v2/transactions/' + hash);
    out.ethIn = toNum(BigInt(tx.value || '0'), 18);
  } catch {}
  try {
    const tt = await bsFetch('/api/v2/transactions/' + hash + '/token-transfers');
    for (const t of tt.items || []) {
      const tokAddr = ((t.token && (t.token.address_hash || t.token.address)) || '').toLowerCase();
      if (tokAddr === WETH.toLowerCase()) {
        out.wethLegs.push({
          from: ((t.from && t.from.hash) || '').toLowerCase(),
          to: ((t.to && t.to.hash) || '').toLowerCase(),
          amount: toNum(BigInt((t.total && t.total.value) || '0'), 18),
        });
      }
    }
  } catch {}
  TRK.txCache[hash] = out;
  return out;
}

/* Build the full report for one address. onProgress(msg) streams status. */
async function trackerReport(addr, onProgress) {
  addr = addr.toLowerCase();
  const say = m => { if (onProgress) onProgress(m); };

  say('reading account…');
  const [info, holdingsRes, transfersRes] = await Promise.all([
    trkAddressInfo(addr),
    walletErc20s(addr).then(list => ({ ok: true, list })).catch(() => ({ ok: false, list: [] })), // a failed read must never masquerade as "$0 held"
    trkAllTransfers(addr, say),
  ]);
  const holdings = holdingsRes.list, holdingsFailed = !holdingsRes.ok;
  const { items: transfers, complete } = transfersRes;

  // every token this wallet held OR traded
  const tokenMap = {};
  for (const h of holdings) tokenMap[h.address] = { ...h, held: h.balance };
  for (const t of transfers) {
    const a = ((t.token && (t.token.address_hash || t.token.address)) || '').toLowerCase();
    if (!a || a === WETH.toLowerCase()) continue;
    if (!tokenMap[a]) {
      tokenMap[a] = {
        address: a,
        symbol: (t.token && t.token.symbol) || '?',
        name: (t.token && t.token.name) || 'Unknown token',
        decimals: Number(t.token && t.token.decimals) || 18,
        held: 0,
      };
    }
  }
  const tokenAddrs = Object.keys(tokenMap);
  say('pricing ' + tokenAddrs.length + ' tokens…');
  const prices = await dexPricesFor(tokenAddrs);

  let ethUsd = null;
  for (const a of Object.keys(prices)) {
    const p = prices[a];
    if (p.priceUsd && p.priceNative && Number(p.priceNative) > 0) { ethUsd = Number(p.priceUsd) / Number(p.priceNative); break; }
  }

  // group transfers per token, oldest first
  const byToken = {};
  for (const t of transfers) {
    const a = ((t.token && (t.token.address_hash || t.token.address)) || '').toLowerCase();
    if (!a || !tokenMap[a]) continue;
    (byToken[a] = byToken[a] || []).push(t);
  }

  say('reconstructing trades…');
  let lookups = 0;
  const tokens = [];
  let firstSeen = null, lastSeen = null;

  for (const a of tokenAddrs) {
    const tok = tokenMap[a];
    const p = prices[a];
    const pair = p && p.pairAddress ? p.pairAddress.toLowerCase() : null;
    const priceUsd = p ? Number(p.priceUsd) : null;
    const priceEth = p ? Number(p.priceNative) : null;

    const list = (byToken[a] || []).slice().reverse(); // oldest first
    const trades = [];
    let qtyHeldCalc = 0, avgCostEth = 0;          // running average-cost basis (ETH per token)
    let buys = 0, sells = 0, xfersIn = 0, xfersOut = 0;
    let ethSpent = 0, ethReceived = 0, realizedEth = 0;
    let costUnknown = false;

    for (const t of list) {
      const from = ((t.from && t.from.hash) || '').toLowerCase();
      const to = ((t.to && t.to.hash) || '').toLowerCase();
      const qty = toNum(BigInt((t.total && t.total.value) || '0'), tok.decimals);
      const ts = t.timestamp ? Date.parse(t.timestamp) : null;
      const hash = t.transaction_hash || t.tx_hash;
      if (ts) { if (!firstSeen || ts < firstSeen) firstSeen = ts; if (!lastSeen || ts > lastSeen) lastSeen = ts; }

      if (to === addr && pair && from === pair) {
        // BUY from pool
        buys++;
        let eth = null;
        if (lookups < TRK.MAX_TX_LOOKUPS) {
          lookups++;
          const legs = await trkTxEthLegs(hash);
          eth = legs.ethIn || null;
          if (eth == null || eth === 0) {
            // token-for-token route: value the WETH leg into the pool
            const inLeg = legs.wethLegs.find(l => l.to === pair);
            if (inLeg) eth = inLeg.amount;
          }
        }
        if (eth != null && eth > 0) {
          avgCostEth = (avgCostEth * qtyHeldCalc + eth) / (qtyHeldCalc + qty || 1);
          ethSpent += eth;
        } else costUnknown = true;
        qtyHeldCalc += qty;
        trades.push({ side: 'buy', qty, eth, ts, hash });
      } else if (from === addr && pair && to === pair) {
        // SELL into pool
        sells++;
        let eth = null;
        if (lookups < TRK.MAX_TX_LOOKUPS) {
          lookups++;
          const legs = await trkTxEthLegs(hash);
          const outLeg = legs.wethLegs.find(l => l.from === pair);
          if (outLeg) eth = outLeg.amount;
        }
        if (eth != null) {
          ethReceived += eth;
          realizedEth += eth - avgCostEth * qty;
        } else costUnknown = true;
        qtyHeldCalc = Math.max(0, qtyHeldCalc - qty);
        trades.push({ side: 'sell', qty, eth, ts, hash });
      } else if (to === addr) {
        xfersIn++;
        qtyHeldCalc += qty; // zero-cost lot: pulls the average down honestly
        avgCostEth = qtyHeldCalc > 0 ? (avgCostEth * (qtyHeldCalc - qty)) / qtyHeldCalc : 0;
        trades.push({ side: 'in', qty, eth: null, ts, hash });
      } else if (from === addr) {
        xfersOut++;
        qtyHeldCalc = Math.max(0, qtyHeldCalc - qty);
        trades.push({ side: 'out', qty, eth: null, ts, hash });
      }
    }

    const held = tok.held || 0;
    const valueUsd = priceUsd != null ? held * priceUsd : null;
    const unrealizedEth = (priceEth != null && held > 0) ? held * priceEth - avgCostEth * held : null;
    tokens.push({
      address: a, symbol: tok.symbol, name: tok.name, decimals: tok.decimals,
      held, priceUsd, priceEth, valueUsd,
      pair, hasMarket: !!pair,
      buys, sells, xfersIn, xfersOut,
      ethSpent, ethReceived,
      avgCostEth: avgCostEth || null,
      realizedEth: (buys + sells) > 0 ? realizedEth : null,
      unrealizedEth,
      realizedUsd: realizedEth != null && ethUsd != null && (buys + sells) > 0 ? realizedEth * ethUsd : null,
      unrealizedUsd: unrealizedEth != null && ethUsd != null ? unrealizedEth * ethUsd : null,
      costUnknown,
      trades: trades.reverse(), // newest first for display
    });
  }

  tokens.sort((x, y) => (y.valueUsd || 0) - (x.valueUsd || 0));
  const traded = tokens.filter(t => t.buys + t.sells > 0);
  const totalRealizedUsd = traded.reduce((s, t) => s + (t.realizedUsd || 0), 0);
  const totalUnrealizedUsd = tokens.reduce((s, t) => s + (t.unrealizedUsd || 0), 0);
  const wins = traded.filter(t => ((t.realizedUsd || 0) + (t.unrealizedUsd || 0)) > 0).length;

  return {
    address: addr,
    info, ethUsd,
    ethValueUsd: info.ethBalance != null && ethUsd != null ? info.ethBalance * ethUsd : null,
    totalTokenValueUsd: tokens.reduce((s, t) => s + (t.valueUsd || 0), 0),
    tokens, tradedCount: traded.length, wins,
    totalRealizedUsd, totalUnrealizedUsd,
    firstSeen, lastSeen,
    transfersAnalyzed: transfers.length, historyComplete: complete,
    holdingsFailed, // true when the holdings read failed — render a warning, not zeros
    lookupsCapped: lookups >= TRK.MAX_TX_LOOKUPS,
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
  if (r.holdingsFailed) html += '<p class="modal-note trk-warn" role="status">⚠️ Token balances could not be read (the explorer didn’t answer) — held amounts show as 0, and portfolio value / unrealized PNL are unavailable. Try again in a minute.</p>';
  const total = (r.ethValueUsd || 0) + r.totalTokenValueUsd;
  html += '<div class="trk-grid">' +
    trkStat('Portfolio value', r.holdingsFailed ? '—' : trkUsd(total), r.holdingsFailed ? '' : 'green') +
    trkStat('ETH balance', (r.info.ethBalance != null ? r.info.ethBalance.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—') + ' ETH', '') +
    trkStat('Unrealized PNL', r.holdingsFailed ? '—' : money(P.usd ? r.totalUnrealizedUsd : r.totalUnrealizedUsd / (r.ethUsd || 1)), r.holdingsFailed ? '' : (r.totalUnrealizedUsd >= 0 ? 'green' : 'red')) +
    trkStat('Realized PNL', money(P.usd ? r.totalRealizedUsd : r.totalRealizedUsd / (r.ethUsd || 1)), r.totalRealizedUsd >= 0 ? 'green' : 'red') +
    '</div>';

  if (P.showActivity) {
    html += '<div class="trk-grid">' +
      trkStat('Tokens traded', r.tradedCount + (r.tradedCount ? ' (' + r.wins + ' in profit)' : ''), '') +
      trkStat('Transactions', r.info.txCount.toLocaleString(), '') +
      trkStat('First activity', trkDate(r.firstSeen), '') +
      trkStat('Last activity', trkDate(r.lastSeen), '') +
      '</div>';
    if (r.info.isContract) html += '<p class="modal-note">⚠️ This address is a smart contract, not a personal wallet.</p>';
  }

  if (P.showHoldings) {
    html += '<h4 class="trk-h">Holdings & PNL by token</h4>';
    let shown = 0;
    for (const t of r.tokens) {
      if (P.hideDust && (t.valueUsd == null || t.valueUsd < 1) && t.buys + t.sells === 0) continue;
      shown++;
      const pnlTotal = (t.realizedUsd || 0) + (t.unrealizedUsd || 0);
      html += '<details class="trk-token">' +
        '<summary>' +
          '<span class="t-sym">' + trkEsc(t.symbol) + '</span>' +
          '<span class="t-bal">' + t.held.toLocaleString('en-US', { maximumFractionDigits: t.held < 1 ? 6 : 0 }) + '</span>' +
          (t.buys + t.sells > 0 ? pnlSpan(P.usd ? pnlTotal : pnlTotal / (r.ethUsd || 1), money) : '<span class="t-pnl">' + (t.hasMarket ? 'no trades' : 'no market') + '</span>') +
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
          (t.costUnknown ? '<p class="modal-note">Some trade legs could not be valued (deep history) — PNL is partial.</p>' : '') +
          (P.showTrades && t.trades.length ? trkTradeTable(t, exp) : '') +
          '<p class="modal-note"><a href="' + exp + '/token/' + trkSeg(t.address) + '" target="_blank" rel="noopener">token on explorer ↗</a>' +
          (t.pair ? ' · <a href="https://dexscreener.com/robinhood/' + trkSeg(t.pair) + '" target="_blank" rel="noopener">chart ↗</a>' : '') + '</p>' +
        '</div>' +
      '</details>';
    }
    if (!shown) html += '<p class="modal-note">Nothing above the dust filter — toggle it off to see everything.</p>';
  }

  html += '<p class="modal-note">Analyzed ' + r.transfersAnalyzed + ' transfers' +
    (r.historyComplete ? ' (full history)' : ' (most recent — very deep histories are truncated)') +
    (r.lookupsCapped ? ' · some trade legs unvalued (lookup cap)' : '') +
    ' · average-cost basis · transfers-in count as zero-cost · USD uses today\'s ETH price · <a href="' + exp + '/address/' + trkSeg(r.address) + '" target="_blank" rel="noopener">full explorer view ↗</a></p>';

  zone.innerHTML = html;

  // wire toggles
  zone.querySelectorAll('[data-trk-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.trkToggle;
      P[k] = !P[k];
      renderTracker(zone, r, P);
      if (window.saveTrackerPrefs) window.saveTrackerPrefs(P);
    });
  });
}
function pnlRaw(n, fmt) { return n == null ? '—' : (n >= 0 ? '+' : '−') + fmt(Math.abs(n)).replace('−', ''); }
function trkStat(label, val, cls) {
  return '<div class="hstat"><div class="lbl">' + label + '</div><div class="val ' + (cls || '') + '">' + val + '</div></div>';
}
function trkToggle(key, on, label) {
  return '<button class="react-btn' + (on ? ' lit' : '') + '" data-trk-toggle="' + key + '" aria-pressed="' + on + '">' + (on ? '✓ ' : '') + label + '</button>';
}
function trkTradeTable(t, exp) {
  const rows = t.trades.slice(0, 40).map(tr => {
    const label = { buy: '🟢 Buy', sell: '🔴 Sell', in: '📥 In', out: '📤 Out' }[tr.side];
    return '<tr><td>' + label + '</td>' +
      '<td>' + tr.qty.toLocaleString('en-US', { maximumFractionDigits: 0 }) + '</td>' +
      '<td>' + (tr.eth != null ? tr.eth.toLocaleString('en-US', { maximumFractionDigits: 5 }) + ' ETH' : '—') + '</td>' +
      '<td>' + (tr.ts ? new Date(tr.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—') + '</td>' +
      '<td><a href="' + exp + '/tx/' + trkSeg(tr.hash) + '" target="_blank" rel="noopener" aria-label="View transaction on explorer">tx ↗</a></td></tr>';
  }).join('');
  return '<div style="overflow-x:auto;"><table class="trk-table"><thead><tr><th>Side</th><th>Amount</th><th>ETH leg</th><th>Date</th><th>Tx</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    (t.trades.length > 40 ? '<p class="modal-note">Showing latest 40 of ' + t.trades.length + ' trades.</p>' : '') + '</div>';
}
