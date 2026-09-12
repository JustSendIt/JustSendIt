/* The door, the invite tree, and the beta campaign. Throwaway accounts only; deleted in the finally
   block, and the seed code is restored so 12345 still works afterwards. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { DB_PATH } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = { users: [], codes: [] };

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j, setCookie: r.headers.get('set-cookie'), location: r.headers.get('location') };
}
const passOf = (sc) => { const m = /jsi_pass=([^;]+)/.exec(sc || ''); return m ? 'jsi_pass=' + m[1] : ''; };

/* Fixtures here start PAST the participation gate (holder_verified_at set): this suite is testing
   something other than the gate, and a fixture that trips it would be testing the gate by accident.
   proofgate.mjs is the suite that tests the gate itself. */

function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.users.push(id);
  const raw = 'tok_' + name + '_' + Math.random().toString(16).slice(2);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)')
    .run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: 'sid=' + raw };
}

try {
  /* ═══ THE SITE IS OPEN. THE DOOR IS ON JOINING. ═══
     The gate used to redirect every signed-out visitor — and every crawler — to gate.html, which closed
     the landing page and made every canonical, sitemap entry and og: tag unreachable. Reading is now
     open to everyone; the invite is enforced at the three doors that create an account. */
  for (const open of ['/', '/about.html', '/wall.html', '/newpairs.html', '/arcade.html', '/tracker.html', '/terms.html', '/robots.txt', '/sitemap.xml', '/healthz']) {
    const r = await fetch(BASE + open, { redirect: 'manual' });
    check('open to anyone: ' + open, r.status === 200, r.status + (r.headers.get('location') ? ' -> ' + r.headers.get('location') : ''));
  }
  const home = await fetch(BASE + '/', { redirect: 'manual' });
  const homeHtml = await home.text();
  check('  ...and the landing page still carries its SEO', /rel="canonical"/.test(homeHtml) && /og:title/.test(homeHtml) && /application\/ld\+json/.test(homeHtml));
  const apiOpen = await api('/api/posts');
  check('reading the API needs no invite either', apiOpen.status === 200, apiOpen.status);
  const gateOld = await fetch(BASE + '/gate.html', { redirect: 'manual' });
  const gateHtml = await gateOld.text();
  check('the old gate page is now a noindex pointer at the real site', /noindex/.test(gateHtml) && /invite=1/.test(gateHtml), gateOld.status);

  // ═══ but joining does not ═══
  const noCode = await api('/api/auth/register', { method: 'POST', body: { username: '__gt_nocode__', email: 'gtnc@example.com', password: 'password123' } });
  check('signing up with no invite is refused', noCode.status === 403 && noCode.j.code === 'need_invite', noCode.status + ' ' + (noCode.j && noCode.j.code));
  check('  ...and says so in a way the ticket can act on', /invite code/i.test(noCode.j.error || ''), noCode.j && noCode.j.error);

  // ═══ redeem ═══
  const bad1 = await api('/api/gate/redeem', { method: 'POST', body: { code: 'NOPE' } });
  check('a wrong code is refused', bad1.status !== 200 && /not one of ours/i.test(bad1.j.error || ''), bad1.j && bad1.j.error);
  const red = await api('/api/gate/redeem', { method: 'POST', body: { code: '12345' } });
  check('the seed code works', red.status === 200 && red.j.ok, red.status + ' ' + JSON.stringify(red.j));
  const pass = passOf(red.setCookie);
  check('  ...and sets a pass cookie', /^jsi_pass=/.test(pass));
  check('  ...HttpOnly', /HttpOnly/i.test(red.setCookie || ''));

  const halfWay = await api('/api/auth/register', { method: 'POST', cookie: pass, body: { username: '__gt_notos__', email: 'gtnt@example.com', password: 'password123' } });
  check('a code alone is NOT enough — the terms come first', halfWay.status === 403 && halfWay.j.code === 'need_tos', halfWay.status + ' ' + (halfWay.j && halfWay.j.code));

  const acc = await api('/api/gate/accept', { method: 'POST', cookie: pass, body: { age18: true } });
  check('accepting the terms opens the door', acc.status === 200 && acc.j.access);
  const joined = await api('/api/auth/register', { method: 'POST', cookie: pass, body: { username: '__gt_joined__', email: 'gtj@example.com', password: 'password123' } });
  check('  ...and the account can now be made', joined.status === 200 && joined.j.ok, joined.status + ' ' + (joined.j && joined.j.error || ''));
  if (joined.j && joined.j.username) { const r = db.prepare('SELECT id FROM users WHERE username=?').get(joined.j.username); if (r) made.users.push(r.id); }
  const spent = await api('/api/auth/register', { method: 'POST', cookie: pass, body: { username: '__gt_twice__', email: 'gt2@example.com', password: 'password123' } });
  check('  ...but that same code cannot make a SECOND account', spent.status === 403 && spent.j.code === 'code_spent', spent.status + ' ' + (spent.j && spent.j.code));

  const reuse = await api('/api/gate/redeem', { method: 'POST', body: { code: '12345' } });
  check('a used code cannot be used again', reuse.status !== 200 && /already been used/i.test(reuse.j.error || ''), reuse.j && reuse.j.error);

  // ═══ one code becomes ten ═══
  const u = mkUser('__gt_holder__');
  const inv = await api('/api/gate/invites', { cookie: u.sid });
  check('a signed-in account is given its own codes', inv.status === 200 && inv.j.ticket, inv.status);
  const t = inv.j.ticket;
  for (const c of t.codes) made.codes.push(c.code);
  check('  ...exactly ten of them', t.codes.length === 10, t.codes.length);
  check('  ...all unused', t.codesLeft === 10, t.codesLeft);
  check('  ...the ticket carries their number in line', t.number === u.id, t.number + ' vs user ' + u.id);
  check('  ...and their name', t.username === '__gt_holder__');
  check('  ...with the Gold OG deadline for the rocket', typeof t.goldEndsAt === 'number' && t.goldEndsAt > Date.now(), t.goldEndsAt && new Date(t.goldEndsAt).toISOString().slice(0, 10));
  const again = await api('/api/gate/invites', { cookie: u.sid });
  check('  ...asking twice does not mint more', again.j.ticket.codes.length === 10, again.j.ticket.codes.length);

  // a handed-out code admits someone else
  const child = await api('/api/gate/redeem', { method: 'POST', body: { code: t.codes[0].code } });
  check("a holder's code admits the next person", child.status === 200 && child.j.ok, child.status);
  const childPass = passOf(child.setCookie);
  await api('/api/gate/accept', { method: 'POST', cookie: childPass, body: { age18: true } });
  const childIn = await api('/', { cookie: childPass });
  check('  ...who then gets in', childIn.status === 200, childIn.status);
  const after = await api('/api/gate/invites', { cookie: u.sid });
  check('  ...and it shows as used on the inviter\'s ticket', after.j.ticket.codesLeft === 9, after.j.ticket.codesLeft);
  const usedRow = (after.j.ticket.codes || []).find(c => c.used);
  check('  ...a spent code has NO characters to copy', !!usedRow && usedRow.code === undefined && typeof usedRow.hint === 'string', JSON.stringify(usedRow));
  check('  ...and the ticket carries the Send ID under that name', after.j.ticket.sendId === u.id, after.j.ticket.sendId + ' vs ' + u.id);

  // ═══ the beta campaign ═══
  const beta = await api('/api/beta', { cookie: pass });
  check('the beta campaign is published', beta.status === 200 && beta.j.endsAt, beta.status);
  const silver = new Date(beta.j.endsAt).toISOString().slice(0, 10);
  check('  ...ending when Silver OG closes (2026-11-17)', silver === '2026-11-17', silver);
  check('  ...90 days after the first coin launched', Math.round((beta.j.endsAt - 1787157963000) / 864e5) === 90, Math.round((beta.j.endsAt - 1787157963000) / 864e5) + ' days');
  check('  ...top 10, badge worth 2x', beta.j.topN === 10 && beta.j.badgeMult === 2);
  check('  ...not settled yet', beta.j.settled === false && beta.j.over === false);

  // the badge's boost joins the additive stack
  db.prepare('UPDATE users SET points = 5000 WHERE id = ?').run(u.id);
  const noBadge = await api('/api/me', { cookie: u.sid });
  const before = noBadge.j.user.boost;
  db.prepare('UPDATE users SET beta_rank = 3 WHERE id = ?').run(u.id);
  const withBadge = await api('/api/me', { cookie: u.sid });
  const b2 = withBadge.j.user.boost;
  check('a beta badge shows in the boost breakdown', b2 && b2.beta === 2, JSON.stringify(b2));
  check('  ...and adds exactly +1 to the stack (it adds, never multiplies)',
    Math.abs((b2.total - before.total) - 1) < 0.001, before.total + ' -> ' + b2.total);
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  for (const id of made.users) {
    for (const t of ['sessions', 'points_events', 'notifications', 'posts', 'calls', 'identities']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM invite_codes WHERE owner_id=? OR user_id=?').run(id, id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  /* Restore the seed. The user-cleanup loop above deletes codes by owner_id OR user_id, and redeeming
     the seed binds it to the throwaway account that used it — so deleting that account took the seed row
     with it, and the test left the site with no way in until the next restart re-seeded it. Re-insert
     first, then clear its usage: a test must put the DB back exactly as it found it. */
  try { db.prepare('INSERT OR IGNORE INTO invite_codes (code, owner_id, created_at) VALUES (?,NULL,?)').run('12345', Date.now()); } catch {}
  try { db.prepare("UPDATE invite_codes SET used_at=NULL, pass=NULL, user_id=NULL, tos_at=NULL, tos_version=NULL WHERE code='12345'").run(); } catch {}
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_gt\\_%' ESCAPE '\\'").get().n;
  const codes = db.prepare('SELECT COUNT(*) n FROM invite_codes').get().n;
  const seed = db.prepare("SELECT used_at FROM invite_codes WHERE code='12345'").get();
  console.log('\ncleanup — users left:', left, '| codes in table:', codes, '| seed 12345 usable again:', seed && seed.used_at == null);
  db.close();
}
let pass2 = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass2++; }
console.log(`\n${pass2}/${results.length} passed`);
