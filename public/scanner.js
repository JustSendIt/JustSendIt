/* ===== The Scanner page: two tabs over newpairs.html =========================================
 *   🔎 Scan an address — paste any token or pool on Robinhood Chain and read its full on-chain profile,
 *                        the same detail the site shows for every coin (NPCard.detailHTML, the chart, the
 *                        contract read, the community slot). Open to everyone.
 *   📡 New Pairs       — the live radar, for members. The panel shows a locked card until the reader is
 *                        signed in; the radar itself (newpairs.js) starts the first time the tab is open
 *                        for a member, and is parked while the other tab shows.
 *
 * URL: ?scan=0x… runs a scan on load and is kept in the address bar so a scan can be shared; ?tab=new
 * opens the radar tab. "Recent scans on this device" is localStorage, never sent; "Scanned by the
 * community" is the server's scan store (/api/scan/recent — the token, when, how many times; never who).
 * Every scan re-reads the chain and rewrites the stored snapshot; when the upstreams are down the server
 * answers with the last snapshot and says so (scan.stale + scan.readAt), and the page repeats it plainly.
 * CSP-safe: addEventListener only. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const tabScan = $('sc-tab-scan'), tabNew = $('sc-tab-new'), panScan = $('sc-scan'), panNew = $('sc-new');
  if (!tabScan || !tabNew || !panScan || !panNew) return;
  const form = $('sc-form'), input = $('sc-addr'), go = $('sc-go'), status = $('sc-status'), result = $('sc-result');
  const recentBox = $('sc-recent'), recentList = $('sc-recent-list'), locked = $('sc-locked'), radar = $('sc-radar'), lock = $('sc-lock');
  const ADDR = /^0x[0-9a-fA-F]{40}$/;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shortAddr = (a) => a.slice(0, 6) + '…' + a.slice(-4);
  const signedIn = () => !!(window.AUTH && AUTH.user);
  let clockOffset = 0;   // server clock − this browser's clock, from the last answer that carried `now`; a skewed device clock must not age a fresh read
  const ago = (t) => { const s = Math.max(0, (Date.now() + clockOffset - Number(t || 0)) / 1000); if (s < 5) return 'just now'; if (s < 60) return Math.round(s) + 's ago'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; };
  // a relative time that keeps counting: "read 3s ago" is repainted every 15 s, not left to go quietly false
  const agoEl = (t) => '<time class="sc-ago" data-t="' + Number(t || 0) + '" datetime="' + esc(new Date(Number(t || 0)).toISOString()) + '">' + esc(ago(t)) + '</time>';
  setInterval(() => { document.querySelectorAll('.sc-ago[data-t]').forEach((el) => { const v = ago(el.getAttribute('data-t')); if (el.textContent !== v) el.textContent = v; }); }, 15000);
  const clock = (t) => { try { return new Date(Number(t)).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
  let current = 'scan', seq = 0;

  /* ---------- tabs ---------- */
  function show(which, opts) {
    opts = opts || {};
    const toNew = which === 'new';
    current = toNew ? 'new' : 'scan';
    tabScan.classList.toggle('is-on', !toNew); tabNew.classList.toggle('is-on', toNew);
    tabScan.setAttribute('aria-selected', String(!toNew)); tabNew.setAttribute('aria-selected', String(toNew));
    tabScan.tabIndex = toNew ? -1 : 0; tabNew.tabIndex = toNew ? 0 : -1;
    panScan.hidden = toNew; panNew.hidden = !toNew;
    document.body.classList.toggle('sc-on-radar', toNew);
    if (toNew) gateRadar(); else if (window.NPRadar) NPRadar.suspend();
    try {
      const u = new URL(location.href);
      if (toNew) u.searchParams.set('tab', 'new'); else u.searchParams.delete('tab');
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    } catch {}
    if (!opts.quiet && window.announce) announce(toNew ? 'New Pairs tab.' : 'Scanner tab.');
  }
  tabScan.addEventListener('click', () => show('scan'));
  tabNew.addEventListener('click', () => show('new'));

  /* ---------- the members' door on the radar ---------- */
  function gateRadar() {
    const ok = signedIn();
    if (locked) locked.hidden = ok;
    if (radar) radar.hidden = !ok;
    if (lock) lock.hidden = ok;
    if (ok && current === 'new' && window.NPRadar) NPRadar.start();
  }
  const signin = $('sc-signin');
  if (signin) signin.addEventListener('click', () => { if (window.AUTH && AUTH.open) AUTH.open(); });
  document.addEventListener('auth:change', () => { if (lock) lock.hidden = signedIn(); if (current === 'new') gateRadar(); });
  if (lock) lock.hidden = signedIn();

  /* ---------- recent scans (this browser only) ---------- */
  const RECENT_KEY = 'sc:recent', RECENT_MAX = 6;
  const recent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter((r) => r && ADDR.test(r.addr || '')) : []; } catch { return []; } };
  function remember(addr, sym) {
    try {
      const list = [{ addr: addr.toLowerCase(), sym: String(sym || '').slice(0, 16) }].concat(recent().filter((r) => r.addr !== addr.toLowerCase())).slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {}
    paintRecent();
  }
  function paintRecent() {
    if (!recentBox || !recentList) return;
    const list = recent();
    recentBox.hidden = !list.length;
    recentList.innerHTML = list.map((r) => '<button class="np-chip" type="button" data-scan="' + esc(r.addr) + '" data-tip="Scans this address again">' + (r.sym ? '$' + esc(r.sym) : esc(shortAddr(r.addr))) + '</button>').join(' ');
  }
  paintRecent();

  /* ---------- scanned by the community (kept on the server: the token, the time, the count — never who) ---------- */
  const commBox = $('sc-community'), commList = $('sc-community-list');
  async function paintCommunity() {
    if (!commBox || !commList) return;
    try {
      const r = await fetch('/api/scan/recent', { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      const list = (r.ok && Array.isArray(j.scans)) ? j.scans.filter((x) => x && ADDR.test(x.token || '') && x.symbol) : [];
      commBox.hidden = !list.length;
      commList.innerHTML = list.map((x) => '<button class="np-chip" type="button" data-scan="' + esc(x.token) + '" data-tip="' + esc((x.name || x.symbol) + ' — scanned ' + x.count + (x.count === 1 ? ' time' : ' times') + ', last ' + ago(x.lastAt) + '; pulls up the latest read') + '">$' + esc(x.symbol) + '<span class="sc-chip-meta">' + (x.kind === 'pool' ? '🏊 ' : '') + esc(ago(x.lastAt)) + (x.count > 1 ? ' · ×' + Number(x.count) : '') + '</span></button>').join(' ');
    } catch { /* the strip is optional — a failed read leaves it hidden */ }
  }
  paintCommunity();

  /* ---------- a Send Call on what was just scanned ----------
     📣 to the public Send Wall — anyone sees it; a visitor is asked to sign in by the composer — and 🛡️ to a Send
     Squad, a button that only exists when the reader is a verified member of one (the most recently joined is chosen;
     the composer's picker lists every squad they can call to). Both open the same composer every page has, in call
     mode, with this token filled in and read. The token's full on-chain detail is on screen here, so the call is not
     flagged "made without DYOR" — for this token only. Everything a call needs (sign-in, the $SEND check, today's
     allowance, enough liquidity) is still asked by the composer and the server, exactly as for any other call. */
  // the reader's VERIFIED squads, whose they are, and when they were read — kept a minute: a gate re-check or a
  // join or leave in another tab changes them, and the Scanner is a page people keep open
  let mySquads = null, mySquadsFor = null, mySquadsAt = 0;
  async function verifiedSquads() {
    const uid = window.AUTH && AUTH.user && AUTH.user.username;   // the signed-in account (the client is not given its numeric id)
    if (!uid || !window.api) return [];
    if (mySquads && mySquadsFor === uid && Date.now() - mySquadsAt < 60e3) return mySquads;
    try {
      const j = await window.api('/api/squads/mine');
      mySquads = ((j && j.squads) || []).filter((q) => q && q.verified && q.id > 0);
      mySquadsFor = uid; mySquadsAt = Date.now();
    } catch { return []; }                           // could not tell: no squad button rather than a wrong one
    return mySquads;
  }
  const callRowHTML = (tok) =>
    '<p class="sc-hit-call" id="sc-call-row" data-tok="' + esc(tok) + '">' +
      '<button class="btn btn-primary btn-sm" type="button" data-sc-call="wall" data-tip="Opens a Send Call on this token for the public Send Wall — a permanent, live scorecard that starts at today’s price">📣 Send Call to the Wall</button>' +
    '</p>';
  async function paintSquadCall(tok) {
    const list = await verifiedSquads();
    const row = $('sc-call-row');
    if (!row || row.dataset.tok !== tok) return;     // a newer scan replaced it
    const old = row.querySelector('[data-sc-call="squad"]'); if (old) old.remove();
    if (!list.length) return;                         // not in a squad: there is no squad button
    const q = list[0], one = list.length === 1;
    row.insertAdjacentHTML('beforeend',
      '<button class="btn btn-ghost btn-sm" type="button" data-sc-call="squad" data-squad-id="' + Number(q.id) + '" data-squad-name="' + esc(q.name) + '" data-tip="' +
        (one ? 'Opens a Send Call on this token for ' + esc(q.name) + ' — private to the squad, and its points go to the squad'
             : 'Opens a Send Call on this token for one of your Send Squads — pick which one in the box; private to that squad, and its points go to it') + '">' +
        '🛡️ Send Call to ' + (one ? esc(q.name) : 'your Squad') + '</button>');
  }
  result.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sc-call]'); if (!b) return;
    const row = b.closest('#sc-call-row'); if (!row) return;
    if (!window.COMPOSE || !COMPOSE.openCall) { if (window.sendToast) sendToast('The Send Call box could not load on this page — reload and try again'); return; }
    const squad = b.dataset.scCall === 'squad';
    COMPOSE.openCall({
      token: row.dataset.tok,
      viewedDetail: !!result.querySelector('.np-detail-group, .np-contract'),   // only when the full detail really rendered
      squadId: squad ? Number(b.dataset.squadId) : 0, squadName: squad ? b.dataset.squadName : '',
    });
  });
  const repaintSquadCall = () => { mySquads = null; mySquadsFor = null; mySquadsAt = 0; const row = $('sc-call-row'); if (row) paintSquadCall(row.dataset.tok); };
  document.addEventListener('auth:change', repaintSquadCall);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && mySquadsAt && Date.now() - mySquadsAt > 60e3) repaintSquadCall(); });   // back from joining or leaving a squad in another tab

  /* ---------- the scan ---------- */
  function setStatus(text, kind) {
    if (!status) return;
    status.textContent = text || '';
    status.className = 'sc-status' + (kind ? ' is-' + kind : '');
  }
  async function scan(raw) {
    const addr = String(raw || '').trim();
    if (!ADDR.test(addr)) { setStatus('That is not an address. It starts with 0x and is 42 characters long.', 'err'); if (input) input.focus(); return; }
    const my = ++seq;
    if (input) { input.value = addr; input.dispatchEvent(new Event('input')); }   // shows the ✕ for a chip or deep-link scan too
    if (go) { go.disabled = true; go.setAttribute('aria-disabled', 'true'); }
    setStatus('Reading the chain for ' + shortAddr(addr) + '…', 'busy');
    result.innerHTML = '<p class="tm-loading"><span class="np-live-dot" aria-hidden="true"></span> Reading the chain for the latest on-chain detail…</p>';
    try { const u = new URL(location.href); u.searchParams.set('scan', addr.toLowerCase()); u.searchParams.delete('tab'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch {}
    try {
      const r = await fetch('/api/scan?address=' + encodeURIComponent(addr.toLowerCase()), { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (my !== seq) return;
      if (r.ok && j.pair) {
        const p = j.pair, tok = (p.token && p.token.address) || addr.toLowerCase();
        const sym = (p.token && p.token.symbol) || '';
        const sc = Object.assign({ readAt: Date.now(), stale: false, kept: false }, j.scan || {});
        if (typeof sc.now === 'number' && Math.abs(sc.now - Date.now()) > 2000) clockOffset = sc.now - Date.now(); else if (typeof sc.now === 'number') clockOffset = 0;
        // the holder figures are read on their own cadence (GoPlus caches them for minutes): say so when they are older than the scan
        const hAt = p.holders && p.holders.readAt;
        const holdersNote = (hAt && sc.readAt - hAt > 60000) ? '<span class="sc-hit-note">👥 Holder figures as of ' + agoEl(hAt) + ' — the price feed and the pool were read ' + agoEl(sc.readAt) + '.</span>' : '';
        if (window.tokenCommunityPrime && Object.prototype.hasOwnProperty.call(j, 'community')) tokenCommunityPrime(tok, j.community);
        const comm = window.tokenCommunitySlot ? tokenCommunitySlot(tok, sym, 'panel') : '';
        const head =
          '<div class="sc-hit">' +
            '<p class="sc-hit-k">' + (j.kind === 'pool' ? '🏊 Pool <code>' + esc(shortAddr(j.pool)) + '</code> ' + (j.poolVerified === true ? 'prices' : 'says it prices') : '🪙 Token') + '</p>' +
            '<h2 class="sc-hit-h">' + esc((p.token && p.token.name) || 'Token') + (sym ? ' <span class="hl">$' + esc(sym) + '</span>' : '') + '</h2>' +
            '<p class="sc-hit-a"><code>' + esc(tok) + '</code> · 🏹 Robinhood Chain · ' + (sc.stale ? 'last read ' : 'read ') + agoEl(sc.readAt) + '</p>' +
            callRowHTML(tok) +
            '<p class="sc-hit-s">🔁 ' + (!sc.kept ? 'This scan could not be kept just now — nothing was stored for others.'
                                          : (sc.count > 1 ? 'Scanned ' + Number(sc.count) + ' times by the community · first ' + agoEl(sc.firstAt) : 'First scan of this address on record — it is kept now, so it pulls up for everyone')) +
              holdersNote +
              (sc.stale ? '<span class="sc-stale">⏳ ' + (sc.busy ? 'Lots of scans are running right now' : 'The price feed and the chain could not be reached just now') + ' — this is the last snapshot, read ' + agoEl(sc.readAt) + ' (' + esc(clock(sc.readAt)) + '). Nothing on it is live. Scan again in a moment.</span>' : '') +
              // any contract can answer token0()/token1(); only the factory or the price feed can confirm it is really this token's pool
              (j.kind === 'pool' && j.poolVerified !== true ? '<span class="sc-stale">⚠️ This address answers like a pool of ' + (sym ? '$' + esc(sym) : 'this token') + ', but ' + (j.poolVerified === false ? 'neither the chain’s main factory nor the price feed knows it as one — treat the pool itself as unverified. ' : 'that could not be confirmed with the factory just now. ') + 'The profile below is the token’s, not this address’s.</span>' : '') +
            '</p>' +
          '</div>';
        const detail = window.NPCard ? NPCard.detailHTML(p, { sections: { why: true, chart: true, score: true, market: true, activity: true, holders: true, contract: true } }) : '<p class="tm-msg">Full detail isn’t available here.</p>';
        result.innerHTML = head + detail;
        const honest = result.querySelector('.np-honest');
        if (honest) honest.insertAdjacentHTML('beforebegin', comm); else result.insertAdjacentHTML('beforeend', comm);
        if (window.NPCard && NPCard.animateRings) NPCard.animateRings(result);
        if (window.mountOnChainCharts) mountOnChainCharts(result);
        if (window.decorateTokenCommunities) decorateTokenCommunities(result);
        // the contract section starts open here, so its lazy read is kicked off rather than waiting for a toggle
        const c = result.querySelector('.np-contract'); if (c && window.NPCard && NPCard.loadContract) NPCard.loadContract(c);
        setStatus(sc.stale ? 'Showing the last snapshot of ' + ((p.token && p.token.name) || shortAddr(tok)) + (sym ? ' $' + sym : '') + ' — read ' + ago(sc.readAt) + ', not live.' : 'Scanned ' + ((p.token && p.token.name) || shortAddr(tok)) + (sym ? ' $' + sym : '') + ' — read ' + ago(sc.readAt) + '.', sc.stale ? 'busy' : 'ok');
        remember(tok, sym);
        paintCommunity();
        paintSquadCall(tok);
        const h = result.querySelector('.sc-hit-h'); if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: false }); } catch {} }
      } else if (!r.ok || (j && j.unavailable)) {
        // "we could not check" is never dressed up as a fact about the address
        result.innerHTML = '';
        setStatus('⏳ ' + ((j && (j.message || j.error)) || 'We couldn’t check this address just now — nothing here is a judgement about it. Try again in a moment.'), 'err');
      } else if (j && j.notFound) {
        result.innerHTML = '';
        setStatus('🤷 ' + (j.message || 'No token or pool found at this address on Robinhood Chain.'), 'err');
      } else {
        result.innerHTML = '';
        setStatus('⏳ We couldn’t read this address just now. Try again in a moment.', 'err');
      }
    } catch {
      if (my !== seq) return;
      result.innerHTML = '';
      setStatus('⏳ Couldn’t reach the site just now — check your connection and try again.', 'err');
    } finally {
      if (my === seq && go) { go.disabled = false; go.removeAttribute('aria-disabled'); }
    }
  }
  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); scan(input && input.value); });
  /* ---------- clearing the box: the ✕ inside it, or Esc while typing in it ---------- */
  const clearBtn = $('sc-clear');
  const syncClear = () => { if (clearBtn) clearBtn.hidden = !(input && input.value); };
  function clearBox() {
    if (!input) return;
    input.value = '';
    syncClear();
    setStatus('', '');
    try { const u = new URL(location.href); u.searchParams.delete('scan'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); } catch {}
    input.focus();
  }
  if (input) {
    input.addEventListener('input', syncClear);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); clearBox(); } });
    syncClear();
  }
  if (clearBtn) clearBtn.addEventListener('click', clearBox);
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-scan]');
    if (!b || !panScan.contains(b)) return;
    show('scan', { quiet: true });
    scan(b.getAttribute('data-scan'));
  });
  // a pasted address scans straight away — nobody pastes one to look at it
  if (input) input.addEventListener('paste', () => { setTimeout(() => { if (ADDR.test(input.value.trim())) scan(input.value); }, 0); });

  /* ---------- deep links ---------- */
  const q = new URLSearchParams(location.search);
  const fromHash = /^#0x[0-9a-fA-F]{40}$/.test(location.hash) ? location.hash.slice(1) : '';
  const want = q.get('scan') || fromHash;
  if (q.get('tab') === 'new') show('new', { quiet: true }); else show('scan', { quiet: true });
  if (want && ADDR.test(want)) scan(want);
  // the sign-in state arrives after the page (AUTH.ready): re-run the gate once it is known
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(() => { if (lock) lock.hidden = signedIn(); if (current === 'new') gateRadar(); }).catch(() => {});
})();
