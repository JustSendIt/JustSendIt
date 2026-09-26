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
  const KEY = 'send.eggs.pending';          // finds made while signed out — banked by whoever signs in next on this browser
  const SEEN = 'send.eggs.seen';            // ids this browser has already celebrated — no double toasts
  const MINE = 'send.eggs.mine';            // { username: [ids] } — a signed-in find the server refused, kept for THAT account
  const RETRY = 'send.eggs.retry';          // { username: ms } — when that account's unpaid ghosts were last re-sent
  const UNPAID_RETRY_MS = 60 * 60 * 1000;   // the server keeps the unpaid list (GET /api/eggs); it is re-sent at most hourly
  const reg = new Map();                    // id -> arm(found)
  let total = null, foundIds = new Set(), serverUnpaid = [], booted = false;
  let lastRefusal = '';                     // why the last claim was kept instead of banked — the replay reports it once
  let proofAsked = false;                   // the wallet check is raised once per page load, not once per ghost
  let wasIn = false;                        // signed in at the last auth check — so a sign-out can be told from a sign-in

  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const loadObj = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
  /* Who is signed in. The page is given the account's username, never its numeric id — keying this on
     AUTH.user.id made every member look signed out, so every find was parked as "sign in to bank it" and
     never paid. The username is what tags this browser's saved finds to an account. */
  const account = () => (window.AUTH && AUTH.user && AUTH.user.username) || null;
  const signedIn = () => !!account();

  async function post(id) {
    const r = await fetch('/api/eggs/claim', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  }

  /* The hunt is Halloween-themed: every find is a hidden ghost, and ghosts pop out of the spot it was found at —
     where the last tap, click or hover was, if it was just now; the middle of the screen for a typed word, a hash
     or patience — then float up and fade. Reduced-motion readers get the toast without the ghosts. */
  const GHOSTS = ['👻', '👻', '👻', '👻', '🎃', '🦇', '🕸️', '💀', '🕯️'];
  let lastPtr = null;
  const markPtr = (e) => { lastPtr = { x: e.clientX, y: e.clientY, at: Date.now() }; };
  addEventListener('pointerdown', markPtr, { capture: true, passive: true });
  addEventListener('pointermove', markPtr, { capture: true, passive: true });
  function origin() {
    if (lastPtr && Date.now() - lastPtr.at < 2500) return { x: lastPtr.x, y: lastPtr.y };
    return { x: window.innerWidth / 2, y: Math.min(window.innerHeight - 80, window.innerHeight * 0.4) };
  }
  function spook(count, at) {
    if (!window.burst || reduced()) return;
    const o = at || origin();
    try { burst(o.x, o.y, { count: count || 26, emojiRatio: 1, emoji: GHOSTS, gravity: -0.05, lift: 1.5, speed: 0.55, fade: 0.55, scale: 1.9 }); } catch {}
  }
  let flushP = null;                        // the replay in progress, if any — it never runs twice at once
  // a replay's own tally: finds banked by the boot replay are said once, with one haunting, not a toast each
  function celebrate(id, awarded, n, tot, capped, acc) {
    const seen = load(SEEN);
    if (!seen.includes(id)) { seen.push(id); save(SEEN, seen); }
    if (acc) {
      const fresh = !acc.known.has(id);       // the server had not counted this one before the replay
      if (awarded > 0) { acc.paid++; acc.pts += awarded; }
      if (awarded > 0 || fresh) acc.banked++;  // a still-unpaid ghost that stays unpaid is not news, and is not said
      if (!(awarded > 0) && fresh) acc.waiting++;
      acc.found = n; acc.total = tot;
      return;
    }
    const count = (n != null && tot != null) ? ' · ' + n + '/' + tot : '';
    const pts = awarded > 0 ? ' +' + awarded + ' Send Power' : (capped ? ' · today\'s allowance is full — it still counts, and pays on a later visit' : '');
    const line = HINTS.get(id) ? ' — ' + HINTS.get(id) : '';
    const o = origin();
    if (window.sendToast) sendToast('👻 Ghost #' + id + line + pts + count);
    if (awarded > 0 && window.showPoints) { try { showPoints(awarded, o.x, o.y); } catch {} }   // the nav badge and points feedback the rest of the site uses
    spook(30, o);
    document.dispatchEvent(new CustomEvent('egg:found', { detail: { id, awarded, found: n, total: tot } }));
  }
  // a signed-in find the server refused (a rate limit, the wallet check, a network blip) is kept for THAT account
  function keepMine(id, who) {
    const me = who || account(); if (!me) return;
    const m = loadObj(MINE), l = Array.isArray(m[me]) ? m[me] : [];
    if (!l.includes(id)) l.push(id);
    m[me] = l; save(MINE, m);
  }

  /* The one entry point every detector calls: found(id). A replay passes its tally (acc) and may re-send an id the
     server already counted (an unpaid one); a live find of a counted id is quietly ignored. It answers what
     happened: 'paid', 'recorded' (counted, not yet paid), 'already', 'kept' (signed out), 'refused' or 'bad'. */
  async function found(id, acc) {
    id = Number(id);
    if (!Number.isInteger(id) || id < 1) return 'bad';
    if (foundIds.has(id) && !acc) return 'already';
    if (!signedIn()) {
      const pend = load(KEY);
      if (!pend.includes(id)) { pend.push(id); save(KEY, pend); }
      if (!load(SEEN).includes(id)) {
        save(SEEN, load(SEEN).concat(id));
        if (window.sendToast) sendToast('👻 You found hidden ghost #' + id + ' — sign in to bank it');
        spook(18);
      }
      return 'kept';
    }
    let res = null;
    try { res = await post(id); } catch { res = null; }
    if (!res || res.status !== 200 || !res.j) {
      /* refused or unreachable — a rate limit, an expired session, read-only mode, a network blip. The find is
         kept for this account and re-sent on its next load, and the reader is told why now, not left guessing. */
      keepMine(id);
      /* The participation gate is the refusal a new account hits most (every claim is a write, so it rides
         the same choke point as posting). Say what actually unblocks it, and open the check the way every
         other refused write on the site does (auth.js's api helper) — once, and never from the replay, so a run
         of saved finds does not stack a modal per ghost. */
      const gated = !!(res && res.j && res.j.needsProof);
      const why = gated ? 'it banks once your wallet check has passed' : (res && res.j && res.j.error) ? res.j.error : 'the server did not answer';
      lastRefusal = why;
      if (!acc && window.sendToast && !load(SEEN).includes(id)) { save(SEEN, load(SEEN).concat(id)); sendToast('👻 Ghost #' + id + ' found — kept for later: ' + why); spook(18); }
      if (gated && !proofAsked && !acc && window.AUTH && AUTH.needsProof) { proofAsked = true; try { AUTH.needsProof(res.j); } catch {} }
      return 'refused';
    }
    const j = res.j;
    foundIds = new Set(j.found || []); total = j.total;
    if (j.already) return 'already';
    celebrate(id, j.awarded, foundIds.size, total, j.capped, acc);
    return j.awarded > 0 ? 'paid' : 'recorded';
  }

  /* The replay, on every signed-in load and sign-in: the ghosts found signed out on this browser (banked to
     whoever signs in — a sign-out empties that list), this account's refused claims, and — at most hourly, and
     quietly unless one pays — the ghosts the SERVER lists as found but unpaid. One at a time with a breath
     between (thirty in a burst would hit the claim limiter), stopping if the account changes underneath it. */
  function flushPending() {
    if (!signedIn()) return Promise.resolve();
    if (!flushP) flushP = flushOnce().finally(() => { flushP = null; });
    return flushP;
  }
  async function flushOnce() {
    const me = account();
    const mineAll = loadObj(MINE), mine = Array.isArray(mineAll[me]) ? mineAll[me] : [];
    const retryAll = loadObj(RETRY);
    const retryUnpaid = serverUnpaid.length > 0 && Date.now() - (Number(retryAll[me]) || 0) > UNPAID_RETRY_MS;
    const ids = [...new Set(load(KEY).concat(mine, retryUnpaid ? serverUnpaid : []))].filter((n) => Number.isInteger(n) && n >= 1);
    if (!ids.length) return;
    save(KEY, []); delete mineAll[me]; save(MINE, mineAll);
    if (retryUnpaid) { retryAll[me] = Date.now(); save(RETRY, retryAll); }
    const acc = { banked: 0, paid: 0, pts: 0, waiting: 0, found: null, total: null, known: new Set(foundIds) };
    let kept = 0;
    for (let i = 0; i < ids.length; i++) {
      if (account() !== me) { for (const rest of ids.slice(i)) keepMine(rest, me); break; }   // signed out or switched mid-replay: the rest wait for this account
      let r; try { r = await found(ids[i], acc); } catch { r = 'refused'; }
      if (r === 'refused' || r === 'kept') {
        // refused now is refused for the next one too: keep the rest for this account and stop
        if (r === 'kept') keepMine(ids[i], me);
        for (const rest of ids.slice(i + 1)) keepMine(rest, me);
        kept = ids.length - i;
        break;
      }
      await new Promise((ok) => setTimeout(ok, 350));
    }
    // once per session, not once per page load: a gated account would otherwise hear it on every page
    if (kept && window.sendToast && !sessionStorage.getItem('send.eggs.keptsaid')) { try { sessionStorage.setItem('send.eggs.keptsaid', '1'); } catch {} sendToast('👻 ' + kept + ' saved ghost' + (kept === 1 ? '' : 's') + ' kept for later: ' + (lastRefusal || 'the server did not answer')); }
    if (acc.banked) {
      const count = (acc.found != null && acc.total != null) ? ' · ' + acc.found + '/' + acc.total : '';
      if (window.sendToast) sendToast('👻 ' + acc.banked + ' ghost' + (acc.banked === 1 ? '' : 's') + ' you found earlier ' + (acc.banked === 1 ? 'is' : 'are') + ' banked now' + (acc.pts ? ' · +' + acc.pts + ' Send Power' : '') + (acc.waiting ? ' · ' + acc.waiting + ' pay' + (acc.waiting === 1 ? 's' : '') + ' once your allowance opens up' : '') + count);
      if (acc.pts && window.showPoints) { try { const o = origin(); showPoints(acc.pts, o.x, o.y); } catch {} }
      spook(Math.min(60, 20 + acc.banked * 4));
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
      serverUnpaid = Array.isArray(j.unpaid) ? j.unpaid.filter((n) => Number.isInteger(n) && n >= 1) : [];
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
      // a still mouse sends no pointermove: when a hover find fires, the pointer is still where it rests, so the ghosts start there
      let t = 0; const start = (e) => { clearTimeout(t); const byPtr = e && e.type === 'mouseenter'; t = setTimeout(() => { if (byPtr && lastPtr) lastPtr.at = Date.now(); cb(); }, ms); }; const stop = () => clearTimeout(t);
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
      let t = 0; const down = (e) => { clearTimeout(t); const byPtr = e && e.type === 'pointerdown'; t = setTimeout(() => { if (byPtr && lastPtr) lastPtr.at = Date.now(); cb(); }, ms); }; const up = () => clearTimeout(t);
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up);
      // a button too: Space held is a hold, and the click a button fires on the key's release is its own
      // job, which a hold egg never stands in front of (the hero logo's egg #13 lives on a real button)
      el.addEventListener('keydown', (e) => { if (e.key === ' ' && !e.repeat && e.target === el) down(); });
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
     id · page · detector · the line shown after the find — Halloween lines: every find is a hidden ghost. Detect strings are the engine's own calls; a
     selector ending in '=' means "the element whose text is exactly that character". Targets that are
     not natively focusable are made reachable at arm time (tabindex, a neutral label), so every element
     egg can be found with a keyboard; targets that are pointer-events:none get that lifted inline, the same
     way their drift timings are inline. Elements that arrive later (dashboard, boards, heroes) are armed
     when they appear and re-armed when they are re-rendered. */
  const CATALOG = [
    [1, "all", "typed('sendit')", "You typed it. Somewhere in the dark, a ghost whispered: send it."],
    [2, "all", "konami()", "Up up down down. You summoned the old spirits."],
    [3, "all", "console('sendit')", "Devtools open. You found the ghost in the machine."],
    [4, "all", "taps('footer .disclaimer', 3, 2500)", "You read the disclaimer. Even the ghosts take it seriously."],
    [5, "all", "dwell('footer .fine', 4000)", "You read the fine print. No invisible ink here: entertainment only."],
    [6, "all", "taps('#music-player .eq', 3, 2000)", "The bars danced. Something in the speakers danced back."],
    [7, "all", "typed('gwc')", "gwc typed. A generational ghost stirs in the crypt."],
    [8, "all", "dwell('#nav-live', 3000)", "Someone's here. It might be you. It might be something else."],
    [9, "all", "select('just send it')", "Highlighted. The words glowed faintly in the dark."],
    [10, "all", "stay(600000)", "Ten minutes in the haunted house. Brave."],
    [11, "all", "hash('moon')", "#moon. It's full tonight. Mind the werewolves."],
    [12, "index.html", "taps('.hero-logo-btn', 10, 4000)", "Ten taps. The rocket is possessed now."],
    [13, "index.html", "hold('.hero-logo-btn', 1500)", "Held it. Charged it. It launched into the fog."],
    [14, "index.html", "taps('.hero h1 .rocket', 1, 0)", "The wiggly rocket shivered. It felt a chill."],
    [15, "index.html", "taps('.ticker-track span:nth-child(6)', 3, 3000)", "Caught a moving headline. The one thing here that's no phantom: entertainment only."],
    [16, "index.html", "taps('.hero-floats span:nth-child(7)', 5, 2500)", "Coin caught mid-drift. Cold to the touch."],
    [17, "index.html", "taps('.hero-floats span:nth-child(4)', 1, 0)", "One rocket fewer in the sky. A bat took its place."],
    [18, "index.html", "dwell('.og-confetti span:last-child', 2000)", "Crown spotted. The ghost of an OG wore it first."],
    [19, "index.html", "taps('.rh-badge .dot', 3, 2000)", "The LIVE dot, poked. Still live. Still undead."],
    [20, "index.html", "taps('details.reassure summary', 8, 10000)", "Eight peeks behind the curtain. Nothing jumped out. This time."],
    [21, "index.html", "taps('#watch .section-title', 2, 600)", "Tilted title, straightened. It tilts back when you look away."],
    [22, "index.html", "bottom()", "You scrolled all the way down. Down here it's all cobwebs."],
    [23, "index.html", "taps('#emblem-SEND', 3, 2000)", "Emblem tapped thrice. That's how you summon it."],
    [24, "index.html", "dwell('.beta-k', 3000)", "Staring at the clock won't slow it. The witching hour comes anyway."],
    [25, "index.html", "taps('#guide .step-num', 4, 2000)", "Step one, four times. The spell needed exactly four."],
    [26, "index.html", "hash('tothemoon')", "#tothemoon. The broomsticks are fuelled."],
    [27, "index.html", "typed('wagmi')", "wagmi. We're all gonna haunt it."],
    [28, "wall.html", "taps('h1.section-title', 3, 2000)", "Brick by brick. Something is bricked up in this wall."],
    [29, "wall.html", "typed('gm')", "gm. The ghosts are just going to bed."],
    [30, "wall.html", "bottom()", "End of the wall. Something is scratching on the other side."],
    [31, "wall.html", "hash('brick')", "#brick. Found sealed in the mortar."],
    [32, "wall.html", "select('entertainment only')", "Highlighted the fine print. The ghosts approve."],
    [33, "wall.html", "stay(300000)", "Five minutes on the wall. The wall stared back."],
    [34, "u.html", "typed('boo')", "boo. The ghost jumped. So did you."],
    [35, "u.html", "taps('#share-btn', 3, 10000)", "Copied thrice. Now it haunts your clipboard."],
    [36, "u.html", "taps('#wt-lb', 3, 4000)", "Leaderboard, thrice. The podium creaked."],
    [37, "u.html", "taps('#lb-list .lb-top .lb-rank', 3, 2000)", "Number one, tapped. It's cursed. Not yours yet."],
    [38, "u.html", "bottom()", "Bottom of their wall. Something was buried there."],
    [39, "u.html", "typed('follow')", "Typed follow. Now something is following you."],
    [40, "newpairs.html", "taps('#np-refresh', 5, 10000)", "Five refreshes. The radar spins faster after midnight."],
    [41, "newpairs.html", "taps('#np-strategies button:last-of-type', 3, 4000)", "Triple strict. Not even a ghost gets past you."],
    [42, "newpairs.html", "dwell('.np-runner-rank', 2500)", "Gold rank, admired. A past run says nothing about the next one. The dead agree."],
    [43, "newpairs.html", "dwell('#np-feed', 20000)", "Twenty seconds in the feed. It has you in its grip."],
    [44, "newpairs.html", "typed('wen')", "wen? After midnight. Always after midnight."],
    [45, "newpairs.html", "typed('moon')", "moon typed. Something howled back. Moon not guaranteed."],
    [46, "newpairs.html", "taps('h1.section-title', 3, 2000)", "Radar pinged. Something pinged back."],
    [47, "newpairs.html", "hash('radar')", "#radar. You picked up a signal that isn't there."],
    [48, "newpairs.html", "bottom()", "Bottom of the scanner. Nothing escaped. Nothing living, anyway."],
    [49, "communities.html", "dwell('#wk-board .wk-medal', 2500)", "Gold medal, admired. It glows in the dark."],
    [50, "communities.html", "taps('#wk-count', 3, 2000)", "Tick tock. The board resets at the stroke of the week."],
    [51, "communities.html", "taps('h1.section-title', 3, 2000)", "Knocked three times. Nobody answered. Or did they?"],
    [52, "communities.html", "hash('village')", "#village. Population: you, and whatever's in the fog."],
    [53, "community.html", "taps('#cw-tab-holders', 3, 4000)", "Holders tab, thrice. They were all holding their breath."],
    [54, "community.html", "taps('.comm-hero-name', 3, 2000)", "Name tapped three times. Don't tap it a fourth."],
    [55, "community.html", "dwell('#comm-members-list', 6000)", "Roster studied. One name wasn't there a second ago."],
    [56, "community.html", "hold('#comm-hero', 2000)", "Held the hero. It held back."],
    [57, "community.html", "hash('holders')", "#holders. The gate didn't budge. Ghosts can't walk through this one."],
    [58, "community.html", "typed('gn')", "gn, neighbor. Lock the door."],
    [59, "arcade.html", "typed('liftoff')", "liftoff. Objective: 🌕. Beware what howls at it."],
    [60, "arcade.html", "taps('#arc-game-h', 5, 3000)", "Five pokes. The engine coughed up a bat."],
    [61, "arcade.html", "taps('#cmp-h', 3, 2000)", "Competitions header tapped. The scoreboard creaked. Game on."],
    [62, "arcade.html", "dwell('#arc-sub', 5000)", "Stared at the readout. It flickered."],
    [63, "arcade.html", "hash('highscore')", "#highscore. Set by a ghost. Nobody's beaten it."],
    [64, "arcade.html", "hold('#arc-game-h', 2000)", "Held the throttle. The engine moaned."],
    [65, "tracker.html", "taps('h1.section-title', 3, 2000)", "Briefcase tapped. Something rattled inside."],
    [66, "tracker.html", "dwell('.np-hero-warn', 5000)", "You read the warning. Wise. Things lurk in wallets."],
    [67, "tracker.html", "select('not advice')", "Not advice, highlighted. The spirits agree."],
    [68, "tracker.html", "hash('whale')", "#whale. A ghost whale drifts past."],
    [69, "watchlist.html", "taps('h1.section-title', 5, 3000)", "Five stars. The graveyard kind."],
    [70, "watchlist.html", "select('my watchlist')", "Selected your own watchlist. It watches you back."],
    [71, "watchlist.html", "hash('gauge')", "#gauge. Spookiness level: high."],
    [72, "watchlist.html", "bottom()", "Bottom of the list. Every name accounted for. For now."],
    [73, "profile.html", "taps('#pf-avatar', 5, 2000)", "Avatar launched. It came back wearing a sheet."],
    [74, "profile.html", "taps('#gamify-dash .pc-core', 7, 3000)", "Overclocked the core. It glowed like a jack-o'-lantern."],
    [75, "profile.html", "taps('#gamify-dash .eq-op=', 1, 0)", "The maths, finally spelled out. In pumpkin-orange ink."],
    [76, "profile.html", "typed('rekt')", "You asked for it. 💀"],
    [77, "profile.html", "bottom()", "Bottom of the station. The basement lights are out."],
    [78, "profile.html", "taps('#dtab-settings', 3, 3000)", "Settings, thrice. Nothing changed. Something moved."],
    [79, "profile.html", "hash('rekt')", "#rekt. Straight to the graveyard."],
    [80, "profile.html", "taps('#gamify-dash .relic-pip.cur', 1, 0)", "You found the live pip. It still has a heartbeat. 💎"],
    [81, "profile.html", "taps('h1.section-title', 3, 2000)", "Station tapped. The crew are all skeletons."],
    [82, "about.html", "taps('.def-phon', 1, 0)", "Say it with your chest. /sɛnd ɪt/. Now say it three times in a mirror."],
    [83, "about.html", "dwell('#ab-tier', 3000)", "Tier watched closely. It didn't blink."],
    [84, "about.html", "hash('moonmath')", "#moonmath. The numbers stayed honest, even at midnight."],
    [85, "about.html", "taps('.gs-progress-text', 3, 2000)", "Progress text tapped. Progress is a myth. So are ghosts. Probably."],
    [86, "about.html", "bottom()", "Read the whole about. Now you know what haunts this place."],
    [87, "about.html", "select('paper grip')", "Paper grip, highlighted. It's shivering."],
    [88, "about.html", "dwell('#og-rules', 6000)", "Studied the OG rules. The ancient scrolls."],
    [89, "support.html", "taps('h1.section-title', 3, 2000)", "Lifebuoy tapped. Still floating. Like a ghost."],
    [90, "support.html", "typed('help')", "help typed. Ghosts can't pass messages on: ask on this page, or email the address below."],
    [91, "support.html", "dwell('#post-text', 15000)", "Fifteen seconds thinking. The cursor blinked like an eye."],
    [92, "data.html", "taps('.dk-addr', 3, 1000)", "dEaD is forever. Nothing comes back, not even as a ghost."],
    [93, "data.html", "taps('#dk-how-h', 3, 2000)", "Curiosity killed the cat. It has eight more lives."],
    [94, "data.html", "dwell('#dk-what-h', 4000)", "Read what it never opens. Some doors stay shut."],
    [95, "data.html", "hash('key')", "#key. A skeleton key. The locks stayed locked."],
    [96, "whitepaper.html", "bottom()", "Certified reader. 📄👻"],
    [97, "whitepaper.html", "hash('s99')", "Section 99 doesn't exist. Neither do ghosts. Probably."],
    [98, "whitepaper.html", "dwell('.wp-colophon', 4000)", "Colophon lingered. The printer's ghost thanks you."],
    [99, "whitepaper.html", "stay(900000)", "Fifteen minutes. Peer reviewed by the dead."],
    [100, "whitepaper.html", "select('version 1')", "Version 1 selected. Version 2 rises from the grave soon."],
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
    wasIn = signedIn();
    try { localStorage.removeItem('send.eggs.unpaid'); } catch {}   // the server keeps the unpaid list now (GET /api/eggs → unpaid)
    sync().then(flushPending);
    document.addEventListener('auth:change', () => {
      /* A sign-out empties this browser's anonymous ghost memory. The signed-out list has no owner: on a shared
         machine, whatever the next signed-out visitor finds would otherwise be paid to whoever signs in after them,
         and the seen list from the last account would swallow that visitor's own "you found #N" toasts. What
         belongs to an account — its refused claims (MINE) — is tagged with it and waits for it; its unpaid ghosts
         are the server's to list. */
      if (wasIn && !signedIn()) {
        save(KEY, []); save(SEEN, []);
        foundIds = new Set(); serverUnpaid = []; total = null; proofAsked = false;
      }
      wasIn = signedIn();
      sync().then(flushPending);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  // `found(id)` reports a find; `ids` lists what this account has found (a getter once shared the name `found`,
  // and in an object literal the later key wins — EGGS.found(id) was an array, not the function)
  window.EGGS = {
    register, found, sync,
    get ids() { return [...foundIds]; },
    get total() { return total; },
    detect: D,
  };
})();
