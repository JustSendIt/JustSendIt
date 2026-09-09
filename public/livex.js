/* ===== livex.js — one clock for every X on the site ======================================
   An X on this site is a live reading of the chain: a Send Call's "Now", a runner's gain since
   the scanner priced it, the multiple on a token you convicted. None of those are true for long,
   so none of them should sit still until someone reloads the page.

   Before this, each surface kept its own timer, or kept none at all: the call cards polled
   /api/calls/:id once per visible card every 25s (eight cards on screen meant eight round-trips
   a tick, which is exactly why it had to be slow), Best Runners re-rendered its whole list every
   60s, and the Xs on convicted tokens never moved at all.

   So there is one clock here, and surfaces register against it:

     LiveX.source('calls', { collect, fetch, apply })

   * collect() returns what that surface currently needs — usually only what is ON SCREEN, via
     the shared IntersectionObserver — or null to sit this tick out. Nothing is fetched for a
     surface the reader cannot see.
   * fetch(what) does ONE request for all of it.
   * apply(data) writes the new numbers into the existing nodes. In place, never a re-render:
     an open detail, a focused button and the scroll position all survive a tick.

   Politeness, because this runs forever in a background tab on someone's phone:
   - nothing at all while the tab is hidden; one immediate tick when it comes back
   - a source that errors backs off (doubling, to a 2 minute ceiling) and recovers on success
   - a source with nothing visible costs nothing

   Accessibility: these numbers change every few seconds, so they are deliberately NOT in a live
   region — a screen reader announcing "up 7.01x" every tick would make the page unusable. The
   text and the label update silently; a reader hears the current value when they navigate to it.
   The change is shown visually instead, with a brief pulse that respects prefers-reduced-motion.
   ======================================================================================== */
(function () {
  'use strict';

  var BASE_MS = 12000;         // default interval for a source that does not ask for its own
  var TICK_MS = 1000;          // the shared timer's granularity — the floor any source can ask for
  var MAX_BACKOFF_MS = 120000; // a failing source is left alone for at most this long
  var sources = [];
  var timer = null;
  var io = null;
  var seen = typeof WeakSet === 'function' ? new WeakSet() : null;

  /* Shared "is it on screen" observer. Elements opt in with LiveX.watch(root, selector); a source
     then asks LiveX.visible(selector) for the ones actually in view, so a thousand-row list still
     only costs one request for the dozen rows the reader can see. */
  var visibleEls = new Set();
  function ensureIO() {
    if (io || typeof IntersectionObserver !== 'function') return io;
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) visibleEls.add(en.target); else visibleEls.delete(en.target); });
    }, { rootMargin: '120px' });   // just off-screen counts, so a number is already current when it scrolls in
    return io;
  }
  function watch(root, selector) {
    var o = ensureIO(); if (!o || !root || !root.querySelectorAll) return;
    var list = root.querySelectorAll(selector);
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (seen && seen.has(el)) continue;
      if (seen) seen.add(el);
      o.observe(el);
    }
  }
  // Without IntersectionObserver every matching element counts as visible: the numbers stay correct,
  // only the "don't fetch what nobody is looking at" saving is lost.
  function visible(selector) {
    if (!io) return Array.prototype.slice.call(document.querySelectorAll(selector));
    var out = [];
    visibleEls.forEach(function (el) { if (el.isConnected && el.matches(selector)) out.push(el); });
    return out;
  }

  /* spec.every (ms) lets one surface run faster or slower than the shared clock. The tick itself stays a
     single timer — a source simply declines to run until its own interval has elapsed. A Send Call's X is a
     price, and a price is the one thing on this site that must not visibly lag the chain, so it asks for a
     much shorter interval than a payload of hop counts and grades needs. */
  function source(name, spec) {
    if (!name || !spec || typeof spec.collect !== 'function' || typeof spec.fetch !== 'function' || typeof spec.apply !== 'function') return;
    for (var i = 0; i < sources.length; i++) if (sources[i].name === name) return; // registering twice must not double the traffic
    var every = Math.max(TICK_MS, Number(spec.every) || BASE_MS);
    sources.push({ name: name, spec: spec, every: every, busy: false, backoff: 0, nextAt: 0, fails: 0, ranAt: 0 });
    start();
  }

  async function runSource(s, at) {
    if (s.busy || at < s.nextAt || at - s.ranAt < s.every) return;
    s.ranAt = at;
    var what;
    try { what = s.spec.collect(); } catch { return; }
    if (what == null || (Array.isArray(what) && !what.length)) return;
    s.busy = true;
    try {
      var data = await s.spec.fetch(what);
      if (data != null) s.spec.apply(data, what);
      s.fails = 0; s.backoff = 0; s.nextAt = 0;
    } catch {
      // A failed read leaves the last good number on screen rather than blanking it — a stale X is
      // honest (it says when it was read), an empty one just looks broken.
      s.fails++;
      s.backoff = Math.min(MAX_BACKOFF_MS, s.backoff ? s.backoff * 2 : BASE_MS * 2);
      s.nextAt = Date.now() + s.backoff;
    } finally { s.busy = false; }
  }

  /* "Is anyone actually looking at this?" — document.hidden is the right answer in a real browser tab, but
     it is not always a truthful one. Embedded web views (a link opened inside Twitter or Telegram, which is
     how a lot of people will meet this site on a phone) can report hidden for the whole life of the page,
     and a reader there would sit watching numbers that never move with nothing to tell them why. So a
     recent touch or keypress counts as proof the page is being read, whatever the document claims. A tab
     genuinely left in the background stops on its own once the interaction goes stale. */
  var INTERACT_MS = 60000;
  var lastTouch = 0;
  // lastTouch === 0 means "never touched" and must not be read as a timestamp — comparing it as one only
  // happens to work because Date.now() is a large number, which is not a thing to depend on.
  function awake() { return !document.hidden || (lastTouch > 0 && Date.now() - lastTouch < INTERACT_MS); }

  function tick() {
    if (!awake()) return;
    var at = Date.now();
    for (var i = 0; i < sources.length; i++) runSource(sources[i], at);
  }

  function start() { if (!timer) timer = setInterval(tick, TICK_MS); }
  function refreshNow() { for (var i = 0; i < sources.length; i++) { sources[i].nextAt = 0; sources[i].ranAt = 0; } tick(); }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshNow(); });
  window.addEventListener('online', refreshNow);
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (t) {
    window.addEventListener(t, function () {
      var first = !lastTouch;
      lastTouch = Date.now();
      if (first) refreshNow();   // the first sign of a reader in a web view that never admits to being visible
    }, { passive: true, capture: true });
  });

  /* Write a value into a node, and pulse it only when it actually changed — a pulse on every tick
     would be a flicker, and a pulse on an unchanged number would be a lie about new data. */
  function setText(el, text, cls) {
    if (!el) return false;
    var changed = el.textContent !== text;
    if (changed) el.textContent = text;
    if (cls != null && el.className !== cls) el.className = cls;
    if (changed) pulse(el);
    return changed;
  }
  function pulse(el) {
    if (!el || !el.classList) return;
    el.classList.remove('livex-pulse');
    void el.offsetWidth;              // restart the animation if it is already running
    el.classList.add('livex-pulse');
  }

  // what is registered and how each source is faring — for checking from a console that the surfaces on
  // this page actually joined the clock, and that none of them is quietly sitting in a backoff
  function status() {
    return { hidden: document.hidden, awake: awake(), base: BASE_MS, tick: TICK_MS, sources: sources.map(s => ({ name: s.name, everyMs: s.every, busy: s.busy, fails: s.fails, backoffMs: s.backoff, waitingMs: Math.max(0, s.nextAt - Date.now()) })) };
  }

  window.LiveX = { source: source, watch: watch, visible: visible, refreshNow: refreshNow, setText: setText, pulse: pulse, status: status, BASE_MS: BASE_MS };
})();
