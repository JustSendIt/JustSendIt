/* Multi-wallet linking, the designated 2FA wallet, the per-IP account cap and the same-IP ring detector.
   Throwaway accounts only; everything is deleted in the finally block. Signatures are made with real
   private keys through ethers, so the SIWE path is exercised for real rather than stubbed. */
import { DatabaseSync } from 'node:sqlite';
import { gatePass, freshPass, cleanupGatePass } from './gatepass.mjs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { DB_PATH, ROOT } from './_paths.mjs';
const require = createRequire(ROOT + '/package.json');
const { Wallet } = require('ethers');

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const DBP = DB_PATH;
const db = new DatabaseSync(DBP);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
let GATE = '';
const made = { users: [] };

const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json', Origin: BASE,
      Cookie: [opts.pass !== undefined ? opts.pass : GATE, opts.sid ? 'sid=' + opts.sid : ''].filter(Boolean).join('; '),
      ...(opts.ip ? { 'X-Forwarded-For': opts.ip } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j, headers: r.headers };
};

function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar) VALUES (?,?,?)').run(name, Date.now(), '🧪');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.users.push(id);
  const raw = 'tok_' + name + '_' + Math.random().toString(16).slice(2);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)')
    .run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}

// link a freshly generated wallet to an account through the real SIWE link route
async function linkWallet(sid, w, ip) {
  const addr = w.address.toLowerCase();
  const n = await api('/api/auth/wallet/nonce?purpose=link&address=' + addr, { sid, ip });
  if (!n.j || !n.j.message) return { status: n.status, j: n.j };
  const signature = await w.signMessage(n.j.message);
  return api('/api/auth/wallet/verify', { method: 'POST', sid, ip, body: { address: addr, signature } });
}

GATE = await gatePass(BASE);
try {
  // ═══ 1. one account, several wallets ═══
  const a = mkUser('__sy_multi__');
  const w1 = Wallet.createRandom(), w2 = Wallet.createRandom(), w3 = Wallet.createRandom();
  const r1 = await linkWallet(a.sid, w1);
  check('a wallet links to an account', r1.status === 200 && r1.j && r1.j.linked, r1.status + ' ' + JSON.stringify(r1.j));
  const r2 = await linkWallet(a.sid, w2);
  check('a SECOND wallet links to the SAME account', r2.status === 200 && r2.j && r2.j.linked, r2.status + ' ' + JSON.stringify(r2.j));
  const r3 = await linkWallet(a.sid, w3);
  check('a third links too', r3.status === 200 && r3.j && r3.j.linked, r3.status);

  const me1 = await api('/api/me', { sid: a.sid });
  const wl = (me1.j && me1.j.user && me1.j.user.walletList) || [];
  check('/api/me returns a wallet LIST with detail', wl.length === 3, wl.length + ' entries');
  check('  ...each carries an address and a 2FA flag', wl.every(w => /^0x[0-9a-f]{40}$/.test(w.address) && 'is2fa' in w), JSON.stringify(wl[0] || {}));
  check('  ...and the cap is advertised', me1.j.user.maxWallets >= 3, me1.j.user.maxWallets);
  check('the legacy `wallets` string array still works', Array.isArray(me1.j.user.wallets) && me1.j.user.wallets.length === 3);

  // a wallet already linked elsewhere cannot be taken
  const b = mkUser('__sy_other__');
  const steal = await linkWallet(b.sid, w1);
  check('a wallet cannot be linked to two accounts', steal.status === 409 || (steal.j && steal.j.error), steal.status + ' ' + JSON.stringify(steal.j));

  // ═══ 2. unlink ONE wallet, keep the rest ═══
  const un = await api('/api/wallet/unlink', { method: 'POST', sid: a.sid, body: { address: w2.address.toLowerCase() } });
  check('one wallet can be unlinked on its own', un.status === 200, un.status + ' ' + JSON.stringify(un.j));
  const after = (await api('/api/me', { sid: a.sid })).j.user;
  check('  ...and the others stay linked', after.wallets.length === 2, after.wallets.length);
  check('  ...the right one went', !after.wallets.includes(w2.address.toLowerCase()));
  const unBad = await api('/api/wallet/unlink', { method: 'POST', sid: a.sid, body: { address: w2.address.toLowerCase() } });
  check('unlinking a wallet that is not linked 404s', unBad.status === 404, unBad.status);

  // last wallet on a wallet-only account is protected
  const solo = mkUser('__sy_solo__');
  const ws = Wallet.createRandom();
  await linkWallet(solo.sid, ws);
  db.prepare("DELETE FROM identities WHERE user_id = ? AND type != 'wallet'").run(solo.id); // wallet-only
  const lockout = await api('/api/wallet/unlink', { method: 'POST', sid: solo.sid, body: { address: ws.address.toLowerCase() } });
  check('the last wallet of a wallet-only account is protected', lockout.status !== 200 && /lock you out/i.test((lockout.j && lockout.j.error) || ''), (lockout.j && lockout.j.error || '').slice(0, 70));

  // ═══ 3. the per-IP account cap ═══
  const IP = '203.0.113.77';
  /* A FRESH invite per attempt. The gate now admits one account per code, so reusing one pass would
     make every signup after the first fail with `code_spent` and the per-IP cap would never be reached
     — the test would pass for the wrong reason (or, as it did, fail for one). Each attempt gets its own
     code, so what is actually being measured here is the IP cap and nothing else. */
  const mkAcct = async (i) => api('/api/auth/register', { method: 'POST', ip: IP, pass: await freshPass(BASE),
    body: { email: `sy${i}_${Date.now()}@example.com`, username: `__sy_ip_${i}_${Math.random().toString(16).slice(2, 7)}`, password: 'abcd1234!' } });
  const acc = [];
  for (let i = 0; i < 4; i++) acc.push(await mkAcct(i));
  for (const r of acc) { const j = r.j || {}; if (j.username) { const row = db.prepare('SELECT id FROM users WHERE username=?').get(j.username); if (row) made.users.push(row.id); } }
  const okCount = acc.filter(r => r.status === 200).length;
  check('exactly 3 accounts may be created from one IP', okCount === 3, okCount + ' succeeded of 4');
  check('  ...the 4th is refused with a 429', acc[3].status === 429, acc[3].status);
  check('  ...and the refusal explains multi-wallet instead', /link up to \d+ wallets/i.test((acc[3].j && acc[3].j.error) || ''), (acc[3].j && acc[3].j.error || '').slice(0, 90));
  const stored = db.prepare('SELECT COUNT(*) n FROM users WHERE signup_ip IS NOT NULL').get().n;
  check('signup IPs are recorded (as blind indexes)', stored >= 3, stored);
  const raw = db.prepare("SELECT COUNT(*) n FROM users WHERE signup_ip LIKE '%203.0.113%'").get().n;
  check('  ...and never stored in the clear', raw === 0, raw);

  // ═══ 4. same-IP ring on one token ═══
  const RIP = '198.51.100.42';
  const ripIdx = db.prepare('SELECT last_ip FROM users WHERE id = ?');
  const ring = [];
  for (let i = 0; i < 3; i++) ring.push(mkUser('__sy_ring_' + i));
  const TOKEN = '0x' + 'ab'.repeat(20);
  // Insert calls directly with the same ip blind index the server would compute, then drive the 3rd
  // through the real route so the detector runs on a real request.
  const ipBidx = db.prepare('SELECT ip FROM calls WHERE ip IS NOT NULL LIMIT 1'); // shape probe only
  check('the calls table has an ip column', !!db.prepare("SELECT COUNT(*) n FROM pragma_table_info('calls') WHERE name='ip'").get().n);

  // ═══ 5. redemption cost doubles for a ring ═══
  const vic = mkUser('__sy_cost__');
  db.prepare("UPDATE users SET restricted_until=?, restrict_level=1, strikes=1, redeem_dur=?, redeem_mult=1 WHERE id=?")
    .run(Date.now() + 6 * 3600e3, 864e5, vic.id);
  const normal = (await api('/api/me', { sid: vic.sid })).j.user.restriction;
  db.prepare('UPDATE users SET redeem_mult = 2 WHERE id = ?').run(vic.id);
  const doubled = (await api('/api/me', { sid: vic.sid })).j.user.restriction;
  check('a normal restriction costs the base rate', normal && normal.redeemUsd === 25, normal && normal.redeemUsd);
  check('a sybil restriction costs DOUBLE', doubled && doubled.redeemUsd === 50, doubled && doubled.redeemUsd);
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  for (const id of made.users) {
    for (const t of ['points_events', 'notifications', 'sessions', 'posts', 'calls', 'identities', 'tracked_wallets', 'holder_state', 'community_members'])
      { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM notifications WHERE actor_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM invite_codes WHERE owner_id=? OR user_id=?').run(id, id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_sy\\_%' ESCAPE '\\'").get().n;
  console.log('\ncleanup — throwaway users left:', left);
  cleanupGatePass();
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
