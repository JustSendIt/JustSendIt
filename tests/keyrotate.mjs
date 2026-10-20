/* ===== Key rotation, end to end =========================================================================
   lib/keys.js on its own (formats, the index re-wrap, the keyring file, escrow), then REAL servers in a directory of
   this suite's own — a key "volume", a backups folder and an extra database file — taken through what the live site
   will do: a single key converted to a keyring, an emergency rotation of everything with the old key dropped, a data
   key rotated from the admin page with the site up, a weekly-style index rotation through a restart, a crash at every
   step of a rotation, and the refusals that keep a wrong key from starting. Every protected column is filled first, and
   after each step every one of them is checked against what it protects. Nothing here touches the shared test server
   or any real key: the suite's directory is deleted at the end. */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createRequire } from 'node:module';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, SERVER_JS, ETHERS } from './_paths.mjs';

const require = createRequire(import.meta.url);
const K = require(path.join(ROOT, 'lib', 'keys.js'));
const { Wallet } = require(ETHERS);
const SRC = fs.readFileSync(SERVER_JS, 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-keyrot-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ═══ 1. the module on its own ═══ */
{
  const key = randomBytes(32);
  const IDX = createHmac('sha256', key).update('blind-index').digest();
  const oldBidx = (s) => createHmac('sha256', IDX).update(String(s)).digest('hex');
  const L = K.Keys.legacy(key);
  check('single-key mode writes exactly the old forms: v1 fields, 0x01 blobs, the old index', L.encField('x').startsWith('v1:') && L.encBlob(Buffer.from('b'))[0] === 1 && L.bidx('a@b.c') === oldBidx('a@b.c'));
  check('  ...and plaintext (a value from before encryption, or the {} default) passes through', L.decField('{}') === '{}' && L.decField('hello') === 'hello');
  const ring = K.newRingFromLegacy(key);
  const R = K.Keys.fromRing(K.validateRing(JSON.parse(JSON.stringify(ring))));
  check('a keyring made from the key reads the old values and keeps the old index at epoch 0', R.decField(L.encField('hi')) === 'hi' && R.bidx('a@b.c') === oldBidx('a@b.c') && R.decBlob(L.encBlob(Buffer.from('z'))).toString() === 'z');
  const r2 = JSON.parse(JSON.stringify(ring));
  r2.dek.keys.push({ id: 2, hex: randomBytes(32).toString('hex'), added: 1, retiredAt: null }); r2.dek.current = 2; r2.dek.nextId = 3;
  r2.idx.outer.push({ epoch: 1, hex: randomBytes(32).toString('hex'), added: 1 }); r2.idx.nextEpoch = 2;
  R.adopt(K.sealRing(r2));
  const v = R.encField('secret'), b = R.encBlob(Buffer.from('blob'));
  check('a new key writes v2:<id>: fields and 0x02 blobs that open', /^v2:2:/.test(v) && R.decField(v) === 'secret' && b[0] === 2 && b.readUInt32BE(1) === 2 && R.decBlob(b).toString() === 'blob');
  check('  ...the key id is authenticated: relabelled, it opens with nothing', R.decField(v.replace('v2:2:', 'v2:1:')) === null && (() => { const c = Buffer.from(b); c.writeUInt32BE(1, 1); return R.decBlob(c) === null; })());
  check('  ...an unknown key id or a malformed v2 value is unreadable (null), never passed through as text', R.decField('v2:7:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') === null && R.decField('v2:zz') === null);
  check('  ...and the old single-key reader cannot open a new value', L.decField(v) === null);
  const h0 = R.bidxAt('ip:9.9.9.9', 0), h1 = R.bidxAt('ip:9.9.9.9', 1);
  { const R2 = K.Keys.fromRing(K.validateRing(JSON.parse(JSON.stringify(R.ring)))); R2.setEpoch(1); const before = R2.bidx('x');
    const noE1 = JSON.parse(JSON.stringify(R.ring)); noE1.idx.outer = []; K.sealRing(noE1);
    let threw = false; try { R2.adopt(noE1); } catch { threw = true; }
    check('taking up a ring that lacks the epoch in use fails WITHOUT touching the keys in use (no zeroed index key)', threw && R2.bidx('x') === before && R2.epoch === 1); }
  { const { DatabaseSync: D } = await import('node:sqlite'); const d = new D(':memory:'); d.exec('CREATE TABLE wallet_hist (hist BLOB)'); const b = Buffer.alloc(30); b[0] = 2; b.writeUInt32BE(3, 1); d.prepare('INSERT INTO wallet_hist VALUES (?)').run(b);
    check('a short 0x02 blob counts under the same key id in the quick census as in the full one', JSON.stringify(K.prefixCensus(d).kids) === JSON.stringify({ 0: 1 }) && K.blobKid(b) === 0); d.close(); }
  check('the index re-wrap moves a stored index between epochs without its input, and back', h1 !== h0 && R.rewrapIdx(h0, 0, 1) === h1 && R.rewrapIdx(h1, 1, 0) === h0 && /^[0-9a-f]{64}$/.test(h1));
  const spec = K.IDX_COLUMNS.find((s) => s.t === 'points_events');
  check('  ...award markers move by their index part only; a community-XP ref (v<id>:…) is not an index and stays', K.rewrapValue(spec, 'track:5:' + h0, R, 0, 1) === 'track:5:' + h1 && K.rewrapValue(spec, 'v12:3', R, 0, 1) === null && K.rewrapValue(spec, 'swaptx:' + h0, R, 0, 1) === 'swaptx:' + h1);
  check('  ...a raw IP or a pre-migration plaintext is left for the boot migration', K.rewrapValue({ t: 'calls', c: 'ip' }, '10.0.0.1', R, 0, 1) === null);
  const jspec = K.IDX_COLUMNS.find((s) => s.json);
  check('  ...and a JSON list of indexes moves element by element', K.rewrapValue(jspec, JSON.stringify([h0, 'x']), R, 0, 1) === JSON.stringify([h1, 'x']));
  const e = K.escrowKeygen(), sealed = K.escrowSeal(e.pub, 'ring');
  check('escrow: a sealed ring opens with the recovery key and with no other', K.escrowOpen(e.priv, sealed).toString() === 'ring' && (() => { try { K.escrowOpen(K.escrowKeygen().priv, sealed); return false; } catch { return true; } })());
  // the ring file: atomic write, prev copy, checksum, permissions, lock, the test guard
  const d = path.join(T, 'unit'); fs.mkdirSync(d, { mode: 0o700 });
  const f = path.join(d, 'data_key'); fs.writeFileSync(f, key.toString('hex') + '\n', { mode: 0o600 });
  const w1 = K.writeRing(f, ring, {});
  check('writing a keyring over the hex key keeps the hex key as keyring.prev.json, and reads back', K.readKeyFile(f).kind === 'ring' && fs.readFileSync(path.join(d, 'keyring.prev.json'), 'utf8').trim() === key.toString('hex') && w1.generation === 1);
  const w2 = K.writeRing(f, w1, { dropping: true });
  check('  ...a dropping write replaces keyring.prev.json too, so a dropped key does not live on beside the ring', fs.readFileSync(path.join(d, 'keyring.prev.json'), 'utf8') === fs.readFileSync(f, 'utf8') && w2.generation === 2);
  const txt = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, txt.replace('"generation": 2', '"generation": 3'));
  check('  ...an edited ring fails its checksum and is refused', (() => { try { K.readKeyFile(f); return false; } catch (x) { return /checksum/.test(x.message); } })());
  fs.writeFileSync(f, txt); fs.chmodSync(f, 0o666);
  check('  ...a ring other accounts could write is refused; one they could only read is tightened to 600', (() => { try { K.readKeyFile(f); return false; } catch (x) { return /written by other accounts/.test(x.message); } })() && (fs.chmodSync(f, 0o644), K.readKeyFile(f), (fs.statSync(f).mode & 0o777) === 0o600));
  fs.writeFileSync(path.join(d, 'keyring.lock'), String(process.ppid));
  check('  ...a second writer is refused while the first holds the lock; a lock left by a dead process is taken over', (() => { try { K.writeRing(f, w2, {}); return false; } catch (x) { return /another process/.test(x.message); } })() && (fs.writeFileSync(path.join(d, 'keyring.lock'), '999999'), K.writeRing(f, w2, {}).generation === 3));
  fs.writeFileSync(path.join(d, 'keyring.lock'), String(process.ppid)); const old = new Date(Date.now() - 120e3); fs.utimesSync(path.join(d, 'keyring.lock'), old, old);
  check('  ...and a lock older than a minute is taken over even when its pid is alive again (a reused pid after a crash and reboot)', (() => { try { return K.writeRing(f, w2, {}).generation === 3; } catch (x) { return x.message; } })() === true);
  check('  ...and no temp copy of the ring is ever left beside it', !fs.readdirSync(d).some((n) => n.endsWith('.tmp')));
  { const md = path.join(T, 'mark'); fs.mkdirSync(md); K.writeBackupMarker(md, 'A', T);
    check('a marked backups folder belongs to its database: the owner may use it; another database, or one expecting no marker, may not', K.backupMarkerOk(md, 'A', 'A', T) && !K.backupMarkerOk(md, null, 'B', T) && !K.backupMarkerOk(md, null, null, T) && !K.backupMarkerOk(md, 'B', 'B', T) && !K.backupMarkerOk(md, 'A', 'A', path.join(T, 'elsewhere')) && K.backupMarkerOk(path.join(T, 'nomark'), null, 'X', T) && !K.backupMarkerOk(path.join(T, 'nomark'), 'A', 'A', T)); }
  const prevEnv = process.env.JSI_DATA_DIR; process.env.JSI_DATA_DIR = '/tmp/x';
  check('a test run (JSI_DATA_DIR set) can never write a keyring under /Volumes', (() => { try { K.writeRing('/Volumes/JustSendItKey/data_key', w2, {}); return false; } catch (x) { return /refusing/.test(x.message); } })());
  if (prevEnv === undefined) delete process.env.JSI_DATA_DIR; else process.env.JSI_DATA_DIR = prevEnv;
  check('the registry covers every column the server encrypts with encField/encBlob', (() => {
    const cols = new Set(K.ENC_FIELDS.map(([t, c]) => c).concat(K.ENC_BLOBS.map(([t, c]) => c)));
    const need = ['identifier_enc', 'address_enc', 'holder_proof', 'tracker_prefs', 'site_prefs', 'twofa_secret', 'twofa_pending', 'gate_wallets', 'msg', 'wallet', 'report', 'hist'];
    return need.every((c) => cols.has(c));
  })());
  check('  ...and no migration in server.js still tests for the v1: prefix alone (it would re-encrypt a rotated value)', !/NOT LIKE 'v1:%'/.test(SRC) && !/startsWith\('v1:'\)/.test(SRC));
}

/* ═══ 2. real servers ═══ */
const DATA = path.join(T, 'data'), KV = path.join(T, 'keyvol'), BK = path.join(T, 'backups'), EXTRA = path.join(T, 'extra');
for (const x of [DATA, path.join(DATA, 'uploads'), KV, BK, EXTRA]) fs.mkdirSync(x, { recursive: true, mode: 0o700 });
const KEYFILE = path.join(KV, 'data_key');
const K1 = randomBytes(32);
fs.writeFileSync(KEYFILE, K1.toString('hex') + '\n', { mode: 0o600 });
async function freePort() {
  for (;;) {
    const p = await new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, () => { const port = s.address().port; s.close(() => res(port)); }); });
    if (p !== 8642) return p;
  }
}
const PORT = await freePort(), BASE = 'http://localhost:' + PORT;
const ENV = { ...process.env, PORT: String(PORT), JSI_DATA_DIR: DATA, DATA_DIR: DATA, BASE_URL: BASE, NODE_ENV: 'test', SEED_INVITE_CODE: '12345', TOS_GATE: '1',
  TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback', SEED_CODES_OPEN: '1', ADMIN_USER_IDS: '', RPC_URL: 'http://127.0.0.1:9/',
  DATA_KEY: '', DATA_KEY_FILE: KEYFILE, BACKUP_DIR: BK, KEY_ROTATE_EXTRA_DBS: EXTRA, KEY_MAINT_DELAY_MS: '200', KEY_TICK_SEC: '1',
  KEY_DROP_GRACE_MIN: '0', IDX_ROTATE_DAYS: '0', KEY_ROTATE_HOURS: '24', JSI_ROTATE_CRASH_AT: '' };
let proc = null, log = '';
async function start(extra = {}) {
  log = '';
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER_JS], { cwd: ROOT, env: { ...ENV, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  const me = proc;
  me.stdout.on('data', (d) => { log += d; }); me.stderr.on('data', (d) => { log += d; });
  me.done = new Promise((res) => me.on('exit', (code) => res(code)));
  const until = Date.now() + 25000;
  while (Date.now() < until) {
    if (me.exitCode != null) return { up: false, code: me.exitCode, log };
    try { const r = await fetch(BASE + '/healthz'); if (r.ok) return { up: true, log }; } catch {}
    await sleep(100);
  }
  return { up: false, code: 'timeout', log };
}
async function stop() { if (!proc) return; if (proc.exitCode == null) { proc.kill('SIGTERM'); await Promise.race([proc.done, sleep(15000)]); } proc = null; }
const cli = (...args) => { try { return { ok: true, out: execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'scripts', 'keys.mjs'), ...args], { cwd: ROOT, env: { ...ENV }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') }; } };
const openDb = (f = path.join(DATA, 'app.db')) => { const d = new DatabaseSync(f, { enableForeignKeyConstraints: false }); d.exec('PRAGMA busy_timeout = 5000'); return d; };
const ringNow = () => K.readKeyFile(KEYFILE);
const keysNow = () => { const kf = ringNow(); const k = kf.kind === 'ring' ? K.Keys.fromRing(kf.ring) : K.Keys.legacy(kf.key); return k; };
const TOS_VERSION = (/const TOS_VERSION = '([^']+)'/.exec(SRC) || [])[1];
function freshPass() {
  const d = openDb(), code = 'KRTEST' + randomBytes(4).toString('hex').toUpperCase(), tok = randomBytes(24).toString('hex');
  d.prepare('INSERT INTO invite_codes (code, owner_id, created_at, used_at, pass, tos_at, tos_version) VALUES (?,NULL,?,?,?,?,?)').run(code, Date.now(), Date.now(), createHash('sha256').update(tok).digest('hex'), Date.now(), TOS_VERSION);
  d.close();
  return 'jsi_pass=' + tok + '; jsi_age=18';
}
async function api(p, opts = {}) {
  const cookie = [opts.pass || '', opts.sid ? 'sid=' + opts.sid : ''].filter(Boolean).join('; ');
  const r = await fetch(BASE + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}), ...(opts.ip ? { 'X-Forwarded-For': opts.ip } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  const sid = (/(?:^|[,\s])sid=([^;]+)/.exec(r.headers.get('set-cookie') || '') || [])[1] || null;
  return { status: r.status, j, sid };
}
// a row with every NOT NULL column filled, for the tables whose own flows need a chain or a second party
function fill(d, table, vals) {
  const cols = d.prepare('PRAGMA table_info(' + table + ')').all();
  const row = { ...vals };
  for (const c of cols) if (!(c.name in row) && c.notnull && c.dflt_value == null && !c.pk) row[c.name] = /INT|REAL/i.test(c.type) ? 1 : '';
  const names = Object.keys(row);
  return d.prepare('INSERT INTO ' + table + ' (' + names.join(',') + ') VALUES (' + names.map(() => '?').join(',') + ')').run(...names.map((n) => row[n]));
}
// a GitHub runner is several times slower than this Mac: maintenance waits there have timed out at 20 s (2026-10-13) and at
// 30 s (the index-epoch drop, 2026-10-15). Every maintenance wait gets a minute; a pass that finishes sooner returns at once.
const MAINT_WAIT = 60000;
async function waitFor(fn, ms = MAINT_WAIT) { const until = Date.now() + ms; while (Date.now() < until) { try { const v = fn(); if (v) return v; } catch {} await sleep(150); } return null; }
const metaOf = (k) => { const d = openDb(); try { return K.getMeta(d, k); } finally { d.close(); } };
async function maintenanceAfter(t0) { return waitFor(() => { const m = JSON.parse(metaOf('last_maintenance') || 'null'); return m && m.at >= t0 ? m : null; }, MAINT_WAIT); }

const A = { name: '__kr_a_' + randomBytes(3).toString('hex'), email: 'kr' + randomBytes(3).toString('hex') + '@example.com', pw: 'key-rotation-' + randomBytes(4).toString('hex') };
const W1 = Wallet.createRandom(), W1a = W1.address.toLowerCase();
const OG = '0x' + randomBytes(20).toString('hex'), GATEW = '0x' + randomBytes(20).toString('hex'), TRACKED = '0x' + randomBytes(20).toString('hex');
const IPS = { signup: '10.11.12.13', join: '10.20.30.40', alert: '10.9.8.7', miss: '10.5.5.5', call: '10.6.6.6' };
// a day ago: inside the 30-day window sweepIpIndexes keeps (it runs 5 s after every boot — a 1970 stamp was gone whenever a server lived that long)
const MISS_AT = Date.now() - 864e5;
let ESCROW_PRIV = null;
// what every seeded index must equal, at a given epoch, under the keys of the moment
function expectIndexes(keys, epoch, uid) {
  const d = openDb(); const bad = [];
  try {
    const want = [
      ['identities wallet', "SELECT identifier v FROM identities WHERE type = 'wallet' AND user_id = ?", [uid], keys.bidxAt(W1a, epoch)],
      ['identities email', "SELECT identifier v FROM identities WHERE type = 'email' AND user_id = ?", [uid], keys.bidxAt(A.email.toLowerCase(), epoch)],
      ['tracked_wallets', 'SELECT address v FROM tracked_wallets WHERE user_id = ?', [uid], keys.bidxAt(TRACKED, epoch)],
      ['og_claims', 'SELECT addr_idx v FROM og_claims WHERE user_id = ?', [uid], keys.bidxAt(OG, epoch)],
      ['gate_claims', 'SELECT addr_idx v FROM gate_claims WHERE user_id = ?', [uid], keys.bidxAt(GATEW, epoch)],
      ['api_key_burns', "SELECT wallet_idx v FROM api_key_burns WHERE key_hash = 'krkey'", [], keys.bidxAt(OG, epoch)],
      ['api_keys.wallets_idx', "SELECT wallets_idx v FROM api_keys WHERE key_hash = 'krkey'", [], JSON.stringify([keys.bidxAt(OG, epoch), keys.bidxAt(GATEW, epoch)])],
      ['points connect', "SELECT ref v FROM points_events WHERE kind = 'kr_connect'", [], 'connect:' + keys.bidxAt(W1a, epoch)],
      ['points track (an unlinked wallet: unrecoverable without the re-wrap)', "SELECT ref v FROM points_events WHERE kind = 'kr_track'", [], 'track:' + uid + ':' + keys.bidxAt('0x00000000000000000000000000000000000000aa', epoch)],
      ['email_misses ip', "SELECT key v FROM email_misses WHERE key LIKE 'ip:%' AND at = " + MISS_AT, [], 'ip:' + keys.bidxAt('ip:' + IPS.miss, epoch)],
      ['users.signup_ip', 'SELECT signup_ip v FROM users WHERE id = ?', [uid], keys.bidxAt('ip:' + IPS.signup, epoch)],
      ['community_members.join_ip', 'SELECT join_ip v FROM community_members WHERE user_id = ?', [uid], keys.bidxAt(IPS.join, epoch)],
      ['alerts.ip', 'SELECT ip v FROM alerts WHERE user_id = ?', [uid], keys.bidxAt(IPS.alert, epoch)],
      ['calls.ip', 'SELECT ip v FROM calls WHERE user_id = ?', [uid], keys.bidxAt('ip:' + IPS.call, epoch)],
      ['wallet_hist.addr_idx', 'SELECT addr_idx v FROM wallet_hist WHERE user_id = ?', [uid], keys.bidxAt(W1a, epoch)],
      ['tracker_cache.addr_idx', 'SELECT addr_idx v FROM tracker_cache WHERE user_id = ?', [uid], keys.bidxAt(TRACKED, epoch)],
    ];
    for (const [n, sql, args, exp] of want) { const r = d.prepare(sql).get(...args); if (!r || r.v !== exp) bad.push(n); }
  } finally { d.close(); }
  return bad;
}
// every encrypted value, opened with the keys of the moment, as text — equal across a rotation means nothing changed meaning
function plainOf(keys) {
  const d = openDb(); const out = {};
  try {
    /* the site's own system account is made by a boot timer 2.5 s after a server listens (seedOfficialCommunities), so it
       appears whenever a test server lives that long: it is not this test's data, and a snapshot that included it only
       sometimes failed on a slower machine (CI). */
    for (const [t, c] of K.ENC_FIELDS) { if (K.FLIP_DELETE.includes(t) || !K.hasCol(d, t, c)) continue; for (const r of d.prepare(`SELECT rowid r, ${c} v FROM ${t} WHERE ${c} IS NOT NULL${t === 'users' ? ' AND system = 0' : ''} ORDER BY rowid`).all()) out[t + '.' + c + '#' + r.r] = keys.openField(r.v).plain; }
    for (const [t, c] of K.ENC_BLOBS) for (const r of d.prepare(`SELECT rowid r, ${c} v FROM ${t} ORDER BY rowid`).all()) { const o = keys.openBlob(r.v); out[t + '#' + r.r] = o.plain ? o.plain.toString('base64') : null; }
  } finally { d.close(); }
  return out;
}
const kidsInDb = (f) => { const d = openDb(f); try { return K.prefixCensus(d).kids; } finally { d.close(); } };

let uid = null;
try {
  /* ── 2a. a site on a single key, with every protected column filled ── */
  let s = await start();
  check('a server on a single key starts and says it does not rotate', s.up && /single key, no rotation/.test(s.log), s.code + ' ' + s.log.slice(-400));
  const reg = await api('/api/auth/register', { method: 'POST', pass: freshPass(), ip: IPS.signup, body: { username: A.name, email: A.email, password: A.pw } });
  check('an account is made by email (identities + signup IP index)', reg.status === 200, reg.status + ' ' + JSON.stringify(reg.j));
  { const d = openDb(); uid = d.prepare('SELECT id FROM users WHERE username = ?').get(A.name).id; d.close(); }
  await api('/api/auth/wallet/nonce?purpose=signin&address=' + W1a);   // a live sign-in challenge (deleted at an index flip)
  await stop();
  {
    const L = K.Keys.legacy(K1), d = openDb(), t = Date.now();
    d.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc, linked_at) VALUES (?, 'wallet', ?, ?, ?)").run(uid, L.bidx(W1a), L.encField(W1a), t - 3 * 864e5);
    d.prepare('INSERT INTO tracked_wallets (user_id, address, address_enc, label, created_at) VALUES (?,?,?,?,?)').run(uid, L.bidx(TRACKED), L.encField(TRACKED), 'kr', t);
    d.prepare('UPDATE users SET holder_proof = ?, tracker_prefs = ?, site_prefs = ?, twofa_pending = ?, gate_wallets = ? WHERE id = ?').run(L.encField('{"proof":1}'), L.encField('{"kr":"tracker"}'), L.encField('{"kr":"site"}'), L.encField('JBSWY3DPEHPK3PXP'), L.encField(JSON.stringify([GATEW])), uid);
    fill(d, 'og_claims', { addr_idx: L.bidx(OG), user_id: uid, claimed_at: t });
    fill(d, 'gate_claims', { addr_idx: L.bidx(GATEW), user_id: uid, claimed_at: t });
    fill(d, 'api_keys', { key_hash: 'krkey', user_id: uid, wallet: L.encField(OG), wallets_idx: JSON.stringify([L.bidx(OG), L.bidx(GATEW)]), burned_wei: '1', burned_usd: 1, price_usd: 1, minted_at: t, revoked_at: t });
    fill(d, 'api_key_burns', { key_hash: 'krkey', wallet_idx: L.bidx(OG), wei: '1' });
    fill(d, 'points_events', { user_id: uid, kind: 'kr_connect', amount: 0, base: 0, ref: 'connect:' + L.bidx(W1a), created_at: t });
    fill(d, 'points_events', { user_id: uid, kind: 'kr_track', amount: 0, base: 0, ref: 'track:' + uid + ':' + L.bidx('0x00000000000000000000000000000000000000aa'), created_at: t });
    fill(d, 'points_events', { user_id: uid, kind: 'kr_conv', amount: 0, base: 0, ref: 'v77:1', created_at: t });
    d.prepare('INSERT INTO email_misses (key, at) VALUES (?, ?)').run('ip:' + L.bidx('ip:' + IPS.miss), MISS_AT);
    const cid = Number(fill(d, 'communities', { creator_id: uid, token_addr: '0x' + randomBytes(20).toString('hex'), created_at: t, creator_ip: L.bidx(IPS.join) }).lastInsertRowid);
    fill(d, 'community_members', { community_id: cid, user_id: uid, joined_at: t, join_ip: L.bidx(IPS.join) });
    fill(d, 'alerts', { user_id: uid, target_id: uid, ip: L.bidx(IPS.alert), created_at: t });
    fill(d, 'calls', { user_id: uid, token_addr: '0x' + randomBytes(20).toString('hex'), created_at: t, ip: L.bidx('ip:' + IPS.call) });
    fill(d, 'tracker_cache', { user_id: uid, addr_idx: L.bidx(TRACKED), report: L.encField('{"report":"kr"}'), updated_at: t });
    fill(d, 'wallet_hist', { user_id: uid, addr_idx: L.bidx(W1a), read_to: 1, updated_at: t, partial: 0, hist: L.encBlob(randomBytes(70000)) });
    d.close();
  }
  check('every seeded index holds under the single key (epoch 0)', expectIndexes(K.Keys.legacy(K1), 0, uid).length === 0, expectIndexes(K.Keys.legacy(K1), 0, uid).join(', '));
  const PLAIN0 = plainOf(K.Keys.legacy(K1));
  const plainVals = Object.values(PLAIN0);
  check('  ...and every encrypted value opens (' + plainVals.length + ' values)', plainVals.length >= 11 && plainVals.every((v) => v != null));
  // copies the rotation must bring along: a daily, a pre-wipe copy, and a file named in KEY_ROTATE_EXTRA_DBS
  { const d = openDb(); for (const f of [path.join(BK, 'app-2026-01-01.db'), path.join(BK, 'pre-wipe-20260101-000000.db'), path.join(EXTRA, 'dev.db')]) d.prepare('VACUUM INTO ?').run(f); d.close(); }
  const OLD_MTIME = new Date('2026-01-01T12:00:00Z'); fs.utimesSync(path.join(BK, 'app-2026-01-01.db'), OLD_MTIME, OLD_MTIME);

  /* ── 2b. the switch-over: init, escrow, an emergency rotation of everything ── */
  { const wrong = path.join(KV, 'wrong_key'); fs.writeFileSync(wrong, randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
    let out = ''; try { execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'scripts', 'keys.mjs'), 'init'], { cwd: ROOT, env: { ...ENV, DATA_KEY_FILE: wrong }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); out = 'CONVERTED'; } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
    check('init refuses a key file that does not open the stored values, and changes nothing', /opens none of/.test(out) && K.readKeyFile(wrong).kind === 'hex', out.slice(0, 200));
    fs.unlinkSync(wrong); }
  const init = cli('init');
  check('scripts/keys.mjs init converts the key file to a keyring (server stopped) and prints no key', init.ok && ringNow().kind === 'ring' && !init.out.includes(K1.toString('hex')), init.out.slice(0, 300));
  check('  ...and refuses a second time', !cli('init').ok);
  const noTty = cli('escrow-init');
  check('escrow-init refuses to print the recovery key into captured output (a chat, a log) and sets nothing up', !noTty.ok && /NOT RUN/.test(noTty.out) && !/[0-9a-f]{64}/.test(noTty.out) && !fs.existsSync(path.join(KV, 'escrow.pub')), noTty.out.slice(0, 200));
  const recFile = path.join(T, 'escrow-recovery-key.txt');
  const esc = cli('escrow-init', '--to', recFile);
  ESCROW_PRIV = (/\n\s+([0-9a-f]{64})\n/.exec(fs.existsSync(recFile) ? fs.readFileSync(recFile, 'utf8') : '') || [])[1] || null;
  check('escrow-init --to FILE writes the recovery key only into that new file (mode 600), prints only where, and stores just the public half beside the ring', esc.ok && !!ESCROW_PRIV && !/[0-9a-f]{64}/.test(esc.out) && (fs.statSync(recFile).mode & 0o777) === 0o600 && fs.existsSync(path.join(KV, 'escrow.pub')) && !fs.readFileSync(path.join(KV, 'escrow.pub'), 'utf8').includes(ESCROW_PRIV), esc.out.slice(0, 200));
  check('  ...and never overwrites an existing file', !cli('escrow-init', '--replace', '--to', recFile).ok);
  const st0 = cli('status');
  check('status names keys by id and fingerprint, never by their bytes', st0.ok && /data key 1 \(current\)/.test(st0.out) && !st0.out.includes(K1.toString('hex')), st0.out.slice(0, 300));
  const rq = cli('request', '--all', '--compromised');
  check('request --all --compromised leaves a request for the next start', rq.ok && fs.existsSync(path.join(KV, 'rotate-request.json')));
  let t0 = Date.now();
  /* the boot pass starts just before the first one-second tick, so that tick lands while the pass is still running. On a
     slow runner that happened by itself (GitHub run 39082655259): the tick, seeing no finished report yet, queued a second
     pass behind it, and that pass's report (every file already current, nothing left to drop) replaced the one that did the
     work. The server now starts no check while a pass is running or queued; this start keeps that honest on any machine. */
  s = await start({ KEY_MAINT_DELAY_MS: '950' });
  check('the server starts on the keyring and takes the request before serving: new data key, index epoch 0 → 1, live data re-encrypted', s.up && /data key 2 made current/.test(s.log) && /index key: epoch 0 → 1/.test(s.log) && /re-encrypted \d+ values under data key 2/.test(s.log), s.log.slice(-600));
  let m = await maintenanceAfter(t0);
  check('  ...then brings every backup file along and drops the stolen key (compromised: no grace)', m && m.files.length === 4 && m.files.every((f) => f.status === 'rekeyed') && m.dropped.includes('data key 1'), m && JSON.stringify({ files: m.files.map((f) => f.file + ':' + f.status + ':' + (f.why || '')), dropped: m.dropped, waiting: m.waiting, err: m.error }));
  const bootPass = m;
  let ring = ringNow().ring;
  check('the keyring now holds only data key 2 and index epoch 1; key 1 is listed as dropped', ring.dek.keys.map((k) => k.id).join() === '2' && ring.dek.dropped.some((x) => x.id === 1) && ring.idx.outer.map((o) => o.epoch).join() === '1');
  check('  ...and the old key is nowhere beside it: not in the ring, not in keyring.prev.json, no temp file', !fs.readdirSync(KV).some((n) => fs.readFileSync(path.join(KV, n), 'utf8').includes(K1.toString('hex'))), fs.readdirSync(KV).join(','));
  const escFiles = fs.readdirSync(path.join(BK, 'keyring-escrow')).sort();
  const opened = escFiles.map((n) => { try { return K.validateRing(JSON.parse(K.escrowOpen(ESCROW_PRIV, fs.readFileSync(path.join(BK, 'keyring-escrow', n))).toString())); } catch { return null; } });
  check('  ...every keyring change was sealed to escrow, and a sealed copy from before the drop still holds key 1', escFiles.length >= 3 && opened.every(Boolean) && opened.some((r) => r.dek.keys.some((k) => k.id === 1 && k.hex === K1.toString('hex'))), escFiles.length);
  let k2 = keysNow(); k2.setEpoch(1);
  check('every seeded index now matches under epoch 1 — including the IP indexes and the award marker for a wallet no longer linked', expectIndexes(k2, 1, uid).length === 0, expectIndexes(k2, 1, uid).join(', '));
  const PLAIN1 = plainOf(k2);
  check('every encrypted value still says exactly what it said', JSON.stringify(PLAIN1) === JSON.stringify(PLAIN0), Object.keys(PLAIN0).filter((x) => PLAIN0[x] !== PLAIN1[x]).slice(0, 5).join(','));
  // (at least every value seeded here — the system account a boot timer makes may have added its own)
  check('  ...and all of them are under key 2 (none left under the stolen key)', (() => { const k = kidsInDb(); return JSON.stringify(Object.keys(k)) === '["2"]' && k[2] >= Object.keys(PLAIN0).length; })(), JSON.stringify(kidsInDb()));
  { const L = K.Keys.legacy(K1), d = openDb(); let opens = 0; for (const [t, c] of K.ENC_FIELDS) { if (!K.hasCol(d, t, c)) continue; for (const r of d.prepare(`SELECT ${c} v FROM ${t} WHERE ${c} IS NOT NULL`).all()) if (L.openField(r.v).plain != null && K.isCipher(r.v)) opens++; }
    const found = d.prepare('SELECT 1 FROM identities WHERE identifier = ?').get(L.bidx(A.email.toLowerCase())); d.close();
    check('the stolen key opens nothing in the live database and finds nobody by email', opens === 0 && !found, opens); }
  { const d = openDb(); const n = d.prepare("SELECT COUNT(*) n FROM points_events WHERE ref = 'v77:1'").get().n, ch = d.prepare('SELECT COUNT(*) n FROM wallet_challenges').get().n; d.close();
    check('a community-XP ref is untouched, and ten-minute sign-in challenges were cleared at the flip', n === 1 && ch === 0, n + ' ' + ch); }
  for (const f of [path.join(BK, 'app-2026-01-01.db'), path.join(BK, 'pre-wipe-20260101-000000.db'), path.join(EXTRA, 'dev.db')]) {
    const d = new DatabaseSync(f, { readOnly: true }); const c = K.trialCensus(d, k2); d.close();
    check('backup ' + path.basename(f) + ': key 2 only, index epoch 1, nothing unreadable', JSON.stringify(Object.keys(c.refs)) === '["2"]' && !Object.keys(c.unreadable).length && c.epoch === 1, JSON.stringify(c));
  }
  check('  ...a rewritten backup keeps its date (the admin list and pruning go by it)', fs.statSync(path.join(BK, 'app-2026-01-01.db')).mtimeMs === OLD_MTIME.getTime());
  check('  ...and a copy of the database from before the flip sits beside the backups, brought along too', fs.readdirSync(BK).some((n) => /^pre-idx-e0-.*\.db$/.test(n)));
  /* that copy was made with the sign-in session from 2a and its challenge in it. The first snapshot after the boot (15 s)
     scrubs it like a daily, and it keeps its date (the newest two are kept by it) and all a restore needs */
  {
    const pre = fs.readdirSync(BK).find((n) => /^pre-idx-e0-.*\.db$/.test(n)), f = pre ? path.join(BK, pre) : null, mt = f ? fs.statSync(f).mtimeMs : 0;
    const hadSessions = (() => { const d = openDb(); try { return d.prepare('SELECT COUNT(*) n FROM sessions WHERE created_at < ?').get(t0).n; } finally { d.close(); } })();
    const got = f && await waitFor(() => {
      const d = new DatabaseSync(f, { readOnly: true });
      try {
        d.exec('PRAGMA busy_timeout = 2000');
        if (!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_jsi_scrubbed'").get()) return null;
        const n = (sql, ...a) => d.prepare(sql).get(...a).n;
        return { sessions: n('SELECT COUNT(*) n FROM sessions'), challenges: n('SELECT COUNT(*) n FROM wallet_challenges'), ips: n('SELECT COUNT(*) n FROM users WHERE signup_ip IS NOT NULL'),
          census: K.trialCensus(d, k2), dbId: K.getMeta(d, 'db_id'), email: n('SELECT COUNT(*) n FROM identities WHERE user_id = ? AND identifier = ?', uid, k2.bidxAt(A.email.toLowerCase(), 1)) };
      } finally { d.close(); }
    });
    check('  ...that copy is scrubbed like a daily at the first snapshot: no sessions, challenges or IP hashes (it was made with a session in it)', hadSessions > 0 && !!got && got.sessions === 0 && got.challenges === 0 && got.ips === 0, JSON.stringify({ pre, hadSessions, got: got && { s: got.sessions, c: got.challenges, ips: got.ips } }));
    check('  ...keeps its date, and all a restore needs: key 2 only at epoch 1, its database id, the member found by email', !!got && Math.abs(fs.statSync(f).mtimeMs - mt) < 1 && JSON.stringify(Object.keys(got.census.refs)) === '["2"]' && !Object.keys(got.census.unreadable).length && got.census.epoch === 1 && got.dbId === metaOf('db_id') && got.email === 1, JSON.stringify(got && { mt: fs.statSync(f).mtimeMs - mt, refs: got.census.refs, epoch: got.census.epoch, id: got.dbId === metaOf('db_id'), email: got.email }));
  }
  check('the live database and every copy were compacted under key 2 (no old ciphertext left in their free space)', metaOf('scrubbed_kid') === '2' && [path.join(BK, 'app-2026-01-01.db'), path.join(EXTRA, 'dev.db')].every((f) => { const d = new DatabaseSync(f, { readOnly: true }); try { return K.getMeta(d, 'scrubbed_kid') === '2'; } finally { d.close(); } }));
  check('init marked the backups folder, and the database knows its marker', JSON.parse(fs.readFileSync(path.join(BK, '.jsi-backups'), 'utf8')).dbId === metaOf('backup_marker') && metaOf('backup_marker') === metaOf('db_id') && ringNow().ring.owner && ringNow().ring.owner.dbId === metaOf('db_id'));
  // the flows a member uses, on the new keys
  const login = await api('/api/auth/login', { method: 'POST', pass: freshPass(), body: { identifier: A.email, password: A.pw } });
  check('sign-in by email and password works after the rotation (the email index moved)', login.status === 200 && login.sid, login.status + ' ' + JSON.stringify(login.j));
  const nonce = await api('/api/auth/wallet/nonce?purpose=signin&address=' + W1a);
  const wsign = await api('/api/auth/wallet/verify', { method: 'POST', pass: freshPass(), body: { address: W1a, signature: await W1.signMessage(nonce.j.message) } });
  check('  ...and sign-in by wallet (the wallet index moved, and its challenge was issued under the new keys)', wsign.status === 200 && wsign.j && wsign.j.username === A.name, wsign.status + ' ' + JSON.stringify(wsign.j));
  const me = await api('/api/me', { sid: login.sid });
  check('  ...the member\'s private preferences read back', me.j && me.j.user && me.j.user.site_prefs && me.j.user.site_prefs.kr === 'site' && me.j.user.tracker_prefs.kr === 'tracker', JSON.stringify(me.j && me.j.user && me.j.user.site_prefs));
  const tc = await api('/api/tracker/cache?address=' + TRACKED, { sid: login.sid });
  const wl = await api('/api/wallets', { sid: login.sid });
  check('  ...the tracker finds its saved report and lists the tracked wallet', tc.j && tc.j.report && tc.j.report.report === 'kr' && JSON.stringify(wl.j || {}).includes(TRACKED), JSON.stringify(tc.j) + ' ' + wl.status);
  { const last = JSON.parse(metaOf('last_maintenance') || 'null');
    check('the re-keying pass was the only one: the tick that came while it ran queued no second pass to replace its report', !!bootPass && bootPass.why === 'boot' && !!last && last.at === bootPass.at && last.why === 'boot', JSON.stringify(last && { why: last.why, at: last.at, boot: bootPass && bootPass.at, files: last.files.map((f) => f.status), dropped: last.dropped })); }
  const snap1 = plainOf(k2);
  await stop();

  /* ── 2c. the admin page rotates the data key with the site up ── */
  s = await start({ ADMIN_USER_IDS: String(uid) });
  const lg = await api('/api/auth/login', { method: 'POST', pass: freshPass(), body: { identifier: A.email, password: A.pw } });
  const ov = await api('/api/admin/overview', { sid: lg.sid });
  const ks = ov.j && ov.j.storage && ov.j.storage.keys;
  check('the admin overview shows the keyring by ids and counts only', ks && ks.mode === 'keyring' && ks.currentKey === 2 && ks.indexEpoch === 1 && ks.droppedKeys === 1 && ks.escrow.configured && !JSON.stringify(ov.j).match(/[0-9a-f]{64}/), JSON.stringify(ks).slice(0, 300));
  await api('/api/auth/verify', { method: 'DELETE', sid: lg.sid });
  const nos = await api('/api/admin/keys/rotate', { method: 'POST', sid: lg.sid, body: { confirm: 'ROTATE', scope: 'data' } });
  check('rotating needs "confirm it\'s you" first', nos.status === 401 && nos.j && nos.j.code === 'need_verify', nos.status + ' ' + JSON.stringify(nos.j));
  await api('/api/auth/verify', { method: 'POST', sid: lg.sid, body: { password: A.pw } });
  const noc = await api('/api/admin/keys/rotate', { method: 'POST', sid: lg.sid, body: { scope: 'data' } });
  check('  ...and the word ROTATE', noc.status === 400);
  const other = await api('/api/admin/keys/rotate', { method: 'POST', body: { confirm: 'ROTATE' } });
  check('  ...and is not there at all for anyone who is not an admin', other.status === 404);
  t0 = Date.now();
  const rot = await api('/api/admin/keys/rotate', { method: 'POST', sid: lg.sid, body: { confirm: 'ROTATE', scope: 'data' } });
  check('the admin rotates the data key: key 3 current, the site never went down', rot.status === 200 && rot.j.keys.currentKey === 3 && !rot.j.restarting && (await api('/healthz')).status === 200, rot.status + ' ' + JSON.stringify(rot.j).slice(0, 300));
  m = await waitFor(() => { const x = JSON.parse(metaOf('last_maintenance') || 'null'); return x && x.at >= t0 && x.dropped && x.dropped.includes('data key 2') ? x : null; });
  ring = ringNow().ring;
  check('  ...key 2 is dropped once the live data and every backup are under key 3 (grace 0 here)', !!m && ring.dek.keys.map((k) => k.id).join() === '3', JSON.stringify(m && { d: m.dropped, w: m.waiting }));
  let k3 = keysNow(); k3.setEpoch(1);
  check('  ...every value reads the same under key 3', JSON.stringify(plainOf(k3)) === JSON.stringify(snap1) && JSON.stringify(Object.keys(kidsInDb())) === '["3"]');
  check('  ...and the backups followed', [path.join(BK, 'app-2026-01-01.db'), path.join(EXTRA, 'dev.db')].every((f) => JSON.stringify(Object.keys(kidsInDb(f))) === '["3"]'));

  /* ── 2d. the index key through a restart, as the weekly schedule does it ── */
  t0 = Date.now();
  const all = await api('/api/admin/keys/rotate', { method: 'POST', sid: lg.sid, body: { confirm: 'ROTATE', scope: 'all' } });
  check('rotating everything answers first, then restarts the server for the index key', all.status === 200 && all.j.restarting === true, all.status + ' ' + JSON.stringify(all.j).slice(0, 200));
  const exitCode = await Promise.race([proc.done, sleep(20000).then(() => 'timeout')]);
  check('  ...the server exits cleanly (launchd starts it again)', exitCode === 0, exitCode);
  proc = null;
  s = await start({ ADMIN_USER_IDS: String(uid) });
  check('  ...and on the way back up moves every index to epoch 2', s.up && /index key: epoch 1 → 2/.test(s.log), s.log.slice(-400));
  m = await waitFor(() => { const x = JSON.parse(metaOf('last_maintenance') || 'null'); return x && x.at >= t0 && x.dropped && x.dropped.includes('index epoch 1') ? x : null; });
  ring = ringNow().ring;
  let k4 = keysNow(); k4.setEpoch(2);
  check('  ...index epoch 1 is dropped once no file is at it; every seeded index matches at epoch 2', !!m && ring.idx.outer.map((o) => o.epoch).join() === '2' && expectIndexes(k4, 2, uid).length === 0, expectIndexes(k4, 2, uid).join(',') + ' ' + JSON.stringify(m && m.waiting));
  const lg2 = await api('/api/auth/login', { method: 'POST', pass: freshPass(), body: { identifier: A.email, password: A.pw } });
  check('  ...and the member signs in as before', lg2.status === 200);
  const snap2 = plainOf(k4);
  check('  ...with every value unchanged', JSON.stringify(snap2) === JSON.stringify(snap1));
  await stop();

  /* ── 2e. a crash at every step leaves a database that opens, and the next start finishes the job ── */
  for (const [at, scope, code] of [['ring-before-rename', 'all', 91], ['mid-flip', 'all', 93], ['mid-sweep', 'data', 92], ['file-before-rename', 'data', 94]]) {
    cli('request', ...(scope === 'all' ? ['--all'] : []));
    const crash = await start({ JSI_ROTATE_CRASH_AT: at });
    let c = crash.up ? await Promise.race([proc.done, sleep(30000).then(() => 'timeout')]) : crash.code;
    proc = null;
    const tBack = Date.now();
    const again = await start();
    // the pass after this start (not an older record): every file brought along, and every old key and epoch gone
    const back = await waitFor(() => { const x = JSON.parse(metaOf('last_maintenance') || 'null'); const r = ringNow().ring; return x && x.at >= tBack && !x.error && x.files.every((f) => f.status !== 'failed') && r.dek.keys.length === 1 && r.idx.outer.length === 1 ? x : null; });
    const kk = keysNow();
    const ep = Number(metaOf('idx_epoch'));
    kk.setEpoch(ep);
    const ok = again.up && JSON.stringify(plainOf(kk)) === JSON.stringify(snap2) && expectIndexes(kk, ep, uid).length === 0;
    if (process.env.KR_DEBUG) console.log('after ' + at + ': ' + JSON.stringify({ waiting: back && back.waiting, dropped: back && back.dropped, files: back && back.files.map((f) => f.file + ':' + f.status), ring: ringNow().ring.dek.keys.map((k) => k.id + ':' + k.retiredAt), outers: ringNow().ring.idx.outer.map((o) => o.epoch), grace: metaOf('drop_grace_ms') }));
    const lgx = await api('/api/auth/login', { method: 'POST', pass: freshPass(), body: { identifier: A.email, password: A.pw } });
    check('a crash ' + at.replace(/-/g, ' ') + ' (exit ' + c + '): the next start finishes the rotation — every value and index intact, sign-in works, old keys dropped', c === code && ok && lgx.status === 200 && !!back, JSON.stringify({ c, up: again.up, login: lgx.status, back: !!back, idx: expectIndexes(kk, ep, uid), ring: ringNow().ring.dek.keys.map((k) => k.id), outers: ringNow().ring.idx.outer.map((o) => o.epoch), m: JSON.parse(metaOf('last_maintenance') || 'null') && JSON.parse(metaOf('last_maintenance')).waiting }));
    await stop();
  }

  /* ── 2g. what the review found: a second server, an unmounted backups volume, unreadable leftovers, a foreign copy,
     a request that cannot be staged ── */
  {
    // a second server on a COPY of the database, reading the same keyring: decrypts, changes nothing
    const D2 = path.join(T, 'data2'), B2 = path.join(T, 'backups2');
    for (const x of [D2, path.join(D2, 'uploads'), B2]) fs.mkdirSync(x, { recursive: true, mode: 0o700 });
    { const d = openDb(); d.prepare('VACUUM INTO ?').run(path.join(D2, 'app.db')); d.close(); }
    const pass2 = () => { const d = new DatabaseSync(path.join(D2, 'app.db')); d.exec('PRAGMA busy_timeout = 5000'); const code = 'KRTEST' + randomBytes(4).toString('hex').toUpperCase(), tok = randomBytes(24).toString('hex'); d.prepare('INSERT INTO invite_codes (code, owner_id, created_at, used_at, pass, tos_at, tos_version) VALUES (?,NULL,?,?,?,?,?)').run(code, Date.now(), Date.now(), createHash('sha256').update(tok).digest('hex'), Date.now(), TOS_VERSION); d.close(); return 'jsi_pass=' + tok + '; jsi_age=18'; };
    cli('request');
    const ringBefore = fs.readFileSync(KEYFILE, 'utf8');
    const P2 = await freePort(), B2URL = 'http://localhost:' + P2;
    const p2 = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER_JS], { cwd: ROOT, env: { ...ENV, PORT: String(P2), JSI_DATA_DIR: D2, DATA_DIR: D2, BASE_URL: B2URL, BACKUP_DIR: B2, KEY_ROTATE_EXTRA_DBS: '', ADMIN_USER_IDS: String(uid) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log2 = ''; p2.stdout.on('data', (x) => { log2 += x; }); p2.stderr.on('data', (x) => { log2 += x; });
    let up2 = false; for (let i = 0; i < 150 && !up2; i++) { try { up2 = (await fetch(B2URL + '/healthz')).ok; } catch {} if (!up2) await sleep(100); }
    await sleep(2500);   // a few ticks
    const post2 = (p, body, pass) => fetch(B2URL + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B2URL, Cookie: pass }, body: JSON.stringify(body) });
    const l2 = await post2('/api/auth/login', { identifier: A.email, password: A.pw }, pass2());
    check('a second server on a copy of the database reads with the keyring but is READ ONLY: it signs members in, takes no request and writes nothing to the ring', up2 && /READ ONLY: another database owns this keyring/.test(log2) && l2.status === 200 && fs.existsSync(path.join(KV, 'rotate-request.json')) && fs.readFileSync(KEYFILE, 'utf8') === ringBefore, (up2 ? 'up' : 'down') + ' ' + l2.status + ' ' + log2.slice(-300));
    // now the owner runs beside it and takes the request: the read-only server follows, so what it writes stays readable
    const c0 = ringNow().ring.dek.current;
    await start();
    const moved = await waitFor(() => ringNow().ring.dek.current === c0 + 1 && !fs.existsSync(path.join(KV, 'rotate-request.json')), 15000);
    await sleep(2500);
    const em2 = 'kr2' + randomBytes(3).toString('hex') + '@example.com';
    const r2 = await post2('/api/auth/register', { username: '__kr_b_' + randomBytes(3).toString('hex'), email: em2, password: 'second-server-' + randomBytes(3).toString('hex') }, pass2());
    const enc2 = (() => { const d = new DatabaseSync(path.join(D2, 'app.db'), { readOnly: true }); try { return (d.prepare("SELECT identifier_enc v FROM identities ORDER BY id DESC LIMIT 1").get() || {}).v || ''; } finally { d.close(); } })();
    check('  ...the owner takes the request, and the read-only server writes under the owner\'s NEW key from then on', !!moved && r2.status === 200 && enc2.startsWith('v2:' + (c0 + 1) + ':'), JSON.stringify({ moved: !!moved, reg: r2.status, prefix: enc2.slice(0, 8) }));
    p2.kill('SIGTERM'); await new Promise((r) => p2.on('exit', r));
    await maintenanceAfter(Date.now() - 2000);
    await stop();
    fs.rmSync(D2, { recursive: true, force: true }); fs.rmSync(B2, { recursive: true, force: true });

    // the backups volume is not mounted (its mount point re-created as an empty folder): nothing is dropped
    fs.renameSync(BK, BK + '.away');
    cli('request');
    let t1 = Date.now();
    await start();
    m = await maintenanceAfter(t1);
    ring = ringNow().ring;
    check('with the backups volume unmounted, a rotation runs but no old key is dropped (the place cannot be checked)', m && ring.dek.keys.length === 2 && m.dropped.length === 0 && (m.blocked || []).some((b) => /marker is missing/.test(b.why)) && m.waiting.some((w) => /could not be listed/.test(w)), JSON.stringify(m && { b: m.blocked, w: m.waiting, d: m.dropped }));
    check('  ...and the daily snapshot is not written into the empty stand-in folder', !fs.readdirSync(BK).some((n) => /^app-.*\.db$/.test(n)));
    await stop();
    for (const n of fs.existsSync(path.join(BK, 'keyring-escrow')) ? fs.readdirSync(path.join(BK, 'keyring-escrow')) : []) fs.renameSync(path.join(BK, 'keyring-escrow', n), path.join(BK + '.away', 'keyring-escrow', n));
    fs.rmSync(BK, { recursive: true, force: true }); fs.renameSync(BK + '.away', BK);
    t1 = Date.now();
    await start();
    m = await waitFor(() => { const x = JSON.parse(metaOf('last_maintenance') || 'null'); return x && x.at >= t1 && x.dropped && x.dropped.length ? x : null; }, MAINT_WAIT);   // re-encrypting the backup copies first
    ring = ringNow().ring;
    check('  ...once it is back, the copies are brought along and the old key goes', !!m && ring.dek.keys.length === 1 && JSON.stringify(Object.keys(kidsInDb(path.join(BK, 'app-2026-01-01.db')))) === JSON.stringify([String(ring.dek.current)]), JSON.stringify(m && { w: m.waiting, d: m.dropped }));
    await stop();

    // values no key opens: one under the current key, one under a key already dropped; and a copy from another keyring
    const cur = ringNow().ring.dek.current, junk = randomBytes(40).toString('base64');
    { const d = openDb(); fill(d, 'tracker_cache', { user_id: uid, addr_idx: 'a'.repeat(64), report: 'v2:' + cur + ':' + junk, updated_at: 1 }); d.close(); }
    const beforeDrop = path.join(T, 'before-drop.db'); { const d = openDb(); d.prepare('VACUUM INTO ?').run(beforeDrop); d.close(); }
    // copies in a subfolder and an archive in the backups: the first is brought along, the second holds every drop until it goes
    fs.mkdirSync(path.join(BK, 'moved-earlier')); fs.copyFileSync(beforeDrop, path.join(BK, 'moved-earlier', 'app-old.sqlite'));
    fs.writeFileSync(path.join(BK, 'export.db.gz'), randomBytes(64));
    const foreignF = path.join(BK, 'foreign-copy.db');
    { const other = K.Keys.legacy(randomBytes(32)), d = new DatabaseSync(foreignF); d.exec('CREATE TABLE identities (id INTEGER PRIMARY KEY, type TEXT, identifier TEXT, identifier_enc TEXT)'); d.prepare('INSERT INTO identities (type, identifier, identifier_enc) VALUES (?,?,?)').run('email', other.bidx('x@y.z'), other.encField('x@y.z')); d.close(); }
    const foreignSha = createHash('sha256').update(fs.readFileSync(foreignF)).digest('hex');
    t1 = Date.now();
    s = await start();
    check('a value no key opens does not stop the site from starting (it is warned about)', s.up && /some stored values cannot be read|values under keys already dropped/.test(s.log), s.up + ' ' + s.log.slice(-300));
    cli('request');
    m = await waitFor(() => { const x = JSON.parse(metaOf('last_maintenance') || 'null'); return x && x.at >= t1 && x.why === 'rotation' ? x : null; }, MAINT_WAIT);
    check('a database copy in a subfolder of the backups, named .sqlite, is found by its header and brought along', !!m && m.files.some((f) => /moved-earlier\/app-old\.sqlite$/.test(f.file) && f.status === 'rekeyed'), JSON.stringify(m && m.files.map((f) => f.file + ':' + f.status)) + ' on disk: ' + JSON.stringify(fs.readdirSync(path.join(BK, 'moved-earlier'))));
    check('  ...an archive in the backups that may hold a database holds back every drop until it is dealt with', !!m && m.dropped.length === 0 && (m.blocked || []).some((b) => /export\.db\.gz/.test(b.path)) && ringNow().ring.dek.keys.length === 2, JSON.stringify(m && { b: m.blocked, d: m.dropped }));
    fs.unlinkSync(path.join(BK, 'export.db.gz'));
    await stop(); t1 = Date.now(); await start();
    m = await waitFor(() => { const x = JSON.parse(metaOf('last_maintenance') || 'null'); return x && x.at >= t1 && x.dropped && x.dropped.length ? x : null; }, MAINT_WAIT);
    ring = ringNow().ring;
    const ff = m && m.files.find((f) => /foreign-copy/.test(f.file));
    check('  ...unreadable values hold no key back: the rotation drops the old key anyway, the leftover is counted and the ring records it', !!m && ring.dek.keys.length === 1 && (m.live.unreadableCols || {})['tracker_cache.report'] === 1 && ring.dek.dropped.find((x) => x.id === cur).left === 1, JSON.stringify(m && { w: m.waiting, d: m.dropped, u: m.live && m.live.unreadableCols }));
    check('  ...a copy made under another keyring is left byte for byte and holds nothing back', ff && ff.status === 'foreign' && createHash('sha256').update(fs.readFileSync(foreignF)).digest('hex') === foreignSha, JSON.stringify(ff));
    await stop();
    s = await start();
    check('  ...and the site starts again with the leftover under the dropped key', s.up, s.log.slice(-300));
    await stop();
    // a copy from before the drop, restored over the database: refused, with where to find its keyring
    fs.renameSync(path.join(DATA, 'app.db'), path.join(T, 'current.db'));
    for (const x of ['-wal', '-shm']) { try { fs.unlinkSync(path.join(DATA, 'app.db' + x)); } catch {} }
    fs.copyFileSync(beforeDrop, path.join(DATA, 'app.db'));
    s = await start();
    if (s.up) await stop();
    check('a copy from before a key was dropped, restored over the database, is refused rather than served unreadable (it needs the keyring of its day)', !s.up && s.code === 1 && /It is a copy from before that/.test(s.log), (s.up ? 'STARTED' : 'exit ' + s.code) + ' ' + s.log.slice(-300).replace(/\s+/g, ' '));
    for (const x of ['', '-wal', '-shm']) { try { fs.unlinkSync(path.join(DATA, 'app.db' + x)); } catch {} }
    fs.renameSync(path.join(T, 'current.db'), path.join(DATA, 'app.db'));
    fs.rmSync(path.join(BK, 'moved-earlier'), { recursive: true, force: true });
    { const d = openDb(); d.prepare("DELETE FROM tracker_cache WHERE addr_idx = ?").run('a'.repeat(64)); d.close(); }
    fs.unlinkSync(foreignF);

    // a reader holding the database open (a terminal running sqlite3, say) holds up the checkpoint: no drop until it is clean
    {
      const reader = openDb(); reader.exec('BEGIN'); reader.prepare('SELECT COUNT(*) n FROM users').get();
      cli('request'); t1 = Date.now(); await start();
      m = await maintenanceAfter(t1);
      check('while a reader holds up the checkpoint, the database does not count as compacted and no old key is dropped', !!m && m.dropped.length === 0 && m.waiting.some((w) => /not yet compacted/.test(w)) && ringNow().ring.dek.keys.length === 2, JSON.stringify(m && { w: m.waiting, d: m.dropped }));
      reader.exec('COMMIT'); reader.close();
      await stop(); t1 = Date.now(); await start();
      m = await waitFor(() => { const x = JSON.parse(metaOf('last_maintenance') || 'null'); return x && x.at >= t1 && x.dropped && x.dropped.length ? x : null; }, MAINT_WAIT);
      check('  ...and once it lets go, the next pass compacts and drops', !!m && ringNow().ring.dek.keys.length === 1);
      await stop();
    }
    // copies the walk must find or flag: a hidden folder, a folder left at mode 600, a link, an orphan log, a stale work copy
    {
      const copy = (to) => { const d = openDb(); d.prepare('VACUUM INTO ?').run(to); d.close(); };
      fs.mkdirSync(path.join(BK, '.hidden')); copy(path.join(BK, '.hidden', 'old.db'));
      fs.mkdirSync(path.join(BK, 'sub600')); copy(path.join(BK, 'sub600', 'old.db')); fs.chmodSync(path.join(BK, 'sub600'), 0o600);
      fs.symlinkSync(path.join(BK, 'app-2026-01-01.db'), path.join(BK, 'link.db'));
      fs.writeFileSync(path.join(BK, 'ghost.db-wal'), randomBytes(4096));
      fs.mkdirSync(path.join(BK, '.rekey'), { recursive: true }); fs.writeFileSync(path.join(BK, '.rekey', 'gone.db.work'), randomBytes(64));
      cli('request'); t1 = Date.now(); await start();
      m = await maintenanceAfter(t1);
      const names = m ? m.files.map((f) => f.file + ':' + f.status) : [];
      check('a copy in a hidden folder, and one in a folder an older version left at mode 600 (repaired to 700), are brought along', names.includes('.hidden/old.db:rekeyed') && names.includes('sub600/old.db:rekeyed') && (fs.statSync(path.join(BK, 'sub600')).mode & 0o777) === 0o700, JSON.stringify(names));
      check('  ...a symbolic link and a write-ahead log with no database beside it hold back every drop', !!m && m.dropped.length === 0 && m.blocked.some((b) => /link\.db/.test(b.path) && /symbolic link/.test(b.why)) && m.blocked.some((b) => /ghost\.db-wal/.test(b.path)), JSON.stringify(m && m.blocked));
      check('  ...and a work copy left by an interrupted rewrite is cleared', !fs.existsSync(path.join(BK, '.rekey', 'gone.db.work')));
      await stop();
      fs.unlinkSync(path.join(BK, 'link.db')); fs.unlinkSync(path.join(BK, 'ghost.db-wal'));
      t1 = Date.now(); await start();
      m = await waitFor(() => { const x = JSON.parse(metaOf('last_maintenance') || 'null'); return x && x.at >= t1 && x.dropped && x.dropped.length ? x : null; }, MAINT_WAIT);
      check('  ...once they are gone, the old key goes', !!m && ringNow().ring.dek.keys.length === 1);
      await stop();
      fs.rmSync(path.join(BK, '.hidden'), { recursive: true, force: true }); fs.rmSync(path.join(BK, 'sub600'), { recursive: true, force: true });
    }
    // a request the server cannot stage (the key volume read-only) stays, and is taken once it can be
    cli('request');
    fs.chmodSync(KV, 0o500);
    const curBefore = ringNow().ring.dek.current;
    s = await start();
    await sleep(2500);
    const stillThere = fs.existsSync(path.join(KV, 'rotate-request.json')), sameKey = ringNow().ring.dek.current === curBefore;
    fs.chmodSync(KV, 0o700);
    const taken = await waitFor(() => !fs.existsSync(path.join(KV, 'rotate-request.json')) && ringNow().ring.dek.current === curBefore + 1, 15000);
    check('a request the server cannot stage is kept (not silently lost), and taken once the ring can be written', stillThere && sameKey && !!taken, JSON.stringify({ stillThere, sameKey, taken: !!taken }));
    await maintenanceAfter(Date.now() - 1000);
    await stop();
  }

  /* ── 2f. the refusals ── */
  const ringTxt = fs.readFileSync(KEYFILE, 'utf8'), live = ringNow().ring, liveEpoch = Number(metaOf('idx_epoch'));
  console.log('ring before the probes: data keys ' + live.dek.keys.map((k) => k.id + (k.id === live.dek.current ? '*' : '')).join(',') + ' · epochs ' + live.idx.outer.map((o) => o.epoch).join(',') + ' · db epoch ' + liveEpoch + ' · db kids ' + JSON.stringify(kidsInDb()));
  const tryRing = async (r, label, re) => {
    const f = path.join(KV, 'probe_key'); fs.writeFileSync(f, typeof r === 'string' ? r : JSON.stringify(K.sealRing(r)), { mode: 0o600 });
    const x = await start({ DATA_KEY_FILE: f });
    if (x.up) await stop();
    check(label, !x.up && x.code === 1 && re.test(x.log), (x.up ? 'STARTED' : 'exit ' + x.code) + ' ' + x.log.slice(-300).replace(/\s+/g, ' '));
    fs.unlinkSync(f);
  };
  await tryRing(K1.toString('hex') + '\n', 'the stolen single key cannot start the site: this database was rotated to a keyring', /single key, and this database was rotated/);
  { const r = JSON.parse(JSON.stringify(live)); r.dek.keys.find((k) => k.id === r.dek.current).hex = randomBytes(32).toString('hex'); await tryRing(r, 'a keyring whose current key is wrong cannot start it (none of the sampled values open)', /opens none of/); }
  { const r = JSON.parse(JSON.stringify(live)); r.idx.outer.find((o) => o.epoch === liveEpoch).hex = randomBytes(32).toString('hex'); await tryRing(r, 'a keyring with the wrong index key cannot start it (sign-in would find nobody)', /index key does not match/); }
  { const r = JSON.parse(JSON.stringify(live)); r.idx.outer = []; await tryRing(r, 'a keyring without this database\'s index epoch cannot start it', /no index key for that epoch/); }
  { const r = JSON.parse(JSON.stringify(live)); const id = r.dek.current; r.dek.keys.find((k) => k.id === id).id = id + 5; r.dek.current = id + 5; r.dek.nextId = id + 6; await tryRing(r, 'a keyring missing a key the data names cannot start it', /keys the keyring does not hold/); }
  { const x = await start({ DATA_KEY: K1.toString('hex') }); if (x.up) await stop(); check('DATA_KEY in the environment beside a keyring is refused', !x.up && /AND DATA_KEY_FILE holds a keyring/.test(x.log)); }
  check('the real keyring was never touched by the probes', fs.readFileSync(KEYFILE, 'utf8') === ringTxt);
  // the code from before keyrings refuses the ring rather than misreading it (the rollback fence)
  let oldSrc = null; try { oldSrc = execFileSync('git', ['show', 'a5c6cef:server.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
  if (oldSrc) {
    const od = path.join(T, 'old'); fs.mkdirSync(od); fs.writeFileSync(path.join(od, 'server.js'), oldSrc);
    const r = await new Promise((res) => { const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(od, 'server.js')], { cwd: od, env: { ...ENV, NODE_PATH: path.join(ROOT, 'node_modules') }, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { o += d; }); p.on('exit', (c) => res({ c, o })); setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 20000); });
    check('code from before keyrings (a5c6cef) refuses to start on the keyring instead of misreading it', r.c === 1 && /DATA_KEY_FILE/.test(r.o), r.c + ' ' + r.o.slice(-200));
  } else console.log('note: a5c6cef is not in this checkout (a shallow clone) — the rollback-fence check did not run');
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  await stop().catch(() => {});
  try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
}
let pass = 0;
for (const [n, ok, extra] of results) { if (ok) pass++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); }
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
