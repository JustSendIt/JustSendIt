/* ===== block0.js — the "first buyers" panel, on every token detail on the site ==========================
   A token's expanded detail is rendered in two different places (public/newpairs.js for the New Pairs list,
   the Hot Feed and the token popup; public/watchlist.js for the saved-tokens page). Rather than write this
   twice, both of them emit ONE empty placeholder — <div class="np-b0" data-token="0x…"> — and this file
   fills it in wherever it appears, including in markup inserted later. So the panel shows up anywhere a
   token detail can be opened, and a future surface gets it by emitting the same div.

   Everything shown here comes from GET /api/token/snipers, which reads the chain. Nothing is estimated: a
   scan that has not run yet says so, a scan that could not finish says why, and no number is shown for a
   value that was not read. The percentages are given against BOTH the total supply and the float actually
   in circulation, because a token that keeps most of its supply in the pool flatters itself on the former. */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = a => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
  const pct = n => (n == null || !isFinite(n)) ? '—' : (n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(3)) + '%';
  const weth = w => { if (w == null) return '—'; const n = Number(BigInt(w)) / 1e18; return (n >= 0 ? '' : '−') + Math.abs(n).toFixed(Math.abs(n) >= 1 ? 3 : 5); };
  const signedWeth = w => { if (w == null) return '—'; const n = Number(BigInt(w)) / 1e18; return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(Math.abs(n) >= 1 ? 3 : 5); };
  const when = ms => { try { return new Date(ms).toUTCString().replace(' GMT', ' UTC'); } catch { return ''; } };
  const share = (raw, total) => (raw == null || !total) ? null : Number(BigInt(raw)) / Number(BigInt(total)) * 100;

  const NET = {
    accumulator: { cls: 'b0-acc', word: 'net accumulator', why: 'still holds at least everything it took in block 0' },
    seller:      { cls: 'b0-sell', word: 'net seller', why: 'holds less than it took in block 0' },
    'fully out': { cls: 'b0-out', word: 'fully out', why: 'holds none of it any more' },
    unknown:     { cls: 'b0-unk', word: 'not readable', why: 'at least one balance could not be read' },
  };

  function walletRow(s, supply, float) {
    const n = NET[s.net] || NET.unknown;
    const conn = (s.connected || []).slice(0, 8);
    return '<li class="b0-w">' +
      '<div class="b0-w-head">' +
        '<code class="b0-addr" title="' + esc(s.addr) + '">' + esc(short(s.addr)) + '</code>' +
        '<span class="b0-tag ' + n.cls + '" title="' + esc(n.why) + '">' + n.word + '</span>' +
      '</div>' +
      '<div class="b0-w-stats">' +
        '<span>sniped <b>' + pct(share(s.sniped, supply)) + '</b> <i>of supply</i></span>' +
        '<span>holds now <b>' + (s.clusterHolds == null ? '—' : pct(share(s.clusterHolds, supply))) + '</b></span>' +
        '<span>sold to the pool <b>' + pct(share(s.clusterSold, supply)) + '</b></span>' +
        '<span>PNL <b class="' + (s.pnlWei == null ? '' : Number(BigInt(s.pnlWei)) >= 0 ? 'b0-up' : 'b0-down') + '">' + signedWeth(s.pnlWei) + '</b> <i>WETH</i></span>' +
      '</div>' +
      (s.connectedCount
        ? '<details class="b0-conn"><summary>' + s.connectedCount + ' wallet' + (s.connectedCount === 1 ? '' : 's') + ' it moved tokens to</summary><ul>' +
            conn.map(c => '<li><code title="' + esc(c.addr) + '">' + esc(short(c.addr)) + '</code>' +
              '<span>hop ' + c.hop + '</span>' +
              '<span>holds <b>' + (c.holds == null ? '—' : pct(share(c.holds, supply))) + '</b></span>' +
              '<span>sold <b>' + pct(share(c.soldToPool, supply)) + '</b></span></li>').join('') +
            (s.connectedCount > conn.length ? '<li class="b0-more">…and ' + (s.connectedCount - conn.length) + ' more</li>' : '') +
          '</ul></details>'
        : '<p class="b0-none">Sent tokens to no other wallet.</p>') +
      (s.capped ? '<p class="b0-note">This cluster hit a read limit, so it may be larger than shown.</p>' : '') +
    '</li>';
  }

  function render(d) {
    if (!d) return '<p class="b0-msg">Could not read the first block for this token.</p>';
    if (d.status === 'queued' || d.status === 'running' || d.status === 'unscanned') {
      return '<p class="b0-msg b0-wait">⏳ Reading the first block this pool ever traded — check back in a moment. Nothing is guessed at while it is unknown.</p>';
    }
    if (d.status === 'unknown') return '<p class="b0-msg">' + esc(d.message || 'No indexed pool for this token, so there is no first block to read.') + '</p>';
    if (d.status === 'failed') return '<p class="b0-msg b0-fail">⚠️ The chain could not be read for this token' + (d.reason ? ' — ' + esc(d.reason) : '') + '. It will be retried; nothing is assumed in the meantime.</p>';
    if (d.block0 == null) return '<p class="b0-msg">This pool has never paid a token out — nobody has bought yet.</p>';

    const t = d.totals || {}, v = d.verdict || {};
    const supply = d.supply, float = d.float;
    const snipedSupply = share(t.sniped, supply), snipedFloat = share(t.sniped, float);
    const holdsSupply = t.holdsKnown ? share(t.holds, supply) : null;
    const verdict = t.wallets === 0
      ? { cls: 'b0-acc', word: 'Nobody sniped block 0' }
      : v.ok === true ? { cls: 'b0-acc', word: 'Block 0 is clean' }
      : v.ok === false ? { cls: 'b0-sell', word: 'Block-0 snipers sold' }
      : { cls: 'b0-unk', word: 'Not fully readable' };

    let html = '<div class="b0-head">' +
      '<span class="b0-verdict ' + verdict.cls + '">' + verdict.word + '</span>' +
      '<span class="b0-block">Block <b>' + Number(d.block0).toLocaleString('en-US') + '</b> · ' + esc(when(d.block0At)) + '</span>' +
    '</div>';

    html += '<div class="b0-tiles">' +
      '<div class="b0-tile"><b>' + t.wallets + '</b><span>wallet' + (t.wallets === 1 ? '' : 's') + ' bought in block 0</span></div>' +
      '<div class="b0-tile"><b>' + pct(snipedSupply) + '</b><span>of total supply they took</span></div>' +
      '<div class="b0-tile"><b>' + pct(snipedFloat) + '</b><span>of the circulating float</span></div>' +
      '<div class="b0-tile"><b>' + (holdsSupply == null ? '—' : pct(holdsSupply)) + '</b><span>they still hold today</span></div>' +
      '<div class="b0-tile"><b>' + t.connectedWallets + '</b><span>wallet' + (t.connectedWallets === 1 ? '' : 's') + ' they moved tokens to</span></div>' +
      '<div class="b0-tile"><b class="' + (t.netSellers ? 'b0-down' : 'b0-up') + '">' + t.netAccumulators + ' / ' + t.netSellers + '</b><span>accumulators / sellers</span></div>' +
    '</div>';

    if (t.wallets > 0) {
      html += '<div class="b0-ledger">' +
        '<h4>Money in and out, across every one of those wallets</h4>' +
        '<div class="b0-led-row">' +
          '<span>cost basis <b>' + weth(t.costWei) + '</b> WETH</span>' +
          '<span>received selling <b>' + weth(t.proceedsWei) + '</b></span>' +
          '<span>still holding <b>' + weth(t.unrealisedWei) + '</b></span>' +
          '<span class="b0-pnl">total P&amp;L <b class="' + (Number(BigInt(t.pnlWei || '0')) >= 0 ? 'b0-up' : 'b0-down') + '">' + signedWeth(t.pnlWei) + ' WETH</b></span>' +
        '</div>' +
        '<p class="b0-fine">Read from the WETH side of the very transactions these wallets\' tokens moved in — exact, and in the pool\'s own quote asset, so no historical dollar price is invented. “Still holding” values what they hold now at the pool\'s current price. These totals cover <b>everything these wallets did through this pool</b>, so they can exceed the block-0 amount if a wallet bought more later.</p>' +
      '</div>';
      html += '<ul class="b0-wallets">' + d.snipers.map(s => walletRow(s, supply, float)).join('') + '</ul>';
    } else {
      html += '<p class="b0-msg b0-good">No wallet bought this token in the first block its pool traded.</p>';
    }

    if (Number(d.systemTook || 0) > 0) {
      html += '<p class="b0-fine">' + pct(share(d.systemTook, supply)) + ' of supply went to the token\'s own contract or other plumbing in that block — a transfer tax, not a buyer, so it is not counted as a sniper.</p>';
    }
    if (d.capped || (d.notes && d.notes.length)) {
      html += '<p class="b0-note">' + esc((d.notes || []).join(' ') || 'This scan hit a read limit, so it may be incomplete.') + '</p>';
    }
    html += '<p class="b0-fine">Block 0 is the first block this pool ever paid a token out — the first moment anyone could buy. Each buyer is followed as a cluster: the wallet, everyone it sent tokens to, and everyone they sent to. Read from the chain' + (d.scannedAt ? ' ' + esc(when(d.scannedAt)) : '') + '.</p>';
    return html;
  }

  const loading = new WeakSet();
  async function fill(el) {
    if (loading.has(el) || el.dataset.b0Done === '1') return;
    const token = el.getAttribute('data-token');
    if (!token) return;
    loading.add(el);
    el.innerHTML = '<p class="b0-msg b0-wait">⏳ Reading the first block…</p>';
    try {
      const r = await fetch('/api/token/snipers?token=' + encodeURIComponent(token), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const j = await r.json();
      el.innerHTML = render(j);
      // a scan in flight finishes in the background; look again shortly rather than leaving a stale "reading…"
      if (j && (j.status === 'queued' || j.status === 'running')) {
        el.dataset.b0Done = '';
        setTimeout(() => { loading.delete(el); if (el.isConnected) fill(el); }, 20000);
        return;
      }
      el.dataset.b0Done = '1';
    } catch {
      el.innerHTML = '<p class="b0-msg b0-fail">Could not reach the server for this check. Nothing is assumed — reopen to try again.</p>';
    } finally { loading.delete(el); }
  }

  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.np-b0[data-token]').forEach(el => { if (el.dataset.b0Done !== '1') fill(el); });
  }
  window.mountBlock0 = scan;

  // Panels arrive whenever a detail is expanded, in markup inserted by several different files. One observer
  // catches every one of them, so no renderer has to remember to call anything.
  if (typeof MutationObserver === 'function') {
    new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches('.np-b0[data-token]')) fill(n);
        else if (n.querySelectorAll) scan(n);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  document.addEventListener('DOMContentLoaded', () => scan(document));
  scan(document);
})();
