/* ===== slots.js — "Just Spin It", the Arcade's classic three-reel slot machine =====
 *
 * Owner, 2026-10-13: "a simple slot machine that anyone can spin on the arcade tab with the jackpot being 3 rockets and
 * the other options being other emojis ... make it feel and sound like a classic slot machine as if you were playing it
 * in person".
 *
 * FREE PLAY, NOTHING AT STAKE. Anyone can spin, as often as they like, signed in or not. A spin costs nothing and wins
 * nothing but points on this device's scoreboard (localStorage) — points that buy nothing, are worth nothing and never
 * reach the server. Nothing here talks to the server at all.
 *
 * FAIR BY CONSTRUCTION. Each reel is a strip of 20 stops (the same stops on all three, turned differently). A spin
 * picks every reel's stop on its own, all 20 equally likely (crypto.getRandomValues), BEFORE the reels move — the
 * animation only shows a result already picked. No weighted "virtual reel" and no near-miss shaping. The paytable's
 * odds are counted here from these strips over all 8,000 outcomes, so the page cannot print odds the machine does not
 * play.
 *
 * FEEL. The reels are drawn on canvas as drums (symbols foreshorten and darken toward the top and bottom of the window),
 * kick back a hair before they spin, blur at speed, tick past the payline as they slow, overshoot and settle with a
 * clunk, left to right. With two rockets showing, the third reel holds out longer. A lever you can tap or drag, chasing
 * marquee bulbs, LED counters that count a win up with the hopper's clink, bells, and a coin shower into the tray on a
 * jackpot. SOUND is synthesised with Web Audio — no audio files, nothing loaded from anywhere — and only ever starts
 * from a pull or a press; the sound switch (remembered on this device) silences it.
 *
 * MOTION. prefers-reduced-motion gets the same game: the reels click straight to their stops, the lights hold steady,
 * no coin shower. Nothing flashes more than three times a second (WCAG 2.3.1).
 *
 * CSP-safe (addEventListener only, no inline JS). One IIFE, esc() before innerHTML. */
(function () {
  'use strict';

  const root = document.getElementById('slots');
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const cab = $('slot-cab'), win = $('slot-window'), banner = $('slot-banner');
  const spinBtn = $('slot-spin'), lever = $('slot-lever'), soundBtn = $('slot-sound'), resetBtn = $('slot-reset');
  const winEl = $('slot-win'), scoreEl = $('slot-score'), spinsEl = $('slot-spins');
  const liveEl = $('slot-live'), lineEl = $('slot-line'), statsEl = $('slot-stats');
  const paysBody = $('slot-pays'), oddsNote = $('slot-odds-note'), jpPts = $('slot-jp-pts');
  const coinCv = $('slot-coins');
  const reelCvs = [...root.querySelectorAll('.slot-reel')];
  if (!cab || !win || !spinBtn || reelCvs.length !== 3) return;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => !!(window.prefersReduced && window.prefersReduced());
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif';
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const mod = (x) => ((x % N) + N) % N;
  const say = (t) => { if (liveEl) { liveEl.textContent = ''; setTimeout(() => { liveEl.textContent = t; }, 40); } };

  /* ---------- the reels ---------- */
  const SYM = {
    rocket:  { e: '🚀', word: 'rocket' },
    diamond: { e: '💎', word: 'diamond' },
    bell:    { e: '🔔', word: 'bell' },
    grapes:  { e: '🍇', word: 'grapes' },
    orange:  { e: '🍊', word: 'orange' },
    lemon:   { e: '🍋', word: 'lemon' },
    cherry:  { e: '🍒', word: 'cherry' },
  };
  // 20 stops: 🚀 ×2, 💎 ×2, 🔔 ×3, 🍇 ×3, 🍊 ×3, 🍋 ×3, 🍒 ×4. Every reel holds these same stops (so the odds are the same on
  // each); the order is turned differently on each reel so the three never line up alike at rest.
  const STRIP = ['cherry', 'lemon', 'bell', 'orange', 'rocket', 'grapes', 'cherry', 'diamond', 'lemon', 'orange',
                 'bell', 'grapes', 'cherry', 'lemon', 'rocket', 'orange', 'grapes', 'bell', 'cherry', 'diamond'];
  const N = STRIP.length;
  const REELS = [0, 7, 13].map((k) => STRIP.slice(k).concat(STRIP.slice(0, k)));

  /* ---------- the paytable: the first line that matches the payline is the one that pays ---------- */
  const three = (k) => (s) => s[0] === k && s[1] === k && s[2] === k;
  const PAYS = [
    { id: 'jackpot', show: ['rocket', 'rocket', 'rocket'], what: 'Three rockets: the jackpot', pts: 1000, hit: three('rocket'), on: [1, 1, 1] },
    { id: 'diamond', show: ['diamond', 'diamond', 'diamond'], what: 'Three diamonds', pts: 250, hit: three('diamond'), on: [1, 1, 1] },
    { id: 'bell',    show: ['bell', 'bell', 'bell'], what: 'Three bells', pts: 100, hit: three('bell'), on: [1, 1, 1] },
    { id: 'grapes',  show: ['grapes', 'grapes', 'grapes'], what: 'Three grapes', pts: 60, hit: three('grapes'), on: [1, 1, 1] },
    { id: 'orange',  show: ['orange', 'orange', 'orange'], what: 'Three oranges', pts: 40, hit: three('orange'), on: [1, 1, 1] },
    { id: 'lemon',   show: ['lemon', 'lemon', 'lemon'], what: 'Three lemons', pts: 30, hit: three('lemon'), on: [1, 1, 1] },
    { id: 'cherry3', show: ['cherry', 'cherry', 'cherry'], what: 'Three cherries', pts: 25, hit: three('cherry'), on: [1, 1, 1] },
    { id: 'rocket2', show: ['rocket', 'rocket', null], what: 'Any two rockets, on any reels', pts: 10, hit: (s) => s.filter((x) => x === 'rocket').length === 2, on: (s) => s.map((x) => (x === 'rocket' ? 1 : 0)) },
    { id: 'cherry2', show: ['cherry', 'cherry', null], what: 'Cherries on the first two reels', pts: 5, hit: (s) => s[0] === 'cherry' && s[1] === 'cherry', on: [1, 1, 0] },
    { id: 'cherry1', show: ['cherry', null, null], what: 'A cherry on the first reel', pts: 2, hit: (s) => s[0] === 'cherry', on: [1, 0, 0] },
  ];
  const payFor = (s) => PAYS.find((p) => p.hit(s)) || null;
  const litFor = (p, s) => (!p ? [0, 0, 0] : typeof p.on === 'function' ? p.on(s) : p.on);

  // every outcome counted, so the odds printed are the machine's own
  const COUNT = {}; let WINS = 0;
  for (const a of REELS[0]) for (const b of REELS[1]) for (const c of REELS[2]) {
    const p = payFor([a, b, c]);
    if (p) { COUNT[p.id] = (COUNT[p.id] || 0) + 1; WINS++; }
  }
  const ALL = N * N * N;
  const oneIn = (n) => { if (!n) return 'never'; const x = ALL / n; return '1\u00a0in ' + (x >= 10 ? fmt(x) : x.toFixed(1)); };   // a narrow table breaks it before the number, never inside it

  function renderPays() {
    if (jpPts) jpPts.textContent = fmt(PAYS[0].pts);
    if (paysBody) {
      paysBody.innerHTML = PAYS.map((p) => '<tr' + (p.id === 'jackpot' ? ' class="is-jp"' : '') + '><th scope="row"><span class="slot-pt-line">' +
        '<span class="slot-pt-sym" aria-hidden="true">' + p.show.map((k) => '<span class="slot-pt-cell' + (k ? '' : ' is-any') + '">' + (k ? SYM[k].e : '·') + '</span>').join('') + '</span>' +
        '<span class="slot-pt-what">' + esc(p.what) + '</span></span></th>' +
        '<td>' + fmt(p.pts) + '</td><td>' + esc(oneIn(COUNT[p.id])) + '</td></tr>').join('');
    }
    if (oddsNote) {
      const counts = Object.keys(SYM).map((k) => SYM[k].e + '×' + STRIP.filter((x) => x === k).length).join(' · ');
      oddsNote.innerHTML = 'Each reel has the same ' + N + ' stops (<span class="slot-strip">' + esc(counts) + '</span>), and every spin picks a stop on each reel at random, all ' + N + ' equally likely, before the reels move. ' +
        'Only the middle row counts, and a spin pays only its best line (three cherries pay 25, not 25 plus the cherry lines). The odds above are how often each line is the one that pays, counted from those reels over all ' + fmt(ALL) + ' outcomes. About <b>' + esc(oneIn(WINS)) + '</b> spins scores something.';
    }
  }

  /* ---------- this device's scoreboard ---------- */
  const KEY = 'slots:v1', SKEY = 'slots:sound';
  const clampN = (v) => Math.max(0, Math.min(1e12, Math.floor(Number(v) || 0)));
  const st = { spins: 0, score: 0, jackpots: 0, best: 0 };
  // read again before every change, so two open tabs add to one scoreboard instead of overwriting each other's
  const load = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; Object.assign(st, { spins: clampN(j.spins), score: clampN(j.score), jackpots: clampN(j.jackpots), best: clampN(j.best) }); } catch {} };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  load();

  // an LED counter: the lit digits over a row of unlit 8s, the way a seven-segment display shows its dark segments
  function led(el, n, digits) {
    if (!el) return;
    const s = String(clampN(n));
    const g = el.querySelector('.slot-led-ghost'), v = el.querySelector('.slot-led-val');
    if (g) g.textContent = '8'.repeat(Math.max(digits, s.length));
    if (v) v.textContent = s;
  }
  function renderStats() {   // the spins counter and the sentence; the SCORE counter runs on its own while a win counts up
    led(spinsEl, st.spins, 5);
    if (statsEl) statsEl.innerHTML = 'On this device: <b>' + fmt(st.spins) + '</b> ' + (st.spins === 1 ? 'spin' : 'spins') + ', <b>' + fmt(st.score) + '</b> ' + (st.score === 1 ? 'point' : 'points') +
      ', <b>' + fmt(st.jackpots) + '</b> ' + (st.jackpots === 1 ? 'jackpot' : 'jackpots') + (st.best ? ', best line <b>' + fmt(st.best) + '</b>' : '') + '.';
  }

  /* ======================================================================================================
     SOUND — every noise is made here, from oscillators and one buffer of white noise.
     ====================================================================================================== */
  const A = { ctx: null, out: null, noise: null, whir: null, tense: null, on: (() => { try { return localStorage.getItem(SKEY) !== '0'; } catch { return true; } })() };
  const paused = () => !!(window.SFX && SFX.muted());   // the nav's ⏸ pauses every sound on the site, this machine's too
  function audio() {
    if (!A.on || paused() || document.hidden) return null;
    // before the first tap or key the browser keeps audio asleep: a sound queued then would burst out later, out of place
    if (!A.ctx && navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    try {
      if (!A.ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        const ctx = new C();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
        const out = ctx.createGain(); out.gain.value = 1.15;   // measured: a jackpot at about -18 dBFS RMS, peaks held under 0.9 by the compressor
        out.connect(comp); comp.connect(ctx.destination);
        const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        A.ctx = ctx; A.out = out; A.comp = comp; A.noise = buf;
      }
      if (A.ctx.state === 'suspended') A.ctx.resume();
      return A.ctx;
    } catch { return null; }
  }
  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  function tone(t, f, dur, o) {
    o = o || {};
    const c = A.ctx, osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    env(g, t, o.gain || 0.2, o.attack || 0.002, dur);
    osc.connect(g); g.connect(o.dest || A.out);
    osc.start(t); osc.stop(t + (o.attack || 0.002) + dur + 0.05);
  }
  function hiss(t, dur, o) {
    o = o || {};
    const c = A.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = A.noise; s.loop = true;
    f.type = o.type || 'bandpass'; f.frequency.value = o.f || 2000; f.Q.value = o.q || 1;
    env(g, t, o.gain || 0.2, o.attack || 0.001, dur);
    s.connect(f); f.connect(g); g.connect(o.dest || A.out);
    s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.05);
  }
  // an electro-mechanical bell: a struck bar's inharmonic partials, each fading faster than the last, plus the striker's tap
  function bell(t, f, gain, len) {
    [[1, 1], [2.76, 0.5], [5.4, 0.26], [8.93, 0.13]].forEach(([m, a], k) => tone(t, f * m, len / (1 + k * 0.7), { gain: gain * a, attack: 0.0015 }));
    hiss(t, 0.012, { type: 'highpass', f: 6000, gain: gain * 0.5 });
  }
  const SND = {
    press() { // the SPIN button: a plastic click and the switch underneath
      const c = audio(); if (!c) return; const t = c.currentTime;
      hiss(t, 0.02, { type: 'highpass', f: 2600, gain: 0.3 }); tone(t, 150, 0.07, { to: 70, gain: 0.3 }); hiss(t + 0.07, 0.015, { type: 'highpass', f: 3500, gain: 0.15 });
    },
    ratchet() { // one tooth of the lever's ratchet
      const c = audio(); if (!c) return; const t = c.currentTime;
      hiss(t, 0.018, { f: 2300 + Math.random() * 600, q: 5, gain: 0.32 }); tone(t, 900 + Math.random() * 200, 0.012, { type: 'square', gain: 0.025 });
    },
    leverDown() { // the arm bottoms out and trips the mechanism: ka-CHUNK
      const c = audio(); if (!c) return; const t = c.currentTime;
      tone(t, 110, 0.22, { to: 48, gain: 0.7 }); hiss(t, 0.1, { type: 'lowpass', f: 700, gain: 0.5 });
      hiss(t + 0.06, 0.05, { f: 1800, q: 3, gain: 0.18 }); tone(t + 0.06, 2200, 0.03, { type: 'square', gain: 0.03 });
    },
    leverBack() { // the spring takes it back up
      const c = audio(); if (!c) return; const t = c.currentTime;
      tone(t, 300, 0.25, { to: 520, type: 'triangle', gain: 0.05 }); hiss(t + 0.22, 0.03, { f: 1500, q: 4, gain: 0.12 });
    },
    tick() { // a stop passing the payline as a reel slows
      const c = audio(); if (!c) return; const t = c.currentTime;
      hiss(t, 0.01, { type: 'highpass', f: 3200, gain: 0.13 }); tone(t, 1250, 0.012, { type: 'square', gain: 0.02 });
    },
    stop(i) { // a reel locks on its stop: thump, rattle and the detent's click
      const c = audio(); if (!c) return; const t = c.currentTime;
      tone(t, 200 - i * 12, 0.16, { to: 62, gain: 0.6 }); hiss(t, 0.07, { type: 'lowpass', f: 900, gain: 0.4 });
      tone(t + 0.003, 2500 + i * 180, 0.025, { type: 'square', gain: 0.035 }); hiss(t + 0.045, 0.04, { f: 1700, q: 3, gain: 0.09 });
    },
    ding(n, f) { // a small win: the bell, a few strikes
      const c = audio(); if (!c) return; const t = c.currentTime + 0.03;
      for (let i = 0; i < n; i++) bell(t + i * 0.24, f, 0.16, 1.1);
    },
    ring(sec, rate, f) { // a big win: the bell ringing out
      const c = audio(); if (!c) return; const t = c.currentTime + 0.03;
      const n = Math.round(sec * rate);
      for (let i = 0; i < n; i++) bell(t + i / rate, f * (i % 2 ? 1.004 : 1), 0.17 * (1 - (i / n) * 0.45), 0.7);
    },
    fanfare() { // the jackpot: an arpeggio up, held
      const c = audio(); if (!c) return; const t = c.currentTime + 0.05;
      const notes = [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36], [783.99, 0.52], [1046.5, 0.64]];
      notes.forEach(([f, d], k) => {
        const len = k === notes.length - 1 ? 0.9 : 0.14;
        tone(t + d, f, len, { type: 'square', gain: 0.07 }); tone(t + d, f * 2, len, { type: 'triangle', gain: 0.08 });
      });
    },
    nearly() { // two rockets: a rising pair of chimes
      const c = audio(); if (!c) return; const t = c.currentTime + 0.03;
      bell(t, 659.25, 0.14, 0.9); bell(t + 0.16, 880, 0.14, 1.1);
    },
    coin(at) { // one coin into the tray
      const c = audio(); if (!c) return; const t = Math.max(c.currentTime, at || 0);
      const f = 2700 + Math.random() * 1600;
      tone(t, f, 0.09, { gain: 0.09 }); tone(t, f * 1.47, 0.06, { gain: 0.06 }); hiss(t, 0.02, { type: 'highpass', f: 5200, gain: 0.07 });
    },
    hopper(sec, rate) { // the payout: coins clattering out
      const c = audio(); if (!c) return; const t = c.currentTime + 0.1;
      const n = Math.round(sec * rate);
      for (let i = 0; i < n; i++) SND.coin(t + i / rate + Math.random() * (0.6 / rate));
    },
  };
  // the motor and the reels' whirr, quieter as each reel stops
  const WHIR = 0.26;
  function whirStart() {
    whirKill();
    const c = audio(); if (!c) return;
    const t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = A.noise; s.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 540; bp.Q.value = 0.8;
    const trem = c.createGain(); trem.gain.value = 0.6;
    const lfo = c.createOscillator(); lfo.frequency.value = 17;
    const lfoG = c.createGain(); lfoG.gain.value = 0.4;
    const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 58;
    const hl = c.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 220;
    const hg = c.createGain(); hg.gain.value = 0.22;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(WHIR, t + 0.3);
    lfo.connect(lfoG); lfoG.connect(trem.gain);
    s.connect(bp); bp.connect(trem); trem.connect(g);
    hum.connect(hl); hl.connect(hg); hg.connect(g);
    g.connect(A.out);
    s.start(t); lfo.start(t); hum.start(t);
    A.whir = { nodes: [s, lfo, hum], g, n: 3 };
  }
  function whirDown() {
    const w = A.whir; if (!w || !A.ctx) return;
    w.n--;
    const t = A.ctx.currentTime;
    w.g.gain.cancelScheduledValues(t);
    w.g.gain.setTargetAtTime(w.n > 0 ? WHIR * (w.n / 3) : 0.0001, t, 0.06);
    if (w.n <= 0) { A.whir = null; setTimeout(() => w.nodes.forEach((x) => { try { x.stop(); } catch {} }), 500); }
  }
  function whirKill() {
    const w = A.whir; A.whir = null;
    if (w) w.nodes.forEach((x) => { try { x.stop(); } catch {} });
    tenseStop();
  }
  // two rockets up: the third reel's wait gets a rising whine
  function tenseStart() {
    tenseStop();
    const c = audio(); if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(720, t + 2.2);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.3);
    const lfo = c.createOscillator(); lfo.frequency.value = 9; const lg = c.createGain(); lg.gain.value = 0.025;
    lfo.connect(lg); lg.connect(g.gain);
    o.connect(lp); lp.connect(g); g.connect(A.out);
    o.start(t); lfo.start(t);
    A.tense = { nodes: [o, lfo], g };
  }
  function tenseStop() {
    const n = A.tense; A.tense = null;
    if (!n || !A.ctx) return;
    const t = A.ctx.currentTime;
    n.g.gain.cancelScheduledValues(t); n.g.gain.setTargetAtTime(0.0001, t, 0.03);
    setTimeout(() => n.nodes.forEach((x) => { try { x.stop(); } catch {} }), 300);
  }
  // silence NOW: everything already queued (a payout's bells, its coins) is on the old bus, which is cut loose; new sounds get a fresh one
  function cutBus() {
    whirKill();
    if (!A.ctx || !A.out) return;
    try { A.out.disconnect(); } catch {}
    const o = A.ctx.createGain(); o.gain.value = 1.15; o.connect(A.comp); A.out = o;
  }
  function paintSound() {   // one name, "Sound"; aria-pressed says whether it is on (a name that flipped would announce a double negative)
    if (!soundBtn) return;
    soundBtn.setAttribute('aria-pressed', String(A.on));
    soundBtn.innerHTML = '<span aria-hidden="true">' + (A.on ? '🔊' : '🔇') + '</span> Sound';
  }
  function setSound(on) {   // only ever from a press, so the audio context is never made before a gesture
    A.on = on;
    try { localStorage.setItem(SKEY, on ? '1' : '0'); } catch {}
    paintSound();
    if (!on) { cutBus(); if (A.ctx && A.ctx.state === 'running') A.ctx.suspend().catch(() => {}); }
    else if (audio()) SND.press();
  }
  document.addEventListener('visibilitychange', () => {   // a hidden tab is silent, and a payout left half-rung does not replay on return
    if (!A.ctx) return;
    if (document.hidden) { cutBus(); A.ctx.suspend().catch(() => {}); }
    else if (A.on && !paused()) A.ctx.resume().catch(() => {});
  });
  document.addEventListener('jsi:sfx', (e) => {   // paused from the nav: silence what is sounding now
    if (e.detail && e.detail.on === false) { cutBus(); if (A.ctx && A.ctx.state === 'running') A.ctx.suspend().catch(() => {}); }
  });

  /* ======================================================================================================
     THE REELS ON SCREEN — each canvas is one drum seen through the window.
     ====================================================================================================== */
  const ANG = 0.5;          // radians of drum per stop
  const HALF = 0.78;        // the window shows ±HALF radians of the drum: the payline stop, one above, one below, and slivers
  const R = reelCvs.map((cv) => ({ cv, ctx: cv.getContext('2d'), w: 0, h: 0, dpr: 1, shade: null }));
  const G = { rad: 0, sym: 0, spr: {} };
  function sprite(e, px) {
    const size = Math.ceil(px * 1.3), c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    x.font = Math.round(px) + 'px ' + EMOJI_FONT;
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    const m = x.measureText(e);
    // centre the INK, not the advance box: emoji glyphs sit off-centre in their own boxes
    const l = m.actualBoundingBoxLeft || 0, r = m.actualBoundingBoxRight || m.width || px;
    const a = m.actualBoundingBoxAscent || px * 0.8, d = m.actualBoundingBoxDescent || px * 0.2;
    x.fillText(e, size / 2 - (l + r) / 2 + l, size / 2 - (a + d) / 2 + a);
    return c;
  }
  function layout() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let changed = false;
    for (const r of R) {
      const b = r.cv.getBoundingClientRect();
      const w = Math.max(40, Math.round(b.width)), h = Math.max(80, Math.round(b.height));
      if (w !== r.w || h !== r.h || dpr !== r.dpr) {
        r.w = w; r.h = h; r.dpr = dpr; r.cv.width = Math.round(w * dpr); r.cv.height = Math.round(h * dpr); r.shade = null; changed = true;
      }
    }
    if (!changed && G.rad) return;
    const r0 = R[0];
    G.rad = r0.h / 2 / Math.sin(HALF);
    G.sym = Math.min(r0.w * 0.7, G.rad * ANG * 0.82);
    const px = G.sym * dpr;
    G.spr = {};
    for (const k of Object.keys(SYM)) G.spr[k] = sprite(SYM[k].e, px);
    draw(performance.now());
  }
  function shadeFor(r) {
    if (r.shade) return r.shade;
    const c = r.ctx, h = r.h;
    const paper = c.createLinearGradient(0, 0, 0, h);
    paper.addColorStop(0, '#d9ccab'); paper.addColorStop(0.5, '#fff9ea'); paper.addColorStop(1, '#d4c6a2');
    const drum = c.createLinearGradient(0, 0, 0, h);   // the curve of the drum: dark where it turns away
    drum.addColorStop(0, 'rgba(20,12,4,0.78)'); drum.addColorStop(0.2, 'rgba(20,12,4,0.22)'); drum.addColorStop(0.42, 'rgba(20,12,4,0)');
    drum.addColorStop(0.58, 'rgba(20,12,4,0)'); drum.addColorStop(0.8, 'rgba(20,12,4,0.26)'); drum.addColorStop(1, 'rgba(20,12,4,0.82)');
    const glare = c.createLinearGradient(0, 0, 0, h);  // the glass in front catches the light
    glare.addColorStop(0, 'rgba(255,255,255,0)'); glare.addColorStop(0.16, 'rgba(255,255,255,0.22)'); glare.addColorStop(0.27, 'rgba(255,255,255,0)'); glare.addColorStop(1, 'rgba(255,255,255,0)');
    r.shade = { paper, drum, glare };
    return r.shade;
  }
  function drawReel(i, pos, vel, glow) {
    const r = R[i], c = r.ctx, w = r.w, h = r.h;
    if (!w || !G.rad) return;
    const sh = shadeFor(r), cy = h / 2, rad = G.rad;
    c.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = sh.paper; c.fillRect(0, 0, w, h);
    if (glow > 0) { // a winning stop glows on the payline
      const gr = c.createRadialGradient(w / 2, cy, 2, w / 2, cy, Math.max(w, G.sym) * 0.7);
      gr.addColorStop(0, 'rgba(255,214,70,' + (0.75 * glow).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(255,214,70,0)');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
    }
    // motion blur: at speed, each stop is drawn several times along its path
    const travel = Math.abs(vel) * ANG / 60;                     // radians crossed in one frame
    const k = travel * rad < 2.5 ? 1 : Math.min(8, Math.ceil(travel * rad / 3));
    const base = Math.floor(pos), sz = G.sym, box = sz * 1.3;
    for (let d = -3; d <= 3; d++) {
      const idx = base + d, th = (idx - pos) * ANG;
      if (Math.abs(th) > HALF + ANG) continue;
      const spr = G.spr[REELS[i][mod(idx)]];
      if (!spr) continue;
      for (let j = 0; j < k; j++) {
        const tj = th + (k > 1 ? (j / (k - 1) - 0.5) * travel * 1.4 : 0);
        if (Math.abs(tj) >= 1.45) continue;
        const y = cy - rad * Math.sin(tj), sc = Math.cos(tj);
        c.globalAlpha = k > 1 ? Math.min(1, 1.9 / k) : 1;
        c.drawImage(spr, w / 2 - box / 2, y - (box * sc) / 2, box, box * sc);
      }
    }
    c.globalAlpha = 1;
    c.fillStyle = sh.drum; c.fillRect(0, 0, w, h);
    c.fillStyle = sh.glare; c.fillRect(0, 0, w, h);
  }

  /* ======================================================================================================
     MOTION — each reel's position over time, worked out whole when the spin starts.
     ====================================================================================================== */
  const T_KICK = 110, T_ACC = 300, T_BRAKE = 560, T_SETTLE = 200, KICK = 0.2, OVER = 0.13, V_MIN = 18;
  /* kick back → accelerate → run → brake (cubic ease-out) → overshoot the stop and settle back onto it.
     The run's speed is chosen (≥ V_MIN stops a second) so the brake ends exactly OVER past the picked stop: no jump,
     no slide, the reel simply arrives where the random pick said. */
  function motion(p0, stop, t0, tBrake) {
    const ta = t0 + T_KICK, tc = ta + T_ACC, tb = tBrake, te = tb + T_BRAKE, ts = te + T_SETTLE;
    const run = (tb - tc) / 1000;
    const K = T_ACC / 2000 + run + T_BRAKE / 3000;
    const pK = p0 - KICK;
    let need = mod(stop + OVER - pK);
    let v = need / K;
    while (v < V_MIN) { need += N; v = need / K; }
    const pC = pK + (v * T_ACC) / 2000, pB = pC + v * run, pF = pB + (v * T_BRAKE) / 3000;
    const acc = v / (T_ACC / 1000);
    return {
      brakeAt: tb, clunkAt: te, end: ts, final: stop,
      pos(t) {
        if (t < t0) return p0;
        if (t < ta) { const u = (t - t0) / T_KICK; return p0 - KICK * (1 - (1 - u) * (1 - u)); }
        if (t < tc) { const s = (t - ta) / 1000; return pK + 0.5 * acc * s * s; }
        if (t < tb) return pC + (v * (t - tc)) / 1000;
        if (t < te) { const u = (t - tb) / T_BRAKE; return pB + (pF - pB) * (1 - Math.pow(1 - u, 3)); }
        if (t < ts) { const u = (t - te) / T_SETTLE; return pF - OVER * (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2); }
        return pF - OVER;
      },
      vel(t) {
        if (t < ta || t >= ts) return 0;
        if (t < tc) return acc * ((t - ta) / 1000);
        if (t < tb) return v;
        if (t < te) { const u = (t - tb) / T_BRAKE; return v * (1 - u) * (1 - u); }
        return 0;
      },
    };
  }

  /* ======================================================================================================
     THE GAME
     ====================================================================================================== */
  const rnd = (n) => { // uniform 0..n-1, no modulo bias
    const a = new Uint32Array(1), lim = Math.floor(0x100000000 / n) * n;
    let x;
    do { crypto.getRandomValues(a); x = a[0]; } while (x >= lim);
    return x % n;
  };
  const S = {
    busy: false, pos: [rnd(N), rnd(N), rnd(N)], vel: [0, 0, 0], cell: [0, 0, 0],
    run: null,            // { motions, line, pay, tense, stopped[] } while the reels turn
    lit: [0, 0, 0], glowFrom: 0, glowUntil: 0,
    count: null,          // the payout being counted up
    raf: 0,
  };

  function setBusy(on) {
    S.busy = on;
    spinBtn.setAttribute('aria-disabled', String(on));
    if (lever) lever.setAttribute('aria-disabled', String(on));
    cab.classList.toggle('is-spinning', on);
  }
  function clearCelebration() {
    cab.classList.remove('is-win', 'is-bigwin', 'is-jackpot');
    win.classList.remove('is-tense');
    if (banner) { banner.hidden = true; banner.innerHTML = ''; }
    S.lit = [0, 0, 0]; S.glowUntil = 0;
  }

  function spin(byLever) {
    if (S.busy) return;
    if (S.count) finishCount();          // pressing during a payout pays it out at once, as a real machine's button does
    clearCelebration();
    const stops = [rnd(N), rnd(N), rnd(N)];
    const line = stops.map((k, i) => REELS[i][k]);
    const pay = payFor(line);
    const tense = line[0] === 'rocket' && line[1] === 'rocket';
    load(); st.spins++; save(); renderStats();
    led(winEl, 0, 4);
    if (!byLever) SND.press();
    setBusy(true);
    if (reduced()) { quickSpin(stops, line, pay); return; }
    whirStart();
    const t0 = performance.now() + 40;
    S.run = {
      line, pay, tense, stopped: [false, false, false],
      motions: [0, 1, 2].map((i) => motion(S.pos[i], stops[i], t0 + i * 110, t0 + 1150 + i * 520 + (i === 2 && tense ? 1700 : 0))),
    };
    S.cell = S.pos.map((p) => Math.floor(p));
    kick();
  }
  // reduced motion: no turning reels — each clicks to its stop, left to right, with the same sounds
  function quickSpin(stops, line, pay) {
    S.run = { line, pay, tense: false, stopped: [false, false, false], motions: null };
    [0, 1, 2].forEach((i) => setTimeout(() => {
      S.pos[i] = stops[i]; SND.stop(i); draw(performance.now());
      if (i === 2) settle();
    }, 240 + i * 280));
  }

  function kick() { if (!S.raf) S.raf = requestAnimationFrame(frame); }
  const still = () => reduced() || document.documentElement.classList.contains('motion-off');   // lights hold steady
  function frame(now) {
    S.raf = 0;
    let moving = false;
    const run = S.run;
    if (run && run.motions) {
      run.motions.forEach((m, i) => {
        S.pos[i] = m.pos(now); S.vel[i] = m.vel(now);
        const cell = Math.floor(S.pos[i] + 0.5);
        if (cell !== S.cell[i] && now >= m.brakeAt && now < m.clunkAt && S.vel[i] < 15) SND.tick();   // slow enough to hear each stop go by
        S.cell[i] = cell;
        if (!run.stopped[i] && now >= m.clunkAt) {
          run.stopped[i] = true; SND.stop(i); whirDown();
          if (i === 1 && run.tense) { win.classList.add('is-tense'); tenseStart(); }
          if (i === 2) { win.classList.remove('is-tense'); tenseStop(); }
        }
        if (now < m.end) moving = true;
      });
      if (!moving) { S.pos = run.motions.map((m) => m.final); S.vel = [0, 0, 0]; run.motions = null; settle(); }
    }
    draw(now);
    if (moving || (now < S.glowUntil && !still()) || coins.live) kick();   // kick(): never a second loop beside the one settle() started
  }
  function draw(now) {
    const glowing = now < S.glowUntil;
    // a slow swell, never a flash
    const g = glowing ? (still() ? 1 : 0.55 + 0.45 * Math.sin(((now - S.glowFrom) / 1000) * Math.PI * 1.6)) : 0;
    for (let i = 0; i < 3; i++) drawReel(i, S.pos[i], S.vel[i], S.lit[i] ? Math.max(0.15, g) : 0);
    if (coins.live) drawCoins(now);
  }

  function settle() {
    const run = S.run; S.run = null;
    whirKill();
    setBusy(false);
    win.classList.remove('is-tense');
    const { line, pay } = run;
    const words = line.map((k) => SYM[k].word);
    if (lineEl) lineEl.textContent = 'On the payline: ' + words.join(', ') + '.';
    const said = words.join(', ');
    if (!pay) { say(said.charAt(0).toUpperCase() + said.slice(1) + '. No win this time.'); draw(performance.now()); return; }
    load();
    const before = st.score;
    st.score = clampN(st.score + pay.pts); st.best = Math.max(st.best, pay.pts);
    if (pay.id === 'jackpot') st.jackpots++;
    save(); renderStats();
    const tier = pay.id === 'jackpot' ? 'jackpot' : pay.pts >= 25 ? 'big' : 'small';
    S.lit = litFor(pay, line);
    S.glowFrom = performance.now();
    S.glowUntil = S.glowFrom + (tier === 'jackpot' ? 7000 : tier === 'big' ? 3600 : 1800);
    cab.classList.add(tier === 'jackpot' ? 'is-jackpot' : tier === 'big' ? 'is-bigwin' : 'is-win');
    if (banner && tier !== 'small') {
      banner.innerHTML = '<span>' + (tier === 'jackpot' ? 'JACKPOT!' : pay.pts >= 100 ? 'BIG WIN!' : 'WINNER!') + '<small>+' + esc(fmt(pay.pts)) + '</small></span>';
      banner.hidden = false;
    }
    if (tier === 'jackpot') { SND.ring(3.2, 13, 1046.5); SND.fanfare(); SND.hopper(3.6, 16); shower(70, 2600); }
    else if (tier === 'big') { SND.ring(pay.pts >= 100 ? 1.8 : 1.1, 9, 880); if (pay.pts >= 100) shower(18, 900); }
    else if (pay.id === 'rocket2') SND.nearly();
    else SND.ding(pay.pts >= 5 ? 2 : 1, 987.77);
    countUp(before, pay.pts, tier);
    if (still()) setTimeout(() => draw(performance.now()), S.glowUntil - performance.now() + 30);   // the steady glow goes when its time is up
    say(said.charAt(0).toUpperCase() + said.slice(1) + ' — ' + (tier === 'jackpot' ? 'JACKPOT! ' : '') + pay.what.replace(/: the jackpot$/, '') + ', ' + fmt(pay.pts) + (pay.pts === 1 ? ' point.' : ' points.'));
    kick();
  }

  // the WIN counter runs up the way a hopper pays: a clink a step
  function countUp(before, pts, tier) {
    const steps = Math.min(pts, tier === 'jackpot' ? 64 : 40);
    const ms = tier === 'jackpot' ? 4200 : Math.min(2600, 420 + steps * 70);
    const per = ms / steps;
    let i = 0;
    const tickOnce = () => {
      i++;
      const shown = i >= steps ? pts : Math.round((pts * i) / steps);
      led(winEl, shown, 4); led(scoreEl, before + shown, 6);
      if (tier !== 'jackpot') SND.coin();
      if (i >= steps) { finishCount(); return; }
      S.count.timer = setTimeout(tickOnce, per);
    };
    S.count = { pts, before, timer: setTimeout(tickOnce, tier === 'jackpot' ? 500 : 250) };
  }
  function finishCount() {
    const c = S.count; if (!c) return;
    clearTimeout(c.timer); S.count = null;
    led(winEl, c.pts, 4); led(scoreEl, st.score, 6);
  }

  /* ---------- the lever: tap it, press Enter on it, or drag the ball down ---------- */
  const LV = { a: 0, max: 100, anim: 0, drag: null, noClick: false, teeth: 0 };   // 100°: pulled toward you and down a little, never swung over the counters
  function setLever(a) {
    LV.a = a;
    lever.style.setProperty('--pull', (-a).toFixed(1) + 'deg');
    const tooth = Math.floor(a / 22);
    if (tooth > LV.teeth) SND.ratchet();
    LV.teeth = tooth;
  }
  function animLever(from, to, ms, ease, done) {
    cancelAnimationFrame(LV.anim);
    const t0 = performance.now();
    const step = (now) => {
      const u = Math.min(1, (now - t0) / ms);
      if (to > from && S.busy) { LV.anim = 0; leverReturn(); return; }   // the reels started meanwhile: the lever is locked
      setLever(from + (to - from) * ease(u));
      if (u < 1) LV.anim = requestAnimationFrame(step); else { LV.anim = 0; if (done) done(); }
    };
    LV.anim = requestAnimationFrame(step);
  }
  function leverReturn() {
    LV.teeth = 0;
    const from = LV.a, t0 = performance.now();
    SND.leverBack();
    cancelAnimationFrame(LV.anim);
    const step = (now) => { // a damped spring, with a little bounce above rest
      const s = (now - t0) / 1000;
      const a = from * Math.exp(-6.5 * s) * Math.cos(9.5 * s);
      lever.style.setProperty('--pull', (-Math.max(-7, a)).toFixed(1) + 'deg'); LV.a = Math.max(0, a);
      if (s < 0.75) LV.anim = requestAnimationFrame(step); else { LV.anim = 0; lever.style.setProperty('--pull', '0deg'); LV.a = 0; }
    };
    LV.anim = requestAnimationFrame(step);
  }
  function leverTrip() {
    if (S.busy) { SND.ratchet(); leverReturn(); return; }   // locked while the reels turn: one tooth, and back
    SND.leverDown(); spin(true); setTimeout(leverReturn, 90);
  }
  function pullLever() {
    if (S.busy) { SND.ratchet(); return; }      // the lever is locked while the reels turn: one tooth and no further
    if (reduced()) { SND.ratchet(); SND.leverDown(); spin(true); return; }
    LV.teeth = 0;
    animLever(LV.a, LV.max, 260, (u) => u * u, leverTrip);
  }
  if (lever) {
    lever.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || S.busy || reduced()) return;
      e.preventDefault();
      try { lever.setPointerCapture(e.pointerId); } catch {}
      cancelAnimationFrame(LV.anim); LV.anim = 0;
      const len = lever.getBoundingClientRect().height * 0.55;
      LV.drag = { y: e.clientY, at: performance.now(), len, moved: false, tripped: false };
      LV.teeth = Math.floor(LV.a / 22);
    });
    lever.addEventListener('pointermove', (e) => {
      const d = LV.drag; if (!d || d.tripped) return;
      if (S.busy) { d.tripped = true; leverReturn(); return; }
      const dy = e.clientY - d.y;
      if (Math.abs(dy) > 6) d.moved = true;
      // the ball under the finger: an arm of length L tipped by a shows its ball L(1 - cos a) lower
      const a = Math.max(0, Math.min(LV.max, Math.acos(Math.max(-1, Math.min(1, 1 - dy / d.len))) * 180 / Math.PI));
      setLever(a);
      if (a >= LV.max * 0.94) { d.tripped = true; leverTrip(); }
    });
    const end = (e) => {
      const d = LV.drag; if (!d) return;
      audio();   // pointerup is the browser's activation moment: wake the sound here, so the pull's ka-chunk is heard
      LV.drag = null; LV.noClick = true; setTimeout(() => { LV.noClick = false; }, 400);
      try { lever.releasePointerCapture(e.pointerId); } catch {}
      if (d.tripped) return;
      if (!d.moved) { pullLever(); return; }            // a tap pulls it all the way
      if (LV.a > LV.max * 0.55) animLever(LV.a, LV.max, 120, (u) => u, leverTrip);   // let go past half way: it carries on down
      else leverReturn();
    };
    lever.addEventListener('pointerup', end);
    lever.addEventListener('pointercancel', end);
    lever.addEventListener('click', (e) => { if (LV.noClick) { e.preventDefault(); return; } pullLever(); });   // keyboard: Enter / Space
  }
  spinBtn.addEventListener('click', () => {
    if (S.busy) return;
    spinBtn.classList.add('is-pressed'); setTimeout(() => spinBtn.classList.remove('is-pressed'), 140);
    spin(false);
  });
  if (soundBtn) soundBtn.addEventListener('click', () => setSound(!A.on));
  if (resetBtn) {
    let armed = 0;
    resetBtn.addEventListener('click', () => {
      if (S.busy) { say('Wait for the reels to stop, then reset.'); return; }
      if (!armed) {
        armed = setTimeout(() => { armed = 0; resetBtn.textContent = 'Reset my score'; }, 4000);
        resetBtn.textContent = 'Tap again to reset';
        say('Press Reset again within 4 seconds to set this device\u2019s score to zero.');
        return;
      }
      clearTimeout(armed); armed = 0;
      finishCount(); clearCelebration();
      if (coins.live) { coins.live = false; if (coins.ctx) coins.ctx.clearRect(0, 0, coinCv.width, coinCv.height); }
      st.spins = 0; st.score = 0; st.jackpots = 0; st.best = 0; save();
      resetBtn.textContent = 'Reset my score';
      led(winEl, 0, 4); led(scoreEl, 0, 6); renderStats(); draw(performance.now());
      say('Score reset to zero on this device.');
    });
  }

  /* ---------- the coin shower: a jackpot pays out into the tray ---------- */
  const coins = { live: false, list: [], ctx: coinCv ? coinCv.getContext('2d') : null, w: 0, h: 0, dpr: 1, last: 0, until: 0, spawn: 0, from: 0, spawnMs: 0 };
  function shower(n, ms) {
    if (!coins.ctx || reduced() || window.__confettiEnabled === false || document.documentElement.classList.contains('motion-off')) return;
    const b = cab.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    coins.w = b.width; coins.h = b.height; coins.dpr = dpr;
    coinCv.width = Math.round(b.width * dpr); coinCv.height = Math.round(b.height * dpr);
    coins.list = []; coins.spawn = n; coins.from = performance.now(); coins.spawnMs = ms; coins.last = coins.from;
    coins.until = coins.from + ms + 3200; coins.live = true;
    kick();
  }
  function drawCoins(now) {
    const c = coins.ctx, W = coins.w, H = coins.h;
    const dt = Math.min(0.05, (now - coins.last) / 1000); coins.last = now;
    const wb = win.getBoundingClientRect(), cb = cab.getBoundingClientRect();
    const mouthX = wb.left - cb.left + wb.width / 2, mouthY = wb.bottom - cb.top;
    const floor = H - 14;
    // let the coins out of the chute over the spawn window
    const due = Math.min(coins.spawn, Math.ceil(((now - coins.from) / coins.spawnMs) * coins.spawn));
    while (coins.list.length < due) {
      const r = 7 + Math.random() * 5;
      coins.list.push({ x: mouthX + (Math.random() - 0.5) * wb.width * 0.5, y: mouthY - 10, vx: (Math.random() - 0.5) * 260, vy: -120 - Math.random() * 260, r, ph: Math.random() * 6, spin: 3 + Math.random() * 6, rest: false });
    }
    c.setTransform(coins.dpr, 0, 0, coins.dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const fade = Math.max(0, Math.min(1, (coins.until - now) / 900));
    for (const k of coins.list) {
      if (!k.rest) {
        k.vy += 1500 * dt; k.x += k.vx * dt; k.y += k.vy * dt; k.ph += k.spin * dt;
        if (k.x < k.r) { k.x = k.r; k.vx *= -0.5; } else if (k.x > W - k.r) { k.x = W - k.r; k.vx *= -0.5; }
        if (k.y > floor - k.r) {
          k.y = floor - k.r; k.vy *= -0.32; k.vx *= 0.55; k.spin *= 0.5;
          if (Math.abs(k.vy) < 60) { k.rest = true; k.ph = Math.round(k.ph / Math.PI) * Math.PI; }
        }
      }
      const sx = Math.max(0.18, Math.abs(Math.cos(k.ph)));
      c.globalAlpha = fade;
      c.beginPath(); c.ellipse(k.x, k.y, k.r * sx, k.r, 0, 0, Math.PI * 2);
      const g = c.createLinearGradient(k.x - k.r, k.y - k.r, k.x + k.r, k.y + k.r);
      g.addColorStop(0, '#fff2b0'); g.addColorStop(0.45, '#f2b632'); g.addColorStop(1, '#9a6510');
      c.fillStyle = g; c.fill();
      c.lineWidth = 1.2; c.strokeStyle = 'rgba(90,55,5,0.9)'; c.stroke();
      if (sx > 0.5) { c.beginPath(); c.ellipse(k.x, k.y, k.r * sx * 0.6, k.r * 0.6, 0, 0, Math.PI * 2); c.strokeStyle = 'rgba(255,240,190,0.7)'; c.lineWidth = 1; c.stroke(); }
    }
    c.globalAlpha = 1;
    if (now >= coins.until) { coins.live = false; c.clearRect(0, 0, W, H); }
  }

  window.addEventListener('storage', (e) => { if (e.key === KEY && !S.count) { load(); renderStats(); led(scoreEl, st.score, 6); } });

  /* ---------- start ---------- */
  renderPays();
  renderStats();
  led(winEl, 0, 4); led(scoreEl, st.score, 6);
  paintSound();
  layout();
  if ('ResizeObserver' in window) new ResizeObserver(() => layout()).observe(win);
  else window.addEventListener('resize', layout);
  // the emoji font can land after the first paint; redraw the stops with it
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { G.rad = 0; for (const r of R) r.w = 0; layout(); });
})();
