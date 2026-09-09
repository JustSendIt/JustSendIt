/* ===== Shared accessible token-detail popup =====
 * Opens the full on-chain detail (the same NPCard the Live New Pairs page renders) inside a modal dialog.
 * API: window.TokenModal.open(tokenAddr, { symbol, name }).  CSP-safe (addEventListener only, no inline JS).
 * Accessibility: role=dialog + aria-modal, labelled title, focus trap, Esc + backdrop + ✕ to close, focus restore. */
(function () {
  'use strict';
  var modal, dialog, body, titleEl, releaseTrap = null, lastFocus = null, seq = 0;

  function build() {
    modal = document.createElement('div');
    modal.id = 'token-modal';
    modal.className = 'tm-modal';
    modal.setAttribute('hidden', '');
    modal.innerHTML =
      '<div class="tm-backdrop" data-tm-close></div>' +
      '<div class="tm-dialog" role="dialog" aria-modal="true" aria-labelledby="tm-title">' +
        '<div class="tm-head">' +
          '<h2 id="tm-title" class="tm-title">Token detail</h2>' +
          '<button class="tm-x" type="button" data-tm-close aria-label="Close token detail">✕</button>' +
        '</div>' +
        '<div class="tm-body" id="tm-body"></div>' +
      '</div>';
    document.body.appendChild(modal);
    dialog = modal.querySelector('.tm-dialog');
    body = modal.querySelector('#tm-body');
    titleEl = modal.querySelector('#tm-title');
    modal.addEventListener('click', function (e) { if (e.target.closest('[data-tm-close]')) close(); });
    modal.addEventListener('keydown', function (e) { if (e.key === 'Escape' || e.key === 'Esc') { e.stopPropagation(); close(); } });
  }

  function close() {
    if (!modal || modal.hasAttribute('hidden')) return;
    modal.setAttribute('hidden', '');
    document.body.style.overflow = '';
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    if (lastFocus) { try { lastFocus.focus(); } catch (e) {} }
    seq++; // invalidate any in-flight fetch so a late response can't paint into a closed/reused modal
  }

  async function open(token, meta) {
    if (!modal) build();
    meta = meta || {};
    if (!modal.hasAttribute('hidden')) { if (releaseTrap) { releaseTrap(); releaseTrap = null; } } // re-open without close: release the old trap first
    else { lastFocus = document.activeElement; }                                                    // capture the external trigger only when opening from closed
    titleEl.textContent = (meta.name ? meta.name + ' ' : '') + (meta.symbol ? '$' + meta.symbol : '') || 'Token detail';
    body.innerHTML = '<p class="tm-loading"><span class="np-live-dot" aria-hidden="true"></span> Reading the chain for the latest on-chain detail…</p>';
    modal.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    releaseTrap = window.trapFocus ? window.trapFocus(dialog) : null;
    var xBtn = modal.querySelector('.tm-x'); if (xBtn) xBtn.focus(); // focus synchronously — the dialog is already un-hidden, so no Tab-escape window
    var my = ++seq;
    if (!window.NPCard || !token) { body.innerHTML = '<p class="tm-msg">Full detail isn’t available here.</p>'; return; }
    try {
      var r = await fetch('/api/pairs/lookup?token=' + encodeURIComponent(token), { credentials: 'same-origin' });
      var j = await r.json();
      if (my !== seq) return; // closed or superseded by another open()
      var sym = (r.ok && j.pair && j.pair.token && j.pair.token.symbol) || meta.symbol || '';
      // 🏘️ Community section: the lookup already carries `community` (prime the shared cache so the slot fills instantly);
      // when it doesn't, tokentext.js resolves the slot with a single cached lookup.
      if (window.tokenCommunityPrime && j && Object.prototype.hasOwnProperty.call(j, 'community')) tokenCommunityPrime(token, j.community);
      var comm = window.tokenCommunitySlot ? tokenCommunitySlot(token, sym, 'panel') : '';
      if (r.ok && j.pair) {
        body.innerHTML = window.NPCard.detailHTML(j.pair);
        var honest = body.querySelector('.np-honest'); // sit inside the detail, just above its closing honesty note
        if (honest) honest.insertAdjacentHTML('beforebegin', comm); else body.insertAdjacentHTML('beforeend', comm);
        if (window.NPCard.animateRings) window.NPCard.animateRings(body);
        if (window.mountOnChainCharts) mountOnChainCharts(body);   // our own chart, not an embedded one
      }
      // "delisted or rugged" is a claim about someone's money. It is only said when the chain itself told us
      // there is no pool — never when we simply could not reach the price feed, which used to read the same.
      else if (j && j.unavailable) { const m = document.createElement('p'); m.className = 'tm-msg'; m.textContent = '⏳ ' + (j.message || 'We couldn’t check this token just now — nothing here is a judgement about it. Try again in a moment.'); body.innerHTML = comm; body.insertAdjacentElement('afterbegin', m); }
      else body.innerHTML = '<p class="tm-msg">🤷 No trading pool exists for this token on Robinhood Chain — the chain itself says so, so there is nothing to price. It may never have launched, or its pool may be gone.</p>' + comm;
      if (window.decorateTokenCommunities) decorateTokenCommunities(body);
    } catch (e) { if (my === seq) body.innerHTML = '<p class="tm-msg">Couldn’t load the detail — close and try again.</p>'; }
  }

  window.TokenModal = { open: open, close: close };
})();
