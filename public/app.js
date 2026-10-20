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

  const COLORS = ['#c6f000', '#a8ce00', '#ffb340', '#00C805', '#ffffff'];
  const EMOJI = ['🚀', '💸', '🪙', '💰', '🔥'];

  /* opts: count, emojiRatio, and for a burst with its own character (the hunt's ghosts rise and linger):
     emoji — the set to draw from · gravity — per-frame pull (negative floats upward) · lift — the initial upward
     kick · speed / fade / scale — multipliers on how fast they fly, how fast they fade, how big they are. */
  function burst(x, y, opts = {}) {
    if (window.__confettiEnabled === false) return;
    if (document.hidden) return; // don't queue particles the paused rAF can't animate until refocus
    try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch {} // global reduced-motion gate for every call site
    const n = opts.count || 26;
    const set = Array.isArray(opts.emoji) && opts.emoji.length ? opts.emoji : EMOJI;
    const g = opts.gravity != null ? opts.gravity : 0.22, lift = opts.lift != null ? opts.lift : 3;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (opts.speed || 1) * (4 + Math.random() * 7);
      parts.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - lift, g,
        rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.3 * (opts.speed || 1),
        life: 1, decay: (0.012 + Math.random() * 0.012) * (opts.fade || 1),
        size: (5 + Math.random() * 6) * (opts.scale || 1),
        emoji: Math.random() < (opts.emojiRatio ?? 0.22) ? set[(Math.random() * set.length) | 0] : null,
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
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.99; p.rot += p.vr; p.life -= p.decay;
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
  zone.setAttribute('aria-atomic', 'false');   // per toast, not per queue: atomic here re-announces every toast still in the zone
  zone.setAttribute('aria-relevant', 'additions');
  document.body.appendChild(zone);
  /* Shared OG badge — rendered next to an OG's username everywhere. Hover shows a simple explanation
     (native title). OG = verified early buyer of BOTH $Send and $GWC who still holds both, in one of
     three entry windows: gold (until the beta ends, ×10), silver (the 90 days after that, ×5), bronze
     (until $GWC turns one year old, ×3). Lost only on a full sell-out.

     The argument is the TIER (0-3), which is what every `og` field now carries from the server. It
     used to be a boolean and every label here was hardcoded to gold's "10×" — passing a silver holder
     through that printed a multiplier they are not paid, in the badge, the tooltip AND the screen
     reader label. Nothing about the number is hardcoded any more; unknown values render nothing
     rather than guessing a tier. 0 is falsy, so every existing `if (u.og)` call site still gates
     correctly with no change. */
  window.OG_TIERS = {
    4: { name: 'Diamond', mult: 20, when: 'in the first month of $GWC, as a net buyer of both that month,' },
    3: { name: 'Gold', mult: 10, when: 'before the beta ended' },
    2: { name: 'Silver', mult: 5, when: 'in the 90 days after the beta ended' },
    1: { name: 'Bronze', mult: 3, when: 'before $GWC turned one year old' },
  };
  window.ogTip = function (tier) {
    var t = window.OG_TIERS[tier];
    if (!t) return '';
    return 'OG ' + t.name + ' — bought BOTH $Send and $GWC ' + t.when + ' and still holds both (checked on-chain). '
      + 'Permanent badge + a ' + t.mult + '× Send Power bonus on everything (+' + (t.mult - 1) + '× on top of any other boosts — boosts add, they don’t multiply). Lost if they sell out of either.';
  };
  // kept for anything still reading the old global; gold is the tier it always described
  window.OG_TIP = window.ogTip(3);
  // Every OG badge opens the About page's OG section, where the tiers, dates and rules are written out.
  window.OG_RULES_HREF = '/about#og-rules';
  window.ogBadge = function (og, where) {
    // native title = hover explanation (browser-positioned, never clips); aria-label = screen readers.
    var tier = Number(og) || 0;
    var t = window.OG_TIERS[tier];
    if (!t) return '';
    // every tier keeps the base `og-badge` class: profile.js, wall.js and upage.js each find and
    // remove a stale badge by that selector before re-inserting, and a variant-only class would
    // leave them behind to duplicate.
    var cls = 'og-badge og-badge--' + t.name.toLowerCase();
    var label = 'OG ' + t.name + ', verified early buyer with a ' + t.mult + ' times Send Power bonus';
    var tip = window.ogTip(tier) + ' Click the badge to read how OG badges work.';
    // where = 'in-link': the badge sits inside another link (the nav's name pill, a search hit, a call's sender row).
    // A link inside a link is invalid HTML, so it stays a span and the click handler below takes it to the same place.
    if (where === 'in-link') return '<span class="' + cls + '" data-og-link role="img" aria-label="' + label + '" title="' + tip + '">OG</span>';
    // where = 'new-tab': a modal with a draft in it (the composer), so the draft stays put
    return '<a class="' + cls + '" href="' + window.OG_RULES_HREF + '"' + (where === 'new-tab' ? ' target="_blank" rel="noopener"' : '')
      + ' aria-label="' + label + '. Read how OG badges work" title="' + tip + '">OG</a>';
  };
  // Capture phase, so a card or row that opens on click never fires as well. A real badge link then follows its
  // own href; a span badge inside another link cancels that link and goes to the OG section instead.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.og-badge') : null;
    if (!b || e.button) return;
    e.stopPropagation();
    if (b.tagName === 'A') return;
    e.preventDefault();
    if (e.metaKey || e.ctrlKey || e.shiftKey) window.open(window.OG_RULES_HREF, '_blank', 'noopener');
    else location.href = window.OG_RULES_HREF;
  }, true);

  /* ===== Shared avatar renderer =====================================================================
     A profile picture can be a still image, an animated GIF, or a short video (mp4/webm). A GIF animates
     inside a plain <img> — nothing else needed. A video cannot load into an <img> at all, which is why a
     video avatar silently fell back to the emoji everywhere except the profile page's own preview. So the
     element is chosen by the file, in ONE place, and every site that shows a profile picture goes through
     it. Videos are muted, looped and inline — the only combination browsers will autoplay — never autoplay
     under reduced motion, and pause while the tab is hidden so a wall full of them costs nothing unseen. */
  const AVATAR_VIDEO = /\.(mp4|webm)(\?.*)?$/i;
  /* src is only ever the server-shaped /uploads/<24 hex>.<ext> path (saveImage / /api/profile/image), so
     anything else is refused outright rather than escaped — the helper's name promises safety and every
     page that shows a person goes through it. attrs is the caller's literal attribute string; it is
     allow-listed to the handful of shapes the call sites actually pass, so a future caller cannot turn it
     into an injection point by handing over user text. */
  const AVATAR_SRC = /^\/uploads\/[a-f0-9]{24}\.(jpg|png|webp|gif|mp4|webm)$/i;
  const AVATAR_ATTRS = /^(\s*(loading="lazy"|width="\d{1,4}"|height="\d{1,4}"|style="[^"<>&]*"))*\s*$/;
  const escAttr = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.avatarHTML = function (src, cls, attrs) {
    if (!src || !AVATAR_SRC.test(String(src))) return '';
    const s = escAttr(src), c = escAttr(cls);
    const a = attrs && AVATAR_ATTRS.test(String(attrs)) ? ' ' + String(attrs).trim() : '';
    if (AVATAR_VIDEO.test(String(src))) {
      const auto = (window.prefersReduced && window.prefersReduced()) ? '' : ' autoplay';
      return '<video class="' + c + '" src="' + s + '" muted loop playsinline preload="metadata" aria-hidden="true" data-avatar-video="1"' + auto + a + '></video>';
    }
    return '<img class="' + c + '" src="' + s + '" alt=""' + a + '>';
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

  window.burst = burst;   // eggs.js celebrates a find with the same confetti as everything else
  window.sendToast = function (msg, ms) {   // ms: how long it stays — longer for a sentence the reader has to act on
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    zone.appendChild(t);
    setTimeout(() => t.remove(), ms || 2600);
  };

  // --- matrix tiles: the pointer lights the cells under it (styles.css reads --mx/--my on the control) ---
  (function () {
    // every tile: the position/isolation list at the end of styles.css, plus the tiles the gate, invite, governance,
    // moderation and token-text stylesheets declare. scripts/check.mjs fails when this list and that block drift apart.
    const SEL = '.btn, .react-btn, .feed-tab, .dtab, .oc-tf, .np-seg, .np-vs-btn, .mp-btn, .copy-btn, .nav-toggle, .sc-hop, .np-row-call, .motion-btn, .npm-item, .auth-seg, .auth-tab, .profile-link, .np-caret-btn, .swap-choice, .file-label, .vote-btn, .sort-btn, .linklike, .oauth-btn, .btn-follow, .gobj-link, .wc-item, .wc-deep, .np-search-clear, .np-tickcopy, .tm-x, .pin-chip-open, .pin-chip-rm, .np-pin, .np-sort, .np-more, .np-refresh, .np-hidden-link, .np-status button, .np-newbar, .np-lookup-clear, .ab-chip, .np-chip, .np-den, .np-sv-apply, .np-sv-del, .np-runner-pin, .np-runner-chart, .np-rail-btn, .np-feed-fresh, .np-watch, .np-wl-remove, .notif-bell, .notif-clearall, .notif-x, .sc-btn, .sc-senders-toggle, .wall-tab, .lb-win, .ll-toggle button, .comm-tab, .ge-info, .cmp-mode, .np-chain-btn, .oc-mk, .ll-info, .arena-tab, .np-social-btn, .cw-tab, .np-strat, .np-fclose, .pillar > summary, .oc-data > summary, .b0-conn summary, .risk-chip, .g1-w-link, .sc-info, .g-btn, .g-x, .g-code, .inv-close, .inv-browse, .inv-code, .snap-tab, .mute-flag, .mod-item, .tok-chip, .tok-copy, .tok-comm, .sc-tab';
    let raf = 0, pending = null;
    const paint = () => {
      raf = 0; const e = pending; pending = null; if (!e) return;
      const el = e.target && e.target.closest && e.target.closest(SEL); if (!el) return;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    };
    document.addEventListener('pointermove', (e) => { pending = e; if (!raf) raf = requestAnimationFrame(paint); }, { passive: true });
    document.addEventListener('pointerout', (e) => {
      const el = e.target && e.target.closest && e.target.closest(SEL);
      if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) { el.style.removeProperty('--mx'); el.style.removeProperty('--my'); }
    }, { passive: true });
  })();
  // --- report a post or comment (X01): one handler for every wall; the server writes a reports row the operator reads
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-report]');
    if (!b) return;
    e.preventDefault();
    if (!(window.AUTH && AUTH.user)) { if (window.AUTH && AUTH.open) AUTH.open(); return; }
    const kind = b.dataset.report, id = Number(b.dataset.reportId);
    const what = b.dataset.reportWhat || kind;   // the reader's word for it ('hopcomment' is a comment under someone's Sent It)
    const reason = window.prompt('Why are you reporting this ' + what + '? (optional — a sentence helps the moderators)');
    if (reason === null) return;
    b.disabled = true;
    try {
      const r = await fetch('/api/report', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id, reason: String(reason).slice(0, 500) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'could not send the report');
      if (window.sendToast) sendToast(j.already ? 'You already reported this — thanks, it is in the queue' : '⚑ Reported. A moderator will look at it.');
      b.setAttribute('aria-pressed', 'true');
    } catch (err) { b.disabled = false; if (window.sendToast) sendToast('⚠️ ' + err.message); }
  });
  // --- shared scroll lock (F086): overlays stack (the proof check over the composer); each one used to write
  //     body.style.overflow = '' on close, unlocking the page under the one still open. A counter, and the value
  //     that was there before the first lock, restored when the last lock goes.
  (function () {
    let n = 0, prev = '';
    window.lockScroll = function () { if (n++ === 0) { prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; } };
    window.unlockScroll = function () { if (n > 0 && --n === 0) document.body.style.overflow = prev; };
  })();
  // --- optional media (X04): the feature video and its poster ship outside git; hide what is not on this deploy ---
  (function () {
    const vids = document.querySelectorAll('video[data-optional-media]');
    if (!vids.length) return;
    fetch('/api/config', { credentials: 'same-origin' }).then(r => r.json()).then(j => {
      const media = (j && j.media) || {};
      vids.forEach(v => {
        if (media.poster === false) v.removeAttribute('poster');
        if (media.video === false) { const sec = v.closest('section') || v.closest('.feature-frame'); if (sec) sec.hidden = true; }
      });
    }).catch(() => {});
  })();
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
  document.documentElement.classList.add('js');   // .reveal parks at opacity 0 only under html.js — see styles.css
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  /* the net: if the observer never fires (a throttled or backgrounded document), nothing stays parked.
     Everything off-screen is off-screen anyway, so revealing it early costs nothing visible. */
  setTimeout(() => document.querySelectorAll('.reveal:not(.shown)').forEach(el => { el.classList.add('shown'); io.unobserve(el); }), 2500);

  // --- logo easter egg: click logo → mega send ---
  document.querySelectorAll('.hero-logo-btn, .nav-logo img').forEach(el => {
    el.addEventListener('click', (e) => {
      const r = el.getBoundingClientRect();   // Enter/Space fire click at 0,0 — burst from the logo instead of the corner
      burst(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2, { count: 60, emojiRatio: 0.4 });
      sendToast('JUST SEND IT! 🚀🚀🚀');
    });
  });

  /* ===== shared helpers reused by entry.js / compose.js / tour.js ===== */

  // reduced-motion check, safe in private mode / old browsers
  window.prefersReduced = function () {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  };

  /* A strip that scrolls sideways (the profile's tabs, the Scanner's quick filters, a community's snapshots) says that it
     does: .cue-end while there is more to the right, .cue-start once it has moved (styles.css draws a fade and a ›/‹ there).
     Their scroll bars are hidden or thin, and a phone shows none at all, so without this a tab past the edge just looked
     missing (owner, 2026-10-15: "if you have to have a scroll on smaller screens make sure users know"). Content arrives
     later (the snapshots, the chips) and the strip resizes, so both are watched. */
  window.scrollCue = function (el) {
    if (!el || el._scrollCue) return;
    el._scrollCue = true;
    const update = () => {
      const left = el.scrollLeft, max = el.scrollWidth - el.clientWidth;
      el.classList.toggle('cue-start', left > 2);
      el.classList.toggle('cue-end', max - left > 2);
    };
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    // a tab or chip reached with the keyboard comes into view clear of the cue (scroll-padding-inline in styles.css)
    el.addEventListener('focusin', (e) => { const t = e.target; if (t !== el && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
    // a tap on the ›/‹ itself (it is the strip's own ::after/::before, so the strip is the target) scrolls the strip that way
    el.addEventListener('click', (e) => {
      if (e.target !== el) return;
      const r = el.getBoundingClientRect(), edge = Math.min(64, r.width / 3);
      const dir = e.clientX >= r.right - edge && el.classList.contains('cue-end') ? 1 : e.clientX <= r.left + edge && el.classList.contains('cue-start') ? -1 : 0;
      if (!dir) return;
      let still = false; try { still = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('motion-off'); } catch {}
      el.scrollBy({ left: dir * Math.max(80, el.clientWidth * 0.75), behavior: still ? 'auto' : 'smooth' });
    });
    try { if (window.ResizeObserver) new ResizeObserver(update).observe(el); } catch {}
    try { new MutationObserver(update).observe(el, { childList: true, subtree: true, characterData: true }); } catch {}
    update();
  };
  const cueAll = () => document.querySelectorAll('[data-scroll-cue]').forEach(window.scrollCue);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cueAll); else cueAll();

  // trap Tab focus inside a container; returns a release() to remove the trap
  window.trapFocus = function (container) {
    const SEL = 'a[href],button:not([disabled]),textarea,input:not([disabled]),select,details > summary,iframe,video[controls],audio[controls],[tabindex]:not([tabindex="-1"])';   // a pop-down's <summary> is a stop too (the token dashboard can end on one); so are an outside chart's frame and a video with controls
    function onKey(e) {
      if (e.key !== 'Tab') return;
      const items = [...container.querySelectorAll(SEL)].filter(el => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      // Shift+Tab from the first stop, or from the dialog itself (a pop-up that focuses its own box on open), wraps to the last
      if (e.shiftKey && (document.activeElement === first || document.activeElement === container)) { e.preventDefault(); last.focus(); }
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
  /* Matches the server's own cap for a voice memo. The recorder stops itself at two minutes, so in
     practice this is a backstop against a hand-rolled upload rather than the thing a memo runs into. */
  const AUDIO_HARD = 8 * 1024 * 1024;
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
    /* A voice memo arrives here as a Blob from the recorder, not a chosen file, and needs no processing —
       the browser has already encoded it. Chrome/Firefox hand over audio/webm, Safari and iOS audio/mp4,
       and both have to pass or the feature works on half the phones in the room. */
    const isAudio = type === 'audio/webm' || type === 'audio/mp4' || type === 'audio/ogg';
    if (!isGif && !isVideo && !isImg && !isAudio) { toast(type.indexOf('video/') === 0 ? 'That video format isn’t supported — use MP4 or WebM 🎬' : 'Use a JPG, PNG, WebP, GIF, MP4 or WebM 🖼️'); return null; }
    try {
      if (isAudio) {
        if (file.size <= AUDIO_HARD) return { blob: file, kind: 'audio', mime: type };
        toast('That memo is too long — keep it under two minutes 🎤'); return null;
      }
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
    const node = document.createElement(kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'img');
    node.className = 'media-preview-el' + (kind === 'audio' ? ' media-preview-audio' : '');
    node.src = src;
    if (kind === 'video') { node.muted = true; node.playsInline = true; node.loop = true; node.controls = true; node.preload = 'metadata'; node.setAttribute('aria-label', 'Attached video preview'); }
    /* Never muted and never looping: a voice memo you cannot hear before sending is not a preview, and
       one that repeats forever is a nuisance. Nothing autoplays. */
    else if (kind === 'audio') { node.controls = true; node.preload = 'metadata'; node.setAttribute('aria-label', 'Listen back to your voice memo before posting'); }
    else node.alt = 'Attached ' + (kind === 'gif' ? 'GIF' : 'image') + ' preview';
    el.appendChild(node);
    if (typeof onClear === 'function') {
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'media-preview-rm'; rm.title = 'Remove'; rm.setAttribute('aria-label', 'Remove attached media'); rm.textContent = '✕';
      rm.setAttribute('data-tip', 'Takes this attachment off the post you are writing');
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
    /* A voice memo is a first-class post, so it gets a labelled player rather than a bare <audio>: the
       label is what a screen reader announces and what tells anyone scrolling past what they are looking
       at. No autoplay, no loop — it plays when somebody asks it to. */
    if (/\.(weba|m4a|ogg|mp3)$/i.test(escUrl)) {
      return '<span class="post-voice"><span class="post-voice-tag" aria-hidden="true">🎤 Voice memo</span>' +
        '<audio class="post-audio" src="' + escUrl + '" controls preload="none" aria-label="Voice memo posted by ' + who + '"></audio></span>';
    }
    if (/\.(mp4|webm|mov)$/i.test(escUrl)) return '<video class="post-img post-video" src="' + escUrl + '" controls loop muted playsinline preload="metadata" aria-label="Video posted by ' + who + '"></video>';
    const isGif = /\.gif$/i.test(escUrl);
    const img = '<img class="post-img' + (isGif ? ' post-gif' : '') + '"' + (isGif ? ' data-gif="1"' : '') + ' src="' + escUrl + '" alt="' + (isGif ? 'Animated GIF' : 'Media') + ' posted by ' + who + '" loading="lazy">';
    // every animated GIF gets a real, keyboard-reachable pause/play control (WCAG 2.2.2) — a looping <img> can't be stopped any other way
    return isGif ? '<span class="gif-wrap">' + img + '<button class="gif-toggle" type="button" data-tip="Freezes this GIF on one frame, or lets it move again" aria-pressed="false" aria-label="Pause animated GIF" title="Pause">⏸</button></span>' : img;
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

/* ===== Motion pause (WCAG 2.2.2) ===============================================================
   The ticker, the OG banner sweeps, the hero field, the world grid and the breathing FAB all start on
   their own and never stop. prefers-reduced-motion stops them, but that is an OS setting, not a control
   in the content; the signed-in "effects" pref only reaches people with an account. This is the switch
   for everyone: a ⏸ in the nav that toggles html.motion-off (styles.css pauses every ambient animation
   under it) and remembers the choice in this browser. State animations — toasts, meter fills, focus —
   are deliberately not on that list. The same switch pauses the site's sound effects (sfx.js — owner, 2026-10-13:
   "users can pause those sounds also through the pause button in the nav bar that also pauses animations"): one ⏸,
   motion and sound together. The theme tune keeps its own button. */
(function () {
  const KEY = 'send.motion';
  const root = document.documentElement;
  let off = false; try { off = localStorage.getItem(KEY) === 'off'; } catch {}
  if (off) root.classList.add('motion-off');
  function mount() {
    const nav = document.querySelector('nav.nav'); if (!nav || document.getElementById('motion-btn')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'motion-btn'; b.className = 'motion-btn';
    b.setAttribute('aria-pressed', String(off));
    b.setAttribute('aria-label', 'Pause motion and sound effects');   // one name; aria-pressed carries the state — a label that flips would announce the opposite of the state
    b.setAttribute('data-tip', 'Pauses or resumes the site\'s sound effects, the ticker, floating emoji and other decorative motion — remembered on this device');
    b.innerHTML = '<span aria-hidden="true">' + (off ? '▶' : '⏸') + '</span>';
    b.addEventListener('click', () => {
      off = !off;
      root.classList.toggle('motion-off', off);
      try { localStorage.setItem(KEY, off ? 'off' : 'on'); } catch {}
      b.setAttribute('aria-pressed', String(off));
      b.innerHTML = '<span aria-hidden="true">' + (off ? '▶' : '⏸') + '</span>';
      document.dispatchEvent(new CustomEvent('jsi:sfx', { detail: { on: !off } }));   // sfx.js and the slot machine stop what is sounding now
      if (!off && window.SFX) SFX.play('on');
      if (window.sendToast) sendToast(off ? 'Motion and sounds paused ⏸' : 'Motion and sounds back on ▶');
    });
    const before = nav.querySelector('#nav-notif') || nav.querySelector('#nav-auth') || nav.lastElementChild;
    nav.insertBefore(b, before);
    window.dispatchEvent(new Event('resize'));   // the bar gained a control: nav.js measures the row again
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  /* The choice is one per device: a pause pressed in another tab, or before this page was restored with Back, applies here
     too — quietly (no sound, no toast: nothing was pressed on this page). */
  function sync() {
    let now = false; try { now = localStorage.getItem(KEY) === 'off'; } catch {}
    if (now === off) return;
    off = now;
    root.classList.toggle('motion-off', off);
    const b = document.getElementById('motion-btn');
    if (b) { b.setAttribute('aria-pressed', String(off)); b.innerHTML = '<span aria-hidden="true">' + (off ? '▶' : '⏸') + '</span>'; }
    document.dispatchEvent(new CustomEvent('jsi:sfx', { detail: { on: !off } }));
  }
  window.addEventListener('storage', (e) => { if (e.key === KEY) sync(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) sync(); });
})();

/* ===== The full-screen pop-up (FullView) =========================================================================
   One pop-up for everything that opens over a page full screen: a chart (ChartFull, below — owner, 2026-10-14: "Allow a user
   to expand any chart to full screen pop up and easily be able to close it"), a wall's profile picture or banner, and your
   Wall Style editor (upage.js — owner, 2026-10-15). What it is showing fills the stage; the shell is the same for all:
   - Closing: ✕ Close, Esc, a press on the dimmed edge, or the browser's Back — opening adds one step to the history, so Back
     on a phone closes it instead of leaving the page. Focus goes back to what opened it.
   - swap() changes what it shows without closing (your picture's full view → your Wall Style editor): one history step, one
     place focus returns to.
   - size 'panel' is a smaller sheet (the editor): at the side on a wide screen, so the wall shows its changes beside it.
   A plain fixed layer above the page's own pop-ups (z 460: over the token dashboard, under the toasts, the tips, the wallet
   picker and the age question), not <dialog>.showModal() — the top layer would hide the toasts and the tips under it. */
(function () {
  let root = null, dialog = null, stage = null, titleEl = null, xBtn = null, view = null, release = null, backing = false;
  function build() {
    root = document.createElement('div');
    root.id = 'full-view'; root.className = 'cf'; root.hidden = true;
    root.innerHTML = '<div class="cf-backdrop" data-cf-close></div>' +
      '<div class="cf-dialog" role="dialog" aria-modal="true" aria-labelledby="cf-title" tabindex="-1">' +
        '<div class="cf-head"><h2 class="cf-title" id="cf-title"></h2>' +
          '<button class="cf-x" type="button" data-cf-close aria-label="Close full screen" data-tip="Closes this and takes you back to the page — Esc or your browser&#39;s Back does the same">✕ Close</button></div>' +
        '<p class="cf-turn">Turn your phone sideways for a wider view.</p>' +
        '<div class="cf-stage"></div>' +
      '</div>';
    document.body.appendChild(root);
    dialog = root.querySelector('.cf-dialog'); stage = root.querySelector('.cf-stage'); titleEl = root.querySelector('.cf-title'); xBtn = root.querySelector('.cf-x');
    root.addEventListener('click', (e) => { if (e.target.closest('[data-cf-close]')) close(e.detail > 0 ? 'pointer' : 'key'); });   // Enter or Space on ✕ is a click with no detail
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;   // other keys travel on: the arrow keys of a chart's own tabs are handled at the page level
      e.stopPropagation();   // this Esc is the content's or the pop-up's, never the page's underneath (a menu, an armed Send Call)
      // the content's own Esc goes first (a chart clears a crosshair or a zoom and says so with preventDefault); the next one closes
      if (!e.defaultPrevented) { e.preventDefault(); close('key'); }
    });
  }
  /* o = { title, size: 'full' | 'panel', turnHint (a wide thing: "turn your phone sideways"), closeLabel,
           fill(stage) → cleanup(how) | undefined, where cleanup may return the element focus should go back to } */
  function fill(o) {
    titleEl.textContent = o.title || '';
    root.classList.toggle('is-panel', o.size === 'panel');
    root.classList.toggle('has-turn', !!o.turnHint);
    xBtn.setAttribute('aria-label', o.closeLabel || 'Close full screen');
    stage.textContent = '';
    stage.scrollTop = 0;
    const c = o.fill ? o.fill(stage) : null;
    view.cleanup = typeof c === 'function' ? c : null;
  }
  function open(o) {
    if (view) return false;
    if (!root) build();
    view = { opener: o.opener || document.activeElement, cleanup: null, pushed: false };
    fill(o);
    root.hidden = false;
    if (window.lockScroll) lockScroll();
    release = window.trapFocus ? trapFocus(dialog) : null;
    // focus on the pop-up itself (a screen reader reads its title); not on ✕, whose tip would pop up over the content's corner.
    // ✕ is the first Tab stop
    try { dialog.focus({ preventScroll: true }); } catch {}
    try { history.pushState({ cf: 1 }, ''); view.pushed = true; } catch {}
    if (window.SFX) SFX.play('open');
    return true;
  }
  function swap(o) {
    if (!view) return open(o);
    const c = view.cleanup; view.cleanup = null;
    if (c) { try { c('swap'); } catch {} }
    fill(o);
    try { dialog.focus({ preventScroll: true }); } catch {}
    if (window.SFX) SFX.play('select');
    return true;
  }
  // how: 'key' (Esc, or Enter on ✕), 'pointer' (a press on ✕ or the dimmed edge), 'history' (Back)
  function close(how) {
    if (!view) return;
    const v = view; view = null;
    let back = null;
    if (v.cleanup) { try { back = v.cleanup(how); } catch {} }
    stage.textContent = '';
    root.hidden = true;
    if (release) { release(); release = null; }
    if (window.unlockScroll) unlockScroll();
    // closed by ✕ or Esc: take back the history step the pop-up added (unless something else has replaced it since)
    if (v.pushed && how !== 'history') { try { if (history.state && history.state.cf) { backing = true; history.back(); } } catch {} }
    // focus back to what opened it — or where the content says, when that is no longer drawn
    const drawn = (el) => el && el.isConnected && el.getClientRects().length > 0;
    const to = drawn(back) ? back : drawn(v.opener) ? v.opener : null;
    if (to) {
      try { to.focus({ preventScroll: true }); } catch {}
      // its tip is for the keyboard: after a press or Back it would sit over the page (on a phone, over the next thing tapped)
      if (how !== 'key' && window.sendTips) sendTips.hide();
    }
    if (window.SFX) SFX.play('close');
  }
  /* A layer the site opens above the pop-up on purpose — the $SEND check, the wallet picker, a sign-in check, the age question
     — answers Esc and Back itself; the pop-up underneath stays put (and so does its scroll lock) until it is the top layer. */
  const above = () => document.documentElement.classList.contains('age-open') || !!document.querySelector('#invite-overlay[data-open], .wc-overlay:not([hidden]), .bp-overlay:not([hidden]), #auth-modal:not([hidden])');
  // Back closes it; the step we took back ourselves is just let go; a Back meant for a layer above leaves it open (step put back)
  window.addEventListener('popstate', () => {
    if (backing) { backing = false; return; }
    if (!view || !view.pushed) return;
    if (above()) { try { history.pushState({ cf: 1 }, ''); } catch {} return; }
    close('history');
  });
  // focus somewhere outside it (a press on a part of the page that takes none): Esc still closes it — unless it is a layer's above
  document.addEventListener('keydown', (e) => { if (view && e.key === 'Escape' && !e.defaultPrevented && root && !root.contains(e.target) && !above()) close('key'); });
  /* Focus that wanders out while it is open (Tab out of an outside chart's frame, whose keys the trap never hears) is brought
     back — unless it went to a layer that sits above the pop-up on purpose (the wallet picker, a sign-in check, the age
     question, a toast, a tip). */
  document.addEventListener('focusin', (e) => {
    if (!view || !root || root.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#age-gate, .wc-overlay, .bp-overlay, #auth-modal, #invite-overlay, #toast-zone, .tip-bubble')) return;
    try { dialog.focus({ preventScroll: true }); } catch {}
  });
  window.FullView = { open, swap, close: (how) => close(how || 'key'), isOpen: () => !!view, contains: (el) => !!(root && root.contains(el)) };
})();

/* ===== Full-screen charts (owner, 2026-10-14: "Allow a user to expand any chart to full screen pop up and easily be able to
   close it") =====================================================================================================
   Every chart carries a ⤢ (button[data-cf-open]) inside its unit ([data-cf-unit]): the on-chain price chart, or the whole
   chart switch with its Dexscreener / CoinGecko views (chart.js, newpairs.js); the wallet's value chart (walletchart.js);
   the admin day charts (admin.js); the volume bars (newpairs.js); the Loot Log (gamify.js). Pressing it opens FullView with
   that chart filling it.
   - A live chart is MOVED in, not copied: the same chart, still updating, with its timeframe, zoom and source as they were.
     A placeholder of its height holds its place, so the page under it does not jump, and it goes back there on close.
     (moveBefore, where the browser has it, also keeps an outside chart's frame from reloading on the way.) A unit with a
     data-cf-key that the page draws again while it is open (the wallet chart, whose old copy stops answering) is followed:
     the new one takes its place in the view.
   - A chart drawn once from its numbers (data-cf-unit="clone") is shown as a copy, without its buttons.
   - Focus goes back to the ⤢ that opened it. */
(function () {
  let cur = null, watch = null;
  /* keep a frame's state across the move where the browser can (moveBefore); otherwise an ordinary move. After a moveBefore,
     Chrome can keep the styles of where the node WAS (the wallet chart came back with the pop-up's layout, its ⤢ still
     hidden so focus could not return to it): one forced restyle of the moved box settles it */
  const move = (parent, node, before) => {
    try {
      if (typeof parent.moveBefore === 'function' && node.isConnected && parent.isConnected) {
        parent.moveBefore(node, before || null);
        const d = node.style.display; node.style.display = 'none'; void node.offsetWidth; node.style.display = d;
        return;
      }
    } catch {}
    parent.insertBefore(node, before || null);
  };
  function holder(unit) {   // the empty box the chart leaves behind, the same size, so nothing below it moves
    const ph = document.createElement('div'), cs = getComputedStyle(unit);
    ph.className = 'cf-ph'; ph.setAttribute('aria-hidden', 'true');
    ph.style.height = Math.round(unit.getBoundingClientRect().height) + 'px';
    ph.style.margin = cs.marginTop + ' ' + cs.marginRight + ' ' + cs.marginBottom + ' ' + cs.marginLeft;
    unit.parentNode.insertBefore(ph, unit);
    return ph;
  }
  // the page drew a followed unit again while it was open: show the new one (the old one may no longer answer)
  function follow() {
    if (typeof MutationObserver !== 'function') return;
    watch = new MutationObserver(() => {
      if (!cur || !cur.ph || cur.ph.isConnected) return;
      const sel = '[data-cf-key="' + (window.CSS && CSS.escape ? CSS.escape(cur.key) : cur.key) + '"]';
      const next = [...document.querySelectorAll(sel)].find((x) => !FullView.contains(x));
      if (!next) return;   // nothing drawn in its place yet: keep showing this one
      const had = cur.shown.contains(document.activeElement), ctx = cur.shown.parentNode;
      cur.shown.classList.remove('is-cf'); cur.shown.remove();
      cur.ph = holder(next);
      move(ctx, next); next.classList.add('is-cf');
      cur.shown = next; cur.btn = next.querySelector('[data-cf-open]') || cur.btn;
      if (had) { const d = ctx.closest('.cf-dialog'); if (d) { try { d.focus({ preventScroll: true }); } catch {} } }
    });
    watch.observe(document.body, { childList: true, subtree: true });
  }
  function open(btn) {
    const unit = btn.closest('[data-cf-unit]');
    if (!unit || cur || FullView.isOpen()) return;
    const clone = unit.getAttribute('data-cf-unit') === 'clone';
    FullView.open({ title: unit.getAttribute('data-cf-title') || 'Chart', turnHint: true, opener: btn, fill: (stage) => {
      cur = { btn, clone, key: unit.getAttribute('data-cf-key') || '', ph: null, shown: null };
      const ctx = document.createElement('div');
      ctx.className = ('cf-ctx ' + (unit.getAttribute('data-cf-ctx') || '')).trim();   // a class the chart's own styles hang off (the wallet chart's .trk-dash)
      stage.appendChild(ctx);
      if (clone) {
        const c = unit.cloneNode(true);
        // the copy is for looking at: its buttons answer only on the page, and an id must not appear twice
        c.querySelectorAll('button, [data-cf-drop]').forEach((x) => x.remove());
        [c, ...c.querySelectorAll('[id], [aria-labelledby], [aria-describedby], [aria-controls]')].forEach((x) => { for (const a of ['id', 'aria-labelledby', 'aria-describedby', 'aria-controls']) x.removeAttribute(a); });
        c.querySelectorAll('[data-fill]').forEach((x) => { x.style.width = x.getAttribute('data-fill') + '%'; });   // bars the page grows in as they scroll into view, at their full length
        ctx.appendChild(c);
        cur.shown = c;
      } else {
        cur.ph = holder(unit);
        move(ctx, unit);
        unit.classList.add('is-cf');
        cur.shown = unit;
        if (cur.key) follow();
      }
      return putBack;
    } });
  }
  // closing: the chart goes back to its place, and focus to its ⤢ — or, if that one is no longer drawn (the switch swapped its
  // ⤢ for the one beside its source buttons while it was open), to the ⤢ of the same chart that is
  function putBack() {
    const c = cur; cur = null;
    if (!c) return null;
    if (watch) { watch.disconnect(); watch = null; }
    if (!c.clone) {
      if (c.ph && c.ph.isConnected) move(c.ph.parentNode, c.shown, c.ph);
      else c.shown.remove();   // the page drew that spot again while this was open, with a chart of its own: this one is not needed
      c.shown.classList.remove('is-cf');
      if (c.ph) c.ph.remove();
    }
    const drawn = (el) => el && el.isConnected && el.getClientRects().length > 0;
    if (drawn(c.btn)) return c.btn;
    const u = c.clone ? (c.btn && c.btn.closest('[data-cf-unit]')) : (c.shown && c.shown.isConnected ? c.shown : null);
    return (u && [...u.querySelectorAll('[data-cf-open]')].find(drawn)) || null;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cf-open]');
    if (!b || FullView.contains(b)) return;
    e.preventDefault();
    open(b);
  });
  window.ChartFull = { open, close: () => FullView.close('key'), isOpen: () => FullView.isOpen() };
})();
