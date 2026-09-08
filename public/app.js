/* ===== $Send fun engine: confetti, toasts, copy, reveals ===== */
(function () {
  // --- confetti canvas ---
  const canvas = document.createElement('canvas');
  canvas.id = 'fx-canvas';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let parts = [];
  function fit() { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); }
  fit(); addEventListener('resize', fit);

  const COLORS = ['#b4ff2b', '#8ee000', '#ffb340', '#00C805', '#ffffff'];
  const EMOJI = ['🚀', '💸', '🪙', '💰', '🔥'];

  function burst(x, y, opts = {}) {
    if (window.__confettiEnabled === false) return;
    if (document.hidden) return; // don't queue particles the paused rAF can't animate until refocus
    try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch {} // global reduced-motion gate for every call site
    const n = opts.count || 26;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 7;
      parts.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3,
        rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.3,
        life: 1, decay: 0.012 + Math.random() * 0.012,
        size: 5 + Math.random() * 6,
        emoji: Math.random() < (opts.emojiRatio ?? 0.22) ? EMOJI[(Math.random() * EMOJI.length) | 0] : null,
        color: COLORS[(Math.random() * COLORS.length) | 0],
      });
    }
    if (!running) { running = true; requestAnimationFrame(tick); }
  }

  let running = false;
  function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(p => p.life > 0);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.vx *= 0.99; p.rot += p.vr; p.life -= p.decay;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      if (p.emoji) { ctx.font = `${p.size + 8}px serif`; ctx.textAlign = 'center'; ctx.fillText(p.emoji, 0, 0); }
      else { ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); }
      ctx.restore();
    }
    if (parts.length) requestAnimationFrame(tick); else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  }
  window.sendConfetti = burst;

  // any element with data-confetti bursts on click
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-confetti], .btn-primary, .btn-gold, .btn-rh');
    if (el) burst(e.clientX || innerWidth / 2, e.clientY || innerHeight / 2);
  });

  // --- toasts ---
  const zone = document.createElement('div');
  zone.id = 'toast-zone';
  zone.setAttribute('role', 'status');
  zone.setAttribute('aria-live', 'polite');
  zone.setAttribute('aria-atomic', 'true');
  document.body.appendChild(zone);
  /* Shared OG badge — rendered next to an OG's username everywhere. Hover shows a simple explanation
     (native title). OG = verified early buyer of BOTH $Send and $GWC who still holds both, in one of
     three entry windows: gold (first month, ×10), silver (the two months after, ×5), bronze (the nine
     months after that, ×3). Lost only on a full sell-out.

     The argument is the TIER (0-3), which is what every `og` field now carries from the server. It
     used to be a boolean and every label here was hardcoded to gold's "10×" — passing a silver holder
     through that printed a multiplier they are not paid, in the badge, the tooltip AND the screen
     reader label. Nothing about the number is hardcoded any more; unknown values render nothing
     rather than guessing a tier. 0 is falsy, so every existing `if (u.og)` call site still gates
     correctly with no change. */
  window.OG_TIERS = {
    3: { name: 'Gold', mult: 10, when: 'in the first month' },
    2: { name: 'Silver', mult: 5, when: 'in the two months after the gold window closed' },
    1: { name: 'Bronze', mult: 3, when: 'in the nine months after the silver window closed' },
  };
  window.ogTip = function (tier) {
    var t = window.OG_TIERS[tier];
    if (!t) return '';
    return 'OG ' + t.name + ' — bought BOTH $Send and $GWC ' + t.when + ' and still holds both (checked on-chain). '
      + 'Permanent badge + a ' + t.mult + '× Send Power bonus on everything. Lost if they sell out of either.';
  };
  // kept for anything still reading the old global; gold is the tier it always described
  window.OG_TIP = window.ogTip(3);
  window.ogBadge = function (og) {
    // native title = hover explanation (browser-positioned, never clips); aria-label = screen readers.
    // No tabindex: many badges on a leaderboard shouldn't each become an empty keyboard tab-stop.
    var tier = Number(og) || 0;
    var t = window.OG_TIERS[tier];
    if (!t) return '';
    // every tier keeps the base `og-badge` class: profile.js, wall.js and upage.js each find and
    // remove a stale badge by that selector before re-inserting, and a variant-only class would
    // leave them behind to duplicate.
    return '<span class="og-badge og-badge--' + t.name.toLowerCase() + '" role="img" aria-label="OG ' + t.name
      + ', verified early buyer with a ' + t.mult + ' times Send Power bonus" title="' + window.ogTip(tier) + '">OG</span>';
  };

  /* ===== Shared avatar renderer =====================================================================
     A profile picture can be a still image, an animated GIF, or a short video (mp4/webm). A GIF animates
     inside a plain <img> — nothing else needed. A video cannot load into an <img> at all, which is why a
     video avatar silently fell back to the emoji everywhere except the profile page's own preview. So the
     element is chosen by the file, in ONE place, and every site that shows a profile picture goes through
     it. Videos are muted, looped and inline — the only combination browsers will autoplay — never autoplay
     under reduced motion, and pause while the tab is hidden so a wall full of them costs nothing unseen. */
  const AVATAR_VIDEO = /\.(mp4|webm)(\?.*)?$/i;
  window.avatarHTML = function (src, cls, attrs) {
    if (!src) return '';
    const s = String(src).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const a = attrs ? ' ' + attrs : '';
    if (AVATAR_VIDEO.test(String(src))) {
      const auto = (window.prefersReduced && window.prefersReduced()) ? '' : ' autoplay';
      return '<video class="' + cls + '" src="' + s + '" muted loop playsinline preload="metadata" aria-hidden="true" data-avatar-video="1"' + auto + a + '></video>';
    }
    return '<img class="' + cls + '" src="' + s + '" alt=""' + a + '>';
  };
  // DOM form, for the places that build elements rather than strings (the wall header)
  window.avatarNode = function (src, cls, attrs) {
    const t = document.createElement('template'); t.innerHTML = window.avatarHTML(src, cls, attrs);
    const n = t.content.firstElementChild;
    if (n && n.tagName === 'VIDEO') n.muted = true; // the property as well as the attribute — autoplay policy checks the property
    return n;
  };
  // Start playback ourselves once a frame is ready. The `autoplay` attribute alone was not enough:
  // measured in-app, every avatar video reached readyState 4 and stayed paused. Media events do not
  // bubble, but a CAPTURING listener on the document still sees them, so one listener covers every
  // avatar any page ever inserts via innerHTML — no per-site wiring, no observer. Reduced motion is
  // honoured by never calling play(); the first frame simply shows as a still.
  const avatarWantsMotion = () => !(window.prefersReduced && window.prefersReduced());
  document.addEventListener('loadeddata', (e) => {
    const v = e.target;
    if (!v || v.tagName !== 'VIDEO' || !v.hasAttribute('data-avatar-video')) return;
    v.muted = true; // the property, not only the attribute — autoplay policy checks the property
    if (avatarWantsMotion() && v.paused && !document.hidden) v.play().catch(() => {});
  }, true);
  document.addEventListener('visibilitychange', () => {
    document.querySelectorAll('video[data-avatar-video]').forEach(v => { try { if (document.hidden) v.pause(); else if (avatarWantsMotion()) v.play().catch(() => {}); } catch {} });
  });

  window.sendToast = function (msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    zone.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  };

  // --- copy helper (elements with data-copy) ---
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-copy]');
    if (!el) return;
    e.stopPropagation();
    if (el.closest('summary')) e.preventDefault(); // a copy button inside a <summary> must not also toggle the row open/closed
    try {
      await navigator.clipboard.writeText(el.getAttribute('data-copy'));
      sendToast('Copied! 🚀 Now go send it.');
      burst(e.clientX, e.clientY, { count: 18, emojiRatio: 0.5 });
    } catch { sendToast('Copy failed — select it manually 😅'); }
  });

  // --- scroll reveals ---
  const io = new IntersectionObserver((ents) => {
    ents.forEach(en => { if (en.isIntersecting) { en.target.classList.add('shown'); io.unobserve(en.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  // --- logo easter egg: click logo → mega send ---
  document.querySelectorAll('.hero-logo, .nav-logo img').forEach(el => {
    el.addEventListener('click', (e) => {
      burst(e.clientX, e.clientY, { count: 60, emojiRatio: 0.4 });
      sendToast('JUST SEND IT! 🚀🚀🚀');
    });
  });

  /* ===== shared helpers reused by entry.js / compose.js / tour.js ===== */

  // reduced-motion check, safe in private mode / old browsers
  window.prefersReduced = function () {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  };

  // trap Tab focus inside a container; returns a release() to remove the trap
  window.trapFocus = function (container) {
    const SEL = 'a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])';
    function onKey(e) {
      if (e.key !== 'Tab') return;
      const items = [...container.querySelectorAll(SEL)].filter(el => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!container.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
    container.addEventListener('keydown', onKey);
    return () => container.removeEventListener('keydown', onKey);
  };

  // client-side mirror of the server level curve (display only; server is authoritative).
  // Exponential curve, no cap — must match server xpForLevel/levelForXp exactly.
  window.levelForXp = function (xp) {
    xp = Math.max(0, Number(xp) || 0);
    let L = 1, s = 0;
    while (L < 10000) {
      s += Math.floor(L + 300 * Math.pow(2, L / 7));
      if (Math.floor(s / 4) > xp) break;
      L++;
    }
    return L;
  };

  // visual feedback when you earn points: a floating "+N 🪙", a live nav-badge bump, and a level-up party
  window.showPoints = function (n, x, y) {
    n = Math.round(Number(n) || 0);
    if (n <= 0) return;
    let leveledTo = null;
    if (window.AUTH && AUTH.user) {
      const before = window.levelForXp(AUTH.user.points || 0);
      AUTH.user.points = (AUTH.user.points || 0) + n;
      const after = window.levelForXp(AUTH.user.points);
      AUTH.user.level = after;
      if (after > before) leveledTo = after;
    }
    document.dispatchEvent(new CustomEvent('points:changed'));
    if (!(window.prefersReduced && window.prefersReduced())) {
      const el = document.createElement('div');
      el.className = 'points-pop';
      el.textContent = '+' + n.toLocaleString('en-US') + ' 🪙';
      el.style.left = (x != null ? x : innerWidth - 96) + 'px';
      el.style.top = (y != null ? y : 64) + 'px';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1300);
    }
    if (leveledTo) {
      if (window.sendToast) sendToast('LEVEL UP! You hit Level ' + leveledTo + ' 🎉');
      if (window.sendConfetti) sendConfetti(innerWidth / 2, innerHeight / 3, { count: 70, emojiRatio: 0.5 });
    }
  };

  /* ===== Media pipeline: client-side compression so ANY photo/GIF fits, then a streaming upload =====
   * Images are re-encoded (downscaled + quality-adapted, WebP where supported) to a small target; GIFs pass through
   * untouched up to their cap (a canvas can't recompress an animated GIF — it only sees the first frame);
   * videos pass through up to the (now much larger) cap. The result is streamed to /api/upload (raw binary, no
   * base64) and the returned /uploads URL is what the post carries — keeping big media off the JSON body. */
  const toast = (m) => { if (window.sendToast) sendToast(m); };
  const IMG_TARGET = 1.6 * 1024 * 1024, IMG_MAXDIM = 1920;     // compress images to ≤ ~1.6MB, ≤ 1920px (keeps the feed fast)
  const GIF_HARD = 25 * 1024 * 1024, VIDEO_HARD = 64 * 1024 * 1024;
  let _webp;
  function webpOk() { if (_webp === undefined) { try { _webp = document.createElement('canvas').toDataURL('image/webp').indexOf('data:image/webp') === 0; } catch { _webp = false; } } return _webp; }
  async function compressImage(file) {
    let bmp = null; try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
    let src = bmp;
    if (!src) { const u = URL.createObjectURL(file); src = await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = u; }); URL.revokeObjectURL(u); if (!src) return null; } // revoke after load — the decoded image is retained, so drawImage still works
    const iw = src.width || src.naturalWidth, ih = src.height || src.naturalHeight;
    const type = webpOk() ? 'image/webp' : 'image/jpeg';
    const s0 = Math.min(1, IMG_MAXDIM / Math.max(iw, ih));
    let w = Math.max(1, Math.round(iw * s0)), h = Math.max(1, Math.round(ih * s0)), quality = 0.9, blob = null;
    const canvas = document.createElement('canvas');
    for (let a = 0; a < 9; a++) {                                 // adapt: drop quality first, then dimensions, until under target
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(src, 0, 0, w, h);
      blob = await new Promise(r => canvas.toBlob(r, type, quality));
      if (!blob || blob.size <= IMG_TARGET) break;
      if (quality > 0.5) quality = Math.max(0.5, quality - 0.12);
      else if (w > 480 && h > 480) { w = Math.round(w * 0.82); h = Math.round(h * 0.82); quality = 0.75; }
      else break;
    }
    if (bmp && bmp.close) bmp.close();
    return blob ? { blob, kind: 'image', mime: blob.type || type } : null;
  }
  // prepMedia: returns { blob, kind, mime } — compressed/converted so it fits — or null (with a toast) if it can't.
  window.prepMedia = async function (file) {
    if (!file) return null;
    const type = (file.type || '').toLowerCase();
    const isGif = type === 'image/gif';
    const isVideo = type === 'video/mp4' || type === 'video/webm';
    const isImg = type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
    if (!isGif && !isVideo && !isImg) { toast(type.indexOf('video/') === 0 ? 'That video format isn’t supported — use MP4 or WebM 🎬' : 'Use a JPG, PNG, WebP, GIF, MP4 or WebM 🖼️'); return null; }
    try {
      if (isImg) {
        if (file.size > 80 * 1024 * 1024) { toast('That image is enormous — under 80MB please'); return null; }
        const r = await compressImage(file);
        if (!r) toast('Couldn’t process that image — try a different one');
        return r;
      }
      if (isGif) {
        // pass through untouched: a canvas only ever sees an animated GIF's FIRST frame, so "converting" one to video froze it
        if (file.size <= GIF_HARD) return { blob: file, kind: 'gif', mime: 'image/gif' };
        toast('That GIF’s too big — keep it under 25MB or make it shorter'); return null;
      }
      if (file.size <= VIDEO_HARD) return { blob: file, kind: 'video', mime: type };
      toast('Video’s too big — keep it under 64MB (trim it or lower the resolution) 🎬'); return null;
    } catch { toast('Couldn’t process that file — try another'); return null; }
  };
  // uploadMedia: stream a Blob to /api/upload (raw binary, upload-progress via XHR) → { url, kind } or null.
  window.uploadMedia = function (blob, mime, onProgress) {
    return new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        let done = false, stall = null;
        const settle = (v) => { if (done) return; done = true; if (stall) clearTimeout(stall); resolve(v); };
        // Stall timer (rearmed on every progress tick), NOT a total timeout — a legitimately slow but progressing
        // 64MB upload is never killed, but a dead socket that fires neither onload nor onerror can't wedge the composer.
        const arm = () => { if (stall) clearTimeout(stall); stall = setTimeout(() => { try { xhr.abort(); } catch {} toast('⚠️ upload stalled — check your connection and try again'); settle(null); }, 30000); };
        xhr.open('POST', '/api/upload', true); xhr.withCredentials = true;
        xhr.setRequestHeader('Content-Type', mime);
        if (xhr.upload) xhr.upload.onprogress = (e) => { arm(); if (onProgress && e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
        xhr.onload = () => { let j = {}; try { j = JSON.parse(xhr.responseText || '{}'); } catch {} if (xhr.status === 200 && j.url) settle(j); else { toast('⚠️ ' + (j.error || 'upload failed — try again')); settle(null); } };
        xhr.onerror = () => { toast('⚠️ upload failed — check your connection'); settle(null); };
        xhr.onabort = () => settle(null);
        arm();
        xhr.send(blob);
      } catch { resolve(null); }
    });
  };
  // attachMedia: the one call a composer makes — compress/convert, show the preview, upload. Returns { url, kind } or null.
  // onStatus(msg) receives human-readable stage text ('Optimizing…', 'Uploading… N%', '' when idle) so a composer can
  // surface the WHOLE prep+upload window (image compression can run for seconds before the first byte).
  window.attachMedia = async function (file, previewEl, onClear, onStatus) {
    const say = (m) => { if (typeof onStatus === 'function') onStatus(m); };
    say('Optimizing… ⏳');
    const m = await window.prepMedia(file);
    if (!m) { say(''); return null; }
    window.setMediaPreview(previewEl, URL.createObjectURL(m.blob), m.kind, onClear);
    const myUrl = previewEl && previewEl._blobUrl; // remember the preview WE set
    say('Uploading… 0%');
    const up = await window.uploadMedia(m.blob, m.mime, pct => say('Uploading… ' + pct + '%'));
    say('');
    // On failure only clear the preview if it's still OURS — never clobber a preview a concurrent/replacing attach set.
    if (!up || !up.url) { if (previewEl && previewEl._blobUrl === myUrl) window.setMediaPreview(previewEl, null); return null; }
    return { url: up.url, kind: up.kind || m.kind };
  };
  // guardedAttach: race-safe wrapper around attachMedia for the composers. Locks the file input for the whole flow
  // (no concurrent uploads to the same preview), and uses a generation token on the input so a ✕ Remove / replace
  // during the upload discards the in-flight result instead of silently re-attaching it. Returns:
  //   { skip:true }  → ignore (a flow was already running, or it was cleared/replaced mid-flight; state already reset)
  //   { url, kind }  → apply this media
  //   null           → prep/upload failed (caller should reset to no-media)
  window.guardedAttach = async function (input, file, previewEl, onClear, onStatus) {
    if (input._busy) { input.value = ''; return { skip: true }; }
    input._busy = true; input.disabled = true;
    const gen = (input._attachGen = (input._attachGen || 0) + 1);
    let r = null;
    try { r = await window.attachMedia(file, previewEl, onClear, onStatus); }
    finally { input._busy = false; input.disabled = false; }
    if (gen !== input._attachGen) return { skip: true }; // cleared/replaced while uploading → drop it (onClear already reset state)
    return r;
  };

  // setMediaPreview: render a composer's draft media (image/gif → <img>, video → <video>) into a container element,
  // built via DOM (never innerHTML) so it's injection-safe. Pass onClear to add a keyboard-reachable ✕ Remove button.
  window.setMediaPreview = function (el, src, kind, onClear) {
    if (!el) return;
    if (el._blobUrl) { try { URL.revokeObjectURL(el._blobUrl); } catch {} el._blobUrl = null; } // free the previous object URL
    while (el.firstChild) el.removeChild(el.firstChild);
    if (!src) { el.hidden = true; el.style.display = 'none'; return; }
    if (String(src).indexOf('blob:') === 0) el._blobUrl = src;
    el.hidden = false; el.style.display = 'block';
    const node = document.createElement(kind === 'video' ? 'video' : 'img');
    node.className = 'media-preview-el';
    node.src = src;
    if (kind === 'video') { node.muted = true; node.playsInline = true; node.loop = true; node.controls = true; node.preload = 'metadata'; node.setAttribute('aria-label', 'Attached video preview'); }
    else node.alt = 'Attached ' + (kind === 'gif' ? 'GIF' : 'image') + ' preview';
    el.appendChild(node);
    if (typeof onClear === 'function') {
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'media-preview-rm'; rm.title = 'Remove'; rm.setAttribute('aria-label', 'Remove attached media'); rm.textContent = '✕';
      rm.addEventListener('click', () => {
        onClear();
        // the ✕ we're standing on just got removed — move focus to the composer's text field so it doesn't fall to <body>
        let box = el.parentElement, t = null;
        for (let i = 0; box && i < 3 && !t; i++, box = box.parentElement) t = box.querySelector('textarea, input[type="text"]');
        if (t) { try { t.focus(); } catch {} }
      });
      el.appendChild(rm);
    }
  };

  // mediaTag: render a posted media URL (a server /uploads path) — <video> for video, <img> otherwise.
  // Pass ALREADY-ESCAPED url + alt (the url is server-generated and safe; alt is a username).
  window.mediaTag = function (escUrl, escAlt) {
    if (!escUrl) return '';
    const who = escAlt || 'a sender';
    if (/\.(mp4|webm|mov)$/i.test(escUrl)) return '<video class="post-img post-video" src="' + escUrl + '" controls loop muted playsinline preload="metadata" aria-label="Video posted by ' + who + '"></video>';
    const isGif = /\.gif$/i.test(escUrl);
    const img = '<img class="post-img' + (isGif ? ' post-gif' : '') + '"' + (isGif ? ' data-gif="1"' : '') + ' src="' + escUrl + '" alt="' + (isGif ? 'Animated GIF' : 'Media') + ' posted by ' + who + '" loading="lazy">';
    // every animated GIF gets a real, keyboard-reachable pause/play control (WCAG 2.2.2) — a looping <img> can't be stopped any other way
    return isGif ? '<span class="gif-wrap">' + img + '<button class="gif-toggle" type="button" aria-pressed="false" aria-label="Pause animated GIF" title="Pause">⏸</button></span>' : img;
  };

  // GIF pause/play: an animated <img> can't be paused by CSS, so "pause" swaps in a same-origin canvas snapshot (a canvas
  // only ever sees a GIF's FIRST frame) and "play" restores the animated source. Reduced-motion viewers get every GIF
  // paused on load — once; playing it afterwards is their choice.
  const gifPause = (img) => {
    if (img.dataset.anim || !img.complete || !img.naturalWidth) return false;
    try {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      img.dataset.anim = img.currentSrc || img.src;
      img.src = c.toDataURL('image/png');
      return true;
    } catch { return false; }
  };
  const gifPlay = (img) => { if (!img.dataset.anim) return; img.src = img.dataset.anim; delete img.dataset.anim; };
  const gifSync = (wrap, paused) => {
    const b = wrap.querySelector('.gif-toggle'); if (!b) return;
    b.setAttribute('aria-pressed', String(paused)); b.textContent = paused ? '▶' : '⏸';
    b.setAttribute('aria-label', paused ? 'Play animated GIF' : 'Pause animated GIF'); b.title = paused ? 'Play' : 'Pause';
    const im = wrap.querySelector('img.post-gif'); if (im) im.setAttribute('aria-label', (im.alt || 'GIF') + (paused ? ' — paused' : ''));
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.gif-toggle'); if (!b) return;
    const wrap = b.closest('.gif-wrap'), im = wrap && wrap.querySelector('img.post-gif'); if (!im) return;
    if (im.dataset.anim) { gifPlay(im); gifSync(wrap, false); }
    else if (gifPause(im)) gifSync(wrap, true);
  });
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const freeze = (img) => { if (gifPause(img)) { const w = img.closest('.gif-wrap'); if (w) gifSync(w, true); } };
    const scan = () => document.querySelectorAll('img.post-gif[data-gif]:not([data-anim]):not([data-rmseen])').forEach(img => {
      img.dataset.rmseen = '1';
      if (img.complete && img.naturalWidth) freeze(img); else img.addEventListener('load', () => freeze(img), { once: true });
    });
    document.addEventListener('DOMContentLoaded', scan); scan();
    let t; const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 150); });
    try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch {}
  }
})();

/* ===== Icon-button hover tooltips =====
 * Any icon-only control (a button/link with an aria-label but no visible words) gets a native hover
 * tooltip by mirroring its aria-label into `title`. Covers static markup AND anything rendered later
 * (Hot Feed rail, posts, widgets, modals…) via a debounced MutationObserver. CSP-safe. */
(function iconTooltips() {
  'use strict';
  // "words" = actual letters in the visible text; emoji, digits (count badges), $, and symbols don't count as words.
  function hasWords(el) { return /[a-zA-ZÀ-ɏЀ-ӿ]/.test(el.textContent || ''); }
  function enhance() {
    var nodes = document.querySelectorAll('button[aria-label]:not([title]), a[aria-label]:not([title]), [role="button"][aria-label]:not([title])');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (hasWords(el)) continue;                 // has a real text label already → self-explanatory, skip
      var label = el.getAttribute('aria-label');
      if (label) el.setAttribute('title', label); // icon-only → explain it on hover
    }
  }
  function start() {
    enhance();
    if (!window.MutationObserver) return;
    var scheduled = false;
    var obs = new MutationObserver(function () {
      if (scheduled) return; scheduled = true;
      var run = function () { scheduled = false; enhance(); };
      if (window.requestAnimationFrame) requestAnimationFrame(run); else setTimeout(run, 100);
    });
    try { obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

/* ===== keyboard support for every role=tablist / role=radiogroup segmented control =====
 * ← → Home End move focus AND activate (WAI-ARIA tabs pattern), delegated so dynamically-built
 * tab strips (auth modal, feeds, New Pairs view switch) get it for free. */
(function () {
  document.addEventListener('keydown', function (e) {
    var vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End' && !vertical) return;
    var t = e.target;
    if (!(t instanceof Element)) return;
    var role = t.getAttribute('role');
    if (role !== 'tab' && role !== 'radio') return;
    if (vertical && role !== 'radio') return; // ↑/↓ belong to radiogroups only (tabs are horizontal strips here)
    var group = t.closest(role === 'tab' ? '[role="tablist"]' : '[role="radiogroup"]');
    if (!group) return;
    var items = Array.prototype.filter.call(group.querySelectorAll('[role="' + role + '"]'), function (el) { return !el.hidden && !el.disabled && el.offsetParent !== null; });
    var i = items.indexOf(t);
    if (i < 0) return;
    var j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    e.preventDefault();
    items[j].focus();
    items[j].click();
    // some pickers (profile avatar / colour swatches) rebuild their buttons on click — put focus back on the new checked one
    if (!items[j].isConnected) {
      var again = group.querySelector('[role="' + role + '"][aria-checked="true"], [role="' + role + '"][aria-selected="true"]');
      if (again) again.focus();
    }
  });
})();

/* ===== window.announce(text): one shared polite live region for transient state ("tap again to confirm") ===== */
(function () {
  var el = null;
  window.announce = function (text) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'sr-announce'; el.className = 'sr-only';
      el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-atomic', 'true');
      document.body.appendChild(el);
    }
    el.textContent = '';
    setTimeout(function () { el.textContent = String(text || ''); }, 30); // clear→set so identical text re-announces
  };
})();
