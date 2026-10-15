'use strict';
/* ===== The encryption keys: keyring, ciphers, blind indexes and rotation ==================================
   Personal data is stored AES-256-GCM-encrypted and looked up through HMAC "blind indexes". This module owns
   every key that does that, so the server, scripts/keys.mjs and the tests all use the same code.

   TWO MODES
     legacy  one 64-hex key (DATA_KEY, a DATA_KEY_FILE holding only that, or data/.data_key). Byte-for-byte what
             the server always wrote: 'v1:' fields, 0x01 blobs, bidx = HMAC(HMAC(key,'blind-index'), s). No rotation.
     ring    DATA_KEY_FILE holds a JSON keyring (scripts/keys.mjs init converts the hex file in place). Keys rotate.

   WHAT ROTATES
     · Data keys (kid 1, 2, 3 …). New values are 'v2:<kid>:'+b64(iv|tag|ct) with AAD 'v2:<kid>:' and blobs
       0x02|kid(u32be)|iv|tag|ct with the 5-byte header as AAD; kid 1 keeps the v1 forms. Rotation adds a key, makes it
       current, re-encrypts every value (the live database and every backup file), and only then drops the old key.
     · The index key, by EPOCH. bidx_e(s) = AES-256-ECB_{outer_e}(HMAC(inner, s)): a permutation of the 32-byte HMAC
       under that epoch's outer key (epoch 0 has no outer layer and equals the legacy bidx). Because it is invertible,
       a stored index moves from epoch e to e+1 WITHOUT knowing what it indexes — which is what keeps the indexes of
       IP addresses, unlinked wallets and award markers working across a rotation. inner = HMAC(K1,'blind-index'),
       stored already derived, so K1 itself can be dropped.

   WHAT IT NEVER DOES
     · print or log key bytes (a short fingerprint names a key);
     · overwrite a value it could not open (counted, left as it is, and it blocks dropping that key);
     · drop a key while any value in the live database or in any backup file still needs it. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

const HEX64 = /^[0-9a-f]{64}$/i;
const IDX_HEX = /^[0-9a-f]{64}$/;          // a stored index: lowercase hex, as digest('hex') writes it
const RING_FORMAT = 'jsi-keyring', RING_VERSION = 1;
const ESCROW_MAGIC = 'JSIE1';
const toBuf = (b) => Buffer.isBuffer(b) ? b : Buffer.from(b.buffer, b.byteOffset, b.byteLength);   // node:sqlite hands BLOBs back as Uint8Array
const hmacHex = (key, s) => crypto.createHmac('sha256', key).update(String(s == null ? '' : s)).digest('hex');
function ecbHex(key, hex, encrypt) {
  const c = encrypt ? crypto.createCipheriv('aes-256-ecb', key, null) : crypto.createDecipheriv('aes-256-ecb', key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(Buffer.from(hex, 'hex')), c.final()]).toString('hex');
}
const fingerprint = (keyBuf) => crypto.createHash('sha256').update('jsi-key-fingerprint:').update(keyBuf).digest('hex').slice(0, 8);

/* ---------- value formats ---------- */
// 1 for 'v1:', n for 'v2:<n>:', 0 for a value that claims to be v2 but carries no usable key id, null for anything else (plaintext)
function fieldKid(s) {
  if (typeof s !== 'string') return null;
  if (s.startsWith('v1:')) return 1;
  if (s.startsWith('v2:')) { const m = /^v2:([1-9]\d{0,8}):/.exec(s); return m ? Number(m[1]) : 0; }
  return null;
}
const isCipher = (s) => fieldKid(s) !== null;
// the same for blobs: null = too short to be one, 0 = an unknown version byte or a truncated header
function blobKid(buf) {
  if (!buf || buf.length < 29) return null;
  const b = toBuf(buf);
  if (b[0] === 1) return 1;
  if (b[0] === 2) return b.length >= 33 ? (b.readUInt32BE(1) || 0) : 0;
  return 0;
}

/* ---------- the keys in memory ---------- */
class Keys {
  constructor() { this.mode = 'legacy'; this.byId = new Map(); this.outers = new Map(); this.current = 1; this.epoch = 0; this.outer = null; this.inner = null; this.failures = new Map(); this.ring = null; }
  static legacy(keyBuf) {
    const k = new Keys(); k.byId.set(1, Buffer.from(keyBuf)); k.current = 1;
    k.inner = crypto.createHmac('sha256', keyBuf).update('blind-index').digest();
    return k;
  }
  static fromRing(ring) { const k = new Keys(); k.mode = 'ring'; k.adopt(ring); return k; }
  // take a (validated) ring as the truth: keys that left it are zeroed, the epoch stays where it was
  adopt(ring) {
    // check first, change nothing on failure: a ring without the epoch this process runs at cannot be taken up
    if (this.epoch && !ring.idx.outer.some((o) => o.epoch === this.epoch)) throw new Error('the keyring no longer holds the index key for epoch ' + this.epoch + ' (this database has to be brought to the current epoch, or restarted on a ring that has it)');
    const ids = new Set(ring.dek.keys.map((x) => x.id));
    for (const [id, b] of this.byId) if (!ids.has(id)) { b.fill(0); this.byId.delete(id); }
    for (const x of ring.dek.keys) if (!this.byId.has(x.id)) this.byId.set(x.id, Buffer.from(x.hex, 'hex'));
    const eps = new Set(ring.idx.outer.map((x) => x.epoch));
    for (const [e, b] of this.outers) if (!eps.has(e)) { b.fill(0); this.outers.delete(e); }
    for (const x of ring.idx.outer) if (!this.outers.has(x.epoch)) this.outers.set(x.epoch, Buffer.from(x.hex, 'hex'));
    this.inner = Buffer.from(ring.idx.inner, 'hex');
    this.current = ring.dek.current; this.ring = ring;
    if (this.epoch && !this.outers.has(this.epoch)) throw new Error('the keyring no longer holds the index key for epoch ' + this.epoch);
    this.outer = this.epoch ? this.outers.get(this.epoch) : null;
  }
  has(kid) { return this.byId.has(kid); }
  hasEpoch(e) { return e === 0 || this.outers.has(e); }
  setEpoch(e) {
    if (!this.hasEpoch(e)) throw new Error('index epoch ' + e + ' needs its index key, which is not in the keyring');
    this.epoch = e; this.outer = e ? this.outers.get(e) : null;
  }
  fail(kid) { this.failures.set(kid, (this.failures.get(kid) || 0) + 1); }
  /* fields */
  encField(s, kid = this.current) {
    if (s == null) return null;
    const key = this.byId.get(kid); if (!key) throw new Error('no data key ' + kid);
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const head = kid === 1 ? 'v1:' : 'v2:' + kid + ':';
    if (kid !== 1) c.setAAD(Buffer.from(head));
    const ct = Buffer.concat([c.update(String(s), 'utf8'), c.final()]);
    return head + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  }
  // {kid, plain}: plain is null when no key here opens it; kid is null for a plaintext value (plain = the value)
  openField(s) {
    if (s == null) return { kid: null, plain: null };
    s = String(s);
    const kid = fieldKid(s);
    if (kid === null) return { kid: null, plain: s };
    const key = kid ? this.byId.get(kid) : null;
    if (!key) return { kid, plain: null };
    try {
      const b = Buffer.from(kid === 1 ? s.slice(3) : s.slice(s.indexOf(':', 3) + 1), 'base64');
      if (b.length < 28) return { kid, plain: null };
      const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
      if (kid !== 1) d.setAAD(Buffer.from('v2:' + kid + ':'));
      return { kid, plain: Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8') };
    } catch { return { kid, plain: null }; }
  }
  decField(s) {
    const r = this.openField(s);
    if (r.plain == null && r.kid !== null) this.fail(r.kid);
    return r.plain;
  }
  /* blobs */
  encBlob(buf, kid = this.current) {
    const key = this.byId.get(kid); if (!key) throw new Error('no data key ' + kid);
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
    let head;
    if (kid === 1) head = Buffer.from([1]);
    else { head = Buffer.alloc(5); head[0] = 2; head.writeUInt32BE(kid, 1); c.setAAD(head); }
    const ct = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([head, iv, c.getAuthTag(), ct]);
  }
  openBlob(buf) {
    const kid = blobKid(buf);
    if (kid === null || kid === 0) return { kid, plain: null };
    const key = this.byId.get(kid); if (!key) return { kid, plain: null };
    const b = toBuf(buf), o = kid === 1 ? 1 : 5;
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(o, o + 12)); d.setAuthTag(b.subarray(o + 12, o + 28));
      if (kid !== 1) d.setAAD(b.subarray(0, 5));
      return { kid, plain: Buffer.concat([d.update(b.subarray(o + 28)), d.final()]) };
    } catch { return { kid, plain: null }; }
  }
  decBlob(buf) {
    const r = this.openBlob(buf);
    if (r.plain == null && r.kid !== null) this.fail(r.kid);
    return r.plain;
  }
  /* blind indexes */
  bidx(s) { const h = hmacHex(this.inner, s); return this.outer ? ecbHex(this.outer, h, true) : h; }
  bidxAt(s, e) { const h = hmacHex(this.inner, s); return e ? ecbHex(this.outerKey(e), h, true) : h; }
  outerKey(e) { const k = this.outers.get(e); if (!k) throw new Error('no index key for epoch ' + e); return k; }
  // an index stored at epoch `from`, moved to epoch `to` — no input needed, only the two outer keys
  rewrapIdx(hex, from, to) {
    if (from === to) return hex;
    const inner = from ? ecbHex(this.outerKey(from), hex, false) : hex;
    return to ? ecbHex(this.outerKey(to), inner, true) : inner;
  }
  fingerprint(kid) { const k = this.byId.get(kid); return k ? fingerprint(k) : null; }
}

/* ---------- the keyring on disk ---------- */
function ringBody(ring) { const { sha256, ...rest } = ring; return JSON.stringify(rest); }
function sealRing(ring) { ring.sha256 = crypto.createHash('sha256').update(ringBody(ring)).digest('hex'); return ring; }
function validateRing(ring) {
  if (!ring || ring.format !== RING_FORMAT || ring.version !== RING_VERSION) throw new Error('not a JustSendIt keyring');
  if (crypto.createHash('sha256').update(ringBody(ring)).digest('hex') !== ring.sha256) throw new Error('the keyring checksum does not match (the file is truncated or was edited)');
  const d = ring.dek, x = ring.idx;
  if (!d || !Array.isArray(d.keys) || !Array.isArray(d.dropped) || !Number.isInteger(d.nextId)) throw new Error('the keyring has no data-key list');
  const ids = new Set();
  for (const k of d.keys) {
    if (!Number.isInteger(k.id) || k.id < 1 || ids.has(k.id)) throw new Error('bad or repeated data-key id ' + k.id);
    if (!HEX64.test(String(k.hex))) throw new Error('data key ' + k.id + ' is not 64 hex characters');
    if (k.id >= d.nextId) throw new Error('nextId must be above every data-key id');
    ids.add(k.id);
  }
  for (const k of d.dropped) if (ids.has(k.id) || k.id >= d.nextId) throw new Error('data key ' + k.id + ' is listed as dropped and present');
  if (!ids.has(d.current)) throw new Error('the current data key ' + d.current + ' is not in the keyring');
  if (!x || !HEX64.test(String(x.inner)) || !Array.isArray(x.outer) || !Array.isArray(x.dropped) || !Number.isInteger(x.nextEpoch)) throw new Error('the keyring has no index keys');
  const eps = new Set();
  for (const o of x.outer) {
    if (!Number.isInteger(o.epoch) || o.epoch < 1 || eps.has(o.epoch) || !HEX64.test(String(o.hex))) throw new Error('bad index key for epoch ' + o.epoch);
    if (o.epoch >= x.nextEpoch) throw new Error('nextEpoch must be above every epoch');
    eps.add(o.epoch);
  }
  return ring;
}
function newRingFromLegacy(keyBuf, t = Date.now()) {
  return sealRing({
    format: RING_FORMAT, version: RING_VERSION, generation: 0, writtenAt: t,
    dek: { current: 1, nextId: 2, keys: [{ id: 1, hex: Buffer.from(keyBuf).toString('hex'), added: t, retiredAt: null, origin: 'legacy' }], dropped: [] },
    idx: { inner: crypto.createHmac('sha256', keyBuf).update('blind-index').digest('hex'), outer: [], nextEpoch: 1, dropped: [] },
  });
}
// A key file must not be writable by anyone else; readable by others is repaired when this account owns it, refused otherwise.
function checkKeyFilePerms(file) {
  const st = fs.statSync(file);
  const mine = typeof process.getuid !== 'function' || st.uid === process.getuid();
  if (st.mode & 0o022) throw new Error(file + ' can be written by other accounts on this machine — refusing to trust it (chmod 600 it)');
  if (st.mode & 0o044) {
    if (mine) fs.chmodSync(file, 0o600);
    else throw new Error(file + ' can be read by other accounts on this machine — chmod 600 it');
  }
}
// {kind:'hex', key} for a legacy single-key file, {kind:'ring', ring} for a keyring. Throws on anything else.
function readKeyFile(file) {
  checkKeyFilePerms(file);
  const txt = fs.readFileSync(file, 'utf8').trim();
  if (HEX64.test(txt)) return { kind: 'hex', key: Buffer.from(txt, 'hex') };
  let ring; try { ring = JSON.parse(txt); } catch { throw new Error(file + ' holds neither a 64-hex key nor a keyring'); }
  return { kind: 'ring', ring: validateRing(ring) };
}
const ringSiblings = (file) => { const dir = path.dirname(path.resolve(file)); return { dir, prev: path.join(dir, 'keyring.prev.json'), lock: path.join(dir, 'keyring.lock'), escrowPub: path.join(dir, 'escrow.pub'), request: path.join(dir, 'rotate-request.json') }; };
function fsyncPath(p) { const fd = fs.openSync(p, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }   // libuv issues F_FULLFSYNC on macOS
function writeFileDurable(file, data, mode = 0o600) {
  const tmp = path.join(path.dirname(file), '.' + path.basename(file) + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp');
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, mode);
    try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }   // a temp copy of a keyring holds keys: never leave one behind
  fsyncPath(path.dirname(file));
}
/* One writer at a time, across processes (the server and scripts/keys.mjs). A ring write takes well under a second, so a
   lock older than LOCK_STALE_MS was left by a writer that died (a crash, a power cut) and is taken over — even when its
   pid now belongs to some other process after a reboot. A younger lock is honoured while its pid is alive. */
const LOCK_STALE_MS = 60e3;
function withRingLock(file, fn) {
  const { lock } = ringSiblings(file);
  for (let i = 0; ; i++) {
    try { const fd = fs.openSync(lock, 'wx', 0o600); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid = 0, age = 0; try { pid = Number(fs.readFileSync(lock, 'utf8')) || 0; age = Date.now() - fs.statSync(lock).mtimeMs; } catch {}
      let alive = false;
      if (pid > 0 && pid !== process.pid && age < LOCK_STALE_MS) { try { process.kill(pid, 0); alive = true; } catch (k) { alive = k.code === 'EPERM'; } }
      if (alive || i >= 2) throw new Error('the keyring is being written by another process' + (pid ? ' (pid ' + pid + ')' : ''));
      try { fs.unlinkSync(lock); } catch {}
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch {} }
}
/* Write a keyring so that a crash at any instant leaves either the old ring or the new one, never neither:
   escrow copy first (when configured), then a temp file fsynced, the old ring kept as keyring.prev.json, rename, fsync
   the directory, read it back. `dropping` also replaces keyring.prev.json with the new ring, so a dropped key does not
   live on in the previous copy (only in sealed escrow). The test runner points JSI_DATA_DIR at a throwaway directory:
   a ring under /Volumes is then refused, so a test can never rewrite the real one. */
// temp copies of the ring or of keyring.prev.json left by a write that died part-way (they hold keys) — only under the lock
function cleanRingTemps(file) {
  const dir = path.dirname(file), names = ['.' + path.basename(file) + '.', '.keyring.prev.json.'];
  try { for (const n of fs.readdirSync(dir)) if (n.endsWith('.tmp') && names.some((p) => n.startsWith(p))) { try { fs.unlinkSync(path.join(dir, n)); } catch {} } } catch {}
}
function writeRing(file, ring, opts = {}) {
  file = path.resolve(file);
  if (process.env.JSI_DATA_DIR && file.startsWith('/Volumes/') && !process.env.JSI_ALLOW_VOLUME_RING) throw new Error('refusing to write a keyring under /Volumes while JSI_DATA_DIR points at a test directory');
  return withRingLock(file, () => {
    const next = JSON.parse(JSON.stringify(ring));
    next.generation = (Number(next.generation) || 0) + 1; next.writtenAt = Date.now();
    sealRing(next); validateRing(next);
    const json = JSON.stringify(next, null, 1) + '\n';
    const sib = ringSiblings(file);
    const pub = readEscrowPub(file);
    if (pub && opts.escrowDir) escrowWrite(opts.escrowDir, pub, json, next.generation);
    if (opts.crashAt === 'ring-before-rename') process.exit(91);
    if (fs.existsSync(file) && !opts.dropping) {
      const old = fs.readFileSync(file);
      writeFileDurable(sib.prev, old);
    }
    writeFileDurable(file, json);
    if (opts.dropping) writeFileDurable(sib.prev, json);
    cleanRingTemps(file);
    const back = readKeyFile(file);
    if (back.kind !== 'ring' || back.ring.sha256 !== next.sha256) throw new Error('the keyring read back differs from what was written');
    return back.ring;
  });
}

/* ---------- escrow: every ring, sealed to an offline public key ----------
   The Mac holds only the public half (escrow.pub beside the ring). The private half is printed once by
   `scripts/keys.mjs escrow-init` for the owner to keep OFF this machine; with it, any sealed ring opens
   (`scripts/keys.mjs escrow-open`). The sealed files sit beside the backups and are useless without it. */
const RAW_PUB = (k) => k.export({ format: 'der', type: 'spki' }).subarray(-32);
const pubFromRaw = (raw) => crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), raw]), format: 'der', type: 'spki' });
const privFromRaw = (raw) => crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), raw]), format: 'der', type: 'pkcs8' });
function escrowKeygen() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return { pub: RAW_PUB(publicKey).toString('base64'), priv: privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('hex') };
}
function escrowKdf(shared, epub, rpub) { return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.concat([epub, rpub]), 'jsi-escrow/1', 32)); }
function escrowSeal(pubB64, plaintext) {
  const rpub = Buffer.from(pubB64, 'base64'); if (rpub.length !== 32) throw new Error('bad escrow public key');
  const eph = crypto.generateKeyPairSync('x25519'), epub = RAW_PUB(eph.publicKey);
  const key = escrowKdf(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: pubFromRaw(rpub) }), epub, rpub);
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(ESCROW_MAGIC));
  const ct = Buffer.concat([c.update(Buffer.from(plaintext)), c.final()]);
  key.fill(0);
  return Buffer.concat([Buffer.from(ESCROW_MAGIC), epub, iv, c.getAuthTag(), ct]);
}
function escrowOpen(privHex, sealed) {
  const b = toBuf(sealed);
  if (b.subarray(0, 5).toString() !== ESCROW_MAGIC) throw new Error('not a JustSendIt escrow file');
  const epub = b.subarray(5, 37), iv = b.subarray(37, 49), tag = b.subarray(49, 65), ct = b.subarray(65);
  const priv = privFromRaw(Buffer.from(String(privHex).trim(), 'hex')), rpub = RAW_PUB(crypto.createPublicKey(priv));
  const key = escrowKdf(crypto.diffieHellman({ privateKey: priv, publicKey: pubFromRaw(epub) }), epub, rpub);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAAD(Buffer.from(ESCROW_MAGIC)); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}
/* ONE database owns a keyring: only the server running on it may rotate, take requests or drop keys. Any other
   process that reads the same ring (a copy of the database opened for a look, a development server) may decrypt with it
   but never change it — a second rotator would count only its own data and could drop a key the site still needs.
   owner = { dbId (key_meta db_id of the owning database), dataDir (where that database lives) }. */
function ringOwnerMatches(ring, dbId, dataDir) {
  const o = ring && ring.owner;
  if (!o || !o.dbId || !dbId || o.dbId !== dbId) return false;
  let a = String(o.dataDir || ''), b = String(dataDir || '');
  try { a = fs.realpathSync(a); } catch {} try { b = fs.realpathSync(b); } catch {}
  return a === b;
}
function ensureDbId(db) { ensureMeta(db); let id = getMeta(db, 'db_id'); if (!id) { id = crypto.randomBytes(16).toString('hex'); setMeta(db, 'db_id', id); } return id; }
/* The backups folder carries a marker (.jsi-backups, holding the owning database's id) written by scripts/keys.mjs init
   or claim. When the database expects one (key_meta backup_marker) and the folder lacks it, the folder at that path is
   not the backups volume — an unmounted volume whose mount point was re-created, say — and nothing may treat it as
   "the backups, all checked". */
const BACKUP_MARKER = '.jsi-backups';
function writeBackupMarker(dir, id, dataDir) { let real = dataDir; try { real = fs.realpathSync(dataDir); } catch {} writeFileDurable(path.join(dir, BACKUP_MARKER), JSON.stringify({ dbId: String(id), dataDir: real }) + '\n', 0o600); }
function readBackupMarker(dir) {
  try { const t = fs.readFileSync(path.join(dir, BACKUP_MARKER), 'utf8').trim(); try { const j = JSON.parse(t); return j && j.dbId ? j : { dbId: t }; } catch { return { dbId: t }; } }
  catch (e) { return e.code === 'ENOENT' ? null : { unreadable: true }; }
}
/* Is `dir` THIS database's backups folder? A marked folder belongs to the database named in its marker (id and folder);
   a database that expects a marker (key_meta backup_marker) accepts only a folder carrying its own. An unmarked folder is
   fine for a database that expects none. */
function backupMarkerOk(dir, expected, dbId, dataDir) {
  const m = readBackupMarker(dir);
  if (!m) return !expected;
  if (m.unreadable) return false;
  if (expected && m.dbId !== String(expected)) return false;
  if (!expected && (!dbId || m.dbId !== String(dbId))) return false;
  if (m.dataDir && dataDir) { let real = dataDir; try { real = fs.realpathSync(dataDir); } catch {} if (m.dataDir !== real) return false; }
  return true;
}
function readEscrowPub(ringFile) {
  try { const t = fs.readFileSync(ringSiblings(ringFile).escrowPub, 'utf8').trim(); return Buffer.from(t, 'base64').length === 32 ? t : null; } catch { return null; }
}
const ESCROW_KEEP_MS = 365 * 864e5;
function escrowWrite(dir, pubB64, json, generation) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = path.join(dir, 'escrow-g' + generation + '-' + new Date().toISOString().replace(/[:.]/g, '') + '.jsie');
  writeFileDurable(f, escrowSeal(pubB64, json));
  try { for (const n of fs.readdirSync(dir)) if (/^escrow-g\d+-.*\.jsie$/.test(n)) { const p = path.join(dir, n); if (Date.now() - fs.statSync(p).mtimeMs > ESCROW_KEEP_MS) fs.unlinkSync(p); } } catch {}
  return f;
}
function lastEscrowAt(dir) {
  try { return Math.max(0, ...fs.readdirSync(dir).filter((n) => n.endsWith('.jsie')).map((n) => fs.statSync(path.join(dir, n)).mtimeMs)) || null; } catch { return null; }
}

/* ---------- the registry: every value a key protects ----------
   ONE list drives the re-encryption, the census, the startup check, the backup pass and the tests. A column that
   holds key-derived values and is missing here would keep the old key alive (or, for an index, stop matching), so
   tests/keyrotate.mjs fills every one of them and checks each moved. */
const ENC_FIELDS = [
  ['identities', 'identifier_enc'], ['tracked_wallets', 'address_enc'],
  ['users', 'holder_proof'], ['users', 'tracker_prefs'], ['users', 'site_prefs'],
  ['users', 'twofa_secret'], ['users', 'twofa_pending'], ['users', 'gate_wallets'],
  ['wallet_challenges', 'msg'], ['api_keys', 'wallet'], ['tracker_cache', 'report'], ['nonces', 'msg'],
  ['dh_follow', 'addr_enc'], ['dh_follow', 'info_enc'], ['dh_moves', 'from_enc'], ['dh_moves', 'to_enc'], ['dh_moves', 'tx_enc'], ['dh_moves', 'info_enc'],   // Diamond Hands: wallets followed, moves seen
];
const ENC_BLOBS = [['wallet_hist', 'hist']];
/* Blind indexes. Only 64-hex values move (a raw IP or a pre-migration plaintext identifier is left for the boot
   migrations, which index it under the new epoch). identities/tracked_wallets only where the encrypted copy exists:
   a row without it still holds its plaintext in the index column. */
const IDX_COLUMNS = [
  { t: 'identities', c: 'identifier', where: 'identifier_enc IS NOT NULL' },
  { t: 'tracked_wallets', c: 'address', where: 'address_enc IS NOT NULL' },
  { t: 'wallet_hist', c: 'addr_idx' }, { t: 'tracker_cache', c: 'addr_idx' },
  { t: 'og_claims', c: 'addr_idx' }, { t: 'gate_claims', c: 'addr_idx' },
  { t: 'api_key_burns', c: 'wallet_idx' }, { t: 'api_keys', c: 'wallets_idx', json: true },
  { t: 'points_events', c: 'ref', pattern: /^(connect:|track:\d+:|swaptx:)([0-9a-f]{64})$/ },
  { t: 'email_misses', c: 'key', pattern: /^(ip:)([0-9a-f]{64})$/ },
  { t: 'users', c: 'signup_ip' }, { t: 'users', c: 'last_ip' }, { t: 'calls', c: 'ip' },
  { t: 'communities', c: 'creator_ip' }, { t: 'community_members', c: 'join_ip' }, { t: 'alerts', c: 'ip' },
  { t: 'squads', c: 'creator_ip' }, { t: 'squad_members', c: 'join_ip' }, { t: 'arcade_guest_rounds', c: 'ip' }, { t: 'arcade_guest_rounds', c: 'net' },
  { t: 'proposals', c: 'author_ip' }, { t: 'proposal_votes', c: 'vote_ip' },
  { t: 'dh_follow', c: 'addr_idx' }, { t: 'dh_moves', c: 'from_idx' }, { t: 'dh_moves', c: 'to_idx' }, { t: 'dh_moves', c: 'move_idx' },
];
// ten-minute sign-in challenges (and the retired nonces): deleted at an index flip rather than carried over
const FLIP_DELETE = ['wallet_challenges', 'nonces'];
const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';
function columns(db, table) { try { return new Set(db.prepare('PRAGMA table_info(' + q(table) + ')').all().map((r) => r.name)); } catch { return new Set(); } }
const hasCol = (db, t, c) => columns(db, t).has(c);
function rewrapValue(spec, v, keys, from, to) {
  if (typeof v !== 'string' || from === to) return null;
  if (spec.json) {
    let a; try { a = JSON.parse(v); } catch { return null; }
    if (!Array.isArray(a)) return null;
    let changed = false;
    const b = a.map((x) => (typeof x === 'string' && IDX_HEX.test(x)) ? (changed = true, keys.rewrapIdx(x, from, to)) : x);
    return changed ? JSON.stringify(b) : null;
  }
  if (spec.pattern) { const m = spec.pattern.exec(v); return m ? m[1] + keys.rewrapIdx(m[2], from, to) : null; }
  return IDX_HEX.test(v) ? keys.rewrapIdx(v, from, to) : null;
}

/* ---------- key_meta: where this database stands (no secrets) ---------- */
function ensureMeta(db) { db.exec('CREATE TABLE IF NOT EXISTS key_meta (k TEXT PRIMARY KEY, v TEXT)'); }
function getMeta(db, k) { try { const r = db.prepare('SELECT v FROM key_meta WHERE k = ?').get(k); return r ? r.v : null; } catch { return null; } }
function setMeta(db, k, v) { ensureMeta(db); if (v == null) db.prepare('DELETE FROM key_meta WHERE k = ?').run(k); else db.prepare('INSERT INTO key_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v)); }
const dbEpoch = (db) => { const v = Number(getMeta(db, 'idx_epoch')); return Number.isInteger(v) && v > 0 ? v : 0; };
const CANARY = 'jsi:idx-canary';

/* ---------- census ---------- */
// by prefix only (cheap, no decryption): how many values each data key id holds, per column
function prefixCensus(db) {
  const out = { kids: {}, columns: {} };
  const add = (col, kid, n) => { out.kids[kid] = (out.kids[kid] || 0) + n; (out.columns[col] = out.columns[col] || {})[kid] = ((out.columns[col] || {})[kid] || 0) + n; };
  for (const [t, c] of ENC_FIELDS) {
    if (!hasCol(db, t, c)) continue;
    // the key-id head only ('v1:' or 'v2:<kid>:'), so the grouping is per key, not per value
    for (const r of db.prepare(`SELECT CASE WHEN ${q(c)} GLOB 'v1:*' THEN 'v1:' ELSE substr(${q(c)}, 1, 3 + instr(substr(${q(c)}, 4), ':')) END h, COUNT(*) n FROM ${q(t)} WHERE ${q(c)} GLOB 'v1:*' OR ${q(c)} GLOB 'v2:*' GROUP BY h`).all())
      add(t + '.' + c, fieldKid(r.h), r.n);
  }
  for (const [t, c] of ENC_BLOBS) {
    if (!hasCol(db, t, c)) continue;
    for (const r of db.prepare(`SELECT substr(${q(c)}, 1, 5) h, length(${q(c)}) n FROM ${q(t)} WHERE length(${q(c)}) >= 29`).all()) {
      const h = toBuf(r.h); add(t + '.' + c, h[0] === 1 ? 1 : (h[0] === 2 && r.n >= 33) ? (h.readUInt32BE(1) || 0) : 0, 1);   // = blobKid
    }
  }
  return out;
}
// by trial decryption: which key really opens each value, and how many open with none
function trialCensus(db, keys) {
  const out = { refs: {}, unreadable: {}, unreadableCols: {}, values: 0, epoch: columns(db, 'key_meta').size ? dbEpoch(db) : 0 };
  const tally = (col, kid, ok) => {
    out.values++; const m = ok ? out.refs : out.unreadable; m[kid] = (m[kid] || 0) + 1;
    if (!ok) out.unreadableCols[col] = (out.unreadableCols[col] || 0) + 1;
  };
  for (const [t, c] of ENC_FIELDS) {
    if (!hasCol(db, t, c)) continue;
    for (const r of db.prepare(`SELECT ${q(c)} v FROM ${q(t)} WHERE ${q(c)} GLOB 'v1:*' OR ${q(c)} GLOB 'v2:*'`).all()) { const o = keys.openField(r.v); tally(t + '.' + c, o.kid, o.plain != null); }
  }
  for (const [t, c] of ENC_BLOBS) {
    if (!hasCol(db, t, c)) continue;
    for (const r of db.prepare(`SELECT ${q(c)} v FROM ${q(t)} WHERE length(${q(c)}) >= 29`).all()) { const o = keys.openBlob(r.v); tally(t + '.' + c, o.kid, o.plain != null); }
  }
  return out;
}
const sumOf = (m) => Object.values(m || {}).reduce((a, b) => a + b, 0);

/* ---------- re-encryption (data keys) ----------
   A generator: each step is ONE committed batch, so the server can yield to requests between batches and a crash
   loses at most the batch in flight (which then simply has not happened). Each row is a compare-and-swap on the exact
   value read, so a request that rewrote the row meanwhile wins and nothing is clobbered. Only values under a key other
   than the current one are selected, so running it again after a crash carries on where it stopped. */
function* sweepSteps(db, keys, opts = {}) {
  const batch = opts.batch || 200, blobBytes = opts.blobBytes || (8 << 20), cur = keys.current;
  const stats = { rewritten: 0, unreadable: {} };
  const unread = (kid) => { stats.unreadable[kid] = (stats.unreadable[kid] || 0) + 1; };
  const txn = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { fn(); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  };
  for (const [t, c] of ENC_FIELDS) {
    if (!hasCol(db, t, c)) continue;
    let after = Number.MIN_SAFE_INTEGER;
    for (;;) {
      const rows = db.prepare(`SELECT rowid AS r, ${q(c)} AS v FROM ${q(t)} WHERE rowid > ? AND (${q(c)} GLOB 'v1:*' OR ${q(c)} GLOB 'v2:*') ORDER BY rowid LIMIT ?`).all(after, batch);
      if (!rows.length) break;
      txn(() => {
        for (const row of rows) {
          after = row.r;
          const kid = fieldKid(row.v); if (kid === cur) continue;
          const plain = keys.openField(row.v).plain;
          if (plain == null) { unread(kid); continue; }
          stats.rewritten += db.prepare(`UPDATE ${q(t)} SET ${q(c)} = ? WHERE rowid = ? AND ${q(c)} = ?`).run(keys.encField(plain), row.r, row.v).changes;
        }
      });
      if (opts.crashAt === 'mid-sweep' && stats.rewritten) process.exit(92);
      yield stats;
    }
  }
  for (const [t, c] of ENC_BLOBS) {
    if (!hasCol(db, t, c)) continue;
    let after = Number.MIN_SAFE_INTEGER;
    for (;;) {
      const heads = db.prepare(`SELECT rowid AS r, length(${q(c)}) AS n FROM ${q(t)} WHERE rowid > ? AND length(${q(c)}) >= 29 ORDER BY rowid LIMIT ?`).all(after, batch);
      if (!heads.length) break;
      let bytes = 0; const take = [];
      for (const h of heads) { if (take.length && bytes + h.n > blobBytes) break; take.push(h.r); bytes += h.n; }
      txn(() => {
        for (const rid of take) {
          after = rid;
          const row = db.prepare(`SELECT ${q(c)} AS v FROM ${q(t)} WHERE rowid = ?`).get(rid); if (!row) continue;
          const kid = blobKid(row.v); if (kid === cur || kid === null) continue;
          const o = keys.openBlob(row.v);
          if (o.plain == null) { unread(kid); continue; }
          stats.rewritten += db.prepare(`UPDATE ${q(t)} SET ${q(c)} = ? WHERE rowid = ? AND ${q(c)} = ?`).run(keys.encBlob(o.plain), rid, row.v).changes;
        }
      });
      yield stats;
    }
  }
  return stats;
}
function sweepSync(db, keys, opts) { const g = sweepSteps(db, keys, opts); let r; while (!(r = g.next()).done); return r.value; }
async function sweepAsync(db, keys, opts = {}) {
  const g = sweepSteps(db, keys, opts); let r;
  for (;;) {
    // never open a batch inside somebody else's transaction (every transaction in server.js is synchronous, so this is a belt)
    while (db.isTransaction) await new Promise((res) => setTimeout(res, 5));
    r = g.next(); if (r.done) return r.value;
    await new Promise((res) => setImmediate(res));
  }
}

/* ---------- the index flip: every stored index from epoch `from` to epoch `to`, in the caller's transaction ----------
   Known-answer test: every identities / tracked_wallets row whose index matched its own decrypted value before must
   match after. A mismatch throws, and the caller's ROLLBACK leaves the database exactly at `from`. */
function idxKat(db, keys, e, limit) {
  const rows = [];
  for (const [t, c, ec] of [['identities', 'identifier', 'identifier_enc'], ['tracked_wallets', 'address', 'address_enc']]) {
    if (!hasCol(db, t, ec)) continue;
    for (const r of db.prepare(`SELECT rowid AS r, ${q(c)} AS i, ${q(ec)} AS v FROM ${q(t)} WHERE ${q(ec)} IS NOT NULL ORDER BY rowid DESC` + (limit ? ' LIMIT ' + Number(limit) : '')).all()) {
      const plain = keys.openField(r.v).plain;
      if (plain != null) rows.push({ t, c, r: r.r, plain, ok: keys.bidxAt(plain, e) === r.i });
    }
  }
  return rows;
}
function flipIndex(db, keys, from, to, opts = {}) {
  if (from === to) return { rewrapped: 0, checked: 0 };
  const before = idxKat(db, keys, from).filter((x) => x.ok);
  let rewrapped = 0;
  for (const spec of IDX_COLUMNS) {
    if (!hasCol(db, spec.t, spec.c)) continue;
    if (spec.where && !hasCol(db, spec.t, spec.where.split(' ')[0])) continue;
    const rows = db.prepare(`SELECT rowid AS r, ${q(spec.c)} AS v FROM ${q(spec.t)} WHERE ${q(spec.c)} IS NOT NULL` + (spec.where ? ' AND ' + spec.where : '')).all();
    const up = db.prepare(`UPDATE ${q(spec.t)} SET ${q(spec.c)} = ? WHERE rowid = ?`);
    for (const row of rows) { const nv = rewrapValue(spec, row.v, keys, from, to); if (nv != null) { up.run(nv, row.r); rewrapped++; } }
  }
  if (opts.crashAt === 'mid-flip') process.exit(93);
  if (opts.deleteShortLived !== false) for (const t of FLIP_DELETE) { if (columns(db, t).size) db.exec('DELETE FROM ' + q(t)); }
  for (const x of before) {
    const now = db.prepare(`SELECT ${q(x.c)} AS i FROM ${q(x.t)} WHERE rowid = ?`).get(x.r);
    if (!now || now.i !== keys.bidxAt(x.plain, to)) throw new Error('index flip check failed on ' + x.t + ' row ' + x.r + ' — nothing was changed');
  }
  ensureMeta(db);
  setMeta(db, 'idx_epoch', to);
  setMeta(db, 'idx_canary', keys.bidxAt(CANARY, to));
  return { rewrapped, checked: before.length };
}

/* ---------- a digest of everything the keys protect, in plaintext form ----------
   Equal before and after a rekey means not one value changed meaning. Index values are taken back to their inner
   HMAC (epoch 0), which is the same at every epoch. Row counts cover every table. */
function plainDigest(db, keys, epoch, skipTables = FLIP_DELETE) {
  const h = crypto.createHash('sha256'), counts = {};
  let unreadable = 0;
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'key_meta' ORDER BY name").all()) {
    if (skipTables.includes(name)) continue;
    counts[name] = db.prepare('SELECT COUNT(*) n FROM ' + q(name)).get().n;
  }
  for (const [t, c] of ENC_FIELDS) {
    if (skipTables.includes(t) || !hasCol(db, t, c)) continue;
    for (const r of db.prepare(`SELECT rowid AS r, ${q(c)} AS v FROM ${q(t)} ORDER BY rowid`).all()) {
      const o = keys.openField(r.v);
      if (o.kid !== null && o.plain == null) unreadable++;
      h.update(t + '.' + c + '#' + r.r + '=' + (r.v == null ? '\u0000null' : o.plain == null ? '\u0000unreadable:' + r.v : o.plain) + '\u0001');
    }
  }
  for (const [t, c] of ENC_BLOBS) {
    if (!hasCol(db, t, c)) continue;
    for (const r of db.prepare(`SELECT rowid AS r, ${q(c)} AS v FROM ${q(t)} ORDER BY rowid`).all()) {
      const o = keys.openBlob(r.v);
      if (o.kid !== null && o.plain == null) unreadable++;
      h.update(t + '.' + c + '#' + r.r + '='); h.update(o.plain || (r.v ? toBuf(r.v) : Buffer.alloc(0))); h.update('\u0001');
    }
  }
  for (const spec of IDX_COLUMNS) {
    if (skipTables.includes(spec.t) || !hasCol(db, spec.t, spec.c)) continue;
    if (spec.where && !hasCol(db, spec.t, spec.where.split(' ')[0])) continue;
    const applies = spec.where ? '(CASE WHEN ' + spec.where + ' THEN 1 ELSE 0 END)' : '1';
    for (const r of db.prepare(`SELECT rowid AS r, ${q(spec.c)} AS v, ${applies} AS a FROM ${q(spec.t)} ORDER BY rowid`).all()) {
      let v = r.v;
      if (v != null && r.a) { const w = rewrapValue(spec, v, keys, epoch, 0); if (w != null) v = w; }
      h.update(spec.t + '.' + spec.c + '#' + r.r + '=' + (v == null ? '\u0000null' : v) + '\u0001');
    }
  }
  return { sha: h.digest('hex'), counts, unreadable };
}

/* ---------- a backup file, brought to the current key and epoch ----------
   The original is never opened (a stale -wal beside it would be replayed into it): it is copied, the copy is
   rewritten and checked, compacted into a fresh file, and that file is renamed over the original with its old
   timestamps. Anything unexpected leaves the original byte-for-byte as it was and says why. */
function rekeyFile(file, keys, opts = {}) {
  const { DatabaseSync } = require('node:sqlite');
  const toEpoch = opts.toEpoch == null ? keys.epoch : opts.toEpoch;
  const base = path.basename(file), dir = path.dirname(file);
  const workDir = opts.workDir || path.join(dir, '.rekey');
  const res = { file, status: 'failed', why: null, kids: {}, epoch: null, unreadable: 0, unreadableKids: null };
  let st;
  try { st = fs.statSync(file); } catch (e) { res.why = 'cannot be read (' + (e.code || e.message) + ')'; return res; }
  try { const w = fs.statSync(file + '-wal'); if (w.size > 0) { res.why = 'a -wal beside it still holds changes (is a server using it?)'; return res; } } catch {}
  const work = path.join(workDir, base + '.work'), out = path.join(workDir, base + '.new');
  let d = null;
  try {
    fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
    for (const p of [work, work + '-journal', out]) { try { fs.unlinkSync(p); } catch {} }
    fs.copyFileSync(file, work);
    d = new DatabaseSync(work);
    d.exec('PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON;');
    const ic = d.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
    if (ic.length !== 1 || ic[0] !== 'ok') { res.why = 'integrity check failed: ' + ic.slice(0, 3).join('; '); return res; }
    const fromEpoch = columns(d, 'key_meta').size ? dbEpoch(d) : 0;
    res.epoch = fromEpoch;
    const pre = trialCensus(d, keys);
    res.kids = pre.refs; res.unreadable = sumOf(pre.unreadable); res.unreadableKids = pre.unreadable;
    /* Nothing in it opens with this keyring: a copy made under another keyring, or one that was away while its key was
       dropped. Rewriting it could only mix it up further — it is left byte for byte, and it needs no key this ring holds. */
    if (res.unreadable && !sumOf(pre.refs)) { res.status = 'foreign'; res.why = 'no key in this keyring opens any of its ' + res.unreadable + ' encrypted values — left exactly as it is (it needs the keyring it was made with)'; return res; }
    if (!keys.hasEpoch(fromEpoch) || !keys.hasEpoch(toEpoch)) { res.why = 'the keyring has no index key for epoch ' + (keys.hasEpoch(fromEpoch) ? toEpoch : fromEpoch); return res; }
    const onlyCurrent = Object.keys(pre.refs).every((k) => Number(k) === keys.current);
    // compacted under the current key already (this file, or the live database it was copied from): nothing old in its free space
    const scrubbed = columns(d, 'key_meta').size && getMeta(d, 'scrubbed_kid') === String(keys.current);
    if (onlyCurrent && fromEpoch === toEpoch && scrubbed) { res.status = 'current'; return res; }
    const before = plainDigest(d, keys, fromEpoch);
    if (fromEpoch !== toEpoch) {
      d.exec('BEGIN IMMEDIATE');
      try { flipIndex(d, keys, fromEpoch, toEpoch); d.exec('COMMIT'); } catch (e) { try { d.exec('ROLLBACK'); } catch {} throw e; }
    }
    sweepSync(d, keys);
    setMeta(d, 'scrubbed_kid', keys.current);
    const after = plainDigest(d, keys, toEpoch);
    const post = trialCensus(d, keys);
    if (after.sha !== before.sha) throw new Error('the plaintext digest changed');
    if (JSON.stringify(after.counts) !== JSON.stringify(before.counts)) throw new Error('row counts changed');
    if (Object.keys(post.refs).some((k) => Number(k) !== keys.current)) throw new Error('values under an old key remain after the rewrite');
    if (sumOf(post.unreadable) > res.unreadable) throw new Error('the rewrite made values unreadable');
    d.prepare('VACUUM INTO ?').run(out);
    d.close(); d = null;
    fsyncPath(out);
    const chk = new DatabaseSync(out, { readOnly: true });
    try {
      const ok = chk.prepare('PRAGMA quick_check').all().map((r) => Object.values(r)[0]);
      if (ok.length !== 1 || ok[0] !== 'ok') throw new Error('the rewritten copy failed its check');
      const again = trialCensus(chk, keys);
      if (Object.keys(again.refs).some((k) => Number(k) !== keys.current) || sumOf(again.unreadable) !== sumOf(post.unreadable) || again.epoch !== toEpoch) throw new Error('the rewritten copy is not at the current key and epoch');
    } finally { chk.close(); }
    if (opts.crashAt === 'file-before-rename') process.exit(94);
    fs.chmodSync(out, 0o600);
    fs.renameSync(out, file);
    fsyncPath(dir);
    try { fs.utimesSync(file, st.atime, st.mtime); } catch {}
    res.status = onlyCurrent && fromEpoch === toEpoch ? 'compacted' : 'rekeyed';
    res.kids = post.refs; res.epoch = toEpoch; res.unreadable = sumOf(post.unreadable); res.unreadableKids = post.unreadable;
    res.why = res.unreadable ? res.unreadable + ' values no key opens were kept exactly as they were' : null;
    return res;
  } catch (e) {
    res.status = 'failed'; res.why = (e && e.message) || String(e);
    return res;
  } finally {
    try { if (d) d.close(); } catch {}
    for (const p of [work, work + '-journal', out]) { try { fs.unlinkSync(p); } catch {} }
  }
}

module.exports = {
  HEX64, IDX_HEX, CANARY, Keys, fieldKid, blobKid, isCipher, hmacHex, ecbHex, fingerprint,
  readKeyFile, writeRing, validateRing, sealRing, newRingFromLegacy, ringSiblings, writeFileDurable, checkKeyFilePerms, cleanRingTemps,
  ringOwnerMatches, ensureDbId, sumOf, writeBackupMarker, readBackupMarker, backupMarkerOk, BACKUP_MARKER,
  escrowKeygen, escrowSeal, escrowOpen, readEscrowPub, escrowWrite, lastEscrowAt,
  ENC_FIELDS, ENC_BLOBS, IDX_COLUMNS, FLIP_DELETE, columns, hasCol, rewrapValue,
  ensureMeta, getMeta, setMeta, dbEpoch, prefixCensus, trialCensus, idxKat,
  sweepSteps, sweepSync, sweepAsync, flipIndex, plainDigest, rekeyFile,
};
