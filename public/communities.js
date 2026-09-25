/* ===== Communities grid page — square-box card per community, most-active first ===== */
(function () {
  'use strict';
  let loadedOnce = false;   // the 'Loading…' announcement is for the first paint, not the polite refresh
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmtUsd(n) { if (n == null || isNaN(n)) return '—'; const a = Math.abs(n); if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k'; if (a >= 1) return '$' + n.toFixed(2); if (a > 0) return '$' + n.toPrecision(2); return '$0'; }
  function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
  const fmtPct = (v) => (v == null ? '—' : (v >= 10 ? Math.round(v) : v >= 1 ? Number(v).toFixed(1) : Number(v).toPrecision(2)) + '%');
  function chgChip(v) { if (v == null || isNaN(v)) return '<span class="price-chip">—</span>'; const up = v >= 0; return '<span class="price-chip ' + (up ? 'up' : 'down') + '">' + (up ? '▲ +' : '▼ ') + Math.abs(v).toFixed(1) + '%</span>'; }

  const grid = document.getElementById('comm-grid');
  const statusEl = document.getElementById('comm-status');
  let state = { status: 'live', sort: 'active' };
  // the 🛡️ Send Squads tab swaps the whole community layer out for #squads-panel; these two are read by
  // load() so a community refresh that lands while squads are showing cannot un-hide the officials strip
  let squadsOn = false, hasOfficials = false;

  // Repaint a card grid without stealing focus or re-rendering identical markup: the 45s refresh must not
  // yank a keyboard user off the card they tabbed to. Focus is restored by href, the same way wkPaint does.
  // The last string set is remembered on the element because innerHTML reads back re-serialised, not verbatim.
  function paintGrid(el, html) {
    if (el._html === html) return;
    const active = document.activeElement;
    const keep = (active && el.contains(active)) ? active.getAttribute('href') : null;
    el._html = html;
    el.innerHTML = html;
    if (keep) {
      const back = el.querySelector('a[href="' + keep.replace(/["\\]/g, '\\$&') + '"]');
      if (back) { try { back.focus(); } catch {} }
    }
  }
  // the status line is a polite live region — only write it when the wording changes, or every refresh re-announces itself
  function setStatus(text, asHTML) {
    if (asHTML ? statusEl.innerHTML === text : statusEl.textContent === text) return;
    if (asHTML) statusEl.innerHTML = text; else statusEl.textContent = text;
  }

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
            '<span title="' + (c.holdersSource === 'chain' ? 'Holders — from the chain’s own transfer ledger' : 'Holders — from the block explorer') + '">🪙 <b>' + fmtNum(c.holders) + '</b><span class="sr-only"> holders</span></span>' +
            '<span title="' + (c.supply && c.supply.shown ? 'Share of the supply in members’ linked wallets (' + c.supply.members + ' members, from the chain’s ledger)' : 'Share of supply held by members — shown once ' + ((c.supply && c.supply.need) || 3) + ' members have linked a read-only wallet') + '">🔒 <b>' + (c.supply && c.supply.shown ? esc(fmtPct(c.supply.pct)) : '—') + '</b><span class="sr-only"> of supply held by members</span></span>' +
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
    if (!loadedOnce) setStatus('Loading communities…'); // the first paint only — a refresh, even of an empty list, says nothing
    loadedOnce = true;
    grid.setAttribute('aria-busy', 'true');
    try {
      const j = await window.api('/api/communities?status=' + state.status + '&sort=' + state.sort);
      // the official $Send / $GWC communities are pinned in their own strip on every tab; the main grid lists the rest
      const officials = (j && j.officials) || [];
      const offSec = document.getElementById('comm-officials'), offGrid = document.getElementById('comm-officials-grid');
      hasOfficials = !!officials.length;
      if (offSec && offGrid) { offSec.hidden = !hasOfficials || squadsOn; paintGrid(offGrid, officials.map(cardHTML).join('')); }
      const list = ((j && j.communities) || []).filter(c => !c.official);
      grid.removeAttribute('aria-busy');
      if (!list.length) {
        paintGrid(grid, '');
        setStatus(state.status === 'live'
          ? '🌱 No other live communities yet — <b>be the first to start one</b> above. It goes live at 10 members.'
          : '⏳ No communities are starting up right now. Paste a token address above to kick one off.', true);
        return;
      }
      paintGrid(grid, list.map(cardHTML).join(''));
      setStatus(list.length + ' ' + (state.status === 'live' ? 'live' : 'starting-up') + ' communit' + (list.length === 1 ? 'y' : 'ies') + ' · sorted by ' + ({ active: 'most active', members: 'members', mcap: 'market cap', new: 'newest' }[state.sort]));
    } catch (e) {
      grid.removeAttribute('aria-busy');
      setStatus('Couldn’t load communities — try again.');
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
  // Pasting the wrong contract should not mean selecting 42 characters by hand. The ✕ shows only when there
  // is something to clear, wipes the message and the invalid state with it, and puts the caret back in the
  // field so the next paste just works.
  const clearBtn = document.getElementById('comm-addr-clear');
  function paintClear() { if (clearBtn) clearBtn.hidden = !addr.value; }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      addr.value = '';
      addr.removeAttribute('aria-invalid');
      msg.textContent = '';
      paintClear();
      addr.focus();
    });
    addr.addEventListener('input', paintClear);
    paintClear();
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
    const token = addr.value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) { msg.textContent = '⚠️ Paste a valid 0x token contract address.'; addr.setAttribute('aria-invalid', 'true'); addr.focus(); return; }
    addr.removeAttribute('aria-invalid');
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

  /* ===== 🛡️ Send Squads — private groups behind the sign-in gate =====
     One request paints the whole tab: GET /api/squads answers the grid, the weekly board (this week's top 10 and
     last week's top 3), "my squads" and the server clock. Every /api/squads route answers 401 need_signin when
     signed out, so the tab is a locked panel until AUTH says there is a user — and locks again on sign-out.
     Every figure on a card is the API's own (already rounded server-side); a missing field prints '—', never a
     guess, and nothing here tells anyone to buy anything. */
  const sqPanel = document.getElementById('squads-panel');
  const sqOn = !!sqPanel;
  const sq = (id) => document.getElementById(id);
  const sqTab = document.querySelector('.comm-tab[data-cstatus="squads"]');
  const sqState = { q: '', gate: 'all', time: 'all', sort: 'active' };
  let sqLocked = true, sqAuthKnown = false, sqBusy = false, sqAt = 0, sqLoadedOnce = false, sqGen = 0, sqWeek = null, sqQTimer = 0;
  const signedIn = () => !!(window.AUTH && AUTH.user);
  /* "Start a Send Squad" pressed while signed out: remembered through the sign-in (a social login leaves the page,
     hence sessionStorage) and carried out the moment the account is known — for fifteen minutes, not forever. */
  const SQ_INTENT = 'jsi:sq-start', SQ_INTENT_MS = 15 * 60 * 1000;
  let pendingStart = null, openSquadStart = null;
  function storedStart() {
    try { const v = JSON.parse(sessionStorage.getItem(SQ_INTENT) || 'null'); return v && Date.now() - (v.at || 0) < SQ_INTENT_MS ? v : null; } catch { return null; }
  }
  // a live region is only written when its wording changes — the 60s refresh must not re-announce itself
  function sqSay(el, text, asHTML) { if (!el || el._said === text) return; el._said = text; if (asHTML) el.innerHTML = text; else el.textContent = text; }
  const sqPts = (v) => (v == null || isNaN(v) ? '—' : fmtNum(Math.max(0, Math.round(Number(v)))));

  // the gate cell: the API's own sentence ("Hold 1,000 $ABC", "Hold 2% of $GWC supply (≈ …)") or 🔓 Open — never composed here
  function sqGateCell(g) {
    if (!g || !g.kind) return '<span class="sq-gate" title="Gate">🔒 <b>—</b><span class="sr-only"> gate unknown</span></span>';
    if (g.kind === 'none') return '<span class="sq-gate" title="Anyone with an account can join">🔓 <b>Open</b><span class="sr-only"> to anyone with an account</span></span>';
    const t = g.text || '—';
    return '<span class="sq-gate" title="' + esc(t) + '">🔒 <b>' + esc(t) + '</b></span>';
  }
  // the same .comm-card frame as a community, so a squad reads as one of the family: banner, avatar (🛡️ when none),
  // name, a one-line bio, four metrics and the pill row. avatarHTML() only accepts the server's /uploads shape.
  function squadCardHTML(c) {
    const banner = c.banner ? '<span class="comm-card-banner" style="background-image:url(&quot;' + esc(c.banner) + '&quot;)"></span>' : '<span class="comm-card-banner comm-card-banner-none sq-card-banner-none"></span>';
    const ava = (c.avatar && window.avatarHTML) ? window.avatarHTML(c.avatar, 'comm-card-logo', 'loading="lazy"') : '';
    const logo = ava || '<span class="comm-card-logo comm-card-logo-none" aria-hidden="true">🛡️</span>';
    const g = c.gate || {}, open = g.kind === 'none', gated = g.kind === 'tokens' || g.kind === 'pct';
    const lvl = c.level != null ? c.level : (c.levelInfo && c.levelInfo.level != null ? c.levelInfo.level : null);
    const mine = (c.mine && c.mine.member) ? c.mine : null;
    const you = mine ? '<span class="sq-you' + (mine.verified ? '' : ' sq-you-off') + '" title="' + (mine.verified ? (mine.role === 'owner' ? 'You started this squad' : 'You are a verified member') : 'You are a member, but your linked wallets did not pass the gate at the last check') + '">' + (mine.verified ? (mine.role === 'owner' ? '👑 yours' : '✅ you’re in') : '⏸ unverified') + '</span>' : '';
    const pills = (c.official ? '<span class="comm-pill comm-pill-official" title="Run by the site itself">🏠 Official</span> ' : '') +
      (gated ? '<span class="comm-pill comm-pill-pending" title="' + esc(g.text || 'Token-gated') + '">🔒 Gated</span>'
        : open ? '<span class="comm-pill comm-pill-live" title="Anyone with an account can join">🔓 Open</span>' : '');
    const label = c.name + ' squad, ' + fmtNum(c.memberCount) + ' members, ' + (lvl == null ? 'level unknown' : 'level ' + lvl) + ', ' + sqPts(c.xpWeek) + ' points this week, '
      + (open ? 'open to anyone with an account' : (g.text || 'token-gated')) + (mine ? (mine.verified ? (mine.role === 'owner' ? ', you started it' : ', you’re in') : ', you’re a member awaiting verification') : '');
    return '<li class="comm-card sq-card' + (c.official ? ' comm-card-official' : '') + '">' +
      '<a class="comm-card-link" href="squad.html?id=' + encodeURIComponent(c.id) + '" aria-label="' + esc(label) + '">' +
        banner +
        '<span class="comm-card-body">' +
          '<span class="comm-card-head">' + logo + '<span class="comm-card-id"><b class="comm-card-sym sq-card-name">' + esc(c.name) + '</b><span class="comm-card-name">' + (c.bio ? esc(c.bio) : 'No bio yet') + '</span></span></span>' +
          '<span class="comm-card-metrics sq-card-metrics">' +
            '<span title="Members' + (c.verifiedCount != null ? ' (' + fmtNum(c.verifiedCount) + ' verified)' : '') + '">👥 <b>' + fmtNum(c.memberCount) + '</b><span class="sr-only"> members</span></span>' +
            '<span title="Squad level">🏅 <b>' + (lvl == null ? '—' : 'Lv ' + esc(lvl)) + '</b><span class="sr-only"> squad level</span></span>' +
            '<span title="Points earned this week">⚡ <b>' + sqPts(c.xpWeek) + '</b> <small>this week</small></span>' +
            sqGateCell(g) +
          '</span>' +
          '<span class="comm-card-foot">' + you + '<span class="sq-pills">' + pills + '</span></span>' +
        '</span>' +
      '</a>' +
    '</li>';
  }
  // weekly rows reuse the community board's .wk-* frame (weekly.css is on this page). There is no rank in the
  // payload — the server sends the board already ordered — so the rank is the row's position.
  function sqRowHTML(r, i, last) {
    const rank = i + 1, top = rank <= 3;
    const ava = (r.avatar && window.avatarHTML) ? window.avatarHTML(r.avatar, 'wk-logo', 'loading="lazy"') : '';
    const logo = ava || '<span class="wk-logo wk-logo-none" aria-hidden="true">🛡️</span>';
    // last week's rows: the week's total is xpLast if the server names it so, else xpWeek as sent; never a computed figure
    const pts = last ? (r.xpLast != null ? r.xpLast : r.xpWeek) : r.xpWeek;
    const medal = WK_MEDAL[rank] ? '<span class="wk-medal" aria-hidden="true">' + WK_MEDAL[rank] + '</span>' : '';
    const label = '#' + rank + ' ' + r.name + ' — ' + sqPts(pts) + ' points ' + (last ? 'last week' : 'this week') + (r.level != null ? ', squad level ' + r.level : '') + (r.memberCount != null ? ', ' + fmtNum(r.memberCount) + ' members' : '') + (r.official ? ', official' : '');
    return '<li class="wk-item' + (top ? ' wk-top wk-r' + rank : '') + '">' +
      '<a class="wk-link" href="squad.html?id=' + encodeURIComponent(r.id) + '" aria-label="' + esc(label) + '">' +
        '<span class="wk-rank">' + medal + '<span class="wk-rank-n">#' + rank + '</span></span>' +
        logo +
        '<span class="wk-id"><b class="wk-sym">' + esc(r.name) + '</b><span class="wk-name">👥 ' + fmtNum(r.memberCount) + ' members' + (r.official ? ' · 🏠 Official' : '') + '</span></span>' +
        '<span class="wk-score"><b class="wk-xp">' + sqPts(pts) + '</b><span class="wk-xp-l">' + (last ? 'pts last week' : 'pts this week') + '</span></span>' +
        '<span class="wk-meta"><span class="comm-pill comm-pill-live">🏅 Lv ' + (r.level == null ? '—' : esc(r.level)) + '</span></span>' +
      '</a>' +
    '</li>';
  }

  function sqWkHead() {
    const d = sq('sq-wk-dates'), c = sq('sq-wk-count');
    if (!d || !c) return;
    if (!sqWeek || !(sqWeek.startsAt > 0) || !(sqWeek.endsAt > 0)) { d.textContent = ''; c.textContent = ''; return; }
    d.textContent = wkDate(sqWeek.startsAt) + ' – ' + wkDate(sqWeek.endsAt - 1) + ' (UTC)';
    c.textContent = wkCountdown(sqWeek.endsAt);
  }
  function paintSquadWeekly(w) {
    const board = sq('sq-wk-board'), empty = sq('sq-wk-empty'), lastWrap = sq('sq-wk-last'), lastBoard = sq('sq-wk-last-board');
    if (!board || !empty || !lastWrap || !lastBoard) return;
    sqWeek = (w && w.week) || null;
    sqWkHead();
    const rows = (w && w.board) || [];
    if (!rows.length) { paintGrid(board, ''); board.hidden = true; empty.hidden = false; sqSay(sq('sq-wk-status'), 'Nothing on the squad board yet this week.'); }
    else {
      empty.hidden = true; paintGrid(board, rows.map((r, i) => sqRowHTML(r, i, false)).join('')); board.hidden = false;
      sqSay(sq('sq-wk-status'), rows.length + ' squad' + (rows.length === 1 ? '' : 's') + ' on the board so far, ranked by the points earned this week.');
    }
    const last = (w && w.last && w.last.board) || [];
    if (!last.length) { paintGrid(lastBoard, ''); lastWrap.hidden = true; }
    else { paintGrid(lastBoard, last.map((r, i) => sqRowHTML(r, i, true)).join('')); lastWrap.hidden = false; }
  }
  function paintMine(list) {
    const sec = sq('sq-mine'), g = sq('sq-mine-grid');
    if (!sec || !g) return;
    list = list || [];
    if (!list.length) { paintGrid(g, ''); sec.hidden = true; return; }
    paintGrid(g, list.map(squadCardHTML).join(''));
    sec.hidden = false;
  }
  function paintSquadGrid(j) {
    const list = (j && j.squads) || [], gridEl = sq('sq-grid');
    if (!list.length) {
      paintGrid(gridEl, '');
      const filtered = !!(sqState.q || sqState.gate !== 'all' || sqState.time !== 'all');
      sqSay(sq('sq-status'), filtered
        ? '🔎 No squads match that search or filter — <b>clear it</b> to see them all.'
        : '🛡️ No Send Squads yet — <button class="linklike" type="button" data-sq-open-start data-tip="Opens the start-a-squad form at the top of this tab">start the first one</button>.', true);
      return;
    }
    paintGrid(gridEl, list.map(squadCardHTML).join(''));
    sqSay(sq('sq-status'), list.length + ' squad' + (list.length === 1 ? '' : 's') + (sqState.q ? ' matching “' + sqState.q + '”' : '') + ' · sorted by ' + ({ active: 'most active this week', level: 'level', members: 'members', new: 'newest' }[sqState.sort] || sqState.sort));
  }

  // force: a filter/search/auth change must not be dropped because the 60s refresh is in flight; a generation
  // counter drops the older response instead. Only the timer yields to a load already running.
  async function loadSquads(force) {
    if (!sqOn || !squadsOn || sqLocked) return;
    if (sqBusy && !force) return;
    sqBusy = true;
    const gen = ++sqGen, gridEl = sq('sq-grid');
    if (!sqLoadedOnce) sqSay(sq('sq-status'), 'Loading squads…');
    gridEl.setAttribute('aria-busy', 'true');
    try {
      const qs = new URLSearchParams({ q: sqState.q, sort: sqState.sort, gate: sqState.gate, time: sqState.time });
      const j = await window.api('/api/squads?' + qs.toString());
      if (gen !== sqGen) return;                                  // a newer filter is in flight; this page is stale
      sqLoadedOnce = true; sqAt = Date.now();
      if (j && Number(j.serverNow) > 0) wkOffset = Number(j.serverNow) - sqAt;   // same server clock as the community board
      paintSquadGrid(j);
      paintSquadWeekly(j && j.weekly);
      paintMine(j && j.mine);
    } catch (e) {
      if (gen !== sqGen) return;
      if (e && (e.status === 401 || e.code === 'need_signin')) { lockSquads(true); return; }   // the session lapsed: back behind the gate
      if (!gridEl.children.length) sqSay(sq('sq-status'), 'Couldn’t load squads — try again in a moment.');
    } finally {
      gridEl.removeAttribute('aria-busy');
      if (gen === sqGen) sqBusy = false;
    }
  }
  function sqReset() {
    sqLoadedOnce = false; sqGen++; sqBusy = false;
    paintGrid(sq('sq-grid'), ''); paintMine([]); sqSay(sq('sq-status'), '');
    paintSquadWeekly(null);
  }
  // the gate: signed out → the locked panel; signed in → the body, loaded once per unlock
  function lockSquads(locked) {
    if (!sqOn) return;
    const wait = sq('sq-auth-wait'); if (wait) wait.hidden = true;
    const changed = sqLocked !== locked;
    sqLocked = locked;
    sq('sq-locked').hidden = !locked;
    sq('sq-body').hidden = locked;
    if (locked) { if (changed) sqReset(); return; }
    if (changed || !sqLoadedOnce) loadSquads(true);
  }
  // swap the community layer for the squads panel (and back). The URL follows the tab so a reload or a shared
  // link lands on the same view; ?q= is left alone.
  function showSquads(on) {
    if (!sqOn) return;
    squadsOn = on;
    const offSec = document.getElementById('comm-officials'), wkSec = document.getElementById('wk'), sorts = document.querySelector('.comm-sorts');
    if (offSec) offSec.hidden = on || !hasOfficials;
    if (wkSec) wkSec.hidden = on;
    if (sorts) sorts.hidden = on;
    statusEl.hidden = on; grid.hidden = on;
    sqPanel.hidden = !on;
    try {
      const u = new URL(location.href);
      const had = u.searchParams.get('tab') === 'squads';
      if (on !== had) { if (on) u.searchParams.set('tab', 'squads'); else u.searchParams.delete('tab'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
    } catch {}
    if (!on) return;
    if (sqAuthKnown) lockSquads(!signedIn());
    else { const w = sq('sq-auth-wait'); if (w) w.hidden = false; }   // auth.js is still asking /api/me — neither panel yet
  }

  if (sqOn) {
    const sqSettle = () => {
      sqAuthKnown = true;
      if (squadsOn) lockSquads(!signedIn());
      const want = pendingStart || storedStart();
      if (want && signedIn() && openSquadStart) openSquadStart(want);   // the sign-in they did in order to start a squad
    };
    if (window.AUTH && AUTH.ready && typeof AUTH.ready.then === 'function') AUTH.ready.then(sqSettle, sqSettle); else sqSettle();
    document.addEventListener('auth:change', sqSettle);   // sign-in unlocks, sign-out locks and wipes what was on screen
    sq('sq-signin').addEventListener('click', () => { if (window.AUTH) AUTH.open(); });

    // search: a name, or a 0x address (the server matches it against the gate token)
    const qEl = sq('sq-q'), qClear = sq('sq-q-clear');
    const paintQClear = () => { qClear.hidden = !qEl.value; };
    function applyQ(now) {
      clearTimeout(sqQTimer);
      const run = () => { const v = qEl.value.trim(); if (v === sqState.q) return; sqState.q = v; loadSquads(true); };
      if (now) run(); else sqQTimer = setTimeout(run, 350);
    }
    qEl.addEventListener('input', () => { paintQClear(); applyQ(false); });
    sq('sq-search').addEventListener('submit', (e) => { e.preventDefault(); applyQ(true); });
    qClear.addEventListener('click', () => { qEl.value = ''; paintQClear(); applyQ(true); qEl.focus(); });
    paintQClear();

    // filters: three exclusive button groups, each reusing the sort pill
    for (const [attr, key] of [['sqgate', 'gate'], ['sqtime', 'time'], ['sqsort', 'sort']]) {
      const btns = [...sqPanel.querySelectorAll('[data-' + attr + ']')];
      btns.forEach(b => b.addEventListener('click', () => {
        btns.forEach(x => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
        sqState[key] = b.dataset[attr]; loadSquads(true);
      }));
    }

    // ---- start a squad ----
    const sf = sq('sq-start-form'), sfName = sq('sq-name'), sfBio = sq('sq-bio'), sfBioCount = sq('sq-bio-count'), sfMsg = sq('sq-start-msg'), sfGo = sq('sq-start-go');
    const sfGateFields = sq('sq-gate-fields'), sfToken = sq('sq-gate-token'), sfAmount = sq('sq-gate-amount'), sfAmountL = sq('sq-gate-amount-l');
    const SQ_NAME_RE = /^[\w .\-'$&!?]{3,40}$/;          // mirrors SQUAD_NAME_RE on the server (after trim)
    const SQ_IMG_MAX = 3.5 * 1024 * 1024, SQ_IMG_TYPES = /^image\/(jpeg|png|webp)$/;
    const media = { avatar: null, banner: null };       // data: URLs, read client-side; the server accepts ≤ 3.5 MB jpeg/png/webp
    const gateKind = () => { const r = sf.querySelector('input[name="sq-gate"]:checked'); return r ? r.value : 'none'; };
    function paintGate() {
      const k = gateKind();
      sfGateFields.hidden = k === 'none';
      sfAmountL.textContent = k === 'pct' ? 'Share of the total supply to hold (percent, 0.01 – 100)' : 'Tokens to hold (at least)';
      sfAmount.placeholder = k === 'pct' ? '1' : '1000';
      sfAmount.min = k === 'pct' ? '0.01' : '0';
      if (k === 'pct') sfAmount.max = '100'; else sfAmount.removeAttribute('max');
    }
    sf.querySelectorAll('input[name="sq-gate"]').forEach(r => r.addEventListener('change', paintGate));
    paintGate();
    const setBioCount = (n) => { sfBioCount.textContent = n + ' left'; sfBioCount.setAttribute('aria-hidden', n > 20 ? 'true' : 'false'); }; // announce to SRs only when low
    sfBio.addEventListener('input', () => setBioCount(280 - sfBio.value.length));

    function wireMedia(kind) {
      const input = sq('sq-' + kind), prev = sq('sq-' + kind + '-prev'), rm = sq('sq-' + kind + '-rm'), none = sq('sq-' + kind + '-none');
      const clear = () => { media[kind] = null; input.value = ''; prev.hidden = true; prev.removeAttribute('src'); rm.hidden = true; if (none) none.hidden = false; };
      input.addEventListener('change', () => {
        const f = input.files && input.files[0]; if (!f) return;
        if (!SQ_IMG_TYPES.test(f.type)) { sfMsg.textContent = '⚠️ The ' + kind + ' must be a jpeg, png or webp image.'; clear(); return; }
        if (f.size > SQ_IMG_MAX) { sfMsg.textContent = '⚠️ That ' + kind + ' is over 3.5 MB — pick a smaller file.'; clear(); return; }
        const rd = new FileReader();
        rd.onload = () => { media[kind] = String(rd.result || ''); prev.src = media[kind]; prev.hidden = false; rm.hidden = false; if (none) none.hidden = true; sfMsg.textContent = ''; };
        rd.onerror = () => { sfMsg.textContent = '⚠️ Could not read that file — try another.'; clear(); };
        rd.readAsDataURL(f);
      });
      rm.addEventListener('click', () => { clear(); try { input.focus(); } catch {} });
    }
    wireMedia('avatar'); wireMedia('banner');

    const disarm = () => { clearTimeout(sfGo._armT); if (sfGo._armed) { sfGo._armed = false; sfGo.textContent = sfGo.dataset.label || '🛡️ Start the squad'; sfGo.removeAttribute('aria-label'); } };
    sf.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!signedIn()) { if (window.AUTH) AUTH.open(); return; }
      const name = sfName.value.trim();
      if (!SQ_NAME_RE.test(name)) { sfMsg.textContent = '⚠️ The name needs 3–40 characters: letters, numbers, spaces and . - \' $ & ! ?'; sfName.setAttribute('aria-invalid', 'true'); sfName.focus(); disarm(); return; }
      sfName.removeAttribute('aria-invalid');
      const bio = sfBio.value.trim();
      if (bio.length > 280) { sfMsg.textContent = '⚠️ The bio is over 280 characters.'; sfBio.focus(); disarm(); return; }
      const kind = gateKind(), body = { name, gateKind: kind };
      if (bio) body.bio = bio;
      if (kind !== 'none') {
        const token = sfToken.value.trim();
        if (!/^0x[0-9a-fA-F]{40}$/.test(token)) { sfMsg.textContent = '⚠️ Paste a valid 0x token contract address for the gate.'; sfToken.setAttribute('aria-invalid', 'true'); sfToken.focus(); disarm(); return; }
        sfToken.removeAttribute('aria-invalid');
        const amt = Number(sfAmount.value);
        if (!(amt > 0)) { sfMsg.textContent = '⚠️ The amount to hold must be more than zero.'; sfAmount.setAttribute('aria-invalid', 'true'); sfAmount.focus(); disarm(); return; }
        if (kind === 'pct' && (amt < 0.01 || amt > 100)) { sfMsg.textContent = '⚠️ The share must be between 0.01% and 100% of the supply.'; sfAmount.setAttribute('aria-invalid', 'true'); sfAmount.focus(); disarm(); return; }
        sfAmount.removeAttribute('aria-invalid');
        body.gateToken = token.toLowerCase(); body.gateAmount = amt;
      }
      if (media.avatar) body.avatar = media.avatar;
      if (media.banner) body.banner = media.banner;
      // Creating a squad fixes its gate for good, so the button arms first — a second press within 4s sends it.
      if (!sfGo._armed) {
        sfGo._armed = true; sfGo.dataset.label = sfGo.textContent; sfGo.textContent = '⚠️ Tap again to create — the gate is final';
        sfGo.setAttribute('aria-label', 'Tap again to confirm creating this squad; its gate can never be changed');
        if (window.announce) announce('Tap the button again to create the squad. Its gate can never be changed.');
        sfGo._armT = setTimeout(() => { if (sfGo.isConnected) disarm(); }, 4000);
        return;
      }
      disarm();
      sfGo.disabled = true; sfMsg.textContent = '🛡️ Creating your squad…';
      try {
        const j = await window.api('/api/squads', { method: 'POST', body });
        if (window.sendToast) sendToast('🛡️ Squad started — welcome in!');
        location.href = 'squad.html?id=' + encodeURIComponent(j.id);
        return;
      } catch (err) {
        sfGo.disabled = false;
        if (err && (err.status === 401 || err.code === 'need_signin')) { sfMsg.textContent = '🔒 Sign in first — squads are for members with an account.'; lockSquads(true); if (window.AUTH) AUTH.open(); return; }
        if (err && err.status === 409) { sfMsg.textContent = '⚠️ ' + ((err && err.message) || 'You already own a squad with that name — pick another.'); sfName.setAttribute('aria-invalid', 'true'); sfName.focus(); return; }
        if (err && err.needsProof) { sfMsg.textContent = '🪪 ' + ((err && err.message) || 'Finish the participation check, then try again.'); return; }   // auth.js already opened the proof step
        sfMsg.textContent = '⚠️ ' + ((err && err.message) || 'Could not start that squad — try again.');   // a 403 gate refusal lands here with what you hold vs what it takes
      }
    });

    /* ONE way into the start form, from anywhere on the page: the header button, the empty-grid prompt, a deep link
       (?tab=squads&new=squad[&gate=0x…]) or a token's community page. It switches to the squads tab, opens the form,
       carries a token address over as the gate, and puts the cursor in the name. Signed out, it asks for a sign-in
       first and picks up where it left off afterwards. */
    openSquadStart = (opts) => {
      opts = opts || {};
      if (sqTab && !squadsOn) pickTab(sqTab);
      if (!sqAuthKnown || !signedIn()) {
        pendingStart = { token: opts.token || '', at: Date.now() };
        try { sessionStorage.setItem(SQ_INTENT, JSON.stringify(pendingStart)); } catch {}
        if (sqAuthKnown && window.AUTH) AUTH.open();   // not known yet: sqSettle carries it out when auth.js answers
        return;
      }
      pendingStart = null; try { sessionStorage.removeItem(SQ_INTENT); } catch {}
      const d = sq('sq-start'); if (!d) return;
      d.open = true;
      const tok = String(opts.token || '').trim().toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(tok)) {
        const r = sq('sq-gate-tokens');
        if (r && gateKind() === 'none') { r.checked = true; paintGate(); }
        sfToken.value = tok;
        sfMsg.textContent = '✅ Gate token filled in — set how many to hold (or switch to a share of the supply), or choose 🔓 Open for no gate.';
      }
      d.scrollIntoView({ behavior: (window.prefersReduced && prefersReduced()) ? 'auto' : 'smooth', block: 'start' });
      setTimeout(() => { try { sfName.focus({ preventScroll: true }); } catch {} }, 350);
    };
    const heroSquad = document.getElementById('comm-squad-go');
    if (heroSquad) heroSquad.addEventListener('click', () => {
      const a = (addr && addr.value || '').trim();
      openSquadStart(/^0x[0-9a-fA-F]{40}$/.test(a) ? { token: a } : {});
    });
    sqPanel.addEventListener('click', (e) => { if (e.target.closest('[data-sq-open-start]')) { e.preventDefault(); openSquadStart({}); } });
    if (sqAuthKnown && signedIn() && (pendingStart || storedStart())) openSquadStart(pendingStart || storedStart());

    // coming back to a backgrounded tab: refresh if it's gone stale, otherwise just re-tick the countdown
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !squadsOn || sqLocked) return;
      if (Date.now() - sqAt > 20000) loadSquads(); else sqWkHead();
    });
    setInterval(() => { if (!document.hidden && squadsOn && !sqLocked) loadSquads(); }, 60000);
  }

  // tabs (live / pending / squads) + sort
  function pickTab(t) {
    document.querySelectorAll('.comm-tab').forEach(x => { x.classList.toggle('is-on', x === t); x.setAttribute('aria-pressed', String(x === t)); });
    const isSq = t.dataset.cstatus === 'squads';
    showSquads(isSq);
    if (isSq) return;                       // the community grid keeps its last state until the reader comes back
    state.status = t.dataset.cstatus; load();
  }
  document.querySelectorAll('.comm-tab').forEach(t => t.addEventListener('click', () => pickTab(t)));
  document.querySelectorAll('[data-csort]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-csort]').forEach(x => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    state.sort = b.dataset.csort; load();
  }));

  // arrived from a token's "＋ Start community" tag → prefill the address and put focus on the button
  try {
    const start = new URLSearchParams(location.search).get('start') || '';
    if (/^0x[0-9a-fA-F]{40}$/.test(start)) {
      addr.value = start.toLowerCase();
      msg.textContent = '✅ Address filled in from the token you came from — tap "Start a community" (you need to hold it), or "Start a Send Squad" for a private group gated by it.';
      form.scrollIntoView({ behavior: (window.prefersReduced && prefersReduced()) ? 'auto' : 'smooth', block: 'center' });
      setTimeout(() => { try { goBtn.focus(); } catch {} }, 300);
    }
  } catch {}
  // deep links into the squads tab: ?tab=squads opens it; ?q= prefills the squad search (and opens it — the
  // search lives only there). The community grid still loads underneath so switching back is instant.
  try {
    const p = new URLSearchParams(location.search);
    const q = (p.get('q') || '').trim().slice(0, 64);
    if (sqOn && q) { const qEl = sq('sq-q'); qEl.value = q; sqState.q = q; sq('sq-q-clear').hidden = false; }
    if (sqOn && sqTab && (p.get('tab') === 'squads' || q)) pickTab(sqTab);
    const gate = (p.get('gate') || '').trim();
    if (sqOn && openSquadStart && p.get('new') === 'squad') openSquadStart(/^0x[0-9a-fA-F]{40}$/.test(gate) ? { token: gate } : {});
    else if (sqOn && openSquadStart && storedStart()) openSquadStart(storedStart());
  } catch {}
  load();
  // one timer for the community layer: refreshes the grid AND the weekly board (+ its countdown), only while
  // visible and only while that layer is showing — the squads tab has its own 60s timer above
  setInterval(() => { if (!document.hidden && !squadsOn) { load(); loadWeekly(); } }, 45000); // keep stats + activity fresh
})();
