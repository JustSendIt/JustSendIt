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
      fitMenu();
    }
    function close() {
      if (!menu.classList.contains('open')) return;
      menu.classList.remove('open', 'has-more', 'is-scrolled');
      menu.scrollTop = 0;   // back to the top while it closes: the next open starts there, with no scroll event mid-opening
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
    }
    var isOpen = function () { return menu.classList.contains('open'); };

    /* The pop-down never scrolls when the screen has room for it (owner, 2026-10-15: "make sure there is no scroll if there
       doesn't have to be on the page menu if you have to have a scroll on smaller screens make sure users know they need to
       scroll"). It used to be capped at 560px, under the ~580px its links take, so it scrolled on every screen. Now:
         · it is given the room under the bar (the visual viewport: a phone's address bar and keyboard take room), and only
           as much of it as its links need, so the open/close animation runs over its real height;
         · when one column of links would not fit there, they go into columns as wide as the widest link needs (measured, so
           a larger text size makes fewer, wider columns rather than a scroll);
         · only when even that is too tall does it scroll, and then a "Scroll for more ↓" button sits at the bottom until the
           end is reached (a real button: a tap on it scrolls the menu, never falls through to a link hidden under it), with
           a shade along the top once the menu has moved.
       The cue is judged against the height the menu is given, never the box mid-animation. */
    var compact = function () { return nav.classList.contains('is-compact'); };
    var reducedMotion = function () { try { return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('motion-off'); } catch (e) { return false; } };
    var more = document.createElement('button');
    more.type = 'button'; more.className = 'nav-more'; more.tabIndex = -1; more.setAttribute('aria-hidden', 'true');   // a keyboard moves through the links, which scroll into view on their own
    more.setAttribute('data-tip', 'Scrolls the menu to show the rest of its links');
    more.textContent = 'Scroll for more ↓';
    more.addEventListener('click', function () { menu.scrollBy({ top: Math.max(60, menu.clientHeight - 90), behavior: reducedMotion() ? 'auto' : 'smooth' }); });
    menu.appendChild(more);
    var given = 0;   // the menu's height while open (its border box): what the cue is judged against
    function menuRoom() {
      var vv = window.visualViewport, h = vv ? vv.height : window.innerHeight;
      return Math.max(120, Math.floor(h - nav.getBoundingClientRect().bottom));
    }
    function borderY() { var cs = getComputedStyle(menu); return (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0); }
    function widestLink() {   // the widest link's words (the 📊 Site numbers button's too), plus the half-rem each side a link has in a column, plus a hair
      var w = 0, links = menu.querySelectorAll(':scope > a, :scope > .nav-stats-open'), r = document.createRange();
      for (var i = 0; i < links.length; i++) { r.selectNodeContents(links[i]); w = Math.max(w, r.getBoundingClientRect().width); }
      return Math.ceil(w + parseFloat(getComputedStyle(document.documentElement).fontSize) + 4);
    }
    function setHeight(room) {
      menu.classList.remove('has-more');   // (the cue button takes room: measure without it)
      given = Math.min(room, menu.scrollHeight + borderY());
      menu.style.setProperty('--menu-room', given + 'px');
    }
    function menuCue() {
      var on = isOpen() && compact();
      var h = (given || menu.offsetHeight) - borderY();
      menu.classList.toggle('has-more', on && menu.scrollHeight - h - menu.scrollTop > 2);
      menu.classList.toggle('is-scrolled', on && menu.scrollTop > 2);
    }
    function fitMenu() {
      menu.classList.remove('has-more');
      if (!isOpen() || !compact()) { menu.classList.remove('is-cols', 'is-scrolled'); menu.style.removeProperty('--menu-room'); menu.style.removeProperty('--menu-col'); given = 0; return; }
      var room = menuRoom();
      menu.classList.remove('is-cols');
      menu.style.removeProperty('--menu-col');
      if (menu.scrollHeight + borderY() > room) {   // one column would not fit under the bar: columns
        menu.style.setProperty('--menu-col', widestLink() + 'px');
        menu.classList.add('is-cols');
      }
      setHeight(room);
      menuCue();
    }
    menu.addEventListener('scroll', function () { menuCue(); }, { passive: true });
    menu.addEventListener('transitionend', function (e) { if (e.propertyName === 'max-height' && isOpen()) menuCue(); });
    window.addEventListener('resize', function () { if (isOpen()) fitMenu(); }, { passive: true });
    if (window.visualViewport) visualViewport.addEventListener('resize', function () { if (isOpen()) fitMenu(); });   // a phone's address bar and keyboard change the room
    // search results growing (or shrinking) inside the open menu: it grows into the room it has, then says if it runs past (no switch to columns mid-typing)
    if (window.MutationObserver) new MutationObserver(function () { if (isOpen() && compact()) { setHeight(menuRoom()); menuCue(); } }).observe(menu, { childList: true, subtree: true });

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
    /* .is-snug is the first to go: the verified members and the views beside the live count (the count itself stays).
       .is-bare is the last resort: the OG badge leaves the name pill (it stays on the member's wall and profile) — with
       it, an OG member's bar was 349px wide on a 320px phone with every other tier already on */
    var TIERS = ['is-snug', 'is-tight', 'is-tighter', 'is-tightest', 'is-bare'];
    function overflowing() { return nav.scrollWidth > nav.clientWidth; }   // no pixel of slack: one pixel over is a one-pixel sideways scroll (the signed-in bar sat at 361 on a 360px phone)
    function rowFits() {   // every link on one line (the search box counts too) and nothing past the edge
      var links = menu.querySelectorAll('a');
      var first = links[0], last = links[links.length - 1];
      var wrapped = first && last && (Math.abs(last.getBoundingClientRect().top - first.getBoundingClientRect().top) > 4 || menu.getBoundingClientRect().height > first.getBoundingClientRect().height * 1.5);
      return !wrapped && !overflowing();
    }
    // the bar as it stands still holds: the pop-down form has only to stay inside the screen, the open row on one line too
    function stillFits() { return nav.classList.contains('is-compact') ? !overflowing() : rowFits(); }
    function fit() {
      var wasCompact = nav.classList.contains('is-compact');
      // scroll anchoring off and back on: on <html> and on <body> both — Chrome went on following the row's tries with it off
      // on <html> alone (/market's Chain button moved 42px under a double-click at 1280px)
      var html = document.documentElement, body = document.body || html, anchor0 = [html.style.overflowAnchor, body.style.overflowAnchor];
      var anchoring = function (on) { html.style.overflowAnchor = on ? anchor0[0] : 'none'; body.style.overflowAnchor = on ? anchor0[1] : 'none'; };
      void nav.offsetHeight;   // the bar laid out as whatever called this left it, which the page follows as it always would…
      var y0 = window.pageYOffset, before = nav.className;
      anchoring(false);   // …but the ways the row is tried are not changes for the page to follow (see the end)
      nav.classList.add('is-measuring');   // no transitions while the classes flip, or the closed menu flashes
      nav.classList.remove('is-compact');
      TIERS.forEach(function (t) { nav.classList.remove(t); });
      /* The links are the bar's main job, so on a wide screen the row is tried three times before it collapses: as it
         is, then without the new numbers beside the live count (.is-snug: the verified members and the views), then
         without the live count and the Send Power figures too (.is-tight — where the pill stays as a 📊 button alone, the
         row's only way in to the numbers pop-up, and is measured with the row). Below 900px it never fits. */
      var compact = true;
      if (window.innerWidth >= 900) {
        if (rowFits()) compact = false;
        else {
          nav.classList.add('is-snug');
          if (rowFits()) compact = false;
          else { nav.classList.add('is-tight'); if (rowFits()) compact = false; else nav.classList.remove('is-snug', 'is-tight'); }
        }
      }
      if (compact) nav.classList.add('is-compact'); else close();
      // still too wide (a long name, a big level, a phone): step down one tier at a time until the row fits
      if (compact) for (var i = 0; i < TIERS.length && overflowing(); i++) nav.classList.add(TIERS[i]);
      /* Measuring lays the row out as many as four ways in one go, and the browser's scroll anchoring followed each passing
         height: on a page scrolled down, a re-fit (a resize, the cluster changing size) left it 42px higher for every way
         tried — /market's Chain drop-down moved out from under a double-click. So anchoring is off while the row is tried
         (above), and the page is never scrolled from here: a scroll of ours cancelled the browser's own glide to a #section
         on a fresh load (/about#og-rules stopped near the top). Once the bar's form is chosen it goes back, for a moment,
         to the form the page last saw (still not followed), anchoring comes on again, and the one real change is made:
         the page follows that, the browser's own way — keeping what is on screen in place while scrolled down, and a glide
         under way going where it was going. At the very top there is nothing to keep in view. */
      if (y0 > 0) {
        var after = nav.className;
        nav.className = before + ' is-measuring'; void nav.offsetHeight;
        anchoring(true);
        nav.className = after; void nav.offsetHeight;
      } else anchoring(true);
      void menu.offsetHeight;   // settle the final state with transitions still off…
      nav.classList.remove('is-measuring');   // …so switching them back on animates nothing
      if (compact !== wasCompact) syncNavHeight();
      if (isOpen()) fitMenu();   // the bar changed under an open menu: its room and its columns with it
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
    /* The timers and the ResizeObserver above wait at least a frame — in a tab that is not in front, a second or more —
       so the signed-in bar was laid out 449px wide on a 375px phone (a sideways scroll) until they fired. When the row
       changes under the bar (the account cluster on sign-in, the bell mounting, the ⏸, the live count) or the screen
       turns, a bar that no longer holds is fitted at once: a MutationObserver runs as a microtask, before the next
       paint, and a resize event before the frame it resizes. Only a bar that no longer holds is measured again, so the
       bell's poll never closes or scrolls an open menu; the menu's own changes (search results) are not the row's. */
    if (window.MutationObserver) new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) if (!menu.contains(recs[i].target)) { if (!stillFits()) fit(); return; }
    }).observe(nav, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', function () { if (!stillFits()) fit(); });
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
        '<a href="/tokens">More ↗</a>';
      var discl = footer.querySelector('.disclaimer');
      if (discl && discl.parentNode === footer) footer.insertBefore(tax, discl.nextSibling);
      else footer.insertBefore(tax, footer.firstChild);
    }

    /* The live "who's active" counter to the RIGHT of the 🔔 — how many people are Sending it right now — with, beside it
       (owner, 2026-10-29: "also add the number of total verified users total lifetime site views"), the verified members
       and the lifetime page views:   ● 3 Sending it · ✓ 6 verified · 2.8K views
       All three come from /api/presence (the server reads them from its own records; see siteTotals in server.js). The new
       two (.nav-live-more) are the first thing a short bar lets go of (.is-snug, in fit() above); the count goes with
       .is-tight, as before — in the open row of links the pill stays then as a 📊 button alone (.nav-live-ico), since the
       row has no menu to carry 📊 Site numbers (a 1920px screen signed in, 1620–1780 signed out, had no way in at all).
       Until the first answer the numbers are "·", in the room the real ones take (styles.css), so the bar is measured at
       about its real width and the new numbers do not show and then vanish; the first answer is measured again as a
       whole, so a bar that has room for them after all shows them. A press opens the numbers pop-up — each one over time
       (owner: "When users click on this section pull up a popup that shows a graph over time of all three of these stats")
       — from public/sitestats.js, fetched on the first press so this file stays light. The pop-up links to the Wall, where
       the pill used to go. */
    var notif = document.getElementById('nav-notif');
    var host = notif || document.getElementById('nav-auth');
    if (host && host.parentNode && !document.getElementById('nav-live')) {
      var STATS_TIP = 'Opens the site\'s numbers over time: people on the site, verified members and page views';
      var live = document.createElement('button');
      live.type = 'button'; live.id = 'nav-live'; live.className = 'nav-live';
      live.setAttribute('aria-haspopup', 'dialog');
      live.setAttribute('data-tip', STATS_TIP);
      live.setAttribute('aria-label', 'People Sending it right now, verified members and page views: the numbers are on their way');
      live.innerHTML = '<span class="nav-live-ico" aria-hidden="true">📊</span><span class="nav-live-dot" aria-hidden="true"></span><b class="nav-live-n">·</b><span class="nav-live-lbl">Sending&nbsp;it</span>' +
        '<span class="nav-live-more"><span class="nav-live-sep" aria-hidden="true">·</span>' +
          '<span class="nav-live-part"><span class="nav-live-tick" aria-hidden="true">✓</span><b class="nav-live-vn">·</b><span class="nav-live-word">verified</span></span>' +
          '<span class="nav-live-sep" aria-hidden="true">·</span>' +
          '<span class="nav-live-part"><b class="nav-live-wn">·</b><span class="nav-live-word">views</span></span></span>';
      if (notif) notif.parentNode.insertBefore(live, notif.nextSibling); // just after (to the right of) the bell
      else host.parentNode.insertBefore(live, host);
      var pid = '';
      try { pid = localStorage.getItem('jsi_pid') || ''; if (!pid) { pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem('jsi_pid', pid); } } catch (e) {}
      var nEl = live.querySelector('.nav-live-n'), vEl = live.querySelector('.nav-live-vn'), wEl = live.querySelector('.nav-live-wn');
      var known = function (n) { return typeof n === 'number' && isFinite(n) && n >= 0; };
      var whole = function (n) { return n.toLocaleString('en-US'); };
      /* 1,234 → 1.2K, 12,345 → 12K, 1,234,567 → 1.2M; under 1,000 whole. Cut, never rounded up: the bar never shows more than was
         counted (2,899 is 2.8K). Integer division, so no float lands a hair under a round number. */
      function shortNum(n) {
        if (n < 1000) return String(n);
        var u = n < 1e6 ? [1e3, 'K'] : n < 1e9 ? [1e6, 'M'] : [1e9, 'B'];
        var x = n < 10 * u[0] ? Math.floor(n / (u[0] / 10)) / 10 : Math.floor(n / u[0]);
        return x + u[1];
      }
      // 'YYYY-MM-DD' → '13 Oct 2026' (a UTC day, which is what the server counts in)
      function longDay(d) { try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return d; } }
      function paintPresence(j) {
        if (!j || !known(j.active)) return;
        nEl.textContent = whole(j.active);
        if (known(j.verified)) vEl.textContent = shortNum(j.verified);
        if (known(j.views)) wEl.textContent = shortNum(j.views);
        // the name reads all three in words (a number the server could not read says so, never a 0)
        live.setAttribute('aria-label', j.active + ' ' + (j.active === 1 ? 'person' : 'people') + ' Sending it right now, ' +
          (known(j.verified) ? whole(j.verified) + ' verified member' + (j.verified === 1 ? '' : 's') : 'verified members not known just now') + ', ' +
          (known(j.views) ? whole(j.views) + ' page view' + (j.views === 1 ? '' : 's') + (j.viewsSince ? ' since ' + longDay(j.viewsSince) : '') : 'page views not known just now'));
        var first = !live.classList.contains('is-live');
        live.classList.add('is-live');
        if (first) fitSoon();   // the real numbers in place of the "·": measured again from the widest way, not only if the bar no longer holds
        try { document.dispatchEvent(new CustomEvent('jsi:presence', { detail: j })); } catch (e) {}   // an open numbers pop-up keeps its "right now" with the bar
      }
      function pollPresence() {
        fetch('/api/presence' + (pid ? '?pid=' + encodeURIComponent(pid) : ''), { credentials: 'same-origin' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { if (j) paintPresence(j); })
          .catch(function () {});
      }
      pollPresence();
      setInterval(function () { if (!document.hidden) pollPresence(); }, 30000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) pollPresence(); });

      // the pop-up's code, fetched once on the first press (versioned like the files auth.js adds: /api/config's assets)
      var statsLoad = null;
      function loadStats() {
        if (window.SiteStats) return Promise.resolve(window.SiteStats);
        if (statsLoad) return statsLoad;
        statsLoad = new Promise(function (resolve, reject) {
          var av = (window.AUTH && AUTH.config && AUTH.config.assets) || {};
          var sc = document.createElement('script');
          sc.src = '/sitestats.js' + (av['sitestats.js'] ? '?v=' + encodeURIComponent(av['sitestats.js']) : '');
          sc.onload = function () { if (window.SiteStats) resolve(window.SiteStats); else { statsLoad = null; reject(new Error('missing')); } };
          sc.onerror = function () { statsLoad = null; reject(new Error('could not load')); };
          document.head.appendChild(sc);
        });
        return statsLoad;
      }
      function openStats(opener) {
        loadStats().then(function (S) { S.open({ opener: opener }); })
          .catch(function () { if (window.sendToast) sendToast('⚠️ The numbers could not load — reload the page and try again.'); });
      }
      live.addEventListener('click', function () { openStats(live); });   // Enter and Space press a <button> too

      /* Where the bar has no room for the pill (below 561px it is never shown; .is-tight and the tiers after it hide it), the
         pop-down menu carries the same way in, as its last item — only while the pill is not in the bar (styles.css), so the
         menu is as it was everywhere the pill shows. It closes the menu; focus comes back to ≡ when the pop-up closes. */
      var entry = document.createElement('button');
      entry.type = 'button'; entry.className = 'nav-stats-open';
      entry.setAttribute('aria-haspopup', 'dialog');
      entry.setAttribute('data-tip', STATS_TIP);
      entry.innerHTML = '<span aria-hidden="true">📊</span>&nbsp;Site&nbsp;numbers';
      entry.addEventListener('click', function () { close(); openStats(toggle); });
      menu.insertBefore(entry, more);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
