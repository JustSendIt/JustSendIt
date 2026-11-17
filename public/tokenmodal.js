/* ===== Shared accessible token popup — the token's dashboard =====
 * Opens the token's dashboard (NPCard.dashboardHTML, the same view the Scanner page shows) inside a modal dialog.
 * API: window.TokenModal.open(tokenAddr, { symbol, name, pair, fallback, chain, note }).  CSP-safe (addEventListener only, no inline JS).
 *   pair     — a pair object the caller already holds (a radar row, a watchlist row): drawn at once, no second read
 *   fallback — async (answer) => ({ pair, note }) | null, asked only when the live read has no pair (a call's
 *              call-time snapshot, so the detail of a delisted token never dead-ends)
 *   chain    — 'robinhood' (the default), 'ethereum' or 'solana' (the chains the Scanner reads, lib/multichain.js). Another chain's
 *              token is read QUIETLY through /api/market/scan (owner, 2026-11-17: a coin pressed on the Market Data page shows its
 *              on-chain data "like it does everywhere else"): nothing is added to the Scanner's public "recently scanned" list, and
 *              the dashboard hides what only the home chain has (Watch, Send Call, pins) and says why
 *   note     — an optional line of plain text above the dashboard (where the caller's own figures came from)
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
          // the same dashboard as its own page: a link somebody can keep or share (/newpairs?scan=…)
          '<a class="btn btn-sm btn-ghost tm-full" href="/newpairs" data-tip="Opens this dashboard on its own page, with a link you can share" hidden>↗ Full page</a>' +
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
      if (e.target.closest('[data-tm-close]')) { if (window.SFX) SFX.play('close'); close(); return; }   // the ✕ or the backdrop
      // the ☆ on the dashboard: saves the pair this popup shows (the watchlist script is not on every page)
      var w = e.target.closest('.np-watch[data-wpair]');
      if (w && shown && shown.pair && window.Watchlist && String(w.dataset.wpair).toLowerCase() === String(shown.pair.address).toLowerCase()) { e.preventDefault(); window.Watchlist.toggle(shown); }
    });
    modal.addEventListener('keydown', function (e) { if (e.key === 'Escape' || e.key === 'Esc') { e.stopPropagation(); if (window.SFX) SFX.play('close'); close(); } });
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
  const noteHTML = (t) => (t ? '<p class="tm-lead">' + String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) + '</p>' : '');
  const SCAN_CHAINS = ['robinhood', 'ethereum', 'solana'];
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
    if (modal.hasAttribute('hidden') && window.SFX) SFX.play('open');   // every opener is a tap on a token; a re-open in place stays quiet
    if (!modal.hasAttribute('hidden')) { if (releaseTrap) { releaseTrap(); releaseTrap = null; } } // re-open without close: release the old trap first
    else { lastFocus = document.activeElement; }                                                    // capture the external trigger only when opening from closed
    titleEl.textContent = (meta.name ? meta.name + ' ' : '') + (meta.symbol ? '$' + meta.symbol : '') || 'Token dashboard';
    // the chain: a Solana address is only ever Solana's; a 0x one is the home chain's unless the caller names Ethereum
    var chain = SCAN_CHAINS.indexOf(meta.chain) >= 0 ? meta.chain : (/^0x/i.test(String(token || '')) ? 'robinhood' : 'solana');
    var addr = /^0x/i.test(String(token || '')) ? String(token).toLowerCase() : String(token || '');   // a Solana address is case-sensitive
    if (token) { fullLink.href = '/newpairs?scan=' + encodeURIComponent(addr) + (chain !== 'robinhood' ? '&chain=' + encodeURIComponent(chain) : ''); fullLink.hidden = false; } else fullLink.hidden = true;
    var lead = noteHTML(meta.note);
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
    // another chain the Scanner reads: its quiet read, the same profile the Scanner page draws
    if (chain !== 'robinhood') {
      try {
        var rs = await fetch('/api/market/scan?chain=' + encodeURIComponent(chain) + '&address=' + encodeURIComponent(addr), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        var js = await rs.json().catch(function () { return {}; });
        if (my !== seq) return;
        var sp = js && js.pair;
        if (rs.ok && sp && sp.token && sp.pair) { if (!sp.chain) sp.chain = js.chain || chain; shown = sp; paint(sp, lead); return; }
        // the server's own words: a base trading asset, nothing found, or the feed could not be reached — never a verdict it did not give
        var said = (js && (js.message || js.error)) || (rs.ok ? 'This token could not be read just now — nothing here is a judgement about it. Try again in a moment.' : 'We couldn’t check this token just now — nothing here is a judgement about it. Try again in a moment.');
        body.innerHTML = lead; var mm = document.createElement('p'); mm.className = 'tm-msg'; mm.textContent = ((js && js.notFound) ? '🤷 ' : '⏳ ') + said; body.appendChild(mm);
      } catch (e) { if (my === seq) body.innerHTML = lead + '<p class="tm-msg">Couldn’t load the detail — close and try again.</p>'; }
      return;
    }
    try {
      var r = await fetch('/api/pairs/lookup?token=' + encodeURIComponent(token), { credentials: 'same-origin' });
      var j = await r.json().catch(function () { return {}; });   // a 429/502 page is not JSON: still "we could not check", and a caller's snapshot may still answer
      if (my !== seq) return; // closed or superseded by another open()
      // 🏘️ Community card: the lookup already carries `community` (prime the shared cache so the slot fills instantly);
      // when it doesn't, tokentext.js resolves the slot with a single cached lookup.
      if (window.tokenCommunityPrime && j && Object.prototype.hasOwnProperty.call(j, 'community')) tokenCommunityPrime(token, j.community);
      if (r.ok && j.pair) { shown = j.pair; paint(j.pair, lead); return; }
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
