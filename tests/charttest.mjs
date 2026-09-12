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
    check('markers: a cluster is bucketed by the chart timeframe when the caller names one', /\(Number\(tfSec\) \|\| 0\) \* 1000 \|\| Math\.round/.test(SRC));
    check('markers: the cluster floor is one minute', /Math\.max\(60000, Math\.round\(bucketMs\)/.test(SRC));
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
    check('client: the scales answer the keyboard too', /g\.addEventListener\('keydown'/.test(CHART) && /k === 'Home' \|\| k === 'Escape'/.test(CHART));
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
    check('csp: frame-src is none', /"frame-src 'none'"/.test(SRC));
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
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join('\n'));
}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
