/* Wall alerts: "tell me when this person posts."
 *
 * Drives the real HTTP API with throwaway accounts, because the parts worth testing are all in the seams
 * — what the fan-out refuses to send, what a mute does to a subscription that already exists, what a
 * deleted post does to rows already sitting in strangers' bells, and where a click actually lands when
 * the author has since changed their name. A mock of any of that would only re-state the assumption.
 *
 * Everything it creates it deletes in the finally block.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gatePass, cleanupGatePass } from './gatepass.mjs';
import { ROOT, DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const NOTIF = readFileSync(path.join(ROOT, 'public', 'notifications.js'), 'utf8');
const UPAGE = readFileSync(path.join(ROOT, 'public', 'upage.js'), 'utf8');
const UHTML = readFileSync(path.join(ROOT, 'public', 'u.html'), 'utf8');
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = [];
let GATE = '';

function mkUser(name) {
  db.prepare('DELETE FROM users WHERE username=?').run(name);
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)')
    .run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + Math.random().toString(16).slice(2);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)')
    .run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}
async function api(p, opts = {}) {
  const cookies = [GATE, opts.sid ? 'sid=' + opts.sid : ''].filter(Boolean).join('; ');
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookies ? { Cookie: cookies } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j, location: r.headers.get('location') };
}
const bell = async (sid) => ((await api('/api/notifications', { sid })).j || {}).items || [];
const alertRows = async (sid) => (await bell(sid)).filter(x => x.kind === 'alert');

try {
  GATE = await gatePass(BASE);
  const author = mkUser('__alrt_author');
  const watcher = mkUser('__alrt_watcher');
  const muter = mkUser('__alrt_muter');
  const post = (sid, text, extra) => api('/api/posts', { sid, method: 'POST', body: { text, ...(extra || {}) } });

  /* ═══════════ 1. the loop the feature exists for ═══════════ */
  {
    const set = await api('/api/alerts/__alrt_author', { sid: watcher.sid, method: 'POST' });
    check('an alert can be set from someone else\'s wall', set.status === 200 && (set.j.alerts || []).includes('__alrt_author'));
    const p1 = await post(author.sid, 'the first post anyone was told about');
    const id = p1.j && p1.j.post && p1.j.post.id;
    check('  ...the post itself still succeeds', p1.status === 200 && !!id);
    const rows = await alertRows(watcher.sid);
    check('  ...and it lands in the subscriber\'s bell', rows.length === 1, rows.length);
    check('  ...naming the author and what they did', rows[0] && /^@__alrt_author posted on their wall\.$/.test(rows[0].text), rows[0] && rows[0].text);
    check('  ...linking by POST ID, not by a rendered username path', rows[0] && rows[0].href === '/p/' + id, rows[0] && rows[0].href);
    /* The link is resolved server-side so it survives a rename and knows which wall a post lives on. */
    const hop = await api('/p/' + id, { sid: watcher.sid });
    check('  ...and /p/<id> resolves to the post on that person\'s wall',
      hop.status === 302 && hop.location === '/u/__alrt_author#p' + id, hop.status + ' ' + hop.location);

    /* A rename must not break a link that was already delivered. */
    db.prepare('UPDATE users SET username=? WHERE id=?').run('__alrt_renamed', author.id);
    const after = await api('/p/' + id, { sid: watcher.sid });
    check('a rename does not break a link already in someone\'s bell',
      after.status === 302 && after.location === '/u/__alrt_renamed#p' + id, after.location);
    db.prepare('UPDATE users SET username=? WHERE id=?').run('__alrt_author', author.id);

    /* A notification row outlives nothing: deleting the post takes it out of every bell by cascade. */
    await api('/api/posts/' + id, { sid: author.sid, method: 'DELETE' });
    const left = await alertRows(watcher.sid);
    check('deleting the post removes the alert from every bell it reached', left.length === 0, left.length);
    const gone = await api('/p/' + id, { sid: watcher.sid });
    check('  ...and the dead link says so instead of landing nowhere',
      gone.status === 302 && /\/wall\.html\?gone=/.test(gone.location || ''), gone.location);
  }

  /* ═══════════ 2. what the fan-out refuses to send ═══════════ */
  {
    const before = (await alertRows(watcher.sid)).length;
    await post(author.sid, 'a question for the help desk about bridging', { board: 'support' });
    check('a support-board question never alerts anyone', (await alertRows(watcher.sid)).length === before);
    check('  ...because the fan-out refuses a board row outright', /if \(row\.board\) return 0;/.test(SRC));
    check('a holders-only post is never broadcast', /if \(row\.private\) return 0;/.test(SRC));
    check('you cannot set an alert on yourself', (await api('/api/alerts/__alrt_watcher', { sid: watcher.sid, method: 'POST' })).status === 400);
  }

  /* ═══════════ 3. a mute outranks an alert, in both directions ═══════════ */
  {
    await api('/api/alerts/__alrt_author', { sid: muter.sid, method: 'POST' });
    const m = await api('/api/mutes/__alrt_author', { sid: muter.sid, method: 'POST' });
    check('muting retires the alert as well as silencing it', m.status === 200 && (m.j.alerts || []).length === 0, JSON.stringify(m.j && m.j.alerts));
    check('  ...and the response carries the alerts list so the client stays in step', m.j && Array.isArray(m.j.alerts));
    await post(author.sid, 'a post the muter must not hear about at all');
    check('  ...so a muted author reaches no bell', (await alertRows(muter.sid)).length === 0);
    const re = await api('/api/alerts/__alrt_author', { sid: muter.sid, method: 'POST' });
    check('setting an alert on a muted account is refused OUT LOUD, not accepted and ignored',
      re.status === 409 && /muted/i.test((re.j || {}).error || ''), re.status + ' ' + ((re.j || {}).error || '').slice(0, 50));
    await api('/api/mutes/__alrt_author', { sid: muter.sid, method: 'DELETE' });
    check('  ...and unmuting does NOT silently switch alerts back on',
      !((await api('/api/alerts', { sid: muter.sid })).j.alerts || []).includes('__alrt_author'));
  }

  /* ═══════════ 4. the amplifier is bounded at three places ═══════════ */
  {
    check('subscribers per wall are capped at the site\'s existing fan-out bound', /const ALERT_TARGET_MAX = PROP_NOTIFY_CAP;/.test(SRC));
    check('walls per account are capped at the size of the alert bucket', /const ALERT_MAX_PER_USER = NOTIF_KEEP_ALERT;/.test(SRC));
    check('one author cannot fill one bell', /const ALERT_BURST = SOCIAL_PER_ACTOR;/.test(SRC));
    check('  ...nor trigger unbounded fan-outs', /rateLimit\('alertfan:' \+ row\.user_id, ALERT_FANOUT_PER_HOUR, 36e5\)/.test(SRC));
    check('both caps refuse with a reason rather than accepting a subscription that will never deliver',
      /which is the limit\. Turn one off/.test(SRC) && /the most alerts it can carry/.test(SRC));
    check('alerts get their own keep-count, so a busy wall cannot evict level-ups or restriction notices',
      /const NOTIF_KEEP_ALERT = 50;/.test(SRC) && /kind NOT IN \('social','alert'\)/.test(SRC));
  }

  /* ═══════════ 5. a restricted author's post does not get broadcast ═══════════
     The sybil detector and the call-spam trap both fire AFTER the call row is committed, so the call that
     trips them is the same call that would otherwise have been pushed into every subscriber's bell. */
  {
    check('the Send Call fan-out runs after the checks that can restrict its author',
      /if \(postId && !restriction\) \{[\s\S]{0,200}?fanOutAlert/.test(SRC));
    const spamIdx = SRC.indexOf('Spamming Send Calls');
    const fanIdx = SRC.indexOf('if (postId && !restriction)');
    check('  ...literally later in the route, not just guarded', spamIdx > 0 && fanIdx > spamIdx, spamIdx + ' vs ' + fanIdx);
  }

  /* ═══════════ 6. the link can never be anything but a site path ═══════════ */
  {
    check('notifyLink refuses a scheme, a protocol-relative host, or anything outside a tight charset',
      /if \(!h\.startsWith\('\/'\) \|\| h\.startsWith\('\/\/'\)\) return null;/.test(SRC) && /A-Za-z0-9\/_/.test(SRC));
    check('  ...and the client validates it again before it reaches innerHTML', /test\(it\.href\) && !it\.href\.startsWith\('\/\/'\)/.test(NOTIF));
    check('every href is built on the server, never read from a request body', !/href:\s*(b|body)\./.test(SRC));
  }

  /* ═══════════ 7. the controls, and what they say ═══════════ */
  {
    check('the wall carries a two-state alert button, separate from Follow', /id="alert-btn"[^>]*aria-pressed="false"/.test(UHTML) && /id="follow-btn"/.test(UHTML));
    check('  ...whose state is in aria-pressed AND in words, not in colour', /btn\.setAttribute\('aria-pressed'/.test(UPAGE) && /Alerts on/.test(UPAGE));
    check('  ...and which says plainly that the target is not told', /never told|not told/.test(UPAGE));
    check('a muted target disables the button with the reason', /btn\.disabled = muted;/.test(UPAGE));
    check('the public wall can finally land on a linked post', /function focusFromHash\(\)/.test(UPAGE) && /function flashPost\(el\)/.test(UPAGE));
    // the rendered markup, not the comments explaining why the roles changed
    const code = NOTIF.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    check('the bell announces the panel as a list, not a menu', /role="list"/.test(code) && !/role="menu"/.test(code) && !/aria-haspopup="true"/.test(code));
    check('  ...and Escape hands focus back to the bell instead of dropping it', /if \(inside\) \{ const b = document\.getElementById\('notif-bell'\); if \(b\) b\.focus\(\); \}/.test(NOTIF));
    check('  ...and a poll never rebuilds the panel under a keyboard user', /if \(open && mount\.contains\(document\.activeElement\)\) \{\s*pending = next;/.test(NOTIF));
    check('the badge is decorative; the count is in the button\'s own name', /notif-badge" aria-hidden="true"/.test(NOTIF) && /in your list/.test(NOTIF));
  }

  /* ═══════════ 8. the gate, and what read-only keeps ═══════════ */
  {
    check('setting an alert needs the participation check', /if \(req\.method === 'POST' && needsHolderProof\(me\)\)/.test(SRC));
    /* The guard is scoped to POST, so DELETE is never gated — nobody should have to prove anything to
       STOP being notified, least of all somebody whose bag has since fallen under the floor. */
    const route = (SRC.match(/if \(malert && \(req\.method === 'POST' \|\| req\.method === 'DELETE'\)\) \{[\s\S]*?\n      \}/) || [''])[0];
    check('  ...but turning one OFF never does',
      /req\.method === 'POST' && needsHolderProof\(me\)/.test(route) && !/^\s*if \(needsHolderProof\(me\)\)/m.test(route), route.length);
    check('read-only does not take the switch away, and the promise list says so',
      !/if \(blockReadOnly\(res, me\)\) return;[\s\S]{0,120}alerts/.test(SRC) && /Turn post alerts on or off for anyone/.test(SRC));
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join('\n'));
} finally {
  for (const id of made) {
    for (const t of ['sessions', 'points_events', 'notifications', 'posts', 'calls', 'call_hops', 'alerts', 'mutes', 'follows', 'identities', 'watchlist'])
      { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM alerts WHERE target_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM mutes WHERE muted_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  cleanupGatePass();
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_alrt\\_%' ESCAPE '\\'").get().n;
  console.log('\ncleanup — throwaway users left:', left, '| alert rows left:', db.prepare('SELECT COUNT(*) n FROM alerts').get().n);
  db.close();
}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
