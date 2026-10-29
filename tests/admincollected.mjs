/* ===== The admin page's Collected data browser (owner, 2026-10-26) ==========================================================
   Owner: "Make all cache data from the platform visible on the Admin page. Don't show anything on the admin page that is
   encrypted. Just show all the data that the platform is collecting that is public to everyone and through the API key."

   1. The files: the section and its controls (every one tipped), a script that only ever GETs /api/admin/collected*, its guard
      that never draws a column whose name says it is private, and the text floor in its styles.
   2. The page in a real browser — headless Chrome, muted — served by a little static server of this suite's own, with a fake
      of the two admin routes built from tests/fixtures/admin/ (the shapes in the Market Data contract, filled from the research
      samples read on 2026-10-26): the dataset list, a table, paging both ways, search, an empty dataset, a failing one, a column
      the page must refuse, a late answer that must lose to a newer one, refresh, and the list itself failing — at 320, 375, 768,
      1280, 1920 and 2560 px, with no sideways scroll on the page and no text under the floor. Without a browser (a CI runner
      with no Chrome) these checks are skipped and the run says so; on a machine that has one, a browser that will not start fails.
   3. Once the runner's own server offers GET /api/admin/collected (the Market Data server), its real answer: the shape this page
      reads, every dataset readable, and not one column served that the page would refuse. Before that it says it is skipping.
   Everything it creates it deletes. */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { ROOT } from './_paths.mjs';

const PUB_DIR = path.join(ROOT, 'public');
const PUB = (f) => fs.readFileSync(path.join(PUB_DIR, f), 'utf8');
const FIX_DIR = path.join(ROOT, 'tests', 'fixtures', 'admin');
const FIX = (f) => JSON.parse(fs.readFileSync(path.join(FIX_DIR, f), 'utf8'));
const results = [], notes = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HTML = PUB('admin.html'), JS = PUB('admin.js'), CSS = PUB('styles.css');
const LIST = FIX('collected.json');
const SETS = Object.fromEntries(LIST.datasets.map((d) => [d.id, FIX(d.id + '.json')]));

/* ═══ 1. the files ═══ */
const SEC = (/<section class="card adm-ov adm-col" id="adm-col" hidden aria-labelledby="adm-col-h">[\s\S]*?<\/section>/.exec(HTML) || [''])[0];
const BLOCK = JS.slice(JS.indexOf('/* ----- collected data:'), JS.indexOf('function boot()'));
check('the admin page has the Collected data section, hidden until the admin is known, after the member-history section and before moderation',
  !!SEC && HTML.indexOf('id="adm-hist"') < HTML.indexOf('id="adm-col"') && HTML.indexOf('id="adm-col"') < HTML.indexOf('id="adm-tools"'));
{
  const btns = [...SEC.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  const bare = btns.filter((m) => !/data-tip="[^"]{12,}"/.test(m[1]));
  check('  ...its buttons (refresh, search, clear, newest, older) each carry a description of their own', btns.length === 5 && !bare.length, btns.length + ' buttons, ' + bare.length + ' bare');
  check('  ...a labelled search box, a status line read out as it changes, and the dataset list as a real list', /<label class="f-label" for="adm-col-q">/.test(SEC) && /id="adm-col-q"[^>]*type="search"[^>]*maxlength="100"/.test(SEC)
    && /id="adm-col-status" role="status" aria-live="polite"/.test(SEC) && /<ul class="adm-col-sets" id="adm-col-sets"/.test(SEC));
  check('  ...and it says plainly that nothing encrypted is shown, and that it is read-only', /Read-only: nothing here changes anything\. Nothing encrypted is shown/.test(SEC));
}
check('admin.js reads the collected data with GETs only — the list and one dataset, never another route, never a write',
  BLOCK.length > 2000 && [...BLOCK.matchAll(/colGet\('([^']+)'/g)].map((m) => m[1]).join(',') === '/api/admin/collected,/api/admin/collected/'
    && !/method\s*:/.test(BLOCK) && !/fetch\((?!url,)/.test(BLOCK) && !/window\.api\(|\bpost\(/.test(BLOCK));
check('  ...the section shows for the admin and loads with the rest of the page, and hides for anyone else',
  /tools\.hidden = false; ov\.hidden = false; dau\.hidden = false; col\.hidden = false;\s*loadOverview\(\); loadActivity\(\); load\(\); loadCollected\(\);/.test(JS)
  && (JS.match(/dau\.hidden = true; col\.hidden = true; return;/g) || []).length === 2);
check('  ...nothing in a cell is a link or a picture: no <a> or <img> is built anywhere in it', !/<a\b|<img\b|\.src\s*=|\.href\s*=/.test(BLOCK));
// the guard, run as written
let NEVER = null;
try { NEVER = new Function('return ' + /const COL_NEVER = (new RegExp\(\[[\s\S]*?\]\.join\('\|'\), 'i'\));/.exec(BLOCK)[1])(); } catch (e) { notes.push('could not read COL_NEVER: ' + e.message); }
const PRIVATE = ['address_enc', 'identifier_enc', 'info_enc', 'tx_enc', 'amount_seen_enc', 'enc_blob', 'email', 'email_idx', 'emailHash', 'password_hash', 'pw_hash', 'totp_secret', 'twofa_method', 'twofaWallet', 'two_factor',
  'session', 'sessions', 'session_token', 'sid', 'sudo_until', 'ip', 'ip_hash', 'ipHash', 'client_ip', 'key_hash', 'api_key', 'apiKey', 'data_key', 'private_key', 'secret', 'tracker_prefs', 'site_prefs', 'prefs', 'sitePrefs',
  'tracked_wallets', 'trackedWallets', 'linked_wallets', 'wallet_links', 'walletList', 'wallets', 'addr_idx', 'wallets_idx', 'wallet_idx', 'to_idx', 'from_idx', 'creator_address_hash', 'blind_index'];
const PUBLIC = ['id', 'key', 'chain', 'chainId', 'at', 'lastAt', 'tvl', 'token', 'token_addr', 'address', 'wallet', 'pool', 'pair', 'tx_hash', 'holders', 'name', 'symbol', 'json', 'src', 'note', 'username', 'avatar_img', 'joined', 'block',
  'quote', 'quote_symbol', 'dex', 'stage', 'mcap', 'fees_24h', 'description', 'title', 'verdict', 'risk', 'price_usd', 'reserve_usd', 'gas_price_wei', 'bridge_eth', 'pm_usdg', 'job', 'ok', 'calls', 'twitter', 'instagram', 'bio', 'tips', 'shipped', 'zip', 'ship_ip_free'];
check('the page\'s own guard refuses every private column name the contract lists (encrypted, email, password, 2FA, session, IP, key, preferences, linked or tracked wallets, blind indexes)',
  NEVER && PRIVATE.every((n) => NEVER.test(n)), NEVER ? PRIVATE.filter((n) => !NEVER.test(n)).join(',') : 'no guard');
check('  ...and lets every ordinary public one through (a chain key, a token, an address, the caller\'s wallet, a tx hash, a JSON scan result…)',
  NEVER && PUBLIC.filter((n) => n !== 'ship_ip_free').every((n) => !NEVER.test(n)), NEVER ? PUBLIC.filter((n) => n !== 'ship_ip_free' && NEVER.test(n)).join(',') : 'no guard');
{
  let exact = null;
  try { exact = new Function('return ' + /const colExact = (\(v\) => \{[^\n]*\});\n/.exec(BLOCK)[1])(); } catch (e) { notes.push('could not read colExact: ' + e.message); }
  const cases = [[13243422.2942033, '13,243,422.2942033'], [-1234567, '-1,234,567'], [9999.5, '9999.5'], [1e21, '1e+21'], [0.0001703, '0.0001703'], [48511366247, '48,511,366,247']];
  check('a number is shown with every digit it was stored with — the whole part grouped in threes from 10,000 up, never rounded, never re-written',
    exact && cases.every(([v, w]) => exact(v) === w), exact ? cases.map(([v]) => exact(v)).join(' ') : 'not found');
}
{
  const css = CSS.slice(CSS.indexOf('/* collected data (admin.js'), CSS.indexOf('#adm-col-older'));
  const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]);
  check('its styles: every size on the text floor, the table scrolls in its own box, grid columns capped at the screen',
    sizes.length >= 6 && sizes.every((s) => /^max\(var\(--text-floor\)/.test(s)) && /\.adm-col-table \{ overflow-x: auto; max-width: 100%;/.test(css)
      && /minmax\(min\(100%, 19rem\), 1fr\)/.test(css) && !/text-overflow|line-clamp/.test(css), sizes.length);
}
check('the fixtures are the contract\'s shapes: a list of datasets with id, title, description, rows, newest/oldest and labelled columns, and one file of rows for each',
  LIST.datasets.length >= 10 && LIST.datasets.every((d) => typeof d.id === 'string' && typeof d.title === 'string' && typeof d.description === 'string' && (d.rows === null || Number.isInteger(d.rows))
    && (d.newestAt === null || typeof d.newestAt === 'number') && (d.oldestAt === null || typeof d.oldestAt === 'number') && Array.isArray(d.columns) && d.columns.every((c) => typeof c.name === 'string' && typeof c.label === 'string')
    && SETS[d.id] && SETS[d.id].rows.length === d.rows) && LIST.datasets.some((d) => d.rows === 0) && LIST.datasets.some((d) => d.rows > 100));

/* ═══ 1b. the docs that go with it ═══ */
{
  const DATA = PUB('data.html'), PRIV = PUB('privacy.html'), README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), ENV = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const RES = ['me', 'users', 'posts', 'comments', 'calls', 'communities', 'leaderboard', 'competition', 'chains', 'chain', 'chain-history', 'chain-snapshots', 'tokens', 'token', 'pools', 'new-pools', 'radar', 'scans', 'pulse', 'collectors', 'rwa', 'rwa-token'];
  const listed = (r) => DATA.includes('<tr><td><code>' + r + '</code></td>'), opened = (r) => DATA.includes('<details class="dk-res"><summary><code>' + r + '</code>');
  const curl = (r) => new RegExp('<summary><code>' + r + '</code>[\\s\\S]*?curl -H "Authorization: Bearer sk_…"[\\s\\S]*?/api/data/v1/' + r + '\\b[\\s\\S]*?<pre class="dk-pre">\\{ data').test(DATA);
  check('/data documents every Send API resource, old and new: listed in the index, and each with a curl request and the shape that comes back',
    RES.every((r) => listed(r) && opened(r) && curl(r)), RES.filter((r) => !(listed(r) && opened(r) && curl(r))).join(','));
  const named = ((/one of: (me, [a-z, -]+)/.exec(SRV) || [])[1] || '').split(/,\s*/).filter(Boolean);
  if (named.length) check('  ...and every resource the server names in its "unknown resource" answer is one of them', named.every((r) => listed(r) && opened(r)), named.filter((r) => !(listed(r) && opened(r))).join(',') || named.length + ' named');
  else notes.push('could not find the server\'s list of Send API resources ("one of: me, …") to compare the docs with');
  check('  ...with the collectors and how often they run, and every source named — growthepie with its CC BY 4.0 credit and link',
    /What the collectors read, and how often/.test(DATA) && ['DefiLlama', 'L2BEAT', 'growthepie', 'GeckoTerminal', 'Dexscreener', 'CoinGecko'].every((s) => DATA.includes('>' + s + '</a></b>'))
      && /Source: growthepie, https:\/\/www\.growthepie\.com, under <a href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"[^>]*>CC BY 4\.0<\/a>/.test(DATA) && /Not affiliated with Robinhood Markets, Inc\./.test(DATA));
  check('the privacy policy (§8) names every new host the server reads for market data, says the browser never contacts them, names the picture hosts it proxies, and moved to 2026-10-26',
    ['DefiLlama', 'L2BEAT', 'growthepie', 'CoinGecko', 'GeckoTerminal', 'Dexscreener', 'Robinhood Chain RPC', 'public Ethereum node', 'cdn.dexscreener.com', 'dd.dexscreener.com', 'coin-images.coingecko.com', 'assets.geckoterminal.com', 'icons.llama.fi'].every((h) => PRIV.slice(PRIV.indexOf('id="p8"'), PRIV.indexOf('id="p9"')).includes(h))
      && /Your browser never contacts any of them/.test(PRIV) && /never who looked at or scanned what/.test(PRIV) && /Version 2026-10-29 · \$Send \/ JustSendIt/.test(PRIV));
  check('the README has the Market Data row in its core features and the market resources in the Send API section',
    /^\| \*\*📊 Market Data\*\* \| `\/market`/m.test(README) && /- \*\*And the market data the site collects\*\*[^\n]*`chain-history`[^\n]*`collectors`/.test(README));
  /* the RWAs tab (owner, 2026-10-28): the Data API page, the privacy policy, the README and llms.txt say what counts as an RWA, on
     what evidence, from which sources, how often — with the not-affiliated line wherever Robinhood's tokens are described */
  const RWA = DATA.slice(DATA.indexOf('id="dk-rwa-h"'), DATA.indexOf('aria-labelledby="dk-col-h"')), P8 = PRIV.slice(PRIV.indexOf('id="p8"'), PRIV.indexOf('id="p9"'));
  const LL = PUB('llms.txt'), RWAROW = (/^\| \*\*🏛️ RWAs on Market Data\*\* \| [^\n]*$/m.exec(README) || [''])[0];
  check('/data has an RWA section: the three confidences and their evidence tiers in words, lookalikes, what is listed apart, not affiliated with Robinhood, not advice — and the index groups rwa and rwa-token apart',
    /Market data: RWAs on Robinhood Chain/.test(RWA) && ['<code>confirmed</code>', '<code>issuer-listed</code>', '<code>not-confirmed</code>', '<code>A1</code>', '<code>A2</code>', '<code>A3</code>', '<code>B</code>'].every((k) => RWA.includes(k))
      && /never on its name/.test(RWA) && /<b>lookalike<\/b>/.test(RWA) && /Fiat-backed stablecoins and tokens merely paired with an RWA are listed apart and never counted/.test(RWA)
      && /Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\.; no Robinhood logo or artwork is served/.test(RWA) && /Not advice, never a tip to buy/.test(RWA)
      && /<th colspan="2" scope="rowgroup">Real-world assets on Robinhood Chain \(Market Data’s RWAs tab\)<\/th>/.test(DATA), RWA.length);
  check('  ...and its collectors table and sources name what the RWA job reads, and how often: Robinhood\'s Stock Token API, Chainlink\'s feed directory, DefiLlama, GeckoTerminal and the chain — every 30 minutes, each part when due',
    /<tr><td>RWAs<\/td><td>Robinhood’s Stock Token API \(api\.robinhood\.com\/rhj\)[^<]*Chainlink’s public directory[^<]*DefiLlama[^<]*GeckoTerminal[^<]*Robinhood Chain’s public RPC[^<]*<\/td><td>Every 30 minutes, each part when it is due/.test(DATA)
      && ['Robinhood’s Stock Token API', 'Chainlink'].every((s2) => DATA.includes('>' + s2 + '</a></b>')) && /<code>robinhood<\/code>, <code>chainlink<\/code>, <code>rpc<\/code> or <code>site<\/code>/.test(DATA));
  check('the privacy policy (§8) names the RWAs tab\'s new hosts — Robinhood\'s Stock Token API (api.robinhood.com) and Chainlink\'s feed directory (reference-data-directory.vercel.app) — read on a timer by the server, never because someone opened a token',
    ['Robinhood’s Stock Token API', 'api.robinhood.com', 'Chainlink’s public directory of price feeds', 'reference-data-directory.vercel.app'].every((h) => P8.includes(h)) && /For the page’s RWAs tab it also reads, on a timer and never because someone opened a token/.test(P8));
  check('the README has the RWAs row after Market Data\'s: how a token counts (evidence, never a name), lookalikes, what is listed apart, the job\'s cadence, the meters and the two new MARKET_* URLs, not affiliated — and rwa and rwa-token in the Send API section',
    !!RWAROW && README.indexOf('| **📊 Market Data** |') < README.indexOf(RWAROW) && /on evidence, never on its name/.test(RWAROW) && /\*\*lookalike\*\*/.test(RWAROW) && /listed apart and never counted/.test(RWAROW)
      && /one `rwa` job every 30 min/.test(RWAROW) && /`api\.robinhood\.com` at 20 a minute/.test(RWAROW) && /`reference-data-directory\.vercel\.app` at 6/.test(RWAROW) && /`MARKET_RHJ_URL` and `MARKET_CHAINLINK_URL`/.test(RWAROW)
      && /Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\./.test(RWAROW) && /Not advice, never a tip to buy/.test(RWAROW)
      && /- \*\*And the market data the site collects\*\*[^\n]*`rwa` \(`\?view=&sort=&dir=&kind=&issuer=`[^\n]*`rwa-token` \(`\?address=`/.test(README) && /the RWAs every 30 min/.test(README), RWAROW.length);
  check('  ...and llms.txt\'s Market Data line names the RWAs tab, how a token counts, and its two new sources',
    /\n- \[Market Data\]\(https:\/\/sendrh\.com\/market\): [^\n]*an RWAs tab of the real-world-asset tokens on Robinhood Chain[^\n]*never a name[^\n]*Robinhood's Stock Token API, Chainlink/.test(LL));
  const vars = ['MARKET_COLLECT', 'MARKET_LLAMA_URL', 'MARKET_LLAMA_COINS_URL', 'MARKET_LLAMA_STABLES_URL', 'MARKET_L2BEAT_URL', 'MARKET_GROWTHEPIE_URL', 'MARKET_GT_URL', 'MARKET_DS_URL', 'MARKET_CG_URL', 'MARKET_ETH_RPC_URL', 'MARKET_RHJ_URL', 'MARKET_CHAINLINK_URL', 'COINGECKO_DEMO_KEY'];
  check('.env.example lists MARKET_COLLECT, every MARKET_* base, the optional CoinGecko Demo key and the keyed-explorer note — and no empty value followed by a note the .env reader would take as the value',
    vars.every((v) => new RegExp('^' + v + '=$', 'm').test(ENV)) && /BLOCKSCOUT_URL above, pointed at a keyed endpoint/.test(ENV) && !/^[A-Z_]+=[ \t]+#/m.test(ENV), vars.filter((v) => !new RegExp('^' + v + '=$', 'm').test(ENV)).join(','));
}

/* ═══ 2. the page in a real browser ═══ */
const log = [];                              // every request the fake API saw
const fake = { list: 'ok', fail: new Set(), trap: new Set(), slow: new Map() };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const ME = { username: 'adm_browser', avatar: '🧪', admin: true, methods: ['email'], wallets: [], walletList: [], maxWallets: 5, twofa: null, sudoUntil: null, sudoLeftMs: 0, mutes: [], alerts: [],
  points: 0, level: 1, title: 'Rookie', og: 0, restriction: null, holderVerified: true, probation: null, checkedInToday: false, boost: { total: 1 }, onboard: { due: false } };
function page(id, q, before, limit) {
  const set = SETS[id];
  let rows = set.rows;
  const hasId = rows.length && rows.every((r) => Number.isInteger(r.id));
  if (q) { const w = q.toLowerCase(); rows = rows.filter((r) => Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(w))); }
  let start = 0;
  if (before != null && before !== '') start = hasId ? rows.findIndex((r) => r.id < Number(before)) : Number(before);
  if (start < 0) start = rows.length;
  const out = rows.slice(start, start + limit);
  const more = start + out.length < rows.length;
  return { id, columns: set.columns, rows: out, next: more && out.length ? (hasId ? out[out.length - 1].id : start + out.length) : null };
}
const site = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (u.pathname.startsWith('/api/')) {
    log.push({ method: req.method, path: u.pathname, q: Object.fromEntries(u.searchParams) });
    if (u.pathname === '/api/me') return json(200, { user: ME });
    if (u.pathname === '/api/config') return json(200, { auth: { wallet: true, email: true } });
    if (u.pathname === '/api/admin/collected' && req.method === 'GET') {
      if (fake.list === 'fail') return json(500, { error: 'could not count the tables' });
      if (fake.list === 'notfound') { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<p>That page didn’t…</p>'); }
      return json(200, LIST);
    }
    const m = /^\/api\/admin\/collected\/([^/]+)$/.exec(u.pathname);
    if (m && req.method === 'GET') {
      const id = decodeURIComponent(m[1]);
      if (fake.slow.has(id)) await sleep(fake.slow.get(id));
      if (fake.fail.has(id)) return json(500, { error: 'database is locked' });
      if (!SETS[id]) return json(404, { error: 'no such dataset' });
      const p = page(id, u.searchParams.get('q') || '', u.searchParams.get('before'), Math.min(200, Number(u.searchParams.get('limit')) || 100));
      if (fake.trap.has(id)) { p.columns = [...p.columns, { name: 'address_enc', label: 'Linked wallet' }, { name: 'email', label: 'Email' }]; p.rows = p.rows.map((r) => ({ ...r, address_enc: 'v1:TRAPCIPHER', email: 'trap@example.com' })); }
      return json(200, p);
    }
    return json(404, { error: 'not found' });
  }
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/admin' || rel === '/') rel = '/admin.html';
  const file = path.normalize(path.join(PUB_DIR, rel));
  if (!file.startsWith(PUB_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  const h = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
  if (file.endsWith('.html')) h['Set-Cookie'] = 'jsi_age=18; Path=/; SameSite=Lax';   // the 18+ answer, so the age question does not cover the page
  res.writeHead(200, h); fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => site.listen(0, '127.0.0.1', ok));
const ORIGIN = 'http://127.0.0.1:' + site.address().port;

function findChrome() {
  const c = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return c.find((p) => p && fs.existsSync(p)) || null;
}
const CHROME = findChrome();
let chrome = null, profile = null, ws = null;
async function startChrome() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-admcol-'));
  const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--lang=en-US', 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');   // Ubuntu 24.04's AppArmor refuses Chrome's sandbox to an unprivileged runner
  chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; chrome.stderr.on('data', (d) => { err += d; });
  const portFile = path.join(profile, 'DevToolsActivePort');   // a port of the OS's choosing: two runs at once never read each other's page
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) throw new Error('Chrome did not open its debugging port: ' + err.slice(0, 300));
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  ws = new WebSocket('ws://127.0.0.1:' + port + wsPath);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('could not connect to Chrome')); });
  ws.onmessage = (m) => {
    const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.bad(new Error(d.method + ' ' + JSON.stringify(d.error))) : p.ok(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails);
  };
}
let seq = 0, session = null;
const pend = new Map(), exceptions = [];
const cdp = (method, params = {}, sid = session) => new Promise((ok, bad) => { const id = ++seq; pend.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
}
async function until(expr, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(60); }
  return null;
}
async function open(width) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await cdp('Page.navigate', { url: ORIGIN + '/admin' });
  await until('document.readyState === "complete" && !!document.getElementById("adm-col")');
  return until('!document.getElementById("adm-col").hidden && (document.querySelectorAll("#adm-col-sets [data-col-set]").length > 0 || /⚠️/.test(document.getElementById("adm-col-sum").textContent))');
}
const status = () => ev('document.getElementById("adm-col-status").textContent');
const clickSet = (id) => ev('document.querySelector(\'#adm-col-sets [data-col-set="' + id + '"]\').click(), true');
const waitStatus = (re, ms) => until('(' + re + ').test(document.getElementById("adm-col-status").textContent) && !document.getElementById("adm-col-table").hasAttribute("aria-busy")', ms);
// what a reader can see: the page never wider than the screen; nothing in the section outside it except inside the table's own scroller; no text under the floor
const LAYOUT = `(() => {
  const sec = document.getElementById('adm-col'), sr = sec.getBoundingClientRect();
  const probe = document.createElement('span'); probe.style.fontSize = 'var(--text-floor)'; document.body.appendChild(probe);
  const floor = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
  const out = [], small = [];
  for (const el of sec.querySelectorAll('*')) {
    if (el.closest('[hidden]') || el.closest('.sr-only') || el.closest('details:not([open]) > :not(summary)')) continue;
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
    if (!el.closest('.adm-col-table') && (r.right > sr.right + 1 || r.left < sr.left - 1)) out.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText && parseFloat(getComputedStyle(el).fontSize) < floor - 0.5) small.push((el.className || el.tagName) + ' ' + getComputedStyle(el).fontSize);
  }
  return { sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth, secRight: Math.round(sr.right), floor, out: out.slice(0, 6), small: small.slice(0, 6) };
})()`;

let browserRan = false;
if (!CHROME) {
  if (process.env.CI) notes.push('skipping the browser checks: no Chrome or Chromium on this runner (set CHROME_PATH to run them)');
  else check('a Chrome or Chromium to drive the admin page in (set CHROME_PATH)', false, 'none found');
} else {
  try {
    await startChrome();
    const t = await cdp('Target.createTarget', { url: 'about:blank' }, null);
    session = (await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
    await cdp('Page.enable'); await cdp('Runtime.enable');
    browserRan = true;
  } catch (e) {
    if (process.env.CI) notes.push('skipping the browser checks: Chrome would not start here (' + e.message.slice(0, 160) + ')');
    else check('headless Chrome starts and takes commands', false, e.message);
  }
}

if (browserRan) {
  try {
    const want = LIST.datasets;
    const total = want.reduce((a, d) => a + (d.rows || 0), 0);
    /* — the list, at 1280 — */
    const shown = await open(1280);
    const sum = await ev('document.getElementById("adm-col-sum").textContent');
    check('signed in as the admin, the section opens and lists every dataset the server names, with the totals and when they were read',
      shown && (await ev('document.querySelectorAll("#adm-col-sets [data-col-set]").length')) === want.length
        && new RegExp('^' + want.length + ' datasets · ' + total.toLocaleString('en-US') + ' rows in all · read \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d UTC$').test(sum), sum);
    const cards = await ev('[...document.querySelectorAll("#adm-col-sets [data-col-set]")].map((b) => ({ id: b.dataset.colSet, t: b.innerText.replace(/\\s+/g, " "), pressed: b.getAttribute("aria-pressed"), tip: b.dataset.tip || "" }))');
    const card = (id) => cards.find((c) => c.id === id) || { t: '' };
    const snap = want.find((d) => d.id === 'mkt_chain_snap');
    const mm = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    check('  ...each card: its title, its row count, newest and oldest to the minute in UTC, and what it holds',
      card('mkt_chain_snap').t.includes('Chain snapshots') && card('mkt_chain_snap').t.includes('120 rows') && card('mkt_chain_snap').t.includes('newest ' + mm(snap.newestAt) + ' oldest ' + mm(snap.oldestAt))
        && card('mkt_chain_snap').t.includes(snap.description) && card('mkt_rh_pulse').t.includes('1 row '), card('mkt_chain_snap').t.slice(0, 200));
    check('  ...an empty dataset says "empty — nothing collected yet", never a zero dressed up as data; one with no times kept says so',
      /empty\s*nothing collected yet/.test(card('mkt_radar').t) && /no time kept with its rows/.test(card('mkt_chain_series').t), card('mkt_radar').t + ' | ' + card('mkt_chain_series').t.slice(0, 80));
    check('  ...every card is a real button with a description, none pressed until one is opened', cards.every((c) => c.pressed === 'false' && c.tip.length > 20)
      && (await ev('[...document.querySelectorAll("#adm-col-sets [data-col-set]")].every((b) => b.tagName === "BUTTON" && b.type === "button")')));

    /* — one dataset, paged — */
    const pagesBefore = log.filter((r) => r.path === '/api/admin/collected/mkt_chain_snap').length;
    await clickSet('mkt_chain_snap');
    const p1 = await waitStatus('/^Rows 1–50 of 120 · page 1$/');
    const req1 = log.filter((r) => r.path === '/api/admin/collected/mkt_chain_snap').slice(pagesBefore)[0] || {};
    check('opening a dataset asks for its first page (50 rows, no cursor, no search) and says which rows these are of how many', p1 && req1.method === 'GET' && req1.q.limit === '50' && !('before' in req1.q) && !('q' in req1.q), (await status()) + ' ' + JSON.stringify(req1.q));
    const head = await ev('[...document.querySelectorAll("#adm-col-table thead th")].map((th) => th.innerText.replace(/\\s+/g, " ").trim())');
    check('  ...the table heads are the server\'s labels, each with the stored column name under it', head.length === snap.columns.length && snap.columns.every((c, i) => head[i] === (c.label === c.name ? c.label : c.label + ' ' + c.name)), head.slice(0, 4).join(' | '));
    const r0 = SETS.mkt_chain_snap.rows[0];
    const cells = await ev('[...document.querySelectorAll("#adm-col-table tbody tr:first-child td")].map((td) => ({ t: td.innerText.trim(), c: td.className, time: td.querySelector("time") ? td.querySelector("time").getAttribute("datetime") : null }))');
    const ci = (name) => cells[snap.columns.findIndex((c) => c.name === name)] || {};
    check('  ...a time is shown in UTC from the stored milliseconds (kept in the cell\'s title), a number with every digit it was stored with (grouped in threes), a missing value as null — never 0',
      ci('at').t === new Date(r0.at).toISOString().slice(0, 19).replace('T', ' ') + ' UTC' && ci('at').time === new Date(r0.at).toISOString()
        && ci('tvl').t === r0.tvl.toLocaleString('en-US') && ci('tvl').t.replace(/,/g, '') === String(r0.tvl) && ci('app_fees_24h').t === 'null' && /adm-col-null/.test(ci('app_fees_24h').c) && ci('oi').t === 'null', JSON.stringify([ci('at'), ci('tvl'), ci('app_fees_24h')]));
    check('  ...the open card is pressed and says "open below" in words, and the table is a labelled region the keyboard can scroll',
      (await ev('(() => { const b = document.querySelector(\'[data-col-set="mkt_chain_snap"]\'); return b.getAttribute("aria-pressed") === "true" && /open below/.test(b.innerText) && document.querySelectorAll(\'[data-col-set][aria-pressed="true"]\').length === 1; })()'))
        && (await ev('(() => { const t = document.getElementById("adm-col-table"); return t.getAttribute("role") === "region" && t.tabIndex === 0 && /Chain snapshots/.test(t.getAttribute("aria-label")); })()')));
    check('  ...on the first page "Older →" is offered and "↑ Newest" is not', await ev('!document.getElementById("adm-col-older").hidden && document.getElementById("adm-col-newest").hidden'));
    await ev('document.getElementById("adm-col-older").click(), true');
    const p2 = await waitStatus('/^Rows 51–100 of 120 · page 2$/');
    const req2 = log.filter((r) => r.path === '/api/admin/collected/mkt_chain_snap').pop();
    check('"Older →" asks for the rows after the last one shown (before = its cursor) and counts on from there', p2 && req2.q.before === String(SETS.mkt_chain_snap.rows[49].id) && req2.q.limit === '50', (await status()) + ' ' + JSON.stringify(req2.q));
    await ev('document.getElementById("adm-col-older").click(), true');
    const p3 = await waitStatus('/^Rows 101–120 of 120 · page 3 · nothing after these$/');
    check('  ...the last page says nothing comes after it, and offers no "Older →"', p3 && (await ev('document.getElementById("adm-col-older").hidden && !document.getElementById("adm-col-newest").hidden && document.querySelectorAll("#adm-col-table tbody tr").length === 20')), await status());
    await ev('document.getElementById("adm-col-newest").click(), true');
    check('  ..."↑ Newest" goes back to the first page', !!(await waitStatus('/^Rows 1–50 of 120 · page 1$/')) && (await ev('document.getElementById("adm-col-newest").hidden')));

    /* — search — */
    await ev('document.getElementById("adm-col-q").value = "robinhood"; document.getElementById("adm-col-find").requestSubmit(), true');
    const s1 = await waitStatus('/matching “robinhood”/');
    const reqS = log.filter((r) => r.path === '/api/admin/collected/mkt_chain_snap').pop();
    const nRh = SETS.mkt_chain_snap.rows.filter((r) => r.chain === 'robinhood').length;
    check('a search is the server\'s: it asks with q from the first page, and says how many rows match, with a way to clear it',
      s1 && reqS.q.q === 'robinhood' && !('before' in reqS.q) && (await status()) === 'Rows 1–' + nRh + ' matching “robinhood” · page 1 · nothing after these' && (await ev('!document.getElementById("adm-col-clear").hidden')), (await status()) + ' ' + JSON.stringify(reqS.q));
    await ev('document.getElementById("adm-col-q").value = "zzz-no-such-thing"; document.getElementById("adm-col-find").requestSubmit(), true');
    check('  ...a search that matches nothing says so, and draws no table', !!(await waitStatus('/^No rows match “zzz-no-such-thing”\\.$/')) && (await ev('!document.querySelector("#adm-col-table table")')), await status());
    await ev('document.getElementById("adm-col-clear").click(), true');
    check('  ...Clear drops the search and shows the newest rows again', !!(await waitStatus('/^Rows 1–50 of 120 · page 1$/')) && (await ev('document.getElementById("adm-col-q").value === "" && document.getElementById("adm-col-clear").hidden')));

    /* — an empty dataset, long values, a failing read, a column the page must refuse — */
    await clickSet('mkt_radar');
    check('an empty dataset says nothing is in it yet — no table, no "Older →"', !!(await waitStatus('/^Nothing in this dataset yet — the server sent no rows\\.$/')) && (await ev('!document.querySelector("#adm-col-table table") && document.getElementById("adm-col-older").hidden')), await status());
    await clickSet('mkt_scan');
    await waitStatus('/^Rows 1–2 of 2 · page 1 · nothing after these$/');
    const scanJson = SETS.mkt_scan.rows[0].json;
    const longCell = await ev('(() => { const d = document.querySelector("#adm-col-table td.adm-col-long details"); return d ? { s: d.querySelector("summary").innerText, pre: d.querySelector("pre").textContent } : null; })()');
    check('a long value (a stored scan result) folds into a disclosure that names its length and opens to all of it, pretty-printed',
      longCell && longCell.s.includes('(' + scanJson.length.toLocaleString('en-US') + ' characters)') && JSON.stringify(JSON.parse(longCell.pre)) === JSON.stringify(JSON.parse(scanJson)), longCell && longCell.s);
    check('  ...and no cell is a link or a picture: addresses and upload paths are text', await ev('!document.querySelector("#adm-col-table a, #adm-col-table img")'));
    fake.fail.add('mkt_runs');
    await clickSet('mkt_runs');
    const failed = await until('/Could not read Collector runs: database is locked \\(500\\)\\. Nothing is shown rather than a guess\\./.test(document.getElementById("adm-col-table").textContent)');
    check('a dataset the server cannot read says so in its words, shows no rows, and the list stays', !!failed && (await ev('!document.querySelector("#adm-col-table table") && document.querySelectorAll("#adm-col-sets [data-col-set]").length')) === want.length);
    fake.fail.delete('mkt_runs');
    fake.trap.add('api_users');
    await clickSet('api_users');
    await waitStatus('/^Rows 1–2 of 2 · page 1/');
    const trap = await ev('(() => { const t = document.getElementById("adm-col-table"); return { note: (t.querySelector(".adm-col-refused") || {}).textContent || "", heads: [...t.querySelectorAll("thead th")].map((th) => th.innerText), html: t.innerHTML }; })()');
    check('a column whose name says it is private (address_enc, email) is never drawn even if the server sends it — the page names it as a server fault instead',
      /The server sent 2 columns this page never shows, because the name says it holds private data: address_enc, email\. They were left out\. That is a fault in the server — report it\./.test(trap.note)
        && !trap.heads.some((h) => /Linked wallet|Email/.test(h)) && !/TRAPCIPHER|trap@example\.com/.test(trap.html), trap.note);
    fake.trap.delete('api_users');

    /* — a late answer loses to a newer one — */
    fake.slow.set('mkt_chain_series', 900);
    await clickSet('mkt_chain_series');
    await sleep(80);
    await clickSet('holder_index');
    await waitStatus('/^Rows 1–3 of 3 · page 1 · nothing after these$/');
    await sleep(1200);
    check('a slow answer that arrives after another dataset was opened is dropped: the table stays on the newer one',
      (await ev('document.getElementById("adm-col-view-h").textContent')) === 'On-chain holder ledger' && /^Rows 1–3 of 3/.test(await status()) && (await ev('document.querySelectorAll("#adm-col-table tbody tr").length')) === 3, await status());
    fake.slow.clear();

    /* — refresh, and the list failing — */
    const lists = log.filter((r) => r.path === '/api/admin/collected').length, holders = log.filter((r) => r.path === '/api/admin/collected/holder_index').length;
    await ev('document.getElementById("adm-col-refresh").click(), true');
    await until('/^\\d+ datasets/.test(document.getElementById("adm-col-sum").textContent) && !document.getElementById("adm-col-table").hasAttribute("aria-busy")');
    await sleep(150);
    check('↻ Refresh reads the list again and the open table again, and keeps the open one open',
      log.filter((r) => r.path === '/api/admin/collected').length === lists + 1 && log.filter((r) => r.path === '/api/admin/collected/holder_index').length === holders + 1
        && (await ev('document.querySelector(\'[data-col-set="holder_index"]\').getAttribute("aria-pressed")')) === 'true');
    fake.list = 'fail';
    await ev('document.getElementById("adm-col-refresh").click(), true');
    const kept = await until('/^⚠️ Could not read the list of collected data: could not count the tables \\(500\\)\\. What is shown is from \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d UTC\\.$/.test(document.getElementById("adm-col-sum").textContent)');
    check('  ...a refresh that fails says so and when what is still shown was read', !!kept && (await ev('document.querySelectorAll("#adm-col-sets [data-col-set]").length')) === want.length, await ev('document.getElementById("adm-col-sum").textContent'));
    await open(1280);
    const none = await until('/^⚠️ Could not read the list of collected data: could not count the tables \\(500\\)\\. Nothing is shown rather than a guess\\.$/.test(document.getElementById("adm-col-sum").textContent)');
    check('a list that cannot be read on arrival shows nothing rather than a guess', !!none && (await ev('document.querySelectorAll("#adm-col-sets [data-col-set]").length === 0 && document.getElementById("adm-col-view").hidden')));
    fake.list = 'notfound';
    await open(1280);
    const nf = await until('/the server answered 404 — it does not offer this read/.test(document.getElementById("adm-col-sum").textContent)');
    check('  ...and a server without the route (404, not JSON) is said as that, not as an empty platform', !!nf, await ev('document.getElementById("adm-col-sum").textContent'));
    fake.list = 'ok';

    /* — every width from a 320px phone to a 2560px screen — */
    const fits = [];
    for (const w of [320, 375, 768, 1280, 1920, 2560]) {
      await open(w);
      const list = await ev(LAYOUT);
      await clickSet('mkt_pool_snap');
      await waitStatus('/^Rows 1–20 of 20/');
      const tbl = await ev(LAYOUT);
      const scroller = await ev('(() => { const t = document.getElementById("adm-col-table"); return { sw: t.scrollWidth, cw: t.clientWidth }; })()');
      fits.push({ w, list, tbl, scroller });
    }
    // against the width asked for, not innerWidth: an emulated phone widens its layout viewport to fit content that overflows
    const bad = fits.filter((f) => [f.list, f.tbl].some((l) => l.sw > f.w || l.bw > f.w || l.iw !== f.w || l.out.length || l.small.length) || f.scroller.cw > f.w);
    check('from 320 to 2560px: the page never scrolls sideways, nothing in the section leaves it, no text is under the floor — a wide table scrolls inside its own box',
      fits.length === 6 && !bad.length && fits.find((f) => f.w === 320).scroller.sw > fits.find((f) => f.w === 320).scroller.cw,
      bad.map((f) => f.w + 'px ' + JSON.stringify({ list: f.list, tbl: f.tbl, sc: f.scroller })).join(' | ') || fits.map((f) => f.w + ':' + f.tbl.floor.toFixed(1) + 'px').join(' '));
    const cols2560 = await ev('getComputedStyle(document.getElementById("adm-col-sets")).gridTemplateColumns.split(" ").length');
    check('  ...on a wide screen the dataset cards share the width (more than one column at 2560px), on a phone they stack', cols2560 > 1 && fits.find((f) => f.w === 320).list.out.length === 0, cols2560 + ' columns');

    /* — read-only, and quiet — */
    const touched = log.filter((r) => r.path.startsWith('/api/admin/collected'));
    check('the page only ever GETs /api/admin/collected and /api/admin/collected/<id> for this section — no write of any kind', touched.length > 15 && touched.every((r) => r.method === 'GET'), touched.length + ' requests');
    const ours = exceptions.filter((x) => /admin\.js/.test(JSON.stringify(x)));
    check('no script error from admin.js in any of it', ours.length === 0, ours.map((x) => (x.exception && x.exception.description || x.text || '').slice(0, 200)).join(' | '));
    if (exceptions.length > ours.length) notes.push((exceptions.length - ours.length) + ' script error(s) from other scripts on the faked page (not this section): ' + exceptions.filter((x) => !ours.includes(x)).map((x) => (x.exception && x.exception.description || x.text || '').split('\n')[0]).slice(0, 3).join(' | '));
  } catch (e) {
    console.error('ERROR', e && e.stack);
    check('the browser part ran to the end', false, e && e.message);
  }
}
try { if (ws) ws.close(); } catch {}
if (chrome) { try { chrome.kill('SIGKILL'); } catch {} await sleep(300); }
if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
site.close();

/* ═══ 3. the real server's answer, once it has the route ═══ */
const PORT = process.argv[2];
if (PORT && process.env.JSI_DATA_DIR && PORT !== '8642') {
  const { DatabaseSync } = await import('node:sqlite');
  const { DB_PATH } = await import('./_paths.mjs');
  const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
  const ADMIN_ID = 987654, NAME = '__admcol_admin__';
  let made = false, sidRaw = null;
  try {
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(ADMIN_ID)) {
      db.prepare('DELETE FROM users WHERE username = ?').run(NAME);
      db.prepare('INSERT INTO users (id, username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?,?)').run(ADMIN_ID, NAME, Date.now(), '🧪', Date.now(), 'ok');
      made = true;
    }
    sidRaw = 'tok_admcol_' + randomBytes(8).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(sidRaw).digest('hex'), ADMIN_ID, Date.now(), Date.now() + 864e5);
    const get = async (p) => { const r = await fetch('http://localhost:' + PORT + p, { headers: { Cookie: 'sid=' + sidRaw } }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
    const L = await get('/api/admin/collected');
    if (L.status === 404) notes.push('skipping the real-server checks: this server does not offer GET /api/admin/collected yet');
    else {
      const ds = L.j && Array.isArray(L.j.datasets) ? L.j.datasets : null;
      check('the real server: GET /api/admin/collected answers the admin with the list this page reads (id, title, rows, newest/oldest, labelled columns)',
        L.status === 200 && ds && ds.length > 0 && ds.every((d) => d.id != null && typeof d.title === 'string' && (d.rows === null || Number.isInteger(d.rows)) && (d.newestAt == null || typeof d.newestAt === 'number')
          && (d.oldestAt == null || typeof d.oldestAt === 'number') && Array.isArray(d.columns) && d.columns.every((c) => c && c.name != null && c.label != null)), L.status + ' ' + (ds ? ds.length + ' datasets' : JSON.stringify(L.j).slice(0, 200)));
      const served = new Set(), broken = [];
      for (const d of ds || []) {
        for (const c of d.columns || []) served.add(String(c.name));
        const P = await get('/api/admin/collected/' + encodeURIComponent(d.id) + '?limit=5');
        if (P.status !== 200 || !P.j || !Array.isArray(P.j.rows) || !Array.isArray(P.j.columns) || !('next' in P.j)) { broken.push(d.id + ' → ' + P.status); continue; }
        for (const c of P.j.columns) served.add(String(typeof c === 'string' ? c : c.name));
        for (const r of P.j.rows) if (r && !Array.isArray(r)) for (const k of Object.keys(r)) served.add(k);
      }
      check('  ...every dataset it lists can be read a page at a time ({ id, columns, rows, next })', ds && !broken.length, broken.join(', '));
      const refused = NEVER ? [...served].filter((n) => NEVER.test(n)) : ['no guard'];
      check('  ...and not one column it serves is one this page would refuse as private', !refused.length, refused.join(', '));
      const anon = await fetch('http://localhost:' + PORT + '/api/admin/collected');
      check('  ...while anyone who is not the admin gets the same 404 as for every admin route', anon.status === 404, anon.status);
    }
  } catch (e) {
    console.error('ERROR', e && e.stack);
    check('the real-server part ran to the end', false, e && e.message);
  } finally {
    try { if (sidRaw) db.prepare('DELETE FROM sessions WHERE token = ?').run(createHash('sha256').update(sidRaw).digest('hex')); } catch {}
    try { if (made) db.prepare('DELETE FROM users WHERE id = ?').run(ADMIN_ID); } catch {}
  }
} else notes.push('skipping the real-server checks: run by tests/run.mjs to drive its throwaway server');

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
for (const n of notes) console.log('NOTE ' + n);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
