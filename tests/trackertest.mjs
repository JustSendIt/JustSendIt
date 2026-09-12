/* The tracker must carry every linked wallet automatically, mark them as yours, and never spend a
   tracked slot on them. Throwaway accounts only; deleted in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { DB_PATH, ROOT } from './_paths.mjs';
const require = createRequire(ROOT + '/package.json');
const { Wallet } = require('ethers');

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = [];

const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.sid ? { Cookie: 'sid=' + opts.sid } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
/* Fixtures here start PAST the participation gate (holder_verified_at set): this suite is testing
   something other than the gate, and a fixture that trips it would be testing the gate by accident.
   proofgate.mjs is the suite that tests the gate itself. */

function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + Math.random().toString(16).slice(2);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)')
    .run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}
async function link(sid, w) {
  const addr = w.address.toLowerCase();
  const n = await api('/api/auth/wallet/nonce?purpose=link&address=' + addr, { sid });
  const signature = await w.signMessage(n.j.message);
  return api('/api/auth/wallet/verify', { method: 'POST', sid, body: { address: addr, signature } });
}

try {
  const u = mkUser('__tk_user__');
  const w1 = Wallet.createRandom(), w2 = Wallet.createRandom(), w3 = Wallet.createRandom();

  const empty = await api('/api/wallets', { sid: u.sid });
  check('a fresh account has an empty tracker', (empty.j.wallets || []).length === 0, (empty.j.wallets || []).length);
  check('  ...and a tracked count of 0', empty.j.trackedCount === 0, empty.j.trackedCount);

  await link(u.sid, w1);
  await link(u.sid, w2);
  const two = await api('/api/wallets', { sid: u.sid });
  const ws = two.j.wallets || [];
  check('linked wallets appear in the tracker automatically', ws.length === 2, ws.length + ' listed');
  check('  ...marked as yours', ws.every(w => w.mine === true), JSON.stringify(ws.map(w => w.mine)));
  check('  ...in the same order as your wallet list', ws[0].address === w1.address.toLowerCase() && ws[1].address === w2.address.toLowerCase());
  check('  ...and none of them spends a tracked slot', two.j.trackedCount === 0, 'trackedCount=' + two.j.trackedCount);
  check('  ...mineCount reports them', two.j.mineCount === 2, two.j.mineCount);

  // a watched (not owned) wallet DOES spend a slot
  const watched = '0x' + 'dd'.repeat(20);
  const add = await api('/api/wallets', { method: 'POST', sid: u.sid, body: { address: watched, label: 'Whale' } });
  check('a wallet you do not own can still be watched', add.status === 200, add.status + ' ' + JSON.stringify(add.j && add.j.error || ''));
  const three = await api('/api/wallets', { sid: u.sid });
  check('  ...it appears too', (three.j.wallets || []).length === 3, (three.j.wallets || []).length);
  check('  ...marked as NOT yours', (three.j.wallets || []).find(w => w.address === watched).mine === false);
  check('  ...and it DOES spend a slot', three.j.trackedCount === 1, 'trackedCount=' + three.j.trackedCount);
  check('  ...your own wallets still sort first', three.j.wallets[0].mine && three.j.wallets[1].mine && !three.j.wallets[2].mine);

  // linking a third shows up without any action
  await link(u.sid, w3);
  const four = await api('/api/wallets', { sid: u.sid });
  check('linking another wallet adds it to the tracker with no extra step', (four.j.wallets || []).filter(w => w.mine).length === 3, (four.j.wallets || []).filter(w => w.mine).length);
  check('  ...and still costs no slots', four.j.trackedCount === 1, four.j.trackedCount);

  // unlinking removes it from the tracker too
  await api('/api/wallet/unlink', { method: 'POST', sid: u.sid, body: { address: w2.address.toLowerCase() } });
  const after = await api('/api/wallets', { sid: u.sid });
  check('unlinking a wallet takes it out of the tracker', !(after.j.wallets || []).some(w => w.address === w2.address.toLowerCase()));
  check('  ...leaving the others', (after.j.wallets || []).filter(w => w.mine).length === 2);

  // a wallet-first signup has a tracked row for its own wallet: it must be listed ONCE, as yours, free
  const dup = mkUser('__tk_dup__');
  const wd = Wallet.createRandom();
  await link(dup.sid, wd);
  db.prepare('INSERT OR IGNORE INTO tracked_wallets (user_id, address, address_enc, label, created_at) VALUES (?,?,?,?,?)')
    .run(dup.id, db.prepare('SELECT identifier FROM identities WHERE user_id=? AND type=\'wallet\'').get(dup.id).identifier, null, 'My wallet', Date.now());
  const dupList = await api('/api/wallets', { sid: dup.sid });
  const addrs = (dupList.j.wallets || []).map(w => w.address);
  check('a wallet that is both linked AND tracked is listed once', new Set(addrs).size === addrs.length, addrs.length + ' rows, ' + new Set(addrs).size + ' unique');
  check('  ...as yours', (dupList.j.wallets || []).every(w => w.mine), JSON.stringify((dupList.j.wallets || []).map(w => w.mine)));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  for (const id of made) {
    for (const t of ['tracked_wallets', 'tracker_cache', 'identities', 'sessions', 'points_events', 'notifications', 'holder_state', 'calls', 'posts'])
      { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM invite_codes WHERE owner_id=? OR user_id=?').run(id, id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_tk\\_%' ESCAPE '\\'").get().n;
  console.log('\ncleanup — users left:', left);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
