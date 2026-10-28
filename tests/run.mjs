#!/usr/bin/env node
/* ===== The test runner ====================================================================
 * One command, a throwaway database, and a real server.
 *
 * Every suite here drives the ACTUAL HTTP API — there is no mock of this site, because the bugs
 * worth catching live in the seams a mock would paper over (a route's rate limit, a transaction's
 * isolation, what SQLite does to a BigInt). So the runner starts a real server, points it at a
 * temporary data directory, runs each suite against it, and deletes the directory afterwards.
 * That temporary directory is the important part: the suites create and delete their own rows, but
 * nothing about this run can reach data/app.db at all.
 *
 *   npm test                 — every suite
 *   npm test -- gate auth    — only suites whose names contain "gate" or "auth"
 *   npm test -- --keep       — leave the temporary data directory behind, and print where it is
 *   CHAIN_LIVE=1 npm test    — also the live reads of the public chain node (off by default: from the machine that serves
 *                              the site they throttle its own chain reads for minutes, and GitHub's runners are refused);
 *                              without it the throwaway server reaches nothing off this machine (THE GUARD, below)
 *
 * Exit code is 0 only if every assertion in every suite passed.
 */
import { spawn } from 'node:child_process';
import { readdirSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { ROOT } from './_paths.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const verbose = args.includes('--verbose');   // every check a suite printed, not only the failures
const filters = args.filter(a => !a.startsWith('--'));

/* Suites that are slow on purpose go last, so a fast failure is reported in seconds rather than
   after a five-minute wait for a decay sweep. */
const SLOW = new Set(['checkinmute']);

const suites = readdirSync(HERE)
  .filter(f => f.endsWith('.mjs') && !f.startsWith('_') && f !== 'run.mjs' && f !== 'gatepass.mjs')
  .map(f => f.replace(/\.mjs$/, ''))
  .filter(n => !filters.length || filters.some(f => n.includes(f)))
  .sort((a, b) => (SLOW.has(a) - SLOW.has(b)) || a.localeCompare(b));

if (!suites.length) { console.error('no suites match ' + filters.join(', ')); process.exit(1); }

// A throwaway data directory with its own encryption key, so nothing here can touch real data.
const dataDir = mkdtempSync(path.join(tmpdir(), 'jsi-test-'));
mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
writeFileSync(path.join(dataDir, '.data_key'), randomBytes(32).toString('hex'), { mode: 0o600 });

/* The port is one the OS hands out as free, never a random pick from a range. A random pick could land on
   the live server's port (8642): the throwaway server would fail to bind, and every suite would then run its
   writes against the live server and its real database. */
const LIVE_PORT = 8642;
async function freePort() {
  for (let i = 0; i < 20; i++) {
    const p = await new Promise((resolve, reject) => {
      const s = createServer(); s.unref(); s.on('error', reject);
      s.listen(0, () => { const port = s.address().port; s.close(() => resolve(port)); });
    });
    if (p !== LIVE_PORT) return p;
  }
  throw new Error('no free port');
}
const PORT = await freePort();
/* Canned GeckoTerminal and Dexscreener search answers for the token-by-name search (tests/toksearch.mjs), so the suite
   parses real response shapes without calling either: "zqfixture" gets a v4 pool (32-byte id), an HTML-escaped name, an FDV
   of "0.0", USDG as a result, and a 300-character name; "zqhalf" gets a GeckoTerminal 500 (one source down); anything else
   is an empty, healthy answer. Not used with CHAIN_LIVE=1, which asks the real ones. */
const fixture = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), q = (u.searchParams.get('query') || u.searchParams.get('q') || '').toLowerCase(), gt = u.pathname.startsWith('/gt');
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const T = (n) => '0x' + String(n).repeat(40).slice(0, 40);
  if (q === 'zqhalf' && gt) return send(500, { errors: [{ status: '500' }] });
  if (q === 'zqfixture' && gt) return send(200, {
    data: [
      { attributes: { address: '0x' + 'a'.repeat(64), fdv_usd: '12000', market_cap_usd: null, volume_usd: { h24: '5000' }, reserve_in_usd: '9000' }, relationships: { base_token: { data: { id: 'robinhood_' + T(1) } } } },
      { attributes: { address: '0x' + 'b'.repeat(40), fdv_usd: '0.0', market_cap_usd: null, volume_usd: { h24: '700' }, reserve_in_usd: '4000' }, relationships: { base_token: { data: { id: 'robinhood_' + T(2) } } } },
      { attributes: { address: '0x' + 'c'.repeat(40), fdv_usd: '100', volume_usd: { h24: '1' }, reserve_in_usd: '50' }, relationships: { base_token: { data: { id: 'robinhood_usdg' } } } },
      { attributes: { address: '0x' + 'd'.repeat(40), fdv_usd: '300', volume_usd: { h24: '0' }, reserve_in_usd: '60' }, relationships: { base_token: { data: { id: 'robinhood_' + T(3) } } } },
    ],
    included: [
      { id: 'robinhood_' + T(1), attributes: { address: T(1), name: 'Zqfixture V4', symbol: 'ZQV4' } },
      { id: 'robinhood_' + T(2), attributes: { address: T(2), name: 'S&amp;P Zqfixture', symbol: 'ZQSP' } },
      { id: 'robinhood_usdg', attributes: { address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', name: 'Zqfixture USDG', symbol: 'USDG' } },
      { id: 'robinhood_' + T(3), attributes: { address: T(3), name: 'Zqfixture ' + 'Long'.repeat(75), symbol: 'ZQLONG' } },
    ] });
  if (q === 'zqfixture') return send(200, { pairs: [{ chainId: 'robinhood', pairAddress: '0x' + 'b'.repeat(40), baseToken: { address: T(2), name: 'S&P Zqfixture', symbol: 'ZQSP' }, marketCap: 8000, fdv: 9000, volume: { h24: 650 }, liquidity: { usd: 4100 } }] });
  return send(200, gt ? { data: [] } : { pairs: null });
});
await new Promise((ok) => fixture.listen(0, '127.0.0.1', ok));
fixture.unref();
const FIXTURE = 'http://127.0.0.1:' + fixture.address().port;
const DEAD = 'http://127.0.0.1:9/';   // an address nothing listens on: a read there fails at once
const env = { ...process.env, PORT: String(PORT), JSI_DATA_DIR: dataDir, DATA_DIR: dataDir,
              BASE_URL: 'http://localhost:' + PORT, NODE_ENV: 'test', SEED_INVITE_CODE: '12345', TOS_GATE: '1', VOICE_MEMOS: '1',   // the terms step and voice memos are hidden by default; the suites still cover both
              LEDGER_COOL_MS: '5000',    // the holder ledger stands down after a rate limit — for seconds here, not a minute, so a suite can wait it out
              /* The suites spoof visitors with X-Forwarded-For (unlock, sybiltest), and every suite's sign-ups count against one
                 per-address limit (ten an hour) when the server keys them all on 127.0.0.1. Locally the repo's .env set this; a clean
                 checkout (CI) has no .env, and the sign-up suites failed there on "slow down" for weeks. */
              TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback',
              // the suites sign up dozens of accounts with the one seed code, which a live site retires once anyone is in;
              // and tests/adminpage.mjs plays the admin account as user 987654
              SEED_CODES_OPEN: '1', ADMIN_USER_IDS: '987654',
              /* never the real keyring or backups: the server reads the repo's .env, and on the Mac that serves the site that
                 .env names the key volume. Set (even empty), these win over the file, so the throwaway key in dataDir is used. */
              DATA_KEY: '', DATA_KEY_FILE: '', BACKUP_DIR: path.join(dataDir, 'backups'), KEY_ROTATE_EXTRA_DBS: '',
              /* The throwaway server reads no live chain unless CHAIN_LIVE=1: run from the Mac that serves the site, its reads
                 spent the live site's own node budget (one address) and threw its pool prices and charts into 429s; run on
                 GitHub, the node refuses them anyway. An address nothing listens on fails at once, and every suite already
                 takes its honest "could not be read" branch for that. A real environment variable wins over .env. */
              ...(process.env.CHAIN_LIVE === '1' ? {} : { RPC_URL: 'http://127.0.0.1:9/' }),
              // the chart switch's listing checks (Dexscreener, GeckoTerminal) likewise: a dead address answers "could not ask" at once
              ...(process.env.CHAIN_LIVE === '1' ? {} : { CHART_SRC_DS_URL: 'http://127.0.0.1:9/', CHART_SRC_GT_URL: 'http://127.0.0.1:9/' }),
              // …and the Scanner's Ethereum / Solana reads (lib/multichain.js: Dexscreener, GeckoTerminal, GoPlus, the two nodes) — tests/multichain.mjs
              // runs its own server against fakes of them; here they are dead, so a scan of a 0x address the home chain cannot read is "could not reach"
              ...(process.env.CHAIN_LIVE === '1' ? {} : { MC_DEXSCREENER_URL: 'http://127.0.0.1:9', MC_GECKO_URL: 'http://127.0.0.1:9', MC_GOPLUS_URL: 'http://127.0.0.1:9', ETH_RPC_URL: 'http://127.0.0.1:9/', SOL_RPC_URL: 'http://127.0.0.1:9/', JUPITER_URL: 'http://127.0.0.1:9' }),
              // and the token-by-name search's two (GeckoTerminal, Dexscreener): the suites read the site's own records only
              ...(process.env.CHAIN_LIVE === '1' ? {} : { TOKSEARCH_GT_URL: FIXTURE + '/gt', TOKSEARCH_DS_URL: FIXTURE + '/ds', OUTBOUND_RPM_SEARCH_GECKOTERMINAL: '600' }),   // the suite asks more than the live 4/min share
              /* Market Data (lib/marketdata.js): every source it reads is a dead address here, always (even with CHAIN_LIVE=1 — no
                 suite needs a live one), and its collectors are off whatever a .env says: tests/marketdata.mjs runs its own server
                 against fakes of every one of them. */
              MARKET_COLLECT: '0', MARKET_LLAMA_URL: DEAD, MARKET_LLAMA_COINS_URL: DEAD, MARKET_LLAMA_STABLES_URL: DEAD, MARKET_L2BEAT_URL: DEAD,
              MARKET_GROWTHEPIE_URL: DEAD, MARKET_GROWTHEPIE_METRICS_URL: DEAD, MARKET_GT_URL: DEAD, MARKET_DS_URL: DEAD, MARKET_CG_URL: DEAD, MARKET_ETH_RPC_URL: DEAD, MARKET_LOGO_ORIGIN: DEAD, MARKET_COINLORE_URL: DEAD,
              // no keyed explorer, whatever a .env says: the server then asks the explorer nothing (owner, 2026-10-27), which the guard below holds it to
              ...(process.env.CHAIN_LIVE === '1' ? {} : { BLOCKSCOUT_URL: '' }) };

/* THE GUARD (2026-10-27). The feeds the server reads at fixed addresses — Dexscreener, GoPlus, the stock quote, the logo CDNs —
   have no env to point at a dead address, so a suite that opened a token used to send the throwaway server out to them for
   real. Unless CHAIN_LIVE=1, a module loaded before server.js refuses every fetch that would leave this machine, the way a
   dead address does, and writes one line saying where it was going (host and path, never a query) and as whom. After the
   suites the runner reads that log and holds the server to its one identity: every attempt carried the honest User-Agent,
   and none was to the keyless explorer. */
const NETGUARD = process.env.CHAIN_LIVE === '1' ? null : path.join(dataDir, 'netguard.mjs');
const NETLOG = path.join(dataDir, 'netguard.log');
if (NETGUARD) writeFileSync(NETGUARD, `import { appendFileSync } from 'node:fs';
const real = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  let u = null; try { u = new URL(url); } catch {}
  if (u && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]')) return real.call(this, input, init);
  const h = (init && init.headers) || {};
  const ua = typeof h.get === 'function' ? h.get('user-agent') : (h['User-Agent'] || h['user-agent'] || null);
  try { appendFileSync(${JSON.stringify(NETLOG)}, JSON.stringify({ to: u ? u.host + u.pathname : String(url).slice(0, 80), ua }) + '\\n'); } catch {}
  throw new TypeError('fetch failed');
};
`);

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...(NETGUARD ? ['--import', pathToFileURL(NETGUARD).href] : []), 'server.js'],
  { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

const cleanup = () => {
  try { server.kill('SIGTERM'); } catch {}
  if (keep) console.log('\nkept the test data directory: ' + dataDir);
  else { try { rmSync(dataDir, { recursive: true, force: true }); } catch {} }
};
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function waitForServer(ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (server.exitCode != null) throw new Error('server exited (' + server.exitCode + '):\n' + serverLog);
    try { const r = await fetch('http://localhost:' + PORT + '/healthz'); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('server did not come up in time:\n' + serverLog);
}

/* A suite that has not finished in ten minutes is stuck (an open handle, a wait that never ends): it is killed and
   reported, rather than holding the whole run — and CI — until the job's own limit. */
// the opt-in whole-wallet live read (WALLETCHAIN_LIVE=1) takes about an hour by design; SUITE_TIMEOUT_MIN sets any other limit
const SUITE_TIMEOUT_MS = (Number(process.env.SUITE_TIMEOUT_MIN) || (process.env.WALLETCHAIN_LIVE === '1' ? 80 : 10)) * 60 * 1000;
const run = (suite) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(HERE, suite + '.mjs'), String(PORT)],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', timedOut = false;
  const timer = setTimeout(() => { timedOut = true; try { p.kill('SIGKILL'); } catch {} }, SUITE_TIMEOUT_MS);
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  p.on('close', (code) => {
    clearTimeout(timer);
    const m = /(\d+)\/(\d+) passed/.exec(out);
    const fails = out.split('\n').filter(l => l.startsWith('FAIL ') || l.startsWith('ERROR '));
    /* A suite may legitimately decide there is nothing to test — sandboxwall needs the demo community,
       which is seeded from the network a couple of seconds after boot and may not exist on a fresh
       database. That is a SKIP, and reporting it as a failure would train people to ignore red. */
    const skipped = !m && code === 0 && /skipping/i.test(out);
    if (timedOut) fails.push('ERROR the suite was still running after ' + SUITE_TIMEOUT_MS / 60000 + ' minutes and was stopped');
    /* the summary line is the suite's word; the exit code is the process's. A suite that printed "20/20 passed" and then
       died on a stray rejection exits non-zero — that is a failure too, not a pass with a footnote */
    else if (code !== 0 && !(m && +m[1] !== +m[2])) fails.push('ERROR the suite exited with code ' + code + (m ? ' after its summary' : ''));
    resolve({ suite, pass: m ? +m[1] : 0, total: m ? +m[2] : 0, ran: !!m, skipped, fails, out, code });
  });
});

let pass = 0, total = 0, broken = [], skips = [];
try {
  await waitForServer();
  console.log('server up on :' + PORT + '  ·  data ' + dataDir + '\n');
if (process.env.CHAIN_LIVE !== '1') console.log('live chain reads are skipped (CHAIN_LIVE=1 runs them — from the machine that serves the site they throttle its own chain reads for minutes)\n');
  for (const s of suites) {
    const r = await run(s);
    pass += r.pass; total += r.total;
    /* An ERROR line means the suite threw part-way: every check it printed passed, but the ones after the
       throw never ran, so "20/20" would be a green light over a crash. A crash is a failure. */
    const crashed = r.fails.some(l => l.startsWith('ERROR '));
    const ok = ((r.ran && r.pass === r.total) || r.skipped) && !crashed;
    if (!ok) broken.push(r);
    if (r.skipped) skips.push(s);
    console.log((r.skipped ? '  – ' : ok ? '  ✓ ' : '  ✗ ') + s.padEnd(14) +
      (r.ran ? r.pass + '/' + r.total : r.skipped ? 'skipped' : 'DID NOT REPORT'));
    for (const f of r.fails) console.log('      ' + f);
    if (verbose) for (const l of r.out.split('\n')) if (l.startsWith('PASS ')) console.log('      ' + l);
    // a suite that neither reported nor skipped has gone wrong in a way the summary cannot express — show it
    if (!r.ran && !r.skipped) for (const l of r.out.split('\n').slice(0, 14)) if (l.trim()) console.log('      ' + l);
  }
  /* What the guard refused, across every suite: each attempt as the site itself (the stock quote's identity says what it asks
     for inside the same parentheses), and not one to the explorer — this run has no key for it. Two assertions of the runner's own. */
  if (NETGUARD) {
    const HONEST = createRequire(import.meta.url)(path.join(ROOT, 'lib', 'marketdata.js')).HONEST_UA;
    const tried = existsSync(NETLOG) ? readFileSync(NETLOG, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { to: l, ua: null }; } }) : [];
    const masked = tried.filter((x) => !String(x.ua || '').startsWith(HONEST.slice(0, -1)));
    const explorer = tried.filter((x) => /blockscout/i.test(String(x.to).split('/')[0]));
    const fails = [];
    if (masked.length) fails.push('FAIL ' + masked.length + ' request(s) off this machine without the honest User-Agent: ' + JSON.stringify(masked.slice(0, 4)));
    if (explorer.length) fails.push('FAIL ' + explorer.length + ' request(s) to the explorer with no key: ' + JSON.stringify(explorer.slice(0, 4)));
    pass += 2 - fails.length; total += 2;
    const hosts = [...new Set(tried.map((x) => String(x.to).split('/')[0]))].sort();
    console.log((fails.length ? '  ✗ ' : '  ✓ ') + 'netguard'.padEnd(14) + (2 - fails.length) + '/2  (' + tried.length + ' request(s) off this machine refused' + (hosts.length ? ': ' + hosts.join(', ') : '') + ')');
    for (const f of fails) console.log('      ' + f);
    if (fails.length) broken.push({ suite: 'netguard', fails });
  }
} catch (e) {
  console.error('\n' + e.message);
  cleanup();
  process.exit(1);
}
cleanup();

console.log('\n' + '─'.repeat(40));
console.log((broken.length ? '✗' : '✓') + '  ' + pass + '/' + total + ' assertions across ' +
  (suites.length - skips.length) + ' suites' + (skips.length ? ' (' + skips.length + ' skipped: ' + skips.join(', ') + ')' : ''));
if (broken.length) console.log('   failing: ' + broken.map(b => b.suite).join(', '));
process.exit(broken.length ? 1 : 0);
