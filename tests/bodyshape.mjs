/* ===== A JSON body that is not an object is a 400, on every route (2026-10-24) ==========================================
   readBody() used to hand back whatever JSON.parse made of the body and only swapped an empty body for {}. A body of `null`
   (or a list, a number, a string) then reached routes that read `b.code`, `b.text` … and threw a TypeError, which the router
   logged with its whole stack and answered as a 500 "server error". POST /api/onboard had its own guard (a45717c); the rule
   now lives in readBody, so every caller gets it.

   1. The shape, in the source: readBody refuses a parsed value that is not a plain object, and still reads an empty body as {}.
   2. A server of its own: null, [], 5 and "hi" posted to a signed-out route (login), two signed-in ones (report, watchlist)
      and the Wall's post route (which used to answer with the TypeError's own words) are 400 "malformed JSON body", with no
      stack in the log; an empty body and {} still reach each route's own checks, and a
      real body still works. Everything lives in a temporary directory, deleted. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { ROOT, SERVER_JS } from './_paths.mjs';

const SRC = fs.readFileSync(SERVER_JS, 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ═══ 1. the shape ═══ */
{
  const rb = (/function readBody\(req, limit = 256 \* 1024\) \{[\s\S]*?\n\}/.exec(SRC) || [''])[0];
  check('readBody refuses a parsed body that is not a plain object (null, a list, a number, a string) as a 400 "malformed JSON body"',
    /if \(!v \|\| typeof v !== 'object' \|\| Array\.isArray\(v\)\) return finish\(reject, new HttpError\('malformed JSON body', 400\)\);/.test(rb));
  check('  ...and still reads an empty body as {}', /v = chunks\.length \? JSON\.parse\(Buffer\.concat\(chunks\)\.toString\(\)\) : \{\};/.test(rb));
  check('  ...a refusal is an HttpError, which the router answers with its own status and words (not a logged 500)',
    /if \(e instanceof HttpError\) return bad\(res, e\.message, e\.status\);\s*console\.error\(e\);\s*return bad\(res, 'server error', 500\);/.test(SRC));
}

/* ═══ 2. a server of its own ═══ */
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-bodyshape-'));
const DATA = path.join(T, 'data'); fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(DATA, '.data_key'), randomBytes(32).toString('hex'), { mode: 0o600 });   // a throwaway key, never printed
const PORT = await freePort(), BASE = 'http://localhost:' + PORT;
const ENV = { ...process.env, PORT: String(PORT), JSI_DATA_DIR: DATA, DATA_DIR: DATA, BASE_URL: BASE, NODE_ENV: 'test', SEED_INVITE_CODE: '12345', TOS_GATE: '1', TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback', SEED_CODES_OPEN: '1',
  DATA_KEY: '', DATA_KEY_FILE: '', BACKUP_DIR: path.join(T, 'backups'), KEY_ROTATE_EXTRA_DBS: '', RPC_URL: 'http://127.0.0.1:9/', CHART_SRC_DS_URL: 'http://127.0.0.1:9/', CHART_SRC_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_DS_URL: 'http://127.0.0.1:9/' };
const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER_JS], { cwd: ROOT, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
const openDb = () => { const d = new DatabaseSync(path.join(DATA, 'app.db')); d.exec('PRAGMA busy_timeout = 5000'); return d; };
const TOS_VERSION = (/const TOS_VERSION = '([^']+)'/.exec(SRC) || [])[1];
function freshPass() {
  const d = openDb(), c = 'BSTEST' + randomBytes(4).toString('hex').toUpperCase(), tok = randomBytes(24).toString('hex');
  d.prepare('INSERT INTO invite_codes (code, owner_id, created_at, used_at, pass, tos_at, tos_version) VALUES (?,NULL,?,?,?,?,?)').run(c, Date.now(), Date.now(), createHash('sha256').update(tok).digest('hex'), Date.now(), TOS_VERSION);
  d.close();
  return 'jsi_pass=' + tok + '; jsi_age=18';
}
let ipN = 0;
// `raw` is sent as it is (the point of this suite); `body` is JSON.stringify'd like the site's own pages do
async function api(p, { method = 'POST', body, raw, cookie } = {}) {
  const headers = { Origin: BASE, 'X-Forwarded-For': '10.68.' + (++ipN) + '.1' };
  const data = raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined);
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + p, { method, headers, body: data });
  const j = await r.json().catch(() => ({}));
  const m = /sid=([^;]+)/.exec(r.headers.get('set-cookie') || '');
  return { status: r.status, j, sid: m ? m[1] : null };
}
const SHAPES = ['null', '[]', '5', '"hi"'];
try {
  let up = false;
  for (let i = 0; i < 150 && !up; i++) { try { const r = await fetch(BASE + '/healthz'); up = r.ok; } catch {} if (!up) await sleep(200); }
  check('the server came up', up, log.slice(-300));
  const n = 'bs' + randomBytes(3).toString('hex');
  const reg = await api('/api/auth/register', { cookie: freshPass(), body: { username: n, email: n + '@example.com', password: 'bodyshape-pass-' + n } });
  if (reg.status !== 200 || !reg.sid) throw new Error('could not make an account: ' + reg.status + ' ' + JSON.stringify(reg.j));
  const me = 'sid=' + reg.sid, guest = freshPass();
  // past the $SEND check, so the post route reads its body (it refuses an unverified account before that)
  { const d = openDb(); try { d.prepare("UPDATE users SET holder_verified_at = ?, holder_state = 'ok' WHERE username = ?").run(Date.now(), n); } finally { d.close(); } }
  const logAt = log.length;

  const routes = [
    ['POST /api/auth/login, signed out', '/api/auth/login', guest],
    ['POST /api/report, signed in', '/api/report', me],
    ['POST /api/watchlist, signed in', '/api/watchlist', me],
    // reads its body inside a try that answered 400 with the TypeError's own words ("Cannot read properties of null")
    ['POST /api/posts, signed in and verified', '/api/posts', me],
  ];
  for (const [name, p, cookie] of routes) {
    const got = [];
    for (const raw of SHAPES) { const r = await api(p, { raw, cookie }); got.push({ ok: r.status === 400 && r.j.error === 'malformed JSON body', said: raw + ' → ' + r.status + ' ' + JSON.stringify(r.j) }); }
    check(name + ': a body of ' + SHAPES.join(', ') + ' is a 400 "malformed JSON body", not a 500', got.every((g) => g.ok), got.map((g) => g.said).join(' · '));
  }
  check('  ...and none of them put a stack in the log', !/TypeError|server error|Cannot read properties/.test(log.slice(logAt)), log.slice(logAt).slice(-600));

  // what still works: an empty body is {}, {} reaches the route's own checks, and a real body does its job
  const empty = await api('/api/report', { cookie: me }), obj = await api('/api/report', { cookie: me, body: {} });
  check('an empty body is still read as {} and {} still reaches the route\'s own checks ("what are you reporting?")',
    empty.status === 400 && empty.j.error === 'what are you reporting?' && obj.status === 400 && obj.j.error === 'what are you reporting?', JSON.stringify([empty, obj]));
  const lg = await api('/api/auth/login', { cookie: guest, body: { identifier: n + '@example.com', password: 'bodyshape-pass-' + n } });
  const wl = await api('/api/watchlist', { cookie: me, body: { pair: '0x' + '1'.repeat(40), token: '0x' + '2'.repeat(40), symbol: 'TEST' } });
  const ps = await api('/api/posts', { cookie: me, body: { text: 'a body that is an object still posts' } });
  check('  ...a real body still works: signing in, adding to the watchlist, posting on the Wall', lg.status === 200 && !!lg.sid && wl.status === 200 && wl.j.ok === true && ps.status === 200,
    JSON.stringify([lg.status, lg.j, wl.status, wl.j, ps.status, ps.j]));
} catch (e) {
  check('the suite ran to the end', false, (e && e.stack) || e);
} finally {
  proc.kill('SIGTERM'); await sleep(400); try { if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL'); } catch {}
  fs.rmSync(T, { recursive: true, force: true });
}

let pass = 0;
for (const [n, ok, extra] of results) { if (ok) pass++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok || !extra ? '' : '\n      ' + extra)); }
console.log(`\n${pass}/${results.length} passed`);
if (pass !== results.length) process.exit(1);
