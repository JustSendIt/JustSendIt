/* ===== New Pairs Radar v2 — the most advanced honest tracker of fresh tokens on Robinhood Chain =====
 * Safety-first: the biggest thing on every row is a RISK health ring, not a gain number.
 * Server owns all risk computation (/api/pairs/new); the client only maps it to pixels, filters/sorts/
 * searches instantly in-memory, remembers your preferences, and refreshes without ever yanking the user.
 * Tons of filters + full on-chain detail + one-tap copy on every address. No buy/swap CTA anywhere —
 * this page protects, it doesn't funnel. Read-only, honest. CSP-safe: addEventListener only, no inline JS. */
(function () {
  const listEl = document.getElementById('np-list');
  // NOTE: we do NOT early-return when np-list is absent — the render helpers below are also exported as window.NPCard
  // so the Send Wall / profiles can render the exact same full token detail. Only the page WIRING (bottom) is gated on np-list.
  // A branding image that fails to load (CSP block, 404, CDN hiccup) must degrade cleanly. `error` doesn't bubble,
  // so listen in the capture phase and hide just that image — the card keeps its gauge/name and stays intact.
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.classList && t.classList.contains('np-logo-img')) {
      const holder = t.closest('.np-logo, .np-brand-banner, .np-slide-banner');
      if (holder) holder.remove(); else t.remove();
    }
  }, true);
  const statusEl = document.getElementById('np-status');
  const srEl = document.getElementById('np-sr');
  const newbar = document.getElementById('np-newbar');
  // 🎬 Hot Feed refs
  const feedEl = document.getElementById('np-feed');
  const feedTrack = document.getElementById('np-feed-track');
  const feedSr = document.getElementById('np-feed-sr');
  const freshBtn = document.getElementById('np-feed-fresh');
  const feedLive = document.getElementById('np-feed-live');
  let feedObserver = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => window.prefersReduced && window.prefersReduced();

  // ===== Pin to my wall (global): token addresses the signed-in user has pinned, + one document-level handler that
  // works wherever a token's on-chain detail renders (DEX list, Hot Feed, lookup, Send Call widget, TokenModal popup). =====
  const pinnedTokens = new Set();
  const isPinned = (addr) => pinnedTokens.has(String(addr || '').toLowerCase());
  async function loadPinnedIds() {
    try { const j = await (await fetch('/api/pins/ids', { credentials: 'same-origin' })).json(); pinnedTokens.clear(); (j.ids || []).forEach(a => pinnedTokens.add(String(a).toLowerCase())); } catch {}
  }
  loadPinnedIds();
  document.addEventListener('auth:change', loadPinnedIds); // re-sync on login/logout
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pin]');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
    const token = String(btn.dataset.pin || '').toLowerCase();
    const wasOn = isPinned(token);
    btn.disabled = true;
    try {
      if (wasOn) {
        await fetch('/api/pins', { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        pinnedTokens.delete(token);
        if (window.sendToast) sendToast('Unpinned $' + (btn.dataset.sym || '') + ' 📌');
      } else {
        const body = { token, pair: btn.dataset.pair, symbol: btn.dataset.sym, name: btn.dataset.name };
        if (btn.dataset.logo) body.brand = { imageUrl: btn.dataset.logo };
        const r = await fetch('/api/pins', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { if (window.sendToast) sendToast(j.error || 'Could not pin'); btn.disabled = false; return; }
        pinnedTokens.add(token);
        if (window.sendToast) sendToast('📌 Pinned $' + (btn.dataset.sym || '') + ' to your wall!');
      }
      const sel = '.np-pin[data-pin="' + (window.CSS && CSS.escape ? CSS.escape(btn.dataset.pin) : btn.dataset.pin) + '"]';
      document.querySelectorAll(sel).forEach(b => { const on = isPinned(token); b.classList.toggle('is-pinned', on); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '📌 Pinned to wall' : '📌 Pin to my wall'; b.disabled = false; });
      document.dispatchEvent(new CustomEvent('pins:changed', { detail: { token } })); // let the public wall's "Convicted In" re-render live
    } catch { if (window.sendToast) sendToast('Could not update pin'); btn.disabled = false; }
  });

  /* ---------- formatting ---------- */
  function npFmtUsd(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  const npNum = (n) => Number(n || 0).toLocaleString('en-US');
  function npCompact(n) {
    n = Number(n); if (!isFinite(n)) return '—';
    if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
  }
  function npFmtAge(min) {
    if (min == null) return '—';
    if (min < 60) return min + 'm';
    if (min < 1440) return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
    return Math.floor(min / 1440) + 'd ' + Math.floor((min % 1440) / 60) + 'h';
  }
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  function npPrice(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 4 });
    const m = /^0\.(0*)(\d+)/.exec(n.toFixed(20));
    if (!m) return '$' + n;
    const zeros = m[1].length, digits = m[2].slice(0, 4);
    if (zeros >= 4) return '$0.0' + String(zeros).split('').map(d => SUB[+d]).join('') + digits;
    return '$' + n.toFixed(Math.min(8, zeros + 4));
  }
  function pctPlain(n) { return n == null ? '—' : (Math.round(n * 10) / 10) + '%'; }
  function chgChipHTML(v) {
    if (v == null) return '<span class="np-chg-none">—</span>';
    const up = v >= 0, a = Math.abs(v);
    return '<span class="price-chip ' + (up ? 'up' : 'down') + ' np-chg">' + (up ? '▲' : '▼') + ' ' + (Math.round(a * 10) / 10) + '%<span class="sr-only"> in the last hour</span></span>';
  }
  function shortAddr(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }
  // A pair whose name or symbol never resolved renders as "Unknown Token $???" — an unidentifiable row nobody can
  // act on. The server already withholds these from /api/pairs/new; this is the client's own guard so one can't
  // reach the radar through any other path (a pasted-address lookup included).
  const identified = (p) => !!(p && p.token && p.token.symbol && p.token.symbol !== '???' &&
                               p.token.name && p.token.name !== 'Unknown Token');
  function supplyOf(p) { const raw = p.token.totalSupply; if (raw == null) return null; const n = Number(raw) / Math.pow(10, p.token.decimals || 18); return isFinite(n) ? n : null; }

  /* ---------- triage + flags (server is source of truth; we only present) ---------- */
  const TRI = {
    ok:      { cls: 'np-t-ok',      ico: '🟢', word: 'Looks OK' },
    caution: { cls: 'np-t-caution', ico: '🟡', word: 'Caution' },
    high:    { cls: 'np-t-high',    ico: '🔴', word: 'High risk' },
    avoid:   { cls: 'np-t-avoid',   ico: '☠️', word: 'Avoid' },
  };
  function triageOf(p) {
    const r = p.risk || {};
    if (TRI[r.triage]) return r.triage;
    if (r.health != null) return r.health >= 70 ? 'ok' : r.health >= 40 ? 'caution' : r.health >= 15 ? 'high' : 'avoid';
    return 'caution';
  }
  // verdict presentation — a perfect 100 reads "Looks Good, Send It 🚀"; everything else uses TRI
  // A token whose liquidity/holder/index data could not be read is NOT a clean bill of health — it is an
  // unknown. Without this it would trip no flags, score 100, and carry the greenest verdict on the site,
  // which would make "we could not check" look identical to "we checked and it is fine".
  const thinData = (p) => !!(p.risk && p.risk.thinData);
  /* The block-0 test, in one place. "Looks Good, Send It" is only ever given to a token whose FIRST block
     is clean: nobody sniped it, or every block-0 cluster still holds what it took, or those clusters are
     immaterial (under 1% of the float, taken and held). `sniperOk` is null until the scan finishes — not
     checked is not the same as checked and fine, so it withholds the badge rather than granting it. */
  const sniperOk = (p) => !!(p.risk && p.risk.sniperOk === true);
  function verdictOf(p) {
    const tri = triageOf(p), health = Math.round((p.risk && p.risk.health) || 0);
    if (thinData(p)) return { cls: 'np-t-caution np-t-thin', ico: '🌫️', word: 'Not enough data yet' };
    if (tri === 'ok' && health >= 100 && !sniperOk(p)) {
      const st = p.risk && p.risk.snipers ? p.risk.snipers.status : null;
      return st === 'done' || st === 'partial'
        ? { cls: 'np-t-caution np-t-snipe', ico: '🎯', word: 'Block-0 snipers sold' }
        : { cls: 'np-t-caution np-t-thin', ico: '🌫️', word: 'Checking block 0…' };
    }
    if (tri === 'ok' && health >= 100 && sniperOk(p)) return { cls: 'np-t-ok np-t-perfect', ico: '🚀', word: 'Looks Good, Send It' };
    return TRI[tri];
  }
  const FLAG = {
    honeypotSuspect: { ico: '🍯', word: () => "Can't sell?", sev: 'bad', say: p => `People are buying (${npNum(p.txns.h24.buys)}) but almost nobody's selling (${npNum(p.txns.h24.sells)}) — you may not be able to sell either.` },
    dumping: { ico: '📉', word: () => 'Dumping', sev: 'bad', say: p => `Down ${pctPlain(Math.abs(p.priceChange.h1))} in the last hour — falling off a cliff right now.` },
    serialDeployer: { ico: '🔁', word: () => 'Serial deployer', sev: 'bad', say: p => { const l = p.risk.deployerLaunches, d = p.risk.deployerDied; return l ? `Made by a wallet that launched ${l} recent tokens${d ? `; ${d} already look dead` : ''}.` : 'Made by a wallet that has launched many tokens that later died.'; } },
    lowLiquidity: { ico: '💧', word: () => 'Thin liquidity', sev: 'bad', say: p => `Only ${npFmtUsd(p.market.liquidityUsd)} pooled — easy to rug, hard to exit.` },
    lowHolders: { ico: '👥', word: p => `${p.holders.count} holders`, sev: 'bad', say: p => `Just ${p.holders.count} wallets hold this — a few people control the price.` },
    concentrated: { ico: '🐋', word: () => 'Whale-heavy', sev: 'warn', say: p => `One wallet holds ${pctPlain(p.holders.topHolderPct)}${p.holders.top10Pct != null ? ` (top 10 hold ${pctPlain(p.holders.top10Pct)})` : ''} — they can dump on you.` },
    unverified: { ico: '📄', word: () => 'Unverified', sev: 'warn', say: () => `Contract source isn't published — nobody can audit what it does.` },
    sellPressure: { ico: '🔻', word: () => 'Heavy selling', sev: 'warn', say: p => `Sells outnumber buys (${npNum(p.txns.h24.sells)} vs ${npNum(p.txns.h24.buys)}).` },
    deadVolume: { ico: '💤', word: () => 'No volume', sev: 'note', say: p => `Almost no trading in 24h (${npFmtUsd(p.volume.h24)}).` },
  };
  const FLAG_ORDER = ['honeypotSuspect', 'dumping', 'serialDeployer', 'lowLiquidity', 'lowHolders', 'concentrated', 'unverified', 'sellPressure', 'deadVolume'];
  const activeFlags = (p) => FLAG_ORDER.filter(k => p.risk && p.risk[k]);
  function goodSigns(p) {
    const g = [];
    if (p.token.isVerified === true) g.push('✓ Verified code');
    if (p.market.liquidityUsd != null && p.market.liquidityUsd >= 25000) g.push('✓ Deep liquidity');
    if (p.holders.topHolderPct != null && p.holders.topHolderPct < 15) g.push('✓ Spread out');
    if (p.holders.count != null && p.holders.count >= 200) g.push('✓ Many holders');
    if (p.token.renounced === true) g.push('✓ Ownership renounced');
    return g.slice(0, 3);
  }
  const flagWord = (k, p) => typeof FLAG[k].word === 'function' ? FLAG[k].word(p) : FLAG[k].word;

  /* ---------- score breakdown: show HOW the health score was assessed, section by section ---------- */
  // penalty weights mirror the server risk model (applyRisk); health = 100 − sum of tripped penalties.
  const WEIGHTS = { honeypotSuspect: 45, dumping: 32, serialDeployer: 26, lowLiquidity: 26, concentrated: 20, unverified: 15, lowHolders: 15, sellPressure: 12, deadVolume: 12 };
  const SECTIONS = [
    { key: 'liquidity', label: 'Liquidity & volume', ico: '💧', flags: ['lowLiquidity', 'deadVolume'] },
    { key: 'holders', label: 'Holders & spread', ico: '👥', flags: ['lowHolders', 'concentrated'] },
    { key: 'trading', label: 'Trading activity', ico: '🔁', flags: ['honeypotSuspect', 'dumping', 'sellPressure'] },
    { key: 'contract', label: 'Contract & trust', ico: '📄', flags: ['unverified', 'serialDeployer'] },
  ];
  const gradeOf = (s) => s >= 85 ? 'A' : s >= 70 ? 'B' : s >= 50 ? 'C' : s >= 30 ? 'D' : 'F';
  function sectionPositives(key, p) {
    const g = [], m = p.market, h = p.holders;
    if (key === 'liquidity') { if (m.liquidityUsd != null && m.liquidityUsd >= 25000) g.push('Deep liquidity ($25k+)'); if (p.volume.h24 >= 1000) g.push('Real 24h volume'); }
    else if (key === 'holders') { if (h.topHolderPct != null && h.topHolderPct < 15) g.push('Top wallet under 15%'); if (h.count != null && h.count >= 200) g.push('200+ holders'); }
    else if (key === 'trading') { const b = p.txns.h24.buys, s = p.txns.h24.sells; if (b > 0 && b >= s) g.push('Buys keeping up with sells'); if (p.priceChange.h1 != null && p.priceChange.h1 > 0) g.push('Up in the last hour'); }
    else if (key === 'contract') { if (p.token.isVerified === true) g.push('Verified source'); if (p.token.renounced === true) g.push('Ownership renounced'); }
    return g;
  }
  function scoreBreakdown(p) {
    const r = p.risk || {};
    return SECTIONS.map(sec => {
      let score = 100;
      const fails = [];
      sec.flags.forEach(k => { if (r[k]) { score -= (WEIGHTS[k] || 0); fails.push({ k, impact: WEIGHTS[k] || 0, say: FLAG[k].say(p), word: flagWord(k, p) }); } });
      score = Math.max(0, score);
      fails.sort((a, b) => b.impact - a.impact); // biggest hit first → it's the "key metric" shown collapsed
      return { key: sec.key, label: sec.label, ico: sec.ico, score, grade: gradeOf(score), fails, wins: sectionPositives(sec.key, p) };
    });
  }
  function breakdownHTML(p) {
    const health = Math.round((p.risk && p.risk.health) || 0);
    const secs = scoreBreakdown(p);
    const totalPenalty = 100 - health;
    const rows = secs.map(s => {
      // the KEY metric shown collapsed = the biggest hit, else the top positive, else neutral
      const key = s.fails.length
        ? '<span class="np-bd-x" aria-hidden="true">✕</span> ' + esc(s.fails[0].say) + ' <b class="np-bd-impact">−' + s.fails[0].impact + '</b>'
        : (s.wins.length ? '<span class="np-bd-check" aria-hidden="true">✓</span> ' + esc(s.wins[0]) : '<span class="np-bd-neutraltxt">No signal either way yet</span>');
      const items = s.fails.map(f => '<li class="np-bd-fail"><span class="np-bd-x" aria-hidden="true">✕</span> ' + esc(f.say) + ' <b class="np-bd-impact">−' + f.impact + '</b></li>').join('') +
        s.wins.map(w => '<li class="np-bd-win"><span class="np-bd-check" aria-hidden="true">✓</span> ' + esc(w) + '</li>').join('') +
        (!s.fails.length && !s.wins.length ? '<li class="np-bd-neutral">No signal either way yet.</li>' : '');
      // the Contract section's dropdown lazy-loads the deep honeypot / contract-code read
      const contractSlot = s.key === 'contract'
        ? '<div class="np-contract" data-token="' + esc(p.token.address) + '" data-pair="' + esc(p.pair.address) + '"><p class="np-contract-load"><span class="np-live-dot" aria-hidden="true"></span> Reading the contract code…</p></div>'
        : '';
      return '<details class="np-bd-sec np-bd-g' + s.grade + '">' +
        '<summary class="np-bd-head">' +
          '<span class="np-bd-toprow"><span class="np-bd-ico" aria-hidden="true">' + s.ico + '</span><span class="np-bd-label">' + s.label + '</span>' +
            '<span class="np-bd-grade" title="Section grade">' + s.grade + '</span><span class="np-bd-score">' + s.score + '<i>/100</i></span>' +
            '<span class="np-bd-chev" aria-hidden="true">▾</span></span>' +
          '<span class="np-bd-bar"><span style="width:' + s.score + '%"></span></span>' +
          '<span class="np-bd-key">' + key + '</span>' +
        '</summary>' +
        '<ul class="np-bd-items">' + items + '</ul>' + contractSlot +
      '</details>';
    }).join('');
    return '<div class="np-breakdown">' +
      '<p class="np-bd-formula">Overall health <b>' + health + '/100</b> = 100 − ' + totalPenalty + ' in penalties. Each section below shows exactly what helped or hurt.</p>' +
      rows +
      '<p class="np-bd-note">Scores are automatic heuristics from public on-chain data — a starting point for your own research, never a guarantee or a “buy”.</p>' +
    '</div>';
  }

  /* ---------- make a Send Call: post a live call widget to your wall ---------- */
  async function makeSendCall(btn) {
    if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
    const token = btn.dataset.callToken, sym = btn.dataset.callSym || '';
    if (!token) return;
    const viewedDetail = viewedDetails.has(String(token).toLowerCase()); // did they open the full on-chain detail first?
    btn.disabled = true; const old = btn.textContent; btn.textContent = '📣 Calling…';
    try {
      const r = await fetch('/api/calls', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, viewedDetail }) });
      const j = await r.json();
      if (!r.ok) {
        // if the rejection carries a fresh read-only restriction (already muted), pop the banner immediately
        if (j.restriction && window.AUTH) { AUTH.user.restriction = j.restriction; AUTH.user.probation = null; if (AUTH.renderRestrictBanner) AUTH.renderRestrictBanner(); if (AUTH.renderProbationBanner) AUTH.renderProbationBanner(); }
        if (window.sendToast) sendToast(j.error || 'Could not make that call');
        btn.disabled = false; btn.textContent = old; return;
      }
      btn.textContent = '✓ Called — on your wall';
      if (window.showPoints && j.pointsEarned > 0) showPoints(j.pointsEarned);
      if (window.sendToast) sendToast('📣 Send Call posted on $' + sym + '! Your Xs track live on the Send Wall.');
      // this call may have completed a sub-hour spam burst → the server muted us; show the read-only banner now
      if (j.restriction && window.AUTH) {
        AUTH.user.restriction = j.restriction; AUTH.user.probation = null; // muted now → drop any probation banner
        if (AUTH.renderRestrictBanner) AUTH.renderRestrictBanner();
        if (AUTH.renderProbationBanner) AUTH.renderProbationBanner();
        if (window.sendToast) setTimeout(function () { sendToast('🔇 That was a full day of Send Calls in under an hour — you’re now in read-only mode. See the banner up top.'); }, 500);
      } else if (j.post && j.post.id) {
        setTimeout(function () { location.href = '/wall.html#p' + j.post.id; }, 900); // take the caller to their Send Call on the wall
      }
    } catch { if (window.sendToast) sendToast('Could not make that call'); btn.disabled = false; btn.textContent = old; }
  }

  /* ---------- state ---------- */
  function defaultFilters() {
    return {
      quote: { weth: true, usdg: true, other: true },
      verified: false, indexed: false,
      minLiq: 0, minVol: 0, maxAge: 1440, minHealth: 0,
      minHolders: 0, maxTopPct: 100,
      price1h: 'any', flow: 'any',
      hide: { honeypotSuspect: false, dumping: false, serialDeployer: false, lowLiquidity: false, concentrated: false, unverified: false, lowHolders: false, sellPressure: false, deadVolume: false },
    };
  }
  const state = {
    all: [], byAddr: new Map(), view: [],
    open: new Set(),
    safety: 'safer',                 // never persisted — protection is always the arrival default
    sort: 'new',
    q: '',
    density: 'comfortable',
    filters: defaultFilters(),
    sections: { why: true, chart: true, score: true, market: true, activity: false, holders: false, contract: false },
    saved: [],
    mode: 'runners',                 // 'runners' (📈 Best Runners, default) | 'feed' (🎬 Hot Feed) | 'list' (📋 DEX List)
    runWin: '24h', runnersLoading: false, // Best Runners time window
    activeAddr: null, feedAddrs: [], freshCount: 0,
    lastFetch: 0, staged: [], started: false,
    lookup: null,                    // { addr, status:'loading'|'done'|'notfound'|'error', p, fromLive } — DEX-list address search
  };
  // restore prefs (v2 schema; migrate the old {sort,filters:{usdg,weth,...}} shape)
  try {
    const s = JSON.parse(localStorage.getItem('np:view') || '{}');
    // honor a persisted mode only once the user has seen the new Best-Runners default (so it shows for everyone at least once)
    if ((s.mode === 'feed' || s.mode === 'list' || s.mode === 'runners') && s.rSeen) state.mode = s.mode;
    if (['24h', 'week', 'month', 'year', 'all'].includes(s.runWin)) state.runWin = s.runWin;
    if (s.sort) state.sort = s.sort;
    if (s.density === 'compact' || s.density === 'comfortable') state.density = s.density;
    if (s.sections) Object.assign(state.sections, s.sections);
    if (Array.isArray(s.saved)) state.saved = s.saved.slice(0, 6);
    if (s.filters) {
      if (s.v === 2) {
        const f = state.filters, in_ = s.filters;
        if (in_.quote) Object.assign(f.quote, in_.quote);
        ['verified', 'indexed', 'minLiq', 'minVol', 'maxAge', 'minHealth', 'minHolders', 'maxTopPct', 'price1h', 'flow'].forEach(k => { if (in_[k] != null) f[k] = in_[k]; });
        if (in_.hide) Object.assign(f.hide, in_.hide);
      } else {                       // migrate v1
        const f = state.filters, o = s.filters;
        if (o.verified) f.verified = true;
        if (o.usdg && !o.weth) { f.quote = { weth: false, usdg: true, other: false }; }
        else if (o.weth && !o.usdg) { f.quote = { weth: true, usdg: false, other: false }; }
        if (o.minLiq) f.minLiq = o.minLiq;
        if (o.maxAge != null) f.maxAge = o.maxAge;
      }
    }
  } catch {}
  function persist() {
    try { localStorage.setItem('np:view', JSON.stringify({ v: 2, rSeen: true, mode: state.mode, runWin: state.runWin, sort: state.sort, density: state.density, filters: state.filters, sections: state.sections, saved: state.saved })); } catch {}
  }

  /* ---------- ring animation ---------- */
  const rafs = new Set();
  function stopRafs() { rafs.forEach(id => cancelAnimationFrame(id)); rafs.clear(); }
  function setArc(arc, health) {
    const off = 100 - Math.max(0, Math.min(100, health));
    if (reduced()) { arc.style.strokeDashoffset = off; return; }
    arc.style.strokeDashoffset = 100;
    const id = requestAnimationFrame(() => { const id2 = requestAnimationFrame(() => { arc.style.strokeDashoffset = off; }); rafs.add(id2); });
    rafs.add(id);
  }
  function animateRings(root) { root.querySelectorAll('.np-gauge-arc[data-fill]').forEach(a => setArc(a, Number(a.getAttribute('data-fill')) || 0)); }

  /* ---------- collapsed row ---------- */
  function gaugeHTML(p, tri, health) {
    return '<span class="np-gauge ' + TRI[tri].cls + '" aria-hidden="true">' +
      '<svg viewBox="0 0 44 44" class="np-gauge-svg">' +
        '<circle class="np-gauge-track" cx="22" cy="22" r="19"></circle>' +
        '<circle class="np-gauge-arc" cx="22" cy="22" r="19" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" data-fill="' + health + '" transform="rotate(-90 22 22)"></circle>' +
      '</svg><span class="np-gauge-num">' + health + '</span></span>';
  }
  function flagstripHTML(p) {
    const flags = activeFlags(p);
    let inner = '';
    if (!flags.length) {
      inner = '<span class="np-flag np-flag--ok">✔ No automatic red flags — still DYOR</span>';
      goodSigns(p).forEach(g => { inner += '<span class="np-flag np-flag--ok">' + esc(g) + '</span>'; });
    } else {
      const show = flags.slice(0, 3);
      show.forEach(k => { inner += '<span class="np-flag np-flag--' + FLAG[k].sev + '">' + FLAG[k].ico + ' ' + esc(flagWord(k, p)) + '</span>'; });
      if (flags.length > 3) inner += '<span class="np-flag-more">+' + (flags.length - 3) + '</span>';
    }
    return '<div class="np-flagstrip">' + inner + '</div>';
  }
  /* ---------- token branding (Dexscreener enhanced info + a per-token accent color) ---------- */
  // The Dexscreener CDN sends no CORS header, so we can't read the logo's pixels — instead we derive a STABLE
  // unique hue from the token address (its on-chain identity), so every card gets a color unique to that token.
  function tokHue(addr) { let h = 5381; const s = String(addr || ''); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h % 360; }
  function tokVars(p) { const h = tokHue(p.token.address); return '--tok:hsl(' + h + ' 72% 60%);--tok-soft:hsl(' + h + ' 72% 60% / .14)'; }
  const SOCIAL_ICON = { twitter: '𝕏', x: '𝕏', telegram: '✈️', discord: '💬', website: '🌐', github: '💻', medium: '✍️', reddit: '👽', instagram: '📸', tiktok: '🎵', youtube: '▶️', facebook: 'f', link: '🔗' };
  const SOCIAL_LABEL = { twitter: 'X', x: 'X', telegram: 'Telegram', discord: 'Discord', website: 'Website', github: 'GitHub', medium: 'Medium', reddit: 'Reddit', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', link: 'Link' };
  function isBranded(p) { return !!(p.brand && p.brand.enhanced && p.brand.imageUrl); }
  function logoHTML(p, size) {
    if (!p.brand || !p.brand.imageUrl) return '';
    const s = size || 38;
    return '<span class="np-logo"><img class="np-logo-img" src="' + esc(p.brand.imageUrl) + '" alt="" loading="lazy" decoding="async" width="' + s + '" height="' + s + '"></span>';
  }
  // Positive-only badges for the summary row (branded/boosted tokens visually pop; the rest stay clean).
  function badgesHTML(p) {
    const b = p.brand || {}; let out = '';
    // honest wording: presence of Dexscreener info doesn't prove payment or verification — only that the team added it.
    if (b.enhanced) out += '<span class="np-badge np-badge--dex" title="This token has added info on Dexscreener (logo, socials, links). A signal of effort — not a verification or safety check.">ⓘ Dexscreener info</span>';
    if (b.boosted > 0) out += '<span class="np-badge np-badge--boost" title="Paid Dexscreener boosts are active on this token">⚡ Boosted ×' + b.boosted + '</span>'; // boosts are a genuinely paid signal
    if (b.dextools && b.dextools.updated) out += '<span class="np-badge np-badge--dext" title="Listed on Dextools with a logo or socials">Dextools info</span>';
    return out ? '<span class="np-badges">' + out + '</span>' : '';
  }
  function socialsHTML(p) {
    const b = p.brand; if (!b) return '';
    const links = [];
    (b.websites || []).forEach(w => links.push({ t: 'website', url: w.url, label: w.label || 'Website' }));
    (b.socials || []).forEach(s => links.push({ t: s.type, url: s.url, label: SOCIAL_LABEL[s.type] || 'Link' }));
    if (b.dextools && b.dextools.url) links.push({ t: 'link', url: b.dextools.url, label: 'Dextools' });
    if (!links.length) return '';
    return '<div class="np-socials">' + links.map(l => '<a class="np-social-btn" href="' + esc(l.url) + '" target="_blank" rel="noopener nofollow"><span class="np-social-ico" aria-hidden="true">' + (SOCIAL_ICON[l.t] || '🔗') + '</span>' + esc(l.label) + '</a>').join('') + '</div>';
  }
  // Explicit paid/updated status for BOTH platforms — shown in the expanded detail so "whether or not paid" is clear.
  function brandStatusHTML(p) {
    const b = p.brand || {};
    const dex = b.enhanced
      ? '<span class="np-status-yes">✓ Info added' + (b.boosted > 0 ? ' · ⚡ Paid boost ×' + b.boosted : '') + '</span>'
      : '<span class="np-status-no">— no info added</span>';
    let dext;
    if (b.dextools == null) dext = '<span class="np-status-unk" title="Needs a Dextools API key to check (and Robinhood Chain must be listed there)">— not connected</span>';
    else if (b.dextools.updated) dext = '<span class="np-status-yes">✓ Logo or socials added</span>';
    else if (b.dextools.listed) dext = '<span class="np-status-no">listed, no branding</span>';
    else dext = '<span class="np-status-no">— not listed</span>';
    return '<div class="np-brandstat"><div><b>Dexscreener</b> ' + dex + '</div><div><b>Dextools</b> ' + dext + '</div></div>' +
      '<p class="np-brand-note">ℹ️ Branding is self-added by the team on the listing site — a signal of effort, <b>not</b> a safety check or endorsement. Always DYOR.</p>';
  }
  function brandHeadHTML(p) {
    const b = p.brand; if (!b) return '';
    if (!(b.enhanced || b.boosted > 0 || b.dextools)) return ''; // render the brand block whenever a badge/status would show
    const banner = b.header ? '<div class="np-brand-banner"><img class="np-logo-img" src="' + esc(b.header) + '" alt="' + esc(p.token.symbol) + ' banner" loading="lazy" decoding="async"></div>' : '';
    const idrow = (b.imageUrl || banner)
      ? '<div class="np-brand-row">' + logoHTML(p, 52) + '<div class="np-brand-id"><span class="np-brand-name">' + esc(p.token.name) + ' <span class="np-sym">$' + esc(p.token.symbol) + '</span></span>' + badgesHTML(p) + '</div></div>'
      : '';
    return '<section class="np-brand">' + banner + idrow + brandStatusHTML(p) + socialsHTML(p) + '</section>';
  }

  function summaryHTML(p) {
    const tri = triageOf(p), health = Math.round((p.risk && p.risk.health) || 0);
    const T = verdictOf(p);
    const liq = npFmtUsd(p.market.liquidityUsd);
    const mc = npFmtUsd(p.market.marketCap);
    return '<summary class="np-sum"><div class="np-head">' +
      gaugeHTML(p, tri, health) +
      logoHTML(p) +
      '<span class="np-id">' +
        '<span class="np-name">' + esc(p.token.name) + ' <span class="np-sym">$' + esc(p.token.symbol) + '</span>' + tickerCopy(p.token.address) + '</span>' +
        '<span class="np-meta"><span class="np-age">🕐 ' + npFmtAge(p.pair.ageMinutes) + '</span><span class="np-quote">/ ' + esc(p.pair.quoteSymbol) + '</span>' + commSlot(p.token.address, p.token.symbol) + '</span>' +
        badgesHTML(p) +
      '</span>' +
      '<span class="np-verdict ' + T.cls + '"><span class="np-verdict-ico" aria-hidden="true">' + T.ico + '</span><span class="np-verdict-word">' + T.word + '</span></span>' +
      '<span class="np-stat np-mc"><b class="np-stat-val">' + mc + '</b><i class="np-stat-lbl">MC</i></span>' +
      '<span class="np-stat np-liq"><b class="np-stat-val np-liq-val">' + liq + '</b><i class="np-stat-lbl np-liq-lbl">liq</i></span>' +
      '<span class="np-chg-slot">' + chgChipHTML(p.priceChange.h1) + '</span>' +
      callBtnHTML(p) +
      (window.Watchlist ? Watchlist.btnHTML(p, 'np-row-watch') : '') +
      '<span class="np-chev" aria-hidden="true">▾</span>' +
      '<span class="sr-only">' + esc(p.token.name) + ', ' + esc(p.token.symbol) + ', ' + npFmtAge(p.pair.ageMinutes) + ' old. Verdict ' + T.word + ', health ' + health + ' of 100. Market cap ' + mc + ', liquidity ' + liq + (p.priceChange.h1 != null ? ', ' + (p.priceChange.h1 >= 0 ? 'up ' : 'down ') + pctPlain(Math.abs(p.priceChange.h1)) + ' in the last hour' : '') + '. Expand for full detail.</span>' +
    '</div>' + flagstripHTML(p) + '</summary>';
  }

  /* ---------- expanded detail panel ---------- */
  function copyBtn(addr, label) { return '<button class="copy-btn" type="button" data-copy="' + esc(addr) + '" aria-label="Copy ' + esc(label || 'address') + '">📋</button>'; }
  // "Pin to my wall" button HTML — appears on every token's on-chain detail (DEX list, Hot Feed, lookup, Send Call widget, popup). State/handler are set up at the top of the IIFE.
  function pinBtnHTML(p) {
    const on = isPinned(p.token.address);
    return '<button class="np-pin btn btn-sm' + (on ? ' is-pinned' : '') + '" type="button" data-pin="' + esc(p.token.address) + '" data-pair="' + esc(p.pair.address) + '" data-sym="' + esc(p.token.symbol) + '" data-name="' + esc(p.token.name) + '"' + (p.brand && p.brand.imageUrl ? ' data-logo="' + esc(p.brand.imageUrl) + '"' : '') + ' aria-pressed="' + on + '">' + (on ? '📌 Pinned to wall' : '📌 Pin to my wall') + '</button>';
  }
  /* 📣 Send Call straight from the DEX list row.
     A call is PERMANENT and can never be deleted, so a single stray tap on a dense list row must not be able to
     post one: the first press arms the button ("Sure?"), a second press within 5 s sends it, and anything else
     (Escape, five seconds, arming a different row) puts it back. The full-detail button keeps its single-press
     behaviour — you already had to open the token to reach it.
     Tokens under the server's $500 liquidity floor get no button at all rather than a button that always errors. */
  const CALL_MIN_LIQ = 500;
  function callBtnHTML(p) {
    const liq = p.market && p.market.liquidityUsd;
    if (!(liq != null && liq >= CALL_MIN_LIQ)) return '';
    return '<button class="np-row-call" type="button" data-call-token="' + esc(p.token.address) + '" data-call-sym="' + esc(p.token.symbol) + '"' +
      ' title="Make a Send Call on $' + esc(p.token.symbol) + '" aria-label="Make a Send Call on ' + esc(p.token.symbol) + '. Press once to confirm — a Send Call is permanent.">📣</button>';
  }
  let callArmed = null, callArmTimer = 0;
  function disarmCall() {
    clearTimeout(callArmTimer);
    if (callArmed) {
      callArmed.classList.remove('is-armed');
      callArmed.textContent = '📣';
      callArmed.setAttribute('aria-label', 'Make a Send Call on ' + (callArmed.dataset.callSym || '') + '. Press once to confirm — a Send Call is permanent.');
      callArmed = null;
    }
  }
  function armCall(btn) {
    if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
    if (callArmed === btn) { disarmCall(); makeSendCall(btn); return; }   // second press → send it
    disarmCall();
    callArmed = btn;
    btn.classList.add('is-armed');
    btn.textContent = '📣 Sure?';
    btn.setAttribute('aria-label', 'Confirm the Send Call on ' + (btn.dataset.callSym || '') + '. It is permanent and can never be deleted.');
    if (window.announce) announce('Press again to post a permanent Send Call on ' + (btn.dataset.callSym || '') + '.');
    callArmTimer = setTimeout(disarmCall, 5000);
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && callArmed) disarmCall(); });
  // a small copy button that sits next to a ticker (stops the click from also toggling the row it lives in)
  function tickerCopy(addr) { return '<button class="np-tickcopy" type="button" data-copy="' + esc(addr) + '" data-nostop="1" title="Copy contract address" aria-label="Copy contract address">📋</button>'; }
  // 🏘️ Community / ＋ Start community tag placeholder — tokentext.js fills it (batched lookup, 60 s cache); empty when that module isn't loaded
  function commSlot(addr, sym) { return window.tokenCommunitySlot ? tokenCommunitySlot(addr, sym || '') : ''; }
  function commDecorate(root) { if (window.decorateTokenCommunities) decorateTokenCommunities(root); }
  const viewedDetails = new Set(); // token addresses whose FULL on-chain detail the user has opened this session (drives the "did they DYOR?" flag)
  function markViewed(addr) { if (addr) viewedDetails.add(String(addr).toLowerCase()); }
  // deep honeypot / contract-code read (lazy-loaded into the Contract score section when it expands)
  function contractHTML(j) {
    j = j || {};
    const liq = j.liquidity;
    let liqLine = '';
    if (liq && liq.known) {
      liqLine = liq.locked
        ? '<p class="np-hp-ok">🔒 <b>Liquidity looks locked / burned</b> — about <b>' + Math.round(liq.lockedPct) + '%</b> of the LP sits in a burn address or locker, so it can’t easily be pulled.</p>'
        : '<p class="np-hp-bad">⚠️ <b>Liquidity does NOT look locked</b> — only about <b>' + Math.round(liq.lockedPct) + '%</b> of the LP is burned/locked, so it could be pulled (rug risk).</p>';
    } else if (liq) liqLine = '<p class="np-hp-note">🤷 Couldn’t tell whether the liquidity is locked.</p>';
    const sevCls = { critical: 'crit', high: 'high', medium: 'med' };
    const powers = (j.powers || []).length
      ? '<p class="np-hp-sub">The owner’s code appears able to:</p><ul class="np-hp-powers">' + j.powers.map(x => '<li class="np-hp-' + (sevCls[x.sev] || 'med') + '"><b>' + esc(x.can) + '</b> — ' + esc(x.why) + '</li>').join('') + '</ul>'
      : (j.verified ? '<p class="np-hp-ok">✔ No mint, blacklist, pause, trading-toggle or tax-changing powers were found in the source.</p>' : '');
    return '<div class="np-hp">' +
      '<p class="np-hp-h">🍯 Honeypot &amp; contract read</p>' +
      '<p class="np-hp-summary">' + esc(j.summary || '') + '</p>' + powers + liqLine +
      '<p class="np-hp-disclaim">A heuristic scan of the on-chain contract — <b>not an audit</b>, and not a live buy/sell simulation. Always DYOR.</p>' +
    '</div>';
  }
  async function loadContract(el) {
    if (!el || el.dataset.loaded || el.dataset.loading) return;
    el.dataset.loading = '1';
    try {
      const r = await fetch('/api/pairs/contract?token=' + encodeURIComponent(el.dataset.token) + '&pair=' + encodeURIComponent(el.dataset.pair || ''), { credentials: 'same-origin' });
      const j = await r.json();
      if (r.ok) { el.innerHTML = contractHTML(j); el.dataset.loaded = '1'; } else el.innerHTML = '<p class="np-contract-load">Couldn’t read the contract right now.</p>';
    } catch { el.innerHTML = '<p class="np-contract-load">Couldn’t read the contract right now.</p>'; }
    finally { delete el.dataset.loading; }
  }
  /* ---------- 📈 live chart (Dexscreener embed) ----------
     Rendered inside every on-chain detail body — the DEX list, the Hot Feed's full detail, a pasted-address
     lookup, the site-wide token popup and the Send Call widget all route through bodyHTML().
     The <iframe> only exists once a detail body has been inserted (bodies are built on expand), and carries
     loading="lazy" so a body scrolled out of view doesn't pull a chart nobody is looking at.
     frame-src in the CSP allows dexscreener.com and nothing else. */
  const CHART_OPTS = 'embed=1&amp;loadChartSettings=0&amp;trades=0&amp;tabs=0&amp;info=0&amp;chartLeftToolbar=0&amp;chartDefaultOnMobile=1&amp;chartTheme=dark&amp;theme=dark&amp;chartStyle=1&amp;chartType=usd&amp;interval=15';
  function chartHTML(p) {
    if (!p.indexed || !p.pair || !p.pair.address) {
      return '<p class="np-why-clean">📈 No chart yet — this pair has not traded, so there is nothing to draw.</p>';
    }
    // Our own chart, drawn from this pair's Swap events. No third-party iframe: same underlying data
    // every aggregator uses, minus the rate limit, the tracking surface and the extra hop.
    return '<div class="onchain-chart" data-pair="' + esc(p.pair.address) + '" data-token="' + esc(p.token.address) + '" data-tf="1h"></div>' +
      '<p class="np-chart-note">Built live from on-chain swaps. ' +
      '<a href="' + esc(p.links.dex) + '" target="_blank" rel="noopener nofollow">Cross-check on Dexscreener ↗</a></p>';
  }
  function mountCharts(root) { if (window.mountOnChainCharts) mountOnChainCharts(root || document); }
  function group(id, title, openDefault, inner) {
    return '<details class="np-detail-group" data-group="' + id + '"' + (openDefault ? ' open' : '') + '>' +
      '<summary class="np-detail-h">' + title + '</summary><div class="np-detail-body">' + inner + '</div></details>';
  }
  function bodyHTML(p, sections, opts) {
    const S = sections || state.sections; opts = opts || {}; // S = which sections start open; opts.hideCall hides the "Make a Send Call" CTA (e.g. inside a Send Call widget)
    const tri = triageOf(p), T = verdictOf(p);
    const flags = activeFlags(p);
    const h = p.holders, m = p.market, r = p.risk || {};

    // A. Why verdict (always shown)
    let why;
    if (flags.length) {
      why = '<section class="np-why"><h3 class="np-why-h">Why we say <span class="np-verdict-word ' + T.cls + '">' + T.word + '</span></h3><ul class="np-why-list">';
      flags.forEach(k => { why += '<li class="np-why-' + (FLAG[k].sev === 'bad' ? 'bad' : 'warn') + '"><span aria-hidden="true">' + FLAG[k].ico + '</span> ' + esc(FLAG[k].say(p)) + '</li>'; });
      why += '</ul></section>';
    } else {
      why = '<section class="np-why"><p class="np-why-clean">✔ No automatic red flags tripped. That doesn\'t mean it\'s safe — most new tokens still go to zero. Do your own research.</p></section>';
    }

    // B. Market
    const supply = supplyOf(p);
    const resv = m.reserves ? '<p class="np-reserves">💧 Pooled: <b>' + npCompact(m.reserves.tokenAmount) + '</b> ' + esc(p.token.symbol) + ' + <b>' + npCompact(m.reserves.quoteAmount) + '</b> ' + esc(m.reserves.quoteSymbol) + '</p>' : '';
    const vmax = Math.max(p.volume.m5, p.volume.h1, p.volume.h6, p.volume.h24, 1);
    const vbar = (v, lbl) => '<span class="np-vbar" style="height:' + Math.max(4, Math.round(v / vmax * 100)) + '%"><i>' + lbl + '</i></span>';
    const vol = '<div class="np-vol" role="img" aria-label="Volume: 5m ' + npFmtUsd(p.volume.m5) + ', 1h ' + npFmtUsd(p.volume.h1) + ', 6h ' + npFmtUsd(p.volume.h6) + ', 24h ' + npFmtUsd(p.volume.h24) + '">' +
      vbar(p.volume.m5, '5m') + vbar(p.volume.h1, '1h') + vbar(p.volume.h6, '6h') + vbar(p.volume.h24, '24h') + '</div>';
    const move = (lbl, v) => v == null ? '' : '<span class="price-chip ' + (v >= 0 ? 'up' : 'down') + '">' + lbl + ' ' + (v >= 0 ? '▲' : '▼') + pctPlain(Math.abs(v)) + '</span>';
    const marketInner =
      '<div class="np-kv">' +
        '<div class="hstat"><div class="lbl">Price</div><div class="val">' + npPrice(m.priceUsd) + '</div></div>' +
        '<div class="hstat"><div class="lbl">Liquidity</div><div class="val' + (r.lowLiquidity ? ' red' : '') + '">' + npFmtUsd(m.liquidityUsd) + '</div></div>' +
        '<div class="hstat np-soft"><div class="lbl">Market cap ⚠︎</div><div class="val">' + npFmtUsd(m.marketCap) + '</div></div>' +
        '<div class="hstat np-soft"><div class="lbl">FDV ⚠︎</div><div class="val">' + npFmtUsd(m.fdv) + '</div></div>' +
        '<div class="hstat"><div class="lbl">Total supply</div><div class="val">' + (supply != null ? npCompact(supply) : '—') + '</div></div>' +
        '<div class="hstat"><div class="lbl">Decimals</div><div class="val">' + (p.token.decimals != null ? p.token.decimals : '—') + '</div></div>' +
      '</div>' + resv +
      '<div class="np-vol-wrap"><div class="lbl">Volume</div>' + vol + '</div>' +
      '<div class="np-moves">' + move('1h', p.priceChange.h1) + move('6h', p.priceChange.h6) + move('24h', p.priceChange.h24) + '</div>';

    // C. Activity — flow bar + full txn table
    const b = p.txns.h24.buys, s = p.txns.h24.sells;
    let flow = '';
    if (b + s > 0) {
      flow = '<div class="np-flow"><div class="np-flow-bar" role="img" aria-label="' + npNum(b) + ' buys, ' + npNum(s) + ' sells, 24h">' +
        '<span class="np-flow-buy" style="flex:' + Math.max(b, 0.001) + '"></span><span class="np-flow-sell" style="flex:' + Math.max(s, 0.001) + '"></span></div>' +
        '<p class="np-flow-legend"><span class="np-buy">' + npNum(b) + ' buys</span> · <span class="np-sell">' + npNum(s) + ' sells</span>' +
        (r.honeypotSuspect ? ' <span class="np-flow-note">— here, buys with almost no sells is a <b>red flag</b>, not a green one.</span>' : '') + '</p></div>';
    }
    const txrow = (lbl, o) => '<tr><td>' + lbl + '</td><td class="np-tx-buy">' + npNum(o.buys) + '</td><td class="np-tx-sell">' + npNum(o.sells) + '</td></tr>';
    const txtable = '<div class="np-txwrap"><table class="np-txtable"><thead><tr><th>Window</th><th>Buys</th><th>Sells</th></tr></thead><tbody>' +
      txrow('1h', p.txns.h1) + txrow('6h', p.txns.h6) + txrow('24h', p.txns.h24) + '</tbody></table></div>';
    const activityInner = (flow || '<p class="np-why-clean">No trades recorded yet.</p>') + txtable;

    // D. Holders — count + concentration + top-10
    const holderTxt = h.count != null ? (npNum(h.count) + ' holders') : 'not indexed yet';
    let conc = '';
    if (h.topHolderPct != null) {
      conc = '<div class="np-conc"><div class="np-conc-bar"><span class="np-conc-top" style="width:' + Math.min(100, h.topHolderPct).toFixed(1) + '%"></span>' +
        (h.top10Pct != null ? '<span class="np-conc-10" style="width:' + Math.min(100, Math.max(0, h.top10Pct - h.topHolderPct)).toFixed(1) + '%"></span>' : '') + '</div>' +
        '<p class="np-conc-txt">👥 Top wallet owns <b>' + pctPlain(h.topHolderPct) + '</b>' + (h.top10Pct != null ? ', top 10 own <b>' + pctPlain(h.top10Pct) + '</b>' : '') + '.</p></div>';
    }
    let top10 = '';
    if (h.top && h.top.length) {
      top10 = '<div class="np-holders" aria-label="Top holders">' + h.top.map((x, i) =>
        '<div class="np-holder"><span class="np-hrank">#' + (i + 1) + '</span><code>' + esc(shortAddr(x.address)) + '</code>' + copyBtn(x.address, 'address of holder #' + (i + 1) + ' ' + shortAddr(x.address)) +
        '<span class="np-hpct">' + (x.pct != null ? pctPlain(x.pct) : '—') + '</span></div>').join('') + '</div>';
    }
    const holdersInner = '<p class="np-supply"><b>' + esc(holderTxt) + '</b></p>' + conc + top10 +
      (h.count == null ? '<p class="np-why-clean">Holder data lags for brand-new tokens — check back in a bit.</p>' : '');

    // E. Contract — the copy hub
    let ownerLine = '';
    if (p.token.renounced === true) ownerLine = '<p class="np-owner renounced">🛡️ <b>Ownership renounced</b> — the deployer can no longer change the contract.</p>';
    else if (p.token.owner) ownerLine = '<p class="np-owner owned">🔑 Owner <code>' + esc(shortAddr(p.token.owner)) + '</code> ' + copyBtn(p.token.owner, 'owner address') + ' <b>— can still change the contract.</b></p>';
    else ownerLine = '<p class="np-owner">🔑 Owner unknown (no standard owner() function).</p>';
    const contractInner =
      '<div class="np-addr-row"><span class="np-addr-lbl">Token</span><code>' + esc(p.token.address) + '</code>' + copyBtn(p.token.address, 'token contract address') + '</div>' +
      '<div class="np-addr-row"><span class="np-addr-lbl">Pair (LP)</span><code>' + esc(p.pair.address) + '</code>' + copyBtn(p.pair.address, 'pair address') + '</div>' +
      (p.token.deployer ? '<div class="np-addr-row"><span class="np-addr-lbl">Deployer</span><code>' + esc(shortAddr(p.token.deployer)) + '</code>' + copyBtn(p.token.deployer, 'deployer address') + (r.serialDeployer ? ' <span class="np-flag np-flag--bad">' + r.deployerLaunches + ' launched' + (r.deployerDied ? ' · ' + r.deployerDied + ' dead' : '') + '</span>' : '') + '</div>' : '') +
      ownerLine +
      '<p class="np-supply">' + (p.token.isVerified === true ? '📄 <b>Verified</b> contract source' : p.token.isVerified === false ? '📄 <b class="red">Unverified</b> — source not published' : '📄 Verification unknown') + '</p>' +
      '<div class="np-actions">' +
        (opts.hideCall ? '' : '<button class="btn btn-sm btn-primary np-call" type="button" data-call-token="' + esc(p.token.address) + '" data-call-sym="' + esc(p.token.symbol) + '">📣 Make a Send Call</button>') +
        pinBtnHTML(p) +
        '<a class="btn btn-sm btn-ghost" href="' + esc(p.links.explorer) + '" target="_blank" rel="noopener nofollow">🔍 Explorer ↗</a>' +
        '<a class="btn btn-sm btn-ghost" href="' + esc(p.links.dex) + '" target="_blank" rel="noopener nofollow">📈 Chart ↗</a>' +
      '</div>';

    return '<div class="np-body">' + brandHeadHTML(p) + why +
      group('chart', '📈 Chart', S.chart !== false, chartHTML(p)) +
      group('score', '🎯 Score breakdown', S.score, breakdownHTML(p)) +
      group('market', '📊 Market', S.market, marketInner) +
      group('activity', '🔁 Activity', S.activity, activityInner) +
      group('holders', '👥 Holders', S.holders, holdersInner) +
      // the first buyers this pool ever had — filled in by block0.js wherever this body is inserted
      group('block0', '🎯 Block 0 — the first buyers', S.block0 !== false, '<div class="np-b0" data-token="' + esc(p.token.address) + '"></div>') +
      group('contract', '📄 Contract &amp; copy', S.contract, contractInner) +
      '<p class="np-honest">Auto-flags are heuristics from public data — not a guarantee and not an audit. Most new tokens go to zero. We don\'t tell you to buy. Entertainment only.</p></div>';
  }
  function rowHTML(p) {
    const tri = triageOf(p);
    const isOpen = state.open.has(p.pair.address);
    return '<li class="np-row' + (isBranded(p) ? ' np-branded' : '') + '" data-addr="' + esc(p.pair.address) + '" data-level="' + tri + '" style="' + tokVars(p) + '">' +
      '<details class="np-card"' + (isOpen ? ' open' : '') + '>' + summaryHTML(p) + (isOpen ? bodyHTML(p) : '') + '</details></li>';
  }

  /* ---------- filter / sort / view ---------- */
  function isRisky(p) { const t = triageOf(p); return t === 'high' || t === 'avoid' || (p.risk && (p.risk.honeypotSuspect || p.risk.serialDeployer)); }
  const SAFER_MIN = 75; // Safer tab shows only pairs scoring at least this (the Hot Feed is stricter still: a full 100)
  function saferOk(p) { return !isRisky(p) && healthOf(p) >= SAFER_MIN; } // passes the Safer tab: not risky AND scores ≥ 75 (healthOf defined below)
  // High-risk tokens auto-hidden from the main list (BOTH the default "Safer" AND "All" views) — only the
  // explicit "Risky ☠️" tab reveals them. Covers honeypots, serial deployers, high-risk/avoid triage (isRisky)
  // and thin-liquidity tokens (which on their own may not trip isRisky but are exactly what people want hidden).
  function hideFromMain(p) { return isRisky(p) || !!(p.risk && p.risk.lowLiquidity); }
  function passFilters(p) {
    const f = state.filters, q = f.quote;
    const qs = p.pair.quoteSymbol, other = qs !== 'WETH' && qs !== 'USDG';
    if (!(q.weth && q.usdg && q.other)) {                 // some quote filter active
      if (qs === 'WETH' && !q.weth) return false;
      if (qs === 'USDG' && !q.usdg) return false;
      if (other && !q.other) return false;
    }
    if (f.verified && p.token.isVerified !== true) return false;
    if (f.indexed && !p.indexed) return false;
    if (f.minLiq > 0 && !(p.market.liquidityUsd != null && p.market.liquidityUsd >= f.minLiq)) return false;
    if (f.minVol > 0 && !(p.volume.h24 >= f.minVol)) return false;
    if (f.maxAge < 1440 && !(p.pair.ageMinutes != null && p.pair.ageMinutes <= f.maxAge)) return false;
    if (f.minHealth > 0 && ((p.risk && p.risk.health) || 0) < f.minHealth) return false;
    if (f.minHolders > 0 && !(p.holders.count != null && p.holders.count >= f.minHolders)) return false;
    if (f.maxTopPct < 100 && p.holders.topHolderPct != null && p.holders.topHolderPct > f.maxTopPct) return false; // null passes
    if (f.price1h !== 'any') {
      const c = p.priceChange.h1; if (c == null) return false;
      if (f.price1h === 'up' && !(c > 0)) return false;
      if (f.price1h === 'down' && !(c < 0)) return false;
      if (f.price1h === 'm20' && Math.abs(c) < 20) return false;
      if (f.price1h === 'm50' && Math.abs(c) < 50) return false;
    }
    if (f.flow !== 'any') {
      const bb = p.txns.h24.buys, ss = p.txns.h24.sells;
      if (f.flow === 'buys' && !(bb > ss)) return false;
      if (f.flow === 'sells' && !(ss > bb)) return false;
      if (f.flow === 'bal' && !(Math.abs(bb - ss) <= Math.max(1, (bb + ss) * 0.15))) return false;
    }
    for (const k in f.hide) { if (f.hide[k] && p.risk && p.risk[k]) return false; }
    if (state.q) {
      const query = state.q.toLowerCase();
      const hay = (p.token.name + ' ' + p.token.symbol + ' ' + p.token.address + ' ' + p.pair.address).toLowerCase();
      if (hay.indexOf(query) < 0) return false;
    }
    return true;
  }
  function applyView() {
    let v = state.all.filter(passFilters);
    if (state.safety === 'safer') v = v.filter(saferOk);
    else if (state.safety === 'risky') v = v.filter(hideFromMain); // the explicit opt-in: shows exactly what "All" auto-hides
    else v = v.filter(p => !hideFromMain(p)); // "All" now auto-hides high-risk (honeypots, thin liquidity, high-risk) — Risky ☠️ to reveal
    const S = state.sort;
    const liq = p => p.market.liquidityUsd == null ? -1 : p.market.liquidityUsd;
    if (S === 'new') v.sort((a, b) => (b.pair.createdAt || 0) - (a.pair.createdAt || 0));
    else if (S === 'old') v.sort((a, b) => (a.pair.createdAt || 0) - (b.pair.createdAt || 0));
    else if (S === 'health') v.sort((a, b) => (b.risk.health || 0) - (a.risk.health || 0));
    else if (S === 'liq') v.sort((a, b) => liq(b) - liq(a));
    else if (S === 'vol') v.sort((a, b) => (b.volume.h24 || 0) - (a.volume.h24 || 0));
    else if (S === 'move') v.sort((a, b) => Math.abs(b.priceChange.h1 || 0) - Math.abs(a.priceChange.h1 || 0));
    else if (S === 'holders') v.sort((a, b) => ((b.holders.count == null ? -1 : b.holders.count) - (a.holders.count == null ? -1 : a.holders.count)));
    else if (S === 'active') v.sort((a, b) => ((b.txns.h24.buys + b.txns.h24.sells) - (a.txns.h24.buys + a.txns.h24.sells)));
    state.view = v;
  }

  /* ---------- render ---------- */
  function applyDensity() { listEl.classList.toggle('is-compact', state.density === 'compact'); }
  function render() {
    stopRafs();
    applyDensity();
    if (state.lookup && state.mode === 'list') { renderLookup(); return; } // address search → single detail card
    if (!state.all.length) { renderState(); return; }
    if (!state.view.length) { renderEmpty(); updateStatus(); return; }
    listEl.innerHTML = state.view.map(rowHTML).join('');
    animateRings(listEl);
    commDecorate(listEl);
    updateStatus();
  }
  function renderState() {
    if (npData.building || (!state.started)) {
      listEl.innerHTML = Array.from({ length: 6 }, () => '<li class="np-row np-skel"><div class="np-skel-ring skeleton"></div><div class="np-skel-lines"><span class="skeleton"></span><span class="skeleton"></span></div></li>').join('');
      listEl.setAttribute('aria-busy', 'true');
      statusEl.innerHTML = '<span class="np-live-dot" aria-hidden="true"></span> Scanning the chain for new pairs…';
      return;
    }
    listEl.removeAttribute('aria-busy');
    if (npData.error) { listEl.innerHTML = '<li class="np-msg np-error">⚠️ Couldn\'t reach the radar. <button class="btn btn-sm btn-ghost" id="np-retry" type="button">Try again</button></li>'; return; }
    listEl.innerHTML = '<li class="np-msg">🌙 Quiet on the chain — no new pairs right now. Fewer fresh tokens means fewer traps. Check back later.</li>';
  }
  function renderEmpty() {
    listEl.removeAttribute('aria-busy');
    if (state.q) { listEl.innerHTML = '<li class="np-msg">No pair matches “' + esc(state.q) + '”. <button class="btn btn-sm btn-ghost" id="np-clearq" type="button">Clear search</button></li>'; return; }
    if (state.safety === 'safer' && state.all.length) { listEl.innerHTML = '<li class="np-msg np-allclear">🛡️ All clear in Safer view — every new pair matching your filters tripped our checks, so none are shown by default.<div style="margin-top:0.7rem; display:flex; gap:0.5rem; justify-content:center; flex-wrap:wrap;"><button class="btn btn-sm btn-ghost" id="np-showrisky" type="button">Show risky ☠️</button><button class="btn btn-sm btn-ghost" id="np-reset2" type="button">Reset filters</button></div></li>'; return; }
    listEl.innerHTML = '<li class="np-msg">Nothing matches these filters. <button class="btn btn-sm btn-ghost" id="np-reset2" type="button">Reset filters</button></li>';
  }
  function updateStatus() {
    if (state.lookup && state.mode === 'list') return; // renderLookup owns the status line during an address lookup
    const shown = state.view.length;
    const passed = state.all.filter(passFilters);
    const hidden = state.safety === 'safer' ? passed.filter(p => !saferOk(p)).length
      : state.safety === 'all' ? passed.filter(hideFromMain).length
      : passed.filter(p => !hideFromMain(p)).length;
    const ago = state.lastFetch ? Math.max(0, Math.round((Date.now() - state.lastFetch) / 1000)) : null;
    let txt = '<span class="np-live-dot' + (npData.stale ? ' stale' : '') + '" aria-hidden="true"></span> ' + shown + ' of ' + state.all.length + ' pair' + (state.all.length === 1 ? '' : 's');
    if (state.safety === 'safer' && hidden > 0) txt += ' · <button class="np-hidden-link" type="button" id="np-showhidden">' + hidden + ' hidden (risky or under ' + SAFER_MIN + '%)</button>';
    else if (state.safety === 'all' && hidden > 0) txt += ' · <button class="np-hidden-link" type="button" id="np-showhigh">🛡️ ' + hidden + ' high-risk hidden ☠️</button>';
    if (ago != null) txt += ' · <span class="np-ago">updated ' + (ago < 60 ? ago + 's' : Math.round(ago / 60) + 'm') + ' ago</span>';
    if (npData.stale) txt = '<span class="np-live-dot stale" aria-hidden="true"></span> ⚠️ Feed may be stale · ' + txt.replace(/^<span[^>]*><\/span> /, '');
    statusEl.innerHTML = txt;
  }

  /* ---------- address lookup: paste any token contract → full on-chain detail (same card as a live pair) ---------- */
  const LOOKUP_RE = /^0x[0-9a-f]{40}$/;
  let lookupSeq = 0; // monotonic id so only the MOST RECENT fetch may write state.lookup (drops out-of-order results)
  // resolve a card object for an addr from either the live set OR the current lookup (ingest() rebuilds byAddr each
  // poll, so a fetched lookup lives only in state.lookup — the toggle/watch handlers must fall back to it)
  const pairFor = (addr) => {
    const hit = state.byAddr.get(addr); if (hit) return hit;
    const lk = state.lookup;
    return (lk && lk.p && lk.p.pair.address.toLowerCase() === String(addr).toLowerCase()) ? lk.p : null;
  };
  // tear a lookup down cleanly: never leave its address stuck in state.open (that would auto-expand the live row
  // later and make the poll think the list is "busy"), and invalidate any in-flight fetch.
  function clearLookup() {
    if (state.lookup && state.lookup.p) state.open.delete(state.lookup.p.pair.address);
    state.lookup = null; lookupSeq++;
  }
  function onSearch() {
    const addr = state.q.toLowerCase();
    if (LOOKUP_RE.test(addr)) {                       // a full contract address = "show me this token"
      if (state.mode === 'feed') setMode('list');     // surface it in the DEX list even from the Hot Feed
      newbar.hidden = true; state.staged = [];        // a lookup replaces the list — drop any staged "🆕 new pairs" bar
      resolveLookup(addr);
      render();
      return;
    }
    clearLookup();
    applyView(); render();
    announce(state.view.length + ' pairs shown');
  }
  function resolveLookup(addr) {
    if (state.lookup && state.lookup.p && state.lookup.addr !== addr) state.open.delete(state.lookup.p.pair.address); // drop the previous lookup's open flag
    const live = state.all.find(p => p.token.address.toLowerCase() === addr || p.pair.address.toLowerCase() === addr);
    if (live) { lookupSeq++; state.lookup = { addr, status: 'done', p: live, fromLive: true }; announce('Loaded on-chain detail for ' + live.token.name + ' $' + live.token.symbol); return; } // already enriched → no fetch
    if (state.lookup && state.lookup.addr === addr && (state.lookup.status === 'loading' || state.lookup.status === 'done')) return; // in flight / shown
    const seq = ++lookupSeq;
    state.lookup = { addr, status: 'loading', p: null };
    announce('Looking up token ' + shortAddr(addr));
    fetchLookup(addr, seq);
  }
  async function fetchLookup(addr, seq) {
    let lk;
    try {
      const r = await fetch('/api/pairs/lookup?token=' + encodeURIComponent(addr), { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (seq !== lookupSeq || state.q.toLowerCase() !== addr) return; // superseded by a newer lookup, or query moved on
      if (r.ok && j.pair && !identified(j.pair)) lk = { addr, status: 'unnamed' };
      else if (r.ok && j.pair) lk = { addr, status: 'done', p: j.pair };
      else if (j && j.notFound) lk = { addr, status: 'notfound', msg: j.message || null };
      else lk = { addr, status: 'error', msg: (j && j.error) || null };
    } catch { if (seq !== lookupSeq || state.q.toLowerCase() !== addr) return; lk = { addr, status: 'error' }; }
    state.lookup = lk;
    if (lk.status === 'done') announce('Loaded on-chain detail for ' + lk.p.token.name + ' $' + lk.p.token.symbol);
    else if (lk.status === 'unnamed') announce('That token’s name and symbol do not resolve on-chain, so it is not shown here.');
    else if (lk.status === 'notfound') announce(lk.msg || ('No trading pair found for ' + shortAddr(addr)));
    else announce('Lookup failed — try again.');
    if (state.mode === 'list') render();
  }
  function renderLookup() {
    listEl.removeAttribute('aria-busy');
    const lk = state.lookup; if (!lk) { render(); return; }
    if (lk.status === 'loading') {
      listEl.innerHTML = '<li class="np-msg np-lookup-loading"><span class="np-live-dot" aria-hidden="true"></span> 🔎 Reading the chain for <code>' + esc(shortAddr(lk.addr)) + '</code>…</li>';
      statusEl.innerHTML = '<span class="np-live-dot" aria-hidden="true"></span> Looking up token on-chain…';
      return;
    }
    if (lk.status === 'unnamed') {
      listEl.innerHTML = '<li class="np-msg">🕵️ That address has a pool, but its <b>name and symbol don’t resolve on-chain</b> — there is nothing here we can honestly identify for you. <code>' + esc(shortAddr(lk.addr)) + '</code> <button class="btn btn-sm btn-ghost" id="np-clearq" type="button">Clear search</button></li>';
      statusEl.innerHTML = '';
      return;
    }
    if (lk.status === 'notfound') {
      listEl.innerHTML = '<li class="np-msg">🤷 ' + esc(lk.msg || 'No indexed trading pair or WETH/USDG pool found for this address.') + ' <code>' + esc(shortAddr(lk.addr)) + '</code> · double-check the address. <button class="btn btn-sm btn-ghost" id="np-clearq" type="button">Clear search</button></li>';
      statusEl.innerHTML = '';
      return;
    }
    if (lk.status === 'error') {
      listEl.innerHTML = '<li class="np-msg np-error">⚠️ Couldn’t look that up right now. <button class="btn btn-sm btn-ghost" id="np-lookup-retry" type="button">Try again</button> · <button class="btn btn-sm btn-ghost" id="np-clearq" type="button">Clear</button></li>';
      statusEl.innerHTML = '';
      return;
    }
    // done — one detail card, rendered OPEN inline (without mutating the shared state.open Set) so full detail shows now
    const p = lk.p;
    listEl.innerHTML = '<li class="np-lookup-note">🔎 On-chain lookup for a pasted address' + (lk.fromLive ? ' · also live in the radar' : '') + ' <button class="np-lookup-clear" id="np-clearq" type="button">✕ Clear</button></li>' +
      '<li class="np-row' + (isBranded(p) ? ' np-branded' : '') + '" data-addr="' + esc(p.pair.address) + '" data-level="' + triageOf(p) + '" style="' + tokVars(p) + '"><details class="np-card" open>' + summaryHTML(p) + bodyHTML(p) + '</details></li>';
    markViewed(p.token.address); // pasted-address lookup opens the full detail
    animateRings(listEl);
    commDecorate(listEl);
    statusEl.innerHTML = '<span class="np-live-dot" aria-hidden="true"></span> On-chain detail for this token · always DYOR';
  }

  /* ---------- in-place patch (poll) ---------- */
  function patchRow(li, p) {
    const tri = triageOf(p), T = verdictOf(p), health = Math.round((p.risk && p.risk.health) || 0);
    li.dataset.level = tri;
    const gauge = li.querySelector('.np-gauge'); if (gauge) gauge.className = 'np-gauge ' + T.cls;
    const gnum = li.querySelector('.np-gauge-num'); if (gnum) gnum.textContent = health;
    const arc = li.querySelector('.np-gauge-arc'); if (arc) { const prevFill = Number(arc.getAttribute('data-fill')); arc.setAttribute('data-fill', health); if (prevFill !== health) setArc(arc, health); else arc.style.strokeDashoffset = 100 - Math.max(0, Math.min(100, health)); } // only replay the fill when it actually changed (no idle-poll flicker)
    const vw = li.querySelector('.np-verdict'); if (vw) { vw.className = 'np-verdict ' + T.cls; vw.innerHTML = '<span class="np-verdict-ico" aria-hidden="true">' + T.ico + '</span><span class="np-verdict-word">' + T.word + '</span>'; }
    const lv = li.querySelector('.np-liq-val'); if (lv) lv.textContent = npFmtUsd(p.market.liquidityUsd);
    const cs = li.querySelector('.np-chg-slot'); if (cs) cs.innerHTML = chgChipHTML(p.priceChange.h1);
    const strip = li.querySelector('.np-flagstrip'); if (strip) strip.outerHTML = flagstripHTML(p);
    const sr = li.querySelector('.np-sum .np-head > .sr-only');
    if (sr) sr.textContent = p.token.name + ', ' + p.token.symbol + ', ' + npFmtAge(p.pair.ageMinutes) + ' old. Verdict ' + T.word + ', health ' + health + ' of 100. Liquidity ' + npFmtUsd(p.market.liquidityUsd) + (p.priceChange.h1 != null ? ', ' + (p.priceChange.h1 >= 0 ? 'up ' : 'down ') + pctPlain(Math.abs(p.priceChange.h1)) + ' in the last hour' : '') + '. Expand for full detail.';
    const det = li.querySelector('details.np-card');
    if (det && det.open) {
      const body = li.querySelector('.np-body');
      const busy = body && ((body.contains(document.activeElement)) || (window.getSelection && getSelection().anchorNode && body.contains(getSelection().anchorNode)));
      if (body && !busy) body.outerHTML = bodyHTML(p);
    }
  }
  function patchExisting() {
    listEl.querySelectorAll('li.np-row[data-addr]').forEach(li => { const p = state.byAddr.get(li.dataset.addr); if (p) patchRow(li, p); });
  }

  /* ---------- data ---------- */
  let npData = { building: true, error: null, stale: false };
  function ingest(all) {
    const pairs = all.filter(identified);      // an unidentifiable token never enters the radar's state at all
    const map = new Map(); pairs.forEach(p => map.set(p.pair.address, p));
    const prevAddrs = new Set(state.byAddr.keys());
    const newAddrs = pairs.filter(p => !prevAddrs.has(p.pair.address)).map(p => p.pair.address);
    state.all = pairs.slice(); state.byAddr = map;
    return newAddrs;
  }
  async function fetchPairs(manual) {
    try {
      const res = await fetch('/api/pairs/new' + (CHAIN && CHAIN !== 'robinhood' ? '?chain=' + encodeURIComponent(CHAIN) : ''), { credentials: 'same-origin' });
      const j = await res.json();
      npData.building = !!j.building; npData.error = j.error || null;
      if (Array.isArray(j.chains) && j.chains.length) {
        CHAINS = j.chains;
        if (!CHAINS.some(c => c.slug === CHAIN)) {   // a saved chain that is no longer offered
          CHAIN = j.chain || 'robinhood';
          try { localStorage.setItem('np:chain', CHAIN); } catch {}
        }
        renderChains();
      }
      if (chainNote) {
        if (j.note) { chainNote.textContent = j.note; chainNote.hidden = false; }
        else { chainNote.textContent = ''; chainNote.hidden = true; }
      }
      npData.stale = j.updatedAt ? (Date.now() - j.updatedAt > 4 * 60 * 1000) : false;
      state.lastFetch = Date.now();
      if (!j.pairs || !j.pairs.length) { if (!state.all.length) { state.started = true; if (state.mode === 'feed') renderFeedState(); else render(); } else if (state.mode === 'feed') { updateFeedLive(); } else updateStatus(); return; }
      const firstLoad = !state.started;
      const newAddrs = ingest(j.pairs);
      state.started = true;
      if (state.mode === 'feed') {
        applyView();                                   // keep list state warm for a later switch
        if (firstLoad || !state.feedAddrs.length) buildFeed();
        else { patchFeed(); appendFreshSlides(newAddrs); }
        updateFeedLive();
        if (manual && window.sendToast) sendToast('Feed updated 📡');
        return;
      }
      if (state.lookup) { // an address lookup owns the list — keep state.all warm, don't rebuild under it
        applyView();
        if (state.lookup.fromLive) { const fresh = state.byAddr.get(state.lookup.p.pair.address); if (fresh) { state.lookup.p = fresh; const li = listEl.querySelector('li.np-row[data-addr]'); if (li) patchRow(li, fresh); } } // keep a live card fresh
        return;
      }
      if (firstLoad) { applyView(); render(); updateChips(); updateFcount(); return; }
      patchExisting();
      const freshNew = newAddrs.filter(a => { const p = state.byAddr.get(a); return p && passFilters(p) && (state.safety === 'safer' ? saferOk(p) : state.safety === 'risky' ? hideFromMain(p) : !hideFromMain(p)); });
      // don't tear down the list while the user is reading/focused/selecting inside it (or has a row open)
      const listBusy = state.open.size > 0 || listEl.contains(document.activeElement) || (window.getSelection && getSelection().anchorNode && listEl.contains(getSelection().anchorNode));
      const prevOrder = state.view.map(p => p.pair.address).join(',');
      applyView();
      const orderChanged = state.view.map(p => p.pair.address).join(',') !== prevOrder;
      if (orderChanged && (window.scrollY > 4 || listBusy)) {
        // defer the disruptive reorder/insert: keep the in-place patched rows, offer a tap-to-refresh
        state.staged = newAddrs; newbar.hidden = false;
        newbar.textContent = freshNew.length ? ('🆕 ' + freshNew.length + ' new pair' + (freshNew.length === 1 ? '' : 's') + ' — tap to show') : '↕ List reordered — tap to refresh';
        announce(freshNew.length ? (freshNew.length + ' new pairs available') : 'List order changed — tap to refresh');
      } else if (orderChanged) {
        state.staged = []; newbar.hidden = true;
        render();
        if (newAddrs.length) flashNew(newAddrs);
      } else {
        state.staged = [];   // visible view unchanged — patchExisting already refreshed values in place; no rebuild
      }
      if (manual && window.sendToast) sendToast('Radar updated 📡');
      updateStatus();
    } catch (e) {
      npData.error = 'fetch failed';
      if (!state.all.length) { state.started = true; render(); } else updateStatus();
    }
  }
  function showStaged() {
    newbar.hidden = true;
    const fresh = state.staged.slice();   // capture the real new addresses BEFORE clearing
    state.staged = [];
    applyView(); render();
    if (fresh.length) {
      flashNew(fresh);
      const first = fresh.map(a => listEl.querySelector('li[data-addr="' + cssEsc(a) + '"]')).find(Boolean);
      if (first) first.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
      else window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    }
  }
  function flashNew(addrs) {
    if (reduced()) return;
    addrs.forEach(a => { const li = listEl.querySelector('li[data-addr="' + cssEsc(a) + '"]'); if (li) { li.classList.add('np-row--new'); setTimeout(() => li.classList.remove('np-row--new'), 2200); } });
  }
  const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
  function announce(msg) { if (srEl) { srEl.textContent = ''; setTimeout(() => { srEl.textContent = msg; }, 30); } }

  /* ---------- presets ---------- */
  const PRESETS = {
    safest:   { minHealth: 70, verified: true, minLiq: 10000, hide: { honeypotSuspect: true, concentrated: true } },
    verified: { verified: true },
    liq:      { minLiq: 10000 },
    community:{ minHolders: 100, maxTopPct: 20 },
    fresh:    { maxAge: 15 },
    trading:  { minVol: 1000, hide: { deadVolume: true } },
    nowhale:  { hide: { concentrated: true } },
    nohoney:  { hide: { honeypotSuspect: true } },
  };
  const DEF = defaultFilters();
  function presetActive(name) {
    const pr = PRESETS[name], f = state.filters;
    for (const k in pr) {
      if (k === 'hide') { for (const hk in pr.hide) if (!f.hide[hk]) return false; }
      else if (k === 'maxTopPct' || k === 'maxAge') { if (!(f[k] <= pr[k])) return false; }  // max-type
      else if (k === 'verified' || k === 'indexed') { if (f[k] !== pr[k]) return false; }
      else { if (!(f[k] >= pr[k])) return false; }   // min-type
    }
    return true;
  }
  function applyPreset(name) {
    const pr = PRESETS[name], f = state.filters, on = presetActive(name);
    for (const k in pr) {
      if (k === 'hide') { for (const hk in pr.hide) f.hide[hk] = !on; }
      else f[k] = on ? DEF[k] : pr[k];               // toggle off → default; on → preset value
    }
    syncControls(); persist(); applyView(); render(); updateChips(); updateFcount();
    announce(state.view.length + ' pairs shown');
  }
  function updateChips() {
    document.querySelectorAll('#np-presets .np-chip').forEach(c => c.setAttribute('aria-pressed', presetActive(c.dataset.preset) ? 'true' : 'false'));
  }

  /* ---------- active-filter count ---------- */
  function activeFilterCount() {
    const f = state.filters; let n = 0;
    if (!(f.quote.weth && f.quote.usdg && f.quote.other)) n++;
    if (f.verified) n++; if (f.indexed) n++;
    if (f.minLiq > 0) n++; if (f.minVol > 0) n++; if (f.maxAge < 1440) n++; if (f.minHealth > 0) n++;
    if (f.minHolders > 0) n++; if (f.maxTopPct < 100) n++;
    if (f.price1h !== 'any') n++; if (f.flow !== 'any') n++;
    for (const k in f.hide) if (f.hide[k]) n++;
    return n;
  }
  function updateFcount() {
    const el = document.getElementById('np-fcount'); if (!el) return;
    const n = activeFilterCount();
    el.textContent = n; el.hidden = n === 0;
  }

  /* ---------- sync all panel controls from state (after preset/reset/saved-view) ---------- */
  function syncControls() {
    const f = state.filters, $ = id => document.getElementById(id);
    const set = (id, v) => { const e = $(id); if (e) e.checked = v; };
    set('f-weth', f.quote.weth); set('f-usdg', f.quote.usdg); set('f-other', f.quote.other);
    set('f-verified', f.verified); set('f-indexed', f.indexed);
    const rng = (id, out, v, fmt) => { const e = $(id), o = $(out); if (e) e.value = v; if (o) o.textContent = fmt(v); };
    rng('f-maxage', 'f-maxage-out', f.maxAge, v => v >= 1440 ? 'All-time' : npFmtAge(v));
    rng('f-minliq', 'f-minliq-out', f.minLiq, v => v > 0 ? npFmtUsd(v) : '$0');
    rng('f-minvol', 'f-minvol-out', f.minVol, v => v > 0 ? npFmtUsd(v) : '$0');
    rng('f-minhealth', 'f-minhealth-out', f.minHealth, v => String(v));
    rng('f-minholders', 'f-minholders-out', f.minHolders, v => String(v));
    rng('f-maxtop', 'f-maxtop-out', f.maxTopPct, v => v >= 100 ? 'any' : v + '%');
    if ($('f-price1h')) $('f-price1h').value = f.price1h;
    if ($('f-flow')) $('f-flow').value = f.flow;
    document.querySelectorAll('#np-filters input[data-hide]').forEach(cb => { cb.checked = !!f.hide[cb.dataset.hide]; });
  }

  /* ---------- saved views ---------- */
  function renderSaved() {
    const wrap = document.getElementById('np-saved'); if (!wrap) return;
    wrap.innerHTML = state.saved.map((v, i) => '<div class="np-savedview"><button class="np-sv-apply" type="button" data-sv="' + i + '">📁 ' + esc(v.name) + '</button><button class="np-sv-del" type="button" data-svdel="' + i + '" aria-label="Delete view ' + esc(v.name) + '">✕</button></div>').join('');
  }
  function saveCurrentView() {
    // inline name input (prompt() is avoided project-wide — blocked in some embedded browsers)
    const foot = document.querySelector('.np-filters-foot'); if (!foot) return;
    let form = foot.querySelector('.np-saveform');
    if (form) { const i = form.querySelector('input'); if (i) i.focus(); return; }
    form = document.createElement('div'); form.className = 'np-saveform';
    form.innerHTML = '<input type="text" class="np-saveinput addr-input" maxlength="24" placeholder="Name this view…" aria-label="Name this view">' +
      '<button class="btn btn-sm btn-primary" type="button" data-savego>Save</button>' +
      '<button class="btn btn-sm btn-ghost" type="button" data-savecancel aria-label="Cancel">✕</button>';
    foot.appendChild(form);
    const inp = form.querySelector('input'); inp.focus();
    const done = (ok) => {
      if (ok) {
        const name = (inp.value || '').trim();
        if (name) {
          state.saved.unshift({ name: name.slice(0, 24), sort: state.sort, filters: JSON.parse(JSON.stringify(state.filters)) });
          state.saved = state.saved.slice(0, 6); persist(); renderSaved();
          if (window.sendToast) sendToast('View saved 📁');
        }
      }
      form.remove();
    };
    form.querySelector('[data-savego]').addEventListener('click', () => done(true));
    form.querySelector('[data-savecancel]').addEventListener('click', () => done(false));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } });
  }
  function applySaved(i) {
    const v = state.saved[i]; if (!v) return;
    if (v.sort) state.sort = v.sort;
    state.filters = Object.assign(defaultFilters(), JSON.parse(JSON.stringify(v.filters)));
    const sortSel = document.getElementById('np-sort'); if (sortSel) sortSel.value = state.sort;
    syncControls(); persist(); applyView(); render(); updateChips(); updateFcount(); announce(state.view.length + ' pairs shown');
  }
  function deleteSaved(i) { state.saved.splice(i, 1); persist(); renderSaved(); }

  /* ---------- wiring ---------- */
  let qTimer = null;
  function commit() { persist(); applyView(); render(); updateChips(); updateFcount(); announce(state.view.length + ' pairs shown'); }
  function wire() {
    const $ = id => document.getElementById(id);
    // safety segmented — scoped to .np-safety: the Best Runners time-window buttons share the .np-seg class, and an
    // unscoped selector let a click on "1W" wipe the Safer/All/Risky state (arrow keys are handled globally in app.js)
    document.querySelectorAll('.np-safety .np-seg').forEach(seg => seg.addEventListener('click', () => {
      document.querySelectorAll('.np-safety .np-seg').forEach(s => { s.classList.remove('is-on'); s.setAttribute('aria-checked', 'false'); });
      seg.classList.add('is-on'); seg.setAttribute('aria-checked', 'true');
      state.safety = seg.dataset.safety || 'safer'; applyView(); render(); announce(state.view.length + ' pairs shown');
    }));
    // sort
    const sortSel = $('np-sort'); sortSel.value = state.sort;
    sortSel.addEventListener('change', () => { state.sort = sortSel.value; persist(); applyView(); render(); });
    // density
    document.querySelectorAll('.np-den').forEach(d => d.addEventListener('click', () => {
      document.querySelectorAll('.np-den').forEach(x => { x.classList.remove('is-on'); x.setAttribute('aria-pressed', 'false'); });
      d.classList.add('is-on'); d.setAttribute('aria-pressed', 'true');
      state.density = d.dataset.density; applyDensity(); persist();
    }));
    if (state.density === 'compact') { const c = document.querySelector('.np-den[data-density="compact"]'); if (c) c.click(); }
    // search (with an always-available ✕ clear button that shows the moment there's text)
    const q = $('np-q'), qClear = $('np-q-clear');
    const syncClearBtn = () => { if (qClear) qClear.hidden = !q.value; };
    q.addEventListener('input', () => { syncClearBtn(); clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = q.value.trim(); onSearch(); }, 120); });
    if (qClear) qClear.addEventListener('click', () => { clearTimeout(qTimer); q.value = ''; state.q = ''; syncClearBtn(); clearLookup(); applyView(); render(); announce(state.view.length + ' pairs shown'); q.focus(); });
    q.addEventListener('keydown', e => { if (e.key === 'Escape' && q.value) { e.preventDefault(); qClear && qClear.click(); } }); // Esc also clears
    syncClearBtn();
    // filters panel toggle
    const more = $('np-more'), filters = $('np-filters');
    more.addEventListener('click', () => { const open = filters.hidden; filters.hidden = !open; more.setAttribute('aria-expanded', String(open)); });
    // quote + code checkboxes (independent multi-select)
    const chk = (id, apply) => { const e = $(id); if (!e) return; e.addEventListener('change', () => { apply(e.checked); commit(); }); };
    chk('f-weth', v => state.filters.quote.weth = v);
    chk('f-usdg', v => state.filters.quote.usdg = v);
    chk('f-other', v => state.filters.quote.other = v);
    chk('f-verified', v => state.filters.verified = v);
    chk('f-indexed', v => state.filters.indexed = v);
    // ranges
    const range = (id, out, key, fmt) => {
      const e = $(id), o = $(out); if (!e) return;
      e.addEventListener('input', () => { state.filters[key] = Number(e.value); if (o) o.textContent = fmt(Number(e.value)); commit(); });
    };
    range('f-maxage', 'f-maxage-out', 'maxAge', v => v >= 1440 ? 'All-time' : npFmtAge(v));
    range('f-minliq', 'f-minliq-out', 'minLiq', v => v > 0 ? npFmtUsd(v) : '$0');
    range('f-minvol', 'f-minvol-out', 'minVol', v => v > 0 ? npFmtUsd(v) : '$0');
    range('f-minhealth', 'f-minhealth-out', 'minHealth', v => String(v));
    range('f-minholders', 'f-minholders-out', 'minHolders', v => String(v));
    range('f-maxtop', 'f-maxtop-out', 'maxTopPct', v => v >= 100 ? 'any' : v + '%');
    // selects
    if ($('f-price1h')) $('f-price1h').addEventListener('change', () => { state.filters.price1h = $('f-price1h').value; commit(); });
    if ($('f-flow')) $('f-flow').addEventListener('change', () => { state.filters.flow = $('f-flow').value; commit(); });
    // hide-risk toggles
    document.querySelectorAll('#np-filters input[data-hide]').forEach(cb => cb.addEventListener('change', () => { state.filters.hide[cb.dataset.hide] = cb.checked; commit(); }));
    // preset chips
    document.querySelectorAll('#np-presets .np-chip').forEach(c => c.addEventListener('click', () => applyPreset(c.dataset.preset)));
    // saved views
    if ($('np-savenow')) $('np-savenow').addEventListener('click', saveCurrentView);
    const savedWrap = $('np-saved');
    if (savedWrap) savedWrap.addEventListener('click', e => {
      const del = e.target.closest('[data-svdel]'); if (del) { e.stopPropagation(); deleteSaved(Number(del.dataset.svdel)); return; }
      const sv = e.target.closest('[data-sv]'); if (sv) applySaved(Number(sv.dataset.sv));
    });
    // reset
    if ($('np-reset')) $('np-reset').addEventListener('click', resetFilters);
    // refresh
    $('np-refresh').addEventListener('click', () => { const btn = $('np-refresh'); if (!reduced()) btn.classList.add('spin'); fetchPairs(true).then(() => setTimeout(() => btn.classList.remove('spin'), 500)); });
    // staged new-pairs bar
    newbar.addEventListener('click', showStaged);
    // track open <details> (row cards AND inner detail groups) for persistence
    listEl.addEventListener('toggle', e => {
      const det = e.target; if (!det || det.tagName !== 'DETAILS') return;
      if (det.classList.contains('np-card')) {
        const li = det.closest('li[data-addr]'); if (!li) return;
        const addr = li.dataset.addr;
        if (det.open) { state.open.add(addr); const p = pairFor(addr); if (p) markViewed(p.token.address); if (p && !li.querySelector('.np-body')) { det.insertAdjacentHTML('beforeend', bodyHTML(p)); if (window.mountOnChainCharts) mountOnChainCharts(); animateRings(li); } }
        else state.open.delete(addr);
      } else if (det.classList.contains('np-detail-group') && det.dataset.group) {
        state.sections[det.dataset.group] = det.open; persist();
      }
    }, true);
    // delegated buttons inside the list (empty/error states)
    listEl.addEventListener('click', e => {
      const rc = e.target.closest('.np-row-call');
      if (rc) { e.preventDefault(); e.stopPropagation(); armCall(rc); return; }   // arm, then send on the second press
      if (callArmed) disarmCall();                                                // any other click in the list stands it down
      const w = e.target.closest('.np-watch');
      if (w) { e.preventDefault(); e.stopPropagation(); const p = pairFor(w.dataset.wpair); if (p && window.Watchlist) Watchlist.toggle(p); return; }
      const cl = e.target.closest('.np-call');
      if (cl) { e.preventDefault(); e.stopPropagation(); makeSendCall(cl); return; }
      const t = e.target.closest('button'); if (!t) return;
      if (t.id === 'np-retry') fetchPairs(true);
      else if (t.id === 'np-clearq') { $('np-q').value = ''; state.q = ''; const cb = $('np-q-clear'); if (cb) cb.hidden = true; clearLookup(); applyView(); render(); announce(state.view.length + ' pairs shown'); }
      else if (t.id === 'np-lookup-retry') { const addr = state.q.toLowerCase(); if (LOOKUP_RE.test(addr)) { const seq = ++lookupSeq; state.lookup = { addr, status: 'loading', p: null }; render(); fetchLookup(addr, seq); } }
      else if (t.id === 'np-showrisky') selectSafety('risky');
      else if (t.id === 'np-reset2') resetFilters();
    });
    statusEl.addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; if (t.id === 'np-showhidden') selectSafety('all'); else if (t.id === 'np-showhigh') selectSafety('risky'); });
    // freshness ticker + live poll (visible tab only)
    setInterval(() => { if (!state.lastFetch || document.hidden) return; if (state.mode === 'feed') updateFeedLive(); else updateStatus(); }, 1000); // live "updated Ns ago"
    setInterval(() => { if (!document.hidden) fetchPairs(false); }, 15000);                   // continuous live refresh (the server rebuilds this feed every 30s — polling faster only re-downloads identical bytes)
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - state.lastFetch > 60000) fetchPairs(false); });
    // lazy-load the honeypot/contract read the first time its score section is expanded (works in DEX list AND Hot Feed)
    document.addEventListener('toggle', e => {
      const d = e.target; if (!d || d.tagName !== 'DETAILS' || !d.open) return;
      const c = d.querySelector('.np-contract'); if (c && !c.dataset.loaded && c.closest('details') === d) loadContract(c);
    }, true);
    // 🎬 Hot Feed wiring
    document.querySelectorAll('.np-vs-btn').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    document.querySelectorAll('.np-runwin [data-win]').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.np-runwin [data-win]').forEach(x => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
      state.runWin = b.dataset.win; persist(); loadRunners();
    }));
    // arrow-key navigation + single tab stop for the composite widgets (radiogroup / tablist promise this model)
    // ←/→/↑/↓/Home/End on the time-window radiogroup + view tablist are handled by the shared delegated handler in app.js (local handlers double-fired)
    liveRunners();   // Best Runners now rides the shared LiveX clock (12s, in place) instead of a 60s re-render
    feedEl.addEventListener('click', e => {
      const w = e.target.closest('.np-watch');
      if (w) { e.preventDefault(); e.stopPropagation(); const p = state.byAddr.get(w.dataset.wpair); if (p && window.Watchlist) Watchlist.toggle(p); return; }
      const cl = e.target.closest('.np-call');
      if (cl) { e.preventDefault(); e.stopPropagation(); makeSendCall(cl); return; }
      const react = e.target.closest('.np-feed-react');
      if (react) {
        const c = react.querySelector('.np-rail-count');
        const n = Math.min(9, rocketCount(react.dataset.addr) + 1);   // capped: this is a fidget, not a score
        c.textContent = 'you \u00d7' + n;                              // never a bare integer — see rocketCount
        try { localStorage.setItem('np:rocket:' + react.dataset.addr, String(n)); } catch {}
        if (!reduced()) { react.classList.remove('pop'); void react.offsetWidth; react.classList.add('pop'); }
        if (window.sendToast) sendToast('Hyped \ud83d\ude80 — a private tap only you see. Still DYOR, not advice.'); return;
      }
      const exp = e.target.closest('.np-slide-expand');
      if (exp) { const d = exp.closest('.np-slide').querySelector('.np-slide-details'); if (d) d.open = !d.open; }
    });
    feedEl.addEventListener('toggle', e => {   // lazy full detail on first open
      const d = e.target; if (!(d.classList && d.classList.contains('np-slide-details')) || !d.open) return;
      if (d.querySelector('.np-body')) return;
      const slide = d.closest('.np-slide'); const p = slide && state.byAddr.get(slide.dataset.addr);
      if (p) { markViewed(p.token.address); d.insertAdjacentHTML('beforeend', bodyHTML(p)); if (window.mountOnChainCharts) mountOnChainCharts(); animateRings(d); }
    }, true);
    freshBtn.addEventListener('click', () => { const first = feedTrack.querySelector('.np-slide--new'); if (first) first.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); });
    document.getElementById('np-feed-up').addEventListener('click', () => flip(-1));
    document.getElementById('np-feed-down').addEventListener('click', () => flip(1));
    document.addEventListener('keydown', feedKeydown);
    // initial control sync
    syncControls(); renderSaved(); updateChips(); updateFcount();
  }
  function selectSafety(val) { const seg = document.querySelector('.np-seg[data-safety="' + val + '"]'); if (seg) seg.click(); }
  function resetFilters() {
    state.filters = defaultFilters(); state.q = '';
    const q = document.getElementById('np-q'); if (q) q.value = '';
    syncControls(); persist(); updateChips(); updateFcount();
    selectSafety('safer');   // triggers applyView + render
  }

  /* ============================ 🎬 HOT FEED (TikTok-style) ============================ */
  const healthOf = (p) => Math.round((p.risk && p.risk.health) || 0);
  // The ONE feed filter: a perfect score AND the 'ok' triage — i.e. exactly the pairs that carry the
  // 🚀 "Looks Good, Send It" verdict. Same test as verdictOf(), kept in one place so the two can never drift.
  const feedQualifies = (p) => !thinData(p) && triageOf(p) === 'ok' && healthOf(p) >= 100 && sniperOk(p);

  /* ---------- chains ----------
     Robinhood Chain is the home chain and the only one with a block explorer behind it, so it is
     the only one where holder counts, contract verification and deployer history exist. Other
     chains are market-data only; the risk model records the missing signals as unreadable, which
     is why a foreign-chain token can score 100 on what we CAN see and still never wear the top
     verdict. The note under the chain bar says this in the open. */
  let CHAIN = (function () { try { return localStorage.getItem('np:chain') || 'robinhood'; } catch { return 'robinhood'; } })();
  let CHAINS = [{ slug: 'robinhood', name: 'Robinhood Chain', emoji: '🏹', deep: true }];
  const chainBar = document.getElementById('np-chainbar');
  const chainNote = document.getElementById('np-chain-note');

  function renderChains() {
    if (!chainBar) return;
    // one chain on offer → no chooser at all, and no note about chains that are not there
    if (CHAINS.length < 2) { chainBar.hidden = true; chainBar.innerHTML = ''; if (chainNote) { chainNote.hidden = true; chainNote.textContent = ''; } return; }
    chainBar.hidden = false;
    chainBar.innerHTML = CHAINS.map(c =>
      '<button class="np-chain-btn' + (c.slug === CHAIN ? ' is-on' : '') + '" type="button" role="tab"' +
      ' aria-selected="' + (c.slug === CHAIN ? 'true' : 'false') + '" tabindex="' + (c.slug === CHAIN ? '0' : '-1') + '"' +
      ' data-chain="' + esc(c.slug) + '"><span aria-hidden="true">' + esc(c.emoji || '') + '</span> ' + esc(c.name) +
      (c.deep ? '' : '<i class="np-chain-lite" title="Market data only on this chain">lite</i>') + '</button>'
    ).join('');
  }
  if (chainBar) chainBar.addEventListener('click', (e) => {
    const b = e.target.closest('.np-chain-btn');
    if (!b || b.dataset.chain === CHAIN) return;
    CHAIN = b.dataset.chain;
    try { localStorage.setItem('np:chain', CHAIN); } catch {}
    state.all = []; state.byAddr = new Map(); state.started = false; state.feedAddrs = [];
    renderChains();
    if (window.announce) announce('Switched to ' + (CHAINS.find(c => c.slug === CHAIN) || {}).name + '. Loading.');
    fetchPairs(true);
  });
  const feedMove = (lbl, v) => v == null ? '' : '<span class="price-chip ' + (v >= 0 ? 'up' : 'down') + '">' + lbl + ' ' + (v >= 0 ? '▲' : '▼') + pctPlain(Math.abs(v)) + '</span>';
  /* The 🚀 tally is stored in THIS browser's localStorage and goes nowhere near the server — nobody else can
     ever see it. Rendered as a bare green integer beside the server-backed watchlist star it read as a social
     count, which is a number the site was inventing about other people's interest. It now renders as "you ×N"
     and shows nothing at all at zero, so it can never be mistaken for a crowd. */
  function rocketCount(addr) { try { return Number(localStorage.getItem('np:rocket:' + addr)) || 0; } catch { return 0; } }
  function rocketLabel(addr) { const n = rocketCount(addr); return n ? 'you \u00d7' + n : ''; }
  function srLine(p) {
    const T = verdictOf(p), health = healthOf(p);
    return esc(p.token.name) + ' ' + esc(p.token.symbol) + '. Verdict ' + T.word + ', health ' + health + ' of 100. Liquidity ' + npFmtUsd(p.market.liquidityUsd) + (p.priceChange.h1 != null ? ', ' + (p.priceChange.h1 >= 0 ? 'up ' : 'down ') + pctPlain(Math.abs(p.priceChange.h1)) + ' in the last hour' : '') + '.';
  }
  function seatRing(el) { el.querySelectorAll('.np-gauge-arc[data-fill]').forEach(a => { a.style.strokeDashoffset = 100 - Math.max(0, Math.min(100, Number(a.getAttribute('data-fill')) || 0)); }); }

  function introSlideHTML() {
    return '<article class="np-slide np-slide--intro" aria-roledescription="slide" aria-label="Intro"><div class="np-slide-inner">' +
      '<div class="np-slide-name">🎬 Hot Feed</div>' +
      '<p>Only the fresh tokens our automatic checks score a full <b>100/100</b> — the 🚀 <b>Looks Good, Send It</b> verdict — one at a time.</p>' +
      '<p class="np-slide-honest">⚠️ Fresh tokens are dangerous by default — most go to zero. These are heuristics from public on-chain data, not an audit and not advice. We never tell you to buy. Entertainment only. <b>Do your own research.</b></p>' +
      '<p class="np-slide-sub">Swipe up ▲ to start</p>' +
      '</div></article>';
  }
  function slideHTML(p, isNew) {
    const tri = triageOf(p), T = verdictOf(p), health = healthOf(p), h = p.holders, m = p.market, r = p.risk || {};
    const banner = p.brand && p.brand.header ? '<div class="np-slide-banner"><img class="np-logo-img" src="' + esc(p.brand.header) + '" alt="" loading="lazy" decoding="async"></div>' : '';
    return '<article class="np-slide' + (isNew ? ' np-slide--new' : '') + (isBranded(p) ? ' np-branded' : '') + '" data-addr="' + esc(p.pair.address) + '" data-level="' + tri + '" role="group" aria-roledescription="slide" aria-label="' + esc(p.token.name) + ' ' + esc(p.token.symbol) + '" style="' + tokVars(p) + '">' +
      banner +
      '<div class="np-slide-inner">' +
        '<span class="np-slide-newtag"' + (isNew ? '' : ' hidden') + '>🆕 just landed</span>' +
        '<header class="np-slide-top">' + logoHTML(p, 46) + '<div class="np-slide-idcol"><h2 class="np-slide-name">' + esc(p.token.name) + ' <span class="np-slide-sym">$' + esc(p.token.symbol) + '</span>' + tickerCopy(p.token.address) + '</h2>' +
          '<p class="np-slide-sub">🕐 ' + npFmtAge(p.pair.ageMinutes) + ' old · / ' + esc(p.pair.quoteSymbol) + ' · ' + (p.indexed ? 'indexed' : 'not indexed yet') + commSlot(p.token.address, p.token.symbol) + '</p>' + badgesHTML(p) + '</div></header>' +
        '<div class="np-slide-hero">' + gaugeHTML(p, tri, health) + '<div class="np-slide-verdict-wrap">' +
          '<span class="np-verdict np-slide-verdict ' + T.cls + '"><span class="np-verdict-ico" aria-hidden="true">' + T.ico + '</span><span class="np-verdict-word">' + T.word + '</span></span>' +
          '<span class="np-slide-health">Health ' + health + '/100</span></div></div>' +
        '<div class="np-slide-price"><span class="np-slide-priceval">' + npPrice(m.priceUsd) + '</span>' + chgChipHTML(p.priceChange.h1) + feedMove('6h', p.priceChange.h6) + feedMove('24h', p.priceChange.h24) + '</div>' +
        '<div class="np-slide-stats">' +
          '<div class="np-slide-mc"><i>Market cap</i><b>' + npFmtUsd(m.marketCap) + '</b></div>' +
          '<div><i>Liquidity</i><b class="' + (r.lowLiquidity ? 'red' : '') + '">' + npFmtUsd(m.liquidityUsd) + '</b></div>' +
          '<div><i>Volume 24h</i><b>' + npFmtUsd(p.volume.h24) + '</b></div>' +
          '<div><i>Holders</i><b class="' + (r.lowHolders ? 'red' : '') + '">' + (h.count != null ? npNum(h.count) : '—') + '</b></div>' +
          '<div><i>Top wallet</i><b class="' + (r.concentrated ? 'red' : '') + '">' + (h.topHolderPct != null ? pctPlain(h.topHolderPct) : '—') + '</b></div>' +
        '</div>' +
        socialsHTML(p) +
        flagstripHTML(p) +
        '<p class="np-slide-honest">Auto-flags are heuristics from public data — not a guarantee, not an audit, not advice. Most new tokens go to zero. We don\'t tell you to buy. Entertainment only.</p>' +
        '<div class="np-slide-cta"><button class="btn btn-primary np-call np-slide-call" type="button" data-call-token="' + esc(p.token.address) + '" data-call-sym="' + esc(p.token.symbol) + '">📣 Make a Send Call</button></div>' +
        '<details class="np-slide-details"><summary class="np-slide-more"><span class="np-slide-more-lbl">Full on-chain detail</span></summary></details>' +
        '<span class="sr-only">' + srLine(p) + ' Press Enter for full detail.</span>' +
      '</div>' +
      '<div class="np-slide-rail" aria-label="Actions">' +
        (window.Watchlist ? Watchlist.btnHTML(p, 'np-rail-btn') : '') +
        '<button class="np-rail-btn np-feed-react" type="button" data-addr="' + esc(p.pair.address) + '" aria-label="Hype this token — a private tap only you can see, not advice">🚀<span class="np-rail-count">' + rocketLabel(p.pair.address) + '</span></button>' +
        '<a class="np-rail-btn" href="' + esc(p.links.dex) + '" target="_blank" rel="noopener nofollow" aria-label="Open chart">📈</a>' +
        '<a class="np-rail-btn" href="' + esc(p.links.explorer) + '" target="_blank" rel="noopener nofollow" aria-label="Open explorer">🔍</a>' +
        '<button class="copy-btn np-rail-btn" type="button" data-copy="' + esc(p.token.address) + '" aria-label="Copy contract address">📋</button>' +
        '<button class="np-rail-btn np-slide-expand" type="button" aria-label="Show full detail">ℹ️</button>' +
      '</div>' +
    '</article>';
  }
  function renderFeedState() {
    if (npData.building || !state.started) { feedTrack.innerHTML = '<div class="np-feed-msg"><span class="np-live-dot"></span> Scanning the chain for hot pairs…</div>'; return; }
    if (npData.error) { feedTrack.innerHTML = '<div class="np-feed-msg">⚠️ Radar unreachable — retrying automatically…</div>'; return; }
    renderFeedEmpty();
  }
  function renderFeedEmpty() {
    state.feedAddrs = [];
    feedTrack.innerHTML = '<div class="np-feed-msg">🛡️ Nothing is scoring a full 100/100 right now.<br>The 🚀 Looks Good, Send It bar is deliberately hard to clear — check back soon, or switch to 📋 DEX List to see everything.</div>';
  }
  function buildFeed() {
    if (!feedTrack) return;
    if (!state.started || npData.building) { renderFeedState(); return; }
    let q = state.all.filter(feedQualifies).sort((a, b) => (b.pair.createdAt || 0) - (a.pair.createdAt || 0));
    if (!q.length) { renderFeedEmpty(); return; }
    if (q.length > 80) q = q.slice(0, 80);
    state.feedAddrs = q.map(p => p.pair.address);
    feedTrack.innerHTML = introSlideHTML() + q.map(p => slideHTML(p, false)).join('');
    feedTrack.querySelectorAll('.np-slide').forEach(seatRing);
    commDecorate(feedTrack);
    observeSlides();
    state.freshCount = 0; updateFreshPill(); updateFeedLive();
  }
  function patchFeed() {
    const slides = [...feedTrack.querySelectorAll('.np-slide[data-addr]')];
    const activeIdx = slides.findIndex(s => s.classList.contains('is-active'));
    slides.forEach((el, i) => {
      const p = state.byAddr.get(el.dataset.addr); if (!p) return;
      // a card that dropped off the 100/100 bar and sits BELOW the one you're viewing is pruned (jump-free); the
      // active card is never yanked — it degrades in place honestly until you flip past it.
      if (!feedQualifies(p) && i > activeIdx && !el.classList.contains('is-active')) {
        if (feedObserver) feedObserver.unobserve(el);
        const j = state.feedAddrs.indexOf(el.dataset.addr); if (j >= 0) state.feedAddrs.splice(j, 1);
        el.remove(); return;
      }
      patchFeedSlide(el, p);
    });
  }
  function patchFeedSlide(el, p) {
    const tri = triageOf(p), T = verdictOf(p), health = healthOf(p), h = p.holders, m = p.market, r = p.risk || {};
    el.dataset.level = tri;
    const gnum = el.querySelector('.np-gauge-num'); if (gnum) gnum.textContent = health;
    const arc = el.querySelector('.np-gauge-arc'); if (arc) { const prev = Number(arc.getAttribute('data-fill')); arc.setAttribute('data-fill', health); if (prev !== health) { if (el.classList.contains('is-active') && !reduced()) setArc(arc, health); else seatRing(el); } }
    const gauge = el.querySelector('.np-gauge'); if (gauge) gauge.className = 'np-gauge ' + (TRI[tri] ? TRI[tri].cls : 'np-t-caution');
    const vd = el.querySelector('.np-slide-verdict'); if (vd) { vd.className = 'np-verdict np-slide-verdict ' + T.cls; vd.innerHTML = '<span class="np-verdict-ico" aria-hidden="true">' + T.ico + '</span><span class="np-verdict-word">' + T.word + '</span>'; }
    const hp = el.querySelector('.np-slide-health'); if (hp) hp.textContent = 'Health ' + health + '/100';
    const priceRow = el.querySelector('.np-slide-price'); if (priceRow) priceRow.innerHTML = '<span class="np-slide-priceval">' + npPrice(m.priceUsd) + '</span>' + chgChipHTML(p.priceChange.h1) + feedMove('6h', p.priceChange.h6) + feedMove('24h', p.priceChange.h24);
    const stats = el.querySelectorAll('.np-slide-stats b');
    if (stats.length >= 4) {
      stats[0].textContent = npFmtUsd(m.liquidityUsd); stats[0].className = r.lowLiquidity ? 'red' : '';
      stats[1].textContent = npFmtUsd(p.volume.h24);
      stats[2].textContent = h.count != null ? npNum(h.count) : '—'; stats[2].className = r.lowHolders ? 'red' : '';
      stats[3].textContent = h.topHolderPct != null ? pctPlain(h.topHolderPct) : '—'; stats[3].className = r.concentrated ? 'red' : '';
    }
    const strip = el.querySelector('.np-flagstrip'); if (strip) strip.outerHTML = flagstripHTML(p);
  }
  function appendFreshSlides(newAddrs) {
    const add = newAddrs.filter(a => { const p = state.byAddr.get(a); return p && feedQualifies(p) && state.feedAddrs.indexOf(a) < 0; });
    if (!add.length) return;
    add.forEach(a => { const p = state.byAddr.get(a); feedTrack.insertAdjacentHTML('beforeend', slideHTML(p, true)); const el = feedTrack.lastElementChild; seatRing(el); if (feedObserver) feedObserver.observe(el); state.feedAddrs.push(a); });
    state.freshCount += add.length; updateFreshPill();
    announceFeed(add.length + ' fresh pair' + (add.length > 1 ? 's' : '') + ' added below');
  }
  function observeSlides() {
    if (feedObserver) feedObserver.disconnect();
    if (!('IntersectionObserver' in window)) return;
    feedObserver = new IntersectionObserver(ents => { ents.forEach(e => { if (e.isIntersecting && e.intersectionRatio >= 0.6) setActiveSlide(e.target); }); }, { root: feedEl, threshold: [0.6] });
    feedTrack.querySelectorAll('.np-slide').forEach(s => feedObserver.observe(s));
  }
  function setActiveSlide(el) {
    const cur = feedTrack.querySelector('.np-slide.is-active'); if (cur === el) return;
    if (cur) cur.classList.remove('is-active');
    el.classList.add('is-active');
    state.activeAddr = el.dataset.addr || null;
    if (!reduced()) el.querySelectorAll('.np-gauge-arc[data-fill]').forEach(a => setArc(a, Number(a.getAttribute('data-fill')) || 0));
    const tag = el.querySelector('.np-slide-newtag'); if (tag && !tag.hidden) { tag.hidden = true; if (state.freshCount > 0) { state.freshCount--; updateFreshPill(); } }
    const hint = document.getElementById('np-feed-hint'); if (hint) hint.remove();
    const p = el.dataset.addr && state.byAddr.get(el.dataset.addr);
    if (p) announceFeed(slideIndex(el) + ' of ' + tokenCount() + '. ' + srLine(p));
    updateFeedLive();
  }
  function announceFeed(msg) { if (feedSr) { feedSr.textContent = ''; setTimeout(() => { feedSr.textContent = msg; }, 30); } }
  const tokenCount = () => feedTrack.querySelectorAll('.np-slide[data-addr]').length;
  function slideIndex(el) { if (!el || !el.dataset.addr) return 0; return [...feedTrack.querySelectorAll('.np-slide[data-addr]')].indexOf(el) + 1; }
  const allSlides = () => [...feedTrack.querySelectorAll('.np-slide')];
  function activeIndex() { return allSlides().findIndex(s => s.classList.contains('is-active')); }
  function scrollToSlide(i) { const s = allSlides(); const t = Math.max(0, Math.min(s.length - 1, i)); if (s[t]) s[t].scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); }
  function flip(dir) { const cur = activeIndex(); scrollToSlide((cur < 0 ? 0 : cur) + dir); }
  function feedKeydown(e) {
    if (state.mode !== 'feed') return;
    const t = document.activeElement; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    switch (e.key) {
      case 'ArrowDown': case 'j': case 'J': case 'PageDown': e.preventDefault(); flip(1); break;
      case 'ArrowUp': case 'k': case 'K': case 'PageUp': e.preventDefault(); flip(-1); break;
      case 'Home': e.preventDefault(); scrollToSlide(0); break;
      case 'End': e.preventDefault(); scrollToSlide(1e6); break;
      case 'Enter': { const d = feedTrack.querySelector('.np-slide.is-active .np-slide-details'); if (d) { e.preventDefault(); d.open = !d.open; } break; }
      case 'Escape': { const d = feedTrack.querySelector('.np-slide.is-active .np-slide-details[open]'); if (d) { e.preventDefault(); d.open = false; } break; }
    }
  }
  function updateFeedLive() {
    if (!feedLive) return;
    const ago = state.lastFetch ? Math.max(0, Math.round((Date.now() - state.lastFetch) / 1000)) : null;
    const active = feedTrack.querySelector('.np-slide.is-active') || feedTrack.querySelector('.np-slide[data-addr]');
    const n = tokenCount(); const idx = Math.max(1, slideIndex(active));
    feedLive.innerHTML = '<span class="np-live-dot' + (npData.stale ? ' stale' : '') + '"></span> live' + (ago != null ? ' · ' + ago + 's' : '') + (n ? ' · ' + idx + '/' + n : '');
  }
  function updateFreshPill() {
    if (!freshBtn) return;
    if (state.freshCount > 0) { freshBtn.hidden = false; freshBtn.textContent = '🆕 ' + state.freshCount + ' fresh — flip down'; }
    else freshBtn.hidden = true;
  }
  // ===== Best Runners (📈) — top gainers over a trailing window =====
  const runList = document.getElementById('np-runners-list');
  const runStatus = document.getElementById('np-runners-status');
  // click anywhere on a runner (except the 📌 pin or the ↗ external chart) → the shared on-chain detail popup (same as
  // the DEX list / convicted-in chips). The token symbol is a real <button> so it's keyboard-accessible; this delegation
  // is the mouse-anywhere convenience. TokenModal is Esc/✕/backdrop-closable.
  if (runList) runList.addEventListener('click', (e) => {
    if (e.target.closest('[data-pin]') || e.target.closest('.np-runner-chart') || e.target.closest('.tok-comm')) return; // the 🏘️ community tag is a real link
    const row = e.target.closest('.np-runner'); if (!row || !row.dataset.token) return;
    if (!window.TokenModal) return;
    const sb = row.querySelector('.np-runner-sym'); if (sb) { try { sb.focus(); } catch (_) {} } // focus the trigger button before opening so the modal restores focus HERE on close (mouse + Safari, where a click doesn't focus a <button>)
    TokenModal.open(row.dataset.token, { symbol: row.dataset.sym, name: row.dataset.name });
  });
  const RUN_WIN_LABEL = { '24h': 'past 24 hours', week: 'past week', month: 'past month', year: 'past year', all: 'all time' };
  // compact multiple for the visible chip (no cap): 5→"5", 42→"42", 1200→"1.2K", 15000→"15K", 1.5e6→"1.5M"
  function fmtX(x) {
    // thresholds sit just below the rounding point so a carry promotes the tier (999999→"1M", not "1000K")
    if (x >= 9.995e5) { const m = x / 1e6; return (m >= 100 ? Math.round(m) : +m.toFixed(1)) + 'M'; }
    if (x >= 999.5) { const k = x / 1e3; return (k >= 100 ? Math.round(k) : +k.toFixed(1)) + 'K'; }
    return String(x < 10 ? +x.toFixed(1) : Math.round(x));
  }
  function fmtFullX(x) { return x >= 10 ? Math.round(x).toLocaleString('en-US') : (+x.toFixed(1)).toString(); } // exact, thousands-grouped (for the hover tooltip)
  // Send Call convention — each +100% = 1x, so a token at 4.4× its entry price reads "+3.40x". Identical maths and
  // wording to a call card (sendcall.js), because it answers the same question; only the entry differs — a call's
  // entry is the moment a person called it, this one is the moment OUR scanner first put a price on it.
  function callX(x) { const a = Math.abs(x), s = x >= 0 ? '+' : '−'; return s + (a < 10 ? a.toFixed(2) : a < 100 ? a.toFixed(1) : fmtX(a)) + 'x'; }
  // the tooltip figure must never be blunter than the chip it explains: 3 significant figures under 10x, so a
  // barely-moved token reads +0.0055x rather than rounding away to +0x
  function callXFull(x) { const a = Math.abs(x), s = x >= 0 ? '+' : '−'; return s + (a < 10 ? String(+a.toPrecision(3)) : fmtFullX(a)) + 'x'; }
  function runnerGain(gain) {
    if (gain >= 1) return '▲ ' + fmtX(gain) + 'x';
    if (gain >= 0) return '▲ +' + Math.round(gain * 100) + '%';
    return '▼ ' + Math.round(Math.abs(gain) * 100) + '%';
  }
  /* Every figure on a runner row, in one place — the row builder uses it once and the live tick reuses it
     to repaint just this span, so a number that moves on-chain never costs the reader their scroll
     position, their focus or an open detail. Nothing interactive lives in here, which is what makes
     repainting it wholesale safe. */
  function runnerMetricsHTML(r) {
    const note = !r.exact ? '<span class="np-runner-note" title="Tracked for ' + r.depthDays + ' days — shorter than this window, so it’s measured since we first saw it, not the full window.">since ' + r.depthDays + 'd</span>' : '';
    const health = r.health != null ? '<span class="np-runner-health" role="img" aria-label="Health score ' + r.health + ' of 100" title="Automated health score (heuristic, not an audit)">🩺 ' + r.health + '</span>' : '';
    // hover/SR detail: the EXACT (uncapped) current multiple + the all-time high — the visible chip stays abbreviated
    const curFull = r.gain >= 1 ? fmtFullX(r.gain) + '×' : (r.gain >= 0 ? '+' + Math.round(r.gain * 100) + '%' : '−' + Math.round(Math.abs(r.gain) * 100) + '%');
    // How many Xs it has done since the scanner caught it — the same live number a Send Call card shows, with our
    // own first recorded price standing in for the caller's entry. The peak since then rides in the tooltip (it
    // shares the same baseline as the number, so it can never read lower). Left out entirely when we never got a
    // price we trusted for it, rather than printing a multiple off a baseline we don't have.
    // It is also left out when it would only restate the gain already on the row: in the all-time view, and in any
    // window we have less history than, the window baseline IS our first sighting. Printing the one number twice at
    // two roundings ("▲ 12x" beside "+11.87x") reads as two different figures.
    const sameAsGain = r.sinceX != null && Math.abs(r.sinceX - r.gain) <= Math.abs(r.gain) * 1e-9;
    const gainDetail = esc((r.gain >= 0 ? 'Up ' : 'Down ') + curFull + ' — ' + RUN_WIN_LABEL[state.runWin] +
      (sameAsGain ? ', measured from the price our scanner first recorded for it' : ''));
    const caughtAge = r.caughtAt ? npFmtAge(Math.max(0, Math.round((Date.now() - r.caughtAt) / 60000))) : null;
    const sinceTip = (r.sinceX == null || sameAsGain) ? '' : esc((r.sinceX > 0 ? 'Up ' : r.sinceX < 0 ? 'Down ' : 'Flat at ') + callXFull(r.sinceX) +
      ' since our scanner first priced it' + (caughtAge ? ', ' + caughtAge + ' ago' : '') +
      ((r.ath != null && r.ath > r.sinceX) ? ' · peak since then ' + callXFull(r.ath) : '') +
      ' — where +100% = 1x, the same as a Send Call. That is our first sighting, not a call and not a recommendation.');
    const since = (r.sinceX == null || sameAsGain) ? '' : '<span class="np-runner-since ' + (r.sinceX > 0 ? 'up' : r.sinceX < 0 ? 'down' : 'flat') + '" role="img" aria-label="' + sinceTip + '" title="' + sinceTip + '">🔎 <b>' + callX(r.sinceX) + '</b> <i>since scanned</i></span>';
    return '<span class="np-runner-mc" role="img" aria-label="Market cap ' + npFmtUsd(r.mcap) + '" title="Current market cap">💰 ' + npFmtUsd(r.mcap) + '</span>' +
      '<span class="np-runner-gain ' + (r.gain >= 0 ? 'up' : 'down') + '" role="img" aria-label="' + gainDetail + '" title="' + gainDetail + '">' + runnerGain(r.gain) + '</span>' +
      since + health + note;
  }
  function runnerRow(r, i) {
    const logo = (r.brand && r.brand.imageUrl) ? '<img class="np-runner-logo-img" src="' + esc(r.brand.imageUrl) + '" alt="" loading="lazy" decoding="async">' : '<span class="np-runner-logo-none" aria-hidden="true">🪙</span>';
    const sym = r.symbol ? '$' + esc(r.symbol) : 'Token';
    const pin = '<button class="np-pin np-runner-pin" type="button" data-pin="' + esc(r.token) + '"' + (r.pair ? ' data-pair="' + esc(r.pair) + '"' : '') + ' data-sym="' + esc(r.symbol || '') + '" data-name="' + esc(r.name || '') + '"' + (r.brand && r.brand.imageUrl ? ' data-logo="' + esc(r.brand.imageUrl) + '"' : '') + ' aria-label="Convict ' + sym + ' — pin to your wall" title="Convict — pin to your wall">📌</button>';
    const chart = '<a class="np-runner-chart" href="https://dexscreener.com/robinhood/' + esc(r.pair || r.token) + '" target="_blank" rel="noopener nofollow" aria-label="Open ' + sym + ' chart in a new tab" title="Open chart ↗">📈</a>';
    const comm = commSlot(r.token, r.symbol); // 🏘️ Community / ＋ Start community (filled by tokentext.js)
    return '<li class="np-runner" data-token="' + esc(r.token) + '" data-sym="' + esc(r.symbol || '') + '" data-name="' + esc(r.name || '') + '">' +
      '<span class="np-runner-rank">' + (i + 1) + '</span>' +
      '<span class="np-runner-logo">' + logo + '</span>' +
      '<span class="np-runner-id"><button class="np-runner-sym" type="button" data-runner-view aria-label="View ' + sym + ' on-chain details">' + sym + '</button></span>' +
      // the 🏘️ community tag lives on the full-width name row (grid-column 1/-1), NOT in .np-runner-metrics: at ≥560px
      // metrics share grid cell 3 with the symbol, so a pill there would overlap a long ticker. Emit the row even with no name.
      ((r.name || comm) ? '<span class="np-runner-name"' + (r.name ? ' title="' + esc(r.name) + '"' : '') + '>' + esc(r.name || '') + comm + '</span>' : '') +
      '<span class="np-runner-metrics">' + runnerMetricsHTML(r) + '</span>' +
      '<span class="np-runner-actions">' + pin + chart + '</span>' +
    '</li>';
  }
  function renderRunners(data) {
    if (!runList || !runStatus) return;
    const rs = (data && data.runners) || [];
    if (!rs.length) {
      runList.innerHTML = '';
      const sinceMin = data && data.trackingSinceMs ? Math.round((Date.now() - data.trackingSinceMs) / 60000) : null;
      runStatus.innerHTML = state.runWin === '24h'
        ? '📈 No runners in the last 24h yet — new pairs need to move first. Check back soon.'
        : 'ℹ️ No qualifying runners for the ' + RUN_WIN_LABEL[state.runWin] + ' yet' + (sinceMin != null ? ' — price history has only been building for ' + npFmtAge(sinceMin) + ', so longer windows fill in over time.' : '.');
      return;
    }
    const approx = rs.some(r => !r.exact);
    runStatus.textContent = 'Top ' + rs.length + ' runners · ' + RUN_WIN_LABEL[state.runWin] + (approx ? ' · “since Nd” = tracked shorter than the window' : '');
    runList.innerHTML = rs.map(runnerRow).join('');
    commDecorate(runList);
  }
  async function loadRunners() {
    if (!runList || state.runnersLoading) return;
    state.runnersLoading = true;
    if (!runList.children.length && runStatus) runStatus.textContent = 'Loading best runners…';
    try { const j = await fetch('/api/runners?window=' + encodeURIComponent(state.runWin), { credentials: 'same-origin' }).then(r => r.json()); if (state.mode === 'runners') renderRunners(j); }
    catch { if (runStatus) runStatus.textContent = 'Couldn’t load runners — try again.'; }
    finally { state.runnersLoading = false; }
  }

  /* Best Runners on the shared LiveX clock. Two different things can change between reads and they are
     NOT handled the same way:
       · the figures move — repaint each row's metrics span in place. No reflow, nothing detaches, and
         the reader keeps their place in the list.
       · the ranking itself changes, or a token enters or drops out of the board — that needs a real
         re-render, because a row labelled "1" sitting above a bigger number is simply wrong. Held back
         while the token detail popup is open: re-rendering underneath it would detach the trigger the
         popup restores focus to when it closes.
     In practice the top rows sit orders of magnitude apart (343x, 178x, 112x) so a re-rank is rare, and
     the common tick is the quiet in-place one. */
  function paintRunnerMetrics(li, r) {
    const box = li.querySelector('.np-runner-metrics');
    if (!box) return;
    const was = { g: txtOf(box, '.np-runner-gain'), s: txtOf(box, '.np-runner-since b'), m: txtOf(box, '.np-runner-mc') };
    box.innerHTML = runnerMetricsHTML(r);
    if (!window.LiveX) return;
    ['.np-runner-gain', '.np-runner-since b', '.np-runner-mc'].forEach((sel, i) => {
      const el = box.querySelector(sel), prev = [was.g, was.s, was.m][i];
      if (el && prev != null && el.textContent !== prev) LiveX.pulse(el);   // pulse only what the chain actually moved
    });
  }
  function txtOf(root, sel) { const e = root.querySelector(sel); return e ? e.textContent : null; }
  function liveRunners() {
    if (!window.LiveX || !runList) return;
    LiveX.source('runners', {
      collect() { return (state.mode === 'runners' && runList.children.length) ? state.runWin : null; },
      async fetch(win) {
        const r = await fetch('/api/runners?window=' + encodeURIComponent(win), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('runners http ' + r.status);
        return r.json();
      },
      apply(j, win) {
        if (state.mode !== 'runners' || state.runWin !== win) return;   // the reader changed window mid-flight
        const rs = (j && j.runners) || [];
        const rows = [...runList.querySelectorAll('.np-runner')];
        const order = rows.map(li => String(li.dataset.token || '').toLowerCase());
        const fresh = rs.map(r => String(r.token).toLowerCase());
        const reorder = order.length !== fresh.length || order.some((t, i) => t !== fresh[i]);
        const tm = document.getElementById('token-modal');
        if (reorder && (!tm || tm.hasAttribute('hidden'))) { renderRunners(j); return; }
        const by = new Map(rs.map(r => [String(r.token).toLowerCase(), r]));
        rows.forEach(li => { const r = by.get(String(li.dataset.token || '').toLowerCase()); if (r) paintRunnerMetrics(li, r); });
      },
    });
  }

  function setMode(mode) {
    const m = (mode === 'list' || mode === 'feed' || mode === 'runners') ? mode : 'runners';
    state.mode = m; persist();
    document.body.classList.toggle('np-mode-feed', m === 'feed');
    document.body.classList.toggle('np-mode-list', m === 'list');
    document.body.classList.toggle('np-mode-runners', m === 'runners');
    [['np-vs-feed', 'feed'], ['np-vs-list', 'list'], ['np-vs-runners', 'runners']].forEach(([id, mm]) => { const b = document.getElementById(id); if (b) { b.setAttribute('aria-selected', String(m === mm)); b.tabIndex = m === mm ? 0 : -1; } }); // roving tabindex: one tab stop for the tablist
    const runEl = document.getElementById('np-runners');
    const teardownFeed = () => { feedEl.hidden = true; if (feedObserver) { feedObserver.disconnect(); feedObserver = null; } feedTrack.innerHTML = ''; state.feedAddrs = []; state.activeAddr = null; };
    if (m === 'feed') { clearLookup(); if (runEl) runEl.hidden = true; feedEl.hidden = false; buildFeed(); } // a lookup is a DEX-list view — leaving to the feed drops it
    else if (m === 'runners') { clearLookup(); teardownFeed(); if (runEl) runEl.hidden = false; loadRunners(); }
    else { teardownFeed(); if (runEl) runEl.hidden = true; applyView(); render(); }
  }

  // Expose the full token-detail renderer so the Send Wall / profiles can pop down the exact same New Pairs detail.
  window.NPCard = {
    detailHTML: (p, opts) => bodyHTML(p, (opts && opts.sections) || { why: true, chart: true, score: true, market: true, activity: false, holders: false, contract: false }, Object.assign({ hideCall: true }, opts)),
    animateRings,
  };

  if (!listEl) return;   // everything below is New-Pairs-page wiring (listeners, live polls) — skip it elsewhere
  render();          // list skeleton (hidden in feed mode; harmless)
  wire();
  document.querySelectorAll('.np-runwin [data-win]').forEach(x => { const on = x.dataset.win === state.runWin; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; }); // sync window selector to persisted choice
  setMode(state.mode);   // apply persisted mode (📈 Best Runners is the default)
  fetchPairs(false);
})();
