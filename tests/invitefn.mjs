/* communityInvitePost() itself, run against the REAL database and schema, then read back through the live
   wall API. The create route refuses a caller who does not hold the token — correctly — so this drives the
   function the route calls rather than faking a wallet. Everything created is deleted afterwards. */
import { DatabaseSync } from 'node:sqlite';
import { gatePass, cleanupGatePass } from './gatepass.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DB_PATH, SERVER_JS } from './_paths.mjs';
const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const SRC = readFileSync(SERVER_JS, 'utf8');
const fnSrc = SRC.match(/function communityInvitePost\(cid, kind\) \{[\s\S]*?\n\}/)[0];
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = { users: [], comms: [] };
// invite-only site: a signed-out reader of the wall still needs a pass through the door
const GATE = await gatePass(BASE);
try {
  db.prepare('INSERT INTO users (username, created_at, avatar) VALUES (?,?,?)').run('__ivf__', Date.now(), '🧪');
  const uid = db.prepare("SELECT id FROM users WHERE username='__ivf__'").get().id; made.users.push(uid);
  const tok = '0x' + createHash('sha256').update('ivf' + Date.now()).digest('hex').slice(0, 40);
  db.prepare(`INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, brand, status, created_at)
              VALUES (?,?,?,?,?,?, 'pending', ?)`).run(uid, tok, tok, 'IVF', 'IVF Coin',
              JSON.stringify({ imageUrl: 'https://cdn.dexscreener.com/ivf.png' }), Date.now());
  const cid = db.prepare('SELECT id FROM communities WHERE token_addr=?').get(tok).id; made.comms.push(cid);

  const invitePost = new Function('db', 'now', 'LIVE_THRESHOLD', fnSrc + '\nreturn communityInvitePost;')(db, () => Date.now(), 10);

  const id1 = invitePost(cid, 'new');
  check('the create invite is written', id1 > 0, id1);
  const p1 = db.prepare('SELECT * FROM posts WHERE id=?').get(id1);
  check('authored by the community creator', p1 && p1.user_id === uid);
  check('public, never holders-only', p1 && p1.private === 0);
  check('tagged with the community so the wall can brand it', p1 && p1.community_id === cid);
  check('names the token', p1 && /\$IVF/.test(p1.text), p1 && p1.text);
  check('says how many holders it needs to go live', p1 && /10 holders to go live/.test(p1.text));
  check('invites people to join', p1 && /join/i.test(p1.text));

  check('a second create invite is refused', invitePost(cid, 'new') === 0);
  check('exactly one marker exists', db.prepare("SELECT COUNT(*) n FROM points_events WHERE ref=?").get('cinvite:' + cid + ':new').n === 1);
  check('the invite earned no Send Power', db.prepare("SELECT amount FROM points_events WHERE ref=?").get('cinvite:' + cid + ':new').amount === 0);

  db.prepare("UPDATE communities SET status='live', went_live_at=? WHERE id=?").run(Date.now(), cid);
  const id2 = invitePost(cid, 'live');
  check('the go-live invite is a separate post', id2 > 0 && id2 !== id1);
  const p2 = db.prepare('SELECT * FROM posts WHERE id=?').get(id2);
  check('and says the community is live', p2 && /LIVE/.test(p2.text), p2 && p2.text);
  check('a second go-live invite is refused', invitePost(cid, 'live') === 0);

  // and now read it back off the PUBLIC wall, through the live API
  const wall = await (await fetch(BASE + '/api/posts?sort=new', { headers: { Cookie: GATE } })).json();
  const wp = (wall.posts || []).find(p => p.id === id2);
  check('the invite is on the public Send Wall', !!wp);
  check('it links back to the community', wp && wp.community && wp.community.id === cid);
  check('it carries the community branding for the badge',
    wp && wp.community && wp.community.symbol === 'IVF' && wp.community.image === 'https://cdn.dexscreener.com/ivf.png');
  check('and its live status', wp && wp.community.status === 'live', wp && wp.community.status);
} catch (e) { console.error('ERROR', e.message); }
finally {
  for (const id of made.comms) { try { db.prepare('DELETE FROM posts WHERE community_id=?').run(id); db.prepare('DELETE FROM communities WHERE id=?').run(id); } catch {} }
  for (const id of made.users) { try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {} }
  const left = db.prepare("SELECT (SELECT COUNT(*) FROM users WHERE username='__ivf__') u, (SELECT COUNT(*) FROM communities WHERE symbol='IVF') c").get();
  console.log('\ncleanup — throwaway user:', left.u, '| throwaway community:', left.c);
  cleanupGatePass();
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
