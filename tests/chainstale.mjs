/* The public node refuses reads in bursts (HTTP 429). What used to turn one refusal into a visitor-visible error or a
   log full of noise, driven against the real code pulled out of server.js and public/chart.js:
   1. /api/chart: a passing failure is retried within one budget; if it still fails, the last chart drawn recently is
      sent marked stale (with asOf); with nothing to stand in, a passing failure answers 200 { retry: true }. Wide
      windows are read in pieces the node accepts. The widget retries by kind and works the stale age out itself.
   1c. the live price: a refusal throws (nothing cached), a revert or an empty answer is a definite no.
   2. the pool read behind the home page: each chain call asked once more when refused; a failure still answers null
      and is never cached; the log says it once per five minutes with a count.
   3. the HTTP server's clientError handler: a connection that never sent a byte (cloudflared's spare keep-alive
      sockets) is closed quietly instead of being answered with a 400. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SERVER_JS, ROOT } from './_paths.mjs';
const SRC = readFileSync(SERVER_JS, 'utf8');
const CHART = readFileSync(path.join(ROOT, 'public', 'chart.js'), 'utf8');
const grab = (re, l) => { const m = SRC.match(re); if (!m) { console.error('could not extract ' + l); process.exit(1); } return m[0]; };
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const isThrottle = (e) => { const m = String((e && e.message) || e); return !/revert/i.test(m) && /\b429\b|\b403\b|too many requests|rate.?limit|capacity/i.test(m); };
const instant = (fn) => { fn(); return 0; };   // a setTimeout that does not wait: the back-off is a real timer in production, not here

/* ---------------- 1. the chart ---------------- */
const consts = grab(/const CHART_RETRIES = \d+, CHART_STALE_MAX_MS = [^;]+;/, 'CHART_RETRIES');
const staleSrc = grab(/function staleChart\(last, hours\) \{[\s\S]*?\n\}\n/, 'staleChart');
const patientSrc = grab(/async function buildCandlesPatiently\([\s\S]*?\n\}\n/, 'buildCandlesPatiently');
const transientSrc = grab(/const chainTransient = [^\n]*\n/, 'chainTransient');
check('the chart retries 3 times and a stale chart may be at most 6 hours old', /CHART_RETRIES = 3, CHART_STALE_MAX_MS = 6 \* 3600 \* 1000/.test(consts));
const mkPatient = (fresh, nowMs, lastGood, failAt) => new Function('buildCandlesFresh', 'now', 'isThrottle', 'setTimeout', 'chartLastGood', 'chartFailAt', 'LOG_SPAN_MS',
  consts + '\n' + transientSrc + staleSrc + patientSrc + '\nreturn buildCandlesPatiently;')(fresh, () => nowMs, isThrottle, instant, lastGood || new Map(), failAt || new Map(), 40000);
const t = 1_760_000_000_000;
{ let calls = 0; const fail = new Map([['k', { at: t - 1000 }]]);
  const d = await mkPatient(async () => { calls++; return { candles: [1, 2], swaps: 2 }; }, t, null, fail)('0xp', '0xt', '1h', 168, 'k');
  check('a read that works is returned first time, untouched, and clears the refusal mark', calls === 1 && d.candles.length === 2 && !d.stale && !fail.has('k'), JSON.stringify(d)); }
{ let calls = 0;
  const d = await mkPatient(async () => { if (++calls < 3) throw new Error('rpc http 429'); return { candles: [1], swaps: 1 }; }, t)('0xp', '0xt', '1h', 168, 'k');
  check('two refusals then an answer: the answer, after three reads', calls === 3 && d.candles.length === 1 && !d.stale, calls); }
for (const msg of ['rpc http 502', 'This operation was aborted', 'fetch failed', 'rpc http 403', 'terminated']) {
  let calls = 0;
  const d = await mkPatient(async () => { if (++calls < 2) throw new Error(msg); return { candles: [1] }; }, t)('0xp', '0xt', '1h', 168, 'k');
  check('a passing failure ("' + msg + '") is retried too', calls === 2 && d.candles.length === 1, calls);
}
{ let calls = 0;
  const d = await mkPatient(async () => { if (++calls < 2) throw Object.assign(new Error('the chain did not answer the block-time reads'), { transient: true }); return { candles: [1] }; }, t)('0xp', '0xt', '1h', 168, 'k');
  check('an error the code marks transient (block times unread) is retried', calls === 2 && d.candles.length === 1, calls); }
{ const budgets = []; let calls = 0;
  await mkPatient(async (p, tk, tf, h, budget) => { budgets.push(budget); if (++calls < 3) throw new Error('rpc http 429'); return { candles: [1] }; }, t)('0xp', '0xt', '1h', 168, 'k');
  check('every attempt counts its own log calls from zero, under ONE time limit for the whole request', budgets.length === 3 && budgets.every((b) => b.calls === 0 && b.until === budgets[0].until) && new Set(budgets).size === 3, JSON.stringify(budgets)); }
{ let calls = 0;
  const d = await mkPatient(async () => { calls++; throw Object.assign(new Error('found 9 swaps but the chain did not answer the block-time reads'), { transient: true, noRetry: true }); }, t, new Map([['k', { at: t - 60000, data: { candles: [1] } }]]))('0xp', '0xt', '1h', 168, 'k');
  check('unread block times are not re-run four times (up to 400 probes each), but a recent chart still stands in', calls === 1 && d.stale === true, calls); }
{ let calls = 0; const last = { at: t - 4 * 60000, data: { candles: [1, 2, 3], swaps: 3, note: 'times are approximate' } };
  const lg = new Map([['k', last]]); const fail = new Map();
  const d = await mkPatient(async () => { calls++; throw new Error('rpc http 429'); }, t, lg, fail)('0xp', '0xt', '1h', 168, 'k');
  check('kept refusing: the last good chart is sent after 4 reads (1 + 3 retries)', calls === 4 && d && d.candles && d.candles.length === 3, calls);
  check('  ...marked stale, with when it was drawn', d && d.stale === true && d.asOf === last.at);
  check('  ...and a staleNote that says how old it is', d && /as it stood 4 minutes ago\.$/.test(d.staleNote || ''), d && d.staleNote);
  check('  ...with the age and the longest it may stand in measured on the server\'s clock', d && d.ageMs === 4 * 60000 && d.staleMaxMs === 6 * 3600 * 1000, d && (d.ageMs + ' ' + d.staleMaxMs));
  check('  ...the chart\'s own note is kept as it was (an approximate-times caveat is not lost)', d && d.note === 'times are approximate');
  check('  ...the stored chart itself is not rewritten', last.data.stale === undefined && last.data.staleNote === undefined);
  check('  ...and the refusal is remembered for the cool-down', fail.has('k') && fail.get('k').at === t); }
{ const d = await mkPatient(async () => { throw new Error('rpc http 429'); }, t, new Map([['k', { at: t - 40000, data: { candles: [1] } }]]))('0xp', '0xt', '1h', 168, 'k');
  check('a chart under a minute old is "1 minute ago"', d && /as it stood 1 minute ago/.test(d.staleNote || ''), d && d.staleNote); }
{ let threw = null; try { await mkPatient(async () => { throw new Error('rpc http 429'); }, t, new Map([['k', { at: t - 7 * 3600 * 1000, data: { candles: [1] } }]]))('0xp', '0xt', '1h', 168, 'k'); } catch (e) { threw = e; }
  check('a 1h chart older than six hours does not stand in: the refusal is thrown', threw && /429/.test(threw.message)); }
{ let threw = null; try { await mkPatient(async () => { throw new Error('rpc http 429'); }, t, new Map([['k', { at: t - 11 * 60000, data: { candles: [1] } }]]))('0xp', '0xt', '1s', 0.05, 'k'); } catch (e) { threw = e; }
  const ok = await mkPatient(async () => { throw new Error('rpc http 429'); }, t, new Map([['k', { at: t - 9 * 60000, data: { candles: [1] } }]]))('0xp', '0xt', '1s', 0.05, 'k');
  check('a three-minute 1s chart stands in for ten minutes at most', threw && ok && ok.stale === true); }
{ let calls = 0;
  const d = await mkPatient(async () => { calls++; throw new Error('log read too large for one request'); }, t, new Map([['k', { at: t - 60000, data: { candles: [1] } }]]))('0xp', '0xt', '1h', 168, 'k');
  check('a failure that is not passing (the log budget spent) is not retried, but a recent chart still stands in', calls === 1 && d && d.stale === true, calls);
  let threw = null; calls = 0;
  try { await mkPatient(async () => { calls++; throw new Error('log read too large for one request'); }, t)('0xp', '0xt', '1h', 168, 'k'); } catch (e) { threw = e; }
  check('  ...and with nothing to stand in it is thrown as it is (→ 502)', calls === 1 && threw && /too large/.test(threw.message)); }
const bcSrc = grab(/async function buildCandles\(pairAddr, tokenAddr, tfKey, hours\) \{[\s\S]*?\n\}\n/, 'buildCandles');
{ const mkBC = (fresh, nowMs, failAt, lastGood) => new Function('candleKey', 'chartCache', 'chartTtlFor', 'CHART_TF', 'chartInflight', 'chartFailAt', 'CHART_FAIL_COOL_MS', 'CHART_FAIL_PERM_MS', 'staleChart', 'chartLastGood', 'buildCandlesPatiently', 'now',
    bcSrc + '\nreturn buildCandles;')((p, tk, tf, h) => p + ':' + tk + ':' + tf + ':' + h, new Map(), () => 30000, { '1h': 3600 }, new Map(), failAt, 15000, 300000,
    (last) => last ? { ...last.data, stale: true } : null, lastGood || new Map(), fresh, () => nowMs);
  let reads = 0; const key = '0xp:0xt:1h:168';
  const bc = mkBC(async () => { reads++; return { candles: [9] }; }, t, new Map([[key, { at: t - 5000, transient: true }]]));
  let threw = null; try { await bc('0xp', '0xt', '1h', 168); } catch (e) { threw = e; }
  check('within 15 s of a refusal, with nothing to stand in, a passing failure is answered at once — no new read', reads === 0 && threw && threw.transient === true, reads);
  const bc2 = mkBC(async () => { reads++; return { candles: [9] }; }, t, new Map([[key, { at: t - 5000, transient: true }]]), new Map([[key, { at: t - 60000, data: { candles: [1] } }]]));
  const d = await bc2('0xp', '0xt', '1h', 168);
  check('  ...or the last good chart, marked stale, still without a new read', reads === 0 && d.stale === true);
  const bc3 = mkBC(async () => { reads++; return { candles: [9] }; }, t, new Map([[key, { at: t - 16000, transient: true }]]));
  const d3 = await bc3('0xp', '0xt', '1h', 168);
  check('  ...after 15 s the chain is asked again', reads === 1 && d3.candles[0] === 9);
  const bc4 = mkBC(async () => { reads++; return { candles: [9] }; }, t, new Map([[key, { at: t - 60000, transient: false }]]));
  threw = null; try { await bc4('0xp', '0xt', '1h', 168); } catch (e) { threw = e; }
  check('a failure that is not passing is remembered for five minutes: no re-read, and it stays permanent (→ 502, never a retry loop)', reads === 1 && threw && !threw.transient, reads);
  const bc5 = mkBC(async () => { reads++; return { candles: [9] }; }, t, new Map([[key, { at: t - 301000, transient: false }]]));
  await bc5('0xp', '0xt', '1h', 168);
  check('  ...and asked again after that', reads === 2, reads); }
check('a chart failure is remembered with its kind, and the sweep keeps the marks five minutes', /chartFailAt\.set\(key, \{ at: now\(\), transient: chainTransient\(err\) \}\);/.test(SRC) && /pruneCache\(chartFailAt, 2000, CHART_FAIL_PERM_MS, v => v\.at\);/.test(SRC));
check('checkPrices is worked out only from a pool read already made (never starts one)', /const fromRead = \(tok\) => \{ const c = poolStateCache\.get\(tok\); return c && now\(\) - c\.at < POOL_TTL \? guardedPriceUsd\(tok\) : null; \};/.test(SRC));
const layoutSrc = grab(/async function pairLayoutStrict\(pairAddr\) \{[\s\S]*?\n\}\n/, 'pairLayoutStrict');
{ const word = (a) => '0x' + '0'.repeat(24) + a.slice(2);
  const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);
  const mkL = (answer) => { const cache = new Map(); return { cache, fn: new Function('_pairTokensCache', 'pruneCache', 'rpcRetry', 'ethCallStrict', layoutSrc + '\nreturn pairLayoutStrict;')(cache, () => {}, (f) => f(), async (p, d) => answer(d)) }; };
  const ok = mkL((d) => word(d === '0x0dfe1681' ? A : B)); const v = await ok.fn('0xPAIR');
  check('pairLayoutStrict: both sides read, and cached', v.token0 === A && v.token1 === B && ok.cache.get('0xpair') === v);
  const ref = mkL(() => { throw new Error('rpc http 429'); }); let threw = null; try { await ref.fn('0xpair'); } catch (e) { threw = e; }
  check('pairLayoutStrict: a refusal throws and caches nothing', threw && /429/.test(threw.message) && ref.cache.size === 0);
  const rev = mkL(() => { throw new Error('execution reverted'); }); const r = await rev.fn('0xpair');
  check('pairLayoutStrict: a revert is a definite empty side, not cached', r.token0 === null && r.token1 === null && rev.cache.size === 0);
  const eoa = mkL(() => '0x'); const e = await eoa.fn('0xpair');
  check('pairLayoutStrict: an empty answer (no contract) is a definite empty side', e.token0 === null && e.token1 === null); }
check('the chart reads the layout strictly, BEFORE the log read, and a wrong pool returns null with no log read', /const layout = await pairLayoutStrict\(pairAddr\);[\s\S]{0,300}?if \(token0 !== tokLc && token1 !== tokLc\) return null;[\s\S]{0,200}?getLogsSpan\(pairAddr, \[SWAP_TOPIC\], Math\.max\(0, head - span\), head, budget\)/.test(SRC));
check('no swaps can be placed in time → a passing failure (a stale chart, or { retry } for the widget), never an empty chart', /throw Object\.assign\(new Error\('found ' \+ logs\.length \+ ' swaps but the chain did not answer the block-time reads'\), \{ transient: true, noRetry: true \}\);/.test(SRC));
check('every drawn chart is also kept in chartLastGood (least recently drawn dropped first), which the sweep keeps for six hours (300 at most)', /chartCache\.set\(key, \{ at: now\(\), data \}\);\n  chartLastGood\.delete\(key\); chartLastGood\.set\(key, \{ at: now\(\), data \}\);/.test(SRC) && /pruneCache\(chartLastGood, 300, CHART_STALE_MAX_MS, v => v\.at\);/.test(SRC));
check('a passing failure answers 200 { retry: true } (an origin 502 has its JSON replaced at the edge); anything else 502', /if \(chainTransient\(e\)\) return send\(res, 200, \{ pair, token, tf, error: 'the chain is not answering reads just now', retry: true \}\);\s+return bad\(res, 'could not read the chain', 502\);/.test(SRC));
check('a stale chart is barely cached by the browser (5 s)', /const maxAge = data\.stale \? 5 : CHART_TF\[tf\] <= 60 \? 2 : 30;/.test(SRC));

/* ---------------- 1b. wide chart windows, read in pieces the node accepts ---------------- */
const spanSrc = grab(/async function getLogsSpan\(address, topics, from, to, budget\) \{[\s\S]*?\n\}\n/, 'getLogsSpan');
const tooManySrc = grab(/const TOO_MANY_RE = [^\n]*\n/, 'TOO_MANY_RE');
check('the node\'s one-call window is the measured 10,000,000 blocks', /const PHIST_WINDOW_MAX = 10000000;/.test(SRC));
check('the chart reads its swaps through getLogsSpan over numbers, not one call to "latest"', /getLogsSpan\(pairAddr, \[SWAP_TOPIC\], Math\.max\(0, head - span\), head, budget\)/.test(SRC) && !/rpc\('eth_getLogs', \[\{ address: pairAddr, topics: \[SWAP_TOPIC\], fromBlock, toBlock: 'latest' \}\]\)/.test(SRC));
const spanConsts = grab(/const LOG_SPAN_CALLS = 40, LOG_SPAN_MS = 40 \* 1000, LOG_SPAN_FLOOR = 100000;/, 'LOG_SPAN_CALLS');
const mkSpan = (rpcImpl, nowFn) => new Function('rpc', 'rpcRetry', 'PHIST_WINDOW_MAX', 'now', spanConsts + '\n' + tooManySrc + spanSrc + '\nreturn getLogsSpan;')(rpcImpl, (f) => f(), 10000000, nowFn || (() => 0));
{
  const calls = []; const span = mkSpan(async (m, [q]) => { const a = parseInt(q.fromBlock, 16), b = parseInt(q.toBlock, 16); if (b - a + 1 > 10000000) throw new Error('only 10000000 are allowed'); calls.push([a, b]); return [{ blockNumber: q.fromBlock }]; });
  const head = 83_635_657, from = head - 25_920_000;   // the 720-hour window at ~10 blocks a second
  const logs = await span('0xpair', ['0xswap'], from, head);
  const covered = calls.reduce((n, [a, b]) => n + (b - a + 1), 0);
  check('a 720-hour window is read in pieces of at most 10,000,000 blocks', calls.length === 3 && calls.every(([a, b]) => b - a + 1 <= 10000000), JSON.stringify(calls));
  check('  ...the pieces cover the span exactly once, in order, with no gap and no overlap', calls[0][0] === from && calls[calls.length - 1][1] === head && covered === head - from + 1 && calls.every((c, i) => i === 0 || c[0] === calls[i - 1][1] + 1), covered);
  check('  ...and the logs come back in block order', logs.length === 3 && logs.map((l) => parseInt(l.blockNumber, 16)).every((b, i, a) => i === 0 || b > a[i - 1]));
}
{
  const calls = []; const span = mkSpan(async (m, [q]) => { calls.push(1); return []; });
  await span('0xpair', ['0xswap'], 0, 9_999_999);
  check('exactly 10,000,000 blocks is one call', calls.length === 1);
}
{
  const calls = []; const span = mkSpan(async (m, [q]) => { const a = parseInt(q.fromBlock, 16), b = parseInt(q.toBlock, 16); calls.push([a, b]); if (b - a > 500000) throw new Error('query returned more than 10000 results'); return [a]; });
  const logs = await span('0xpair', ['0xswap'], 1_000_000, 2_999_999);
  check('a piece the node calls too big is halved until it answers', logs.length === 4 && calls.filter(([a, b]) => b - a <= 500000).length === 4, JSON.stringify(calls));
}
{
  const calls = []; const span = mkSpan(async (m, [q]) => { calls.push(1); throw new Error('This operation was aborted'); });
  let threw = null; try { await span('0xpair', ['0xswap'], 0, 9_999_999); } catch (e) { threw = e; }
  check('halving stops at 100,000 blocks and at 40 calls a request', threw && calls.length <= 40, calls.length);
}
{
  let clock = 0; const calls = []; const span = mkSpan(async (m, [q]) => { calls.push(1); clock += 15000; return []; }, () => clock);
  let threw = null; try { await span('0xpair', ['0xswap'], 0, 40_000_000); } catch (e) { threw = e; }
  check('and gives up after 40 seconds of reading rather than keeping a visitor waiting — a passing failure (slow node), not a permanent one', threw && threw.transient === true && /too slowly/.test(threw.message) && calls.length === 3, calls.length);
}
{
  const calls = []; const span = mkSpan(async (m, [q]) => { calls.push(1); return []; });
  let threw = null; try { await span('0xpair', ['0xswap'], 0, 450_000_000); } catch (e) { threw = e; }
  check('forty pieces is the most one request reads: past that the window is too large, and that is permanent', threw && /too large for one request/.test(threw.message) && !threw.transient && calls.length === 40, calls.length);
}
{
  let threw = null; const span = mkSpan(async () => { throw new Error('rpc http 429'); });
  try { await span('0xpair', ['0xswap'], 0, 100); } catch (e) { threw = e; }
  check('a refusal that is not "too big" is thrown for the chart\'s retry to handle', threw && /429/.test(threw.message));
}

/* ---------------- 1c. the live price (/api/price, polled once a second by every open chart) ---------------- */
const spotSrc = grab(/async function spotPrice\(pairAddr, tokenAddr\) \{[\s\S]*?\n\}\n/, 'spotPrice');
{
  const TOK = '0x' + 'a'.repeat(40), WETH = '0x' + '4'.repeat(40), USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
  const word = (n) => BigInt(n).toString(16).padStart(64, '0');
  const reserves = (r0, r1) => '0x' + word(r0) + word(r1) + word(0);
  const mkSpot = ({ res, layout, dec = 18, usdgDec = 6 }) => {
    const cache = new Map();
    const fn = new Function('spotCache', 'spotInflight', 'SPOT_TTL', 'SPOT_NEG_TTL', 'now', 'rpcRetry', 'ethCallStrict', 'pairLayoutStrict', 'tokenDecimals', 'USDG_ADDR', 'usdgDecimals',
      spotSrc + '\nreturn spotPrice;')(cache, new Map(), 900, 60000, () => t, (f) => f(), async () => { if (res instanceof Error) throw res; return res; },
      async () => (layout instanceof Error ? (() => { throw layout; })() : layout), async (a) => (a === USDG ? usdgDec : dec), USDG, null);
    return { fn, cache };
  };
  { const m = mkSpot({ res: new Error('rpc http 429'), layout: { token0: TOK, token1: WETH } }); let threw = null;
    try { await m.fn('0xpair', TOK); } catch (e) { threw = e; }
    check('live price: a refused reserves read throws and caches nothing (it was a minute-long "not a pool")', threw && /429/.test(threw.message) && m.cache.size === 0); }
  { const m = mkSpot({ res: reserves(10n ** 18n, 2n * 10n ** 18n), layout: new Error('rpc http 429') }); let threw = null;
    try { await m.fn('0xpair', TOK); } catch (e) { threw = e; }
    check('live price: a refused layout read throws — the side is never guessed, nothing cached', threw && /429/.test(threw.message) && m.cache.size === 0); }
  { const m = mkSpot({ res: reserves(10n ** 18n, 2n * 10n ** 18n), layout: { token0: null, token1: WETH } });
    check('live price: a layout side that read empty is a definite "not a v2 pair", remembered', (await m.fn('0xpair', TOK)) === null && m.cache.get('0xpair:' + TOK).neg === true); }
  { const m = mkSpot({ res: new Error('execution reverted'), layout: { token0: TOK, token1: WETH } });
    check('live price: a revert is a definite no, remembered', (await m.fn('0xpair', TOK)) === null && m.cache.get('0xpair:' + TOK).neg === true); }
  { const m = mkSpot({ res: '0x', layout: { token0: null, token1: null } });
    check('live price: an empty answer (not a contract) is a definite no, remembered', (await m.fn('0xpair', TOK)) === null && m.cache.get('0xpair:' + TOK).neg === true); }
  { const m = mkSpot({ res: reserves(3n * 10n ** 18n, 10n ** 18n), layout: { token0: WETH, token1: TOK } });
    const px = await m.fn('0xpair', TOK);
    check('live price: the token as token1 is priced from the right side (3 WETH : 1 token → 3)', Math.abs(px - 3) < 1e-12, px); }
  { const m = mkSpot({ res: reserves(2n * 10n ** 18n, 5n * 10n ** 6n), layout: { token0: TOK, token1: USDG } });
    const px = await m.fn('0xpair', TOK);
    check('live price: a USDG quote is scaled by its own 6 decimals (2 tokens : 5 USDG → 2.5)', Math.abs(px - 2.5) < 1e-12, px); }
  { const m = mkSpot({ res: reserves(10n ** 18n, 10n ** 18n), layout: { token0: WETH, token1: '0x' + 'b'.repeat(40) } });
    check('live price: a pool that does not hold the token is a definite no', (await m.fn('0xpair', TOK)) === null && m.cache.get('0xpair:' + TOK).neg === true); }
  { const m = mkSpot({ res: reserves(10n ** 18n, 10n ** 18n), layout: { token0: TOK, token1: WETH }, dec: null }); let threw = null;
    try { await m.fn('0xpair', TOK); } catch (e) { threw = e; }
    check('live price: unreadable decimals throw instead of assuming 18', threw && /decimals/.test(threw.message) && m.cache.size === 0); }
}
check('the price route says the chain is not answering when that is why', /why = chainTransient\(e\) \? 'the chain is not answering reads just now'/.test(SRC));

check('a house-coin lookup whose pool read failed is reported as unavailable, never cached as a priceless finding', /if \(ownPoolOf\(tokenAddr\) && !p\.indexed && \(!p\.market \|\| p\.market\.priceUsd == null\)\) return \{ unavailable: true, reason: 'the pool could not be read just now' \};/.test(SRC));
check('the scan and lookup routes log an unexpected error and answer fixed words, keeping a designed refusal\'s own', ['scan', 'lookup'].every((w) => new RegExp("if \\(e && e\\.status\\) return bad\\(res, e\\.message, e\\.status\\);\\s+console\\.error\\('\\[" + w + "\\] '").test(SRC) && !new RegExp("\\(e && e\\.message\\) \\|\\| '" + w + " failed").test(SRC)));

{ // the quote side of a pool is worked out per call, never cached from whoever asked first
  const pqSrc = grab(/async function pairQuote\(pairAddr, tokenAddr\) \{[\s\S]*?\n\}\n/, 'pairQuote');
  const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73', SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105';
  const pq = new Function('pairTokens', 'lcAddr', pqSrc + '\nreturn pairQuote;')(async () => ({ token0: WETH, token1: SEND }), (a) => String(a || '').toLowerCase());
  const first = await pq('0xpool', WETH), then = await pq('0xpool', SEND), stranger = await pq('0xpool', '0x' + '9'.repeat(40));
  check('pairQuote: asking about WETH first no longer poisons the $SEND pool — $SEND\'s quote is still WETH', first === SEND && then === WETH, first + ' / ' + then);
  check('  ...a token not in the pool has no quote side', stranger === null);
  check('  ...and pairQuote writes nothing to a per-pool cache', !/pairQuoteCache\.set/.test(pqSrc));
}

/* ---------------- 2. the pool read ---------------- */
const poolConsts = grab(/const POOL_WARN_EVERY_MS = [^;]+;\nconst _poolWarn = new Map\(\);[^\n]*\n/, 'POOL_WARN_EVERY_MS');
const poolWarnSrc = grab(/function poolWarn\(sym, e\) \{[\s\S]*?\n\}\n/, 'poolWarn');
const poolCallSrc = grab(/function poolCall\(fn\) \{[^\n]*\n/, 'poolCall');
const poolStateSrc = grab(/async function poolState\(token\) \{[\s\S]*?\n\}\n/, 'poolState');
const readPoolSrc = grab(/async function readPoolState\(token, pair\) \{[\s\S]*?\n\}\n/, 'readPoolState');
check('the pool read has no stale stand-in: an old price never reaches Send Calls, badges or gates', !/POOL_STALE_MAX_MS/.test(SRC) && !/stale: true/.test(poolStateSrc) && /source: 'reserves', readAt: st\.at,\n/.test(SRC));
check('every chain call in the pool read is asked once more when refused (poolCall)', (readPoolSrc.match(/poolCall\(\(\) => /g) || []).length === 8 && !/[^>] rpc\('eth_getLogs'/.test(readPoolSrc.replace(/poolCall\(\(\) => rpc\('eth_getLogs'/g, '')), (readPoolSrc.match(/poolCall\(\(\) => /g) || []).length);
{ let calls = 0; const pc = new Function('isThrottle', 'setTimeout', poolCallSrc + '\nreturn poolCall;')(isThrottle, instant);
  const v = await pc(async () => { if (++calls === 1) throw new Error('rpc http 429'); return 7; });
  check('poolCall: one refusal, then the answer', v === 7 && calls === 2);
  calls = 0; let threw = null; try { await pc(async () => { calls++; throw new Error('rpc http 429'); }); } catch (e) { threw = e; }
  check('poolCall: asks twice at most', calls === 2 && threw);
  calls = 0; threw = null; try { await pc(async () => { calls++; throw new Error('execution reverted'); }); } catch (e) { threw = e; }
  check('poolCall: a revert is not asked again', calls === 1 && threw); }
{
  const lines = []; let nowMs = t;
  const warn = new Function('now', 'console', poolConsts + '\n' + poolWarnSrc + '\nreturn poolWarn;')(() => nowMs, { warn: (l) => lines.push(l) });
  warn('SEND', new Error('rpc http 429'));
  check('the first failure is said at once', lines.length === 1 && /\[pool\] SEND could not be read: rpc http 429$/.test(lines[0]), lines[0]);
  for (let i = 0; i < 10; i++) { nowMs += 15000; warn('SEND', new Error('rpc http 429')); }
  check('ten more within five minutes add no lines', lines.length === 1, lines.length);
  nowMs += 5 * 60000; warn('SEND', new Error('rpc http 429'));
  check('after five minutes it is said again, with the count of what went unsaid', lines.length === 2 && /\(11 failed reads since the last note\)$/.test(lines[1]), lines[1]);
  warn('GWC', new Error('rpc http 429'));
  check('each pool has its own clock', lines.length === 3 && /\[pool\] GWC could not be read/.test(lines[2]));
}
{
  const mk = (read, cache, nowMs) => {
    const warned = []; let reads = 0;
    const fn = new Function('ownPoolOf', 'poolStateCache', 'poolStateInflight', 'readPoolState', 'poolWarn', 'now', 'POOL_TTL',
      poolStateSrc + '\nreturn poolState;')(() => ({ sym: 'SEND', pair: '0xpair' }), cache, new Map(), (...a) => { reads++; return read(...a); }, (s) => warned.push(s), () => nowMs, 15000);
    return { fn, warned, reads: () => reads };
  };
  { const cache = new Map([['0xtok', { at: t - 20000, spot: 1 }]]); const m = mk(async () => { throw new Error('rpc http 429'); }, cache, t);
    const st = await m.fn('0xTOK');
    check('a failed read answers null even with a 20-second-old value in hand, and warns', st === null && m.warned.length === 1);
    check('  ...and is never cached: the next caller reads again', (await m.fn('0xTOK')) === null && m.reads() === 2 && cache.get('0xtok').spot === 1); }
  { const cache = new Map(); const m = mk(async () => ({ at: t, spot: 2 }), cache, t);
    const st = await m.fn('0xTOK');
    check('a read that works is cached and returned', st.spot === 2 && cache.get('0xtok') === st && m.reads() === 1); }
}
check('guardedPriceUsd is as it was', /if \(!st \|\| !\(st\.spot > 0\) \|\| !\(st\.median > 0\) \|\| st\.covered < POOL_WINDOW_MS\) return null;/.test(SRC));

/* ---------------- 3. clientError ---------------- */
const ceSrc = grab(/server\.on\('clientError', \(err, socket\) => \{[\s\S]*?\n\}\);\n/, 'clientError');
let handler = null;
new Function('server', ceSrc)({ on: (ev, fn) => { if (ev === 'clientError') handler = fn; } });
const sock = (o) => { const s = { writable: true, bytesRead: 0, ended: null, destroyed: false, ...o }; s.end = (b, cb) => { s.ended = b; if (cb) cb(); }; s.destroy = () => { s.destroyed = true; }; return s; };
{ const s = sock({ bytesRead: 0 }); handler(Object.assign(new Error('timeout'), { code: 'ERR_HTTP_REQUEST_TIMEOUT' }), s);
  check('a connection that never sent a byte and timed out is closed with nothing written', s.destroyed && s.ended === null); }
{ const s = sock({ bytesRead: 12 }); handler(Object.assign(new Error('timeout'), { code: 'ERR_HTTP_REQUEST_TIMEOUT' }), s);
  check('a request that stalled mid-headers gets a 408 and Connection: close, then the socket is closed', s.destroyed && /^HTTP\/1\.1 408 Request Timeout\r\nConnection: close\r\n\r\n$/.test(s.ended), JSON.stringify(s.ended)); }
{ const s = sock({ bytesRead: 5 }); handler(Object.assign(new Error('Parse Error'), { code: 'HPE_INVALID_METHOD' }), s);
  check('malformed HTTP still gets its 400, then the socket is closed', s.destroyed && /^HTTP\/1\.1 400 Bad Request\r\nConnection: close\r\n\r\n$/.test(s.ended), JSON.stringify(s.ended)); }
{ const s = sock({ bytesRead: 5 }); handler(Object.assign(new Error('reset'), { code: 'ECONNRESET' }), s);
  check('a reset peer is just dropped', s.destroyed && s.ended === null); }
{ const s = sock({ writable: false }); handler(Object.assign(new Error('Parse Error'), { code: 'HPE_INVALID_METHOD' }), s);
  check('nothing is written to a socket that cannot be written to', s.destroyed && s.ended === null); }
{ const s = sock({}); s.end = () => { throw new Error('boom'); }; let threw = false; try { handler(new Error('x'), s); } catch { threw = true; }
  check('a socket that throws on write does not take the server down', !threw); }
check('the timeouts around it are unchanged (65 s keep-alive, 66 s headers, 60 s request)', /server\.keepAliveTimeout = 65000;/.test(SRC) && /server\.headersTimeout = 66000;/.test(SRC) && /server\.requestTimeout = 60000;/.test(SRC));

/* ---------------- the widget ---------------- */
check('chart.js: the chain not answering ({ retry: true } or a dropped connection) is asked again after 5, 10 and 15 s, then once a minute', /if \(kind === 'chain'\) wait = n <= 3 \? 5000 \* n : 60000;/.test(CHART) && /if \(d\.retry\) return retryAfterFailure\(host, seq, status, 'chain'\);/.test(CHART) && /if \(!res\) return retryAfterFailure\(host, seq, status, 'chain'\);/.test(CHART));
check('chart.js: an answer with no JSON is asked again three times — then left, unless a stale chart on screen promised to keep asking', /else if \(kind === 'edge'\) wait = n <= 3 \? 5000 \* n : stale \? 60000 : 0;/.test(CHART) && /if \(!d\) return retryAfterFailure\(host, seq, status, 'edge'\);/.test(CHART));
check('chart.js: each failure kind keeps its own count', /const n = kind === 'edge' \? \(host\._edgeRetries = \(host\._edgeRetries \|\| 0\) \+ 1\) : \(host\._retries = \(host\._retries \|\| 0\) \+ 1\);/.test(CHART));
check('chart.js: this site\'s own 429 waits a minute; any other error is shown and not retried', /if \(res\.status === 429\) return retryAfterFailure\(host, seq, status, 'slow'\);\n\s+if \(d\.error\) \{ host\._reasking = false; status\.textContent = '⚠️ ' \+ d\.error;/.test(CHART));
check('chart.js: the failure says which thing failed (the chain, the site, too many requests) and when it will try again, or that it will not', /'This network is sending too many requests just now'/.test(CHART) && /'The site could not be reached just now'/.test(CHART) && /'The chain is not answering reads just now'/.test(CHART) && /'\. Reload the page to try again\.'/.test(CHART));
check('chart.js: re-asks wait while the tab is hidden or the chart is off screen', /if \(document\.hidden \|\| host\._visible === false\) \{ host\._againTimer = setTimeout\(fire, 15000\); return; \}/.test(CHART));
check('chart.js: a new timeframe resets the retries, the zoom, the words, and stops the old live tick', /if \(!again\) \{\n\s+host\._retries = 0;[^\n]*\n\s+host\._view = defaultView\(\);[^\n]*\n\s+host\._sayNow = true;[^\n]*\n\s+stopTicking\(host\);/.test(CHART));
check('chart.js: a stale chart is asked for again every minute and gets no live tick', /if \(d\.stale\) againLater\(host, seq, 60000\);/.test(CHART) && /if \(d\.stale\) stopTicking\(host\); else startTicking\(host\);/.test(CHART));
check('chart.js: the stale age counts on from the server\'s ageMs, and the line promises a re-ask only while one is pending', /if \(d\.stale\) d\._staleAt = Date\.now\(\) - \(Number\(d\.ageMs\) \|\| 0\);/.test(CHART) && /\(host\._reasking \? 'This page asks again every minute while you are looking at it\. ' : 'Reload the page to try again\. '\)/.test(CHART) && /host\._reasking = true;/.test(CHART) && /'⛓️ on-chain · as of '/.test(CHART));
check('chart.js: a stale chart past the age the server allows is taken down when a re-ask fails', /if \(d0\.stale && d0\._staleAt && d0\.staleMaxMs && Date\.now\(\) - d0\._staleAt > d0\.staleMaxMs\) host\._data = \{ points: \[\] \};/.test(CHART));
check('chart.js: a re-ask keeps the markers already drawn (they come from this site, not the chain)', /if \(again && host\._data && host\._data\.markers && host\._data\.tf === d\.tf\) \{ d\.markers = host\._data\.markers; d\._devLoaded = host\._data\._devLoaded; \}/.test(CHART) && /if \(!\(again && d\.markers\)\) loadMarkers\(host\);/.test(CHART));
check('chart.js: with nothing drawn, the status line says what the canvas says', /if \(!pts\.length\) return data\._msg \|\| data\.note \|\| 'No trades to chart yet\.';/.test(CHART));

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
