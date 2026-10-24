/* The on-chain chart: its markers, its honesty about dollars, and the two scales you can drag.
 *
 * Split deliberately between two kinds of assertion. Anything that can be exercised without touching the
 * chain goes through the live HTTP API — the marker route reads only tables this site already keeps, so
 * it is cheap and deterministic. Anything that WOULD need a chain read (/api/chart walks eth_getLogs) is
 * asserted against the source instead: a suite that depends on an RPC node is a suite that fails for
 * reasons that have nothing to do with the code.
 *
 * The client half is asserted against public/chart.js and public/styles.css the same way, because these
 * are the exact regressions that shipped once already and were invisible until somebody left a chart
 * open for twelve minutes.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const CHART = readFileSync(path.join(ROOT, 'public', 'chart.js'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
const INDEX = readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const TOKEN = '0x' + 'a'.repeat(40), PAIR = '0x' + 'b'.repeat(40);

try {
  /* ═══════════ 1. the marker window is clamped, not taken ═══════════
     from=0 is a request for a token's entire history of calls and hops in one machine-readable answer.
     Every row in it is public on its own call card; three hundred of them keyed by token is a different
     object, and the chart never asks for one. */
  {
    const r = await fetch(`${BASE}/api/chart/markers?token=${TOKEN}&pair=${PAIR}&from=0&to=99999999999999`);
    const j = await r.json();
    const hours = (j.to - j.from) / 3600000;
    check('markers: an unbounded from=0 is clamped to the longest window the UI draws', hours <= 720.01, hours.toFixed(1) + 'h');
    check('markers: a to in the far future is clamped to now', j.to <= Date.now() + 2000);
    check('markers: the route answers with every layer present', j.types && ['call', 'sent', 'conviction', 'dev', 'block0'].every(k => Array.isArray(j.types[k])));
  }

  /* ═══════════ 2. the deployer layer is opt-in, because it is the one that costs a network read ═══════════ */
  {
    const off = await (await fetch(`${BASE}/api/chart/markers?token=${TOKEN}&pair=${PAIR}&tf=1h`)).json();
    check('markers: the deployer layer is not walked unless it is switched on', (off.types.dev || []).length === 0 && /switch this layer on/.test(off.notes.dev || ''), off.notes.dev);
    check('markers: chartMarkers only reaches the explorer behind wantDev', /if \(!wantDev\) \{[\s\S]{0,400}?lookupTokenPair/.test(SRC));
    check('markers: the route reads the dev flag off the query string', /const wantDev = url\.searchParams\.get\('dev'\) === '1'/.test(SRC));
  }

  /* ═══════════ 3. an unscanned token is unknown, never "clean" ═══════════ */
  {
    const j = await (await fetch(`${BASE}/api/chart/markers?token=${TOKEN}&pair=${PAIR}&tf=1h`)).json();
    check('markers: a token with no block-0 scan says so rather than showing an empty layer',
      /has not had its block-0 scan yet|still /.test(j.notes.chain || ''), j.notes.chain);
  }

  /* ═══════════ 4. precision is the viewer's, and a dollar PNL is nobody else's ═══════════ */
  {
    check('markers: amounts go through the same rounding the Senders list uses', /const money = \(v, uid\) => \(uid && uid === mine\) \? \(Number\(v\) \|\| 0\) : senderUsdPublic\(v\)/.test(SRC));
    const call = SRC.match(/kind: 'call', t: r\.created_at[\s\S]{0,1600}?\}\)\), span\);/);
    check('markers: a call marker publishes a dollar PNL only to the account it belongs to',
      !!call && /pnlUsd: \(r\.user_id === mine &&/.test(call[0]));
    const sent = SRC.match(/kind: 'sent', t: r\.created_at[\s\S]{0,900}?\}\)\), span\);/);
    check('markers: a Sent It marker does the same', !!sent && /pnlUsd: \(r\.user_id === mine &&/.test(sent[0]));
    check('markers: no marker carries a wallet address for a named person',
      !/kind: '(call|sent|conviction)'[\s\S]{0,600}?(wallet|address):/.test(SRC));
  }

  /* ═══════════ 5. clustering follows the candle, not a fraction of the window ═══════════ */
  {
    check('markers: a cluster is bucketed by the chart timeframe when the caller names one',
      /\(Number\(tfSec\) \|\| 0\) > 0[\s\S]{0,120}?Math\.max\(1000, Number\(tfSec\) \* 1000\)/.test(SRC));
    check('markers: and by a slice of the window when it names none', /Math\.max\(60000, Math\.round\(Math\.max\(1, toMs - fromMs\) \/ 120\)\)/.test(SRC));
    /* The floor used to be a flat minute in BOTH places, so the width the caller named was thrown away
       downstream and 1s/1m charts clumped their markers into minute-wide blobs anyway. */
    check('markers: the floor follows the candle rather than overriding it', /Math\.max\(1000, Math\.round\(bucketMs\) \|\| 60000\)/.test(SRC));
  }

  /* ═══════════ 6. dollars fail together, or not at all ═══════════
     ethUsd() only advances its cache on a SUCCESSFUL read, so without a staleness gate a price feed
     outage leaves every dollar figure on the chart quoting a number from hours ago as current. */
  {
    check('price: quoteValue refuses a stale ETH rate rather than passing it off as live', /const ETH_USD_STALE_MS = 10 \* 60 \* 1000/.test(SRC) && /async function ethUsdFresh\(\)/.test(SRC));
    check('price: the WETH branch goes through the freshness gate', /if \(q === WETH_ADDR\) return \{ quote: q, symbol: 'WETH', usd: await ethUsdFresh\(\) \}/.test(SRC));
    check('price: a dollar-stablecoin pool needs no rate and never goes stale', /if \(q === USDG_ADDR\) return \{ quote: q, symbol: 'USDG', usd: 1 \}/.test(SRC));
    check('price: the chart payload says how wide one candle is', /tfSec: tf,/.test(SRC));
  }

  /* ═══════════ 7. one scan per pair, however many people arrive at once ═══════════ */
  {
    check('cost: buildCandles holds its in-flight promise so a crowd costs one scan', /const chartInflight = new Map\(\)/.test(SRC) && /chartInflight\.set\(key, job\)/.test(SRC));
    check('cost: devTrades does the same', /const devTradeInflight = new Map\(\)/.test(SRC) && /devTradeInflight\.set\(key, job\)/.test(SRC));
  }

  /* ═══════════ 8. the client: the live tail must not eat the history ═══════════
     splice(0, …) evicted from the FRONT, so about twelve minutes after a 1h chart was opened it began
     deleting a history candle per second. The window silently shrank to the last few minutes while the
     timeframe button still said 1h, and every marker older than the surviving head vanished. */
  {
    check('client: the tick trims only what the tick appended', /const head = host\._hist \|\| 0;[\s\S]{0,160}pts\.splice\(head, pts\.length - head - TAIL_MAX\)/.test(CHART));
    check('client: and load() records where the history ends', /host\._hist = d\.points\.length/.test(CHART));
    check('client: splice(0, …) is gone from the tick', !/pts\.splice\(0,/.test(CHART));
  }

  /* ═══════════ 9. the client: absent and null are different answers ═══════════ */
  {
    check('client: quoteUsd treats a present null as "cannot be valued"', /if \('quoteUsd' in d\) return d\.quoteUsd;/.test(CHART));
    check('client: a rate-limited tick says so instead of freezing under a green light', /res\.status === 429/.test(CHART) && /const res = await fetch\('\/api\/price/.test(CHART));
    check('client: the hover card is anchored to the plot, not to whatever is positioned above it', /const plot = host\.querySelector\('\.oc-plot'\) \|\| host;/.test(CHART));
  }

  /* ═══════════ 10. the client: both scales can be dragged, and put back ═══════════ */
  {
    check('client: there is a view, and it starts fitted', /const defaultView = \(\) => \(\{ x: 1, y: 1, tEnd: null \}\)/.test(CHART));
    check('client: zoom is clamped at both ends', /const ZOOM_MIN = 1, ZOOM_MAX = 60/.test(CHART) && /clamp\(v\.x, ZOOM_MIN, ZOOM_MAX\)/.test(CHART));
    check('client: dragging a scale is exponential, so a drag means the same thing at every span', /Math\.exp\(\(d \/ reach\) \* ZOOM_RATE\)/.test(CHART));
    check('client: the scales answer the keyboard too', /g\.addEventListener\('keydown'/.test(CHART) && /k === 'Home' \|\| \(k === 'Escape' && isZoomed\(host\._view\)\)/.test(CHART));
    check('client: panning exists only once the window no longer fits', /if \(!g \|\| view\(\)\.x <= 1\) return;/.test(CHART));
    check('client: letting go at the live edge re-pins the view to it', /view\(\)\.tEnd = \(t1 >= g\.fullT1 - 1\) \? null : t1;/.test(CHART));
    check('client: a timeframe change starts fitted again', /host\._view = defaultView\(\);\s+\/\/ a new timeframe/.test(CHART));
    check('client: the series is clipped so a zoomed line cannot paint over the axis', /ctx\.rect\(PAD\.l, PAD\.t, W - PAD\.l - PAD\.r, H - PAD\.t - PAD\.b\); ctx\.clip\(\)/.test(CHART));
    check('css: the two grab strips claim the touch; the canvas leaves the page scrollable', /\.oc-canvas \{ touch-action: pan-y; \}/.test(CSS) && /touch-action: none;/.test(CSS));
    check('css: the strips are laid over exactly the margins the renderer reserves', /\.oc-grab-x \{ left: 8px; right: 70px; bottom: 0; height: 46px/.test(CSS) && /const PAD = \{ l: 8, r: 70, t: 12, b: 46 \}/.test(CHART));
  }

  /* ═══════════ 11a. the early-buyer layer says what the scan actually measured ═══════════
     SNIPE.EARLY_N is the first ten BUYS with block 0 as buy #1 — on a quiet pool the tenth of those can
     be a thousand blocks in, and a layer labelled "first 10 blocks" then contradicts its own card. */
  {
    check('early buyers: the layer is named for buys, not blocks', /label: 'First 10 buys'/.test(CHART) && !/First 10 blocks/.test(CHART));
    check('early buyers: the card says how far in they were, not a made-up block count', /' blocks in'/.test(CHART));
    check('markers: a cluster card is capped so it cannot outgrow the chart it sits in', /const MAX_ROWS = 4;/.test(CHART) && /const more = \(m\.n \|\| all\.length\) - rows\.length/.test(CHART));
    check('early buyers: the server sends which buy it was', /rank: \(w\.ranks && w\.ranks\.length\) \? w\.ranks\[0\] : null/.test(SRC));
    check('early buyers: the shared timestamp is explained rather than left to imply a shared moment', /records no separate clock time per buy/.test(CHART));
    /* The scan stores wei and a `net` word; it has never had tookPct/holdsPct/netSeller. Reading fields
       off it that do not exist is why this layer rendered a bare address and nothing else. */
    check('early buyers: shares are computed from the wei the scan actually stores', /const shareOf = \(raw\) =>[\s\S]{0,200}?BigInt\(d\.supply\)/.test(SRC) && /tookPct: shareOf\(w\.sniped\)/.test(SRC));
    check('early buyers: no invented `sold` flag — the scan\'s own verdict, and unknown stays unknown',
      /net: \['accumulator', 'seller', 'fully out'\]\.includes\(w\.net\) \? w\.net : null/.test(SRC) && !/sold: w\.netSeller/.test(SRC));
    check('early buyers: the card uses the same precision ladder as the block-0 panel', /const pct = \(n\) => \(n == null \|\| !isFinite\(n\)\)/.test(CHART));
  }

  /* ═══════════ 11. the markers are drawn where they belong ═══════════ */
  {
    check('client: an entry outside the visible price range goes to the rail, not off the canvas', /m\._offScale = true;/.test(CHART));
    check('client: the rail sits inside the plot, clear of the axis labels and their drag strip', /const RAIL = H - PAD\.b - 12;/.test(CHART));
    check('client: the legend counts what is actually drawn, and names the rest as outside', /filter\(m => m\.t >= t0 && m\.t <= t1\)/.test(CHART) && /outside this timeframe/.test(CHART));
    check('client: every marker layer can be turned off, and all of them at once', /k === '__clean'/.test(CHART) && /MARKER_ORDER\.forEach\(x => \{ host\._toggles\[x\] = !anyOn; \}\)/.test(CHART));
  }

  /* ═══════════ 12. no third-party frame is left anywhere ═══════════ */
  {
    /* the chart switch (owner, 2026-10-13): ours by default; Dexscreener's or CoinGecko's frame only once picked */
    const NPJ = readFileSync(path.join(ROOT, 'public', 'newpairs.js'), 'utf8'), PRIV = readFileSync(path.join(ROOT, 'public', 'privacy.html'), 'utf8');
    check('every token chart carries a switch: On-chain (the default, filled) · Dexscreener · CoinGecko, each a described button',
      /'<div class="chart-switch" data-pair="' \+ esc\(p\.pair\.address\) \+ '" data-sym="/.test(NPJ) && /class="chart-src-btn is-on" type="button" aria-pressed="true" data-chartsrc="onchain" data-tip="/.test(NPJ)
      && /data-chartsrc="dexscreener" hidden data-tip="/.test(NPJ) && /data-chartsrc="geckoterminal" hidden data-tip="/.test(NPJ) && /'<div class="chart-embed" hidden><\/div>'/.test(NPJ));
    check('  ...a third party\'s chart is an iframe made only when picked, removed on switching back, no referrer, sandboxed — and the pick is remembered on the device',
      /if \(em\) \{ em\.hidden = true; em\.innerHTML = ''; \}/.test(CHART) && /referrerpolicy="no-referrer"/.test(CHART) && /sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"/.test(CHART)
      && /const SRC_KEY = 'chart:src';/.test(CHART) && /'https:\/\/dexscreener\.com\/' \+ \(ds \|\| 'robinhood'\) \+ '\/' \+ pair \+ '\?embed=1/.test(CHART) && /'https:\/\/www\.geckoterminal\.com\/' \+ \(gt \|\| 'robinhood'\) \+ '\/pools\/' \+ pair \+ '\?embed=1/.test(CHART)   // the slug is the chain's (owner, 2026-10-23); the home chain's is the default
      && /if \(!CHART_EMBEDS\[src\] \|\| !pair\) src = 'onchain';/.test(CHART) && /const poolAddr = \(wrap\) => \{ const raw = String\(wrap\.dataset\.pair \|\| ''\); if \(\/\^0x\[0-9a-fA-F\]\{40\}\$\/\.test\(raw\)\) return raw\.toLowerCase\(\);/.test(CHART));
    check('  ...and the privacy page says what picking one means (that company sees your IP and the pool), and that nothing loads until you pick it', /If you switch a chart to <b>Dexscreener<\/b> or <b>CoinGecko<\/b>/.test(PRIV) && /Nothing is loaded from either until you pick it, the frame is removed when you switch back/.test(PRIV));
    /* only the charts that exist (owner, 2026-10-13: "If the dexscreener or coingecko chart is not available for a token then just
       have those two toggle buttons be not visible"): the buttons are drawn hidden, and shown for a yes from our server */
    check('  ...the switch and its two outside buttons start hidden; a button shows only when our server says that site lists the pool, the switch only when one does',
      /'<div class="chart-src" role="group" aria-label="Chart source" hidden>'/.test(NPJ)
      && /b\.hidden = !wrap\._srcs\[k\]; if \(wrap\._srcs\[k\]\) any = true;/.test(CHART) && /if \(grp\) grp\.hidden = !any;/.test(CHART)
      && /const keep = \(k\) => s\[k\] === true \|\| \(s\[k\] === null && !!prev\[k\]\);/.test(CHART) && /wrap\._srcs = \{ dexscreener: keep\('dexscreener'\), geckoterminal: keep\('geckoterminal'\) \};/.test(CHART));
    check('  ...a coin the price feed does not list but whose pool the site reads ($GWC) still gets our chart and the switch',
      /if \(!\(p\.indexed \|\| poolRead\(p\)\) \|\| !p\.pair \|\| !p\.pair\.address\) \{/.test(NPJ) && /const poolRead = \(p\) => !!\(p\.market && p\.market\.source === 'reserves'\);/.test(NPJ));
    check('  ...a site that does not list the pool can never be shown, not by a remembered pick nor a click; the pick applies once, never swapped in later',
      /if \(src !== 'onchain' && !\(wrap\._srcs && wrap\._srcs\[src\]\)\) src = 'onchain';/.test(CHART)
      && /else if \(first && !wrap\._picked && !wrap\._touched && Date\.now\(\) - \(wrap\._askAt \|\| 0\) < 2500\) \{ const pick = chartSrcPref\(\); if \(pick !== 'onchain' && wrap\._srcs\[pick\]\) showChartSrc\(wrap, pick\); \}/.test(CHART)
      && /w\.setAttribute\('data-ready', '1'\); w\._askAt = Date\.now\(\);/.test(CHART) && /wantSources\(w\);/.test(CHART));
    check('  ...the browser asks our server only — never Dexscreener or GeckoTerminal — and the server asks them, metered, 30 pools a call',
      /fetch\('\/api\/chart\/sources\?pools=' \+/.test(CHART) && !/api\.dexscreener\.com|api\.geckoterminal\.com/.test(CHART)
      && /const CHART_SRC_DS_URL = process\.env\.CHART_SRC_DS_URL \|\| 'https:\/\/api\.dexscreener\.com\/latest\/dex\/pairs\/robinhood\/';/.test(SRC) && /jgetR\(CHART_SRC_DS_URL \+ pools\.join\(','\)\)/.test(SRC)
      && /const CHART_SRC_GT_URL = process\.env\.CHART_SRC_GT_URL \|\| 'https:\/\/api\.geckoterminal\.com\/api\/v2\/networks\/robinhood\/pools\/multi\/';/.test(SRC) && /jgetR\(CHART_SRC_GT_URL \+ pools\.join\(','\)\)/.test(SRC)
      && /'api\.geckoterminal\.com': 10,/.test(SRC) && /const CHART_SRC_BATCH = 30,/.test(SRC));
    check('  ...and the privacy page says the buttons show only for a listed pool, asked by our server with the pool address alone',
      /Each button shows only when that site lists the pool: our server asks them, with the pool&#39;s address alone|Each button shows only when that site lists the pool: our server asks them, with the pool's address alone/.test(PRIV)
      && /CoinGecko's GeckoTerminal and Dexscreener \(whether they list a pool/.test(PRIV));
    {
      const rnd = () => '0x' + [...Array(40)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
      const a = rnd(), b = rnd();
      const bad1 = await fetch(`${BASE}/api/chart/sources?pools=nope`), bad2 = await fetch(`${BASE}/api/chart/sources`);
      check('/api/chart/sources: no pool address, no answer (400)', bad1.status === 400 && bad2.status === 400, bad1.status + ' ' + bad2.status);
      const many = [...Array(35)].map(rnd);
      const [r1, r2, rm] = await Promise.all([fetch(`${BASE}/api/chart/sources?pools=${a},${a.toUpperCase().replace('0X', '0x')}`), fetch(`${BASE}/api/chart/sources?pools=${b}`), fetch(`${BASE}/api/chart/sources?pools=${many.join(',')}`)]);
      const j1 = await r1.json().catch(() => null), j2 = await r2.json().catch(() => null), jm = await rm.json().catch(() => null);
      const shape = (j, k) => j && j.pools && j.pools[k] && [true, false, null].includes(j.pools[k].dexscreener) && [true, false, null].includes(j.pools[k].geckoterminal);
      check('  ...a pool nobody lists is never offered (false, or null when the site could not ask), one entry per pool in any letter case',
        r1.status === 200 && shape(j1, a) && Object.keys(j1.pools).length === 1 && j1.pools[a].dexscreener !== true && j1.pools[a].geckoterminal !== true && shape(j2, b) && j2.pools[b].dexscreener !== true, JSON.stringify([j1, j2]));
      check('  ...at most 30 pools a question', rm.status === 200 && jm && Object.keys(jm.pools).length === 30, rm.status + ' ' + (jm && Object.keys(jm.pools || {}).length));
      if (process.env.CHAIN_LIVE === '1') {
        const live = await (await fetch(`${BASE}/api/chart/sources?pools=0xf30bb531d0255969be155533abac34b22bd63414`)).json().catch(() => null);
        check('  ...live: $SEND\'s pool is listed on both', live && live.pools && live.pools['0xf30bb531d0255969be155533abac34b22bd63414'] && live.pools['0xf30bb531d0255969be155533abac34b22bd63414'].dexscreener === true && live.pools['0xf30bb531d0255969be155533abac34b22bd63414'].geckoterminal === true, JSON.stringify(live));
      }
    }
    check('csp: frame-src admits exactly Dexscreener and CoinGecko\'s GeckoTerminal (the viewer-picked chart embeds), nothing else', /"frame-src https:\/\/dexscreener\.com https:\/\/www\.geckoterminal\.com",/.test(SRC) && (SRC.match(/frame-src/g) || []).length >= 1);
    check('landing: the charts are ours, and they poll at a rate a read page can afford', /class="onchain-chart"[^>]*data-poll="5000"/.test(INDEX));
    check('landing: no iframe survives on the page', !/<iframe/i.test(INDEX));
    check('client: data-poll is actually honoured', /Number\(host\.dataset\.poll\) \|\| 1000/.test(CHART));
  }

  /* ═══════════ 13. nothing claims a market cap it cannot stand behind ═══════════ */
  {
    check('copy: the hover says which supply the market cap used', /Market cap is this price × today’s supply/.test(CHART));
    check('copy: ...and that the chain keeps no archival state to check it against', /keeps no archival state/.test(CHART));
    check('copy: a pool we cannot value says so instead of inventing a dollar figure', /this pool prices in a token we can’t value/.test(CHART));
    check('copy: a stale rate is named as stale', /our ETH\/USD rate is more than ten minutes old/.test(CHART));
    check('copy: an x is called a measurement, not advice', /Measurements, not advice/.test(CHART));
    check('copy: an empty chart says nobody traded, not that something broke', /The pool exists; nobody traded it/.test(CHART));
  }

  /* ═══════════ 14. a pool on another chain (review, 2026-10-23) ═══════════
     Ethereum's and Solana's candles come from GeckoTerminal; the marker layers are the home chain's. Four things were wrong
     on such a chart: a legend of five empty toggles over layers never read, "Reading the chain…" over a GeckoTerminal read,
     a switch offering GeckoTerminal's view of a pool GeckoTerminal 404s, and no teardown when the dashboard's pool switcher
     threw the host away (its 60 s re-ask and its window listeners lived on, holding the detached subtree). */
  {
    check('far: one test for "another chain", and the home-chain words kept byte for byte', /const farChain = \(host\) => !!\(host && host\.dataset && host\.dataset\.chain && host\.dataset\.chain !== 'robinhood'\);/.test(CHART)
      && /const readingWords = \(host\) => farChain\(host\) \? 'Reading GeckoTerminal…' : 'Reading the chain…';/.test(CHART) && /const againWords = \(host\) => farChain\(host\) \? 'Asking GeckoTerminal again…' : 'Asking the chain again…';/.test(CHART)
      && /const silentWords = \(host\) => farChain\(host\) \? 'GeckoTerminal is not answering just now' : 'The chain is not answering reads just now';/.test(CHART));
    check('legend: no .oc-legend is built for a far host, and renderLegend stands down before it builds a button', /\(farChain\(host\) \? '' : '<div class="oc-legend" role="group" aria-label="Which markers to show"><\/div>'\)/.test(CHART)
      && /function renderLegend\(host\) \{[\s\S]{0,700}?\n    if \(farChain\(host\)\) return;\n    const bar = host\.querySelector\('\.oc-legend'\); if \(!bar\) return;/.test(CHART));
    check('words: the status line, the canvas sentence, the retry line and the stale line are the host\'s own source', /status\.textContent = readingWords\(host\);/.test(CHART) && /else if \(host\._retries\) status\.textContent = againWords\(host\);/.test(CHART)
      && /if \(!again\) host\._data\._msg = readingWords\(host\);/.test(CHART) && /d\._reading = readingWords\(host\);/.test(CHART) && /\|\| \(data && data\._reading\) \|\| 'Reading the chain…';/.test(CHART)
      && /: silentWords\(host\);/.test(CHART) && /'⚠️ ' \+ silentWords\(host\) \+ ', so this is the chart as it stood '/.test(CHART) && !/status\.textContent = 'Reading the chain…'/.test(CHART) && !/'The chain is not answering reads just now'\s*:/.test(CHART.replace(/const silentWords[^\n]*\n/, '')));
    check('sources: the chart answer\'s listings reach the switch (booleans only), and a GeckoTerminal miss (retry false) takes its view away while Dexscreener\'s stays',
      /if \(farChain\(host\) && d\.sources\) markSources\(host, d\.sources\);/.test(CHART) && /if \(farChain\(host\) && d\.retry === false\) markSources\(host, \{ geckoterminal: false \}\);/.test(CHART)
      && /function markSources\(host, s\) \{\n    const wrap = host\.closest\('\.chart-switch'\); if \(!wrap \|\| !s \|\| typeof s !== 'object'\) return;\n    const was = wrap\._srcs \|\| \{ dexscreener: true, geckoterminal: true \};\n    const pick = \(k\) => typeof s\[k\] === 'boolean' \? s\[k\] : !!was\[k\];\n    applySources\(wrap, \{ dexscreener: pick\('dexscreener'\), geckoterminal: pick\('geckoterminal'\) \}\);/.test(CHART)
      && CHART.indexOf('markSources(host, d.sources)') > CHART.indexOf('d.points = pointsFromCandles(d.candles);') && /applySources\(wrap, \{ dexscreener: true, geckoterminal: true \}\); return; \}/.test(CHART));   // the home-chain ask and the first assumption are as they were
    check('teardown: destroy() exists and is exported as window.OnChainChart.destroy; every await in load, the markers and the tick checks the flag; the listeners are kept by reference',
      /function destroy\(host\) \{/.test(CHART) && /window\.OnChainChart = Object\.assign\(window\.OnChainChart \|\| \{\}, \{ destroy \}\);/.test(CHART)
      && /if \(host\._dead \|\| seq !== host\._seq\) return;/.test(CHART) && (CHART.match(/if \(host\._dead\) return;/g) || []).length >= 2 && /if \(host\._dead \|\| seq !== host\._seq \|\| !host\.isConnected\) return;/.test(CHART)
      && /window\.addEventListener\('resize', host\._onResize\);/.test(CHART) && /document\.addEventListener\('visibilitychange', host\._onVis\);/.test(CHART) && /host\.addEventListener\('click', host\._onClick\);/.test(CHART)
      && /host\._ro = new ResizeObserver\(/.test(CHART) && /host\._io = new IntersectionObserver\(/.test(CHART) && !/window\.addEventListener\('resize', \(\)/.test(CHART) && !/document\.addEventListener\('visibilitychange', \(\)/.test(CHART));
    // run it: chart.js in a bare window, then a host with a live interval, a pending re-ask, the three listeners and both observers
    {
      const winOffs = [], docOffs = [], cleared = [], timeouts = [];
      const ctx = { console, setTimeout, clearTimeout: (id) => { timeouts.push(id); clearTimeout(id); }, setInterval, clearInterval: (id) => { cleared.push(id); clearInterval(id); },
        addEventListener: () => {}, removeEventListener: (t, f) => winOffs.push([t, f]),
        document: { readyState: 'complete', hidden: false, querySelectorAll: () => [], addEventListener: () => {}, removeEventListener: (t, f) => docOffs.push([t, f]) } };
      ctx.window = ctx;
      vm.createContext(ctx);
      let ran = true;
      try { vm.runInContext(CHART, ctx, { filename: 'chart.js' }); } catch (e) { ran = false; check('teardown: chart.js runs in a bare window', false, e.message); }
      if (ran) {
        const onResize = () => {}, onVis = () => {}, onClick = () => {};
        let roOff = 0, ioOff = 0, clickOff = null;
        const tick = setInterval(() => {}, 1e6), again = setTimeout(() => {}, 1e6);
        const host = { dataset: { chain: 'ethereum' }, isConnected: true, _wired: true, _seq: 3, _tick: tick, _againTimer: again, _onResize: onResize, _onVis: onVis, _onClick: onClick,
          _ro: { disconnect: () => { roOff++; } }, _io: { disconnect: () => { ioOff++; } }, removeEventListener: (t, f) => { clickOff = [t, f]; } };
        ctx.OnChainChart.destroy(host);
        check('teardown: destroy clears the interval and the pending re-ask, takes the resize, visibilitychange and click listeners off by reference, disconnects both observers, flags the host and moves its sequence on',
          typeof ctx.OnChainChart.destroy === 'function' && cleared.includes(tick) && host._tick === null && timeouts.includes(again) && host._againTimer === null
          && winOffs.some(([t, f]) => t === 'resize' && f === onResize) && docOffs.some(([t, f]) => t === 'visibilitychange' && f === onVis) && !!clickOff && clickOff[0] === 'click' && clickOff[1] === onClick
          && roOff === 1 && ioOff === 1 && host._dead === true && host._seq === 4 && host._wired === false && host._onResize === null && host._onVis === null && host._onClick === null,
          JSON.stringify({ cleared: cleared.length, winOffs: winOffs.map(([t]) => t), docOffs: docOffs.map(([t]) => t), dead: host._dead, seq: host._seq, wired: host._wired }));
        ctx.OnChainChart.destroy(host); ctx.OnChainChart.destroy(null); ctx.OnChainChart.destroy({ dataset: {} });
        check('  ...and is safe twice, on nothing, and on a host that was never wired', roOff === 1 && ioOff === 1 && host._seq === 5 && winOffs.length === 1 && docOffs.length === 1);
      }
    }
  }

  /* ═══════════ 15. another chain's tape, its empty window, its refresh (review, 2026-10-24) ═══════════
     GeckoTerminal says who traded but not what each address paid over the window, so the server sends traders: null — and
     every row fell through to "no entry here — sold without buying", a verdict nobody measured, under a "paid to the
     contract" count nobody counted. An empty OHLCV answer said "the pool exists; nobody traded it", a chain fact only where
     the swaps were read from the chain. The tape renderer is sliced out of chart.js and RUN here. */
  {
    const a = CHART.indexOf('  const short = (a) =>'), b = CHART.indexOf('\n  // History becomes a point series');
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const farChain = (h) => !!(h && h.dataset && h.dataset.chain && h.dataset.chain !== 'robinhood');
    let tapeHTML = null;
    try { tapeHTML = new Function('esc', 'farChain', CHART.slice(a, b) + '\nreturn tapeHTML;')(esc, farChain); } catch (e) { check('tape: the renderer slices out of chart.js and runs', false, e.message); }
    if (tapeHTML) {
      const W1 = '0x' + '1'.repeat(40), W2 = '0x' + '2'.repeat(40), H = '0x' + 'f'.repeat(64);
      const home = { trades: [{ ts: 1761200000000, isBuy: true, tok: 5, quote: 1, wallet: W1, hash: H, firstBuy: false, viaContract: false }, { ts: 1761199000000, isBuy: false, tok: 5, quote: 1, wallet: W2, hash: H, firstBuy: false, viaContract: true }],
        traders: { [W1]: { state: 'up', basis: 'ok', pnlPct: 12, n: 2 }, [W2]: { state: 'unknown', basis: 'no-buy', pnlPct: null, n: 1 } }, tapeViaContract: 1, tapeAt: 1761200100000, explorer: 'https://x.example', quote: 'WETH' };
      const far = { trades: home.trades.map((r) => Object.assign({}, r, { firstBuy: null, viaContract: null })), traders: null, tapeViaContract: null, tapeAddr: 'signer', tapeAt: 1761200100000, explorer: 'https://etherscan.io', quote: 'WETH' };
      const H0 = tapeHTML(home, { dataset: { chain: 'robinhood' } }), F = tapeHTML(far, { dataset: { chain: 'ethereum' } });
      const F2 = tapeHTML(Object.assign({}, far, { traders: {}, tapeViaContract: 0, tapeAddr: undefined }), { dataset: { chain: 'solana' } });   // an answer from before the server sent traders: null
      check('tape: the home chain\'s tape is as it was — "Address paid", the up / no-entry verdicts, the contract count and the paid-address note',
        />Address paid<\/th>/.test(H0) && /<span class="oc-w-s">up \+12\.0%/.test(H0) && /<span class="oc-w-s">no entry here<\/span>/.test(H0) && /1 of these 2 rows was paid to the contract that called the swap/.test(H0)
        && /The address shown is the one the pool paid: on a buy whoever received the tokens/.test(H0) && /This is a contract — a router/.test(H0) && !/not followed/.test(H0), H0.slice(0, 200));
      check('tape: traders: null gives every row a neutral "not followed" chip, never "no entry here"; no contract count; the column and the tip name the signer',
        (F.match(/<span class="oc-w-s">not followed<\/span>/g) || []).length === 2 && !/no entry here|bag from before|oc-w is-up|oc-w is-down|is-first/.test(F.replace(/<p class="oc-tape-note">[\s\S]*$/, '')) && !/paid to the contract|None of these rows/.test(F)
        && />Signer<\/th>/.test(F) && !/Address paid/.test(F) && /title="Profit and loss are followed on Robinhood Chain’s own tape only\. This is the address that signed the transaction\. Opens this address on the explorer\."/.test(F)
        && /The address shown is the one that signed the transaction — not necessarily the one the tokens or the proceeds went to\./.test(F) && /GeckoTerminal’s record of public chain data/.test(F) && !/This is a contract/.test(F) && !/do not follow the live price/.test(F), F.slice(0, 300));
      check('  ...and a pool on another chain is never followed, whatever its answer carries; without tapeAddr the column is just "Address"',
        (F2.match(/<span class="oc-w-s">not followed<\/span>/g) || []).length === 2 && />Address<\/th>/.test(F2) && !/paid to the contract|None of these rows|no entry here/.test(F2) && /The address shown is the one the chart source records for the trade\./.test(F2));
      check('  ...the neutral chip lives outside STATE (no server word can map onto it) and is a word, not a colour', /const UNFOLLOWED = \{ cls: 'is-unknown', word: 'not followed', tip: 'Profit and loss are followed on Robinhood Chain’s own tape only\.' \};/.test(CHART)
        && !/'not followed'[^\n]*\n[^\n]*STATE\b/.test(CHART.slice(CHART.indexOf('const STATE = {'), CHART.indexOf('const stateFor'))) && /const followed = data\.traders != null && !farChain\(host\);/.test(CHART) && /tape\.innerHTML = tapeHTML\(d, host\);/.test(CHART));
    }
    check('empty window: at home it is the chain saying nobody traded; elsewhere it is GeckoTerminal having no candles, said as that, whatever the answer\'s note claims',
      /d\._msg = !farChain\(host\) \? \(d\.note \|\| 'No swaps on this pool in this window\. The pool exists; nobody traded it\.'\)/.test(CHART)
      && /: !d\.points\.length \? 'GeckoTerminal has no candles for this pool in this window — that says nothing about whether it traded\.'/.test(CHART) && /'GeckoTerminal has a single candle for this pool in this window/.test(CHART));
    check('refresh: a far chart says how often it is asked for again and that the data is GeckoTerminal\'s, cached up to 90 s — never a bare "refreshed"',
      /const farEveryMs = \(host\) => Math\.max\(30000, Number\(host\.dataset\.poll\) \|\| 60000\);/.test(CHART) && /return s === 60 \? 'every minute' : 'every ' \+ s \+ ' s';/.test(CHART)
      && /asked for again ' \+ farEveryWords\(host\) \+ ' \(GeckoTerminal’s data, cached up to 90 s\)">📊 GeckoTerminal · ' \+ farEveryWords\(host\) \+ '<\/span>'/.test(CHART) && /\(far \? '📊 GeckoTerminal · ' \+ farEveryWords\(host\) : '⛓️ on-chain · live'\)/.test(CHART)
      && !/GeckoTerminal · refreshed/.test(CHART) && /const every = Math\.max\(30000, Number\(host\.dataset\.poll\) \|\| 60000\);/.test(CHART));   // the same rule the 60 s re-ask itself uses
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join('\n'));
}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
