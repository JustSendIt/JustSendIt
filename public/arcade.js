/* ===== arcade.js — the Arcade page: "Rocket Run", one free flight per UTC day for a Send Power boost =====
 *
 * HONEST BY CONSTRUCTION. This is a free daily bonus game: nothing is at stake, nothing is purchasable and no
 * money is involved. The only thing a flight can produce is a temporary Send Power boost.
 *
 * THE SERVER IS THE AUTHORITY. The crash point is rolled server-side at /api/arcade/start and is NEVER sent to
 * the browser until the round resolves — this file cannot know it, does not guess it and never fakes it. All we
 * do is animate multiplier(t) = e^(growth · seconds) from the server's own startedAt, using a clock offset
 * derived from its serverNow so our display runs a hair BEHIND the server rather than ahead of it. The outcome
 * is whatever /api/arcade/cashout says it is.
 *
 * CSP-safe (addEventListener only, no inline JS, no eval). House style: one IIFE, esc() before innerHTML.
 * prefers-reduced-motion gets a genuinely playable path: no canvas, no rAF — a 4 Hz numeric readout and a
 * static rocket, with every control, announcement and state identical. */
(function () {
  'use strict';

  const stage = document.getElementById('arc-stage');
  if (!stage) return;

  const canvas    = document.getElementById('arc-canvas');
  const staticEl  = document.getElementById('arc-static');
  const staticIco = document.getElementById('arc-static-ico');
  const xEl       = document.getElementById('arc-x');
  const subEl     = document.getElementById('arc-sub');
  const btn       = document.getElementById('arc-btn');
  const hintEl    = document.getElementById('arc-hint');
  const panel     = document.getElementById('arc-panel');
  const badges    = document.getElementById('arc-badges');
  const liveEl    = document.getElementById('arc-live');
  const curveBody = document.getElementById('arc-curve-body');
  const curveNote = document.getElementById('arc-curve-note');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => !!(window.prefersReduced && window.prefersReduced());
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif';

  /* ---------- the rules, mirrored exactly from the server ----------
     server: arcadeX(ms)        = e^(ARCADE_GROWTH · seconds)
     server: arcadeBoostFor(x)  = min(ARCADE_BOOST_MAX, max(1, 1 + (x − 1) / 4))
     growth / maxBoost / maxX all arrive from /api/arcade/state (and /start); the defaults below only cover the
     moment before that lands (and the signed-out reader, who never gets a state call). */
  const BOOST_DIV = 4;
  const S = {
    mode: 'loading',        // loading | signedout | ready | resume | flying | cashed | busted | done | expired | error
    boost: 1, until: null, playedToday: false, last: null,
    growth: 0.06, maxBoost: 5, maxX: 50,
    round: null,            // { id, startedAt, offset }  offset = serverClock − localClock
    freeze: null,           // frozen view for the resolved-round drawing
    outcome: null,
    busy: false, netErr: '', err: '',
  };

  const mulAt   = (sec) => Math.exp(S.growth * Math.max(0, sec));
  const secFor  = (x)   => Math.log(Math.max(1, x)) / S.growth;
  const boostFor = (x)  => Math.min(S.maxBoost, Math.max(1, 1 + (x - 1) / BOOST_DIV));
  const fx = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

  // elapsed is measured on the SERVER's clock. offset is computed from a serverNow captured before the response
  // travelled to us, so our estimate is behind the truth by one network hop — the safe direction: the display can
  // never claim a multiplier the server hasn't reached.
  function elapsedSec() { return S.round ? Math.max(0, (Date.now() + S.round.offset - S.round.startedAt)) / 1000 : 0; }
  function curX() { return Math.min(S.maxX, mulAt(elapsedSec())); }

  /* ---------- time formatting ---------- */
  function dur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + String(sec).padStart(2, '0') + 's';
    return sec + 's';
  }
  function durWords(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + (h === 1 ? ' hour' : ' hours') + (m ? ' ' + m + (m === 1 ? ' minute' : ' minutes') : '');
    if (m > 0) return m + (m === 1 ? ' minute' : ' minutes');
    return s + ' seconds';
  }
  function nextReset() { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); }
  function todayStart() { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }

  // one shared 1 s ticker repaints every [data-arc-until] countdown in place (plain text, never a live region).
  // A countdown that reaches zero must actually RESOLVE: "next flight in a moment" that sits there forever until
  // someone reloads is a lie. When one crosses zero we re-ask the server once (day rolled over → the button comes
  // back; boost expired → the badge drops), throttled so a tab left open overnight can't turn into a poll loop.
  let zeroRefresh = 0;
  function paintCounts() {
    const els = document.querySelectorAll('[data-arc-until]');
    let expired = false;
    for (let i = 0; i < els.length; i++) {
      const el = els[i], t = Number(el.getAttribute('data-arc-until')) || 0, left = t - Date.now();
      el.textContent = left > 0 ? dur(left) : (el.getAttribute('data-arc-zero') || 'any moment now');
      if (t > 0 && left <= 0) expired = true;
    }
    if (!expired || S.mode === 'flying' || S.busy) return;
    const t = Date.now();
    if (t - zeroRefresh < 30000) return;
    zeroRefresh = t;
    if (window.AUTH && AUTH.user) loadState();
  }
  setInterval(paintCounts, 1000);

  /* ---------- sparse polite announcements (milestones, then the outcome) ---------- */
  let sayTimer = 0;
  function say(text) {
    if (!liveEl) return;
    clearTimeout(sayTimer);
    liveEl.textContent = '';
    sayTimer = setTimeout(function () { liveEl.textContent = String(text || ''); }, 40); // clear→set so a repeat re-announces
  }
  const MILES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50];
  let mile = 0, lastAnnounce = 0;
  function resetMilestones() {
    mile = 0; lastAnnounce = 0;
    const x = curX();
    while (mile < MILES.length && x >= MILES[mile]) mile++;   // a resumed flight doesn't replay what it already passed
  }
  function milestones(x) {
    let hit = null;
    while (mile < MILES.length && x >= MILES[mile]) { hit = MILES[mile]; mile++; }
    if (hit == null) return;
    const t = Date.now();
    if (t - lastAnnounce < 1100) return;                      // never chatter, even when whole numbers arrive fast
    lastAnnounce = t;
    say(hit + ' times. Cash out now for a ' + fx(boostFor(hit)) + ' times Send Power boost.');
  }

  /* ================= canvas ================= */
  const ctx = (canvas && canvas.getContext) ? canvas.getContext('2d') : null;
  const PAD = { l: 8, r: 32, t: 26, b: 22 };
  let W = 0, H = 0, dpr = 1, running = false, rafId = 0, intervalId = 0, boom = null, autoCashed = false;

  const stars = [];
  for (let i = 0; i < 48; i++) stars.push({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.4, tw: Math.random() * Math.PI * 2 });

  function fit() {
    if (!ctx) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    W = Math.max(200, Math.round(r.width)); H = Math.max(140, Math.round(r.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log(Math.max(1e-6, raw)) / Math.LN10)), n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }
  function axesFor(elSec, curMul) {
    return { tMax: Math.max(4, elSec * 1.14), yMax: Math.max(1.5, curMul * 1.16) };
  }
  function mapFor(a) {
    const x0 = PAD.l, x1 = W - PAD.r, y0 = H - PAD.b, y1 = PAD.t;
    return {
      px: (s) => x0 + Math.min(1, s / a.tMax) * (x1 - x0),
      py: (m) => y0 - ((Math.min(m, a.yMax) - 1) / (a.yMax - 1)) * (y0 - y1),
    };
  }
  function hueFor(x) { return x >= 10 ? '#ff8f4d' : x >= 3 ? '#ffb340' : '#b4ff2b'; }

  function drawStars(t, speed) {
    const drift = (t / 1000) * (10 + speed * 300);
    ctx.save();
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      let x = (s.x * W - drift) % W; if (x < 0) x += W;
      const y = s.y * H;
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(t / 720 + s.tw);
      ctx.fillStyle = '#cfe6ff';
      if (speed > 0.22) ctx.fillRect(x, y, s.r + speed * 30, Math.max(0.7, s.r * 0.6));
      else ctx.fillRect(x, y, s.r, s.r);
    }
    ctx.restore();
  }

  function drawGrid(m, a) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = '600 10px Rubik, system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const step = niceStep((a.yMax - 1) / 3);
    for (let v = 1; v < a.yMax; v += step) {
      const y = Math.round(m.py(v)) + 0.5;
      ctx.strokeStyle = v === 1 ? 'rgba(159,176,204,0.34)' : 'rgba(159,176,204,0.13)';
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r + 2, y); ctx.stroke();
      ctx.fillStyle = 'rgba(159,176,204,0.75)';
      ctx.fillText((v < 10 ? v.toFixed(1) : Math.round(v)) + '×', W - PAD.r + 5, y);
    }
    ctx.restore();
  }

  function curvePath(m, toSec) {
    const N = 84;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const s = (toSec * i) / N, px = m.px(s), py = m.py(mulAt(s));
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
  }

  function drawTrail(m, endSec, color) {
    curvePath(m, endSec);
    ctx.lineTo(m.px(endSec), H - PAD.b);
    ctx.lineTo(m.px(0), H - PAD.b);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b);
    g.addColorStop(0, 'rgba(142,224,0,0.30)');
    g.addColorStop(1, 'rgba(142,224,0,0.015)');
    ctx.fillStyle = g; ctx.fill();

    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    curvePath(m, endSec); ctx.stroke();
    ctx.restore();
  }

  function tangentAngle(m, sec, a) {
    const dx = (W - PAD.r - PAD.l) / a.tMax;
    const dy = -(S.growth * mulAt(sec)) / (a.yMax - 1) * (H - PAD.b - PAD.t);
    return Math.atan2(dy, dx);
  }
  function drawGlyph(x, y, glyph, size, rot) {
    ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot);
    ctx.font = size + 'px ' + EMOJI_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(glyph, 0, 0); ctx.restore();
  }
  function drawRocket(m, sec, a, t, speed) {
    const x = m.px(sec), y = m.py(mulAt(sec)), ang = tangentAngle(m, sec, a);
    ctx.save();                                                   // exhaust plume, trailing back down the curve
    for (let i = 1; i <= 4; i++) {
      const bx = x - Math.cos(ang) * i * 6, by = y - Math.sin(ang) * i * 6;
      ctx.globalAlpha = 0.34 / i;
      ctx.fillStyle = i > 2 ? '#ffb340' : '#ffe08a';
      ctx.beginPath(); ctx.arc(bx, by, (6 - i) * (0.9 + speed * 0.7), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    drawGlyph(x, y, '🚀', 26, ang + Math.PI / 4);        // 🚀 points up-right, so +45° aligns it to the tangent
  }

  function spawnBoom(x, y) {
    const parts = [];
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.1 + Math.random() * 4.6;
      parts.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.1,
        life: 1, dec: 0.011 + Math.random() * 0.021, r: 1.4 + Math.random() * 3.6,
        c: ['#ff5d5d', '#ffb340', '#ffe08a', '#ffffff'][(Math.random() * 4) | 0],
      });
    }
    boom = { x: x, y: y, parts: parts, t0: (window.performance && performance.now()) || Date.now(), rk: { x: x, y: y, vx: 0.7, vy: -1.6, rot: 0 } };
  }
  function stepBoom() {
    if (!boom) return false;
    let alive = false;
    for (let i = 0; i < boom.parts.length; i++) {
      const p = boom.parts[i];
      if (p.life <= 0) continue;
      p.x += p.vx; p.y += p.vy; p.vy += 0.16; p.vx *= 0.985; p.life -= p.dec;
      if (p.life > 0) alive = true;
      ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    const rk = boom.rk;                                            // the rocket tumbles out of the sky
    rk.x += rk.vx; rk.y += rk.vy; rk.vy += 0.34; rk.rot += 0.17;
    if (rk.y < H + 50) { drawGlyph(rk.x, rk.y, '🚀', 22, rk.rot); alive = true; }
    return alive;
  }

  // returns true while the canvas still needs more frames
  function drawFrame(t) {
    if (!ctx || canvas.hidden) return false;
    if (!W) fit();
    if (!W) return false;
    const f = S.freeze;
    const el = f ? f.viewSec : elapsedSec();
    const cur = f ? f.viewX : (S.round ? curX() : 1);
    const a = axesFor(el, cur), m = mapFor(a);
    const speed = Math.min(1, Math.log(Math.max(1, cur)) / Math.log(14));
    const flying = S.mode === 'flying';

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#070a10'; ctx.fillRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(23,36,64,0.9)'); bg.addColorStop(1, 'rgba(7,10,16,0)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    ctx.save();
    const shake = (flying ? speed * 6 : 0) + (boom ? Math.max(0, 9 - (t - boom.t0) / 45) : 0);
    if (shake > 0.15) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    drawStars(t, flying ? speed : 0.04);
    drawGrid(m, a);

    if (S.round || f) {
      const endSec = f ? f.endSec : el;
      drawTrail(m, endSec, hueFor(cur));
      if (f && f.crashSec > f.endSec) {                            // the reveal: where it WOULD have blown
        ctx.save();
        ctx.setLineDash([5, 6]); ctx.strokeStyle = 'rgba(255,93,93,0.75)'; ctx.lineWidth = 2;
        ctx.beginPath();
        const N = 30;
        for (let i = 0; i <= N; i++) {
          const s = f.endSec + ((f.crashSec - f.endSec) * i) / N, px = m.px(s), py = m.py(mulAt(s));
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.stroke(); ctx.restore();
        drawGlyph(m.px(f.crashSec), m.py(mulAt(f.crashSec)), '💥', 22, 0);
      }
      if (flying) drawRocket(m, el, a, t, speed);
      else if (f && f.kind === 'cashed') drawGlyph(m.px(f.endSec), m.py(mulAt(f.endSec)), '💰', 24, 0);
    } else {
      drawGlyph(PAD.l + 30, H - PAD.b - 16, '🚀', 28, 0);   // idle: on the pad, waiting for launch
    }

    let more = false;
    if (boom) more = stepBoom() || more;
    ctx.restore();
    ctx.restore();
    return flying || more;
  }

  /* ---------- the loop: rAF with the canvas, a 4 Hz interval under reduced motion ---------- */
  function stopLoop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (intervalId) { clearInterval(intervalId); intervalId = 0; }
  }
  function step(t) {
    if (S.mode !== 'flying') return;
    const x = curX();
    paintReadout(x);
    paintBtnLabel(x);
    milestones(x);
    // The crash point is itself capped at maxX server-side, so a flight still climbing AT the ceiling has already
    // been decided against — we ask the server to resolve it rather than keep animating a number that is over. We
    // do NOT call this a cash-out: it resolves as a bust, and saying otherwise would promise a win we can't give.
    if (!autoCashed && !S.busy && x >= S.maxX - 1e-9) {
      autoCashed = true;
      say('Ceiling reached at ' + fx(S.maxX) + ' times — that is as high as the rocket goes. Resolving your flight.');
      cashout();
    }
  }
  function loop(t) {
    if (!running) return;
    step(t);
    const more = drawFrame(t);
    if (S.mode !== 'flying' && !more) { running = false; rafId = 0; return; }
    rafId = requestAnimationFrame(loop);
  }
  function ensureLoop() {
    if (running || intervalId) return;
    if (reduced() || !ctx || canvas.hidden) {
      intervalId = setInterval(function () { step(Date.now()); }, 250);   // genuinely playable: a 4 Hz readout, no animation
      step(Date.now());
    } else {
      running = true;
      fit();
      rafId = requestAnimationFrame(loop);
    }
  }
  function paintIdle() {
    if (!ctx || canvas.hidden) return;
    fit();
    drawFrame((window.performance && performance.now()) || Date.now());
  }

  /* ---------- painting ---------- */
  let lastXStr = '', lastBtnPaint = 0, lastBtnStr = '';
  function setXClass(c) {
    xEl.className = 'arc-x' + (c ? ' ' + c : '');
  }
  function paintReadout(x) {
    const s = fx(x) + '×';
    if (s !== lastXStr) { lastXStr = s; xEl.textContent = s; }
    setXClass(x >= 10 ? 'is-hot' : x >= 3 ? 'is-warm' : '');
  }
  // deliberately 4 Hz, not per-frame: the label IS the button's accessible name, and a screen reader
  // re-announces a focused control whose name changes. Date.now() (not the caller's timestamp) because the
  // rAF and interval paths run on different clocks and would otherwise never cross over cleanly.
  function paintBtnLabel(x) {
    const t = Date.now();
    if (t - lastBtnPaint < 250) return;
    lastBtnPaint = t;
    const s = '💰 Cash out (' + fx(x) + '×)';
    if (s !== lastBtnStr) { lastBtnStr = s; btn.textContent = s; }
  }

  function applyMotionMode() {
    const r = reduced();
    if (canvas) canvas.hidden = r;
    if (staticEl) staticEl.hidden = !r;
  }

  /* ---------- state → UI ---------- */
  function renderCurve() {
    if (!curveBody) return;
    const rows = [5, 10, 15, 20, 30, 45, 60];
    curveBody.innerHTML = rows.map(function (s) {
      const x = mulAt(s), b = boostFor(x), capped = b >= S.maxBoost - 1e-9;
      return '<tr' + (capped ? ' class="is-cap"' : '') + '><th scope="row">' + s + 's</th>' +
        '<td>' + fx(x) + '×</td><td>' + fx(b) + '×</td></tr>';
    }).join('');
    if (curveNote) {
      const capX = 1 + (S.maxBoost - 1) * BOOST_DIV;
      curveNote.innerHTML = 'The boost stops growing at <b>' + fx(S.maxBoost) + '×</b> — you reach it at <b>' +
        fx(capX) + '×</b>, about ' + Math.round(secFor(capX)) + ' seconds in. Every second past that is pure risk ' +
        'with nothing extra to win. <b>' + fx(S.maxX) + '×</b> is a hard ceiling the rocket never survives past, ' +
        'so a flight that gets there is out of runway.';
    }
  }

  function renderBadges() {
    const out = [];
    if (S.boost > 1 && S.until) {
      out.push('<span class="arc-badge arc-badge--boost"><span aria-hidden="true">⚡</span> <b>' + fx(S.boost) +
        '×</b> Send Power for <span class="arc-count" data-arc-until="' + Math.round(S.until) + '" data-arc-zero="less than a minute"></span></span>');
    }
    if (S.mode === 'ready') out.push('<span class="arc-badge arc-badge--free"><span aria-hidden="true">🎟️</span> Today’s free flight is waiting</span>');
    else if (S.mode === 'resume') out.push('<span class="arc-badge arc-badge--free"><span aria-hidden="true">🛰️</span> Your rocket is still up there</span>');
    else if (S.playedToday && S.mode !== 'flying' && S.mode !== 'loading') out.push('<span class="arc-badge arc-badge--done"><span aria-hidden="true">✅</span> You’ve flown today</span>');
    badges.innerHTML = out.join('');
    paintCounts();
  }

  function renderStage() {
    const o = S.outcome;
    let x = '1.00×', sub = 'Ready for takeoff', subCls = '', ico = '🚀', xcls = '';
    switch (S.mode) {
      case 'loading':   x = '—'; sub = 'Warming up the engines…'; break;
      case 'signedout': sub = 'Sign in to fly'; break;
      case 'ready':     sub = 'Ready for takeoff'; break;
      case 'resume':    x = '—'; sub = 'Rejoin to see where you are'; break;
      case 'flying':    x = lastXStr || '1.00×'; sub = 'Climbing — cash out whenever you like'; break;
      case 'cashed':    x = fx(o ? o.cashedX : 1) + '×'; sub = '💰 Locked in'; subCls = 'is-good'; ico = '💰'; break;
      case 'busted':    x = fx(o ? o.crashX : 1) + '×'; sub = '💥 It blew right here'; subCls = 'is-bad'; ico = '💥'; xcls = 'is-over'; break;
      case 'done':      x = '—'; sub = 'That’s today’s flight'; break;
      case 'expired':   x = '—'; sub = 'The rocket flew off without you'; subCls = 'is-bad'; ico = '🕒'; break;
      case 'error':     x = '—'; sub = 'Couldn’t reach mission control'; subCls = 'is-bad'; ico = '⚠️'; break;
    }
    if (S.mode !== 'flying') { lastXStr = x; xEl.textContent = x; setXClass(xcls); }
    subEl.textContent = sub;
    subEl.className = 'arc-sub' + (subCls ? ' ' + subCls : '');
    if (staticIco) staticIco.textContent = ico;
  }

  function renderControls() {
    let label = '', cls = 'arc-btn--go', dis = false, show = true, hint = '';
    switch (S.mode) {
      case 'loading':
        show = false; hint = 'Checking today’s flight…'; break;
      case 'signedout':
        label = 'Sign in to play 🚀'; hint = 'Free to play, free to join. Nothing is for sale here.'; break;
      case 'ready':
        label = '🚀 Launch'; hint = 'Press <kbd>Space</kbd> or <kbd>Enter</kbd> to launch.'; break;
      case 'resume':
        label = '🚀 Rejoin your flight'; hint = 'You left mid-flight — pick it back up where it is now.'; break;
      case 'flying':
        label = lastBtnStr || ('💰 Cash out (' + fx(curX()) + '×)');
        cls = 'arc-btn--cash';
        hint = 'Tap the button — or press <kbd>Space</kbd> / <kbd>Enter</kbd> — to lock in that multiplier.';
        break;
      case 'error':
        label = '↻ Try again'; hint = ''; break;
      case 'expired':
      case 'cashed':
      case 'busted':
      case 'done':
        label = '✅ Flight complete — back tomorrow'; cls = 'arc-btn--done'; dis = true;
        hint = 'One flight per day. The next one unlocks at 00:00 UTC.'; break;
    }
    btn.hidden = !show;
    btn.disabled = dis;
    btn.className = 'btn arc-btn ' + cls;
    // While flying, the VISIBLE label ticks with the multiplier 4×/s — so pin a stable accessible name, or a screen
    // reader re-announces the focused button every quarter second. The number is carried by the live region instead.
    if (S.mode === 'flying') btn.setAttribute('aria-label', 'Cash out');
    else btn.removeAttribute('aria-label');
    if (show && S.mode !== 'flying') { btn.textContent = label; lastBtnStr = ''; }
    else if (show) { btn.textContent = label; lastBtnStr = label; }
    hintEl.innerHTML = hint;
  }

  function nextFlightLine() {
    return '<p>Next free flight in <span class="arc-count" data-arc-until="' + nextReset() + '" data-arc-zero="a moment"></span> — the day rolls over at <b>00:00 UTC</b>.</p>';
  }
  // inner HTML only (no <p>) so callers can wrap it in their own sentence
  function lastRunLine(l) {
    if (!l) return 'your flight is already logged.';
    if (l.cashed_x != null) {
      return 'you cashed out at <b>' + fx(l.cashed_x) + '×</b> for a <span class="arc-big">' + fx(l.boost) +
        '×</span> Send Power boost' + (l.crash_x != null ? ' — the rocket would have blown at <b>' + fx(l.crash_x) + '×</b>.' : '.');
    }
    return 'your rocket blew at <b>' + fx(l.crash_x) + '×</b> before you tapped — no boost that day, and nothing lost.';
  }

  function renderPanel() {
    let html = '';
    if (S.mode === 'signedout') {
      html = '<div class="arc-msg"><p class="arc-msg-h">🔒 Sign in to fly</p>' +
        '<p>Rocket Run is a free daily bonus for signed-in senders — the boost has to attach to an account. It costs nothing, there is nothing to put in, and the only outcome is a temporary Send Power boost.</p>' +
        '<div class="arc-msg-actions"><button class="btn btn-sm btn-primary" type="button" data-arc="signin">Sign In 🚀</button></div></div>';
    } else if (S.mode === 'ready') {
      html = '<div class="arc-msg"><p class="arc-msg-h">🎟️ One flight, whenever you’re ready</p>' +
        '<p>Take off, watch the multiplier climb, and cash out before the hidden crash point. Cash out and it becomes a Send Power boost for 24 hours; leave it too long and today’s flight simply ends with no boost.</p>' +
        (S.last ? '<p>Last time out, ' + lastRunLine(S.last) + '</p>' : '') + '</div>';
    } else if (S.mode === 'resume') {
      html = '<div class="arc-msg arc-msg--warn"><p class="arc-msg-h">🛰️ You have a flight in the air</p>' +
        '<p>You launched earlier today and never cashed out, so the rocket is still climbing on the server’s clock. Rejoin to see where it got to — it may well have passed its crash point by now.</p></div>';
    } else if (S.mode === 'flying') {
      if (S.netErr) {
        html = '<div class="arc-msg arc-msg--warn"><p class="arc-msg-h">⚠️ That cash-out didn’t go through</p>' +
          '<p>' + esc(S.netErr) + '. Your flight is <b>still live</b> and nothing has been lost — press the button again to try the cash-out once more.</p></div>';
      }
    } else if (S.mode === 'cashed' && S.outcome) {
      const o = S.outcome;
      html = '<div class="arc-msg arc-msg--win" id="arc-outcome" tabindex="-1">' +
        '<p class="arc-msg-h">💰 Cashed out at ' + fx(o.cashedX) + '×</p>' +
        '<p>That’s a <span class="arc-big">' + fx(o.boost) + '×</span> Send Power boost for the next 24 hours' +
        (o.until ? ' (expires in <span class="arc-count" data-arc-until="' + Math.round(o.until) + '" data-arc-zero="less than a minute"></span>)' : '') +
        '. It is added on top of the Send Power boost you already have from holding, OG and communities — boosts add, they don\'t multiply.</p>' +
        (o.crashX != null ? '<p>Nerve check: the rocket would have blown at <b>' + fx(o.crashX) + '×</b>.</p>' : '') +
        nextFlightLine() + '</div>';
    } else if (S.mode === 'busted' && S.outcome) {
      html = '<div class="arc-msg arc-msg--bust" id="arc-outcome" tabindex="-1">' +
        '<p class="arc-msg-h">💥 It blew at ' + fx(S.outcome.crashX) + '×</p>' +
        '<p>A moment too late. No boost today — and nothing lost, because nothing was ever at stake. That’s the whole game.</p>' +
        nextFlightLine() + '</div>';
    } else if (S.mode === 'done') {
      html = '<div class="arc-msg" id="arc-outcome" tabindex="-1"><p class="arc-msg-h">✅ You’ve already flown today</p>' +
        '<p>Today, ' + lastRunLine(S.last) + '</p>' + nextFlightLine() + '</div>';
    } else if (S.mode === 'expired') {
      html = '<div class="arc-msg arc-msg--warn" id="arc-outcome" tabindex="-1"><p class="arc-msg-h">🕒 That flight expired</p>' +
        '<p>' + esc(S.err || 'The rocket flew off without you') + '. Nothing was at stake, so nothing was lost.</p>' + nextFlightLine() + '</div>';
    } else if (S.mode === 'error') {
      html = '<div class="arc-msg arc-msg--warn"><p class="arc-msg-h">⚠️ Couldn’t reach mission control</p>' +
        '<p>' + esc(S.err || 'Something went wrong') + '.</p>' +
        '<div class="arc-msg-actions"><button class="btn btn-sm btn-ghost" type="button" data-arc="retry">↻ Try again</button></div></div>';
    }
    panel.innerHTML = html;
    paintCounts();
  }

  function render() { renderBadges(); renderStage(); renderControls(); renderPanel(); }

  // opts.focusOutcome is the CALLER's answer to "did the button have focus before I disabled it?" — it cannot be
  // recomputed here, because disabling a focused button has already thrown focus back to <body> by the time we run.
  function setMode(m, opts) {
    S.mode = m;
    if (m === 'flying') { autoCashed = false; S.netErr = ''; S.freeze = null; boom = null; }
    render();
    if (m === 'flying') ensureLoop();
    else if (!boom) { stopLoop(); paintIdle(); }
    else ensureLoop();
    // the button becomes disabled when a flight resolves — never leave a keyboard user's focus on the body
    if (opts && opts.focusOutcome && document.activeElement === document.body) {
      const el = document.getElementById('arc-outcome');
      if (el) el.focus();
    }
  }

  /* ---------- server calls ---------- */
  function applyState(j) {
    S.boost = Number(j.boost) || 1;
    S.until = j.until ? Number(j.until) : null;
    S.playedToday = !!j.playedToday;
    if (Number(j.maxBoost) > 0) S.maxBoost = Number(j.maxBoost);
    if (Number(j.growth) > 0) S.growth = Number(j.growth);
    if (Number(j.maxX) > 1) S.maxX = Number(j.maxX);
    S.last = j.last || null;
    renderCurve();
    // the nav badge and this page must never disagree: if the boost the badge is showing is not the boost the
    // server just reported (expired overnight, or a cash-out in another tab), re-read /api/me and repaint it.
    const navArc = (window.AUTH && AUTH.user && AUTH.user.boost) ? (Number(AUTH.user.boost.arcade) || 1) : null;
    if (navArc != null && Math.abs(navArc - S.boost) > 1e-9 && AUTH.refresh) AUTH.refresh();
  }
  // /state only reports FINISHED rounds, so "played today, but nothing finished today" means a flight is still open
  function hasOpenRound() { return !(S.last && S.last.ended_at && Number(S.last.ended_at) >= todayStart()); }

  async function loadState() {
    if (!(window.AUTH && AUTH.user)) { setMode('signedout'); return; }
    try {
      const j = await window.api('/api/arcade/state');
      applyState(j);
      if (S.mode === 'flying') return;                       // a live flight always wins over a stale refresh
      if (!S.playedToday) setMode('ready');
      else if (hasOpenRound()) setMode('resume');
      else setMode('done');
    } catch (e) {
      const msg = String((e && e.message) || 'request failed');
      if (/sign in/i.test(msg)) { setMode('signedout'); return; }
      S.err = msg; setMode('error');
    }
  }

  async function start() {
    if (S.busy) return;
    if (!(window.AUTH && AUTH.user)) { if (window.AUTH && AUTH.open) AUTH.open(); return; }
    const hadFocus = document.activeElement === btn;   // must be read BEFORE the disable throws focus to <body>
    S.busy = true; btn.disabled = true;
    hintEl.textContent = 'Talking to mission control…';
    try {
      const j = await window.api('/api/arcade/start', { method: 'POST', body: {} });
      const localNow = Date.now();
      S.round = {
        id: j.roundId,
        startedAt: Number(j.startedAt) || localNow,
        offset: (Number(j.serverNow) || localNow) - localNow,
      };
      if (Number(j.growth) > 0) { S.growth = Number(j.growth); renderCurve(); }
      S.outcome = null; S.err = ''; S.netErr = ''; S.freeze = null; boom = null;
      S.playedToday = true; S.busy = false;
      lastXStr = ''; lastBtnStr = ''; lastBtnPaint = 0;
      resetMilestones();
      setMode('flying');
      say(j.resumed ? 'Rejoined your flight, already at ' + fx(curX()) + ' times. Cash out any time.' : 'Lift off. The multiplier is climbing — cash out any time.');
      if (j.resumed && window.sendToast) sendToast('🛰️ Rejoined your flight');
    } catch (e) {
      S.busy = false;
      const msg = String((e && e.message) || 'request failed');
      if (/sign in/i.test(msg)) { setMode('signedout'); if (window.AUTH && AUTH.open) AUTH.open(); return; }
      if (/expired/i.test(msg)) { S.err = msg; S.playedToday = true; setMode('expired', { focusOutcome: hadFocus }); say('That flight expired. Come back tomorrow.'); return; }
      if (/already flown|one run per day/i.test(msg)) { S.playedToday = true; await loadState(); say('You have already flown today. Come back tomorrow.'); return; }
      S.err = msg; setMode('error', { focusOutcome: hadFocus }); say('Could not launch. ' + msg);
    }
  }

  async function cashout() {
    if (S.busy || !S.round) return;
    const hadFocus = document.activeElement === btn;   // must be read BEFORE the disable throws focus to <body>
    S.busy = true; btn.disabled = true;
    const tapSec = elapsedSec(), tapX = curX();
    try {
      const j = await window.api('/api/arcade/cashout', { method: 'POST', body: { roundId: S.round.id } });
      S.busy = false; S.netErr = ''; S.playedToday = true;
      if (j.busted) {
        const crashX = Number(j.crashX) || 1, crashSec = secFor(crashX);
        S.outcome = { kind: 'busted', crashX: crashX };
        S.freeze = { kind: 'busted', endSec: crashSec, crashSec: crashSec, viewSec: Math.max(crashSec, tapSec), viewX: Math.max(crashX, tapX) };
        S.last = { crash_x: crashX, cashed_x: null, boost: null, ended_at: Date.now() };
        if (!reduced() && ctx && !canvas.hidden) {
          const a = axesFor(S.freeze.viewSec, S.freeze.viewX), m = mapFor(a);
          spawnBoom(m.px(crashSec), m.py(mulAt(crashSec)));
        }
        setMode('busted', { focusOutcome: hadFocus });
        say('Busted. The rocket blew at ' + fx(crashX) + ' times — no boost today, and nothing was at stake.');
        if (window.sendToast) sendToast('💥 Blew at ' + fx(crashX) + '× — no boost today');
      } else {
        const cashedX = Number(j.cashedX) || 1, crashX = Number(j.crashX) || null, boost = Number(j.boost) || 1;
        S.outcome = { kind: 'cashed', cashedX: cashedX, crashX: crashX, boost: boost, until: Number(j.until) || null };
        S.boost = boost; S.until = Number(j.until) || null;
        S.last = { crash_x: crashX, cashed_x: cashedX, boost: boost, ended_at: Date.now() };
        S.freeze = { kind: 'cashed', endSec: secFor(cashedX), crashSec: crashX ? secFor(crashX) : secFor(cashedX), viewSec: secFor(crashX || cashedX), viewX: crashX || cashedX };
        // repaint the nav badge immediately — the boost belongs next to the level, and a reload should not be the
        // only way to see it. j.mult is the server's own whole stack (1 + Σ of each boost above 1: holder, OG, community, arcade, prize).
        if (j.mult && window.AUTH && AUTH.user) {
          AUTH.user.boost = j.mult;
          document.dispatchEvent(new CustomEvent('boost:changed'));
        }
        setMode('cashed', { focusOutcome: hadFocus });
        say('Cashed out at ' + fx(cashedX) + ' times, for a ' + fx(boost) + ' times Send Power boost lasting ' +
          (S.until ? durWords(S.until - Date.now()) : '24 hours') + '.');
        if (window.sendToast) sendToast('💰 ' + fx(boost) + '× Send Power for 24h!');
        if (window.sendConfetti) {
          const r = btn.getBoundingClientRect();
          sendConfetti(r.left + r.width / 2, r.top + r.height / 2, { count: 70, emojiRatio: 0.45 });
        }
      }
    } catch (e) {
      S.busy = false;
      const msg = String((e && e.message) || 'request failed');
      if (/already over|no such run/i.test(msg)) {          // resolved elsewhere (another tab, or a double tap)
        S.round = null; S.playedToday = true; S.freeze = null; boom = null;
        stopLoop(); await loadState();
        say('That flight is already over.');
        return;
      }
      if (/sign in/i.test(msg)) { stopLoop(); S.round = null; S.freeze = null; boom = null; setMode('signedout'); return; }
      // network hiccup or a transient server error: the flight is STILL LIVE. Let them tap again.
      S.netErr = msg;
      btn.disabled = false;
      if (hadFocus && document.activeElement === document.body) btn.focus();   // the tap failed; keep them on the button
      renderPanel();
      say('That cash out did not go through. Your flight is still live — press the button again.');
      if (window.sendToast) sendToast('⚠️ Cash-out failed — tap again, you’re still flying');
    }
  }

  /* ---------- input ---------- */
  btn.addEventListener('click', function () {
    if (btn.disabled) return;
    if (S.mode === 'signedout') { if (window.AUTH && AUTH.open) AUTH.open(); return; }
    if (S.mode === 'ready' || S.mode === 'resume') { start(); return; }
    if (S.mode === 'flying') { cashout(); return; }
    if (S.mode === 'error') { S.err = ''; setMode('loading'); loadState(); return; }
  });

  panel.addEventListener('click', function (e) {
    const el = e.target.closest('[data-arc]');
    if (!el) return;
    const what = el.getAttribute('data-arc');
    if (what === 'signin' && window.AUTH && AUTH.open) AUTH.open();
    else if (what === 'retry') { S.err = ''; setMode('loading'); loadState(); }
  });

  // Space / Enter launch and cash out from anywhere on the page. The button is a real <button>, so when IT has
  // focus the browser already does this (and suppresses the space-scroll) — we only step in when focus is
  // elsewhere, and then we must eat the keypress so the page doesn't scroll underneath the game.
  function typingTarget(t) {
    return !!(t && t.closest && t.closest('input, textarea, select, button, a[href], summary, [contenteditable="true"], [role="button"], [role="textbox"], [role="tab"], [role="menuitem"]'));
  }
  function dialogOpen() {
    const ds = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
    for (let i = 0; i < ds.length; i++) if (ds[i].getClientRects().length) return true;
    return false;
  }
  // Space/Enter as a game shortcut, but ONLY in the safe direction and only while a flight is actually up.
  // It must never LAUNCH from a page-wide key: the daily flight is irreversible, and someone pressing Space
  // to scroll the page would burn it without ever meaning to. Launching is the real <button>'s job (focus it
  // and press — that already works). Cashing out early is always safe, so that one is worth a global key.
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.key !== 'Spacebar' && e.key !== 'Enter') return;
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (S.mode !== 'flying') return;                 // never 'ready'/'resume' — no accidental takeoff
    if (typingTarget(e.target) || dialogOpen()) return;
    if (btn.hidden || btn.disabled) return;
    e.preventDefault();          // stop Space from scrolling the stage out from under a live flight
    btn.click();
  });

  /* ---------- environment ---------- */
  let resizeTimer = 0;
  addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { fit(); if (!running) paintIdle(); }, 120);
  }, { passive: true });

  try {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = function () {
      applyMotionMode();
      const wasFlying = S.mode === 'flying';
      stopLoop(); boom = null;
      if (wasFlying) ensureLoop(); else paintIdle();
    };
    if (mq.addEventListener) mq.addEventListener('change', onMotion);
    else if (mq.addListener) mq.addListener(onMotion);
  } catch (err) { /* no matchMedia: the canvas path is the default */ }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && S.mode === 'flying') ensureLoop();
  });

  /* ---------- boot ---------- */
  applyMotionMode();
  renderCurve();
  let bootedFor;
  function boot() {
    const u = (window.AUTH && AUTH.user) ? String(AUTH.user.username || '1') : null;
    if (bootedFor !== undefined && u === bootedFor) return;   // auth:change also fires once at init
    bootedFor = u;
    stopLoop(); boom = null;
    S.round = null; S.outcome = null; S.freeze = null; S.netErr = ''; S.err = '';
    lastXStr = ''; lastBtnStr = '';
    if (!u) { setMode('signedout'); return; }
    setMode('loading');
    loadState();
  }
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(boot, boot);
  else boot();
  document.addEventListener('auth:change', boot);
  // the stage can be measured at 0 width before first layout / webfont settle — repaint the idle scene once more
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { if (!running) paintIdle(); });
  addEventListener('load', function () { if (!running) paintIdle(); });
})();
