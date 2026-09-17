/* The go-live probe (scripts/live-check.mjs) against the test server, and the two server-side launch
   guards it depends on: the app's own www→apex redirect and the Cloudflare configuration warning.
   Nothing here creates a row: the probe's one POST sets an age cookie on the probe's own client. */
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const SRC = readFileSync(SERVER_JS, 'utf8');

try {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'live-check.mjs'), BASE], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const out = (run.stdout || '') + (run.stderr || '');
  const lines = out.split('\n');
  const level = (name) => { const l = lines.find((x) => x.includes(name)); return l ? l.slice(0, 4).trim() : 'MISSING'; };
  check('the probe exits 0 against a healthy local server (WARNs allowed, FAILs not)', run.status === 0, 'exit ' + run.status + '\n' + out.slice(0, 1500));
  check('  ...the process check passes', level('/healthz answers ok:true') === 'PASS');
  check('  ...the strict CSP is seen', level('a strict Content-Security-Policy is on') === 'PASS');
  check('  ...and names no third party', level('names no third party') === 'PASS');
  check('  ...a same-origin POST is accepted', level('a browser POST from this origin is accepted') === 'PASS');
  check('  ...a cross-origin POST is refused', level('a POST from another origin is refused') === 'PASS');
  check('  ...the gate rules are read', level('/api/gate/state answers with the entry rules') === 'PASS');
  check('  ...fonts are served from the site', level('fonts are served from this site') === 'PASS' && level('a font file is served with the right type') === 'PASS');
  check('  ...the support email is not obfuscated', level('the support email is readable') === 'PASS');
  check('  ...https-only checks are skipped on an http origin, not failed', level('HSTS and the http→https redirect') === 'SKIP');
  check('  ...and "not behind Cloudflare" is a warning, not a failure', level('Cloudflare is in front of the origin') === 'WARN');
  check('  ...unknown paths are the site’s own 404', level('an unknown page is the site’s own 404') === 'PASS' && level('a missing upload is a 404') === 'PASS');
  const bad = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'live-check.mjs'), 'http://127.0.0.1:1'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  check('an unreachable origin is a FAIL with exit 1', bad.status === 1 && /FAIL/.test(bad.stdout || ''), bad.status);

  // the www → apex redirect the app performs itself, so a stray www record can never serve pages whose POSTs would 403
  // fetch() silently drops a Host header (it is a forbidden header name), so this goes through node:http
  const www = await new Promise((resolve) => {
    const rq = http.request({ host: '127.0.0.1', port: Number(PORT), path: '/about.html?x=1', method: 'GET', headers: { Host: 'www.localhost' } }, (rs) => { rs.resume(); resolve({ status: rs.statusCode, location: rs.headers.location }); });
    rq.on('error', () => resolve({ status: 0 })); rq.end();
  });
  check('a request on www.<host> is sent to the apex with a 308, path and query kept', www.status === 308 && www.location === BASE + '/about.html?x=1', www.status + ' ' + www.location);
  const apex = await fetch(BASE + '/about.html', { redirect: 'manual' });
  check('  ...and the apex itself is served', apex.status === 200);
  check('the Cloudflare mismatch is said once, in the log, whichever way it is wrong', /Cloudflare is in front of this site, but TRUST_CF is not 1/.test(SRC) && /TRUST_CF=1 but this proxied request carries no CF-Connecting-IP/.test(SRC) && /cfWarned = true/.test(SRC));
  check('the tracker proxies give one member a slice of the shared budget, not all of it', /rateLimit\('chainx:' \+ me\.id, 90, 6e4\)/.test(SRC) && /rateLimit\('chaind:' \+ me\.id, 60, 6e4\)/.test(SRC));
  check('the image proxy has a site-wide bucket, so a cache miss storm is bounded', /rateLimit\('img-site', 1500, 6e4\)/.test(SRC));
  check('npm run live-check exists', /"live-check": "node scripts\/live-check\.mjs"/.test(readFileSync(path.join(ROOT, 'package.json'), 'utf8')));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
