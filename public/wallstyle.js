/* ===== wallstyle.js — your Send Wall's look, edited in one place =====
 *
 * Owner, 2026-10-15: "Allow a user to pull up a full screen size view of a profile picture and banner by clicking on it, if
 * it's someone's own profile, allow them to edit it directly from the full view, take the user to a pop up menu that is the
 * wall style settings that a user can edit all of his send wall profile setting at once."
 *
 * One editor, two places: the dashboard's "My Wall Style" card (profile.js) and the pop-up on your own wall (upage.js, opened
 * from the full-screen view of your picture or banner). Both use the pieces below, so the colour rules, the uploads and the
 * pickers cannot drift apart:
 *   - picker(zone, P)       swatches + a hex box; a typed colour joins "your colours" in every picker on the page
 *   - wallPickers(…)        the wall's accent and background tint, held to the server's readability rule and saved as picked
 *   - imageSlot(zone, …)    the current picture with Upload / Replace and 🗑 (avatar, header, background)
 *   - emojiPicker(zone, …)  the twelve avatar emoji
 *   - editor(container, …)  all of it for the wall's pop-up, plus the bio and links that show on the wall
 * Colours, pictures and the emoji save the moment they are picked (as the dashboard always has); the bio and links save with
 * their button, since they are typed. No new server routes: /api/profile and /api/profile/image, as before.
 */
(function () {
  'use strict';
  const AVATARS = ['🚀','🦍','🐸','💎','🤝','🧨','🥷','👑','🦖','🌕','💸','🔥'];
  const ACCENTS = ['', '#c6f000', '#00C805', '#ffb340', '#ff5d5d', '#5dc9ff', '#c85dff', '#ff5dd2', '#ffffff'];
  const BGS = ['', '#0a0e14', '#101a10', '#1a1210', '#10121a', '#1a101a', '#000000'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => { if (window.sendToast) sendToast(m); };
  const sfx = (n) => { if (window.SFX) SFX.play(n); };

  /* ---------- pickers ---------- */
  /* Roving tabindex for a radiogroup (the WAI-ARIA radio pattern): one Tab stop per group, arrows move AND
     choose, Home/End jump to the ends. Without it each of the twelve avatars and every swatch was its own
     Tab stop while announcing itself as a radio, which promises arrow keys that did nothing. Choosing
     re-renders the group, so focus is put on the NEW node at the same index, not the one just discarded. */
  function roveRadios(zone) {
    const radios = Array.from(zone.querySelectorAll('[role="radio"]'));
    const on = Math.max(0, radios.findIndex(r => r.getAttribute('aria-checked') === 'true')); // nothing checked → first is the stop
    radios.forEach((r, i) => {
      r.tabIndex = i === on ? 0 : -1;
      r.addEventListener('keydown', (e) => {
        const k = e.key;
        const fwd = k === 'ArrowRight' || k === 'ArrowDown', back = k === 'ArrowLeft' || k === 'ArrowUp';
        if (!fwd && !back && k !== 'Home' && k !== 'End') return;
        e.preventDefault();
        const j = k === 'Home' ? 0 : k === 'End' ? radios.length - 1 : (i + (fwd ? 1 : radios.length - 1)) % radios.length;
        /* move focus, not the selection: each of these radios saves to the account when it is picked, so an
           arrow that clicked would post a change per keystroke. Enter, Space or a click picks the focused one. */
        radios.forEach((x, k) => { x.tabIndex = k === j ? 0 : -1; });
        radios[j].focus();
      });
    });
  }
  function emojiPicker(zone, current, onPick) {
    zone.innerHTML = '';
    for (const a of AVATARS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'react-btn' + (a === current() ? ' lit' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(a === current()));
      b.setAttribute('aria-label', 'avatar ' + a);
      b.setAttribute('data-tip', onPick.tip ? onPick.tip(a) : 'Uses ' + a + ' as your avatar');
      b.textContent = a;
      b.addEventListener('click', () => {
        onPick(a);
        // the re-render discards this button, and with it the focus: put focus on the new node at the same index
        const i = Array.prototype.indexOf.call(zone.children, b);
        emojiPicker(zone, current, onPick);
        const nb = zone.children[i]; if (nb) nb.focus();
      });
      zone.appendChild(b);
    }
    roveRadios(zone);
  }
  function swatches(zone, colors, current, onPick, mine, tip) {
    zone.innerHTML = '';
    for (const c of colors) {
      const own = !!(mine && c && mine.includes(c));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (own ? ' is-mine' : '');
      b.style.background = c || 'linear-gradient(135deg, #a8ce00, #ffb340)';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(c === current));
      b.setAttribute('aria-label', c ? (own ? 'your colour ' : 'color ') + c : 'default');
      b.title = c || 'default';
      /* The colour is the swatch — a description that reads it back as "#c6f000" prints a system value at
         somebody looking straight at the thing it names. "this colour" is what a person would say. */
      b.setAttribute('data-tip', tip(c));
      b.addEventListener('click', () => {
        const i = Array.prototype.indexOf.call(zone.children, b);   // same as the avatar picker: refocus the rebuilt node
        if (onPick(c) !== true) swatches(zone, colors, c, onPick, mine, tip);   // true: the picker redrew itself
        const nb = zone.children[i]; if (nb) nb.focus();
      });
      zone.appendChild(b);
    }
    roveRadios(zone);
  }

  /* ---------- your own colours (owner, 2026-10-14: "For my wall style accent color and background tint, allow users to enter in
     a hex code in addition from picking from preset colors, when a user puts in a hex code add that color to the list of colors
     to pick from in the future to all places where users can pick from pre-picked colors") ----------
     Each picker gets a hex box under its swatches. A colour typed there is used, and kept in "your colours" —
     site_prefs.customColors on the account, so every device sees it — which every picker shows after its presets (newest first,
     the last twelve). The wall's two colours are held to the readability rule the server enforces too: an accent is text (your
     name on your wall, your @handle on every card), so it must reach 4.5:1 against your wall's background and the site's card
     colours; a background sits behind the wall's light text, so it must keep that text at 7:1 and the dimmer text at 4.5:1. A
     colour that misses is nudged to the nearest one that passes, and the box says so. */
  const MY_COLORS_MAX = 12;
  const WALL_TEXT = '#f2f6ec', WALL_TEXT_DIM = '#b6beac', WALL_SURFACES = ['#050604', '#0c0e09', '#14170f'];
  function normHex(v) {   // "#7ee8fa", "7EE8FA", "#7ef" → "#7ee8fa"; anything else → null
    let x = String(v || '').trim().toLowerCase().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/.test(x)) x = x.split('').map((ch) => ch + ch).join('');
    return /^[0-9a-f]{6}$/.test(x) ? '#' + x : null;
  }
  function myColors() { const l = (window.SITE_PREFS || {}).customColors; return (Array.isArray(l) ? l : []).filter((x) => /^#[0-9a-f]{6}$/.test(x)).slice(0, MY_COLORS_MAX); }
  function keepColor(c) { window.applySitePrefs({ customColors: [c].concat(myColors().filter((x) => x !== c)).slice(0, MY_COLORS_MAX) }, true); }
  // an accent readable on the wall's background (the one given, or the site's darkest) and on the site's card colours
  function readableAccent(c, bg) { const CM = window.ColorMath; return CM && c ? CM.fixFg(c, [bg || WALL_SURFACES[0], WALL_SURFACES[1], WALL_SURFACES[2]], 4.5) : c; }
  function readableBg(c) {
    const CM = window.ColorMath; if (!CM || !c) return c;
    const ok = (x) => CM.ratio(WALL_TEXT, x) >= 7 && CM.ratio(WALL_TEXT_DIM, x) >= 4.5;
    let x = c;
    for (let i = 0; i < 80 && !ok(x); i++) { const n = parseInt(x.slice(1), 16); x = '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * 0.94).toString(16).padStart(2, '0')).join(''); }
    return x;
  }
  /* A picker: P = { presets(), current(), label, fit(c), pick(c), tip(c), warn?() }. Every picker on the page is redrawn when
     "your colours" change, so a colour typed into one shows in all of them at once. */
  const pickers = new Set();
  function picker(zone, P) {
    if (!zone) return;
    for (const z of pickers) if (!z.isConnected) pickers.delete(z);   // a closed pop-up's pickers are let go
    zone._ws = P; pickers.add(zone); drawPicker(zone);
  }
  function drawPickers() { for (const z of pickers) { if (z.isConnected) drawPicker(z); else pickers.delete(z); } }
  function pickerNote(zone, text, err) { const m = document.getElementById('hex-' + zone.id + '-msg'); if (m) { m.textContent = text || ''; m.classList.toggle('is-err', !!err); } }
  function drawPicker(zone) {
    const P = zone._ws; if (!P) return;
    const presets = P.presets(), cur = P.current();
    const mine = myColors().filter((x) => !presets.includes(x));
    const list = presets.concat(mine);
    if (cur && !list.includes(cur)) { list.push(cur); mine.push(cur); }   // a colour in use always shows, checked
    swatches(zone, list, cur, (c) => {
      const used = P.fit(c);
      P.pick(used);
      drawPicker(zone);
      pickerNote(zone, used !== c ? 'Adjusted to ' + used + ' so the text on your wall stays readable.' : '');
      const w = P.warn && P.warn(); if (w) pickerNote(zone, w, true);
      return true;
    }, mine, P.tip);
    hexRow(zone);
  }
  function hexRow(zone) {
    const P = zone._ws;
    if (zone.nextElementSibling && zone.nextElementSibling.classList.contains('hex-row')) return;
    const inId = 'hex-' + zone.id;
    const row = document.createElement('div');
    row.className = 'hex-row';
    row.innerHTML = '<label class="hex-label" for="' + inId + '">Or type a hex code</label>' +
      '<span class="hex-field"><span class="hex-chip is-empty" aria-hidden="true"></span>' +
      '<input class="hex-input" id="' + inId + '" type="text" maxlength="7" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="#7ee8fa" aria-describedby="' + inId + '-msg" data-tip="Type a colour as # and six characters (0–9, a–f), then Use or Enter">' +
      '<button class="btn btn-sm hex-use" type="button" data-tip="Uses this colour for your ' + esc(P.label) + ' and keeps it in your colours, in every colour picker here">Use</button></span>' +
      '<p class="hex-msg" id="' + inId + '-msg" role="status" aria-live="polite"></p>';
    zone.after(row);
    const input = row.querySelector('input'), chip = row.querySelector('.hex-chip');
    input.addEventListener('input', () => { const c = normHex(input.value); chip.style.background = c || ''; chip.classList.toggle('is-empty', !c); });
    const use = () => {
      const c = normHex(input.value);
      if (!c) { pickerNote(zone, 'That is not a hex colour: type # and six characters 0–9 or a–f, like #7ee8fa.', true); sfx('error'); input.focus(); return; }
      const used = P.fit(c);
      keepColor(used);
      P.pick(used);
      drawPickers();
      input.value = ''; chip.style.background = ''; chip.classList.add('is-empty');
      pickerNote(zone, (used !== c ? 'Adjusted to ' + used + ' so the text on your wall stays readable. ' : '') + used + ' is now in your colours, in every colour picker here.');
      sfx('success');
    };
    row.querySelector('.hex-use').addEventListener('click', use);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); use(); } });
  }

  /* ---------- the wall's two colours: accent and background tint, saved as they are picked ----------
     state = { accent, bg } (kept current here); onSaved(body) after the server takes a change. */
  function wallPickers(accentZone, bgZone, state, onSaved) {
    // a refused save (a read-only account, say) puts the picker back to what is really saved, unless a newer pick came since
    const save = async (body, undo) => {
      try { await window.api('/api/profile', { method: 'POST', body }); toast('Wall updated 🎨'); if (onSaved) onSaved(body); }
      catch (e) { toast('⚠️ ' + e.message); if (undo) undo(); }
    };
    const putBack = (zone, key, was, c) => () => { if (state[key] !== c) return; state[key] = was; drawPicker(zone); pickerNote(zone, ''); };
    picker(accentZone, { presets: () => ACCENTS, current: () => state.accent, label: 'wall accent', fit: (c) => readableAccent(c, state.bg),
      pick: (c) => { const was = state.accent; state.accent = c; save({ accent: c }, putBack(accentZone, 'accent', was, c)); },
      tip: (c) => (c ? 'Uses this colour as the accent on your public wall' : 'Puts your wall accent back to the default') });
    picker(bgZone, { presets: () => BGS, current: () => state.bg, label: 'wall background tint', fit: readableBg,
      pick: (c) => { const was = state.bg; state.bg = c; save({ wall_bg: c }, putBack(bgZone, 'bg', was, c)); },
      warn: () => (state.accent && readableAccent(state.accent, state.bg) !== state.accent ? 'Your accent is hard to read on this background — pick a lighter accent, or type one in.' : ''),
      tip: (c) => (c ? 'Paints your public wall background in this colour' : 'Puts your wall background back to the default') });
  }

  /* ---------- pictures: the profile photo, the header (banner) and the background ---------- */
  const KEY = { avatar: 'avatar_img', header: 'header_img', background: 'bg_img' };
  const WORD = { avatar: 'profile photo', header: 'banner', background: 'background' };
  // onChange(kind, url) after the server takes an upload or a removal (url null when removed)
  function imageSlot(zone, kind, url, onChange) {
    /* the nav pill shows this picture, so a change here must reach it without a reload — but only when it
       actually changed, or the first render on every visit would cost a needless /api/me round trip */
    if (kind === 'avatar' && window.AUTH && AUTH.user && (AUTH.user.avatarImg || null) !== (url || null) && AUTH.refresh) {
      AUTH.refresh().then(() => { if (AUTH.redraw) AUTH.redraw(); }).catch(() => {});
    }
    const had = zone.contains(document.activeElement);   // focus inside: it comes back to the new Upload / Replace below
    zone.innerHTML = '';
    if (url) {
      if (/\.(mp4|webm)$/i.test(url)) {
        // muted + loop + playsinline + preload=metadata: a profile video must never demand attention,
        // never play sound, and never block first paint.
        const v = document.createElement('video');
        v.src = url; v.muted = true; v.loop = true; v.autoplay = true;
        v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'metadata';
        v.setAttribute('aria-label', 'current ' + kind + ' video');
        zone.appendChild(v);
      } else {
        const img = document.createElement('img');
        img.src = url; img.alt = 'current ' + kind + ' image';
        zone.appendChild(img);
      }
    } else {
      const d = document.createElement('div');
      d.className = 'none'; d.textContent = 'none';
      zone.appendChild(d);
    }
    const up = document.createElement('label');
    up.className = 'file-label';
    /* sr-only, not hidden: [hidden] is display:none and an unfocusable input means Tab skips 'Upload'
       entirely — the only keyboard dead-end on the page. Every other uploader on the site uses this shape. */
    // the name starts with the visible word (Replace / Upload) so "click Replace" works for voice control (WCAG 2.5.3)
    up.innerHTML = '📷 ' + (url ? 'Replace' : 'Upload') + '<input type="file" class="sr-only" aria-label="' + (url ? 'Replace' : 'Upload') + ' the ' + kind + ' image or video" accept="image/*,video/mp4,video/webm">';
    up.querySelector('input').addEventListener('change', (e) => upload(kind, e.target, zone, onChange));
    zone.appendChild(up);
    if (url) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'react-btn';
      rm.textContent = '🗑';
      rm.setAttribute('aria-label', 'remove ' + kind + ' image');
      rm.setAttribute('data-tip', 'Removes the ' + WORD[kind] + ' from your wall — you can upload another');
      rm.addEventListener('click', async () => {
        try {
          await window.api('/api/profile/image', { method: 'POST', body: { kind, remove: true } });
          imageSlot(zone, kind, null, onChange);
          if (onChange) onChange(kind, null);
          sfx('remove');
          toast('Removed');
        } catch (err) { toast(err.message); }
      });
      zone.appendChild(rm);
    }
    if (had) { const f = zone.querySelector('input[type="file"]'); if (f) { try { f.focus(); } catch {} } }
  }
  async function upload(kind, input, zone, onChange) {
    const f = input.files[0]; if (!f) return;
    const done = (url) => {
      imageSlot(zone, kind, url, onChange);
      if (onChange) onChange(kind, url);
      sfx('success');
      toast('Looking good 😎');
    };
    const animated = /^video\//.test(f.type) || f.type === 'image/gif';
    if (animated) {
      // A canvas re-encode would flatten a GIF to one frame and cannot handle video at all, so these
      // stream through the same validated upload path the Send Wall uses — magic-byte checked, size
      // capped per type, and compressed identically. One pipeline, one set of limits.
      const cap = f.type === 'image/gif' ? 25 : 64;
      if (f.size > cap * 1024 * 1024) { sfx('error'); toast('Too big — keep it under ' + cap + 'MB'); return; }
      toast('Uploading…');
      try {
        const r = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': f.type, 'X-Filename': encodeURIComponent(f.name || 'media') }, body: f });
        const u = await r.json();
        if (!r.ok || !u.url) throw new Error(u.error || 'upload failed');
        const j = await window.api('/api/profile/image', { method: 'POST', body: { kind, image: u.url } });
        done(j.url);
      } catch (err) { toast('⚠️ ' + (err.message || 'upload failed')); }
      return;
    }
    if (f.size > 8 * 1024 * 1024) { sfx('error'); toast('Too big — keep it under 8MB 🐘'); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const maxW = kind === 'avatar' ? 400 : 1400;
        const scale = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas');
        c.width = img.width * scale; c.height = img.height * scale;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        try {
          const j = await window.api('/api/profile/image', { method: 'POST', body: { kind, image: c.toDataURL('image/jpeg', 0.85) } });
          done(j.url);
          if (window.sendConfetti) sendConfetti(innerWidth / 2, innerHeight / 2, { count: 24, emojiRatio: 0.4 });
        } catch (err) { toast('⚠️ ' + err.message); }
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(f);
  }

  /* ---------- the whole editor, for the pop-up on your own wall ----------
     ctx = { user: { username, avatar, bio, twitter, instagram }, theme: { accent, wall_bg, avatar_img, header_img, bg_img },
             focus: 'avatar' | 'header' | null, onTheme(patch), onUser(patch) } — the two callbacks paint the wall behind the
     pop-up as each change is saved, so what you change is what you see. */
  function editor(container, ctx) {
    const u = ctx.user || {}, t = ctx.theme || {};
    const state = { accent: t.accent || '', bg: t.wall_bg || '', avatar: u.avatar || '🚀' };
    container.innerHTML =
      '<div class="ws">' +
        '<p class="ws-lead">Everything on your wall, in one place. Each change saves as you make it — your bio and links when you leave the box — and your wall shows it at once.</p>' +
        '<section class="ws-sec" id="ws-sec-avatar" aria-labelledby="ws-h-avatar" tabindex="-1">' +
          '<h3 class="ws-h" id="ws-h-avatar">🖼️ Profile picture</h3>' +
          '<p class="f-label">Photo or video <span>(replaces your emoji on your wall)</span></p>' +
          '<div class="img-slot" id="ws-slot-avatar"></div>' +
          '<p class="f-label">Emoji <span>(shows when there is no photo)</span></p>' +
          '<div class="ws-emoji" id="ws-emoji" role="radiogroup" aria-label="Choose your avatar emoji"></div>' +
        '</section>' +
        '<section class="ws-sec" id="ws-sec-header" aria-labelledby="ws-h-header" tabindex="-1">' +
          '<h3 class="ws-h" id="ws-h-header">🏞️ Banner</h3>' +
          '<p class="f-label">Header image or video <span>(across the top of your wall)</span></p>' +
          '<div class="img-slot" id="ws-slot-header"></div>' +
        '</section>' +
        '<section class="ws-sec" id="ws-sec-colors" aria-labelledby="ws-h-colors" tabindex="-1">' +
          '<h3 class="ws-h" id="ws-h-colors">🎨 Colours</h3>' +
          '<p class="f-label">Accent <span>(your name, the ring round your picture, your wall’s highlights)</span></p>' +
          '<div class="color-swatches" id="ws-accent" role="radiogroup" aria-label="Accent color"></div>' +
          '<p class="f-label">Background tint</p>' +
          '<div class="color-swatches" id="ws-bg" role="radiogroup" aria-label="Background color"></div>' +
        '</section>' +
        '<section class="ws-sec" id="ws-sec-background" aria-labelledby="ws-h-background" tabindex="-1">' +
          '<h3 class="ws-h" id="ws-h-background">🌌 Background image</h3>' +
          '<p class="f-label">Behind your whole wall <span>(a dark veil keeps your text readable over it)</span></p>' +
          '<div class="img-slot" id="ws-slot-background"></div>' +
        '</section>' +
        '<section class="ws-sec" id="ws-sec-about" aria-labelledby="ws-h-about" tabindex="-1">' +
          '<h3 class="ws-h" id="ws-h-about">✍️ Bio and links</h3>' +
          '<label class="f-label" for="ws-bio">Bio</label>' +
          '<input class="addr-input" id="ws-bio" maxlength="200" placeholder="here to send it 🚀">' +
          '<label class="f-label" for="ws-twitter">🐦 X / Twitter <span>(handle, no @)</span></label>' +
          '<input class="addr-input" id="ws-twitter" maxlength="200" spellcheck="false" autocomplete="off" placeholder="yourhandle">' +
          '<label class="f-label" for="ws-instagram">📸 Instagram <span>(handle, no @)</span></label>' +
          '<input class="addr-input" id="ws-instagram" maxlength="200" spellcheck="false" autocomplete="off" placeholder="yourhandle">' +
          '<div class="ws-save-row"><button class="btn btn-primary btn-sm" id="ws-save" type="button" data-tip="Saves your bio and links now — they also save when you leave a box">Save bio and links 💾</button>' +
          '<p class="modal-note" id="ws-about-msg" role="status" aria-live="polite"></p></div>' +
        '</section>' +
        '<p class="modal-note ws-more">Your @handle, sign-in and everything else: <a href="/profile#sec-account">Settings on your dashboard →</a></p>' +
      '</div>';
    const $ = (id) => container.querySelector('#' + id);
    const onTheme = (patch) => { if (ctx.onTheme) ctx.onTheme(patch); };
    const onImg = (kind, url) => onTheme({ [KEY[kind]]: url });
    imageSlot($('ws-slot-avatar'), 'avatar', t.avatar_img || null, onImg);
    imageSlot($('ws-slot-header'), 'header', t.header_img || null, onImg);
    imageSlot($('ws-slot-background'), 'background', t.bg_img || null, onImg);
    const pickEmoji = async (a) => {
      const was = state.avatar; state.avatar = a;
      try { await window.api('/api/profile', { method: 'POST', body: { avatar: a } }); if (ctx.onUser) ctx.onUser({ avatar: a }); toast('Avatar set to ' + a); sfx('select'); }
      catch (e) { state.avatar = was; emojiPicker($('ws-emoji'), () => state.avatar, pickEmoji); toast('⚠️ ' + e.message); }
    };
    pickEmoji.tip = (a) => 'Uses ' + a + ' as your avatar when there is no photo';
    emojiPicker($('ws-emoji'), () => state.avatar, pickEmoji);
    wallPickers($('ws-accent'), $('ws-bg'), state, (body) => onTheme(Object.assign({}, body.accent !== undefined ? { accent: body.accent } : {}, body.wall_bg !== undefined ? { wall_bg: body.wall_bg } : {})));
    const fields = { bio: $('ws-bio'), twitter: $('ws-twitter'), instagram: $('ws-instagram') };
    const saved = { bio: u.bio || '', twitter: u.twitter || '', instagram: u.instagram || '' };   // what the account holds now
    for (const k of Object.keys(fields)) fields[k].value = saved[k];
    const msg = $('ws-about-msg'), saveBtn = $('ws-save');
    const typed = () => ({ bio: fields.bio.value, twitter: fields.twitter.value.trim(), instagram: fields.instagram.value.trim() });
    const dirty = () => { const t = typed(); return Object.keys(t).some((k) => t[k] !== saved[k]); };
    /* The bio and links save like everything else here — when a field is left, on Enter, with the button, and when the pop-up
       closes with something still typed — so nothing written is lost to a press beside the sheet, Esc or Back. */
    let busy = null;
    const save = async (quiet) => {
      if (busy) await busy.catch(() => {});
      if (!dirty()) { if (!quiet) msg.textContent = 'Saved — your wall shows it now.'; return; }
      const body = typed();
      saveBtn.disabled = true; if (!quiet) msg.textContent = 'Saving…';
      busy = (async () => {
        try {
          const j = await window.api('/api/profile', { method: 'POST', body });
          // the server keeps only the handle from whatever was pasted (an @, a profile link): show what it kept
          const ju = j.user || {};
          const kept = { bio: ju.bio != null ? ju.bio : body.bio, twitter: ju.twitter != null ? ju.twitter : body.twitter, instagram: ju.instagram != null ? ju.instagram : body.instagram };
          Object.assign(saved, kept);
          if (fields.twitter.isConnected) { fields.twitter.value = kept.twitter; fields.instagram.value = kept.instagram; msg.textContent = 'Saved — your wall shows it now.'; }
          if (ctx.onUser) ctx.onUser(kept);
          if (quiet) toast('Bio and links saved ✅'); else sfx('success');
          if (j.pointsEarned && window.showPoints) showPoints(j.pointsEarned);
        } catch (e) {
          // nothing was saved (the server checks every field before it writes): say so, wherever the person now is
          if (fields.bio.isConnected) msg.textContent = '⚠️ ' + e.message + ' — nothing was saved.';
          else toast('⚠️ Your bio and links were not saved: ' + e.message);
          sfx('error');
        } finally { saveBtn.disabled = false; }
      })();
      return busy;
    };
    saveBtn.addEventListener('click', () => save(false));
    for (const k of Object.keys(fields)) {
      fields[k].addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(false); } });
      fields[k].addEventListener('change', () => save(false));
    }
    // opened from the full view of your picture or your banner: start at that part (the picture is the first part, so the
    // lead stays in view; the banner is brought just into view)
    const sec = ctx.focus && $('ws-sec-' + ctx.focus);
    if (sec) setTimeout(() => { try { if (ctx.focus !== 'avatar') sec.scrollIntoView({ block: 'nearest' }); sec.focus({ preventScroll: true }); } catch {} }, 0);
    // what the pop-up runs when it closes: save what is still typed, and let go of this editor's pickers
    return () => {
      if (dirty()) save(true);
      for (const z of [$('ws-accent'), $('ws-bg')]) pickers.delete(z);
    };
  }

  window.WallStyle = { AVATARS, ACCENTS, BGS, normHex, myColors, keepColor, readableAccent, readableBg, roveRadios,
    picker, drawPickers, wallPickers, imageSlot, upload, emojiPicker, swatches, editor };
})();
