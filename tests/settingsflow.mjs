/* Settings, 2026-10-14. Two owner requests:
   1. "For my wall style accent color and background tint, allow users to enter in a hex code in addition from picking from
      preset colors, when a user puts in a hex code add that color to the list of colors to pick from in the future to all places
      where users can pick from pre-picked colors."
   2. "When users are changing their info in settings do not time them out and do not take them to any other page like the
      dashboard overview mid them changing their info."
   Drives the real API for what the server holds (readable wall colours, the saved colour list, the unlock that stays open while
   a member works), and reads the page code for what the browser does. Throwaway rows only, removed at the end. */
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
const made = [];
function mkUser() {
  const name = '__sf_' + randomBytes(3).toString('hex');
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw, hash: createHash('sha256').update(raw).digest('hex') };
}
const post = async (u, p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'sid=' + u.sid + '; jsi_age=18', Origin: BASE }, body: JSON.stringify(body || {}) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t }; };
const row = (id) => db.prepare('SELECT accent, wall_bg, site_prefs FROM users WHERE id = ?').get(id);

try {
  /* ═══ 1. your own colours ═══ */
  const u = mkUser();
  let r = await post(u, '/api/profile', { wall_bg: '#123a2b' });
  check('a typed background that keeps the wall readable is saved', r.status === 200 && row(u.id).wall_bg === '#123a2b', r.t.slice(0, 200));
  r = await post(u, '/api/profile', { wall_bg: '#f0f0f0' });
  check('  ...one too light for the wall\'s text is refused, with the reason', r.status === 400 && /too light/.test(r.t) && row(u.id).wall_bg === '#123a2b', r.t.slice(0, 200));
  r = await post(u, '/api/profile', { accent: '#7EE8FA' });
  check('a typed accent readable on the wall and the site\'s cards is saved (lower case)', r.status === 200 && row(u.id).accent === '#7ee8fa', r.t.slice(0, 200));
  r = await post(u, '/api/profile', { accent: '#202020' });
  check('  ...one too dark to read is refused, with the reason', r.status === 400 && /too dark/.test(r.t) && row(u.id).accent === '#7ee8fa', r.t.slice(0, 200));
  r = await post(u, '/api/profile', { accent: '#ffffff', wall_bg: '#000000' });
  const presetsOk = [];
  for (const a of ['#c6f000', '#00C805', '#ffb340', '#ff5d5d', '#5dc9ff', '#c85dff', '#ff5dd2', '#ffffff']) for (const bg of ['', '#0a0e14', '#101a10', '#1a1210', '#10121a', '#1a101a', '#000000']) { const x = await post(u, '/api/profile', { wall_bg: bg, accent: a }); if (x.status !== 200) presetsOk.push(a + '/' + bg); }
  check('every preset accent on every preset background is still accepted', r.status === 200 && presetsOk.length === 0, presetsOk.join(','));
  r = await post(u, '/api/profile', { site_prefs: { customColors: ['#7EE8FA', '#123a2b', '#7ee8fa'] } });
  const me = await (await fetch(BASE + '/api/me', { headers: { Cookie: 'sid=' + u.sid } })).json().catch(() => ({}));   // site_prefs are stored encrypted: read them the way the page does
  const sp = (me && me.user && me.user.site_prefs) || {};
  check('your colours are kept on the account (lower case, each once) for every picker', r.status === 200 && JSON.stringify(sp.customColors) === JSON.stringify(['#7ee8fa', '#123a2b']), JSON.stringify(sp));
  const bad1 = await post(u, '/api/profile', { site_prefs: { customColors: ['red; background:url(x)'] } });
  const bad2 = await post(u, '/api/profile', { site_prefs: { customColors: Array.from({ length: 13 }, (_, i) => '#00000' + (i % 10)) } });
  check('  ...strict hex only (they are painted into style attributes), and no more than twelve', bad1.status === 400 && bad2.status === 400, bad1.status + ' ' + bad2.status);
  // the pickers live in wallstyle.js since 2026-10-15 (the same editor as the Wall Style pop-up on your own wall); profile.js mounts them
  const PJ = read('profile.js'), PR = read('prefs.js'), WS = read('wallstyle.js');
  check('the page: a hex box under every picker (wall accent, wall background, site colour), and a typed colour joins every picker',
    /WallStyle\.wallPickers\(document\.getElementById\('accent-swatches'\), document\.getElementById\('bg-swatches'\), wallState\);/.test(PJ) && /WallStyle\.picker\(document\.getElementById\('site-accent-swatches'\)/.test(PJ)
    && /function hexRow\(zone\)/.test(WS) && /keepColor\(used\);\n      P\.pick\(used\);\n      drawPickers\(\);/.test(WS) && /const mine = myColors\(\)\.filter/.test(WS) && /function drawPickers\(\) \{ for \(const z of pickers\)/.test(WS));
  check('  ...the same readability rule as the server, nudging a colour that misses and saying so', /function readableAccent\(c, bg\)/.test(WS) && /function readableBg\(c\)/.test(WS) && /fit: \(c\) => readableAccent\(c, state\.bg\)/.test(WS) && /'Adjusted to ' \+ used \+ ' so the text on your wall stays readable/.test(WS) && /window\.ColorMath = \{ ratio, fixFg, lum, isHex \};/.test(PR));

  /* ═══ 2. no time-out, no jump ═══ */
  const s = mkUser();
  const setSudo = (until, since) => db.prepare('UPDATE sessions SET sudo_until = ?, sudo_since = ? WHERE token = ?').run(until, since, s.hash);
  const sess = () => db.prepare('SELECT sudo_until, sudo_since FROM sessions WHERE token = ?').get(s.hash);
  setSudo(null, null);
  r = await post(s, '/api/auth/verify/keep');
  check('keeping the unlock open never opens a closed one', r.status === 200 && r.j && r.j.ok === false && !sess().sudo_until, r.t);
  const t0 = Date.now();
  setSudo(t0 + 5 * 60e3, t0 - 20 * 60e3);   // confirmed 20 minutes ago, 5 minutes left
  r = await post(s, '/api/auth/verify/keep');
  const after = sess();
  check('while a member works in Settings, an open unlock is moved to 30 minutes from now', r.status === 200 && r.j && r.j.ok && after.sudo_until >= t0 + 29 * 60e3 && after.sudo_until <= Date.now() + 30 * 60e3 + 1000 && after.sudo_since === t0 - 20 * 60e3, JSON.stringify(after));
  setSudo(t0 + 2 * 60e3, t0 - 235 * 60e3);   // confirmed nearly four hours ago, 2 minutes left
  r = await post(s, '/api/auth/verify/keep');
  check('  ...but never past four hours after the proof that opened it (here: 5 more minutes, not 30)', r.j && r.j.ok && Math.abs(sess().sudo_until - (t0 - 235 * 60e3 + 240 * 60e3)) < 1000, JSON.stringify(sess()));
  check('the server side: SUDO_MAX_MS caps the slide; a fresh proof starts a fresh window; locking clears both', /const SUDO_MAX_MS = \(Number\(process\.env\.SUDO_MAX_MINUTES\) > 0 \? Number\(process\.env\.SUDO_MAX_MINUTES\) : 240\) \* 60e3;/.test(SRC)
    && /const since = sudoActive\(me\) && me\.sudo_since \? me\.sudo_since : now\(\);/.test(SRC) && /UPDATE sessions SET sudo_until = NULL, sudo_since = NULL WHERE token = \?/.test(SRC));
  check('the page asks for it only while the member types or clicks in Settings, at most every four minutes', /if \(e\.isTrusted && p && !p\.hidden && p\.contains\(e\.target\)\) keepSudoOpen\(\);/.test(PJ) && /Date\.now\(\) - sudoKeptAt < 4 \* 60e3/.test(PJ));
  const DT = read('dashtabs.js');
  check('a section the dashboard draws open (it redraws after a save) no longer pulls the reader to the Overview', /const at = drawnAt\.get\(d\); if \(at !== undefined && performance\.now\(\) - at < 250\) return;/.test(DT) && /new MutationObserver\(/.test(DT));
  check('  ...and while the reader works in a panel, nothing else switches it unless they just pressed something', /const mayMove = \(\) => !working\(\) \|\| performance\.now\(\) - pressedAt < 1500;/.test(DT)
    && /if \(t && t !== current && mayMove\(\)\) show\(t\);/.test(DT) && /if \(t && t !== current\) \{ if \(!mayMove\(\)\) return; show\(t\); \}/.test(DT));

  /* ═══ 3. "Edit profile" on your wall goes to the settings that edit it ═══
     Owner, 2026-10-15: "Edit profile button on profile page should take the user to the settings on the dashboard and settings
     page so they can edit their profile". */
  const UH = read('u.html'), CSS = read('styles.css');
  check('"Edit profile ✏️" on your own wall links to the dashboard\'s Settings at the Account card (avatar, username, bio, links), and says so',
    /<a class="btn btn-ghost btn-sm" id="edit-btn" href="\/profile\.html#sec-account" hidden data-tip="Opens Settings on your dashboard with your avatar, username, bio and links ready to change">Edit profile ✏️<\/a>/.test(UH)
    && /<details class="setting-card" id="sec-account">/.test(read('profile.html')) && /if \(\/\^#\(sec-\|claim\$/.test(DT));
  check('  ...the dashboard opens on the Settings tab whatever tab was last used, opens the Account card once the account has loaded, and puts focus on its heading',
    /const fromHash = tabForHash\(location\.hash\);/.test(DT) && /show\(fromHash \|\| /.test(DT)
    && /if \(location\.hash !== '#sec-account' \|\| !\(signedIn === true \|\| \(window\.AUTH && AUTH\.user\)\)\) return;/.test(PJ) && /setTimeout\(\(\) => openCard\('sec-account', true\), 60\);/.test(PJ)
    && /if \(!accountOpened\) openAccountFromLink\(true\);/.test(PJ) && /addEventListener\('hashchange', openAccountFromLink\);/.test(PJ)
    && /sum\.setAttribute\('tabindex', '-1'\); sum\.focus\(\{ preventScroll: true \}\);/.test(PJ));
  check('  ...and lands below the nav and the sticky tab bar, not under them (the bar publishes its height)',
    /\.dpanel \[id\] \{ scroll-margin-top: calc\(var\(--nav-h, 58px\) \+ var\(--dtabs-h, 64px\) \+ 0\.9rem\); \}/.test(CSS) && /document\.documentElement\.style\.setProperty\('--dtabs-h', /.test(DT));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  for (const id of made) { try { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); db.prepare('DELETE FROM points_events WHERE user_id = ?').run(id); db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {} }
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
