/* Rocket Run for guests, and today's Rocket Riders board (owner, 2026-10-15: "Allow anyone not signed in to do one free rocket
   ride per day that allows them to put their name on the leader board of rocket riders and prompts them to create an account or
   stay as guest and if they choose to stay as guest keep their names on the leader board grey and boring").
   Drives the real server as signed-out browsers (each its own cookie jar and its own X-Forwarded-For, so the per-network cap is
   this suite's own), plus a few members made in the database. Throwaway rows only, removed at the end. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { ROOT, DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const read = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const SRC = readFileSync(SERVER_JS, 'utf8'), AJ = read('arcade.js'), ACSS = read('arcade.css'), CJ = read('compete.js'), PRIV = read('privacy.html'), KEYS = readFileSync(path.join(ROOT, 'lib', 'keys.js'), 'utf8');
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const madeUsers = [], madeSessions = [], guestKeys = new Set();
const NET = '10.88.' + (1 + (process.pid % 200)) + '.';   // this run's own networks

function mkUser(over) {
  if (over && over.id) {   // the moderator account the test server is told about: made here unless a run left one
    const had = db.prepare('SELECT id, username FROM users WHERE id = ?').get(over.id);
    if (had) { const raw = 'tok_adm_' + randomBytes(8).toString('hex'); db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(sha(raw), had.id, Date.now(), Date.now() + 864e5); madeSessions.push(sha(raw)); return { id: had.id, name: had.username, sid: raw }; }
  }
  const name = '__gr_' + randomBytes(3).toString('hex');
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  if (over && over.id) { db.prepare('UPDATE users SET id = ? WHERE id = ?').run(over.id, id); }
  const uid = (over && over.id) || id;
  madeUsers.push(uid);
  const raw = 'tok_' + name + '_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(sha(raw), uid, Date.now(), Date.now() + 864e5);
  return { id: uid, name, sid: raw };
}
// a browser: its own cookies (what the server sets, it keeps) and its own address
function browser(ip, opts = {}) {
  const jar = new Map(opts.age === false ? [] : [['jsi_age', '18']]);
  if (opts.sid) jar.set('sid', opts.sid);
  const b = {
    jar, ip,
    async call(method, p, body) {
      const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; '), Origin: BASE, 'X-Forwarded-For': ip }, body: body ? JSON.stringify(body) : undefined });
      const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      for (const c of set) { const m = /^([^=]+)=([^;]*)/.exec(c); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      if (jar.get('jsi_guest')) guestKeys.add(sha(jar.get('jsi_guest')));
      return { status: r.status, j, t, set };
    },
  };
  return b;
}
const rowOf = (id) => db.prepare('SELECT * FROM arcade_guest_rounds WHERE id = ?').get(id);
// a flight that will not blow for a while (or, with past, one that has): the crash point is the server's; the suite moves it
const setRound = (id, crashX, startedAgoMs) => db.prepare('UPDATE arcade_guest_rounds SET crash_x = ?, started_at = ? WHERE id = ?').run(crashX, Date.now() - (startedAgoMs || 0), id);
async function flyAndCash(b, crashX = 50, agoMs = 20000) {
  const s = await b.call('POST', '/api/arcade/guest/start', {});
  if (s.status !== 200) return { s };
  setRound(s.j.roundId, crashX, agoMs);
  const c = await b.call('POST', '/api/arcade/guest/cashout', { roundId: s.j.roundId });
  return { s, c, id: s.j.roundId };
}

try {
  /* ═══ one free flight a day, no account ═══ */
  const a = browser(NET + '1');
  const st0 = await a.call('GET', '/api/arcade/guest');
  check('a signed-out visitor is told today\'s guest flight is waiting', st0.status === 200 && st0.j && st0.j.flownToday === false && st0.j.round === null && st0.j.growth === 0.06, st0.t);
  const noAge = browser(NET + '1', { age: false });
  const na = await noAge.call('POST', '/api/arcade/guest/start', {});
  check('  ...flying waits for the 18+ answer, like the rest of the site', na.status === 403 && /18 or older/.test(na.t) && !noAge.jar.has('jsi_guest'), na.t);
  const s1 = await a.call('POST', '/api/arcade/guest/start', {});
  const ck = s1.set.find((c) => /^jsi_guest=/.test(c)) || '';
  check('the first flight starts, and the browser is given its guest cookie (HttpOnly, SameSite=Lax, a year)', s1.status === 200 && s1.j.roundId > 0 && s1.j.resumed === false && /HttpOnly/.test(ck) && /SameSite=Lax/.test(ck) && /Max-Age=31536000/.test(ck), s1.t + ' ' + ck);
  check('  ...and the crash point is not in the answer (it stays on the server, as for a member)', !/crash/i.test(s1.t), s1.t);
  const r1 = rowOf(s1.j.roundId);
  check('  ...the server keeps a hash of the cookie, never the cookie, and a keyed index of the address, never the address', r1 && r1.guest === sha(a.jar.get('jsi_guest')) && r1.guest !== a.jar.get('jsi_guest') && /^[0-9a-f]{64}$/.test(r1.ip || '') && !String(r1.ip).includes('10.88') && r1.crash_x >= 1, JSON.stringify(r1));
  const again = await a.call('POST', '/api/arcade/guest/start', {});
  check('a reload mid-flight picks the same flight back up', again.status === 200 && again.j.roundId === s1.j.roundId && again.j.resumed === true, again.t);
  setRound(s1.j.roundId, 50, 20000);
  const c1 = await a.call('POST', '/api/arcade/guest/cashout', { roundId: s1.j.roundId });
  check('a guest cashes out at the multiplier the server\'s clock says (about 3.3× twenty seconds in)', c1.status === 200 && c1.j.busted === false && c1.j.cashedX > 3.2 && c1.j.cashedX < 3.5 && c1.j.crashX === 50, c1.t);
  check('  ...and it pays nothing: no boost, no points, no account', !('boost' in c1.j) && !('mult' in c1.j) && !('pointsEarned' in c1.j), c1.t);
  const s2 = await a.call('POST', '/api/arcade/guest/start', {});
  check('one a day: a second flight is refused until 00:00 UTC (and the page is told why, by code)', s2.status === 429 && /today’s free guest flight/.test(s2.t) && s2.j.code === 'guest_flown', s2.t);
  const st1 = await a.call('GET', '/api/arcade/guest');
  check('  ...and the page is told how today\'s went (now the crash point may be shown)', st1.j && st1.j.flownToday === true && st1.j.round && st1.j.round.cashedX === c1.j.cashedX && st1.j.round.crashX === 50 && st1.j.round.name === null, st1.t);

  /* ═══ a name on the board ═══ */
  const member = mkUser();
  const bad = [];
  for (const [name, re] of [['ab', /3 to 24/], ['has space', /3 to 24/], ['x'.repeat(25), /3 to 24/], ['sendrh.com', /3 to 24/], ['JustSend1t', /unavailable/], ['JustSendIt_official', /unavailable/], ['Real_Admin', /unavailable/], ['SendRH-support', /unavailable/], ['deleted-12', /unavailable/], [member.name.toUpperCase(), /belongs to a member/], [member.name.replace(/_/g, '-'), /belongs to a member/]]) {
    const r = await a.call('POST', '/api/arcade/guest/name', { name });
    if (!(r.status === 400 && re.test(r.t))) bad.push(name + ' → ' + r.status + ' ' + r.t);
  }
  check('a guest\'s name: 3 to 24 letters, numbers, - or _ (no dots, so no web addresses), never the site\'s name, its staff, or a member\'s (any capitals, lookalike separators)', !bad.length, bad.join(' | '));
  const gname = 'Guest' + randomBytes(2).toString('hex');
  const n1 = await a.call('POST', '/api/arcade/guest/name', { name: gname });
  check('a cashed-out guest puts a name on today\'s board', n1.status === 200 && n1.j.name === gname && n1.j.rank >= 1, n1.t);
  const n2 = await a.call('POST', '/api/arcade/guest/name', { name: gname + 'x' });
  check('  ...once (it is not a way to rename on the board all day)', n2.status === 409 && /already on today/.test(n2.t), n2.t);
  let bd = await a.call('GET', '/api/arcade/board');
  const gRow = bd.j && bd.j.top.find((x) => x.guest && x.name === gname);
  check('the board lists the guest as a guest: the name, the cash-out, "guest" — nothing that names the browser or the network', gRow && gRow.guest === true && gRow.x === c1.j.cashedX && !('guest_key' in gRow) && !/"ip"|10\.88|jsi_guest/.test(bd.t) && !('username' in gRow), JSON.stringify(gRow));

  /* ═══ busts have no score ═══ */
  const b = browser(NET + '2');
  const sb = await b.call('POST', '/api/arcade/guest/start', {});
  setRound(sb.j.roundId, 1.2, 60000);                       // blew 57 s ago
  const cb = await b.call('POST', '/api/arcade/guest/cashout', { roundId: sb.j.roundId });
  check('a cash-out after the crash point is refused: that flight is over (settled as a bust)', cb.status === 409 || (cb.j && cb.j.busted === true), cb.t);
  const nb = await b.call('POST', '/api/arcade/guest/name', { name: 'Bust' + randomBytes(2).toString('hex') });
  check('  ...and a bust has nothing to put on the board', nb.status === 404 && /cashed out today/.test(nb.t), nb.t);
  const sw = await b.call('GET', '/api/arcade/guest');
  check('  ...the page is told it busted, and where', sw.j && sw.j.round && sw.j.round.busted === true && sw.j.round.crashX === 1.2, sw.t);

  /* ═══ the watch ends a guest flight at its crash point too ═══ */
  const w = browser(NET + '3');
  const sw1 = await w.call('POST', '/api/arcade/guest/start', {});
  const crashMs = (Math.log(1.6) / 0.06) * 1000;
  setRound(sw1.j.roundId, 1.6, crashMs - 1200);
  const t0 = Date.now();
  const wr = await w.call('GET', '/api/arcade/guest/watch?roundId=' + sw1.j.roundId);
  const took = Date.now() - t0;
  check('a guest\'s watch is answered when the rocket reaches its crash point, and the flight is settled as a bust', wr.status === 200 && wr.j && wr.j.over === true && wr.j.busted === true && wr.j.crashX === 1.6 && took >= 1000 && took < 2500 && rowOf(sw1.j.roundId).ended_at, took + 'ms ' + wr.t);
  const other = await a.call('GET', '/api/arcade/guest/watch?roundId=' + sw1.j.roundId);
  check('  ...and nobody else\'s browser can watch, or cash out, that flight', other.status === 404 && (await a.call('POST', '/api/arcade/guest/cashout', { roundId: sw1.j.roundId })).status === 404, other.t);

  /* ═══ clearing cookies is not another roll: five a day per address, twenty per IPv6 /48 ═══ */
  const ipx = NET + '4', got = [];
  let last = null;
  for (let i = 0; i < 6; i++) { const g = browser(ipx); last = await g.call('POST', '/api/arcade/guest/start', {}); got.push(last.status); }
  check('five guest flights a day from one address (a household), and a sixth fresh browser there is turned away, by code', got.slice(0, 5).every((x) => x === 200) && got[5] === 429 && last.j.code === 'guest_net_full' && !/sign in/i.test(last.j.error), got.join(',') + ' ' + last.t);
  const full = await browser(ipx).call('GET', '/api/arcade/guest');
  check('  ...and the page is told, before anyone taps, with the number', full.j && full.j.netFull === true && full.j.flownToday === false && full.j.perNetwork === 5, full.t);
  const v6 = [], P48 = '2001:db8:' + (process.pid % 9000).toString(16) + ':';
  for (let i = 0; i < 21; i++) v6.push((await browser(P48 + i.toString(16) + '::1').call('POST', '/api/arcade/guest/start', {})).status);
  check('  ...an IPv6 holder cannot rotate through /64s: twenty a day per /48', v6.slice(0, 20).every((x) => x === 200) && v6[20] === 429, v6.join(','));

  /* ═══ members: the board is opt-in, and a signed-in member flies as themselves ═══ */
  const m = browser(NET + '5', { sid: member.sid });
  const mg = await m.call('POST', '/api/arcade/guest/start', {});
  check('a signed-in member is not a guest (they fly as themselves)', mg.status === 409 && /fly as yourself/.test(mg.t) && (await m.call('GET', '/api/arcade/guest')).status === 409, mg.t);
  const day = r1.day;
  db.prepare('INSERT INTO arcade_rounds (user_id, day, started_at, crash_x, cashed_x, boost, ended_at) VALUES (?,?,?,?,?,?,?)').run(member.id, day, Date.now() - 60000, 40, 9.5, 3.13, Date.now() - 30000);
  bd = await m.call('GET', '/api/arcade/board');
  check('a member who cashed out is not listed just for flying', bd.j && !bd.j.top.some((x) => !x.guest && x.username === member.name), bd.t);
  const ms = await m.call('GET', '/api/arcade/state');
  check('  ...their page is told they cashed out today and are not on the board', ms.j && ms.j.cashedToday === true && ms.j.onBoard === false, ms.t);
  const on = await m.call('POST', '/api/arcade/board', { on: true });
  bd = await m.call('GET', '/api/arcade/board');
  const mRow = bd.j && bd.j.top.find((x) => !x.guest && x.username === member.name);
  check('  ...until they put @name up: then it shows as the member (their name, avatar, colours, badge)', on.status === 200 && on.j.onBoard === true && on.j.rank >= 1 && mRow && mRow.x === 9.5 && 'accent' in mRow && 'og' in mRow && mRow.avatar === '🧪', JSON.stringify(mRow) + ' ' + on.t);
  const ord = bd.j.top.map((x) => x.x);
  check('the board is best cash-out first', ord.every((v, i) => !i || ord[i - 1] >= v) && bd.j.top.every((x, i) => x.rank === i + 1), ord.join(','));
  const off = await m.call('POST', '/api/arcade/board', { on: false });
  bd = await m.call('GET', '/api/arcade/board');
  check('  ...and they can take it down again', off.status === 200 && off.j.onBoard === false && !bd.j.top.some((x) => !x.guest && x.username === member.name), off.t);
  check('  ...and their page says which: off', (await m.call('GET', '/api/arcade/state')).j.onBoard === false);
  const nobody = await browser(NET + '6').call('POST', '/api/arcade/board', { on: true });
  check('  ...a signed-out browser cannot put anyone up', nobody.status === 401, nobody.t);

  /* ═══ "create an account" / "sign in" from the prompt: the flight becomes theirs; "stay as guest" leaves it grey ═══ */
  const c = browser(NET + '7');
  const fc = await flyAndCash(c, 50, 25000);
  const cname = 'Kept' + randomBytes(2).toString('hex');
  await c.call('POST', '/api/arcade/guest/name', { name: cname });
  const joiner = mkUser();
  c.jar.set('sid', joiner.sid);
  await c.call('GET', '/api/me');
  check('signing in WITHOUT choosing it from the prompt does not take a guest flight (a shared computer\'s last guest stays theirs)', rowOf(fc.id).user_id == null);
  const sneak = await c.call('POST', '/api/arcade/guest/claim', {});
  check('  ...nor can a signed-in account take it by asking the server directly: only a flight its guest asked to keep, from the prompt', sneak.status === 200 && sneak.j.claimed === 0 && rowOf(fc.id).user_id == null, sneak.t);
  c.jar.delete('sid');
  await c.call('POST', '/api/arcade/guest/claim', {});
  const stay = await c.call('POST', '/api/arcade/guest/claim', { cancel: true });
  c.jar.set('sid', joiner.sid); await c.call('GET', '/api/me'); c.jar.delete('sid');
  check('"stay as guest" after asking to keep it cancels the keep: the next sign-in on this browser does not take it', stay.status === 200 && stay.j.cancelled === true && rowOf(fc.id).user_id == null && rowOf(fc.id).claim_until == null, stay.t);
  const ask = await c.call('POST', '/api/arcade/guest/claim', {});
  check('choosing "create an account" or "sign in" asks to keep it, for half an hour', ask.status === 200 && ask.j.minutes === 30 && rowOf(fc.id).claim_until > Date.now() + 29 * 60e3, ask.t);
  c.jar.set('sid', joiner.sid);
  const me = await c.call('GET', '/api/me');
  check('  ...and the account signed in next takes it (on its first /api/me)', me.status === 200 && rowOf(fc.id).user_id === joiner.id && rowOf(fc.id).claim_until == null, me.t.slice(0, 120));
  bd = await c.call('GET', '/api/arcade/board');
  check('  ...from then on it is on the board as @name, in colour — no longer a grey guest', bd.j.top.some((x) => !x.guest && x.username === joiner.name) && !bd.j.top.some((x) => x.guest && x.name === cname), bd.t);
  check('  ...a guest who chose to stay a guest is still grey, with "guest"', bd.j.top.some((x) => x.guest && x.name === gname));
  // one line a member: their best of the day, whether flown as a member or as a guest they kept
  db.prepare('INSERT INTO arcade_rounds (user_id, day, started_at, crash_x, cashed_x, boost, ended_at, on_board) VALUES (?,?,?,?,?,?,?,1)').run(joiner.id, day, Date.now() - 60000, 40, 1.5, 1.13, Date.now() - 50000);
  await m.call('POST', '/api/arcade/board', { on: true });   // (a write clears the board's five-second cache)
  bd = await c.call('GET', '/api/arcade/board');
  const jr = bd.j.top.filter((x) => !x.guest && x.username === joiner.name);
  check('one line a member: the guest flight they kept is their line for the day, never two', jr.length === 1 && jr[0].x === fc.c.j.cashedX, JSON.stringify(jr));
  const kst = await c.call('GET', '/api/arcade/state');
  check('  ...their page knows it is on the board through the kept flight', kst.j.cashedToday === true && kst.j.onBoard === true && kst.j.keptGuest === true, kst.t);
  const koff = await c.call('POST', '/api/arcade/board', { on: false });
  bd = await c.call('GET', '/api/arcade/board');
  check('  ...and the off switch takes that line down (and says so truthfully)', koff.status === 200 && koff.j.onBoard === false && !bd.j.top.some((x) => !x.guest && x.username === joiner.name), koff.t);
  const kon = await c.call('POST', '/api/arcade/board', { on: true });
  bd = await c.call('GET', '/api/arcade/board');
  check('  ...and back up again', kon.status === 200 && kon.j.onBoard === true && bd.j.top.some((x) => !x.guest && x.username === joiner.name), kon.t);
  // one kept flight a day per account: a second guest flight (another network, another browser) cannot be stacked onto @name
  const c2 = browser(NET + '11');
  const f2 = await flyAndCash(c2, 50, 40000);
  await c2.call('POST', '/api/arcade/guest/name', { name: 'Second' + randomBytes(2).toString('hex') });
  await c2.call('POST', '/api/arcade/guest/claim', {});
  c2.jar.set('sid', joiner.sid); await c2.call('GET', '/api/me');
  check('an account keeps at most one guest flight a day (no stacking rolls onto @name); the second stays a grey guest', rowOf(f2.id).user_id == null && rowOf(f2.id).claim_until == null);
  // not for an account that already flew that day as a member
  const flier = mkUser();
  db.prepare('INSERT INTO arcade_rounds (user_id, day, started_at, crash_x, cashed_x, boost, ended_at) VALUES (?,?,?,?,?,?,?)').run(flier.id, day, Date.now() - 60000, 40, 2, 1.25, Date.now() - 55000);
  const c3 = browser(NET + '12');
  const f3 = await flyAndCash(c3, 50, 40000);
  await c3.call('POST', '/api/arcade/guest/name', { name: 'Third' + randomBytes(2).toString('hex') });
  await c3.call('POST', '/api/arcade/guest/claim', {});
  c3.jar.set('sid', flier.sid); await c3.call('GET', '/api/me');
  check('  ...nor for an account that already flew today as a member', rowOf(f3.id).user_id == null);
  // nor once the half hour is up
  const c4 = browser(NET + '13');
  const f4 = await flyAndCash(c4, 50, 40000);
  await c4.call('POST', '/api/arcade/guest/name', { name: 'Fourth' + randomBytes(2).toString('hex') });
  await c4.call('POST', '/api/arcade/guest/claim', {});
  db.prepare('UPDATE arcade_guest_rounds SET claim_until = ? WHERE id = ?').run(Date.now() - 1000, f4.id);
  const late4 = mkUser();
  c4.jar.set('sid', late4.sid); await c4.call('GET', '/api/me'); await c4.call('POST', '/api/arcade/guest/claim', {});
  check('  ...nor after the 30 minutes, by /api/me or by asking', rowOf(f4.id).user_id == null);

  /* ═══ taking a name down ═══ */
  const d = browser(NET + '8');
  const fd = await flyAndCash(d);
  const dname = 'Gone' + randomBytes(2).toString('hex');
  await d.call('POST', '/api/arcade/guest/name', { name: dname });
  const rm = await d.call('POST', '/api/arcade/guest/name', { remove: true });
  bd = await d.call('GET', '/api/arcade/board');
  check('a guest can take their own name down', rm.status === 200 && rm.j.removed === true && !bd.j.top.some((x) => x.guest && x.name === dname), rm.t);
  const back = await d.call('POST', '/api/arcade/guest/name', { name: dname });
  check('  ...and it stays down for the day', back.status === 409 && /taken down/.test(back.t), back.t);
  const e = browser(NET + '9');
  await flyAndCash(e);
  const ename = 'Rude' + randomBytes(2).toString('hex');
  const en = await e.call('POST', '/api/arcade/guest/name', { name: ename });
  const eid = (db.prepare('SELECT id FROM arcade_guest_rounds WHERE name = ?').get(ename) || {}).id;
  const notAdmin = await m.call('POST', '/api/admin/arcade/rider', { guestId: eid });
  check('a member who is not a moderator cannot take a name down', en.status === 200 && eid > 0 && notAdmin.status === 404, notAdmin.t);
  const admin = mkUser({ id: 987654 });
  const ad = browser(NET + '10', { sid: admin.sid });
  const ar = await ad.call('POST', '/api/admin/arcade/rider', { guestId: eid });
  bd = await ad.call('GET', '/api/arcade/board');
  check('a moderator can take a guest\'s name off today\'s board', ar.status === 200 && !bd.j.top.some((x) => x.guest && x.name === ename), ar.t);
  await m.call('POST', '/api/arcade/board', { on: true });
  const am = await ad.call('POST', '/api/admin/arcade/rider', { username: member.name });
  bd = await ad.call('GET', '/api/arcade/board');
  check('  ...or a member\'s @name', am.status === 200 && !bd.j.top.some((x) => !x.guest && x.username === member.name), am.t);
  const again2 = await m.call('POST', '/api/arcade/board', { on: true });
  const mst = await m.call('GET', '/api/arcade/state');
  check('  ...and the member cannot put it straight back that day (their page says a moderator took it off)', again2.status === 403 && /moderator/.test(again2.t) && mst.j.boardOff === true, again2.t);

  /* ═══ a flight that took off before 00:00 UTC belongs to yesterday's board ═══ */
  const y = browser(NET + '14');
  const fy = await flyAndCash(y, 50, 30000);
  db.prepare("UPDATE arcade_guest_rounds SET day = 'yesterday' WHERE id = ?").run(fy.id);
  const yn = await y.call('POST', '/api/arcade/guest/name', { name: 'Late' + randomBytes(2).toString('hex') });
  check('a flight that took off before 00:00 UTC and cashed out after cannot go on today\'s board, and the page is told why', yn.status === 404 && /yesterday’s board/.test(yn.t), yn.t);

  /* ═══ the competitions card ═══ */
  const hub = await a.call('GET', '/api/competitions');
  const rr = hub.j && hub.j.rocketRun;
  check('the Rocket Run card carries the top three riders and the day\'s guest flights; its day totals still never say who flew', rr && Array.isArray(rr.riders) && rr.riders.length <= 3 && rr.guestFlightsToday >= 6 && typeof rr.flightsToday === 'number', JSON.stringify(rr && { riders: rr.riders, g: rr.guestFlightsToday }));

  /* ═══ the rest of the site ═══ */
  check('account deletion takes the guest flights an account kept; the export lists them (a crash point only once its flight is over)',
    /'arcade_rounds', 'arcade_guest_rounds', 'uploads'/.test(SRC) && /guestFlights: db\.prepare\('SELECT day, started_at, cashed_x, CASE WHEN ended_at IS NOT NULL THEN crash_x END crash_x/.test(SRC));
  check('the IP indexes are dropped after two days, an unclaimed guest flight after 30, and key rotation carries both indexes', /UPDATE arcade_guest_rounds SET ip = NULL, net = NULL WHERE \(ip IS NOT NULL OR net IS NOT NULL\) AND started_at < \?'\)\.run\(t - 2 \* DAY_MS\)/.test(SRC) && /DELETE FROM arcade_guest_rounds WHERE user_id IS NULL AND started_at < \?'\)\.run\(t - GUEST_KEEP_MS\)/.test(SRC) && /\{ t: 'arcade_guest_rounds', c: 'ip' \}, \{ t: 'arcade_guest_rounds', c: 'net' \}/.test(KEYS));
  check('the privacy page lists the guest cookie and what a guest flight keeps, and for how long', /<code>jsi_guest<\/code>/.test(PRIV) && /five guest flights a day per address and twenty per IPv6 \/48/.test(PRIV) && /“stay as guest” cancels that/.test(PRIV) && /loses its IP hash after two days and is deleted after 30 days/.test(PRIV));
  check('the page flies a guest through the guest routes, and a member through their own', /const API = \(k\) => \(S\.guest \? '\/api\/arcade\/guest\/' : '\/api\/arcade\/'\) \+ k;/.test(AJ) && /window\.api\(API\('start'\)/.test(AJ) && /window\.api\(API\('cashout'\)/.test(AJ) && /fetch\(API\('watch'\) \+ '\?roundId='/.test(AJ));
  check('  ...after a name goes up it prompts: create an account, sign in, or stay as guest', /data-arc="join"[^']*>🎟️ Create an account<\/button>/.test(AJ) && /data-arc="signin"[^']*>Sign in<\/button>/.test(AJ) && /data-arc="stay"[^']*>Stay as guest<\/button>/.test(AJ) && /As a guest your name stays grey and plain\./.test(AJ));
  check('  ...and a guest on the board is grey and plain, with "guest" written beside it (never colour alone)', /'<span class="arc-rider-name">' \+ esc\(r\.name\) \+ '<\/span><span class="arc-rider-tag">guest<\/span>'/.test(AJ)
    && /\.arc-rider--guest \.arc-rider-rank, \.arc-rider--guest \.arc-rider-name, \.arc-rider--guest \.arc-rider-x \{ color: var\(--text-dim\); font-weight: 400; \}/.test(ACSS) && /cmp-name cmp-name--guest">' \+ esc\(u\.name\) \+ '<\/span><span class="cmp-guest-tag">guest<\/span>/.test(CJ));
} catch (e) {
  check('the suite ran to the end', false, e && e.stack);
} finally {
  try {
    for (const g of guestKeys) db.prepare('DELETE FROM arcade_guest_rounds WHERE guest = ?').run(g);
    for (const t of madeSessions) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
    for (const id of madeUsers) {
      db.prepare('DELETE FROM arcade_guest_rounds WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM arcade_rounds WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    }
    const left = db.prepare('SELECT COUNT(*) n FROM arcade_guest_rounds WHERE guest IN (' + [...guestKeys].map(() => '?').join(',') + ')').get(...guestKeys).n;
    check('everything this suite made is gone', left === 0 && !madeUsers.some((id) => db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)), left);
  } catch (e) { check('cleanup', false, e && e.message); }
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
