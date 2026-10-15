/* 🚀 Sent It: the senders on a Send Call, and what other people say to each of them.
   Owner, 2026-10-15: "Fix the view of someone also Sent It so all the details show up properly across all responsive
   screens. Make sure the user name is horizontal not vertical. And allow other users to react to other senders on a
   send call, and also allow users to add a comment to someone else sending it".
   Calls and their Sent Its are inserted straight into the DB (a live call needs a price lookup and a wallet scan); the
   reactions and comments go through the real HTTP API. Everything made here is deleted in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH, ROOT, SERVER_JS } from './_paths.mjs';
const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const SRC = readFileSync(SERVER_JS, 'utf8');
const pub = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
let GATE = '';
const tag = randomBytes(3).toString('hex');
const made = { users: [], squads: [], calls: [], posts: [], sessions: [] };
const ADMIN_ID = 987654;
const api = async (p, opts = {}) => {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: [GATE, opts.sid ? 'sid=' + opts.sid : ''].filter(Boolean).join('; ') },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
function mkUser(name, opts = {}) {
  let id = opts.id;
  if (id && db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) { /* the admin account another suite left: reuse it */ }
  else {
    if (id) db.prepare('INSERT INTO users (id, username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?,?)').run(id, name, Date.now(), '🧪', opts.unproven ? null : Date.now(), 'ok');
    else db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', opts.unproven ? null : Date.now(), 'ok');
    id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
    made.users.push(id);
  }
  const raw = 'tok_' + name + '_' + randomBytes(6).toString('hex');
  const hashed = createHash('sha256').update(raw).digest('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(hashed, id, Date.now(), Date.now() + 864e5);
  made.sessions.push(hashed);
  return { id, sid: raw, name: db.prepare('SELECT username FROM users WHERE id = ?').get(id).username };
}
const TOK = '0x' + createHash('sha256').update('sentit-token' + tag).digest('hex').slice(0, 40);
function mkCall(uid, sym, hops, squadId) {   // a call, its widget post and its Sent Its, straight into the DB
  const r = db.prepare(`INSERT INTO calls (user_id, token_addr, pair_addr, symbol, name, entry_price, entry_mc, entry_liq, peak_price, cur_price, created_at, entry_spend_usd, squad_id)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid, TOK, '0x' + createHash('sha256').update('pair' + sym + tag).digest('hex').slice(0, 40), sym, sym + ' token', 0.001, 1e6, 5000, 0.003, 0.002, Date.now(), 250, squadId || null);
  const id = Number(r.lastInsertRowid); made.calls.push(id);
  const pr = squadId
    ? db.prepare('INSERT INTO posts (user_id, text, created_at, call_id, squad_id, private) VALUES (?,?,?,?,?,1)').run(uid, '📣 ' + sym, Date.now(), id, squadId)
    : db.prepare('INSERT INTO posts (user_id, text, created_at, call_id) VALUES (?,?,?,?)').run(uid, '📣 ' + sym, Date.now(), id);
  const postId = Number(pr.lastInsertRowid); made.posts.push(postId);
  db.prepare('UPDATE calls SET post_id = ? WHERE id = ?').run(postId, id);
  for (const h of hops) db.prepare('INSERT INTO call_hops (call_id, user_id, created_at, entry_price, spend_usd, bought_usd, held_usd) VALUES (?,?,?,?,?,?,?)').run(id, h.uid, Date.now() - (h.ago || 0), 0.001, h.spend, h.spend, h.spend);
  return { id, postId };
}
/* The pass this suite browses with, redeemed from a test address of its own. gatepass.mjs redeems from loopback, and
   every suite in a run shares that address's 20-tries-per-10-minutes budget on /api/gate/redeem; one more suite on it
   was enough to leave sybiltest without a pass. A pass is not tied to the address that redeemed it. */
let PASS_CODE = null;
async function suitePass() {
  PASS_CODE = 'TESTST' + randomBytes(3).toString('hex').toUpperCase();
  db.prepare('INSERT INTO invite_codes (code, owner_id, created_at) VALUES (?,NULL,?)').run(PASS_CODE, Date.now());
  const ip = '10.77.' + randomBytes(1)[0] + '.' + (1 + (randomBytes(1)[0] % 250));
  const post = (p, body, cookie) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body || {}) });
  const r = await post('/api/gate/redeem', { code: PASS_CODE });
  const m = /jsi_pass=([^;]+)/.exec(r.headers.get('set-cookie') || '');
  if (!m) throw new Error('gate pass not issued: ' + (await r.text()).slice(0, 120));
  await post('/api/gate/accept', {}, 'jsi_pass=' + m[1]);
  return 'jsi_pass=' + m[1] + '; jsi_age=18';
}
const senderPath = (callId, name) => '/api/calls/' + callId + '/senders/' + encodeURIComponent(name);
const sendersOf = async (callId, sid) => { const r = await api('/api/calls/' + callId + '/senders', { sid }); return (r.j && r.j.senders) || []; };
const rowFor = (list, name) => list.find((s) => s.username === name);
const pts = (uid, ref) => db.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount), 0) a FROM points_events WHERE user_id = ? AND ref = ?').get(uid, ref);
const notifs = (uid, actor) => db.prepare('SELECT * FROM notifications WHERE user_id = ? AND actor_id = ? ORDER BY id').all(uid, actor);

try {
  GATE = await suitePass();
  const A = mkUser('__st_a_' + tag), B = mkUser('__st_b_' + tag), C = mkUser('__st_c_' + tag), D = mkUser('__st_d_' + tag), E = mkUser('__st_e_' + tag), F = mkUser('__st_f_' + tag);
  const NOPROOF = mkUser('__st_np_' + tag, { unproven: true });
  const SYM = 'ST' + tag.slice(0, 3).toUpperCase();
  const call = mkCall(A.id, SYM, [{ uid: B.id, spend: 1234, ago: 2 * 36e5 }, { uid: C.id, spend: 300 }]);

  /* ═══ 1. what each sender row carries ═══ */
  const v0 = await api('/api/calls/' + call.id, { sid: D.sid });
  const s0 = v0.j && v0.j.call && v0.j.call.senders || [];
  const b0 = rowFor(s0, B.name);
  check('every sender row carries its 🔥/🚀 counts, which are yours, and how many comments', v0.status === 200 && b0 && b0.reactions && b0.reactions.fire === 0 && b0.reactions.rocket === 0 && Array.isArray(b0.myReactions) && b0.myReactions.length === 0 && b0.comments === 0, v0.status + ' ' + JSON.stringify(b0));
  check('  ...and still no user id leaves the server (rows are keyed by name)', s0.every((s) => !('_uid' in s) && !('id' in s) && !('user_id' in s) && !('hopper_id' in s)), JSON.stringify(Object.keys(b0 || {})));
  check('  ...with the details the row shows: entry MC, amount (rounded for others, marked so), PNL, holding, and when they Sent It', b0 && b0.entryMc > 0 && b0.sentUsd === 1200 && b0.rounded === true && b0.senderX != null && b0.holding === true && b0.sentAt > 0, JSON.stringify(b0));

  /* ═══ 2. reacting ═══ */
  const out = await api(senderPath(call.id, B.name) + '/react', { method: 'POST', body: { kind: 'fire' } });
  check('signed out, a reaction is refused with 401', out.status === 401, out.status);
  const np = await api(senderPath(call.id, B.name) + '/react', { method: 'POST', sid: NOPROOF.sid, body: { kind: 'fire' } });
  check('an account that has not proved it holds is held at the participation gate (403 needsProof), like every other reaction', np.status === 403 && np.j && np.j.needsProof === true, np.status + ' ' + JSON.stringify(np.j));
  const nobody = await api(senderPath(call.id, D.name) + '/react', { method: 'POST', sid: C.sid, body: { kind: 'fire' } });
  check('a name that did not Send It on this call is 404', nobody.status === 404, nobody.status);
  const junk = await api(senderPath(call.id, '<script>') + '/react', { method: 'POST', sid: C.sid, body: { kind: 'fire' } });
  check('  ...as is a name no account could have', junk.status === 404, junk.status);
  const noCall = await api(senderPath(99999999, B.name) + '/react', { method: 'POST', sid: C.sid, body: { kind: 'fire' } });
  check('  ...and a call that does not exist', noCall.status === 404, noCall.status);

  const r1 = await api(senderPath(call.id, B.name) + '/react', { method: 'POST', sid: C.sid, body: { kind: 'fire' } });
  check('C reacts 🔥 to B’s Sent It: on, counted', r1.status === 200 && r1.j.kind === 'fire' && r1.j.on === true && r1.j.count === 1, r1.status + ' ' + JSON.stringify(r1.j));
  const giveRef = 'hopreact:' + call.id + ':' + B.id + ':' + C.id + ':fire', getRef = 'hopreactget:' + call.id + ':' + B.id + ':' + C.id;
  check('  ...the post rules pay: C the reaction kind, B the received kind (their own refs, never a post’s)', pts(C.id, giveRef).n === 1 && pts(B.id, getRef).n === 1 && r1.j.pointsEarned === pts(C.id, giveRef).a, JSON.stringify([pts(C.id, giveRef), pts(B.id, getRef), r1.j.pointsEarned]));
  const n1 = notifs(B.id, C.id);
  check('  ...and B hears about it: a social row from C that names the token and links to the call', n1.length === 1 && n1[0].kind === 'social' && n1[0].href === '/p/' + call.postId && n1[0].post_id === call.postId && n1[0].text === '@' + C.name + ' reacted 🔥 to your Sent It on $' + SYM + '.', JSON.stringify(n1));
  const r2 = await api(senderPath(call.id, B.name) + '/react', { method: 'POST', sid: C.sid, body: { kind: 'fire' } });
  const r3 = await api(senderPath(call.id, B.name) + '/react', { method: 'POST', sid: C.sid, body: { kind: 'fire' } });
  check('a second tap takes it back; a third puts it back — and pays nothing more', r2.j.on === false && r2.j.count === 0 && r3.j.on === true && r3.j.count === 1 && r3.j.pointsEarned === 0 && pts(C.id, giveRef).n === 1 && pts(B.id, getRef).n === 1, JSON.stringify([r2.j, r3.j]));
  const r4 = await api(senderPath(call.id, B.name.toUpperCase()) + '/react', { method: 'POST', sid: D.sid, body: { kind: 'rocket' } });
  check('🚀 is its own reaction; the name is matched in any case', r4.status === 200 && r4.j.kind === 'rocket' && r4.j.on && r4.j.count === 1, r4.status + ' ' + JSON.stringify(r4.j));
  const r5 = await api(senderPath(call.id, B.name) + '/react', { method: 'POST', sid: D.sid, body: { kind: '💩' } });
  check('  ...and anything else is read as 🔥 (the post allow-list)', r5.status === 200 && r5.j.kind === 'fire', JSON.stringify(r5.j));
  const self = await api(senderPath(call.id, B.name) + '/react', { method: 'POST', sid: B.sid, body: { kind: 'rocket' } });
  check('B may react to their own Sent It, but it pays nothing and rings no bell', self.status === 200 && self.j.on && self.j.pointsEarned === 0 && pts(B.id, 'hopreact:' + call.id + ':' + B.id + ':' + B.id + ':rocket').n === 0 && notifs(B.id, B.id).length === 0, JSON.stringify(self.j));

  const sC = rowFor(await sendersOf(call.id, C.sid), B.name), sA = rowFor(await sendersOf(call.id, A.sid), B.name), sB = rowFor(await sendersOf(call.id, B.sid), B.name);
  check('the row now reads 🔥 2 🚀 2 for everyone; myReactions is each viewer’s own', sC && sC.reactions.fire === 2 && sC.reactions.rocket === 2 && sC.myReactions.join() === 'fire' && sA.myReactions.length === 0 && sB.myReactions.join() === 'rocket', JSON.stringify([sC, sA && sA.myReactions, sB && sB.myReactions]));
  check('  ...and the call post’s own reactions are untouched (separate tables, so no read path double-counts)', db.prepare('SELECT COUNT(*) n FROM reactions WHERE post_id = ?').get(call.postId).n === 0);
  const rowC = rowFor(await sendersOf(call.id, D.sid), C.name);
  check('  ...and C’s row (nobody reacted to it) still reads zero', rowC && rowC.reactions.fire === 0 && rowC.reactions.rocket === 0 && rowC.comments === 0, JSON.stringify(rowC));

  /* ═══ 3. commenting ═══ */
  const g0 = await api(senderPath(call.id, B.name) + '/comments');
  check('anyone inside the door can read a sender’s thread of a public call (empty to start)', g0.status === 200 && Array.isArray(g0.j.comments) && g0.j.comments.length === 0 && g0.j.count === 0, g0.status + ' ' + JSON.stringify(g0.j));
  const c0 = await api(senderPath(call.id, B.name) + '/comments', { method: 'POST', body: { text: 'hi' } });
  check('signed out, a comment is refused with 401', c0.status === 401, c0.status);
  const cNp = await api(senderPath(call.id, B.name) + '/comments', { method: 'POST', sid: NOPROOF.sid, body: { text: 'hi' } });
  check('  ...and an unproven account is held at the gate (403 needsProof)', cNp.status === 403 && cNp.j && cNp.j.needsProof === true, cNp.status);
  const cEmpty = await api(senderPath(call.id, B.name) + '/comments', { method: 'POST', sid: C.sid, body: { text: '   ' } });
  check('  ...an empty comment is refused', cEmpty.status === 400, cEmpty.status + ' ' + JSON.stringify(cEmpty.j));
  const c1 = await api(senderPath(call.id, B.name) + '/comments', { method: 'POST', sid: C.sid, body: { text: 'Nice entry ' + tag } });
  const cid1 = c1.j && c1.j.comment && c1.j.comment.id;
  check('C comments under B’s Sent It: the row comes back, marked as theirs, and the count', c1.status === 200 && c1.j.comment && c1.j.comment.text === 'Nice entry ' + tag && c1.j.comment.username === C.name && c1.j.comment.mine === true && Array.isArray(c1.j.comment.tokens) && c1.j.count === 1, c1.status + ' ' + JSON.stringify(c1.j));
  check('  ...paid as a comment (its own ref)', pts(C.id, 'hopcomment:' + cid1).n === 1 && c1.j.pointsEarned === pts(C.id, 'hopcomment:' + cid1).a, JSON.stringify(pts(C.id, 'hopcomment:' + cid1)));
  const n2 = notifs(B.id, C.id).filter((n) => n.icon === '💬');
  check('  ...and B is told, with the opening words and a link to the call', n2.length === 1 && n2[0].text === '@' + C.name + ' commented on your Sent It on $' + SYM + ': “Nice entry ' + tag + '”' && n2[0].href === '/p/' + call.postId, JSON.stringify(n2));
  const long = '🚀'.repeat(350);
  const c2 = await api(senderPath(call.id, B.name) + '/comments', { method: 'POST', sid: D.sid, body: { text: long } });
  const stored = c2.j && c2.j.comment && c2.j.comment.text;
  check('a comment is cut at 300 characters, never through the middle of an emoji', c2.status === 200 && stored && Array.from(stored).length === 300 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(stored), c2.status + ' ' + (stored && Array.from(stored).length));
  const gA = await api(senderPath(call.id, B.name) + '/comments', { sid: A.sid });
  check('the thread reads oldest first, and nobody else’s comment is marked as yours', gA.status === 200 && gA.j.comments.length === 2 && gA.j.comments[0].id === cid1 && gA.j.comments.every((c) => c.mine === false) && gA.j.count === 2 && gA.j.comments.every((c) => !('user_id' in c)), JSON.stringify(gA.j.comments.map((c) => [c.id, c.mine])));
  check('  ...and the sender row counts both', rowFor(await sendersOf(call.id, A.sid), B.name).comments === 2);

  /* ═══ 4. mutes ═══ */
  for (const m of [D, E]) db.prepare('INSERT INTO mutes (user_id, muted_id, created_at) VALUES (?,?,?)').run(B.id, m.id, Date.now());
  const gB = await api(senderPath(call.id, B.name) + '/comments', { sid: B.sid });
  check('B muted D: D’s comment is gone from B’s view of the thread, and from the count B sees', gB.j.comments.length === 1 && gB.j.comments[0].id === cid1 && gB.j.count === 1 && rowFor(await sendersOf(call.id, B.sid), B.name).comments === 1, JSON.stringify(gB.j));
  // E has never rung B's bell, so neither the 10-minute duplicate rule nor the three-per-actor cap can be what keeps it quiet
  const eR = await api(senderPath(call.id, B.name) + '/react', { method: 'POST', sid: E.sid, body: { kind: 'rocket' } });
  const eC = await api(senderPath(call.id, B.name) + '/comments', { method: 'POST', sid: E.sid, body: { text: 'still here ' + tag } });
  check('  ...and B muted E: E’s reaction and comment still count, but neither reaches B’s bell', eR.status === 200 && eR.j.on && eC.status === 200 && notifs(B.id, E.id).length === 0, eR.status + ' ' + eC.status + ' ' + notifs(B.id, E.id).length);
  for (const m of [D, E]) db.prepare('DELETE FROM mutes WHERE user_id = ? AND muted_id = ?').run(B.id, m.id);

  /* ═══ 5. a squad call's senders are the squad's business ═══ */
  const sq = db.prepare("INSERT INTO squads (creator_id, name, bio, gate_kind, member_count, created_at) VALUES (?,?,?,?,2,?)").run(A.id, 'Sent It squad ' + tag, '', 'none', Date.now());
  const sqid = Number(sq.lastInsertRowid); made.squads.push(sqid);
  for (const u of [A, B, F]) db.prepare("INSERT INTO squad_members (squad_id, user_id, joined_at, role, verified, check_at) VALUES (?,?,?,?,1,?)").run(sqid, u.id, Date.now(), u === A ? 'owner' : 'member', Date.now());
  const scall = mkCall(A.id, SYM + 'Q', [{ uid: B.id, spend: 50 }], sqid);
  const outR = await api(senderPath(scall.id, B.name) + '/react', { method: 'POST', sid: D.sid, body: { kind: 'fire' } });
  const outG = await api(senderPath(scall.id, B.name) + '/comments', { sid: D.sid });
  const outP = await api(senderPath(scall.id, B.name) + '/comments', { method: 'POST', sid: D.sid, body: { text: 'peek' } });
  const outAnon = await api(senderPath(scall.id, B.name) + '/comments');
  check('outside the squad, every verb on a squad call’s sender is 404 (the call does not exist for them)', outR.status === 404 && outG.status === 404 && outP.status === 404 && outAnon.status === 404, [outR.status, outG.status, outP.status, outAnon.status].join(','));
  const inR = await api(senderPath(scall.id, B.name) + '/react', { method: 'POST', sid: A.sid, body: { kind: 'rocket' } });
  const inP = await api(senderPath(scall.id, B.name) + '/comments', { method: 'POST', sid: A.sid, body: { text: 'squad says gm ' + tag } });
  check('a member reacts and comments as usual', inR.status === 200 && inR.j.on && inP.status === 200 && inP.j.count === 1, inR.status + ' ' + inP.status);
  const sqN = notifs(B.id, A.id);
  check('  ...and the bell links to the squad’s Calls tab, never to a permalink outsiders cannot open', sqN.length >= 2 && sqN.every((n) => n.href === '/squad?id=' + sqid + '#calls'), JSON.stringify(sqN.map((n) => n.href)));
  // B is paused by the squad's gate (or leaves): the Sent It stays on the call, but nothing said about it may reach B now
  db.prepare('UPDATE squad_members SET verified = 0 WHERE squad_id = ? AND user_id = ?').run(sqid, B.id);
  const nB = notifs(B.id, A.id).length;
  const pausedC = await api(senderPath(scall.id, B.name) + '/comments', { method: 'POST', sid: A.sid, body: { text: 'members only ' + tag } });
  const pausedR = await api(senderPath(scall.id, B.name) + '/react', { method: 'POST', sid: F.sid, body: { kind: 'fire' } });   // F has never reacted to B: a first reaction would pay B
  check('a sender outside the squad now (paused or left) is told nothing: no comment text, no reactor names in their bell', pausedC.status === 200 && pausedR.status === 200 && notifs(B.id, A.id).length === nB && notifs(B.id, F.id).length === 0, nB + ' → ' + notifs(B.id, A.id).length + ' · F ' + notifs(B.id, F.id).length);
  check('  ...and earns no points from inside a squad they cannot read (the reactor still gets theirs)', pts(B.id, 'hopreactget:' + scall.id + ':' + B.id + ':' + F.id).n === 0 && pts(F.id, 'hopreact:' + scall.id + ':' + B.id + ':' + F.id + ':fire').n === 1, JSON.stringify([pts(B.id, 'hopreactget:' + scall.id + ':' + B.id + ':' + F.id), pts(F.id, 'hopreact:' + scall.id + ':' + B.id + ':' + F.id + ':fire')]));
  db.prepare('UPDATE squad_members SET verified = 1 WHERE squad_id = ? AND user_id = ?').run(sqid, B.id);
  const sqLive = await api('/api/calls/live?ids=' + scall.id, { sid: D.sid });
  check('  ...and the squad call (with its reaction counts) is absent from an outsider’s live read', sqLive.status === 200 && sqLive.j.calls.length === 0, JSON.stringify(sqLive.j));

  /* ═══ 6. moderation ═══ */
  const rep = await api('/api/report', { method: 'POST', sid: A.sid, body: { kind: 'hopcomment', id: cid1, reason: 'test ' + tag } });
  check('a comment under a Sent It can be reported', rep.status === 200 && rep.j.ok, rep.status + ' ' + JSON.stringify(rep.j));
  const sqCid = inP.j && inP.j.comment && inP.j.comment.id;
  const repOut = await api('/api/report', { method: 'POST', sid: D.sid, body: { kind: 'hopcomment', id: sqCid } });
  check('  ...but not one an outsider cannot see (a squad call’s): 404, never an existence oracle', repOut.status === 404, repOut.status);
  // a second comment from C that starts with the same words, seconds later: its bell row must survive the takedown of the first
  const twin = await api(senderPath(call.id, B.name) + '/comments', { method: 'POST', sid: C.sid, body: { text: 'Nice entry ' + tag + ' and then some' } });
  const twinRow = () => db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND actor_id = ? AND icon = '💬' AND instr(text, ?) > 0").get(B.id, C.id, 'and then some');
  const ADM = mkUser('__st_adm_' + tag, { id: ADMIN_ID });
  const list = await api('/api/admin/reports', { sid: ADM.sid });
  const mine = list.j && list.j.reports && list.j.reports.find((r) => r.kind === 'hopcomment' && r.target_id === cid1);
  check('the moderators’ list shows it: the words, who wrote it, and whose Sent It it was under', list.status === 200 && mine && mine.target && mine.target.text === 'Nice entry ' + tag && mine.target.username === C.name && mine.target.sender === B.name && mine.target.callId === call.id, list.status + ' ' + JSON.stringify(mine && mine.target));
  const td = await api('/api/admin/takedown', { method: 'POST', sid: ADM.sid, body: { kind: 'hopcomment', id: cid1, note: 'test' } });
  check('  ...a takedown removes it, closes the report and tells the author', td.status === 200 && !db.prepare('SELECT 1 FROM hop_comments WHERE id = ?').get(cid1) && db.prepare("SELECT action FROM reports WHERE kind = 'hopcomment' AND target_id = ?").get(cid1).action === 'takedown' && db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'alert' AND text LIKE 'A comment of yours was removed%'").get(C.id), td.status + ' ' + JSON.stringify(td.j));
  check('  ...and the sender’s bell no longer quotes the removed words', !db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND actor_id = ? AND icon = '💬' AND substr(text, -?) = ?").get(B.id, C.id, Array.from('“Nice entry ' + tag + '”').length, '“Nice entry ' + tag + '”'));
  check('  ...while the bell row of another comment that starts with the same words stays', twin.status === 200 && !!twinRow(), twin.status);
  const adminJs = pub('admin.js');
  check('  ...and the admin page draws the report and offers the takedown', /r\.kind === 'hopcomment'/.test(adminJs) && /r\.kind === 'comment' \|\| r\.kind === 'hopcomment'/.test(adminJs));

  /* ═══ 6b. a long thread ═══ */
  const ins = db.prepare('INSERT INTO hop_comments (call_id, hopper_id, user_id, text, tokens, created_at) VALUES (?,?,?,?,?,?)');
  for (let i = 1; i <= 105; i++) ins.run(call.id, C.id, D.id, 'bulk ' + i + ' ' + tag, '[]', Date.now());
  const big = await api(senderPath(call.id, C.name) + '/comments', { sid: A.sid });
  check('a thread past 100 comments shows its newest 100, oldest of those first, and says more exist', big.status === 200 && big.j.comments.length === 100 && big.j.comments[0].text === 'bulk 6 ' + tag && big.j.comments[99].text === 'bulk 105 ' + tag && big.j.count === 105 && big.j.more === true, big.status + ' ' + (big.j && [big.j.comments.length, big.j.comments[0] && big.j.comments[0].text, big.j.count, big.j.more].join(' | ')));
  db.prepare('DELETE FROM hop_comments WHERE call_id = ? AND hopper_id = ?').run(call.id, C.id);

  /* ═══ 7. lifecycle ═══ */
  db.prepare('DELETE FROM call_hops WHERE call_id = ? AND user_id = ?').run(call.id, B.id);
  check('when a Sent It goes, what was said about it goes with it (the foreign key cascades)', db.prepare('SELECT COUNT(*) n FROM hop_reactions WHERE call_id = ? AND hopper_id = ?').get(call.id, B.id).n === 0 && db.prepare('SELECT COUNT(*) n FROM hop_comments WHERE call_id = ? AND hopper_id = ?').get(call.id, B.id).n === 0);
  check('deleting an account clears its reactions and comments under Sent Its; the data export carries them', /'comments', 'hop_reactions', 'hop_comments', 'community_members'/.test(SRC) && /sendComments: db\.prepare\(/.test(SRC) && /sendReactions: db\.prepare\(/.test(SRC));
  check('the routes run the post gates in order: sign-in, the read-only gate, the shared react / comment rate buckets', /if \(blockReadOnly\(res, me\)\) return;\n          if \(isReact \? !rateLimit\('react:' \+ me\.id, 60, 6e5\) : !rateLimit\('cmt:' \+ me\.id, 25, 6e5\)\)/.test(SRC));

  /* ═══ 8. the page: the row, the buttons, the thread ═══ */
  const SC = pub('sendcall.js'), CSS = pub('styles.css');
  check('each sender row is three lines: who, what they did, and the 🔥 🚀 💬 controls (with a thread under it)', /<div class="sc-sender-main">/.test(SC) && /<div class="sc-sender-acts">/.test(SC) && /<div class="sc-thread" hidden><\/div>/.test(SC) && /class="sc-sender-when"/.test(SC));
  check('  ...the name never shrinks below its own width (that is what stood it on end), and only wraps when it is wider than the whole row', /\.sc-sender-who \{[^}]*flex: 1 0 auto;[^}]*max-width: 100%;/.test(CSS) && /\.sc-sender-stats > \* \{ flex: 0 0 auto; white-space: nowrap; \}/.test(CSS) && /\.sc-sender-stats \{[^}]*flex-wrap: wrap;/.test(CSS));
  check('  ...the layout follows the card’s own width (a container), not the window’s', /\.sc-senders \{[^}]*container: sc-senders \/ inline-size;/.test(CSS) && /@container sc-senders \(max-width: 34em\)/.test(CSS) && !/@media \(max-width: 540px\) \{ \.sc-sender \{/.test(CSS));
  check('the reaction buttons are toggles (aria-pressed), silent until the server answers, each with a description', /data-sreact="' \+ kind \+ '" data-sfx="none" aria-pressed="' \+ on \+ '"/.test(SC) && /data-tip="Reacts ' \+ emo \+ ' to @/.test(SC));
  check('  ...the comment toggle says whether it is open (aria-expanded), and the thread posts through a labelled form', /data-scmt aria-expanded="false" data-tip=/.test(SC) && /<form class="sc-thread-form" data-scmt-form>/.test(SC) && /<label class="sc-thread-lbl"><span class="sr-only">Comment on @/.test(SC));
  check('  ...the new attributes are not ones the wall handlers already catch (data-react, data-comments, data-vote, data-del)', !/class="sc-s?btn[^"]*"[^>]*data-(react|comments|vote|del)\b/.test(SC));
  check('a tap anywhere in the senders box never opens the token dashboard', /e\.target\.closest\('\.sc-actions, \.sc-detail, \.sc-explain, \.sc-senders, a, button, input, label, form'\)/.test(SC));
  check('the 12-second live refresh brings the same rows up to date in place, and redraws a new order only when nobody is using them', /top\.forEach\(\(s, i\) => patchSenderRow\(rows\[i\], s\)\)/.test(SC) && /else if \(!slist\.querySelector\('\.sc-thread:not\(\[hidden\]\), \[data-busy\]'\) && !slist\.contains\(document\.activeElement\)\)/.test(SC));
  check('  ...and never draws a payload asked for before this reader’s last reaction or comment', /const askedAt = Date\.now\(\);/.test(SC) && /updateWidget\(w, call, j\._askedAt\)/.test(SC) && /const stale = askedAt && Number\(sw\.dataset\.localAt \|\| 0\) > askedAt;/.test(SC));
  check('Show all / Show top 3 reopen an open thread on the new rows and put a half-typed comment back', /redrawRows\(list, \(wrap\._all \|\| \[\]\)\.slice\(0, 3\)\);/.test(SC) && /redrawRows\(list, wrap\._all\);/.test(SC) && /if \(inp && k\.draft && !inp\.value\) inp\.value = k\.draft;/.test(SC));
  check('a refusal at the holder-proof gate opens the wallet check (writes go through the shared api()), never only a toast', /if \(window\.api\) return window\.api\(path, \{ method: 'POST', body \}\);/.test(SC) && /if \(err && err\.needsProof\) return;/.test(SC));
  check('  ...a comment still posting is not handed back as a draft; the post reopens the redrawn thread once the server has answered', /!th\.querySelector\('\[data-scmt-form\]\[data-busy\]'\)/.test(SC) && /if \(liveTh && btn2 && liveTh\.hidden\) await openThread\(w, live, btn2, liveTh\);/.test(SC) && /!list\.querySelector\('\[data-cid="' \+ Number\(j\.comment\.id\) \+ '"\]'\)/.test(SC));
  check('  ...when a new order has to wait, every row still shown is brought up to date by name', /else top\.forEach\(\(s\) => \{ const li = rows\.find\(\(r\) => r\.dataset\.sender === s\.username\); if \(li\) patchSenderRow\(li, s\); \}\);/.test(SC));
  check('a long thread’s "newest N of M" note follows the count', /function syncMoreNote\(row, total\)/.test(SC) && /syncMoreNote\(li, s\.comments \|\| 0\);/.test(SC) && /if \(row\) syncMoreNote\(row, n\);/.test(SC));
  check('the ⚑ is its own column at the end of a comment, never inside the text it could cover', /'<\/div>' \+\n    \(c\.mine \? '' : '<button class="sc-cmt-report"/.test(SC) && !/margin-block: -10px/.test(CSS));
  check('the 🕒 is a picture to a screen reader, not "three o’clock"', /<span aria-hidden="true">🕒<\/span>/.test(SC));
  check('on a touch screen the comment field is 16px or more (iOS does not zoom) and the ⚑ is 44px both ways', /\.sc-thread-input \{ font-size: max\(var\(--text-floor\), max\(16px, 1em\)\); \}/.test(CSS) && /\.sc-cmt-report \{ min-width: 44px; min-height: 44px;/.test(CSS));
  check('your reaction shows in shape as well as colour, and in forced colours', /\.sc-sbtn\.on \{ border-width: 2px;/.test(CSS) && /@media \(forced-colors: active\) \{\n  \.sc-sbtn\.on, \.sc-sbtn\[aria-expanded="true"\] \{ background: Highlight; color: HighlightText;/.test(CSS));
  check('a comment’s report flag goes through the shared report handler, worded as a comment', /data-report="hopcomment" data-report-what="comment"/.test(SC) && /b\.dataset\.reportWhat \|\| kind/.test(pub('app.js')));
  check('the list says how it is ordered, truthfully (holders first, not "by how much they put in")', /aria-label="Others who Sent It: those still holding first/.test(SC) && !/ranked by how much they put in/.test(SC));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  for (const id of made.calls) {
    try { db.prepare('DELETE FROM hop_reactions WHERE call_id = ?').run(id); db.prepare('DELETE FROM hop_comments WHERE call_id = ?').run(id); db.prepare('DELETE FROM call_hops WHERE call_id = ?').run(id); } catch {}
    try { db.prepare("DELETE FROM reports WHERE kind = 'hopcomment'").run(); } catch {}
  }
  for (const id of made.posts) { try { db.prepare('DELETE FROM notifications WHERE post_id = ?').run(id); db.prepare('DELETE FROM posts WHERE id = ?').run(id); } catch {} }
  for (const id of made.calls) { try { db.prepare('DELETE FROM calls WHERE id = ?').run(id); } catch {} }
  for (const id of made.squads) { try { db.prepare('DELETE FROM squad_members WHERE squad_id = ?').run(id); db.prepare('DELETE FROM squads WHERE id = ?').run(id); } catch {} }
  for (const id of made.users) {
    for (const t of ['sessions', 'points_events', 'notifications', 'mutes', 'hop_reactions', 'hop_comments', 'call_hops', 'squad_members']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM reports WHERE reporter_id = ?').run(id); db.prepare('DELETE FROM notifications WHERE actor_id = ?').run(id); db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {}
  }
  for (const t of made.sessions) { try { db.prepare('DELETE FROM sessions WHERE token = ?').run(t); } catch {} }
  console.log('cleanup — throwaway users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_st\\_%' ESCAPE '\\'").get().n,
    '· sender reactions left:', db.prepare('SELECT COUNT(*) n FROM hop_reactions').get().n, '· sender comments left:', db.prepare('SELECT COUNT(*) n FROM hop_comments').get().n);
  if (PASS_CODE) { try { db.prepare('DELETE FROM invite_codes WHERE code = ?').run(PASS_CODE); } catch {} }
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
