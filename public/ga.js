/* ===== ga.js — Google Analytics 4, when the operator has turned it on =====================================
   Owner, 2026-10-17: "add in google analytic". The server fills in the property's measurement id when it serves this
   file (server.js, the /ga.js route, from GA_MEASUREMENT_ID); until one is set, this does nothing at all.

   What it never does, whatever is set (the privacy page, section 7, says the same):
     · it does not start before the visitor has answered the 18+ question with yes (agegate.js), and never after an
       "I'm under 18"; on a page without the question (the legal pages) it starts only for a visitor who already said yes;
     · it does not load for a browser that asks not to be tracked (Global Privacy Control, or Do Not Track), nor for one
       whose visitor turned it off here (the switch on the privacy page — remembered in this browser);
     · it does not load on the admin page;
     · it sends the page's address WITHOUT its query string or #part (invite codes, referral codes, search words and
       ?id= stay out), and a member's profile, a post, a Send ID, a community or a squad only as that KIND of page — never
       whose or which (their address and title are replaced) — and nothing about who you are;
     · Google Signals and ad personalisation are off, so the visit is not tied to a Google account or used for ads.
   CSP-safe: no inline script; gtag.js is the only thing it loads, from the host the CSP names. */
(function () {
  'use strict';
  var ID = '__GA_MEASUREMENT_ID__';
  var KEY = 'jsi:analytics';
  var configured = /^G-[A-Z0-9]{4,20}$/.test(ID);
  var offHere = false;   // turned off on this page (also when this browser will not let the choice be remembered)
  function optedOut() { if (offHere) return true; try { return localStorage.getItem(KEY) === 'off'; } catch (e) { return false; } }
  function refused() { var n = navigator; return n.globalPrivacyControl === true || n.doNotTrack === '1' || window.doNotTrack === '1' || n.msDoNotTrack === '1'; }
  // the 18+ answer, read the way agegate.js stores it (a first-party cookie, or this tab's memory when cookies are off)
  function saidYes() {
    try { if (/(?:^|;\s*)jsi_age=18(?:;|$)/.test(document.cookie)) return true; } catch (e) {}
    try { return sessionStorage.getItem('jsi-age') === '18'; } catch (e) { return false; }
  }
  function saidNo() { try { return sessionStorage.getItem('jsi-age-no') === '1'; } catch (e) { return false; } }

  /* Which page, sent as the KIND of page where the address or title would name someone or something private-ish: a
     profile (/u/<name>), a post (/p/<id>), a Send ID (/t/<n>); a community or a squad keep their address (its ?id= is
     dropped anyway) but not their title, which names them. Everything else: its address without ?… or #…, its title. */
  var KINDS = [[/^\/u\/[^/]+\/?$/i, '/u/', 'A sender profile'], [/^\/p\/[^/]+\/?$/i, '/p/', 'A post'], [/^\/t\/[^/]+\/?$/i, '/t/', 'A Send ID'],
    [/^\/community\/?$/i, null, 'A community'], [/^\/squad\/?$/i, null, 'A Send Squad']];
  function kindOf(path) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i][0].test(path)) return KINDS[i]; return null; }
  function pageOf(path) { var k = kindOf(path); return k && k[1] ? k[1] : path; }
  function referrer() {
    var r = document.referrer || ''; if (!r) return undefined;
    var bare = r.split(/[?#]/)[0];
    if (bare.indexOf(location.origin + '/') === 0) return location.origin + pageOf(bare.slice(location.origin.length));
    return bare;
  }

  // the privacy page's switch: says what is happening in THIS browser, and turns it off or on again
  function wireSwitch() {
    var btn = document.querySelector('[data-ga-optout]'), say = document.querySelector('[data-ga-state]');
    if (!btn || !say) return;
    var note = '';
    function draw() {
      if (!configured) { say.textContent = 'Google Analytics is not turned on for this site, so nothing is sent.'; btn.hidden = true; return; }
      if (refused()) { say.textContent = 'Your browser asks sites not to track it (Global Privacy Control or Do Not Track), so Google Analytics does not load here.'; btn.hidden = true; return; }
      var off = optedOut();
      say.textContent = (off ? 'Google Analytics is turned off in this browser.' : 'Google Analytics is on in this browser.') + note;
      btn.textContent = off ? 'Turn Google Analytics back on' : 'Turn off Google Analytics in this browser';
      btn.setAttribute('data-tip', off ? 'Lets this site count your visits with Google Analytics again, from the next page you open' : 'Stops Google Analytics in this browser from the next page you open; remembered in this browser only');
      btn.hidden = false;
    }
    btn.addEventListener('click', function () {
      var wantOff = !optedOut(), kept = true;
      try { if (wantOff) localStorage.setItem(KEY, 'off'); else localStorage.removeItem(KEY); kept = (localStorage.getItem(KEY) === 'off') === wantOff; } catch (e) { kept = false; }
      offHere = wantOff;
      if (wantOff) window['ga-disable-' + ID] = true;   // and on this page too, as far as Google's tag still reads it (the promise is: from the next page)
      else window['ga-disable-' + ID] = false;
      note = kept ? '' : ' This browser does not let the site remember the choice, so it cannot hold on other pages — Global Privacy Control in your browser\'s settings stops it everywhere.';
      draw();
    });
    draw();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireSwitch); else wireSwitch();

  if (!configured || refused() || optedOut() || saidNo()) return;
  if (/^\/admin(\/|$|\.html)/i.test(location.pathname)) return;
  function start() {
    if (saidNo() || optedOut()) return;
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    var k = kindOf(location.pathname);
    gtag('js', new Date());
    gtag('config', ID, {
      page_location: location.origin + pageOf(location.pathname),   // no ?query, no #part, no member's name
      page_referrer: referrer(),
      page_title: k ? k[2] : document.title,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ID);
    document.head.appendChild(s);
  }
  var AGE = window.AGE;
  if (AGE && AGE.needed) { AGE.whenOk(start); return; }   // the question is up: only once it is answered yes
  if (!AGE && !saidYes()) return;                          // a page without the question: only for a visitor who already said yes
  start();
})();
