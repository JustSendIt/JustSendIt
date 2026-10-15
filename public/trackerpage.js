/* ===== trackerpage.js — the Wallet Tracker page =====
 * Left: your tracked wallets (add / rename / remove / select). Right: the selected wallet's on-chain report.
 * Report flow: server cache (instant) → live trackerReport() in the background → fresh render + cache write.
 * A first read is an hour or more on the public node (measured 2026-09-30: the node refuses every batch of log
 * windows, so the walk runs at ~1.7 windows a second): the progress block shows the step, the stage, the percent
 * and a per-stage ETA that never rises (and the place in line while queued); the read keeps going without the page
 * and is saved, so a later Refresh reads only the blocks after it, in seconds ("Rebuild from scratch" reads from
 * block 0 again).
 * Signed out, the address field still works: it opens sign-in and keeps the address (sessionStorage trk:pending).
 * ?wid=<tracked id> / ?lid=<linked id> (the notification's link) select that wallet.
 * Reuses tracker.js (trackerReport + renderTracker) and chain.js. CSP-safe: addEventListener only, esc() on every
 * user/third-party string that touches innerHTML. Read-only, honest: nothing here signs or moves anything. */
(function () {
  'use strict';
  const layout = document.getElementById('trk-layout'); if (!layout) return;
  const $ = (id) => document.getElementById(id);
  const signedOut = $('trk-signedout'), wlist = $('trk-wlist'), wstatus = $('trk-wstatus'), chips = $('trk-chips'), chipsRow = $('trk-chips-row');
  const addForm = $('trk-add'), addrIn = $('trk-addr'), labelIn = $('trk-label'), addBtn = $('trk-add-btn'), addrErr = $('trk-addr-err');
  const soForm = $('trk-so-form'), soAddr = $('trk-so-addr'), soErr = $('trk-so-err');
  const reportEl = $('trk-report'), banner = $('trk-banner'), progress = $('trk-progress'), refreshBtn = $('trk-refresh'), rebuildBtn = $('trk-rebuild'), selectedEl = $('trk-selected'), srEl = $('trk-sr'), noteEl = $('trk-note');
  const progLine = $('trk-prog-line'), progBar = $('trk-prog-bar'), progFill = $('trk-prog-fill'), progNote = $('trk-prog-note'), progLive = $('trk-prog-live');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shortAddr = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
  // an address on ONE line, shortened only as much as its box needs: …, then always its last 4 (.addr-fit in styles.css)
  const fitInner = (a) => '<span class="sr-only">' + esc(a) + '</span><span class="addr-head" aria-hidden="true">' + esc(String(a).slice(0, -4)) + '</span><span class="addr-tail" aria-hidden="true">' + esc(String(a).slice(-4)) + '</span>';
  const addrFit = (a) => '<code class="addr-fit" title="' + esc(a) + '">' + fitInner(a) + '</code>';
  const toast = (m) => { if (window.sendToast) sendToast(m); };
  const say = (m) => { if (window.announce) announce(m); else if (srEl) srEl.textContent = m; };
  const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
  const LS_KEY = 'trk:last';
  const PENDING_KEY = 'trk:pending';   // an address typed while signed out, tracked the moment the account is in
  const QUEUE_FULL_COPY = 'The chain reader has a long line right now — try again in a while.';

  const state = {
    wallets: [], limit: 10, base: 10, diamondLevel: 0, holdsGwc: false,
    trackedCount: null,   // watch-list size (your own linked wallets are free)
    comb: null,           // combined totals across your linked wallets
    combRunning: false,
    loaded: false,        // true once GET /api/wallets has answered for the current identity (boot() must not repaint before then)
    selected: null,       // lowercase address of the wallet whose report is shown
    runId: 0,             // bumps on every select/refresh so a slow, stale run can't paint over a newer one
    reports: {},          // addr → { report, updatedAt, source: 'cache'|'live', failed?, failedAt?, failedMsg? } (session memory)
    listen: {},           // addr → the progress handler of the report on screen for it (see relay)
    prog: {},             // addr → { stage, etaEnd, info, msg }: the structured progress of the read running for it
    rebuilding: {},       // addr → true while a "Rebuild from scratch" (fresh=2) read runs for it
    prefs: null,          // display prefs (mirrors AUTH.user.tracker_prefs)
    refreshing: null,     // address whose live read currently owns the UI (null when idle)
    inflight: {},         // addr → promise of a running trackerReport (dedupes reads per address)
    confirmT: null,       // pending two-tap remove { id, timer }
    rebuildT: null,       // pending two-tap rebuild timer
    deepLinkDone: false,  // ?wid= / ?lid= is honoured once, on the first list load
    tick: null,
  };

  /* ---- pure helpers (lifted by tests/trackerpage.mjs between these two markers: no closure, no DOM) ---- */
  // The server's stage strings → the words on the page. An unknown stage is shown as it came, capitalized.
  function stageWords(stage) {
    const s = String(stage || '').trim();
    let m;
    if (/^reading every token transfer/.test(s)) return 'Reading every token transfer this wallet ever made';
    if ((m = /^reading (\d+) tokens?\b/.exec(s))) return 'Reading ' + m[1] + ' token' + (m[1] === '1' ? '\'s balance' : 's\' balances');
    if ((m = /^dating (\d+) blocks?\b/.exec(s))) return 'Dating ' + m[1] + ' block' + (m[1] === '1' ? '' : 's');
    if (/^finding markets/.test(s)) return 'Finding markets';
    if ((m = /^reading (\d+) of its transactions?\b/.exec(s))) return 'Reading ' + m[1] + ' transaction' + (m[1] === '1' ? '\'s receipt' : 's\' receipts');
    if (/^waiting for a turn/.test(s)) return 'Waiting for a free reader';
    if (/^resuming/.test(s)) return 'Resuming from the saved transfers';
    if (/^reading the account/.test(s)) return 'Reading the account';
    if (/^starting/.test(s)) return 'Starting the read';   // tracker.js's own first word, before the server answers
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }
  // Milliseconds → words: whole minutes, "under a minute" below 60 s, hours past two hours of minutes.
  function etaWords(ms) {
    if (ms == null || !(ms >= 0)) return '';
    if (ms < 60000) return 'under a minute';
    const min = Math.round(ms / 60000);
    if (min < 120) return 'about ' + min + ' min';
    const h = Math.floor(min / 60), r = min % 60;
    return 'about ' + h + ' h' + (r ? ' ' + r + ' min' : '');
  }
  // An ETA that never rises: the end time kept for a stage is the earliest the server has ever predicted for it.
  // A poll with no estimate keeps the one it has (the countdown goes on); a new stage starts from null.
  function etaEndAt(prevEnd, now, eta) {
    if (eta == null || !(eta >= 0)) return prevEnd == null ? null : prevEnd;
    const end = now + eta;
    return prevEnd == null ? end : Math.min(prevEnd, end);
  }
  function ordinal(n) {
    n = Math.max(1, Math.floor(Number(n) || 1));
    const r = n % 100;
    if (r >= 11 && r <= 13) return n + 'th';
    return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  }
  // The page's own retry, worded by what the server said: why the read failed, and whether a checkpoint is there to go on from.
  function retryCopy(info) {
    const how = info && info.resumable ? 'it goes on from where it stopped' : info && info.saved === 'complete' ? 'it reads on from the saved history — only what is new' : 'it starts over';
    return (info && info.reason === 'timeout' ? 'The chain read timed out' : 'The chain node refused the read for too long') + ' — asking again in a minute (' + how + ')';
  }
  // The one visible line, from the 202's structured fields and the clamped time left in this stage.
  function progressLine(info, remainMs) {
    if (!info || typeof info !== 'object') return '';
    if (info.queueFull) return QUEUE_FULL_COPY;
    const stage = String(info.stage || '');
    if (stage === 'throttled') return retryCopy(info);
    if (/^waiting for a turn/.test(stage) || (info.ahead > 0 && !info.total)) {
      const ahead = Math.max(0, Math.floor(Number(info.ahead) || 0));
      const eta = etaWords(remainMs);
      return eta ? ordinal(ahead + 1) + ' in line · ' + eta : 'in line (' + ahead + ' ahead)';
    }
    const parts = [];
    const so = info.stageOf;
    if (so && so.n > 0 && so.of > 0) parts.push('Step ' + so.n + ' of ' + so.of);
    parts.push(stageWords(stage) || 'Reading the chain');
    if (info.total > 0) parts.push(Math.min(100, Math.floor(100 * (Number(info.done) || 0) / info.total)) + '%');
    // waiting out the node's refusals: said, and the step's countdown left out (it would have run down to nothing by now)
    if (info.throttled > 0) parts.push('the chain node is refusing reads — waiting it out' + (info.throttled >= 60000 ? ' (' + Math.floor(info.throttled / 60000) + ' min so far)' : ''));   // whole minutes passed, never rounded up
    const eta = info.throttled > 0 ? '' : etaWords(remainMs);
    if (eta) parts.push(eta + ' for this step');
    return parts.join(' · ');
  }
  // What the live region says: the step and the stage only — never the percent or the ETA.
  function progressSpoken(info) {
    if (!info || typeof info !== 'object') return '';
    if (info.queueFull) return QUEUE_FULL_COPY;
    const stage = String(info.stage || '');
    if (stage === 'throttled') return retryCopy(info);
    if (/^waiting for a turn/.test(stage)) return ordinal((Math.floor(Number(info.ahead) || 0)) + 1) + ' in line';
    const so = info.stageOf;
    return (so && so.n > 0 && so.of > 0 ? 'Step ' + so.n + ' of ' + so.of + ': ' : '') + (stageWords(stage) || 'Reading the chain') + (info.throttled > 0 ? ' — waiting for the chain node' : '');
  }
  // ?wid=<tracked_wallets.id> / ?lid=<identities.id> → the wallet in the list, or null when it is no longer there.
  function resolveDeepLink(wallets, params) {
    const wid = params.get('wid'), lid = params.get('lid');
    if (wid) { const w = wallets.find(x => x.id != null && String(x.id) === String(wid)); if (w) return w; }
    if (lid) { const w = wallets.find(x => x.lid != null && String(x.lid) === String(lid)); if (w) return w; }
    return null;
  }
  // #track=0x… (the menu search's "Track it as a wallet"): the address to fill in, lowercase — or null. A #fragment, so the
  // address never reaches a server log; it is only ever filled in, never tracked without a tap.
  function trackFromHash(h) { const m = /^#track=(0x[0-9a-fA-F]{40})$/.exec(String(h || '')); return m ? m[1].toLowerCase() : null; }
  /* ---- end pure helpers ---- */
  window.TRKPAGE = { stageWords, etaWords, etaEndAt, ordinal, retryCopy, progressLine, progressSpoken, resolveDeepLink, trackFromHash };
  let hashTrack = trackFromHash(location.hash);
  if (hashTrack) { try { history.replaceState(null, '', location.pathname + location.search); } catch {} }
  /* the address goes in the "Track a wallet" box (above the report on a phone, in the list's column on a wide screen) —
     and the note says what a tap does, or why it can't yet (the list is full: Track ➕ is off) */
  function fillTrack(h) {
    addrIn.value = h;
    setNote(addBtn.disabled
      ? 'The address from your search is in the Track a wallet box, but your list is full — remove a wallet to track it.'
      : 'The address from your search is in the Track a wallet box — tap Track ➕ to add it to your list.');
    try { addrIn.focus({ preventScroll: false }); } catch {}
  }
  // the menu search used on this very page: only the #fragment changes, so the page does not load again — act on it here
  window.addEventListener('hashchange', () => {
    const h = trackFromHash(location.hash); if (!h) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch {}
    if (!layout.hidden && state.loaded) { if (walletByAddr(h)) select(h, true); else fillTrack(h); }
    else if (!signedOut.hidden && soAddr) { soAddr.value = h; try { soAddr.focus(); } catch {} }
    else hashTrack = h;   // the list is still loading: it is used when it lands
  });

  /* ---------- helpers ---------- */
  function ago(ts) {
    const s = Math.max(0, Math.round((Date.now() - Number(ts)) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60); if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60); if (h < 48) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }
  const myWallets = () => ((window.AUTH && AUTH.user && AUTH.user.wallets) || []).map(a => String(a).toLowerCase());
  const isMine = (addr) => myWallets().includes(addr);
  const walletByAddr = (addr) => state.wallets.find(w => w.address === addr);
  const nameOf = (w) => w.label || shortAddr(w.address);
  function rememberSelected(addr) { try { if (addr) localStorage.setItem(LS_KEY, addr); else localStorage.removeItem(LS_KEY); } catch {} }
  function recallSelected() { try { return localStorage.getItem(LS_KEY) || null; } catch { return null; } }
  function stashPending(addr) { try { if (addr) sessionStorage.setItem(PENDING_KEY, addr); } catch {} }
  function takePending() { try { const v = sessionStorage.getItem(PENDING_KEY); if (v) sessionStorage.removeItem(PENDING_KEY); return v && ADDR_RE.test(v) ? v.toLowerCase() : null; } catch { return null; } }
  function setNote(msg) { if (!noteEl) return; noteEl.hidden = !msg; noteEl.textContent = msg || ''; }

  /* ---- the progress block: a visible line + bar, and a separate spoken line (step and stage only) ---- */
  let liveLast = { text: '', at: 0 };
  function speak(text, force) {
    if (!progLive) return;
    const t = Date.now();
    if (!text) { progLive.textContent = ''; liveLast = { text: '', at: 0 }; return; }
    if (force || text !== liveLast.text || t - liveLast.at > 20000) { liveLast = { text, at: t }; progLive.textContent = text; }
  }
  // a plain status ("Report updated.", "Checking for a saved report…"): shown, spoken once; empty hides the block
  function setProgress(text) {
    progress.hidden = !text;
    progLine.textContent = text || '';
    progBar.hidden = true; progNote.hidden = true;
    speak(text, true);
  }
  function paintProgress(addr) {
    const pg = state.prog[addr]; if (!pg) return;
    const w = walletByAddr(addr);
    progress.hidden = false;
    if (!pg.info) {   // a tracker.js that only sends words (or a stage with no 202 behind it, like "pricing")
      progLine.textContent = '⛓️ ' + (pg.msg || 'Reading the chain…');
      progBar.hidden = true; progNote.hidden = true;
      speak(String(pg.msg || '').replace(/…\s*\d+%$/, '…'));
      return;
    }
    const info = pg.info;
    const remain = pg.etaEnd != null ? Math.max(0, pg.etaEnd - Date.now()) : null;
    progLine.textContent = progressLine(info, remain);
    const pct = info.total > 0 && !info.queueFull ? Math.min(100, Math.floor(100 * (Number(info.done) || 0) / info.total)) : null;
    progBar.hidden = pct == null;
    if (pct != null) { progBar.setAttribute('aria-valuenow', String(pct)); progFill.style.width = pct + '%'; }
    // the "you can leave" note belongs to a first read (no completed saved history yet); an incremental refresh is short
    const lr = w && w.lastRead;
    progNote.hidden = !!info.queueFull || info.stage === 'throttled' || !!(lr && !lr.partial && !state.rebuilding[addr]);   // not during the page's own retry wait: there is no read to leave running
    speak(progressSpoken(info));
  }

  // display prefs persist exactly like the profile page: POST /api/profile { tracker_prefs } (renderTracker calls this on every toggle)
  window.saveTrackerPrefs = function (prefs) {
    state.prefs = { ...prefs };
    if (window.AUTH && AUTH.user) AUTH.user.tracker_prefs = state.prefs;
    if (window.api) api('/api/profile', { method: 'POST', body: { tracker_prefs: state.prefs } }).catch(() => {});
  };
  const currentPrefs = () => state.prefs || (window.AUTH && AUTH.user && AUTH.user.tracker_prefs) || {};

  /* ---------- capacity meter (copy mirrors profile.js / watchlist.js) ---------- */
  function updateCap() {
    const cap = $('trk-cap'); if (!cap) return;
    const used = (state.trackedCount != null) ? state.trackedCount : state.wallets.length, limit = state.limit || 10, full = used >= limit;
    cap.hidden = false;
    $('trk-cap-count').textContent = used + ' / ' + limit + ' tracked';
    const fill = $('trk-cap-fill');
    fill.style.width = Math.min(100, Math.round(used / limit * 100)) + '%';
    fill.classList.toggle('full', full);
    const tier = $('trk-cap-tier'), note = $('trk-cap-note');
    const fullHint = full ? '<b class="track-cap-full-hint">You\'re at your limit — remove a wallet to track another.</b><br>' : '';
    if (state.diamondLevel >= 1 && state.holdsGwc) {
      tier.textContent = '💎 Diamond Lv ' + state.diamondLevel;
      note.innerHTML = fullHint + 'Diamond-handing $GWC unlocked <b>' + limit + '</b> slots. Keep holding (never sell) to climb Diamond tiers — <b>+100 wallets per level</b>.';
    } else {
      tier.textContent = '';
      note.innerHTML = fullHint + 'Everyone tracks up to <b>' + (state.base || 10) + '</b> wallets. Hold <b>$GWC</b> and diamond-hand it to <b>Diamond Lv 1</b> → <b>100</b> wallets, then <b>+100 per Diamond level</b>. <a href="/swap">Get $GWC →</a>';
    }
    addBtn.disabled = full; // the visible .track-cap-full-hint above already says why (a disabled button can't be focused, so no title=)
  }

  /* ---------- wallet list ---------- */
  function walletHTML(w) {
    const sel = state.selected === w.address;
    const mine = isMine(w.address);
    return '<li class="trk-w' + (sel ? ' is-selected' : '') + '" data-wid="' + esc(w.id) + '" data-addr="' + esc(w.address) + '">' +
      '<button class="trk-w-main" type="button" data-tip="Shows the holdings and trade report for this wallet" data-select="' + esc(w.address) + '"' + (sel ? ' aria-current="true"' : '') + '>' +
        '<span class="trk-w-ico" aria-hidden="true">' + (mine ? '🔗' : '💼') + '</span>' +
        // the visible lines: the label (if any) with a one-word "linked" pill, then the address on one line, shortened to
        // fit; a reader hears the sr-only sentence instead (the label, "your linked wallet", the whole address)
        '<span class="trk-w-txt" aria-hidden="true">' +
          ((w.label || mine) ? '<span class="trk-w-top">' + (w.label ? '<span class="trk-w-label">' + esc(w.label) + '</span>' : '') + (mine ? '<span class="trk-w-badge">linked</span>' : '') + '</span>' : '') +
          '<span class="trk-w-addr">' + addrFit(w.address) + '</span>' +
        '</span>' +
        '<span class="sr-only">' + (sel ? 'Selected. ' : '') + 'Show report for ' + esc(nameOf(w)) + (mine ? ', your linked wallet, ' : ' ') + esc(w.address) + '</span>' +
      '</button>' +
      '<span class="trk-w-actions">' +
        '<button class="copy-btn trk-w-btn" type="button" data-tip="Copies this wallet address to your clipboard" data-copy="' + esc(w.address) + '" aria-label="Copy address of ' + esc(nameOf(w)) + '">📋</button>' +
        (w.id != null ? '<button class="copy-btn trk-w-btn" type="button" data-tip="Opens a box to change the private label you gave this wallet" data-rename="' + esc(w.id) + '" aria-label="Rename ' + esc(nameOf(w)) + '">✏️</button>' : '') +
        // Your own wallets can't be "untracked" — they're yours by signature. Unlinking lives in Profile → Security.
        (mine ? '' : '<button class="copy-btn trk-w-btn trk-w-rm" type="button" data-tip="Drops this wallet from your list — tap twice to confirm" data-remove="' + esc(w.id) + '" aria-label="Stop tracking ' + esc(nameOf(w)) + '">✕</button>') +
      '</span>' +
    '</li>';
  }
  function renderWallets() {
    clearConfirm();
    if (!state.wallets.length) {
      wlist.innerHTML = '<li class="np-msg trk-empty">💼 No wallets tracked yet. Paste any address below — or tap a quick-add chip — to see its holdings, trades and PNL. Private to you.</li>';
      wstatus.innerHTML = '';
    } else {
      wlist.innerHTML = state.wallets.map(walletHTML).join('');
      const nMine = state.wallets.filter(w => w.mine).length, nOther = state.wallets.length - nMine;
      wstatus.innerHTML = '<span class="np-live-dot" aria-hidden="true"></span> ' +
        (nMine ? '<b>' + nMine + '</b> of yours' + (nOther ? ' · ' : '') : '') +
        (nOther ? nOther + ' watched' : (nMine ? '' : '0 wallets'));
    }
    renderChips();
    updateCap();
    if (typeof paintCombinedSection === 'function') paintCombinedSection();
  }
  function renderChips() {
    const tracked = new Set(state.wallets.map(w => w.address));
    const mine = myWallets().filter(a => !tracked.has(a));
    const full = state.wallets.length >= (state.limit || 10);
    if (!mine.length || full) { chips.hidden = true; chipsRow.innerHTML = ''; return; }
    chips.hidden = false;
    chipsRow.innerHTML = mine.map(a => '<button class="react-btn trk-chip" type="button" data-tip="Adds your connected wallet to the list and opens its report" data-quick="' + esc(a) + '"><span><span aria-hidden="true">🔗</span> Track my connected wallet</span> ' + addrFit(a) + '</button>').join('');
  }
  function highlightSelected() {
    wlist.querySelectorAll('.trk-w').forEach(li => {
      const on = li.dataset.addr === state.selected;
      li.classList.toggle('is-selected', on);
      const b = li.querySelector('[data-select]');
      if (b) { if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }
    });
  }

  async function loadWallets() {
    state.loaded = false;
    wstatus.innerHTML = '<span class="np-live-dot" aria-hidden="true"></span> Loading your wallets…';
    try {
      const j = await api('/api/wallets');
      state.wallets = (j.wallets || []).map(w => ({ ...w, address: String(w.address).toLowerCase() }));
      // Linked wallets arrive merged in and never spend a slot, so the meter counts what the server counts.
      state.trackedCount = (j.trackedCount != null) ? j.trackedCount : state.wallets.filter(w => !w.mine).length;
      state.limit = j.limit || j.base || 10; state.base = j.base || 10;
      state.diamondLevel = j.diamondLevel || 0; state.holdsGwc = !!j.holdsGwc;
      state.loaded = true;
      renderWallets();
      // an address typed while signed out: tracked now (the add selects it); a refusal leaves it in the field with its reason
      const pending = takePending();
      if (pending) {
        if (walletByAddr(pending)) { select(pending, true); return; }
        addrIn.value = pending;
        setNote('Tracking the wallet you entered before signing in…');
        const ok = await addWallet(pending, '', true);
        setNote(ok ? '' : 'The wallet you entered before signing in could not be added — it is still in the form below.');
        if (ok) return;
      }
      // pick a wallet: the one a notification linked to (?wid= / ?lid=), else the remembered one if still tracked, else the first
      let pick = null;
      if (!state.deepLinkDone) {
        state.deepLinkDone = true;
        const params = new URLSearchParams(location.search);
        if (params.has('wid') || params.has('lid')) {
          const dl = resolveDeepLink(state.wallets, params);
          if (dl) pick = dl.address;
          else setNote('That wallet is no longer in your list — it was untracked or unlinked, so its report is gone with it.');
        }
      }
      // an address from the menu search: its report if it is already in the list, else filled in for a tap on Track ➕
      if (hashTrack) {
        const h = hashTrack; hashTrack = null;
        if (walletByAddr(h)) { if (!pick) pick = h; }
        else fillTrack(h);
      }
      if (!pick) { const want = recallSelected(); pick = (want && walletByAddr(want)) ? want : (state.wallets[0] ? state.wallets[0].address : null); }
      if (pick) select(pick, false); else showNoSelection();
    } catch (e) {
      if (/sign in/i.test(e.message || '')) { showSignedOut(); return; }
      wstatus.innerHTML = '⚠️ Couldn\'t load your wallets. <button type="button" data-tip="Asks for your saved wallet list again" data-retry-wallets>Retry</button>';
    }
  }

  /* ---------- add ---------- */
  function setAddrError(msg) {
    if (msg) { addrErr.textContent = msg; addrErr.hidden = false; addrIn.setAttribute('aria-invalid', 'true'); }
    else { addrErr.textContent = ''; addrErr.hidden = true; addrIn.removeAttribute('aria-invalid'); }
  }
  addrIn.addEventListener('input', () => { if (!addrErr.hidden) setAddrError(''); });
  async function addWallet(address, label, focusAfter) {
    address = String(address || '').trim();
    if (!ADDR_RE.test(address)) { setAddrError('That doesn\'t look like an address — it should start with 0x and be 42 characters long.'); addrIn.focus(); if (window.SFX) SFX.play('error'); return false; }
    address = address.toLowerCase();
    if (walletByAddr(address)) { setAddrError('You\'re already tracking that wallet — it\'s in your list.'); select(address, true); if (window.SFX) SFX.play('warn'); return false; }
    addBtn.disabled = true;
    try {
      const j = await api('/api/wallets', { method: 'POST', body: { address, label: String(label || '').slice(0, 40) } });
      const w = { ...j.wallet, address: String(j.wallet.address).toLowerCase() };
      state.wallets.push(w);
      addrIn.value = ''; labelIn.value = ''; setAddrError('');
      renderWallets();
      if (window.SFX) SFX.play('success');   // the server has it: tracked
      toast('💼 Now tracking ' + nameOf(w));
      if (window.showPoints && j.pointsEarned > 0) showPoints(j.pointsEarned);
      say('Now tracking ' + nameOf(w) + ' — ' + state.wallets.length + ' of ' + state.limit + ' wallets');
      select(w.address, false);
      if (focusAfter) { const b = wlist.querySelector('[data-select="' + w.address + '"]'); if (b) b.focus(); }
      return true;
    } catch (e) {
      const msg = e.message || 'Could not add that wallet';
      setAddrError(msg); toast('⚠️ ' + msg);
      return false;
    } finally { updateCap(); }
  }
  /* Signed out, the address field stays live: the submit opens sign-in and keeps the address (sessionStorage), so it
     is tracked the moment the account is in. Sign-in comes first because a wallet read spends the site's one chain budget. */
  function signInToTrack(address) {
    address = String(address || '').trim();
    if (address) stashPending(address.toLowerCase());
    if (window.AUTH && AUTH.open) AUTH.open();
  }
  function setSoError(msg) {
    if (!soErr) return;
    if (msg) { soErr.textContent = msg; soErr.hidden = false; soAddr.setAttribute('aria-invalid', 'true'); }
    else { soErr.textContent = ''; soErr.hidden = true; soAddr.removeAttribute('aria-invalid'); }
  }
  if (soForm) {
    soForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = soAddr.value.trim();
      if (v && !ADDR_RE.test(v)) { setSoError('That doesn\'t look like an address — it should start with 0x and be 42 characters long. Leave it empty to just sign in.'); soAddr.focus(); if (window.SFX) SFX.play('error'); return; }
      setSoError('');
      signInToTrack(v);
    });
    soAddr.addEventListener('input', () => { if (!soErr.hidden) setSoError(''); });
  }
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!(window.AUTH && AUTH.user)) { signInToTrack(ADDR_RE.test(addrIn.value.trim()) ? addrIn.value.trim() : ''); return; }
    addWallet(addrIn.value, labelIn.value, false);
  });
  chipsRow.addEventListener('click', (e) => {
    const b = e.target.closest('[data-quick]'); if (!b) return;
    b.disabled = true;
    addWallet(b.dataset.quick, 'My wallet', true).then(ok => { if (!ok && b.isConnected) b.disabled = false; });
  });

  /* ---------- rename (inline; Enter saves, Escape cancels) ---------- */
  function startRename(li) {
    const w = walletByAddr(li.dataset.addr); if (!w) return;
    if (li.querySelector('.trk-rename')) return;
    const main = li.querySelector('.trk-w-main'), actions = li.querySelector('.trk-w-actions');
    main.hidden = true; actions.hidden = true;
    const form = document.createElement('form');
    form.className = 'trk-rename';
    form.innerHTML = '<label class="sr-only" for="trk-rn-' + esc(w.id) + '">New label for ' + esc(nameOf(w)) + '</label>' +
      '<input class="addr-input trk-rename-in" id="trk-rn-' + esc(w.id) + '" maxlength="40" autocomplete="off" placeholder="label">' +
      '<span class="trk-rename-btns"><button class="btn btn-sm btn-primary" type="submit" data-tip="Stores the label you typed for this wallet">Save</button><button class="btn btn-sm btn-ghost" type="button" data-tip="Closes this box and keeps the old label" data-cancel>Cancel</button></span>' +
      '<span class="trk-rename-hint">Enter to save · Esc to cancel</span>';
    li.appendChild(form);
    const input = form.querySelector('input');
    input.value = w.label || '';
    input.focus(); input.select();
    if (window.SFX) SFX.play('open');   // the rename box
    let done = false;
    const finish = (focusBtn) => {
      if (done) return; done = true;
      form.remove(); main.hidden = false; actions.hidden = false;
      const b = li.querySelector(focusBtn); if (b) b.focus();
    };
    const cancel = () => { finish('[data-rename]'); say('Rename cancelled'); };
    const focusRename = () => { const b = wlist.querySelector('[data-wid="' + w.id + '"] [data-rename]'); if (b) b.focus(); };
    const save = async () => {
      const label = input.value.trim().slice(0, 40);
      if (label === (w.label || '')) { finish('[data-rename]'); return; }
      if (done) return; done = true;
      const old = w.label;
      w.label = label; // optimistic: the list re-renders (dropping this form) and focus lands on the new ✏️ button
      renderWallets(); updateSelectedLine(); focusRename();
      try { await api('/api/wallets/' + encodeURIComponent(w.id), { method: 'PATCH', body: { label } }); say('Renamed to ' + nameOf(w)); if (window.SFX) SFX.play('success'); }
      catch { w.label = old; renderWallets(); updateSelectedLine(); focusRename(); toast('⚠️ Could not rename — try again.'); }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    form.querySelector('[data-cancel]').addEventListener('click', cancel);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } });
  }

  /* ---------- remove (two-tap confirm, 4 s) ---------- */
  function clearConfirm() {
    if (!state.confirmT) return;
    clearTimeout(state.confirmT.timer);
    const b = wlist.querySelector('[data-remove="' + state.confirmT.id + '"]');
    if (b) { b.classList.remove('is-armed'); b.textContent = '✕'; b.setAttribute('aria-label', 'Stop tracking ' + (state.confirmT.name || 'this wallet')); }
    state.confirmT = null;
  }
  async function removeWallet(id) {
    const idx = state.wallets.findIndex(w => String(w.id) === String(id)); if (idx < 0) return;
    const removed = state.wallets[idx];
    const wasSelected = state.selected === removed.address;
    state.wallets = state.wallets.filter(w => String(w.id) !== String(id));
    delete state.reports[removed.address];
    renderWallets();
    toast('Stopped tracking 🫥');
    say('Stopped tracking ' + nameOf(removed) + ' — ' + state.wallets.length + ' of ' + state.limit + ' wallets');
    if (wasSelected) { state.runId++; const next = state.wallets[0]; if (next) select(next.address, false); else { state.selected = null; rememberSelected(null); showNoSelection(); setBusy(); } }
    // move focus somewhere safe: the select button of the wallet now in this slot (never another wallet's ✕ — a stray
    // Enter must not arm a removal the user never meant); after the last wallet, the add-address field
    const li = wlist.querySelectorAll('.trk-w')[Math.min(idx, state.wallets.length - 1)];
    const nb = li ? li.querySelector('.trk-w-main') : addrIn; if (nb) nb.focus();
    try { await api('/api/wallets/' + encodeURIComponent(id), { method: 'DELETE' }); if (window.SFX) SFX.play('remove'); }
    catch {
      // the server still holds the row → restore it so the meter never advertises a slot that isn't free
      if (!state.wallets.some(w => String(w.id) === String(id))) { state.wallets.splice(Math.min(idx, state.wallets.length), 0, removed); renderWallets(); }
      toast('⚠️ Could not stop tracking — it is still tracked. Try again.');
      say('Remove failed — ' + nameOf(removed) + ' is still tracked');
    }
  }
  wlist.addEventListener('click', (e) => {
    const sel = e.target.closest('[data-select]');
    if (sel) { select(sel.dataset.select, true); return; }
    const rn = e.target.closest('[data-rename]');
    if (rn) { clearConfirm(); startRename(rn.closest('li')); return; }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const id = rm.dataset.remove, w = state.wallets.find(x => String(x.id) === String(id));
      if (state.confirmT && state.confirmT.id === id) { clearConfirm(); removeWallet(id); return; }
      clearConfirm();
      rm.classList.add('is-armed'); rm.textContent = 'Sure?';
      rm.setAttribute('aria-label', 'Tap again to confirm: stop tracking ' + (w ? nameOf(w) : 'this wallet'));
      say('Tap again within 4 seconds to stop tracking ' + (w ? nameOf(w) : 'this wallet'));
      if (window.SFX) SFX.play('warn');   // armed: tap again to confirm
      state.confirmT = { id, name: w ? nameOf(w) : '', timer: setTimeout(clearConfirm, 4000) };
    }
  });
  wstatus.addEventListener('click', (e) => { if (e.target.closest('[data-retry-wallets]')) loadWallets(); });

  /* ---------- report zone ---------- */
  function skeletonHTML() {
    return '<div class="trk-skel" aria-hidden="true">' +
      '<div class="trk-skel-bar"></div>' +
      '<div class="trk-grid">' + '<div class="trk-skel-stat"></div>'.repeat(4) + '</div>' +
      '<div class="trk-grid">' + '<div class="trk-skel-stat"></div>'.repeat(4) + '</div>' +
      '<div class="trk-skel-h"></div>' + '<div class="trk-skel-row"></div>'.repeat(4) +
      '</div>';
  }
  function showNoSelection() {
    refreshBtn.hidden = true; rebuildBtn.hidden = true; selectedEl.hidden = true; banner.hidden = true; setProgress('');
    reportEl.innerHTML = '<p class="np-msg">👈 Track a wallet to see its report here.</p>';
  }
  /* What the server has saved for this wallet: `lastRead` is {updatedAt, readTo, partial, walking} once a history was stored,
     null when none is, and absent on a server that predates it (then nothing is claimed). */
  function lastReadWords(w) {
    if (!w || !('lastRead' in w)) return '';
    const lr = w.lastRead;
    if (!lr || !lr.updatedAt) return 'no saved history yet — the first read is the long one';
    // stale: the chain has moved too far past the checkpoint for the server to go on from it — said, not promised away
    if (lr.walking) return 'history part-read ' + ago(lr.updatedAt) + (lr.stale ? ' · the transfer walk stopped part-way, too far back to go on from — the next read starts over' : ' · the transfer walk stopped part-way — the next read goes on from there');
    return 'history read ' + ago(lr.updatedAt) + (lr.readTo != null ? ' · to block ' + Number(lr.readTo).toLocaleString('en-US') : '') + (lr.partial ? (lr.stale ? ' · partial, too far back to go on from — the next read starts over' : ' · partial') : '');
  }
  function updateSelectedLine() {
    const w = state.selected && walletByAddr(state.selected);
    if (!w) { selectedEl.hidden = true; return; }
    selectedEl.hidden = false;
    const read = lastReadWords(w);
    selectedEl.innerHTML = '<span class="trk-sel-lbl">' + esc(nameOf(w)) + '</span> <code class="trk-sel-addr" title="' + esc(w.address) + '">' + fitInner(w.address) + '</code>' +
      '<button class="copy-btn" type="button" data-tip="Copies the full address to your clipboard" data-copy="' + esc(w.address) + '" aria-label="Copy full address">📋</button>' +
      '<a class="trk-sel-link" href="https://robinhoodchain.blockscout.com/address/' + encodeURIComponent(w.address) + '" target="_blank" rel="noopener">explorer ↗</a>' +
      ((w.mine || isMine(w.address)) ? '<span class="trk-w-badge">your linked wallet</span>' : '') +
      (read ? '<span class="trk-sel-read">' + esc(read) + '</span>' : '');
  }
  // after a live read the saved-history line may have moved: one cheap list query, merged in place (no repaint of the list)
  async function refreshWalletMeta() {
    try {
      const j = await api('/api/wallets');
      for (const w of (j.wallets || [])) {
        const mine = walletByAddr(String(w.address).toLowerCase()); if (!mine) continue;
        if ('lastRead' in w) mine.lastRead = w.lastRead;
        if (w.lid != null) mine.lid = w.lid;
      }
      updateSelectedLine();
    } catch {}
  }
  function setBanner(kind, html) {
    if (!html) { banner.hidden = true; banner.innerHTML = ''; banner.className = 'trk-banner'; return; }
    banner.hidden = false; banner.className = 'trk-banner is-' + kind; banner.innerHTML = html;
  }
  /* An incremental read (a saved history exists and this is not a rebuild) reads only the blocks after the saved
     read: the banner says so by the block it starts from. The server reads from a little before `readTo` (a reorg
     overlap) — the figure shown is the saved read's last block, which is what "from" means to the reader. */
  function incrementalFrom(addr) {
    const w = walletByAddr(addr), lr = w && w.lastRead;
    if (!lr || lr.partial || state.rebuilding[addr]) return null;
    return lr.readTo != null ? Number(lr.readTo) : null;
  }
  function paintBanner() {
    const addr = state.selected; if (!addr) return setBanner('', '');
    const entry = state.reports[addr];
    const busy = !!state.inflight[addr];
    const from = busy ? incrementalFrom(addr) : null;
    if (!entry) {
      if (busy && from != null) return setBanner('info', '<span class="np-live-dot" aria-hidden="true"></span> Updating from block <b>' + esc(from.toLocaleString('en-US')) + '</b>…');
      return setBanner('', '');
    }
    if (entry.failed) return setBanner('warn', entry.failedMsg || ('⚠️ Live refresh failed — showing the report from <b>' + esc(ago(entry.updatedAt)) + '</b>. The chain may be busy; try Refresh in a minute.'));
    if (busy) return setBanner('info', '<span class="np-live-dot" aria-hidden="true"></span> ' + (from != null ? 'Updating from block <b>' + esc(from.toLocaleString('en-US')) + '</b>… · last updated <b>' + esc(ago(entry.updatedAt)) + '</b>' : 'Last updated <b>' + esc(ago(entry.updatedAt)) + '</b> · ' + (state.rebuilding[addr] ? 'rebuilding from block 0…' : 'refreshing…')));
    const rep = entry.report || {};
    // an incremental read with no readFrom is the server's fast path: the node's head was not past the saved read, so nothing was read
    const inc = !rep.incremental ? '' : rep.readFrom != null ? ' · read from block ' + esc(Number(rep.readFrom).toLocaleString('en-US')) + ' (only what was new)' : ' · nothing new on the chain since the saved read';
    return setBanner(entry.source === 'live' ? 'fresh' : 'info', (entry.source === 'live' ? '✅ ' : '🗂️ ') + 'Updated <b>' + esc(ago(entry.updatedAt)) + '</b>' + (entry.source === 'live' ? inc : ' (saved report)'));
  }
  function renderReport(report) {
    if (typeof renderTracker !== 'function') { reportEl.innerHTML = '<p class="modal-note">Tracker unavailable on this page.</p>'; return; }
    // keep-place for the ⓘ explainers: renderTracker restores focus by data-trk-key, but the ⓘ are the page's, not the
    // renderer's — decorateStats() re-attaches them only after it returns — so their open panels and focus are put back
    // here (a re-render of the same wallet only: a different wallet starts with every explainer closed)
    const same = !!(reportEl._trkCtx && reportEl._trkCtx.r && report && reportEl._trkCtx.r.address === report.address);
    const a = document.activeElement;
    const hadInfo = same && a && a.closest ? a.closest('.trk-info') : null;
    const hadKey = hadInfo && reportEl.contains(hadInfo) ? hadInfo.dataset.trkKey : null;
    const openKeys = same ? Array.from(reportEl.querySelectorAll('.trk-info[aria-expanded="true"]'), (b) => b.dataset.trkKey) : [];
    try { renderTracker(reportEl, report, currentPrefs()); decorateStats(); }
    catch { reportEl.innerHTML = '<p class="modal-note">⚠️ This saved report couldn\'t be displayed — hit Refresh to rebuild it from the chain.</p>'; return; }
    if (!openKeys.length && !hadKey) return;
    const findInfo = (k) => Array.from(reportEl.querySelectorAll('.trk-info')).find((b) => b.dataset.trkKey === k) || null;
    openKeys.forEach((k) => { const b = findInfo(k); if (b && b.getAttribute('aria-expanded') !== 'true') toggleInfo(b); });
    if (hadKey) { const b = findInfo(hadKey); if (b) { try { b.focus({ preventScroll: true }); } catch { b.focus(); } } }
  }

  async function select(addr, announceIt) {
    addr = String(addr || '').toLowerCase();
    if (!walletByAddr(addr)) return;
    const w = walletByAddr(addr);
    const changed = state.selected !== addr;
    state.selected = addr; rememberSelected(addr);
    highlightSelected(); updateSelectedLine(); clearRebuild();
    refreshBtn.hidden = false; rebuildBtn.hidden = false;
    if (announceIt) say('Showing ' + nameOf(w));
    if (!changed) return; // already showing it (Refresh is the explicit re-read)
    const run = ++state.runId;
    const mem = state.reports[addr];
    if (mem && mem.report) {
      renderReport(mem.report);
      // a live report from the last couple of minutes is fresh enough — don't re-read the chain on every click
      if (mem.source === 'live' && !mem.failed && Date.now() - mem.updatedAt < 120000 && !state.inflight[addr]) { setProgress(''); setBusy(); return; }
      // a live read that just failed (chain busy / balances unreadable) is not retried on every click either — the
      // saved report stays on screen with its warning; Refresh is the explicit retry
      if (mem.failed && Date.now() - (mem.failedAt || 0) < 120000 && !state.inflight[addr]) { setProgress(''); setBusy(); return; }
    } else {
      reportEl.innerHTML = skeletonHTML(); setBanner('', '');
      setProgress('Checking for a saved report…');
      try {
        const c = await api('/api/tracker/cache?address=' + encodeURIComponent(addr));
        if (run !== state.runId) return;
        if (c && c.report && typeof c.report === 'object') {
          state.reports[addr] = { report: c.report, updatedAt: c.updatedAt || Date.now(), source: 'cache' };
          renderReport(c.report);
        }
      } catch { if (run !== state.runId) return; }
    }
    refresh(addr, run);
  }

  // busy = a live chain read is running for the wallet on screen (reads for other wallets keep going in the background
  // and warm the cache — they just don't own the UI)
  function setBusy() {
    const busy = !!(state.selected && state.inflight[state.selected]);
    state.refreshing = busy ? state.selected : null;
    refreshBtn.disabled = busy; rebuildBtn.disabled = busy; reportEl.setAttribute('aria-busy', String(busy));
    paintBanner();
  }
  /* Every read's progress goes through one listener per address, so opening a wallet whose read is already running
     (the combined view started it) shows how far it has got. tracker.js reports the words first and, from the 202,
     the structure {stage, done, total, eta, ahead, stageOf, progressed, resuming, queueFull}; the words alone still
     paint a line. The live region is keyed on the stage: it speaks on a stage change or every 20 s, never a percent. */
  const relay = (addr) => (m, info) => { const f = state.listen[addr]; if (f) f(m, info); };
  function listenTo(addr) {
    const pg = state.prog[addr] = { stage: '', etaEnd: null, info: null, msg: '' };
    state.listen[addr] = (m, info) => {
      pg.msg = String(m || '');
      if (info && typeof info === 'object' && info.stage !== 'busy') {   // 'busy' has no 202 behind it: the server's sentence (next in line / try again in a minute / slow down) is the line, and the stage's ETA is kept for when polling resumes
        const stage = String(info.stage || '');
        if (stage !== pg.stage) { pg.stage = stage; pg.etaEnd = null; }   // a new stage: its own measured ETA, from scratch
        if (info.throttled > 0) pg.etaEnd = null;   // a wait on the node: the estimate starts afresh once it clears (the one from before would run down to nothing)
        pg.etaEnd = etaEndAt(pg.etaEnd, Date.now(), info.eta);
        pg.info = info;
      } else pg.info = null;
      if (state.selected !== addr) return;
      paintProgress(addr);
    };
  }
  /* fresh: falsy = the server's recent copy is fine; 1 = Refresh (incremental when a history is saved); 2 = Rebuild from
     scratch (from block 0, rate-limited by the server). */
  async function refresh(addr, run, fresh) {
    if (typeof trackerReport !== 'function') { setProgress(''); reportEl.innerHTML = '<p class="modal-note">Tracker unavailable on this page.</p>'; return; }
    const hadCached = !!(state.reports[addr] && state.reports[addr].report);
    if (!hadCached) reportEl.innerHTML = skeletonHTML();
    if (fresh === 2) state.rebuilding[addr] = true;
    setProgress('⛓️ Reading the account…');
    listenTo(addr);
    // one chain read per address at a time: switching back and forth between wallets joins the read already running
    let p = state.inflight[addr];
    if (!p) {
      p = state.inflight[addr] = trackerReport(addr, relay(addr), { fresh: fresh === 2 ? 2 : !!fresh })
        .then(rep => {
          const entry = { report: rep, updatedAt: rep.readAt || Date.now(), source: 'live' };   // when the chain was read, not when it arrived
          // a failed balance read must not overwrite a good saved report (server or memory) — it would show "$0 held"
          // on the next open. It still renders live now, with tracker.js's own warning.
          if (!rep.holdingsFailed) { state.reports[addr] = entry; postCache(addr, rep); }
          else if (!state.reports[addr]) state.reports[addr] = entry;
          return rep;
        })
        .finally(() => { delete state.inflight[addr]; delete state.rebuilding[addr]; });
    }
    setBusy();
    try {
      const rep = await p;
      refreshWalletMeta();   // the saved-history line (history read … · to block N) has just moved
      if (run !== state.runId) return; // user moved on — cache is warm, nothing to paint
      const entry = state.reports[addr];
      if (rep.holdingsFailed && hadCached && entry && entry.report) {
        // balances unreadable but we hold a good report: keep it on screen (memory + banner + screen all agree) and
        // flag the entry so switching wallets and back doesn't re-read a busy chain on every click
        entry.failed = true; entry.failedAt = Date.now();
        entry.failedMsg = '⚠️ Token balances could not be read on this refresh — showing the saved report from <b>' + esc(ago(entry.updatedAt)) + '</b>. Try Refresh in a minute.';
        setProgress('Balances unreadable — showing the saved report.');
      } else {
        renderReport(rep);   // renderTracker keeps its own place (open rows, filters, focus) across a re-render
        setProgress(rep.holdingsFailed ? 'Report built, but token balances could not be read.' : (rep.incremental ? (rep.readFrom != null ? 'Report updated — only the blocks after the saved read were read.' : 'Report checked — nothing new on the chain since the saved read.') : 'Report updated.'));
      }
    } catch (e) {
      refreshWalletMeta();   // a failed read may still have left a checkpoint (or a walk stopped part-way) behind, whichever wallet is selected now: the saved-history line says what is there
      if (run !== state.runId) return;
      const entry = state.reports[addr];
      const why = (e && e.message) || 'the chain may be busy';   // the server says why: busy, throttled, or a wallet too large to read in full
      const queueFull = !!(e && (e.queueFull || /long line/i.test(why)));
      if (e && e.permanent) {
        if (entry && entry.report) { entry.failed = true; entry.failedAt = Date.now(); entry.failedMsg = '⚠️ ' + esc(why) + ' — showing the saved report from <b>' + esc(ago(entry.updatedAt)) + '</b>.'; setProgress(why + '.'); }
        else { setProgress(''); reportEl.innerHTML = '<p class="np-msg">⚠️ ' + esc(why) + '. The explorer link above shows its full history.</p>'; }
      } else if (entry && entry.report) { entry.failed = true; entry.failedAt = Date.now(); delete entry.failedMsg; setProgress(queueFull ? QUEUE_FULL_COPY + ' Showing the saved report.' : 'Live refresh failed (' + why + ') — showing the saved report.'); }
      else {
        setProgress(queueFull ? QUEUE_FULL_COPY : '');
        reportEl.innerHTML = '<p class="np-msg">⚠️ Couldn\'t read this wallet right now — ' + esc(why) + '. <button class="btn btn-sm btn-ghost trk-retry" type="button" data-tip="Attempts the chain read for this wallet again" data-retry>Try again</button></p>';
      }
    } finally {
      if (run === state.runId) setBusy(); // paints the banner (fresh / saved / warning) from the entry's state
    }
  }
  /* The saved copy has to fit the server's 400 KB. Trim in steps, keeping every total and every token's figures:
     first the trade tables to the 40 the page shows, then to 10, then drop the rows of tokens with no value and no
     trades (the dust the page hides anyway). The next live read replaces it. */
  function postCache(addr, rep) {
    const CAP = 380 * 1024, fits = b => JSON.stringify(b).length <= CAP;
    let body = rep;
    try {
      if (!fits(body)) body = { ...rep, tokens: rep.tokens.map(t => ({ ...t, trades: (t.trades || []).slice(0, 40) })), trimmedForCache: true };
      /* The transactions list is the bulk of a busy wallet's report (one row per token transaction): keep the newest
         500, then 150, and say how many the full list had (activityTrimmed) — the renderer prints that beside the list.
         The next live read lists them all again. */
      const trimAct = (n) => (Array.isArray(body.activity) && body.activity.length > n) ? { ...body, activity: n ? body.activity.slice(0, n) : undefined, activityTrimmed: rep.activity.length, trimmedForCache: true } : body;
      if (!fits(body)) body = trimAct(500);
      if (!fits(body)) body = { ...body, tokens: body.tokens.map(t => ({ ...t, trades: t.trades.slice(0, 10) })) };
      if (!fits(body)) body = trimAct(150);
      if (!fits(body)) body = { ...body, tokens: body.tokens.filter(t => (t.valueUsd != null && t.valueUsd >= 1) || t.buys + t.sells > 0 || t.balanceUnread) };
      if (!fits(body)) body = { ...body, tokens: body.tokens.map(t => ({ ...t, trades: [] })) };   // counts and PNL stay; only the trade tables go
      if (!fits(body)) body = trimAct(0);   // the list goes (the renderer says so, with the count); the facts keep txCounts
      if (!fits(body) && body.series) body = { ...body, series: undefined };   // the chart's held/invested points go (the chart host says "No chart in this saved report")
      if (!fits(body)) body = { ...body, tokens: body.tokens.filter(t => (t.valueUsd != null && t.valueUsd >= 1) || t.balanceUnread || t.unrealizedUsd != null), tokensTrimmed: true };   // last: closed positions' rows (the report's totals are untouched)
      if (!fits(body)) return;
    } catch { return; }
    api('/api/tracker/cache', { method: 'POST', body: { address: addr, report: body } }).catch(() => {});
  }
  function forgetFailure(addr) { const entry = state.reports[addr]; if (entry) { delete entry.failed; delete entry.failedAt; delete entry.failedMsg; } }
  refreshBtn.addEventListener('click', () => {
    if (!state.selected || state.inflight[state.selected]) return;
    clearRebuild(); forgetFailure(state.selected);
    say('Refreshing report');
    if (window.SFX) SFX.play('scan');   // a new read of the chain starts
    refresh(state.selected, ++state.runId, 1);   // a new read from the chain, not the server's copy of the last one — incremental when a history is saved
  });
  /* Rebuild from scratch: two taps within 4 s. The whole history from block 0 is the slow read the saved one exists
     to avoid, and the server rate-limits it, so a stray tap must not spend it. */
  function clearRebuild() {
    if (!state.rebuildT) return;
    clearTimeout(state.rebuildT); state.rebuildT = null;
    rebuildBtn.classList.remove('is-armed'); rebuildBtn.textContent = 'Rebuild from scratch';
    rebuildBtn.removeAttribute('aria-label');
  }
  rebuildBtn.addEventListener('click', () => {
    if (!state.selected || state.inflight[state.selected]) return;
    if (state.rebuildT) {
      clearRebuild(); forgetFailure(state.selected);
      say('Rebuilding the report from block 0');
      if (window.SFX) SFX.play('scan');
      refresh(state.selected, ++state.runId, 2);
      return;
    }
    rebuildBtn.classList.add('is-armed'); rebuildBtn.textContent = 'Sure? Rebuild';
    rebuildBtn.setAttribute('aria-label', 'Tap again to confirm: read the whole history again from block 0 — an hour or more on the public node');
    say('Tap again within 4 seconds to read the whole history again from block 0 — on the public node it can take an hour or more; you can leave, it keeps reading, is saved, and you get a notification when it is ready');
    state.rebuildT = setTimeout(clearRebuild, 4000);
    if (window.SFX) SFX.play('warn');   // armed: tap again to confirm
  });
  reportEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) { if (state.selected) refresh(state.selected, ++state.runId); return; }
    const info = e.target.closest('.trk-info');
    if (info) { e.preventDefault(); e.stopPropagation(); toggleInfo(info); }
  });
  reportEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const btn = e.target.closest && e.target.closest('.trk-info');
    if (btn && btn.getAttribute('aria-expanded') === 'true') { closeInfo(btn); e.preventDefault(); }
  });

  /* ---------- ⓘ stat explainers (button + aria-expanded panel; no title= tooltips) ---------- */
  const DEFS = {
    'Portfolio value': 'Everything the wallet holds right now: its ETH plus every token with a live price (from Dexscreener, or from the token\'s own pool on the chain). USD at today\'s ETH price; a partial total says what it leaves out.',
    'ETH balance': 'The wallet\'s native ETH on Robinhood Chain — what it uses to pay gas and buy tokens.',
    'Unrealized PNL': 'Paper profit or loss on tokens still held: today\'s value minus what the wallet paid for them (average cost).',
    'Realized PNL': 'Profit or loss already locked in by selling: sale proceeds minus the average cost of what was sold.',
    'Avg entry': 'Average cost: the mean price paid per token in ETH across all buys. Tokens transferred in count as free, which pulls it down.',
    'Spent on buys': 'Total ETH the pool took in for the tokens this wallet bought — straight from the pool or through any router or swap app.',
    'Sell proceeds': 'Total ETH the pool paid out for the tokens this wallet sold, however the swap was routed.',
    'Realized': 'Profit or loss locked in on this token by selling: proceeds minus the average cost of what was sold.',
    'Unrealized': 'Paper profit or loss on the amount still held: value today minus its average cost.',
    'Tokens traded': 'How many different tokens this wallet has bought or sold against a DEX pool, how many of them have a positive total PNL, and how many could not be valued.',
    'Transactions sent': 'How many transactions this wallet has signed and sent — its nonce, read from the chain. Transfers other people sent to it are not counted here; a contract\'s nonce counts the contracts it created.',
    'Token transactions': 'Every transaction that moved a token to or from this wallet, whoever sent it — these are the ones listed under Transactions. Plain ETH transfers and contract calls that move no token leave no log on the chain, so they are not counted.',
    'First activity': 'The earliest token transfer this wallet made or received, dated from the chain.',
    'Last activity': 'The latest token transfer this wallet made or received, dated from the chain.',
    'Account': 'What the chain says this address is: a wallet, a wallet that delegated to smart-account code (EIP-7702, still a personal wallet), or a contract.',
    'Value over time': 'Token holdings valued at each pool\'s own on-chain price, USD at today\'s ETH price; the ETH balance is not included. A rise or fall is a change in value, not a return — buys, sells and transfers move it too.',
  };
  let infoSeq = 0;
  // the words of a label without its unit ("Portfolio value (USD)" → "Portfolio value") or an ⓘ already in it
  function labelKey(el) {
    let s = '';
    el.childNodes.forEach(n => {
      if (n.nodeType === 3) s += n.textContent;
      else if (n.nodeType === 1 && !n.classList.contains('unit') && !n.classList.contains('trk-info') && !n.classList.contains('sr-only')) s += n.textContent;
    });
    return s.replace(/\s+/g, ' ').trim();
  }
  /* ⓘ lives in exactly two places: inside a stat tile's label (.hstat .lbl), and in a section's heading row
     (.trk-h-row) as a SIBLING of its h3 — never inside a heading, where the definition would become part of the
     heading text. A row that already carries one (the holdings column panel the renderer draws) is left alone. */
  function decorateStats() {
    reportEl.querySelectorAll('.hstat').forEach(box => {
      if (box.querySelector('.trk-info')) return;
      const lbl = box.querySelector('.lbl'); if (!lbl) return;
      const key = labelKey(lbl);
      const def = DEFS[key]; if (!def) return;
      addInfo(box, lbl, key, def);
    });
    reportEl.querySelectorAll('.trk-h-row').forEach(row => {
      if (row.querySelector('.trk-info')) return;
      const h = row.querySelector('.trk-h'); if (!h) return;
      const key = labelKey(h);
      const def = DEFS[key]; if (!def) return;
      addInfo(row, row, key, def);
    });
  }
  function addInfo(box, labelEl, key, def) {
    const id = 'trk-def-' + (++infoSeq);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'trk-info'; btn.textContent = 'ⓘ';
    btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', id);
    btn.setAttribute('aria-label', 'What is ' + key + '?');
    btn.setAttribute('data-tip', 'Shows or hides what this figure means');
    // keep-place key (renderReport re-opens and re-focuses the ⓘ after decorateStats): the per-token stat tiles repeat
    // the same labels in every token's detail row, so those are scoped by the row's id (uid-tok-address, stable across re-renders)
    const det = box.closest('.trk-hdetail');
    btn.setAttribute('data-trk-key', 'info:' + (det ? det.id + ':' : '') + key);
    labelEl.appendChild(btn);
    const panel = document.createElement('p');
    panel.className = 'trk-info-panel'; panel.id = id; panel.hidden = true; panel.textContent = def;
    // when the label IS the box (a heading row), the panel goes after it — under the heading, outside it
    if (box === labelEl) box.insertAdjacentElement('afterend', panel); else box.appendChild(panel);
  }
  function toggleInfo(btn) {
    const open = btn.getAttribute('aria-expanded') === 'true';
    if (open) closeInfo(btn); else { btn.setAttribute('aria-expanded', 'true'); const p = reportEl.querySelector('#' + btn.getAttribute('aria-controls')); if (p) p.hidden = false; }
  }
  function closeInfo(btn) { btn.setAttribute('aria-expanded', 'false'); const p = reportEl.querySelector('#' + btn.getAttribute('aria-controls')); if (p) p.hidden = true; }
  // renderTracker re-renders itself (innerHTML) when a display toggle is clicked, and fills a token's detail panel on its
  // first open → re-attach the ⓘ buttons (subtree: the panel is filled deep in the table; decorateStats skips boxes that
  // already carry one, so its own insertions end the loop)
  new MutationObserver(() => { if (!reportEl.querySelector('.trk-skel')) decorateStats(); }).observe(reportEl, { childList: true, subtree: true });

  /* ---------- combined totals across your own wallets ----------------------
     One person with three wallets has one portfolio, so this answers the question
     the page is actually opened with. It reuses the same cache-first machinery a
     single report uses — saved report first so numbers appear at once, then a live
     read per wallet — and it runs them one at a time on purpose: each report is
     a whole-wallet read of the chain, and firing five at once is how you get rate-limited
     into a page full of dashes. */
  const combTotals = $('trk-comb-totals'), combRows = $('trk-comb-rows'), combNote = $('trk-comb-note'),
        combRun = $('trk-comb-run'), combSec = $('trk-comb'), combSub = $('trk-comb-sub');

  // unknown (no balances, or no ETH price to put the ETH in dollars) is null, never a $0 that quietly drops out of a sum
  const portfolioOf = (r) => (r.holdingsFailed || (r.source === 'chain' && r.ethUsd == null)) ? null : (r.ethValueUsd || 0) + (r.totalTokenValueUsd || 0);
  /* Its own formatter rather than trkUsd: these figures sit in a column under tabular-nums, and trkUsd's
     `maximumFractionDigits` with no minimum renders 12000.30 as "$12,000.3" and 27 as "$27" — so the
     decimal points do not line up, which is the one thing a totals column has to get right. */
  const usd = (n) => {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(n);
    const d = abs > 0 && abs < 1 ? 4 : 2;
    return (n < 0 ? '−' : '') + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  function signed(n) {
    if (n == null) return '<span class="cmb-v">—</span>';
    const cls = n > 0 ? 'up' : n < 0 ? 'down' : '';
    return '<span class="cmb-v ' + cls + '">' + (n > 0 ? '+' : n < 0 ? '−' : '') + usd(Math.abs(n)).replace('−', '') + '</span>';
  }

  function renderCombined() {
    const c = state.comb;
    if (!c || !c.rows.length) { combTotals.hidden = true; combRows.hidden = true; return; }
    combTotals.hidden = false; combRows.hidden = false;
    const net = (c.realized == null && c.unrealized == null) ? null : (c.realized || 0) + (c.unrealized || 0);
    combTotals.innerHTML =
      '<div class="cmb-stat"><div class="cmb-l">Portfolio value</div><div class="cmb-v big">' + usd(c.portfolio) + '</div></div>' +
      '<div class="cmb-stat"><div class="cmb-l">Net PNL</div><div>' + signed(net) + '</div></div>' +
      '<div class="cmb-stat"><div class="cmb-l">Realized</div><div>' + signed(c.realized) + '</div></div>' +
      '<div class="cmb-stat"><div class="cmb-l">Unrealized</div><div>' + signed(c.unrealized) + '</div></div>';
    combRows.innerHTML = c.rows.map(r => {
      const rnet = (r.realized == null && r.unrealized == null) ? null : (r.realized || 0) + (r.unrealized || 0);
      return '<li class="cmb-row' + (r.pending ? ' is-pending' : '') + '">' +
        '<button class="cmb-pick" type="button" data-tip="Opens the full report for this wallet below" data-select="' + esc(r.address) + '">' +
          '<code class="cmb-addr addr-fit" title="' + esc(r.address) + '">' + fitInner(r.address) + '</code>' +
          '<span class="cmb-name">' + esc(r.label || '') + '</span>' +
        '</button>' +
        '<span class="cmb-cell">' + (r.pending ? '<span class="cmb-wait">reading…</span>' : (r.failed ? '<span class="cmb-wait">unreadable</span>' : usd(r.portfolio))) + '</span>' +
        '<span class="cmb-cell">' + (r.pending || r.failed ? '' : signed(rnet)) + '</span>' +
      '</li>';
    }).join('');
  }

  // a report for the combined view: memory → saved report → live read. Never paints over the single-wallet UI.
  async function reportFor(addr) {
    const mem = state.reports[addr];
    if (mem && mem.report) return mem.report;
    try {
      const c = await api('/api/tracker/cache?address=' + encodeURIComponent(addr));
      if (c && c.report && typeof c.report === 'object') {
        state.reports[addr] = { report: c.report, updatedAt: c.updatedAt || Date.now(), source: 'cache' };
        return c.report;
      }
    } catch {}
    if (typeof trackerReport !== 'function') return null;
    let p2 = state.inflight[addr];
    if (!p2) {
      p2 = state.inflight[addr] = trackerReport(addr, relay(addr))   // if this wallet is opened meanwhile, its progress line follows this read
        .then(rep => { if (!rep.holdingsFailed) { state.reports[addr] = { report: rep, updatedAt: rep.readAt || Date.now(), source: 'live' }; postCache(addr, rep); } return rep; })
        .finally(() => { delete state.inflight[addr]; });
    }
    return p2;
  }

  async function runCombined() {
    if (state.combRunning) return;
    const mine = state.wallets.filter(w => w.mine);
    if (!mine.length) return;
    state.combRunning = true;
    combRun.disabled = true;
    if (window.SFX) SFX.play('scan');   // a read of each of your wallets starts
    state.comb = { portfolio: null, realized: null, unrealized: null, partial: false, rows: mine.map(w => ({ address: w.address, label: w.label, pending: true })) };
    renderCombined();
    let done = 0, failed = 0;
    for (const w of mine) {
      const row = state.comb.rows.find(r => r.address === w.address);
      combNote.textContent = 'Reading ' + (done + 1) + ' of ' + mine.length + '…';
      try {
        const rep = await reportFor(w.address);
        if (!rep) throw new Error('no report');
        row.pending = false;
        row.portfolio = portfolioOf(rep);
        row.realized = rep.totalRealizedUsd;
        row.unrealized = rep.holdingsFailed ? null : rep.totalUnrealizedUsd;
        // what is known is added; what is not makes the total a partial one — never a fake $0 in the sum
        const c = state.comb, add = (k, v) => { if (v == null) c.partial = true; else c[k] = (c[k] || 0) + v; };
        if (row.portfolio == null) { row.failed = true; failed++; } else if (rep.portfolioPartial || rep.pnlUnknown) c.partial = true;
        add('portfolio', row.portfolio); add('realized', row.realized); add('unrealized', row.unrealized);
      } catch { row.pending = false; row.failed = true; failed++; state.comb.partial = true; }
      done++;
      renderCombined();
    }
    combNote.textContent = failed
      ? failed + ' of ' + mine.length + ' could not be read or priced — the chain may be busy. The rest are added up above, so the totals are partial.'
      : 'Added up across ' + mine.length + ' wallet' + (mine.length === 1 ? '' : 's') + ' · same average-cost basis as a single report' + (state.comb.partial ? ' · partial: some balances, prices or trades could not be read or valued, and are left out' : '') + '.';
    combRun.disabled = false; combRun.textContent = '↻ Recheck';
    state.combRunning = false;
    say('Combined totals ready');
  }

  function paintCombinedSection() {
    const mine = state.wallets.filter(w => w.mine);
    combSec.hidden = !mine.length;
    if (!mine.length) return;
    combSub.textContent = mine.length === 1
      ? 'Your linked wallet is always here — it never uses a tracked slot.'
      : 'All ' + mine.length + ' of your linked wallets are always here, and none of them uses a tracked slot.';
  }
  combRun.addEventListener('click', runCombined);
  combRows.addEventListener('click', (e) => {
    const b = e.target.closest('[data-select]');
    if (b) select(b.dataset.select, true);
  });

  /* ---------- signed-in / signed-out ---------- */
  function showSignedOut() {
    layout.hidden = true; signedOut.hidden = false;
    state.wallets = []; state.loaded = false; state.selected = null; state.runId++; state.refreshing = null; state.reports = {};
    setNote('');
    if (hashTrack && soAddr && !soAddr.value) soAddr.value = hashTrack;   // from the menu search: filled in, kept for after sign-in
  }
  function showSignedIn() {
    signedOut.hidden = true; layout.hidden = false;
    state.prefs = (AUTH.user && AUTH.user.tracker_prefs) || null;
    loadWallets();
  }
  // auth:change also fires at init and when a wallet gets linked — only reload the list when the signed-in identity
  // actually changes; otherwise just refresh the "your linked wallet" badges + quick-add chips. auth.js dispatches
  // auth:change before AUTH.ready resolves, so the second boot() for the same user must not repaint the (still empty)
  // list while GET /api/wallets is in flight — state.loaded guards that.
  let bootedFor;
  function boot() {
    const u = (window.AUTH && AUTH.user) ? String(AUTH.user.id || AUTH.user.username || '1') : null;
    if (bootedFor !== undefined && u === bootedFor) { if (u && state.loaded) { highlightSelected(); renderWallets(); } return; }
    bootedFor = u;
    if (u) showSignedIn(); else showSignedOut();
  }
  if (window.AUTH && AUTH.ready) AUTH.ready.then(boot); else boot();
  document.addEventListener('auth:change', boot);

  // keep "Xm ago" honest without a live region (the banner is visual; progress carries announcements)
  state.tick = setInterval(() => { if (!banner.hidden && state.selected) paintBanner(); }, 30000);
})();
