/* ===== One honest identity, and no keyless explorer (owner, 2026-10-27: "yes switch the scanner to the honest identity too") =====
   The server used to read the feeds, the logos and the image proxy with a Chrome User-Agent, and to read
   robinhoodchain.blockscout.com without a key whenever a member opened the Scanner, a token's dashboard or the New Pairs radar.
   Now every request it makes says it is the site (HONEST_UA, Market Data's own), and the explorer's API is asked only when
   BLOCKSCOUT_URL points at a keyed endpoint. What the explorer alone gave is said as not read — never a 0, never a guess.

     1. The source: no browser string anywhere in server.js or lib/*.js, and every User-Agent the server sets is the one identity.
     2. A server of its own with NO key, every upstream faked: the chain node a local fake; Dexscreener and GoPlus answered by a
        guard loaded before server.js, which also refuses — and records, with the User-Agent — anything else that would leave this
        machine. A member's scan, a token dashboard read, the contract read, the radar build, the deployer's trades on the chart,
        the tracker's explorer route and a community holder snapshot: zero requests to the explorer, every request as the site,
        the figures the explorer gave either from the chain / GoPlus (named) or null with the reason — and the page renders them
        without "undefined", and without a green verdict for a contract nobody read. Two of those nulls are only honest if they
        say the right thing: a pool the node would not read is "could not be read just now" (asked again next time), never
        "that pool does not hold this token"; and a snapshot that read no holders says so, never "0 holders".
     3. The same server WITH a key (BLOCKSCOUT_URL at a fake keyed explorer): the explorer's reads happen as before, as the site.
   Everything lives in a temporary directory, deleted. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { ROOT, SERVER_JS } from './_paths.mjs';
const require = createRequire(import.meta.url);
const HONEST = require(path.join(ROOT, 'lib', 'marketdata.js')).HONEST_UA;

const SRC = fs.readFileSync(SERVER_JS, 'utf8');
const LIBS = fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => f.endsWith('.js')).map((f) => [f, fs.readFileSync(path.join(ROOT, 'lib', f), 'utf8')]);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const brief = (o) => JSON.stringify(o === undefined ? null : o).slice(0, 500);

/* ═══ 1. THE SOURCE ═══ */
{
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('no browser User-Agent string is left in server.js or any lib/*.js, and no BROWSER_UA', !/Mozilla\//.test(SRC) && !/BROWSER_UA/.test(SRC) && LIBS.every(([, s]) => !/Mozilla\//.test(s) && !/BROWSER_UA/.test(s)), LIBS.filter(([, s]) => /Mozilla\//.test(s)).map(([f]) => f).join());
  const uas = [...code(SRC).matchAll(/'User-Agent':\s*([A-Za-z_][\w.]*)/g)].map((m) => m[1]);
  check('every User-Agent server.js sets is the one identity (HONEST_UA, or the stock quote\'s, which is HONEST_UA saying what it asks for)', uas.length >= 14 && uas.every((u) => u === 'HONEST_UA' || u === 'QUOTE_UA')
    && /const HONEST_UA = require\('\.\/lib\/marketdata\.js'\)\.HONEST_UA;/.test(SRC) && /const QUOTE_UA = HONEST_UA\.replace\(/.test(SRC), uas.join());
  check('  ...and no outbound fetch in server.js goes without one (the sign-in providers, Sendy\'s model, the Telegram bot, the CDN purge and Google Analytics included)',
    /api\.anthropic\.com\/v1\/messages[\s\S]{0,200}'User-Agent': HONEST_UA/.test(SRC) && /api\.telegram\.org\/bot[\s\S]{0,160}'User-Agent': HONEST_UA/.test(SRC) && /purge_cache[\s\S]{0,200}'User-Agent': HONEST_UA/.test(SRC)
    && /const headers = \{ 'Content-Type': 'application\/x-www-form-urlencoded', 'User-Agent': HONEST_UA \};/.test(SRC) && /fetch: \(u, o\) => fetch\(u, \{ \.\.\.o, headers: \{ \.\.\.\(\(o && o\.headers\) \|\| \{\}\), 'User-Agent': HONEST_UA \}/.test(SRC));
  const libUas = LIBS.flatMap(([f, s]) => [...code(s).matchAll(/'User-Agent':\s*([^,}]+)/g)].map((m) => f + ':' + m[1].trim()));
  check('  ...and the libraries that make requests send the identity they are given (multichain, swapkit) or Market Data\'s own — no other', libUas.every((x) => /^(multichain|swapkit)\.js:String\(deps\.userAgent\)$/.test(x) || /^marketdata\.js:ua$/.test(x))
    && /userAgent: HONEST_UA \}\)\);/.test(SRC) && /mc: mc\(\), ethUsd, take: outboundTake, now, userAgent: HONEST_UA,/.test(SRC), libUas.join(' | '));
  check('the keyless explorer is refused at the one reader every vendor read goes through, whoever builds the URL — before our own meter, so it is never even counted',
    (SRC.match(/if \(host && host === EXPLORER_HOST && !EXPLORER_KEYED\) return \{ ok: false, data: null, reason: EXPLORER_UNKEYED \};/g) || []).length === 2
    && /function explorerGet\(apiPath, ttl\) \{ return EXPLORER_KEYED \? jgetCached\(BLOCKSCOUT \+ apiPath, ttl\) : Promise\.resolve\(null\); \}/.test(SRC)
    && /async function runSnapshot\(snapId, cid, token\) \{\s*if \(!EXPLORER_KEYED\) return runLedgerSnapshot\(snapId, cid, token\);/.test(SRC));
}

/* ═══ 1b. THE DOCS say the same ═══ */
{
  const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const PRIV = R('public/privacy.html'), ENV = R('.env.example'), DEP = R('DEPLOY.md'), DATA = R('public/data.html'), README = R('README.md');
  check('the privacy policy names the explorer as read only with a key, and says every request names the site — and its version moved for it',
    /and from the Blockscout explorer only when the operator has given the server a key for it/.test(PRIV) && /every one says it comes from this site \(it names JustSendIt and sendrh\.com\) — none pretends to be a browser/.test(PRIV) && /Version 2026-10-27 · \$Send \/ JustSendIt/.test(PRIV));
  check('  ...and .env.example, DEPLOY.md, the Data API docs and the README say the explorer is not asked without BLOCKSCOUT_URL, and what comes from where instead',
    /with BLOCKSCOUT_URL unset its API is not asked at all/.test(ENV) && /"JustSendIt\/1\.0 \(\+https:\/\/sendrh\.com\)"/.test(ENV) && /with `BLOCKSCOUT_URL` unset the site does not ask the explorer anything at all/.test(DEP)
    && /with none set it is not asked at all/.test(DATA) && /With `BLOCKSCOUT_URL` unset the explorer's API is not asked at all/.test(README) && !/JustSendIt\/1\.0 \(\+BASE_URL\)/.test(ENV));
}

/* ═══ 2–3. A SERVER OF ITS OWN ═══ */
const A = (h) => '0x' + h.repeat(20);
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73', FACTORY = '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f';
const PAIRCREATED = '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9', TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO = '0x' + '0'.repeat(40), DEAD = '0x000000000000000000000000000000000000dead';
const TOKA = A('a1'), TOKB = A('b2'), TOKC = A('c3'), TOKD = A('d4'), PA = A('1a'), PB = A('2b'), PC = A('3c'), PD = A('4d'), PE = A('2c');
const CREATOR = A('5e'), CREATOR2 = A('5f'), OWNER = A('6f'), H1 = A('71'), H2 = A('72'), H3 = A('73'), WALLET = A('7e');
const HEAD = 100000000, E18 = 10n ** 18n;
const NAMES = { [TOKA]: ['Token A', 'TOKA'], [TOKB]: ['Token B', 'TOKB'], [TOKC]: ['Token C', 'TOKC'], [TOKD]: ['Token D', 'TOKD'] };
const PAIRS = { [PA]: TOKA, [PB]: TOKB, [PC]: TOKC, [PD]: TOKD, [PE]: TOKB };   // PE: a second pool of Token B, whose LP reads like A's
const hx = (n) => '0x' + BigInt(n).toString(16);
const w256 = (hex) => String(hex).replace(/^0x/, '').padStart(64, '0');
const topic = (a) => '0x' + w256(a);
const abiStr = (s) => '0x' + w256('20') + w256(s.length.toString(16)) + Buffer.from(s).toString('hex').padEnd(64, '0');
/* the tokens' Transfer logs: Token A minted to its creator, liquidity added, a buy by H1, the creator's own buy and sell
   (creator 630, pool 270, H1 100 of 1,000); Token C held by two wallets */
const tlog = (tok, b, i, from, to, v) => ({ address: tok, blockNumber: hx(b), logIndex: hx(i), transactionHash: '0x' + createHash('sha256').update(tok + b + i).digest('hex'), removed: false,
  topics: [TRANSFER, topic(from), topic(to)], data: '0x' + w256((BigInt(v) * E18).toString(16)) });
const TLOGS = [tlog(TOKA, HEAD - 500, 0, ZERO, CREATOR, 1000), tlog(TOKA, HEAD - 490, 0, CREATOR, PA, 400), tlog(TOKA, HEAD - 400, 1, PA, H1, 100),
  tlog(TOKA, HEAD - 300, 2, PA, CREATOR, 50), tlog(TOKA, HEAD - 200, 3, CREATOR, PA, 20),
  tlog(TOKC, HEAD - 450, 0, ZERO, H2, 600), tlog(TOKC, HEAD - 449, 0, ZERO, H3, 400)];
const pairLog = (pair, t0, t1, b) => ({ address: FACTORY, blockNumber: hx(b), logIndex: '0x0', transactionHash: '0x' + createHash('sha256').update(pair).digest('hex'), topics: [PAIRCREATED, topic(t0), topic(t1)], data: '0x' + w256(pair) + w256('5') });
const PLOGS = [pairLog(PA, TOKA, WETH, HEAD - 495), pairLog(PB, TOKB, WETH, HEAD - 395), pairLog(PD, TOKD, WETH, HEAD - 95)];

// the chain node: every request recorded with its User-Agent
const node = { reqs: [], refuse: new Set(), refused: 0 };   // refuse: pools whose token0()/token1() the node answers 429 to, as the public node does in a burst
function nodeAnswer(m, p) {
  const a0 = (p && p[0]) || {};
  if (m === 'eth_blockNumber') return hx(HEAD);
  if (m === 'eth_chainId') return '0x1233';
  if (m === 'eth_getBlockByNumber') return { number: p[0], timestamp: hx(Math.floor(Date.now() / 1000) - 3600), baseFeePerGas: '0x1' };
  if (m === 'eth_getCode') return '0x';
  if (m === 'eth_getLogs') {
    const from = parseInt(a0.fromBlock, 16), to = parseInt(a0.toBlock, 16), addr = String(a0.address || '').toLowerCase(), tp = a0.topics || [];
    const pool = addr === FACTORY ? PLOGS : TLOGS;
    return pool.filter((l) => (!addr || l.address === addr) && tp.every((t, i) => t == null || l.topics[i] === t) && parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to);
  }
  if (m === 'eth_call') {
    const to = String(a0.to || '').toLowerCase(), d = String(a0.data || '');
    if (to === FACTORY && d.startsWith('0xe6a43905')) { const x = '0x' + d.slice(34, 74), y = '0x' + d.slice(98, 138); return '0x' + w256([x, y].includes(TOKC) && [x, y].includes(WETH) ? PC : ZERO); }
    if (PAIRS[to]) {
      if (node.refuse.has(to) && (d === '0x0dfe1681' || d === '0xd21220a7')) return node.refused++, { error: { code: 429, message: 'Too Many Requests' } };
      if (d === '0x0dfe1681') return '0x' + w256(PAIRS[to]);
      if (d === '0xd21220a7') return '0x' + w256(WETH);
      if (d === '0x0902f1ac') return '0x' + w256((270n * E18).toString(16)) + w256((3n * E18 / 10n).toString(16)) + w256('1');
      // Token A's LP: 1,000, of which 900 at 0x…dEaD and the 1,000-wei minimum at zero; the other pools' LP cannot be read
      if (d === '0x18160ddd') return to === PA || to === PE ? '0x' + w256((1000n * E18).toString(16)) : '0x';
      if (d.startsWith('0x70a08231')) { const who = '0x' + d.slice(-40); return '0x' + w256(who === DEAD ? (900n * E18).toString(16) : who === ZERO ? '3e8' : '0'); }
      return '0x';
    }
    if (NAMES[to]) {
      if (d === '0x06fdde03') return abiStr(NAMES[to][0]);
      if (d === '0x95d89b41') return abiStr(NAMES[to][1]);
      if (d === '0x313ce567') return '0x' + w256('12');
      if (d === '0x18160ddd') return '0x' + w256((1000n * E18).toString(16));
      if (d === '0x8da5cb5b') return to === TOKA ? '0x' + w256(OWNER) : to === TOKB ? '0x' + w256(DEAD) : '0x';   // A: a live owner; B: owner() at 0x…dEaD; the others no owner()
      if (d.startsWith('0x70a08231')) return '0x' + w256('0');
    }
    return '0x';
  }
  return { error: { code: -32601, message: 'not served by this fake' } };
}
const nodeSrv = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let j = null; try { j = JSON.parse(body); } catch {}
    node.reqs.push({ ua: String(req.headers['user-agent'] || ''), calls: Array.isArray(j) ? j.map((c) => c.method) : [j && j.method] });
    const one = (c) => { const r = nodeAnswer(c.method, c.params); return r && r.error ? { jsonrpc: '2.0', id: c.id, error: r.error } : { jsonrpc: '2.0', id: c.id, result: r }; };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Array.isArray(j) ? j.map(one) : j ? one(j) : { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }));
  });
});
await new Promise((ok) => nodeSrv.listen(0, '127.0.0.1', ok));
nodeSrv.unref();
const NODE = 'http://127.0.0.1:' + nodeSrv.address().port + '/';

// the keyed explorer (part 3): a fake of Blockscout's v2 API under /bs, every request recorded with its User-Agent
const bs = { reqs: [] };
const BS_ANS = {
  ['/api/v2/tokens/' + TOKC]: { name: 'Token C', symbol: 'TOKC', decimals: '18', total_supply: (1000n * E18).toString(), holders_count: '2' },
  ['/api/v2/addresses/' + TOKC]: { hash: TOKC, is_contract: true, is_verified: true, creator_address_hash: CREATOR2 },
  ['/api/v2/smart-contracts/' + TOKC]: { is_verified: true, name: 'TokenC', source_code: 'contract TokenC { function mint(address to, uint256 a) external onlyOwner {} }' },
  ['/api/v2/tokens/' + PC]: { total_supply: (1000n * E18).toString() },
  ['/api/v2/addresses/' + WALLET]: { hash: WALLET, coin_balance: '0' },
};
const vendor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  bs.reqs.push({ path: u.pathname + u.search, ua: String(req.headers['user-agent'] || '') });
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const p = u.pathname.replace(/^\/bs/, '');
  if (p === '/api/v2/tokens/' + TOKC + '/holders') return send(200, { items: [{ address: { hash: H2 }, value: (600n * E18).toString() }, { address: { hash: H3 }, value: (400n * E18).toString() }], next_page_params: null });
  if (p === '/api/v2/tokens/' + PC + '/holders') return send(200, { items: [{ address: { hash: DEAD, name: null }, value: (900n * E18).toString() }], next_page_params: null });
  if (BS_ANS[p]) return send(200, BS_ANS[p]);
  send(404, { message: 'Not found' });
});
await new Promise((ok) => vendor.listen(0, '127.0.0.1', ok));
vendor.unref();
const V = 'http://127.0.0.1:' + vendor.address().port;

/* The guard, loaded before server.js: Dexscreener and GoPlus are read at fixed addresses, so it answers them itself (Token A and
   B listed; GoPlus has a full reading of A and nothing for the rest); everything else that would leave this machine is refused
   like a dead address. Every attempt is written to stderr with the User-Agent it carried. */
const dsPair = (pair, tok, liq) => ({ chainId: 'robinhood', dexId: 'uniswap', url: 'https://dexscreener.com/robinhood/' + pair, pairAddress: pair,
  baseToken: { address: tok, name: NAMES[tok][0], symbol: NAMES[tok][1] }, quoteToken: { address: WETH, name: 'Wrapped Ether', symbol: 'WETH' },
  priceUsd: '0.0123', liquidity: { usd: liq }, fdv: 12300, marketCap: 12000, volume: { m5: 10, h1: 100, h6: 500, h24: 2000 },
  txns: { h1: { buys: 5, sells: 4 }, h6: { buys: 12, sells: 10 }, h24: { buys: 30, sells: 25 } }, priceChange: { h1: 1, h6: 2, h24: 3 }, pairCreatedAt: Date.now() - 2 * 3600e3 });
const DS = { [TOKA]: dsPair(PA, TOKA, 45678), [TOKB]: dsPair(PB, TOKB, 23456) };
const no = '0';
const GP = { [TOKA]: { is_open_source: '1', is_honeypot: no, is_mintable: no, is_blacklisted: no, transfer_pausable: no, can_take_back_ownership: no, hidden_owner: no, is_proxy: no,
  owner_change_balance: no, slippage_modifiable: no, personal_slippage_modifiable: no, anti_whale_modifiable: no, is_anti_whale: no, trading_cooldown: no, cannot_sell_all: no, cannot_buy: no,
  selfdestruct: no, external_call: no, is_whitelisted: no, buy_tax: '0', sell_tax: '0', holder_count: '3', owner_address: OWNER, creator_address: CREATOR,
  holders: [{ address: CREATOR, percent: '0.63', is_contract: 0, is_locked: 0 }, { address: PA, percent: '0.27', is_contract: 1, is_locked: 0 }, { address: H1, percent: '0.1', is_contract: 0, is_locked: 0 }],
  lp_holder_count: '2', lp_total_supply: '1000', dex: [{ name: 'UniswapV2', pair: PA }],
  lp_holders: [{ address: DEAD, percent: '0.9', is_locked: 1, is_contract: 0 }, { address: CREATOR, percent: '0.1', is_locked: 0, is_contract: 0 }] } };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-honestua-'));
fs.writeFileSync(path.join(dataDir, '.data_key'), randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
const GUARD = path.join(dataDir, 'netguard.mjs');
fs.writeFileSync(GUARD, `const real = globalThis.fetch;
const DS = ${JSON.stringify(DS)}, GP = ${JSON.stringify(GP)};
const answer = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  let u = null; try { u = new URL(url); } catch {}
  if (u && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return real.call(this, input, init);
  const h = (init && init.headers) || {};
  const ua = typeof h.get === 'function' ? h.get('user-agent') : (h['User-Agent'] || h['user-agent'] || null);
  process.stderr.write('NETGUARD ' + JSON.stringify({ to: u ? u.host + u.pathname : url, ua }) + '\\n');
  if (u && u.host === 'api.dexscreener.com' && u.pathname.startsWith('/tokens/v1/robinhood/')) return answer(u.pathname.split('/').pop().toLowerCase().split(',').map((a) => DS[a]).filter(Boolean));
  if (u && u.host === 'api.dexscreener.com') return answer({ schemaVersion: '1.0.0', pairs: null });
  if (u && u.host === 'api.gopluslabs.io') { const a = String(u.searchParams.get('contract_addresses') || '').toLowerCase(); return answer({ code: 1, message: 'OK', result: GP[a] ? { [a]: GP[a] } : {} }); }
  throw new TypeError('fetch failed');
};
`);
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
let PORT = await freePort(); if (PORT === 8642) PORT = await freePort();
const DEADURL = 'http://127.0.0.1:9/';
const B = 'http://localhost:' + PORT;
const baseEnv = { ...process.env, PORT: String(PORT), JSI_DATA_DIR: dataDir, DATA_DIR: dataDir, BASE_URL: B, NODE_ENV: 'test', SEED_INVITE_CODE: '12345', TOS_GATE: '1', TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback',
  SEED_CODES_OPEN: '1', DATA_KEY: '', DATA_KEY_FILE: '', BACKUP_DIR: path.join(dataDir, 'backups'), KEY_ROTATE_EXTRA_DBS: '', CHAIN_LIVE: '', LEDGER_COOL_MS: '2000',
  RPC_URL: NODE, BLOCKSCOUT_URL: '', CHART_SRC_DS_URL: DEADURL, CHART_SRC_GT_URL: DEADURL, TOKSEARCH_GT_URL: DEADURL, TOKSEARCH_DS_URL: DEADURL, ETHUSD_URL: DEADURL, STOCK_QUOTE: '0',
  MC_DEXSCREENER_URL: DEADURL, MC_GECKO_URL: DEADURL, MC_GOPLUS_URL: DEADURL, ETH_RPC_URL: DEADURL, SOL_RPC_URL: DEADURL, JUPITER_URL: DEADURL,
  MARKET_COLLECT: '0', MARKET_LLAMA_URL: DEADURL, MARKET_LLAMA_COINS_URL: DEADURL, MARKET_LLAMA_STABLES_URL: DEADURL, MARKET_L2BEAT_URL: DEADURL, MARKET_GROWTHEPIE_URL: DEADURL,
  MARKET_GROWTHEPIE_METRICS_URL: DEADURL, MARKET_GT_URL: DEADURL, MARKET_DS_URL: DEADURL, MARKET_CG_URL: DEADURL, MARKET_ETH_RPC_URL: DEADURL, MARKET_LOGO_ORIGIN: DEADURL };
let server = null, slog = '';
async function boot(extra) {
  slog = '';
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', pathToFileURL(GUARD).href, 'server.js'], { cwd: ROOT, env: Object.assign({}, baseEnv, extra || {}), stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
  for (let i = 0; i < 150; i++) { try { if ((await fetch(B + '/healthz')).ok) return true; } catch {} await sleep(200); }
  return false;
}
async function halt() { if (!server) return; const s = server; server = null; const done = new Promise((r) => s.once('exit', r)); try { s.kill('SIGTERM'); } catch {} await Promise.race([done, sleep(5000)]); }
let ipN = 0;
async function api(p, o = {}) {
  const r = await fetch(B + p, { method: o.method || 'GET', headers: Object.assign({ Origin: B, 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.' + (o.sid ? 1 : 2) + '.' + (++ipN % 250) }, o.sid ? { Cookie: 'sid=' + o.sid } : {}), body: o.body ? JSON.stringify(o.body) : undefined });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text };
}
const guarded = () => slog.split('\n').filter((l) => l.startsWith('NETGUARD ')).map((l) => { try { return JSON.parse(l.slice(9)); } catch { return { to: l, ua: null }; } });
const bareText = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
const badWords = (s) => /\bundefined\b|\bNaN\b|\[object Object\]/.test(s);

// the page's own renderer (public/newpairs.js), in a sandbox: the dashboard and the contract read, as a reader would see them
const noop = () => {}, nil = () => null;
const document = { addEventListener: noop, getElementById: nil, querySelector: nil, querySelectorAll: () => [], body: { classList: { toggle: noop, remove: noop } }, hidden: false };
const window = { document, addEventListener: noop, CSS: { escape: (x) => x } };
let contractAnswer = null;
const ctx = { window, document, localStorage: { getItem: nil, setItem: noop }, fetch: async () => ({ ok: true, json: async () => contractAnswer }), setTimeout, clearTimeout, setInterval: noop,
  requestAnimationFrame: noop, cancelAnimationFrame: noop, console, CustomEvent: function () {}, Node: {} };
ctx.globalThis = ctx; window.window = window; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'newpairs.js'), 'utf8'), ctx);
const NPC = window.NPCard;
async function contractHTMLOf(j, token, pair) { contractAnswer = j; const el = { dataset: { token, pair }, innerHTML: '' }; await NPC.loadContract(el); return el.innerHTML; }

const dbPath = path.join(dataDir, 'app.db');
let sdb = null;
function member(name) {
  const t = Date.now();
  const id = Number(sdb.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, t, '🧪', t, 'ok').lastInsertRowid);
  const sid = 'tok_' + name + '_' + randomBytes(8).toString('hex');
  sdb.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(sid).digest('hex'), id, t, t + 864e5);
  return { id, sid };
}
function community(uid, tok, pair, sym) {
  const t = Date.now();
  const cid = Number(sdb.prepare("INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, status, official, founder_paid, went_live_at, created_at) VALUES (?,?,?,?,?,'live',0,1,?,?)").run(uid, tok, pair, sym, sym, t, t).lastInsertRowid);
  sdb.prepare('INSERT INTO community_members (community_id, user_id, joined_at, qualified) VALUES (?,?,?,1)').run(cid, uid, t);
  return cid;
}
async function snapshot(m, cid) {
  const st = await api('/api/communities/' + cid + '/snapshots', { method: 'POST', sid: m.sid });
  const id = st.j && st.j.snapshot && st.j.snapshot.id;
  let s = null;
  for (let i = 0; i < 100 && id; i++) { s = (await api('/api/communities/' + cid + '/snapshots/' + id + '?limit=100', { sid: m.sid })).j; s = s && s.snapshot; if (s && s.status !== 'running') break; await sleep(200); }
  return { started: st.status, s };
}

try {
  /* ── 2. NO KEY ── */
  check('the server came up with no BLOCKSCOUT_URL', await boot(), slog.slice(-400));
  sdb = new DatabaseSync(dbPath); sdb.exec('PRAGMA busy_timeout = 5000');
  const m = member('__hua_member__');

  // a member's scan of Token A: Dexscreener lists it, GoPlus reads it, the chain's ledger counts its holders
  const scan = await api('/api/scan?address=' + TOKA + '&chain=robinhood', { sid: m.sid });
  const pa = scan.j && scan.j.pair, ta = (pa && pa.token) || {};
  check('a member\'s scan answers with the profile, named by Dexscreener, verified per GoPlus', scan.status === 200 && pa && ta.symbol === 'TOKA' && ta.name === 'Token A' && ta.isVerified === true, brief(scan.j));
  check('  ...the deployer the explorer used to give comes from GoPlus\'s creator_address, and says so (deployerSource) — so the serial-deployer check and "no calls on your own token" still have one',
    ta.deployer === CREATOR && ta.deployerSource === 'goplus', brief(ta));
  check('  ...the total supply the explorer used to give is the chain\'s own totalSupply(), as the holder ledger read it; the holders are the ledger\'s (on-chain)',
    ta.totalSupply === (1000n * E18).toString() && pa.holders && pa.holders.source === 'chain' && pa.holders.count === 3, brief({ ts: ta.totalSupply, h: pa && pa.holders }));
  check('  ...and nothing in it reads "undefined"', !badWords(scan.text));

  // a token dashboard read of Token B: listed, but GoPlus has nothing — so nobody read its contract
  const look = await api('/api/pairs/lookup?token=' + TOKB);
  const pb = look.j && look.j.pair, tb = (pb && pb.token) || {}, rb = (pb && pb.risk) || {};
  check('a token dashboard read of a token GoPlus has no reading for: verification and deployer are not read (null) — never "unverified", never a guess', look.status === 200 && pb && tb.symbol === 'TOKB' && tb.isVerified === null && tb.deployer === null && tb.deployerSource === null && !pb.chainFacts, brief(pb && { token: tb, chainFacts: pb.chainFacts }));
  check('  ...and an unread contract is thin data: the verdict is held off the top tier (caution at best), with verification named as not read', rb.thinData === true && rb.triage !== 'ok' && rb.dataKnown && rb.dataKnown.verified === false, brief(rb));
  check('  ...nothing in it reads "undefined"', !badWords(look.text));

  // the contract read
  const cb = await api('/api/pairs/contract?token=' + TOKB + '&pair=' + PB);
  check('the contract read of Token B: verification unknown, its reason said plainly (GoPlus gave no reading; the explorer needs a key) — not "right now", not a pass; and its owner() at 0x…dEaD is not called a real renounce, with nothing read to say there is no way back (null, not true)',
    cb.status === 200 && cb.j.verified === null && cb.j.name === null && /GoPlus Security gave no reading of it, and the explorer is read only with an API key \(BLOCKSCOUT_URL\)/.test(cb.j.summary) && !/right now/.test(cb.j.summary) && cb.j.renounced === null && cb.j.powers.length === 0, brief(cb.j));
  check('  ...its LP, which the chain could not read, is unknown with the reason (the explorer\'s LP holder list is not asked)', cb.j.liquidity && cb.j.liquidity.known === false && /could not be read on the chain just now, and the explorer is read only with an API key/.test(cb.j.liquidity.reason || ''), brief(cb.j.liquidity));
  const ca = await api('/api/pairs/contract?token=' + TOKA + '&pair=' + PA);
  check('the contract read of Token A: GoPlus\'s reading, and its LP from the same reading (90% at a dead address)', ca.status === 200 && ca.j.source === 'goplus' && ca.j.verified === true && ca.j.liquidity.known === true && Math.round(ca.j.liquidity.lockedPct) === 90, brief(ca.j));

  // the page renders them
  const dashA = bareText(NPC.dashboardHTML(pa)), dashB = bareText(NPC.dashboardHTML(pb));
  check('the dashboard renders both profiles with no "undefined", "NaN" or "[object Object]"; Token A\'s deployer is labelled as GoPlus\'s', !badWords(dashA) && !badWords(dashB) && /Deployer \(per GoPlus\)/.test(dashA), brief([dashA.slice(0, 200), dashB.slice(0, 200)]));
  const vB = NPC.verdictWordOf(pb);
  check('  ...and Token B\'s verdict is not a green one (nobody read its contract)', vB && !/^Looks Good/.test(vB.word), brief(vB));
  const hB = bareText(await contractHTMLOf(cb.j, TOKB, PB));
  check('  ...its contract read says why it is unknown, and why the LP is', /read only with an API key/.test(hB) && /Couldn’t tell whether the liquidity is locked — the pool’s LP could not be read on the chain just now/.test(hB) && !badWords(hB), hB.slice(0, 400));

  // the radar
  let radar = null;
  for (let i = 0; i < 60; i++) { radar = (await api('/api/pairs/new', { sid: m.sid })).j; if (radar && Array.isArray(radar.pairs) && radar.pairs.length >= 3) break; await sleep(300); }
  const rp = ((radar && radar.pairs) || []).map((p) => ({ sym: p.token.symbol, name: p.token.name, dep: p.token.deployer, thin: p.risk && p.risk.thinData }));
  const rD = rp.find((x) => x.sym === 'TOKD');
  check('the radar builds for a member: three pairs, the one Dexscreener does not list named from its own contract (the explorer used to be asked), and that one — unread by GoPlus — is thin data',
    rp.length === 3 && rD && rD.name === 'Token D' && rD.thin === true && rp.find((x) => x.sym === 'TOKA').dep === CREATOR, brief(rp));
  check('  ...and nothing in it reads "undefined"', radar && !badWords(JSON.stringify(radar)));

  // the deployer's trades on the chart: GoPlus names the deployer, the chain gives its trades
  const mk = await api('/api/chart/markers?token=' + TOKA + '&pair=' + PA + '&dev=1');
  const dev = mk.j && mk.j.types && mk.j.types.dev;
  check('the chart\'s deployer layer reads the deployer\'s trades from the chain\'s own Transfer logs (the explorer used to be asked)', mk.status === 200 && Array.isArray(dev) && dev.length >= 1 && mk.j.notes.dev == null, brief(mk.j && { dev, notes: mk.j.notes }));
  const mkB = await api('/api/chart/markers?token=' + TOKB + '&pair=' + PB + '&dev=1');
  check('  ...and for a token with no deployer named, the note says why — not "the explorer does not name one"', mkB.status === 200 && /No deployer is named for this token: GoPlus Security names none, and the explorer is read only with an API key/.test(mkB.j.notes.dev || ''), brief(mkB.j && mkB.j.notes));

  // the tracker's explorer route
  const ex = await api('/api/chain/explorer?path=' + encodeURIComponent('/api/v2/addresses/' + WALLET), { sid: m.sid });
  check('the tracker\'s explorer route answers "not read" (503, keyed: false) with no request made', ex.status === 503 && ex.j && ex.j.keyed === false && /read only with an API key/.test(ex.j.error), brief(ex.j));

  // a community holder snapshot: the chain's own ledger, frozen
  const cid = community(m.id, TOKA, PA, 'TOKA');
  const sn = await snapshot(m, cid);
  const hs = (sn.s && sn.s.holders) || [];
  check('a community holder snapshot is the chain\'s own holder ledger: complete, every holder with its balance (burn and zero are not holders), the supply the chain gave — and no "explorer reported" count',
    sn.started === 202 && sn.s && sn.s.status === 'complete' && sn.s.holderCount === 3 && sn.s.expectedCount === null && sn.s.pages === 0 && sn.s.totalSupply === (1000n * E18).toString()
    && hs.map((h) => h.address).join() === [CREATOR, PA, H1].join() && hs[0].value === (630n * E18).toString() && hs[2].value === (100n * E18).toString() && sn.s.symbol === 'TOKA', brief(sn));

  // a community whose token has no ledger yet: the count it was made with, said as that — not as the explorer's
  const cid3 = community(m.id, TOKD, PD, 'TOKD');
  sdb.prepare('UPDATE communities SET c_holders = 42 WHERE id = ?').run(cid3);
  const card = (await api('/api/communities/' + cid3, { sid: m.sid })).j, cc3 = (card && card.community) || {};
  check('a community card whose token has no chain ledger yet shows the count the site recorded, labelled "recorded" — never "from the block explorer" with no key',
    cc3.holdersSource !== 'explorer' && (cc3.holdersSource === 'chain' || (cc3.holdersSource === 'recorded' && cc3.holders === 42)), brief({ holders: cc3.holders, src: cc3.holdersSource }));

  /* a pool the node would not read (review, 2026-10-27): the reader that checks the pool holds the token turned a refused token0()
     into an empty side, so the panel said "that pool does not hold this token" — and kept saying it, cached — for a pool that does */
  node.refuse.add(PE);
  const ce = await api('/api/pairs/contract?token=' + TOKB + '&pair=' + PE);
  check('a contract read whose pool the node refuses to read: the LP is unknown because the pool could not be read just now — not "that pool does not hold this token"',
    ce.status === 200 && ce.j.liquidity && ce.j.liquidity.known === false && ce.j.liquidity.reason === 'the pool could not be read on the chain just now' && node.refused > 0, brief(ce.j && { liquidity: ce.j.liquidity, refused: node.refused }));
  const hE = bareText(await contractHTMLOf(ce.j, TOKB, PE));
  check('  ...and the panel says that, not a false claim about the pool', /Couldn’t tell whether the liquidity is locked — the pool could not be read on the chain just now\./.test(hE) && !/does not hold this token/.test(hE) && !badWords(hE), hE.slice(0, 400));
  node.refuse.delete(PE);
  const ce2 = await api('/api/pairs/contract?token=' + TOKB + '&pair=' + PE);
  check('  ...and the refusal is not kept: once the node answers, the same read finds the pool and reads its LP (90% at a dead address, on-chain)',
    ce2.status === 200 && ce2.j.liquidity && ce2.j.liquidity.known === true && ce2.j.liquidity.burnedOnly === true && Math.round(ce2.j.liquidity.lockedPct) === 90, brief(ce2.j && ce2.j.liquidity));
  const cn = await api('/api/pairs/contract?token=' + TOKB + '&pair=' + PA);
  check('  ...while a pool the chain says is another token\'s still reads as that (the chain\'s answer, not a guess)', cn.status === 200 && cn.j.liquidity && cn.j.liquidity.known === false && cn.j.liquidity.reason === 'that pool does not hold this token', brief(cn.j && cn.j.liquidity));

  /* a snapshot that read no holders: Token B's ledger is one too large to build here, and without a key the explorer is not walked
     instead — the snapshot fails with the reason, and its count is not known (null), never the stored 0 shown as "0 holders" */
  const cid4 = community(m.id, TOKB, PB, 'TOKB');
  sdb.prepare("INSERT INTO holder_index (token_addr, status, updated_at) VALUES (?, 'too-big', ?) ON CONFLICT(token_addr) DO UPDATE SET status='too-big', updated_at=excluded.updated_at").run(TOKB, Date.now());
  const sn4 = await snapshot(m, cid4);
  check('a holder snapshot that could read no holders fails with the reason, and its holder count is null (not read) — never 0',
    sn4.started === 202 && sn4.s && sn4.s.status === 'failed' && sn4.s.holderCount === null && sn4.s.supplyHeld === null && /more transfers than this server can rebuild its holder list from, and the explorer is read only with an API key/.test(sn4.s.reason || ''), brief(sn4));
  // the community page's own renderer (public/snapshots.js), in a sandbox, fed by the server
  const el = (id) => ({ id, hidden: true, innerHTML: '', textContent: '', disabled: false, addEventListener: noop });
  const sEls = { 'comm-snaps': el('comm-snaps'), 'snap-tabs': el('snap-tabs'), 'snap-body': el('snap-body'), 'snap-take': el('snap-take'), 'snap-status': el('snap-status') };
  const sDoc = { readyState: 'complete', getElementById: (id) => sEls[id] || null, addEventListener: noop };
  const sWin = { AUTH: { user: { username: '__hua_member__' } }, api: async (p) => (await api(p, { sid: m.sid })).j };
  const sCtx = { window: sWin, AUTH: sWin.AUTH, document: sDoc, location: { search: '?id=' + cid4 }, URLSearchParams, setInterval: () => 0, clearInterval: noop, console };
  sCtx.globalThis = sCtx; vm.createContext(sCtx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'snapshots.js'), 'utf8'), sCtx);
  for (let i = 0; i < 50 && !sEls['snap-body'].innerHTML; i++) await sleep(100);
  const sv = bareText(sEls['snap-body'].innerHTML);
  check('  ...and the community page says the holders were not read, beside why — not "0 holders"', /This snapshot is incomplete\./.test(sv) && /Holders not read/.test(sv) && !/\b0\s+holders/.test(sv) && !badWords(sv), sv.replace(/\s+/g, ' ').slice(0, 400));

  // the network, the whole run
  await sleep(300);
  const g = guarded();
  check('ZERO requests to the explorer: nothing tried robinhoodchain.blockscout.com (or any Blockscout host), and the fake keyed one heard nothing',
    !g.some((x) => /blockscout/i.test(String(x.to))) && bs.reqs.length === 0, brief({ g: g.filter((x) => /blockscout/i.test(String(x.to))), bs: bs.reqs }));
  check('every request that left the server — Dexscreener, GoPlus, anything refused — carried the honest User-Agent', g.length >= 4 && g.every((x) => x.ua === HONEST) && g.some((x) => /gopluslabs/.test(x.to)) && g.some((x) => /dexscreener/.test(x.to)), brief(g.filter((x) => x.ua !== HONEST).concat(g.slice(0, 3))));
  check('  ...and so did every read of the chain node', node.reqs.length >= 10 && node.reqs.every((r) => r.ua === HONEST), brief(node.reqs.filter((r) => r.ua !== HONEST).slice(0, 3)));
  await halt();

  /* ── 3. A KEY ── */
  node.reqs.length = 0;
  check('the server came up with BLOCKSCOUT_URL pointed at a keyed explorer', await boot({ BLOCKSCOUT_URL: V + '/bs/' }), slog.slice(-400));
  const sc = await api('/api/scan?address=' + TOKC + '&chain=robinhood', { sid: m.sid });
  const pc = sc.j && sc.j.pair, tc = (pc && pc.token) || {};
  check('with a key, a scan reads the explorer as before: the name, the verification and the deployer are the explorer\'s (deployerSource "explorer")',
    sc.status === 200 && pc && tc.name === 'Token C' && tc.symbol === 'TOKC' && tc.isVerified === true && tc.deployer === CREATOR2 && tc.deployerSource === 'explorer', brief(sc.j));
  const cc = await api('/api/pairs/contract?token=' + TOKC + '&pair=' + PC);
  check('  ...the contract read takes the explorer\'s verified source (its name; a mint power the source scan finds) and, the chain\'s LP read failing, the explorer\'s LP holders',
    cc.status === 200 && cc.j.verified === true && cc.j.name === 'TokenC' && cc.j.powers.some((x) => x.key === 'mint') && cc.j.liquidity.known === true && Math.round(cc.j.liquidity.lockedPct) === 90, brief(cc.j));
  const ex2 = await api('/api/chain/explorer?path=' + encodeURIComponent('/api/v2/addresses/' + WALLET), { sid: m.sid });
  check('  ...the tracker\'s explorer route answers from it', ex2.status === 200 && ex2.j && ex2.j.hash === WALLET, brief(ex2.j));
  const cid2 = community(m.id, TOKC, PC, 'TOKC');
  const sn2 = await snapshot(m, cid2);
  check('  ...and a holder snapshot walks its holder list (pages of 50), checked against its own count', sn2.started === 202 && sn2.s && sn2.s.status === 'complete' && sn2.s.holderCount === 2 && sn2.s.expectedCount === 2
    && bs.reqs.some((r) => r.path === '/bs/api/v2/tokens/' + TOKC + '/holders?items_count=50'), brief({ sn2, bs: bs.reqs.map((r) => r.path) }));
  const paths = bs.reqs.map((r) => r.path.replace(/^\/bs/, '').split('?')[0]);
  check('  ...every one of those explorer reads was made, as the site (the honest User-Agent)',
    ['/api/v2/tokens/' + TOKC, '/api/v2/addresses/' + TOKC, '/api/v2/tokens/' + TOKC + '/holders', '/api/v2/smart-contracts/' + TOKC, '/api/v2/tokens/' + PC, '/api/v2/tokens/' + PC + '/holders', '/api/v2/addresses/' + WALLET].every((x) => paths.includes(x))
    && bs.reqs.every((r) => r.ua === HONEST), brief(bs.reqs));
  const g2 = guarded();
  check('  ...and still nothing went to the public explorer, and everything that left went as the site', !g2.some((x) => /blockscout/i.test(String(x.to))) && g2.every((x) => x.ua === HONEST) && node.reqs.every((r) => r.ua === HONEST), brief(g2.filter((x) => x.ua !== HONEST)));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join(' | '));
  check('the suite ran to the end', false, e.message);
} finally {
  await halt();
  try { sdb && sdb.close(); } catch {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}

for (const [n, ok, extra] of results) console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  — ' + extra));
console.log(results.filter((r) => r[1]).length + '/' + results.length + ' passed');
process.exit(results.every((r) => r[1]) ? 0 : 1);
