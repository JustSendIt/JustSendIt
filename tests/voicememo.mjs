/* Voice memos: recorded in the browser, posted to the Send Wall from anywhere you can post.
 *
 * The half that matters most is the half that cannot be read: a memo has to survive the round trip and
 * come back with a type the browser will actually play. So this uploads real bytes through the real
 * route with a throwaway account, then asks for the file back and checks what the server says it is —
 * because a memo served as application/octet-stream is silent forever behind nosniff, and nothing in
 * the source would tell you that.
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import os from 'node:os';
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

const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');   // the server writes meanwhile: wait a moment, never fail with "database is locked"
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
/* The shape MediaRecorder writes: an EBML header, then a Segment and a Cluster whose sizes are "unknown"
   (all ones) because the recorder streams. The upload route now parses the container to strip metadata, so
   the fixture has to be a container, not magic bytes followed by zeros. */
const webmAudio = () => {
  const head = Buffer.concat([
    Buffer.from('1a45dfa3', 'hex'), Buffer.from([0x87]), Buffer.from('4282847765626d', 'hex'),   // EBML header: DocType "webm"
    Buffer.from('18538067', 'hex'), Buffer.from('01ffffffffffffff', 'hex'),                      // Segment, size unknown
    Buffer.from('1f43b675', 'hex'), Buffer.from('01ffffffffffffff', 'hex'),                      // Cluster, size unknown
  ]);
  return Buffer.concat([head, Buffer.alloc(2048 - head.length)]);
};
const mp4Audio = () => { const b = Buffer.alloc(2048); b.write('ftyp', 4, 'latin1'); return b; };

/* A server of this suite's own, for a setting the shared one cannot have (section 5): a port the OS hands out (never the live
   8642), a fresh data directory with its own key, every outside address dead, and a guard that refuses any fetch that would
   leave this machine. One member with a session is made in its database. */
let own = null, ownDir = null, ownLog = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function bootOwn(extraEnv) {
  const port = await (async () => { for (;;) { const p = await new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => ok(q)); }); }); if (p !== 8642) return p; } })();
  const base = 'http://localhost:' + port;
  ownDir = mkdtempSync(path.join(os.tmpdir(), 'jsi-vmoff-'));
  mkdirSync(path.join(ownDir, 'uploads'), { recursive: true });
  writeFileSync(path.join(ownDir, '.data_key'), randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
  const guard = path.join(ownDir, 'guard.mjs');
  writeFileSync(guard, `const real = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  let u = null; try { u = new URL(typeof input === 'string' ? input : (input && input.url) || String(input)); } catch {}
  if (u && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]')) return real.call(this, input, init);
  throw new TypeError('fetch failed');
};
`);
  const DEAD = 'http://127.0.0.1:9/';
  const env = { ...process.env, PORT: String(port), JSI_DATA_DIR: ownDir, DATA_DIR: ownDir, BASE_URL: base, NODE_ENV: 'test', SEED_INVITE_CODE: '12345', TOS_GATE: '0',
    TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback', SEED_CODES_OPEN: '1', DATA_KEY: '', DATA_KEY_FILE: '', BACKUP_DIR: path.join(ownDir, 'backups'), KEY_ROTATE_EXTRA_DBS: '',
    RPC_URL: DEAD, CHART_SRC_DS_URL: DEAD, CHART_SRC_GT_URL: DEAD, TOKSEARCH_GT_URL: DEAD, TOKSEARCH_DS_URL: DEAD, MC_DEXSCREENER_URL: DEAD, MC_GECKO_URL: DEAD, MC_GOPLUS_URL: DEAD,
    ETH_RPC_URL: DEAD, SOL_RPC_URL: DEAD, JUPITER_URL: DEAD, MARKET_COLLECT: '0', BLOCKSCOUT_URL: '', OUTBOUND_MAX_WAIT_MS: '2000', ANTHROPIC_API_KEY: '', ...extraEnv };
  own = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', pathToFileURL(guard).href, 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  own.stdout.on('data', (d) => { ownLog += d; }); own.stderr.on('data', (d) => { ownLog += d; });
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { if (own.exitCode != null) return null; try { up = (await fetch(base + '/healthz')).ok; } catch {} if (!up) await sleep(150); }
  if (!up) return null;
  const odb = new DatabaseSync(path.join(ownDir, 'app.db')); odb.exec('PRAGMA busy_timeout = 5000');
  odb.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run('__vm_off__', Date.now(), '🎵', Date.now(), 'ok');
  const id = odb.prepare('SELECT id FROM users WHERE username = ?').get('__vm_off__').id;
  const sid = 'tok_vmoff_' + randomBytes(8).toString('hex');
  odb.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(sid).digest('hex'), id, Date.now(), Date.now() + 864e5);
  odb.close();
  return { base, sid };
}
async function haltOwn() {
  if (own) { const s = own; own = null; const done = new Promise((r) => s.once('exit', r)); try { s.kill('SIGTERM'); } catch {} await Promise.race([done, sleep(4000)]); }
  if (ownDir) { try { rmSync(ownDir, { recursive: true, force: true }); } catch {} ownDir = null; }
}

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

    /* The unsupported-type message no longer advertises voice memos: the feature ships hidden (VOICE_MEMOS),
       and the route refuses audio with its own sentence rather than listing something it will not accept. It does name the
       wall song (MP3 or WAV), which is taken whatever VOICE_MEMOS says. */
    const UNSUPPORTED = 'unsupported media type — use JPG, PNG, WebP, GIF, MP4 or WebM (a wall song: MP3 or WAV)';
    check('an unsupported type is named without advertising a hidden feature: it lists what is taken, a wall song (MP3 or WAV) included',
      SRC.includes("if (!spec) return bad(res, '" + UNSUPPORTED + "', 415);") && !/MP4, WebM or a voice memo/.test(SRC) && !/unsupported media type[^'\n]*voice memo/.test(SRC));
    const pdf = await post('application/pdf', Buffer.from('%PDF-1.4\n' + 'x'.repeat(200)));
    check('  ...and that is what the route answers, over HTTP, with a 415', pdf.status === 415 && pdf.j.error === UNSUPPORTED, pdf.status + ' ' + pdf.j.error);
    check('and audio is refused by name when the feature is off', /voice memos are switched off/.test(SRC) && /spec\.kind === 'audio' && !VOICE_MEMOS/.test(SRC));
    check('the cap is a backstop, not the thing that governs length', /'audio\/webm': \{ ext: 'weba', kind: 'audio', cap: 8 \* 1024 \* 1024/.test(SRC));
  }

  /* ═══════════ 5. VOICE_MEMOS unset, as on the live site: a memo is refused, a wall song is not ═══════════
     run.mjs turns voice memos on for the shared server (the round trip above needs them), so this boots a throwaway server
     of its own with the switch unset — its own port and data directory, nothing off this machine — and asks it over HTTP. */
  {
    const off = await bootOwn({ VOICE_MEMOS: '' });
    if (!off) check('a server of its own (VOICE_MEMOS unset) comes up', false, ownLog.slice(-400));
    else {
      const cfg = await fetch(off.base + '/api/config').then((r) => r.json()).catch(() => ({}));
      check('a server with VOICE_MEMOS unset says voice memos are off', cfg.features && cfg.features.voiceMemos === false, JSON.stringify(cfg.features));
      const up = async (mime, body) => {
        const r = await fetch(off.base + '/api/upload', { method: 'POST', headers: { 'Content-Type': mime, Origin: off.base, Cookie: 'sid=' + off.sid }, body });
        let j = {}; try { j = await r.json(); } catch {}
        return { status: r.status, j };
      };
      const memo = await up('audio/webm', webmAudio()), memo4 = await up('audio/mp4', mp4Audio());
      check('  ...a WebM voice memo is refused with a 415, by name', memo.status === 415 && /voice memos are switched off/.test(memo.j.error || ''), memo.status + ' ' + memo.j.error);
      check('  ...and so is an MP4 one (what iOS records)', memo4.status === 415 && /voice memos are switched off/.test(memo4.j.error || ''), memo4.status + ' ' + memo4.j.error);
      const f = Buffer.alloc(417, 0); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90;   // one MPEG-1 Layer III frame (128 kbps, 44.1 kHz)
      const song = await up('audio/mpeg', Buffer.concat([f, f, f]));
      check('  ...while an MP3 wall song is taken: a wall song is not a voice memo', song.status === 200 && song.j.kind === 'song' && /\.mp3$/.test(song.j.url || ''), song.status + ' ' + (song.j.error || song.j.url));
    }
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join('\n'));
} finally {
  // throwaway rows never outlive the run
  for (const id of made) { try { db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {} }
  try { db.close(); } catch {}
  await haltOwn();   // the server of its own (by its own process), and its whole data directory
}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
