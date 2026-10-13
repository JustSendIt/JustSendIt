/* ===== sfx.js — the site's 8-bit sound effects =====
 *
 * Owner, 2026-10-13: "make fun 8 bit sounds across the platform so when people are interacting with different features an
 * 8 bit sound that correlates audibly to the action being taken is played ... Make sure users can pause those sounds also
 * through the pause button in the nav bar that also pauses animations on the site."
 *
 * A tiny chiptune sound chip in Web Audio, laid out like the old consoles': two pulse channels (12.5 % and 25 % duty, plus a
 * 50 % square), a triangle, and a noise channel from a 15-bit shift register (long mode for hiss and booms, short mode for
 * metallic ticks). Pitch and volume move in 1/60 s steps, as those chips did, and everything runs through a 16-level
 * quantiser for the grit. No audio files, nothing loaded from anywhere.
 *
 * EVERY SOUND ANSWERS SOMETHING THE VISITOR DID. Nothing plays on load or by itself (browsers would refuse anyway; the chip
 * is only built inside a gesture). Two ways in:
 *   - window.SFX.play(name) from feature code, at the moment the thing happens (a post goes out, a like lands, a level is
 *     reached). An explicit sound replaces the generic one the same click would have made.
 *   - the generic layer below: the click on a link, a tab, a switch, a menu, a details panel or a plain button, and the
 *     toasts (a "⚠️" toast is an error buzz). `data-sfx="name"` on any control picks its sound; `data-sfx="none"` silences it.
 *
 * PAUSE: the ⏸ in the nav (app.js, #motion-btn) pauses motion AND these sounds together; the choice is remembered on this
 * device (html.motion-off, localStorage send.motion). SFX.muted() is the one test, and every page's own sounds (the slot
 * machine) ask it too. The theme tune keeps its own play/pause button.
 */
(function () {
  'use strict';
  const root = document.documentElement;
  const muted = () => root.classList.contains('motion-off');

  /* ---------- the chip ---------- */
  const FR = 1 / 60;                                  // one frame: the step every pitch and volume change moves in
  const C = { ctx: null, out: null, waves: {}, noise: null, tick: null, live: 0 };
  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);   // MIDI note number to frequency
  function pulseWave(ctx, duty) {                     // a pulse wave of the given duty, as a Fourier series
    const N = 48, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) re[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    return ctx.createPeriodicWave(re, im);
  }
  function lfsrBuffer(ctx, short, hold) {             // the noise channel: a 15-bit shift register, one step every `hold` samples
    const len = short ? 93 * hold * 64 : ctx.sampleRate;
    const b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    let r = 1;
    for (let i = 0; i < len; i++) {
      if (i % hold === 0) { const bit = (r ^ (r >> (short ? 6 : 1))) & 1; r = (r >> 1) | (bit << 14); }
      d[i] = (r & 1) ? 0.9 : -0.9;
    }
    return b;
  }
  function chip() {
    if (C.ctx) { if (C.ctx.state === 'suspended') C.ctx.resume().catch(() => {}); return C.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      const ctx = new AC();
      const crush = ctx.createWaveShaper();             // 16 output levels: the 4-bit DAC
      const k = new Float32Array(1024);
      for (let i = 0; i < k.length; i++) { const x = (i / (k.length - 1)) * 2 - 1; k[i] = Math.round(x * 8) / 8; }
      crush.curve = k;
      const out = ctx.createGain(); out.gain.value = 0.5;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000;   // the TV speaker's roll-off
      out.connect(crush); crush.connect(lp); lp.connect(ctx.destination);
      C.ctx = ctx; C.out = out;
      C.waves = { p12: pulseWave(ctx, 0.125), p25: pulseWave(ctx, 0.25), sq: pulseWave(ctx, 0.5) };
      C.noise = lfsrBuffer(ctx, false, 2); C.tick = lfsrBuffer(ctx, true, 6);
      return ctx;
    } catch { return null; }
  }
  /* one note on one channel. o: { ch: 'p12'|'p25'|'sq'|'tri'|'noise'|'tick', n: note or [notes per step], at: frames from now,
     len: frames, vol: 0-15 (or [vol per frame]), decay: volume lost per frame, step: frames per entry of n, rate: noise pitch (or [rate per step]) } */
  function note(t0, o) {
    const ctx = C.ctx, t = t0 + (o.at || 0) * FR, len = Math.max(1, o.len || 4);
    const g = ctx.createGain();
    let src;
    if (o.ch === 'noise' || o.ch === 'tick') {
      src = ctx.createBufferSource(); src.buffer = o.ch === 'tick' ? C.tick : C.noise; src.loop = true;
      const rates = Array.isArray(o.rate) ? o.rate : [o.rate || 1];
      rates.forEach((r, i) => src.playbackRate.setValueAtTime(r, t + i * (o.step || 1) * FR));
    } else {
      src = ctx.createOscillator();
      if (o.ch === 'tri') src.type = 'triangle'; else src.setPeriodicWave(C.waves[o.ch] || C.waves.sq);
      const ns = Array.isArray(o.n) ? o.n : [o.n];
      ns.forEach((n, i) => src.frequency.setValueAtTime(hz(n), t + i * (o.step || 1) * FR));
    }
    const vols = Array.isArray(o.vol) ? o.vol : null;
    let v = vols ? vols[0] : (o.vol == null ? 8 : o.vol);
    g.gain.setValueAtTime(0, t);
    for (let f = 0; f < len; f++) {
      if (vols) v = vols[Math.min(f, vols.length - 1)];
      else if (f) v = Math.max(0, v - (o.decay || 0));
      g.gain.setValueAtTime((Math.round(v) / 15) * (o.ch === 'tri' ? 0.32 : o.ch === 'noise' || o.ch === 'tick' ? 0.2 : 0.16), t + f * FR);
    }
    g.gain.setValueAtTime(0, t + len * FR);
    src.connect(g); g.connect(C.out);
    src.start(t); src.stop(t + len * FR + 0.02);
    C.live++; src.onended = () => { C.live--; try { g.disconnect(); } catch {} };
  }
  const arp = (ch, notes, each, vol, decay, extra) => notes.map((n, i) => Object.assign({ ch, n, at: i * each, len: each, vol, decay }, extra || {}));

  /* ---------- the sounds: each one a few notes, named for what the visitor did ---------- */
  const SOUNDS = {
    tap:      () => [{ ch: 'p25', n: 84, len: 2, vol: 4, decay: 1 }],                                                       // a plain button
    nav:      () => [{ ch: 'p25', n: [79, 84], step: 2, len: 5, vol: 5, decay: 1 }],                                        // off to another page
    select:   () => [{ ch: 'p25', n: 83, len: 3, vol: 5, decay: 1 }, { ch: 'p12', n: 95, at: 1, len: 2, vol: 2 }],         // a tab, chip, option
    on:       () => [{ ch: 'p25', n: [76, 81], step: 3, len: 7, vol: 6, decay: 0.6 }],                                      // a switch turned on
    off:      () => [{ ch: 'p25', n: [81, 76], step: 3, len: 7, vol: 5, decay: 0.6 }],                                      // ...and off
    open:     () => [{ ch: 'p12', n: [72, 74, 76, 79, 81, 84], step: 1, len: 7, vol: 6, decay: 0.5 }],                      // a menu, panel or dialog opens
    close:    () => [{ ch: 'p12', n: [84, 81, 79, 76, 74, 72], step: 1, len: 7, vol: 5, decay: 0.5 }],                      // ...and closes
    toast:    () => [{ ch: 'tri', n: 88, len: 8, vol: 9, decay: 1 }, { ch: 'p12', n: 95, len: 3, vol: 3 }],                 // the site says something
    send:     () => [{ ch: 'p12', n: [60, 64, 68, 72, 76, 80, 84, 88], step: 1, len: 8, vol: 8, decay: 0.4 },               // something you wrote goes out: pew
                     { ch: 'p25', n: 96, at: 8, len: 5, vol: 6, decay: 1 }],
    like:     () => arp('p25', [84, 91, 96], 2, 8, 0.5).concat([{ ch: 'tick', rate: 1.6, len: 2, vol: 5 }]),               // a like / reaction lands: pop and sparkle
    unlike:   () => [{ ch: 'p25', n: [79, 72], step: 2, len: 6, vol: 5, decay: 0.7 }],
    follow:   () => arp('p25', [72, 76, 79, 84], 3, 8, 0.3).concat([{ ch: 'tri', n: 60, len: 12, vol: 10, decay: 0.5 }]), // you follow someone: a step up
    unfollow: () => arp('p25', [84, 79, 76, 72], 3, 6, 0.3),
    coin:     () => [{ ch: 'p25', n: 84, len: 4, vol: 9 }, { ch: 'p25', n: 91, at: 4, len: 16, vol: 9, decay: 0.55 }],      // points, a check-in, a small reward
    powerup:  () => arp('p25', [72, 76, 79, 84, 88, 91, 96], 3, 9, 0.2)                                                   // a level, a badge, a boost: the big one
                     .concat(arp('p12', [64, 67, 72, 76, 79, 84, 88], 3, 5, 0.2, { at: 0 }).map((x, i) => Object.assign(x, { at: i * 3 + 1 })))
                     .concat([{ ch: 'tri', n: [48, 52, 55, 60], step: 6, len: 26, vol: 12, decay: 0.3 }, { ch: 'p25', n: 96, at: 21, len: 18, vol: 8, decay: 0.45 }]),
    success:  () => arp('p25', [84, 88, 91], 4, 8, 0.3).concat([{ ch: 'p25', n: 96, at: 12, len: 12, vol: 8, decay: 0.6 }, { ch: 'tri', n: [60, 67], step: 6, len: 18, vol: 11, decay: 0.4 }]),
    error:    () => [{ ch: 'tick', rate: 0.6, len: 2, vol: 7 }, { ch: 'sq', n: 52, len: 7, vol: 9, decay: 0.4 }, { ch: 'sq', n: 48, at: 7, len: 14, vol: 9, decay: 0.55 }],   // refused: a low bwonk
    warn:     () => [{ ch: 'p25', n: 81, len: 4, vol: 7 }, { ch: 'p25', n: 81, at: 7, len: 5, vol: 7, decay: 1 }],         // look again / tap again to confirm
    remove:   () => [{ ch: 'noise', rate: 1.2, len: 4, vol: 6, decay: 1.5 }, { ch: 'p12', n: [84, 79, 74, 69, 64, 59, 54, 48], step: 1, len: 9, vol: 7, decay: 0.5 }],   // deleted, left, taken off
    copy:     () => [{ ch: 'p25', n: 88, len: 2, vol: 6 }, { ch: 'p25', n: 88, at: 3, len: 2, vol: 6 }, { ch: 'p25', n: 95, at: 6, len: 4, vol: 6, decay: 1 }],
    notify:   () => [{ ch: 'tri', n: 79, len: 6, vol: 11, decay: 0.8 }, { ch: 'p25', n: 86, at: 5, len: 10, vol: 7, decay: 0.6 }],   // something new for you
    launch:   () => [{ ch: 'noise', rate: [0.25, 0.35, 0.5, 0.7, 0.9, 1.2, 1.5, 1.9, 2.4, 3], step: 2, len: 22, vol: 9, decay: 0.3 },   // Send It, a launch, a call: a rocket
                     { ch: 'p12', n: [48, 52, 55, 60, 64, 67, 72, 76, 79, 84, 88, 91], step: 2, len: 24, vol: 7, decay: 0.15 }],
    cashout:  () => [0, 5, 10].map((at, i) => ({ ch: 'p25', n: [84 + i * 2, 91 + i * 2], step: 3, at, len: 8, vol: 9, decay: 0.6 }))   // banked: coins
                     .concat([{ ch: 'p25', n: 100, at: 15, len: 18, vol: 8, decay: 0.45 }, { ch: 'tri', n: 60, at: 15, len: 18, vol: 11, decay: 0.5 }]),
    crash:    () => [{ ch: 'noise', rate: [0.5, 0.35, 0.25, 0.18, 0.12], step: 6, len: 40, vol: 13, decay: 0.32 },             // it blew: a boom
                     { ch: 'sq', n: [60, 55, 50, 45, 40, 36], step: 2, len: 12, vol: 8, decay: 0.6 }],
    secret:   () => arp('p25', [79, 81, 83, 86, 91], 5, 8, 0.25)                                                         // a hidden find
                     .concat(arp('p12', [74, 76, 79, 83, 86], 5, 4, 0.25).map((x, i) => Object.assign(x, { at: i * 5 + 2 })))
                     .concat([{ ch: 'tri', n: [55, 59, 62, 67], step: 6, len: 30, vol: 11, decay: 0.3 }, { ch: 'p25', n: 98, at: 26, len: 20, vol: 7, decay: 0.35 }]),
    vote:     () => [{ ch: 'tick', rate: 0.9, len: 2, vol: 7 }, { ch: 'p25', n: [86, 93], step: 3, at: 1, len: 10, vol: 8, decay: 0.6 }],
    connect:  () => arp('p25', [76, 80, 83, 88], 3, 8, 0.3).concat([{ ch: 'tri', n: 64, len: 14, vol: 10, decay: 0.5 }]),  // a wallet or account linked
    swap:     () => [{ ch: 'p12', n: [84, 88, 84, 88, 84, 88, 91], step: 2, len: 16, vol: 7, decay: 0.25 }, { ch: 'tri', n: [60, 64, 67], step: 5, len: 15, vol: 10 }],
    scan:     () => [{ ch: 'tri', n: 96, len: 3, vol: 10, decay: 2 }, { ch: 'tri', n: 96, at: 9, len: 3, vol: 5, decay: 1.5 }, { ch: 'tri', n: 96, at: 18, len: 3, vol: 2, decay: 0.6 }],   // a radar ping
  };

  /* ---------- playing ---------- */
  const last = {};
  let lastExplicit = -Infinity, pending = null;   // -Infinity, not 0: performance.now() starts at the page's load, and 0 would hush the first 700 ms of toasts
  function sound(name) {
    if (muted() || document.hidden) return false;
    // before the visitor's first tap or key the browser keeps audio asleep; a sound queued then would play late, out of place
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
    const make = SOUNDS[name]; if (!make) return false;
    const now = performance.now();
    if (last[name] && now - last[name] < 55) return false;      // a held key or a double tap: once
    if (C.live > 40) return false;                              // already a lot going on
    const ctx = chip(); if (!ctx || ctx.state === 'closed') return false;
    last[name] = now;
    const t0 = ctx.currentTime + 0.01;
    try { make().forEach((o) => note(t0, o)); } catch {}
    return true;
  }
  const SFX = {
    play(name) { if (pending) { clearTimeout(pending); pending = null; } lastExplicit = performance.now(); return sound(name); },
    muted,
    names: Object.keys(SOUNDS),
  };
  window.SFX = SFX;

  // the generic sound for a click is decided after the click's own handlers have run, so a feature's explicit sound wins
  function later(fn) { if (pending) clearTimeout(pending); const t = performance.now(); pending = setTimeout(() => { pending = null; if (lastExplicit < t) fn(); }, 0); }

  const SKIP = '#slots, #mp-toggle, #motion-btn, [data-sfx="none"], [disabled], [aria-disabled="true"]';
  document.addEventListener('click', (e) => {
    if (!e.isTrusted || muted()) return;
    const el = e.target.closest('[data-sfx], summary, a[href], button, [role="button"], [role="tab"], [role="radio"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="switch"], input[type="checkbox"], input[type="radio"]');
    if (!el || el.closest(SKIP)) return;
    const named = el.getAttribute('data-sfx');
    if (named) { later(() => sound(named)); return; }
    later(() => {
      if (el.tagName === 'SUMMARY') { const d = el.parentElement; return sound(d && d.open ? 'open' : 'close'); }
      if (el.matches('input[type="checkbox"], [role="switch"]')) return sound((el.checked || el.getAttribute('aria-checked') === 'true') ? 'on' : 'off');
      if (el.hasAttribute('aria-pressed')) return sound(el.getAttribute('aria-pressed') === 'true' ? 'on' : 'off');
      if (el.hasAttribute('aria-expanded')) return sound(el.getAttribute('aria-expanded') === 'true' ? 'open' : 'close');
      if (el.matches('[role="tab"], [role="radio"], [role="option"], [role="menuitemradio"], input[type="radio"]')) return sound('select');
      if (el.tagName === 'A') {
        const href = el.getAttribute('href') || '';
        if (href.startsWith('#')) return sound('select');
        if (/^(mailto|tel):/i.test(href)) return sound('tap');
        return sound('nav');
      }
      return sound('tap');
    });
  }, true);
  document.addEventListener('change', (e) => {   // a <select>, which a click alone does not settle
    if (!e.isTrusted || muted() || e.target.tagName !== 'SELECT' || e.target.closest(SKIP)) return;
    later(() => sound('select'));
  }, true);

  // dialogs the site opens through its own events
  document.addEventListener('jsi:modalopen', () => SFX.play('open'));
  document.addEventListener('jsi:modalclose', () => SFX.play('close'));

  // a toast is the site answering: a "⚠️" one, or one saying something did not work, buzzes
  const ERR = /^\s*(⚠️|❌|🚫|⛔)|\b(could ?n[o']t|cannot|can't|failed|error|too many|slow down|not allowed|invalid|wrong|expired|blocked|denied|refused)\b/i;
  const COPIED = /\bcopied\b/i;
  function hookToasts() {
    const t = window.sendToast;
    if (typeof t !== 'function' || t.__sfx) return;
    const wrapped = function (msg) {
      try {
        const s = String(msg || '');
        // an explicit sound for the same moment (or the click that caused it, a moment ago) already said it
        if (performance.now() - lastExplicit > 700) sound(ERR.test(s) ? 'error' : COPIED.test(s) ? 'copy' : 'toast');
      } catch {}
      return t.apply(this, arguments);
    };
    wrapped.__sfx = true;
    window.sendToast = wrapped;
  }
  hookToasts();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookToasts); else setTimeout(hookToasts, 0);
  window.addEventListener('load', hookToasts);

  // iOS only lets audio start inside a gesture: wake the chip on the first touch, so the first sound is not lost
  const wake = () => { if (!muted() && C.ctx && C.ctx.state === 'suspended') C.ctx.resume().catch(() => {}); };
  document.addEventListener('pointerdown', wake, true);
  document.addEventListener('keydown', wake, true);
  document.addEventListener('visibilitychange', () => { if (C.ctx) { if (document.hidden) C.ctx.suspend().catch(() => {}); else if (!muted()) C.ctx.resume().catch(() => {}); } });
  // paused from the nav: stop whatever is sounding now, not just what comes next
  document.addEventListener('jsi:sfx', (e) => { if (C.ctx && e.detail && e.detail.on === false) C.ctx.suspend().catch(() => {}); });
})();
