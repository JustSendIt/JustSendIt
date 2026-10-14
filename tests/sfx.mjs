/* The site's 8-bit sound effects (public/sfx.js — owner, 2026-10-13: "make fun 8 bit sounds across the platform ... Make
   sure users can pause those sounds also through the pause button in the nav bar that also pauses animations"). Source-
   checked: the sounds are made in the browser, so the rules are about where they may start, what can stop them, and
   that every name a feature asks for exists. No server. */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

try {
  const SFX = read('sfx.js'), APP = read('app.js'), SLOTS = read('slots.js'), SLOTCSS = read('slots.css');
  const names = [...SFX.matchAll(/^ {4}([a-z]+): +\(\) =>/gm)].map((m) => m[1]);
  check('the chip knows the whole vocabulary', ['tap', 'nav', 'select', 'on', 'off', 'open', 'close', 'toast', 'send', 'like', 'unlike', 'follow', 'unfollow', 'coin', 'powerup', 'success', 'error', 'warn', 'remove', 'copy', 'notify', 'launch', 'cashout', 'crash', 'secret', 'vote', 'connect', 'swap', 'scan'].every((n) => names.includes(n)), names.join(','));

  // every sound a feature asks for is one the chip can make — a typo would otherwise be silence nobody notices
  const asked = [];
  for (const f of readdirSync(PUB).filter((x) => /\.(js|html)$/.test(x))) {
    const s = f.endsWith('.js') ? read(f).replace(/\/\*[\s\S]*?\*\//g, '') : read(f);   // a comment's example is not a use
    for (const m of s.matchAll(/SFX\.play\(([^;]*?)\)(?=\s*[;}),]|\s*$|\s*\/\/)/gm)) for (const q of m[1].matchAll(/'([a-z]+)'/g)) asked.push([f, q[1]]);   // a literal, or each side of a choice: play(on ? 'follow' : 'unfollow')
    for (const m of s.matchAll(/\.sfx = '([a-z]+)'/g)) if (m[1] !== 'none') asked.push([f, m[1]]);
    for (const m of s.matchAll(/data-sfx="([a-z]+)"/g)) if (m[1] !== 'none') asked.push([f, m[1]]);
  }
  const unknown = asked.filter(([, n]) => !names.includes(n));
  check('every SFX.play(…) and data-sfx="…" on the site names a sound the chip has', !unknown.length, unknown.map((x) => x.join(':')).join(' | ') || asked.length + ' uses');
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

  // owner, 2026-10-14: "pause 8 bit sounds across the site" — off for everyone, every hook still wired; flip SITE_ON (and this check) to bring them back
  check('the 8-bit sounds are paused across the site: nothing sounds and no audio context is made, the hooks stay in place',
    /const SITE_ON = false;/.test(SFX) && /if \(!SITE_ON \|\| !e\.isTrusted \|\| muted\(\)\) return;/.test(SFX) && /if \(!SITE_ON \|\| !e\.isTrusted \|\| muted\(\) \|\| e\.target\.tagName !== 'SELECT'/.test(SFX));

  // a sound only ever answers the visitor
  check('nothing sounds before the visitor\'s first gesture, and generic click sounds answer only real clicks',
    /if \(navigator\.userActivation && !navigator\.userActivation\.hasBeenActive\) return false;/.test(SFX) && /if \(!SITE_ON \|\| !e\.isTrusted \|\| muted\(\)\) return;/.test(SFX));
  check('  ...a feature\'s own sound replaces the click\'s generic one, and a toast right after an explicit sound stays quiet',
    /pending = setTimeout\(\(\) => \{ pending = null; if \(lastExplicit < t\) fn\(\); \}, 0\);/.test(SFX) && /if \(performance\.now\(\) - lastExplicit > 700\) sound\(/.test(SFX));
  check('the sounds are made in the page: no audio file, no fetch, no network', !/fetch\(|XMLHttpRequest|new Audio\(|['"][^'"]*\.(mp3|wav|ogg|m4a)['"]|https?:\/\//.test(SFX.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));
  check('the slot machine and the theme tune keep their own sound controls (no generic click sound on them)', /const SKIP = '#slots, #mp-toggle, #motion-btn, \[data-sfx="none"\]/.test(SFX));
  check('the privacy page says the sound pause is kept on this device', /colour, motion and sound settings/.test(read('privacy.html')));
} catch (e) {
  check('the suite ran to the end', false, e && e.message);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
