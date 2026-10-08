/* The transfer walk's resume and its own progress reports (transferLogWalk's opts.resume / opts.onWindow), and the
   pace's way with the node's refusals: a 403 is a throttle like a 429, one call waits a refusal out for up to
   PACE_THROTTLE_MAX_MS with the read's guard told, then fails with the wait named (still a throttle to the route).
   Seen 2026-10-08: the node refused this address for minutes (403, then 429) and the day's one live first read died
   after 90 s of retries. Lifted from server.js and driven with stubs and a fake clock. No server needed. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SERVER_JS } from './_paths.mjs';

const SRC = readFileSync(SERVER_JS, 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const grab = (re, what) => { const m = SRC.match(re); if (!m) { console.error('could not lift ' + what); process.exit(1); } return m[0]; };

/* ═══ 1. the walk: resume and onWindow ═══ */
try {
  const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', W = '0x' + '1'.repeat(40), wt = '0x' + W.slice(2).padStart(64, '0');
  const SETS = [[T, null, wt], [T, wt]], CAP = 30000, HEAD = 100000;
  const hx = (n) => '0x' + n.toString(16);
  const log = (b, i) => ({ address: '0x' + 'a'.repeat(40), topics: [T, '0x' + '0'.repeat(64), wt], data: '0x' + '1'.padStart(64, '0'), blockNumber: hx(b), logIndex: hx(i), transactionHash: '0x' + String(b).padStart(64, '0') });
  // a transfer from the wallet TO the wallet answers both passes: in pass 0 at 5,000 and 70,000 (and in pass 1 again)
  const selfLog = (b, i) => ({ ...log(b, i), topics: [T, wt, wt] });
  const HITS = { 0: [selfLog(5000, 9), log(12345, 1), selfLog(20000, 7), selfLog(70000, 8)], 1: [log(50000, 2), selfLog(5000, 9), selfLog(20000, 7), selfLog(70000, 8)] };   // pass 0 ("to the wallet"): hits at 5,000 (self), 12,345, 20,000 (self), 70,000 (self) · pass 1 ("from"): 50,000 and the three self-transfers again
  function harness() {
    const R = { windows: [], reports: [] };
    const read = async (q) => {
      const f = parseInt(q.fromBlock, 16), t = parseInt(q.toBlock, 16), span = t - f + 1, pass = q.topics.length === 3 ? 0 : 1;
      if (span > CAP) throw new Error('query spans ' + span + ' blocks (' + f + ' to ' + t + '), but only ' + CAP + ' are allowed for this request; narrow the block range, or add an address filter');
      R.windows.push([pass, f, t]);
      return HITS[pass].filter((l) => parseInt(l.blockNumber, 16) >= f && parseInt(l.blockNumber, 16) <= t);
    };
    const readMany = async (qs) => { const out = []; for (const q of qs) out.push(await read(q)); return out; };
    const ctx = vm.createContext({ Infinity, Math, Set, Array, Number, parseInt, Error, Promise, console, String, sleep: async () => {}, rpcRetry: () => { throw new Error('no network'); }, rpc: () => { throw new Error('no network'); } });
    vm.runInContext(grab(/const LOG_WINDOWS_PER_BATCH = [^\n]+\n/, 'LOG_WINDOWS_PER_BATCH') + grab(/const TOO_MANY_RE = [^\n]+\n/, 'TOO_MANY_RE') + grab(/async function transferLogWalk\(address, topicSets, start, head, max, read, opts\) \{[\s\S]*?\n\}\n/, 'transferLogWalk') + 'this.walk = transferLogWalk;', ctx);
    R.walk = (start, head, opts) => ctx.walk(null, SETS, start, head, 1000, read, { laterPassesStartAtFirstHit: true, readMany, onWindow: async (st) => R.reports.push({ pass: st.pass, from: st.from, earliest: st.earliest, n: st.logs.length }), ...(opts || {}) });
    return R;
  }
  // from scratch: pass 0 over [0, 100000] in 30,000-block windows (4), pass 1 from the first hit (3)
  let R = harness(); let logs = await R.walk(0, HEAD);
  const p0 = R.windows.filter((w) => w[0] === 0), p1 = R.windows.filter((w) => w[0] === 1);
  check('from scratch: pass 0 walks [0, 100,000] in four 30,000-block windows, pass 1 four from the first hit (5,000); a self-transfer answers both passes and is kept once', p0.length === 4 && p0[0][1] === 0 && p0[3][2] === HEAD && p1.length === 4 && p1[0][1] === 5000 && p1[3][2] === HEAD && logs.length === 5, JSON.stringify(R.windows) + ' ' + logs.length);
  check('  ...onWindow after each batch: the pass, the next block to read, the earliest hit, the logs so far', R.reports.length === 2 && R.reports[0].pass === 0 && R.reports[0].from === HEAD + 1 && R.reports[0].earliest === 5000 && R.reports[0].n === 4 && R.reports[1].pass === 1 && R.reports[1].from === HEAD + 1 && R.reports[1].n === 5, JSON.stringify(R.reports));
  // resume in pass 0 at 60,000 with the earliest hit carried: nothing below 60,000 is read again in pass 0; pass 1 still starts at the carried hit
  R = harness(); logs = await R.walk(0, HEAD, { resume: { pass: 0, from: 60000, earliest: 12345 } });
  const q0 = R.windows.filter((w) => w[0] === 0), q1 = R.windows.filter((w) => w[0] === 1);
  check('resumed in pass 0 at 60,000: two windows [60,000, 89,999] [90,000, 100,000], nothing below', q0.length === 2 && q0[0][1] === 60000 && q0[1][2] === HEAD && q0.every((w) => w[1] >= 60000), JSON.stringify(q0));
  check('  ...pass 1 starts at the carried earliest hit (12,345), three windows', q1.length === 3 && q1[0][1] === 12345, JSON.stringify(q1));
  check('  ...the logs are only what those windows hold (the checkpoint keeps the rest): pass 1\'s 50,000 and the self-transfer at 70,000 once — the ones at 5,000 and 20,000, below the resumed block, were pass 0\'s and sit in the checkpoint, so pass 1 (which reads 20,000 again) does not keep them', logs.length === 2 && logs.map((l) => parseInt(l.blockNumber, 16)).sort((a, b) => a - b).join() === '50000,70000', JSON.stringify(logs.map((l) => parseInt(l.blockNumber, 16))));
  check('  ...and the first report carries the resumed earliest', R.reports[0].earliest === 12345 && R.reports[0].pass === 0, JSON.stringify(R.reports[0]));
  // resume in pass 1 at 70,000: pass 0 is not read at all
  R = harness(); logs = await R.walk(0, HEAD, { resume: { pass: 1, from: 70000, earliest: 12345 } });
  check('resumed in pass 1 at 70,000: pass 0 is skipped, pass 1 reads [70,000, 99,999] [100,000, 100,000] — and keeps nothing the finished pass 0 kept: the self-transfer at 70,000 is in the checkpoint', R.windows.every((w) => w[0] === 1) && R.windows.length === 2 && R.windows[0][1] === 70000 && R.windows[1][2] === HEAD && logs.length === 0, JSON.stringify(R.windows) + ' ' + logs.length);
  // ...while a plain transfer FROM the wallet in that span is new to the walk and kept
  R = harness(); HITS[1].push(log(85000, 3)); logs = await R.walk(0, HEAD, { resume: { pass: 1, from: 70000, earliest: 5000 } }); HITS[1].pop();
  check('  ...a transfer from the wallet to someone else in that span is kept (pass 0 never saw it)', logs.length === 1 && parseInt(logs[0].blockNumber, 16) === 85000, logs.length);
  // a resume with no earliest hit yet (null): pass 1 after a pass 0 that finds nothing is skipped as from scratch
  R = harness(); logs = await R.walk(0, HEAD, { resume: { pass: 0, from: 90000, earliest: null } });
  check('a resume before any hit (earliest null) behaves as from scratch: a hitless pass 0 means no pass 1', R.windows.length === 1 && R.windows[0][0] === 0 && R.windows[0][1] === 90000 && logs.length === 0, JSON.stringify(R.windows));
  // a malformed resume is ignored
  R = harness(); await R.walk(0, HEAD, { resume: { pass: 7, from: 1 } });
  check('a resume naming a pass the walk does not have is ignored (from scratch)', R.windows.filter((w) => w[0] === 0).length === 4, JSON.stringify(R.windows));
  // a resume on a walk that does not use the first-hit rule (both passes over the whole span)
  R = harness(); await R.walk(95000, HEAD, { laterPassesStartAtFirstHit: false, resume: { pass: 0, from: 98000, earliest: null } });
  check('without the first-hit rule, pass 1 starts at the walk\'s start (95,000), the resumed pass 0 at 98,000', R.windows.length === 2 && R.windows[0][0] === 0 && R.windows[0][1] === 98000 && R.windows[1][0] === 1 && R.windows[1][1] === 95000, JSON.stringify(R.windows));
} catch (e) { check('the walk section ran to the end', false, e && e.stack); }

/* ═══ 2. the pace: 403 is a throttle, a refusal is waited out by time, the guard is told ═══ */
try {
  let T = 1000000; const waits = [];
  const S = { fail: 0, shape: 'rpc http 429', answers: 0 };
  const refuse = () => { if (S.fail > 0) { S.fail--; throw new Error(S.shape); } };
  const ctx = vm.createContext({ Math, Error, String, Array, Number, console, Promise, now: () => T, sleep: async (ms) => { T += ms; waits.push(ms); },
    rpc: async () => { refuse(); S.answers++; return 'ok'; }, rpcBatch: async (part) => { refuse(); S.answers++; return part.map(() => 'ok'); } });
  vm.runInContext(grab(/const PACE_MS_MIN = [^\n]+\n/, 'PACE_MS_MIN') + grab(/const PACE_REFUSED_WAIT_MAX = [^\n]+\n/, 'PACE_REFUSED_WAIT_MAX') + grab(/let _paceAt = 0, _paceMs = PACE_MS_START;\n/, '_paceAt') +
    grab(/async function paceTake\(weight\) \{[\s\S]*?\n\}\n/, 'paceTake') + grab(/const paceOk = [^\n]+\n/, 'paceOk') + grab(/const paceRefused = [^\n]+\n/, 'paceRefused') + grab(/function paceYield\(\) \{[^\n]+\n/, 'paceYield') +
    grab(/const isThrottle = [^\n]+\n/, 'isThrottle') + grab(/const refusedTooLong = [^\n]+\n/, 'refusedTooLong') + grab(/const isBlip = [^\n]+\n/, 'isBlip') +
    grab(/async function pacedCall\(method, params, weight, guard\) \{[\s\S]*?\n\}\n/, 'pacedCall') + grab(/async function pacedBatchAll\(calls, onStep, guard, onPart\) \{[\s\S]*?\n\}\n/, 'pacedBatchAll') +
    'this.call = pacedCall; this.batch = pacedBatchAll; this.isThrottle = isThrottle;', ctx);
  check('the pace constants: 40 tries at most, a wait of up to 30 s a refusal, ten minutes of refusals a call', /PACE_TRIES = 40;/.test(SRC) && /const PACE_REFUSED_WAIT_MAX = 30000, PACE_THROTTLE_MAX_MS = 10 \* 60 \* 1000;/.test(SRC));
  check('"rpc http 403" is a throttle, like 429 and "too many requests"; a revert that happens to say 403 is not, nor a 500', ctx.isThrottle(new Error('rpc http 403')) && ctx.isThrottle(new Error('rpc http 429')) && ctx.isThrottle('Too Many Requests') && !ctx.isThrottle(new Error('execution reverted: 403')) && !ctx.isThrottle(new Error('rpc http 500')));
  check('the site\'s own reads (rpc) make the tracker give way on a 403 as on a 429, and rpcRetry backs off on both', /if \(!paced && \(res\.status === 429 \|\| res\.status === 403\)\) paceYield\(\);/.test(SRC) && /\/429\|403\|rate\|too many requests\/i/.test(SRC));
  // twenty refusals in a row (about seven minutes of waiting) are waited out; the guard hears about the wait, with when it began
  const guards = []; S.fail = 20; S.answers = 0; waits.length = 0; let t0 = T;
  const r = await ctx.call('eth_getLogs', [{}], 1, (st) => guards.push(st ? { ...st } : null));
  const waited = waits.reduce((a, b) => a + b, 0);
  check('twenty refusals in a row are waited out and the call answers', r === 'ok' && S.answers === 1 && S.fail === 0, JSON.stringify({ r, answers: S.answers, waited }));
  check('  ...waiting 2.5 s more each time up to 30 s: between six and eight minutes in all', waited >= 6 * 60e3 && waited <= 8 * 60e3, waited);
  check('  ...the guard is told on every ask after the first refusal, with when the refusals began, and not before', guards.length === 21 && guards[0] === null && guards.slice(1).every((g) => g && g.throttled === true && g.since === t0), JSON.stringify(guards.slice(0, 3)));
  // refusals that outlast the budget fail, with the wait named and the node's words kept (so the route still reads it as a throttle)
  S.fail = 1000; S.answers = 0; waits.length = 0; t0 = T; let err = null;
  try { await ctx.call('eth_getLogs', [{}], 1, null); } catch (e) { err = e; }
  const spent = T - t0;
  check('refusals that outlast ten minutes fail the call, the wait named, the node\'s words kept, still a throttle', err && /^the chain refused this read for 1\d minutes \(rpc http 429\)$/.test(err.message) && ctx.isThrottle(err), err && err.message);
  check('  ...after ten to eleven minutes of waiting, not forty tries of thirty seconds', spent >= 10 * 60e3 && spent <= 11 * 60e3 && S.fail > 950, spent + ' ms, ' + (1000 - S.fail) + ' asks');
  // a 403 burst, the shape the node's edge answers with, is waited out the same way
  S.fail = 5; S.shape = 'rpc http 403'; S.answers = 0;
  const r2 = await ctx.call('eth_getBlockByNumber', ['0x1', false], 1, null);
  check('a burst of five 403s is waited out like 429s', r2 === 'ok' && S.answers === 1, JSON.stringify({ r2, fail: S.fail }));
  S.shape = 'rpc http 429';
  // the batch path: the same rules, the guard told per part
  const g2 = []; S.fail = 3; S.answers = 0;
  const b = await ctx.batch([['eth_call', [{}]], ['eth_call', [{}]]], null, (st) => g2.push(!!(st && st.throttled)));
  check('pacedBatchAll waits out refusals the same way and tells its guard', Array.isArray(b) && b.length === 2 && b.every((x) => x === 'ok') && g2.length === 4 && g2[0] === false && g2.slice(1).every(Boolean), JSON.stringify({ b, g2 }));
  // a non-throttle error still fails at once (a revert is an answer)
  S.fail = 1; S.shape = 'execution reverted: nope'; err = null;
  try { await ctx.call('eth_call', [{}], 1, null); } catch (e) { err = e; }
  check('a revert is not waited out: it fails at once', err && /reverted/.test(err.message), err && err.message);
  S.shape = 'rpc http 429';
  // the job's guard: a reported wait is not a stall, and the 202 says how long the read has been waiting
  check('walletJobRun\'s guard counts a reported wait as movement (not a stall) and keeps when it began; a clear ask ends it', /const guard = \(st\) => \{\s*\n[^\n]*\n\s*if \(st && st\.throttled\) \{ if \(!job\.throttledAt\) job\.throttledAt = st\.since \|\| now\(\); job\.movedAt = now\(\); \}\s*\n\s*else if \(job\.throttledAt\) \{ job\.stageThrottledMs = [^\n]*job\.throttledAt = 0; \}/.test(SRC));
  check('  ...and the 202 carries throttled: how long (ms) the read has been waiting, 0 when it is not', /throttled: job\.throttledAt \? now\(\) - job\.throttledAt : 0 \}\);/.test(SRC) && /turn: false, throttledAt: 0, stageThrottledMs: 0, checkpointed: false \};/.test(SRC));
  check('a read a person is waiting on at an open request (prices, the chart) gives a refusal a minute, not ten: its guard throws a throttle of its own', /const REQUEST_THROTTLE_MAX_MS = 60 \* 1000;/.test(SRC) && /const requestThrottleGuard = \(st\) => \{ if \(st && st\.throttled && now\(\) - st\.since > REQUEST_THROTTLE_MAX_MS\) throw new Error\('rpc http 429: [^']+'\); \};/.test(SRC) && (SRC.match(/requestThrottleGuard\(st\);/g) || []).length === 3 && /nobody is waiting for these prices'\); requestThrottleGuard\(st\); \};/.test(SRC) && /nobody is waiting for this price history'\); requestThrottleGuard\(st\); \};/.test(SRC));
  // the stage's ETA leaves the wait out: 100 windows in two minutes of reading and ten of waiting is 1.2 s a window, not 7.2
  const ectx = vm.createContext({ Math, Number, now: () => 1e12 });
  vm.runInContext('const _walletReadMs = []; const walletJobsAhead = () => 0;\n' + grab(/function walletJobEta\(job, t\) \{[\s\S]*?\n\}\n/, 'walletJobEta') + 'this.eta = walletJobEta;', ectx);
  const tS = 1e12 - 12 * 60e3;
  check('the stage ETA leaves the time spent waiting on the node out of the pace: 100 windows in 12 minutes of which 10 were a refusal → 1.2 s a window', ectx.eta({ turn: false, done: 100, total: 5100, stageAt: tS, stageThrottledMs: 10 * 60e3, throttledAt: 0 }) === 5000 * 1200 && ectx.eta({ turn: false, done: 100, total: 5100, stageAt: tS, stageThrottledMs: 5 * 60e3, throttledAt: 1e12 - 5 * 60e3 }) === 5000 * 1200, ectx.eta({ turn: false, done: 100, total: 5100, stageAt: tS, stageThrottledMs: 10 * 60e3, throttledAt: 0 }));
  check('  ...and no estimate at all when the wait is the whole of the stage so far', ectx.eta({ turn: false, done: 100, total: 5100, stageAt: tS, stageThrottledMs: 12 * 60e3, throttledAt: 0 }) === null);
  check('  ...the guard books the wait on the stage when it clears, step() resets it on a new stage (a wait still running counts for the new stage from there)', /else if \(job\.throttledAt\) \{ job\.stageThrottledMs = \(job\.stageThrottledMs \|\| 0\) \+ \(now\(\) - job\.throttledAt\); job\.throttledAt = 0; \}/.test(SRC) && /job\.stageAt = now\(\); job\.stageThrottledMs = 0; if \(job\.throttledAt\) job\.throttledAt = now\(\); \}/.test(SRC));
} catch (e) { check('the pace section ran to the end', false, e && e.stack); }

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !x ? '' : '  — ' + x)); if (ok) pass++; }
console.log(`${pass}/${results.length} passed`);
