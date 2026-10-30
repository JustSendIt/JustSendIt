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
const RW = require(path.join(ROOT, 'lib', 'rwa.js'));
const { AbiCoder, id: keccakId } = require(path.join(ROOT, 'node_modules', 'ethers'));
const ABI = AbiCoder.defaultAbiCoder();
const CM = require(path.join(ROOT, 'lib', 'chainmcap.js'));
const MM = require(path.join(ROOT, 'lib', 'marketmap.js'));

const SRC = fs.readFileSync(SERVER_JS, 'utf8');
const LIB = fs.readFileSync(path.join(ROOT, 'lib', 'marketdata.js'), 'utf8');
const RUNJS = fs.readFileSync(path.join(ROOT, 'tests', 'run.mjs'), 'utf8');
const DOCS = fs.readFileSync(path.join(ROOT, 'public', 'data.html'), 'utf8');
const FIX = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'marketdata', f), 'utf8'));
const MCFIX = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'multichain', f), 'utf8'));
// the bubble map's samples: CoinGecko's and CoinLore's answers of 2026-10-30 ~00:30 UTC (tests/fixtures/marketdata/README.txt)
const HMX = { top: FIX('heatmap-cg-top100.json'), global: FIX('heatmap-cg-global.json'), stables: FIX('heatmap-cg-stables.json'), lore: FIX('heatmap-lore-top100.json') };
// what the fake's map routes answer: the samples, or a list changed for a case (top), or a 503 (down)
const hmVendor = { top: null, down: false };
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
// the RWA tab's (2026-10-28): Robinhood's Stock Token API, Chainlink's directory, DefiLlama, GeckoTerminal, Sourcify's ABIs, the chain
const FR = {
  assets: FIX('rwa-rhj-assets.json'), prices: FIX('rwa-rhj-prices.json'), actions: FIX('rwa-rhj-corporate-actions.json'), devs: FIX('rwa-rhj-price-deviations.json'),
  feeds: FIX('rwa-chainlink-feeds.json'), stables: FIX('rwa-llama-stablecoins.json'), multi: FIX('rwa-gt-multi.json'), tslaPools: FIX('rwa-gt-token-pools-tsla.json'),
  abiReg: FIX('rwa-sourcify-abi-registry.json'), abiStock: FIX('rwa-sourcify-abi-stock.json'), logs: FIX('rwa-rpc-registry-logs.json'), reads: FIX('rwa-rpc-reads.json'), cg: FIX('rwa-cg-lookalikes.json'),
  proto: Object.fromEntries(['morpho-blue', 'catch-exchange', 'solon-stocks', 'grove-finance', 'spark-savings'].map((k) => [k, FIX('rwa-llama-protocol-' + k + '.json')])),
};
const TSLA = '0x322f0929c4625ed5bad873c95208d54e1c003b2d', TSLAON = '0xb197f36c25ba9b66960688882a4dc595c6b04309', WEEK = '0xc93a8c440cea26d7445df01729f193b27965099f', REGISTRY = '0xe10b6f6b275de231345c20d14ab812db62151b00';
const GME_RHJ = FR.assets.assets.find((a) => a.tokenSymbol === 'GME').deployments[0].contractAddress.toLowerCase(), GME_MEME = FR.cg.find((c) => c.id === 'gamestop-3').platforms.robinhood;
/* the chain market caps' cross-check (2026-10-28): DefiLlama's chains, CoinGecko's coins and asset platforms, DefiLlama's relay,
   CoinLore's walk and a /ticker/ read — measured that day (tests/fixtures/marketdata/README.txt) */
const MC = { chains: FIX('mcap-llama-chains.json'), cg: FIX('mcap-cg-markets.json'), relay: FIX('mcap-llama-mcaps.json'), platforms: FIX('mcap-cg-platforms.json'),
  walk: FIX('mcap-lore-tickers.json'), ticker: FIX('mcap-lore-ticker.json'), others: FIX('mcap-lore-others.json') };
const NOW_M = Date.parse('2026-10-28T15:30:00Z');   // CoinGecko's answer is stamped 15:29:50 UTC that day
const loreRows = Object.values(MC.walk.pages).flat();
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
const hits = {}, uas = new Set(), log = [], loreAt = [];   // loreAt: when each CoinLore request arrived (real clock), for its pace
const hit = (k) => { hits[k] = (hits[k] || 0) + 1; };
const vendorFail = { mcaps: false, gtAll: false, gtMulti: false, noList: false, rhj: false, cg: false, platforms: false, lore: false, loreFrom: null }, cgSeen = [];
/* rows the fake's GeckoTerminal multi answer leaves out (as GeckoTerminal does for a token it has no entry for — TSLAon, mGLO): the RWA
   section drops AMC and AAPL, so TSLA, whose own pools the research read, is among the 12 RWAs with the most liquidity */
const gtMultiLeaveOut = new Set();
// vendorMode.mcap: DefiLlama's chains and relay as measured 2026-10-28 (the market-cap section); otherwise the 2026-10-26 answers
const vendorMode = { mcap: false };
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
    if (['llama', 'coins', 'stables', 'l2beat', 'gtp', 'gt', 'ds', 'cg', 'eth', 'img', 'rhj', 'chainlink', 'lore', 'hcg', 'hlore'].includes(seg)) uas.add(String(req.headers['user-agent']));
    log.push(req.method + ' ' + p + u.search);
    if (seg === 'lore') loreAt.push([Date.now(), p + u.search]);
    hit(seg);
    // DefiLlama
    if (p === '/llama/v2/chains') return send(200, vendorMode.mcap ? MC.chains : F.chains);
    // vendorFail.noList: a 200 that carries an error instead of the protocols list (a schema change, a bad day)
    if (p === '/llama/overview/dexs') return send(200, vendorFail.noList ? { error: 'no protocols today' } : F.dexs);
    if (p === '/llama/overview/fees') return send(200, vendorFail.noList ? { error: 'no protocols today' } : F.fees);
    if (p === '/llama/overview/open-interest') return send(200, vendorFail.noList ? { error: 'no protocols today' } : F.oi);
    if (p === '/llama/protocols') return send(200, F.protocols);
    if (p === '/llama/v2/historicalChainTvl/Robinhood%20Chain') return send(200, F.histtvl);
    { const pm = /^\/llama\/protocol\/([a-z0-9.-]+)$/.exec(p); if (pm) { hit('llama-protocol'); return FR.proto[pm[1]] ? send(200, FR.proto[pm[1]]) : send(404, { error: 'not in the fixtures' }); } }
    if (p === '/llama/overview/dexs/Robinhood%20Chain') return send(200, F.dexsRh);
    if (p === '/llama/overview/fees/Robinhood%20Chain') return send(200, F.feesRh);
    if (p.startsWith('/llama/')) return send(404, { error: 'not in the fixtures' });
    if (p === '/stables/stablecoinchains') return send(200, F.stables);
    if (p === '/stables/stablecoins') { hit('stables-list'); return u.searchParams.get('includePrices') === 'true' ? send(200, FR.stables) : send(400, { error: 'includePrices' }); }
    // Robinhood's Stock Token API (vendorFail.rhj: it answers 503), Chainlink's feed directory
    if (seg === 'rhj') { hit('rhj-' + p.split('/')[2]); if (vendorFail.rhj) return send(503, { error: 'unavailable' }); const k = { assets: FR.assets, prices: FR.prices, 'corporate-actions': FR.actions, 'price-deviations': FR.devs }[p.split('/')[2]]; return k ? send(200, k) : send(404, { error: 'not here' }); }
    if (p === '/chainlink/feeds-robinhood-mainnet.json') { hit('chainlink-dir'); return send(200, FR.feeds); }
    if (p === '/stables/stablecoincharts/Robinhood%20Chain') return send(200, F.stChart);
    if (p.startsWith('/stables/')) return send(404, { error: 'not in the fixtures' });
    if (p === '/coins/mcaps' && req.method === 'POST') { hit('mcaps-post'); try { JSON.parse(body); } catch { return send(400, {}); } return vendorFail.mcaps ? send(500, { error: 'down' }) : send(200, vendorMode.mcap ? MC.relay : F.mcaps); }
    // CoinGecko answers the coins asked for (ids=…), from its two measured answers: the 2026-10-26 token list and the 2026-10-28 chain tokens
    if (p === '/cg/coins/markets') { hit('cg-markets'); cgSeen.push({ key: req.headers['x-cg-demo-api-key'] || null, q: u.search }); if (vendorFail.cg) return send(500, { error: 'down' });
      const want = new Set(String(u.searchParams.get('ids') || '').split(',')); return send(200, [...MC.cg, ...F.cgMarkets.filter((x) => !MC.cg.some((y) => y.id === x.id))].filter((x) => want.has(x.id))); }
    if (p === '/cg/asset_platforms') { hit('cg-platforms'); cgSeen.push({ key: req.headers['x-cg-demo-api-key'] || null, q: 'asset_platforms' }); return vendorFail.platforms ? send(429, { error: 'slow down' }) : send(200, MC.platforms); }
    // CoinLore: its walk's pages (start=N), and a /ticker/ read answered from the same rows
    if (p === '/lore/tickers/') { hit('lore-walk'); const st = Number(u.searchParams.get('start') || 0); if (vendorFail.lore || (vendorFail.loreFrom != null && st >= vendorFail.loreFrom)) return send(429, { error: 'slow down' }); return send(200, { data: MC.walk.pages[st] || [], info: MC.walk.info }); }
    if (p === '/lore/ticker/') { hit('lore-ticker'); if (vendorFail.lore) return send(429, { error: 'slow down' }); const want = String(u.searchParams.get('id') || '').split(','); const byId = new Map(loreRows.map((x) => [String(x.id), x])); return send(200, want.map((i) => byId.get(i)).filter(Boolean)); }
    // the bubble map's CoinGecko (its top 100, its stablecoins category, /global) and CoinLore (its first 100)
    if (p === '/hcg/coins/markets') { const stab = u.searchParams.get('category') === 'stablecoins'; hit(stab ? 'hcg-stables' : 'hcg-top'); if (hmVendor.down) return send(503, { error: 'down' }); return send(200, stab ? HMX.stables : hmVendor.top || HMX.top); }
    if (p === '/hcg/global') { hit('hcg-global'); return hmVendor.down ? send(503, { error: 'down' }) : send(200, HMX.global); }
    if (p === '/hlore/tickers/') { hit('hlore'); return send(200, HMX.lore); }
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
      if (p.startsWith('/gt/networks/robinhood/tokens/multi/')) { hit('gt-multi'); if (vendorFail.gtMulti) return send(500, { errors: [{ status: '500' }] }); const want = p.split('/').pop().split(','); return send(200, { data: FR.multi.data.filter((d) => want.includes(d.attributes.address) && !gtMultiLeaveOut.has(d.attributes.address)) }); }
      if (p === '/gt/networks/robinhood/tokens/' + TSLA + '/pools') { hit('gt-token-pools'); return send(200, FR.tslaPools); }
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
const URLS = { llama: V + '/llama', coins: V + '/coins', stables: V + '/stables', l2beat: V + '/l2beat', growthepie: V + '/gtp', growthepieMetrics: V + '/gtp', gt: V + '/gt', ds: V + '/ds', cg: V + '/cg', ethRpc: V + '/eth',
  rhj: V + '/rhj', chainlink: V + '/chainlink/feeds-robinhood-mainnet.json', coinlore: V + '/lore' };
// CoinLore's pace without the wait: each sleep the module asks for is recorded (and the clock it reads stays where it is)
const sleeps = [];
const fakeSleep = async (ms) => { sleeps.push(ms); };

/* ═══ the fake Robinhood Chain node: the research's state batch, its real pool-creation logs, and timestamps between two real blocks ═══ */
const node = { head: HEAD, ranges: [], single: [], throttle: false, v4Limit: 400000, calls: 0, mc: [], storage: 0 };
/* The RWA reads the research made, answered as it read them (rwa-rpc-reads.json) and nothing else: a beacon slot or a code it did not
   read is an error item (the node gave nothing — "not read"), and a Multicall3 subcall it did not read reverts. terms() is pure in
   Stock.sol (its verified ABI), so every Stock Token answers what TSLA did. A Chainlink round's id, start and answeredInRound were not
   recorded: they answer 0 (the site reads only the answer and updatedAt). */
const RR = FR.reads, MC3 = RW.MULTICALL3, RR_EXTRA_CODE = {};
const units18 = (x) => { const s = /e/i.test(String(x)) ? Number(x).toFixed(18) : String(x); const [i, d = ''] = s.split('.'); return BigInt(i + (d + '0'.repeat(18)).slice(0, 18)); };
function rwaSub(to, data) {
  const S = RW.SELECTORS, word = (v) => '0x' + w256(BigInt(v).toString(16)), str = (x) => ABI.encode(['string'], [x]);
  if (data === S.totalSupply) return to === RR.tsla.address ? RR.tsla.totalSupply : to === RR.week.address ? word(units18(RR.week.supply)) : RR.supplies[to] != null ? word(units18(RR.supplies[to])) : null;
  if (to === RR.tsla.address && ({ [S.tokenPaused]: 1, [S.oraclePaused]: 1 })[data]) return word(0);
  if (to === RR.tsla.address && data === S.uiMultiplier) return RR.tsla.uiMultiplier;
  if (to === RR.tsla.address && data === S.newUIMultiplier) return RR.tsla.newUIMultiplier;
  if (to === RR.tsla.address && data === S.effectiveAt) return RR.tsla.effectiveAt;
  if (data === S.terms && RR.beacons[to] === REGISTRY) return str(RR.tsla.terms);
  if (data === S.implementation && RR.beaconImpl[to]) return '0x' + w256(RR.beaconImpl[to]);
  if (RR.meta[to] && data === S.name) return str(RR.meta[to].name);
  if (RR.meta[to] && data === S.symbol) return str(RR.meta[to].symbol);
  if (RR.meta[to] && data === S.decimals) return word(RR.meta[to].decimals);
  if (RR.feeds[to] && data === S.latestRoundData) return ABI.encode(['uint80', 'int256', 'uint256', 'uint256', 'uint80'], [0, BigInt(RR.feeds[to].answer), 0, RR.feeds[to].updatedAt, 0]);
  if (RR.feeds[to] && data === S.description) return str(RR.feeds[to].description);
  return null;
}
function rwaNodeAnswer(m, params) {
  const a0 = params && params[0];
  if (m === 'eth_getStorageAt') {
    node.storage++;
    const a = String(a0).toLowerCase(), v = params[1] === RW.SLOT.beacon ? (a === RR.week.address ? RR.week.beacon : RR.beacons[a]) : params[1] === RW.SLOT.impl ? RR.implementations[a] : null;
    return v ? { result: '0x' + w256(String(v).toLowerCase()) } : { error: { code: -32000, message: 'not read by the research' } };
  }
  if (m === 'eth_call' && String(a0.to).toLowerCase() === MC3) {
    const [arr] = ABI.decode(['tuple(address,bool,bytes)[]'], '0x' + String(a0.data).slice(10));
    node.mc.push({ n: arr.length, sel: String(a0.data).slice(0, 10) });
    return { result: ABI.encode(['tuple(bool,bytes)[]'], [arr.map(([t, , d]) => { const r = rwaSub(String(t).toLowerCase(), d); return r == null ? [false, '0x'] : [true, r]; })]) };
  }
  if (m === 'eth_getLogs' && String(a0.address).toLowerCase() === REGISTRY) { const from = parseInt(a0.fromBlock, 16), to = parseInt(a0.toBlock, 16); return { result: FR.logs.filter((l) => { const b = parseInt(l.blockNumber, 16); return b >= from && b <= to; }) }; }
  // a contract's code: the role holders the research found to be wallets, the Stock Token proxy the review read for the registry's tokens
  // and WEEK (rwa-rpc-reads.json code), and a test's own hypothetical contract (RR_EXTRA_CODE) — anything else, the node gave nothing
  if (m === 'eth_getCode') { const a = String(a0).toLowerCase(), c = RR.holderCode[a] != null ? RR.holderCode[a] : RR.code.addresses.includes(a) ? RR.code.hex : RR_EXTRA_CODE[a]; return c != null ? { result: c } : { error: { code: -32000, message: 'not read by the research' } }; }
  return undefined;
}
const KIND = { [MD.RH.v2Factory]: 'v2', [MD.RH.v3Factory]: 'v3', [MD.RH.poolManager]: 'v4' };
function nodeAnswer(m, params) {
  const hx = (n) => '0x' + n.toString(16);
  const a0 = params && params[0];
  const rw = rwaNodeAnswer(m, params); if (rw !== undefined) return rw;
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
const md = MD.createMarketData({ db: dbA, now: () => clock, outboundTake: take, rpcBatch: fakeRpcBatch, rpcBusy: () => busy, urls: URLS, bgWaitMs: 1000, askWaitMs: 1000, sleep: fakeSleep,
  radarSweep: async () => ({ pairs: radarPairs, cursor: 98587100, raw: radarRaw }), scanRefresh: async (chain, addr) => { refreshed.push(chain + ':' + addr); return { pair: radarPairs[0], readAt: clock }; } });
md.migrate();
const q1 = (sql, ...a) => dbA.prepare(sql).get(...a);
const qa = (sql, ...a) => dbA.prepare(sql).all(...a);
try {
  /* ── the module's shape, in the source ── */
  check('one honest User-Agent, at least 30 s to answer, no redirect followed, a size cap — never the browser one', MD.HONEST_UA === UA && /Math\.max\(30000, Number\(o\.timeoutMs\) \|\| 30000\)/.test(LIB) && (LIB.match(/redirect: 'error'/g) || []).length === 2 && /readCapped\(res, Number\(o\.maxBytes\)/.test(LIB) && !/BROWSER_UA|Mozilla\//.test(LIB));
  check('every outbound read takes the meter first — the share (GeckoTerminal), then the host — and a spent meter is "could not ask"', /if \(o\.share\) await takeShare\(\[\]\.concat\(o\.share\), wait\);\s*const h = hostOf\(url\); if \(h\) await take\(h, wait\);/.test(LIB) && /catch \{ return \{ ok: false, status: 0, data: null, reason: 'budget' \}; \}/.test(LIB)
    && /const gtAsk = \(ctx, path, o = \{\}\) => ask\(ctx, urls\.gt \+ path, Object\.assign\(\{ share: GT_SHARE \}, o\)\);/.test(LIB) && /const gtAskNow = \(path, o = \{\}\) => ask\(null, urls\.gt \+ path, Object\.assign\(\{ share: \[GT_ASKED, GT_SHARE\], wait: ASK_WAIT \}, o\)\);/.test(LIB)
    && (LIB.match(/gtAskNow\('/g) || []).length === 2 && (LIB.match(/gtAsk\(ctx, '/g) || []).length === 4);   // the pools and new pools, and the RWA job's multi read and token pools
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
  const cgOf = (id) => MC.cg.find((x) => x.id === id);
  check('a chain\'s own token\'s market cap is CoinGecko\'s own figure (ETH for Ethereum, ARB for Arbitrum), its source and read time CoinGecko\'s; a token CoinGecko\'s answer has not got, with no relay either, is missing with why — never 0',
    eth.mcap === cgOf('ethereum').market_cap && arb.mcap === cgOf('arbitrum').market_cap && JSON.parse(eth.src).mcap.src === 'coingecko' && JSON.parse(eth.src).mcap.at === Date.parse(cgOf('ethereum').last_updated)
    && mon && mon.mcap === null && /CoinGecko's answer did not include monad/.test(JSON.parse(mon.src).mcap.why) && eth.tvs === null && JSON.parse(eth.src).tvs.why === 'L2BEAT tracks Ethereum L2s and L3s only'
    && !qa('SELECT mcap FROM mkt_chain_snap WHERE mcap IS NOT NULL').some((r) => !(r.mcap > 0)), brief({ e: eth.mcap, a: arb.mcap, m: mon && mon.src }));
  const zero = F.chains.filter((c) => !c.tvl).map((c) => c.name);
  check('a chain with neither a TVL nor a DEX volume is not listed; every other chain DefiLlama gave is, once', qa('SELECT name FROM mkt_chain_snap').every((r) => !zero.includes(r.name)) && q1('SELECT COUNT(*) n FROM mkt_chain_snap').n === q1('SELECT COUNT(DISTINCT chain) n FROM mkt_chain_snap').n && q1('SELECT COUNT(*) n FROM mkt_chain_snap').n >= 40);
  const cgAsk = log.filter((l) => /^GET \/cg\/coins\/markets\?vs_currency=usd&per_page=250&ids=/.test(l));
  check('the chains run asked each source once (chains, DEX, fees, open interest, stablecoins, CoinGecko\'s coins, DefiLlama\'s relay) — and DefiLlama\'s overviews without their charts', ['/llama/v2/chains', '/llama/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', '/llama/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', '/llama/overview/open-interest?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', '/stables/stablecoinchains', '/coins/mcaps'].every((x) => log.filter((l) => l.endsWith(' ' + x)).length === 1)
    && cgAsk.length === 1 && new Set(decodeURIComponent(cgAsk[0].split('ids=')[1]).split(',')).size === qa('SELECT DISTINCT native_token t FROM mkt_chain_snap WHERE native_token IS NOT NULL').length, log.slice(0, 12).join(' | '));
  // CoinGecko: once per run, never within two minutes of another CoinGecko read; DefiLlama's relay stands in, said so
  clock = NOW + 3 * 60e3;
  const rc2 = await md.runJob('chains'); const cg1 = hits['cg-markets'] || 0;
  clock = NOW + 3 * 60e3 + 30e3; const rc3 = await md.runJob('chains'); const cg2 = hits['cg-markets'] || 0;
  const relayRow = md._test.latestSnap().rows.find((r) => r.chain === 'ethereum'), relayEth = md.chains({ limit: 200 }).body.rows.find((r) => r.key === 'ethereum');
  clock = NOW + 6 * 60e3; vendorFail.cg = true; const rc4 = await md.runJob('chains');
  vendorFail.mcaps = true; clock = NOW + 9 * 60e3; const rc5 = await md.runJob('chains'); vendorFail.cg = false; vendorFail.mcaps = false;
  const bothDown = md.chains({ limit: 200 }).body.rows.find((r) => r.key === 'ethereum');
  clock = NOW;
  check('CoinGecko is asked once per chains run and never twice within two minutes: a run 30 s after another takes DefiLlama\'s relay of CoinGecko\'s figure, labelled as that, one source, and the run says why', rc2.ok && cg1 === 2 && cg2 === 2 && /CoinGecko was asked less than two minutes ago/.test(rc3.note)
    && relayRow.mcap === F.mcaps['coingecko:ethereum'].mcap && JSON.parse(relayRow.src).mcap.src === 'defillama' && relayEth.mcap.v === F.mcaps['coingecko:ethereum'].mcap && relayEth.mcap.src === 'defillama' && /CoinGecko's figure, relayed by DefiLlama/.test(relayEth.mcap.label)
    && relayEth.mcap.check.status === 'single' && relayEth.mcap.check.sources.length === 1 && relayEth.mcap.check.sources[0].relay === true && /still one source/.test(relayEth.mcap.check.notes.join(' ')), brief([rc2.note, rc3.note, cg1, cg2, relayEth && relayEth.mcap]));
  check('  ...CoinGecko down takes the relay too (the reason said); with the relay down as well the market cap is missing with both reasons — never a stale figure, never 0', rc4.ok && /CoinGecko could not be read \(upstream 500\)/.test(rc4.note) && rc5.ok
    && bothDown.mcap.v === null && /CoinGecko could not be read \(upstream 500\); DefiLlama's relay of it could not be read either \(upstream 500\)/.test(bothDown.mcap.why) && bothDown.mcap.check.status === 'none', brief([rc4.note, bothDown && bothDown.mcap]));
  // an operator's CoinGecko Demo key goes as its header, never in the URL
  const dbB = new DatabaseSync(path.join(tmpA, 'b.db'));
  const mdB = MD.createMarketData({ db: dbB, now: () => NOW, outboundTake: take, urls: URLS, cgDemoKey: 'demo-key-for-the-test' });
  mdB.migrate(); vendorFail.mcaps = true; const rcB = await mdB.runJob('chains'); vendorFail.mcaps = false; dbB.close();
  const cgB = cgSeen[cgSeen.length - 1] || {};
  check('  ...with a CoinGecko Demo key (COINGECKO_DEMO_KEY) the fallback sends it as its header, never in the URL', rcB.ok && cgB.key === 'demo-key-for-the-test' && !/demo-key/.test(cgB.q) && cgSeen[0].key === null && /COINGECKO_DEMO_KEY/.test(SRC), brief(cgSeen));
  dbA.prepare('DELETE FROM mkt_chain_snap WHERE at > ?').run(NOW);   // keep the first run's snapshot as the latest
  dbA.prepare("DELETE FROM mkt_state WHERE name = 'cg_last'").run();
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
    && byMcapDesc.slice(firstNull(byMcapDesc)).every((r) => r.mcap.v == null) && byMcapDesc.slice(0, firstNull(byMcapDesc)).every((r, i, a) => i === 0 || a[i - 1].mcap.v >= r.mcap.v) && byMcapDesc[0].key === 'bitcoin' && byMcapDesc[0].mcap.v === MC.cg.find((x) => x.id === 'bitcoin').market_cap, brief(byMcapAsc.slice(0, 3).map((r) => [r.key, r.mcap.v])));
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
  check('  ...every resource the contract names is served', ['chains', 'chain', 'chain-history', 'chain-snapshots', 'tokens', 'token', 'pools', 'new-pools', 'radar', 'scans', 'pulse', 'collectors', 'rwa', 'rwa-token', 'heatmap'].every((n) => md.RESOURCES.includes(n)));

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

  /* ══ the RWA tab (owner, 2026-10-28): lib/rwa.js on the research's samples, then the 'rwa' job and its answers on a database of
     their own, its clock the afternoon the samples were read ══ */
  {
    const RNOW = Date.parse('2026-10-28T15:00:00Z');
    // the figure contract is lib/marketdata.js's, copied: the two give the same answers
    const figIn = [[1, 'x', 5], [null, 'x', 5], [NaN, null, null], [0, 'geckoterminal', 9, { label: 'l' }], [null, 'rpc', 1, { why: 'w' }], ['3', 's', 1]];
    check('RWA: lib/rwa.js keeps the figure contract exactly — fig() and num() answer as lib/marketdata.js\'s do; none() and a yes/no fact never turn "not read" into 0 or false',
      figIn.every((a) => JSON.stringify(RW.fig(...a)) === JSON.stringify(MD.fig(...a))) && ['1', '', ' ', 'x', 2, Infinity, null].every((x) => RW.num(x) === MD.num(x))
      && RW.none('w', 'rpc', 1).v === null && RW.fact(null, 'rpc', 1).v === null && RW.fact(null, 'rpc', 1).why === 'not read' && RW.fact(false, 'rpc', 1).v === false && !('why' in RW.fact(false, 'rpc', 1)));
    // every selector and topic from ethers' id(), held to the verified ABIs Sourcify served
    const sigOf = (x) => x.name + '(' + (x.inputs || []).map((i) => i.type).join(',') + ')';
    const abiSel = new Map([...FR.abiReg.abi, ...FR.abiStock.abi].filter((x) => x.type === 'function').map((x) => [x.name, keccakId(sigOf(x)).slice(0, 10)]));
    const regEvt = new Map(FR.abiReg.abi.filter((x) => x.type === 'event').map((x) => [x.name, keccakId(sigOf(x))]));
    const selNames = ['totalSupply', 'decimals', 'name', 'symbol', 'tokenPaused', 'oraclePaused', 'uiMultiplier', 'newUIMultiplier', 'effectiveAt', 'terms', 'paused', 'implementation'];
    check('RWA: every selector the job calls is in the verified ABIs (Robinhood\'s registry and Stock.sol, Sourcify exact match) and equals id() of its signature; every registry event topic too — and the registry\'s real logs carry them',
      FR.abiReg.match === 'exact_match' && FR.abiStock.match === 'exact_match' && selNames.every((n) => abiSel.get(n) === RW.SELECTORS[n]) && ['RoleGranted', 'RoleRevoked', 'Blocked', 'Unblocked', 'Upgraded', 'Paused', 'Unpaused'].every((n) => regEvt.get(n) === RW.TOPICS[n])
      && RW.SELECTORS.aggregate3 === keccakId('aggregate3((address,bool,bytes)[])').slice(0, 10) && RW.SELECTORS.latestRoundData === keccakId('latestRoundData()').slice(0, 10)
      && [RW.TOPICS.RoleGranted, RW.TOPICS.Blocked, RW.TOPICS.Upgraded].every((t) => FR.logs.some((l) => l.topics[0] === t)), selNames.filter((n) => abiSel.get(n) !== RW.SELECTORS[n]).join(','));
    // the parsers, on the samples
    const pa = RW.parseRhjAssets(FR.assets), tsA = pa.assets.find((a) => a.symbol === 'TSLA'), tsF = FR.assets.assets.find((a) => a.tokenSymbol === 'TSLA');
    check('RWA: Robinhood\'s registry is read as served — every asset with its chain-4663 address (lower case), ISIN, multiplier, decimals and status — and its logo URLs are never kept; an answer without its list is a failed read',
      pa.ok && pa.assets.length === FR.assets.assets.length && tsA.address === TSLA && tsA.isin === tsF.isin && tsA.multiplier === Number(tsF.currentMultiplier) && tsA.decimals === 18 && tsA.status === 'ASSET_STATUS_ACTIVE'
      && !JSON.stringify(pa).includes('cdn.robinhood.com') && RW.parseRhjAssets({ error: 'x' }).ok === false && /assets list/.test(RW.parseRhjAssets(null).why), brief(tsA));
    const pp = RW.parseRhjPrices(FR.prices), qT = pp.quotes[TSLA], crmF = FR.prices.quotes.find((q) => q.tokenSymbol === 'CRM'), qC = pp.quotes[crmF.deployments[0].contractAddress.toLowerCase()];
    check('RWA: its quotes — the token bid/ask mid (multiplier applied, an undocumented field) kept apart from the raw bid/ask; the halt flag, the quote\'s time and the primary mint/burn USD as given',
      pp.ok && near(qT.mid, (399.31 + 399.4) / 2) && qT.halted === false && qT.at === Date.parse(FR.prices.quotes[2].generatedAt) && near(qT.mintBurnUsd, Number(FR.prices.quotes[2].mintBurnUsdVolume))
      && near(qC.mid, (Number(crmF.tokenBid) + Number(crmF.tokenAsk)) / 2) && near(qC.rawMid, (Number(crmF.bid) + Number(crmF.ask)) / 2) && qC.mid !== qC.rawMid, brief({ qT, qC }));
    const pd = RW.parseRhjDeviations(FR.devs), sats = Object.values(pd.rows).find((r) => r.symbol === 'SATS'), wk = pd.rows[WEEK];
    check('RWA: Robinhood\'s published deviations — SATS +1,494% (a premium, 32 trading days, since 2026-09-14), WEEK −50% (a discount), signed by direction, as of 2026-10-27',
      pd.ok && pd.asOf === '2026-10-27' && near(sats.pct, Number(FR.devs.rows[0].deviationPct)) && sats.direction === 'premium' && sats.days === 32 && sats.since === '2026-09-14' && wk && wk.pct < 0 && near(-wk.pct, Number(FR.devs.rows[1].deviationPct)) && wk.direction === 'discount', brief(pd));
    const pc = RW.parseRhjActions(FR.actions), a0 = FR.actions.corpActions[0];
    check('RWA: corporate actions — each for its token\'s address, its type and status in words, its date, its rate as a number',
      pc.ok && pc.actions.length === FR.actions.corpActions.length && pc.actions[0].address === a0.deployments[0].contractAddress.toLowerCase() && pc.actions[0].typeWords === 'cash dividend' && ['in progress', 'completed'].includes(pc.actions[0].status)
      && /^\d{4}-\d{2}-\d{2}$/.test(pc.actions[0].date) && pc.actions[0].details.rate === Number(a0.details.cashDividend.rate), brief(pc.actions[0]));
    const pf = RW.parseChainlinkDirectory(FR.feeds), fT = pf.feeds.find((x) => x.ticker === 'TSLA');
    check('RWA: Chainlink\'s directory — the "Robinhood <TICKER> / USD" (and "-USD") feeds and GLD / USD, by ticker, with proxy and heartbeat; the crypto feeds and exchange rates are left out',
      pf.ok && fT.proxy === '0x4a1166a659a55625345e9515b32adecea5547c38' && fT.heartbeat === 86400 && fT.decimals === 8 && pf.feeds.some((x) => x.ticker === 'GLD') && pf.feeds.some((x) => x.ticker === 'SGOV')
      && !pf.feeds.some((x) => /ETH|USDG|SYRUP/.test(x.ticker)) && pf.feeds.length === FR.feeds.filter((x) => /^Robinhood /.test(x.name) || x.name === 'GLD / USD').length, brief(pf.feeds.map((x) => x.ticker)));
    const fG = pf.feeds.find((x) => x.ticker === 'GLD'), fS = pf.feeds.find((x) => x.ticker === 'SGOV'), gldDir = FR.feeds.find((x) => x.name === 'GLD / USD');
    check('  ...a feed is the underlying\'s price only where the directory says it prices the share: every "Robinhood X / USD" feed (primaryTokenizedPrice, or US equity hours for the shared-SVR ones) is a reference; "GLD / USD" — a dex_state_price with crypto hours, the token\'s own DEX price — is kept as supporting evidence only (ref false)',
      fT.ref === true && fT.product === 'primaryTokenizedPrice' && fS && fS.ref === true && fG.ref === false && fG.priceKind === 'dex_state_price' && gldDir.docs.attributeType === 'dex_state_price' && gldDir.docs.marketHours === 'Crypto'
      && pf.feeds.filter((x) => x.ticker !== 'GLD').every((x) => x.ref === true), brief([fT, fS, fG]));
    const plist = RW.parseLlamaProtocols(F.protocols), picks = RW.tvlPicks(plist);
    check('RWA: DefiLlama\'s app list (the liquidity job\'s answer) — every app with a Robinhood Chain TVL, by slug; the deposits read are the RWA apps first, then the largest, never a DEX (its pools are Liquidity), an exchange, a curator, an aggregator, a liquidity manager, a locker or perps',
      plist.length > 20 && plist.every((p) => p.rhTvl > 0 && p.slug) && picks[0].category === 'RWA' && picks.some((p) => p.slug === 'morpho-blue') && picks.every((p) => !RW.TVL_SKIP.has(p.category)) && picks.length <= 12
      && plist.some((p) => p.category === 'Dexs') && plist.some((p) => p.category === 'CEX') && plist.some((p) => p.category === 'Risk Curators'), brief(picks.map((p) => p.slug + ':' + p.category)));
    const pm = RW.parseLlamaProtocol(FR.proto['morpho-blue']), pcx = RW.parseLlamaProtocol(FR.proto['catch-exchange']);
    const lastCx = FR.proto['catch-exchange'].chainTvls['Robinhood Chain'].tokensInUsd.slice(-1)[0];
    check('RWA: an app\'s deposits on the chain — the latest tokensInUsd entry, by symbol (Morpho holds NVDA and mGLO as collateral; Catch Exchange\'s newest entry, not its older one)',
      pm.ok && pm.tokens.NVDA === FR.proto['morpho-blue'].chainTvls['Robinhood Chain'].tokensInUsd[0].tokens.NVDA && pm.tokens.MGLO > 3e7 && pcx.tokens.GLD === lastCx.tokens.GLD && pcx.date === lastCx.date * 1000 && RW.parseLlamaProtocol({ name: 'x' }).ok === false, brief({ m: pm.tokens.NVDA, c: pcx.tokens }));
    const ps = RW.parseStablecoins(FR.stables), usdgS = ps.rows.find((x) => x.symbol === 'USDG'), usdgF = FR.stables.peggedAssets.find((x) => x.symbol === 'USDG');
    check('RWA: DefiLlama\'s stablecoins — those circulating on Robinhood Chain with their backing (USDG fiat-backed; USDe, U and Multipli\'s crypto-backed); one not on the chain (USDT) is not listed',
      ps.ok && usdgS.pegMechanism === 'fiat-backed' && usdgS.circulating === usdgF.chainCirculating['Robinhood Chain'].current.peggedUSD && usdgS.price === usdgF.price && ps.rows.filter((x) => x.pegMechanism === 'crypto-backed').map((x) => x.symbol).sort().join() === 'U,USDe,rwaUSD,rwaUSDi' && !ps.rows.some((x) => x.symbol === 'USDT'), brief(ps.rows));
    const pg = RW.parseGtMulti(FR.multi), gGld = Object.values(pg.tokens).find((t) => t.geckoId === 'spdr-gold-shares-robinhood-token');
    const ptp = RW.parseGtTokenPools(FR.tslaPools), opt = ptp.pools.find((p) => p.name === 'OPTIMUS / TSLA'), usdgP = ptp.pools.find((p) => p.name === 'TSLA / USDG 0.3%');
    check('RWA: GeckoTerminal\'s multi read (its symbol as it gives it — "gld" — kept apart from Robinhood\'s) and a token\'s pools: both sides of each, the symbol from the pool\'s name less its fee',
      pg.ok && gGld && gGld.symbol === 'gld' && gGld.reserveUsd > 0 && ptp.ok && ptp.pools.length === FR.tslaPools.data.length && opt.base.symbol === 'OPTIMUS' && opt.quote.address === TSLA && usdgP.quote.symbol === 'USDG' && usdgP.base.address === TSLA, brief({ opt, usdgP }));
    // what kind of asset, and its underlying
    const K = (s, n, i) => RW.kindOf(s, n, i), U = (i, s, n) => RW.underlyingOf(i, s, n);
    check('RWA: the asset kind — bonds and T-bills (SGOV, SHY, BND, WEEK, and a T-Bill ETF by name), commodities (GLD, SLV, USO, GDX, CPER), ETFs (the curated set and the ETF/Trust/Fund/iShares/SPDR… name test), Midas\'s credit fund, every other share a stock',
      K('SGOV', 'iShares 0-3 Month Treasury Bond', 'rhj') === 'bond' && K('WEEK', null, 'rhj') === 'bond' && K('GLD', 'SPDR Gold Trust', 'rhj') === 'commodity' && K('SPY', 'SPDR S&P 500 ETF Trust', 'rhj') === 'etf' && K('QQQ', 'Invesco QQQ', 'rhj') === 'etf'
      && K('EWY', 'iShares MSCI South Korea fund', 'rhj') === 'etf' && K('TSLA', 'Tesla', 'rhj') === 'stock' && K('mGLO', 'Midas Fasanara Global Open', 'midas') === 'credit'
      && U('ondo', 'CPERon', 'US Copper Index Fund (Ondo Tokenized)').kind === 'commodity' && U('anchored', 'abil', 'SPDR Bloomberg 1-3 Month T-Bill ETF (Anchored Tokenized ETF)').kind === 'bond');
    check('RWA: the underlying, so one share\'s tokens group together — Robinhood\'s ticker and name less " • Robinhood Token"; Ondo less "on" and "(Ondo Tokenized …)"; Anchored less its "a"; ST0x less "wt"',
      U('rhj', 'TSLA', 'Tesla • Robinhood Token').name === 'Tesla' && U('ondo', 'TSLAon', 'Tesla (Ondo Tokenized)').symbol === 'TSLA' && U('ondo', 'googlon', 'Alphabet Class A (Ondo Tokenized Stock)').name === 'Alphabet Class A'
      && U('anchored', 'aaapl', 'Apple aStock').symbol === 'AAPL' && U('anchored', 'aaapl', 'Apple aStock').name === 'Apple' && U('st0x', 'wtWMT', 'Wrapped Walmart Inc. ST0x').symbol === 'WMT' && U('st0x', 'wtWMT', 'Wrapped Walmart Inc. ST0x').name === 'Walmart Inc.');
    // the classifier, tier by tier (a made-up address for a hypothetical state; the real ones for what the samples hold)
    const asset = pa.assets.find((a) => a.symbol === 'GME'), at0 = RNOW - 3600e3, X = '0x' + 'ab'.repeat(20);
    const c1 = RW.classify(GME_RHJ, { asset, registryAt: at0, chain: { beacon: REGISTRY, beaconAt: at0 } }), c2 = RW.classify(GME_RHJ, { asset, registryAt: at0, chain: {} });
    const wkChain = { beacon: REGISTRY, beaconAt: at0 }, c3 = RW.classify(WEEK, { asset: null, registryAt: at0, chain: Object.assign({ codeMatch: true, codeAt: at0 }, wkChain), rhjNamed: ['/price-deviations'] });
    const c4 = RW.classify(X, { asset: { symbol: 'X', status: 'ASSET_STATUS_ACTIVE' }, registryAt: at0, chain: { beacon: '0x' + '0'.repeat(40), beaconAt: at0 } });
    check('RWA: Robinhood\'s tokens — the registry and the chain\'s fingerprint both: "confirmed"; the registry with the slot not read yet: "issuer-listed" (why: fingerprint not read yet); out of the registry\'s list (WEEK), the slot AND the code matching the registry\'s own tokens: "confirmed", its status saying so; a registry entry whose slot reads otherwise is flagged',
      c1.rwa && c1.confidence === 'confirmed' && c1.evidence.map((e) => e.tier).join() === 'A1,A2' && c1.evidence[0].text === 'Listed in Robinhood\'s Stock Token registry (api.robinhood.com/rhj/assets)' && c1.evidence[1].text === 'Its code runs from Robinhood\'s token registry contract (checked on the chain)'
      && c2.confidence === 'issuer-listed' && c2.why === 'fingerprint not read yet' && c3.rwa && c3.confidence === 'confirmed' && c3.status.text === 'On the chain, not in the registry\'s active list' && c3.issuer.key === 'rhj' && c3.evidence[0].tier === 'A2' && /proxy code the registry's own Stock Tokens run/.test(c3.evidence[0].text)
      && c4.mismatch === true && /not Robinhood's registry \(checked on the chain\)/.test(c4.why), brief([c1, c2, c3, c4]));
    /* the review's attack (2026-10-28): any contract can write the registry's address into its own beacon slot. The slot alone never
       makes a token Robinhood's: its code must also be the registry tokens' own, compared by keccak on the chain */
    const s1 = RW.classify(X, { asset: null, registryAt: at0, chain: wkChain }), s2 = RW.classify(X, { asset: null, registryAt: at0, chain: Object.assign({ codeMatch: false, codeAt: at0 }, wkChain) });
    const s3 = RW.classify(WEEK, { asset: null, registryAt: at0, chain: wkChain, rhjNamed: ['/price-deviations'] }), s4 = RW.classify(WEEK, { asset: null, registryAt: at0, chain: {}, rhjNamed: ['/price-deviations'] });
    check('RWA: the beacon slot alone never qualifies — a token the registry does not list whose slot names the registry is not an RWA until its code matches (pending), and not one at all when its code differs; one Robinhood\'s own answers name is shown "not confirmed" meanwhile, and before its slot is read it is never told "not an RWA here"',
      s1.rwa === false && s1.pending === true && /code has not been compared/.test(s1.why) && !s1.evidence.some((e) => /^A/.test(e.tier)) && s1.evidence.some((e) => e.kind === 'beacon-slot' && /any contract can write that slot/.test(e.text))
      && s2.rwa === false && !s2.pending && /its code is not the code Robinhood's Stock Tokens run/.test(s2.why) && s2.issuer === null
      && s3.rwa === true && s3.confidence === 'not-confirmed' && /code has not been compared/.test(s3.why) && s3.evidence.some((e) => e.kind === 'robinhood-api')
      && s4.rwa === false && s4.pending === true && /^Not confirmed as an RWA yet/.test(s4.why) && /may still be one of Robinhood's Stock Tokens/.test(s4.why) && !/Not an RWA here/.test(s4.why)
      && RW.notRwaWhy(WEEK, s4, { rows: [] }) === s4.why, brief([s1, s2, s3, s4]));
    const ondoB = RW.ISSUERS.ondo.beacons[0];
    const c5 = RW.classify(TSLAON, { chain: {} }), c6 = RW.classify(TSLAON, { chain: { beacon: ondoB, beaconAt: at0 }, geckoId: 'tesla-ondo-tokenized-stock', geckoAt: at0 }), c7 = RW.classify(TSLAON, { chain: { beacon: REGISTRY, beaconAt: at0 } });
    const c7b = RW.classify(TSLAON, { chain: { beacon: '0x' + '0'.repeat(40), beaconAt: at0 } });
    const c6s = RW.classify(TSLAON, { chain: { beacon: ondoB, beaconAt: at0 }, geckoId: 'tesla-ondo-tokenized-stock', geckoSrc: 'site' });
    check('RWA: another issuer on this site\'s list — "not-confirmed" until its own beacon is read (why: fingerprint not read yet), "confirmed" once it matches (CoinGecko\'s id only as supporting evidence), and not counted when the slot reads otherwise',
      c5.rwa && c5.confidence === 'not-confirmed' && c5.why === 'fingerprint not read yet' && c6.confidence === 'confirmed' && c6.evidence.map((e) => e.tier).join() === 'A3,B' && /supporting evidence only/.test(c6.evidence[1].text)
      && c7.rwa === false && c7.pending === true && c7b.rwa === false && /not Ondo Global Markets's beacon|not Ondo Global Markets'?s? beacon/.test(c7b.why), brief([c5, c6, c7b]));
    /* review two (2026-10-28). 8: a token off this site's list whose slot names another issuer's beacon (Anchored's aTSLA, 0x10fa…e146
       on Anchored's beacon in the research's landscape, one of its contracts not on the list) is said as the chain read it — never
       "its code does not run from an issuer's beacon (checked on the chain)" — and not counted. 10: Midas's confirmation is a live
       ERC-1967 proxy, said as such (check: 'proxy'), never "its fingerprint is the issuer's". 14: an issuer-list item the chain has
       not agreed with yet is listed, not proof (proof: false) */
    const ATSLA = '0x10fad4a60adb421f8f5ca6f9f2eaf2dbc110e146', anchB = RW.ISSUERS.anchored.beacons[0], st0xB = RW.ISSUERS.st0x.beacons[0];
    const h8 = RW.classify(ATSLA, { chain: { beacon: anchB, beaconAt: at0 }, geckoId: 'tesla-astock', geckoAt: at0 }), h8s = RW.classify(X, { chain: { beacon: st0xB, beaconAt: at0 } });
    const h8w = RW.notRwaWhy(ATSLA, h8, { symbol: 'aTSLA', rows: [], registryRead: true, beaconRead: true, beacon: anchB }), h8n = RW.notRwaWhy(X, { why: null }, { symbol: 'ZZQ', rows: [], registryRead: true, beaconRead: true, beacon: st0xB });
    const h10 = RW.classify('0xfed493f38c1aacb4ea4e6a11f8b9287849ee0096', { chain: { impl: '0x' + '0'.repeat(36) + 'dead', implAt: at0 } });
    check('RWA review two: a token off this site\'s list on another issuer\'s beacon (Anchored\'s aTSLA, an ST0x share) is not counted, and its answer says what the chain read — never "its code does not run from an issuer\'s registry or beacon"; Midas\'s confirmation says a live ERC-1967 proxy, its code not compared; a listed token the chain has not agreed with is "listed, not proof" (proof: false)',
      h8.rwa === false && /^Its beacon slot names Anchored \(aStock\)'s beacon \(checked on the chain\)/.test(h8.why) && h8.beaconOf.key === 'anchored' && h8.evidence.some((e) => e.kind === 'beacon-slot' && e.tier === 'B') && h8w === h8.why && !/does not run from/.test(h8w)
      && h8s.rwa === false && /ST0x \(S01 Issuer GmbH\)'s beacon/.test(h8s.why) && !/does not run from/.test(h8n)
      && /does not run from an issuer's registry or beacon/.test(RW.notRwaWhy(X, { why: null }, { symbol: 'ZZQ', rows: [], registryRead: true, beaconRead: true, beacon: '0x' + '0'.repeat(40) }))
      && h10.confidence === 'confirmed' && h10.evidence[0].check === 'proxy' && /its code is not compared with the issuer's/.test(h10.evidence[0].text) && /a live ERC-1967 proxy on the chain/.test(h10.status.text)
      && c6.evidence[0].check === 'beacon' && c6.evidence[0].proof !== false && c5.evidence[0].tier === 'A3' && c5.evidence[0].proof === false && /not checked on the chain yet/.test(c5.evidence[0].text), brief([h8.why, h8n, h10.evidence[0], c5.evidence[0]]));
    check('  ...and CoinGecko\'s id is credited to its source: GeckoTerminal\'s read (with its time) when a read gave it, this site\'s own list (no read time) when the id is the list\'s — never a GeckoTerminal read that did not happen',
      c6.evidence[1].src === 'geckoterminal' && c6.evidence[1].at === at0 && c6s.evidence[1].src === 'site' && c6s.evidence[1].at === null && /this site's list, taken from CoinGecko's platform map on 2026-10-28/.test(c6s.evidence[1].text), brief([c6.evidence[1], c6s.evidence[1]]));
    const cgRow = (id) => FR.cg.find((c) => c.id === id), traps = ['gamestop-3', 'greatest-meme-ever', 'a-meme-coin', 'advanced-micro-dog', 'blackrock', 'blockchain-usd'].map(cgRow);
    check('RWA: a name or a symbol never qualifies — CoinGecko\'s "GameStop" memecoin (GME), Greatest Meme Ever, A Meme Coin (AMC), Advanced Micro Dog (AMD), BLACKROCK and Blockchain USD (USDB) are not RWAs, even with a ticker of one',
      traps.every((c) => c && RW.classify(c.platforms.robinhood, { chain: { beacon: '0x' + '0'.repeat(40), beaconAt: at0 }, geckoId: c.id }).rwa === false) && RW.classify(GME_MEME, { chain: {} }).rwa === false
      && RW.classify('0x4a0ade17fa7602bdfc7d2a9c85f404328687c92d', { chain: {} }).rwa === false, brief(traps.map((c) => c.id)));
    // the multicall, encoded and decoded; a revert is "no such function"
    const subs = [{ target: TSLA, data: RW.SELECTORS.totalSupply }, { target: TSLA, data: RW.SELECTORS.paused }];
    const enc = RW.encodeAggregate3(subs), dec = RW.decodeAggregate3(ABI.encode(['tuple(bool,bytes)[]'], [[[true, RR.tsla.totalSupply], [false, '0x']]]));
    check('RWA: the Multicall3 aggregate3 call is encoded with allowFailure on every subcall, and its answer decoded per subcall; a subcall that reverted is "no such function" (absent) — never false or 0',
      enc.startsWith(RW.SELECTORS.aggregate3) && ABI.decode(['tuple(address,bool,bytes)[]'], '0x' + enc.slice(10))[0].every((x) => x[1] === true) && dec.length === 2 && RW.decodeAs('uint', dec[0]).v === BigInt(RR.tsla.totalSupply)
      && RW.decodeAs('bool', dec[1]).absent === true && RW.decodeAs('uint', { ok: true, data: '0x' }).absent === true && RW.decodeAs('string', { ok: true, data: ABI.encode(['string'], ['https://robinhood.com/stocktoken/rhj']) }).v === 'https://robinhood.com/stocktoken/rhj');
    // the registry's logs, folded
    const fold = RW.foldRegistryLogs(null, FR.logs), rr = RW.roleRows(fold);
    const holders = (n) => RW.holdersOf(fold, n);
    check('RWA: the registry\'s 276 logs folded into its roles — one wallet can upgrade every token (BEACON_UPGRADER_ROLE 0xcd8c…), the token deployer 0x5516…, two minters (one granted in October 2026), the deployer\'s own admin revoked; 175 wallets blocked; two upgrades, both to Stock.sol; an unknown hash is "an unnamed role"',
      fold.logs === FR.logs.length && holders('BEACON_UPGRADER_ROLE').join() === '0xcd8c6182e7c6ca3b5156d6a90a67719d7e2be094' && holders('TOKEN_DEPLOYER_ROLE').join() === '0x5516b3451d4d6c9f63353fe7bc9537477ecce000'
      && holders('MINTER_ROLE').sort().join() === ['0x13643b89b19245201b29d556edde5cf18f749c08', '0x2b94105fff37630f98e1f24811dad588fc5c3a87'].sort().join() && holders('DEFAULT_ADMIN_ROLE').join() === '0xd6f8378f8e440c65f8382f5f2728c78dfd55b66d'
      && fold.blocked.length === 175 && fold.upgrades.length === 2 && fold.upgrades.every((u) => u.implementation === '0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2') && rr.some((r) => r.role === 'an unnamed role' && r.holder === '0x697e774d60c1a3769f2ed0b919aacf17be0ae553')
      && rr[0].role === 'BEACON_UPGRADER_ROLE', brief({ blocked: fold.blocked.length, up: fold.upgrades, roles: rr.map((r) => r.role + ' ' + r.holder.slice(0, 8)) }));
    // sorting, connected pools, lookalikes (pure)
    const rowsN = [{ v: 3 }, { v: null }, { v: 1 }, { v: 2 }];
    check('RWA: a missing figure sorts last in both directions (nullLast)', rowsN.slice().sort(RW.nullLast('desc', (r) => r.v)).map((r) => r.v).join() === '3,2,1,' && rowsN.slice().sort(RW.nullLast('asc', (r) => r.v)).map((r) => r.v).join() === '1,2,3,');
    const tpRows = ptp.pools.map((p) => Object.assign({}, p, { at: at0 }));
    const cn1 = RW.connectedRows(tpRows, new Set([TSLA, '0x117cc2133c37b721f49de2a7a74833232b3b4c0c', '0xec262a75e413fafd0df80480274532c79d42da09']), () => 'TSLA');
    const wantC = FR.tslaPools.data.filter((d) => { const b = d.relationships.base_token.data.id.slice(10), q = d.relationships.quote_token.data.id.slice(10), o = b === TSLA ? q : b; return !['0x5fc5360d0400a0fd4f2af552add042d716f1d168', '0x0bd7d308f8e1639fab988df18a8011f41eacad73', '0x0000000000000000000000000000000000000000', '0x117cc2133c37b721f49de2a7a74833232b3b4c0c', '0xec262a75e413fafd0df80480274532c79d42da09'].includes(o); });
    const cn2 = RW.connectedRows(tpRows, new Set([TSLA]), () => 'TSLA', 50000);   // SPY and MSTR not counted as RWAs here: their pools with TSLA count too
    const wantC2 = FR.tslaPools.data.filter((d) => { const b = d.relationships.base_token.data.id.slice(10), q = d.relationships.quote_token.data.id.slice(10), o = b === TSLA ? q : b; return !RW.QUOTES.has(o); });
    check('RWA: tokens connected to an RWA — a pool against TSLA whose other side is not USDG, WETH (or native ETH) or another RWA (SPY, MSTR): OPTIMUS, DOGGIE, TSLR… each "Not an RWA — paired with $TSLA", deepest first; under the floor they are counted, not listed',
      cn1.rows.length === wantC.length && cn1.rows[0].symbol === 'OPTIMUS' && cn1.rows.every((r) => r.label === 'Not an RWA — paired with $TSLA' && r.rwa.address === TSLA && r.reserveUsd.v >= 1000) && cn1.below === 0 && cn1.floor === 1000
      && cn2.rows.every((r) => r.reserveUsd.v >= 50000) && cn2.below === wantC2.filter((d) => Number(d.attributes.reserve_in_usd) < 50000).length && cn2.rows.length === wantC2.filter((d) => Number(d.attributes.reserve_in_usd) >= 50000).length && cn2.below > 0, brief({ n: cn1.rows.length, want: wantC.length, rows: cn1.rows.map((r) => r.symbol + ' ' + r.reserveUsd.v), cn2: [cn2.rows.length, cn2.below] }));
    const fakeRows = [{ address: GME_RHJ, symbol: 'GME', name: 'GameStop • Robinhood Token', underlying: { symbol: 'GME', name: 'GameStop' }, issuer: RW.issuerOf('rhj') }, { address: '0x05a3d1cd21d0c88145e82600e62e7e496e0f222b', symbol: 'AMC', name: 'AMC Entertainment Holdings, Inc. • Robinhood Token', underlying: { symbol: 'AMC', name: 'AMC Entertainment Holdings, Inc.' }, issuer: RW.issuerOf('rhj') }];
    const look = RW.lookalikesOf(fakeRows, FR.cg.map((c) => ({ address: c.platforms.robinhood, symbol: c.symbol, name: c.name, src: 'coingecko' })), new Set([GME_RHJ, '0x05a3d1cd21d0c88145e82600e62e7e496e0f222b', '0xb094d0d3221d7f7a9f14b0f78c34cd38d7acf6f2']));
    check('RWA: lookalikes — a token with an RWA\'s ticker or underlying name that is not itself an RWA: GME gets the "GameStop" memecoin and Greatest Meme Ever, AMC gets A Meme Coin; Ondo\'s GMEon (an RWA itself) and the registry\'s own tokens are never lookalikes',
      (look.get(GME_RHJ) || []).map((x) => x.address).sort().join() === [GME_MEME, cgRow('greatest-meme-ever').platforms.robinhood].sort().join() && (look.get('0x05a3d1cd21d0c88145e82600e62e7e496e0f222b') || []).map((x) => x.address).join() === cgRow('a-meme-coin').platforms.robinhood
      && ![...look.values()].flat().some((x) => x.address === '0xb094d0d3221d7f7a9f14b0f78c34cd38d7acf6f2'), brief([...look].map(([k, v]) => [k.slice(0, 8), v.map((x) => x.symbol)])));

    /* ── the review's cases (2026-10-28), lib/rwa.js buildRows alone. The registry, feeds and GeckoTerminal answers are the samples'
       (parsed above); the reads of the chain, the quotes and DefiLlama's apps here are hypothetical states the review described, made
       up like X above to put each rule to the test ── */
    {
      const now = RNOW, H = 3600e3, D = 24 * H;
      const GLDA = '0xc9a981fee1f9dec688bb123ccdecc63d0debfc4e', NVDA = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', SPYA = '0x117cc2133c37b721f49de2a7a74833232b3b4c0c', PA = '0x1cdad396db64bda184d5182a97dd9b3c62100b7d';
      const SATS = '0x95052ddcd5dc25641657424a8cf04834997e1730', GOOGL = '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3', GOOGLON = '0xe10cc5f0cd0c90322ebeb33e7757b2c9090146dc';
      const assetsS = { readAt: now - H, data: pa }, linkS = { readAt: now - H, data: pf }, fTS = pf.feeds.find((x) => x.ticker === 'TSLA');
      const reg = (extra) => Object.assign({ beacon: REGISTRY, beaconAt: now - H, fpAt: now - H }, extra || {});
      const gtOf = (a) => Object.assign({}, pg.tokens[a], { at: now - H });
      const B0 = { at: now - H, rows: [] };
      const build = (o) => RW.buildRows(Object.assign({ now, batch: B0, assets: assetsS, chainlink: linkS, logo: (u) => u }, o));
      const rowOf = (b, a) => b.rows.find((r) => r.address === a);
      // 2. GLD: the "GLD / USD" feed prices the token's own DEX state, so the premium is against Robinhood's quote (DEX 369.65, quote mid 342.27)
      const pricesG = { readAt: now - 600e3, data: { ok: true, generatedAt: now - 600e3, quotes: { [GLDA]: { symbol: 'GLD', tokenBid: 342.2, tokenAsk: 342.34, mid: 342.27, halted: false, at: now - 600e3, mintBurnUsd: null } } } };
      const gldFeed = pf.feeds.find((x) => x.ticker === 'GLD');
      const bG = build({ prices: pricesG, chain: { tokens: { [GLDA]: reg({ tokenPaused: false, oraclePaused: false, stateAt: now - H }) }, feeds: { [gldFeed.proxy]: { answer: '36940000000', updatedAt: Math.floor((now - 20 * 60e3) / 1000), at: now - H, description: 'GLD / USD' } } }, gt: { tokens: { [GLDA]: gtOf(GLDA) } } });
      const g1 = rowOf(bG, GLDA);
      check('RWA review: GLD\'s premium is measured against Robinhood\'s quote of the share — never against Chainlink\'s "GLD / USD", which prices the token\'s own DEX trading (a premium against it is about 0 by construction)',
        g1.reference.chainlink.v === null && g1.reference.chainlink.notReference === true && /priced from the token's own DEX trading/.test(g1.reference.chainlink.why) && g1.premium.ref === 'robinhood' && near(g1.premium.v, (gtOf(GLDA).priceUsd / 342.27 - 1) * 100) && g1.premium.v > 7.9 && g1.flags.includes('premium')
        && g1.evidence.some((e) => e.kind === 'chainlink' && /priced from the token's own DEX trading/.test(e.text)), brief([g1.premium, g1.reference.chainlink]));
      // 7. TSLA's oracle paused for a corporate action, its feed still answering inside its heartbeat (half the price, before the multiplier update)
      const tChain = (paused, answer) => ({ tokens: { [TSLA]: reg({ tokenPaused: false, oraclePaused: paused, stateAt: now - H, supplyRaw: RR.tsla.totalSupply.toString(), supplyAt: now - H }) }, feeds: { [fTS.proxy]: { answer, updatedAt: Math.floor((now - 30 * 60e3) / 1000), at: now - H, description: 'RHTSLA / USD' } } });
      const tP = rowOf(build({ chain: tChain(true, '19900000000'), gt: { tokens: { [TSLA]: gtOf(TSLA) } } }), TSLA), tZ = rowOf(build({ chain: tChain(false, '0'), gt: { tokens: { [TSLA]: gtOf(TSLA) } } }), TSLA);
      check('RWA review: while Robinhood\'s price oracle is paused for a corporate action, no premium is worked out (its price is "temporarily unavailable"), and the feed\'s answer says not to trust it; a zero or negative feed answer is never a price',
        tP.premium.v === null && /paused for a corporate action/.test(tP.premium.why) && tP.flags.includes('oracle-paused') && !tP.flags.includes('premium') && tP.reference.chainlink.oraclePaused === true && /not to trust this price/.test(tP.reference.chainlink.label)
        && tZ.reference.chainlink.v === null && /not a price/.test(tZ.reference.chainlink.why), brief([tP.premium, tZ.reference.chainlink]));
      // 1/24/25. market cap: every chain's only for a multi-chain issuer; Robinhood's single-chain tokens stay in the ranking (SPY as GeckoTerminal answered at 17:59 UTC)
      const spyGt = Object.assign(gtOf(SPYA), { mcap: 20702682.5581889, fdv: 20324917.614719 });
      const bM = build({ chain: { tokens: { [SPYA]: reg(), [PA]: reg(), [TSLAON]: { beacon: RW.ISSUERS.ondo.beacons[0], beaconAt: now - H, fpAt: now - H } } }, gt: { tokens: { [SPYA]: spyGt, [PA]: gtOf(PA), [TSLAON]: { symbol: 'TSLAon', priceUsd: 400, mcap: 5e6, fdv: 5e6, reserveUsd: 1e5, volume24h: 1e4, at: now - H } } } });
      const mS = rowOf(bM, SPYA), mP = rowOf(bM, PA), mO = rowOf(bM, TSLAON), gS = RW.groupRows([mS, mP], now - H);
      check('RWA review: a Robinhood Stock Token\'s market cap above its FDV (SPY ×1.0186, P) is never called every chain\'s — it lives on chain 4663 alone; it stays in the market-cap ranking, said for what it is; only Ondo\'s and Anchored\'s are every chain\'s, and only then do a group\'s and the totals\' words say so',
        mS.mcap.v === 20702682.5581889 && !mS.mcap.global && mS.mcap.aboveFdv === true && /CoinGecko counts its supply differently/.test(mS.mcap.label) && !/every chain/.test(mS.mcap.label) && !mS.flags.includes('global-mcap') && mS._globalMc === false
        && mP.mcap.aboveFdv === true && !mP._globalMc && mO.mcap.global === true && mO._globalMc === true && mO.flags.includes('global-mcap') && gS.every((g) => !g.mcap.global && !/every-chain/.test(g.mcap.label)), brief([mS.mcap, mP.mcap, mO.mcap]));
      // 5/6. GeckoTerminal asked and silent; a null price; no indexed pool behind a 0.0 volume
      const bA = build({ chain: { tokens: { [SATS]: reg(), [TSLA]: reg() } }, gt: { tokens: { [SATS]: gtOf(SATS), [TSLA]: { absent: true, at: now - 2 * H } } } });
      const aS = rowOf(bA, SATS), aT = rowOf(bA, TSLA), aG = rowOf(bA, GLDA);
      check('RWA review: GeckoTerminal\'s token read says why it gave nothing — "has no entry for it" when it answered without one, "has not run yet" only when it has not; a null price is "gave no price"; a 0.0 volume beside no reserve (no pool it indexes: SATS, BND) is not a measured $0',
        pg.tokens[SATS].noPool === true && pg.tokens[SATS].volume24h === null && aS.volume24h.v === null && /indexes no pool/.test(aS.volume24h.why) && /gave no price for it/.test(aS.priceUsd.why) && aS.liquidity.v === null
        && /token read \(.* UTC\) has no entry for it/.test(aT.priceUsd.why) && /has no entry for it/.test(aT.liquidity.why) && /has no entry for it/.test(aT.volume24h.why) && /has no entry for it/.test(aT.mcap.why)
        && /has not run yet/.test(aG.liquidity.why) && /has not run yet/.test(aG.mcap.why), brief([aS.volume24h, aT.priceUsd, aG.mcap]));
      // 4/11/26. DefiLlama's apps: a failed read keeps its deposits with ITS time (and goes stale), is dropped after two days, and an app never read is never "no deposits"
      const app = (at, tokens, fail) => Object.assign({ ok: true, at, name: 'Morpho Blue', category: 'Lending', date: at, tokens }, fail ? { failAt: now - 30 * 60e3, failWhy: fail } : {});
      const catchR = { ok: true, at: now - 30 * 60e3, name: 'Catch Exchange', category: 'RWA', date: now - 40 * 60e3, tokens: { GLD: 1765.48 } };
      const tvlOf = (morpho) => build({ chain: { tokens: { [NVDA]: reg(), [GLDA]: reg(), [TSLA]: reg() } }, tvl: { readAt: now - 30 * 60e3, picks: ['morpho-blue', 'catch-exchange'], reads: Object.assign({ 'catch-exchange': catchR }, morpho ? { 'morpho-blue': morpho } : {}) } });
      const k1 = tvlOf(app(now - 20 * H, { NVDA: 1446457.16865 }, 'upstream 503')), k2 = tvlOf(app(now - 5 * D, { NVDA: 1446457.16865 }, 'upstream 503')), k3 = tvlOf({ ok: false, name: 'Morpho Blue', category: 'Lending', failAt: now - 30 * 60e3, failWhy: 'upstream 404' }), k4 = tvlOf(app(now - 30 * 60e3, { NVDA: 1446457.16865 }));
      const n1 = rowOf(k1, NVDA).tvl, n2 = rowOf(k2, NVDA).tvl, n3 = rowOf(k3, NVDA).tvl, g3 = rowOf(k3, GLDA).tvl, t4 = rowOf(k4, TSLA).tvl;
      check('RWA review: TVL in DeFi — an app\'s kept deposits carry their own read time (the figure is dated by its oldest app, stale past 12 h, the app marked kept and why); past two days they are dropped and the token is "not read", never a fresh figure; an app never read makes a token "not in the apps read; not read: Morpho Blue (upstream 404)" and a sum "may be low" — "lists no deposits" only when every app was read',
        n1.v === 1446457.16865 && n1.at === now - 20 * H && n1.stale === true && n1.protocols[0].kept === true && /upstream 503/.test(n1.protocols[0].keptWhy) && n1.protocols[0].at === now - 20 * H
        && n2.v === null && /not in the 1 app DefiLlama answered for; not read: Morpho Blue \(its last good read, from .* is more than 2 days old\)/.test(n2.why) && n2.missingApps.join() === 'morpho-blue'
        && n3.v === null && /not read: Morpho Blue \(upstream 404\)/.test(n3.why) && g3.v === 1765.48 && /not read: Morpho Blue \(upstream 404\), so it may be low/.test(g3.label) && g3.missingApps.join() === 'morpho-blue'
        && ![k2, k3].some((b) => b.rows.some((r) => /lists no DeFi deposits/.test(r.tvl.why || ''))) && /lists no DeFi deposits of it on Robinhood Chain — Morpho Blue as read at .* \(not read since: upstream 503\)/.test(rowOf(k1, TSLA).tvl.why) && /^DefiLlama lists no DeFi deposits of it on Robinhood Chain$/.test(t4.why) && rowOf(k4, NVDA).tvl.at === now - 30 * 60e3 && !rowOf(k4, NVDA).tvl.stale, brief([n1, n2, n3, g3.label]));
      // 14. no Robinhood artwork: a Stock Token's row draws its letter; any picture named after the token's own address is left out
      const own = 'https://coin-images.coingecko.com/coins/images/102174112/large/' + TSLAON + '.png?1', other = 'https://assets.geckoterminal.com/img/tslaon.png';
      const lg = (u) => rowOf(build({ chain: { tokens: { [TSLA]: reg(), [TSLAON]: { beacon: RW.ISSUERS.ondo.beacons[0], beaconAt: now - H, fpAt: now - H } } }, gt: { tokens: { [TSLA]: gtOf(TSLA), [TSLAON]: { symbol: 'TSLAon', priceUsd: 400, logo: u, at: now - H } } } }), TSLAON).logo;
      const tL = rowOf(build({ chain: { tokens: { [TSLA]: reg() } }, gt: { tokens: { [TSLA]: Object.assign(gtOf(TSLA), { logo: 'https://coin-images.coingecko.com/coins/images/102174112/large/' + TSLA + '.png' }) } } }), TSLA).logo;
      check('RWA review: no Robinhood artwork — a Robinhood Stock Token\'s row carries no picture (CoinGecko re-hosts Robinhood\'s feather under the token\'s address), and any picture named after a token\'s own address is dropped; another picture is kept',
        tL === null && lg(own) === null && lg(other) === other, brief([tL, lg(own), lg(other)]));
      // 10. a group's main token: the registry's first — a token found by the chain alone, however large, never leads the group; a token not confirmed is out of the sums
      const ATT2 = '0x' + 'cd'.repeat(20);
      const bR = build({ chain: { tokens: { [TSLA]: reg({ supplyRaw: RR.tsla.totalSupply.toString(), supplyAt: now - H }), [ATT2]: reg({ codeMatch: true, codeAt: now - H, symbol: 'TSLA', name: 'Tesla • Robinhood Token', decimals: 18, supplyRaw: (10n ** 30n).toString(), supplyAt: now - H }), [GOOGL]: reg({ supplyRaw: (10n ** 21n).toString(), supplyAt: now - H }), [GOOGLON]: { supplyRaw: (10n ** 22n).toString(), decimals: 18, supplyAt: now - H } } },
        gt: { tokens: { [TSLA]: gtOf(TSLA), [ATT2]: Object.assign(gtOf(TSLA), { symbol: 'TSLA' }), [GOOGL]: gtOf(GOOGL), [GOOGLON]: { symbol: 'googlon', priceUsd: 300, at: now - H } } } });
      const gR = RW.groupRows(bR.rows, now - H), gT = gR.find((g) => g.key === 'TSLA'), gGo = gR.find((g) => g.key === 'GOOGL');
      check('RWA review: a group is led by the token in Robinhood\'s registry — never by one found by the chain alone, whatever its value — and a token not confirmed on the chain is listed in its group but out of its sums',
        gT.main === TSLA && gT.tokens[0].address === TSLA && rowOf(bR, ATT2).value.v > rowOf(bR, TSLA).value.v && gGo.main === GOOGL && rowOf(bR, GOOGLON).confidence === 'not-confirmed' && gGo.tokens.length === 2
        && near(gGo.value.v, rowOf(bR, GOOGL).value.v) && /1 not confirmed on the chain yet is left out/.test(gGo.value.label), brief([gT.main, gGo.value]));
      // 8. a lookalike's pointer to the real one, worded by that token's own evidence
      const bW = build({ chain: { tokens: { [WEEK]: reg({ codeMatch: true, codeAt: now - H, symbol: 'WEEK' }) } }, deviations: { readAt: now - H, data: pd } });
      const wWhy = RW.notRwaWhy(X, null, { symbol: 'WEEK', rows: bW.rows }), oWhy = RW.notRwaWhy(X, null, { symbol: 'googlon', rows: bR.rows }), tWhy = RW.notRwaWhy(X, null, { symbol: 'TSLA', rows: bR.rows });
      // review two, 4: WEEK before its code is compared (not confirmed, named only by Robinhood's deviation list) is never said to be on "this site's list" nor Robinhood's
      const bW2 = build({ chain: { tokens: { [WEEK]: reg({ symbol: 'WEEK' }) } }, deviations: { readAt: now - H, data: pd } }), wWhy2 = RW.notRwaWhy(X, null, { symbol: 'WEEK', rows: bW2.rows });
      // review two, 1: a token whose own check found a spoofed slot is told FIRST that it only wears the ticker, then what its check found
      const spoofK = RW.classify(X, { asset: null, registryAt: now - H, chain: reg({ codeMatch: false, codeAt: now - H }) }), sWhy = RW.notRwaWhy(X, spoofK, { symbol: 'TSLA', rows: bR.rows });
      check('RWA review: a lookalike is told where the real one is in that token\'s own terms — "the registry lists" only for a token in Robinhood\'s registry; WEEK (out of it) as Robinhood\'s token running from its registry; a token not confirmed yet is never asserted to be its issuer\'s; and the twin is the registry\'s token, not a chain-only one',
        rowOf(bW, WEEK).confidence === 'confirmed' && wWhy === 'Same ticker as $WEEK, but not issued by Robinhood Assets (Jersey) — Robinhood\'s $WEEK at ' + RW.short(WEEK) + ' runs from its registry (it is not in the registry\'s active list)'
        && /^Same ticker as \$googlon, which this site lists at 0xe10c…46dc among Ondo Global Markets' tokens, not confirmed on the chain yet/.test(oWhy) && !/not issued by/.test(oWhy)
        && rowOf(bW2, WEEK).confidence === 'not-confirmed' && wWhy2 === 'Same ticker as $WEEK at ' + RW.short(WEEK) + ', a token Robinhood\'s own answers name that this site has not confirmed on the chain yet — this token is not that one' && !/this site lists|not issued by/.test(wWhy2)
        && sWhy.startsWith('Same ticker as $TSLA, but not issued by Robinhood Assets (Jersey) — the registry lists $TSLA at ' + RW.short(TSLA) + '. Its beacon slot names Robinhood\'s registry, but its code is not the code')
        && tWhy === 'Same ticker as $TSLA, but not issued by Robinhood Assets (Jersey) — the registry lists $TSLA at ' + RW.short(TSLA) && RW.twinOf(X, 'TSLA', bR.rows).address === TSLA, brief([wWhy, oWhy, tWhy, wWhy2, sWhy]));
      /* review two (2026-10-28) */
      // 2. a TVL figure that may be low, or rests on a kept read, carries its caveat in a few words for the line a card shows in sight
      check('RWA review two: a TVL figure summed while an app could not be read carries its caveat in a few words (caveat: "may be low: Morpho Blue not read"), as does one resting on an app\'s kept deposits ("Morpho Blue as read at …, not read since") — what a card shows beside the figure; a figure from every app read well has none',
        g3.caveat === 'may be low: Morpho Blue not read' && /^Morpho Blue as read at .* UTC, not read since$/.test(n1.caveat) && !('caveat' in rowOf(k4, NVDA).tvl), brief([g3.caveat, n1.caveat]));
      // 5/19. GeckoTerminal's token read failed for a token: said as failed (never "not run yet"); a token with a good entry keeps it, with its own time
      const gtF = (o) => build({ chain: { tokens: { [TSLA]: reg(), [SPYA]: reg() } }, gt: { tokens: Object.assign({ [SPYA]: Object.assign(gtOf(SPYA), { at: now - 3 * H, failAt: now - 30 * 60e3, failWhy: 'rate-limited' }) }, o) } });
      const fT = rowOf(gtF({ [TSLA]: { failAt: now - 30 * 60e3, failWhy: 'rate-limited' } }), TSLA), fS = rowOf(gtF({}), SPYA), fA = rowOf(gtF({ [TSLA]: { absent: true, at: now - 4 * H, failAt: now - 30 * 60e3, failWhy: 'upstream 500' } }), TSLA);
      check('RWA review two: a token whose GeckoTerminal token read failed says so — "its read at <time> failed (rate-limited) — tried again on the next run", never "has not run yet"; one with a last good read keeps its figures, each with that read\'s own time and a label saying it is the last good read',
        /^GeckoTerminal's token read of it at .* UTC failed \(rate-limited\) — tried again on the next run$/.test(fT.liquidity.why) && fT.liquidity.v === null && /failed \(rate-limited\)/.test(fT.volume24h.why) && /failed \(rate-limited\)/.test(fT.mcap.why) && !/has not run yet/.test(fT.liquidity.why)
        && fS.liquidity.v === gtOf(SPYA).reserveUsd && fS.liquidity.at === now - 3 * H && /its last good read; GeckoTerminal could not be read for it at .* \(rate-limited\)/.test(fS.liquidity.label)
        && /failed \(upstream 500\) — tried again on the next run; the read before it \(.* UTC\) had no entry for it/.test(fA.liquidity.why), brief([fT.liquidity, fS.liquidity, fA.liquidity]));
      // 7. a group's market cap is this chain's figures only: TSLA ($4.53M, chain-only) never takes in TSLAon's every-chain $60M, so SPY ranks above it
      const bMc = build({ chain: { tokens: { [TSLA]: reg(), [SPYA]: reg(), [TSLAON]: { beacon: RW.ISSUERS.ondo.beacons[0], beaconAt: now - H, fpAt: now - H } } },
        gt: { tokens: { [TSLA]: Object.assign(gtOf(TSLA), { mcap: 4528746, fdv: 4528746 }), [SPYA]: Object.assign(gtOf(SPYA), { mcap: 20644458, fdv: 20644458 }), [TSLAON]: { symbol: 'TSLAon', priceUsd: 400, mcap: 6e7, fdv: 27324, reserveUsd: 1e5, volume24h: 1e4, at: now - H } } } });
      const gMc = RW.groupRows(bMc.rows, now - H), gTs = gMc.find((g) => g.key === 'TSLA'), byMcG = gMc.slice().sort(RW.nullLast('desc', (g) => (g.mcap.global ? null : g.mcap.v)));
      const onlyOn = RW.groupRows(bMc.rows.filter((r) => r.address === TSLAON), now - H)[0];
      check('RWA review two: Top RWAs by market cap — a group\'s market cap is this chain\'s figures only (TSLA\'s $4.53M), CoinGecko\'s every-chain figure for Ondo\'s TSLAon ($60M) kept apart (mcapGlobal), never added in nor called the whole group\'s; SPY ($20.6M) ranks first; a group whose only cap is every-chain is that figure, flagged global, kept out of the ranking',
        gTs.mcap.v === 4528746 && !gTs.mcap.global && /this chain's — CoinGecko's every-chain figure for its multi-chain issuer's token is kept apart, never added in/.test(gTs.mcap.label) && gTs.mcapGlobal && gTs.mcapGlobal.v === 6e7 && gTs.mcapGlobal.global === true && !gTs.flags.includes('global-mcap')
        && byMcG[0].key === 'SPY' && byMcG[1].key === 'TSLA' && onlyOn.mcap.global === true && onlyOn.mcap.v === 6e7 && onlyOn.flags.includes('global-mcap') && !('mcapGlobal' in onlyOn), brief([gTs.mcap, gTs.mcapGlobal, byMcG.map((g) => g.key)]));
      // 20. the pools the job read itself (rwa_connected) pair two RWAs too: a pool outside the batch (TSLA / SPY) is in both tokens' volume, and is taken off a total once
      const pTS = '0x' + 'f1'.repeat(20), cnR = { reads: { [TSLA]: { ok: true, at: now - H, pools: [{ pool: pTS, base: { address: TSLA }, quote: { address: SPYA }, reserveUsd: 5e4, volume24h: 12345 }] } } };
      const bV = build({ chain: { tokens: { [TSLA]: reg(), [SPYA]: reg() } }, gt: { tokens: { [TSLA]: gtOf(TSLA), [SPYA]: gtOf(SPYA) } }, connected: cnR }), bV0 = build({ chain: { tokens: { [TSLA]: reg(), [SPYA]: reg() } }, gt: { tokens: { [TSLA]: gtOf(TSLA), [SPYA]: gtOf(SPYA) } } });
      const vT = RW.tokSumFig(bV.rows, 'volume', 't'), vT0 = RW.tokSumFig(bV0.rows, 'volume', 't');
      check('RWA review two: a pool pairing two RWAs that only the job\'s own pool read holds (TSLA / SPY, outside the most-traded batch) flags both tokens and is taken off the volume total once; without that read the total is the plain sum and says a pool between two of them may be counted twice',
        rowOf(bV, TSLA).flags.includes('pairs-rwa') && rowOf(bV, SPYA).flags.includes('pairs-rwa') && near(vT.v, vT0.v - 12345) && vT.pairPools === 1 && /less the 24 h volume of the 1 pool pairing two of these tokens/.test(vT.label)
        && !rowOf(bV0, TSLA).flags.includes('pairs-rwa') && /a pool pairing two of these tokens that this site has not read may be in both tokens' figures/.test(vT0.label), brief([vT, vT0]));
    }

    /* ── the job and its answers ── */
    const AMC = '0x05a3d1cd21d0c88145e82600e62e7e496e0f222b', AAPL = '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9';
    gtMultiLeaveOut.add(AMC); gtMultiLeaveOut.add(AAPL);
    const dbR = freshDb('rwa'), rmeter = [], rnode = { batches: [] };
    let rclock = RNOW;
    const rtake = async (key, wait) => { rmeter.push([key, wait, rclock]); };
    const rwaRpc = async (calls) => { rnode.batches.push({ at: rclock, calls }); return calls.map(([m, p]) => { const r = nodeAnswer(m, p); return r.error ? null : r.result; }); };
    const mdR = MD.createMarketData({ db: dbR, now: () => rclock, outboundTake: rtake, rpcBatch: rwaRpc, urls: URLS, bgWaitMs: 1000, askWaitMs: 1000 }); mdR.migrate();
    const runR = async (job, dt = 30 * 60e3) => { rclock += dt; return mdR.runJob(job); };
    /* the review's attack, in the job's world (2026-10-28): a contract named like a Stock Token ("Tesla, Inc. • Robinhood Token", $TSLA)
       that wrote Robinhood's registry address into its own beacon slot and wash-traded a WETH pool into the most-traded batch. All of it
       is the test's own hypothetical (like X above) — its pool, slot, supply and code; the fake node answers those and nothing else */
    const ATT = '0x' + 'de'.repeat(20), ATT_POOL = '0x' + 'ee'.repeat(20);
    const spoofPool = JSON.parse(JSON.stringify(F.gtP1.data.find((d) => /TSLA/.test(d.attributes.name)) || F.gtP1.data[3]));
    spoofPool.id = 'robinhood_' + ATT_POOL; spoofPool.attributes.address = ATT_POOL; spoofPool.attributes.name = 'TSLA / WETH 0.3%';
    spoofPool.relationships.base_token.data.id = 'robinhood_' + ATT; spoofPool.relationships.quote_token.data.id = 'robinhood_' + WETH;
    const spoofInc = { id: 'robinhood_' + ATT, type: 'token', attributes: { address: ATT, name: 'Tesla, Inc. • Robinhood Token', symbol: 'TSLA', decimals: 18, image_url: null, coingecko_coin_id: null } };
    F.gtP1.data.push(spoofPool); (F.gtP1.included = F.gtP1.included || []).push(spoofInc);
    RR.beacons[ATT] = REGISTRY; RR.supplies[ATT] = '1000000'; RR.meta[ATT] = { name: 'Tesla, Inc. • Robinhood Token', symbol: 'TSLA', decimals: 18 };
    RR_EXTRA_CODE[ATT] = '0x6080604052348015600e575f5ffd5b50600436106100365760003560e01c806306fdde031461003b575b5f5ffd5b';   // an ERC-20's opening bytes: not the proxy
    // the batch, DefiLlama's app list, L2BEAT, the pulse (USDG's supply); then the RWA job until the registry's log walk is whole
    await runR('pools', 0); await runR('liquidity', 0); await runR('l2beat', 0); node.head = HEAD; await runR('pulse', 0);
    const r1 = await runR('rwa'), b1 = rnode.batches.filter((b) => b.at === rclock), m1 = rmeter.filter((x) => x[2] === rclock);
    const wk1 = mdR.rwa({ view: 'tokens' }).body.rows.find((r) => r.address === WEEK), tk1 = mdR.rwaToken({ address: TSLA }).body;   // after the first run
    const r2 = await runR('rwa'), r3 = await runR('rwa');
    const st = (n) => (mdR._test.stGet(n) || {}).v;
    check('RWA: the job ran (every part due on its first run): Robinhood\'s registry, quotes, corporate actions and deviations, Chainlink\'s directory, the stablecoins, the DeFi deposits, the chain, GeckoTerminal — and keeps each in mkt_state',
      r1.ok && /^read: registry, quotes, corporate actions, deviations, Chainlink directory, stablecoins; fingerprints \d+\/\d+; code \d+\/\d+; state \d+\/\d+; logs to block \d+ of \d+; GT tokens \d+/.test(r1.note) && /; DeFi \d+\/\d+ apps/.test(r1.note) && r1.note.length <= 290 && ['rhj_assets', 'rhj_prices', 'rhj_actions', 'rhj_deviations', 'chainlink_rh', 'rwa_stables', 'rwa_tvl', 'rwa_chain', 'rhj_roles', 'rwa_gt', 'rwa_connected', 'rwa_protocols'].every((n) => st(n)), r1.note);
    check('  ...and the second run reads only what is due: Robinhood\'s quotes every run, the registry and the rest every 6 h (not again 30 minutes later)', r2.ok && /^read: quotes;/.test(r2.note) && !/registry,|corporate actions|Chainlink directory|stablecoins/.test(r2.note)
      && (hits['rhj-assets'] || 0) === 1 && (hits['rhj-prices'] || 0) === 3 && (hits['chainlink-dir'] || 0) === 1 && (hits['stables-list'] || 0) === 1, brief([r2.note, hits['rhj-assets'], hits['rhj-prices']]));
    check('  ...every Robinhood read took Market Data\'s share of Robinhood\'s meter first, then the host\'s; GeckoTerminal only the collectors\' share (never the one kept for people); the chain only Market Data\'s chain share',
      m1.filter(([k]) => k === 'market:robinhood').length === 4 && m1.findIndex(([k]) => k === 'market:robinhood') < m1.findIndex(([k], i) => i > 0 && k === '127.0.0.1:' + vendor.address().port && m1[i - 1][0] === 'market:robinhood')
      && rmeter.some(([k]) => k === 'market:geckoterminal') && !rmeter.some(([k]) => k === 'market:geckoterminal-asked') && m1.filter(([k]) => k === 'market:rpc').length === b1.length, brief(m1.map(([k]) => k)));
    const rwaBatches = rnode.batches.filter((b) => b.at > RNOW);   // the RWA runs' (the pulse read the chain first, at RNOW)
    const perRun = [...new Set(rwaBatches.map((b) => b.at))].map((t) => rwaBatches.filter((b) => b.at === t).length);
    const mcMax = Math.max(...node.mc.map((x) => x.n)), ethCallsPer = rwaBatches.map((b) => b.calls.filter(([m]) => m === 'eth_call').length);
    check('RWA: the chain is read in at most 6 batches a run, each Multicall3 aggregate3 call at most 150 subcalls (and at most 5 of them in a batch); the fingerprints in one batch with the head block',
      perRun.length === 3 && perRun.every((n) => n <= 6) && mcMax <= 150 && ethCallsPer.every((n) => n <= 5) && rwaBatches.every((b) => b.calls.every(([m, p]) => m !== 'eth_call' || String(p[0].to).toLowerCase() === MC3)) && node.mc.every((x) => x.sel === RW.SELECTORS.aggregate3) && b1[0].calls[0][0] === 'eth_blockNumber' && b1[0].calls.slice(1).every(([m, p]) => m === 'eth_getStorageAt' && [RW.SLOT.beacon, RW.SLOT.impl].includes(p[1])),
      brief({ perRun, mcMax, ethCallsPer }));
    const roles = st('rhj_roles');
    check('  ...the registry\'s logs are walked forward in 10M-block windows, four a run, until the walk is whole (three runs here), and the holders\' kind read once',
      roles.complete === true && roles.cursor === HEAD && roles.logs === FR.logs.length && /logs to block 39999999 of/.test(r1.note) && /logs to block 79999999 of/.test(r2.note) && /\(whole\)/.test(r3.note)
      && rnode.batches.filter((b) => b.calls.some(([m]) => m === 'eth_getLogs')).every((b) => b.calls.every(([m, p]) => m === 'eth_getLogs' && p[0].address === REGISTRY && !p[0].topics && parseInt(p[0].toBlock, 16) - parseInt(p[0].fromBlock, 16) < 10000000))
      && roles.kinds['0xcd8c6182e7c6ca3b5156d6a90a67719d7e2be094'].kind === 'wallet' && !roles.kinds['0x13643b89b19245201b29d556edde5cf18f749c08'], brief({ c: roles.cursor, n: roles.logs, k: Object.keys(roles.kinds).length }));
    // the answers
    const A = mdR.rwa({}).body, T = mdR.rwa({ view: 'tokens', limit: 300 }).body;
    const tRow = T.rows.find((r) => r.address === TSLA), tGroup = A.rows.find((r) => r.key === 'TSLA');
    const tslaTop = groupBy.get(TSLA).slice().sort((a, b) => Number(b.attributes.reserve_in_usd) - Number(a.attributes.reserve_in_usd))[0];
    const supT = Number(BigInt(RR.tsla.totalSupply)) / 1e18, feedT = Number(RR.feeds['0x4a1166a659a55625345e9515b32adecea5547c38'].answer) / 1e8;
    check('RWA: /api/market/rwa answers its contract: { at, chain, view, sort, dir, kind, issuer, total, rows, totals, reads, definitions, notes, sources } — Top RWAs by value on chain by default, every issuer present named',
      ['at', 'chain', 'view', 'sort', 'dir', 'kind', 'issuer', 'total', 'rows', 'totals', 'reads', 'definitions', 'notes', 'sources', 'issuers'].every((k) => k in A) && A.view === 'assets' && A.sort === 'value' && A.dir === 'desc' && A.chain === 'robinhood'
      && ['rwa', 'value', 'tvl', 'liquidity', 'mcap', 'premium', 'connected', 'stables'].every((k) => typeof A.definitions[k] === 'string' && A.definitions[k].length > 30) && ['registry', 'prices', 'chain', 'tvl', 'stables', 'chainlink', 'roles'].every((k) => A.reads[k] && 'ok' in A.reads[k] && 'at' in A.reads[k])
      && A.notes.some((n) => /Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\./.test(n)) && A.notes.some((n) => /Not advice, never a tip to buy\. Do your own research\./.test(n)) && A.issuers.some((x) => x.key === 'rhj') && A.issuers.some((x) => x.key === 'ondo'), brief(Object.keys(A)));
    check('  ...TSLA\'s group holds Robinhood\'s TSLA and Ondo\'s TSLAon (both confirmed: its beacon read on the chain), the underlying "Tesla", a stock',
      tGroup && tGroup.tokens.map((t) => t.symbol + ':' + t.confidence).join() === 'TSLA:confirmed,TSLAon:confirmed' && tGroup.underlying.name === 'Tesla' && tGroup.underlying.kind === 'stock' && tGroup.main === TSLA, brief(tGroup && tGroup.tokens));
    check('  ...TSLA\'s figures, each with its source: the price of its deepest pool (GeckoTerminal), the supply read on the chain, value = supply × price, its multiplier (Robinhood\'s), Chainlink\'s RHTSLA / USD read on the chain and Robinhood\'s quote, the premium against Chainlink, not halted, not paused',
      tRow && tRow.priceUsd.v === Number(tslaTop.attributes.base_token_price_usd) && tRow.priceUsd.src === 'geckoterminal' && near(tRow.supply.v, supT) && tRow.supply.src === 'rpc' && near(tRow.value.v, supT * tRow.priceUsd.v) && tRow.value.label === 'on-chain supply × the DEX price'
      && tRow.multiplier.v === 1 && tRow.multiplier.src === 'robinhood' && near(tRow.reference.chainlink.v, feedT) && tRow.reference.chainlink.label === 'Chainlink RHTSLA / USD' && tRow.reference.chainlink.src === 'chainlink' && tRow.reference.chainlink.stale === false
      && near(tRow.reference.robinhood.v, (399.31 + 399.4) / 2) && /undocumented field/.test(tRow.reference.robinhood.label) && near(tRow.premium.v, (tRow.priceUsd.v / feedT - 1) * 100) && tRow.premium.ref === 'chainlink'
      && tRow.halted.v === false && tRow.paused.token.v === false && tRow.paused.oracle.v === false && tRow.confidence === 'confirmed', brief(tRow));
    const tvlT = FR.proto['morpho-blue'].chainTvls['Robinhood Chain'].tokensInUsd[0].tokens.TSLA + FR.proto['catch-exchange'].chainTvls['Robinhood Chain'].tokensInUsd.slice(-1)[0].tokens.TSLA;
    check('  ...its TVL in DeFi is what DefiLlama lists it deposited on the chain, matched by symbol, with the apps holding it (Morpho Blue, Catch Exchange); a subcall that reverted (the fake reverts the registry\'s paused(), which the research did not read) is "no such function" — never "not paused"',
      near(tRow.tvl.v, tvlT) && tRow.tvl.protocols.map((p) => p.slug).sort().join() === 'catch-exchange,morpho-blue' && /matched by symbol/.test(tRow.tvl.label) && tRow.paused.global.v === null && /no such function/.test(tRow.paused.global.why) && tRow.paused.global.absent === true, brief({ tvl: tRow.tvl, g: tRow.paused.global }));
    const gld = T.rows.find((r) => r.symbol === 'GLD'), gldM = Object.values(pg.tokens).find((t) => t.geckoId === 'spdr-gold-shares-robinhood-token');
    check('RWA: a token outside the most-traded pools (GLD) is priced from GeckoTerminal\'s multi read, its liquidity GeckoTerminal\'s own total — each label says so; its kind a commodity',
      gld && gld.priceUsd.v === gldM.priceUsd && /not among the most-traded pools/.test(gld.priceUsd.label) && gld.liquidity.v === gldM.reserveUsd && /GeckoTerminal's total/.test(gld.liquidity.label) && gld.underlying.kind === 'commodity', brief(gld && [gld.priceUsd, gld.liquidity]));
    const wkR = T.rows.find((r) => r.address === WEEK);
    check('RWA: WEEK — gone from Robinhood\'s registry, found by its fingerprint (and Robinhood\'s deviation list): confirmed, its status "on the chain, not in the registry\'s active list", a bond, Robinhood\'s −50% deviation on it; its decimals not read, so no supply — said, never 0',
      wkR && wkR.confidence === 'confirmed' && wkR.status.text === 'On the chain, not in the registry\'s active list' && wkR.underlying.kind === 'bond' && wkR.deviation && wkR.deviation.direction === 'discount' && wkR.deviation.days === 32 && wkR.flags.includes('deviation')
      && wkR.supply.v === null && /decimals/.test(wkR.supply.why), brief(wkR && [wkR.status, wkR.deviation, wkR.supply]));
    const nc = T.rows.filter((r) => r.confidence === 'not-confirmed');
    check('RWA: a listed token whose fingerprint the node has not given yet is shown "not-confirmed" (why: fingerprint not read yet), flagged, and left out of the totals',
      nc.length > 0 && nc.every((r) => r.why === 'fingerprint not read yet' && r.flags.includes('not-confirmed')) && A.totals.notConfirmed === nc.length && A.totals.count === T.rows.length - nc.length, brief({ nc: nc.length, totals: A.totals.count }));
    /* liquidity and volume: ONE basis for every token (review, 2026-10-28) — GeckoTerminal's own per-token figure from its token read,
       whether or not the token has a pool among the most-traded we keep; the totals add those figures up, a pool pairing two RWAs flagged
       and its 24 h volume (in both tokens' figures) taken off once */
    const spyR = T.rows.find((r) => r.symbol === 'SPY'), qqqR = T.rows.find((r) => r.symbol === 'QQQ'), nvR = T.rows.find((r) => r.symbol === 'NVDA');
    const qqqSpy = allPools.find((p) => p.attributes.name === 'QQQ / SPY 0.02%');
    const counted = new Set(T.rows.filter((r) => r.confidence !== 'not-confirmed').map((r) => r.address));
    const gtOf = (a) => FR.multi.data.find((d) => d.attributes.address === a).attributes;
    const liqSum = T.rows.filter((r) => counted.has(r.address) && r.liquidity.v != null).reduce((a, r) => a + r.liquidity.v, 0), volSum = T.rows.filter((r) => counted.has(r.address) && r.volume24h.v != null).reduce((a, r) => a + r.volume24h.v, 0);
    check('RWA: liquidity and volume are one measure for every token — GeckoTerminal\'s own per-token figures (SPY $9.84M and NVDA $14.28M of volume, not the reserves of the two pools of theirs in the batch), each label saying so; a token GeckoTerminal\'s read has no entry for says that, never "not run yet"',
      near(spyR.liquidity.v, RW.num(gtOf(spyR.address).total_reserve_in_usd)) && near(nvR.volume24h.v, Number(gtOf(nvR.address).volume_usd.h24)) && T.rows.every((r) => r.liquidity.src === 'geckoterminal' && (r.liquidity.v == null || /GeckoTerminal's total for it across its pools/.test(r.liquidity.label)))
      && /has no entry for it/.test(T.rows.find((r) => r.address === AMC).liquidity.why) && /has no entry for it/.test(T.rows.find((r) => r.address === TSLAON).priceUsd.why) && !T.rows.some((r) => /has not run yet/.test(r.liquidity.why || '')), brief([spyR.liquidity, nvR.volume24h]));
    /* the pools pairing two counted RWAs, each once: the batch's (QQQ / SPY), then the ones the job read itself among TSLA's own pools
       (review two, 20: a pool between two RWAs outside the batch — TSLA / SPY, TSLA / MSTR — is in both tokens' figures too) */
    const volSet = new Set(T.rows.filter((r) => counted.has(r.address) && r.volume24h.v != null).map((r) => r.address)), sidesOf = (d) => [d.relationships.base_token.data.id.slice(10), d.relationships.quote_token.data.id.slice(10)];
    const batchIds = new Set(mdR._test.latestBatch('robinhood').rows.map((r) => r.pool)), sharedV = new Map();
    for (const d of allPools) { const [b0, q0] = sidesOf(d); if (b0 !== q0 && volSet.has(b0) && volSet.has(q0)) sharedV.set(String(d.attributes.address).toLowerCase(), RW.num(d.attributes.volume_usd.h24)); }
    const ownShared = RW.parseGtTokenPools(FR.tslaPools).pools.slice(0, 30).filter((pp) => !batchIds.has(pp.pool) && pp.base.address !== pp.quote.address && volSet.has(pp.base.address) && volSet.has(pp.quote.address));
    for (const pp of ownShared) if (!sharedV.has(pp.pool)) sharedV.set(pp.pool, pp.volume24h);
    const offV = [...sharedV.values()].filter((x) => x != null && x >= 0), offSum = offV.reduce((a, x) => a + x, 0);
    check('RWA: the QQQ / SPY pool holds two RWAs: each token is flagged pairs-rwa; the totals add GeckoTerminal\'s per-token figures up — liquidity as they are (the label names the shared pools), volume less each shared pool\'s 24 h volume once, since it is in both — and (review two) the pools between two RWAs that the job read itself among TSLA\'s own pools, outside the batch, are taken off too; the label says a pool not read may still be counted twice',
      spyR.flags.includes('pairs-rwa') && qqqR.flags.includes('pairs-rwa') && spyR.liquidity.pairsRwa === true && qqqSpy && sharedV.has(String(qqqSpy.attributes.address).toLowerCase()) && near(A.totals.liquidity.v, liqSum) && /pools? pairs? two of these tokens/.test(A.totals.liquidity.label)
      && ownShared.length > 0 && A.totals.volume24h.pairPools === sharedV.size && near(A.totals.volume24h.v, volSum - offSum) && new RegExp('less the 24 h volume of the ' + offV.length + ' pools pairing two of these tokens').test(A.totals.volume24h.label)
      && /a pool pairing two of these tokens that this site has not read may be in both tokens' figures/.test(A.totals.volume24h.label)
      && near(A.rows.find((g) => g.key === 'SPY').liquidity.v, spyR.liquidity.v), brief({ tot: [A.totals.liquidity, A.totals.volume24h], want: [liqSum, volSum, offSum], own: ownShared.map((pp) => pp.name) }));
    check('RWA: the stablecoins total stands apart, and L2BEAT\'s own count of real-world assets on the chain is served as L2BEAT\'s, never mixed into the sums',
      A.totals.stables.v === usdgS.circulating && A.totals.stables.src === 'defillama' && A.totals.l2beat.rwaPublic.v === F.l2beat.projects.robinhood.tvs.breakdown.rwaPublic && A.totals.l2beat.rwaPublic.src === 'l2beat' && /L2BEAT's count of real-world assets on Robinhood Chain/.test(A.totals.l2beat.rwaPublic.label)
      && A.totals.l2beat.rwaRestricted.v === F.l2beat.projects.robinhood.tvs.breakdown.rwaRestricted && A.totals.value.src === 'site', brief(A.totals.l2beat));
    // sorting, filters, views
    const byTvl = mdR.rwa({ view: 'tokens', sort: 'tvl' }).body.rows, byTvlA = mdR.rwa({ view: 'tokens', sort: 'tvl', dir: 'asc' }).body.rows;
    const ord = (rows, get, dir) => { const v = rows.map(get), k = v.findIndex((x) => x == null); return (k < 0 || v.slice(k).every((x) => x == null)) && v.filter((x) => x != null).every((x, i, a) => i === 0 || (dir === 'asc' ? a[i - 1] <= x : a[i - 1] >= x)); };
    check('RWA: ranked by TVL, liquidity, market cap, volume, value or premium, both ways — a token with no figure last in both; the market-cap ranking keeps an every-chain figure out',
      ord(byTvl, (r) => r.tvl.v, 'desc') && ord(byTvlA, (r) => r.tvl.v, 'asc') && byTvl[0].symbol === 'mGLO' && ['liquidity', 'mcap', 'volume', 'value', 'premium'].every((s) => ['desc', 'asc'].every((d) => ord(mdR.rwa({ view: 'tokens', sort: s, dir: d }).body.rows, (r) => (s === 'mcap' && r.mcap.global ? null : (s === 'volume' ? r.volume24h : r[s]).v), d)))
      && ['liquidity', 'tvl', 'mcap'].every((s) => ord(mdR.rwa({ sort: s }).body.rows, (r) => r[s].v, 'desc')), brief(byTvl.slice(0, 3).map((r) => [r.symbol, r.tvl.v])));
    const etf = mdR.rwa({ view: 'tokens', kind: 'etf' }).body.rows, ondoOnly = mdR.rwa({ issuer: 'ondo' }).body.rows, bonds = mdR.rwa({ view: 'tokens', kind: 'bond' }).body.rows;
    check('  ...filtered by kind and by issuer (the groups holding a token of that issuer), the answer naming every issuer present', etf.length > 0 && etf.every((r) => r.underlying.kind === 'etf') && etf.some((r) => r.symbol === 'SPY') && bonds.some((r) => r.address === WEEK) && bonds.every((r) => r.underlying.kind === 'bond')
      && ondoOnly.length > 0 && ondoOnly.every((g) => g.issuers.some((x) => x.key === 'ondo')) && mdR.rwa({ issuer: 'nope', kind: 'nope', view: 'nope', sort: 'nope' }).body.view === 'assets', brief({ etf: etf.map((r) => r.symbol) }));
    const CN = mdR.rwa({ view: 'connected' }).body, SV = mdR.rwa({ view: 'stables' }).body;
    check('RWA: Connected tokens — TSLA\'s pools read from GeckoTerminal (OPTIMUS, DOGGIE, TSLR…), every row "Not an RWA", the floor and what fell below it said', CN.view === 'connected' && CN.rows.length === wantC.length && CN.rows.every((r) => /^Not an RWA — paired with \$/.test(r.label) && r.reserveUsd.v >= 1000)
      && CN.belowFloor === 0 && CN.floor === 1000 && CN.notes.some((n) => /Every row here is NOT an RWA/.test(n) && /below that/.test(n)) && (hits['gt-token-pools'] || 0) >= 1, brief({ n: CN.rows.length, notes: CN.notes.slice(-2) }));
    const usdgRow = SV.rows.find((r) => r.symbol === 'USDG');
    check('RWA: Stablecoins — USDG, fiat-backed, Paxos, its circulation (DefiLlama) and supply read on the chain (the pulse), "Not counted as an RWA here"; USDe, U and Multipli\'s dollars left out as crypto-backed, and the notes say so',
      SV.rows.length === 1 && usdgRow.address === USDG && usdgRow.issuer === 'Paxos' && usdgRow.circulating.v === usdgS.circulating && usdgRow.supply.src === 'rpc' && near(usdgRow.supply.v, Number(BigInt(F.state['16'])) / 1e6) && /Not counted as an RWA here/.test(usdgRow.label)
      && SV.notes.some((n) => /USDe \(crypto-backed\)/.test(n) && /U \(crypto-backed\)/.test(n)), brief(usdgRow));
    // one token's facts
    const TK = mdR.rwaToken({ address: TSLA });
    const tb = TK.body;
    // the other card fixtures, read at the same moment as TSLA's (dumped below)
    const cardsNow = [['spy', T.rows.find((r) => r.symbol === 'SPY').address], ['week', WEEK], ['tslaon', TSLAON], ['googlon', '0xe10cc5f0cd0c90322ebeb33e7757b2c9090146dc']].map(([k, a]) => [k, mdR.rwaToken({ address: a }).body]);
    check('RWA: /api/market/rwa/token — TSLA\'s row plus what the card shows: what you hold (every sentence with its Robinhood page; terms() read on the chain), the issuer\'s controls (registry, beacon, Stock.sol read on the chain, its Sourcify link), the roles with each holder\'s kind, 175 blocked, the Chainlink feed, the lookalikes and the connected tokens',
      TK.status === 200 && tb.confidence === 'confirmed' && tb.issuerProfile.sentences.length >= 6 && tb.issuerProfile.sentences.every((x) => /^https:\/\/docs\.robinhood\.com\//.test(x.href)) && tb.issuerProfile.terms.v === 'https://robinhood.com/stocktoken/rhj' && tb.issuerProfile.terms.src === 'rpc'
      && tb.controls.registry === REGISTRY && tb.controls.beacon === REGISTRY && tb.controls.implementation.address === '0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2' && tb.controls.verifiedSource === 'https://sourcify.dev/server/v2/contract/4663/0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2'
      && tb.controls.powers.find((p) => p.role === 'BEACON_UPGRADER_ROLE').holders[0].kind === 'wallet' && /expected — they are still powers over your tokens/.test(tb.controls.note)
      && tb.roles.length >= 13 && tb.blocked.count === 175 && tb.chainlink.description === 'RHTSLA / USD' && tb.chainlink.heartbeat === 86400 && tb.chainlink.stale === false && tb.connected.length === wantC.length && Array.isArray(tb.lookalikes)
      && tb.deployer && tb.deployer.holders[0].address === '0x5516b3451d4d6c9f63353fe7bc9537477ecce000', brief(Object.keys(tb)));
    // the lookalike trap through the job: someone scanned the "GameStop" memecoin (its CoinGecko name and symbol)
    dbR.prepare("INSERT INTO mkt_scan (chain, address, at, read_at, src, symbol, name) VALUES ('robinhood', ?, ?, ?, 'scan', ?, ?)").run(GME_MEME, rclock, rclock, cgRow('gamestop-3').symbol, cgRow('gamestop-3').name);
    await runR('rwa');
    const gme = mdR.rwaToken({ address: GME_RHJ }).body, meme = mdR.rwaToken({ address: GME_MEME });
    check('RWA: the "GameStop" memecoin (GME 0x7e86…, a ticker of one): on Robinhood\'s GME it is a lookalike ("same ticker, not issued by…"); asked about itself it is a 404 that says so — "Same ticker as $GME, but not issued by Robinhood Assets (Jersey) — the registry lists $GME at 0x1b0e…153e", with the real one in full beside it',
      gme.lookalikes.some((x) => x.address === GME_MEME && x.src === 'scan') && meme.status === 404 && meme.body.notRwa === true && meme.body.why === 'Same ticker as $GME, but not issued by Robinhood Assets (Jersey) — the registry lists $GME at ' + RW.short(GME_RHJ) && RW.short(GME_RHJ) === '0x1b0e…153e'
      && meme.body.twin && meme.body.twin.address === GME_RHJ && meme.body.twin.registry === true && meme.body.twin.issuer.key === 'rhj' && meme.body.twin.confidence === 'confirmed', brief(meme.body));
    const nms = mdR.rwaToken({ address: '0x4a0ade17fa7602bdfc7d2a9c85f404328687c92d' }), blk = mdR.rwaToken({ address: cgRow('blackrock').platforms.robinhood }), usdb = mdR.rwaToken({ address: cgRow('blockchain-usd').platforms.robinhood }), usdgT = mdR.rwaToken({ address: USDG });
    check('  ..."Not My Stock", BLACKROCK and Blockchain USD (USDB) are 404s that say which evidence is missing (not in the registry, not on the list — a name is never enough); USDG is a fiat-backed stablecoin, listed apart; a bad address is a 400',
      [nms, blk, usdb].every((r) => r.status === 404 && r.body.notRwa && /not in Robinhood's Stock Token registry/.test(r.body.why) && /A name or a symbol is never enough/.test(r.body.why)) && usdgT.status === 404 && usdgT.body.stablecoin === true && /fiat-backed stablecoin — listed apart/.test(usdgT.body.why)
      && mdR.rwaToken({ address: 'nope' }).status === 400, brief([nms.body, usdgT.body]));
    // the token view's rwa key, the Scanner's lookups
    check('RWA: the token view (/api/market/token) carries the RWA row for a Robinhood Chain RWA, null for anything else (USDG)', (await mdR.token({ chain: 'robinhood', address: TSLA })).body.rwa.address === TSLA && (await mdR.token({ chain: 'robinhood', address: USDG })).body.rwa === null
      && 'rwa' in (await mdR.token({ chain: 'robinhood', address: USDG })).body);
    check('RWA: the Scanner\'s serial-deployer flag is waived only on a confirmed Stock Token deployed by the registry\'s token-deployer role holder — another deployer, an issuer-listed token or a token that is not an RWA keeps it; the server applies it in applyRisk and attaches p.rwa from these stored facts (no read on the scan path)',
      /token-deployer role/.test(mdR.rwaIssuerDeployer(TSLA, '0x5516b3451d4d6c9f63353fe7bc9537477ecce000') || '') && mdR.rwaIssuerDeployer(TSLA, '0x' + '12'.repeat(20)) === null && mdR.rwaIssuerDeployer(GME_MEME, '0x5516b3451d4d6c9f63353fe7bc9537477ecce000') === null
      && /waived = MKT\.rwaIssuerDeployer\(e\.token\.address, dep\)/.test(SRC) && /if \(waived\) \{ r\.serialDeployer = false; r\.serialDeployerWaived = waived; \}/.test(SRC) && /rwa = MKT\.rwaFacts\(p\.token\.address\)/.test(SRC) && /pair: withRwa\(r\.pair\)/.test(SRC) && mdR.rwaFacts(TSLA).address === TSLA && mdR.rwaFacts(USDG) === null);
    /* a token this site has never seen, scanned under an RWA's ticker: its own profile names the symbol, and p.rwa is the lookalike 404
       that says so; a ticker of its own, a stablecoin, an RWA itself or no symbol at all gets nothing (the symbol is the server's, never a query) */
    const neverSeen = '0x' + 'ab'.repeat(20), lkT1 = mdR.rwaLookalike(neverSeen, 'TSLA'), lkM = mdR.rwaLookalike(GME_MEME, 'GME');
    check('RWA: the Scanner\'s lookalike answer — a token sharing an RWA\'s ticker gets the 404 that names the real one ("Same ticker as $TSLA, but not issued by Robinhood Assets (Jersey) — the registry lists $TSLA at 0x322f…3b2d"); its own ticker, USDG, TSLA itself, "Not My Stock" or no symbol get null; withRwa falls back to it',
      lkT1 && lkT1.notRwa === true && lkT1.why === 'Same ticker as $TSLA, but not issued by Robinhood Assets (Jersey) — the registry lists $TSLA at ' + RW.short(TSLA) && lkM && /^Same ticker as \$GME, but not issued by Robinhood Assets \(Jersey\)/.test(lkM.why)
      && mdR.rwaLookalike(neverSeen, 'ZZQX') === null && mdR.rwaLookalike(neverSeen, null) === null && mdR.rwaLookalike(USDG, 'USDG') === null && mdR.rwaLookalike(TSLA, 'TSLA') === null && mdR.rwaLookalike('0x4a0ade17fa7602bdfc7d2a9c85f404328687c92d', 'NMS') === null
      && mdR.rwaToken({ address: neverSeen, symbol: 'TSLA' }).body.why !== lkT1.why && /rwa = MKT\.rwaFacts\(p\.token\.address\) \|\| MKT\.rwaLookalike\(p\.token\.address, p\.token\.symbol\)/.test(SRC), brief([lkT1, lkM]));
    // a failed read keeps the last good one, with its age and the reason
    vendorFail.rhj = true; const rf = await runR('rwa', 6 * 3600e3 + 60e3); vendorFail.rhj = false;
    const tbDown = mdR.rwaToken({ address: TSLA }).body;
    const AF = mdR.rwa({ view: 'tokens' }).body, tF = AF.rows.find((r) => r.address === TSLA);
    check('RWA: Robinhood\'s API down — the run says so, the last good registry stays (TSLA still confirmed, its multiplier still Robinhood\'s), and the answer says the read failed, when, why, and that the last good one is shown',
      /not read: registry \(upstream 503\)/.test(rf.note) && tF && tF.confidence === 'confirmed' && tF.multiplier.v === 1 && AF.reads.registry.ok === false && /could not be read at .* \(upstream 503\) — the last good read, from .*, is shown/.test(AF.reads.registry.why) && st('rhj_assets').data.assets.length === FR.assets.assets.length, brief([rf.note, AF.reads.registry]));
    // the site's own chain reads waiting: the chain part stands aside (asks the node nothing, keeps what it read), the rest still reads
    const chainBefore = JSON.stringify(st('rwa_chain')), batchesBefore = rnode.batches.length;
    const ySleeps = [];
    const mdY = MD.createMarketData({ db: dbR, now: () => rclock, outboundTake: rtake, rpcBatch: rwaRpc, rpcBusy: () => 'the site\'s own chain reads are queued', urls: URLS, bgWaitMs: 1000, askWaitMs: 1000, sleep: async (ms) => { ySleeps.push(ms); } });
    rclock += 30 * 60e3; const ry = await mdY.runJob('rwa');
    check('RWA: a chain batch that yields waits for the site\'s own reads and asks again — 20 s at a time, at most 3 minutes a run — before the part stands aside',
      ySleeps.length === 9 && ySleeps.every((ms) => ms === 20000), JSON.stringify(ySleeps));
    check('RWA: while the site\'s own chain reads wait, the job\'s chain part stands aside — no node read, the chain state it holds kept as it was (its record says why, and the answers\' reads.chain too) — and the run still reads Robinhood\'s quotes, and says why',
      ry.ok && /chain stood aside: yielded: the site's own chain reads are queued/.test(ry.note) && /^read: [^;]*quotes/.test(ry.note) && rnode.batches.length === batchesBefore && JSON.stringify(Object.assign({}, st('rwa_chain'), { failAt: undefined, failWhy: undefined })) === JSON.stringify(Object.assign(JSON.parse(chainBefore), { failAt: undefined, failWhy: undefined }))
      && /^stood aside: yielded/.test(st('rwa_chain').failWhy) && mdR.rwa({}).body.reads.chain.ok === false && /could not be read at .* \(stood aside: yielded/.test(mdR.rwa({}).body.reads.chain.why), ry.note);
    // …and when the site's own reads clear while it waits, the chain part reads after all
    let zChecks = 0; const zSleeps = [], zBefore = rnode.batches.length;
    const mdZ = MD.createMarketData({ db: dbR, now: () => rclock, outboundTake: rtake, rpcBatch: rwaRpc, rpcBusy: () => (++zChecks <= 2 ? 'the site\'s own chain reads are queued' : false), urls: URLS, bgWaitMs: 1000, askWaitMs: 1000, sleep: async (ms) => { zSleeps.push(ms); } });
    rclock += 30 * 60e3; const rz = await mdZ.runJob('rwa');
    check('  ...and once the site\'s own reads clear, the waiting batch reads: the chain part does not stand aside, and the node is asked',
      zSleeps.length === 2 && rnode.batches.length > zBefore && !/chain stood aside/.test(rz.note), rz.note + ' ' + JSON.stringify(zSleeps));
    const memoN = () => [...mdR._test.memo.keys()].filter((k) => k.startsWith('rwa|base')).length;
    mdR._test.memo.clear(); mdR.rwa({}); mdR.rwa({ view: 'tokens', sort: 'tvl' }); mdR.rwaToken({ address: TSLA }); mdR.rwaRowFor(TSLA);
    check('RWA: the rows are built once per change of the data (memoised, at most 15 s) — the views, one token\'s facts and the token view\'s key all read the same build', memoN() === 1);
    // the Send API's resources
    const ar = await mdR.apiResource('rwa', { view: 'tokens' }, { limit: 100 }), at2 = await mdR.apiResource('rwa-token', { address: TSLA }, {}), at3 = await mdR.apiResource('rwa-token', { address: GME_MEME }, {});
    check('RWA: the Send API\'s rwa (the list, data = its rows, raw logo URLs) and rwa-token (data = one token\'s facts; 404 for a non-RWA) resources', md.RESOURCES.includes('rwa') && md.RESOURCES.includes('rwa-token') && ar.status === 200 && Array.isArray(ar.body.data) && ar.body.data.length > 0 && ar.body.rows === undefined && ar.body.view === 'tokens'
      && ar.body.data.every((r) => r.logo == null || /^https:\/\//.test(r.logo)) && at2.status === 200 && at2.body.data.address === TSLA && at3.status === 404 && at3.body.notRwa === true);
    // the new sources are named
    check('RWA: the answers name every source (Robinhood\'s API, the chain, Chainlink, DefiLlama, GeckoTerminal, L2BEAT) and never a Robinhood logo URL', ['robinhood', 'rpc', 'chainlink', 'defillama', 'geckoterminal', 'l2beat'].every((k) => A.sources.some((x) => x.id === k && /^https:\/\//.test(x.href)))
      && !JSON.stringify([A, T, tb]).includes('cdn.robinhood.com') && !/logoUrl/.test(JSON.stringify(st('rhj_assets'))));
    /* the docs' rwa and rwa-token resources name every key they return (public/data.html is the docs' part of this build: until it
       documents the rwa resource this says PENDING, with the keys — never a pass on docs that are not there) */
    const docKeys = [...new Set([...Object.keys(ar.body), ...Object.keys(ar.body.data[0] || {}), ...Object.keys(A.rows[0] || {}), ...Object.keys(A.totals), ...Object.keys(A.reads), ...Object.keys(A.definitions),
      ...Object.keys(CN.rows[0] || {}), ...Object.keys(SV.rows[0] || {}), ...Object.keys(tb)])].filter((k) => ar.body[k] !== undefined || k !== 'rows');
    const rwaDoc = DOCS.includes('/api/data/v1/rwa') ? DOCS.slice(DOCS.indexOf('/api/data/v1/rwa')) : '';
    if (!rwaDoc) console.log('PENDING the docs\' rwa and rwa-token resources: public/data.html does not document /api/data/v1/rwa yet (the docs agent\'s part). Keys to name: ' + docKeys.join(', '));
    else check('RWA: the docs\' rwa and rwa-token resources name every key they return', docKeys.every((k) => new RegExp('\\b' + k + '\\b').test(rwaDoc)) && /<code>rwa-token<\/code>/.test(DOCS), docKeys.filter((k) => !new RegExp('\\b' + k + '\\b').test(rwaDoc)).join(','));
    /* ── the review's cases through the job (2026-10-28) ── */
    // 10. the spoofed $TSLA: its slot names the registry, its code is not the Stock Token proxy — not an RWA, counted nowhere
    const chT = st('rwa_chain').tokens, attT = mdR.rwaToken({ address: ATT });
    check('RWA review: a contract that wrote the registry into its own beacon slot (the spoofed "Tesla, Inc. • Robinhood Token", $TSLA, in the most-traded pools) is NOT an RWA — its code was read on the chain and is not the registry tokens\' own — so it is in no list, no total, not TSLA\'s group nor the Scanner\'s "confirmed"; it is a lookalike of TSLA, and TSLA keeps its DeFi deposits',
      chT[ATT] && chT[ATT].beacon === REGISTRY && chT[ATT].codeMatch === false && !T.rows.some((r) => r.address === ATT) && attT.status === 404 && /its code is not the code Robinhood's Stock Tokens run/.test(attT.body.why)
      && tGroup.tokens.every((t) => t.address !== ATT) && tGroup.main === TSLA && mdR.rwaFacts(ATT) === null && (tb.lookalikes || []).some((x) => x.address === ATT) && tRow.tvl.v != null && A.totals.count === T.rows.filter((r) => r.confidence !== 'not-confirmed').length
      && rnode.batches.some((b) => b.calls.some(([m, p]) => m === 'eth_getCode' && String(p[0]).toLowerCase() === ATT)), brief({ att: chT[ATT], why: attT.body.why }));
    // 28. WEEK (only Robinhood's deviation list names it): fingerprinted first, its code compared — confirmed in the first run
    check('RWA review: WEEK, named only by Robinhood\'s deviation list, is the first fingerprint read, and its code (the registry tokens\' own proxy) is compared in the same run — confirmed after one run, never "Not an RWA here" while its checks wait',
      b1[0].calls[1][1][0] === WEEK && wk1 && wk1.confidence === 'confirmed' && chT[WEEK].codeMatch === true && wk1.evidence.some((e) => e.tier === 'A2' && /proxy code the registry's own Stock Tokens run/.test(e.text)), brief(wk1 && wk1.evidence));
    // 27. the roles while the registry's log walk is not whole: the answer says how far it has come
    check('RWA review: while the registry\'s log walk is not whole, rwa/token says how far it has come (rolesRead: block 39,999,999 of the head) — and once it is whole, says that',
      tk1.rolesRead && tk1.rolesRead.complete === false && tk1.rolesRead.cursor === 39999999 && tk1.rolesRead.head === HEAD && tb.rolesRead.complete === true && tb.rolesRead.cursor === HEAD, brief([tk1.rolesRead, tb.rolesRead]));
    // 14. no Robinhood artwork, anywhere an RWA is drawn
    const tView = (await mdR.token({ chain: 'robinhood', address: TSLA })).body;
    check('RWA review: no Robinhood artwork — every Robinhood Stock Token\'s row and group carries no picture, nor does its token view\'s header (CoinGecko\'s picture for them is Robinhood\'s feather); other issuers\' tokens keep theirs',
      T.rows.filter((r) => r.issuer.key === 'rhj').every((r) => r.logo === null) && A.rows.filter((g) => T.rows.some((r) => r.address === g.main && r.issuer.key === 'rhj')).every((g) => g.logo === null) && tView.logo === null && tView.rwa && tView.rwa.issuer.key === 'rhj', brief({ logo: tView.logo }));
    // 2. GLD: its feed is not a reference, and is not read on the chain as one
    const gldR = T.rows.find((r) => r.symbol === 'GLD'), gldProxy = pf.feeds.find((x) => x.ticker === 'GLD').proxy;
    check('RWA review: GLD\'s "GLD / USD" feed is not used as the underlying\'s price (nor read on the chain as one); its premium waits for a quote of the share',
      gldR.reference.chainlink.v === null && gldR.reference.chainlink.notReference === true && !(st('rwa_chain').feeds || {})[gldProxy] && gldR.premium.v === null && gldR.premium.ref == null, brief(gldR.reference.chainlink));
    // 6. a 0.0 volume beside no reserve is not $0
    const satsR = T.rows.find((r) => r.symbol === 'SATS'), bndR = T.rows.find((r) => r.symbol === 'BND');
    check('RWA review: SATS and BND, which GeckoTerminal indexes no pool with a reserve for, show no volume — "not available" with why, never $0 beside "price not available"',
      [satsR, bndR].every((r) => r && r.volume24h.v === null && /indexes no pool/.test(r.volume24h.why) && r.liquidity.v === null && /gave no price/.test(r.priceUsd.why)) && !T.rows.some((r) => r.volume24h.v === 0 && r.liquidity.v == null), brief([satsR && satsR.volume24h, bndR && bndR.volume24h]));
    // 1/24/25. Everpure $P: its market cap above its FDV, ranked with the rest
    const byMc = mdR.rwa({ view: 'tokens', sort: 'mcap' }).body.rows, pAt = byMc.findIndex((r) => r.symbol === 'P'), firstNull = byMc.findIndex((r) => r.mcap.v == null);
    check('RWA review: Everpure $P (Robinhood\'s, on this chain alone) with a market cap above its FDV is not "every chain\'s" — it ranks by its market cap like the rest, and no total or group calls the market caps every chain\'s while none is',
      pAt >= 0 && byMc[pAt].mcap.aboveFdv === true && !byMc[pAt].mcap.global && !byMc[pAt].flags.includes('global-mcap') && (firstNull < 0 || pAt < firstNull) && byMc.slice(pAt + 1).every((r) => r.mcap.global || r.mcap.v == null || r.mcap.v <= byMc[pAt].mcap.v)
      && !A.totals.mcap.global && !/every-chain/.test(A.totals.mcap.label) && !A.rows.some((g) => g.mcap.global), brief({ pAt, firstNull, p: byMc[pAt] && byMc[pAt].mcap }));
    // 13. a choice that is an inherited key is the default, never a 500 or an echo
    const tryQ = (q) => { try { return mdR.rwa(q); } catch (e) { return { threw: String(e && e.message) }; } };
    const proto = ['__proto__', 'valueOf', 'hasOwnProperty', 'constructor', 'toString'], apiProto = await mdR.apiResource('rwa', { sort: '__proto__', issuer: 'constructor' }, {});
    check('RWA review: ?sort= and ?issuer= take only their own choices — __proto__, valueOf, hasOwnProperty, constructor or toString fall back to the default (no throw, so no 500; no echo), in the page\'s answer and the Send API\'s',
      proto.every((k) => { const a = tryQ({ sort: k, view: 'tokens' }), b = tryQ({ issuer: k }); return a.status === 200 && a.body.sort === 'value' && b.status === 200 && b.body.issuer === 'all' && b.body.rows.length === A.rows.length; }) && apiProto.status === 200 && apiProto.body.sort === 'value' && apiProto.body.issuer === 'all',
      brief(proto.map((k) => [tryQ({ sort: k }).threw || tryQ({ sort: k }).body.sort, tryQ({ issuer: k }).threw || tryQ({ issuer: k }).body.issuer])));
    // 18. Top RWAs by an issuer: every row that issuer's own
    const ON = mdR.rwa({ issuer: 'ondo' }).body, onT = ON.rows.find((g) => g.main === TSLAON);
    check('RWA review: Top RWAs filtered by an issuer builds each row from that issuer\'s tokens only — Ondo\'s rows lead with Ondo\'s tokens, with their own figures, premium and how sure the site is (never Robinhood\'s SPY, its $20.6M or its "confirmed")',
      ON.rows.length > 0 && ON.rows.every((g) => g.issuers.length === 1 && g.issuers[0].key === 'ondo' && g.tokens.every((t) => t.issuer.key === 'ondo') && T.rows.find((r) => r.address === g.main).issuer.key === 'ondo')
      && onT && onT.tokens.length === 1 && onT.premium.v === null && (T.rows.find((r) => r.address === TSLAON).value.v == null ? onT.value.v === null : near(onT.value.v, T.rows.find((r) => r.address === TSLAON).value.v)) && ON.notes.some((n) => /built from Ondo Global Markets's tokens only/.test(n)), brief(ON.rows.slice(0, 2)));
    // 12. the RWAs' own pools: a failed read is said, never folded into a finished round or "no pool pairs it"
    const spyT = mdR.rwaToken({ address: T.rows.find((r) => r.symbol === 'SPY').address }).body, rc = mdR.rwa({ view: 'connected' }).body.reads.connected, cnS = st('rwa_connected');
    check('RWA review: when GeckoTerminal could not read an RWA\'s own pools (the fake knows only TSLA\'s: 404 for the rest), reads.connected is not ok and says for how many and why; that token\'s facts say its read failed (connectedWhy); the round tries each again, at most 3 times',
      rc.ok === false && /GeckoTerminal could not be read for \d+ of 12 RWAs' own pools \(upstream 404\)/.test(rc.why) && /could not be read for this token's own pools at .* \(upstream 404\)/.test(spyT.connectedWhy || '') && !tb.connectedWhy
      && Object.values(cnS.reads).every((x) => (x.tries || 0) <= 3) && Object.values(cnS.reads).some((x) => !x.ok && (x.tries || 0) >= 2), brief({ rc, why: spyT.connectedWhy }));
    // 4/11/26. DefiLlama's Morpho Blue read failing in a later round: its deposits kept with their own time, the read said not ok, and tried again next run
    const morphoFix = FR.proto['morpho-blue']; delete FR.proto['morpho-blue'];
    const morphoAt = st('rwa_tvl').reads['morpho-blue'].at, hitsP0 = hits['llama-protocol'] || 0;
    await runR('rwa', 6 * 3600e3 + 60e3);
    const tvA = mdR.rwa({ view: 'tokens' }).body, nvT = tvA.rows.find((r) => r.symbol === 'NVDA').tvl, hitsP1 = hits['llama-protocol'] || 0;
    await runR('rwa'); const hitsP2 = hits['llama-protocol'] || 0;
    FR.proto['morpho-blue'] = morphoFix; await runR('rwa'); const tvB = mdR.rwa({ view: 'tokens' }).body.rows.find((r) => r.symbol === 'NVDA').tvl;
    check('RWA review: an app DefiLlama could not read in a later round keeps its last good deposits WITH ITS OWN TIME (NVDA\'s figure dated by Morpho Blue\'s earlier read, marked kept, and reads.tvl not ok, naming it) — and it is tried again on the next run, not 6 h later; once it answers, the figure is fresh again',
      nvT.v != null && nvT.at === morphoAt && nvT.protocols.some((p) => p.slug === 'morpho-blue' && p.kept === true && /upstream 404/.test(p.keptWhy)) && tvA.reads.tvl.ok === false && /kept from an earlier read: Morpho Blue/.test(tvA.reads.tvl.why)
      && hitsP1 > hitsP0 && hitsP2 - hitsP1 >= 1 && hitsP2 - hitsP1 <= 2 && tvB.at > morphoAt && !tvB.protocols.some((p) => p.kept), brief({ nvT, reads: tvA.reads.tvl, hits: [hitsP0, hitsP1, hitsP2] }));
    // 29. the run's note keeps the chain's and GeckoTerminal's outcomes, and the chain's failure is kept on its record
    check('RWA review: the run\'s note fits in 290 characters with the chain\'s and GeckoTerminal\'s outcomes ahead of the DeFi apps; every run\'s note does', [r1, r2, r3, rf, ry].every((r) => r.note.length <= 290 && (!/DeFi/.test(r.note) || r.note.indexOf('DeFi') > Math.max(r.note.indexOf('GT '), r.note.indexOf('chain '), r.note.indexOf('state '))))
      , brief([r1.note, rf.note]));
    /* ── review two (2026-10-28), in the job's world ── */
    // 1. the spoofed $TSLA (its slot names the registry, its code is not the Stock Tokens'): a lookalike on its own Scanner dashboard, as a memecoin $TSLA is
    const lkA = mdR.rwaLookalike(ATT, 'TSLA'), lkB = mdR.rwaToken({ address: ATT }).body;
    check('RWA review two: the spoofed "Tesla, Inc. • Robinhood Token" ($TSLA) is a lookalike on its own Scanner dashboard — its answer names TSLA as its twin and leads with "Same ticker as $TSLA … the registry lists $TSLA at 0x322f…3b2d", then what its code check found; it is still no RWA',
      lkA && lkA.notRwa === true && lkA.twin && lkA.twin.address === TSLA && lkA.twin.registry === true && /^Same ticker as \$TSLA, but not issued by Robinhood Assets \(Jersey\) — the registry lists \$TSLA at 0x322f…3b2d\. Its beacon slot names Robinhood's registry, but its code is not the code Robinhood's Stock Tokens run/.test(lkA.why)
      && lkB.twin && lkB.twin.address === TSLA && mdR.rwaFacts(ATT) === null && !T.rows.some((r) => r.address === ATT), brief(lkA));
    // 11/13. the token view: what this site keeps about an RWA needs no market read; a token that only wears an RWA's ticker says so
    const batchB = new Set(mdR._test.latestBatch('robinhood').rows.map((r) => r.base_addr)), offB = T.rows.find((r) => !batchB.has(r.address) && r.issuer.key === 'rhj');
    const tvOff = await mdR.token({ chain: 'robinhood', address: offB.address }), tvMeme = await mdR.token({ chain: 'robinhood', address: GME_MEME }), tvAtt = await mdR.token({ chain: 'robinhood', address: ATT }), tvUsdg = await mdR.token({ chain: 'robinhood', address: USDG });
    check('RWA review two: a link to an RWA whose market read fails (GeckoTerminal does not know it) still carries its RWA row (rwa) on the 404; a token that only wears an RWA\'s ticker carries the lookalike answer (rwaLookalike, its twin in full) whether its market read worked (the spoofed $TSLA, in the pools) or not (the "GameStop" memecoin); anything else carries null',
      tvOff.status === 404 && tvOff.body.rwa && tvOff.body.rwa.address === offB.address && tvOff.body.rwaLookalike === null
      && tvMeme.status === 404 && tvMeme.body.rwa === null && tvMeme.body.rwaLookalike && tvMeme.body.rwaLookalike.twin.address === GME_RHJ && /^Same ticker as \$GME/.test(tvMeme.body.rwaLookalike.why)
      && tvAtt.status === 200 && tvAtt.body.rwa === null && tvAtt.body.rwaLookalike && tvAtt.body.rwaLookalike.twin.address === TSLA
      && tvUsdg.status === 200 && tvUsdg.body.rwaLookalike === null && (await mdR.token({ chain: 'robinhood', address: TSLA })).body.rwaLookalike === null, brief([tvOff.body, tvMeme.body]));
    // 3. no Robinhood artwork in the token lists either: no picture for a Stock Token, none named after a token's own address
    const tokR = mdR.tokens({ chain: 'robinhood', limit: 200 }).body.rows, ttR = (mdR.chain({ key: 'robinhood' }).body.topTokens || {}).rows || [], rhjA = new Set(T.rows.filter((r) => r.issuer.key === 'rhj').map((r) => r.address));
    const ownNamed = (r) => !!r.logo && decodeURIComponent(r.logo).toLowerCase().includes('/' + r.address.slice(2) + '.');
    const rawBatch = mdR._test.latestBatch('robinhood').rows.filter((r) => rhjA.has(r.base_addr) && r.base_logo);
    check('RWA review two: the token lists and the chain view\'s top tokens draw no Robinhood artwork — no picture for a Robinhood Stock Token (the batch gives one for ' + rawBatch.length + '), none named after a token\'s own address — and other tokens keep theirs',
      rawBatch.length > 0 && tokR.some((r) => rhjA.has(r.address)) && tokR.filter((r) => rhjA.has(r.address)).every((r) => r.logo === null) && ![...tokR, ...ttR].some(ownNamed) && ttR.filter((r) => rhjA.has(r.address)).every((r) => r.logo === null)
      && tokR.some((r) => !rhjA.has(r.address) && r.logo), brief(tokR.filter((r) => rhjA.has(r.address)).slice(0, 3).map((r) => [r.symbol, r.logo])));
    // 12. connected tokens: a token whose own pools were never asked (WEEK, outside the 12) is never told they could not be read
    const wkBasis = mdR.rwaToken({ address: WEEK }).body.connectedBasis, spyBasis = spyT.connectedBasis;
    check('RWA review two: where a token\'s connected tokens come from — its own pools when read (TSLA: own), else only the most-traded pools kept, with why: WEEK (not among the 12 with the most liquidity) "only the 12 RWAs with the most liquidity have their own pools read", never "could not be read"; SPY, whose own read failed, keeps connectedWhy',
      tb.connectedBasis && tb.connectedBasis.own === true && wkBasis && wkBasis.own === false && /only the 12 RWAs with the most liquidity have their own pools read/.test(wkBasis.note) && !/could not be read/.test(wkBasis.note) && wkBasis.at === mdR._test.latestBatch('robinhood').at
      && !mdR.rwaToken({ address: WEEK }).body.connectedWhy && spyBasis.own === false && !!spyT.connectedWhy, brief([tb.connectedBasis, wkBasis, spyBasis]));
    // 15. a kind or an issuer chosen: the rows' own totals beside the whole chain's
    const onTk = mdR.rwa({ issuer: 'ondo', view: 'tokens' }).body, etfA = mdR.rwa({ kind: 'etf' }).body;
    check('RWA review two: with an issuer or a kind chosen, the answer carries the rows\' own totals (totalsShown, the counted tokens among them) beside the whole chain\'s (totals, unchanged) — and a note says which is which; with neither chosen there is no totalsShown',
      onTk.totalsShown && onTk.totalsShown.count === onTk.rows.filter((r) => r.confidence !== 'not-confirmed').length && onTk.totals.count === A.totals.count && etfA.totalsShown && etfA.totalsShown.count === T.rows.filter((r) => r.confidence !== 'not-confirmed' && r.underlying.kind === 'etf').length
      && (etfA.totalsShown.value.v == null || etfA.totalsShown.value.v <= A.totals.value.v) && !('totalsShown' in A) && onTk.notes.some((n) => /The totals are the whole chain's, every kind and issuer/.test(n)), brief(onTk.totalsShown));
    // 6. the run's note: never cut in the middle of a word — reasons dropped from the last part back, then whole parts, counted
    const fitN = mdR._test.fitNote, bareN = (x) => { let y = x, z; do { z = y; y = y.replace(/\s*\([^()]*\)/g, ''); } while (y !== z); return y.replace(/\s+/g, ' ').trim(); };
    const partsN = ['not read: quotes (upstream 500), corporate actions (upstream 500), deviations (upstream 500), Chainlink directory (upstream 500), stablecoins (upstream 500)', 'chain not read: rpc http 503', 'GT tokens 0 in 7 calls (upstream 500)', 'GT pools 0/1', 'DeFi deposits not read (DefiLlama\'s app list comes with the liquidity job, which has not run yet)'];
    const wholeN = (out, parts) => out.replace(/(?:^|; )\+\d+ more$/, '').split('; ').filter(Boolean).every((seg) => parts.some((x) => x === seg || bareN(x) === seg));
    const nA = fitN(partsN), nB = fitN(partsN.concat(['x'.repeat(150), 'y'.repeat(150)])), nC = fitN(['short', 'parts (fit)']);
    check('RWA review two: the run\'s note fits in 290 characters without cutting a word — the reasons in brackets go first, from the last part back (each stays in its own record), then whole parts from the end, counted "+N more"; a note that fits is unchanged',
      nA.length <= 290 && wholeN(nA, partsN) && /; DeFi deposits not read$/.test(nA) && /^not read: quotes/.test(nA) && nB.length <= 290 && /; \+\d+ more$/.test(nB) && wholeN(nB, partsN.concat(['x'.repeat(150), 'y'.repeat(150)])) && nC === 'short; parts (fit)', brief([nA, nB]));
    // the page and card fixtures (tests/fixtures/market/rwa-*.json, tests/fixtures/rwacard/rwa-token-*.json) are these answers, dumped
    // (the spoof is this test's hypothetical, never a fixture's: it is left out of what is dumped)
    const dumpR = (name, o) => dump(name, JSON.parse(JSON.stringify(o, (k, v) => (Array.isArray(v) ? v.filter((x) => !(x && typeof x === 'object' && x.address === ATT)) : v))));
    dumpR('rwa-assets', A); dumpR('rwa-tokens', T); dumpR('rwa-connected', CN); dumpR('rwa-stables', SV); dumpR('rwa-token-tsla', tb); dumpR('rwa-token-gme-memecoin', meme.body);
    dumpR('rwa-token-tsla-registry-down', tbDown); dumpR('rwa-token-gme', gme); dumpR('rwa-token-usdg', usdgT.body); dumpR('rwa-token-notmystock', nms.body);
    for (const [k, body] of cardsNow) dumpR('rwa-token-' + k, body);
    // 10. a token the pool batch hinted at, gone from it, is dropped from the chain state — never classified forever from an old read
    F.gtP1.data.splice(F.gtP1.data.indexOf(spoofPool), 1); F.gtP1.included.splice(F.gtP1.included.indexOf(spoofInc), 1);
    await runR('pools', 10 * 60e3); await runR('rwa');
    check('RWA review: a token only the pool batch hinted at (the spoof), gone from the batch, is dropped from the chain state on the next run — never classified forever from an old read; the registry\'s and Robinhood\'s own stay', !st('rwa_chain').tokens[ATT] && !!st('rwa_chain').tokens[WEEK] && !!st('rwa_chain').tokens[TSLA]);
    // review two, 5/19: a run in which every GeckoTerminal multi call fails — the read status names the real last good read; each token says its read failed
    const gtB = st('rwa_gt'), goodAt = gtB.readAt;
    vendorFail.gtMulti = true; const rgF = await runR('rwa', 31 * 60e3); vendorFail.gtMulti = false;
    const gtA2 = st('rwa_gt'), RG = mdR.rwa({ view: 'tokens' }).body, spyG = RG.rows.find((r) => r.symbol === 'SPY'), amcG = RG.rows.find((r) => r.address === AMC);
    const utcN = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    check('RWA review two: when every GeckoTerminal token call of a run fails, its read time stays the last good read\'s (never the failure\'s own), and reads.gt says so with that time; SPY keeps its last good figure with its own time, said as the last good read; AMC (no entry before) says its read failed — no token says "has not run yet"',
      Number.isFinite(goodAt) && gtA2.readAt === goodAt && gtA2.failAt === rclock && gtA2.triedAt === rclock && /GT tokens 0 in \d+ calls \(upstream 500\)/.test(rgF.note) && RG.reads.gt.ok === false && RG.reads.gt.at === goodAt
      && RG.reads.gt.why === 'GeckoTerminal\'s token read could not be read at ' + utcN(rclock) + ' (upstream 500) — the last good read, from ' + utcN(goodAt) + ', is shown'
      && spyG.liquidity.v != null && spyG.liquidity.at === gtB.tokens[spyG.address].at && /its last good read; GeckoTerminal could not be read for it at/.test(spyG.liquidity.label)
      && amcG && amcG.liquidity.v === null && /failed \(upstream 500\) — tried again on the next run; the read before it/.test(amcG.liquidity.why) && !RG.rows.some((r) => /has not run yet/.test(r.liquidity.why || '')), brief([RG.reads.gt, spyG && spyG.liquidity, amcG && amcG.liquidity.why]));
    delete RR.beacons[ATT]; delete RR.supplies[ATT]; delete RR.meta[ATT]; delete RR_EXTRA_CODE[ATT]; gtMultiLeaveOut.clear();
    dbR.close();
  }

  /* ── the chain market caps, cross-checked (owner, 2026-10-28: "make sure you are showing the right market caps for all of the
     chains pulled from multiple sources and cross verified") — every input one the sources gave that day (README.txt) ── */
  // 1. the rules on their own (lib/chainmcap.js)
  const cgM = new Map(MC.cg.map((x) => CM.cgCoin(x, NOW_M)).map((c) => [c.id, c]));
  const walkM = loreRows.map((x) => CM.loreCoin(x, NOW_M)).filter(Boolean);
  const cgRaw = (id) => MC.cg.find((x) => x.id === id), loreRaw = (id) => loreRows.find((x) => String(x.id) === id);
  const relayOf = (id) => { const e = MC.relay['coingecko:' + id]; return e ? { v: e.mcap, at: e.timestamp * 1000 } : null; };
  const canon = (o) => JSON.stringify(Object.keys(o || {}).sort().map((k) => [k, o[k]]));   // the same entries, whatever their order
  const SEEN = { upTo: 2000, total: MC.walk.info.coins_num, ended: false };   // what the 20-page walk read: CoinLore's first 2,000 of 14,993
  const xc = (id) => { const m = CM.matchCoin(cgM.get(id), walkM, { seen: SEEN }); return CM.crossCheck({ sym: cgM.get(id).symbol, cg: cgM.get(id), relay: relayOf(id), lore: m.coin, loreWhy: m.why, loreAlso: m.coin ? m.rejected : null, now: NOW_M }); };
  check('names are compared as words: a parenthesised part dropped (CoinGecko\'s TON is "Gram (prev. Toncoin)", CoinLore\'s Sonic "Sonic (prev. FTM)"), invisible characters gone (CoinGecko writes stable-2 "\\u200b\\u200bStable"), one name the start of the other — and "Theta Token" is not "Theta Network"',
    cgRaw('the-open-network').name === 'Gram (prev. Toncoin)' && CM.normName(cgRaw('the-open-network').name) === 'gram' && cgRaw('stable-2').name === '​​Stable' && CM.normName(cgRaw('stable-2').name) === 'stable' && cgM.get('stable-2').name === 'Stable'
    && loreRaw('148191').name === 'Sonic (prev. FTM)' && CM.sameName(loreRaw('148191').name, cgRaw('sonic-3').name) && loreRaw('32360').name === 'Theta Token' && !CM.sameName(loreRaw('32360').name, cgRaw('theta-token').name), brief([cgRaw('stable-2').name, CM.normName(cgRaw('the-open-network').name)]));
  const beamM = CM.matchCoin(cgM.get('beam-2'), walkM);
  check('the Beam trap: CoinLore lists two coins named Beam — onbeam at $0.003362 (CoinGecko\'s beam-2 is $0.0033395) and the older BEAM at $0.006579; the matcher takes the first, and leaves the other out as a different coin',
    beamM.coin && beamM.coin.id === '136107' && beamM.rejected.length === 1 && beamM.rejected[0].id === '33386' && loreRaw('33386').price_usd === '0.006579' && loreRaw('136107').price_usd === '0.003362' && cgRaw('beam-2').current_price === 0.0033395, brief(beamM));
  const twoM = CM.matchCoin(cgM.get('beam-2'), walkM, { priceTol: 1 });
  check('  ...two coins that both pass are neither: with the price test widened to 100% both of CoinLore\'s Beams pass, and no figure is taken from either', twoM.coin === null && /^CoinLore lists two coins that could be it/.test(twoM.why), twoM.why);
  const blastM = CM.matchCoin(cgM.get('blast'), walkM), bnbM = CM.matchCoin(cgM.get('binancecoin'), walkM), bmtM = CM.bySymbol(walkM).get('BMT') || [];
  check('  ...a same-name coin at another price is a different coin (CoinLore\'s "Blast" at $0.000003 against CoinGecko\'s $0.00003657); a coin under another name is not taken (CoinLore\'s "Binance Coin" is not CoinGecko\'s "BNB"); a coin seen on two pages of the walk (Bubblemaps — the list shifted while it was read) is one coin',
    blastM.coin === null && /priced \$0\.000003 against CoinGecko’s \$0\.000037 for \$BLAST — a different coin, not used/.test(blastM.why) && bnbM.coin === null && /only under another name \(“Binance Coin”, not CoinGecko’s “BNB”\)/.test(bnbM.why)
    && loreRows.filter((x) => String(x.id) === '151131').length === 2 && bmtM.length === 1, brief([blastM.why, bnbM.why, bmtM.length]));
  const zerosM = ['fantom', 'mixin', 'pulsechain', 'krown-network'].map(xc);
  check('CoinGecko\'s 0 is no market cap: Fantom, Mixin, PulseChain and Krown Network come with 0 and no circulating supply — each null with why in words, never $0',
    ['fantom', 'mixin', 'pulsechain', 'krown-network'].every((id) => cgRaw(id).market_cap === 0 && cgRaw(id).circulating_supply === 0) && zerosM.every((r) => r.v === null && r.check.status === 'none' && /it lists no circulating supply/.test(r.why))
    && zerosM[0].why === 'CoinGecko gives no market cap for $FTM — it lists no circulating supply; no coin with the symbol $FTM among the first 2,000 coins of CoinLore’s list, the part its daily walk reads (it lists 14,993)', brief(zerosM.map((r) => r.why)));
  const ethM = xc('ethereum'), arbM = xc('arbitrum'), kcsM = xc('kucoin-shares'), bnbX = xc('binancecoin');
  check('agreed, differs, single — from the numbers, the figure shown always CoinGecko\'s: ETH within 10% (CoinGecko $285B, CoinLore $286B); ARB 21% apart at the same price, each counting its own circulating supply; KCS 38% apart with prices 2.2% apart; BNB CoinGecko\'s alone',
    ethM.check.status === 'agreed' && ethM.v === cgRaw('ethereum').market_cap && ethM.src === 'coingecko' && ethM.check.sources.map((x) => x.src).join() === 'coingecko,coinlore' && ethM.check.sources[1].v === Number(loreRaw('80').market_cap_usd) && ethM.check.sources[1].price === Number(loreRaw('80').price_usd)
    && arbM.check.status === 'differs' && arbM.v === cgRaw('arbitrum').market_cap && arbM.check.notes[0] === 'CoinGecko $1.15B, CoinLore $904M (21% apart): both price $ARB the same (about $0.17); they count a different circulating supply (CoinGecko 6.89B, CoinLore 5.4B)'
    && kcsM.check.status === 'differs' && kcsM.check.notes[0] === 'CoinGecko $1.06B, CoinLore $659M (38% apart): their prices for $KCS differ by 2.2% (CoinGecko $7.6, CoinLore $7.43), and they count a different circulating supply (CoinGecko 140M, CoinLore 88.7M)'
    && bnbX.check.status === 'single' && bnbX.v === cgRaw('binancecoin').market_cap && bnbX.check.sources.length === 1, brief([ethM.check, arbM.check.notes, kcsM.check.notes]));
  const selfM = MC.cg.map((x) => [x.id, CM.selfChecks(CM.cgCoin(x, NOW_M), NOW_M)]).filter(([, n]) => n.length);
  const ecash = CM.loreCoin(loreRaw('51539'), NOW_M), usdgGt = F.gtP1.data.find((p) => (INC.get(p.relationships.base_token.data.id) || {}).attributes && INC.get(p.relationships.base_token.data.id).attributes.address === USDG).attributes;
  const ecashN = CM.selfChecks(ecash, NOW_M, 'CoinLore'), usdgN = CM.selfChecks({ mcap: Number(usdgGt.market_cap_usd), fdv: Number(usdgGt.fdv_usd), price: Number(usdgGt.base_token_price_usd), supply: null }, NOW, 'GeckoTerminal');
  check('CoinGecko\'s figures checked against themselves: of the 32 measured none is more than 2% off its own price × circulating supply or above its own FDV; ICX\'s, last updated 06:38 UTC, is stale at a 15:30 read — and the same arithmetic catches the measured figures that fail it (CoinLore\'s eCash, 3.9% off; GeckoTerminal\'s USDG pool, whose market cap is CoinGecko\'s global $3.1B, above the chain\'s $674M FDV)',
    selfM.length === 1 && selfM[0][0] === 'icon' && selfM[0][1].length === 1 && selfM[0][1][0] === 'stale: CoinGecko last updated this figure 9 h before it was read (2026-10-28 06:38 UTC)'
    && ecashN.length === 1 && /^CoinLore’s figure does not equal its own price × circulating supply/.test(ecashN[0]) && usdgN.length === 1 && usdgN[0] === 'GeckoTerminal’s market cap (' + CM.money(Number(usdgGt.market_cap_usd)) + ') is larger than its own fully diluted value (' + CM.money(Number(usdgGt.fdv_usd)) + ')' && Number(usdgGt.market_cap_usd) > 3e9 && Number(usdgGt.fdv_usd) < 7e8, brief([selfM, ecashN, usdgN]));
  const modeM = xc('mode');
  check('DefiLlama\'s relay is a freshness check, never a second source: Mode\'s relay ($779k, read 12:08 UTC) is 3.7% off CoinGecko\'s own $809k — noted, and counted nowhere; ETH\'s (0.02% off) is not noted',
    modeM.check.notes.includes('DefiLlama’s relay differs from CoinGecko’s own figure (DefiLlama $779k, CoinGecko $809k — one of them is older)') && !ethM.check.notes.some((n) => /relay/.test(n)) && [modeM, ethM].every((r) => r.check.sources.every((x) => x.src !== 'defillama')), brief(modeM.check));
  const kcsG = cgRaw('kucoin-shares'), kcsL = loreRaw('2750'), gap = (a, b) => Math.abs(a - b) / a;
  check('  ...a "differs" note whose prices are more than 2% apart gives both circulating supplies too: KCS\'s prices are 2.2% apart but its supplies 36% (CoinGecko 140M, CoinLore 88.7M) — the price gap alone cannot make a 38% gap, so the note does not blame it alone',
    gap(kcsG.current_price, Number(kcsL.price_usd)) < 0.03 && gap(kcsG.circulating_supply, Number(kcsL.csupply)) > 0.3 && /and they count a different circulating supply \(CoinGecko 140M, CoinLore 88\.7M\)$/.test(kcsM.check.notes[0]), kcsM.check.notes[0]);
  const icxTs = MC.relay['coingecko:icon'].timestamp, icxRelay = CM.crossCheck({ sym: 'ICX', cg: null, cgWhy: 'CoinGecko was asked less than two minutes ago', relay: { v: MC.relay['coingecko:icon'].mcap, at: CM.relayAt(icxTs) }, now: NOW_M });
  const undated = CM.crossCheck({ sym: 'ETH', cg: null, relay: { v: MC.relay['coingecko:ethereum'].mcap, at: CM.relayAt(undefined) }, now: NOW_M });
  check('DefiLlama\'s relay standing in gets the same 6 h stale rule as CoinGecko\'s own figure (ICX\'s relay is stamped 06:38 UTC, read at 15:30); its timestamp is unix seconds (milliseconds taken as such), and a relay without one is "time not recorded" — never stamped as just read',
    icxRelay.check.status === 'single' && icxRelay.check.notes.includes('stale: DefiLlama’s relay of CoinGecko’s figure was last updated 9 h before it was read (2026-10-28 06:38 UTC)')
    && CM.relayAt(icxTs) === icxTs * 1000 && CM.relayAt(icxTs * 1000) === icxTs * 1000 && CM.relayAt(undefined) === null && CM.relayAt('soon') === null && CM.relayAt(12) === null
    && undated.check.sources[0].at === null && !undated.check.notes.some((n) => /stale/.test(n)) && !CM.crossCheck({ sym: 'MODE', cg: null, relay: { v: MC.relay['coingecko:mode'].mcap, at: CM.relayAt(MC.relay['coingecko:mode'].timestamp) }, now: NOW_M }).check.notes.some((n) => /stale/.test(n)), brief([icxRelay.check.notes, undated.check.sources]));
  /* what the walk read, in its words: CoinLore's first 2,000 of 14,993 coins is not "CoinLore does not list" */
  const lrFull = CM.learnLore(cgM, walkM, { seen: SEEN }), lrEnd = CM.learnLore(cgM, walkM, { seen: Object.assign({}, SEEN, { ended: true }) });
  const othCg = MC.others.cg.map((x) => CM.cgCoin(x, NOW_M)), othLore = Object.values(MC.others.pages).flat().map((x) => CM.loreCoin(x, NOW_M));
  const lrOth = CM.learnLore([cgM.get('iota'), ...othCg], [...walkM, ...othLore], { seen: SEEN });
  check('a token the walk found no CoinLore coin for is said by what the walk read: "no coin with the symbol $FTM among the first 2,000 coins of CoinLore’s list … (it lists 14,993)", never "CoinLore does not list"; "lists no coin with the symbol" only from a walk that reached the end of its list',
    Object.values(lrFull.misses).length > 5 && !Object.values(lrFull.misses).some((m) => /does not list|lists no coin/.test(m)) && lrFull.misses.fantom === 'no coin with the symbol $FTM among the first 2,000 coins of CoinLore’s list, the part its daily walk reads (it lists 14,993)'
    && lrEnd.misses.fantom === 'CoinLore lists no coin with the symbol $FTM' && canon(lrEnd.ids) === canon(lrFull.ids), brief(lrFull.misses));
  check('  ...and a coin CoinLore lists under another symbol is said, never taken: "IOTA" as $MIOTA and "BitTorrent" as $BTTC at CoinGecko\'s price; XDC Network\'s same-price XDCE is "XinFin Network" — no name in common, so nothing is claimed about it beyond "no coin with the symbol $XDC"',
    lrOth.misses.iota === 'no coin with the symbol $IOTA among the first 2,000 coins of CoinLore’s list, the part its daily walk reads (it lists 14,993); CoinLore lists “IOTA” as $MIOTA (priced $0.042) against CoinGecko’s $0.042 — another symbol, so it is not taken as the same coin'
    && /^no coin with the symbol \$BTT among the first 2,000 coins .*; CoinLore lists “BitTorrent” as \$BTTC \(priced \$0\.00000036\) against CoinGecko’s \$0\.00000036 — another symbol, so it is not taken as the same coin$/.test(lrOth.misses.bittorrent)
    && lrOth.misses['xdce-crowd-sale'] === 'no coin with the symbol $XDC among the first 2,000 coins of CoinLore’s list, the part its daily walk reads (it lists 14,993)' && Object.keys(lrOth.ids).length === 0 && othLore.some((c) => c.symbol === 'XDCE' && Math.abs(c.price - othCg[1].price) / othCg[1].price < 0.01), brief(lrOth.misses));
  // a walk cut short (CoinLore refusing from page 6): what it matched is taken; every token it did not settle keeps the last whole walk's verdict
  const cutRows = ['0', '100', '200', '300', '400'].flatMap((k) => MC.walk.pages[k]).map((x) => CM.loreCoin(x, NOW_M));
  const lrCut = CM.learnLore(cgM, cutRows, { seen: { upTo: 500, total: 14993, stopped: 'page 6: rate-limited', partial: true } }), merged = CM.mergeLore(lrFull, lrCut), firstCut = CM.mergeLore(null, lrCut);
  const lostCut = Object.keys(lrFull.ids).filter((k) => !lrCut.ids[k]);
  // a token new since the last whole walk: here that walk as if it had not had Ethereum or Fantom yet
  const baseNew = { ids: Object.fromEntries(Object.entries(lrFull.ids).filter(([k]) => k !== 'ethereum')), misses: Object.fromEntries(Object.entries(lrFull.misses).filter(([k]) => k !== 'fantom')) }, mergedNew = CM.mergeLore(baseNew, lrCut);
  check('  ...a walk cut short leaves the last whole walk\'s verdicts standing — its matches (here ' + lostCut.join(', ') + ', on pages 6–20; Beam with the other BEAM it left out) and its reasons — settles only a token new since then, and on a first walk says how far it got: never "not listed" for a page it did not read',
    lostCut.length >= 1 && canon(merged.ids) === canon(lrFull.ids) && canon(merged.misses) === canon(lrFull.misses) && merged.ids['beam-2'].rejected[0].id === '33386'
    && mergedNew.ids.ethereum.lore === lrCut.ids.ethereum.lore && mergedNew.misses.fantom === 'no coin with the symbol $FTM among the first 500 coins of CoinLore’s list, read so far (its walk was cut short at page 6: rate-limited and goes on later)'
    && lostCut.every((k) => /^no coin with the symbol \$\S+ among the first 500 coins of CoinLore’s list, read so far \(its walk was cut short at page 6: rate-limited and goes on later\)$/.test(firstCut.misses[k])), brief([lostCut, firstCut.misses[lostCut[0]]]));
  const idxM = CM.platformIndex(CM.platformsOf(MC.platforms)), chM = (n) => MC.chains.find((c) => c.name === n);
  const mapOf = (n) => { const c = chM(n); return CM.mappingCheck({ chainId: c.chainId, name: c.name, gecko: c.gecko_id, gas: c.gasTokenGeckoId }, idxM, (id) => cgM.get(id)); };
  const seiAmb = CM.mappingCheck({ chainId: null, name: 'Sei Network', gecko: 'sei-network', gas: 'sei-network' }, idxM);
  const gasOnly = MC.chains.filter((c) => c.gecko_id && mapOf(c.name).by === 'gas');
  check('the chain → token mapping against CoinGecko\'s asset platforms: Ethereum (chain id 1) confirmed; chains with two tokens confirmed by either — NEO, VeChain and Theta by their own token, Stable by its gas token (usdt0), said as only that; Beam differs (CoinGecko names beam, DefiLlama beam-2 — said, and DefiLlama\'s kept); Hyperliquid L1, which no platform is named, unchecked; a name CoinGecko gives two platforms ("Sei Network" and "Sei Network (Deprecating)") is not used',
    mapOf('Ethereum').status === 'confirmed' && !('by' in mapOf('Ethereum')) && !mapOf('Ethereum').note && ['NEO', 'VeChain', 'Theta'].every((n) => mapOf(n).status === 'confirmed' && !mapOf(n).by && chM(n).gasTokenGeckoId !== chM(n).gecko_id) && mapOf('Stable').status === 'confirmed' && mapOf('Stable').by === 'gas' && chM('Stable').gasTokenGeckoId === 'usdt0' && chM('Stable').gecko_id === 'stable-2'
    && mapOf('Stable').note === 'CoinGecko names usdt0, the chain’s gas token, as its native coin; that does not check $STABLE (stable-2), the token whose market cap is shown'
    && mapOf('Beam').status === 'differs' && mapOf('Beam').note === 'CoinGecko lists beam as this chain’s native coin; DefiLlama names beam-2 — the figure shown is for DefiLlama’s' && mapOf('Hyperliquid L1').status === 'unchecked'
    && seiAmb.status === 'unchecked' && /more than one asset platform/.test(seiAmb.note) && MC.platforms.filter((p) => CM.normName(p.name) === 'seinetwork').map((p) => p.name).sort().join('|') === 'Sei Network|Sei Network (Deprecating)', brief([mapOf('Beam'), mapOf('Hyperliquid L1'), seiAmb]));

  check('  ...a chain confirmed only by its gas token says so — it checks the gas token, not the token whose market cap is shown: Arbitrum (CoinGecko names ETH; the figure is ARB\'s), OP Mainnet, Stable — ' + gasOnly.length + ' of the measured chains, each with its own token not its gas token',
    gasOnly.length >= 3 && ['Arbitrum', 'OP Mainnet', 'Stable'].every((n) => gasOnly.some((c) => c.name === n)) && gasOnly.every((c) => c.gecko_id !== c.gasTokenGeckoId && mapOf(c.name).status === 'confirmed' && mapOf(c.name).note.includes(c.gasTokenGeckoId) && mapOf(c.name).note.includes(c.gecko_id + ')'))
    && mapOf('Arbitrum').note === 'CoinGecko names $ETH (ethereum), the chain’s gas token, as its native coin; that does not check $ARB (arbitrum), the token whose market cap is shown', brief(gasOnly.map((c) => [c.name, mapOf(c.name)])));

  // 2. the collectors on those answers: a chains run, the daily references (CoinGecko's platforms, CoinLore's walk), a chains run again
  vendorMode.mcap = true;
  const dbM = freshDb('m'); let clockM = NOW_M;
  const mdM = MD.createMarketData({ db: dbM, now: () => clockM, outboundTake: take, urls: URLS, bgWaitMs: 1000, askWaitMs: 1000, sleep: fakeSleep });
  mdM.migrate();
  const logM0 = log.length;
  const m1 = await mdM.runJob('chains');
  const preEth = mdM.chains({ limit: 200 }).body.rows.find((r) => r.key === 'ethereum');
  clockM = NOW_M + 3 * 60e3; const walkAt = log.length, slp0 = sleeps.length;
  const mrM = await mdM.runJob('mcapRefs');
  const walkCalls = log.slice(walkAt).filter((l) => /^GET \/lore\/tickers\//.test(l)), walkSleeps = sleeps.slice(slp0);
  const learnedM = JSON.parse(dbM.prepare("SELECT value FROM mkt_state WHERE name = 'coinlore_ids'").get().value);
  clockM = NOW_M + 6 * 60e3; const tickAt = log.length;
  const m2 = await mdM.runJob('chains');
  const tickCalls = log.slice(tickAt).filter((l) => /^GET \/lore\/ticker\//.test(l));
  const rowsM = mdM.chains({ sort: 'mcap', limit: 200 }).body.rows, rowM = (k) => rowsM.find((r) => r.key === k);
  const ascM = mdM.chains({ sort: 'mcap', dir: 'asc', limit: 200 }).body.rows;
  check('the first chains run reads CoinGecko and DefiLlama\'s relay, and says CoinLore\'s coins are not matched yet (one source, said); the daily references then read CoinGecko\'s asset platforms and walk CoinLore\'s list — 20 pages at most, every page 1.1 s after the one before',
    m1.ok && /market caps of 32 tokens: 32 read from CoinGecko/.test(m1.note) && /CoinLore's coins have not been matched yet/.test(m1.note) && preEth.mcap.check.status === 'single' && /not been matched yet/.test(preEth.mcap.check.notes.join(' '))
    && mrM.ok && new RegExp('^' + MC.platforms.length + ' CoinGecko asset platforms; CoinLore: 20 of 32 chain tokens matched over 20 pages').test(mrM.note)
    && walkCalls.length === 20 && walkCalls.length <= MD.MCAP.LORE_WALK_MAX && walkSleeps.length === walkCalls.length - 1 && walkSleeps.every((ms) => ms >= 1100) && MD.MCAP.LORE_GAP_MS >= 1100
    && learnedM.ids['beam-2'].lore === '136107' && learnedM.ids['beam-2'].rejected[0].id === '33386' && /a different coin/.test(learnedM.misses.blast), brief([m1.note, mrM.note, walkCalls.length, walkSleeps.slice(0, 3)]));
  check('  ...and the next chains run reads the matched coins again in one CoinLore call (50 ids at most a call), matched again on that read: ETH agrees, ARB differs and says why, BNB has one source',
    m2.ok && tickCalls.length === 1 && decodeURIComponent(tickCalls[0].split('id=')[1]).split(',').length === 20 && /checked against CoinLore: \d+ agree, \d+ differ, \d+ one source, 4 none/.test(m2.note)
    && rowM('ethereum').mcap.check.status === 'agreed' && rowM('arbitrum').mcap.check.status === 'differs' && /both price \$ARB the same/.test(rowM('arbitrum').mcap.check.notes[0]) && rowM('bsc').mcap.check.status === 'single', m2.note);
  const ethR = rowM('ethereum').mcap;
  check('  ...every chain\'s market cap carries its check: { status, sources [{ src, v, price, supply, at }], notes, mapping { status, note? }, coin } — CoinGecko\'s figure shown, with its own price, supply and update time beside CoinLore\'s',
    rowsM.length === MC.chains.length && rowsM.every((r) => r.mcap.check && ['agreed', 'differs', 'single', 'none'].includes(r.mcap.check.status) && Array.isArray(r.mcap.check.sources) && Array.isArray(r.mcap.check.notes) && r.mcap.check.mapping && r.mcap.check.mapping.status)
    && JSON.stringify(Object.keys(ethR.check)) === '["status","sources","notes","mapping","coin"]' && JSON.stringify(Object.keys(ethR.check.sources[0])) === '["src","v","price","supply","at"]'
    && ethR.v === cgRaw('ethereum').market_cap && ethR.src === 'coingecko' && ethR.at === Date.parse(cgRaw('ethereum').last_updated) && ethR.check.sources[0].price === cgRaw('ethereum').current_price && ethR.check.sources[0].supply === cgRaw('ethereum').circulating_supply
    && ethR.check.sources[1].src === 'coinlore' && ethR.check.sources[1].at === NOW_M + 6 * 60e3 && ethR.check.mapping.status === 'confirmed' && ethR.check.coin.id === 'ethereum' && ethR.label === 'ETH (gas token), market cap', brief(ethR));
  const zeroRows = ['fantom', 'mixin', 'pulsechain', 'krown-network'].map(rowM);
  check('  ...Fantom, Mixin, PulseChain and Krown Network are "not available" with why (they showed $0 before), never 0 anywhere — in the list, the sort, the table', zeroRows.every((r) => r && r.mcap.v === null && /lists no circulating supply/.test(r.mcap.why) && r.mcap.check.status === 'none' && r.mcap.check.coin.symbol)
    && rowsM.every((r) => r.mcap.v === null || r.mcap.v > 0) && !dbM.prepare('SELECT 1 FROM mkt_chain_snap WHERE mcap <= 0').get()
    && (() => { const k = rowsM.findIndex((r) => r.mcap.v == null), a = ascM.findIndex((r) => r.mcap.v == null); return k > 0 && rowsM.slice(k).every((r) => r.mcap.v == null) && a > 0 && ascM.slice(a).every((r) => r.mcap.v == null) && rowsM.slice(0, k).every((r, i, x) => i === 0 || x[i - 1].mcap.v >= r.mcap.v); })(), brief(zeroRows.map((r) => r && r.mcap)));
  const morphR = rowM('morph'), stableR = rowM('stable'), xrplR = rowM('xrpl'), xevmR = rowM('xrpl-evm'), beamR = rowM('beam'), blastR = rowM('blast'), iconR = rowM('icon'), rhR = rowM('robinhood');
  check('  ...the labels: Morph is BGB (CoinGecko\'s symbol; DefiLlama gives "-"), Stable\'s name has no invisible characters, XRPL and XRPL EVM show the same token\'s market cap and say so, Robinhood Chain has none and nothing to check',
    MC.chains.find((c) => c.name === 'Morph').tokenSymbol === '-' && morphR.mcap.label === 'BGB (gas token), market cap' && dbM.prepare("SELECT native_symbol FROM mkt_chain_snap WHERE chain = 'morph' ORDER BY id DESC LIMIT 1").get().native_symbol === 'BGB'
    && stableR.mcap.check.coin.name === 'Stable' && xrplR.mcap.v === xevmR.mcap.v && xrplR.mcap.v === cgRaw('ripple').market_cap && /the same token's market cap as XRPL EVM's \(one token, shared\)$/.test(xrplR.mcap.label) && /the same token's market cap as XRPL's \(one token, shared\)$/.test(xevmR.mcap.label)
    && rhR.mcap.v === null && rhR.mcap.why === 'No native token — gas is paid in ETH' && rhR.mcap.check.status === 'none' && rhR.mcap.check.mapping.note === 'no token of its own to check', brief([morphR.mcap.label, xrplR.mcap.label, stableR.mcap.check.coin]));
  check('  ...and the traps are said where they apply: Beam agrees with onbeam and names the other BEAM it left out, and its mapping differs; Blast\'s CoinLore namesake is a different coin; ICX\'s figure is stale; Mode\'s relay is older',
    beamR.mcap.check.status === 'agreed' && beamR.mcap.check.notes.includes('CoinLore also lists a “BEAM” priced $0.0066 — another coin, not counted') && beamR.mcap.check.mapping.status === 'differs' && /DefiLlama names beam-2/.test(beamR.mcap.check.mapping.note)
    && blastR.mcap.check.status === 'single' && /a different coin, not used/.test(blastR.mcap.check.notes.join(' ')) && /^stale: /.test(iconR.mcap.check.notes.join(' ')) && /DefiLlama’s relay differs/.test(rowM('mode').mcap.check.notes.join(' ')), brief([beamR.mcap.check, blastR.mcap.check.notes]));
  const cdArb = mdM.chain({ key: 'arbitrum' }).body, apiM = await mdM.apiResource('chains', {}, { limit: 100 }), snapM = await mdM.apiResource('chain-snapshots', { key: 'arbitrum' }, { limit: 1 });
  check('  ...the chain detail and the Send API carry the same figure and check (the snapshots their stored mcap_check as JSON), and the chain detail names CoinGecko and CoinLore among its sources',
    JSON.stringify(cdArb.stats.mcap) === JSON.stringify(rowM('arbitrum').mcap) && ['coingecko', 'coinlore'].every((id) => cdArb.sources.some((x) => x.id === id && /^https:\/\/www\.coin(gecko|lore)\.com$/.test(x.url)))
    && JSON.stringify(apiM.body.data.find((r) => r.key === 'arbitrum').mcap) === JSON.stringify(rowM('arbitrum').mcap) && snapM.body.data[0].mcap_check && snapM.body.data[0].mcap_check.status === 'differs' && typeof snapM.body.data[0].mcap_check.notes[0] === 'string', brief(snapM.body.data[0] && snapM.body.data[0].mcap_check));
  const cgAsks = log.slice(logM0).filter((l) => /^GET \/cg\//.test(l));
  check('  ...CoinGecko was asked three times in all (its coins on each chains run, its platforms once), never twice within two minutes; CoinLore 21 times (the walk, then one read)',
    cgAsks.length === 3 && cgAsks.filter((l) => /asset_platforms/.test(l)).length === 1 && log.slice(logM0).filter((l) => /^GET \/lore\//.test(l)).length === 21, cgAsks.join(' | '));
  // a learned coin whose price no longer agrees is dropped for that read (here the state names the older BEAM for beam-2, as a bad walk would)
  learnedM.ids['beam-2'] = { lore: '33386' };
  dbM.prepare("UPDATE mkt_state SET value = ? WHERE name = 'coinlore_ids'").run(JSON.stringify(learnedM));
  clockM = NOW_M + 9 * 60e3; await mdM.runJob('chains');
  const beamBad = mdM.chains({ limit: 200 }).body.rows.find((r) => r.key === 'beam').mcap;
  check('  ...the price test runs again on every read: a learned CoinLore coin whose price stops agreeing (the older BEAM\'s $0.006579 against beam-2\'s $0.0033395) is dropped for that read, said, and the figure is CoinGecko\'s alone',
    beamBad.check.status === 'single' && beamBad.v === cgRaw('beam-2').market_cap && /priced \$0\.0066 against CoinGecko’s \$0\.0033 for \$BEAM — a different coin, not used \(on this read\)/.test(beamBad.check.notes.join(' ')), brief(beamBad.check));
  const cdFtm = mdM.chain({ key: 'fantom' }).body;
  check('  ...the chain detail names the source its stat names even when no figure came of it: Fantom\'s market cap is CoinGecko\'s "no market cap" (v null), and CoinGecko is among its sources, linked',
    cdFtm.stats.mcap.src === 'coingecko' && cdFtm.stats.mcap.v === null && /CoinGecko gives no market cap/.test(cdFtm.stats.mcap.why) && cdFtm.sources.some((x) => x.id === 'coingecko' && x.url === 'https://www.coingecko.com'), brief([cdFtm.stats.mcap, cdFtm.sources]));
  // a chains run right after another takes DefiLlama's relay: the token keeps CoinGecko's symbol and name from the run before (never its price)
  clockM = NOW_M + 9 * 60e3 + 30e3; const rRel = await mdM.runJob('chains');
  const relRows = mdM.chains({ limit: 200 }).body.rows, relMorph = relRows.find((r) => r.key === 'morph').mcap, relIcon = relRows.find((r) => r.key === 'icon').mcap;
  check('  ...on a run that has only DefiLlama\'s relay, Morph is still BGB (CoinGecko\'s symbol, from the run before — DefiLlama writes "-"), never BITGET-TOKEN, with no price carried; and the relay\'s own 6 h stale rule applies (ICX\'s relay, 06:38 UTC)',
    /CoinGecko was asked less than two minutes ago/.test(rRel.note) && /0 read from CoinGecko, \d+ relayed by DefiLlama/.test(rRel.note) && relMorph.label === 'BGB (gas token), market cap — CoinGecko\'s figure, relayed by DefiLlama' && relMorph.check.coin.symbol === 'BGB' && relMorph.check.coin.name === 'Bitget Token'
    && dbM.prepare("SELECT native_symbol s, mcap_check k FROM mkt_chain_snap WHERE chain = 'morph' ORDER BY id DESC LIMIT 1").get().s === 'BGB' && JSON.parse(dbM.prepare("SELECT mcap_check k FROM mkt_chain_snap WHERE chain = 'morph' ORDER BY id DESC LIMIT 1").get().k).coin.price === null
    && relIcon.check.notes.includes('stale: DefiLlama’s relay of CoinGecko’s figure was last updated 9 h before it was read (2026-10-28 06:38 UTC)'), brief([rRel.note, relMorph.label, relIcon.check.notes]));
  dbM.close();
  // the references' own rules: never within two minutes of another CoinGecko read, nor just before a chains run; a walk cut short goes on
  // from where it stopped, within 20 pages a UTC day; a walk that stops once every token is matched
  const dbN = freshDb('n'); let clockN = NOW_M;
  const mdN = MD.createMarketData({ db: dbN, now: () => clockN, outboundTake: take, urls: URLS, bgWaitMs: 1000, askWaitMs: 1000, sleep: fakeSleep, cgDemoKey: 'demo-key-for-the-test' });
  const loreN = () => JSON.parse(dbN.prepare("SELECT value FROM mkt_state WHERE name = 'coinlore_ids'").get().value);
  const walkStarts = (from) => log.slice(from).filter((l) => /^GET \/lore\/tickers\//.test(l)).map((l) => Number(l.match(/start=(\d+)/)[1]));
  mdN.migrate(); await mdN.runJob('chains');
  clockN = NOW_M + 60e3; const cgN0 = hits['cg-platforms'] || 0; vendorFail.loreFrom = 500;
  const wN1 = log.length, rN1 = await mdN.runJob('mcapRefs'); vendorFail.loreFrom = null; const cgN1 = hits['cg-platforms'] || 0;
  const learnedN = loreN(), startsN1 = walkStarts(wN1);
  clockN = NOW_M + 4 * 60e3; const walkN = log.length;
  const rN2 = await mdN.runJob('mcapRefs'); const learnedN2 = loreN(), startsN2 = walkStarts(walkN);
  const cgPlat = cgSeen.filter((x) => x.q === 'asset_platforms').pop() || {};
  check('the references never ask CoinGecko within two minutes of another read (they wait for the next try), and a walk cut short (CoinLore refusing from page 6) keeps what it matched, says where it stopped, and goes on from that page — not from page 1; the operator\'s Demo key goes with the platforms read as its header',
    !rN1.ok && /asset platforms not read: CoinGecko was asked less than two minutes ago/.test(rN1.note) && cgN1 === cgN0 && /the walk stopped at page 6: rate-limited and goes on from there/.test(rN1.note) && learnedN.stopped === 'page 6: rate-limited' && learnedN.ids.ethereum && learnedN.pages === 5
    && learnedN.walk.next === 500 && learnedN.dayCalls === 6 && startsN1.join() === '0,100,200,300,400,500'
    && (hits['cg-platforms'] || 0) === cgN0 + 1 && cgPlat.key === 'demo-key-for-the-test' && startsN2[0] === 500 && startsN2.length === 14, brief([rN1.note, rN2.note, startsN1, startsN2]));
  check('  ...and the walk reads at most 20 pages in a UTC day, a refused page counted: the cut-short walk (6 calls) goes on for 14 more and stops there, says so, and keeps its place',
    startsN1.length + startsN2.length === MD.MCAP.LORE_WALK_MAX && !rN2.ok && /today's 20 pages are spent and the walk goes on after 00:00 UTC/.test(rN2.note) && learnedN2.dayCalls === 20 && learnedN2.walk.next === 1900 && learnedN2.complete === false && learnedN2.ids.ethereum, brief([rN2.note, learnedN2.dayCalls]));
  // a chains run 90 s after the platforms read: it waits out the rest of CoinGecko's two minutes (its slot taken first), never DefiLlama's relay for half an hour
  clockN = NOW_M + 4 * 60e3 + 90e3; const slpN = sleeps.length, cgM0 = hits['cg-markets'] || 0;
  const rN3 = await mdN.runJob('chains'); const morphN = mdN.chains({ limit: 200 }).body.rows.find((r) => r.key === 'morph').mcap;
  check('  ...a chains run that comes 90 s after the platforms read waits the other 30 s and reads CoinGecko itself — every token read from CoinGecko, none relayed, Morph still BGB',
    sleeps.slice(slpN).includes(30e3) && (hits['cg-markets'] || 0) === cgM0 + 1 && /market caps of 32 tokens: 32 read from CoinGecko;/.test(rN3.note) && !/relayed by DefiLlama|asked less than two minutes/.test(rN3.note) && morphN.label === 'BGB (gas token), market cap', brief([rN3.note, sleeps.slice(slpN)]));
  // the next UTC day: the walk goes on from page 20 and is whole
  clockN = Date.parse('2026-10-29T00:40:00Z'); const walkN3 = log.length;
  const rN4 = await mdN.runJob('mcapRefs'); const learnedN4 = loreN(), startsN4 = walkStarts(walkN3);
  check('  ...the next UTC day it goes on from page 20 — one page — and is whole: every token matched as a full walk matches it, the misses worded by what it read',
    rN4.ok && startsN4.join() === '1900' && learnedN4.complete === true && learnedN4.walk === null && learnedN4.pages === 20 && learnedN4.dayCalls === 1 && canon(learnedN4.ids) === canon(lrFull.ids)
    && learnedN4.misses.fantom === 'no coin with the symbol $FTM among the first 2,000 coins of CoinLore’s list, the part its daily walk reads (it lists 14,993)' && /20 of 32 chain tokens matched over 20 pages \([^)]*this walk going on from page 20\)/.test(rN4.note), brief([rN4.note, startsN4]));
  // the platforms read steps aside when the chains run is due within 3 minutes (it reads CoinGecko first)
  dbN.prepare("DELETE FROM mkt_state WHERE name = 'cg_platforms'").run(); clockN = Date.parse('2026-10-29T00:50:00Z');
  mdN.start({ jobs: ['chains'], staggerMs: 1000 }); const cgP0 = hits['cg-platforms'] || 0, rN5 = await mdN.runJob('mcapRefs'); mdN.stop();
  check('  ...and the platforms read steps aside, to be tried again within the hour, when the chains run is due within 3 minutes', !rN5.ok && /asset platforms not read now: the chains run, which reads CoinGecko first, is under way or due within 3 minutes/.test(rN5.note) && (hits['cg-platforms'] || 0) === cgP0, rN5.note);
  dbN.close();
  /* a whole walk, then a walk cut short the next day: yesterday's matches stand for every token today's never reached, and however
     often it is tried while CoinLore keeps refusing, the day's walk reads 20 pages at most */
  const dbQ = freshDb('q'); let clockQ = NOW_M;
  const mdQ = MD.createMarketData({ db: dbQ, now: () => clockQ, outboundTake: take, urls: URLS, bgWaitMs: 1000, askWaitMs: 1000, sleep: fakeSleep }); mdQ.migrate();
  const loreQ = () => JSON.parse(dbQ.prepare("SELECT value FROM mkt_state WHERE name = 'coinlore_ids'").get().value);
  const statusesQ = () => { const n = {}; for (const r of mdQ.chains({ limit: 200 }).body.rows) n[r.mcap.check.status] = (n[r.mcap.check.status] || 0) + 1; return JSON.stringify(n); };
  await mdQ.runJob('chains'); clockQ = NOW_M + 3 * 60e3; await mdQ.runJob('mcapRefs'); clockQ = NOW_M + 6 * 60e3; await mdQ.runJob('chains');
  const day1 = loreQ(), st1 = statusesQ();
  clockQ = NOW_M + 864e5 + 4 * 60e3; vendorFail.loreFrom = 300; const wQ = log.length;
  const rQ1 = await mdQ.runJob('mcapRefs'); const day2 = loreQ();
  clockQ += 2 * 60e3; await mdQ.runJob('chains'); const st2 = statusesQ();
  const tries = [];
  for (let i = 1; i <= 30; i++) { clockQ = NOW_M + 864e5 + (4 + 10 * i) * 60e3; const w0 = log.length; const r = await mdQ.runJob('mcapRefs'); tries.push({ ok: r.ok, starts: walkStarts(w0), note: r.note }); }
  const day2Calls = walkStarts(wQ).length; vendorFail.loreFrom = null;
  check('a walk cut short the next day (CoinLore refusing from page 4) keeps every match of the day before — ' + Object.keys(day1.ids).length + ' tokens — and its reasons for the rest; the chains run after it checks as many against CoinLore as before (never "not listed" for a page it did not read)',
    !rQ1.ok && Object.keys(day1.ids).length === 20 && canon(day2.ids) === canon(day1.ids) && canon(day2.misses) === canon(day1.misses) && day2.walk.next === 300 && st2 === st1
    && /20 of 32 chain tokens matched over 3 pages \(\d+ coins\), \d+ of them kept from the last whole walk, the walk stopped at page 4: rate-limited and goes on from there/.test(rQ1.note), brief([rQ1.note, st1, st2]));
  check('  ...and tried every 10 minutes for 5 hours while CoinLore keeps refusing, each try goes on from page 4 (never from page 1) and the day\'s walk stops at 20 pages, saying so',
    day2Calls === MD.MCAP.LORE_WALK_MAX && tries.every((t) => t.starts.every((x) => x === 300)) && tries.filter((t) => t.starts.length).length === 16 && tries.slice(16).every((t) => !t.ok && !t.starts.length && /today's 20 walk pages are spent; the walk goes on from page 4 after 00:00 UTC/.test(t.note))
    && canon(loreQ().ids) === canon(day1.ids), brief([day2Calls, tries.slice(14, 18)]));
  clockQ = Date.parse('2026-10-30T00:40:00Z'); const wQ3 = log.length, rQ3 = await mdQ.runJob('mcapRefs'), day3 = loreQ();
  check('  ...the next UTC day, CoinLore answering again, the walk goes on from page 4 to the end of its 20 pages and is whole again', rQ3.ok && walkStarts(wQ3).join() === [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((i) => i * 100).join() && day3.complete === true && day3.walk === null && canon(day3.ids) === canon(day1.ids), brief([rQ3.note, walkStarts(wQ3)]));
  dbQ.close();
  /* CoinLore's 1.1 s pace on a moving clock, with callers at once (the chains run during the walk: each job has its own timer) —
     each takes its slot before it waits, so they queue */
  const dbR = freshDb('r'), mdR = MD.createMarketData({ db: dbR, outboundTake: take, urls: URLS }); mdR.migrate();
  const lr0 = loreAt.length;
  await Promise.all([mdR._test.loreAsk(null, '/ticker/?id=80'), mdR._test.loreAsk(null, '/ticker/?id=90'), mdR._test.loreAsk(null, '/tickers/?start=0&limit=100')]);
  const loreGaps = loreAt.slice(lr0).map((x, i, a) => (i ? x[0] - a[i - 1][0] : null)).slice(1); dbR.close();
  check('CoinLore\'s pace holds with two jobs asking at once: three calls made together on the real clock go out at least 1.1 s apart, one behind the other', loreGaps.length === 2 && loreGaps.every((g) => g >= MD.MCAP.LORE_GAP_MS - 15), brief(loreGaps));
  const dbO = freshDb('o'), mdO = MD.createMarketData({ db: dbO, now: () => NOW_M + 3 * 60e3, outboundTake: take, urls: URLS, sleep: fakeSleep }); mdO.migrate();
  for (const id of ['bitcoin', 'ethereum', 'solana']) { const g = cgRaw(id); dbO.prepare("INSERT INTO mkt_chain_snap (chain, name, at, tvl, native_token, src, mcap_check) VALUES (?, ?, ?, 1, ?, '{}', ?)").run(id, g.name, NOW_M, id, JSON.stringify({ coin: { id, symbol: g.symbol.toUpperCase(), name: g.name, price: g.current_price }, status: 'single', sources: [], notes: [], mapping: { status: 'unchecked' } })); }
  dbO.prepare("INSERT INTO mkt_state (name, value, at) VALUES ('cg_platforms', ?, ?)").run(JSON.stringify({ list: [] }), NOW_M);
  const walkO = log.length, rO = await mdO.runJob('mcapRefs'); dbO.close();
  check('  ...and the walk stops as soon as every chain token is matched (Bitcoin, Ethereum and Solana are all on its first page)', rO.ok && log.slice(walkO).filter((l) => /^GET \/lore\/tickers\//.test(l)).length === 1 && /3 of 3 chain tokens matched over 1 pages/.test(rO.note), rO.note);
  const dbP = freshDb('p'), mdP = MD.createMarketData({ db: dbP, now: () => NOW_M, outboundTake: take, urls: Object.assign({}, URLS, { coinlore: '' }), sleep: fakeSleep }); mdP.migrate();
  const loreP = log.length, rP = await mdP.runJob('chains'), rP2 = await mdP.runJob('mcapRefs');
  const ethP = mdP.chains({ limit: 200 }).body.rows.find((r) => r.key === 'ethereum'); dbP.close();
  check('MARKET_COINLORE_URL set empty turns CoinLore off: nothing is asked of it, the runs and each check say so, and the figure is CoinGecko\'s alone', !log.slice(loreP).some((l) => /\/lore\//.test(l)) && /CoinLore is not read on this server \(MARKET_COINLORE_URL is empty\)/.test(rP.note) && /CoinLore is not read on this server/.test(rP2.note)
    && ethP.mcap.check.status === 'single' && ethP.mcap.check.notes.includes('CoinLore is not read on this server (MARKET_COINLORE_URL is empty)'), brief([rP.note, rP2.note]));
  vendorMode.mcap = false;
  // the budgets, in the server's own table, and the docs
  const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), PRIV = fs.readFileSync(path.join(ROOT, 'public', 'privacy.html'), 'utf8'), ENVX = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  check('the budgets: CoinLore metered at 30 a minute on top of its own 1.1 s pace, at most 20 walk pages a UTC day (the cut-short walk and its retries above stay within it) and 50 ids a read; CoinGecko\'s coins in one read of 250, its shared 20 a minute untouched; the references daily; CoinPaprika read nowhere',
    /'api\.coinlore\.net': 30,/.test(SRC) && /'api\.coingecko\.com': 20,/.test(SRC) && MD.MCAP.LORE_WALK_MAX === 20 && MD.MCAP.LORE_PER_CALL <= 50 && MD.MCAP.CG_PER_CALL === 250 && MD.JOBS.mcapRefs.every === 864e5 && MD.JOBS.mcapRefs.retry >= 3600e3
    && !/api\.coinpaprika\.com|coinpaprika\.com\/v1/.test(LIB + SRC) && /CoinPaprika is NOT read/.test(LIB), '');
  check('  ...and the docs say it: the README (the sources, the cadence, why not CoinPaprika), /data (each chain figure\'s check, and coinlore among the sources), the Privacy Policy §8 (CoinLore read by the server), .env.example (MARKET_COINLORE_URL)',
    /CoinLore/.test(README) && /CoinPaprika/.test(README) && /personal use only/.test(README) && /checked against CoinLore/.test(README)
    && /<code>check<\/code>/.test(DOCS) && /<code>coinlore<\/code>/.test(DOCS) && ['status', 'sources', 'notes', 'mapping', 'agreed', 'differs', 'single', 'none'].every((k) => DOCS.includes(k))
    && /<b>CoinLore<\/b>/.test(PRIV.split('<h2>8.')[1].split('<h2>9.')[0]) && /MARKET_COINLORE_URL/.test(ENVX) && !/^MARKET_COINLORE_URL=$/m.test(ENVX), '');

  /* ── the timetable ── */
  check('the timetable is the contract\'s: pulse 60 s, chains 30 min, radar 10 min (its sweep is the radar\'s full node read), pools 10 min, new pools 3 min (chain) / 15 min (others), others\' pools hourly, histories 6 h, growthepie daily, L2BEAT hourly, re-scan hourly, prune hourly — and a failed DefiLlama run is not retried sooner than DefiLlama refreshes (30 min)',
    MD.JOBS.pulse.every === 60e3 && MD.JOBS.chains.every === 30 * 60e3 && MD.JOBS.radar.every === 10 * 60e3 && MD.JOBS.pools.every === 10 * 60e3 && MD.JOBS.newPoolsRh.every === 3 * 60e3 && MD.JOBS.newPoolsGt.every === 15 * 60e3 && MD.JOBS.poolsOther.every === 3600e3
    && MD.JOBS.chains.retry >= 30 * 60e3 && MD.JOBS.liquidity.retry >= 30 * 60e3 && MD.JOBS.series.retry >= 30 * 60e3
    && MD.JOBS.series.every === 6 * 3600e3 && MD.JOBS.growthepie.every === 864e5 && MD.JOBS.l2beat.every === 3600e3 && MD.JOBS.scans.every === 3600e3 && MD.JOBS.prune.every === 3600e3 && MD.JOBS.mcapRefs.every === 864e5
    && MD.JOBS.rwa.every === 30 * 60e3 && MD.JOBS.rwa.first === 210 && MD.JOBS.rwa.retry === 15 * 60e3);
  check('  ...the RWA job every 30 minutes (first after about 210 s, again 15 minutes after a failed run), each of its parts on its own cadence: the quotes every run, the registry, corporate actions, deviations, stablecoins, DeFi deposits and each RWA\'s pools every 6 h, the directory, the fingerprints\' re-check and the role logs daily',
    /const RWA_EVERY = \{ assets: 6 \* HOUR, actions: 6 \* HOUR, deviations: 6 \* HOUR, chainlink: DAY, stables: 6 \* HOUR, tvl: 6 \* HOUR, connected: 6 \* HOUR, roles: DAY, fingerprint: DAY \};/.test(LIB)
    && /const RWA_GT_MULTI = 7, RWA_GT_POOLS = 4, RWA_TOP = 12, RWA_FP_MAX = 120, RWA_FP_SLICE = 40, RWA_RPC_MAX = 6, RWA_LOG_WINDOW = 10000000, RWA_LOG_WINDOWS = 4, RWA_ETH_CALLS_PER_BATCH = 5;/.test(LIB) && RW.MAX_SUBCALLS === 150 && RW.CONNECTED_FLOOR === 1000);
  check('the collectors start only when asked (MARKET_COLLECT=1, or production unless MARKET_COLLECT=0), and the test runner points every vendor URL at a dead address', /const MKT_COLLECT_ON = process\.env\.MARKET_COLLECT === '1' \|\| \(process\.env\.NODE_ENV === 'production' && process\.env\.MARKET_COLLECT !== '0'\);/.test(SRC) && /if \(MKT_COLLECT_ON\) \{/.test(SRC)
    && ['MARKET_LLAMA_URL', 'MARKET_LLAMA_COINS_URL', 'MARKET_LLAMA_STABLES_URL', 'MARKET_L2BEAT_URL', 'MARKET_GROWTHEPIE_URL', 'MARKET_GT_URL', 'MARKET_DS_URL', 'MARKET_CG_URL', 'MARKET_ETH_RPC_URL', 'MARKET_LOGO_ORIGIN', 'MARKET_COINLORE_URL', 'MARKET_RHJ_URL', 'MARKET_CHAINLINK_URL'].every((k) => new RegExp(k + ": DEAD").test(RUNJS) && SRC.includes('process.env.' + k)) && !/MARKET_COLLECT: '1'/.test(RUNJS));
  check('the server\'s busy signal decays: a minute after the node\'s last refusal, or while the shared pace is queued over 5 s — never "the pace has not sped up yet" (one refusal at boot kept every chain job idle for hours)', /const mktRpcBusy = \(\) => now\(\) - _paceRefusedAt < 60000 \? '[^']*'[^\n]*\n\s*: _paceAt - now\(\) > 5000 \? '/.test(SRC) && /const paceRefused = \(attempt\) => \{ _paceRefusedAt = now\(\);/.test(SRC) && /function paceYield\(\) \{ _paceRefusedAt = now\(\);/.test(SRC) && !/_paceMs > PACE_MS_START/.test(SRC));
  // the shares carved out of GeckoTerminal's 10 a minute, read from the server's own table: they leave the chart switch and the Scanner some in the busiest minute
  const rpmOf = (k) => { const m = SRC.match(new RegExp("'" + k.replace(/[.:]/g, '\\$&') + "': (\\d+),")); return m ? Number(m[1]) : null; };
  check('the server meters each new host and Market Data\'s two shares of GeckoTerminal: the collectors\' 3 and 2 kept for people, which with the name search\'s share stay under the site\'s 10 a minute', rpmOf('market:geckoterminal') === 3 && rpmOf('market:geckoterminal-asked') === 2 && rpmOf('market:rpc') === 12
    && rpmOf('market:geckoterminal') + rpmOf('market:geckoterminal-asked') + rpmOf('search:geckoterminal') < rpmOf('api.geckoterminal.com') && rpmOf('api.geckoterminal.com') === 10
    && /'api\.llama\.fi': 30, 'coins\.llama\.fi': 10, 'stablecoins\.llama\.fi': 20, 'l2beat\.com': 10,/.test(SRC) && /'api\.growthepie\.xyz': 10, 'api\.growthepie\.com': 10,/.test(SRC), brief(['market:geckoterminal', 'market:geckoterminal-asked', 'search:geckoterminal', 'api.geckoterminal.com'].map(rpmOf)));
  // the RWA job's hosts and share, set explicitly (an unknown key would get 60 a minute)
  const rpmIn = (k) => { const m = SRC.match(new RegExp("'" + k.replace(/[.:]/g, '\\$&') + "': (\\d+)")); return m ? Number(m[1]) : null; };
  check('  ...and the RWA job\'s: Robinhood\'s API 20 a minute with Market Data\'s share of 6, Chainlink\'s directory 6 — each named in OUTBOUND_RPM, never the 60 a minute an unknown host would get', rpmIn('api.robinhood.com') === 20 && rpmIn('market:robinhood') === 6 && rpmIn('reference-data-directory.vercel.app') === 6 && /share: RWA_RH_SHARE/.test(LIB) && /const RWA_RH_SHARE = 'market:robinhood';/.test(LIB));
  /* the collectors' average GeckoTerminal spend, from the timetable and the RWA job's caps: pools 10 pages / 10 min, the other networks 24 / h,
     their new pools 8 / 15 min, the RWA job at most 7 multi reads / 30 min and 36 token-pool reads / 6 h (12, each tried up to 3 times) — about 2.3 a minute, under the share of 3 */
  const gtAvg = 10 / 10 + 24 / 60 + 8 / 15 + 7 / 30 + 36 / 360;   // the RWAs' own pools: 12 a round, each tried at most 3 times when it fails
  check('  ...the collectors\' GeckoTerminal spend on average stays under their share of 3 a minute with the RWA job\'s reads (' + gtAvg.toFixed(2) + ' a minute), and the server\'s comment says so', gtAvg < rpmOf('market:geckoterminal') && gtAvg > 2.2 && /about 2\.3 a minute on average with the RWA job's reads/.test(SRC)
    && /const RWA_CODE_MAX = 40, RWA_CODE_REFS = 3, RWA_GT_TRIES = 3;/.test(LIB));

  /* ── the bubble map of the whole crypto market (owner, 2026-10-30: "a view like this that shows a 24 quick visual on the top tokens
     across the whole market"; lib/marketmap.js): its parsers on CoinGecko's and CoinLore's answers of that night, its job (each part read
     when due, in CoinGecko's two-minute slot, kept last-good), its answer and its resource, and the slot in a timetable with the chains
     run and the daily references ── */
  {   // its own names (pl, pm, … are taken above)
  const T_H = Date.parse('2026-10-30T00:30:00Z');
  const pm = MM.parseMarkets(HMX.top, T_H), pg = MM.parseGlobal(HMX.global), ps = MM.parseStables(HMX.stables), pl = MM.parseLore(HMX.lore, T_H);
  const zw = JSON.parse(JSON.stringify(HMX.top)); zw[0].name = '\u200bBit\u200bcoin'; zw[1].symbol = 'eth';
  check('market map: the parsers on the measured answers — CoinGecko\'s 100 largest in its own order (its rank, the symbol in capitals, the name with zero-width characters gone, price, market cap, 24 h change, 24 h volume), its total ($2.593T, updated 00:29:50 UTC), its 25 stablecoin ids kept here, CoinLore\'s 100 (of the 14,993 it lists); an answer that is not a list is not read',
    pm.ok && pm.list.length === 100 && pm.list[0].id === 'bitcoin' && pm.list[0].rank === 1 && pm.list[0].symbol === 'BTC' && pm.list[0].price === 76894 && pm.list[0].mcap === 1545487692438 && pm.list[0].change24h === -5.27397 && pm.list[0].volume24h === 43357519576
    && pm.list.every((c, i) => c.rank === i + 1) && MM.parseMarkets(zw, T_H).list[0].name === 'Bitcoin' && MM.parseMarkets(zw, T_H).list[1].symbol === 'ETH' && Math.round(pg.total) === 2593220316058 && pg.updatedAt === Date.parse('2026-10-30T00:29:50Z')
    && ps.ok && ps.ids.length === 25 && ps.ids.includes('tether') && pl.ok && pl.list.length === 100 && pl.listed === 14993
    && !MM.parseMarkets({ error: 'x' }).ok && !MM.parseMarkets([]).ok && !MM.parseGlobal({ data: {} }).ok && !MM.parseStables(null).ok && !MM.parseLore({ data: null }).ok, brief({ p0: pm.list[0], total: pg.total }));
  // the job, against the fake's /hcg and /hlore, on a clock its waits move
  const dbH = freshDb('h'); let clockH = T_H; const hmTake = [], hmSleeps = [];
  const mdH = MD.createMarketData({ db: dbH, now: () => clockH, outboundTake: (k, w) => { hmTake.push([k, clockH]); return take(k, w); }, urls: Object.assign({}, URLS, { cg: V + '/hcg', coinlore: V + '/hlore' }), bgWaitMs: 1000, askWaitMs: 1000,
    sleep: async (ms) => { hmSleeps.push(ms); clockH += ms; } }); mdH.migrate();
  const hmAsk = (from) => log.slice(from).filter((l) => /^GET \/(hcg|hlore)\//.test(l));
  const vh = '127.0.0.1:' + vendor.address().port;
  // a chains run read CoinGecko 30 s ago: the map's first read waits out the rest of its two minutes, and each part after it waits its own
  mdH._test.stSet('cg_last', { why: 'chains' }, clockH - 30e3);
  const w0 = log.length, t0 = hmTake.length, rH1 = await mdH.runJob('heatmap');
  const asked1 = hmAsk(w0), at1 = hmTake.slice(t0).filter(([k]) => k === vh).map(([, t]) => t);
  const A1 = mdH.heatmap({}).body, st1 = mdH._test.stGet('heatmap').v;
  const cgAt1 = asked1.map((l, i) => [l, at1[i]]).filter(([l]) => /\/hcg\//.test(l)).map(([, t]) => t);
  check('market map: its first run reads CoinGecko\'s top 100, its total and its stablecoins — each in its own two-minute slot (the first after the chains run\'s, 90 s later), never two within two minutes — then CoinLore\'s first 100; every part stored with its read time, the run ok and its note in counts',
    rH1.ok && asked1.length === 4 && /^GET \/hcg\/coins\/markets\?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h$/.test(asked1[0]) && asked1[1] === 'GET /hcg/global'
    && /^GET \/hcg\/coins\/markets\?vs_currency=usd&category=stablecoins&order=market_cap_desc&per_page=250$/.test(asked1[2]) && asked1[3] === 'GET /hlore/tickers/?start=0&limit=100'
    && cgAt1.length === 3 && cgAt1[0] === T_H + 90e3 && cgAt1.every((t, i) => !i || t - cgAt1[i - 1] >= 120e3) && JSON.stringify(hmSleeps.slice(0, 3)) === JSON.stringify([90e3, 120e3, 120e3])
    && st1.coins.readAt === T_H + 90e3 && st1.coins.list.length === 100 && st1.global.total > 2.5e12 && st1.stables.ids.length === 25 && st1.lore.list.length === 100 && /^read: top 100, total market cap, stablecoins, CoinLore; 100 coins, 11 up, 88 down; checked against CoinLore: \d+ agree/.test(rH1.note),
    brief({ asked1, cgAt1, sleeps: hmSleeps.slice(0, 4), note: rH1.note }));
  const R1 = A1.rows, btcH = R1[0], buidl = R1.find((r) => r.id === 'blackrock-usd-institutional-digital-liquidity-fund');
  const direct = pm.list.map((c) => { const cg = Object.assign({}, c, { readAt: T_H }), m = CM.matchCoin(cg, CM.bySymbol(pl.list)); return CM.crossCheck({ sym: c.symbol, cg, lore: m.coin, loreWhy: m.why, now: T_H }).check.status; });
  const MMSRC = fs.readFileSync(path.join(ROOT, 'lib', 'marketmap.js'), 'utf8');
  check('  ...its answer: the 100 in CoinGecko\'s order, each dominance its market cap ÷ CoinGecko\'s total (Bitcoin 59.6%, the total\'s read time on it), 17 stablecoins by CoinGecko\'s category, BUIDL\'s 0% a figure of 0 (the legend\'s "0%"), each market cap\'s check lib/chainmcap.js\'s own — matchCoin and crossCheck reused, not forked: the statuses its functions give on the same answers',
    R1.length === 100 && btcH.id === 'bitcoin' && Math.abs(btcH.dominance.v - (btcH.mcap.v / A1.total.v) * 100) < 1e-9 && Math.abs(btcH.dominance.v - 59.597) < 0.01 && btcH.dominance.at === st1.global.readAt && /^share of CoinGecko's total, \$2\.59T$/.test(btcH.dominance.label)
    && R1.every((r) => r.dominance.v == null || Math.abs(r.dominance.v - (r.mcap.v / A1.total.v) * 100) < 1e-9 * Math.max(1, r.dominance.v)) && R1.filter((r) => r.stable === true).length === 17 && R1.find((r) => r.id === 'tether').stable === true && btcH.stable === false
    && buidl.change24h.v === 0 && !('why' in buidl.change24h) && MM.bucketOf(buidl.change24h.v) === 'flat' && JSON.stringify(R1.map((r) => r.check.status)) === JSON.stringify(direct)
    && /only under another name \(“Binance Coin”/.test(R1.find((r) => r.id === 'binancecoin').check.notes.join(' ')) && R1.find((r) => r.id === 'hyperliquid').check.status === 'differs'
    && /CM\.matchCoin\(/.test(MMSRC) && /CM\.crossCheck\(/.test(MMSRC) && !/0\.1\b|function (matchCoin|crossCheck|sameName|normName)/.test(MMSRC) && A1.legend.length === 10 && A1.counts.drawn === 100 && A1.reads.coins.ok && A1.reads.coinlore.ok,
    brief({ btc: btcH.dominance, statuses: R1.map((r) => r.check.status).join('').slice(0, 40) }));
  // the next run, 10 minutes on: the top 100 and CoinLore only (the total is due every 30 minutes, the stablecoins every 6 hours)
  clockH = st1.lore.readAt + 10 * 60e3; const w2 = log.length; const rH2 = await mdH.runJob('heatmap'); const asked2 = hmAsk(w2);
  clockH += 21 * 60e3; const w3 = log.length; await mdH.runJob('heatmap'); const asked3 = hmAsk(w3);
  check('  ...each part on its own cadence: ten minutes on, the top 100 and CoinLore only; half an hour on, the total again; the stablecoins not for six hours',
    rH2.ok && asked2.length === 2 && /order=market_cap_desc/.test(asked2[0]) && /\/hlore\//.test(asked2[1]) && asked3.length === 3 && asked3[1] === 'GET /hcg/global' && !asked3.some((l) => /category=stablecoins/.test(l)), brief({ asked2, asked3 }));
  // a coin with no 24 h change, and coins with a market cap of 0: CoinLore's figure where it matched, else none (listed, not drawn)
  const top2 = JSON.parse(JSON.stringify(HMX.top)), hz = top2.findIndex((c) => c.id === 'hyperliquid'), tz = top2.findIndex((c) => c.id === 'tron'), fz = top2.findIndex((c) => c.id === 'figure-heloc');
  delete top2[hz].price_change_percentage_24h; top2[tz].market_cap = 0; top2[fz].market_cap = 0;
  hmVendor.top = top2; clockH += 10 * 60e3; await mdH.runJob('heatmap'); hmVendor.top = null;
  clockH += 20e3; const A2 = mdH.heatmap({}).body, hyp = A2.rows.find((r) => r.id === 'hyperliquid'), trx = A2.rows.find((r) => r.id === 'tron'), figr = A2.rows.find((r) => r.id === 'figure-heloc');
  check('  ...a coin CoinGecko gives no 24 h change for is "no change given" — never 0% — and the legend\'s last step; a market cap of 0 is not $0: CoinLore\'s figure where its coin matched (said so, no dominance worked out from it), else none with why — listed, not drawn, and the notes say how many',
    hyp.change24h.v === null && /^no change given/.test(hyp.change24h.why) && MM.bucketOf(hyp.change24h.v) === 'none' && A2.counts.none === 1
    && trx.mcap.src === 'coinlore' && trx.mcap.v > 0 && /CoinLore's market cap — CoinGecko gives none/.test(trx.mcap.label) && trx.dominance.v === null && /not CoinGecko's own/.test(trx.dominance.why)
    && figr.mcap.v === null && /CoinGecko gives no market cap for \$FIGR_HELOC/.test(figr.mcap.why) && figr.dominance.v === null && A2.counts.drawn === 99 && A2.notes.some((n) => /^1 coin has no market cap: listed, not drawn/.test(n)), brief({ hyp: hyp.change24h, trx: trx.mcap, figr: figr.mcap }));
  // keep-last-good: CoinGecko down — the last good coins stay, said so, with when it failed and why
  hmVendor.down = true; clockH += 10 * 60e3; const rH4 = await mdH.runJob('heatmap'); hmVendor.down = false;
  clockH += 20e3; const A4 = mdH.heatmap({}).body, st4 = mdH._test.stGet('heatmap').v;
  check('  ...keep-last-good: when CoinGecko cannot be read the run fails and says why, the last good top 100 stays in place (failAt / failWhy beside it) and the answer says when it failed and that the last good read is used',
    !rH4.ok && /not read: top 100 \(upstream 503\)/.test(rH4.note) && A4.rows.length === 100 && st4.coins.list.length === 100 && st4.coins.failAt > st4.coins.readAt && st4.coins.failWhy === 'upstream 503'
    && A4.reads.coins.ok === false && /^CoinGecko's top 100 coins could not be read at 2026-10-30 \d\d:\d\d UTC \(upstream 503\) — the last good read, from 2026-10-30 \d\d:\d\d UTC, is used$/.test(A4.reads.coins.why), brief({ note: rH4.note, why: A4.reads.coins.why }));
  // the stored reads, older than they may be compared: CoinLore 20 minutes off, the total 3 hours old; the stablecoins never read
  const stOld = JSON.parse(JSON.stringify(st1)); stOld.lore.readAt = stOld.coins.readAt - 20 * 60e3; stOld.global.readAt = stOld.coins.readAt - 3 * 3600e3; delete stOld.stables;
  const noneF = (why, src, at, extra) => Object.assign({ v: null, src: src || 'site', at: at || null, why }, extra || {});
  const BO = MM.buildMap(stOld, { fig: MD.fig, none: noneF });
  check('  ...a CoinLore read more than 15 minutes from CoinGecko\'s is not compared (every check "single", saying why); a total more than 2 hours older than the coins is not divided into them (dominance null, saying when it was read); before the stablecoins category is read, stable is null — never false',
    BO.rows.every((r) => r.check.status === 'single' && r.check.notes.some((n) => /more than 15 minutes from CoinGecko's/.test(n))) && BO.rows.every((r) => r.dominance.v === null && /more than 2 hours before these coins/.test(r.dominance.why)) && BO.rows.every((r) => r.stable === null));
  // the route's cuts and the Send API's resource
  const c50 = mdH.heatmap({ limit: '50', stables: '0' }).body, c5 = mdH.heatmap({ limit: '5' }).body, cx = mdH.heatmap({ limit: 'abc', stables: '7' }).body, cs0 = mdH.heatmap({ stables: '0' }).body;
  const apiH = await mdH.apiResource('heatmap', { limit: '20' }, {});
  check('  ...limit is how many of the largest coins (20 to 100; anything else 100), stables=0 leaves out the stablecoins among them (the top 50 without theirs is 40 rows); the Send API\'s heatmap resource is the same answer with its rows as data',
    c50.rows.length === 40 && c50.limit === 50 && c50.stables === false && c50.rows.every((r) => r.stable === false) && c50.counts.drawn === 39 /* Figure's HELOC, its market cap 0 in the run above */ && c5.rows.length === 20 && c5.limit === 20 && cx.rows.length === 100 && cx.stables === true && cs0.rows.length === 83
    && apiH.status === 200 && apiH.body.data.length === 20 && apiH.body.rows === undefined && apiH.body.legend.length === 10 && apiH.body.total.src === 'coingecko' && mdH.RESOURCES.includes('heatmap'), brief({ c50: c50.rows.length, c5: c5.rows.length, cs0: cs0.rows.length }));
  dump('heatmap', mdH.heatmap({}).body);
  dbH.close();
  // the chains run due within three minutes: the map waits for it (a poll every 15 s, six minutes at most), then reads on its next run
  const dbW = freshDb('w'); const wSleeps = [];
  const mdW = MD.createMarketData({ db: dbW, now: () => T_H, outboundTake: take, urls: Object.assign({}, URLS, { cg: V + '/hcg', coinlore: V + '/hlore' }), bgWaitMs: 1000, askWaitMs: 1000, sleep: async (ms) => { wSleeps.push(ms); } }); mdW.migrate();
  mdW.start({ jobs: ['chains'], staggerMs: 1000 }); const ww = log.length; const rW = await mdW.runJob('heatmap'); mdW.stop();
  check('  ...it never starves the chains run: with that run due within 3 minutes the map waits for it (24 polls of 15 s) and, the run still due, reads nothing from CoinGecko this time and says why',
    !rW.ok && /the chains run, which reads CoinGecko first, was under way or due for six minutes/.test(rW.note) && wSleeps.filter((x) => x === 15000).length === 24 && !hmAsk(ww).some((l) => /\/hcg\//.test(l)), rW.note);
  dbW.close();
  /* the two-minute slot in a timetable: the chains run, the daily references and the map on one clock for four hours, each started when the
     timetable says (the map 10 minutes after its last run ended, the chains run every 30, the references when their day is due), the vendors
     answering at once and every wait a timer on that clock — no two CoinGecko reads within two minutes, ever, and the chains run reading
     CoinGecko itself on every run (never the relay for want of the slot) */
  {
    let clk = NOW_M; const timers = [], cgAt = [], ran = { chains: 0, heatmap: 0, mcapRefs: 0 };
    const sleepT = (ms) => new Promise((ok) => timers.push({ at: clk + ms, ok }));
    const okA = (data) => ({ ok: true, status: 200, data, reason: null });
    const fetchT = async (url) => {
      const u = new URL(url), p = u.pathname, q = u.searchParams;
      if (p.startsWith('/cg/')) cgAt.push([clk, p === '/cg/coins/markets' ? (q.get('ids') ? 'chains' : q.get('category') ? 'stables' : 'top') : p.slice(4)]);
      if (p === '/llama/v2/chains') return okA(MC.chains);
      if (p === '/cg/coins/markets') { if (q.get('ids')) { const want = new Set(q.get('ids').split(',')); return okA(MC.cg.filter((x) => want.has(x.id))); } return okA(q.get('category') ? HMX.stables : HMX.top); }
      if (p === '/cg/global') return okA(HMX.global);
      if (p === '/cg/asset_platforms') return okA(MC.platforms);
      if (p === '/lore/tickers/') { const st = Number(q.get('start') || 0); return okA(st === 0 ? HMX.lore : { data: MC.walk.pages[st] || [], info: MC.walk.info }); }
      return { ok: false, status: 0, data: null, reason: 'unreachable' };
    };
    const dbT = freshDb('t');
    const mdT = MD.createMarketData({ db: dbT, now: () => clk, fetchJson: fetchT, sleep: sleepT, urls: { llama: 'http://t.test/llama', coins: 'http://t.test/coins', stables: 'http://t.test/stables', cg: 'http://t.test/cg', coinlore: 'http://t.test/lore' } }); mdT.migrate();
    const due = { chains: clk + 25e3, heatmap: clk + 30e3, mcapRefs: clk + 215e3 }, end = clk + 4 * 3600e3, nextAtT = mdT._test.nextAt, busy = new Set();
    const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
    let steps = 0;
    while (clk < end && steps++ < 50000) {
      for (const [job, at] of Object.entries(due)) nextAtT.set(job, at);
      for (const [job, at] of Object.entries(due)) {
        if (at > clk || busy.has(job)) continue;
        ran[job]++; busy.add(job); due[job] = Infinity; nextAtT.set(job, Infinity);
        mdT.runJob(job).then((r) => { busy.delete(job); due[job] = clk + (r.ok ? MD.JOBS[job].every : Math.min(MD.JOBS[job].every, MD.JOBS[job].retry)); });
      }
      await flush();
      timers.sort((a, b) => a.at - b.at);
      const nt = Math.min(timers.length ? timers[0].at : Infinity, ...Object.values(due));
      if (!isFinite(nt)) break;
      clk = Math.max(clk, nt);
      while (timers.length && timers[0].at <= clk) { timers.shift().ok(); await flush(); timers.sort((a, b) => a.at - b.at); }
    }
    const gaps = cgAt.slice(1).map(([t], i) => t - cgAt[i][0]), kinds = (k) => cgAt.filter(([, x]) => x === k).length;
    check('  ...and in a timetable — the chains run, the daily references and the map on one clock for four hours — no two CoinGecko reads within two minutes, ever; the chains run reads CoinGecko itself on every run; the map reads its top 100 on most of its runs, its total every half hour, its stablecoins once',
      steps < 50000 && cgAt.length > 20 && gaps.every((g) => g >= 120e3) && kinds('chains') === ran.chains && ran.chains >= 7 && kinds('top') >= ran.heatmap - 3 && ran.heatmap >= 14 && kinds('global') >= 7 && kinds('stables') === 1 && kinds('asset_platforms') >= 1,
      brief({ ran, n: cgAt.length, minGap: Math.min(...gaps), kinds: ['chains', 'top', 'global', 'stables', 'asset_platforms'].map(kinds) }));
    dbT.close();
  }
  check('  ...the map\'s job in the timetable: every 10 minutes, first just after the chains run, again 10 minutes after a failed run; its total every 30 minutes and its stablecoins every 6 hours; every CoinGecko read in the shared two-minute slot (cg_last) — the chains run\'s, the references\' and the map\'s',
    MD.JOBS.heatmap.every === 10 * 60e3 && MD.JOBS.heatmap.first === 30 && MD.JOBS.heatmap.first > MD.JOBS.chains.first && MD.JOBS.heatmap.retry === 10 * 60e3 && /const HM_EVERY = \{ global: 30 \* MIN, stables: 6 \* HOUR \}, HM_POLL = 15000, HM_POLLS = 24, HM_SLOT_MAX = 4 \* MIN;/.test(LIB)
    && /stSet\('cg_last', \{ why: job \}, now\(\) \+ wait\);/.test(LIB) && /const slot = await cgSlot\('heatmap'\);\s+if \(!slot\.ok\)[^\n]+\n\s+const r = await ask\(ctx, urls\.cg \+ path/.test(LIB));
  // the docs: /data names the resource and every key it returns; the README says what the map is and how it is read; the Privacy Policy §8
  const hmDoc = DOCS.includes('/api/data/v1/heatmap') ? DOCS.slice(DOCS.indexOf('/api/data/v1/heatmap')).split('</details>')[0] : '';
  const hmKeys = [...new Set([...Object.keys(A1), ...Object.keys(A1.rows[0]), ...Object.keys(A1.rows[0].check), ...Object.keys(A1.reads)])].filter((k) => k !== 'rows');
  const README_H = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), PRIV_H = fs.readFileSync(path.join(ROOT, 'public', 'privacy.html'), 'utf8'), P8 = PRIV_H.split('<h2>8.')[1] || '';
  check('  ...and the docs: /data documents the heatmap resource with every key it returns (data, the figures, the check, the reads, the legend); the README says what the map is, its sources and cadence and the CoinGecko pacing; the Privacy Policy §8 names the top coins among what CoinGecko and CoinLore are asked for',
    !!hmDoc && ['data'].concat(hmKeys).every((k) => new RegExp('\\b' + k + '\\b').test(hmDoc)) && /<code>heatmap<\/code>/.test(DOCS) && /bubble map/i.test(README_H) && /`heatmap`/.test(README_H) && /two-minute slot|two minutes/.test(README_H.slice(README_H.indexOf('bubble map')))
    && /<b>CoinLore<\/b> \([^)]*the top coins by market cap/.test(P8) && /<b>CoinGecko<\/b> and its <b>GeckoTerminal<\/b> \([^)]*the top coins by market cap/.test(P8), hmKeys.filter((k) => !new RegExp('\\b' + k + '\\b').test(hmDoc)).join(','));
  }
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
  MARKET_DS_URL: URLS.ds, MARKET_CG_URL: URLS.cg, MARKET_ETH_RPC_URL: URLS.ethRpc, MARKET_LOGO_ORIGIN: V + '/img', MARKET_GROWTHEPIE_METRICS_URL: URLS.growthepieMetrics, MARKET_COINLORE_URL: URLS.coinlore,
  MARKET_RHJ_URL: URLS.rhj, MARKET_CHAINLINK_URL: URLS.chainlink,
  MARKET_COLLECT: '1', MARKET_JOBS: 'pulse,chains,l2beat,liquidity,pools,newPoolsRh,radar,rwa', MARKET_STAGGER_MS: '40',
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
  const want = ['pulse', 'chains', 'l2beat', 'liquidity', 'pools', 'newPoolsRh', 'radar', 'rwa'];
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
  check('GET /api/market/search, /new-pools; an unknown market endpoint is a 404 that lists them', sr.status === 200 && sr.j.tokens[0].address === USDG && np.status === 200 && np.j.rows.length === 5 && no.status === 404 && /chains, chain, tokens, token, scan, search, new-pools, status, logo, rwa, rwa\/token, heatmap/.test(no.j.error));
  /* the bubble map through the route (its job is not among this server's MARKET_JOBS — it would wait out CoinGecko's two minutes behind the
     chains run's read: its store is seeded as the job keeps it, from CoinGecko's and CoinLore's answers of 2026-10-30) */
  const hmNow = Date.now(), hmSeed = { coins: MM.parseMarkets(HMX.top, hmNow), global: MM.parseGlobal(HMX.global), stables: MM.parseStables(HMX.stables), lore: MM.parseLore(HMX.lore, hmNow) };
  sdb.prepare("INSERT INTO mkt_state (name, value, at) VALUES ('heatmap', ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, at = excluded.at")
    .run(JSON.stringify(Object.fromEntries(Object.entries(hmSeed).map(([k, x]) => { const o = Object.assign({ readAt: hmNow }, x); delete o.ok; return [k, o]; }))), hmNow);
  // asked as a visitor of its own (the server trusts a loopback proxy here): the status polls above spend most of this connection's 120 a minute
  const asVisitor = async (p) => { const r = await fetch(B + p, { headers: { 'X-Forwarded-For': '203.0.113.30' } }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j, cc: r.headers.get('cache-control') || '' }; };
  const hm = await asVisitor('/api/market/heatmap'), hm50 = await asVisitor('/api/market/heatmap?limit=50&stables=0');
  check('GET /api/market/heatmap: the bubble map\'s 100 coins with the total, the counts, the reads and the legend (no-store, at the routes\' 120 a minute); limit=50&stables=0 the top 50 without their stablecoins',
    hm.status === 200 && hm.j.rows.length === 100 && hm.j.rows[0].id === 'bitcoin' && Math.abs(hm.j.rows[0].dominance.v - 59.597) < 0.01 && hm.j.total.src === 'coingecko' && hm.j.legend.length === 10 && hm.j.reads.coins.ok === true && /no-store/.test(hm.cc)
    && hm50.status === 200 && hm50.j.rows.length === 40 && hm50.j.limit === 50 && hm50.j.stables === false, brief({ s: hm.status, n: hm.j && hm.j.rows && hm.j.rows.length, n50: hm50.j && hm50.j.rows && hm50.j.rows.length }));
  // the RWA tab, through the routes (the RWA job ran once, on the server's own timer, against the fakes)
  const ra = await api('/api/market/rwa'), rt = await api('/api/market/rwa?view=tokens&sort=tvl&dir=asc&kind=stock&issuer=rhj&limit=5'), rc = await api('/api/market/rwa?view=connected'), rs = await api('/api/market/rwa?view=stables');
  check('GET /api/market/rwa: Top RWAs by value on chain, the totals, the reads, the definitions — no-store; view, sort, dir, kind, issuer and limit as asked; the connected and stablecoin views', ra.status === 200 && ra.j.view === 'assets' && ra.j.rows.length > 0 && ra.j.totals && ra.j.reads.registry.ok === true && typeof ra.j.definitions.tvl === 'string' && /no-store/.test(ra.cc)
    && rt.status === 200 && rt.j.view === 'tokens' && rt.j.sort === 'tvl' && rt.j.dir === 'asc' && rt.j.kind === 'stock' && rt.j.issuer === 'rhj' && rt.j.rows.length <= 5 && rt.j.rows.every((r) => r.issuer.key === 'rhj' && r.underlying.kind === 'stock')
    && rc.status === 200 && rc.j.view === 'connected' && typeof rc.j.belowFloor === 'number' && rs.status === 200 && rs.j.rows.some((r) => r.symbol === 'USDG'), brief({ a: ra.j && ra.j.reads, t: rt.j && rt.j.rows.map((r) => r.symbol) }));
  const rk = await api('/api/market/rwa/token?address=' + TSLA), rk4 = await api('/api/market/rwa/token?address=0x4a0ade17fa7602bdfc7d2a9c85f404328687c92d'), rk0 = await api('/api/market/rwa/token?address=nope'), tkR = await api('/api/market/token?chain=robinhood&address=' + TSLA);
  check('GET /api/market/rwa/token: TSLA\'s facts (confirmed, the issuer\'s controls read on the chain); "Not My Stock" a 404 { notRwa, why }; a bad address a 400 — at 30 a minute per visitor; and /api/market/token carries TSLA\'s RWA row',
    rk.status === 200 && rk.j.address === TSLA && rk.j.confidence === 'confirmed' && rk.j.controls.registry === REGISTRY && Array.isArray(rk.j.roles) && rk4.status === 404 && rk4.j.notRwa === true && typeof rk4.j.why === 'string' && rk0.status === 400
    && /rateLimit\('mktrwa:' \+ clientIp\(req\), 30, 6e4\)/.test(SRC) && tkR.status === 200 && tkR.j.rwa && tkR.j.rwa.address === TSLA, brief({ rk: rk.j && rk.j.confidence, rk4: rk4.j, tk: tkR.j && tkR.j.rwa && tkR.j.rwa.symbol }));
  /* the Scanner's dashboard reads p.rwa: the profile the token popup gets (/api/pairs/lookup) carries the RWA facts Market Data keeps — a
     lookup, not a read. Two profiles seeded in the token cache (checked just now, so nothing re-reads them): TSLA and $SEND */
  const prof = (addr, sym) => JSON.stringify({ token: { address: addr, symbol: sym, name: sym, decimals: 18, deployer: null }, pair: { address: '0x' + '9a'.repeat(20), quoteSymbol: 'USDG', createdAt: Date.now() - 864e5 },
    market: { priceUsd: 1, liquidityUsd: 1000, fdv: 1, marketCap: null }, volume: { h24: 1 }, txns: { h24: { buys: 1, sells: 1 } }, priceChange: {}, holders: {}, indexed: true, risk: { health: 50, triage: 'caution' } });
  const tcIns = sdb.prepare('INSERT OR REPLACE INTO token_cache (token_addr, pair_json, symbol, name, found, updated_at, last_read_at, reads, checked_at) VALUES (?,?,?,?,1,?,?,0,?)');
  tcIns.run(TSLA, prof(TSLA, 'TSLA'), 'TSLA', 'TSLA', Date.now(), Date.now(), Date.now() + 2 * 3600e3); tcIns.run(SEND, prof(SEND, 'SEND'), 'SEND', 'SEND', Date.now(), Date.now(), Date.now() + 2 * 3600e3);
  const lkT = await api('/api/pairs/lookup?token=' + TSLA), lkS = await api('/api/pairs/lookup?token=' + SEND);
  check('the token profile the Scanner\'s dashboard draws carries p.rwa — TSLA\'s RWA facts (confirmed, the issuer\'s controls) — and p.rwa null for a token that is not an RWA ($SEND); nothing stored with the profile',
    lkT.status === 200 && lkT.j.pair.rwa && lkT.j.pair.rwa.address === TSLA && lkT.j.pair.rwa.confidence === 'confirmed' && lkT.j.pair.rwa.controls.registry === REGISTRY && lkS.status === 200 && lkS.j.pair.rwa === null
    && !/"rwa"/.test(sdb.prepare('SELECT pair_json FROM token_cache WHERE token_addr = ?').get(TSLA).pair_json), brief({ t: lkT.j && lkT.j.pair && lkT.j.pair.rwa && lkT.j.pair.rwa.confidence, s: lkS.j && lkS.j.pair && lkS.j.pair.rwa }));
  // the "GameStop" memecoin ($GME, not Robinhood's): its own profile carries the lookalike answer, so its dashboard says it is not the RWA
  tcIns.run(GME_MEME, prof(GME_MEME, 'GME'), 'GME', 'GME', Date.now(), Date.now(), Date.now() + 2 * 3600e3);
  const lkG = await api('/api/pairs/lookup?token=' + GME_MEME);
  check('  ...and a token that only shares an RWA\'s ticker (the "GameStop" memecoin, $GME) carries the 404 that says so — { notRwa, why: "Same ticker as $GME, but not issued by Robinhood Assets (Jersey) …" }',
    lkG.status === 200 && lkG.j.pair.rwa && lkG.j.pair.rwa.notRwa === true && /^Same ticker as \$GME, but not issued by Robinhood Assets \(Jersey\) — the registry lists \$GME at /.test(lkG.j.pair.rwa.why), brief(lkG.j && lkG.j.pair && lkG.j.pair.rwa));

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
  const dall = await Promise.all(['chain?key=robinhood', 'tokens?chain=robinhood', 'tokens?chain=all', 'token?chain=robinhood&address=' + USDG, 'pools?network=robinhood&limit=3', 'new-pools?limit=3', 'radar', 'pulse?limit=2', 'collectors', 'rwa?view=tokens', 'rwa-token?address=' + TSLA, 'heatmap?limit=20'].map((r) => api('/api/data/v1/' + r, { key })));
  const dunk = await api('/api/data/v1/nope', { key });
  check('  ...every one of the new resources answers, and the unknown-resource error lists them all', dall.every((r) => r.status === 200 && r.j && (r.j.data !== undefined)) && dunk.status === 404 && ['chains', 'chain-history', 'chain-snapshots', 'new-pools', 'radar', 'scans', 'pulse', 'collectors', 'competition', 'rwa', 'rwa-token', 'heatmap'].every((n) => dunk.j.error.includes(n)) && dall[dall.length - 1].j.data.length === 20,
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
