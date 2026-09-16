/* The easter-egg hunt, through the real HTTP API. What is being pinned down: an egg pays exactly once per
   account, ids outside the registry are refused, the kind rides the same daily cap as every other grind
   source, the participation gate and read-only mode sit in front of it like any other write, and the
   dashboard can read the count without keeping a copy of the total. Throwaway accounts only; deleted in
   the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = [];

const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.sid ? { Cookie: 'sid=' + opts.sid } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
function mkUser(name, verified) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)')
    .run(name, Date.now(), '🥚', verified ? Date.now() : null, verified ? 'ok' : 'none');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + Math.random().toString(16).slice(2);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)')
    .run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}

try {
  const TOTAL = Number((SRC.match(/const EGG_TOTAL = (\d+);/) || [])[1]);
  check('the registry is one hundred eggs', TOTAL === 100, TOTAL);
  check('the kind has a base and a daily cap like every other source', /const PTS = \{[^}]*\begg: 20\b/.test(SRC) && /const DAILY_CAP = \{[^}]*\begg: 25\b/.test(SRC));

  // signed out
  const anon = await api('/api/eggs/claim', { method: 'POST', body: { id: 1 } });
  check('signed out cannot claim', anon.status === 401, anon.status);

  // the participation gate sits in front, in its own voice
  const gated = mkUser('__egg_gated__', false);
  const g = await api('/api/eggs/claim', { method: 'POST', sid: gated.sid, body: { id: 1 } });
  check('an unverified account is asked to prove its bag, not punished', g.status === 403 && g.j.needsProof === true && !g.j.readOnly, JSON.stringify(g.j));

  const u = mkUser('__egg_hunter__', true);
  for (const bad of [0, 101, -3, 'x', 1.5]) {
    const r = await api('/api/eggs/claim', { method: 'POST', sid: u.sid, body: { id: bad } });
    check('egg id ' + JSON.stringify(bad) + ' is refused', r.status === 400 && /no such egg/.test(r.j.error || ''), r.status);
  }

  const before = db.prepare('SELECT points FROM users WHERE id=?').get(u.id).points;
  const c1 = await api('/api/eggs/claim', { method: 'POST', sid: u.sid, body: { id: 7 } });
  check('finding an egg pays', c1.status === 200 && c1.j.already === false && c1.j.awarded > 0, JSON.stringify(c1.j));
  check('  ...and records it', Array.isArray(c1.j.found) && c1.j.found.length === 1 && c1.j.found[0] === 7 && c1.j.total === TOTAL);
  const after = db.prepare('SELECT points FROM users WHERE id=?').get(u.id).points;
  check('  ...into the real balance', after - before === c1.j.awarded, (after - before) + ' vs ' + c1.j.awarded);
  const ev = db.prepare("SELECT kind, base, ref FROM points_events WHERE user_id=? AND kind='egg'").all(u.id);
  check('  ...as an egg event with the registry base and a per-(user,egg) ref', ev.length === 1 && ev[0].base === 20 && ev[0].ref === 'egg:' + u.id + ':7', JSON.stringify(ev));

  const c2 = await api('/api/eggs/claim', { method: 'POST', sid: u.sid, body: { id: 7 } });
  check('the same egg pays exactly once', c2.status === 200 && c2.j.already === true && c2.j.awarded === 0, JSON.stringify(c2.j));
  check('  ...and the balance did not move', db.prepare('SELECT points FROM users WHERE id=?').get(u.id).points === after);

  const list = await api('/api/eggs', { sid: u.sid });
  check('GET /api/eggs shows what was found and the total', list.status === 200 && list.j.found.join() === '7' && list.j.total === TOTAL && list.j.points === 20, JSON.stringify(list.j));

  const gm = await api('/api/gamify/me', { sid: u.sid });
  const eggs = gm.j && gm.j.eggs;
  check('the dashboard summary carries the count', !!eggs && eggs.found === 1 && eggs.total === TOTAL, JSON.stringify(eggs));
  const rules = (gm.j && gm.j.rules) || {};
  check('the rules ship the egg constants for the client to read', rules.eggTotal === TOTAL && rules.eggPoints === 20 && rules.eggDailyCap === 25, JSON.stringify({ t: rules.eggTotal, p: rules.eggPoints, c: rules.eggDailyCap }));

  /* The daily cap, exercised without fighting the per-route rate limiter (30 requests per 10 minutes —
     which a hunter never hits, but 26 claims in a row here would). Twenty-three paid egg events are seeded
     as if found earlier today; with the one real find above that is 24 of 25. The next find is the 25th
     and pays; the one after is the 26th, still recorded as found, and pays nothing. */
  const seedAt = Date.now() - 3600000;
  for (let k = 0; k < 23; k++) {
    db.prepare("INSERT INTO points_events (user_id, kind, amount, base, mult, ref, created_at) VALUES (?,?,?,?,1,?,?)")
      .run(u.id, 'egg', 20, 20, 'egg:' + u.id + ':seed' + k, seedAt);
  }
  const c25 = await api('/api/eggs/claim', { method: 'POST', sid: u.sid, body: { id: 50 } });
  const c26 = await api('/api/eggs/claim', { method: 'POST', sid: u.sid, body: { id: 51 } });
  check('the 25th find of the day pays', c25.status === 200 && c25.j.awarded > 0, JSON.stringify(c25.j));
  check('the 26th is recorded as found, unpaid, and says so', c26.status === 200 && c26.j.awarded === 0 && c26.j.capped === true && c26.j.already === false && c26.j.found.includes(51), JSON.stringify(c26.j));
  // the next day (the seeded events age out), the same claim pays — nothing found is ever burned
  db.prepare("DELETE FROM points_events WHERE user_id=? AND ref LIKE 'egg:%:seed%'").run(u.id);
  const c26b = await api('/api/eggs/claim', { method: 'POST', sid: u.sid, body: { id: 51 } });
  check('an unpaid find pays on a later claim', c26b.status === 200 && c26b.j.awarded > 0 && c26b.j.already === false, JSON.stringify(c26b.j));
  const c26c = await api('/api/eggs/claim', { method: 'POST', sid: u.sid, body: { id: 51 } });
  check('  ...and then it is already, for good', c26c.status === 200 && c26c.j.already === true && c26c.j.awarded === 0);

  // read-only mode blocks it like any other write
  db.prepare('UPDATE users SET restricted_until=?, restrict_level=1 WHERE id=?').run(Date.now() + 864e5, u.id);
  const ro = await api('/api/eggs/claim', { method: 'POST', sid: u.sid, body: { id: 99 } });
  check('read-only mode cannot claim', ro.status === 403 && ro.j.readOnly === true, JSON.stringify(ro.j));

  // the rate limiter exists in front of it
  check('the claim route is rate-limited', /rateLimit\('egg:' \+ me\.id/.test(SRC));
} finally {
  for (const id of made) {
    try { db.prepare('DELETE FROM points_events WHERE user_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM easter_eggs WHERE user_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_egg\\_%' ESCAPE '\\'").get().n;
  console.log('\ncleanup — throwaway users left:', left);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
