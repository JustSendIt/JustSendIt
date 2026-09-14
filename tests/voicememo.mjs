/* Voice memos: recorded in the browser, posted to the Send Wall from anywhere you can post.
 *
 * The half that matters most is the half that cannot be read: a memo has to survive the round trip and
 * come back with a type the browser will actually play. So this uploads real bytes through the real
 * route with a throwaway account, then asks for the file back and checks what the server says it is —
 * because a memo served as application/octet-stream is silent forever behind nosniff, and nothing in
 * the source would tell you that.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT, DB_PATH } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const PUB = path.join(ROOT, 'public');
const SRC = readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const VM = readFileSync(path.join(PUB, 'voicememo.js'), 'utf8');
const APP = readFileSync(path.join(PUB, 'app.js'), 'utf8');
const COMPOSE = readFileSync(path.join(PUB, 'compose.js'), 'utf8');
const WALLJS = readFileSync(path.join(PUB, 'wall.js'), 'utf8');
const UPAGE = readFileSync(path.join(PUB, 'upage.js'), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const strip = (s) => s.replace(/(^|\s)\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const VM_C = strip(VM);

const db = new DatabaseSync(DB_PATH);
const made = [];
function mkUser(name) {
  db.prepare('DELETE FROM users WHERE username=?').run(name);
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)')
    .run(name, Date.now(), '🎤', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + Math.random().toString(16).slice(2);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)')
    .run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}

// a buffer that opens with the container's real magic bytes — what the upload route verifies
const webmAudio = () => { const b = Buffer.alloc(2048); b[0] = 0x1a; b[1] = 0x45; b[2] = 0xdf; b[3] = 0xa3; return b; };
const mp4Audio = () => { const b = Buffer.alloc(2048); b.write('ftyp', 4, 'latin1'); return b; };

try {
  /* ═══════════ 1. the recorder ═══════════ */
  {
    check('one recorder, shared — not a copy per composer', /window\.VoiceMemo = \{/.test(VM_C));
    /* MediaRecorder's output is the browser's choice: Chrome and Firefox give WebM/Opus, Safari and iOS
       give MP4/AAC. Asking for one format would work on half the phones in the room. */
    check('it asks the browser what it can encode rather than assuming',
      /MediaRecorder\.isTypeSupported/.test(VM_C) && /audio\/webm;codecs=opus/.test(VM_C) && /'audio\/mp4'/.test(VM_C));
    check('  ...and tells the server the bare container, not the codec-qualified type',
      /function baseMime\(m\) \{ return String\(m \|\| ''\)\.split\(';'\)\[0\]/.test(VM_C));
    check('a browser that cannot record is not offered the button', /if \(!supported\(\)\) \{ btn\.hidden = true; return; \}/.test(VM_C));

    /* A getUserMedia track left running keeps the browser's recording indicator lit. */
    check('the microphone is released on every exit path',
      (VM_C.match(/getTracks\(\)\.forEach/g) || []).length >= 2 && /function release\(\)/.test(VM_C));
    check('  ...including a page that is hidden or left mid-recording',
      /visibilitychange[\s\S]{0,140}?rec\.stop\(\)/.test(VM_C) && /pagehide[\s\S]{0,80}?rec\.cancel\(\)/.test(VM_C));
    check('  ...and when the prompt is answered after the user gave up',
      /if \(done\) \{ try \{ s\.getTracks\(\)\.forEach/.test(VM_C));

    check('it stops itself rather than recording something nobody will hear', /cap = setTimeout\(function \(\) \{ handle\.stop\(\); \}, MAX_MS\)/.test(VM_C));
    check('  ...at two minutes', /var MAX_MS = 120000;/.test(VM));
    check('a refusal says what to do about it, not just that it failed',
      /browser is blocking the microphone for this site/.test(VM) && /No microphone found/.test(VM));
    check('a recording with no bytes is reported, never attached as silence', /if \(!blob\.size\)/.test(VM_C));
    /* The button IS the interface: press to record, press to stop. */
    check('the state is announced in words, not only in colour',
      /aria-pressed/.test(VM_C) && /announce\('Recording started'\)/.test(VM_C) && /\.is-recording/.test(readFileSync(path.join(PUB, 'styles.css'), 'utf8')));
  }

  /* ═══════════ 2. it reaches every composer ═══════════ */
  {
    for (const [where, src, btn] of [
      ['the site-wide composer', COMPOSE, '#compose-voice'],
      ['the Send Wall', WALLJS, 'post-voice'],
      ['a profile page', UPAGE, 'pc-voice'],
    ]) check('you can record from ' + where, /VoiceMemo\.wire\(\{/.test(strip(src)) && src.includes(btn));
    check('all three go through the same attach pipeline a photo uses', /window\.attachMedia\(blob, opts\.previewEl/.test(VM_C));
    check('the script is loaded on every page that can post', (() => {
      const pages = ['wall.html', 'u.html', 'index.html', 'profile.html', 'community.html', 'newpairs.html'];
      return pages.every(f => /voicememo\.js/.test(readFileSync(path.join(PUB, f), 'utf8')));
    })());
  }

  /* ═══════════ 3. the shared pipeline understands audio ═══════════ */
  {
    check('prepMedia accepts what a browser actually records',
      /type === 'audio\/webm' \|\| type === 'audio\/mp4' \|\| type === 'audio\/ogg'/.test(APP));
    check('the draft is previewable before it is sent', /kind === 'audio' \? 'audio'/.test(APP) && /node\.controls = true/.test(APP));
    check('a posted memo gets a labelled player, not a bare audio tag', /post-voice-tag/.test(APP) && /🎤 Voice memo/.test(APP));
    check('  ...that never autoplays or loops', !/post-audio[^>]*autoplay/.test(APP) && !/post-audio[^>]*loop/.test(APP));
    check('  ...and names who it is from, for a screen reader', /aria-label="Voice memo posted by/.test(APP));
  }

  /* ═══════════ 4. THE ROUND TRIP — real bytes, real route ═══════════ */
  {
    const u = mkUser('__vm_probe__');
    const post = async (mime, body) => {
      const r = await fetch(BASE + '/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': mime, Origin: BASE, Cookie: 'sid=' + u.sid },
        body,
      });
      let j = {}; try { j = await r.json(); } catch {}
      return { status: r.status, j };
    };

    const webm = await post('audio/webm', webmAudio());
    check('a WebM memo uploads', webm.status === 200 && !!webm.j.url, webm.status + ' ' + (webm.j.error || webm.j.url || ''));
    check('  ...and is stored as audio, not as a video', webm.j.kind === 'audio', webm.j.kind);
    check('  ...under an extension that says so', /\.weba$/.test(webm.j.url || ''), webm.j.url);

    const m4a = await post('audio/mp4', mp4Audio());
    check('an MP4 memo uploads too — this is what iOS records', m4a.status === 200 && /\.m4a$/.test(m4a.j.url || ''), m4a.status + ' ' + (m4a.j.error || m4a.j.url || ''));

    /* THE ONE THAT CANNOT BE READ FROM SOURCE. Every response carries nosniff, so a memo served as
       application/octet-stream is silent forever and nothing on screen explains it. */
    if (webm.j.url) {
      const got = await fetch(BASE + webm.j.url);
      const ct = (got.headers.get('content-type') || '').split(';')[0].trim();
      check('a memo is served back with a type a browser will play', got.status === 200 && ct === 'audio/webm', got.status + ' ' + ct);
      check('  ...with nosniff still on, so the type has to be right', /nosniff/.test(got.headers.get('x-content-type-options') || ''));
    }
    if (m4a.j.url) {
      const got2 = await fetch(BASE + m4a.j.url);
      check('  ...and so is the MP4 one', (got2.headers.get('content-type') || '').split(';')[0].trim() === 'audio/mp4');
    }

    // bytes that do not open with the container they claim are refused
    const lying = await post('audio/webm', Buffer.alloc(2048, 0x41));
    check('bytes that are not the container they claim are refused', lying.status !== 200, lying.status);

    check('the server names voice memos when it refuses something else', /MP4, WebM or a voice memo/.test(SRC));
    check('the cap is a backstop, not the thing that governs length', /'audio\/webm': \{ ext: 'weba', kind: 'audio', cap: 8 \* 1024 \* 1024/.test(SRC));
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join('\n'));
} finally {
  // throwaway rows never outlive the run
  for (const id of made) { try { db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {} }
  try { db.close(); } catch {}
}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
