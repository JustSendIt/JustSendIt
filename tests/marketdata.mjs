/* ===== Market Data: the collectors, the tables, the answers, the Send API and the admin browser (owner, 2026-10-26) =====
   "Setup a page named Market Data … Robinhood being the default view"; "make sure the token scanner and live new pair scanner
   is constantly caching data about everything on every chain … and have all that data be accessible through the Send API";
   "Make all cache data from the platform visible on the Admin page. Don't show anything on the admin page that is encrypted."

   1. lib/marketdata.js on its own: a database of its own, a fixed clock (the hour the research samples were read), a meter
      that records every take (and can refuse), a fake chain node, and every vendor faked from tests/fixtures/marketdata/
      (trimmed from the 2026-10-26 research samples — every value a source returned). Every collector runs once; what it
      wrote; the answers (chains, a chain, tokens, a token, search, new pools, status, the Send API resources); the windows
      (presets, custom whole days, outside our history); null sorting; the honesty rules; the budgets; the pruning.
   2. A server of its own, every vendor and both chain nodes faked, the collectors on with a short stagger: the routes, the
      quiet scan, the Send API (401 without a key, paging), the admin browser (404 for anyone else, never a private column),
      the image proxy, the meters, the honest User-Agent, and the radar resuming its cursor after a restart.
   Nothing here reaches a live vendor. Everything lives in temporary directories, deleted. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { ROOT, SERVER_JS } from './_paths.mjs';
const require = createRequire(import.meta.url);
const MD = require(path.join(ROOT, 'lib', 'marketdata.js'));

const SRC = fs.readFileSync(SERVER_JS, 'utf8');
const LIB = fs.readFileSync(path.join(ROOT, 'lib', 'marketdata.js'), 'utf8');
const RUNJS = fs.readFileSync(path.join(ROOT, 'tests', 'run.mjs'), 'utf8');
const DOCS = fs.readFileSync(path.join(ROOT, 'public', 'data.html'), 'utf8');
const FIX = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'marketdata', f), 'utf8'));
const MCFIX = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'multichain', f), 'utf8'));
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
// MARKET_DUMP_DIR=<dir>: also write the answers this suite read, as samples of the API's real shapes (for the page and the docs)
const DUMP = process.env.MARKET_DUMP_DIR || '';
const dump = (name, o) => { if (!DUMP) return; try { fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(path.join(DUMP, name + '.json'), JSON.stringify(o, null, 1)); } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const brief = (o) => JSON.stringify(o).slice(0, 300);
const near = (a, b, tol = 1e-6) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const UA = 'JustSendIt/1.0 (+https://sendrh.com)';
const NOW = Date.parse('2026-10-26T18:00:00Z');   // the research samples were read 17:19–17:37 UTC that day
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168', WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const PEPE = '0x6982508145454ce325ddbe47a25d4ec3d2311933';
const FORBIDDEN = /(_enc$|^address_enc$|e-?mail|wallet|two_?fa|2fa|totp|pref|session|^ip$|^ip_|_ip$|ipidx|ip_idx|key|passw|secret|tracked|cookie|nonce|token_hash)/i;

/* ═══ the fixtures, and what they say (computed here from the fixtures themselves, never typed in) ═══ */
const F = {
  chains: FIX('llama-chains.json'), dexs: FIX('llama-overview-dexs.json'), fees: FIX('llama-overview-fees.json'), oi: FIX('llama-overview-oi.json'),
  stables: FIX('stable-chains.json'), mcaps: FIX('coins-mcaps.json'), protocols: FIX('llama-protocols.json'), l2beat: FIX('l2beat-summary.json'),
  gtp: FIX('gtp-fundamentals.json'), gtpTx: FIX('gtp-txcount-robinhood.json'), histtvl: FIX('llama-histtvl-robinhood.json'), dexsRh: FIX('llama-dexs-robinhood.json'),
  feesRh: FIX('llama-fees-robinhood.json'), stChart: FIX('stable-chart-robinhood.json'), gtP1: FIX('gt-pools-robinhood-p1.json'), gtP10: FIX('gt-pools-robinhood-p10.json'),
  gtEth: FIX('gt-pools-eth-rekeyed.json'), gtNewEth: FIX('gt-new-pools-eth-rekeyed.json'), gtSend: FIX('gt-token-send.json'), ohlcvH: FIX('gt-ohlcv-hour-usdg.json'), ohlcvD: FIX('gt-ohlcv-day-send.json'),
  dsTokens: FIX('ds-tokens-v1.json'), dsSend: FIX('ds-token-pairs-send.json'), dsSearch: FIX('ds-search-robinhood.json'), cgMarkets: FIX('cg-markets.json'),
  state: FIX('rpc-state.json'), logs: FIX('rpc-logs.json'), anchors: FIX('rpc-anchor-blocks.json'), bridge: FIX('eth-bridge.json'), pm: FIX('rpc-poolmanager.json'),
};
const leaf = (o) => (typeof o === 'number' ? o : o && typeof o === 'object' ? Object.values(o).reduce((a, v) => a + leaf(v), 0) : 0);
const sumKey = (ov, field, key) => ov.protocols.reduce((a, p) => a + (p[field] && p[field][key] ? leaf(p[field][key]) : 0), 0);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const RH_LLAMA = F.chains.find((c) => c.name === 'Robinhood Chain');
const ETH_LLAMA = F.chains.find((c) => c.name === 'Ethereum');
const RH_FEES = F.fees.protocols.find((p) => p.category === 'Chain' && p.protocolType === 'chain' && p.chains && p.chains[0] === 'Robinhood Chain');
const RH_STABLES = F.stables.find((s) => s.name === 'Robinhood Chain').totalCirculatingUSD.peggedUSD;
const RH_DEXLIQ = F.protocols.filter((p) => p.category === 'Dexs').reduce((a, p) => a + (p.chainTvls['Robinhood Chain'] || 0), 0);
const RH_VOL24 = sumKey(F.dexs, 'breakdown24h', 'robinhood'), RH_VOL30 = sumKey(F.dexs, 'breakdown30d', 'robinhood'), RH_OI = sumKey(F.oi, 'breakdown24h', 'robinhood');
const RH_TVS = F.l2beat.projects.robinhood.tvs.breakdown.total;
const HEAD = parseInt(F.state['1'], 16), HEAD_TS = parseInt(F.state['5'].timestamp, 16);
const A0 = { n: parseInt(F.anchors[0].number, 16), ts: parseInt(F.anchors[0].timestamp, 16) };
const tsAt = (n) => Math.round(A0.ts + (n - A0.n) * (HEAD_TS - A0.ts) / (HEAD - A0.n));   // the chain's timestamps between two real blocks, for blocks the research did not read
const allPools = [...F.gtP1.data, ...F.gtP10.data];
const incOf = (j) => new Map((j.included || []).map((x) => [x.id, x]));
const INC = new Map([...incOf(F.gtP1), ...incOf(F.gtP10)]);
const baseOf = (p) => (INC.get(p.relationships.base_token.data.id) || {}).attributes || {};
const groupBy = new Map();
for (const p of allPools) { const a = baseOf(p).address || p.relationships.base_token.data.id.slice('robinhood_'.length); if (!groupBy.has(a)) groupBy.set(a, []); groupBy.get(a).push(p); }
const num = (x) => (x == null || x === '' ? null : Number(x));
const tokLiq = (a) => groupBy.get(a).reduce((s, p) => s + (num(p.attributes.reserve_in_usd) || 0), 0);
const tokVol = (a, w = 'h24') => groupBy.get(a).reduce((s, p) => s + (num(p.attributes.volume_usd[w]) || 0), 0);
// GeckoTerminal answers 0 for a reserve it did not read: a token whose pools all say 0 has no liquidity reading, and no flag rests on it
const liqKnown = (a) => groupBy.get(a).some((p) => num(p.attributes.reserve_in_usd) > 0);
const WASH = [...groupBy.keys()].filter((a) => liqKnown(a) && tokVol(a) > 100 * Math.max(tokLiq(a), 1e-9));
const THIN = [...groupBy.keys()].filter((a) => liqKnown(a) && tokLiq(a) < 10000);
const UNREAD = [...groupBy.keys()].filter((a) => !liqKnown(a));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('0000000d49484452', 'hex'), randomBytes(40)]);

/* ═══ the fake vendors: one server, a prefix per source ═══ */
const hits = {}, uas = new Set(), log = [];
const hit = (k) => { hits[k] = (hits[k] || 0) + 1; };
const vendorFail = { mcaps: false, gtAll: false, noList: false }, cgSeen = [];
// hold.rhPage2: a promise Robinhood Chain's second pools page waits on (a run caught partway through); asked: it was asked for
const hold = { rhPage2: null, asked: false };
const w256 = (hex) => String(hex).replace(/^0x/, '').padStart(64, '0');
const abiStr = (s) => '0x' + w256('20') + w256(s.length.toString(16)) + Buffer.from(s).toString('hex').padEnd(64, '0');
const vendor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  let body = ''; req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const send = (code, o, ct) => { res.writeHead(code, { 'Content-Type': ct || 'application/json' }); res.end(Buffer.isBuffer(o) || typeof o === 'string' ? o : JSON.stringify(o)); };
    const seg = p.split('/')[1];
    if (['llama', 'coins', 'stables', 'l2beat', 'gtp', 'gt', 'ds', 'cg', 'eth', 'img'].includes(seg)) uas.add(String(req.headers['user-agent']));
    log.push(req.method + ' ' + p + u.search);
    hit(seg);
    // DefiLlama
    if (p === '/llama/v2/chains') return send(200, F.chains);
    // vendorFail.noList: a 200 that carries an error instead of the protocols list (a schema change, a bad day)
    if (p === '/llama/overview/dexs') return send(200, vendorFail.noList ? { error: 'no protocols today' } : F.dexs);
    if (p === '/llama/overview/fees') return send(200, vendorFail.noList ? { error: 'no protocols today' } : F.fees);
    if (p === '/llama/overview/open-interest') return send(200, vendorFail.noList ? { error: 'no protocols today' } : F.oi);
    if (p === '/llama/protocols') return send(200, F.protocols);
    if (p === '/llama/v2/historicalChainTvl/Robinhood%20Chain') return send(200, F.histtvl);
    if (p === '/llama/overview/dexs/Robinhood%20Chain') return send(200, F.dexsRh);
    if (p === '/llama/overview/fees/Robinhood%20Chain') return send(200, F.feesRh);
    if (p.startsWith('/llama/')) return send(404, { error: 'not in the fixtures' });
    if (p === '/stables/stablecoinchains') return send(200, F.stables);
    if (p === '/stables/stablecoincharts/Robinhood%20Chain') return send(200, F.stChart);
    if (p.startsWith('/stables/')) return send(404, { error: 'not in the fixtures' });
    if (p === '/coins/mcaps' && req.method === 'POST') { hit('mcaps-post'); try { JSON.parse(body); } catch { return send(400, {}); } return vendorFail.mcaps ? send(500, { error: 'down' }) : send(200, F.mcaps); }
    if (p === '/cg/coins/markets') { hit('cg-markets'); cgSeen.push({ key: req.headers['x-cg-demo-api-key'] || null, q: u.search }); return send(200, F.cgMarkets); }
    // L2BEAT, growthepie
    if (p === '/l2beat/scaling/summary') return send(200, F.l2beat);
    if (p.startsWith('/l2beat/scaling/activity/')) { hit('l2beat-activity'); return p.endsWith('/robinhood') ? send(200, FIX('l2beat-activity-robinhood.json')) : send(404, { error: 'no' }); }
    if (p === '/gtp/fundamentals.json') return send(200, F.gtp);
    if (p === '/gtp/metrics/chains/robinhood/txcount.json') return send(200, F.gtpTx);
    if (p.startsWith('/gtp/')) return send(404, { error: 'not in the fixtures' });
    // GeckoTerminal
    if (p.startsWith('/gt/')) {
      hit('gt-' + (/\/ohlcv\//.test(p) ? 'ohlcv' : (p.match(/\/(new_pools|pools|tokens)\b/) || [, 'other'])[1]));
      if (vendorFail.gtAll) return send(500, { errors: [{ status: '500' }] });
      const page = Number(u.searchParams.get('page') || 1);
      if (p === '/gt/networks/robinhood/pools' && page === 2 && hold.rhPage2) { hold.asked = true; return hold.rhPage2.then(() => send(200, F.gtP10)); }
      if (p === '/gt/networks/robinhood/pools') return send(200, page === 1 ? F.gtP1 : page === 2 ? F.gtP10 : { data: [] });
      if (p === '/gt/networks/eth/pools') return send(200, page === 1 ? F.gtEth : { data: [] });
      if (/^\/gt\/networks\/[a-z_]+\/pools$/.test(p)) return send(200, { data: [] });
      if (p === '/gt/networks/eth/new_pools') return send(200, F.gtNewEth);
      if (/^\/gt\/networks\/[a-z_]+\/new_pools$/.test(p)) return send(200, { data: [] });
      if (p === '/gt/networks/robinhood/tokens/' + SEND) return send(200, F.gtSend);
      if (/^\/gt\/networks\/[a-z_]+\/tokens\//.test(p)) return send(404, { errors: [{ status: '404', title: 'Not Found' }] });
      if (/\/ohlcv\/hour$/.test(p)) return send(200, F.ohlcvH);
      if (/\/ohlcv\/day$/.test(p)) return send(200, F.ohlcvD);
      return send(404, { error: 'not here: ' + p });
    }
    // Dexscreener
    if (p.startsWith('/ds/tokens/v1/robinhood/')) { hit('ds-tokens'); const want = p.split('/').pop().toLowerCase().split(','); return send(200, [...F.dsTokens, ...F.dsSend].filter((x) => x && x.baseToken && want.includes(String(x.baseToken.address).toLowerCase()))); }
    if (p === '/ds/latest/dex/search') { hit('ds-search'); return send(200, /robinhood/i.test(u.searchParams.get('q') || '') ? F.dsSearch : { schemaVersion: '1.0.0', pairs: [] }); }
    // the Ethereum node: the canonical bridge batch
    if (p === '/eth' && req.method === 'POST') {
      let arr = []; try { arr = JSON.parse(body); } catch {}
      const by = {}; for (const x of F.bridge) by[x.id] = x;
      return send(200, (Array.isArray(arr) ? arr : []).map((c) => {
        const to = String((c.params && c.params[0] && c.params[0].to) || c.params && c.params[0] || '').toLowerCase(), data = (c.params && c.params[0] && c.params[0].data) || '';
        if (c.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: c.id, result: by[0].result };
        if (c.method === 'eth_getBalance' && to === MD.L1.bridge) return { jsonrpc: '2.0', id: c.id, result: by[1].result };
        if (c.method === 'eth_call' && to === MD.L1.sequencerInbox && data === MD.L1.batchCount) return { jsonrpc: '2.0', id: c.id, result: by[4].result };
        if (c.method === 'eth_call' && to === MD.L1.bridge && data === MD.L1.delayedMessageCount) return { jsonrpc: '2.0', id: c.id, result: by[5].result };
        return { jsonrpc: '2.0', id: c.id, error: { code: 3, message: 'execution reverted' } };
      }));
    }
    // pictures for the logo proxy
    if (p === '/img/coins/images/1/large/x.png') { hit('img-png'); return send(200, PNG, 'image/png'); }
    if (p === '/img/x.svg') { hit('img-svg'); return send(200, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/png'); }
    if (p === '/img/moved.png') { hit('img-redirect'); res.writeHead(302, { Location: 'http://127.0.0.1:9/elsewhere.png' }); return res.end(); }
    if (p === '/img/big.png') { hit('img-big'); return send(200, Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]), 'image/png'); }
    // lib/multichain.js's sources, for a scan on Ethereum (the multichain suite's fixtures)
    if (p.startsWith('/mc/ds/token-pairs/v1/ethereum/')) return send(200, p.toLowerCase().endsWith(PEPE) ? MCFIX('ds-token-pairs-ethereum-pepe.json') : []);
    if (p.startsWith('/mc/ds/latest/dex/pairs/')) return send(200, { schemaVersion: '1.0.0', pairs: null });
    if (p === '/mc/gp/token_security/1') return send(200, (u.searchParams.get('contract_addresses') || '').toLowerCase() === PEPE ? MCFIX('goplus-ethereum-pepe.json') : { code: 1, message: 'OK', result: {} });
    if (p === '/mc/ethnode') {
      let arr = []; try { arr = JSON.parse(body); } catch {}
      if (!Array.isArray(arr)) return send(200, { jsonrpc: '2.0', id: 1, result: '0x' });
      return send(200, arr.map((c) => { const to = String((c.params && c.params[0] && c.params[0].to) || '').toLowerCase(), data = (c.params && c.params[0] && c.params[0].data) || '';
        const r = to !== PEPE ? '0x' : data === '0x06fdde03' ? abiStr('Pepe') : data === '0x95d89b41' ? abiStr('PEPE') : data === '0x313ce567' ? '0x' + w256('12') : data === '0x18160ddd' ? '0x' + w256((420689899999994793799999999999997n).toString(16)) : '0x';
        return { jsonrpc: '2.0', id: c.id, result: r }; }));
    }
    send(404, { error: 'not here: ' + p });
  });
});
await new Promise((ok) => vendor.listen(0, '127.0.0.1', ok));
vendor.unref();
const V = 'http://127.0.0.1:' + vendor.address().port;
const URLS = { llama: V + '/llama', coins: V + '/coins', stables: V + '/stables', l2beat: V + '/l2beat', growthepie: V + '/gtp', growthepieMetrics: V + '/gtp', gt: V + '/gt', ds: V + '/ds', cg: V + '/cg', ethRpc: V + '/eth' };

/* ═══ the fake Robinhood Chain node: the research's state batch, its real pool-creation logs, and timestamps between two real blocks ═══ */
const node = { head: HEAD, ranges: [], single: [], throttle: false, v4Limit: 400000, calls: 0 };
const KIND = { [MD.RH.v2Factory]: 'v2', [MD.RH.v3Factory]: 'v3', [MD.RH.poolManager]: 'v4' };
function nodeAnswer(m, params) {
  const hx = (n) => '0x' + n.toString(16);
  const a0 = params && params[0];
  if (m === 'eth_blockNumber') return { result: hx(node.head) };
  if (m === 'eth_getBlockByNumber') { const n = a0 === 'latest' ? node.head : parseInt(a0, 16); return { result: { number: hx(n), timestamp: hx(tsAt(n)), baseFeePerGas: F.state['5'].baseFeePerGas } }; }
  if (m === 'eth_gasPrice') return { result: F.state['2'] };
  if (m === 'eth_getBalance' && String(a0).toLowerCase() === MD.RH.poolManager) return { result: F.pm.eth };
  if (m === 'eth_call') {
    const to = String(a0.to).toLowerCase(), d = a0.data;
    if (to === MD.RH.arbGasInfo && d === MD.RH.getPricesInWei) return { result: F.state['7'] };
    if (to === MD.RH.arbGasInfo && d === MD.RH.getMinimumGasPrice) return { result: F.state['8'] };
    if (to === WETH && d === '0x18160ddd') return { result: F.state['15'] };
    if (to === USDG && d === '0x18160ddd') return { result: F.state['16'] };
    if (to === WETH && d === '0x70a08231' + w256(MD.RH.poolManager)) return { result: F.pm.weth };
    if (to === USDG && d === '0x70a08231' + w256(MD.RH.poolManager)) return { result: F.pm.usdg };
    return { error: { code: 3, message: 'execution reverted' } };
  }
  if (m === 'eth_getLogs') {
    const k = KIND[String(a0.address).toLowerCase()], from = parseInt(a0.fromBlock, 16), to = parseInt(a0.toBlock, 16);
    node.ranges.push([k, from, to]);
    if (!k) return { result: [] };
    if (k === 'v4' && to - from > node.v4Limit) return { error: { code: -32000, message: 'query returned more than 10000 results' } };   // the node's real refusal
    return { result: F.logs[k].filter((l) => { const b = parseInt(l.blockNumber, 16); return b >= from && b <= to; }) };
  }
  return { error: { code: -32601, message: 'the method ' + m + ' does not exist' } };
}
// in-process, the way the server's rpcBatch answers: null for an item the node refused, a throw for a throttle
async function fakeRpcBatch(calls) {
  node.calls++;
  if (node.throttle) throw new Error('rpc http 429');
  return calls.map(([m, p]) => { const r = nodeAnswer(m, p); return r.error ? null : r.result; });
}

/* ═══ 1. THE MODULE ON ITS OWN ═══ */
const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-mkt-a-'));
const dbA = new DatabaseSync(path.join(tmpA, 'a.db'));
let clock = NOW;
const meter = { log: [], refuse: null };
const take = async (key, wait) => { meter.log.push([key, wait]); if (meter.refuse && meter.refuse(key)) throw new Error('outbound budget for ' + key + ' is spent'); };
let busy = false;
const radarPairs = [{ pair: { address: '0x' + 'ab'.repeat(20), quoteSymbol: 'WETH', createdAt: NOW - 60000, token0: null, token1: null }, token: { address: '0x' + 'cd'.repeat(20), symbol: 'RADAR', name: 'Radar Test' }, market: { priceUsd: 0.5, liquidityUsd: 1234, fdv: 9999, marketCap: null }, volume: { h24: 77 }, risk: { triage: 'caution', health: 55, thinData: true }, holders: { count: 12 } }];
const radarRaw = [{ pair: '0x' + 'ab'.repeat(20), token0: '0x' + 'cd'.repeat(20), token1: WETH, block: 98587000 }, { pair: '0x' + 'ef'.repeat(20), token0: '0x' + '12'.repeat(20), token1: WETH, block: 98587100 }];
const refreshed = [];
const md = MD.createMarketData({ db: dbA, now: () => clock, outboundTake: take, rpcBatch: fakeRpcBatch, rpcBusy: () => busy, urls: URLS, bgWaitMs: 1000, askWaitMs: 1000,
  radarSweep: async () => ({ pairs: radarPairs, cursor: 98587100, raw: radarRaw }), scanRefresh: async (chain, addr) => { refreshed.push(chain + ':' + addr); return { pair: radarPairs[0], readAt: clock }; } });
md.migrate();
const q1 = (sql, ...a) => dbA.prepare(sql).get(...a);
const qa = (sql, ...a) => dbA.prepare(sql).all(...a);
try {
  /* ── the module's shape, in the source ── */
  check('one honest User-Agent, at least 30 s to answer, no redirect followed, a size cap — never the browser one', MD.HONEST_UA === UA && /Math\.max\(30000, Number\(o\.timeoutMs\) \|\| 30000\)/.test(LIB) && (LIB.match(/redirect: 'error'/g) || []).length === 2 && /readCapped\(res, Number\(o\.maxBytes\)/.test(LIB) && !/BROWSER_UA|Mozilla\//.test(LIB));
  check('every outbound read takes the meter first — the share (GeckoTerminal), then the host — and a spent meter is "could not ask"', /if \(o\.share\) await takeShare\(\[\]\.concat\(o\.share\), wait\);\s*const h = hostOf\(url\); if \(h\) await take\(h, wait\);/.test(LIB) && /catch \{ return \{ ok: false, status: 0, data: null, reason: 'budget' \}; \}/.test(LIB)
    && /const gtAsk = \(ctx, path, o = \{\}\) => ask\(ctx, urls\.gt \+ path, Object\.assign\(\{ share: GT_SHARE \}, o\)\);/.test(LIB) && /const gtAskNow = \(path, o = \{\}\) => ask\(null, urls\.gt \+ path, Object\.assign\(\{ share: \[GT_ASKED, GT_SHARE\], wait: ASK_WAIT \}, o\)\);/.test(LIB)
    && (LIB.match(/gtAskNow\('/g) || []).length === 2 && (LIB.match(/gtAsk\(ctx, '/g) || []).length === 2);
  check('the chain node is read only through the injected (paced) batch, stands aside while the site\'s own reads are refused, and cools down after a refusal', /const busy = rpcBusy\(\);\s+if \(busy\) throw Object\.assign\(new Error\('yielded: '/.test(LIB) && /await take\(RPC_SHARE, BG_WAIT\)/.test(LIB) && /rpcCoolUntil = now\(\) \+ 5 \* MIN/.test(LIB) && !/fetch\(RH_RPC|rpc\.mainnet\.chain\.robinhood\.com/.test(LIB));
  check('a DefiLlama point dated today is never stored as a day', /if \(!validDay\(r\[2\]\) \|\| r\[2\] >= today \|\| r\[3\] == null\) continue;/.test(LIB));
  check('every table the contract names is created, each with an index for paging newest-first', ['mkt_chain_snap', 'mkt_chain_series', 'mkt_pool_snap', 'mkt_new_pool', 'mkt_rh_pulse', 'mkt_scan', 'mkt_radar', 'mkt_runs'].every((t) => q1("SELECT name FROM sqlite_master WHERE type='table' AND name=?", t))
    && ['idx_mkt_chain_snap_at', 'idx_mkt_chain_series_at', 'idx_mkt_pool_snap_at', 'idx_mkt_pool_snap_net_id', 'idx_mkt_pool_snap_pool', 'idx_mkt_new_pool_chain', 'idx_mkt_rh_pulse_at', 'idx_mkt_scan_at', 'idx_mkt_scan_chain', 'idx_mkt_scan_tok_id', 'idx_mkt_radar_upd', 'idx_mkt_runs_at'].every((i) => q1("SELECT name FROM sqlite_master WHERE type='index' AND name=?", i)));
  check('the chain table maps this site\'s keys to every source (Robinhood Chain, BSC, OP Mainnet, Polygon measured 2026-10-26)', MD.CHAIN_BY_KEY.get('robinhood').gt === 'robinhood' && MD.CHAIN_BY_KEY.get('bsc').proto === 'Binance' && MD.CHAIN_BY_KEY.get('optimism').l2beat === 'optimism' && MD.CHAIN_BY_KEY.get('optimism').proto === 'Optimism'
    && MD.CHAIN_BY_KEY.get('polygon').gt === 'polygon_pos' && MD.CHAIN_BY_KEY.get('avalanche').bk === 'avax' && MD.chainOfLlama('Some New Chain').key === 'some-new-chain' && MD.chainOfLlama('Robinhood Chain').key === 'robinhood');

  /* ── the collectors, each once ── */
  const run = async (job, at) => { if (at) clock = at; const r = await md.runJob(job); clock = NOW; return r; };
  const rl = await run('l2beat'), rq = await run('liquidity'), rc = await run('chains');
  check('the L2BEAT, DEX-liquidity and chains collectors ran and recorded their runs (job, ok, ms, requests, note)', rl.ok && rq.ok && rc.ok && qa('SELECT job, ok, calls FROM mkt_runs').length === 3 && q1("SELECT calls FROM mkt_runs WHERE job='chains'").calls >= 6, brief([rl, rq, rc]));
  const rh = q1("SELECT * FROM mkt_chain_snap WHERE chain='robinhood'"), rhSrc = JSON.parse(rh.src);
  check('Robinhood Chain\'s row is DefiLlama\'s figures exactly: TVL, DEX volume (24 h and 30 d, summed per breakdown key), gas fees, stablecoins, open interest, DEX liquidity',
    near(rh.tvl, RH_LLAMA.tvl) && near(rh.dex_vol_24h, RH_VOL24) && near(rh.dex_vol_30d, RH_VOL30) && rh.fees_24h === RH_FEES.total24h && rh.fees_30d === RH_FEES.total30d && near(rh.stables, RH_STABLES) && near(rh.oi, RH_OI) && near(rh.dex_liq, RH_DEXLIQ) && rh.chain_id === 4663,
    brief({ tvl: rh.tvl, v: rh.dex_vol_24h, want: RH_VOL24, f: rh.fees_24h, s: rh.stables, oi: rh.oi, liq: rh.dex_liq }));
  check('  ...no market cap — a null with its why, never 0: "No native token — gas is paid in ETH"', rh.mcap === null && rhSrc.mcap.why === 'No native token — gas is paid in ETH' && rh.native_token === null);
  check('  ...L2BEAT\'s Total Value Secured and stage beside it, never mixed into TVL', near(rh.tvs, RH_TVS) && rh.stage === 'Stage 0' && rh.is_l2 === 1 && rh.tvs !== rh.tvl);
  const eth = q1("SELECT * FROM mkt_chain_snap WHERE chain='ethereum'"), arb = q1("SELECT * FROM mkt_chain_snap WHERE chain='arbitrum'"), mon = q1("SELECT * FROM mkt_chain_snap WHERE chain='monad'");
  check('a chain\'s own token\'s market cap comes from DefiLlama\'s coins (ETH for Ethereum, ARB for Arbitrum); one it gave none for is missing, with why',
    near(eth.mcap, F.mcaps['coingecko:ethereum'].mcap) && near(arb.mcap, F.mcaps['coingecko:arbitrum'].mcap) && mon && mon.mcap === null && /no market cap was given for monad/.test(JSON.parse(mon.src).mcap.why) && eth.tvs === null && JSON.parse(eth.src).tvs.why === 'L2BEAT tracks Ethereum L2s and L3s only',
    brief({ e: eth.mcap, a: arb.mcap, m: mon && mon.src }));
  const zero = F.chains.filter((c) => !c.tvl).map((c) => c.name);
  check('a chain with neither a TVL nor a DEX volume is not listed; every other chain DefiLlama gave is, once', qa('SELECT name FROM mkt_chain_snap').every((r) => !zero.includes(r.name)) && q1('SELECT COUNT(*) n FROM mkt_chain_snap').n === q1('SELECT COUNT(DISTINCT chain) n FROM mkt_chain_snap').n && q1('SELECT COUNT(*) n FROM mkt_chain_snap').n >= 40);
  check('the chains run asked each source once (chains, DEX, fees, open interest, stablecoins, market caps) — and DefiLlama\'s overviews without their charts', ['/llama/v2/chains', '/llama/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', '/llama/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', '/llama/overview/open-interest?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', '/stables/stablecoinchains', '/coins/mcaps'].every((x) => log.filter((l) => l.endsWith(' ' + x)).length === 1), log.slice(0, 12).join(' | '));
  // the CoinGecko fallback, once in two minutes
  vendorFail.mcaps = true; clock = NOW + 3 * 60e3;
  const rc2 = await md.runJob('chains'); const cg1 = hits['cg-markets'] || 0;
  clock = NOW + 3 * 60e3 + 30e3; const rc3 = await md.runJob('chains'); const cg2 = hits['cg-markets'] || 0;
  vendorFail.mcaps = false; clock = NOW;
  check('when DefiLlama\'s market caps fail, CoinGecko is asked — at most once in two minutes, and the run says so', rc2.ok && cg1 === 1 && cg2 === 1 && /CoinGecko was asked less than two minutes ago/.test(rc3.note), brief([rc2.note, rc3.note, cg1, cg2]));
  // an operator's CoinGecko Demo key goes as its header, never in the URL
  const dbB = new DatabaseSync(path.join(tmpA, 'b.db'));
  const mdB = MD.createMarketData({ db: dbB, now: () => NOW, outboundTake: take, urls: URLS, cgDemoKey: 'demo-key-for-the-test' });
  mdB.migrate(); vendorFail.mcaps = true; const rcB = await mdB.runJob('chains'); vendorFail.mcaps = false; dbB.close();
  const cgB = cgSeen[cgSeen.length - 1] || {};
  check('  ...with a CoinGecko Demo key (COINGECKO_DEMO_KEY) the fallback sends it as its header, never in the URL', rcB.ok && cgB.key === 'demo-key-for-the-test' && !/demo-key/.test(cgB.q) && cgSeen[0].key === null && /COINGECKO_DEMO_KEY/.test(SRC), brief(cgSeen));
  dbA.prepare('DELETE FROM mkt_chain_snap WHERE at > ?').run(NOW);   // keep the first run's snapshot as the latest
  // a chain snapshot taken before L2BEAT's first read: the newer L2BEAT read wins, so the card never says "not read yet" above L2BEAT's own split
  const dbC = new DatabaseSync(path.join(tmpA, 'c.db'));
  const mdC = MD.createMarketData({ db: dbC, now: () => NOW, outboundTake: take, urls: URLS });
  mdC.migrate(); await mdC.runJob('chains');
  const tvs0 = mdC.chain({ key: 'robinhood' }).body.stats.tvs;
  await mdC.runJob('l2beat');
  const cdC = mdC.chain({ key: 'robinhood' }).body, rowC = mdC.chains({ limit: 200 }).body.rows.find((r) => r.key === 'robinhood'), ethC = mdC.chains({ limit: 200 }).body.rows.find((r) => r.key === 'ethereum');
  dbC.close();
  check('  ...a snapshot older than L2BEAT\'s read takes TVS, stage and L2 from the newer read (the detail and the list agree); a chain L2BEAT does not track says so', tvs0.v === null && /not been read yet/.test(tvs0.why)
    && near(cdC.stats.tvs.v, RH_TVS) && cdC.stats.tvs.src === 'l2beat' && cdC.stats.tvsBreakdown && near(rowC.tvs.v, RH_TVS) && rowC.stage === 'Stage 0' && rowC.isL2 === true
    && ethC && ethC.tvs.v === null && /L2s and L3s only/.test(ethC.tvs.why) && ethC.isL2 === false, brief({ tvs0, tvs: cdC.stats.tvs, row: rowC && rowC.tvs, eth: ethC && ethC.tvs }));

  const rg = await run('growthepie'), rs = await run('series');
  check('growthepie\'s fundamentals and the chain histories were read (DefiLlama TVL, DEX volume, app fees, stablecoins; growthepie txcount)', rg.ok && rs.ok && q1("SELECT COUNT(*) n FROM mkt_chain_series WHERE chain='robinhood' AND metric='tvl'").n > 100
    && q1("SELECT COUNT(*) n FROM mkt_chain_series WHERE chain='robinhood' AND metric='dex_volume'").n > 100 && q1("SELECT COUNT(*) n FROM mkt_chain_series WHERE chain='robinhood' AND metric='stables'").n > 100
    && q1("SELECT src FROM mkt_chain_series WHERE chain='robinhood' AND metric='txcount' LIMIT 1").src === 'growthepie' && q1("SELECT COUNT(*) n FROM mkt_chain_series WHERE chain='base' AND metric='fees'").n > 0, brief([rg.note, rs.note]));
  const today = dayOf(NOW);
  check('  ...and DefiLlama\'s point dated today (a partial day) was not stored as one; yesterday\'s is DefiLlama\'s full-day figure', !q1("SELECT 1 FROM mkt_chain_series WHERE day >= ?", today) && q1("SELECT value FROM mkt_chain_series WHERE chain='robinhood' AND metric='dex_volume' AND day='2026-10-25'").value === F.dexsRh.total24h,
    brief(q1("SELECT * FROM mkt_chain_series WHERE chain='robinhood' AND metric='dex_volume' ORDER BY day DESC LIMIT 1")));
  check('  ...the fees paid to every app on the chain (24 h) come with the histories, and a chain the sources lack is said in the note', /not read: /.test(rs.note) && JSON.parse(q1("SELECT value FROM mkt_state WHERE name='appfees'").value).robinhood.v === F.feesRh.total24h);

  // the pools: three daily batches at the start of three days, then one now
  for (const d of ['2026-10-24', '2026-10-25', '2026-10-26']) await run('pools', Date.parse(d + 'T00:05:00Z'));
  const rp = await run('pools');
  const spy = q1("SELECT base_name, name FROM mkt_pool_snap WHERE base_name LIKE 'SPDR S%' ORDER BY id DESC LIMIT 1");
  check('GeckoTerminal\'s HTML-escaped names ("S&amp;P") are stored decoded, so the page escapes them once and shows "S&P"', spy && spy.base_name === 'SPDR S&P 500 ETF Trust \u2022 Robinhood Token' && !/&amp;/.test(spy.name || ''), brief(spy));
  const nPools = new Set(allPools.map((p) => p.attributes.address)).size;
  check('the Robinhood Chain pools run read GeckoTerminal\'s pages until the list ended (2 pages of 20 here) and kept every pool once per batch', rp.ok && q1('SELECT COUNT(*) n FROM mkt_pool_snap WHERE network=? AND at=?', 'robinhood', NOW).n === nPools && /2 pages/.test(rp.note), rp.note);
  const usdgPool = q1("SELECT * FROM mkt_pool_snap WHERE network='robinhood' AND at=? AND pool='0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca'", NOW);
  const gp0 = F.gtP1.data[0].attributes;
  check('  ...each pool as GeckoTerminal gave it: price, reserve, FDV, market cap, volumes and changes by window, trades, the tokens and the DEX',
    usdgPool && usdgPool.base_addr === USDG && usdgPool.base_symbol === 'USDG' && usdgPool.quote_symbol === 'WETH' && usdgPool.dex === 'uniswap-v3-robinhood' && near(usdgPool.reserve_usd, Number(gp0.reserve_in_usd)) && near(usdgPool.vol_h24, Number(gp0.volume_usd.h24))
    && usdgPool.tx_h24 === gp0.transactions.h24.buys + gp0.transactions.h24.sells && near(usdgPool.chg_h1, Number(gp0.price_change_percentage.h1)) && /coin-images\.coingecko\.com/.test(usdgPool.base_logo), brief(usdgPool));
  const zeroMc = allPools.filter((p) => num(p.attributes.market_cap_usd) === 0).map((p) => p.attributes.address);
  check('  ...a market cap GeckoTerminal gives as null or 0 is kept as missing (null), never 0', q1('SELECT COUNT(*) n FROM mkt_pool_snap WHERE mcap_usd = 0').n === 0 && (zeroMc.length === 0 || zeroMc.every((a) => q1('SELECT mcap_usd FROM mkt_pool_snap WHERE pool=? AND at=?', a, NOW).mcap_usd === null)), zeroMc.join(','));
  const ro = await run('poolsOther'), rn = await run('newPoolsGt');
  check('the other networks\' pools (3 pages at most each) and new pools were read; an empty network answers nothing, honestly', ro.ok && q1("SELECT COUNT(*) n FROM mkt_pool_snap WHERE network='eth'").n === F.gtEth.data.length && /ethereum 20/.test(ro.note) && /solana 0/.test(ro.note)
    && rn.ok && q1("SELECT COUNT(*) n FROM mkt_new_pool WHERE chain='ethereum'").n === F.gtNewEth.data.length, brief([ro.note, rn.note]));

  // the pulse, the new pools from the chain, in the order the chain made them
  node.head = 97700000;
  const rpu1 = await run('pulse');
  const firstLogsAsk = node.ranges.length;
  node.head = HEAD;
  const rpu2 = await run('pulse', NOW + 60e3);
  const rnp = await run('newPoolsRh');
  const p1 = q1('SELECT * FROM mkt_rh_pulse ORDER BY id ASC LIMIT 1'), p2 = q1('SELECT * FROM mkt_rh_pulse ORDER BY id DESC LIMIT 1');
  check('the pulse reads block, gas, the base fee, ArbGasInfo\'s L1 calldata price and the 0.02 gwei floor from one batch', rpu1.ok && rpu2.ok && p2.block === HEAD && p2.gas_price_wei === parseInt(F.state['2'], 16) && p2.base_fee_wei === parseInt(F.state['5'].baseFeePerGas, 16)
    && p2.min_gas_wei === 20000000 && p2.l1_price_wei === 0, brief(p2));
  check('  ...the block time is the mean over an hour from two block timestamps, never a per-block guess', near(p1.block_time_ms, (tsAt(97700000) - tsAt(97700000 - 36000)) * 1000 / 36000, 1e-9) && p2.block_time_ms > 50 && p2.block_time_ms < 200, p1.block_time_ms + ' ' + p2.block_time_ms);
  check('  ...WETH and USDG supply and what the v4 PoolManager holds, every 10 minutes (the second minute did not ask again)', near(p1.weth_supply, Number(BigInt(F.state['15'])) / 1e18) && near(p1.usdg_supply, Number(BigInt(F.state['16'])) / 1e6) && near(p1.pm_eth, Number(BigInt(F.pm.eth)) / 1e18)
    && near(p1.pm_weth, Number(BigInt(F.pm.weth)) / 1e18) && near(p1.pm_usdg, Number(BigInt(F.pm.usdg)) / 1e6) && p2.weth_supply === null && p2.pm_eth === null, brief({ p1, p2: { w: p2.weth_supply } }));
  check('  ...and the canonical bridge on Ethereum every 15 minutes: its ETH, batches and delayed messages', near(p1.bridge_eth, Number(BigInt(F.bridge[1].result)) / 1e18) && p1.bridge_batches === parseInt(F.bridge[4].result, 16) && p1.bridge_msgs === parseInt(F.bridge[5].result, 16) && p2.bridge_eth === null && hits.eth === 1, brief({ b: p1.bridge_eth, n: p1.bridge_batches, h: hits.eth }));
  const npRows = qa("SELECT * FROM mkt_new_pool WHERE chain='robinhood' ORDER BY id");
  check('new pools on Robinhood Chain come from its own logs — v2 PairCreated, v3 PoolCreated, v4 Initialize — every one, once', rnp.ok && npRows.length === F.logs.v2.length + F.logs.v3.length + F.logs.v4.length
    && npRows.filter((r) => r.dex === 'v2').length === F.logs.v2.length && npRows.filter((r) => r.dex === 'v4').every((r) => /^0x[0-9a-f]{64}$/.test(r.pool) && JSON.parse(r.extra).hooks !== undefined) && npRows.every((r) => /^0x[0-9a-f]{40}$/.test(r.token0) && /^0x[0-9a-f]{40}$/.test(r.token1)), rnp.note);
  check('  ...in the chain\'s own order (ids follow blocks), with the first read going a day back and the cursor kept in the database', npRows.every((r, i, a) => i === 0 || a[i - 1].block <= r.block) && JSON.parse(q1("SELECT value FROM mkt_state WHERE name='rh_newpools'").value).cursor === HEAD
    && node.ranges.some(([k, f, t]) => k === 'v2' && t === HEAD && f === HEAD - 900000), brief(node.ranges.slice(-6)));
  check('  ...a range the node refuses (more than 10,000 logs) is read in halves until it answers — nothing lost', node.ranges.filter(([k]) => k === 'v4').length >= 3 && npRows.filter((r) => r.dex === 'v4').length === F.logs.v4.length, brief(node.ranges.filter(([k]) => k === 'v4')));
  const p2b = q1('SELECT * FROM mkt_rh_pulse WHERE id = ?', p2.id);
  check('  ...and the pulse row\'s "pools created since the previous row" is filled once the cursor has passed it — exact, by version', p2b.pools_created_v2 === F.logs.v2.length && p2b.pools_created_v3 === F.logs.v3.length && p2b.pools_created_v4 === F.logs.v4.length && q1('SELECT pools_created_v2 FROM mkt_rh_pulse WHERE id = ?', p1.id).pools_created_v2 === null, brief(p2b));
  const rnp2 = await run('newPoolsRh');
  check('  ...the next run reads only from the cursor on', rnp2.ok && /nothing new/.test(rnp2.note) || /blocks 98587508/.test(rnp2.note), rnp2.note);
  // a chain job steps aside while the site's own reads are refused
  busy = 'the site\'s own chain reads are queued'; const callsBefore = node.calls; const ry = await run('pulse', NOW + 120e3); busy = false;
  check('a chain job steps aside while the site\'s own chain reads are refused or queued — asks the node nothing, and its note gives the reason', !ry.ok && /yielded: the site's own chain reads are queued/.test(ry.note) && node.calls === callsBefore, brief(ry));
  node.throttle = true; const rt = await run('pulse', NOW + 180e3); node.throttle = false; const callsAfterThrottle = node.calls;
  const rt2 = await run('pulse', NOW + 200e3);
  check('  ...and after the node refuses one of its reads it cools down for five minutes', !rt.ok && !rt2.ok && /cooling down/.test(rt2.note) && node.calls === callsAfterThrottle, brief([rt.note, rt2.note]));

  // the radar and the re-scan
  const rr = await run('radar');
  check('the radar sweep keeps its pairs (across restarts) and the block it read up to; pairs found but not yet enriched keep their place', rr.ok && q1('SELECT COUNT(*) n FROM mkt_radar').n === 2 && q1('SELECT symbol, verdict, health, liquidity_usd FROM mkt_radar WHERE pair=?', '0x' + 'ab'.repeat(20)).verdict === 'caution'
    && JSON.parse(q1("SELECT value FROM mkt_state WHERE name='radar'").value).cursor === 98587100, rr.note);
  const rest = md.radarRestore(120);
  check('  ...and a restart resumes from them: the cursor and the raw pairs, oldest first', rest.cursor === 98587100 && rest.raw.length === 2 && rest.raw[0].block === 98587000 && rest.raw[1].pair === '0x' + 'ef'.repeat(20), brief(rest));
  const A = '0x' + '1a'.repeat(20), Bt = '0x' + '2b'.repeat(20), C = '0x' + '3c'.repeat(20);
  for (let i = 3; i > 0; i--) { clock = NOW - 3600e3 * i * 4; md.scanPut('robinhood', A, radarPairs[0], { src: 'scan' }); }   // oldest first, as a clock runs
  clock = NOW - 3600e3; md.scanPut('ethereum', Bt, radarPairs[0], { src: 'market' });
  for (let i = 5; i > 0; i--) { clock = NOW - 3600e3 * i * 3; md.scanPut('robinhood', C, radarPairs[0], { src: 'refresh' }); }
  clock = NOW - 10 * 864e5; md.scanPut('robinhood', '0x' + '4d'.repeat(20), radarPairs[0], { src: 'scan' });
  clock = NOW; md.scanPut('robinhood', A, radarPairs[0], { src: 'scan' }); md.scanPut('robinhood', A, radarPairs[0], { src: 'scan' });
  check('every scan is kept: one row per token and source per ten minutes, its n counting the scans folded in', q1("SELECT n FROM mkt_scan WHERE address=? AND at=?", A, NOW).n === 2 && q1("SELECT COUNT(*) n FROM mkt_scan WHERE address=?", A).n === 4 && q1("SELECT verdict, health, holders, liquidity_usd, symbol FROM mkt_scan WHERE address=? LIMIT 1", A).health === 55);
  const top = md.mostScanned(40);
  check('  ...the most-scanned of the last 7 days are what people scanned (the Scanner and the Market Data page) — the re-scan\'s own reads and older scans do not count', top.length === 2 && top[0].address === A && top[0].scans === 5 && top[1].address === Bt && !top.some((t) => t.address === C), brief(top));
  const rsc = await run('scans');
  check('the hourly re-scan reads those tokens again (quietly, through the hook) and keeps each reading as a "refresh"', rsc.ok && refreshed.join() === 'robinhood:' + A + ',ethereum:' + Bt && q1("SELECT COUNT(*) n FROM mkt_scan WHERE src='refresh' AND address=?", A).n === 1, rsc.note);

  /* ── the answers ── */
  const ch = md.chains({}).body;
  check('the chains list: DeFi TVL highest first by default, each figure { v, src, at } with its label, the window and the notes', ch.sort === 'tvl' && ch.dir === 'desc' && ch.window.kind === '24h' && ch.rows[0].key === 'ethereum' && ch.rows.every((r, i, a) => i === 0 || a[i - 1].tvl.v >= r.tvl.v)
    && ch.rows[0].tvl.src === 'defillama' && ch.rows[0].tvl.at === NOW && /DeFi TVL/.test(ch.rows[0].tvl.label) && ch.notes.length >= 3 && ch.total >= 40 && ch.rows.length === Math.min(50, ch.total), brief({ n: ch.rows.length, t: ch.total, r: ch.rows[0] }));
  // DefiLlama's feeds name chain icons at icons.llamao.fi/chains/…, which answers 404 since the files moved under /icons/chains/ (2026-10-27)
  const ethLogo = (ch.rows.find((r) => r.key === 'ethereum') || {}).logo;
  check('chain logos point where DefiLlama keeps them now (/icons/chains/; the feeds\' /chains/ answers 404): stored mended, served mended, and an address stored before the fix is mended on the way out',
    q1("SELECT logo FROM mkt_chain_snap WHERE chain = 'ethereum' ORDER BY id DESC LIMIT 1").logo === 'https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg'
    && decodeURIComponent(String(ethLogo).split('?u=')[1] || '') === 'https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg'
    && MD.llamaIcon('https://icons.llamao.fi/chains/rsz_op%20mainnet.jpg') === 'https://icons.llamao.fi/icons/chains/rsz_op%20mainnet.jpg' && MD.llamaIcon('https://icons.llamao.fi/icons/protocols/x') === 'https://icons.llamao.fi/icons/protocols/x' && MD.llamaIcon(null) === null,
    brief({ ethLogo }));
  const rhRow = ch.rows.find((r) => r.key === 'robinhood');
  check('  ...Robinhood Chain in it: market cap null with why, liquidity labelled DEX liquidity, gas fees, TVS, stage, an L2, its GeckoTerminal network', rhRow && rhRow.mcap.v === null && rhRow.mcap.why === 'No native token — gas is paid in ETH' && /DEX liquidity/.test(rhRow.liquidity.label) && rhRow.fees.v === RH_FEES.total24h
    && near(rhRow.tvs.v, RH_TVS) && rhRow.stage === 'Stage 0' && rhRow.isL2 === true && rhRow.gtNetwork === 'robinhood' && rhRow.chainId === 4663 && /\/api\/market\/logo\?u=https%3A%2F%2Ficons\.llamao\.fi/.test(rhRow.logo || ''), brief(rhRow));
  const byMcapAsc = md.chains({ sort: 'mcap', dir: 'asc', limit: 200 }).body.rows, byMcapDesc = md.chains({ sort: 'mcap', dir: 'desc', limit: 200 }).body.rows;
  const firstNull = (rows) => rows.findIndex((r) => r.mcap.v == null);
  check('sorting by market cap, both ways: a chain with no figure is listed last in BOTH directions', firstNull(byMcapAsc) > 0 && byMcapAsc.slice(firstNull(byMcapAsc)).every((r) => r.mcap.v == null) && byMcapAsc.slice(0, firstNull(byMcapAsc)).every((r, i, a) => i === 0 || a[i - 1].mcap.v <= r.mcap.v)
    && byMcapDesc.slice(firstNull(byMcapDesc)).every((r) => r.mcap.v == null) && byMcapDesc.slice(0, firstNull(byMcapDesc)).every((r, i, a) => i === 0 || a[i - 1].mcap.v >= r.mcap.v) && byMcapDesc[0].key === 'ethereum', brief(byMcapAsc.slice(0, 3).map((r) => [r.key, r.mcap.v])));
  const byVol = md.chains({ sort: 'volume', dir: 'desc' }).body.rows, byLiqAsc = md.chains({ sort: 'liquidity', dir: 'asc' }).body.rows, byFees = md.chains({ sort: 'fees', limit: 5 }).body;
  check('  ...and by volume, liquidity (lowest first) and fees', byVol.every((r, i, a) => i === 0 || a[i - 1].volume.v == null || r.volume.v == null || a[i - 1].volume.v >= r.volume.v) && byLiqAsc.every((r, i, a) => i === 0 || a[i - 1].liquidity.v == null || r.liquidity.v == null || a[i - 1].liquidity.v <= r.liquidity.v) && byFees.rows.length === 5 && byFees.sort === 'fees');
  const w30 = md.chains({ window: '30d', limit: 200 }).body.rows.find((r) => r.key === 'robinhood'), w7 = md.chains({ window: '7d', limit: 200 }).body.rows;
  const rh7 = w7.find((r) => r.key === 'robinhood'), eth7 = w7.find((r) => r.key === 'ethereum');
  const dayVol = (d) => { const pt = F.dexsRh.totalDataChart.find((p) => dayOf(p[0] * 1000) === d); return pt ? pt[1] : null; };
  const want7 = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'].reduce((a, d) => a + dayVol(d), 0);
  check('windows: 30 days is DefiLlama\'s 30-day breakdown; 7 days is the last 7 whole UTC days of the daily history; a chain with no history says why (not 0)', near(w30.volume.v, RH_VOL30) && near(w30.fees.v, RH_FEES.total30d) && near(rh7.volume.v, want7) && rh7.volume.days === 7
    && eth7.volume.v === null && /no daily history/.test(eth7.volume.why), brief({ w30: w30.volume, rh7: rh7.volume, eth7: eth7.volume }));
  const cus = md.chains({ window: 'custom', from: '2026-10-01', to: '2026-10-20', limit: 200 }).body, rhc = cus.rows.find((r) => r.key === 'robinhood');
  const wantC = F.dexsRh.totalDataChart.filter((p) => { const d = dayOf(p[0] * 1000); return d >= '2026-10-01' && d <= '2026-10-20'; }).reduce((a, p) => a + p[1], 0);
  const tvlOn = (d) => F.histtvl.find((p) => dayOf(p.date * 1000) === d).tvl;
  check('a custom window (whole UTC days, both ends in): volume summed over its days, TVL the end value with the start and the change', cus.window.kind === 'custom' && cus.window.days === 20 && near(rhc.volume.v, wantC) && rhc.tvl.v === tvlOn('2026-10-20') && rhc.tvl.start === tvlOn('2026-10-01')
    && near(rhc.tvl.change, (tvlOn('2026-10-20') - tvlOn('2026-10-01')) / tvlOn('2026-10-01') * 100) && rhc.stables.v != null && /custom window/.test(cus.notes.join(' ')), brief({ v: rhc.volume, t: rhc.tvl }));
  const early = md.chains({ window: 'custom', from: '2026-03-01', to: '2026-06-30', limit: 200 }).body.rows.find((r) => r.key === 'robinhood');
  check('  ...a window that starts before our history says where the history starts, and is never filled in', early.volume.v === null && /^our history starts 2026-06-1/.test(early.volume.why) && early.tvl.v === null && /our history starts/.test(early.tvl.why), brief(early.volume));
  const bad1 = md.chains({ window: 'custom', from: '2026-10-01', to: today }), bad2 = md.chains({ window: 'custom', from: '2026-10-05', to: '2026-10-01' }), bad3 = md.chains({ window: '90d' }), bad4 = md.chains({ window: 'custom', from: '2026-02-30', to: '2026-03-01' });
  check('  ...and today (not a whole day yet), a reversed window, an unknown window and an impossible date are refused, each with its reason', bad1.status === 400 && /whole UTC day/.test(bad1.body.error) && bad2.status === 400 && bad3.status === 400 && bad4.status === 400, brief([bad1.body, bad2.body, bad3.body, bad4.body]));

  const cd = md.chain({ key: 'robinhood' }).body;
  check('one chain in full: the stats (each a figure), TVS split, stage and risks (L2BEAT), the daily history with each series\' source', cd.key === 'robinhood' && near(cd.stats.tvl.v, RH_LLAMA.tvl) && near(cd.stats.volume24h.v, RH_VOL24) && near(cd.stats.volume7d.v, want7) && cd.stats.fees24h.v === RH_FEES.total24h && cd.stats.appFees24h.v === F.feesRh.total24h
    && cd.stats.mcap.v === null && cd.stats.tvsBreakdown && cd.stats.tvsBreakdown.native > 0 && cd.stats.stage === 'Stage 0' && cd.stats.risks.length === 5 && cd.stats.txcount24h.src === 'growthepie' && cd.stats.txcount24h.day === '2026-10-25'
    && Array.isArray(cd.history.tvl) && cd.history.tvl.length > 100 && cd.history.src.tvl === 'defillama' && cd.history.src.txcount === 'growthepie' && Array.isArray(cd.history.tvl[0]) && cd.history.tvl[0].length === 2, brief(cd.stats.txcount24h));
  check('  ...its top tokens (GeckoTerminal), its newest pools (20 at most), the pulse, and every source named — growthepie with its CC BY 4.0 attribution', cd.topTokens.rows.length > 0 && /most-traded pools/.test(cd.topTokens.basis) && cd.newPools.length === Math.min(20, F.logs.v2.length + F.logs.v3.length + F.logs.v4.length) && cd.pulse && cd.pulse.now.block === HEAD
    && cd.pulse.now.wethSupply > 40000 && cd.pulse.now.pm.usdg > 0 && cd.pulse.now.bridgeEth > 200000 && cd.pulse.now.minGasGwei === 0.02 && cd.sources.some((s) => s.id === 'growthepie' && s.licence === 'CC BY 4.0' && /growthepie/.test(s.attribution)) && cd.sources.some((s) => s.id === 'l2beat' && /projects\/robinhood/.test(s.url)) && cd.sources.some((s) => s.id === 'rpc'),
    brief({ p: cd.pulse.now, s: cd.sources.map((s) => s.id) }));
  check('  ...pools created in the last 24 h are not claimed before our own reads reach that far back', cd.pulse.poolsCreated.h24 === null && /do not reach 24 hours back/.test(cd.pulse.poolsCreated.why), brief(cd.pulse.poolsCreated));
  const stNp = JSON.parse(q1("SELECT value FROM mkt_state WHERE name='rh_newpools'").value);
  dbA.prepare('INSERT INTO mkt_rh_pulse (at, block) VALUES (?, ?)').run(NOW - 864e5 - 5 * 60e3, stNp.start);
  const cd2 = md.chain({ key: 'robinhood' }).body;
  check('  ...and once they do, by version, from the block a stored pulse row says was the head 24 hours ago to the cursor', cd2.pulse.poolsCreated.h24 && cd2.pulse.poolsCreated.h24.v2 === F.logs.v2.length && cd2.pulse.poolsCreated.h24.v4 === F.logs.v4.length && cd2.pulse.poolsCreated.toBlock === HEAD && /not tokens/.test(cd2.pulse.poolsCreated.label), brief(cd2.pulse.poolsCreated));
  check('  ...an unknown chain is a 404, and a chain the pools are not read for says so instead of listing nothing', md.chain({ key: 'nope' }).status === 404 && md.chain({ key: 'bitcoin' }).body.topTokens.rows.length === 0 && /does not read/.test(md.chain({ key: 'bitcoin' }).body.topTokens.why));

  // the tokens of a chain
  const tk = md.tokens({ chain: 'robinhood', limit: 200, include: 'all' }).body;
  const tUsdg = tk.rows.find((r) => r.address === USDG);
  check('the token list groups the most-traded pools by token: liquidity is the sum of its pools\' reserves (never GeckoTerminal\'s token-level reserve), volume the sum of their volumes', tk.network === 'robinhood' && tk.basis === 'the ' + nPools + ' most-traded pools on GeckoTerminal, grouped by token' && tk.rows.length === groupBy.size
    && tUsdg && near(tUsdg.liquidity.v, tokLiq(USDG)) && tUsdg.liquidity.pools === groupBy.get(USDG).length && near(tUsdg.volume.v, tokVol(USDG)) && tUsdg.scannable === true && tUsdg.liquidity.src === 'geckoterminal' && tUsdg.liquidity.at === NOW, brief(tUsdg));
  check('  ...a market cap that is a global figure (larger than this chain\'s FDV — USDG: $3.15B against $674M) is flagged "global-mcap", said so, and kept out of the market-cap sort', tUsdg.flags.includes('global-mcap') && tUsdg.mcap.global === true && /not this chain/.test(tUsdg.mcap.label)
    && (() => { const s = md.tokens({ chain: 'robinhood', sort: 'mcap', dir: 'desc', limit: 200 }).body.rows; const i = s.findIndex((r) => r.address === USDG); return i >= s.findIndex((r) => r.mcap.v == null || r.mcap.global); })(), brief(tUsdg.mcap));
  const noMc = tk.rows.find((r) => r.mcap.v === null);
  check('  ...a token GeckoTerminal has no market cap for says so (null, why), never 0; FDV is labelled with the supply it uses', noMc && /GeckoTerminal has no market cap/.test(noMc.mcap.why) && /total supply/.test(tUsdg.fdv.label) && !tk.rows.some((r) => r.mcap.v === 0), brief(noMc && noMc.mcap));
  check('  ...thin pools (under $10,000) and wash volume (24 h volume over 100× liquidity) are flagged', WASH.length > 0 && THIN.length > 0 && WASH.every((a) => tk.rows.find((r) => r.address === a).flags.includes('wash')) && THIN.every((a) => tk.rows.find((r) => r.address === a).flags.includes('thin')), brief({ wash: WASH.length, thin: THIN.length }));
  const hv = md.tokens({ chain: 'robinhood', sort: 'volume', dir: 'desc', limit: 200 }).body;
  check('  ...and wash-flagged tokens are left out of "highest volume" (and the list says so) unless include=all', !hv.rows.some((r) => r.flags.includes('wash')) && hv.rows.length === groupBy.size - WASH.length && hv.notes.some((n) => /left out of the highest-volume list/.test(n)) && hv.rows.every((r, i, a) => i === 0 || a[i - 1].volume.v >= r.volume.v));
  const la = md.tokens({ chain: 'robinhood', sort: 'liquidity', dir: 'asc', limit: 200 }).body, h1 = md.tokens({ chain: 'robinhood', window: '1h', limit: 200, include: 'all' }).body;
  check('  ...a token whose pools GeckoTerminal answers with a 0 reserve has no liquidity reading (null, why) and no thin/wash flag on it', UNREAD.every((a) => { const r = tk.rows.find((x) => x.address === a); return r && r.liquidity.v === null && /not read/.test(r.liquidity.why) && !r.flags.includes('thin') && !r.flags.includes('wash'); }), brief({ unread: UNREAD.length }));
  check('  ...lowest first works, and says it is the lowest within this list, never the chain\'s; the 1 h window sums the pools\' 1 h volumes', (() => { const v = la.rows.map((r) => r.liquidity.v); const k = v.findIndex((x) => x == null); return (k < 0 || v.slice(k).every((x) => x == null)) && v.filter((x) => x != null).every((x, i, a) => i === 0 || a[i - 1] <= x); })() && /never the whole chain/.test(la.notes[0]) && near(h1.rows.find((r) => r.address === USDG).volume.v, tokVol(USDG, 'h1')) && /last hour/.test(h1.window.label));
  const tc1 = md.tokens({ chain: 'robinhood', window: 'custom', from: '2026-10-24', to: '2026-10-25', limit: 200, include: 'all' }).body;
  const tcU = tc1.rows.find((r) => r.address === USDG);
  check('a custom token window is served only from our own snapshots: each day\'s volume is the 24 h figure of the first batch after it ended; the coverage is said', tc1.coverage && tc1.coverage.from === '2026-10-24' && tcU && near(tcU.volume.v, 2 * tokVol(USDG)) && tcU.volume.days === 2 && tcU.volume.src === 'site' && tcU.change.v === 0, brief({ c: tc1.coverage, v: tcU && tcU.volume }));
  const tc2 = md.tokens({ chain: 'robinhood', window: 'custom', from: '2026-10-20', to: '2026-10-25' }).body;
  check('  ...a window outside that coverage says "our history starts <date>" on every row, never a number', tc2.rows.length > 0 && tc2.rows.every((r) => r.volume.v === null && r.volume.why === 'our history starts 2026-10-24') && tc2.coverage.from === '2026-10-24', brief(tc2.rows[0] && tc2.rows[0].volume));
  const tOther = md.tokens({ chain: 'bitcoin' }).body, tEth = md.tokens({ chain: 'ethereum' }).body;
  check('  ...another tracked network lists its own pools; a chain whose pools are not read says so', tEth.network === 'eth' && tEth.rows.length > 0 && tEth.rows[0].scannable === true && tOther.rows.length === 0 && /reads the pools of/.test(tOther.why));
  // every network's tokens in one list (owner, 2026-10-27), from what the collectors above really wrote: Robinhood Chain's pools and
  // the same answer re-keyed as Ethereum's (so USDG sits at one address on two chains), every other network's page empty
  const ta = md.tokens({ chain: 'all', limit: 200, include: 'all' }).body, tkEth = md.tokens({ chain: 'ethereum', limit: 200, include: 'all' }).body;
  const plain = (r) => { const o = Object.assign({}, r); delete o.chainName; delete o.chainLogo; return JSON.stringify(o); };
  const same = (rows, single) => rows.length === single.rows.length && rows.every((r) => { const s = single.rows.find((x) => x.address === r.address); return s && plain(r) === JSON.stringify(s); });
  const usdgs = ta.rows.filter((r) => r.address === USDG);
  check('chain=all: every tracked network\'s newest finished batch in one list, grouped per (chain, address) exactly as each chain\'s own list — the same figures, flags and nulls row for row', ta.chain === 'all' && ta.network === null
    && same(ta.rows.filter((r) => r.chain === 'robinhood'), tk) && same(ta.rows.filter((r) => r.chain === 'ethereum'), tkEth) && ta.rows.length === tk.rows.length + tkEth.rows.length && ta.total === ta.rows.length,
    brief({ n: ta.rows.length, rh: tk.rows.length, eth: tkEth.rows.length, r0: ta.rows[0] }));
  check('  ...the same token on two chains (USDG at one address on Robinhood Chain and on Ethereum) is two rows, each with its chain key, name and logo (our proxy, DefiLlama\'s chain icon)', usdgs.length === 2
    && usdgs.map((r) => r.chain).sort().join() === 'ethereum,robinhood' && usdgs.find((r) => r.chain === 'robinhood').chainName === 'Robinhood Chain' && usdgs.find((r) => r.chain === 'ethereum').chainName === 'Ethereum'
    && ta.rows.every((r) => /^\/api\/market\/logo\?u=https%3A%2F%2Ficons\.llamao\.fi%2Ficons%2Fchains%2F/.test(r.chainLogo || '')) && Object.keys(ta.rows[0]).slice(0, 4).join() === 'chain,chainName,chainLogo,address', brief(usdgs.map((r) => [r.chain, r.chainName, r.chainLogo])));
  const taNets = ta.networks.map((n) => n.key);
  check('  ...the answer says which networks were read, when and how many pools each, and names every one not read yet instead of dropping it', taNets.join() === MD.GT_TRACKED.join()
    && ta.networks.find((n) => n.key === 'robinhood').pools === nPools && ta.networks.find((n) => n.key === 'robinhood').most === 200 && ta.networks.find((n) => n.key === 'ethereum').pools === F.gtEth.data.length && ta.networks.find((n) => n.key === 'ethereum').most === 60
    && ta.networks.filter((n) => !n.pools).length === 7 && ta.networks.filter((n) => !n.pools).every((n) => n.at === null && /not been read yet/.test(n.why))
    && ta.notes.some((x) => /^Read: Robinhood Chain, \d+ pools at 2026-10-26 18:00 UTC \(its 200 most-traded at most, read every 10 minutes\); Ethereum, 20 pools at .* read hourly\)\.$/.test(x))
    && ta.notes.some((x) => /^Not read yet: Solana \(read hourly\), Base \(read hourly\), .*OP Mainnet \(read hourly\) — named here rather than left out/.test(x)) && /of 2 networks \(\d+ pools\), grouped by token on each chain/.test(ta.basis), brief({ nets: ta.networks.slice(0, 3), notes: ta.notes }));
  const taHv = md.tokens({ chain: 'all', limit: 200 }).body;
  check('  ...wash-flagged tokens are left out of its highest-volume list too (and it says so), unless include=all', !taHv.rows.some((r) => r.flags.includes('wash')) && taHv.rows.length === ta.rows.length - ta.rows.filter((r) => r.flags.includes('wash')).length && taHv.notes.some((n) => /left out of the highest-volume list/.test(n)));
  const plainRh = md.tokens({ chain: 'robinhood' }).body;
  check('  ...and chain=<one key> answers exactly as before: no chain fields on its rows, no networks list', !('networks' in plainRh) && !('oldestAt' in plainRh) && plainRh.rows.every((r) => !('chainName' in r) && !('chainLogo' in r)) && plainRh.chain === 'robinhood');

  // one token
  hits['gt-ohlcv'] = 0;
  const td = (await md.token({ chain: 'robinhood', address: USDG })).body;
  check('a token in full: its pools (deepest first), price, FDV, liquidity across them, every window, its links, and the Scanner\'s address for it', td.symbol === 'USDG' && td.pools.length === groupBy.get(USDG).length && td.pools.every((p, i, a) => i === 0 || a[i - 1].reserveUsd >= p.reserveUsd) && near(td.liquidity.v, tokLiq(USDG))
    && near(td.windows['24h'].volume.v, tokVol(USDG)) && near(td.windows['5m'].volume.v, tokVol(USDG, 'm5')) && td.windows['1h'].txns.v === null && td.scanner.supported === true && td.scanner.href === '/newpairs?scan=' + USDG + '&chain=robinhood' && /burned tokens/.test(td.supplyBasis), brief(td).slice(0, 300));
  check('  ...hourly candles of its deepest pool, oldest first, the hour in progress labelled as such', td.candles.rows && td.candles.rows.length === F.ohlcvH.data.attributes.ohlcv_list.length && td.candles.rows.every((c, i, a) => i === 0 || a[i - 1][0] < c[0]) && td.candles.partialLast === true && td.candles.src === 'geckoterminal' && td.candles.pool === td.pools[0].pool && hits['gt-ohlcv'] === 1, brief(td.candles).slice(0, 200));
  await md.token({ chain: 'robinhood', address: USDG });
  check('  ...and the candles are kept ten minutes (a second read asks GeckoTerminal nothing)', hits['gt-ohlcv'] === 1);
  const tdc = (await md.token({ chain: 'robinhood', address: USDG, window: 'custom', from: '2026-10-20', to: '2026-10-25' })).body;
  const cs = F.ohlcvH.data.attributes.ohlcv_list.filter((c) => c[0] * 1000 >= Date.parse('2026-10-20T00:00:00Z') && c[0] * 1000 < Date.parse('2026-10-26T00:00:00Z')).sort((a, b) => a[0] - b[0]);
  check('  ...a custom window in the detail view is summed from its candles (an hour with no candle had no trades) with the price change, and says its coverage', tdc.custom && near(tdc.custom.volume.v, cs.reduce((a, c) => a + c[5], 0)) && near(tdc.custom.priceChange.v, (cs[cs.length - 1][4] - cs[0][1]) / cs[0][1] * 100) && tdc.custom.coverage.tf === 'hour' && /hourly candles/.test(tdc.custom.volume.label), brief(tdc.custom).slice(0, 300));
  const tde = (await md.token({ chain: 'robinhood', address: USDG, window: 'custom', from: '2026-08-01', to: '2026-08-10' })).body;
  check('  ...a window before the candles GeckoTerminal gives says where they start', tde.custom && tde.custom.volume.v === null && /candles for this pool start 2026-09-15/.test(tde.custom.volume.why), brief(tde.custom));
  const ts = (await md.token({ chain: 'robinhood', address: SEND })).body;
  check('a token not among the most-traded pools is read from GeckoTerminal\'s token read, its links and logo from Dexscreener', ts.symbol === 'SEND' && ts.pools.length >= 1 && ts.basis === 'GeckoTerminal\'s token read, just now' && ts.mcap.v === null && /no market cap/.test(ts.mcap.why) && ts.links.websites.length + ts.links.socials.length > 0 && ts.links.src === 'dexscreener', brief({ p: ts.pools, l: ts.links, m: ts.mcap }));
  const t404 = await md.token({ chain: 'robinhood', address: '0x' + '9'.repeat(40) }), t400 = await md.token({ chain: 'robinhood', address: 'nope' }), t400b = await md.token({ chain: 'bitcoin', address: SEND });
  check('  ...a token GeckoTerminal does not know is a 404 that says so; a bad address or an untracked chain is a 400', t404.status === 404 && /does not know/.test(t404.body.error) && t400.status === 400 && t400b.status === 400);

  // search
  const s1 = (await md.search({ q: 'USDG' })).body, s2 = (await md.search({ q: 'robinhood' })).body, s3 = (await md.search({ q: SEND })).body, s0 = await md.search({ q: 'a' });
  check('search: our own tables first (the pool snapshots, the scans, the radar), then Dexscreener — each answer says where it came from', s1.tokens[0] && s1.tokens[0].address === USDG && s1.tokens[0].src === 'geckoterminal' && s1.tokens.some((t) => t.chain === 'ethereum')
    && s2.chains.some((c) => c.key === 'robinhood') && s2.tokens.every((t) => /robinhood/i.test(t.symbol + ' ' + t.name)) && s3.tokens.some((t) => t.address === SEND && t.src === 'dexscreener') && s0.status === 400, brief({ s1: s1.tokens.slice(0, 2), s2: s2.chains, s3: s3.tokens }));
  const dsBefore = hits['ds-search'];
  await md.search({ q: 'robinhood' });
  check('  ...and a search is kept five minutes (Dexscreener is not asked again)', hits['ds-search'] === dsBefore);
  const sr = (await md.search({ q: 'Radar' })).body;
  check('  ...the radar\'s and the Scanner\'s tokens are found by name too', sr.tokens.some((t) => t.symbol === 'RADAR' && t.src === 'site'));

  // new pools, status
  const np = md.newPools({ chain: 'robinhood', limit: 5 }).body, np2 = md.newPools({ chain: 'robinhood', limit: 5, before: np.next }).body, npAll = md.newPools({ chain: 'robinhood', limit: 200 }).body;
  check('the newest pools page by id (newest first), say they are read from the chain, and carry the cursor', np.rows.length === 5 && np.next && np2.rows.length === 5 && np2.rows[0].id < np.rows[4].id && np.src === 'rpc' && np.cursor.block === HEAD && /read from the chain/.test(np.label)
    && npAll.rows.some((r) => r.dex === 'v4' && /^0x[0-9a-f]{40}$/.test(r.hooks || '') && r.fee != null) && npAll.rows.some((r) => r.dex === 'v3' && r.fee != null) && npAll.next === null, brief(np.rows.slice(0, 2)));
  const stt = md.status().body;
  dump('chains', ch); dump('chains-custom', cus); dump('chain-robinhood', cd2); dump('tokens-robinhood', tk); dump('tokens-custom', tc1); dump('token-usdg', td); dump('token-usdg-custom', tdc); dump('token-send', ts);
  dump('search-usdg', s1); dump('search-robinhood', s2); dump('new-pools-robinhood', np); dump('status', stt);
  // every network's list and Ethereum's own, at each window (the page's fixtures for the Top tokens chain filter are cut from these)
  for (const [wk, wq] of [['24h', {}], ['6h', { window: '6h' }], ['1h', { window: '1h' }], ['5m', { window: '5m' }], ['custom', { window: 'custom', from: '2026-10-24', to: '2026-10-25' }]]) {
    for (const c of ['all', 'ethereum']) dump('tokens-' + c + '-' + wk, md.tokens(Object.assign({ chain: c, limit: 200, include: 'all' }, wq)).body);
  }
  check('the status lists every collector (last run, ok, ms, requests, note, next run) and every table (rows, oldest, newest)', stt.collectors.length === Object.keys(MD.JOBS).length && stt.collectors.find((c) => c.job === 'pools').ok === true && stt.collectors.every((c) => 'nextAt' in c && 'calls' in c)
    && stt.tables.find((t) => t.name === 'mkt_pool_snap').rows > 0 && stt.tables.every((t) => 'oldestAt' in t && 'newestAt' in t) && stt.enabled === false && /MARKET_COLLECT=1/.test(stt.note), brief(stt.collectors[0]));

  // the Send API's resources, straight from the module
  const r1 = await md.apiResource('chain-snapshots', {}, { limit: 3 }), r2 = await md.apiResource('chain-snapshots', {}, { limit: 3, before: r1.body.next });
  const r3 = await md.apiResource('scans', { chain: 'robinhood', address: A }, { limit: 50 }), r4 = await md.apiResource('chain-history', { key: 'robinhood', metric: 'tvl', from: '2026-10-01', to: '2026-10-05' }, {});
  const r5 = await md.apiResource('chains', {}, { limit: 100 }), r6 = await md.apiResource('nope', {}, {}), r7 = await md.apiResource('chain-history', { key: 'robinhood', metric: 'bogus' }, {});
  check('the Send API resources page by before / limit, filter by chain / address / metric, and give raw logo URLs (programs, not browsers)', r1.body.data.length === 3 && r2.body.data[0].id < r1.body.data[2].id && typeof r1.body.data[0].src === 'object'
    && r3.body.data.length === 5 && r3.body.data.every((x) => x.address === A) && r4.body.data.length === 5 && r4.body.data[0].day === '2026-10-01' && r5.body.data.length >= 40 && r6 === null && r7.status === 400
    && /^https:\/\/icons\.llamao\.fi\//.test(r5.body.data.find((x) => x.key === 'robinhood').logo || ''), brief({ r1: r1.body.next, r3: r3.body.data.length, r4: r4.body.data.length }));
  check('  ...every resource the contract names is served', ['chains', 'chain', 'chain-history', 'chain-snapshots', 'tokens', 'token', 'pools', 'new-pools', 'radar', 'scans', 'pulse', 'collectors'].every((n) => md.RESOURCES.includes(n)));

  // the budgets
  const gtTakes = meter.log.filter(([k]) => k === 'market:geckoterminal' || k === 'market:geckoterminal-asked').length, gtHits = Object.entries(hits).filter(([k]) => k.startsWith('gt-')).reduce((a, [, v]) => a + v, 0);
  const hostTakes = meter.log.filter(([k]) => k === '127.0.0.1:' + vendor.address().port).length;
  check('the meter is consulted for every read: every request took its host\'s meter, every GeckoTerminal one Market Data\'s share first, and every chain batch the chain share', gtTakes === gtHits && gtTakes > 10 && hostTakes === log.length && meter.log.filter(([k]) => k === 'market:rpc').length === node.calls,
    brief({ gtTakes, gtHits, hostTakes, requests: log.length, rpc: node.calls, rpcTakes: meter.log.filter(([k]) => k === 'market:rpc').length }));
  let gtAllowed = 2; meter.refuse = (k) => k === 'market:geckoterminal' && gtAllowed-- <= 0;
  const before = (hits['gt-pools'] || 0);
  clock = NOW + 30e3; const rb = await md.runJob('pools'); meter.refuse = null; clock = NOW;
  const partial = md.tokens({ chain: 'robinhood' }).body;
  check('a spent meter stops a collector before it asks: two GeckoTerminal pages allowed → two asked, and the run says where it stopped', (hits['gt-pools'] || 0) - before === 2 && /stopped at page 3: the GeckoTerminal budget was spent/.test(rb.note), rb.note + ' ' + ((hits['gt-pools'] || 0) - before));
  check('  ...and the token list built on that batch says the read stopped short', /the read stopped at page 3: the GeckoTerminal budget was spent/.test(partial.basis), partial.basis);
  // three tokens of the snapshot whose candles nobody has read yet (each read below asks GeckoTerminal once)
  const fresh = tk.rows.filter((r) => ![USDG, SEND].includes(r.address)).map((r) => r.address);
  // the collectors' share spent — as when their pages are queued on it for minutes: a person's read is not held behind them
  const gtShares = () => meter.log.filter(([k]) => k.startsWith('market:geckoterminal'));
  meter.refuse = (k) => k === 'market:geckoterminal'; meter.log.length = 0;
  const tdo = (await md.token({ chain: 'robinhood', address: fresh[0] })).body; meter.refuse = null;
  check('a person\'s token read has a GeckoTerminal share of its own: with the collectors\' share spent (they queue on it for minutes), the candles still come', tdo.candles && Array.isArray(tdo.candles.rows) && tdo.candles.rows.length > 0
    && gtShares().length === 1 && gtShares()[0][0] === 'market:geckoterminal-asked', brief({ c: tdo.candles && tdo.candles.why, log: meter.log }));
  meter.refuse = (k) => k === 'market:geckoterminal-asked'; meter.log.length = 0;
  const tdf = (await md.token({ chain: 'robinhood', address: fresh[1] })).body; meter.refuse = null;
  check('  ...and when its own share is spent it may take a slot of the collectors\' that is free right now (waiting the short wait, never their long one)', tdf.candles && Array.isArray(tdf.candles.rows) && tdf.candles.rows.length > 0
    && gtShares().map(([k]) => k).join() === 'market:geckoterminal-asked,market:geckoterminal' && gtShares().every(([, w]) => w === 1000), brief(meter.log));
  meter.refuse = (k) => k === 'market:geckoterminal' || k === 'market:geckoterminal-asked';
  const tdb = (await md.token({ chain: 'robinhood', address: fresh[2] })).body; meter.refuse = null;
  check('  ...and a person waiting is told the truth when both are spent ("being asked a lot right now"), never shown an empty chart as data', (tdb.candles && tdb.candles.rows === null && /being asked a lot/.test(tdb.candles.why) && tdb.candles.retry === true) || (tdb.unavailable && /being asked a lot/.test(tdb.why)), brief(tdb.candles || tdb));
  check('the background waits its turn on the meter (up to its long wait); a person\'s read waits at most the short one', /const ASK_WAIT = deps\.askWaitMs != null \? deps\.askWaitMs : 8000;/.test(LIB) && /const BG_WAIT = deps\.bgWaitMs != null \? deps\.bgWaitMs : 120000;/.test(LIB));

  // pruning
  const old = (d) => NOW - d * 864e5;
  const insSnap = dbA.prepare("INSERT INTO mkt_chain_snap (chain, name, at, tvl, src) VALUES ('robinhood', 'Robinhood Chain', ?, 1, '{}')");
  for (const h of [1, 5, 9, 13]) insSnap.run(old(20) - h * 3600e3);
  const day10 = Math.floor(old(10) / 864e5) * 864e5;
  for (const h of [3, 9]) insSnap.run(day10 + h * 3600e3);   // two runs of one day, 10 days back
  const insPool = dbA.prepare("INSERT INTO mkt_pool_snap (network, pool, at, base_addr) VALUES (?, '0xpool', ?, '0xbase')");
  const tOld = Date.parse('2026-10-15T10:00:00Z');
  for (const m of [5, 15, 25, 125]) { insPool.run('robinhood', tOld + m * 60e3); insPool.run('eth', tOld + m * 60e3); }   // three batches in one hour, one two hours on
  const t100 = Date.parse('2026-07-01T00:00:00Z');
  for (const h of [1, 3, 5]) insPool.run('robinhood', t100 + h * 3600e3);
  const insPulse = dbA.prepare('INSERT INTO mkt_rh_pulse (at, block) VALUES (?, 1)');
  const tP = Date.parse('2026-10-22T05:00:00Z');
  for (const m of [1, 2, 3, 61]) insPulse.run(tP + m * 60e3);
  dbA.prepare("INSERT INTO mkt_new_pool (chain, pool, first_seen) VALUES ('robinhood', '0xoldpool', ?)").run(old(31));
  dbA.prepare("INSERT INTO mkt_new_pool (chain, pool, first_seen) VALUES ('robinhood', '0xweekpool', ?)").run(old(8));
  dbA.prepare("INSERT INTO mkt_new_pool (chain, pool, first_seen) VALUES ('ethereum', '0xweekpool', ?)").run(old(8));
  dbA.prepare("INSERT INTO mkt_scan (chain, address, at, src) VALUES ('robinhood', '0xoldscan', ?, 'scan')").run(old(91));
  dbA.prepare("INSERT INTO mkt_runs (job, at, ok) VALUES ('x', ?, 1)").run(old(15));
  const rpr = await run('prune');
  const poolsOn = (net, a, b) => q1('SELECT COUNT(*) n FROM mkt_pool_snap WHERE at >= ? AND at < ? AND network = ?', a, b, net).n;
  check('pruning: chain snapshots older than 7 days keep the last of each day; Robinhood Chain\'s pools older than 7 days the first batch of each hour, older than 90 days of each day', rpr.ok
    && q1('SELECT COUNT(*) n FROM mkt_chain_snap WHERE at < ?', old(14)).n === 1 && q1('SELECT at FROM mkt_chain_snap WHERE at < ?', old(14)).at === old(20) - 3600e3
    && q1('SELECT COUNT(*) n FROM mkt_chain_snap WHERE at >= ? AND at < ?', day10, day10 + 864e5).n === 1 && q1('SELECT at FROM mkt_chain_snap WHERE at >= ? AND at < ?', day10, day10 + 864e5).at === day10 + 9 * 3600e3
    && poolsOn('robinhood', tOld, tOld + 3600e3) === 1 && poolsOn('robinhood', tOld, tOld + 864e5) === 2
    && q1("SELECT COUNT(*) n FROM mkt_pool_snap WHERE at >= ? AND at < ?", t100, t100 + 864e5).n === 1 && q1("SELECT COUNT(*) n FROM mkt_pool_snap WHERE network='robinhood' AND at=?", NOW).n === nPools, rpr.note);
  check('  ...the other networks\' pools (read hourly, 8 networks) go to the first batch of each UTC day once a week old, not 90 days of hours', poolsOn('eth', tOld, tOld + 864e5) === 1 && q1("SELECT at FROM mkt_pool_snap WHERE network='eth' AND at >= ? AND at < ?", tOld, tOld + 864e5).at === tOld + 5 * 60e3, rpr.note);
  const rpr2 = await run('prune'), wmk = JSON.parse(q1("SELECT value FROM mkt_state WHERE name='prune'").value);
  check('  ...each run thins only the buckets that newly aged, from a watermark (never a rescan of everything already thinned)', /chains 0, pools 0, pulse 0/.test(rpr2.note) && wmk.chain7 === Math.floor((NOW - 7 * 864e5) / 864e5) * 864e5 && wmk.pool7 === Math.floor((NOW - 7 * 864e5) / 3600e3) * 3600e3
    && wmk.poolOther7 === Math.floor((NOW - 7 * 864e5) / 864e5) * 864e5 && wmk.pulse2 === Math.floor((NOW - 2 * 864e5) / 3600e3) * 3600e3 && !('chain14' in wmk) && /at >= \? AND at < \?/.test(LIB), rpr2.note + ' ' + brief(wmk));
  check('  ...the pulse keeps every row 2 days, then the first of each hour; Robinhood Chain\'s new pools 30 days, the other networks\' 7; scans 90 days; runs 14 days', q1('SELECT COUNT(*) n FROM mkt_rh_pulse WHERE at >= ? AND at < ?', tP, tP + 2 * 3600e3).n === 2
    && !q1("SELECT 1 FROM mkt_new_pool WHERE pool='0xoldpool'") && q1("SELECT 1 FROM mkt_new_pool WHERE pool='0xweekpool' AND chain='robinhood'") && !q1("SELECT 1 FROM mkt_new_pool WHERE pool='0xweekpool' AND chain='ethereum'")
    && !q1("SELECT 1 FROM mkt_scan WHERE address='0xoldscan'") && !q1("SELECT 1 FROM mkt_runs WHERE job='x'") && q1("SELECT COUNT(*) n FROM mkt_new_pool WHERE chain='robinhood'").n === npRows.length + 1, rpr.note);

  /* ── the review's findings (2026-10-26): each on a database of its own, so nothing above moves ── */
  const freshDb = (name) => new DatabaseSync(path.join(tmpA, name + '.db'));

  // a pools run caught partway through: page 1 committed under the run's `at`, page 2 still being read
  const dbF = freshDb('f'), mdF = MD.createMarketData({ db: dbF, now: () => clock, outboundTake: take, urls: URLS, bgWaitMs: 1000, askWaitMs: 1000 });
  mdF.migrate(); clock = NOW;
  await mdF.runJob('pools');
  const fullF = mdF.tokens({ chain: 'robinhood', limit: 200, include: 'all' }).body;
  let releaseF; hold.rhPage2 = new Promise((r) => { releaseF = r; }); hold.asked = false;
  clock = NOW + 10 * 60e3;
  const runF = mdF.runJob('pools');
  for (let i = 0; i < 300 && !hold.asked; i++) await sleep(10);
  mdF._test.memo.clear();   // as when the 15 s memo runs out during the run (it takes minutes on the shared budget)
  const midF = mdF.tokens({ chain: 'robinhood', limit: 200, include: 'all' }).body, midRows = dbF.prepare('SELECT COUNT(*) n FROM mkt_pool_snap WHERE at = ?').get(NOW + 10 * 60e3).n;
  releaseF(); hold.rhPage2 = null; await runF; clock = NOW;
  const afterF = mdF.tokens({ chain: 'robinhood', limit: 200, include: 'all' }).body;
  check('a pools run still reading is never served half-written: the token list keeps the last finished batch until the run\'s last page is in, then moves to it', hold.asked && midRows > 0 && midRows < nPools
    && midF.at === NOW && midF.rows.length === fullF.rows.length && midF.basis === fullF.basis && afterF.at === NOW + 10 * 60e3 && afterF.rows.length === fullF.rows.length, brief({ midRows, mid: [midF.at, midF.rows.length], full: fullF.rows.length, after: afterF.at }));
  meter.log.length = 0; await mdF.runJob('poolsOther'); await mdF.runJob('newPoolsGt'); await mdF.runJob('pools');
  const bgShares = meter.log.filter(([k]) => k.startsWith('market:geckoterminal'));
  check('the collectors take only their own GeckoTerminal share, never the one kept for people', bgShares.length > 10 && bgShares.every(([k]) => k === 'market:geckoterminal'), brief(bgShares.slice(0, 3)));
  dbF.close();

  // DefiLlama's overviews answering 200 without their protocols list
  const dbE = freshDb('e'), mdE = MD.createMarketData({ db: dbE, now: () => NOW, outboundTake: take, urls: URLS });
  mdE.migrate(); vendorFail.noList = true; const rcE = await mdE.runJob('chains'); vendorFail.noList = false;
  const rhE = dbE.prepare("SELECT * FROM mkt_chain_snap WHERE chain='robinhood'").get(), srcE = rhE ? JSON.parse(rhE.src) : {};
  dbE.close();
  check('a DefiLlama overview that answers 200 without its protocols list is a read that failed, said so — the chains run still keeps every other figure (it threw before)', rcE.ok && rhE && near(rhE.tvl, RH_LLAMA.tvl) && near(rhE.stables, RH_STABLES)
    && rhE.dex_vol_24h === null && rhE.oi === null && rhE.fees_24h === null && ['vol', 'oi', 'fees'].every((k) => /answered without a protocols list/.test(srcE[k] && srcE[k].why)) && /not read: DEX volume \(answered without a protocols list\)/.test(rcE.note), brief({ n: rcE.note, s: srcE.vol }));

  // the other networks' pools on the clock
  const dbG = freshDb('g'), mdG = MD.createMarketData({ db: dbG, now: () => clock, outboundTake: take, urls: URLS, bgWaitMs: 1000, askWaitMs: 1000 });
  mdG.migrate();
  const hr = (h, m = 0) => Date.parse('2026-10-26T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00Z');
  dbG.prepare("INSERT INTO mkt_runs (job, at, ok, ms) VALUES ('poolsOther', ?, 1, 420000)").run(hr(10, 7));
  dbG.prepare("INSERT INTO mkt_runs (job, at, ok, ms) VALUES ('pools', ?, 1, 60000)").run(hr(10, 15));
  clock = hr(10, 20); mdG.start({ staggerMs: 0, jobs: ['poolsOther', 'pools'] });
  const stG = mdG.status().body.collectors; mdG.stop();
  const nxtG = (j) => stG.find((c) => c.job === j).nextAt;
  check('the other networks\' pools run on the clock, just after each whole hour — not an hour after the last run ended, which drifted out of the day\'s first hour that a custom window reads', nxtG('poolsOther') === hr(11) + 5000 && nxtG('pools') === hr(10, 25), brief({ o: new Date(nxtG('poolsOther')).toISOString(), p: new Date(nxtG('pools')).toISOString() }));
  dbG.prepare("INSERT INTO mkt_runs (job, at, ok, ms) VALUES ('poolsOther', ?, 1, 420000)").run(hr(8, 0));
  mdG.start({ staggerMs: 0, jobs: ['poolsOther'] });
  let afterG = null;
  for (let i = 0; i < 400; i++) { afterG = mdG.status().body.collectors.find((c) => c.job === 'poolsOther'); if (afterG.lastAt === clock && !afterG.running && afterG.nextAt > clock) break; await sleep(10); }
  mdG.stop(); clock = NOW; dbG.close();
  check('  ...and after a run the next one is set the same way (a run at 10:20 is followed by one just after 11:00)', afterG && afterG.lastAt === hr(10, 20) && afterG.ok === true && afterG.nextAt === hr(11) + 5000, brief(afterG));

  // the new-pools reader fell 3.5 days behind: the blocks it skipped are a gap, and no pulse row counts across one
  const dbH = freshDb('h');
  const rpcH = async (calls) => calls.map(([m, p]) => { const r = nodeAnswer(m, p); return r.error ? null : r.result; });
  const mdH = MD.createMarketData({ db: dbH, now: () => NOW, rpcBatch: rpcH, urls: URLS }); mdH.migrate();
  const C0 = HEAD - 3000000;
  dbH.prepare("INSERT INTO mkt_state (name, value, at) VALUES ('rh_newpools', ?, ?)").run(JSON.stringify({ cursor: C0, start: C0 - 100000, startAt: NOW - 10 * 864e5, gaps: [] }), NOW - 3 * 864e5);
  const insH = dbH.prepare('INSERT INTO mkt_rh_pulse (at, block) VALUES (?, ?)');
  for (let k = 288; k >= 0; k--) insH.run(NOW - k * 600e3, HEAD - Math.round((k * 600e3 / 864e5) * 1e6));   // a row every 10 minutes for two days; a million blocks a day
  const rnH = await mdH.runJob('newPoolsRh');
  const stH = JSON.parse(dbH.prepare("SELECT value FROM mkt_state WHERE name='rh_newpools'").get().value), gapH = stH.gaps[stH.gaps.length - 1] || [];
  const rowsH = dbH.prepare('SELECT id, at, block, pools_created_v2 v2, pools_created_v3 v3, pools_created_v4 v4 FROM mkt_rh_pulse ORDER BY id').all().map((r, i, a) => Object.assign(r, { prev: i ? a[i - 1].block : null }));
  const fillable = rowsH.filter((r) => r.at > NOW - 2 * 864e5 && r.prev != null);
  const acrossGap = fillable.filter((r) => r.prev < gapH[1]), readAll = fillable.filter((r) => r.prev >= gapH[1]);
  const logsIn = (k, a, b) => F.logs[k].filter((l) => { const n = parseInt(l.blockNumber, 16); return n > a && n <= b; }).length;
  const pvH = mdH.pulseView().poolsCreated;
  dbH.close();
  check('a pulse row whose blocks the new-pools reader skipped (a recorded gap) keeps no count — never a made-up 0', rnH.ok && gapH[0] === C0 + 1 && gapH[1] === HEAD - 900000 - 1 && acrossGap.length > 100 && acrossGap.every((r) => r.v2 === null && r.v3 === null && r.v4 === null), brief({ gap: gapH, across: acrossGap.length, sample: acrossGap.slice(0, 2) }));
  check('  ...while the rows whose blocks were all read are counted, exactly', readAll.length > 100 && readAll.every((r) => r.v2 != null) && ['v2', 'v3', 'v4'].every((k) => readAll.reduce((s, r) => s + r[k], 0) === logsIn(k, readAll[0].prev, HEAD)) && logsIn('v2', readAll[0].prev, HEAD) > 0,
    brief({ n: readAll.length, v2: readAll.reduce((s, r) => s + r.v2, 0), want: logsIn('v2', readAll[0].prev, HEAD) }));
  check('  ...and the 24-hour count is withheld, with why, when the gap reaches into those 24 hours', pvH.h24 === null && /skipped some of the last 24 hours/.test(pvH.why), brief(pvH));

  // the pulse thinned to hourly: the rows kept take on the counts of the rows removed before them
  const dbI = freshDb('i'), mdI = MD.createMarketData({ db: dbI, now: () => NOW }); mdI.migrate();
  const hI = Math.floor((NOW - 3 * 864e5) / 3600e3) * 3600e3;
  const insI = dbI.prepare('INSERT INTO mkt_rh_pulse (at, block, weth_supply, bridge_eth, pools_created_v2, pools_created_v3, pools_created_v4) VALUES (?,?,?,?,?,?,?)');
  // two hours of a row a minute (2 v2 pools and 1 v4 pool each), a supply reading at :03, :13 …, the bridge at :07, :22 …;
  // the second hour has one row (:30) whose blocks were not all read; then the third hour's first row
  for (const [hh, hole] of [[0, -1], [1, 30]]) for (let m = 0; m < 60; m++) { const u = m === hole; insI.run(hI + hh * 3600e3 + m * 60e3, 1000 * (hh + 1) + m, m % 10 === 3 ? 1 : null, m % 15 === 7 ? 2 : null, u ? null : 2, u ? null : 0, u ? null : 1); }
  insI.run(hI + 2 * 3600e3, 3000, null, null, 2, 0, 1);
  await mdI.runJob('prune');
  const keptI = dbI.prepare('SELECT at, pools_created_v2 v2, pools_created_v4 v4, weth_supply, bridge_eth FROM mkt_rh_pulse ORDER BY id').all().map((r) => [Math.round((r.at - hI) / 60e3), r.v2, r.v4]);
  const bridgeI = mdI.pulseView().history.bridgeEth.length;
  dbI.close();
  check('the pulse thinned to hourly keeps each hour\'s first row and its first supply and bridge readings, and a kept row\'s pool count is still "since the row before" — the counts of the rows removed before it, added', JSON.stringify(keptI) === JSON.stringify([[0, 2, 1], [3, 6, 3], [7, 8, 4], [60, 106, 53], [63, 6, 3], [67, 8, 4], [120, null, null]]) && bridgeI === 2, brief({ keptI, bridgeI }));
  check('  ...the docs say so (the count is "since the row before it, at any age")', /a kept row takes on the counts of the rows removed before it/.test(DOCS) && /stay <code>null<\/code> where it did not read every block/.test(DOCS));

  // the scans, capped like the Scanner's own stores
  const dbJ = freshDb('j'), mdJ = MD.createMarketData({ db: dbJ, now: () => clock, scanKeep: 50, scanJsonBudget: 20000 }); mdJ.migrate();
  clock = NOW - 3600e3;
  for (let i = 0; i < 250; i++) { clock += 1000; mdJ.scanPut('ethereum', '0x' + (i + 1).toString(16).padStart(40, '0'), radarPairs[0], { src: 'scan' }); }
  const midJ = dbJ.prepare('SELECT COUNT(*) n FROM mkt_scan').get().n;
  clock = NOW; await mdJ.runJob('prune');
  const capJ = dbJ.prepare('SELECT COUNT(*) n, MIN(id) a, MAX(id) b, SUM(LENGTH(CAST(json AS BLOB))) bytes, COUNT(json) withJson, MIN(CASE WHEN json IS NOT NULL THEN id END) firstJson FROM mkt_scan').get();
  const oneJ = Buffer.byteLength(JSON.stringify(radarPairs[0]));
  dbJ.close();
  check('the scans are capped like the Scanner\'s own stores: the newest rows only, and the full profiles on the newest rows up to a byte budget (here 50 rows, 20,000 bytes)', midJ <= 100 && capJ.n === 50 && capJ.a === 201 && capJ.b === 250
    && capJ.bytes <= 20000 && capJ.withJson === Math.floor(20000 / oneJ) && capJ.firstJson === 250 - capJ.withJson + 1, brief({ midJ, capJ, oneJ }));

  // a token scanned every 9 minutes for 8 days: one row per ten-minute slot of the clock, never one row soaking up every scan
  const dbJ2 = freshDb('j2'), mdJ2 = MD.createMarketData({ db: dbJ2, now: () => clock }); mdJ2.migrate();
  const tokJ = '0x' + 'fe'.repeat(20);
  let in7 = 0, allJ = 0;
  dbJ2.exec('BEGIN');
  for (clock = NOW - 8 * 864e5; clock <= NOW; clock += 9 * 60e3) { mdJ2.scanPut('robinhood', tokJ, radarPairs[0], { src: 'scan' }); allJ++; if (clock > NOW - 7 * 864e5) in7++; }
  dbJ2.exec('COMMIT'); clock = NOW;
  const rowsJ2 = dbJ2.prepare('SELECT COUNT(*) n, MAX(n) most FROM mkt_scan').get(), topJ2 = mdJ2.mostScanned(5);
  dbJ2.close();
  check('a scan folds into its token\'s row only within the same ten-minute slot: scans every 9 minutes for 8 days keep their readings, and "the last 7 days" counts the last 7 days\' scans', rowsJ2.n > 1000 && rowsJ2.most <= 2 && topJ2.length === 1 && Math.abs(topJ2[0].scans - in7) <= 1 && in7 < allJ, brief({ rowsJ2, top: topJ2, in7, allJ }));

  // custom token windows, sums over a token's pools, and the Send API's filters — on a database whose every query is seen
  const dbK = freshDb('k'), seenK = [];
  const dbKp = { exec: (s) => dbK.exec(s), prepare: (s) => { const st = dbK.prepare(s); return { all: (...a) => { seenK.push([s, a]); return st.all(...a); }, get: (...a) => st.get(...a), run: (...a) => st.run(...a) }; } };
  const mdK = MD.createMarketData({ db: dbKp, now: () => NOW, outboundTake: take, urls: URLS, bgWaitMs: 1000, askWaitMs: 1000 }); mdK.migrate();
  const insK = dbK.prepare('INSERT INTO mkt_pool_snap (network, pool, at, rank, base_addr, base_symbol, price_usd, reserve_usd, vol_h24, tx_h24) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const XK = '0x' + '77'.repeat(20), YK = '0x' + '88'.repeat(20), SOLPOOL = '7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm', ETHPOOL = '0x' + 'ab'.repeat(20);
  for (const [d, v] of [['2026-10-20', 100], ['2026-10-21', 1000], ['2026-10-22', null], ['2026-10-23', 1000]]) {
    const at = Date.parse(d + 'T00:05:00Z');
    insK.run('robinhood', '0x' + '71'.repeat(20), at, 1, XK, 'XK', 1, 50000, v, 10);
    insK.run('robinhood', '0x' + '81'.repeat(20), at, 2, YK, 'YK', 2, 5000, 10, 4);
    insK.run('robinhood', '0x' + '82'.repeat(20), at, 3, YK, 'YK', 2, 0, null, null);   // GeckoTerminal's 0 reserve (not read), no volume, no trade count
  }
  const lastK = Date.parse('2026-10-23T00:05:00Z');
  insK.run('solana', SOLPOOL, lastK, 1, 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'BONK', 1, 1000, 5, 1);
  insK.run('eth', ETHPOOL, lastK, 1, PEPE, 'PEPE', 1, 1000, 5, 1);
  dbK.prepare("INSERT INTO mkt_state (name, value, at) VALUES ('pools:robinhood', ?, ?)").run(JSON.stringify({ at: lastK, pages: 1, pools: 3, wanted: 10, why: null, ended: true }), lastK);
  const xK = mdK.tokens({ chain: 'robinhood', window: 'custom', from: '2026-10-20', to: '2026-10-22', include: 'all' }).body.rows.find((r) => r.address === XK);
  check('a custom token window with a day GeckoTerminal gave no volume for has no total: that day is not a 0, and the answer says which day', xK && xK.volume.v === null && /no 24 h volume for one or more of its pools in our snapshot after 2026-10-21/.test(xK.volume.why), brief(xK && xK.volume));
  const yK = mdK.tokens({ chain: 'robinhood', include: 'all' }).body.rows.find((r) => r.address === YK), yKd = (await mdK.token({ chain: 'robinhood', address: YK })).body;
  check('  ...and a sum over a token\'s pools leaves out a pool with no figure — counted, said in the label, never added as 0 — and raises no "thin" on a reserve it could not read', yK && yK.liquidity.v === 5000 && yK.liquidity.missing === 1 && /1 of its 2 pools gave no reserve/.test(yK.liquidity.label)
    && yK.volume.v === 10 && yK.volume.missing === 1 && yK.txns24h.v === 4 && yK.txns24h.missing === 1 && !yK.flags.includes('thin')
    && yKd.liquidity.v === 5000 && yKd.liquidity.missing === 1 && yKd.windows['24h'].volume.missing === 1 && yKd.windows['24h'].txns.missing === 1 && !yKd.flags.includes('thin'), brief({ l: yK && yK.liquidity, f: yK && yK.flags, d: yKd.liquidity }));
  const apiK = (n, q) => mdK.apiResource(n, q, { limit: 50 });
  mdK.scanPut('solana', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', radarPairs[0], { src: 'scan' });
  mdK.scanPut('ethereum', PEPE, radarPairs[0], { src: 'scan' });
  const pSol = await apiK('pools', { network: 'solana', pool: SOLPOOL }), pSolAny = await apiK('pools', { pool: SOLPOOL }), pEthKey = await apiK('pools', { network: 'ethereum' }), pEthGt = await apiK('pools', { network: 'eth' }), pUpper = await apiK('pools', { pool: ETHPOOL.toUpperCase().replace('0X', '0x') });
  const sSol = await apiK('scans', { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' }), sEth = await apiK('scans', { address: PEPE.toUpperCase().replace('0X', '0x') });
  check('the Send API\'s pools: a Solana pool matches as written (case-sensitive, as stored), an EVM one in any case; network takes this site\'s key or GeckoTerminal\'s id; scans find a Solana address without chain=', pSol.body.data.length === 1 && pSolAny.body.data.length === 1 && pSol.body.data[0].pool === SOLPOOL
    && pEthKey.body.data.length === 1 && pEthGt.body.data.length === 1 && pEthKey.body.data[0].network === 'eth' && pUpper.body.data.length === 1 && sSol.body.data.length === 1 && sEth.body.data.length === 1, brief([pSol.body.data.length, pSolAny.body.data.length, pEthKey.body.data.length, pUpper.body.data.length, sSol.body.data.length, sEth.body.data.length]));
  const badK = await Promise.all([['pools', { network: 'nope' }], ['pools', { network: 'bitcoin' }], ['pools', { pool: 'nope' }], ['pools', { network: 'solana', pool: ETHPOOL }], ['pools', { network: 'eth', pool: SOLPOOL }],
    ['scans', { chain: 'base' }], ['scans', { address: 'zz' }], ['scans', { chain: 'solana', address: PEPE }], ['new-pools', { chain: 'nope' }]].map(([n, q]) => apiK(n, q)));
  check('  ...and a filter that can never match is a 400 that says why, not an empty page (pools, scans, new pools)', badK.every((r) => r.status === 400 && typeof r.body.error === 'string' && r.body.error.length > 10), badK.map((r) => r.status + ' ' + (r.body.error || '')).join(' | '));
  // the plans of the queries the Send API really ran, on a table with enough rows for the planner to care, before and after ANALYZE
  dbK.exec('BEGIN');
  for (let i = 0; i < 20000; i++) insK.run(i % 2 ? 'base' : 'bsc', '0x' + (i % 400).toString(16).padStart(40, '0'), Date.parse('2026-09-01T00:00:00Z') + i * 1000, 1, '0xb' + (i % 50), 'B', 1, 1, 1, 1);
  const insScanK = dbK.prepare("INSERT INTO mkt_scan (chain, address, at, src) VALUES (?, ?, ?, 'scan')");
  for (let i = 0; i < 9000; i++) insScanK.run(MD.SCAN_CHAINS[i % 3], '0x' + (i % 900).toString(16).padStart(40, '0'), NOW - i * 1000);
  dbK.exec('COMMIT');
  seenK.length = 0;
  const QK = [['pools', { network: 'base' }], ['pools', { pool: '0x' + (7).toString(16).padStart(40, '0') }], ['pools', { network: 'base', pool: '0x' + (7).toString(16).padStart(40, '0') }], ['scans', { chain: 'ethereum' }], ['scans', { chain: 'ethereum', address: '0x' + (4).toString(16).padStart(40, '0') }], ['scans', { address: '0x' + (4).toString(16).padStart(40, '0') }]];
  for (const [n, q] of QK) await apiK(n, q);
  const apiSql = seenK.filter(([s]) => /FROM mkt_(pool_snap|scan) WHERE id < \?/.test(s));
  const planOf = ([s, a]) => dbK.prepare('EXPLAIN QUERY PLAN ' + s).all(...a).map((r) => r.detail).join(' | ');
  const plans1 = apiSql.map(planOf); dbK.exec('ANALYZE'); const plans2 = apiSql.map(planOf);
  const planOk = (p, i) => /USING INDEX idx_mkt_(pool_snap_net_id|pool_snap_pool|scan_chain|scan_tok_id) /.test(p) && !/SCAN mkt_/.test(p) && (i === 5 || !/TEMP B-TREE/.test(p));
  dbK.close();
  check('  ...and every query it runs for them walks an index in id order: no full scan, no sort of a whole network (0.8 s a call at retention before)', apiSql.length === QK.length && plans1.every(planOk) && plans2.every(planOk), brief({ plans1, plans2 }));

  /* every network's tokens in one list, on a database seeded by hand so each network has its own read time: Robinhood Chain 5 minutes
     ago, Base 40 minutes ago (a run still writing a newer batch), Ethereum 5 hours ago (hourly reads that keep failing), Arbitrum's
     read stopped short, Solana and the rest never read — and every query the answer runs is seen */
  const dbL = freshDb('l'), seenL = [];
  const dbLp = { exec: (s) => dbL.exec(s), prepare: (s) => { const st = dbL.prepare(s); return { all: (...a) => { seenL.push(s); return st.all(...a); }, get: (...a) => { seenL.push(s); return st.get(...a); }, run: (...a) => st.run(...a) }; } };
  const mdL = MD.createMarketData({ db: dbLp, now: () => NOW, outboundTake: take, urls: URLS, bgWaitMs: 1000, askWaitMs: 1000 }); mdL.migrate();
  const T_RH = NOW - 5 * 60e3, T_BASE = NOW - 40 * 60e3, T_ETH = NOW - 5 * 3600e3, T_ARB = NOW - 20 * 60e3;
  // seeded the way DefiLlama's feeds give them (and the live tables kept them before 2026-10-27); served mended, where the file is now
  const icon = (n) => 'https://icons.llamao.fi/chains/rsz_' + n + '.jpg', mended = (n) => 'https://icons.llamao.fi/icons/chains/rsz_' + n + '.jpg';
  for (const [chain, name, logo] of [['robinhood', 'Robinhood Chain', icon('robinhood%20chain')], ['base', 'Base', icon('base')], ['ethereum', 'Ethereum', icon('ethereum')], ['arbitrum', 'Arbitrum', 'https://evil.example/x.png']])
    dbL.prepare("INSERT INTO mkt_chain_snap (chain, name, at, tvl, logo, src) VALUES (?, ?, ?, 1, ?, '{}')").run(chain, name, NOW - 10 * 60e3, logo);
  const insL = dbL.prepare('INSERT INTO mkt_pool_snap (network, pool, at, rank, base_addr, base_symbol, base_name, price_usd, reserve_usd, fdv_usd, mcap_usd, vol_m5, vol_h1, vol_h6, vol_h24, tx_h24, chg_m5, chg_h1, chg_h6, chg_h24) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const XL = '0x' + 'a1'.repeat(20), AL = '0x' + 'a2'.repeat(20), BL = '0x' + 'a3'.repeat(20), CL = '0x' + 'a4'.repeat(20), DL = '0x' + 'a5'.repeat(20), EL = '0x' + 'a6'.repeat(20);
  let poolN = 0;
  const pl = (net, at, base, sym, o) => { const d = Object.assign({ p: 1, fdv: 1e6, mc: null, m5: 1, h1: 10, h6: 60, c5: 0.1, c24: 3 }, o);
    insL.run(net, '0x' + (++poolN).toString(16).padStart(40, '0'), at, poolN, base, sym, sym + ' token', d.p, d.liq, d.fdv, d.mc, d.m5, d.h1, d.h6, d.v, 5, d.c5, 1, 2, d.c24); };
  pl('robinhood', T_RH, XL, 'USDX', { liq: 2e6, v: 9e5, h1: 4e4, c24: -1, mc: 5e5 }); pl('robinhood', T_RH, AL, 'AAA', { liq: 50000, v: 1000, h1: 900, c24: 12, mc: 2e5 }); pl('robinhood', T_RH, BL, 'BBB', { liq: 30000, v: null, h1: null, c24: null });
  pl('base', T_BASE, XL, 'USDX', { liq: 8e6, v: 3e6, h1: 1e3, c24: 0.5 }); pl('base', T_BASE, CL, 'CCC', { liq: 20000, v: 5e4, mc: 9e9, fdv: 1e6, c24: -7 });   // CCC: a global market cap, kept out of the sort
  pl('base', NOW - 60e3, DL, 'HALF', { liq: 1e9, v: 1e10 });   // the run still writing: no 'pools:base' names it yet
  pl('eth', T_ETH, DL, 'DDD', { liq: 4e5, v: 2e5, h1: 2e5, c24: 40, mc: 3e5 });
  pl('arbitrum', T_ARB, EL, 'EEE', { liq: 15000, v: 3e3, h1: 5 });
  const stL = dbL.prepare('INSERT INTO mkt_state (name, value, at) VALUES (?, ?, ?)');
  for (const [net, at, n, why] of [['robinhood', T_RH, 3, null], ['base', T_BASE, 2, null], ['eth', T_ETH, 1, null], ['arbitrum', T_ARB, 1, 'page 2: the GeckoTerminal budget was spent']]) stL.run('pools:' + net, JSON.stringify({ at, pages: 1, pools: n, wanted: 3, why, ended: !why }), at);
  const aL = mdL.tokens({ chain: 'all', limit: 200, include: 'all' }).body;
  const rowL = (chain, addr) => aL.rows.find((r) => r.chain === chain && r.address === addr);
  const figsOf = (r) => ['priceUsd', 'mcap', 'fdv', 'liquidity', 'txns24h', 'volume', 'change'].map((k) => r[k]);
  check('chain=all on networks read at different times: every row\'s figures carry its own network\'s read time — never one time stamped on all — and the answer gives the newest and the oldest',
    aL.rows.length === 7 && aL.rows.every((r) => figsOf(r).every((f) => f.at === { robinhood: T_RH, base: T_BASE, ethereum: T_ETH, arbitrum: T_ARB }[r.chain])) && aL.at === T_RH && aL.oldestAt === T_ETH
    && aL.networks.find((n) => n.key === 'base').at === T_BASE && aL.networks.find((n) => n.key === 'ethereum').at === T_ETH, brief(aL.rows.map((r) => [r.chain, r.symbol, r.volume.at])));
  check('  ...the same address on Robinhood Chain and on Base is two rows, each with its chain\'s name and logo (through our proxy; a logo host not on the allow-list gives none)', rowL('robinhood', XL) && rowL('base', XL) && rowL('robinhood', XL).liquidity.v === 2e6 && rowL('base', XL).liquidity.v === 8e6
    && rowL('base', XL).chainName === 'Base' && rowL('base', XL).chainLogo === '/api/market/logo?u=' + encodeURIComponent(mended('base')) && rowL('arbitrum', EL).chainLogo === null && rowL('arbitrum', EL).chainName === 'Arbitrum', brief([rowL('robinhood', XL), rowL('base', XL)]));
  check('  ...a batch still being written (Base\'s newest) is never served: Base\'s rows are its last finished read', !aL.rows.some((r) => r.symbol === 'HALF') && aL.rows.filter((r) => r.chain === 'base').length === 2);
  const nL = (k) => aL.networks.find((n) => n.key === k);
  check('  ...a read that stopped short and a network whose reads keep failing are said (stopped, stale, in the notes); every network never read is named, with why', nL('arbitrum').stopped === 'page 2: the GeckoTerminal budget was spent' && nL('ethereum').stale === true && !nL('robinhood').stale && !nL('base').stale
    && aL.notes.some((x) => /Arbitrum, 1 pool at .* — the read stopped at page 2: the GeckoTerminal budget was spent/.test(x) && /Ethereum, 1 pool at .* — older than its reads usually are/.test(x))
    && ['solana', 'bsc', 'polygon', 'avalanche', 'optimism'].every((k) => nL(k).pools === 0 && nL(k).at === null && nL(k).why === 'its pools have not been read yet (they are read hourly)')
    && aL.notes.some((x) => /^Not read yet: Solana \(read hourly\), BSC \(read hourly\), Polygon \(read hourly\), Avalanche \(read hourly\), OP Mainnet \(read hourly\)/.test(x)), brief({ nets: aL.networks, notes: aL.notes }));
  const orderL = (q) => mdL.tokens(Object.assign({ chain: 'all', include: 'all', limit: 200 }, q)).body.rows.map((r) => r.chain + ':' + r.symbol).join(' ');
  check('  ...sorted across chains, highest or lowest, by volume, liquidity, market cap and price change — a figure that is missing sits last both ways',
    orderL({}) === 'base:USDX robinhood:USDX ethereum:DDD base:CCC arbitrum:EEE robinhood:AAA robinhood:BBB' && orderL({ dir: 'asc' }) === 'robinhood:AAA arbitrum:EEE base:CCC ethereum:DDD robinhood:USDX base:USDX robinhood:BBB'
    && orderL({ sort: 'liquidity' }) === 'base:USDX robinhood:USDX ethereum:DDD robinhood:AAA robinhood:BBB base:CCC arbitrum:EEE' && orderL({ sort: 'liquidity', dir: 'asc' }) === 'arbitrum:EEE base:CCC robinhood:BBB robinhood:AAA ethereum:DDD robinhood:USDX base:USDX'
    && orderL({ sort: 'change' }) === 'ethereum:DDD robinhood:AAA arbitrum:EEE base:USDX robinhood:USDX base:CCC robinhood:BBB' && orderL({ sort: 'change', dir: 'asc' }) === 'base:CCC robinhood:USDX base:USDX arbitrum:EEE robinhood:AAA ethereum:DDD robinhood:BBB'
    && orderL({ sort: 'mcap' }) === 'robinhood:USDX ethereum:DDD robinhood:AAA robinhood:BBB base:USDX base:CCC arbitrum:EEE' && orderL({ sort: 'mcap', dir: 'asc' }) === 'robinhood:AAA ethereum:DDD robinhood:USDX robinhood:BBB base:USDX base:CCC arbitrum:EEE'
    && rowL('base', CL).mcap.v === 9e9 && rowL('base', CL).mcap.global === true,
    [orderL({}), orderL({ dir: 'asc' }), orderL({ sort: 'liquidity' }), orderL({ sort: 'change' }), orderL({ sort: 'mcap' })].join(' | '));
  const h1L = mdL.tokens({ chain: 'all', window: '1h', include: 'all', limit: 200 }).body;
  check('  ...over the preset windows each row sums its own pools\' figures for that window (1 h here: Ethereum\'s DDD first, Robinhood Chain\'s BBB with no figure last)', h1L.window.kind === '1h' && h1L.rows[0].symbol === 'DDD' && h1L.rows[0].volume.v === 2e5 && h1L.rows[h1L.rows.length - 1].symbol === 'BBB' && h1L.rows[h1L.rows.length - 1].volume.v === null && /not read/.test(h1L.rows[h1L.rows.length - 1].volume.why), brief(h1L.rows.map((r) => [r.symbol, r.volume.v])));
  // a custom window: each network over its own daily snapshots — Robinhood Chain's cover these days, Base's start later
  const yL = dayOf(NOW - 864e5), y2L = dayOf(NOW - 2 * 864e5);
  for (const d of [y2L, yL, dayOf(NOW)]) { const at = Date.parse(d + 'T00:05:00Z'); pl('robinhood', at, XL, 'USDX', { liq: 2e6, v: 1e5 }); pl('robinhood', at, AL, 'AAA', { liq: 5e4, v: 100 }); pl('robinhood', at, BL, 'BBB', { liq: 3e4, v: 7 }); }
  mdL._test.memo.clear();
  const cL = mdL.tokens({ chain: 'all', window: 'custom', from: y2L, to: yL, include: 'all', limit: 200 });
  const cRow = (chain, addr) => cL.body.rows.find((r) => r.chain === chain && r.address === addr);
  check('  ...a custom window is served (the daily snapshots allow it network by network): Robinhood Chain\'s tokens summed over its days, Base\'s say where its history starts, each network\'s coverage given', cL.status === 200 && cL.body.window.kind === 'custom'
    && cRow('robinhood', XL).volume.v === 2e5 && cRow('robinhood', XL).volume.days === 2 && cRow('base', XL).volume.v === null && /^our history starts /.test(cRow('base', XL).volume.why) && cL.body.networks.find((n) => n.key === 'robinhood').coverage.from === y2L
    && cL.body.notes.some((x) => /each network is summed from its own daily snapshots/.test(x)) && cL.body.rows.findIndex((r) => r.volume.v == null) >= 2, brief({ x: cRow('robinhood', XL) && cRow('robinhood', XL).volume, b: cRow('base', XL) && cRow('base', XL).volume, nets: cL.body.networks.slice(0, 3) }));
  const badL = mdL.tokens({ chain: 'all', window: 'custom', from: yL, to: dayOf(NOW) });
  check('  ...and a window that is not whole UTC days is refused in parseWindow\'s words, as on one chain', badL.status === 400 && /whole UTC day that has ended/.test(badL.body.error));
  // cheap per request: the rows are built once per change of the data; another sort or order reads nothing from the pools again
  mdL.tokens({ chain: 'all' }); seenL.length = 0;
  for (const q of [{ sort: 'liquidity' }, { dir: 'asc' }, { sort: 'mcap', dir: 'asc' }, { include: 'all' }]) mdL.tokens(Object.assign({ chain: 'all' }, q));
  const poolReads = seenL.filter((s) => /mkt_pool_snap|mkt_state|mkt_chain_snap/.test(s)).length;
  const t0L = process.hrtime.bigint(); for (let i = 0; i < 200; i++) mdL.tokens({ chain: 'all', sort: i % 2 ? 'volume' : 'change' }); const msL = Number(process.hrtime.bigint() - t0L) / 1e6 / 200;
  check('  ...memoised like the other answers: four more requests with other sorts read nothing from the tables, and a request costs ' + msL.toFixed(3) + ' ms here', poolReads === 0 && msL < 5, poolReads + ' table reads; ' + msL + ' ms');
  const apiL = await mdL.apiResource('tokens', { chain: 'all' }, { limit: 100 });
  // the docs' chain=all shape names every key the resource returns (the answer's, each network's — stopped, stale and coverage too — and the rows' chain fields)
  const tokDoc = (DOCS.split('/api/data/v1/tokens?chain=all')[1] || '').split('</details>')[0];
  const keysTa = [...Object.keys(apiL.body).filter((k) => apiL.body[k] !== undefined), ...new Set(aL.networks.concat(cL.body.networks).flatMap((n) => Object.keys(n))), ...Object.keys(apiL.body.data[0]).slice(0, 3)];
  check('the docs\' "tokens" names chain=all and every key it returns: at and oldestAt, the networks (key, name, network, logo, at, pools, most, everyMs, why, stopped, stale, coverage), and each row\'s chain, chainName and chainLogo',
    keysTa.length > 20 && ['stopped', 'stale', 'coverage', 'chainName', 'chainLogo', 'oldestAt'].every((k) => keysTa.includes(k)) && keysTa.every((k) => new RegExp('\\b' + k + '\\b').test(tokDoc)) && /chain=all/.test(DOCS.split('<tr><td><code>tokens</code></td>')[1].split('</tr>')[0]),
    keysTa.filter((k) => !new RegExp('\\b' + k + '\\b').test(tokDoc)).join(','));
  check('the Send API\'s tokens takes chain=all: data with each row\'s chain fields (the raw logo URL — programs, not browsers), the networks read, the newest and oldest read times', apiL.status === 200 && apiL.body.chain === 'all' && apiL.body.data.length === 7
    && apiL.body.data.find((r) => r.chain === 'base' && r.address === XL).chainLogo === mended('base') && apiL.body.networks.find((n) => n.key === 'base').logo === mended('base') && apiL.body.at === T_RH && apiL.body.oldestAt === T_ETH && JSON.parse(JSON.stringify(apiL.body)).rows === undefined && apiL.body.data.every((r) => !('_globalMc' in r)), brief(apiL.body).slice(0, 300));
  dbL.close();
  const dbL0 = freshDb('l0'), mdL0 = MD.createMarketData({ db: dbL0, now: () => NOW }); mdL0.migrate();
  const aL0 = mdL0.tokens({ chain: 'all' }).body; dbL0.close();
  check('  ...and before any network has been read it says so (rows empty, why), each network still named', aL0.rows.length === 0 && aL0.why === 'no network\'s pools have been read yet' && aL0.networks.length === MD.GT_TRACKED.length && aL0.networks.every((n) => n.pools === 0 && n.why));

  // the docs' chain shape is the chain resource's (every key it returns is named there)
  const chainDoc = (DOCS.split('/api/data/v1/chain?key=robinhood')[1] || '').split('</pre>')[1] || '';
  const named = (k) => new RegExp('\\b' + k + '\\b').test(chainDoc);
  const keysCd = [...Object.keys(cd2), ...Object.keys(cd2.stats), ...Object.keys(cd2.history), ...Object.keys(cd2.history.src), ...Object.keys(cd2.topTokens)];
  check('the docs\' "chain" shape names every key the resource returns (stats.liquidity and l2beat, history.from / to and its src map, appFees and daa)', keysCd.length > 30 && keysCd.every(named), keysCd.filter((k) => !named(k)).join(','));

  /* ── the timetable ── */
  check('the timetable is the contract\'s: pulse 60 s, chains 30 min, radar 10 min (its sweep is the radar\'s full node read), pools 10 min, new pools 3 min (chain) / 15 min (others), others\' pools hourly, histories 6 h, growthepie daily, L2BEAT hourly, re-scan hourly, prune hourly — and a failed DefiLlama run is not retried sooner than DefiLlama refreshes (30 min)',
    MD.JOBS.pulse.every === 60e3 && MD.JOBS.chains.every === 30 * 60e3 && MD.JOBS.radar.every === 10 * 60e3 && MD.JOBS.pools.every === 10 * 60e3 && MD.JOBS.newPoolsRh.every === 3 * 60e3 && MD.JOBS.newPoolsGt.every === 15 * 60e3 && MD.JOBS.poolsOther.every === 3600e3
    && MD.JOBS.chains.retry >= 30 * 60e3 && MD.JOBS.liquidity.retry >= 30 * 60e3 && MD.JOBS.series.retry >= 30 * 60e3
    && MD.JOBS.series.every === 6 * 3600e3 && MD.JOBS.growthepie.every === 864e5 && MD.JOBS.l2beat.every === 3600e3 && MD.JOBS.scans.every === 3600e3 && MD.JOBS.prune.every === 3600e3);
  check('the collectors start only when asked (MARKET_COLLECT=1, or production unless MARKET_COLLECT=0), and the test runner points every vendor URL at a dead address', /const MKT_COLLECT_ON = process\.env\.MARKET_COLLECT === '1' \|\| \(process\.env\.NODE_ENV === 'production' && process\.env\.MARKET_COLLECT !== '0'\);/.test(SRC) && /if \(MKT_COLLECT_ON\) \{/.test(SRC)
    && ['MARKET_LLAMA_URL', 'MARKET_LLAMA_COINS_URL', 'MARKET_LLAMA_STABLES_URL', 'MARKET_L2BEAT_URL', 'MARKET_GROWTHEPIE_URL', 'MARKET_GT_URL', 'MARKET_DS_URL', 'MARKET_CG_URL', 'MARKET_ETH_RPC_URL', 'MARKET_LOGO_ORIGIN'].every((k) => new RegExp(k + ": DEAD").test(RUNJS) && SRC.includes('process.env.' + k)) && !/MARKET_COLLECT: '1'/.test(RUNJS));
  check('the server\'s busy signal decays: a minute after the node\'s last refusal, or while the shared pace is queued over 5 s — never "the pace has not sped up yet" (one refusal at boot kept every chain job idle for hours)', /const mktRpcBusy = \(\) => now\(\) - _paceRefusedAt < 60000 \? '[^']*'[^\n]*\n\s*: _paceAt - now\(\) > 5000 \? '/.test(SRC) && /const paceRefused = \(attempt\) => \{ _paceRefusedAt = now\(\);/.test(SRC) && /function paceYield\(\) \{ _paceRefusedAt = now\(\);/.test(SRC) && !/_paceMs > PACE_MS_START/.test(SRC));
  // the shares carved out of GeckoTerminal's 10 a minute, read from the server's own table: they leave the chart switch and the Scanner some in the busiest minute
  const rpmOf = (k) => { const m = SRC.match(new RegExp("'" + k.replace(/[.:]/g, '\\$&') + "': (\\d+),")); return m ? Number(m[1]) : null; };
  check('the server meters each new host and Market Data\'s two shares of GeckoTerminal: the collectors\' 3 and 2 kept for people, which with the name search\'s share stay under the site\'s 10 a minute', rpmOf('market:geckoterminal') === 3 && rpmOf('market:geckoterminal-asked') === 2 && rpmOf('market:rpc') === 12
    && rpmOf('market:geckoterminal') + rpmOf('market:geckoterminal-asked') + rpmOf('search:geckoterminal') < rpmOf('api.geckoterminal.com') && rpmOf('api.geckoterminal.com') === 10
    && /'api\.llama\.fi': 30, 'coins\.llama\.fi': 10, 'stablecoins\.llama\.fi': 20, 'l2beat\.com': 10,/.test(SRC) && /'api\.growthepie\.xyz': 10, 'api\.growthepie\.com': 10,/.test(SRC), brief(['market:geckoterminal', 'market:geckoterminal-asked', 'search:geckoterminal', 'api.geckoterminal.com'].map(rpmOf)));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join(' | '));
  check('part 1 ran to the end', false, e.message);
}

/* ═══ 2. A SERVER OF ITS OWN ═══ */
// the chain node over HTTP: batches are Market Data's (the server's rpcBatch); a single call is the radar's — it gets the head and no pairs
const nodeSrv = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; });
  req.on('end', () => {
    let j = null; try { j = JSON.parse(body); } catch {}
    const out = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (Array.isArray(j)) return out(j.map((c) => { const r = nodeAnswer(c.method, c.params); return r.error ? { jsonrpc: '2.0', id: c.id, error: r.error } : { jsonrpc: '2.0', id: c.id, result: r.result }; }));
    if (!j) return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    if (j.method === 'eth_blockNumber') { node.head += 500; return out({ jsonrpc: '2.0', id: j.id, result: '0x' + node.head.toString(16) }); }
    if (j.method === 'eth_getLogs') { const a = j.params[0]; node.single.push([String(a.address).toLowerCase(), parseInt(a.fromBlock, 16), parseInt(a.toBlock, 16)]); return out({ jsonrpc: '2.0', id: j.id, result: [] }); }
    out({ jsonrpc: '2.0', id: j.id, error: { code: -32000, message: 'not served by this fake' } });
  });
});
await new Promise((ok) => nodeSrv.listen(0, '127.0.0.1', ok));
nodeSrv.unref();
node.head = HEAD; node.ranges = [];
const NODE = 'http://127.0.0.1:' + nodeSrv.address().port + '/';
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
let PORT = await freePort(); if (PORT === 8642) PORT = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-mkt-'));
fs.writeFileSync(path.join(dataDir, '.data_key'), randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
const ADMIN_ID = 424242;
const vHost = '127.0.0.1:' + vendor.address().port;
const env = { ...process.env, PORT: String(PORT), JSI_DATA_DIR: dataDir, DATA_DIR: dataDir, BASE_URL: 'http://localhost:' + PORT, NODE_ENV: 'test',
  SEED_INVITE_CODE: '12345', TOS_GATE: '1', TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback', SEED_CODES_OPEN: '1', ADMIN_USER_IDS: String(ADMIN_ID),
  DATA_KEY: '', DATA_KEY_FILE: '', BACKUP_DIR: path.join(dataDir, 'backups'), KEY_ROTATE_EXTRA_DBS: '',
  RPC_URL: NODE, CHART_SRC_DS_URL: 'http://127.0.0.1:9/', CHART_SRC_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_DS_URL: 'http://127.0.0.1:9/', ETHUSD_URL: 'http://127.0.0.1:9/', BLOCKSCOUT_URL: 'http://127.0.0.1:9', STOCK_QUOTE: '0',
  MC_DEXSCREENER_URL: V + '/mc/ds', MC_GECKO_URL: 'http://127.0.0.1:9', MC_GOPLUS_URL: V + '/mc/gp', ETH_RPC_URL: V + '/mc/ethnode', SOL_RPC_URL: 'http://127.0.0.1:9/', JUPITER_URL: 'http://127.0.0.1:9',
  MARKET_LLAMA_URL: URLS.llama, MARKET_LLAMA_COINS_URL: URLS.coins, MARKET_LLAMA_STABLES_URL: URLS.stables, MARKET_L2BEAT_URL: URLS.l2beat, MARKET_GROWTHEPIE_URL: URLS.growthepie, MARKET_GT_URL: URLS.gt,
  MARKET_DS_URL: URLS.ds, MARKET_CG_URL: URLS.cg, MARKET_ETH_RPC_URL: URLS.ethRpc, MARKET_LOGO_ORIGIN: V + '/img', MARKET_GROWTHEPIE_METRICS_URL: URLS.growthepieMetrics,
  MARKET_COLLECT: '1', MARKET_JOBS: 'pulse,chains,l2beat,liquidity,pools,newPoolsRh,radar', MARKET_STAGGER_MS: '40',
  OUTBOUND_MAX_WAIT_MS: '4000', OUTBOUND_RPM_MARKET_GECKOTERMINAL: '600', ['OUTBOUND_RPM_' + vHost.replace(/[^A-Z0-9]/gi, '_')]: '6000' };
let server = null, slog = '';
const B = 'http://localhost:' + PORT;
async function boot() {
  slog = '';
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
  for (let i = 0; i < 150; i++) { try { if ((await fetch(B + '/healthz')).ok) return true; } catch {} await sleep(200); }
  return false;
}
async function halt() { if (!server) return; const s = server; server = null; const done = new Promise((r) => s.once('exit', r)); try { s.kill('SIGTERM'); } catch {} await Promise.race([done, sleep(5000)]); }
async function api(p, o = {}) {
  let r; try { r = await fetch(B + p, { headers: Object.assign({}, o.sid ? { Cookie: 'sid=' + o.sid } : {}, o.key ? { Authorization: 'Bearer ' + o.key } : {}) }); } catch (e) { throw new Error('fetch failed on ' + p + ': ' + e.message + ' · ' + slog.slice(-300)); }
  const buf = Buffer.from(await r.arrayBuffer()); let j = null; try { j = JSON.parse(buf.toString('utf8')); } catch {}
  return { status: r.status, j, buf, ct: r.headers.get('content-type') || '', cc: r.headers.get('cache-control') || '' };
}
try {
  for (const k of Object.keys(hits)) delete hits[k];
  uas.clear(); log.length = 0;
  check('the server came up with every vendor and both chain nodes pointed at fakes', await boot(), slog.slice(-300));
  const sdb = new DatabaseSync(path.join(dataDir, 'app.db')); sdb.exec('PRAGMA busy_timeout = 5000');
  const mkUser = (name, id) => {
    if (id) sdb.prepare('INSERT INTO users (id, username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?,?)').run(id, name, Date.now(), '🧪', Date.now(), 'ok');
    else sdb.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
    const uid = sdb.prepare('SELECT id FROM users WHERE username=?').get(name).id;
    const raw = 'tok_' + name + '_' + randomBytes(8).toString('hex');
    sdb.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), uid, Date.now(), Date.now() + 864e5);
    return { id: uid, sid: raw };
  };
  // wait for the collectors' first runs
  let st = null;
  const want = ['pulse', 'chains', 'l2beat', 'liquidity', 'pools', 'newPoolsRh', 'radar'];
  for (let i = 0; i < 120; i++) { st = (await api('/api/market/status')).j; if (st && want.every((j) => (st.collectors.find((c) => c.job === j) || {}).lastAt)) break; await sleep(250); }
  const stOf = (j) => (st.collectors.find((c) => c.job === j) || {});
  check('MARKET_COLLECT=1 starts the collectors on their stagger, only the jobs MARKET_JOBS names; every one ran and is on the status', st.enabled === true && want.every((j) => stOf(j).ok === true && stOf(j).nextAt > Date.now() - 5000) && stOf('series').lastAt === null && stOf('series').nextAt === null,
    brief(st.collectors.map((c) => [c.job, c.ok, c.note])));
  check('  ...they asked as the site itself, with the honest User-Agent (no browser identity), every time', uas.size === 1 && uas.has(UA), [...uas].join(' | '));

  const ch = await api('/api/market/chains?sort=tvl&dir=desc&limit=10');
  check('GET /api/market/chains answers the list (no-store: a caller-chosen read)', ch.status === 200 && ch.j.rows.length === 10 && ch.j.rows[0].key === 'ethereum' && /no-store/.test(ch.cc), brief(ch.j && ch.j.rows[0]));
  const chb = await api('/api/market/chains?window=custom&from=2026-10-05&to=2026-10-01');
  check('  ...and refuses a bad window with its reason', chb.status === 400 && /after/.test(chb.j.error));
  const cd = await api('/api/market/chain?key=robinhood');
  check('GET /api/market/chain?key=robinhood: the stats, the pulse read from the chain (block, gas, supplies, the bridge), the newest pools', cd.status === 200 && cd.j.pulse.now.block >= HEAD && cd.j.pulse.now.wethSupply > 40000 && cd.j.pulse.now.bridgeEth > 200000 && cd.j.newPools.length === 19 && cd.j.stats.mcap.why === 'No native token — gas is paid in ETH', brief(cd.j && cd.j.pulse));
  const tk = await api('/api/market/tokens?chain=robinhood&sort=volume&dir=desc');
  check('GET /api/market/tokens: the token list with its basis', tk.status === 200 && tk.j.rows.length > 0 && /most-traded pools on GeckoTerminal, grouped by token/.test(tk.j.basis));
  const tka = await api('/api/market/tokens?chain=all&sort=liquidity&dir=asc');
  check('  ...and chain=all through the route: every network\'s list in one, each row naming its chain (the logo through our proxy), the networks not read yet named (only Robinhood Chain\'s pools are collected here)', tka.status === 200 && tka.j.chain === 'all' && tka.j.rows.length > 0
    && tka.j.rows.every((r) => r.chain === 'robinhood' && r.chainName === 'Robinhood Chain' && /^\/api\/market\/logo\?u=/.test(r.chainLogo || '')) && tka.j.networks.length === MD.GT_TRACKED.length && tka.j.networks.filter((n) => !n.pools).length === MD.GT_TRACKED.length - 1 && /no-store/.test(tka.cc), brief(tka.j && { n: tka.j.networks, r: tka.j.rows && tka.j.rows[0] }));
  const td = await api('/api/market/token?chain=robinhood&address=' + USDG);
  check('GET /api/market/token: one token in full with its candles, the logo through our own proxy', td.status === 200 && td.j.symbol === 'USDG' && td.j.candles.rows.length > 0 && /^\/api\/market\/logo\?u=https%3A%2F%2Fcoin-images\.coingecko\.com/.test(td.j.logo || ''), brief(td.j && { l: td.j.logo, c: td.j.candles && td.j.candles.rows && td.j.candles.rows.length }));
  const sr = await api('/api/market/search?q=USDG'), np = await api('/api/market/new-pools?chain=robinhood&limit=5'), no = await api('/api/market/nope');
  check('GET /api/market/search, /new-pools; an unknown market endpoint is a 404 that lists them', sr.status === 200 && sr.j.tokens[0].address === USDG && np.status === 200 && np.j.rows.length === 5 && no.status === 404 && /chains, chain, tokens, token, scan, search, new-pools, status, logo/.test(no.j.error));

  // the image proxy
  const imgHits = () => (hits['img-png'] || 0);
  const lg1 = await api('/api/market/logo?u=' + encodeURIComponent('https://coin-images.coingecko.com/coins/images/1/large/x.png')), h1 = imgHits();
  const lg2 = await api('/api/market/logo?u=' + encodeURIComponent('https://coin-images.coingecko.com/coins/images/1/large/x.png'));
  check('the logo proxy serves an allowed host\'s picture from our origin (its type read from the bytes), kept a week — the second ask is not fetched again', lg1.status === 200 && lg1.ct === 'image/png' && Buffer.compare(lg1.buf, PNG) === 0 && /max-age=604800/.test(lg1.cc) && lg2.status === 200 && imgHits() === h1 && h1 === 1, lg1.status + ' ' + lg1.ct + ' ' + h1);
  const lgEvil = await api('/api/market/logo?u=' + encodeURIComponent('https://evil.example/x.png')), lgPort = await api('/api/market/logo?u=' + encodeURIComponent('https://assets.geckoterminal.com:444/x.png')), lgHttp = await api('/api/market/logo?u=' + encodeURIComponent('http://assets.geckoterminal.com/x.png'));
  const lgSvg = await api('/api/market/logo?u=' + encodeURIComponent('https://assets.geckoterminal.com/x.svg')), lgMoved = await api('/api/market/logo?u=' + encodeURIComponent('https://assets.geckoterminal.com/moved.png')), lgBig = await api('/api/market/logo?u=' + encodeURIComponent('https://assets.geckoterminal.com/big.png'));
  check('  ...and refuses everything else: another host, a port, plain http (400), an SVG however it is labelled (415), a redirect (never followed), a picture over the cap (413)', lgEvil.status === 400 && lgPort.status === 400 && lgHttp.status === 400 && lgSvg.status === 415 && lgMoved.status === 502 && lgBig.status === 413 && !log.some((l) => /elsewhere/.test(l)),
    [lgEvil.status, lgPort.status, lgHttp.status, lgSvg.status, lgMoved.status, lgBig.status].join(' '));
  check('  ...the allow-list is exact host names (the contract\'s five, and the host DefiLlama\'s icons really are on)', [...MD.LOGO_HOSTS].sort().join() === ['assets.geckoterminal.com', 'cdn.dexscreener.com', 'coin-images.coingecko.com', 'dd.dexscreener.com', 'icons.llama.fi', 'icons.llamao.fi'].sort().join() && !MD.logoAllowed('https://cdn.dexscreener.com.evil.com/x.png') && !MD.logoAllowed('https://user:pw@cdn.dexscreener.com/x.png'));

  // the quiet scan, and every scan kept
  const qs = await api('/api/market/scan?address=' + PEPE + '&chain=ethereum');
  const rec1 = await api('/api/scan/recent');
  check('GET /api/market/scan is the Scanner\'s own profile, read QUIETLY: kept in Market Data\'s store, not in the public "recently scanned" list', qs.status === 200 && qs.j.chain === 'ethereum' && qs.j.pair && qs.j.pair.token.address === PEPE && qs.j.scan.quiet === true && qs.j.scan.marketKept === true
    && !(rec1.j.scans || []).some((x) => x.token === PEPE), brief(qs.j && qs.j.scan) + ' ' + brief(rec1.j));
  const ns = await api('/api/scan?address=' + PEPE + '&chain=ethereum');
  const rec2 = await api('/api/scan/recent');
  check('  ...while a Scanner scan is public as before — and kept in Market Data\'s store too', ns.status === 200 && !ns.j.scan.quiet && (rec2.j.scans || []).some((x) => x.token === PEPE && x.chain === 'ethereum'));

  // the Send API
  const owner = mkUser('__mkt_key__');
  const key = 'sk_' + randomBytes(24).toString('hex');
  sdb.prepare("INSERT INTO api_keys (key_hash, user_id, burned_wei, burned_usd, price_usd, minted_at, expires_at, source) VALUES (?,?,'0',0,0,?,?,'burn')").run(createHash('sha256').update(key).digest('hex'), owner.id, Date.now(), Date.now() + 864e5);
  const nk = await api('/api/data/v1/chains'), bk = await api('/api/data/v1/chains', { key: 'sk_' + '0'.repeat(48) });
  check('the Send API\'s new resources need a key: none, or a wrong one, is a 401', nk.status === 401 && bk.status === 401);
  const dc = await api('/api/data/v1/chains', { key }), dh = await api('/api/data/v1/chain-history?key=robinhood&metric=tvl', { key }), dsn = await api('/api/data/v1/chain-snapshots?limit=4', { key });
  const dsn2 = await api('/api/data/v1/chain-snapshots?limit=4&before=' + (dsn.j && dsn.j.next), { key }), dsc = await api('/api/data/v1/scans?chain=ethereum&address=' + PEPE, { key });
  check('  ...with one: the chains (raw logo URLs — programs, not browsers), a chain\'s history, snapshots paged by before / limit, every scan', dc.status === 200 && dc.j.data.length > 0 && dc.j.data[0].tvl.src === 'defillama' && dh.status === 200 && Array.isArray(dh.j.data)
    && dsn.status === 200 && dsn.j.data.length === 4 && dsn.j.next && dsn2.j.data[0].id < dsn.j.data[3].id && dsc.j.data.length === 2 && dsc.j.data.some((x) => x.src === 'market') && dsc.j.data.some((x) => x.src === 'scan'), brief({ dsn: dsn.j && dsn.j.next, dsc: dsc.j && dsc.j.data.map((x) => x.src) }));
  const dall = await Promise.all(['chain?key=robinhood', 'tokens?chain=robinhood', 'tokens?chain=all', 'token?chain=robinhood&address=' + USDG, 'pools?network=robinhood&limit=3', 'new-pools?limit=3', 'radar', 'pulse?limit=2', 'collectors'].map((r) => api('/api/data/v1/' + r, { key })));
  const dunk = await api('/api/data/v1/nope', { key });
  check('  ...every one of the new resources answers, and the unknown-resource error lists them all', dall.every((r) => r.status === 200 && r.j && (r.j.data !== undefined)) && dunk.status === 404 && ['chains', 'chain-history', 'chain-snapshots', 'new-pools', 'radar', 'scans', 'pulse', 'collectors', 'competition'].every((n) => dunk.j.error.includes(n)),
    dall.map((r) => r.status).join(' ') + ' ' + brief(dunk.j));

  // the admin browser
  const admin = mkUser('__mkt_admin__', ADMIN_ID), member = mkUser('__mkt_member__');
  sdb.prepare("INSERT INTO posts (user_id, text, created_at, private) VALUES (?, 'a public post for the admin browser', ?, 0)").run(member.id, Date.now());
  sdb.prepare("INSERT INTO posts (user_id, text, created_at, private) VALUES (?, 'zq holders only — private', ?, 1)").run(member.id, Date.now());
  const ac0 = await api('/api/admin/collected'), ac1 = await api('/api/admin/collected', { sid: member.sid }), ac2 = await api('/api/admin/collected/mkt_runs', { sid: member.sid });
  check('the admin\'s "collected data" is the admin\'s alone: signed out or a member, it is the 404 every admin route gives', ac0.status === 404 && ac1.status === 404 && ac2.status === 404, [ac0.status, ac1.status, ac2.status].join(' '));
  const ac = await api('/api/admin/collected', { sid: admin.sid });
  const ids = (ac.j && ac.j.datasets || []).map((d) => d.id);
  check('  ...for the admin: every mkt_* table, the token cache, the runners store, the holder ledger, the chart-source cache, and the Send API\'s public views — each with its rows, newest and oldest, and its columns',
    ac.status === 200 && ['mkt_chain_snap', 'mkt_chain_series', 'mkt_pool_snap', 'mkt_new_pool', 'mkt_rh_pulse', 'mkt_scan', 'mkt_radar', 'mkt_runs', 'token_cache', 'runner_tokens', 'holder_index', 'chart_sources', 'users', 'posts', 'comments', 'calls', 'communities', 'leaderboard', 'competition'].every((i) => ids.includes(i))
    && ac.j.datasets.every((d) => d.title && Array.isArray(d.columns) && d.columns.length > 0 && 'rows' in d && 'newestAt' in d && 'oldestAt' in d) && ac.j.datasets.find((d) => d.id === 'mkt_pool_snap').rows > 0 && /no-store/.test(ac.cc), ids.join(','));
  dump('admin-collected', ac.j); dump('admin-collected-mkt_chain_snap', (await api('/api/admin/collected/mkt_chain_snap?limit=3', { sid: admin.sid })).j);
  dump('admin-collected-users', (await api('/api/admin/collected/users?limit=3', { sid: admin.sid })).j); dump('market-scan-ethereum', qs.j);
  dump('sendapi-chain-snapshots', dsn.j); dump('sendapi-scans', dsc.j);
  const served = new Set(), leaks = [];
  for (const d of ac.j.datasets) {
    for (const c of d.columns) { served.add(c.name); if (FORBIDDEN.test(c.name)) leaks.push(d.id + ' declares ' + c.name); }
    const pg = await api('/api/admin/collected/' + d.id + '?limit=20', { sid: admin.sid });
    if (pg.status !== 200) { leaks.push(d.id + ' answered ' + pg.status); continue; }
    for (const r of pg.j.rows) for (const k of Object.keys(r)) { served.add(k); if (FORBIDDEN.test(k)) leaks.push(d.id + ' serves ' + k); if (!d.columns.some((c) => c.name === k)) leaks.push(d.id + ' serves an undeclared ' + k); }
    if (JSON.stringify(pg.j.rows).includes('holders only — private')) leaks.push(d.id + ' served a private post');
  }
  check('  ...and no dataset declares or serves an encrypted or private column (no *_enc, email, wallet, 2FA, prefs, sessions, IPs, keys, passwords, tracked wallets) — ' + served.size + ' column names checked', leaks.length === 0 && served.size > 100, leaks.join(' | '));
  const up = await api('/api/admin/collected/users?q=__mkt_', { sid: admin.sid }), pp = await api('/api/admin/collected/mkt_pool_snap?limit=7', { sid: admin.sid }), pp2 = await api('/api/admin/collected/mkt_pool_snap?limit=7&before=' + (pp.j && pp.j.next), { sid: admin.sid });
  check('  ...a dataset pages (Older →) and searches; the members\' view is publicUserView\'s public profile', up.status === 200 && up.j.rows.length >= 3 && up.j.rows.every((r) => /^__mkt_/.test(r.username) && Object.keys(r).length === 13) && pp.j.rows.length === 7 && pp.j.next && pp2.j.rows.length === 7 && pp2.j.rows[0].id < pp.j.rows[6].id && (await api('/api/admin/collected/nope', { sid: admin.sid })).status === 404, brief({ up: up.j && up.j.rows[0], next: pp.j && pp.j.next }));
  const ob = await api('/api/admin/outbound', { sid: admin.sid });
  const hosts = (ob.j && ob.j.hosts) || {};
  check('the meters were consulted in the real wiring: Market Data\'s GeckoTerminal share and chain share, and the vendors\' host, each spent', hosts['market:geckoterminal'] && hosts['market:geckoterminal'].totalSinceBoot >= 3 && hosts['market:geckoterminal'].ceilingRpm === 600 && hosts['market:rpc'] && hosts['market:rpc'].totalSinceBoot >= 2 && hosts['market:rpc'].ceilingRpm === 12 && hosts[vHost] && hosts[vHost].totalSinceBoot > 5, brief(hosts));
  check('  ...and the token view\'s candles came out of the share kept for people (2 a minute), not the collectors\'', hosts['market:geckoterminal-asked'] && hosts['market:geckoterminal-asked'].ceilingRpm === 2 && hosts['market:geckoterminal-asked'].totalSinceBoot >= 1, brief(hosts['market:geckoterminal-asked']));

  // the radar resumes its cursor after a restart
  const cur1 = JSON.parse(sdb.prepare("SELECT value FROM mkt_state WHERE name='radar'").get().value).cursor;
  const firstRadar = node.single.filter(([a]) => a === MD.RH.v2Factory);
  check('the radar sweep ran on its timer (its first read goes 2.5M blocks back) and its cursor is in the database', firstRadar.length >= 1 && firstRadar[0][2] - firstRadar[0][1] === 2500000 && cur1 === firstRadar[firstRadar.length - 1][2], brief({ firstRadar, cur1 }));
  await halt();
  node.single.length = 0;
  check('  ...the server restarted on the same database', await boot(), slog.slice(-300));
  // the radar job runs on its cadence (the database says it ran under 3 minutes ago); a member opening the radar builds it at once
  const radarMember = mkUser('__mkt_radar__');
  await api('/api/pairs/new', { sid: radarMember.sid });
  for (let i = 0; i < 80 && !node.single.some(([a]) => a === MD.RH.v2Factory); i++) await sleep(250);
  const again = node.single.filter(([a]) => a === MD.RH.v2Factory);
  check('  ...and the first sweep after the restart reads on from the saved cursor, not 2.5M blocks back', again.length >= 1 && again[0][1] === cur1 + 1, brief({ again, cur1 }));
  sdb.close();
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join(' | '));
  check('part 2 ran to the end', false, e.message + ' · ' + slog.slice(-400));
} finally {
  await halt();
  try { dbA.close(); } catch {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tmpA, { recursive: true, force: true }); } catch {}
  vendor.close(); nodeSrv.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra && !ok ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
