/* ===== snapshots.js — on-chain holder snapshots for a community =====
 * Newest snapshot first, older ones browsable by tab. A finished snapshot never changes, so the
 * server marks it cacheable for a day and re-opening an old one is instant.
 *
 * The honesty rule this file exists to enforce: a snapshot that could not be read in full is NEVER
 * presented as a complete holder list. Partial snapshots say so, in plain words, above the table.
 * CSP-safe: addEventListener only, esc() before innerHTML. */
(function () {
  'use strict';
  const sec = document.getElementById('comm-snaps');
  if (!sec) return;
  const tabs = document.getElementById('snap-tabs');
  const body = document.getElementById('snap-body');
  const takeBtn = document.getElementById('snap-take');
  const statusEl = document.getElementById('snap-status');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = (t) => { if (window.announce) window.announce(t); };
  let CID = null, snaps = [], active = null, poll = 0;

  function cid() {
    if (CID) return CID;
    const q = new URLSearchParams(location.search).get('id');
    CID = q && /^\d+$/.test(q) ? q : null;
    return CID;
  }
  const shortAddr = (a) => a ? a.slice(0, 8) + '…' + a.slice(-6) : '';
  function when(ts) { try { return new Date(ts).toLocaleString(); } catch { return ''; } }

  // Format a raw uint256 balance into human units without floating point, which would lose precision
  // on 18-decimal balances. Integer part via BigInt division; two decimal places via the remainder.
  function human(raw, decimals) {
    try {
      const d = BigInt(10) ** BigInt(decimals || 18);
      const v = BigInt(raw);
      const whole = v / d;
      const frac = ((v % d) * 100n) / d;
      return whole.toLocaleString('en-US') + (whole < 1000n ? '.' + String(frac).padStart(2, '0') : '');
    } catch { return '—'; }
  }
  function pctOfSupply(raw, supply) {
    try {
      const s = BigInt(supply); if (s === 0n) return null;
      return Number((BigInt(raw) * 1000000n) / s) / 10000;
    } catch { return null; }
  }

  function renderTabs() {
    tabs.innerHTML = snaps.map((s, i) => {
      const on = active && s.id === active.id;
      const lbl = when(s.startedAt) + (s.status === 'complete' ? '' : ' · ' + s.status);
      return '<button class="snap-tab' + (on ? ' is-on' : '') + '" role="tab" type="button"' +
        ' aria-selected="' + (on ? 'true' : 'false') + '" tabindex="' + (on ? '0' : '-1') + '"' +
        ' data-sid="' + s.id + '">' + (i === 0 ? '🆕 ' : '') + esc(lbl) + '</button>';
    }).join('');
  }

  function renderSnap(s) {
    if (!s) { body.innerHTML = ''; return; }
    if (s.status === 'running') {
      body.innerHTML = '<p class="snap-running"><span class="np-live-dot" aria-hidden="true"></span> Reading the chain… this takes a moment for a token with many holders.</p>';
      return;
    }
    let warn = '';
    if (s.status !== 'complete') {
      warn = '<p class="snap-warn" role="status">⚠️ <b>This snapshot is incomplete.</b> ' + esc(s.reason || '') +
             ' It is shown as it was captured, not as a full holder list.</p>';
    }
    const rows = (s.holders || []).map(h => {
      const pct = pctOfSupply(h.value, s.totalSupply);
      return '<tr><td class="snap-rank">' + h.rank + '</td>' +
        '<td class="snap-addr"><code>' + esc(shortAddr(h.address)) + '</code>' +
        '<button class="copy-btn snap-copy" type="button" data-copy="' + esc(h.address) + '" aria-label="Copy address ' + esc(h.address) + '">📋</button></td>' +
        '<td class="snap-bal">' + esc(human(h.value, s.decimals)) + '</td>' +
        '<td class="snap-pct">' + (pct != null ? pct.toFixed(2) + '%' : '—') + '</td></tr>';
    }).join('');

    const shown = (s.holders || []).length;
    body.innerHTML = warn +
      '<div class="snap-meta">' +
        '<span><b>' + (s.holderCount || 0).toLocaleString('en-US') + '</b> holders</span>' +
        (s.expectedCount != null ? '<span>explorer reported <b>' + s.expectedCount.toLocaleString('en-US') + '</b></span>' : '') +
        '<span>taken <b>' + esc(when(s.startedAt)) + '</b></span>' +
        (s.symbol ? '<span>$' + esc(s.symbol) + '</span>' : '') +
      '</div>' +
      '<div class="snap-tablewrap">' +
        '<table class="snap-table"><caption class="sr-only">Holders of ' + esc(s.symbol || 'this token') +
          ' at ' + esc(when(s.startedAt)) + ', ranked by balance</caption>' +
        '<thead><tr><th scope="col">#</th><th scope="col">Address</th><th scope="col">Balance</th><th scope="col">Share of supply</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
      '</div>' +
      (shown < (s.total || 0)
        ? '<div class="snap-more-wrap"><button class="btn btn-ghost btn-sm" id="snap-more" type="button">Show more (' + shown + ' of ' + s.total.toLocaleString('en-US') + ')</button></div>'
        : '');
  }

  async function openSnap(sid, offset) {
    try {
      const j = await window.api('/api/communities/' + cid() + '/snapshots/' + sid + '?limit=100&offset=' + (offset || 0));
      const s = j.snapshot;
      if (offset && active && active.id === s.id) { active.holders = (active.holders || []).concat(s.holders || []); active.total = s.total; }
      else active = s;
      renderTabs(); renderSnap(active);
      if (active.status === 'running' && !poll) poll = setInterval(() => refresh(true), 4000);
      if (active.status !== 'running' && poll) { clearInterval(poll); poll = 0; }
    } catch (e) { body.innerHTML = '<p class="snap-warn">Could not load that snapshot.</p>'; }
  }

  async function refresh(quiet) {
    if (!cid()) return;
    try {
      const j = await window.api('/api/communities/' + cid() + '/snapshots');
      if (j.sandbox) { sec.hidden = true; return; }   // no token, nothing to snapshot — the section stays out of the sandbox
      snaps = j.snapshots || [];
      sec.hidden = false;
      const me = window.AUTH && AUTH.user;
      takeBtn.hidden = !me;
      if (!snaps.length) { tabs.innerHTML = ''; body.innerHTML = '<p class="snap-none">No snapshots yet. Take one to freeze the holder list at this moment.</p>'; return; }
      const keep = active ? snaps.find(s => s.id === active.id) : null;
      await openSnap((keep || snaps[0]).id, 0);      // newest first unless the reader picked another
    } catch { if (!quiet) sec.hidden = true; }
  }

  tabs.addEventListener('click', (e) => { const b = e.target.closest('.snap-tab'); if (b) openSnap(Number(b.dataset.sid), 0); });
  body.addEventListener('click', (e) => {
    const more = e.target.closest('#snap-more');
    if (more && active) { more.disabled = true; openSnap(active.id, (active.holders || []).length); }
  });

  takeBtn.addEventListener('click', async () => {
    takeBtn.disabled = true;
    statusEl.textContent = '📸 Reading the chain…';
    say('Taking a snapshot of the holder list.');
    try {
      await window.api('/api/communities/' + cid() + '/snapshots', { method: 'POST' });
      statusEl.textContent = 'Snapshot started — it will appear here when the walk finishes.';
      active = null;
      refresh();
    } catch (err) {
      statusEl.textContent = '⚠️ ' + (err.message || 'Could not start a snapshot');
      say('Snapshot not started. ' + (err.message || ''));
    } finally { takeBtn.disabled = false; }
  });

  document.addEventListener('auth:change', () => refresh(true));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => refresh()); else refresh();
})();
