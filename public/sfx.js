/* ===== sfx.js — the site's sound effects =====
 *
 * Owner, 2026-10-13: "make fun 8 bit sounds across the platform so when people are interacting with different features an
 * 8 bit sound that correlates audibly to the action being taken is played ... Make sure users can pause those sounds also
 * through the pause button in the nav bar that also pauses animations on the site."
 * Owner, 2026-10-14: "change the 8 bit sounds to something that is make modern game fun for people to interact with ... Make
 * the sounds natural and go with whatever action is being taken and make it smooth game sounds that are nice to the brain".
 *
 * So: modern game UI sounds, made in Web Audio — soft plucks, FM bells, bubble pops, filtered-noise whooshes and gentle
 * thumps, in a small generated room reverb, through a compressor so a run of rewards never clips. Every note (the plucks
 * and the bells) is on one major pentatonic scale, so sounds that overlap still harmonise; the taps, pops, whooshes and
 * thumps are unpitched glides. Quiet for the everyday (a tap, a tab), bright and rising for a reward (a like, a coin, a
 * level), a soft falling "uh-oh" for a refusal. No audio files, nothing loaded from anywhere.
 *
 * EVERY SOUND ANSWERS SOMETHING THE VISITOR DID, at once or when its outcome lands (a buy confirmed or reverted, a Rocket Run
 * that blows by itself, a toast that reports a result). Beyond those, only two start with nothing pressed, and only in a tab
 * that is showing: the notification chime when something new arrives (notifications.js), and a ghost found by staying on a
 * page (eggs.js). Nothing plays on load (the audio is only built after the visitor's first press). Two ways in:
 *   - window.SFX.play(name) from feature code, at the moment the thing happens (a post goes out, a like lands, a level is
 *     reached). An explicit sound replaces the generic one the same click would have made.
 *   - the generic layer below: the click on a link, a tab, a switch, a menu, a details panel or a plain button, and the
 *     toasts (a "⚠️" toast is the soft refusal). `data-sfx="name"` on any control picks its sound; `data-sfx="none"` silences it.
 *
 * Buying or swapping a token gets a calm confirmation (`swap`) when the wallet sends it, and only the plain toast bell when the
 * chain confirms it: a purchase never gets a reward fanfare (tests/sfx.mjs checks the swap code's sounds).
 *
 * PAUSE: the ⏸ in the nav (app.js, #motion-btn) pauses motion AND these sounds together; the choice is remembered on this
 * device (html.motion-off, localStorage send.motion). SFX.muted() is the one test, and every page's own sounds (the slot
 * machine) ask it too. The theme tune keeps its own play/pause button.
 */
(function () {
  'use strict';
  const root = document.documentElement;
  const muted = () => root.classList.contains('motion-off');
  /* SITE SWITCH — the owner paused the first (8-bit) set on 2026-10-14 and asked for this modern set the same day, so it is on.
     Set it to false to silence every sound on the site for everyone while every hook stays wired (no audio context is made).
     The slot machine's sounds keep their own switch; the nav's ⏸ pauses them too (SFX.muted() answers that pause alone). */
  const SITE_ON = true;

  /* ---------- the sound engine ---------- */
  const C = { ctx: null, bus: null, out: null, wet: null, send: null, ir: null, noise: null, live: 0, born: 0 };
  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);   // MIDI note number to frequency
  function roomIR(ctx, sec) {   // a soft small room: decaying stereo noise, so the reverb needs no file
    const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4) * Math.min(1, i / 90); }
    return b;
  }
  // what the voices play into: the dry path and the room, both into the bus. cut() swaps in fresh ones, so whatever is already
  // queued (the room's tail too) is cut loose rather than played when the audio wakes again
  function wire(ctx) {
    C.out = ctx.createGain(); C.out.gain.value = 0.85; C.out.connect(C.bus);
    const room = ctx.createConvolver(); room.buffer = C.ir;
    C.wet = ctx.createGain(); C.wet.gain.value = 0.3; room.connect(C.wet); C.wet.connect(C.bus);
    C.send = ctx.createGain(); C.send.connect(room);
  }
  /* The last stage, into the speakers: a compressor (glue and a ceiling, so rewards stack without clipping) and a soft top.
     One for the life of the page: a new compressor starts fully clamped and muffles the first ~80 ms through it, so it is
     made once, kept fed with silence (a silent source, so it settles and stays settled), and never rebuilt. */
  function master(ctx) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.18;
    const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 9000; shelf.gain.value = -4;   // no ice-pick top end
    comp.connect(shelf); shelf.connect(ctx.destination);
    try { const k = ctx.createConstantSource(); k.offset.value = 0; k.connect(comp); k.start(); } catch {}
    C.bus = comp;
  }
  /* Let go of everything queued or sounding: what plays next gets fresh buses (the dry path and the room), and the old ones
     are faded out over a few milliseconds (a cut mid-wave clicks) and dropped. The compressor stays; its 6 ms look-ahead
     holds only that faded silence by the time the audio sleeps. */
  function retire(fadeMs) {
    const ctx = C.ctx, o = C.out, w = C.wet, live = ctx.state === 'running' && fadeMs > 0;
    if (live) {
      const now = ctx.currentTime;
      for (const p of [o.gain, w.gain]) { try { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); p.linearRampToValueAtTime(0, now + fadeMs / 1000); } catch {} }
    }
    wire(ctx);
    const drop = () => { try { o.disconnect(); w.disconnect(); } catch {} };
    if (live) setTimeout(drop, fadeMs + 30); else drop();
  }
  function engine() {
    if (C.ctx) { if (C.ctx.state === 'suspended') C.ctx.resume().catch(() => {}); return C.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      const ctx = new AC();
      const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      C.ctx = ctx; C.ir = roomIR(ctx, 1.3); C.noise = nb; C.born = performance.now();
      master(ctx); wire(ctx);
      return ctx;
    } catch { return null; }
  }
  // the end of every voice: a gain the envelope shapes, panned, into the dry path and (a share of it) the room
  function voiceOut(o) {
    const ctx = C.ctx, g = ctx.createGain();
    let tail = g;
    if (o.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); g.connect(p); tail = p; }
    tail.connect(C.out);
    if (o.wet !== 0) { const s = ctx.createGain(); s.gain.value = o.wet == null ? 0.35 : o.wet; tail.connect(s); s.connect(C.send); }
    return g;
  }
  function env(g, t, peak, a, d) {   // a soft attack and an exponential fall: no clicks, nothing abrupt
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  const counted = (n, t, end) => { n.start(t); n.stop(end); C.live++; n.onended = () => { C.live--; }; return n; };
  function sine(t, f, end) { const o = C.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t); return counted(o, t, end); }
  function hiss(t, end) { const s = C.ctx.createBufferSource(); s.buffer = C.noise; s.loop = true; return counted(s, t, end); }
  const VOICES = {
    // a soft rounded pluck (a kalimba, more or less): a sine and a quiet octave, a hair of pitch settling in
    pluck(t, o) {
      const f = o.f || hz(o.n), d = o.d || 0.3, end = t + d + 0.1;
      const g = voiceOut(o); env(g, t, o.g || 0.1, 0.004, d);
      const a = sine(t, f * 1.006, end); a.frequency.exponentialRampToValueAtTime(f, t + 0.03); a.connect(g);
      const b = sine(t, f * 2, end), bg = C.ctx.createGain(); env(bg, t, 0.28, 0.003, d * 0.45); b.connect(bg); bg.connect(g);
    },
    // a bell: FM, the modulator's depth falling with the note, so it strikes bright and rings out pure
    bell(t, o) {
      const f = o.f || hz(o.n), d = o.d || 0.8, end = t + d + 0.1;
      const g = voiceOut(o); env(g, t, o.g || 0.08, 0.003, d);
      const car = sine(t, f, end), mod = sine(t, f * (o.ratio || 3.5), end), depth = C.ctx.createGain();
      depth.gain.setValueAtTime(f * (o.index || 1.6), t); depth.gain.exponentialRampToValueAtTime(f * 0.02, t + d * 0.6);
      mod.connect(depth); depth.connect(car.frequency); car.connect(g);
    },
    // a bubble pop: a quick glide, up for something gained, down for something taken back
    pop(t, o) {
      const d = o.d || 0.13, end = t + d + 0.05;
      const g = voiceOut(o); env(g, t, o.g || 0.12, 0.003, d);
      const a = sine(t, o.f0, end); a.frequency.exponentialRampToValueAtTime(o.f1, t + d * 0.6); a.connect(g);
    },
    // air: noise through a band-pass that sweeps, swelling then fading
    whoosh(t, o) {
      const d = o.d || 0.3, end = t + d + 0.05, ctx = C.ctx;
      const g = voiceOut(Object.assign({ wet: 0.25 }, o));
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.g || 0.05, t + d * 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = o.q || 1.1;
      bp.frequency.setValueAtTime(o.f0, t); bp.frequency.exponentialRampToValueAtTime(o.f1, t + d);
      hiss(t, end).connect(bp); bp.connect(g);
    },
    // a soft thump: a low sine falling in pitch, with a felt (low-passed) tap on its front
    thump(t, o) {
      const d = o.d || 0.25, end = t + d + 0.05, ctx = C.ctx, peak = o.g || 0.15;
      const g = voiceOut(Object.assign({ wet: 0.2 }, o)); env(g, t, peak, 0.004, d);
      const a = sine(t, o.f0, end); a.frequency.exponentialRampToValueAtTime(o.f1, t + d * 0.8); a.connect(g);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const ng = ctx.createGain(); env(ng, t, 0.5, 0.002, 0.05);
      hiss(t, t + 0.08).connect(lp); lp.connect(ng); ng.connect(g);
    },
    // a small rounded "pok" for the plainest press: a sine that drops a little as it fades
    tick(t, o) {
      const f = o.f || 1400, end = t + 0.08;
      const g = voiceOut(Object.assign({ wet: 0.15 }, o)); env(g, t, o.g || 0.05, 0.002, 0.05);
      const a = sine(t, f, end); a.frequency.exponentialRampToValueAtTime(f * 0.65, t + 0.04); a.connect(g);
    },
  };
  // a run of notes in one voice: `at` is when it starts, `each` the gap between notes
  const run = (notes, at, each, v, extra) => notes.map((n, i) => Object.assign({ v, n }, extra, { at: at + i * each }));
  // sparkle: a few high bells climbing the scale (G, C, E, G, C above the C given, C6 unless said), quick, spread left and right
  const sparkle = (at, count, g, base) => [7, 12, 16, 19, 24].slice(0, count).map((st, i) => ({ v: 'bell', n: (base || 84) + st, at: at + i * 0.045, g: g * (1 - i * 0.12), d: 0.5, ratio: 2, index: 0.8, pan: (i % 2 ? 0.5 : -0.5) * (0.6 + Math.random() * 0.4), wet: 0.55 }));

  /* ---------- the sounds: named for what the visitor did, each a few voices ----------
     Pitches are MIDI note numbers on C major pentatonic (C D E G A): 72 = C5, 76 = E5, 79 = G5, 81 = A5, 84 = C6, 86 = D6,
     88 = E6, 91 = G6, 93 = A6, 96 = C7. `g` is the level, `d` how long it rings, `at` when it starts (seconds). */
  const SOUNDS = {
    tap:      () => [{ v: 'tick', f: 1400, g: 0.05 }],                                                                   // a plain button: barely there
    nav:      () => [{ v: 'whoosh', f0: 700, f1: 2600, d: 0.2, g: 0.03 }, { v: 'pluck', n: 79, at: 0.05, g: 0.065, d: 0.22 }],   // off to another page
    select:   () => [{ v: 'pluck', n: 76, g: 0.075, d: 0.22 }],                                                          // a tab, a chip, an option
    on:       () => [{ v: 'pluck', n: 72, g: 0.065, d: 0.16 }, { v: 'pluck', n: 79, at: 0.07, g: 0.085, d: 0.3 }],        // a switch turned on: a step up
    off:      () => [{ v: 'pluck', n: 79, g: 0.06, d: 0.14 }, { v: 'pluck', n: 72, at: 0.07, g: 0.06, d: 0.24 }],         // ...and off: a step down
    open:     () => [{ v: 'whoosh', f0: 450, f1: 3200, d: 0.22, g: 0.03 }, { v: 'pluck', n: 84, at: 0.08, g: 0.06, d: 0.28 }],   // a panel or a menu opens
    close:    () => [{ v: 'whoosh', f0: 2800, f1: 450, d: 0.2, g: 0.025 }, { v: 'pluck', n: 72, at: 0.03, g: 0.05, d: 0.2 }],
    toast:    () => [{ v: 'bell', n: 88, g: 0.055, d: 0.7 }],                                                            // the site says something
    send:     () => [{ v: 'whoosh', f0: 300, f1: 5200, d: 0.3, g: 0.055 }].concat(run([84, 88, 91], 0.12, 0.05, 'pluck', { g: 0.09, d: 0.42 })),   // something you wrote goes out
    like:     () => [{ v: 'pop', f0: 380, f1: 1050, g: 0.13 }].concat(sparkle(0.05, 2, 0.04)),                            // a like lands: a pop and a sparkle
    unlike:   () => [{ v: 'pop', f0: 900, f1: 360, g: 0.08 }],
    follow:   () => [{ v: 'pluck', n: 79, g: 0.085, d: 0.3 }, { v: 'pluck', n: 84, at: 0.08, g: 0.095, d: 0.4 }, { v: 'bell', n: 91, at: 0.16, g: 0.06, d: 0.9 }].concat(sparkle(0.2, 2, 0.03)),
    unfollow: () => [{ v: 'pluck', n: 84, g: 0.065, d: 0.24 }, { v: 'pluck', n: 79, at: 0.09, g: 0.055, d: 0.3 }],
    coin:     () => [{ v: 'bell', n: 88, g: 0.085, d: 0.22 }, { v: 'bell', n: 93, at: 0.08, g: 0.1, d: 0.95 }].concat(sparkle(0.1, 3, 0.03)),   // the daily check-in
    powerup:  () => [{ v: 'whoosh', f0: 250, f1: 4000, d: 0.55, g: 0.035 }].concat(run([72, 76, 79, 84, 88, 91, 96], 0, 0.06, 'pluck', { g: 0.085, d: 0.32 }),   // a level, a badge, a boost
                     [84, 88, 91].map((n, i) => ({ v: 'bell', n, at: 0.46 + i * 0.012, g: 0.065, d: 1.5, pan: (i - 1) * 0.4 })), sparkle(0.5, 5, 0.035)),
    success:  () => run([84, 88, 91], 0, 0.08, 'bell', { g: 0.075, d: 0.8 }),                                            // done
    error:    () => [{ v: 'pluck', n: 76, g: 0.075, d: 0.16 }, { v: 'pluck', n: 69, at: 0.13, g: 0.08, d: 0.32 },             // refused: a soft falling "uh-oh" (E5 to A4, which a phone's
                     { v: 'thump', f0: 220, f1: 150, g: 0.07, d: 0.2 }, { v: 'thump', at: 0.13, f0: 165, f1: 105, g: 0.065, d: 0.3 }],   // speaker plays) on a low body for bigger ones
    warn:     () => [{ v: 'pluck', n: 81, g: 0.065, d: 0.16 }, { v: 'pluck', n: 81, at: 0.15, g: 0.065, d: 0.22 }],             // look again
    remove:   () => [{ v: 'whoosh', f0: 2400, f1: 320, d: 0.26, g: 0.035 }, { v: 'pop', at: 0.05, f0: 620, f1: 200, g: 0.08 }],   // gone: a poof
    copy:     () => [{ v: 'tick', f: 1900, g: 0.045 }, { v: 'pluck', n: 91, at: 0.05, g: 0.055, d: 0.2 }],              // on the clipboard
    notify:   () => [{ v: 'bell', n: 84, g: 0.065, d: 0.6 }, { v: 'bell', n: 91, at: 0.12, g: 0.075, d: 0.9 }],             // something new for you
    launch:   () => [{ v: 'thump', f0: 95, f1: 45, g: 0.13, d: 0.45 }, { v: 'whoosh', f0: 160, f1: 6200, d: 0.75, g: 0.07 }]   // a rocket goes up
                     .concat(run([72, 79, 84, 91], 0.25, 0.07, 'pluck', { g: 0.075, d: 0.3 }), [{ v: 'bell', n: 96, at: 0.6, g: 0.065, d: 1.1 }], sparkle(0.62, 3, 0.03)),
    cashout:  () => [0, 0.07, 0.14, 0.21].map((at, i) => ({ v: 'bell', n: i % 2 ? 93 : 88, at, g: 0.075, d: 0.35, pan: i % 2 ? 0.35 : -0.35 }))   // banked: coins, then a chord
                     .concat([84, 88, 91, 96].map((n, i) => ({ v: 'bell', n, at: 0.3 + i * 0.012, g: 0.055, d: 1.3 })), sparkle(0.32, 4, 0.03)),
    crash:    () => [{ v: 'thump', f0: 115, f1: 38, g: 0.12, d: 0.8 }, { v: 'whoosh', f0: 1800, f1: 300, d: 0.9, g: 0.045 }, { v: 'pop', at: 0.02, f0: 760, f1: 190, g: 0.07, d: 0.4 }],   // it blew: a soft boom, with a falling tone a phone can play
    secret:   () => run([79, 81, 84, 86, 91, 96], 0, 0.07, 'bell', { g: 0.055, d: 0.8, ratio: 2, index: 1.1 })            // a hidden find: a little magic
                     .concat(sparkle(0.38, 5, 0.03), [{ v: 'bell', n: 84, at: 0.42, g: 0.045, d: 1.6 }, { v: 'bell', n: 91, at: 0.43, g: 0.045, d: 1.6 }]),
    vote:     () => [{ v: 'tick', f: 1500, g: 0.045 }, { v: 'pluck', n: 86, at: 0.03, g: 0.075, d: 0.3 }, { v: 'bell', n: 93, at: 0.1, g: 0.045, d: 0.7 }],   // an upvote counted: up
    downvote: () => [{ v: 'tick', f: 1100, g: 0.04 }, { v: 'pluck', n: 81, at: 0.03, g: 0.065, d: 0.2 }, { v: 'pluck', n: 76, at: 0.1, g: 0.06, d: 0.28 }],   // a downvote counted: a step down
    connect:  () => [{ v: 'pluck', n: 79, g: 0.075, d: 0.2 }, { v: 'pluck', n: 86, at: 0.08, g: 0.085, d: 0.3 }, { v: 'bell', n: 91, at: 0.16, g: 0.065, d: 0.9 }],   // linked: it clicks into place
    swap:     () => [{ v: 'whoosh', f0: 500, f1: 2400, d: 0.32, g: 0.04 }, { v: 'pluck', n: 79, at: 0.15, g: 0.065, d: 0.3 }],   // sent: a calm confirmation, no fanfare
    zip:      () => [{ v: 'pop', f0: 520, f1: 1560, g: 0.08, d: 0.12 }, { v: 'whoosh', f0: 900, f1: 4200, d: 0.18, g: 0.025 }],   // a small rocket: a hype tap, a sticker on a picture
    scan:     () => [{ v: 'bell', n: 96, g: 0.05, d: 0.8, ratio: 1, index: 0.3, wet: 0.7 }, { v: 'bell', n: 96, at: 0.32, g: 0.02, d: 0.6, ratio: 1, index: 0.3, wet: 0.7 }],   // a sonar ping and its echo
  };

  /* ---------- playing ---------- */
  const last = {};
  const GAP = { launch: 600, powerup: 600, secret: 600, cashout: 400, crash: 400, zip: 120 };   // the long ones once, however fast the taps come
  let lastExplicit = -Infinity, pending = null;
  // where the browser cannot say whether the visitor has pressed anything yet (no navigator.userActivation): the events that count as one
  let gestured = false;
  for (const t of ['pointerup', 'touchend', 'mousedown', 'keydown', 'click']) document.addEventListener(t, (e) => { if (e.isTrusted) gestured = true; }, true);   // -Infinity, not 0: performance.now() starts at the page's load, and 0 would hush the first 700 ms of toasts
  function sound(name) {
    if (!SITE_ON || muted() || document.hidden) return false;
    // before the visitor's first tap or key the browser keeps audio asleep; a sound queued then would play late, out of place
    if (navigator.userActivation ? !navigator.userActivation.hasBeenActive : !gestured) return false;
    const make = SOUNDS[name]; if (!make) return false;
    const now = performance.now();
    if (last[name] && now - last[name] < (GAP[name] || 55)) return false;   // a held key or a double tap: once
    if (C.live > 90) return false;                              // already a lot going on
    const ctx = engine(); if (!ctx || ctx.state === 'closed') return false;
    last[name] = now;
    const t0 = ctx.currentTime + Math.max(0.01, (130 - (performance.now() - C.born)) / 1000);   // a sound in the audio's first 130 ms waits for its compressor to settle (the first of a page only)
    try { for (const o of make()) { const v = VOICES[o.v]; if (v) v(t0 + (o.at || 0), o); } } catch {}
    return true;
  }
  const SFX = {
    play(name) { if (pending) { clearTimeout(pending); pending = null; } lastExplicit = performance.now(); return sound(name); },
    muted,
    on: SITE_ON,
    names: Object.keys(SOUNDS),
    score: (name) => (SOUNDS[name] ? SOUNDS[name]() : null),   // what a sound is made of, voice by voice (tests/sfx.mjs reads it)
  };
  window.SFX = SFX;

  // the generic sound for a click is decided after the click's own handlers have run, so a feature's explicit sound wins
  function later(fn) { if (pending) clearTimeout(pending); const t = performance.now(); pending = setTimeout(() => { pending = null; if (lastExplicit < t) fn(); }, 0); }

  const SKIP = '#slots, #music-player, #motion-btn, [data-sfx="none"], [disabled], [aria-disabled="true"]';
  document.addEventListener('click', (e) => {
    if (!SITE_ON || !e.isTrusted || muted()) return;
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
        if (/^\/(guide|swap|tokens|beta|rocketize)$/.test(href) && document.getElementById(href.slice(1))) return sound('select');   // a home section, on the home page: a jump, not a page change
        if (/^(mailto|tel):/i.test(href)) return sound('tap');
        return sound('nav');
      }
      return sound('tap');
    });
  }, true);
  document.addEventListener('change', (e) => {   // a <select>, which a click alone does not settle
    if (!SITE_ON || !e.isTrusted || muted() || e.target.tagName !== 'SELECT' || e.target.closest(SKIP)) return;
    later(() => sound('select'));
  }, true);

  // dialogs the site opens through its own events
  // (unless the feature that opened or closed it has just played its own: the age gate's Enter, a sign-in)
  document.addEventListener('jsi:modalopen', () => { if (performance.now() - lastExplicit > 300) SFX.play('open'); });
  document.addEventListener('jsi:modalclose', () => { if (performance.now() - lastExplicit > 300) SFX.play('close'); });

  // a toast is the site answering: a "⚠️" one, or one saying something did not work, gets the soft refusal
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

  // iOS only lets audio start inside a gesture: wake the audio on the first touch, so the first sound is not lost
  // anything queued while it slept (a toast before the first press, in a browser that cannot say) would play now, late and out
  // of place: it is let go first. This runs before the press's own sound is made.
  const wake = () => {
    if (!SITE_ON || muted() || document.hidden) return;
    if (!C.ctx) { if (navigator.userActivation ? navigator.userActivation.hasBeenActive : gestured) engine(); return; }   // built on the press, so it has settled by the click
    if (C.ctx.state === 'suspended') { retire(0); C.ctx.resume().catch(() => {}); }
  };
  document.addEventListener('pointerdown', wake, true);
  document.addEventListener('keydown', wake, true);
  // silence NOW: what is already queued stays on the old chain, which is faded and cut loose (a suspended clock would play it
  // on resume); the audio sleeps once the fade is done, if it is still meant to
  function cut() { if (!C.ctx) return; retire(12); setTimeout(() => { if (C.ctx && (muted() || document.hidden)) C.ctx.suspend().catch(() => {}); }, 45); }
  document.addEventListener('visibilitychange', () => { if (C.ctx) { if (document.hidden) cut(); else if (!muted()) C.ctx.resume().catch(() => {}); } });
  // paused from the nav: stop whatever is sounding now, not just what comes next
  document.addEventListener('jsi:sfx', (e) => { if (e.detail && e.detail.on === false) cut(); });
})();
