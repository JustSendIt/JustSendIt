/* The music player's songs (owner, 2026-11-17: "Add this to the music player and show that @WisdomPrime123 made the song and when
   someone clicks on his name take the user to his x page https://x.com/WisdomPrime123. Allow the user to choose which song they
   want to play from the music player, otherwise just play all the songs in this playlist.").
   server.js PLAYLIST is the list, in the order "Play all" plays it; /api/config sends the songs whose file is on this machine
   (media.tracks). The files ship outside git, so the browser part answers /api/config and the songs itself (short tones) in a
   muted headless Chrome that blocks sound until a press: the list under ♫, picking a song (on repeat), "Play all" moving on when
   a song ends, the maker's link, Esc and a press outside, a phone's width, an older config answer, no songs, and a song that will
   not load. No rows are written. */
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
// MUSIC_SHOT_DIR=<dir>: also save what the walk looks like at its main moments (for a person to look at; nothing is checked from them)
const SHOT = process.env.MUSIC_SHOT_DIR || '';
const SONG = { id: 'send-it', src: '/assets/send-it-wisdomprime123.m4a', title: 'SEND IT 🚀', by: { name: '@WisdomPrime123', url: 'https://x.com/WisdomPrime123' } };

/* ─── 1. the list and what /api/config says ─── */
const SERVER = read('server.js');
const PL = SERVER.match(/const PLAYLIST = \[\n([\s\S]*?)\n\];/);
check('server.js PLAYLIST: the theme first, then "SEND IT 🚀" by @WisdomPrime123, linked to https://x.com/WisdomPrime123',
  !!PL && /\{ id: 'theme', file: 'justsendit-audio\.m4a', title: 'Just \$Send It'/.test(PL[1])
  && /\{ id: 'send-it', file: 'send-it-wisdomprime123\.m4a', title: 'SEND IT 🚀', note: '', by: \{ name: '@WisdomPrime123', url: 'https:\/\/x\.com\/WisdomPrime123' \} \}/.test(PL[1])
  && PL[1].indexOf("id: 'theme'") < PL[1].indexOf("id: 'send-it'"), PL && PL[1]);
check('  ...each song\'s file is kept out of git, as the theme\'s is (its rights are its maker\'s)',
  /^public\/assets\/justsendit-audio\.m4a$/m.test(read('.gitignore')) && /^public\/assets\/send-it-wisdomprime123\.m4a$/m.test(read('.gitignore')));
const real = await (await fetch(BASE + '/api/config')).json();
const files = [['theme', 'justsendit-audio.m4a'], ['send-it', 'send-it-wisdomprime123.m4a']].filter(([, f]) => existsSync(path.join(ROOT, 'public', 'assets', f))).map(([id]) => id);
check('/api/config lists exactly the songs whose file is on this machine, in the list\'s order, each with its address, title and maker',
  real.media && Array.isArray(real.media.tracks) && JSON.stringify(real.media.tracks.map((t) => t.id)) === JSON.stringify(files)
  && real.media.tracks.every((t) => t.src === '/assets/' + (t.id === 'theme' ? 'justsendit-audio.m4a' : 'send-it-wisdomprime123.m4a') && typeof t.title === 'string')
  && real.media.tracks.filter((t) => t.id === 'send-it').every((t) => JSON.stringify(t.by) === JSON.stringify(SONG.by)), JSON.stringify(real.media));

/* ─── 2. in a real browser ─── */
function toneWav(secs, hz) {   // a song a browser really plays: a tone, 8 kHz mono 16-bit PCM
  const rate = 8000, n = Math.round(rate * secs), pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * hz) * 6000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
function findChrome() {
  const c = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return c.find((p) => p && existsSync(p)) || null;
}
const CHROME = findChrome();
const THEME_T = { id: 'theme', src: '/assets/justsendit-audio.m4a', title: 'Just $Send It', note: 'the site’s theme', by: null };
// what this walk's /api/config says about media, and which song addresses answer 404
let MEDIA = { audio: true, tracks: [THEME_T, SONG] }, MISSING = new Set();
const TONES = { '/assets/justsendit-audio.m4a': toneWav(1.6, 440), '/assets/send-it-wisdomprime123.m4a': toneWav(1.6, 660) };
let chrome = null, chromeDir = null, ws = null, session = null, seq = 0;
const pend = new Map(), pageErrors = [], asked = [];
const cdp = (method, params = {}, sid = session) => new Promise((ok, bad) => { const id = ++seq; pend.set(id, { ok, bad, method }); ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
function answer(url) {
  const p = new URL(url).pathname;
  if (p === '/api/config') return { code: 200, type: 'application/json', body: Buffer.from(JSON.stringify(Object.assign({}, real, { media: Object.assign({}, real.media, MEDIA) }))) };
  if (TONES[p]) { asked.push(p); return MISSING.has(p) ? { code: 404, type: 'text/plain', body: Buffer.from('not found') } : { code: 200, type: 'audio/wav', body: TONES[p] }; }
  return null;
}
async function startChrome() {
  chromeDir = mkdtempSync(path.join(os.tmpdir(), 'jsi-music-'));
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
      const hit = answer(d.params.request.url);
      cdp(hit ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest', hit
        ? { requestId: d.params.requestId, responseCode: hit.code, responseHeaders: [{ name: 'Content-Type', value: hit.type }, { name: 'Cache-Control', value: 'no-store' }], body: hit.body.toString('base64') }
        : { requestId: d.params.requestId }).catch(() => {});
    }
    else if (d.method === 'Runtime.exceptionThrown') pageErrors.push(((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description) || d.params.exceptionDetails.text || '').split('\n')[0]);
  };
  const t = await cdp('Target.createTarget', { url: 'about:blank' }, null);
  session = (await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  // the player's Audio is never in the page: the walk keeps a handle on each one made, to read where a song starts (test only)
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: '(() => { const A = window.Audio; window.__audios = []; window.Audio = function (src) { const a = new A(src); a.__starts = []; a.addEventListener("playing", () => a.__starts.push({ src: a.getAttribute("src"), t: a.currentTime })); window.__audios.push(a); return a; }; window.Audio.prototype = A.prototype; })();' });
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*/api/config*' }, { urlPattern: '*/assets/justsendit-audio.m4a*' }, { urlPattern: '*/assets/send-it-wisdomprime123.m4a*' }] });
}
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}
async function until(expr, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(60); }
  return null;
}
// a real press with the mouse in the middle of what the selector names (refused when something else is on top of it)
async function press(sel) {
  const at = await ev('(() => { const e = document.querySelector(' + JSON.stringify(sel) + '); if (!e) return null; const b = e.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2, top = document.elementFromPoint(x, y);'
    + ' return { x, y, ok: !!top && (top === e || e.contains(top)), top: top ? (top.id || top.className || top.tagName) : null }; })()');
  if (!at || !at.ok) throw new Error('cannot press ' + sel + ': ' + JSON.stringify(at));
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
}
async function shot(name) {
  if (!SHOT) return;
  try { mkdirSync(SHOT, { recursive: true }); const r = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(SHOT, name + '.png'), Buffer.from(r.data, 'base64')); } catch {}
}
async function key(k, code, vk, text) { await cdp('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }, text ? { text } : {})); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); }
// the About page, a first visit (nothing kept), the 18+ answer given
async function open(width = 1280, keepStorage = false) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: BASE });
  if (!keepStorage) { await cdp('Page.navigate', { url: BASE + '/about' }); await until('document.readyState === "complete"'); await ev('localStorage.clear(), true'); }
  await cdp('Page.navigate', { url: BASE + '/about' });
  await until('document.readyState === "complete"');
  return until('!!document.getElementById("mp-toggle") || (window.__mpDone = (window.__mpDone || 0) + 1) > 40', 6000);
}
const STATE = `(() => { const w = document.getElementById("music-player"); if (!w) return null; const t = document.getElementById("mp-toggle"), by = document.getElementById("mp-by"), m = document.getElementById("mp-menu"), s = document.getElementById("mp-songs");
  return { name: w.querySelector(".mp-name").textContent, by: by && !by.hidden ? { t: by.textContent, href: by.getAttribute("href"), target: by.getAttribute("target"), rel: by.getAttribute("rel") } : null,
    playing: t.getAttribute("aria-pressed") === "true", label: t.getAttribute("aria-label"), songs: !!s, open: !!m && !m.hidden, exp: s ? s.getAttribute("aria-expanded") : null, focus: document.activeElement && document.activeElement.id,
    pick: localStorage.getItem("mp-pick"), track: localStorage.getItem("mp-track") }; })()`;
const MENU = `[...document.querySelectorAll("#mp-menu .mp-opt")].map((b) => { const r = b.getBoundingClientRect(), row = b.closest(".mp-row"), a = row && row.querySelector(".mp-by"), ar = a && a.getBoundingClientRect();
  return { id: b.dataset.mpPick, t: b.textContent, on: b.getAttribute("aria-pressed"), h: Math.round(r.height), tip: (b.dataset.tip || "").length, by: a ? { t: a.textContent, href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel"), h: Math.round(ar.height), tip: (a.dataset.tip || "").length } : null }; })`;

if (!CHROME) check('the browser part (no Chrome on this machine to run it)', false, 'set CHROME_PATH');
else try {
  await startChrome();

  await open(1280);
  const s0 = await ev(STATE);
  check('with two songs the player has ♫ beside ▶ (closed), and names the first song, the theme — with no maker line, as it has none',
    s0 && s0.songs && !s0.open && s0.exp === 'false' && s0.name === 'Just $Send It' && s0.by === null && !s0.playing && s0.label === 'Play the music: Just $Send It', JSON.stringify(s0));
  await press('#mp-songs'); await until('!document.getElementById("mp-menu").hidden');
  const m0 = await ev(MENU), s1 = await ev(STATE);
  await shot('list-1280');
  const song = m0.find((x) => x.id === 'send-it') || {};
  check('♫ opens the list: "Play all, in order" (chosen — what plays unless a song is picked), the theme and "SEND IT 🚀", each a button that says what it does, 44 px or taller',
    s1.open && s1.exp === 'true' && m0.map((x) => x.id).join() === 'all,theme,send-it' && m0[0].on === 'true' && m0.slice(1).every((x) => x.on === 'false') && /Play all, in order/.test(m0[0].t)
    && /^SEND IT 🚀/.test(song.t) && m0.every((x) => x.h >= 44 && x.tip >= 8) && s1.focus === 'mp-songs', JSON.stringify({ m0, focus: s1.focus }));
  check('  ...beside "SEND IT 🚀" its maker, "by @WisdomPrime123", a link to https://x.com/WisdomPrime123 that opens in a new tab (noopener), 44 px tall',
    song.by && song.by.t === 'by @WisdomPrime123' && song.by.href === 'https://x.com/WisdomPrime123' && song.by.target === '_blank' && /noopener/.test(song.by.rel) && song.by.h >= 44 && song.by.tip >= 8, JSON.stringify(song.by));
  await press('#mp-menu [data-mp-pick="send-it"]');
  const s2 = await until('(() => { const s = ' + STATE + '; return s && s.playing && s.name === "SEND IT 🚀" ? s : null; })()');
  check('picking "SEND IT 🚀" plays it (a press is the visitor choosing it), shows its title with "by @WisdomPrime123" under it, linked to their X page, and closes the list',
    s2 && s2.by && s2.by.t === 'by @WisdomPrime123' && s2.by.href === 'https://x.com/WisdomPrime123' && s2.by.target === '_blank' && /noopener/.test(s2.by.rel) && !s2.open && s2.exp === 'false'
    && s2.pick === 'send-it' && s2.track === 'send-it' && s2.label === 'Pause the music: SEND IT 🚀 by @WisdomPrime123', JSON.stringify(s2));
  await sleep(2600);   // longer than the 1.6 s song: a picked song plays on repeat
  const s3 = await ev(STATE);
  await shot('playing-send-it-1280');
  check('  ...a picked song plays on repeat: after it has run out it is still the one playing', s3.playing && s3.name === 'SEND IT 🚀' && s3.track === 'send-it', JSON.stringify(s3));
  await press('#mp-songs'); await until('!document.getElementById("mp-menu").hidden');
  const onPick = await ev('document.querySelector("#mp-menu [aria-pressed=\\"true\\"]").dataset.mpPick');
  const playMark = await ev('(document.querySelector("#mp-menu [data-mp-pick=\\"send-it\\"]") || {}).textContent');
  await press('#mp-menu [data-mp-pick="all"]');
  const s4 = await ev(STATE);
  const s5 = await until('(() => { const s = ' + STATE + '; return s && s.playing && s.name === "Just $Send It" ? s : null; })()', 6000);
  check('"Play all, in order" keeps the song playing and, when it ends, moves on — after the last song the first (the theme), still playing',
    onPick === 'send-it' && /· playing/.test(playMark) && s4.pick === 'all' && s4.name === 'SEND IT 🚀' && s4.playing && s5 && s5.by === null && s5.track === 'theme', JSON.stringify({ onPick, playMark, s4, s5 }));
  const s6 = await until('(() => { const s = ' + STATE + '; return s && s.playing && s.name === "SEND IT 🚀" ? s : null; })()', 6000);
  check('  ...and the theme ending hands on to "SEND IT 🚀"', !!s6, JSON.stringify(await ev(STATE)));

  await ev('document.getElementById("mp-songs").focus(), true'); await key('Enter', 'Enter', 13, '\r'); await until('!document.getElementById("mp-menu").hidden');
  const kf = await ev('document.activeElement && document.activeElement.dataset.mpPick');
  await key('Escape', 'Escape', 27); await sleep(150);
  const esc = await ev(STATE);
  await press('#mp-songs'); await until('!document.getElementById("mp-menu").hidden');
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 900, y: 300, button: 'left', clickCount: 1 }); await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 900, y: 300, button: 'left', clickCount: 1 }); await sleep(150);
  const out = await ev(STATE);
  check('opened from the keyboard (Enter on ♫) the chosen choice has the focus; Esc closes the list and gives ♫ the focus back; a press anywhere else closes it too',
    kf === 'all' && !esc.open && esc.focus === 'mp-songs' && esc.exp === 'false' && !out.open && out.exp === 'false', JSON.stringify({ kf, esc, out }));
  await press('#mp-toggle'); await sleep(150);
  const paused = await ev(STATE);
  await open(1280, true);
  const kept = await ev(STATE);
  check('pausing keeps it off; the next page remembers the choice ("Play all") and the song it was on, and stays quiet',
    !paused.playing && kept && !kept.playing && kept.pick === 'all' && kept.name === paused.name && (await ev('localStorage.getItem("mp-on")')) === '0', JSON.stringify({ paused, kept }));

  // a picked song starts at its own start: the place kept belongs to the song before it (the browser keeps an unread seek as the next start)
  await open(1280);
  await ev('localStorage.setItem("mp-track", "theme"); localStorage.setItem("mp-pos", "1.2"); localStorage.setItem("mp-on", "0"), true');
  await open(1280, true);
  await press('#mp-songs'); await until('!document.getElementById("mp-menu").hidden');
  await press('#mp-menu [data-mp-pick="send-it"]');
  await until('(() => { const s = ' + STATE + '; return s && s.playing && s.name === "SEND IT 🚀" ? s : null; })()');
  // where it was when it began to play (read at that moment: a 1.6 s tone on repeat is back at 0 soon after)
  const startAt = await until('(() => { const a = window.__audios[0]; const s = a && a.__starts.find((x) => /send-it/.test(x.src)); return s ? String(s.t) : null; })()');
  check('a song picked from the list starts at its start — never at the place kept for the song before it (1.2 s into the theme here)', startAt != null && Number(startAt) < 0.3, String(startAt));
  // the keyboard leaving the open list closes it
  await press('#mp-toggle'); await sleep(100);
  await ev('document.getElementById("mp-songs").focus(), true'); await key('Enter', 'Enter', 13, '\r'); await until('!document.getElementById("mp-menu").hidden');
  for (let i = 0; i < 8 && (await ev('document.getElementById("music-player").contains(document.activeElement)')); i++) { await key('Tab', 'Tab', 9); await sleep(60); }
  const left = await ev(STATE);
  check('  ...and Tab out of the open list closes it (never left open over the page with the focus gone)', !left.open && left.exp === 'false', JSON.stringify(left));
  // folded, the capsule is one height whichever song is current (the maker's line takes no room)
  const hOf = async () => { await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1000, y: 200, button: 'none' }); await ev('document.activeElement && document.activeElement.blur && document.activeElement.blur(), true'); await sleep(350); return ev('Math.round(document.getElementById("music-player").getBoundingClientRect().height)'); };
  const hSend = await hOf();
  await open(1280);
  const hTheme = await hOf();
  check('  ...folded, the player is the same height whether the song has a maker\'s line or not', hSend === hTheme && hSend > 0, hSend + ' vs ' + hTheme);

  // a phone: ▶ and ♫ only; the list fits the screen
  await open(390);
  await press('#mp-songs'); await until('!document.getElementById("mp-menu").hidden');
  const ph = await ev('(() => { const m = document.getElementById("mp-menu").getBoundingClientRect(), t = document.getElementById("mp-toggle"), s = document.getElementById("mp-songs"); return { l: m.left, r: m.right, top: m.top, sw: document.documentElement.scrollWidth, iw: innerWidth, t: [t.offsetWidth, t.offsetHeight], s: [s.offsetWidth, s.offsetHeight], title: getComputedStyle(document.querySelector("#music-player .mp-title")).display }; })()');
  const phm = await ev(MENU);
  await shot('list-390');
  check('at 390 px the player is ▶ and ♫ (48 px each, the title folded away) and the list opens inside the screen with every song and the maker\'s link — no sideways scroll',
    ph.l >= 0 && ph.r <= ph.iw && ph.top >= 0 && ph.sw <= ph.iw && ph.t[0] >= 44 && ph.t[1] >= 44 && ph.s[0] >= 44 && ph.s[1] >= 44 && ph.title === 'none'
    && phm.length === 3 && phm.every((x) => x.h >= 44) && phm[2].by && phm[2].by.href === 'https://x.com/WisdomPrime123', JSON.stringify({ ph, phm }));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: true }); await sleep(200);
  const p320 = await ev('(() => { const m = document.getElementById("mp-menu").getBoundingClientRect(); return { l: m.left, r: m.right, sw: document.documentElement.scrollWidth, iw: innerWidth }; })()');
  check('  ...and at 320 px', p320.l >= 0 && p320.r <= p320.iw && p320.sw <= p320.iw, JSON.stringify(p320));

  // an older /api/config with no list: the theme alone, no ♫; a server with no song files: no player at all
  MEDIA = { audio: true, tracks: undefined };
  await open(1280);
  const old = await ev(STATE);
  MEDIA = { audio: false, tracks: [] };
  await open(1280);
  const none = await ev('!!document.getElementById("music-player")');
  check('an answer from before the list (media.audio only) gives the theme alone with no ♫; with no song here there is no player at all',
    old && !old.songs && old.name === 'Just $Send It' && none === false, JSON.stringify({ old, none }));
  // a song that will not load leaves the list: the next one plays, and with one song left there is no list to pick from
  MEDIA = { audio: true, tracks: [THEME_T, SONG] }; MISSING = new Set(['/assets/justsendit-audio.m4a']);
  await open(1280);
  await press('#mp-toggle');
  const gone = await until('(() => { const s = ' + STATE + '; return s && s.playing && s.name === "SEND IT 🚀" ? s : null; })()', 6000);
  MISSING = new Set();
  const lone = gone ? (await press('#mp-songs'), await until('!document.getElementById("mp-menu").hidden'), await ev(MENU)) : [];
  check('a song whose file does not load is dropped: the next song plays instead; with one song left the list has no "Play all", but ♫ stays to name its maker',
    gone && gone.songs && gone.by && gone.by.href === SONG.by.url && lone.length === 1 && lone[0].id === 'send-it' && lone[0].by && lone[0].by.href === SONG.by.url, JSON.stringify({ gone: gone || await ev(STATE), lone }));
  check('no script error on the walk', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  if (chrome) { try { ws.close(); } catch {} chrome.kill('SIGTERM'); await sleep(300); }
  if (chromeDir) { try { rmSync(chromeDir, { recursive: true, force: true }); } catch {} }
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
