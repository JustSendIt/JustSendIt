/* Support board end-to-end against a live server, with throwaway accounts.
   Proves the two rooms stay separate, that comments and votes work on a question, and that asking one
   pays no Send Power. Everything it creates is deleted in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { gatePass, cleanupGatePass } from './gatepass.mjs';
import { createHash } from 'node:crypto';
import { DB_PATH } from './_paths.mjs';
const PORT = process.argv[2];
const BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => { results.push([n, !!ok, extra === undefined ? '' : String(extra)]); };
let GATE = '';
const made = { users: [], posts: [] };

const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: [GATE, opts.sid ? 'sid=' + opts.sid : ''].filter(Boolean).join('; ') },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};

// a throwaway signed-in user: row + session inserted straight into the DB (hashed=1, as the server expects)
function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar) VALUES (?,?,?)').run(name, Date.now(), '🧪');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.users.push(id);
  const raw = 'tok_' + name + '_' + Math.random().toString(16).slice(2);
  const hashed = createHash('sha256').update(raw).digest('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)')
    .run(hashed, id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}

GATE = await gatePass(BASE);
try {
  const asker = mkUser('__sup_asker__');
  const helper = mkUser('__sup_helper__');

  // 1. ask a question on the support board
  const q = await api('/api/posts', { method: 'POST', sid: asker.sid, body: { text: 'Why does my wallet balance show zero after I connect?', board: 'support' } });
  check('a question posts', q.status === 200 && !!q.j.post, q.status);
  const qid = q.j && q.j.post && q.j.post.id;
  if (qid) made.posts.push(qid);
  check('asking earns no Send Power', q.j && q.j.pointsEarned === 0, q.j && q.j.pointsEarned);
  check('it is stored on the support board', qid && db.prepare('SELECT board FROM posts WHERE id=?').get(qid).board === 'support');

  // 2. a normal wall post, for the separation checks
  const w = await api('/api/posts', { method: 'POST', sid: asker.sid, body: { text: 'just sent it 🚀' } });
  check('a wall post still posts', w.status === 200 && !!w.j.post, w.status);
  const wid = w.j && w.j.post && w.j.post.id;
  if (wid) made.posts.push(wid);
  check('a wall post still earns Send Power', w.j && w.j.pointsEarned > 0, w.j && w.j.pointsEarned);

  // 3. the two rooms do not leak into each other
  const wallFeed = await api('/api/posts');
  const supFeed = await api('/api/posts?board=support');
  const wallIds = (wallFeed.j.posts || []).map(p => p.id);
  const supIds = (supFeed.j.posts || []).map(p => p.id);
  check('the question is NOT on the Send Wall', !wallIds.includes(qid));
  check('the wall post is NOT on the support board', !supIds.includes(wid));
  check('the question IS on the support board', supIds.includes(qid));
  check('the wall post IS on the Send Wall', wallIds.includes(wid));
  check('the support feed echoes its board', supFeed.j.board === 'support', supFeed.j.board);
  check('the wall feed reports no board', wallFeed.j.board === null, String(wallFeed.j.board));

  // 4. an unknown board is refused, not passed through to SQL
  const bogus = await api('/api/posts?board=support%27%20OR%201=1--');
  check('an unknown board falls back to the wall, never to SQL', bogus.status === 200 && bogus.j.board === null);
  const bogusPost = await api('/api/posts', { method: 'POST', sid: asker.sid, body: { text: 'x', board: 'nope' } });
  if (bogusPost.j && bogusPost.j.post) made.posts.push(bogusPost.j.post.id);
  check('posting to an unknown board lands on the wall, not a new one',
    bogusPost.status === 200 && db.prepare('SELECT board FROM posts WHERE id=?').get(bogusPost.j.post.id).board === null);

  // 5. someone else answers and votes
  const c = await api('/api/posts/' + qid + '/comments', { method: 'POST', sid: helper.sid, body: { text: 'Check that the wallet is on Robinhood Chain, not mainnet.' } });
  check('anyone can answer a question', c.status === 200, c.status);
  const cl = await api('/api/posts/' + qid + '/comments');
  check('the answer is readable on the question', (cl.j.comments || []).some(x => /Robinhood Chain/.test(x.text)));

  const v = await api('/api/posts/' + qid + '/vote', { method: 'POST', sid: helper.sid, body: { dir: 'up' } });
  check('a question can be voted up', v.status === 200, v.status);
  check('the vote lands on the score', db.prepare('SELECT score FROM posts WHERE id=?').get(qid).score === 1);

  // 6. votes order the board — the point of voting on questions
  const q2 = await api('/api/posts', { method: 'POST', sid: helper.sid, body: { text: 'How do I change my username?', board: 'support' } });
  if (q2.j && q2.j.post) made.posts.push(q2.j.post.id);
  const ranked = await api('/api/posts?board=support');
  check('the most-voted question ranks first', (ranked.j.posts || [])[0] && ranked.j.posts[0].id === qid,
    (ranked.j.posts || []).map(p => p.id + ':' + p.score).join(','));

  // 7. reading is public
  const anon = await api('/api/posts?board=support');
  check('questions are readable signed out', anon.status === 200 && (anon.j.posts || []).length >= 2);
} catch (e) {
  console.error('ERROR', e.message);
} finally {
  for (const id of made.posts) { try { db.prepare('DELETE FROM posts WHERE id=?').run(id); } catch {} }
  for (const id of made.users) { try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {} }
  const left = db.prepare("SELECT (SELECT COUNT(*) FROM users WHERE username LIKE '__sup_%') u, (SELECT COUNT(*) FROM posts WHERE board='support') p").get();
  console.log('\ncleanup — throwaway users left:', left.u, '| support posts left in DB:', left.p);
  cleanupGatePass();
  db.close();
}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
