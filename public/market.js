/* ===== market.js — the Market Data page (/market) =====================================================================
 * Owner, 2026-10-26: "a full dashboard of all of the chain's data … Robinhood being the default view … a main view that
 * when a user uses the search bar … pulls up full details … when a user clicks on the chain or token in list view on the
 * side, it pulls it up as the main view … lists of the top chains and top tokens … highest or lowest … time frame (their
 * own time or default times), Market Cap, Liquidity, TVL and Volume."
 *
 * What it reads: only this site's own /api/market/* routes (the server reads DefiLlama, L2BEAT, growthepie, CoinGecko,
 * GeckoTerminal, Dexscreener and the chain; the browser contacts none of them — the CSP's connect-src stays as it is).
 * What it promises: every figure is drawn with its source and the time it was read; a figure the server could not read
 * arrives as { v: null, why } and is shown as missing with that reason — never as 0. Charts are drawn here, in SVG, at the
 * box's own pixel size (so their labels keep the page's text floor), with a hover / arrow-key readout and a table.
 * The address bar is the state: /market?chain=<key>[&token=<address>][&window=<w>[&from=YYYY-MM-DD&to=YYYY-MM-DD]] —
 * a view is linkable, and Back / Forward walk the views.
 * For a token on Robinhood Chain, Ethereum or Solana the main view ends with the Scanner's own dashboard
 * (NPCard.dashboardHTML + NPCard.mountDashboard, newpairs.js), fed by /api/market/scan, which reads it without adding it to
 * the public "recently scanned" list — fetched only when the reader scrolls to it.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const view = $('mkt-view'), list = $('mkt-list'), cap = $('mkt-cap'), more = $('mkt-more'), foot = $('mkt-foot') || document.createElement('p');
  if (!view || !list) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('motion-off'); } catch { return false; } };
  const say = (t) => { const el = $('mkt-sr'); if (el) { el.textContent = ''; setTimeout(() => { el.textContent = t; }, 30); } };

  /* ---------- the words for numbers ---------- */
  /* @lift:words (tests/marketpage.mjs runs this block in a vm) */
  const SUBS = '₀₁₂₃₄₅₆₇₈₉';
  const trimZ = (s) => s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const sig = (x) => trimZ(x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2));
  function tiny(a) {   // 0.0001703 stays as it is; 0.00000631 is written 0.0₅631 (five zeros after the point)
    const e = Math.floor(Math.log10(a)), zeros = -e - 1;
    if (zeros < 4) return trimZ(a.toPrecision(4));
    const digits = String(Math.round(a * Math.pow(10, -e + 3))).replace(/0+$/, '') || '0';
    return '0.0' + String(zeros).split('').map((d) => SUBS[+d]).join('') + digits;
  }
  function usd(v) {
    if (v == null || !isFinite(v)) return null;
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e12) return s + '$' + sig(a / 1e12) + 'T';
    if (a >= 1e9) return s + '$' + sig(a / 1e9) + 'B';
    if (a >= 1e6) return s + '$' + sig(a / 1e6) + 'M';
    if (a >= 1e4) return s + '$' + sig(a / 1e3) + 'k';
    if (a >= 1) return s + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: a < 100 ? 2 : 0 });
    if (a === 0) return '$0';
    return s + '$' + tiny(a);
  }
  function count(v) {
    if (v == null || !isFinite(v)) return null;
    const a = Math.abs(v);
    if (a >= 1e9) return sig(v / 1e9) + 'B';
    if (a >= 1e6) return sig(v / 1e6) + 'M';
    if (a >= 1e5) return sig(v / 1e3) + 'k';
    return Math.round(v).toLocaleString('en-US');
  }
  const amount = (v, unit) => (v == null || !isFinite(v) ? null : (Math.abs(v) >= 1e5 ? count(v) : Number(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 10 ? 4 : Math.abs(v) < 1000 ? 2 : 0 })) + (unit ? ' ' + unit : ''));
  const gwei = (v) => (v == null || !isFinite(v) ? null : trimZ(Number(v).toPrecision(4)) + ' gwei');
  function pct(v) {
    if (v == null || !isFinite(v)) return null;
    const a = Math.abs(v), t = a.toFixed(a < 10 ? 2 : 1) + '%';
    return v > 0 ? '▲ +' + t : v < 0 ? '▼ −' + t : '0.00%';   // the arrow and the sign carry it, not the colour
  }
  const utc = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  function agoText(ms) {
    if (!ms || !isFinite(ms)) return 'time not recorded';
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + '\u00a0min ago';
    if (s < 86400) return Math.round(s / 3600) + '\u00a0h ago';
    const d = Math.round(s / 86400);
    return d + (d === 1 ? '\u00a0day ago' : '\u00a0days ago');
  }
  const agoEl = (ms) => (ms && isFinite(ms) ? '<time datetime="' + new Date(ms).toISOString() + '" title="' + esc(utc(ms)) + '">' + esc(agoText(ms)) + '</time>' : 'time not recorded');
  const short = (a) => { const s = String(a || ''); return s.length > 14 ? s.slice(0, 6) + '…' + s.slice(-4) : s; };

  /* @lift:end */

  /* ---------- figures: { v, src, at, why?, label? } ---------- */
  const SRC = { defillama: 'DefiLlama', l2beat: 'L2BEAT', growthepie: 'growthepie', coingecko: 'CoinGecko', geckoterminal: 'GeckoTerminal', dexscreener: 'Dexscreener', rpc: 'the chain’s public node', site: 'this site' };
  const GTP = '<a class="mkt-src-l" href="https://www.growthepie.com" target="_blank" rel="noopener">Source: growthepie (CC BY 4.0)</a>';
  const fig = (x) => (x == null ? { v: null } : typeof x === 'number' ? { v: x } : typeof x === 'object' ? x : { v: null });
  const val = (x) => { const f = fig(x); return f.v == null || !isFinite(f.v) ? null : Number(f.v); };
  const srcName = (id) => SRC[id] || String(id || 'the source');
  function srcLine(f) {   // "DefiLlama · 12 min ago" — growthepie's licence asks for its attribution, with a link
    if (!f || !f.src) return f && f.at ? agoEl(f.at) : '';
    return (f.src === 'growthepie' ? GTP : esc(srcName(f.src))) + (f.at ? ' · ' + agoEl(f.at) : '');
  }
  const NA = '<span class="mkt-na">Not available</span>';
  const whyOf = (f) => (f && f.why ? esc(f.why) : 'The source gave no figure for this');

  /* ---------- the chains this page knows by name before the list arrives ---------- */
  const KNOWN = { robinhood: 'Robinhood Chain', ethereum: 'Ethereum', solana: 'Solana', base: 'Base', arbitrum: 'Arbitrum', bsc: 'BNB Chain', optimism: 'OP Mainnet', polygon: 'Polygon', avalanche: 'Avalanche' };
  const SCANS = ['robinhood', 'ethereum', 'solana'];   // the chains the Scanner reads (newpairs.js CHAIN_META, lib/multichain.js)
  const READS = ['robinhood', 'ethereum', 'solana', 'base', 'bsc', 'arbitrum', 'polygon', 'avalanche', 'optimism'];   // the chains /api/market/token reads (lib/marketdata.js GT_TRACKED)
  const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/, B58_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  // a token the main view can open: a chain the server reads, and an address it takes there (the server's own check) — a
  // Dexscreener search hit on Tron or Sui is neither, and a button for it could only fail
  const readable = (chain, addr) => READS.includes(chain) && (chain === 'solana' ? B58_ADDR.test(String(addr || '')) : EVM_ADDR.test(String(addr || '')));
  const cap1 = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
  const QUOTE = { '0x0bd7d308f8e1639fab988df18a8011f41eacad73': 'WETH', '0x5fc5360d0400a0fd4f2af552add042d716f1d168': 'USDG', '0x0000000000000000000000000000000000000000': 'ETH' };
  const DEFAULT_CHAIN = 'robinhood';
  const CHAIN_WINS = ['24h', '7d', '30d', 'custom'], TOKEN_WINS = ['5m', '1h', '6h', '24h', 'custom'];
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const CHAIN_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/;
  const TOKEN_ADDR = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
  const yesterdayUTC = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);

  /* ---------- state ---------- */
  const S = {
    tab: 'chains',
    chains: { sort: 'tvl', dir: 'desc', win: '24h', from: '', to: '' },
    tokens: { sort: 'volume', dir: 'desc', win: '24h', from: '', to: '', all: false },
    view: { chain: DEFAULT_CHAIN, token: null },
    chainRows: null, chainAns: null, tokenAns: null, tokenFor: null, viewData: null,
    shown: 0, range: 90,
  };
  const names = new Map();   // chain key → name, from every answer that names one
  const chainName = (k) => names.get(k) || KNOWN[k] || k;
  const chainRow = (k) => (S.chainRows || []).find((r) => r.key === k) || null;

  /* ---------- the address bar ---------- */
  function readURL() {
    const q = new URLSearchParams(location.search);
    const c = (q.get('chain') || '').toLowerCase(), t = q.get('token') || '', w = q.get('window') || '', f = q.get('from') || '', to = q.get('to') || '';
    S.view = { chain: CHAIN_KEY.test(c) ? c : DEFAULT_CHAIN, token: TOKEN_ADDR.test(t) ? (/^0x/i.test(t) ? t.toLowerCase() : t) : null };
    const k = S.view.token ? S.tokens : S.chains, wins = S.view.token ? TOKEN_WINS : CHAIN_WINS;
    // an address without a time frame is the default one: Back to /market shows the 24 hours it showed, not the 7 days picked since
    k.win = '24h'; k.from = ''; k.to = '';
    if (wins.includes(w)) {
      if (w === 'custom') { if (DAY.test(f) && DAY.test(to) && f <= to) { k.win = 'custom'; k.from = f; k.to = to; } }
      else k.win = w;
    }
  }
  function urlFor(v) {
    const p = new URLSearchParams();
    p.set('chain', v.chain);
    if (v.token) p.set('token', v.token);
    const k = v.token ? S.tokens : S.chains;
    if (k.win !== '24h') { p.set('window', k.win); if (k.win === 'custom') { p.set('from', k.from); p.set('to', k.to); } }
    return '/market?' + p.toString();
  }
  function writeURL(push) {
    const u = urlFor(S.view);
    if (u === location.pathname + location.search) return;
    try { history[push ? 'pushState' : 'replaceState']({ mkt: 1 }, '', u); } catch {}
  }

  /* ---------- reading the site's own API ---------- */
  const memo = new Map();   // url → { at, j }: a tab switch or a Back does not ask again within a minute
  const seq = { list: 0, view: 0, scan: 0, search: 0 };
  // an answer that says some of it could not be read is not kept: Try again, a reload or a Back asks the site again rather
  // than showing the same failure for a minute (the server keeps only its successes too)
  const incomplete = (j) => !!j && typeof j === 'object' && !!(j.unavailable || j.why || (j.candles && j.candles.retry) || (j.custom && j.custom.retry) || (j.links && j.links.why));
  async function getJSON(url) {
    const m = memo.get(url);
    if (m && Date.now() - m.at < 60e3) return m.j;
    let r;
    try { r = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }); }
    catch { const e = new Error('offline'); e.status = 0; throw e; }
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok) { const e = new Error('status ' + r.status); e.status = r.status; e.body = j; throw e; }
    if (incomplete(j)) { memo.delete(url); return j; }
    if (memo.size > 60) memo.delete(memo.keys().next().value);
    memo.set(url, { at: Date.now(), j });
    return j;
  }
  // a 400 about the time frame (lib/marketdata.js parseWindow's words): asking again gives the same answer, so it is said plainly
  const winRefused = (e) => !!e && e.status === 400 && /window|UTC day|from is after|ten years|YYYY-MM-DD/i.test(String((e.body && (e.body.message || e.body.error)) || ''));
  function errText(e, what) {
    const said = e && e.body && (e.body.message || e.body.error);
    if (!e || e.status === 0) return 'Couldn’t reach this site just now — check your connection and try again. Nothing here is a reading of ' + what + '.';
    if (winRefused(e)) return 'This time frame can’t be served: ' + String(said) + '. A custom time frame is whole UTC days that have ended, at most ten years of them.';
    if (e.status === 400) return 'The site can’t answer this as asked: ' + (said ? String(said) : 'it refused the request') + '. Nothing here is a reading of ' + what + '.';
    if (e.status === 429) return 'Too many reads from this connection just now — wait a minute and try again.';
    if (e.status === 404) return said ? String(said) : 'This site has no record of ' + what + '.';
    if (said && /could not|couldn|not be read|unavailable/i.test(String(said))) return String(said) + (/try again/i.test(String(said)) ? '' : ' Try again in a moment.');
    return 'The market data for ' + what + ' could not be read just now' + (said ? ' (' + String(said) + ')' : ' (the site answered ' + e.status + ')') + ' — nothing here is a judgement about it. Try again in a moment.';
  }
  const loadingHTML = (t) => '<p class="tm-loading mkt-loading"><span class="np-live-dot" aria-hidden="true"></span> ' + esc(t) + '</p>';
  const retryBtn = (what) => '<button class="btn btn-sm btn-ghost mkt-retry" type="button" data-retry="' + what + '" data-tip="Asks the site for these figures again">↻ Try again</button>';
  const resetWinBtn = (kind) => '<button class="btn btn-sm btn-ghost" type="button" data-reset-win="' + kind + '" data-tip="Goes back to the default time frame, which every list and view can serve">↺ Last 24 hours</button>';
  const failActs = (e, what, kind) => (winRefused(e) ? resetWinBtn(kind) : retryBtn(what));   // asking again cannot change a refused time frame

  /* ---------- logos: same-origin only (the server's image proxy); anything else is a monogram ---------- */
  const mono = (s) => (Array.from(String(s || '?').replace(/^\$/, ''))[0] || '?').toUpperCase();
  function avaHTML(name, logo, big) {
    const img = typeof logo === 'string' && /^\/api\/[\w/.-]+(\?[^"'<>\s]*)?$/.test(logo)
      ? '<img class="mkt-logo" src="' + esc(logo) + '" alt="" loading="lazy" decoding="async" width="' + (big ? 56 : 32) + '" height="' + (big ? 56 : 32) + '">' : '';
    return '<span class="mkt-ava' + (big ? ' mkt-ava-lg' : '') + '" aria-hidden="true"><span class="mkt-mono">' + esc(mono(name)) + '</span>' + img + '</span>';
  }
  function wireLogos(root) { root.querySelectorAll('img.mkt-logo').forEach((img) => { if (img._w) return; img._w = 1; img.addEventListener('error', () => img.remove()); }); }

  /* ════════════════════════════ the side column ════════════════════════════ */
  const CH_SORT = { tvl: 'TVL', volume: 'volume', liquidity: 'DEX liquidity', mcap: 'market cap', fees: 'gas fees' };
  const TK_SORT = { volume: 'volume', liquidity: 'liquidity', mcap: 'market cap', fdv: 'FDV', change: 'price change' };
  const tabs = [$('mkt-tab-chains'), $('mkt-tab-tokens')];
  const ctl = { chains: $('mkt-ctl-chains'), tokens: $('mkt-ctl-tokens') };
  const wide = () => window.innerWidth >= 1280;
  const pageSize = () => (wide() ? 25 : 10);

  function chainsURL() {
    const k = S.chains, p = new URLSearchParams();
    if (k.sort !== 'tvl') p.set('sort', k.sort);
    if (k.dir !== 'desc') p.set('dir', k.dir);
    if (k.win !== '24h') { p.set('window', k.win); if (k.win === 'custom') { p.set('from', k.from); p.set('to', k.to); } }
    if (S.chainsLimit) p.set('limit', String(S.chainsLimit));
    const s = p.toString();
    return '/api/market/chains' + (s ? '?' + s : '');   // the first view asks exactly /api/market/chains: robots.txt lets a crawler read it
  }
  function tokensURL(chain) {
    const k = S.tokens, p = new URLSearchParams();
    p.set('chain', chain);
    if (k.sort !== 'volume') p.set('sort', k.sort);
    if (k.dir !== 'desc') p.set('dir', k.dir);
    if (k.win !== '24h') { p.set('window', k.win); if (k.win === 'custom') { p.set('from', k.from); p.set('to', k.to); } }
    if (k.all) p.set('include', 'all');
    return '/api/market/tokens?' + p.toString();
  }
  function syncControls() {
    for (const kind of ['chains', 'tokens']) {
      const box = ctl[kind], k = S[kind];
      if (!box) continue;
      box.querySelectorAll('[data-sort]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === k.sort)));
      box.querySelectorAll('[data-dir]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dir === k.dir)));
      box.querySelectorAll('[data-win]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.win === k.win)));
      const pre = kind === 'chains' ? 'mkt-cc' : 'mkt-tc', from = $(pre + '-from'), to = $(pre + '-to');
      if (from && to) {
        const max = yesterdayUTC();   // both lists are served over whole UTC days that have ended (lib/marketdata.js parseWindow)
        from.max = max; to.max = max; from.min = '2009-01-03'; to.min = '2009-01-03';
        if (k.win === 'custom') { from.value = k.from; to.value = k.to; }
      }
    }
    const wash = $('mkt-wash'); if (wash) wash.setAttribute('aria-pressed', String(!!S.tokens.all));
    const on = $('mkt-tok-on'); if (on) on.innerHTML = 'Tokens on <b>' + esc(chainName(S.view.chain)) + '</b> — the chain in the main view';
  }
  function setTab(tab, focus) {
    S.tab = tab;
    tabs.forEach((t) => { const on = t.dataset.tab === tab; t.setAttribute('aria-selected', String(on)); t.classList.toggle('is-on', on); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    $('mkt-panel').setAttribute('aria-labelledby', 'mkt-tab-' + tab);
    list.setAttribute('aria-labelledby', 'mkt-tab-' + tab);
    ctl.chains.hidden = tab !== 'chains'; ctl.tokens.hidden = tab !== 'tokens';
    S.shown = pageSize();
    loadList();
  }
  tabs.forEach((t) => t.addEventListener('click', () => { if (S.tab !== t.dataset.tab) setTab(t.dataset.tab, false); }));
  $('mkt-tab-chains').parentNode.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.dataset.tab === S.tab);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[n].dataset.tab, true);
  });

  // the controls: sort, order, time frame (a preset, or Custom… with two whole UTC days)
  for (const kind of ['chains', 'tokens']) {
    const box = ctl[kind]; if (!box) continue;
    const pre = kind === 'chains' ? 'mkt-cc' : 'mkt-tc';
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !box.contains(b)) return;
      const k = S[kind];
      if (b.dataset.sort) { if (k.sort === b.dataset.sort) return; k.sort = b.dataset.sort; S.shown = pageSize(); syncControls(); loadList(); return; }
      if (b.dataset.dir) { if (k.dir === b.dataset.dir) return; k.dir = b.dataset.dir; S.shown = pageSize(); syncControls(); loadList(); return; }
      if (b.dataset.win === 'custom') {
        const panel = $(pre), open = panel.hidden;
        panel.hidden = !open; b.setAttribute('aria-expanded', String(open));
        if (open) { const f = $(pre + '-from'); if (f) f.focus(); }
        return;
      }
      if (b.dataset.win) {
        if (k.win === b.dataset.win) return;
        const wasCustom = k.win === 'custom';
        k.win = b.dataset.win; k.from = ''; k.to = '';
        $(pre).hidden = true; box.querySelector('[data-win="custom"]').setAttribute('aria-expanded', 'false');
        syncControls(); windowChanged(kind, wasCustom); return;
      }
      if (b.id === pre + '-go') {
        const f = $(pre + '-from').value, t = $(pre + '-to').value, err = $(pre + '-err');
        const max = yesterdayUTC(), days = DAY.test(f) && DAY.test(t) ? Math.round((Date.parse(t) - Date.parse(f)) / 864e5) + 1 : 0;
        const bad = !DAY.test(f) || !DAY.test(t) ? 'Pick a start day and an end day.' : f > t ? 'The start day is after the end day — swap them.'
          : t > max ? 'The last day has to be a whole UTC day that has ended: ' + max + ' or earlier (today is still going).'
          : days > 3660 ? 'A custom time frame is at most ten years (3,660 days) — pick a later start day.' : '';
        err.hidden = !bad; err.textContent = bad;
        if (bad) return;
        k.win = 'custom'; k.from = f; k.to = t;
        syncControls(); windowChanged(kind, true); return;
      }
      if (b.id === 'mkt-wash') { k.all = !k.all; syncControls(); loadList(); }
    });
  }
  // a new time frame re-reads the list, and the main view when it is that kind of view (the window is in its address)
  function windowChanged(kind, customInvolved) {
    S.shown = pageSize();
    loadList();
    if (kind === 'chains' && !S.view.token) { writeURL(false); loadView(); }
    if (kind === 'tokens' && S.view.token) { writeURL(false); if (customInvolved || S.tokens.win === 'custom') loadView(); else paintTokenWindows(); }
  }

  async function loadList() {
    const my = ++seq.list, kind = S.tab;
    syncControls();
    if (kind === 'chains') {
      cap.innerHTML = loadingHTML('Reading the chains…'); list.innerHTML = ''; more.innerHTML = ''; foot.innerHTML = '';
      try {
        const j = await getJSON(chainsURL());
        if (my !== seq.list) return;
        S.chainAns = j; S.chainRows = Array.isArray(j && j.rows) ? j.rows : [];
        S.chainRows.forEach((r) => { if (r && r.key && r.name) names.set(r.key, r.name); });
        paintChains();
        syncControls();
      } catch (e) {
        if (my !== seq.list) return;
        cap.innerHTML = '<span class="mkt-err-t">⏳ ' + esc(errText(e, 'the chains')) + '</span> ' + failActs(e, 'list', 'chains');
      }
    } else {
      const chain = S.view.chain;
      cap.innerHTML = loadingHTML('Reading the tokens on ' + chainName(chain) + '…'); list.innerHTML = ''; more.innerHTML = ''; foot.innerHTML = '';
      const row = chainRow(chain);
      if (row && row.gtNetwork === null) {
        cap.innerHTML = '<span class="mkt-empty">Token lists are read from GeckoTerminal, which has no network for ' + esc(chainName(chain)) + ' — so there is no token list for it here.</span>';
        return;
      }
      try {
        const j = await getJSON(tokensURL(chain));
        if (my !== seq.list) return;
        S.tokenAns = j; S.tokenFor = chain;
        paintTokens();
      } catch (e) {
        if (my !== seq.list) return;
        cap.innerHTML = '<span class="mkt-err-t">⏳ ' + esc(errText(e, 'the tokens on ' + chainName(chain))) + '</span> ' + failActs(e, 'list', 'tokens');
      }
    }
  }

  function moreHTML(total) {
    if (total <= S.shown) return '';
    const n = Math.min(pageSize(), total - S.shown);
    return '<button class="btn btn-sm btn-ghost mkt-more-b" type="button" data-more="1" data-tip="Adds the next rows of this list below the ones shown">Show ' + n + ' more (' + (total - S.shown) + ' left)</button>';
  }
  function paintChains() {
    const j = S.chainAns || {}, rows = S.chainRows || [], k = S.chains;
    const sortF = k.sort, srcs = new Set();
    rows.forEach((r) => { const f = fig(r[sortF]); if (f.src) srcs.add(srcName(f.src)); });
    const win = j.window || {};
    cap.innerHTML = 'Ranked by <b>' + esc(CH_SORT[sortF] || sortF) + '</b>, ' + (k.dir === 'asc' ? 'lowest' : 'highest') + ' first · <b>' + esc(win.label || k.win) + '</b>' +
      ' · ' + rows.length + (j.total != null && j.total > rows.length ? ' of ' + Number(j.total).toLocaleString('en-US') : '') + ' chains' +
      (srcs.size ? ' · ' + esc([...srcs].join(', ')) : '') + (j.at ? ', gathered ' + agoEl(j.at) : '') +
      (k.dir === 'asc' ? '<span class="mkt-cap-n">A chain with no figure for this stays at the end, in both orders.</span>' : '') +
      (win.note ? '<span class="mkt-cap-n">' + esc(win.note) + '</span>' : '');
    foot.innerHTML = Array.isArray(j.notes) && j.notes.length ? j.notes.map(esc).join(' ') : '';
    if (!rows.length) { list.innerHTML = '<li class="mkt-empty">No chains are listed for this time frame yet.</li>'; more.innerHTML = ''; return; }
    const sec = sortF === 'tvl' ? 'volume' : 'tvl';
    list.innerHTML = rows.slice(0, S.shown).map((r, i) => {
      const f = fig(r[sortF]), s2 = fig(r[sec]);
      const main = f.v != null ? (sortF === 'mcap' || sortF === 'tvl' || sortF === 'volume' || sortF === 'liquidity' || sortF === 'fees' ? usd(f.v) : count(f.v)) : null;
      const stg = stageOf(r.stage), sub = [r.isL2 ? 'L2' + (stg ? ' · ' + stg : '') : '', s2.v != null ? (sec === 'tvl' ? 'TVL ' : 'Vol ') + usd(s2.v) : ''].filter(Boolean).join(' · ');
      const cur = !S.view.token && S.view.chain === r.key;
      return '<li><button class="mkt-row" type="button" data-chain="' + esc(r.key) + '"' + (cur ? ' aria-current="true"' : '') + ' data-tip="Opens ' + esc(r.name) + ' in the main view: every figure, chart and source we hold for it">' +
        '<span class="mkt-rank">' + (i + 1) + '</span>' + avaHTML(r.name, r.logo) +
        '<span class="mkt-nm"><b>' + esc(r.name) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
        '<span class="mkt-fig">' + (main != null ? '<b>' + esc(main) + '</b>' + (f.label && sortF === 'mcap' ? '<small>' + esc(f.label) + '</small>' : '') : '<b class="mkt-na">Not available</b><small>' + whyOf(f) + '</small>') + '</span>' +
      '</button></li>';
    }).join('');
    more.innerHTML = moreHTML(rows.length) + (j.total > rows.length && rows.length < 200 && !S.chainsLimit ? '<button class="btn btn-sm btn-ghost mkt-more-b" type="button" data-limit="200" data-tip="Asks the site for up to 200 chains instead of the first page">Read up to 200 chains</button>' : '');
    wireLogos(list);
  }
  const FLAG = { thin: ['thin pools', 'Its pools hold under $10k between them'], wash: ['volume ≫ pools', 'Its 24h volume is over 100 times what its pools hold — a sign of wash trading'], 'global-mcap': ['global cap', 'Its market cap is a global, all-chains figure, not this chain’s'] };
  function paintTokens() {
    const j = S.tokenAns || {}, rows = Array.isArray(j.rows) ? j.rows : [], k = S.tokens, sortF = k.sort;
    const win = j.window || {};
    cap.innerHTML = 'Tokens on <b>' + esc(chainName(j.chain || S.tokenFor)) + '</b> · ranked by <b>' + esc(TK_SORT[sortF] || sortF) + '</b>, ' + (k.dir === 'asc' ? 'lowest' : 'highest') + ' first · <b>' + esc(win.label || k.win) + '</b>' +
      (j.at ? ' · gathered ' + agoEl(j.at) : '') +
      (j.basis ? '<span class="mkt-cap-n">From ' + esc(j.basis) + (k.dir === 'asc' ? ' — so “lowest” is lowest among those, not lowest on the chain.' : '.') + '</span>' : '') +
      (j.coverage && j.coverage.from ? '<span class="mkt-cap-n">Custom windows come from this site’s own pool readings, which start ' + esc(j.coverage.from) + '.</span>' : '') +
      (win.note ? '<span class="mkt-cap-n">' + esc(win.note) + '</span>' : '');
    foot.innerHTML = sortF === 'volume' && k.dir === 'desc' && !k.all ? 'Tokens whose volume is over 100× what their pools hold are left out of “highest volume” — “Include flagged volume” lists them too.' : '';
    if (!rows.length) { list.innerHTML = '<li class="mkt-empty">' + (j.why ? esc(cap1(j.why)) : 'No tokens are listed for ' + esc(chainName(j.chain || S.tokenFor)) + (k.win === 'custom' ? ' over these days yet' : ' yet')) + '.</li>'; more.innerHTML = ''; return; }
    const sec = sortF === 'volume' ? 'liquidity' : 'volume';
    list.innerHTML = rows.slice(0, S.shown).map((r, i) => {
      const f = fig(r[sortF]), s2 = fig(r[sec]);
      const main = f.v != null ? (sortF === 'change' ? pct(f.v) : usd(f.v)) : null;
      const nm = r.name || r.symbol || short(r.address);
      const flags = (r.flags || []).filter((x) => FLAG[x]).map((x) => '<span class="mkt-flag" title="' + esc(FLAG[x][1]) + '">⚠ ' + esc(FLAG[x][0]) + '</span>').join('');
      const cur = S.view.token && S.view.token === String(r.address).toLowerCase();
      return '<li><button class="mkt-row" type="button" data-chain="' + esc(r.chain || j.chain) + '" data-token="' + esc(r.address) + '"' + (cur ? ' aria-current="true"' : '') + ' data-tip="Opens ' + esc(nm) + ' in the main view: price, pools, a chart and the Scanner’s read">' +
        '<span class="mkt-rank">' + (i + 1) + '</span>' + avaHTML(r.symbol || r.name, r.logo) +
        '<span class="mkt-nm"><b>' + esc(nm) + (r.symbol ? ' <span class="mkt-sym">$' + esc(r.symbol) + '</span>' : '') + '</b><small><code>' + esc(short(r.address)) + '</code>' +
          (s2.v != null ? ' · ' + (sec === 'liquidity' ? 'Liq ' : 'Vol ') + esc(usd(s2.v)) + (sec === 'liquidity' && r.liquidity && r.liquidity.pools ? ' in ' + r.liquidity.pools + ' pool' + (r.liquidity.pools === 1 ? '' : 's') : '') : '') + '</small>' + (flags ? '<span class="mkt-flags">' + flags + '</span>' : '') + '</span>' +
        '<span class="mkt-fig">' + (main != null ? '<b>' + esc(main) + '</b>' + (sortF === 'mcap' && (r.flags || []).includes('global-mcap') ? '<small>global, all chains</small>' : '') : '<b class="mkt-na">Not available</b><small>' + whyOf(f) + '</small>') + '</span>' +
      '</button></li>';
    }).join('');
    more.innerHTML = moreHTML(rows.length);
    wireLogos(list);
  }
  more.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.limit) { S.chainsLimit = Number(b.dataset.limit); loadList(); return; }
    const first = S.shown; S.shown += pageSize();
    if (S.tab === 'chains') paintChains(); else paintTokens();
    const next = list.querySelectorAll('.mkt-row')[first]; if (next) next.focus();
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.mkt-row'); if (!b) return;
    open({ chain: b.dataset.chain, token: b.dataset.token || null }, true);
  });
  document.addEventListener('click', (e) => {
    const w = e.target.closest('[data-reset-win]');
    if (w) {
      const kind = w.dataset.resetWin === 'tokens' ? 'tokens' : 'chains', pre = kind === 'chains' ? 'mkt-cc' : 'mkt-tc';
      Object.assign(S[kind], { win: '24h', from: '', to: '' });
      const panel = $(pre); if (panel) panel.hidden = true;
      const c = ctl[kind] && ctl[kind].querySelector('[data-win="custom"]'); if (c) c.setAttribute('aria-expanded', 'false');
      syncControls(); windowChanged(kind, true); return;
    }
    const r = e.target.closest('[data-retry]'); if (!r) return;
    if (r.dataset.retry === 'list') { memo.clear(); loadList(); } else if (r.dataset.retry === 'view') { memo.clear(); loadView(); } else if (r.dataset.retry === 'scan') { const h = $('mkt-scan-host'); if (h) { h._asked = false; loadScan(h); } }
    else if (r.dataset.retry === 'search' && form) { memo.clear(); if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true })); }
  });

  /* ════════════════════════════ the main view ════════════════════════════ */
  function open(v, push) {
    if (!v || !CHAIN_KEY.test(String(v.chain || ''))) return;
    const tok = v.token && TOKEN_ADDR.test(v.token) ? (/^0x/i.test(v.token) ? v.token.toLowerCase() : v.token) : null;
    const chainChanged = v.chain !== S.view.chain;
    S.view = { chain: v.chain, token: tok };
    writeURL(push);
    loadView(true);
    markCurrent();
    if (S.tab === 'tokens' && chainChanged) loadList();
    syncControls();
  }
  function markCurrent() {
    list.querySelectorAll('.mkt-row').forEach((b) => {
      const on = S.view.token ? (b.dataset.token || '').toLowerCase() === String(S.view.token).toLowerCase() : !b.dataset.token && b.dataset.chain === S.view.chain;
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }
  function focusHead() {
    const h = $('mkt-vh'); if (!h) return;
    try { h.focus({ preventScroll: true }); } catch {}
    const top = view.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) { try { view.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); } catch { view.scrollIntoView(); } }
  }
  function chainViewURL(key) {
    const k = S.chains, p = new URLSearchParams();
    p.set('key', key);
    if (k.win !== '24h') { p.set('window', k.win); if (k.win === 'custom') { p.set('from', k.from); p.set('to', k.to); } }
    return '/api/market/chain?' + p.toString();   // the first view asks exactly /api/market/chain?key=robinhood (robots.txt allows it)
  }
  function tokenViewURL(chain, addr) {
    const k = S.tokens, p = new URLSearchParams();
    p.set('chain', chain); p.set('address', addr);
    if (k.win === 'custom') { p.set('window', 'custom'); p.set('from', k.from); p.set('to', k.to); }
    return '/api/market/token?' + p.toString();
  }
  // the main view when its read failed: what went wrong, a way to ask again, and the ways out
  function failHTML(v, nm, text, act, scanner) {
    const scanHref = scanner && typeof scanner.href === 'string' && /^\/newpairs\?/.test(scanner.href) ? scanner.href
      : v.token && SCANS.includes(v.chain) ? '/newpairs?scan=' + encodeURIComponent(v.token) + '&chain=' + encodeURIComponent(v.chain) : null;
    return '<div class="mkt-card mkt-fail"><h2 class="mkt-h" id="mkt-vh" tabindex="-1">' + esc(nm) + '</h2><p class="mkt-err-t">⏳ ' + esc(text) + '</p>' +
      '<p class="mkt-acts">' + act + (v.chain !== DEFAULT_CHAIN || v.token ? ' <button class="btn btn-sm btn-ghost" type="button" data-open-chain="' + DEFAULT_CHAIN + '" data-tip="Goes back to Robinhood Chain, the default view">← Robinhood Chain</button>' : '') +
      (scanHref ? ' <a class="btn btn-sm btn-ghost" href="' + esc(scanHref) + '" data-tip="Opens this address in the Scanner, which reads it straight from the chain">🔎 Open it in the Scanner</a>' : '') + '</p></div>';
  }
  // a 200 that says it could not read the thing (a token GeckoTerminal could not be asked about, a chain not read yet) is a
  // failed read, not a token with no pools or a chain with no figures
  const failedRead = (j, isToken) => !!j && (j.unavailable === true || (!!j.why && (isToken ? val(j.priceUsd) == null && !Array.isArray(j.pools) : !j.stats)));
  async function loadView(moveFocus) {
    const my = ++seq.view, v = S.view;
    destroyCharts(view);
    const nm = v.token ? short(v.token) + ' on ' + chainName(v.chain) : chainName(v.chain);
    view.innerHTML = loadingHTML('Reading ' + nm + '…');
    view.setAttribute('aria-busy', 'true');
    try {
      const j = await getJSON(v.token ? tokenViewURL(v.chain, v.token) : chainViewURL(v.chain));
      if (my !== seq.view) return;
      if (failedRead(j, !!v.token)) {
        S.viewData = null;
        view.innerHTML = failHTML(v, nm, cap1(String(j.why || 'the site could not read this just now').replace(/\.$/, '')) + '. Nothing here is a reading of ' + nm + '.', retryBtn('view'), j.scanner);
        if (moveFocus) focusHead();
        say('Could not read ' + nm + ' just now.');
        return;
      }
      S.viewData = j;
      if (j && j.key && j.name) names.set(j.key, j.name);
      view.innerHTML = v.token ? tokenHTML(j) : chainHTML(j);
      mountView(j);
      document.title = (v.token ? ((j && (j.symbol ? '$' + j.symbol : j.name)) || 'Token') : ((j && j.name) || chainName(v.chain))) + ' · Market Data — Just Send It';
      if (moveFocus) focusHead();
      say((v.token ? 'Showing ' + ((j && j.name) || 'the token') : 'Showing ' + ((j && j.name) || chainName(v.chain))) + ' in the main view.');
    } catch (e) {
      if (my !== seq.view) return;
      S.viewData = null;
      view.innerHTML = failHTML(v, nm, errText(e, nm), failActs(e, 'view', v.token ? 'tokens' : 'chains'), null);
      if (moveFocus) focusHead();
    } finally { if (my === seq.view) view.removeAttribute('aria-busy'); }
  }
  view.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open-token]');
    if (t) { open({ chain: t.dataset.chain || S.view.chain, token: t.dataset.openToken }, true); return; }
    const c = e.target.closest('[data-open-chain]');
    if (c) { open({ chain: c.dataset.openChain, token: null }, true); return; }
    const r = e.target.closest('[data-range]');
    if (r) { S.range = Number(r.dataset.range); view.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(x === r))); redrawRanged(); return; }
    const a = e.target.closest('[data-all-tokens]');
    if (a) { if (S.tab !== 'tokens') setTab('tokens', true); else tabs[1].focus(); }
  });

  /* ---------- a stat card ---------- */
  const sameWords = (a, b) => { const n = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); const x = n(a), y = n(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
  function stat(label, x, fmt, extra) {
    const f = fig(x), shown = f.v != null && isFinite(f.v) ? fmt(Number(f.v)) : null;
    const lab = f.label && !sameWords(f.label, label) ? esc(f.label) + ' · ' : '';
    return '<div class="mkt-stat' + (shown == null ? ' is-na' : '') + '"><dt>' + esc(label) + '</dt><dd>' +
      (shown != null ? '<b class="mkt-v">' + esc(shown) + '</b>' : '<b class="mkt-v">' + NA + '</b>') +
      '<span class="mkt-s">' + (shown != null ? lab + srcLine(f) : whyOf(f) + (f.src && f.src !== 'site' ? ' · ' + srcLine(f) : '')) + '</span>' +
      (extra || '') + '</dd></div>';
  }
  const sgroup = (title, body) => body ? '<section class="mkt-sgroup"><h3 class="mkt-gh">' + esc(title) + '</h3><dl class="mkt-stats">' + body + '</dl></section>' : '';

  /* ---------- a chain ---------- */
  const stageOf = (x) => (typeof x === 'string' ? x : x && typeof x.v === 'string' ? x.v : x && typeof x.label === 'string' ? x.label : null);   // a word, however it arrives
  function chainHTML(d) {
    d = d || {};
    const st = Object.assign({}, d.stats || {}); st.stage = stageOf(st.stage);
    const row = chainRow(d.key) || {}, w = d.window || (S.chainAns && S.chainAns.window) || {};
    const isL2 = row.isL2 != null ? row.isL2 : !!st.stage;
    const kick = ['🔗 Chain', d.chainId != null ? 'chain ID ' + d.chainId : '', isL2 ? 'Layer 2' : '', st.stage ? 'L2BEAT ' + st.stage : ''].filter(Boolean).join(' · ');
    const tb = st.tvsBreakdown;
    const tvsExtra = tb && (tb.native != null || tb.canonical != null || tb.external != null)
      ? '<span class="mkt-s">' + ['native', 'canonical', 'external'].filter((k) => val(tb[k]) != null).map((k) => esc(k) + ' ' + esc(usd(val(tb[k])))).join(' · ') + '</span>' : '';
    const money = sgroup('Money on the chain',
      stat('DeFi TVL', st.tvl, usd) + stat('Total value secured', st.tvs, usd, tvsExtra) + stat('Stablecoins', st.stables, usd) +
      stat('Native token market cap', st.mcap, usd));
    const trade = sgroup('Trading',
      (w.kind && w.kind !== '24h' ? stat('DEX volume, ' + (w.label || w.kind), st.windowVolume, usd) : '') +
      stat('DEX volume, 1 day', st.volume24h, usd) + stat('DEX volume, 7 days', st.volume7d, usd) + stat('DEX volume, 30 days', st.volume30d, usd) +
      stat('Open interest', st.oi, usd));
    const feesG = sgroup('Fees', stat('Gas fees, 1 day', st.fees24h, usd) + stat('App fees, 1 day', st.appFees24h, usd));
    const act = sgroup('Activity', stat('Transactions, 1 day', st.txcount24h, count) + stat('Active addresses, 1 day', st.daa, count) +
      stat('Median transaction cost', st.medianTxCostUsd, (v) => (v < 0.01 ? '$' + tiny(v) : usd(v))));
    return '<article class="mkt-art" aria-labelledby="mkt-vh">' +
      '<header class="mkt-vhead">' + avaHTML(d.name || d.key, row.logo, true) +
        '<div class="mkt-vt"><p class="mkt-kicker">' + esc(kick) + '</p>' +
        '<h2 class="mkt-h" id="mkt-vh" tabindex="-1">' + esc(d.name || chainName(d.key)) + '</h2>' +
        '<p class="mkt-vsub">Figures for <b>' + esc(w.label || 'the last full UTC day') + '</b>' + (d.at ? ' · gathered ' + agoEl(d.at) : '') + '. Each card names its source and when that source was read.</p></div>' +
      '</header>' + (d.why ? '<p class="mkt-note mkt-basis">⏳ ' + esc(d.why) + '</p>' : '') +
      '<div class="mkt-groups">' + money + trade + feesG + act + '</div>' +
      chartsHTML(d) + pulseHTML(d) + l2HTML(d) + topTokensHTML(d) + newPoolsHTML(d) + sourcesHTML(d) +
    '</article>';
  }

  /* the charts: one card, a range for all of them, each chart with its own source */
  const SERIES = [['tvl', 'DeFi TVL', usd], ['volume', 'DEX volume per day', usd], ['fees', 'Fees per day', usd], ['stables', 'Stablecoins', usd], ['txcount', 'Transactions per day', count]];
  // the server sends each series as a plain array of [day, value], with its source beside it in history.src
  const seriesOf = (h, src) => {
    if (!h) return { rows: [], src: src || null };
    if (Array.isArray(h)) return { rows: h, src: src || null };
    return { rows: Array.isArray(h.rows) ? h.rows : Array.isArray(h.points) ? h.points : [], src: h.src || src || null, at: h.at, why: h.why, label: h.label };
  };
  const seriesSrc = (hist, k) => (hist && hist.src && typeof hist.src === 'object' ? hist.src[k] || null : null);
  const toMs = (t) => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : DAY.test(String(t)) ? Date.parse(t + 'T00:00:00Z') : Date.parse(t));
  const px = (x) => (x == null || x === '' ? NaN : Number(x));   // a value a source left out is a gap, never 0 (+null is 0)
  function chartsHTML(d) {
    const h = d.history || {};
    const cards = SERIES.map(([k, title, fmt]) => {
      const s = seriesOf(h[k], seriesSrc(h, k)), pts = s.rows.map((r) => [toMs(r[0]), px(r[1])]).filter((r) => isFinite(r[0]) && isFinite(r[1]));
      const t = s.label || title;
      if (pts.length < 2) {
        return '<figure class="mkt-chart is-empty"><figcaption><b>' + esc(t) + '</b></figcaption><p class="mkt-empty">' +
          (pts.length === 1 ? 'Only one day is recorded so far — a chart needs two.' : 'No history for this chain yet' + (s.why ? ' — ' + esc(s.why) : '') + '.') + '</p></figure>';
      }
      // the series carries no read time of its own, so the caption says which whole day it reaches (the read time when it has one)
      const last = Math.max(...pts.map((r) => r[0]));
      const cap = [srcLine({ src: s.src, at: s.at }), 'daily, whole UTC days', 'latest ' + esc(xLong(last, 'day'))].filter(Boolean).join(' · ');
      return '<figure class="mkt-chart" data-series="' + k + '"><figcaption><b>' + esc(t) + '</b><span class="mkt-s">' + cap + '</span></figcaption>' +
        '<div class="mkt-plot" tabindex="0" role="group" aria-label="' + esc(t + ' chart. Use the left and right arrow keys to read each day.') + '"></div>' +
        '<p class="mkt-readout"></p>' +
        '<details class="mkt-tbl"><summary>Every value as a table</summary><div class="mkt-tblw"></div></details></figure>';
    }).join('');
    if (!cards) return '';
    return '<section class="mkt-card mkt-charts" aria-labelledby="mkt-ch-h"><div class="mkt-card-h"><h3 class="mkt-h3" id="mkt-ch-h">📈 Over time</h3>' +
      '<div class="mkt-chips" role="group" aria-label="Chart range">' +
      [[30, '30d', 'Shows the last 30 days on every chart'], [90, '90d', 'Shows the last 90 days on every chart'], [365, '1y', 'Shows the last year on every chart'], [0, 'All', 'Shows every day each source has']]
        .map(([n, l, tip]) => '<button class="np-chip" type="button" data-range="' + n + '" aria-pressed="' + (S.range === n) + '" data-tip="' + tip + '"><span class="mkt-tick" aria-hidden="true">✓&nbsp;</span>' + l + '</button>').join('') +
      '</div></div><div class="mkt-chart-grid">' + cards + '</div>' +
      '<p class="mkt-note">Today’s figures are still filling in at their sources, so every daily chart stops at the last whole UTC day.</p></section>';
  }

  /* how old a pulse reading may be before its tile says so: two of its collector's rounds and a minute (the head every minute,
     the supplies every 10 minutes, the bridge every 15 — lib/marketdata.js JOBS.pulse). A reading is the latest one that worked,
     so when the Ethereum read fails the bridge figure stays days old — it keeps its own time, never the head block's "just now". */
  const PULSE_FRESH = { head: 3 * 60e3, supplies: 21 * 60e3, bridge: 31 * 60e3 };
  const readWhen = (at, fresh) => (at && isFinite(at) ? 'read ' + agoEl(at) + (Date.now() - at > fresh ? ' — ⏳ older than this reading usually is' : '') : 'not read yet');
  function pulseHTML(d) {
    const p = d.pulse; if (!p) return '';
    const n = p.now, pcAll = p.poolsCreated || {}, pc = pcAll.h24 || {};
    const head = '<section class="mkt-card mkt-pulse" aria-labelledby="mkt-pl-h"><div class="mkt-card-h"><h3 class="mkt-h3" id="mkt-pl-h">💓 Robinhood Chain pulse</h3><p class="mkt-s">Read by this site from the chain’s public node' + (n && n.at ? ' · latest block ' + readWhen(n.at, PULSE_FRESH.head) : '') + '</p></div>';
    if (!n) return head + '<p class="mkt-empty">⏳ ' + esc(cap1(String(p.why || 'the chain has not been read yet').replace(/\.$/, ''))) + '.</p></section>';
    const pm = n.pm || {};
    const tile = (label, value, sub) => '<div class="mkt-stat' + (value == null ? ' is-na' : '') + '"><dt>' + esc(label) + '</dt><dd><b class="mkt-v">' + (value == null ? NA : esc(value)) + '</b>' + (sub ? '<span class="mkt-s">' + sub + '</span>' : '') + '</dd></div>';
    const pmParts = [amount(val(pm.eth), 'ETH'), amount(val(pm.weth), 'WETH'), amount(val(pm.usdg), 'USDG')].filter(Boolean);
    const created = ['v2', 'v3', 'v4'].map((k) => (val(pc[k]) != null ? k + ' ' + count(val(pc[k])) : null)).filter(Boolean);
    const totalCreated = ['v2', 'v3', 'v4'].reduce((a, k) => (val(pc[k]) != null ? a + val(pc[k]) : a), 0);
    const supWhen = readWhen(n.suppliesAt, PULSE_FRESH.supplies), brWhen = readWhen(n.bridgeAt, PULSE_FRESH.bridge);
    const hist = p.history || {};
    const H = [['gas', 'Gas price, our readings', (v) => gwei(v)], ['blockTimeMs', 'Block time, our readings', (v) => trimZ(Number(v).toFixed(1)) + ' ms'], ['bridgeEth', 'ETH in the canonical bridge, our readings', (v) => amount(v, 'ETH')]];
    const sparks = H.map(([k, t, fmt]) => {
      const rows = Array.isArray(hist[k]) ? hist[k] : seriesOf(hist[k]).rows;
      const pts = rows.map((r) => [toMs(r[0]), px(r[1])]).filter((r) => isFinite(r[0]) && isFinite(r[1]));
      if (pts.length < 2) return '';
      return '<figure class="mkt-chart" data-pulse="' + k + '"><figcaption><b>' + esc(t) + '</b><span class="mkt-s">read by this site from the chain</span></figcaption><div class="mkt-plot" tabindex="0" role="group" aria-label="' + esc(t + ' chart. Use the left and right arrow keys to read each point.') + '"></div><p class="mkt-readout"></p></figure>';
    }).join('');
    return head +
      '<dl class="mkt-stats">' +
        tile('Latest block', val(n.block) != null ? Math.round(val(n.block)).toLocaleString('en-US') : null) +
        tile('Block time', val(n.blockTimeMs) != null ? trimZ(val(n.blockTimeMs).toFixed(1)) + ' ms' : null, 'average between stored anchor blocks') +
        tile('Gas price', gwei(val(n.gasGwei)), [val(n.baseFeeGwei) != null ? 'base fee ' + esc(gwei(val(n.baseFeeGwei))) : '', val(n.minGasGwei) != null ? 'floor ' + esc(gwei(val(n.minGasGwei))) : ''].filter(Boolean).join(' · ')) +
        tile('L1 data price', val(n.l1PriceWei) != null ? Math.round(val(n.l1PriceWei)).toLocaleString('en-US') + ' wei' : null, 'per byte of calldata, ArbGasInfo') +
        tile('Pools created, 24 h', created.length ? count(totalCreated) : null, created.length ? esc(created.join(' · ')) + ' — pools, not tokens' : esc(cap1(pcAll.why || 'not counted yet'))) +
        tile('WETH supply', amount(val(n.wethSupply), 'WETH'), 'totalSupply of the chain’s WETH · ' + supWhen) +
        tile('USDG supply', amount(val(n.usdgSupply), 'USDG'), 'totalSupply of USDG on the chain · ' + supWhen) +
        tile('Held by the v4 PoolManager', pmParts.length ? pmParts.join(' + ') : null, 'includes claims and fees — assets held, not pool TVL · ' + supWhen) +
        tile('ETH in the canonical bridge', amount(val(n.bridgeEth), 'ETH'), 'held by the bridge contract on Ethereum — not a net inflow · ' + brWhen) +
      '</dl>' +
      (sparks ? '<div class="mkt-chart-grid">' + sparks + '</div>' : '<p class="mkt-note">This site keeps its own readings of these from the day the page started collecting them; there are not enough of them to chart yet.</p>') +
    '</section>';
  }

  function l2HTML(d) {
    const st = Object.assign({}, d.stats || {}), risks = Array.isArray(st.risks) ? st.risks : [];
    st.stage = stageOf(st.stage);
    if (!st.stage && !risks.length) return '';
    const word = { bad: '⚠️ Bad', warning: '⚠ Warning', good: '✓ Good', neutral: '· Neutral' };
    const slug = d.key === 'optimism' ? 'op-mainnet' : d.key;
    return '<section class="mkt-card mkt-l2" aria-labelledby="mkt-l2-h"><div class="mkt-card-h"><h3 class="mkt-h3" id="mkt-l2-h">🧱 Rollup stage and risks</h3><p class="mkt-s">From <a href="https://l2beat.com/scaling/projects/' + encodeURIComponent(slug) + '" target="_blank" rel="noopener">L2BEAT</a> — its own assessment, quoted as it gives it</p></div>' +
      (st.stage ? '<p class="mkt-stage"><b>' + esc(st.stage) + '</b> <span class="mkt-s">L2BEAT’s stage scale runs from Stage 0 (training wheels on) to Stage 2.</span></p>' : '') +
      (risks.length ? '<table class="mkt-table"><thead><tr><th scope="col">Risk</th><th scope="col">What L2BEAT found</th><th scope="col">Its rating</th></tr></thead><tbody>' +
        risks.map((r) => '<tr><th scope="row" data-l="Risk">' + esc(r.name) + '</th><td data-l="Found">' + esc(r.value) + (r.description ? '<details class="mkt-why"><summary>Why</summary><p>' + esc(r.description) + '</p></details>' : '') + '</td><td data-l="Rating">' + esc(word[r.sentiment] || r.sentiment || '—') + '</td></tr>').join('') +
      '</tbody></table>' : '') + '</section>';
  }

  function topTokensHTML(d) {
    const t = d.topTokens; if (!t) return '';
    const rows = Array.isArray(t.rows) ? t.rows.slice(0, 10) : [];
    return '<section class="mkt-card mkt-top" aria-labelledby="mkt-tt-h"><div class="mkt-card-h"><h3 class="mkt-h3" id="mkt-tt-h">🪙 Top tokens on ' + esc(d.name || chainName(d.key)) + '</h3>' + (t.basis ? '<p class="mkt-s">By 24h volume, from ' + esc(t.basis) + '</p>' : '') + '</div>' +
      (rows.length ? '<ol class="mkt-list mkt-list-in">' + rows.map((r, i) => {
        const nm = r.name || r.symbol || short(r.address), v = val(r.volume), l = val(r.liquidity);
        return '<li><button class="mkt-row" type="button" data-open-token="' + esc(r.address) + '" data-chain="' + esc(r.chain || d.key) + '" data-tip="Opens ' + esc(nm) + ' in the main view">' +
          '<span class="mkt-rank">' + (i + 1) + '</span>' + avaHTML(r.symbol || r.name, r.logo) +
          '<span class="mkt-nm"><b>' + esc(nm) + (r.symbol ? ' <span class="mkt-sym">$' + esc(r.symbol) + '</span>' : '') + '</b><small><code>' + esc(short(r.address)) + '</code>' + (l != null ? ' · Liq ' + esc(usd(l)) : '') + '</small></span>' +
          '<span class="mkt-fig">' + (v != null ? '<b>' + esc(usd(v)) + '</b><small>24h volume</small>' : '<b class="mkt-na">Not available</b><small>' + whyOf(fig(r.volume)) + '</small>') + '</span></button></li>';
      }).join('') + '</ol>' : '<p class="mkt-empty">' + (t.why ? esc(cap1(String(t.why).replace(/\.$/, ''))) + '.' : 'No token list for this chain yet.') + '</p>') +
      '<p class="mkt-acts"><button class="btn btn-sm btn-ghost" type="button" data-all-tokens="1" data-tip="Switches the side list to this chain’s tokens, with its sorting and time frames">All tokens, sorted your way →</button></p></section>';
  }

  function tokName(a) { const s = String(a || '').toLowerCase(); return QUOTE[s] || short(a); }
  function newPoolsHTML(d) {
    const rows = Array.isArray(d.newPools) ? d.newPools.slice(0, 20) : null;
    if (!rows) return '';
    return '<section class="mkt-card mkt-new" aria-labelledby="mkt-np-h"><div class="mkt-card-h"><h3 class="mkt-h3" id="mkt-np-h">🆕 Newest pools</h3><p class="mkt-s">' +
      (d.key === 'robinhood' ? 'Read from the chain’s own logs: v2 PairCreated, v3 PoolCreated and v4 Initialize' : 'GeckoTerminal’s new pools for this network') + '. A new pool is a new place to trade, not a recommendation — most new tokens go to zero.</p></div>' +
      (rows.length ? poolTable(rows.slice(0, 10), d) + (rows.length > 10 ? '<details class="mkt-tbl"><summary>The other ' + (rows.length - 10) + ' newest pools</summary>' + poolTable(rows.slice(10), d) + '</details>' : '') : '<p class="mkt-empty">No new pools are recorded for this chain yet.</p>') + '</section>';
  }
  function poolTable(rows, d) {
    return '<table class="mkt-table"><thead><tr><th scope="col">Pair</th><th scope="col">Venue</th><th scope="col">When</th><th scope="col">Pool</th></tr></thead><tbody>' + rows.map((r) => {
        const t0 = typeof r.token0 === 'object' && r.token0 ? r.token0.address : r.token0, t1 = typeof r.token1 === 'object' && r.token1 ? r.token1.address : r.token1;
        const s0 = (typeof r.token0 === 'object' && r.token0 && r.token0.symbol) || tokName(t0), s1 = (typeof r.token1 === 'object' && r.token1 && r.token1.symbol) || tokName(t1);
        const other = QUOTE[String(t1 || '').toLowerCase()] ? t0 : t1;   // the side that is not WETH / USDG / ETH
        const openB = other && TOKEN_ADDR.test(other) && !QUOTE[String(other).toLowerCase()] ? ' <button class="btn btn-sm btn-ghost mkt-mini" type="button" data-open-token="' + esc(other) + '" data-chain="' + esc(r.chain || d.key) + '" data-tip="Opens this pool’s token in the main view">Open</button>' : '';
        const when = r.block != null ? 'block ' + Number(r.block).toLocaleString('en-US') + (r.firstSeen ? ' · seen ' + agoEl(r.firstSeen) : '') : r.createdAt ? agoEl(typeof r.createdAt === 'number' ? r.createdAt : Date.parse(r.createdAt)) : '—';
        return '<tr><th scope="row" data-l="Pair"><code>' + esc(s0) + '</code> / <code>' + esc(s1) + '</code>' + openB + '</th><td data-l="Venue">' + esc(r.version || r.dex || '—') + '</td><td data-l="When">' + when + '</td><td data-l="Pool"><code title="' + esc(r.pool) + '">' + esc(short(r.pool)) + '</code></td></tr>';
      }).join('') + '</tbody></table>';
  }

  function sourcesHTML(d) {
    const s = Array.isArray(d.sources) ? d.sources : [];
    if (!s.length) return '';
    return '<section class="mkt-card mkt-srcs" aria-labelledby="mkt-sr-h"><h3 class="mkt-h3" id="mkt-sr-h">📚 Where these figures come from</h3><ul class="mkt-srclist">' +
      s.map((x) => {
        const u = /^https:\/\//.test(String(x.url || '')) ? x.url : null;
        const nm = x.id === 'growthepie' ? 'Source: growthepie (CC BY 4.0)' : (x.name || srcName(x.id));
        return '<li>' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(nm) + '</a>' : esc(nm)) + (x.licence && x.id !== 'growthepie' ? ' — licence: ' + esc(x.licence) : '') + '</li>';
      }).join('') + '</ul><p class="mkt-note">This site’s server reads these sources; your browser contacts none of them. A source can be late or wrong, and the figures here are only as good as theirs.</p></section>';
  }

  /* ---------- a token ---------- */
  const WIN_LABEL = { '5m': '5 minutes', '1h': '1 hour', '6h': '6 hours', '24h': '24 hours' };
  function tokenHTML(d) {
    d = d || {};
    const chain = d.chain || S.view.chain, nm = d.name || d.symbol || short(d.address || S.view.token);
    const links = d.links || {};
    const webs = (links.websites || []).filter((x) => x && /^https:\/\//.test(x.url || ''));
    const socs = (links.socials || []).filter((x) => x && /^https:\/\//.test(x.url || ''));
    const scanHref = d.scanner && typeof d.scanner.href === 'string' && /^\/newpairs\?/.test(d.scanner.href) ? d.scanner.href : (SCANS.includes(chain) ? '/newpairs?scan=' + encodeURIComponent(d.address || S.view.token) + '&chain=' + encodeURIComponent(chain) : null);
    const liqPools = Array.isArray(d.pools) ? d.pools.length : 0;
    const w = S.tokens.win;
    const head = '<header class="mkt-vhead">' + avaHTML(d.symbol || d.name, d.logo, true) +
      '<div class="mkt-vt"><p class="mkt-kicker">🪙 Token · ' + esc(chainName(chain)) + '</p>' +
      '<h2 class="mkt-h" id="mkt-vh" tabindex="-1">' + esc(nm) + (d.symbol && d.name ? ' <span class="mkt-sym">$' + esc(d.symbol) + '</span>' : '') + '</h2>' +
      '<p class="mkt-vsub"><code class="mkt-addr">' + esc(d.address || S.view.token) + '</code> <button class="copy-btn" type="button" data-copy="' + esc(d.address || S.view.token) + '" aria-label="Copy the token address" data-tip="Copies the token’s contract address to your clipboard">⧉</button>' +
      (d.at ? ' · gathered ' + agoEl(d.at) : '') + '</p></div></header>';
    const stats = '<dl class="mkt-stats">' +
      stat('Price', d.priceUsd, usd) +
      stat('Market cap', d.mcap, usd) +
      stat('FDV', d.fdv, usd) +
      stat('Liquidity', d.liquidity, usd) +
      stat('Volume, ' + (w === 'custom' ? 'your days' : WIN_LABEL[w] || '24 hours'), w === 'custom' ? (d.custom ? d.custom.volume : { v: null, why: 'no reading for these days' }) : (d.windows && d.windows[w] ? d.windows[w].volume : null), usd) +
      stat('Price change, ' + (w === 'custom' ? 'your days' : WIN_LABEL[w] || '24 hours'), w === 'custom' ? (d.custom ? d.custom.priceChange : { v: null, why: 'no reading for these days' }) : (d.windows && d.windows[w] ? d.windows[w].change : null), pct) +
      '</dl>' + (d.supplyBasis ? '<p class="mkt-note mkt-basis">📐 ' + esc(d.supplyBasis) + '</p>' : '');
    return '<article class="mkt-art" aria-labelledby="mkt-vh">' +
      '<p class="mkt-back"><button class="btn btn-sm btn-ghost" type="button" data-open-chain="' + esc(chain) + '" data-tip="Opens this token’s chain in the main view">← ' + esc(chainName(chain)) + '</button></p>' +
      head + '<div class="mkt-tstats" id="mkt-tstats">' + stats + '</div>' +
      windowsHTML(d) + candlesHTML(d) + poolsHTML(d, liqPools) +
      '<section class="mkt-card mkt-links" aria-labelledby="mkt-lk-h"><h3 class="mkt-h3" id="mkt-lk-h">🔗 Links</h3>' +
        (webs.length || socs.length ? '<ul class="mkt-linklist">' + webs.map((x) => '<li><a href="' + esc(x.url) + '" target="_blank" rel="noopener nofollow">🌐 ' + esc(x.label || x.url.replace(/^https:\/\//, '')) + ' ↗</a></li>').join('') +
          socs.map((x) => '<li><a href="' + esc(x.url) + '" target="_blank" rel="noopener nofollow">' + esc((x.type || 'link').replace(/^./, (c) => c.toUpperCase())) + ' ↗</a></li>').join('') + '</ul><p class="mkt-note">Listed on Dexscreener by whoever runs the token — not checked by this site.</p>'
          : links.why ? '<p class="mkt-empty">' + esc(cap1(String(links.why).replace(/\.$/, ''))) + ', so this token’s website and socials can’t be shown just now — that does not mean it has none.</p>'
          : '<p class="mkt-empty">No website or socials are listed for this token on Dexscreener.</p>') +
        (scanHref ? '<p class="mkt-acts"><a class="btn btn-sm btn-ghost" href="' + esc(scanHref) + '" data-tip="Opens this token in the Scanner page, with its own address bar and history">🔎 Open it in the Scanner</a></p>' : '') +
      '</section>' +
      (SCANS.includes(chain) && !(d.scanner && d.scanner.supported === false)
        ? '<section class="mkt-card mkt-scan" aria-labelledby="mkt-sc-h"><h3 class="mkt-h3" id="mkt-sc-h">🛡️ The Scanner’s full read</h3><p class="mkt-s">The same read the Scanner shows: market, holders, contract powers, pools and more — automated checks, not an audit.</p><div id="mkt-scan-host" data-chain="' + esc(chain) + '" data-token="' + esc(d.address || S.view.token) + '">' + loadingHTML('Waiting until you scroll here…') + '</div></section>'
        : '<section class="mkt-card mkt-scan"><p class="mkt-note">The Scanner reads Robinhood Chain, Ethereum and Solana; ' + esc(chainName(chain)) + ' is not one of them, so there is no safety read here.</p></section>') +
    '</article>';
  }
  function windowsHTML(d) {
    const ws = d.windows || {}, whys = new Set();
    const na = (f) => { const w = fig(f).why; if (w) whys.add(w); return NA; };   // each reason is said once, under the table
    // trades: the server sends a count of them (windows[k].txns, a figure), for 24 h only — not buys and sells
    const rows = ['5m', '1h', '6h', '24h'].map((k) => {
      const x = ws[k] || {};
      return '<tr' + (S.tokens.win === k ? ' class="is-on"' : '') + '><th scope="row" data-l="Window">' + esc(WIN_LABEL[k]) + (S.tokens.win === k ? ' <span class="mkt-s">(your time frame)</span>' : '') + '</th>' +
        '<td data-l="Volume">' + (val(x.volume) != null ? esc(usd(val(x.volume))) : na(x.volume)) + '</td>' +
        '<td data-l="Change">' + (val(x.change) != null ? esc(pct(val(x.change))) : na(x.change)) + '</td>' +
        '<td data-l="Trades">' + (val(x.txns) != null ? esc(count(val(x.txns))) : na(x.txns)) + '</td></tr>';
    });
    let covNote = '';
    if (d.custom) {
      const c = d.custom, cov = c.coverage && typeof c.coverage === 'object' ? c.coverage : null;
      rows.push('<tr class="is-on"><th scope="row" data-l="Window">' + esc(S.tokens.from + ' – ' + S.tokens.to) + '</th><td data-l="Volume">' + (val(c.volume) != null ? esc(usd(val(c.volume))) : na(c.volume)) + '</td>' +
        '<td data-l="Change">' + (val(c.priceChange) != null ? esc(pct(val(c.priceChange))) : na(c.priceChange)) + '</td><td data-l="Trades">' + na({ why: 'your days are summed from price candles, which carry no trade counts' }) + '</td></tr>');
      // where the candles behind your days start (a pool GeckoTerminal has no candles for has no start: its reason is in the row)
      if (cov && typeof cov.from === 'string' && cov.from) covNote = '<p class="mkt-note">Your days are summed from ' + esc(srcName(c.src || 'geckoterminal')) + '’s ' + (cov.tf === 'day' ? 'daily' : 'hourly') + ' candles for its deepest pool' + (cov.pool ? ' (<code title="' + esc(cov.pool) + '">' + esc(short(cov.pool)) + '</code>)' : '') + ', which start ' + esc(cov.from.slice(0, 10)) + '.</p>';
    }
    const any = ['5m', '1h', '6h', '24h'].find((k) => ws[k] && (ws[k].volume || ws[k].change));
    const src = any ? fig(ws[any].volume).src || fig(ws[any].change).src : null, at = any ? fig(ws[any].volume).at : null;
    return '<section class="mkt-card" aria-labelledby="mkt-tw-h"><div class="mkt-card-h"><h3 class="mkt-h3" id="mkt-tw-h">⏱️ Trading by time frame</h3>' + (src ? '<p class="mkt-s">' + srcLine({ src, at }) + (d.custom && d.custom.src ? ' · your days: ' + esc(srcName(d.custom.src)) : '') + '</p>' : '') + '</div>' +
      '<table class="mkt-table"><thead><tr><th scope="col">Window</th><th scope="col">Volume</th><th scope="col">Price change</th><th scope="col">Trades</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
      (whys.size ? '<p class="mkt-note">Not available: ' + [...whys].map((w) => esc(String(w).replace(/\.$/, ''))).join('; ') + '.</p>' : '') + covNote + '</section>';
  }
  function paintTokenWindows() {   // a preset time frame needs no new read: the token's answer has all four windows
    const d = S.viewData; if (!d || !S.view.token) return;
    const box = $('mkt-tstats'); if (!box) return;
    const tmp = document.createElement('div'); tmp.innerHTML = tokenHTML(d);
    const fresh = tmp.querySelector('#mkt-tstats'); if (fresh) box.innerHTML = fresh.innerHTML;
    const oldW = view.querySelector('[aria-labelledby="mkt-tw-h"]'), newW = tmp.querySelector('[aria-labelledby="mkt-tw-h"]');
    if (oldW && newW) oldW.replaceWith(newW);
  }
  function candlesHTML(d) {
    const c = d.candles || {}, rows = Array.isArray(c.rows) ? c.rows : [];
    const tf = c.tf || 'hour';
    // a read that failed says so in its own words — never "no candles", which would say the token has none
    if (rows.length < 2) return '<section class="mkt-card" aria-labelledby="mkt-pc-h"><h3 class="mkt-h3" id="mkt-pc-h">📈 Price</h3><p class="mkt-empty">' +
      (c.why ? (c.retry ? '⏳ ' : '') + esc(cap1(String(c.why).replace(/\.$/, ''))) + '.' : rows.length === 1 ? 'Only one candle so far — a chart needs two.' : 'No candles for this token yet.') + '</p></section>';
    return '<section class="mkt-card" aria-labelledby="mkt-pc-h"><div class="mkt-card-h"><h3 class="mkt-h3" id="mkt-pc-h">📈 Price, one candle per ' + esc(tf) + '</h3><p class="mkt-s">' + srcLine({ src: c.src, at: c.at }) + (c.pool ? ' · pool <code title="' + esc(c.pool) + '">' + esc(short(c.pool)) + '</code>' : '') + '</p></div>' +
      '<figure class="mkt-chart mkt-candles" data-candles="1"><div class="mkt-plot mkt-plot-tall" tabindex="0" role="group" aria-label="Price chart. Use the left and right arrow keys to read each candle."></div><p class="mkt-readout"></p></figure>' +
      '<p class="mkt-note">A ' + esc(tf) + ' with no trades has no candle. The newest candle may still be open. Hollow candles closed higher than they opened; filled ones closed lower.</p></section>';
  }
  function poolsHTML(d, n) {
    const ps = Array.isArray(d.pools) ? d.pools : [], whys = new Set();
    const cell = (x, fmt, why) => { const f = fig(x); if (f.v != null && isFinite(f.v)) return esc(fmt(Number(f.v))); whys.add(f.why || why); return NA; };   // each reason is said once, under the table
    // GeckoTerminal sends a reserve of 0 for one it did not read (the server leaves those out of liquidity too) — never "$0"
    const holds = (p) => { const f = fig(p.reserveUsd); return f.v != null && f.v <= 0 ? cell(null, usd, 'GeckoTerminal reports a reserve of 0 for a pool it did not read') : cell(f, usd, 'GeckoTerminal gave no reserve for this pool'); };
    const rows = ps.map((p) => '<tr><th scope="row" data-l="Pool"><code title="' + esc(p.pool) + '">' + esc(short(p.pool)) + '</code>' + (p.quote ? ' <span class="mkt-s">/ ' + esc(p.quote) + '</span>' : '') + '</th><td data-l="Venue">' + esc(p.dex || '—') + '</td>' +
      '<td data-l="Holds">' + holds(p) + '</td><td data-l="Volume, 24h">' + cell(p.volume24h, usd, 'GeckoTerminal gave no 24 h volume for this pool') + '</td><td data-l="Price">' + cell(p.priceUsd, usd, 'GeckoTerminal gave no price for this pool') + '</td></tr>').join('');
    const head = [n ? n + ' pool' + (n === 1 ? '' : 's') + ' listed, deepest first' : '', ps.length ? srcLine({ src: 'geckoterminal', at: d.at }) : ''].filter(Boolean).join(' · ');
    return '<section class="mkt-card" aria-labelledby="mkt-po-h"><div class="mkt-card-h"><h3 class="mkt-h3" id="mkt-po-h">🏊 Pools</h3><p class="mkt-s">' + head + '</p></div>' +
      (ps.length ? '<table class="mkt-table"><thead><tr><th scope="col">Pool</th><th scope="col">Venue</th><th scope="col">Holds</th><th scope="col">Volume, 24h</th><th scope="col">Price</th></tr></thead><tbody>' + rows +
      '</tbody></table>' + (whys.size ? '<p class="mkt-note">Not available: ' + [...whys].map((w) => esc(String(w).replace(/\.$/, ''))).join('; ') + '.</p>' : '') : '<p class="mkt-empty">No pools are listed for this token.</p>') + '</section>';
  }

  /* ---------- mounting a view: charts, logos, the Scanner's dashboard ---------- */
  function mountView(d) {
    wireLogos(view);
    if (S.view.token) {
      const box = view.querySelector('[data-candles] .mkt-plot');
      const c = d && d.candles;
      if (box && c && Array.isArray(c.rows)) {
        // a candle missing its time or any of its four prices is left out (a gap), never drawn at $0
        const rows = c.rows.map((r) => [toMs(px(r[0])), px(r[1]), px(r[2]), px(r[3]), px(r[4]), r[5] == null ? null : px(r[5])])
          .filter((r) => r[0] > 0 && [0, 1, 2, 3, 4].every((i) => isFinite(r[i]))).sort((a, b) => a[0] - b[0]);
        mountChart(box, { kind: 'candle', rows, fmt: usd, tf: c.tf || 'hour' });
      }
      const host = $('mkt-scan-host');
      if (host) watchScan(host);
    } else {
      const h = (d && d.history) || {};
      view.querySelectorAll('.mkt-chart[data-series] .mkt-plot').forEach((box) => {
        const k = box.closest('[data-series]').dataset.series, def = SERIES.find((s) => s[0] === k);
        const all = seriesOf(h[k]).rows.map((r) => [toMs(r[0]), px(r[1])]).filter((r) => isFinite(r[0]) && isFinite(r[1])).sort((a, b) => a[0] - b[0]);
        mountChart(box, { kind: 'line', all, rows: ranged(all), fmt: def ? def[2] : usd, tf: 'day', ranged: true });
      });
      const p = d && d.pulse && d.pulse.history;
      view.querySelectorAll('.mkt-chart[data-pulse] .mkt-plot').forEach((box) => {
        const k = box.closest('[data-pulse]').dataset.pulse;
        const rows = (Array.isArray(p[k]) ? p[k] : seriesOf(p[k]).rows).map((r) => [toMs(r[0]), px(r[1])]).filter((r) => isFinite(r[0]) && isFinite(r[1])).sort((a, b) => a[0] - b[0]);
        const fmt = k === 'gas' ? gwei : k === 'blockTimeMs' ? (v) => trimZ(Number(v).toFixed(1)) + ' ms' : (v) => amount(v, 'ETH');
        mountChart(box, { kind: 'line', rows, fmt, tf: 'minute', zeroBase: false });
      });
      // only a chart's own table: the newest-pools card uses the same disclosure for its other pools, with its table already drawn
      view.querySelectorAll('.mkt-chart details.mkt-tbl').forEach((det) => det.addEventListener('toggle', () => {
        if (!det.open || det._done) return;
        const chart = det.closest('.mkt-chart'), box = chart && chart.querySelector('.mkt-plot'), s = box && charts.get(box), tw = det.querySelector('.mkt-tblw');
        if (!s || !tw) return;
        det._done = true;
        const rows = (s.all || s.rows || []).slice().reverse();
        tw.innerHTML = '<table class="mkt-table mkt-table-2"><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Value</th></tr></thead><tbody>' +
          rows.map((r) => '<tr><th scope="row" data-l="Day">' + esc(new Date(r[0]).toISOString().slice(0, 10)) + '</th><td data-l="Value">' + esc(s.fmt(r[1])) + '</td></tr>').join('') + '</tbody></table>';
      }));
    }
  }
  const ranged = (all) => { if (!S.range || !all.length) return all; const last = all[all.length - 1][0], from = last - S.range * 864e5; return all.filter((r) => r[0] > from); };
  function redrawRanged() { charts.forEach((s, box) => { if (s.ranged && document.contains(box)) { s.rows = ranged(s.all); s.idx = null; draw(box); } }); }

  /* ════════════════════════════ charts: SVG at the box's own pixel size ════════════════════════════ */
  const charts = new Map();
  const NS = 'http://www.w3.org/2000/svg';
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((es) => es.forEach((e) => { const s = charts.get(e.target); if (s && Math.abs((s.w || 0) - e.contentRect.width) > 2) draw(e.target); })) : null;
  function destroyCharts(root) { charts.forEach((s, box) => { if (root.contains(box)) { if (ro) ro.unobserve(box); charts.delete(box); } }); }
  window.addEventListener('resize', () => { if (!ro) charts.forEach((s, box) => draw(box)); });
  function niceStep(span, n) { const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
  function ticks(lo, hi, n) {
    if (!(hi > lo)) { const d = Math.abs(hi) * 0.1 || 1; lo -= d; hi += d; }
    const st = niceStep(hi - lo, n), a = Math.floor(lo / st) * st, out = [];
    for (let v = a; v <= hi + st * 0.5 && out.length < 8; v += st) out.push(+v.toPrecision(12));
    return out;
  }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function xLabel(ms, tf, spanDays) {
    const d = new Date(ms);
    if (tf === 'day' || tf === 'week') return spanDays > 300 ? MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear() : d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
    return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }
  const xLong = (ms, tf) => (tf === 'day' || tf === 'week' ? new Date(ms).toISOString().slice(0, 10) : utc(ms));
  function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }

  function mountChart(box, spec) {
    charts.set(box, spec);
    if (!box._wired) {
      box._wired = true;
      const at = (clientX) => { const s = charts.get(box); if (!s || !s.geo || !s.svg) return null; const x = clientX - s.svg.getBoundingClientRect().left; let best = 0, bd = Infinity; s.geo.xs.forEach((px, i) => { const dd = Math.abs(px - x); if (dd < bd) { bd = dd; best = i; } }); return best; };
      box.addEventListener('pointermove', (e) => { const i = at(e.clientX); if (i != null) show(box, i, false); });
      box.addEventListener('pointerdown', (e) => { const i = at(e.clientX); if (i != null) show(box, i, false); });
      box.addEventListener('pointerleave', () => show(box, null, false));
      box.addEventListener('blur', () => show(box, null, false));
      box.addEventListener('keydown', (e) => {
        const s = charts.get(box); if (!s || !s.rows.length) return;
        const n = s.rows.length, cur = s.idx == null ? n - 1 : s.idx;
        let i = null;
        if (e.key === 'ArrowLeft') i = Math.max(0, cur - (s.idx == null ? 0 : 1));
        else if (e.key === 'ArrowRight') i = Math.min(n - 1, cur + (s.idx == null ? 0 : 1));
        else if (e.key === 'Home') i = 0;
        else if (e.key === 'End') i = n - 1;
        else if (e.key === 'Escape') { show(box, null, true); return; }
        if (i == null) return;
        e.preventDefault(); show(box, i, true);
      });
    }
    if (ro) ro.observe(box);
    draw(box);
  }
  function draw(box) {
    const s = charts.get(box); if (!s) return;
    const rows = s.rows || [];
    box.textContent = '';
    const W = Math.max(200, Math.floor(box.clientWidth || 300));
    s.w = W;
    const fs = parseFloat(getComputedStyle(box).fontSize) || 16;
    const tall = box.classList.contains('mkt-plot-tall');
    const H = Math.round(Math.max(fs * (tall ? 11 : 8.5), Math.min(W * (tall ? 0.55 : 0.42), fs * (tall ? 16 : 12))));
    const readout = box.parentNode.querySelector('.mkt-readout');
    if (rows.length < 2) { box.innerHTML = '<p class="mkt-empty">Not enough points in this range to draw a line.</p>'; if (readout) readout.textContent = ''; s.geo = null; return; }
    const isC = s.kind === 'candle';
    let lo = Infinity, hi = -Infinity;
    rows.forEach((r) => { const a = isC ? r[3] : r[1], b = isC ? r[2] : r[1]; if (a < lo) lo = a; if (b > hi) hi = b; });
    if (!isC && s.zeroBase !== false && lo >= 0) lo = 0;
    const yt = ticks(lo, hi, 3), y0 = Math.min(lo, yt[0]), y1 = Math.max(hi, yt[yt.length - 1]);
    const labels = yt.map((v) => s.fmt(v) || '');
    const L = Math.ceil(Math.max(...labels.map((l) => l.length)) * fs * 0.6 + fs * 0.6), R = Math.ceil(fs * 0.8), T = Math.ceil(fs * 0.7), B = Math.ceil(fs * 1.9);
    const pw = Math.max(40, W - L - R), volH = isC ? (H - T - B) * 0.2 : 0, ph = H - T - B - volH;
    const t0 = rows[0][0], t1 = rows[rows.length - 1][0], span = Math.max(1, t1 - t0);
    const X = (t) => L + ((t - t0) / span) * pw, Y = (v) => T + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
    const svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'mkt-svg', 'aria-hidden': 'true', focusable: 'false' });
    yt.forEach((v, i) => {
      const y = Y(v);
      if (y < T - 1 || y > T + ph + 1) return;
      el('line', { x1: L, x2: L + pw, y1: y, y2: y, class: 'mkt-grid' }, svg);
      const t = el('text', { x: L - fs * 0.35, y: y + fs * 0.35, 'text-anchor': 'end', class: 'mkt-ax' }, svg); t.textContent = labels[i];
    });
    el('line', { x1: L, x2: L + pw, y1: T + ph + volH, y2: T + ph + volH, class: 'mkt-base' }, svg);
    const spanDays = span / 864e5, xs = pw > fs * 22 ? [0, Math.floor((rows.length - 1) / 2), rows.length - 1] : [0, rows.length - 1];
    xs.forEach((i, k) => {
      const t = el('text', { x: X(rows[i][0]), y: H - fs * 0.45, 'text-anchor': k === 0 ? 'start' : k === xs.length - 1 ? 'end' : 'middle', class: 'mkt-ax' }, svg);
      t.textContent = xLabel(rows[i][0], s.tf, spanDays);
    });
    const geoXs = rows.map((r) => X(r[0]));
    if (isC && pw / rows.length >= 4) {
      const cw = Math.max(2, Math.min(18, (pw / rows.length) * 0.66));
      let vmax = 0; rows.forEach((r) => { if (r[5] > vmax) vmax = r[5]; });
      rows.forEach((r, i) => {
        const x = geoXs[i], up = r[4] >= r[1];
        el('line', { x1: x, x2: x, y1: Y(r[2]), y2: Y(r[3]), class: 'mkt-wick' + (up ? ' up' : ' dn') }, svg);
        const yA = Y(Math.max(r[1], r[4])), yB = Y(Math.min(r[1], r[4]));
        el('rect', { x: x - cw / 2, y: yA, width: cw, height: Math.max(1, yB - yA), class: 'mkt-body' + (up ? ' up' : ' dn') }, svg);
        if (vmax > 0 && r[5] != null) { const vh = (r[5] / vmax) * (volH - 2); el('rect', { x: x - cw / 2, y: T + ph + volH - vh, width: cw, height: Math.max(0.5, vh), class: 'mkt-vol' }, svg); }
      });
    } else {
      const k = isC ? 4 : 1;
      const d = rows.map((r, i) => (i ? 'L' : 'M') + geoXs[i].toFixed(1) + ' ' + Y(r[k]).toFixed(1)).join(' ');
      if (!isC) el('path', { d: d + ' L' + geoXs[geoXs.length - 1].toFixed(1) + ' ' + (T + ph) + ' L' + geoXs[0].toFixed(1) + ' ' + (T + ph) + ' Z', class: 'mkt-area' }, svg);
      el('path', { d, class: 'mkt-line' }, svg);
    }
    s.guide = el('line', { x1: 0, x2: 0, y1: T, y2: T + ph + volH, class: 'mkt-guide', visibility: 'hidden' }, svg);
    s.dot = el('circle', { cx: 0, cy: 0, r: Math.max(3, fs * 0.22), class: 'mkt-dot', visibility: 'hidden' }, svg);
    box.appendChild(svg);
    s.svg = svg; s.geo = { xs: geoXs, Y, isC };
    s.readout = readout;
    show(box, s.idx != null && s.idx < rows.length ? s.idx : null, false);
  }
  function summary(s) {
    const rows = s.rows; if (!rows.length) return '';
    const k = s.kind === 'candle' ? 4 : 1, last = rows[rows.length - 1];
    let mi = 0, ma = 0;
    rows.forEach((r, i) => { if (r[k] < rows[mi][k]) mi = i; if (r[k] > rows[ma][k]) ma = i; });
    return 'Latest ' + xLong(last[0], s.tf) + ': ' + s.fmt(last[k]) + ' · in view, low ' + s.fmt(rows[mi][k]) + ' (' + xLong(rows[mi][0], s.tf) + '), high ' + s.fmt(rows[ma][k]) + ' (' + xLong(rows[ma][0], s.tf) + ')';
  }
  function show(box, i, announce) {
    const s = charts.get(box); if (!s || !s.geo) return;
    s.idx = i;
    if (i == null) {
      s.guide.setAttribute('visibility', 'hidden'); s.dot.setAttribute('visibility', 'hidden');
      if (s.readout) s.readout.textContent = summary(s);
      return;
    }
    const r = s.rows[i], x = s.geo.xs[i], k = s.kind === 'candle' ? 4 : 1;
    s.guide.setAttribute('x1', x); s.guide.setAttribute('x2', x); s.guide.setAttribute('visibility', 'visible');
    s.dot.setAttribute('cx', x); s.dot.setAttribute('cy', s.geo.Y(r[k])); s.dot.setAttribute('visibility', 'visible');
    const t = s.kind === 'candle'
      ? xLong(r[0], s.tf) + ' · opened ' + s.fmt(r[1]) + ', high ' + s.fmt(r[2]) + ', low ' + s.fmt(r[3]) + ', closed ' + s.fmt(r[4]) + ' (' + (r[4] >= r[1] ? 'up' : 'down') + ')' + (r[5] != null ? ' · volume ' + usd(r[5]) : '')
      : xLong(r[0], s.tf) + ' · ' + s.fmt(r[1]);
    if (s.readout) s.readout.textContent = t;
    if (announce) say(t);
  }

  /* ════════════════════════════ the Scanner's dashboard, when the reader gets to it ════════════════════════════ */
  function watchScan(host) {
    if (typeof IntersectionObserver !== 'function') { loadScan(host); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); loadScan(host); } }, { rootMargin: '300px 0px' });
    io.observe(host);
  }
  async function loadScan(host) {
    if (host._asked) return; host._asked = true;
    const my = ++seq.scan, chain = host.dataset.chain, addr = host.dataset.token;
    host.innerHTML = loadingHTML('Reading ' + chainName(chain) + ' for ' + short(addr) + '…');
    try {
      const j = await getJSON('/api/market/scan?chain=' + encodeURIComponent(chain) + '&address=' + encodeURIComponent(addr));
      if (my !== seq.scan || !document.contains(host)) return;
      const p = j && (j.pair || (j.token && j.market ? j : null));
      if (!p) {
        host.innerHTML = '<p class="mkt-empty">' + esc((j && (j.message || j.error)) || (j && j.notFound ? 'The Scanner found no token or pool at this address on ' + chainName(chain) + '.' : 'The Scanner could not read this token just now — nothing here is a judgement about it.')) + '</p>' + retryBtn('scan');
        return;
      }
      if (!p.chain) p.chain = j.chain || chain;
      const sc = j.scan || {};
      const meta = '<p class="sc-hit-s">' + (sc.readAt ? (sc.stale ? 'Last read ' : 'Read ') + agoEl(sc.readAt) : 'Read just now') + ' · this read is not added to the Scanner’s public “recently scanned” list.' +
        (sc.stale ? ' <span class="sc-stale">⏳ This is the last snapshot — the chain could not be reached just now. Nothing on it is live.</span>' : '') + '</p>';
      if (!(window.NPCard && NPCard.dashboardHTML)) { host.innerHTML = '<p class="mkt-empty">The Scanner’s dashboard did not load on this page — open it in the Scanner instead.</p>'; return; }
      host.innerHTML = NPCard.dashboardHTML(p, { kicker: '🛡️ Scanner', meta, level: 3 });
      if (NPCard.mountDashboard) NPCard.mountDashboard(host);
    } catch (e) {
      if (my !== seq.scan || !document.contains(host)) return;
      host.innerHTML = '<p class="mkt-err-t">⏳ ' + esc(errText(e, 'this token')) + '</p>' + retryBtn('scan');
      host._asked = false;
    }
  }

  /* ════════════════════════════ search ════════════════════════════ */
  const form = $('mkt-search'), q = $('mkt-q'), results = $('mkt-results');
  function closeResults() { if (results) { results.hidden = true; results.innerHTML = ''; } }
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = String(q.value || '').trim().slice(0, 80);
    if (text.length < 2) { results.hidden = false; results.innerHTML = '<p class="mkt-empty">Type at least two letters, or paste an address.</p>'; return; }
    const my = ++seq.search;
    results.hidden = false; results.innerHTML = loadingHTML('Looking for “' + text + '”…');
    try {
      const j = await getJSON('/api/market/search?q=' + encodeURIComponent(text));
      if (my !== seq.search) return;
      const chains = Array.isArray(j && j.chains) ? j.chains : [], toks = Array.isArray(j && j.tokens) ? j.tokens : [];
      chains.forEach((c) => { if (c && c.key && c.name) names.set(c.key, c.name); });
      const isAddr = TOKEN_ADDR.test(text);
      let h = '';
      if (chains.length) h += '<h3 class="mkt-gh">Chains</h3><ul class="mkt-list mkt-list-in">' + chains.slice(0, 10).map((c) => '<li><button class="mkt-row" type="button" data-chain="' + esc(c.key) + '" data-tip="Opens ' + esc(c.name) + ' in the main view">' + avaHTML(c.name, c.logo) + '<span class="mkt-nm"><b>' + esc(c.name) + '</b></span></button></li>').join('') + '</ul>';
      if (toks.length) h += '<h3 class="mkt-gh">Tokens</h3><ul class="mkt-list mkt-list-in">' + toks.slice(0, 30).map((t) => {
        const nm = t.name || t.symbol || short(t.address), pr = val(t.priceUsd), lq = val(t.liquidity), vo = val(t.volume24h);
        const body = avaHTML(t.symbol || t.name, t.logo) +
          '<span class="mkt-nm"><b>' + esc(nm) + (t.symbol ? ' <span class="mkt-sym">$' + esc(t.symbol) + '</span>' : '') + '</b><small>' + esc(chainName(t.chain)) + ' · <code>' + esc(short(t.address)) + '</code>' + (lq != null ? ' · Liq ' + esc(usd(lq)) : '') + (vo != null ? ' · Vol ' + esc(usd(vo)) : '') + (t.src ? ' · ' + esc(srcName(t.src)) : '') + '</small>';
        const figHTML = '<span class="mkt-fig">' + (pr != null ? '<b>' + esc(usd(pr)) + '</b>' : '') + '</span>';
        // a hit the main view cannot read (a chain it does not read, an address it does not take there) is said, not offered
        if (!readable(t.chain, t.address)) {
          return '<li><div class="mkt-row mkt-row-off">' + body + '<small class="mkt-off">Not opened here: ' + (READS.includes(t.chain) ? 'this is not a token address the main view reads on ' + esc(chainName(t.chain)) : 'the main view reads tokens on ' + esc(READS.map(chainName).join(', ')) + ' only') + '.</small></span>' + figHTML + '</div></li>';
        }
        return '<li><button class="mkt-row" type="button" data-chain="' + esc(t.chain) + '" data-token="' + esc(t.address) + '" data-tip="Opens ' + esc(nm) + ' on ' + esc(chainName(t.chain)) + ' in the main view">' + body + '</span>' + figHTML + '</button></li>';
      }).join('') + '</ul>';
      if (!h && isAddr) {
        const evm = /^0x/i.test(text);
        h = '<p class="mkt-empty">No chain or token on record matches that address.</p><p class="mkt-acts">' + (evm ? ['robinhood', 'ethereum'] : ['solana']).map((c) => '<button class="btn btn-sm btn-ghost" type="button" data-chain="' + c + '" data-token="' + esc(text) + '" data-tip="Asks the site to read this address as a token on ' + esc(chainName(c)) + '">Open it on ' + esc(chainName(c)) + '</button>').join(' ') + '</p>';
      }
      // Dexscreener not read: say so, and never call the result a "not found" there
      const dsWhy = j && j.why ? cap1(String(j.why).replace(/\.$/, '')) : '';
      results.innerHTML = '<div class="mkt-res-h"><p class="mkt-s">' + (h ? 'Results for “' + esc(text) + '” — pick one to open it below.' : '') +
          (dsWhy ? ' <span class="mkt-err-t">⏳ ' + esc(dsWhy) + ': only this site’s own records were searched.</span>' : '') + '</p>' +
          '<span class="mkt-res-acts">' + (dsWhy ? retryBtn('search') + ' ' : '') + '<button class="btn btn-sm btn-ghost mkt-mini" type="button" data-close-results="1" data-tip="Hides these search results">✕ Close</button></span></div>' +
        (h || '<p class="mkt-empty">Nothing matches “' + esc(text) + '” among the chains and tokens this site keeps' + (dsWhy ? '. Dexscreener could not be searched just now, so this is not a “not found” there — try again in a minute.' : ', nor on Dexscreener.') + '</p>');
      wireLogos(results);
      const n = chains.length + toks.length;
      const sr = $('mkt-search-sr'); if (sr) sr.textContent = n ? n + ' result' + (n === 1 ? '' : 's') + ' for ' + text : 'No results for ' + text;
    } catch (err) {
      if (my !== seq.search) return;
      results.innerHTML = '<p class="mkt-err-t">⏳ ' + esc(errText(err, 'your search')) + '</p>';
    }
  });
  if (results) results.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-results]')) { closeResults(); q.focus(); return; }
    const b = e.target.closest('[data-chain]'); if (!b) return;
    closeResults();
    open({ chain: b.dataset.chain, token: b.dataset.token || null }, true);
  });
  if (q) q.addEventListener('keydown', (e) => { if (e.key === 'Escape' && results && !results.hidden) { e.preventDefault(); closeResults(); } });

  /* ════════════════════════════ start ════════════════════════════ */
  window.addEventListener('popstate', () => { readURL(); syncControls(); loadView(false); loadList(); });
  readURL();
  S.shown = pageSize();
  // a link that opened the page on a token lists that token's chain on the side, Top tokens selected
  if (S.view.token) setTab('tokens', false); else { syncControls(); loadList(); }
  loadView(false);
})();
