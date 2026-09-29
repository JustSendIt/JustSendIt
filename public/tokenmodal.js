/* ===== Shared accessible token popup — the token's dashboard =====
 * Opens the token's dashboard (NPCard.dashboardHTML, the same view the Scanner page shows) inside a modal dialog.
 * API: window.TokenModal.open(tokenAddr, { symbol, name, pair, fallback }).  CSP-safe (addEventListener only, no inline JS).
 *   pair     — a pair object the caller already holds (a radar row, a watchlist row): drawn at once, no second read
 *   fallback — async (answer) => ({ pair, note }) | null, asked only when the live read has no pair (a call's
 *              call-time snapshot, so the detail of a delisted token never dead-ends)
 * Accessibility: role=dialog + aria-modal, labelled title, focus trap, Esc + backdrop + ✕ to close, focus restore. */
(function () {
  'use strict';
  var modal, dialog, body, titleEl, fullLink, releaseTrap = null, lastFocus = null, seq = 0, shown = null;   // shown: the pair the popup is showing (its ☆ saves this)

  function build() {
    modal = document.createElement('div');
    modal.id = 'token-modal';
    modal.className = 'tm-modal';
    modal.setAttribute('hidden', '');
    modal.innerHTML =
      '<div class="tm-backdrop" data-tm-close></div>' +
      '<div class="tm-dialog" role="dialog" aria-modal="true" aria-labelledby="tm-title">' +
        '<div class="tm-head">' +
          '<h2 id="tm-title" class="tm-title">Token dashboard</h2>' +
          // the same dashboard as its own page: a link somebody can keep or share (newpairs.html?scan=…)
          '<a class="btn btn-sm btn-ghost tm-full" href="/newpairs.html" data-tip="Opens this dashboard on its own page, with a link you can share" hidden>↗ Full page</a>' +
          '<button class="tm-x" type="button" data-tm-close data-tip="Closes this popup and returns you to the page" aria-label="Close token dashboard">✕</button>' +
        '</div>' +
        '<div class="tm-body" id="tm-body"></div>' +
      '</div>';
    document.body.appendChild(modal);
    dialog = modal.querySelector('.tm-dialog');
    body = modal.querySelector('#tm-body');
    titleEl = modal.querySelector('#tm-title');
    fullLink = modal.querySelector('.tm-full');
    modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-tm-close]')) { close(); return; }
      // the ☆ on the dashboard: saves the pair this popup shows (the watchlist script is not on every page)
      var w = e.target.closest('.np-watch[data-wpair]');
      if (w && shown && shown.pair && window.Watchlist && String(w.dataset.wpair).toLowerCase() === String(shown.pair.address).toLowerCase()) { e.preventDefault(); window.Watchlist.toggle(shown); }
    });
    modal.addEventListener('keydown', function (e) { if (e.key === 'Escape' || e.key === 'Esc') { e.stopPropagation(); close(); } });
  }

  function close() {
    if (!modal || modal.hasAttribute('hidden')) return;
    modal.setAttribute('hidden', '');
    if (window.unlockScroll) unlockScroll(); else document.body.style.overflow = '';
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    if (lastFocus) { try { lastFocus.focus(); } catch (e) {} }
    seq++; // invalidate any in-flight fetch so a late response can't paint into a closed/reused modal
  }

  // draw the dashboard for a pair; `note` is an optional line above it (a snapshot says it is one). A stored
  // snapshot can be missing fields a live read always has: a draw that throws says so instead of hanging on "Reading…"
  function paint(pair, note) {
    try { draw(pair, note); } catch (e) { shown = null; body.innerHTML = '<p class="tm-msg">Couldn’t draw this token’s detail — close and try again.</p>'; }
  }
  function draw(pair, note) {
    if (window.NPCard.dashboardHTML) {
      body.innerHTML = (note || '') + window.NPCard.dashboardHTML(pair, { level: 3 });
      window.NPCard.mountDashboard(body);
    } else {
      body.innerHTML = (note || '') + window.NPCard.detailHTML(pair);
      if (window.NPCard.animateRings) window.NPCard.animateRings(body);
      if (window.mountOnChainCharts) mountOnChainCharts(body);   // our own chart, not an embedded one
    }
    body.scrollTop = 0;
  }

  async function open(token, meta) {
    if (!modal) build();
    meta = meta || {};
    if (!modal.hasAttribute('hidden')) { if (releaseTrap) { releaseTrap(); releaseTrap = null; } } // re-open without close: release the old trap first
    else { lastFocus = document.activeElement; }                                                    // capture the external trigger only when opening from closed
    titleEl.textContent = (meta.name ? meta.name + ' ' : '') + (meta.symbol ? '$' + meta.symbol : '') || 'Token dashboard';
    if (token) { fullLink.href = '/newpairs.html?scan=' + encodeURIComponent(String(token).toLowerCase()); fullLink.hidden = false; } else fullLink.hidden = true;
    body.innerHTML = '<p class="tm-loading"><span class="np-live-dot" aria-hidden="true"></span> Reading the chain for the latest on-chain detail…</p>';
    modal.removeAttribute('hidden');
    if (window.lockScroll) lockScroll(); else document.body.style.overflow = 'hidden';
    releaseTrap = window.trapFocus ? window.trapFocus(dialog) : null;
    var xBtn = modal.querySelector('.tm-x'); if (xBtn) xBtn.focus(); // focus synchronously — the dialog is already un-hidden, so no Tab-escape window
    var my = ++seq;
    shown = null;
    if (!window.NPCard || !token) { body.innerHTML = '<p class="tm-msg">Full detail isn’t available here.</p>'; return; }
    // a caller that already holds this token's pair (a radar row, a saved watchlist row) gets it drawn at once
    if (meta.pair && meta.pair.token && meta.pair.pair && String(meta.pair.token.address).toLowerCase() === String(token).toLowerCase()) {
      shown = meta.pair; paint(meta.pair);
      return;
    }
    try {
      var r = await fetch('/api/pairs/lookup?token=' + encodeURIComponent(token), { credentials: 'same-origin' });
      var j = await r.json().catch(function () { return {}; });   // a 429/502 page is not JSON: still "we could not check", and a caller's snapshot may still answer
      if (my !== seq) return; // closed or superseded by another open()
      // 🏘️ Community card: the lookup already carries `community` (prime the shared cache so the slot fills instantly);
      // when it doesn't, tokentext.js resolves the slot with a single cached lookup.
      if (window.tokenCommunityPrime && j && Object.prototype.hasOwnProperty.call(j, 'community')) tokenCommunityPrime(token, j.community);
      if (r.ok && j.pair) { shown = j.pair; paint(j.pair); return; }
      // no live pair: a caller with a record of its own (a call's snapshot) is asked for it before we give up
      if (typeof meta.fallback === 'function') {
        var fb = null; try { fb = await meta.fallback(j); } catch (e) {}
        if (my !== seq) return;
        if (fb && fb.pair && fb.pair.token && fb.pair.pair) { shown = fb.pair; paint(fb.pair, fb.note); return; }
      }
      var sym = (j && j.pair && j.pair.token && j.pair.token.symbol) || meta.symbol || '';
      var comm = window.tokenCommunitySlot ? tokenCommunitySlot(token, sym, 'panel') : '';
      // "delisted or rugged" is a claim about someone's money. It is only said when the chain itself told us
      // there is no pool — never when we simply could not reach the price feed, which used to read the same.
      // The hard verdict requires the server to have actually SAID notFound. Every other non-OK answer — a 429,
      // a 502, a timeout, a busy 503 — is us failing to check, and must not be dressed up as a fact about the token.
      if (!r.ok || (j && j.unavailable)) { const m = document.createElement('p'); m.className = 'tm-msg'; m.textContent = '⏳ ' + ((j && (j.message || j.error)) || 'We couldn’t check this token just now — nothing here is a judgement about it. Try again in a moment.'); body.innerHTML = comm; body.insertAdjacentElement('afterbegin', m); }
      else if (j && j.notFound) body.innerHTML = '<p class="tm-msg">🤷 No trading pool exists for this token on Robinhood Chain — the chain itself says so, so there is nothing to price. It may never have launched, or its pool may be gone.</p>' + comm;
      else { const m = document.createElement('p'); m.className = 'tm-msg'; m.textContent = '⏳ We couldn’t read this token just now. Nothing here is a judgement about it — reopen in a moment.'; body.innerHTML = comm; body.insertAdjacentElement('afterbegin', m); }
      if (window.decorateTokenCommunities) decorateTokenCommunities(body);
    } catch (e) { if (my === seq) body.innerHTML = '<p class="tm-msg">Couldn’t load the detail — close and try again.</p>'; }
  }

  window.TokenModal = { open: open, close: close };
})();
