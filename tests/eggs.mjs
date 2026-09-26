/* The easter-egg hunt, through the real HTTP API. What is being pinned down: an egg pays exactly once per
   account, ids outside the registry are refused, the kind rides the same daily cap as every other grind
   source, the participation gate and read-only mode sit in front of it like any other write, and the
   dashboard can read the count without keeping a copy of the total. Throwaway accounts only; deleted in
   the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DB_PATH, SERVER_JS, ROOT } from './_paths.mjs';

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

  /* ═══ the hunt is Halloween: every find is a hidden ghost, and ghosts pop out ═══ */
  const EGGS = readFileSync(ROOT + '/public/eggs.js', 'utf8'), APP = readFileSync(ROOT + '/public/app.js', 'utf8'), GAM = readFileSync(ROOT + '/public/gamify.js', 'utf8');
  const cat = EGGS.match(/const CATALOG = \[[\s\S]*?\n  \];/)[0];
  const lines = [...cat.matchAll(/\[(\d+), "[^"]*", "(?:[^"\\]|\\.)*", ("(?:[^"\\]|\\.)*")\]/g)].map((m) => JSON.parse(m[2]));
  check('all ' + TOTAL + ' finds have their own Halloween line', lines.length === TOTAL && new Set(lines).size === TOTAL, lines.length);
  check('  ...and no egg is left anywhere a member looks', !/🥚/.test(EGGS + GAM) && !/🥚/.test(SRC) && /'👻 Ghost #' \+ id/.test(EGGS) && /👻 ' \+ d\.found \+ '\/' \+ d\.total \+ ' ghosts'/.test(GAM));
  check('ghosts pop out: the burst takes its own emoji set and floats them up (negative gravity), from where the find was made', /const GHOSTS = \['👻'/.test(EGGS) && /emoji: GHOSTS, gravity: -0\.05/.test(EGGS) && /addEventListener\('pointerdown', markPtr/.test(EGGS)
    && /const set = Array\.isArray\(opts\.emoji\) && opts\.emoji\.length \? opts\.emoji : EMOJI;/.test(APP) && /p\.vy \+= p\.g;/.test(APP));
  check('  ...and reduced-motion readers get the toast without them', /if \(!window\.burst \|\| reduced\(\)\) return;/.test(EGGS) && /prefers-reduced-motion: reduce\)'\)\.matches\) return;/.test(APP));

  /* ═══ the fix: a signed-in member is signed in (the page knows the username, never the numeric id) ═══ */
  check('who is signed in is the username — not AUTH.user.id, which the page is never given', /const account = \(\) => \(window\.AUTH && AUTH\.user && AUTH\.user\.username\) \|\| null;/.test(EGGS) && !/AUTH\.user\.id\b/.test(EGGS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));   // in code, not the comment that explains the bug
  // …proved by running the real eggs.js against this server, signed in the way the page is: a user object with a username and no id
  const m = mkUser('__egg_live', true);
  const toasts = [], bursts = [], store = {};
  const listeners = {};
  const fakeDoc = {
    readyState: 'complete', hidden: false, body: {},
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener() {},
    querySelectorAll: () => [], querySelector: () => null, dispatchEvent: () => true,
    documentElement: { scrollHeight: 1000 },
  };
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const ctx = {
    console, JSON, Math, Date, Number, String, Array, Set, Map, Promise, Object, Error, clearTimeout,
    // the "stay on the page for ten minutes" egg arms a real ten-minute timer: it must not hold this process open
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); if (t && t.unref) t.unref(); return t; },
    document: fakeDoc, localStorage: ls, sessionStorage: { getItem: () => null, setItem() {} },
    location: { pathname: '/', hash: '' }, innerWidth: 1000, innerHeight: 800, scrollY: 0,
    matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ pointerEvents: 'auto' }), getSelection: () => '',
    MutationObserver: class { observe() {} }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    addEventListener() {},
    fetch: (u, o) => fetch(BASE + u, { ...(o || {}), headers: { ...((o && o.headers) || {}), Origin: BASE, Cookie: 'sid=' + m.sid } }),
    sendToast: (t) => toasts.push(t), burst: (x, y, o) => bursts.push(o), showPoints() {},
    AUTH: { user: { username: '__egg_live' } },   // no id — exactly what /api/me gives the page
  };
  ctx.window = ctx;
  store['send.eggs.pending'] = JSON.stringify([11, 26, 27, 28]);   // four finds parked by the old bug, waiting to bank
  vm.createContext(ctx);
  vm.runInContext(EGGS, ctx);
  // a live find made while the replay is still banking the saved ones (it takes a breath between claims)
  await new Promise((r) => setTimeout(r, 250));
  check('EGGS.found(id) is the function a page script calls to report a find (and EGGS.ids the list)', typeof ctx.EGGS.found === 'function' && Array.isArray(ctx.EGGS.ids), typeof ctx.EGGS.found);
  const live = ctx.EGGS.found(34);
  await live;
  const liveToast = toasts.find((t) => /^👻 Ghost #34/.test(t)), liveBursts = bursts.length;
  check('a live find during the replay gets its own toast and its own ghosts, right away', /^👻 Ghost #34 — boo\. The ghost jumped\. So did you\. \+\d+ Send Power/.test(liveToast || '') && liveBursts >= 1 && !toasts.some((t) => /banked now/.test(t)), JSON.stringify(toasts));
  check('  ...the ghost set, floating up', bursts[0] && bursts[0].emoji && bursts[0].emoji.includes('👻') && bursts[0].gravity < 0, JSON.stringify(bursts[0]));
  for (let i = 0; i < 40 && db.prepare('SELECT COUNT(*) n FROM easter_eggs WHERE user_id = ?').get(m.id).n < 5; i++) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 600));
  const banked = db.prepare('SELECT egg_id FROM easter_eggs WHERE user_id = ? ORDER BY egg_id').all(m.id).map((r) => r.egg_id);
  check('finds parked by the old bug bank on the next load — all of them, paid — and a signed-in member is never "sign in to bank it"', banked.join() === '11,26,27,28,34' && JSON.parse(store['send.eggs.pending'] || '[]').length === 0 && !toasts.some((t) => /sign in to bank it/.test(t)), JSON.stringify(banked));
  const summary = toasts.filter((t) => /ghosts you found earlier are banked now/.test(t));
  check('  ...said once for the four it banked (not the live one), with one more burst', summary.length === 1 && /^👻 4 ghosts you found earlier are banked now · \+80 Send Power/.test(summary[0]) && bursts.length === liveBursts + 1, JSON.stringify(summary) + ' bursts ' + bursts.length);

  /* ═══ unpaid ghosts: the server keeps the list; nothing found is burned ═══ */
  db.prepare('INSERT INTO easter_eggs (user_id, egg_id, found_at) VALUES (?, 50, ?)').run(m.id, Date.now());   // recorded while an allowance was full, never paid
  const listed = await api('/api/eggs', { sid: m.sid });
  check('the server lists found-but-unpaid ghosts (from its own records)', listed.status === 200 && Array.isArray(listed.j.unpaid) && listed.j.unpaid.join() === '50', JSON.stringify(listed.j && listed.j.unpaid));
  const paid50 = await api('/api/eggs/claim', { method: 'POST', sid: m.sid, body: { id: 50 } });
  const after50 = await api('/api/eggs', { sid: m.sid });
  check('  ...a later claim of it pays, and it leaves the list', paid50.status === 200 && paid50.j.awarded > 0 && after50.j.unpaid.length === 0, JSON.stringify(paid50.j) + ' ' + JSON.stringify(after50.j.unpaid));
  check('  ...the page re-sends that list at most hourly, and says nothing unless one pays', /const UNPAID_RETRY_MS = 60 \* 60 \* 1000;/.test(EGGS) && /if \(awarded > 0 \|\| fresh\) acc\.banked\+\+;/.test(EGGS) && !/send\.eggs\.unpaid'\)\s*\|\|/.test(EGGS));
  check('a ghost squeezed out by the shared daily budget writes no zero-point row, so it can still pay later', /if \(kind === 'egg'\) return 0;/.test(SRC));
  check('the "all 100" notification is sent once — on the claim that records the hundredth', /if \(!recorded && found\.length === EGG_TOTAL\) notify\(/.test(SRC));
  check('a refused signed-in claim is kept for that account (not the anonymous list a sign-out empties), and the replay stops if the account changes', /keepMine\(id\);/.test(EGGS) && /if \(account\(\) !== me\) \{ for \(const rest of ids\.slice\(i\)\) keepMine\(rest, me\); break; \}/.test(EGGS) && /if \(!flushP\) flushP = flushOnce\(\)/.test(EGGS));
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
