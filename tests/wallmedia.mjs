/* A wall's profile picture and banner, full screen; on your own wall, your Wall Style in a pop-up (owner, 2026-10-15: "Allow a
   user to pull up a full screen size view of a profile picture and banner by clicking on it, if it's someone's own profile,
   allow them to edit it directly from the full view, take the user to a pop up menu that is the wall style settings that a
   user can edit all of his send wall profile setting at once").
   Drives the real API for what the pop-up saves (each piece on its own, nothing else touched; handles tidied; isMe only for the
   owner), and reads the page code for what the browser does (checked in a muted headless Chrome when it was built). Throwaway
   rows only, removed at the end. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { ROOT, DB_PATH } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const read = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = [];
function mkUser() {
  const name = '__wm_' + randomBytes(3).toString('hex');
  db.prepare('INSERT INTO users (username, created_at, avatar, bio, holder_verified_at, holder_state) VALUES (?,?,?,?,?,?)').run(name, Date.now(), '🧪', 'my bio', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, name, sid: raw };
}
const call = async (u, method, p, body) => { const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Cookie: 'sid=' + u.sid + '; jsi_age=18', Origin: BASE }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t }; };
const row = (id) => db.prepare('SELECT avatar, bio, twitter_handle, ig_handle, accent, wall_bg FROM users WHERE id = ?').get(id);

try {
  /* ═══ 1. what the pop-up saves: each piece on its own ═══ */
  const me = mkUser(), other = mkUser();
  let r = await call(me, 'POST', '/api/profile', { avatar: '🦖' });
  check('picking an emoji in the pop-up saves just the emoji (the bio and everything else stay as they were)', r.status === 200 && row(me.id).avatar === '🦖' && row(me.id).bio === 'my bio', r.t.slice(0, 160));
  r = await call(me, 'POST', '/api/profile', { bio: 'new bio', twitter: '@x_handle', instagram: 'https://instagram.com/ighandle' });
  const rw = row(me.id);
  check('  ...the bio and links save together, the handles tidied as the pop-up shows them (no @, no pasted link)', r.status === 200 && rw.bio === 'new bio' && rw.twitter_handle === 'x_handle' && rw.ig_handle === 'ighandle' && rw.avatar === '🦖', JSON.stringify(rw));
  r = await call(me, 'POST', '/api/profile', { accent: '#7ee8fa' });
  check('  ...a colour saves alone, and comes back in the wall\'s theme', r.status === 200 && r.j && r.j.user && r.j.user.theme && r.j.user.theme.accent === '#7ee8fa' && row(me.id).bio === 'new bio', r.t.slice(0, 200));
  const mine = await call(me, 'GET', '/api/users/' + me.name), theirs = await call(other, 'GET', '/api/users/' + me.name);
  check('the editor is only ever offered to the wall\'s owner: isMe is true for them and false for anyone else', mine.j && mine.j.user && mine.j.user.isMe === true && theirs.j && theirs.j.user && theirs.j.user.isMe === false
    && mine.j.user.twitter === 'x_handle' && mine.j.user.instagram === 'ighandle', mine.status + ' ' + theirs.status);
  r = await call(other, 'POST', '/api/profile/image', { kind: 'header', remove: true });
  check('  ...and a save always changes the signed-in account\'s own wall, never the wall being looked at', r.status === 200 && row(me.id).accent === '#7ee8fa', r.t.slice(0, 120));

  // nothing is written unless everything is valid: a bad handle used to be refused AFTER the bio was saved
  r = await call(me, 'POST', '/api/profile', { bio: 'should not stick', twitter: 'not a handle!!' });
  check('a save with one bad field changes nothing (the server checks every field before it writes): the bio stays', r.status === 400 && row(me.id).bio === 'new bio', r.t.slice(0, 160));
  r = await call(me, 'POST', '/api/profile', { twitter: 'x.com/justsenditnow', instagram: 'www.instagram.com/sendit.gallery?igsh=abc' });
  check('  ...a pasted profile link with no https://, a www. or a ?query keeps just the handle, and the answer says which handles were kept',
    r.status === 200 && row(me.id).twitter_handle === 'justsenditnow' && row(me.id).ig_handle === 'sendit.gallery' && r.j.user.twitter === 'justsenditnow' && r.j.user.instagram === 'sendit.gallery', r.t.slice(0, 200));
  const SRV = readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  check('  ...and a moderator\'s takedown of an upload clears every profile and squad picture that used it (the wall then shows the emoji, not a broken picture)',
    /for \(const c of \['avatar_img', 'header_img', 'bg_img'\]\) db\.prepare\('UPDATE users SET ' \+ c \+ ' = NULL WHERE ' \+ c \+ ' = \?'\)\.run\(name\);/.test(SRV)
    && /for \(const c of \['avatar_img', 'banner_img'\]\) db\.prepare\('UPDATE squads SET ' \+ c \+ ' = NULL WHERE ' \+ c \+ ' = \?'\)\.run\(name\);/.test(SRV));

  /* ═══ 2. the page ═══ */
  const UH = read('u.html'), UP = read('upage.js'), WS = read('wallstyle.js'), PH = read('profile.html'), PJ = read('profile.js'), APP = read('app.js'), CSS = read('styles.css');
  check('a press on the picture or the banner: see-through buttons over each, described, opening a dialog (the banner\'s only when there is one, or on your own wall)',
    /<button class="wall-view wall-view--banner" id="banner-view" type="button" hidden aria-haspopup="dialog" aria-label="View the banner full screen" data-tip="Shows this banner full screen"><\/button>/.test(UH)
    && /<button class="wall-view wall-view--avatar" id="avatar-view" type="button" hidden aria-haspopup="dialog" aria-label="View the profile picture full screen" data-tip="Shows this profile picture full screen"><\/button>/.test(UH)
    && /\} else bnBtn\.hidden = true;   \/\/ nobody's banner to look at/.test(UP));
  check('  ...it opens full screen at its own shape, never cropped: a photo, a video (muted, still under reduced motion or the ⏸), or the emoji',
    /FullView\.open\(\{ title: wall\.isMe \?/.test(UP) && /img\.className = 'mv-media'; img\.src = src; img\.alt = alt;/.test(UP) && /v\.className = 'mv-media'; v\.src = src; v\.muted = true;/.test(UP)
    && /if \(!reduced\(\)\) \{ v\.autoplay = true;/.test(UP) && /e\.className = 'mv-emoji';/.test(UP) && /\.mv-media \{ display: block; max-width: 100%;[^}]*object-fit: contain;/.test(CSS));
  check('  ...on your own wall the full view has "🎨 Edit wall style", which turns the same pop-up into your Wall Style (one step back, not two)',
    /if \(wall\.isMe\) \{\n          const bar = document\.createElement\('div'\);/.test(UP) && />🎨 Edit wall style<\/button>/.test(UP) && /bar\.querySelector\('button'\)\.addEventListener\('click', \(\) => editor\(which\)\);/.test(UP)
    && /if \(FullView\.isOpen\(\)\) FullView\.swap\(o\); else FullView\.open\(/.test(UP) && /function swap\(o\) \{\n    if \(!view\) return open\(o\);/.test(APP));
  check('  ...with no banner yet, a press on your empty banner goes straight to that part of the editor',
    /if \(which === 'header' && !hasHeader\(\)\) \{ if \(wall\.isMe\) editor\('header'\); return; \}/.test(UP) && /bnBtn\.setAttribute\('aria-label', 'Add a banner — opens your wall style'\);/.test(UP));
  check('the Wall Style pop-up holds everything on the wall in one place: picture, emoji, banner, colours, background, bio and links',
    ['ws-slot-avatar', 'ws-emoji', 'ws-slot-header', 'ws-accent', 'ws-bg', 'ws-slot-background', 'ws-bio', 'ws-twitter', 'ws-instagram', 'ws-save'].every((id) => WS.includes('id="' + id + '"'))
    && /<a href="\/profile#sec-account">Settings on your dashboard →<\/a>/.test(WS) && !/id="ws-username"/.test(WS));
  check('  ...each change is painted on the wall behind at once, what was removed included — and only what changed (a video banner or background that stayed keeps playing)',
    /onTheme: \(patch\) => \{ Object\.assign\(theme, patch\); repaintWall\(theme\); paintButtons\(\); \},/.test(UP) && /function repaintWall\(t\) \{ applyTheme\(t\); \}/.test(UP)
    && /\} else \{ document\.documentElement\.style\.removeProperty\('--accent'\);/.test(UP) && /if \(v && v\.getAttribute\('src'\) === img\) return;   \/\/ the same video/.test(UP)
    && /if \(\(h\.dataset\.painted \|\| ''\) === \(src \|\| ''\)\) return;/.test(UP) && /if \(\(a\.dataset\.painted \|\| ''\) === \(src \|\| ''\)\) return;/.test(UP)
    && /if \(!v\.isConnected\) \{ document\.removeEventListener\('visibilitychange', sync\); if \(mo\) mo\.disconnect\(\);/.test(UP));
  check('  ...the emoji, bio and links too, and the nav\'s own picture follows a new emoji',
    /if \(patch\.bio !== undefined\) document\.getElementById\('pub-bio'\)\.textContent = patch\.bio \|\| 'here to send it 🚀';/.test(UP) && /paintSocials\(wall\);/.test(UP) && /AUTH\.refresh\(\)\.then\(\(\) => \{ if \(AUTH\.redraw\) AUTH\.redraw\(\); \}\)/.test(UP)
    && /'<a class="wall-soc wall-soc-x" href="https:\/\/x\.com\/' \+ esc\(u\.twitter\) \+ '"/.test(UP));
  check('one editor in two places: the dashboard\'s My Wall Style card uses the same wallstyle.js as the pop-up (loaded before each page\'s script)',
    /<script src="wallstyle\.js"><\/script>\n<script src="profile\.js"><\/script>/.test(PH) && /<script src="\/wallstyle\.js"><\/script>\n<script src="\/upage\.js"><\/script>/.test(UH)
    && /WallStyle\.imageSlot\(document\.getElementById\('slot-' \+ kind\), kind, url,/.test(PJ) && /WallStyle\.emojiPicker\(document\.getElementById\('pf-avatar-pick'\)/.test(PJ)
    && !/function uploadThemeImage|function renderSwatches|const PICKERS/.test(PJ));
  check('  ...pictures, colours and the emoji save the moment they are picked; the bio and links when a box is left, on Enter, with the button — and when the pop-up closes with something still typed',
    /window\.api\('\/api\/profile\/image', \{ method: 'POST', body: \{ kind, image: c\.toDataURL\('image\/jpeg', 0\.85\) \} \}\)/.test(WS) && /await window\.api\('\/api\/profile', \{ method: 'POST', body: \{ avatar: a \} \}\);/.test(WS)
    && /Save bio and links 💾/.test(WS) && /fields\[k\]\.addEventListener\('change', \(\) => save\(false\)\);/.test(WS) && /return \(\) => \{\n      if \(dirty\(\)\) save\(true\);/.test(WS)
    && /return WallStyle\.editor\(stage, \{/.test(UP) && /const c = o\.fill \? o\.fill\(stage\) : null;\n    view\.cleanup = typeof c === 'function' \? c : null;/.test(read('app.js')));
  check('the pop-up is a sheet: at the side of a wide screen with a light veil (the wall shows its changes beside it), the whole screen on a phone',
    /@media \(min-width: 1100px\) \{\n  \.cf\.is-panel \{ justify-content: flex-end; align-items: stretch; padding: 0; \}/.test(CSS) && /\.cf\.is-panel \.cf-backdrop \{ background: rgba\(4, 7, 4, 0\.35\);/.test(CSS)
    && /@media \(max-width: 640px\) \{ \.cf\.is-panel \.cf-dialog \{ height: 100%; \} \}/.test(CSS) && /root\.classList\.toggle\('is-panel', o\.size === 'panel'\);/.test(APP));
  check('  ...and the banner\'s button never takes a press meant for the avatar or the buttons beside it',
    /\.wall-id-top \{ position: relative; z-index: 2; \}/.test(CSS) && /\.wall-view--banner \{ z-index: 1; \}/.test(CSS) && /\.wall-view--avatar \{ z-index: 3; border-radius: 50%; \}/.test(CSS)
    && /\.wall-id-top, \.wall-id-actions \{ pointer-events: none; \}\n\.wall-avatar, \.wall-id-actions > \* \{ pointer-events: auto; \}/.test(CSS));
  check('the pop-up steps aside for a layer opened above it (the $SEND check, the wallet picker, the burn proof, a sign-in check, the age question): their Esc and Back are theirs',
    /const above = \(\) => document\.documentElement\.classList\.contains\('age-open'\) \|\| !!document\.querySelector\('#invite-overlay\[data-open\], \.wc-overlay:not\(\[hidden\]\), \.bp-overlay:not\(\[hidden\]\), #auth-modal:not\(\[hidden\]\)'\);/.test(APP)
    && /if \(above\(\)\) \{ try \{ history\.pushState\(\{ cf: 1 \}, ''\); \} catch \{\} return; \}/.test(APP) && /!root\.contains\(e\.target\) && !above\(\)\) close\('key'\);/.test(APP));
  check('  ...a video in the full view can be reached and played from the keyboard; a picture that will not load falls back to the emoji (the banner says so)',
    /iframe,video\[controls\],audio\[controls\],\[tabindex\]/.test(APP) && /if \(which === 'avatar'\) m\.replaceWith\(emoji\(\)\);/.test(UP) && /p\.textContent = 'This banner could not be loaded\.';/.test(UP)
    && /return !!theme\.header_img && !\(h && h\.dataset\.broken\);/.test(UP));
  check('the wall loads once per account: a new emoji refreshing the nav does not run the whole wall load again',
    /window\.onAuthReady = function \(user\) \{\n  const who = user \? String\(user\.username \|\| ''\) : '';\n  if \(who === wallLoadedFor\) return;/.test(UP));
  check('  ...the handle boxes take a whole pasted link (the server keeps the handle), here and on the dashboard; a refused colour puts the picker back',
    /id="ws-twitter" maxlength="200"/.test(WS) && /id="ws-instagram" maxlength="200"/.test(WS) && /id="pf-twitter" maxlength="200"/.test(PH) && /id="pf-instagram" maxlength="200"/.test(PH)
    && /const putBack = \(zone, key, was, c\) => \(\) => \{ if \(state\[key\] !== c\) return; state\[key\] = was; drawPicker\(zone\); pickerNote\(zone, ''\); \};/.test(WS));
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
