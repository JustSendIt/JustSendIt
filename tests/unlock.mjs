/* "Confirm it's you" once, then change settings — and the sign-ups that let people pick their @username first.
   Every cookie here is ISSUED BY THE API (register, login, wallet sign-up), because the unlock is granted at
   sign-in; a session inserted straight into the database is what a stolen, un-proved cookie looks like.
   Three accounts at most at any moment (the per-IP cap), one register call (the shared hourly budget).
   Everything made here is deleted in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DB_PATH, ETHERS, KEY_PATH, ROOT, SERVER_JS } from './_paths.mjs';
const { Wallet } = createRequire(import.meta.url)(ETHERS);

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const SRC = readFileSync(SERVER_JS, 'utf8');
const pub = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const AUTHJS = pub('auth.js'), PROFJS = pub('profile.js');
const DATA_KEY = Buffer.from(readFileSync(KEY_PATH, 'utf8').trim(), 'hex');
const IDX_KEY = createHmac('sha256', DATA_KEY).update('blind-index').digest();
const bidx = (v) => createHmac('sha256', IDX_KEY).update(String(v == null ? '' : v)).digest('hex');
const hex = (n) => randomBytes(n).toString('hex');
const tag = hex(3);
const made = { users: [], addrs: [] };

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(str) { let bits = 0, val = 0; const out = []; for (const c of str) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function totp(secret) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', b32decode(secret)).update(msg).digest(); const o = h[h.length - 1] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
// a TOTP step can be spent once; these flows need several codes inside one 30-second step
const freshStep = (uid) => db.prepare('UPDATE users SET twofa_last_step = 0 WHERE id = ?').run(uid);

async function api(p, opts = {}) {
  const cookie = [opts.pass || '', opts.sid ? 'sid=' + opts.sid : ''].filter(Boolean).join('; ');
  const r = await fetch(BASE + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  const sc = r.headers.get('set-cookie') || '';
  const sid = (/(?:^|[,\s])sid=([^;]+)/.exec(sc) || [])[1] || null;
  return { status: r.status, j, sid: sid && sid !== '' ? sid : null };
}
const sessionRow = (sid) => db.prepare('SELECT * FROM sessions WHERE token = ?').get(createHash('sha256').update(sid).digest('hex'));
const userByName = (n) => db.prepare('SELECT * FROM users WHERE username = ?').get(n);
async function signFor(w, purpose) {
  const n = await api('/api/auth/wallet/nonce?purpose=' + purpose + '&address=' + w.address.toLowerCase());
  return { address: w.address.toLowerCase(), signature: await w.signMessage(n.j.message) };
}
const near = (t, ms) => typeof t === 'number' && Math.abs(t - (Date.now() + ms)) < 120000;
function drop(id) {
  for (const t of ['sessions', 'identities', 'notifications', 'points_events', 'tracked_wallets', 'holder_state', 'api_keys', 'community_members']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {} }
  try { db.prepare('DELETE FROM invite_codes WHERE owner_id = ?').run(id); } catch {}
  try { db.prepare('UPDATE invite_codes SET user_id = NULL WHERE user_id = ?').run(id); } catch {}
  try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {}
  const i = made.users.indexOf(id); if (i >= 0) made.users.splice(i, 1);
}
/* A ticket, minted straight into invite_codes the way a redeemed-and-accepted one looks — the /api/gate/redeem
   door has a per-IP budget the whole run shares, and this suite runs near its end. One code, one account. */
const TOS_VERSION = (/const TOS_VERSION = '([^']+)'/.exec(SRC) || [])[1];
const passCodes = [];
function freshPass() {
  const code = 'ULTEST' + hex(4).toUpperCase(), tok = hex(24);
  db.prepare('INSERT INTO invite_codes (code, owner_id, created_at, used_at, pass, tos_at, tos_version) VALUES (?,NULL,?,?,?,?,?)')
    .run(code, Date.now(), Date.now(), createHash('sha256').update(tok).digest('hex'), Date.now(), TOS_VERSION);
  passCodes.push(code);
  return 'jsi_pass=' + tok + '; jsi_age=18';
}

try {
  /* ═══ 1. an email sign-up: the @username is chosen here, and the new account sets itself up unasked ═══ */
  const A = { name: '__ul_a_' + tag, email: '__ul_a_' + tag + '@example.com', pw: 'first-pass-' + tag };
  const passA = freshPass();
  const reg = await api('/api/auth/register', { method: 'POST', pass: passA, body: { username: A.name, email: A.email, password: A.pw } });
  check('email sign-up takes the @username the person chose', reg.status === 200 && reg.j && reg.j.username === A.name && reg.j.newAccount === true, reg.status + ' ' + JSON.stringify(reg.j));
  const uA = userByName(A.name); if (uA) made.users.push(uA.id);
  A.sid = reg.sid;
  const rowA = A.sid && sessionRow(A.sid);
  check('  ...and the session that made the account is unlocked for its setup (an hour)', rowA && near(rowA.sudo_until, 3600e3), rowA && rowA.sudo_until);
  let me = await api('/api/me', { sid: A.sid });
  check('/api/me says until when, and what unlocking takes', me.j && me.j.user && near(me.j.user.sudoUntil, 3600e3) && me.j.user.verifyNeeds && me.j.user.verifyNeeds.password === true && me.j.user.verifyNeeds.code === false && me.j.user.verifyNeeds.minutes === 30, JSON.stringify(me.j && me.j.user && me.j.user.verifyNeeds));
  let setup = await api('/api/2fa/totp/setup', { method: 'POST', sid: A.sid, body: {} });
  check('a new account turns on an authenticator with no password prompt (the page used to send no proof and fail)', setup.status === 200 && setup.j && setup.j.secret, setup.status + ' ' + (setup.j && setup.j.error));

  // lock it: now the same request asks for the one step, with a code the page acts on
  const lock = await api('/api/auth/verify', { method: 'DELETE', sid: A.sid });
  check('"Lock now" ends the window', lock.status === 200 && !sessionRow(A.sid).sudo_until);
  setup = await api('/api/2fa/totp/setup', { method: 'POST', sid: A.sid, body: {} });
  check('locked, a security change is refused with code need_verify (the page opens "confirm it’s you" and retries)', setup.status === 401 && setup.j && setup.j.code === 'need_verify', setup.status + ' ' + JSON.stringify(setup.j));
  const wrong = await api('/api/auth/verify', { method: 'POST', sid: A.sid, body: { password: 'not-it' } });
  check('a wrong password is a wrong answer (verify_failed), not "asked nothing"', wrong.status === 401 && wrong.j && wrong.j.code === 'verify_failed', JSON.stringify(wrong.j));
  const ok = await api('/api/auth/verify', { method: 'POST', sid: A.sid, body: { password: A.pw } });
  check('the password once unlocks the session for 30 minutes', ok.status === 200 && near(ok.j && ok.j.sudoUntil, 30 * 60e3), JSON.stringify(ok.j));
  const until1 = sessionRow(A.sid).sudo_until;
  setup = await api('/api/2fa/totp/setup', { method: 'POST', sid: A.sid, body: {} });
  db.prepare("UPDATE users SET holder_verified_at = ?, holder_state = 'ok' WHERE id = ?").run(Date.now(), uA.id);   // past the participation check, so the answer is about the window
  const mint = await api('/api/data/key', { method: 'POST', sid: A.sid, body: {} });
  const mintPastProof = mint.status !== 401 && !(mint.j && (mint.j.needsProof || mint.j.code === 'need_verify'));
  check('  ...and then every change goes through without asking again', setup.status === 200 && mintPastProof, setup.status + ' / data key ' + mint.status + ' ' + (mint.j && mint.j.error));
  check('  ...and using the window never extends it (a stolen cookie cannot keep it alive)', sessionRow(A.sid).sudo_until === until1);
  if (mint.j && mint.j.key) { try { db.prepare('DELETE FROM api_keys WHERE user_id = ?').run(uA.id); } catch {} }

  // a second device signs in with the password
  const login2 = await api('/api/auth/login', { method: 'POST', body: { identifier: A.name, password: A.pw } });
  check('sign-in works with the @username as well as the email', login2.status === 200 && login2.sid, login2.status + ' ' + JSON.stringify(login2.j));
  check('  ...but a sign-in on its own does NOT unlock security changes (a cookie lifted at login is not already unlocked)', login2.sid && !sessionRow(login2.sid).sudo_until);
  const loginEmail = await api('/api/auth/login', { method: 'POST', body: { identifier: A.email, password: A.pw } });
  check('  ...the email still works too', loginEmail.status === 200);
  const unlock2 = await api('/api/auth/verify', { method: 'POST', sid: login2.sid, body: { password: A.pw } });
  check('  ...that device confirms once, at its first change', unlock2.status === 200 && !!sessionRow(login2.sid).sudo_until);

  // turn the authenticator on from device 1: device 2's window was proved without it and closes
  freshStep(uA.id);
  const on = await api('/api/2fa/totp/enable', { method: 'POST', sid: A.sid, body: { code: totp(setup.j.secret) } });
  check('two-factor turns on with a code from the new app', on.status === 200, on.status + ' ' + (on.j && on.j.error));
  check('  ...the session that just proved the new factor stays unlocked', !!sessionRow(A.sid).sudo_until);
  check('  ...every OTHER session’s window closes', !sessionRow(login2.sid).sudo_until && !sessionRow(loginEmail.sid).sudo_until);
  me = await api('/api/me', { sid: A.sid });
  check('  ...and the step now asks for the password AND the code', me.j.user.verifyNeeds.password === true && me.j.user.verifyNeeds.code === true);

  await api('/api/auth/verify', { method: 'DELETE', sid: A.sid });
  const pwOnly = await api('/api/auth/verify', { method: 'POST', sid: A.sid, body: { password: A.pw } });
  check('with two-factor on, the password alone does not unlock', pwOnly.status === 401, JSON.stringify(pwOnly.j));
  freshStep(uA.id);
  const codeOnly = await api('/api/auth/verify', { method: 'POST', sid: A.sid, body: { code: totp(setup.j.secret) } });
  check('  ...nor does the code alone, on an account that has a password', codeOnly.status === 401, JSON.stringify(codeOnly.j));
  freshStep(uA.id);
  const both = await api('/api/auth/verify', { method: 'POST', sid: A.sid, body: { password: A.pw, code: totp(setup.j.secret) } });
  check('  ...the password and the code together do', both.status === 200 && both.j.sudoUntil > Date.now());

  // change the password with no old password (the window is the proof), then sign in with the new one
  const pw2 = 'second-pass-' + tag;
  const chpw = await api('/api/account/password', { method: 'POST', sid: A.sid, body: { password: pw2 } });
  check('inside the window a password changes without re-typing the old one', chpw.status === 200 && chpw.j && chpw.j.ok, chpw.status + ' ' + (chpw.j && chpw.j.error));
  check('  ...and the other devices are signed out', !sessionRow(login2.sid) && !sessionRow(loginEmail.sid));
  const loginNew = await api('/api/auth/login', { method: 'POST', body: { identifier: A.name, password: pw2 } });
  check('  ...the new password signs in (and two-factor still asks)', loginNew.status === 200 && loginNew.j && loginNew.j.twofa === 'totp' && loginNew.j.pending, JSON.stringify(loginNew.j));
  freshStep(uA.id);
  const door = await api('/api/auth/login/totp', { method: 'POST', body: { pending: loginNew.j && loginNew.j.pending, code: totp(setup.j.secret) } });
  check('  ...and finishing two-factor at sign-in signs in — still locked until the owner confirms', door.status === 200 && door.sid && !sessionRow(door.sid).sudo_until, door.status);

  // change the email the account signs in with
  const A2mail = '__ul_a2_' + tag + '@example.com';
  const chem = await api('/api/account/email/change', { method: 'POST', sid: A.sid, body: { email: A2mail } });
  check('the sign-in email can be changed', chem.status === 200, chem.status + ' ' + (chem.j && chem.j.error));
  const byNew = await api('/api/auth/login', { method: 'POST', body: { identifier: A2mail, password: pw2 } });
  const byOld = await api('/api/auth/login', { method: 'POST', body: { identifier: A.email, password: pw2 } });
  check('  ...the new email signs in, the old one no longer does', byNew.status === 200 && byOld.status === 401, byNew.status + ' / ' + byOld.status);

  // outside the window, changing the password still needs the old one (and now also the code)
  await api('/api/auth/verify', { method: 'DELETE', sid: A.sid });
  const bare = await api('/api/account/password', { method: 'POST', sid: A.sid, body: { password: 'third-pass-' + tag } });
  check('locked, a password change with no old password is "confirm it’s you", not a silent success', bare.status === 401 && bare.j && bare.j.code === 'need_verify', JSON.stringify(bare.j));

  drop(uA.id);   // section 1 is done: its account frees a slot under the per-IP cap

  /* ═══ 2. a wallet sign-up: @username first, an email + password optional ═══ */
  const W1 = Wallet.createRandom(); made.addrs.push(W1.address.toLowerCase());
  const early = await api('/api/auth/wallet/verify', { method: 'POST', body: { address: W1.address.toLowerCase(), signature: '0x' + '00'.repeat(65), intent: 'signup', username: 'x' } });
  check('a bad @username is refused BEFORE the wallet’s signature is spent', early.status === 400 && /username/.test((early.j && early.j.error) || ''), JSON.stringify(early.j));
  const passB = freshPass();
  const B = { name: '__ul_b_' + tag, email: '__ul_b_' + tag + '@example.com', pw: 'wallet-pass-' + tag };
  let s = await signFor(W1, 'signin');
  const wsu = await api('/api/auth/wallet/verify', { method: 'POST', pass: passB, body: { ...s, intent: 'signup', username: B.name, email: B.email, password: B.pw } });
  check('a wallet sign-up creates the account with the chosen @username', wsu.status === 200 && wsu.j && wsu.j.newAccount === true && wsu.j.username === B.name, wsu.status + ' ' + JSON.stringify(wsu.j));
  const uB = userByName(B.name); if (uB) made.users.push(uB.id);
  check('  ...not a placeholder (no "claim your handle" needed)', uB && uB.auto_named === 0);
  check('  ...with the optional email + password as a second way in', uB && !!db.prepare("SELECT 1 FROM identities WHERE user_id = ? AND type = 'email'").get(uB.id));
  check('  ...and an unlocked hour for its own setup', wsu.sid && near(sessionRow(wsu.sid).sudo_until, 3600e3));
  B.sid = wsu.sid;
  const bLogin = await api('/api/auth/login', { method: 'POST', body: { identifier: B.name, password: B.pw } });
  check('  ...so it can sign in without the wallet: @username + password', bLogin.status === 200 && bLogin.sid, bLogin.status + ' ' + JSON.stringify(bLogin.j));
  const pw2faBare = await api('/api/2fa/password/enable', { method: 'POST', sid: B.sid, body: {} });
  check('  ...password two-factor asks for the password even inside the window (a forgotten one would lock every door)', pw2faBare.status === 401 && !(pw2faBare.j && pw2faBare.j.code === 'need_verify'), JSON.stringify(pw2faBare.j));
  const pw2faWrong = await api('/api/2fa/password/enable', { method: 'POST', sid: B.sid, body: { password: 'not-it' } });
  const pw2fa = await api('/api/2fa/password/enable', { method: 'POST', sid: B.sid, body: { password: B.pw } });
  check('  ...a wrong one is refused, the right one turns it on (optional, straight after sign-up)', pw2faWrong.status === 401 && pw2fa.status === 200, pw2faWrong.status + ' / ' + pw2fa.status + ' ' + (pw2fa.j && pw2fa.j.error));
  db.prepare('UPDATE users SET twofa_method = NULL, twofa_enabled_at = NULL WHERE id = ?').run(uB.id);   // back off, for the sign-in checks below

  // the participation check is for creating things on the site — not for setting up your own profile
  const bio = await api('/api/profile', { method: 'POST', sid: B.sid, body: { bio: 'hello from ' + tag } });
  check('a new account can edit its own profile before the $SEND check (it used to be refused)', bio.status === 200 && bio.j && bio.j.user && bio.j.user.bio === 'hello from ' + tag, bio.status + ' ' + JSON.stringify(bio.j && (bio.j.error || bio.j.needsProof)));
  check('  ...but earns no points for it until the check passes', bio.j && bio.j.pointsEarned === 0, bio.j && bio.j.pointsEarned);
  const post = await api('/api/posts', { method: 'POST', sid: B.sid, body: { text: 'not yet' } });
  check('  ...posting still waits for the check', post.status === 403 && post.j && post.j.needsProof === true, post.status);
  const pic = await api('/api/profile/image', { method: 'POST', sid: B.sid, body: { kind: 'avatar', remove: true } });
  check('  ...and so do profile pictures (uploads, like any other)', pic.status === 403 && pic.j && pic.j.needsProof === true, pic.status);

  /* ═══ 3. signing in with a wallet the site has never seen, ticket in hand: pick a name, no second signature ═══ */
  const W2 = Wallet.createRandom(); made.addrs.push(W2.address.toLowerCase());
  s = await signFor(W2, 'signin');
  const noPass = await api('/api/auth/wallet/verify', { method: 'POST', body: { ...s, intent: 'signin' } });
  check('without a ticket, an unknown wallet gets the ticket — not a name prompt', noPass.status === 403 && noPass.j && noPass.j.code === 'need_invite', JSON.stringify(noPass.j));
  const passC = freshPass();
  s = await signFor(W2, 'signin');
  const ask = await api('/api/auth/wallet/verify', { method: 'POST', pass: passC, body: { ...s, intent: 'signin' } });
  check('with a ticket, it is asked for a @username instead of being given a placeholder', ask.status === 200 && ask.j && ask.j.needUsername === true && ask.j.signup && !ask.sid, JSON.stringify(ask.j));
  const C = { name: '__ul_c_' + tag };
  const fin = await api('/api/auth/wallet/signup', { method: 'POST', pass: passC, body: { signup: ask.j && ask.j.signup, username: C.name } });
  check('  ...naming it creates the account — no second signature', fin.status === 200 && fin.j && fin.j.username === C.name && fin.j.newAccount === true && fin.sid, fin.status + ' ' + JSON.stringify(fin.j));
  const uC = userByName(C.name); if (uC) made.users.push(uC.id);
  check('  ...owned by that wallet, named, and unlocked for its setup', uC && uC.auto_named === 0 && !!db.prepare("SELECT 1 FROM identities WHERE user_id = ? AND type = 'wallet' AND identifier = ?").get(uC.id, bidx(W2.address.toLowerCase())) && fin.sid && near(sessionRow(fin.sid).sudo_until, 3600e3));
  const replay = await api('/api/auth/wallet/signup', { method: 'POST', pass: passC, body: { signup: ask.j && ask.j.signup, username: '__ul_c2_' + tag } });
  check('  ...and the hand-off token works once', replay.status === 401, replay.status);

  // an email that already belongs to someone is not answered with a refusal a ticket holder could repeat
  const W4 = Wallet.createRandom(); made.addrs.push(W4.address.toLowerCase());
  const passE = freshPass();
  s = await signFor(W4, 'signin');
  const E = { name: '__ul_e_' + tag };
  const taken = await api('/api/auth/wallet/verify', { method: 'POST', pass: passE, body: { ...s, intent: 'signup', username: E.name, email: B.email, password: 'another-pass-' + tag } });
  const uE = userByName(E.name); if (uE) made.users.push(uE.id);
  check('a wallet sign-up with an email already in use still makes the account — just without that email', taken.status === 200 && taken.j && taken.j.newAccount === true && taken.j.emailNotAdded === true && uE && !db.prepare("SELECT 1 FROM identities WHERE user_id = ? AND type = 'email'").get(uE.id), taken.status + ' ' + JSON.stringify(taken.j));
  check('  ...and the ticket is spent on it, so the question costs an account every time', !!db.prepare('SELECT 1 FROM invite_codes WHERE user_id = ?').get(uE && uE.id));
  if (uE) drop(uE.id);

  /* ═══ 4. wallets: a sign-in never unlocks; the confirm step takes a wallet that can vouch ═══ */
  s = await signFor(W1, 'signin');
  const w1in = await api('/api/auth/wallet/verify', { method: 'POST', body: { ...s, intent: 'signin' } });
  check('a wallet sign-in does not unlock security changes either', w1in.status === 200 && w1in.sid && !sessionRow(w1in.sid).sudo_until, w1in.status);
  // linking asks for the proof BEFORE the new wallet's signature is spent — so the same signature works after the step
  await api('/api/auth/verify', { method: 'DELETE', sid: B.sid });
  const W5 = Wallet.createRandom(); made.addrs.push(W5.address.toLowerCase());
  const s5 = await signFor(W5, 'link');
  const refused = await api('/api/auth/wallet/verify', { method: 'POST', sid: B.sid, body: s5 });
  check('linking a wallet on a locked session asks "confirm it’s you"', refused.status === 401 && refused.j && refused.j.code === 'need_verify', JSON.stringify(refused.j));
  await api('/api/auth/verify', { method: 'POST', sid: B.sid, body: { password: B.pw } });
  const retried = await api('/api/auth/wallet/verify', { method: 'POST', sid: B.sid, body: s5 });
  check('  ...and after the step the SAME signature links it (it was not spent by the refusal)', retried.status === 200 && retried.j && retried.j.linked === true, retried.status + ' ' + JSON.stringify(retried.j));

  // C is wallet-only: its founding wallet vouches, a wallet linked minutes ago does not
  s = await signFor(W2, 'signin');
  const c2 = await api('/api/auth/wallet/verify', { method: 'POST', body: { ...s, intent: 'signin' } });
  me = await api('/api/me', { sid: c2.sid });
  check('a wallet-only account is asked for a wallet signature, not a password', me.j && me.j.user.verifyNeeds.wallet === 'owner' && me.j.user.verifyNeeds.password === false && me.j.user.verifyNeeds.signInAgain === false, JSON.stringify(me.j && me.j.user.verifyNeeds));
  const m2 = await signFor(W2, 'manage');
  const cv = await api('/api/auth/verify', { method: 'POST', sid: c2.sid, body: m2 });
  check('  ...the founding wallet’s signature unlocks it', cv.status === 200 && !!sessionRow(c2.sid).sudo_until, JSON.stringify(cv.j));
  db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(Date.now() - 10 * 60e3, uC.id);   // an older account: a wallet linked now is not its founding wallet
  const W6 = Wallet.createRandom(); made.addrs.push(W6.address.toLowerCase());
  s = await signFor(W6, 'link');
  const l6 = await api('/api/auth/wallet/verify', { method: 'POST', sid: c2.sid, body: s });
  check('  ...inside the window another wallet links without a prompt', l6.status === 200 && l6.j && l6.j.linked === true, l6.status + ' ' + JSON.stringify(l6.j));
  await api('/api/auth/verify', { method: 'DELETE', sid: c2.sid });
  const m6 = await signFor(W6, 'manage');
  const cv6 = await api('/api/auth/verify', { method: 'POST', sid: c2.sid, body: m6 });
  check('  ...but a wallet linked minutes ago cannot vouch for the account yet', cv6.status === 401 && !sessionRow(c2.sid).sudo_until, JSON.stringify(cv6.j));

  /* ═══ 5. sessions that never proved anything: the old refusals stand ═══ */
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run('__ul_d_' + tag, Date.now(), '🧪', Date.now(), 'ok');
  const uD = userByName('__ul_d_' + tag); made.users.push(uD.id);
  const rawD = 'tok_ul_' + hex(8);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(rawD).digest('hex'), uD.id, Date.now(), Date.now() + 864e5);
  me = await api('/api/me', { sid: rawD });
  check('a social-login-only account is told that signing in again is its proof', me.j.user.sudoUntil === null && me.j.user.sudoLeftMs === 0 && me.j.user.verifyNeeds.signInAgain === true && me.j.user.verifyNeeds.none === true);
  const dv = await api('/api/auth/verify', { method: 'POST', sid: rawD, body: {} });
  check('  ...and asking it to confirm says so in words', dv.status === 401 && dv.j.code === 'need_verify' && /sign in again/.test(dv.j.error || ''), JSON.stringify(dv.j));
  const dmint = await api('/api/data/key', { method: 'POST', sid: rawD, body: {} });
  check('a session that never proved anything is still refused a data key, with the route’s own words', dmint.status === 401 && /to mint a data key/.test((dmint.j && dmint.j.error) || '') && dmint.j.code === 'need_verify', JSON.stringify(dmint.j));

  /* ═══ 6. the shape of it, in the source ═══ */
  check('the window lives on the session, NULL unless a sign-in or a proof wrote it', /ALTER TABLE sessions ADD COLUMN sudo_until INTEGER"/.test(SRC) && /INSERT INTO sessions \(token, user_id, created_at, expires_at, hashed, sudo_until\)/.test(SRC));
  check('the proof asks for the password AND the second factor', /if \(e && !\(await checkPassword\(String\(pick\('password'\)/.test(SRC) && /if \(me\.twofa_method && !\(me\.twofa_method === 'password' && e\)\)/.test(SRC));
  check('every change to how the account signs in closes the other sessions’ windows', (SRC.match(/sudoOthersOff\(me\);/g) || []).length >= 6);
  check('the possession proofs stay: arming a wallet still takes its own 2fa-on signature', /const proof = consumeNonce\(addr, b\.signature, '2fa-on'\)/.test(SRC) && /consumeNonce\(next, b\.newSignature, '2fa-on'\)/.test(SRC));
  check('the page retries a need_verify refusal once, after the step', /j\.code === 'need_verify' && !opts\._verified/.test(AUTHJS) && /_verified: true/.test(AUTHJS));
  check('a sign-in opens no window: only account creation and a social login with no other proof do', !/createSession\(u\.id, ipIdx\(req\), SUDO_MS\)/.test(SRC) && /createSession\(userId, ipIdxVal, !ident \? NEW_ACCOUNT_SUDO_MS : \(onlyProofIsSignIn\(userId, now\(\)\) \? SUDO_MS : 0\)\)/.test(SRC));
  check('a wallet sign-up hashes first, then gates and writes in one transaction (no race past the ticket or the per-IP cap)', /const pwHash = su && su\.email \? await hashPassword\(su\.password\) : null;[\s\S]{0,120}db\.exec\('BEGIN IMMEDIATE'\);[\s\S]{0,120}const gate = signupRefusal\(req\);/.test(SRC));
  check('the unlock reaches the page as time LEFT, so a skewed device clock cannot hold a stale window open', /sudoLeftMs: sudoActive\(me\) \? me\.sudo_until - now\(\) : 0/.test(SRC) && /me\.sudoLeftMs > 0 \? Date\.now\(\) \+ me\.sudoLeftMs/.test(AUTHJS));
  check('the data page answers need_verify with the step and one retry', /r\.j\.code === 'need_verify' && window\.AUTH && AUTH\.stepUp/.test(pub('data.js')));
  check('one wallet handler still — exactly one sign-in challenge in auth.js', (AUTHJS.replace(/\/\*[\s\S]*?\*\//g, '').match(/purpose=signin/g) || []).length === 1);
  check('no clear-text password prompt() left in the settings', !/prompt\(/.test(PROFJS));
  check('the unlink and two-factor-wallet requests nest the proof instead of spreading it over `address`', /body: \{ address, current \}/.test(PROFJS) && /body: \{ address, newSignature, current \}/.test(PROFJS));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  for (const id of made.users.slice()) drop(id);
  for (const a of made.addrs) { try { db.prepare('DELETE FROM wallet_challenges WHERE address = ?').run(bidx(a)); } catch {} }
  for (const c of passCodes) { try { db.prepare('DELETE FROM invite_codes WHERE code = ?').run(c); } catch {} }
  console.log('\ncleanup — throwaway users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_ul\\_%' ESCAPE '\\'").get().n);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
