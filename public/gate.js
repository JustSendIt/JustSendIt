/* ===== The door =========================================================================
 * Synthwave screen, a holographic ticket, a code, then the terms. Self-contained: this runs
 * for someone who has never been inside, so it depends on nothing else the site defines.
 *
 * The read-gate on the terms is honest about what it can and cannot know. It measures that
 * the text was scrolled to the end, which is a real signal that it was put in front of
 * someone — it is not a claim that they read it, and the copy never says it is.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, opts) {
    const o = opts || {};
    const res = await fetch(path, {
      method: o.method || 'GET',
      credentials: 'same-origin',
      headers: o.body ? { 'Content-Type': 'application/json' } : {},
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || ('request failed (' + res.status + ')'));
    return j;
  }

  /* ---------- the screen: matrix rain over a synthwave horizon ---------- */
  (function matrix() {
    const cv = $('gate-bg'); if (!cv) return;
    const ctx = cv.getContext('2d', { alpha: true });
    if (!ctx) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const GLYPHS = '$GWC0123456789ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ₿◆▲';
    let cols = [], w = 0, h = 0, dpr = 1, fs = 16;

    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      // from the viewport, not clientWidth: a canvas carries an intrinsic 300x150, and if the CSS has not
      // resolved when this first runs, clientWidth reports that instead of the screen and the rain ends up
      // painting into a small box in the corner.
      w = window.innerWidth || document.documentElement.clientWidth || 0;
      h = window.innerHeight || document.documentElement.clientHeight || 0;
      if (!w || !h) return;
      cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fs = w < 560 ? 13 : 16;
      const n = Math.ceil(w / fs);
      cols = new Array(n).fill(0).map(() => ({ y: Math.random() * -h, sp: 0.4 + Math.random() * 0.9 }));
    }
    function frame() {
      // fade rather than clear: the trail IS the effect
      ctx.fillStyle = 'rgba(7,3,18,0.11)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = '700 ' + fs + 'px ui-monospace, Menlo, monospace';
      ctx.textBaseline = 'top';
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        const x = i * fs;
        // the leading glyph is bright, the tail is $GWC green
        ctx.fillStyle = 'rgba(180,255,43,0.92)';
        ctx.fillText(ch, x, c.y);
        ctx.fillStyle = 'rgba(142,224,0,0.32)';
        ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], x, c.y - fs);
        c.y += c.sp * fs * 0.55;
        if (c.y > h + fs * 2 && Math.random() > 0.975) c.y = -fs * 4;
      }
      // the horizon grid, drawn over the rain so it reads as "in front"
      const hy = h * 0.76;
      ctx.strokeStyle = 'rgba(255,46,136,0.30)'; ctx.lineWidth = 1;
      for (let g = 1; g <= 14; g++) {
        const y = hy + Math.pow(g / 14, 2.1) * (h - hy);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      for (let g = -12; g <= 12; g++) {
        ctx.beginPath(); ctx.moveTo(w / 2 + g * (w / 14), hy); ctx.lineTo(w / 2 + g * w * 0.42, h); ctx.stroke();
      }
      raf = requestAnimationFrame(frame);
    }
    let raf = 0;
    size();
    addEventListener('resize', () => { cancelAnimationFrame(raf); size(); if (!reduce) raf = requestAnimationFrame(frame); else still(); });
    function still() { ctx.fillStyle = '#070312'; ctx.fillRect(0, 0, w, h); }
    if (reduce) still(); else raf = requestAnimationFrame(frame);
    // never animate a background nobody is looking at
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reduce) raf = requestAnimationFrame(frame);
    });
  })();

  /* ---------- the ticket: tilt, barcode, countdown ---------- */
  const ticket = $('ticket');
  if (ticket && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    ticket.addEventListener('pointermove', (e) => {
      const r = ticket.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      ticket.style.transform = 'rotateY(' + (px * 9).toFixed(2) + 'deg) rotateX(' + (-py * 7).toFixed(2) + 'deg) translateY(-4px)';
      ticket.style.animationPlayState = 'paused';
    });
    ticket.addEventListener('pointerleave', () => { ticket.style.transform = ''; ticket.style.animationPlayState = ''; });
  }

  // a barcode that encodes the ticket number, so two tickets never look identical
  function bars(seed) {
    const el = $('tk-bars'); if (!el) return;
    let s = 0; const str = String(seed || 'SEND');
    for (let i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) >>> 0;
    let html = '';
    for (let i = 0; i < 26; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      const tall = 12 + ((s >>> 8) % 18);
      const wide = ((s >>> 3) % 3) === 0 ? 3 : 2;
      html += '<i style="height:' + tall + 'px;width:' + wide + 'px"></i>';
    }
    el.innerHTML = html;
  }

  const DAY = 86400000;
  function fmtLeft(ms) {
    if (ms == null) return '—';
    if (ms <= 0) return 'closed';
    const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }
  let goldEndsAt = null, goldStartedAt = null;
  function paintCountdown() {
    const v = $('tk-launch-v'), rocket = $('tk-rocket');
    if (!v) return;
    if (goldEndsAt == null) { v.textContent = '—'; return; }
    const left = goldEndsAt - Date.now();
    v.textContent = fmtLeft(left);
    if (left <= 0) { $('tk-launch-k').textContent = '🥇 Gold OG has closed'; }
    if (rocket && goldStartedAt) {
      const span = goldEndsAt - goldStartedAt;
      const gone = Math.min(1, Math.max(0, (Date.now() - goldStartedAt) / span));
      rocket.style.left = (gone * 100).toFixed(1) + '%';
    }
  }

  /* ---------- state ---------- */
  let state = { access: false, redeemed: false, tosAccepted: false, signedIn: false, ticket: null };

  function paintTicket() {
    const t = state.ticket;
    bars(t ? 'SEND-' + t.number : 'SEND-UNCLAIMED');
    if (!t) { $('tk-serial').textContent = 'SEND·RH · UNCLAIMED'; return; }
    $('tk-name').textContent = '@' + t.username;
    $('tk-role').textContent = t.invitedBy ? 'Invited by @' + t.invitedBy : 'Founding sender';
    $('tk-num').textContent = '#' + t.number.toLocaleString('en-US');
    $('tk-stub-n').textContent = '#' + t.number;
    $('tk-inv').textContent = t.codesLeft + ' of ' + t.codes.length;
    $('tk-serial').textContent = 'SEND·RH · ' + new Date(t.joinedAt).toISOString().slice(0, 10);
    $('tk-head').innerHTML = 'Ticket to <span class="hl">Send</span>';
    $('tk-admit').textContent = 'Admit one';
    const face = $('tk-face');
    if (t.avatarImg) {
      face.innerHTML = /\.(mp4|webm)$/i.test(t.avatarImg)
        ? '<video src="' + esc(t.avatarImg) + '" muted loop autoplay playsinline></video>'
        : '<img src="' + esc(t.avatarImg) + '" alt="">';
    } else face.textContent = t.avatar || '🚀';
    if (t.goldEndsAt != null) { goldEndsAt = t.goldEndsAt; paintCountdown(); }
  }

  function paintCta() {
    const cta = $('tk-cta'), actions = $('gate-actions');
    if (state.access) {
      cta.innerHTML = '✅ <b>You\'re in.</b> This is your ticket.';
      actions.innerHTML = '<a class="g-btn g-btn-primary" href="/" style="text-decoration:none;display:inline-flex;align-items:center;">Enter the site 🚀</a>' +
        (state.signedIn ? '<button class="g-btn g-btn-ghost" id="btn-invites" type="button">My invite codes 🎟️</button>' : '') +
        '<button class="g-btn g-btn-ghost" id="btn-save" type="button">Download my ticket 📥</button>';
      const bi = $('btn-invites'); if (bi) bi.addEventListener('click', showInvites);
      const bs = $('btn-save'); if (bs) bs.addEventListener('click', downloadTicket);
    } else if (state.redeemed) {
      cta.innerHTML = '📜 <b>One step left</b> — the terms.';
      actions.innerHTML = '<button class="g-btn g-btn-primary" id="btn-tos" type="button">Read the terms 📜</button>';
      $('btn-tos').addEventListener('click', openTos);
    }
  }

  async function loadState() {
    try {
      state = await api('/api/gate/state');
      if (state.ticket) paintTicket(); else bars('SEND-UNCLAIMED');
      paintCta();
      if (goldEndsAt == null) {
        try {
          const c = await api('/api/og/campaign');
          if (c && c.closes && c.closes.gold) {
            goldEndsAt = c.closes.gold;
            goldStartedAt = goldEndsAt - 30 * DAY;   // the Gold window is one 30-day month
            paintCountdown();
          }
        } catch {}
      }
    } catch { bars('SEND-UNCLAIMED'); }
  }

  /* ---------- modals ---------- */
  let lastFocus = null;
  function open(ov) {
    lastFocus = document.activeElement;
    ov.hidden = false; document.body.style.overflow = 'hidden';
    const f = ov.querySelector('input:not([disabled]), button:not([disabled])'); if (f) f.focus();
  }
  function close(ov) {
    ov.hidden = true; document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch {} }
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const co = $('code-overlay'); if (!co.hidden) close(co);   // the terms modal is deliberately not escapable
  });

  /* ---------- code ---------- */
  function openCode() { $('code-err').textContent = ''; open($('code-overlay')); }
  if (ticket) ticket.addEventListener('click', () => { if (state.access) downloadTicket(); else openCode(); });
  $('btn-redeem').addEventListener('click', openCode);
  $('code-x').addEventListener('click', () => close($('code-overlay')));
  $('code-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') redeem(); });

  async function redeem() {
    const err = $('code-err'), go = $('code-go');
    const code = $('code-in').value.trim();
    if (!code) { err.textContent = 'Enter the code you were given.'; return; }
    go.disabled = true; err.className = 'g-err'; err.textContent = 'Checking…';
    try {
      const j = await api('/api/gate/redeem', { method: 'POST', body: { code } });
      err.className = 'g-err g-ok';
      err.textContent = j.already ? 'You already have a ticket.' : '🎟️ Ticket accepted.';
      state.redeemed = true; state.tosAccepted = !!j.tosAccepted;
      setTimeout(() => { close($('code-overlay')); if (state.tosAccepted) location.href = '/'; else openTos(); }, 550);
    } catch (e) {
      err.className = 'g-err'; err.textContent = '⚠️ ' + e.message;
    } finally { go.disabled = false; }
  }
  $('code-go').addEventListener('click', redeem);

  /* ---------- terms ---------- */
  let tosLoaded = false;
  async function openTos() {
    const box = $('tos-scroll');
    if (!tosLoaded) {
      box.innerHTML = '<p>Loading the terms…</p>';
      try {
        const html = await (await fetch('terms.html', { credentials: 'same-origin' })).text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const body = doc.getElementById('terms-body');
        box.innerHTML = body ? body.innerHTML : '<p>Could not load the terms. <a href="terms.html">Open them here</a>.</p>';
        tosLoaded = true;
      } catch { box.innerHTML = '<p>Could not load the terms. <a href="terms.html">Open them in a new tab</a> and come back.</p>'; }
    }
    open($('tos-overlay'));
    requestAnimationFrame(checkRead);
  }

  /* The unlock. Two conditions, both honest:
     - the text has been scrolled to within 24px of the end, and
     - at least MIN_DWELL has passed since it opened, so a flick of the scrollbar is not "read".
     A short document that needs no scrolling counts as read once the dwell passes — refusing to
     unlock a box on a page with nothing below the fold would just be a puzzle, not a protection. */
  const MIN_DWELL = 12000;
  let openedAt = 0, reachedEnd = false;
  function checkRead() {
    const box = $('tos-scroll'), fill = $('read-fill'), pct = $('read-pct');
    if (!box) return;
    if (!openedAt) openedAt = Date.now();
    const max = Math.max(1, box.scrollHeight - box.clientHeight);
    const seen = box.scrollHeight <= box.clientHeight + 8 ? 1 : Math.min(1, (box.scrollTop + box.clientHeight + 24) / box.scrollHeight);
    if (box.scrollTop >= max - 24 || box.scrollHeight <= box.clientHeight + 8) reachedEnd = true;
    fill.style.width = Math.round(seen * 100) + '%';
    const waited = Date.now() - openedAt >= MIN_DWELL;
    const ok = reachedEnd && waited;
    pct.textContent = ok ? 'Read to the end ✅' : Math.round(seen * 100) + '% read';
    const cb = $('agree'), lab = $('agree-label'), txt = $('agree-text');
    cb.disabled = !ok;
    lab.classList.toggle('is-locked', !ok);
    txt.textContent = ok
      ? 'I have read these terms. I understand this is entertainment, not financial advice, that crypto is extremely volatile, and that I can lose everything I put in.'
      : (reachedEnd ? 'Nearly — take a few more seconds with it.' : 'Scroll to the end to unlock this box.');
    if (!ok) cb.checked = false;
    $('tos-go').disabled = !(ok && cb.checked && $('age18').checked);
  }
  $('tos-scroll').addEventListener('scroll', checkRead);
  const bothTicked = () => $('agree').checked && $('age18').checked && !$('agree').disabled;
  $('agree').addEventListener('change', () => { $('tos-go').disabled = !bothTicked(); });
  $('age18').addEventListener('change', () => { $('tos-go').disabled = !bothTicked(); });
  setInterval(() => { if (!$('tos-overlay').hidden) checkRead(); }, 1000);

  $('tos-go').addEventListener('click', async () => {
    const err = $('tos-err'), go = $('tos-go');
    if (!$('agree').checked) { err.textContent = 'Tick the box to confirm you have read the terms.'; return; }
    if (!$('age18').checked) { err.textContent = 'You must confirm you are 18 or older.'; return; }
    go.disabled = true; err.textContent = '';
    try {
      await api('/api/gate/accept', { method: 'POST', body: { version: state.tosVersion, age18: true } });
      location.href = '/';
    } catch (e) { err.textContent = '⚠️ ' + e.message; go.disabled = false; }
  });

  /* ---------- invites ---------- */
  async function showInvites() {
    const ov = $('code-overlay');
    $('code-h').textContent = '🎟️ Your invite codes';
    const body = ov.querySelector('.g-modal-body');
    const foot = ov.querySelector('.g-modal-foot');
    body.innerHTML = '<p class="g-note">Loading…</p>';
    foot.innerHTML = '<span class="g-note">Tap a code to copy it.</span>';
    open(ov);
    try {
      const j = await api('/api/gate/invites');
      const t = j.ticket;
      state.ticket = t; paintTicket();
      body.innerHTML = '<p class="g-note">Ten codes, <b>one use each</b>. Whoever redeems one gets ten of their own — that is how the room fills up.</p>' +
        '<ul class="g-codes">' + t.codes.map(c =>
          '<li><button class="g-code' + (c.used ? ' is-used' : '') + '" type="button" data-c="' + esc(c.code) + '"' + (c.used ? ' disabled' : '') + '>' +
          esc(c.code) + '<span class="c-tag">' + (c.used ? 'used' : 'copy') + '</span></button></li>').join('') +
        '</ul>';
      body.querySelectorAll('.g-code:not(.is-used)').forEach(b => b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(b.dataset.c); b.querySelector('.c-tag').textContent = 'copied'; }
        catch { b.querySelector('.c-tag').textContent = 'select it'; }
      }));
    } catch (e) { body.innerHTML = '<p class="g-err">⚠️ ' + esc(e.message) + '</p>'; }
  }

  /* ---------- download the ticket as a picture ----------
     Painted straight onto a canvas rather than screenshotting the DOM: no library, exact
     control over the output size, and it produces the same image on every browser. */
  async function downloadTicket() {
    const t = state.ticket;
    if (!t) { openCode(); return; }
    const W = 1200, H = 630;   // the size every social card is cropped from
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');

    const grd = c.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#1b1036'); grd.addColorStop(0.5, '#2a1250'); grd.addColorStop(1, '#160d2c');
    c.fillStyle = grd; c.fillRect(0, 0, W, H);
    // horizon
    c.strokeStyle = 'rgba(255,46,136,0.35)'; c.lineWidth = 2;
    for (let g = 1; g <= 10; g++) { const y = H * 0.62 + Math.pow(g / 10, 2) * H * 0.38; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    for (let g = -8; g <= 8; g++) { c.beginPath(); c.moveTo(W / 2 + g * (W / 10), H * 0.62); c.lineTo(W / 2 + g * W * 0.5, H); c.stroke(); }
    // holographic sweep
    const hol = c.createLinearGradient(0, H, W, 0);
    hol.addColorStop(0.2, 'rgba(56,232,255,0)'); hol.addColorStop(0.45, 'rgba(56,232,255,0.16)');
    hol.addColorStop(0.55, 'rgba(255,46,136,0.18)'); hol.addColorStop(0.75, 'rgba(142,224,0,0)');
    c.fillStyle = hol; c.fillRect(0, 0, W, H);
    // frame
    c.strokeStyle = 'rgba(180,255,43,0.75)'; c.lineWidth = 4; c.strokeRect(26, 26, W - 52, H - 52);
    // perforation
    c.setLineDash([12, 10]); c.strokeStyle = 'rgba(255,255,255,0.42)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(W - 300, 30); c.lineTo(W - 300, H - 30); c.stroke(); c.setLineDash([]);

    c.fillStyle = '#b4ff2b'; c.font = '800 30px Rubik, system-ui, sans-serif';
    c.fillText('$GWC', 64, 100);
    c.fillStyle = 'rgba(255,255,255,0.78)'; c.font = '700 20px Rubik, system-ui, sans-serif';
    c.fillText('IS YOUR TICKET', 152, 100);

    c.fillStyle = '#ffffff'; c.font = '800 74px Rubik, system-ui, sans-serif';
    c.fillText('Ticket to Send', 64, 196);

    // holder picture (best effort — a failed image must not stop the download)
    let faceDrawn = false;
    if (t.avatarImg && !/\.(mp4|webm)$/i.test(t.avatarImg)) {
      try {
        const img = await new Promise((res, rej) => {
          const i = new Image(); i.crossOrigin = 'anonymous';
          i.onload = () => res(i); i.onerror = rej; i.src = t.avatarImg;
        });
        c.save(); c.beginPath(); c.roundRect(64, 250, 132, 132, 20); c.clip();
        c.drawImage(img, 64, 250, 132, 132); c.restore();
        c.strokeStyle = '#8ee000'; c.lineWidth = 4;
        c.beginPath(); c.roundRect(64, 250, 132, 132, 20); c.stroke();
        faceDrawn = true;
      } catch {}
    }
    if (!faceDrawn) {
      c.fillStyle = 'rgba(255,255,255,0.09)';
      c.beginPath(); c.roundRect(64, 250, 132, 132, 20); c.fill();
      c.font = '80px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText(t.avatar || '🚀', 130, 348); c.textAlign = 'left';
    }

    c.fillStyle = '#ffffff'; c.font = '800 44px Rubik, system-ui, sans-serif';
    c.fillText('@' + t.username, 224, 300);
    c.fillStyle = '#38e8ff'; c.font = '700 22px Rubik, system-ui, sans-serif';
    c.fillText(t.invitedBy ? ('INVITED BY @' + t.invitedBy.toUpperCase()) : 'FOUNDING SENDER', 224, 336);
    c.fillStyle = 'rgba(255,255,255,0.62)'; c.font = '600 22px Rubik, system-ui, sans-serif';
    c.fillText('Joined ' + new Date(t.joinedAt).toISOString().slice(0, 10), 224, 372);

    c.fillStyle = 'rgba(255,255,255,0.55)'; c.font = '800 18px Rubik, system-ui, sans-serif';
    c.fillText('ENTERTAINMENT ONLY · NOT FINANCIAL ADVICE · NOT AFFILIATED WITH ROBINHOOD MARKETS, INC.', 64, H - 62);
    c.fillStyle = 'rgba(255,255,255,0.8)'; c.font = '700 20px Rubik, system-ui, sans-serif';
    c.fillText('sendrh.com', 64, H - 96);

    // stub
    c.textAlign = 'center';
    const sx = W - 150;
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.font = '800 20px Rubik, system-ui, sans-serif';
    c.fillText('IN LINE TO SEND', sx, 150);
    c.fillStyle = '#b4ff2b'; c.font = '800 110px Rubik, system-ui, sans-serif';
    c.fillText('#' + t.number, sx, 260);
    c.fillStyle = 'rgba(255,255,255,0.5)'; c.font = '700 18px Rubik, system-ui, sans-serif';
    c.fillText('ADMIT ONE', sx, 320);
    // barcode
    let s = 0; const str = 'SEND-' + t.number;
    for (let i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) >>> 0;
    let bx = sx - 110;
    c.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 34; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      const bw = ((s >>> 3) % 3) === 0 ? 5 : 3;
      const bh = 40 + ((s >>> 8) % 40);
      c.fillRect(bx, 380, bw, bh); bx += bw + 3;
      if (bx > sx + 110) break;
    }
    c.textAlign = 'left';

    const name = 'send-ticket-' + t.number + '.png';
    cv.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  }

  setInterval(paintCountdown, 30000);
  loadState();
})();
