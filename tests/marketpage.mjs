/* ===== The Market Data page (/market) — owner, 2026-10-26 ============================================================
   "Setup a page named Market Data that has a full dashboard of all of the chain's data … Robinhood being the default view
   … a main view … the search bar … the chain or token in list view on the side … top chains and top tokens … highest or
   lowest … time frame (their own time or default times), Market Cap, Liquidity, TVL and Volume."

   1. The page, from its source: the head and the house shell (the nav and footer link on every page), the scripts it
      needs for the Scanner's dashboard, what market.js may read (only /api/market/*, same origin), the words it may use,
      and the honesty rules (a missing figure is "Not available" with its reason, never 0; growthepie credited).
   2. The fixtures in tests/fixtures/market/ against the shared contract (the routes' shapes, every figure an
      { v, src, at, why? } object, null with a reason) — they were built from the vendors' own answers measured on
      2026-10-26 and are what the page was built and walked against in a muted headless Chrome.
   3. market.js's number words, lifted between its @lift markers and run in a vm.
   4. A fake of the /api/market/* routes, served from those fixtures, with the site's CSP: run here against its own
      contract (sorting with nulls last both ways, wash volume left out of "highest volume", the windows, 404s), and
      started on its own by `node tests/marketpage.mjs --serve <port>` for a browser walk.
   5. When the suite's real server already answers /api/market/chains, its answers carry the contract's keys; a server
      that predates the routes is reported, not failed.
   No live vendor is ever called. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const FIXDIR = path.join(ROOT, 'tests', 'fixtures', 'market');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const FIX = (f) => JSON.parse(readFileSync(path.join(FIXDIR, f), 'utf8'));
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

/* ═══════════════════ the fake API (also the browser walk's server: --serve <port>) ═══════════════════ */
const CSP = "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self' https://rpc.mainnet.chain.robinhood.com https://cloudflareinsights.com; frame-src https://dexscreener.com https://www.geckoterminal.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const SORT_FIELD = { chains: { tvl: 'tvl', volume: 'volume', liquidity: 'liquidity', mcap: 'mcap', fees: 'fees' }, tokens: { volume: 'volume', liquidity: 'liquidity', mcap: 'mcap', fdv: 'fdv', change: 'change' } };
const v = (x) => (x == null ? null : typeof x === 'number' ? x : x.v == null ? null : Number(x.v));
function sortRows(rows, field, dir) {   // a row whose figure is null sorts last in both directions (the contract)
  return rows.slice().sort((a, b) => { const x = v(a[field]), y = v(b[field]); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return dir === 'asc' ? x - y : y - x; });
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function fakeAnswer(u) {
  const q = u.searchParams, p = u.pathname;
  const win = q.get('window') || '24h', from = q.get('from'), to = q.get('to');
  const customOk = win !== 'custom' || (DAY.test(from || '') && DAY.test(to || '') && from <= to);
  if (!customOk) return [400, { error: 'a custom window needs from and to, whole UTC days, from ≤ to' }];
  const custom = (j) => (win === 'custom' ? Object.assign({}, j, { window: Object.assign({}, j.window, { from, to, label: from + ' – ' + to }) }) : j);
  if (p === '/api/market/chains') {
    if (!['24h', '7d', '30d', 'custom'].includes(win)) return [400, { error: 'unknown window' }];
    const sort = q.get('sort') || 'tvl', dir = q.get('dir') === 'asc' ? 'asc' : 'desc';
    if (!SORT_FIELD.chains[sort]) return [400, { error: 'unknown sort' }];
    const j = custom(FIX('chains-' + win + '.json'));
    const limit = Math.max(1, Math.min(200, Number(q.get('limit')) || 50));
    return [200, Object.assign({}, j, { sort, dir, rows: sortRows(j.rows, SORT_FIELD.chains[sort], dir).slice(0, limit) })];
  }
  if (p === '/api/market/chain') {
    const key = q.get('key') || '';
    const list = FIX('chains-24h.json'), row = list.rows.find((r) => r.key === key);
    if (!row) return [404, { error: 'no chain called “' + key + '” in our records' }];
    let j;
    if (existsSync(path.join(FIXDIR, 'chain-' + key + '.json'))) j = FIX('chain-' + key + '.json');
    else {
      const why = { rows: [], why: 'not collected for this chain yet' };
      j = { key, name: row.name, chainId: row.chainId, at: list.at, window: list.window,
        stats: { tvl: row.tvl, volume24h: row.volume, volume7d: { v: null, src: 'defillama', at: list.at, why: 'not collected for this chain yet' }, volume30d: { v: null, src: 'defillama', at: list.at, why: 'not collected for this chain yet' }, windowVolume: row.volume,
          fees24h: row.fees, appFees24h: { v: null, src: 'defillama', at: list.at, why: 'Per-chain app fees are read for tracked chains only' }, stables: row.stables, oi: { v: null, src: 'defillama', at: list.at, why: 'not read in this sample' },
          mcap: row.mcap, tvs: row.tvs, tvsBreakdown: null, txcount24h: { v: null, src: 'growthepie', at: list.at, why: 'growthepie does not cover this chain' }, daa: { v: null, src: 'growthepie', at: list.at, why: 'growthepie does not cover this chain' },
          medianTxCostUsd: { v: null, src: 'growthepie', at: list.at, why: 'growthepie does not cover this chain' }, stage: row.stage, risks: [] },
        history: { tvl: { src: 'defillama', ...why }, volume: { src: 'defillama', ...why }, fees: { src: 'defillama', ...why }, stables: { src: 'defillama', ...why }, txcount: { src: 'growthepie', ...why } },
        topTokens: { rows: [], basis: 'GeckoTerminal’s most-traded pools, pages 1–3, grouped by token' }, newPools: [], sources: [{ id: 'defillama', name: 'DefiLlama', url: 'https://defillama.com/' }] };
    }
    if (win !== '24h') {
      const W = FIX('chains-' + (win === 'custom' ? 'custom' : win) + '.json');
      const h = (j.history && j.history.volume && j.history.volume.rows) || [];
      let sum = null;
      if (h.length) {
        const last = h[h.length - 1][0], n = win === '7d' ? 7 : win === '30d' ? 30 : 0;
        const lo = win === 'custom' ? from : new Date(Date.parse(last + 'T00:00:00Z') - (n - 1) * 864e5).toISOString().slice(0, 10), hi = win === 'custom' ? to : last;
        const inWin = h.filter(([d]) => d >= lo && d <= hi);
        const covered = inWin.length && (win !== 'custom' || (h[0][0] <= lo && last >= hi));
        sum = covered ? inWin.reduce((a, [, x]) => a + x, 0) : null;
      }
      j = Object.assign({}, j, { window: win === 'custom' ? { kind: 'custom', from, to, label: from + ' – ' + to } : W.window,
        stats: Object.assign({}, j.stats, { windowVolume: sum != null ? { v: sum, src: 'defillama', at: j.at, label: 'DEX volume, ' + (win === 'custom' ? from + ' – ' + to : W.window.label) } : { v: null, src: 'defillama', at: j.at, why: 'the daily history does not cover these days' } }) });
    }
    return [200, j];
  }
  if (p === '/api/market/tokens') {
    const chain = q.get('chain') || '';
    if (!['5m', '1h', '6h', '24h', 'custom'].includes(win)) return [400, { error: 'unknown window' }];
    const sort = q.get('sort') || 'volume', dir = q.get('dir') === 'asc' ? 'asc' : 'desc';
    if (!SORT_FIELD.tokens[sort]) return [400, { error: 'unknown sort' }];
    const row = FIX('chains-24h.json').rows.find((r) => r.key === chain);
    if (!row) return [404, { error: 'no chain called “' + chain + '” in our records' }];
    if (chain !== 'robinhood') return [200, { at: Date.now(), chain, network: row.gtNetwork, basis: row.gtNetwork ? 'GeckoTerminal’s most-traded pools, pages 1–3, grouped by token' : null, window: { kind: win, label: win }, rows: [] }];
    const j = custom(FIX('tokens-robinhood-' + win + '.json'));
    let rows = sortRows(j.rows, SORT_FIELD.tokens[sort], dir);
    if (sort === 'volume' && dir === 'desc' && q.get('include') !== 'all') rows = rows.filter((r) => !(r.flags || []).includes('wash'));
    if (sort === 'mcap') rows = sortRows(rows.map((r) => ((r.flags || []).includes('global-mcap') ? Object.assign({}, r, { mcap: Object.assign({}, r.mcap, { v: null, why: 'a global, all-chains figure — kept out of a chain-local ranking' }) }) : r)), 'mcap', dir);
    return [200, Object.assign({}, j, { sort, dir, rows: rows.slice(0, Math.max(1, Math.min(200, Number(q.get('limit')) || 200))) })];
  }
  if (p === '/api/market/token') {
    const chain = q.get('chain') || '', addr = String(q.get('address') || '').toLowerCase();
    const f = 'token-' + chain + '-' + addr + '.json';
    let j = existsSync(path.join(FIXDIR, f)) ? FIX(f) : null;
    if (!j && chain === 'robinhood') {
      const r = FIX('tokens-robinhood-24h.json').rows.find((x) => x.address === addr);
      if (r) {
        const win = (k) => { const w = FIX('tokens-robinhood-' + k + '.json').rows.find((x) => x.address === addr); return w ? { volume: w.volume, change: w.change, buys: null, sells: null } : {}; };
        j = { chain, address: addr, symbol: r.symbol, name: r.name, logo: r.logo, links: { websites: [], socials: [] }, priceUsd: r.priceUsd, mcap: r.mcap, fdv: r.fdv, supplyBasis: null, liquidity: Object.assign({}, r.liquidity, { label: 'across ' + r.liquidity.pools + ' pool' + (r.liquidity.pools === 1 ? '' : 's') }),
          pools: [], windows: { '5m': win('5m'), '1h': win('1h'), '6h': win('6h'), '24h': win('24h') }, candles: { tf: 'hour', rows: [], src: 'geckoterminal', why: 'not in this fixture' }, scanner: { supported: true, href: '/newpairs?scan=' + addr + '&chain=robinhood' }, at: r.priceUsd.at };
      }
    }
    if (!j) return [404, { error: 'No pool data for this token on ' + chain + ' yet' }];
    if (win === 'custom') j = Object.assign({}, j, { custom: { volume: { v: null, src: 'site', at: Date.now(), why: 'our history starts 2026-10-26' }, priceChange: { v: null, src: 'site', at: Date.now(), why: 'our history starts 2026-10-26' }, coverage: { from: '2026-10-26' }, src: 'site' } });
    return [200, j];
  }
  if (p === '/api/market/scan') {
    const chain = q.get('chain') || '', addr = String(q.get('address') || '').toLowerCase(), f = 'scan-' + chain + '-' + addr + '.json';
    if (existsSync(path.join(FIXDIR, f))) return [200, FIX(f)];
    return [503, { unavailable: true, message: 'The chain could not be read for this token just now — nothing here is a judgement about it.' }];
  }
  if (p === '/api/market/search') {
    const text = String(q.get('q') || '').trim().toLowerCase();
    if (text.length < 2) return [400, { error: 'type at least two letters' }];
    const chains = FIX('chains-24h.json').rows.filter((r) => r.key.includes(text) || r.name.toLowerCase().includes(text)).map((r) => ({ key: r.key, name: r.name }));
    const tokens = FIX('tokens-robinhood-24h.json').rows.filter((r) => [r.symbol, r.name, r.address].some((x) => String(x || '').toLowerCase().includes(text)))
      .map((r) => ({ chain: r.chain, address: r.address, symbol: r.symbol, name: r.name, priceUsd: v(r.priceUsd), liquidity: v(r.liquidity), volume24h: v(FIX('tokens-robinhood-24h.json').rows.find((x) => x.address === r.address).volume), src: 'geckoterminal' }));
    return [200, { q: text, chains, tokens }];
  }
  if (p === '/api/market/new-pools') return [200, { chain: q.get('chain') || 'robinhood', rows: (FIX('chain-robinhood.json').newPools || []).slice(0, Number(q.get('limit')) || 20) }];
  if (p === '/api/market/status') return [200, { collectors: [], tables: [] }];
  return [404, { error: 'not found' }];
}
function startFake(port, opts = {}) {
  const delay = Number(opts.delay || process.env.MARKET_FAKE_DELAY || 0), fail = String(opts.fail || process.env.MARKET_FAKE_FAIL || '');
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); res.end(JSON.stringify(body)); };
    if (u.pathname.startsWith('/api/')) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (u.pathname.startsWith('/api/market/')) {
        const what = u.pathname.slice('/api/market/'.length);
        if (fail && fail.split(',').includes(what)) return json(503, { error: 'the fake was told to fail ' + what });
        try { const [code, body] = fakeAnswer(u); return json(code, body); } catch (e) { return json(500, { error: String(e && e.message) }); }
      }
      if (u.pathname === '/api/me') return json(401, { error: 'not signed in' });
      return json(404, { error: 'not in the fake' });
    }
    let f = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1));
    if (/^[a-z0-9-]+$/.test(f) && existsSync(path.join(PUB, f + '.html'))) f += '.html';
    if (f.includes('..')) f = '';
    const fp = path.join(PUB, f);
    if (!f || !fp.startsWith(PUB) || !existsSync(fp)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' });
    res.end(readFileSync(fp));
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok(srv)));
}

if (process.argv[2] === '--serve') {
  const port = Number(process.argv[3]) || 0;
  const srv = await startFake(port);
  console.log('market fake serving http://127.0.0.1:' + srv.address().port + '/market  (MARKET_FAKE_DELAY / MARKET_FAKE_FAIL=chains,chain,tokens,token,scan,search)');
} else {
  await runSuite();
}

async function runSuite() {
  const PORT = process.argv[2];
  try {
    const H = read('market.html'), JS = read('market.js'), CSS = read('market.css'), SENDY = read('sendy.js');
    const head = H.slice(0, H.indexOf('</head>'));
    const order = (src, ...names) => { const at = names.map((n) => src.indexOf(n)); return at.every((i) => i >= 0) && at.every((i, k) => k === 0 || i > at[k - 1]); };

    /* ═══ 1. the page ═══ */
    check('the page is Market Data: its title, an indexable head with one canonical at /market, and a Home → Market Data breadcrumb',
      /<title>Market Data — Just Send It<\/title>/.test(H) && (H.match(/<link rel="canonical" href="https:\/\/sendrh\.com\/market">/g) || []).length === 1
      && /<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">/.test(H) && /"name":"Market Data","item":"https:\/\/sendrh\.com\/market"/.test(H));
    check('  ...its head in the house order: fonts, styles, the cursor, the 18+ question, moderation, token text, market.css, then responsive.css last, then /ga.js',
      order(head, 'href="fonts/fonts.css"', 'href="styles.css"', '<link rel="stylesheet" href="cursor.css">\n<script src="cursor.js"></script>', '<script src="agegate.js"></script>', 'href="moderation.css"', 'href="tokentext.css"', 'href="market.css"', 'href="responsive.css"', '<script src="/ga.js" defer></script>') && /<script src="\/ga\.js" defer><\/script>\n<\/head>/.test(H));
    check('  ...the shell the other pages share: the compact nav with the sender search first, the hero with h1 + .section-sub (the house drop cap) and the warning, <main id="main">, the footer note',
      /<nav class="nav is-compact" aria-label="Main">/.test(H) && /<div class="nav-menu" id="nav-menu">\s*<span id="nav-search-slot"><\/span>/.test(H)
      && /<header class="np-hero mkt-hero">\s*<h1 class="section-title display green"[^>]*>Market Data 📊<\/h1>\s*<p class="section-sub"/.test(H) && /<p class="np-hero-warn">⚠️[^<]*<b>Do your own research\.<\/b><\/p>/.test(H)
      && /<main id="main"/.test(H) && /<div class="disclaimer">🎉 Entertainment Purposes Only 🎉<\/div>/.test(H) && /Not affiliated with Robinhood Markets, Inc\./.test(H));
    check('  ...it marks itself current in the nav (after How to Buy) and in the footer',
      /<a href="\/guide">How&nbsp;to&nbsp;Buy<\/a>\n    <a class="active" href="\/market" aria-current="page">Market&nbsp;Data<\/a>/.test(H) && /<a href="\/guide">How to Buy<\/a>\n    <a href="\/market" aria-current="page">Market Data<\/a>/.test(H));
    const NAV_PAGES = ['about', 'arcade', 'communities', 'community', 'data', 'index', 'newpairs', 'profile', 'squad', 'support', 'tracker', 'u', 'wall', 'watchlist', 'whitepaper'];
    const noNav = NAV_PAGES.filter((p) => !/<a href="\/guide">How&nbsp;to&nbsp;Buy<\/a>\n\s*<a href="\/market">Market&nbsp;Data<\/a>\n/.test(read(p + '.html')));
    const noFoot = NAV_PAGES.filter((p) => !/<a href="\/guide">How to Buy<\/a>\n( {4,5})<a href="\/market">Market Data<\/a>\n/.test(read(p + '.html')));
    check('every one of the 15 pages links Market Data right after How to Buy, in its nav and in its footer', !noNav.length && !noFoot.length, 'nav: ' + noNav.join(',') + ' footer: ' + noFoot.join(','));
    const linked = readdirSync(PUB).filter((f) => f.endsWith('.html') && /href="\/market"/.test(read(f)));
    check('  ...and no page links it by its file name', !readdirSync(PUB).filter((f) => f.endsWith('.html')).some((f) => /href="\/?market\.html"/.test(read(f))) && linked.length >= 16, linked.length + ' pages');
    check('the scripts the Scanner\'s dashboard needs, as watchlist.html loads them: chart.js, newpairs.js, tokenmodal.js, swapkit.js after wallet.js; market.js before block0.js; block0.js then bundlers.js; sendy.js then onboard.js',
      order(H, 'src="app.js"></script>\n<script src="sfx.js"', 'src="tips.js"', 'src="wallet.js"', 'src="watch.js"', 'src="chart.js"', 'src="newpairs.js"', 'src="tokenmodal.js"', 'src="swapkit.js"', 'src="market.js"', 'src="block0.js"></script>\n<script src="bundlers.js"', 'src="sendy.js"></script>\n<script src="onboard.js"')
      && !/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/.test(H));
    check('  ...the layout\'s parts: the search form, the side column\'s two tabs (a tablist driving one panel) and the main view',
      /<form class="mkt-search" id="mkt-search" role="search"/.test(H) && /id="mkt-tab-chains" type="button" role="tab" aria-selected="true" aria-controls="mkt-panel"/.test(H) && /id="mkt-tab-tokens" type="button" role="tab" aria-selected="false" aria-controls="mkt-panel"/.test(H)
      && /id="mkt-panel" role="tabpanel" aria-labelledby="mkt-tab-chains"/.test(H) && /<ol class="mkt-list" id="mkt-list"/.test(H) && /<section class="mkt-view" id="mkt-view" tabindex="-1"/.test(H));
    const chainsCtl = H.slice(H.indexOf('id="mkt-ctl-chains"'), H.indexOf('id="mkt-ctl-tokens"')), tokensCtl = H.slice(H.indexOf('id="mkt-ctl-tokens"'), H.indexOf('id="mkt-cap"'));
    check('  ...the chains rank by TVL, volume, liquidity, market cap or fees, highest or lowest first, over 24h / 7d / 30d or two days of the reader\'s own',
      ['tvl', 'volume', 'liquidity', 'mcap', 'fees'].every((s) => chainsCtl.includes('data-sort="' + s + '"')) && ['desc', 'asc'].every((d) => chainsCtl.includes('data-dir="' + d + '"'))
      && ['24h', '7d', '30d', 'custom'].every((w) => chainsCtl.includes('data-win="' + w + '"')) && /<input type="date" id="mkt-cc-from"/.test(chainsCtl) && /<input type="date" id="mkt-cc-to"/.test(chainsCtl));
    check('  ...the tokens by volume, liquidity, market cap, FDV or change, over 5m / 1h / 6h / 24h or the reader\'s own days, with the wash-volume switch',
      ['volume', 'liquidity', 'mcap', 'fdv', 'change'].every((s) => tokensCtl.includes('data-sort="' + s + '"')) && ['5m', '1h', '6h', '24h', 'custom'].every((w) => tokensCtl.includes('data-win="' + w + '"'))
      && /<input type="date" id="mkt-tc-from"/.test(tokensCtl) && /id="mkt-wash" type="button" aria-pressed="false"/.test(tokensCtl));
    const bareBtn = [...(H + JS).matchAll(/<button\b([^>]*)>/g)].filter((m) => !/data-tip="[^"]{8,}"/.test(m[1]));
    check('every button on the page and every button market.js draws carries a description (data-tip) of what it does', !bareBtn.length, bareBtn.map((m) => m[0].slice(0, 60)).join(' | '));

    /* ═══ what market.js may do ═══ */
    const code = JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const fetches = [...code.matchAll(/fetch\(\s*([^,)]+)/g)].map((m) => m[1].trim());
    const asks = [...code.matchAll(/getJSON\(\s*([^)]+?)\)/g)].map((m) => m[1].trim());
    check('market.js is one IIFE in strict mode, wired with addEventListener only (no on… properties, no inline handlers)',
      /^\(function \(\) \{\n  'use strict';/m.test(code) && /\}\)\(\);\s*$/.test(JS) && !/\.on[a-z]+\s*=(?!=)/.test(code) && !/\son[a-z]+="/.test(code) && (code.match(/addEventListener\(/g) || []).length >= 15);
    check('  ...it reads only this site\'s own /api/market/* routes: one fetch, behind getJSON, and every caller names a /api/market/ path (the CSP\'s connect-src stays as it is)',
      fetches.length === 1 && fetches[0] === 'url' && asks.length >= 6 && asks.every((a) => a === 'url' || /^'\/api\/market\/|^(chainsURL|tokensURL|chainViewURL|tokenViewURL)\(|^v\.token \? tokenViewURL/.test(a))
      && /return '\/api\/market\/chains' \+/.test(code) && /return '\/api\/market\/tokens\?' \+/.test(code) && /return '\/api\/market\/chain\?' \+/.test(code) && /return '\/api\/market\/token\?' \+/.test(code)
      && !/https?:\/\/(?!www\.growthepie\.com|l2beat\.com\/scaling|www\.w3\.org\/2000\/svg)/.test(code.replace(/'https:\/\/'/g, '')) && !/\/api\/scan\?/.test(code), asks.join(' | '));
    check('  ...the first view asks exactly /api/market/chains, /api/market/chain?key=robinhood and (Top tokens) /api/market/tokens?chain=robinhood — the three reads robots.txt opens',
      /if \(k\.sort !== 'tvl'\) p\.set\('sort'/.test(code) && /if \(k\.win !== '24h'\) \{ p\.set\('window'/.test(code) && /p\.set\('key', key\);/.test(code) && /p\.set\('chain', chain\);\s*if \(k\.sort !== 'volume'\)/.test(code)
      && /const DEFAULT_CHAIN = 'robinhood';/.test(code));
    check('  ...no storage: the address bar is the state (?chain=&token=&window=&from=&to=), pushed when the view changes, read back on Back / Forward',
      !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code) && /p\.set\('chain', v\.chain\);\s*if \(v\.token\) p\.set\('token', v\.token\);/.test(code) && /history\[push \? 'pushState' : 'replaceState'\]/.test(code)
      && /window\.addEventListener\('popstate', \(\) => \{ readURL\(\);/.test(code) && /q\.get\('from'\)/.test(code) && /q\.get\('to'\)/.test(code));
    check('  ...a token on Robinhood Chain, Ethereum or Solana gets the Scanner\'s own dashboard (NPCard.dashboardHTML + mountDashboard) from /api/market/scan, only once the reader scrolls to it',
      /const SCANS = \['robinhood', 'ethereum', 'solana'\];/.test(code) && /'\/api\/market\/scan\?chain=' \+ encodeURIComponent\(chain\) \+ '&address=' \+ encodeURIComponent\(addr\)/.test(code)
      && /NPCard\.dashboardHTML\(p, \{ kicker: '🛡️ Scanner', meta, level: 3 \}\)/.test(code) && /NPCard\.mountDashboard\(host\)/.test(code) && /new IntersectionObserver\(/.test(code));
    check('  ...a logo is drawn only from this site (the server\'s proxy); anything else, or a logo that fails, is the monogram',
      /\/\^\\\/api\\\/\[\\w\/\.-\]\+\(\\\?\[\^"'<>\\s\]\*\)\?\$\/\.test\(logo\)/.test(code) && /img\.addEventListener\('error', \(\) => img\.remove\(\)\)/.test(code) && /class="mkt-mono"/.test(code));
    check('  ...page links in it are absolute (/newpairs?scan=…, /market?…)', !/href="(?!['/#]|https:)/.test(code) && /'\/newpairs\?scan=' \+/.test(code) && /return '\/market\?' \+ p\.toString\(\);/.test(code));
    // the honesty rules
    check('a figure the server could not read is drawn as "Not available" with its reason — never as 0 — and a missing figure sorts last both ways',
      /const NA = '<span class="mkt-na">Not available<\/span>';/.test(code) && /const whyOf = \(f\) => \(f && f\.why \? esc\(f\.why\) : 'The source gave no figure for this'\);/.test(code)
      && /if \(v == null \|\| !isFinite\(v\)\) return null;/.test(code) && /A chain with no figure for this stays at the end, in both orders\./.test(code));
    check('  ...every figure names its source and when it was read; growthepie\'s licence is credited with a link wherever its data appears',
      /function srcLine\(f\)/.test(code) && /'<a class="mkt-src-l" href="https:\/\/www\.growthepie\.com" target="_blank" rel="noopener">Source: growthepie \(CC BY 4\.0\)<\/a>'/.test(code) && /f\.src === 'growthepie' \? GTP/.test(code)
      && /x\.id === 'growthepie' \? 'Source: growthepie \(CC BY 4\.0\)'/.test(code) && /growthepie \(CC BY 4\.0\)/.test(H));
    check('  ...a "lowest first" list says it is lowest among what the source lists, not lowest on the chain; DeFi TVL and TVS are separate figures; the v4 PoolManager and the bridge say what they are and are not',
      /so “lowest” is lowest among those, not lowest on the chain\./.test(code) && /stat\('DeFi TVL', st\.tvl, usd\) \+ stat\('Total value secured', st\.tvs, usd/.test(code)
      && /includes claims and fees — assets held, not pool TVL/.test(code) && /held by the bridge contract on Ethereum — not a net inflow/.test(code) && /pools, not tokens/.test(code));
    check('  ...nothing tells anyone to buy, promises safety, or claims an affiliation', !/\b(you should buy|buy now|great investment|guaranteed|risk-free|safe investment|to the moon)\b/i.test(H + JS) && /never a tip to buy/.test(H) && /not a recommendation/.test(JS));
    check('the charts are drawn by market.js in SVG (no library): at the box\'s own pixel size, an axis, a hover and arrow-key readout, a table of every value',
      /createElementNS\(NS, tag\)/.test(code) && /const W = Math\.max\(200, Math\.floor\(box\.clientWidth \|\| 300\)\);/.test(code) && /viewBox: '0 0 ' \+ W \+ ' ' \+ H/.test(code) && /class: 'mkt-ax'/.test(code)
      && /box\.addEventListener\('pointermove'/.test(code) && /e\.key === 'ArrowLeft'/.test(code) && /Every value as a table/.test(code) && !/<script[^>]+src="(https?:|\/\/)|d3(\.min)?\.js|plotly|echarts|chart\.umd|chartjs/i.test(H));
    // the stylesheet
    check('market.css: the dashboard width (--dash-max), every size on the text floor, no ellipsis, no fixed-minimum grid column, reduced motion honoured, tables folding by a container query',
      /\.mkt-wrap \{ max-width: var\(--dash-max\);/.test(CSS) && /header\.np-hero\.mkt-hero \{\s*max-width: var\(--dash-max\);/.test(CSS)
      && [...CSS.matchAll(/font-size\s*:\s*([^;}]+)/g)].every((m) => m[1].trim().startsWith('max(var(--text-floor)')) && !/text-overflow:\s*ellipsis|line-clamp/.test(CSS)
      && !/minmax\((1[6-9]\d|[2-9]\d\d)px, *1fr\)/.test(CSS) && /@media \(prefers-reduced-motion: reduce\)/.test(CSS) && /container: mktv \/ inline-size;/.test(CSS) && /@container mktv \(max-width: 46em\)/.test(CSS)
      && !/position: relative; isolation: isolate;/.test(CSS));
    check('  ...every control at least 44px tall, a visible focus ring on the rows and the charts, and the current row marked by a bar as well as colour',
      /\.mkt-chips \.np-chip, \.mkt-wash \{ min-height: 44px;/.test(CSS) && /\.mkt-row \{[^}]*min-height: 52px;/.test(CSS) && /\.mkt-row:focus-visible \{ outline: 3px solid var\(--focus\);/.test(CSS)
      && /\.mkt-plot:focus-visible \{ outline: 3px solid var\(--focus\);/.test(CSS) && /\.mkt-row\[aria-current="true"\] \{[^}]*box-shadow: inset 5px 0 0 var\(--green\);/.test(CSS));

    /* ═══ the site's lists that name pages ═══ */
    const SM = read('sitemap-pages.xml'), LL = read('llms.txt'), RB = read('robots.txt');
    check('/market is in the static sitemap, in llms.txt\'s pages, and Sendy knows it (its tips, and its links in an answer)',
      SM.includes('<url><loc>https://sendrh.com/market</loc></url>') && /\n- \[Market Data\]\(https:\/\/sendrh\.com\/market\): /.test(LL)
      && /'\/market': \{ tips: \[/.test(SENDY) && /\|data\|market\|newpairs\|/.test(SENDY));
    check('  ...robots.txt opens exactly the three fixed first-view reads and keeps every caller-chosen market read (search, a token, a scan, the logo proxy, another chain) shut',
      /^Allow: \/api\/market\/chains\$$/m.test(RB) && /^Allow: \/api\/market\/chain\?key=robinhood\$$/m.test(RB) && /^Allow: \/api\/market\/tokens\?chain=robinhood\$$/m.test(RB) && /^Disallow: \/api\/$/m.test(RB) && !/^Allow: \/api\/market\/?$/m.test(RB));

    /* ═══ 2. the fixtures against the contract ═══ */
    const SRCS = ['defillama', 'l2beat', 'growthepie', 'coingecko', 'geckoterminal', 'dexscreener', 'rpc', 'site'];
    const badFig = [];
    const isFig = (x, where) => {
      const ok = x && typeof x === 'object' && 'v' in x && (x.v === null || (typeof x.v === 'number' && isFinite(x.v))) && SRCS.includes(x.src) && typeof x.at === 'number' && x.at > 1.7e12
        && (x.v !== null || (typeof x.why === 'string' && x.why.length > 3)) && (x.v === null || x.v !== 0 || x.why == null);
      if (!ok) badFig.push(where + '=' + JSON.stringify(x).slice(0, 80));
      return ok;
    };
    const isWin = (w, kinds) => w && kinds.includes(w.kind) && typeof w.label === 'string' && w.label && (w.kind !== 'custom' || (DAY.test(w.from) && DAY.test(w.to)));
    const files = readdirSync(FIXDIR);
    check('the fixtures are there: the chains at every window, Robinhood Chain and Base in full, the tokens at every window, two token details and the Scanner\'s read of $SEND',
      ['24h', '7d', '30d', 'custom'].every((w) => files.includes('chains-' + w + '.json')) && ['5m', '1h', '6h', '24h', 'custom'].every((w) => files.includes('tokens-robinhood-' + w + '.json'))
      && files.includes('chain-robinhood.json') && files.includes('chain-base.json') && files.filter((f) => /^token-robinhood-0x[0-9a-f]{40}\.json$/.test(f)).length === 2 && files.includes('scan-robinhood-0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105.json'), files.length + ' files');
    let chainsOk = true;
    for (const w of ['24h', '7d', '30d', 'custom']) {
      const j = FIX('chains-' + w + '.json');
      if (!(typeof j.at === 'number' && isWin(j.window, ['24h', '7d', '30d', 'custom']) && j.window.kind === w && j.sort === 'tvl' && j.dir === 'desc' && typeof j.total === 'number' && Array.isArray(j.rows) && Array.isArray(j.notes))) chainsOk = false;
      for (const r of j.rows) {
        if (!(typeof r.key === 'string' && typeof r.name === 'string' && 'chainId' in r && 'gtNetwork' in r && 'logo' in r && 'stage' in r && typeof r.isL2 === 'boolean')) chainsOk = false;
        for (const k of ['tvl', 'volume', 'liquidity', 'mcap', 'fees', 'stables', 'tvs']) isFig(r[k], 'chains-' + w + ':' + r.key + '.' + k);
      }
    }
    const rh24 = FIX('chains-24h.json').rows.find((r) => r.key === 'robinhood');
    check('  ...GET /api/market/chains: { at, window, sort, dir, total, rows: [{ key, name, chainId, gtNetwork, logo, tvl, volume, liquidity, mcap, fees, stables, tvs, stage, isL2 }], notes }', chainsOk);
    check('  ...Robinhood Chain\'s market cap is null with "No native token — gas is paid in ETH" (no number is built for it); a native token\'s cap is labelled with its token',
      rh24 && rh24.mcap.v === null && rh24.mcap.why === 'No native token — gas is paid in ETH' && FIX('chains-24h.json').rows.find((r) => r.key === 'ethereum').mcap.label === 'ETH (gas token)' && rh24.chainId === 4663 && rh24.stage === 'Stage 0' && rh24.isL2 === true);
    const rh = FIX('chain-robinhood.json');
    const stKeys = ['tvl', 'volume24h', 'volume7d', 'volume30d', 'windowVolume', 'fees24h', 'appFees24h', 'stables', 'oi', 'mcap', 'tvs', 'txcount24h', 'daa', 'medianTxCostUsd'];
    stKeys.forEach((k) => isFig(rh.stats[k], 'chain-robinhood.stats.' + k));
    check('  ...GET /api/market/chain: stats (every figure an object), stage and risks, daily history per metric (with its source, today\'s provisional flow point dropped), top tokens with their basis, the newest 20 pools, the pulse, the sources',
      rh.key === 'robinhood' && rh.chainId === 4663 && typeof rh.at === 'number' && stKeys.every((k) => rh.stats[k] && 'v' in rh.stats[k]) && rh.stats.stage === 'Stage 0' && rh.stats.risks.length === 5 && rh.stats.risks.every((r) => r.name && r.value && r.sentiment)
      && ['tvl', 'volume', 'fees', 'stables', 'txcount'].every((k) => SRCS.includes(rh.history[k].src) && rh.history[k].rows.length > 100 && rh.history[k].rows.every((p) => DAY.test(p[0]) && typeof p[1] === 'number'))
      && rh.history.volume.rows.every(([d]) => d < '2026-10-26') && rh.history.fees.rows.every(([d]) => d < '2026-10-26')
      && Array.isArray(rh.topTokens.rows) && typeof rh.topTokens.basis === 'string' && rh.newPools.length === 20 && rh.newPools.every((p) => ['v2', 'v3', 'v4'].includes(p.version) && /^0x[0-9a-f]+$/.test(p.pool) && p.block > 9e7)
      && rh.pulse && rh.pulse.now.block === 98587507 && rh.pulse.poolsCreated.src === 'rpc' && rh.pulse.poolsCreated.h24.v4 === 4443 && rh.sources.some((s) => s.id === 'growthepie' && s.licence === 'CC BY 4.0'));
    let tokOk = true;
    for (const w of ['5m', '1h', '6h', '24h', 'custom']) {
      const j = FIX('tokens-robinhood-' + w + '.json');
      if (!(j.chain === 'robinhood' && j.network === 'robinhood' && typeof j.basis === 'string' && isWin(j.window, ['5m', '1h', '6h', '24h', 'custom']) && j.window.kind === w && Array.isArray(j.rows) && j.rows.length >= 20 && (w !== 'custom' || (j.coverage && DAY.test(j.coverage.from))))) tokOk = false;
      for (const r of j.rows) {
        if (!(r.chain === 'robinhood' && /^0x[0-9a-f]{40}$/.test(r.address) && 'symbol' in r && 'name' in r && 'logo' in r && typeof r.txns24h === 'number' && Array.isArray(r.flags) && r.flags.every((f) => ['thin', 'wash', 'global-mcap'].includes(f)) && typeof r.scannable === 'boolean' && typeof r.liquidity.pools === 'number')) tokOk = false;
        if (r.logo != null && !/^\/api\/market\/logo\?u=https%3A%2F%2F(coin-images\.coingecko\.com|assets\.geckoterminal\.com)%2F/.test(r.logo)) tokOk = false;
        for (const k of ['priceUsd', 'mcap', 'fdv', 'liquidity', 'volume', 'change']) isFig(r[k], 'tokens-' + w + ':' + r.symbol + '.' + k);
      }
    }
    const t24 = FIX('tokens-robinhood-24h.json').rows;
    check('  ...GET /api/market/tokens: { at, chain, network, basis, window, coverage? (custom), rows: [{ chain, address, symbol, name, logo, priceUsd, mcap, fdv, liquidity: { v, pools }, volume, change, txns24h, flags, scannable }] }', tokOk);
    check('  ...the measured traps are in them: FLOP/WETH flagged thin + wash, USDG\'s global market cap flagged, a GeckoTerminal market cap of null or 0 kept null with its reason, liquidity summed from the pools (PONS $69.8M, not its token-level $20k)',
      t24.find((r) => r.symbol === 'FLOP').flags.join() === 'thin,wash' && t24.find((r) => r.symbol === 'USDG').flags.includes('global-mcap')
      && t24.some((r) => r.mcap.v === null && /GeckoTerminal gives 0/.test(r.mcap.why || '')) && t24.some((r) => r.mcap.v === null && /no market cap/.test(r.mcap.why || ''))
      && t24.some((r) => r.symbol === 'PONS' && r.liquidity.v > 69e6));
    const send = FIX('token-robinhood-0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105.json');
    ['priceUsd', 'mcap', 'fdv', 'liquidity'].forEach((k) => isFig(send[k], 'token-send.' + k));
    check('  ...GET /api/market/token: { chain, address, symbol, name, logo, links, priceUsd, mcap, fdv, supplyBasis, liquidity, pools, windows (5m 1h 6h 24h), candles { tf, rows [t,o,h,l,c,v], src }, scanner { supported, href }, at }',
      send.address === '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105' && send.symbol === 'SEND' && Array.isArray(send.links.websites) && Array.isArray(send.links.socials) && /dead address/.test(send.supplyBasis)
      && send.mcap.v === null && send.pools.length === 1 && ['5m', '1h', '6h', '24h'].every((k) => send.windows[k] && 'volume' in send.windows[k]) && send.candles.rows.length > 30 && send.candles.rows.every((r) => r.length === 6)
      && send.scanner.supported === true && send.scanner.href === '/newpairs?scan=0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105&chain=robinhood');
    const scan = FIX('scan-robinhood-0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105.json');
    check('  ...GET /api/market/scan answers as /api/scan does: { pair (the Scanner\'s profile: token, pair, market, volume, txns, priceChange, holders, risk, brand, links), chain, kind, scan }',
      scan.chain === 'robinhood' && scan.kind === 'token' && ['token', 'pair', 'market', 'volume', 'txns', 'priceChange', 'holders', 'risk', 'brand', 'links'].every((k) => scan.pair[k]) && typeof scan.pair.risk.health === 'number' && scan.scan.readAt > 1.7e12);
    check('  ...and every figure in them is an { v, src, at } object, null only with a reason', !badFig.length, badFig.slice(0, 6).join(' | '));

    /* ═══ 3. the number words, run ═══ */
    const lift = JS.slice(JS.indexOf('/* @lift:words'), JS.indexOf('/* @lift:end */'));
    const ctx = vm.createContext({ Math, Number, String, Date, isFinite, esc: (s) => String(s) });
    vm.runInContext(lift + '\nthis.F = { usd, count, pct, tiny, gwei, amount, agoText, utc };', ctx);
    const F = ctx.F;
    check('the money words: $1.13B, $552M, $32.4k, $12.34, $0.0001703, $0.0₅631 (five zeros, subscripted), and nothing at all for a missing figure — never "$0"',
      F.usd(1125597534) === '$1.13B' && F.usd(552453391) === '$552M' && F.usd(32373) === '$32.4k' && F.usd(12.34) === '$12.34' && F.usd(0.0001703) === '$0.0001703' && F.usd(0.00000631) === '$0.0₅631'
      && F.usd(null) === null && F.usd(undefined) === null && F.usd(NaN) === null && F.usd(0) === '$0' && F.usd(48511e6) === '$48.5B' && F.usd(2.4e12) === '$2.4T',
      [F.usd(1125597534), F.usd(552453391), F.usd(32373), F.usd(0.0001703), F.usd(0.00000631)].join(' '));
    check('  ...a change carries its direction in an arrow and a sign, not only in a colour; counts and gas read as people say them',
      F.pct(-2.55) === '▼ −2.55%' && F.pct(8.23) === '▲ +8.23%' && F.pct(0) === '0.00%' && F.pct(null) === null && F.count(4613599) === '4.61M' && F.count(207510) === '208k' && F.count(1343) === '1,343' && F.gwei(0.02014) === '0.02014 gwei' && F.amount(262043.43, 'ETH') === '262k ETH',
      [F.pct(-2.55), F.count(207510), F.amount(262043.43, 'ETH')].join(' '));
    check('  ...and a read time says how long ago, never a guess when there is none', F.agoText(Date.now() - 5 * 60e3) === '5\u00a0min ago' && F.agoText(Date.now() - 3 * 3600e3) === '3\u00a0h ago' && F.agoText(null) === 'time not recorded' && F.utc(Date.parse('2026-10-26T17:30:00Z')) === '2026-10-26 17:30 UTC');

    /* ═══ 4. the fake, against the same contract ═══ */
    const fake = await startFake(0);
    const FB = 'http://127.0.0.1:' + fake.address().port;
    const get = async (p) => { const r = await fetch(FB + p); let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch {} return { status: r.status, j, t, h: (k) => r.headers.get(k) || '' }; };
    try {
      const page = await get('/market');
      check('the fake serves the page with the site\'s CSP (no inline script can run; connect-src unchanged)', page.status === 200 && /<title>Market Data — Just Send It<\/title>/.test(page.t) && /script-src 'self' https:\/\/static\.cloudflareinsights\.com;/.test(page.h('content-security-policy')) && /img-src 'self' data: blob:;/.test(page.h('content-security-policy')));
      const c0 = await get('/api/market/chains'), cAsc = await get('/api/market/chains?sort=mcap&dir=asc'), cDesc = await get('/api/market/chains?sort=mcap&dir=desc');
      const lastKeys = (r) => r.j.rows.slice(-3).map((x) => x.key);
      check('  ...the chains, highest TVL first by default; by market cap, the chains with none last in both orders', c0.status === 200 && c0.j.rows[0].key === 'ethereum' && c0.j.rows.findIndex((r) => r.key === 'robinhood') === 8
        && cAsc.j.rows[0].mcap.v < cAsc.j.rows[1].mcap.v && [cAsc, cDesc].every((x) => { const firstNull = x.j.rows.findIndex((r) => r.mcap.v === null); return firstNull > 0 && x.j.rows.slice(firstNull).every((r) => r.mcap.v === null) && x.j.rows.slice(firstNull).some((r) => r.key === 'robinhood'); }), lastKeys(cAsc).join(','));
      const cc = await get('/api/market/chains?window=custom&from=2026-10-01&to=2026-10-25'), cbad = await get('/api/market/chains?window=custom&from=2026-10-25&to=2026-10-01');
      check('  ...a custom window echoes its whole UTC days and says what it cannot add up; a window backwards is refused', cc.status === 200 && cc.j.window.kind === 'custom' && cc.j.window.from === '2026-10-01' && cc.j.rows.every((r) => r.volume.v === null && r.volume.why) && cbad.status === 400);
      const tv = await get('/api/market/tokens?chain=robinhood'), tall = await get('/api/market/tokens?chain=robinhood&include=all'), tl = await get('/api/market/tokens?chain=robinhood&sort=liquidity&dir=asc');
      check('  ...the tokens: wash volume left out of "highest volume" unless include=all; lowest liquidity first when asked', tv.status === 200 && !tv.j.rows.some((r) => r.flags.includes('wash')) && tall.j.rows.some((r) => r.flags.includes('wash')) && tl.j.rows[0].liquidity.v <= tl.j.rows[1].liquidity.v);
      const tm = await get('/api/market/tokens?chain=robinhood&sort=mcap');
      check('  ...a global (all-chains) market cap is kept out of a chain-local market-cap ranking', tm.j.rows.filter((r) => r.flags.includes('global-mcap')).every((r) => r.mcap.v === null));
      const d1 = await get('/api/market/chain?key=robinhood'), d7 = await get('/api/market/chain?key=robinhood&window=7d'), dx = await get('/api/market/chain?key=nowhere'), dg = await get('/api/market/chain?key=solana');
      check('  ...a chain in full; its 7-day volume added up from whole days; an unknown chain is a 404 that says so; a chain without a full fixture says "not collected", never 0',
        d1.status === 200 && d1.j.pulse && d7.j.window.kind === '7d' && d7.j.stats.windowVolume.v > d1.j.stats.volume24h.v && dx.status === 404 && /nowhere/.test(dx.j.error) && dg.status === 200 && dg.j.history.tvl.rows.length === 0 && /not collected/.test(dg.j.history.tvl.why));
      const tk = await get('/api/market/token?chain=robinhood&address=0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105'), tn = await get('/api/market/token?chain=robinhood&address=0x' + '1'.repeat(40)), sc = await get('/api/market/scan?chain=robinhood&address=0x' + '1'.repeat(40));
      check('  ...a token in full; a token with no pool data is a 404; a scan that cannot be read says so (503, unavailable)', tk.status === 200 && tk.j.symbol === 'SEND' && tn.status === 404 && sc.status === 503 && sc.j.unavailable === true);
      const s1 = await get('/api/market/search?q=send'), s2 = await get('/api/market/search?q=base');
      check('  ...search: { q, chains: [{ key, name }], tokens: [{ chain, address, symbol, name, priceUsd, liquidity, volume24h, src }] }', s1.status === 200 && Array.isArray(s1.j.chains) && Array.isArray(s1.j.tokens) && s2.j.chains.some((c) => c.key === 'base' && c.name === 'Base')
        && s1.j.tokens.every((t) => t.chain && t.address && 'priceUsd' in t && 'liquidity' in t && 'volume24h' in t && t.src));
    } finally { fake.close(); }

    /* ═══ 5. the real server, when it already has the routes ═══ */
    if (PORT) {
      const BASE = 'http://localhost:' + PORT;
      let r = null; try { r = await fetch(BASE + '/api/market/chains'); } catch {}
      if (!r || r.status === 404) {
        console.log('  · the suite\'s server does not answer /api/market/chains yet (built against fixtures) — the live-shape checks are skipped');
        check('the suite\'s server: the market routes are not there yet, so the page runs on the fixtures\' contract (reported, not failed)', true);
      } else {
        /* the suite's server reads no vendor (tests/run.mjs points every MARKET_* URL at a dead address), so a route may have
           nothing collected: a 200 must carry the contract's keys; an honest 5xx must say why in words — never a bare error */
        const shape = async (p, keys) => {
          const x = await fetch(BASE + p); const b = await x.json().catch(() => null);
          return { ok: (x.status === 200 && !!b && keys.every((k) => k in b)) || (x.status >= 500 && !!b && typeof (b.error || b.message) === 'string'), s: x.status, b };
        };
        const c1 = await shape('/api/market/chains', ['at', 'window', 'sort', 'dir', 'total', 'rows', 'notes']);
        check('the suite\'s server answers /api/market/chains with the contract\'s keys (or says in words why it cannot)', c1.ok, c1.s + ' ' + JSON.stringify(c1.b).slice(0, 160));
        const c2 = await shape('/api/market/chain?key=robinhood', ['key', 'name', 'chainId', 'at', 'stats', 'history', 'sources']);
        check('  ...and /api/market/chain?key=robinhood with key, name, chainId, at, stats, history, sources — a figure it cannot read is null with a reason', c2.ok
          && (c2.s !== 200 || Object.values(c2.b.stats || {}).filter((x) => x && typeof x === 'object' && 'v' in x).every((x) => x.v !== null || x.why)), c2.s + ' ' + JSON.stringify(c2.b).slice(0, 160));
        const c3 = await shape('/api/market/tokens?chain=robinhood', ['chain', 'basis', 'window', 'rows']);
        check('  ...and /api/market/tokens?chain=robinhood with chain, basis, window and rows', c3.ok, c3.s + ' ' + JSON.stringify(c3.b).slice(0, 160));
      }
    }
  } catch (e) {
    console.error('ERROR', e && e.stack);
    check('the suite ran to the end', false, e && e.message);
  }
  let pass = 0;
  for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra && !ok ? '  [' + extra + ']' : '')); if (ok) pass++; }
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) process.exitCode = 1;
}
