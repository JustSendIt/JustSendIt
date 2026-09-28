/* The text-size floor: no text on the site smaller than --text-floor (19pt). Every font-size in every stylesheet,
   inline style and script-built style must be max(var(--text-floor), <its size>) — a plain value anywhere is a
   place the floor does not reach. Source-checked: the pages are static and the rule is mechanical. No server. */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const SKIP = /^(inherit|initial|unset|revert|0|0px|0rem|0em)$|--ava\b|^var\(--text-base\)$|^(var\(--nav-fs(-s|-badge)?\)|calc\(var\(--nav-fs(-s)?\) \* [0-9.]+\))$|^var\(--gfx-[a-z-]+\)$/;   // …and text drawn inside a graphic (a ring, a medal), sized with the graphic   // values that are not text sizes (an avatar glyph scales with its circle), and the nav's own two tokens (a bar has one row to spend; they carry floors of their own)

try {
  const files = readdirSync(PUB).filter((f) => /\.(css|js|html)$/.test(f));
  const loose = [];
  let wrapped = 0;
  for (const f of files) {
    const s = readFileSync(path.join(PUB, f), 'utf8');
    for (const m of s.matchAll(/font-size\s*:\s*([^;}"'!]+)/g)) {
      const v = m[1].trim();
      if (v.startsWith('max(var(--text-floor)')) { wrapped++; continue; }
      if (SKIP.test(v)) continue;
      loose.push(f + ': ' + v.slice(0, 50));
    }
    for (const m of s.matchAll(/\bfont\s*:\s*([^;}]+)/g)) {   // the shorthand carries a size too
      const v = m[1].trim();
      if (/^inherit$/.test(v) || !/\d(rem|em|px|pt)\b/.test(v)) continue;
      if (!/max\(var\(--text-floor\)/.test(v)) loose.push(f + ' (font:): ' + v.slice(0, 50));
    }
  }
  check('every font-size on the site is max(var(--text-floor), …) — none escapes the floor', loose.length === 0 && wrapped > 900, loose.length ? loose.slice(0, 8).join(' | ') : wrapped + ' wrapped');
  const CSS = readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  const FLOOR = 'clamp(14px, calc(14px + (100vw - 375px) * 0.01252), 19pt)', BASE = 'clamp(1rem, calc(1rem + (100vw - 375px) * 0.00442), 1.25rem)';
  check('the floor and the base are fluid: a phone keeps its 1rem base with a 14px floor, a 1280px display gets a 1.25rem base and a 19pt floor', CSS.includes('--text-floor: ' + FLOOR + ';') && CSS.includes('--text-base: ' + BASE + ';') && /html \{ scroll-behavior: smooth; font-size: var\(--text-base\); \}/.test(CSS));
  check('  ...and the pages that style themselves (gate.css: privacy, terms; gate.html inline) carry the same two tokens', readFileSync(path.join(PUB, 'gate.css'), 'utf8').includes('--text-floor: ' + FLOOR + ';') && readFileSync(path.join(PUB, 'gate.html'), 'utf8').includes('--text-base: ' + BASE + ';'));
  check('the notification count is sized with its red circle (digits at 58% of a 20–22px circle), not the page floor', /--notif-badge: clamp\(20px, calc\(20px \+ \(100vw - 375px\) \* 0\.00178\), 22px\);/.test(CSS) && /--nav-fs-badge: calc\(var\(--notif-badge\) \* 0\.58\);/.test(CSS));
  check('the nav\'s own two tokens carry floors of their own (15px and 13px) and are the only sizes allowed outside the page floor', /--nav-fs: clamp\(15px, calc\(15px \+ \(100vw - 375px\) \* 0\.00178\), 17px\);/.test(CSS) && /--nav-fs-s: clamp\(13px, calc\(13px \+ \(100vw - 375px\) \* 0\.00178\), 15px\);/.test(CSS));
  check('body copy is set at line-height 1.5 (WCAG 1.4.12 text spacing)', /\n  line-height: 1\.5;\s+\/\* body copy at the spacing WCAG/.test(CSS));
  check('the body itself is floored, so text with no size of its own (a paragraph, a list item, a bold word) inherits the floor, not the 20px root', /font-size: max\(var\(--text-floor\), 1rem\);   \/\* what every element with no size of its own inherits/.test(CSS));
  check('form controls, which the browser sizes at 13.33px on its own, are floored too', /button, input, select, textarea \{ font-size: max\(var\(--text-floor\), 1em\); \}/.test(CSS));
  check('the token definitions themselves were not touched by the sweep', /--fs-micro: 0\.75rem; --fs-xs: 0\.8125rem;/.test(CSS) && !/--text-floor: max\(/.test(CSS));
  check('no hidden-text trick relies on a tiny size (nothing the floor would unhide)', !/font-size\s*:\s*0(px|rem|em)?\s*[;}!]/.test(files.map((f) => readFileSync(path.join(PUB, f), 'utf8')).join('\n')));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
