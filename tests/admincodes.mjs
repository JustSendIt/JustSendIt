/* Admin invite codes (owner, 2026-10-16: "Generate me 100 active admin codes that are shown on the admin page similar to how
   the invite codes are shown on someone's profile, but only for the admin to give out to people. Still track who uses the
   code and the user names that sign up under the codes, and across the platform if a user signs up under a code and sets up
   a profile make that user name in that code sign up a hyperlink that take the user to that new user's profile page.")
   Drives the real HTTP API on the runner's throwaway server (admin = user 987654, which run.mjs names in ADMIN_USER_IDS):
   the first visit makes the hundred, a code is redeemed at the real gate and claimed by an account through the real claim
   path, and the list, the overview and a member's ticket are read back. The page's own rendering code is run too.
   Everything it creates it deletes. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import { ROOT, DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const PUB = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const CODESJS = PUB('admincodes.js'), INVITEJS = PUB('invite.js'), ADMINHTML = PUB('admin.html'), CSS = PUB('styles.css');
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const ADMIN_ID = 987654;
const made = [], startedAt = Date.now();
const sha = (t) => createHash('sha256').update(String(t)).digest('hex');
function mkUser(name, id, autoNamed) {
  db.prepare('DELETE FROM users WHERE username=?').run(name);
  if (id) db.prepare('INSERT INTO users (id, username, created_at, avatar, holder_verified_at, holder_state, auto_named) VALUES (?,?,?,?,?,?,?)').run(id, name, Date.now(), '🧪', Date.now(), 'ok', autoNamed ? 1 : 0);
  else db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state, auto_named) VALUES (?,?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok', autoNamed ? 1 : 0);
  const uid = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(uid);
  const raw = 'tok_' + name + '_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(sha(raw), uid, Date.now(), Date.now() + 864e5);
  return { id: uid, name, sid: raw, cookie: 'sid=' + raw };
}
/* The gate's redeem allows 20 an address every ten minutes, and the whole run shares the loopback address — sybiltest needs
   four of them late in the run. Redeems here come from a test address of their own (the throwaway server trusts the header
   from loopback), so this suite spends none of that budget. */
const OWN_IP = '198.51.100.' + (10 + Math.floor(Math.random() * 200));
async function api(p, opts = {}) {
  const r = await fetch(BASE + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(opts.ip ? { 'X-Forwarded-For': opts.ip } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined, redirect: 'manual' });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, cc: r.headers.get('cache-control') || '', setCookie: r.headers.get('set-cookie') || '' };
}
// a raw request: the path goes out exactly as written (fetch would tidy '/x/..//admincodes.js' first)
const raw = (method, p, cookie) => new Promise((resolve) => {
  const r = http.request({ host: 'localhost', port: PORT, method, path: p, headers: cookie ? { Cookie: cookie } : {} }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, text: b, cc: res.headers['cache-control'] || '' })); });
  r.on('error', () => resolve({ status: 0, text: '', cc: '' })); r.end();
});
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const passOf = (sc) => { const m = /jsi_pass=([^;]+)/.exec(sc || ''); return m ? 'jsi_pass=' + m[1] : ''; };
const before = new Set(db.prepare('SELECT code FROM invite_codes WHERE admin = 1').all().map((r) => r.code));

try {
  check('the throwaway server names the admin in ADMIN_USER_IDS (run.mjs)', /ADMIN_USER_IDS: '987654'/.test(readFileSync(path.join(ROOT, 'tests', 'run.mjs'), 'utf8')));
  const admin = mkUser('__ac_admin__', ADMIN_ID), member = mkUser('__ac_member__');

  /* ═══ 1. the admin's alone: the script and the route ═══ */
  const variants = [['GET', '/admincodes.js'], ['HEAD', '/admincodes.js'], ['POST', '/admincodes.js'], ['GET', '/AdminCodes.js'], ['GET', '/ADMINCODES.JS'], ['GET', '/.//admincodes.js'],
    ['GET', '/x/..//admincodes.js'], ['GET', '/%2e//admincodes.js'], ['GET', '/admincodes.js?v=1']];
  const leaked = [];
  for (const [who, cookie] of [['visitor', null], ['member', member.cookie]]) {
    for (const [m, pth] of variants) { const r = await raw(m, pth, cookie); if (r.status !== 404 || /api\/admin\/codes/.test(r.text)) leaked.push(who + ' ' + m + ' ' + pth + ' → ' + r.status); }
    const g = await api('/api/admin/codes', { cookie }), po = await api('/api/admin/codes', { method: 'POST', cookie, body: { confirm: 'MINT' } });
    if (g.status !== 404 || po.status !== 404) leaked.push(who + ' /api/admin/codes → ' + g.status + '/' + po.status);
  }
  check('the codes page script and its route are the admin\'s alone: a visitor and a member get 404 for every spelling and method, and nothing of the script', leaked.length === 0, leaked.join(' | '));
  const js = await raw('GET', '/admincodes.js', admin.cookie);
  check('  ...the admin gets the script, kept by nobody (private, no-store)', js.status === 200 && /\/api\/admin\/codes/.test(js.text) && /private/.test(js.cc) && /no-store/.test(js.cc), js.status + ' ' + js.cc);
  check('  ...the admin page shows the section and loads the script after auth.js and admin.js; every control has a tip',
    /<section class="card adm-ov adm-codes" id="adm-codes" hidden aria-labelledby="adm-codes-h">/.test(ADMINHTML) && ADMINHTML.indexOf('src="auth.js"') < ADMINHTML.indexOf('src="admincodes.js"') && ADMINHTML.indexOf('src="admin.js"') < ADMINHTML.indexOf('src="admincodes.js"')
    && [...ADMINHTML.slice(ADMINHTML.indexOf('id="adm-codes"'), ADMINHTML.indexOf('id="adm-tools"')).matchAll(/<button[^>]*>/g)].every((m) => /data-tip="/.test(m[0])));

  /* ═══ 2. the first visit makes the hundred ═══ */
  check('this database has no admin codes yet (run through tests/run.mjs: a throwaway database)', before.size === 0, before.size + ' already');
  const first = await api('/api/admin/codes', { cookie: admin.cookie });
  const c1 = (first.j && first.j.codes) || [];
  const rows = db.prepare('SELECT code, owner_id, used_at, user_id FROM invite_codes WHERE admin = 1').all();
  check('the admin\'s first visit makes 100 active codes, each one use, made by that admin', first.status === 200 && c1.length === 100 && first.j.counts.total === 100 && first.j.counts.unused === 100
    && rows.length === 100 && rows.every((r) => r.owner_id === ADMIN_ID && r.used_at == null && r.user_id == null) && c1.every((c) => c.state === 'unused' && c.madeBy === admin.name)
    && new Set(c1.map((c) => c.code)).size === 100 && c1.every((c) => /^[ACDEFGHJKLMNPQRTUVWXYZ2346789]{8}$/.test(c.code)) && /no-store/.test(first.cc), first.status + ' ' + c1.length + ' / ' + rows.length);
  const again = await api('/api/admin/codes', { cookie: admin.cookie });
  check('  ...and another visit makes none: still 100', again.status === 200 && again.j.codes.length === 100 && db.prepare('SELECT COUNT(*) n FROM invite_codes WHERE admin = 1').get().n === 100);
  const own = await api('/api/gate/invites', { cookie: admin.cookie });
  const ownCodes = (own.j && own.j.ticket && own.j.ticket.codes) || [];
  const adminSet = new Set(c1.map((c) => c.code));
  check('  ...they never show on the admin\'s own ticket, which still gets its usual member codes', own.status === 200 && ownCodes.length === 10 && ownCodes.every((c) => !adminSet.has(c.code)) && own.j.ticket.codesTotal === 10, ownCodes.length + ' on the ticket');

  /* ═══ 3. a code is used: entered at the gate, claimed by the account made with it ═══ */
  const pick = c1[0].code;
  const red = await api('/api/gate/redeem', { method: 'POST', ip: OWN_IP, body: { code: pick } });
  const pass = passOf(red.setCookie);
  check('an admin code lets someone in at the real gate, like any member\'s code', red.status === 200 && red.j && red.j.ok && !!pass, red.status + ' ' + JSON.stringify(red.j));
  const seedRule = /if \(row\.owner_id == null && !seedCodesOpen\(\)\) return bad\(res, 'that code is no longer active/.test(SRC) && /if \(r\.owner_id == null && !seedCodesOpen\(\)\) return \{ error: 'That invite code is no longer active/.test(SRC);
  check('  ...and keeps working after seed codes retire: they belong to the admin who made them, and only codes with no owner are retired', seedRule && rows.every((r) => r.owner_id != null));
  const mid = await api('/api/admin/codes', { cookie: admin.cookie });
  const pend = mid.j.codes.find((c) => c.code === pick);
  check('  ...the list shows it in progress the moment it is entered (the sign-up not finished yet)', pend && pend.state === 'pending' && pend.usedAt > startedAt - 1000 && !pend.by && mid.j.counts.pending === 1 && mid.j.counts.unused === 99, JSON.stringify(pend));
  const newbie = mkUser('__ac_newbie__', null, true);   // a wallet / social sign-up: an automatic name until they pick one
  const claimed = await api('/api/gate/invites', { cookie: newbie.cookie + '; ' + pass });   // the real claim path binds the redeemed pass to this account
  const bound = db.prepare('SELECT user_id FROM invite_codes WHERE code = ?').get(pick), inv = db.prepare('SELECT invited_by FROM users WHERE id = ?').get(newbie.id);
  check('  ...the account made with it is bound to the code, and its "invited by" is the admin', claimed.status === 200 && bound.user_id === newbie.id && inv.invited_by === ADMIN_ID, JSON.stringify({ bound, inv }));
  const readUsed = async () => (await api('/api/admin/codes', { cookie: admin.cookie })).j.codes.find((c) => c.code === pick);
  const u1 = await readUsed();
  check('  ...the list tracks who: their name and when they joined — not a link while the profile is not set up (an automatic name)',
    u1.state === 'used' && u1.by && u1.by.username === newbie.name && u1.by.link === null && u1.by.profile === false && u1.by.joinedAt > 0, JSON.stringify(u1.by));
  db.prepare('UPDATE users SET auto_named = 0 WHERE id = ?').run(newbie.id);   // what saving a username of their own does (below)
  const u2 = await readUsed();
  check('  ...once they set up a profile (a name of their own), their name is a link to their profile page', u2.by.link === '/u/' + encodeURIComponent(newbie.name) && u2.by.profile === true, JSON.stringify(u2.by));
  check('  ..."set up" is what the profile route does when someone saves a name of their own', /db\.prepare\('UPDATE users SET username = \?, auto_named = 0 WHERE id = \?'\)\.run\(uname, me\.id\)/.test(SRC));
  db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(Date.now(), newbie.id);
  const u3 = await readUsed();
  check('  ...an account erased since is said to be gone: no name, no link', u3.by.deleted === true && u3.by.username === null && u3.by.link === null, JSON.stringify(u3.by));
  db.prepare('UPDATE users SET deleted_at = NULL WHERE id = ?').run(newbie.id);
  // only the account made with it: someone who already had an account, signing in on a browser that entered a code, does not spend it
  const pick2 = c1[1].code;
  const old = mkUser('__ac_oldtimer__');
  db.prepare('UPDATE users SET created_at = ?, invited_by = ? WHERE id = ?').run(Date.now() - 864e5, member.id, old.id);   // joined yesterday, on a member's code
  const red3 = await api('/api/gate/redeem', { method: 'POST', ip: OWN_IP, body: { code: pick2 } });
  await api('/api/gate/invites', { cookie: old.cookie + '; ' + passOf(red3.setCookie) });   // the profile's invite card calls this for any signed-in account
  const notBound = db.prepare('SELECT user_id FROM invite_codes WHERE code = ?').get(pick2), kept = db.prepare('SELECT invited_by FROM users WHERE id = ?').get(old.id);
  check('  ...a code is bound only to the account made with it: an older account signing in on a browser that entered one does not spend it, nor change who invited it',
    red3.status === 200 && notBound.user_id == null && kept.invited_by === member.id, JSON.stringify({ red3: red3.status, notBound, kept }));
  // freed: entered over an hour ago and never turned into an account, it works again — the list and the overview agree
  db.prepare('UPDATE invite_codes SET used_at = ? WHERE code = ?').run(Date.now() - 2 * 3.6e6, pick2);
  const fr = (await api('/api/admin/codes', { cookie: admin.cookie })).j, frc = fr.codes.find((c) => c.code === pick2);
  const ov0 = (await api('/api/admin/overview', { cookie: admin.cookie })).j.invites;
  check('  ...a code entered over an hour ago with no account made is free again: unused in the list (marked freed) and in the overview alike',
    frc.state === 'unused' && frc.freed === true && frc.usedAt === null && fr.counts.pending === 0 && ov0.adminPending === 0 && ov0.adminUnused === fr.counts.unused, JSON.stringify({ frc, ov0 }));

  /* ═══ 4. across the platform: a member's ticket links the same way ═══ */
  const inviter = mkUser('__ac_inviter__');
  const t0 = await api('/api/gate/invites', { cookie: inviter.cookie });
  const mcode = t0.j.ticket.codes[0].code;
  const red2 = await api('/api/gate/redeem', { method: 'POST', ip: OWN_IP, body: { code: mcode } });
  const invitee = mkUser('__ac_invitee__');
  await api('/api/gate/invites', { cookie: invitee.cookie + '; ' + passOf(red2.setCookie) });
  const t1 = await api('/api/gate/invites', { cookie: inviter.cookie });
  const spent = t1.j.ticket.codes.find((c) => c.used);
  check('on a member\'s own ticket, a used code names who it let in, linked to their profile once it is set up',
    red2.status === 200 && spent && spent.usedBy === invitee.name && spent.usedByLink === '/u/' + encodeURIComponent(invitee.name) && !spent.code, JSON.stringify(spent));
  db.prepare('UPDATE users SET auto_named = 1 WHERE id = ?').run(invitee.id);
  const t2 = await api('/api/gate/invites', { cookie: inviter.cookie });
  const spent2 = t2.j.ticket.codes.find((c) => c.used);
  check('  ...and not linked while that profile is not set up', spent2 && spent2.usedBy === invitee.name && spent2.usedByLink === null, JSON.stringify(spent2));
  db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(Date.now(), invitee.id);
  const spent3 = (await api('/api/gate/invites', { cookie: inviter.cookie })).j.ticket.codes.find((c) => c.used);
  check('  ...and an account erased since is said to be gone, with no name and no link', spent3 && spent3.usedBy === null && spent3.usedByLink === null && spent3.usedByGone === true, JSON.stringify(spent3));
  check('an admin leaving (the account deleted, or voided at boot) never takes the admin codes with it: they are the site\'s, already handed out',
    /DELETE FROM invite_codes WHERE owner_id = \? AND user_id IS NULL AND admin = 0'\)\.run\(uid\)/.test(SRC) && /DELETE FROM invite_codes WHERE user_id IS NULL AND admin = 0 AND owner_id IN \(SELECT id FROM users WHERE deleted_at IS NOT NULL\)/.test(SRC)
    && !/DELETE FROM invite_codes WHERE owner_id = \? AND user_id IS NULL'\)/.test(SRC));

  /* ═══ 5. more codes: confirm it's you, a confirmation word, and a ceiling ═══ */
  const noSudo = await api('/api/admin/codes', { method: 'POST', cookie: admin.cookie, body: { confirm: 'MINT' } });
  check('making more needs "confirm it\'s you" (it lets more people in)', noSudo.status === 401 && noSudo.j && noSudo.j.code === 'need_verify', noSudo.status + ' ' + JSON.stringify(noSudo.j));
  db.prepare('UPDATE sessions SET sudo_until = ? WHERE token = ?').run(Date.now() + 5 * 6e4, sha(admin.sid));
  const noWord = await api('/api/admin/codes', { method: 'POST', cookie: admin.cookie, body: {} });
  const more = await api('/api/admin/codes', { method: 'POST', cookie: admin.cookie, body: { confirm: 'MINT' } });
  check('  ...and the word MINT; then it makes 100 more', noWord.status === 400 && more.status === 200 && more.j.codes.length === 200 && more.j.counts.unused === 199 && db.prepare('SELECT COUNT(*) n FROM invite_codes WHERE admin = 1').get().n === 200, noWord.status + ' / ' + more.status + ' ' + (more.j && more.j.codes && more.j.codes.length));
  const fill = db.prepare('INSERT INTO invite_codes (code, owner_id, created_at, admin) VALUES (?,?,?,1)');
  db.exec('BEGIN'); for (let i = 0; i < 750; i++) fill.run('ACTEST' + String(i).padStart(4, '0'), ADMIN_ID, Date.now()); db.exec('COMMIT');   // 950 in all
  const topUp = await api('/api/admin/codes', { method: 'POST', cookie: admin.cookie, body: { confirm: 'MINT' } });
  const over = await api('/api/admin/codes', { method: 'POST', cookie: admin.cookie, body: { confirm: 'MINT' } });
  check('  ...up to 1,000 in all: the last batch is cut to fit, and past that it says so', topUp.status === 200 && topUp.j.counts.total === 1000 && over.status === 409 && /the most there can be/.test(over.j.error || ''), topUp.status + ' ' + (topUp.j && topUp.j.counts && topUp.j.counts.total) + ' / ' + over.status);

  /* ═══ 6. the overview counts them apart from members' codes ═══ */
  const ov = await api('/api/admin/overview', { cookie: admin.cookie });
  const iv = ov.j && ov.j.invites;
  const memberRows = db.prepare("SELECT COUNT(*) n FROM invite_codes WHERE admin = 0 AND owner_id IS NOT NULL AND used_at IS NULL").get().n;
  check('the overview counts admin codes on their own (unused, in progress, used), not as members\' codes', iv && iv.adminUnused === 999 && iv.adminUsed === 1 && iv.adminPending === 0 && iv.memberUnused === memberRows, JSON.stringify(iv));

  /* ═══ 7. the page's own rendering, run ═══ */
  const whoSrc = CODESJS.slice(CODESJS.indexOf('  function who(by) {'), CODESJS.indexOf('  function render() {'));
  const pageEsc = new Function('return ' + (/  const esc = (\(v\) => [^\n]+);\n/.exec(CODESJS) || [])[1])();   // the page's own escaping, not a copy of it
  const R = new Function('esc', 'ago', 'data', whoSrc + '\nreturn { who, item };')(pageEsc, () => '5 min ago', { reclaimMinutes: 60 });
  const linked = R.item({ code: 'AAAA2222', state: 'used', by: { username: 'ann', link: '/u/ann', profile: true } });
  const plain = R.item({ code: 'AAAA2222', state: 'used', by: { username: 'sender_ab12cd', link: null, profile: false } });
  const gone = R.item({ code: 'AAAA2222', state: 'used', by: { deleted: true, username: null, link: null } });
  const evil = R.item({ code: 'AAAA2222', state: 'used', by: { username: '<img src=x onerror=1>', link: null } });
  const unused = R.item({ code: 'BBBB3333', state: 'unused' }), pending = R.item({ code: 'CCCC4444', state: 'pending', usedAt: 1 });
  check('the page draws a used code\'s person as a link to their profile, their name until it is set up, "deleted" for an erased account — and escapes every name',
    /used · <a href="\/u\/ann" data-tip="Opens their profile">@ann<\/a>/.test(linked) && /used · @sender_ab12cd <small>\(profile not set up yet\)<\/small>/.test(plain) && !/<a /.test(plain)
    && /an account since deleted/.test(gone) && !/<img/.test(evil) && /&lt;img/.test(evil), [linked, plain, gone].join(' | '));
  check('  ...an unused code is a button that copies it (with a tip); one entered but not finished says so; the people table lists who signed up, newest first',
    /<button class="adm-code" type="button" data-c="BBBB3333" data-label="copy" data-tip="Copies this unused code/.test(unused) && /sign-up not finished \(it frees up after 60 min\)/.test(pending));
  const rcSrc = INVITEJS.slice(INVITEJS.indexOf('  function renderCodes(t) {'), INVITEJS.indexOf('  function bindCopy(scope) {'));
  const inviteEsc = new Function('return ' + (/\n  const esc = (\(s\) => [^\n]+|\(v\) => [^\n]+);\n/.exec(INVITEJS) || /\n  function esc\([^)]*\) \{[^\n]+\}\n/.exec(INVITEJS) || ['', 'null'])[1])();
  const RC = new Function('esc', rcSrc + '\nreturn renderCodes;')(inviteEsc || ((v) => String(v)));
  const tk = RC({ codes: [{ used: true, usedBy: 'ann', usedByLink: '/u/ann', hint: 'AB••••••' }, { used: true, usedBy: 'sender_x', usedByLink: null, hint: 'CD••••••' }, { used: true, usedBy: null, usedByGone: true, hint: 'EF••••••' }, { used: true, usedBy: '<b>x</b>', usedByLink: null, hint: 'GH••••••' }] });
  check('  ...and a member\'s ticket draws the same: a link once the profile is set up, the name until then, escaped',
    /used · <a href="\/u\/ann">@ann<\/a>/.test(tk) && /used · @sender_x<\/span>/.test(tk) && /used · an account since deleted/.test(tk) && /@&lt;b&gt;x&lt;\/b&gt;/.test(tk) && !/<b>x<\/b>/.test(tk), tk);
  /* the whole page script, run against stand-ins for its elements: boot, render, filters, copy, the two-tap "make more",
     the ceiling, signing out */
  const T0 = Date.now();
  const FIX = { batch: 100, max: 1000, reclaimMinutes: 60, counts: { total: 5, unused: 2, pending: 1, used: 2 }, codes: [
    { code: 'AAAA2222', state: 'unused', freed: false }, { code: 'BBBB3333', state: 'unused', freed: true },
    { code: 'CCCC4444', state: 'pending', usedAt: T0 - 6e4 },
    { code: 'DDDD6666', state: 'used', usedAt: T0 - 7.2e6, by: { username: 'older', link: '/u/older', profile: true, joinedAt: T0 - 7e6 } },
    { code: 'EEEE7777', state: 'used', usedAt: T0 - 3.6e6, by: { username: 'sender_9f3a', link: null, profile: false, joinedAt: T0 - 3.5e6 } }] };
  function pageRig(o = {}) {
    const el = (id, attrs) => ({ id, innerHTML: '', textContent: '', hidden: true, disabled: false, attrs: Object.assign({}, attrs), on: {},
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; }, addEventListener(t, f) { this.on[t] = f; } });
    const ids = {}; for (const i of ['adm-codes', 'adm-codes-body', 'adm-codes-people', 'adm-codes-sum', 'adm-codes-status', 'adm-codes-mint', 'adm-codes-refresh']) ids[i] = el(i);
    const showBtns = ['unused', 'used', 'pending', 'all'].map((v) => el('s-' + v, { 'data-codes-show': v, 'aria-pressed': String(v === 'unused') }));
    const nSpans = ['unused', 'used', 'pending', 'total'].map((v) => el('n-' + v, { 'data-codes-n': v }));
    ids['adm-codes'].querySelectorAll = (q) => (q === '[data-codes-show]' ? showBtns : q === '[data-codes-n]' ? nSpans : []);
    const calls = [], timers = [], listeners = {};
    const AUTHs = { user: o.user === undefined ? { username: 'boss', admin: true } : o.user, ready: Promise.resolve() };
    const win = { AUTH: AUTHs, api: (p, op) => { calls.push((op && op.method) || 'GET'); return o.pending ? new Promise(() => {}) : Promise.resolve(JSON.parse(JSON.stringify((op && op.method === 'POST') ? (o.after || FIX) : (o.data || FIX)))); } };
    const doc = { getElementById: (i) => ids[i], addEventListener: (t, f) => { listeners[t] = f; }, createRange: () => ({ selectNodeContents() {} }) };
    new Function('window', 'document', 'AUTH', 'setTimeout', 'clearTimeout', 'navigator', 'getSelection', 'SFX', CODESJS)(win, doc, AUTHs,
      (f, ms) => { timers.push({ f, ms }); return timers.length; }, (n) => { if (timers[n - 1]) timers[n - 1].done = true; }, { clipboard: { writeText: () => Promise.resolve() } }, () => ({ removeAllRanges() {}, addRange() {} }), undefined);
    const fire = (t, ms) => timers.filter((x) => x.ms === ms && !x.done).forEach((x) => { x.done = true; x.f(); });
    return { ids, showBtns, nSpans, calls, timers, listeners, AUTH: AUTHs, fire, sec: ids['adm-codes'], body: ids['adm-codes-body'], people: ids['adm-codes-people'], sum: ids['adm-codes-sum'], mint: ids['adm-codes-mint'], status: ids['adm-codes-status'] };
  }
  const pg = pageRig(); await flush();
  const firstPaint = !pg.sec.hidden && pg.calls.join() === 'GET' && /2 of 5 unused · 2 signed up · 1 in progress · showing 2/.test(pg.sum.textContent)
    && (pg.body.innerHTML.match(/<button class="adm-code"/g) || []).length === 2 && /copy · freed again/.test(pg.body.innerHTML) && pg.nSpans.map((x) => x.textContent).join(' ') === '(2) (2) (1) (5)';
  const rowsOrder = [...pg.people.innerHTML.matchAll(/<tr><td>(.*?)<\/td>/g)].map((m) => m[1]);
  const table = rowsOrder.length === 2 && /sender_9f3a/.test(rowsOrder[0]) && /<a href="\/u\/older"/.test(rowsOrder[1]) && /<th scope="col">Signed up as<\/th>/.test(pg.people.innerHTML);
  pg.listeners['auth:change'](); await flush(); const once = pg.calls.length === 1;
  check('the page, run: an admin sees the section, read once (a repeat sign-in event does not read it again), the summary line, the unused codes to copy, and who signed up — newest first, linked once their profile is set up',
    firstPaint && table && once, JSON.stringify({ firstPaint, table, once, sum: pg.sum.textContent, rows: rowsOrder }));
  pg.showBtns[1].on.click(); const usedView = pg.showBtns[1].attrs['aria-pressed'] === 'true' && pg.showBtns[0].attrs['aria-pressed'] === 'false' && (pg.body.innerHTML.match(/is-used/g) || []).length === 2 && /showing 2/.test(pg.sum.textContent);
  const btn = { dataset: { c: 'AAAA2222', label: 'copy' }, _back: 0, querySelector: (q) => (q === '.adm-code-tag' ? tag : {}) }, tag = { textContent: 'copy' };
  const tap = () => pg.body.on.click({ target: { closest: () => btn } });
  await tap(); const copied = tag.textContent === 'copied ✓'; await tap(); pg.timers.filter((x) => x.ms === 2200 && !x.done).forEach((x) => { x.done = true; x.f(); });
  const restored = tag.textContent === 'copy';
  check('  ...the filters switch the list and say which is on; a copied code says so and goes back to its own label, however often it is tapped', usedView && copied && restored, JSON.stringify({ usedView, copied, restored: tag.textContent }));
  pg.mint.on.click(); await flush(); const asked = pg.calls.length === 1 && /Tap again to make 100 codes/.test(pg.mint.textContent);
  pg.timers.filter((x) => x.ms === 5000 && !x.done).forEach((x) => { x.done = true; x.f(); }); const lapsed = pg.mint.textContent === 'Make 100 more';
  pg.mint.on.click(); pg.mint.on.click(); await flush(); const made = pg.calls.join() === 'GET,POST' && /Done — 5 admin codes in all\./.test(pg.status.textContent);
  check('  ..."make more" takes two taps — the first only asks, and lapses after five seconds — then sends', asked && lapsed && made, JSON.stringify({ asked, lapsed, made, text: pg.mint.textContent, status: pg.status.textContent }));
  const fullFix = { ...FIX, counts: { total: 1000, unused: 0, pending: 0, used: 1000 }, codes: [] };
  const cap = pageRig({ data: fullFix }); await flush();
  check('  ...at the ceiling the button is off and the reason is on the page, not only in a tooltip; the empty list does not point at a button that cannot help',
    cap.mint.disabled && /the most there can be/.test(cap.status.textContent) && /Every code has been used\.<\/p>/.test(cap.body.innerHTML) && !/make more below/.test(cap.body.innerHTML), cap.status.textContent + ' | ' + cap.body.innerHTML);
  const wait = pageRig({ pending: true }); await flush(); wait.showBtns[2].on.click();
  const pressedEarly = wait.showBtns[2].attrs['aria-pressed'] === 'true' && wait.showBtns[0].attrs['aria-pressed'] === 'false';
  pg.AUTH.user = null; pg.listeners['auth:change']();
  const cleared = pg.sec.hidden && pg.body.innerHTML === '' && pg.people.innerHTML === '' && pg.sum.textContent === '' && pg.nSpans.every((x) => x.textContent === '');
  const nonAdmin = pageRig({ user: { username: 'pat', admin: false } }); await flush();
  check('  ...a filter answers while the list is still loading; signing out takes every code off the page; a non-admin never sees the section or asks for it',
    pressedEarly && cleared && nonAdmin.sec.hidden && nonAdmin.calls.length === 0, JSON.stringify({ pressedEarly, cleared, memberCalls: nonAdmin.calls }));
  check('  ...the grid is not a live region (it would read out every code on each redraw): one summary line is',
    /<p class="modal-note adm-codes-sum" id="adm-codes-sum" role="status" aria-live="polite"><\/p>\s*<div id="adm-codes-body"><\/div>/.test(ADMINHTML));
  check('  ...the styles keep every size above the text floor, give the linked name an underline, and make it a 44px target on a touch screen',
    /\.adm-code-tag a, \.adm-codes-table a \{ color: var\(--green-bright\); font-weight: 700; text-decoration: underline;/.test(CSS) && /\.inv-code\.is-used \.inv-tag a \{ color: inherit; font-weight: 800; text-decoration: underline;/.test(PUB('invite.css'))
    && [...CSS.slice(CSS.indexOf('/* admin invite codes (admincodes.js)'), CSS.indexOf('.adm-codes-more')).matchAll(/font-size:\s*([^;]+);/g)].every((m) => /^max\(var\(--text-floor\)/.test(m[1]))
    && /@media \(pointer: coarse\) \{ \.adm-code-tag a, \.adm-codes-table a \{ display: inline-flex; align-items: center; min-height: 44px; \} \}/.test(CSS) && /@media \(pointer: coarse\) \{ \.inv-code\.is-used \.inv-tag a \{ display: inline-flex; align-items: center; min-height: 44px; \} \}/.test(PUB('invite.css')));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  for (const id of made) {
    for (const t of ['sessions', 'notifications', 'points_events']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM invite_codes WHERE (owner_id=? AND admin = 0) OR user_id=?').run(id, id); } catch {}
    try { db.prepare('UPDATE users SET invited_by = NULL WHERE invited_by = ?').run(id); } catch {}
  }
  // the admin codes this run made (and the fillers), and nothing that was here before it
  const mine = db.prepare('SELECT code FROM invite_codes WHERE admin = 1').all().map((r) => r.code).filter((c) => !before.has(c));
  const del = db.prepare('DELETE FROM invite_codes WHERE code = ?');
  db.exec('BEGIN'); for (const c of mine) del.run(c); db.exec('COMMIT');
  for (const id of made) { try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {} }
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_ac\\_%' ESCAPE '\\'").get().n;
  const codesLeft = db.prepare('SELECT COUNT(*) n FROM invite_codes WHERE admin = 1').get().n;
  console.log('\ncleanup — users left:', left, '| admin codes left:', codesLeft, '(were ' + before.size + ')');
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
