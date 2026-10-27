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
   6. The fixtures and the fake's own answers have the shapes lib/marketdata.js really serves: its answers are built here
      from a database of this suite's own, and every key and kind is compared (the fixtures once had { src, rows } series,
      buys / sells and no pulse times, so the page passed here and lost its sources on the real server).
   7. The page in a real browser — headless Chrome, muted — on the fake, at 320, 390, 1280 and 1920 px: no sideways scroll,
      nothing under the text floor, and the honesty rules where they are easy to break (a failed read is a failure with its
      reason and a Try again, never "none listed"; a reserve of 0 and a missing price are never $0; each pulse reading keeps
      its own time; a custom window ends on a whole day; Back and Forward restore the view in the address bar).
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
const FAKE = { log: [], unavailable: new Set(), zeroReserve: false, candleGaps: false, customNoCandles: false, searchWhy: null, searchExtra: null, pulse: null };
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
    if (!row || !row.gtNetwork) return [200, { at: null, chain, network: null, basis: null, window: pw.w, rows: [], why: 'this site reads the pools of ' + MD.GT_TRACKED.map((k) => MD.CHAIN_BY_KEY.get(k).llama).join(', ') + ' only' }];
    if (chain !== 'robinhood') return [200, { at: null, chain, network: row.gtNetwork, basis: null, window: pw.w, rows: [], why: 'this chain\'s pools have not been read yet' }];
    const j = FIX('tokens-robinhood-' + win + '.json');
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
    if (!j && chain === 'robinhood') {
      const r = FIX('tokens-robinhood-24h.json').rows.find((x) => x.address === addr);
      if (r) {
        const win = (k) => { const w = FIX('tokens-robinhood-' + k + '.json').rows.find((x) => x.address === addr);
          return { volume: w ? w.volume : none('not in our snapshot', 'geckoterminal', r.priceUsd.at), change: w ? w.change : none('not in our snapshot', 'geckoterminal', r.priceUsd.at),
            txns: k === '24h' ? r.txns24h : none('GeckoTerminal\'s trade counts are kept for 24 h only here', 'geckoterminal', r.priceUsd.at) }; };
        j = { chain, address: addr, network: 'robinhood', symbol: r.symbol, name: r.name, logo: r.logo, links: { websites: [], socials: [], src: 'dexscreener' }, priceUsd: r.priceUsd, mcap: r.mcap, fdv: r.fdv,
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
  async function go(p, width) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
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
      finally { Object.assign(FAKE, { pulse: null, zeroReserve: false, candleGaps: false, customNoCandles: false, searchWhy: null, searchExtra: null }); FAKE.unavailable.clear(); }
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
