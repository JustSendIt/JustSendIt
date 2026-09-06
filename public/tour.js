/* ===== $Send onboarding: welcome popup + guided spotlight tour (homepage) =====
 * Fun, fast, skippable, keyboard-operable, reduced-motion aware, and nag-proof
 * (localStorage flag). Relaunchable anytime via window.startTour(). CSP-safe: no
 * inline handlers, no third-party tour library — the spotlight is a box-shadow scrim. */
(function () {
  const KEY = 'jsi-tour-v1';
  let spot = null, tip = null, welcome = null, releaseTrap = null, idx = 0, active = false, stepped = false, lastFocus = null, rafPending = false;

  const reduced = () => window.prefersReduced && window.prefersReduced();
  const onHome = () => !!document.body.dataset.intro;
  const flagged = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };
  const setFlag = (v) => { try { localStorage.setItem(KEY, v); } catch {} };
  const anyModalOpen = () => {
    for (const id of ['auth-modal', 'compose-modal']) {
      const m = document.getElementById(id);
      if (m && !m.hasAttribute('hidden')) return true;
    }
    return false;
  };

  const STEPS = [
    { sel: '.mcap-panel', title: 'This number is alive 📈', body: "$SEND's market cap, live from the charts. Memecoins fly up AND crater down, fast — fun to watch, never a promise." },
    { sel: '.contract-box', title: 'Copy the REAL address 🪙', body: '$SEND and $GWC live here. Tap Copy to grab the exact contract — scammers clone tokens, so only ever trust the address on this page. Heads-up: $GWC charges a 5% buy / 5% sell tax.' },
    { sel: '.security-step', title: 'Your seed phrase = your money 🔐', body: 'The one rule that matters: write your seed phrase on paper, NEVER type it into any website, and no one legit will ever ask for it.' },
    { sel: '#guide h2', title: 'Set up in order 🧭', body: 'Wallet → seed phrase → add Robinhood Chain → get a little ETH here (bridge it over, or card → ETH through a third-party on-ramp) → swap. The guide walks every step with the real links, and you can stop at any point — reading is free.' },
    { sel: '#swap', title: 'Swap in one move 💱', body: 'Turn ETH into $SEND or $GWC in a single transaction YOU sign in your own wallet. We never hold your funds. Start tiny while you learn.' },
    { sel: '.do-card[href="wall.html"]', title: 'Meet the Send Wall 🧱', body: 'Post wins, memes and cope; react 🔥, reply, claim your @handle, and build your own public wall.' },
    { sel: '#nav-auth', title: 'Level up to Biggest Sender 🏆', body: 'Almost everything you do here earns Send Power that levels you up on an exponential curve — there is no top level. Holding $SEND/$GWC multiplies every point (bigger bags, held longer = bigger boost), and joining a live community adds a flat 10×. Your level & points live right here, and the leaderboard crowns the Biggest Sender 👑. (Full rules are on your profile.)' },
    { sel: '#compose-fab', title: 'Post from anywhere ✏️', body: 'This button follows you across the whole site — tap it to send to the Wall in seconds. (P.S. tap the player bottom-left for the theme 🔊.)' },
  ];

  /* ---------- welcome popup ---------- */
  function showWelcome() {
    active = true;
    lastFocus = document.activeElement;
    welcome = document.createElement('div');
    welcome.className = 'tour-welcome-wrap';
    welcome.innerHTML =
      '<div class="tour-welcome-backdrop"></div>' +
      '<div class="tour-welcome" role="dialog" aria-modal="true" aria-labelledby="tw-title" aria-describedby="tw-body">' +
        '<div style="font-size:2.6rem;" aria-hidden="true">🚀</div>' +
        '<h2 id="tw-title" class="display" style="color:var(--green-bright); font-size:1.7rem;">Welcome to $Send</h2>' +
        '<p id="tw-body" class="modal-note" style="font-size:0.95rem;">New to crypto? You\'re exactly where you should be. Take a 60-second tour — where to buy safely, how to track your bags, where the memes live, and how you <b>earn points &amp; level up to Biggest Sender</b> 🏆. No pressure.<br><span style="opacity:0.8;">Entertainment only, not financial advice, not affiliated with Robinhood.</span></p>' +
        '<div style="display:flex; gap:0.6rem; justify-content:center; flex-wrap:wrap; margin-top:1rem;">' +
          '<button class="btn btn-primary" id="tw-start" type="button">Show me around 👀</button>' +
          '<button class="btn btn-ghost btn-sm" id="tw-skip" type="button">I\'ll explore myself</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(welcome);
    document.body.style.overflow = 'hidden';
    const card = welcome.querySelector('.tour-welcome');
    releaseTrap = window.trapFocus ? window.trapFocus(card) : null;
    const startBtn = welcome.querySelector('#tw-start');
    startBtn.focus();
    startBtn.addEventListener('click', () => { closeWelcome(); startSteps(); });
    welcome.querySelector('#tw-skip').addEventListener('click', () => { setFlag('skipped'); closeWelcome(); finish(false); });
    welcome.addEventListener('keydown', e => { if (e.key === 'Escape') { setFlag('skipped'); closeWelcome(); finish(false); } });
  }
  function closeWelcome() {
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    if (welcome) { welcome.remove(); welcome = null; }
    document.body.style.overflow = '';
  }

  /* ---------- spotlight steps ---------- */
  function buildSpotEls() {
    spot = document.createElement('div');
    spot.className = 'tour-spot';
    spot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(spot);

    tip = document.createElement('div');
    tip.className = 'tour-tip';
    tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-modal', 'true');
    tip.setAttribute('aria-labelledby', 'tt-title');
    tip.setAttribute('aria-describedby', 'tt-body');
    document.body.appendChild(tip);
  }

  function positionAll(target) {
    if (!target) return;
    const r = target.getBoundingClientRect();
    const pad = 8;
    spot.style.left = (r.left - pad) + 'px';
    spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';
    const tr = tip.getBoundingClientRect();
    let top = r.bottom + 14;
    if (top + tr.height > innerHeight - 12) top = Math.max(12, r.top - tr.height - 14);
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(12, Math.min(left, innerWidth - tr.width - 12));
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
  }

  function renderStep() {
    const step = STEPS[idx];
    const target = document.querySelector(step.sel);
    if (!target) { // element missing on this layout — skip ahead/finish gracefully
      if (idx < STEPS.length - 1) { idx++; return renderStep(); }
      return finish(true);
    }
    const isLast = idx === STEPS.length - 1;
    tip.innerHTML =
      '<p id="tt-count" class="tour-count">Step ' + (idx + 1) + ' of ' + STEPS.length + '</p>' +
      '<h3 id="tt-title" class="tour-title">' + step.title + '</h3>' +
      '<p id="tt-body" class="tour-body">' + step.body + '</p>' +
      '<div class="tour-controls">' +
        '<button class="linklike" id="tt-skip" type="button">Skip tour</button>' +
        '<span style="flex:1"></span>' +
        (idx > 0 ? '<button class="btn btn-ghost btn-sm" id="tt-back" type="button">Back</button>' : '') +
        '<button class="btn btn-primary btn-sm" id="tt-next" type="button">' + (isLast ? 'Finish 🚀' : 'Next') + '</button>' +
      '</div>';

    target.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    positionAll(target);
    // re-measure after smooth scroll settles + after layout of the new tip
    setTimeout(() => positionAll(target), 60);
    setTimeout(() => positionAll(target), 420);

    const next = tip.querySelector('#tt-next');
    next.focus();
    if (releaseTrap) releaseTrap();
    releaseTrap = window.trapFocus ? window.trapFocus(tip) : null;

    tip.querySelector('#tt-skip').addEventListener('click', () => { setFlag('skipped'); finish(false); });
    next.addEventListener('click', () => { if (isLast) { setFlag('done'); finish(true); } else { idx++; renderStep(); } });
    const back = tip.querySelector('#tt-back');
    if (back) back.addEventListener('click', () => { idx--; renderStep(); });
  }

  function onKey(e) {
    if (!active || welcome || anyModalOpen()) return; // don't react while a sign-in/compose modal is on top
    if (e.key === 'Escape') { setFlag('skipped'); finish(false); }
    else if (e.key === 'ArrowRight') { const n = tip && tip.querySelector('#tt-next'); if (n) n.click(); }
    else if (e.key === 'ArrowLeft') { const b = tip && tip.querySelector('#tt-back'); if (b) b.click(); }
  }
  function onReflow() {
    if (rafPending || !active || welcome) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; const t = document.querySelector(STEPS[idx] && STEPS[idx].sel); if (t) positionAll(t); });
  }

  function startSteps() {
    idx = 0;
    stepped = true;
    buildSpotEls();
    document.addEventListener('keydown', onKey);
    addEventListener('scroll', onReflow, { passive: true });
    addEventListener('resize', onReflow);
    renderStep();
  }

  function finish(completed) {
    active = false;
    document.removeEventListener('keydown', onKey);
    removeEventListener('scroll', onReflow);
    removeEventListener('resize', onReflow);
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    // only "land on what you just learned" if steps actually ran; a pure welcome dismissal restores the opener
    const lastTarget = stepped ? (STEPS[idx] && document.querySelector(STEPS[idx].sel)) : null;
    stepped = false;
    if (spot) { spot.remove(); spot = null; }
    if (tip) { tip.remove(); tip = null; }
    closeWelcome();
    document.body.style.overflow = '';
    if (completed) {
      if (window.sendToast) sendToast("You're all set — Just $Send It! 🚀");
      if (window.sendConfetti) sendConfetti(innerWidth / 2, innerHeight / 2.4, { count: 70, emojiRatio: 0.5 });
    }
    // land the user on what they just learned (or restore prior focus)
    const dest = lastTarget || lastFocus;
    if (dest && dest.focus) {
      try {
        if ((dest.tabIndex == null || dest.tabIndex < 0) && !/^(A|BUTTON|INPUT|TEXTAREA|SELECT)$/.test(dest.tagName)) dest.tabIndex = -1;
        dest.focus({ preventScroll: true });
      } catch { try { dest.focus(); } catch {} }
    }
  }

  /* ---------- lifecycle ---------- */
  let armed = false;
  function maybeStart() {
    if (armed || active || welcome || !onHome() || flagged()) return;
    if (anyModalOpen()) { // defer until the sign-in/compose modal closes
      document.addEventListener('jsi:modalclose', maybeStart, { once: true });
      return;
    }
    armed = true;
    // small head start so the music-unmute hint and the tour don't pop simultaneously
    setTimeout(() => {
      armed = false;
      if (active || welcome || flagged()) return;
      if (anyModalOpen()) { document.addEventListener('jsi:modalclose', maybeStart, { once: true }); return; } // re-defer, don't drop
      showWelcome();
    }, 650);
  }

  // relaunchable from a "Take the tour again" control anywhere — ignores the saved flag
  window.startTour = function () {
    if (active || armed || welcome) return;
    if (!anyModalOpen()) showWelcome();
  };

  document.addEventListener('jsi:entered', maybeStart);
  if (onHome()) setTimeout(maybeStart, 3500); // fallback if jsi:entered never arrives

  // "Take the tour again" relaunch control (footer / help)
  function wireRetake() {
    document.querySelectorAll('[data-retake-tour], #retake-tour').forEach(el => el.addEventListener('click', () => window.startTour()));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireRetake); else wireRetake();
})();
