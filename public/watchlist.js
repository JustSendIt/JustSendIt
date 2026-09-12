/* ===== watchlist.js — the Watchlist page: saved tokens as expandable rows with full on-chain detail =====
 * Reuses the New Pairs visual language (.np-* classes). CSP-safe (addEventListener only). Read-only,
 * honest: no buy CTA; explorer/chart links + one-tap copy only.
 * Wallet tracking lives on its own page now (tracker.html / trackerpage.js) — this file is tokens only. */
(function () {
  'use strict';
  const listEl = document.getElementById('wl-list'); if (!listEl) return;
  const statusEl = document.getElementById('wl-status'), srEl = document.getElementById('wl-sr');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- formatting (mirrors newpairs.js) ---------- */
  function npFmtUsd(n) { if (n == null || !isFinite(n)) return '—'; if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k'; return '$' + Math.round(n).toLocaleString('en-US'); }
  const npNum = (n) => Number(n || 0).toLocaleString('en-US');
  function npCompact(n) { n = Number(n); if (!isFinite(n)) return '—'; if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T'; if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 }); return n.toLocaleString('en-US', { maximumFractionDigits: 6 }); }
  function npFmtAge(min) { if (min == null) return '—'; if (min < 60) return min + 'm'; if (min < 1440) return Math.floor(min / 60) + 'h ' + (min % 60) + 'm'; return Math.floor(min / 1440) + 'd ' + Math.floor((min % 1440) / 60) + 'h'; }
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  function npPrice(n) { if (n == null || !isFinite(n)) return '—'; if (n >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 4 }); const m = /^0\.(0*)(\d+)/.exec(n.toFixed(20)); if (!m) return '$' + n; const z = m[1].length, d = m[2].slice(0, 4); if (z >= 4) return '$0.0' + String(z).split('').map(x => SUB[+x]).join('') + d; return '$' + n.toFixed(Math.min(8, z + 4)); }
  function pctPlain(n) { return n == null ? '—' : (Math.round(n * 10) / 10) + '%'; }
  function chgChipHTML(v) { if (v == null) return '<span class="np-chg-none">—</span>'; const up = v >= 0; return '<span class="price-chip ' + (up ? 'up' : 'down') + ' np-chg">' + (up ? '▲' : '▼') + ' ' + (Math.round(Math.abs(v) * 10) / 10) + '%</span>'; }
  const shortAddr = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
  function supplyOf(p) { const raw = p.token.totalSupply; if (raw == null) return null; const n = Number(raw) / Math.pow(10, p.token.decimals || 18); return isFinite(n) ? n : null; }
  const move = (lbl, v) => v == null ? '' : '<span class="price-chip ' + (v >= 0 ? 'up' : 'down') + '">' + lbl + ' ' + (v >= 0 ? '▲' : '▼') + pctPlain(Math.abs(v)) + '</span>';
  function copyBtn(a, label) { return '<button class="copy-btn" type="button" data-copy="' + esc(a) + '" aria-label="Copy ' + esc(label || 'address') + '">📋</button>'; }

  /* ---------- verdict + flags ---------- */
  const TRI = { ok: { cls: 'np-t-ok', ico: '🟢', word: 'Looks OK' }, caution: { cls: 'np-t-caution', ico: '🟡', word: 'Caution' }, high: { cls: 'np-t-high', ico: '🔴', word: 'High risk' }, avoid: { cls: 'np-t-avoid', ico: '☠️', word: 'Avoid' } };
  function triageOf(p) { const r = p.risk || {}; if (TRI[r.triage]) return r.triage; if (r.health != null) return r.health >= 70 ? 'ok' : r.health >= 40 ? 'caution' : r.health >= 15 ? 'high' : 'avoid'; return 'caution'; }
  // same honesty rule as the radar: unreadable data is an unknown, never a green verdict
  function verdictOf(p) { const tri = triageOf(p), h = Math.round((p.risk && p.risk.health) || 0);
    if (p.risk && p.risk.thinData) return { cls: 'np-t-caution np-t-thin', ico: '🌫️', word: 'Not enough data yet' };
    if (tri === 'ok' && h >= 100) return { cls: 'np-t-ok np-t-perfect', ico: '🚀', word: 'Looks Good, Send It' }; return TRI[tri]; }
  const FLAG = {
    honeypotSuspect: { ico: '🍯', word: "Can't sell?", sev: 'bad' }, dumping: { ico: '📉', word: 'Dumping', sev: 'bad' },
    serialDeployer: { ico: '🔁', word: 'Serial deployer', sev: 'bad' }, lowLiquidity: { ico: '💧', word: 'Thin liquidity', sev: 'bad' },
    lowHolders: { ico: '👥', word: 'Few holders', sev: 'bad' }, concentrated: { ico: '🐋', word: 'Whale-heavy', sev: 'warn' },
    unverified: { ico: '📄', word: 'Unverified', sev: 'warn' }, sellPressure: { ico: '🔻', word: 'Heavy selling', sev: 'warn' }, deadVolume: { ico: '💤', word: 'No volume', sev: 'note' },
  };
  const FLAG_ORDER = ['honeypotSuspect', 'dumping', 'serialDeployer', 'lowLiquidity', 'lowHolders', 'concentrated', 'unverified', 'sellPressure', 'deadVolume'];
  const activeFlags = (p) => FLAG_ORDER.filter(k => p.risk && p.risk[k]);
  function flagstripHTML(p) {
    const f = activeFlags(p); if (!f.length) return '<div class="np-flagstrip"><span class="np-flag np-flag--ok">✔ No automatic red flags — still DYOR</span></div>';
    return '<div class="np-flagstrip">' + f.slice(0, 4).map(k => '<span class="np-flag np-flag--' + FLAG[k].sev + '">' + FLAG[k].ico + ' ' + esc(FLAG[k].word) + '</span>').join('') + (f.length > 4 ? '<span class="np-flag-more">+' + (f.length - 4) + '</span>' : '') + '</div>';
  }
  function gaugeHTML(p, tri, health) {
    const off = 100 - Math.max(0, Math.min(100, health));
    return '<span class="np-gauge ' + TRI[tri].cls + '" aria-hidden="true"><svg viewBox="0 0 44 44" class="np-gauge-svg">' +
      '<circle class="np-gauge-track" cx="22" cy="22" r="19"></circle>' +
      '<circle class="np-gauge-arc" cx="22" cy="22" r="19" pathLength="100" stroke-dasharray="100" stroke-dashoffset="' + off + '" transform="rotate(-90 22 22)"></circle>' +
      '</svg><span class="np-gauge-num">' + health + '</span></span>';
  }

  /* ---------- rows ---------- */
  const state = { items: [], open: new Set() };
  function group(id, title, open, inner) { return '<details class="np-detail-group"' + (open ? ' open' : '') + '><summary class="np-detail-h">' + title + '</summary><div class="np-detail-body">' + inner + '</div></details>'; }
  function summaryHTML(p) {
    const tri = triageOf(p), T = verdictOf(p), health = Math.round((p.risk && p.risk.health) || 0);
    const saved = p._wl && p._wl.source === 'saved';
    return '<summary class="np-sum"><div class="np-head">' + gaugeHTML(p, tri, health) +
      '<span class="np-id"><span class="np-name">' + esc(p.token.name) + ' <span class="np-sym">$' + esc(p.token.symbol) + '</span></span>' +
      '<span class="np-meta"><span class="np-age">🕐 ' + npFmtAge(p.pair.ageMinutes) + '</span><span class="np-quote">/ ' + esc(p.pair.quoteSymbol) + '</span>' + (saved ? '<span class="np-quote" title="Shown from your last saved snapshot">· saved</span>' : '') + '</span></span>' +
      '<span class="np-verdict ' + T.cls + '"><span class="np-verdict-ico" aria-hidden="true">' + T.ico + '</span><span class="np-verdict-word">' + T.word + '</span></span>' +
      '<span class="np-liq"><b class="np-liq-val">' + npFmtUsd(p.market.liquidityUsd) + '</b><i class="np-liq-lbl">liq</i></span>' +
      '<span class="np-chg-slot">' + chgChipHTML(p.priceChange.h1) + '</span>' +
      '<button class="np-wl-remove" type="button" data-remove="' + esc(p.pair.address) + '" aria-label="Remove ' + esc(p.token.symbol) + ' from watchlist" title="Remove from watchlist">✕</button>' +
      '<span class="np-chev" aria-hidden="true">▾</span>' +
      '<span class="sr-only">' + esc(p.token.name) + ' ' + esc(p.token.symbol) + ', verdict ' + T.word + ', health ' + health + ' of 100. Expand for detail.</span>' +
      '</div>' + flagstripHTML(p) + '</summary>';
  }
  // same 📈 chart the New Pairs detail shows — the watchlist renders its own (lighter) body, so it needs its own copy
  function chartHTML(p) {
    if (!p.indexed || !p.pair || !p.pair.address) return '<p class="np-why-clean">📈 No chart yet — this pair has not traded, so there is nothing to draw.</p>';
    return '<div class="onchain-chart" data-pair="' + esc(p.pair.address) + '" data-token="' + esc(p.token.address) + '" data-tf="1h" data-poll="2000"></div>' +
      '<p class="np-chart-note">Built live from on-chain swaps. <a href="' + esc(p.links.dex) + '" target="_blank" rel="noopener nofollow">Cross-check on Dexscreener ↗</a></p>';
  }
  function detailHTML(p) {
    const h = p.holders || {}, m = p.market || {}, r = p.risk || {};
    const supply = supplyOf(p);
    const resv = m.reserves ? '<p class="np-reserves">💧 Pooled: <b>' + npCompact(m.reserves.tokenAmount) + '</b> ' + esc(p.token.symbol) + ' + <b>' + npCompact(m.reserves.quoteAmount) + '</b> ' + esc(m.reserves.quoteSymbol) + '</p>' : '';
    const market = '<div class="np-kv">' +
      '<div class="hstat"><div class="lbl">Price</div><div class="val">' + npPrice(m.priceUsd) + '</div></div>' +
      '<div class="hstat"><div class="lbl">Liquidity</div><div class="val' + (r.lowLiquidity ? ' red' : '') + '">' + npFmtUsd(m.liquidityUsd) + '</div></div>' +
      '<div class="hstat np-soft"><div class="lbl">Market cap ⚠︎</div><div class="val">' + npFmtUsd(m.marketCap) + '</div></div>' +
      '<div class="hstat np-soft"><div class="lbl">FDV ⚠︎</div><div class="val">' + npFmtUsd(m.fdv) + '</div></div>' +
      '<div class="hstat"><div class="lbl">Total supply</div><div class="val">' + (supply != null ? npCompact(supply) : '—') + '</div></div>' +
      '<div class="hstat"><div class="lbl">Decimals</div><div class="val">' + (p.token.decimals != null ? p.token.decimals : '—') + '</div></div>' +
      '</div>' + resv +
      '<div class="np-moves">' + move('1h', p.priceChange.h1) + move('6h', p.priceChange.h6) + move('24h', p.priceChange.h24) + '</div>';
    const txrow = (l, o) => '<tr><td>' + l + '</td><td class="np-tx-buy">' + npNum(o.buys) + '</td><td class="np-tx-sell">' + npNum(o.sells) + '</td></tr>';
    const activity = '<p class="np-supply">Vol 24h <b>' + npFmtUsd(p.volume.h24) + '</b></p><div class="np-txwrap"><table class="np-txtable"><thead><tr><th>Window</th><th>Buys</th><th>Sells</th></tr></thead><tbody>' + txrow('1h', p.txns.h1) + txrow('6h', p.txns.h6) + txrow('24h', p.txns.h24) + '</tbody></table></div>';
    let conc = '';
    if (h.topHolderPct != null) conc = '<p class="np-conc-txt">👥 Top wallet owns <b>' + pctPlain(h.topHolderPct) + '</b>' + (h.top10Pct != null ? ', top 10 own <b>' + pctPlain(h.top10Pct) + '</b>' : '') + '.</p>';
    let top10 = '';
    if (h.top && h.top.length) top10 = '<div class="np-holders">' + h.top.map((x, i) => '<div class="np-holder"><span class="np-hrank">#' + (i + 1) + '</span><code>' + esc(shortAddr(x.address)) + '</code>' + copyBtn(x.address, 'holder address') + '<span class="np-hpct">' + (x.pct != null ? pctPlain(x.pct) : '—') + '</span></div>').join('') + '</div>';
    const holders = '<p class="np-supply"><b>' + (h.count != null ? npNum(h.count) + ' holders' : 'not indexed yet') + '</b></p>' + conc + top10;
    let owner = '';
    if (p.token.renounced === true) owner = '<p class="np-owner renounced">🛡️ <b>Ownership renounced</b></p>';
    else if (p.token.owner) owner = '<p class="np-owner owned">🔑 Owner <code>' + esc(shortAddr(p.token.owner)) + '</code>' + copyBtn(p.token.owner, 'owner') + ' <b>— can still change the contract</b></p>';
    else owner = '<p class="np-owner">🔑 Owner unknown</p>';
    const contract = '<div class="np-addr-row"><span class="np-addr-lbl">Token</span><code>' + esc(p.token.address) + '</code>' + copyBtn(p.token.address, 'token contract') + '</div>' +
      '<div class="np-addr-row"><span class="np-addr-lbl">Pair (LP)</span><code>' + esc(p.pair.address) + '</code>' + copyBtn(p.pair.address, 'pair') + '</div>' +
      (p.token.deployer ? '<div class="np-addr-row"><span class="np-addr-lbl">Deployer</span><code>' + esc(shortAddr(p.token.deployer)) + '</code>' + copyBtn(p.token.deployer, 'deployer') + '</div>' : '') + owner +
      '<p class="np-supply">' + (p.token.isVerified === true ? '📄 <b>Verified</b> source' : p.token.isVerified === false ? '📄 <b class="red">Unverified</b>' : '📄 Verification unknown') + '</p>' +
      '<div class="np-actions"><a class="btn btn-sm btn-ghost" href="' + esc(p.links.explorer) + '" target="_blank" rel="noopener nofollow">🔍 Explorer ↗</a><a class="btn btn-sm btn-ghost" href="' + esc(p.links.dex) + '" target="_blank" rel="noopener nofollow">📈 Chart ↗</a></div>';
    return '<div class="np-body">' +
      (activeFlags(p).length ? '<section class="np-why"><ul class="np-why-list">' + activeFlags(p).map(k => '<li class="np-why-' + (FLAG[k].sev === 'bad' ? 'bad' : 'warn') + '"><span aria-hidden="true">' + FLAG[k].ico + '</span> ' + esc(FLAG[k].word) + '</li>').join('') + '</ul></section>' : '') +
      group('chart', '📈 Chart', true, chartHTML(p)) +
      group('market', '📊 Market', true, market) + group('activity', '🔁 Activity', false, activity) + group('holders', '👥 Holders', false, holders) + group('contract', '📄 Contract &amp; copy', false, contract) +
      group('block0', '🎯 Block 0 — the first buyers', true, '<div class="np-b0" data-token="' + esc(p.token.address) + '"></div>') +
      '<p class="np-honest">Auto-flags are heuristics from public data — not a guarantee, not an audit, not advice. Most new tokens go to zero. We don\'t tell you to buy. Entertainment only.</p></div>';
  }
  function rowHTML(p) {
    const isOpen = state.open.has(p.pair.address);
    return '<li class="np-row" data-addr="' + esc(p.pair.address) + '" data-level="' + triageOf(p) + '"><details class="np-card"' + (isOpen ? ' open' : '') + '>' + summaryHTML(p) + (isOpen ? detailHTML(p) : '') + '</details></li>';
  }

  /* ---------- TOKEN watchlist: render + load ---------- */
  function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }
  function signedOut(el, what) { el.innerHTML = '<li class="np-msg">Sign in to keep a ' + what + '. <button class="btn btn-sm btn-primary" data-wl-signin type="button">Sign In 🚀</button></li>'; }
  function render() {
    if (!state.items.length) { listEl.innerHTML = '<li class="np-msg">⭐ No saved tokens yet. Open <a class="np-msg-link" href="newpairs.html">New Pairs</a>, tap the ☆ on any token, and it lands here.</li>'; setStatus(''); return; }
    listEl.innerHTML = state.items.map(rowHTML).join('');
    setStatus('<span class="np-live-dot" aria-hidden="true"></span> ' + state.items.length + ' saved token' + (state.items.length === 1 ? '' : 's'));
    if (window.Watchlist) Watchlist.syncButtons(listEl);
  }
  async function loadTokens() {
    if (!(window.AUTH && AUTH.user)) { signedOut(listEl, 'token watchlist'); setStatus(''); return; }
    setStatus('<span class="np-live-dot" aria-hidden="true"></span> Loading your tokens…');
    try {
      const r = await fetch('/api/watchlist', { credentials: 'same-origin' });
      if (r.status === 401) { signedOut(listEl, 'token watchlist'); setStatus(''); return; }
      const j = await r.json();
      state.items = j.items || [];
      render();
    } catch { setStatus('⚠️ Couldn\'t load your tokens.'); }
  }
  listEl.addEventListener('click', e => {
    const rm = e.target.closest('.np-wl-remove');
    if (rm) {
      e.preventDefault(); e.stopPropagation();
      const addr = rm.dataset.remove; const li = rm.closest('li[data-addr]');
      state.items = state.items.filter(p => p.pair.address !== addr); state.open.delete(addr);
      if (li) li.remove();
      if (window.Watchlist) Watchlist.remove(addr);
      if (!state.items.length) render(); else setStatus('<span class="np-live-dot" aria-hidden="true"></span> ' + state.items.length + ' saved token' + (state.items.length === 1 ? '' : 's'));
      if (srEl) srEl.textContent = 'Removed from watchlist';
      return;
    }
    if (e.target.closest('[data-wl-signin]') && window.AUTH) AUTH.open();
  });
  listEl.addEventListener('toggle', e => {
    const det = e.target; if (!det || det.tagName !== 'DETAILS' || !det.classList.contains('np-card')) return;
    const li = det.closest('li[data-addr]'); if (!li) return;
    const addr = li.dataset.addr;
    if (det.open) { state.open.add(addr); if (!li.querySelector('.np-body')) { const p = state.items.find(x => x.pair.address === addr); if (p) det.insertAdjacentHTML('beforeend', detailHTML(p)); if (window.mountOnChainCharts) mountOnChainCharts(); } }
    else state.open.delete(addr);
  }, true);

  /* ---------- boot ---------- */
  // auth:change also fires once at init (right after AUTH.ready) — a second load there is harmless (same list) but
  // wasteful, so only reload when the signed-in identity actually changes.
  let bootedFor;
  function boot() {
    const u = (window.AUTH && AUTH.user) ? String(AUTH.user.username || "1") : null;
    if (bootedFor !== undefined && u === bootedFor) return;
    bootedFor = u; loadTokens();
  }
  if (window.AUTH && AUTH.ready) AUTH.ready.then(boot); else boot();
  document.addEventListener("auth:change", boot);
})();
