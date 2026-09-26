/* A @username belongs to one account whatever its capitals: once "send" exists, nobody gets "Send", "SEND" or
   "SeNd" — not by signing up with an email, not with a wallet, not by renaming. The owner may re-case their own
   name. Sign-in, profile links and look-ups answer to any casing. Throwaway accounts only; every row made here
   is deleted in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { DB_PATH, ROOT, SERVER_JS } from './_paths.mjs';
const require = createRequire(ROOT + '/package.json');
const { Wallet } = require('ethers');

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const SRC = readFileSync(SERVER_JS, 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
let GATE = '';
const made = [], codes = [];
/* An invite pass, made the way /api/gate/redeem + /api/gate/accept make one (a spent code carrying the hash of the
   cookie's token, terms accepted) but written straight to the throwaway database: redeeming through the API spends
   a per-address budget every suite shares, and this suite needs four. The redeem route is tested by gatetest. */
const TOS_VERSION = (/const TOS_VERSION = ['"]?([^'";\s]+)/.exec(SRC) || [])[1];
function freshPass() {
  const code = 'UCT' + randomBytes(4).toString('hex').toUpperCase(), tok = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO invite_codes (code, owner_id, created_at, used_at, pass, tos_at, tos_version) VALUES (?,NULL,?,?,?,?,?)')
    .run(code, Date.now(), Date.now(), createHash('sha256').update(tok).digest('hex'), Date.now(), TOS_VERSION);
  codes.push(code);
  return 'jsi_pass=' + tok + '; jsi_age=18';
}

const api = async (p, opts = {}) => {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: [opts.pass !== undefined ? opts.pass : GATE, opts.sid ? 'sid=' + opts.sid : ''].filter(Boolean).join('; ') },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  const m = /(?:^|[;,]\s*)sid=([^;]+)/.exec(r.headers.get('set-cookie') || '');
  return { status: r.status, j, sid: m ? m[1] : null };
};
const idOf = (name) => { const r = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(name); return r ? r.id : null; };
const rowsLike = (name) => db.prepare('SELECT id, username FROM users WHERE lower(username) = lower(?)').all(name);
function track(name) { const id = idOf(name); if (id && !made.includes(id)) made.push(id); return id; }
async function register(username, pass) {
  const email = 'uc.' + randomBytes(4).toString('hex') + '@example.com', password = 'uc-pass-' + randomBytes(4).toString('hex');
  const r = await api('/api/auth/register', { method: 'POST', pass: pass || freshPass(), body: { username, email, password } });
  if (r.status === 200) track(r.j.username);
  return { ...r, email, password };
}
// other casings of a name: all capitals, one capital, mixed
const variants = (n) => [n.toUpperCase(), n.replace('send', 'Send'), n.replace('send', 'SeNd')];
// an account made straight in the (throwaway) database, with a session — sign-ups share a 10-an-hour limit across every suite
function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar) VALUES (?,?,?)').run(name, Date.now(), '🧪');
  const id = track(name);
  const raw = 'tok_' + name + '_' + randomBytes(6).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}

GATE = freshPass();
try {
  const tag = randomBytes(3).toString('hex');
  const base = '__uc_send_' + tag;               // all lower case

  /* ═══ 1. the rule lives in the schema, so no path can get around it ═══ */
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get().sql;
  check('the users table declares the name UNIQUE COLLATE NOCASE — capitals and small letters are one character to the database', /username TEXT NOT NULL UNIQUE COLLATE NOCASE/.test(ddl));
  check('  ...and the name itself is ASCII only (the letters NOCASE folds), so no other alphabet can slip a look-alike past it', /const USERNAME_RE = \/\^\[a-zA-Z0-9_\.-\]\{3,24\}\$\/;/.test(SRC));
  check('  ...a rename that loses a race in some casing answers "taken" (409), not a server error', /catch \(e\) \{ if \(\/UNIQUE\/\.test\(String\(e && e\.message\)\)\) return bad\(res, 'that username is taken', 409\); throw e; \}/.test(SRC));
  const cmp = readFileSync(ROOT + '/public/compete.js', 'utf8'), up = readFileSync(ROOT + '/public/upage.js', 'utf8');
  check('  ...the Compete page\'s "since your last visit" arrows know a re-cased name is the same person', /o\[String\(u\.username\)\.toLowerCase\(\)\] = u\.rank/.test(cmp) && /prev\[String\(u\.username \|\| ''\)\.toLowerCase\(\)\]/.test(cmp));
  check('  ...and a Send Wall opened as /u/SEND shows (and puts in the address bar) the account\'s own spelling', /uname = u\.username;/.test(up) && /history\.replaceState\(history\.state, '', '\/u\/' \+ encodeURIComponent\(u\.username\)/.test(up));

  /* ═══ 2. email sign-up ═══ */
  const A = await register(base);
  check('an account is made as "' + base + '"', A.status === 200 && A.j && A.j.username === base, A.status + ' ' + JSON.stringify(A.j));
  const vs = variants(base);
  for (const v of vs) {
    const c = await api('/api/username-check?u=' + encodeURIComponent(v));
    check('  "' + v + '" is shown as taken on the sign-up form', c.status === 200 && c.j && c.j.available === false, JSON.stringify(c.j));
  }
  const dup = await register(vs[2]);
  check('  signing up as "' + vs[2] + '" is refused as taken, and makes no account', dup.status === 400 && /taken/i.test((dup.j && dup.j.error) || '') && rowsLike(base).length === 1, dup.status + ' ' + JSON.stringify(dup.j));

  /* ═══ 3. renaming into someone else's name, in any casing ═══ */
  const other = '__uc_other_' + tag;
  const B = mkUser(other);
  for (const v of [base, ...vs]) {
    const r = await api('/api/profile', { method: 'POST', sid: B.sid, body: { username: v } });
    check('  renaming the second account to "' + v + '" is refused as taken', r.status === 400 && /taken/i.test((r.j && r.j.error) || ''), r.status + ' ' + JSON.stringify(r.j));
  }
  check('  ...and both names are exactly as they were', (db.prepare('SELECT username FROM users WHERE id = ?').get(idOf(other)) || {}).username === other && rowsLike(base).length === 1);

  /* ═══ 4. the owner may change the capitals of their own name — and it stays theirs ═══ */
  const recased = base.toUpperCase();
  const own = await api('/api/profile', { method: 'POST', sid: A.sid, body: { username: recased } });
  check('the owner can re-case their own name ("' + base + '" → "' + recased + '")', own.status === 200 && (db.prepare('SELECT username FROM users WHERE id = ?').get(idOf(base)) || {}).username === recased, own.status + ' ' + JSON.stringify(own.j));
  const ownCheck = await api('/api/username-check?u=' + encodeURIComponent(base), { sid: A.sid });
  check('  ...the availability check tells the owner their own name in another casing is fine', ownCheck.j && ownCheck.j.available === true, JSON.stringify(ownCheck.j));
  const theirCheck = await api('/api/username-check?u=' + encodeURIComponent(base), { sid: B.sid });
  check('  ...and tells anyone else it is taken', theirCheck.j && theirCheck.j.available === false, JSON.stringify(theirCheck.j));
  check('  ...and there is still exactly one account by that name', rowsLike(base).length === 1);

  /* ═══ 5. the name answers to any casing ═══ */
  const login = await api('/api/auth/login', { method: 'POST', body: { identifier: base.toLowerCase(), password: A.password } });
  check('signing in with the name typed in different capitals works', login.status === 200 && !!login.sid, login.status + ' ' + JSON.stringify(login.j));
  for (const v of [base, base.toUpperCase(), vs[vs.length - 1]]) {
    const r = await api('/api/users/' + encodeURIComponent(v));
    check('  the profile at /api/users/' + v + ' is that one account', r.status === 200 && r.j && (r.j.username || (r.j.user && r.j.user.username) || '').toLowerCase() === base.toLowerCase(), r.status);
  }

  /* ═══ 6. a wallet sign-up cannot take it either ═══ */
  const w = Wallet.createRandom(), addr = w.address.toLowerCase(), wPass = freshPass();
  const n = await api('/api/auth/wallet/nonce?purpose=signin&address=' + addr, { pass: wPass });
  const v1 = n.j && n.j.message ? await api('/api/auth/wallet/verify', { method: 'POST', pass: wPass, body: { address: addr, signature: await w.signMessage(n.j.message), intent: 'signin' } }) : n;
  if (!(v1.j && v1.j.signup)) check('a wallet sign-up reached the pick-a-name step', false, v1.status + ' ' + JSON.stringify(v1.j));
  else {
    const ws = await api('/api/auth/wallet/signup', { method: 'POST', pass: wPass, body: { signup: v1.j.signup, username: vs[vs.length - 1] } });
    check('a wallet sign-up as "' + vs[vs.length - 1] + '" is refused as taken, and makes no account', ws.status === 409 && /taken/i.test((ws.j && ws.j.error) || '') && rowsLike(base).length === 1, ws.status + ' ' + JSON.stringify(ws.j));
    const ws2 = await api('/api/auth/wallet/signup', { method: 'POST', pass: wPass, body: { signup: v1.j.signup, username: '__uc_wallet_' + tag } });
    if (ws2.status === 200) track('__uc_wallet_' + tag);
    check('  ...and the wallet\'s proof is still good: the same sign-up goes through with a free name, no reconnecting', ws2.status === 200 && ws2.j && ws2.j.username === '__uc_wallet_' + tag, ws2.status + ' ' + JSON.stringify(ws2.j));
  }

  /* ═══ 7. erasing an account renames it 'deleted-<id>' — a name nobody may hold, in any casing ═══ */
  const C = mkUser('__uc_gone_' + tag);
  for (const v of ['deleted-' + C.id, 'Deleted-' + C.id, 'DELETED-' + C.id]) {
    const c = await api('/api/username-check?u=' + encodeURIComponent(v));
    const r = await api('/api/profile', { method: 'POST', sid: B.sid, body: { username: v } });
    check('  "' + v + '" is not available, and renaming into it is refused', c.j && c.j.available === false && r.status === 400 && /taken/i.test((r.j && r.j.error) || ''), JSON.stringify(c.j) + ' ' + r.status);
  }
  // a squatter from before the reservation, written straight to the database: the erase must still go through
  db.prepare('INSERT INTO users (username, created_at) VALUES (?, ?)').run('Deleted-' + C.id, Date.now()); track('Deleted-' + C.id);
  db.prepare('UPDATE sessions SET sudo_until = ? WHERE user_id = ?').run(Date.now() + 36e5, C.id);   // "confirm it's you" already done
  const del = await api('/api/account/delete', { method: 'POST', sid: C.sid, body: { confirm: 'DELETE' } });
  const gone = db.prepare('SELECT username, deleted_at FROM users WHERE id = ?').get(C.id);
  check('an account whose placeholder name ("Deleted-' + C.id + '") is already held can still be erased — it gets a free placeholder instead',
    del.status === 200 && gone && gone.deleted_at > 0 && /^deleted-\d+-[0-9a-f]{4}$/.test(gone.username) && gone.username.startsWith('deleted-' + C.id + '-'), del.status + ' ' + JSON.stringify(del.j) + ' ' + JSON.stringify(gone));

  /* ═══ 8. the database itself refuses a second casing, whatever code writes it ═══ */
  let threw = '';
  try { db.prepare('INSERT INTO users (username, created_at) VALUES (?, ?)').run(base.toLowerCase().replace('send', 'SeNd'), Date.now()); track(base); } catch (e) { threw = String(e && e.message); }
  check('a direct insert of "' + base.replace('send', 'SeNd') + '" is refused by the UNIQUE rule', /UNIQUE constraint failed: users\.username/.test(threw), threw);
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  for (const r of db.prepare("SELECT id FROM users WHERE username LIKE '\\_\\_uc\\_%' ESCAPE '\\'").all()) if (!made.includes(r.id)) made.push(r.id);
  for (const id of made) {
    for (const t of ['sessions', 'identities', 'notifications', 'points_events', 'tracked_wallets', 'holder_state', 'gate_claims']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM invite_codes WHERE owner_id = ? OR user_id = ?').run(id, id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {}
  }
  console.log('cleanup — throwaway users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_uc\\_%' ESCAPE '\\'").get().n);
  for (const c of codes) { try { db.prepare('DELETE FROM invite_codes WHERE code = ?').run(c); } catch {} }
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
