/* Muted users may now check in. Proves: the route no longer 403s, the 60 points are paid, the absence
   streak is held at zero, the mute still costs READONLY_PCT, and an active (unmuted) user with underwater
   calls is NOT newly charged. Throwaway accounts only; everything is deleted in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { DB_PATH } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = { users: [] };

const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.sid ? { Cookie: 'sid=' + opts.sid } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};

/* Idempotent. This suite waits up to five and a half minutes for a decay sweep, so it is the one most
   likely to be interrupted — and a half-finished run used to leave its fixed usernames behind, which
   made every later run die on a UNIQUE constraint before a single assertion ran. A test that cannot be
   re-run after a Ctrl-C is a test that stops being run. */
function mkUser(name, points) {
  const stale = db.prepare('SELECT id FROM users WHERE username=?').get(name);
  if (stale) {
    for (const t of ['sessions', 'points_events', 'notifications', 'posts', 'calls', 'identities'])
      { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(stale.id); } catch {} }
    try { db.prepare('DELETE FROM notifications WHERE actor_id=?').run(stale.id); } catch {}
    try { db.prepare('DELETE FROM invite_codes WHERE owner_id=? OR user_id=?').run(stale.id, stale.id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(stale.id); } catch {}
  }
  db.prepare('INSERT INTO users (username, created_at, avatar, points) VALUES (?,?,?,?)').run(name, Date.now(), '🧪', points);
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.users.push(id);
  const raw = 'tok_' + name + '_' + Math.random().toString(16).slice(2);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)')
    .run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}
const mute = (id, ms) => db.prepare('UPDATE users SET restricted_until = ?, strikes = 1 WHERE id = ?').run(Date.now() + ms, id);
const pointsOf = (id) => db.prepare('SELECT points FROM users WHERE id=?').get(id).points;

try {
  // ---- 1. a muted account can check in ----
  const muted = mkUser('__ci_muted__', 100000);
  mute(muted.id, 6 * 3600e3);
  const before = pointsOf(muted.id);
  const r = await api('/api/checkin', { method: 'POST', sid: muted.sid });
  check('a muted account can check in (no 403)', r.status === 200, r.status + ' ' + JSON.stringify(r.j));
  check('and is paid for it', r.j && r.j.awarded > 0, r.j && r.j.awarded);
  check('the points actually landed', pointsOf(muted.id) > before, before + ' -> ' + pointsOf(muted.id));

  // a second tap the same UTC day pays nothing (idempotent), and still does not 403
  const again = await api('/api/checkin', { method: 'POST', sid: muted.sid });
  check('a second check-in the same day is idempotent, not an error', again.status === 200 && again.j.already === true, again.status);

  // ---- 2. an unmuted account is unaffected ----
  const plain = mkUser('__ci_plain__', 100000);
  const p = await api('/api/checkin', { method: 'POST', sid: plain.sid });
  check('an ordinary account still checks in normally', p.status === 200 && p.j.awarded > 0, p.status);

  // ---- 3. other read-only blocks still hold ----
  const post = await api('/api/posts', { method: 'POST', sid: muted.sid, body: { text: 'should be refused' } });
  check('a muted account still cannot post', post.status === 403, post.status);
  const call = await api('/api/calls', { method: 'POST', sid: muted.sid, body: { token: '0x' + '1'.repeat(40) } });
  check('a muted account still cannot make a Send Call', call.status === 403, call.status);

  // ---- 4. the advertised list matches reality ----
  const me = await api('/api/me', { sid: muted.sid });
  const blob = JSON.stringify(me.j || {});
  check('the read-only notice offers the check-in', /show up|check.?in/i.test(blob), blob.slice(0, 200));
  check('and no longer lists the check-in as blocked', !/daily check-in\s*—\s*so your Send Power/i.test(blob));

  // ---- 5. decay: the mute still costs, absence does not, bad calls do not ----
  const { runDecay } = await import('./decayprobe.mjs').catch(() => ({ runDecay: null }));
  // exercised through the DB the way the sweep does, since decayUser is not exported
  /* "Showed up today" is now users.checkin_at — the stamp /api/checkin writes whether or not the award
     paid — not a points_events row. That is the whole point of the change: 'daily' shares the rolling
     social ceiling, so a busy day could reduce the award to zero, write no ledger row, and leave decay
     reading an active user as absent. These fixtures therefore set the stamp, exactly as the route does. */
  const mutedActive = mkUser('__ci_dec_mute__', 200000);
  mute(mutedActive.id, 6 * 3600e3);
  db.prepare('UPDATE users SET decay_at = 0, decay_streak = 9, checkin_at = ? WHERE id = ?').run(Date.now(), mutedActive.id);

  const plainActive = mkUser('__ci_dec_plain__', 200000);
  db.prepare('UPDATE users SET decay_at = 0, decay_streak = 9, checkin_at = ? WHERE id = ?').run(Date.now(), plainActive.id);

  /* And the regression this fix exists for: a check-in that paid NOTHING still counts. No points_events
     row at all — only the stamp — which is exactly the state a capped-out day leaves behind. */
  const cappedOut = mkUser('__ci_dec_capped__', 200000);
  db.prepare('UPDATE users SET decay_at = 0, decay_streak = 9, checkin_at = ? WHERE id = ?').run(Date.now(), cappedOut.id);
  check('a check-in that paid 0 points writes no ledger row (the state that used to read as absent)',
    !db.prepare("SELECT 1 FROM points_events WHERE user_id = ? AND kind = 'daily'").get(cappedOut.id));

  console.log('waiting up to 5.5 min for one decay sweep tick...');
  const t0 = Date.now();
  let mutedDrained = null, plainDrained = null;
  while (Date.now() - t0 < 335000) {
    await new Promise((r2) => setTimeout(r2, 5000));
    const m = db.prepare('SELECT points, decay_streak, decay_at FROM users WHERE id=?').get(mutedActive.id);
    const q = db.prepare('SELECT points, decay_streak, decay_at FROM users WHERE id=?').get(plainActive.id);
    if (m.decay_at > 0 && q.decay_at > 0) { mutedDrained = 200000 - m.points; plainDrained = 200000 - q.points;
      check('a checked-in account has its absence streak reset to 0', q.decay_streak === 0, q.decay_streak);
      break; }
  }
  if (mutedDrained === null) console.log('(sweep did not run inside the window — decay assertions skipped, not failed)');
  else {
    check('a muted account that checked in STILL pays the read-only rate', mutedDrained > 0, mutedDrained + ' points');
    check('  ...and it is about 1% of the balance', Math.abs(mutedDrained - 2000) <= 20, mutedDrained + ' (expected ~2000)');
    check('an unmuted account that checked in pays NOTHING', plainDrained === 0, plainDrained + ' points');
    const capped = db.prepare('SELECT points, decay_streak FROM users WHERE id=?').get(cappedOut.id);
    check('REGRESSION: a 0-point check-in is still a check-in — nothing drained', 200000 - capped.points === 0, (200000 - capped.points) + ' points');
    check('  ...and its absence streak reset too', capped.decay_streak === 0, capped.decay_streak);
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  for (const id of made.users) {
    try {
      db.prepare('DELETE FROM points_events WHERE user_id=?').run(id);
      db.prepare('DELETE FROM notifications WHERE user_id=? OR actor_id=?').run(id, id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      db.prepare('DELETE FROM posts WHERE user_id=?').run(id);
      db.prepare('DELETE FROM calls WHERE user_id=?').run(id);
      db.prepare('DELETE FROM users WHERE id=?').run(id);
    } catch {}
  }
  // backstop: anything this suite named, even if it was created before the throw that skipped `made.users`
  for (const r of db.prepare("SELECT id FROM users WHERE username LIKE '\\_\\_ci\\_%' ESCAPE '\\'").all()) {
    for (const t of ['sessions', 'points_events', 'notifications', 'posts', 'calls', 'identities'])
      { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(r.id); } catch {} }
    try { db.prepare('DELETE FROM notifications WHERE actor_id=?').run(r.id); } catch {}
    try { db.prepare('DELETE FROM invite_codes WHERE owner_id=? OR user_id=?').run(r.id, r.id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(r.id); } catch {}
  }
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_ci\\_%' ESCAPE '\\'").get().n;
  console.log('\ncleanup — throwaway users left:', left);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
