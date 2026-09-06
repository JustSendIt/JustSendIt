/* ===== Rocketize your pic (index.html): add 🚀 stickers to a picture, entirely in the browser =====
 * The picture is decoded and drawn on a <canvas> locally. Nothing leaves the device until the user clicks
 * "Make it my profile pic", which POSTs a centre-cropped 512×512 image to /api/profile/image — the same
 * endpoint profile.js uses for the avatar slot. Sticker state is an immutable array with an undo/redo stack. */
(function () {
  'use strict';
  const root = document.getElementById('rocketize');
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const els = {
    drop: $('rz-drop'), pick: $('rz-pick'), file: $('rz-file'), editor: $('rz-editor'), canvas: $('rz-canvas'),
    undo: $('rz-undo'), redo: $('rz-redo'), sel: $('rz-sel'),
    size: $('rz-size'), sizeOut: $('rz-size-out'), smaller: $('rz-smaller'), bigger: $('rz-bigger'),
    rot: $('rz-rot'), rotOut: $('rz-rot-out'),
    next: $('rz-next'), dup: $('rz-dup'), del: $('rz-del'),
    download: $('rz-download'), avatar: $('rz-avatar'), reset: $('rz-reset'), status: $('rz-status'), authNote: $('rz-auth-note'),
  };
  if (Object.keys(els).some((k) => !els[k])) return;
  const ctx = els.canvas.getContext('2d');
  if (!ctx) return;

  const MAX_SIDE = 1600, MAX_BYTES = 12 * 1024 * 1024, MIN_SIZE = 32, MAX_SIZE = 512, HIST_CAP = 100;
  const AVATAR_PX = 512, AVATAR_MAX_BYTES = 3.5 * 1024 * 1024, PENDING_MS = 10 * 60 * 1000;
  const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
  const announce = (t) => { if (window.announce) window.announce(t); };
  const toast = (t) => { if (window.sendToast) window.sendToast(t); };
  const reduced = () => (window.prefersReduced ? window.prefersReduced() : false);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- state ---------- */
  let base = null;            // offscreen canvas holding the downscaled picture (≤ 1600px longest side)
  let stickers = [];          // current sticker array — treated as immutable; every change makes a new array
  let history = [[]], hi = 0; // undo stack of sticker arrays + index of the current entry
  let selectedId = null, nextId = 1, lastSize = 128;
  let coalesce = { key: null, at: 0 }; // lets a burst of nudges / slider ticks collapse into one undo step
  let loading = false, busy = false;
  /* "Make it my profile pic" while signed out: pendingAvatar is only a FLAG — the 512×512 snapshot is built at upload
   * time so edits made while the sign-in modal is open are kept. A copy also goes to sessionStorage (PENDING_KEY)
   * because most sign-in routes leave the page (OAuth callbacks land on /profile.html; a brand-new wallet account goes
   * to /profile.html#claim and is bounced back here by profile.js via 'jsi:after-claim'). On the next load, or the next
   * in-page sign-in, a still-fresh stash is uploaded and cleared. */
  let pendingAvatar = false, pendingTimer = null;
  const PENDING_KEY = 'rz:pending';

  /* ---------- emoji rendering check (falls back to a vector rocket when the platform has no colour emoji) ---------- */
  const emojiOk = (function () {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 48;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#000';
      x.font = '36px ' + EMOJI_FONT; x.fillText('🚀', 24, 24);
      const d = x.getImageData(0, 0, 48, 48).data;
      let any = 0, colour = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 80) continue;
        any++;
        if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40) colour++;
      }
      return any > 20 && colour > 10; // a tofu box / monochrome glyph has no colourful pixels
    } catch { return false; }
  })();

  function drawRocketPath(c, size) { // vector fallback, centred on (0,0) inside a size×size box
    const s = size / 100;
    c.save(); c.scale(s, s); c.translate(-50, -50);
    c.fillStyle = '#ffb340'; // flame
    c.beginPath(); c.moveTo(41, 74); c.lineTo(50, 97); c.lineTo(59, 74); c.closePath(); c.fill();
    c.fillStyle = '#ff5d5d'; // fins
    c.beginPath(); c.moveTo(40, 52); c.lineTo(24, 80); c.lineTo(41, 74); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(60, 52); c.lineTo(76, 80); c.lineTo(59, 74); c.closePath(); c.fill();
    c.fillStyle = '#eef4ff'; // body
    c.beginPath(); c.moveTo(50, 4); c.bezierCurveTo(68, 24, 68, 58, 60, 76); c.lineTo(40, 76); c.bezierCurveTo(32, 58, 32, 24, 50, 4); c.closePath(); c.fill();
    c.fillStyle = '#ff5d5d'; // nose
    c.beginPath(); c.moveTo(50, 4); c.bezierCurveTo(58, 12, 61, 20, 62, 28); c.lineTo(38, 28); c.bezierCurveTo(39, 20, 42, 12, 50, 4); c.closePath(); c.fill();
    c.fillStyle = '#2a7fb0'; // window
    c.beginPath(); c.arc(50, 42, 8, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#9fe0ff';
    c.beginPath(); c.arc(50, 42, 5, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  /* ---------- drawing ---------- */
  function drawSticker(c, st) {
    c.save(); c.translate(st.x, st.y); c.rotate(st.rot * Math.PI / 180);
    if (emojiOk) {
      c.font = st.size + 'px ' + EMOJI_FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
      c.fillText('🚀', 0, 0);
    } else drawRocketPath(c, st.size);
    c.restore();
  }
  function render(c, list, selId) {
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    if (base) c.drawImage(base, 0, 0);
    for (const st of list) drawSticker(c, st);
    const st = selId != null ? list.find((s) => s.id === selId) : null;
    if (st) { // highlight ring — dark outer + bright inner so it reads on light and dark photos
      const lw = Math.max(3, c.canvas.width / 320);
      c.save(); c.translate(st.x, st.y); c.beginPath(); c.arc(0, 0, st.size * 0.62, 0, Math.PI * 2);
      c.lineWidth = lw + 3; c.strokeStyle = 'rgba(10,14,20,0.85)'; c.stroke();
      c.lineWidth = lw; c.strokeStyle = '#b4ff2b'; c.stroke();
      c.restore();
    }
  }
  const draw = () => { if (base) render(ctx, stickers, selectedId); };
  function exportCanvas() { // full-resolution composite without the selection ring
    const c = document.createElement('canvas'); c.width = base.width; c.height = base.height;
    render(c.getContext('2d'), stickers, null);
    return c;
  }

  /* ---------- status line (inline, role=status) ---------- */
  function say(out, text, kind) {
    out.textContent = text || '';
    out.classList.toggle('is-err', kind === 'err');
    out.classList.toggle('is-ok', kind === 'ok');
  }
  function setStatus(text, kind) { say(els.status, text, kind); }
  function setError(text) { setStatus('⚠️ ' + text, 'err'); }
  let dropStatus = null; // status line inside the drop zone, for an upload that completes while the editor is hidden (after a sign-in redirect)
  function statusOut() {
    if (base) return els.status;
    if (!dropStatus) {
      dropStatus = document.createElement('p'); dropStatus.className = 'rz-status';
      dropStatus.setAttribute('role', 'status'); dropStatus.setAttribute('aria-live', 'polite');
      els.drop.appendChild(dropStatus);
    }
    return dropStatus;
  }

  /* ---------- history ---------- */
  function commit(list, key) {
    stickers = list;
    if (key && coalesce.key === key && Date.now() - coalesce.at < 1200 && hi > 0) history[hi] = list; // merge rapid repeats
    else {
      history = history.slice(0, hi + 1); history.push(list);
      if (history.length > HIST_CAP) history.shift();
      hi = history.length - 1;
    }
    coalesce = { key: key || null, at: Date.now() };
    syncUI(); draw();
  }
  function restore(idx, label) {
    hi = idx; stickers = history[hi]; coalesce = { key: null, at: 0 };
    if (!stickers.some((s) => s.id === selectedId)) selectedId = null;
    syncUI(); draw();
    announce(label + ' — ' + countText());
  }
  function undo() { if (hi > 0) restore(hi - 1, 'Undo'); }
  function redo() { if (hi < history.length - 1) restore(hi + 1, 'Redo'); }
  const countText = () => stickers.length + (stickers.length === 1 ? ' rocket' : ' rockets');

  /* ---------- selection + edits ---------- */
  const selected = () => stickers.find((s) => s.id === selectedId) || null;
  function select(id, quiet) {
    selectedId = id; syncUI(); draw();
    if (!quiet && id != null) {
      const i = stickers.findIndex((s) => s.id === id);
      announce('Rocket ' + (i + 1) + ' of ' + stickers.length + ' selected');
    }
  }
  function update(id, patch, key) { commit(stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)), key); }
  function addAt(x, y) {
    const st = { id: nextId++, x: clamp(x, 0, base.width), y: clamp(y, 0, base.height), size: lastSize, rot: 0 };
    selectedId = st.id;
    commit(stickers.concat([st]));
    announce('Rocket added — ' + countText());
  }
  function removeSelected() {
    const st = selected(); if (!st) return;
    selectedId = null;
    commit(stickers.filter((s) => s.id !== st.id));
    announce('Rocket removed — ' + countText());
    (stickers.length ? els.next : els.canvas).focus({ preventScroll: true });
  }
  function duplicateSelected() {
    const st = selected(); if (!st) return;
    const off = st.size * 0.35;
    const copy = { ...st, id: nextId++, x: clamp(st.x + off, 0, base.width), y: clamp(st.y + off, 0, base.height) };
    selectedId = copy.id;
    commit(stickers.concat([copy]));
    announce('Rocket duplicated — ' + countText());
  }
  function selectNext() {
    if (!stickers.length) return;
    const i = stickers.findIndex((s) => s.id === selectedId);
    select(stickers[(i + 1) % stickers.length].id);
  }
  function nudge(dx, dy) {
    const st = selected(); if (!st) return;
    update(st.id, { x: clamp(st.x + dx, 0, base.width), y: clamp(st.y + dy, 0, base.height) }, 'nudge:' + st.id);
  }
  function setSize(v, key) {
    const st = selected(); if (!st) return;
    v = clamp(Math.round(v), MIN_SIZE, MAX_SIZE); lastSize = v;
    update(st.id, { size: v }, key || 'size:' + st.id);
  }
  function setRot(v, key) {
    const st = selected(); if (!st) return;
    update(st.id, { rot: clamp(Math.round(v), -180, 180) }, key || 'rot:' + st.id);
  }

  /* ---------- UI sync ---------- */
  function setAriaDisabled(btn, off) { btn.setAttribute('aria-disabled', off ? 'true' : 'false'); }
  function syncUI() {
    setAriaDisabled(els.undo, hi === 0);
    setAriaDisabled(els.redo, hi >= history.length - 1);
    const st = selected(), has = !!st;
    [els.size, els.smaller, els.bigger, els.rot, els.dup, els.del].forEach((el) => { el.disabled = !has; });
    els.next.disabled = stickers.length === 0;
    els.size.value = has ? st.size : lastSize; els.sizeOut.textContent = (has ? st.size : lastSize) + ' px';
    els.rot.value = has ? st.rot : 0; els.rotOut.textContent = (has ? st.rot : 0) + '°';
    els.sel.textContent = has
      ? 'Rocket ' + (stickers.findIndex((s) => s.id === st.id) + 1) + ' of ' + stickers.length + ' selected'
      : (stickers.length ? countText() + ' — tap one to select it' : 'No rockets yet — tap the picture to add one');
    els.canvas.setAttribute('aria-label', 'Your picture with ' + countText() + '. Click or tap to add a rocket; press Enter to add one in the centre.');
    // a control that just became disabled while focused would drop focus to <body> (Escape / Undo / Redo on a
    // per-sticker button or slider) — park it on the canvas instead so the Tab order continues from the editor
    const ae = document.activeElement;
    if (ae && ae !== els.canvas && ae.disabled && root.contains(ae)) els.canvas.focus({ preventScroll: true });
  }
  function syncAuthNote() {
    const u = window.AUTH && window.AUTH.user;
    els.authNote.textContent = u
      ? 'Signed in as @' + (u.username || '') + ' — this replaces your current profile image.'
      : 'You’ll be asked to sign in (free) first — the picture is only sent once you confirm.';
  }

  /* ---------- pointer interaction on the canvas ---------- */
  function toCanvas(e) {
    const r = els.canvas.getBoundingClientRect();
    const k = r.width ? els.canvas.width / r.width : 1;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * (r.height ? els.canvas.height / r.height : 1), k };
  }
  function hitAt(x, y, k) { // top-most first; hit box never smaller than a fingertip (~22 CSS px each side)
    for (let i = stickers.length - 1; i >= 0; i--) {
      const st = stickers[i], a = -st.rot * Math.PI / 180, dx = x - st.x, dy = y - st.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      const h = Math.max(st.size * 0.5, 22 * k);
      if (Math.abs(lx) <= h && Math.abs(ly) <= h) return st;
    }
    return null;
  }
  /* The canvas can fill a phone's width, so it must not swallow page scrolling: the stylesheet allows vertical pans
   * (touch-action: pan-y) and a rocket is only added on a CLEAN release — same pointer, no movement, not cancelled by
   * the browser taking the gesture as a scroll. A finger landing on an existing rocket keeps the gesture for dragging
   * (the non-passive touchstart below cancels the scroll for that touch only). */
  let drag = null; // { id: sticker id or null for an empty-space press, ox, oy, sx, sy, k, moved, pid }
  els.canvas.addEventListener('pointerdown', (e) => {
    if (!base || busy || (e.button != null && e.button > 0)) return;
    if (drag) endDrag(null, true); // a second pointer mid-gesture: settle the first one without committing anything new
    e.preventDefault();
    const p = toCanvas(e), hit = hitAt(p.x, p.y, p.k);
    drag = { id: hit ? hit.id : null, ox: hit ? p.x - hit.x : 0, oy: hit ? p.y - hit.y : 0, sx: p.x, sy: p.y, k: p.k, moved: false, pid: e.pointerId };
    try { els.canvas.setPointerCapture(e.pointerId); } catch {}
    if (hit) { select(hit.id); els.canvas.focus({ preventScroll: true }); }
  });
  els.canvas.addEventListener('touchstart', (e) => {
    if (!base || busy || !e.touches || e.touches.length !== 1) return;
    const p = toCanvas(e.touches[0]);
    if (hitAt(p.x, p.y, p.k)) e.preventDefault(); // on a rocket: drag it rather than scroll the page
  }, { passive: false });
  els.canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const p = toCanvas(e);
    if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) < 3 * drag.k) return; // ignore jitter on a plain tap
    drag.moved = true;
    if (drag.id == null) return; // travelling over empty space is a pan / scroll, never an add
    const nx = clamp(p.x - drag.ox, 0, base.width), ny = clamp(p.y - drag.oy, 0, base.height);
    stickers = stickers.map((s) => (s.id === drag.id ? { ...s, x: nx, y: ny } : s)); // live preview; committed on release
    draw();
  });
  function endDrag(e, cancelled) {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    try { els.canvas.releasePointerCapture(drag.pid); } catch {}
    const d = drag; drag = null;
    if (d.id == null) { // empty-space press → add only on a clean tap
      if (!d.moved && !cancelled) { addAt(d.sx, d.sy); els.canvas.focus({ preventScroll: true }); }
      return;
    }
    if (d.moved) { commit(stickers); announce('Rocket moved'); }
    else { stickers = history[hi]; draw(); }
  }
  els.canvas.addEventListener('pointerup', (e) => endDrag(e, false));
  els.canvas.addEventListener('pointercancel', (e) => endDrag(e, true));
  els.canvas.addEventListener('lostpointercapture', (e) => endDrag(e, true));

  /* ---------- keyboard ---------- */
  root.addEventListener('keydown', (e) => {
    if (!base) return;
    const t = e.target, tag = t && t.tagName;
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && !e.altKey && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
    if (mod) return;
    if (t === els.canvas && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); addAt(base.width / 2, base.height / 2); return; }
    if (inField) return; // range sliders own their arrow keys
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') { if (selected()) { e.preventDefault(); nudge(-step, 0); } return; }
    if (e.key === 'ArrowRight') { if (selected()) { e.preventDefault(); nudge(step, 0); } return; }
    if (e.key === 'ArrowUp') { if (selected()) { e.preventDefault(); nudge(0, -step); } return; }
    if (e.key === 'ArrowDown') { if (selected()) { e.preventDefault(); nudge(0, step); } return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected()) { e.preventDefault(); removeSelected(); return; }
    if (e.key === 'Escape' && selected()) { e.preventDefault(); select(null); els.canvas.focus({ preventScroll: true }); announce('Selection cleared'); }
  });

  /* ---------- toolbar ---------- */
  els.undo.addEventListener('click', () => { if (els.undo.getAttribute('aria-disabled') !== 'true') undo(); });
  els.redo.addEventListener('click', () => { if (els.redo.getAttribute('aria-disabled') !== 'true') redo(); });
  els.size.addEventListener('input', () => { // live preview while sliding; the change event commits one undo step
    const st = selected(); if (!st) return;
    const v = clamp(Number(els.size.value) || st.size, MIN_SIZE, MAX_SIZE);
    stickers = stickers.map((s) => (s.id === st.id ? { ...s, size: v } : s)); lastSize = v;
    els.sizeOut.textContent = v + ' px'; draw();
  });
  els.size.addEventListener('change', () => { setSize(Number(els.size.value)); });
  els.rot.addEventListener('input', () => {
    const st = selected(); if (!st) return;
    const v = clamp(Number(els.rot.value) || 0, -180, 180);
    stickers = stickers.map((s) => (s.id === st.id ? { ...s, rot: v } : s));
    els.rotOut.textContent = v + '°'; draw();
  });
  els.rot.addEventListener('change', () => { setRot(Number(els.rot.value)); });
  const sizeStep = (st) => Math.max(4, Math.round(st.size * 0.1));
  els.smaller.addEventListener('click', () => { const st = selected(); if (st) setSize(st.size - sizeStep(st)); });
  els.bigger.addEventListener('click', () => { const st = selected(); if (st) setSize(st.size + sizeStep(st)); });
  els.next.addEventListener('click', selectNext);
  els.dup.addEventListener('click', duplicateSelected);
  els.del.addEventListener('click', removeSelected);

  /* ---------- load a picture ---------- */
  function loadImg(file) {
    return new Promise((resolve) => {
      const u = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); resolve(im); };
      im.onerror = () => { URL.revokeObjectURL(u); resolve(null); };
      im.src = u;
    });
  }
  async function loadFile(file) {
    if (!file || loading) return;
    const type = (file.type || '').toLowerCase();
    const okType = /^image\/(jpeg|png|webp|gif)$/.test(type) || (!type && /\.(jpe?g|png|webp|gif)$/i.test(file.name || ''));
    if (!okType) return setError('Use a JPG, PNG, WebP or GIF picture.');
    if (file.size > MAX_BYTES) return setError('That picture is over 12 MB — pick a smaller one.');
    loading = true; setStatus('Loading your picture…');
    let bmp = null, src = null;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); src = bmp; } catch {}
    if (!src) src = await loadImg(file);
    const iw = src ? (src.width || src.naturalWidth) : 0, ih = src ? (src.height || src.naturalHeight) : 0;
    if (!iw || !ih) { loading = false; if (bmp && bmp.close) bmp.close(); return setError('Couldn’t read that picture — try a different file.'); }
    const k = Math.min(1, MAX_SIDE / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
    try {
      base = document.createElement('canvas'); base.width = w; base.height = h;
      base.getContext('2d').drawImage(src, 0, 0, w, h);
    } catch { base = null; loading = false; if (bmp && bmp.close) bmp.close(); return setError('Couldn’t draw that picture — try a different file.'); }
    if (bmp && bmp.close) bmp.close();
    els.canvas.width = w; els.canvas.height = h;
    stickers = []; history = [[]]; hi = 0; selectedId = null; nextId = 1;
    lastSize = clamp(Math.round(Math.min(w, h) * 0.22), MIN_SIZE, MAX_SIZE);
    els.drop.hidden = true; els.editor.hidden = false;
    loading = false; setStatus(''); syncAuthNote(); syncUI(); draw();
    els.canvas.focus({ preventScroll: true });
    announce('Picture loaded. Tap or click the picture to add rockets.');
  }
  els.pick.addEventListener('click', () => { els.file.value = ''; els.file.click(); });
  els.file.addEventListener('change', () => { loadFile(els.file.files && els.file.files[0]); });
  ['dragenter', 'dragover'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('is-over'); }));
  els.drop.addEventListener('dragleave', (e) => { if (!els.drop.contains(e.relatedTarget)) els.drop.classList.remove('is-over'); });
  els.drop.addEventListener('drop', (e) => {
    e.preventDefault(); els.drop.classList.remove('is-over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  /* ---------- start over ---------- */
  els.reset.addEventListener('click', () => {
    if (busy) return;
    base = null; stickers = []; history = [[]]; hi = 0; selectedId = null; drag = null;
    clearPending();
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    els.file.value = '';
    els.editor.hidden = true; els.drop.hidden = false;
    setStatus('');
    els.pick.focus({ preventScroll: true });
    announce('Cleared. Choose another picture.');
  });

  /* ---------- export ---------- */
  els.download.addEventListener('click', () => {
    if (!base || busy) return;
    let out;
    try { out = exportCanvas(); } catch { return setError('Couldn’t build the image — try again.'); }
    out.toBlob((blob) => {
      if (!blob) return setError('Couldn’t build the PNG — try again.');
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u; a.download = 'rocketized.png'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 15000);
      setStatus('Saved as rocketized.png ⬇ (check your downloads)', 'ok');
      announce('Downloading rocketized.png');
    }, 'image/png');
  });

  function bytesOf(dataUrl) { const i = dataUrl.indexOf(','); return Math.floor((dataUrl.length - i - 1) * 3 / 4); }
  function avatarDataUrl() { // centre-cropped square, 512×512, PNG unless that would exceed the server's 3.5 MB cap
    const src = exportCanvas();
    const s = Math.min(src.width, src.height), sx = Math.floor((src.width - s) / 2), sy = Math.floor((src.height - s) / 2);
    const c = document.createElement('canvas'); c.width = c.height = AVATAR_PX;
    const x = c.getContext('2d');
    try { x.imageSmoothingQuality = 'high'; } catch {}
    x.drawImage(src, sx, sy, s, s, 0, 0, AVATAR_PX, AVATAR_PX);
    let d = c.toDataURL('image/png');
    if (bytesOf(d) > AVATAR_MAX_BYTES) d = c.toDataURL('image/jpeg', 0.9);
    return d;
  }
  function setBusy(b) {
    busy = b;
    els.avatar.disabled = b; els.download.disabled = b; els.reset.disabled = b;
    els.avatar.setAttribute('aria-busy', b ? 'true' : 'false');
  }
  async function sendAvatar(dataUrl, out) { // out: the status line to report into (defaults to the editor's)
    out = out || els.status;
    if (typeof window.api !== 'function') return say(out, '⚠️ Sign-in isn’t available on this page right now.', 'err');
    if (busy) return;
    setBusy(true); say(out, 'Setting your profile pic…');
    try {
      const j = await window.api('/api/profile/image', { method: 'POST', body: { kind: 'avatar', image: dataUrl } });
      if (!j || !j.ok || !j.url) throw new Error('Unexpected reply from the server — try again.');
      if (window.AUTH && window.AUTH.user) {
        window.AUTH.user.avatar_img = j.url;
        if (window.AUTH.user.theme && typeof window.AUTH.user.theme === 'object') window.AUTH.user.theme.avatar_img = j.url;
        document.dispatchEvent(new CustomEvent('auth:change', { detail: window.AUTH.user }));
      }
      toast('That’s your new profile pic 🚀');
      out.textContent = 'That’s your new profile pic 🚀 ';
      const a = document.createElement('a'); a.href = '/profile.html'; a.textContent = 'See it on your profile →';
      out.appendChild(a);
      out.classList.remove('is-err'); out.classList.add('is-ok');
      announce('Profile picture updated');
      if (window.sendConfetti && !reduced()) { try { window.sendConfetti(innerWidth / 2, innerHeight / 2, { count: 30, emojiRatio: 0.5 }); } catch {} }
    } catch (err) {
      say(out, '⚠️ ' + ((err && err.message) || 'Upload failed — try again.'), 'err');
    } finally { setBusy(false); }
  }

  /* ---------- pending profile pic across sign-in (see the note by pendingAvatar) ---------- */
  function stashWrite(d) {
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ at: Date.now(), img: d })); return true; } catch { return false; }
  }
  function stashRead() { // fresh, well-formed data URL or null; anything stale/odd is dropped on the spot
    let j = null;
    try { j = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch {}
    if (!j) return null;
    const ok = typeof j.img === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(j.img) && Date.now() - Number(j.at) < PENDING_MS;
    if (!ok) stashClear();
    return ok ? j.img : null;
  }
  function stashClear() { try { sessionStorage.removeItem(PENDING_KEY); } catch {} }
  function clearPending() { pendingAvatar = false; clearTimeout(pendingTimer); stashClear(); }
  function finishPending(u) { // called with the signed-in user: upload what was waiting, freshest copy first
    if (!u || busy) return;
    if (pendingAvatar && base) {
      clearPending();
      let d;
      try { d = avatarDataUrl(); } catch { return setError('Couldn’t build the profile image — try again.'); }
      return sendAvatar(d);
    }
    const d = stashRead(); // came back from a sign-in that left the page (OAuth / new-wallet claim)
    if (!d) return;
    stashClear();
    sendAvatar(d, statusOut());
  }

  els.avatar.addEventListener('click', async () => {
    if (!base || busy) return;
    const A = window.AUTH;
    let d;
    try { d = avatarDataUrl(); } catch { return setError('Couldn’t build the profile image — try again.'); }
    if (A && A.user) return sendAvatar(d);
    if (!A || typeof A.open !== 'function') return setError('Sign-in isn’t available on this page right now.');
    clearTimeout(pendingTimer);
    pendingAvatar = true;
    const stashed = stashWrite(d); // the copy that survives a redirecting sign-in (refreshed if they keep editing — see visibilitychange)
    pendingTimer = setTimeout(() => {
      if (!pendingAvatar) return;
      clearPending();
      setError('Sign-in timed out — hit “Make it my profile pic” again when you’re ready.');
    }, PENDING_MS);
    setStatus(stashed
      ? 'Sign in to finish. If sign-in takes you to your profile page, come back here and we’ll set it.'
      : 'Sign in to finish — stay on this page and we’ll set it the moment you’re in.');
    A.open();
  });
  document.addEventListener('visibilitychange', () => { // leaving the page mid sign-in: stash what is on the canvas NOW
    if (document.visibilityState !== 'hidden' || !pendingAvatar || !base) return;
    try { stashWrite(avatarDataUrl()); } catch {}
  });
  let hadUser = !!(window.AUTH && window.AUTH.user);
  document.addEventListener('auth:change', (e) => {
    syncAuthNote();
    const u = (e && e.detail) || (window.AUTH && window.AUTH.user);
    if (!u && hadUser) clearPending(); // sign-out: a waiting pic must not follow the next person into this tab
    hadUser = !!u;
    finishPending(u);
  });
  if (window.AUTH && window.AUTH.ready && typeof window.AUTH.ready.then === 'function') { // stash path after a redirect back
    window.AUTH.ready.then((u) => { hadUser = hadUser || !!u; finishPending(u || (window.AUTH && window.AUTH.user)); }).catch(() => {});
  }

  syncAuthNote();
  syncUI();
})();
