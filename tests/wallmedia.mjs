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
import { ROOT, DB_PATH, DATA_DIR } from './_paths.mjs';

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
  const mp3 = (() => { const b = Buffer.alloc(417, 0); b[0] = 0xff; b[1] = 0xfb; b[2] = 0x90; b[3] = 0x00; return b; })();
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
  const uploadRaw = async (u, mime, buf) => {
    const r = await fetch(BASE + '/api/upload', { method: 'POST', headers: { 'Content-Type': mime, Cookie: 'sid=' + u.sid + '; jsi_age=18', Origin: BASE }, body: buf });
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
