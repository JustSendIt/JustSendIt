/* ===== arcade.js — the Arcade page: "Rocket Run", one free flight per UTC day for a Send Power boost =====
 *
 * GUESTS FLY TOO (owner, 2026-10-15). Signed out, the same flight runs against /api/arcade/guest/*: one a day, no
 * boost, and a cash-out can put a name on today's Rocket Riders board. Then a prompt: create an account or sign in
 * (the flight becomes that account's @name, in its colours) or stay as a guest (the name stays grey and plain,
 * with "guest" beside it). The board itself is drawn at the foot of the game card for everyone.
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
    mode: 'loading',        // loading | signedout | ready | resume | flying | cashed | busted | done | expired | error | needsproof
    boost: 1, until: null, playedToday: false, last: null,
    growth: 0.06, maxBoost: 5, maxX: 50,
    round: null,            // { id, startedAt, offset }  offset = serverClock − localClock
    freeze: null,           // frozen view for the resolved-round drawing
    outcome: null,
    busy: false, netErr: '', err: '',
    proof: null,            // the needsProof refusal from /start, kept so the button can re-open the wallet check
    guest: false,           // flying signed out: /api/arcade/guest/*, no boost, a name on the board
    guestRound: null,       // the guest's flight today, as /api/arcade/guest describes it ({ id, cashedX, crashX, name, nameOff, … })
    netFull: false,         // today's guest flights from this network are used up
    siteFull: false,        // ...or across the whole site
    perNetwork: 5,          // guest flights a day per network (the server says)
    boardOff: false,        // a moderator took this member's @name off today's board
    nameErr: '', nameBusy: false,
    cashedToday: false, onBoard: false, boardRank: null,   // a member's cash-out today, and whether @name is on the board
    board: null,            // /api/arcade/board
  };
  const API = (k) => (S.guest ? '/api/arcade/guest/' : '/api/arcade/') + k;   // the same flight, for an account or a guest
  // "stay as guest" is remembered per flight on this device, so a reload does not ask again
  const STAY_KEY = 'send.rrStay';
  let stayedId = null;   // the same answer in memory, for a browser that blocks storage
  const stayed = () => { if (!S.guestRound) return false; if (stayedId === S.guestRound.id) return true; try { return localStorage.getItem(STAY_KEY) === String(S.guestRound.id); } catch (e) { return false; } };

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
    loadState();
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
    say(S.guest ? hit + ' times. Cash out any time.' : hit + ' times. Cash out now for a ' + fx(boostFor(hit)) + ' times Send Power boost.');
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
  function hueFor(x) { return x >= 10 ? '#ff8f4d' : x >= 3 ? '#ffb340' : '#c6f000'; }

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
    g.addColorStop(0, 'rgba(168,206,0,0.30)');
    g.addColorStop(1, 'rgba(168,206,0,0.015)');
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
    // the wrapper is a keyboard stop, and says it scrolls, only while it actually does (as the chart's trade tape does)
    const wrap = curveBody.closest('.arc-tablewrap');
    const fit = () => {
      if (!wrap) return;
      if (wrap.scrollWidth > wrap.clientWidth + 1) { wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'The boost curve table, scrollable sideways'); }
      else { wrap.removeAttribute('tabindex'); wrap.removeAttribute('role'); wrap.removeAttribute('aria-label'); }
    };
    requestAnimationFrame(fit);
    if (wrap && !wrap._fitWired) { wrap._fitWired = true; window.addEventListener('resize', fit); }
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
    if (S.mode === 'ready') out.push('<span class="arc-badge arc-badge--free"><span aria-hidden="true">🎟️</span> Today’s free ' + (S.guest ? 'guest ' : '') + 'flight is waiting</span>');
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
      case 'signedout': sub = S.netFull ? 'Guest flights from here are used up today' : 'Sign in to fly'; break;
      case 'ready':     sub = 'Ready for takeoff'; break;
      case 'resume':    x = '—'; sub = 'Rejoin to see where you are'; break;
      case 'flying':    x = lastXStr || '1.00×'; sub = 'Climbing — cash out whenever you like'; break;
      case 'cashed':    x = fx(o ? o.cashedX : 1) + '×'; sub = '💰 Locked in'; subCls = 'is-good'; ico = '💰'; break;
      case 'busted':    x = fx(o ? o.crashX : 1) + '×'; sub = '💥 It blew right here'; subCls = 'is-bad'; ico = '💥'; xcls = 'is-over'; break;
      case 'done':      x = '—'; sub = 'That’s today’s flight'; break;
      case 'expired':   x = '—'; sub = 'The rocket flew off without you'; subCls = 'is-bad'; ico = '🕒'; break;
      case 'error':     x = '—'; sub = 'Couldn’t reach mission control'; subCls = 'is-bad'; ico = '⚠️'; break;
      case 'needsproof': x = '—'; sub = 'A wallet check comes first'; subCls = 'is-bad'; ico = '🪙'; break;
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
        label = 'Sign in to play 🚀'; hint = 'Joining takes an invite, and flying takes the same check as posting — at least $100 of $SEND held in a linked wallet. Nothing is for sale here.'; break;
      case 'ready':
        label = S.guest ? '🚀 Fly free as a guest' : '🚀 Launch';
        hint = 'Tap the button — or Tab to it and press <kbd>Space</kbd> / <kbd>Enter</kbd> — to launch.' + (S.guest ? ' No account needed: one free flight a day, for a name on today’s board (no Send Power boost).' : ''); break;
      case 'resume':
        label = '🚀 Rejoin your flight'; hint = 'You left mid-flight — pick it back up where it is now.'; break;
      case 'flying':
        label = lastBtnStr || ('💰 Cash out (' + fx(curX()) + '×)');
        cls = 'arc-btn--cash';
        hint = 'Tap the button — or press <kbd>Space</kbd> / <kbd>Enter</kbd> — to cash out. It settles at the multiplier the server sees when your tap lands, a moment after the one showing.';
        break;
      case 'error':
        label = '↻ Try again'; hint = ''; break;
      case 'needsproof':
        // the same gate every write on the site sits behind — say so, rather than a generic error
        label = '🪙 Verify a wallet to fly'; hint = 'Flying counts as doing, like posting: it needs at least $100 of $SEND held in a linked wallet, read on-chain. Verify once and the launch button comes back.'; break;
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
    /* This one control is six controls wearing one element — its label is rewritten per state, so a single
       static description was only ever true in two of them. The description follows the state with it. */
    btn.setAttribute('data-tip',
      S.mode === 'signedout' ? 'Opens sign-in so you can play'
      : S.mode === 'ready'   ? (S.guest ? 'Starts your one free guest flight for today — no account needed' : 'Starts your one flight for today')
      : S.mode === 'resume'  ? 'Picks your flight back up where it is now'
      : S.mode === 'flying'  ? 'Sends your cash-out — it settles at the multiplier the server sees when the tap lands, a moment after the one showing'
      : S.mode === 'error'   ? 'Asks the arcade for its state again'
      : S.mode === 'needsproof' ? 'Opens the wallet check that unlocks the launch'
      : 'Today\u2019s flight is over — the next unlocks at 00:00 UTC');
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

  /* ---------- a guest's name on today's board, and the prompt after it ---------- */
  const joinBtns = (stay) =>
    '<div class="arc-msg-actions">' +
      '<button class="btn btn-sm btn-primary" type="button" data-arc="join" data-tip="Opens the invite ticket to make an account; a flight you put on today’s board becomes your @name">🎟️ Create an account</button>' +
      '<button class="btn btn-sm btn-ghost" type="button" data-arc="signin" data-tip="Opens sign-in; a flight you put on today’s board becomes your account’s">Sign in</button>' +
      (stay ? '<button class="btn btn-sm btn-ghost" type="button" data-arc="stay" data-tip="Keeps your name on today’s board as a guest: grey and plain">Stay as guest</button>' : '') +
    '</div>';
  function guestBoardHTML() {
    const r = S.guestRound;
    if (!r || r.cashedX == null) return '';
    if (r.nameOff) return '<p>Your name is off today’s board. Tomorrow’s flight can put one up again.</p>';
    if (!r.name) {
      return '<form class="arc-name" data-arc-name novalidate>' +
        '<label class="arc-name-lbl" for="arc-name-in">🏁 Put a name on today’s Rocket Riders board</label>' +
        '<div class="arc-name-row">' +
          '<input class="arc-name-in" id="arc-name-in" name="name" type="text" maxlength="24" autocomplete="nickname" autocapitalize="off" spellcheck="false" placeholder="Your name" aria-describedby="arc-name-help' + (S.nameErr ? ' arc-name-err' : '') + '"' + (S.nameErr ? ' aria-invalid="true"' : '') + (S.nameBusy ? ' disabled' : '') + ' data-tip="The name to show beside your cash-out on today’s board">' +
          '<button class="btn btn-sm btn-primary" type="submit" data-tip="Puts this name on today’s board beside your ' + fx(r.cashedX) + '× cash-out"' + (S.nameBusy ? ' disabled' : '') + '>Put it on the board</button>' +
        '</div>' +
        '<p class="arc-note" id="arc-name-help">3 to 24 letters, numbers, dashes or underscores, and not a member’s name. A guest’s name shows grey and plain, with “guest” beside it, for today.</p>' +
        (S.nameErr ? '<p class="arc-name-err" id="arc-name-err" role="alert">' + esc(S.nameErr) + '</p>' : '') +
      '</form>';
    }
    const rank = S.board && S.board.top.find((x) => x.guest && x.id === r.id);
    const where = rank ? ' — <b>#' + rank.rank + '</b> right now' : (S.board ? ' — below the top ' + S.board.top.length + ' right now' : '');
    if (!stayed()) {
      return '<div class="arc-prompt" id="arc-prompt" tabindex="-1" role="group" aria-labelledby="arc-prompt-h">' +
        '<p class="arc-msg-h" id="arc-prompt-h">🏁 You’re on today’s board as ' + esc(r.name) + where + '</p>' +
        '<p>As a guest your name stays grey and plain. Create an account or sign in on this browser in the next 30 minutes, and this flight goes up as your <b>@name</b>, in your colours. Signed in, the daily flight takes $100 of $SEND held in a linked wallet, and it pays a Send Power boost. Joining takes an invite code from someone already inside.</p>' +
        joinBtns(true) + '</div>';
    }
    return '<p>You’re on today’s board as <span class="arc-guest-name">' + esc(r.name) + '</span> <span class="arc-rider-tag">guest</span>' + where + '.</p>' +
      '<div class="arc-msg-actions">' +
        '<button class="btn btn-sm btn-ghost" type="button" data-arc="join" data-tip="Opens the invite ticket to make an account; this flight becomes your @name">🎟️ Make it my @name</button>' +
        '<button class="btn btn-sm btn-ghost" type="button" data-arc="unname" data-tip="Takes your name off today’s board (it can’t go back up today)">Take my name off</button>' +
      '</div>';
  }
  // a member's cash-out today: put @name on the board, or take it off
  function memberBoardHTML() {
    if (S.guest || !S.cashedToday || !(window.AUTH && AUTH.user)) return '';
    const u = esc(AUTH.user.username);
    if (S.boardOff) return '<p>A moderator took <b>@' + u + '</b> off today’s Rocket Riders board. It can go back up tomorrow.</p>';
    if (S.onBoard) {
      return '<p>🏁 You’re on today’s Rocket Riders board as <b>@' + u + '</b>' + (S.boardRank ? ' — <b>#' + S.boardRank + '</b> right now' : '') + '.</p>' +
        '<div class="arc-msg-actions"><button class="btn btn-sm btn-ghost" type="button" data-arc="boardoff" data-tip="Takes @' + u + ' off today’s board">Take me off the board</button></div>';
    }
    return '<p>🏁 Put <b>@' + u + '</b> on today’s Rocket Riders board? Nobody is listed just for flying — only the names their pilots put up.</p>' +
      '<div class="arc-msg-actions"><button class="btn btn-sm btn-primary" type="button" data-arc="boardon" data-tip="Lists your best cash-out today on the board under @' + u + '">Put me on the board</button></div>';
  }

  function renderPanel() {
    let html = '';
    if (S.mode === 'signedout' && S.guest && (S.netFull || S.siteFull)) {
      html = '<div class="arc-msg"><p class="arc-msg-h">🎟️ ' + (S.netFull ? 'Today’s guest flights from here are used up' : 'Today’s guest flights are full') + '</p>' +
        '<p>' + (S.netFull
          ? 'One network (a home, an office) gets ' + S.perNetwork + ' free guest flights a day, so clearing cookies is not another go, and today’s have flown.'
          : 'The site takes a set number of guest flights a day, and today’s have flown.') +
        ' The next ones unlock at 00:00 UTC. Signed in, a member’s daily flight takes $100 of $SEND held in a linked wallet.</p>' +
        nextFlightLine() + joinBtns(false) + '</div>';
    } else if (S.mode === 'signedout') {
      html = '<div class="arc-msg"><p class="arc-msg-h">🔒 Sign in to fly</p>' +
        '<p>Rocket Run is a once-a-day flight for signed-in senders — the boost has to attach to an account. Joining takes an invite, and flying takes the same wallet check as posting: at least $100 of $SEND held in a linked wallet, read on-chain. Nothing is for sale here, nothing is put in, and the only outcome is a temporary Send Power boost.</p>' +
        '<div class="arc-msg-actions"><button class="btn btn-sm btn-primary" type="button" data-tip="Opens the sign-in box so you can play" data-arc="signin">Sign In 🚀</button></div></div>';
    } else if (S.mode === 'ready' && S.guest) {
      html = '<div class="arc-msg"><p class="arc-msg-h">🎟️ One free flight — no account needed</p>' +
        '<p>Take off, watch the multiplier climb, and cash out before the hidden crash point. Cash out and you can put a name on <a href="#arc-riders">today’s Rocket Riders board</a>; leave it too long and the flight just ends. A guest flight is only for fun: it pays no Send Power boost — members fly for that.</p>' +
        '<div class="arc-msg-actions"><button class="btn btn-sm btn-ghost" type="button" data-tip="Opens the sign-in box to fly as a member" data-arc="signin">Sign in instead</button></div></div>';
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
    } else if (S.mode === 'cashed' && S.outcome && S.guest) {
      const o = S.outcome;
      html = '<div class="arc-msg arc-msg--win" id="arc-outcome" tabindex="-1">' +
        '<p class="arc-msg-h">💰 Cashed out at ' + fx(o.cashedX) + '×</p>' +
        (o.crashX != null ? '<p>Nerve check: the rocket would have blown at <b>' + fx(o.crashX) + '×</b>.</p>' : '') +
        guestBoardHTML() + nextFlightLine() + '</div>';
    } else if (S.mode === 'cashed' && S.outcome) {
      const o = S.outcome;
      html = '<div class="arc-msg arc-msg--win" id="arc-outcome" tabindex="-1">' +
        '<p class="arc-msg-h">💰 Cashed out at ' + fx(o.cashedX) + '×</p>' +
        '<p>That’s a <span class="arc-big">' + fx(o.boost) + '×</span> Send Power boost for the next 24 hours' +
        (o.until ? ' (expires in <span class="arc-count" data-arc-until="' + Math.round(o.until) + '" data-arc-zero="less than a minute"></span>)' : '') +
        '. It is added on top of the Send Power boost you already have from holding, OG and communities — boosts add, they don\'t multiply.</p>' +
        (o.crashX != null ? '<p>Nerve check: the rocket would have blown at <b>' + fx(o.crashX) + '×</b>.</p>' : '') +
        memberBoardHTML() + nextFlightLine() + '</div>';
    } else if (S.mode === 'busted' && S.outcome) {
      html = '<div class="arc-msg arc-msg--bust" id="arc-outcome" tabindex="-1">' +
        '<p class="arc-msg-h">💥 It blew at ' + fx(S.outcome.crashX) + '×</p>' +
        (S.guest
          ? '<p>A moment too late. A bust has no score, so there is no name to put on today’s board — and nothing lost, because nothing was ever at stake. Another free flight tomorrow. Members who hold $100 of $SEND in a linked wallet fly for a Send Power boost.</p>' + nextFlightLine() + joinBtns(false)
          : '<p>A moment too late. No boost today — and nothing lost, because nothing was ever at stake. That’s the whole game.</p>' + nextFlightLine()) + '</div>';
    } else if (S.mode === 'done' && S.guest) {
      const r = S.guestRound;
      html = '<div class="arc-msg" id="arc-outcome" tabindex="-1"><p class="arc-msg-h">✅ You’ve had today’s free guest flight</p>' +
        (r && r.cashedX != null
          ? '<p>Today you cashed out at <b>' + fx(r.cashedX) + '×</b>' + (r.crashX != null ? ' — the rocket would have blown at <b>' + fx(r.crashX) + '×</b>' : '') + '.</p>' + guestBoardHTML() + nextFlightLine()
          : '<p>Today your rocket blew at <b>' + fx(r && r.crashX) + '×</b> before you tapped, so there is no name for the board — and nothing lost.</p>' + nextFlightLine() + joinBtns(false)) +
        '</div>';
    } else if (S.mode === 'done') {
      html = '<div class="arc-msg" id="arc-outcome" tabindex="-1"><p class="arc-msg-h">✅ You’ve already flown today</p>' +
        '<p>Today, ' + lastRunLine(S.last) + '</p>' + memberBoardHTML() + nextFlightLine() + '</div>';
    } else if (S.mode === 'expired') {
      html = '<div class="arc-msg arc-msg--warn" id="arc-outcome" tabindex="-1"><p class="arc-msg-h">🕒 That flight expired</p>' +
        '<p>' + esc(S.err || 'The rocket flew off without you') + '. Nothing was at stake, so nothing was lost.</p>' + nextFlightLine() + '</div>';
    } else if (S.mode === 'error') {
      html = '<div class="arc-msg arc-msg--warn"><p class="arc-msg-h">⚠️ Couldn’t reach mission control</p>' +
        '<p>' + esc(S.err || 'Something went wrong') + '.</p>' +
        '<div class="arc-msg-actions"><button class="btn btn-sm btn-ghost" type="button" data-tip="Checks the server again for the state of your flight" data-arc="retry">↻ Try again</button></div></div>';
    }
    panel.innerHTML = html;
    paintCounts();
  }

  function render() { renderBadges(); renderStage(); renderControls(); renderPanel(); }

  // opts.focusOutcome is the CALLER's answer to "did the button have focus before I disabled it?" — it cannot be
  // recomputed here, because disabling a focused button has already thrown focus back to <body> by the time we run.
  function setMode(m, opts) {
    S.mode = m;
    document.documentElement.classList.toggle('arc-flying', m === 'flying');   // Sendy (sendy.js) steps off the multiplier while it climbs
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
    if (!(window.AUTH && AUTH.user)) { await loadGuest(); return; }
    S.guest = false; S.guestRound = null; S.netFull = false;
    try {
      const j = await window.api('/api/arcade/state');
      applyState(j);
      S.cashedToday = !!j.cashedToday; S.onBoard = !!j.onBoard; S.boardOff = !!j.boardOff;
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
  // signed out: today's guest flight (/api/arcade/guest says whether it has flown, and how it went)
  async function loadGuest() {
    S.guest = true; S.boost = 1; S.until = null; S.cashedToday = false; S.onBoard = false;
    try {
      const j = await window.api('/api/arcade/guest');
      if (Number(j.growth) > 0) S.growth = Number(j.growth);
      if (Number(j.maxX) > 1) S.maxX = Number(j.maxX);
      renderCurve();
      const r = j.round || null;
      S.guestRound = r; S.netFull = !!j.netFull; S.siteFull = !!j.siteFull; S.playedToday = !!j.flownToday;
      if (Number(j.perNetwork) > 0) S.perNetwork = Number(j.perNetwork);
      S.last = r && !r.open ? { crash_x: r.crashX, cashed_x: r.cashedX, boost: null, ended_at: Date.now() } : null;
      if (S.mode === 'flying') return;                       // a live flight always wins over a stale refresh
      if (!j.flownToday) setMode(j.netFull || j.siteFull ? 'signedout' : 'ready');
      else if (r && r.open) setMode('resume');
      else setMode('done');
    } catch (e) {
      const msg = String((e && e.message) || 'request failed');
      if (/signed in/i.test(msg) && window.AUTH && AUTH.refresh) { AUTH.refresh(); return; }   // signed in after all (another tab): auth:change re-boots
      S.err = msg; setMode('error');
    }
  }

  async function start() {
    if (S.busy) return;
    if (!S.guest && !(window.AUTH && AUTH.user)) { if (window.AUTH && AUTH.open) AUTH.open(); return; }
    const hadFocus = document.activeElement === btn;   // must be read BEFORE the disable throws focus to <body>
    S.busy = true; btn.disabled = true;
    hintEl.textContent = 'Talking to mission control…';
    try {
      const j = await window.api(API('start'), { method: 'POST', body: {} });
      const localNow = Date.now();
      S.round = {
        id: j.roundId,
        startedAt: Number(j.startedAt) || localNow,
        offset: (Number(j.serverNow) || localNow) - localNow,
      };
      if (Number(j.growth) > 0) { S.growth = Number(j.growth); renderCurve(); }
      S.outcome = null; S.err = ''; S.netErr = ''; S.freeze = null; boom = null;
      S.playedToday = true; S.busy = false; S.nameErr = '';
      if (S.guest) S.guestRound = { id: j.roundId, open: true, cashedX: null, crashX: null, name: null, nameOff: false };
      lastXStr = ''; lastBtnStr = ''; lastBtnPaint = 0;
      resetMilestones();
      setMode('flying');
      watchFlight();
      if (window.SFX) SFX.play('launch');   // the server confirmed the round: the rocket goes
      say(j.resumed ? 'Rejoined your flight, already at ' + fx(curX()) + ' times. Cash out any time.' : 'Lift off. The multiplier is climbing — cash out any time.');
      if (j.resumed && window.sendToast) sendToast('🛰️ Rejoined your flight');
    } catch (e) {
      S.busy = false;
      const msg = String((e && e.message) || 'request failed');
      // the participation gate: auth.js has already opened the wallet check; the page must not also say "error"
      if (e && e.needsProof) { S.proof = e; setMode('needsproof', { focusOutcome: hadFocus }); say('A wallet check comes first. ' + msg); return; }
      if (S.guest && e && /^guest_/.test(e.code || '')) {   // a guest turned away: today's flight is used, or the network's or site's are full
        if (window.SFX) SFX.play('error');
        say(msg); await loadState();
        const o = document.getElementById('arc-outcome') || panel.querySelector('.arc-msg');
        if (hadFocus && o && document.activeElement === document.body) { o.tabIndex = -1; o.focus(); }
        return;
      }
      if (/sign in/i.test(msg)) { setMode('signedout'); if (window.AUTH && AUTH.open) AUTH.open(); return; }
      if (window.SFX) SFX.play('error');   // refused or unreachable, shown on the stage (no toast says it)
      if (/expired/i.test(msg)) { S.err = msg; S.playedToday = true; setMode('expired', { focusOutcome: hadFocus }); say('That flight expired. Come back tomorrow.'); return; }
      if (/already flown|one run per day|today’s free guest flight|guest flights/i.test(msg)) { S.playedToday = true; await loadState(); say(msg); return; }
      S.err = msg; setMode('error', { focusOutcome: hadFocus }); say('Could not launch. ' + msg);
    }
  }

  /* The flight ends by itself at its crash point (owner, 2026-10-14: "fix the rocket run so the game ends when the random set
     bust number is hit so the user doesn't keep playing the game after the bust number has been reached"). This page still
     never knows the crash point: it holds /api/arcade/watch open, and the server answers it the moment the rocket blows, or after
     25 s with "still flying" so it asks again. Whichever comes first — that answer or a cash-out — ends the flight; the other is
     ignored. */
  let watchCtl = null;
  function stopWatch() { if (watchCtl) { watchCtl.abort(); watchCtl = null; } }
  async function watchFlight() {
    const id = S.round && S.round.id; if (!id) return;
    stopWatch();
    const ctl = new AbortController(); watchCtl = ctl;
    const live = () => !ctl.signal.aborted && S.mode === 'flying' && S.round && S.round.id === id;
    let fails = 0;
    while (live()) {
      let j = null;
      try {
        const r = await fetch(API('watch') + '?roundId=' + encodeURIComponent(id), { credentials: 'same-origin', signal: ctl.signal });
        j = await r.json().catch(() => null);
        if (!r.ok || !j) throw new Error((j && j.error) || 'watch failed');
        fails = 0;
      } catch (e) {
        if (ctl.signal.aborted) return;
        fails++;   // a dropped connection: ask again, gently — a cash-out tap still works meanwhile
        await new Promise((ok) => setTimeout(ok, Math.min(5000, 400 * fails)));
        continue;
      }
      if (!live()) return;
      if (j.over) {
        watchCtl = null;
        if (j.busted) bust(Number(j.crashX) || 1, elapsedSec(), curX(), document.activeElement === btn, true);
        else { stopLoop(); S.round = null; S.freeze = null; boom = null; await loadState(); say('That flight is already over.'); }   // cashed out elsewhere
        return;
      }
    }
  }
  // the rocket blew at crashX: freeze the picture there, say so (auto: it reached its crash point with nobody tapping)
  function bust(crashX, tapSec, tapX, hadFocus, auto) {
    stopWatch();
    const crashSec = secFor(crashX);
    S.busy = false; S.netErr = ''; S.playedToday = true;
    S.outcome = { kind: 'busted', crashX: crashX };
    S.freeze = { kind: 'busted', endSec: crashSec, crashSec: crashSec, viewSec: Math.max(crashSec, tapSec), viewX: Math.max(crashX, tapX) };
    S.last = { crash_x: crashX, cashed_x: null, boost: null, ended_at: Date.now() };
    if (S.guest && S.guestRound) Object.assign(S.guestRound, { open: false, crashX: crashX, cashedX: null });
    if (!reduced() && ctx && !canvas.hidden) {
      const a = axesFor(S.freeze.viewSec, S.freeze.viewX), m = mapFor(a);
      spawnBoom(m.px(crashSec), m.py(mulAt(crashSec)));
    }
    setMode('busted', { focusOutcome: hadFocus });
    say((auto ? 'The rocket blew at ' + fx(crashX) + ' times before you cashed out' : 'Busted. The rocket blew at ' + fx(crashX) + ' times') + (S.guest ? ' — no score today, and nothing was at stake.' : ' — no boost today, and nothing was at stake.'));
    if (window.SFX) SFX.play('crash');
    if (window.sendToast) sendToast('💥 Blew at ' + fx(crashX) + '×' + (S.guest ? '' : ' — no boost today'));
  }

  async function cashout() {
    if (S.busy || !S.round) return;
    const hadFocus = document.activeElement === btn;   // must be read BEFORE the disable throws focus to <body>
    S.busy = true; btn.disabled = true;
    const tapSec = elapsedSec(), tapX = curX();
    try {
      const j = await window.api(API('cashout'), { method: 'POST', body: { roundId: S.round.id } });
      if (S.mode !== 'flying') { S.busy = false; return; }   // the watch already ended it (the rocket blew first)
      S.busy = false; S.netErr = ''; S.playedToday = true;
      if (j.busted) {
        bust(Number(j.crashX) || 1, tapSec, tapX, hadFocus, false);
      } else if (S.guest) {
        // a guest's cash-out pays nothing: what it can do is put a name on today's board (the form is in the panel)
        stopWatch();
        const cashedX = Number(j.cashedX) || 1, crashX = Number(j.crashX) || null;
        S.outcome = { kind: 'cashed', cashedX: cashedX, crashX: crashX, boost: null, until: null };
        S.last = { crash_x: crashX, cashed_x: cashedX, boost: null, ended_at: Date.now() };
        if (S.guestRound) Object.assign(S.guestRound, { open: false, cashedX: cashedX, crashX: crashX });
        S.freeze = { kind: 'cashed', endSec: secFor(cashedX), crashSec: crashX ? secFor(crashX) : secFor(cashedX), viewSec: secFor(crashX || cashedX), viewX: crashX || cashedX };
        setMode('cashed', { focusOutcome: hadFocus });
        say('Cashed out at ' + fx(cashedX) + ' times. Put a name on today’s board, just below.');
        if (window.SFX) SFX.play('cashout');
        if (window.sendToast) sendToast('💰 Cashed out at ' + fx(cashedX) + '× — put a name on the board');
      } else {
        stopWatch();
        const cashedX = Number(j.cashedX) || 1, crashX = Number(j.crashX) || null, boost = Number(j.boost) || 1;
        S.outcome = { kind: 'cashed', cashedX: cashedX, crashX: crashX, boost: boost, until: Number(j.until) || null };
        S.boost = boost; S.until = Number(j.until) || null;
        S.cashedToday = true; S.onBoard = false; S.boardRank = null;
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
        if (window.SFX) SFX.play('cashout');
        if (window.sendToast) sendToast('💰 ' + fx(boost) + '× Send Power for 24h!');
        if (window.sendConfetti) {
          const r = btn.getBoundingClientRect();
          sendConfetti(r.left + r.width / 2, r.top + r.height / 2, { count: 70, emojiRatio: 0.45 });
        }
      }
    } catch (e) {
      S.busy = false;
      const msg = String((e && e.message) || 'request failed');
      if (S.mode !== 'flying') return;                       // the watch already ended it (the rocket blew first)
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
    // re-open the wallet check; once it passes, auth:change re-boots the page into 'ready'
    if (S.mode === 'needsproof') { if (S.proof && window.AUTH && AUTH.needsProof) AUTH.needsProof(S.proof); else { setMode('loading'); loadState(); } return; }
  });

  /* ---------- today's Rocket Riders board ---------- */
  const ridersList = document.getElementById('arc-riders-list');
  const ridersMore = document.getElementById('arc-riders-more');
  function riderAva(u) {
    return u.avatar_img && window.avatarHTML ? window.avatarHTML(u.avatar_img, 'cmp-ava cmp-ava--sm', 'loading="lazy"')
      : '<span class="cmp-ava cmp-ava--sm cmp-ava--emoji" aria-hidden="true">' + esc(u.avatar || '🚀') + '</span>';
  }
  function renderBoard() {
    if (!ridersList) return;
    const b = S.board;
    if (!b) { ridersList.innerHTML = '<li class="arc-rider-none">Loading today’s board…</li>'; return; }
    const meU = (window.AUTH && AUTH.user && AUTH.user.username) ? String(AUTH.user.username).toLowerCase() : null;
    const myG = S.guest && S.guestRound ? S.guestRound.id : null;
    const admin = !!(window.AUTH && AUTH.user && AUTH.user.admin);
    if (!b.top.length) ridersList.innerHTML = '<li class="arc-rider-none">No names up yet today. Cash out, and yours can be the first.</li>';
    else ridersList.innerHTML = b.top.map(function (r) {
      const you = r.guest ? (myG != null && r.id === myG) : !!(meU && String(r.username).toLowerCase() === meU);
      const who = r.guest
        ? '<span class="arc-rider-name">' + esc(r.name) + '</span><span class="arc-rider-tag">guest</span>'
        : '<span class="arc-rider-id">' + riderAva(r) + '<a class="arc-rider-name" href="/u/' + encodeURIComponent(r.username) + '"' + (r.accent ? ' style="color:' + esc(r.accent) + '"' : '') + '>@' + esc(r.username) + '</a></span>' + (window.ogBadge ? window.ogBadge(r.og) : '');
      const label = r.guest ? r.name + ' (guest)' : '@' + r.username;
      return '<li class="arc-rider' + (r.guest ? ' arc-rider--guest' : '') + (you ? ' is-you' : '') + '">' +
        '<span class="arc-rider-rank"><span class="sr-only">Place </span>' + r.rank + '</span>' +
        '<span class="arc-rider-who">' + who + (you ? '<span class="arc-rider-you">you</span>' : '') + '</span>' +
        '<span class="arc-rider-x">' + fx(r.x) + '×</span>' +
        (admin ? '<button class="arc-rider-rm" type="button" data-arc-rm="' + (r.guest ? 'g:' + r.id : 'u:' + esc(r.username)) + '" data-tip="Takes this name off today’s board (moderation)" aria-label="Take ' + esc(label) + ' off today’s board">✕</button>' : '') +
      '</li>';
    }).join('');
    if (ridersMore) ridersMore.textContent = b.entrants > b.top.length ? (b.entrants - b.top.length) + ' more ' + (b.entrants - b.top.length === 1 ? 'name is' : 'names are') + ' on today’s board below these.' : '';
    // the panel's "#N right now" reads the board too
    if (!S.guest && meU) { const row = b.top.find((x) => !x.guest && String(x.username).toLowerCase() === meU); S.boardRank = row ? row.rank : null; }
  }
  let boardAt = 0;
  async function loadBoard(repaintPanel) {
    try {
      S.board = await window.api('/api/arcade/board');
      boardAt = Date.now();
      renderBoard();
      if (repaintPanel && S.mode !== 'flying') renderPanel();
    } catch (e) { if (!S.board && ridersList) ridersList.innerHTML = '<li class="arc-rider-none">Couldn’t load today’s board — it tries again in a minute.</li>'; }
  }
  // a minute between reads while the page is in view (a flight in the air never waits on it)
  setInterval(function () { if (!document.hidden && Date.now() - boardAt > 55e3) loadBoard(false); }, 15e3);
  if (ridersList) ridersList.addEventListener('click', async function (e) {
    const el = e.target.closest('[data-arc-rm]');
    if (!el) return;
    const v = el.getAttribute('data-arc-rm');
    if (!confirm('Take this name off today’s Rocket Riders board?')) return;
    try {
      await window.api('/api/admin/arcade/rider', { method: 'POST', body: v.slice(0, 2) === 'g:' ? { guestId: Number(v.slice(2)) } : { username: v.slice(2) } });
      if (window.sendToast) sendToast('Taken off today’s board');
      loadBoard(true);
    } catch (err) { if (window.sendToast) sendToast('⚠️ ' + ((err && err.message) || 'That did not go through')); }
  });

  /* ---------- the guest's name, the prompt, and a member's board choice ---------- */
  const CLAIM_KEY = 'send.rrClaim';   // this tab asked to keep its guest flight: claim it as soon as the account is signed in
  async function askToKeep(then) {
    try { await window.api('/api/arcade/guest/claim', { method: 'POST', body: {} }); try { sessionStorage.setItem(CLAIM_KEY, '1'); } catch (e) {} } catch (e) { /* nothing to keep: still let them in */ }
    then();
  }
  async function submitName(form) {
    if (S.nameBusy) return;
    const input = form.querySelector('input[name="name"]');
    const name = String((input && input.value) || '').trim();
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(name)) { S.nameErr = 'A name is 3 to 24 letters, numbers, dashes or underscores.'; renderPanel(); focusName(name); return; }
    S.nameBusy = true; S.nameErr = ''; renderPanel();
    try {
      const j = await window.api('/api/arcade/guest/name', { method: 'POST', body: { name: name } });
      S.nameBusy = false;
      if (S.guestRound) S.guestRound.name = j.name || name;
      if (window.SFX) SFX.play('success');
      await loadBoard(false);
      renderPanel();
      const pr = document.getElementById('arc-prompt');
      if (pr) pr.focus();
      say('You are on today’s board as ' + name + '. Create an account to make it yours, or stay as a guest.');
    } catch (e) {
      S.nameBusy = false; S.nameErr = String((e && e.message) || 'That did not go through — try again');
      if (/already on today/i.test(S.nameErr)) { S.nameErr = ''; loadState(); return; }
      renderPanel(); focusName(name);
    }
  }
  function focusName(keep) {
    const i = document.getElementById('arc-name-in');
    if (!i) return;
    if (keep != null) i.value = keep;
    i.focus();
  }
  async function setOnBoard(on) {
    try {
      const j = await window.api('/api/arcade/board', { method: 'POST', body: { on: on } });
      S.onBoard = !!j.onBoard; S.boardRank = j.rank || null;
      if (window.SFX) SFX.play(on ? 'success' : 'off');
      say(on ? 'You are on today’s board.' : 'You are off today’s board.');
      await loadBoard(false);
      renderPanel();
    } catch (e) { if (window.sendToast) sendToast('⚠️ ' + ((e && e.message) || 'That did not go through')); }
  }
  async function unname() {
    if (!confirm('Take your name off today’s board? It can’t go back up today.')) return;
    try {
      await window.api('/api/arcade/guest/name', { method: 'POST', body: { remove: true } });
      if (S.guestRound) { S.guestRound.nameOff = true; S.guestRound.name = null; }
      say('Your name is off today’s board.');
      await loadBoard(false);
      renderPanel();
    } catch (e) { if (window.sendToast) sendToast('⚠️ ' + ((e && e.message) || 'That did not go through')); }
  }

  panel.addEventListener('submit', function (e) {
    const form = e.target.closest('[data-arc-name]');
    if (!form) return;
    e.preventDefault();
    submitName(form);
  });
  panel.addEventListener('click', function (e) {
    const el = e.target.closest('[data-arc]');
    if (!el) return;
    const what = el.getAttribute('data-arc');
    const keep = S.guest && S.guestRound && S.guestRound.name && !S.guestRound.nameOff;   // a name on the board goes with them
    if (what === 'signin' && window.AUTH && AUTH.open) { if (keep) askToKeep(function () { AUTH.open(); }); else AUTH.open(); }
    else if (what === 'join' && window.AUTH) { const go = function () { if (AUTH.startJoin) AUTH.startJoin(); else if (AUTH.open) AUTH.open(); }; if (keep) askToKeep(go); else go(); }
    else if (what === 'stay') {
      if (S.guestRound) stayedId = S.guestRound.id;
      try { if (S.guestRound) localStorage.setItem(STAY_KEY, String(S.guestRound.id)); } catch (err) {}
      try { sessionStorage.removeItem(CLAIM_KEY); } catch (err) {}
      window.api('/api/arcade/guest/claim', { method: 'POST', body: { cancel: true } }).catch(function () {});   // nobody who signs in here takes it
      renderPanel();
      const o = document.getElementById('arc-outcome'); if (o) o.focus();
      say('You are staying as a guest. Your name stays on today’s board.');
    }
    else if (what === 'unname') unname();
    else if (what === 'boardon') setOnBoard(true);
    else if (what === 'boardoff') setOnBoard(false);
    else if (what === 'retry') { S.err = ''; setMode('loading'); loadState(); }
  });

  // Space / Enter launch and cash out from anywhere on the page. The button is a real button element, so when IT has
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
  // to scroll the page would burn it without ever meaning to. Launching is the real button element's job (focus it
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
    S.guestRound = null; S.netFull = false; S.nameErr = ''; S.nameBusy = false;
    setMode('loading');
    let claim = false;
    try { claim = !!u && sessionStorage.getItem(CLAIM_KEY) === '1'; if (u) sessionStorage.removeItem(CLAIM_KEY); } catch (e) {}
    // just signed in from the prompt: the guest flight becomes this account's (the server also does this on /api/me)
    if (claim) window.api('/api/arcade/guest/claim', { method: 'POST', body: {} }).catch(function () {}).then(function () { loadBoard(false); });
    loadState();
    loadBoard(true);   // the panel's "#N right now" waits on it
  }
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(boot, boot);
  else boot();
  // A passed wallet check ends in AUTH.refresh(), which announces itself as points:changed (not auth:change,
  // and boot() would ignore a same-user auth:change anyway). Only the gated state listens, so nothing else re-loads.
  document.addEventListener('points:changed', function () {
    if (S.mode !== 'needsproof') return;
    S.proof = null; setMode('loading'); loadState();
  });
  document.addEventListener('auth:change', boot);
  // the stage can be measured at 0 width before first layout / webfont settle — repaint the idle scene once more
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { if (!running) paintIdle(); });
  addEventListener('load', function () { if (!running) paintIdle(); });
  // a stage booted inside a hidden tab/section measures 0 wide, fit() bails, and nothing repaints until a window
  // resize — watch the stage itself so its first real layout (or a later reveal) paints the idle scene
  try {
    if (window.ResizeObserver) new ResizeObserver(function (entries) {
      const r = entries[0] && entries[0].contentRect;
      if (r && r.width && !running) paintIdle();
    }).observe(stage);
  } catch (err) { /* no ResizeObserver: the load/resize repaints above still cover the visible case */ }
})();
