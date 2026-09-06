/* ===== $Send entry animation (homepage only) =====
 * Owns the #intro overlay. Fast (<~2.4s), skippable, accessible.
 * Dispatches jsi:entered when the homepage is ready, and jsi:firstgesture on a real
 * dismiss gesture so player.js can honestly unlock audio within the user activation. */
(function () {
  function enter(firstVisit) {
    document.dispatchEvent(new CustomEvent('jsi:entered', { detail: { firstVisit: !!firstVisit } }));
  }
  function focusMain() {
    const h1 = document.querySelector('#main h1') || document.getElementById('main');
    if (h1) { h1.setAttribute('tabindex', '-1'); try { h1.focus({ preventScroll: true }); } catch { h1.focus(); } }
  }

  function run() {
    if (!document.body.dataset.intro) { enter(false); return; }
    let seen = false;
    try { seen = sessionStorage.getItem('intro-seen') === '1'; } catch {}
    if (seen) { enter(false); return; }
    try { sessionStorage.setItem('intro-seen', '1'); } catch {}

    // reduced motion: skip the overlay entirely — land on a fully interactive homepage, no motion
    if (window.prefersReduced && window.prefersReduced()) { enter(true); return; }

    buildOverlay();
  }

  function buildOverlay() {
    const el = document.createElement('div');
    el.id = 'intro';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Welcome to Just Send It');
    el.innerHTML =
      '<div class="intro-stage">' +
        '<span class="intro-rocket" aria-hidden="true">🚀</span>' +
        '<img class="intro-logo" src="/assets/logo.png" alt="">' +
        '<div class="intro-tag">JUST SEND IT!</div>' +
        '<div class="intro-mcap" id="intro-mcap" aria-hidden="true">$0</div>' +
      '</div>' +
      '<button class="intro-skip" type="button">Skip intro ⏭</button>' +
      '<span class="sr-only" role="status">Loading Just Send It.</span>';
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';

    const skip = el.querySelector('.intro-skip');
    skip.focus();
    const release = window.trapFocus ? window.trapFocus(el) : function () {};

    // market-cap tease count-up (pure text, no aria-live) that hands off to the real hero counter
    const mcapEl = el.querySelector('#intro-mcap');
    let t0 = null;
    function count(ts) {
      if (finished) return;
      if (!t0) t0 = ts;
      const k = Math.min(1, (ts - t0) / 600);
      // an honest warm-up counter — never a fabricated market-cap figure (the live number is on the page itself)
      mcapEl.textContent = k < 1 ? '🚀 ' + Math.round(100 * (1 - Math.pow(1 - k, 3))) + '%' : '$SEND LIVE 📈';
      if (k < 1) requestAnimationFrame(count);
    }
    setTimeout(() => requestAnimationFrame(count), 900);

    let finished = false;
    function done(fromGesture) {
      if (finished) return; finished = true;
      clearTimeout(autoTimer);
      release();
      if (fromGesture) document.dispatchEvent(new CustomEvent('jsi:firstgesture')); // real gesture → audio may unlock
      el.style.zIndex = '290'; // drop below #fx-canvas (300) so the burst reads over the revealing homepage
      el.classList.add('gone');
      if (window.sendConfetti) window.sendConfetti(innerWidth / 2, innerHeight * 0.42, { count: 60, emojiRatio: 0.5 });
      setTimeout(function () {
        el.remove();
        document.body.style.overflow = '';
        enter(true);
        focusMain();
      }, 520);
    }

    // authoritative teardown on a timer (survives rAF throttling); fade begins ~1.85s in
    const autoTimer = setTimeout(function () { done(false); }, 1850);

    const openedAt = Date.now();
    skip.addEventListener('click', function () { done(true); });
    el.addEventListener('click', function (e) {
      if (e.target === skip) return;
      if (Date.now() - openedAt < 250) return; // ignore a stray 0ms tap that would cut the reveal
      done(true);
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar' || e.key === 'Escape') { e.preventDefault(); done(true); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
