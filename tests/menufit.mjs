/* The page menu and the strips that scroll sideways (owner, 2026-10-15: "make sure there is no scroll if there doesn't have
   to be on the page menu if you have to have a scroll on smaller screens make sure users know they need to scroll to see more
   of the menu"). Measured in headless Chrome when it was built: the pop-down was capped at 560px and its links took 575-630px,
   so it scrolled on every screen from a 320px phone to a 1280px laptop; the profile tabs scrolled sideways with a hidden bar.
   The menu code in nav.js and the strip cue in app.js are RUN here, against stand-ins whose heights and widths the test sets
   (a 320x330 window, a tall phone, a reopened menu, a tap on the cue). No server. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const classes = () => { const s = new Set(); return { set: s, add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c), toggle: (c, on) => { if (on === undefined ? !s.has(c) : on) s.add(c); else s.delete(c); } }; };

try {
  const NAV = read('nav.js'), CSS = read('styles.css'), APP = read('app.js');

  /* ═══ the page menu, run ═══ */
  const block = NAV.slice(NAV.indexOf('    function open() {'), NAV.indexOf('.observe(menu, { childList: true, subtree: true });') + '.observe(menu, { childList: true, subtree: true });'.length);
  function world(o) {
    const H = { one: o.one, cols: o.cols, btn: 44 };   // content heights: one column, in columns, and the cue button
    const handlers = {}, winH = {}, vars = {};
    const menu = {
      classList: classes(), scrollTop: 0, children: [],
      style: { setProperty: (k, v) => { vars[k] = v; }, removeProperty: (k) => { delete vars[k]; } },
      get scrollHeight() { const c = this.classList; return (c.contains('is-cols') ? H.cols : H.one) + (c.contains('open') && c.contains('has-more') ? H.btn : 0); },
      get offsetHeight() { return this.classList.contains('open') ? (parseFloat(vars['--menu-room']) || 0) : 0; },
      get clientHeight() { return Math.max(0, this.offsetHeight - 1); },
      addEventListener: (t, f) => { (handlers[t] = handlers[t] || []).push(f); },
      appendChild: (c) => { menu.children.push(c); return c; },
      querySelectorAll: () => o.links.map((w) => ({ w })),
      scrollBy: ({ top }) => { menu.scrollTop = Math.max(0, Math.min(menu.scrollHeight - menu.clientHeight, menu.scrollTop + top)); (handlers.scroll || []).forEach((f) => f()); },
    };
    const toggle = { setAttribute() {} };
    const nav = { classList: classes(), getBoundingClientRect: () => ({ bottom: 60 }) };
    nav.classList.add('is-compact');
    const btn = { listeners: {}, setAttribute() {}, addEventListener(t, f) { this.listeners[t] = f; } };
    const doc = { createElement: () => btn, createRange: () => { let w = 0; return { selectNodeContents: (n) => { w = n.w; }, getBoundingClientRect: () => ({ width: w }) }; }, documentElement: { classList: classes() } };
    const win = { innerHeight: o.h, visualViewport: { height: o.h, addEventListener() {} }, addEventListener: (t, f) => { (winH[t] = winH[t] || []).push(f); } };
    const gcs = (el) => el === menu ? { borderTopWidth: '0px', borderBottomWidth: '1px' } : { fontSize: '16px' };
    const fn = new Function('nav', 'toggle', 'menu', 'document', 'window', 'visualViewport', 'getComputedStyle', 'matchMedia', 'MutationObserver',
      block + '\nreturn { open, close, fitMenu, menuCue, isOpen };');
    const api = fn(nav, toggle, menu, doc, win, win.visualViewport, gcs, () => ({ matches: false }), function () { return { observe() {} }; });
    return { ...api, menu, nav, vars, btn, win, handlers, has: (c) => menu.classList.contains(c), scrolls: () => menu.scrollHeight > menu.clientHeight };
  }
  const LINKS = [52, 70, 108, 66, 98, 72, 84, 70, 52, 56, 82, 92];   // the links' widths (px): Communities is the widest

  const tall = world({ h: 900, one: 580, cols: 343, links: LINKS });
  tall.open();
  check('a tall screen: one column, given exactly its height (so the open/close animation runs over its real height), no scroll, no cue',
    !tall.has('is-cols') && tall.vars['--menu-room'] === '581px' && !tall.scrolls() && !tall.has('has-more'), JSON.stringify(tall.vars));
  const phone = world({ h: 667, one: 620, cols: 343, links: LINKS });
  phone.open();
  check('a 375x667 phone, where one column would run past the bottom: columns as wide as the widest link (108 + 16 + 4 px), and no scroll',
    phone.has('is-cols') && phone.vars['--menu-col'] === '128px' && phone.vars['--menu-room'] === '344px' && !phone.scrolls() && !phone.has('has-more'), JSON.stringify(phone.vars));
  const tiny = world({ h: 330, one: 620, cols: 343, links: LINKS });
  tiny.open();
  check('a 320x330 window, where even columns are too tall: it scrolls in the room under the bar, and says so ("Scroll for more")', tiny.has('is-cols') && tiny.vars['--menu-room'] === '270px' && tiny.scrolls() && tiny.has('has-more'));
  tiny.menu.scrollTop = tiny.menu.scrollHeight - tiny.menu.clientHeight; tiny.handlers.scroll.forEach((f) => f());
  check('  ...scrolled to the end the cue goes, and a shade marks the top', !tiny.has('has-more') && tiny.has('is-scrolled'), [...tiny.menu.classList.set].join(' '));
  tiny.close();
  check('  ...closed, it drops its cue and its shade and goes back to the top', !tiny.has('has-more') && !tiny.has('is-scrolled') && !tiny.has('open') && tiny.menu.scrollTop === 0);
  // the reviewer's stale cue: scrolled, closed, the screen grows, reopened — a scroll event mid-opening must not light a cue on a menu that fits
  tiny.win.innerHeight = tiny.win.visualViewport.height = 812;
  tiny.open(); tiny.handlers.scroll.forEach((f) => f());
  check('  ...reopened on a screen where it fits, no cue (it is judged against the height it is given, never the box mid-animation)', !tiny.has('has-more') && !tiny.scrolls(), [...tiny.menu.classList.set].join(' '));
  const tap = world({ h: 330, one: 620, cols: 343, links: LINKS });
  tap.open();
  const before = tap.menu.scrollTop; tap.btn.listeners.click();
  check('"Scroll for more ↓" is a real button (a tap on it scrolls the menu, never lands on a link hidden under it), out of the Tab order, with a tip',
    tap.menu.scrollTop > before && tap.menu.children.includes(tap.btn) && tap.btn.className === 'nav-more' && tap.btn.tabIndex === -1 && tap.btn.textContent === 'Scroll for more ↓' && /more\.setAttribute\('data-tip', 'Scrolls the menu to show the rest of its links'\);/.test(NAV));
  const wide = world({ h: 900, one: 580, cols: 343, links: LINKS });
  wide.nav.classList.remove('is-compact'); wide.open();
  check('the full row of links (a wide screen) gets none of it', !wide.has('is-cols') && !wide.has('has-more') && !('--menu-room' in wide.vars));
  check('re-measured when the screen resizes or turns, when the bar changes under it, and when search results grow inside it',
    /window\.addEventListener\('resize', function \(\) \{ if \(isOpen\(\)\) fitMenu\(\); \}, \{ passive: true \}\);/.test(NAV) && /visualViewport\.addEventListener\('resize', function \(\) \{ if \(isOpen\(\)\) fitMenu\(\); \}\);/.test(NAV)
    && /if \(isOpen\(\)\) fitMenu\(\);   \/\/ the bar changed under an open menu/.test(NAV) && /new MutationObserver\(function \(\) \{ if \(isOpen\(\) && compact\(\)\) \{ setHeight\(menuRoom\(\)\); menuCue\(\); \} \}\)/.test(NAV));
  check('the styles: no 560px cap, measured columns, the button stuck to the bottom only while there is more, Tab lands clear of it, visible in forced colours',
    /\.nav\.is-compact \.nav-menu\.open \{ max-height: var\(--menu-room, min\(80vh, 560px\)\);/.test(CSS) && /minmax\(min\(100%, var\(--menu-col, 8em\)\), 1fr\)/.test(CSS)
    && /\.nav-more \{ display: none; \}/.test(CSS) && /\.nav\.is-compact \.nav-menu\.open\.has-more > \.nav-more \{\n  display: block; position: sticky; bottom: 0;/.test(CSS) && /font-size: max\(var\(--text-floor\), 0\.85rem\); font-weight: 800;/.test(CSS)
    && /\.nav\.is-compact \.nav-menu\.open\.has-more \{ scroll-padding-bottom: 3\.6rem; \}/.test(CSS) && /@media \(forced-colors: active\) \{ \.nav\.is-compact \.nav-menu\.open\.has-more > \.nav-more \{ background: ButtonFace;/.test(CSS));

  /* ═══ strips that scroll sideways, run ═══ */
  const cueSrc = APP.slice(APP.indexOf('  window.scrollCue = function (el) {'), APP.indexOf('  const cueAll = '));
  function strip(o) {
    const h = {};
    const el = { classList: classes(), scrollLeft: 0, scrollWidth: o.sw, clientWidth: o.cw, scrolls: [],
      addEventListener: (t, f) => { h[t] = f; }, getBoundingClientRect: () => ({ left: 0, right: o.cw, width: o.cw }),
      scrollBy: ({ left }) => { el.scrolls.push(left); } };
    const win = { addEventListener() {} };
    new Function('window', 'ResizeObserver', 'MutationObserver', 'matchMedia', 'document', cueSrc)(win, undefined, function () { return { observe() {} }; }, () => ({ matches: false }), { documentElement: { classList: classes() } });
    win.scrollCue(el);
    return { el, h, has: (c) => el.classList.contains(c), go: (x) => { el.scrollLeft = x; h.scroll(); } };
  }
  const s = strip({ sw: 555, cw: 301 });
  const at0 = s.has('cue-end') && !s.has('cue-start');
  s.go(120); const mid = s.has('cue-end') && s.has('cue-start');
  s.go(254); const end = !s.has('cue-end') && s.has('cue-start');
  check('a strip wider than its box (the profile tabs on a 375px phone): › while there is more to the right, ‹ once it has moved, both between', at0 && mid && end, JSON.stringify({ at0, mid, end }));
  const fits = strip({ sw: 686, cw: 686 });
  check('  ...one that fits (the tabs on a 768px tablet) shows neither', !fits.has('cue-end') && !fits.has('cue-start'));
  const k = strip({ sw: 555, cw: 301 }); let seen = null;
  k.h.focusin({ target: { scrollIntoView: (opt) => { seen = opt; } } });
  check('  ...a tab reached with the keyboard is scrolled into view (nearest), and scroll-padding keeps it clear of the cue', seen && seen.inline === 'nearest' && /\[data-scroll-cue\] \{ scroll-padding-inline: 2\.8rem; \}/.test(CSS), JSON.stringify(seen));
  const t = strip({ sw: 555, cw: 301 });
  t.h.click({ target: t.el, clientX: 290 }); t.go(120); t.h.click({ target: t.el, clientX: 10 }); t.h.click({ target: { id: 'a tab' }, clientX: 290 }); t.h.click({ target: t.el, clientX: 150 });
  check('  ...a tap on the › scrolls it right, on the ‹ left; a tap on a tab is the tab\'s, and the middle of the strip does nothing', t.el.scrolls.length === 2 && t.el.scrolls[0] > 0 && t.el.scrolls[1] < 0, JSON.stringify(t.el.scrolls));
  check('every strip that scrolls sideways is marked: the profile tabs, the Scanner\'s quick filters, a community\'s snapshots',
    /<div class="dtabs" role="tablist" aria-label="Dashboard sections" id="dtabs" data-scroll-cue>/.test(read('profile.html')) && /id="np-presets" role="group" aria-label="Quick filters" data-scroll-cue>/.test(read('newpairs.html'))
    && /id="snap-tabs" role="tablist" aria-label="Snapshots, newest first" data-scroll-cue><\/div>/.test(read('community.html')) && /document\.querySelectorAll\('\[data-scroll-cue\]'\)\.forEach\(window\.scrollCue\)/.test(APP));
  check('  ...the cue takes no room (border-box, the gap and padding cancelled: no jump), is silent to a screen reader, fades into each strip\'s own colour, keeps the system\'s colours in high contrast',
    /position: sticky; z-index: 2; flex: none; align-self: stretch; box-sizing: border-box; width: 2\.6rem;/.test(CSS) && /content: "›"; content: "›" \/ "";/.test(CSS) && /margin-left: calc\(-2\.6rem - var\(--cue-gap, 0\.4rem\)\)/.test(CSS)
    && /\.dtabs\[data-scroll-cue\] \{ --cue-gap: 0\.35rem; --cue-pad: 0\.35rem; --cue-bg: var\(--ctl-fill-lo\); \}/.test(CSS) && /\.np-chips\[data-scroll-cue\] \{ --cue-gap: 0\.4rem; --cue-pad: 0\.1rem; \}/.test(CSS) && /\.snap-tabs\[data-scroll-cue\] \{ --cue-gap: 0\.4rem; --cue-bg: var\(--ink-3\); \}/.test(CSS)
    && /@media \(forced-colors: active\) \{ \[data-scroll-cue\]\.cue-start::before, \[data-scroll-cue\]\.cue-end::after \{ background: Canvas; color: CanvasText; \} \}/.test(CSS));
  check('a tablet holds all five profile tabs with no scroll at all (they ran 30px past at 768px)', /@media \(max-width: 900px\) \{ \.dtabs \.dtab \{ padding-inline: 0\.75rem; \} \}/.test(CSS));
} catch (e) {
  check('the suite ran to the end', false, e && e.stack);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
