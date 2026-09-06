/* ===== trackerpage.js — the Wallet Tracker page =====
 * Left: your tracked wallets (add / rename / remove / select). Right: the selected wallet's on-chain report.
 * Report flow: server cache (instant) → live trackerReport() in the background → fresh render + cache write.
 * Reuses tracker.js (trackerReport + renderTracker) and chain.js. CSP-safe: addEventListener only, esc() on every
 * user/third-party string that touches innerHTML. Read-only, honest: nothing here signs or moves anything. */
(function () {
  'use strict';
  const layout = document.getElementById('trk-layout'); if (!layout) return;
  const $ = (id) => document.getElementById(id);
  const signedOut = $('trk-signedout'), wlist = $('trk-wlist'), wstatus = $('trk-wstatus'), chips = $('trk-chips'), chipsRow = $('trk-chips-row');
  const addForm = $('trk-add'), addrIn = $('trk-addr'), labelIn = $('trk-label'), addBtn = $('trk-add-btn'), addrErr = $('trk-addr-err');
  const reportEl = $('trk-report'), banner = $('trk-banner'), progress = $('trk-progress'), refreshBtn = $('trk-refresh'), selectedEl = $('trk-selected'), srEl = $('trk-sr');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shortAddr = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
  const toast = (m) => { if (window.sendToast) sendToast(m); };
  const say = (m) => { if (window.announce) announce(m); else if (srEl) srEl.textContent = m; };
  const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
  const LS_KEY = 'trk:last';

  const state = {
    wallets: [], limit: 10, base: 10, diamondLevel: 0, holdsGwc: false,
    loaded: false,        // true once GET /api/wallets has answered for the current identity (boot() must not repaint before then)
    selected: null,       // lowercase address of the wallet whose report is shown
    runId: 0,             // bumps on every select/refresh so a slow, stale run can't paint over a newer one
    reports: {},          // addr → { report, updatedAt, source: 'cache'|'live', failed?, failedAt?, failedMsg? } (session memory)
    prefs: null,          // display prefs (mirrors AUTH.user.tracker_prefs)
    refreshing: null,     // address whose live read currently owns the UI (null when idle)
    inflight: {},         // addr → promise of a running trackerReport (dedupes reads per address)
    confirmT: null,       // pending two-tap remove { id, timer }
    tick: null,
  };

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
    const used = state.wallets.length, limit = state.limit || 10, full = used >= limit;
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
      note.innerHTML = fullHint + 'Everyone tracks up to <b>' + (state.base || 10) + '</b> wallets. Hold <b>$GWC</b> and diamond-hand it to <b>Diamond Lv 1</b> → <b>100</b> wallets, then <b>+100 per Diamond level</b>. <a href="index.html#swap">Get $GWC →</a>';
    }
    addBtn.disabled = full; // the visible .track-cap-full-hint above already says why (a disabled button can't be focused, so no title=)
  }

  /* ---------- wallet list ---------- */
  function walletHTML(w) {
    const sel = state.selected === w.address;
    const mine = isMine(w.address);
    return '<li class="trk-w' + (sel ? ' is-selected' : '') + '" data-wid="' + esc(w.id) + '" data-addr="' + esc(w.address) + '">' +
      '<button class="trk-w-main" type="button" data-select="' + esc(w.address) + '"' + (sel ? ' aria-current="true"' : '') + '>' +
        '<span class="trk-w-ico" aria-hidden="true">' + (mine ? '🔗' : '💼') + '</span>' +
        '<span class="trk-w-txt"><span class="trk-w-label">' + esc(nameOf(w)) + '</span>' +
        '<span class="trk-w-addr"><code>' + esc(shortAddr(w.address)) + '</code>' + (mine ? ' <span class="trk-w-badge">your linked wallet</span>' : '') + '</span></span>' +
        '<span class="sr-only">' + (sel ? 'Selected. ' : '') + 'Show report for ' + esc(nameOf(w)) + ' ' + esc(w.address) + '</span>' +
      '</button>' +
      '<span class="trk-w-actions">' +
        '<button class="copy-btn trk-w-btn" type="button" data-copy="' + esc(w.address) + '" aria-label="Copy address of ' + esc(nameOf(w)) + '">📋</button>' +
        '<button class="copy-btn trk-w-btn" type="button" data-rename="' + esc(w.id) + '" aria-label="Rename ' + esc(nameOf(w)) + '">✏️</button>' +
        '<button class="copy-btn trk-w-btn trk-w-rm" type="button" data-remove="' + esc(w.id) + '" aria-label="Stop tracking ' + esc(nameOf(w)) + '">✕</button>' +
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
      wstatus.innerHTML = '<span class="np-live-dot" aria-hidden="true"></span> ' + state.wallets.length + ' tracked wallet' + (state.wallets.length === 1 ? '' : 's');
    }
    renderChips();
    updateCap();
  }
  function renderChips() {
    const tracked = new Set(state.wallets.map(w => w.address));
    const mine = myWallets().filter(a => !tracked.has(a));
    const full = state.wallets.length >= (state.limit || 10);
    if (!mine.length || full) { chips.hidden = true; chipsRow.innerHTML = ''; return; }
    chips.hidden = false;
    chipsRow.innerHTML = mine.map(a => '<button class="react-btn trk-chip" type="button" data-quick="' + esc(a) + '">🔗 Track my connected wallet <code>' + esc(shortAddr(a)) + '</code></button>').join('');
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
      state.limit = j.limit || j.base || 10; state.base = j.base || 10;
      state.diamondLevel = j.diamondLevel || 0; state.holdsGwc = !!j.holdsGwc;
      state.loaded = true;
      renderWallets();
      // pick a wallet: the remembered one if still tracked, else the first
      const want = recallSelected();
      const pick = (want && walletByAddr(want)) ? want : (state.wallets[0] ? state.wallets[0].address : null);
      if (pick) select(pick, false); else showNoSelection();
    } catch (e) {
      if (/sign in/i.test(e.message || '')) { showSignedOut(); return; }
      wstatus.innerHTML = '⚠️ Couldn\'t load your wallets. <button type="button" data-retry-wallets>Retry</button>';
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
    if (!ADDR_RE.test(address)) { setAddrError('That doesn\'t look like an address — it should start with 0x and be 42 characters long.'); addrIn.focus(); return false; }
    address = address.toLowerCase();
    if (walletByAddr(address)) { setAddrError('You\'re already tracking that wallet — it\'s in your list.'); select(address, true); return false; }
    addBtn.disabled = true;
    try {
      const j = await api('/api/wallets', { method: 'POST', body: { address, label: String(label || '').slice(0, 40) } });
      const w = { ...j.wallet, address: String(j.wallet.address).toLowerCase() };
      state.wallets.push(w);
      addrIn.value = ''; labelIn.value = ''; setAddrError('');
      renderWallets();
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
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
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
      '<span class="trk-rename-btns"><button class="btn btn-sm btn-primary" type="submit">Save</button><button class="btn btn-sm btn-ghost" type="button" data-cancel>Cancel</button></span>' +
      '<span class="trk-rename-hint">Enter to save · Esc to cancel</span>';
    li.appendChild(form);
    const input = form.querySelector('input');
    input.value = w.label || '';
    input.focus(); input.select();
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
      try { await api('/api/wallets/' + encodeURIComponent(w.id), { method: 'PATCH', body: { label } }); say('Renamed to ' + nameOf(w)); }
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
    try { await api('/api/wallets/' + encodeURIComponent(id), { method: 'DELETE' }); }
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
    refreshBtn.hidden = true; selectedEl.hidden = true; banner.hidden = true; progress.textContent = '';
    reportEl.innerHTML = '<p class="np-msg">👈 Track a wallet to see its report here.</p>';
  }
  function updateSelectedLine() {
    const w = state.selected && walletByAddr(state.selected);
    if (!w) { selectedEl.hidden = true; return; }
    selectedEl.hidden = false;
    selectedEl.innerHTML = '<span class="trk-sel-lbl">' + esc(nameOf(w)) + '</span> <code class="trk-sel-addr">' + esc(w.address) + '</code>' +
      '<button class="copy-btn" type="button" data-copy="' + esc(w.address) + '" aria-label="Copy full address">📋</button>' +
      '<a class="trk-sel-link" href="https://robinhoodchain.blockscout.com/address/' + encodeURIComponent(w.address) + '" target="_blank" rel="noopener">explorer ↗</a>';
  }
  function setBanner(kind, html) {
    if (!html) { banner.hidden = true; banner.innerHTML = ''; banner.className = 'trk-banner'; return; }
    banner.hidden = false; banner.className = 'trk-banner is-' + kind; banner.innerHTML = html;
  }
  function paintBanner() {
    const addr = state.selected; if (!addr) return setBanner('', '');
    const entry = state.reports[addr];
    const busy = !!state.inflight[addr];
    if (!entry) return setBanner('', '');
    if (entry.failed) return setBanner('warn', entry.failedMsg || ('⚠️ Live refresh failed — showing the report from <b>' + esc(ago(entry.updatedAt)) + '</b>. The explorer may be busy; try Refresh in a minute.'));
    if (busy) return setBanner('info', '<span class="np-live-dot" aria-hidden="true"></span> Last updated <b>' + esc(ago(entry.updatedAt)) + '</b> · refreshing…');
    return setBanner(entry.source === 'live' ? 'fresh' : 'info', (entry.source === 'live' ? '✅ ' : '🗂️ ') + 'Updated <b>' + esc(ago(entry.updatedAt)) + '</b>' + (entry.source === 'live' ? '' : ' (saved report)'));
  }
  function renderReport(report) {
    if (typeof renderTracker !== 'function') { reportEl.innerHTML = '<p class="modal-note">Tracker unavailable on this page.</p>'; return; }
    try { renderTracker(reportEl, report, currentPrefs()); decorateStats(); }
    catch { reportEl.innerHTML = '<p class="modal-note">⚠️ This saved report couldn\'t be displayed — hit Refresh to rebuild it from the chain.</p>'; }
  }

  async function select(addr, announceIt) {
    addr = String(addr || '').toLowerCase();
    if (!walletByAddr(addr)) return;
    const w = walletByAddr(addr);
    const changed = state.selected !== addr;
    state.selected = addr; rememberSelected(addr);
    highlightSelected(); updateSelectedLine();
    refreshBtn.hidden = false;
    if (announceIt) say('Showing ' + nameOf(w));
    if (!changed) return; // already showing it (Refresh is the explicit re-read)
    const run = ++state.runId;
    const mem = state.reports[addr];
    if (mem && mem.report) {
      renderReport(mem.report);
      // a live report from the last couple of minutes is fresh enough — don't hammer the explorer on every click
      if (mem.source === 'live' && !mem.failed && Date.now() - mem.updatedAt < 120000 && !state.inflight[addr]) { progress.textContent = ''; setBusy(); return; }
      // a live read that just failed (explorer down / balances unreadable) is not retried on every click either — the
      // saved report stays on screen with its warning; Refresh is the explicit retry
      if (mem.failed && Date.now() - (mem.failedAt || 0) < 120000 && !state.inflight[addr]) { progress.textContent = ''; setBusy(); return; }
    } else {
      reportEl.innerHTML = skeletonHTML(); setBanner('', '');
      progress.textContent = 'Checking for a saved report…';
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
    refreshBtn.disabled = busy; reportEl.setAttribute('aria-busy', String(busy));
    paintBanner();
  }
  async function refresh(addr, run) {
    if (typeof trackerReport !== 'function') { progress.textContent = ''; reportEl.innerHTML = '<p class="modal-note">Tracker unavailable on this page.</p>'; return; }
    const hadCached = !!(state.reports[addr] && state.reports[addr].report);
    if (!hadCached) reportEl.innerHTML = skeletonHTML();
    progress.textContent = '⛓️ reading account…';
    // one chain read per address at a time: switching back and forth between wallets joins the read already running
    let p = state.inflight[addr];
    if (!p) {
      let lastMsg = 0;
      p = state.inflight[addr] = trackerReport(addr, m => { const t = Date.now(); if (state.selected === addr && t - lastMsg > 250) { lastMsg = t; progress.textContent = '⛓️ ' + m; } })
        .then(rep => {
          const entry = { report: rep, updatedAt: Date.now(), source: 'live' };
          // a failed balance read must not overwrite a good saved report (server or memory) — it would show "$0 held"
          // on the next open. It still renders live now, with tracker.js's own warning.
          if (!rep.holdingsFailed) { state.reports[addr] = entry; postCache(addr, rep); }
          else if (!state.reports[addr]) state.reports[addr] = entry;
          return rep;
        })
        .finally(() => { delete state.inflight[addr]; });
    }
    setBusy();
    try {
      const rep = await p;
      if (run !== state.runId) return; // user moved on — cache is warm, nothing to paint
      const entry = state.reports[addr];
      if (rep.holdingsFailed && hadCached && entry && entry.report) {
        // balances unreadable but we hold a good report: keep it on screen (memory + banner + screen all agree) and
        // flag the entry so switching wallets and back doesn't re-read a flaky explorer on every click
        entry.failed = true; entry.failedAt = Date.now();
        entry.failedMsg = '⚠️ Token balances could not be read on this refresh — showing the saved report from <b>' + esc(ago(entry.updatedAt)) + '</b>. Try Refresh in a minute.';
        progress.textContent = 'Balances unreadable — showing the saved report.';
      } else {
        renderReport(rep);
        progress.textContent = rep.holdingsFailed ? 'Report built, but token balances could not be read.' : 'Report updated just now.';
      }
    } catch {
      if (run !== state.runId) return;
      const entry = state.reports[addr];
      if (entry && entry.report) { entry.failed = true; entry.failedAt = Date.now(); delete entry.failedMsg; progress.textContent = 'Live refresh failed — showing the saved report.'; }
      else {
        progress.textContent = '';
        reportEl.innerHTML = '<p class="np-msg">⚠️ Couldn\'t read this wallet right now — the explorer may be busy. <button class="btn btn-sm btn-ghost trk-retry" type="button" data-retry>Try again</button></p>';
      }
    } finally {
      if (run === state.runId) setBusy(); // paints the banner (fresh / saved / warning) from the entry's state
    }
  }
  function postCache(addr, rep) {
    let body = rep;
    try {
      if (JSON.stringify(rep).length > 380 * 1024) { // server cap is 400 KB — trim trade tables (the UI shows 40 per token anyway)
        body = { ...rep, tokens: rep.tokens.map(t => ({ ...t, trades: (t.trades || []).slice(0, 40) })), trimmedForCache: true };
        if (JSON.stringify(body).length > 380 * 1024) return;
      }
    } catch { return; }
    api('/api/tracker/cache', { method: 'POST', body: { address: addr, report: body } }).catch(() => {});
  }
  refreshBtn.addEventListener('click', () => {
    if (!state.selected || state.inflight[state.selected]) return;
    const entry = state.reports[state.selected];
    if (entry) { delete entry.failed; delete entry.failedAt; delete entry.failedMsg; }
    say('Refreshing report');
    refresh(state.selected, ++state.runId);
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
    'Portfolio value': 'Everything the wallet holds in USD right now: its ETH plus every token that has a live market.',
    'ETH balance': 'The wallet\'s native ETH on Robinhood Chain — what it uses to pay gas and buy tokens.',
    'Unrealized PNL': 'Paper profit or loss on tokens still held: today\'s value minus what the wallet paid for them (average cost).',
    'Realized PNL': 'Profit or loss already locked in by selling: sale proceeds minus the average cost of what was sold.',
    'Avg entry': 'Average cost: the mean price paid per token in ETH across all buys. Tokens transferred in count as free, which pulls it down.',
    'Spent on buys': 'Total ETH this wallet paid into the pool when buying this token.',
    'Sell proceeds': 'Total ETH this wallet received from the pool when selling this token.',
    'Realized': 'Profit or loss locked in on this token by selling: proceeds minus the average cost of what was sold.',
    'Unrealized': 'Paper profit or loss on the amount still held: value today minus its average cost.',
    'Tokens traded': 'How many different tokens this wallet has bought or sold against a DEX pool (and how many are in profit overall).',
  };
  const HELD_DEF = 'How many of that token the wallet holds right now, read from the chain.';
  let infoSeq = 0;
  function decorateStats() {
    reportEl.querySelectorAll('.hstat').forEach(box => {
      if (box.querySelector('.trk-info')) return;
      const lbl = box.querySelector('.lbl'); if (!lbl) return;
      const key = lbl.textContent.trim();
      const def = DEFS[key]; if (!def) return;
      addInfo(box, lbl, key, def);
    });
    reportEl.querySelectorAll('.trk-h').forEach(h => {
      if (h.querySelector('.trk-info')) return;
      if (/Holdings/.test(h.textContent)) addInfo(h, h, 'Held', HELD_DEF);
    });
  }
  function addInfo(box, labelEl, key, def) {
    const id = 'trk-def-' + (++infoSeq);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'trk-info'; btn.textContent = 'ⓘ';
    btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', id);
    btn.setAttribute('aria-label', 'What is ' + key + '?');
    labelEl.appendChild(btn);
    const panel = document.createElement('p');
    panel.className = 'trk-info-panel'; panel.id = id; panel.hidden = true; panel.textContent = def;
    // when the label IS the box (an <h4>), the panel goes after it — a <p> inside a heading is invalid and would make
    // the definition part of the heading text for screen readers
    if (box === labelEl) box.insertAdjacentElement('afterend', panel); else box.appendChild(panel);
  }
  function toggleInfo(btn) {
    const open = btn.getAttribute('aria-expanded') === 'true';
    if (open) closeInfo(btn); else { btn.setAttribute('aria-expanded', 'true'); const p = reportEl.querySelector('#' + btn.getAttribute('aria-controls')); if (p) p.hidden = false; }
  }
  function closeInfo(btn) { btn.setAttribute('aria-expanded', 'false'); const p = reportEl.querySelector('#' + btn.getAttribute('aria-controls')); if (p) p.hidden = true; }
  // renderTracker re-renders itself (innerHTML) when a display toggle is clicked → re-attach the ⓘ buttons
  new MutationObserver(() => { if (!reportEl.querySelector('.trk-skel')) decorateStats(); }).observe(reportEl, { childList: true });

  /* ---------- signed-in / signed-out ---------- */
  function showSignedOut() {
    layout.hidden = true; signedOut.hidden = false;
    state.wallets = []; state.loaded = false; state.selected = null; state.runId++; state.refreshing = null; state.reports = {};
  }
  function showSignedIn() {
    signedOut.hidden = true; layout.hidden = false;
    state.prefs = (AUTH.user && AUTH.user.tracker_prefs) || null;
    loadWallets();
  }
  $('trk-signin').addEventListener('click', () => { if (window.AUTH) AUTH.open(); });
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
