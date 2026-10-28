/* ===== The Market Data page (/market) — owner, 2026-10-26 ============================================================
   "Setup a page named Market Data that has a full dashboard of all of the chain's data … Robinhood being the default view
   … a main view … the search bar … the chain or token in list view on the side … top chains and top tokens … highest or
   lowest … time frame (their own time or default times), Market Cap, Liquidity, TVL and Volume."

   1. The page, from its source: the head and the house shell (the nav and footer link on every page), the scripts it
      needs for the Scanner's dashboard, what market.js may read (only /api/market/*, same origin), the words it may use,
      and the honesty rules (a missing figure is "Not available" with its reason, never 0; growthepie credited).
   2. The fixtures in tests/fixtures/market/ against the shared contract (the routes' shapes, every figure an
      { v, src, at, why? } object, null with a reason) — they were built from the vendors' own answers measured on
      2026-10-26 and are what the page was built and walked against in a muted headless Chrome. tokens-all-*.json and
      tokens-ethereum-*.json are lib/marketdata.js's own answers (tests/marketdata.mjs with MARKET_DUMP_DIR set), cut to 32 and
      12 rows: Robinhood Chain's pools as read, and the same answer re-keyed as Ethereum's (marketdata's fixtures do this to
      have a second network), so USDG sits at one address on two chains; the other seven networks are not read.
   3. market.js's number words, lifted between its @lift markers and run in a vm.
   4. A fake of the /api/market/* routes, served from those fixtures, with the site's CSP: run here against its own
      contract (sorting with nulls last both ways, wash volume left out of "highest volume", the windows, 404s), and
      started on its own by `node tests/marketpage.mjs --serve <port>` for a browser walk.
   5. When the suite's real server already answers /api/market/chains, its answers carry the contract's keys; a server
      that predates the routes is reported, not failed.
   6. The fixtures and the fake's own answers have the shapes lib/marketdata.js really serves: its answers are built here
      from a database of this suite's own, and every key and kind is compared (the fixtures once had { src, rows } series,
      buys / sells and no pulse times, so the page passed here and lost its sources on the real server).
   7. The page in a real browser — headless Chrome, muted — on the fake, at 320, 390, 1280 and 1920 px: no sideways scroll,
      nothing under the text floor, and the honesty rules where they are easy to break (a failed read is a failure with its
      reason and a Try again, never "none listed"; a reserve of 0 and a missing price are never $0; each pulse reading keeps
      its own time; a custom window ends on a whole day; Back and Forward restore the view in the address bar) — and Top tokens'
      every-chain list with its chain drop-down (a button naming the chain chosen; the list of every chain with its logo and its
      name, open and closed at every width, never under the corner widgets; a broken logo left as initials; the filter in the
      address; Escape, a press outside and the keyboard alone; a late answer never painting over a newer one).
   No live vendor is ever called. */
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { ROOT } from './_paths.mjs';
const require = createRequire(import.meta.url);
const MD = require(path.join(ROOT, 'lib', 'marketdata.js'));

const PUB = path.join(ROOT, 'public');
const FIXDIR = path.join(ROOT, 'tests', 'fixtures', 'market');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const FIX = (f) => JSON.parse(readFileSync(path.join(FIXDIR, f), 'utf8'));
const results = [], notes = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168', WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => dayOf(Date.parse(d + 'T00:00:00Z') + n * 864e5);

/* ═══════════════════ the fake API (also the browser walk's server: --serve <port>) ═══════════════════ */
const CSP = "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self' https://rpc.mainnet.chain.robinhood.com https://cloudflareinsights.com; frame-src https://dexscreener.com https://www.geckoterminal.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const SORT_FIELD = { chains: { tvl: 'tvl', volume: 'volume', liquidity: 'liquidity', mcap: 'mcap', fees: 'fees' }, tokens: { volume: 'volume', liquidity: 'liquidity', mcap: 'mcap', fdv: 'fdv', change: 'change' } };
const v = (x) => (x == null ? null : typeof x === 'number' ? x : x.v == null ? null : Number(x.v));
function sortRows(rows, field, dir) {   // a row whose figure is null sorts last in both directions (the contract)
  return rows.slice().sort((a, b) => { const x = v(a[field]), y = v(b[field]); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return dir === 'asc' ? x - y : y - x; });
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/* the time frame is checked by lib/marketdata.js's own parseWindow (a database of nothing, the real clock), so the fake refuses
   exactly what the server refuses, in its words */
const WINDOWS = (() => { const db = new DatabaseSync(':memory:'); MD.migrate(db); return MD.createMarketData({ db, fetchJson: async () => ({ ok: false, status: 0, data: null, reason: 'no vendor in this test' }) }); })();
const CHAIN_WINS = ['24h', '7d', '30d'], TOKEN_WINS = ['24h', '6h', '1h', '5m'];
/* what the browser walk can make the fake do, as the real server does when a source cannot be read */
const FAKE = { log: [], unavailable: new Set(), zeroReserve: false, candleGaps: false, customNoCandles: false, searchWhy: null, searchExtra: null, pulse: null, tokensDelay: null };
// the logo proxy: DefiLlama's chain icons draw (any PNG will do for the walk) except Solana's, which fails as a missing picture does
const LOGO_PNG = readFileSync(path.join(PUB, 'assets', 'logo-128.png')), LOGO_BROKEN = /rsz_solana/;
const none = (why, src, at) => ({ v: null, src, at, why });
function fakeAnswer(u) {
  const q = u.searchParams, p = u.pathname, qo = Object.fromEntries(q);
  const win = q.get('window') || '24h', from = q.get('from'), to = q.get('to');
  if (p === '/api/market/chains') {
    const pw = WINDOWS.parseWindow(qo, CHAIN_WINS); if (pw.error) return [400, { error: pw.error }];
    const sort = q.get('sort') || 'tvl', dir = q.get('dir') === 'asc' ? 'asc' : 'desc';
    if (!SORT_FIELD.chains[sort]) return [400, { error: 'unknown sort' }];
    const j = FIX('chains-' + win + '.json');
    if (win === 'custom') j.window = pw.w;
    const limit = Math.max(1, Math.min(200, Number(q.get('limit')) || 50));
    return [200, Object.assign({}, j, { sort, dir, rows: sortRows(j.rows, SORT_FIELD.chains[sort], dir).slice(0, limit) })];
  }
  if (p === '/api/market/chain') {
    const pw = WINDOWS.parseWindow(qo, CHAIN_WINS); if (pw.error) return [400, { error: pw.error }];
    const key = q.get('key') || '';
    const list = FIX('chains-24h.json'), row = list.rows.find((r) => r.key === key);
    if (!row) return [404, { error: 'no chain with that key' }];
    let j;
    if (existsSync(path.join(FIXDIR, 'chain-' + key + '.json'))) j = FIX('chain-' + key + '.json');
    else {
      // a chain in the list with no daily history read: what the server sends for it (empty series, no source named)
      const today = dayOf(Date.now()), nh = { from: addDays(today, -365), to: addDays(today, -1), src: {} };
      for (const k of ['tvl', 'volume', 'fees', 'appFees', 'stables', 'txcount', 'daa']) { nh[k] = []; nh.src[k] = null; }
      const noDay = 'no daily figure for this chain (growthepie covers 27 chains; L2BEAT\'s activity covers its L2s)';
      j = { key, name: row.name, chainId: row.chainId, at: list.at, window: list.window,
        stats: { tvl: row.tvl, volume24h: row.volume, volume7d: none('no daily history for this chain (histories are read for the top 40 chains by TVL)', 'site', list.at), volume30d: row.volume, windowVolume: row.volume,
          fees24h: row.fees, appFees24h: none('not read', 'defillama', list.at), stables: row.stables, oi: none('not read', 'defillama', list.at),
          mcap: row.mcap, liquidity: row.liquidity, tvs: row.tvs, tvsBreakdown: null, txcount24h: none(noDay, 'site', list.at), daa: none(noDay, 'site', list.at),
          medianTxCostUsd: none(noDay, 'site', list.at), stage: row.stage, risks: [], l2beat: null },
        history: nh, topTokens: { rows: [], basis: null, why: 'this chain\'s pools have not been read yet' }, newPools: [], sources: [{ id: 'defillama', name: 'DefiLlama', url: 'https://defillama.com' }] };
    }
    if (j.pulse && FAKE.pulse) j.pulse = FAKE.pulse(j.pulse);
    if (win !== '24h') {
      const h = Array.isArray(j.history && j.history.volume) ? j.history.volume : [];
      let sum = null;
      if (h.length) {
        const last = h[h.length - 1][0], n = win === '7d' ? 7 : win === '30d' ? 30 : 0;
        const lo = win === 'custom' ? from : addDays(last, -(n - 1)), hi = win === 'custom' ? to : last;
        const inWin = h.filter(([d]) => d >= lo && d <= hi);
        const covered = inWin.length && (win !== 'custom' || (h[0][0] <= lo && last >= hi));
        sum = covered ? inWin.reduce((a, [, x]) => a + x, 0) : null;
      }
      j = Object.assign({}, j, { window: pw.w,
        stats: Object.assign({}, j.stats, { windowVolume: sum != null ? { v: sum, src: 'defillama', at: j.at, label: 'DEX volume, ' + pw.w.label } : none('our history ends before these days', 'site', j.at) }) });
    }
    return [200, j];
  }
  if (p === '/api/market/tokens') {
    const pw = WINDOWS.parseWindow(qo, TOKEN_WINS); if (pw.error) return [400, { error: pw.error }];
    const chain = q.get('chain') || '';
    const sort = q.get('sort') || 'volume', dir = q.get('dir') === 'asc' ? 'asc' : 'desc';
    if (!SORT_FIELD.tokens[sort]) return [400, { error: 'unknown sort' }];
    const row = FIX('chains-24h.json').rows.find((r) => r.key === chain);
    if (chain !== 'all' && (!row || !row.gtNetwork)) return [200, { at: null, chain, network: null, basis: null, window: pw.w, rows: [], why: 'this site reads the pools of ' + MD.GT_TRACKED.map((k) => MD.CHAIN_BY_KEY.get(k).llama).join(', ') + ' only' }];
    // every chain's list (chain=all) and Ethereum's are lib/marketdata.js's own answers (tests/marketdata.mjs's MARKET_DUMP_DIR),
    // cut to fewer rows; a chain with no fixture is one whose pools have not been read yet
    if (!existsSync(path.join(FIXDIR, 'tokens-' + chain + '-' + win + '.json'))) return [200, { at: null, chain, network: row.gtNetwork, basis: null, window: pw.w, rows: [], why: 'this chain\'s pools have not been read yet' }];
    const j = FIX('tokens-' + chain + '-' + win + '.json');
    if (win === 'custom') j.window = pw.w;
    let rows = sortRows(j.rows, SORT_FIELD.tokens[sort], dir);
    if (sort === 'volume' && dir === 'desc' && q.get('include') !== 'all') rows = rows.filter((r) => !(r.flags || []).includes('wash'));
    if (sort === 'mcap') rows = sortRows(rows.map((r) => ((r.flags || []).includes('global-mcap') ? Object.assign({}, r, { mcap: Object.assign({}, r.mcap, { v: null, why: 'a global, all-chains figure — kept out of a chain-local ranking' }) }) : r)), 'mcap', dir);
    return [200, Object.assign({}, j, { sort, dir, total: rows.length, rows: rows.slice(0, Math.max(1, Math.min(200, Number(q.get('limit')) || 50))) })];
  }
  if (p === '/api/market/token') {
    const chain = q.get('chain') || '', addr = String(q.get('address') || '').toLowerCase();
    if (!MD.GT_TRACKED.includes(chain)) return [400, { error: 'chain is one of ' + MD.GT_TRACKED.join(', ') }];
    if (chain === 'solana' ? !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.get('address') || '') : !/^0x[0-9a-f]{40}$/.test(addr)) return [400, { error: 'enter a token address' }];
    const pw = WINDOWS.parseWindow(qo, TOKEN_WINS); if (pw.error) return [400, { error: pw.error }];
    const scanner = { supported: MD.SCAN_CHAINS.includes(chain), href: MD.SCAN_CHAINS.includes(chain) ? '/newpairs?scan=' + addr + '&chain=' + chain : null };
    // GeckoTerminal could not be asked (its budget spent, a timeout): the server's 200 that says so
    if (FAKE.unavailable.has(addr)) return [200, { chain, address: addr, unavailable: true, why: 'GeckoTerminal is being asked a lot right now — try again in a minute', scanner, at: Date.now() }];
    const f = 'token-' + chain + '-' + addr + '.json';
    let j = existsSync(path.join(FIXDIR, f)) ? FIX(f) : null;
    if (!j && existsSync(path.join(FIXDIR, 'tokens-' + chain + '-24h.json'))) {
      const r = FIX('tokens-' + chain + '-24h.json').rows.find((x) => x.address === addr);
      if (r) {
        const win = (k) => { const w = FIX('tokens-' + chain + '-' + k + '.json').rows.find((x) => x.address === addr);
          return { volume: w ? w.volume : none('not in our snapshot', 'geckoterminal', r.priceUsd.at), change: w ? w.change : none('not in our snapshot', 'geckoterminal', r.priceUsd.at),
            txns: k === '24h' ? r.txns24h : none('GeckoTerminal\'s trade counts are kept for 24 h only here', 'geckoterminal', r.priceUsd.at) }; };
        j = { chain, address: addr, network: MD.CHAIN_BY_KEY.get(chain).gt, symbol: r.symbol, name: r.name, logo: r.logo, links: { websites: [], socials: [], src: 'dexscreener' }, priceUsd: r.priceUsd, mcap: r.mcap, fdv: r.fdv,
          supplyBasis: 'GeckoTerminal\'s FDV is the total supply times the price, burned tokens included.', liquidity: r.liquidity, pools: [],
          windows: { '24h': win('24h'), '6h': win('6h'), '1h': win('1h'), '5m': win('5m') }, at: r.priceUsd.at, basis: 'its pools among the most-traded pools we keep (GeckoTerminal)', flags: r.flags, scanner,
          candles: { tf: 'hour', pool: null, rows: [], src: 'geckoterminal', partialLast: true, note: 'The newest candle is the hour still in progress. An hour with no candle had no trades.' } };
      }
    }
    if (!j) return [404, { error: 'GeckoTerminal does not know this token on ' + chain }];
    if (FAKE.zeroReserve && j.pools.length) j.pools[0].reserveUsd = 0;   // GeckoTerminal's "0" for a reserve it did not read
    // a field GeckoTerminal left out arrives as null (num()), a missing time as 0 (num(null) * 1000)
    if (FAKE.candleGaps && Array.isArray(j.candles.rows)) j.candles.rows = j.candles.rows.map((r, i) => (i === 5 ? [r[0], r[1], r[2], null, r[4], r[5]] : i === 9 ? [r[0], r[1], r[2], r[3], null, r[5]] : i === 12 ? [0, r[1], r[2], r[3], r[4], r[5]] : i === 14 ? [r[0], null, r[2], r[3], r[4], null] : r));
    if (win === 'custom') {
      // as the server does: summed from the deepest pool's candles; covered when they reach back past the window's start
      const rows = FAKE.customNoCandles ? [] : (j.candles.rows || []), t0 = Date.parse(pw.w.from + 'T00:00:00Z'), t1 = Date.parse(pw.w.to + 'T00:00:00Z') + 864e5;
      const first = rows.length ? rows[0][0] : null, inWin = rows.filter((x) => x[0] >= t0 && x[0] < t1);
      const coverage = { from: first != null ? new Date(first).toISOString() : null, pool: j.candles.pool || null, tf: j.candles.tf || 'hour' };
      j.custom = first != null && first <= t0
        ? { volume: { v: inWin.reduce((a, x) => a + (x[5] || 0), 0), src: 'geckoterminal', at: Date.now(), label: 'DEX volume in its deepest pool over ' + pw.w.label, pool: coverage.pool },
          priceChange: inWin.length ? { v: ((inWin[inWin.length - 1][4] - inWin[0][1]) / inWin[0][1]) * 100, src: 'geckoterminal', at: Date.now(), label: 'from the first candle\'s open to the last candle\'s close' } : none('no trades in the window', 'geckoterminal', Date.now()),
          coverage, src: 'geckoterminal' }
        : { volume: none(first == null ? 'GeckoTerminal has no candles for this pool' : 'GeckoTerminal\'s candles for this pool start ' + coverage.from, 'geckoterminal', Date.now()), priceChange: none('outside the candles GeckoTerminal gives', 'geckoterminal', Date.now()), coverage, src: 'geckoterminal' };
    }
    return [200, j];
  }
  if (p === '/api/market/scan') {
    const chain = q.get('chain') || '', addr = String(q.get('address') || '').toLowerCase(), f = 'scan-' + chain + '-' + addr + '.json';
    if (existsSync(path.join(FIXDIR, f))) return [200, FIX(f)];
    return [503, { unavailable: true, message: 'The chain could not be read for this token just now — nothing here is a judgement about it.' }];
  }
  if (p === '/api/market/search') {
    const raw = String(q.get('q') || '').trim(), text = raw.toLowerCase();
    if (raw.length < 2) return [400, { error: 'type at least two characters' }];
    const t24 = FIX('tokens-robinhood-24h.json');
    const chains = FIX('chains-24h.json').rows.filter((r) => r.key.includes(text) || r.name.toLowerCase().includes(text)).map((r) => ({ key: r.key, name: r.name }));
    const tokens = t24.rows.filter((r) => [r.symbol, r.name, r.address].some((x) => String(x || '').toLowerCase().includes(text)))
      .map((r) => ({ chain: r.chain, address: r.address, symbol: r.symbol, name: r.name, priceUsd: v(r.priceUsd), liquidity: v(r.liquidity), volume24h: v(r.volume), src: 'geckoterminal', at: t24.at }));
    if (FAKE.searchExtra) tokens.push(...FAKE.searchExtra);
    return [200, { q: raw, chains, tokens, sources: ['site', 'geckoterminal', 'dexscreener'], ...(FAKE.searchWhy ? { why: FAKE.searchWhy } : {}), note: 'Our own records first, then Dexscreener\'s search (cross-chain, at most 30 answers).' }];
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
        FAKE.log.push(u.pathname + u.search);
        if (fail && fail.split(',').includes(what)) return json(503, { error: 'the fake was told to fail ' + what });
        if (what === 'logo') {
          const src = String(u.searchParams.get('u') || '');
          if (/^https:\/\/icons\.llamao\.fi\//.test(src) && !LOGO_BROKEN.test(src)) { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); return res.end(LOGO_PNG); }
          return json(404, { error: 'no such picture in the fake' });
        }
        // a slow answer, to walk a newer answer arriving first (FAKE.tokensDelay(url) → ms)
        if (what === 'tokens' && FAKE.tokensDelay) { const ms = FAKE.tokensDelay(u.search); if (ms) await new Promise((r) => setTimeout(r, ms)); }
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
    const h = { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' };
    if (fp.endsWith('.html')) h['Set-Cookie'] = 'jsi_age=18; Path=/; SameSite=Lax';   // the 18+ answer, so the age question does not cover the page
    res.writeHead(200, h);
    res.end(readFileSync(fp));
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok(srv)));
}

/* ═══════════════════ the real answers' shapes: lib/marketdata.js on a database of this suite's own ═══════════════════
   One reading of each kind, seeded straight into the tables (the collectors are not run: their reads are tests/marketdata.mjs's
   business), and every vendor answered by a fake that never leaves this process. What comes back is what the server sends. */
async function realAnswers() {
  const NOW = Date.now(), T = NOW - 10 * 60e3, today = dayOf(NOW), y = addDays(today, -1);
  const db = new DatabaseSync(':memory:'); MD.migrate(db);
  const ins = (table, row) => { const k = Object.keys(row); db.prepare('INSERT INTO ' + table + ' (' + k.join(', ') + ') VALUES (' + k.map(() => '?').join(', ') + ')').run(...k.map((c) => row[c])); };
  for (const [chain, name, id, stage, l2] of [['robinhood', 'Robinhood Chain', 4663, 'Stage 0', 1], ['ethereum', 'Ethereum', 1, null, 0], ['base', 'Base', 8453, 'Stage 1', 1], ['solana', 'Solana', null, null, 0]]) {
    ins('mkt_chain_snap', { chain, name, chain_id: id, at: T, tvl: 1e9, dex_vol_24h: 5e8, dex_vol_30d: 2e10, fees_24h: 3e4, fees_7d: 2e5, fees_30d: 9e5, app_fees_24h: 1e6, stables: 1e9, oi: 3e8, dex_liq: 4e8,
      mcap: chain === 'robinhood' ? null : 2e11, native_token: chain === 'robinhood' ? null : chain, native_symbol: null, gas_token: chain === 'robinhood' ? 'ethereum' : chain, tvs: l2 ? 2e9 : null, stage, is_l2: l2, logo: null, src: '{}' });
  }
  for (let i = 1; i <= 10; i++) for (const [metric, src] of [['tvl', 'defillama'], ['dex_volume', 'defillama'], ['fees', 'growthepie'], ['app_fees', 'defillama'], ['stables', 'defillama'], ['txcount', 'growthepie'], ['daa', 'growthepie'], ['txcost_median', 'growthepie']]) {
    ins('mkt_chain_series', { chain: 'robinhood', metric, day: addDays(today, -i), value: 1000 + i, src, at: T });
  }
  db.prepare('INSERT INTO mkt_state (name, value, at) VALUES (?, ?, ?)').run('l2beat', JSON.stringify({ projects: { robinhood: { name: 'Robinhood Chain', type: 'layer2', hostChain: 'Ethereum', stage: 'Stage 0',
    risks: [{ name: 'Sequencer Failure', value: 'No mechanism', sentiment: 'bad', description: 'a sample' }], tvs: { total: 2e9, native: 5e8, canonical: 6e8, external: 9e8, ether: 6e8, stablecoin: 1e9, btc: 0, other: 3e8, rwaPublic: null, rwaRestricted: null }, change7d: -0.03 } } }), T);
  const B1 = 98587507, B0 = B1 - 829000;
  db.prepare('INSERT INTO mkt_state (name, value, at) VALUES (?, ?, ?)').run('rh_newpools', JSON.stringify({ cursor: B1, start: B0 - 10, startAt: NOW - 2 * 864e5, gaps: [] }), T);
  const pulse = (at, block) => ins('mkt_rh_pulse', { at, block, block_ts: Math.floor(at / 1000), block_time_ms: 104.2, gas_price_wei: 20140000, base_fee_wei: 20032000, l1_price_wei: 0, min_gas_wei: 20000000,
    weth_supply: 40163.4, usdg_supply: 673333959.78, pm_eth: 25382.5, pm_weth: 1586.9, pm_usdg: 32698758, bridge_eth: 262043.4, bridge_batches: 354362, bridge_msgs: 404373, l1_block: 26278379 });
  pulse(NOW - 864e5 - 30 * 60e3, B0); pulse(NOW - 60e3, B1);
  ins('mkt_new_pool', { chain: 'robinhood', pool: '0x' + 'ab'.repeat(20), dex: 'v2', token0: WETH, token1: SEND, block: B1 - 5, created_at: null, first_seen: T, extra: '{}' });
  const pool = (rank, addr, base, sym, name, reserve, network = 'robinhood') => ins('mkt_pool_snap', { network, pool: addr, at: T, rank, base_addr: base, base_symbol: sym, base_name: name, base_logo: null, base_gecko_id: null, quote_addr: WETH, quote_symbol: 'WETH',
    dex: 'uniswap-v3-robinhood', name: sym + ' / WETH', price_usd: 1, reserve_usd: reserve, fdv_usd: 6e8, mcap_usd: 3e9, vol_m5: 5e5, vol_h1: 8e6, vol_h6: 7e7, vol_h24: 2e8, tx_h24: 249270, buys_h24: 121341, sells_h24: 127929,
    chg_m5: 0.01, chg_h1: -0.02, chg_h6: -0.03, chg_h24: -0.03, created_at: NOW - 100 * 864e5 });
  pool(1, '0x' + '52'.repeat(20), USDG, 'USDG', 'Global Dollar', 13093964); pool(2, '0x' + '69'.repeat(20), USDG, 'USDG', 'Global Dollar', 0);
  pool(3, '0x' + 'f3'.repeat(20), SEND, 'SEND', 'Just Send It', 25390);
  pool(1, '0x' + 'ba'.repeat(20), '0x' + '83'.repeat(20), 'BTK', 'A Base token', 5e6, 'base');   // Base's pools are read too, so its top tokens carry no "not read"
  // a pools run marks its batch finished only after its last page; the answers serve the newest finished batch, never one still being written
  for (const [net, n] of [['robinhood', 3], ['base', 1]]) db.prepare('INSERT INTO mkt_state (name, value, at) VALUES (?, ?, ?)').run('pools:' + net, JSON.stringify({ at: T, pages: 1, pools: n, wanted: 1, why: null, ended: T }), T);
  let dsDown = false;
  const candles = [0, 1, 2].map((i) => [Math.floor((NOW - (72 - i) * 3600e3) / 1000), 1, 1.01, 0.99, 1, 1e6]);
  const pair = { chainId: 'robinhood', pairAddress: '0x' + 'f3'.repeat(20), baseToken: { address: SEND, symbol: 'SEND', name: 'Just Send It' }, priceUsd: '0.00017', liquidity: { usd: 25390 }, volume: { h24: 525 },
    info: { imageUrl: null, websites: [{ label: 'Website', url: 'https://sendrh.com/' }], socials: [{ type: 'twitter', url: 'https://x.com/SendRH_' }] } };
  const fetchJson = async (url) => {
    if (/\/ohlcv\//.test(url)) return { ok: true, status: 200, data: { data: { attributes: { ohlcv_list: candles } } }, reason: null };
    if (/dexscreener/.test(url) && dsDown) return { ok: false, status: 0, data: null, reason: 'timed out' };
    if (/\/tokens\/v1\//.test(url)) return { ok: true, status: 200, data: [pair], reason: null };
    if (/\/latest\/dex\/search/.test(url)) return { ok: true, status: 200, data: { pairs: [pair] }, reason: null };
    return { ok: false, status: 0, data: null, reason: 'unreachable' };   // GeckoTerminal's token read, among others: not reachable here
  };
  const md = MD.createMarketData({ db, now: () => NOW, fetchJson, outboundTake: () => Promise.resolve(), askWaitMs: 50 });
  const J = (x) => JSON.parse(JSON.stringify(x && x.body !== undefined ? x.body : x));
  const cw = { window: 'custom', from: addDays(y, -2), to: y };
  const out = {
    chains: { '24h': J(md.chains({})), '7d': J(md.chains({ window: '7d' })), '30d': J(md.chains({ window: '30d' })), custom: J(md.chains(cw)) },
    chain: { robinhood: J(md.chain({ key: 'robinhood' })), base: J(md.chain({ key: 'base' })), solana: J(md.chain({ key: 'solana' })) },
    tokens: {}, token: J(await md.token({ chain: 'robinhood', address: USDG })), tokenCustom: J(await md.token(Object.assign({ chain: 'robinhood', address: USDG }, cw))),
    unavailable: J(await md.token({ chain: 'robinhood', address: '0x' + '12'.repeat(20) })), search: J(await md.search({ q: 'send' })),
  };
  for (const w of ['24h', '6h', '1h', '5m']) out.tokens[w] = J(md.tokens({ chain: 'robinhood', window: w }));
  out.tokens.custom = J(md.tokens(Object.assign({ chain: 'robinhood' }, cw)));
  out.tokensAll = {};
  for (const w of ['24h', '6h', '1h', '5m']) out.tokensAll[w] = J(md.tokens({ chain: 'all', window: w }));
  out.tokensAll.custom = J(md.tokens(Object.assign({ chain: 'all' }, cw)));
  dsDown = true; out.searchDown = J(await md.search({ q: 'zzzz' }));
  return out;
}
/* the shape of one answer against another: every key in one is in the other, with the same kind (object, array, number, string,
   boolean); a figure ({ v, src, … }) is one leaf, and null stands for anything (not read) */
function shapeDiff(a, b, at = '', out = []) {
  const isF = (x) => !!x && typeof x === 'object' && !Array.isArray(x) && 'v' in x && 'src' in x;
  const kind = (x) => (Array.isArray(x) ? 'array' : isF(x) ? 'figure' : typeof x);
  if (a == null || b == null || out.length > 12) return out;
  if (kind(a) !== kind(b)) { out.push(at + ': ' + kind(a) + ' here, ' + kind(b) + ' from the server'); return out; }
  if (kind(a) === 'array') { if (a.length && b.length) shapeDiff(a[0], b[0], at + '[0]', out); return out; }
  if (kind(a) !== 'object') return out;
  for (const k of Object.keys(b)) if (!(k in a)) out.push(at + '.' + k + ' is missing here');
  for (const k of Object.keys(a)) if (!(k in b)) out.push(at + '.' + k + ' is not in the server\'s answer');
  for (const k of Object.keys(a)) if (k in b) shapeDiff(a[k], b[k], at + '.' + k, out);
  return out;
}

/* ═══════════════════ the browser walk: headless Chrome, muted, on the fake ═══════════════════ */
function findChrome() {
  const c = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return c.find((p) => p && existsSync(p)) || null;
}
// what a reader can see: the page never wider than the screen, nothing in the page's column outside it, no text under the floor
const LAYOUT = `(() => {
  const wrap = document.querySelector('.mkt-wrap'), wr = wrap.getBoundingClientRect();
  const probe = document.createElement('span'); probe.style.fontSize = 'var(--text-floor)'; document.body.appendChild(probe);
  const floor = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
  const out = [], small = [];
  for (const el of wrap.querySelectorAll('*')) {
    if (el.closest('[hidden]') || el.closest('.sr-only') || el.closest('details:not([open]) > :not(summary)')) continue;
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
    if (r.right > wr.right + 1 || r.left < wr.left - 1) out.push((el.id || String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className) || el.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText && parseFloat(getComputedStyle(el).fontSize) < floor - 0.5) small.push((String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className) || el.tagName) + ' ' + getComputedStyle(el).fontSize);
  }
  return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, floor, out: out.slice(0, 6), small: small.slice(0, 6) };
})()`;
async function browserWalk() {
  const CHROME = findChrome();
  if (!CHROME) {
    if (process.env.CI) notes.push('skipping the browser walk: no Chrome or Chromium on this runner (set CHROME_PATH to run it)');
    else check('a Chrome or Chromium to walk the page in (set CHROME_PATH)', false, 'none found');
    return;
  }
  const site = await startFake(0), ORIGIN = 'http://127.0.0.1:' + site.address().port;
  let chrome = null, profile = null, ws = null, n = 0, session = null;
  const pend = new Map(), exceptions = [];
  const cdp = (method, params = {}, sid = session) => new Promise((ok, bad) => { const id = ++n; pend.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(60); } return null; };
  const S = (sel) => JSON.stringify(sel);
  const textOf = (sel) => ev('(document.querySelector(' + S(sel) + ') || {}).textContent || ""');
  const viewReady = () => until('!document.getElementById("mkt-view").hasAttribute("aria-busy") && !!document.getElementById("mkt-vh") && !document.querySelector("#mkt-view > .mkt-loading")');   // the view's own "Reading…" (the Scanner's waits for a scroll)
  async function go(p, width, height = 900) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    await cdp('Page.navigate', { url: ORIGIN + p });
    await until('document.readyState === "complete" && !!document.getElementById("mkt-view")');
    return viewReady();
  }
  const ours = () => exceptions.filter((x) => /market\.js/.test(JSON.stringify(x)));
  try {
    profile = mkdtempSync(path.join(os.tmpdir(), 'jsi-mktpage-'));
    const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--lang=en-US', 'about:blank'];
    if (process.platform === 'linux') args.unshift('--no-sandbox');   // Ubuntu 24.04's AppArmor refuses Chrome's sandbox to an unprivileged runner
    chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; chrome.stderr.on('data', (d) => { err += d; });
    const portFile = path.join(profile, 'DevToolsActivePort');   // a port of the OS's choosing: two runs at once never read each other's page
    for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
    if (!existsSync(portFile)) throw new Error('Chrome did not open its debugging port: ' + err.slice(0, 300));
    const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
    ws = new WebSocket('ws://127.0.0.1:' + port + wsPath);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('could not connect to Chrome')); });
    ws.onmessage = (m) => {
      const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
      if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.bad(new Error(JSON.stringify(d.error))) : p.ok(d.result); }
      else if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails);
    };
    const t = await cdp('Target.createTarget', { url: 'about:blank' }, null);
    session = (await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
    await cdp('Page.enable'); await cdp('Runtime.enable');
    const today = dayOf(Date.now()), yday = addDays(today, -1);

    // each part of the walk on its own: one that breaks is a failure of its own, the rest still run, and the fake is put back as it was
    const step = async (name, fn) => {
      try { await fn(); } catch (e) { check(name + ' (the walk broke here)', false, e && e.message); }
      finally { Object.assign(FAKE, { pulse: null, zeroReserve: false, candleGaps: false, customNoCandles: false, searchWhy: null, searchExtra: null, tokensDelay: null }); FAKE.unavailable.clear(); }
    };
    await step('every width: the chain view and a token view fit, on the text floor', async () => {
      const fits = [];
      for (const w of [320, 390, 1280, 1920]) {
        const a = await go('/market', w) && await until('document.querySelectorAll(".mkt-chart[data-series] svg").length >= 3 && document.querySelectorAll("#mkt-list .mkt-row").length > 5');
        const chainL = await ev(LAYOUT);
        const b = await go('/market?chain=robinhood&token=' + SEND, w) && await until('!!document.querySelector("[data-candles] svg")');
        const tokL = await ev(LAYOUT);
        fits.push({ w, ok: !!(a && b), a: !!a, b: !!b, chainL, tokL });
      }
      const bad = fits.filter((f) => !f.ok || [f.chainL, f.tokL].some((l) => l.sw > l.iw || l.out.length || l.small.length));
      check('in a real browser at 320, 390, 1280 and 1920 px the chain view and a token view draw in full: no sideways scroll, nothing outside the page\'s column, no text under the floor',
        fits.length === 4 && !bad.length, bad.map((f) => f.w + 'px ' + (f.ok ? '' : 'did not draw (chain ' + f.a + ', token ' + f.b + ') ') + JSON.stringify({ c: f.chainL, t: f.tokL }).slice(0, 400)).join(' | '));
    });

    await step('the chain view (1280)', async () => {
      await go('/market', 1280);
      await until('document.querySelectorAll(".mkt-chart[data-series] svg").length >= 3');
      const caps = await ev('[...document.querySelectorAll(".mkt-chart[data-series] figcaption .mkt-s")].map((e) => ({ k: e.closest("[data-series]").dataset.series, t: e.textContent, gtp: !!e.querySelector("a[href=\\"https://www.growthepie.com\\"]") }))');
      const cap = (k) => caps.find((c) => c.k === k) || { t: '' };
      check('every chart names its own source from the server\'s history.src and the whole day it reaches — growthepie\'s transactions with its CC BY credit and link',
        caps.length >= 4 && caps.every((c) => /latest \d{4}-\d\d-\d\d/.test(c.t) && /^(DefiLlama|Source: growthepie)/.test(c.t)) && /^DefiLlama/.test(cap('tvl').t) && cap('txcount').gtp && /^Source: growthepie \(CC BY 4\.0\)/.test(cap('txcount').t),
        JSON.stringify(caps).slice(0, 400));
      const before = ours().length;
      await ev('document.querySelector(".mkt-new details.mkt-tbl > summary").click(), true'); await sleep(150);
      await ev('document.querySelector(".mkt-chart[data-series=\\"tvl\\"] details.mkt-tbl > summary").click(), true'); await sleep(150);
      const opened = await ev('({ pools: document.querySelector(".mkt-new details.mkt-tbl").open, rows: document.querySelectorAll(".mkt-chart[data-series=\\"tvl\\"] .mkt-tblw tbody tr").length })');
      check('opening "The other 10 newest pools" throws nothing (only a chart\'s own table is filled on opening); a chart\'s "Every value as a table" fills with every day',
        opened.pools === true && opened.rows > 100 && ours().length === before, JSON.stringify(opened) + ' ' + ours().slice(before).map((x) => (x.exception && x.exception.description || '').split('\n')[0]).join(' | '));
    });

    await step('the pulse: each reading its own time', async () => {
      FAKE.pulse = (p) => { p.now.at = Date.now() - 20e3; p.now.suppliesAt = Date.now() - 2 * 60e3; p.now.bridgeAt = Date.now() - 3 * 864e5; return p; };
      await go('/market', 1280);
      const tiles = await ev('[...document.querySelectorAll(".mkt-pulse .mkt-stat")].map((s) => ({ dt: s.querySelector("dt").textContent, sub: (s.querySelector(".mkt-s") || {}).textContent || "" }))');
      const tile = (re) => tiles.find((x) => re.test(x.dt)) || { sub: '' };
      const pulseHead = await textOf('.mkt-pulse .mkt-card-h .mkt-s');
      check('the pulse: the head block\'s time is the header\'s; the supplies, the PoolManager and the bridge each say when they were read, and a reading days old says it is older than usual',
        /latest block read just now/.test(pulseHead) && !/older/.test(pulseHead) && /read 3\u00a0days ago — ⏳ older than this reading usually is/.test(tile(/canonical bridge/).sub)
        && /read 2\u00a0min ago/.test(tile(/WETH supply/).sub) && !/older/.test(tile(/WETH supply/).sub) && /read 2\u00a0min ago/.test(tile(/PoolManager/).sub), pulseHead + ' | ' + JSON.stringify(tiles).slice(0, 500));
      FAKE.pulse = (p) => ({ now: null, why: 'the chain has not been read yet', poolsCreated: { h24: null, src: 'rpc', why: 'the new-pools reader has not run yet' }, history: { note: p.history.note, gas: [], blockTimeMs: [], bridgeEth: [] }, sources: p.sources });
      await go('/market', 1280);
      const unread = await ev('({ t: (document.querySelector(".mkt-pulse") || {}).textContent || "", tiles: document.querySelectorAll(".mkt-pulse .mkt-stat").length })');
      FAKE.pulse = (p) => { p.poolsCreated = { h24: null, src: 'rpc', why: 'counted from our own reads, which do not reach 24 hours back yet (they start at block 98000000)' }; return p; };
      await go('/market', 1280);
      const notCounted = await ev('[...document.querySelectorAll(".mkt-pulse .mkt-stat")].map((s) => s.textContent).find((x) => /Pools created/.test(x)) || ""');
      FAKE.pulse = null;
      check('  ...a chain not read yet says so (no tiles of bare "Not available"); pools not counted say why',
        unread.tiles === 0 && /⏳ The chain has not been read yet\./.test(unread.t) && /Counted from our own reads, which do not reach 24 hours back yet/.test(notCounted), JSON.stringify(unread).slice(0, 200) + ' | ' + notCounted.slice(0, 200));
    });

    await step('Back and Forward restore the view in the address bar', async () => {
      await go('/market', 1280);
      await until('!!document.querySelector("#mkt-list .mkt-row[data-chain=\\"base\\"]")');
      await ev('document.querySelector("#mkt-list .mkt-row[data-chain=\\"base\\"]").click(), true');
      await until('location.search === "?chain=base"'); await viewReady();
      await ev('document.querySelector("#mkt-ctl-chains [data-win=\\"7d\\"]").click(), true');
      await until('location.search === "?chain=base&window=7d"'); await viewReady();
      await ev('history.back(), true');
      await until('location.search === "" && /Robinhood/.test((document.getElementById("mkt-vh") || {}).textContent || "")'); await viewReady();
      const back = await ev('({ url: location.pathname + location.search, sub: document.querySelector(".mkt-vsub").textContent, on: [...document.querySelectorAll("#mkt-ctl-chains [data-win]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.win) })');
      await ev('history.forward(), true');
      await until('location.search === "?chain=base&window=7d" && /Base/.test((document.getElementById("mkt-vh") || {}).textContent || "")'); await viewReady();
      const fwd = await ev('({ sub: document.querySelector(".mkt-vsub").textContent, on: [...document.querySelectorAll("#mkt-ctl-chains [data-win]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.win) })');
      check('Back from Base over 7 days to /market shows Robinhood Chain over the default 24 hours the address names; Forward brings Base over 7 days back',
        back.url === '/market' && back.on.join() === '24h' && !/last 7 days/.test(back.sub) && fwd.on.join() === '7d' && /last 7 days/.test(fwd.sub), JSON.stringify({ back, fwd }).slice(0, 400));
    });

    await step('a token: trades, pools, candles', async () => {
      await go('/market?chain=robinhood&token=' + SEND, 390);
      const tw = await ev('(() => { const s = document.querySelector("[aria-labelledby=\\"mkt-tw-h\\"]"); const row = (w) => [...s.querySelectorAll("tbody tr")].find((r) => r.querySelector("th").textContent.startsWith(w)); const cell = (w) => (row(w).querySelector("td[data-l=\\"Trades\\"]") || {}).textContent || ""; return { head: [...s.querySelectorAll("thead th")].map((t) => t.textContent), d: cell("24 hours"), m: cell("5 minutes"), note: (s.querySelector(".mkt-note") || {}).textContent || "" }; })()');
      check('the windows table shows the 24 h trade count the server sends (windows[k].txns), and for the other windows says why there is none',
        tw.head.includes('Trades') && !tw.head.some((h) => /Buys/.test(h)) && tw.d === '11' && tw.m === 'Not available' && /GeckoTerminal's trade counts are kept for 24 h only here/.test(tw.note), JSON.stringify(tw));
      FAKE.zeroReserve = true;
      await go('/market?chain=robinhood&token=' + SEND, 1280);
      const pools = await ev('(() => { const s = document.querySelector("[aria-labelledby=\\"mkt-po-h\\"]"); return { holds: (s.querySelector("td[data-l=\\"Holds\\"]") || {}).textContent || "", t: s.textContent }; })()');
      FAKE.zeroReserve = false;
      check('a pool whose reserve GeckoTerminal sends as 0 (not read) holds "Not available" with that reason — never "$0" — and the pools name their source and read time',
        pools.holds === 'Not available' && /reserve of 0 for a pool it did not read/.test(pools.t) && !/\$0(?![.\d])/.test(pools.t) && /GeckoTerminal · /.test(pools.t), JSON.stringify(pools).slice(0, 300));
      FAKE.candleGaps = true;
      await go('/market?chain=robinhood&token=' + USDG, 1280);
      await until('!!document.querySelector("[data-candles] svg")');
      const cnd = await ev('(() => { const box = document.querySelector("[data-candles] .mkt-plot"); const labels = [...box.querySelectorAll("text.mkt-ax")].map((t) => t.textContent); const sum = box.parentNode.querySelector(".mkt-readout").textContent; box.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); const first = box.parentNode.querySelector(".mkt-readout").textContent; return { labels, sum, first }; })()');
      FAKE.candleGaps = false;
      check('a candle missing its time, its low, its close or its open is a gap: the price axis never reaches a made-up $0, the readouts never say $0, and no candle sits at 1970',
        cnd.labels.length > 2 && !cnd.labels.includes('$0') && !/\$0(?![.\d])/.test(cnd.sum + cnd.first) && !/^1970/.test(cnd.first) && /^2026-/.test(cnd.first), JSON.stringify(cnd).slice(0, 400));
    });

    await step('a token over your own days', async () => {
      const from6 = addDays(today, -6);
      await go('/market?chain=robinhood&token=' + USDG + '&window=custom&from=' + from6 + '&to=' + yday, 390);
      const cus = await ev('(() => { const s = document.querySelector("[aria-labelledby=\\"mkt-tw-h\\"]"), r = s.querySelector("tbody tr:last-child"); return { th: r.querySelector("th").textContent, trades: r.querySelector("td[data-l=\\"Trades\\"]").textContent, vol: r.querySelector("td[data-l=\\"Volume\\"]").textContent, t: s.textContent, view: document.getElementById("mkt-view").textContent }; })()');
      FAKE.customNoCandles = true;
      await go('/market?chain=robinhood&token=' + USDG + '&window=custom&from=' + from6 + '&to=' + yday, 390);
      const cus0 = await ev('(() => { const s = document.querySelector("[aria-labelledby=\\"mkt-tw-h\\"]"), r = s.querySelector("tbody tr:last-child"); return { vol: r.querySelector("td[data-l=\\"Volume\\"]").textContent, trades: r.querySelector("td[data-l=\\"Trades\\"]").textContent, t: s.textContent }; })()');
      FAKE.customNoCandles = false;
      check('your own days on a token: the row has its volume, a Trades cell saying why there is none, and a note on where the candles start — never "[object Object]", never coverage under Buys / sells',
        cus.th.startsWith(from6) && /^\$/.test(cus.vol) && cus.trades === 'Not available' && /which carry no trade counts/.test(cus.t) && /candles for its deepest pool \(0x52e6…71ca\), which start 2026-10-12/.test(cus.t)
        && !/object Object|covered from/.test(cus.view + cus0.t) && cus0.vol === 'Not available' && /GeckoTerminal has no candles for this pool/.test(cus0.t) && !/which start/.test(cus0.t), JSON.stringify({ cus: { th: cus.th, vol: cus.vol, trades: cus.trades, t: cus.t.slice(0, 300) }, cus0 }).slice(0, 700));
    });

    await step('a custom time frame ends on a day that has ended', async () => {
      await go('/market?chain=robinhood&token=' + SEND, 1280);
      await until('!document.getElementById("mkt-ctl-tokens").hidden');
      const maxes = await ev('({ t: document.getElementById("mkt-tc-to").max, c: document.getElementById("mkt-cc-to").max })');
      await ev('document.querySelector("#mkt-ctl-tokens [data-win=\\"custom\\"]").click(), true');
      const mark = FAKE.log.length;
      const apply = async (f, t2) => ev('(() => { document.getElementById("mkt-tc-from").value = ' + S(f) + '; document.getElementById("mkt-tc-to").value = ' + S(t2) + '; document.getElementById("mkt-tc-go").click(); const e = document.getElementById("mkt-tc-err"); return e.hidden ? "" : e.textContent; })()');
      const eToday = await apply(addDays(today, -3), today), eLong = await apply('2009-01-03', yday);
      check('a custom time frame can end yesterday at the latest (the date boxes stop there, for tokens as for chains), and Apply says why a day that has not ended or more than ten years is refused — without asking the server',
        maxes.t === yday && maxes.c === yday && /whole UTC day that has ended: \d{4}-\d\d-\d\d or earlier/.test(eToday) && /at most ten years/.test(eLong) && !FAKE.log.slice(mark).some((x) => /window=custom/.test(x)), JSON.stringify({ maxes, eToday, eLong, asked: FAKE.log.slice(mark) }));
      await go('/market?chain=robinhood&token=' + SEND + '&window=custom&from=' + addDays(today, -3) + '&to=' + today, 1280);
      const refused = await ev('({ t: document.getElementById("mkt-view").textContent, retry: !!document.querySelector("#mkt-view [data-retry]"), reset: !!document.querySelector("#mkt-view [data-reset-win=\\"tokens\\"]") })');
      await ev('document.querySelector("#mkt-view [data-reset-win=\\"tokens\\"]").click(), true');
      await until('!!document.getElementById("mkt-tstats")'); await viewReady();
      const reset = await ev('({ url: location.search, on: [...document.querySelectorAll("#mkt-ctl-tokens [data-win]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.win) })');
      check('  ...a link to a time frame that ends today is refused in the server\'s words, as a time frame that can\'t be served — no "try again" — with a way back to the last 24 hours, which works',
        /This time frame can’t be served: to must be a whole UTC day that has ended/.test(refused.t) && !/try again|Try again/.test(refused.t) && !refused.retry && refused.reset && reset.on.join() === '24h' && !/window=/.test(reset.url),
        JSON.stringify({ refused: Object.assign({}, refused, { t: refused.t.slice(0, 300) }), reset }));
    });

    await step('a token GeckoTerminal could not be asked about', async () => {
      FAKE.unavailable.add(SEND);
      await go('/market?chain=robinhood&token=' + SEND, 1280);
      const un = await ev('({ t: document.getElementById("mkt-view").textContent, retry: !!document.querySelector("#mkt-view [data-retry=\\"view\\"]"), scan: (document.querySelector("#mkt-view a[href^=\\"/newpairs?scan=\\"]") || {}).getAttribute ? document.querySelector("#mkt-view a[href^=\\"/newpairs?scan=\\"]").getAttribute("href") : null })');
      FAKE.unavailable.delete(SEND);
      await ev('document.querySelector("#mkt-view [data-open-chain=\\"robinhood\\"]").click(), true');
      await until('!document.querySelector("#mkt-view .mkt-fail") && /Robinhood/.test((document.getElementById("mkt-vh") || {}).textContent || "")'); await viewReady();
      await ev('history.back(), true');
      const back2 = await until('!!document.getElementById("mkt-tstats") && !document.getElementById("mkt-view").hasAttribute("aria-busy")');
      check('a token answer marked unavailable is a failed read: its reason, Try again and the Scanner — never a page of "no pools", "no candles", "no website"; and it is not kept, so Back after the source recovers shows the token',
        /GeckoTerminal is being asked a lot right now — try again in a minute\. Nothing here is a reading of/.test(un.t) && un.retry && un.scan === '/newpairs?scan=' + SEND + '&chain=robinhood'
        && !/No pools are listed|No candles|No website or socials|The source gave no figure/.test(un.t) && !!back2, JSON.stringify(un).slice(0, 400));
    });

    const search = async (q) => { const m0 = FAKE.log.filter((x) => x.startsWith('/api/market/search')).length; await ev('document.getElementById("mkt-q").value = ' + S(q) + '; document.getElementById("mkt-search").requestSubmit(), true');
      await until('!document.getElementById("mkt-results").hidden && !document.querySelector("#mkt-results .mkt-loading")'); return { asked: FAKE.log.filter((x) => x.startsWith('/api/market/search')).length - m0, t: await textOf('#mkt-results'), retry: await ev('!!document.querySelector("#mkt-results [data-retry=\\"search\\"]")') }; };
    await step('search with Dexscreener down', async () => {
      FAKE.searchWhy = 'Dexscreener could not be read (timed out)';
      await go('/market', 1280);
      const s1 = await search('zzzz'), s2 = await search('zzzz');
      FAKE.searchWhy = null;
      await ev('document.querySelector("#mkt-results [data-retry=\\"search\\"]").click(), true');
      await until('/nor on Dexscreener/.test(document.getElementById("mkt-results").textContent)');
      const s3 = await textOf('#mkt-results');
      check('search with Dexscreener unread says so and never "nor on Dexscreener"; the answer is not kept (asking again asks the site), and once Dexscreener answers the honest "not found" comes back',
        /⏳ Dexscreener could not be read \(timed out\): only this site’s own records were searched\./.test(s1.t) && /this is not a “not found” there/.test(s1.t) && !/nor on Dexscreener/.test(s1.t) && s1.retry && s1.asked === 1 && s2.asked === 1 && /nor on Dexscreener/.test(s3),
        JSON.stringify({ s1, s2: s2.asked, s3: s3.slice(0, 200) }).slice(0, 600));
    });

    await step('search hits the main view cannot open', async () => {
      FAKE.searchExtra = [
        { chain: 'robinhood', address: SEND, symbol: 'SEND', name: 'SEND IT', priceUsd: 0.00017, liquidity: 25390, volume24h: 525, src: 'dexscreener', at: Date.now() },
        { chain: 'tron', address: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj', symbol: 'SENDT', name: 'Send on Tron', priceUsd: 0.1, liquidity: 1000, volume24h: 10, src: 'dexscreener', at: Date.now() },
        { chain: 'sui', address: '0x' + 'ab'.repeat(32) + '::coin::SEND', symbol: 'SENDS', name: 'Send on Sui', priceUsd: 0.2, liquidity: 2000, volume24h: 20, src: 'dexscreener', at: Date.now() },
        { chain: 'base', address: 'So11111111111111111111111111111111111111112', symbol: 'SENDB', name: 'Send on Base, by another name', priceUsd: 0.3, liquidity: 3000, volume24h: 30, src: 'dexscreener', at: Date.now() },
      ];
      await go('/market', 320);
      await search('send');
      const hits = await ev('[...document.querySelectorAll("#mkt-results .mkt-row")].map((r) => ({ tag: r.tagName, t: r.textContent }))');
      const url0 = await ev('location.href'), asked0 = FAKE.log.length;
      await ev('[...document.querySelectorAll("#mkt-results .mkt-row")].find((r) => /Tron/.test(r.textContent)).click(), true'); await sleep(200);
      const stayed = (await ev('location.href')) === url0 && !FAKE.log.slice(asked0).some((x) => x.startsWith('/api/market/token'));
      const resL = await ev(LAYOUT);
      FAKE.searchExtra = null;
      const hit = (re) => hits.find((h) => re.test(h.t)) || { tag: '', t: '' };
      check('search hits the main view cannot open (Tron, a Sui coin type, a base58 address on Base) are said in words, not offered as buttons that would fail; one it can open is a button — and the list fits a 320px phone',
        hit(/SEND IT/).tag === 'BUTTON' && ['Tron', 'Sui', 'another name'].every((n) => hit(new RegExp(n)).tag === 'DIV' && /Not opened here/.test(hit(new RegExp(n)).t)) && /reads tokens on Robinhood Chain, Ethereum, Solana/.test(hit(/Tron/).t)
        && /not a token address the main view reads on Base/.test(hit(/another name/).t) && stayed && resL.sw <= resL.iw && !resL.out.length && !resL.small.length, JSON.stringify({ hits, stayed, resL }).slice(0, 700));
    });

    /* Top tokens: every chain's list by default, and a drop-down of every chain — its logo and its name — to narrow it
       (owner, 2026-10-27: "Make the chain picker filter be a drop down picker with the names of each chain and their logo") */
    const tokRows = () => ev('[...document.querySelectorAll("#mkt-list .mkt-row")].map((b) => ({ c: b.dataset.chain, t: b.dataset.token, chb: (b.querySelector(".mkt-chb") || {}).textContent || "", cur: b.getAttribute("aria-current") === "true" }))');
    const tokAsks = (from) => FAKE.log.slice(from).filter((x) => x.startsWith('/api/market/tokens'));
    const listReady = () => until('!document.querySelector("#mkt-cap .mkt-loading") && document.querySelectorAll("#mkt-list .mkt-row, #mkt-list .mkt-empty").length > 0');
    const openTokens = async () => { await ev('document.getElementById("mkt-tab-tokens").click(), true'); return listReady(); };
    const TRIG = 'document.getElementById("mkt-tchain-b")', POP = 'document.getElementById("mkt-tchain-p")';
    const opt = (k) => 'document.querySelector("#mkt-tchain-p [data-tchain=\\"' + k + '\\"]")';
    const pressed = () => ev('[...document.querySelectorAll("#mkt-tchain-p [aria-pressed=\\"true\\"]")].map((b) => b.dataset.tchain).join()');
    const isOpen = () => ev('!' + POP + '.hidden && ' + TRIG + '.getAttribute("aria-expanded") === "true"');
    const focused = () => ev('document.activeElement.id === "mkt-tchain-b" ? "button" : document.activeElement.dataset.tchain || document.activeElement.dataset.sort || document.activeElement.id || document.activeElement.tagName');
    // what the button shows: its words, its logo (drawn or not) or its initials, the all-chains mark, and whether it is open
    const trig = () => ev('(() => { const b = ' + TRIG + ', img = b.querySelector("img"), mono = b.querySelector(".mkt-mono"); return { t: (b.querySelector(".mkt-cpick-t") || {}).textContent || "", exp: b.getAttribute("aria-expanded"),'
      + ' img: img ? img.complete && img.naturalWidth > 0 : null, ini: mono ? mono.textContent : "", iniShown: mono ? getComputedStyle(mono).visibility === "visible" : null, all: !!b.querySelector(".mkt-ava-all") }; })()');
    // the name a screen reader gives a control, as Chrome computes it
    const axOf = async (expr) => { await cdp('Accessibility.enable'); const r = await cdp('Runtime.evaluate', { expression: expr }); const t = await cdp('Accessibility.getPartialAXTree', { objectId: r.result.objectId, fetchRelatives: false }); const nd = (t.nodes || [])[0] || {}; return { role: nd.role && nd.role.value, name: nd.name && nd.name.value }; };
    // a real press, where the control is drawn: it lands on whatever is on top there, as a reader's does
    const press = async (expr) => {
      const r = await ev('(() => { const e = ' + expr + '; e.scrollIntoView({ block: "nearest", behavior: "instant" }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()');
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
    };
    const key = async (k, code, vk, text, mods) => { await cdp('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 }, text ? { text } : {})); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 }); };
    const K = { tab: () => key('Tab', 'Tab', 9), shiftTab: () => key('Tab', 'Tab', 9, null, 8), enter: () => key('Enter', 'Enter', 13, '\r'), space: () => key(' ', 'Space', 32, ' '), esc: () => key('Escape', 'Escape', 27), down: () => key('ArrowDown', 'ArrowDown', 40), up: () => key('ArrowUp', 'ArrowUp', 38), end: () => key('End', 'End', 35) };
    const pickChain = async (k) => { await press(TRIG); await until('!' + POP + '.hidden'); await press(opt(k)); };
    // nothing in the button or a chain's row cut: each part inside its button, a name never wider than its box, initials inside their disc
    const PICKFIT = `(() => {
      const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1, bad = [];
      for (const b of document.querySelectorAll('#mkt-tchains button')) {
        if (b.closest('[hidden]')) continue;
        const br = b.getBoundingClientRect(), who = b.dataset.tchain || 'the button';
        for (const s of b.querySelectorAll('.mkt-ava, .mkt-cpick-t, .mkt-copt-n, .mkt-tick, .mkt-caret')) if (!inside(s.getBoundingClientRect(), br)) bad.push(who + ': ' + s.className + ' outside its button');
        for (const s of b.querySelectorAll('.mkt-cpick-t, .mkt-copt-n')) if (s.scrollWidth > s.clientWidth + 1) bad.push(who + ': its name is cut');
        const m = b.querySelector('.mkt-mono');
        if (m && getComputedStyle(m).visibility === 'visible') { const mr = m.getBoundingClientRect(), dr = m.parentNode.getBoundingClientRect(); if (mr.left < dr.left - 0.5 || mr.right > dr.right + 0.5 || m.scrollWidth > Math.ceil(mr.width) + 1) bad.push(who + ': its initials (' + m.textContent + ') are cut'); }
      }
      return bad;
    })()`;
    // the open list on the screen: inside the side card's width, between the nav and the bottom of the screen, and every chain in
    // it on top where it is drawn — each brought into view in the list (it scrolls inside), then hit-tested at its centre and
    // at both its edges (the player stands over the side column's corner, beside where a centre is). The description bubble
    // (tips.js, shown on focus) is put away first: it is the site's own label for the control in focus, on top on purpose.
    // Its own button is never under it either: whatever is at the button's centre, it is not the list.
    const PICKSEEN = `(() => {
      if (window.sendTips) sendTips.hide();
      const p = document.getElementById('mkt-tchain-p'), pr = p.getBoundingClientRect(), side = document.getElementById('mkt-side').getBoundingClientRect(), covered = [];
      const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 0, keep = p.scrollTop, name = (h) => h ? (h.id || String(h.className).slice(0, 40) || h.tagName) : 'nothing (off the screen)';
      for (const o of p.querySelectorAll('.mkt-copt')) {
        p.scrollTop = Math.max(0, o.offsetTop - (p.clientHeight - o.offsetHeight) / 2);
        const r = o.getBoundingClientRect(), y = r.top + r.height / 2, hit = document.elementFromPoint(r.left + r.width / 2, y);
        if (!hit || !o.contains(hit)) covered.push(o.dataset.tchain + ' under ' + name(hit));
        for (const x of [r.left + 2, r.right - 2]) { const e = document.elementFromPoint(x, y); if (!e || !p.contains(e)) covered.push(o.dataset.tchain + '\\'s edge under ' + name(e)); }
      }
      p.scrollTop = keep;
      const b = document.getElementById('mkt-tchain-b').getBoundingClientRect(), onBtn = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { covered, top: Math.round(pr.top), bottom: Math.round(pr.bottom), ih: innerHeight, inCard: pr.left >= side.left - 1 && pr.right <= side.right + 1, onScreen: pr.top >= nav && pr.bottom <= innerHeight,
        scrolls: p.scrollHeight > p.clientHeight + 1, n: p.querySelectorAll('.mkt-copt').length, up: p.classList.contains('is-up'), fixed: p.classList.contains('is-fixed'), btnClear: !p.contains(onBtn), mh: p.style.maxHeight };
    })()`;
    const settled = () => until('[...document.querySelectorAll("#mkt-tchains img")].every((i) => i.complete) && !document.querySelector("#mkt-tchains [data-tchain=\\"solana\\"] img")');
    // the page where it is before the press (the press scrolls nothing then), so a page that moves when the list opens shows
    const pressStill = async (expr) => { await ev(expr + '.scrollIntoView({ block: "nearest", behavior: "instant" }), true'); await sleep(120); const y0 = await ev('scrollY'); await press(expr); return y0; };
    await step('Top tokens\' chain drop-down at every width, closed and open', async () => {
      const fits = [];
      for (const [w, h] of [[320, 900], [390, 900], [1280, 900], [1920, 900], [390, 600], [740, 360]]) {
        await go('/market', w, h); await openTokens(); await settled();
        const closed = { l: await ev(LAYOUT), cut: await ev(PICKFIT), trig: await trig(), rows: (await tokRows()).length };
        // the press is the page's first, so the player's nudge comes up over the corner a moment later: the list is judged after that
        const y0 = await pressStill(TRIG); await until('!' + POP + '.hidden'); await sleep(700);
        const open = { l: await ev(LAYOUT), cut: await ev(PICKFIT), seen: await ev(PICKSEEN), focus: await focused(), moved: Math.round((await ev('scrollY')) - y0) };
        await ev(TRIG + '.click(), true'); await until(POP + '.hidden');
        fits.push({ w, h, closed, open });
      }
      const flat = (l) => l.sw > l.iw || l.out.length || l.small.length;
      const bad = fits.filter((f) => flat(f.closed.l) || f.closed.cut.length || !f.closed.rows || f.closed.trig.t !== 'All chains' || !f.closed.trig.all || f.closed.trig.exp !== 'false'
        || flat(f.open.l) || f.open.cut.length || f.open.seen.covered.length || !f.open.seen.inCard || !f.open.seen.onScreen || f.open.seen.n !== 1 + MD.GT_TRACKED.length || f.open.focus !== 'all' || !f.open.seen.btnClear || f.open.moved);
      const at = (w, h) => fits.find((f) => f.w === w && f.h === h) || { open: { seen: {} } };
      check('Top tokens\' chain drop-down in a real browser at 320, 390, 1280 and 1920 px (and a 600px-tall phone and a phone on its side): closed, the button says "All chains" with its mark; open, every chain is listed — and either way no sideways scroll, nothing outside the column, no text under the floor, no name or initials cut',
        fits.length === 6 && !bad.length, JSON.stringify(bad.length ? bad : fits.map((f) => [f.w + 'x' + f.h, f.open.seen.top, f.open.seen.bottom, f.open.seen.up ? 'up' : 'down', f.open.seen.fixed ? 'fixed' : 'over', f.open.seen.scrolls])).slice(0, 900));
      check('  ...the open list lies over the controls below it, inside the side card\'s width, between the nav and the bottom of the screen, and nothing covers it — not the music player or its nudge, the ✏️ SEND IT button or Sendy: every chain is on top at its centre and its edges; it never lies over its own button, and the page does not move when it opens (a short screen scrolls the list inside)',
        fits.length === 6 && fits.every((f) => !f.open.seen.covered.length && f.open.seen.inCard && f.open.seen.onScreen && f.open.seen.btnClear && f.open.moved === 0) && at(740, 360).open.seen.scrolls,
        JSON.stringify(fits.map((f) => ({ w: f.w + 'x' + f.h, moved: f.open.moved, seen: f.open.seen }))).slice(0, 1200));
      check('  ...with too little room under the button it opens upward rather than moving the page: on a 1280px screen at the top of the page (the side column sticks there, so the list is fixed to the screen out of its clip) and on a phone whose button is low on the screen',
        at(1280, 900).open.seen.up && at(1280, 900).open.seen.fixed && at(1920, 900).open.seen.fixed && at(390, 600).open.seen.up && !at(390, 600).open.seen.fixed && !at(320, 900).open.seen.fixed,
        JSON.stringify(fits.map((f) => [f.w + 'x' + f.h, f.open.seen.up, f.open.seen.fixed])));
    });

    await step('Top tokens\' chain drop-down: room for what comes up over it', async () => {
      await go('/market', 1280); await openTokens(); await settled();
      // the nudge, up or put away by the step — the player's own timers (it leaves by itself a few seconds after the page opens)
      // are held off, so it is where the step says it is
      const nudge = (on) => ev('(() => { const h = document.getElementById("mp-hint"); if (!h) return false; if (!h.__held) { const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidden"); Object.defineProperty(h, "hidden", { get() { return d.get.call(this); }, set() { d.set.call(this, !window.__mktNudge); } }); h.__held = true; } window.__mktNudge = ' + on + '; h.hidden = ' + !on + '; return true; })()');
      // the page's first press brings the nudge up by itself: made on the Chain label, then the nudge put away; the page scrolled
      // until the side column sticks, so the list hangs down from the button towards the player's corner; then the list opened
      await press('document.getElementById("mkt-tf-l")'); await sleep(400); await nudge(false);
      await ev('window.scrollTo({ top: 900, behavior: "instant" }), true'); await sleep(300);
      await press(TRIG); await until('!' + POP + '.hidden'); await sleep(700);
      const before = await ev(PICKSEEN);
      const had = await nudge(true); await sleep(700);
      const over = await ev(PICKSEEN), hint = await ev('(() => { const r = document.getElementById("mp-hint").getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) }; })()');
      // a description lying over the nudge (a chip's, shown by the pointer) does not hide the nudge from the list: when something
      // pinned then changes and the list is looked at again, it stays above the nudge (it used to grow under it, and shrink back
      // when the description went, over and over). The bubble is held over the nudge by a rule of the walk's own (tips.js moves
      // and hides it as the pointer and the focus please), and the player is touched so the list looks again
      await ev('(() => { const h = document.getElementById("mp-hint"), r = h.getBoundingClientRect(); sendTips.show(h); const st = document.createElement("style"); st.id = "mkt-held-tip"; st.textContent = "#tip-bubble { display: block !important; left: " + r.left + "px !important; top: " + r.top + "px !important; width: " + r.width + "px !important; height: " + r.height + "px !important; max-width: none !important; box-sizing: border-box !important; }"; document.head.appendChild(st); document.getElementById("music-player").classList.add("mkt-poke"); return true; })()');
      await sleep(700);
      const tipOver = await ev('(() => { const p = ' + POP + ', h = document.getElementById("mp-hint").getBoundingClientRect(), t = document.elementFromPoint(h.left + 10, h.top + h.height / 2); return { bottom: Math.round(p.getBoundingClientRect().bottom), tip: !!t && t.id === "tip-bubble" }; })()');
      await ev('document.getElementById("mkt-held-tip").remove(), sendTips.hide(), document.getElementById("music-player").classList.remove("mkt-poke"), true');
      await nudge(false); await sleep(700);
      const after = await ev(PICKSEEN);
      await ev(TRIG + '.click(), true');
      check('  ...the open list makes room for what comes up over it while it is open (the player\'s nudge, at 1280 px with the side column stuck): it stops above the nudge within a second, nothing in it covered — still when a description lies over the nudge — and takes the room back once the nudge has gone',
        had && !before.up && before.fixed && !before.covered.length && !over.covered.length && over.bottom <= hint.top && over.bottom < before.bottom && tipOver.tip && tipOver.bottom === over.bottom && !after.covered.length && after.bottom === before.bottom,
        JSON.stringify({ before: [before.top, before.bottom, before.up], over: [over.top, over.bottom, over.covered], hint, tipOver, after: [after.top, after.bottom] }));
    });

    // the list's own hit tests, counted: market.js's looks at what is on top, and nobody else's
    const COUNT_HITS = `(() => { window.__mktHits = 0; for (const k of ['elementFromPoint', 'elementsFromPoint']) { const f = document[k].bind(document); document[k] = (x, y) => { if (/market\\.js/.test(new Error().stack || '')) window.__mktHits++; return f(x, y); }; } return true; })()`;
    await step('Top tokens\' chain drop-down: looked at only when something changes', async () => {
      // where the column sticks, the list is looked at when something pinned changes — never on a timer
      await go('/market', 1280); await openTokens(); await settled();
      await ev('window.scrollTo({ top: 900, behavior: "instant" }), true'); await sleep(300);
      // Sendy arriving and greeting is a real change to what is pinned (it is looked at); he is taken off the page so the two
      // seconds are ones where nothing changes (he shows himself again if only hidden)
      await ev('(() => { const s = document.getElementById("sendy-widget"); if (s) s.remove(); return true; })()');
      await ev(COUNT_HITS);
      await press(TRIG); await until('!' + POP + '.hidden'); await sleep(900);
      const opened = await ev('window.__mktHits'); await ev('window.__mktHits = 0, true');
      await sleep(2000);
      const idle = await ev('window.__mktHits');
      await ev('document.getElementById("music-player").classList.add("mkt-poke"), true'); await sleep(600);
      const poked = await ev('window.__mktHits');
      await ev('document.getElementById("music-player").classList.remove("mkt-poke"), ' + TRIG + '.click(), true');
      // below 1280px it lies over what is pinned, and never looks
      await go('/market', 390, 844); await openTokens(); await settled();
      await ev(COUNT_HITS);
      await press(TRIG); await until('!' + POP + '.hidden'); await sleep(2000);
      const phone = await ev('window.__mktHits');
      await ev(TRIG + '.click(), true');
      check('  ...the open list is not hit-tested on a schedule: where the side column sticks it looks when it opens and when something pinned changes (the player, here), and not at all in two seconds of nothing changing; on a phone, where it lies over what is pinned, it never looks',
        opened > 0 && idle === 0 && poked > 0 && phone === 0, JSON.stringify({ opened, idle, poked, phone }));
    });

    await step('Top tokens\' chain drop-down: over what is pinned, under the nav, and left alone', async () => {
      // a phone on its side: the list lies over the player's nudge where the two meet (not cut short above it), and its height
      // is not touched while the nudge and a description come and go over it
      await go('/market', 568, 320); await openTokens(); await settled();
      await pressStill(TRIG); await until('!' + POP + '.hidden'); await sleep(700);
      await ev('(() => { const h = document.getElementById("mp-hint"); if (h) h.hidden = false; window.__mktStyle = 0; new MutationObserver((m) => { window.__mktStyle += m.length; }).observe(' + POP + ', { attributes: true, attributeFilter: ["style", "class"] }); return true; })()');
      await sleep(400);
      const meet = await ev('(() => { if (window.sendTips) sendTips.hide(); const p = ' + POP + '.getBoundingClientRect(), h = document.getElementById("mp-hint").getBoundingClientRect(), l = Math.max(p.left, h.left), r = Math.min(p.right, h.right), t = Math.max(p.top, h.top), b = Math.min(p.bottom, h.bottom); if (r - l < 4 || b - t < 4) return { meet: false }; const e = document.elementFromPoint((l + r) / 2, (t + b) / 2); return { meet: true, onTop: ' + POP + '.contains(e), was: e && (e.id || e.className) }; })()');
      await ev('(() => { const h = document.getElementById("mp-hint"); sendTips.show(h); setTimeout(() => { sendTips.hide(); h.hidden = true; }, 300); return true; })()'); await sleep(900);
      const still = await ev('window.__mktStyle');
      await ev(TRIG + '.click(), true');
      // a 560px-tall phone scrolled so the button is near the top: the list hangs down and scrolls inside. Scrolled to its
      // middle, it is left alone while nothing changes; the page scrolled with it open, its top slides under the nav, which
      // stays over it, and it grows into what the scroll freed below
      await go('/market', 390, 560); await openTokens(); await settled();
      await ev('(() => { const r = ' + TRIG + '.getBoundingClientRect(); window.scrollBy({ top: r.top - 90, behavior: "instant" }); return true; })()'); await sleep(200);
      await press(TRIG); await until('!' + POP + '.hidden'); await sleep(700);
      const s0 = await ev('(() => { const p = ' + POP + '; p.scrollTop = Math.round((p.scrollHeight - p.clientHeight) / 2); window.__mktStyle = 0; new MutationObserver((m) => { window.__mktStyle += m.length; }).observe(p, { attributes: true, attributeFilter: ["style"] }); return { top: p.scrollTop, mh: p.style.maxHeight, scrolls: p.scrollHeight > p.clientHeight + 1, up: p.classList.contains("is-up") }; })()');
      await sleep(1300);
      const s1 = await ev('(() => { const p = ' + POP + '; return { top: p.scrollTop, mh: p.style.maxHeight, changes: window.__mktStyle }; })()');
      await ev('window.scrollBy({ top: 90, behavior: "instant" }), true'); await sleep(400);
      const s2 = await ev('(() => { const p = ' + POP + ', r = p.getBoundingClientRect(), nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 0, e = document.elementsFromPoint(r.left + r.width / 2, Math.max(2, nav - 6)).find((x) => !x.closest("#tip-bubble")); return { mh: p.style.maxHeight, top: Math.round(r.top), nav, navOver: !!e && !!e.closest(".nav"), open: !p.hidden }; })()');
      await ev(TRIG + '.click(), true');
      check('  ...on a phone on its side the open list lies over the player\'s nudge where they meet (so it is not cut short above it) and is not measured again while the nudge and a description come and go: its height is never touched',
        meet.meet && meet.onTop && still === 0, JSON.stringify({ meet, still }));
      check('  ...a list that scrolls inside (a 560px-tall phone) is left alone while nothing changes: its height is not touched and where it was scrolled to stays, so a flick through it is never cut short',
        s0.scrolls && !s0.up && s0.top > 0 && s1.top === s0.top && s1.mh === s0.mh && s1.changes === 0, JSON.stringify({ s0, s1 }));
      check('  ...and the page scrolled with it open: its top slides up under the sticky nav, which stays over it (the nav rises over the open list, as it does for its own menus), and it grows into what the scroll freed below',
        s2.open && s2.top < s2.nav && s2.navOver && parseFloat(s2.mh) >= parseFloat(s0.mh), JSON.stringify({ s0: s0.mh, s2 }));
    });

    await step('Top tokens\' chain drop-down: the page never moves, so a double-click is not a pick', async () => {
      const res = [];
      for (const [w, h] of [[390, 844], [1280, 900], [1920, 1080]]) {
        await go('/market', w, h); await openTokens(); await settled();
        await ev(TRIG + '.scrollIntoView({ block: "center", behavior: "instant" }), true'); await sleep(200);
        const y0 = await ev('scrollY'), xy = await ev('(() => { const r = ' + TRIG + '.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()');
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: xy[0], y: xy[1], button: 'none' });
        for (const n of [1, 2]) for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: xy[0], y: xy[1], button: 'left', clickCount: n });
        await sleep(600);
        res.push({ w: w + 'x' + h, url: await ev('location.search'), t: (await trig()).t, open: await isOpen(), on: await pressed(), moved: Math.round((await ev('scrollY')) - y0) });
      }
      check('a double-click on the Chain button opens and closes the list and picks nothing: the page does not move under the pointer, so the second press lands on the button again (it used to land on a chain the page had lifted there — Base on a phone, Solana on a 1920px screen)',
        res.every((r) => r.url === '' && r.t === 'All chains' && r.on === 'all' && !r.open && r.moved === 0), JSON.stringify(res));
      // forced colours take background pictures away: the all-chains mark's dots are drawn again in the system's colours
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
      const fc = await ev('(() => { const m = document.querySelector("#mkt-tchains .mkt-ava-all"), cs = getComputedStyle(m); return { bi: cs.backgroundImage.slice(0, 60), fca: cs.forcedColorAdjust }; })()');
      await cdp('Emulation.setEmulatedMedia', { features: [] });
      check('  ...in forced colours the all-chains mark keeps its four dots (drawn in the system\'s colours), not an empty ring',
        /radial-gradient/.test(fc.bi) && fc.fca === 'none', JSON.stringify(fc));
    });

    await step('Top tokens: every chain, and the chain drop-down', async () => {
      await go('/market', 1280);
      const m0 = FAKE.log.length;
      await openTokens(); await settled();
      await until('!!' + opt('ethereum') + '.querySelector("img") && ' + opt('ethereum') + '.querySelector("img").complete');
      const t0 = await trig(), ax0 = await axOf(TRIG);
      const btnAttrs = await ev('(() => { const b = ' + TRIG + '; return { tip: b.dataset.tip || "", ctl: b.getAttribute("aria-controls"), pop: b.hasAttribute("aria-haspopup"), tag: b.tagName, type: b.type }; })()');
      check('Top tokens opens on every chain\'s list (/api/market/tokens?chain=all, nothing added to the address); the Chain button says "All chains", with the all-chains mark and closed',
        tokAsks(m0)[0] === '/api/market/tokens?chain=all' && (await ev('location.search')) === '' && t0.t === 'All chains' && t0.all && t0.exp === 'false' && (await ev(POP + '.hidden')) === true && (await pressed()) === 'all',
        JSON.stringify({ asked: tokAsks(m0), t0 }));
      check('  ...the button is a real button that names what it shows ("Chain: All chains" to a screen reader), says what it does in a description that does not repeat that, and controls the list as a disclosure (aria-expanded, aria-controls — no menu popup)',
        ax0.role === 'button' && ax0.name === 'Chain: All chains' && btnAttrs.tag === 'BUTTON' && btnAttrs.type === 'button' && btnAttrs.ctl === 'mkt-tchain-p' && !btnAttrs.pop && btnAttrs.tip.length > 30 && !/^chain:? all chains$/i.test(btnAttrs.tip), JSON.stringify({ ax0, btnAttrs }));
      await press(TRIG); await until('!' + POP + '.hidden');
      const opts = await ev('[...document.querySelectorAll("#mkt-tchain-p button")].map((b) => { const img = b.querySelector("img"), mono = b.querySelector(".mkt-mono"); return { k: b.dataset.tchain, tag: b.tagName, li: b.parentNode.tagName, pressed: b.getAttribute("aria-pressed"), tip: b.dataset.tip || "",'
        + ' name: (b.querySelector(".mkt-copt-n") || {}).textContent || "", tick: getComputedStyle(b.querySelector(".mkt-tick")).visibility, img: img ? { alt: img.getAttribute("alt"), ok: img.naturalWidth > 0 } : null,'
        + ' ini: mono ? mono.textContent : "", iniShown: mono ? getComputedStyle(mono).visibility === "visible" : null, all: !!b.querySelector(".mkt-ava-all") }; })');
      const list = await ev('(() => { const p = ' + POP + '; return { tag: p.tagName, role: p.getAttribute("role"), by: p.getAttribute("aria-labelledby") }; })()');
      const axEth = await axOf(opt('ethereum')), o = (k) => opts.find((x) => x.k === k) || {};
      const words = (t) => String(t).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
      check('  ...opening it lists every chain the server reads, "All chains" first then Robinhood Chain and the rest in the server\'s order, each a real button in a list (role="list", not a menu) with its logo and its full name — the focus on the chosen one, the button now open',
        opts.map((x) => x.k).join() === ['all'].concat(MD.GT_TRACKED).join() && opts.every((x) => x.tag === 'BUTTON' && x.li === 'LI') && list.tag === 'UL' && list.role === 'list' && list.by === 'mkt-tf-l'
        && o('all').name === 'All chains' && o('all').all && o('robinhood').name === 'Robinhood Chain' && o('ethereum').name === 'Ethereum' && o('base').name === 'Base' && (await focused()) === 'all' && (await trig()).exp === 'true'
        && axEth.role === 'button' && axEth.name === 'Ethereum', JSON.stringify({ opts: opts.map((x) => x.k + ':' + x.name), list, axEth }).slice(0, 700));
      check('  ...the chosen one says so by more than its fill: a tick and aria-pressed; each says what it does in a description that does not repeat its name; a logo is decorative (alt="") over the initials, and Solana\'s, which does not load, leaves its initials — never a broken picture',
        opts.every((x) => /^(true|false)$/.test(x.pressed) && x.tip.length > 20 && words(x.tip) !== words(x.name)) && opts.filter((x) => x.pressed === 'true').map((x) => x.k).join() === 'all' && o('all').tick === 'visible' && opts.filter((x) => x.k !== 'all').every((x) => x.tick === 'hidden')
        && o('ethereum').img && o('ethereum').img.alt === '' && o('ethereum').img.ok && o('ethereum').iniShown === false && o('solana').img === null && o('solana').ini === 'SO' && o('solana').iniShown === true && o('robinhood').ini === 'RC',
        JSON.stringify(opts).slice(0, 800));
      // BSC's logo failing as a missing picture does: its three-letter initials must fit, as Solana's two do
      const iniFit = await ev('(() => { const i = ' + opt('bsc') + '.querySelector("img"); if (i) i.dispatchEvent(new Event("error")); return [...document.querySelectorAll("#mkt-tchain-p .mkt-ava-cf:not(.mkt-ava-all)")].filter((d) => !d.querySelector("img")).map((d) => { const m = d.querySelector(".mkt-mono"), r = m.getBoundingClientRect(), b = d.getBoundingClientRect(); return { t: m.textContent, fits: r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && m.scrollWidth <= Math.ceil(r.width) + 1 }; }); })()');
      check('  ...a logo that fails in the list leaves initials that fit their disc — three letters (BSC) as well as two (SO), never a letter cut off',
        iniFit.some((x) => x.t === 'BSC') && iniFit.some((x) => x.t === 'SO') && iniFit.every((x) => x.fits), JSON.stringify(iniFit));
      await K.esc(); await until(POP + '.hidden');
      const rows0 = await tokRows(), cap0 = await textOf('#mkt-cap'), usdg = rows0.filter((r) => r.t === USDG);
      check('  ...the list mixes the chains, each row naming its own (USDG on Robinhood Chain and on Ethereum are two rows, each saying which), and the caption says what the list is and which chains have not been read',
        rows0.some((r) => r.c === 'robinhood') && rows0.some((r) => r.c === 'ethereum') && rows0.every((r) => /^on (Robinhood Chain|Ethereum)$/.test(r.chb)) && usdg.length === 2 && usdg.map((r) => r.c).sort().join() === 'ethereum,robinhood'
        && /^Every chain · ranked by volume, highest first · last 24 hours · 2 of 9 chains read · read /.test(cap0) && /Not read yet: Solana, Base, BSC, Arbitrum, Polygon, Avalanche, OP Mainnet/.test(cap0) && /the same token on two chains is two rows/.test(cap0),
        JSON.stringify({ rows0: rows0.slice(0, 4), cap0 }).slice(0, 600));
      // the controls keep working on it
      let m = FAKE.log.length;
      await ev('document.querySelector("#mkt-ctl-tokens [data-sort=\\"liquidity\\"]").click(), true'); await listReady();
      await ev('document.querySelector("#mkt-ctl-tokens [data-win=\\"1h\\"]").click(), true'); await listReady();
      await ev('document.querySelector("#mkt-ctl-tokens [data-dir=\\"asc\\"]").click(), true'); await listReady();
      const ctl = { asked: tokAsks(m), cap: await textOf('#mkt-cap'), rows: await tokRows() };
      check('  ...Rank by, Order and Time frame work on every chain\'s list: each change asks for chain=all again, and the caption follows',
        ctl.asked.join() === ['/api/market/tokens?chain=all&sort=liquidity', '/api/market/tokens?chain=all&sort=liquidity&window=1h', '/api/market/tokens?chain=all&sort=liquidity&dir=asc&window=1h'].join() && /^Every chain · ranked by liquidity, lowest first · last hour/.test(ctl.cap) && /not the lowest on any chain/.test(ctl.cap)
        && ctl.rows.some((r) => r.c === 'ethereum') && ctl.rows.some((r) => r.c === 'robinhood'), JSON.stringify(ctl).slice(0, 500));
      await ev('document.querySelector("#mkt-ctl-tokens [data-sort=\\"volume\\"]").click(), document.querySelector("#mkt-ctl-tokens [data-dir=\\"desc\\"]").click(), document.querySelector("#mkt-ctl-tokens [data-win=\\"24h\\"]").click(), true'); await listReady(); await sleep(300);
      // a chain picked narrows it; the main view stays where it was
      m = FAKE.log.length;
      await pickChain('ethereum');
      await until('location.search === "?chain=robinhood&tchain=ethereum"'); await listReady();
      const eth = { rows: await tokRows(), cap: await textOf('#mkt-cap'), asked: tokAsks(m), on: await pressed(), vh: await textOf('#mkt-vh'), trig: await trig(), focus: await focused(), open: await isOpen(), ax: await axOf(TRIG) };
      m = FAKE.log.length;
      await pickChain('base');
      await until('location.search === "?chain=robinhood&tchain=base"'); await listReady();
      const base = { list: await textOf('#mkt-list'), cap: await textOf('#mkt-cap'), asked: tokAsks(m), on: await pressed(), trig: await trig() };
      check('  ...picking Ethereum lists its tokens only (its own list, chain=<key>), puts tchain in the address, closes the list with the focus back on the button — which now shows Ethereum\'s logo and "Ethereum" ("Chain: Ethereum") — and the main view stays on Robinhood Chain; a chain not read yet says so',
        eth.asked.join() === '/api/market/tokens?chain=ethereum' && eth.rows.length > 5 && eth.rows.every((r) => r.c === 'ethereum') && /^Tokens on Ethereum · ranked by volume/.test(eth.cap) && eth.on === 'ethereum' && /Robinhood Chain/.test(eth.vh)
        && eth.trig.t === 'Ethereum' && eth.trig.img === true && eth.trig.exp === 'false' && !eth.open && eth.focus === 'button' && eth.ax.name === 'Chain: Ethereum'
        && base.asked.join() === '/api/market/tokens?chain=base' && /This chain's pools have not been read yet\./.test(base.list) && /^Tokens on Base/.test(base.cap) && base.on === 'base' && base.trig.t === 'Base',
        JSON.stringify({ eth: Object.assign({}, eth, { rows: eth.rows.length }), base }).slice(0, 700));
      await ev('history.back(), true');
      await until('location.search === "?chain=robinhood&tchain=ethereum"'); await listReady();
      const back1 = { rows: await tokRows(), on: await pressed(), t: (await trig()).t };
      await ev('history.back(), true');
      await until('location.search === ""'); await listReady();
      const back2 = { rows: await tokRows(), on: await pressed(), t: (await trig()).t, all: (await trig()).all };
      await ev('history.forward(), true');
      await until('location.search === "?chain=robinhood&tchain=ethereum"'); await listReady();
      const fwd = { rows: await tokRows(), on: await pressed(), t: (await trig()).t };
      check('  ...Back and Forward restore the filter and the button\'s label: Back to Ethereum\'s list ("Ethereum"), Back to every chain\'s ("All chains"), Forward to Ethereum\'s again',
        back1.on === 'ethereum' && back1.t === 'Ethereum' && back1.rows.length && back1.rows.every((r) => r.c === 'ethereum') && back2.on === 'all' && back2.t === 'All chains' && back2.all && back2.rows.some((r) => r.c === 'robinhood') && back2.rows.some((r) => r.c === 'ethereum')
        && fwd.on === 'ethereum' && fwd.t === 'Ethereum' && fwd.rows.every((r) => r.c === 'ethereum'), JSON.stringify({ back1: [back1.on, back1.t], back2: [back2.on, back2.t], fwd: [fwd.on, fwd.t] }));
      // Back with the list open: it closes first — left open, its tick and the focus would be on a chain no longer chosen
      await press(TRIG); await until('!' + POP + '.hidden');
      await ev('history.back(), true'); await until('location.search === ""'); await listReady();
      const bo = { open: await isOpen(), focus: await focused(), t: (await trig()).t, on: await pressed() };
      await ev('history.forward(), true'); await until('location.search === "?chain=robinhood&tchain=ethereum"'); await listReady();
      check('  ...Back with the list open closes it, the focus back on the button, which says "All chains" again',
        !bo.open && bo.focus === 'button' && bo.t === 'All chains' && bo.on === 'all', JSON.stringify(bo));
      // Escape and a press outside close it; neither changes the filter
      m = FAKE.log.length;
      await press(TRIG); await until('!' + POP + '.hidden');
      await K.esc(); await until(POP + '.hidden');
      const esc1 = { open: await isOpen(), focus: await focused(), url: await ev('location.search') };
      await press(TRIG); await until('!' + POP + '.hidden');
      await press('document.getElementById("mkt-vh")'); await until(POP + '.hidden');
      const out1 = { open: await isOpen(), url: await ev('location.search'), on: await pressed(), t: (await trig()).t };
      check('  ...Escape closes it with the focus back on the button; a press outside it closes it too; neither changes the filter or reads the list again',
        !esc1.open && esc1.focus === 'button' && esc1.url === '?chain=robinhood&tchain=ethereum' && !out1.open && out1.url === esc1.url && out1.on === 'ethereum' && out1.t === 'Ethereum' && !tokAsks(m).length, JSON.stringify({ esc1, out1, asked: tokAsks(m) }));
      // the keyboard alone: Tab to the button, Enter opens it on the chosen chain, the arrows move, Enter picks
      await ev('document.getElementById("mkt-tab-tokens").focus(), true');
      await K.tab();
      const kb0 = await focused();
      await K.enter(); await until('!' + POP + '.hidden');
      const kb1 = { focus: await focused(), open: await isOpen() };
      await K.down(); const kb2 = await focused();
      await K.up(); await K.up(); const kb3 = await focused();
      await K.enter();
      await until('location.search === "?chain=robinhood&tchain=robinhood"'); await listReady();
      const kb4 = { open: await isOpen(), focus: await focused(), t: (await trig()).t, rows: await tokRows() };
      check('  ...by keyboard alone: Tab from the Top tokens tab reaches the button, Enter opens it with the focus on the chosen chain (Ethereum), the arrows move (Solana, then back up to Robinhood Chain), Enter picks — the list closes, the focus is back on the button, which says "Robinhood Chain"',
        kb0 === 'button' && kb1.focus === 'ethereum' && kb1.open && kb2 === 'solana' && kb3 === 'robinhood' && !kb4.open && kb4.focus === 'button' && kb4.t === 'Robinhood Chain' && kb4.rows.length && kb4.rows.every((r) => r.c === 'robinhood'),
        JSON.stringify({ kb0, kb1, kb2, kb3, kb4: Object.assign({}, kb4, { rows: kb4.rows.length }) }));
      // Space opens it too; Tab goes through the chains and is never trapped: past the last one it leaves, and the list closes
      await K.space(); await until('!' + POP + '.hidden');
      const sp = await focused();
      await K.tab(); const tb1 = { focus: await focused(), open: await isOpen() };
      await K.shiftTab(); const tb2 = await focused();
      await K.end(); const tb3 = await focused();
      await K.tab(); await sleep(60);
      const tb4 = { focus: await focused(), open: await isOpen(), exp: (await trig()).exp };
      check('  ...Space opens it (on Robinhood Chain); Tab and Shift+Tab move through the chains like any buttons (Ethereum, back to Robinhood Chain), End jumps to the last (OP Mainnet), and Tab past it leaves the list for the next control (Rank by: Volume) and closes it — never a trap',
        sp === 'robinhood' && tb1.focus === 'ethereum' && tb1.open && tb2 === 'robinhood' && tb3 === 'optimism' && tb4.focus === 'volume' && !tb4.open && tb4.exp === 'false', JSON.stringify({ sp, tb1, tb2, tb3, tb4 }));
      // an arrow puts the next chain's description up (tips.js, for any focus moved by a key); as everywhere on the site, the first
      // Escape takes that description down (WCAG 1.4.13) and the next one closes the list
      await until('new Promise((r) => { const y = scrollY; setTimeout(() => r(scrollY === y), 200); })');   // the Tab above scrolled the page to the next control (smoothly): a scroll takes any description down
      await ev(TRIG + '.focus(), true'); await until('new Promise((r) => { const y = scrollY; setTimeout(() => r(scrollY === y), 200); })');
      await K.enter(); await until('!' + POP + '.hidden');
      await K.down(); await sleep(60);
      const tip1 = await ev('!!document.getElementById("tip-bubble") && !document.getElementById("tip-bubble").hidden');
      await K.esc(); const e1 = { open: await isOpen(), tip: await ev('!!document.getElementById("tip-bubble") && !document.getElementById("tip-bubble").hidden') };
      await K.esc(); await until(POP + '.hidden');
      const e2 = { open: await isOpen(), focus: await focused() };
      check('  ...after an arrow, its description showing: the first Escape takes the description down (the site\'s rule for every control), the second closes the list and puts the focus back on the button',
        tip1 && e1.open && !e1.tip && !e2.open && e2.focus === 'button', JSON.stringify({ tip1, e1, e2 }));
      // a logo that fails on the button leaves its initials there too: Solana's (two letters), BSC's (three)
      await pickChain('solana'); await until('location.search === "?chain=robinhood&tchain=solana"'); await listReady();
      const so = await trig();
      await pickChain('bsc'); await until('location.search === "?chain=robinhood&tchain=bsc"'); await listReady();
      await ev('(() => { const i = ' + TRIG + '.querySelector("img"); if (i) i.dispatchEvent(new Event("error")); return true; })()');
      const bsc = await trig(), bscCut = await ev(PICKFIT);
      check('  ...a logo that is missing or fails on the button leaves the chain\'s initials there as in the list — Solana\'s "SO", and BSC\'s "BSC" whole, nothing cut',
        so.t === 'Solana' && so.img === null && so.ini === 'SO' && so.iniShown && bsc.t === 'BSC' && bsc.img === null && bsc.ini === 'BSC' && bsc.iniShown && !bscCut.length, JSON.stringify({ so, bsc, bscCut }));
      // a row opens its token on ITS chain, and only that row is marked as the one in view
      await pickChain('all'); await until('location.search === "?chain=robinhood"'); await listReady();
      await ev('document.querySelector("#mkt-list .mkt-row[data-chain=\\"ethereum\\"][data-token=\\"' + USDG + '\\"]").click(), true');
      await until('location.search === "?chain=ethereum&token=' + USDG + '"'); await viewReady();
      const opened = { kick: await textOf('.mkt-kicker'), cur: (await tokRows()).filter((r) => r.cur) };
      check('  ...a row opens that token on its own chain in the main view (USDG on Ethereum, not on Robinhood Chain), and only that row is marked as the one shown',
        /Token · Ethereum/.test(opened.kick) && opened.cur.length === 1 && opened.cur[0].c === 'ethereum' && opened.cur[0].t === USDG, JSON.stringify(opened));
    });

    await step('Top tokens: a link to a filter, and a slow answer', async () => {
      const m = FAKE.log.length;
      await go('/market?tchain=base', 390); await listReady();
      const link = { tab: await ev('document.getElementById("mkt-tab-tokens").getAttribute("aria-selected")'), on: await pressed(), t: (await trig()).t, asked: tokAsks(m), chains: FAKE.log.slice(m).includes('/api/market/chains'), vh: await textOf('#mkt-vh') };
      check('a link with tchain=base opens Top tokens on Base\'s list with Base chosen and named on the button (the logos read quietly from the chains list), the main view on Robinhood Chain',
        link.tab === 'true' && link.on === 'base' && link.t === 'Base' && link.asked.join() === '/api/market/tokens?chain=base' && link.chains && /Robinhood Chain/.test(link.vh), JSON.stringify(link));
      // every chain's answer is slow to come; Ethereum's, asked after it, comes first — the slower one must not paint over it
      FAKE.tokensDelay = (search) => (/chain=all/.test(search) ? 900 : 0);
      await go('/market', 1280);
      await ev('document.getElementById("mkt-tab-tokens").click(), true');
      await sleep(100);
      await ev(TRIG + '.click(), ' + opt('ethereum') + '.click(), true');
      await sleep(1500);
      const late = { rows: await tokRows(), cap: await textOf('#mkt-cap'), on: await pressed(), t: (await trig()).t };
      FAKE.tokensDelay = null;
      check('  ...an older answer that arrives late never paints over a newer one: every chain\'s (slow) list does not replace Ethereum\'s (asked after it)',
        late.on === 'ethereum' && late.t === 'Ethereum' && late.rows.length && late.rows.every((r) => r.c === 'ethereum') && /^Tokens on Ethereum/.test(late.cap), JSON.stringify(Object.assign({}, late, { rows: late.rows.length })));
    });

    check('no script error from market.js anywhere on the walk', ours().length === 0, ours().map((x) => (x.exception && x.exception.description || x.text || '').split('\n')[0]).slice(0, 3).join(' | '));
    if (exceptions.length > ours().length) notes.push((exceptions.length - ours().length) + ' script error(s) from other scripts on the faked page (not this page\'s): ' + exceptions.filter((x) => !ours().includes(x)).map((x) => (x.exception && x.exception.description || x.text || '').split('\n')[0]).slice(0, 3).join(' | '));
  } catch (e) {
    console.error('ERROR', e && e.stack);
    check('the browser walk ran to the end', false, e && e.message);
  } finally {
    try { if (ws) ws.close(); } catch {}
    if (chrome) { try { chrome.kill('SIGKILL'); } catch {} await sleep(300); }
    if (profile) { try { rmSync(profile, { recursive: true, force: true }); } catch {} }
    site.close();
  }
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
    check('  ...the first view asks exactly /api/market/chains and /api/market/chain?key=robinhood (reads robots.txt opens); Top tokens asks /api/market/tokens?chain=all, or chain=<key> for the chain its filter names',
      /if \(k\.sort !== 'tvl'\) p\.set\('sort'/.test(code) && /if \(k\.win !== '24h'\) \{ p\.set\('window'/.test(code) && /p\.set\('key', key\);/.test(code) && /p\.set\('chain', chain\);\s*if \(k\.sort !== 'volume'\)/.test(code)
      && /const DEFAULT_CHAIN = 'robinhood';/.test(code) && /const chain = S\.tokens\.tchain \|\| 'all'/.test(code) && /getJSON\(tokensURL\(chain\)\)/.test(code));
    const tokensCtl0 = H.slice(H.indexOf('id="mkt-ctl-tokens"'), H.indexOf('id="mkt-cap"'));
    check('Top tokens\' chain filter (owner, 2026-10-27: "Make the chain picker filter be a drop down picker with the names of each chain and their logo"): first in the tab\'s controls, a labelled group holding a real button with aria-expanded and aria-controls — a disclosure, as the bell\'s list is: no aria-haspopup, no role="menu" — and the list it opens (role="list"), hidden until it is opened; the row of logo buttons is gone',
      /<div class="mkt-group" role="group" aria-labelledby="mkt-tf-l">\s*<p class="mkt-group-l" id="mkt-tf-l">Chain<\/p>\s*<div class="mkt-cpick" id="mkt-tchains">\s*<button class="np-chip mkt-cpick-b" id="mkt-tchain-b" type="button" aria-expanded="false" aria-controls="mkt-tchain-p" data-tip="[^"]{30,}">/.test(tokensCtl0)
      && /<ul class="mkt-cpick-p" id="mkt-tchain-p" role="list" aria-labelledby="mkt-tf-l" hidden><\/ul>\s*<\/div>\s*<\/div>/.test(tokensCtl0) && tokensCtl0.indexOf('id="mkt-tchains"') < tokensCtl0.indexOf('data-sort=')
      && !/aria-haspopup|role="menu"|menuitem/.test(H + code) && !/mkt-cfs|mkt-cf\b/.test(H + code + CSS) && !/id="mkt-tok-on"/.test(H) && !/mkt-tok-on/.test(code));
    check('  ...market.js draws "All chains" then a real button per chain the server reads, each in a list item, with aria-pressed, a tick, the chain\'s mark (its logo with alt="" over its initials; a drawn mark for every chain) and its full name in words, and a description; the button shows the chosen chain\'s mark and name, "Chain: " said before it, and a drawn caret — no ▾ typed anywhere',
      /filterBox\.innerHTML = \['all'\]\.concat\(READS\)\.map\(filterHTML\)\.join\(''\);/.test(code) && /'<li><button class="npm-item mkt-copt" type="button" data-tchain="' \+ esc\(k\) \+ '" aria-pressed="false" data-tip="' \+/.test(code)
      && /'<span class="mkt-tick" aria-hidden="true">✓<\/span>' \+ markHTML\(k, nm\) \+ '<span class="mkt-copt-n">' \+ esc\(nm\) \+ '<\/span><\/button><\/li>'/.test(code)
      && /pick\.btn\.innerHTML = markHTML\(k, pickName\(k\)\) \+ '<span class="sr-only">Chain: <\/span><span class="mkt-cpick-t">' \+ esc\(pickName\(k\)\) \+ '<\/span><span class="mkt-caret" aria-hidden="true"><\/span>';/.test(code)
      && /'<img class="mkt-logo" src="' \+ esc\(lg\) \+ '" alt=""/.test(code) && /<span class="mkt-mono">' \+ esc\(initials\(nm\)\) \+ '<\/span>/.test(code) && /if \(k === 'all'\) return '<span class="mkt-ava mkt-ava-cf mkt-ava-all" aria-hidden="true"><\/span>';/.test(code)
      && /const pickName = \(k\) => \(k === 'all' \? 'All chains' : chainName\(k\)\);/.test(code) && !/▾/.test(H + JS));
    check('  ...it opens and closes as a disclosure: opening moves the focus to the chosen chain; a pick or Escape closes it with the focus back on the button; a press outside closes it; leaving it with Tab closes it (a focus that goes nowhere does not); the arrows, Home and End move between the chains, and Tab is never taken over',
      /const on = filterBox\.querySelector\('\[aria-pressed="true"\]'\)/.test(code) && /pick\.box\.addEventListener\('focusout', \(e\) => \{ if \(e\.relatedTarget && !pick\.box\.contains\(e\.relatedTarget\)\) closePick\(false\); \}\);/.test(code)
      && /document\.addEventListener\('click', \(e\) => \{ if \(filterBox && !filterBox\.hidden && !pick\.box\.contains\(e\.target\)\) closePick\(false\); \}\);/.test(code)
      && /if \(\(e\.key === 'Escape' \|\| e\.key === 'Esc'\) && filterBox && !filterBox\.hidden\) \{ e\.preventDefault\(\); closePick\(true\); \}/.test(code)
      && /closePick\(true, e\.detail > 0\);\s*if \(t === S\.tokens\.tchain\) return;/.test(code) && /if \(!\['ArrowDown', 'ArrowUp', 'Home', 'End'\]\.includes\(e\.key\)\) return;/.test(code) && !/'Tab'/.test(code));
    const pickCode = code.slice(code.indexOf('const navH = () =>'), code.indexOf("window.addEventListener('resize', () => fitPick('measure'));"));
    check('  ...the open list never moves the page: it hangs under the button or over it, whichever has the room (only when under is short), as tall as that room and scrolling inside; below 1280px it lies over what is pinned to the screen with the nav risen over it, and where the side column sticks it is fixed to the screen out of the column\'s clip and kept out from under what is pinned — by hit-testing that looks through the description bubble, on a change to the page and never on a timer',
      pickCode.length > 2000 && !/scrollBy\(|scrollTo\(|scrollIntoView|setInterval/.test(pickCode)
      && /return el && el\.closest\('#tip-bubble'\) \? document\.elementsFromPoint\(x, y\)\.find\(\(e\) => !e\.closest\('#tip-bubble'\)\) \|\| null : el;/.test(pickCode)
      && /edges = \[r\.left \+ 3, r\.right - 3\]/.test(pickCode) && /if \(how === 'open' && use\.h < need\) \{ const up = pickRoom\(true, band\); if \(up\.h > use\.h\) use = up; else placePick\(false\); \}/.test(pickCode)
      && /pick\.fixed = getComputedStyle\(\$\('mkt-side'\)\)\.position === 'sticky';/.test(pickCode) && /const under = pick\.fixed \? pickCover\(r, band, up\) : null;/.test(pickCode)
      && /new MutationObserver\(/.test(pickCode) && /pickMO\.observe\(document\.body, \{ subtree: true, childList: true, attributes: true, attributeFilter: \['hidden', 'class', 'style'\] \}\);/.test(pickCode)
      && /t\.contains\(filterBox\) \|\| t\.id === 'tip-bubble' \|\| t\.classList\.contains\('rk-layer'\)/.test(pickCode) && /pick\.soon = setTimeout\(pickWatch, 300\);/.test(pickCode)
      && /window\.addEventListener\('scroll', \(e\) => \{ if \(filterBox && !filterBox\.contains\(e\.target\)\) fitPick\(\); \}/.test(code)
      && /\.mkt-cpick-p \{\s*position: absolute;[^}]*z-index: 260;[^}]*overflow-y: auto;/.test(CSS) && /\.mkt-cpick-p\[hidden\] \{ display: none; \}/.test(CSS)
      && /\.mkt-cpick-p\.is-up \{ top: auto; bottom: calc\(100% \+ 0\.4rem\); \}/.test(CSS) && /\.mkt-cpick-p\.is-fixed \{ position: fixed; \}/.test(CSS) && /body:has\(#mkt-tchain-p:not\(\[hidden\]\)\) > \.nav \{ z-index: 300; \}/.test(CSS));
    check('  ...it lives in the address bar (tchain=<key>, absent for every chain; anything but a chain the server reads is every chain), a change is pushed so Back and Forward restore it, and the main view is left where it was',
      /const tc = \(q\.get\('tchain'\) \|\| ''\)\.toLowerCase\(\), tchain = READS\.includes\(tc\) \? tc : '';/.test(code) && /if \(S\.tokens\.tchain\) p\.set\('tchain', S\.tokens\.tchain\);/.test(code)
      && /S\.tokens\.tchain = t; S\.shown = pageSize\(\);\s*writeURL\(true\); syncControls\(\); loadList\(\);/.test(code) && !/chainChanged/.test(code) && /if \(S\.tchainMoved && S\.tab !== 'tokens'\) setTab\('tokens', false\); else loadList\(\);/.test(code));
    check('  ...the chosen chain says so by more than colour (a tick as well as its fill); the caret is drawn (a clipped square, never a glyph), turns without animating under reduced motion or the nav\'s ⏸, and keeps a system colour in forced colours (so does the all-chains mark); a logo that does not load leaves the initials (the logo hides them only while it is there; three letters grow the disc into a pill)',
      /\.mkt-copt\[aria-pressed="true"\] \.mkt-tick \{ visibility: visible; \}/.test(CSS) && /\.mkt-copt \.mkt-tick \{[^}]*visibility: hidden; \}/.test(CSS)
      && /\.mkt-caret::before \{ content: ''; [^}]*clip-path: polygon\(0 0, 100% 0, 50% 100%\); \}/.test(CSS) && /\.mkt-row, \.mkt-caret \{ transition: none; \}/.test(CSS) && /html\.motion-off \.mkt-caret \{ transition: none; \}/.test(CSS)
      && /@media \(forced-colors: active\) \{\s*\.mkt-caret::before \{ forced-color-adjust: none; background: ButtonText; \}/.test(CSS) && /\.mkt-ava-cf\.mkt-ava-all \{ forced-color-adjust: none; --dot: ButtonText; background-color: ButtonFace; border-color: ButtonText; \}/.test(CSS)
      && /\.mkt-ava-cf:has\(img\) \.mkt-mono \{ visibility: hidden; \}/.test(CSS) && /\.mkt-ava-cf:not\(:has\(img\)\) \{ width: auto; min-width: 2em; padding: 0 0\.3em; border-radius: 1em; \}/.test(CSS) && /img\.addEventListener\('error', \(\) => img\.remove\(\)\)/.test(code));
    check('  ...every row of the all-chains list names its chain (its logo and its name in words — "on Base" to a screen reader) and opens the token on that chain; the row in the main view is matched by chain and address',
      /const chainBadge = \(r\) => '<span class="mkt-chb">'/.test(code) && /'<span class="sr-only">on <\/span>' \+ esc\(r\.chainName \|\| chainName\(r\.chain\)\)/.test(code) && /\(all \? chainBadge\(r\) : ''\)/.test(code)
      && /data-chain="' \+ esc\(on\) \+ '" data-token="' \+ esc\(r\.address\) \+ '"/.test(code) && /const cur = S\.view\.token && S\.view\.chain === on && sameToken\(S\.view\.token, r\.address\);/.test(code) && /b\.dataset\.chain === S\.view\.chain && sameToken\(b\.dataset\.token, S\.view\.token\)/.test(code));
    check('  ...no storage: the address bar is the state (?chain=&token=&window=&from=&to=), pushed when the view changes, read back on Back / Forward',
      !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code) && /p\.set\('chain', v\.chain\);\s*if \(v\.token\) p\.set\('token', v\.token\);/.test(code) && /history\[push \? 'pushState' : 'replaceState'\]/.test(code)
      && /window\.addEventListener\('popstate', \(\) => \{ closePick\(true\); readURL\(\);/.test(code) && /q\.get\('from'\)/.test(code) && /q\.get\('to'\)/.test(code));
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
      /\.mkt-chips \.np-chip, \.mkt-wash \{ min-height: 44px;/.test(CSS) && /\.mkt-cpick-b \{[^}]*min-height: 44px;/.test(CSS) && /\.mkt-copt \{ min-height: 44px;/.test(CSS) && /\.mkt-row \{[^}]*min-height: 52px;/.test(CSS) && /\.mkt-row:focus-visible \{ outline: 3px solid var\(--focus\);/.test(CSS)
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
    check('  ...GET /api/market/chain: stats (every figure an object), stage and risks, daily history per metric (plain [day, value] arrays, each source in history.src, whole days only), top tokens with their basis, the newest 20 pools, the pulse with each reading\'s own time, the sources',
      rh.key === 'robinhood' && rh.chainId === 4663 && typeof rh.at === 'number' && stKeys.every((k) => rh.stats[k] && 'v' in rh.stats[k]) && rh.stats.stage === 'Stage 0' && rh.stats.risks.length === 5 && rh.stats.risks.every((r) => r.name && r.value && r.sentiment)
      && ['tvl', 'volume', 'fees', 'stables', 'txcount'].every((k) => SRCS.includes(rh.history.src[k]) && Array.isArray(rh.history[k]) && rh.history[k].length > 100 && rh.history[k].every((p) => DAY.test(p[0]) && typeof p[1] === 'number'))
      && rh.history.src.txcount === 'growthepie' && ['tvl', 'volume', 'fees', 'stables', 'txcount'].every((k) => rh.history[k].every(([d]) => d >= rh.history.from && d <= rh.history.to)) && rh.history.to === '2026-10-25'
      && Array.isArray(rh.topTokens.rows) && typeof rh.topTokens.basis === 'string' && rh.newPools.length === 20 && rh.newPools.every((p) => ['v2', 'v3', 'v4'].includes(p.dex) && /^0x[0-9a-f]+$/.test(p.pool) && p.block > 9e7)
      && rh.pulse && rh.pulse.now.block === 98587507 && ['at', 'suppliesAt', 'bridgeAt'].every((k) => rh.pulse.now[k] > 1.7e12) && rh.pulse.poolsCreated.src === 'rpc' && rh.pulse.poolsCreated.h24.v4 === 4443 && rh.sources.some((s) => s.id === 'growthepie' && s.licence === 'CC BY 4.0'));
    let tokOk = true;
    for (const w of ['5m', '1h', '6h', '24h', 'custom']) {
      const j = FIX('tokens-robinhood-' + w + '.json');
      if (!(j.chain === 'robinhood' && j.network === 'robinhood' && typeof j.basis === 'string' && isWin(j.window, ['5m', '1h', '6h', '24h', 'custom']) && j.window.kind === w && Array.isArray(j.rows) && j.rows.length >= 20 && (w !== 'custom' || (j.coverage && DAY.test(j.coverage.from))))) tokOk = false;
      for (const r of j.rows) {
        if (!(r.chain === 'robinhood' && /^0x[0-9a-f]{40}$/.test(r.address) && 'symbol' in r && 'name' in r && 'logo' in r && Array.isArray(r.flags) && r.flags.every((f) => ['thin', 'wash', 'global-mcap'].includes(f)) && typeof r.scannable === 'boolean' && typeof r.liquidity.pools === 'number')) tokOk = false;
        if (r.logo != null && !/^\/api\/market\/logo\?u=https%3A%2F%2F(coin-images\.coingecko\.com|assets\.geckoterminal\.com)%2F/.test(r.logo)) tokOk = false;
        for (const k of ['priceUsd', 'mcap', 'fdv', 'liquidity', 'volume', 'change', 'txns24h']) isFig(r[k], 'tokens-' + w + ':' + r.symbol + '.' + k);
      }
    }
    const t24 = FIX('tokens-robinhood-24h.json').rows;
    check('  ...GET /api/market/tokens: { at, chain, network, basis, window, coverage? (custom), rows: [{ chain, address, symbol, name, logo, priceUsd, mcap, fdv, liquidity: { v, pools }, txns24h, flags, scannable, volume, change }], notes } — every figure an object, the trade count too', tokOk);
    check('  ...the measured traps are in them: FLOP/WETH flagged thin + wash, USDG\'s global market cap flagged, a GeckoTerminal market cap of null or 0 kept null with its reason, liquidity summed from the pools (PONS $69.8M, not its token-level $20k)',
      t24.find((r) => r.symbol === 'FLOP').flags.join() === 'thin,wash' && t24.find((r) => r.symbol === 'USDG').flags.includes('global-mcap')
      && t24.some((r) => r.mcap.v === null && /GeckoTerminal gives 0/.test(r.mcap.why || '')) && t24.some((r) => r.mcap.v === null && /no market cap/.test(r.mcap.why || ''))
      && t24.some((r) => r.symbol === 'PONS' && r.liquidity.v > 69e6));
    // every chain's list (chain=all) and Ethereum's: lib/marketdata.js's own answers, cut to fewer rows
    let allOk = true;
    for (const w of ['5m', '1h', '6h', '24h', 'custom']) {
      const j = FIX('tokens-all-' + w + '.json'), e = FIX('tokens-ethereum-' + w + '.json');
      if (!(j.chain === 'all' && j.network === null && typeof j.basis === 'string' && isWin(j.window, ['5m', '1h', '6h', '24h', 'custom']) && j.window.kind === w && j.at >= j.oldestAt && j.oldestAt > 1.7e12
        && Array.isArray(j.networks) && j.networks.map((n) => n.key).join() === MD.GT_TRACKED.join() && j.networks.every((n) => typeof n.name === 'string' && typeof n.pools === 'number' && typeof n.most === 'number' && typeof n.everyMs === 'number' && (n.pools > 0 ? n.at > 1.7e12 : n.at === null && /not been read yet/.test(n.why)))
        && j.rows.some((r) => r.chain === 'robinhood') && j.rows.some((r) => r.chain === 'ethereum') && j.notes.some((x) => /^Not read yet: Solana/.test(x)))) allOk = false;
      if (!(e.chain === 'ethereum' && e.network === 'eth' && e.rows.length > 5 && e.rows.every((r) => r.chain === 'ethereum' && !('chainName' in r)) && !('networks' in e))) allOk = false;
      for (const r of j.rows) {
        if (!(MD.GT_TRACKED.includes(r.chain) && r.chainName === MD.CHAIN_BY_KEY.get(r.chain).llama && /^\/api\/market\/logo\?u=https%3A%2F%2Ficons\.llamao\.fi%2Fchains%2F/.test(r.chainLogo || '') && Object.keys(r).slice(0, 4).join() === 'chain,chainName,chainLogo,address')) allOk = false;
        for (const k of ['priceUsd', 'mcap', 'fdv', 'liquidity', 'volume', 'change', 'txns24h']) isFig(r[k], 'tokens-all-' + w + ':' + r.chain + ':' + r.symbol + '.' + k);
      }
      for (const r of e.rows) for (const k of ['priceUsd', 'mcap', 'fdv', 'liquidity', 'volume', 'change', 'txns24h']) isFig(r[k], 'tokens-ethereum-' + w + ':' + r.symbol + '.' + k);
    }
    const all24 = FIX('tokens-all-24h.json').rows, allCus = FIX('tokens-all-custom.json');
    check('  ...GET /api/market/tokens?chain=all: { at (newest read), oldestAt, chain: "all", network: null, basis, window, networks: [{ key, name, network, logo, at, pools, most, everyMs, why? }] in the server\'s order, rows: [{ chain, chainName, chainLogo, …as above }], notes } — and Ethereum\'s own list beside it',
      allOk && all24.filter((r) => r.address === USDG).map((r) => r.chain).sort().join() === 'ethereum,robinhood'
      && allCus.networks.find((n) => n.key === 'robinhood').coverage.from === '2026-10-24' && allCus.rows.filter((r) => r.chain === 'ethereum').every((r) => r.volume.v === null && /^our history starts /.test(r.volume.why)));
    const send = FIX('token-robinhood-0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105.json');
    ['priceUsd', 'mcap', 'fdv', 'liquidity'].forEach((k) => isFig(send[k], 'token-send.' + k));
    check('  ...GET /api/market/token: { chain, address, network, symbol, name, logo, links, priceUsd, mcap, fdv, supplyBasis, liquidity, pools, windows (24h 6h 1h 5m: volume, change, txns — trades for 24 h only), at, basis, flags, scanner { supported, href }, candles { tf, pool, rows [ms,o,h,l,c,v], src } }',
      send.address === '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105' && send.symbol === 'SEND' && Array.isArray(send.links.websites) && Array.isArray(send.links.socials) && /dead address/.test(send.supplyBasis)
      && send.mcap.v === null && send.pools.length === 1 && ['5m', '1h', '6h', '24h'].every((k) => send.windows[k] && isFig(send.windows[k].volume, 'send.' + k) && isFig(send.windows[k].txns, 'send.txns.' + k)) && send.windows['24h'].txns.v === 11 && send.windows['1h'].txns.v === null
      && send.candles.rows.length > 30 && send.candles.rows.every((r) => r.length === 6 && r[0] > 1.7e12)
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
      const today = dayOf(Date.now()), cnow = await get('/api/market/tokens?chain=robinhood&window=custom&from=' + addDays(today, -3) + '&to=' + today);
      check('  ...a custom window echoes its whole UTC days and says what it cannot add up; a window backwards, or one that ends today, is refused in the server\'s own words (its parseWindow)', cc.status === 200 && cc.j.window.kind === 'custom' && cc.j.window.from === '2026-10-01' && cc.j.window.days === 25 && cc.j.rows.every((r) => r.volume.v === null && r.volume.why)
        && cbad.status === 400 && /from is after to/.test(cbad.j.error) && cnow.status === 400 && /whole UTC day that has ended/.test(cnow.j.error), cnow.status + ' ' + JSON.stringify(cnow.j));
      const tv = await get('/api/market/tokens?chain=robinhood'), tall = await get('/api/market/tokens?chain=robinhood&include=all'), tl = await get('/api/market/tokens?chain=robinhood&sort=liquidity&dir=asc');
      check('  ...the tokens: wash volume left out of "highest volume" unless include=all; lowest liquidity first when asked', tv.status === 200 && !tv.j.rows.some((r) => r.flags.includes('wash')) && tall.j.rows.some((r) => r.flags.includes('wash')) && tl.j.rows[0].liquidity.v <= tl.j.rows[1].liquidity.v);
      const nullsLast = (rows) => { const k = rows.findIndex((r) => r.volume.v == null); return k > 0 && rows.slice(k).every((r) => r.volume.v == null); };
      const ta = await get('/api/market/tokens?chain=all'), tcD = await get('/api/market/tokens?chain=all&window=custom&from=2026-10-24&to=2026-10-25'), tcA = await get('/api/market/tokens?chain=all&window=custom&from=2026-10-24&to=2026-10-25&dir=asc'), tb = await get('/api/market/tokens?chain=base');
      check('  ...every chain\'s list (chain=all): Robinhood Chain\'s and Ethereum\'s rows together, wash volume left out of "highest volume", a figure a chain has not got last both ways; a chain not read yet says so',
        ta.status === 200 && ta.j.chain === 'all' && ta.j.rows.some((r) => r.chain === 'ethereum') && ta.j.rows.some((r) => r.chain === 'robinhood') && !ta.j.rows.some((r) => r.flags.includes('wash'))
        && nullsLast(tcD.j.rows) && nullsLast(tcA.j.rows) && tcA.j.rows[0].volume.v <= tcA.j.rows[1].volume.v && tb.status === 200 && tb.j.rows.length === 0 && /not been read yet/.test(tb.j.why), JSON.stringify({ d: tcD.j.rows.map((r) => r.volume.v).slice(0, 40) }).slice(0, 300));
      const tm = await get('/api/market/tokens?chain=robinhood&sort=mcap');
      check('  ...a global (all-chains) market cap is kept out of a chain-local market-cap ranking', tm.j.rows.filter((r) => r.flags.includes('global-mcap')).every((r) => r.mcap.v === null));
      const d1 = await get('/api/market/chain?key=robinhood'), d7 = await get('/api/market/chain?key=robinhood&window=7d'), dx = await get('/api/market/chain?key=nowhere'), dg = await get('/api/market/chain?key=solana');
      check('  ...a chain in full; its 7-day volume added up from whole days; an unknown chain is a 404 that says so; a chain with no daily history read has empty series and names no source for them, never a 0',
        d1.status === 200 && d1.j.pulse && d7.j.window.kind === '7d' && d7.j.stats.windowVolume.v > d1.j.stats.volume24h.v && dx.status === 404 && /no chain/.test(dx.j.error) && dg.status === 200 && Array.isArray(dg.j.history.tvl) && dg.j.history.tvl.length === 0 && dg.j.history.src.tvl === null);
      const tk = await get('/api/market/token?chain=robinhood&address=0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105'), tn = await get('/api/market/token?chain=robinhood&address=0x' + '1'.repeat(40)), sc = await get('/api/market/scan?chain=robinhood&address=0x' + '1'.repeat(40));
      check('  ...a token in full; a token with no pool data is a 404; a scan that cannot be read says so (503, unavailable)', tk.status === 200 && tk.j.symbol === 'SEND' && tn.status === 404 && sc.status === 503 && sc.j.unavailable === true);
      const s1 = await get('/api/market/search?q=send'), s2 = await get('/api/market/search?q=base');
      check('  ...search: { q, chains: [{ key, name }], tokens: [{ chain, address, symbol, name, priceUsd, liquidity, volume24h, src }] }', s1.status === 200 && Array.isArray(s1.j.chains) && Array.isArray(s1.j.tokens) && s2.j.chains.some((c) => c.key === 'base' && c.name === 'Base')
        && s1.j.tokens.every((t) => t.chain && t.address && 'priceUsd' in t && 'liquidity' in t && 'volume24h' in t && t.src));
    } finally { fake.close(); }

    /* ═══ 6. the fixtures and the fake have the real server's shapes ═══ */
    const R = await realAnswers();
    const fa = (p) => { const [code, body] = fakeAnswer(new URL(p, 'http://x')); return code === 200 ? JSON.parse(JSON.stringify(body)) : { status: code, body }; };
    const pairs = [
      ...['24h', '7d', '30d', 'custom'].map((w) => ['chains-' + w + '.json', FIX('chains-' + w + '.json'), R.chains[w]]),
      ['chain-robinhood.json', FIX('chain-robinhood.json'), R.chain.robinhood], ['chain-base.json', FIX('chain-base.json'), R.chain.base],
      ...['24h', '6h', '1h', '5m', 'custom'].map((w) => ['tokens-robinhood-' + w + '.json', FIX('tokens-robinhood-' + w + '.json'), R.tokens[w]]),
      ...['24h', '6h', '1h', '5m', 'custom'].map((w) => ['tokens-all-' + w + '.json', FIX('tokens-all-' + w + '.json'), R.tokensAll[w]]),
      ...['24h', '6h', '1h', '5m', 'custom'].map((w) => ['tokens-ethereum-' + w + '.json', FIX('tokens-ethereum-' + w + '.json'), R.tokens[w]]),
      ...files.filter((f) => /^token-robinhood-/.test(f)).map((f) => [f, FIX(f), R.token]),
    ];
    const drift = pairs.map(([f, a, b]) => [f, shapeDiff(a, b)]).filter(([, d]) => d.length);
    check('every fixture has the shape lib/marketdata.js really serves, key for key (history as [day, value] arrays with history.src, a token\'s trades as windows[k].txns, the pulse with suppliesAt and bridgeAt)',
      !drift.length && R.chain.robinhood.history && Array.isArray(R.chain.robinhood.history.tvl) && R.chain.robinhood.pulse.now.suppliesAt > 0 && 'txns' in R.token.windows['24h'], drift.map(([f, d]) => f + ': ' + d.slice(0, 4).join('; ')).join(' | '));
    const today6 = dayOf(Date.now()), cw = '&window=custom&from=' + addDays(today6, -3) + '&to=' + addDays(today6, -1);
    FAKE.unavailable.add('0x' + '12'.repeat(20)); FAKE.searchWhy = 'Dexscreener could not be read (timed out)';
    const listTok = FIX('tokens-robinhood-24h.json').rows.find((r) => !existsSync(path.join(FIXDIR, 'token-robinhood-' + r.address + '.json')));
    const fakes = [
      ['a chain with no history', fa('/api/market/chain?key=solana'), R.chain.solana],
      ['a token built from the list', fa('/api/market/token?chain=robinhood&address=' + listTok.address), R.token],
      ['a token built from Ethereum\'s list', fa('/api/market/token?chain=ethereum&address=' + USDG), R.token],
      ['every chain\'s list, sorted by the fake', fa('/api/market/tokens?chain=all&sort=liquidity&dir=asc'), R.tokensAll['24h']],
      ['a custom window on a token', fa('/api/market/token?chain=robinhood&address=' + USDG + cw), R.tokenCustom],
      ['a token GeckoTerminal could not be asked about', fa('/api/market/token?chain=robinhood&address=0x' + '12'.repeat(20)), R.unavailable],
      ['a search with Dexscreener down', fa('/api/market/search?q=zzzz'), R.searchDown],
    ];
    FAKE.unavailable.clear(); FAKE.searchWhy = null;
    fakes.push(['a search', fa('/api/market/search?q=send'), R.search]);
    const fdrift = fakes.map(([n, a, b]) => [n, shapeDiff(a, b)]).filter(([, d]) => d.length);
    check('  ...and so does every answer the fake builds for itself (a chain with no history, a token from the list, a custom window, an unavailable token, a search with Dexscreener down)', !fdrift.length && R.unavailable.unavailable === true && typeof R.searchDown.why === 'string',
      fdrift.map(([n, d]) => n + ': ' + d.slice(0, 4).join('; ')).join(' | '));
    check('  ...market.js knows which chains the server reads a token on, and which the Scanner reads, from the server\'s own lists',
      new RegExp("const READS = \\[" + MD.GT_TRACKED.map((k) => "'" + k + "'").join(', ') + "\\];").test(code) && new RegExp("const SCANS = \\[" + MD.SCAN_CHAINS.map((k) => "'" + k + "'").join(', ') + "\\];").test(code));

    /* ═══ 7. the page in a real browser ═══ */
    await browserWalk();

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
  for (const n of notes) console.log('  · ' + n);
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) process.exitCode = 1;
}
