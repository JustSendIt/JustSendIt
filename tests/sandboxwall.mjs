/* The REAL $HOOD sandbox, through the REAL routes: join it, post in it, and check the post lands on the
   public timeline exactly the way a holder-community post does. Throwaway user only; deleted afterwards. */
import { DatabaseSync } from 'node:sqlite';
import { gatePass, cleanupGatePass } from './gatepass.mjs';
import { createHash } from 'node:crypto';
import { DB_PATH } from './_paths.mjs';
const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
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
GATE = await gatePass(BASE);
try {
  const sandbox = db.prepare('SELECT id, symbol FROM communities WHERE demo = 1').get();
  const real = db.prepare('SELECT id, symbol FROM communities WHERE demo = 0 AND status = ? LIMIT 1').get('live');
  if (!sandbox) { console.log('no sandbox community present — skipping'); process.exit(0); }
  console.log('sandbox:', sandbox.id, '$' + sandbox.symbol, '| comparison community:', real && ('$' + real.symbol));

  db.prepare('INSERT INTO users (username, created_at, avatar) VALUES (?,?,?)').run('__sbx__', Date.now(), '🧪');
  const uid = db.prepare("SELECT id FROM users WHERE username='__sbx__'").get().id; made.users.push(uid);
  const raw = 'tok_sbx_' + Math.random().toString(16).slice(2);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)')
    .run(createHash('sha256').update(raw).digest('hex'), uid, Date.now(), Date.now() + 864e5);

  // 1. join the sandbox with NO wallet and NO token — that is what the sandbox is for
  const joined = await api('/api/communities/' + sandbox.id + '/join', { method: 'POST', sid: raw });
  check('a tokenless account can join the sandbox', joined.status === 200 && joined.j.joined, joined.status + ' ' + (joined.j && joined.j.error));
  check('and is qualified there without holding anything', joined.j && joined.j.qualified === true);

  // 2. post in it through the real community-post route
  const posted = await api('/api/communities/' + sandbox.id + '/posts', { method: 'POST', sid: raw, body: { text: 'hello from the sandbox 🧪' } });
  check('and can post in it', posted.status === 200, posted.status + ' ' + (posted.j && posted.j.error));
  const pid = posted.j && posted.j.post && posted.j.post.id;
  if (pid) made.posts.push(pid);

  // 3. it must appear on the PUBLIC timeline
  const wall = await api('/api/posts?sort=new');
  const wp = (wall.j.posts || []).find(p => p.id === pid);
  check('the sandbox post is on the public Send Wall', !!wp);
  check('signed out too', !!((await api('/api/posts?sort=new')).j.posts || []).find(p => p.id === pid));

  // 4. and must look exactly like any other community post
  check('it links back to the sandbox community', wp && wp.community && wp.community.id === sandbox.id, wp && JSON.stringify(wp.community));
  check('it carries the community symbol for the badge', wp && wp.community.symbol === sandbox.symbol);
  check('it carries the community branding image', wp && wp.community && 'image' in wp.community);
  check('it reports its live status', wp && wp.community.status === 'live');
  check('it is not marked private', wp && wp.private === false);
  if (real) {
    const rp = { community: { id: real.id } };
    const sKeys = wp ? Object.keys(wp.community).sort().join(',') : '';
    const anyReal = (wall.j.posts || []).find(p => p.community && p.community.id === real.id);
    if (anyReal) check('its payload shape matches a holder community post exactly',
      sKeys === Object.keys(anyReal.community).sort().join(','), sKeys);
    else check('its payload carries every field the badge needs',
      sKeys === 'demo,id,image,name,status,symbol,token', sKeys);
  }
  // 5. the sandbox still grants no multiplier — joining it must not have changed that
  const lc = db.prepare('SELECT live_comm_count FROM users WHERE id=?').get(uid).live_comm_count;
  check('joining the sandbox still grants no Send Power multiplier', lc === 0, lc);
} catch (e) { console.error('ERROR', e.message); }
finally {
  for (const id of made.posts) { try { db.prepare('DELETE FROM posts WHERE id=?').run(id); } catch {} }
  for (const id of made.users) { try { db.prepare('DELETE FROM community_members WHERE user_id=?').run(id); db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {} }
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username = '__sbx__'").get().n;
  console.log('\ncleanup — throwaway user left:', left);
  cleanupGatePass();
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
