#!/usr/bin/env node
/* ===== scripts/keys.mjs — the keyring, from a terminal =================================================
 * Run it from the site's folder (it reads the same .env as the server). It never prints a key: keys are named by id
 * and an 8-character fingerprint. The one exception is `escrow-init`, which prints the escrow RECOVERY key once —
 * run that one in your own terminal (not through an assistant or a logged session) and keep what it prints off this
 * computer.
 *
 *   node scripts/keys.mjs status                 what the keyring holds, the database's index epoch, escrow
 *   node scripts/keys.mjs init                   convert DATA_KEY_FILE from one hex key to a keyring owned by this site's
 *                                                database (server stopped)
 *   node scripts/keys.mjs claim                  make this site's database the keyring's owner — the only one that rotates it
 *                                                (after moving the site to another folder, or restoring a backup there)
 *   node scripts/keys.mjs escrow-init            make the escrow key pair: public half beside the ring, private half printed once
 *   node scripts/keys.mjs request [--all] [--compromised]
 *                                                ask the server to rotate: the data key (default), or everything (--all,
 *                                                restarts it); --compromised also drops old keys as soon as nothing needs them.
 *                                                Taken at the next start, or within five minutes by a running server.
 *   node scripts/keys.mjs census FILE…           which keys and index epoch the values in a database file need
 *   node scripts/keys.mjs escrow-open FILE OUT   open a sealed escrow copy with the recovery key (asked for, not echoed)
 *                                                and write the keyring it holds to OUT (mode 600)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const K = require(path.join(ROOT, 'lib', 'keys.js'));
const { DatabaseSync } = require('node:sqlite');

// the server's own .env rules: real environment variables win; `KEY=value  # note` drops the note
try {
  for (let line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    line = line.trim(); if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('='); if (eq === -1) continue;
    const key = line.slice(0, eq).trim(); let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1); else val = val.replace(/\s+#.*$/, '').trim();
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
} catch {}
const DATA_DIR = process.env.JSI_DATA_DIR || path.join(ROOT, 'data');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const RING = process.env.DATA_KEY_FILE ? path.resolve(process.env.DATA_KEY_FILE) : null;
const PORT = process.env.PORT || 8642;
const [cmd, ...rest] = process.argv.slice(2);
const die = (m) => { console.error('✗ ' + m); process.exit(1); };
const when = (t) => t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';
const ago = (t) => { if (!t) return ''; const h = (Date.now() - t) / 3600e3; return h < 48 ? ' (' + h.toFixed(1) + ' h ago)' : ' (' + (h / 24).toFixed(1) + ' days ago)'; };
async function serverUp() { try { const r = await fetch('http://127.0.0.1:' + PORT + '/healthz', { signal: AbortSignal.timeout(1500) }); return r.status > 0; } catch { return false; } }
function needRing() {
  if (!RING) die('DATA_KEY_FILE is not set (in .env or the environment). The keyring lives at that path.');
  let kf; try { kf = K.readKeyFile(RING); } catch (e) { die(e.message); }
  return kf;
}
function dbInfo(file) {
  try {
    const d = new DatabaseSync(file, { readOnly: true });
    try { return { epoch: K.columns(d, 'key_meta').size ? K.dbEpoch(d) : 0, census: K.prefixCensus(d), meta: K.columns(d, 'key_meta').size ? Object.fromEntries(d.prepare('SELECT k, v FROM key_meta').all().map((r) => [r.k, r.v])) : {} }; }
    finally { d.close(); }
  } catch (e) { return { error: e.message }; }
}
/* BACKUP_DIR set and present: mark it as THE backups folder for this database, so the server can tell an unmounted
   volume (whose path may be re-created as an empty folder) from the real one — it then holds back every key drop. */
function markBackups(dbFile, dbId) {
  if (!process.env.BACKUP_DIR) return;
  if (!fs.existsSync(BACKUP_DIR)) die('BACKUP_DIR ' + BACKUP_DIR + ' does not exist — mount the backups volume first.');
  K.writeBackupMarker(BACKUP_DIR, dbId);
  const d = new DatabaseSync(dbFile); try { K.setMeta(d, 'backup_marker', dbId); } finally { d.close(); }
  console.log('  marked ' + BACKUP_DIR + ' as this site\'s backups folder (' + K.BACKUP_MARKER + ')');
}
async function readSecret(prompt) {
  process.stderr.write(prompt);
  if (!process.stdin.isTTY) { let s = ''; for await (const c of process.stdin) s += c; return s.trim(); }
  return new Promise((resolve) => {
    let s = ''; process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const on = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', on); process.stderr.write('\n'); resolve(s.trim()); }
      else if (ch === '\u0003') { process.stderr.write('\n'); process.exit(130); }
      else if (ch === '\u007f') s = s.slice(0, -1);
      else s += ch;
    };
    process.stdin.on('data', on);
  });
}

if (cmd === 'status') {
  const kf = needRing();
  if (kf.kind === 'hex') console.log('DATA_KEY_FILE holds a single key (fingerprint ' + K.fingerprint(kf.key) + '). Nothing rotates until `init`.');
  else {
    const r = kf.ring;
    console.log('Keyring ' + RING + ' — generation ' + r.generation + ', written ' + when(r.writtenAt) + ago(r.writtenAt));
    for (const k of r.dek.keys) console.log('  data key ' + k.id + (k.id === r.dek.current ? ' (current)' : ' (retired ' + when(k.retiredAt) + ')') + ' — added ' + when(k.added) + ago(k.added) + ', fingerprint ' + K.fingerprint(Buffer.from(k.hex, 'hex')));
    if (r.dek.dropped.length) console.log('  dropped data keys: ' + r.dek.dropped.map((d) => d.id + ' (' + when(d.at) + ')').join(', '));
    const live = dbInfo(path.join(DATA_DIR, 'app.db'));
    console.log('  owner: ' + (r.owner ? r.owner.dataDir + (K.ringOwnerMatches(r, live.meta && live.meta.db_id, DATA_DIR) ? ' — this site\'s database (it rotates)' : ' — NOT this site\'s database (' + DATA_DIR + ' only reads with it)') : 'none — run `claim` (server stopped), or nothing rotates'));
    console.log('  index keys held for epochs: 0' + r.idx.outer.map((o) => ', ' + o.epoch).join('') + (r.idx.dropped.length ? ' · dropped: ' + r.idx.dropped.map((d) => d.epoch).join(', ') : ''));
  }
  const pub = RING && K.readEscrowPub(RING);
  console.log('Escrow: ' + (pub ? 'set up — sealed copies in ' + path.join(BACKUP_DIR, 'keyring-escrow') + ' (last ' + when(K.lastEscrowAt(path.join(BACKUP_DIR, 'keyring-escrow'))) + ')' : 'NOT set up (escrow-init). Without it the keyring is the only copy of the key.'));
  if (RING && fs.existsSync(K.ringSiblings(RING).request)) console.log('A rotate request is waiting: ' + fs.readFileSync(K.ringSiblings(RING).request, 'utf8').trim());
  const live = dbInfo(path.join(DATA_DIR, 'app.db'));
  if (live.error) console.log('Database: could not read (' + live.error + ')');
  else console.log('Database ' + path.join(DATA_DIR, 'app.db') + ': index epoch ' + live.epoch + ' · values by data key ' + JSON.stringify(live.census.kids) + (live.meta.dek_rotated_at ? ' · data key rotated ' + when(Number(live.meta.dek_rotated_at)) : '') + (live.meta.idx_rotated_at ? ' · index rotated ' + when(Number(live.meta.idx_rotated_at)) : ''));
  console.log('Server on :' + PORT + ': ' + ((await serverUp()) ? 'running' : 'not answering'));
} else if (cmd === 'init') {
  const kf = needRing();
  if (kf.kind === 'ring') die(RING + ' is already a keyring.');
  if (await serverUp()) die('the server is answering on :' + PORT + ' — stop it first (launchctl bootout gui/$(id -u)/com.justsendit.server), then run init, then start it.');
  const live = dbInfo(path.join(DATA_DIR, 'app.db'));
  if (!live.error && live.census.kids && Object.keys(live.census.kids).some((k) => k !== '1')) die('the database already holds values under rotated keys — this key file is not the one it was rotated with.');
  const dbFile = path.join(DATA_DIR, 'app.db');
  if (!fs.existsSync(dbFile)) die('no database at ' + dbFile + ' — run init from the site\'s own folder (it reads the same .env as the server).');
  const d = new DatabaseSync(dbFile); let dbId;
  try { dbId = K.ensureDbId(d); } finally { d.close(); }
  const fresh = K.newRingFromLegacy(kf.key); fresh.owner = { dbId, dataDir: fs.realpathSync(DATA_DIR) };
  markBackups(dbFile, dbId);
  const ring = K.writeRing(RING, fresh, { escrowDir: path.join(BACKUP_DIR, 'keyring-escrow') });
  console.log('✓ ' + RING + ' is now a keyring (data key 1 = the old key, fingerprint ' + K.fingerprint(kf.key) + '; index epoch 0). Generation ' + ring.generation + '.');
  console.log('  The previous file is kept beside it as keyring.prev.json until the first key is dropped.');
  console.log('  Owner: the database in ' + ring.owner.dataDir + ' — the only one that rotates this ring. Any other server reading it only decrypts.');
  console.log('  Code from before keyrings refuses to start on this file — that is deliberate (it would misread rotated values).');
} else if (cmd === 'claim') {
  const kf = needRing();
  if (kf.kind !== 'ring') die('DATA_KEY_FILE holds a single key — `init` makes it a keyring (and owns it).');
  if (await serverUp()) die('the server is answering on :' + PORT + ' — stop it first, then claim, then start it.');
  const dbFile = path.join(DATA_DIR, 'app.db');
  if (!fs.existsSync(dbFile)) die('no database at ' + dbFile);
  const d = new DatabaseSync(dbFile); let dbId;
  try { dbId = K.ensureDbId(d); } finally { d.close(); }
  const r = JSON.parse(JSON.stringify(kf.ring)), before = r.owner ? r.owner.dataDir : 'none';
  r.owner = { dbId, dataDir: fs.realpathSync(DATA_DIR) };
  markBackups(dbFile, dbId);
  K.writeRing(RING, r, { escrowDir: path.join(BACKUP_DIR, 'keyring-escrow') });
  console.log('✓ owner: ' + before + ' → ' + r.owner.dataDir + '. Only a server on this database rotates the keyring now; make sure no server still runs on the old one.');
} else if (cmd === 'escrow-init') {
  needRing();
  const sib = K.ringSiblings(RING);
  if (fs.existsSync(sib.escrowPub) && !rest.includes('--replace')) die('an escrow key is already set up (' + sib.escrowPub + '). --replace makes a new pair; copies sealed to the old one still need the old recovery key.');
  const e = K.escrowKeygen();
  /* In this order, so a failure leaves escrow NOT set up rather than set up with no private half: seal the ring as it is
     now with the new public key (and check it opens), print the recovery key, and only then install the public key. */
  const kf = K.readKeyFile(RING);
  const json = kf.kind === 'ring' ? JSON.stringify(kf.ring, null, 1) + '\n' : null;
  if (json) {
    const sealed = K.escrowWrite(path.join(BACKUP_DIR, 'keyring-escrow'), e.pub, json, kf.ring.generation);
    if (K.escrowOpen(e.priv, fs.readFileSync(sealed)).toString('utf8') !== json) die('the sealed copy did not open again — escrow is NOT set up');
  }
  console.log('\nESCROW RECOVERY KEY — shown once, never stored on this computer:\n\n  ' + e.priv + '\n');
  K.writeFileDurable(sib.escrowPub, e.pub + '\n', 0o600);
  console.log('Keep it OFF this Mac: a password manager, or on paper somewhere safe. With it, `escrow-open` opens any sealed');
  console.log('copy of the keyring in ' + path.join(BACKUP_DIR, 'keyring-escrow') + ' — copy those (and the backups) off this Mac too.');
  console.log('Every keyring change from now on is sealed there automatically.');
} else if (cmd === 'request') {
  const kf = needRing();
  if (kf.kind !== 'ring') die('DATA_KEY_FILE holds a single key: a server on it never reads requests. Run `init` first (server stopped).');
  if (!K.readEscrowPub(RING) && process.env.KEY_ROTATE_WITHOUT_ESCROW !== '1') die('no escrow key is set up and KEY_ROTATE_WITHOUT_ESCROW is not 1, so the server would refuse this request. Run escrow-init first (or set KEY_ROTATE_WITHOUT_ESCROW=1 in .env).');
  const live = dbInfo(path.join(DATA_DIR, 'app.db'));
  if (!K.ringOwnerMatches(kf.ring, live.meta && live.meta.db_id, DATA_DIR)) die('this site\'s database (' + DATA_DIR + ') does not own the keyring' + (kf.ring.owner ? ' (' + kf.ring.owner.dataDir + ' does)' : '') + ', so its server would not take the request. `claim` (server stopped) if this is the site now.');
  const req = { scope: rest.includes('--all') || rest.includes('--compromised') ? 'all' : 'data', compromised: rest.includes('--compromised'), at: Date.now() };
  K.writeFileDurable(K.ringSiblings(RING).request, JSON.stringify(req) + '\n', 0o600);
  console.log('✓ requested: ' + (req.scope === 'all' ? 'a new data key AND a new index epoch (the server restarts for the index)' : 'a new data key') + (req.compromised ? ', old keys dropped as soon as nothing needs them' : '') + '.');
  console.log((await serverUp()) ? '  The running server takes it within five minutes.' : '  The server takes it when it starts.');
  console.log('  `node scripts/keys.mjs status` shows whether it was taken (the request file is gone once it is).');
} else if (cmd === 'census') {
  if (!rest.length) die('name one or more database files');
  const kf = needRing();
  const keys = kf.kind === 'ring' ? K.Keys.fromRing(kf.ring) : K.Keys.legacy(kf.key);
  for (const f of rest) {
    try {
      const d = new DatabaseSync(f, { readOnly: true });
      try { const c = K.trialCensus(d, keys); console.log(f + ': index epoch ' + c.epoch + ' · opens: ' + JSON.stringify(c.refs) + ' · no key opens: ' + JSON.stringify(c.unreadable)); } finally { d.close(); }
    } catch (e) { console.log(f + ': ' + e.message); }
  }
} else if (cmd === 'escrow-open') {
  const [file, out] = rest;
  if (!file || !out) die('usage: escrow-open SEALED_FILE OUT_FILE');
  if (fs.existsSync(out)) die(out + ' exists — choose a new path');
  const priv = await readSecret('Recovery key (not shown): ');
  let json; try { json = K.escrowOpen(priv, fs.readFileSync(file)).toString('utf8'); } catch (e) { die('could not open it: ' + e.message); }
  const ring = K.validateRing(JSON.parse(json));
  K.writeFileDurable(path.resolve(out), json, 0o600);
  console.log('✓ wrote the keyring from generation ' + ring.generation + ' (' + when(ring.writtenAt) + ') to ' + out + ' — data keys ' + ring.dek.keys.map((k) => k.id).join(', ') + ', index epochs 0' + ring.idx.outer.map((o) => ', ' + o.epoch).join('') + '.');
  console.log('  To use it: stop the server, put it at DATA_KEY_FILE, start the server.');
} else {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^ \*\/?/, '')).join('\n'));
  process.exit(cmd ? 1 : 0);
}
