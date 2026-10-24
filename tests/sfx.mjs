/* The site's sound effects (public/sfx.js — owner, 2026-10-13: "make fun 8 bit sounds across the platform ... Make
   sure users can pause those sounds also through the pause button in the nav bar that also pauses animations"; 2026-10-14:
   "change the 8 bit sounds to something that is make modern game fun ... smooth game sounds that are nice to the brain").
   Source-checked: the sounds are made in the browser, so the rules are about where they may start, what can stop them, and
   that every name a feature asks for exists. No server. */
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

try {
  const SFX = read('sfx.js'), APP = read('app.js'), SLOTS = read('slots.js'), SLOTCSS = read('slots.css');
  const names = [...SFX.matchAll(/^ {4}([a-z]+): +\(\) =>/gm)].map((m) => m[1]);
  check('the sound set knows the whole vocabulary', ['tap', 'nav', 'select', 'on', 'off', 'open', 'close', 'toast', 'send', 'like', 'unlike', 'follow', 'unfollow', 'coin', 'powerup', 'success', 'error', 'warn', 'remove', 'copy', 'notify', 'launch', 'cashout', 'crash', 'secret', 'vote', 'connect', 'swap', 'scan', 'downvote', 'zip'].every((n) => names.includes(n)), names.join(','));

  // every sound a feature asks for is one the set has — a typo would otherwise be silence nobody notices
  const asked = [];
  for (const f of readdirSync(PUB).filter((x) => /\.(js|html)$/.test(x))) {
    const s = f.endsWith('.js') ? read(f).replace(/\/\*[\s\S]*?\*\//g, '') : read(f);   // a comment's example is not a use
    for (const m of s.matchAll(/SFX\.play\(([^;]*?)\)(?=\s*[;}),]|\s*$|\s*\/\/)/gm)) for (const q of m[1].matchAll(/'([a-z]+)'/g)) asked.push([f, q[1]]);   // a literal, or each side of a choice: play(on ? 'follow' : 'unfollow')
    for (const m of s.matchAll(/\.sfx = '([a-z]+)'/g)) if (m[1] !== 'none') asked.push([f, m[1]]);
    for (const m of s.matchAll(/data-sfx="([a-z]+)"/g)) if (m[1] !== 'none') asked.push([f, m[1]]);
  }
  const unknown = asked.filter(([, n]) => !names.includes(n));
  check('every SFX.play(…) and data-sfx="…" on the site names a sound the set has', !unknown.length, unknown.map((x) => x.join(':')).join(' | ') || asked.length + ' uses');
  check('  ...and the features do ask for them: posts, likes, follows, check-ins, Rocket Run, swaps, scans and the rest (300+ places)', asked.length >= 250 && ['send', 'like', 'follow', 'coin', 'powerup', 'launch', 'cashout', 'crash', 'secret', 'vote', 'connect', 'swap', 'scan', 'remove', 'notify'].every((n) => asked.some(([, x]) => x === n)), asked.length + ' uses');

  // loaded right after app.js on every page that has the nav, so sendToast exists to wrap and the ⏸ exists to pause it
  const pages = readdirSync(PUB).filter((f) => f.endsWith('.html'));
  const withApp = pages.filter((f) => /<script src="\/?app\.js"><\/script>/.test(read(f)));
  const bad = withApp.filter((f) => !/<script src="(\/?)app\.js"><\/script>\n<script src="\1sfx\.js"><\/script>/.test(read(f)));
  check('every page that loads app.js loads sfx.js straight after it', withApp.length >= 15 && !bad.length, bad.join(',') || withApp.length + ' pages');

  // one pause for motion and sound
  check('the sounds are paused exactly when motion is: html.motion-off, set by the nav ⏸', /const muted = \(\) => root\.classList\.contains\('motion-off'\);/.test(SFX) && /if \(!SITE_ON \|\| muted\(\) \|\| document\.hidden\) return false;/.test(SFX));
  check('  ...the ⏸ says so (one name, the state in aria-pressed) and tells the sounds playing now to stop',
    /b\.setAttribute\('aria-label', 'Pause motion and sound effects'\);/.test(APP) && /data-tip', 'Pauses or resumes the site\\'s sound effects, the ticker/.test(APP)
    && /document\.dispatchEvent\(new CustomEvent\('jsi:sfx', \{ detail: \{ on: !off \} \}\)\);/.test(APP) && /'Motion and sounds paused ⏸'/.test(APP));
  check('  ...and the slot machine obeys it too: no sound while paused, the reels\' whirr stopped on the press, the bulbs held still',
    /const paused = \(\) => !!\(window\.SFX && SFX\.muted\(\)\);/.test(SLOTS) && /if \(!A\.on \|\| paused\(\) \|\| document\.hidden\) return null;/.test(SLOTS) && /function cutBus\(\) \{/.test(SLOTS) && /document\.addEventListener\('jsi:sfx'/.test(SLOTS)
    && /html\.motion-off \.slot-bulbs, html\.motion-off \.slot-bulbs::after/.test(SLOTCSS));

  // owner, 2026-10-14: the 8-bit set was paused, then replaced with modern game sounds the same day — so the site switch is on,
  // and every way in still passes through it (set it false, and this check, to silence the site again)
  check('the sounds are on across the site, and the one site switch still gates every way in (a feature\'s call, a click, a menu)',
    /const SITE_ON = true;/.test(SFX) && /if \(!SITE_ON \|\| muted\(\) \|\| document\.hidden\) return false;/.test(SFX) && /if \(!SITE_ON \|\| !e\.isTrusted \|\| muted\(\)\) return;/.test(SFX) && /if \(!SITE_ON \|\| !e\.isTrusted \|\| muted\(\) \|\| e\.target\.tagName !== 'SELECT'/.test(SFX));

  // a sound only ever answers the visitor
  check('nothing sounds before the visitor\'s first gesture (a browser that cannot say counts real presses itself), and generic click sounds answer only real clicks',
    /if \(navigator\.userActivation \? !navigator\.userActivation\.hasBeenActive : !gestured\) return false;/.test(SFX) && /for \(const t of \['pointerup', 'touchend', 'mousedown', 'keydown', 'click'\]\) document\.addEventListener\(t, \(e\) => \{ if \(e\.isTrusted\) gestured = true; \}, true\);/.test(SFX) && /if \(!SITE_ON \|\| !e\.isTrusted \|\| muted\(\)\) return;/.test(SFX));
  check('  ...a feature\'s own sound replaces the click\'s generic one, and a toast right after an explicit sound stays quiet',
    /pending = setTimeout\(\(\) => \{ pending = null; if \(lastExplicit < t\) fn\(\); \}, 0\);/.test(SFX) && /if \(performance\.now\(\) - lastExplicit > 700\) sound\(/.test(SFX));
  check('the sounds are made in the page: no audio file, no fetch, no network', !/fetch\(|XMLHttpRequest|new Audio\(|['"][^'"]*\.(mp3|wav|ogg|m4a)['"]|https?:\/\//.test(SFX.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));
  check('the slot machine and the theme tune keep their own sound controls (no generic click sound on them, the tune\'s nudge included)', /const SKIP = '#slots, #music-player, #motion-btn, \[data-sfx="none"\]/.test(SFX) && /wrap\.id = 'music-player';/.test(read('player.js')));
  check('the privacy page says the sound pause is kept on this device', /colour, motion and sound settings/.test(read('privacy.html')));

  // the modern set (owner, 2026-10-14): smooth, in tune, never harsh — and a purchase is confirmed, not celebrated
  const code = SFX.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('no 8-bit chip left: only sine voices and filtered noise (no square, sawtooth or pulse waves, no bit-crusher)',
    !/'square'|'sawtooth'|'triangle'|createPeriodicWave|WaveShaper/.test(code) && /o\.type = 'sine';/.test(code));
  // what each sound is made of, read from the file itself run in a sandbox (SFX.score), not from its text
  const box = { performance: { now: () => 0 }, navigator: {}, setTimeout, clearTimeout, console };
  box.document = { documentElement: { classList: { contains: () => false } }, addEventListener() {}, readyState: 'complete', hidden: false };
  box.window = box; box.addEventListener = () => {};
  vm.runInNewContext(SFX, box);
  const S = box.SFX, VOICE_NAMES = ['pluck', 'bell', 'pop', 'whoosh', 'thump', 'tick'];
  const scores = Object.fromEntries(S.names.map((n) => [n, S.score(n)]));
  const voices = Object.entries(scores).flatMap(([n, sc]) => sc.map((x) => [n, x]));
  const badVoice = voices.filter(([, x]) => !VOICE_NAMES.includes(x.v));
  check('every sound is built from the six voices (pluck, bell, pop, whoosh, thump, tick)', S.names.length >= 31 && !badVoice.length, badVoice.map(([n, x]) => n + ':' + x.v).join(',') || voices.length + ' voices');
  const notes = voices.filter(([, x]) => x.v === 'pluck' || x.v === 'bell');
  const off = notes.filter(([, x]) => x.f != null || !Number.isInteger(x.n) || ![0, 2, 4, 7, 9].includes(x.n % 12));
  check('  ...every note (each pluck and bell, the sparkles included) is on one major pentatonic scale, given as a note, never a raw frequency', notes.length >= 80 && !off.length, off.map(([n, x]) => n + ':' + (x.n != null ? x.n : 'f' + x.f)).join(',') || notes.length + ' notes');
  const long = Object.entries(scores).filter(([, sc]) => Math.max(...sc.map((x) => (x.at || 0) + (x.d || (x.v === 'bell' ? 0.8 : x.v === 'tick' ? 0.05 : 0.3)))) > 2.2);
  check('  ...and none rings on: every sound is over within about two seconds', !long.length, long.map(([n]) => n).join(','));
  // a voice with no level of its own plays at its voice's default (o.g || default in each voice): read those from the file
  const vsrc0 = code.slice(code.indexOf('const VOICES = {'), code.indexOf('const run = '));
  const G0 = Object.fromEntries([...vsrc0.matchAll(/\n {4}([a-z]+)\(t, o\) \{[\s\S]*?o\.g \|\| ([0-9.]+)/g)].map((m) => [m[1], +m[2]]));
  const everyday = ['tap', 'select', 'nav', 'open', 'close', 'on', 'off', 'copy'].filter((n) => scores[n].some((x) => (x.g || G0[x.v]) > 0.09));
  check('  ...the everyday ones (a tap, a tab, a menu) stay quiet, a voice\'s default level counted where none is given', Object.keys(G0).length === 6 && !everyday.length, everyday.join(',') || JSON.stringify(G0));
  const swap = scores.swap;
  check('  ...a swap (buying a token) gets a calm two-voice confirmation: no bells, no sparkle, no run of notes', swap.length === 2 && !swap.some((x) => x.v === 'bell') && swap.every((x) => x.g <= 0.07), JSON.stringify(swap));
  // and nothing in the buy itself plays a reward: the signature gets 'swap', the chain's confirmation nothing of its own
  const strip = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const block = (src, head, end) => { const a = src.indexOf(head); return a < 0 ? '' : src.slice(a, src.indexOf(end, a)); };
  const HC = strip('home.js');
  // the places a buy happens: the landing page's button (home.js), its send (chain.js executeSwap) and its wait for the chain (watchSwapTx);
  // and the Swap in my wallet panel on every token's detail (swapkit.js — the whole file is the buy flow, and it plays through its own sfx())
  const SK = strip('swapkit.js');
  const buyFns = [block(HC, "swapGo.addEventListener('click'", '\n});'), block(strip('chain.js'), 'async function executeSwap', '\n}'), block(HC, 'async function watchSwapTx', '\n}'), SK];
  const buyPlays = buyFns.flatMap((b) => [...b.matchAll(/(?:SFX\.play|\bsfx)\('([a-z]+)'\)/g)].map((m) => m[1]));
  check('  ...and the buy code plays only calm sounds: swap when the wallet sends it, error or warn when something is wrong — never launch, coin, success or a fanfare',
    buyFns.every(Boolean) && buyPlays.includes('swap') && buyPlays.every((n) => ['swap', 'error', 'warn', 'select'].includes(n)), buyPlays.join(','));
  // smooth: every voice's level rises from near silence and falls back to it (env, or the whoosh's own ramps); no level is switched on or off
  const vsrc = code.slice(code.indexOf('const VOICES = {'), code.indexOf('const run = '));
  const bodies = [...vsrc.matchAll(/\n {4}([a-z]+)\(t, o\) \{([\s\S]*?)\n {4}\},/g)];
  const rough = bodies.filter(([, n, b]) => !/env\(g, t, /.test(b) && !/g\.gain\.setValueAtTime\(0\.0001, t\); g\.gain\.exponentialRampToValueAtTime\(/.test(b) || /\.gain\.value =/.test(b));
  check('  ...every voice rises from near silence and falls back to it (exponential ramps, nothing switched on or off), through a compressor',
    bodies.length === 6 && !rough.length && /g\.gain\.setValueAtTime\(0\.0001, t\);\n    g\.gain\.exponentialRampToValueAtTime\(Math\.max\(0\.0002, peak\), t \+ a\);/.test(code) && /createDynamicsCompressor\(\)/.test(code), rough.map((x) => x[1]).join(',') || bodies.length + ' voices');
  check('  ...pausing fades out (no click) and cuts loose everything queued, the room\'s echo included; waking drops what queued while asleep; one settled compressor for the page',
    /function retire\(fadeMs\) \{/.test(code) && /p\.linearRampToValueAtTime\(0, now \+ fadeMs \/ 1000\);/.test(code) && /    wire\(ctx\);\n    const drop = \(\) => \{ try \{ o\.disconnect\(\); w\.disconnect\(\); \} catch \{\} \};/.test(code)
    && (code.match(/master\(ctx\);/g) || []).length === 1 && /const k = ctx\.createConstantSource\(\); k\.offset\.value = 0; k\.connect\(comp\); k\.start\(\);/.test(code)
    && /function cut\(\) \{ if \(!C\.ctx\) return; retire\(12\);/.test(code) && /if \(C\.ctx\.state === 'suspended'\) \{ retire\(0\); C\.ctx\.resume\(\)/.test(code));
  check('  ...the long ones play at most once every 0.4–0.6 s however fast the taps come, and small repeatable taps (a hype, a sticker) get a short sound, not the launch',
    /const GAP = \{ launch: 600, powerup: 600, secret: 600, cashout: 400, crash: 400, zip: 120 \};/.test(code) && /SFX\.play\('zip'\);   \/\/ 🚀 hyped/.test(read('newpairs.js')) && (read('rocketize.js').match(/SFX\.play\('zip'\)/g) || []).length === 2);
  check('  ...a downvote sounds like a step down, not like an upvote (posts, and Sendy\'s 👎)', ['wall.js', 'upage.js'].every((f) => /SFX\.play\(j\.myVote === 1 \? 'vote' : j\.myVote === -1 \? 'downvote' : 'off'\)/.test(read(f))) && /SFX\.play\(v > 0 \? 'vote' : 'downvote'\)/.test(read('sendy.js')));
  check('  ...a dialog the feature already answered does not get a second open or close on top', /document\.addEventListener\('jsi:modalclose', \(\) => \{ if \(performance\.now\(\) - lastExplicit > 300\) SFX\.play\('close'\); \}\);/.test(code));
  check('  ...and the ⏸ is one choice per device: pressed in another tab, or before a page came back with Back, it applies here too (quietly)',
    /window\.addEventListener\('storage', \(e\) => \{ if \(e\.key === KEY\) sync\(\); \}\);/.test(APP) && /window\.addEventListener\('pageshow', \(e\) => \{ if \(e\.persisted\) sync\(\); \}\);/.test(APP));
} catch (e) {
  check('the suite ran to the end', false, e && e.message);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
