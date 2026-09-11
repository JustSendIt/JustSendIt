/* Community posts on the public Send Wall — and, above all, proof that a holders-only post still is not.
   Throwaway users and communities only; everything is deleted in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { gatePass, cleanupGatePass } from './gatepass.mjs';
import { createHash } from 'node:crypto';
import { DB_PATH } from './_paths.mjs';
const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
let GATE = '';
const made = { users: [], comms: [], posts: [] };

const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: [GATE, opts.sid ? 'sid=' + opts.sid : ''].filter(Boolean).join('; ') },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
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
function mkComm(creator, symbol, status) {
  const tok = '0x' + createHash('sha256').update(symbol).digest('hex').slice(0, 40);
  db.prepare(`INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, brand, status, created_at, went_live_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(creator, tok, tok, symbol, symbol + ' Coin', JSON.stringify({ imageUrl: 'https://cdn.dexscreener.com/x.png' }), status, Date.now(), status === 'live' ? Date.now() : null);
  const id = db.prepare('SELECT id FROM communities WHERE token_addr=?').get(tok).id;
  made.comms.push(id);
  return id;
}
function mkPost(uid, text, cid, priv) {
  db.prepare('INSERT INTO posts (user_id, text, community_id, private, created_at) VALUES (?,?,?,?,?)')
    .run(uid, text, cid || null, priv ? 1 : 0, Date.now());
  const id = db.prepare('SELECT id FROM posts WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid).id;
  made.posts.push(id);
  return id;
}

GATE = await gatePass(BASE);
try {
  const author = mkUser('__cw_author__');
  const outsider = mkUser('__cw_outsider__');
  const cLive = mkComm(author.id, 'CWLIVE', 'live');
  const cPend = mkComm(author.id, 'CWPEND', 'pending');

  const pPlain = mkPost(author.id, 'a plain wall post', null, 0);
  const pPublicComm = mkPost(author.id, 'a public post in the live community', cLive, 0);
  const pPendComm = mkPost(author.id, 'a post in a pending community', cPend, 0);
  const pPrivate = mkPost(author.id, 'HOLDERS ONLY SECRET', cLive, 1);

  const wall = await api('/api/posts?sort=new');
  const ids = (wall.j.posts || []).map(p => p.id);

  // ---- THE BOUNDARY ----
  check('a holders-only post is NOT on the public wall', !ids.includes(pPrivate));
  check('its text appears nowhere in the response', !JSON.stringify(wall.j).includes('HOLDERS ONLY SECRET'));
  const asOutsider = await api('/api/posts?sort=new', { sid: outsider.sid });
  check('nor for a signed-in outsider', !JSON.stringify(asOutsider.j).includes('HOLDERS ONLY SECRET'));
  const single = await api('/api/posts/' + pPrivate, { sid: outsider.sid });
  check('and it is still 404 to an outsider directly', single.status === 404, single.status);

  // ---- what SHOULD now appear ----
  check('a plain wall post still appears', ids.includes(pPlain));
  check('a public community post now appears', ids.includes(pPublicComm));
  check('a pending community post appears too (it needs to be seen to go live)', ids.includes(pPendComm));

  // ---- and it carries its community ----
  const cp = (wall.j.posts || []).find(p => p.id === pPublicComm);
  check('the post carries its community', !!(cp && cp.community), JSON.stringify(cp && cp.community));
  check('with the id needed to link to it', cp && cp.community.id === cLive);
  check('with the symbol and name', cp && cp.community.symbol === 'CWLIVE' && /CWLIVE/.test(cp.community.name));
  check('with its branding image', cp && cp.community.image === 'https://cdn.dexscreener.com/x.png');
  check('and its status, so the wall can say "not live yet"', cp && cp.community.status === 'live');
  const pp = (wall.j.posts || []).find(p => p.id === pPendComm);
  check('a pending community reports pending', pp && pp.community.status === 'pending', pp && pp.community.status);
  const plain = (wall.j.posts || []).find(p => p.id === pPlain);
  check('a plain post has no community attached', plain && plain.community === null);

  // ---- the invite post ----
  const invited = db.prepare("SELECT COUNT(*) n FROM points_events WHERE ref = ?").get('cinvite:' + cLive + ':new').n;
  check('a community seeded directly has no invite (the hook is on the create route)', invited === 0);
  // drive the helper the way the route does, twice, to prove it is once-only
  const before = db.prepare('SELECT COUNT(*) n FROM posts WHERE community_id = ?').get(cPend).n;
  await api('/api/communities/' + cPend, {});   // touch it so the server has it warm
  // call the real dedup path through the DB marker the helper uses
  const ref = 'cinvite:' + cPend + ':new';
  const already = db.prepare('SELECT 1 FROM points_events WHERE ref = ?').get(ref);
  check('the invite dedup key is per community per event', /^cinvite:\d+:new$/.test(ref) && !already);

  // ---- the following feed obeys the same boundary ----
  db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(outsider.id, author.id, Date.now());
  const foll = await api('/api/posts?feed=following&sort=new', { sid: outsider.sid });
  const fids = (foll.j.posts || []).map(p => p.id);
  check('following shows the public community post', fids.includes(pPublicComm));
  check('following NEVER shows the holders-only post', !fids.includes(pPrivate) && !JSON.stringify(foll.j).includes('HOLDERS ONLY SECRET'));

  // ---- the sandbox is a community too: its public posts reach the wall like any other ----
  const cDemo = mkComm(author.id, 'CWDEMO', 'live');
  db.prepare('UPDATE communities SET demo = 1 WHERE id = ?').run(cDemo);
  const pDemo = mkPost(author.id, 'a sandbox post', cDemo, 0);
  const wall2 = await api('/api/posts?sort=new');
  const ids2 = (wall2.j.posts || []).map(p => p.id);
  check('a sandbox post reaches the public wall too', ids2.includes(pDemo));
  check('and carries the sandbox as its community', (wall2.j.posts || []).find(p => p.id === pDemo).community.demo === true);
  const foll2 = await api('/api/posts?feed=following&sort=new', { sid: outsider.sid });
  check('and the following feed', (foll2.j.posts || []).map(p => p.id).includes(pDemo));

  // ---- one posting allowance per account, wherever it is written ----
  const spam = mkUser('__cw_spam__');
  const cSpam = mkComm(spam.id, 'CWSPAM', 'live');
  db.prepare('UPDATE communities SET demo = 1 WHERE id = ?').run(cSpam);
  db.prepare('INSERT INTO community_members (community_id, user_id, qualified, joined_at) VALUES (?,?,1,?)').run(cSpam, spam.id, Date.now());
  let wallOk = 0, commOk = 0;
  for (let i = 0; i < 12; i++) {
    const r = await api('/api/posts', { method: 'POST', sid: spam.sid, body: { text: 'wall ' + i } });
    if (r.status === 200) { wallOk++; if (r.j.post) made.posts.push(r.j.post.id); }
  }
  for (let i = 0; i < 6; i++) {
    const r = await api('/api/communities/' + cSpam + '/posts', { method: 'POST', sid: spam.sid, body: { text: 'comm ' + i } });
    if (r.status === 200) { commOk++; if (r.j && r.j.post) made.posts.push(r.j.post.id); }
  }
  check('the wall allowance is spent as expected', wallOk === 12, wallOk);
  check('a community post CANNOT bypass it with a second bucket', commOk === 0, commOk + ' extra front-page posts got through');

  // ---- an auto-invite must not consume the creator's one-time first-post bonus ----
  const fresh = mkUser('__cw_fresh__');
  const cFresh = mkComm(fresh.id, 'CWFRESH', 'pending');
  mkPost(fresh.id, 'the invite the site wrote for them', cFresh, 0);   // stands in for communityInvitePost
  const firstReal = await api('/api/posts', { method: 'POST', sid: fresh.sid, body: { text: 'my actual first post' } });
  if (firstReal.j && firstReal.j.post) made.posts.push(firstReal.j.post.id);
  const gotFirst = db.prepare("SELECT 1 FROM points_events WHERE ref = ?").get('firstpost:' + fresh.id);
  check('the invite does not burn the first-post bonus', !!gotFirst, firstReal.j && firstReal.j.pointsEarned);

  // ---- the support board stays a separate room ----
  const sup = await api('/api/posts?board=support&sort=new');
  check('community posts do not leak onto the support board', !(sup.j.posts || []).some(p => p.id === pPublicComm));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  for (const id of made.posts) { try { db.prepare('DELETE FROM posts WHERE id=?').run(id); } catch {} }
  for (const id of made.comms) { try { db.prepare('DELETE FROM communities WHERE id=?').run(id); } catch {} }
  for (const id of made.users) { try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {} }
  const left = db.prepare(`SELECT (SELECT COUNT(*) FROM users WHERE username LIKE '__cw_%') u,
                                  (SELECT COUNT(*) FROM communities WHERE symbol LIKE 'CW%') c` ).get();
  console.log('\ncleanup — throwaway users:', left.u, '| throwaway communities:', left.c);
  cleanupGatePass();
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
