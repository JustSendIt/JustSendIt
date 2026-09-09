/* ===== JustSendIt auth client: session state, sign-in modal, nav ===== */
(function () {
  const AUTH = { user: null, config: { auth: { wallet: true, email: true } }, ready: null };
  window.AUTH = AUTH;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      credentials: 'same-origin',
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || ('request failed (' + res.status + ')'));
    return j;
  }
  window.api = api;

  /* ---------- modal markup ---------- */
  const modal = document.createElement('div');
  modal.id = 'auth-modal';
  modal.setAttribute('hidden', '');
  modal.innerHTML = `
  <div class="modal-backdrop" data-close></div>
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
    <button class="modal-x" data-close aria-label="Close sign-in dialog">✕</button>
    <h2 id="auth-title" class="display" style="color:var(--green-bright); text-align:center; font-size:1.6rem;">Welcome to The Send 🚀</h2>
    <p class="modal-sub">One account. Your wall, your reactions, your private wallet tracker.</p>

    <div class="auth-tabs" role="tablist" aria-label="Sign-in method">
      <button class="auth-tab active" id="tab-wallet" role="tab" aria-selected="true" aria-controls="pane-wallet">🦊 Wallet</button>
      <button class="auth-tab" id="tab-email" role="tab" aria-selected="false" aria-controls="pane-email">✉️ Email</button>
    </div>

    <div id="pane-wallet" role="tabpanel" aria-labelledby="tab-wallet">
      <p class="modal-note">Sign a free message to prove you own your wallet — no transaction, no gas, and it never lets this site move funds.</p>
      <button class="btn btn-primary" id="btn-wallet-signin" style="width:100%;">Continue with Wallet 🦊</button>
      <p class="modal-note" id="wallet-status" aria-live="polite"></p>
    </div>

    <div id="pane-email" role="tabpanel" aria-labelledby="tab-email" hidden>
      <div class="auth-segment" role="group" aria-label="Log in or sign up">
        <button type="button" class="auth-seg active" id="seg-login" aria-pressed="true">Log in</button>
        <button type="button" class="auth-seg" id="seg-signup" aria-pressed="false">Sign up</button>
      </div>
      <form id="email-form" novalidate>
        <div id="reg-fields" hidden>
          <label class="f-label" for="f-username">Pick a unique username</label>
          <input class="addr-input" id="f-username" autocomplete="username" maxlength="24" placeholder="moon_goblin" spellcheck="false">
          <p class="modal-note" id="uname-status" aria-live="polite"></p>
        </div>
        <label class="f-label" for="f-email" id="f-email-label">Email or username</label>
        <input class="addr-input" id="f-email" type="text" autocomplete="username" placeholder="you@example.com or your @handle">
        <label class="f-label" for="f-password">Password</label>
        <input class="addr-input" id="f-password" type="password" autocomplete="current-password" placeholder="••••••••">
        <button class="btn btn-primary" type="submit" style="width:100%;" id="email-submit">Sign In 🚪</button>
      </form>
      <p class="modal-note" id="email-status" aria-live="polite"></p>
    </div>

    <div id="pane-2fa" hidden>
      <div id="twofa-totp" hidden>
        <p class="modal-note">🔐 Two-factor is on for this account. Enter the 6-digit code from your authenticator app.</p>
        <label class="f-label" for="f-totp">Authentication code</label>
        <input class="addr-input" id="f-totp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" style="text-align:center; font-size:1.3rem; letter-spacing:0.3em;">
        <button class="btn btn-primary" id="totp-submit" style="width:100%;">Verify ✅</button>
      </div>
      <div id="twofa-wallet" hidden>
        <p class="modal-note">🔐 Two-factor is on for this account. Sign a free message with your linked wallet to finish signing in.</p>
        <button class="btn btn-primary" id="wallet2fa-submit" style="width:100%;">Sign With Wallet 🦊</button>
      </div>
      <div id="twofa-password" hidden>
        <p class="modal-note">🔐 Two-factor is on for this account. Enter your account password to finish signing in with your wallet.</p>
        <label class="f-label" for="f-2fa-pw">Account password</label>
        <input class="addr-input" id="f-2fa-pw" type="password" autocomplete="current-password" placeholder="••••••••">
        <button class="btn btn-primary" id="pw2fa-submit" style="width:100%;">Verify ✅</button>
      </div>
      <p class="modal-note" id="twofa-status" aria-live="polite"></p>
    </div>

    <div id="oauth-row" class="oauth-row" hidden>
      <div class="or-line"><span>or continue with</span></div>
      <div class="oauth-grid">
        <a class="oauth-btn" id="oauth-google" href="/api/auth/google" hidden aria-label="Continue with Google">
          <span class="oauth-ico"><svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg></span><span class="oauth-name">Google</span></a>
        <a class="oauth-btn" id="oauth-facebook" href="/api/auth/facebook" hidden aria-label="Continue with Facebook">
          <span class="oauth-ico"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.25h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z"/></svg></span><span class="oauth-name">Facebook</span></a>
        <a class="oauth-btn oauth-x" id="oauth-x" href="/api/auth/x" hidden aria-label="Continue with X (Twitter)">
          <span class="oauth-ico"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93zm-1.29 19.5h2.04L6.48 3.24H4.29L17.61 20.65z"/></svg></span><span class="oauth-name">X</span></a>
        <a class="oauth-btn" id="oauth-instagram" href="/api/auth/instagram" hidden aria-label="Continue with Instagram">
          <span class="oauth-ico"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><defs><linearGradient id="ig-g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".25" stop-color="#FA7E1E"/><stop offset=".5" stop-color="#D62976"/><stop offset=".75" stop-color="#962FBF"/><stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs><path fill="url(#ig-g)" d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 01-1.38-.9 3.7 3.7 0 01-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07zm0 1.62c-3.15 0-3.52.01-4.76.07-1.15.05-1.77.24-2.19.4-.55.22-.94.47-1.35.88-.41.41-.66.8-.88 1.35-.16.42-.35 1.04-.4 2.19-.06 1.24-.07 1.61-.07 4.76s.01 3.52.07 4.76c.05 1.15.24 1.77.4 2.19.22.55.47.94.88 1.35.41.41.8.66 1.35.88.42.16 1.04.35 2.19.4 1.24.06 1.61.07 4.76.07s3.52-.01 4.76-.07c1.15-.05 1.77-.24 2.19-.4.55-.22.94-.47 1.35-.88.41-.41.66-.8.88-1.35.16-.42.35-1.04.4-2.19.06-1.24.07-1.61.07-4.76s-.01-3.52-.07-4.76c-.05-1.15-.24-1.77-.4-2.19a3.6 3.6 0 00-.88-1.35 3.6 3.6 0 00-1.35-.88c-.42-.16-1.04-.35-2.19-.4-1.24-.06-1.61-.07-4.76-.07zm0 2.76a5.46 5.46 0 110 10.92 5.46 5.46 0 010-10.92zm0 9a3.54 3.54 0 100-7.08 3.54 3.54 0 000 7.08zm6.95-9.22a1.28 1.28 0 11-2.55 0 1.28 1.28 0 012.55 0z"/></svg></span><span class="oauth-name">Instagram</span></a>
      </div>
    </div>
  </div>`;

  let lastFocus = null, releaseTrap = null;
  function openModal() {
    lastFocus = document.activeElement;
    modal.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    if (AUTH._reset2fa) AUTH._reset2fa();
    modal.querySelector('.auth-tab.active').focus();
    releaseTrap = window.trapFocus ? window.trapFocus(modal.querySelector('.modal-card')) : null;
    document.dispatchEvent(new CustomEvent('jsi:modalopen'));
  }
  function closeModal() {
    modal.setAttribute('hidden', '');
    document.body.style.overflow = '';
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    if (lastFocus) lastFocus.focus();
    document.dispatchEvent(new CustomEvent('jsi:modalclose'));
  }
  AUTH.open = openModal;

  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hasAttribute('hidden')) closeModal(); });

    // tabs
    const tabs = { wallet: modal.querySelector('#tab-wallet'), email: modal.querySelector('#tab-email') };
    const panes = { wallet: modal.querySelector('#pane-wallet'), email: modal.querySelector('#pane-email') };
    for (const key of Object.keys(tabs)) {
      tabs[key].addEventListener('click', () => {
        for (const k of Object.keys(tabs)) {
          tabs[k].classList.toggle('active', k === key);
          tabs[k].setAttribute('aria-selected', String(k === key));
          panes[k].hidden = k !== key;
        }
      });
    }

    // email log-in / sign-up: an explicit segmented choice, DEFAULTING TO LOG IN (never sign-up-first)
    let regMode = false;
    const segLogin = modal.querySelector('#seg-login'), segSignup = modal.querySelector('#seg-signup');
    function setRegMode(v) {
      regMode = v;
      modal.querySelector('#reg-fields').hidden = !regMode;
      modal.querySelector('#email-submit').textContent = regMode ? 'Create Account ✨' : 'Sign In 🚪';
      modal.querySelector('#f-password').autocomplete = regMode ? 'new-password' : 'current-password';
      modal.querySelector('#f-email-label').textContent = regMode ? 'Email' : 'Email or username';
      modal.querySelector('#f-email').type = regMode ? 'email' : 'text';
      modal.querySelector('#f-email').autocomplete = regMode ? 'email' : 'username';
      modal.querySelector('#f-email').placeholder = regMode ? 'you@example.com' : 'you@example.com or your @handle';
      segLogin.classList.toggle('active', !regMode); segLogin.setAttribute('aria-pressed', String(!regMode));
      segSignup.classList.toggle('active', regMode); segSignup.setAttribute('aria-pressed', String(regMode));
      modal.querySelector('#email-status').textContent = '';
    }
    segLogin.addEventListener('click', () => setRegMode(false));
    segSignup.addEventListener('click', () => setRegMode(true));
    setRegMode(false); // login-first

    // live username availability
    let unameTimer;
    modal.querySelector('#f-username').addEventListener('input', e => {
      clearTimeout(unameTimer);
      const v = e.target.value.trim();
      const el = modal.querySelector('#uname-status');
      if (!v) { el.textContent = ''; return; }
      unameTimer = setTimeout(async () => {
        try {
          const j = await api('/api/username-check?u=' + encodeURIComponent(v));
          el.textContent = j.available ? '✅ available' : ('❌ ' + (j.reason || 'taken — try another'));
          el.style.color = j.available ? 'var(--green-bright)' : 'var(--red)';
        } catch {}
      }, 300);
    });

    function loginSuccess(j) {
      sendToast('Welcome, @' + j.username + '! 🚀');
      if (window.sendConfetti) sendConfetti(innerWidth / 2, innerHeight / 3, { count: 50, emojiRatio: 0.4 });
      closeModal();
      refresh().then(onAuthChange);
    }

    function show2fa(j) {
      // hide tabs + panes, show the challenge
      modal.querySelector('.auth-tabs').hidden = true;
      panes.wallet.hidden = true;
      panes.email.hidden = true;
      const pane = modal.querySelector('#pane-2fa');
      pane.hidden = false;
      modal.querySelector('#twofa-totp').hidden = j.twofa !== 'totp';
      modal.querySelector('#twofa-wallet').hidden = j.twofa !== 'wallet';
      modal.querySelector('#twofa-password').hidden = j.twofa !== 'password';
      const status = modal.querySelector('#twofa-status');
      status.textContent = '';
      if (j.twofa === 'password') {
        const input = modal.querySelector('#f-2fa-pw');
        input.value = ''; input.focus();
        modal.querySelector('#pw2fa-submit').onclick = async () => {
          status.textContent = '…';
          try {
            const r = await api('/api/auth/login/password2fa', { method: 'POST', body: { pending: j.pending, password: input.value } });
            loginSuccess(r);
          } catch (err) { status.textContent = '⚠️ ' + err.message; status.style.color = 'var(--red)'; }
        };
        input.onkeydown = ev => { if (ev.key === 'Enter') modal.querySelector('#pw2fa-submit').click(); };
      } else if (j.twofa === 'totp') {
        const input = modal.querySelector('#f-totp');
        input.value = '';
        input.focus();
        modal.querySelector('#totp-submit').onclick = async () => {
          status.textContent = '…';
          try {
            const r = await api('/api/auth/login/totp', { method: 'POST', body: { pending: j.pending, code: input.value.trim() } });
            loginSuccess(r);
          } catch (err) { status.textContent = '⚠️ ' + err.message; status.style.color = 'var(--red)'; }
        };
        input.onkeydown = ev => { if (ev.key === 'Enter') modal.querySelector('#totp-submit').click(); };
      } else {
        modal.querySelector('#wallet2fa-submit').onclick = async () => {
          try {
            status.textContent = 'Choose your wallet… 👛';
            const { provider, address } = await WALLET.connect();
            // one challenge per linked wallet (each names its own address, as EIP-4361 requires) — pick the
            // one for the wallet they actually connected, and say so plainly if it isn't on the account
            const msg = j.messages && j.messages[String(address).toLowerCase()];
            if (!msg) throw new Error('that wallet isn’t linked to this account — connect the one you turned two-factor on with');
            status.textContent = 'Approve the signature… ✍️';
            const signature = await provider.request({ method: 'personal_sign', params: [msg, address] });
            const r = await api('/api/auth/login/wallet2fa', { method: 'POST', body: { pending: j.pending, address, signature } });
            loginSuccess(r);
          } catch (err) { status.textContent = (err.message === 'cancelled') ? '' : '⚠️ ' + (err.message || 'cancelled'); }
        };
      }
    }
    // show2fa lives in this DOMContentLoaded closure; the OAuth pickup at the bottom of the file runs
    // outside it, so expose it the same way _reset2fa is exposed
    AUTH._show2fa = show2fa;
    AUTH._reset2fa = function () {
      modal.querySelector('.auth-tabs').hidden = false;
      modal.querySelector('#pane-2fa').hidden = true;
      panes.wallet.hidden = !tabs.wallet.classList.contains('active');
      panes.email.hidden = !tabs.email.classList.contains('active');
    };

    modal.querySelector('#email-form').addEventListener('submit', async e => {
      e.preventDefault();
      const status = modal.querySelector('#email-status');
      status.textContent = '…';
      try {
        const body = { password: modal.querySelector('#f-password').value };
        if (regMode) {
          body.username = modal.querySelector('#f-username').value.trim();
          body.email = modal.querySelector('#f-email').value;
        } else {
          body.identifier = modal.querySelector('#f-email').value;
        }
        const j = await api(regMode ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body });
        status.textContent = '';
        if (j.twofa) { show2fa(j); return; }
        loginSuccess(j);
      } catch (err) { status.textContent = '⚠️ ' + err.message; status.style.color = 'var(--red)'; }
    });

    // wallet sign-in
    modal.querySelector('#btn-wallet-signin').addEventListener('click', async () => {
      const status = modal.querySelector('#wallet-status');
      try {
        status.textContent = 'Choose your wallet… 👛';
        const { provider, address } = await WALLET.connect();
        status.textContent = 'Approve the signature in your wallet… ✍️';
        const { message } = await api('/api/auth/wallet/nonce?address=' + address);
        const signature = await provider.request({ method: 'personal_sign', params: [message, address] });
        const j = await api('/api/auth/wallet/verify', { method: 'POST', body: { address, signature } });
        status.textContent = '';
        if (j.twofa) { show2fa(j); return; } // account has an authenticator / password second factor — the wallet was only the first
        closeModal();
        await refresh();
        if (j.alreadyLinked) sendToast('That wallet is already linked to @' + j.username + ' ✅');
        else if (j.linked) sendToast('Wallet linked to @' + j.username + ' 🔗');
        else if (j.newAccount) {
          // remember where they were so the profile page can bring them straight back after the handle claim
          // (same-origin, single-leading-slash paths only — never a protocol-relative '//host' pathname)
          try { if (/^\/(?![\/\\])/.test(location.pathname) && !/\/profile\.html/.test(location.pathname)) sessionStorage.setItem('jsi:after-claim', location.pathname + location.search + location.hash); } catch {}
          sendToast('Welcome! Pick your unique handle 👇'); location.href = '/profile.html#claim'; return;
        }
        else sendToast('Welcome back, @' + j.username + '! 🚀');
        if (window.sendConfetti) sendConfetti(innerWidth / 2, innerHeight / 3, { count: 50, emojiRatio: 0.4 });
        onAuthChange();
      } catch (err) { status.textContent = (err.message === 'cancelled') ? '' : '⚠️ ' + (err.message || 'cancelled'); }
    });
  });

  AUTH.logout = async function () {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    AUTH.user = null;
    try { localStorage.removeItem('site-prefs'); } catch {}
    try { sessionStorage.removeItem('jsi:after-claim'); } catch {} // a claim stash must not survive into someone else's session
    try { if (window.WALLET) WALLET.forget(); } catch {} // also drop the client's remembered wallet connection on sign-out
    if (window.applySitePrefs) applySitePrefs({ siteAccent: '', confetti: true, ticker: true, musicResume: true }, false);
    sendToast('Signed out 👋');
    onAuthChange();
    const t = document.querySelector('#nav-auth .profile-link'); if (t && document.activeElement === document.body) t.focus(); // move focus to the rebuilt "Sign In" (the hidden Sign-out button dropped it to <body>)
  };
  // Disconnect (unlink) the account's wallet(s). Server guards against lockout / stranded wallet-2FA.
  AUTH.disconnectWallet = async function () {
    const j = await api('/api/wallet/disconnect', { method: 'POST' }); // throws with a clear message on a guarded refusal
    try { if (window.WALLET) WALLET.forget(); } catch {}               // also forget the client-side connection
    await refresh(); onAuthChange();                                    // nav re-renders: balances pill + Disconnect item drop
    const t = document.getElementById('nav-profile-caret'); if (t && document.activeElement === document.body) t.focus(); // keep keyboard focus on the rebuilt trigger (the disabled button dropped it to <body>)
    return j;
  };

  /* ---------- nav account menu (hover on desktop, click/keyboard everywhere) ---------- */
  function setProfileOpen(wrap, open) {
    if (!wrap) return;
    if (!open) { const d = wrap.querySelector('#npm-disconnect'); if (d && d._resetArm) d._resetArm(); } // disarm the two-tap disconnect on ANY close (outside-click, Esc, focusout, hover-out)
    wrap.classList.toggle('open', open);
    const trg = wrap.querySelector('.np-caret-btn'), menu = wrap.querySelector('.nav-profile-menu');
    if (trg) trg.setAttribute('aria-expanded', String(open));
    if (menu) menu.hidden = !open;
  }
  function profileMenuItems(wrap) { return Array.from(wrap.querySelectorAll('.nav-profile-menu .npm-item:not([disabled])')); }
  // once-only: outside-click and Escape close whichever account menu is open (menu is rebuilt on every renderNav)
  document.addEventListener('click', (e) => { const w = document.querySelector('.nav-profile.open'); if (w && !w.contains(e.target)) setProfileOpen(w, false); });
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape' && e.key !== 'Esc') return; const w = document.querySelector('.nav-profile.open'); if (w) { setProfileOpen(w, false); const t = w.querySelector('.np-caret-btn'); if (t) t.focus(); } });
  // Build the logged-in account control: the @name is a menu trigger (hover on desktop, click/keyboard anywhere) exposing
  // My Wall · Dashboard · Disconnect wallet (if linked) · Sign out. Fully keyboard-navigable + ARIA-menu semantics.
  function mountProfileMenu(slot, user) {
    const wrap = document.createElement('div');
    wrap.className = 'nav-profile';
    // The name is a plain link to your public Send Wall; the caret beside it is the menu button. Hovering
    // anywhere on the control (desktop mouse) still reveals the menu, so the tabs are visible on hover.
    const trg = document.createElement('a');
    trg.className = 'profile-link'; trg.id = 'nav-profile-trigger'; trg.href = '/u/' + encodeURIComponent(user.username);
    trg.setAttribute('aria-label', 'Your public Send Wall — @' + user.username);
    trg.innerHTML = '<span class="pl-name">' + roEsc(user.avatar + ' @' + user.username) + '</span>' + ((user.og && window.ogBadge) ? ogBadge(user.og) : '');
    const caret = document.createElement('button');
    caret.type = 'button'; caret.className = 'np-caret-btn'; caret.id = 'nav-profile-caret';
    caret.setAttribute('aria-haspopup', 'true'); caret.setAttribute('aria-expanded', 'false'); caret.setAttribute('aria-controls', 'nav-profile-menu');
    caret.setAttribute('aria-label', 'Account menu for @' + user.username);
    caret.innerHTML = '<span class="np-caret" aria-hidden="true">▾</span>';
    const menu = document.createElement('div');
    menu.className = 'nav-profile-menu'; menu.id = 'nav-profile-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
    menu.setAttribute('aria-label', 'Account menu');
    const wall = document.createElement('a');
    wall.className = 'npm-item'; wall.setAttribute('role', 'menuitem'); wall.tabIndex = -1; wall.href = '/u/' + encodeURIComponent(user.username);
    wall.innerHTML = '<span class="npm-ico" aria-hidden="true">🏠</span> My Send Wall';
    const dash = document.createElement('a');
    dash.className = 'npm-item'; dash.setAttribute('role', 'menuitem'); dash.tabIndex = -1; dash.href = '/profile.html';
    dash.innerHTML = '<span class="npm-ico" aria-hidden="true">📊</span> Dashboard &amp; settings';
    const trk = document.createElement('a');
    trk.className = 'npm-item'; trk.setAttribute('role', 'menuitem'); trk.tabIndex = -1; trk.href = '/tracker.html';
    trk.innerHTML = '<span class="npm-ico" aria-hidden="true">💼</span> Wallet Tracker';
    const dat = document.createElement('a');
    dat.className = 'npm-item'; dat.setAttribute('role', 'menuitem'); dat.tabIndex = -1; dat.href = '/data.html';
    dat.innerHTML = '<span class="npm-ico" aria-hidden="true">🔑</span> Data API';
    menu.appendChild(wall); menu.appendChild(dash); menu.appendChild(trk); menu.appendChild(dat);
    if (user.wallets && user.wallets.length) {
      const sep = document.createElement('div'); sep.className = 'npm-sep'; sep.setAttribute('role', 'separator'); menu.appendChild(sep);
      const disc = document.createElement('button');
      disc.type = 'button'; disc.className = 'npm-item npm-danger'; disc.id = 'npm-disconnect'; disc.setAttribute('role', 'menuitem'); disc.tabIndex = -1;
      disc.innerHTML = '<span class="npm-ico" aria-hidden="true">🔌</span> Disconnect wallet';
      let armed = false, armT = null;
      const resetArm = () => { armed = false; if (armT) { clearTimeout(armT); armT = null; } disc.classList.remove('armed'); disc.innerHTML = '<span class="npm-ico" aria-hidden="true">🔌</span> Disconnect wallet'; };
      disc._resetArm = resetArm; // let any menu-close path disarm the two-tap confirm (see setProfileOpen)
      disc.addEventListener('click', async () => {
        if (!armed) { armed = true; disc.classList.add('armed'); disc.innerHTML = '<span class="npm-ico" aria-hidden="true">⚠️</span> ' + (AUTH.user && AUTH.user.og ? 'Tap again — OG badge comes off until you relink' : 'Tap again to confirm'); armT = setTimeout(resetArm, 4000); return; }
        clearTimeout(armT); armed = false; disc.disabled = true; disc.innerHTML = 'Disconnecting…';
        try { await AUTH.disconnectWallet(); sendToast('Wallet disconnected 🔌'); } // onAuthChange (inside) rebuilds this nav
        catch (err) { sendToast('⚠️ ' + ((err && err.message) || 'could not disconnect')); disc.disabled = false; resetArm(); setProfileOpen(wrap, false); }
      });
      menu.appendChild(disc);
    } else {
      const sep = document.createElement('div'); sep.className = 'npm-sep'; sep.setAttribute('role', 'separator'); menu.appendChild(sep);
    }
    const out = document.createElement('button');
    out.type = 'button'; out.className = 'npm-item npm-danger'; out.id = 'npm-signout'; out.setAttribute('role', 'menuitem'); out.tabIndex = -1;
    out.innerHTML = '<span class="npm-ico" aria-hidden="true">🚪</span> Sign out';
    out.addEventListener('click', () => { setProfileOpen(wrap, false); AUTH.logout(); });
    menu.appendChild(out);
    wrap.appendChild(trg); wrap.appendChild(caret); wrap.appendChild(menu);

    // ----- interaction wiring -----
    let hoverT = null;
    const open = (focusFirst) => { setProfileOpen(wrap, true); if (focusFirst) { const it = profileMenuItems(wrap)[0]; if (it) it.focus(); } };
    const close = () => setProfileOpen(wrap, false);
    caret.addEventListener('click', () => { wrap.classList.contains('open') ? close() : open(false); });
    caret.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); open(true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); open(true); const items = profileMenuItems(wrap); if (items.length) items[items.length - 1].focus(); }
    });
    // hover-open for a REAL MOUSE only (pointerType), so a finger tap on a hybrid touch+hover device doesn't fire
    // mouseenter→open before the click→toggle (which would look like the first tap does nothing); touch/keyboard use click.
    wrap.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { clearTimeout(hoverT); open(false); } });
    wrap.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { clearTimeout(hoverT); hoverT = setTimeout(() => { if (!wrap.contains(document.activeElement)) close(); }, 180); } }); // never yank the menu shut while a keyboard user is inside it
    // roving focus + close within the menu
    menu.addEventListener('keydown', (e) => {
      const items = profileMenuItems(wrap); if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
      else if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(); caret.focus(); }
    });
    // keyboard tab-out closes (focus left the whole control)
    wrap.addEventListener('focusout', () => { setTimeout(() => { if (!wrap.contains(document.activeElement)) close(); }, 0); });
    slot.appendChild(wrap);
  }

  // The Send Power multiplier every point is actually paid at (Holder × OG × community × today's Rocket Run), served
  // by /api/me as user.boost.total — it rides in the SAME badge as the level so the two numbers are read together.
  function navBoostMult() {
    const b = AUTH.user && AUTH.user.boost;
    const t = b && Number(b.total);
    return (t && isFinite(t) && t > 1) ? t : 1;
  }
  function navBoostText(m) { return '⚡' + (m >= 100 ? Math.round(m) : m.toFixed(m >= 10 ? 1 : 2)) + '×'; }
  function navBoostHTML() {
    const m = navBoostMult();
    if (m <= 1) return '';
    return '<span class="nav-xp-sep" aria-hidden="true">·</span><span class="nav-xp-boost">' + navBoostText(m) + '</span>';
  }
  function navBadgeLabel(lvl, pts) {
    const m = navBoostMult();
    return 'Level ' + lvl + ', ' + pts.toLocaleString('en-US') + ' Send Power'
      + (m > 1 ? ', earning at ' + navBoostText(m).replace('⚡', '') + ' boost' : '')
      + ' — open your dashboard';
  }
  // live-update the nav badge when points (or the boost) change, without a full nav re-render
  document.addEventListener('points:changed', function () {
    const badge = document.getElementById('nav-xp-badge');
    if (!badge || !AUTH.user) return;
    const lvl = AUTH.user.level != null ? AUTH.user.level : (window.levelForXp ? window.levelForXp(AUTH.user.points || 0) : 1);
    const pts = AUTH.user.points || 0;
    badge.querySelector('.nav-xp-lv').textContent = 'Lv ' + lvl;
    badge.querySelector('.nav-xp-pts').textContent = pts.toLocaleString('en-US');
    const m = navBoostMult(), existing = badge.querySelector('.nav-xp-boost');
    if (m > 1 && existing) existing.textContent = navBoostText(m);
    else if (m > 1) badge.insertAdjacentHTML('beforeend', navBoostHTML());   // boost just started (e.g. a Rocket Run cash-out)
    else if (existing) { const s = existing.previousElementSibling; if (s && s.classList.contains('nav-xp-sep')) s.remove(); existing.remove(); }
    badge.setAttribute('aria-label', navBadgeLabel(lvl, pts));
    badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
  });
  // an arcade cash-out (or any boost change) fires this — same repaint path as a points change
  document.addEventListener('boost:changed', function () { document.dispatchEvent(new CustomEvent('points:changed')); });

  /* ---------- read-only restriction banner (anti-gaming) ---------- */
  let roTimer = null;
  function roEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function roFmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
    if (h > 0) return h + 'h ' + m + 'm ' + ss + 's';
    return m + 'm ' + ss + 's';
  }
  function roDur(ms) { const h = Math.round(ms / 3600000); if (h < 48) return h + ' hours'; const d = Math.round(ms / 86400000); if (d < 14) return d + ' days'; return Math.round(d / 7) + ' weeks'; }
  async function doRedeem(btn) {
    btn.disabled = true; const old = btn.textContent; btn.textContent = '⛓️ Reading your wallet…';
    try {
      const r = await fetch('/api/restriction/redeem', { method: 'POST', credentials: 'same-origin' });
      const j = await r.json();
      if (r.ok && j.lifted) {
        if (window.sendToast) sendToast('🔓 Read-only lifted — now hold your $SEND to clear it for good!');
        await refresh(); onAuthChange(); // restriction cleared → banner drops, probation banner appears
        return;
      }
      if (window.sendToast) sendToast(j.error || 'Could not verify your $SEND buy — try again.');
      btn.disabled = false; btn.textContent = old;
    } catch { if (window.sendToast) sendToast('Could not reach the chain — try again.'); btn.disabled = false; btn.textContent = old; }
  }
  function renderRestrictBanner() {
    // the SERVER is the sole authority — restrictionOf() returns null once it truly expires, so the banner
    // shows exactly while AUTH.user.restriction is present (never removed early by a fast client clock)
    const r = AUTH.user && AUTH.user.restriction;
    let bar = document.getElementById('readonly-bar');
    if (!r || !r.until) {
      if (bar) bar.remove();
      if (roTimer) { clearInterval(roTimer); roTimer = null; }
      document.body.classList.remove('has-readonly-bar');
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'readonly-bar'; bar.setAttribute('role', 'alert');
      document.body.insertBefore(bar, document.body.firstChild);
      document.body.classList.add('has-readonly-bar');
    }
    const perm = !!r.permanent;
    const tier = perm ? 'until further notice' : r.level >= 2 ? '1 week' : '24 hours';
    const whyPaused = perm
      ? 'Because this kept happening, your account is now <b>permanently in read-only mode</b>.'
      : 'To keep Send Power 100% organic for everyone, your account is paused for <b>' + tier + '</b>.';
    const foot = perm
      ? 'This is a permanent restriction after repeated abuse. If you think it\'s a mistake, reach out on Telegram or X.'
      : 'This lifts automatically when the timer runs out — just keep it organic. If it happens again after you\'re unpaused, the pause gets longer (a week, then permanent).';
    const allowed = (r.allowed || []).map(a => '<li>' + roEsc(a) + '</li>').join('');
    const blocked = (r.blocked || []).map(a => '<li>' + roEsc(a) + '</li>').join('');
    const redeemHtml = r.redeemable
      ? '<div class="ro-redeem">' +
          '<p class="ro-redeem-h">🛒 Want back in now? <b>Buy &amp; hold $SEND.</b></p>' +
          '<p class="ro-redeem-t">Buy at least <b>$' + (r.redeemUsd || 25) + '</b> more $SEND (we read it straight from the chain) to lift ' + (perm ? 'your permanent read-only' : 'this') + ' immediately — then <b>keep your $SEND (don’t sell any) for ' + roDur(r.holdMs || 86400000) + '</b> to clear it for good. Sell before then and ' + (perm ? 'the <b>permanent</b> mute returns' : 'read-only comes back, <b>doubled</b>') + '.</p>' +
          '<button class="btn btn-primary btn-sm" id="ro-redeem-btn" type="button">🛒 I bought $SEND — lift my read-only</button>' +
        '</div>'
      : '';
    bar.innerHTML =
      '<div class="ro-inner">' +
        '<div class="ro-top"><span class="ro-badge">🔒 Read-Only Mode</span>' +
          '<span class="ro-countdown" id="ro-countdown" aria-live="off"></span></div>' + // the per-second tick must not re-announce
        '<p class="ro-why"><b>What happened:</b> ' + roEsc(r.reason) + ' ' + whyPaused + '</p>' +
        '<div class="ro-cols">' +
          '<div class="ro-col ro-ok"><h4>✅ You can still</h4><ul>' + allowed + '</ul></div>' +
          '<div class="ro-col ro-no"><h4>⛔ Paused for now</h4><ul>' + blocked + '</ul></div>' +
        '</div>' +
        redeemHtml +
        '<p class="ro-foot">' + foot + '</p>' +
      '</div>';
    const rbtn = bar.querySelector('#ro-redeem-btn'); if (rbtn) rbtn.addEventListener('click', () => doRedeem(rbtn));
    // announce once as an alert, then demote to a labelled region so re-renders don't re-read the whole banner
    if (bar.getAttribute('role') === 'alert') setTimeout(() => { bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Read-only mode notice'); }, 4000);
    const tick = () => {
      const el = document.getElementById('ro-countdown'); if (!el) return;
      if (perm) { el.textContent = '⛔ Permanent'; if (roTimer) { clearInterval(roTimer); roTimer = null; } return; } // no countdown for a permanent mute
      const ms = r.until - Date.now();
      // when the local countdown reaches 0, don't hide the banner — poll the server until IT lifts the
      // restriction (guards against clock skew: enforcement is server-side, so the banner must be too)
      if (ms <= 0) { el.textContent = '✓ Verifying with the server…'; if (roTimer) { clearInterval(roTimer); roTimer = null; } setTimeout(() => { refresh().then(onAuthChange); }, 4000); return; }
      el.textContent = '⏳ ' + roFmt(ms) + ' until you\'re back';
    };
    tick();
    if (roTimer) clearInterval(roTimer);
    roTimer = setInterval(tick, 1000);
  }
  AUTH.renderRestrictBanner = renderRestrictBanner; // so a fresh restriction (e.g. a call-spam mute) can pop the banner instantly

  let probTimer = null;
  function renderProbationBanner() {
    const pr = AUTH.user && AUTH.user.probation;
    let bar = document.getElementById('probation-bar');
    if (!pr || !pr.until) {
      if (bar) bar.remove();
      if (probTimer) { clearInterval(probTimer); probTimer = null; }
      document.body.classList.remove('has-probation-bar');
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'probation-bar'; bar.setAttribute('role', 'status');
      document.body.insertBefore(bar, document.body.firstChild);
      document.body.classList.add('has-probation-bar');
    }
    bar.innerHTML =
      '<div class="pb-inner">' +
        '<span class="pb-badge">💎 Holding $SEND</span>' +
        '<span class="pb-msg">You lifted your read-only by buying $SEND — now <b>keep your $SEND</b> (don\'t sell any) to clear this for good. Sell before the timer\'s up and read-only returns, <b>doubled</b>.</span>' +
        '<span class="pb-countdown" id="pb-countdown"></span>' +
      '</div>';
    const tick = () => {
      const el = document.getElementById('pb-countdown'); if (!el) return;
      const ms = pr.until - Date.now();
      if (ms <= 0) { el.textContent = '✓ Cleared — verifying…'; if (probTimer) { clearInterval(probTimer); probTimer = null; } setTimeout(() => { refresh().then(onAuthChange); }, 4000); return; }
      el.textContent = '⏳ ' + roFmt(ms) + ' left to hold';
    };
    tick();
    if (probTimer) clearInterval(probTimer);
    probTimer = setInterval(tick, 1000);
  }
  AUTH.renderProbationBanner = renderProbationBanner;

  function onAuthChange() {
    renderNav();
    renderRestrictBanner();
    renderProbationBanner();
    if (window.syncSitePrefs) window.syncSitePrefs(); // apply the user's saved site theme after login without a reload
    // decoupled sign-in signal for compose.js / tour.js (window.onAuthReady is owned by the wall page)
    document.dispatchEvent(new CustomEvent('auth:change', { detail: AUTH.user }));
    if (typeof window.onAuthReady === 'function') window.onAuthReady(AUTH.user);
  }

  /* ---------- connected-wallet balances in the nav (read-only convenience) ---------- */
  function fmtBal(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    if (n >= 1) return n.toFixed(2);
    return n > 0 ? n.toFixed(4) : '0';
  }
  async function loadNavBalances() {
    const slot = document.getElementById('nav-auth');
    if (!slot || !AUTH.user) return;
    const who = AUTH.user.username; // snapshot identity so a response can't land in another session's nav
    try {
      const r = await fetch('/api/wallet/balances', { credentials: 'same-origin' });
      if (!r.ok) return;
      const b = await r.json();
      if (!AUTH.user || AUTH.user.username !== who) return; // signed out / switched accounts mid-flight → discard
      let el = slot.querySelector('.nav-bal');
      if (!b.wallets) { if (el) el.remove(); return; }
      if (!el) {
        el = document.createElement('a');
        el.className = 'nav-bal'; el.href = '/profile.html';
        el.setAttribute('aria-label', 'Your connected wallet balances, read only');
        slot.insertBefore(el, slot.firstChild);
      }
      el.title = 'In your connected wallet(s) · read-only';
      el.innerHTML =
        '<span class="nav-bal-item send"><b>' + fmtBal(b.send) + '</b> SEND</span>' +
        '<span class="nav-bal-item gwc"><b>' + fmtBal(b.gwc) + '</b> GWC</span>' +
        '<span class="nav-bal-item eth"><b>' + fmtBal(b.eth) + '</b> ETH</span>';
    } catch {}
  }
  window.refreshNavBalances = loadNavBalances;

  /* ---------- nav state ---------- */
  function renderNav() {
    const slot = document.getElementById('nav-auth');
    if (!slot) return;
    if (AUTH.user) {
      slot.innerHTML = '';
      const lvl = AUTH.user.level != null ? AUTH.user.level : (window.levelForXp ? window.levelForXp(AUTH.user.points || 0) : 1);
      const pts = AUTH.user.points || 0;
      const badge = document.createElement('a');
      badge.className = 'nav-xp'; badge.id = 'nav-xp-badge'; badge.href = '/profile.html';
      badge.setAttribute('aria-label', navBadgeLabel(lvl, pts));
      badge.innerHTML = '<span class="nav-xp-lv">Lv ' + lvl + '</span><span class="nav-xp-sep" aria-hidden="true">·</span><span class="nav-xp-pts">' + pts.toLocaleString('en-US') + '</span>' + navBoostHTML();
      slot.appendChild(badge);
      mountProfileMenu(slot, AUTH.user); // @name → account menu (My Wall · Dashboard · Disconnect wallet · Sign out)
      loadNavBalances(); // fills a read-only SEND/GWC/ETH pill if the user has a linked wallet
    } else {
      slot.innerHTML = '';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'profile-link';
      b.textContent = 'Sign In 🚪';
      b.addEventListener('click', () => openModal());
      slot.appendChild(b);
    }
  }

  async function refresh() {
    try { AUTH.user = (await api('/api/me')).user; }
    catch { AUTH.user = null; }
  }
  // re-read /api/me and repaint the nav badge — for anything that changes points or the boost stack out of band
  // (an arcade boost expiring, a cash-out in another tab). Never throws: a failed refresh just leaves the badge.
  AUTH.refresh = async function () {
    const before = AUTH.user;
    await refresh();
    if (!AUTH.user && before) AUTH.user = before;      // a transient /api/me failure must not sign the UI out
    document.dispatchEvent(new CustomEvent('points:changed'));
  };

  AUTH.ready = (async function init() {
    try {
      AUTH.config = await api('/api/config');
      const a = AUTH.config.auth || {};
      if (a.google || a.facebook || a.x || a.instagram) {
        const row = () => {
          const r = modal.querySelector('#oauth-row');
          if (!r) return;
          r.hidden = false;
          ['google', 'facebook', 'x', 'instagram'].forEach(k => { if (a[k]) { const b = modal.querySelector('#oauth-' + k); if (b) b.hidden = false; } });
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', row); else row();
      }
    } catch {}
    await refresh();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onAuthChange);
    else onAuthChange();
    /* An OAuth sign-in on an account with two-factor on comes back here as /?twofa=1 instead of a session —
       the challenge itself is in an HttpOnly cookie the page cannot read, so we ask the server for it and
       finish in exactly the same panel the email/password flow uses. The marker is stripped from the URL
       either way, so a reload or a shared link never re-triggers it. */
    if (/[?&]twofa=1\b/.test(location.search)) {
      try { history.replaceState(null, '', location.pathname + location.search.replace(/([?&])twofa=1&?/, '$1').replace(/[?&]$/, '') + location.hash); } catch {}
      const pickup = async () => {
        try {
          const j = await api('/api/auth/2fa/pending');
          if (j && j.twofa && AUTH._show2fa) { openModal(); AUTH._show2fa(j); }
        } catch {}
      };
      // the panel is built in the DOMContentLoaded handler above — wait for it rather than racing it
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pickup);
      else pickup();
    }
    return AUTH.user;
  })();
})();
