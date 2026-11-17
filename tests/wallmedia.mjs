/* A wall's profile picture and banner, full screen; on your own wall, your Wall Style in a pop-up (owner, 2026-10-15: "Allow a
   user to pull up a full screen size view of a profile picture and banner by clicking on it, if it's someone's own profile,
   allow them to edit it directly from the full view, take the user to a pop up menu that is the wall style settings that a
   user can edit all of his send wall profile setting at once").
   Drives the real API for what the pop-up saves (each piece on its own, nothing else touched; handles tidied; isMe only for the
   owner), and reads the page code for what the browser does (checked in a muted headless Chrome when it was built). The wall
   song (sections 3–7): what is kept as one, reporting a wall and a moderator's takedown through the real API, and the song on a
   real wall in a muted headless Chrome that blocks sound until a press (Tab, the nav's ⏸ — before the wall opens, while the
   song plays, and the song's own ▶ under it — the visitor's own pause, the theme tune, a voice memo, 44 px on a phone, the
   Report and takedown buttons, and the moderators' queue playing a reported wall's song and taking it down). Throwaway rows
   only, removed at the end (their song files too). */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { ROOT, DB_PATH, DATA_DIR } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const read = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = [];
/* A throwaway member (the welcome tour already done, so it never covers the wall in the browser checks). With an id, the
   admin account run.mjs names in ADMIN_USER_IDS: reused when another suite left it, and then left as it was. */
const ADMIN_ID = 987654;
let adminWas = null;
function mkUser(id) {
  let name;
  const had = id ? db.prepare('SELECT id, username, onboard_state FROM users WHERE id = ?').get(id) : null;
  if (had) { name = had.username; adminWas = { id, onboard_state: had.onboard_state }; db.prepare("UPDATE users SET onboard_state = 'done' WHERE id = ?").run(id); }
  else {
    name = '__wm_' + randomBytes(3).toString('hex');
    db.prepare("INSERT INTO users (" + (id ? 'id, ' : '') + "username, created_at, avatar, bio, holder_verified_at, holder_state, onboard_state) VALUES (" + (id ? '?,' : '') + "?,?,?,?,?,?,'done')")
      .run(...(id ? [id] : []), name, Date.now(), '🧪', 'my bio', Date.now(), 'ok');
    id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
    made.push(id);
  }
  const raw = 'tok_' + name + '_' + randomBytes(8).toString('hex');
  const hashed = createHash('sha256').update(raw).digest('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(hashed, id, Date.now(), Date.now() + 864e5);
  madeSessions.push(hashed);
  return { id, name, sid: raw };
}
const madeSessions = [];
const call = async (u, method, p, body) => { const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Cookie: 'sid=' + u.sid + '; jsi_age=18', Origin: BASE }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t }; };
const row = (id) => db.prepare('SELECT avatar, bio, twitter_handle, ig_handle, accent, wall_bg FROM users WHERE id = ?').get(id);
/* A song a browser really plays: a 440 Hz tone, 8 kHz mono 16-bit PCM, `secs` long. */
function toneWav(secs, hz = 440) {
  const rate = 8000, n = rate * secs, pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * hz) * 6000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/* ─── a muted headless Chrome that blocks sound until a press (the case a wall song has to handle) ───
   --autoplay-policy=document-user-activation-required is what Safari, Firefox and a first visit to Chrome do. The theme tune
   ships outside git, so /api/config and the tune itself are answered here (a short tone), and the theme player is drawn. */
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
function findChrome() {
  const c = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return c.find((p) => p && existsSync(p)) || null;
}
const CHROME = findChrome();
let chrome = null, chromeDir = null, ws = null, session = null, seq = 0, answer = null;
const pend = new Map(), pageErrors = [];
const cdp = (method, params = {}, sid = session) => new Promise((ok, bad) => { const id = ++seq; pend.set(id, { ok, bad, method }); ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
async function startChrome() {
  chromeDir = mkdtempSync(path.join(os.tmpdir(), 'jsi-wallsong-'));
  const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + chromeDir, '--mute-audio', '--autoplay-policy=document-user-activation-required',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--lang=en-US', 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; chrome.stderr.on('data', (d) => { err += d; });
  const portFile = path.join(chromeDir, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error('Chrome did not open its debugging port: ' + err.slice(0, 300));
  const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
  ws = new WebSocket('ws://127.0.0.1:' + port + wsPath);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('could not connect to Chrome')); });
  ws.onmessage = (m) => {
    const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.bad(new Error(p.method + ' ' + JSON.stringify(d.error))) : p.ok(d.result); }
    else if (d.method === 'Fetch.requestPaused') {
      const hit = answer && answer(d.params.request.url);
      cdp(hit ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest', hit
        ? { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: hit.type }, { name: 'Cache-Control', value: 'no-store' }], body: hit.body.toString('base64') }
        : { requestId: d.params.requestId }).catch(() => {});
    }
    else if (d.method === 'Runtime.exceptionThrown') pageErrors.push(((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description) || d.params.exceptionDetails.text || '').split('\n')[0]);
  };
  const t = await cdp('Target.createTarget', { url: 'about:blank' }, null);
  session = (await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*/api/config*' }, { urlPattern: '*/assets/justsendit-audio.m4a*' }] });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'try { localStorage.clear(); } catch (e) {}' });   // every visit a first visit
}
async function ev(expr, gesture) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: !!gesture });
  if (r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}
async function until(expr, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(60); }
  return null;
}
// a real press with the mouse, in the middle of what the selector names, or `dx` px in from its left edge (refused when something else is on top of it)
async function press(sel, dx) {
  const at = await ev('(() => { const e = document.querySelector(' + JSON.stringify(sel) + '); if (!e) return null; e.scrollIntoView({ block: "center", behavior: "instant" });'
    + ' const b = e.getBoundingClientRect(), x = ' + (dx ? 'b.left + ' + Number(dx) : 'b.left + b.width / 2') + ', y = b.top + b.height / 2, top = document.elementFromPoint(x, y);'
    + ' return { x, y, ok: !!top && (top === e || e.contains(top)), top: top ? (top.id || top.className || top.tagName) : null }; })()');
  if (!at || !at.ok) throw new Error('cannot press ' + sel + ': ' + JSON.stringify(at));
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
}
async function tab() {
  const k = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...k }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}
// open a wall as `who`; resolves once its song is on the page (the start the browser refuses has had time to be refused)
async function openWall(name, who, width = 1280) {
  await cdp('Network.clearBrowserCookies');
  await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: BASE });   // the 18+ answer, so the age question does not cover the page
  if (who) await cdp('Network.setCookie', { name: 'sid', value: who.sid, url: BASE });
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await cdp('Page.navigate', { url: BASE + '/u/' + encodeURIComponent(name) });
  await until('document.readyState === "complete"');
  if (who) await until('window.AUTH && AUTH.user', 6000);
  const on = await until('(() => { const b = document.getElementById("wall-song"), a = document.getElementById("wall-song-audio"); return !!(b && !b.hidden && a && a.getAttribute("src")); })()', 10000);
  await sleep(900);
  return !!on;
}
const SONG = 'document.getElementById("wall-song-audio")';
const THEME_ON = '(() => { const b = document.getElementById("mp-toggle"); return !!b && b.getAttribute("aria-pressed") === "true"; })()';
const HIDDEN = (id) => '(() => { const b = document.getElementById("' + id + '"); return !b || b.hidden; })()';

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
    /for \(const c of \['avatar_img', 'header_img', 'bg_img', 'wall_audio'\]\) db\.prepare\('UPDATE users SET ' \+ c \+ ' = NULL WHERE ' \+ c \+ ' = \?'\)\.run\(name\);/.test(SRV)
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
  check('the Wall Style pop-up holds everything on the wall in one place: picture, emoji, banner, colours, background, song, bio and links',
    ['ws-slot-avatar', 'ws-emoji', 'ws-slot-header', 'ws-accent', 'ws-bg', 'ws-slot-background', 'ws-slot-song', 'ws-bio', 'ws-twitter', 'ws-instagram', 'ws-save'].every((id) => WS.includes('id="' + id + '"'))
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
    && /WallStyle\.audioSlot\(document\.getElementById\('slot-song'\)/.test(PJ) && /id="slot-song"/.test(PH) && /id="wall-song-audio"/.test(UH)
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

  /* ═══ 3. the wall's song: an MP3, or a WAV (a .wave file is the same container) ═══ */
  // three MPEG-1 Layer III frames (128 kbps, 44.1 kHz: 417 bytes each) — the least a stored MP3 has to open with
  const frames3 = (b1, b2) => { const f = Buffer.alloc(417, 0); f[0] = 0xff; f[1] = b1; f[2] = b2; return Buffer.concat([f, f, f]); };
  const mp3 = frames3(0xfb, 0x90);
  const wav = (() => {
    const samples = Buffer.alloc(1600, 0);
    const fmt = Buffer.alloc(24);
    fmt.write('fmt ', 0); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(1, 10);
    fmt.writeUInt32LE(8000, 12); fmt.writeUInt32LE(16000, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22);
    const data = Buffer.alloc(8 + samples.length); data.write('data', 0); data.writeUInt32LE(samples.length, 4); samples.copy(data, 8);
    const listBody = Buffer.concat([Buffer.from('INFO'), Buffer.from('INAM'), Buffer.from([8, 0, 0, 0]), Buffer.from('Secret\0\0')]);
    const list = Buffer.concat([Buffer.from('LIST'), Buffer.alloc(4), listBody]); list.writeUInt32LE(listBody.length, 4);
    const body = Buffer.concat([list, fmt, data]);
    const out = Buffer.alloc(12 + body.length); out.write('RIFF', 0); out.writeUInt32LE(4 + body.length, 4); out.write('WAVE', 8); body.copy(out, 12);
    return out;
  })();
  const tagged = (() => {
    const junk = Buffer.alloc(32, 0x41);
    const tag = Buffer.alloc(10 + junk.length); tag.write('ID3', 0); tag[3] = 3;
    tag[6] = 0; tag[7] = 0; tag[8] = 0; tag[9] = junk.length; junk.copy(tag, 10);
    return Buffer.concat([tag, mp3]);
  })();
  // each upload from an address of its own: the per-address upload budget is shared by every suite in the run
  const uploadRaw = async (u, mime, buf) => {
    const ip = '10.81.' + randomBytes(1)[0] + '.' + (1 + (randomBytes(1)[0] % 250));
    const r = await fetch(BASE + '/api/upload', { method: 'POST', headers: { 'Content-Type': mime, Cookie: 'sid=' + u.sid + '; jsi_age=18', Origin: BASE, 'X-Forwarded-For': ip }, body: buf });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t };
  };
  const songFile = (url) => url && path.join(DATA_DIR, 'uploads', url.slice('/uploads/'.length));
  let up = await uploadRaw(me, 'audio/mpeg', tagged);
  check('an MP3 uploads even with an ID3 tag in front, and the tag does not stay in the file', up.status === 200 && up.j && /\.mp3$/.test(up.j.url || '') && up.j.kind === 'song', up.t.slice(0, 160));
  if (up.j && up.j.url) {
    const kept = readFileSync(songFile(up.j.url));
    check('  ...the stored file opens on the audio frame, with the tag gone', kept[0] === 0xff && kept[1] === 0xfb && !kept.includes(Buffer.from('ID3')) && kept.length === mp3.length, 'len ' + kept.length);
  }
  let claim = await call(me, 'POST', '/api/profile/audio', { audio: up.j && up.j.url });
  const pub = await call(other, 'GET', '/api/users/' + me.name);
  check('claiming it sets the song on your wall, and anyone reading the wall is given the same file', claim.status === 200 && claim.j && claim.j.url === (up.j && up.j.url)
    && pub.j && pub.j.user && pub.j.user.theme && pub.j.user.theme.wall_audio === claim.j.url, (claim.t || '').slice(0, 160));
  const served = claim.j && claim.j.url ? await fetch(BASE + claim.j.url) : null;
  check('  ...and the file is served as audio a browser will play', !!served && served.status === 200 && (served.headers.get('content-type') || '').startsWith('audio/mpeg'), served && served.headers.get('content-type'));
  const posted = await call(me, 'POST', '/api/posts', { text: 'not a song post', image: claim.j && claim.j.url });
  check('a wall song cannot be attached to a post', posted.status === 400 && posted.j && /wall song/.test(posted.j.error || ''), (posted.t || '').slice(0, 160));
  up = await uploadRaw(me, 'audio/wave', wav);
  check('a .wave file, sent as audio/wave, is stored as a wav', up.status === 200 && up.j && /\.wav$/.test(up.j.url || '') && up.j.kind === 'song', up.t.slice(0, 160));
  if (up.j && up.j.url) {
    const kept = readFileSync(songFile(up.j.url));
    check('  ...the LIST/INFO chunk (a name, a place) is stripped and the sound remains', !kept.includes(Buffer.from('Secret')) && !kept.includes(Buffer.from('LIST')) && kept.includes(Buffer.from('fmt ')) && kept.includes(Buffer.from('data')), 'len ' + kept.length);
    const got = await fetch(BASE + up.j.url);
    check('  ...and it is served as audio/wav', got.status === 200 && (got.headers.get('content-type') || '').startsWith('audio/wav'), got.headers.get('content-type'));
  }
  claim = await call(me, 'POST', '/api/profile/audio', { audio: up.j && up.j.url });
  const swapped = await call(other, 'GET', '/api/users/' + me.name);
  check('replacing the song points the wall at the new file', claim.status === 200 && swapped.j && swapped.j.user.theme.wall_audio === (up.j && up.j.url) && swapped.j.user.theme.wall_audio.endsWith('.wav'), (claim.t || '').slice(0, 120));
  const gone = await call(me, 'POST', '/api/profile/audio', { remove: true });
  const silent = await call(other, 'GET', '/api/users/' + me.name);
  check('removing the song leaves the wall silent', gone.status === 200 && gone.j && gone.j.url === null && silent.j && silent.j.user.theme.wall_audio === null, (gone.t || '').slice(0, 120));
  const junk = await uploadRaw(me, 'audio/mpeg', Buffer.alloc(64, 0x41));
  check('bytes that are not an MP3 are refused', junk.status === 400, junk.t.slice(0, 120));
  const notWave = Buffer.alloc(64, 0); notWave.write('RIFF', 0); notWave.write('AVI ', 8);
  const avi = await uploadRaw(me, 'audio/wav', notWave);
  check('a RIFF file that is not a WAVE is refused', avi.status === 400, avi.t.slice(0, 120));
  const PLAYER = read('player.js');
  check('the settings card and the wall both offer the song, and the site theme steps aside while it plays',
    /accept="\.mp3,\.wav,\.wave,audio\/mpeg,audio\/wav,audio\/wave,audio\/x-wav"/.test(WS)
    && /function paintSong\(src\)/.test(UP) && /paintSong\(t\.wall_audio\)/.test(UP)
    && /jsi:wall-song/.test(PLAYER)
    && /function wallSongOn\(\)/.test(PLAYER)
    && /if \(wallSongOn\(\)\) \{ if \(!audio\.paused\) \{ audio\.pause\(\); setUI\(false\); \} hideHint\(\); return false; \}/.test(PLAYER)
    && /await audio\.play\(\);\n        \/\* The wall song can arrive while this play\(\) is still settling/.test(PLAYER)
    && /if \(wallSongOn\(\)\) \{ audio\.pause\(\); setUI\(false\); hideHint\(\); return false; \}/.test(PLAYER)
    && /jsi:wall-song', \(\) => \{ if \(!audio\.paused\) \{ audio\.pause\(\); setUI\(false\); \} hideHint\(\); \}/.test(PLAYER)
    && /if \(optedOut\(\) \|\| wallSongOn\(\)\) return;/.test(PLAYER));

  /* ═══ 4. what is kept as a wall song: audio a browser plays, every tag gone (review WS-8) ═══ */
  const songName = (u) => u && u.j && u.j.url ? u.j.url.slice('/uploads/'.length) : '';
  const syncJunk = Buffer.concat([Buffer.from([0xff, 0xe0]), Buffer.alloc(2000, 0x41)]);   // one sync word (a reserved version and layer), then anything
  up = await uploadRaw(me, 'audio/mpeg', syncJunk);
  check('an "MP3" that is one sync word and then anything is refused, and the refusal says what a wall song has to be', up.status === 400 && /MP3/.test((up.j && up.j.error) || '') && /WAV/.test((up.j && up.j.error) || ''), up.t.slice(0, 160));
  up = await uploadRaw(me, 'audio/mpeg', frames3(0xfd, 0x90));   // MPEG-1 Layer II: not what an .mp3 is, and browsers do not play it as one
  check('  ...so is MPEG audio that is not Layer III, even three frames of it', up.status === 400, up.t.slice(0, 160));
  up = await uploadRaw(me, 'audio/mpeg', Buffer.concat([frames3(0xfb, 0x90).subarray(0, 417), Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(300, 0x41)]));
  check('  ...and one good frame followed by something that is not the next frame', up.status === 400, up.t.slice(0, 160));
  const apeTag = (() => {   // an APEv2 tag, header and footer: 32 + items + 32
    const item = Buffer.concat([Buffer.alloc(8), Buffer.from('Artist\0'), Buffer.from('SecretStudio')]); item.writeUInt32LE(12, 0);
    const hf = (head) => { const b = Buffer.alloc(32); b.write('APETAGEX', 0); b.writeUInt32LE(2000, 8); b.writeUInt32LE(item.length + 32, 12); b.writeUInt32LE(1, 16); b.writeUInt32LE((0x80000000 | (head ? 0x20000000 : 0)) >>> 0, 20); return b; };
    return Buffer.concat([hf(true), item, hf(false)]);
  })();
  const lyrics3 = (() => { const body = Buffer.from('LYRICSBEGININD0000211LYR00012SecretLyrics'); return Buffer.concat([body, Buffer.from(String(body.length).padStart(6, '0') + 'LYRICS200')]); })();
  const id3v1 = Buffer.concat([Buffer.from('TAG'), Buffer.from('SecretTitle'), Buffer.alloc(114, 0)]);
  const id3Footed = (() => {   // an ID3v2.4 tag with a footer, the kind a tagger appends after the audio
    const body = Buffer.from('TIT2\0\0\0\x0b\0\0\x03SecretSong'), hdr = (sig) => { const b = Buffer.alloc(10); b.write(sig, 0); b[3] = 4; b[5] = 0x10; b[9] = body.length; return b; };
    return Buffer.concat([hdr('ID3'), body, hdr('3DI')]);
  })();
  up = await uploadRaw(me, 'audio/mpeg', Buffer.concat([mp3, lyrics3, apeTag, id3v1]));
  let keptSong = up.j && up.j.url ? readFileSync(songFile(up.j.url)) : Buffer.alloc(0);
  check('the tags a tagger appends after the audio come off too: a Lyrics3 block, an APE tag and an ID3v1 together leave just the frames',
    up.status === 200 && keptSong.equals(mp3) && !keptSong.includes(Buffer.from('Secret')), up.t.slice(0, 160) + ' len ' + keptSong.length);
  up = await uploadRaw(me, 'audio/mpeg', Buffer.concat([mp3, id3Footed]));
  keptSong = up.j && up.j.url ? readFileSync(songFile(up.j.url)) : Buffer.alloc(0);
  check('  ...and so does an ID3v2 tag appended at the end (the kind with a "3DI" footer)', up.status === 200 && keptSong.equals(mp3), up.t.slice(0, 160) + ' len ' + keptSong.length);
  const wavOf = (o = {}) => {
    const ch = o.ch || 1, hz = o.hz === undefined ? 8000 : o.hz, bits = o.bits || 16, tag = o.tag || 1, align = o.align || ch * bits / 8;
    const f = Buffer.alloc(o.ext ? 40 : 16);
    f.writeUInt16LE(o.ext ? 0xfffe : tag, 0); f.writeUInt16LE(ch, 2); f.writeUInt32LE(hz, 4); f.writeUInt32LE(hz * align, 8); f.writeUInt16LE(align, 12); f.writeUInt16LE(bits, 14);
    if (o.ext) { f.writeUInt16LE(22, 16); f.writeUInt16LE(bits, 18); f.writeUInt16LE(tag, 24); Buffer.from([0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71]).copy(f, 26); }
    const chunk = (id, body) => { const h = Buffer.alloc(8); h.write(id, 0); h.writeUInt32LE(body.length, 4); return Buffer.concat([h, body, Buffer.alloc(body.length % 2)]); };
    const data = chunk('data', Buffer.alloc(o.dataLen || 1600, 0)), fmt = chunk('fmt ', f), list = chunk('LIST', Buffer.from('INFOINAM\x08\0\0\0Secret\0\0'));
    const body = Buffer.concat(o.dataFirst ? [list, data, fmt] : [fmt, data]);
    const out = Buffer.alloc(12 + body.length); out.write('RIFF', 0); out.writeUInt32LE(4 + body.length, 4); out.write('WAVE', 8); body.copy(out, 12);
    return out;
  };
  up = await uploadRaw(me, 'audio/wav', wavOf({ tag: 0x55, ch: 2, hz: 44100, bits: 0, align: 1 }));
  check('a WAV that holds MP3 (format 0x55) is refused: Chrome and Firefox would show a control that never plays', up.status === 400, up.t.slice(0, 160));
  up = await uploadRaw(me, 'audio/wav', wavOf({ tag: 2, bits: 4, align: 256 }));
  check('  ...so is one in MS-ADPCM (format 2)', up.status === 400, up.t.slice(0, 160));
  up = await uploadRaw(me, 'audio/wav', wavOf({ hz: 0 }));
  check('  ...and a PCM WAV with no sample rate, or with a block size that does not match its channels and bits',
    up.status === 400 && (await uploadRaw(me, 'audio/wav', wavOf({ align: 3 }))).status === 400, up.t.slice(0, 160));
  up = await uploadRaw(me, 'audio/wav', wavOf({ ext: true, ch: 2, hz: 44100, bits: 16 }));
  const flt = await uploadRaw(me, 'audio/wav', wavOf({ tag: 3, bits: 32, hz: 48000 }));
  check('PCM in the extensible header (what many editors write) and 32-bit float WAVs are kept', up.status === 200 && flt.status === 200, up.t.slice(0, 120) + ' | ' + flt.t.slice(0, 120));
  up = await uploadRaw(me, 'audio/wav', wavOf({ dataFirst: true }));
  keptSong = up.j && up.j.url ? readFileSync(songFile(up.j.url)) : Buffer.alloc(0);
  check('  ...and one that put its sound before its format is stored format first (a browser reads the format before the sound), its LIST/INFO gone',
    up.status === 200 && keptSong.slice(12, 16).toString('latin1') === 'fmt ' && keptSong.slice(36, 40).toString('latin1') === 'data' && !keptSong.includes(Buffer.from('LIST')), up.t.slice(0, 160));

  /* ═══ 5. reporting a wall, and a moderator taking its song down (review WS-1) ═══ */
  const admin = mkUser(ADMIN_ID);
  up = await uploadRaw(me, 'audio/mpeg', mp3);
  claim = await call(me, 'POST', '/api/profile/audio', { audio: up.j && up.j.url });
  const meSong = songName(up);
  let rep = await call(other, 'POST', '/api/report', { kind: 'user', username: me.name, reason: 'not their song' });
  const repRow = db.prepare("SELECT * FROM reports WHERE reporter_id = ? AND kind = 'user' AND target_id = ?").get(other.id, me.id);
  check('a wall can be reported by its name (the page has the @name, never the account number): the report lands in the queue as that member',
    claim.status === 200 && rep.status === 200 && repRow && repRow.reason === 'not their song', (rep.t || '').slice(0, 160));
  const self = await call(me, 'POST', '/api/report', { kind: 'user', username: me.name });
  const nobody = await call(other, 'POST', '/api/report', { kind: 'user', username: '__nobody_' + randomBytes(3).toString('hex') });
  check('  ...not your own wall, and not a name nobody has', self.status === 400 && nobody.status === 404, self.status + ' ' + nobody.status);
  const queue = await call(admin, 'GET', '/api/admin/reports');
  const qRow = queue.j && (queue.j.reports || []).find((x) => x.kind === 'user' && x.target_id === me.id);
  check('the moderators\' queue gives a reported wall\'s song (its address) with the report, so it can be heard and taken down',
    qRow && qRow.target && qRow.target.wallAudio === '/uploads/' + meSong, JSON.stringify(qRow && qRow.target));
  const td = await call(admin, 'POST', '/api/admin/takedown', { kind: 'upload', name: meSong, note: 'reported by its rights holder' });
  const told = db.prepare("SELECT text FROM notifications WHERE user_id = ? AND icon = '🧹' ORDER BY id DESC").get(me.id);
  const closed = db.prepare("SELECT resolved_at, action FROM reports WHERE reporter_id = ? AND kind = 'user' AND target_id = ?").get(other.id, me.id);
  check('taking the song down silences the wall, deletes the file, tells its owner it was their wall song (with the note) and closes the reports on that wall',
    td.status === 200 && db.prepare('SELECT wall_audio FROM users WHERE id = ?').get(me.id).wall_audio === null && !existsSync(path.join(DATA_DIR, 'uploads', meSong))
      && told && /wall song/.test(told.text) && /rights holder/.test(told.text) && closed && closed.resolved_at > 0 && closed.action === 'takedown',
    (td.t || '').slice(0, 120) + ' | ' + JSON.stringify(told) + ' | ' + JSON.stringify(closed));

  /* ═══ 6. what the pages say ═══ */
  const SRV2 = readFileSync(path.join(ROOT, 'server.js'), 'utf8'), UH2 = read('u.html'), UP2 = read('upage.js'), WS2 = read('wallstyle.js'), PH2 = read('profile.html'), CSS2 = read('styles.css');
  check('a wall that is not yours has "⚑ Report" (described: its pictures, bio and song), which reports the wall by its name',
    /<button class="btn btn-ghost btn-sm" id="report-wall-btn" type="button" hidden aria-label="Report this wall" data-tip="[^"]{8,}">⚑ Report<\/button>/.test(UH2)
      && /body: \{ kind: 'user', username: uname, reason: String\(reason\)\.slice\(0, 500\) \}/.test(UP2));
  check('  ...and a moderator has "🧹 Take down song" on a wall with a song, which sends the takedown the server already had',
    /<button class="btn btn-ghost btn-sm" id="wall-song-takedown" type="button" hidden data-tip="[^"]{8,}">🧹 Take down song<\/button>/.test(UH2)
      && /api\('\/api\/admin\/takedown', \{ method: 'POST', body: \{ kind: 'upload', name, note \} \}\)/.test(UP2));
  check('the song\'s control offers no Download item, on the wall or in the settings preview (a menu item gone, not a lock: the file keeps its address)',
    /<audio id="wall-song-audio" controls controlslist="nodownload"/.test(UH2) && /a\.setAttribute\('controlslist', 'nodownload'\);/.test(WS2));
  check('the uploader says what happens: the song starts once a visitor\'s browser allows sound (usually their first tap), they can pause it, and it must be yours to share',
    !/plays when anyone opens your wall|A song plays for anyone who opens your wall/.test(WS2 + PH2)
      && (WS2.match(/once their browser allows sound/g) || []).length >= 2 && /once their browser allows sound/.test(PH2)
      && /you made or have the rights to share/.test(WS2) && /you made or have the rights to share/.test(PH2));
  check('both song controls are at least 44 px tall (2.4rem is 38.4 px on a phone)', /\.song-slot audio, \.wall-song audio \{[^}]*height: max\(44px, 2\.4rem\);/.test(CSS2));
  const ADM = read('admin.js');
  check('the moderators\' queue row for a reported wall: its @name opens the wall, its song plays there (no Download item, nothing fetched until ▶), 44 px tall',
    /'<a href="\/u\/' \+ encodeURIComponent\(t\.username\) \+ '">@' \+ esc\(t\.username\) \+ '<\/a>'/.test(ADM)
      && /<audio controls controlslist="nodownload" preload="none" src="' \+ esc\(t\.wallAudio\) \+ '"/.test(ADM) && /\.adm-song audio \{[^}]*height: max\(44px, 2\.4rem\);/.test(CSS2));
  check('  ...and "🧹 Take down song" there names the file, which the click sends as the upload takedown ({kind: \'upload\', name}), not a number',
    /data-act="takedown" data-kind="upload" data-name="' \+ esc\(songFile\) \+ '" data-tip="[^"]{8,}">🧹 Take down song<\/button>/.test(ADM)
      && /b\.dataset\.kind === 'upload' \? \{ kind: 'upload', name: b\.dataset\.name, note \} : \{ kind: b\.dataset\.kind, id: Number\(b\.dataset\.id\), note \}/.test(ADM));
  check('the nav\'s ⏸ covers the wall song: no start on open or on a first press while it is on, a press on it pauses a playing song (as the visitor\'s own pause), ▶ again starts nothing',
    (UP2.match(/if \(soundPaused\(\)\) return;/g) || []).length === 2 && /const soundPaused = \(\) => document\.documentElement\.classList\.contains\('motion-off'\);/.test(UP2)
      && /document\.addEventListener\('jsi:sfx', \(e\) => \{\n  if \(!e\.detail \|\| e\.detail\.on !== false\) return;\n  if \(wallSongDisarm\) wallSongDisarm\(\);\n  wallSongWanted = false;/.test(UP2)
      && /data-tip', 'Pauses or resumes sound effects, the ticker, floating emoji and other decorative motion, and pauses a wall\\'s song — remembered on this device'/.test(read('app.js')));
  check('the song slot\'s Upload / Replace (a .file-label, like every file picker on the site) is a 44 px target', /\.file-label \{[^}]*min-height: 44px;/.test(CSS2) && !/\.file-label \{[^}]*min-height: 40px;/.test(CSS2));
  check('the voice-memo switch\'s note no longer says every audio upload is refused: a wall song (MP3 or WAV) is taken whatever VOICE_MEMOS says',
    !/the upload route refuses audio outright/.test(SRV2) && /A wall song \(MP3 or WAV, kind 'song'\) is not a voice memo/.test(SRV2));

  /* ═══ 7. the wall in a browser that blocks sound until a press (reviews WS-2, WS-7, WS-6, WS-1) ═══ */
  let browserRan = false;
  if (!CHROME) {
    if (process.env.CI) console.log('NOTE skipping the browser checks: no Chrome or Chromium on this runner (set CHROME_PATH to run them)');
    else check('a Chrome or Chromium to play the wall in (set CHROME_PATH)', false, 'none found');
  } else {
    try { await startChrome(); browserRan = true; }
    catch (e) {
      if (process.env.CI) console.log('NOTE skipping the browser checks: Chrome would not start here (' + e.message.slice(0, 160) + ')');
      else check('headless Chrome starts and takes commands', false, e.message);
    }
  }
  if (browserRan) {
    const cfg = await (await fetch(BASE + '/api/config')).json();
    cfg.media = Object.assign({}, cfg.media, { audio: true });
    const themeTone = toneWav(6, 330);
    answer = (u) => { const pn = new URL(u).pathname; return pn === '/api/config' ? { type: 'application/json', body: Buffer.from(JSON.stringify(cfg)) } : pn === '/assets/justsendit-audio.m4a' ? { type: 'audio/wav', body: themeTone } : null; };
    const singer = mkUser(), fan = mkUser();
    up = await uploadRaw(singer, 'audio/wav', toneWav(8));
    const sung = await call(singer, 'POST', '/api/profile/audio', { audio: up.j && up.j.url });
    check('(setup) a wall with a song that plays', up.status === 200 && sung.status === 200, up.t.slice(0, 120) + ' ' + (sung.t || '').slice(0, 120));

    // one scenario at a time: a press that cannot be made fails that scenario with the reason, and the next one still runs
    const step = async (label, fn) => { try { await fn(); } catch (e) { check(label, false, String(e && e.message || e).slice(0, 220)); } };
    let noTip = null;
    await step('a keyboard visitor and a first press', async () => {
      const shown = await openWall(singer.name, fan);
      const blocked = await ev(SONG + '.paused');
      check('the wall shows its song, and this browser refused to start it on its own (as Safari, Firefox and a first visit to Chrome do)', shown && blocked === true, 'shown ' + shown + ' paused ' + blocked);
      noTip = await ev(HIDDEN('wall-song-takedown'));
      for (let i = 0; i < 4; i++) await tab();
      await sleep(600);
      check('  ...a keyboard visitor\'s Tab does not start it: moving through the page is not pressing anything', (await ev(SONG + '.paused')) === true);
      await press('#pub-bio');
      check('  ...their first press on the wall does (a click on the bio here), as the owner asked', !!(await until('!' + SONG + '.paused', 4000)) && !(await ev(THEME_ON)));
    });
    await step('a press on the nav\'s sound switch', async () => {
      await openWall(singer.name, fan);
      await press('#motion-btn'); await sleep(500);
      const afterSwitch = await ev(SONG + '.paused');
      await press('#pub-bio'); await sleep(900);
      check('a press on the nav\'s ⏸ (pause motion and sound) does not start the song, and ends the wait: the next press elsewhere does not start it either',
        afterSwitch === true && (await ev(SONG + '.paused')) === true, 'after the switch paused=' + afterSwitch);
    });
    /* The nav's ⏸ is the one switch for motion and sound, the wall song included (lead's decision, 2026-11-17). A new page that
       starts with it on (as a visitor who pressed it earlier would), and a count of every time the page's script asks the song
       to play: a browser that refuses sound until a press would hide an attempt, the count does not. */
    const MOTION_OFF = 'try { localStorage.setItem("send.motion", "off"); } catch (e) {} window.__songPlays = 0; (function () { var op = HTMLMediaElement.prototype.play;'
      + ' HTMLMediaElement.prototype.play = function () { if (this && this.id === "wall-song-audio") window.__songPlays++; return op.apply(this, arguments); }; })();';
    await step('the nav\'s ⏸ already on when the wall opens', async () => {
      const { identifier } = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: MOTION_OFF });
      try {
        const shown = await openWall(singer.name, fan);
        const st = await ev('({ off: document.documentElement.classList.contains("motion-off"), pressed: document.getElementById("motion-btn") && document.getElementById("motion-btn").getAttribute("aria-pressed"), tries: window.__songPlays, paused: ' + SONG + '.paused })');
        check('with the nav\'s ⏸ already on, the wall shows its song and never asks it to play when the wall opens', shown && st.off === true && st.pressed === 'true' && st.tries === 0 && st.paused === true, JSON.stringify(st));
        await press('#pub-bio'); await sleep(900);
        const after = await ev('({ tries: window.__songPlays, paused: ' + SONG + '.paused })');
        check('  ...nor on the visitor\'s first press elsewhere on the wall: there is no wait for one', after.tries === 0 && after.paused === true, JSON.stringify(after));
        await press('#wall-song-audio', 20);   // the control's own ▶
        check('  ...while the song\'s own ▶ still plays it, ⏸ or not: that press is the visitor choosing it', !!(await until('!' + SONG + '.paused', 4000)) && (await ev('document.documentElement.classList.contains("motion-off")')) === true);
      } finally { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
    });
    await step('the nav\'s ⏸ pressed while the song plays', async () => {
      await openWall(singer.name, fan);
      await press('#pub-bio');
      if (!(await until('!' + SONG + '.paused', 4000))) throw new Error('the song did not start on the first press');
      await press('#motion-btn'); await sleep(500);
      const pausedBySwitch = await ev(SONG + '.paused');
      await press('#pub-bio'); await sleep(900);
      const afterPress = await ev(SONG + '.paused');
      check('a playing song pauses when the nav\'s ⏸ is pressed, and stays paused: the next press on the wall does not start it again', pausedBySwitch === true && afterPress === true, 'paused by the switch ' + pausedBySwitch + ', after a press ' + afterPress);
      await press('#motion-btn'); await sleep(900);
      const back = await ev('({ off: document.documentElement.classList.contains("motion-off"), paused: ' + SONG + '.paused })');
      check('  ...and turning the ⏸ back off (its ▶) does not start it', back.off === false && back.paused === true, JSON.stringify(back));
    });
    await step('the visitor\'s own pause', async () => {
      await openWall(singer.name, fan);
      await press('#wall-song-audio', 20);   // the control's own ▶, at its left end (its presses never reach the page's listeners)
      const playedByHand = await until('!' + SONG + '.paused', 3000);
      await press('#wall-song-audio', 20); await sleep(400);   // …and its ⏸, in the same place
      const pausedByHand = await ev(SONG + '.paused');
      await press('#pub-bio'); await sleep(900);
      check('a song the visitor started and then paused with its own control stays paused when they press anywhere else', !!playedByHand && pausedByHand === true && (await ev(SONG + '.paused')) === true,
        'played ' + !!playedByHand + ' paused by hand ' + pausedByHand);
    });
    await step('the theme tune on a wall with a song', async () => {
      await openWall(singer.name, fan);
      const player = await until('!!document.getElementById("mp-toggle")', 6000);
      await press('#mp-toggle');
      const themeOn = await until(THEME_ON, 4000);
      check('on a wall with a song, the theme\'s ▶ plays the theme (a press is the visitor choosing it), and the song stays quiet', !!player && !!themeOn && (await ev(SONG + '.paused')) === true, 'player ' + !!player + ' theme ' + !!themeOn);
      await ev(SONG + '.play().then(() => true)', true);
      check('  ...and the song\'s own ▶ pauses the theme again: never two tunes at once', !!themeOn && !!(await until('!' + SONG + '.paused && !' + THEME_ON, 4000)));
      await ev('(() => { const a = document.createElement("audio"); a.src = ' + SONG + '.getAttribute("src"); document.body.appendChild(a); return a.play().then(() => true); })()', true);
      check('  ...and a voice memo (any other sound on the wall) pressed into play pauses the song', !!(await until(SONG + '.paused', 4000)));
    });
    await step('the song on a phone', async () => {
      await openWall(singer.name, fan, 375);
      const h = await ev(SONG + '.getBoundingClientRect().height');
      check('the song\'s control is at least 44 px tall on a phone', h >= 44, h);
      await openWall(singer.name, fan, 320);
      const wide = await ev('({ sw: document.documentElement.scrollWidth, iw: innerWidth })');
      check('  ...and at 320 px the wall, with its song and the Report button, never scrolls sideways', wide.sw <= wide.iw, JSON.stringify(wide));
    });
    await step('"⚑ Report" on a wall', async () => {
      await openWall(singer.name, fan);
      const rb = await ev('(() => { const b = document.getElementById("report-wall-btn"); return b ? { shown: !b.hidden, tip: b.dataset.tip || "" } : null; })()');
      if (!rb) throw new Error('no Report button on the wall');
      await ev('window.prompt = () => "not their song"; true');
      await press('#report-wall-btn');
      const reported = await until('document.getElementById("report-wall-btn").getAttribute("aria-pressed") === "true"', 4000);
      const fanRep = db.prepare("SELECT reason FROM reports WHERE reporter_id = ? AND kind = 'user' AND target_id = ?").get(fan.id, singer.id);
      check('"⚑ Report" on someone else\'s wall sends a report on that wall, with the visitor\'s reason', rb.shown && rb.tip.length >= 8 && !!reported && fanRep && fanRep.reason === 'not their song', JSON.stringify(rb) + ' ' + JSON.stringify(fanRep));
      await openWall(singer.name, singer);
      check('  ...there is no Report button on your own wall, and only a moderator sees "🧹 Take down song"',
        (await ev(HIDDEN('report-wall-btn'))) === true && noTip === true && (await ev(HIDDEN('wall-song-takedown'))) === true);
    });
    await step('the moderators\' queue: a reported wall\'s song, heard and taken down there', async () => {
      const singer2 = mkUser();
      const up2 = await uploadRaw(singer2, 'audio/wav', toneWav(4, 523));
      const set2 = await call(singer2, 'POST', '/api/profile/audio', { audio: up2.j && up2.j.url });
      const rep2 = await call(fan, 'POST', '/api/report', { kind: 'user', username: singer2.name, reason: 'not theirs to share' });
      const file2 = songName(up2);
      const rid = (db.prepare("SELECT id FROM reports WHERE reporter_id = ? AND kind = 'user' AND target_id = ? AND resolved_at IS NULL").get(fan.id, singer2.id) || {}).id;
      if (!(up2.status === 200 && set2.status === 200 && rep2.status === 200 && rid)) throw new Error('setup: ' + up2.status + ' ' + set2.status + ' ' + rep2.status + ' ' + rid);
      await cdp('Network.clearBrowserCookies');
      await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: BASE });
      await cdp('Network.setCookie', { name: 'sid', value: admin.sid, url: BASE });
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp('Page.navigate', { url: BASE + '/admin' });
      const ROW = 'document.querySelector("#adm-list [data-rid=\\"' + rid + '\\"]")';
      if (!(await until('!!' + ROW, 10000))) throw new Error('the report is not in the admin queue');
      await sleep(1500);   // the queue is drawn more than once as the page signs in, and a row arrives with a short scale-in
      const seen = await ev('(() => { const r = ' + ROW + ', a = r.querySelector("a[href^=\\"/u/\\"]"), au = r.querySelector("audio"), b = r.querySelector("button[data-kind=\\"upload\\"]");'
        + ' return { href: a && a.getAttribute("href"), name: a && a.textContent, src: au && au.getAttribute("src"), cl: au && au.getAttribute("controlslist"), pre: au && au.getAttribute("preload"), h: au && au.getBoundingClientRect().height,'
        + ' btn: b && b.textContent, file: b && b.dataset.name, tip: b ? (b.dataset.tip || "") : "" }; })()');
      check('the moderators\' queue shows a reported wall with its @name linked to the wall and its song in a player (no Download item, 44 px or taller)',
        seen.href === '/u/' + encodeURIComponent(singer2.name) && seen.name === '@' + singer2.name && seen.src === '/uploads/' + file2 && seen.cl === 'nodownload' && seen.pre === 'none' && seen.h >= 44, JSON.stringify(seen));
      await press('#adm-list [data-rid="' + rid + '"] audio', 20);   // its own ▶: a moderator hears it before deciding
      check('  ...and the song plays there', !!(await until('(() => { const a = ' + ROW + '.querySelector("audio"); return !!a && !a.paused; })()', 4000)));
      await ev('window.prompt = () => "not theirs to share"; true');
      await press('#adm-list [data-rid="' + rid + '"] button[data-kind="upload"]');
      const gone = await until('(() => { const r = ' + ROW + '; return !r; })()', 6000);
      const u2 = db.prepare('SELECT wall_audio FROM users WHERE id = ?').get(singer2.id);
      const closed2 = db.prepare('SELECT resolved_at, action FROM reports WHERE id = ?').get(rid);
      const told2 = db.prepare("SELECT text FROM notifications WHERE user_id = ? AND icon = '🧹' ORDER BY id DESC").get(singer2.id);
      check('  ..."🧹 Take down song" there (described, 8+ characters) takes it down by its file: the wall is silent, the file deleted, its owner told with the note, the report closed and gone from the open queue',
        seen.btn === '🧹 Take down song' && seen.file === file2 && seen.tip.length >= 8 && !!gone && u2 && u2.wall_audio === null && !existsSync(path.join(DATA_DIR, 'uploads', file2))
          && closed2 && closed2.resolved_at > 0 && closed2.action === 'takedown' && told2 && /wall song/.test(told2.text) && /not theirs to share/.test(told2.text),
        JSON.stringify({ gone: !!gone, u2, closed2, told2 }));
      await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: true });
      const up3 = await uploadRaw(singer2, 'audio/wav', toneWav(2, 523));
      await call(singer2, 'POST', '/api/profile/audio', { audio: up3.j && up3.j.url });
      await call(other, 'POST', '/api/report', { kind: 'user', username: singer2.name, reason: 'again' });
      const rid3 = (db.prepare("SELECT id FROM reports WHERE reporter_id = ? AND kind = 'user' AND target_id = ? AND resolved_at IS NULL").get(other.id, singer2.id) || {}).id;
      await cdp('Page.navigate', { url: BASE + '/admin' });
      const ROW3 = 'document.querySelector("#adm-list [data-rid=\\"' + rid3 + '\\"]")';
      if (!(await until('!!' + ROW3, 10000))) throw new Error('the second report is not in the admin queue');
      await sleep(1500);
      const fit = await ev('(() => { const r = ' + ROW3 + ', rr = r.getBoundingClientRect(), a = r.querySelector("audio").getBoundingClientRect(), b = r.querySelector("button[data-kind=\\"upload\\"]").getBoundingClientRect();'
        + ' return { iw: innerWidth, row: Math.round(rr.right), audio: Math.round(a.right), btn: Math.round(b.right), ah: a.height, bh: b.height }; })()');
      check('  ...and at 320 px the row\'s player and button stay inside the row and the screen, the player 44 px tall',
        fit.row <= fit.iw && fit.audio <= fit.row && fit.btn <= fit.row && fit.ah >= 44, JSON.stringify(fit));
      try { const f3 = songName(up3); if (f3) await call(admin, 'POST', '/api/admin/takedown', { kind: 'upload', name: f3, note: 'test clean-up' }); } catch {}
    });
    await step('"🧹 Take down song" for a moderator', async () => {
      await openWall(singer.name, admin);
      const tdShown = await until('!' + HIDDEN('wall-song-takedown'), 4000);
      if (!tdShown) throw new Error('a moderator sees no takedown button on a wall with a song');
      await ev('window.prompt = () => "reported by its rights holder"; true');
      await press('#wall-song-takedown');
      const silent = await until('document.getElementById("wall-song").hidden', 5000);
      const singerTold = db.prepare("SELECT text FROM notifications WHERE user_id = ? AND icon = '🧹' ORDER BY id DESC").get(singer.id);
      const fanClosed = db.prepare("SELECT resolved_at, action FROM reports WHERE reporter_id = ? AND kind = 'user' AND target_id = ?").get(fan.id, singer.id);
      check('a moderator\'s "🧹 Take down song" takes the song down: the wall goes silent at once, its owner is told why, and the report is closed',
        !!silent && db.prepare('SELECT wall_audio FROM users WHERE id = ?').get(singer.id).wall_audio === null && singerTold && /wall song/.test(singerTold.text)
          && fanClosed && fanClosed.action === 'takedown', 'silent ' + !!silent + ' ' + JSON.stringify(singerTold) + ' ' + JSON.stringify(fanClosed));
    });
    check('no script error on any of these walls', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  }
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  if (chrome) { try { ws.close(); } catch {} chrome.kill('SIGTERM'); await sleep(300); }
  if (chromeDir) { try { rmSync(chromeDir, { recursive: true, force: true }); } catch {} }
  for (const h of madeSessions) { try { db.prepare('DELETE FROM sessions WHERE token = ?').run(h); } catch {} }
  if (adminWas) { try { db.prepare('UPDATE users SET onboard_state = ? WHERE id = ?').run(adminWas.onboard_state, adminWas.id); } catch {} }
  for (const id of made) {
    try {
      db.prepare('DELETE FROM reports WHERE reporter_id = ? OR (kind = \'user\' AND target_id = ?)').run(id, id);
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM uploads WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); db.prepare('DELETE FROM points_events WHERE user_id = ?').run(id); db.prepare('DELETE FROM users WHERE id = ?').run(id);
    } catch {}
  }
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
