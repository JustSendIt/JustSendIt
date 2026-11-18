/* ===== The top gainers strip, under the nav on every page =========================================================
   Owner, 2026-11-17: "Have the top 10 market movers within the top 100 top tokens in the bubble maps be a moving banner showing the
   token the price and percentage move" — then, the same day: "on the market data banner, only show positive percentage gains" and
   "Also add that as a sticky banner to every page on the site".
   GET /api/market/movers answers the ten coins among CoinGecko's 100 largest that rose most over 24 hours (only coins that went up —
   fewer on a day fewer did), worked out by the server from the bubble map's own read (lib/marketmap.js moversOf); no vendor is asked
   for it, so every page reading it costs the server a cached answer, not a request upstream. The strip sits right under the sticky
   nav and sticks with it; nav.js counts its height into --nav-h, so a page's own sticky bars (Top tokens' controls, the dashboard
   tabs, the Scanner's view switch) still clear both.
   A coin opens its on-chain data: on /market the page's own popup or card (market.js listens for movers:open); anywhere else the link
   goes to /market?coin=<id>, which opens it there. The strip moves only where motion is wanted: it stops for a pointer or the
   keyboard, and under ⏸ (html.motion-off) and the reduced-motion setting it is a row that scrolls by hand (styles.css). It says
   nothing when the coins have not been read or could not be read — a strip of errors on every page helps nobody; /market says why. */
(function () {
  'use strict';
  const nav = document.querySelector('body > nav.nav');
  if (!nav || document.getElementById('mv-strip')) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const onMarket = () => /^\/market(\.html)?$/.test(location.pathname);
  /* the words for numbers, as market.js writes them (its @lift:words block): a price to four significant figures, tiny prices with a
     subscript zero count, the move with its arrow and sign (the arrow and the sign carry it, not the colour) */
  const SUBS = '₀₁₂₃₄₅₆₇₈₉';
  const trimZ = (s) => s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const sig = (x) => trimZ(x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2));
  function tiny(a) {
    const e = Math.floor(Math.log10(a)), zeros = -e - 1;
    if (zeros < 4) return trimZ(a.toPrecision(4));
    const digits = String(Math.round(a * Math.pow(10, -e + 3))).replace(/0+$/, '') || '0';
    return '0.0' + String(zeros).split('').map((d) => SUBS[+d]).join('') + digits;
  }
  function usd(v) {
    if (v == null || !isFinite(v)) return null;
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1000) return s + '$' + Math.round(a).toLocaleString('en-US');
    if (a >= 1) return s + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: a < 100 ? 2 : 0 });
    if (a === 0) return '$0';
    return s + '$' + tiny(a);
  }
  function pct(v) {
    if (v == null || !isFinite(v)) return null;
    const a = Math.abs(v), t = a.toFixed(a < 10 ? 2 : 1) + '%';
    return v > 0 ? '▲ +' + t : v < 0 ? '▼ −' + t : '0.00%';
  }
  const val = (f) => (f && typeof f === 'object' && typeof f.v === 'number' && isFinite(f.v) ? f.v : null);
  const ownLogo = (logo) => typeof logo === 'string' && /^\/api\/[\w/.-]+(\?[^"'<>\s]*)?$/.test(logo);
  const nameOf = (r) => r.name || r.symbol || r.id;

  const strip = document.createElement('section');
  strip.className = 'mv-strip'; strip.id = 'mv-strip';   // shown from the start, so the page does not jump down when the coins arrive
  strip.setAttribute('aria-labelledby', 'mv-strip-h');
  strip.innerHTML = '<a class="mv-strip-h" id="mv-strip-h" href="/market" data-tip="Opens Market Data: the biggest 24 h rises among CoinGecko’s 100 largest coins, the whole market and every chain. Not advice, never a tip to buy.">' +
    '<span class="mv-strip-t">📈 Top gainers</span><span class="mv-strip-sub">24 h · top 100</span></a><div class="mv-strip-win" id="mv-strip-win"><p class="mv-none">Reading the top gainers…</p></div>';
  nav.insertAdjacentElement('afterend', strip);
  const win = strip.querySelector('#mv-strip-win');
  const changed = () => document.dispatchEvent(new CustomEvent('mvstrip:change'));   // nav.js counts the strip into --nav-h
  changed();

  const S = { ans: null, at: 0, timer: 0 };
  const EVERY = 5 * 60e3;
  async function load() {
    let j = null;
    try {
      const r = await fetch('/api/market/movers', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (r.ok) j = await r.json();
    } catch {}
    if (j && Array.isArray(j.rows)) { S.ans = j; S.at = Date.now(); S.failed = false; } else S.failed = true;   // a read that failed keeps what it had (it says how old it is in the link's tip)
    paint();
    document.dispatchEvent(new CustomEvent('movers:data', { detail: S.ans }));   // market.js's tiles read the same answer
    plan();
  }
  function plan() {
    clearTimeout(S.timer);
    S.timer = setTimeout(() => { if (document.visibilityState === 'visible') load(); else plan(); }, EVERY);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.at && Date.now() - S.at >= EVERY) load(); });

  function moverHTML(r, copy) {   // copy: the loop's second list — hidden from readers and out of the tab order, still pressable
    const c = val(r.change24h), p = usd(val(r.price));
    const href = '/market?coin=' + encodeURIComponent(r.id);
    return '<li><a class="mv-mover" href="' + esc(href) + '"' + (copy ? ' tabindex="-1"' : '') + ' data-mover="' + esc(r.id) + '" data-tip="Opens ' + esc(nameOf(r)) + '’s on-chain data on Market Data">' +
      (ownLogo(r.logo) ? '<img class="mv-logo" src="' + esc(r.logo) + '" alt="" loading="lazy" decoding="async" width="22" height="22">' : '') +
      '<b class="mv-s">' + esc(r.symbol || nameOf(r)) + '</b><span class="mv-p">' + esc(p || 'price not given') + '</span><span class="mv-c">' + esc(pct(c)) + '</span></a></li>';
  }
  /* a refresh never swaps a coin out from under a reader: while one has the focus, or a coin's popup opened from it is up (closing
     gives the focus back to it), the new answer waits until the focus has left the strip */
  const busy = () => { const a = document.activeElement, tm = document.getElementById('token-modal'); return !!(a && strip.contains(a)) || !!(tm && !tm.hidden); };
  document.addEventListener('focusout', () => { if (S.dirty) setTimeout(() => { if (S.dirty && !busy()) paint(); }, 0); });
  function paint() {
    if (busy()) { S.dirty = true; return; }
    S.dirty = false;
    const j = S.ans;
    const rows = j && Array.isArray(j.rows) ? j.rows.filter((r) => r && val(r.change24h) != null && val(r.change24h) > 0) : [];
    // nothing to show yet: one honest line in the strip's own room (it never comes and goes, so the page never jumps)
    if (!j || (!rows.length && !(j.counts && j.counts.of > 0))) {
      win.innerHTML = '<p class="mv-none">' + (!j && S.failed ? 'Can’t read the top gainers just now.' : j && j.why ? 'Top gainers: the 100 largest coins are not read yet.' : 'Reading the top gainers…') + '</p>';
      return;
    }
    if (!rows.length) {
      win.innerHTML = '<p class="mv-none">None of the 100 largest coins rose in the last 24 h.</p>';
    } else {
      const items = rows.map((r) => moverHTML(r)).join('');
      win.innerHTML = '<div class="mv-track"><ol class="mv-list">' + items + '</ol><ol class="mv-list mv-dup" aria-hidden="true">' + rows.map((r) => moverHTML(r, true)).join('') + '</ol></div>';
      const tr = win.querySelector('.mv-track'), first = tr && tr.firstElementChild;
      if (tr && first) tr.style.setProperty('--mv-dur', Math.max(20, Math.round(first.scrollWidth / 45)) + 's');   // ~45 px a second, whatever the screen
      // a picture that does not load is put away by an attribute of its own (not removed, not restyled): the strip's row stays still for
      // whatever watches the page's pinned layers for changes (Market Data's chain list)
      win.querySelectorAll('img.mv-logo').forEach((img) => img.addEventListener('error', () => img.setAttribute('data-gone', ''), { once: true }));
    }
    const at = j.reads && j.reads.coins && j.reads.coins.at ? j.reads.coins.at : j.at;
    const h = strip.querySelector('#mv-strip-h');
    if (h) h.setAttribute('data-tip', 'Opens Market Data. The biggest 24 h rises among CoinGecko’s 100 largest coins — only coins that went up' +
      (at ? ', read ' + new Date(at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '') + '. Not advice, never a tip to buy.');
  }
  // on Market Data a coin opens on the page itself (its popup, or its card under the map); everywhere else the link goes there
  strip.addEventListener('click', (e) => {
    const a = e.target.closest('[data-mover]'); if (!a || !onMarket()) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;   // a new tab is the reader's choice
    e.preventDefault();
    document.dispatchEvent(new CustomEvent('movers:open', { detail: { id: a.dataset.mover } }));
  });

  window.SendMovers = { get answer() { return S.ans; }, refresh: load };
  load();
})();
