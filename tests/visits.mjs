/* Daily visitors and the admin page's "Daily active users" (owner, 2026-10-13: "on the admin page keep a daily active users
   chart that shows the amount of users that have come to the platform each day, make sure that is tracked and shown there,
   and show any data that has been tracked about people who have come to the live site since it has been live").
   Drives the real server: a page opened counts, once per device and day; bots, HEAD, prefetches and the API do not; a
   signed-in member is counted among the visitors; nothing stored names an IP address or a browser; only the admin can read
   the report. Everything it creates it deletes (the day's totals in this throwaway database are the server's own). */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { ROOT, DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const read = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const ADMIN_ID = 987654;
const made = [];
const today = () => new Date().toISOString().slice(0, 10);
const row = () => db.prepare('SELECT visitors, members, views, bots FROM visits_daily WHERE day = ?').get(today()) || { visitors: 0, members: 0, views: 0, bots: 0 };
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const ip = () => '203.0.113.' + (1 + (randomBytes(1)[0] % 250));   // TEST-NET-3: never a real visitor
const open = async (p, o) => { const r = await fetch(BASE + p, { method: (o && o.method) || 'GET', headers: { 'User-Agent': (o && o.ua) || UA, 'X-Forwarded-For': (o && o.ip) || ip(), ...((o && o.headers) || {}) } }); await r.text(); return r.status; };
const diff = (a, b) => ({ visitors: b.visitors - a.visitors, members: b.members - a.members, views: b.views - a.views, bots: b.bots - a.bots });
const same = (d, want) => Object.keys(want).every((k) => d[k] === want[k]);
function mkUser(name, id) {
  db.prepare('DELETE FROM users WHERE username = ?').run(name);
  if (id) db.prepare('INSERT INTO users (id, username, created_at, avatar) VALUES (?,?,?,?)').run(id, name, Date.now(), '🧪');
  else db.prepare('INSERT INTO users (username, created_at, avatar) VALUES (?,?,?)').run(name, Date.now(), '🧪');
  const uid = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  made.push(uid);
  const raw = 'tok_' + name + '_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), uid, Date.now(), Date.now() + 864e5);
  return { id: uid, sid: raw };
}

try {
  // a page opened by a new device counts once; the same device again is a view, not a visitor
  const me = ip();
  let a = row(); await open('/arcade', { ip: me }); let b = row();
  check('a page opened by a new device counts one visitor and one view', same(diff(a, b), { visitors: 1, views: 1, bots: 0 }), JSON.stringify(diff(a, b)));
  a = row(); await open('/wall', { ip: me }); b = row();
  check('  ...the same device again is one more view, not another visitor', same(diff(a, b), { visitors: 0, views: 1 }), JSON.stringify(diff(a, b)));
  a = row(); await open('/wall', { ip: ip() === me ? '198.51.100.7' : ip() }); b = row();
  check('  ...another device is another visitor', diff(a, b).visitors === 1, JSON.stringify(diff(a, b)));

  // what is not a person opening a page
  a = row(); await open('/arcade', { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }); await open('/arcade', { ua: 'node' }); await open('/arcade', { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0 Safari/537.36' }); b = row();
  check('a crawler, a script and a headless browser are left out (counted as bots, not visitors or views)', same(diff(a, b), { visitors: 0, views: 0, bots: 3 }), JSON.stringify(diff(a, b)));
  a = row(); await open('/arcade', { method: 'HEAD' }); await open('/arcade', { headers: { 'Sec-Purpose': 'prefetch' } }); await open('/api/config'); await open('/styles.css'); b = row();
  check('  ...and a HEAD, a browser prefetch, an API call or a stylesheet counts nothing at all', same(diff(a, b), { visitors: 0, views: 0, bots: 0 }), JSON.stringify(diff(a, b)));

  // a signed-in member is a visitor and a member, once a day
  const m = mkUser('__vis_' + randomBytes(3).toString('hex'));
  const mip = ip();
  a = row(); await open('/wall', { ip: mip, headers: { Cookie: 'sid=' + m.sid } }); await open('/arcade', { ip: mip, headers: { Cookie: 'sid=' + m.sid } }); b = row();
  check('a signed-in member counts among the visitors, and as a member once a day', diff(a, b).members === 1 && diff(a, b).views === 2, JSON.stringify(diff(a, b)));

  // nothing stored names an IP address, a browser or an account
  const seen = db.prepare('SELECT v FROM visit_seen WHERE day = ?').all(today()).map((r) => r.v);
  const keys = db.prepare('SELECT day FROM visit_keys').all().map((r) => r.day);
  check('what the day keeps is fingerprints, not addresses: no IP, no browser string, no account id', seen.length >= 3 && seen.every((v) => /^[vm]:[A-Za-z0-9_-]{22}$/.test(v)) && !seen.some((v) => v.includes('203.0.113') || v.includes('Mozilla') || v === 'm:' + m.id || v === 'm:u' + m.id), seen.slice(0, 3).join(','));
  check('  ...made with a key that exists for today only', keys.length === 1 && keys[0] === today(), keys.join(','));
  check('  ...and yesterday\'s key and fingerprints are deleted (on the first visit of a new day, at boot and every hour)', /function visitSweep\(today\) \{[^\n]*\n  try \{ db\.prepare\('DELETE FROM visit_seen WHERE day < \?'\)\.run\(today\); db\.prepare\('DELETE FROM visit_keys WHERE day < \?'\)\.run\(today\); \} catch \{\}/.test(SRC)
    && /setInterval\(\(\) => visitSweep\(utcDay\(\)\), 3600e3\)\.unref\(\);/.test(SRC) && /visit\.day = day; visit\.key = [^\n]*\n  visitSweep\(day\);/.test(SRC));
  check('a visit is counted where a page is served, before the 304 check (a revalidated page is still a page opened)', /if \(!e\) \{ notFoundPage\(res\); return; \}\n      countVisit\(req\);/.test(SRC));

  // the report: the admin's alone
  const stranger = mkUser('__vis_s_' + randomBytes(3).toString('hex'));
  const admin = mkUser('__vis_admin', ADMIN_ID);
  const r404 = await fetch(BASE + '/api/admin/activity', { headers: { Cookie: 'sid=' + stranger.sid } });
  const r404b = await fetch(BASE + '/api/admin/activity');
  check('/api/admin/activity answers 404 to a member who is not the admin, and to nobody signed in', r404.status === 404 && r404b.status === 404, r404.status + ' ' + r404b.status);
  const rep = await fetch(BASE + '/api/admin/activity', { headers: { Cookie: 'sid=' + admin.sid } });
  const j = await rep.json().catch(() => null);
  const last = j && j.days && j.days[j.days.length - 1];
  const now = row();
  check('  ...and to the admin: every day from the first record to today, today\'s visitors exactly as counted', rep.status === 200 && rep.headers.get('cache-control') === 'no-store' && last && last.day === today() && last.visitors === now.visitors && last.membersVisiting === now.members && last.views === now.views && j.today === today() && j.trackingSince <= today() && j.firstRecord <= today(), JSON.stringify(last));
  check('  ...with today\'s new members counted active (joining is activity) and the history the site already keeps', last && last.activeMembers >= 3 && last.joined >= 3 && ['entered', 'signins', 'posts', 'comments', 'reactions', 'checkins', 'calls', 'flights', 'ghosts'].every((k) => typeof last[k] === 'number') && j.totals && typeof j.totals.members === 'number', JSON.stringify(last));
  const before = j && j.days && j.days.find((d) => d.day < j.trackingSince);
  check('  ...and a day before counting began says so (null), never a zero it did not count', !before || (before.visitors === null && before.views === null), JSON.stringify(before));
  check('active members come only from what a member did by their own hand: not holding a call, decay or a reaction someone else gave', /const ACTIVE_KINDS = \['post', 'first_post', 'comment', 'react_give', 'vote_give', 'follow', 'daily', 'egg', 'customize', 'connect_wallet', 'watch_token', 'track_wallet', 'swap', 'send_call', 'hop_on', 'community_founder'\];/.test(SRC) && !/ACTIVE_KINDS = \[[^\]]*'(call_hold|decay|react_get|be_followed|vote_get|convxp|commxp)'/.test(SRC));

  // the page and the policy
  const AH = read('admin.html'), AJ = read('admin.js'), PRIV = read('privacy.html');
  check('the admin page charts it: visitors per day and active members per day, a range switch, and every day\'s numbers in a table',
    /<section class="card adm-ov adm-dau" id="adm-activity" hidden/.test(AH) && /data-dau-range="30" aria-pressed="true" data-tip="/.test(AH) && /data-dau-range="all" aria-pressed="false" data-tip="/.test(AH)
    && /fetch\('\/api\/admin\/activity'/.test(AJ) && /chart\(rows, 'visitors', 'adm-chart--visitors', 'Visitors per day'/.test(AJ) && /chart\(rows, 'activeMembers', 'adm-chart--members', 'Active members per day'/.test(AJ) && /Every day(\\u2019|’)s numbers/.test(AJ));
  check('  ...and says plainly that no visit was counted before counting began (striped days), rather than drawing zeros', /the site counted no visits at all<\/b> \(the striped days\)/.test(AJ) && /adm-bar is-none/.test(AJ));
  check('the privacy page says how visitors are counted: a one-day key, no IP or browser stored, only the totals kept', /A daily count of visitors: when you open a page, a one-way fingerprint of your IP address and browser, made with a random key that exists for that UTC day only/.test(PRIV) && /No IP address or browser string is stored\. The day&#39;s key|No IP address or browser string is stored\. The day's key/.test(PRIV) && /daily count of visitors<\/b> for the operator/.test(PRIV));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  for (const id of made) { try { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {} }
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
