/* ===== The hunt ====================================================================================
   A hundred eggs are hidden across the site. This file is the ENGINE: how a find is detected, how it is
   banked, how it is celebrated. WHERE each egg lives is registered per page at the bottom of this file
   and in the page scripts, through EGGS.register(id, arm).

   What the server owns and this file never decides: how much an egg pays, whether it already paid, how
   many exist. A find is only ever "I found #N" — POST /api/eggs/claim — and the reply carries the truth
   (awarded, found[], total). The count shown anywhere comes from that reply or from GET /api/eggs.

   Rules the detectors follow, because an egg that gets in the way is a bug, not a delight:
     - never intercept a control's primary job: eggs listen, they do not preventDefault on real controls;
     - nothing that needs money, a wallet, or a purchase;
     - findable by keyboard and pointer alike wherever the trigger is an element (Enter/Space count);
     - reduced-motion readers get the toast without the confetti;
     - signed-out finds are kept locally and banked on the next signed-in page load, so nobody loses one. */
(function () {
  const KEY = 'send.eggs.pending';          // finds made while signed out — banked later
  const SEEN = 'send.eggs.seen';            // ids this browser has already celebrated — no double toasts
  const reg = new Map();                    // id -> arm(found)
  let total = null, foundIds = new Set(), booted = false;

  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const signedIn = () => !!(window.AUTH && AUTH.user && AUTH.user.id);

  async function post(id) {
    const r = await fetch('/api/eggs/claim', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  }

  function celebrate(id, awarded, n, tot) {
    const seen = load(SEEN);
    if (!seen.includes(id)) { seen.push(id); save(SEEN, seen); }
    const count = (n != null && tot != null) ? ' · ' + n + '/' + tot : '';
    const pts = awarded > 0 ? ' +' + awarded + ' Send Power' : '';
    if (window.sendToast) sendToast('🥚 Egg #' + id + ' found!' + pts + count);
    if (window.burst && !reduced()) {
      const x = window.innerWidth / 2, y = Math.min(window.innerHeight - 80, window.innerHeight * 0.4);
      try { burst(x, y, { count: 40, emojiRatio: 0.5 }); } catch {}
    }
    document.dispatchEvent(new CustomEvent('egg:found', { detail: { id, awarded, found: n, total: tot } }));
  }

  /* The one entry point every detector calls. Idempotent from the client's side too: an id this browser
     has already celebrated is quietly re-sent (the server says already:true) but not celebrated twice. */
  async function found(id) {
    id = Number(id);
    if (!Number.isInteger(id) || id < 1) return;
    if (foundIds.has(id)) return;
    if (!signedIn()) {
      const pend = load(KEY);
      if (!pend.includes(id)) { pend.push(id); save(KEY, pend); }
      if (!load(SEEN).includes(id)) {
        save(SEEN, load(SEEN).concat(id));
        if (window.sendToast) sendToast('🥚 You found egg #' + id + ' — sign in to bank it');
      }
      return;
    }
    try {
      const { status, j } = await post(id);
      if (status !== 200 || !j) return;
      foundIds = new Set(j.found || []); total = j.total;
      if (!j.already) celebrate(id, j.awarded, foundIds.size, total);
    } catch {}
  }

  async function flushPending() {
    const pend = load(KEY);
    if (!pend.length || !signedIn()) return;
    save(KEY, []);
    for (const id of pend) { try { await found(id); } catch {} }
  }

  async function sync() {
    if (!signedIn()) return;
    try {
      const r = await fetch('/api/eggs', { credentials: 'same-origin' });
      if (!r.ok) return;
      const j = await r.json();
      foundIds = new Set(j.found || []); total = j.total;
    } catch {}
  }

  /* ---------- detectors: small, reusable, and none of them stop a real control from working ---------- */
  const D = {
    // N activations of an element (click, or Enter/Space if it is focusable) inside a window
    taps(el, n, ms, cb) {
      if (!el) return;
      let count = 0, t0 = 0;
      const hit = () => { const t = Date.now(); if (t - t0 > (ms || 2500)) count = 0; t0 = t; if (++count >= n) { count = 0; cb(); } };
      el.addEventListener('click', hit);
      el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el && el.tagName !== 'BUTTON' && el.tagName !== 'A') hit(); });
    },
    // pointer rests on an element for a while (a hidden hover region) — or focus does, for keyboard readers
    dwell(el, ms, cb) {
      if (!el) return;
      let t = 0; const start = () => { clearTimeout(t); t = setTimeout(cb, ms); }; const stop = () => clearTimeout(t);
      el.addEventListener('mouseenter', start); el.addEventListener('mouseleave', stop);
      el.addEventListener('focusin', start); el.addEventListener('focusout', stop);
    },
    // a word typed anywhere on the page, outside form fields
    typed(word, cb) {
      let buf = '';
      document.addEventListener('keydown', (e) => {
        const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
        if (e.key.length !== 1) return;
        buf = (buf + e.key.toLowerCase()).slice(-word.length);
        if (buf === word.toLowerCase()) { buf = ''; cb(); }
      });
    },
    // the sequence everybody knows
    konami(cb) {
      const seq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
      let i = 0;
      document.addEventListener('keydown', (e) => {
        const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        i = (k === seq[i]) ? i + 1 : (k === seq[0] ? 1 : 0);
        if (i === seq.length) { i = 0; cb(); }
      });
    },
    // the reader reaches the very bottom of the page
    bottom(cb) {
      let done = false;
      const onScroll = () => { if (done) return; if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) { done = true; cb(); } };
      addEventListener('scroll', onScroll, { passive: true });
    },
    // a hash in the URL nobody links to
    hash(name, cb) {
      const test = () => { if (location.hash === '#' + name) cb(); };
      addEventListener('hashchange', test); test();
    },
    // the reader opens the console and calls a function that was left there for them
    console(name, cb) {
      window[name] = function () { cb(); return 'nice.'; };
    },
    // the tab has been open and visible for a while — patience is a find
    stay(ms, cb) {
      let t = 0; const arm = () => { clearTimeout(t); if (!document.hidden) t = setTimeout(cb, ms); };
      document.addEventListener('visibilitychange', arm); arm();
    },
    // a long press / held key on an element
    hold(el, ms, cb) {
      if (!el) return;
      let t = 0; const down = () => { clearTimeout(t); t = setTimeout(cb, ms); }; const up = () => clearTimeout(t);
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up);
      el.addEventListener('keydown', (e) => { if (e.key === ' ' && !e.repeat && e.target === el && el.tagName !== 'BUTTON') down(); });
      el.addEventListener('keyup', up);
    },
    // a double-click on something decorative
    dbl(el, cb) { if (el) el.addEventListener('dblclick', cb); },
    // text selection of a specific phrase
    select(text, cb) {
      document.addEventListener('selectionchange', () => { try { if (String(getSelection()).trim().toLowerCase() === text.toLowerCase()) cb(); } catch {} });
    },
  };

  function register(id, arm) { reg.set(Number(id), arm); if (booted) tryArm(id, arm); }
  function tryArm(id, arm) { try { arm(() => found(id), D); } catch {} }

  /* Declarative eggs: any element with data-egg="N" is a taps(1) egg — the simplest kind, for spots that
     are just "notice this and touch it". data-egg-taps="N" asks for N touches. Never put data-egg on a
     control that has a real job; the click still goes through, but the find would feel like a side-effect. */
  function armDeclarative() {
    document.querySelectorAll('[data-egg]').forEach((el) => {
      const id = Number(el.dataset.egg); if (!id) return;
      const n = Number(el.dataset.eggTaps || 1);
      if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SUMMARY)$/.test(el.tagName)) el.setAttribute('tabindex', '0');
      D.taps(el, n, 2500, () => found(id));
    });
  }

  function boot() {
    if (booted) return; booted = true;
    armDeclarative();
    reg.forEach((arm, id) => tryArm(id, arm));
    sync().then(flushPending);
    document.addEventListener('auth:change', () => { sync().then(flushPending); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.EGGS = {
    register, found, sync,
    get found() { return [...foundIds]; },
    get total() { return total; },
    detect: D,
  };
})();
