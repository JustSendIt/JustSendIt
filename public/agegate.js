/* ===== The age gate ========================================================================
 * Every visitor is asked once, per device, to tick a box confirming they are 18 or older before
 * the site opens. Nothing else is asked here: reading the site is free for everyone who says yes,
 * and the invite code and the $100 wallet check belong to the referral gate (invite.js), which
 * only opens when someone tries to JOIN.
 *
 * Loaded in <head>, synchronously and before anything paints, because it has to decide whether to
 * cover the page before the page can be seen. The decision is one cookie read.
 *
 *   window.AGE.needed      true when this visitor has not answered yet
 *   window.AGE.hold()      a script that runs its own opening (the homepage loading screen) calls this
 *                          before DOMContentLoaded; it then calls AGE.open() when the loading screen ends
 *   window.AGE.open()      shows the question (no-op once answered)
 *   window.AGE.whenOk(fn)  runs fn now if answered, otherwise once they say yes
 *   window.AGE.reopen(msg) asks again — for a server that says it never got the answer
 *
 * The answer is stored in a first-party cookie the server also reads: it will not create an account
 * without it, and it records on the account when the answer was given. The cookie is not a secret —
 * a forged one says exactly what ticking the box says.
 */
(function () {
  'use strict';
  if (window.AGE) return;
  /* A page opened as a local file is a build step printing it (scripts/build-whitepaper.sh), never a visitor:
     there is no cookie to keep there, so the question would be baked into every page of the PDF. */
  if (location.protocol === 'file:') {
    window.AGE = { needed: false, isOpen: false, hold: function () {}, open: function () {}, reopen: function () {},
      whenOk: function (fn) { fn(); }, openDialog: function () { return null; } };
    return;
  }

  var COOKIE = 'jsi_age', MIN = 18, KEEP_S = 365 * 86400;
  var SS_OK = 'jsi-age', SS_NO = 'jsi-age-no';
  var HOLD_BACKSTOP_MS = 8000;   // the loading screen runs under 2.5 s; if whoever held the gate never opens it, open it anyway
  var root = document.documentElement;

  function answered() {
    try { if (new RegExp('(?:^|;\\s*)' + COOKIE + '=' + MIN + '(?:;|$)').test(document.cookie)) return true; } catch (e) {}
    // cookies switched off: the tab still remembers, so one "yes" is not asked for again on every page
    try { return sessionStorage.getItem(SS_OK) === String(MIN); } catch (e) { return false; }
  }
  function saidNo() { try { return sessionStorage.getItem(SS_NO) === '1'; } catch (e) { return false; } }
  function reduced() {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches || root.classList.contains('motion-off'); } catch (e) { return false; }
  }

  var needed = !answered();
  var ok = !needed, held = false, isOpen = false, el = null, mo = null, lastFocus = null, releaseTrap = null;
  var waiters = [];
  if (needed) root.classList.add('age-pending');   // styles.css covers the page until the question is up

  /* ---------- markup ---------- */
  var LOGO = '<span class="age-brand"><img src="/assets/logo-mark-sm.png" alt="" width="48" height="48"><span>Just Send It</span></span>';
  function build() {
    el = document.createElement('div');
    el.id = 'age-gate';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'age-title');
    el.setAttribute('aria-describedby', 'age-desc age-err');
    el.innerHTML =
      '<div class="age-card" id="age-ask">' +
        LOGO +
        '<p class="age-kicker">18+ only</p>' +
        '<h2 class="age-title" id="age-title">Are you 18 or older?</h2>' +
        '<p class="age-sub" id="age-desc">Just Send It is a social site about crypto memecoins. It is for entertainment only and is not financial advice. Reading the site is free for everyone 18 and over.</p>' +
        '<label class="age-check" for="age-yes"><input type="checkbox" id="age-yes"><span>I confirm I am <b>18 years of age or older</b>.</span></label>' +
        '<p class="age-err" id="age-err" role="status" aria-live="polite"></p>' +
        '<div class="age-actions">' +
          '<button class="btn btn-primary age-enter" id="age-enter" type="button" aria-disabled="true" data-tip="Remembers your answer on this device for a year, then opens the site">Enter the site 🚀</button>' +
          '<button class="btn btn-ghost btn-sm age-leave" id="age-leave" type="button" data-tip="Tells us you are under 18 — the site stays closed to you">I\'m under 18</button>' +
        '</div>' +
        '<p class="age-fine">We remember your answer on this device for a year. <a href="/privacy.html">Privacy</a></p>' +
      '</div>' +
      '<div class="age-card" id="age-no" hidden>' +
        LOGO +
        '<h2 class="age-title" id="age-no-title" tabindex="-1">Come back when you\'re 18</h2>' +
        '<p class="age-sub">Just Send It is only for people 18 and over, so the site stays closed to you for now.</p>' +
        '<p class="age-fine">Picked that by mistake? Close this tab and open the site again.</p>' +
      '</div>';
    document.body.appendChild(el);

    var box = el.querySelector('#age-yes'), enter = el.querySelector('#age-enter'), err = el.querySelector('#age-err');
    function sync() {
      enter.setAttribute('aria-disabled', box.checked ? 'false' : 'true');
      if (box.checked) err.textContent = '';
    }
    box.addEventListener('change', sync);
    enter.addEventListener('click', function () {
      if (!box.checked) {
        // aria-disabled rather than disabled: a disabled button takes no pointer or focus, so it could
        // neither show its description nor say why nothing happened
        err.textContent = 'Tick the box to confirm you are 18 or older.';
        box.focus();
        return;
      }
      finish();
    });
    el.querySelector('#age-leave').addEventListener('click', function () {
      if (!isOpen) return;   // the gate is already on its way out
      try { sessionStorage.setItem(SS_NO, '1'); } catch (e) {}
      showNo();
    });
    sync();
  }
  function showNo() {
    el.querySelector('#age-ask').hidden = true;
    var no = el.querySelector('#age-no');
    no.hidden = false;
    el.setAttribute('aria-labelledby', 'age-no-title');
    el.removeAttribute('aria-describedby');
    var h = no.querySelector('#age-no-title');
    try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); }
  }

  /* ---------- the rest of the page is out of reach while the question is up ----------
     inert, not just covered: a covered link can still be tabbed to, and a modal that opens underneath
     (a ?invite=1 link, a 2FA return) would otherwise take focus away from the question. Only what this
     file marked is unmarked again, so anything that was already inert stays that way. */
  function skip(n) {
    return n === el || n.nodeType !== 1 || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' ||
      (n.classList && n.classList.contains('tip-bubble'));   // the descriptions of the gate's own buttons
  }
  function mark(n) { if (!skip(n) && !n.inert) { n.inert = true; n.setAttribute('data-age-inert', ''); } }
  function inertAll(on) {
    var kids = document.body ? document.body.children : [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (on) mark(k);
      else if (k.hasAttribute('data-age-inert')) { k.inert = false; k.removeAttribute('data-age-inert'); }
    }
    if (on && window.MutationObserver) {
      mo = new MutationObserver(function (list) {
        list.forEach(function (m) { for (var j = 0; j < m.addedNodes.length; j++) mark(m.addedNodes[j]); });
      });
      mo.observe(document.body, { childList: true });
    } else if (!on && mo) { mo.disconnect(); mo = null; }
  }
  /* The keyboard while the question is up, in the capture phase so it runs whatever has focus (a click on the
     card's text drops focus to <body>, which a listener on the gate itself would never hear):
     · Escape is swallowed — nothing closes this but an answer, and it must not reach a modal underneath
     · Tab is kept inside, for engines without `inert` (with it, the question is all Tab can reach anyway) */
  function trap() {
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); return; }
      if (e.key !== 'Tab') return;
      var items = [].slice.call(el.querySelectorAll('a[href],button,input,[tabindex]:not([tabindex="-1"])'))
        .filter(function (n) { return n.offsetParent !== null; });
      if (!items.length) { e.preventDefault(); return; }
      var first = items[0], last = items[items.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || !el.contains(a))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (a === last || !el.contains(a))) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    return function () { document.removeEventListener('keydown', onKey, true); };
  }

  /* ---------- open / close ---------- */
  function open() {
    if (ok || isOpen) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', open, { once: true }); return; }
    isOpen = true;
    lastFocus = document.activeElement;
    build();
    root.classList.remove('age-pending');
    root.classList.add('age-open');
    inertAll(true);
    releaseTrap = trap();
    document.dispatchEvent(new CustomEvent('jsi:age-open'));   // anything audible pauses (player.js)
    if (saidNo()) { showNo(); return; }
    var box = el.querySelector('#age-yes');
    try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); }
    // the gate is its own scroller: on a short screen bring the box into view there (the page behind is locked)
    try { box.scrollIntoView({ block: 'nearest' }); } catch (e) {}
  }
  function remember() {
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    try { document.cookie = COOKIE + '=' + MIN + '; Path=/; Max-Age=' + KEEP_S + '; SameSite=Lax' + secure; } catch (e) {}
    try { sessionStorage.setItem(SS_OK, String(MIN)); sessionStorage.removeItem(SS_NO); } catch (e) {}
    /* The server's copy. It sets the same cookie and, for a signed-in account, records when the answer
       was given. The gate has already cleared on the cookie above, so a failed call costs nothing here. */
    try {
      fetch('/api/age', {
        method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, age: MIN }),
      }).catch(function () {});
    } catch (e) {}
  }
  function openDialog() {
    var all = document.querySelectorAll('[aria-modal="true"]');
    for (var i = 0; i < all.length; i++) {
      var d = all[i];
      if (d.id !== 'age-gate' && d.id !== 'intro' && !d.hidden && d.getClientRects().length && getComputedStyle(d).visibility !== 'hidden') return d;
    }
    return null;
  }
  function finish(quiet) {
    if (!isOpen || !el) return;   // a second Enter during the fade-out, or a restore that already closed it
    ok = true; isOpen = false;
    if (!quiet) remember();
    inertAll(false);
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    root.classList.remove('age-open', 'age-pending');
    var gone = el;
    el = null;
    gone.inert = true;   // fading out, not usable: no second press, no stray under-18 answer
    gone.classList.add('age-leaving');
    setTimeout(function () { gone.remove(); }, reduced() ? 0 : 260);
    /* Focus goes where the visitor is now: into a dialog that opened underneath while the question was up
       (a ?invite=1 link opens the ticket at load), otherwise back to wherever it was. */
    var under = openDialog();
    if (under) {
      var first = under.querySelector('button:not([disabled]),[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])');
      try { (first || under).focus({ preventScroll: true }); } catch (e) {}
    } else if (lastFocus && lastFocus !== document.body && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
    else {
      // nothing to go back to (the question opened as the page loaded): the start of the content, as the skip link does
      var main = document.getElementById('main');
      if (main) { if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1'); try { main.focus({ preventScroll: true }); } catch (e) {} }
    }
    document.dispatchEvent(new CustomEvent('jsi:age', { detail: { ok: true } }));
    document.dispatchEvent(new CustomEvent('jsi:modalclose'));   // the tour and friends wait on this
    var run = waiters; waiters = [];
    run.forEach(function (fn) { try { fn(); } catch (e) { console.error('age gate waiter', e); } });
  }

  window.AGE = {
    get needed() { return !ok; },
    get isOpen() { return isOpen; },
    openDialog: openDialog,
    hold: function () { if (!ok) held = true; },
    open: open,
    whenOk: function (fn) { if (ok) fn(); else waiters.push(fn); },
    /* The server refused a sign-up with need_age although this page thinks the question was answered:
       the cookie did not survive (blocked, or cleared by the browser). Ask again, and say why. */
    reopen: function (msg) {
      if (isOpen) return;
      try { sessionStorage.removeItem(SS_OK); } catch (e) {}
      ok = false;
      open();
      var err = el && el.querySelector('#age-err');
      // a beat later: a live region filled in the same task that created it is generally not announced
      if (err) setTimeout(function () { err.textContent = msg || 'Your browser did not keep your answer. Tick the box again — the site needs cookies on to remember it.'; }, 150);
    },
  };

  /* Back/forward cache: a page restored after the question was answered elsewhere in this tab (or another
     one) still has it up. Close it without writing the answer again. */
  addEventListener('pageshow', function (e) { if (e.persisted && isOpen && answered()) finish(true); });

  function start() {
    if (ok) return;
    if (!held) open();
    else setTimeout(open, HOLD_BACKSTOP_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
