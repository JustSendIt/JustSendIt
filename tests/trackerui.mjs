/* The wallet report's pure helpers (tracker.js) and the chart's summary builder (walletchart.js), run in a bare vm on a
   fabricated history — the kinds, the newest-first order, the native valuation, the held step function, net invested
   over the charted tokens, the ranking, the CSV guard — plus the static pins that keep the dashboard honest and
   accessible (no cut words, hierarchy above the text floor, a description on every control, roles on every table,
   the "today's ETH price" wording verbatim, no percent or arrow on the holdings series). No server. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const SRC = read('tracker.js'), WC = read('walletchart.js'), CSS = read('trackerdash.css');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const near = (a, b, eps = 1e-9) => a != null && b != null && Math.abs(a - b) <= eps;

/* ═══ the fabricated history ═══ */
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73', USDG = '0x' + 'ab'.repeat(20);
const ME = '0x' + '11'.repeat(20), OTHER = '0x' + '22'.repeat(20), PAIR = '0x' + '33'.repeat(20), PAIR2 = '0x' + '44'.repeat(20);
const FOO = '0x' + 'f0'.repeat(20), BAR = '0x' + 'ba'.repeat(20), BAZ = '0x' + 'bb'.repeat(20);
const ZERO = '0x' + '00'.repeat(20), DEAD = '0x' + '00'.repeat(18) + 'dead';
const hx = (n) => '0x' + String(n).padStart(64, '0');
const e18 = (n) => (BigInt(n) * 10n ** 18n).toString(), e6 = (n) => (BigInt(n) * 10n ** 6n).toString();
const T0 = Date.UTC(2026, 8, 1);
const T = (block) => T0 + block * 60e3;
/* newest first, like the server sends them: [block, logIndex, txHash, token, from, to, amountStr, timeMs] */
const transfers = [
  [1100, 1, hx(11), FOO, PAIR, ME, e18(7), T(1100)],        // a buy whose cost cannot be split (unvalued bit 1)
  [1000, 1, hx(10), FOO, OTHER, ME, e18(20), T(1000)],      // a plain transfer in
  [900, 1, hx(9), FOO, ME, ME, e18(5), T(900)],             // a self-transfer
  [800, 2, hx(8), BAR, ME, OTHER, e6(10), T(800)],          // mixed: one out…
  [800, 1, hx(8), FOO, OTHER, ME, e18(10), T(800)],         //   …and one in
  [700, 1, hx(7), BAR, ME, DEAD, e6(50), T(700)],           // a burn
  [600, 1, hx(6), BAZ, ZERO, ME, '12345', T(600)],          // a mint of a token with unknown decimals
  [500, 1, hx(5), BAR, ME, OTHER, e6(100), T(500)],         // a plain transfer out
  [400, 1, hx(4), FOO, PAIR, ME, e18(50), null],            // a swap in someone else's transaction paid the wallet (no timestamp)
  [300, 2, hx(3), BAR, PAIR2, ME, e6(500), T(300)],         // a swap: FOO → BAR
  [300, 1, hx(3), FOO, ME, PAIR, e18(100), T(300)],
  [200, 1, hx(2), FOO, ME, PAIR, e18(400), T(200)],         // a sell
  [100, 2, hx(1), FOO, PAIR, ME, e18(1000), T(100)],        // a buy
  [100, 1, hx(1), WETH, ME, PAIR, '50000000000000000', T(100)],
];
const txs = {
  [hx(1)]: { [FOO]: [1, '50000000000000000', '0', 0, '0', '0', 0, 0] },
  [hx(2)]: { [FOO]: [0, '0', '0', 1, '30000000000000000', '0', 0, 0] },
  [hx(3)]: { [FOO]: [0, '0', '0', 1, '10000000000000000', '0', 0, 0], [BAR]: [1, '10000000000000000', '0', 0, '0', '0', 0, 0] },
  [hx(4)]: { [FOO]: [2, '999', '0', 0, '0', '0', 0, 0] },
  [hx(11)]: { [FOO]: [1, '0', '0', 0, '0', '0', 0, 1] },
};
const H = {
  address: ME, head: 1500, readAt: Date.now(), complete: true, isContract: false, delegated: false,
  ethBalance: '12300000000000000', txSent: 42, nftTransfers: 3, ethUsd: 4000,
  quotes: { [WETH]: { symbol: 'WETH', decimals: 18 }, [USDG]: { symbol: 'USDG', decimals: 6 } },
  tokens: [
    { address: FOO, symbol: 'FOO', name: 'Foo Token', decimals: 18, balance: e18(1000 - 400 - 100 + 50 + 10 + 20 + 7), market: true },
    { address: BAR, symbol: 'BAR', name: 'Bar', decimals: 6, balance: e6(500 - 100 - 50 - 10), market: true },
    { address: BAZ, symbol: 'BAZ', name: 'Baz', decimals: null, balance: '12345', market: false },
    { address: WETH, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, balance: '0', market: true },
  ],
  transfers, txs, legsRead: 5, legsCapped: false, legsFrom: [100, 1], txsMissing: [], marketsKnown: true,
};
const PRICES = {
  [WETH]: { pairAddress: '0x' + '55'.repeat(20), baseToken: { address: WETH, symbol: 'WETH' }, quoteToken: { address: USDG, symbol: 'USDG' }, priceUsd: '4000', priceNative: '4000' },
  [FOO]: { pairAddress: PAIR, baseToken: { address: FOO, symbol: 'FOO' }, quoteToken: { address: WETH, symbol: 'WETH' }, priceUsd: '0.01', priceNative: '0.0000025', source: 'reserves', labels: ['v2'] },
  [BAR]: { pairAddress: PAIR2, baseToken: { address: BAR, symbol: 'BAR' }, quoteToken: { address: USDG, symbol: 'USDG' }, priceUsd: '2', priceNative: '2' },
};

function context(history, prices) {
  return vm.createContext({
    console, BigInt, Number, Math, Date, JSON, Object, Array, Promise, Error, Set, Map, URLSearchParams, encodeURIComponent, setTimeout, Intl,
    WETH: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    toNum: (bi, d = 18) => Number(bi) / 10 ** d,
    fetch: async () => ({ status: 200, headers: { get: () => null }, json: async () => history }),
    dexPricesFor: async () => prices,
  });
}

try {
  check('trackerReport and renderTracker keep their signatures', /async function trackerReport\(addr, onProgress, opts\)/.test(SRC) && /function renderTracker\(zone, r, prefs\)/.test(SRC));
  check('nothing at the top level of tracker.js touches window or document (tests and profile.js both load it bare)', !/^(window|document)\./m.test(SRC) && /if \(typeof window !== 'undefined'\) window\.TRK/.test(SRC));

  /* ═══ 1. the report, end to end, on the fabricated history ═══ */
  const ctx = context(H, PRICES);
  vm.runInContext(SRC, ctx);
  const progress = [];
  const rep = await ctx.trackerReport(ME, (m, info) => progress.push([m, info]));
  check('onProgress gets the string first and a structured second argument with a stage', progress.length > 0 && progress.every(([m, i]) => typeof m === 'string' && i && typeof i.stage === 'string'), JSON.stringify(progress[0]));
  const A = rep.activity;
  check('activity: one row per transaction that moved a token, newest first', Array.isArray(A) && A.length === 11 && A.every((a, i) => i === 0 || A[i - 1].block >= a.block), A && A.map(a => a.block).join(','));
  const byHash = Object.fromEntries((A || []).map(a => [a.hash, a]));
  const kinds = [[1, 'buy'], [2, 'sell'], [3, 'swap'], [4, 'in'], [5, 'out'], [6, 'mint'], [7, 'burn'], [8, 'mixed'], [9, 'self'], [10, 'in'], [11, 'buy']];
  check('kinds: buy / sell / swap / in / out / mint / burn / mixed / self / in / buy', kinds.every(([n, k]) => byHash[hx(n)] && byHash[hx(n)].kind === k), kinds.map(([n]) => byHash[hx(n)] && byHash[hx(n)].kind).join(','));
  check('  ...a swap in someone else\'s transaction is "in" with viaOthers, and carries no paid figure of its own', byHash[hx(4)].viaOthers === true && byHash[hx(4)].wethPaid == null && byHash[hx(10)].viaOthers === false);
  check('  ...the self-transfer is marked and excluded from the listed count', byHash[hx(9)].self === true && rep.txCounts.listed === 10);
  check('native valuation: the buy paid 0.05 ETH, the sell got 0.03 ETH, the swap both', near(byHash[hx(1)].wethPaid, 0.05) && near(byHash[hx(2)].wethGot, 0.03) && near(byHash[hx(3)].wethPaid, 0.01) && near(byHash[hx(3)].wethGot, 0.01) && byHash[hx(1)].usdgPaid === 0);
  check('  ...a buy whose cost cannot be split is unvalued, with no number invented', byHash[hx(11)].unvalued === true && byHash[hx(11)].wethPaid == null);
  check('legs: direction, symbol, quantity; the buy shows the token in and the WETH out', byHash[hx(1)].legs.some(l => l.token === FOO && l.dir === 'in' && near(l.qty, 1000)) && byHash[hx(1)].legs.some(l => l.token === WETH && l.dir === 'out' && l.cash === true && near(l.qty, 0.05)));
  check('  ...unknown decimals → qty null with the raw integer kept', byHash[hx(6)].legs[0].qty === null && byHash[hx(6)].legs[0].raw === '12345');
  check('  ...a transfer with no block time keeps ts null (the page says "block N")', byHash[hx(4)].ts === null);
  check('txCounts: the nonce, the listed count, the NFT count, the account kind', rep.txCounts.sent === 42 && rep.txCounts.nft === 3 && rep.txCounts.isContract === false && rep.txCounts.delegated === false, JSON.stringify(rep.txCounts));

  const S = rep.series;
  const foo = S && S.tokens.find(t => t.address === FOO), bar = S && S.tokens.find(t => t.address === BAR);
  check('series: FOO and BAR are charted (a pool, known decimals, something to value); BAZ is not (unknown decimals)', foo && bar && S.tokens.length === 2 && S.notCharted.some(x => x.symbol === 'BAZ' && /decimals/.test(x.why)), JSON.stringify(S && S.notCharted));
  check('  ...ranked by max(value, ETH spent × ETH price): BAR ($680 held) before FOO ($200 spent)', S.tokens[0].address === BAR && S.tokens[1].address === FOO);
  const heldExp = [[100, 1000], [200, 600], [300, 500], [400, 550], [800, 560], [1000, 580], [1100, 587]];
  check('  ...held is a step function of block, oldest first, the self-transfer excluded', foo && JSON.stringify(foo.held) === JSON.stringify(heldExp), foo && JSON.stringify(foo.held));
  check('  ...and reconciles against the live balance', foo && foo.reconciles === true && bar && bar.reconciles === true);
  check('  ...with the pool, quote, source and live price beside it', foo.pair === PAIR && foo.quote === 'WETH' && foo.source === 'reserves' && near(foo.priceUsd, 0.01) && bar.quote === 'USDG' && near(bar.heldNow, 340));
  check('  ...net invested to date is cumulative over the charted tokens, valued trades only', JSON.stringify(S.invested.map(([b, e]) => [b, Math.round(e * 1e6) / 1e6])) === JSON.stringify([[100, 0.05], [200, 0.02], [300, 0.02]]), JSON.stringify(S.invested));
  check('  ...and counts the unvalued trade it had to leave out', S.investedUnvalued === 1 && foo.investUnvalued === 1);
  check('  ...first and last block are the wallet\'s first transfer and the head', S.firstBlock === 100 && S.lastBlock === 1500);
  check('the usual figures still come out (FOO holding, buys counted once per transaction, ETH spent known)', (() => { const t = rep.tokens.find(x => x.address === FOO); return t && near(t.held, 587) && t.buys === 2 && near(t.ethSpent, 0.05) && t.priceSource === 'reserves'; })());
  check('  ...a reserves-priced token is counted for the method note', rep.reservesPriced === 1);

  // a wallet whose transfers do not add up: the token is in the series with reconciles false (never charted as exact)
  const H2 = JSON.parse(JSON.stringify(H)); H2.tokens[0].balance = e18(900);
  const ctx2 = context(H2, PRICES); vm.runInContext(SRC, ctx2);
  const rep2 = await ctx2.trackerReport(ME, () => {});
  check('a balance the transfers do not add up to → reconciles:false', rep2.series.tokens.find(t => t.address === FOO).reconciles === false);
  check('  ...with a numeric heldNow, so the chart words it as a mismatch', rep2.series.tokens.find(t => t.address === FOO).heldNow != null);

  // a balance that could not be read: in the series with reconciles false AND heldNow null (the chart words that as unread, never as a mismatch)
  const H4 = JSON.parse(JSON.stringify(H)); H4.tokens[0].balance = null;
  const ctx4 = context(H4, PRICES); vm.runInContext(SRC, ctx4);
  const rep4 = await ctx4.trackerReport(ME, () => {});
  const foo4 = rep4.series.tokens.find(t => t.address === FOO);
  check('an unread balance → reconciles:false with heldNow null (the chart names it "could not be read"), and one more balance counted unread', foo4 && foo4.reconciles === false && foo4.heldNow === null && rep4.balancesUnread === rep.balancesUnread + 1, JSON.stringify(foo4 && { reconciles: foo4.reconciles, heldNow: foo4.heldNow, unread: rep4.balancesUnread, base: rep.balancesUnread }));

  // the ranking cap: 10 pooled tokens → 8 charted, 2 named "not in the top 8"
  const many = Array.from({ length: 10 }, (_, i) => ({ address: '0x' + String(i + 1).padStart(40, '0'), symbol: 'T' + i, name: 'T' + i, decimals: 18, balance: e18(100), market: true }));
  const H3 = { ...H, tokens: many.concat([{ address: WETH, symbol: 'WETH', name: 'W', decimals: 18, balance: '0', market: true }]), transfers: many.map((t, i) => [10 + i, 1, hx(50 + i), t.address, OTHER, ME, e18(100), T(10 + i)]), txs: {} };
  const P3 = {}; many.forEach((t, i) => { P3[t.address] = { pairAddress: '0x' + String(100 + i).padStart(40, '0'), baseToken: { address: t.address }, quoteToken: { address: WETH, symbol: 'WETH' }, priceUsd: String(i + 1), priceNative: String((i + 1) / 4000) }; });
  P3[WETH] = PRICES[WETH];
  const ctx3 = context(H3, P3); vm.runInContext(SRC, ctx3);
  const rep3 = await ctx3.trackerReport(ME, () => {});
  check('at most 8 tokens are charted, the most valuable first, the rest named as not charted', rep3.series.tokens.length === 8 && rep3.series.tokens[0].symbol === 'T9' && rep3.series.notCharted.filter(x => /top 8/.test(x.why)).length === 2, JSON.stringify(rep3.series.notCharted));

  /* ═══ 2. the CSV guard ═══ */
  const csv = ctx.csvFrom([{ hash: '0xh1', block: 5, ts: T0, kind: 'buy', viaOthers: false, self: false, unvalued: false, wethPaid: 0.05, usdgPaid: 0, wethGot: null, usdgGot: null,
    legs: [{ token: '0xt1', symbol: '=1+1', decimals: 18, qty: 5, raw: '5', dir: 'in', cash: false }, { token: '0xt2', symbol: '+1', decimals: 18, qty: 1.5, raw: '1', dir: 'out', cash: false }, { token: '0xt3', symbol: 'a,b"c', decimals: 18, qty: 2, raw: '2', dir: 'out', cash: false }, { token: '0xt4', symbol: '-x', decimals: null, qty: null, raw: '77', dir: 'in', cash: false }] }], 'https://exp');
  const lines = csv.split('\r\n').filter(Boolean);
  check('CSV: a header and one row per leg', lines.length === 5 && lines[0] === 'time,hash,type,token,symbol,direction,amount,wethPaid,usdgPaid,wethGot,usdgGot,explorerUrl', lines[0]);
  check('  ...a symbol that starts with = or + or - comes out with a leading apostrophe inside quotes', /,"'=1\+1",/.test(lines[1]) && /,"'\+1",/.test(lines[2]) && /,"'-x",/.test(lines[4]), lines[1]);
  check('  ...commas and quotes are quoted and doubled', /,"a,b""c",/.test(lines[3]));
  check('  ...amounts are unsigned numbers with the direction in its own column', /,"in",5,/.test(lines[1]) && /,"out",1\.5,/.test(lines[2]) && !/,-1\.5,/.test(csv));
  check('  ...an unread amount is not a number', /,"raw:77",/.test(lines[4]));
  check('  ...the time is ISO and the explorer link is the tx', lines[1].startsWith('"2026-09-01T00:00:00.000Z","0xh1","buy"') && /"https:\/\/exp\/tx\/0xh1"$/.test(lines[1]));

  /* ═══ 3. the money formatter ═══ */
  check('money: 0 decimals at ≥ $1,000, 2 below, up to 4 below $1, a real minus sign', ctx.trkUsd(1234.5) === '$1,235' && ctx.trkUsd(12.345) === '$12.35' && ctx.trkUsd(0.0123) === '$0.0123' && ctx.trkUsd(0.5) === '$0.50' && ctx.trkUsd(-5) === '−$5.00' && ctx.trkUsd(null) === '—', [ctx.trkUsd(1234.5), ctx.trkUsd(12.345), ctx.trkUsd(0.0123), ctx.trkUsd(-5)].join(' '));
  check('a price keeps enough figures to mean something, without a tail of zeros', ctx.trkPrice(0.000108) === '$0.000108' && ctx.trkPrice(0.01) === '$0.01' && ctx.trkPrice(0.5) === '$0.50' && ctx.trkPrice(2.5) === '$2.5' && ctx.trkPrice(null) === '—', [ctx.trkPrice(0.000108), ctx.trkPrice(0.01), ctx.trkPrice(0.5)].join(' '));

  /* ═══ 4. the rendered DOM contract (a fake zone; the markup is a string) ═══ */
  const fakeZone = () => ({ innerHTML: '', _trk: null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, contains: () => false });
  const z = fakeZone();
  ctx.renderTracker(z, rep, { usd: true });
  const D = z.innerHTML;
  check('the dashboard root, the option bar, the KPI section and the facts', /<div class="trk-dash">/.test(D) && /class="trk-bar" role="group" aria-label="Report options"/.test(D) && /<section class="trk-kpis" aria-label="Summary">/.test(D) && /class="hstat kpi kpi-main"/.test(D) && /<section class="trk-facts" aria-label="Wallet facts">/.test(D));
  check('  ...every option toggle carries aria-pressed, a data-tip and a stable key', ['hideDust', 'showHoldings', 'showChart', 'showTxs', 'showActivity', 'usd'].every(k => new RegExp('data-trk-toggle="' + k + '" data-trk-key="toggle:' + k + '" aria-pressed="(true|false)"').test(D)));
  check('  ...the KPI label names its unit and the value has a sign and an arrow, never colour alone', /Portfolio value <span class="unit">\(USD\)<\/span>/.test(D) && /class="val (pos|neg)">[▲▼] [+−]\$/.test(D));
  check('  ...without walletchart.js the chart section is one line pointing at the tracker page', /Chart available on the Wallet Tracker page →/.test(D) && !/data-wc-host/.test(D));
  check('the holdings table: roles, the ETH row first, the column classes that fold, a details button per token', /<table class="trk-htable" role="table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Token<\/th>/.test(D) && /<tbody role="rowgroup"><tr role="row" class="trk-hrow trk-hrow-eth">/.test(D) && /class="num c-price"/.test(D) && /class="num c-share"/.test(D) && /class="num c-avg"/.test(D) && new RegExp('data-trk-more="' + FOO + '" data-trk-key="more:' + FOO + '" aria-expanded="false" aria-controls="[^"]+" aria-label="Details, \\$FOO"').test(D));
  check('  ...the price says where it came from, and the column definitions sit beside the heading (one ⓘ, none in a <th>)', /\$0\.01 <span class="t-src">· pool<\/span>/.test(D) && /<div class="trk-h-row"><h3 [^>]*class="trk-h">Holdings &amp; PNL by token<\/h3><button class="trk-defs-btn"/.test(D) && !/<th[^>]*>[^<]*ⓘ/.test(D));
  check('the transactions section: filters, the token select, the count line, the table roles, 44px tx links, the two buttons', /<section class="trk-activity"/.test(D) && /data-act-filter="all" data-trk-key="act:all" aria-pressed="true"/.test(D) && /<select id="[^"]+" data-tip="[^"]+" data-act-token data-trk-key="act:token">/.test(D) && /<p class="trk-act-count">Showing 11 of 11<\/p>/.test(D) && /<table class="trk-atable" role="table">/.test(D) && /class="a-tx" href="https:\/\/robinhoodchain\.blockscout\.com\/tx\/0x0/.test(D) && /data-act-csv data-trk-key="act:csv"/.test(D) && !/data-act-more/.test(D));
  check('  ...the type chip hides its emoji from screen readers and names the via-others case', /<span aria-hidden="true">🟢<\/span> Buy</.test(D) && /Transfer in \(from a swap in someone else’s transaction\)/.test(D) && /Self-transfer/.test(D));
  check('  ...what moved reads natively: "paid 0.05 ETH", "got 0.03 ETH", a swap through the pools, "not valued"', /<div class="a-val">paid 0\.05 ETH<\/div>/.test(D) && /<div class="a-val">got 0\.03 ETH<\/div>/.test(D) && /swapped −\$FOO → \+\$BAR \(0\.01 ETH through the pools\)/.test(D) && /<div class="a-val">not valued<\/div>/.test(D));
  check('  ...an unread amount shows its raw integer in <code>, and a row with no block time says "block N"', /amount unread \(unknown decimals\), raw <code>12345<\/code>/.test(D) && /<span class="a-date">block 400<\/span>/.test(D));
  check('  ...the transactions note, verbatim', /42 transactions sent by this wallet \(its nonce\) · 10 transactions moved a token to or from it, whoever sent them — those are listed\. Plain ETH transfers and contract calls that move no token leave no log on the chain and are not listed\. 3 NFT transfers counted, not listed\./.test(D));
  check('the method note names the reserves-priced token count', /· 1 price from the pool’s own reserves/.test(D));
  // paging: 60 rows → 50 shown and a "Show 50 more"
  const big = { ...rep, activity: Array.from({ length: 60 }, (_, i) => ({ ...rep.activity[0], hash: hx(200 + i), block: 2000 + i })) };
  const z2 = fakeZone(); ctx.renderTracker(z2, big, { usd: true });
  check('paging: 50 rows a page, a "Show 50 more" button, the count line says so', (z2.innerHTML.match(/class="trk-arow /g) || []).length === 50 && /Showing 50 of 60/.test(z2.innerHTML) && /data-act-more data-trk-key="act:more">Show 50 more</.test(z2.innerHTML));
  z2._trk.actPages = 2; ctx.renderTracker(z2, big, { usd: true });
  check('  ...the next page shows the rest', (z2.innerHTML.match(/class="trk-arow /g) || []).length === 60 && /Showing 60 of 60/.test(z2.innerHTML) && !/data-act-more/.test(z2.innerHTML));
  z2._trk.actKinds = new Set(['sell']); ctx.renderTracker(z2, rep, { usd: true });
  check('  ...a filter narrows the list from the zone\'s own state', /Showing 2 of 2/.test(z2.innerHTML) && /data-act-filter="sell" data-trk-key="act:sell" aria-pressed="true"/.test(z2.innerHTML) && /data-act-filter="all" data-trk-key="act:all" aria-pressed="false"/.test(z2.innerHTML));
  /* owner, 2026-10-22: "filter transactions by transfers in, transfers out, buys, sells, and other" — the five, in that
     order after All, each with how many it holds; any number on at once; a swap is in Buys and in Sells */
  const order = ['all', 'in', 'out', 'buy', 'sell', 'other'].map(k => D.indexOf('data-act-filter="' + k + '"'));
  check('the filters: All, then Transfers in, Transfers out, Buys, Sells, Other — each with its count (a swap in both Buys and Sells)',
    order.every((p, i) => p > 0 && (i === 0 || p > order[i - 1]))
    && [['in', 'Transfers in', 3], ['out', 'Transfers out', 2], ['buy', 'Buys', 3], ['sell', 'Sells', 2], ['other', 'Other', 2]].every(([k, lbl, n]) => new RegExp('data-act-filter="' + k + '" data-trk-key="act:' + k + '" aria-pressed="false">' + lbl + ' <span class="trk-act-n"><span class="sr-only">\\(</span>' + n + '<span class="sr-only"> transactions\\)</span></span></button>').test(D)),
    order.join(','));
  z2._trk.actKinds = new Set(['buy', 'in']); ctx.renderTracker(z2, rep, { usd: true });
  check('  ...several at once show what is in ANY of them (buys and transfers in: 6 of the 11), each chip pressed with its ✓', /Showing 6 of 6/.test(z2.innerHTML)
    && /aria-pressed="true">✓ Transfers in </.test(z2.innerHTML) && /aria-pressed="true">✓ Buys </.test(z2.innerHTML) && /aria-pressed="false">Sells </.test(z2.innerHTML));
  check('  ...the CSV takes what the filters and the token choice show; a transfer is named so in it', ctx.trkActShown(rep, { actKinds: new Set(['other']), actToken: '' }).length === 2
    && ctx.trkActShown(rep, { actKinds: new Set(), actToken: '' }).length === 11 && /,"transfer in",/.test(ctx.csvFrom(rep.activity.filter(a => a.kind === 'in'))));
  // each tip says what its click does from where the reader is
  const tipOf = (html, k) => (new RegExp('data-tip="([^"]*)" type="button" data-act-filter="' + k + '"').exec(html) || [])[1];
  check('  ...each chip\'s tip says what its click does from here: narrow to it, add it, take it out, or (the last one) show every type again',
    /^Shows only buys/.test(tipOf(D, 'buy')) && /^Also includes tokens sent/.test(tipOf(z2.innerHTML, 'out')) && /^Stops including buys.*\(swaps stay while Sells is on\)$/.test((() => { const z6 = fakeZone(); z6._trk = null; ctx.renderTracker(z6, rep, { usd: true }); z6._trk.actKinds = new Set(['buy', 'sell']); ctx.renderTracker(z6, rep, { usd: true }); return tipOf(z6.innerHTML, 'buy'); })())
    && /^Turns this filter off and shows every type again$/.test((() => { const z7 = fakeZone(); ctx.renderTracker(z7, rep, { usd: true }); z7._trk.actKinds = new Set(['other']); ctx.renderTracker(z7, rep, { usd: true }); return tipOf(z7.innerHTML, 'other'); })()),
    [tipOf(D, 'buy'), tipOf(z2.innerHTML, 'out')].join(' / '));
  // the ETH mode
  const z3 = fakeZone(); ctx.renderTracker(z3, rep, { usd: false });
  check('ETH mode: the unit changes in the label and the USDG conversion is stated', /Portfolio value <span class="unit">\(ETH\)<\/span>/.test(z3.innerHTML) && /USDG-quoted pools and USDG legs converted at today’s ETH price/.test(z3.innerHTML));
  // a saved report from before this build
  const old = { ...rep }; delete old.activity; delete old.series; delete old.txCounts;
  const z4 = fakeZone(); ctx.renderTracker(z4, old, { usd: true });
  check('a saved report without the new fields degrades honestly (no invented list)', /predates the transactions list/.test(z4.innerHTML) && !/trk-atable/.test(z4.innerHTML));
  // with walletchart.js present, the host is emitted and mounted
  const ctxW = context(H, PRICES); ctxW.window = { mountWalletChart: () => { ctxW.window._mounted = true; } }; vm.runInContext(SRC, ctxW);
  const z5 = { ...fakeZone(), querySelector: (s) => s === '[data-wc-host]' ? { _trkState: null } : null };
  ctxW.renderTracker(z5, rep, { usd: true });
  check('with walletchart.js loaded the chart host is emitted inside its section and mounted', /<section class="trk-chart" aria-labelledby="[^"]+"><div class="trk-h-row"><h3 [^>]*class="trk-h">Value over time<\/h3><\/div><div class="wc" data-wc-host><\/div><\/section>/.test(z5.innerHTML) && ctxW.window._mounted === true);

  /* ═══ 5. the chart's text, from the module itself ═══ */
  const wctx = vm.createContext({ window: {}, console, Math, Number, Date, JSON, Map, Set, Promise, Intl, String, Array, Object, isFinite, parseFloat, setTimeout });
  vm.runInContext(WC, wctx);
  const help = wctx.window.mountWalletChart && wctx.window.mountWalletChart.helpers;
  check('walletchart.js loads in a bare context and exposes mountWalletChart', typeof wctx.window.mountWalletChart === 'function' && !!help);
  const sums = help ? [help.summaryText(100, 50, T0, 0.5, true, false, false), help.summaryText(0.5, 200, T0, -0.2, true, true, false), help.summaryText(100, 300, T0, 1, false, false, false), help.summaryText(null, 10, null, null, true, false, true)] : [];
  check('the summary never emits a percent, an arrow or a return for the holdings series', sums.length === 4 && sums.every(s => !/[%▲▼]/.test(s) && !/return\b(?! \))/.test(s.replace('not a return', ''))), sums[0]);
  const day0 = new Date(T0).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });   // the chart dates in the reader's own zone
  check('  ...and reads as specified: value on a date → value now, the change named for what it is, net invested, USD at today\'s ETH price', sums[0] === 'Holdings value: $100.00 on ' + day0 + ' → $50.00 now (change in value — includes buys, sells and transfers, not a return). Net invested to date: 0.5 ETH. USD at today\'s ETH price.', sums[0]);
  check('  ...under a dollar it says "from under $1", never a percent of nothing; partial is said', /^Holdings value: from under \$1 on /.test(sums[1]) && /Partial:/.test(sums[1]) && /−0\.2 ETH/.test(sums[1]), sums[1]);
  check('  ...ETH mode states the USDG conversion', /USDG-quoted pools and USDG legs converted at today's ETH price\./.test(sums[2]), sums[2]);
  check('  ...an unvalued start is "not valued", not $0', /Holdings value: not valued on — → \$10\.00 now/.test(sums[3]), sums[3]);
  const WCs = WC.replace(/\\'/g, "'");
  check('the three "today\'s ETH price" strings — summary, caption, ETH-mode note — are in the source verbatim', WCs.includes("USD at today's ETH price.") && WCs.includes("Holdings value per bucket, USD at today's ETH price; net invested in ETH") && WCs.includes("USDG-quoted pools and USDG legs converted at today's ETH price"));
  check('the chart note says what the curve is and is not, verbatim', WCs.includes('Token holdings only — the ETH balance is not charted (plain ETH moves leave no log).') && WCs.includes("Prices are each pool's own on-chain reserves at every swap (its spot price, not what a sale would fetch);") && WCs.includes("Net invested = ETH the pools took for this wallet's own buys of the charted tokens − ETH they paid out for its sells (USDG legs at today's ETH price);") && WCs.includes('so the gap between the lines is not a profit figure.') && WCs.includes("Net invested in $ uses today's ETH price."));
  check('the chart\'s a11y: a radiogroup of radios, a slider reader, a hidden tooltip, the canvas as an image, forced colours watched', /role="radiogroup"/.test(WC) && /role="radio" aria-checked=/.test(WC) && /role="slider"/.test(WC) && /aria-valuetext=/.test(WC) && /role="tooltip" aria-hidden="true"/.test(WC) && /<canvas class="wc-canvas" role="img" aria-label=/.test(WC) && /matchMedia\('\(forced-colors: active\)'\)/.test(WC) && /ArrowLeft|ArrowRight/.test(WC) && /PageUp/.test(WC) && /'Home'/.test(WC) && /'Escape'/.test(WC));
  check('  ...the holdings line is the neutral --diamond, net invested dashed in --gold, the axis text sized from a floored probe', /tok\('--diamond'/.test(WC) && /tok\('--gold'/.test(WC) && /setLineDash\(\[6, 4\]\)/.test(WC) && /Math\.max\(12, Math\.round\(fs \* 0\.7\)\) \+ 'px ui-monospace, Menlo, monospace'/.test(WC) && /\.wc-probe \{[^}]*font-size: max\(var\(--text-floor\), 0\.8rem\)/.test(CSS));
  check('  ...fetches go to /api/chain/pricehist only, at most two in flight, cached per pair|token|from0|size, one abort per mount', (WC.match(/fetch\(/g) || []).length === 1 && /fetch\('\/api\/chain\/pricehist\?pair='/.test(WC) && /MAX_INFLIGHT = 2/.test(WC) && help && help.cacheKey('p', 't', 12345, 10000) === 'p|t|10000|10000' && /if \(current\) current\.abort\(\);/.test(WC) && !/dexscreener|blockscout\.com\/api/.test(WC));
  check('  ...the ranges map to the specified bucket sizes and spans', help && help.RANGES['7d'].size === 10000 && help.RANGES['7d'].span === 6050000 && help.RANGES['30d'].size === 50000 && help.RANGES['30d'].span === 25900000 && help.RANGES['90d'].size === 100000 && help.RANGES['90d'].span === 77800000 && help.RANGES.all.size === 500000 && help.RANGES.all.span === null);
  check('  ...the failure strings: no chart on unread balances, pools that could not be read, "not charted" reasons', /Balances could not be read — no chart/.test(WC) && /could not be read just now/.test(WC) && /no v2 price history/.test(WC) && /pool drained after/.test(WC) && /priced from/.test(WC) && /earlier holdings not valued/.test(WC));
  check('  ...the cadence is measured from the dated points, never assumed', help && help.cadence([{ ms: 0 }, { ms: 36e5 * 3 }, { ms: 36e5 * 6 }]) === '~3 hours' && help.cadence([{ ms: 0 }, { ms: 864e5 * 2 }]) === '~2 days' && help.cadence([{ ms: null }, { ms: 5 }]) === null);

  /* the integrated null path: compute() on a token held before its pool's first Sync (the server sends p:null there) */
  const PH = (b, p, extra) => Object.assign({ b, ms: T(b), p }, extra || {});
  const mkC = (points, held) => ({
    usd: true, ethUsd: 4000, notCharted: [], tokenNotes: [], charted: [], msg: '',
    report: { head: 2000100, readAt: T(2000100), series: { lastBlock: 2000100 } },
    tokens: [{ address: FOO, symbol: 'FOO', pair: PAIR, quote: 'WETH', reconciles: true, held, heldNow: 1000, priceUsd: 0.01, invest: [[1000, 0.05]], investUnvalued: 0 }],
    results: { [FOO]: { ok: true, data: { points, firstSync: { block: 2000050, ms: T(2000050) } } } },
  });
  const C1 = mkC([PH(100, null), PH(1000, null), PH(2000050, 2.5e-6), PH(2000100, 2.5e-6)], [[1000, 1000]]);
  help.compute(C1);
  const P1 = C1.points;
  check('compute(): a bucket where nothing was held is 0; one where the wallet held something no price covers is null (not valued), never 0; a priced bucket is held × price', P1.length === 4 && P1[0].value === 0 && P1[0].partial === false && P1[1].value === null && P1[1].partial === true && near(P1[2].value, 10) && near(P1[3].value, 10) && P1[3].live === true, JSON.stringify(P1.map(q => [q.value, q.partial])));
  check('  ...so the integrated summary reads "not valued" for that start, and the note says the token is priced from its first Sync', /^Holdings value: not valued on /.test(help.summaryText(P1[1].value, P1[3].value, P1[1].ms, P1[3].invested, true, P1.some(q => q.partial), false)) && C1.tokenNotes.some(n => /^\$FOO priced from .*; earlier holdings not valued$/.test(n)), C1.tokenNotes.join(' | '));
  const C2 = mkC([PH(2000050, 2.5e-6), PH(2000060, 2.5e-6), PH(2000070, null, { drained: true }), PH(2000100, null, { drained: true })], [[1000, 1000]]);
  help.compute(C2);
  check('a drained pool is a per-token note ("not charted after <date>") and the token stays charted — never in both lists', C2.charted.length === 1 && C2.notCharted.length === 0 && C2.tokenNotes.some(n => /^\$FOO not charted after .* \(pool drained after that Sync; later holdings not valued\)$/.test(n)), C2.tokenNotes.join(' | '));
  check('a not-valued point says so on every surface — the table cell, the slider text, the tip — and is a gap in the curve, never a point at 0', /q\.value == null \? 'not valued' : esc\(usd \? fmtUsd\(q\.value\)/.test(WC) && WCs.includes("holdings ' + (q.value == null ? 'not valued (no price for any of it)'") && WC.includes('Not valued — no charted token had a price yet.') && /if \(pts\[i\]\.value == null \|\| pts\[i - 1\]\.value == null\) continue;/.test(WC) && /if \(last\.value != null\) \{ ctx\.beginPath\(\); ctx\.arc/.test(WC) && /if \(q\.value == null\) \{ run = null; continue; \}/.test(WC));
  check('axis ticks are labelled with the value they sit on: USD keeps its cents below $1,000, ETH keeps the sign (no exponent form for a negative tick)', help.fmtAxis(5.4, true) === '$5.40' && help.fmtAxis(10.8, true) === '$10.80' && help.fmtAxis(10800, true) === '$10,800' && help.fmtAxis(0, true) === '$0.00' && help.fmtAxis(-0.19, false) === '−0.1900' && help.fmtAxis(0.148, false) === '0.1480' && help.fmtAxis(-2.5, false) === '−2.50' && help.fmtAxis(0, false) === '0', [help.fmtAxis(5.4, true), help.fmtAxis(10800, true), help.fmtAxis(-0.19, false)].join(' '));
  check('  ...and the gutters are measured from the labels at the axis font, never a fixed 66px; the rotated title sits inside the canvas edge', !/\? 66 : PAD\.r/.test(WC) && /const padL = Math\.max\(PAD\.l, widest\(i => fmtAxis\(vMax \* \(i \/ 4\), usd\)\) \+ 12\);/.test(WC) && /ctx\.measureText\(f\(i\)\)\.width/.test(WC) && /\+ fontPx \+ 12\) : PAD\.r;/.test(WC) && /if \(x < g\.padL - 4 \|\|/.test(WC) && /ctx\.translate\(W - 2 - fontPx \/ 2,/.test(WC) && /C\.geo = \{ W, H, padL, padR, padB, px: pxR/.test(WC));
  check('  ...and the bottom gutter follows the axis font too (the tick row and the footer line were cut at the 18px floor font): the crosshair and the plot read it from the geometry', /const padB = Math\.round\(fontPx \* 2\.4 \+ 8\);/.test(WC) && /g\.H - g\.padB/.test(WC) && /ctx\.fillText\(foot, padL, H - 3\)/.test(WC) && !/H - PAD\.b \+ 5/.test(WC));
  check('an unread balance is named as unread, not as transfers that do not add up', /why: t\.heldNow == null \? 'its balance could not be read' : 'its transfers do not add up to its live balance'/.test(WC));
  check('the empty-chart message is settled before the summary is derived from it (canvas, aria-label and summary agree; the loading text never outlives the load)', WC.indexOf("if (pts.length < 2 && !provisional) C.msg = C.charted.length ? 'Nothing to chart in this range") > 0 && WC.indexOf("if (pts.length < 2 && !provisional) C.msg =") < WC.indexOf("const summary = pts.length < 2 ? (C.msg ||") && /busy\.length \? 'No pool could be read just now — nothing to chart\.' : 'No token with a v2 pool to chart\.'/.test(WC));
  check('the range radios: one Tab stop (roving tabindex) and a ✓ on the checked one, kept in step by the click handler', /role="radio" aria-checked="' \+ on \+ '" tabindex="' \+ \(on \? 0 : -1\) \+ '"/.test(WC) && /\(on \? '✓ ' : ''\) \+ esc\(RANGES\[k\]\.label\)/.test(WC) && /b\.tabIndex = on \? 0 : -1; b\.textContent = \(on \? '✓ ' : ''\) \+ RANGES\[b\.dataset\.wcRange\]\.label;/.test(WC));
  for (let i = 0; i < 100; i++) help.remember(help.cacheKey('p', 't', i * 10000, 10000), { ok: true, i });
  check('the price-history cache is bounded: 100 distinct keys keep the newest 96, the oldest are evicted (from0 moves with head, so a stale key never recurs)', help.cached('p', 't', 0, 10000) === null && help.cached('p', 't', 3 * 10000, 10000) === null && help.cached('p', 't', 4 * 10000, 10000) !== null && help.cached('p', 't', 99 * 10000, 10000).i === 99 && /CACHE_MAX = 96/.test(WC) && !/CACHE\.set\(cacheKey/.test(WC));

  /* ═══ 6. static pins on the markup and the stylesheet ═══ */
  const decomment = (s) => s.replace(/(^|\s)\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  const untipped = [];
  for (const [name, src] of [['tracker.js', SRC], ['walletchart.js', WC]]) for (const m of decomment(src).matchAll(/<(button|select)\b([^>]*)>/g)) if (!/\bdata-tip=/.test(m[2])) untipped.push(name + ': ' + m[0].slice(0, 60));
  check('every <button> and <select> the report builds carries a data-tip', untipped.length === 0, untipped.join(' | '));
  check('emoji chips are hidden from screen readers (the word beside them is the label)', /<span aria-hidden="true">' \+ K\[0\] \+ '<\/span>/.test(SRC) && /buy: '<span aria-hidden="true">🟢<\/span> Buy'/.test(SRC) && !/<span aria-hidden="true">🟢<\/span>' \+ '<\/td>/.test(SRC));
  check('every table the report builds carries role="table", rows role="row", cells role="cell"', ['trk-htable', 'trk-atable', 'trk-table'].every(c => new RegExp('<table class="' + c + '" role="table">').test(SRC)) && /<table class="wc-tbl" role="table">/.test(WC) && (SRC.match(/<tr role="row"/g) || []).length >= 6 && (SRC.match(/<td role="cell"/g) || []).length >= 12 && /<tr role="row"><td role="cell">/.test(WC));
  check('every control carries a stable data-trk-key for keep-place and focus restore', /data-trk-key="toggle:' \+ key/.test(SRC) && /data-trk-key="more:' \+ trkEsc\(t\.address\)/.test(SRC) && /data-trk-key="act:' \+ k/.test(SRC) && /data-trk-key="act:token"/.test(SRC) && /data-trk-key="act:more"/.test(SRC) && /data-trk-key="act:csv"/.test(SRC) && /data-trk-key="wc:' \+ k/.test(WC) && /data-trk-key="wc:slider"/.test(WC));
  check('  ...and the renderer restores focus by key and the scroll anchor by the offset delta', /zone\._trk/.test(SRC) && /getBoundingClientRect\(\)\.top/.test(SRC) && /window\.scrollBy\(0, d\)/.test(SRC) && /openToks: new Set\(\)/.test(SRC));
  const symRules = [...CSS.matchAll(/\.trk-dash[^{}]*\.t-sym[^{}]*\{([^}]*)\}/g)].map(m => m[1]);
  check('no word is cut: .t-sym under .trk-dash has no ellipsis and no nowrap, symbols and names wrap anywhere', symRules.length > 0 && symRules.every(r => !/ellipsis|nowrap/.test(r)) && /\.trk-dash \.t-sym \{[^}]*overflow-wrap: anywhere/.test(CSS) && /\.trk-dash code \{[^}]*word-break: break-all/.test(CSS), symRules.join(' | '));
  check('hierarchy sits ABOVE the floor: KPI values 1.55rem, the main KPI 2rem, section headings 1.4rem, fact values 1.25rem', /\.trk-dash \.kpi \.val \{ font-size: max\(var\(--text-floor\), 1\.55rem\); \}/.test(CSS) && /\.trk-dash \.kpi-main \.val \{ font-size: max\(var\(--text-floor\), 2rem\); \}/.test(CSS) && /\.trk-dash \.trk-h \{[^}]*font-size: max\(var\(--text-floor\), 1\.4rem\)/.test(CSS) && /\.trk-dash \.trk-facts \.val \{ font-size: max\(var\(--text-floor\), 1\.25rem\)/.test(CSS));
  const loose = [...CSS.matchAll(/font-size\s*:\s*([^;}]+)/g)].map(m => m[1].trim()).filter(v => !v.startsWith('max(var(--text-floor)'));
  check('  ...every font-size in trackerdash.css is wrapped in the floor, and no CSS comment says the shorthand', loose.length === 0 && !/\/\*[^*]*font:/.test(CSS), loose.join(' | '));
  check('labels are sentence case at weight 600 in the dim colour — no uppercase, no letter-spacing at the floor', /\.trk-dash \.hstat \.lbl \{[^}]*font-weight: 600; text-transform: none; letter-spacing: 0; color: var\(--text-dim\)/.test(CSS));
  check('numbers are tabular and right-aligned, on one line in a table cell; a KPI value wraps rather than clip (a 7-figure PNL in a third-width tile was painted over by the next tile)', /\.trk-dash \.num, \.trk-dash \.val[^{]*\{ font-variant-numeric: tabular-nums; \}/.test(CSS) && /\.trk-dash th\.num, \.trk-dash td\.num \{ text-align: right; \}/.test(CSS) && /\.trk-dash td\.num \{ white-space: nowrap; \}/.test(CSS) && !/\.trk-dash \.hstat \.val \{[^}]*white-space: nowrap/.test(CSS) && /\.trk-dash \.hstat \.val \{[^}]*overflow-wrap: anywhere/.test(CSS));
  check('the chart card never widens its column: the .wc grid track is minmax(0, 1fr) and the note (where symbols are printed) wraps anywhere', /\.trk-dash \.wc \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/.test(CSS) && /\.trk-dash \.wc-note, \.trk-dash \.wc-status \{ margin: 0; overflow-wrap: anywhere; \}/.test(CSS));
  const cardBlock = (CSS.match(/@container trk \(max-width: 599px\) \{\n  \.trk-dash \.trk-htable thead[\s\S]*?\n\}/) || [''])[0];
  check('in card mode the trade table drops tracker.css\'s 420px floor, so a card fits the column', /\.trk-dash \.trk-table \{ min-width: 0; \}/.test(cardBlock));
  check('in table layouts the holdings control column is pinned to the scroller\'s right edge (sticky, opaque), and only there', /@container trk \(min-width: 600px\) \{[^}]*\.trk-dash \.trk-htable th:last-child, \.trk-dash \.trk-htable td\.c-more \{ position: sticky; right: 0; z-index: 1; background: var\(--ink-3\); \}/.test(CSS) && !/\n\.trk-dash \.trk-htable td\.c-more \{ position: sticky/.test(CSS));
  check('the dashboard is a size container; the KPI grid is one column, then three with the main tile full width', /\.trk-dash \{ container: trk \/ inline-size;/.test(CSS) && /\.trk-dash \.trk-kpis \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/.test(CSS) && /@container trk \(min-width: 600px\) \{\n  \.trk-dash \.trk-kpis \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}\n  \.trk-dash \.kpi-main \{ grid-column: 1 \/ -1; \}/.test(CSS));
  check('the holdings columns fold by container width: Price/Share/Avg entry below 1000px, cards below 600px with the header clipped (not display:none) and labels from data-l', /@container trk \(max-width: 999px\) \{\n  \.trk-dash \.c-price, \.trk-dash \.c-share, \.trk-dash \.c-avg \{ display: none; \}/.test(CSS) && /@container trk \(max-width: 599px\) \{[\s\S]*thead \{ position: absolute; width: 1px; height: 1px;[^}]*clip: rect\(0 0 0 0\)/.test(CSS) && !/thead \{[^}]*display: none/.test(CSS) && /tr \{ display: block;/.test(CSS) && /td::before \{ content: attr\(data-l\) \/ "";/.test(CSS));
  check('the chart card: 16/7 (4/3 narrow), min-height 220px, pan-y on the canvas; tables scroll inside their section only, and the scroller contains its clipped header text (position: relative)', /\.trk-dash \.wc-plot \{[^}]*aspect-ratio: 16 \/ 7; min-height: 220px/.test(CSS) && /@container trk \(max-width: 599px\) \{\n  \.trk-dash \.wc-plot \{ aspect-ratio: 4 \/ 3; \}/.test(CSS) && /\.trk-dash \.wc-canvas \{[^}]*touch-action: pan-y/.test(CSS) && /\.trk-dash \.trk-scroll \{ overflow-x: auto; min-width: 0; position: relative; \}/.test(CSS));
  check('44px targets under a coarse pointer; 3px green focus rings; forced colours frame the canvas and mark the series switches (the one pressed control without a text ✓) by a glyph; reduced motion stops every transition', /@media \(pointer: coarse\) \{[^}]*min-height: 44px;/.test(CSS) && /\.trk-dash \.a-tx \{[^}]*width: 44px; height: 44px/.test(CSS) && /:focus-visible \{ outline: 3px solid var\(--green-bright\)/.test(CSS) && /@media \(forced-colors: active\) \{[\s\S]*\.trk-dash \.wc-canvas, \.trk-dash \.wc-plot \{ border: 1px solid CanvasText; \}[\s\S]*\.trk-dash \.wc-sw\[aria-pressed="true"\]::after \{ content: " ✓"; \}/.test(CSS) && !/\.trk-dash \[aria-pressed="true"\]::after, \.trk-dash \[aria-checked="true"\]::after/.test(CSS) && /@media \(prefers-reduced-motion: reduce\) \{\n  \.trk-dash \*, [^}]*transition: none !important; animation: none !important;/.test(CSS) && /html\.motion-off \.trk-dash \*/.test(CSS));

  /* ═══ 7. the pages ═══ */
  for (const page of ['tracker.html', 'profile.html']) {
    const P = read(page);
    const at = (s) => P.indexOf(s);
    check(page + ' loads trackerdash.css and walletchart.js after tracker.js', at('tracker.js"') > 0 && at('trackerdash.css') > 0 && at('walletchart.js') > at('tracker.js"'), 'tracker.js@' + at('tracker.js"') + ' trackerdash.css@' + at('trackerdash.css') + ' walletchart.js@' + at('walletchart.js'));
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join(' '));
  check('the suite ran to the end', false, e.message);
}
/* ═══ the chain read's polling loop (trkChainWallet) against a scripted server, on a fake clock: the node's refusals waited out, a throttled
   failure asked again a minute later — as a Refresh only when the server says a checkpoint is on file ═══ */
try {
  let T = 1e12;
  const script = [];   // what the next fetches answer, in order
  const urls = [], delays = [];
  const pctx = vm.createContext({
    console, Number, Math, JSON, Object, Array, Promise, Error, Set, Map, String, encodeURIComponent,
    Date: { now: () => T },
    setTimeout: (fn, ms) => { delays.push(ms); T += ms; fn(); },   // every wait is noted, the clock moves by it, and it is over at once
    fetch: async (url) => { urls.push(url); const a = script.shift(); if (!a) throw new Error('connection dropped'); return { status: a.status, headers: { get: () => null }, json: async () => { if (a.raw) throw new SyntaxError('Unexpected token e in JSON'); return a.body; } }; },
  });
  vm.runInContext(SRC, pctx);
  const W = '0x' + 'ab'.repeat(20);
  const s202 = (extra) => ({ status: 202, body: { pending: true, stage: 'reading every token transfer', done: 3, total: 5100, stageOf: { n: 1, of: 5 }, ...(extra || {}) } });
  const s502 = (reason, resumable, saved) => ({ status: 502, body: { error: 'the chain could not be read right now — try again in a minute', reason, resumable, saved: saved === undefined ? (resumable ? 'checkpoint' : null) : saved } });
  const DONE = { status: 200, body: { transfers: [], tokens: [], txs: {}, head: 1 } };
  const reset = () => { script.length = 0; urls.length = 0; delays.length = 0; };
  // a Rebuild that failed with a checkpoint on file is asked again as a Refresh; the words say why and that it goes on
  let said = []; reset();
  script.push(s202({ throttled: 90000 }), s502('throttled', true), s202({ done: 400, resuming: true }), DONE);
  let out = await pctx.trkChainWallet(W, (m, info) => said.push([m, info]), 2, null);
  check('a throttled 502 is asked again a minute later and the read then answers', out && Array.isArray(out.transfers) && urls.length === 4, JSON.stringify({ urls, delays }));
  check('  ...asked as a Rebuild first (fresh=2), then — the server saying a checkpoint is on file — as a Refresh (fresh=1), never a Rebuild again', /fresh=2$/.test(urls[0]) && !/fresh=/.test(urls[1]) && /fresh=1$/.test(urls[2]) && !/fresh=/.test(urls[3]), JSON.stringify(urls));
  check('  ...the wait before asking again is over a minute (the server keeps a failed read\'s answer for one)', delays.some((d) => d === 65000), JSON.stringify(delays));
  check('  ...while the server waits out refusals the line says so and the info carries how long, why, and whether a checkpoint is there', said[0] && /waiting it out/.test(said[0][0]) && said[0][1].throttled === 90000, JSON.stringify(said[0]));
  check('  ...the failure is said as a stage of its own ("throttled") with the reason and "goes on from where it stopped"', said[1] && /refused the read for too long — asking again in a minute \(it goes on from where it stopped\)/.test(said[1][0]) && said[1][1].stage === 'throttled' && said[1][1].reason === 'throttled' && said[1][1].resumable === true, JSON.stringify(said[1]));
  // a Rebuild that left no checkpoint is not asked again by itself (it would start over and spend a second rebuild of the hour): said plainly, the member decides
  said = []; reset();
  script.push(s202(), s502('timeout', false, 'complete'));
  let err0 = null; try { await pctx.trkChainWallet(W, (m, info) => said.push([m, info]), 2, null); } catch (e) { err0 = e; }
  check('a failed Rebuild with no checkpoint is reported, not retried: it counted, and Rebuild or Refresh is the member\'s call', err0 && /^the chain read timed out before it got anywhere — it counted as one of your two rebuilds this hour\. Try Rebuild again in a minute, or Refresh$/.test(err0.message) && urls.length === 2 && script.length === 0, JSON.stringify({ err: err0 && err0.message, asks: urls.length }));
  // a Refresh with a complete history on file (no checkpoint) reads on from the saved head: said as that, asked again as a Refresh
  said = []; reset();
  script.push(s202(), s502('throttled', false, 'complete'), s202(), DONE);
  out = await pctx.trkChainWallet(W, (m, info) => said.push([m, info]), 1, null);
  check('a failed Refresh with a complete saved history is asked again as a Refresh and the words say it reads on from the saved history', out && /fresh=1$/.test(urls[0]) && /fresh=1$/.test(urls[2]) && said[1] && /^the chain node refused the read for too long — asking again in a minute \(it reads on from the saved history — only what is new\)$/.test(said[1][0]) && said[1][1].saved === 'complete', JSON.stringify({ urls, said: said[1] }));
  // nothing on file at all: the retry starts over, and says so
  said = []; reset();
  script.push(s202(), s502('timeout', false, null), s202(), DONE);
  out = await pctx.trkChainWallet(W, (m, info) => said.push([m, info]), 0, null);
  check('with nothing on file the retry is said to start over, a timeout named as one', out && said[1] && /^the chain read timed out — asking again in a minute \(it starts over\)$/.test(said[1][0]) && said[1][1].resumable === false && said[1][1].saved === null, JSON.stringify({ said: said[1] }));
  // a short wait is the pace's routine and is not said; a long one is
  said = []; reset();
  script.push(s202({ throttled: 5000 }), s202({ throttled: 20000 }), DONE);
  await pctx.trkChainWallet(W, (m, info) => said.push([m, info]), 0, null);
  check('a wait under 20 s is the pace\'s routine refusal: not said, info.throttled 0; one of 20 s is said', !/waiting it out/.test(said[0][0]) && said[0][1].throttled === 0 && /waiting it out/.test(said[1][0]) && said[1][1].throttled === 20000, JSON.stringify(said.map((x) => [x[0], x[1].throttled])));
  // the stall clock: the server waiting out a refusal is not a stall here (its wait is bounded there) — six minutes of the same stage with throttled > 0 still answers; without it the page gives up at five
  reset(); for (let i = 0; i < 180; i++) script.push(s202({ throttled: 1 })); script.push(DONE);
  out = await pctx.trkChainWallet(W, () => {}, 0, null);
  check('six minutes of identical 202s that say the server is waiting on the node do not trip the page\'s five-minute stall clock', out && Array.isArray(out.transfers) && urls.length === 181, urls.length);
  reset(); for (let i = 0; i < 180; i++) script.push(s202()); script.push(DONE);
  let err = null; try { await pctx.trkChainWallet(W, () => {}, 0, null); } catch (e) { err = e; }
  check('  ...the same stream without the wait is a stall at five minutes', err && /no progress for five minutes/.test(err.message) && urls.length < 181, JSON.stringify({ err: err && err.message, asks: urls.length }));
  // a fourth throttled failure is the end: the page does not ask for ever
  reset(); for (let i = 0; i < 4; i++) script.push(s502('throttled', true));
  err = null; try { await pctx.trkChainWallet(W, () => {}, 1, null); } catch (e) { err = e; }
  check('after three retries a fourth throttled failure is reported, not retried', err && /could not be read right now/.test(err.message) && urls.length === 4 && script.length === 0, JSON.stringify({ err: err && err.message, asks: urls.length }));
  // a failure for another reason is reported at once
  reset(); script.push(s502('unreadable', true));
  err = null; try { await pctx.trkChainWallet(W, () => {}, 0, null); } catch (e) { err = e; }
  check('a 502 for any other reason is reported at once', err && urls.length === 1, JSON.stringify({ err: err && err.message, asks: urls.length }));
  // Cloudflare's own "error code: 502" in place of the server's JSON: no reason arrives, so it is waited out like a refusal
  const EDGE502 = { status: 502, raw: true };
  reset(); script.push(s202(), EDGE502, s202(), DONE);
  out = await pctx.trkChainWallet(W, () => {}, 2, null);
  check('an edge 502 with no JSON body is asked again a minute later, as a Refresh, and the read then answers', out && Array.isArray(out.transfers) && urls.length === 4 && /fresh=2$/.test(urls[0]) && /fresh=1$/.test(urls[2]) && delays.some((d) => d === 65000), JSON.stringify({ urls, delays }));
  reset(); for (let i = 0; i < 4; i++) script.push(EDGE502);
  err = null; try { await pctx.trkChainWallet(W, () => {}, 0, null); } catch (e) { err = e; }
  check('  ...three times at most, then reported', err && /could not be read right now/.test(err.message) && urls.length === 4, JSON.stringify({ err: err && err.message, asks: urls.length }));
} catch (e) { check('the polling-loop section ran to the end', false, e && e.stack); }

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
