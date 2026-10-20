/* The admin page belongs to the admin account alone, invites come only from members once anyone is in, and the
   encryption key can live in a file of its own. Drives the real HTTP API (admin = user 987654, which run.mjs names in
   ADMIN_USER_IDS) and the real code pulled out of server.js. Everything it creates it deletes. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const requireCjs = createRequire(import.meta.url);
import { ROOT, DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const ADMINJS = readFileSync(path.join(ROOT, 'public', 'admin.js'), 'utf8');
const AUTHJS = readFileSync(path.join(ROOT, 'public', 'auth.js'), 'utf8');
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const grab = (re, l) => { const m = SRC.match(re); if (!m) { console.error('could not extract ' + l); process.exit(1); } return m[0]; };
const ADMIN_ID = 987654;
const made = [];
function mkUser(name, id) {
  db.prepare('DELETE FROM users WHERE username=?').run(name);
  if (id) db.prepare('INSERT INTO users (id, username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?,?)').run(id, name, Date.now(), '🧪', Date.now(), 'ok');
  else db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const uid = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(uid);
  const raw = 'tok_' + name + '_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), uid, Date.now(), Date.now() + 864e5);
  return { id: uid, sid: raw };
}
// a raw request: the path goes out exactly as written (fetch would tidy '/x/..//admin.html' first)
const raw = (method, p, sid) => new Promise((resolve) => {
  const r = http.request({ host: 'localhost', port: PORT, method, path: p, headers: sid ? { Cookie: 'sid=' + sid } : {} }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, text: b, cc: res.headers['cache-control'] || '', location: res.headers.location || '' })); });
  r.on('error', () => resolve({ status: 0, text: '', cc: '' })); r.end();
});
const get = async (p, sid) => { const r = await fetch(BASE + p, { headers: sid ? { Cookie: 'sid=' + sid } : {}, redirect: 'manual' }); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {} return { status: r.status, text, j, cc: r.headers.get('cache-control') || '' }; };

try {
  /* ═══ 1. the page, the script and the overview: the admin account only ═══ */
  check('the throwaway server names the admin in ADMIN_USER_IDS (run.mjs)', /ADMIN_USER_IDS: '987654'/.test(readFileSync(path.join(ROOT, 'tests', 'run.mjs'), 'utf8')));
  const admin = mkUser('__adm_send__', ADMIN_ID), member = mkUser('__adm_member__');
  for (const [who, sid] of [['a signed-out visitor', null], ['a signed-in member who is not the admin', member.sid]]) {
    const page = await get('/admin', sid), js = await get('/admin.js', sid), ov = await get('/api/admin/overview', sid);
    check(who + ' gets 404 for the admin page, its script and the overview', page.status === 404 && js.status === 404 && ov.status === 404, [page.status, js.status, ov.status].join(' '));
    check('  ...the page 404 is the ordinary "not found" page, kept by nobody (private, no-store)', /That page didn/.test(page.text) && /private/.test(page.cc) && /no-store/.test(page.cc), page.cc);
    check('  ...and says nothing about an admin page', !/Admin|Moderation/.test(page.text));
  }
  // every way the review found to reach the files: other methods, letter case (the Mac's disk ignores it), //, /./, %2e, ..
  const variants = [['POST', '/admin.html'], ['PUT', '/admin.html'], ['OPTIONS', '/admin.js'], ['POST', '/admin.js'], ['GET', '/Admin.js'], ['GET', '/ADMIN.HTML'],
    ['GET', '/Admin.html'], ['GET', '/.//admin.js'], ['GET', '/x/..//admin.html'], ['GET', '/%2e//admin.html'], ['GET', '//admin.js'], ['HEAD', '/admin.html'], ['GET', '/admin.js?v=1'],
    // its clean address since 2026-10-15, and every spelling of that
    ['GET', '/admin'], ['POST', '/admin'], ['PUT', '/admin'], ['HEAD', '/admin'], ['GET', '/Admin'], ['GET', '/ADMIN'], ['GET', '/admin/'], ['GET', '/.//admin'],
    ['GET', '/x/..//admin'], ['GET', '/%2e//admin'], ['GET', '/admin?x=1'], ['GET', '/admin.html?x=1']];
  const leaks = [];
  for (const [m, pth] of variants) for (const sid of [null, member.sid]) { const r = await raw(m, pth, sid); if (/loadOverview|adm-ov|<title>Admin — /.test(r.text)) leaks.push(m + ' ' + pth + (sid ? ' (member)' : '') + ' → ' + r.status); }
  // ('//admin.js' parses as the host admin.js and serves the home page — what matters is that no admin content comes back)
  check('no method, spelling or path trick reaches the admin page or script for anyone but the admin (' + variants.length * 2 + ' tries)', leaks.length === 0, leaks.join(' | '));
  // not even a redirect: a 301 from /admin.html to /admin would tell anyone the page exists
  const told = [];
  for (const pth of ['/admin', '/admin.html', '/Admin', '/admin/', '/ADMIN.HTML']) for (const sid of [null, member.sid]) { const r = await raw('GET', pth, sid); if (r.status !== 404) told.push(pth + (sid ? ' (member)' : '') + ' → ' + r.status); }
  check('  ...every spelling of the admin page is the same plain 404 for them, never a redirect', told.length === 0, told.join(' | '));
  const viaVariant = await raw('GET', '/Admin.html', admin.sid), viaOld = await raw('GET', '/admin.html?x=1', admin.sid);
  check('  ...while the admin reaches it by any other spelling: a redirect to /admin, the query kept, still private', viaVariant.status === 301 && viaVariant.location === '/admin' && /no-store/.test(viaVariant.cc)
    && viaOld.status === 301 && viaOld.location === '/admin?x=1' && /no-store/.test(viaOld.cc), viaVariant.status + ' ' + viaVariant.location + ' / ' + viaOld.status + ' ' + viaOld.location);
  const postAdmin = await raw('POST', '/admin.html', admin.sid);
  check('  ...and only to read it: the admin\'s POST is a 404 too', postAdmin.status === 404);
  const p405 = await raw('POST', '/'), o405 = await raw('OPTIONS', '/wall.html');
  check('a page or asset answers 405 to anything but GET and HEAD (it used to answer 200 with the file)', p405.status === 405 && o405.status === 405, p405.status + ' ' + o405.status);
  const page = await get('/admin', admin.sid), js = await get('/admin.js', admin.sid);
  check('the admin account gets the page, titled Admin', page.status === 200 && /<title>Admin — Just Send It<\/title>/.test(page.text), page.status);
  check('  ...never cached anywhere (private, no-store)', /private/.test(page.cc) && /no-store/.test(page.cc), page.cc);
  check('  ...and its script, the same way', js.status === 200 && /loadOverview/.test(js.text) && /no-store/.test(js.cc), js.status + ' ' + js.cc);
  const ov = await get('/api/admin/overview', admin.sid);
  const o = ov.j || {};
  check('the overview answers the admin: members, invites, reports, server, storage', ov.status === 200 && o.members && o.invites && o.reports && o.server && o.storage, ov.status);
  check('  ...the newest members by name and Send ID', Array.isArray(o.members && o.members.latest) && o.members.latest.some((u) => u.username === '__adm_member__'));
  check('  ...the Node version and where the key and backups are', o.server && /^v\d+\./.test(o.server.node) && typeof o.storage.keySource === 'string' && typeof o.storage.backupDir === 'string', JSON.stringify(o.server && o.server.node));
  check('  ...the code the process is RUNNING (read at start), and what the checkout holds now', o.server && 'commit' in o.server && 'checkoutCommit' in o.server);
  check('  ...counting live accounts only (no deleted ones)', /FROM users WHERE system = 0 AND deleted_at IS NULL'\)\.n/.test(SRC) && /WHERE system = 0 AND deleted_at IS NULL ORDER BY created_at DESC/.test(SRC));
  check('  ...and nothing personal: no email, wallet, IP or session in it', !/@[a-z0-9.-]+\.[a-z]{2,}|0x[0-9a-f]{40}|signup_ip|token/i.test(ov.text));
  const me = await get('/api/me', admin.sid);
  check('/api/me tells the admin account it is the admin (the menu shows the link)', me.j && me.j.user && me.j.user.admin === true);
  const meM = await get('/api/me', member.sid);
  check('  ...and tells a member nothing about it', meM.j && meM.j.user && meM.j.user.admin === undefined);
  check('auth.js adds the Admin link only for the admin account', /if \(user\.admin\) \{[\s\S]{0,500}?adm\.href = '\/admin';/.test(AUTHJS));

  /* ═══ 2. seed codes stop working once anyone is in ═══ */
  const seedSrc = grab(/function seedCodesOpen\(\) \{[\s\S]*?\n\}\n/, 'seedCodesOpen');
  const mk = (env, hasMember) => new Function('process', 'db', seedSrc + '\nreturn seedCodesOpen;')({ env }, { prepare: () => ({ get: () => (hasMember ? { 1: 1 } : undefined) }) });
  check('seed codes open a fresh site (no members yet)', mk({}, false)() === true);
  check('  ...and are closed as soon as a member exists', mk({}, true)() === false);
  check('  ...unless SEED_CODES_OPEN=1 (this test suite, which signs everyone up with one seed)', mk({ SEED_CODES_OPEN: '1' }, true)() === true);
  check('redeeming a seed code is refused once closed, with words that say where codes come from', /if \(row\.owner_id == null && !seedCodesOpen\(\)\) return bad\(res, 'that code is no longer active — invites now come from members/.test(SRC));
  check('  ...and a seed pass redeemed earlier cannot create an account either', /if \(r\.owner_id == null && !seedCodesOpen\(\)\) return \{ error: 'That invite code is no longer active — ask a member for one of theirs\.', code: 'code_retired' \};/.test(SRC));
  check('a member\'s own codes are untouched (INVITE_GRANT each)', /const INVITE_GRANT = 10;/.test(SRC));

  /* ═══ 3. the encryption key in a file of its own ═══ */
  const keySrc = grab(/let DATA_KEY_SOURCE = 'generated';[\s\S]*?\n\}\)\(\);\n/, 'DATA_KEY');
  const fsReal = await import('node:fs'), crypto = await import('node:crypto');
  // otherVolume: pretend the key file sits on another volume (its own st_dev), as /Volumes/JustSendItKey does on the Mac
  const run = (env, dataDir, otherVolume) => {
    const proc = { env, exit: (c) => { throw new Error('exit ' + c); } };
    const errs = [];
    const fsx = otherVolume ? { ...fsReal, statSync: (pth, ...r) => { const st = fsReal.statSync(pth, ...r); return /keyfile/.test(String(pth)) ? { ...st, dev: st.dev + 1 } : st; } } : fsReal;
    try {
      const [keys, src, ringFile] = new Function('process', 'fs', 'path', 'crypto', 'DATA_DIR', 'BASE_URL', 'console', 'require', "const KEYLIB = require('./lib/keys.js');\n" + keySrc + '\nreturn [KEYS, DATA_KEY_SOURCE, KEY_RING_FILE];')(proc, fsx, path, crypto, dataDir, 'http://localhost', { error: (m) => errs.push(m), warn: () => {} }, (m) => requireCjs(path.join(ROOT, m.replace(/^\.\//, ''))));
      return { key: keys.byId.get(keys.current).toString('hex'), mode: keys.mode, ringFile, src, errs };
    } catch (e) { return { threw: e.message, errs }; }
  };
  const dir = mkdtempSync(path.join(tmpdir(), 'jsi-key-')), k1 = randomBytes(32).toString('hex'), k2 = randomBytes(32).toString('hex');
  writeFileSync(path.join(dir, 'keyfile'), k1 + '\n', { mode: 0o600 });
  writeFileSync(path.join(dir, '.data_key'), k2 + '\n', { mode: 0o600 });
  const a = run({ DATA_KEY_FILE: path.join(dir, 'keyfile') }, dir, true);
  check('DATA_KEY_FILE: the key is read from its own file on another volume, ahead of one beside the database', a.key === k1 && a.src === 'file', JSON.stringify({ src: a.src }));
  const a2 = run({ DATA_KEY_FILE: path.join(dir, 'keyfile') }, dir, false);
  check('  ...a key file on the database\'s own volume is read but reported as such (the admin page and boot warn)', a2.key === k1 && a2.src === 'file-same-volume', a2.src);
  const b = run({ DATA_KEY_FILE: path.join(dir, 'missing') }, dir);
  check('  ...a named file that cannot be read stops the server — no fallback to the key beside the data', b.threw === 'exit 1' && /REFUSING TO START: DATA_KEY_FILE/.test(b.errs.join(' ')), b.threw);
  const c = run({}, dir);
  check('  ...without it, the old place still works and says where it came from (the admin page warns)', c.key === k2 && c.src === 'data-dir');
  const d = run({ DATA_KEY: k1, DATA_KEY_FILE: path.join(dir, 'missing') }, dir);
  check('  ...and DATA_KEY in the environment still comes first', d.key === k1 && d.src === 'env');
  // a keyring at DATA_KEY_FILE (scripts/keys.mjs init): rotation mode
  const KL = requireCjs(path.join(ROOT, 'lib', 'keys.js'));
  writeFileSync(path.join(dir, 'keyfile-ring'), JSON.stringify(KL.newRingFromLegacy(Buffer.from(k1, 'hex'))), { mode: 0o600 });
  const e = run({ DATA_KEY_FILE: path.join(dir, 'keyfile-ring') }, dir, true);
  check('a keyring at DATA_KEY_FILE is read as one (the key rotates), from its own volume', e.mode === 'ring' && e.key === k1 && e.src === 'file' && e.ringFile === path.join(dir, 'keyfile-ring'), JSON.stringify({ mode: e.mode, src: e.src }));
  const f = run({ DATA_KEY: k2, DATA_KEY_FILE: path.join(dir, 'keyfile-ring') }, dir, true);
  check('  ...and DATA_KEY in the environment beside a keyring is refused, not guessed between', f.threw === 'exit 1' && /AND DATA_KEY_FILE holds a keyring/.test(f.errs.join(' ')), f.threw);
  writeFileSync(path.join(dir, 'keyfile-ring'), JSON.stringify({ ...KL.newRingFromLegacy(Buffer.from(k1, 'hex')), generation: 9 }), { mode: 0o600 });
  const g = run({ DATA_KEY_FILE: path.join(dir, 'keyfile-ring') }, dir, true);
  check('  ...and a keyring whose checksum does not match (edited, truncated) stops the server', g.threw === 'exit 1' && /checksum/.test(g.errs.join(' ')), g.threw);
  rmSync(dir, { recursive: true, force: true });
  check('boot warns when the key or the backups sit on the database\'s volume', /if \(DATA_KEY_SOURCE === 'data-dir'\) warn\(/.test(SRC) && /if \(DATA_KEY_SOURCE === 'file-same-volume'\) warn\(/.test(SRC) && /if \(!BACKUP_OFF_VOLUME\) warn\(/.test(SRC));
  // the startup key check: its behaviour (wrong key, missing key id, wrong index epoch) is driven against real servers in tests/keyrotate.mjs
  check('the startup key check runs before the first migration that writes an encrypted value', SRC.indexOf("refuse('the encryption key does not open the data already in this database") > 0 && SRC.indexOf("refuse('the encryption key does not open the data already in this database") < SRC.indexOf("SELECT id, tracker_prefs, site_prefs FROM users WHERE NOT "));
  const bvSrc = grab(/const BACKUP_OFF_VOLUME = \(\(\) => \{[\s\S]*?\n\}\)\(\);\n/, 'BACKUP_OFF_VOLUME');
  const bv = (env, devs) => new Function('process', 'path', 'fs', 'DATA_DIR', bvSrc + '\nreturn BACKUP_OFF_VOLUME;')({ env }, path, { statSync: (pth) => ({ dev: devs[pth] }) }, '/data');
  check('backups count as separate only on another volume: inside data/ no, a sibling folder on the same volume no, another volume yes',
    bv({ BACKUP_DIR: '/data/backups' }, { '/data/backups': 1, '/data': 1 }) === false && bv({ BACKUP_DIR: '/elsewhere' }, { '/elsewhere': 1, '/data': 1 }) === false && bv({ BACKUP_DIR: '/Volumes/B' }, { '/Volumes/B': 2, '/data': 1 }) === true && bv({}, {}) === false);
  check('admin.js shows where the key and the backups are', /Encryption key/.test(ADMINJS) && /Backups on their own volume/.test(ADMINJS));
  /* the rotate route needs "confirm it's you": only auth.js's api() (window.api) opens that step and sends again — admin.js's own
     post() does not. The buttons once called AUTH.api, which nothing defines, so every press said "AUTH.api is not a function" */
  check('the key-rotation buttons send through auth.js\'s window.api, which opens "confirm it\'s you" and sends again',
    /await window\.api\('\/api\/admin\/keys\/rotate', \{ method: 'POST'/.test(ADMINJS) && /\n  window\.api = api;\n/.test(AUTHJS)
    && /res\.status === 401 && j\.code === 'need_verify'[\s\S]{0,300}?return api\(path, /.test(AUTHJS));
  const authHas = new Set([...AUTHJS.matchAll(/\bAUTH\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((m) => m[1]));
  const authMissing = [...new Set([...ADMINJS.matchAll(/\bAUTH\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]))].filter((n) => !authHas.has(n));
  check('  ...and every AUTH.<name>() that admin.js calls is one auth.js defines', authMissing.length === 0, authMissing.join(', '));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  for (const id of made) { try { db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {} }
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
