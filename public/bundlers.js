/* ===== bundlers.js — the "bundlers" panel, on every token detail on the site ==============================
   Owner, 2026-10-17: find the bundlers in a token — wallets that bought and moved tokens in the same block — say
   how many there are, how much they still hold against what they sold, their P&L, and let the reader open each one
   and see every wallet it has in the token, with what each holds and has sold.

   Like block0.js, the renderers emit ONE empty placeholder — <div class="np-bd" data-token="0x…"> — and this file
   fills it wherever it appears, including in markup inserted later, so every surface that shows a token's details
   (the Scanner dashboard and list, the token popup, the Hot Feed, the watchlist, walls, communities, squads) gets it.

   Everything comes from GET /api/token/bundlers, which reads the chain (server.js scanBundles, rules in
   lib/bundles.js). Nothing is estimated: a read that has not run says so, one that could not finish says why, and a
   figure that was not read is shown as "—", never as zero. Shares are of the token's total supply. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
  const big = (v) => { try { return v == null ? null : BigInt(v); } catch { return null; } };
  // a share of the supply: "—" when unread, "0%" when none, never a dust amount rounded to zero
  const share = (raw, supply) => { const r = big(raw), s = big(supply); if (r == null || !s) return null; const v = Number(r * 10000000n / s) / 100000; return v === 0 && r > 0n ? 1e-9 : v; };
  const pct = (n) => (n == null || !isFinite(n) ? '—' : n === 0 ? '0%' : n < 0.001 ? '&lt;0.001%' : (n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(3)) + '%');
  // an amount of the quote asset (WETH, USDG) with its sign as a word-free mark, plus the asset's name beside it
  const qty = (v, q, signed) => {
    const b = big(v); if (b == null) return '—';
    const n = Number(b) / Math.pow(10, (q && q.decimals) || 18), a = Math.abs(n);
    const s = a === 0 ? '0' : a >= 1000 ? a.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a >= 1 ? a.toFixed(3) : a >= 0.0001 ? a.toFixed(5) : '&lt;0.0001';
    return (signed ? (n > 0 ? '+' : n < 0 ? '−' : '') : '') + s;
  };
  // a gain or loss carries a sign and a word as well as a colour; exactly even is neither
  const pnlCls = (p) => (p == null ? '' : p > 0n ? 'b0-up' : p < 0n ? 'b0-down' : 'b0-flat');
  const pnlWord = (p) => (p == null ? '' : p > 0n ? 'up' : p < 0n ? 'down' : 'even');
  const when = (ms) => { try { return new Date(ms).toUTCString().replace(' GMT', ' UTC'); } catch { return ''; } };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

  const KIND = {
    block: { word: 'bought, then sent tokens on in the same block', tip: 'This wallet bought from the pool and, in that same block, sent tokens to other wallets' },
    tx: { word: 'bought and moved tokens in one transaction', tip: 'One transaction both bought from the pool and moved somebody’s own tokens — to another wallet, or into the pool as liquidity' },
    split: { word: 'split one buy across several wallets', tip: 'A contract took the pool’s tokens and handed them to two or more wallets inside the same transaction' },
  };
  const ROLE = { bought: 'bought in the bundle', received: 'was sent tokens', sent: 'sent tokens on', pooled: 'added them to the pool', split: 'split the buy' };

  function walletLi(w, d, X) {
    const sup = d.supply, ib = w.inBundle || {};
    const got = [];
    if (big(ib.bought) > 0n) got.push('took <b>' + pct(share(ib.bought, sup)) + '</b>');
    if (big(ib.received) > 0n) got.push('was sent <b>' + pct(share(ib.received, sup)) + '</b>');
    // what it moved: a contract's split, or tokens sent on — liquidity has its own line below, so it is not said twice
    const roles = w.roles || [];
    if (roles.includes('split')) got.push('split <b>' + pct(share(ib.moved, sup)) + '</b> between wallets');
    else if (roles.includes('sent') && big(ib.moved) > 0n) got.push('sent on <b>' + pct(share(ib.moved, sup)) + '</b>');
    const addr = X ? '<a class="bd-addr" href="' + esc(X + '/address/' + w.addr) + '" target="_blank" rel="noopener nofollow" title="' + esc(w.addr) + '">' + esc(short(w.addr)) + ' ↗</a>' : '<code class="bd-addr" title="' + esc(w.addr) + '">' + esc(short(w.addr)) + '</code>';
    return '<li class="bd-wl">' +
      '<div class="bd-wl-head">' + addr + '<span class="bd-roles">' + (w.roles || []).map((r) => esc(ROLE[r] || r)).join(' · ') + '</span></div>' +
      '<div class="bd-wl-stats">' +
        (got.length ? '<span>' + got.join(', ') + ' <i>of supply</i></span>' : '') +
        '<span>holds now <b>' + pct(share(w.holds, sup)) + '</b></span>' +
        '<span>sold to the pool <b>' + pct(share(w.sold, sup)) + '</b></span>' +
        (big(w.soldElsewhere) > 0n ? '<span>sold on another pool <b>' + pct(share(w.soldElsewhere, sup)) + '</b></span>' : '') +
        (big(w.sentOutside) > 0n ? '<span>sent to wallets outside the bundle <b>' + pct(share(w.sentOutside, sup)) + '</b></span>' : '') +
        (big(w.liquidity) > 0n ? '<span>added to the pool as liquidity <b>' + pct(share(w.liquidity, sup)) + '</b></span>' : '') +
      '</div></li>';
  }

  function bundlerLi(b, d, X) {
    const sup = d.supply, q = d.quote;
    const pnl = big(b.pnl);
    const txLinks = X ? (b.txs || []).slice(0, 3).map((h, i) => '<a href="' + esc(X + '/tx/' + h) + '" target="_blank" rel="noopener nofollow" title="' + esc(h) + '">transaction ' + (i + 1) + ' ↗</a>').join(' ') : '';
    return '<li class="bd-b">' +
      '<div class="bd-b-head"><b class="bd-b-n">Bundler ' + b.id + '</b>' +
        (b.kinds || []).map((k) => '<span class="bd-kind" title="' + esc((KIND[k] || {}).tip || '') + '">' + esc((KIND[k] || { word: k }).word) + '</span>').join('') + '</div>' +
      '<p class="bd-b-when">First seen in block ' + Number(b.firstBlock).toLocaleString('en-US') + (b.blockCount > 1 ? ', and in ' + plural(b.blockCount - 1, 'more block') : '') + '. ' + plural(b.wallets.length, 'wallet') + '.' + (txLinks ? ' ' + txLinks : '') + '</p>' +
      '<div class="bd-b-stats">' +
        '<span>took <b>' + pct(share(b.took, sup)) + '</b> <i>of supply in the bundle</i></span>' +
        '<span>still holds <b>' + pct(share(b.holds, sup)) + '</b></span>' +
        '<span>sold to the pool <b>' + pct(share(b.sold, sup)) + '</b></span>' +
        (big(b.soldElsewhere) > 0n ? '<span>sold on another pool <b>' + pct(share(b.soldElsewhere, sup)) + '</b></span>' : '') +
        (big(b.sentOutside) > 0n ? '<span>sent to other wallets <b>' + pct(share(b.sentOutside, sup)) + '</b></span>' : '') +
        '<span>P&amp;L <b class="' + pnlCls(pnl) + '">' + qty(b.pnl, q, true) + '</b> <i>' + esc(q.symbol) + (pnl == null ? '' : ' ' + pnlWord(pnl)) + '</i></span>' +
      '</div>' +
      '<details class="b0-conn bd-wallets"><summary data-tip="Opens the list of every wallet this bundler has in the token, with what each one holds now and has sold">All ' + plural(b.wallets.length, 'wallet') + ' — what each holds and sold</summary>' +
        '<ul class="bd-wl-list">' + b.wallets.map((w) => walletLi(w, d, X)).join('') + '</ul>' +
        '<p class="b0-fine">Paid ' + qty(b.cost, q) + ' ' + esc(q.symbol) + ' for its buys, got ' + qty(b.proceeds, q) + ' ' + esc(q.symbol) + ' back from its sales' +
          (b.unrealised != null ? ', and the tokens it still holds from its own buys are worth ' + qty(b.unrealised, q) + ' ' + esc(q.symbol) + ' at the pool’s price now' : '') + '.</p>' +
      '</details>' +
    '</li>';
  }

  function render(j) {
    if (!j) return '<p class="b0-msg b0-fail">No answer from the server.</p>';
    if (j.status === 'unknown') return '<p class="b0-msg">' + esc(j.message || 'No indexed pool for this token, so there are no buys to read.') + '</p>';
    if (!j.totals) {
      if (j.status === 'busy') return '<p class="b0-msg b0-wait">⏳ ' + esc(j.message || 'Many tokens are being read right now — this one is asked for again in a moment.') + '</p>';
      if (j.status === 'failed') return '<p class="b0-msg b0-fail">The chain could not be read for this token' + (j.reason ? ': ' + esc(j.reason) : '') + '. Nothing is assumed — this is not a pass.</p>';
      return '<p class="b0-msg b0-wait">⏳ ' + esc(j.message || 'Reading every buy and transfer of this token now — check back in a moment.') + '</p>';
    }
    const d = j, t = d.totals, q = d.quote || { symbol: 'WETH', decimals: 18 }, X = d.explorer || '';
    let html = '';
    if (j.refreshing) html += '<p class="b0-fine">⏳ A newer read is on its way; this one is from ' + esc(when(d.scannedAt)) + '.</p>';
    if (j.lastFailed) html += '<p class="b0-note">The latest read could not finish (' + esc(j.lastFailed) + '), so this is the one from ' + esc(when(d.scannedAt)) + '.</p>';
    if (!t.bundlers && d.fromBlock == null) {
      html += '<div class="b0-msg b0-good bd-none"><p class="bd-none-h">✔ No bundlers</p><p>This pool has never traded, so nobody has bought yet — there is nothing to bundle.</p></div>';
    } else if (!t.bundlers) {
      // the answer first, in words nobody can misread, then what it was read from
      html += '<div class="b0-msg b0-good bd-none"><p class="bd-none-h">✔ No bundlers</p>' +
        '<p>' + (d.capped ? 'In the part of this token’s history that could be read — ' : 'In ') + plural(d.buyTxs || 0, 'buy') + ' and ' + plural(d.transfers || 0, 'transfer') +
        (d.capped ? '' : ' since this pool first traded') + ' — no wallet bought and moved tokens in the same block. That is not the same as safe.</p></div>';
    } else {
      const pnl = big(t.pnl);
      html += '<p class="bd-lead"><b>' + plural(t.bundlers, 'bundler') + '</b> found, with <b>' + plural(t.wallets, 'wallet') + '</b> between them.</p>' +
        '<div class="b0-tiles">' +
          '<div class="b0-tile"><b>' + pct(share(t.took, d.supply)) + '</b><span>of supply they took in their bundles</span></div>' +
          '<div class="b0-tile"><b>' + pct(share(t.holds, d.supply)) + '</b><span>of supply they still hold</span></div>' +
          '<div class="b0-tile"><b>' + pct(share(t.sold, d.supply)) + '</b><span>of supply they sold to the pool</span></div>' +
          (big(t.sentOutside) > 0n ? '<div class="b0-tile"><b>' + pct(share(t.sentOutside, d.supply)) + '</b><span>sent to wallets outside their bundles</span></div>' : '') +
          '<div class="b0-tile"><b class="' + pnlCls(pnl) + '">' + qty(t.pnl, q, true) + '</b><span>their total P&amp;L, ' + esc(q.symbol) + (pnl == null ? '' : ' (' + pnlWord(pnl) + ')') + '</span></div>' +
        '</div>' +
        '<ul class="bd-list">' + d.bundlers.map((b) => bundlerLi(b, d, X)).join('') + '</ul>';
    }
    if (d.capped || (d.notes && d.notes.length)) html += '<p class="b0-note">' + esc((d.notes || []).join(' ') || 'This read hit a limit, so it may be incomplete.') + '</p>';
    html += '<p class="b0-fine">A bundler here is a wallet, or a transaction, that bought from the pool and moved tokens in the same block: a wallet that bought and sent tokens on to other wallets in that block, one transaction that bought and moved someone’s own tokens (to a wallet, or into the pool as liquidity), or a contract that split one buy across several wallets. A router that only carries a buy to the buyer, its fee wallet, and the token’s own tax are not bundlers. ' +
      (d.fromBlock == null ? 'The pool’s own history was read' : d.capped ? 'This read could not cover all of the token’s history (the note above says why); what it covers was read' : 'Every buy and transfer since this pool first traded was read') + (d.scannedAt ? ' on ' + esc(when(d.scannedAt)) : '') + '. P&amp;L is in ' + esc(q.symbol) + ', from the pool’s own trades: what the wallets got back from sales, plus what they still hold of their own buys at the pool’s price now, minus what they paid. Tokens they got elsewhere (another pool, a wallet outside the bundle) are not valued, and tokens sent to other wallets are not counted as sold. Entertainment only — not advice.</p>';
    return html;
  }

  /* One request per token, shared: the dashboard card's summary, its heading and the pop-down panel all answer from it, and
     a page showing the same token twice (a popup over the radar) asks once. Kept for 15 s, so a re-render does not re-ask. */
  const asked = new Map();     // token -> { at, p }
  function ask(token) {
    const k = token.toLowerCase(), hit = asked.get(k);
    if (hit && Date.now() - hit.at < 15000) return hit.p;
    const p = fetch('/api/token/bundlers?token=' + encodeURIComponent(k), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok || !j) { const e = new Error((j && j.error) || 'the server did not answer'); e.status = r.status; throw e; } return j; });
    asked.set(k, { at: Date.now(), p });
    p.catch(() => asked.delete(k));
    if (asked.size > 200) asked.delete(asked.keys().next().value);
    return p;
  }
  // the card's summary and heading for this token, wherever they are on the page, redrawn from the same answer
  function redrawCard(token, j) {
    const NP = window.NPCard;
    if (!NP || !NP.bundleSummaryHTML) return;
    const b = j && j.summary ? Object.assign({ status: j.refreshing ? 'refreshing' : j.status }, j.summary) : { status: j ? j.status : null, bundlers: null };
    const k = token.toLowerCase();
    document.querySelectorAll('.np-bd-sum[data-token]').forEach((el) => { if (el.getAttribute('data-token').toLowerCase() === k) el.innerHTML = NP.bundleSummaryHTML(b); });
    document.querySelectorAll('.np-bd-aside[data-token]').forEach((el) => { if (el.getAttribute('data-token').toLowerCase() === k) el.innerHTML = NP.bundleAsideHTML(b); });
  }

  const loading = new WeakSet();
  async function fill(el) {
    if (loading.has(el) || el.dataset.bdDone === '1') return;
    const token = el.getAttribute('data-token');
    if (!token) return;
    loading.add(el);
    if (!el.innerHTML) el.innerHTML = '<p class="b0-msg b0-wait">⏳ Reading every buy and transfer…</p>';
    const again = (ms) => { el.dataset.bdDone = ''; setTimeout(() => { loading.delete(el); if (el.isConnected) fill(el); }, ms); };
    try {
      const j = await ask(token);
      el.innerHTML = render(j);
      redrawCard(token, j);
      el.dataset.bdTries = '0';
      // a read in flight finishes in the background; look again shortly rather than leaving a stale answer
      if (j && (j.status === 'queued' || j.status === 'running' || j.status === 'busy' || j.refreshing)) return again(20000);
      el.dataset.bdDone = '1';
      loading.delete(el);
    } catch (e) {
      /* Refused (too many checks from this address at once) or unreachable: said so, and asked again with a growing
         wait — never left looking like a read that is under way, and never shown as "no bundlers". */
      const n = Math.min(4, Number(el.dataset.bdTries || 0) + 1);
      el.dataset.bdTries = String(n);
      el.innerHTML = '<p class="b0-msg b0-fail">' + (e && e.status === 429 ? 'Too many checks from here at once — trying again shortly.' : 'Could not reach the server for this check — trying again shortly.') + ' Nothing is assumed.</p>';
      again(15000 * Math.pow(2, n - 1));
    }
  }
  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.np-bd[data-token]').forEach((el) => { if (el.dataset.bdDone !== '1') fill(el); });
  }
  window.BUNDLERS = { render, mount: scan };
  if (typeof MutationObserver === 'function') {
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches('.np-bd[data-token]')) fill(n);
        else if (n.querySelectorAll) scan(n);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  document.addEventListener('DOMContentLoaded', () => scan(document));
  scan(document);
})();
