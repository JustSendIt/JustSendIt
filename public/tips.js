/* ===== tips.js — one description popup for every control on the site ==============================
 *
 * WHY THIS EXISTS AND NOT `title`
 * app.js used to mirror aria-label into `title` for icon-only controls. A native title has four
 * problems that matter here:
 *   1. it never appears on keyboard focus — tab to a button and there is nothing at all;
 *   2. it never appears on touch;
 *   3. it cannot be dismissed with Escape and cannot be hovered, which is WCAG 2.1 SC 1.4.13
 *      (Content on Hover or Focus) failed on all three of its bullets;
 *   4. a screen reader's treatment of it is inconsistent — some read it, some read it INSTEAD of the
 *      label, some ignore it.
 * So the description is an element we own, wired with aria-describedby, shown on hover AND focus AND
 * press-and-hold.
 *
 * WHERE THE WORDS COME FROM
 *   data-tip="…"  — the description. Says what the button DOES, not what it is called.
 *   aria-label    — fallback for an icon-only control that has no data-tip yet, so nothing regresses
 *                   if a description is missing.
 * A description is not a second label. "Save" is a label; "Stores the current filter settings under a
 * name you choose" is a description. `npm run check` fails a data-tip that merely repeats the label,
 * because a popup that says the word already printed on the button is noise the reader has to dismiss.
 *
 * ONE BUBBLE, NOT 351
 * A singleton element is moved and re-filled. Per-control tooltip nodes would put a few hundred extra
 * elements in the tree and a few hundred more in the accessibility tree, for something that can only
 * ever be shown one at a time.
 *
 * CSP-safe: no inline script, no eval, no dependencies.
 */
(function () {
  'use strict';

  /* `a.btn` is class-TOKEN matching, so it does not match class="oauth-btn" — but a reader looking at an
     oauth-btn sees a button. The [class*="-btn"] arm catches the suffixed variants the site actually uses
     (oauth-btn, arc-btn, np-caret-btn). scripts/check.mjs matches on exactly these two rules, so the set
     it certifies and the set this can reach are the same set; when they disagreed, the check passed ten
     controls this could never show a description for. */
  var SEL = 'button, a.btn, a[class*="-btn"], [role="button"], input[type="submit"], input[type="button"]';
  var HOVER_DELAY = 350;   // long enough that sweeping the pointer across a toolbar does not strobe
  var TOUCH_HOLD = 400;    // press-and-hold shows it; a quick tap just activates the button
  var GAP = 10;            // clear air between the control and the bubble, so it never covers it
  var EDGE = 8;            // keep the bubble this far inside the viewport

  var bubble = null, current = null, showTimer = null, hideTimer = null, touchTimer = null;
  var overBubble = false;

  function reduced() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  /* Visible words on the control, used to decide whether a description would be redundant and to fall
     back sensibly. Emoji and digits are not words. */
  function labelOf(el) {
    var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return t;
  }
  function hasWords(el) { return /[a-zA-ZÀ-ɏЀ-ӿ]/.test(el.textContent || ''); }

  function tipFor(el) {
    var d = el.getAttribute('data-tip');
    if (d && d.trim()) return d.trim();
    // no description written yet: an icon-only control still needs SOMETHING, so its label stands in
    var al = el.getAttribute('aria-label');
    if (al && al.trim() && !hasWords(el)) return al.trim();
    return null;
  }

  function ensureBubble() {
    if (bubble && bubble.isConnected) return bubble;
    bubble = document.createElement('div');
    bubble.className = 'tip-bubble';
    bubble.id = 'tip-bubble';
    bubble.setAttribute('role', 'tooltip');
    bubble.hidden = true;
    /* Hoverable, per SC 1.4.13: the pointer must be able to travel into the description without it
       disappearing — otherwise a description too long to read at a glance cannot be read at all. */
    bubble.addEventListener('pointerenter', function () { overBubble = true; clearTimeout(hideTimer); });
    bubble.addEventListener('pointerleave', function () { overBubble = false; scheduleHide(); });
    document.body.appendChild(bubble);
    return bubble;
  }

  function place(el) {
    var b = ensureBubble();
    var r = el.getBoundingClientRect();
    b.style.maxWidth = Math.min(300, window.innerWidth - EDGE * 2) + 'px';
    b.hidden = false;                       // measure it laid out, not at zero size
    b.style.left = '0px'; b.style.top = '0px';
    var bb = b.getBoundingClientRect();

    // above by default; below when there is not room above. Never on top of the control either way.
    var above = r.top - GAP - bb.height >= EDGE;
    var top = above ? r.top - GAP - bb.height : r.bottom + GAP;
    // if it fits in neither direction, take the roomier side and let it clamp
    if (!above && top + bb.height > window.innerHeight - EDGE) {
      top = r.top - GAP - bb.height >= 0 ? r.top - GAP - bb.height : Math.max(EDGE, window.innerHeight - EDGE - bb.height);
    }
    var left = r.left + r.width / 2 - bb.width / 2;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - EDGE - bb.width));

    b.style.left = Math.round(left) + 'px';
    b.style.top = Math.round(top) + 'px';
    b.setAttribute('data-side', above ? 'top' : 'bottom');
  }

  function show(el) {
    var text = tipFor(el);
    if (!text) return;
    clearTimeout(hideTimer);
    var b = ensureBubble();
    b.textContent = text;
    current = el;
    place(el);
    b.classList.toggle('is-instant', reduced());
    // described-by, not labelled-by: the control keeps its own name and gains a description after it
    try { el.setAttribute('aria-describedby', 'tip-bubble'); } catch (e) {}
    requestAnimationFrame(function () { if (current === el) b.classList.add('is-on'); });
  }

  function hide() {
    clearTimeout(showTimer); clearTimeout(hideTimer); clearTimeout(touchTimer);
    overBubble = false;
    if (current) { try { current.removeAttribute('aria-describedby'); } catch (e) {} }
    current = null;
    if (bubble) { bubble.classList.remove('is-on'); bubble.hidden = true; bubble.textContent = ''; }
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { if (!overBubble) hide(); }, 80);
  }

  function target(e) {
    var t = e.target;
    if (!(t instanceof Element)) return null;
    var el = t.closest(SEL);
    if (!el || el.disabled) return null;
    return tipFor(el) ? el : null;
  }

  /* ---- pointer ---- */
  document.addEventListener('pointerover', function (e) {
    if (e.pointerType === 'touch') return;          // touch is handled by press-and-hold below
    var el = target(e);
    if (!el || el === current) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(function () { show(el); }, HOVER_DELAY);
  }, true);

  document.addEventListener('pointerout', function (e) {
    if (e.pointerType === 'touch') return;
    var el = target(e);
    if (!el) return;
    clearTimeout(showTimer);
    if (current === el) scheduleHide();
  }, true);

  /* ---- keyboard ----
     No delay here. The description has to be in the accessibility tree by the time the screen reader
     announces the control, and a tabbing user has already declared their interest by landing on it. */
  /* Capture phase, like the pointer listeners. focusin bubbles, so a listener on document is the LAST
     stop — any ancestor that calls stopPropagation on it (a modal trap, a menu, a carousel) would take
     the keyboard path out silently while hover kept working, which is the exact failure a sighted
     developer never notices. Capture runs from the document down, before anyone can stop it. */
  document.addEventListener('focusin', function (e) {
    var el = target(e);
    if (!el) { if (current) hide(); return; }
    clearTimeout(showTimer);
    show(el);
  }, true);
  document.addEventListener('focusout', function (e) {
    var el = target(e);
    if (el && current === el) hide();
  }, true);

  /* ---- touch: press and hold ----
     Deliberately does not preventDefault. A quick tap activates the button exactly as before; holding
     it down reveals what it does. Hijacking the first tap to show a tooltip would make every button on
     a phone take two taps, which is a worse trade than no tooltip at all. */
  document.addEventListener('touchstart', function (e) {
    var el = target(e);
    if (!el) return;
    clearTimeout(touchTimer);
    touchTimer = setTimeout(function () { show(el); }, TOUCH_HOLD);
  }, { passive: true });
  var endTouch = function () { clearTimeout(touchTimer); if (current) setTimeout(hide, 1200); };
  document.addEventListener('touchend', endTouch, { passive: true });
  document.addEventListener('touchcancel', endTouch, { passive: true });

  /* ---- dismissible, per SC 1.4.13 ----
     Escape closes the description WITHOUT moving focus, and without closing whatever dialog the
     control happens to sit in — so it stops at the first Escape it uses. */
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.key === 'Esc') && current) { e.stopPropagation(); hide(); }
  }, true);

  // a description pinned to a control that has scrolled away is worse than none
  window.addEventListener('scroll', function () { if (current) hide(); }, true);
  window.addEventListener('resize', function () { if (current) hide(); });
  document.addEventListener('click', function () { if (current) hide(); }, true);

  /* The old app.js behaviour mirrored aria-label into `title`. Anything still carrying both would show
     the native tooltip on top of this one, so the native one is stood down where we have a description
     of our own. Runs on a debounced observer because most controls here are rendered after load. */
  function dedupe() {
    var nodes = document.querySelectorAll('[data-tip][title]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      /* A DISABLED control is the one case where the native title must survive. Browsers do not dispatch
         pointer events to disabled form controls at all, so this script can never see a hover on one and
         can never show its description — while the browser still renders a plain `title` on it natively.
         Stripping that would take the explanation off the exact control most in need of one: the one the
         reader just tried to press and could not. */
      if (el.disabled) continue;
      /* Stash the ORIGINAL title once, but strip on every pass. Gating the removal on the same flag meant
         a control that re-sets its title after load — several are rebuilt on state changes — kept a native
         tooltip alongside this one, showing the reader two popups for the same control. */
      if (!el.hasAttribute('data-title-kept')) el.setAttribute('data-title-kept', el.getAttribute('title'));
      el.removeAttribute('title');
    }
  }
  function start() {
    dedupe();
    if (!window.MutationObserver) return;
    var scheduled = false;
    var obs = new MutationObserver(function () {
      if (scheduled) return; scheduled = true;
      setTimeout(function () { scheduled = false; dedupe(); }, 150);
    });
    try { obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.sendTips = { show: show, hide: hide, tipFor: tipFor };
})();
