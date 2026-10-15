/* Rocket Run ends itself at the crash point (owner, 2026-10-14: "fix the rocket run so the game ends when the random set bust
   number is hit so the user doesn't keep playing the game after the bust number has been reached"). Drives the real server with
   rounds whose crash point is set close, so the timing can be measured: the page's watch is answered at the crash moment (not
   before, not long after) and the round is settled as a bust; a reload after the crash is never a rejoin; a cash-out after it is
   refused. The crash point still never reaches the page early. Throwaway rows only, removed at the end. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { ROOT, DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8'), AJ = readFileSync(path.join(ROOT, 'public', 'arcade.js'), 'utf8');
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = [];
const GROWTH = 0.06;
const ymd = () => new Date().toISOString().slice(0, 10);
function mkUser() {
  const name = '__aw_' + randomBytes(3).toString('hex');
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}
// a round whose crash point is `secsLeft` seconds away (started `ago` seconds ago)
function mkRound(u, crashX, startedAgoMs) {
  const info = db.prepare('INSERT INTO arcade_rounds (user_id, day, started_at, crash_x) VALUES (?,?,?,?)').run(u.id, ymd(), Date.now() - startedAgoMs, crashX);
  db.prepare('UPDATE users SET arcade_day = ? WHERE id = ?').run(ymd(), u.id);
  return Number(info.lastInsertRowid);
}
const call = async (u, method, p, body) => { const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Cookie: 'sid=' + u.sid + '; jsi_age=18', Origin: BASE }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t }; };
const roundRow = (id) => db.prepare('SELECT * FROM arcade_rounds WHERE id = ?').get(id);

try {
  // 1. the watch is answered AT the crash moment, and the round is settled as a bust
  const a = mkUser();
  const crashMs = (Math.log(1.6) / GROWTH) * 1000;           // a 1.60× crash: ~7.8 s after takeoff
  const id1 = mkRound(a, 1.6, crashMs - 1500);               // ...1.5 s from now
  const t0 = Date.now();
  const w = await call(a, 'GET', '/api/arcade/watch?roundId=' + id1);
  const took = Date.now() - t0;
  check('the page\'s watch is answered when the rocket reaches its crash point — not before, not long after', w.status === 200 && w.j && w.j.over === true && w.j.busted === true && took >= 1400 && took < 2600, took + 'ms ' + w.t);
  check('  ...with the crash point, which the page is told only then', w.j && w.j.crashX === 1.6, w.t);
  const r1 = roundRow(id1);
  check('  ...and the round is settled as a bust at that moment (no boost)', r1 && r1.ended_at && r1.cashed_x === null && Math.abs(r1.ended_at - (r1.started_at + crashMs)) < 50, JSON.stringify(r1));
  const late = await call(a, 'POST', '/api/arcade/cashout', { roundId: id1 });
  check('  ...so a cash-out after it is refused: the flight is over', late.status === 409 && /already over/.test(late.t), late.t);

  // 2. a flight still short of its crash point is answered "still flying" when its wait runs out, never told the point
  const b = mkUser();
  const id2 = mkRound(b, 50, 0);                             // 50×: ~65 s away
  const src = /const ARCADE_WATCH_MS = 25e3;/.test(SRC) && /const wait = first\.ended_at \? 0 : Math\.min\(Math\.max\(0, crashAt - now\(\)\), ARCADE_WATCH_MS\);/.test(SRC);
  check('a watch is held at most 25 s; a flight short of its crash point is then told only "still flying" (the point is never sent early)', src && /return send\(res, 200, \{ over: false, serverNow: now\(\) \}/.test(SRC));
  const cash = await call(b, 'POST', '/api/arcade/cashout', { roundId: id2 });
  check('  ...and cashing out before the crash point still pays the boost', cash.status === 200 && cash.j && cash.j.busted === false && cash.j.boost >= 1, cash.t);
  const w2 = await call(b, 'GET', '/api/arcade/watch?roundId=' + id2);
  check('  ...a watch on a flight already cashed out is answered at once: over, not busted', w2.j && w2.j.over === true && w2.j.busted === false && w2.j.cashedX >= 1, w2.t);

  // 3. a flight that crashed while nobody watched: a reload is never a rejoin
  const c = mkUser();
  const id3 = mkRound(c, 1.2, 60e3);                         // 1.20× crashed ~3 s after takeoff, a minute ago
  const st = await call(c, 'GET', '/api/arcade/state');
  check('/state settles a flight that crashed while nobody watched, and reports it as the last run (a bust)', st.status === 200 && st.j && st.j.last && st.j.last.cashed_x === null && Math.abs(st.j.last.crash_x - 1.2) < 1e-9 && roundRow(id3).ended_at, st.t);
  const d = mkUser();
  mkRound(d, 1.2, 60e3);
  const again = await call(d, 'POST', '/api/arcade/start', {});
  check('/start after the crash point says it blew while they were away (the page shows "expired"), and starts nothing new', again.status === 409 && /expired — it blew at 1\.20× while you were away/.test(again.t), again.t);

  // 4. the page
  check('the page watches every flight from takeoff (a rejoined one too), and the first answer — the watch or a cash-out — wins',
    /setMode\('flying'\);\n      watchFlight\(\);/.test(AJ) && /fetch\('\/api\/arcade\/watch\?roundId=' \+ encodeURIComponent\(id\)/.test(AJ) && /if \(S\.mode !== 'flying'\) \{ S\.busy = false; return; \}/.test(AJ) && /if \(j\.busted\) bust\(Number\(j\.crashX\) \|\| 1, elapsedSec\(\), curX\(\), document\.activeElement === btn, true\);/.test(AJ));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  for (const id of made) { try { db.prepare('DELETE FROM arcade_rounds WHERE user_id = ?').run(id); db.prepare('DELETE FROM notifications WHERE user_id = ?').run(id); db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {} }
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
