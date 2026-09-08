/* ===== about.js — interactive About page (CSP-safe: addEventListener only, no inline JS) =====
 * Behavior-only. Renders no user HTML → uses textContent throughout (no innerHTML, no esc()).
 * Never calls window.showPoints (it mutates real points / throws logged-out) — all demos are visual-only.
 * Never injects .reveal nodes (the observer runs once at load over static DOM). */
(function () {
  'use strict';
  var reduced = function () { return !!(window.prefersReduced && window.prefersReduced()); };
  var $ = function (id) { return document.getElementById(id); };

  /* --- 1. Share chip: hand off to app.js's delegated [data-copy] handler (copy + toast + confetti) --- */
  (function () {
    var el = $('ab-share');
    if (el) { try { el.dataset.copy = location.href; } catch (e) {} }
  })();

  /* --- 2. Sign-in / connect CTAs: open the auth modal, or fall back to the profile page --- */
  function openAuth(e) {
    if (e) e.preventDefault();
    if (window.AUTH && typeof window.AUTH.open === 'function') window.AUTH.open();
    else location.href = 'profile.html';
  }
  ['gs-join', 'gs-connect', 'pillar-connect', 'join-signin'].forEach(function (id) {
    var b = $(id); if (b) b.addEventListener('click', openAuth);
  });

  /* --- 3. Get-started tracker: cosmetic check-offs, persisted per-browser (never awards real points) --- */
  (function () {
    var steps = Array.prototype.slice.call(document.querySelectorAll('.gs-steps .step'));
    if (!steps.length) return;
    var fill = $('gs-progress-fill'), text = $('gs-progress-text'), done = $('gs-done-msg');
    var bar = fill ? fill.parentElement : null;
    var total = steps.length, KEY = 'about.gs';
    var set = {};
    try { set = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { set = {}; }

    function count() { var n = 0; for (var k in set) if (set[k]) n++; return n; }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(set)); } catch (e) {} }

    function render(celebrate) {
      var n = count(), pct = Math.round((n / total) * 100);
      if (fill) fill.style.width = pct + '%';
      if (text) text.textContent = n + ' / ' + total + ' done';
      if (bar) bar.setAttribute('aria-valuenow', String(n));
      if (done) done.hidden = n < total;
      if (celebrate && n >= total) {
        if (window.sendConfetti) window.sendConfetti(innerWidth / 2, innerHeight / 2, { count: 60, emojiRatio: 0.4 });
        if (window.sendToast) window.sendToast('All 4 steps — send it! 🚀');
      }
    }

    steps.forEach(function (step) {
      var id = step.getAttribute('data-gs-step');
      var btn = step.querySelector('.gs-check');
      if (!btn || !id) return;
      var on = !!set[id];
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      step.classList.toggle('is-done', on);
      btn.addEventListener('click', function () {
        var now = !set[id];
        set[id] = now;
        btn.setAttribute('aria-pressed', now ? 'true' : 'false');
        step.classList.toggle('is-done', now);
        save();
        render(true);
      });
    });
    render(false);
  })();

  /* --- 4. Pillar accordion sugar: single-open + a tiny confetti puff (caret rotation is pure CSS) --- */
  (function () {
    var pillars = Array.prototype.slice.call(document.querySelectorAll('.pillar'));
    pillars.forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (!d.open) return;
        pillars.forEach(function (o) { if (o !== d) o.open = false; });   // single-open accordion
        if (!reduced() && window.sendConfetti) {
          var s = d.querySelector('summary'), r = s ? s.getBoundingClientRect() : null;
          if (r) window.sendConfetti(r.left + r.width / 2, r.top + r.height / 2, { count: 10, spread: 40 });
        }
      });
    });
  })();

  /* --- 5. Send Power demo: exact server formula (server.js:378-380). Visual-only. --- */
  (function () {
    var action = $('ab-action'), supply = $('ab-supply'), days = $('ab-days');
    if (!action || !supply || !days) return;
    var supplyOut = $('ab-supply-out'), daysOut = $('ab-days-out'), tier = $('ab-tier');
    var eqBase = $('ab-eq-base'), eqMult = $('ab-eq-mult'), eqTotal = $('ab-eq-total'), cap = $('ab-cap');

    // MUST mirror server.js DIAMOND_TIERS (days + factor) exactly.
    var DIA_DAYS = [0, 3, 7, 14, 30, 60, 120, 240, 365, 550, 730];
    var DIA_FACTOR = [1, 1.6, 2.5, 4, 6.3, 10, 16, 25, 40, 63, 100];
    var DIA = [['📄', 'Paper Grip'], ['✊', 'Getting a Grip'], ['🤝', 'Firm Hands'], ['🔩', 'Steel Hands'],
      ['💠', 'Diamond Forming'], ['💎', 'Diamond Hands'], ['💎', 'Flawless Diamond'], ['🛡️', 'Titanium Grip'],
      ['🏆', 'Diamond Legend'], ['👑', 'Unbreakable'], ['🔥', 'Immortal Diamond']];
    function diaLevel(d) { var L = 0; for (var i = 1; i < DIA_DAYS.length; i++) if (d >= DIA_DAYS[i]) L = i; return L; }

    function recompute() {
      var base = +action.value;
      var pct = (+supply.value) / 100;               // slider 0..500 → 0.00..5.00 (percent)
      var lvl = diaLevel(+days.value);
      var factor = DIA_FACTOR[lvl];
      var mult = Math.round((1 + (10 * pct) * factor) * 100) / 100;   // UNCAPPED — matches the server
      var pts = Math.round(base * mult);
      if (supplyOut) supplyOut.textContent = pct.toFixed(2) + '%';
      supply.setAttribute('aria-valuetext', pct.toFixed(2) + '% of supply');   // announce the % not the raw 0-500
      if (daysOut) daysOut.textContent = String(days.value);
      days.setAttribute('aria-valuetext', days.value + ' days · ' + DIA[lvl][1]);
      if (tier) tier.textContent = DIA[lvl][0] + ' ' + DIA[lvl][1] + ' · ×' + factor + ' factor';
      if (eqBase) eqBase.textContent = String(base);
      if (eqMult) eqMult.textContent = '×' + mult.toFixed(2);
      if (eqTotal) eqTotal.textContent = pts.toLocaleString('en-US');
      if (cap) cap.hidden = mult < 500;   // no cap now — just a fun "whale territory" flag at big multipliers
    }
    [action, supply, days].forEach(function (el) { el.addEventListener('input', recompute); });
    action.addEventListener('change', recompute);
    recompute();
  })();

  /* --- 6. Rocket levels track: preview level milestones (server XP curve) --- */
  (function () {
    var track = document.querySelector('.ab-track'), fillEl = $('ab-lvl-fill'), rocket = $('ab-rocket');
    var readout = $('ab-lvl-readout');
    var chips = Array.prototype.slice.call(document.querySelectorAll('.ab-chip'));
    if (!chips.length || !fillEl || !rocket) return;
    if (track && reduced()) track.classList.add('no-anim');

    // Exponential curve — mirrors server.js xpForLevel exactly.
    var xpFor = function (L) { if (L <= 1) return 0; var s = 0; for (var n = 1; n < L; n++) s += Math.floor(n + 300 * Math.pow(2, n / 7)); return Math.floor(s / 4); };

    function select(chip) {
      chips.forEach(function (c) { c.classList.toggle('is-on', c === chip); });
      var lvl = +chip.getAttribute('data-lvl');
      var title = chip.getAttribute('data-title') || ('Level ' + lvl);
      var pct = Math.max(2, Math.min(100, lvl)) + '%';
      fillEl.style.width = pct;
      rocket.style.left = pct;
      if (readout) {
        var xp = xpFor(lvl).toLocaleString('en-US');
        readout.textContent = lvl >= 100
          ? ('Level 100 · ' + title + ' · ' + xp + ' Power — and it keeps climbing ♾️')
          : ('Level ' + lvl + ' · ' + title + ' · ' + xp + ' Power to reach');
      }
    }
    chips.forEach(function (c) { c.addEventListener('click', function () { select(c); }); });
    var on = document.querySelector('.ab-chip.is-on') || chips[0];
    select(on);
  })();

  /* --- 7. (progress bar handled by CSS/existing patterns; omitted to keep the page light) --- */

  /* --- 8. Honest sign-in methods: name only the providers actually enabled on this deployment --- */
  (function () {
    var spans = document.querySelectorAll('.signin-methods');
    if (!spans.length || !window.AUTH || !window.AUTH.ready) return;   // default markup ("your wallet or email") is already honest
    window.AUTH.ready.then(function () {
      var a = (window.AUTH.config && window.AUTH.config.auth) || {};
      var socials = [];
      if (a.google) socials.push('Google');
      if (a.facebook) socials.push('Facebook');
      if (a.x) socials.push('X');
      if (a.instagram) socials.push('Instagram');
      var txt = 'your wallet or email';
      if (socials.length) {
        var joined = socials.length === 1 ? socials[0]
          : socials.slice(0, -1).join(', ') + ' or ' + socials[socials.length - 1];
        txt = 'your wallet, email, or ' + joined;
      }
      spans.forEach(function (el) { el.textContent = txt; });
    }).catch(function () {});
  })();
})();

/* ---------- OG rules card: dates from the server's campaign clock ----------
   The homepage banner links to #og-rules promising "how it works". The closing dates are the server's
   own OG_LAUNCH + OG_TIER_END, fetched rather than written here, so this card and checkOg() can never
   disagree. On any failure the em-dashes stay: a missing date is better than a wrong one. */
(function ogRulesDates() {
  const cells = document.querySelectorAll('[data-og-close]');
  const state = document.getElementById('ab-og-state');
  if (!cells.length && !state) return;
  fetch('/api/og/campaign', { credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : null))
    .then(c => {
      if (!c || !c.closes) return;
      const fmt = ms => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      cells.forEach(el => { const at = c.closes[el.dataset.ogClose]; if (at) el.textContent = fmt(at); });
      if (!state) return;
      if (!c.open) state.textContent = 'Every window has now closed; no new OG badges are granted.';
      else if (c.tierNow && c.name) state.textContent = 'Right now the ' + String(c.name[c.tierNow] || '').toLowerCase() + ' window is open.';
    })
    .catch(() => {});
})();
