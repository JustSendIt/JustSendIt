/* The site's chrome: the nav bar and the OG strip on the home page, checked from the source. No server.
   The bar has one row to spend, so its text rides its own two tokens and the menu collapses into the pop-down
   whenever the row would not fit — measured by nav.js, not guessed by width. The OG banner is a strip whose
   head is always shown and whose rest pops down on a tap. */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const CSS = read('styles.css'), NAV = read('nav.js'), HOME = read('home.js'), INDEX = read('index.html');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

try {
  /* ═══ the bar ═══ */
  check('the nav\'s text rides its own scale: links and the wordmark on --nav-fs, the pills on --nav-fs-s, every control --nav-ctl tall', /\.nav-menu a \{[^}]*font-size: var\(--nav-fs\);[^}]*min-height: var\(--nav-ctl\);/.test(CSS) && /\.nav-logo span \{[^}]*calc\(var\(--nav-fs\) \* 1\.35\)/.test(CSS) && /\.nav-live-lbl \{[^}]*var\(--nav-fs-s\)/.test(CSS) && /\.profile-link \{[^}]*font-size: var\(--nav-fs\);/.test(CSS) && /\.notif-bell \{[^}]*width: var\(--nav-ctl\); height: var\(--nav-ctl\);/.test(CSS));
  check('  ...44px tall where a finger does the pointing', /@media \(pointer: coarse\) \{ :root \{ --nav-ctl: 44px; \} \}/.test(CSS));
  check('  ...and the bar never wraps its own children (one row: logo, menu or toggle, cluster)', /\.nav \{\n  position: sticky; top: 0; z-index: 50;\n  display: flex; align-items: center; gap: 0\.75rem; flex-wrap: nowrap; min-height: 60px;/.test(CSS));
  check('the pop-down form is a class nav.js sets, not a fixed breakpoint (the old 1280px media block is gone)', /\.nav\.is-compact \.nav-menu\.open \{/.test(CSS) && /\.nav\.is-compact \.nav-toggle \{/.test(CSS) && /\.nav\.is-compact \.nav-bal \{/.test(CSS) && !/@media \(max-width: 1280px\) \{[^}]*\.nav-menu/.test(CSS));
  check('  ...pop-down links are 44px tall and may wrap; row links never wrap', /\.nav\.is-compact \.nav-menu a \{[^}]*min-height: 44px;[^}]*white-space: normal;/.test(CSS) && /\.nav-menu a \{[^}]*white-space: nowrap;/.test(CSS));
  check('nav.js measures: a row that wraps (the search box counts) or overflows becomes compact; below 900px always', /menu\.getBoundingClientRect\(\)\.height > first\.getBoundingClientRect\(\)\.height \* 1\.5/.test(NAV) && /return !wrapped && !overflowing\(\);/.test(NAV) && /if \(window\.innerWidth >= 900\) \{/.test(NAV) && /nav\.classList\.add\('is-compact'\)/.test(NAV));
  check('  ...on a wide screen the inline row is tried again without the live count and the points before the bar collapses (links first)', /else \{ nav\.classList\.add\('is-tight'\); if \(rowFits\(\)\) compact = false; else nav\.classList\.remove\('is-tight'\); \}/.test(NAV));
  check('nothing in the row is ever squashed; a row that still does not fit steps down through measured tiers', /\.nav > \*:not\(\.nav-menu\), #nav-auth\.nav-persist > \*, \.nav-profile > \* \{ flex-shrink: 0; \}/.test(CSS) && /var TIERS = \['is-tight', 'is-tighter', 'is-tightest'\];/.test(NAV) && /if \(compact\) for \(var i = 0; i < TIERS\.length && overflowing\(\); i\+\+\) nav\.classList\.add\(TIERS\[i\]\);/.test(NAV) && /\.nav\.is-tight \.nav-live/.test(CSS) && /\.nav\.is-tighter \.nav-logo span, \.nav\.is-tighter \.profile-link \.pl-name \{ display: none; \}/.test(CSS) && /\.nav\.is-tightest \.nav-xp \{ display: none; \}/.test(CSS));
  check('  ...a long @name is capped at 12 characters; no control in the bar is ever smaller than --nav-ctl (the 36px bell is gone)', /\.profile-link \.pl-name \{ display: inline-block; max-width: 12ch;/.test(CSS) && !/\.notif-bell \{ width: 36px/.test(CSS) && /\.motion-btn \{[^}]*min-width: var\(--nav-ctl\); min-height: var\(--nav-ctl\);/.test(CSS));
  check('  ...the search is on the nav scale at a control\'s height; an icon in the inline row, a full field in the pop-down', /padding: 0 1rem 0 2\.1rem; height: var\(--nav-ctl\); box-sizing: border-box; font-size: var\(--nav-fs\);/.test(CSS) && /\.nav:not\(\.is-compact\) \.nav-search \{ position: relative; width: var\(--nav-ctl\);/.test(CSS) && !/@media \(min-width: 1281px\) and \(max-width: 1599px\)/.test(CSS));
  check('  ...and measures again on resize, on sign-in, when the cluster changes size, and once the fonts are in', /window\.addEventListener\('resize', fitSoon\)/.test(NAV) && /addEventListener\('auth:change'/.test(NAV) && /new ResizeObserver\(fitSoon\)\.observe\(cluster\)/.test(NAV) && /document\.fonts\.ready\.then\(fit, fit\)/.test(NAV) && !/matchMedia\('\(min-width: 1281px\)'\)/.test(NAV));
  check('  ...publishing the bar\'s real height when the form changes (sticky sub-bars read --nav-h)', /if \(compact !== wasCompact\) syncNavHeight\(\);/.test(NAV));
  const pages = readdirSync(PUB).filter((f) => f.endsWith('.html') && /<nav class="nav/.test(readFileSync(path.join(PUB, f), 'utf8')));
  const loose = pages.filter((f) => !/<nav class="nav is-compact" /.test(readFileSync(path.join(PUB, f), 'utf8')));
  check('every page ships the bar compact, so nothing flashes before nav.js measures (' + pages.length + ' pages)', pages.length >= 15 && loose.length === 0, loose.join(', '));

  /* u.html is served under /u/<name>: a relative path there resolves to /u/<file> and is answered with the page itself */
  const rel = [...read('u.html').matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((v) => !/^(\/|#|https?:|mailto:|data:|javascript:)/.test(v));
  check('every script, stylesheet and link on u.html is absolute (the responsive layer was 404ing on every Send Wall)', rel.length === 0, rel.join(', '));

  /* ═══ notifications ═══ */
  const RESP = read('responsive.css');
  check('the count sits inside its red circle: a 20–22px circle, digits at 58% of it, one line — and responsive.css no longer forces it up to the page floor', /\.notif-badge \{[^}]*min-width: var\(--notif-badge\); height: var\(--notif-badge\);[^}]*font-size: var\(--nav-fs-badge\);[^}]*line-height: 1;[^}]*white-space: nowrap;/.test(CSS) && /\.notif-badge \{ font-size: var\(--nav-fs-badge\); \}/.test(RESP) && !/\.notif-badge \{ font-size: max\(var\(--text-floor\)/.test(RESP + CSS));
  check('the panel is pinned under the bar at the screen\'s right edge, sized in text units and capped to the screen, never taller than the screen', /\.notif-panel \{ position: fixed; top: calc\(var\(--nav-h, 60px\) \+ 8px\); right: 8px; left: auto; font-size: max\(var\(--text-floor\), 0\.95rem\); width: min\(26em, calc\(100vw - 16px\)\); max-height: calc\(100vh - var\(--nav-h, 60px\) - 24px\);/.test(CSS) && /@supports \(height: 100dvh\) \{ \.notif-panel \{ max-height: calc\(100dvh - var\(--nav-h, 60px\) - 24px\); \} \}/.test(CSS) && /@media \(max-width: 600px\) \{ \.notif-panel \{ left: 8px; right: 8px; width: auto; \} \}/.test(CSS) && !/\.notif-panel \{\n    left: 0; right: auto;/.test(CSS));
  check('  ...its text follows the page floor in em of the panel, so it grows with the screen and wraps rather than clips', /\.notif-text \{ font-size: max\(var\(--text-floor\), 1em\);[^}]*overflow-wrap: anywhere;/.test(CSS) && /\.notif-time \{ font-size: max\(var\(--text-floor\), 0\.8em\);/.test(CSS) && /\.notif-head \{[^}]*font-size: max\(var\(--text-floor\), 1em\);/.test(CSS));
  check('  ...its buttons are at least 36px, 44px under a finger', /\.notif-x \{[^}]*min-width: max\(36px, 1\.9em\); min-height: max\(36px, 1\.9em\);/.test(CSS) && /@media \(pointer: coarse\) \{ \.notif-x \{ min-width: max\(44px, 1\.9em\); min-height: max\(44px, 1\.9em\); \}/.test(CSS));
  check('  ...and while it is open the bar rises above Sendy, the compose button and the player, so no row is ever hidden under one', /\.nav:has\(#notif-panel\.open\) \{ z-index: 300; \}/.test(CSS));

  /* ═══ the OG strip ═══ */
  check('the OG banner is a strip: a button head with aria-expanded/aria-controls, and the rest hidden until tapped', /<button class="og-banner-head" id="og-banner-head" type="button" aria-expanded="false" aria-controls="og-banner-more" data-tip="/.test(INDEX) && /<div class="og-banner-more" id="og-banner-more" hidden>/.test(INDEX) && !/<a class="og-banner"/.test(INDEX));
  check('  ...the head carries the medal, the title, one line, the live countdown and a chevron', /<span class="og-banner-title">Become an <span class="og-word">OG<\/span>/.test(INDEX) && /<span class="og-banner-brief">/.test(INDEX) && /<span class="og-timer og-timer-head">/.test(INDEX) && /<span class="og-chev" aria-hidden="true">/.test(INDEX));
  check('  ...the rest keeps the full copy, both timers and the one honest action, now a real link', /<div class="og-banner-more"[\s\S]*<span class="og-banner-sub">[\s\S]*<span class="og-banner-timers">[\s\S]*<a class="og-banner-cta" id="og-banner-cta" href="about\.html#og-rules">/.test(INDEX) && (INDEX.match(/data-og-window="current"/g) || []).length === 2);
  check('home.js pops it down and remembers it for the visit; the CTA link (not the banner) takes the href', /head\.addEventListener\('click', \(\) => setOpen\(more\.hidden\)\)/.test(HOME) && /sessionStorage\.setItem\('og-open'/.test(HOME) && /cta\.setAttribute\('href', href\);/.test(HOME) && !/banner\.setAttribute\('href'/.test(HOME) && /labels\.forEach/.test(HOME));
  check('  ...the head stays one row at every width: the summary only where it fits, the clock without its label on a tablet, title and chevron on a phone', /@media \(max-width: 1699px\) \{ \.og-banner-brief \{ display: none; \} \}/.test(CSS) && /@media \(max-width: 899px\) \{ \.og-banner \.og-timer-head i \{ display: none; \}/.test(CSS) && /@media \(max-width: 560px\) \{ \.og-banner \.og-timer-head \{ display: none; \} \.og-banner \.og-banner-head \{ flex-wrap: nowrap; \}/.test(CSS) && /\.og-banner \.og-timer-head \{ flex-direction: row;/.test(CSS));
  check('  ...styled: the head is a full-width row at least 56px tall with a visible focus ring; the rest is hidden by [hidden]', /\.og-banner-head \{[^}]*min-height: 56px;[^}]*cursor: pointer;/.test(CSS) && /\.og-banner-head:focus-visible \{ outline: 3px solid #ffd27a;/.test(CSS) && /\.og-banner-more\[hidden\] \{ display: none; \}/.test(CSS) && /\.og-banner\.og-open \.og-chev \{ transform: rotate\(180deg\); \}/.test(CSS));
  check('  ...nothing in the strip says buy', !/\b(buy now|should buy)\b/i.test(INDEX.slice(INDEX.indexOf('<div class="og-banner"'), INDEX.indexOf('</div>', INDEX.indexOf('og-banner-more')))));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
