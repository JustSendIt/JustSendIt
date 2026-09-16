/* ===== The hunt ====================================================================================
   A hundred eggs are hidden across the site. This file is the ENGINE: how a find is detected, how it is
   banked, how it is celebrated. WHERE each egg lives is registered per page at the bottom of this file
   and in the page scripts, through EGGS.register(id, arm).

   What the server owns and this file never decides: how much an egg pays, whether it already paid, how
   many exist. A find is only ever "I found #N" — POST /api/eggs/claim — and the reply carries the truth
   (awarded, found[], total). The count shown anywhere comes from that reply or from GET /api/eggs.

   Rules the detectors follow, because an egg that gets in the way is a bug, not a delight:
     - never intercept a control's primary job: eggs listen, they do not preventDefault on real controls;
     - nothing that needs money, a wallet, or a purchase;
     - findable by keyboard and pointer alike wherever the trigger is an element (Enter/Space count);
     - reduced-motion readers get the toast without the confetti;
     - signed-out finds are kept locally and banked on the next signed-in page load, so nobody loses one. */
(function () {
  const KEY = 'send.eggs.pending';          // finds made while signed out — banked later
  const SEEN = 'send.eggs.seen';            // ids this browser has already celebrated — no double toasts
  const UNPAID = 'send.eggs.unpaid';        // found while the day's allowance was full — re-sent so they pay later
  const reg = new Map();                    // id -> arm(found)
  let total = null, foundIds = new Set(), booted = false;

  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const signedIn = () => !!(window.AUTH && AUTH.user && AUTH.user.id);

  async function post(id) {
    const r = await fetch('/api/eggs/claim', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  }

  function celebrate(id, awarded, n, tot, capped) {
    const seen = load(SEEN);
    if (!seen.includes(id)) { seen.push(id); save(SEEN, seen); }
    const count = (n != null && tot != null) ? ' · ' + n + '/' + tot : '';
    const pts = awarded > 0 ? ' +' + awarded + ' Send Power' : (capped ? ' · today\'s egg allowance is full — it still counts, and pays on a later visit' : '');
    const line = HINTS.get(id) ? ' — ' + HINTS.get(id) : '';
    if (window.sendToast) sendToast('🥚 #' + id + line + pts + count);
    if (awarded > 0 && window.showPoints) { try { showPoints(awarded, window.innerWidth / 2, Math.min(window.innerHeight - 80, window.innerHeight * 0.4)); } catch {} }   // the nav badge and points feedback the rest of the site uses
    if (window.burst && !reduced()) {
      const x = window.innerWidth / 2, y = Math.min(window.innerHeight - 80, window.innerHeight * 0.4);
      try { burst(x, y, { count: 40, emojiRatio: 0.5 }); } catch {}
    }
    document.dispatchEvent(new CustomEvent('egg:found', { detail: { id, awarded, found: n, total: tot } }));
  }

  /* The one entry point every detector calls. Idempotent from the client's side too: an id this browser
     has already celebrated is quietly re-sent (the server says already:true) but not celebrated twice. */
  async function found(id) {
    id = Number(id);
    if (!Number.isInteger(id) || id < 1) return;
    if (foundIds.has(id)) return;
    if (!signedIn()) {
      const pend = load(KEY);
      if (!pend.includes(id)) { pend.push(id); save(KEY, pend); }
      if (!load(SEEN).includes(id)) {
        save(SEEN, load(SEEN).concat(id));
        if (window.sendToast) sendToast('🥚 You found egg #' + id + ' — sign in to bank it');
      }
      return;
    }
    let res = null;
    try { res = await post(id); } catch { res = null; }
    if (!res || res.status !== 200 || !res.j) {
      /* refused or unreachable — a rate limit, an expired session, read-only mode, a network blip. The find
         is kept and re-sent on the next load, and the reader is told why now, not left guessing. */
      const pend = load(KEY); if (!pend.includes(id)) { pend.push(id); save(KEY, pend); }
      const why = (res && res.j && res.j.error) ? res.j.error : 'the server did not answer';
      if (window.sendToast && !load(SEEN).includes(id)) { save(SEEN, load(SEEN).concat(id)); sendToast('🥚 Egg #' + id + ' found — kept for later: ' + why); }
      return;
    }
    const j = res.j;
    foundIds = new Set(j.found || []); total = j.total;
    if (j.already) return;
    if (j.capped) {
      // recorded, unpaid: the server pays it on a later claim once the day's allowance opens up again
      const un = load(UNPAID); if (!un.includes(id)) { un.push(id); save(UNPAID, un); }
    }
    celebrate(id, j.awarded, foundIds.size, total, j.capped);
  }

  async function flushPending() {
    if (!signedIn()) return;
    const ids = [...new Set(load(KEY).concat(load(UNPAID)))];
    if (!ids.length) return;
    save(KEY, []); save(UNPAID, []);
    // one at a time, with a breath between: thirty in a burst would hit the per-route limiter and lose the rest
    for (const id of ids) {
      foundIds.delete(id);                       // let found() re-send an unpaid one
      try { await found(id); } catch {}
      if (load(KEY).includes(id)) { const rest = ids.slice(ids.indexOf(id) + 1); save(KEY, [...new Set(load(KEY).concat(rest))]); break; }   // refused: keep the remainder queued
      await new Promise((r) => setTimeout(r, 350));
    }
    document.dispatchEvent(new CustomEvent('egg:found', { detail: { id: null, awarded: 0, found: foundIds.size, total } }));
  }

  async function sync() {
    if (!signedIn()) return;
    try {
      const r = await fetch('/api/eggs', { credentials: 'same-origin' });
      if (!r.ok) return;
      const j = await r.json();
      foundIds = new Set(j.found || []); total = j.total;
    } catch {}
  }

  /* ---------- detectors: small, reusable, and none of them stop a real control from working ---------- */
  const D = {
    // N activations of an element (click, or Enter/Space if it is focusable) inside a window
    taps(el, n, ms, cb) {
      if (!el) return;
      let count = 0, t0 = 0;
      const hit = () => { const t = Date.now(); if (t - t0 > (ms || 2500)) count = 0; t0 = t; if (++count >= n) { count = 0; cb(); } };
      el.addEventListener('click', hit);
      el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el && el.tagName !== 'BUTTON' && el.tagName !== 'A') hit(); });
    },
    // pointer rests on an element for a while (a hidden hover region) — or focus does, for keyboard readers
    dwell(el, ms, cb) {
      if (!el) return;
      let t = 0; const start = () => { clearTimeout(t); t = setTimeout(cb, ms); }; const stop = () => clearTimeout(t);
      el.addEventListener('mouseenter', start); el.addEventListener('mouseleave', stop);
      el.addEventListener('focusin', start); el.addEventListener('focusout', stop);
    },
    // a word typed anywhere on the page, outside form fields
    typed(word, cb) {
      let buf = '';
      document.addEventListener('keydown', (e) => {
        const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
        if (e.key.length !== 1) return;
        buf = (buf + e.key.toLowerCase()).slice(-word.length);
        if (buf === word.toLowerCase()) { buf = ''; cb(); }
      });
    },
    // the sequence everybody knows
    konami(cb) {
      const seq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
      let i = 0;
      document.addEventListener('keydown', (e) => {
        const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        i = (k === seq[i]) ? i + 1 : (k === seq[0] ? 1 : 0);
        if (i === seq.length) { i = 0; cb(); }
      });
    },
    // the reader reaches the very bottom of the page
    bottom(cb) {
      let done = false;
      const onScroll = () => {
        if (done) return;
        const doc = document.documentElement;
        /* "the very bottom" only means something on a page that scrolls. The Hot Feed is exactly one
           viewport tall (its own track scrolls, not the document), so the naive test was true the moment
           it opened and the egg fired for nothing. It takes a page at least half a screen taller than the
           viewport and a real scroll to get there. */
        if (doc.scrollHeight < window.innerHeight * 1.5 || window.scrollY < 120) return;
        if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) { done = true; cb(); }
      };
      addEventListener('scroll', onScroll, { passive: true });
    },
    // a hash in the URL nobody links to
    hash(name, cb) {
      const test = () => { if (location.hash === '#' + name) cb(); };
      addEventListener('hashchange', test); test();
    },
    // the reader opens the console and calls a function that was left there for them
    console(name, cb) {
      window[name] = function () { cb(); return 'nice.'; };
    },
    // the tab has been open and visible for a while — patience is a find
    stay(ms, cb) {
      let t = 0; const arm = () => { clearTimeout(t); if (!document.hidden) t = setTimeout(cb, ms); };
      document.addEventListener('visibilitychange', arm); arm();
    },
    // a long press / held key on an element
    hold(el, ms, cb) {
      if (!el) return;
      let t = 0; const down = () => { clearTimeout(t); t = setTimeout(cb, ms); }; const up = () => clearTimeout(t);
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up);
      el.addEventListener('keydown', (e) => { if (e.key === ' ' && !e.repeat && e.target === el && el.tagName !== 'BUTTON') down(); });
      el.addEventListener('keyup', up);
    },
    // a double-click on something decorative
    dbl(el, cb) { if (el) el.addEventListener('dblclick', cb); },
    // text selection of a specific phrase
    select(text, cb) {
      document.addEventListener('selectionchange', () => { try { if (String(getSelection()).trim().toLowerCase() === text.toLowerCase()) cb(); } catch {} });
    },
  };

  function register(id, arm) { reg.set(Number(id), arm); if (booted) tryArm(id, arm); }
  function tryArm(id, arm) { try { arm(() => found(id), D); } catch {} }

  /* Declarative eggs: any element with data-egg="N" is a taps(1) egg — the simplest kind, for spots that
     are just "notice this and touch it". data-egg-taps="N" asks for N touches. Never put data-egg on a
     control that has a real job; the click still goes through, but the find would feel like a side-effect. */
  function armDeclarative() {
    document.querySelectorAll('[data-egg]').forEach((el) => {
      const id = Number(el.dataset.egg); if (!id) return;
      const n = Number(el.dataset.eggTaps || 1);
      if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SUMMARY)$/.test(el.tagName)) el.setAttribute('tabindex', '0');
      D.taps(el, n, 2500, () => found(id));
    });
  }


  /* ---------- the catalogue ----------
     id · page · detector · the line shown after the find. Detect strings are the engine's own calls; a
     selector ending in '=' means "the element whose text is exactly that character". Targets that are
     not natively focusable are made reachable at arm time (tabindex, a neutral label), so every element
     egg can be found with a keyboard; targets that are pointer-events:none get that lifted inline, the same
     way their drift timings are inline. Elements that arrive later (dashboard, boards, heroes) are armed
     when they appear and re-armed when they are re-rendered. */
  const CATALOG = [
    [1, "all", "typed('sendit')", "You typed it. Now go send it."],
    [2, "all", "konami()", "Up up down down. The old ways work."],
    [3, "all", "console('sendit')", "Devtools open. Curiosity, rewarded."],
    [4, "all", "taps('footer .disclaimer', 3, 2500)", "You read the disclaimer. Legend."],
    [5, "all", "dwell('footer .fine', 4000)", "You read the fine print. Entertainment only."],
    [6, "all", "taps('#music-player .eq', 3, 2000)", "The bars dance for you now."],
    [7, "all", "typed('gwc')", "gwc typed. Generational patience."],
    [8, "all", "dwell('#nav-live', 3000)", "Someone's here. It might be you."],
    [9, "all", "select('just send it')", "Highlighted. Now underlined in your heart."],
    [10, "all", "stay(600000)", "Ten minutes. You really are sending it."],
    [11, "all", "hash('moon')", "#moon. You navigated there yourself."],
    [12, "index.html", "taps('.hero-logo-btn', 10, 4000)", "Ten taps. Overdrive engaged."],
    [13, "index.html", "hold('.hero-logo-btn', 1500)", "Held it. Charged it. Launched it."],
    [14, "index.html", "taps('.hero h1 .rocket', 1, 0)", "The wiggly rocket wanted a tap."],
    [15, "index.html", "taps('.ticker-track span:nth-child(6)', 3, 3000)", "Caught a moving headline. Reflexes."],
    [16, "index.html", "taps('.hero-floats span:nth-child(7)', 5, 2500)", "Coin caught mid-drift. Nice hands."],
    [17, "index.html", "taps('.hero-floats span:nth-child(4)', 1, 0)", "One rocket fewer in the sky."],
    [18, "index.html", "dwell('.og-confetti span:last-child', 2000)", "Crown spotted. You lingered like royalty."],
    [19, "index.html", "taps('.rh-badge .dot', 3, 2000)", "The LIVE dot, poked. Still live."],
    [20, "index.html", "taps('details.reassure summary', 8, 10000)", "Curiosity is the safest trade."],
    [21, "index.html", "taps('#watch .section-title', 2, 600)", "Tilted title, straightened by you."],
    [22, "index.html", "bottom()", "You scrolled all the way. Certified sender."],
    [23, "index.html", "taps('#emblem-SEND', 3, 2000)", "Emblem tapped thrice. $S salutes."],
    [24, "index.html", "dwell('.beta-k', 3000)", "Staring at the clock won't slow it."],
    [25, "index.html", "taps('#guide .step-num', 4, 2000)", "Step one, four times. Thorough."],
    [26, "index.html", "hash('tothemoon')", "#tothemoon. Coordinates accepted."],
    [27, "index.html", "typed('wagmi')", "wagmi. We are, actually."],
    [28, "wall.html", "taps('h1.section-title', 3, 2000)", "Brick by brick. You tapped the wall."],
    [29, "wall.html", "typed('gm')", "gm. Sun's up, send's up."],
    [30, "wall.html", "bottom()", "End of the wall. Go post something."],
    [31, "wall.html", "hash('brick')", "#brick. Found in the mortar."],
    [32, "wall.html", "select('entertainment only')", "Highlighted the fine print. Rare breed."],
    [33, "wall.html", "stay(300000)", "Five minutes on the wall. Committed."],
    [34, "u.html", "typed('boo')", "boo. The ghost jumped. So did you."],
    [35, "u.html", "taps('#share-btn', 3, 10000)", "Copied thrice. It's really copied now."],
    [36, "u.html", "taps('#wt-lb', 3, 4000)", "Leaderboard, thrice. Podium checked."],
    [37, "u.html", "taps('#lb-list .lb-top .lb-rank', 3, 2000)", "Number one, tapped. Not yours yet."],
    [38, "u.html", "bottom()", "Bottom of their wall. Thorough. Respect."],
    [39, "u.html", "typed('follow')", "Typed follow. The button is right there."],
    [40, "newpairs.html", "taps('#np-refresh', 5, 10000)", "The radar refreshes itself. Patience."],
    [41, "newpairs.html", "taps('#np-strategies button:last-of-type', 3, 4000)", "Triple strict. Nothing gets past you."],
    [42, "newpairs.html", "dwell('.np-runner-rank', 2500)", "Gold rank, admired. Runners run on."],
    [43, "newpairs.html", "dwell('#np-feed', 20000)", "Twenty seconds in the feed. Hooked."],
    [44, "newpairs.html", "typed('wen')", "wen? Soon. Always soon."],
    [45, "newpairs.html", "typed('moon')", "moon typed. Moon not guaranteed."],
    [46, "newpairs.html", "taps('h1.section-title', 3, 2000)", "Radar pinged. Beep."],
    [47, "newpairs.html", "hash('radar')", "#radar. You tuned in manually."],
    [48, "newpairs.html", "bottom()", "Bottom of the radar. Nothing escaped you."],
    [49, "communities.html", "dwell('#wk-board .wk-medal', 2500)", "Gold medal, admired. Not stolen."],
    [50, "communities.html", "taps('#wk-count', 3, 2000)", "Tick tock. The board resets weekly."],
    [51, "communities.html", "taps('h1.section-title', 3, 2000)", "Knocked three times. Neighbors waved."],
    [52, "communities.html", "hash('village')", "#village. Population: you."],
    [53, "community.html", "taps('#cw-tab-holders', 3, 4000)", "Holders tab, thrice. Verified curious."],
    [54, "community.html", "taps('.comm-hero-name', 3, 2000)", "Name-tapped. The community noticed."],
    [55, "community.html", "dwell('#comm-members-list', 6000)", "Roster studied. Every member. Thorough."],
    [56, "community.html", "hold('#comm-hero', 2000)", "Held the hero. It flexed."],
    [57, "community.html", "hash('holders')", "#holders. Gate found, wall respected."],
    [58, "community.html", "typed('gn')", "gn, neighbor. Send tomorrow."],
    [59, "arcade.html", "typed('liftoff')", "liftoff. Objective: \ud83c\udf15."],
    [60, "arcade.html", "taps('#arc-game-h', 5, 3000)", "Five pokes. Not yet, pilot."],
    [61, "arcade.html", "taps('#cmp-h', 3, 2000)", "Season header tapped. Game on."],
    [62, "arcade.html", "dwell('#arc-sub', 5000)", "Stared at the readout. Ready indeed."],
    [63, "arcade.html", "hash('highscore')", "#highscore. No such thing. Nice try."],
    [64, "arcade.html", "hold('#arc-game-h', 2000)", "Held the throttle. Engine hummed."],
    [65, "tracker.html", "taps('h1.section-title', 3, 2000)", "Briefcase tapped. Nothing fell out."],
    [66, "tracker.html", "dwell('.np-hero-warn', 5000)", "You read the warning. Certified careful."],
    [67, "tracker.html", "select('not advice')", "Not advice, highlighted. Correct."],
    [68, "tracker.html", "hash('whale')", "#whale. A wild whale appears."],
    [69, "watchlist.html", "taps('h1.section-title', 5, 3000)", "Five stars. Self-rated."],
    [70, "watchlist.html", "select('my watchlist')", "Selected your own watchlist. Meta."],
    [71, "watchlist.html", "hash('gauge')", "#gauge. Health check complete."],
    [72, "watchlist.html", "bottom()", "Bottom of the list. All watched."],
    [73, "profile.html", "taps('#pf-avatar', 5, 2000)", "Avatar launched. Handle stayed."],
    [74, "profile.html", "taps('#gamify-dash .pc-core', 7, 3000)", "Overclocked the core. Arcs spun."],
    [75, "profile.html", "taps('#gamify-dash .eq-op=', 1, 0)", "The maths, finally spelled out."],
    [76, "profile.html", "typed('rekt')", "You asked for it. \ud83d\udc80"],
    [77, "profile.html", "bottom()", "Bottom of the station. Every tab? Not quite."],
    [78, "profile.html", "taps('#dtab-settings', 3, 3000)", "Settings, thrice. Nothing changed. Everything considered."],
    [79, "profile.html", "hash('rekt')", "#rekt. Straight to the graveyard."],
    [80, "profile.html", "taps('#gamify-dash .relic-pip.cur', 1, 0)", "You found the live pip. \ud83d\udc8e"],
    [81, "profile.html", "taps('h1.section-title', 3, 2000)", "Station tapped. Crew saluted."],
    [82, "about.html", "taps('.def-phon', 1, 0)", "Say it with your chest. /s\u025bnd \u026at/"],
    [83, "about.html", "dwell('#ab-tier', 3000)", "Tier watched closely. Paper patience."],
    [84, "about.html", "hash('moonmath')", "#moonmath. Numbers stayed honest."],
    [85, "about.html", "taps('.gs-progress-text', 3, 2000)", "Progress text tapped. Progress not made."],
    [86, "about.html", "bottom()", "Read the whole about. Now you know."],
    [87, "about.html", "select('paper grip')", "Paper grip, highlighted. Upgrade pending."],
    [88, "about.html", "dwell('#og-rules', 6000)", "Studied the OG rules. Gold-tier attention."],
    [89, "support.html", "taps('h1.section-title', 3, 2000)", "Lifebuoy tapped. Still floating."],
    [90, "support.html", "typed('help')", "help typed. The box is right there."],
    [91, "support.html", "dwell('#post-text', 15000)", "Fifteen seconds thinking. Ask it anyway."],
    [92, "data.html", "taps('.dk-addr', 3, 1000)", "dEaD is forever. Nothing comes back."],
    [93, "data.html", "taps('#dk-how-h', 3, 2000)", "Qualified curiosity."],
    [94, "data.html", "dwell('#dk-what-h', 4000)", "Read what it never opens. Good."],
    [95, "data.html", "hash('key')", "#key. Locks stayed locked."],
    [96, "whitepaper.html", "bottom()", "Certified reader. \ud83d\udcc4\ud83d\ude80"],
    [97, "whitepaper.html", "hash('s99')", "Section 99 doesn't exist. You do."],
    [98, "whitepaper.html", "dwell('.wp-colophon', 4000)", "Colophon lingered. Rarer than you think."],
    [99, "whitepaper.html", "stay(900000)", "Fifteen minutes. Peer reviewed."],
    [100, "whitepaper.html", "select('version 1')", "Version 1 selected. Version 2 pending."],
  ];

  const HINTS = new Map(CATALOG.map((r) => [r[0], r[3]]));

  // which catalogue page is this?
  function pageKey() {
    const p = location.pathname;
    if (p === '/' || /\/index\.html$/.test(p)) return 'index.html';
    if (/^\/u\//.test(p)) return 'u.html';
    const m = /\/([a-z-]+\.html)$/.exec(p);
    return m ? m[1] : p.replace(/^\//, '') + '.html';
  }

  /* Make an element a fair target for everyone. A decorative span gets a tabindex and a neutral label so
     a keyboard reader can land on it and press Enter; nothing that is already a control is touched. A
     pointer-events:none decoration (the drifting emoji) gets that lifted inline — no different from the
     inline drift timing it already carries. */
  /* A decoration stays a decoration. An earlier cut gave every element target a tabindex and lifted its
     aria-hidden so a keyboard could reach it — which put headings and paragraphs in the Tab order, created
     focus stops inside aria-hidden containers that a screen reader cannot see, nested a focusable image
     inside the hero button, and overrode the logo's alt text with a label. None of that is fair. Keyboard
     readers reach the hunt through the eggs that are words, hashes, selections, the console, patience, and
     the eggs that sit on real controls (tabs, buttons, chips) — the catalogue has those on every page.
     The one thing this still does is lift pointer-events:none on the drifting emoji, which is no different
     from the inline drift timing they already carry. */
  function reachable(el) {
    if (!el || el._eggReady) return el;
    el._eggReady = true;
    try { if (getComputedStyle(el).pointerEvents === 'none') el.style.pointerEvents = 'auto'; } catch {}
    return el;
  }
  function pick(sel) {
    // "selector=" → the element among the matches whose text is exactly "="
    const m = /^(.*)=$/.exec(sel);
    if (!m) return document.querySelector(sel);
    return [...document.querySelectorAll(m[1])].find((e) => e.textContent.trim() === '=') || null;
  }
  function whenPresent(sel, arm, id) {
    // guarded per (element, egg): two eggs may share an element (a tap count and a long press on the logo)
    const go = () => { const el = pick(sel); if (!el) return; el._eggs = el._eggs || new Set(); if (el._eggs.has(id)) return; el._eggs.add(id); arm(reachable(el)); };
    go();
    // late renders and re-renders: watch the document for the target appearing (cheap: one observer per egg)
    const mo = new MutationObserver(() => go());
    mo.observe(document.body, { childList: true, subtree: true });
  }
  const str = (s) => s.replace(/^'|'$/g, '');
  function armCatalog(id, detect, done) {
    const m = /^([a-z-]+)\((.*)\)$/.exec(detect); if (!m) return;
    const fn = m[1], args = m[2] ? m[2].split(/,\s*(?=(?:[^']*'[^']*')*[^']*$)/).map((a) => a.trim()) : [];
    switch (fn) {
      case 'typed':   D.typed(str(args[0]), done); break;
      case 'konami':  D.konami(done); break;
      case 'console': D.console(str(args[0]), done); break;
      case 'bottom':  D.bottom(done); break;
      case 'hash':    D.hash(str(args[0]), done); break;
      case 'stay':    D.stay(Number(args[0]), done); break;
      case 'select':  D.select(str(args[0]), done); break;
      case 'taps':    whenPresent(str(args[0]), (el) => D.taps(el, Number(args[1]) || 1, Number(args[2]) || 2500, done), id); break;
      case 'dwell':   whenPresent(str(args[0]), (el) => D.dwell(el, Number(args[1]) || 3000, done), id); break;
      case 'hold':    whenPresent(str(args[0]), (el) => D.hold(el, Number(args[1]) || 1500, done), id); break;
      case 'dbl':     whenPresent(str(args[0]), (el) => D.dbl(el, done), id); break;
    }
  }
  function armPage() {
    const here = pageKey();
    for (const [id, page, detect] of CATALOG) {
      if (page !== 'all' && page !== here) continue;
      try { armCatalog(id, detect, () => found(id)); } catch {}
    }
  }

  function boot() {
    armPage();
    if (booted) return; booted = true;
    armDeclarative();
    reg.forEach((arm, id) => tryArm(id, arm));
    sync().then(flushPending);
    document.addEventListener('auth:change', () => { sync().then(flushPending); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.EGGS = {
    register, found, sync,
    get found() { return [...foundIds]; },
    get total() { return total; },
    detect: D,
  };
})();
