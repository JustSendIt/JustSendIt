/* Every leaderboard of PEOPLE on the site: a person's @name on it is a link to their Send Wall (/u/<name>). One check
   per board, on the line that draws the name, plus the APIs that feed the boards — they must send the username the
   link is built from. Boards whose rows are communities, squads or bare wallets show no person and are not listed;
   the Rocket Run card shows no names by design (counts only, never who flew). Throwaway rows only, deleted at the end. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DB_PATH, ROOT } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const src = (f) => readFileSync(ROOT + '/public/' + f, 'utf8');
const made = [];
// a board name: <a ... href="/u/' + encodeURIComponent(<who>) ...>@' + esc(<who>)
const linked = (code, who) => new RegExp('<a class="[a-z-]+" href="/u/\' \\+ encodeURIComponent\\(' + who.replace(/[.()]/g, '\\$&') + '\\) \\+ \'"[^\\n]{0,160}?>@\' \\+ esc\\(' + who.replace(/[.()]/g, '\\$&') + '\\)').test(code);

try {
  /* ═══ 1. every board draws the name as a link to the Send Wall ═══ */
  const compete = src('compete.js'), gamify = src('gamify.js'), home = src('home.js'), upage = src('upage.js'), community = src('community.js'), squad = src('squad.js'), sendcall = src('sendcall.js');
  check('Compete page: every board name goes through nameLink, a link to /u/<name>', linked(compete, 'u.username') && /const nameLink = u => '<a class="cmp-name" href="\/u\/'/.test(compete));
  check('  ...Biggest Sender podium and list, Send Calls, Hall of Fame and last week\'s winners all call it', (compete.match(/nameLink\((u|w)\)/g) || []).length >= 3 && /bs\.last\.winners\.slice\(0, 3\)\.map\(w => [^\n]*nameLink\(w\)/.test(compete));
  check('Dashboard Arena: the all-time and Biggest Sender boards link each name', (gamify.match(/<a class="gb-name" href="\/u\/' \+ encodeURIComponent\(u\.username\)/g) || []).length >= 2);
  check('  ...and so does "pts to overtake @name" under the all-time board', linked(gamify, 'ahead.username') && /pts to overtake <a class="lb-inline-name"/.test(gamify));
  check('Home page: the beta standings link each name', linked(home, 't.username') && /<a class="beta-nm" href="\/u\//.test(home) && !/<span class="beta-nm">/.test(home));
  check('Send Wall: the Send Callers leaderboard tab links each name', linked(upage, 't.username') && /<a class="lb-name" href="\/u\//.test(upage));
  check('Community page: the members board (ranked by conviction) links each name', linked(community, 'm.username') && /<a class="cm-name" href="\/u\//.test(community));
  check('Send Squad page: most-convicted members, the members list and the holders on the conviction table link each name',
    (squad.match(/<a class="cm-name" href="\/u\/' \+ encodeURIComponent\(m\.username\)/g) || []).length >= 2 && /<a class="sqd-holder" href="\/u\/' \+ encodeURIComponent\(u\)/.test(squad));
  check('Every Send Call card: the "who Sent It" list (ranked by $ put in) links each sender', /<a class="sc-sender-who" href="\/u\/' \+ encodeURIComponent\(s\.username\)/.test(sendcall));
  const css = readFileSync(ROOT + '/public/styles.css', 'utf8'), resp = readFileSync(ROOT + '/public/responsive.css', 'utf8');
  check('  ...the new links look like the board names around them: no underline until hover, a focus ring, a finger-sized target on phones',
    /\.beta-nm \{[^}]*text-decoration: none;/.test(css) && /\.beta-nm:focus-visible/.test(css) && /\.lb-inline-name:focus-visible/.test(css) && /\.gb-name, \.cmp-name, \.beta-nm \{ padding-block/.test(resp));

  /* ═══ 2. the APIs behind those boards send the username the link is built from ═══ */
  const tag = randomBytes(3).toString('hex');
  const mk = (name, pts) => {
    db.prepare('INSERT INTO users (username, created_at, avatar, points, holder_verified_at, holder_state) VALUES (?,?,?,?,?,?)').run(name, Date.now(), '🧪', pts, Date.now(), 'ok');
    const id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id; made.push(id);
    const raw = 'tok_' + name + '_' + randomBytes(6).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
    return { id, sid: raw };
  };
  const top = mk('__bl_Top_' + tag, 987654321), me = mk('__bl_me_' + tag, 987654320);
  const get = async (p, sid) => { const r = await fetch(BASE + p, { headers: { Origin: BASE, Cookie: 'jsi_age=18; sid=' + sid } }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
  const lb = await get('/api/leaderboard', me.sid);
  const row = lb.j && (lb.j.top || []).find(r => r.rank === 1);
  check('/api/leaderboard (Arena, Hall of Fame) sends each row\'s username, with its capitals', row && row.username === '__bl_Top_' + tag, lb.status + ' ' + JSON.stringify(row));
  const beta = await get('/api/beta', me.sid);
  const brow = beta.j && (beta.j.top || []).find(r => r.username === '__bl_Top_' + tag);
  check('/api/beta (home page standings) sends each row\'s username', !!brow, beta.status + ' ' + JSON.stringify(beta.j && (beta.j.top || []).slice(0, 2)));
  const wall = await get('/api/users/' + encodeURIComponent('__bl_Top_' + tag), me.sid);
  check('  ...and the link it makes, /u/<that name>, opens that person\'s wall', wall.status === 200 && wall.j && wall.j.user && wall.j.user.username === '__bl_Top_' + tag, wall.status);
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  for (const id of made) {
    for (const t of ['sessions', 'notifications', 'points_events']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {}
  }
  console.log('cleanup — throwaway users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_bl\\_%' ESCAPE '\\'").get().n);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
