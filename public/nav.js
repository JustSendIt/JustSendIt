/* ===== nav.js — collapsible mobile nav (pop-down) =====
 * CSP-safe (addEventListener only, no inline JS). Toggles #nav-menu open/closed.
 * The logo, Send Level badge (.nav-xp) and account button (.profile-link) stay in the bar;
 * the page links + sender search live in the pop-down. Independent of auth.js/search.js,
 * which fill #nav-auth and #nav-search-slot by id — untouched by this toggle. */
(function () {
  'use strict';
  function init() {
    var nav = document.querySelector('nav.nav');
    if (!nav) return;
    var toggle = document.getElementById('nav-toggle');
    var menu = document.getElementById('nav-menu');
    if (!toggle || !menu) return;

    function open() {
      menu.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close menu');
    }
    function close() {
      if (!menu.classList.contains('open')) return;
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
    }
    var isOpen = function () { return menu.classList.contains('open'); };

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      isOpen() ? close() : open();
    });

    // Tapping an actual nav link (or a search result link) closes the menu — it's navigating.
    // The search <input> is not inside an <a>, so focusing/typing never closes the panel.
    menu.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a');
      if (a && menu.contains(a)) close();
    });

    // Escape closes and returns focus to the button.
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && isOpen()) { close(); toggle.focus(); }
    });

    // Click / tap outside the nav closes it.
    document.addEventListener('click', function (e) {
      if (isOpen() && !nav.contains(e.target)) close();
    });

    /* Compact or not is measured, not guessed by width: the row of links either fits beside the logo and the
       account cluster on one line, or the menu becomes the pop-down (.is-compact). The cluster changes size on
       sign-in (bell, level, live count, balances, name), so it is measured again whenever it does. The pages ship
       the bar compact, so nothing flashes; only a bar that fits opens up. */
    var fitTimer = null;
    var TIERS = ['is-tight', 'is-tighter', 'is-tightest'];
    function overflowing() { return nav.scrollWidth > nav.clientWidth + 1; }
    function fit() {
      var wasCompact = nav.classList.contains('is-compact');
      nav.classList.add('is-measuring');   // no transitions while the classes flip, or the closed menu flashes
      nav.classList.remove('is-compact');
      TIERS.forEach(function (t) { nav.classList.remove(t); });
      var links = menu.querySelectorAll('a');
      var first = links[0], last = links[links.length - 1];
      function rowFits() {   // every link on one line (the search box counts too) and nothing past the edge
        var wrapped = first && last && (Math.abs(last.getBoundingClientRect().top - first.getBoundingClientRect().top) > 4 || menu.getBoundingClientRect().height > first.getBoundingClientRect().height * 1.5);
        return !wrapped && !overflowing();
      }
      /* The links are the bar's main job, so on a wide screen the row is tried twice before it collapses: as it is,
         then without the live count and the Send Power figures (.is-tight). Below 900px it never fits. */
      var compact = true;
      if (window.innerWidth >= 900) {
        if (rowFits()) compact = false;
        else { nav.classList.add('is-tight'); if (rowFits()) compact = false; else nav.classList.remove('is-tight'); }
      }
      if (compact) nav.classList.add('is-compact'); else close();
      // still too wide (a long name, a big level, a phone): step down one tier at a time until the row fits
      if (compact) for (var i = 0; i < TIERS.length && overflowing(); i++) nav.classList.add(TIERS[i]);
      void menu.offsetHeight;   // settle the final state with transitions still off…
      nav.classList.remove('is-measuring');   // …so switching them back on animates nothing
      if (compact !== wasCompact) syncNavHeight();
    }
    function fitSoon() { clearTimeout(fitTimer); fitTimer = setTimeout(fit, 60); }
    window.addEventListener('resize', fitSoon);
    document.addEventListener('auth:change', function () { fitSoon(); setTimeout(fit, 800); });   // the balances pill arrives a moment later
    if (window.ResizeObserver) { var cluster = document.getElementById('nav-auth'); if (cluster) new ResizeObserver(fitSoon).observe(cluster); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit, fit);   // the wordmark font changes the row's width

    // Publish the real nav height so sticky sub-bars (e.g. #np-controls) offset correctly
    // rather than assuming a fixed height — the persistent bar (logo+level+account) is one row.
    function syncNavHeight() {
      var h = nav.getBoundingClientRect().height;
      if (h) document.documentElement.style.setProperty('--nav-h', Math.round(h) + 'px');
    }
    syncNavHeight();
    fit();
    addEventListener('resize', syncNavHeight, { passive: true });
    addEventListener('load', syncNavHeight);
    // the bar's height can change without a resize (balances pill arriving, search expanding, a wrap) — track it directly
    try { if (window.ResizeObserver) new ResizeObserver(syncNavHeight).observe(document.querySelector('nav.nav')); } catch (e) {}

    // Site-wide $Send tokenomics note (verified on-chain: 1% buy/sell/transfer, 100% auto-added to the LP).
    // Injected here so every page's footer carries it consistently without duplicating markup.
    var footer = document.querySelector('footer');
    if (footer && !footer.querySelector('.footer-tax')) {
      var tax = document.createElement('p');
      tax.className = 'footer-tax';
      tax.innerHTML = '💧 <b>$Send</b> charges a <b>1% tax on every buy, sell &amp; transfer</b> — 100% of it is automatically added to the liquidity pool (in batches, as volume builds), so the LP keeps building on itself. ' +
        '<a href="/#tokens">More ↗</a>';
      var discl = footer.querySelector('.disclaimer');
      if (discl && discl.parentNode === footer) footer.insertBefore(tax, discl.nextSibling);
      else footer.insertBefore(tax, footer.firstChild);
    }

    // Live "who's active" counter to the RIGHT of the 🔔 — how many people are Sending it right now.
    var notif = document.getElementById('nav-notif');
    var host = notif || document.getElementById('nav-auth');
    if (host && host.parentNode && !document.getElementById('nav-live')) {
      var live = document.createElement('a');
      live.id = 'nav-live'; live.className = 'nav-live'; live.href = '/wall.html';
      live.title = 'People Sending it right now — active on the platform. Join in →';
      live.setAttribute('aria-label', 'People active right now');
      live.innerHTML = '<span class="nav-live-dot" aria-hidden="true"></span><b class="nav-live-n">·</b><span class="nav-live-lbl">Sending&nbsp;it</span>';
      if (notif) notif.parentNode.insertBefore(live, notif.nextSibling); // just after (to the right of) the bell
      else host.parentNode.insertBefore(live, host);
      var pid = '';
      try { pid = localStorage.getItem('jsi_pid') || ''; if (!pid) { pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem('jsi_pid', pid); } } catch (e) {}
      var nEl = live.querySelector('.nav-live-n');
      function paintPresence(n) {
        if (typeof n !== 'number') return;
        nEl.textContent = n.toLocaleString('en-US');
        live.setAttribute('aria-label', n + ' ' + (n === 1 ? 'person' : 'people') + ' Sending it right now');
        live.classList.add('is-live');
      }
      function pollPresence() {
        fetch('/api/presence' + (pid ? '?pid=' + encodeURIComponent(pid) : ''), { credentials: 'same-origin' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { if (j) paintPresence(j.active); })
          .catch(function () {});
      }
      pollPresence();
      setInterval(function () { if (!document.hidden) pollPresence(); }, 30000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) pollPresence(); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
