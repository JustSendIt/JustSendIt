/* ===== watch.js — shared watchlist client (used by the New Pairs feed/list + the Watchlist page) =====
 * Keeps a live Set of saved pair addresses so save-buttons render the right state, and provides
 * add/remove that hit /api/watchlist. CSP-safe (no inline JS). Dispatches watchlist:changed. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ids = new Set();
  let loaded = false;

  async function load() {
    try {
      const r = await fetch('/api/watchlist/ids', { credentials: 'same-origin' });
      if (!r.ok) return;
      const j = await r.json();
      ids.clear();
      (j.ids || []).forEach(a => ids.add(String(a).toLowerCase()));
      loaded = true;
      document.dispatchEvent(new CustomEvent('watchlist:changed'));
    } catch {}
  }
  const has = (pair) => ids.has(String(pair || '').toLowerCase());

  async function add(p) {
    const pair = p && p.pair && p.pair.address; if (!pair) return false;
    if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return false; } // signed-out → login (no optimistic flash)
    ids.add(pair.toLowerCase());                 // optimistic
    document.dispatchEvent(new CustomEvent('watchlist:changed'));
    try {
      const r = await fetch('/api/watchlist', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair, token: p.token && p.token.address, token0: (p.pair && p.pair.token0) || null, token1: (p.pair && p.pair.token1) || null,
          quoteSymbol: p.pair.quoteSymbol, symbol: p.token && p.token.symbol,
          snapshot: p,
        }),
      });
      if (!r.ok) { ids.delete(pair.toLowerCase()); document.dispatchEvent(new CustomEvent('watchlist:changed')); if (r.status === 401 && window.AUTH) AUTH.open(); return false; }
      const j = await r.json().catch(() => ({}));
      if (window.sendToast) sendToast('⭐ Saved to your watchlist');
      if (window.showPoints && j.pointsEarned > 0) showPoints(j.pointsEarned);  // +N pop, nav badge, notif refresh
      return true;
    } catch { ids.delete(pair.toLowerCase()); document.dispatchEvent(new CustomEvent('watchlist:changed')); return false; }
  }
  async function remove(pair) {
    pair = String(pair || ''); if (!pair) return false;
    ids.delete(pair.toLowerCase());              // optimistic
    document.dispatchEvent(new CustomEvent('watchlist:changed'));
    // the mirror of add(): a failed DELETE puts the id back and says so, or the star goes hollow for a pair the
    // server still has saved and the next tap sends an add for a row that was never removed
    const revert = () => { ids.add(pair.toLowerCase()); document.dispatchEvent(new CustomEvent('watchlist:changed')); };
    try {
      const r = await fetch('/api/watchlist', { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pair }) });
      if (!r.ok) { revert(); if (r.status === 401 && window.AUTH) AUTH.open(); else if (window.sendToast) sendToast('Could not remove — try again'); return false; }
      if (window.sendToast) sendToast('Removed from watchlist');
      return true;
    } catch { revert(); if (window.sendToast) sendToast('Could not remove — try again'); return false; }
  }
  function toggle(p) { return has(p.pair.address) ? remove(p.pair.address) : add(p); }

  // save-button markup — a ☆/★ toggle; state comes from the live set
  /* `withLabel` renders the same control with words beside the star, for the action bar at the foot of a
     token's full detail. It is the SAME button — same class, same data-wpair, same aria-pressed — so
     syncButtons() keeps every copy on the page in step without knowing which form it is looking at. */
  function btnHTML(p, extraCls, withLabel) {
    const on = has(p.pair.address);
    const label = on ? 'In your watchlist' : 'Save to watchlist';
    return '<button class="np-watch' + (extraCls ? ' ' + extraCls : '') + (on ? ' is-on' : '') + '" type="button" data-wpair="' + esc(p.pair.address) + '" aria-pressed="' + on + '" aria-label="' + (on ? 'Remove from watchlist' : 'Save to watchlist') + '"' + (withLabel ? '' : ' title="' + label + '"') + ' data-tip="Saves this token to your watchlist, or takes it off">' + (on ? '★' : '☆') + (withLabel ? ' <span class="np-watch-lbl">' + label + '</span>' : '') + '</button>';
  }
  // refresh every rendered save-button on the page to match the current set
  function syncButtons(root) {
    (root || document).querySelectorAll('.np-watch[data-wpair]').forEach(b => {
      const on = has(b.dataset.wpair);
      const lbl = b.querySelector('.np-watch-lbl');
      if (lbl) lbl.textContent = on ? 'In your watchlist' : 'Save to watchlist';
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Remove from watchlist' : 'Save to watchlist');
      b.setAttribute('title', on ? 'In your watchlist' : 'Save to watchlist');
      // the star is the first text node; writing textContent here would erase the label span just refreshed above
      if (lbl && b.firstChild && b.firstChild.nodeType === 3) b.firstChild.nodeValue = (on ? '★' : '☆') + ' ';
      else b.textContent = on ? '★' : '☆';
    });
  }
  document.addEventListener('watchlist:changed', () => syncButtons());

  window.Watchlist = { load, has, add, remove, toggle, btnHTML, syncButtons, ids };

  // load once we know who the user is
  if (window.AUTH && AUTH.ready) AUTH.ready.then(() => { if (AUTH.user) load(); });
  document.addEventListener('auth:change', e => { if (e && e.detail) load(); else { ids.clear(); document.dispatchEvent(new CustomEvent('watchlist:changed')); } });
})();
