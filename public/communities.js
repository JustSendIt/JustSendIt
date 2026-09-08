/* ===== Communities grid page — square-box card per community, most-active first ===== */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmtUsd(n) { if (n == null || isNaN(n)) return '—'; const a = Math.abs(n); if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k'; if (a >= 1) return '$' + n.toFixed(2); if (a > 0) return '$' + n.toPrecision(2); return '$0'; }
  function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
  function chgChip(v) { if (v == null || isNaN(v)) return '<span class="price-chip">—</span>'; const up = v >= 0; return '<span class="price-chip ' + (up ? 'up' : 'down') + '">' + (up ? '▲ +' : '▼ ') + Math.abs(v).toFixed(1) + '%</span>'; }

  const grid = document.getElementById('comm-grid');
  const statusEl = document.getElementById('comm-status');
  let state = { status: 'live', sort: 'active' };

  function cardHTML(c) {
    const banner = c.banner ? '<span class="comm-card-banner" style="background-image:url(&quot;' + esc(c.banner) + '&quot;)"></span>' : '<span class="comm-card-banner comm-card-banner-none"></span>';
    const logo = c.image ? '<img class="comm-card-logo" src="' + esc(c.image) + '" alt="" loading="lazy" decoding="async">' : '<span class="comm-card-logo comm-card-logo-none" aria-hidden="true">' + (c.demo ? '📈' : '🪙') + '</span>';
    // the sandbox is branded for a listed company: its numbers are the stock's, labelled as such, never a token's
    const st = c.demo && c.stock ? c.stock : null, hasQ = !!(st && st.price != null);
    const tierClass = 'tier-' + String(c.activityTier || 'Dormant').toLowerCase();
    const statusPill = (c.demo ? '<span class="comm-pill comm-pill-sandbox" title="Open to everyone — no token, no wallet, and no multiplier">🧪 Sandbox · stock, not a token</span> ' : '') + (c.official ? '<span class="comm-pill comm-pill-official" title="Run by the site itself">🏠 Official</span> ' : '') + (c.status === 'live'
      ? '<span class="comm-pill comm-pill-live">🟢 LIVE · Lv ' + c.level + '</span>'
      : '<span class="comm-pill comm-pill-pending" role="progressbar" aria-valuenow="' + c.qualCount + '" aria-valuemin="0" aria-valuemax="' + c.need + '" aria-label="' + c.qualCount + ' of ' + c.need + ' to go live">⏳ ' + c.qualCount + '/' + c.need + ' to LIVE</span>');
    const goLiveBar = c.status === 'live' ? '' :
      '<span class="comm-golive" aria-hidden="true"><span class="comm-golive-fill" style="width:' + Math.min(100, Math.round(c.qualCount / c.need * 100)) + '%"></span></span>';
    return '<li class="comm-card ' + tierClass + (c.official ? ' comm-card-official' : '') + '">' +
      '<a class="comm-card-link" href="community.html?id=' + c.id + '" aria-label="' + esc(c.name) + ' $' + esc(c.symbol) + (c.demo
        ? ' sandbox community, ' + c.memberCount + ' members, stock ' + (hasQ ? '$' + Number(st.price).toFixed(2) + (st.changePct != null ? ', ' + (st.changePct >= 0 ? 'up ' : 'down ') + Math.abs(st.changePct).toFixed(2) + '% today' : '') : 'quote unavailable') + ', '
        : ' community, ' + c.memberCount + ' members, ' + fmtNum(c.holders) + ' holders, ' + fmtUsd(c.mcap) + ' market cap, ' + (c.priceChange != null ? (c.priceChange >= 0 ? 'up ' : 'down ') + Math.abs(c.priceChange).toFixed(1) + '% 24h, ' : '')) + (c.status === 'live' ? 'live level ' + c.level : c.qualCount + ' of ' + c.need + ' to go live') + '">' +
        banner +
        '<span class="comm-card-body">' +
          '<span class="comm-card-head">' + logo + '<span class="comm-card-id"><b class="comm-card-sym">$' + esc(c.symbol) + '</b><span class="comm-card-name">' + esc(c.name) + '</span></span></span>' +
          (c.demo
            ? '<span class="comm-card-metrics">' +
              '<span title="Members">👥 <b>' + fmtNum(c.memberCount) + '</b><span class="sr-only"> members</span></span>' +
              '<span title="Stock price (not a token)">📈 <b>' + (hasQ ? '$' + Number(st.price).toFixed(2) : '—') + '</b><span class="sr-only"> ' + esc(c.symbol) + ' stock price</span></span>' +
              '<span title="Listed on">🏦 <b>' + esc((st && st.exchange) || 'NASDAQ') + '</b><span class="sr-only"> listed stock, not a token</span></span>' +
              '<span title="Change today">' + (hasQ && st.changePct != null ? chgChip(st.changePct) : '<span class="price-chip">—</span>') + '<span class="sr-only"> change today</span></span>' +
            '</span>'
            : '<span class="comm-card-metrics">' +
            '<span title="Members">👥 <b>' + fmtNum(c.memberCount) + '</b><span class="sr-only"> members</span></span>' +
            '<span title="Holders">🪙 <b>' + fmtNum(c.holders) + '</b><span class="sr-only"> holders</span></span>' +
            '<span title="Market cap">💰 <b>' + fmtUsd(c.mcap) + '</b><span class="sr-only"> market cap</span></span>' +
            '<span title="Price change (24h)">' + chgChip(c.priceChange) + '<span class="sr-only"> price change, 24 hours</span></span>' +
          '</span>') +
          (c.demo ? '<span class="comm-card-stockline">' + (hasQ ? 'Stock · quote from ' + esc(st.source) + (st.asOfText ? ' · as of ' + esc(st.asOfText) : (st.asOf ? ' · as of ' + esc(new Date(st.asOf).toUTCString().slice(0, 22)) + ' UTC' : '')) + (st.stale ? ' · <b>stale</b>' : '') : (st && st.live === false ? 'Stock · the live quote is switched off' : 'Stock · quote unavailable right now')) + ' · not affiliated with Robinhood Markets, Inc.</span>' : '') +
          '<span class="comm-card-foot">' +
            '<span class="comm-pulse ' + tierClass + '" title="Community activity"><i></i> ' + esc(c.activityTier) + '</span>' +
            statusPill +
          '</span>' +
          goLiveBar +
        '</span>' +
      '</a>' +
    '</li>';
  }

  async function load() {
    statusEl.textContent = 'Loading communities…';
    grid.setAttribute('aria-busy', 'true');
    try {
      const j = await window.api('/api/communities?status=' + state.status + '&sort=' + state.sort);
      // the official $Send / $GWC communities are pinned in their own strip on every tab; the main grid lists the rest
      const officials = (j && j.officials) || [];
      const offSec = document.getElementById('comm-officials'), offGrid = document.getElementById('comm-officials-grid');
      if (offSec && offGrid) { offSec.hidden = !officials.length; offGrid.innerHTML = officials.map(cardHTML).join(''); }
      const list = ((j && j.communities) || []).filter(c => !c.official);
      grid.removeAttribute('aria-busy');
      if (!list.length) {
        grid.innerHTML = '';
        statusEl.innerHTML = state.status === 'live'
          ? '🌱 No other live communities yet — <b>be the first to start one</b> above. It goes live at 10 members.'
          : '⏳ No communities are starting up right now. Paste a token address above to kick one off.';
        return;
      }
      grid.innerHTML = list.map(cardHTML).join('');
      statusEl.textContent = list.length + ' ' + (state.status === 'live' ? 'live' : 'starting-up') + ' communit' + (list.length === 1 ? 'y' : 'ies') + ' · sorted by ' + ({ active: 'most active', members: 'members', mcap: 'market cap', new: 'newest' }[state.sort]);
    } catch (e) {
      grid.removeAttribute('aria-busy');
      statusEl.textContent = 'Couldn’t load communities — try again.';
    }
  }

  /* ===== 🏆 This week's competition — which community's members earned it the most points this week =====
     Pure activity: XP comes from members joining a community and posting/reacting/commenting inside it
     (daily-capped per member, so one busy account can't farm it).
     Market cap plays no part. The week runs Mon 00:00 UTC → Mon 00:00 UTC and resets itself server-side. */
  const wkBoard = document.getElementById('wk-board');
  const wkEmpty = document.getElementById('wk-empty');
  const wkStatusEl = document.getElementById('wk-status');
  const wkDatesEl = document.getElementById('wk-dates');
  const wkCountEl = document.getElementById('wk-count');
  const wkOn = !!(wkBoard && wkEmpty && wkStatusEl && wkDatesEl && wkCountEl);
  let wkWeek = null, wkAt = 0, wkStatusText = null, wkBusy = false, wkHTML = '';
  // the week boundaries come from the server; so does "now". A device whose clock is days off would otherwise
  // read the countdown as finished (or as a week long) — offset every comparison onto the server's clock.
  let wkOffset = 0;
  const wkNow = () => Date.now() + wkOffset;

  const WK_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WK_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // the week boundaries are UTC, so format them from UTC parts (never the viewer's timezone) → "Mon 31 Aug"
  function wkDate(ms) { const d = new Date(ms); return WK_DAY[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + WK_MON[d.getUTCMonth()]; }
  function wkCountdown(endsAt) {
    const ms = endsAt - wkNow();
    if (!(ms > 0)) return '⏳ resetting now';
    const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
    if (d > 0) return '⏳ resets in ' + d + 'd ' + h + 'h';
    if (h > 0) return '⏳ resets in ' + h + 'h ' + m + 'm';
    if (m > 0) return '⏳ resets in ' + m + 'm';
    return '⏳ resets in under a minute';
  }
  function wkHead() {
    if (!wkOn || !wkWeek) return;
    wkDatesEl.textContent = wkDate(wkWeek.startsAt) + ' – ' + wkDate(wkWeek.endsAt - 1) + ' (UTC)';
    wkCountEl.textContent = wkCountdown(wkWeek.endsAt);
  }
  // only write the live region when the wording actually changes — the 45s refresh must not re-announce itself
  function wkSay(t) { if (wkOn && t !== wkStatusText) { wkStatusText = t; wkStatusEl.textContent = t; } }

  const WK_MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
  function wkRowHTML(c) {
    const rank = Number(c.rank) || 0, top = rank >= 1 && rank <= 3;
    const xp = Math.max(0, Math.round(Number(c.xpWeek) || 0));
    // the tier slug lands in a class attribute, so keep it to letters (esc() wouldn't stop an attribute break-out)
    const tierClass = 'tier-' + (String(c.activityTier || 'Dormant').toLowerCase().replace(/[^a-z]/g, '') || 'dormant');
    const medal = WK_MEDAL[rank] ? '<span class="wk-medal" aria-hidden="true">' + WK_MEDAL[rank] + '</span>' : '';
    const logo = c.image ? '<img class="wk-logo" src="' + esc(c.image) + '" alt="" loading="lazy" decoding="async">'
                         : '<span class="wk-logo wk-logo-none" aria-hidden="true">' + (c.demo ? '📈' : '🪙') + '</span>'; // the sandbox is a stock, not a coin
    const you = c.joined ? '<span class="wk-you">✅ you’re in</span>' : '';
    const label = '#' + rank + ' ' + c.name + ' $' + c.symbol + (c.demo ? ' (sandbox — a listed stock, not a token; no multiplier)' : '') + ' — ' + fmtNum(xp) + ' points this week, community level '
      + c.level + ', activity ' + c.activityTier + (c.joined ? ', you’re a member' : '');
    return '<li class="wk-item' + (top ? ' wk-top wk-r' + rank : '') + '">' +
      '<a class="wk-link" href="community.html?id=' + encodeURIComponent(c.id) + '" aria-label="' + esc(label) + '">' +
        '<span class="wk-rank">' + medal + '<span class="wk-rank-n">#' + rank + '</span></span>' +
        logo +
        '<span class="wk-id">' +
          '<b class="wk-sym">$' + esc(c.symbol) + '</b>' +
          '<span class="wk-name">' + esc(c.name) + '</span>' + you +
        '</span>' +
        '<span class="wk-score"><b class="wk-xp">' + fmtNum(xp) + '</b><span class="wk-xp-l">pts this week</span></span>' +
        '<span class="wk-meta">' +
          '<span class="comm-pill comm-pill-live">🏆 Lv ' + esc(c.level) + '</span>' +
          '<span class="comm-pulse ' + tierClass + '"><i></i> ' + esc(c.activityTier) + '</span>' +
        '</span>' +
      '</a>' +
    '</li>';
  }

  // Repaint without stealing focus: the 45s refresh must not yank a keyboard user out of the row they tabbed to.
  // Identical markup is skipped outright (the common case); otherwise focus is restored to the same community row.
  function wkPaint(html) {
    if (html === wkHTML) return;
    const active = document.activeElement;
    const keep = (active && wkBoard.contains(active)) ? active.getAttribute('href') : null;
    wkHTML = html;
    wkBoard.innerHTML = html;
    if (keep) {
      const back = wkBoard.querySelector('a[href="' + keep.replace(/["\\]/g, '\\$&') + '"]');
      if (back) { try { back.focus(); } catch {} }
    }
  }

  async function loadWeekly() {
    if (!wkOn || wkBusy) return;          // the first paint and the auth:change that follows it are one load, not two
    wkBusy = true;
    wkBoard.setAttribute('aria-busy', 'true');
    try {
      const j = await window.api('/api/communities/weekly');
      wkAt = Date.now();
      if (j && Number(j.serverNow) > 0) wkOffset = Number(j.serverNow) - wkAt;
      wkWeek = (j && j.week) || null;
      wkHead();
      const board = (j && j.board) || [];
      wkBoard.removeAttribute('aria-busy');
      if (!board.length) {
        wkPaint(''); wkBoard.hidden = true; wkEmpty.hidden = false;
        // never leave a screen reader on "Loading…" for a board that loaded fine and is simply empty
        wkSay('Nothing on the board yet this week — no community has scored since the Monday reset.');
        return;
      }
      wkEmpty.hidden = true;
      wkPaint(board.map(wkRowHTML).join(''));
      wkBoard.hidden = false;
      wkSay(board.length + ' communit' + (board.length === 1 ? 'y' : 'ies') + ' on the board so far, ranked by the points their members earned this week.');
    } catch (e) {
      wkBoard.removeAttribute('aria-busy');
      // a failed refresh must never wipe a board that's already on screen, and must never sit next to the
      // empty-state paragraph — "no points scored yet" and "couldn't load" cannot both be true.
      if (!wkBoard.children.length) {
        wkEmpty.hidden = true;
        wkSay('Couldn’t load this week’s board just now — it’ll try again in a moment.');
      }
    } finally {
      wkBusy = false;
    }
  }

  if (wkOn) {
    wkSay('Loading this week’s board…');
    loadWeekly();
    document.addEventListener('auth:change', loadWeekly);      // "you're in" chips depend on who's signed in
    // coming back to a backgrounded tab: refresh if it's gone stale, otherwise just re-tick the countdown
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (Date.now() - wkAt > 20000) loadWeekly(); else wkHead();
    });
  }

  // start-a-community form
  const form = document.getElementById('comm-start'), addr = document.getElementById('comm-addr'), msg = document.getElementById('comm-start-msg'), goBtn = document.getElementById('comm-start-go');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
    const token = addr.value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) { msg.textContent = '⚠️ Paste a valid 0x token contract address.'; return; }
    goBtn.disabled = true; msg.textContent = '🔎 Reading the token on-chain…';
    try {
      const r = await fetch('/api/communities', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { if (window.sendToast) sendToast('🏛️ Community started! Get 10 members to go live 🚀'); location.href = 'community.html?id=' + j.id; return; }
      goBtn.disabled = false;
      if (j.existingId) msg.innerHTML = 'A community already exists for that token — <a href="community.html?id=' + j.existingId + '">open it →</a>';
      else msg.textContent = '⚠️ ' + (j.error || 'Could not start that community.');
    } catch (err) { goBtn.disabled = false; msg.textContent = '⚠️ Could not start that community — try again.'; }
  });

  // tabs (live / pending) + sort
  document.querySelectorAll('.comm-tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.comm-tab').forEach(x => { x.classList.toggle('is-on', x === t); x.setAttribute('aria-pressed', String(x === t)); });
    state.status = t.dataset.cstatus; load();
  }));
  document.querySelectorAll('[data-csort]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-csort]').forEach(x => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    state.sort = b.dataset.csort; load();
  }));

  // arrived from a token's "＋ Start community" tag → prefill the address and put focus on the button
  try {
    const start = new URLSearchParams(location.search).get('start') || '';
    if (/^0x[0-9a-fA-F]{40}$/.test(start)) {
      addr.value = start.toLowerCase();
      msg.textContent = '✅ Address filled in from the token you came from — tap "Start a community" (you need to hold it).';
      form.scrollIntoView({ behavior: (window.prefersReduced && prefersReduced()) ? 'auto' : 'smooth', block: 'center' });
      setTimeout(() => { try { goBtn.focus(); } catch {} }, 300);
    }
  } catch {}
  load();
  // one timer for the whole page: refreshes the grid AND the weekly board (+ its countdown), only while visible
  setInterval(() => { if (!document.hidden) { load(); loadWeekly(); } }, 45000); // keep stats + activity fresh
})();
