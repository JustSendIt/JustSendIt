/* ===== The tour with Sendy — right after sign-up (owner, 2026-10-24) ==================================================
 * "Make a whole tutorial onboarding experience right after users sign-up for the platform that shows the user everything that
 * they have access to with a verified account on the platform. Allow users to skip this if they want to just explore
 * themselves. Make sure the tutorial is detailed but each step simple and direct … Make it the tutorial a fun experience with
 * Sendy being their guide through the tutorial and flying around the site showing you each step of the tutorial and
 * explaining it to the users."
 *
 * How it runs:
 *   · The server says when it is due (/api/me → user.onboard: every account made since it shipped, until it is finished or
 *     skipped) — so every way of signing up leads here, and it follows the member to another device.
 *   · STEPS below, page by page. On each, Sendy (the same 3D sprite and faces as the corner helper) flies to the thing he is
 *     talking about, it is lit up, and a card beside him says what it is in one or two plain sentences. Between pages he flies
 *     off the edge and the next page picks him up (the step is kept in localStorage for the jump and on the server for good).
 *   · Skip at any point (the button, or Esc); Back / Next, or ← / →. Sendy's menu ("Show me around") replays it.
 *   · It waits for whatever the member is in the middle of: the 18+ question, the sign-in window, a burn proof, choosing a
 *     handle, setting up two-factor, the homepage tour. It never starts over a modal.
 *   · Honest: it shows what an account can do and what the one rule for doing things is (a linked wallet that holds the
 *     participation floor of $SEND); it never tells anyone to buy, and says reading needs nothing.
 * CSP-safe: addEventListener only; the styles are in styles.css (the ".ob-" block). */
(function () {
  'use strict';
  const LS = 'jsi-onboard';                 // { user, step, at } — the step in hand across a page change
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.classList.contains('motion-off');
  const phone = () => window.innerWidth < 768 || window.innerHeight < 500;   // a landscape phone too: the card is a sheet (styles.css)
  const sfx = (n) => { try { if (window.SFX) SFX.play(n); } catch {} };
  const me = () => (window.AUTH && AUTH.user) || null;
  const handle = () => (me() ? '@' + me().username : 'friend');
  const verified = () => !!(me() && me().holderVerified);
  const floorUsd = () => { const h = me() && me().holderProof; return h && h.minUsd ? h.minUsd : 100; };
  // a top-level page may be asked for as /name.html; a member's wall (/u/<handle>) is compared as it is — a handle can end in ".html"
  const here = () => (location.pathname.replace(/^(\/[^/]+)\.html$/, '$1').replace(/\/+$/, '') || '/');
  const ownWall = () => (me() ? '/u/' + encodeURIComponent(me().username) : '/profile');
  const store = {
    get() { try { const v = JSON.parse(localStorage.getItem(LS) || 'null'); return v && me() && v.user === me().username && Date.now() - (v.at || 0) < 12 * 3600e3 ? v : null; } catch { return null; } },
    set(step) { try { localStorage.setItem(LS, JSON.stringify({ user: me() && me().username, step, at: Date.now() })); } catch {} },
    clear() { try { localStorage.removeItem(LS); } catch {} },
  };

  /* ---------- the steps: where, what to light up, and what Sendy says ----------
     page: a path, '*' (any page) or a function (the member's own wall). sel: what to light up, the first one on the page wins;
     none found → the card sits in the middle with Sendy beside it. act: the face Sendy pulls on arrival (assets/sendy-acts.json). */
  const STEPS = [
    { id: 'hello', page: '*', chapter: 'Welcome', act: 'wave', title: () => 'Hi ' + handle() + ' — I’m Sendy! 🚀',
      body: () => 'Your account is ready. Let me fly you around everything it can do — about two minutes, one simple step at a time. Skip whenever you like; I’ll be in the corner.' },
    { id: 'you', page: '/', chapter: 'Your account', sel: ['#nav-auth'], act: 'point', title: 'This is you 👋',
      body: 'Your level, your Send Power and your boost live up here. Tap it any time to open your dashboard.' },
    { id: 'bell', page: '/', chapter: 'Your account', sel: ['#nav-notif', '#notif-bell'], act: 'peek', title: 'Your notifications 🔔',
      body: 'Replies, new followers and Send Calls on the move all land here.' },
    { id: 'unlock', page: '/', chapter: 'Your account', sel: ['#nav-auth'], act: () => (verified() ? 'cheer' : 'point'),
      title: () => (verified() ? 'You’re verified ✅' : 'One step opens everything 🔓'),
      body: () => (verified()
        ? 'Posting, following, Send Calls, reactions, votes, communities, squads, wallet tracking and Rocket Run are all open to you. Keep the bag: selling it within a day of a buy makes the account read-only for a while.'
        : 'Reading is open to everyone. Posting, following, Send Calls, reactions, votes, communities, squads, wallet tracking and Rocket Run open the moment a wallet you link holds $' + floorUsd() + ' of $SEND bought on the market. No wait — but selling it within a day of buying makes the account read-only for a while.') },
    { id: 'fab', page: '/', chapter: 'Your account', sel: ['#compose-fab'], act: 'point', title: 'Post from anywhere ✏️',
      body: 'This button follows you around the whole site. Tap it to post on the Wall in seconds.' },
    { id: 'wall', page: '/wall', chapter: 'The Send Wall', sel: ['#post-text', '#composer-card'], act: 'sendit', title: 'The Send Wall 🧱',
      body: 'Share wins, memes and cope, with a picture if you like. Everyone on the site can see it.' },
    { id: 'feed', page: '/wall', chapter: 'The Send Wall', sel: ['#tab-following', '#tab-all', '#feed-panel'], act: 'giggle', title: 'React, reply, follow 🔥',
      body: 'React to posts, reply, and follow the people you like. The Following tab shows just them.' },
    { id: 'scan', page: '/newpairs', chapter: 'The Scanner', sel: ['#sc-form'], act: 'peek', title: 'Scan any token 🔎',
      body: 'Paste a token or pool address — Robinhood Chain, Ethereum or Solana — or type a name. You get its full on-chain read: risk, holders, liquidity, the contract.' },
    { id: 'call', page: '/newpairs', chapter: 'The Scanner', sel: ['#sc-form'], act: 'point', title: 'Make a Send Call 📣',
      body: 'From a scan of a Robinhood Chain token you can post a Send Call: a public scorecard of your pick that earns Send Power as it moves. Tap ☆ to keep a token on your Watchlist.' },
    { id: 'swap', page: '/newpairs', chapter: 'The Scanner', sel: ['#sc-form'], act: 'vee', title: 'Swap in your own wallet 💱',
      body: 'Each token’s detail has a Swap button that builds the trade for your wallet to check and sign. We never hold your funds — and never tell you to buy.' },
    { id: 'radar', page: '/newpairs', chapter: 'The Scanner', sel: ['#sc-tab-new'], act: 'point', title: 'The New Pairs radar 📡',
      body: 'Brand-new tokens on Robinhood Chain, found and scored for risk as they launch — a members’ tab.' },
    { id: 'comms', page: '/communities', chapter: 'Communities', sel: ['#comm-officials-h', '#comm-start', '#comm-officials'], act: 'hug', title: 'Token communities 👥',
      body: 'Any Robinhood Chain token with a priced pool of $500 or more can have one. It goes live at 10 verified holders; members get a holders-only wall, proposals and, while they’re in a live one, a flat 10× Send Power boost.' },
    { id: 'squads', page: '/communities', chapter: 'Communities', sel: ['[data-cstatus="squads"]', '#sq-h'], act: 'wink', title: 'Send Squads 🛡️',
      body: 'Private groups for your crew — open, or gated by a token you choose. This tab opens them: make Send Calls only your squad sees, and earn points together.' },
    { id: 'tracker', page: '/tracker', chapter: 'Wallet tracker', sel: ['#trk-add', '#trk-so-form', '#trk-side-h', '#trk-signedout'], act: 'peek', title: 'Track any wallet 👛',
      body: () => 'Add any Robinhood Chain wallet to see its holdings, every trade, its profit and loss, and its value over time — saved for you.' + (verified() ? '' : ' Adding one takes the same $SEND check as posting.') },
    { id: 'rocket', page: '/arcade', chapter: 'The Arcade', sel: ['#arc-game-h', '#arc-btn', '#arc-game'], act: 'sendit', title: 'Rocket Run 🕹️',
      body: () => 'Fly the rocket once a day for a Send Power boost for the day. ' + (verified() ? 'Free to play — nothing to buy, nothing at stake.' : 'It takes the same $SEND check as posting, and nothing is ever wagered.') },
    { id: 'slots', page: '/arcade', chapter: 'The Arcade', sel: ['#slots-h', '#slot-lever', '#slots'], act: 'twirl', title: 'Just Spin It 🎰',
      body: 'A free slot machine for fun and bragging rights. Score only — never money.' },
    { id: 'dash', page: '/profile', chapter: 'Your profile', sel: ['#dtabs', '#gamify-dash'], act: 'point', title: 'Your dashboard 📊',
      body: 'Quests, the leaderboard and every Send Power rule live on Overview. The other tabs hold your wallet, invites, tracked wallets and settings.' },
    { id: 'link', page: '/profile', chapter: 'Your profile', sel: ['#dtab-wallet'], act: 'point', title: () => (verified() ? 'Your wallets 🔗' : 'Link your wallet 🔗'),
      body: () => (verified()
        ? 'Your linked wallets live here — they set your holder boost. Linking one moves nothing: you sign a message. A wallet that can’t sign is proved by a burn of any amount you send yourself — a real transaction, gone for good.'
        : 'Link a wallet here: it is how the site checks the one rule for doing things. Linking moves nothing — you sign a message. A wallet that can’t sign is proved by a burn of any amount you send yourself instead: a real transaction, gone for good.') },
    { id: 'safe', page: '/profile', chapter: 'Your profile', sel: ['#dtab-settings'], act: 'wink', title: 'Keep it safe 🔐',
      body: 'Settings has your profile, your sign-in methods and two-factor. Nobody here will ever ask for your seed phrase.' },
    { id: 'mywall', page: ownWall, chapter: 'Your wall', sel: ['#ci-go', '#checkin', 'main h1'], act: 'cheer', title: 'Your wall + daily check-in 📅',
      body: 'This is your public wall. Check in once a day for bonus Send Power, and style it your way.' },
    { id: 'done', page: ownWall, chapter: 'All set', act: 'bliss', final: true, title: () => 'You’re all set, ' + handle() + '! 🎉',
      body: 'That’s everything your account can do. Tap me in the corner any time to ask a question — and replay this tour from my menu. Entertainment only, never financial advice.' },
  ];
  const val = (v) => (typeof v === 'function' ? v() : v);
  const pageOf = (s) => val(s.page);
  const onPage = (s) => { const p = pageOf(s); return p === '*' || p === here() || (p === '/' && here() === '/index'); };
  const chapters = [...new Set(STEPS.map((s) => s.chapter))];
  const PAGE_NAMES = { '/': 'the home page', '/wall': 'the Send Wall', '/newpairs': 'the Scanner', '/communities': 'Communities', '/tracker': 'the wallet tracker', '/arcade': 'the Arcade', '/profile': 'your profile' };
  const pageName = (p) => PAGE_NAMES[p] || (/^\/u\//.test(p) ? 'your wall' : 'the next page');

  /* ---------- the server's record ---------- */
  let saveT = null;
  function save(action, step) {
    const body = JSON.stringify(Object.assign({ action }, Number.isInteger(step) ? { step } : {}));
    const go = () => fetch('/api/onboard', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).then((r) => r.json()).then((j) => { if (j && j.onboard && me()) me().onboard = j.onboard; }).catch(() => {});
    clearTimeout(saveT);
    if (action === 'step') saveT = setTimeout(go, 400); else go();
  }

  /* ---------- the guide: Sendy's sprite and faces ---------- */
  let root = null, guide = null, spot = null, card = null, blocker = null, live = null, idx = 0, running = false, mode = null, pos = null, lastFocus = null, acts = null, actTimer = null, landAt = null, fitAt = null, owner = null, flight = null, finishT = null, resumeT = null;
  function loadActs() {
    if (acts !== null) return; acts = false;
    fetch('/assets/sendy-acts.json').then((r) => (r.ok ? r.json() : null)).then((m) => {
      if (!m || !Array.isArray(m.acts) || !(m.dur > 0 && m.dur <= 3)) return;
      const ok = m.acts.filter((a) => /^[a-z]+$/.test(a.id) && a.cells > 0 && a.fps > 0 && Array.isArray(a.seq) && a.seq.length && a.seq.every((c) => Number.isInteger(c) && c >= 0 && c < a.cells));
      const pct = (i, n) => (n > 1 ? +(i / (n - 1) * 100).toFixed(4) : 0) + '%';
      let css = '';
      for (const a of ok) {
        const steps = [];
        a.seq.forEach((c, j) => { if (!j || c !== a.seq[j - 1]) steps.push(+(j / a.fps / m.dur * 100).toFixed(3) + '%{background-position:' + pct(c, a.cells) + ' 0}'); });
        css += '#ob-sendy[data-act="' + a.id + '"] .ob-act{--act-k:' + a.k + ';background-image:url(/assets/sendy-act-' + a.id + '.webp);background-size:' + (a.cells * 100) + '% 100%;--peak:' + pct(a.peak, a.cells) + ';animation:ob-a-' + a.id + ' ' + m.dur + 's step-end both}@keyframes ob-a-' + a.id + '{' + steps.join('') + '}';
        const im = new Image(); im.decoding = 'async'; im.src = '/assets/sendy-act-' + a.id + '.webp';
      }
      css += '@media (prefers-reduced-motion:reduce){#ob-sendy[data-act] .ob-act{animation:none;background-position:var(--peak) 0}}html.motion-off #ob-sendy[data-act] .ob-act{animation:none;background-position:var(--peak) 0}';
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      acts = { dur: m.dur, ids: new Set(ok.map((a) => a.id)) };
    }).catch(() => {});
  }
  function face(id) {
    if (!guide || !acts || !acts.ids || !acts.ids.has(id)) return;
    guide.removeAttribute('data-act'); void guide.offsetWidth; guide.setAttribute('data-act', id);
    clearTimeout(actTimer); actTimer = setTimeout(() => guide && guide.removeAttribute('data-act'), Math.round(acts.dur * 1000));
  }
  const size = () => (guide ? guide.offsetWidth || 96 : 96);   // untransformed: a tilted sprite in flight measures wider
  function place(x, y) {
    const s = size();
    x = Math.max(4, Math.min(x, window.innerWidth - s - 4)); y = Math.max(4, Math.min(y, window.innerHeight - s - 4));
    guide.style.left = x + 'px'; guide.style.top = y + 'px'; pos = { x, y };
  }
  // a flight: a curve from where he is to where he is going, leaning into it (the corner helper's flight, longer and quicker)
  function flyTo(x, y, cb, opts) {
    const s = size(), g = guide;
    if (!g) return;
    const off = !!(opts && opts.offscreen);   // off to the next page: past the edge, so the x is not kept on the screen
    if (!off) x = Math.max(4, Math.min(x, window.innerWidth - s - 4));
    y = Math.max(4, Math.min(y, window.innerHeight - s - 4));
    let from = pos || { x: window.innerWidth + 20, y: window.innerHeight * 0.4 };
    if (flight) {   // a flight still in the air is retired: this one starts from where he is now, and its landing never runs
      const r = g.getBoundingClientRect(); from = { x: r.left + (r.width - s) / 2, y: r.top + (r.height - s) / 2 };
      flight.stale = true; try { flight.anim.cancel(); } catch {} flight = null; g.classList.remove('is-flying');
    }
    landAt = null;   // a re-layout during this flight sets where he lands instead (relayout)
    const dx = x - from.x, dy = y - from.y, len = Math.hypot(dx, dy);
    if (reduced() || !g.animate || len < 8) { if (!off) place(x, y); if (cb) cb(); return; }
    g.style.left = from.x + 'px'; g.style.top = from.y + 'px';
    const bend = Math.min(120, len / 3.5) * (dx >= 0 ? -1 : 1), cx = from.x + dx / 2 - dy / len * bend, cy = from.y + dy / 2 + dx / len * bend;
    const frames = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18, u = 1 - t, px = u * u * from.x + 2 * u * t * cx + t * t * x, py = u * u * from.y + 2 * u * t * cy + t * t * y;
      const tx = 2 * u * (cx - from.x) + 2 * t * (x - cx), ty = 2 * u * (cy - from.y) + 2 * t * (y - cy);
      const tilt = Math.max(-30, Math.min(30, Math.atan2(tx, -ty) * 180 / Math.PI * 0.4));
      frames.push({ transform: 'translate(' + (px - from.x) + 'px,' + (py - from.y) + 'px) rotate(' + (i === 18 ? 0 : tilt) + 'deg)' });
    }
    g.classList.add('is-flying');
    const anim = g.animate(frames, { duration: Math.min(1500, 650 + len * 0.55), easing: 'cubic-bezier(.45,.05,.25,1)' });
    const f = flight = { anim, stale: false };
    let done = false;
    const end = () => {
      if (done || f.stale || g !== guide) return;   // retired by a newer flight, or the tour has closed
      done = true; flight = null; g.classList.remove('is-flying');
      if (off) { g.style.left = x + 'px'; g.style.top = y + 'px'; } else { const at = landAt || { x, y }; landAt = null; place(at.x, at.y); }
      if (cb) cb();
    };
    anim.onfinish = end; anim.oncancel = end;
    setTimeout(end, 1700);   // a background tab never finishes an animation: the step must not wait on it
  }

  /* ---------- what is in the way ---------- */
  const shown = (el) => !!el && !el.hasAttribute('hidden') && el.getClientRects().length > 0;
  function blocked() {
    const u = me();
    if (!u) return 'signed-out';
    if (u.auto_named && here() === '/profile') return 'claim';               // the handle form is open: choosing one comes first
    if (window.AGE && AGE.needed) return 'age';
    for (const id of ['intro', 'auth-modal', 'compose-modal', 'full-view', 'notif-panel']) if (shown(document.getElementById(id))) return id;   // intro: the homepage's loading screen
    if (document.querySelector('#invite-overlay[data-open], .bp-overlay:not([hidden]), .tour-welcome-wrap, .tour-tip')) return 'overlay';
    if (here() === '/profile' && /^#sec-security/.test(location.hash)) return 'setup';   // two-factor being set up right now
    return null;
  }
  function firstTarget(s) {
    for (const q of s.sel || []) { const el = document.querySelector(q); if (el && el.getClientRects().length) return el; }
    return null;
  }

  /* ---------- the layer ---------- */
  function build() {
    if (root) return;
    root = document.createElement('div'); root.id = 'ob-root'; root.className = 'ob-root';
    root.innerHTML =
      '<div class="ob-block" aria-hidden="true"></div>' +
      '<div class="ob-spot" aria-hidden="true" hidden></div>' +
      '<div id="ob-sendy" class="ob-sendy" aria-hidden="true"><span class="ob-sprite"></span><span class="ob-act"></span></div>' +
      '<div class="ob-card" role="dialog" aria-modal="true" aria-labelledby="ob-title" aria-describedby="ob-body" tabindex="-1"></div>' +
      '<span class="ob-live sr-only" role="status" aria-live="polite"></span>';
    document.body.appendChild(root);
    owner = me() && me().username;   // whose tour this is: another account signing in closes it (auth:change)
    blocker = root.querySelector('.ob-block'); spot = root.querySelector('.ob-spot'); guide = root.querySelector('#ob-sendy'); card = root.querySelector('.ob-card'); live = root.querySelector('.ob-live');
    blocker.addEventListener('click', () => { card.classList.remove('ob-nudge'); void card.offsetWidth; card.classList.add('ob-nudge'); const b = card.querySelector('[data-ob="next"]'); if (b) b.focus(); });
    card.addEventListener('click', onCard);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', relayout); window.addEventListener('scroll', relayout, { passive: true });
    document.documentElement.classList.add('ob-on');
    lastFocus = document.activeElement;
    loadActs();
  }
  function teardown() {
    if (flight) { flight.stale = true; try { flight.anim.cancel(); } catch {} flight = null; }
    clearTimeout(finishT); clearTimeout(waitT); clearTimeout(resumeT); clearTimeout(relayT); clearTimeout(actTimer); owner = null;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', relayout); window.removeEventListener('scroll', relayout);
    if (root) root.remove(); document.querySelectorAll('.ob-spacer').forEach((x) => x.remove()); root = guide = spot = card = blocker = live = null; pos = null; running = false; mode = null;
    document.documentElement.classList.remove('ob-on', 'ob-tour');
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch {} }
  }

  /* ---------- a step ---------- */
  let target = null;
  function cardHTML(s, n) {
    const total = STEPS.length - 1;   // the hello is step 0; the rest are counted
    const next = STEPS[n + 1], away = next && !onPage(next) && !s.final;
    const sameAsTitle = String(val(s.title)).indexOf(s.chapter) === 0;
    const prog = n === 0 ? '' : '<p class="ob-meta"><span class="ob-chapter">' + (sameAsTitle ? '' : esc(s.chapter)) + '</span> <span class="ob-count">Step ' + n + ' of ' + total + '</span></p>' +
      '<div class="ob-bar" aria-hidden="true"><span style="width:' + Math.round(n / total * 100) + '%"></span></div>';
    const btns = n === 0
      ? '<button type="button" class="btn btn-primary" data-ob="next" data-tip="Starts the tour: Sendy flies you around the site, one simple step at a time">Show me around 🚀</button>' +
        '<button type="button" class="btn btn-ghost" data-ob="skip" data-tip="Skips the tour so you can explore on your own; replay it any time from Sendy’s menu">I’ll explore myself</button>'
      : s.final
        ? '<button type="button" class="btn btn-ghost btn-sm" data-ob="back" data-tip="Goes back one step">← Back</button><button type="button" class="btn btn-primary" data-ob="finish" data-tip="Ends the tour — Sendy goes back to the corner, ready for your questions">Let’s go! 🚀</button>'
        : '<button type="button" class="btn btn-ghost btn-sm" data-ob="back" data-tip="Goes back one step">← Back</button>' +
          '<button type="button" class="btn btn-primary" data-ob="next" data-tip="' + esc(away ? 'Sendy flies you to ' + pageName(pageOf(next)) + ' for the next part of the tour' : 'Shows the next step of the tour') + '">' + (away ? 'Fly to ' + esc(pageName(pageOf(next))) + ' →' : 'Next →') + '</button>' +
          '<button type="button" class="btn btn-link ob-skip" data-ob="skip" data-tip="Ends the tour now; replay it any time from Sendy’s menu">Skip tour</button>';
    return prog + '<h2 class="ob-title" id="ob-title">' + esc(val(s.title)) + '</h2><p class="ob-body" id="ob-body">' + esc(val(s.body)) + '</p><div class="ob-btns">' + btns + '</div>';
  }
  function show(n, arriving) {
    idx = Math.max(0, Math.min(n, STEPS.length - 1));
    const s = STEPS[idx];
    store.set(idx); save('step', idx);
    if (!onPage(s)) return go(pageOf(s));   // its page is another one: off we fly
    mode = 'step';
    card.innerHTML = cardHTML(s, idx);
    card.classList.remove('ob-resume', 'ob-leaving'); card.inert = false;
    // what to light up: on the page now, or within two seconds (a section that loads its data first — the squads, the check-in)
    const seq = (show.seq = (show.seq || 0) + 1);
    const t0 = Date.now();
    fitAt = null;
    const look = () => {
      if (!root || seq !== show.seq) return;
      target = firstTarget(s);
      if (!target && s.sel && s.sel.length && Date.now() - t0 < 2000) return void setTimeout(look, 150);
      if (target) bringIntoView(target); else try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch {}
      setTimeout(present, 60);
    };
    const present = () => {
      if (!root || seq !== show.seq) return;
      refit();
      const L = layout();
      flyTo(L.sx, L.sy, () => { face(val(s.act) || 'point'); });
      if (!arriving) sfx(idx === 0 ? 'open' : 'nav');
      live.textContent = val(s.title);
      const b = card.querySelector('[data-ob="next"], [data-ob="finish"]'); if (b) b.focus({ preventScroll: true });
      // and three more looks over the first two seconds, for a section that is slower to fill in (refit)
      [450, 1100, 2200].forEach((ms) => setTimeout(() => { if (root && seq === show.seq && mode === 'step' && refit()) relayout(); }, ms));
    };
    look();
  }
  /* The target where the card can sit beside it without covering it: in the middle when that leaves room above or below (or to a
     side), else near the top under the menu bar, so the card fits below it. A phone puts it in the top half, over the sheet. */
  // every scroll here is 'instant': the site sets scroll-behavior: smooth, and a smooth scroll is still moving when the layout is measured
  function bringIntoView(t) {
    const H = window.innerHeight, W = window.innerWidth, top0 = 84;
    const cr = card.getBoundingClientRect(), ch = cr.height || 260, cw = cr.width || 480;
    const fits = (r) => r.top - 16 - 76 >= ch || H - r.bottom - 28 >= ch || W - r.right - 28 >= cw || r.left - 28 >= cw;
    try { t.scrollIntoView({ block: phone() ? 'start' : 'center', inline: 'nearest', behavior: 'instant' }); } catch {}
    let r = t.getBoundingClientRect();
    if (phone()) { if (r.top < 70 || r.bottom > H * 0.5) window.scrollBy({ top: r.top - 70, behavior: 'instant' }); }
    else if (!fits(r)) window.scrollBy({ top: r.top - top0, behavior: 'instant' });
    fitAt = { y: t.getBoundingClientRect().top, s: window.scrollY };   // where it was left (refit)
  }
  /* The page can still be filling in above the target (a list loading its data) and push it down after it was fitted, under the
     card. When it has moved from where bringIntoView left it while the page itself did not scroll (a member scrolling is left
     alone), it is fitted again. */
  function refit() {
    if (!target || !fitAt) return false;
    const y = target.getBoundingClientRect().top;
    if (Math.abs(window.scrollY - fitAt.s) >= 2 || Math.abs(y - fitAt.y) <= 12) return false;
    bringIntoView(target); return true;
  }
  // where everything goes for this step: the lit box, Sendy beside the target, the card beside Sendy (a bottom sheet on a phone)
  function layout() {
    const W = window.innerWidth, H = window.innerHeight, s = size(), pad = 8;
    const r = target ? target.getBoundingClientRect() : null;
    if (r && r.width && r.height) {
      // only the part of the target on the screen is lit: scrolled away, it is not drawn over whatever is there instead
      const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad), bottom = Math.min(H - 4, r.bottom + pad), right = Math.min(W - 4, r.right + pad);
      spot.hidden = bottom - top < 8 || right - left < 8;
      if (!spot.hidden) Object.assign(spot.style, { top: top + 'px', left: left + 'px', width: (right - left) + 'px', height: (bottom - top) + 'px' });
    } else spot.hidden = true;
    card.style.left = card.style.top = card.style.right = card.style.bottom = '';
    if (phone()) {
      /* The card is a sheet across the screen (CSS): at the bottom, or at the top when the target is in the lower half (a button
         pinned to the bottom of the screen, like ✏️ SEND IT, would be under a bottom sheet). Sendy perches between the two. */
      const low = !!(r && r.top > H * 0.5);
      card.classList.toggle('ob-top', low);
      const chh = card.getBoundingClientRect().height;
      if (low) {
        const sheetBottom = chh + 8;
        return { sx: r ? Math.min(W - s - 6, Math.max(6, r.right - s * 0.8)) : W - s - 10, sy: r ? Math.max(sheetBottom - s * 0.2, Math.min(r.top - pad - s * 0.92, H - s - 6)) : sheetBottom };
      }
      const sheetTop = H - chh - 8;
      let sx = W - s - 10, sy = sheetTop - s * 0.85;
      if (r && r.bottom < sheetTop - s * 0.2) { sx = Math.min(W - s - 6, Math.max(6, r.right - s * 0.6)); sy = Math.min(sheetTop - s * 0.85, Math.max(6, r.bottom + pad - s * 0.08)); }
      if (r && r.width) {   // a tall target leaves no room under it: above it then (over the dimmed menu bar), whichever covers less of it
        const k = s * 0.15, sr = { l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad };
        const over = (x, y) => Math.max(0, Math.min(x + s - k, sr.r) - Math.max(x + k, sr.l)) * Math.max(0, Math.min(y + s - k, sr.b) - Math.max(y + k, sr.t));
        const upY = Math.max(4, r.top - pad - s * 0.92);
        if (over(sx, sy) > over(sx, upY)) sy = upY;
      }
      return { sx, sy };
    }
    card.classList.remove('ob-top');
    const cw = card.getBoundingClientRect().width || 460, ch = card.getBoundingClientRect().height || 240, M = 12, G = 16;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    if (!r || !r.width) {   // nothing to point at: the card in the middle, Sendy at its top-left corner
      const cx = (W - cw) / 2, cy = Math.max(16, (H - ch) / 2);
      card.style.left = cx + 'px'; card.style.top = cy + 'px';
      return { sx: cx - s * 0.75, sy: cy - s * 0.55 };
    }
    /* The card goes where it fits WITHOUT covering the lit thing — below it, above it, to its right, to its left. Where none
       does (a big target on a short screen), it is pinned to the edge on the roomier side, away from the target's middle, so it
       covers as little of it as it can. Sendy sits on the card's corner nearest the target: between what he says and what he
       points at. */
    const top0 = 76;   // under the sticky menu bar
    let cx, cy, side;
    if (H - r.bottom - G - M >= ch) { side = 'below'; cy = r.bottom + G; cx = clamp(r.left, M, W - cw - M); }
    else if (r.top - G - top0 >= ch) { side = 'above'; cy = r.top - G - ch; cx = clamp(r.left, M, W - cw - M); }
    else if (W - r.right - G - M >= cw) { side = 'right'; cx = r.right + G; cy = clamp(r.top, top0, H - ch - M); }
    else if (r.left - G - M >= cw) { side = 'left'; cx = r.left - G - cw; cy = clamp(r.top, top0, H - ch - M); }
    else { side = H - r.bottom >= r.top ? 'below' : 'above'; cy = side === 'below' ? H - ch - M : top0; cx = (r.left + r.right) / 2 > W / 2 ? M : W - cw - M; }
    cy = clamp(cy, M, Math.max(M, H - ch - M)); cx = clamp(cx, M, Math.max(M, W - cw - M));   // on the screen, whatever the target does
    card.style.left = cx + 'px'; card.style.top = cy + 'px';
    const tx = (r.left + r.right) / 2, nearRight = tx > cx + cw / 2;
    let sx, sy;
    if (side === 'below') { sx = nearRight ? cx + cw - s * 0.7 : cx - s * 0.3; sy = cy - s * 0.78; }
    else if (side === 'above') { sx = nearRight ? cx + cw - s * 0.7 : cx - s * 0.3; sy = cy + ch - s * 0.22; }
    else if (side === 'right') { sx = cx - s * 0.62; sy = cy - s * 0.5; }
    else { sx = cx + cw - s * 0.38; sy = cy - s * 0.5; }
    /* …unless that corner puts him over the lit thing (a card just under a wide target): then the card's other top corner, then
       beside the card at its middle — the first of those that stays on screen and leaves the lit box clear. k is the sprite's
       own margin (the box is wider than Sendy). Where none is clear he keeps the first place. */
    const k = s * 0.15, sr = { l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad };
    const onScreen = (x, y) => x >= 4 && y >= 4 && x + s <= W - 4 && y + s <= H - 4;
    const clear = (x, y) => x + s - k <= sr.l || x + k >= sr.r || y + s - k <= sr.t || y + k >= sr.b;
    const midY = clamp(cy + ch / 2 - s / 2, 4, H - s - 4);
    const tries = [[sx, sy], [cx + cw - s * 0.2, midY], [cx - s * 0.8, midY]];
    if (side === 'below' || side === 'above') tries.splice(1, 0, [nearRight ? cx - s * 0.3 : cx + cw - s * 0.7, sy]);
    const best = tries.find(([x, y]) => onScreen(x, y) && clear(x, y));
    if (best) return { sx: best[0], sy: best[1] };
    return { sx: clamp(sx, 4, W - s - 4), sy: clamp(sy, 4, H - s - 4) };
  }
  let relayT = null;
  function relayout() {
    if (!root || mode !== 'step') return;
    clearTimeout(relayT); relayT = setTimeout(() => { if (!root || mode !== 'step') return; const L = layout(); if (guide.classList.contains('is-flying')) landAt = { x: L.sx, y: L.sy }; else place(L.sx, L.sy); }, 80);
  }

  /* ---------- off to another page ---------- */
  function go(path) {
    if (!path || path === '*') return;
    sfx('launch');
    mode = 'leaving';   // the card takes no more presses (onCard): a second click would move the tour twice
    if (spot) spot.hidden = true;
    if (card) { card.classList.add('ob-leaving'); card.inert = true; }
    const out = () => { location.href = path; };
    if (guide && !reduced()) flyTo(window.innerWidth + 40, Math.max(20, window.innerHeight * 0.25), out, { offscreen: true }); else out();
  }

  /* ---------- the controls ---------- */
  function onCard(e) {
    if (mode !== 'step' && mode !== 'resume') return;   // leaving for the next page, or finishing
    const b = e.target.closest('[data-ob]'); if (!b) return;
    const a = b.getAttribute('data-ob');
    if (a === 'next') { const nx = idx + 1; if (nx < STEPS.length) show(nx); }
    else if (a === 'back') { if (idx > 0) { sfx('tap'); show(idx - 1); } }
    else if (a === 'skip') skip();
    else if (a === 'finish') finish();
    else if (a === 'resume') { sfx('select'); try { sessionStorage.removeItem('jsi-onboard-later'); } catch {} show(idx); }
    else if (a === 'later') later();
  }
  function onKey(e) {
    if (!root) return;
    if (mode === 'resume') {   // a small offer beside a page in use: only a key pressed in the card is its business
      if (e.key === 'Escape' && card && card.contains(e.target)) { e.preventDefault(); later(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (mode === 'step') skip(); return; }
    if (mode !== 'step') return;
    const inField = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    if (!inField && e.key === 'ArrowRight' && !STEPS[idx].final) { e.preventDefault(); show(idx + 1); }
    else if (!inField && e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); show(idx - 1); }
    else if (e.key === 'Tab') {   // focus stays in the card while the tour is up
      const f = [...card.querySelectorAll('button')]; if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }
  function skip() {
    sfx('close');
    save('skip', idx); store.clear();
    if (window.sendToast) sendToast('Tour skipped — explore away! Replay it any time from Sendy’s menu 🚀', 5000);
    teardown();
  }
  function later() { sfx('close'); try { sessionStorage.setItem('jsi-onboard-later', '1'); } catch {} teardown(); }   // "Not now": hidden for this visit, the place kept
  function finish() {
    mode = 'finishing'; if (card) card.inert = true;   // done is done: no Esc turns it into a skip on the way out
    save('done', idx); store.clear();
    sfx('success');
    if (window.sendConfetti) sendConfetti(window.innerWidth / 2, window.innerHeight / 3, { count: 80, emojiRatio: 0.5 });
    if (guide && !reduced()) { face('sendit'); finishT = setTimeout(() => flyTo(window.innerWidth - size() - 16, window.innerHeight - size() - 90, teardown), 500); } else teardown();
  }

  /* ---------- a member who wandered off mid-tour: a small offer to pick it up, not a wall ---------- */
  function offerResume(n) {
    build(); mode = 'resume'; idx = n;
    blocker.hidden = true; spot.hidden = true;
    card.classList.add('ob-resume'); card.setAttribute('aria-modal', 'false');
    const s = STEPS[n];
    card.innerHTML = '<h2 class="ob-title" id="ob-title">Pick the tour back up? 🚀</h2><p class="ob-body" id="ob-body">' + esc('Next stop: ' + s.chapter + ' — on ' + pageName(pageOf(s)) + '. Step ' + n + ' of ' + (STEPS.length - 1) + '.') + '</p>' +
      '<div class="ob-btns"><button type="button" class="btn btn-primary" data-ob="resume" data-tip="' + esc('Sendy flies you to ' + pageName(pageOf(s)) + ' and the tour carries on where you left it') + '">Carry on →</button>' +
      '<button type="button" class="btn btn-ghost" data-ob="later" data-tip="Hides this until your next visit; the tour keeps its place">Not now</button>' +
      '<button type="button" class="btn btn-link ob-skip" data-ob="skip" data-tip="Ends the tour for good; replay it any time from Sendy’s menu">Skip tour</button></div>';
    setTimeout(() => { if (!root) return; const s2 = size(), cr = card.getBoundingClientRect(); flyTo(cr.left - s2 * 0.6, cr.top - s2 * 0.6, () => face('wave')); }, 60);
  }

  /* ---------- starting ---------- */
  let waitT = null;
  function start(n, opts) {
    clearTimeout(waitT);
    const why = blocked();
    if (why === 'signed-out') return;
    if (why) { waitT = setTimeout(() => start(n, opts), 900); return; }   // after whatever the member is in the middle of
    build(); running = true; blocker.hidden = false;
    card.setAttribute('aria-modal', 'true');
    document.documentElement.classList.add('ob-tour');   // scroll anchoring off while the tour is out (styles.css)
    if (!document.querySelector('.ob-spacer')) { const pad = document.createElement('div'); pad.className = 'ob-spacer'; pad.setAttribute('aria-hidden', 'true'); document.body.appendChild(pad); }   // scroll room on a short page (styles.css) — the full tour only
    show(n, opts && opts.arriving);
  }
  async function boot() {
    try { if (window.AUTH && AUTH.ready) await AUTH.ready; } catch {}
    check();
  }
  const laterSet = () => { try { return sessionStorage.getItem('jsi-onboard-later') === '1'; } catch { return false; } };
  function check() {
    clearTimeout(resumeT);
    if (running || root) return;
    const u = me(); if (!u) return;
    const ob = u.onboard; const local = store.get();
    if (!(ob && ob.due)) { if (local) store.clear(); return; }
    // the homepage tour for visitors is not for members on this tour: it is marked seen
    try { localStorage.setItem('jsi-tour-v1', 'onboard'); } catch {}
    const n = Math.max(0, Math.min(STEPS.length - 1, local ? local.step : (ob.step || 0)));
    const s = STEPS[n];
    if (n > 0 && !local && laterSet()) return;   // "Not now" holds for this visit on every page, the step's own page too
    if (n === 0 || onPage(s)) return start(n, { arriving: !!local });
    const who = u.username;   // one waiting chain at a time (resumeT), for this member only
    const wait = () => { if (root || !me() || me().username !== who || laterSet()) return; if (blocked()) { resumeT = setTimeout(wait, 900); return; } offerResume(n); };
    wait();
  }
  // replay: from Sendy's menu, any time
  function replay() {
    if (!me()) return;
    try { sessionStorage.removeItem('jsi-onboard-later'); } catch {}
    if (root) teardown();
    clearTimeout(resumeT);
    if (blocked() === 'claim' && window.sendToast) sendToast('Pick your handle first — the tour starts right after 🚀', 5000);
    store.set(0);
    if (me().onboard) me().onboard = { due: true, state: 'due', step: 0 };
    save('replay');
    start(0);
  }
  window.ONBOARD = { replay, active: () => !!root, due: () => !!(me() && me().onboard && me().onboard.due), STEPS, _layout: () => layout() };
  document.addEventListener('auth:change', () => {
    if (root && (!me() || me().username !== owner)) teardown();   // signed out, or another account in: this tour was not theirs
    if (!root) { clearTimeout(waitT); clearTimeout(resumeT); setTimeout(check, 300); }
  });
  // back to a page left mid-flight (the back/forward cache keeps it as it was): undo the departure and offer the tour again
  window.addEventListener('pageshow', (e) => { if (e.persisted && root && (mode === 'leaving' || mode === 'finishing')) { teardown(); check(); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
