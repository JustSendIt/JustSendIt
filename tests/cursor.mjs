/* The rocket cursor (public/cursor.js + cursor.css — owner, 2026-10-15: "hide the default cursor when on site only only
   show the custom one on the site when users are interacting with it"). No server.
   The pages are source-checked (every page carries the rocket and its stylesheet); the behaviour is checked by running
   the real cursor.js in a sandbox against a stand-in page, and driving it with the events a browser sends. */
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT, SERVER_JS } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

/* ── a stand-in page: just enough DOM for cursor.js, with a hand-run clock and animation frame ── */
function page(opts = {}) {
  const timers = []; let now = 0, rafs = [], seq = 0;
  const listeners = { win: {}, doc: {}, root: {} };
  const on = (bag) => (t, f) => { (bag[t] = bag[t] || []).push(f); };
  class HTMLElement {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.style = { setProperty(k, v) { this[k] = v; } }; this.attrs = {}; this.kids = []; this.parent = null; this.cls = new Set();
      this.classList = { add: (c) => this.cls.add(c), remove: (c) => this.cls.delete(c), contains: (c) => this.cls.has(c), toggle: (c, f) => { if (f === undefined ? !this.cls.has(c) : f) this.cls.add(c); else this.cls.delete(c); } };
      this.clientWidth = 0; this.clientHeight = 0; this.offsetWidth = 0; this.offsetHeight = 0; this.clientLeft = 0; this.clientTop = 0; this.rect = { left: 0, top: 0 }; this.css = {}; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    appendChild(c) { this.kids.push(c); c.parent = this; return c; }
    remove() { if (this.parent) { this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; } }
    addEventListener(t, f) { on(this === box.document.documentElement ? listeners.root : {})(t, f); }
    getBoundingClientRect() { return this.rect; }
    matches(sel) {
      if (sel === ':open') { if (opts.noOpen) throw new SyntaxError('unknown pseudo-class'); return !!this.open; }
      return this.tagName === 'INPUT' && /input\[type="([a-z-]+)"\]/g.test(sel) && [...sel.matchAll(/input\[type="([a-z-]+)"\]/g)].some((m) => m[1] === this.type);
    }
  }
  const root = new HTMLElement('html'); root.clientWidth = 1265; root.clientHeight = 900;   // a classic 15px page bar
  const body = new HTMLElement('body');
  const frames = [];
  let fs = null, at = () => body;
  const store = new Map();
  const box = {
    console, Math, Date, JSON, parseFloat, HTMLElement, navigator: { platform: opts.win ? 'Win32' : 'MacIntel' },
    performance: { now: () => now, getEntriesByType: () => [{ type: opts.nav || 'navigate' }] },
    location: { origin: 'https://sendrh.test', pathname: '/wall', search: '' },
    setTimeout: (fn, ms) => { const id = ++seq; timers.push({ id, fn, t: now + (ms || 0) }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; }, cancelAnimationFrame: () => { rafs = []; },
    matchMedia: (q) => ({ matches: q === '(pointer: fine)' ? !opts.coarse : q === '(prefers-reduced-motion: reduce)' ? !!opts.reduced : false }),
    getComputedStyle: (el) => (el.className === 'rk-cursor' ? { position: 'fixed' } : { borderRightWidth: (el.css.br || 0) + 'px', borderBottomWidth: (el.css.bb || 0) + 'px', resize: el.css.resize || 'none' }),
    sessionStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    addEventListener: on(listeners.win),
    document: {
      documentElement: root, body, activeElement: body, hidden: false,
      styleSheets: opts.noCss ? [{ href: 'https://sendrh.test/styles.css' }] : [{ href: 'https://sendrh.test/styles.css' }, { href: 'https://sendrh.test/cursor.css' }],
      referrer: opts.ref == null ? 'https://sendrh.test/about' : opts.ref,
      get fullscreenElement() { return fs; },
      createElement: (t) => new HTMLElement(t),
      getElementsByTagName: (t) => (t === 'iframe' ? frames : []),
      elementFromPoint: (x, y) => at(x, y),
      addEventListener: on(listeners.doc),
    },
  };
  box.window = box;
  if (opts.store) for (const [k, v] of Object.entries(opts.store)) store.set(k, v);
  vm.runInNewContext(read('cursor.js'), box);
  const rocket = body.kids.find((k) => k.className === 'rk-cursor');
  const fire = (bag, t, e) => { for (const f of (listeners[bag][t] || [])) f(Object.assign({ type: t, defaultPrevented: false, pointerType: 'mouse', target: body, relatedTarget: null, clientX: 0, clientY: 0 }, e)); };
  return {
    box, root, body, rocket, frames, store, HTMLElement,
    win: (t, e) => fire('win', t, e), doc: (t, e) => fire('doc', t, e), rootEv: (t, e) => fire('root', t, e),
    move: (x, y, e) => fire('win', 'pointermove', Object.assign({ clientX: x, clientY: y }, e)),
    tick: (ms) => { now += ms; for (;;) { const due = timers.filter((x) => x.t <= now).sort((a, b) => a.t - b.t)[0]; if (!due) break; timers.splice(timers.indexOf(due), 1); due.fn(); } },
    frame: () => { const r = rafs; rafs = []; r.forEach((f) => f()); },
    pendingFrames: () => rafs.length,
    shown: () => !!rocket && rocket.style.opacity === '',
    pos: () => rocket.style.transform,
    setAt: (fn) => { at = fn; }, setFs: (el) => { fs = el; },
    layer: () => body.kids.find((k) => k.className === 'rk-layer'),
  };
}

try {
  const CUR = read('cursor.js'), CSS = read('cursor.css'), STYLES = read('styles.css'), SRV = readFileSync(SERVER_JS, 'utf8');

  /* ═══ every page has the rocket, and its stylesheet ═══ */
  const pages = readdirSync(PUB).filter((f) => f.endsWith('.html') && f !== 'gate.html');   // gate.html only forwards old links to the home page
  const noRocket = pages.filter((f) => !/<script src="\/?cursor\.js"><\/script>/.test(read(f)));
  check('every page loads the rocket (the legal pages and admin too)', pages.length >= 18 && !noRocket.length, noRocket.join(',') || pages.length + ' pages');
  const noHead = pages.filter((f) => { const h = read(f), head = h.slice(0, h.indexOf('</head>')); return !/<link rel="stylesheet" href="(\/?)cursor\.css">\n<script src="\1cursor\.js"><\/script>/.test(head); });
  check('  ...in its head, straight after cursor.css: the arrow is gone before the first paint, and moves made while the page loads are heard', !noHead.length, noHead.join(','));
  check('  ...and so do the pages the server writes itself: the 404 and a shared ticket', /<link rel="stylesheet" href="\/cursor\.css"><script src="\/cursor\.js"><\/script><\/head>' \+\n    '<body><main><h1>🚀 That page didn’t send\.<\/h1>/.test(SRV)
    && /<link rel="stylesheet" href="\/invite\.css"><link rel="stylesheet" href="\/cursor\.css"><script src="\/cursor\.js"><\/script>\n<\/head><body class="gate">/.test(SRV));
  check('the rocket\'s rules live in one file, not also in styles.css', !/\.rk-on|\.rk-cursor \{|\.rk-layer \{/.test(STYLES) && /\.rk-cursor \{ position: fixed;/.test(CSS));
  check('  ...the arrow, hand and text beam are hidden on html.rk-on and everything in it, the browser\'s own form parts included (one rule each)',
    /@media \(prefers-reduced-motion: no-preference\) \{\n  \.rk-on, \.rk-on \* \{ cursor: none !important; \}/.test(CSS)
    && ['::-webkit-inner-spin-button', '::-webkit-search-cancel-button', '::-webkit-calendar-picker-indicator', '::file-selector-button'].every((p) => CSS.includes('  .rk-on ' + p + ' { cursor: none !important; }\n'))
    && CSS.includes('  .rk-on video[controls], .rk-on audio[controls] { cursor: auto !important; }\n'));
  check('  ...and reduced motion keeps the browser\'s pointer and every cursor the site sets (nothing is forced to auto)', !/@media \(prefers-reduced-motion: reduce\)[^\n]*cursor:/.test(CSS) && /@media \(prefers-reduced-motion: reduce\) \{ \.rk-layer, \.rk-cursor \{ display: none !important; \} \}/.test(CSS));
  check('the rocket still sits above every layer of the site (9998/9999), so no overlay can leave a page with no pointer',
    /\.rk-layer \{ position: fixed; inset: 0; z-index: 9998;/.test(CSS) && /\.rk-cursor \{ position: fixed; top: 0; left: 0; z-index: 9999;/.test(CSS));

  /* ═══ what it does, run for real ═══ */
  {
    const p = page();
    check('the arrow is hidden as soon as the script runs (on <html>, so the strip under a short page too), before any move', p.root.cls.has('rk-on') && !p.body.cls.has('rk-on'));
    check('  ...and the rocket waits, hidden, until the page knows where the pointer is', p.rocket && !p.shown());
    p.move(300, 200);
    check('a mouse move shows the rocket, centred on the pointer', p.shown() && p.pos() === 'translate(300px,200px) translate(-50%, -50%) rotate(-90deg)', p.pos());
    p.move(340, 220); p.frame();
    const fly = /^translate\(([0-9.]+)px,([0-9.]+)px\)/.exec(p.pos()) || [];
    check('  ...and it flies after the pointer from there (eased: part of the way each frame)', p.shown() && +fly[1] > 300 && +fly[1] < 340 && +fly[2] > 200 && +fly[2] < 220, p.pos());
    p.rootEv('mouseleave');
    check('the pointer leaving the window takes the rocket with it', !p.shown());
    p.move(900, 600);
    check('  ...and it comes back exactly where the pointer comes in (no flight across the page from where it left)', p.shown() && p.pos() === 'translate(900px,600px) translate(-50%, -50%) rotate(-90deg)', p.pos());
    p.win('blur'); check('another app, tab or dialog taking the window hides it', !p.shown());
    p.move(901, 601); p.box.document.hidden = true; p.doc('visibilitychange'); check('  ...so does the tab going out of sight', !p.shown()); p.box.document.hidden = false;
    p.move(902, 602); p.win('contextmenu', {}); check('the right-click menu (the browser\'s own) hides it', !p.shown());
    p.move(903, 603); p.win('contextmenu', { defaultPrevented: true }); check('  ...but not a menu the page draws itself', p.shown());
    p.win('dragstart'); check('a drag (the browser draws its pointer with the drag image) hides it', !p.shown());
    p.move(904, 604, { pointerType: 'touch' }); check('a finger never shows it', !p.shown());
    p.win('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 }); check('  ...nor a tap', !p.shown());
    p.move(905, 605);
    const sel = new p.HTMLElement('select'); sel.multiple = false; sel.size = 0;
    p.win('pointerdown', { target: sel, clientX: 905, clientY: 605 }); check('pressing a drop-down hides it: its list is the browser\'s, with the browser\'s arrow', !p.shown());
    p.box.document.activeElement = sel; sel.open = true; p.move(906, 606);
    check('  ...and a move while the list is still open keeps it hidden', !p.shown());
    sel.open = false; p.move(907, 607); check('  ...until the list closes', p.shown());
    const lst = new p.HTMLElement('select'); lst.multiple = true; p.win('pointerdown', { target: lst, clientX: 907, clientY: 607 });
    check('  ...a list box drawn in the page is not one of those', p.shown());
    p.box.document.activeElement = p.body;
    const file = new p.HTMLElement('input'); file.type = 'file';
    p.win('click', { target: file }); check('a file, colour or date picker hides it (a label\'s or a script\'s click too)', !p.shown());
    const txt = new p.HTMLElement('input'); txt.type = 'text'; p.move(908, 608); p.win('click', { target: txt }); check('  ...an ordinary field does not', p.shown());
    const burst = () => p.layer().kids.filter((k) => /rk-burst/.test(k.className)).length;
    const trail = () => p.layer().kids.filter((k) => /rk-trail/.test(k.className)).length;
    const b0 = burst(); p.win('pointerdown', { clientX: 908, clientY: 608 });
    check('a click still bursts from the rocket', burst() === b0 + 8, burst() - b0);
    p.tick(30); p.move(930, 620); p.tick(30); p.move(950, 630);
    check('  ...and a move still leaves its spark trail', trail() >= 2, trail());
    p.tick(1000); check('  ...and every spark, burst and trail, is cleared away', burst() === 0 && trail() === 0 && !p.layer().kids.length, p.layer().kids.length);
    for (let i = 0; i < 40; i++) p.frame();
    check('the easing loop parks once the rocket has caught up (no animation frame left asking)', p.pendingFrames() === 0 && p.pos() === 'translate(950px,630px) translate(-50%, -50%) rotate(-90deg)', p.pendingFrames() + ' ' + p.pos());
  }
  {
    const p = page();
    const fr = new p.HTMLElement('iframe');
    p.move(100, 100); p.win('pointerover', { target: fr }); check('a frame the page is told about (this site\'s) hides it: the frame shows its own pointer', !p.shown());
    p.move(100, 100, { target: fr }); check('  ...and a move that lands on a frame keeps it hidden', !p.shown());
    p.frames.push(fr);
    p.setAt((x) => (x >= 700 ? fr : p.body));                                  // another site's chart from x=700 on
    p.move(640, 450); p.move(670, 450); p.move(692, 450); p.tick(200);
    check('another site\'s frame says nothing when the pointer goes in: moves that stop heading into one hide the rocket', !p.shown());
    p.move(650, 450); check('  ...and it is back the moment the pointer moves on the page again', p.shown());
    p.move(660, 450); p.move(670, 450); p.move(676, 450); p.move(679, 450); p.move(680, 450); p.tick(200);
    check('  ...a pointer that slows and stops short of the frame keeps its rocket', p.shown());
    p.move(650, 450); p.move(660, 450); p.move(670, 450); p.move(680, 450); p.tick(200);
    check('  ...so does one that stops 20 px short at a steady 10 px a step (on the chart\'s own buttons, say): one step ahead is still the page', p.shown());
    p.move(100, 450); p.rootEv('mouseleave'); p.move(660, 450); p.tick(200);
    check('  ...nor is the jump from where the rocket left the page (a re-entry) counted as heading into a frame', p.shown());
    p.move(670, 450); p.win('pointerdown', { clientX: 690, clientY: 450 }); p.move(690, 450); p.win('pointerdown', { clientX: 690, clientY: 450 }); p.tick(200);
    check('  ...nor a pointer resting on something it pressed beside a chart (its own source buttons)', p.shown());
    p.move(692, 450); p.move(693, 450); p.tick(200);
    check('  ...nor one easing to a stop a pixel at a time', p.shown());
    p.setAt((x) => (x >= 700 ? fr : p.body));
    p.win('scroll'); check('a scroll that leaves the pointer over the page keeps it', p.shown());
    p.setAt(() => fr); p.win('scroll'); check('  ...one that slides a frame under a still pointer hides it', !p.shown());
    p.win('pointerover', { clientX: 690, clientY: 455, target: p.body });
    check('  ...and when the page shifts back, the browser\'s word on where the pointer now is (no move) brings it back there', p.shown() && p.pos() === 'translate(690px,455px) translate(-50%, -50%) rotate(-90deg)', p.pos());
  }
  {
    const p = page();
    p.move(1270, 300); check('the page\'s own scroll bar (the browser\'s arrow there) hides it', !p.shown());
    p.move(1200, 300); check('  ...and it is back off the bar', p.shown());
    const sc = new p.HTMLElement('div'); Object.assign(sc, { clientWidth: 182, clientHeight: 132, offsetWidth: 200, offsetHeight: 150, clientLeft: 3, clientTop: 3, rect: { left: 100, top: 300 } }); sc.css = { br: 3, bb: 3 };
    p.move(200, 350, { target: sc }); check('inside a scrolling box: shown', p.shown());
    p.move(290, 350, { target: sc }); check('  ...on its scroll bar: hidden', !p.shown());
    p.move(200, 440, { target: sc }); check('  ...on its bottom bar: hidden', !p.shown());
    p.move(298, 350, { target: sc }); check('  ...on its border: shown (a border is the page\'s, and has the rocket)', p.shown());
    p.move(500, 350, { target: sc }); check('  ...a drag held by the box, out past it: shown', p.shown());
    const card = new p.HTMLElement('div'); Object.assign(card, { clientWidth: 298, clientHeight: 98, offsetWidth: 300, offsetHeight: 100, clientLeft: 1, clientTop: 1, rect: { left: 0, top: 0 } });
    p.move(299, 50, { target: card }); check('an ordinary box with a hairline border: shown on the border', p.shown());
    const ta = new p.HTMLElement('textarea'); Object.assign(ta, { clientWidth: 196, clientHeight: 116, offsetWidth: 200, offsetHeight: 120, clientLeft: 2, clientTop: 2, rect: { left: 350, top: 300 } }); ta.css = { br: 2, bb: 2, resize: 'vertical' };
    p.move(450, 360, { target: ta }); check('in a text box: shown', p.shown());
    p.move(545, 415, { target: ta }); check('  ...on its resize corner (the browser\'s resize arrows): hidden', !p.shown());
    ta.css.resize = 'none'; p.move(546, 415, { target: ta }); check('  ...a text box that cannot be resized has no such corner', p.shown());
    const svg = { tagName: 'svg', nodeType: 1 }; p.move(10, 10, { target: svg }); check('an SVG drawing (no bars, no offsetWidth): shown', p.shown());
    const vid = new p.HTMLElement('video'); vid.controls = true;
    p.move(20, 20, { target: vid }); check('a video or voice memo with its player: the browser\'s pointer shows there, so the rocket steps aside', !p.shown());
    const bare = new p.HTMLElement('video'); bare.controls = false;
    p.move(21, 21, { target: bare }); check('  ...a video without a player (an avatar loop) keeps the rocket', p.shown());
  }
  {
    const p = page();
    p.move(400, 400);
    const v = new p.HTMLElement('video'); p.setFs(v); p.doc('fullscreenchange');
    check('full screen (above every layer, the rocket\'s too) gives the browser\'s pointer back', !p.root.cls.has('rk-on') && !p.shown());
    p.move(410, 410); check('  ...and moves there do not bring a rocket nobody can see', !p.shown());
    p.setFs(null); p.doc('fullscreenchange'); check('  ...leaving it brings the rocket back, where the last move left it (no move needed)', p.root.cls.has('rk-on') && p.shown() && p.pos() === 'translate(410px,410px) translate(-50%, -50%) rotate(-90deg)', p.pos());
    p.move(420, 420);
    p.win('pagehide');
    const m = /^(\d+),(\d+),(\d+),(\/.*)$/.exec(p.store.get('send.rk') || '');
    check('leaving the page notes where the pointer is, and which page it was on, for the next one', m && m[1] === '420' && m[2] === '420' && m[4] === '/wall', p.store.get('send.rk'));
    p.rootEv('mouseleave'); p.win('pagehide'); check('  ...and notes nothing when the pointer had already left the page', !p.store.has('send.rk'));
  }
  {
    const note = (x, y, ago, path) => x + ',' + y + ',' + (Date.now() - (ago || 0)) + ',' + (path || '/about');
    const p = page({ store: { 'send.rk': note(296, 31) } });
    check('a click through from the last page: the rocket starts where the pointer already is, with no move', p.shown() && p.pos() === 'translate(296px,31px) translate(-50%, -50%) rotate(-90deg)', p.pos());
    check('  ...and the note is used once', !p.store.has('send.rk'));
    check('  ...not from a note older than 5 seconds (a stale spot is worse than none)', !page({ store: { 'send.rk': note(296, 31, 6000) } }).shown());
    check('  ...nor from a spot outside this window', !page({ store: { 'send.rk': note(1500, 31) } }).shown());
    check('  ...nor from a note it cannot read', !page({ store: { 'send.rk': 'x' } }).shown());
    check('  ...nor from a page this one was not opened from (Back from another site, say): its pointer is on the browser\'s bar', !page({ store: { 'send.rk': note(296, 31, 0, '/arcade') } }).shown());
    check('  ...nor for a typed address or a bookmark (no page sent us here)', !page({ store: { 'send.rk': note(296, 31) }, ref: '' }).shown());
    check('  ...nor for Back, Forward or a reload (the browser\'s own buttons)', !page({ store: { 'send.rk': note(296, 31) }, nav: 'back_forward' }).shown() && !page({ store: { 'send.rk': note(296, 31) }, nav: 'reload' }).shown());
    p.win('pageshow', { persisted: false }); check('a fresh page is not reset by its own pageshow', p.shown());
    p.store.set('send.rk', note(50, 60, 0, '/wall')); p.win('pageshow', { persisted: true });
    check('Back to a page kept in memory: no rocket until the pointer moves (it is most likely on the Back button)', !p.shown());
    p.move(70, 80); check('  ...and the first move brings it', p.shown());
  }
  {
    const w = page({ win: true });
    w.move(300, 300); w.win('mousedown', { button: 1, clientX: 300, clientY: 300 });
    check('Windows middle-button autoscroll (the browser draws its pan cursor) hides the rocket', !w.shown());
    w.move(320, 340); check('  ...through the moves while it scrolls', !w.shown());
    w.win('mousedown', { button: 0, clientX: 320, clientY: 340 }); check('  ...and the next press, which ends it, brings it back', w.shown());
    w.win('mousedown', { button: 1, clientX: 320, clientY: 340 }); w.win('mousedown', { button: 1, clientX: 320, clientY: 340 });
    check('  ...a second middle press ends it too', w.shown());
    w.win('mousedown', { button: 1, clientX: 320, clientY: 340 }); w.win('pointerup', { button: 1, clientX: 380, clientY: 420 });
    check('  ...held and dragged, it ends with the release', w.shown() && w.pos() === 'translate(380px,420px) translate(-50%, -50%) rotate(-90deg)', w.pos());
    const link = { tagName: 'A', nodeType: 1, closest: () => true };
    w.win('mousedown', { button: 1, clientX: 380, clientY: 420, target: link }); check('  ...a middle click on a link (a new tab, no autoscroll) leaves it', w.shown());
    w.win('mousedown', { button: 1, clientX: 380, clientY: 420, defaultPrevented: true }); check('  ...as does one the page itself handled', w.shown());
    const mac = page();
    mac.move(300, 300); mac.win('mousedown', { button: 1, clientX: 300, clientY: 300 });
    check('  ...and a Mac (no autoscroll) keeps the rocket on a middle click', mac.shown());
  }
  {
    const coarse = page({ coarse: true });
    check('a touch screen keeps its own pointer: no rocket, nothing hidden', !coarse.rocket && !coarse.root.cls.has('rk-on'));
    const calm = page({ reduced: true });
    check('reduced motion keeps the browser\'s pointer: no rocket, nothing hidden', !calm.rocket && !calm.root.cls.has('rk-on'));
    const bare = page({ noCss: true });
    check('a page without cursor.css keeps the browser\'s pointer (the script does nothing there)', !bare.rocket && !bare.root.cls.has('rk-on') && !bare.body.kids.length);
    const old = page({ noOpen: true }); const sel = new old.HTMLElement('select');
    old.move(5, 5); old.box.document.activeElement = sel; old.move(6, 6);
    check('a browser that cannot say whether a drop-down is open does not throw, and the press is what hid it', old.shown());
  }
  check('every storage read and write is guarded (private windows throw)', /try \{ v = sessionStorage\.getItem\(KEY\); sessionStorage\.removeItem\(KEY\); \} catch \(e\) \{\}/.test(CUR) && /try \{ if \(shown\) sessionStorage\.setItem\(KEY,/.test(CUR));
} catch (e) {
  check('the suite ran to the end', false, e && e.stack);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
