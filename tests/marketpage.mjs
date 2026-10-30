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
      have a second network), so USDG sits at one address on two chains; the other seven networks are not read. Every chain's
      market cap in chains-*.json and chain-*.json (its `mcap` with its `check`) is lib/marketdata.js's own answer — a chains run,
      the daily references and a chains run again — on the CoinGecko, DefiLlama, CoinLore and asset-platform answers measured on
      2026-10-28 (owner: "make sure you are showing the right market caps for all of the chains pulled from multiple sources and
      cross verified"); chains-24h.json also carries Fantom, Morph and Stable as the live site served them that day, with theirs.
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
   And the 🏛️ RWAs tab (owner, 2026-10-28: "Add in a whole RWA section that just looks at Robinhood RWAs, make it tab on the
   market data page … filter them by TVL and Liquidity and Market Cap … what is an RWA vs not an RWA … the on-chain details
   page"): its markup and code from the source; its fixtures (rwa-*.json: lib/marketdata.js's own answers, dumped by
   tests/marketdata.mjs with MARKET_DUMP_DIR from the research's measured samples in tests/fixtures/marketdata/rwa-*.json — Top
   RWAs, every RWA token, the connected tokens, the stablecoins, TSLA's facts and the GameStop memecoin's 404) against the
   contract and against lib's real answers on a database seeded from those same samples; the fake's /api/market/rwa and
   /api/market/rwa/token; and in the browser, the tab at every width, its choices in the address, Back and Forward, the four
   views, and an RWA's facts on its token view (Robinhood's TSLA, Ondo's TSLAon, a read that fails, a token GeckoTerminal does
   not know that still has its RWA facts).
   And the 🫧 bubble map of the whole crypto market (owner, 2026-10-30: "a view like this that shows a 24 quick visual on the top tokens
   across the whole market"): its markup, code and styles from the source; heatmap.json (lib/marketdata.js's own answer, its heatmap job
   run on CoinGecko's and CoinLore's answers of 2026-10-30) against the contract and lib's real answer; its packing run in a vm (no
   overlap, all inside, the same every time); and in the browser at every width — the bubbles, their colours and labels, the choices,
   the tooltip, the card, the list by keyboard, folding it away, a read that fails, reduced motion.
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
const RW = require(path.join(ROOT, 'lib', 'rwa.js'));
const CM = require(path.join(ROOT, 'lib', 'chainmcap.js'));
const MM = require(path.join(ROOT, 'lib', 'marketmap.js'));
const MDFIX = (f) => JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'marketdata', f), 'utf8'));

const PUB = path.join(ROOT, 'public');
const FIXDIR = path.join(ROOT, 'tests', 'fixtures', 'market');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const FIX = (f) => JSON.parse(readFileSync(path.join(FIXDIR, f), 'utf8'));
// the Scanner's RWA card fixtures (tests/fixtures/rwacard/: lib's own rwa/token answers, frozen for tests/scanpage.mjs)
const RWACARD = (f) => JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'rwacard', f), 'utf8'));
const FIXMD = (f) => JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'marketdata', f), 'utf8'));   // the vendors' measured answers
const results = [], notes = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168', WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
// the RWA tab's: Robinhood's TSLA Stock Token, Ondo's TSLAon, SPY (a corporate action), GLD (outside the most-traded pools), the
// "GameStop" memecoin (GME, a lookalike of Robinhood's GME), mGLO (Midas)
const TSLA = '0x322f0929c4625ed5bad873c95208d54e1c003b2d', TSLAON = '0xb197f36c25ba9b66960688882a4dc595c6b04309', GME_MEME = '0x7e86381a763f0ecca2bdf27c54eac403ddd48123';
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
const FAKE = { log: [], unavailable: new Set(), zeroReserve: false, candleGaps: false, customNoCandles: false, searchWhy: null, searchExtra: null, pulse: null, tokensDelay: null, rwaList: null, rwaDown: false, rwaTokenDown: false, rwaDelay: 0, heatmapDown: false, heatmapPatch: null };
// the logo proxy: DefiLlama's chain icons draw (any PNG will do for the walk) except Solana's, which fails as a missing picture does
const LOGO_PNG = readFileSync(path.join(PUB, 'assets', 'logo-128.png')), LOGO_BROKEN = /rsz_solana/;
const none = (why, src, at) => ({ v: null, src, at, why });
/* ── the RWA tab: lib/marketdata.js's own answers (the rwa-*.json fixtures), filtered and sorted here as the server does it
   (lib/marketdata.js rwa(): a missing figure last both ways; an every-chain market cap kept out of the tokens' market-cap
   ranking; Connected tokens by the pool's reserve or volume; Stablecoins by what circulates or liquidity) ── */
const RWA_GET = { value: (r) => v(r.value), tvl: (r) => v(r.tvl), liquidity: (r) => v(r.liquidity), mcap: (r) => v(r.mcap), volume: (r) => v(r.volume24h), premium: (r) => v(r.premium) };
const RWA_FILE = { assets: 'rwa-assets.json', tokens: 'rwa-tokens.json', connected: 'rwa-connected.json', stables: 'rwa-stables.json' };
const rwaNullLast = (dir, get) => (a, b) => { const x = get(a), y = get(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return dir === 'asc' ? x - y : y - x; };
function fakeRwa(q) {
  if (FAKE.rwaDown) return [503, { error: 'The RWA list could not be read just now.' }];
  const one = (x, list, d) => (list.includes(x) ? x : d);
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);   // as lib: own keys only (never ?sort=__proto__)
  const view = one(q.get('view'), ['assets', 'tokens', 'stables', 'connected'], 'assets'), sort = own(RWA_GET, q.get('sort')) ? q.get('sort') : 'value', dir = q.get('dir') === 'asc' ? 'asc' : 'desc';
  const kind = one(q.get('kind'), ['all', 'stock', 'etf', 'bond', 'commodity', 'credit'], 'all'), issuer = own(RW.ISSUERS, q.get('issuer')) ? q.get('issuer') : 'all';
  const limit = Math.min(300, Math.max(1, Number(q.get('limit')) || 300));
  const j = FIX(RWA_FILE[view]), tokens = FIX('rwa-tokens.json').rows, rowOf = (a) => tokens.find((x) => x.address === a) || {};
  let rows, notes = j.notes.slice();
  if (view === 'stables') {
    rows = j.rows.slice().sort(rwaNullLast(dir, (r) => (sort === 'liquidity' ? v(r.liquidity) : v(r.circulating))));
    notes = notes.map((n) => n.replace(/^Ranked by (liquidity|what circulates on the chain) \(/, 'Ranked by ' + (sort === 'liquidity' ? 'liquidity' : 'what circulates on the chain') + ' ('));
  } else if (view === 'connected') {
    rows = j.rows.filter((r) => issuer === 'all' || (rowOf(r.rwa.address).issuer || {}).key === issuer).filter((r) => kind === 'all' || (rowOf(r.rwa.address).underlying || {}).kind === kind)
      .sort(rwaNullLast(dir, (r) => (sort === 'volume' ? v(r.volume24h) : v(r.reserveUsd))));
    notes = notes.map((n) => n.replace(/^Ranked by the pool's (reserve|24 h volume)\./, 'Ranked by ' + (sort === 'volume' ? 'the pool\'s 24 h volume' : 'the pool\'s reserve') + '.'));
  } else {
    // Top RWAs by an issuer: each group built from that issuer's tokens only (lib/rwa.js groupRows over them), as lib does
    const src = view === 'assets' && issuer !== 'all' ? RW.groupRows(tokens.filter((r) => r.issuer.key === issuer), j.at) : j.rows;
    // a market cap that is CoinGecko's every-chain figure alone is kept out of the ranking, a token's or a group's (lib: a group's is this chain's figures only)
    rows = src.filter((r) => kind === 'all' || r.underlying.kind === kind).filter((r) => issuer === 'all' || (view === 'assets' ? r.issuers.every((x) => x.key === issuer) : r.issuer.key === issuer))
      .sort(rwaNullLast(dir, sort === 'mcap' ? (r) => (r.mcap.global ? null : v(r.mcap)) : RWA_GET[sort]));
    if (sort === 'mcap' && view === 'assets') notes.splice(notes.findIndex((n) => /^Highest and lowest/.test(n)) + 1, 0, 'A row\'s market cap is this chain\'s figures only: CoinGecko\'s every-chain figure for Ondo\'s and Anchored\'s tokens (which live on several chains) is kept apart, never added in — and a row whose only market cap is that figure is kept out of the ranking and listed last.');
    if (view === 'tokens' && sort === 'mcap') notes.splice(notes.findIndex((n) => /^Highest and lowest/.test(n)) + 1, 0, 'A market cap that is CoinGecko\'s every-chain figure (Ondo\'s and Anchored\'s tokens, which live on several chains) is kept out of the market-cap ranking and listed last.');
    if (view === 'assets' && issuer !== 'all') notes.splice(notes.findIndex((n) => /^Highest and lowest/.test(n)) + 1, 0, 'Each row here is built from ' + RW.ISSUERS[issuer].name + '\'s tokens only: its figures, its premium and how sure the site is are that issuer\'s token\'s.');
  }
  /* a kind or an issuer chosen: the counted tokens among the rows summed apart (lib's totalsShown, by its own sums), the totals the whole chain's */
  let shown = {};
  if ((view === 'assets' || view === 'tokens') && (kind !== 'all' || issuer !== 'all')) {
    const mine = tokens.filter((r) => r.confidence !== 'not-confirmed' && (kind === 'all' || r.underlying.kind === kind) && (issuer === 'all' || r.issuer.key === issuer));
    const lab = (w, tail) => w + ' of the ' + mine.length + ' RWA token' + (mine.length === 1 ? '' : 's') + ' counted among these' + (tail || '');
    shown = { totalsShown: { count: mine.length, value: RW.sumFig(mine, 'value', lab('value on chain'), 'site'), liquidity: RW.tokSumFig(mine, 'liquidity', lab('GeckoTerminal\'s liquidity figures', ', added up')),
      tvl: RW.sumFig(mine, 'tvl', lab('deposited in DeFi apps on Robinhood Chain', ' (DefiLlama, matched by symbol)'), 'defillama'), volume24h: RW.tokSumFig(mine, 'volume', lab('GeckoTerminal\'s 24 h volume figures', ', added up')) } };
    notes.push('The totals are the whole chain\'s, every kind and issuer — the counted tokens among the rows shown are summed apart, beside them.');
  }
  const body = Object.assign({}, j, { view, sort, dir, kind, issuer, total: rows.length, rows: rows.slice(0, limit), notes }, shown);
  return [200, FAKE.rwaList ? FAKE.rwaList(body) : body];
}
/* one token's RWA facts: TSLA's and the memecoin's 404 are lib's own answers; any other RWA token's is built here from its row as
   lib/marketdata.js rwaToken() builds it, from the same stores the dump read (TSLA's for what is the same for every Stock Token —
   the registry's controls, its roles, the reads; the research's chain reads for another issuer's beacon and implementation), and
   checked against lib's real answers below (section 6) */
const RWA_STATE = { actions: () => RW.parseRhjActions(FIXMD('rwa-rhj-corporate-actions.json')).actions, feeds: () => RW.parseChainlinkDirectory(FIXMD('rwa-chainlink-feeds.json')).feeds, reads: () => FIXMD('rwa-rpc-reads.json') };
function fakeRwaTokenBuilt(addr) {
  const row = FIX('rwa-tokens.json').rows.find((r) => r.address === addr); if (!row) return null;
  const T = FIX('rwa-token-' + TSLA + '.json'), RR = RWA_STATE.reads(), rhj = row.issuer.key === 'rhj', midas = row.issuer.key === 'midas';
  const beacon = rhj ? RW.ISSUERS.rhj.registry : midas ? null : RR.beacons[addr] || null, implAddr = rhj ? T.controls.implementation.address : midas ? RR.implementations[addr] || null : beacon ? RR.beaconImpl[beacon] || null : null;
  const controls = rhj ? T.controls : { kind: midas ? 'ERC-1967 proxy' : 'beacon proxy', beacon, registry: null,
    implementation: implAddr ? { address: implAddr, src: 'rpc', at: T.controls.implementation.at } : { address: null, src: 'rpc', at: null, why: 'not read on the chain yet' },
    verifiedSource: null, verifiedWhy: 'this site has not checked a verified source for this issuer\'s code', powers: [],
    powersWhy: 'This site reads the roles of Robinhood\'s registry only; this issuer\'s contract keeps powers of its own (see what you hold).', note: T.controls.note };
  const feed = rhj ? RWA_STATE.feeds().find((x) => x.ticker === String(row.symbol).toUpperCase() && x.ref !== false) || null : null, cl = row.reference.chainlink;   // a feed that prices the share (not GLD / USD)
  const chainlink = feed ? (feed.proxy === T.chainlink.proxy ? T.chainlink : { proxy: feed.proxy, name: feed.name, description: null, answer: v(cl), updatedAt: null, heartbeat: feed.heartbeat, stale: !!cl.stale, at: T.chainlink.at }) : null;
  return Object.assign({}, row, {
    issuerProfile: RW.issuerProfile(row, rhj ? { terms: T.issuerProfile.terms.v, termsAt: T.issuerProfile.terms.at } : {}), controls,
    roles: rhj ? T.roles : [], rolesAt: T.rolesAt, rolesRead: rhj ? T.rolesRead : null, blocked: rhj ? T.blocked : null,
    corporateActions: RWA_STATE.actions().filter((x) => x.address === addr).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
    connected: FIX('rwa-connected.json').rows.filter((c) => c.rwa.address === addr), lookalikes: [],
    // where its connected tokens come from: TSLA's own pools were read (lib's answer); any other token's only from the most-traded pools kept (lib's words for WEEK's)
    connectedBasis: addr === TSLA ? T.connectedBasis : RWACARD('rwa-token-week.json').connectedBasis,
    chainlink, ...(chainlink ? {} : { chainlinkWhy: rhj ? (cl && cl.notReference ? cl.why : 'Chainlink\'s public directory lists no feed for this ticker') : 'Chainlink\'s Robinhood feeds price Robinhood\'s Stock Tokens only' }),
    deployer: rhj ? T.deployer : null, reads: T.reads, at: T.at, notes: T.notes, definitions: T.definitions, sources: T.sources,
  });
}
function fakeRwaToken(q) {
  const addr = String(q.get('address') || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return [400, { error: 'enter a token address (0x…, Robinhood Chain)' }];
  if (FAKE.rwaTokenDown) return [503, { error: 'The RWA facts could not be read just now.' }];
  const f = 'rwa-token-' + addr + '.json', nf = 'rwa-token-notrwa-' + addr + '.json';
  if (existsSync(path.join(FIXDIR, f))) return [200, FIX(f)];
  if (existsSync(path.join(FIXDIR, nf))) return [404, FIX(nf)];
  const built = fakeRwaTokenBuilt(addr);
  if (built) return [200, built];
  // not an RWA here: which evidence is missing, in lib's own words (lib/rwa.js notRwaWhy)
  const stable = FIX('rwa-stables.json').rows.find((x) => x.address === addr) || null, seen = FIX('tokens-robinhood-24h.json').rows.find((x) => x.address === addr), symbol = seen ? seen.symbol : null;
  const meme = FIX('rwa-token-notrwa-' + GME_MEME + '.json');
  const tw = !stable ? RW.twinOf(addr, symbol, FIX('rwa-tokens.json').rows) : null;
  return [404, { notRwa: true, address: addr, ...(symbol ? { symbol } : {}), ...(stable ? { stablecoin: true } : {}),
    why: RW.notRwaWhy(addr, null, { stable, symbol, rows: FIX('rwa-tokens.json').rows, registryRead: true, beaconRead: false }),
    ...(tw ? { twin: { address: tw.address, symbol: tw.symbol, name: tw.name, issuer: tw.issuer, confidence: tw.confidence, registry: tw.evidence.some((e) => e.tier === 'A1') } } : {}), notes: meme.notes }];
}
// the RWA row a token answer carries (the token view's rwa key): its row on Robinhood Chain, null for anything not an RWA here
const fakeRwaRow = (chain, addr) => (chain === 'robinhood' ? FIX('rwa-tokens.json').rows.find((r) => r.address === addr) || null : null);
// a token that only wears an RWA's ticker: the lookalike answer (lib's rwaLookalike: the 404 body that names its twin), null for anything else
const fakeLookalike = (chain, addr) => { if (chain !== 'robinhood' || fakeRwaRow(chain, addr)) return null; const [code, b] = fakeRwaToken(new URLSearchParams({ address: addr })); return code === 404 && b && !b.stablecoin && b.twin && /^Same ticker as \$/.test(String(b.why || '')) ? b : null; };
const rwaKept = (chain, addr) => (chain === 'robinhood' ? { rwa: fakeRwaRow(chain, addr), rwaLookalike: fakeLookalike(chain, addr) } : {});
/* the bubble map (/api/market/heatmap): lib/marketdata.js's own answer (heatmap.json, its job run on CoinGecko's and CoinLore's answers
   of 2026-10-30), cut as the route cuts it — the largest `limit` coins (20 to 100), the stablecoins among them left out with stables=0 */
function fakeHeatmap(q) {
  if (FAKE.heatmapDown) return [503, { error: 'The market map could not be read just now' }];
  const j = FAKE.heatmapPatch ? FAKE.heatmapPatch(FIX('heatmap.json')) : FIX('heatmap.json'), n = Number(q.get('limit')), limit = q.get('limit') != null && q.get('limit') !== '' && Number.isFinite(n) ? Math.min(100, Math.max(20, Math.round(n))) : 100;
  const stables = !(q.get('stables') === '0' || q.get('stables') === 'false');
  let rows = j.rows.slice(0, limit); if (!stables) rows = rows.filter((r) => r.stable !== true);
  const counts = { up: 0, down: 0, flat: 0, none: 0, drawn: 0 };
  for (const r of rows) { if (r.mcap.v == null) continue; counts.drawn++; const c = r.change24h.v; if (c == null) counts.none++; else if (c === 0) counts.flat++; else if (c > 0) counts.up++; else counts.down++; }
  return [200, Object.assign({}, j, { limit, stables, rows, counts })];
}
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
    if (FAKE.unavailable.has(addr)) return [200, Object.assign({ chain, address: addr, unavailable: true, why: 'GeckoTerminal is being asked a lot right now — try again in a minute', scanner, at: Date.now() }, rwaKept(chain, addr))];
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
          rwa: fakeRwaRow(chain, addr), rwaLookalike: fakeLookalike(chain, addr),
          candles: { tf: 'hour', pool: null, rows: [], src: 'geckoterminal', partialLast: true, note: 'The newest candle is the hour still in progress. An hour with no candle had no trades.' } };
      }
    }
    if (!j) return [404, Object.assign({ error: 'GeckoTerminal does not know this token on ' + chain }, rwaKept(chain, addr))];
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
  if (p === '/api/market/rwa') return fakeRwa(q);
  if (p === '/api/market/rwa/token') return fakeRwaToken(q);
  if (p === '/api/market/heatmap') return fakeHeatmap(q);
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
        if (what === 'rwa' && FAKE.rwaDelay) await new Promise((r) => setTimeout(r, FAKE.rwaDelay));
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
  // Ethereum's market-cap check as the chains run stores it: lib/chainmcap.js on CoinGecko's, DefiLlama's and CoinLore's answers of 2026-10-28
  const cgE = CM.cgCoin(MDFIX('mcap-cg-markets.json').find((x) => x.id === 'ethereum'), T), loreE = CM.loreCoin(Object.values(MDFIX('mcap-lore-tickers.json').pages).flat().find((x) => String(x.id) === '80'), T);
  const relE = MDFIX('mcap-llama-mcaps.json')['coingecko:ethereum'], xE = CM.crossCheck({ sym: cgE.symbol, cg: cgE, relay: { v: relE.mcap, at: relE.timestamp * 1000 }, lore: CM.matchCoin(cgE, [loreE]).coin, now: T });
  const ETH_CHECK = JSON.stringify(Object.assign({ coin: { id: 'ethereum', symbol: cgE.symbol, name: cgE.name, price: cgE.price } }, xE.check, { mapping: { status: 'confirmed' } }));
  const db = new DatabaseSync(':memory:'); MD.migrate(db);
  const ins = (table, row) => { const k = Object.keys(row); db.prepare('INSERT INTO ' + table + ' (' + k.join(', ') + ') VALUES (' + k.map(() => '?').join(', ') + ')').run(...k.map((c) => row[c])); };
  for (const [chain, name, id, stage, l2] of [['robinhood', 'Robinhood Chain', 4663, 'Stage 0', 1], ['ethereum', 'Ethereum', 1, null, 0], ['base', 'Base', 8453, 'Stage 1', 1], ['solana', 'Solana', null, null, 0]]) {
    ins('mkt_chain_snap', { chain, name, chain_id: id, at: T, tvl: 1e9, dex_vol_24h: 5e8, dex_vol_30d: 2e10, fees_24h: 3e4, fees_7d: 2e5, fees_30d: 9e5, app_fees_24h: 1e6, stables: 1e9, oi: 3e8, dex_liq: 4e8, mcap_check: chain === 'ethereum' ? ETH_CHECK : null,
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
  pool(4, '0x' + '7e'.repeat(20), TSLA, 'TSLA', 'Tesla • Robinhood Token', 1121369);   // an RWA's pool: Robinhood's TSLA Stock Token
  pool(1, '0x' + 'ba'.repeat(20), '0x' + '83'.repeat(20), 'BTK', 'A Base token', 5e6, 'base');   // Base's pools are read too, so its top tokens carry no "not read"
  // a pools run marks its batch finished only after its last page; the answers serve the newest finished batch, never one still being written
  for (const [net, n] of [['robinhood', 4], ['base', 1]]) db.prepare('INSERT INTO mkt_state (name, value, at) VALUES (?, ?, ?)').run('pools:' + net, JSON.stringify({ at: T, pages: 1, pools: n, wanted: 1, why: null, ended: T }), T);
  /* the RWA job's stores, as it keeps them, from the research's measured samples (tests/fixtures/marketdata/rwa-*.json) — Robinhood's
     registry, quotes, corporate actions and deviations, Chainlink's directory, the stablecoins, one DeFi app's deposits (and one app
     not read, as on the day the fixtures were dumped), the registry's role logs and its holders' kind, what the chain answered for TSLA
     and Ondo's TSLAon (the beacon slot, the supply, the flags, the multiplier, terms(), each beacon's implementation, TSLA's feed),
     TSLA's own pools; and the "GameStop" memecoin, scanned on this site */
  const stSet = (name, value) => db.prepare('INSERT INTO mkt_state (name, value, at) VALUES (?, ?, ?)').run(name, JSON.stringify(value), T);
  for (const [name, parse, file] of [['rhj_assets', RW.parseRhjAssets, 'rwa-rhj-assets.json'], ['rhj_prices', RW.parseRhjPrices, 'rwa-rhj-prices.json'], ['rhj_actions', RW.parseRhjActions, 'rwa-rhj-corporate-actions.json'],
    ['rhj_deviations', RW.parseRhjDeviations, 'rwa-rhj-price-deviations.json'], ['chainlink_rh', RW.parseChainlinkDirectory, 'rwa-chainlink-feeds.json'], ['rwa_stables', RW.parseStablecoins, 'rwa-llama-stablecoins.json']]) stSet(name, { readAt: T, data: parse(FIXMD(file)) });
  const mb = RW.parseLlamaProtocol(FIXMD('rwa-llama-protocol-morpho-blue.json'));
  stSet('rwa_tvl', { readAt: T, picks: ['morpho-blue', 'longbow'], reads: { 'morpho-blue': { ok: true, at: T, name: mb.name, category: mb.category, date: mb.date, tokens: mb.tokens } }, failed: ['longbow (upstream 404)'] });
  const RR = FIXMD('rwa-rpc-reads.json'), REG = RW.ISSUERS.rhj.registry, big = (h) => BigInt(h).toString(), feed = Object.keys(RR.feeds)[0];
  const SPYA = FIXMD('rwa-rhj-assets.json').assets.find((a) => a.tokenSymbol === 'SPY').deployments.find((d) => d.chainId === 4663).contractAddress.toLowerCase();
  const units = (x, d) => { const [i, fr = ''] = String(x).split('.'); return (BigInt(i) * 10n ** BigInt(d) + BigInt((fr + '0'.repeat(d)).slice(0, d) || '0')).toString(); };
  stSet('rwa_chain', { stateAt: T,
    tokens: { [TSLA]: { beacon: RR.beacons[TSLA], beaconAt: T, fpAt: T, supplyRaw: big(RR.tsla.totalSupply), supplyAt: T, tokenPaused: RR.tsla.tokenPaused, tokenPausedAbsent: false, oraclePaused: RR.tsla.oraclePaused, oraclePausedAbsent: false,
      uiMultiplier: big(RR.tsla.uiMultiplier), newUIMultiplier: big(RR.tsla.newUIMultiplier), effectiveAt: big(RR.tsla.effectiveAt), stateAt: T },
    [TSLAON]: Object.assign({ beacon: RR.beacons[TSLAON], beaconAt: T, fpAt: T, supplyRaw: units(RR.supplies[TSLAON], RR.meta[TSLAON].decimals), supplyAt: T, metaAt: T }, RR.meta[TSLAON]),
    [SPYA]: { beacon: RR.beacons[SPYA], beaconAt: T, fpAt: T } },   // SPY's beacon slot as the research read it
    registry: { terms: RR.tsla.terms, termsAt: T }, beacons: Object.fromEntries(Object.entries(RR.beaconImpl).map(([b, i]) => [b, { implementation: i, at: T }])),
    feeds: { [feed]: { answer: RR.feeds[feed].answer, updatedAt: RR.feeds[feed].updatedAt, description: RR.feeds[feed].description, absent: false, at: T } } });
  const logs = FIXMD('rwa-rpc-registry-logs.json'), head = Math.max(...logs.map((l) => parseInt(l.blockNumber, 16)));
  stSet('rhj_roles', Object.assign(RW.foldRegistryLogs({}, logs), { cursor: head, head, readAt: T, complete: true, walkedAt: T,
    kinds: Object.fromEntries(Object.entries(RR.holderCode).map(([a, code]) => [a, { kind: code === '0x' ? 'wallet' : 'contract', at: T }])) }));
  stSet('rwa_connected', { cycleAt: T, doneAt: T, top: [TSLA, SPYA], reads: { [TSLA]: { at: T, triedAt: T, tries: 1, ok: true, pools: RW.parseGtTokenPools(FIXMD('rwa-gt-token-pools-tsla.json')).pools.slice(0, 30) },
    [SPYA]: { ok: false, pools: [], triedAt: T, tries: 3, failAt: T, failWhy: 'upstream 404' } } });
  stSet('rwa_gt', { readAt: T, tokens: {} });
  const meme = FIXMD('rwa-cg-lookalikes.json').find((c) => c.platforms && c.platforms.robinhood === GME_MEME);
  stSet('rwa_seen', { at: T, tokens: [{ address: GME_MEME, symbol: meme.symbol, name: meme.name, src: 'scan' }] });
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
  out.rwa = { assets: J(md.rwa({})), tokens: J(md.rwa({ view: 'tokens' })), connected: J(md.rwa({ view: 'connected' })), stables: J(md.rwa({ view: 'stables' })),
    assetsOndo: J(md.rwa({ issuer: 'ondo' })), tokensStock: J(md.rwa({ view: 'tokens', sort: 'tvl', dir: 'asc', kind: 'stock' })),
    tsla: J(md.rwaToken({ address: TSLA })), spy: J(md.rwaToken({ address: SPYA })), ondo: J(md.rwaToken({ address: TSLAON })), notRwa: J(md.rwaToken({ address: GME_MEME })), notRwaStatus: md.rwaToken({ address: GME_MEME }).status, notRwaStable: J(md.rwaToken({ address: USDG })) };
  out.tokenTsla = J(await md.token({ chain: 'robinhood', address: TSLA }));
  // the bubble map's store as its job keeps it: CoinGecko's and CoinLore's answers of 2026-10-30, parsed by lib/marketmap.js, each part
  // { readAt, … } (tests/marketdata.mjs runs the job itself)
  const hm = { coins: MM.parseMarkets(FIXMD('heatmap-cg-top100.json'), T), global: MM.parseGlobal(FIXMD('heatmap-cg-global.json')), stables: MM.parseStables(FIXMD('heatmap-cg-stables.json')), lore: MM.parseLore(FIXMD('heatmap-lore-top100.json'), T) };
  stSet('heatmap', Object.fromEntries(Object.entries(hm).map(([k, p]) => { const o = Object.assign({ readAt: T }, p); delete o.ok; return [k, o]; })));
  out.heatmap = J(md.heatmap({})); out.heatmapCut = J(md.heatmap({ limit: '50', stables: '0' }));
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
// how far the bubble map (above the two columns) moves everything under it: offsets measured before it was added are kept by adding it
const MAPSHIFT = '(() => { const m = document.getElementById("mkt-map"); return m ? m.getBoundingClientRect().height + parseFloat(getComputedStyle(m).marginBottom) : 0; })()';
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
      finally { Object.assign(FAKE, { pulse: null, zeroReserve: false, candleGaps: false, customNoCandles: false, searchWhy: null, searchExtra: null, tokensDelay: null, rwaList: null, rwaDown: false, rwaTokenDown: false, rwaDelay: 0, heatmapDown: false, heatmapPatch: null }); FAKE.unavailable.clear(); }
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
      await ev('window.scrollTo({ top: 900 + ' + MAPSHIFT + ', behavior: "instant" }), true'); await sleep(300);
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
      await ev('window.scrollTo({ top: 900 + ' + MAPSHIFT + ', behavior: "instant" }), true'); await sleep(300);
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

    /* ── the 🏛️ RWAs tab (owner, 2026-10-28): Robinhood Chain's real-world-asset tokens, and an RWA's facts on its token view ── */
    const rwaAsks = (from) => FAKE.log.slice(from).filter((x) => x.startsWith('/api/market/rwa'));
    const rwaReady = () => until('!document.querySelector("#mkt-cap .mkt-loading") && document.querySelectorAll("#mkt-list .mkt-row, #mkt-list .mkt-empty").length > 0 && /Robinhood Chain|Connected tokens|Stablecoins/.test(document.getElementById("mkt-cap").textContent)');
    const rwaRows = () => ev('[...document.querySelectorAll("#mkt-list > li > .mkt-row")].map((b) => ({ tag: b.tagName, t: b.dataset.token || "", c: b.dataset.chain || "", text: b.textContent, tip: b.dataset.tip || "", conf: (b.querySelector(".mkt-conf") || {}).textContent || "", flags: [...b.querySelectorAll(".mkt-flag")].map((x) => x.textContent), fig: (b.querySelector(".mkt-fig") || {}).textContent || "", cur: b.getAttribute("aria-current") === "true" }))');
    const rwaPressed = () => ev('[...document.querySelectorAll("#mkt-ctl-rwa [aria-pressed=\\"true\\"]")].filter((b) => !b.closest("[hidden]")).map((b) => Object.entries(b.dataset).filter(([k]) => /^r(view|sort|dir|kind|issuer)$/.test(k)).map(([k, x]) => k.slice(1) + "=" + x).join()).join(" ")');
    const rwaClick = (attr, val) => ev('(() => { const b = [...document.querySelectorAll("#mkt-ctl-rwa [data-' + attr + '=\\"' + val + '\\"]")].find((x) => !x.closest("[hidden]")); b.click(); return true; })()');
    const rwaAll = async () => { for (let i = 0; i < 8 && await ev('!!document.querySelector("#mkt-more [data-more]")'); i++) { await ev('document.querySelector("#mkt-more [data-more]").click(), true'); await sleep(60); } };
    const cardReady = () => until('document.querySelectorAll("#mkt-rwa-host .mkt-rwa-c").length >= 7 && !document.getElementById("mkt-rwa-host").hasAttribute("aria-busy")', 10000);
    const CARD = `(() => { const host = document.getElementById("mkt-rwa-host"); if (!host) return null; const secs = [...host.querySelectorAll("section.mkt-rwa-c")];
      const txt = (id) => (host.querySelector('[aria-labelledby="' + id + '"]') || {}).textContent || "";
      return { ids: secs.map((x) => x.getAttribute("aria-labelledby")).join(), heads: secs.every((x) => x.querySelector("h3.mkt-h3").id === x.getAttribute("aria-labelledby")),
        after: !!document.querySelector("#mkt-tstats + #mkt-rwa-host"), next: host.nextElementSibling ? host.nextElementSibling.getAttribute("aria-labelledby") : null,
        s1: txt("mkt-rw1-h"), s2: txt("mkt-rw2-h"), s3: txt("mkt-rw3-h"), s4: txt("mkt-rw4-h"), s5: txt("mkt-rw5-h"), s6: txt("mkt-rw6-h"), s7: txt("mkt-rw7-h"),
        links: [...host.querySelectorAll('[aria-labelledby="mkt-rw2-h"] a')].map((a) => a.getAttribute("href") + "|" + a.rel + "|" + a.target),
        holders: [...host.querySelectorAll('[aria-labelledby="mkt-rw6-h"] a.mkt-addr-l')].map((a) => a.getAttribute("href")),
        conn: [...host.querySelectorAll('[aria-labelledby="mkt-rw7-h"] .mkt-row')].map((b) => ({ t: b.dataset.openToken, text: b.textContent, tip: b.dataset.tip || "" })),
        copies: [...host.querySelectorAll("button.copy-btn")].every((b) => b.dataset.copy && (b.dataset.tip || "").length >= 8 && b.getAttribute("aria-label")),
        lede: (host.querySelector(".mkt-rwa-lede") || {}).textContent || "", foot: (host.querySelector(".mkt-rwa-foot") || {}).textContent || "", all: host.textContent, kicker: (document.querySelector(".mkt-kicker") || {}).textContent || "" }; })()`;
    const noZero = (t) => !/\$0(?![.\d,₀-₉])/.test(t);   // a figure never read is never "$0"

    await step('the RWAs tab and an RWA\'s facts at every width', async () => {
      const fits = [];
      for (const w of [320, 390, 1280, 1920]) {
        const a = await go('/market?tab=rwa', w) && await rwaReady(); const listL = await ev(LAYOUT);
        const b = await go('/market?chain=robinhood&tab=rwa&rview=tokens', w) && await rwaReady(); await rwaAll(); const tokL = await ev(LAYOUT);
        const c = await go('/market?chain=robinhood&token=' + TSLA + '&tab=rwa', w) && await cardReady(); const cardL = await ev(LAYOUT);
        fits.push({ w, ok: !!(a && b && c), a: !!a, b: !!b, c: !!c, listL, tokL, cardL });
      }
      const bad = fits.filter((x) => !x.ok || [x.listL, x.tokL, x.cardL].some((l) => l.sw > l.iw || l.out.length || l.small.length));
      check('in a real browser at 320, 390, 1280 and 1920 px the RWAs tab (Top RWAs, and every RWA token in full) and TSLA\'s RWA facts draw in full: no sideways scroll, nothing outside the page\'s column, no text under the floor',
        fits.length === 4 && !bad.length, bad.map((x) => x.w + 'px ' + (x.ok ? '' : 'did not draw (list ' + x.a + ', tokens ' + x.b + ', card ' + x.c + ') ') + JSON.stringify({ l: x.listL, t: x.tokL, c: x.cardL }).slice(0, 400)).join(' | '));
    });

    /* the review (2026-10-28): the RWA tab's controls and caption pushed its first row 2,385 px down the side column at 1280 (Top tokens:
       1,149), and TSLA's RWA facts took 14,770 px before its trading, chart and pools. Now Order, Kind and Issuer are one pop-down and the
       caption one line plus the totals; on the token view parts 2–7 are pop-downs with a line of what matters. Measured, not assumed. */
    await step('the RWAs tab and an RWA\'s facts take a few screens, never sixteen', async () => {
      const M = [];
      const firstRow = 'Math.round(document.querySelector("#mkt-list > li > .mkt-row").getBoundingClientRect().top - document.querySelector("#mkt-side [role=tablist]").getBoundingClientRect().bottom)';
      for (const w of [390, 1280]) {
        await go('/market?chain=robinhood', w); await listReady(); await ev('document.getElementById("mkt-tab-tokens").click(), true'); await listReady(); await sleep(150);
        const tok = await ev(firstRow);
        await go('/market?tab=rwa', w); await rwaReady(); const rwa = await ev(firstRow);
        const filt = await ev('(() => { const d = document.getElementById("mkt-rf"), s = d && d.querySelector("summary"); return d ? { open: d.open, h: Math.round(s.getBoundingClientRect().height), groups: d.querySelectorAll(".mkt-group").length } : null; })()');
        await go('/market?chain=robinhood&token=' + TSLA + '&tab=rwa', w); await cardReady(); await sleep(150);
        const card = await ev('(() => { const h = document.getElementById("mkt-rwa-host"), s = document.getElementById("mkt-tstats"), tw = document.getElementById("mkt-tw-h"); const folds = [...h.querySelectorAll("details.mkt-rwa-fold")];' +
          ' return { host: Math.round(h.getBoundingClientRect().height), gap: tw ? Math.round(tw.getBoundingClientRect().top - s.getBoundingClientRect().bottom) : null, folds: folds.length, shut: folds.every((d) => !d.open),' +
          ' low: folds.map((d) => d.querySelector("summary").getBoundingClientRect().height).filter((x) => x < 43.5).length, open1: !h.querySelector("section[aria-labelledby=mkt-rw1-h] details.mkt-rwa-fold"),' +
          ' secs: [...h.children].map((x) => (x.getAttribute("aria-labelledby") || x.className).slice(0, 12) + ":" + Math.round(x.getBoundingClientRect().height)).join(" "), sight: [...h.querySelectorAll("section[aria-labelledby=mkt-rw2-h] .mkt-hold li")].filter((li) => !li.closest("details")).map((li) => li.textContent.slice(0, 240)), img: !!document.querySelector(".mkt-vt img") }; })()');
        M.push({ w, tok, rwa, filt, card });
      }
      const m1280 = M.find((x) => x.w === 1280), bad = M.filter((x) => !(x.rwa <= Math.max(1300, x.tok + 450)) || !x.filt || x.filt.open || x.filt.h < 44 || x.filt.groups !== 3
        || !(x.card.host < (x.w < 768 ? 4200 : 5500)) || !(x.card.gap <= x.card.host + 400) || x.card.folds < 7 || !x.card.shut || x.card.low || !x.card.open1 || x.card.img);
      check('the RWAs tab\'s first row sits about where Top tokens\' does (Show and Rank by in sight; Order, Kind and Issuer one 44px pop-down, shut), and TSLA\'s RWA facts — "Is this the real one?" open, parts 2–7 each a line and a 44px pop-down, shut — leave its trading, chart and pools a few screens below the stats (under a third of the 14,770 px they took), at 390 and 1280 px; its header draws no picture (no Robinhood artwork)',
        M.length === 2 && !bad.length && m1280.card.sight.some((t) => /debt securities/.test(t)) && m1280.card.sight.some((t) => /Not offered to US persons/.test(t)) && m1280.card.sight.some((t) => /KYC/.test(t)), JSON.stringify(M));
      // Connected tokens with a filter that leaves none: the sentence says the filter, never "no pool pairs a token with an RWA"
      await go('/market?chain=robinhood&tab=rwa&rview=connected&rissuer=ondo', 1280); await rwaReady();
      const empty = await textOf('#mkt-list .mkt-empty');
      check('  ...Connected tokens filtered to an issuer whose tokens no pool pairs: "No pool pairs a token with Ondo Global Markets’ tokens … — choose All to see every one", never "no pool pairs a token with an RWA"',
        /^No pool pairs a token with Ondo Global Markets’ tokens from \$1,000 of reserve — choose All to see every one/.test(empty) && !/with an RWA/.test(empty) && !/Markets’s/.test(empty), empty);
    });

    await step('the RWAs tab: what it asks, what each row says, its caption and its foot', async () => {
      await go('/market', 1280); const m0 = FAKE.log.length;
      await ev('document.getElementById("mkt-tab-rwa").click(), true'); await rwaReady();
      const t0 = { asked: rwaAsks(m0), url: await ev('location.search'), sel: await ev('[...document.querySelectorAll("#mkt-side [role=tab]")].map((t) => t.dataset.tab + ":" + t.getAttribute("aria-selected") + ":" + t.tabIndex).join()'),
        ctl: await ev('["chains","tokens","rwa"].map((k) => k + ":" + document.getElementById("mkt-ctl-" + k).hidden).join()'), lab: await ev('document.getElementById("mkt-panel").getAttribute("aria-labelledby") + "|" + document.getElementById("mkt-list").getAttribute("aria-labelledby")'),
        cap: await textOf('#mkt-cap'), foot: await textOf('#mkt-foot'), lede: await ev('(() => { const p = document.querySelector("#mkt-ctl-rwa .mkt-rwa-lede"); return p && p.getClientRects().length ? p.textContent : ""; })()'), rows: await rwaRows(), pressed: await rwaPressed(),
        issuers: await ev('[...document.querySelectorAll("#mkt-ri-c [data-rissuer]")].map((b) => b.dataset.rissuer + ":" + b.textContent.replace(/^✓\\u00a0/, "") + ":" + ((b.dataset.tip || "").length >= 20)).join("|")'), more: await textOf('#mkt-more') };
      const r0 = t0.rows[0] || {}, tsla = t0.rows.find((x) => x.t === TSLA) || {};
      check('the RWAs tab asks exactly /api/market/rwa (Top RWAs by value on chain), puts tab=rwa in the address, selects its tab (the others out of the Tab order) and shows only its controls, the panel and the list labelled by it, the not-affiliated line above the controls',
        t0.asked.join() === '/api/market/rwa' && t0.url === '?chain=robinhood&tab=rwa' && t0.sel === 'chains:false:-1,tokens:false:-1,rwa:true:0' && t0.ctl === 'chains:true,tokens:true,rwa:false' && t0.lab === 'mkt-tab-rwa|mkt-tab-rwa'
        && /Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\. Not advice, never a tip to buy\./.test(t0.lede) && t0.pressed === 'view=assets sort=value dir=desc kind=all issuer=all', JSON.stringify(Object.assign({}, t0, { rows: t0.rows.length, cap: '', foot: '' })));
      /* the caption is one line of what is shown and how it is ranked, then what is counted and any read that did not work (review, 2026-10-28:
         the first RWA row sat 2,385 px down the side column); what the ranking figure means and what is kept apart are in the foot */
      check('  ...the caption says in one line what is shown and how it is ranked, then what is counted with each sum\'s source and age, and a read that did not work with its reason; the ranking\'s meaning and the stablecoins and L2BEAT\'s own count apart are in the foot; the Issuer chips name every issuer the answer names',
        /^Top RWAs on Robinhood Chain · ranked by value on chain, highest first · 36 assets · gathered /.test(t0.cap) && !/Value on chain: the token's supply/.test(t0.cap) && /Value on chain: the token's supply read on the chain times its DEX price/.test(t0.foot)
        && /Counted: 25 RWA tokens \(\+23 not confirmed yet, left out\) — value on chain \$\d+(\.\d)?M \(this site · [^)]*\) · liquidity \$[\d.]+M \(GeckoTerminal · [^)]*\) · TVL in DeFi \$[\d.]+M \(DefiLlama · /.test(t0.cap)
        && !/Apart, never added in/.test(t0.cap) && /Apart, never added in: fiat-backed stablecoins \$[\d.]+M \(DefiLlama · [^)]*\) · L2BEAT’s own count of real-world assets on Robinhood Chain \$[\d.]+M \(L2BEAT · /.test(t0.foot) && /⏳ DefiLlama's per-app deposits — not read: Longbow \(upstream 404\)\./.test(t0.cap)
        && t0.issuers === 'all:All:true|rhj:Robinhood (RHJ):true|ondo:Ondo:true|anchored:Anchored:true|st0x:ST0x:true|midas:Midas:true', t0.cap + ' || ' + t0.issuers);
      check('  ...each row is a real button that opens the main token of its underlying on Robinhood Chain, with its kind, its issuer, how sure the site is that it is the real one, its other issuers\' tokens ("also $TSLAon (Ondo Global Markets)") and the ranked figure with its meaning; 25 shown, then "Show 11 more"',
        t0.rows.length === 25 && t0.rows.every((x) => x.tag === 'BUTTON' && x.c === 'robinhood' && /^0x[0-9a-f]{40}$/.test(x.t) && x.tip.length > 30 && /value on chain|Not available/.test(x.fig) && x.conf) && /^Show 11 more \(11 left\)$/.test(t0.more)
        && r0.t === FIX('rwa-assets.json').rows[0].main && /^ETF · Robinhood Assets \(Jersey\)/.test(r0.text.replace(/^.*?\$SPY/, '')) && /also \$SPYon \(Ondo Global Markets, not confirmed\)/.test(r0.text) && r0.conf === '✓ Confirmed' && r0.flags.includes('pairs two RWAs')
        && /also \$TSLAon \(Ondo Global Markets\)/.test(tsla.text) && /^Stock · Robinhood Assets \(Jersey\)/.test(tsla.text.replace(/^.*?\$TSLA/, '')), JSON.stringify([r0, tsla]).slice(0, 700));
      check('  ...the foot gives how a token counts as an RWA here (the tiers in words), that stablecoins and tokens merely paired with an RWA are listed apart and never counted, what each figure means, the sources, and ends with the not-affiliated and not-advice lines',
        /How a token counts as an RWA here: it is in Robinhood's Stock Token registry and its code runs from Robinhood's registry on the chain \("confirmed"\)/.test(t0.foot) && /Stablecoins and tokens merely paired with an RWA are listed apart and never counted\./.test(t0.foot)
        && /What each figure means/.test(t0.foot) && /Sources: Robinhood's Stock Token API/.test(t0.foot) && /Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\. No Robinhood logos or artwork are used\.Not advice, never a tip to buy\. Do your own research\.$/.test(t0.foot), t0.foot.slice(0, 300) + ' … ' + t0.foot.slice(-200));
    });

    await step('the RWAs tab: every RWA token, its rankings and filters in the address, Back and Forward', async () => {
      await go('/market', 1280); await listReady();
      await ev('document.getElementById("mkt-tab-rwa").click(), true'); await until('location.search === "?chain=robinhood&tab=rwa"'); await rwaReady();
      const at = async (attr, val) => { const m = FAKE.log.length; await rwaClick(attr, val); await rwaReady(); await rwaAll(); return { asked: rwaAsks(m), url: await ev('location.search'), rows: await rwaRows(), cap: await textOf('#mkt-cap'), foot: await textOf('#mkt-foot'), pressed: await rwaPressed(), filt: await textOf('#mkt-rf-now') }; };
      const v1 = await at('rview', 'tokens'), v2 = await at('rsort', 'tvl'), v3 = await at('rdir', 'asc'), v4 = await at('rkind', 'stock'), v5 = await at('rissuer', 'ondo');
      const row = (x, sym) => x.rows.find((r) => new RegExp('\\$' + sym + '(?![a-z])').test(r.text)) || {};
      check('All RWA tokens: one row per token, each saying in words how sure the site is — "✓ Registry + on-chain" (Robinhood\'s registry and the chain), "✓ On-chain" (WEEK, gone from the registry\'s list), "✓ Issuer list + on-chain" (Ondo\'s TSLAon), "Not confirmed" (fingerprint not read yet) — with Robinhood\'s own price flag (NAVN, SATS, WEEK) and the pools pairing two RWAs',
        v1.asked.join() === '/api/market/rwa?view=tokens' && v1.url === '?chain=robinhood&tab=rwa&rview=tokens' && v1.rows.length === 48 && row(v1, 'SPY').conf === '✓ Registry + on-chain' && row(v1, 'WEEK').conf === '✓ On-chain' && row(v1, 'TSLAon').conf === '✓ Issuer list + on-chain'
        && v1.rows.filter((r) => r.conf === 'Not confirmed').length === 23 && ['NAVN', 'SATS', 'WEEK'].every((x) => row(v1, x).flags.includes('⚠ Robinhood flags its price')) && row(v1, 'QQQ').flags.includes('pairs two RWAs') && /^All RWA tokens on Robinhood Chain · ranked by value on chain, highest first · 48 tokens/.test(v1.cap),
        JSON.stringify({ n: v1.rows.length, asked: v1.asked, url: v1.url, conf: ['SPY', 'WEEK', 'TSLAon', 'NAVN', 'SATS', 'QQQ'].map((x) => x + ':' + row(v1, x).conf + ':' + (row(v1, x).flags || []).join('/')), nc: v1.rows.filter((r) => r.conf === 'Not confirmed').length, cap: v1.cap.slice(0, 120) }));
      check('  ...ranked by TVL in DeFi (mGLO first, its definition in the foot), lowest first (said to be lowest among these, a token with none at the end), Stocks only, Ondo only — each pushed into the address and asked of the server, the chips pressed with a tick, the Order and filters pop-down\'s summary naming every choice',
        v2.asked.join() === '/api/market/rwa?view=tokens&sort=tvl' && /\$mGLO/.test(v2.rows[0].text) && /in DeFi apps/.test(v2.rows[0].fig) && /ranked by TVL in DeFi, highest first/.test(v2.cap) && /TVL in DeFi: USD of the token deposited in DeFi apps on Robinhood Chain/.test(v2.foot)
        && v3.asked.join() === '/api/market/rwa?view=tokens&sort=tvl&dir=asc' && /So “lowest” is lowest among these, not the lowest on the chain/.test(v3.foot) && /in DeFi apps/.test(v3.rows[0].fig) && /^Not available/.test(v3.rows[v3.rows.length - 1].fig)
        && v2.filt === 'highest first · every kind · every issuer' && v5.filt === 'lowest first · stocks · Ondo Global Markets only'
        && v4.asked.join() === '/api/market/rwa?view=tokens&sort=tvl&dir=asc&kind=stock' && v4.rows.length > 5 && v4.rows.every((r) => /Stock · /.test(r.text)) && / · Stocks · /.test(v4.cap)
        && v5.asked.join() === '/api/market/rwa?view=tokens&sort=tvl&dir=asc&kind=stock&issuer=ondo' && v5.rows.length > 0 && v5.rows.every((r) => /Ondo Global Markets/.test(r.text)) && v5.url === '?chain=robinhood&tab=rwa&rview=tokens&rsort=tvl&rdir=asc&rkind=stock&rissuer=ondo'
        && v5.pressed === 'view=tokens sort=tvl dir=asc kind=stock issuer=ondo', JSON.stringify({ v2: v2.asked, v3: v3.asked, v5: [v5.url, v5.pressed] }));
      const back = [];
      for (const want of ['?chain=robinhood&tab=rwa&rview=tokens&rsort=tvl&rdir=asc&rkind=stock', '?chain=robinhood&tab=rwa&rview=tokens&rsort=tvl&rdir=asc', '?chain=robinhood&tab=rwa&rview=tokens&rsort=tvl', '?chain=robinhood&tab=rwa&rview=tokens', '?chain=robinhood&tab=rwa']) {
        await ev('history.back(), true'); await until('location.search === ' + S(want)); await rwaReady(); await sleep(150);
        back.push({ url: await ev('location.search'), pressed: await rwaPressed(), n: (await rwaRows()).length });
      }
      await ev('history.back(), true'); await until('location.search === ""'); await listReady();
      const left = { sel: await ev('document.getElementById("mkt-tab-chains").getAttribute("aria-selected")'), ctl: await ev('document.getElementById("mkt-ctl-rwa").hidden'), rows: await ev('document.querySelectorAll("#mkt-list .mkt-row[data-chain]:not([data-token])").length') };
      await ev('history.forward(), true'); await until('location.search === "?chain=robinhood&tab=rwa"'); await rwaReady();
      const fwd = { sel: await ev('document.getElementById("mkt-tab-rwa").getAttribute("aria-selected")'), pressed: await rwaPressed() };
      check('  ...Back walks the choices back one at a time — each restored on its chips and read again — then leaves the tab for Top chains; Forward brings the RWAs tab back',
        back.map((x) => x.pressed).join(' | ') === ['view=tokens sort=tvl dir=asc kind=stock issuer=all', 'view=tokens sort=tvl dir=asc kind=all issuer=all', 'view=tokens sort=tvl dir=desc kind=all issuer=all', 'view=tokens sort=value dir=desc kind=all issuer=all', 'view=assets sort=value dir=desc kind=all issuer=all'].join(' | ')
        && back[4].n === 25 && left.sel === 'true' && left.ctl === true && left.rows > 5 && fwd.sel === 'true' && fwd.pressed === 'view=assets sort=value dir=desc kind=all issuer=all', JSON.stringify({ back, left, fwd }));
      // an issuer the server does not know: it serves every issuer, and the address and the chips say so
      const m = FAKE.log.length;
      await go('/market?tab=rwa&rissuer=nope', 1280); await rwaReady(); await sleep(150);
      const nope = { asked: rwaAsks(m), url: await ev('location.search'), pressed: await rwaPressed() };
      check('  ...a link naming an issuer the server does not know asks for it, is served every issuer, and the address and the chips then say every issuer — never a filter the list did not get',
        nope.asked[0] === '/api/market/rwa?issuer=nope' && nope.url === '?chain=robinhood&tab=rwa' && nope.pressed === 'view=assets sort=value dir=desc kind=all issuer=all', JSON.stringify(nope));
    });

    await step('the RWAs tab: connected tokens and stablecoins, listed apart', async () => {
      await go('/market?tab=rwa', 1280); await rwaReady();
      const groups = () => ev('["mkt-rs-g","mkt-rsc-g","mkt-rss-g","mkt-rk-g","mkt-ri-g"].map((id) => id.slice(4) + ":" + (document.getElementById(id).hidden ? "off" : "on")).join()');
      let m = FAKE.log.length;
      await rwaClick('rview', 'connected'); await rwaReady();
      const c1 = { asked: rwaAsks(m), url: await ev('location.search'), rows: await rwaRows(), cap: await textOf('#mkt-cap'), g: await groups(), pressed: await rwaPressed() };
      m = FAKE.log.length; await rwaClick('rsort', 'volume'); await rwaReady();
      const c2 = { asked: rwaAsks(m), rows: await rwaRows(), cap: await textOf('#mkt-cap') };
      const topVol = FIX('rwa-connected.json').rows.slice().sort((a, b) => b.volume24h.v - a.volume24h.v)[0];
      check('Connected tokens: every row says it is NOT an RWA ("Not an RWA — paired with $TSLA", the server\'s words) and opens that token; ranked by the pool\'s reserve (its own Rank by: reserve or volume — the RWA rankings, Kind and Issuer as they apply), the floor and what fell below it in the caption; by the pool\'s volume when asked',
        c1.asked.join() === '/api/market/rwa?view=connected&sort=liquidity' && c1.url === '?chain=robinhood&tab=rwa&rview=connected' && c1.rows.length === FIX('rwa-connected.json').rows.length && c1.rows.every((r) => r.tag === 'BUTTON' && r.flags.includes('Not an RWA — paired with $TSLA') && /not an RWA itself/.test(r.tip) && /the pool’s reserve/.test(r.fig))
        && /^Connected tokens — not RWAs: tokens with a DEX pool against one · ranked by the pool’s reserve, highest first/.test(c1.cap) && /Pools from \$1,000 of reserve; 0 below that left out\./.test(c1.cap) && /Connected tokens: tokens with a DEX pool against an RWA/.test(await textOf('#mkt-foot'))
        && c1.g === 'rs-g:off,rsc-g:on,rss-g:off,rk-g:on,ri-g:on' && c1.pressed === 'view=connected sort=liquidity dir=desc kind=all issuer=all'
        && c2.asked.join() === '/api/market/rwa?view=connected&sort=volume' && /ranked by the pool’s 24h volume/.test(c2.cap) && c2.rows[0].t === topVol.address && /the pool’s 24h volume/.test(c2.rows[0].fig), JSON.stringify({ c1: Object.assign({}, c1, { rows: c1.rows.slice(0, 1) }), c2: c2.asked }).slice(0, 700));
      m = FAKE.log.length; await rwaClick('rview', 'stables'); await rwaReady();
      const s1 = { asked: rwaAsks(m), rows: await rwaRows(), cap: await textOf('#mkt-cap'), g: await groups(), pressed: await rwaPressed() };
      const usdgRow = s1.rows.find((r) => r.t === USDG) || {};
      check('  ...Stablecoins: listed apart — USDG, Paxos, fiat-backed, "Not counted as an RWA here — DefiLlama and rwa.xyz count stablecoins apart", ranked by what circulates on the chain (its own Rank by; no Kind or Issuer); opening it shows its token view with no RWA facts',
        s1.asked.join() === '/api/market/rwa?view=stables' && /Paxos · fiat-backed/.test(usdgRow.text) && usdgRow.flags.includes('Not counted as an RWA here — DefiLlama and rwa.xyz count stablecoins apart') && /circulating, per DefiLlama \(DefiLlama · /.test(usdgRow.fig)
        // review two, 18: each amount names its source — the supply read on the chain, DefiLlama's circulating figure — never two "on the chain" figures side by side
        && /supply 673M USDG — totalSupply\(\) read on the chain/.test(usdgRow.text) && !/on the chain\$/.test(usdgRow.fig) && !/USDG on the chain/.test(usdgRow.text)
        && /^Stablecoins on Robinhood Chain, listed apart from the RWAs · ranked by what circulates on the chain/.test(s1.cap) && s1.g === 'rs-g:off,rsc-g:off,rss-g:on,rk-g:off,ri-g:off' && s1.pressed === 'view=stables sort=value dir=desc', JSON.stringify(Object.assign({}, s1, { rows: s1.rows.slice(0, 2) })).slice(0, 600));
      await ev('document.querySelector("#mkt-list [data-token=\\"' + USDG + '\\"]").click(), true'); await until('location.search.includes("token=' + USDG + '")'); await viewReady(); await sleep(300);
      const u = { host: await ev('!!document.getElementById("mkt-rwa-host")'), asked: rwaAsks(m).filter((x) => /rwa\/token/.test(x)), cur: (await rwaRows()).find((r) => r.t === USDG) };
      check('  ...a stablecoin\'s token view carries no RWA facts and asks for none; its row is the one marked current', !u.host && !u.asked.length && u.cur && u.cur.cur, JSON.stringify(u).slice(0, 300));
    });

    await step('an RWA\'s facts on its token view: Robinhood\'s TSLA', async () => {
      const m = FAKE.log.length;
      await go('/market?chain=robinhood&token=' + TSLA + '&tab=rwa', 1280); await cardReady();
      const c = await ev(CARD), asked = rwaAsks(m).filter((x) => /rwa\/token/.test(x));
      check('TSLA\'s token view carries its RWA facts right under its stats, read once from /api/market/rwa/token, in seven cards in the order a holder needs them (is this the real one, what you hold, the price check, corporate actions, size, the powers its issuer keeps, the tokens paired with it), each headed with its own id, then the not-affiliated and not-advice foot',
        c && asked.join() === '/api/market/rwa/token?address=' + TSLA && c.ids === 'mkt-rw1-h,mkt-rw2-h,mkt-rw3-h,mkt-rw4-h,mkt-rw5-h,mkt-rw6-h,mkt-rw7-h' && c.heads && c.after && c.next === 'mkt-tw-h' && /🏛️ Real-world asset/.test(c.kicker)
        && /Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\./.test(c.lede) && /^Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\. No Robinhood logos or artwork are used\. Not advice, never a tip to buy\. Do your own research\./.test(c.foot) && c.copies, JSON.stringify(c && { ids: c.ids, next: c.next, kicker: c.kicker, asked }));
      check('  ...1. is this the real one: "✓ Registry + on-chain" and why in words, the issuer and its status, every piece of evidence with its tier, source and age (proof: Robinhood\'s registry, the chain; supporting only: CoinGecko\'s id, Chainlink\'s feed), that a name never qualifies, Robinhood\'s own contract list linked, and the lookalikes (none seen — not a search of the whole chain)',
        /✓ Registry \+ on-chain/.test(c.s1) && /Confirmed: Robinhood’s registry lists this address, and its code runs from Robinhood’s registry contract on the chain\./.test(c.s1) && /IssuerRobinhood Assets \(Jersey\) Limited \(RHJ\)/.test(c.s1) && /StatusActive in Robinhood's registry ASSET_STATUS_ACTIVE/.test(c.s1)
        && /A1 · proof · Robinhood’s registry Listed in Robinhood's Stock Token registry \(api\.robinhood\.com\/rhj\/assets\) Robinhood’s Stock Token API · /.test(c.s1) && /A2 · proof · the chain Its code runs from Robinhood's token registry contract/.test(c.s1) && (c.s1.match(/B · supporting only/g) || []).length === 2
        && /A name or a symbol never makes a token an RWA here/.test(c.s1) && /Robinhood lists its Stock Tokens at docs\.robinhood\.com\/chain\/contracts — a token with the same ticker at another address is not one\. docs\.robinhood\.com\/chain\/contracts ↗/.test(c.s1)
        && /None among the pools, scans and new pairs this site keeps — that is not a search of the whole chain\./.test(c.s1), c.s1.slice(0, 900));
      check('  ...2. what you hold: Robinhood\'s own words, each sentence with its page (opened in a new tab, noopener) — a debt security, no voting rights, backed 1:1 per its FAQ, redemption after KYC, not offered to US persons with the restricted list — and terms() as the contract names it, read on the chain',
        /tokenised debt securities issued by Robinhood Assets \(Jersey\) Limited/.test(c.s2) && /no voting rights/.test(c.s2) && /backed 1:1 by the underlying/.test(c.s2) && /KYC\/AML/.test(c.s2) && /Not offered to US persons/.test(c.s2) && !/docs\.robinhood\.com\/chain\/contracts/.test(c.s2)
        && c.links.filter((x) => /^https:\/\/docs\.robinhood\.com\//.test(x)).length === RW.ISSUER_TEXT.rhj.filter((x) => !/\/chain\/contracts\//.test(x.href)).length && c.links.every((x) => /\|noopener nofollow\|_blank$/.test(x)) && c.links.some((x) => x.startsWith('https://docs.robinhood.com/rhj/restricted-jurisdictions/|'))
        && /Its terms, as the contract itself names them \(terms\(\) read on the chain\): robinhood\.com\/stocktoken\/rhj ↗ the chain’s public node · /.test(c.s2), c.s2.slice(-400) + ' ' + JSON.stringify(c.links));
      check('  ...3. the price check: the DEX price, Chainlink\'s feed (when it was updated, its 24 h heartbeat, within it) and Robinhood\'s quote (an undocumented field, said so), the premium or discount in words, Robinhood\'s deviation flag (not on its list), no halt, the registry\'s paused() as "no such function" — never "not paused" — and that stock markets close while DEX pools trade',
        /DEX price\$396\.74/.test(c.s3) && /Chainlink’s feed for it\$397\.95Chainlink RHTSLA \/ USD · Chainlink · .*feed 0x4a11…7c38 · updated .* · heartbeat 24 h · within its heartbeat/.test(c.s3) && /Robinhood’s quote for it\$399\.3[56]Robinhood's quote, multiplier applied — an undocumented field/.test(c.s3)
        && /Premium or discount▼ −0\.30%DEX price against Chainlink RHTSLA \/ USD · this site · .*below its reference — a discount/.test(c.s3) && /Robinhood’s deviation flagNot flaggednot on Robinhood’s price-deviation list/.test(c.s3) && /Trading haltNot halted/.test(c.s3)
        && /Paused: every Stock TokenNot availableno such function on this contract \(the call reverted\) — not the same as "not paused"/.test(c.s3) && /Paused: this tokenNot paused/.test(c.s3) && /Price-oracle flagNot paused/.test(c.s3) && /Stock markets close while DEX pools trade around the clock/.test(c.s3), c.s3);
      check('  ...4. corporate actions: one token stands for one share (Robinhood\'s multiplier; the chain\'s the same, nothing pending), none listed for it, and that dividends are paid by raising the multiplier; 5. size: value on chain, the supply on the chain, market cap, liquidity, TVL in DeFi with the apps holding it, primary mint and burn and 24 h volume — each with its source and what it means',
        /One token stands for1 share of the underlying/.test(c.s4) && /on the chain \(uiMultiplier\(\)\): 1 · no change pending on the chain/.test(c.s4) && /Robinhood’s corporate-actions list has none for it\./.test(c.s4) && /Dividends are paid by raising the multiplier, so the token’s price sits above the share’s/.test(c.s4)
        && /Value on chain\$4\.51M/.test(c.s5) && /Supply on the chain11,371 TSLA/.test(c.s5) && /Market cap\$4\.29M/.test(c.s5) && /Liquidity\$1\.23M/.test(c.s5) && /TVL in DeFi\$3,895\.81/.test(c.s5) && /held in Morpho Blue \(Lending\) \$3,884\.19, Catch Exchange \(RWA\) \$11\.63/.test(c.s5)
        && /Primary mint and burn\$534k/.test(c.s5) && /Robinhood does not document its window/.test(c.s5) && /Value on chain: the token's supply read on the chain times its DEX price — not the company's market value\./.test(c.s5) && /TVL in DeFi: USD of the token deposited/.test(c.s5), c.s4 + ' || ' + c.s5);
      check('  ...6. the powers its issuer keeps, said as powers a regulated issuer keeps (still powers over your tokens; the Scanner\'s health score does not count them): the beacon is Robinhood\'s registry, the code it runs with Sourcify\'s record, every power with its role and holders — each linked to the chain\'s explorer, a wallet or a contract — 175 wallets blocked, every role holder in the logs, and why the Scanner does not raise "serial deployer" on it',
        /for a regulated issuer they are expected — they are still powers over your tokens\. The Scanner['’]s health score does not count them\./.test(c.s6) && !/marks these powers in red/.test(c.s6) && /12 of 12 powers held · 175 wallets blocked from moving these tokens/.test(c.s6) && /Its beacon: Robinhood’s registry0xe10b…1b00 ↗/.test(c.s6) && /The code it runs now0xb354…5ae2 ↗/.test(c.s6) && /Sourcify’s record of that code ↗/.test(c.s6)
        && /Replace the code of every Robinhood Stock Token at once \(the beacon's upgradeTo\)BEACON_UPGRADER_ROLE0xcd8c…e094 ↗ ⧉ \(a wallet\)/.test(c.s6) && /Burn tokens from any wallet \(adminBurn\)ADMIN_BURNER_ROLE/.test(c.s6) && /Wallets blocked175/.test(c.s6) && /Every role holder in the registry’s logs \(15\)/.test(c.s6)
        && /does not raise "serial deployer" on a confirmed Stock Token deployed by it/.test(c.s6) && c.holders.length >= 13 && c.holders.every((h) => /^https:\/\/robinhoodchain\.blockscout\.com\/address\/0x[0-9a-f]{40}$/.test(h)), c.s6.slice(0, 900));
      check('  ...7. the tokens paired with it: each "Not an RWA — paired with $TSLA", opening that token; and nothing in these facts is "$0"',
        c.conn.length === 7 && c.conn.every((x) => /^0x[0-9a-f]{40}$/.test(x.t) && /Not an RWA — paired with \$TSLA/.test(x.text) && /not an RWA itself/.test(x.tip)) && /Not one of these is an RWA/.test(c.s7) && noZero(c.all), JSON.stringify(c.conn.slice(0, 2)));
      await ev('document.querySelector("#mkt-rwa-host [data-open-token]").click(), true');
      await until('location.search.includes("token=' + c.conn[0].t + '")'); await viewReady(); await sleep(300);
      const o = { url: await ev('location.search'), host: await ev('!!document.getElementById("mkt-rwa-host")'), fail: await ev('!!document.querySelector("#mkt-view .mkt-fail")') };
      check('  ...opening a token paired with it shows that token (with the RWA tab still open), with no RWA facts of its own — a pairing says nothing about who issued it', o.url === '?chain=robinhood&token=' + c.conn[0].t + '&tab=rwa' && !o.host, JSON.stringify(o));
    });

    await step('an RWA\'s facts on its token view: another issuer (Ondo\'s TSLAon), which GeckoTerminal does not know', async () => {
      await go('/market?chain=robinhood&tab=rwa&rview=tokens', 390); await rwaReady(); await rwaAll();
      const m = FAKE.log.length;
      await ev('document.querySelector("#mkt-list [data-token=\\"' + TSLAON + '\\"]").click(), true');
      await until('location.search.includes("token=' + TSLAON + '")'); await viewReady(); await cardReady();
      const c = await ev(CARD), v = await ev('({ fail: (document.querySelector("#mkt-view .mkt-fail") || {}).textContent || "", cur: !!document.querySelector("#mkt-list [data-token=\\"' + TSLAON + '\\"][aria-current=\\"true\\"]") })'), L = await ev(LAYOUT);
      check('Ondo\'s TSLAon from the RWA list: GeckoTerminal does not know it, and that failure is said — and its RWA facts still come (they do not need that read): "✓ Issuer list + on-chain" on Ondo\'s own beacon, its row marked current, the page fitting a phone',
        /GeckoTerminal does not know this token on robinhood/.test(v.fail) && v.cur && c && c.ids.split(',').length === 7 && /✓ Issuer list \+ on-chain/.test(c.s1) && /IssuerOndo Global Markets/.test(c.s1) && /A3 · proof · issuer list and the chain/.test(c.s1) && /its code runs from Ondo Global Markets' beacon 0xc6fbc077d53d01f73e3195b2b916fd95555ba222/.test(c.s1)
        && rwaAsks(m).filter((x) => /rwa\/token/.test(x)).join() === '/api/market/rwa/token?address=' + TSLAON && L.sw <= L.iw && !L.out.length && !L.small.length, JSON.stringify({ v, s1: c && c.s1.slice(0, 300), L }));
      check('  ...what this site does not read for another issuer is said, never left blank or zero: the issuer\'s terms are not read by this site (its CoinGecko page instead), no Chainlink or Robinhood reference, no deviation list, Robinhood\'s pauses and multiplier not read for it, no corporate actions, its powers not read — the beacon and the code it runs still linked',
        /The issuer's terms are not read by this site\./.test(c.s2) && /this site’s own reading, not a page of the issuer’s/.test(c.s2) && c.links.some((x) => /^https:\/\/www\.coingecko\.com\/en\/coins\/tesla-ondo-tokenized-stock\|/.test(x))
        && /Chainlink’s feed for itNot availableChainlink's Robinhood feeds price Robinhood's Stock Tokens; no reference is read for this issuer's tokens/.test(c.s3) && /Robinhood’s quote for itNot availableRobinhood quotes its own Stock Tokens only/.test(c.s3)
        && /Robinhood’s deviation flagNot availableRobinhood flags its own Stock Tokens only/.test(c.s3) && /Paused: this tokenNot availableRobinhood's pause functions — not read for this issuer's tokens/.test(c.s3)
        && /only Robinhood's Stock Tokens carry this multiplier/.test(c.s4) && /Robinhood lists corporate actions for its own Stock Tokens only/.test(c.s4) && !/Dividends are paid/.test(c.s4)
        && /This site reads the roles of Robinhood's registry only/.test(c.s6) && /Beacon proxy/.test(c.s6) && /Its beacon0xc6fb…a222 ↗/.test(c.s6) && /this site has not checked a verified source/i.test(c.s6) && noZero(c.all), [c.s2, c.s3, c.s4, c.s6].join(' || ').slice(0, 1200));
    });

    await step('a link straight to an RWA GeckoTerminal does not know, the RWA list arriving after it', async () => {
      const gld = FIX('rwa-tokens.json').rows.find((r) => r.symbol === 'GLD').address;
      FAKE.rwaDelay = 1500;
      // review two, 11: the failed answer carries GLD's RWA row, so its facts come under the failure at once — never waiting for the RWA list
      await go('/market?chain=robinhood&token=' + gld + '&tab=rwa', 1280); const failedFirst = await ev('!!document.querySelector("#mkt-view .mkt-fail") && !!document.getElementById("mkt-rwa-host") && !!(document.querySelector("#mkt-view .mkt-fail").compareDocumentPosition(document.getElementById("mkt-rwa-host")) & 4)');
      const listYet = await ev('!document.querySelector("#mkt-list .mkt-row")');
      await rwaReady(); await cardReady(); await sleep(200);
      const g = await ev(CARD), fail = await textOf('#mkt-view .mkt-fail'), hosts = await ev('document.querySelectorAll("#mkt-rwa-host").length');
      check('a link to Robinhood\'s GLD (outside the most-traded pools, which the market read here does not know): the failed market read is said first, and its RWA facts follow under it straight away — before the RWA list has arrived (the failed answer carries its row), and once it does, still one card — a commodity, confirmed, its price from GeckoTerminal\'s own read',
        failedFirst && listYet && hosts === 1 && /GeckoTerminal does not know this token on robinhood/.test(fail) && g && g.ids.split(',').length === 7 && /✓ Registry \+ on-chain/.test(g.s1) && /— commodity/.test(g.s1) && /not among the most-traded pools we keep/.test(g.s3), JSON.stringify({ failedFirst, listYet, hosts, s1: g && g.s1.slice(0, 200) }));
    });

    await step('reads that fail: the RWA list, one token\'s facts, and a source the server could not read', async () => {
      FAKE.rwaDown = true;
      await go('/market?tab=rwa', 1280); await until('!!document.querySelector("#mkt-cap [data-retry=\\"list\\"]")');
      const l = { cap: await textOf('#mkt-cap'), foot: await textOf('#mkt-foot'), rows: (await rwaRows()).length };
      FAKE.rwaDown = false;
      await ev('document.querySelector("#mkt-cap [data-retry=\\"list\\"]").click(), true'); await rwaReady();
      const l2 = (await rwaRows()).length;
      check('the RWA list that cannot be read says so with the reason and Try again — never "no RWAs" — and the not-affiliated and not-advice lines stay; Try again reads it',
        /^⏳ The RWA list could not be read just now\. Try again in a moment\./.test(l.cap) && !l.rows && /Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\./.test(l.foot) && /Not advice, never a tip to buy\. Do your own research\./.test(l.foot) && l2 === 25, JSON.stringify(l));
      FAKE.rwaList = (b) => Object.assign(b, { reads: Object.assign({}, b.reads, { registry: { at: b.reads.registry.at, ok: false, why: 'Robinhood\'s registry could not be read at 2026-10-28 16:30 UTC (upstream 503) — the last good read, from 2026-10-28 15:00 UTC, is shown' } }) });
      await go('/market?tab=rwa', 1280); await rwaReady();
      const r = await textOf('#mkt-cap'); FAKE.rwaList = null;
      check('  ...a source the server could not read (Robinhood\'s registry) is said in the caption with when and why, and that the last good read is shown — the list still drawn from it', /⏳ Robinhood's registry could not be read at 2026-10-28 16:30 UTC \(upstream 503\) — the last good read, from 2026-10-28 15:00 UTC, is shown\./.test(r) && (await rwaRows()).length === 25, r.slice(-400));
      FAKE.rwaTokenDown = true;
      await go('/market?chain=robinhood&token=' + TSLA, 1280); await until('!!document.querySelector("#mkt-rwa-host [data-retry=\\"rwa\\"]")');
      const t = await ev('({ t: document.getElementById("mkt-rwa-host").textContent, cards: document.querySelectorAll("#mkt-rwa-host .mkt-rwa-c").length, tab: document.getElementById("mkt-tab-tokens").getAttribute("aria-selected") })');
      FAKE.rwaTokenDown = false;
      await ev('document.querySelector("#mkt-rwa-host [data-retry=\\"rwa\\"]").click(), true'); const back = await cardReady();
      check('  ...an RWA\'s facts that cannot be read say so on its token view (the reason, Try again, the not-affiliated line) — no card of blanks — and Try again reads them',
        /⏳ The RWA facts could not be read just now\. Try again in a moment\./.test(t.t) && /Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\./.test(t.t) && t.cards === 0 && !!back, JSON.stringify(t).slice(0, 400));
    });

    /* review two (2026-10-28): what the second review found on /market, walked in the browser on the fake (lib's own answers) */
    await step('review two: an RWA\'s facts on a direct link, lookalikes under the title, no Robinhood artwork, a filter\'s totals, a may-be-low TVL', async () => {
      const RHJ = new Set(FIX('rwa-tokens.json').rows.filter((r) => r.issuer.key === 'rhj').map((r) => r.address));
      // a token's own picture (its avatar, not a chain's badge) in a Robinhood Chain row (the suite's Ethereum rows are Robinhood Chain's pools re-keyed, pictures and all)
      const art = () => ev('[...document.querySelectorAll("#mkt-side .mkt-ava img.mkt-logo, #mkt-view .mkt-ava img.mkt-logo")].map((i) => { const r = i.closest("[data-chain]") || { dataset: {} }; return { src: decodeURIComponent(i.getAttribute("src")), c: r.dataset.chain || "", t: r.dataset.token || r.dataset.openToken || "" }; })');
      const ownArt = (xs) => xs.filter((x) => x.c === 'robinhood' && (/\/0x[0-9a-f]{40}\.(png|jpe?g|webp|svg|gif)/i.test(x.src) || RHJ.has(x.t)));
      // 3. no Robinhood artwork anywhere /market draws a token: the side list on a Stock Token's view, and the chain view's Top tokens beside the RWA tab
      await go('/market?chain=robinhood&token=' + TSLA, 1280); await until('document.querySelectorAll("#mkt-list .mkt-row").length > 5'); await sleep(200);
      const a1 = await art(), sideRhj = await ev('[...document.querySelectorAll("#mkt-list .mkt-row")].filter((b) => ' + JSON.stringify([...RHJ]) + '.includes(b.dataset.token)).length'), lede1 = await textOf('#mkt-rwa-host .mkt-rwa-lede');
      await go('/market?chain=robinhood&tab=rwa', 1280); await rwaReady(); await until('document.querySelectorAll(".mkt-top .mkt-row").length > 3'); await sleep(200);
      const a2 = await art(), topRhj = await ev('[...document.querySelectorAll(".mkt-top .mkt-row")].filter((b) => ' + JSON.stringify([...RHJ]) + '.includes(b.dataset.openToken)).length'), foot2 = await textOf('#mkt-foot');
      check('review two: no Robinhood artwork where /market draws a token — the side list beside a Stock Token\'s RWA card and the chain view\'s Top tokens beside the RWA tab draw no picture for a Robinhood Stock Token and none named after a token\'s own address, while both say "No Robinhood logos or artwork are used"; other tokens keep their pictures',
        sideRhj > 0 && topRhj > 0 && !ownArt(a1).length && !ownArt(a2).length && a1.length > 0 && /No Robinhood logos or artwork are used/.test(lede1) && /No Robinhood logos or artwork are used/.test(foot2), JSON.stringify({ own1: ownArt(a1).slice(0, 3), own2: ownArt(a2).slice(0, 3), sideRhj, topRhj }));
      // 2. the TSLA card's Size line: the partial TVL says it may be low, in sight
      await go('/market?chain=robinhood&token=' + TSLA, 1280); await cardReady();
      const size = await ev('(() => { const s = document.querySelector("#mkt-rwa-host [aria-labelledby=\\"mkt-rw5-h\\"]"); const c = s.cloneNode(true); c.querySelectorAll("details").forEach((d) => d.remove()); return c.textContent; })()');
      check('review two: TSLA\'s Size part says in sight that its TVL in DeFi may be low ("⚠ may be low: Longbow not read"), not only inside its closed pop-down — a partial sum never stands as a plain figure',
        /TVL in DeFi \$3,895\.81 \(DefiLlama · [^)]*\) ⚠ may be low: Longbow not read/.test(size), size.slice(0, 300));
      // 11. a direct link (no RWA tab) to an RWA whose market read fails: GeckoTerminal does not know it (GLD), or is being asked a lot (TSLA)
      const gld = FIX('rwa-tokens.json').rows.find((r) => r.symbol === 'GLD').address;
      let m = FAKE.log.length;
      await go('/market?chain=robinhood&token=' + gld, 1280); await cardReady();
      const g1 = { fail: await textOf('#mkt-view .mkt-fail'), s1: (await ev(CARD) || {}).s1 || '', tab: await ev('document.getElementById("mkt-tab-rwa").getAttribute("aria-selected")'), lists: FAKE.log.slice(m).filter((x) => x.startsWith('/api/market/rwa?')).length };
      FAKE.unavailable.add(TSLA);
      await go('/market?chain=robinhood&token=' + TSLA, 390); await cardReady();
      const g2 = { fail: await textOf('#mkt-view .mkt-fail'), s1: (await ev(CARD) || {}).s1 || '', L: await ev(LAYOUT) };
      FAKE.unavailable.clear();
      check('review two: a direct link to an RWA whose market read fails shows its RWA facts without the RWA tab — GLD, which GeckoTerminal does not know (the 404 carries its row), and TSLA while GeckoTerminal is being asked a lot (the answer carries its row) — the failure said first, the RWA list never asked for',
        /GeckoTerminal does not know this token/.test(g1.fail) && /✓ Registry \+ on-chain/.test(g1.s1) && g1.tab === 'false' && g1.lists === 0 && /GeckoTerminal is being asked a lot right now/.test(g2.fail) && /✓ Registry \+ on-chain/.test(g2.s1) && g2.L.sw <= g2.L.iw && !g2.L.small.length, JSON.stringify({ g1, g2: Object.assign({}, g2, { s1: g2.s1.slice(0, 80) }) }).slice(0, 600));
      // 13. a lookalike's own view: the warning under its title, with the real one in full and a way to open it
      await go('/market?chain=robinhood&token=' + GME_MEME, 1280); await until('!!document.querySelector(".mkt-rwa-look")');
      const lk = await ev(`(() => { const s = document.querySelector(".mkt-rwa-look"); if (!s) return null; const b = s.querySelector("[data-open-token]"); const v = document.getElementById("mkt-view"); const fail = v.querySelector(".mkt-fail"), head = v.querySelector(".mkt-vhead"), top = s.getBoundingClientRect().top + scrollY;
        return { t: s.textContent, open: b ? b.dataset.openToken : null, tip: b ? b.dataset.tip || "" : "", h: b ? Math.round(b.getBoundingClientRect().height) : 0, top: Math.round(top), afterHead: head ? !!(head.compareDocumentPosition(s) & 4) : null, afterFail: fail ? !!(fail.compareDocumentPosition(s) & 4) : null, shift: Math.round(${MAPSHIFT}) }; })()`);
      check('review two: the "GameStop" $gme memecoin\'s own /market view says under its title that it only shares Robinhood\'s $GME ticker — "⚠️ Same ticker as Robinhood’s $GME — not it", why, the real one\'s full address and an Open it button (44 px, its data-tip) — not only in the Scanner\'s read far below',
        lk && /⚠️ Same ticker as Robinhood’s \$GME — not it/.test(lk.t) && /Same ticker as \$GME, but not issued by Robinhood Assets \(Jersey\) — the registry lists \$GME at 0x1b0e…153e/.test(lk.t) && /The real \$GME \(Robinhood Assets \(Jersey\) Limited \(RHJ\)\): .*0x1b0e319c6a659f002271b69db8a7df2f911c153e/.test(lk.t)
        && lk.open === '0x1b0e319c6a659f002271b69db8a7df2f911c153e' && lk.tip.length >= 8 && lk.h >= 44 && lk.top - lk.shift < 1200 && (lk.afterHead !== false) && (lk.afterFail !== false), JSON.stringify(lk).slice(0, 500));
      // 14. a token not confirmed on the chain: listed as one, never asserted to be its issuer's; its list-only evidence not proof
      const goog = FIX('rwa-tokens.json').rows.find((r) => /^GOOGLon$/.test(r.symbol)).address;
      await go('/market?chain=robinhood&token=' + goog, 1280); await cardReady();
      const gc = await ev(CARD), gl = await textOf('#mkt-rwa-host > .mkt-rwa-lede');
      check('review two: Ondo\'s GOOGLon, not confirmed on the chain yet — its lead says "Listed as a real-world-asset token of Ondo Global Markets, not confirmed on the chain yet — not counted", never "issued by"; its issuer-list evidence is "A3 · listed, not proof yet"; its ticker as the chain writes it',
        /Listed as a real-world-asset token of Ondo Global Markets, not confirmed on the chain yet — not counted/.test(gl) && !/issued by/.test(gl) && /A3 · listed, not proof yet/.test(gc.s1) && !/A3 · proof/.test(gc.s1) && /GOOGLon|GOOGL/.test(gc.s1), gl + ' || ' + gc.s1.slice(0, 300));
      // 12. WEEK (its own pools never asked): no "could not be read" about them
      await go('/market?chain=robinhood&token=' + FIX('rwa-tokens.json').rows.find((r) => r.symbol === 'WEEK').address, 1280); await cardReady();
      const wc = await ev(CARD);
      check('review two: WEEK\'s tokens-paired part says no pool among the most-traded pools kept pairs it, and why ("only the 12 RWAs with the most liquidity have their own pools read") — never that pools never asked "could not be read"',
        /No pool among the most-traded pools this site keeps pairs it with another token from \$1,000 of reserve \(only the 12 RWAs with the most liquidity have their own pools read\)\./.test(wc.s7) && !/could not be read/.test(wc.s7), wc.s7);
      // 15/17. an issuer chosen: the rows' own totals, then the whole chain's said as such; a kind chosen keeps its capitals
      await go('/market?chain=robinhood&tab=rwa&rissuer=ondo', 1280); await rwaReady();
      const oc = await textOf('#mkt-cap');
      await go('/market?chain=robinhood&tab=rwa&rview=tokens&rkind=etf', 1280); await rwaReady();
      const ek = { now: await textOf('#mkt-rf-now'), cap: await textOf('#mkt-cap') };
      check('review two: with an issuer or a kind chosen the caption gives the rows\' own totals ("These rows: N RWA tokens counted — …") and then says the totals are the whole chain\'s, every kind and issuer — never chain-wide sums beside a filter as if they were its own; the choices keep their capitals ("ETFs")',
        /Ondo Global Markets only/.test(oc) && /These rows: \d+ RWA tokens? counted — value on chain/.test(oc) && /The whole chain, every kind and issuer — counted: 25 RWA tokens/.test(oc) && !/Counted: 25/.test(oc)
        && /ETFs/.test(ek.now) && !/etfs/.test(ek.now) && /These rows: \d+ RWA tokens? counted/.test(ek.cap), JSON.stringify({ oc: oc.slice(0, 400), ek }).slice(0, 700));
      // 10. Midas's chip says what was read: a live ERC-1967 proxy, its code not compared
      const mglo = await ev('(() => { const r = [...document.querySelectorAll("#mkt-list .mkt-row")].find((b) => /mGLO/.test(b.textContent)); return r ? (r.querySelector(".mkt-conf") || {}).title || "" : null; })()');
      await rwaClick('rkind', 'all'); await rwaReady(); await rwaAll();
      const mglo2 = mglo != null ? mglo : await ev('(() => { const r = [...document.querySelectorAll("#mkt-list .mkt-row")].find((b) => /mGLO/.test(b.textContent)); return r ? (r.querySelector(".mkt-conf") || {}).title || "" : null; })()');
      check('review two: Midas\'s mGLO, confirmed by a live ERC-1967 proxy at its listed address, is said so — "a live ERC-1967 proxy on the chain — its code is not compared with the issuer’s" — never "its fingerprint on the chain is the issuer’s"',
        /a live ERC-1967 proxy on the chain — its code is not compared with the issuer’s/.test(mglo2 || '') && !/fingerprint on the chain is the issuer’s/.test(mglo2 || ''), String(mglo2));
      check('review two: market.js never calls the reference "the share" — the premium chip says "vs its reference", and the price check says the reference is one token\'s price, the share\'s × the token\'s multiplier', !/vs the share|underlying’s own price/.test(read('market.js')) && /% vs its reference/.test(read('market.js')) && /the share’s price × the token’s multiplier/.test(read('market.js')));
    });

    await step('the three tabs by keyboard', async () => {
      await go('/market', 1280); await listReady();
      await ev('document.getElementById("mkt-tab-chains").focus(), true');
      const right = () => key('ArrowRight', 'ArrowRight', 39);
      await right(); await listReady();
      const t = { f: await ev('document.activeElement.id'), url: await ev('location.search') };
      await right(); await rwaReady();
      const a = { f: await ev('document.activeElement.id'), url: await ev('location.search'), sel: await ev('document.getElementById("mkt-tab-rwa").getAttribute("aria-selected")') };
      await right(); await listReady(); await sleep(100);
      const b = { f: await ev('document.activeElement.id'), url: await ev('location.search') };
      await key('End', 'End', 35); await rwaReady();
      const c = { f: await ev('document.activeElement.id'), url: await ev('location.search') };
      check('the tablist\'s arrows, Home and End move over all three tabs and select each (wrapping); going to the RWAs tab puts it in the address and leaving it takes it out',
        t.f === 'mkt-tab-tokens' && t.url === '' && a.f === 'mkt-tab-rwa' && a.sel === 'true' && a.url === '?chain=robinhood&tab=rwa' && b.f === 'mkt-tab-chains' && b.url === '?chain=robinhood' && c.f === 'mkt-tab-rwa' && c.url === '?chain=robinhood&tab=rwa', JSON.stringify({ t, a, b, c }));
    });

    // last, so the steps before it see the page history they had before it (run earlier in the walk, its extra page loads moved where
    // the chain drop-down opened at 320 px in a later step)
    await step('a chain\'s market cap, cross-checked: the chip, the caption and the detail', async () => {
      await go('/market', 1280);
      await until('document.querySelectorAll("#mkt-list .mkt-row").length > 5');
      await ev('document.querySelector("#mkt-ctl-chains [data-sort=\\"mcap\\"]").click(), true');
      await until('document.querySelectorAll("#mkt-list .mkt-chk").length > 3');
      const lst = await ev('({ chips: [...document.querySelectorAll("#mkt-list .mkt-chk")].map((e) => e.textContent), cap: document.getElementById("mkt-cap").textContent, text: document.getElementById("mkt-list").textContent, fantom: ((document.querySelector("#mkt-list [data-chain=\\"fantom\\"]") || {}).textContent || "") })');
      await go('/market', 320);
      await until('document.querySelectorAll("#mkt-list .mkt-row").length > 5');
      await ev('document.querySelector("#mkt-ctl-chains [data-sort=\\"mcap\\"]").click(), true');
      await until('document.querySelectorAll("#mkt-list .mkt-chk").length > 3');
      const l320 = await ev(LAYOUT);
      check('ranked by market cap, each row carries its check in words — "✓ 2 sources agree", "⚠ Sources differ", "1 source" — the caption says the figure is CoinGecko\'s, checked against CoinLore, Fantom is "Not available" with why, never $0, and at 320 px the chips fit their rows',
        ['✓ 2 sources agree', '⚠ Sources differ', '1 source'].every((t) => lst.chips.includes(t)) && /Market cap of the chain’s own token: CoinGecko’s figure, checked against CoinLore\./.test(lst.cap)
        && /Not available/.test(lst.fantom) && /lists no circulating supply/.test(lst.fantom) && !/\$0(?![.\d])/.test(lst.text) && l320.sw <= l320.iw && !l320.out.length && !l320.small.length, JSON.stringify({ lst, l320 }).slice(0, 600));
      const fits = [];
      for (const w of [320, 1280]) {
        await go('/market?chain=arbitrum', w);
        await until('!!document.getElementById("mkt-mc-h")');
        const d = await ev('(() => { const c = document.querySelector(".mkt-mcap"); return c ? { rows: [...c.querySelectorAll("tbody tr")].map((t) => t.textContent), notes: [...c.querySelectorAll(".mkt-chknotes li")].map((l) => l.textContent), chip: (document.querySelector(".mkt-stat .mkt-chk") || {}).textContent || "", text: c.textContent } : null; })()');
        fits.push({ w, d, l: await ev(LAYOUT) });
      }
      const d0 = fits[0].d || {};
      check('  ...and the chain view lists each source\'s market cap, price and circulating supply with how recent it is ("As of"), why they differ in the sources\' own numbers, and the token check — Arbitrum\'s says CoinGecko named only its gas token (ETH), so ARB is not checked by it — at 320 and 1280 px, nothing outside the column, nothing under the text floor',
        fits.every((x) => x.d && x.l.sw <= x.l.iw && !x.l.out.length && !x.l.small.length) && d0.rows.length === 2 && /^CoinGecko\$1\.15B\$0\.1668/.test(d0.rows[0]) && /^CoinLore\$904M/.test(d0.rows[1]) && /6\.89B/.test(d0.rows[0]) && /5\.4B/.test(d0.rows[1])
        && /both price \$ARB the same/.test(d0.notes.join(' ')) && d0.chip === '⚠ Sources differ' && !/CoinGecko names the same token for this chain/.test(d0.text)
        && /The chain’s token: Checked for its gas token only — CoinGecko names \$ETH \(ethereum\), the chain’s gas token, as its native coin; that does not check \$ARB \(arbitrum\), the token whose market cap is shown\./.test(d0.text) && /never an average/.test(d0.text) && /As of/.test(d0.text), JSON.stringify(fits.map((x) => ({ w: x.w, d: x.d && { rows: x.d.rows, chip: x.d.chip }, l: x.l }))).slice(0, 700));
      await go('/market?chain=fantom', 390);
      await until('!!document.getElementById("mkt-mc-h")');
      const fd = await ev('({ card: (document.querySelector(".mkt-mcap") || {}).textContent || "", stat: [...document.querySelectorAll(".mkt-stat")].map((s) => s.textContent).find((t) => /Native token market cap/.test(t)) || "" })');
      check('  ...a token CoinGecko gives 0 for (Fantom: no circulating supply) is "Not available" with that reason in the stat and the check, never $0',
        /Not available/.test(fd.stat) && /lists no circulating supply/.test(fd.stat) && /lists no circulating supply/.test(fd.card) && !/\$0(?![.\d])/.test(fd.stat + fd.card), JSON.stringify(fd).slice(0, 400));
    });

    /* ── the bubble map of the whole crypto market (owner, 2026-10-30) ── */
    const MAPFIT = `(() => {
      const fig = document.getElementById('mkt-map-fig'), svg = fig && fig.querySelector('svg.mkt-map-svg'); if (!svg) return null;
      const probe = document.createElement('span'); probe.style.fontSize = 'var(--text-floor)'; document.body.appendChild(probe); const floor = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
      const rgb = (s) => { const m = /rgba?\\(\\s*([\\d.]+)[ ,]+([\\d.]+)[ ,]+([\\d.]+)/.exec(s || ''); if (m) return [+m[1], +m[2], +m[3]]; const c = /color\\(srgb\\s+([\\d.e-]+)\\s+([\\d.e-]+)\\s+([\\d.e-]+)/.exec(s || ''); return c ? [c[1] * 255, c[2] * 255, c[3] * 255] : null; };
      const lum = (x) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(x[0]) + 0.7152 * f(x[1]) + 0.0722 * f(x[2]); };
      const con = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const sw = {}; document.querySelectorAll('#mkt-map-legend .mkt-map-sw').forEach((s) => { const k = [...s.classList].find((c) => c.startsWith('mkt-b-')).slice(6); sw[k] = getComputedStyle(s).backgroundColor; });
      const bubs = [...svg.querySelectorAll('.mkt-bub')].map((g) => { const c = g.querySelector('circle');
        return { id: g.dataset.coin, b: [...g.classList].find((x) => x.startsWith('mkt-b-')).slice(6), r: +c.getAttribute('r'), cx: +c.getAttribute('cx'), cy: +c.getAttribute('cy'), fill: getComputedStyle(c).fill, title: !!g.querySelector('title'),
          texts: [...g.querySelectorAll('text')].map((t) => { const bb = t.getBBox(); return { t: t.textContent, fs: parseFloat(getComputedStyle(t).fontSize), fill: getComputedStyle(t).fill, x0: bb.x, y0: bb.y + bb.height * 0.2, x1: bb.x + bb.width, y1: bb.y + bb.height * 0.8 }; }) }; });
      const texts = bubs.flatMap((x) => x.texts.map((t) => Object.assign({ id: x.id, cx: x.cx, cy: x.cy, r: x.r, bf: x.fill }, t)));
      const inC = (t, px, py) => Math.hypot(px - t.cx, py - t.cy) <= t.r + 1;
      let over = 0; for (let i = 0; i < bubs.length; i++) for (let j = i + 1; j < bubs.length; j++) if (Math.hypot(bubs[i].cx - bubs[j].cx, bubs[i].cy - bubs[j].cy) < bubs[i].r + bubs[j].r - 0.5) over++;
      const sW = +svg.getAttribute('width'), sH = +svg.getAttribute('height'), layout = svg.getAttribute('data-layout'), ring = svg.querySelector('.mkt-map-ring');
      const outBox = bubs.filter((x) => (layout === 'ring' ? Math.hypot(x.cx - sW / 2, x.cy - sW / 2) + x.r > sW / 2 - 1 : x.cx - x.r < -0.5 || x.cx + x.r > sW + 0.5 || x.cy - x.r < -0.5 || x.cy + x.r > sH + 0.5)).map((x) => x.id).slice(0, 4);
      return { n: bubs.length, biggest: bubs.reduce((a, b) => (b.r > a.r ? b : a)).id, buckets: Object.fromEntries(bubs.map((x) => [x.id, x.b])), titles: bubs.every((x) => x.title),
        first: Object.fromEntries(bubs.map((x) => [x.id, x.texts.length ? x.texts[0].t : null])), over, outBox, layout, ringDrawn: !!ring, svgH: sH, figW: fig.clientWidth, sw: Object.assign({}, sw),
        wrongFill: bubs.filter((x) => x.b !== 'none' && (!sw[x.b] || x.fill !== sw[x.b])).map((x) => x.id + ':' + x.fill + '≠' + sw[x.b]).slice(0, 4),
        small: texts.filter((t) => t.fs < floor - 0.5).map((t) => t.id + ':' + t.t + '@' + t.fs).slice(0, 4), labelled: new Set(texts.map((t) => t.id)).size,
        outside: texts.filter((t) => ![[t.x0, t.y0], [t.x1, t.y0], [t.x0, t.y1], [t.x1, t.y1]].every(([px, py]) => inC(t, px, py))).map((t) => t.id + ':' + t.t).slice(0, 4),
        lowContrast: texts.filter((t) => !rgb(t.fill) || !rgb(t.bf) || con(rgb(t.fill), rgb(t.bf)) < 4.5).map((t) => t.id + ':' + t.t + ' ' + t.fill + ' on ' + t.bf).slice(0, 4),
        btc: texts.filter((t) => t.id === 'bitcoin').map((t) => t.t), svgW: Math.round(svg.getBoundingClientRect().width), iw: innerWidth, ih: innerHeight, role: svg.getAttribute('role'), aria: svg.getAttribute('aria-label') || '', floor };
    })()`;
    const mapReady = (n) => until('document.querySelectorAll("#mkt-map svg.mkt-map-svg .mkt-bub").length' + (n == null ? ' > 0' : ' === ' + n));
    const HMF = FIX('heatmap.json').rows, wantB = Object.fromEntries(HMF.map((r) => [r.id, MM.bucketOf(r.change24h.v)]));
    const SYM = Object.fromEntries(HMF.map((r) => [r.id, r.symbol || r.name || r.id]));
    // a swatch's luminance from its colour as computed: rgb(…) for a token, color(srgb …) for a color-mix()
    const swLum = (s) => { const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(s || ''), c = /color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)/.exec(s || '');
      const rgb = m ? [+m[1], +m[2], +m[3]] : c ? [c[1] * 255, c[2] * 255, c[3] * 255] : null; if (!rgb) return NaN;
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
    await step('the bubble map at 320, 390, 768, 1024, 1280 and 1920 px', async () => {
      const fits = [];
      for (const w of [320, 390, 768, 1024, 1280, 1920]) {
        await go('/market', w); await mapReady(100); await sleep(250);
        fits.push({ w, m: await ev(MAPFIT), l: await ev(LAYOUT), cap: await textOf('#mkt-map-cap'), legend: await ev('[...document.querySelectorAll("#mkt-map-legend li")].map((li) => li.textContent)') });
      }
      const unlabelled = (m) => Object.entries(SYM).filter(([id, sym]) => m.first[id] !== sym).map(([id]) => id + ':' + m.first[id]);
      const bad = fits.filter(({ w, m, l }) => !m || m.n !== 100 || m.biggest !== 'bitcoin' || !m.titles || m.wrongFill.length || m.small.length || m.outside.length || m.lowContrast.length || m.labelled !== m.n || unlabelled(m).length
        || m.over || m.outBox.length || Object.entries(wantB).some(([id, b]) => m.buckets[id] !== b) || l.sw > l.iw || l.out.length || l.small.length || m.role !== 'img'
        || Math.abs(m.svgW - m.figW) > 1 || (m.layout === 'ring') !== m.ringDrawn || (m.layout === 'ring' && m.svgH !== m.svgW)
        || (w < 768 && (m.svgW < m.iw - 2 * 16 - 6 || m.layout !== 'column')) || (w >= 1280 && (m.layout !== 'ring' || m.svgW < 1100)));
      const f = fits.find((x) => x.w === 1280) || {};
      check('the bubble map in a real browser, at 320, 390, 768, 1024, 1280 and 1920 px (owner, round 2: "Show all the tickers in all of the bubbles"): 100 bubbles, EVERY one with its ticker as its first line, none under the text floor and none wider than its bubble at its height, each in an ink of 4.5:1 or more on its fill; Bitcoin the largest; no two bubbles overlapping and none outside the ring or the column\'s walls; each coloured by its 24 h step (its fill the legend swatch\'s, from the theme), every bubble a <title>; the map as wide as its box (no 760 px cap) — the ring from 1280 px (as wide as the section), a column on a phone (as wide as the screen); no sideways scroll, nothing outside the page\'s column',
        fits.length === 6 && !bad.length, JSON.stringify(bad.map((x) => ({ w: x.w, un: x.m && unlabelled(x.m).slice(0, 4), m: x.m && Object.assign({}, x.m, { buckets: undefined, first: undefined, sw: undefined }), l: x.l }))).slice(0, 900));
      const lums = fits.filter((x) => x.m).map((x) => [x.w, ['up0', 'up2', 'up5', 'up10', 'dn0', 'dn2', 'dn5', 'dn10'].map((k) => swLum(x.m.sw[k]))]);
      const rises = (v) => v.every((y, i) => isFinite(y) && (!i || y > v[i - 1]));
      check('  ...brighter for a bigger move (owner, round 2: "make the biggest movers be brighter green instead of the shades getting darker"): the legend\'s swatches, as drawn, rise in luminance with the step on each side — >0% < >2% < >5% < >10%, and <0% < <−2% < <−5% < <−10% — at every width; the map\'s layout at each width: ' + fits.map((x) => x.w + ' ' + (x.m && x.m.layout) + ' ' + (x.m && x.m.svgW + '×' + x.m.svgH)).join(', '),
        lums.length === 6 && lums.every(([, v]) => rises(v.slice(0, 4)) && rises(v.slice(4))), JSON.stringify(lums.map(([w, v]) => [w, v.map((y) => +y.toFixed(3))])));
      check('  ...its words: BTC "$76,894", "Dominance: 59.6%", "▼ −5.27%"; the summary a screen reader hears ("Bitcoin is 59.6% of the market, down 5.3% in 24 h … 88 down, 11 up, 1 unchanged", and that the sizes are on a compressed scale); the caption (total market cap $2.59T from CoinGecko, how many are down and up, what size and colour mean — a compressed scale, so the smallest do not compare by size and Dominance is the exact share; brighter for a bigger move — not advice); the legend\'s ten steps with their counts',
        f.m && f.m.btc.join('|') === 'BTC|$76,894|Dominance: 59.6%|▼ −5.27%' && /^Bubble map of the 100 largest coins by market cap: Bitcoin is 59\.6% of the market, down 5\.3% in 24 h; Ethereum is 10\.4% of the market, down 6\.3% in 24 h; 88 down, 11 up, 1 unchanged\. The bubbles’ sizes are on a compressed scale, so every ticker fits; every coin and its exact share of the market is in the list under the map\.$/.test(f.m.aria)
        && /^Total market cap \$2\.59T \(CoinGecko · .+\) · Over 24 h, 88 of these 100 coins are down, 11 up, 1 unchanged · Bubble size: market cap, on a compressed scale so every ticker fits \(the smallest do not compare by size; Dominance is the exact share\)\. Colour: 24 h price change, brighter for a bigger move\. Not advice, never a tip to buy\.$/.test(f.cap)
        && f.legend.length === 10 && f.legend[0] === '>10% (1)' && f.legend[4] === '0% (1)' && f.legend[8] === '<−10% (36)' && f.legend[9] === 'no 24 h change given (0)', JSON.stringify({ btc: f.m && f.m.btc, aria: f.m && f.m.aria, cap: f.cap, legend: f.legend }).slice(0, 700));
    });
    await step('the bubble map: its choices, the list, the tooltip and the card', async () => {
      await go('/market', 1280); await mapReady(100);
      const n = () => ev('document.querySelectorAll("#mkt-map .mkt-bub").length');
      await press('document.getElementById("mkt-map-stables")'); await mapReady(83);
      const noSt = { n: await n(), pressed: await ev('document.getElementById("mkt-map-stables").getAttribute("aria-pressed")'), cap: await textOf('#mkt-map-cap'), rows: await ev('document.querySelectorAll("#mkt-map-table tbody tr").length'), usdt: await ev('!!document.querySelector("#mkt-map [data-coin=tether]")') };
      await press('document.querySelector("#mkt-map [data-map-top=\\"50\\"]")'); await mapReady(40);
      const top50 = { n: await n(), p50: await ev('document.querySelector("#mkt-map [data-map-top=\\"50\\"]").getAttribute("aria-pressed")'), p100: await ev('document.querySelector("#mkt-map [data-map-top=\\"100\\"]").getAttribute("aria-pressed")') };
      await press('document.getElementById("mkt-map-stables")'); await mapReady(50); const top50st = await n();
      await press('document.querySelector("#mkt-map [data-map-top=\\"100\\"]")'); await mapReady(100);
      check('  ..."Hide stablecoins" leaves out CoinGecko\'s 17 (83 bubbles, the chip pressed, the caption saying so, the list too) and Top 50 draws the 50 largest (40 without their stablecoins); both undo',
        noSt.n === 83 && noSt.pressed === 'true' && /stablecoins left out/.test(noSt.cap) && noSt.rows === 83 && !noSt.usdt && top50.n === 40 && top50.p50 === 'true' && top50.p100 === 'false' && top50st === 50 && (await n()) === 100, JSON.stringify({ noSt, top50, top50st }));
      // the tooltip: a real pointer over HYPE, then off the map
      await ev('document.getElementById("mkt-map-fig").scrollIntoView({ block: "center", behavior: "instant" }), true'); await sleep(150);
      const hp = await ev('(() => { const c = document.querySelector("#mkt-map [data-coin=hyperliquid] circle").getBoundingClientRect(); return [c.left + c.width / 2, c.top + c.height / 2]; })()');
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hp[0], y: hp[1], button: 'none' }); await sleep(150);
      const tip = await ev('(() => { const t = document.getElementById("mkt-map-tip"), f = document.getElementById("mkt-map-fig").getBoundingClientRect(), r = t.getBoundingClientRect(); return { shown: !t.hidden, text: t.textContent, inBox: r.left >= f.left - 1 && r.right <= f.right + 1 && r.top >= f.top - 1 && r.bottom <= f.bottom + 1, chip: (t.querySelector(".mkt-chk") || {}).textContent || "", title: !!document.querySelector("#mkt-map [data-coin=hyperliquid] title") }; })()');
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' }); await sleep(150);
      const tipGone = await ev('({ hidden: document.getElementById("mkt-map-tip").hidden, title: !!document.querySelector("#mkt-map [data-coin=hyperliquid] title") })');
      check('  ...a pointer over a bubble shows its tooltip inside the map — symbol, name, price, market cap, dominance, 24 h change, 24 h volume, source and age, the CoinLore chip (HYPE: "⚠ Sources differ") — standing in for its <title> while it shows, and leaving the map hides it',
        tip.shown && /^HYPE Hyperliquid/.test(tip.text) && /Price\$89\.09/.test(tip.text) && /Market cap\$21\.3B/.test(tip.text) && /Dominance0\.82%/.test(tip.text) && /24 h change▲ \+10\.4%/.test(tip.text) && /24 h volume\$3B/.test(tip.text) && /CoinGecko · /.test(tip.text)
        && tip.chip === '⚠ Sources differ' && tip.inBox && !tip.title && tipGone.hidden && tipGone.title, JSON.stringify({ tip, tipGone }).slice(0, 500));
      // a press on a bubble: the card under the map
      await press('document.querySelector("#mkt-map [data-coin=ethereum] circle")'); await until('!document.getElementById("mkt-map-card").hidden');
      const card = await ev('(() => { const c = document.getElementById("mkt-map-card"), a = c.querySelector("a.mkt-map-ext"); return { text: c.textContent, href: a ? a.getAttribute("href") : null, rel: a ? a.getAttribute("rel") : null, on: [...document.querySelectorAll("#mkt-map .mkt-bub.is-on")].map((g) => g.dataset.coin), focus: document.activeElement && document.activeElement.id, after: c.compareDocumentPosition(document.getElementById("mkt-map-fig")) & 2 }; })()');
      const cardL = await ev(LAYOUT);
      check('  ...a press on a bubble opens its card under the map: its figures with their sources and ages, the check chip and its notes, "View on CoinGecko ↗" (https://www.coingecko.com/en/coins/ethereum, rel="noopener"), not advice; the bubble ringed and the card\'s heading focused',
        /^ETH Ethereum✓ 2 sources agree/.test(card.text) && /Price\$2,207CoinGecko · /.test(card.text) && /Dominance10\.4%share of CoinGecko's total, \$2\.59T, in percent · CoinGecko · /.test(card.text) && /24 h price change▼ −6\.32%CoinGecko · /.test(card.text) && /Rank#2/.test(card.text)
        && card.href === 'https://www.coingecko.com/en/coins/ethereum' && card.rel === 'noopener' && /View on CoinGecko ↗/.test(card.text) && /Not advice, never a tip to buy\./.test(card.text) && card.on.join() === 'ethereum' && card.focus === 'mkt-mapc-h' && card.after && cardL.sw <= cardL.iw && !cardL.out.length && !cardL.small.length,
        JSON.stringify({ card, cardL }).slice(0, 600));
      // the keyboard's way in: the list, a row's button, Enter, then Escape
      await press('document.querySelector("#mkt-map-list > summary")'); await until('document.getElementById("mkt-map-list").open');
      const list = await ev('({ rows: document.querySelectorAll("#mkt-map-table tbody tr").length, btns: [...document.querySelectorAll("#mkt-map-table [data-map-coin]")].filter((b) => b.tagName === "BUTTON" && (b.dataset.tip || "").length >= 8 && b.getBoundingClientRect().height >= 43.5).length, head: [...document.querySelectorAll("#mkt-map-table thead th")].map((t) => t.textContent).join("|"), first: document.querySelector("#mkt-map-table tbody tr").textContent })');
      await ev('document.querySelector("#mkt-map-table [data-map-coin=tether]").focus(), true'); await K.enter(); await until('/^USDT/.test(document.getElementById("mkt-map-card").textContent)');
      const kb = { focus: await ev('document.activeElement.id'), card: (await textOf('#mkt-map-card')).slice(0, 40), row: await ev('document.querySelector("#mkt-map-table tr.is-on").dataset.coin') };
      await K.esc(); await sleep(150);
      const shut = { hidden: await ev('document.getElementById("mkt-map-card").hidden'), focus: await ev('document.activeElement.dataset.mapCoin || document.activeElement.id'), on: await ev('document.querySelectorAll("#mkt-map .mkt-bub.is-on, #mkt-map-table tr.is-on").length') };
      const listL = await ev(LAYOUT);
      check('  ..."Show as a list" is the keyboard\'s way in: a table of every coin (rank, coin, price, market cap, dominance, 24 h change, check), each row\'s coin a 44 px button with its description; Enter opens the same card (focused), Escape shuts it and gives the focus back to the row',
        list.rows === 100 && list.btns === 100 && list.head === 'Rank|Coin|Price|Market cap|Dominance|24 h change|Check' && /^#1BTC Bitcoin\$76,894\$1\.55T59\.6%▼ −5\.27%✓ 2 sources agree$/.test(list.first)
        && kb.focus === 'mkt-mapc-h' && /^USDT Tether/.test(kb.card) && kb.row === 'tether' && shut.hidden && shut.focus === 'tether' && shut.on === 0 && listL.sw <= listL.iw && !listL.out.length && !listL.small.length, JSON.stringify({ list, kb, shut, listL }).slice(0, 600));
      await go('/market', 390); await mapReady(100);
      await press('document.querySelector("#mkt-map-list > summary")'); await until('document.getElementById("mkt-map-list").open');
      await ev('document.querySelector("#mkt-map-table [data-map-coin=bitcoin]").click(), true'); await until('!document.getElementById("mkt-map-card").hidden');
      const phone = await ev(LAYOUT);
      check('  ...and on a phone the list folds into labelled cards and the card fits: no sideways scroll, nothing under the floor', phone.sw <= phone.iw && !phone.out.length && !phone.small.length
        && (await ev('getComputedStyle(document.querySelector("#mkt-map-table thead")).position')) === 'absolute', JSON.stringify(phone));
    });
    await step('the bubble map: a refresh and a refresh that fails, the focus through both, the tooltip on the screen, closing a card, its chip', async () => {
      // the answer as if it had just been read (every `at` moved to a minute ago), so its ages are minutes
      const fresh = (j) => { const d = Date.now() - 60e3 - j.at; const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === 'at' && typeof v === 'number') o[k] = v + d; else walk(v); } }; walk(j); return j; };
      FAKE.heatmapPatch = fresh;
      await go('/market', 1280); await mapReady(100);
      const centre = (id) => ev('(() => { const c = document.querySelector("#mkt-map [data-coin=' + id + '] circle").getBoundingClientRect(); return [c.left + c.width / 2, c.top + c.height / 2]; })()');
      const hover = async (p) => { await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'none' }); await sleep(150); };
      const tipText = () => ev('(() => { const t = document.getElementById("mkt-map-tip"); return t && !t.hidden ? t.textContent : ""; })()');
      const heatReads = () => FAKE.log.filter((x) => x.startsWith('/api/market/heatmap')).length;
      // the page's clock moved on, and the tab looked at again: the path a tab takes back after 10 minutes (the 10-minute timer runs the same read)
      const later = async (min) => { const n0 = heatReads(); await ev('(() => { const n = Date.now; Date.now = () => n() + ' + min + ' * 60e3; document.dispatchEvent(new Event("visibilitychange")); return true; })()');
        for (let i = 0; i < 130 && heatReads() <= n0; i++) await sleep(60); await sleep(400); };
      await ev('document.getElementById("mkt-map-fig").scrollIntoView({ block: "center", behavior: "instant" }), true'); await sleep(150);
      await hover(await centre('bitcoin')); const tip1 = await tipText(); await hover([5, 5]);
      // the next read: Bitcoin at $70,000, down 12.5%; Ethereum with no 24 h change
      FAKE.heatmapPatch = (j) => { fresh(j); const b = j.rows.find((r) => r.id === 'bitcoin'), e = j.rows.find((r) => r.id === 'ethereum');
        b.price.v = 70000; b.change24h.v = -12.5; b.mcap.v = 1.4e12; b.dominance.v = (1.4e12 / j.total.v) * 100; e.change24h = { v: null, src: 'coingecko', at: e.change24h.at, why: 'no change given — CoinGecko gives no 24 h change for this coin' }; return j; };
      await later(11);
      await until('[...document.querySelectorAll("#mkt-map [data-coin=bitcoin] text")].some((t) => t.textContent === "$70,000")');
      await hover(await centre('bitcoin')); const tip2 = await tipText(); await hover([5, 5]);
      const aria = await ev('document.querySelector("#mkt-map svg.mkt-map-svg").getAttribute("aria-label")');
      check('  ...the tooltip is built from the map it shows: Bitcoin hovered, then a 10-minute refresh with new figures, then Bitcoin hovered again shows the new ones ($70,000, ▼ −12.5%, $1.4T), never the figures from before; the summary says "no 24 h change given" for a coin without one (never "given in 24 h")',
        /Price\$76,894/.test(tip1) && /Price\$70,000/.test(tip2) && /24 h change▼ −12\.50?%/.test(tip2) && /Market cap\$1\.4T/.test(tip2) && !/76,894/.test(tip2)
        && /Ethereum is [\d.]+% of the market, no 24 h change given; /.test(aria) && !/given in 24 h/.test(aria) && /Bitcoin is [\d.]+% of the market, down 12\.5% in 24 h; /.test(aria), JSON.stringify({ tip1: tip1.slice(0, 120), tip2: tip2.slice(0, 160), aria: aria.slice(0, 200) }));
      // the focus through a refresh: on a row of the list, then on the open card's Close
      await press('document.querySelector("#mkt-map-list > summary")'); await until('document.getElementById("mkt-map-list").open');
      await ev('document.querySelector("#mkt-map-table [data-map-coin=ethereum]").focus(), true');
      await later(11); const fRow = await ev('document.activeElement.dataset.mapCoin || document.activeElement.tagName');
      await K.enter(); await until('/^ETH/.test(document.getElementById("mkt-map-card").textContent)');
      await ev('document.querySelector("#mkt-map-card [data-map-close]").focus(), true');
      await later(11); const fCard = await ev('(() => { const a = document.activeElement; return a.dataset.mapClose ? "close" : a.id || a.tagName; })()'), cardOpen = await ev('!document.getElementById("mkt-map-card").hidden');
      check('  ...a 10-minute refresh builds the list and the card again without dropping the focus: on the ETH row it stays on the ETH row, on the open card\'s ✕ Close it stays on ✕ Close (never sent back to <body>)',
        fRow === 'ethereum' && fCard === 'close' && cardOpen, JSON.stringify({ fRow, fCard, cardOpen }));
      // a refresh that fails: the map it had stays, its ages are worked out again, and the caption says the read failed
      const capAge = '([...document.querySelectorAll("#mkt-map-cap time")].pop() || {}).textContent || ""';   // the total's age (the last <time> in it)
      await ev('document.getElementById("mkt-map-fig").scrollIntoView({ block: "center", behavior: "instant" }), true');
      const cap0 = await textOf('#mkt-map-cap'), age0 = await ev(capAge);
      FAKE.heatmapDown = true; await later(30); FAKE.heatmapDown = false;
      const cap1 = await textOf('#mkt-map-cap'), age1 = await ev(capAge), n1 = await ev('document.querySelectorAll("#mkt-map .mkt-bub").length');
      check('  ...a refresh that fails keeps the map it had (100 bubbles), works its ages out again ("' + age0 + '" → "' + age1 + '") and says so first in the caption: when the read failed, why, how old these figures are and that it asks again — never a frozen "1 min ago" with no sign of the failure',
        n1 === 100 && !/could not be read/.test(cap0) && /^⏳ A newer map could not be read at \d\d:\d\d UTC \(the site answered 503: The market map could not be read just now\): these are CoinGecko’s figures from \d+\u00a0(min|h) ago, and the page asks again every 10 minutes\./.test(cap1)
        && /^\d+\u00a0min ago$/.test(age0) && /^\d+\u00a0(min|h) ago$/.test(age1) && age0 !== age1, JSON.stringify({ cap0: cap0.slice(0, 80), cap1: cap1.slice(0, 260), age0, age1 }));
      // the chip's title says where the reason is: the coin's card (tooltip, list), or nothing more in the card, whose notes are under it
      await ev('document.getElementById("mkt-map-fig").scrollIntoView({ block: "center", behavior: "instant" }), true'); await sleep(150);
      await hover(await centre('hyperliquid'));
      const chipT = { tip: await ev('(document.querySelector("#mkt-map-tip .mkt-chk") || {}).title || ""'), row: await ev('(document.querySelector("#mkt-map-table tr[data-coin=hyperliquid] .mkt-chk") || {}).title || ""') };
      await hover([5, 5]); await press('document.querySelector("#mkt-map-table [data-map-coin=hyperliquid]")'); await until('/^HYPE/.test(document.getElementById("mkt-map-card").textContent)');
      chipT.card = await ev('(document.querySelector("#mkt-map-card .mkt-chk") || {}).title || ""');
      check('  ...a "⚠ Sources differ" chip on a coin points to the coin\'s card for the reason (tooltip and list: "… — the coin’s card says why"), and in the card, whose notes say it, adds nothing — never "the chain’s view", which a coin does not have',
        chipT.tip === 'CoinGecko and CoinLore give market caps more than 10% apart — the coin’s card says why' && chipT.row === chipT.tip && chipT.card === 'CoinGecko and CoinLore give market caps more than 10% apart' && !/chain’s view/.test(JSON.stringify(chipT)), JSON.stringify(chipT));
      // closing a card opened from a bubble, with the list folded (the default): the focus goes to the list's summary, never <body>
      await go('/market', 1280); await mapReady(100);
      await press('document.querySelector("#mkt-map [data-coin=solana] circle")'); await until('/^SOL/.test(document.getElementById("mkt-map-card").textContent)');
      const fOpen = await ev('document.activeElement.id');
      await ev('document.querySelector("#mkt-map-card [data-map-close]").focus(), true'); await K.enter(); await sleep(150);
      const fClose = await ev('(() => { const a = document.activeElement; return a.tagName === "SUMMARY" ? a.parentElement.id + ">summary" : a.id || a.tagName; })()');
      await press('document.querySelector("#mkt-map [data-coin=solana] circle")'); await until('!document.getElementById("mkt-map-card").hidden'); await K.esc(); await sleep(150);
      const fEsc = await ev('(() => { const a = document.activeElement; return a.tagName === "SUMMARY" ? a.parentElement.id + ">summary" : a.id || a.tagName; })()'), listShut = await ev('!document.getElementById("mkt-map-list").open');
      check('  ...a card opened from a bubble with the list folded away: ✕ Close and Escape give the focus to "Show as a list" just under it (a row in a closed list cannot take it) — never <body>',
        fOpen === 'mkt-mapc-h' && fClose === 'mkt-map-list>summary' && fEsc === 'mkt-map-list>summary' && listShut, JSON.stringify({ fOpen, fClose, fEsc, listShut }));
      // the tooltip on the screen: low on the screen, high under the nav, and a phone with no room beside the pointer
      const TIPBOX = '(() => { const t = document.getElementById("mkt-map-tip").getBoundingClientRect(), n = document.querySelector("nav.nav").getBoundingClientRect(); return { shown: !document.getElementById("mkt-map-tip").hidden, top: t.top, bottom: t.bottom, left: t.left, right: t.right, ih: innerHeight, iw: innerWidth, nav: n.bottom }; })()';
      // a bubble whose centre is between lo and hi on the screen and the topmost thing there (nothing of the page's own over it)
      const pick = (lo, hi) => ev('(() => { const b = [...document.querySelectorAll("#mkt-map .mkt-bub circle")].map((c) => { const r = c.getBoundingClientRect(); return { id: c.parentNode.dataset.coin, x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; }).filter((c) => { if (c.r < 8 || c.y < ' + lo + ' || c.y > ' + hi + ') return false; const e = document.elementFromPoint(c.x, c.y); return !!e && !!e.closest(".mkt-bub") && e.closest(".mkt-bub").dataset.coin === c.id; }); b.sort((p, q) => q.y - p.y); return b[0] || null; })()');
      await ev('(() => { const f = document.getElementById("mkt-map-fig").getBoundingClientRect(); window.scrollBy({ top: f.top - innerHeight * 0.45, behavior: "instant" }); return true; })()'); await sleep(200);
      const low = await pick(900 * 0.8, 900 - 12); await hover([low.x, low.y]); const tLow = await ev(TIPBOX); await hover([5, 5]);
      await ev('(() => { const f = document.getElementById("mkt-map-fig").getBoundingClientRect(); window.scrollBy({ top: f.top + 330, behavior: "instant" }); return true; })()'); await sleep(200);
      const navB = await ev('document.querySelector("nav.nav").getBoundingClientRect().bottom'), high = await pick(navB + 8, navB + 90); await hover([high.x, high.y]); const tHigh = await ev(TIPBOX); await hover([5, 5]);
      await go('/market', 320, 568); await mapReady(100);
      // on a phone the map is a column taller than the screen: Bitcoin's bubble (at its top) is brought to the middle of the screen
      await ev('document.querySelector("#mkt-map [data-coin=bitcoin] circle").scrollIntoView({ block: "center", behavior: "instant" }), true'); await sleep(200);
      const ph = await centre('bitcoin'); await hover(ph); const tPh = await ev(TIPBOX); await hover([2, 2]);
      const inScreen = (t) => t.shown && t.bottom <= t.ih + 1 && t.top >= t.nav - 1 && t.left >= -1 && t.right <= t.iw + 1;
      check('  ...the tooltip stays on the part of the screen that can be seen: hovering low on the screen (' + (low && low.id) + ') it opens above the pointer, not off the bottom; hovering just under the sticky nav (' + (high && high.id) + ') it stays below the nav; at 320 px, with no room beside the pointer, it sits above or below it, never over it',
        !!low && !!high && inScreen(tLow) && inScreen(tHigh) && inScreen(tPh) && !(ph[0] >= tPh.left && ph[0] <= tPh.right && ph[1] >= tPh.top && ph[1] <= tPh.bottom), JSON.stringify({ low, tLow, high, tHigh, ph, tPh }));
      // at 320 px, the card's "View on CoinGecko ↗" wraps onto a line of its own and is still a 44 px target
      await press('document.querySelector("#mkt-map [data-coin=bitcoin] circle")'); await until('!document.getElementById("mkt-map-card").hidden');
      const ext = await ev('(() => { const a = document.querySelector("#mkt-map-card .mkt-map-ext").getBoundingClientRect(), c = document.querySelector("#mkt-map-card [data-map-close]").getBoundingClientRect(); return { h: a.height, w: a.width, own: a.bottom <= c.top + 1 }; })()');
      check('  ...at 320 px "View on CoinGecko ↗" is a 44 px target on its own line, like ✕ Close', ext.h >= 43.5, JSON.stringify(ext));
      // only a change in the size it is drawn at redraws it: a phone's address bar folding away (the height alone) does not
      await go('/market', 390, 844); await mapReady(100);
      await ev('(window.__map = document.querySelector("#mkt-map svg.mkt-map-svg"), true)');
      await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true }); await sleep(600);
      const kept = await ev('document.querySelector("#mkt-map svg.mkt-map-svg") === window.__map');
      await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true }); await sleep(600);
      const redrawn = await ev('(() => { const s = document.querySelector("#mkt-map svg.mkt-map-svg"); return s !== window.__map && s.querySelectorAll(".mkt-bub").length === 100; })()');
      check('  ...a change in the window\'s height alone (390×844 → 390×780, a phone\'s address bar folding away) keeps the drawn map; a change in its width draws it again', kept && redrawn, JSON.stringify({ kept, redrawn }));
    });
    await step('the bubble map: folded away and back, remembered; a read that fails; reduced motion', async () => {
      await go('/market', 1280); await mapReady(100);
      await press('document.getElementById("mkt-map-tog")'); await sleep(150);
      const off = await ev('({ body: document.getElementById("mkt-map-body").hidden, exp: document.getElementById("mkt-map-tog").getAttribute("aria-expanded"), text: document.getElementById("mkt-map-tog").textContent, tip: document.getElementById("mkt-map-tog").dataset.tip, kept: localStorage.getItem("jsi:market-map") })');
      const m0 = FAKE.log.length; await go('/market', 1280); await sleep(400);
      const back = { body: await ev('document.getElementById("mkt-map-body").hidden'), exp: await ev('document.getElementById("mkt-map-tog").getAttribute("aria-expanded")'), asked: FAKE.log.slice(m0).filter((x) => x.startsWith('/api/market/heatmap')).length };
      await press('document.getElementById("mkt-map-tog")'); await mapReady(100);
      const on = { exp: await ev('document.getElementById("mkt-map-tog").getAttribute("aria-expanded")'), kept: await ev('localStorage.getItem("jsi:market-map")'), asked: FAKE.log.slice(m0).filter((x) => x.startsWith('/api/market/heatmap')).length };
      check('  ...its button folds it away (aria-expanded false, "Show the map", its description saying what a press does now) and this browser remembers it: the page opens with it folded and does not read it until it is opened again',
        off.body === true && off.exp === 'false' && /^Show the map/.test(off.text) && /Opens the bubble map/.test(off.tip) && off.kept === 'hidden' && back.body === true && back.exp === 'false' && back.asked === 0 && on.exp === 'true' && on.kept === 'shown' && on.asked === 1, JSON.stringify({ off, back, on }));
      FAKE.heatmapDown = true; await go('/market', 1280); await until('!!document.querySelector("#mkt-map-fig .mkt-err-t")');
      const DOWNL = '(() => { const btn = document.querySelector("#mkt-map-fig [data-retry=map]"), rg = document.createRange(); rg.selectNodeContents(btn); const lines = new Set([...rg.getClientRects()].map((r) => Math.round(r.top))).size, b = btn.getBoundingClientRect(), p = document.querySelector("#mkt-map-fig .mkt-err-t").getBoundingClientRect(), sec = document.getElementById("mkt-map").getBoundingClientRect(); return { lines, bh: b.height, below: b.top >= p.bottom - 1, inSec: b.right <= sec.right - 4 && p.left >= sec.left + 4, key: getComputedStyle(document.querySelector(".mkt-map-key")).display, list: getComputedStyle(document.getElementById("mkt-map-list")).display }; })()';
      const down = { t: await textOf('#mkt-map-fig'), retry: await ev('!!document.querySelector("#mkt-map-fig [data-retry=map]")'), svg: await ev('!!document.querySelector("#mkt-map svg")'), l: await ev(DOWNL) };
      await go('/market', 390); await until('!!document.querySelector("#mkt-map-fig .mkt-err-t")'); down.l390 = await ev(DOWNL); down.lay390 = await ev(LAYOUT);
      await go('/market', 1280); await until('!!document.querySelector("#mkt-map-fig .mkt-err-t")');
      FAKE.heatmapDown = false; await press('document.querySelector("#mkt-map-fig [data-retry=map]")'); await mapReady(100);
      const backL = { key: await ev('getComputedStyle(document.querySelector(".mkt-map-key")).display'), list: await ev('getComputedStyle(document.getElementById("mkt-map-list")).display') };
      const errOK = (l) => l.lines === 1 && l.bh >= 43.5 && l.below && l.inSec && l.key === 'none' && l.list === 'none';
      check('  ...a read that fails says so with its reason and a Try again under the words (one line, inside the section, at 1280 and 390 px; no empty legend or list beside it — never an empty map, never "no coins"), and Try again reads it again, the legend and the list back',
        /could not be read just now/.test(down.t) && down.retry && !down.svg && errOK(down.l) && errOK(down.l390) && down.lay390.sw <= down.lay390.iw && !down.lay390.out.length && backL.key !== 'none' && backL.list !== 'none'
        && (await ev('document.querySelectorAll("#mkt-map .mkt-bub").length')) === 100, JSON.stringify(down));
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await go('/market', 1280); await mapReady(100);
      const rm = await ev('(() => { const s = document.querySelector("#mkt-map svg.mkt-map-svg"); return { cls: s.getAttribute("class"), op: getComputedStyle(s).opacity, tr: getComputedStyle(s).transitionDuration }; })()');
      await cdp('Emulation.setEmulatedMedia', { features: [] });
      check('  ...under reduced motion it appears at once (no fade)', rm.cls === 'mkt-map-svg' && rm.op === '1' && parseFloat(rm.tr) <= 0.001, JSON.stringify(rm));
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
  console.log('market fake serving http://127.0.0.1:' + srv.address().port + '/market  (MARKET_FAKE_DELAY / MARKET_FAKE_FAIL=chains,chain,tokens,token,scan,search,rwa,rwa/token)');
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
    check('  ...the layout\'s parts: the search form, the side column\'s three tabs (a tablist driving one panel: Top chains, Top tokens, RWAs) and the main view',
      /<form class="mkt-search" id="mkt-search" role="search"/.test(H) && /id="mkt-tab-chains" type="button" role="tab" aria-selected="true" aria-controls="mkt-panel"/.test(H) && /id="mkt-tab-tokens" type="button" role="tab" aria-selected="false" aria-controls="mkt-panel"/.test(H)
      && /<button class="sc-tab" id="mkt-tab-rwa" type="button" role="tab" aria-selected="false" aria-controls="mkt-panel" tabindex="-1" data-tab="rwa" data-tip="[^"]{30,}">🏛️ RWAs<\/button>\s*<\/div>/.test(H) && (H.match(/role="tab"/g) || []).length === 3
      && /id="mkt-panel" role="tabpanel" aria-labelledby="mkt-tab-chains"/.test(H) && /<ol class="mkt-list" id="mkt-list"/.test(H) && /<section class="mkt-view" id="mkt-view" tabindex="-1"/.test(H));
    const chainsCtl = H.slice(H.indexOf('id="mkt-ctl-chains"'), H.indexOf('id="mkt-ctl-tokens"')), tokensCtl = H.slice(H.indexOf('id="mkt-ctl-tokens"'), H.indexOf('id="mkt-ctl-rwa"'));
    const rwaCtl = H.slice(H.indexOf('id="mkt-ctl-rwa"'), H.indexOf('id="mkt-cap"'));
    check('  ...the chains rank by TVL, volume, liquidity, market cap or fees, highest or lowest first, over 24h / 7d / 30d or two days of the reader\'s own',
      ['tvl', 'volume', 'liquidity', 'mcap', 'fees'].every((s) => chainsCtl.includes('data-sort="' + s + '"')) && ['desc', 'asc'].every((d) => chainsCtl.includes('data-dir="' + d + '"'))
      && ['24h', '7d', '30d', 'custom'].every((w) => chainsCtl.includes('data-win="' + w + '"')) && /<input type="date" id="mkt-cc-from"/.test(chainsCtl) && /<input type="date" id="mkt-cc-to"/.test(chainsCtl));
    check('  ...the tokens by volume, liquidity, market cap, FDV or change, over 5m / 1h / 6h / 24h or the reader\'s own days, with the wash-volume switch',
      ['volume', 'liquidity', 'mcap', 'fdv', 'change'].every((s) => tokensCtl.includes('data-sort="' + s + '"')) && ['5m', '1h', '6h', '24h', 'custom'].every((w) => tokensCtl.includes('data-win="' + w + '"'))
      && /<input type="date" id="mkt-tc-from"/.test(tokensCtl) && /id="mkt-wash" type="button" aria-pressed="false"/.test(tokensCtl));
    check('  ...the RWAs\' controls (owner, 2026-10-28: "filter them by TVL and Liquidity and Market Cap"), hidden until the tab is chosen: Show (Top RWAs, All RWA tokens, Connected tokens, Stablecoins), Rank by (value on chain, TVL in DeFi, liquidity, market cap, volume, premium/discount — and the pool\'s reserve or volume for connected tokens, what circulates or liquidity for stablecoins), Order, Kind (stocks, ETFs, bonds & T-bills, commodities, credit & funds) and Issuer (All; market.js adds those the answer names) — each a labelled group of chips with aria-pressed and a tick; the not-affiliated and not-advice line above them',
      /<div class="mkt-ctl" id="mkt-ctl-rwa" hidden>/.test(H) && H.indexOf('id="mkt-ctl-rwa"') > H.indexOf('id="mkt-ctl-tokens"') && H.indexOf('id="mkt-ctl-rwa"') < H.indexOf('id="mkt-cap"')
      && ['assets', 'tokens', 'connected', 'stables'].every((x) => rwaCtl.includes('data-rview="' + x + '"')) && ['value', 'tvl', 'liquidity', 'mcap', 'volume', 'premium'].every((x) => new RegExp('id="mkt-rs-g">[\\s\\S]*data-rsort="' + x + '"[\\s\\S]*id="mkt-rsc-g"').test(rwaCtl))
      && />TVL in DeFi<\/button>/.test(rwaCtl) && />Liquidity<\/button>/.test(rwaCtl) && />Market cap<\/button>/.test(rwaCtl) && /id="mkt-rsc-g" hidden>[\s\S]*data-rsort="liquidity"[\s\S]*>Pool reserve<\/button>[\s\S]*data-rsort="volume"[\s\S]*id="mkt-rss-g" hidden>[\s\S]*>Circulating<\/button>/.test(rwaCtl)
      && ['desc', 'asc'].every((x) => rwaCtl.includes('data-rdir="' + x + '"')) && ['all', 'stock', 'etf', 'bond', 'commodity', 'credit'].every((x) => rwaCtl.includes('data-rkind="' + x + '"')) && /<div class="mkt-chips" id="mkt-ri-c">\s*<button class="np-chip" type="button" aria-pressed="true" data-rissuer="all"/.test(rwaCtl)
      && [...rwaCtl.matchAll(/<div class="mkt-group" role="group" aria-labelledby="([^"]+)"/g)].length === 7 && [...rwaCtl.matchAll(/<div class="mkt-group" role="group" aria-labelledby="([^"]+)"/g)].every((m) => rwaCtl.includes('<p class="mkt-group-l" id="' + m[1] + '">'))
      && [...rwaCtl.matchAll(/<button class="np-chip"[^>]*>/g)].every((m) => /aria-pressed="(true|false)"/.test(m[0])) && (rwaCtl.match(/<span class="mkt-tick" aria-hidden="true">✓&nbsp;<\/span>/g) || []).length === (rwaCtl.match(/<button class="np-chip"/g) || []).length
      && /<p class="mkt-note mkt-rwa-lede">[^<]*Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\. Not advice, never a tip to buy\.<\/p>/.test(rwaCtl) && /<div class="mkt-foot" id="mkt-foot"><\/div>/.test(H));
    const bareBtn = [...(H + JS).matchAll(/<button\b([^>]*)>/g)].filter((m) => !/data-tip="[^"]{8,}"/.test(m[1]));
    check('every button on the page and every button market.js draws carries a description (data-tip) of what it does', !bareBtn.length, bareBtn.map((m) => m[0].slice(0, 60)).join(' | '));

    /* ═══ what market.js may do ═══ */
    const code = JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const fetches = [...code.matchAll(/fetch\(\s*([^,)]+)/g)].map((m) => m[1].trim());
    const asks = [...code.matchAll(/getJSON\(\s*([^)]+?)\)/g)].map((m) => m[1].trim());
    check('market.js is one IIFE in strict mode, wired with addEventListener only (no on… properties, no inline handlers)',
      /^\(function \(\) \{\n  'use strict';/m.test(code) && /\}\)\(\);\s*$/.test(JS) && !/\.on[a-z]+\s*=(?!=)/.test(code) && !/\son[a-z]+="/.test(code) && (code.match(/addEventListener\(/g) || []).length >= 15);
    check('  ...it reads only this site\'s own /api/market/* routes: one fetch, behind getJSON, and every caller names a /api/market/ path (the CSP\'s connect-src stays as it is)',
      fetches.length === 1 && fetches[0] === 'url' && asks.length >= 8 && asks.every((a) => a === 'url' || /^'\/api\/market\/|^(chainsURL|tokensURL|chainViewURL|tokenViewURL|rwaURL)\(|^v\.token \? tokenViewURL/.test(a))
      && /return '\/api\/market\/rwa' \+ \(q \? '\?' \+ q : ''\);/.test(code) && /getJSON\(rwaURL\(\)\)/.test(code) && /getJSON\('\/api\/market\/rwa\/token\?address=' \+ encodeURIComponent\(addr\)\)/.test(code)
      && /return '\/api\/market\/chains' \+/.test(code) && /return '\/api\/market\/tokens\?' \+/.test(code) && /return '\/api\/market\/chain\?' \+/.test(code) && /return '\/api\/market\/token\?' \+/.test(code)
      && !/https?:\/\/(?!www\.growthepie\.com|l2beat\.com\/scaling|www\.w3\.org\/2000\/svg|www\.coingecko\.com\/en\/coins\/' \+ encodeURIComponent\(cgId\))/.test(code.replace(/'https:\/\/'/g, '')) && !/\/api\/scan\?/.test(code), asks.join(' | '));
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
    check('  ...no two-tab assumption is left: the tabs are every tab the tablist holds, each tab\'s controls are shown by its own key, the list is read and painted by an explicit branch per tab (none falls into Top tokens\'), and "All tokens, sorted your way" names Top tokens by its id',
      /const tabs = \[\.\.\.document\.querySelectorAll\('#mkt-side \[role="tab"\]'\)\];/.test(code) && /const ctl = \{ chains: \$\('mkt-ctl-chains'\), tokens: \$\('mkt-ctl-tokens'\), rwa: \$\('mkt-ctl-rwa'\) \};/.test(code)
      && /for \(const k of Object\.keys\(ctl\)\) if \(ctl\[k\]\) ctl\[k\]\.hidden = tab !== k;/.test(code) && /\} else if \(kind === 'tokens'\) \{/.test(code) && /\} else if \(kind === 'rwa'\) \{/.test(code) && !/tabs\[1\]/.test(code)
      && /if \(S\.tab === 'chains'\) paintChains\(\); else if \(S\.tab === 'tokens'\) paintTokens\(\); else if \(S\.tab === 'rwa'\) paintRwa\(\);/.test(code) && /\$\('mkt-tab-tokens'\)\.focus\(\)/.test(code));
    check('  ...the RWA tab is in the address bar: tab=rwa, with rview, rsort, rdir, rkind and rissuer only when they are not the defaults; going to it or leaving it, and every choice on it, is pushed; Back and Forward restore it (an address without tab=rwa leaves the tab) and a link opens it; the first view\'s two reads are unchanged',
      /S\.urlTab = q\.get\('tab'\) === 'rwa' \? 'rwa' : null;/.test(code) && /if \(S\.tab === 'rwa'\) \{\s*p\.set\('tab', 'rwa'\);/.test(code) && /\[\['view', 'rview'\], \['sort', 'rsort'\], \['dir', 'rdir'\], \['kind', 'rkind'\], \['issuer', 'rissuer'\]\]\) if \(S\.rwa\[k\] !== RWA_DEF\[k\]\) p\.set\(n, S\.rwa\[k\]\);/.test(code)
      && /if \(was === 'rwa' \|\| tab === 'rwa'\) writeURL\(true\);/.test(code) && /r\[pickd\[0\]\] = pickd\[1\]; S\.shown = pageSize\(\);\s*writeURL\(true\); syncControls\(\); loadList\(\);/.test(code)
      && /if \(S\.urlTab === 'rwa'\) \{ if \(S\.tab !== 'rwa'\) setTab\('rwa', false\);/.test(code) && /if \(S\.tab === 'rwa'\) \{ setTab\(S\.view\.token \|\| S\.tokens\.tchain \? 'tokens' : 'chains', false\); return; \}/.test(code) && /if \(S\.urlTab === 'rwa'\) setTab\('rwa', false\);\s*else if \(S\.view\.token \|\| S\.tokens\.tchain\) \{/.test(code));
    check('  ...an RWA\'s facts on its token view: when the token answer\'s rwa key is set, a host right after the stats (#mkt-tstats) read from /api/market/rwa/token, in the order a holder needs them — 1 is this the real one, 2 what you hold, 3 the price check, 4 corporate actions, 5 size, 6 the powers its issuer keeps, 7 the tokens paired with it, then the not-affiliated and not-advice foot — each a section card with its own heading id; holders link to the Scanner\'s explorer (NPCard.CHAIN_META), never one typed here',
      /const rwa = chain === 'robinhood' && d\.rwa && typeof d\.rwa === 'object' \? d\.rwa : null;/.test(code) && /'<div class="mkt-tstats" id="mkt-tstats">' \+ stats \+ '<\/div>' \+\s*\(rwa \? rwaHostHTML\(d\.address \|\| S\.view\.token, rwa\) : ''\) \+\s*windowsHTML\(d\)/.test(code)
      && /const rwaCardHTML = \(j\) => rwaLeadHTML\(j\) \+ rwaRealHTML\(j\) \+ rwaHoldHTML\(j\) \+ rwaPriceHTML\(j\) \+ rwaActionsHTML\(j\) \+ rwaSizeHTML\(j\) \+ rwaControlsHTML\(j\) \+ rwaConnHTML\(j\) \+ rwaCardFootHTML\(j\);/.test(code)
      && [1, 2, 3, 4, 5, 6, 7].every((i) => (code.match(new RegExp("rwa(?:Sec|Fold)\\('mkt-rw" + i + "-h'", 'g')) || []).length >= 1) && /const rwaSec = \(id, title, sub, body\) => '<section class="mkt-card mkt-rwa-c" aria-labelledby="' \+ id \+ '"><div class="mkt-card-h"><h3 class="mkt-h3" id="' \+ id \+ '">'/.test(code)
      && /const rwaFold = \(id, title, sub, open, sumLine, body\) => rwaSec\(id, title, sub, open \+ \(body \? '<details class="mkt-tbl mkt-rwa-fold"><summary>' \+ sumLine \+ '<\/summary>/.test(code) && (code.match(/rwaFold\('mkt-rw1-h'/g) || []).length === 0
      && /const c = window\.NPCard && NPCard\.CHAIN_META && NPCard\.CHAIN_META\.robinhood/.test(code) && /if \(rh\) loadRwa\(rh\);/.test(code) && !/mkt-rw[1-7]-h/.test(H));
    check('  ...the RWA words are honest: how sure the site is that a token is the real one is said in words on every row ("✓ Registry + on-chain", "Registry only", "Not confirmed"); a token paired with an RWA is labelled "Not an RWA"; the issuer\'s powers are powers a regulated issuer keeps, not a verdict; dividends raise the multiplier; the not-affiliated and not-advice lines stand even when the list could not be read',
      /'✓ Registry \+ on-chain'/.test(code) && /chip: 'Registry only'/.test(code) && /chip: 'Not confirmed'/.test(code) && /esc\(c\.label \|\| 'Not an RWA'\)/.test(code) && /they are still powers over your tokens/.test(code)
      && /— a holder granted later is not shown yet/.test(code) && /walk\.complete === false/.test(code) && /j\.connectedWhy \? '<p class="mkt-err-t">⏳ '/.test(code) && !/marks these powers in red/.test(code)
      && /Dividends are paid by raising the multiplier, so the token’s price sits above the share’s/.test(code) && /const RWA_NOT_AFFILIATED = 'Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\. No Robinhood logos or artwork are used\.';/.test(code)
      && /const RWA_NOT_ADVICE = 'Not advice, never a tip to buy\. Do your own research\.';/.test(code) && /if \(!last\.some\(\(x\) => \/\^Not affiliated\/\.test\(x\)\)\) last\.push\(RWA_NOT_AFFILIATED\);/.test(code) && !/cdn\.robinhood\.com|logoUrl/.test(code));
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
    const MAP_PREF = "const mapPref = { get: () => { try { return localStorage.getItem(MAP_KEY); } catch { return null; } }, set: (v) => { try { localStorage.setItem(MAP_KEY, v); } catch {} } };";
    check('  ...no storage: the address bar is the state (?chain=&token=&window=&from=&to=), pushed when the view changes, read back on Back / Forward — the one thing kept in the browser is whether the bubble map is folded away (one key, every read and write behind try/catch)',
      code.split(MAP_PREF).length === 2 && /const MAP_KEY = 'jsi:market-map';/.test(code) && !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code.replace(MAP_PREF, '')) && /p\.set\('chain', v\.chain\);\s*if \(v\.token\) p\.set\('token', v\.token\);/.test(code) && /history\[push \? 'pushState' : 'replaceState'\]/.test(code)
      && /window\.addEventListener\('popstate', \(\) => \{ closePick\(true\); readURL\(\);/.test(code) && /q\.get\('from'\)/.test(code) && /q\.get\('to'\)/.test(code));
    check('  ...a token on Robinhood Chain, Ethereum or Solana gets the Scanner\'s own dashboard (NPCard.dashboardHTML + mountDashboard) from /api/market/scan, only once the reader scrolls to it',
      /const SCANS = \['robinhood', 'ethereum', 'solana'\];/.test(code) && /'\/api\/market\/scan\?chain=' \+ encodeURIComponent\(chain\) \+ '&address=' \+ encodeURIComponent\(addr\)/.test(code)
      && /NPCard\.dashboardHTML\(p, \{ kicker: '🛡️ Scanner', meta, level: 3, hideRwa: !!\$\('mkt-rwa-host'\) \}\)/.test(code) && /NPCard\.mountDashboard\(host\)/.test(code) && /new IntersectionObserver\(/.test(code));
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
    check('  ...the page\'s own list of its sources names every one it shows, CoinLore among them (the market caps\' second source)',
      /Market figures come from DefiLlama, L2BEAT, growthepie \(CC BY 4\.0\), CoinGecko, CoinLore, GeckoTerminal, Dexscreener, Robinhood’s Stock Token API, Chainlink’s feed directory and Robinhood Chain’s public node, read by this site’s server/.test(H));
    check('  ...a "lowest first" list says it is lowest among what the source lists, not lowest on the chain; DeFi TVL and TVS are separate figures; the v4 PoolManager and the bridge say what they are and are not',
      /so “lowest” is lowest among those, not lowest on the chain\./.test(code) && /stat\('DeFi TVL', st\.tvl, usd\) \+ stat\('Total value secured', st\.tvs, usd/.test(code)
      && /includes claims and fees — assets held, not pool TVL/.test(code) && /held by the bridge contract on Ethereum — not a net inflow/.test(code) && /pools, not tokens/.test(code));
    check('  ...nothing tells anyone to buy, promises safety, or claims an affiliation', !/\b(you should buy|buy now|great investment|guaranteed|risk-free|safe investment|to the moon)\b/i.test(H + JS) && /never a tip to buy/.test(H) && /not a recommendation/.test(JS)
      && !/\b(safe|safest|secure investment|backed by Robinhood|endorsed by Robinhood|Robinhood-approved)\b/i.test(H.replace(/<[^>]+>/g, ' ') + code));
    check('a chain\'s market cap shows its cross-check (2026-10-28): a chip beside the figure in the list (ranked by market cap) and in the chain view — "✓ 2 sources agree", "⚠ Sources differ" or "1 source", in words, never by colour alone — the caption says what the figure is, and the chain view lists each source\'s figure, price and supply with how recent it is ("As of"), the notes and the token check',
      /agreed: \['✓ 2 sources agree', 'is-ok', '[^']{20,}'\]/.test(code) && /differs: \['⚠ Sources differ', 'is-warn', '[^']{20,}'\]/.test(code) && /single: \['1 source', 'is-one', '[^']{20,}'\]/.test(code)
      && /const MCAP_CAP = 'Market cap of the chain’s own token: CoinGecko’s figure, checked against CoinLore';/.test(code) && /\(sortF === 'mcap' \? '<span class="mkt-cap-n">' \+ esc\(MCAP_CAP\) \+ '\.<\/span>' : ''\)/.test(code)
      && /\(sortF === 'mcap' \? mcapChip\(f\) : ''\)/.test(code) && /stat\('Native token market cap', st\.mcap, usd, mcapChip\(st\.mcap\)\)/.test(code) && /mcapHTML\(d\) \+ chartsHTML\(d\)/.test(code)
      && /<section class="mkt-card mkt-mcap" aria-labelledby="mkt-mc-h">/.test(code) && /<th scope="col">Source<\/th><th scope="col">Market cap<\/th><th scope="col">Price<\/th><th scope="col">Circulating supply<\/th><th scope="col">As of<\/th>/.test(code)
      && /data-l="As of"/.test(code) && /“As of” is when each source’s figure is from: CoinGecko’s own update time, DefiLlama’s on its relay, CoinLore’s when this site read it\./.test(code) && !/data-l="Read"/.test(code)
      && /gas: 'Checked for its gas token only'/.test(code) && /m\.status === 'confirmed' && m\.by === 'gas' \? MAP_WORD\.gas/.test(code)
      && /data-l="Circulating supply"/.test(code) && /never an average of the two/.test(code) && /coinlore: 'CoinLore'/.test(code) && /\.mkt-chk \{[^}]*font-size: max\(var\(--text-floor\), 0\.72rem\)/.test(CSS) && /\.mkt-chk\.is-warn \{/.test(CSS));
    check('the charts are drawn by market.js in SVG (no library): at the box\'s own pixel size, an axis, a hover and arrow-key readout, a table of every value',
      /createElementNS\(NS, tag\)/.test(code) && /const W = Math\.max\(200, Math\.floor\(box\.clientWidth \|\| 300\)\);/.test(code) && /viewBox: '0 0 ' \+ W \+ ' ' \+ H/.test(code) && /class: 'mkt-ax'/.test(code)
      && /box\.addEventListener\('pointermove'/.test(code) && /e\.key === 'ArrowLeft'/.test(code) && /Every value as a table/.test(code) && !/<script[^>]+src="(https?:|\/\/)|d3(\.min)?\.js|plotly|echarts|chart\.umd|chartjs/i.test(H));
    // the stylesheet
    check('market.css: the dashboard width (--dash-max), every size on the text floor, no ellipsis, no fixed-minimum grid column, reduced motion honoured, tables folding by a container query',
      /\.mkt-wrap \{ max-width: var\(--dash-max\);/.test(CSS) && /header\.np-hero\.mkt-hero \{\s*max-width: var\(--dash-max\);/.test(CSS)
      && [...CSS.matchAll(/font-size\s*:\s*([^;}]+)/g)].every((m) => m[1].trim().startsWith('max(var(--text-floor)')) && !/text-overflow:\s*ellipsis|line-clamp/.test(CSS)
      && !/minmax\((1[6-9]\d|[2-9]\d\d)px, *1fr\)/.test(CSS) && /@media \(prefers-reduced-motion: reduce\)/.test(CSS) && /container: mktv \/ inline-size;/.test(CSS) && /@container mktv \(max-width: 46em\)/.test(CSS)
      && !/position: relative; isolation: isolate;/.test(CSS));
    check('  ...the RWA tab\'s styles: a hidden control group is gone (display: none), a copy button beside an address is 44px, the confidence and "Not an RWA" chips are words in a border (the colour only repeats them)',
      /\.mkt-group\[hidden\] \{ display: none; \}/.test(CSS) && /\.mkt-copy \{ min-width: 44px; min-height: 44px;/.test(CSS) && /\.mkt-conf, \.mkt-notrwa \{ font-size: max\(var\(--text-floor\), 0\.72rem\);/.test(CSS) && /\.mkt-conf\.is-no \{[^}]*border-style: dashed;/.test(CSS));
    check('  ...every control at least 44px tall, a visible focus ring on the rows and the charts, and the current row marked by a bar as well as colour',
      /\.mkt-chips \.np-chip, \.mkt-wash \{ min-height: 44px;/.test(CSS) && /\.mkt-cpick-b \{[^}]*min-height: 44px;/.test(CSS) && /\.mkt-copt \{ min-height: 44px;/.test(CSS) && /\.mkt-row \{[^}]*min-height: 52px;/.test(CSS) && /\.mkt-row:focus-visible \{ outline: 3px solid var\(--focus\);/.test(CSS)
      && /\.mkt-plot:focus-visible \{ outline: 3px solid var\(--focus\);/.test(CSS) && /\.mkt-row\[aria-current="true"\] \{[^}]*box-shadow: inset 5px 0 0 var\(--green\);/.test(CSS));

    /* ═══ the bubble map of the whole crypto market (owner, 2026-10-30) ═══ */
    const MAPH = H.slice(H.indexOf('<section class="mkt-map"'), H.indexOf('<div class="mkt-layout">'));
    check('the bubble map (owner, 2026-10-30: "a view like this that shows a 24 quick visual on the top tokens across the whole market"): a full-width section between the search and the two columns, its own heading, a button that folds it away (aria-expanded, aria-controls, a description), the Top 50 / Top 100 chips and "Hide stablecoins" (aria-pressed, a tick), a live caption, the legend\'s list, the map\'s box, a card under it and "Show as a list"',
      H.indexOf('</form>') < H.indexOf('<section class="mkt-map" id="mkt-map" aria-labelledby="mkt-map-h">') && H.indexOf('id="mkt-map"') < H.indexOf('<div class="mkt-layout">') && /<h2 class="mkt-map-h" id="mkt-map-h">🫧 [^<]{10,}<\/h2>/.test(MAPH)
      && /<button class="btn btn-sm btn-ghost mkt-map-tog" id="mkt-map-tog" type="button" aria-expanded="true" aria-controls="mkt-map-body" data-tip="[^"]{30,}">Hide the map<\/button>/.test(MAPH) && /<div class="mkt-map-body" id="mkt-map-body">/.test(MAPH)
      && /aria-pressed="false" data-map-top="50" data-tip="[^"]{20,}"><span class="mkt-tick" aria-hidden="true">✓&nbsp;<\/span>Top 50<\/button>/.test(MAPH) && /aria-pressed="true" data-map-top="100" data-tip="[^"]{20,}"><span class="mkt-tick" aria-hidden="true">✓&nbsp;<\/span>Top 100<\/button>/.test(MAPH)
      && /<button class="np-chip" id="mkt-map-stables" type="button" aria-pressed="false" data-tip="[^"]{30,}"><span class="mkt-tick" aria-hidden="true">✓&nbsp;<\/span>Hide stablecoins<\/button>/.test(MAPH)
      && [...MAPH.matchAll(/<div class="mkt-group" role="group" aria-labelledby="([^"]+)"/g)].length === 2 && [...MAPH.matchAll(/<div class="mkt-group" role="group" aria-labelledby="([^"]+)"/g)].every((m) => MAPH.includes('<p class="mkt-group-l" id="' + m[1] + '">'))
      && /<p class="mkt-map-cap" id="mkt-map-cap" aria-live="polite"><\/p>/.test(MAPH) && /<ul class="mkt-map-legend" id="mkt-map-legend" aria-labelledby="mkt-map-key-l"><\/ul>/.test(MAPH) && /<div class="mkt-map-fig" id="mkt-map-fig">/.test(MAPH)
      && /<div class="mkt-map-card" id="mkt-map-card" hidden><\/div>/.test(MAPH) && /<details class="mkt-tbl mkt-map-list" id="mkt-map-list"><summary>Show as a list<\/summary>/.test(MAPH));
    const legendJS = (code.match(/const MAP_LEGEND = (\[[^\n]+\]);/) || [])[1];
    let legendOK = false; try { legendOK = JSON.stringify(vm.runInNewContext(legendJS)) === JSON.stringify(MM.BUCKETS.map((b) => [b.key, b.label])); } catch {}
    const bucketJS = (code.match(/function mapBucket\(v\) \{[\s\S]*?\n  \}/) || [])[0];
    let bucketOK = false; try { const f = vm.runInNewContext('(' + bucketJS + ')'); bucketOK = [null, NaN, 0, 0.0001, 2, 2.01, 5, 5.01, 10, 10.01, 99, -0.0001, -2, -2.01, -5, -5.01, -10, -10.01, -60].every((x) => f(x) === MM.bucketOf(x)); } catch {}
    check('  ...market.js reads it from /api/market/heatmap alone (getJSON, one answer: Top 50 and the stablecoins are cut from it here), and its legend and steps are lib/marketmap.js\'s — the same nine steps and "no 24 h change given", the same edges (exactly 10% is ">5%", exactly 0 is "0%", no change is never 0%)',
      /const j = await getJSON\('\/api\/market\/heatmap'\);/.test(code) && (code.match(/\/api\/market\/heatmap/g) || []).length === 4 && legendOK && bucketOK, JSON.stringify({ legendOK, bucketOK }));
    check('  ...one SVG, sized, packed and drawn here — no library, no CDN: the ring (front-chain packing and the smallest enclosing circle, the @lift:pack block) or the column (the @lift:column block), at the box\'s own pixel width with no cap, one role="img" with a summary in words (not 100 tab stops), each bubble a <title>; a bigger market cap a bigger bubble on a compressed scale (its radius the fourth root, so its area the square root) and never under its ticker\'s minimum at the floor, its colour the step\'s class',
      /\/\* @lift:pack /.test(JS) && /\/\* @lift:pack-end \*\//.test(JS) && /function packCircles\(cs\)/.test(code) && /function packEnclose\(cs\)/.test(code)
      && /\/\* @lift:column /.test(JS) && /\/\* @lift:column-end \*\//.test(JS) && /function packColumn\(cs, W\)/.test(code) && /function mapLayout\(items, W, gap\)/.test(code)
      && /const svg = el\('svg', \{ width: L\.w, height: L\.h, viewBox: '0 0 ' \+ L\.w \+ ' ' \+ L\.h, class: 'mkt-map-svg', 'data-layout': L\.ring \? 'ring' : 'column', role: 'img', 'aria-label': mapSummary\(rows, c\) \}\);/.test(code)
      && /const mapSize = \(\) => Math\.max\(160, Math\.floor\(mapEl\.fig\.clientWidth \|\| 0\)\);/.test(code) && !/innerHeight \* 0\.8|760\)/.test(code.slice(code.indexOf('const mapSize'), code.indexOf('function mapSummary(')))
      && /const L = mapLayout\(shown\.map\(\(r\) => \(\{ need: mapNeed\(r, floor\), f: Math\.pow\(val\(r\.mcap\) \/ top, 0\.25\) \}\)\), W, gap\);/.test(code)
      && /const make = \(k\) => items\.map\(\(it, i\) => \(\{ r: Math\.max\(Math\.min\(it\.need, wide\), k \* it\.f\) \+ pad, i \}\)\)/.test(code)
      && /class: 'mkt-bub mkt-b-' \+ b/.test(code) && /const ti = el\('title', \{\}, g\); ti\.textContent = tipWords\(row\);/.test(code)
      && !/tabindex|'tabIndex'/.test(code.slice(code.indexOf('function drawMap('), code.indexOf('function tipWords('))) && !/<script[^>]+src="https?:/.test(H) && !/\bd3\./.test(code));
    check('  ...every bubble its ticker, at or above the text floor (measured in px, written as max(var(--text-floor), …)): a bubble\'s minimum is the radius at which its symbol alone fits by fitLabel\'s own rule, measured in its font and weight, and fitLabel tries the floor itself before it gives up; then the price and the change, "Dominance: …" on the three largest, where they fit; its ink the better contrast of --text and --ink-1 on the fill as drawn',
      /function fitLabel\(r, lines, floor\)/.test(code) && /let s = Math\.max\(r \* 0\.36, floor\);/.test(code) && /if \(s <= floor\) return null;\n\s*s = Math\.max\(floor, s \* room \* 0\.99\);/.test(code)
      && /function mapNeed\(row, floor\) \{\n\s*const w = textW\(symOf\(row\), floor, 800\), e = floor \* 0\.52;\n\s*return Math\.max\(Math\.sqrt\(\(w \/ 1\.72\) \* \(w \/ 1\.72\) \+ e \* e\), \(floor \* 1\.04\) \/ 1\.62\) \+ 1;/.test(code) && /const sym = \{ t: symOf\(row\), w: 800 \}/.test(code) && /style: 'font-size: max\(var\(--text-floor\), ' \+ l\.z\.toFixed\(2\) \+ 'px\); font-weight: ' \+ l\.w \+ '; fill: ' \+ ink\[b\] \}/.test(code)
      && /'Dominance: ' \+ dm/.test(code) && /const bigIds = new Set\(shown\.slice\(0, 3\)\.map\(\(r\) => r\.id\)\);/.test(code) && /out\[k\] = !fill \|\| contrast\(fill, light\) >= contrast\(fill, dark\) \? 'var\(--text\)' : 'var\(--ink-1\)';/.test(code));
    check('  ...the tooltip (symbol, name, price, market cap, dominance, 24 h change, 24 h volume, source and age, the CoinLore check chip) on the pointer; a press, or a list row\'s button, opens a card under the map with the same and "View on CoinGecko ↗" (a plain link out, rel="noopener"), its heading focused; Escape or ✕ Close shuts it',
      /function tipHTML\(r\)/.test(code) && /row\('Price', r\.price, mapPrice\) \+ row\('Market cap', r\.mcap, usd\) \+ row\('Dominance', r\.dominance, domText\) \+ row\('24 h change', r\.change24h, \(x\) => pct\(x\)\) \+ row\('24 h volume', r\.volume24h, usd\)/.test(code) && /srcLine\(fig\(r\.mcap\)\) \+ '<\/span> ' \+ mapChk\(r\)/.test(code)
      && /href="https:\/\/www\.coingecko\.com\/en\/coins\/' \+ encodeURIComponent\(cgId\) \+ '" target="_blank" rel="noopener">View on CoinGecko ↗<\/a>/.test(code) && /cgId = \/\^\[a-z0-9-\]\{1,80\}\$\/\.test/.test(code)
      && /data-map-coin="' \+ esc\(r\.id\) \+ '" data-tip="Opens /.test(code) && /if \(e\.key === 'Escape' && MAP\.pick\)/.test(code) && /h\.focus\(\{ preventScroll: true \}\)/.test(code));
    check('  ...folded away and back by its button, remembered in this browser (and not read until it is opened); read again every 10 minutes while the page is in view; redrawn when its box changes size (after the change settles) and once the site\'s font has loaded; a short fade on its first drawing only, none under reduced motion or the nav\'s ⏸',
      /if \(mapEl\.sec\) setMapOpen\(mapPref\.get\(\) !== 'hidden', false\);/.test(code) && /if \(remember\) mapPref\.set\(on \? 'shown' : 'hidden'\);/.test(code) && /mapEl\.tog\.setAttribute\('aria-expanded', String\(on\)\);/.test(code)
      && /const MAP_EVERY = 10 \* 60e3;/.test(code) && /document\.visibilityState === 'visible' && MAP\.shown/.test(code) && /new ResizeObserver\(reMap\)\.observe\(mapEl\.fig\)/.test(code) && /document\.fonts\.ready\.then/.test(code)
      && /const first = !old && fresh && !reduced\(\);/.test(code) && /@media \(prefers-reduced-motion: reduce\) \{ \.mkt-map-svg\.is-in \{ transition: none; \} \}/.test(CSS) && /html\.motion-off \.mkt-map-svg\.is-in \{ transition: none; \}/.test(CSS));
    const hmTokens = (CSS.match(/\.mkt-map \{\n([\s\S]*?)\n\s*margin:/) || [])[1] || '';
    check('  ...its colours are the site\'s own tokens and mixes of them — BRIGHTER for a bigger move on both sides (owner, 2026-10-30: "make the biggest movers be brighter green"): a dim mix of --green-dark or --red with the ink for a small move, --green / --red for >5%, --green-bright and --red lightened with --red-soft for the biggest; the @supports fallback has the mixes\' hexes — one rule per step for the bubbles and the legend\'s swatches; the step with no change is hatched and dashed; forced colours keep the map\'s colours with system outlines; the list folds into cards in a narrow box; its buttons are 44 px with a focus ring',
      ['up10', 'up5', 'up2', 'up0', 'flat', 'dn0', 'dn2', 'dn5', 'dn10', 'none'].every((k) => new RegExp('--hm-' + k + ': (var\\(--[a-z0-9-]+\\)|color-mix\\(in srgb, var\\(--[a-z-]+\\) \\d+%, var\\(--[a-z0-9-]+\\)\\));').test(hmTokens)
        && new RegExp('\\.mkt-bub\\.mkt-b-' + k + ' > circle \\{ fill: ' + (k === 'none' ? 'url\\(#mkt-hatch\\)' : 'var\\(--hm-' + k + '\\)')).test(CSS) && new RegExp('\\.mkt-map-sw\\.mkt-b-' + k + ' \\{ background: ').test(CSS))
      && /--hm-up10: var\(--green-bright\);/.test(hmTokens) && /--hm-up5: var\(--green\);/.test(hmTokens) && /--hm-up2: var\(--green-dark\);/.test(hmTokens) && /--hm-up0: color-mix\(in srgb, var\(--green-dark\) \d+%, var\(--ink\)\);/.test(hmTokens)
      && /--hm-dn0: color-mix\(in srgb, var\(--red\) \d+%, var\(--ink\)\);/.test(hmTokens) && /--hm-dn2: color-mix\(in srgb, var\(--red\) \d+%, var\(--ink\)\);/.test(hmTokens) && /--hm-dn5: var\(--red\);/.test(hmTokens) && /--hm-dn10: color-mix\(in srgb, var\(--red\) \d+%, var\(--red-soft\)\);/.test(hmTokens)
      && /@supports not \(color: color-mix\(in srgb, red 50%, transparent\)\) \{\n\s*\.mkt-map \{ --hm-up0: #[0-9a-f]{6}; --hm-dn0: #[0-9a-f]{6}; --hm-dn2: #[0-9a-f]{6}; --hm-dn10: #[0-9a-f]{6};/.test(CSS) && !/deeper for a bigger move/.test(CSS)
      && !/#[0-9a-f]{3,6}\b/i.test(hmTokens) && /\.mkt-bub\.mkt-b-none > circle \{[^}]*stroke-dasharray/.test(CSS) && /@media \(forced-colors: active\) \{\s*\.mkt-map-svg, \.mkt-map-sw \{ forced-color-adjust: none; \}/.test(CSS)
      && /@container mktm \(max-width: 900px\)/.test(CSS) && /\.mkt-map-pick \{[^}]*min-height: 44px;/.test(CSS) && /\.mkt-map-pick:focus-visible \{ outline: 3px solid var\(--focus\);/.test(CSS) && /container: mktm \/ inline-size;/.test(CSS));

    // the @supports fallback's hexes are the mixes themselves, worked out from styles.css's tokens (within one step of 255)
    const STY = read('styles.css'), tok = (k) => { const m = new RegExp('--' + k + ':\\s*#([0-9a-f]{6})', 'i').exec(STY); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
    const hmFb = (CSS.match(/@supports not \(color: color-mix\(in srgb, red 50%, transparent\)\) \{\n\s*\.mkt-map \{([^}]*)\}/) || [])[1] || '';
    const mixOK = ['up0', 'dn0', 'dn2', 'dn10'].map((k) => {
      const m = new RegExp('--hm-' + k + ': color-mix\\(in srgb, var\\(--([a-z-]+)\\) (\\d+)%, var\\(--([a-z0-9-]+)\\)\\);').exec(hmTokens), h = new RegExp('--hm-' + k + ': #([0-9a-f]{6});').exec(hmFb);
      if (!m || !h || !tok(m[1]) || !tok(m[3])) return [k, false];
      const want = tok(m[1]).map((v, i) => v * (m[2] / 100) + tok(m[3])[i] * (1 - m[2] / 100)), got = [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16));
      return [k, want.every((v, i) => Math.abs(v - got[i]) <= 1), '#' + h[1]];
    });
    check('  ...and the fallback for a browser without color-mix() draws the same steps: its hexes are the mixes of styles.css\'s tokens', mixOK.every((x) => x[1]), JSON.stringify(mixOK));

    /* ═══ the site's lists that name pages ═══ */
    const SM = read('sitemap-pages.xml'), LL = read('llms.txt'), RB = read('robots.txt');
    check('/market is in the static sitemap, in llms.txt\'s pages, and Sendy knows it (its tips, and its links in an answer)',
      SM.includes('<url><loc>https://sendrh.com/market</loc></url>') && /\n- \[Market Data\]\(https:\/\/sendrh\.com\/market\): /.test(LL)
      && /'\/market': \{ tips: \[/.test(SENDY) && /\|data\|market\|newpairs\|/.test(SENDY));
    check('  ...robots.txt opens exactly the fixed first-view reads (the bubble map\'s among them, at its default address) and keeps every caller-chosen market read (search, a token, a scan, the logo proxy, another chain, the map cut another way) shut',
      /^Allow: \/api\/market\/heatmap\$$/m.test(RB) && /^Allow: \/api\/market\/chains\$$/m.test(RB) && /^Allow: \/api\/market\/chain\?key=robinhood\$$/m.test(RB) && /^Allow: \/api\/market\/tokens\?chain=robinhood\$$/m.test(RB) && /^Disallow: \/api\/$/m.test(RB) && !/^Allow: \/api\/market\/?$/m.test(RB));

    /* ═══ 2. the fixtures against the contract ═══ */
    const SRCS = ['defillama', 'l2beat', 'growthepie', 'coingecko', 'geckoterminal', 'dexscreener', 'rpc', 'site', 'robinhood', 'chainlink', 'coinlore'];   // the last two: the RWA tab's (lib's SOURCES, market.js's SRC)
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
      rh24 && rh24.mcap.v === null && rh24.mcap.why === 'No native token — gas is paid in ETH' && FIX('chains-24h.json').rows.find((r) => r.key === 'ethereum').mcap.label === 'ETH (gas token), market cap' && rh24.chainId === 4663 && rh24.stage === 'Stage 0' && rh24.isL2 === true);
    // the market cap's cross-check (2026-10-28), on every chain row of every window and in each chain's detail
    const CHK_ST = ['agreed', 'differs', 'single', 'none'], badChk = [];
    const isChk = (f, where) => {
      const c = f && f.check;
      const ok = c && CHK_ST.includes(c.status) && Array.isArray(c.sources) && Array.isArray(c.notes) && c.notes.every((n) => typeof n === 'string' && n.length > 8) && c.mapping && ['confirmed', 'differs', 'unchecked'].includes(c.mapping.status)
        && c.sources.every((x) => ['coingecko', 'coinlore', 'defillama'].includes(x.src) && x.v > 0 && x.at > 1.7e12 && 'price' in x && 'supply' in x)
        && (c.status === 'agreed' || c.status === 'differs' ? c.sources.length === 2 && c.sources.filter((x) => x.src !== 'defillama').length === 2 : c.status === 'single' ? c.sources.length === 1 : c.sources.length === 0)
        && (c.status === 'differs' ? /^CoinGecko .* apart\): /.test(c.notes[0]) : true) && (f.v == null ? c.status === 'none' || f.why : f.v === c.sources[0].v);
      if (!ok) badChk.push(where + '=' + JSON.stringify(c).slice(0, 120));
    };
    for (const w of ['24h', '7d', '30d', 'custom']) for (const r of FIX('chains-' + w + '.json').rows) isChk(r.mcap, 'chains-' + w + ':' + r.key);
    for (const k of ['robinhood', 'base']) isChk(FIX('chain-' + k + '.json').stats.mcap, 'chain-' + k);
    const c24 = FIX('chains-24h.json').rows, mc = (k) => (c24.find((r) => r.key === k) || {}).mcap || {};
    check('  ...every chain\'s market cap carries its check — { status (agreed, differs, single, none), sources [{ src, v, price, supply, at }], notes, mapping, coin } — the figure shown the first source\'s (CoinGecko\'s when it has one), never an average, never a relay counted as a second source',
      !badChk.length && mc('ethereum').check.status === 'agreed' && mc('arbitrum').check.status === 'differs' && /both price \$ARB the same/.test(mc('arbitrum').check.notes[0]) && mc('bsc').check.status === 'single'
      && mc('fantom').v === null && /lists no circulating supply/.test(mc('fantom').why) && mc('fantom').check.status === 'none' && mc('morph').label === 'BGB (gas token), market cap' && mc('stable').check.coin.name === 'Stable'
      && mc('robinhood').check.status === 'none' && mc('robinhood').check.mapping.note === 'no token of its own to check', badChk.slice(0, 4).join(' | '));
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
    /* the RWA tab's: lib's own answers (tests/marketdata.mjs's MARKET_DUMP_DIR) from the research's measured samples */
    const RA = FIX('rwa-assets.json'), RT = FIX('rwa-tokens.json'), RC = FIX('rwa-connected.json'), RS = FIX('rwa-stables.json'), RTS = FIX('rwa-token-' + TSLA + '.json'), RNO = FIX('rwa-token-notrwa-' + GME_MEME + '.json');
    // a yes/no reading (halted, paused): true or false as read, or null with its reason — never false for "could not read"
    const badFact = [];
    // an RWA figure: the contract's, except that one never read has no read time (at null) — its reason says so
    const isRFig = (x, where) => (x && x.v === null && x.at === null && SRCS.includes(x.src) && typeof x.why === 'string' && x.why.length > 3) || isFig(x, where);
    const isFact = (x, where) => { const ok = x && typeof x === 'object' && (x.v === true || x.v === false || (x.v === null && typeof x.why === 'string' && x.why.length > 3)) && SRCS.includes(x.src) && (x.at === null || x.at > 1.7e12); if (!ok) badFact.push(where + '=' + JSON.stringify(x).slice(0, 80)); return ok; };
    const RMETA = ['at', 'chain', 'view', 'sort', 'dir', 'kind', 'issuer', 'total', 'rows', 'issuers', 'totals', 'reads', 'definitions', 'notes', 'sources'];
    check('the RWA fixtures are there: Top RWAs, every RWA token, the connected tokens, the stablecoins, TSLA\'s facts and the GameStop memecoin\'s 404 — lib\'s own answers, each with the contract\'s keys',
      ['rwa-assets.json', 'rwa-tokens.json', 'rwa-connected.json', 'rwa-stables.json', 'rwa-token-' + TSLA + '.json', 'rwa-token-notrwa-' + GME_MEME + '.json'].every((x) => files.includes(x))
      && [RA, RT, RC, RS].every((j) => RMETA.every((k) => k in j) && j.chain === 'robinhood' && Array.isArray(j.rows) && j.rows.length > 0) && RA.view === 'assets' && RT.view === 'tokens' && RC.view === 'connected' && RS.view === 'stables'
      && ['belowFloor', 'unreadReserve', 'floor'].every((k) => typeof RC[k] === 'number') && RC.floor === 1000
      && ['rwa', 'value', 'tvl', 'liquidity', 'mcap', 'volume', 'premium', 'connected', 'stables'].every((k) => typeof RA.definitions[k] === 'string' && RA.definitions[k].length > 30)
      && ['registry', 'prices', 'chain', 'tvl', 'stables', 'chainlink', 'roles'].every((k) => RA.reads[k] && typeof RA.reads[k].ok === 'boolean' && 'at' in RA.reads[k])
      && RA.sources.every((x) => SRCS.includes(x.id) && /^https:\/\//.test(x.href)) && RA.issuers.map((x) => x.key).join() === 'rhj,ondo,anchored,st0x,midas', files.length + ' files');
    for (const g of RA.rows) for (const k of ['value', 'liquidity', 'mcap', 'tvl', 'volume24h']) isRFig(g[k], 'rwa-assets:' + g.key + '.' + k);
    for (const r of RT.rows) {
      for (const k of ['priceUsd', 'supply', 'value', 'mcap', 'liquidity', 'tvl', 'volume24h', 'premium', 'multiplier', 'mintBurnUsd']) isRFig(r[k], 'rwa-tokens:' + r.symbol + '.' + k);
      isRFig(r.reference.chainlink, 'rwa-tokens:' + r.symbol + '.reference.chainlink'); isRFig(r.reference.robinhood, 'rwa-tokens:' + r.symbol + '.reference.robinhood');
      isFact(r.halted, 'rwa-tokens:' + r.symbol + '.halted'); for (const k of ['global', 'token', 'oracle']) isFact(r.paused[k], 'rwa-tokens:' + r.symbol + '.paused.' + k);
    }
    for (const c of RC.rows) { isRFig(c.reserveUsd, 'rwa-connected:' + c.symbol + '.reserveUsd'); isRFig(c.volume24h, 'rwa-connected:' + c.symbol + '.volume24h'); }
    for (const x of RS.rows) for (const k of ['supply', 'circulating', 'priceUsd', 'liquidity']) isRFig(x[k], 'rwa-stables:' + x.symbol + '.' + k);
    for (const k of ['value', 'liquidity', 'tvl', 'mcap', 'volume24h', 'stables']) isRFig(RA.totals[k], 'rwa-assets.totals.' + k);
    isRFig(RA.totals.l2beat.rwaPublic, 'rwa-assets.totals.l2beat.rwaPublic');
    const row = (sym) => RT.rows.find((r) => r.symbol === sym) || {}, tiers = (r) => (r.evidence || []).map((e) => e.tier).join('+');
    check('  ...GET /api/market/rwa?view=tokens: every row { address, symbol, name, logo, issuer, underlying, confidence, evidence, status, priceUsd, supply, value, mcap, liquidity, tvl, volume24h, reference { chainlink, robinhood }, premium, deviation, multiplier, halted, paused { global, token, oracle }, mintBurnUsd, flags } — the measured cases in it: TSLA confirmed on the registry and the chain (A1 + A2), WEEK by the chain alone ("on the chain, not in the registry\'s active list", a bond, Robinhood\'s −50% deviation), Ondo\'s TSLAon on its own beacon (A3), listed tokens not confirmed yet (why: fingerprint not read yet), SPY and QQQ pairing two RWAs, a reverted paused() as "no such function" — never "not paused"',
      RT.rows.every((r) => /^0x[0-9a-f]{40}$/.test(r.address) && r.issuer && RW.ISSUERS[r.issuer.key] && ['confirmed', 'issuer-listed', 'not-confirmed'].includes(r.confidence) && Array.isArray(r.evidence) && r.evidence.length && r.evidence.every((e) => ['A1', 'A2', 'A3', 'B'].includes(e.tier) && typeof e.text === 'string' && SRCS.includes(e.src)) && Array.isArray(r.flags) && (r.logo == null || /^\/api\/market\/logo\?u=https%3A%2F%2F/.test(r.logo)))
      && row('TSLA').confidence === 'confirmed' && /^A1\+A2/.test(tiers(row('TSLA'))) && row('WEEK').confidence === 'confirmed' && /^A2(\+B)*$/.test(tiers(row('WEEK'))) && row('WEEK').status.text === 'On the chain, not in the registry\'s active list' && row('WEEK').underlying.kind === 'bond' && row('WEEK').deviation.direction === 'discount'
      && row('TSLAon').confidence === 'confirmed' && /^A3/.test(tiers(row('TSLAon'))) && RT.rows.filter((r) => r.confidence === 'not-confirmed').every((r) => r.why === 'fingerprint not read yet' && r.flags.includes('not-confirmed')) && RT.rows.some((r) => r.confidence === 'not-confirmed')
      && row('SPY').flags.includes('pairs-rwa') && row('QQQ').flags.includes('pairs-rwa') && row('TSLA').paused.global.v === null && row('TSLA').paused.global.absent === true && /no such function/.test(row('TSLA').paused.global.why) && row('TSLA').paused.token.v === false
      && row('TSLAon').premium.v === null && /no reference price is read for this issuer/.test(row('TSLAon').premium.why) && !JSON.stringify([RA, RT, RTS]).includes('cdn.robinhood.com'));
    check('  ...Top RWAs groups an underlying\'s tokens (TSLA with Ondo\'s TSLAon; the main token Robinhood\'s), the totals stand apart from the stablecoins and from L2BEAT\'s own count; connected rows each say "Not an RWA — paired with $…"; the stablecoin says it is not counted; the notes carry the tiers, what is kept apart, the not-affiliated and the not-advice lines',
      RA.rows.find((g) => g.key === 'TSLA').tokens.map((t) => t.symbol).join() === 'TSLA,TSLAon' && RA.rows.find((g) => g.key === 'TSLA').main === TSLA && RA.totals.count > 0 && typeof RA.totals.notConfirmed === 'number'
      && RA.totals.stables.src === 'defillama' && RA.totals.l2beat.rwaPublic.src === 'l2beat' && /L2BEAT's count of real-world assets on Robinhood Chain/.test(RA.totals.l2beat.rwaPublic.label)
      && RC.rows.every((c) => /^Not an RWA — paired with \$\S+$/.test(c.label) && c.reserveUsd.v >= 1000 && /^0x[0-9a-f]{40}$/.test(c.address) && c.rwa && /^0x[0-9a-f]{40}$/.test(c.rwa.address)) && RS.rows.every((x) => /^Not counted as an RWA here/.test(x.label)) && RS.rows.some((x) => x.address === USDG)
      && [RA, RT, RC, RS].every((j) => j.notes.some((n) => /^Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\./.test(n)) && j.notes.some((n) => n === 'Not advice, never a tip to buy. Do your own research.') && j.notes.some((n) => /^How a token counts as an RWA here/.test(n)) && j.notes.some((n) => /listed apart and never counted/.test(n))));
    for (const k of ['priceUsd', 'supply', 'value', 'mcap', 'liquidity', 'tvl', 'volume24h', 'premium', 'multiplier', 'mintBurnUsd']) isRFig(RTS[k], 'rwa-token-tsla.' + k);
    check('  ...GET /api/market/rwa/token (TSLA): its row plus what its card shows — what you hold (every Robinhood sentence with its docs.robinhood.com page, terms() read on the chain), the controls (the registry as beacon, the code it runs, its Sourcify link, 12 powers, each holder\'s kind, "powers a regulated issuer keeps"), the roles, 175 wallets blocked, the corporate actions, the connected tokens, the lookalikes, Chainlink\'s feed (heartbeat, not stale), the token deployer, the reads, the notes; the memecoin\'s 404 says it is not issued by Robinhood Assets (Jersey) and where the registry lists $GME',
      RTS.address === TSLA && RTS.issuerProfile.sentences.length === RW.ISSUER_TEXT.rhj.length && RTS.issuerProfile.sentences.every((x, i) => x.text === RW.ISSUER_TEXT.rhj[i].text && x.href === RW.ISSUER_TEXT.rhj[i].href) && RTS.issuerProfile.sentences.every((x) => /^https:\/\/docs\.robinhood\.com\//.test(x.href)) && RTS.issuerProfile.terms.src === 'rpc' && /^https:\/\//.test(RTS.issuerProfile.terms.v)
      && RTS.controls.registry === RW.ISSUERS.rhj.registry && RTS.controls.beacon === RTS.controls.registry && /^0x[0-9a-f]{40}$/.test(RTS.controls.implementation.address) && /^https:\/\/sourcify\.dev\/server\/v2\/contract\/4663\//.test(RTS.controls.verifiedSource)
      && RTS.controls.powers.length === 12 && RTS.controls.powers.every((x) => x.power && x.role && Array.isArray(x.holders)) && /they are still powers over your tokens/.test(RTS.controls.note)
      && Array.isArray(RTS.roles) && RTS.roles.length > 12 && RTS.blocked.count === 175 && Array.isArray(RTS.corporateActions) && RTS.connected.length > 0 && RTS.connected.every((c) => /^Not an RWA/.test(c.label)) && Array.isArray(RTS.lookalikes)
      && RTS.chainlink.heartbeat === 86400 && RTS.chainlink.stale === false && RTS.chainlink.updatedAt > 1.7e12 && RTS.deployer.role === 'TOKEN_DEPLOYER_ROLE' && RTS.notes.some((n) => /markets close while DEX pools trade around the clock/.test(n))
      && RNO.notRwa === true && RNO.address === GME_MEME && /^Same ticker as \$GME, but not issued by Robinhood Assets \(Jersey\) — the registry lists \$GME at 0x/.test(RNO.why) && RNO.notes.length === 2);
    check('  ...and every yes/no reading in them is true or false as read, or null with its reason', !badFact.length, badFact.slice(0, 6).join(' | '));
    check('  ...and every figure in them is an { v, src, at } object, null only with a reason', !badFig.length, badFig.slice(0, 6).join(' | '));

    /* the bubble map's answer: lib/marketdata.js's own, its heatmap job run on CoinGecko's and CoinLore's answers of 2026-10-30 */
    const HM = FIX('heatmap.json'), HMR = HM.rows, hmBad = [];
    for (const r of HMR) for (const k of ['price', 'mcap', 'dominance', 'change24h', 'volume24h']) if (!isFig(r[k], 'heatmap.' + r.id + '.' + k)) hmBad.push(r.id + '.' + k);
    isFig(HM.total, 'heatmap.total');
    const hmDom = HMR.filter((r) => r.dominance.v != null).every((r) => Math.abs(r.dominance.v - (r.mcap.v / HM.total.v) * 100) < 1e-9 * Math.max(1, r.dominance.v));
    const buidl = HMR.find((r) => r.id === 'blackrock-usd-institutional-digital-liquidity-fund');
    check('heatmap.json: the 100 largest coins in CoinGecko\'s order (Bitcoin first and largest), every figure an { v, src, at } from CoinGecko, each dominance its market cap ÷ CoinGecko\'s total ($2.59T), 17 stablecoins, each market cap\'s CoinLore check (agreed / differs / single, with its sources), the legend\'s ten steps, the reads, the not-advice note and the sources',
      HMR.length === 100 && HM.limit === 100 && HM.stables === true && HMR[0].id === 'bitcoin' && HMR.every((r, i) => !i || r.mcap.v <= HMR[i - 1].mcap.v) && HMR.every((r, i) => r.rank === i + 1) && !hmBad.length && HM.total.src === 'coingecko' && HM.total.v > 2.5e12
      && hmDom && Math.abs(HMR[0].dominance.v - 59.597) < 0.01 && HMR.filter((r) => r.stable === true).length === 17 && HMR.every((r) => typeof r.stable === 'boolean') && HMR.every((r) => ['agreed', 'differs', 'single'].includes(r.check.status) && Array.isArray(r.check.sources) && Array.isArray(r.check.notes))
      && JSON.stringify(HM.legend.map((b) => b.key)) === JSON.stringify(MM.BUCKETS.map((b) => b.key)) && Object.values(HM.reads).every((x) => x.ok === true && x.at > 1.7e12) && Object.keys(HM.reads).join() === 'coins,global,stables,coinlore'
      && HM.notes[0] === 'Not advice, never a tip to buy. Do your own research.' && HM.sources.map((x) => x.id).join() === 'coingecko,coinlore' && HM.counts.drawn === 100 && HM.counts.down + HM.counts.up + HM.counts.flat + HM.counts.none === 100, hmBad.slice(0, 5).join(' | '));
    check('  ...and its traps as measured: BlackRock\'s BUIDL is exactly 0% (a figure of 0, the legend\'s "0%", never "no change"), BNB is CoinGecko\'s alone (CoinLore lists it only as "Binance Coin"), HYPE\'s sources differ by their circulating supplies, a coin outside CoinLore\'s first 100 says so',
      buidl && buidl.change24h.v === 0 && !('why' in buidl.change24h) && MM.bucketOf(buidl.change24h.v) === 'flat'
      && /only under another name \(“Binance Coin”/.test(HMR.find((r) => r.id === 'binancecoin').check.notes.join(' ')) && HMR.find((r) => r.id === 'hyperliquid').check.status === 'differs' && /circulating supply/.test(HMR.find((r) => r.id === 'hyperliquid').check.notes[0])
      && /CoinLore’s 100 largest coins include none with the symbol \$LTC/.test(HMR.find((r) => r.id === 'litecoin').check.notes.join(' ')));

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
      F.pct(-2.55) === '▼ −2.55%' && F.pct(8.23) === '▲ +8.23%' && F.pct(0) === '0.00%' && F.pct(null) === null && F.count(4613599) === '4.61M' && F.count(207510) === '208k' && F.count(1343) === '1,343'
      && F.count(965416274329945.1) === '965T' && F.count(5512186236358.09) === '5.51T' && F.count(146246726558361) === '146T' && F.count(6892115031) === '6.89B' && F.gwei(0.02014) === '0.02014 gwei' && F.amount(262043.43, 'ETH') === '262k ETH',
      [F.pct(-2.55), F.count(207510), F.amount(262043.43, 'ETH'), F.count(965416274329945.1)].join(' '));
    check('  ...and a read time says how long ago, never a guess when there is none', F.agoText(Date.now() - 5 * 60e3) === '5\u00a0min ago' && F.agoText(Date.now() - 3 * 3600e3) === '3\u00a0h ago' && F.agoText(null) === 'time not recorded' && F.utc(Date.parse('2026-10-26T17:30:00Z')) === '2026-10-26 17:30 UTC');

    /* ═══ 3b. the bubble map's packing, run (the @lift:pack block): no two circles overlap, every one inside its ring, the ring as tight
       as its circles, and the same circles always packed the same way ═══ */
    const packSrc = JS.slice(JS.indexOf('/* @lift:pack '), JS.indexOf('/* @lift:pack-end */'));
    const colSrc = JS.slice(JS.indexOf('/* @lift:column '), JS.indexOf('/* @lift:column-end */'));
    const pctx = vm.createContext({ Math, Number, Error });
    vm.runInContext(packSrc + colSrc + '\nthis.pack = (rs) => { const cs = rs.map((r) => ({ r })); const R = packCircles(cs); return { R, cs: cs.map((c) => ({ x: c.x, y: c.y, r: c.r })) }; };'
      + '\nthis.column = (rs, W) => { const cs = rs.map((r) => ({ r })); const H = packColumn(cs, W); return { H, cs: cs.map((c) => ({ x: c.x, y: c.y, r: c.r })) }; }; this.layout = mapLayout;', pctx);
    let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const sets = {
      'the 100 coins of heatmap.json (the radius the square root of the market cap)': HMR.map((r) => Math.sqrt(r.mcap.v)),
      'its 83 without the stablecoins': HMR.filter((r) => !r.stable).map((r) => Math.sqrt(r.mcap.v)),
      '100 heavy-tailed radii': Array.from({ length: 100 }, () => Math.pow(rand(), 3) * 50 + 0.5).sort((a, b) => b - a),
      '60 equal circles': Array(60).fill(3), 'one': [5], 'two': [5, 2], 'three': [5, 4, 3],
    };
    const packBad = [];
    for (const [name, rs] of Object.entries(sets)) {
      const a = pctx.pack(rs), b = pctx.pack(rs), k = 380 / a.R;   // drawn in a 760 px square, as on a desktop
      const cs = a.cs.map((c) => ({ x: c.x * k, y: c.y * k, r: c.r * k })), R = a.R * k;
      let over = 0, out = 0, reach = 0;
      for (let i = 0; i < cs.length; i++) {
        const d = Math.hypot(cs[i].x, cs[i].y) + cs[i].r; reach = Math.max(reach, d); if (d > R + 0.5) out++;
        for (let j = i + 1; j < cs.length; j++) if (Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y) < cs[i].r + cs[j].r - 0.5) over++;
      }
      const same = JSON.stringify(a) === JSON.stringify(b), tight = reach > R - 0.5, finite = cs.every((c) => isFinite(c.x) && isFinite(c.y));
      if (over || out || !same || !tight || !finite) packBad.push(name + ': ' + JSON.stringify({ over, out, same, tight, finite, R: +R.toFixed(2), reach: +reach.toFixed(2) }));
    }
    const pk = pctx.pack(sets[Object.keys(sets)[0]]), big = pk.cs[0];
    check('the bubble map\'s packing (front-chain packing, then the smallest enclosing circle — written in market.js, run here): for the 100 coins, the 83 without stablecoins, 100 heavy-tailed radii, 60 equal circles and one, two and three — no two circles overlap by more than 0.5 px and every one is inside the ring (in a 760 px map), the ring touches its outermost circle, and the same circles are packed the same way every time',
      !packBad.length && pctx.pack([]).R === 0 && big.r > pk.cs[1].r * 2, packBad.join(' | '));
    // the column (the @lift:column block): the same sets, largest first, in a box 354 px wide (a phone) and 699 px wide (a tablet)
    const colBad = [];
    for (const [name, rs] of Object.entries(sets)) for (const W of [354, 699]) {
      const top = Math.max(...rs, 1e-9), sc = (W / 6) / top, rr = rs.map((r) => Math.max(8, r * sc));   // the biggest a third of the width
      const a = pctx.column(rr, W), b = pctx.column(rr, W), cs = a.cs;
      let over = 0, out = 0, lowest = 0;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i]; lowest = Math.max(lowest, c.y + c.r);
        if (c.x - c.r < -0.5 || c.x + c.r > W + 0.5 || c.y - c.r < -0.5) out++;
        for (let j = i + 1; j < cs.length; j++) if (Math.hypot(c.x - cs[j].x, c.y - cs[j].y) < c.r + cs[j].r - 0.5) over++;
      }
      const same = JSON.stringify(a) === JSON.stringify(b), finite = cs.every((c) => isFinite(c.x) && isFinite(c.y)), tight = Math.abs(lowest - a.H) < 1e-6, top0 = !cs.length || Math.abs(cs[0].y - cs[0].r) < 1e-6;
      if (over || out || !same || !finite || !tight || !top0) colBad.push(name + ' in ' + W + ' px: ' + JSON.stringify({ over, out, same, finite, tight, top0, H: +a.H.toFixed(1) }));
    }
    const c1 = pctx.column([30], 300).cs[0], c3 = pctx.column([30, 20, 20], 300).cs;
    check('  ...and the column, for a box too narrow for the ring (written in market.js, run here): the same sets in a 354 px and a 699 px box — largest first, each at the lowest place it can sit, the nearest the middle line among equals: no two overlap by more than 0.5 px, every one inside the side walls and under the top one, the first against the top wall, the height the lowest bubble\'s bottom, the same every time',
      !colBad.length && pctx.column([], 300).H === 0 && c1.x === 150 && c1.y === 30 && c3[1].y === 20 && c3[2].y === 20 && Math.abs(Math.abs(c3[1].x - 150) - Math.abs(c3[2].x - 150)) < 1e-9 && Math.abs(Math.abs(c3[1].x - 150) - Math.sqrt(50 * 50 - 10 * 10)) < 1e-9, colBad.join(' | '));
    /* the sizes and the layout (mapLayout), on the 100 coins of heatmap.json, the 83 without stablecoins and the top 50, at the floor
       and the box width of each screen the browser walk uses — the ticker's width here an estimate (0.66 of the size a letter, Rubik
       800's capitals; the browser measures it): every bubble at least its minimum, the largest coin plainly the biggest, no overlap,
       all inside the ring or the column, the ring only when it is as wide as the box, the column no taller than 2.5 widths unless
       even its smallest scale is, the same every time */
    const est = (sym, fl) => { const w = String(sym).length * fl * 0.66, e = fl * 0.52; return Math.max(Math.sqrt((w / 1.72) * (w / 1.72) + e * e), (fl * 1.04) / 1.62) + 1; };
    const layBad = [], modes = [];
    const coinSets = { 'the 100': HMR, 'the 83 without stablecoins': HMR.filter((r) => !r.stable), 'the top 50': HMR.slice(0, 50) };
    for (const [name, rows] of Object.entries(coinSets)) for (const [W, fl] of [[284, 14], [354, 14.19], [699, 18.92], [950, 22.13], [1162, 25.33], [1353, 25.33]]) {
      const shown = rows.filter((r) => r.mcap.v > 0).sort((a, b) => b.mcap.v - a.mcap.v), top = shown[0].mcap.v, gap = W < 500 ? 0.9 : 1.4;
      const items = shown.map((r) => ({ need: est(r.symbol, fl), f: Math.pow(r.mcap.v / top, 0.25) }));
      const t0 = Date.now(), L = pctx.layout(items, W, gap), ms = Date.now() - t0, L2 = pctx.layout(items, W, gap);
      const cs = L.cs, plain = 1.15 * Math.max(...items.map((x) => x.need));
      let over = 0, out = 0, under = 0;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i]; if (c.r < items[c.i].need - 1e-9) under++;
        if (L.ring ? Math.hypot(c.x - W / 2, c.y - W / 2) + c.r > W / 2 - 1.5 + 0.5 : c.x - c.r < -0.5 || c.x + c.r > W + 0.5 || c.y - c.r < -0.5 || c.y + c.r > L.h + 0.5) out++;
        for (let j = i + 1; j < cs.length; j++) if (Math.hypot(c.x - cs[j].x, c.y - cs[j].y) < c.r + cs[j].r - 0.5) over++;
      }
      const biggest = cs.reduce((a, b) => (b.r > a.r ? b : a)), all = cs.length === items.length && new Set(cs.map((c) => c.i)).size === items.length;
      const sizeOK = L.ring ? L.h === W && L.k >= plain - 1e-9 : L.k >= plain - 1e-9 && L.k <= Math.max(W / 6, plain) + 1e-9 && (L.h <= 2.5 * W + 4 || Math.abs(L.k - plain) < 1e-9);
      modes.push(name.replace(/^the /, '') + '@' + W + ':' + (L.ring ? 'ring' : 'column ' + L.h) + ' ' + ms + 'ms');
      if (over || out || under || !all || biggest.i !== 0 || !sizeOK || JSON.stringify(L) !== JSON.stringify(L2) || ms > 1500) layBad.push(name + ' at ' + W + ' px: ' + JSON.stringify({ over, out, under, all, biggest: biggest.i, sizeOK, ring: L.ring, k: +L.k.toFixed(1), h: L.h, ms }));
    }
    // a coin labelled by a long name (no symbol) needs more than the box: its bubble is as wide as the box, never wider
    const huge = pctx.layout([{ need: 20, f: 1 }, { need: 500, f: 0.3 }, { need: 20, f: 0.2 }], 284, 0.9), hugeIn = huge.cs.every((c) => c.x - c.r >= -0.5 && c.x + c.r <= 284.5);
    const lay = (n, W, fl) => { const rows = HMR.slice(0, n), top = rows[0].mcap.v; return pctx.layout(rows.map((r) => ({ need: est(r.symbol, fl), f: Math.pow(r.mcap.v / top, 0.25) })), W, 1.4); };
    check('  ...and the sizes (owner, round 2: "adjust the size of the bubbles proportionally so all tickers show"): each bubble\'s radius max(its ticker\'s minimum at the floor, k × (its market cap ÷ the largest\'s)^0.25) — a compressed scale, its area the square root — for the 100 coins, the 83 without stablecoins and the top 50 at the floor and box of 320, 390, 768, 1024, 1280 and 1920 px: every bubble at least its minimum, the largest coin the biggest bubble, none overlapping and all inside; the ring (as wide as the box) where it holds them all, else the column — the 100 in a ring from a 1162 px box, in a column at 284 and 354 px — no bubble wider than the box, and the same every time. ' + modes.join(', '),
      !layBad.length && hugeIn && lay(100, 1162, 25.33).ring && lay(100, 1353, 25.33).ring && !lay(100, 284, 14).ring && !lay(100, 354, 14.19).ring && pctx.layout([], 300, 1).cs.length === 0, layBad.join(' | '));

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
      // the RWAs: lib's answers, filtered and sorted as the server does
      const ra = await get('/api/market/rwa'), rt = await get('/api/market/rwa?view=tokens&sort=tvl'), rta = await get('/api/market/rwa?view=tokens&sort=tvl&dir=asc'), rm = await get('/api/market/rwa?view=tokens&sort=mcap');
      const rk = await get('/api/market/rwa?view=tokens&kind=etf'), ri = await get('/api/market/rwa?issuer=ondo'), rc = await get('/api/market/rwa?view=connected&sort=volume'), rs = await get('/api/market/rwa?view=stables'), rbad = await get('/api/market/rwa?view=nope&sort=nope&dir=up&kind=nope&issuer=nope');
      const lastNull = (rows, get) => { const k = rows.findIndex((r) => get(r) == null); return k < 0 || rows.slice(k).every((r) => get(r) == null); };
      const ordered = (rows, get, dir) => rows.map(get).filter((x) => x != null).every((x, i, a) => i === 0 || (dir === 'asc' ? a[i - 1] <= x : a[i - 1] >= x));
      check('  ...the RWAs: Top RWAs by value on chain by default; every RWA token by TVL in DeFi, highest or lowest first — a token with none last in both; by market cap, an every-chain figure kept out of the ranking; filtered by kind and by issuer; connected tokens by the pool\'s volume; the stablecoins; anything it does not know falls back to the defaults',
        ra.status === 200 && ra.j.view === 'assets' && ra.j.sort === 'value' && ordered(ra.j.rows, (r) => v(r.value), 'desc') && lastNull(ra.j.rows, (r) => v(r.value))
        && rt.j.rows[0].symbol === 'mGLO' && ordered(rt.j.rows, (r) => v(r.tvl), 'desc') && lastNull(rt.j.rows, (r) => v(r.tvl)) && ordered(rta.j.rows, (r) => v(r.tvl), 'asc') && lastNull(rta.j.rows, (r) => v(r.tvl)) && v(rta.j.rows[0].tvl) != null
        && lastNull(rm.j.rows, (r) => (r.mcap.global ? null : v(r.mcap))) && rm.j.notes.some((n) => /kept out of the market-cap ranking/.test(n)) && rk.j.rows.length > 0 && rk.j.rows.every((r) => r.underlying.kind === 'etf')
        && ri.j.rows.length > 0 && ri.j.rows.every((g) => g.issuers.some((x) => x.key === 'ondo')) && ri.j.issuers.length === 5 && rc.j.view === 'connected' && ordered(rc.j.rows, (r) => v(r.volume24h), 'desc') && rc.j.notes.some((n) => /^Ranked by the pool's 24 h volume\./.test(n))
        && rs.j.view === 'stables' && rs.j.rows.some((x) => x.address === USDG) && rbad.status === 200 && rbad.j.view === 'assets' && rbad.j.sort === 'value' && rbad.j.dir === 'desc' && rbad.j.kind === 'all' && rbad.j.issuer === 'all',
        JSON.stringify({ tvl: rt.j.rows.slice(0, 3).map((r) => [r.symbol, v(r.tvl)]), asc: rta.j.rows.slice(0, 3).map((r) => [r.symbol, v(r.tvl)]) }));
      const t1 = await get('/api/market/rwa/token?address=' + TSLA), t2 = await get('/api/market/rwa/token?address=' + TSLAON), t3 = await get('/api/market/rwa/token?address=' + GME_MEME), t4 = await get('/api/market/rwa/token?address=' + USDG), t5 = await get('/api/market/rwa/token?address=nope');
      const spy = await get('/api/market/rwa/token?address=' + FIX('rwa-tokens.json').rows.find((r) => r.symbol === 'SPY').address);
      check('  ...one token\'s RWA facts: TSLA\'s (lib\'s answer); SPY\'s built from its row as lib builds it, with its cash dividend; Ondo\'s TSLAon (no Robinhood reference, powers this site does not read, each said why); a 404 for the memecoin (not issued by…) and for USDG (a stablecoin, listed apart); a 400 for a bad address',
        t1.status === 200 && t1.j.address === TSLA && t1.j.controls.powers.length === 12 && spy.status === 200 && spy.j.corporateActions.some((a) => a.typeWords === 'cash dividend' && a.date === '2026-10-30') && spy.j.chainlink && spy.j.controls.powers.length === 12
        && t2.status === 200 && t2.j.issuer.key === 'ondo' && t2.j.confidence === 'confirmed' && t2.j.chainlink === null && /Robinhood's Stock Tokens only/.test(t2.j.chainlinkWhy) && t2.j.controls.powers.length === 0 && /reads the roles of Robinhood's registry only/.test(t2.j.controls.powersWhy) && /^https:\/\/www\.coingecko\.com\//.test(t2.j.issuerProfile.coingecko)
        && t3.status === 404 && t3.j.notRwa === true && /not issued by Robinhood Assets \(Jersey\)/.test(t3.j.why) && t4.status === 404 && t4.j.stablecoin === true && /fiat-backed stablecoin — listed apart/.test(t4.j.why) && t5.status === 400,
        JSON.stringify({ t2: t2.j && t2.j.controls, t4: t4.j }).slice(0, 500));
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
      ['rwa-assets.json', FIX('rwa-assets.json'), R.rwa.assets], ['rwa-tokens.json', FIX('rwa-tokens.json'), R.rwa.tokens], ['rwa-connected.json', FIX('rwa-connected.json'), R.rwa.connected],
      ['rwa-stables.json', FIX('rwa-stables.json'), R.rwa.stables], ['rwa-token-' + TSLA + '.json', FIX('rwa-token-' + TSLA + '.json'), R.rwa.tsla], ['rwa-token-notrwa-' + GME_MEME + '.json', FIX('rwa-token-notrwa-' + GME_MEME + '.json'), R.rwa.notRwa],
      // the Scanner's RWA card fixtures (tests/scanpage.mjs) are frozen copies of the same answer: held to lib's shapes here too
      // SPY and GME: their own pools' read failed when the files were dumped (connectedWhy), as SPY's does in the real answers' world
      ...['tsla', 'tsla-registry-down', 'week'].map((k) => ['rwacard/rwa-token-' + k + '.json', RWACARD('rwa-token-' + k + '.json'), R.rwa.tsla]),
      ...['spy', 'gme'].map((k) => ['rwacard/rwa-token-' + k + '.json', RWACARD('rwa-token-' + k + '.json'), R.rwa.spy]),
      ['rwacard/rwa-token-tslaon.json', RWACARD('rwa-token-tslaon.json'), R.rwa.ondo], ['rwacard/rwa-token-gme-memecoin.json', RWACARD('rwa-token-gme-memecoin.json'), R.rwa.notRwa],
      ['rwacard/rwa-token-usdg.json', RWACARD('rwa-token-usdg.json'), R.rwa.notRwaStable],
      ['heatmap.json', FIX('heatmap.json'), R.heatmap],
    ];
    /* a key lib adds only in a state the answer it is held to is not in: a failed read's reason (reads.<k>.why, Robinhood's API down) and
       chainlinkWhy beside a null chainlink (a ticker Chainlink has no feed for) — dropped from the frozen copy before the comparison when
       lib's answer is not in that state too, never from lib's answer, so a key lib stops serving or starts serving still shows */
    const stateOnly = (o, ref) => {
      const c = JSON.parse(JSON.stringify(o));
      if (c && c.reads) for (const [k, r] of Object.entries(c.reads)) if (r && typeof r === 'object' && r.ok === false && !(ref.reads && ref.reads[k] && 'why' in ref.reads[k])) delete r.why;
      if (c && c.chainlink === null && !('chainlinkWhy' in ref)) delete c.chainlinkWhy;
      return c;
    };
    for (const p of pairs) if (/^rwacard\//.test(p[0])) p[1] = stateOnly(p[1], p[2]);
    const drift = pairs.map(([f, a, b]) => [f, shapeDiff(a, b)]).filter(([, d]) => d.length);
    check('every fixture has the shape lib/marketdata.js really serves, key for key (history as [day, value] arrays with history.src, a token\'s trades as windows[k].txns, the pulse with suppliesAt and bridgeAt; the RWA answers on a database seeded from the measured samples — TSLA confirmed, its facts in full, the memecoin\'s 404 with its symbol)',
      !drift.length && R.chain.robinhood.history && Array.isArray(R.chain.robinhood.history.tvl) && R.chain.robinhood.pulse.now.suppliesAt > 0 && 'txns' in R.token.windows['24h']
      && R.rwa.tokens.rows[0].address === TSLA && R.rwa.tokens.rows[0].confidence === 'confirmed' && R.rwa.tsla.chainlink && R.rwa.tsla.deployer && R.rwa.ondo.confidence === 'confirmed' && R.rwa.notRwaStatus === 404 && R.rwa.notRwa.symbol === 'gme' && R.tokenTsla.rwa && R.token.rwa === null, drift.map(([f, d]) => f + ': ' + d.slice(0, 4).join('; ')).join(' | '));
    const realChk = R.chains['24h'].rows.find((r) => r.key === 'ethereum').mcap.check, realNone = R.chain.robinhood.stats.mcap.check;
    const chkKeys = (c) => JSON.stringify([Object.keys(c || {}), c && c.sources && c.sources[0] ? Object.keys(c.sources[0]) : null, c && c.mapping ? Object.keys(c.mapping).filter((k) => k === 'status') : null, c && c.coin ? Object.keys(c.coin) : null]);
    const fixChk = FIX('chains-24h.json').rows.find((r) => r.key === 'ethereum').mcap.check;
    check('  ...and a market cap\'s check has the keys lib/marketdata.js serves, key for key (status, sources [{ src, v, price, supply, at }], notes, mapping, coin), with and without a token of its own',
      realChk && chkKeys(fixChk) === chkKeys(realChk) && JSON.stringify(Object.keys(FIX('chain-robinhood.json').stats.mcap.check)) === JSON.stringify(Object.keys(realNone)) && realChk.status === 'agreed' && realNone.status === 'none', chkKeys(fixChk) + ' vs ' + chkKeys(realChk));
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
    const fb = (p) => JSON.parse(JSON.stringify(fakeAnswer(new URL(p, 'http://x'))[1]));   // the body, whatever the status
    fakes.push(['an RWA token\'s facts built by the fake (Robinhood\'s TSLA)', JSON.parse(JSON.stringify(fakeRwaTokenBuilt(TSLA))), R.rwa.tsla],
      ['an RWA token\'s facts built by the fake (another issuer: Ondo\'s TSLAon)', fb('/api/market/rwa/token?address=' + TSLAON), R.rwa.ondo],
      ['the RWA row a token answer carries', fb('/api/market/token?chain=robinhood&address=' + TSLA).rwa, R.tokenTsla.rwa],
      ['the RWA tokens, sorted and filtered by the fake', fb('/api/market/rwa?view=tokens&sort=tvl&dir=asc&kind=stock'), Object.assign({}, R.rwa.tokensStock, { rows: R.rwa.tokens.rows })], ['Top RWAs, filtered by the fake', fb('/api/market/rwa?issuer=ondo'), Object.assign({}, R.rwa.assetsOndo, { rows: R.rwa.assets.rows })],
      ['connected tokens, sorted by the fake', fb('/api/market/rwa?view=connected&sort=volume'), R.rwa.connected], ['the stablecoins, sorted by the fake', fb('/api/market/rwa?view=stables&sort=liquidity'), R.rwa.stables],
      ['a stablecoin\'s RWA 404', fb('/api/market/rwa/token?address=' + USDG), R.rwa.notRwaStable],
      ['the bubble map, cut by the fake (top 50, stablecoins left out)', fb('/api/market/heatmap?limit=50&stables=0'), R.heatmapCut]);
    const fdrift = fakes.map(([n, a, b]) => [n, shapeDiff(a, b)]).filter(([, d]) => d.length);
    check('  ...the bubble map\'s answer on that database is the fixture\'s, coin for coin (the same 100 in the same order, the same figures, the same checks), and cut the same way by the route and by the fake',
      JSON.stringify(R.heatmap.rows.map((r) => [r.id, r.mcap.v, r.change24h.v, r.stable, r.check.status])) === JSON.stringify(FIX('heatmap.json').rows.map((r) => [r.id, r.mcap.v, r.change24h.v, r.stable, r.check.status]))
      && JSON.stringify(R.heatmapCut.rows.map((r) => r.id)) === JSON.stringify(fb('/api/market/heatmap?limit=50&stables=0').rows.map((r) => r.id)) && R.heatmapCut.rows.length === 40 && R.heatmapCut.counts.drawn === 40);
    check('  ...and so does every answer the fake builds for itself (a chain with no history, a token from the list, a custom window, an unavailable token, a search with Dexscreener down, an RWA token\'s facts, the RWA lists sorted and filtered, the bubble map cut)', !fdrift.length && R.unavailable.unavailable === true && typeof R.searchDown.why === 'string',
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
        // the RWA routes (the suite's server reads no vendor, so it holds no RWA yet): the contract's keys and the not-affiliated note;
        // one token's facts a 404 that says which evidence is missing — never a 200 of blanks
        const c4 = await shape('/api/market/rwa', ['at', 'chain', 'view', 'sort', 'dir', 'kind', 'issuer', 'total', 'rows', 'issuers', 'totals', 'reads', 'definitions', 'notes', 'sources']);
        let c5 = null; try { const x = await fetch(BASE + '/api/market/rwa/token?address=' + TSLA); c5 = { s: x.status, b: await x.json().catch(() => null) }; } catch {}
        check('  ...and /api/market/rwa with the contract\'s keys (its notes saying it is not affiliated with Robinhood and not advice; a read not made yet says so), and /api/market/rwa/token a 404 that says why when it holds nothing on the token',
          c4.ok && (c4.s !== 200 || (c4.b.notes.some((n) => /^Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\./.test(n)) && c4.b.notes.includes('Not advice, never a tip to buy. Do your own research.') && Object.values(c4.b.reads).every((r) => r.ok || typeof r.why === 'string')))
          && c5 && ((c5.s === 404 && c5.b && c5.b.notRwa === true && typeof c5.b.why === 'string' && c5.b.why.length > 10) || (c5.s === 200 && c5.b && c5.b.address === TSLA)), c4.s + ' ' + JSON.stringify(c4.b).slice(0, 160) + ' | ' + JSON.stringify(c5).slice(0, 200));
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
