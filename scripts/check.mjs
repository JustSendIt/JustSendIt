#!/usr/bin/env node
/* ===== npm run check — the cheap pass that runs before the expensive one =====================
 * There is no build step on this site and no transpiler, so nothing sits between a typo and
 * production. This is the substitute: a parse of every file that ships, plus the handful of
 * whole-file invariants that have actually broken things here before.
 *
 * It is deliberately dependency-free. A linter with a config file is a thing to argue about;
 * this is a thing to pass.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const problems = [];
const note = (file, msg) => problems.push(file + ': ' + msg);

/* ---- 1. every shipped JavaScript file parses ---- */
const jsFiles = [path.join(ROOT, 'server.js')]
  .concat(readdirSync(PUBLIC).filter(f => f.endsWith('.js')).map(f => path.join(PUBLIC, f)))
  .concat(existsSync(path.join(ROOT, 'tests'))
    ? readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.mjs')).map(f => path.join(ROOT, 'tests', f))
    : []);
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { note(path.relative(ROOT, f), 'does not parse\n    ' + String(e.stderr || e.message).split('\n').slice(0, 3).join('\n    ')); }
}

/* ---- 2. no inline <script> anywhere ----
   The Content-Security-Policy is `script-src 'self'` with no nonce and no 'unsafe-inline', so an inline
   script does not throw at review time, it simply never runs — in a browser, silently, in production. */
const htmlFiles = readdirSync(PUBLIC).filter(f => f.endsWith('.html'));
for (const f of htmlFiles) {
  const s = readFileSync(path.join(PUBLIC, f), 'utf8');
  for (const m of s.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] || '';
    if (/type\s*=\s*["']application\/ld\+json["']/i.test(attrs)) continue;   // data, not code — the CSP does not execute it
    if (!m[2].trim()) continue;
    note('public/' + f, 'has an inline <script>, which the CSP will silently refuse to run');
  }
}

/* ---- 3. every <script src> and <link href> a page names actually exists ----
   A renamed or deleted asset is a 404 the page recovers from by doing nothing at all. */
for (const f of htmlFiles) {
  const s = readFileSync(path.join(PUBLIC, f), 'utf8');
  for (const m of s.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const ref = m[1];
    if (/^(https?:)?\/\/|^data:|^mailto:|^#|^\?/.test(ref)) continue;
    const rel = ref.split(/[?#]/)[0];
    if (!rel || rel.endsWith('/')) continue;
    const target = rel.startsWith('/') ? path.join(PUBLIC, rel.slice(1)) : path.join(PUBLIC, rel);
    if (!existsSync(target)) note('public/' + f, 'references a file that is not there: ' + ref);
  }
}

/* ---- 4. lazily-loaded assets exist too ----
   auth.js fetches these by string at runtime, so no HTML file names them and check 3 cannot see them. */
for (const ref of ['invite.js', 'invite.css', 'gate.css']) {
  if (!existsSync(path.join(PUBLIC, ref))) note('public/' + ref, 'is loaded on demand by auth.js but does not exist');
}

/* ---- 5. .dockerignore takes no trailing comments ----
   Docker reads `data  # the database` as a pattern literally named that, which matches nothing — so a
   line that looks like it excludes the live database excludes precisely nothing. This has happened here. */
const di = path.join(ROOT, '.dockerignore');
if (existsSync(di)) {
  readFileSync(di, 'utf8').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.includes('#')) note('.dockerignore:' + (i + 1), 'has a trailing comment, which Docker reads as part of the pattern');
  });
}

/* ---- 6. the client's risk weights match the server's ----
   The New Pairs panel claims to explain the health score the server computed. A flag in one and not the
   other is a chunk of that score with no stated reason, which is exactly what shipped once. */
try {
  const srv = readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const cli = readFileSync(path.join(PUBLIC, 'newpairs.js'), 'utf8');
  const RISK = eval('(' + /const RISK = (\{[\s\S]*?\n\});/.exec(srv)[1] + ')');
  const WEIGHTS = eval('(' + /const WEIGHTS = (\{[^}]*\});/.exec(cli)[1] + ')');
  for (const k of Object.keys(RISK)) {
    if (WEIGHTS[k] === undefined) note('public/newpairs.js', 'is missing risk flag "' + k + '" that the server scores');
    else if (WEIGHTS[k] !== RISK[k].w) note('public/newpairs.js', 'weights "' + k + '" at ' + WEIGHTS[k] + ' but the server scores it ' + RISK[k].w);
  }
  for (const k of Object.keys(WEIGHTS)) if (!RISK[k]) note('public/newpairs.js', 'weights "' + k + '", which the server does not score');
} catch (e) { note('newpairs risk parity', 'could not be checked: ' + e.message); }

if (problems.length) {
  console.error('✗ ' + problems.length + ' problem' + (problems.length === 1 ? '' : 's') + ':\n');
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}
console.log('✓ ' + jsFiles.length + ' JS files parse · ' + htmlFiles.length + ' pages checked · CSP, assets, .dockerignore and risk parity all clean');
