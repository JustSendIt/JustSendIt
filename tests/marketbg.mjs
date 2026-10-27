/* ===== Market Data's background jobs, honest (2026-10-26) ==================================================================
   The owner asked that the token scanner and the New Pairs radar "constantly cache data about everything on every chain", so the
   radar sweep and the hourly re-scan run on Market Data's timer by default. Unattended, they must read as the site itself and stand
   aside for it. What this suite holds them to, driven against fakes of every source (a guard in the server refuses, and records,
   anything that tries to leave this machine):
     (a) neither reads robinhoodchain.blockscout.com (no BLOCKSCOUT_URL here, so the explorer is the public one);
     (b) every outbound call they make carries the honest User-Agent — Dexscreener, GoPlus, the Ethereum node;
     (c) the re-scan takes GoPlus only from a share of its own, and keeps no reading made without it;
     (d) the node is read through Market Data's chain share, asked only while the site's own reads are not waiting — checked before
         every read, not once a run — and a refused read stands the background down without making the site's own reads give way;
     (e) neither counts as a token view (token_cache.reads) or a public scan;
     (f) no holder ledger is walked for the re-scanned tokens.
   Also: the jobs run when MARKET_JOBS names nothing; the radar's background rows carry no verdict; a member who opens the radar while
   the background walk holds it is told it is being built, and their sweep runs as the walk ends; the re-scan's note tells a reading it
   made from one it copied; the docs say what the jobs read; the backup scrub runs off the event loop and leaves Market Data's bulk
   history out of the copy; the logo proxy goes by the canonical URL and meters its misses. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { ROOT, SERVER_JS } from './_paths.mjs';
const require = createRequire(import.meta.url);
const MD = require(path.join(ROOT, 'lib', 'marketdata.js'));

const SRC = fs.readFileSync(SERVER_JS, 'utf8');
const MCFIX = (f) => fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'multichain', f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const brief = (o) => JSON.stringify(o).slice(0, 400);
const HONEST = MD.HONEST_UA;
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73', USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const FACTORY = MD.RH.v2Factory, PAIRCREATED = MD.RH.v2Topic;
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const A = (h) => '0x' + h.repeat(20);
const TOKA = A('a1'), TOKB = A('b2'), TOKC = A('c3'), P1 = A('d1'), P2 = A('d2'), P3 = A('d3'), P4 = A('d4');
const RA = A('e1'), RA2 = A('e2'), RB = A('e3'), RC = A('e4'), PAIR_RA = A('f1');
const PEPE = '0x6982508145454ce325ddbe47a25d4ec3d2311933', XTOK = A('7a');
const HEAD = 100000000;
const w256 = (hex) => String(hex).replace(/^0x/, '').padStart(64, '0');
const abiStr = (s) => '0x' + w256('20') + w256(s.length.toString(16)) + Buffer.from(s).toString('hex').padEnd(64, '0');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('0000000d49484452', 'hex'), randomBytes(40)]);

/* ═══ 1. THE BACKUP SCRUB: Market Data's bulk history out of the copy, the work off the event loop ═══
   The scrub's own functions, from server.js (BACKUP_SCRUB, scrubBackup, scrubBackups, scrubCopy, scrubOffThread), on real files. */
const tmpS = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-mktbg-scrub-'));
try {
  const scrubSrc = SRC.slice(SRC.indexOf('const BACKUP_SCRUB = ['), SRC.indexOf('// which dated backups stay'));
  const S = new Function('require', 'DatabaseSync', 'path', 'fs', 'console', 'BACKUP_DIR', scrubSrc + '\nreturn { scrubBackup, scrubOffThread };')(require, DatabaseSync, path, fs, { error() {} }, tmpS);
  const DAY = 864e5, D0 = Date.parse('2026-10-20T00:00:00Z');
  const build = (f) => {
    const d = new DatabaseSync(f);
    MD.migrate(d);
    d.exec("CREATE TABLE sessions (token TEXT); INSERT INTO sessions VALUES ('t');");
    const ins = d.prepare('INSERT INTO mkt_pool_snap (network, pool, at, rank, base_addr, base_symbol, base_name, base_logo, dex, name, price_usd, reserve_usd, vol_h24) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    d.exec('BEGIN');
    // three networks, four days, a batch every hour, 300 pools a batch: the shape of the pools history, smaller
    for (const net of ['robinhood', 'eth', 'base']) for (let day = 0; day < 4; day++) for (let h = 0; h < 24; h++) {
      const at = D0 + day * DAY + h * 3600e3 + 7000;
      for (let r = 0; r < 300; r++) ins.run(net, '0x' + createHash('sha1').update(net + day + h + r).digest('hex').slice(0, 40), at, r + 1, '0x' + r.toString(16).padStart(40, '0'), 'SYM' + r, 'A token named ' + r + ' with a long name for size', 'https://assets.geckoterminal.com/' + 'x'.repeat(28), 'uniswap_v2', 'SYM' + r + ' / WETH', r * 0.001, r * 1000, r * 77);
    }
    const ch = d.prepare('INSERT INTO mkt_chain_snap (chain, name, at, tvl) VALUES (?,?,?,?)');
    for (const c of ['robinhood', 'ethereum']) for (let day = 0; day < 3; day++) for (let k = 0; k < 4; k++) ch.run(c, c, D0 + day * DAY + k * 6 * 3600e3, day * 10 + k);
    for (let i = 0; i < 50; i++) d.prepare('INSERT INTO mkt_new_pool (chain, pool, first_seen) VALUES (?,?,?)').run('eth', A(i.toString(16).padStart(2, '0')), D0 + i);
    for (let i = 0; i < 50; i++) d.prepare('INSERT INTO mkt_runs (job, at, ok, ms, calls) VALUES (?,?,?,?,?)').run('pulse', D0 + i, 1, 5, 1);
    for (const [n, v] of [['rh_newpools', { cursor: 5 }], ['radar', { cursor: 9 }], ['prune', { pool7: 1 }]]) d.prepare('INSERT INTO mkt_state (name, value, at) VALUES (?,?,?)').run(n, JSON.stringify(v), D0);
    d.prepare("INSERT INTO mkt_scan (chain, address, at, src, symbol) VALUES ('robinhood', ?, ?, 'scan', 'KEEP')").run(TOKA, D0);
    d.prepare('INSERT INTO mkt_radar (pair, token, updated_at) VALUES (?,?,?)').run(P1, TOKA, D0);
    d.exec('COMMIT');
    d.close();
  };
  const f1 = path.join(tmpS, 'copy-thread.db'), f2 = path.join(tmpS, 'copy-sync.db');
  build(f1); fs.copyFileSync(f1, f2);
  const sizeBefore = fs.statSync(f1).size;
  // how long the event loop is held: the largest gap between 5 ms ticks while the scrub runs
  const lag = () => { let last = performance.now(), max = 0; const t = setInterval(() => { const n = performance.now(); max = Math.max(max, n - last); last = n; }, 5); return () => { clearInterval(t); return Math.round(Math.max(max, performance.now() - last)); }; };
  let stop = lag(); const t0 = performance.now();
  const okThread = await S.scrubOffThread('scrubCopy', f1);
  const threadMs = Math.round(performance.now() - t0), threadGap = stop();
  stop = lag(); const t1 = performance.now();
  const okSync = S.scrubBackup(f2);
  const syncMs = Math.round(performance.now() - t1), syncGap = stop();
  check('the scrub of a copy runs on a thread of its own: the event loop keeps ticking while it works (the same scrub run inline holds it for its whole length)',
    okThread === true && okSync === true && syncMs >= 80 && syncGap >= syncMs * 0.8 && threadGap < Math.max(40, syncMs / 3) && threadMs >= syncMs * 0.4, brief({ threadMs, threadGap, syncMs, syncGap }));
  const d = new DatabaseSync(f1, { readOnly: true });
  const q = (sql, ...a) => d.prepare(sql).get(...a);
  const pools = q('SELECT COUNT(*) n FROM mkt_pool_snap').n, firsts = q('SELECT COUNT(*) n FROM (SELECT network, at / 86400000 day, COUNT(DISTINCT at) batches FROM mkt_pool_snap GROUP BY network, day) WHERE batches = 1').n;
  const firstAt = q("SELECT MIN(at) m FROM mkt_pool_snap WHERE network = 'eth'").m, chains = d.prepare('SELECT chain, tvl FROM mkt_chain_snap ORDER BY chain, at').all();
  const left = { pools, firsts, firstAt, chains: chains.length, chainTvl: chains.map((c) => c.tvl).join(), newPools: q('SELECT COUNT(*) n FROM mkt_new_pool').n, runs: q('SELECT COUNT(*) n FROM mkt_runs').n,
    state: d.prepare('SELECT name FROM mkt_state ORDER BY name').all().map((r) => r.name).join(), scan: q('SELECT COUNT(*) n FROM mkt_scan').n, radar: q('SELECT COUNT(*) n FROM mkt_radar').n, sessions: q('SELECT COUNT(*) n FROM sessions').n,
    marked: !!q("SELECT 1 x FROM sqlite_master WHERE name = '_jsi_scrubbed'") };
  d.close();
  const sizeAfter = fs.statSync(f1).size;
  check('  ...and the copy keeps none of Market Data\'s bulk history: of the pools, each network\'s first batch of a UTC day; of the chains, each one\'s last row of a day; no new-pool feed, its cursor or the run log — the scans, the radar and the rest stay, and the old scrub still applies',
    pools === 3 * 4 * 300 && firsts === 12 && firstAt === D0 + 7000 && left.chains === 6 && left.chainTvl === '3,13,23,3,13,23' && left.newPools === 0 && left.runs === 0 && left.state === 'prune,radar'
    && left.scan === 1 && left.radar === 1 && left.sessions === 0 && left.marked && sizeAfter < sizeBefore / 4, brief({ left, sizeBefore, sizeAfter }));
  const bad = path.join(tmpS, 'not-a-db.db'); fs.writeFileSync(bad, randomBytes(4096));
  let refused = null; try { await S.scrubOffThread('scrubCopy', bad); } catch (e) { refused = e.message; }
  const daily = path.join(tmpS, 'app-2026-10-01.db'); build(daily);
  await S.scrubOffThread('scrubBackups');
  const dd = new DatabaseSync(daily, { readOnly: true }); const dailyLeft = { marked: !!dd.prepare("SELECT 1 x FROM sqlite_master WHERE name = '_jsi_scrubbed'").get(), newPools: dd.prepare('SELECT COUNT(*) n FROM mkt_new_pool').get().n }; dd.close();
  check('  ...a copy the thread could not scrub is refused (so the snapshot is not kept), and the folder\'s older copies are scrubbed there too', /could not be scrubbed/.test(String(refused)) && dailyLeft.marked && dailyLeft.newPools === 0, brief({ refused, dailyLeft }));
  const snap = SRC.slice(SRC.indexOf('async function snapshotDbNow() {'), SRC.indexOf('const backupTimer = setInterval'));
  check('  ...and the snapshot scrubs through the thread only: the fresh copy, the folder before and after (no scrub left inline on the event loop)',
    /await scrubOffThread\('scrubCopy', tmp\);/.test(snap) && (snap.match(/await scrubOffThread\('scrubBackups'\)/g) || []).length === 2 && !/\bscrubBackups?\(/.test(snap));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join(' | '));
  check('part 1 ran to the end', false, e.message);
} finally { try { fs.rmSync(tmpS, { recursive: true, force: true }); } catch {} }

/* ═══ 2. THE DOCS: the Data API page says what the two jobs read, and what their rows hold ═══ */
{
  const DOC = fs.readFileSync(path.join(ROOT, 'public', 'data.html'), 'utf8');
  const rowOf = (name) => (DOC.match(new RegExp('<tr><td>' + name + '</td><td>([^<]*)</td>')) || [])[1] || '';
  const radarRes = (DOC.match(/<summary><code>radar<\/code>[\s\S]*?<\/details>/) || [''])[0];
  const scans = rowOf('Scans'), radar = rowOf('Radar');
  check('the docs: the re-scan reads Ethereum and Solana again but nothing on Robinhood Chain (the token cache\'s reading from the last hour is kept, or the token skipped); the radar\'s timer sweep reads the new pairs and their market figures and judges nothing',
    /On Ethereum and Solana, read again the way the Scanner reads them/.test(scans) && /On Robinhood Chain nothing is read: the token cache’s own reading is kept when it is under an hour old/.test(scans) && /the token is skipped otherwise/.test(scans)
    && /new pairs/.test(radar) && /market figures from Dexscreener/.test(radar) && /It judges nothing: health, verdict and risk come from a member’s sweep/.test(radar), brief({ scans, radar }));
  check('  ...and the radar resource says a row the timer\'s sweep wrote has no health, verdict, risk or profile — not "latest price, liquidity, risk and verdict" as if every row had them',
    /health\|null, verdict\|null, risk\|null, json\|null/.test(radarRes) && /on a row it wrote, <code>health<\/code>, <code>verdict<\/code>, <code>risk<\/code> and <code>json<\/code> are <code>null<\/code>/.test(radarRes)
    && !/latest price, liquidity, risk and verdict/.test(DOC) && !/with their latest price, liquidity and risk\./.test(DOC), brief(radarRes.slice(0, 300)));
}

/* ═══ 3. THE JOBS, IN A SERVER OF THEIR OWN ═══ */
// the Robinhood Chain node: every request recorded (one call or a batch, and who asked)
const node = { reqs: [], mode: 'ok', hold: null };
const hx = (n) => '0x' + n.toString(16);
const pairLog = (pair, t0, t1, block) => ({ address: FACTORY, blockNumber: hx(block), topics: [PAIRCREATED, '0x' + w256(t0), '0x' + w256(t1)], data: '0x' + w256(pair) + w256('5') });
const LOGS = [pairLog(P4, WETH, USDG, HEAD - 400), pairLog(P1, TOKA, WETH, HEAD - 300), pairLog(P2, TOKB, WETH, HEAD - 200), pairLog(P3, WETH, TOKC, HEAD - 100)];
function nodeAnswer(m, p) {
  const a0 = p && p[0];
  if (m === 'eth_blockNumber') return { result: hx(HEAD) };
  if (m === 'eth_getBlockByNumber') return { result: { number: hx(HEAD), timestamp: hx(Math.floor(Date.now() / 1000)), baseFeePerGas: '0x1' } };
  if (m === 'eth_getLogs') {
    if (String(a0.address).toLowerCase() !== FACTORY || !Array.isArray(a0.topics) || a0.topics[0] !== PAIRCREATED) return { result: [] };
    const from = parseInt(a0.fromBlock, 16), to = parseInt(a0.toBlock, 16);
    return { result: LOGS.filter((l) => { const b = parseInt(l.blockNumber, 16); return b >= from && b <= to; }) };
  }
  if (m === 'eth_call' && String(a0.to).toLowerCase() === TOKC) return { result: a0.data === '0x06fdde03' ? abiStr('Token C') : a0.data === '0x95d89b41' ? abiStr('TOKC') : '0x' };
  if (m === 'eth_call' || m === 'eth_getCode' || m === 'eth_getBalance' || m === 'eth_gasPrice') return { result: '0x' };
  return { error: { code: -32601, message: 'not served by this fake' } };
}
const nodeSrv = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    let j = null; try { j = JSON.parse(body); } catch {}
    const single = !Array.isArray(j), calls = single ? (j ? [[j.method, j.params]] : []) : j.map((c) => [c.method, c.params]);
    const rec = { single, calls, ua: String(req.headers['user-agent'] || ''), at: Date.now() };
    node.reqs.push(rec);
    const out = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (single && j) {
      /* the refusal run: the node refuses the radar's log read; the busy run: it holds the head-block read, and refuses the site's own eth_call;
         the hold run: it only holds the head-block read */
      if (node.mode === 'refuse' && j.method === 'eth_getLogs' && String(j.params[0].address).toLowerCase() === FACTORY) return out(429, { error: 'Too Many Requests' });
      if (node.mode === 'busy' && j.method === 'eth_call') return out(429, { error: 'Too Many Requests' });
      if ((node.mode === 'busy' || node.mode === 'hold') && j.method === 'eth_blockNumber' && node.hold) { const h = node.hold; node.hold = null; h(rec); await sleep(1500); }
      const r = nodeAnswer(j.method, j.params);
      return out(200, r.error ? { jsonrpc: '2.0', id: j.id, error: r.error } : { jsonrpc: '2.0', id: j.id, result: r.result });
    }
    if (!j) return out(200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    out(200, j.map((c) => { const r = nodeAnswer(c.method, c.params); return r.error ? { jsonrpc: '2.0', id: c.id, error: r.error } : { jsonrpc: '2.0', id: c.id, result: r.result }; }));
  });
});
await new Promise((ok) => nodeSrv.listen(0, '127.0.0.1', ok));
nodeSrv.unref();
const NODE = 'http://127.0.0.1:' + nodeSrv.address().port + '/';

// the vendors: Dexscreener (the radar's, and the Scanner's Ethereum reads), GoPlus, the Ethereum node, the logo CDNs
const vreqs = [];
const NOW0 = Date.now();
const DS_RADAR = [
  { chainId: 'robinhood', pairAddress: P1.toUpperCase().replace('0X', '0x'), baseToken: { address: TOKA, name: 'Token A', symbol: 'TOKA' }, quoteToken: { address: WETH, name: 'Wrapped Ether', symbol: 'WETH' },
    priceUsd: '0.0123', liquidity: { usd: 4567 }, fdv: 12300, marketCap: 12000, volume: { h24: 890 }, pairCreatedAt: NOW0 - 3600e3 },
  // a pool Dexscreener lists the other way round: its price and caps are WETH's, not this token's
  { chainId: 'robinhood', pairAddress: P2, baseToken: { address: WETH, name: 'Wrapped Ether', symbol: 'WETH' }, quoteToken: { address: TOKB, name: 'Token B', symbol: 'TOKB' },
    priceUsd: '3900', liquidity: { usd: 2222 }, fdv: 1e9, marketCap: 1e9, volume: { h24: 55 }, pairCreatedAt: NOW0 - 1800e3 },
];
const asX = (txt) => txt.replace(/0x6982508145454ce325ddbe47a25d4ec3d2311933/gi, XTOK);
const vendor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    vreqs.push({ method: req.method, path: p, search: u.search, ua: String(req.headers['user-agent'] || '') });
    const send = (code, o, ct) => { res.writeHead(code, { 'Content-Type': ct || 'application/json' }); res.end(Buffer.isBuffer(o) || typeof o === 'string' ? o : JSON.stringify(o)); };
    if (p.startsWith('/ds/tokens/v1/robinhood/')) { const want = p.split('/').pop().toLowerCase().split(','); return send(200, DS_RADAR.filter((d) => want.includes(d.baseToken.address) || want.includes(d.quoteToken.address))); }
    if (p.startsWith('/mc/ds/token-pairs/v1/ethereum/')) { const a = p.split('/').pop().toLowerCase(); return send(200, a === PEPE ? MCFIX('ds-token-pairs-ethereum-pepe.json') : a === XTOK ? asX(MCFIX('ds-token-pairs-ethereum-pepe.json')) : '[]'); }
    if (p.startsWith('/mc/ds/latest/dex/pairs/')) return send(200, { schemaVersion: '1.0.0', pairs: null });
    if (p === '/mc/gp/token_security/1') { const a = (u.searchParams.get('contract_addresses') || '').toLowerCase(); return send(200, a === PEPE ? MCFIX('goplus-ethereum-pepe.json') : a === XTOK ? asX(MCFIX('goplus-ethereum-pepe.json')) : { code: 1, message: 'OK', result: {} }); }
    if (p === '/mc/ethnode') {
      let arr = null; try { arr = JSON.parse(body); } catch {}
      if (!Array.isArray(arr)) return send(200, { jsonrpc: '2.0', id: (arr && arr.id) || 1, result: '0x' });
      return send(200, arr.map((c) => { const to = String((c.params && c.params[0] && c.params[0].to) || '').toLowerCase(), data = (c.params && c.params[0] && c.params[0].data) || '';
        const known = to === PEPE || to === XTOK;
        const r = !known ? '0x' : data === '0x06fdde03' ? abiStr(to === PEPE ? 'Pepe' : 'Xcoin') : data === '0x95d89b41' ? abiStr(to === PEPE ? 'PEPE' : 'XCN') : data === '0x313ce567' ? '0x' + w256('12') : data === '0x18160ddd' ? '0x' + w256('ffffffffffff') : '0x';
        return { jsonrpc: '2.0', id: c.id, result: r }; }));
    }
    if (p === '/img/cms/images/abc' || p === '/img/coins/images/7/large/y.png') return send(200, PNG, 'image/png');
    send(404, { error: 'not here: ' + p });
  });
});
await new Promise((ok) => vendor.listen(0, '127.0.0.1', ok));
vendor.unref();
const V = 'http://127.0.0.1:' + vendor.address().port, vHost = '127.0.0.1:' + vendor.address().port;

const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
let PORT = await freePort(); if (PORT === 8642) PORT = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-mktbg-'));
fs.writeFileSync(path.join(dataDir, '.data_key'), randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
/* the guard: loaded before server.js, it refuses every fetch that would leave this machine and writes one line saying where it was
   going and as whom — so nothing here reaches a real vendor, and an attempt to is seen */
const GUARD = path.join(dataDir, 'netguard.mjs');
fs.writeFileSync(GUARD, `const real = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  let host = ''; try { host = new URL(url).hostname; } catch {}
  if (host === '127.0.0.1' || host === 'localhost') return real.call(this, input, init);
  const h = (init && init.headers) || {};
  const ua = typeof h.get === 'function' ? h.get('user-agent') : (h['User-Agent'] || h['user-agent'] || null);
  process.stderr.write('NETGUARD ' + JSON.stringify({ url, ua, stack: String(new Error().stack).split('\\n').slice(2, 7).map((s) => s.trim()).join(' < ') }) + '\\n');
  throw new TypeError('fetch failed');
};
`);
const DEAD = 'http://127.0.0.1:9/';
const ADMIN_ID = 515151;
const baseEnv = { ...process.env, PORT: String(PORT), JSI_DATA_DIR: dataDir, DATA_DIR: dataDir, BASE_URL: 'http://localhost:' + PORT, NODE_ENV: 'test',
  SEED_INVITE_CODE: '12345', TOS_GATE: '1', TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback', SEED_CODES_OPEN: '1', ADMIN_USER_IDS: String(ADMIN_ID),
  DATA_KEY: '', DATA_KEY_FILE: '', BACKUP_DIR: path.join(dataDir, 'backups'), KEY_ROTATE_EXTRA_DBS: '',
  BLOCKSCOUT_URL: '',   // no keyed explorer: BLOCKSCOUT is robinhoodchain.blockscout.com, which the guard would catch
  RPC_URL: NODE, CHART_SRC_DS_URL: DEAD, CHART_SRC_GT_URL: DEAD, TOKSEARCH_GT_URL: DEAD, TOKSEARCH_DS_URL: DEAD, ETHUSD_URL: DEAD, STOCK_QUOTE: '0',
  MC_DEXSCREENER_URL: V + '/mc/ds', MC_GECKO_URL: DEAD, MC_GOPLUS_URL: V + '/mc/gp', ETH_RPC_URL: V + '/mc/ethnode', SOL_RPC_URL: DEAD, JUPITER_URL: DEAD,
  MARKET_LLAMA_URL: DEAD, MARKET_LLAMA_COINS_URL: DEAD, MARKET_LLAMA_STABLES_URL: DEAD, MARKET_L2BEAT_URL: DEAD, MARKET_GROWTHEPIE_URL: DEAD, MARKET_GROWTHEPIE_METRICS_URL: DEAD,
  MARKET_GT_URL: DEAD, MARKET_DS_URL: V + '/ds', MARKET_CG_URL: DEAD, MARKET_ETH_RPC_URL: DEAD, MARKET_LOGO_ORIGIN: V + '/img',
  MARKET_COLLECT: '1', MARKET_JOBS: '', MARKET_STAGGER_MS: '20',
  OUTBOUND_MAX_WAIT_MS: '1500', OUTBOUND_RPM_MARKET_GOPLUS: '1', OUTBOUND_RPM_MARKET_LOGO: '66', ['OUTBOUND_RPM_' + vHost.replace(/[^A-Z0-9]/gi, '_')]: '6000' };
let server = null, slog = '';
const B = 'http://localhost:' + PORT;
async function boot(extra) {
  slog = '';
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', pathToFileURL(GUARD).href, 'server.js'], { cwd: ROOT, env: Object.assign({}, baseEnv, extra || {}), stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
  for (let i = 0; i < 150; i++) { try { if ((await fetch(B + '/healthz')).ok) return true; } catch {} await sleep(200); }
  return false;
}
async function halt() { if (!server) return; const s = server; server = null; const done = new Promise((r) => s.once('exit', r)); try { s.kill('SIGTERM'); } catch {} await Promise.race([done, sleep(5000)]); }
async function api(p, o = {}) {
  const r = await fetch(B + p, { headers: Object.assign({}, o.sid ? { Cookie: 'sid=' + o.sid } : {}, o.ip ? { 'X-Forwarded-For': o.ip } : {}) });
  const buf = Buffer.from(await r.arrayBuffer()); let j = null; try { j = JSON.parse(buf.toString('utf8')); } catch {}
  return { status: r.status, j, buf };
}
const guarded = () => slog.split('\n').filter((l) => l.startsWith('NETGUARD ')).map((l) => { try { return JSON.parse(l.slice(9)); } catch { return { url: l }; } });
const dbPath = path.join(dataDir, 'app.db');
let sdb = null;
const waitRun = async (jobs, ms = 25000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const rows = jobs.map((j) => sdb.prepare('SELECT ok, calls, note FROM mkt_runs WHERE job = ? ORDER BY id DESC LIMIT 1').get(j));
    if (rows.every(Boolean)) return Object.fromEntries(jobs.map((j, i) => [j, rows[i]]));
    await sleep(150);
  }
  return Object.fromEntries(jobs.map((j) => [j, sdb.prepare('SELECT ok, calls, note FROM mkt_runs WHERE job = ? ORDER BY id DESC LIMIT 1').get(j) || null]));
};
const radarNodeReqs = () => node.reqs.filter((r) => r.single && r.calls.some(([m, p]) => m === 'eth_getLogs' && String(p[0].address).toLowerCase() === FACTORY));

try {
  /* ── boot 1: the schema, and the state the jobs find ── */
  check('the server came up (collectors off) to make its database', await boot({ MARKET_COLLECT: '0' }), slog.slice(-300));
  sdb = new DatabaseSync(dbPath); sdb.exec('PRAGMA busy_timeout = 5000');
  const t = Date.now();
  // the official communities exist, so the boot's seeding reads nothing from the network
  const sys = Number(sdb.prepare("INSERT INTO users (username, auto_named, created_at, system, bio, avatar) VALUES ('JustSendIt', 0, ?, 1, 'site', '🚀')").run(t).lastInsertRowid);
  for (const [k, a] of [['SEND', '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105'], ['GWC', '0x61339f11384dde4b2dc3a33e75b4dc23cc620f22']])
    sdb.prepare("INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, status, official, founder_paid, went_live_at, created_at) VALUES (?,?,?,?,?,'live',1,1,?,?)").run(sys, a, A('99'), k, k, t, t);
  sdb.prepare('INSERT INTO users (id, username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?,?)').run(ADMIN_ID, '__mktbg_admin__', t, '🧪', t, 'ok');
  const adminSid = 'tok_mktbg_' + randomBytes(8).toString('hex');
  sdb.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(adminSid).digest('hex'), ADMIN_ID, t, t + 864e5);
  // the token cache's rows for the home chain's most-scanned tokens (checked_at ahead, so the cache's own refresher leaves them be)
  const profile = (addr, sym, price) => JSON.stringify({ token: { address: addr, symbol: sym, name: 'Token ' + sym, decimals: 18 }, pair: { address: PAIR_RA, quoteSymbol: 'WETH', createdAt: t - 864e5 },
    market: { priceUsd: price, liquidityUsd: 10000, fdv: 2e6, marketCap: 1.9e6 }, volume: { m5: 0, h1: 10, h6: 50, h24: 300 }, txns: { h1: { buys: 2, sells: 1 }, h6: { buys: 5, sells: 4 }, h24: { buys: 9, sells: 8 } },
    priceChange: { h1: 1, h6: 2, h24: 3 }, holders: { count: 120, topHolderPct: 12, top10Pct: 40, top: [] }, indexed: true, risk: { health: 80, triage: 'ok' } });
  const tcIns = sdb.prepare('INSERT INTO token_cache (token_addr, pair_json, symbol, name, found, updated_at, last_read_at, reads, checked_at) VALUES (?,?,?,?,1,?,?,?,?)');
  const RA_AT = t - 10 * 60e3, RA2_AT = t - 20 * 60e3, RB_AT = t - 2 * 3600e3, READ_AT = t - 3 * 864e5;
  tcIns.run(RA, profile(RA, 'RAA', 1.5), 'RAA', 'Token RAA', RA_AT, READ_AT, 5, t + 2 * 3600e3);
  tcIns.run(RA2, profile(RA2, 'RAB', 2.5), 'RAB', 'Token RAB', RA2_AT, READ_AT, 6, t + 2 * 3600e3);
  tcIns.run(RB, profile(RB, 'RBB', 3.5), 'RBB', 'Token RBB', RB_AT, READ_AT, 7, t + 2 * 3600e3);
  // what people scanned in the last 7 days (Market Data's own store), the most first: PEPE, then XTOK, then the home chain's
  const scanIns = sdb.prepare("INSERT INTO mkt_scan (chain, address, at, read_at, src, n, symbol) VALUES (?,?,?,?,'scan',?,?)");
  scanIns.run('ethereum', PEPE, t - 3600e3, t - 3600e3, 9, 'PEPE'); scanIns.run('ethereum', XTOK, t - 3600e3, t - 3600e3, 8, 'XCN');
  scanIns.run('robinhood', RA, t - 3 * 3600e3, t - 3 * 3600e3, 7, 'RAA'); scanIns.run('robinhood', RA2, RA2_AT, RA2_AT, 6, 'RAB');
  scanIns.run('robinhood', RB, t - 3 * 3600e3, t - 3 * 3600e3, 5, 'RBB'); scanIns.run('robinhood', RC, t - 3 * 3600e3, t - 3 * 3600e3, 4, 'RCC');
  // a radar row a member's sweep judged earlier
  sdb.prepare("INSERT INTO mkt_radar (pair, token, token0, token1, symbol, name, created_block, price_usd, health, verdict, risk, json, first_seen, updated_at) VALUES (?,?,?,?,'TOKA','Token A',?,0.01,90,'ok','[]','{\"judged\":true}',?,?)").run(P1, TOKA, TOKA, WETH, HEAD - 300, t - 3600e3, t - 3600e3);
  const scansBefore = sdb.prepare('SELECT COUNT(*) n, COALESCE(SUM(count), 0) c FROM scans').get();
  const tcBefore = sdb.prepare('SELECT COUNT(*) n FROM token_cache').get().n;
  await halt();

  /* ── boot 2: every job on its default timetable (MARKET_JOBS names none) ── */
  node.reqs.length = 0; vreqs.length = 0;
  check('the server came up with the collectors on and MARKET_JOBS empty', await boot(), slog.slice(-300));
  const runs = await waitRun(['radar', 'scans']);
  const st = (await api('/api/market/status')).j;
  const stOf = (j) => ((st && st.collectors) || []).find((c) => c.job === j) || {};
  check('with MARKET_JOBS empty every collector runs — the radar sweep and the hourly re-scan among them (no default filter holds them back)', runs.radar && runs.scans && stOf('radar').lastAt && stOf('scans').lastAt && stOf('radar').nextAt && stOf('scans').nextAt && stOf('pulse').lastAt,
    brief({ runs, radar: stOf('radar'), scans: stOf('scans') }));
  await sleep(300);
  const g = guarded();
  check('(a) neither job reads robinhoodchain.blockscout.com — and nothing in this run tried to reach it, or GoPlus\'s real host', !g.some((x) => /blockscout|gopluslabs/.test(x.url)), brief(g));
  check('(b) nothing in this run tried to leave this machine under the browser User-Agent', !g.some((x) => /Mozilla\//.test(String(x.ua))), brief(g));

  // the radar
  check('the radar sweep ran and kept its three new coins\' pairs; its run counts the requests it made (two node reads, a Dexscreener read, a batch of names)', runs.radar.ok === 1 && runs.radar.calls === 4 && /^3 pairs kept, cursor 100000000$/.test(runs.radar.note), brief(runs.radar));
  const rnode = radarNodeReqs(), heads = node.reqs.filter((r) => r.single && r.calls[0][0] === 'eth_blockNumber');
  check('(d) the radar walks the factory\'s logs one read at a time, from the head back 2.5M blocks, as the site itself (the node\'s honest User-Agent)', rnode.length === 1 && parseInt(rnode[0].calls[0][1][0].fromBlock, 16) === HEAD - 2500000 && heads.length >= 1
    && rnode.concat(heads).every((r) => /^JustSendIt\/1\.0 /.test(r.ua)), brief({ rnode: rnode.map((r) => r.calls[0][1][0]), heads: heads.length }));
  const ds = vreqs.filter((r) => r.path.startsWith('/ds/tokens/v1/robinhood/'));
  check('(b) its market figures are one Dexscreener read for the new pairs (not the WETH/USDG pool), with the honest User-Agent', ds.length === 1 && ds[0].ua === HONEST && ds[0].path.split('/').pop().split(',').sort().join() === [TOKA, TOKB, TOKC].sort().join(), brief(ds));
  const names = node.reqs.filter((r) => !r.single && r.calls.some(([m, p]) => m === 'eth_call' && String(p[0].to).toLowerCase() === TOKC));
  check('  ...and the token Dexscreener does not list is named from the chain, in one batch on Market Data\'s chain share (only it)', names.length === 1 && names[0].calls.length === 2 && names[0].calls.every(([, p]) => String(p[0].to).toLowerCase() === TOKC), brief(names.map((r) => r.calls)));
  const row = (pa) => sdb.prepare('SELECT * FROM mkt_radar WHERE pair = ?').get(pa);
  const r1 = row(P1), r2 = row(P2), r3 = row(P3), r4 = row(P4);
  check('the radar\'s background rows: the figures it read (price, liquidity, caps, volume) and no verdict — the one a member\'s sweep left an hour ago is cleared, not left beside newer figures',
    r1 && r1.price_usd === 0.0123 && r1.liquidity_usd === 4567 && r1.mcap === 12000 && r1.fdv === 12300 && r1.volume_24h === 890 && r1.created_at === NOW0 - 3600e3 && r1.symbol === 'TOKA' && r1.health === null && r1.verdict === null && r1.risk === null && r1.json === null && r1.updated_at > t, brief(r1));
  check('  ...a pool Dexscreener lists the other way round keeps its liquidity and volume but no price or caps (those were WETH\'s); the unlisted token is named from the chain, with nothing priced; the WETH/USDG pool keeps its place only',
    r2 && r2.symbol === 'TOKB' && r2.name === 'Token B' && r2.price_usd === null && r2.mcap === null && r2.fdv === null && r2.liquidity_usd === 2222 && r2.volume_24h === 55 && r2.verdict === null
    && r3 && r3.symbol === 'TOKC' && r3.name === 'Token C' && r3.token === TOKC && r3.quote === WETH && r3.price_usd === null && r3.liquidity_usd === null && r3.volume_24h === null
    && r4 && r4.symbol === null && r4.price_usd === null && r4.created_block === HEAD - 400, brief({ r2, r3, r4 }));
  check('  ...and the radar\'s cursor is kept, so a member\'s next sweep reads on from it', JSON.parse(sdb.prepare("SELECT value FROM mkt_state WHERE name = 'radar'").get().value).cursor === HEAD);

  // the re-scan
  const ref = (a) => sdb.prepare("SELECT * FROM mkt_scan WHERE src = 'refresh' AND address = ?").all(a);
  const rRA = ref(RA), rRA2 = ref(RA2), rRB = ref(RB), rRC = ref(RC), rPEPE = ref(PEPE), rX = ref(XTOK);
  check('the re-scan: on the home chain it keeps the token cache\'s reading from the last hour, dated when it was read — and makes none up for a token with no reading that recent, or none at all; nor keeps one Market Data already has',
    rRA.length === 1 && rRA[0].read_at === RA_AT && rRA[0].price_usd === 1.5 && rRA[0].holders === 120 && rRB.length === 0 && rRC.length === 0 && rRA2.length === 0, brief({ rRA, rRB, rRC, rRA2 }));
  check('  ...on Ethereum it reads the token again through the Scanner\'s own read, and keeps it', rPEPE.length === 1 && rPEPE[0].symbol === 'PEPE' && rPEPE[0].price_usd > 0 && rPEPE[0].read_at >= t, brief(rPEPE));
  const mc = vreqs.filter((r) => r.path.startsWith('/mc/'));
  const gp = mc.filter((r) => r.path.startsWith('/mc/gp/'));
  check('(b) every one of those reads — Dexscreener, GoPlus, the Ethereum node — carried the honest User-Agent', mc.length >= 4 && mc.every((r) => r.ua === HONEST) && mc.some((r) => r.path === '/mc/ethnode') && mc.some((r) => r.path.startsWith('/mc/ds/token-pairs/v1/ethereum/')), brief(mc));
  check('(c) GoPlus is asked only from the re-scan\'s own share (one a minute here): the second token found it spent, was not asked, and its reading — which would have scored without the security read — is not kept',
    gp.length === 1 && gp[0].search.toLowerCase().includes(PEPE) && rX.length === 0, brief({ gp, rX }));
  check('  ...and the run says which readings it made and which it copied: PEPE re-read, the home chain\'s one kept from the token cache (nothing was read for it), the other four not — and the job\'s title says the same',
    /^6 tokens: 1 re-read, 1 kept from the token cache, 4 not$/.test(runs.scans.note) && /Robinhood Chain from the token cache/.test(stOf('scans').title || '') && /Ethereum and Solana read again/.test(stOf('scans').title || ''), brief({ note: runs.scans.note, title: stOf('scans').title }));
  const tcA = sdb.prepare('SELECT reads, last_read_at FROM token_cache WHERE token_addr = ?').get(RA);
  const scansAfter = sdb.prepare('SELECT COUNT(*) n, COALESCE(SUM(count), 0) c FROM scans').get();
  check('(e) neither job counts as a token view or a public scan: the token cache\'s reads and last read stand, its rows are the same ones, and the Scanner\'s public store is untouched',
    tcA.reads === 5 && tcA.last_read_at === READ_AT && sdb.prepare('SELECT COUNT(*) n FROM token_cache').get().n === tcBefore && !sdb.prepare('SELECT 1 x FROM token_cache WHERE token_addr IN (?,?,?)').get(TOKA, TOKB, TOKC)
    && scansAfter.n === scansBefore.n && scansAfter.c === scansBefore.c && !sdb.prepare('SELECT 1 x FROM scans_mc WHERE token_addr IN (?,?)').get(PEPE, XTOK), brief({ tcA, scansBefore, scansAfter }));
  const walks = node.reqs.filter((r) => r.calls.some(([m, p]) => m === 'eth_getLogs' && p && p[0] && Array.isArray(p[0].topics) && p[0].topics[0] === TRANSFER && [RA, RA2, RB, RC].includes(String(p[0].address).toLowerCase())));
  check('(f) no holder ledger is walked for the re-scanned tokens', walks.length === 0, brief(walks.map((r) => r.calls)));
  const ob = await api('/api/admin/outbound', { sid: adminSid }), hosts = (ob.j && ob.j.hosts) || {};
  check('(c)(d) the meters say so: the chain share took the radar\'s reads, the GoPlus share one and refused one',
    hosts['market:rpc'] && hosts['market:rpc'].totalSinceBoot >= 3 && hosts['market:goplus'] && hosts['market:goplus'].ceilingRpm === 1 && hosts['market:goplus'].totalSinceBoot === 1 && hosts['market:goplus'].refused >= 1, brief({ rpc: hosts['market:rpc'], gp: hosts['market:goplus'] }));

  /* ── the logo proxy: one picture, one key; misses metered ── */
  const L = (u, ip) => api('/api/market/logo?u=' + encodeURIComponent(u), { ip });
  const CMS = 'https://cdn.dexscreener.com/cms/images/abc';
  const lg = [await L(CMS + '?width=800&height=800&quality=95&format=auto', '10.1.0.1'), await L(CMS + '?width=801&height=800&quality=95&format=auto', '10.1.0.1'), await L(CMS + '?x=' + Date.now(), '10.1.0.2'), await L(CMS + '#frag', '10.1.0.3'), await L(CMS, '10.1.0.4')];
  const cg = [await L('https://coin-images.coingecko.com/coins/images/7/large/y.png?111', '10.1.0.5'), await L('https://coin-images.coingecko.com/coins/images/7/large/y.png?222', '10.1.0.5')];
  const imgs = vreqs.filter((r) => r.path.startsWith('/img/'));
  const abc = imgs.filter((r) => r.path === '/img/cms/images/abc'), yy = imgs.filter((r) => r.path === '/img/coins/images/7/large/y.png');
  check('the logo proxy keys a picture by its canonical URL: a query string or fragment changed on every ask is the same picture, fetched once (Dexscreener\'s CDN at its icon size, the others with no query)',
    lg.concat(cg).every((r) => r.status === 200 && Buffer.compare(r.buf, PNG) === 0) && abc.length === 1 && abc[0].search === '?width=800&height=800&quality=95&format=auto' && yy.length === 1 && yy[0].search === '', brief({ st: lg.concat(cg).map((r) => r.status), abc, yy }));
  const flood = []; for (let i = 0; i < 64; i++) flood.push((await L('https://cdn.dexscreener.com/cms/images/made-up-' + i, '10.2.0.1')).status);
  const after = await L(CMS + '?y=1', '10.2.0.1');
  const fetched = vreqs.filter((r) => r.path.startsWith('/img/cms/images/made-up-')).length;
  check('  ...a visitor\'s misses are metered far below its asks: 60 a minute fetched, then "slow down" — while a picture already kept still serves at once, unfetched',
    flood.slice(0, 60).every((s) => s === 502) && flood.slice(60).every((s) => s === 429) && fetched === 60 && after.status === 200 && vreqs.filter((r) => r.path === '/img/cms/images/abc').length === 1, brief({ flood: flood.join(''), fetched, after: after.status }));
  const others = (await Promise.all(Array.from({ length: 12 }, (_, i) => L('https://cdn.dexscreener.com/cms/images/other-' + i, '10.3.0.' + i)))).map((r) => r.status);   // at once, from twelve visitors
  const ob2 = await api('/api/admin/outbound', { sid: adminSid }), lh = ((ob2.j && ob2.j.hosts) || {})['market:logo'];
  check('  ...and every miss, from anyone, comes out of the proxy\'s own share of the CDNs\' meters: spent, a miss is "could not be fetched just now" (66 a minute here)',
    others.some((s) => s === 503) && lh && lh.ceilingRpm === 66 && lh.refused >= 1, brief({ others: others.join(','), lh }));
  await halt();

  /* ── boot 3: the node refuses the radar's read ── */
  sdb.exec("DELETE FROM mkt_runs; DELETE FROM mkt_state WHERE name = 'radar'");
  node.reqs.length = 0; vreqs.length = 0; node.mode = 'refuse';
  check('the server came up again (radar and the chain\'s new pools only), the node refusing log reads', await boot({ MARKET_JOBS: 'radar,newPoolsRh' }), slog.slice(-300));
  const r3runs = await waitRun(['radar', 'newPoolsRh']);
  const refusedLogs = radarNodeReqs();
  check('(d) a refused background read ends the run: asked once — not halved into a cascade of smaller reads — and nothing after it (no Dexscreener read)', refusedLogs.length === 1 && r3runs.radar && r3runs.radar.ok === 0 && /refused a background read/.test(r3runs.radar.note)
    && !vreqs.some((r) => r.path.startsWith('/ds/')), brief({ n: refusedLogs.length, radar: r3runs.radar }));
  check('  ...it stands Market Data\'s chain reads down for five minutes — without making the site\'s own reads give way (they were not the ones refused)', r3runs.newPoolsRh && r3runs.newPoolsRh.ok === 0 && /Market Data's own reads/.test(r3runs.newPoolsRh.note) && !/site's own/.test(r3runs.newPoolsRh.note),
    brief(r3runs.newPoolsRh));
  await halt();

  /* ── boot 4: the site's own read is refused while the radar walks ── */
  sdb.exec("DELETE FROM mkt_runs; DELETE FROM mkt_state WHERE name = 'radar'");
  node.reqs.length = 0; node.mode = 'busy';
  let scanned = null;
  node.hold = () => { scanned = api('/api/scan?address=' + A('5c') + '&chain=robinhood', { ip: '10.4.0.1' }).catch(() => null); };   // a member's scan: the node refuses its eth_call
  check('the server came up again (the radar only), the node holding its head-block read and refusing the site\'s own calls', await boot({ MARKET_JOBS: 'radar' }), slog.slice(-300));
  const r4runs = await waitRun(['radar']);
  await (scanned || Promise.resolve());
  const siteRefused = node.reqs.some((r) => r.single && r.calls[0][0] === 'eth_call');
  check('(d) the radar asks before every read whether the site\'s own reads are waiting: its head-block read was answered after a member\'s read was refused, so its log read was never sent',
    siteRefused && radarNodeReqs().length === 0 && r4runs.radar && r4runs.radar.ok === 0 && r4runs.radar.calls === 1 && /yielded: the node refused one of the site's own reads/.test(r4runs.radar.note), brief({ siteRefused, radar: r4runs.radar, n: radarNodeReqs().length }));
  await halt();

  /* ── boot 5: a member opens the radar, never built since the restart, while the background walk holds it ── */
  sdb.exec("DELETE FROM mkt_runs; DELETE FROM mkt_state WHERE name = 'radar'");
  node.reqs.length = 0; node.mode = 'hold';
  let opened = null;
  node.hold = () => { opened = api('/api/pairs/new', { sid: adminSid }).catch(() => null); };   // asked while the walk's head-block read is held
  check('the server came up again (the radar only), the node holding the walk\'s head-block read', await boot({ MARKET_JOBS: 'radar' }), slog.slice(-300));
  const r5runs = await waitRun(['radar']);
  const seen = await (opened || Promise.resolve(null)), sj = (seen && seen.j) || {};
  check('a member who opens the radar during the background walk is told it is being built — not handed an empty radar that reads as "quiet on the chain"',
    seen && seen.status === 200 && sj.building === true && Array.isArray(sj.pairs) && sj.pairs.length === 0 && sj.error == null && sj.updatedAt === 0, brief({ status: seen && seen.status, building: sj.building, pairs: sj.pairs && sj.pairs.length, error: sj.error, updatedAt: sj.updatedAt }));
  // the member's sweep reads each pair's reserves; the background walk never does
  const reservesReads = () => node.reqs.filter((r) => r.calls.some(([m, p]) => m === 'eth_call' && p && p[0] && String(p[0].data || '').startsWith('0x0902f1ac')));
  for (let i = 0; i < 50 && !reservesReads().length; i++) await sleep(100);
  const walkLogs = radarNodeReqs(), memberReads = reservesReads();
  check('  ...and their sweep is queued behind the walk, not dropped: it starts as the walk ends, with no second ask, and reads on from the walk\'s cursor (one log walk in all)',
    r5runs.radar && r5runs.radar.ok === 1 && walkLogs.length === 1 && memberReads.length >= 1 && memberReads.every((r) => r.at >= walkLogs[0].at), brief({ radar: r5runs.radar, walks: walkLogs.length, member: memberReads.length }));
  await halt();
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join(' | '));
  check('part 3 ran to the end', false, e.message + ' · ' + slog.slice(-400));
} finally {
  await halt();
  try { sdb && sdb.close(); } catch {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  vendor.close(); nodeSrv.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra && !ok ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
