/* ===== market.js — the Market Data page (/market) =====================================================================
 * Owner, 2026-10-26: "a full dashboard of all of the chain's data … Robinhood being the default view … a main view that
 * when a user uses the search bar … pulls up full details … when a user clicks on the chain or token in list view on the
 * side, it pulls it up as the main view … lists of the top chains and top tokens … highest or lowest … time frame (their
 * own time or default times), Market Cap, Liquidity, TVL and Volume."
 *
 * What it reads: only this site's own /api/market/* routes (the server reads DefiLlama, L2BEAT, growthepie, CoinGecko,
 * CoinLore, GeckoTerminal, Dexscreener and the chain; the browser contacts none of them — the CSP's connect-src stays as it is).
 * A chain's market cap carries its cross-check (owner, 2026-10-28: "make sure you are showing the right market caps for all
 * of the chains pulled from multiple sources and cross verified"): a chip beside the figure says whether CoinGecko's figure
 * and CoinLore's agree, and the chain view lists each source's figure, price and supply with the notes (lib/chainmcap.js).
 * What it promises: every figure is drawn with its source and the time it was read; a figure the server could not read
 * arrives as { v: null, why } and is shown as missing with that reason — never as 0. Charts are drawn here, in SVG, at the
 * box's own pixel size (so their labels keep the page's text floor), with a hover / arrow-key readout and a table.
 * The address bar is the state: /market?chain=<key>[&token=<address>][&window=<w>[&from=YYYY-MM-DD&to=YYYY-MM-DD]][&tchain=<key>]
 * [&tab=rwa[&rview=…&rsort=…&rdir=…&rkind=…&rissuer=…]] — a view is linkable, and Back / Forward walk the views. tchain is Top tokens' chain filter (owner, 2026-10-27: "add all
 * chain's top tokens to the top tokens tab and allow users to filter by chain using the chain's logo", then "Make the chain
 * picker filter be a drop down picker with the names of each chain and their logo"): absent, the list is every chain's; it
 * is independent of the main view, which stays on Robinhood Chain unless the reader opens something else.
 * For a token on Robinhood Chain, Ethereum or Solana the main view ends with the Scanner's own dashboard
 * (NPCard.dashboardHTML + NPCard.mountDashboard, newpairs.js), fed by /api/market/scan, which reads it without adding it to
 * the public "recently scanned" list — fetched only when the reader scrolls to it.
 * The 🏛️ RWAs tab (owner, 2026-10-28: "Add in a whole RWA section that just looks at Robinhood RWAs, make it tab on the market
 * data page, Show all the top RWAs and show all the tokens that are connected to those RWAs and filter them by TVL and Liquidity
 * and Market Cap … what is an RWA vs not an RWA … the relevant data that should be highlighted for our Users to best do their
 * their own research"): Robinhood Chain's real-world-asset tokens from /api/market/rwa — the server decides what counts, on
 * evidence (lib/rwa.js: Robinhood's registry, the token's code on the chain, this site's list of other issuers checked on the
 * chain — never a name); this page shows that evidence. A token that counts carries its RWA facts on its token view (the
 * token answer's rwa key, then /api/market/rwa/token): the evidence, what a holder holds, its price against the underlying's,
 * its corporate actions, its size, the powers its issuer keeps and the tokens paired with it. Not affiliated with Robinhood.
 * Above the two columns, the 🫧 bubble map of the whole crypto market (owner, 2026-10-30: "a view like this that shows a 24 quick
 * visual on the top tokens across the whole market"): CoinGecko's 100 largest coins from /api/market/heatmap, a bubble each — its
 * area the market cap, its colour the 24 h change — packed and drawn here in SVG (no library), with a list for the keyboard. Whether
 * it is folded away is the one thing this page keeps in the browser (localStorage 'jsi:market-map', behind try/catch).
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
    if (a >= 1e12) return sig(v / 1e12) + 'T';   // BitTorrent's 965 trillion tokens: "965T", never "965416B"
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
  const SRC = { defillama: 'DefiLlama', l2beat: 'L2BEAT', growthepie: 'growthepie', coingecko: 'CoinGecko', coinlore: 'CoinLore', geckoterminal: 'GeckoTerminal', dexscreener: 'Dexscreener', rpc: 'the chain’s public node', site: 'this site',
    robinhood: 'Robinhood’s Stock Token API', chainlink: 'Chainlink' };
  const GTP = '<a class="mkt-src-l" href="https://www.growthepie.com" target="_blank" rel="noopener">Source: growthepie (CC BY 4.0)</a>';
  const fig = (x) => (x == null ? { v: null } : typeof x === 'number' ? { v: x } : typeof x === 'object' ? x : { v: null });
  const val = (x) => { const f = fig(x); return f.v == null || !isFinite(f.v) ? null : Number(f.v); };
  const srcName = (id) => SRC[id] || String(id || 'the source');
  function srcLine(f) {   // "DefiLlama · 12 min ago" — growthepie's licence asks for its attribution, with a link
    if (!f || !f.src) return f && f.at ? agoEl(f.at) : '';
    return (f.src === 'growthepie' ? GTP : esc(srcName(f.src))) + (f.at ? ' · ' + agoEl(f.at) : '');
  }
  const NA = '<span class="mkt-na">Not available</span>';
  /* a chain market cap's cross-check, as a chip beside the figure: the words say it (a tick or a warning sign as well as the colour) */
  const MCAP_CAP = 'Market cap of the chain’s own token: CoinGecko’s figure, checked against CoinLore';
  const CHK = {
    agreed: ['✓ 2 sources agree', 'is-ok', 'CoinGecko and CoinLore give market caps within 10% of each other'],
    differs: ['⚠ Sources differ', 'is-warn', 'CoinGecko and CoinLore give market caps more than 10% apart'],
    single: ['1 source', 'is-one', 'Only one source gave a market cap for this token, so nothing checks it'],
  };
  const chkOf = (f) => { const c = f && f.check; return c && CHK[c.status] ? c : null; };
  const mcapChip = (f) => { const c = chkOf(f); return c ? '<span class="mkt-chk ' + CHK[c.status][1] + '" title="' + esc(CHK[c.status][2] + (c.status === 'differs' ? ' — the chain’s view says why' : '')) + '">' + esc(CHK[c.status][0]) + '</span>' : ''; };
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
  // the RWA tab's choices (/api/market/rwa's, lib/marketdata.js): what is shown, the ranking, the order, the kind of asset, the issuer
  const RWA_VIEWS = ['assets', 'tokens', 'connected', 'stables'], RWA_SORTS = ['value', 'tvl', 'liquidity', 'mcap', 'volume', 'premium'];
  const RWA_KINDS = ['all', 'stock', 'etf', 'bond', 'commodity', 'credit'];
  const RWA_DEF = { view: 'assets', sort: 'value', dir: 'desc', kind: 'all', issuer: 'all' };
  const ISSUER_KEY = /^[a-z0-9]{2,16}$/;   // the server names its issuers (rhj, ondo, …) and falls back to all for one it does not know

  /* ---------- state ---------- */
  const S = {
    tab: 'chains',
    chains: { sort: 'tvl', dir: 'desc', win: '24h', from: '', to: '' },
    tokens: { sort: 'volume', dir: 'desc', win: '24h', from: '', to: '', all: false, tchain: '' },   // tchain '' = every chain
    rwa: Object.assign({}, RWA_DEF),   // the RWA tab's choices; in the address (tab=rwa&rview=…) while that tab is open
    view: { chain: DEFAULT_CHAIN, token: null },
    chainRows: null, chainAns: null, tokenAns: null, tokenFor: null, viewData: null, rwaAns: null, urlTab: null,
    shown: 0, range: 90,
  };
  const names = new Map();   // chain key → name, from every answer that names one
  const logos = new Map();   // chain key → its logo through the server's proxy, from the chains list or the all-chains token list
  const chainName = (k) => names.get(k) || KNOWN[k] || k;
  const chainRow = (k) => (S.chainRows || []).find((r) => r.key === k) || null;
  // the same token: a 0x address in any case, a Solana one exactly as written (it is case-sensitive)
  const sameToken = (a, b) => (/^0x/i.test(String(a || '')) ? String(a).toLowerCase() === String(b || '').toLowerCase() : String(a || '') === String(b || ''));

  /* ---------- the address bar ---------- */
  function readURL() {
    const q = new URLSearchParams(location.search);
    const c = (q.get('chain') || '').toLowerCase(), t = q.get('token') || '', w = q.get('window') || '', f = q.get('from') || '', to = q.get('to') || '';
    // Top tokens' chain filter: one of the chains the server reads, or every chain (absent, or anything else)
    const tc = (q.get('tchain') || '').toLowerCase(), tchain = READS.includes(tc) ? tc : '';
    S.tchainMoved = tchain !== S.tokens.tchain; S.tokens.tchain = tchain;
    S.view = { chain: CHAIN_KEY.test(c) ? c : DEFAULT_CHAIN, token: TOKEN_ADDR.test(t) ? (/^0x/i.test(t) ? t.toLowerCase() : t) : null };
    const k = S.view.token ? S.tokens : S.chains, wins = S.view.token ? TOKEN_WINS : CHAIN_WINS;
    // an address without a time frame is the default one: Back to /market shows the 24 hours it showed, not the 7 days picked since
    k.win = '24h'; k.from = ''; k.to = '';
    if (wins.includes(w)) {
      if (w === 'custom') { if (DAY.test(f) && DAY.test(to) && f <= to) { k.win = 'custom'; k.from = f; k.to = to; } }
      else k.win = w;
    }
    // the RWA tab, with its choices where they are not the defaults; anything else in them is the default (the server does the same)
    S.urlTab = q.get('tab') === 'rwa' ? 'rwa' : null;
    if (S.urlTab) {
      const one = (v, list, d) => (list.includes(v) ? v : d), ri = q.get('rissuer') || '';
      S.rwa = { view: one(q.get('rview'), RWA_VIEWS, RWA_DEF.view), sort: one(q.get('rsort'), RWA_SORTS, RWA_DEF.sort), dir: q.get('rdir') === 'asc' ? 'asc' : 'desc',
        kind: one(q.get('rkind'), RWA_KINDS, RWA_DEF.kind), issuer: ISSUER_KEY.test(ri) ? ri : RWA_DEF.issuer };
    }
  }
  function urlFor(v) {
    const p = new URLSearchParams();
    p.set('chain', v.chain);
    if (v.token) p.set('token', v.token);
    const k = v.token ? S.tokens : S.chains;
    if (k.win !== '24h') { p.set('window', k.win); if (k.win === 'custom') { p.set('from', k.from); p.set('to', k.to); } }
    if (S.tokens.tchain) p.set('tchain', S.tokens.tchain);
    if (S.tab === 'rwa') {
      p.set('tab', 'rwa');
      for (const [k, n] of [['view', 'rview'], ['sort', 'rsort'], ['dir', 'rdir'], ['kind', 'rkind'], ['issuer', 'rissuer']]) if (S.rwa[k] !== RWA_DEF[k]) p.set(n, S.rwa[k]);
    }
    return '/market?' + p.toString();
  }
  function writeURL(push) {
    const u = urlFor(S.view);
    if (u === location.pathname + location.search) return;
    try { history[push ? 'pushState' : 'replaceState']({ mkt: 1 }, '', u); } catch {}
  }

  /* ---------- reading the site's own API ---------- */
  const memo = new Map();   // url → { at, j }: a tab switch or a Back does not ask again within a minute
  const seq = { list: 0, view: 0, scan: 0, search: 0, rwa: 0 };
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
  const ownLogo = (logo) => typeof logo === 'string' && /^\/api\/[\w/.-]+(\?[^"'<>\s]*)?$/.test(logo);
  function avaHTML(name, logo, big) {
    const img = ownLogo(logo)
      ? '<img class="mkt-logo" src="' + esc(logo) + '" alt="" loading="lazy" decoding="async" width="' + (big ? 56 : 32) + '" height="' + (big ? 56 : 32) + '">' : '';
    return '<span class="mkt-ava' + (big ? ' mkt-ava-lg' : '') + '" aria-hidden="true"><span class="mkt-mono">' + esc(mono(name)) + '</span>' + img + '</span>';
  }
  // a chain's initials, for its button when its logo is missing or does not load: an acronym as it is (OP, BSC), else the
  // first letters of two words (RC), else the first two letters of the one (ET)
  function initials(name) {
    const w = String(name || '?').trim().split(/\s+/);
    if (/^[A-Z0-9]{2,4}$/.test(w[0])) return w[0];
    return (w.length > 1 ? w[0].charAt(0) + w[1].charAt(0) : w[0].slice(0, 2)).toUpperCase() || '?';
  }
  /* no Robinhood artwork (the RWA tab says none is used): a Robinhood Chain token's picture whose file is named after the token's own
     address is CoinGecko's copy of Robinhood's logo for a Stock Token. The server leaves those out (and every Stock Token's picture);
     this keeps an answer from before that from drawing one */
  const ownPic = (logo, addr) => {
    const a = String(addr || '').toLowerCase().replace(/^0x/, ''); if (!logo || !/^[0-9a-f]{40}$/.test(a)) return false;
    let u = String(logo); try { u = decodeURIComponent(u); } catch {}
    return new RegExp('/(?:0x)?' + a + '\\.(?:png|jpe?g|webp|svg|gif)(?:[?&#]|$)', 'i').test(u);
  };
  const logoFor = (r, chain) => (chain === 'robinhood' && ownPic(r.logo, r.address) ? null : r.logo);
  function wireLogos(root) { root.querySelectorAll('img.mkt-logo').forEach((img) => { if (img._w) return; img._w = 1; img.addEventListener('error', () => img.remove()); }); }

  /* ════════════════════════════ the side column ════════════════════════════ */
  const CH_SORT = { tvl: 'TVL', volume: 'volume', liquidity: 'DEX liquidity', mcap: 'market cap', fees: 'gas fees' };
  const TK_SORT = { volume: 'volume', liquidity: 'liquidity', mcap: 'market cap', fdv: 'FDV', change: 'price change' };
  const tabs = [...document.querySelectorAll('#mkt-side [role="tab"]')];   // every tab the tablist holds: Top chains, Top tokens, RWAs
  const ctl = { chains: $('mkt-ctl-chains'), tokens: $('mkt-ctl-tokens'), rwa: $('mkt-ctl-rwa') };   // each tab's controls, by its data-tab
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
  /* the RWA list: only what is not the default is sent (the bare /api/market/rwa is Top RWAs by value on chain). Connected tokens and
     Stablecoins rank by their own two figures (a pool's reserve or volume; what circulates or liquidity), so the ranking sent is the
     one that applies to the view; a stablecoin has no kind or issuer here */
  const rwaSortOf = (r) => (r.view === 'connected' ? (r.sort === 'volume' ? 'volume' : 'liquidity') : r.view === 'stables' ? (r.sort === 'liquidity' ? 'liquidity' : 'value') : r.sort);
  function rwaURL() {
    const r = S.rwa, p = new URLSearchParams(), eff = Object.assign({}, r, { sort: rwaSortOf(r) });
    for (const k of ['view', 'sort', 'dir', 'kind', 'issuer']) {
      if (r.view === 'stables' && (k === 'kind' || k === 'issuer')) continue;
      if (eff[k] !== RWA_DEF[k]) p.set(k, eff[k]);
    }
    const q = p.toString();
    return '/api/market/rwa' + (q ? '?' + q : '');
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
    if (filterBox) filterBox.querySelectorAll('[data-tchain]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tchain === (S.tokens.tchain || 'all'))));
    paintPicked();
    syncRwa();
  }
  // the RWA tab's chips: the choice pressed (a tick as well as the fill), and only the groups that apply to the view shown — Connected
  // tokens and Stablecoins rank by their own figures; a stablecoin has no kind or issuer here
  function syncRwa() {
    const box = ctl.rwa; if (!box) return;
    const r = S.rwa, eff = rwaSortOf(r);
    const press = (attr, v) => box.querySelectorAll('[data-' + attr + ']').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-' + attr) === v)));
    press('rview', r.view); press('rsort', eff); press('rdir', r.dir); press('rkind', r.kind); press('rissuer', r.issuer);
    const show = (id, on) => { const g = $(id); if (g) g.hidden = !on; };
    show('mkt-rs-g', r.view === 'assets' || r.view === 'tokens'); show('mkt-rsc-g', r.view === 'connected'); show('mkt-rss-g', r.view === 'stables');
    show('mkt-rk-g', r.view !== 'stables'); show('mkt-ri-g', r.view !== 'stables');
    // Order, Kind and Issuer sit in one pop-down (Show and Rank by stay in sight): its summary says what is chosen, so a filter is never hidden
    const now = $('mkt-rf-now');
    if (now) now.textContent = [r.dir === 'asc' ? 'lowest first' : 'highest first', r.view === 'stables' ? '' : r.kind === 'all' ? 'every kind' : RWA_KIND_IN[r.kind] || r.kind,
      r.view === 'stables' ? '' : r.issuer === 'all' ? 'every issuer' : (ISSUER_W[r.issuer] || r.issuer) + ' only'].filter(Boolean).join(' · ');
  }

  /* ---------- Top tokens' chain filter: a button that names the chain chosen, and the list of every chain the server reads ----------
     A disclosure, as the bell's list is (notifications.js): a real button and a list of real buttons, not role="menu" — these
     are choices, not commands, and a menu promises arrow-key behaviour and a trap the reader never asked for. The arrows move
     between the chains as a convenience; Tab goes through them as usual, and leaving the list with Tab closes it. */
  const pick = { box: $('mkt-tchains'), btn: $('mkt-tchain-b'), drawn: '', fixed: false, up: false, under: null, soon: 0, watching: false };
  const filterBox = $('mkt-tchain-p');
  // a chain's mark: its logo laid over its initials, so a logo that is missing or does not load leaves the initials; every
  // chain together has a drawn mark of its own (no one chain's logo stands for all of them)
  function markHTML(k, nm) {
    if (k === 'all') return '<span class="mkt-ava mkt-ava-cf mkt-ava-all" aria-hidden="true"></span>';
    const lg = logos.get(k);
    return '<span class="mkt-ava mkt-ava-cf" aria-hidden="true"><span class="mkt-mono">' + esc(initials(nm)) + '</span>' +
      (ownLogo(lg) ? '<img class="mkt-logo" src="' + esc(lg) + '" alt="" decoding="async" width="32" height="32">' : '') + '</span>';
  }
  const pickName = (k) => (k === 'all' ? 'All chains' : chainName(k));
  function filterHTML(k) {
    const nm = pickName(k);
    return '<li><button class="npm-item mkt-copt" type="button" data-tchain="' + esc(k) + '" aria-pressed="false" data-tip="' +
        (k === 'all' ? 'Ranks the most-traded tokens of every chain this site reads together — each row names its chain' : esc(nm) + ' only: its most-traded tokens, ranked the way you picked — the main view stays where it is') + '">' +
      '<span class="mkt-tick" aria-hidden="true">✓</span>' + markHTML(k, nm) + '<span class="mkt-copt-n">' + esc(nm) + '</span></button></li>';
  }
  // the button says the chain chosen in words, its logo beside them; "Chain: " is said to a screen reader, as the group's
  // label is printed above it. Drawn again only when the choice, its name or its logo changes — a logo that failed stays failed
  function paintPicked() {
    if (!pick.btn) return;
    const k = S.tokens.tchain || 'all', id = k + '|' + pickName(k) + '|' + (logos.get(k) || '');
    if (pick.drawn === id) return;
    pick.drawn = id;
    pick.btn.innerHTML = markHTML(k, pickName(k)) + '<span class="sr-only">Chain: </span><span class="mkt-cpick-t">' + esc(pickName(k)) + '</span><span class="mkt-caret" aria-hidden="true"></span>';
    wireLogos(pick.btn);
  }
  // drawn again only when a name or a logo arrives; the chain that had the focus keeps it, and an open list stays open
  function paintFilter() {
    if (!filterBox) return;
    const had = filterBox.contains(document.activeElement) ? document.activeElement.dataset.tchain : null;
    filterBox.innerHTML = ['all'].concat(READS).map(filterHTML).join('');
    wireLogos(filterBox);
    syncControls();
    if (had) { const b = filterBox.querySelector('[data-tchain="' + had + '"]'); if (b) b.focus({ preventScroll: true }); }
    fitPick();
  }
  // the names and logos an answer gives (the chains list's rows, the all-chains list's networks): true when one is new
  function learnChains(list, keyOf) {
    let changed = false;
    for (const x of Array.isArray(list) ? list : []) {
      const k = x && keyOf(x); if (!k || !READS.includes(k)) continue;
      if (x.name && names.get(k) !== x.name) { names.set(k, x.name); changed = true; }
      if (ownLogo(x.logo) && logos.get(k) !== x.logo) { logos.set(k, x.logo); changed = true; }
    }
    return changed;
  }
  /* Where the open list goes. It hangs under the button, or over it when the room under it is short and there is more above
     — the page is never moved to make room (a page that jumps under the pointer turns the second press of a double-click into
     a pick nobody made, and moves the main view the reader was on) — and it is as tall as that room, scrolling inside when it
     is longer. Below 1280px, or on a screen under 700px tall, it lies over what is pinned to the bottom of the screen — the
     music player and its nudge, the ✏️ SEND IT button, Sendy and his bubble — as the nav's own menus do (market.css), so
     nothing pinned covers a chain. From 1280px on a taller screen the side column stays in view (sticky): it is a layer of
     its own, under what is pinned, and it clips what runs past its edge — on a page not yet scrolled the button sits a hand's
     width above the bottom of the screen, with no room in the column either way. There the list is fixed to the screen
     beside the button (out of the column's clip, so it can open upward over the page above it) and kept out from under what
     is pinned instead: laid out as tall as the room, it is hit-tested across and stops before the first point where
     something else is on top. What is pinned can change while it is open (the nudge appears on a first tap and leaves by
     itself; Sendy greets), so a change there is looked at again — on the change, never on a timer — and the list is
     measured again only when something new lies over it or what lay over it has gone. */
  const navH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 60;   // nav.js publishes it
  const EDGE = 8;   // the list stops this far short of the nav, the bottom of the screen and anything over it
  // what is on top at a point. The description bubble (tips.js) is looked through: it labels whatever has the focus or the
  // pointer and comes and goes with them, so it is not something to make room for — and lying over the nudge, it must not
  // hide the nudge from the look (it did: the list grew under the nudge while a chip's description lay over it, then shrank
  // when the pointer moved and the description went, over and over)
  function topAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.closest('#tip-bubble') ? document.elementsFromPoint(x, y).find((e) => !e.closest('#tip-bubble')) || null : el;
  }
  // the first point going away from the button (down the list, or up it when it opens upward) where something else is on top,
  // or null. Five columns stand clear of the rounded corners, where a point is outside the list's own box, and two more run
  // down its edges between them (the player stands over the column's corner, beside the five). It looks every 24px — nothing
  // pinned there is shorter — then goes back over the last 24px, 4px at a time
  function pickCover(r, band, up) {
    const lo = Math.max(r.top, band.top) + 2, hi = Math.min(r.bottom, band.bot) - 2, step = up ? -1 : 1, from = up ? hi : lo;
    if (hi <= lo) return null;
    const xs = [0, 0.25, 0.5, 0.75, 1].map((f) => r.left + 18 + (r.width - 36) * f), edges = [r.left + 3, r.right - 3];
    const at = (y) => {
      for (const x of (y > r.top + 16 && y < r.bottom - 16 ? xs.concat(edges) : xs)) { const el = topAt(x, y); if (!el || !filterBox.contains(el)) return { x, y, el }; }
      return null;
    };
    for (let i = 0, prev = from; ; i++) {
      const y = from + step * Math.min(i * 24, hi - lo), c = at(y);
      if (c) { for (let f = prev + step * 4; step * (y - f) > 0; f += step * 4) { const d = at(f); if (d) return d; } return c; }
      if (i * 24 >= hi - lo) return null;
      prev = y;
    }
  }
  // which way the list hangs; fixed to the screen (where the column sticks), it is put beside the button and as wide as the column
  function placePick(up) {
    filterBox.classList.toggle('is-up', up);
    if (!pick.fixed) return;
    const b = pick.btn.getBoundingClientRect(), w = pick.box.getBoundingClientRect(), s = filterBox.style;
    s.left = w.left + 'px'; s.maxWidth = w.width + 'px'; s.minWidth = 'min(' + w.width + 'px, 17rem)';
    s.top = up ? 'auto' : 'calc(' + b.bottom + 'px + 0.4rem)';
    s.bottom = up ? 'calc(' + (window.innerHeight - b.top) + 'px + 0.4rem)' : 'auto';
  }
  // the list laid out one way as tall as the screen allows: how tall it may be that way, and what stops it (only where it sits
  // under what is pinned)
  function pickRoom(up, band) {
    placePick(up);
    let r = filterBox.getBoundingClientRect();
    filterBox.style.maxHeight = Math.max(0, Math.floor(up ? r.bottom - band.top : band.bot - r.top)) + 'px';
    r = filterBox.getBoundingClientRect();
    const under = pick.fixed ? pickCover(r, band, up) : null;
    return { up, under, h: up ? r.bottom - Math.max(band.top, under ? under.y + EDGE : 0) : Math.min(band.bot, under ? under.y - EDGE : Infinity) - r.top };
  }
  // how: 'open' chooses the layout and the way the list hangs, and measures; 'measure' measures again that way (the window
  // changed, or something pinned did); nothing keeps the last measure (a scroll: what is pinned to the screen has not moved — a
  // list fixed to the screen follows its button, and closes once the button has scrolled out of sight)
  function fitPick(how) {
    if (!filterBox || filterBox.hidden || !filterBox.getClientRects().length) return;   // closed, or its tab is not the one showing
    const need = filterBox.scrollHeight, row = (filterBox.querySelector('.mkt-copt') || {}).offsetHeight || 48, keep = filterBox.scrollTop;
    const band = { top: navH() + EDGE, bot: window.innerHeight - EDGE };
    if (how) {
      pick.fixed = getComputedStyle($('mkt-side')).position === 'sticky';
      filterBox.classList.toggle('is-fixed', pick.fixed);
      if (!pick.fixed) for (const k of ['left', 'top', 'bottom', 'minWidth', 'maxWidth']) filterBox.style[k] = '';
      watchPick(pick.fixed);
      // under the button when it fits there or there is more room there than above it
      let use = pickRoom(how === 'open' ? false : pick.up, band);
      if (how === 'open' && use.h < need) { const up = pickRoom(true, band); if (up.h > use.h) use = up; else placePick(false); }
      pick.up = use.up; pick.under = use.under;
    } else if (pick.fixed) {
      const b = pick.btn.getBoundingClientRect(), c = $('mkt-side').getBoundingClientRect();
      if (b.bottom <= Math.max(c.top, navH()) || b.top >= Math.min(c.bottom, window.innerHeight)) { closePick(true); return; }
      placePick(pick.up);
    }
    const r = filterBox.getBoundingClientRect(), u = pick.under;
    const room = pick.up ? r.bottom - Math.max(band.top, u ? u.y + EDGE : 0) : Math.min(band.bot, u ? u.y - EDGE : Infinity) - r.top;
    filterBox.style.maxHeight = Math.round(Math.max(room, Math.min(need, row))) + 'px';
    filterBox.scrollTop = keep;   // measuring laid it out taller for a moment, which can pull a scrolled list back
  }
  // where the list is fixed to the screen, a change to what is pinned there is looked at a moment later (after an entrance's
  // quarter-second animation). The page the list belongs to, the description bubble and the pointer's rocket (cursor.js redraws
  // it on every move of the mouse; it never takes a press) are not what can lie over it, and are passed over
  const pickMO = window.MutationObserver ? new MutationObserver((recs) => {
    if (pick.soon) return;
    for (const r of recs) {
      let t = r.target;
      while (t !== document.body && t.parentElement && t.parentElement !== document.body) t = t.parentElement;
      if (t !== document.body && (t.contains(filterBox) || t.id === 'tip-bubble' || t.classList.contains('rk-layer'))) continue;
      pick.soon = setTimeout(pickWatch, 300);
      return;
    }
  }) : null;
  function watchPick(on) {
    if (!pickMO || on === pick.watching) return;
    pick.watching = on;
    if (on) pickMO.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    else { pickMO.disconnect(); clearTimeout(pick.soon); pick.soon = 0; }
  }
  function pickWatch() {
    pick.soon = 0;
    if (!filterBox || filterBox.hidden || !pick.fixed || !filterBox.getClientRects().length) return;
    const u = pick.under;
    if ((u && topAt(u.x, u.y) !== u.el) || pickCover(filterBox.getBoundingClientRect(), { top: navH() + EDGE, bot: window.innerHeight - EDGE }, pick.up)) fitPick('measure');
  }
  // opening moves the focus to the chain chosen; opened by a press, its description is not shown (app.js: a tip is for the keyboard)
  function openPick(pressed) {
    if (!filterBox || !filterBox.hidden) return;
    if (window.sendTips) sendTips.hide();   // the button's own description, shown by a Tab, would lie over the list it opens
    filterBox.hidden = false; pick.btn.setAttribute('aria-expanded', 'true');
    fitPick('open');
    const on = filterBox.querySelector('[aria-pressed="true"]') || filterBox.querySelector('[data-tchain]');
    if (!on) return;
    try { on.focus({ preventScroll: true }); } catch { on.focus(); }
    filterBox.scrollTop = Math.max(0, on.offsetTop - (filterBox.clientHeight - on.offsetHeight) / 2);
    if (pressed && window.sendTips) sendTips.hide();
  }
  // back: the focus returns to the button (a pick, Escape, Back / Forward, its button scrolled away) without moving the page; an
  // outside click or a Tab away leaves it where it went
  function closePick(back, pressed) {
    if (!filterBox || filterBox.hidden) return;
    const inside = pick.box.contains(document.activeElement) || document.activeElement === document.body;
    if (back && inside) { try { pick.btn.focus({ preventScroll: true }); } catch { pick.btn.focus(); } if (pressed && window.sendTips) sendTips.hide(); }
    filterBox.hidden = true; filterBox.style.maxHeight = ''; pick.btn.setAttribute('aria-expanded', 'false');
    watchPick(false); pick.under = null;
  }
  if (pick.btn) pick.btn.addEventListener('click', (e) => { if (filterBox.hidden) openPick(e.detail > 0); else closePick(true, e.detail > 0); });
  // a pick applies the filter as the row of logos did — in the address, pushed so Back and Forward walk it, and the list read
  // again (seq.list keeps a late answer from painting over it) — and the list closes with the focus back on the button
  if (filterBox) filterBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tchain]'); if (!b) return;
    const t = b.dataset.tchain === 'all' ? '' : b.dataset.tchain;
    closePick(true, e.detail > 0);
    if (t === S.tokens.tchain) return;
    S.tokens.tchain = t; S.shown = pageSize();
    writeURL(true); syncControls(); loadList();
  });
  if (pick.box) {
    // the arrows (and Home / End) as a convenience; Tab is left to the browser
    pick.box.addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const opts = [...filterBox.querySelectorAll('[data-tchain]')], i = opts.indexOf(document.activeElement);
      if (e.target === pick.btn) {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        if (filterBox.hidden) openPick(false); else if (opts.length) opts[e.key === 'ArrowDown' ? 0 : opts.length - 1].focus();
        return;
      }
      if (i < 0) return;
      e.preventDefault();
      opts[e.key === 'Home' ? 0 : e.key === 'End' ? opts.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length].focus();
    });
    // Tab or Shift+Tab out of the button and the list closes it; a focus that goes nowhere (a press on the page, another
    // window) does not — a press outside is the click handler's below
    pick.box.addEventListener('focusout', (e) => { if (e.relatedTarget && !pick.box.contains(e.relatedTarget)) closePick(false); });
  }
  document.addEventListener('click', (e) => { if (filterBox && !filterBox.hidden && !pick.box.contains(e.target)) closePick(false); });
  document.addEventListener('keydown', (e) => { if ((e.key === 'Escape' || e.key === 'Esc') && filterBox && !filterBox.hidden) { e.preventDefault(); closePick(true); } });
  // the room beside the button moves with the page's scroll (and the side column's own) and with the window; the list's own
  // scroll is not one of them
  window.addEventListener('scroll', (e) => { if (filterBox && !filterBox.contains(e.target)) fitPick(); }, { passive: true, capture: true });
  window.addEventListener('resize', () => fitPick('measure'));
  function setTab(tab, focus) {
    S.tab = tab;
    tabs.forEach((t) => { const on = t.dataset.tab === tab; t.setAttribute('aria-selected', String(on)); t.classList.toggle('is-on', on); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    $('mkt-panel').setAttribute('aria-labelledby', 'mkt-tab-' + tab);
    list.setAttribute('aria-labelledby', 'mkt-tab-' + tab);
    for (const k of Object.keys(ctl)) if (ctl[k]) ctl[k].hidden = tab !== k;
    S.shown = pageSize();
    loadList();
  }
  // a tab the reader picks: the RWA tab is in the address (tab=rwa), so going to it or leaving it is pushed — Back returns to the
  // tab before; Top chains and Top tokens are not in it (a chain filter is), so moving between those two writes nothing
  function pickTab(tab, focus) {
    const was = S.tab;
    setTab(tab, focus);
    if (was === 'rwa' || tab === 'rwa') writeURL(true);
  }
  tabs.forEach((t) => t.addEventListener('click', () => { if (S.tab !== t.dataset.tab) pickTab(t.dataset.tab, false); }));
  $('mkt-tab-chains').parentNode.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.dataset.tab === S.tab);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    if (tabs[n].dataset.tab !== S.tab) pickTab(tabs[n].dataset.tab, true); else tabs[n].focus();
  });
  // the RWA tab's chips: each choice is pushed into the address (Back walks them) and the list read again
  if (ctl.rwa) ctl.rwa.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !ctl.rwa.contains(b)) return;
    const r = S.rwa, d = b.dataset;
    const pickd = d.rview ? ['view', d.rview] : d.rsort ? ['sort', d.rsort] : d.rdir ? ['dir', d.rdir] : d.rkind ? ['kind', d.rkind] : d.rissuer ? ['issuer', d.rissuer] : null;
    if (!pickd || (pickd[0] === 'sort' ? rwaSortOf(r) : r[pickd[0]]) === pickd[1]) return;
    r[pickd[0]] = pickd[1]; S.shown = pageSize();
    writeURL(true); syncControls(); loadList();
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
        if (learnChains(S.chainRows, (r) => r.key)) paintFilter();   // before the names below, so a new name redraws the filter too
        S.chainRows.forEach((r) => { if (r && r.key && r.name) names.set(r.key, r.name); });
        paintChains();
        syncControls();
      } catch (e) {
        if (my !== seq.list) return;
        cap.innerHTML = '<span class="mkt-err-t">⏳ ' + esc(errText(e, 'the chains')) + '</span> ' + failActs(e, 'list', 'chains');
      }
    } else if (kind === 'tokens') {
      // the chain filter's, never the main view's: absent, every chain the server reads in one list
      const chain = S.tokens.tchain || 'all', what = chain === 'all' ? 'every chain’s tokens' : 'the tokens on ' + chainName(chain);
      cap.innerHTML = loadingHTML('Reading ' + what + '…'); list.innerHTML = ''; more.innerHTML = ''; foot.innerHTML = '';
      try {
        const j = await getJSON(tokensURL(chain));
        if (my !== seq.list) return;
        S.tokenAns = j; S.tokenFor = chain;
        if (chain === 'all' && learnChains(j && j.networks, (n) => n.key)) paintFilter();
        paintTokens();
      } catch (e) {
        if (my !== seq.list) return;
        cap.innerHTML = '<span class="mkt-err-t">⏳ ' + esc(errText(e, what)) + '</span> ' + failActs(e, 'list', 'tokens');
      }
    } else if (kind === 'rwa') {
      // Robinhood Chain's RWAs: one answer per view, ranking, order, kind and issuer (the server decides what counts, and why)
      cap.innerHTML = loadingHTML('Reading Robinhood Chain’s RWAs…'); list.innerHTML = ''; more.innerHTML = ''; foot.innerHTML = rwaFootHTML(null);
      try {
        const j = await getJSON(rwaURL());
        if (my !== seq.list) return;
        S.rwaAns = j;
        // an issuer the server does not name falls back to all of them there: the chips and the address say what was served
        if (S.rwa.view !== 'stables' && j && typeof j.issuer === 'string' && ISSUER_KEY.test(j.issuer) && j.issuer !== S.rwa.issuer) { S.rwa.issuer = j.issuer; writeURL(false); }
        paintIssuers(j);
        paintRwa();
        // a token view whose market read failed before this list arrived: its RWA facts, now that the list says it is one
        if (S.view.token && S.view.chain === 'robinhood' && view.querySelector('.mkt-fail') && !$('mkt-rwa-host') && !view.hasAttribute('aria-busy')) {
          const k = rwaKnown(S.view.token);
          if (k) { view.insertAdjacentHTML('beforeend', rwaHostHTML(S.view.token, k)); mountRwaAfterFail(); }
        }
      } catch (e) {
        if (my !== seq.list) return;
        cap.innerHTML = '<span class="mkt-err-t">⏳ ' + esc(errText(e, 'Robinhood Chain’s RWAs')) + '</span> ' + retryBtn('list');
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
      (sortF === 'mcap' ? '<span class="mkt-cap-n">' + esc(MCAP_CAP) + '.</span>' : '') +
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
        '<span class="mkt-fig">' + (main != null ? '<b>' + esc(main) + '</b>' + (sortF === 'mcap' ? mcapChip(f) : '') + (f.label && sortF === 'mcap' ? '<small>' + esc(f.label) + '</small>' : '') : '<b class="mkt-na">Not available</b><small>' + whyOf(f) + '</small>') + '</span>' +
      '</button></li>';
    }).join('');
    more.innerHTML = moreHTML(rows.length) + (j.total > rows.length && rows.length < 200 && !S.chainsLimit ? '<button class="btn btn-sm btn-ghost mkt-more-b" type="button" data-limit="200" data-tip="Asks the site for up to 200 chains instead of the first page">Read up to 200 chains</button>' : '');
    wireLogos(list);
  }
  const FLAG = { thin: ['thin pools', 'Its pools hold under $10k between them'], wash: ['volume ≫ pools', 'Its 24h volume is over 100 times what its pools hold — a sign of wash trading'], 'global-mcap': ['global cap', 'Its market cap is a global, all-chains figure, not this chain’s'] };
  // the chain a row of the all-chains list is on: its logo (decorative, dropped if it does not load) and its name, in words
  const chainBadge = (r) => '<span class="mkt-chb">' + (ownLogo(r.chainLogo) ? '<img class="mkt-logo" src="' + esc(r.chainLogo) + '" alt="" loading="lazy" decoding="async" width="16" height="16">' : '') +
    '<span class="sr-only">on </span>' + esc(r.chainName || chainName(r.chain)) + '</span> · ';
  // what the all-chains list is drawn from, network by network: how many were read and when, which were not, which are late
  function allCapHTML(j, k) {
    const nets = Array.isArray(j.networks) ? j.networks : [], read = nets.filter((n) => n.pools > 0), unread = nets.filter((n) => !(n.pools > 0));
    const late = read.filter((n) => n.stale || n.stopped), cov = read.filter((n) => n.coverage && n.coverage.from);
    const when = j.oldestAt && j.at && j.oldestAt !== j.at ? ' · read ' + agoEl(j.oldestAt) + ' to ' + agoEl(j.at) : j.at ? ' · read ' + agoEl(j.at) : '';
    return 'Every chain · ranked by <b>' + esc(TK_SORT[k.sort] || k.sort) + '</b>, ' + (k.dir === 'asc' ? 'lowest' : 'highest') + ' first · <b>' + esc((j.window && j.window.label) || k.win) + '</b> · <b>' +
        (nets.length ? (read.length === nets.length ? nets.length + ' chains' : read.length + ' of ' + nets.length + ' chains read') : 'the chains this site reads') + '</b>' + when +
      (j.basis ? '<span class="mkt-cap-n">From ' + esc(j.basis) + (k.dir === 'asc' ? ' — so “lowest” is lowest among those, not the lowest on any chain.' : '.') + ' Each row names its chain; the same token on two chains is two rows.</span>' : '') +
      (unread.length ? '<span class="mkt-cap-n">Not read yet: ' + esc(unread.map((n) => n.name || chainName(n.key)).join(', ')) + ' — each joins this list once a read of its pools has finished.</span>' : '') +
      late.map((n) => '<span class="mkt-cap-n">⏳ ' + esc(n.name || chainName(n.key)) + ': ' + (n.stopped ? 'its last read stopped short (' + esc(n.stopped) + ')' : 'its newest read is from ' + agoEl(n.at) + ', older than usual') + '.</span>').join('') +
      (cov.length ? '<span class="mkt-cap-n">Custom windows come from this site’s own pool readings, which start on a different day for each chain: ' + esc(cov.map((n) => (n.name || chainName(n.key)) + ' ' + n.coverage.from).join(', ')) + '.</span>' : '');
  }
  function paintTokens() {
    const j = S.tokenAns || {}, rows = Array.isArray(j.rows) ? j.rows : [], k = S.tokens, sortF = k.sort;
    const win = j.window || {}, all = j.chain === 'all';
    cap.innerHTML = (all ? allCapHTML(j, k) : 'Tokens on <b>' + esc(chainName(j.chain || S.tokenFor)) + '</b> · ranked by <b>' + esc(TK_SORT[sortF] || sortF) + '</b>, ' + (k.dir === 'asc' ? 'lowest' : 'highest') + ' first · <b>' + esc(win.label || k.win) + '</b>' +
      (j.at ? ' · gathered ' + agoEl(j.at) : '') +
      (j.basis ? '<span class="mkt-cap-n">From ' + esc(j.basis) + (k.dir === 'asc' ? ' — so “lowest” is lowest among those, not lowest on the chain.' : '.') + '</span>' : '') +
      (j.coverage && j.coverage.from ? '<span class="mkt-cap-n">Custom windows come from this site’s own pool readings, which start ' + esc(j.coverage.from) + '.</span>' : '')) +
      (win.note ? '<span class="mkt-cap-n">' + esc(win.note) + '</span>' : '');
    foot.innerHTML = sortF === 'volume' && k.dir === 'desc' && !k.all ? 'Tokens whose volume is over 100× what their pools hold are left out of “highest volume” — “Include flagged volume” lists them too.' : '';
    if (!rows.length) { list.innerHTML = '<li class="mkt-empty">' + (j.why ? esc(cap1(j.why)) : 'No tokens are listed for ' + esc(all ? 'any chain' : chainName(j.chain || S.tokenFor)) + (k.win === 'custom' ? ' over these days yet' : ' yet')) + '.</li>'; more.innerHTML = ''; return; }
    const sec = sortF === 'volume' ? 'liquidity' : 'volume';
    list.innerHTML = rows.slice(0, S.shown).map((r, i) => {
      const f = fig(r[sortF]), s2 = fig(r[sec]);
      const main = f.v != null ? (sortF === 'change' ? pct(f.v) : usd(f.v)) : null;
      const nm = r.name || r.symbol || short(r.address), on = r.chain || j.chain;
      const flags = (r.flags || []).filter((x) => FLAG[x]).map((x) => '<span class="mkt-flag" title="' + esc(FLAG[x][1]) + '">⚠ ' + esc(FLAG[x][0]) + '</span>').join('');
      const cur = S.view.token && S.view.chain === on && sameToken(S.view.token, r.address);
      return '<li><button class="mkt-row" type="button" data-chain="' + esc(on) + '" data-token="' + esc(r.address) + '"' + (cur ? ' aria-current="true"' : '') + ' data-tip="Opens ' + esc(nm) + (all ? ' on ' + esc(r.chainName || chainName(on)) : '') + ' in the main view: price, pools, a chart and the Scanner’s read">' +
        '<span class="mkt-rank">' + (i + 1) + '</span>' + avaHTML(r.symbol || r.name, logoFor(r, on)) +
        '<span class="mkt-nm"><b>' + esc(nm) + (r.symbol ? ' <span class="mkt-sym">$' + esc(r.symbol) + '</span>' : '') + '</b><small>' + (all ? chainBadge(r) : '') + '<code>' + esc(short(r.address)) + '</code>' +
          (s2.v != null ? ' · ' + (sec === 'liquidity' ? 'Liq ' : 'Vol ') + esc(usd(s2.v)) + (sec === 'liquidity' && r.liquidity && r.liquidity.pools ? ' in ' + r.liquidity.pools + ' pool' + (r.liquidity.pools === 1 ? '' : 's') : '') : '') + '</small>' + (flags ? '<span class="mkt-flags">' + flags + '</span>' : '') + '</span>' +
        '<span class="mkt-fig">' + (main != null ? '<b>' + esc(main) + '</b>' + (sortF === 'mcap' && (r.flags || []).includes('global-mcap') ? '<small>global, all chains</small>' : '') : '<b class="mkt-na">Not available</b><small>' + whyOf(f) + '</small>') + '</span>' +
      '</button></li>';
    }).join('');
    more.innerHTML = moreHTML(rows.length);
    wireLogos(list);
  }
  /* ---------- the RWA tab's list (/api/market/rwa) ----------
     Four views: Top RWAs (one row per underlying asset, every issuer's token of it together), All RWA tokens, Connected tokens (NOT
     RWAs: tokens with a pool against one) and Stablecoins (apart, never counted). A row opens its token in the main view, where its
     RWA facts are. How sure the site is that a token is the real one is said in words on every row; a figure the server could not
     read is "Not available" with its reason — never 0. */
  const RWA_SORT_W = { value: 'value on chain', tvl: 'TVL in DeFi', liquidity: 'liquidity', mcap: 'market cap', volume: 'volume, 24 h', premium: 'premium or discount' };
  const RWA_FIELD = { value: 'value', tvl: 'tvl', liquidity: 'liquidity', mcap: 'mcap', volume: 'volume24h', premium: 'premium' };
  const RWA_FIG_W = { value: 'value on chain', tvl: 'in DeFi apps', liquidity: 'in DEX pools', mcap: 'market cap', volume: '24h volume' };
  const RWA_KIND_W = { stock: 'stock', etf: 'ETF', bond: 'bond or T-bill fund', commodity: 'commodity', credit: 'credit or fund share' };
  const RWA_KIND_PL = { stock: 'Stocks', etf: 'ETFs', bond: 'Bonds & T-bills', commodity: 'Commodities', credit: 'Credit & funds' };
  const RWA_KIND_IN = { stock: 'stocks', etf: 'ETFs', bond: 'bonds & T-bills', commodity: 'commodities', credit: 'credit & funds' };   // inside a sentence: the acronyms keep their capitals
  const poss = (n) => (/s$/.test(String(n || '')) ? n + '’' : n + '’s');   // "Ondo Global Markets’", "Midas’"; "Anchored’s"
  const ISSUER_W = { rhj: 'Robinhood Assets (Jersey)', ondo: 'Ondo Global Markets', anchored: 'Anchored', st0x: 'ST0x', midas: 'Midas' };   // in a row
  const ISSUER_CHIP = { rhj: 'Robinhood (RHJ)', ondo: 'Ondo', anchored: 'Anchored', st0x: 'ST0x', midas: 'Midas' };   // on its chip
  const issuerWord = (is) => (is && (ISSUER_W[is.key] || is.name)) || 'an issuer not named';
  // how sure the site is that a token is the real one, in words (its RWA card lists the evidence); never colour alone
  function confOf(c, evidence, why) {
    const t = new Set((Array.isArray(evidence) ? evidence : []).map((e) => e && e.tier));
    if (c === 'confirmed') {
      if (t.has('A1') && t.has('A2')) return { cls: 'is-ok', chip: '✓ Registry + on-chain', words: 'Confirmed: Robinhood’s registry lists this address, and its code runs from Robinhood’s registry contract on the chain.' };
      if (t.has('A2')) return { cls: 'is-ok', chip: '✓ On-chain', words: 'Confirmed on the chain: its code runs from Robinhood’s registry contract — though Robinhood’s registry does not list it as active.' };
      // what the chain was asked decides the words: a beacon matched is the issuer's fingerprint; for an ERC-1967 issuer (Midas) only a live proxy was read
      if (t.has('A3') && (Array.isArray(evidence) ? evidence : []).some((e) => e && e.tier === 'A3' && e.check === 'proxy')) return { cls: 'is-ok', chip: '✓ Issuer list + on-chain', words: 'Confirmed as far as this site checks: it is on this site’s list of its issuer’s tokens (by address), and a live ERC-1967 proxy on the chain — its code is not compared with the issuer’s.' };
      if (t.has('A3')) return { cls: 'is-ok', chip: '✓ Issuer list + on-chain', words: 'Confirmed: it is on this site’s list of its issuer’s tokens (by address), and its fingerprint on the chain is the issuer’s.' };
      return { cls: 'is-ok', chip: '✓ Confirmed', words: 'Confirmed on evidence — its issuer’s registry or this site’s list of its tokens, and the chain; its token view lists each piece.' };
    }
    if (c === 'issuer-listed') return { cls: 'is-mid', chip: 'Registry only', words: 'Listed in Robinhood’s registry, not confirmed on the chain' + (why ? ': ' + why : ' yet') + '.' };
    return { cls: 'is-no', chip: 'Not confirmed', words: 'Not confirmed: ' + (why || 'its fingerprint on the chain has not been read') + ' — shown, and left out of every total.' };
  }
  const confChip = (c, evidence, why) => { const o = confOf(c, evidence, why); return '<span class="mkt-conf ' + o.cls + '" title="' + esc(o.words) + '">' + esc(o.chip) + '</span>'; };
  const devWords = (d) => (val(d.pct) != null ? (d.pct > 0 ? '+' : '−') + Math.abs(d.pct).toFixed(1) + '%' : 'a gap') + (d.direction ? ' (a ' + d.direction + ')' : '') + (d.days != null ? ' for ' + d.days + ' trading days' : '') + (d.since ? ' since ' + d.since : '') + (d.asOf ? ', as of ' + d.asOf : '');
  const RFLAG = {
    halted: ['⚠ trading halted', 'Robinhood reports a trading halt on it'],
    paused: ['⚠ paused', 'Paused on the chain: this token, or every Stock Token at once'],
    'oracle-paused': ['⚠ oracle paused', 'Robinhood’s advisory price-oracle flag is paused for it (oraclePaused() on the chain)'],
    'pairs-rwa': ['pairs two RWAs', 'One of its pools pairs it with another RWA: that pool is in both tokens’ figures, and a total takes its volume once'],
    'global-mcap': ['global cap', 'Its market cap is CoinGecko’s every-chain figure, not this chain’s'],
    'stale-reference': ['⚠ reference stale', 'Chainlink’s feed for it is older than its heartbeat'],
    'fingerprint-mismatch': ['⚠ fingerprint mismatch', 'Robinhood’s registry lists it, but its code does not run from Robinhood’s registry on the chain'],
  };
  // a row's flags as chips, each said in words with its reason in the title; "not confirmed" is the confidence chip's
  function rwaFlags(r) {
    const out = [];
    for (const f of r.flags || []) {
      const p = val(r.premium);
      if (f === 'premium' && p != null) out.push(['⚠ ' + (p > 0 ? '+' : '−') + Math.abs(p).toFixed(1) + '% vs its reference', ((r.premium && r.premium.label) || 'its DEX price against its reference') + ' — 5% or more; the reference is one token’s price: the share’s price × the token’s multiplier']);
      else if (f === 'deviation') out.push(['⚠ Robinhood flags its price', r.deviation ? 'Robinhood’s price-deviation list: ' + devWords(r.deviation) : 'On Robinhood’s price-deviation list (5% or more off the NYSE close for 7 trading days)']);
      else if (RFLAG[f]) out.push(RFLAG[f]);
    }
    return out.map(([t, tip]) => '<span class="mkt-flag" title="' + esc(tip) + '">' + esc(t) + '</span>').join('');
  }
  // the figure a row is ranked by: "Not available" with its reason when the server has none
  function rwaFigHTML(r, key) {
    const f = fig(r[RWA_FIELD[key]]), v = val(f);
    if (v == null) return '<span class="mkt-fig"><b class="mkt-na">Not available</b><small>' + whyOf(f) + '</small></span>';
    // a group's market cap is this chain's figures only; an every-chain figure of one of its tokens is kept apart (mcapGlobal), and said so
    const sub = key === 'premium' ? (f.ref === 'robinhood' ? 'vs Robinhood’s quote' : 'vs Chainlink’s price') : key === 'mcap' && f.global ? 'every chain — CoinGecko’s figure' : key === 'mcap' && r.mcapGlobal && val(r.mcapGlobal) != null ? 'this chain’s — an every-chain figure kept apart' : key === 'mcap' && f.aboveFdv ? 'market cap — above its FDV here' : RWA_FIG_W[key];
    return '<span class="mkt-fig"><b>' + esc(key === 'premium' ? pct(v) : usd(v)) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>';
  }
  const rwaSecond = (r, key) => { const k2 = key === 'value' ? 'liquidity' : 'value', v = val(r[k2]); return v != null ? ' · ' + (k2 === 'value' ? 'Value ' : 'Liq ') + esc(usd(v)) : ''; };
  const rwaCur = (addr) => !!S.view.token && S.view.chain === 'robinhood' && sameToken(S.view.token, addr);
  function rwaAssetRow(g, i, key) {
    const toks = Array.isArray(g.tokens) ? g.tokens : [], main = toks.find((t) => t.address === g.main) || toks[0] || {};
    const u = g.underlying || {}, nm = u.name || main.name || main.symbol || short(g.main), sym = main.symbol || u.symbol;
    const others = toks.filter((t) => t !== main);
    const also = others.length ? '<small class="mkt-also">also ' + others.map((t) => '$' + esc(t.symbol || short(t.address)) + ' (' + esc(issuerWord(t.issuer)) + (t.confidence === 'confirmed' ? '' : t.confidence === 'issuer-listed' ? ', registry only' : ', not confirmed') + ')').join(', ') + '</small>' : '';
    return '<li><button class="mkt-row" type="button" data-chain="robinhood" data-token="' + esc(g.main) + '"' + (rwaCur(g.main) ? ' aria-current="true"' : '') + ' data-tip="Opens ' + esc(nm) + ' in the main view: its price, its pools and its RWA facts — the evidence, the issuer and what the issuer can do">' +
      '<span class="mkt-rank">' + (i + 1) + '</span>' + avaHTML(sym || nm, g.logo) +
      '<span class="mkt-nm"><b>' + esc(nm) + (sym ? ' <span class="mkt-sym">$' + esc(sym) + '</span>' : '') + '</b><small>' + esc([cap1(RWA_KIND_W[u.kind] || u.kind || ''), issuerWord(main.issuer)].filter(Boolean).join(' · ')) + rwaSecond(g, key) + '</small>' + also +
        '<span class="mkt-flags">' + confChip(main.confidence) + rwaFlags(g) + '</span></span>' + rwaFigHTML(g, key) + '</button></li>';
  }
  function rwaTokenRow(r, i, key) {
    // the underlying's name ("Tesla"), its issuer in the line under it: the token's own long name ("Tesla • Robinhood Token") is on its view
    const u = r.underlying || {}, nm = u.name || r.name || r.symbol || short(r.address);
    return '<li><button class="mkt-row" type="button" data-chain="robinhood" data-token="' + esc(r.address) + '"' + (rwaCur(r.address) ? ' aria-current="true"' : '') + ' data-tip="Opens ' + esc(nm) + ' in the main view: its price, its pools and its RWA facts — the evidence, the issuer and what the issuer can do">' +
      '<span class="mkt-rank">' + (i + 1) + '</span>' + avaHTML(r.symbol || nm, r.logo) +
      '<span class="mkt-nm"><b>' + esc(nm) + (r.symbol ? ' <span class="mkt-sym">$' + esc(r.symbol) + '</span>' : '') + '</b><small>' + esc([cap1(RWA_KIND_W[u.kind] || u.kind || ''), issuerWord(r.issuer)].filter(Boolean).join(' · ')) + ' · <code>' + esc(short(r.address)) + '</code>' + rwaSecond(r, key) + '</small>' +
        '<span class="mkt-flags">' + confChip(r.confidence, r.evidence, r.why) + rwaFlags(r) + '</span></span>' + rwaFigHTML(r, key) + '</button></li>';
  }
  // a token paired with an RWA: every row says it is NOT one (the server's own words, "Not an RWA — paired with $TSLA")
  function rwaConnRow(c, i, key) {
    const sym = c.symbol || '', nm = c.name || sym || short(c.address), f = key === 'volume' ? c.volume24h : c.reserveUsd, v = val(f), rw = c.rwa || {};
    return '<li><button class="mkt-row" type="button" data-chain="robinhood" data-token="' + esc(c.address) + '"' + (rwaCur(c.address) ? ' aria-current="true"' : '') + ' data-tip="Opens ' + esc(nm) + ' in the main view — a token paired with $' + esc(rw.symbol || short(rw.address)) + ' in a pool, not an RWA itself">' +
      '<span class="mkt-rank">' + (i + 1) + '</span>' + avaHTML(sym || nm, c.logo) +
      '<span class="mkt-nm"><b>' + esc(nm) + (sym && sym !== nm ? ' <span class="mkt-sym">$' + esc(sym) + '</span>' : '') + '</b><small><code>' + esc(short(c.address)) + '</code> · ' + esc(c.dex || 'a DEX') + ' pool <code title="' + esc(c.pool) + '">' + esc(short(c.pool)) + '</code></small>' +
        '<span class="mkt-flags"><span class="mkt-flag mkt-notrwa">' + esc(c.label || 'Not an RWA') + '</span></span></span>' +
      '<span class="mkt-fig">' + (v != null ? '<b>' + esc(usd(v)) + '</b><small>' + (key === 'volume' ? 'the pool’s 24h volume' : 'the pool’s reserve') + '</small>' : '<b class="mkt-na">Not available</b><small>' + whyOf(f) + '</small>') + '</span></button></li>';
  }
  // a fiat-backed stablecoin: listed apart, never counted as an RWA (the server's words on every row)
  function rwaStableRow(x, i, key) {
    const nm = x.name || x.symbol || 'A stablecoin', f = key === 'liquidity' ? x.liquidity : x.circulating, v = val(f), sup = val(x.supply);
    const body = '<span class="mkt-rank">' + (i + 1) + '</span>' + avaHTML(x.symbol || nm, null) +
      '<span class="mkt-nm"><b>' + esc(nm) + (x.symbol ? ' <span class="mkt-sym">$' + esc(x.symbol) + '</span>' : '') + '</b><small>' + esc([x.issuer, x.backing].filter(Boolean).join(' · ')) + (sup != null ? ' · supply ' + esc(amount(sup, x.symbol || '')) + ' — totalSupply() read on the chain' + (x.supply.at ? ', ' + agoEl(x.supply.at) : '') : '') + '</small>' +
        '<span class="mkt-flags"><span class="mkt-flag mkt-notrwa">' + esc(x.label || 'Not counted as an RWA here') + '</span></span></span>' +
      // circulating is DefiLlama's own figure (not the supply read on the chain); liquidity is the pools holding it, both sides of each
      '<span class="mkt-fig">' + (v != null ? '<b>' + esc(usd(v)) + '</b><small>' + (key === 'liquidity' ? 'in the pools holding it, both sides' : 'circulating, per DefiLlama') + ' (' + srcLine(f) + ')</small>' : '<b class="mkt-na">Not available</b><small>' + whyOf(f) + '</small>') + '</span>';
    if (!EVM_ADDR.test(String(x.address || ''))) return '<li><div class="mkt-row mkt-row-off">' + body + '<small class="mkt-off">Not opened here: this site does not know its address on Robinhood Chain.</small></div></li>';
    return '<li><button class="mkt-row" type="button" data-chain="robinhood" data-token="' + esc(String(x.address).toLowerCase()) + '"' + (rwaCur(x.address) ? ' aria-current="true"' : '') + ' data-tip="Opens ' + esc(nm) + ' in the main view — a fiat-backed stablecoin, listed apart from the RWAs">' + body + '</button></li>';
  }
  const RWA_ROW = { assets: rwaAssetRow, tokens: rwaTokenRow, connected: rwaConnRow, stables: rwaStableRow };
  // the Issuer chips: every issuer the answer names (it names them before its own filter), and the one chosen even when it has none
  function paintIssuers(j) {
    const box = $('mkt-ri-c'); if (!box) return;
    const list = (Array.isArray(j && j.issuers) ? j.issuers : []).filter((x) => x && ISSUER_KEY.test(String(x.key || '')));
    const id = list.map((x) => x.key + ':' + x.count).join() + '|' + S.rwa.issuer;
    if (box._drawn === id) { syncRwa(); return; }
    box._drawn = id;
    const had = box.contains(document.activeElement) ? document.activeElement.dataset.rissuer : null;
    const chip = (k, label, tip) => '<button class="np-chip" type="button" aria-pressed="false" data-rissuer="' + esc(k) + '" data-tip="' + esc(tip) + '"><span class="mkt-tick" aria-hidden="true">✓&nbsp;</span>' + esc(label) + '</button>';
    const chosen = S.rwa.issuer !== 'all' && !list.some((x) => x.key === S.rwa.issuer) ? [{ key: S.rwa.issuer, name: ISSUER_W[S.rwa.issuer] || S.rwa.issuer, count: 0 }] : [];
    box.innerHTML = chip('all', 'All', 'Lists the tokens of every issuer this site counts') +
      list.concat(chosen).map((x) => chip(x.key, ISSUER_CHIP[x.key] || x.name || x.key, 'Lists only the tokens issued by ' + (x.name || x.key) + (x.count ? ' — ' + x.count + ' on this site’s list' : ' — none on this site’s list just now'))).join('');
    if (had) { const b = box.querySelector('[data-rissuer="' + had + '"]'); if (b) b.focus({ preventScroll: true }); }
    syncRwa();
  }
  const RWA_READ_W = { tvl: 'DefiLlama’s per-app deposits', gt: 'GeckoTerminal’s token read', connected: 'the RWAs’ own pools' };
  // the reads behind the view that did not work, each with its reason and the age of what is shown in its place
  function rwaReadsHTML(reads, keys) {
    const r = reads || {};
    return keys.filter((k) => r[k] && r[k].why).map((k) => {
      const w = String(r[k].why).replace(/\.$/, ''), lead = RWA_READ_W[k] && !/DefiLlama|GeckoTerminal|pools/.test(w.slice(0, 40)) ? RWA_READ_W[k] + ': ' : '';
      return '<span class="mkt-cap-n">⏳ ' + esc(cap1(lead + w)) + '.</span>';
    }).join('');
  }
  function rwaCapHTML(j) {
    const r = S.rwa, view = RWA_VIEWS.includes(j.view) ? j.view : r.view, key = rwaSortOf(Object.assign({}, r, { view })), t = j.totals || {}, D = j.definitions || {};
    const dirW = r.dir === 'asc' ? 'lowest' : 'highest', n = Array.isArray(j.rows) ? j.rows.length : 0, total = Number.isFinite(j.total) ? j.total : n;
    const filt = view === 'stables' ? '' : [r.kind !== 'all' ? RWA_KIND_PL[r.kind] || r.kind : '', r.issuer !== 'all' ? (ISSUER_W[r.issuer] || r.issuer) + ' only' : ''].filter(Boolean).join(' · ');
    const noun = view === 'connected' ? 'pool' : view === 'assets' ? 'asset' : view === 'stables' ? 'stablecoin' : 'token';
    let h = view === 'connected' ? '<b>Connected tokens</b> — not RWAs: tokens with a DEX pool against one · ranked by <b>' + (key === 'volume' ? 'the pool’s 24h volume' : 'the pool’s reserve') + '</b>'
      : view === 'stables' ? '<b>Stablecoins</b> on Robinhood Chain, listed apart from the RWAs · ranked by <b>' + (key === 'liquidity' ? 'liquidity' : 'what circulates on the chain') + '</b>'
      : '<b>' + (view === 'assets' ? 'Top RWAs' : 'All RWA tokens') + '</b> on Robinhood Chain · ranked by <b>' + esc(RWA_SORT_W[key] || key) + '</b>';
    h += ', ' + dirW + ' first' + (filt ? ' · <b>' + esc(filt) + '</b>' : '') + ' · ' + n + (total > n ? ' of ' + total : '') + ' ' + noun + (n === 1 ? '' : 's') + (j.at ? ' · gathered ' + agoEl(j.at) : '');
    // what is counted, each sum with its source and age (the stablecoins and L2BEAT's own count apart are in the foot, never added in)
    const sumW = (label, f) => { const v = val(f); return label + ' ' + (v != null ? '<b>' + esc(usd(v)) + '</b> (' + srcLine(f) + ')' : NA + ' (' + whyOf(f) + ')'); };
    if (view === 'assets' || view === 'tokens') {
      const c = Number.isFinite(t.count) ? t.count : null, nc = Number.isFinite(t.notConfirmed) ? t.notConfirmed : 0;
      // a kind or an issuer chosen: the rows' own sums first, then the whole chain's — said as the whole chain's, never beside a filter as if they were its
      const ts = filt && j.totalsShown && typeof j.totalsShown === 'object' ? j.totalsShown : null;
      if (ts) h += '<span class="mkt-cap-n">These rows: <b>' + count(Number(ts.count) || 0) + ' RWA token' + (ts.count === 1 ? '' : 's') + ' counted</b> — ' + [sumW('value on chain', ts.value), sumW('liquidity', ts.liquidity), sumW('TVL in DeFi', ts.tvl)].join(' · ') + '.</span>';
      h += '<span class="mkt-cap-n">' + (filt ? 'The whole chain, every kind and issuer — counted: <b>' : 'Counted: <b>') + (c != null ? count(c) + ' RWA token' + (c === 1 ? '' : 's') : 'the RWA tokens') + '</b>' + (nc ? ' (+' + count(nc) + ' not confirmed yet, left out)' : '') + ' — ' +
        [sumW('value on chain', t.value), sumW('liquidity', t.liquidity), sumW('TVL in DeFi', t.tvl)].join(' · ') + '.</span>';
    }
    if (view === 'connected' && Number.isFinite(j.belowFloor)) {
      h += '<span class="mkt-cap-n">Pools from $' + Number(j.floor || 1000).toLocaleString('en-US') + ' of reserve; ' + count(j.belowFloor) + ' below that left out' +
        (j.unreadReserve ? ', ' + count(j.unreadReserve) + ' whose reserve GeckoTerminal did not read' : '') + '.</span>';
    }
    if (view === 'stables') h += '<span class="mkt-cap-n">' + sumW('Circulating on the chain, all of them', t.stables) + ' — not counted as RWAs here.</span>';
    return h + rwaReadsHTML(j.reads, view === 'connected' ? ['connected', 'registry', 'chain', 'gt'] : view === 'stables' ? ['stables'] : ['registry', 'prices', 'chain', 'tvl', 'chainlink', 'gt', 'deviations', 'actions']);
  }
  const RWA_DEF_W = [['rwa', 'An RWA here'], ['value', 'Value on chain'], ['tvl', 'TVL in DeFi'], ['liquidity', 'Liquidity'], ['mcap', 'Market cap'], ['volume', 'Volume 24h'], ['premium', 'Premium or discount'], ['connected', 'Connected tokens'], ['stables', 'Stablecoins']];
  const RWA_NOT_AFFILIATED = 'Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc. No Robinhood logos or artwork are used.';
  const RWA_NOT_ADVICE = 'Not advice, never a tip to buy. Do your own research.';
  // the foot: how a token counts (the tiers in words), what is kept apart, the answer's own notes, what each figure means, the
  // sources — and, always, the not-affiliated and not-advice lines (they stand even when the list could not be read)
  // the foot's first lines for the view shown: what its ranking figure means, how "lowest" reads, and what is kept apart, never added in
  function rwaFootLeadHTML(j) {
    if (!j || !j.definitions) return '';
    const r = S.rwa, view = RWA_VIEWS.includes(j.view) ? j.view : r.view, key = rwaSortOf(Object.assign({}, r, { view })), t = j.totals || {}, D = j.definitions || {};
    const dk = view === 'connected' ? 'connected' : view === 'stables' ? 'stables' : key;
    const sumW = (label, f) => { const v = val(f); return label + ' ' + (v != null ? '<b>' + esc(usd(v)) + '</b> (' + srcLine(f) + ')' : NA + ' (' + whyOf(f) + ')'); };
    let h = D[dk] ? '<span class="mkt-foot-n">' + esc(D[dk]) + '</span>' : '';
    if (r.dir === 'asc') h += '<span class="mkt-foot-n">So “lowest” is lowest among these, not the lowest on the chain — and a row with no figure for this stays at the end, in both orders.</span>';
    if (view === 'assets' || view === 'tokens') {
      const l2 = (t.l2beat || {}).rwaPublic;
      h += '<span class="mkt-foot-n">The totals cover every RWA token counted, whatever the kind and issuer chosen. Apart, never added in: ' + sumW('fiat-backed stablecoins', t.stables) + (l2 ? ' · ' + sumW('L2BEAT’s own count of real-world assets on Robinhood Chain', l2) : '') + '.</span>';
    }
    return h;
  }
  function rwaFootHTML(j) {
    const notes = (j && Array.isArray(j.notes) ? j.notes : []).map(String);
    const isLast = (x) => /^Not affiliated|^Not advice/.test(x), isFirst = (x) => /^How a token counts|listed apart and never counted/.test(x);
    const first = notes.filter(isFirst), rest = notes.filter((x) => !isFirst(x) && !isLast(x)), last = notes.filter(isLast);
    if (!last.some((x) => /^Not affiliated/.test(x))) last.push(RWA_NOT_AFFILIATED);
    if (!last.some((x) => /^Not advice/.test(x))) last.push(RWA_NOT_ADVICE);
    const D = (j && j.definitions) || {}, srcs = (j && Array.isArray(j.sources) ? j.sources : []).filter((x) => x && x.name);
    const defs = RWA_DEF_W.filter(([k]) => D[k]);
    return rwaFootLeadHTML(j) + first.concat(rest).map((x) => '<span class="mkt-foot-n">' + esc(x) + '</span>').join('') +
      (defs.length ? '<details class="mkt-why mkt-defs"><summary>What each figure means</summary><dl>' + defs.map(([k, w]) => '<div><dt>' + esc(w) + '</dt><dd>' + esc(D[k]) + '</dd></div>').join('') + '</dl></details>' : '') +
      (srcs.length ? '<span class="mkt-foot-n">Sources: ' + srcs.map((x) => (/^https:\/\//.test(String(x.href || '')) ? '<a class="mkt-src-l" href="' + esc(x.href) + '" target="_blank" rel="noopener nofollow">' + esc(x.name) + '</a>' : esc(x.name))).join(' · ') + ' — read by this site’s server; your browser contacts none of them.</span>' : '') +
      last.map((x) => '<span class="mkt-foot-n mkt-foot-b">' + esc(x) + '</span>').join('');
  }
  function rwaEmptyHTML(j) {
    const r = S.rwa, reads = j.reads || {};
    if (j.view === 'connected') {
      const which = [r.kind !== 'all' ? RWA_KIND_IN[r.kind] || r.kind : '', r.issuer !== 'all' ? poss(ISSUER_W[r.issuer] || r.issuer) + ' tokens' : ''].filter(Boolean);
      return (which.length ? 'No pool pairs a token with ' + esc(which.join(' among ')) + ' from $' + Number(j.floor || 1000).toLocaleString('en-US') + ' of reserve — choose All to see every one'
        : 'No pool pairs a token with an RWA from $' + Number(j.floor || 1000).toLocaleString('en-US') + ' of reserve among the pools this site reads') + (reads.connected && reads.connected.why ? ' — ' + esc(String(reads.connected.why).replace(/\.$/, '')) : '') + '.';
    }
    if (j.view === 'stables') return reads.stables && reads.stables.why ? esc(cap1(String(reads.stables.why).replace(/\.$/, ''))) + '.' : 'DefiLlama lists no fiat-backed stablecoin on Robinhood Chain.';
    if (r.kind !== 'all' || r.issuer !== 'all') {
      const from = r.issuer !== 'all' ? ' from ' + esc(ISSUER_W[r.issuer] || r.issuer) : '';
      return (r.kind !== 'all' ? 'No ' + esc(RWA_KIND_IN[r.kind] || r.kind) + from + ' among the RWA tokens this site counts' : 'No RWA token this site counts is' + from) + ' — choose All to see every one.';
    }
    return 'There are no RWA tokens to list yet' + (reads.registry && reads.registry.why ? ': ' + esc(String(reads.registry.why).replace(/\.$/, '')) : '') + '.';
  }
  function paintRwa() {
    const j = S.rwaAns || {}, rows = Array.isArray(j.rows) ? j.rows : [], view = RWA_VIEWS.includes(j.view) ? j.view : S.rwa.view, key = rwaSortOf(Object.assign({}, S.rwa, { view }));
    cap.innerHTML = rwaCapHTML(j);
    foot.innerHTML = rwaFootHTML(j);
    if (!rows.length) { list.innerHTML = '<li class="mkt-empty">' + rwaEmptyHTML(Object.assign({ view }, j)) + '</li>'; more.innerHTML = ''; return; }
    list.innerHTML = rows.slice(0, S.shown).map((x, i) => RWA_ROW[view](x, i, key)).join('');
    more.innerHTML = moreHTML(rows.length);
    wireLogos(list);
  }
  more.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.limit) { S.chainsLimit = Number(b.dataset.limit); loadList(); return; }
    const first = S.shown; S.shown += pageSize();
    if (S.tab === 'chains') paintChains(); else if (S.tab === 'tokens') paintTokens(); else if (S.tab === 'rwa') paintRwa();
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
    else if (r.dataset.retry === 'rwa') { const h = $('mkt-rwa-host'); if (h) { memo.clear(); loadRwa(h); } }
    else if (r.dataset.retry === 'map') { memo.delete('/api/market/heatmap'); loadMap(false); }
    else if (r.dataset.retry === 'search' && form) { memo.clear(); if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true })); }
  });

  /* ════════════════════════════ the main view ════════════════════════════ */
  function open(v, push) {
    if (!v || !CHAIN_KEY.test(String(v.chain || ''))) return;
    const tok = v.token && TOKEN_ADDR.test(v.token) ? (/^0x/i.test(v.token) ? v.token.toLowerCase() : v.token) : null;
    S.view = { chain: v.chain, token: tok };
    writeURL(push);
    loadView(true);
    markCurrent();   // the side list stays as it is: Top tokens' chain is its own filter, not the main view's
    syncControls();
  }
  function markCurrent() {
    list.querySelectorAll('.mkt-row').forEach((b) => {
      const on = S.view.token ? b.dataset.chain === S.view.chain && sameToken(b.dataset.token, S.view.token) : !b.dataset.token && b.dataset.chain === S.view.chain;
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
  // under a failed market read: the RWA facts of a token the RWA list holds (they are read apart, from the server's own store)
  /* the facts need no market read: the failed answer's own rwa row (or lookalike answer) first — a direct link, a search hit or a shared
     address shows them whatever tab was open — else what the RWA list holds */
  const rwaAfterFail = (v, ans) => {
    if (!v.token || v.chain !== 'robinhood') return '';
    const k = (ans && ans.rwa && typeof ans.rwa === 'object' && ans.rwa.issuer ? ans.rwa : null) || rwaKnown(v.token);
    return k ? rwaHostHTML(v.token, k) : rwaLookHTML(ans && ans.rwaLookalike);
  };
  function mountRwaAfterFail() { const h = $('mkt-rwa-host'); if (h) { wireLogos(view); loadRwa(h); } }
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
        view.innerHTML = failHTML(v, nm, cap1(String(j.why || 'the site could not read this just now').replace(/\.$/, '')) + '. Nothing here is a reading of ' + nm + '.', retryBtn('view'), j.scanner) + rwaAfterFail(v, j);
        mountRwaAfterFail();
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
      view.innerHTML = failHTML(v, nm, errText(e, nm), failActs(e, 'view', v.token ? 'tokens' : 'chains'), null) + rwaAfterFail(v, e && e.body);
      mountRwaAfterFail();
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
    if (a) {
      // "All tokens, sorted your way": the side list's chain filter set to the chain in the main view
      const k = READS.includes(S.view.chain) ? S.view.chain : '';
      const moved = k !== S.tokens.tchain, was = S.tab;
      if (moved) { S.tokens.tchain = k; S.shown = pageSize(); }
      if (S.tab !== 'tokens') setTab('tokens', true); else { if (moved) loadList(); $('mkt-tab-tokens').focus(); }
      if (moved || was === 'rwa') writeURL(true);   // after the tab moved: the address names the chain filter, and no longer the RWA tab
    }
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
      stat('Native token market cap', st.mcap, usd, mcapChip(st.mcap)));
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
        '<p class="mkt-vsub">Figures for <b>' + esc(w.label || 'the last full UTC day') + '</b>' + (d.at ? ' · gathered ' + agoEl(d.at) : '') + '. Each card names its source and how recent its figure is.</p></div>' +
      '</header>' + (d.why ? '<p class="mkt-note mkt-basis">⏳ ' + esc(d.why) + '</p>' : '') +
      '<div class="mkt-groups">' + money + trade + feesG + act + '</div>' +
      mcapHTML(d) + chartsHTML(d) + pulseHTML(d) + l2HTML(d) + topTokensHTML(d) + newPoolsHTML(d) + sourcesHTML(d) +
    '</article>';
  }

  /* the market cap's cross-check in full: each source's own figure, price and circulating supply with how recent it is ("As of":
     CoinGecko's own update time, DefiLlama's on its relay, CoinLore's read time), what the check found, and whether CoinGecko
     names the same token for this chain as DefiLlama does — or only its gas token, which does not check the token shown */
  const MAP_WORD = { confirmed: '✓ CoinGecko names the same token for this chain', gas: 'Checked for its gas token only', differs: '⚠ CoinGecko names another coin for this chain', unchecked: 'Not checked' };
  function mcapHTML(d) {
    const f = fig((d.stats || {}).mcap), c = f.check;
    if (!c || !c.status || (c.status === 'none' && !(c.notes || []).length && !(c.coin && c.coin.id))) return '';
    const srcs = Array.isArray(c.sources) ? c.sources : [];
    const cellOf = (x, fmt) => (x != null && isFinite(x) ? esc(fmt(Number(x))) : '<span class="mkt-na">not given</span>');
    const rows = srcs.map((x) => '<tr><th scope="row" data-l="Source">' + esc(srcName(x.src)) + (x.relay ? ' <span class="mkt-s">(CoinGecko’s figure, relayed)</span>' : '') + '</th>' +
      '<td data-l="Market cap">' + cellOf(x.v, usd) + '</td><td data-l="Price">' + cellOf(x.price, usd) + '</td><td data-l="Circulating supply">' + cellOf(x.supply, count) + '</td>' +
      '<td data-l="As of">' + (x.at ? agoEl(x.at) : 'time not recorded') + '</td></tr>').join('');
    const sym = c.coin && c.coin.symbol ? '<span class="mkt-sym">' + esc('$' + c.coin.symbol) + '</span> ' : '';
    const coin = c.coin && c.coin.id ? (c.coin.name ? esc(c.coin.name) + ' ' : '') + sym + '<span class="mkt-s">(CoinGecko id <code>' + esc(c.coin.id) + '</code>)</span>' : '';
    const status = c.status === 'none' ? '<p class="mkt-s">' + (f.why ? esc(f.why) : 'No source gave a market cap for this token.') + '</p>' : '<p class="mkt-chkline">' + mcapChip(f) + ' <span class="mkt-s">' + esc(CHK[c.status][2]) + '.</span></p>';
    const notes = (c.notes || []).length ? '<ul class="mkt-chknotes">' + c.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '';
    const m = c.mapping || {};
    const mapping = '<p class="mkt-s"><b>The chain’s token:</b> ' + esc((m.status === 'confirmed' && m.by === 'gas' ? MAP_WORD.gas : MAP_WORD[m.status]) || 'Not checked') + (m.note ? ' — ' + esc(m.note) : '') + '.</p>';
    return '<section class="mkt-card mkt-mcap" aria-labelledby="mkt-mc-h"><div class="mkt-card-h"><h3 class="mkt-h3" id="mkt-mc-h">🧮 Market cap, cross-checked</h3><p class="mkt-s">' + esc(MCAP_CAP) + '</p>' + (coin ? '<p class="mkt-s">' + coin + '</p>' : '') + '</div>' +
      status + (rows ? '<table class="mkt-table mkt-chktbl"><thead><tr><th scope="col">Source</th><th scope="col">Market cap</th><th scope="col">Price</th><th scope="col">Circulating supply</th><th scope="col">As of</th></tr></thead><tbody>' + rows + '</tbody></table>' : '') +
      notes + mapping + '<p class="mkt-s">“As of” is when each source’s figure is from: CoinGecko’s own update time, DefiLlama’s on its relay, CoinLore’s when this site read it. Shown is CoinGecko’s figure when it has one (the one the rest of this site uses), never an average of the two; DefiLlama only relays CoinGecko’s figure, so it never counts as a second source. Not advice — a market cap is a count of tokens times a price.</p></section>';
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
          '<span class="mkt-rank">' + (i + 1) + '</span>' + avaHTML(r.symbol || r.name, logoFor(r, r.chain || d.key)) +
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
    // an RWA here (the server's word: the token answer's rwa key, Robinhood Chain only) gets its RWA facts under the stats
    const rwa = chain === 'robinhood' && d.rwa && typeof d.rwa === 'object' ? d.rwa : null;
    const head = '<header class="mkt-vhead">' + avaHTML(d.symbol || d.name, d.logo, true) +
      '<div class="mkt-vt"><p class="mkt-kicker">🪙 Token · ' + esc(chainName(chain)) + (rwa ? (rwa.confidence === 'confirmed' ? ' · 🏛️ Real-world asset' : rwa.confidence === 'issuer-listed' ? ' · 🏛️ Real-world asset, not checked on the chain yet' : ' · 🏛️ Listed as a real-world asset, not confirmed yet') : '') + '</p>' +
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
      head + rwaLookHTML(chain === 'robinhood' ? d.rwaLookalike : null) + '<div class="mkt-tstats" id="mkt-tstats">' + stats + '</div>' +
      (rwa ? rwaHostHTML(d.address || S.view.token, rwa) : '') +
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

  /* ---------- an RWA's facts, on its token view (owner, 2026-10-28: "on the on-chain details page … pull as much data as possible
     and present it to the users in best way possible … for our Users to best do their their own research"). The token answer's
     rwa key says it counts; its facts come from /api/market/rwa/token (stored by the server's RWA job — no read of a vendor is made
     for it), in the order a holder needs them: is this the real one, what you hold, the price against the underlying's, corporate
     actions, size, the powers its issuer keeps, the tokens paired with it. Every figure says its source and age; one the server
     could not read is "Not available" with the reason. ---------- */
  // an address on Robinhood Chain: a link to the chain's explorer (the Scanner's own, NPCard.CHAIN_META) and a copy button
  function addrLink(a, label) {
    const c = window.NPCard && NPCard.CHAIN_META && NPCard.CHAIN_META.robinhood, s = String(a || '');
    if (!s) return '';
    const code = '<code title="' + esc(s) + '">' + esc(short(s)) + '</code>';
    const href = c && /^https:\/\//.test(String(c.explorer || '')) && c.paths && c.paths.address && EVM_ADDR.test(s) ? c.explorer + c.paths.address + s : null;
    return (href ? '<a class="mkt-addr-l" href="' + esc(href) + '" target="_blank" rel="noopener nofollow">' + code + ' ↗</a>' : code) +
      ' <button class="copy-btn mkt-copy" type="button" data-copy="' + esc(s) + '" aria-label="Copy ' + esc(label) + '" data-tip="Copies ' + esc(label) + ' to your clipboard">⧉</button>';
  }
  // a source page the server names (https only), shown by where it is
  const srcA = (href) => (/^https:\/\//.test(String(href || '')) ? '<a class="mkt-src-l" href="' + esc(href) + '" target="_blank" rel="noopener nofollow">' + esc(String(href).replace(/^https:\/\//, '').replace(/\/$/, '')) + ' ↗</a>' : '');
  const kindW = (k) => (k === 'wallet' ? '(a wallet)' : k === 'contract' ? '(a contract)' : '(wallet or contract: not read)');
  const hbW = (s) => (s >= 3600 && s % 3600 === 0 ? s / 3600 + ' h' : s >= 60 ? Math.round(s / 60) + ' min' : s + ' s');
  const num6 = (v) => trimZ(Number(v).toFixed(6));
  // a yes/no reading: its words, or "Not available" with why (a call the contract reverted is "no such function", never "no")
  function factStat(label, x, yes, no) {
    const f = x && typeof x === 'object' ? x : { v: null }, w = f.v === true ? yes : f.v === false ? no : null;
    return '<div class="mkt-stat' + (w == null ? ' is-na' : '') + (f.v === true ? ' is-warn' : '') + '"><dt>' + esc(label) + '</dt><dd><b class="mkt-v">' + (w != null ? esc(w) : NA) + '</b>' +
      '<span class="mkt-s">' + (w != null ? (f.label ? esc(f.label) + ' · ' : '') + srcLine(f) : whyOf(f) + (f.src && f.src !== 'site' ? ' · ' + srcLine(f) : '')) + '</span></dd></div>';
  }
  // a tile with words of its own (not a figure): its value or "Not available", and the line under it
  const tileW = (label, value, sub, warn) => '<div class="mkt-stat' + (value == null ? ' is-na' : '') + (warn ? ' is-warn' : '') + '"><dt>' + esc(label) + '</dt><dd><b class="mkt-v">' + (value == null ? NA : esc(value)) + '</b>' + (sub ? '<span class="mkt-s">' + sub + '</span>' : '') + '</dd></div>';
  const rwaSec = (id, title, sub, body) => '<section class="mkt-card mkt-rwa-c" aria-labelledby="' + id + '"><div class="mkt-card-h"><h3 class="mkt-h3" id="' + id + '">' + esc(title) + '</h3>' + (sub ? '<p class="mkt-s">' + sub + '</p>' : '') + '</div>' + body + '</section>';
  const isOfficialList = (x) => /\/chain\/contracts\/?$/.test(String((x && x.href) || ''));
  // before the facts arrive (and above them): what it is, in a line — the token row already says the issuer and how sure
  // a token not confirmed on the chain is never asserted to be its issuer's: it is "listed as" one, and the chip says how sure
  function rwaLeadHTML(r) {
    const c = r && r.confidence, who = r && r.issuer ? esc(issuerWord(r.issuer)) : '';
    const what = !r || !r.issuer ? '<b>A real-world-asset token</b>'
      : c === 'confirmed' ? '<b>A real-world-asset token</b> — issued by ' + who
      : c === 'issuer-listed' ? '<b>A real-world-asset token in Robinhood’s registry</b>, not checked on the chain yet'
      : '<b>Listed as a real-world-asset token of ' + who + '</b>, not confirmed on the chain yet — not counted';
    return '<p class="mkt-rwa-lede">🏛️ ' + what + (r && r.issuer ? ' ' + confChip(c, r.evidence, r.why) : '') +
      '. Its facts below, for your own research, each with its source and when it was read. ' + esc(RWA_NOT_AFFILIATED) + '</p>';
  }
  const rwaHostHTML = (addr, r) => '<div class="mkt-rwa" id="mkt-rwa-host" data-token="' + esc(addr) + '">' + rwaLeadHTML(r) + loadingHTML('Reading what this site holds about this RWA…') + '</div>';
  /* the real token a lookalike's answer names (its twin), in full with a way to open it: "The real $GME (its issuer)" only when this
     site has confirmed it or Robinhood's registry lists it — a twin not confirmed yet is said as what this site found, never as its issuer's */
  const twinSure = (tw) => !!tw && (tw.confidence === 'confirmed' || tw.registry === true);
  function twinLineHTML(tw) {
    if (!tw || typeof tw !== 'object' || !EVM_ADDR.test(String(tw.address || ''))) return '';
    const a = String(tw.address).toLowerCase(), sym = tw.symbol ? '$' + esc(tw.symbol) : 'token';
    return '<p class="mkt-note">' + (twinSure(tw) ? 'The real ' + sym + (tw.issuer && tw.issuer.name ? ' (' + esc(tw.issuer.name) + ')' : '') : 'The ' + sym + ' this site found, not confirmed on the chain yet') + ': ' +
      addrLink(a, 'that token’s address') + ' <code class="mkt-full">' + esc(a) + '</code> <button class="btn btn-sm btn-ghost mkt-mini" type="button" data-open-token="' + esc(a) + '" data-chain="robinhood" data-tip="Opens that token in the main view: its price, its pools and its RWA facts">Open it</button></p>';
  }
  /* a token that only wears an RWA's ticker (the server's lookalike answer: { notRwa, why: "Same ticker as $…", twin }): said under its
     title, with the real one — never only far below, in the Scanner's read */
  function rwaLookHTML(L) {
    if (!L || typeof L !== 'object' || L.notRwa !== true || L.stablecoin || !/^Same ticker as \$/.test(String(L.why || ''))) return '';
    const tw = L.twin && typeof L.twin === 'object' ? L.twin : null, sure = twinSure(tw);
    const sym = (tw && tw.symbol) || String(L.why).replace(/^Same ticker as \$([^,\s]+).*$/, '$1');
    return '<section class="mkt-card mkt-rwa-look" aria-labelledby="mkt-lk1-h"><h3 class="mkt-h3" id="mkt-lk1-h">⚠️ Same ticker as ' + (sure && tw.issuer && tw.issuer.key === 'rhj' ? 'Robinhood’s ' : '') + '$' + esc(sym) + (sure ? ' — not it' : ' — not the token this site found for it') + '</h3>' +
      '<p class="mkt-err-t">Not a real-world asset here. ' + esc(cap1(String(L.why).replace(/\.$/, ''))) + '.</p>' + twinLineHTML(tw) +
      '<p class="mkt-note">A name or a symbol never makes a token an RWA here — anyone can deploy a token called “' + esc(sym) + '”. ' + esc(RWA_NOT_AFFILIATED) + ' ' + esc(RWA_NOT_ADVICE) + '</p></section>';
  }
  // 1. is this the real one: how sure, each piece of evidence with its source, the issuer, its status, and the lookalikes
  const TIER_W = { A1: 'proof · Robinhood’s registry', A2: 'proof · the chain', A3: 'proof · issuer list and the chain', B: 'supporting only' };
  const LOOK_SRC = { pools: 'in the pools this site reads', scan: 'scanned on this site', radar: 'in the Scanner’s new pairs' };
  function rwaRealHTML(j) {
    const ev = Array.isArray(j.evidence) ? j.evidence : [], prof = j.issuerProfile || {}, official = (Array.isArray(prof.sentences) ? prof.sentences : []).find(isOfficialList);
    const looks = Array.isArray(j.lookalikes) ? j.lookalikes : [], st = j.status || {}, u = j.underlying || {}, who = issuerWord(j.issuer), o = confOf(j.confidence, ev, j.why);
    return rwaSec('mkt-rw1-h', '🔎 Is this the real one?', confChip(j.confidence, ev, j.why),
      '<p class="mkt-rwa-verdict">' + esc(o.words) + '</p>' +
      '<dl class="mkt-kv"><div><dt>Issuer</dt><dd>' + esc((j.issuer && j.issuer.name) || 'not named') + '</dd></div>' +
        '<div><dt>Status</dt><dd>' + esc(st.text || 'not given') + (st.code ? ' <code>' + esc(st.code) + '</code>' : '') + '</dd></div>' +
        '<div><dt>Stands for</dt><dd>' + esc(u.name || u.symbol || 'not named') + (u.symbol && u.name ? ' ($' + esc(u.symbol) + ')' : '') + (u.kind ? ' — ' + esc(RWA_KIND_W[u.kind] || u.kind) : '') + '</dd></div></dl>' +
      '<h4 class="mkt-gh">The evidence</h4>' +
      (ev.length ? '<ul class="mkt-evid">' + ev.map((e) => { const proof = /^A/.test(String(e.tier)) && e.proof !== false;
        return '<li><span class="mkt-tier' + (proof ? ' is-a' : '') + '">' + esc(e.tier) + ' · ' + esc(proof ? TIER_W[e.tier] || 'evidence' : /^A/.test(String(e.tier)) ? 'listed, not proof yet' : TIER_W[e.tier] || 'evidence') + '</span> ' + esc(e.text) + ' <span class="mkt-s">' + srcLine(e) + '</span></li>'; }).join('') + '</ul>' : '<p class="mkt-empty">The server gave no evidence for it.</p>') +
      '<p class="mkt-note">A name or a symbol never makes a token an RWA here — anyone can deploy a token called “Tesla”.' + (official ? ' ' + esc(official.text) + ' ' + srcA(official.href) : '') + '</p>' +
      '<h4 class="mkt-gh">Same ticker or name, not issued by ' + esc(who) + '</h4>' +
      (looks.length ? '<ul class="mkt-looks">' + looks.map((x) => '<li>⚠ <b>' + esc(x.symbol ? '$' + x.symbol : 'no symbol') + '</b>' + (x.name ? ' ' + esc(x.name) : '') + ' ' + addrLink(x.address, 'this lookalike’s address') +
        ' <span class="mkt-s">— same ticker or name, not issued by ' + esc(who) + (LOOK_SRC[x.src] ? ' · seen ' + esc(LOOK_SRC[x.src]) : '') + '</span></li>').join('') + '</ul>'
        : '<p class="mkt-empty">None among the pools, scans and new pairs this site keeps — that is not a search of the whole chain.</p>'));
  }
  /* Parts 2–7 each show what matters in a line (and any live warning), and the rest one press down — a pop-down of its own, 44 px
     tall, its summary saying what is in it — so a reader who opened an RWA for its chart and pools reaches them in a screen or two,
     not after sixteen. The order holds open or closed. */
  const rwaFold = (id, title, sub, open, sumLine, body) => rwaSec(id, title, sub, open + (body ? '<details class="mkt-tbl mkt-rwa-fold"><summary>' + sumLine + '</summary><div class="mkt-rwa-fold-b">' + body + '</div></details>' : ''));
  // a figure in a part's summary line: its value with whose it is and how old, or "Not available"
  const rwaBrief = (label, x, fmt) => { const v = val(x); return esc(label) + ' ' + (v != null ? '<b>' + esc(fmt(v)) + '</b> <span class="mkt-s">(' + srcLine(fig(x)) + ')</span>' : NA); };
  // 2. what you hold: the issuer's own pages, every sentence with the page it comes from; terms() as the contract names them. What the
  //    token is, who it is not offered to and how it is redeemed (Robinhood: not to US persons; redemption after the issuer's KYC) stay in sight
  function rwaHoldHTML(j) {
    const prof = j.issuerProfile || {}, sents = (Array.isArray(prof.sentences) ? prof.sentences : []).filter((x) => !isOfficialList(x)), terms = prof.terms;
    const rhj = j.issuer && j.issuer.key === 'rhj', material = (x) => /debt securities|KYC|Not offered to US persons/.test(String((x && x.text) || ''));
    const shown = rhj ? sents.filter(material) : sents.slice(0, 1), rest = sents.filter((x) => !shown.includes(x));
    const li = (x) => '<li>' + esc(x.text) + ' ' + (srcA(x.href) || '<span class="mkt-s">— this site’s own reading, not a page of the issuer’s</span>') + '</li>';
    const termsH = terms && typeof terms === 'object' ? '<p class="mkt-rwa-terms">Its terms, as the contract itself names them (<code>terms()</code> read on the chain): ' +
      (typeof terms.v === 'string' && /^https:\/\//.test(terms.v) ? srcA(terms.v) + ' <span class="mkt-s">' + srcLine(terms) + '</span>' : NA + ' <span class="mkt-s">' + whyOf(terms) + '</span>') + '</p>' : '';
    const cg = /^https:\/\/www\.coingecko\.com\//.test(String(prof.coingecko || '')) ? '<p class="mkt-note">Its page on CoinGecko: ' + srcA(prof.coingecko) + '</p>' : '';
    return rwaFold('mkt-rw2-h', '📜 What you hold', esc((prof.issuer && prof.issuer.name) || issuerWord(j.issuer)) + ' — in the issuer’s words, each with its page',
      shown.length ? '<ul class="mkt-hold">' + shown.map(li).join('') + '</ul>' : '<p class="mkt-empty">This site has no curated words for this issuer.</p>',
      (rest.length ? 'The rest of what you hold (' + rest.length + ')' : 'Its terms') + (termsH ? ' and the terms its contract names' : ''),
      (rest.length ? '<ul class="mkt-hold">' + rest.map(li).join('') + '</ul>' : '') + termsH + cg);
  }
  // 3. the price check: the DEX price against Chainlink's feed and Robinhood's quote, the premium, Robinhood's deviation flag, halts and pauses
  function rwaPriceHTML(j) {
    const ref = j.reference || {}, cl = j.chainlink, p = j.paused || {}, dv = j.deviation, rd = (j.reads || {}).deviations || {}, rhj = j.issuer && j.issuer.key === 'rhj', pv = val(j.premium);
    const clX = cl && typeof cl === 'object' ? '<span class="mkt-s">' + ['feed ' + (cl.proxy ? '<code title="' + esc(cl.proxy) + '">' + esc(short(cl.proxy)) + '</code>' : 'not named'), cl.updatedAt ? 'updated ' + agoEl(cl.updatedAt) : 'its update time not read',
      cl.heartbeat ? 'heartbeat ' + esc(hbW(cl.heartbeat)) : '', cl.stale ? '⚠ stale: older than its heartbeat' : cl.updatedAt && cl.heartbeat ? 'within its heartbeat' : ''].filter(Boolean).join(' · ') + '</span>' : '';
    const devT = dv ? tileW('Robinhood’s deviation flag', '⚠ ' + (val(dv.pct) != null ? (dv.pct > 0 ? '+' : '−') + Math.abs(dv.pct).toFixed(1) + '%' : 'flagged'), esc(devWords(dv).replace(/^[^(]*\(/, '(')) + ' — Robinhood flags a Stock Token 5% or more off the NYSE close for 7 trading days · ' + srcLine(dv), true)
      : !rhj ? tileW('Robinhood’s deviation flag', null, 'Robinhood flags its own Stock Tokens only')
      : rd.ok ? tileW('Robinhood’s deviation flag', 'Not flagged', 'not on Robinhood’s price-deviation list (5% or more off the NYSE close for 7 trading days) · ' + srcLine({ src: 'robinhood', at: rd.at }))
      : tileW('Robinhood’s deviation flag', null, esc(cap1(String(rd.why || 'Robinhood’s price deviations have not been read yet'))));
    const note = (Array.isArray(j.notes) ? j.notes : []).find((x) => /markets close/.test(String(x))) || 'Stock markets close while DEX pools trade around the clock: a gap from the reference price can open outside market hours.';
    // a live halt, pause or flag is never folded away
    const live = [[j.halted, '⚠ Trading is halted — Robinhood reports a halt for it.'], [p.global, '⚠ Every Stock Token is paused — paused() on Robinhood’s registry.'], [p.token, '⚠ This token is paused — tokenPaused().'],
      [p.oracle, '⚠ Its price oracle is paused (oraclePaused()) — Robinhood says to treat its price as temporarily unavailable.']].filter(([f]) => f && f.v === true).map(([f, t]) => '<p class="mkt-err-t">' + esc(t) + ' <span class="mkt-s">' + srcLine(f) + '</span></p>').join('') +
      (dv ? '<p class="mkt-err-t">⚠ Robinhood flags its price: ' + esc(devWords(dv)) + ' <span class="mkt-s">' + srcLine(dv) + '</span></p>' : '');
    return rwaFold('mkt-rw3-h', '⚖️ Price check', 'The DEX price against its reference: the price of one token — the share’s price × the token’s multiplier',
      '<p class="mkt-rwa-line">' + rwaBrief('DEX price', j.priceUsd, usd) + ' · ' + rwaBrief('premium or discount', j.premium, pct) + (pv != null ? ' <span class="mkt-s">' + (j.premium.ref === 'robinhood' ? 'against Robinhood’s quote' : 'against Chainlink’s feed') + '</span>' : '') + '</p>' + live,
      'The whole price check — Chainlink’s feed, Robinhood’s quote, halts and pauses',
      '<dl class="mkt-stats">' + stat('DEX price', j.priceUsd, usd) + stat('Chainlink’s feed for it', ref.chainlink, usd, clX) + stat('Robinhood’s quote for it', ref.robinhood, usd) +
        stat('Premium or discount', j.premium, pct, pv != null && pv !== 0 ? '<span class="mkt-s">' + (pv > 0 ? 'above its reference — a premium' : 'below its reference — a discount') + '</span>' : '') + devT +
        factStat('Trading halt', j.halted, '⚠ Halted', 'Not halted') + factStat('Paused: every Stock Token', p.global, '⚠ Paused', 'Not paused') + factStat('Paused: this token', p.token, '⚠ Paused', 'Not paused') +
        factStat('Price-oracle flag', p.oracle, '⚠ Paused', 'Not paused') + '</dl>' +
      '<p class="mkt-note">' + esc(note) + '</p>');
  }
  // 4. corporate actions: what one token stands for (the multiplier, and a change pending on the chain) and the issuer's actions for it
  const detailW = (d) => Object.entries(d && typeof d === 'object' ? d : {}).map(([k, v]) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() + ' ' + (v == null ? 'not given' : String(v))).join(' · ') || 'none given';
  function rwaActionsHTML(j) {
    const m = j.multiplier || {}, acts = Array.isArray(j.corporateActions) ? j.corporateActions : [], ra = (j.reads || {}).actions || {}, rhj = j.issuer && j.issuer.key === 'rhj';
    const pend = m.pending && typeof m.pending === 'object' ? m.pending : null, mv = val(m);
    const mX = rhj ? '<span class="mkt-s">' + [m.onchain != null && isFinite(m.onchain) ? 'on the chain (uiMultiplier()): ' + esc(num6(m.onchain)) : 'the chain’s uiMultiplier() not read yet',
      pend && val(pend) != null ? '⏳ changing to ' + esc(num6(val(pend))) + (pend.effectiveAt ? ' from ' + esc(utc(pend.effectiveAt)) : '') + ' (newUIMultiplier() and effectiveAt() on the chain)' : m.onchain != null ? 'no change pending on the chain' : ''].filter(Boolean).join(' · ') + '</span>' : '';
    const table = acts.length ? '<table class="mkt-table"><thead><tr><th scope="col">Action</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col">Details, as Robinhood gives them</th></tr></thead><tbody>' +
      acts.map((a) => '<tr><th scope="row" data-l="Action">' + esc(cap1(a.typeWords || a.type || 'an action')) + '</th><td data-l="Status">' + esc(a.status || 'not given') + '</td><td data-l="Date">' + esc(a.date || 'not given') + '</td><td data-l="Details">' + esc(detailW(a.details)) + '</td></tr>').join('') + '</tbody></table>'
      : '<p class="mkt-empty">' + (!rhj ? 'Robinhood lists corporate actions for its own Stock Tokens only; this site reads none for this issuer.' : ra.ok ? 'Robinhood’s corporate-actions list has none for it.' : esc(cap1(String(ra.why || 'Robinhood’s corporate actions have not been read yet').replace(/\.$/, ''))) + '.') + '</p>';
    const inProg = acts.filter((a) => /progress/.test(String(a.status || ''))).length;
    return rwaFold('mkt-rw4-h', '🧾 Corporate actions', rhj && ra.at ? srcLine({ src: 'robinhood', at: ra.at }) : '',
      '<p class="mkt-rwa-line">' + (mv != null ? 'One token stands for <b>' + esc(num6(mv)) + '</b> share' + (mv === 1 ? '' : 's') + ' of the underlying <span class="mkt-s">(' + srcLine(fig(m)) + ')</span>' : rhj ? 'Its multiplier: ' + NA : 'No multiplier: only Robinhood’s Stock Tokens carry one.') +
        (pend && val(pend) != null ? ' · <b>⏳ changing to ' + esc(num6(val(pend))) + '</b>' : '') + (rhj ? ' · ' + (acts.length ? acts.length + ' corporate action' + (acts.length === 1 ? '' : 's') + ' listed' + (inProg ? ', ' + inProg + ' in progress' : '') : ra.ok ? 'none listed now' : 'Robinhood’s list not read') : '') + '</p>',
      acts.length ? 'Every corporate action (' + acts.length + ') and the multiplier on the chain' : 'The multiplier on the chain',
      '<dl class="mkt-stats">' + stat('One token stands for', m, (v) => num6(v) + ' share' + (v === 1 ? '' : 's') + ' of the underlying', mX) + '</dl>' + table +
      (rhj ? '<p class="mkt-note">Dividends are paid by raising the multiplier, so the token’s price sits above the share’s: one token comes to stand for more than one share.</p>' : ''));
  }
  // 5. size: each figure with what it is (the answer's own definitions) — value on chain, market cap and TVL are never mixed
  function rwaSizeHTML(j) {
    const D = j.definitions || {}, def = (k) => (D[k] ? '<span class="mkt-s mkt-def">' + esc(D[k]) + '</span>' : ''), tv = j.tvl || {}, lq = j.liquidity || {};
    const apps = Array.isArray(tv.protocols) && tv.protocols.length ? '<span class="mkt-s">held in ' + tv.protocols.map((x) => esc(x.name || x.slug) + (x.category ? ' (' + esc(x.category) + ')' : '') + (val(x.usd) != null ? ' ' + esc(usd(val(x.usd))) : '') + (x.kept ? ' — ' + esc(x.keptWhy || 'kept from an earlier read') : '')).join(', ') + '</span>' : '';
    return rwaFold('mkt-rw5-h', '📏 Size', 'Each figure on its own — none of them is the company’s market value',
      // a TVL figure that may be low (an app not read), rests on a kept or old read, says so here, in sight — never a plain figure
      '<p class="mkt-rwa-line">' + rwaBrief('Value on chain', j.value, usd) + ' · ' + rwaBrief('liquidity', lq, usd) + ' · ' + rwaBrief('TVL in DeFi', tv, usd) +
        (val(tv) != null && tv.caveat ? ' <span class="mkt-s mkt-warn-t">⚠ ' + esc(tv.caveat) + '</span>' : '') + '</p>',
      'Every size figure — supply, market cap, primary mint and burn, 24 h volume — and what each means',
      '<dl class="mkt-stats">' + stat('Value on chain', j.value, usd, def('value')) + stat('Supply on the chain', j.supply, (v) => amount(v, j.symbol || '')) +
        stat('Market cap', j.mcap, usd, def('mcap')) + stat('Liquidity', lq, usd, (lq.pairsRwa ? '<span class="mkt-s">one of its pools pairs it with another RWA: that pool is in both tokens’ figures, and a total takes its volume once</span>' : '') + def('liquidity')) +
        stat('TVL in DeFi', tv, usd, apps + def('tvl')) + stat('Primary mint and burn', j.mintBurnUsd, usd) + stat('Volume, 24 h', j.volume24h, usd, def('volume')) + '</dl>');
  }
  /* 6. the powers its issuer keeps — said as powers a regulated issuer keeps, not as a verdict; every holder with its explorer link and
     kind. Until the registry's log walk is whole, every holder list says how far it has read (a holder granted later is not shown yet) */
  function rwaControlsHTML(j) {
    const c = j.controls || {}, powers = Array.isArray(c.powers) ? c.powers : [], roles = Array.isArray(j.roles) ? j.roles : [], rr = (j.reads || {}).roles || {}, bl = j.blocked, dep = j.deployer, impl = c.implementation || {};
    const walk = j.rolesRead && typeof j.rolesRead === 'object' ? j.rolesRead : null, partial = !!walk && walk.complete === false;
    const sofar = partial ? '<span class="mkt-s mkt-warn-t">from the registry’s logs read up to block ' + (walk.cursor != null ? esc(Number(walk.cursor).toLocaleString('en-US')) : '…') + (walk.head != null ? ' of ' + esc(Number(walk.head).toLocaleString('en-US')) : '') + ' — a holder granted later is not shown yet</span>' : '';
    const holders = (hs) => (Array.isArray(hs) && hs.length ? hs.map((h) => addrLink(h.address, 'this role holder’s address') + ' <span class="mkt-s">' + kindW(h.kind) + '</span>').join('<br>') + (sofar ? '<br>' + sofar : '')
      : '<span class="mkt-s">' + (rr.ok ? 'no holder in the registry’s logs' : esc(cap1(String(rr.why || 'the registry’s logs have not been read yet')))) + '</span>');
    const kv = '<dl class="mkt-kv">' +
      '<div><dt>How its code is set up</dt><dd>' + esc(c.kind ? cap1(c.kind) : 'not read') + (c.kind === 'beacon proxy' ? ' — the token runs the code its beacon names, so whoever can change the beacon changes the code of every token behind it' : c.kind === 'ERC-1967 proxy' ? ' — the token runs the code its implementation slot names, which its admin can change' : '') + '</dd></div>' +
      (c.beacon ? '<div><dt>' + (c.registry && c.registry === c.beacon ? 'Its beacon: Robinhood’s registry' : 'Its beacon') + '</dt><dd>' + addrLink(c.beacon, 'the beacon’s address') + '</dd></div>' : '') +
      '<div><dt>The code it runs now</dt><dd>' + (impl.address ? addrLink(impl.address, 'the implementation’s address') + ' <span class="mkt-s">' + srcLine(impl) + '</span>' : NA + ' <span class="mkt-s">' + whyOf(impl) + '</span>') + '</dd></div>' +
      '<div><dt>Verified source</dt><dd>' + (/^https:\/\//.test(String(c.verifiedSource || '')) ? '<a class="mkt-src-l" href="' + esc(c.verifiedSource) + '" target="_blank" rel="noopener nofollow">Sourcify’s record of that code ↗</a>' : NA + ' <span class="mkt-s">' + esc(cap1(String(c.verifiedWhy || 'not given'))) + '</span>') + '</dd></div>' +
      (bl && typeof bl === 'object' ? '<div><dt>Wallets blocked</dt><dd><b>' + esc(count(val(bl.count)) || 'not counted') + '</b> <span class="mkt-s">from the registry’s Blocked and Unblocked logs' + (bl.complete ? ', read in full' : ', read so far — the walk is not finished') + ' · ' + srcLine({ src: 'rpc', at: bl.at }) + '</span></dd></div>' : '') + '</dl>';
    const table = powers.length ? '<table class="mkt-table"><thead><tr><th scope="col">What the holder can do</th><th scope="col">Role</th><th scope="col">Held by</th></tr></thead><tbody>' +
      powers.map((x) => '<tr><th scope="row" data-l="Power">' + esc(x.power) + '</th><td data-l="Role"><code>' + esc(x.role) + '</code></td><td data-l="Held by">' + holders(x.holders) + '</td></tr>').join('') + '</tbody></table>' : '';
    const log = roles.length ? '<details class="mkt-tbl"><summary>Every role holder in the registry’s logs (' + roles.length + ')</summary><table class="mkt-table"><thead><tr><th scope="col">Role</th><th scope="col">Holder</th><th scope="col">Since</th></tr></thead><tbody>' +
      roles.map((x) => '<tr><th scope="row" data-l="Role"><code>' + esc(x.role) + '</code></th><td data-l="Holder">' + addrLink(x.holder, 'this role holder’s address') + ' <span class="mkt-s">' + kindW(x.kind) + '</span></td><td data-l="Since">' + (x.since && x.since.block != null ? 'block ' + esc(Number(x.since.block).toLocaleString('en-US')) : 'not read') + '</td></tr>').join('') + '</tbody></table></details>' : '';
    const depH = dep && typeof dep === 'object' ? '<p class="mkt-note">' + esc(dep.note || '') + (Array.isArray(dep.holders) && dep.holders.length ? ' Its token deployer: ' + dep.holders.map((h) => addrLink(h.address, 'the token deployer’s address') + ' <span class="mkt-s">' + kindW(h.kind) + '</span>').join(', ') + '.' : '') + '</p>' : '';
    const heldN = powers.filter((x) => Array.isArray(x.holders) && x.holders.length).length;
    const line = powers.length ? '<p class="mkt-rwa-line"><b>' + heldN + ' of ' + powers.length + '</b> powers held' + (bl && typeof bl === 'object' && val(bl.count) != null ? ' · <b>' + (bl.complete ? '' : 'at least ') + esc(count(val(bl.count))) + '</b> wallets blocked from moving these tokens' : '') + '</p>' + (sofar ? '<p class="mkt-note">' + sofar + '</p>' : '')
      : '<p class="mkt-empty">' + esc(cap1(String(c.powersWhy || 'No powers are listed for it.'))) + '</p>';
    return rwaSec('mkt-rw6-h', '🔐 Powers its issuer keeps', j.rolesAt ? (partial ? 'From Robinhood’s registry on the chain, read so far · ' : 'From Robinhood’s registry on the chain · ') + srcLine({ src: 'rpc', at: j.rolesAt }) : '',
      '<p class="mkt-rwa-powers">' + esc(c.note || 'Powers a regulated issuer keeps, shown as such, not as a verdict: for a regulated issuer they are expected — they are still powers over your tokens. The Scanner’s health score does not count them.') + '</p>' + line +
      '<details class="mkt-tbl mkt-rwa-fold"><summary>Its code, its beacon' + (bl && typeof bl === 'object' ? ' and the wallets it has blocked' : '') + '</summary><div class="mkt-rwa-fold-b">' + kv + depH + '</div></details>' +
      (table ? '<details class="mkt-tbl mkt-rwa-fold"><summary>Every power and who holds it (' + powers.length + ')</summary><div class="mkt-rwa-fold-b">' + table + log + '</div></details>' : ''));
  }
  // 7. tokens paired with it in a pool: each NOT an RWA, opened in the main view on a press; a read that failed says so, never "none"
  function rwaConnHTML(j) {
    const cn = Array.isArray(j.connected) ? j.connected : [], rc = (j.reads || {}).connected || {};
    const row = (c, i) => { const sym = c.symbol || '', nm = c.name || sym || short(c.address), v = val(c.reserveUsd);
      return '<li><button class="mkt-row" type="button" data-open-token="' + esc(c.address) + '" data-chain="robinhood" data-tip="Opens ' + esc(nm) + ' in the main view — a token paired with this RWA in a pool, not an RWA itself">' +
        '<span class="mkt-rank">' + (i + 1) + '</span>' + avaHTML(sym || nm, c.logo) + '<span class="mkt-nm"><b>' + esc(nm) + (sym && sym !== nm ? ' <span class="mkt-sym">$' + esc(sym) + '</span>' : '') + '</b><small><code>' + esc(short(c.address)) + '</code> · ' + esc(c.dex || 'a DEX') + ' pool <code title="' + esc(c.pool) + '">' + esc(short(c.pool)) + '</code></small>' +
        '<span class="mkt-flags"><span class="mkt-flag mkt-notrwa">' + esc(c.label || 'Not an RWA') + '</span></span></span>' +
        '<span class="mkt-fig">' + (v != null ? '<b>' + esc(usd(v)) + '</b><small>the pool’s reserve</small>' : '<b class="mkt-na">Not available</b><small>' + whyOf(c.reserveUsd) + '</small>') + '</span></button></li>'; };
    const own = j.connectedWhy ? '<p class="mkt-err-t">⏳ ' + esc(cap1(String(j.connectedWhy).replace(/\.$/, ''))) + ' — not a “none”.</p>' : '';
    /* an empty list: its own pools' read failing says so (connectedWhy); else the server's words for where its pools were read
       (connectedBasis: its own pools, or only the most-traded pools kept) — the round's failures are about the tokens it asked, never this one */
    const basis = j.connectedBasis && typeof j.connectedBasis === 'object' && j.connectedBasis.note ? j.connectedBasis : null;
    if (!cn.length) return rwaSec('mkt-rw7-h', '🔗 Tokens paired with it', '', own || '<p class="mkt-empty">' + (basis ? esc(cap1(String(basis.note).replace(/\.$/, ''))) + '. <span class="mkt-s">' + srcLine(basis) + '</span>'
      : rc.ok === false && rc.why ? '⏳ ' + esc(cap1(String(rc.why).replace(/\.$/, ''))) + '.' : 'No pool pairs it with another token from $1,000 of reserve among the pools this site reads.') + '</p>');
    return rwaFold('mkt-rw7-h', '🔗 Tokens paired with it', srcLine({ src: 'geckoterminal', at: (fig(cn[0].reserveUsd) || {}).at }),
      '<p class="mkt-rwa-line"><b>' + cn.length + '</b> token' + (cn.length === 1 ? '' : 's') + ' trade in a pool against it — not one of them is an RWA.</p>' + own,
      'Every token paired with it (' + cn.length + ')',
      '<p class="mkt-note">Not one of these is an RWA: each is a token that trades in a pool against this one, from $1,000 of reserve. Pairing a token with an RWA says nothing about who issued it.</p><ol class="mkt-list mkt-list-in">' + cn.map(row).join('') + '</ol>');
  }
  // 8. the foot: not affiliated, not advice, and where these facts come from
  function rwaCardFootHTML(j) {
    const srcs = (Array.isArray(j.sources) ? j.sources : []).filter((x) => x && x.name);
    // the two closing lines always in sight; where the facts come from one press down
    return '<div class="mkt-note mkt-rwa-foot"><p class="mkt-rwa-foot-l">' + esc(RWA_NOT_AFFILIATED) + ' ' + esc(RWA_NOT_ADVICE) + '</p>' +
      (srcs.length ? '<details class="mkt-tbl"><summary>Where these facts come from (' + srcs.length + ' sources)</summary><p class="mkt-rwa-foot-l">These facts come from ' + srcs.map((x) => (/^https:\/\//.test(String(x.href || '')) ? '<a class="mkt-src-l" href="' + esc(x.href) + '" target="_blank" rel="noopener nofollow">' + esc(x.name) + '</a>' : esc(x.name))).join(', ') + ', read by this site’s server — automated reads, not an audit.</p></details>' : '') + '</div>';
  }
  const rwaCardHTML = (j) => rwaLeadHTML(j) + rwaRealHTML(j) + rwaHoldHTML(j) + rwaPriceHTML(j) + rwaActionsHTML(j) + rwaSizeHTML(j) + rwaControlsHTML(j) + rwaConnHTML(j) + rwaCardFootHTML(j);
  async function loadRwa(host) {
    const my = ++seq.rwa, addr = host.dataset.token;
    host.setAttribute('aria-busy', 'true');
    try {
      const j = await getJSON('/api/market/rwa/token?address=' + encodeURIComponent(addr));
      if (my !== seq.rwa || !document.contains(host)) return;
      host.innerHTML = rwaCardHTML(j || {});
      wireLogos(host);
    } catch (e) {
      if (my !== seq.rwa || !document.contains(host)) return;
      const b = e && e.body;
      // not an RWA here (any more): the server says which evidence is missing — never a failure dressed as "none"
      host.innerHTML = e && e.status === 404 && b && b.notRwa
        ? rwaSec('mkt-rw1-h', '🔎 Is this the real one?', '', '<p class="mkt-err-t">⚠ ' + esc(cap1(String(b.why || 'This site does not count it as an RWA').replace(/\.$/, ''))) + '.</p>' +
          twinLineHTML(b.twin) +
          '<p class="mkt-note">' + esc(RWA_NOT_AFFILIATED) + ' ' + esc(RWA_NOT_ADVICE) + '</p>')
        : rwaLeadHTML(null) + '<p class="mkt-err-t">⏳ ' + esc(errText(e, 'this token’s RWA facts')) + '</p>' + retryBtn('rwa');
    } finally { if (my === seq.rwa) host.removeAttribute('aria-busy'); }
  }
  // a token the RWA list holds, for its token view when the market read of it failed (its RWA facts do not need that read)
  function rwaKnown(addr) {
    const rows = (S.rwaAns && Array.isArray(S.rwaAns.rows)) ? S.rwaAns.rows : [];
    for (const r of rows) {
      if (r && r.address && sameToken(r.address, addr) && r.issuer && typeof r.issuer === 'object') return r;   // a stablecoin names its issuer in words: not an RWA
      for (const t of (r && Array.isArray(r.tokens) ? r.tokens : [])) if (sameToken(t.address, addr)) return t;
    }
    return null;
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
      const rh = $('mkt-rwa-host');
      if (rh) loadRwa(rh);   // right under the stats, so read at once (the server's stored facts: no vendor is asked for it)
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
      // its real-world-asset card is left out where this view already shows the RWA's facts, under its stats (hideRwa)
      host.innerHTML = NPCard.dashboardHTML(p, { kicker: '🛡️ Scanner', meta, level: 3, hideRwa: !!$('mkt-rwa-host') });
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

  /* ════════════════════════════ the whole crypto market, last 24 h: the bubble map ════════════════════════════
     Owner, 2026-10-30, with a picture of a "market heatmap": "Add in a view like this that shows a 24 quick visual on the top tokens
     across the whole market on the Market Data page." One SVG at the box's own pixel size: a big circle packed with a bubble per
     coin of CoinGecko's 100 largest (/api/market/heatmap; lib/marketmap.js has the rules), its AREA the coin's market cap and its
     fill the coin's 24 h change in the answer's legend — packed here (the @lift:pack block below), no library. A label only where
     it fits at or above the text floor (the symbol first, then the price and the change, and "Dominance" on the largest few); the
     rest is in each bubble's <title>, the tooltip and the list. Not 100 tab stops: the map is one role="img" with a summary in
     words, and "Show as a list" is the keyboard's way in — each row a button that opens the same card. The section folds away
     with its button, and this browser remembers that (the one thing this page keeps in the browser). Read again every 10 minutes
     while the page is open and in view. */

  /* @lift:pack (tests/marketpage.mjs runs this block in a vm: no two circles overlap, every one inside the ring, the same every time) */
  /* Circle packing, written for this page: each circle is laid against two neighbours on the "front chain" round the circles
     already placed, and the chain is mended where the new one would overlap a circle on it (Wang, Wang, Dai and Wang, "Visualization
     of large hierarchical data by circle packing", CHI 2006); then the smallest circle round them all, by Welzl's move-to-front
     method made iterative ("Smallest enclosing disks", 1991), over the circles in a fixed shuffled order — so the same coins always
     make the same picture. In: [{ r }] (largest first gives the biggest coins the middle); each gets its { x, y }, centred on the
     ring; out: the ring's radius. */
  function packTouch(p, q, c) {   // lay c against both p and q
    const dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
    if (!d2) { c.x = q.x + c.r; c.y = q.y; return; }
    const a2 = (q.r + c.r) * (q.r + c.r), b2 = (p.r + c.r) * (p.r + c.r);
    if (a2 > b2) { const x = (d2 + b2 - a2) / (2 * d2), y = Math.sqrt(Math.max(0, b2 / d2 - x * x)); c.x = p.x - x * dx - y * dy; c.y = p.y - x * dy + y * dx; }
    else { const x = (d2 + a2 - b2) / (2 * d2), y = Math.sqrt(Math.max(0, a2 / d2 - x * x)); c.x = q.x + x * dx - y * dy; c.y = q.y + x * dy + y * dx; }
  }
  const packHits = (a, b) => { const dr = a.r + b.r - 1e-6, dx = b.x - a.x, dy = b.y - a.y; return dr > 0 && dr * dr > dx * dx + dy * dy; };
  // how far from the middle the pair n, n.next sits (their weighted centre): the next circle goes against the pair nearest it
  const packNear = (n) => { const a = n.c, b = n.next.c, ab = a.r + b.r, x = (a.x * b.r + b.x * a.r) / ab, y = (a.y * b.r + b.y * a.r) / ab; return x * x + y * y; };
  const encNot = (a, b) => { const dr = a.r - b.r, dx = b.x - a.x, dy = b.y - a.y; return dr < 0 || dr * dr < dx * dx + dy * dy; };
  const encWeak = (a, b) => { const dr = a.r - b.r + Math.max(a.r, b.r, 1) * 1e-9, dx = b.x - a.x, dy = b.y - a.y; return dr > 0 && dr * dr > dx * dx + dy * dy; };
  const encAll = (a, B) => B.every((b) => encWeak(a, b));
  function enc2(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dr = b.r - a.r, l = Math.sqrt(dx * dx + dy * dy);
    return { x: (a.x + b.x + (dx / l) * dr) / 2, y: (a.y + b.y + (dy / l) * dr) / 2, r: (l + a.r + b.r) / 2 };
  }
  function enc3(a, b, c) {   // the circle touching all three from outside
    const a2 = a.x - b.x, a3 = a.x - c.x, b2 = a.y - b.y, b3 = a.y - c.y, c2 = b.r - a.r, c3 = c.r - a.r;
    const d1 = a.x * a.x + a.y * a.y - a.r * a.r, d2 = d1 - b.x * b.x - b.y * b.y + b.r * b.r, d3 = d1 - c.x * c.x - c.y * c.y + c.r * c.r;
    const ab = a3 * b2 - a2 * b3, xa = (b2 * d3 - b3 * d2) / (ab * 2) - a.x, xb = (b3 * c2 - b2 * c3) / ab, ya = (a3 * d2 - a2 * d3) / (ab * 2) - a.y, yb = (a2 * c3 - a3 * c2) / ab;
    const A = xb * xb + yb * yb - 1, B = 2 * (a.r + xa * xb + ya * yb), C = xa * xa + ya * ya - a.r * a.r;
    const r = -(Math.abs(A) > 1e-6 ? (B + Math.sqrt(B * B - 4 * A * C)) / (2 * A) : C / B);
    return { x: a.x + xa + xb * r, y: a.y + ya + yb * r, r };
  }
  const encOf = (B) => (B.length === 1 ? { x: B[0].x, y: B[0].y, r: B[0].r } : B.length === 2 ? enc2(B[0], B[1]) : enc3(B[0], B[1], B[2]));
  function encGrow(B, p) {   // the fewest circles (one to three, p among them) whose ring holds B and p
    if (encAll(p, B)) return [p];
    for (let i = 0; i < B.length; i++) if (encNot(p, B[i]) && encAll(enc2(B[i], p), B)) return [B[i], p];
    for (let i = 0; i < B.length - 1; i++) for (let j = i + 1; j < B.length; j++) {
      if (encNot(enc2(B[i], B[j]), p) && encNot(enc2(B[i], p), B[j]) && encNot(enc2(B[j], p), B[i]) && encAll(enc3(B[i], B[j], p), B)) return [B[i], B[j], p];
    }
    throw new Error('no enclosing circle');
  }
  function packEnclose(cs) {
    const L = cs.slice();
    let s = 1;
    const rnd = () => (s = (1664525 * s + 1013904223) % 4294967296) / 4294967296;   // a fixed sequence: the same order every time
    for (let m = L.length; m > 0;) { const i = Math.floor(rnd() * m); m--; const t = L[m]; L[m] = L[i]; L[i] = t; }
    let B = [], e = null;
    for (let i = 0; i < L.length;) {
      if (e && encWeak(e, L[i])) { i++; continue; }
      B = encGrow(B, L[i]); e = encOf(B); i = 0;
    }
    return e;
  }
  function packCircles(cs) {
    const n = cs.length; if (!n) return 0;
    const a = cs[0]; a.x = 0; a.y = 0; if (n === 1) return a.r;
    const b = cs[1]; a.x = -b.r; b.x = a.r; b.y = 0; if (n === 2) return a.r + b.r;   // two side by side: their ring is centred on 0 already
    packTouch(b, a, cs[2]);
    // the front chain: the circles on the outside, as a ring of links
    let A = { c: a }, B = { c: b }, C = { c: cs[2] };
    A.next = C.prev = B; B.next = A.prev = C; C.next = B.prev = A;
    place: for (let i = 3; i < n; i++) {
      const c = cs[i]; packTouch(A.c, B.c, c);
      const N = { c };
      // the nearest circle on the chain (by length along it, ahead of B or behind A) that the new one would overlap, if any
      let j = B.next, k = A.prev, sj = B.c.r, sk = A.c.r;
      do {
        if (sj <= sk) {
          if (packHits(j.c, c)) { B = j; A.next = B; B.prev = A; i--; continue place; }
          sj += j.c.r; j = j.next;
        } else {
          if (packHits(k.c, c)) { A = k; A.next = B; B.prev = A; i--; continue place; }
          sk += k.c.r; k = k.prev;
        }
      } while (j !== k.next);
      // it fits: into the chain between A and B, and the pair nearest the middle is where the next one goes
      N.prev = A; N.next = B; A.next = B.prev = B = N;
      let best = packNear(A);
      for (let m = N.next; m !== B; m = m.next) { const d = packNear(m); if (d < best) { A = m; best = d; } }
      B = A.next;
    }
    const front = [B.c]; for (let m = B.next; m !== B; m = m.next) front.push(m.c);
    let e;
    try { e = packEnclose(front); }
    catch { const cx = front.reduce((x, f) => x + f.x, 0) / front.length, cy = front.reduce((y, f) => y + f.y, 0) / front.length; e = { x: cx, y: cy, r: Math.max(...front.map((f) => Math.hypot(f.x - cx, f.y - cy) + f.r)) }; }
    for (const c of cs) { c.x -= e.x; c.y -= e.y; }
    return e.r;
  }
  /* @lift:pack-end */

  const mapEl = { sec: $('mkt-map'), body: $('mkt-map-body'), tog: $('mkt-map-tog'), cap: $('mkt-map-cap'), fig: $('mkt-map-fig'), key: $('mkt-map-legend'), card: $('mkt-map-card'), table: $('mkt-map-table'), foot: $('mkt-map-foot'), stables: $('mkt-map-stables') };
  const MAP = { ans: null, top: 100, stables: true, pick: null, seq: 0, at: 0, timer: 0, drawnW: 0, drawnH: 0, shown: false, soon: 0, ink: null };
  const MAP_KEY = 'jsi:market-map';   // the one thing this page keeps in the browser: whether the map is folded away ('hidden') or not
  const mapPref = { get: () => { try { return localStorage.getItem(MAP_KEY); } catch { return null; } }, set: (v) => { try { localStorage.setItem(MAP_KEY, v); } catch {} } };
  const MAP_TIP_ON = 'Folds the bubble map away so the chains and tokens come first; this browser remembers your choice';
  const MAP_TIP_OFF = 'Opens the bubble map of the whole crypto market again; this browser remembers your choice';
  const MAP_EVERY = 10 * 60e3;
  // the legend's steps (lib/marketmap.js BUCKETS, which the answer carries as legend): a 24 h change → its step
  function mapBucket(v) {
    if (v == null || !isFinite(v)) return 'none';
    if (v > 10) return 'up10'; if (v > 5) return 'up5'; if (v > 2) return 'up2'; if (v > 0) return 'up0'; if (v === 0) return 'flat';
    if (v < -10) return 'dn10'; if (v < -5) return 'dn5'; if (v < -2) return 'dn2'; return 'dn0';
  }
  const MAP_LEGEND = [['up10', '>10%'], ['up5', '>5%'], ['up2', '>2%'], ['up0', '>0%'], ['flat', '0%'], ['dn0', '<0%'], ['dn2', '<−2%'], ['dn5', '<−5%'], ['dn10', '<−10%'], ['none', 'no 24 h change given']];
  // a price as the picture writes it: whole dollars from $1,000 ("$76,894", never "$76.9k"), else the page's own words
  const mapPrice = (v) => (v == null || !isFinite(v) ? null : Math.abs(v) >= 1000 ? '$' + Math.round(v).toLocaleString('en-US') : usd(v));
  const domText = (v) => (v == null || !isFinite(v) ? null : v < 0.01 ? '<0.01%' : (v >= 10 ? v.toFixed(1) : v.toFixed(2)) + '%');
  const coinName = (r) => r.name || r.symbol || r.id;
  // the coins shown: CoinGecko's largest N (its order), the stablecoins among them left out when asked
  function mapRows() {
    const j = MAP.ans; if (!j || !Array.isArray(j.rows)) return [];
    const rows = j.rows.slice(0, MAP.top);
    return MAP.stables ? rows : rows.filter((r) => r.stable !== true);
  }
  const drawable = (r) => { const m = val(r.mcap); return m != null && m > 0; };
  function mapCounts(rows) {
    const c = { up: 0, down: 0, flat: 0, none: 0, drawn: 0 };
    rows.filter(drawable).forEach((r) => { c.drawn++; const b = mapBucket(val(r.change24h)); if (b === 'none') c.none++; else if (b === 'flat') c.flat++; else if (b.startsWith('up')) c.up++; else c.down++; });
    return c;
  }
  const countWords = (c) => [c.down + ' down', c.up + ' up', c.flat ? c.flat + ' unchanged' : '', c.none ? c.none + ' with no 24 h change given' : ''].filter(Boolean).join(', ');
  const capCounts = (c) => 'Over 24 h, <b>' + c.down + ' of these ' + c.drawn + ' coins are down</b>, ' + c.up + ' up' + (c.flat ? ', ' + c.flat + ' unchanged' : '') + (c.none ? ', ' + c.none + ' with no change given' : '');

  /* ---------- the folded / open section ---------- */
  function setMapOpen(on, remember) {
    if (!mapEl.body || !mapEl.tog) return;
    MAP.shown = on;
    mapEl.body.hidden = !on;
    mapEl.tog.setAttribute('aria-expanded', String(on));
    mapEl.tog.textContent = on ? 'Hide the map' : 'Show the map 🫧';
    mapEl.tog.setAttribute('data-tip', on ? MAP_TIP_ON : MAP_TIP_OFF);
    if (remember) mapPref.set(on ? 'shown' : 'hidden');
    if (!on) { mapTip(null); return; }
    if (MAP.ans) drawMap();   // at the box's size now (it may have changed while folded away); read again when it is 10 minutes old
    if (!MAP.ans || Date.now() - MAP.at >= MAP_EVERY) loadMap(!!MAP.ans);
  }

  /* ---------- reading it ---------- */
  async function loadMap(quiet) {
    if (!mapEl.fig) return;
    const my = ++MAP.seq;
    if (!quiet) { mapEl.fig.innerHTML = loadingHTML('Reading the whole market…'); mapEl.fig.setAttribute('aria-busy', 'true'); }
    try {
      const j = await getJSON('/api/market/heatmap');
      if (my !== MAP.seq) return;
      if (!j || !Array.isArray(j.rows) || !j.rows.length) {
        const e = new Error('empty'); e.status = 200; e.body = { message: (j && j.why) || 'The coins have not been read yet' }; throw e;
      }
      MAP.ans = j; MAP.at = Date.now();
      if (MAP.pick && !j.rows.some((r) => r.id === MAP.pick)) MAP.pick = null;
      paintMap();
    } catch (e) {
      if (my !== MAP.seq) return;
      if (quiet && MAP.ans) { planMap(); return; }   // a refresh that failed keeps the map it had: its caption says how old that is
      const said = e && e.status === 200 ? String((e.body && e.body.message) || '') : errText(e, 'the whole market');
      mapEl.fig.innerHTML = '<p class="mkt-err-t">⏳ ' + esc(e && e.status === 200 ? said.replace(/\.?$/, '.') + ' Nothing here is a reading of the market.' : said) + '</p><p class="mkt-acts">' + retryBtn('map') + '</p>';
      if (mapEl.cap) mapEl.cap.textContent = '';
      if (mapEl.table) mapEl.table.innerHTML = '';
    } finally { if (my === MAP.seq) mapEl.fig.removeAttribute('aria-busy'); }
    planMap();
  }
  // read again every 10 minutes while the page is open and in view (a page in the background catches up when it is looked at)
  function planMap() {
    clearTimeout(MAP.timer);
    MAP.timer = setTimeout(() => { if (document.visibilityState === 'visible' && MAP.shown) { memo.delete('/api/market/heatmap'); loadMap(true); } }, MAP_EVERY);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && MAP.shown && MAP.ans && Date.now() - MAP.at >= MAP_EVERY) { memo.delete('/api/market/heatmap'); loadMap(true); }
  });

  /* ---------- painting it: the legend, the caption, the map, the list, the sources ---------- */
  function paintMap() {
    const j = MAP.ans; if (!j) return;
    const rows = mapRows(), c = mapCounts(rows), byB = {};
    rows.filter(drawable).forEach((r) => { const b = mapBucket(val(r.change24h)); byB[b] = (byB[b] || 0) + 1; });
    if (mapEl.key) mapEl.key.innerHTML = MAP_LEGEND.map(([k, label]) => '<li><span class="mkt-map-sw mkt-b-' + k + '" aria-hidden="true"></span>' + esc(label) + ' <span class="mkt-map-n">(' + (byB[k] || 0) + ')</span></li>').join('');
    document.querySelectorAll('#mkt-map [data-map-top]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.mapTop) === MAP.top)));
    if (mapEl.stables) mapEl.stables.setAttribute('aria-pressed', String(!MAP.stables));
    const tot = fig(j.total), totV = val(tot), unknownStable = !MAP.stables && rows.some((r) => r.stable == null);
    if (mapEl.cap) mapEl.cap.innerHTML = 'Total market cap ' + (totV != null ? '<b>' + esc(usd(totV)) + '</b> (' + srcLine(tot) + ')' : NA + ' (' + whyOf(tot) + ')') +
      ' · ' + capCounts(c) + (MAP.stables ? '' : ' (stablecoins left out' + (unknownStable ? '; which coins are stablecoins is not known yet' : '') + ')') +
      ' · Bubble size: market cap. Colour: 24 h price change. Not advice, never a tip to buy.';
    drawMap(true);
    paintMapTable(rows);
    const reads = j.reads || {}, bad = ['coins', 'global', 'stables', 'coinlore'].map((k) => reads[k]).filter((x) => x && !x.ok && x.why);
    const srcs = Array.isArray(j.sources) ? j.sources : [];
    if (mapEl.foot) mapEl.foot.innerHTML = (bad.length ? '<span class="mkt-foot-n mkt-err-t">⏳ ' + bad.map((x) => esc(x.why)).join(' · ') + '</span>' : '') +
      (Array.isArray(j.notes) ? j.notes.filter((n) => !/^Not advice/.test(n)).map((n) => '<span class="mkt-foot-n">' + esc(n) + '</span>').join('') : '') +
      (srcs.length ? '<span class="mkt-foot-n">Sources: ' + srcs.map((x) => (/^https:\/\//.test(String(x.href || '')) ? '<a class="mkt-src-l" href="' + esc(x.href) + '" target="_blank" rel="noopener nofollow">' + esc(x.name) + '</a>' : esc(x.name))).join(' · ') + ' — read by this site’s server; your browser contacts none of them.</span>' : '');
    if (MAP.pick) openMapCard(MAP.pick, false); else if (mapEl.card) { mapEl.card.hidden = true; mapEl.card.innerHTML = ''; }
  }

  /* the text floor in pixels, and the canvas that measures a label before it is drawn */
  function mapFloor() {
    const p = document.createElement('span'); p.className = 'mkt-map-floor'; p.textContent = 'x';
    mapEl.fig.appendChild(p); const v = parseFloat(getComputedStyle(p).fontSize) || 14; p.remove(); return v;
  }
  const measurer = (() => { try { return document.createElement('canvas').getContext('2d'); } catch { return null; } })();
  function textW(t, px, wt) {
    if (!measurer) return String(t).length * px * 0.62;
    measurer.font = wt + ' ' + px.toFixed(2) + 'px Rubik, system-ui, -apple-system, sans-serif';
    return measurer.measureText(String(t)).width;
  }
  /* the ink that reads best on each step's fill as it is drawn (the higher contrast of --text and --ink-1): read off the legend's
     swatches, so a reader's own colours (prefs.js) are measured, not assumed */
  function rgbOf(s) {
    const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(s || '');
    if (m) return [+m[1], +m[2], +m[3]];
    const c = /color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)/.exec(s || '');
    return c ? [c[1] * 255, c[2] * 255, c[3] * 255] : null;
  }
  const lumOf = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
  const contrast = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function mapInks() {
    const probe = (prop, v) => { const s = document.createElement('span'); s.style[prop] = v; mapEl.fig.appendChild(s); const out = getComputedStyle(s)[prop]; s.remove(); return rgbOf(out); };
    const light = probe('color', 'var(--text)') || [242, 246, 236], dark = probe('color', 'var(--ink-1)') || [2, 3, 1], out = {};
    for (const [k] of MAP_LEGEND) {
      const sw = mapEl.key && mapEl.key.querySelector('.mkt-b-' + k), fill = k === 'none' ? probe('color', 'var(--ink-3)') : sw ? rgbOf(getComputedStyle(sw).backgroundColor) : null;
      out[k] = !fill || contrast(fill, light) >= contrast(fill, dark) ? 'var(--text)' : 'var(--ink-1)';
    }
    return out;
  }
  /* a bubble's label: as many of its lines as fit inside it with none under the floor — the symbol (up to 0.36 of the radius,
     never under the floor), then the other lines at 0.58 of it; each line no wider than 86% of the bubble's width at its height */
  function fitLabel(r, lines, floor) {
    let s = Math.max(r * 0.36, floor);
    for (let pass = 0; pass < 8; pass++) {
      const t = Math.max(floor, s * 0.58), sizes = lines.map((l, i) => (i ? t : s)), hts = sizes.map((z, i) => z * (i ? 1.16 : 1.04));
      const H = hts.reduce((a, b) => a + b, 0);
      if (H > r * 1.62) { s *= (r * 1.62 / H) * 0.99; if (s < floor) return null; continue; }
      let y = -H / 2, room = 1;
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        const top = y, bot = y + hts[i], edge = Math.max(Math.abs(top), Math.abs(bot));
        const chord = edge < r ? 2 * Math.sqrt(r * r - edge * edge) * 0.86 : 0, w = textW(lines[i].t, sizes[i], lines[i].w);
        if (w > chord) room = Math.min(room, chord / w);
        out.push({ t: lines[i].t, w: lines[i].w, z: sizes[i], y: (top + bot) / 2 });
        y = bot;
      }
      if (room >= 1) return out;
      s *= room * 0.99;
      if (s < floor) return null;
    }
    return null;
  }
  function labelFor(r, row, floor, big) {
    const sym = { t: row.symbol || coinName(row), w: 800 }, p = mapPrice(val(row.price)), ch = pct(val(row.change24h)), dm = domText(val(row.dominance));
    const sets = [];
    if (big && dm) sets.push([sym, { t: p, w: 600 }, { t: 'Dominance: ' + dm, w: 600 }, { t: ch || 'no change given', w: 700 }]);
    sets.push([sym, { t: p, w: 600 }, { t: ch || 'no change given', w: 700 }], [sym, { t: ch || 'no change given', w: 700 }], [sym]);
    for (const set of sets) { if (set.some((l) => !l.t)) continue; const fit = fitLabel(r, set, floor); if (fit) return fit; }
    return null;
  }
  function mapSize() {
    const w = Math.floor(mapEl.fig.clientWidth || 0);
    return Math.max(160, Math.min(w, 760, Math.max(320, Math.round(window.innerHeight * 0.8))));
  }
  function mapSummary(rows, c) {
    const big = rows.filter(drawable).slice(0, 2).map((r) => { const d = domText(val(r.dominance)), v = val(r.change24h);
      return coinName(r) + (d ? ' is ' + d + ' of the market' : '') + ', ' + (v == null ? 'no 24 h change given' : v > 0 ? 'up ' + Math.abs(v).toFixed(1) + '%' : v < 0 ? 'down ' + Math.abs(v).toFixed(1) + '%' : 'unchanged') + ' in 24 h'; });
    return 'Bubble map of the ' + c.drawn + ' largest coins by market cap' + (MAP.stables ? '' : ', stablecoins left out') + ': ' + big.join('; ') + '; ' + countWords(c) + '. Every coin is in the list under the map.';
  }
  function drawMap(fresh) {
    if (!mapEl.fig || !MAP.ans || !MAP.shown) return;
    const rows = mapRows(), shown = rows.filter(drawable).sort((a, b) => val(b.mcap) - val(a.mcap)), c = mapCounts(rows);
    const size = mapSize(), floor = mapFloor(), half = size / 2;
    MAP.drawnW = mapEl.fig.clientWidth; MAP.drawnH = window.innerHeight;
    if (!shown.length) { mapEl.fig.innerHTML = '<p class="mkt-empty">No coin here has a market cap to draw.</p>'; return; }
    const top = val(shown[0].mcap), unit = (r) => Math.sqrt(val(r.mcap) / top) * 100;
    // packed twice: once to learn the scale, then with each bubble padded by about a pixel at that scale, so they never touch
    const gap = size < 500 ? 0.9 : 1.4;
    let cs = shown.map((r) => ({ r: unit(r) }));
    const k0 = (half - 2) / packCircles(cs);
    cs = shown.map((r) => ({ r: unit(r) + gap / k0, row: r }));
    const k = (half - 2) / packCircles(cs);
    const ink = MAP.ink = mapInks();
    const old = mapEl.fig.querySelector('svg.mkt-map-svg');
    const svg = el('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, class: 'mkt-map-svg', role: 'img', 'aria-label': mapSummary(rows, c) });
    const defs = el('defs', {}, svg), pat = el('pattern', { id: 'mkt-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 6, height: 6, class: 'mkt-hatch-bg' }, pat); el('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'mkt-hatch-ln' }, pat);
    el('circle', { cx: half, cy: half, r: half - 1.5, class: 'mkt-map-ring' }, svg);
    const bigIds = new Set(shown.slice(0, 3).map((r) => r.id));
    cs.forEach((p) => {
      const row = p.row, r = Math.max(0.6, (p.r - gap / k0) * k), x = half + p.x * k, y = half + p.y * k, b = mapBucket(val(row.change24h));
      const g = el('g', { class: 'mkt-bub mkt-b-' + b + (row.id === MAP.pick ? ' is-on' : ''), 'data-coin': row.id }, svg);
      el('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: r.toFixed(2) }, g);
      const ti = el('title', {}, g); ti.textContent = tipWords(row);
      const lab = labelFor(r, row, floor, bigIds.has(row.id));
      if (lab) lab.forEach((l) => { const t = el('text', { x: x.toFixed(2), y: (y + l.y).toFixed(2), class: 'mkt-bub-t', style: 'font-size: max(var(--text-floor), ' + l.z.toFixed(2) + 'px); font-weight: ' + l.w + '; fill: ' + ink[b] }, g); t.textContent = l.t; });
    });
    const first = !old && fresh && !reduced();
    if (first) svg.classList.add('is-new');
    if (old) old.replaceWith(svg); else { mapEl.fig.innerHTML = ''; mapEl.fig.appendChild(svg); }
    if (first) setTimeout(() => { svg.classList.add('is-in'); svg.classList.remove('is-new'); }, 30);
    if (!mapEl.fig.querySelector('.mkt-map-tip')) { const tip = document.createElement('div'); tip.className = 'mkt-map-tip'; tip.id = 'mkt-map-tip'; tip.hidden = true; tip.setAttribute('aria-hidden', 'true'); mapEl.fig.appendChild(tip); }
  }
  // a bubble's figures in words: its <title>, and the tooltip's lines
  function tipWords(r) {
    const d = domText(val(r.dominance)), v = val(r.change24h);
    return (r.symbol || '') + ' · ' + coinName(r) + ' — price ' + (mapPrice(val(r.price)) || 'not available') + ', market cap ' + (usd(val(r.mcap)) || 'not available') + (d ? ', ' + d + ' of the market' : '') +
      ', 24 h ' + (v == null ? 'no change given' : pct(v)) + ', volume ' + (usd(val(r.volume24h)) || 'not available');
  }
  const mapChk = (r) => mcapChip({ check: r.check });
  function tipHTML(r) {
    const row = (label, f, fmt) => { const x = val(f); return '<dt>' + esc(label) + '</dt><dd>' + (x != null ? esc(fmt(x)) : 'Not available') + '</dd>'; };
    return '<b>' + esc(r.symbol || '') + '</b> ' + esc(coinName(r)) +
      '<dl>' + row('Price', r.price, mapPrice) + row('Market cap', r.mcap, usd) + row('Dominance', r.dominance, domText) + row('24 h change', r.change24h, (x) => pct(x)) + row('24 h volume', r.volume24h, usd) + '</dl>' +
      '<span class="mkt-s">' + srcLine(fig(r.mcap)) + '</span> ' + mapChk(r);
  }
  // the tooltip: beside the pointer, inside the map's box
  function mapTip(g, e) {
    const tip = mapEl.fig && mapEl.fig.querySelector('.mkt-map-tip'); if (!tip) return;
    const prev = mapEl.fig.querySelector('.mkt-bub[data-tipped]');
    if (prev && prev !== g) { const t = el('title', {}, null); t.textContent = prev.dataset.tipped; prev.insertBefore(t, prev.firstChild.nextSibling); prev.removeAttribute('data-tipped'); }
    if (!g) { tip.hidden = true; return; }
    const r = MAP.ans && MAP.ans.rows.find((x) => x.id === g.dataset.coin); if (!r) { tip.hidden = true; return; }
    // the bubble's own <title> stands aside while the tooltip shows the same, so the browser does not show it a second time
    const ti = g.querySelector('title'); if (ti) { g.dataset.tipped = ti.textContent; ti.remove(); }
    if (tip.dataset.coin !== r.id) { tip.innerHTML = tipHTML(r); tip.dataset.coin = r.id; }
    tip.hidden = false;
    const box = mapEl.fig.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX - box.left + 16, y = e.clientY - box.top + 16;
    if (x + tw > box.width) x = Math.max(0, e.clientX - box.left - tw - 16);
    if (y + th > box.height) y = Math.max(0, e.clientY - box.top - th - 16);
    tip.style.left = Math.round(x) + 'px'; tip.style.top = Math.round(y) + 'px';
  }
  /* ---------- a coin's card, under the map ---------- */
  function openMapCard(id, focus) {
    const r = MAP.ans && MAP.ans.rows.find((x) => x.id === id); if (!r || !mapEl.card) return;
    MAP.pick = id;
    mapEl.fig.querySelectorAll('.mkt-bub').forEach((g) => g.classList.toggle('is-on', g.dataset.coin === id));
    if (mapEl.table) mapEl.table.querySelectorAll('tr[data-coin]').forEach((tr) => tr.classList.toggle('is-on', tr.dataset.coin === id));
    const chk = r.check || {}, notes = Array.isArray(chk.notes) ? chk.notes : [], cgId = /^[a-z0-9-]{1,80}$/.test(String(r.id || '')) ? r.id : null;
    const rankF = Number.isInteger(r.rank) ? { v: r.rank, src: 'coingecko', at: val(r.mcap) != null ? fig(r.mcap).at : null, label: 'market-cap rank (CoinGecko)' } : { v: null, src: 'coingecko', why: 'CoinGecko gives no rank for this coin' };
    mapEl.card.innerHTML = '<section class="mkt-card mkt-map-c" aria-labelledby="mkt-mapc-h"><div class="mkt-card-h"><h3 class="mkt-h3" id="mkt-mapc-h" tabindex="-1">' + esc(r.symbol || '') + ' <span class="mkt-sym">' + esc(coinName(r)) + '</span></h3>' + mapChk(r) + '</div>' +
      '<dl class="mkt-stats">' + stat('Price', r.price, mapPrice) + stat('Market cap', r.mcap, usd) + stat('Dominance', r.dominance, domText) + stat('24 h price change', r.change24h, (x) => pct(x)) + stat('24 h volume', r.volume24h, usd) +
      stat('Rank', rankF, (x) => '#' + x) + '</dl>' +
      (r.stable === true ? '<p class="mkt-note">CoinGecko files this coin as a stablecoin.</p>' : '') +
      (notes.length ? '<ul class="mkt-chknotes">' + notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '') +
      '<p class="mkt-acts">' + (cgId ? '<a class="mkt-src-l mkt-map-ext" href="https://www.coingecko.com/en/coins/' + encodeURIComponent(cgId) + '" target="_blank" rel="noopener">View on CoinGecko ↗</a> ' : '') +
      '<button class="btn btn-sm btn-ghost mkt-mini" type="button" data-map-close="1" data-tip="Closes this coin’s card">✕ Close</button></p>' +
      '<p class="mkt-note">Not advice, never a tip to buy.</p></section>';
    mapEl.card.hidden = false;
    if (focus) { const h = $('mkt-mapc-h'); if (h) { h.focus({ preventScroll: true }); h.scrollIntoView({ block: 'nearest' }); } }
  }
  function closeMapCard() {
    const was = MAP.pick; MAP.pick = null;
    if (mapEl.card) { mapEl.card.hidden = true; mapEl.card.innerHTML = ''; }
    if (mapEl.fig) mapEl.fig.querySelectorAll('.mkt-bub.is-on').forEach((g) => g.classList.remove('is-on'));
    if (mapEl.table) mapEl.table.querySelectorAll('tr.is-on').forEach((tr) => tr.classList.remove('is-on'));
    return was;
  }
  /* ---------- the list: every coin, its row a button that opens the same card ---------- */
  function paintMapTable(rows) {
    if (!mapEl.table) return;
    const cell = (label, f, fmt) => { const x = val(f); return '<td data-l="' + label + '">' + (x != null ? esc(fmt(x)) : NA) + '</td>'; };
    mapEl.table.innerHTML = '<table class="mkt-table mkt-map-t"><caption class="sr-only">The coins on the map, largest first</caption><thead><tr><th scope="col">Rank</th><th scope="col">Coin</th><th scope="col">Price</th><th scope="col">Market cap</th><th scope="col">Dominance</th><th scope="col">24 h change</th><th scope="col">Check</th></tr></thead><tbody>' +
      rows.map((r) => '<tr data-coin="' + esc(r.id) + '"' + (r.id === MAP.pick ? ' class="is-on"' : '') + '><td data-l="Rank">' + (Number.isInteger(r.rank) ? '#' + r.rank : NA) + '</td>' +
        '<th scope="row"><button class="mkt-map-pick" type="button" data-map-coin="' + esc(r.id) + '" data-tip="Opens ' + esc(coinName(r)) + '’s figures in a card under the map">' + esc(r.symbol || '') + ' <small>' + esc(coinName(r)) + (r.stable === true ? ' · stablecoin' : '') + '</small></button></th>' +
        cell('Price', r.price, mapPrice) + cell('Market cap', r.mcap, usd) + cell('Dominance', r.dominance, domText) + cell('24 h change', r.change24h, (x) => pct(x)) + '<td data-l="Check">' + (mapChk(r) || NA) + '</td></tr>').join('') + '</tbody></table>';
  }
  /* ---------- its controls ---------- */
  if (mapEl.sec) {
    mapEl.tog.addEventListener('click', () => setMapOpen(!MAP.shown, true));
    mapEl.sec.addEventListener('click', (e) => {
      const t = e.target.closest('[data-map-top]');
      if (t) { const n = Number(t.dataset.mapTop) === 50 ? 50 : 100; if (n !== MAP.top) { MAP.top = n; paintMap(); say('The map shows the ' + n + ' largest coins' + (MAP.stables ? '' : ', stablecoins left out') + '.'); } return; }
      if (e.target.closest('#mkt-map-stables')) { MAP.stables = !MAP.stables; paintMap(); say(MAP.stables ? 'Stablecoins are on the map again.' : 'Stablecoins are left out of the map.'); return; }
      const p = e.target.closest('[data-map-coin]'); if (p) { openMapCard(p.dataset.mapCoin, true); return; }
      if (e.target.closest('[data-map-close]')) { const was = closeMapCard(); const b = was && mapEl.table && mapEl.table.querySelector('[data-map-coin="' + was + '"]'); if (b && b.offsetParent) b.focus(); else if (mapEl.tog) mapEl.tog.focus(); return; }
      const g = e.target.closest('.mkt-bub'); if (g) { mapTip(null); openMapCard(g.dataset.coin, true); }
    });
    mapEl.fig.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; mapTip(e.target.closest('.mkt-bub'), e); });
    mapEl.fig.addEventListener('pointerleave', () => mapTip(null));
    mapEl.card.addEventListener('keydown', (e) => { if (e.key === 'Escape' && MAP.pick) { e.preventDefault(); const was = closeMapCard(); const b = was && mapEl.table && mapEl.table.querySelector('[data-map-coin="' + was + '"]'); if (b && b.offsetParent) b.focus(); } });
    // redrawn when its box changes width or the screen's height moves its cap — after the change settles, never mid-drag
    const reMap = () => { clearTimeout(MAP.soon); MAP.soon = setTimeout(() => { if (MAP.shown && MAP.ans && (Math.abs(mapEl.fig.clientWidth - MAP.drawnW) > 2 || Math.abs(window.innerHeight - MAP.drawnH) > 40)) { mapTip(null); drawMap(false); } }, 160); };
    if (typeof ResizeObserver === 'function') new ResizeObserver(reMap).observe(mapEl.fig);
    window.addEventListener('resize', reMap);
    // the labels are measured in the site's font: once it has loaded, they are measured again
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { if (MAP.shown && MAP.ans) drawMap(false); }).catch(() => {});
  }

  /* ════════════════════════════ start ════════════════════════════ */
  // Back / Forward to another chain filter shows Top tokens, where that filter is (Top chains and Top tokens are not in the address);
  // the RWA tab is (tab=rwa): an address with it shows that tab with its choices, and leaving it goes where the address points — Top
  // tokens for a token or a chain filter, else Top chains. An open chain list closes first — left open, its tick and the focus would
  // be on a chain that is no longer the one chosen
  window.addEventListener('popstate', () => { closePick(true); readURL(); syncControls(); loadView(false);
    if (S.urlTab === 'rwa') { if (S.tab !== 'rwa') setTab('rwa', false); else { S.shown = pageSize(); loadList(); } return; }
    if (S.tab === 'rwa') { setTab(S.view.token || S.tokens.tchain ? 'tokens' : 'chains', false); return; }
    if (S.tchainMoved && S.tab !== 'tokens') setTab('tokens', false); else loadList(); });
  readURL();
  S.shown = pageSize();
  paintFilter();
  // a link that opened the page on the RWA tab opens it, with its choices; one on a token, or on a chain filter, opens Top tokens —
  // the logos come with the chains list, which that tab does not read, so it is asked for them quietly (the same read the first
  // view makes, kept a minute)
  if (S.urlTab === 'rwa') setTab('rwa', false);
  else if (S.view.token || S.tokens.tchain) {
    setTab('tokens', false);
    getJSON('/api/market/chains').then((j) => { if (learnChains(j && j.rows, (r) => r.key)) paintFilter(); }).catch(() => {});
  } else { syncControls(); loadList(); }
  loadView(false);
  // the bubble map: open unless this browser folded it away (then it is read only when it is opened)
  if (mapEl.sec) setMapOpen(mapPref.get() !== 'hidden', false);
})();
