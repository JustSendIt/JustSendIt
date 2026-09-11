/* The ring detector itself, driven against the REAL source pulled out of server.js — same technique
   economytest uses for decayUser. Seeds throwaway accounts and calls in the live DB, runs sybilRing /
   flagSybilRing / flagUser exactly as written, then deletes everything. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { DB_PATH, SERVER_JS } from './_paths.mjs';

const SRC = readFileSync(SERVER_JS, 'utf8');
const grab = (re, label) => { const m = SRC.match(re); if (!m) { console.error('could not extract ' + label); process.exit(1); } return m[0]; };

const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = [];
const notes = [];

// the real functions, with their real constants
const src =
  'const DAY_MS = 86400000;\n' +
  'const PERM_UNTIL = 32503680000000;\n' +
  grab(/const SYBIL_REDEEM_MULT = [^\n]*\n/, 'SYBIL_REDEEM_MULT') +
  grab(/const MAX_ACCOUNTS_PER_IP = [^\n]*\n/, 'MAX_ACCOUNTS_PER_IP') +
  grab(/const SYBIL_RING_ACCOUNTS = [^\n]*\n/, 'SYBIL_RING_ACCOUNTS') +
  grab(/const SYBIL_WINDOW_MS = [^\n]*\n/, 'SYBIL_WINDOW_MS') +
  grab(/function accountsFromIp\(idx\) \{[\s\S]*?\n\}/, 'accountsFromIp') + '\n' +
  grab(/function ipSignupBlocked\(idx\) \{[\s\S]*?\n\}/, 'ipSignupBlocked') + '\n' +
  grab(/function sybilRing\(userId, idx, tokenAddr\) \{[\s\S]*?\n\}/, 'sybilRing') + '\n' +
  grab(/function flagSybilRing\(ids, symbol\) \{[\s\S]*?\n\}/, 'flagSybilRing') + '\n' +
  grab(/function flagUser\(userId, reason, costMult\) \{[\s\S]*?\n\}/, 'flagUser') + '\n' +
  'return { sybilRing, flagSybilRing, flagUser, accountsFromIp, ipSignupBlocked, SYBIL_RING_ACCOUNTS, MAX_ACCOUNTS_PER_IP, SYBIL_REDEEM_MULT };';

const fn = new Function('db', 'now', 'notify', 'MAX_LINKED_WALLETS', 'console', src)(
  db, () => Date.now(), (id, ico, msg) => notes.push({ id, msg }), 5, console);

const IP_A = 'idx_ring_aaa', IP_B = 'idx_ring_bbb';
const TOKEN = '0x' + 'ab'.repeat(20);
const OTHER = '0x' + 'cd'.repeat(20);

function mkUser(name, signupIp) {
  db.prepare('INSERT INTO users (username, created_at, avatar, signup_ip) VALUES (?,?,?,?)').run(name, Date.now(), '🧪', signupIp || null);
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(id);
  return id;
}
function mkCall(userId, token, ip, ageMs) {
  db.prepare('INSERT INTO calls (user_id, token_addr, pair_addr, symbol, entry_price, peak_price, cur_price, created_at, ip) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(userId, token, '0x' + '11'.repeat(20), 'RING', 1, 1, 1, Date.now() - (ageMs || 0), ip);
}

try {
  check('the ring threshold is ' + fn.SYBIL_RING_ACCOUNTS, fn.SYBIL_RING_ACCOUNTS === 3, fn.SYBIL_RING_ACCOUNTS);
  check('the per-IP account cap is ' + fn.MAX_ACCOUNTS_PER_IP, fn.MAX_ACCOUNTS_PER_IP === 3, fn.MAX_ACCOUNTS_PER_IP);
  check('a sybil buy-out costs ×' + fn.SYBIL_REDEEM_MULT, fn.SYBIL_REDEEM_MULT === 2, fn.SYBIL_REDEEM_MULT);

  const u1 = mkUser('__rg_1__', IP_A), u2 = mkUser('__rg_2__', IP_A), u3 = mkUser('__rg_3__', IP_A);
  const far = mkUser('__rg_far__', IP_B);

  // ── one account alone is never a ring ──
  mkCall(u1, TOKEN, IP_A);
  check('one account on one token is not a ring', fn.sybilRing(u1, IP_A, TOKEN) === null);

  // ── two is still not ──
  mkCall(u2, TOKEN, IP_A);
  check('two accounts sharing a connection is still not a ring', fn.sybilRing(u2, IP_A, TOKEN) === null, 'families and offices share IPs');

  // ── three is ──
  const ring = fn.sybilRing(u3, IP_A, TOKEN);
  check('three accounts on one connection pushing one coin IS a ring', Array.isArray(ring) && ring.length === 3, ring && ring.length);
  check('  ...and the acting account is in it', ring && ring.includes(u3));

  // ── a different token on the same IP is not the same ring ──
  check('the same people on a DIFFERENT coin are not a ring', fn.sybilRing(u3, IP_A, OTHER) === null);

  // ── a different IP is not part of it ──
  mkCall(far, TOKEN, IP_B);
  const ring2 = fn.sybilRing(far, IP_B, TOKEN);
  check('an account elsewhere on the same coin is not swept in', ring2 === null, ring2 && ring2.length);

  // ── stale calls fall out of the window ──
  const oldU = mkUser('__rg_old__', IP_B);
  mkCall(oldU, OTHER, IP_B, 8 * 86400000);
  const u4 = mkUser('__rg_4__', IP_B), u5 = mkUser('__rg_5__', IP_B);
  mkCall(u4, OTHER, IP_B, 8 * 86400000);
  check('calls older than the window do not count', fn.sybilRing(u5, IP_B, OTHER) === null, 'stale ring ignored');

  // ── no IP → never guess ──
  check('a request with no readable IP is never flagged', fn.sybilRing(u3, null, TOKEN) === null);

  // ── the whole ring is restricted, each at ×2 cost ──
  const hit = fn.flagSybilRing(ring, 'RING');
  check('every account in the ring is restricted', hit.length === 3, hit.length);
  for (const id of ring) {
    const u = db.prepare('SELECT restricted_until, restrict_level, strikes, redeem_mult, restrict_reason FROM users WHERE id=?').get(id);
    check('  #' + id + ' is read-only', u.restricted_until > Date.now(), u.restricted_until);
    check('  #' + id + ' is on strike 1 → 24h', u.strikes === 1 && u.restrict_level === 1, `strikes=${u.strikes} level=${u.restrict_level}`);
    check('  #' + id + ' pays double to buy out', u.redeem_mult === 2, u.redeem_mult);
  }
  check('each is told why, in plain language', notes.length === 3 && /same coin/i.test(notes[0].msg), notes.length && notes[0].msg.slice(0, 60));

  // ── the 3-strike ladder is unchanged for a repeat ──
  const rep = ring[0];
  db.prepare('UPDATE users SET restricted_until = 0 WHERE id = ?').run(rep);  // pretend it expired
  fn.flagUser(rep, 'second offence', 2);
  let u = db.prepare('SELECT strikes, restrict_level, redeem_mult FROM users WHERE id=?').get(rep);
  check('a second offence is strike 2 → a week', u.strikes === 2 && u.restrict_level === 2, `strikes=${u.strikes} level=${u.restrict_level}`);
  db.prepare('UPDATE users SET restricted_until = 0 WHERE id = ?').run(rep);
  fn.flagUser(rep, 'third offence', 2);
  u = db.prepare('SELECT strikes, restrict_level, restricted_until FROM users WHERE id=?').get(rep);
  check('a third offence is strike 3 → permanent', u.strikes === 3 && u.restrict_level === 3 && u.restricted_until === 32503680000000, `strikes=${u.strikes} level=${u.restrict_level}`);

  // ── the signup cap ──
  check('two accounts on an IP still allows a third', fn.ipSignupBlocked(IP_A) === null || fn.accountsFromIp(IP_A) >= 3, fn.accountsFromIp(IP_A));
  const busy = 'idx_busy_' + Math.random().toString(16).slice(2);
  mkUser('__rg_b1__', busy); mkUser('__rg_b2__', busy);
  check('  ...a third account from one IP is allowed', fn.ipSignupBlocked(busy) === null, fn.accountsFromIp(busy) + ' existing');
  mkUser('__rg_b3__', busy);
  const blocked = fn.ipSignupBlocked(busy);
  check('  ...a fourth is refused', typeof blocked === 'string', blocked && blocked.slice(0, 60));
  check('  ...and is pointed at multi-wallet instead of a dead end', /wallets/i.test(blocked || ''));
  check('a missing IP never blocks signup', fn.ipSignupBlocked(null) === null, 'fails open — we never guess');
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  for (const id of made) {
    for (const t of ['calls', 'points_events', 'notifications', 'sessions']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM invite_codes WHERE owner_id=? OR user_id=?').run(id, id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_rg\\_%' ESCAPE '\\'").get().n;
  const strayCalls = db.prepare("SELECT COUNT(*) n FROM calls WHERE ip LIKE 'idx_%'").get().n;
  console.log('\ncleanup — users left:', left, '| stray calls:', strayCalls);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
