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
 *
 * Exit code is 0 only if every assertion in every suite passed.
 */
import { spawn } from 'node:child_process';
import { readdirSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT } from './_paths.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const keep = args.includes('--keep');
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

const PORT = 8000 + Math.floor(Math.random() * 1500);
const env = { ...process.env, PORT: String(PORT), JSI_DATA_DIR: dataDir, DATA_DIR: dataDir,
              BASE_URL: 'http://localhost:' + PORT, NODE_ENV: 'test', SEED_INVITE_CODE: '12345' };

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'],
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

const run = (suite) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(HERE, suite + '.mjs'), String(PORT)],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  p.on('close', (code) => {
    const m = /(\d+)\/(\d+) passed/.exec(out);
    const fails = out.split('\n').filter(l => l.startsWith('FAIL ') || l.startsWith('ERROR '));
    /* A suite may legitimately decide there is nothing to test — sandboxwall needs the demo community,
       which is seeded from the network a couple of seconds after boot and may not exist on a fresh
       database. That is a SKIP, and reporting it as a failure would train people to ignore red. */
    const skipped = !m && code === 0 && /skipping/i.test(out);
    resolve({ suite, pass: m ? +m[1] : 0, total: m ? +m[2] : 0, ran: !!m, skipped, fails, out });
  });
});

let pass = 0, total = 0, broken = [], skips = [];
try {
  await waitForServer();
  console.log('server up on :' + PORT + '  ·  data ' + dataDir + '\n');
  for (const s of suites) {
    const r = await run(s);
    pass += r.pass; total += r.total;
    const ok = (r.ran && r.pass === r.total) || r.skipped;
    if (!ok) broken.push(r);
    if (r.skipped) skips.push(s);
    console.log((r.skipped ? '  – ' : ok ? '  ✓ ' : '  ✗ ') + s.padEnd(14) +
      (r.ran ? r.pass + '/' + r.total : r.skipped ? 'skipped' : 'DID NOT REPORT'));
    for (const f of r.fails) console.log('      ' + f);
    // a suite that neither reported nor skipped has gone wrong in a way the summary cannot express — show it
    if (!r.ran && !r.skipped) for (const l of r.out.split('\n').slice(0, 14)) if (l.trim()) console.log('      ' + l);
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
