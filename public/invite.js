/* ===== The invite ticket, as a modal ======================================================
 * Reading this site needs nothing. JOINING it needs a ticket, and this is the ticket: it opens
 * over whatever page someone happens to be on, the moment they try to sign up, and it closes
 * again the moment they decide they would rather keep looking.
 *
 * The flow, in order:
 *   ticket  → the holographic ticket, "I have a code", and an obvious way out
 *   code    → redeem it (one use each)
 *   terms   → read to the end, tick both boxes
 *   join    → hand off to the normal sign-up modal
 *   codes   → once they have an account: their own ten, to copy and pass on
 *
 * Loaded on demand by auth.js, together with gate.css (the ticket and the synthwave screen) and
 * invite.css (this shell). Nothing here runs until someone actually tries to join.
 */
(function () {
  'use strict';
  if (window.INVITE) return;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400000;

  async function api(path, opts) {
    const o = opts || {};
    const res = await fetch(path, {
      method: o.method || 'GET',
      credentials: 'same-origin',
      headers: o.body ? { 'Content-Type': 'application/json' } : {},
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error || ('request failed (' + res.status + ')')); e.code = j.code; throw e; }
    return j;
  }

  let root = null, state = { access: false, redeemed: false, tosAccepted: false, signedIn: false, ticket: null };
  let goldEndsAt = null, goldStartedAt = null, raf = 0, lastFocus = null, afterJoin = null;
  const $ = (id) => root && root.querySelector('#' + id);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- markup ---------- */
  function build() {
    root = document.createElement('div');
    root.id = 'invite-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Get your ticket to Send');
    root.innerHTML =
      '<canvas id="gate-bg" aria-hidden="true"></canvas>' +
      '<div class="gate-sky" aria-hidden="true"></div>' +
      '<div class="gate-scan" aria-hidden="true"></div>' +
      '<div class="gate-vig" aria-hidden="true"></div>' +
      '<button class="inv-close" id="inv-x" type="button">✕ <span>Keep browsing</span></button>' +
      '<div class="inv-wrap">' +

        /* step 1 — the ticket */
        '<div class="inv-step" id="step-ticket" data-active>' +
          '<p class="inv-kicker">Invite only · Live beta</p>' +
          '<h2 class="inv-title"><span class="hl">$GWC</span> is your ticket</h2>' +
          '<p class="inv-sub">Reading the site is open to everyone — you can carry on looking around without an account. <b>Joining</b> takes a code from someone already inside, and once you are in you get <b>ten of your own</b> to hand out.</p>' +
          ticketHtml() +
          '<p class="tk-cta" id="inv-cta">👆 Tap the ticket — <b>got a code?</b></p>' +
          '<div class="inv-actions">' +
            '<button class="g-btn g-btn-primary" id="inv-have" type="button">I have a code 🎟️</button>' +
            '<a class="g-btn g-btn-ghost" href="/terms.html" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center;">Read the terms</a>' +
          '</div>' +
          '<button class="inv-browse" id="inv-browse" type="button">No code? Keep browsing read-only →</button>' +
        '</div>' +

        /* step 2 — the code */
        '<div class="inv-step" id="step-code">' +
          '<h2 class="inv-title">Redeem your ticket</h2>' +
          '<div class="inv-panel">' +
            '<p class="inv-note">Enter the invite code someone sent you. <b>Each code works once.</b></p>' +
            '<label class="inv-note" for="inv-in" style="display:block;margin-top:0.7rem;">Invite code</label>' +
            '<input class="inv-in" id="inv-in" inputmode="latin" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" placeholder="ABCD2345" aria-describedby="inv-err">' +
            '<p class="inv-err" id="inv-err" role="status" aria-live="polite"></p>' +
            '<div class="inv-actions" style="justify-content:flex-start;margin-top:0.5rem;">' +
              '<button class="g-btn g-btn-primary" id="inv-go" type="button">Redeem 🚀</button>' +
              '<button class="g-btn g-btn-ghost" id="inv-back" type="button">Back</button>' +
            '</div>' +
          '</div>' +
          '<button class="inv-browse" id="inv-browse2" type="button">No code? Keep browsing read-only →</button>' +
        '</div>' +

        /* step 3 — the terms */
        '<div class="inv-step" id="step-tos">' +
          '<h2 class="inv-title">Before you come in</h2>' +
          '<div class="inv-panel">' +
            '<p class="inv-note">Read this all the way down. The box unlocks when you reach the end — that is the point of it.</p>' +
            '<div class="g-terms" id="inv-tos" tabindex="0" role="region" aria-label="Terms of service"></div>' +
            '<div class="g-readmark"><span id="inv-pct">0% read</span><span class="g-readbar"><span class="g-readfill" id="inv-fill"></span></span></div>' +
            '<label class="g-agree is-locked" id="inv-agree-l" for="inv-agree"><input type="checkbox" id="inv-agree" disabled><span id="inv-agree-t">Scroll to the end to unlock this box.</span></label>' +
            '<label class="g-agree" for="inv-age"><input type="checkbox" id="inv-age"><span>I am <b>18 or older</b>.</span></label>' +
            '<p class="inv-err" id="inv-tos-err" role="status" aria-live="polite"></p>' +
            '<div class="inv-actions" style="justify-content:flex-start;margin-top:0.6rem;">' +
              '<button class="g-btn g-btn-primary" id="inv-tos-go" type="button" disabled>Accept &amp; continue 🚀</button>' +
              '<a class="g-btn g-btn-ghost" href="/terms.html" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center;">Open in a new tab ↗</a>' +
            '</div>' +
          '</div>' +
        '</div>' +

        /* step 4 — make the account */
        '<div class="inv-step" id="step-join">' +
          '<h2 class="inv-title">🎟️ Your ticket is valid</h2>' +
          '<p class="inv-sub">Last step: make your account. Your place in line — your <b>Send ID</b> — is set the moment you do, and it never changes.</p>' +
          '<div class="inv-actions">' +
            '<button class="g-btn g-btn-primary" id="inv-join" type="button">Create my account 🚀</button>' +
          '</div>' +
          '<button class="inv-browse" id="inv-browse3" type="button">Later — keep browsing →</button>' +
        '</div>' +

        /* step 5 — the ten codes */
        '<div class="inv-step" id="step-codes">' +
          '<h2 class="inv-title">You are in. <span class="hl">Ten codes</span> are yours.</h2>' +
          '<p class="inv-sub" id="inv-codes-sub">One use each. Whoever redeems one gets ten of their own — that is how the room fills up.</p>' +
          ticketHtml('inv-ticket2') +
          '<div class="inv-panel">' +
            '<h3>🎟️ Your invite codes</h3>' +
            '<ul class="inv-codes" id="inv-codes"></ul>' +
            '<p class="inv-note" id="inv-copy-note">Tap a code to copy it, then send it to whoever you want inside.</p>' +
          '</div>' +
          '<div class="inv-actions">' +
            '<button class="g-btn g-btn-primary" id="inv-dl" type="button">Download my ticket 📥</button>' +
            '<button class="g-btn g-btn-ghost" id="inv-dash" type="button">See all my codes in my dashboard →</button>' +
          '</div>' +
          '<button class="inv-browse" id="inv-done" type="button">Close and carry on →</button>' +
        '</div>' +

      '</div>';
    document.body.appendChild(root);
    wire();
  }

  // The ticket markup, shared by the first and last steps (the second one gets its own ids).
  function ticketHtml(idPrefix) {
    const p = idPrefix ? idPrefix + '-' : '';
    return '<div class="ticket-stage">' +
      '<button class="ticket" id="' + p + 'ticket" type="button" aria-label="Your ticket to Send">' +
        '<span class="tk-perf" aria-hidden="true"></span>' +
        '<span class="tk-notch top" aria-hidden="true"></span>' +
        '<span class="tk-notch bot" aria-hidden="true"></span>' +
        '<span class="tk-body">' +
          '<span class="tk-top">' +
            '<img class="tk-logo" src="/assets/logo-128.png" alt="">' +
            '<span class="tk-brand">$GWC</span>' +
            '<span class="tk-admit">Admit one</span>' +
          '</span>' +
          '<span class="tk-head">Ticket to <span class="hl">Send</span></span>' +
          '<span class="tk-line">Generational Wealth Coin · Robinhood Chain · Entertainment only</span>' +
          '<span class="tk-holder">' +
            '<span class="tk-face" id="' + p + 'tk-face" aria-hidden="true">🎟️</span>' +
            '<span class="tk-who">' +
              '<span class="tk-name" id="' + p + 'tk-name">Unclaimed</span>' +
              '<span class="tk-role" id="' + p + 'tk-role">Bearer</span>' +
            '</span>' +
          '</span>' +
          '<span class="tk-grid">' +
            '<span class="tk-cell"><span class="tk-k">Send ID</span><span class="tk-v" id="' + p + 'tk-num">—</span></span>' +
            '<span class="tk-cell"><span class="tk-k">Invites left</span><span class="tk-v" id="' + p + 'tk-inv">—</span></span>' +
          '</span>' +
          '<span class="tk-launch">' +
            '<span class="tk-launch-top">' +
              '<span class="tk-launch-k" id="' + p + 'tk-launch-k">🥇 Gold OG closes in</span>' +
              '<span class="tk-launch-v" id="' + p + 'tk-launch-v">—</span>' +
            '</span>' +
            '<span class="tk-rail" aria-hidden="true"><span class="tk-rail-line"></span><span class="tk-rocket" id="' + p + 'tk-rocket" style="left:0%">🚀</span></span>' +
          '</span>' +
        '</span>' +
        '<span class="tk-stub">' +
          '<span class="tk-stub-k">Send ID</span>' +
          '<span class="tk-stub-n" id="' + p + 'tk-stub-n">???</span>' +
          '<span class="tk-bars" id="' + p + 'tk-bars" aria-hidden="true"></span>' +
          '<span class="tk-code" id="' + p + 'tk-serial">SEND·RH</span>' +
        '</span>' +
      '</button>' +
    '</div>';
  }

  /* ---------- the screen: matrix rain over a synthwave horizon ---------- */
  function startScreen() {
    const cv = $('gate-bg'); if (!cv) return;
    const ctx = cv.getContext('2d', { alpha: true }); if (!ctx) return;
    const GLYPHS = '$GWC0123456789ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ₿◆▲';
    let cols = [], w = 0, h = 0, fs = 16;
    function size() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      // from the viewport, not clientWidth: a canvas carries an intrinsic 300x150, and if the CSS has
      // not resolved when this first runs, clientWidth reports that instead of the screen.
      w = window.innerWidth || document.documentElement.clientWidth || 0;
      h = window.innerHeight || document.documentElement.clientHeight || 0;
      if (!w || !h) return;
      cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fs = w < 560 ? 13 : 16;
      cols = new Array(Math.ceil(w / fs)).fill(0).map(() => ({ y: Math.random() * -h, sp: 0.4 + Math.random() * 0.9 }));
    }
    function frame() {
      ctx.fillStyle = 'rgba(7,3,18,0.11)'; ctx.fillRect(0, 0, w, h);
      ctx.font = '700 ' + fs + 'px ui-monospace, Menlo, monospace'; ctx.textBaseline = 'top';
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i], x = i * fs;
        ctx.fillStyle = 'rgba(180,255,43,0.92)';
        ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], x, c.y);
        ctx.fillStyle = 'rgba(142,224,0,0.32)';
        ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], x, c.y - fs);
        c.y += c.sp * fs * 0.55;
        if (c.y > h + fs * 2 && Math.random() > 0.975) c.y = -fs * 4;
      }
      const hy = h * 0.76;
      ctx.strokeStyle = 'rgba(255,46,136,0.30)'; ctx.lineWidth = 1;
      for (let g = 1; g <= 14; g++) { const y = hy + Math.pow(g / 14, 2.1) * (h - hy); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      for (let g = -12; g <= 12; g++) { ctx.beginPath(); ctx.moveTo(w / 2 + g * (w / 14), hy); ctx.lineTo(w / 2 + g * w * 0.42, h); ctx.stroke(); }
      raf = requestAnimationFrame(frame);
    }
    size();
    addEventListener('resize', () => { if (!root || !root.hasAttribute('data-open')) return; cancelAnimationFrame(raf); size(); if (!reduced()) raf = requestAnimationFrame(frame); });
    if (reduced()) { ctx.fillStyle = '#070312'; ctx.fillRect(0, 0, w, h); }
    else raf = requestAnimationFrame(frame);
  }
  const stopScreen = () => { cancelAnimationFrame(raf); raf = 0; };

  /* ---------- painting the ticket ---------- */
  function bars(el, seed) {
    if (!el) return;
    let s = 0; const str = String(seed || 'SEND');
    for (let i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) >>> 0;
    let html = '';
    for (let i = 0; i < 26; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      html += '<i style="height:' + (12 + ((s >>> 8) % 18)) + 'px;width:' + (((s >>> 3) % 3) === 0 ? 3 : 2) + 'px"></i>';
    }
    el.innerHTML = html;
  }
  function fmtLeft(ms) {
    if (ms == null) return '—';
    if (ms <= 0) return 'closed';
    const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + m + 'm' : m + 'm';
  }
  function paintCountdown() {
    if (!root) return;
    for (const p of ['', 'inv-ticket2-']) {
      const v = $(p + 'tk-launch-v'); if (!v) continue;
      if (goldEndsAt == null) { v.textContent = '—'; continue; }
      const left = goldEndsAt - Date.now();
      v.textContent = fmtLeft(left);
      if (left <= 0) { const k = $(p + 'tk-launch-k'); if (k) k.textContent = '🥇 Gold OG has closed'; }
      const rocket = $(p + 'tk-rocket');
      if (rocket && goldStartedAt) {
        const gone = Math.min(1, Math.max(0, (Date.now() - goldStartedAt) / (goldEndsAt - goldStartedAt)));
        rocket.style.left = (gone * 100).toFixed(1) + '%';
      }
    }
  }
  function paintTicket() {
    const t = state.ticket;
    for (const p of ['', 'inv-ticket2-']) {
      if (!$(p + 'tk-name')) continue;
      bars($(p + 'tk-bars'), t ? 'SEND-' + t.sendId : 'SEND-UNCLAIMED');
      if (!t) { $(p + 'tk-serial').textContent = 'SEND·RH · UNCLAIMED'; continue; }
      $(p + 'tk-name').textContent = '@' + t.username;
      $(p + 'tk-role').textContent = t.invitedBy ? 'Invited by @' + t.invitedBy : 'Founding sender';
      $(p + 'tk-num').textContent = '#' + Number(t.sendId).toLocaleString('en-US');
      $(p + 'tk-stub-n').textContent = '#' + t.sendId;
      $(p + 'tk-inv').textContent = t.codesLeft + ' of ' + t.codesTotal;
      $(p + 'tk-serial').textContent = 'SEND·RH · ' + new Date(t.joinedAt).toISOString().slice(0, 10);
      const face = $(p + 'tk-face');
      if (t.avatarImg) {
        face.innerHTML = /\.(mp4|webm)$/i.test(t.avatarImg)
          ? '<video src="' + esc(t.avatarImg) + '" muted loop autoplay playsinline></video>'
          : '<img src="' + esc(t.avatarImg) + '" alt="">';
      } else face.textContent = t.avatar || '🚀';
    }
    if (t && t.goldEndsAt != null) { goldEndsAt = t.goldEndsAt; goldStartedAt = goldEndsAt - 30 * DAY; }
    paintCountdown();
  }

  /* ---------- steps ---------- */
  function show(id) {
    if (!root) return;
    root.querySelectorAll('.inv-step').forEach(s => s.removeAttribute('data-active'));
    const el = $(id); if (el) el.setAttribute('data-active', '');
    root.scrollTop = 0;
    const f = el && el.querySelector('input:not([disabled]), button:not([disabled])');
    if (f) { try { f.focus({ preventScroll: true }); } catch { f.focus(); } }
    if (id === 'step-tos') loadTerms();
    if (id === 'step-codes') paintCodes();
  }

  /* ---------- open / close ---------- */
  async function open(opts) {
    const o = opts || {};
    afterJoin = o.then || null;
    if (!root) { build(); startScreen(); }
    lastFocus = document.activeElement;
    root.setAttribute('data-open', '');
    document.body.style.overflow = 'hidden';
    if (!raf) startScreen();
    await refresh();
    // land on the step that is actually next for this person
    if (state.signedIn) show('step-codes');
    else if (state.access) show('step-join');
    else if (state.redeemed) show('step-tos');
    else show(o.step || 'step-ticket');
  }
  function close() {
    if (!root) return;
    root.removeAttribute('data-open');
    document.body.style.overflow = '';
    stopScreen();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch {} }
  }

  async function refresh() {
    try {
      state = await api('/api/gate/state');
      paintTicket();
    } catch { paintTicket(); }
    if (goldEndsAt == null) {
      try {
        const c = await api('/api/og/campaign');
        if (c && c.closes && c.closes.gold) { goldEndsAt = c.closes.gold; goldStartedAt = goldEndsAt - 30 * DAY; paintCountdown(); }
      } catch {}
    }
  }

  /* ---------- redeem ---------- */
  async function redeem() {
    const err = $('inv-err'), go = $('inv-go');
    const code = $('inv-in').value.trim();
    if (!code) { err.className = 'inv-err'; err.textContent = 'Enter the code you were given.'; return; }
    go.disabled = true; err.className = 'inv-err'; err.textContent = 'Checking…';
    try {
      const j = await api('/api/gate/redeem', { method: 'POST', body: { code } });
      err.className = 'inv-err is-ok';
      err.textContent = j.already ? 'You already have a ticket.' : '🎟️ Ticket accepted.';
      state.redeemed = true; state.tosAccepted = !!j.tosAccepted;
      setTimeout(() => show(state.tosAccepted ? 'step-join' : 'step-tos'), 500);
    } catch (e) { err.className = 'inv-err'; err.textContent = '⚠️ ' + e.message; }
    finally { go.disabled = false; }
  }

  /* ---------- the terms, and the read gate ----------
     Two conditions, both honest: the text has been scrolled to within 24px of the end, AND at least
     MIN_DWELL has passed since it opened — so a flick of the scrollbar is not "read". The copy never
     claims this proves anyone read it; it proves the text was put in front of them. */
  const MIN_DWELL = 12000;
  let tosLoaded = false, openedAt = 0, reachedEnd = false, tosTimer = 0;
  async function loadTerms() {
    const box = $('inv-tos');
    openedAt = 0; reachedEnd = false;
    if (!tosLoaded) {
      box.innerHTML = '<p>Loading the terms…</p>';
      try {
        const html = await (await fetch('/terms.html', { credentials: 'same-origin' })).text();
        const body = new DOMParser().parseFromString(html, 'text/html').getElementById('terms-body');
        box.innerHTML = body ? body.innerHTML : '<p>Could not load the terms. <a href="/terms.html" target="_blank" rel="noopener">Open them here</a>.</p>';
        tosLoaded = true;
      } catch { box.innerHTML = '<p>Could not load the terms. <a href="/terms.html" target="_blank" rel="noopener">Open them in a new tab</a> and come back.</p>'; }
    }
    checkRead();
    clearInterval(tosTimer);
    tosTimer = setInterval(() => { const s = $('step-tos'); if (s && s.hasAttribute('data-active')) checkRead(); else clearInterval(tosTimer); }, 1000);
  }
  function checkRead() {
    const box = $('inv-tos'); if (!box) return;
    if (!openedAt) openedAt = Date.now();
    const max = Math.max(1, box.scrollHeight - box.clientHeight);
    const short = box.scrollHeight <= box.clientHeight + 8;
    const seen = short ? 1 : Math.min(1, (box.scrollTop + box.clientHeight + 24) / box.scrollHeight);
    if (box.scrollTop >= max - 24 || short) reachedEnd = true;
    $('inv-fill').style.width = Math.round(seen * 100) + '%';
    const ok = reachedEnd && (Date.now() - openedAt >= MIN_DWELL);
    $('inv-pct').textContent = ok ? 'Read to the end ✅' : Math.round(seen * 100) + '% read';
    const cb = $('inv-agree');
    cb.disabled = !ok;
    $('inv-agree-l').classList.toggle('is-locked', !ok);
    $('inv-agree-t').textContent = ok
      ? 'I have read these terms. I understand this is entertainment, not financial advice, that crypto is extremely volatile, and that I can lose everything I put in.'
      : (reachedEnd ? 'Nearly — take a few more seconds with it.' : 'Scroll to the end to unlock this box.');
    if (!ok) cb.checked = false;
    $('inv-tos-go').disabled = !(ok && cb.checked && $('inv-age').checked);
  }

  /* ---------- the codes ---------- */
  async function paintCodes() {
    const list = $('inv-codes'); if (!list) return;
    list.innerHTML = '<li class="inv-note">Loading…</li>';
    try {
      const j = await api('/api/gate/invites');
      state.ticket = j.ticket; state.signedIn = true;
      paintTicket();
      list.innerHTML = renderCodes(j.ticket);
      bindCopy(list);
      $('inv-codes-sub').innerHTML = 'One use each. ' + (j.ticket.codesLeft
        ? '<b>' + j.ticket.codesLeft + '</b> of your ' + j.ticket.codesTotal + ' are still unused.'
        : 'All ' + j.ticket.codesTotal + ' have been used — that is ' + j.ticket.codesTotal + ' people you brought in.');
    } catch (e) { list.innerHTML = '<li class="inv-err">⚠️ ' + esc(e.message) + '</li>'; }
  }
  // A spent code has no characters to show: the server withholds them, because there is nothing to
  // copy and handing someone a dead code is worse than handing them none.
  function renderCodes(t) {
    // The characters and the tag each get their own box that can shrink: a long username in the tag
    // ("used · @somebody_with_a_long_handle") otherwise pushed the row out of its grid cell and over
    // the code beside it. The full name stays in the title/aria text, so nothing is lost to the trim.
    return (t.codes || []).map(c => {
      if (c.used) {
        const who = c.usedBy ? 'used · @' + c.usedBy : 'used';
        return '<li><span class="inv-code is-used" title="' + esc(who) + '" aria-label="Code ' + esc(c.hint || '') + ', ' + esc(who) + '">' +
          '<span class="inv-chars">' + esc(c.hint || '••••••••') + '</span>' +
          '<span class="inv-tag">' + esc(who) + '</span></span></li>';
      }
      return '<li><button class="inv-code" type="button" data-c="' + esc(c.code) + '" title="Copy ' + esc(c.code) + '">' +
        '<span class="inv-chars">' + esc(c.code) + '</span><span class="inv-tag">copy</span></button></li>';
    }).join('');
  }
  function bindCopy(scope) {
    scope.querySelectorAll('.inv-code[data-c]').forEach(b => b.addEventListener('click', async () => {
      const tag = b.querySelector('.inv-tag');
      try { await navigator.clipboard.writeText(b.dataset.c); tag.textContent = 'copied ✓'; }
      catch {
        // clipboard refused (http, or permission) — select it instead so a long-press/⌘C still works
        const r = document.createRange(); r.selectNodeContents(b);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
        tag.textContent = 'select it';
      }
      setTimeout(() => { tag.textContent = 'copy'; }, 2200);
    }));
  }

  /* ---------- download the ticket as a picture ----------
     Painted straight onto a canvas rather than screenshotting the DOM: no library, exact control over
     the output size, and the same image on every browser. The disclaimer is painted in, so a ticket
     shared on social carries it. */
  async function downloadTicket() {
    const t = state.ticket;
    if (!t) { show('step-ticket'); return; }
    const W = 1200, H = 630;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');

    const grd = c.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#1b1036'); grd.addColorStop(0.5, '#2a1250'); grd.addColorStop(1, '#160d2c');
    c.fillStyle = grd; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,46,136,0.35)'; c.lineWidth = 2;
    for (let g = 1; g <= 10; g++) { const y = H * 0.62 + Math.pow(g / 10, 2) * H * 0.38; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    for (let g = -8; g <= 8; g++) { c.beginPath(); c.moveTo(W / 2 + g * (W / 10), H * 0.62); c.lineTo(W / 2 + g * W * 0.5, H); c.stroke(); }
    const hol = c.createLinearGradient(0, H, W, 0);
    hol.addColorStop(0.2, 'rgba(56,232,255,0)'); hol.addColorStop(0.45, 'rgba(56,232,255,0.16)');
    hol.addColorStop(0.55, 'rgba(255,46,136,0.18)'); hol.addColorStop(0.75, 'rgba(142,224,0,0)');
    c.fillStyle = hol; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(180,255,43,0.75)'; c.lineWidth = 4; c.strokeRect(26, 26, W - 52, H - 52);
    c.setLineDash([12, 10]); c.strokeStyle = 'rgba(255,255,255,0.42)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(W - 300, 30); c.lineTo(W - 300, H - 30); c.stroke(); c.setLineDash([]);

    // measure, don't guess: a hard-coded x put "IS YOUR TICKET" right up against the "$GWC" before it
    // ("$GWCIS YOUR TICKET") on any machine where Rubik renders a touch wider than it was eyeballed at.
    c.fillStyle = '#b4ff2b'; c.font = '800 30px Rubik, system-ui, sans-serif';
    c.fillText('$GWC', 64, 100);
    const brandW = c.measureText('$GWC').width;
    c.fillStyle = 'rgba(255,255,255,0.78)'; c.font = '700 20px Rubik, system-ui, sans-serif';
    c.fillText('IS YOUR TICKET', 64 + brandW + 14, 100);
    c.fillStyle = '#ffffff'; c.font = '800 74px Rubik, system-ui, sans-serif'; c.fillText('Ticket to Send', 64, 196);

    // the holder's own picture — best effort: a failed image must never stop the download
    let faceDrawn = false;
    if (t.avatarImg && !/\.(mp4|webm)$/i.test(t.avatarImg)) {
      try {
        const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = t.avatarImg; });
        c.save(); c.beginPath(); c.roundRect(64, 250, 132, 132, 20); c.clip();
        c.drawImage(img, 64, 250, 132, 132); c.restore();
        c.strokeStyle = '#8ee000'; c.lineWidth = 4; c.beginPath(); c.roundRect(64, 250, 132, 132, 20); c.stroke();
        faceDrawn = true;
      } catch {}
    }
    if (!faceDrawn) {
      c.fillStyle = 'rgba(255,255,255,0.09)'; c.beginPath(); c.roundRect(64, 250, 132, 132, 20); c.fill();
      c.font = '80px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(t.avatar || '🚀', 130, 348); c.textAlign = 'left';
    }

    c.fillStyle = '#ffffff'; c.font = '800 44px Rubik, system-ui, sans-serif'; c.fillText('@' + t.username, 224, 300);
    c.fillStyle = '#38e8ff'; c.font = '700 22px Rubik, system-ui, sans-serif';
    c.fillText(t.invitedBy ? ('INVITED BY @' + t.invitedBy.toUpperCase()) : 'FOUNDING SENDER', 224, 336);
    c.fillStyle = 'rgba(255,255,255,0.62)'; c.font = '600 22px Rubik, system-ui, sans-serif';
    c.fillText('Joined ' + new Date(t.joinedAt).toISOString().slice(0, 10), 224, 372);

    c.fillStyle = 'rgba(255,255,255,0.55)'; c.font = '800 18px Rubik, system-ui, sans-serif';
    c.fillText('ENTERTAINMENT ONLY · NOT FINANCIAL ADVICE · NOT AFFILIATED WITH ROBINHOOD MARKETS, INC.', 64, H - 62);
    c.fillStyle = 'rgba(255,255,255,0.8)'; c.font = '700 20px Rubik, system-ui, sans-serif'; c.fillText('sendrh.com', 64, H - 96);

    // the stub: the Send ID is the headline number on it
    c.textAlign = 'center';
    const sx = W - 150;
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.font = '800 20px Rubik, system-ui, sans-serif'; c.fillText('SEND ID', sx, 150);
    /* The Send ID is the headline, and it grows: #7 and #1,048,576 are the same field. Shrink the type
       until it fits the stub rather than letting a later member's number run off the ticket. */
    const idText = '#' + t.sendId;
    const STUB_W = 240;
    let idSize = 110;
    c.font = '800 ' + idSize + 'px Rubik, system-ui, sans-serif';
    while (c.measureText(idText).width > STUB_W && idSize > 34) {
      idSize -= 4;
      c.font = '800 ' + idSize + 'px Rubik, system-ui, sans-serif';
    }
    c.fillStyle = '#b4ff2b'; c.fillText(idText, sx, 260);
    c.fillStyle = 'rgba(255,255,255,0.5)'; c.font = '700 18px Rubik, system-ui, sans-serif'; c.fillText('ADMIT ONE', sx, 320);
    let s = 0; const str = 'SEND-' + t.sendId;
    for (let i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) >>> 0;
    let bx = sx - 110; c.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 34; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      const bw = ((s >>> 3) % 3) === 0 ? 5 : 3;
      c.fillRect(bx, 380, bw, 40 + ((s >>> 8) % 40)); bx += bw + 3;
      if (bx > sx + 110) break;
    }
    c.textAlign = 'left';

    cv.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'send-ticket-' + t.sendId + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  }

  /* ---------- wiring ---------- */
  function wire() {
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    on('inv-x', close);
    on('inv-browse', close); on('inv-browse2', close); on('inv-browse3', close); on('inv-done', close);
    on('inv-have', () => show('step-code'));
    on('inv-back', () => show('step-ticket'));
    on('ticket', () => show(state.access ? (state.signedIn ? 'step-codes' : 'step-join') : 'step-code'));
    on('inv-ticket2-ticket', downloadTicket);
    on('inv-go', redeem);
    on('inv-dl', downloadTicket);
    on('inv-dash', () => { close(); location.href = '/profile.html#invites'; });
    on('inv-join', async () => {
      close();
      // auth.js caches "does this visitor hold a ticket" for the page's life, and it was answered before
      // this modal existed. Refresh it, or the Sign-up tab we are about to open would look at a stale no
      // and bounce straight back here.
      if (window.AUTH && AUTH.gate) { try { await AUTH.gate(true); } catch {} }
      // hand off to the account modal the rest of the site uses — the ticket's job is done
      if (window.AUTH && AUTH.openSignup) AUTH.openSignup();
      else if (window.AUTH && AUTH.open) AUTH.open();
      if (typeof afterJoin === 'function') { try { afterJoin(); } catch {} }
    });
    on('inv-tos-go', async () => {
      const err = $('inv-tos-err'), go = $('inv-tos-go');
      if (!$('inv-agree').checked) { err.textContent = 'Tick the box to confirm you have read the terms.'; return; }
      if (!$('inv-age').checked) { err.textContent = 'You must confirm you are 18 or older.'; return; }
      go.disabled = true; err.textContent = '';
      try { await api('/api/gate/accept', { method: 'POST', body: { version: state.tosVersion, age18: true } }); state.access = true; show('step-join'); }
      catch (e) { err.textContent = '⚠️ ' + e.message; go.disabled = false; }
    });
    const input = $('inv-in');
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') redeem(); });
    const tos = $('inv-tos'); if (tos) tos.addEventListener('scroll', checkRead);
    const agree = $('inv-agree'), age = $('inv-age');
    const both = () => { $('inv-tos-go').disabled = !($('inv-agree').checked && $('inv-age').checked && !$('inv-agree').disabled); };
    if (agree) agree.addEventListener('change', both);
    if (age) age.addEventListener('change', both);
    // Esc closes it, at every step. Somebody who does not have a code must never feel trapped.
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root && root.hasAttribute('data-open')) close(); });
    setInterval(paintCountdown, 30000);
  }

  /* ---------- the dashboard section ----------
     The same codes, on a page they already know, so "where are my codes" has an answer that is not
     "reopen the modal you closed". */
  async function mountDashboard(host) {
    if (!host || host.dataset.invMounted) return;
    host.dataset.invMounted = '1';
    host.classList.add('inv-dash');
    host.innerHTML = '<div class="inv-dash-head"><h3>🎟️ Your invite codes</h3><span class="inv-dash-count" id="inv-dash-count">loading…</span></div>' +
      '<ul class="inv-codes" id="inv-dash-codes"></ul>' +
      '<p class="inv-note" id="inv-dash-note"></p>';
    try {
      const j = await api('/api/gate/invites');
      const t = j.ticket;
      host.querySelector('#inv-dash-count').textContent = t.codesLeft + ' of ' + t.codesTotal + ' left';
      const list = host.querySelector('#inv-dash-codes');
      list.innerHTML = renderCodes(t);
      bindCopy(list);
      host.querySelector('#inv-dash-note').innerHTML =
        'Tap an unused code to copy it. <b>Each code works once</b> — a used one is shown here for the record and can’t be copied, because it will never work again. ' +
        'Your Send ID is <span class="inv-sendid">#' + Number(t.sendId).toLocaleString('en-US') + ' <small>Send ID</small></span> — your place in line, set when you joined, and it never changes. ' +
        '<button class="linklike" type="button" id="inv-dash-dl">Download your ticket 📥</button>';
      state.ticket = t;
      const dl = host.querySelector('#inv-dash-dl');
      if (dl) dl.addEventListener('click', downloadTicket);
    } catch (e) {
      host.querySelector('#inv-dash-count').textContent = '';
      host.querySelector('#inv-dash-note').textContent = '⚠️ ' + e.message;
    }
  }

  window.INVITE = { open, close, mountDashboard, refresh, download: downloadTicket };
})();
