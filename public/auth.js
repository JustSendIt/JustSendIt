/* ===== JustSendIt auth client: session state, sign-in modal, nav ===== */
(function () {
  const AUTH = { user: null, config: { auth: { wallet: true, email: true } }, ready: null };
  window.AUTH = AUTH;
  // the server says how long this session stays unlocked; turn that into a deadline on THIS clock
  AUTH._normMe = function (me) {
    if (me) me.sudoUntil = me.sudoLeftMs > 0 ? Date.now() + me.sudoLeftMs - 1500 : null;
    return me;
  };

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      credentials: 'same-origin',
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    /* A security change refused only because this session has not confirmed it's you (or its window ran
       out): open that one step, then make the same request again — once. Every settings control gets this
       without having to remember it, including the ones that used to send no proof and simply fail. */
    if (res.status === 401 && j.code === 'need_verify' && !opts._verified && AUTH.user && AUTH.stepUp) {
      AUTH.user.sudoUntil = null;
      await AUTH.stepUp(j.error, { force: true });   // throws 'cancelled' if they close it
      return api(path, Object.assign({}, opts, { _verified: true }));
    }
    if (!res.ok) {
      /* no JSON came back: Cloudflare answers an origin 502/504 with its own "error code: 502" page, so the server's
         words never arrive — say what is known in plain words rather than "request failed (502)" */
      const e = new Error(j.error || (res.status >= 500 ? 'The site could not finish that just now — try again in a minute.' : 'request failed (' + res.status + ')'));
      e.status = res.status;
      e.code = j.code;      // machine-readable refusals (need_invite, need_tos, code_spent, daily_limit…)
      if (j.verifyNeeds) e.verifyNeeds = j.verifyNeeds;   // a wrong "confirm it's you" answer says what the step needs now
      e.needsProof = !!j.needsProof;   // the participation gate — the client opens the check, not a toast
      e.proof = j.proof || null;
      /* Raise the check HERE rather than at each of the ~20 places that write. Every one of them would
         otherwise have to remember, and the one that forgot would leave a person staring at a refusal
         with no way to act on it. The error still throws, so callers keep their own error handling. */
      if (e.needsProof && AUTH.needsProof) { try { AUTH.needsProof(e); } catch {} }
      throw e;
    }
    return j;
  }
  window.api = api;

  /* ---------- modal markup ---------- */
  const modal = document.createElement('div');
  modal.id = 'auth-modal';
  modal.setAttribute('hidden', '');
  modal.innerHTML = `
  <div class="modal-backdrop" data-close></div>
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="auth-title" aria-describedby="auth-sub">
    <button class="modal-x" data-close aria-label="Close sign-in dialog" data-tip="Closes this dialog without signing you in">✕</button>
    <h2 id="auth-title" class="display">Sign in or create an account 🚀</h2>
    <p class="modal-sub" id="auth-sub">It’s free. The same buttons work whether you’re new here or coming back.</p>

    <!-- The ways in, for new and returning people alike (owner, 2026-11-24: "as intuitive as possible all the way through
         clicking the button to getting an account"). Nothing is asked before the wallet connects: a wallet with an account
         signs in, a new one is asked for its @username next, in this same dialog. -->
    <div id="pane-choose" class="auth-step">
      <button type="button" class="btn btn-primary auth-go" id="btn-wallet-signin" data-tip="Signs you in, or starts a free account if this wallet is new here">Continue with wallet 🦊</button>
      <p class="modal-note auth-status" id="wallet-status" aria-live="polite"></p>
      <p class="modal-note auth-lead" id="w-lead">One free signature — no transaction, no gas.</p>
      <details class="w-works" id="w-works" hidden><summary data-tip="Shows every wallet that works here, and how"></summary><ul class="w-works-list" aria-label="Wallets that work here"></ul></details>
      <button type="button" class="btn btn-ghost auth-go" id="btn-email-go" data-tip="Sign in with your email or @username, or create an account with an email">Continue with email ✉️</button>
      <div id="oauth-row" class="oauth-row" hidden>
        <div class="or-line"><span>or continue with</span></div>
        <div class="oauth-grid">
          <a class="oauth-btn" id="oauth-google" href="/api/auth/google" hidden data-tip="Sends you to Google to sign in, then back here" aria-label="Continue with Google">
            <span class="oauth-ico"><svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg></span><span class="oauth-name">Google</span></a>
          <a class="oauth-btn" id="oauth-facebook" href="/api/auth/facebook" hidden data-tip="Sends you to Facebook to sign in, then back here" aria-label="Continue with Facebook">
            <span class="oauth-ico"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.25h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z"/></svg></span><span class="oauth-name">Facebook</span></a>
          <a class="oauth-btn oauth-x" id="oauth-x" href="/api/auth/x" hidden data-tip="Sends you to X to sign in, then back here" aria-label="Continue with X (Twitter)">
            <span class="oauth-ico"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93zm-1.29 19.5h2.04L6.48 3.24H4.29L17.61 20.65z"/></svg></span><span class="oauth-name">X</span></a>
          <a class="oauth-btn" id="oauth-instagram" href="/api/auth/instagram" hidden data-tip="Sends you to Instagram to sign in, then back here" aria-label="Continue with Instagram">
            <span class="oauth-ico"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><defs><linearGradient id="ig-g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".25" stop-color="#FA7E1E"/><stop offset=".5" stop-color="#D62976"/><stop offset=".75" stop-color="#962FBF"/><stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs><path fill="url(#ig-g)" d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 01-1.38-.9 3.7 3.7 0 01-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07zm0 1.62c-3.15 0-3.52.01-4.76.07-1.15.05-1.77.24-2.19.4-.55.22-.94.47-1.35.88-.41.41-.66.8-.88 1.35-.16.42-.35 1.04-.4 2.19-.06 1.24-.07 1.61-.07 4.76s.01 3.52.07 4.76c.05 1.15.24 1.77.4 2.19.22.55.47.94.88 1.35.41.41.8.66 1.35.88.42.16 1.04.35 2.19.4 1.24.06 1.61.07 4.76.07s3.52-.01 4.76-.07c1.15-.05 1.77-.24 2.19-.4.55-.22.94-.47 1.35-.88.41-.41.66-.8.88-1.35.16-.42.35-1.04.4-2.19.06-1.24.07-1.61.07-4.76s-.01-3.52-.07-4.76c-.05-1.15-.24-1.77-.4-2.19a3.6 3.6 0 00-.88-1.35 3.6 3.6 0 00-1.35-.88c-.42-.16-1.04-.35-2.19-.4-1.24-.06-1.61-.07-4.76-.07zm0 2.76a5.46 5.46 0 110 10.92 5.46 5.46 0 010-10.92zm0 9a3.54 3.54 0 100-7.08 3.54 3.54 0 000 7.08zm6.95-9.22a1.28 1.28 0 11-2.55 0 1.28 1.28 0 012.55 0z"/></svg></span><span class="oauth-name">Instagram</span></a>
        </div>
        <p class="modal-note auth-terms">Making an account this way means you are 18 or over and accept the <a href="/terms" target="_blank" rel="noopener" data-tip="Opens the terms of service in a new tab">Terms</a> and the <a href="/privacy" target="_blank" rel="noopener" data-tip="Opens the privacy policy in a new tab">Privacy policy</a>.</p>
      </div>
      <p class="modal-note bp-alt">Wallet can’t sign, like GMGN? <button type="button" class="linklike" id="btn-burn-alt" data-tip="Opens Burn Verification: prove the wallet by sending any amount of $SEND or ETH to the burn address yourself, instead of signing">Burn Verification 🔥</button></p>
      <details class="w-extra auth-more"><summary data-tip="Shows what signing a message does and does not do">Read more</summary><p class="modal-note">Signing proves the wallet is yours. It moves nothing, approves nothing, and never lets this site move funds. A wallet that has been here before signs you in; a new one gets a free account once you pick a @username. Making an account needs no $SEND.</p></details>
    </div>

    <!-- A new wallet's last step (or a sign-up that brought its @username with it): the name, the optional extras, one press -->
    <div id="pane-wallet" class="auth-step" hidden>
      <button type="button" class="auth-back" data-back data-tip="Goes back to the ways to sign in or create an account">← Back</button>
      <p class="w-connected" id="w-connected" hidden><span aria-hidden="true">✅</span> Wallet connected: <b class="w-addr" id="w-addr"></b></p>
      <p class="modal-note" id="w-name-lead"></p>
      <form id="w-form" novalidate>
        <label class="f-label" for="w-username">Pick your @username <span class="f-hint">— your public name; you can also sign in with it</span></label>
        <input class="addr-input" id="w-username" autocomplete="username" maxlength="24" placeholder="moon_goblin" spellcheck="false" autocapitalize="none">
        <p class="modal-note" id="w-uname-status" aria-live="polite"></p>
        <details class="w-extra" id="w-extra">
          <summary data-tip="Shows the optional email and password, a second way to sign in">➕ Add an email &amp; password too <span class="f-hint">(optional)</span></summary>
          <p class="modal-note">A second way in: sign in with your @username or email and this password, even without the wallet. Leave both empty to skip.</p>
          <label class="f-label" for="w-email">Email</label>
          <input class="addr-input" id="w-email" type="email" autocomplete="email" placeholder="you@example.com">
          <label class="f-label" for="w-pw">Password <span class="f-hint">(8+ characters)</span></label>
          <input class="addr-input" id="w-pw" type="password" autocomplete="new-password" placeholder="••••••••">
          <label class="f-label" for="w-pw2">Confirm password</label>
          <input class="addr-input" id="w-pw2" type="password" autocomplete="new-password" placeholder="••••••••">
        </details>
        <label class="w-opt"><input type="checkbox" id="w-2fa"> <span>Set up two-factor right after <span class="f-hint">(optional)</span></span></label>
        <p class="modal-note auth-terms">Creating an account means you are 18 or over and accept the <a href="/terms" target="_blank" rel="noopener" data-tip="Opens the terms of service in a new tab">Terms</a> and the <a href="/privacy" target="_blank" rel="noopener" data-tip="Opens the privacy policy in a new tab">Privacy policy</a>.</p>
        <button type="submit" class="btn btn-primary auth-go" id="w-create" data-tip="Makes your account with this @username — nothing else to sign">Create my account ✨</button>
      </form>
      <p class="modal-note auth-status" id="w-create-status" aria-live="polite"></p>
    </div>

    <div id="pane-email" class="auth-step" hidden>
      <button type="button" class="auth-back" data-back data-tip="Goes back to the ways to sign in or create an account">← Back</button>
      <div class="auth-segment" role="group" aria-label="Sign in, or create an account with an email">
        <button type="button" class="auth-seg active" id="seg-login" aria-pressed="true" data-tip="For an account you already have: your email or @username, and your password">Sign in</button>
        <button type="button" class="auth-seg" id="seg-signup" aria-pressed="false" data-tip="Makes a new account with a @username, an email and a password — free">Create account</button>
      </div>
      <form id="email-form" novalidate>
        <div id="reg-fields" hidden>
          <label class="f-label" for="f-username">Pick your @username <span class="f-hint">— your public name; sign in with it or your email</span></label>
          <input class="addr-input" id="f-username" autocomplete="username" maxlength="24" placeholder="moon_goblin" spellcheck="false" autocapitalize="none">
          <p class="modal-note" id="uname-status" aria-live="polite"></p>
        </div>
        <label class="f-label" for="f-email" id="f-email-label">Email or username</label>
        <input class="addr-input" id="f-email" type="text" autocomplete="username" placeholder="email or @handle" spellcheck="false" autocapitalize="none">
        <label class="f-label" for="f-password" id="f-password-label">Password</label>
        <input class="addr-input" id="f-password" type="password" autocomplete="current-password" placeholder="••••••••">
        <div id="reg-fields2" hidden>
          <label class="f-label" for="f-password2">Confirm password</label>
          <input class="addr-input" id="f-password2" type="password" autocomplete="new-password" placeholder="••••••••">
          <label class="w-opt" id="f-2fa-opt"><input type="checkbox" id="f-2fa"> <span>Set up two-factor right after <span class="f-hint">(optional)</span></span></label>
          <p class="modal-note auth-terms">Creating an account means you are 18 or over and accept the <a href="/terms" target="_blank" rel="noopener" data-tip="Opens the terms of service in a new tab">Terms</a> and the <a href="/privacy" target="_blank" rel="noopener" data-tip="Opens the privacy policy in a new tab">Privacy policy</a>.</p>
        </div>
        <button class="btn btn-primary auth-go" type="submit" id="email-submit" data-tip="Signs you in with this email or @username and password">Sign in 🚪</button>
      </form>
      <p class="modal-note auth-status" id="email-status" aria-live="polite"></p>
    </div>

    <div id="pane-burn" class="auth-step" hidden>
      <button type="button" class="auth-back" data-back data-tip="Goes back to the ways to sign in or create an account">← Back</button>
      <details class="w-extra auth-more"><summary data-tip="Shows how Burn Verification works, step by step">How it works</summary><p class="modal-note">Fill this in once, then send <b>any amount of $SEND or ETH</b> — as much or as little as you like — from that wallet to the burn address within an hour, from your own wallet app. This site never sends it. A burn can’t sign you in, so the email and password below are how you sign in, on any device.</p></details>
      <div class="auth-segment" role="group" aria-label="Sign in, or create an account, with Burn Verification">
        <button type="button" class="auth-seg" id="bseg-login" aria-pressed="false" data-tip="For an account you already have: sign in with your email or @username, then prove the wallet">Sign in</button>
        <button type="button" class="auth-seg active" id="bseg-signup" aria-pressed="true" data-tip="Makes a new account with an email and a password, then proves the wallet">Create account</button>
      </div>
      <form id="burn-form" novalidate>
        <p class="modal-note bp-ticket-note" id="b-ticket" hidden>🎟️ Joining takes an invite code. You’ll enter it straight after this, then your account is made and your burn step opens — what you typed here is kept while you finish the ticket.</p>
        <div id="b-reg">
          <label class="f-label" for="b-username">Pick your @username <span class="f-hint">— your public name</span></label>
          <input class="addr-input" id="b-username" autocomplete="username" maxlength="24" placeholder="moon_goblin" spellcheck="false" autocapitalize="none">
          <p class="modal-note" id="b-uname-status" aria-live="polite"></p>
        </div>
        <label class="f-label" for="b-email" id="b-email-label">Email</label>
        <input class="addr-input" id="b-email" type="email" autocomplete="email" placeholder="you@example.com">
        <label class="f-label" for="b-pw" id="b-pw-label">Password <span class="f-hint">(8+ characters)</span></label>
        <input class="addr-input" id="b-pw" type="password" autocomplete="new-password" placeholder="••••••••">
        <div id="b-reg2">
          <label class="f-label" for="b-pw2">Confirm password</label>
          <input class="addr-input" id="b-pw2" type="password" autocomplete="new-password" placeholder="••••••••">
        </div>
        <label class="f-label" for="b-addr">The wallet you’re verifying <span class="f-hint" id="b-addr-hint">— its address, copied from GMGN or your wallet app (starts with 0x)</span></label>
        <input class="addr-input" id="b-addr" autocomplete="off" spellcheck="false" maxlength="64" placeholder="0x…">
        <p class="modal-note auth-terms" id="b-terms">Creating an account means you are 18 or over and accept the <a href="/terms" target="_blank" rel="noopener" data-tip="Opens the terms of service in a new tab">Terms</a> and the <a href="/privacy" target="_blank" rel="noopener" data-tip="Opens the privacy policy in a new tab">Privacy policy</a>.</p>
        <button class="btn btn-primary auth-go" type="submit" id="burn-submit" data-tip="Makes your account (or signs you in), starts your one hour and shows where to send the burn">Create account &amp; verify 🔥</button>
      </form>
      <p class="modal-note auth-status" id="burn-status" aria-live="polite"></p>
    </div>

    <div id="pane-2fa" hidden>
      <div id="twofa-totp" hidden>
        <p class="modal-note">🔐 Two-factor is on for this account. Enter the 6-digit code from your authenticator app.</p>
        <label class="f-label" for="f-totp">Authentication code</label>
        <input class="addr-input" id="f-totp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" style="text-align:center; font-size:max(var(--text-floor), 1.3rem); letter-spacing:0.3em;">
        <button class="btn btn-primary" id="totp-submit" style="width:100%;" data-tip="Checks the code you typed and finishes signing in">Verify ✅</button>
      </div>
      <div id="twofa-wallet" hidden>
        <p class="modal-note">🔐 Two-factor is on for this account. Sign a free message with your linked wallet to finish signing in.</p>
        <button class="btn btn-primary" id="wallet2fa-submit" style="width:100%;" data-tip="Signs a message with your linked wallet to finish signing in">Sign With Wallet 🦊</button>
      </div>
      <div id="twofa-password" hidden>
        <p class="modal-note">🔐 Two-factor is on for this account. Enter your account password to finish signing in.</p>
        <label class="f-label" for="f-2fa-pw">Account password</label>
        <input class="addr-input" id="f-2fa-pw" type="password" autocomplete="current-password" placeholder="••••••••">
        <button class="btn btn-primary" id="pw2fa-submit" style="width:100%;" data-tip="Checks your account password and finishes signing in">Verify ✅</button>
      </div>
      <p class="modal-note" id="twofa-status" aria-live="polite"></p>
    </div>

    <div id="pane-confirm" hidden>
      <p class="modal-note" id="cf-lead"></p>
      <div id="cf-pw-row" hidden>
        <label class="f-label" for="cf-pw">Account password</label>
        <input class="addr-input" id="cf-pw" type="password" autocomplete="current-password" placeholder="••••••••">
      </div>
      <div id="cf-code-row" hidden>
        <label class="f-label" for="cf-code">Code from your authenticator app</label>
        <input class="addr-input" id="cf-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" style="text-align:center; letter-spacing:0.3em;">
      </div>
      <div id="cf-wallet-row" hidden>
        <p class="modal-note" id="cf-wallet-note"></p>
        <button class="btn btn-ghost" id="cf-wallet" type="button" style="width:100%;" data-tip="Asks your wallet to sign a free message — nothing moves, nothing is approved">Sign with wallet 🦊</button>
      </div>
      <div id="cf-again-row" hidden>
        <p class="modal-note">This account signs in through a social login, and signing in is the proof. Sign out, sign in again the same way, and security changes are unlocked for the next while.</p>
        <button class="btn btn-ghost" id="cf-signout" type="button" style="width:100%;" data-tip="Signs you out so you can sign in again and unlock security changes">Sign out and sign in again</button>
      </div>
      <button class="btn btn-primary" id="cf-go" type="button" style="width:100%;" data-tip="Checks what you entered and unlocks security changes on this device for a while">Unlock 🔓</button>
      <p class="modal-note" id="cf-status" aria-live="polite"></p>
    </div>

    <!-- The way in for somebody who was handed a code, so the member who sent it is credited. Nobody needs one to join
         (unless the operator turns INVITE_REQUIRED on, when the ticket opens by itself at the first sign-up step). -->
    <p class="auth-invite" id="auth-invite">Got a code from a member? <button type="button" class="linklike" id="auth-ticket" data-tip="Closes this and opens the invite code box, so the member who sent it is credited">Enter it</button> so they’re credited.</p>
  </div>`;

  let lastFocus = null, releaseTrap = null, confirmReject = null, prevOverflow = '';
  function openModal() {
    /* Opened again while it is already up (a "confirm it's you" raised from it, a sign-up handed to it): the page's focus
       and scroll lock were taken the first time — taking them again would hand back this dialog's own button, or its lock. */
    const wasHidden = modal.hasAttribute('hidden');
    if (wasHidden) {
      lastFocus = document.activeElement;
      prevOverflow = document.body.style.overflow;   // a confirm raised from inside the ticket must hand the scroll lock back to it, not clear it
    }
    modal.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    if (AUTH._reset2fa) AUTH._reset2fa();       // the headings, and the ways in
    if (AUTH._resetModes) AUTH._resetModes();   // the forms on Sign in; openSignup switches them to Create account after this
    const first = modal.querySelector('#btn-wallet-signin'); if (first) first.focus();   // the first way in, ready for Enter
    if (releaseTrap) releaseTrap();             // never two traps on one card
    releaseTrap = window.trapFocus ? window.trapFocus(modal.querySelector('.modal-card')) : null;
    if (wasHidden) document.dispatchEvent(new CustomEvent('jsi:modalopen'));
  }
  function closeModal() {
    if (modal.hasAttribute('hidden') && !confirmReject) return;   // already closed (a late wallet answer, say): nothing to hand back twice
    modal.setAttribute('hidden', '');
    for (const id of ['f-2fa-pw', 'f-totp', 'cf-pw', 'cf-code', 'w-pw', 'w-pw2', 'b-pw', 'b-pw2', 'f-password', 'f-password2']) { const i = modal.querySelector('#' + id); if (i) i.value = ''; }   // a password typed then cancelled must not wait in a hidden field
    document.body.style.overflow = prevOverflow;
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    if (lastFocus) lastFocus.focus();
    // a confirm-mode dialog closed without an answer is a cancel, not a promise left hanging
    if (confirmReject) { const r = confirmReject; confirmReject = null; r(new Error('cancelled')); }
    document.dispatchEvent(new CustomEvent('jsi:modalclose'));
  }
  AUTH.open = openModal;

  /* ═══ the invite ticket ═══════════════════════════════════════════════════════════════════════
     Reading this site takes nothing; JOINING it takes a code. The ticket therefore lives here rather
     than in front of the whole site — a whole-site redirect closed the landing page and every
     canonical, sitemap entry and og: tag with it, to guard a door that only ever stood in one place.
     invite.js and its CSS are fetched the first time somebody actually needs them, so a reader who
     never tries to join never downloads them. */
  let invitePromise = null;
  function loadInvite() {
    if (window.INVITE) return Promise.resolve(window.INVITE);
    if (invitePromise) return invitePromise;
    invitePromise = new Promise((resolve, reject) => {
      // versioned like every file a page names, so a deploy reaches the sign-up the moment it lands (see /api/config)
      const av = (AUTH.config && AUTH.config.assets) || {};
      const vd = (f) => '/' + f + (av[f] ? '?v=' + encodeURIComponent(av[f]) : '');
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = vd('gate.css'); document.head.appendChild(link);
      const link2 = document.createElement('link');
      link2.rel = 'stylesheet'; link2.href = vd('invite.css'); document.head.appendChild(link2);
      const sc = document.createElement('script');
      sc.src = vd('invite.js');
      sc.onload = () => window.INVITE ? resolve(window.INVITE) : reject(new Error('invite failed to load'));
      sc.onerror = () => reject(new Error('invite failed to load'));
      document.head.appendChild(sc);
    });
    return invitePromise;
  }
  // Open the ticket. Falls back to the plain account modal if the ticket itself cannot load, so a
  // failed asset can never make signing up impossible.
  async function openInvite(opts) {
    try { const inv = await loadInvite(); await inv.open(opts || {}); }
    catch { openModal(); }
  }
  AUTH.openInvite = openInvite;
  AUTH.loadInvite = loadInvite;
  /* The burn proof (burnproof.js): a wallet that cannot sign, or is not on the picker's list, is proved by a burn sent
     from it. Fetched the first time somebody needs it, like the ticket. It opens over the ticket and the picker; the
     sign-in panel, when it is up for a sign-in rather than a "confirm it's you", steps aside for it. */
  let burnPromise = null;
  function loadBurn() {
    if (window.BURNPROOF) return Promise.resolve(window.BURNPROOF);
    if (burnPromise) return burnPromise;
    burnPromise = new Promise((resolve, reject) => {
      const av = (AUTH.config && AUTH.config.assets) || {};
      const sc = document.createElement('script');
      sc.src = '/burnproof.js' + (av['burnproof.js'] ? '?v=' + encodeURIComponent(av['burnproof.js']) : '');
      sc.onload = () => window.BURNPROOF ? resolve(window.BURNPROOF) : reject(new Error('burn proof failed to load'));
      sc.onerror = () => { burnPromise = null; reject(new Error('burn proof failed to load')); };
      document.head.appendChild(sc);
    });
    return burnPromise;
  }
  AUTH.openBurnProof = function (opts) {
    // signed out, Burn Verification is a way in like the other two: the sign-in panel, on that option
    if (!AUTH.user && AUTH._showBurnTab) {
      if (confirmReject) return Promise.resolve();
      if (modal.hasAttribute('hidden')) openModal();
      AUTH._showBurnTab();   // refuses quietly while a two-factor step is up
      return Promise.resolve();
    }
    if (!modal.hasAttribute('hidden') && !confirmReject) closeModal();
    return loadBurn().then((b) => b.open(opts || {})).catch(() => { if (window.sendToast) sendToast('⚠️ The burn proof could not load — reload the page and try again.'); });
  };
  // someone who chose "make an account" or "sign in" from the burn proof gets it back once they are in (a page change included)
  function resumeBurnProof() {
    if (!AUTH.user) return;
    let at = 0; try { at = Number(sessionStorage.getItem('jsi:burnproof')) || 0; } catch {}
    if (!at) return;
    let address = ''; try { address = sessionStorage.getItem('jsi:burnproof-addr') || ''; sessionStorage.removeItem('jsi:burnproof-addr'); } catch {}
    try { sessionStorage.removeItem('jsi:burnproof'); } catch {}
    if (Date.now() - at > 15 * 60e3) return;   // a sign-in begun from the panel and abandoned long ago does not reopen it later
    const go = () => setTimeout(() => AUTH.openBurnProof({ from: 'resume', address }), 700);   // after the welcome and the nav repaint
    if (window.AGE && AGE.needed && AGE.whenOk) AGE.whenOk(go); else go();
  }
  // Does this visitor already hold a ticket? Cached for the page's life — it only ever changes
  // through the ticket itself, which updates this when it does.
  let gateState = null;
  /* A sign-up the site opened itself (startJoin, once it has read the pass; the ticket, after its last step) is trusted:
     choosing Create account in it never re-reads the pass and bounces to the ticket. A stale cached "no ticket" once closed
     the dialog onto the homepage and reopened the ticket, in a loop, and the wallet signature never started. openModal
     clears it, so a dialog opened only to sign in still asks for the ticket where INVITE_REQUIRED=1 needs one. */
  let joinTrusted = false;
  async function gate(force) {
    if (gateState && !force) return gateState;
    try { gateState = await api('/api/gate/state'); }
    catch { if (!gateState) gateState = { access: false, signedIn: false }; }   // a blip must not wipe a ticket we already confirmed — that was the bounce back to the homepage
    return gateState;
  }
  AUTH.gate = gate;
  /* The one function the rest of the site calls to start a sign-up. It is the same dialog as signing in — the ways in
     first — with its forms set to Create account. opts: tab ('wallet' | 'email' | 'burn'); username, email, password,
     password2 and setup2fa as typed on the ticket; connect (press the wallet button at once); fromTicket. */
  AUTH.openSignup = function (opts) {
    opts = opts || {};
    openModal();
    joinTrusted = true;
    if (AUTH._emailMode) AUTH._emailMode(true);   // the email form on Create account, not Sign in
    if (AUTH._burnMode) AUTH._burnMode(true);
    /* The ticket asks "Set up two-factor right after?" on its own last step, because with connect the press below
       is made at once: the box in this dialog is read in that same instant and could never be ticked. */
    if (opts.setup2fa !== undefined) {
      for (const id of ['w-2fa', 'f-2fa']) { const b = modal.querySelector('#' + id); if (b) b.checked = !!opts.setup2fa; }
    }
    const put = (id, v) => { const el = modal.querySelector('#' + id); if (el) el.value = v || ''; };
    if (opts.username) put(opts.tab === 'email' ? 'f-username' : 'w-username', opts.username);
    if (opts.email && opts.tab === 'email') { put('f-email', opts.email); put('f-password', opts.password); put('f-password2', opts.password2); }
    else if (opts.email) {
      put('w-email', opts.email); put('w-pw', opts.password); put('w-pw2', opts.password2);
      const ex = modal.querySelector('#w-extra'); if (ex) ex.open = true;
    }
    /* Which step: Burn Verification and Email have forms of their own; a sign-up that brought its @username is on the name
       step; anything else is on the ways in. Going there moves the focus to its first sensible control (a click does not). */
    const to = opts.tab === 'burn' ? 'burn' : opts.tab === 'email' ? 'email' : opts.username ? 'wallet' : 'choose';
    if (AUTH._goStep) AUTH._goStep(to);
    // The name is already chosen: go straight to the read-only signature — one picker, one signature. Email stays optional.
    if (opts.connect) {
      const go = modal.querySelector(opts.username ? '#w-create' : '#btn-wallet-signin');
      if (go) go.click();
    }
  };
  // the sign-in dialog, on Burn Verification, set for a new account (join) or an existing one
  AUTH.openBurnSignup = function (join) {
    if (AUTH.user) { AUTH.openBurnProof({ from: 'signin' }); return; }
    if (modal.hasAttribute('hidden')) openModal();
    if (AUTH._burnMode) AUTH._burnMode(join !== false);
    if (AUTH._showBurnTab) AUTH._showBurnTab();   // shows it, focused on its first field
  };
  AUTH.startJoin = async function (opts) {
    const g = await gate();
    if (g.signedIn) return;
    if (g.access) { AUTH.openSignup(opts); return; }
    openInvite(opts);
  };
  /* Any signup door refusing for want of an invite raises the ticket instead of an error message.
     This is the safety net under startJoin: it catches the paths that reach the server anyway — a
     wallet signature that turns out to be a new account, a stale tab, an OAuth round trip. */
  /* A write refused because the account has not proved it holds the coins yet. Distinct from
     needsInvite (no account at all) and from a read-only SANCTION (which has strikes and a banner):
     this person has an account and has done nothing wrong, they just have not shown their hand. Any
     caller that makes a write can hand its error here and get the check opened instead of a toast. */
  AUTH.needsProof = function (err) {
    if (!err || !err.needsProof) return false;
    loadInvite().then(inv => inv.openProof()).catch(() => {});
    return true;
  };
  AUTH.needsInvite = function (err) {
    const code = err && (err.code || err.gateCode);
    if (code === 'need_invite' || code === 'need_tos' || code === 'code_spent') { openInvite(); return true; }
    // the server never got the 18+ answer (the cookie did not survive): the age question, not the ticket
    if (code === 'need_age' && window.AGE) { AGE.reopen(); return true; }
    return false;
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
    // not while the wallet picker is up over this: that Esc is the picker's to answer (wallet.js)
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || modal.hasAttribute('hidden') || document.querySelector('.wc-overlay:not([hidden])')) return;
      e.preventDefault(); e.stopImmediatePropagation();   // this dialog owns the Esc — the ticket beneath it must not close as well
      closeModal();
    });

    // one writer for the status lines, so a failure's red is dropped again by the next progress message
    const setStatus = (el, text, bad) => { el.textContent = text; el.classList.toggle('is-err', !!bad); if (bad && window.SFX) SFX.play('error'); };
    const q = (sel) => modal.querySelector(sel);

    /* ═══ one dialog, in steps ═══════════════════════════════════════════════════════════════════════
       Owner, 2026-11-24: "Update the login/sign-up process to be as intuitive as possible all the way through clicking the
       button to getting an account." It was three tabs, each with its own pair of buttons labelled three different ways
       (Sign in | Create account, Create account | I have an account, Log in | Sign up): six choices before anything
       happened. Now the ways in come first, the same for new and returning people — Continue with wallet, Continue with
       email, any social sign-in, and Burn Verification for a wallet that cannot sign — and each way is a step of its own
       with a Back to the ways in. Two-factor and "confirm it's you" are steps of the same card. One step shows at a time. */
    const steps = { choose: q('#pane-choose'), wallet: q('#pane-wallet'), email: q('#pane-email'), burn: q('#pane-burn'), '2fa': q('#pane-2fa'), confirm: q('#pane-confirm') };
    let step = 'choose';
    // the headings the steps rewrite, captured once so the ways in (and a reset) can put the dialog's own back
    const heads = ['#auth-title', '.modal-sub', '#twofa-password .modal-note', '#twofa-totp .modal-note'].map(s => q(s));
    const headText = heads.map(el => el.textContent);
    const STEP_HEADS = {
      email: ['With your email ✉️', ''],
      wallet: ['Create your account ✨', ''],
      burn: ['Prove it by a burn 🔥', 'Burn Verification — for GMGN, or any wallet that can’t sign.'],
    };
    // the wallet sign-in's state, read by Back as well as by the wallet's own handlers below
    let pendingSignup = null, pendingAddr = '', wRun = 0;
    function showStep(name) {
      step = name;
      for (const k of Object.keys(steps)) steps[k].hidden = k !== name;
      q('#auth-invite').hidden = name !== 'choose';   // with the ways in only: past them it would throw away what was typed
      if (name !== '2fa' && name !== 'confirm') {   // those two write their own headings
        const h = STEP_HEADS[name];
        heads[0].textContent = h ? h[0] : headText[0];
        heads[1].textContent = h ? h[1] : headText[1];
      }
      heads[1].hidden = !heads[1].textContent;
      if (name === 'burn') paintBurnTicket();
    }
    // a step's first sensible control: the ways in start on the wallet; a form on its first empty field, or its button
    function focusStep(name) {
      if (name === 'choose') { q('#btn-wallet-signin').focus(); return; }
      const pane = steps[name];
      const shown = (el) => !!el && !el.disabled && el.getClientRects().length > 0;
      const empty = [...pane.querySelectorAll('input.addr-input')].find((el) => shown(el) && !el.value);
      const target = empty || pane.querySelector('.auth-go');
      try { (shown(target) ? target : pane.querySelector('[data-back]') || q('#btn-wallet-signin')).focus(); } catch {}
    }
    function goStep(name) { showStep(name); focusStep(name); }
    AUTH._goStep = goStep;
    // Back: to the ways in, focused on the way this step came from. A wallet proof waiting for its name is let go.
    const cameFrom = { wallet: '#btn-wallet-signin', email: '#btn-email-go', burn: '#btn-burn-alt' };
    function backToChoose() {
      const from = step;
      if (from === 'wallet') { wRun++; pendingSignup = null; pendingAddr = ''; }
      for (const id of ['wallet-status', 'w-create-status', 'email-status', 'burn-status']) setStatus(q('#' + id), '');
      showStep('choose');
      const b = q(cameFrom[from] || '#btn-wallet-signin'); if (b) b.focus();
    }
    modal.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', backToChoose));
    q('#btn-email-go').addEventListener('click', () => goStep('email'));

    // email: one switch, Sign in or Create account — on Sign in unless the dialog was opened to make an account (openSignup)
    let regMode = false, emailBusy = false;
    const segLogin = q('#seg-login'), segSignup = q('#seg-signup');
    function setRegMode(v) {
      regMode = v;
      q('#reg-fields').hidden = !regMode;
      q('#reg-fields2').hidden = !regMode;   // confirm password, the two-factor box, the terms line
      const go = q('#email-submit');
      go.textContent = regMode ? 'Create account ✨' : 'Sign in 🚪';
      go.setAttribute('data-tip', regMode ? 'Makes your account with this @username, email and password' : 'Signs you in with this email or @username and password');
      q('#f-password').autocomplete = regMode ? 'new-password' : 'current-password';
      q('#f-password-label').innerHTML = regMode ? 'Password <span class="f-hint">(8+ characters)</span>' : 'Password';
      q('#f-email-label').textContent = regMode ? 'Email' : 'Email or username';
      const fe = q('#f-email');
      fe.type = regMode ? 'email' : 'text';
      fe.autocomplete = regMode ? 'email' : 'username';
      fe.placeholder = regMode ? 'you@example.com' : 'email or @handle';
      segLogin.classList.toggle('active', !regMode); segLogin.setAttribute('aria-pressed', String(!regMode));
      segSignup.classList.toggle('active', regMode); segSignup.setAttribute('aria-pressed', String(regMode));
      for (const id of ['f-username', 'f-email', 'f-password', 'f-password2']) q('#' + id).removeAttribute('aria-invalid');
      setStatus(q('#email-status'), '');
    }
    AUTH._emailMode = setRegMode;
    const ticketLink = q('#auth-ticket');
    if (ticketLink) ticketLink.addEventListener('click', () => { closeModal(); openInvite({ code: true }); });
    const burnAlt = q('#btn-burn-alt');
    if (burnAlt) burnAlt.addEventListener('click', () => goStep('burn'));
    AUTH._showBurnTab = () => {
      if (step === '2fa' || step === 'confirm') return false;   // a two-factor step or a confirm is up: it is not the moment to switch
      goStep('burn');   // the picker that sent us here handed focus back to a button this hides: it goes to the form instead
      return true;
    };
    /* ═══ Burn Verification: one form ════════════════════════════════════════════════════════════
       Owner, 2026-10-22: "Fix the sign-up process for the burn verification so that its fluid for signing up process and
       make sure its easy for all users to sign up this way". It was three forms and two wrong turns: this option sent people
       to the email form, a sign-up without a ticket went through the ticket and came back on the WALLET option, and the burn
       step then asked for the wallet all over again. Now the account (or the sign-in) and the wallet are asked for together,
       and one press makes the account, starts the hour and opens the burn step on where to send it. Without a ticket, the
       ticket comes first and this carries on by itself after it, with what was typed kept. A burn signs nobody in, so a new
       account here always gets an email and a password (typed twice: it is the only way in). */
    let bRegMode = true, burnPending = null, burnBusy = false;
    const bq = (id) => modal.querySelector('#' + id);
    const bSegSignup = bq('bseg-signup'), bSegLogin = bq('bseg-login'), bStatus = bq('burn-status');
    async function paintBurnTicket() {
      const n = bq('b-ticket'); if (!n) return;
      if (!bRegMode) { n.hidden = true; return; }
      const g = await gate();
      n.hidden = !bRegMode || !!(g.access || g.signedIn);
    }
    function setBurnMode(v) {
      bRegMode = v;
      bq('b-reg').hidden = !v; bq('b-reg2').hidden = !v; bq('b-terms').hidden = !v;
      bSegSignup.classList.toggle('active', v); bSegSignup.setAttribute('aria-pressed', String(v));
      bSegLogin.classList.toggle('active', !v); bSegLogin.setAttribute('aria-pressed', String(!v));
      const em = bq('b-email');
      bq('b-email-label').textContent = v ? 'Email' : 'Email or username';
      em.type = v ? 'email' : 'text'; em.autocomplete = v ? 'email' : 'username'; em.placeholder = v ? 'you@example.com' : 'email or @handle';
      bq('b-pw-label').innerHTML = v ? 'Password <span class="f-hint">(8+ characters)</span>' : 'Password';
      bq('b-pw').autocomplete = v ? 'new-password' : 'current-password';
      bq('burn-submit').textContent = v ? 'Create account & verify 🔥' : 'Sign in & verify 🔥';
      // a member whose wallet is already proved signs in here too: for a sign-in the wallet is optional
      bq('b-addr-hint').textContent = v ? '— its address, copied from GMGN or your wallet app (starts with 0x)' : '— to prove another wallet; leave it empty if yours is already proved, and this just signs you in';
      setStatus(bStatus, '');
      paintBurnTicket();
    }
    AUTH._burnMode = setBurnMode;
    bSegSignup.addEventListener('click', () => setBurnMode(true));
    bSegLogin.addEventListener('click', () => setBurnMode(false));
    // the same live availability check as the other sign-up forms
    let bUnameTimer;
    bq('b-username').addEventListener('input', (e) => {
      clearTimeout(bUnameTimer);
      const v = e.target.value.trim(), el = bq('b-uname-status');
      if (!v) { el.textContent = ''; return; }
      bUnameTimer = setTimeout(async () => {
        try {
          const j = await api('/api/username-check?u=' + encodeURIComponent(v));
          el.textContent = j.available ? '✅ available' : ('❌ ' + (j.reason || 'taken — try another'));
          el.style.color = j.available ? 'var(--green-bright)' : 'var(--red)';
        } catch {}
      }, 300);
    });
    // after the ticket (the only thing that was in the way): back here, everything as typed, and carry on
    function resumeBurnForm() {
      const p = burnPending; burnPending = null; clearTimeout(burnPendingT);
      if (modal.hasAttribute('hidden')) openModal();
      setBurnMode(true); showStep('burn');
      if (!p) { burnFail('your ticket is ready — type your password again (twice) and press Create account to carry on', 'b-pw'); return; }
      bq('b-username').value = p.username; bq('b-email').value = p.email; bq('b-pw').value = p.pw; bq('b-pw2').value = p.pw2; bq('b-addr').value = p.address;
      burnSubmit();
    }
    // what was typed waits for the ticket half an hour at most (a typed password must not wait in the page longer)
    let burnPendingT = 0;
    const toTicket = (v) => {
      burnPending = Object.assign({}, v, { at: Date.now() });
      clearTimeout(burnPendingT); burnPendingT = setTimeout(() => { burnPending = null; }, 30 * 60e3);
      closeModal(); openInvite({ then: resumeBurnForm });
    };
    // an error is said beside the button and the focus goes to the field it is about, so it is never below the fold unseen
    const burnFail = (msg, field) => {
      setStatus(bStatus, '⚠️ ' + msg, true);
      for (const id of ['b-username', 'b-email', 'b-pw', 'b-pw2', 'b-addr']) bq(id).removeAttribute('aria-invalid');
      const id = field || (/username|@/i.test(msg) ? 'b-username' : /email/i.test(msg) ? 'b-email' : /passwords? don|match/i.test(msg) ? 'b-pw2' : /password|credentials/i.test(msg) ? 'b-pw' : /address|wallet|0x/i.test(msg) ? 'b-addr' : null);
      const f = id && bq(id);
      if (f && !f.closest('[hidden]')) { f.setAttribute('aria-invalid', 'true'); f.focus(); } else bq('burn-submit').focus();
      try { bStatus.scrollIntoView({ block: 'nearest' }); } catch {}
    };
    async function burnSubmit() {
      if (burnBusy) return;
      const v = { username: bq('b-username').value.trim(), email: bq('b-email').value.trim(), pw: bq('b-pw').value, pw2: bq('b-pw2').value, address: bq('b-addr').value.trim() };
      const btn = bq('burn-submit');
      try {
        // checked here first, so nothing is sent — and no ticket shown — for a form that would be refused
        if (bRegMode) {
          if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(v.username)) throw new Error('pick a @username: 3–24 letters, numbers, _ . -');
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) throw new Error('enter a valid email — with your password, it’s how you sign in');
          if (v.pw.length < 8) throw new Error('the password needs at least 8 characters');
          if (v.pw !== v.pw2) throw new Error('the two passwords don’t match');
        } else {
          if (!v.email) throw new Error('enter your email or @username');
          if (!v.pw) throw new Error('enter your password');
        }
        if (!(v.address === '' && !bRegMode) && !/^0x[0-9a-fA-F]{40}$/.test(v.address)) throw Object.assign(new Error('paste the wallet’s address: 0x followed by 40 letters and numbers'), { field: 'b-addr' });
        burnBusy = true; btn.disabled = true;
        if (bRegMode) {   // a taken name is said now, not after the whole ticket
          let chk = null; try { chk = await api('/api/username-check?u=' + encodeURIComponent(v.username)); } catch {}
          if (chk && chk.available === false) throw Object.assign(new Error('@' + v.username + ' is ' + (chk.reason || 'taken — pick another')), { field: 'b-username' });
        }
        let j;
        if (bRegMode) {
          const g = await gate();
          if (!g.signedIn && !g.access) { setStatus(bStatus, ''); toTicket(v); return; }
          setStatus(bStatus, 'Making your account…');
          j = await api('/api/auth/register', { method: 'POST', body: { username: v.username, email: v.email, password: v.pw } });
        } else {
          setStatus(bStatus, 'Signing in…');
          j = await api('/api/auth/login', { method: 'POST', body: { identifier: v.email, password: v.pw } });
          if (j.twofa) {
            // the second step first; the burn step then opens by itself, on this wallet (resumeBurnProof)
            if (v.address) { try { sessionStorage.setItem('jsi:burnproof', String(Date.now())); sessionStorage.setItem('jsi:burnproof-addr', v.address); } catch {} }
            setStatus(bStatus, '');
            if (v.address) sendToast('🔐 Two-factor is on: after your code, the burn step opens on this wallet — starting the hour asks you to confirm it’s you once more.', 8000);
            show2fa(j); return;
          }
        }
        /* in: start the hour now. A new account's own session needs no "confirm it's you" for its first hour; a sign-in hands
           over the password it was given a moment ago, which is that confirmation. Whatever the start says, the burn step
           opens next — on the amounts, or on this wallet with the reason it could not start yet. */
        let startErr = null, alreadyMine = false;
        if (v.address) {
          setStatus(bStatus, 'Starting your hour…');
          try { await api('/api/wallet/burnproof/start', { method: 'POST', body: Object.assign({ address: v.address }, bRegMode ? {} : { current: { password: v.pw } }) }); }
          catch (err) { if (err && err.status === 409) alreadyMine = true; else startErr = err; }   // 409: that wallet is already proved on this account
        }
        // the form is done with: nothing of it waits for whoever uses this browser next
        for (const id of ['b-username', 'b-email', 'b-pw', 'b-pw2', 'b-addr']) { bq(id).value = ''; bq(id).removeAttribute('aria-invalid'); }
        bq('b-uname-status').textContent = '';
        setStatus(bStatus, '');
        try { sessionStorage.removeItem('jsi:burnproof'); sessionStorage.removeItem('jsi:burnproof-addr'); } catch {}   // an older note must not reopen the step on another wallet
        const hi = 'Welcome' + (j && j.newAccount ? '' : ' back') + ', @' + (j && j.username) + '! ';
        if (window.SFX) SFX.play(startErr ? 'notify' : 'success');
        sendToast(hi + (j && j.emailNotAdded ? emailNotAddedMsg(j.username)
          : !v.address ? '🚪 You’re signed in.' : alreadyMine ? '✅ That wallet is already proved on your account.'
          : startErr && startErr.code !== 'need_email' ? '⚠️ Your hour couldn’t start yet — the reason is in the burn step.'
          : '🔥 Now send any amount of $SEND or ETH from your wallet to the burn address.'), j && j.emailNotAdded ? 9000 : 6000);
        closeModal();
        await refresh(); onAuthChange();
        if (v.address && !alreadyMine) await AUTH.openBurnProof({ from: 'signup', address: v.address, error: startErr && startErr.code !== 'need_email' ? startErr.message : '' });
      } catch (err) {
        // no ticket yet (or terms not accepted): the ticket, then this carries on. A spent code is said, not looped through the ticket
        if (bRegMode && (err.code === 'need_invite' || err.code === 'need_tos')) { setStatus(bStatus, ''); toTicket(v); return; }
        if (err && err.code === 'need_age' && window.AGE) { setStatus(bStatus, ''); AGE.reopen(); return; }
        burnFail((err && err.message) || 'that didn’t work — try again', err && err.field);
      } finally { burnBusy = false; if (btn) btn.disabled = false; }
    }
    bq('burn-form').addEventListener('submit', (e) => { e.preventDefault(); burnSubmit(); });
    /* The wallets that work here, named on the sign-in and sign-up screen itself (owner, 2026-10-20: "I don't see all the new
       wallets in the sign-up screen"): every one of them a press away, under the wallet button. The line itself stays short
       — how many, and GMGN by a burn (owner, 2026-11-24: long text behind a drop-down). Drawn from the same registry the
       picker uses (WALLET.known), so the two can never disagree; the wallet button then opens that full list. */
    const works = modal.querySelector('#w-works');
    if (works && window.WALLET && WALLET.known) {
      const all = WALLET.known(), signing = all.filter((k) => !k.burn), burnOnly = all.filter((k) => k.burn);
      // the wallets that sign in by a signature, counted as such; GMGN (no signature here) named apart, with how it joins
      works.querySelector('summary').textContent = 'Works with ' + signing.length + ' wallets' + (burnOnly.length ? ', and ' + burnOnly.map((k) => k.name).join(', ') + ' by a burn' : '') + ' — see which';
      const esc2 = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      works.querySelector('.w-works-list').innerHTML = all.map((k) => '<li><span aria-hidden="true">' + esc2(k.emoji) + '</span> ' + esc2(k.name) + (k.burn ? ' <small>· by Burn Verification</small>' : k.chain ? ' <small>· ships Robinhood Chain</small>' : '') + '</li>').join('');
      works.hidden = false;
    }
    segLogin.addEventListener('click', () => setRegMode(false));
    /* Where INVITE_REQUIRED=1 asks for a ticket, choosing Create account is the moment it is needed, so that is where it
       appears — before anyone fills in a form that was always going to be refused at the end of it. Someone who already
       holds a ticket never sees it, and nobody does on open sign-up (the pass is always there). */
    segSignup.addEventListener('click', async () => {
      setRegMode(true);
      if (joinTrusted) return;   // the site opened this to make an account (startJoin read the pass, or the ticket handed over): no bounce back
      const g = await gate(true);
      if (!g.signedIn && !g.access) { closeModal(); openInvite(); }
    });
    setRegMode(false);   // Sign in until the dialog is opened to make an account

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

    /* A sign-up whose email already belongs to another account still makes the account (refusing it told anyone
       with a ticket who is a member): the password is kept, the email is not. Say so plainly, and long enough to read. */
    const emailNotAddedMsg = (u) => 'That email is already on another account, so it wasn’t added. You sign in with @' + u + ' and your password — set a different email any time in Settings → Security.';
    function loginSuccess(j, opts) {
      if (window.SFX) SFX.play('success');
      if (j.emailNotAdded) sendToast('Welcome, @' + j.username + '! 🚀 ' + emailNotAddedMsg(j.username), 9000);
      else sendToast('Welcome, @' + j.username + '! 🚀');
      if (window.sendConfetti) sendConfetti(innerWidth / 2, innerHeight / 3, { count: 50, emojiRatio: 0.4 });
      closeModal();
      if (j.newAccount && opts && opts.setup2fa) { goSetup2fa(); return; }
      refresh().then(onAuthChange);
    }
    /* "Set up two-factor right after": the profile's Security card does it, and a brand-new account's own
       session is unlocked for its setup, so nothing there asks for the password it just chose. Remember
       where they were so the card can offer the way back. */
    function goSetup2fa() {
      const onProfile = /^\/profile(\.html)?\/?$/.test(location.pathname);   // /profile (or an old /profile.html on its way there)
      try {
        sessionStorage.setItem('jsi:setup-2fa', '1');
        if (!onProfile && /^\/(?![\/\\])/.test(location.pathname)) sessionStorage.setItem('jsi:after-2fa', location.pathname + location.search + location.hash);
      } catch {}
      if (onProfile) { location.hash = '#sec-security'; location.reload(); return; }   // same document: a hash change alone would not sign the page in
      location.href = '/profile#sec-security';
    }

    function show2fa(j) {
      // the ways in step aside for the challenge, in the same card (its headings first: the step shows the line under the title only when it has words)
      heads[0].textContent = 'Almost in 🔐';
      heads[1].textContent = 'One more check to finish signing in.';
      showStep('2fa');
      modal.querySelector('#twofa-totp').hidden = j.twofa !== 'totp';
      modal.querySelector('#twofa-wallet').hidden = j.twofa !== 'wallet';
      modal.querySelector('#twofa-password').hidden = j.twofa !== 'password';
      const status = modal.querySelector('#twofa-status');
      setStatus(status, '');
      if (j.twofa === 'password') {
        const input = modal.querySelector('#f-2fa-pw');
        input.value = ''; input.focus();
        modal.querySelector('#pw2fa-submit').onclick = async () => {
          setStatus(status, '…');
          try {
            const r = await api('/api/auth/login/password2fa', { method: 'POST', body: { pending: j.pending, password: input.value } });
            loginSuccess(r);
          } catch (err) { setStatus(status, '⚠️ ' + err.message, true); }
        };
        input.onkeydown = ev => { if (ev.key === 'Enter') modal.querySelector('#pw2fa-submit').click(); };
      } else if (j.twofa === 'totp') {
        const input = modal.querySelector('#f-totp');
        input.value = '';
        input.focus();
        modal.querySelector('#totp-submit').onclick = async () => {
          setStatus(status, '…');
          try {
            const r = await api('/api/auth/login/totp', { method: 'POST', body: { pending: j.pending, code: input.value.trim() } });
            loginSuccess(r);
          } catch (err) { setStatus(status, '⚠️ ' + err.message, true); }
        };
        input.onkeydown = ev => { if (ev.key === 'Enter') modal.querySelector('#totp-submit').click(); };
      } else {
        modal.querySelector('#wallet2fa-submit').focus();   // the step's one control: the ways in that had the focus are hidden now
        modal.querySelector('#wallet2fa-submit').onclick = async () => {
          try {
            status.textContent = 'Choose your wallet… 👛';
            const { provider, address } = await WALLET.connect({ choose: true });
            // Ask for the challenge for THIS wallet only. The server used to hand back a challenge for
            // every linked wallet the moment the password was right, which told anyone with the password
            // exactly which on-chain addresses belong to this account — the one thing wallet two-factor
            // is there to keep out of their hands. Each message names its own address, as EIP-4361 requires.
            const ch = await api('/api/auth/login/wallet2fa/challenge', { method: 'POST', body: { pending: j.pending, address } });
            const msg = ch && ch.message;
            if (!msg) throw new Error('that wallet isn’t linked to this account — connect the one you turned two-factor on with');
            status.textContent = 'Approve the signature… ✍️';
            const signature = await WALLET.sign(provider, address, msg);
            const r = await api('/api/auth/login/wallet2fa', { method: 'POST', body: { pending: j.pending, address, signature } });
            loginSuccess(r);
          } catch (err) { status.textContent = (err.message === 'cancelled') ? '' : '⚠️ ' + (err.message || 'cancelled'); if (window.SFX && err.message !== 'cancelled') SFX.play('error'); }
        };
      }
    }
    // show2fa lives in this DOMContentLoaded closure; the OAuth pickup at the bottom of the file runs
    // outside it, so expose it the same way _reset2fa is exposed
    AUTH._show2fa = show2fa;
    // back to the ways in, with the dialog's own headings (confirm mode and two-factor rewrite them)
    AUTH._reset2fa = function () {
      modal.classList.remove('is-confirm');
      heads.forEach((el, i) => { el.textContent = headText[i]; });
      showStep('choose');
    };

    /* The same masked pane, in a CONFIRM mode. A credential change made elsewhere (linking a wallet,
       changing two-factor) has to prove the current factor first, and that used to be a native prompt(),
       which shows a password or a code in clear text. Resolves to the field the server expects, or
       rejects 'cancelled' when the dialog is closed with no answer (see closeModal). */
    AUTH._confirmFactor = function (mode, note) {
      return new Promise((resolve, reject) => {
        openModal();                        // resets the panes and the headings; this then restyles them
        modal.classList.add('is-confirm');  // the ticket can be what asked, and it stacks above this card
        const pw = mode === 'password';
        heads[0].textContent = 'Confirm it’s you 🔐';
        heads[1].textContent = note || 'Confirm this change';
        heads[pw ? 2 : 3].textContent = pw ? '🔐 Enter your account password to confirm.' : '🔐 Enter the 6-digit code from your authenticator app to confirm.';
        showStep('2fa');   // without the ways in, or "got a code?" — that is not a question for someone already in
        modal.querySelector('#twofa-totp').hidden = pw;
        modal.querySelector('#twofa-wallet').hidden = true;
        modal.querySelector('#twofa-password').hidden = !pw;
        const status = modal.querySelector('#twofa-status');
        setStatus(status, '');
        const input = modal.querySelector(pw ? '#f-2fa-pw' : '#f-totp'), btn = modal.querySelector(pw ? '#pw2fa-submit' : '#totp-submit');
        input.value = ''; input.focus();
        confirmReject = reject;
        btn.onclick = () => {
          const v = input.value;
          if (!v.trim()) { setStatus(status, pw ? 'Enter your password to confirm.' : 'Enter the 6-digit code to confirm.', true); return; }
          input.value = '';                 // a secret does not sit in a hidden field afterwards
          confirmReject = null;             // answered — closing must not read as a cancel
          closeModal();
          resolve(pw ? { password: v } : { code: v.trim() });
        };
        input.onkeydown = ev => { if (ev.key === 'Enter') btn.click(); };
      });
    };

    /* ═══ "Confirm it's you" — once, then change what you like ═══════════════════════════════════════
       One pane for every security change: the password when the account has one, the authenticator code
       or the two-factor wallet's signature when two-factor is on — together, in one go. The server then
       unlocks this session for a while (me.verifyNeeds.minutes), and the settings stop asking. */
    AUTH._confirmIt = async function (note) {
      try { const fresh = AUTH._normMe((await api('/api/me', { _verified: true })).user); if (fresh) AUTH.user = Object.assign(AUTH.user || {}, fresh); } catch {}
      if (AUTH.user && AUTH.user.sudoUntil && AUTH.user.sudoUntil > Date.now() + 5000) return {};   // unlocked meanwhile (another tab)
      return new Promise((resolve, reject) => {
        let need = (AUTH.user && AUTH.user.verifyNeeds) || { password: (AUTH.user && (AUTH.user.methods || []).some(m => m === 'email' || m === 'password')), code: AUTH.user && AUTH.user.twofa === 'totp', wallet: null, minutes: 30 };
        openModal();
        modal.classList.add('is-confirm');
        heads[0].textContent = 'Confirm it’s you 🔐';
        heads[1].textContent = 'Once — then every security setting on this device is unlocked for ' + (need.minutes || 30) + ' minutes.';
        showStep('confirm');
        const q = (id) => modal.querySelector('#' + id);
        const reason = String(note || '').replace(/^.*?confirm it’s you first\s*[—-]?\s*/i, '');
        q('cf-lead').textContent = reason && !/^to\s/i.test(note || '') ? reason.charAt(0).toUpperCase() + reason.slice(1) + (/[.!?]$/.test(reason) ? '' : '.') : 'This change needs you to confirm it’s you.';
        const rows = () => {
          q('cf-pw-row').hidden = !need.password;
          q('cf-code-row').hidden = !need.code;
          q('cf-wallet-row').hidden = !need.wallet;
          q('cf-again-row').hidden = !need.signInAgain;
          q('cf-go').hidden = !need.password && !need.code && !need.wallet;   // "sign in again" is its own button
          q('cf-wallet-note').textContent = need.wallet === 'twofa' ? 'Sign with your two-factor wallet.' : 'Sign with the wallet you created this account with (or one linked more than a day ago).';
        };
        rows();
        q('cf-wallet').textContent = 'Sign with wallet 🦊';
        let signed = null;
        const status = q('cf-status');
        setStatus(status, '');
        q('cf-pw').value = ''; q('cf-code').value = '';
        const first = need.password ? q('cf-pw') : need.code ? q('cf-code') : need.wallet ? q('cf-wallet') : q('cf-signout');
        try { first.focus(); } catch {}
        confirmReject = reject;
        q('cf-signout').onclick = async () => {
          confirmReject = null; closeModal(); reject(new Error('cancelled'));
          // asked for by the burn proof? It steps aside (the sign-in would open under it) and comes back once they are in
          if (window.BURNPROOF && BURNPROOF.isOpen()) { try { sessionStorage.setItem('jsi:burnproof', String(Date.now())); } catch {} BURNPROOF.close(); }
          await AUTH.logout(); openModal();
        };
        q('cf-wallet').onclick = async () => {
          try {
            setStatus(status, 'Choose the wallet… 👛');
            const { provider, address } = await WALLET.connect({ choose: true });
            const { message } = await api('/api/auth/wallet/nonce?purpose=manage&address=' + address);
            setStatus(status, 'Approve the signature… ✍️');
            const signature = await WALLET.sign(provider, address, message);
            signed = { address, signature };
            if (window.SFX) SFX.play('connect');
            q('cf-wallet').textContent = 'Signed ✅ ' + address.slice(0, 6) + '…' + address.slice(-4);
            setStatus(status, '');
            if (!need.password && !need.code) q('cf-go').click();   // nothing else to fill in
          } catch (err) { setStatus(status, err.message === 'cancelled' ? '' : '⚠️ ' + (err.message || 'cancelled'), err.message !== 'cancelled'); }
        };
        q('cf-go').onclick = async () => {
          const body = {};
          if (need.password) { body.password = q('cf-pw').value; if (!body.password) { setStatus(status, 'Enter your password.', true); q('cf-pw').focus(); return; } }
          if (need.code) { body.code = q('cf-code').value.trim(); if (!/^\d{6}$/.test(body.code)) { setStatus(status, 'Enter the 6-digit code from your app.', true); q('cf-code').focus(); return; } }
          if (need.wallet) { if (!signed) { setStatus(status, 'Sign with your wallet first.', true); return; } Object.assign(body, signed); }
          setStatus(status, 'Checking… 🔐');
          try {
            const j = await api('/api/auth/verify', { method: 'POST', body, _verified: true });
            if (AUTH.user) AUTH.user.sudoUntil = Date.now() + (j.sudoLeftMs || 0) - 1500;
            q('cf-pw').value = ''; q('cf-code').value = '';
            if (window.SFX) SFX.play('success');
            confirmReject = null;
            closeModal();
            document.dispatchEvent(new CustomEvent('auth:sudo', { detail: { until: j.sudoUntil } }));
            resolve({});
          } catch (err) {
            // the server says what the step needs now — another device may have turned two-factor on meanwhile
            if (err.verifyNeeds) { need = err.verifyNeeds; if (AUTH.user) AUTH.user.verifyNeeds = need; rows(); }
            q('cf-code').value = '';                 // a code is single-use; a wrong one is spent anyway
            if (need.wallet) { signed = null; q('cf-wallet').textContent = 'Sign with wallet 🦊'; }   // so is a signature
            setStatus(status, '⚠️ ' + err.message, true);
          }
        };
        for (const id of ['cf-pw', 'cf-code']) q(id).onkeydown = ev => { if (ev.key === 'Enter') q('cf-go').click(); };
      });
    };

    /* An error is said beside the button that was pressed, and the focus goes to the field it is about (its fold opened),
       so it is never below the fold unseen. Which field: the check's own, or read from the refusal's words. */
    const NAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/, EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    const fErr = (msg, field) => Object.assign(new Error(msg), { field });
    const fieldOf = (msg, ids) => /username|@/i.test(msg) ? ids.user : /email/i.test(msg) ? ids.email : /passwords? don|match/i.test(msg) ? ids.pw2 : /password|credentials/i.test(msg) ? ids.pw : null;
    function fieldFail(status, msg, field, fallback) {
      setStatus(status, '⚠️ ' + msg, true);
      const pane = status.closest('.auth-step') || modal;
      pane.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
      const f = field && q('#' + field);
      const fold = f && f.closest('details'); if (fold) fold.open = true;
      if (f && !f.closest('[hidden]')) { f.setAttribute('aria-invalid', 'true'); f.focus(); }
      else if (fallback) fallback.focus();
      try { status.scrollIntoView({ block: 'nearest' }); } catch {}
    }

    q('#email-form').addEventListener('submit', async e => {
      e.preventDefault();
      if (emailBusy) return;
      const status = q('#email-status');
      const v = { username: q('#f-username').value.trim(), email: q('#f-email').value.trim(), pw: q('#f-password').value, pw2: q('#f-password2').value };
      try {
        // checked here first: a typo is said beside the button, on its field, before anything is sent
        if (regMode) {
          if (!NAME_RE.test(v.username)) throw fErr('pick a @username: 3–24 letters, numbers, _ . -', 'f-username');
          if (!EMAIL_RE.test(v.email)) throw fErr('enter a valid email — with your password, it’s how you sign in', 'f-email');
          if (v.pw.length < 8) throw fErr('the password needs at least 8 characters', 'f-password');
          if (v.pw !== v.pw2) throw fErr('the two passwords don’t match', 'f-password2');
        } else {
          if (!v.email) throw fErr('enter your email or @username', 'f-email');
          if (!v.pw) throw fErr('enter your password', 'f-password');
        }
        emailBusy = true;
        setStatus(status, regMode ? 'Making your account… ✨' : 'Signing in…');
        const body = regMode ? { username: v.username, email: v.email, password: v.pw } : { identifier: v.email, password: v.pw };
        const j = await api(regMode ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body });
        setStatus(status, '');
        if (j.twofa) { show2fa(j); return; }
        loginSuccess(j, { setup2fa: regMode && q('#f-2fa').checked });
      } catch (err) {
        // "you need a ticket" is not an error to read, it is a door to open
        if (AUTH.needsInvite(err)) { setStatus(status, ''); closeModal(); return; }
        const msg = (err && err.message) || 'that didn’t work — try again';
        fieldFail(status, msg, err.field || fieldOf(msg, { user: regMode ? 'f-username' : 'f-email', email: 'f-email', pw: 'f-password', pw2: 'f-password2' }), q('#email-submit'));
      } finally { emailBusy = false; }
    });

    /* ═══ the wallet: connect first, then — for a new wallet only — the @username ══════════════════════════
       Continue with wallet connects and signs before anything is asked. A wallet with an account is signed in (with its
       second factor, when it has one). A wallet the site has never seen comes back as needUsername with a short-lived,
       single-use token that carries its proof, and the name step names the account with no second signature. A sign-up
       that brought its @username with it (the ticket's last step) runs the other way round: the name step first, then one
       press that connects, signs and makes the account. Either way: one picker, one signature. The name step can add an
       email + password as a second way in, and offer two-factor straight after; both optional. */
    const wBtn = q('#btn-wallet-signin'), wForm = q('#w-form'), wCreate = q('#w-create');
    let wSignupBusy = false;
    // the name step says where it stands: a wallet connected and proved (the press only names it), or none yet
    function paintWalletStep() {
      const proved = !!pendingSignup;
      q('#w-connected').hidden = !proved;
      const addr = q('#w-addr');
      addr.textContent = proved ? pendingAddr.slice(0, 6) + '…' + pendingAddr.slice(-4) : '';
      if (proved) addr.title = pendingAddr; else addr.removeAttribute('title');
      q('#w-name-lead').textContent = proved
        ? 'No account for this wallet yet. Pick your @username and you’re in — there’s nothing else to sign.'
        : 'Pick your @username, then connect your wallet and sign one free message — no transaction, no gas.';
      wCreate.textContent = proved ? 'Create my account ✨' : 'Connect wallet & create account 🦊';
      wCreate.setAttribute('data-tip', proved ? 'Makes your account with this @username — nothing else to sign' : 'Connects your wallet, asks it to sign a free message, and makes your account with this @username');
    }
    // a fresh dialog: no proof waiting, no old lines, the opt-ins unticked (openSignup ticks what the ticket asked for, after this)
    function resetWallet() {
      wRun++; pendingSignup = null; pendingAddr = '';
      paintWalletStep();
      for (const id of ['wallet-status', 'w-create-status']) setStatus(q('#' + id), '');
      for (const id of ['w-username', 'w-email', 'w-pw', 'w-pw2']) q('#' + id).removeAttribute('aria-invalid');
      q('#w-2fa').checked = false; q('#f-2fa').checked = false;
      q('#w-extra').open = false;
    }
    AUTH._resetModes = () => { setRegMode(false); joinTrusted = false; resetWallet(); if (AUTH._burnMode) AUTH._burnMode(true); };
    paintWalletStep();

    // the same live availability check as the email form, for the name step's @username
    let wUnameTimer;
    q('#w-username').addEventListener('input', e => {
      clearTimeout(wUnameTimer);
      const v = e.target.value.trim();
      const el = q('#w-uname-status');
      if (!v) { el.textContent = ''; return; }
      wUnameTimer = setTimeout(async () => {
        try {
          const j = await api('/api/username-check?u=' + encodeURIComponent(v));
          el.textContent = j.available ? '✅ available' : ('❌ ' + (j.reason || 'taken — try another'));
          el.style.color = j.available ? 'var(--green-bright)' : 'var(--red)';
        } catch {}
      }, 300);
    });

    // what the name step asks for, checked here so a typo never costs a wallet signature
    async function walletSignupFields() {
      const username = q('#w-username').value.trim();
      const email = q('#w-email').value.trim();
      const pw = q('#w-pw').value, pw2 = q('#w-pw2').value;
      if (!NAME_RE.test(username)) throw fErr('pick a @username first: 3–24 letters, numbers, _ . -', 'w-username');
      if (email || pw || pw2) {
        if (!EMAIL_RE.test(email)) throw fErr('enter a valid email — or leave the email and password both empty', 'w-email');
        if (pw.length < 8) throw fErr('the password needs at least 8 characters', 'w-pw');
        if (pw !== pw2) throw fErr('the two passwords don’t match', 'w-pw2');
      }
      const chk = await api('/api/username-check?u=' + encodeURIComponent(username));
      if (!chk.available) throw fErr('@' + username + ' is ' + (chk.reason || 'taken') + ' — pick another', 'w-username');
      const out = { username };
      if (email) { out.email = email; out.password = pw; }
      return out;
    }

    function walletDone(j, setup2fa) {
      closeModal();
      if (j.linked && window.SFX) SFX.play('connect');
      if (!j.linked && window.SFX) SFX.play('success');
      if (j.alreadyLinked) { refresh().then(onAuthChange); sendToast('That wallet is already linked to @' + j.username + ' ✅'); return; }
      if (j.linked) { refresh().then(onAuthChange); sendToast('Wallet linked to @' + j.username + ' 🔗'); return; }
      if (j.newAccount && setup2fa) { sendToast('Welcome, @' + j.username + '! Now the optional extra lock 🔐'); goSetup2fa(); return; }
      if (j.newAccount && !j.named) {
        // the old one-step path (a caller that sent no name): the account has a placeholder name to change
        try { if (/^\/(?![\/\\])/.test(location.pathname) && !/^\/profile(\.html)?\/?$/.test(location.pathname)) sessionStorage.setItem('jsi:after-claim', location.pathname + location.search + location.hash); } catch {}
        sendToast('Welcome! Pick your unique handle 👇'); location.href = '/profile#claim'; return;
      }
      if (j.newAccount && j.emailNotAdded) sendToast('Welcome, @' + j.username + '! 🚀 ' + emailNotAddedMsg(j.username), 9000);
      else sendToast(j.newAccount ? 'Welcome, @' + j.username + '! 🚀' : 'Welcome back, @' + j.username + '! 🚀');
      if (window.sendConfetti) sendConfetti(innerWidth / 2, innerHeight / 3, { count: 50, emojiRatio: 0.4 });
      refresh().then(onAuthChange);
    }

    /* The one wallet sign-in: connect, sign the read-only message, and do what the server says it was. Back, a reset or a
       newer press while the wallet is still answering supersedes it (wRun): a late answer then changes nothing on screen
       — except a session the server has already made, which is never left unshown. */
    async function walletProve(status, fields, setup2fa) {
      const run = ++wRun;
      const moved = () => run !== wRun;
      try {
        setStatus(status, 'Choose your wallet… 👛');
        const { provider, address } = await WALLET.connect({ burn: true });
        if (moved()) return;
        setStatus(status, 'Approve the signature in your wallet… ✍️');
        const { message } = await api('/api/auth/wallet/nonce?purpose=signin&address=' + address);
        const signature = await WALLET.sign(provider, address, message, { burn: true });
        if (moved()) return;
        const body = Object.assign({ address, signature, intent: fields ? 'signup' : 'signin' }, fields || {});
        const j = await api('/api/auth/wallet/verify', { method: 'POST', body });
        if (!j.ok && moved()) return;   // a two-factor challenge or a name to pick that nobody is waiting for any more
        setStatus(status, '');
        if (j.twofa) { show2fa(j); return; }   // an authenticator or a password is this account's second factor: the wallet was only the first
        if (j.needUsername) {
          // a wallet with no account yet: its proof waits (ten minutes, once) while they pick the name — nothing else to sign
          pendingSignup = j.signup; pendingAddr = address;
          if (window.SFX) SFX.play('connect');
          paintWalletStep();
          showStep('wallet');
          const u = q('#w-username'); u.focus(); if (u.value) u.select();
          return;
        }
        walletDone(Object.assign({ named: !!(fields && fields.username) }, j), setup2fa);
      } catch (err) {
        if (moved()) return;   // a cancel or a refusal of an attempt already left behind is not this one's to report
        throw err;
      }
    }

    // Continue with wallet: nothing asked first. A returning wallet is signed in; a new one goes on to the name step.
    wBtn.addEventListener('click', async () => {
      const status = q('#wallet-status');
      try { await walletProve(status, null, false); }
      catch (err) {
        /* A wallet nobody has signed in with is a NEW ACCOUNT, so where INVITE_REQUIRED=1 the server asks for the ticket
           here: somebody who connected expecting to sign in gets the door, not a refusal. */
        if (AUTH.needsInvite(err)) { setStatus(status, ''); closeModal(); return; }
        // a closed picker or a declined signature is no error: they are back where they were, the button ready again
        setStatus(status, err.message === 'cancelled' ? '' : '⚠️ ' + (err.message || 'that didn’t work — try again'), err.message !== 'cancelled');
      }
    });

    // Create my account: the name (and the optional extras), then the account — by the proof waiting, or by one signature
    wForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (wSignupBusy) return;
      const status = q('#w-create-status');
      const setup2fa = q('#w-2fa').checked;
      try {
        setStatus(status, 'Checking your name…');
        const fields = await walletSignupFields();
        if (pendingSignup) {
          // the wallet proved itself a moment ago: this only names the account
          wSignupBusy = true;
          setStatus(status, 'Creating your account… ✨');
          const j = await api('/api/auth/wallet/signup', { method: 'POST', body: Object.assign({ signup: pendingSignup }, fields) });
          pendingSignup = null;
          setStatus(status, '');
          walletDone(Object.assign({ named: true }, j), setup2fa);
          return;
        }
        /* No proof yet: the name came first (the ticket's last step), or the proof expired. A fresh read of the pass first —
           a cached answer from before a ticket was redeemed once closed this dialog onto the homepage and reopened the
           ticket, and the signature never started — then one picker and one signature make the account with this name. */
        const g = await gate(true);
        if (!g.signedIn && !g.access) {
          setStatus(status, '');
          closeModal();
          openInvite({ then: () => AUTH.openSignup({ tab: 'wallet', fromTicket: true, username: fields.username }) });
          return;
        }
        await walletProve(status, fields, setup2fa);
      } catch (err) {
        if (AUTH.needsInvite(err)) { setStatus(status, ''); closeModal(); return; }
        // the proof behind the name step expired (ten minutes) or was spent: start again from the wallet, the name kept
        if (err.status === 401 && pendingSignup) {
          pendingSignup = null; pendingAddr = ''; paintWalletStep();
          setStatus(status, '⚠️ That wallet connection expired. Press the button to connect your wallet again — your name is kept.', true);
          wCreate.focus();
          return;
        }
        if (err.message === 'cancelled') { setStatus(status, ''); return; }
        const msg = err.message || 'that didn’t work — try again';
        fieldFail(status, msg, err.field || fieldOf(msg, { user: 'w-username', email: 'w-email', pw: 'w-pw', pw2: 'w-pw2' }), wCreate);
      } finally { wSignupBusy = false; }
    });

    /* An OAuth round trip that was refused for want of an invite comes back as ?needinvite=1 (the
       provider redirect is the only way that refusal can reach the page). Open the ticket and tidy the
       URL, so a reload does not re-trigger it. */
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('needage') === '1') {
        if (window.AGE) AGE.reopen();
        q.delete('needage'); q.delete('autherror'); q.delete('autherrmsg');
        const rest = q.toString();
        history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
      } else if (q.get('needinvite') === '1' || q.get('invite') === '1') {
        // the order is: loading screen, the 18+ question, THEN the ticket — never the ticket over either
        if (window.AGE && AGE.needed) AGE.whenOk(openInvite); else openInvite();
        q.delete('needinvite'); q.delete('invite'); q.delete('autherror'); q.delete('autherrmsg');
        const rest = q.toString();
        history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
      }
    } catch {}
  });

  /* Proving the CURRENT second factor, for any page that needs to make a credential change. This lived in
     profile.js, which meant only the profile page could link a wallet; the How-to-Buy guide needs it too,
     and two copies of a security check is one copy too many. Returns the body fields the server expects,
     or throws 'cancelled'. */
  /* Unlock security changes on this session: resolves at once when it already is (a fresh sign-in, a new
     account's setup, or a confirm inside the last while), otherwise opens "Confirm it's you" once. Resolves
     to {} — the server remembers the unlock, so there is nothing to attach to the request. Throws
     'cancelled' if the pane is closed. opts.force: the server just said the window is shut, so ask anyway. */
  AUTH.stepUp = async function (note, opts) {
    if (!AUTH.user) throw new Error('sign in first');
    if (!(opts && opts.force) && AUTH.user.sudoUntil && AUTH.user.sudoUntil > Date.now() + 5000) return {};
    if (!AUTH._confirmIt) throw new Error('cancelled');   // the pane is built on DOMContentLoaded
    return AUTH._confirmIt(note);
  };
  AUTH.lockSecurity = async function () {
    const j = await api('/api/auth/verify', { method: 'DELETE' });
    if (AUTH.user) AUTH.user.sudoUntil = null;
    if (window.SFX) SFX.play('off');
    document.dispatchEvent(new CustomEvent('auth:sudo', { detail: { until: null } }));
    return j;
  };
  /* Both older names now mean "confirm it's you, once": the proof used to be collected per change and sent
     with it, and several settings never collected it at all. */
  AUTH.currentFactor = function (note) { return AUTH.stepUp(note); };

  AUTH.ownershipProof = function (note) { return AUTH.stepUp(note); };

  /* Link another wallet to the account you are already signed in to. Read-only: one personal_sign, no
     transaction, no approval. Resolves to the server's answer so a caller can tell linked from
     already-linked; throws with the server's own message on a refusal (wallet cap, wallet owned by
     another account, second factor not proven). */
  AUTH.linkWallet = async function (note) {
    /* A wallet is a way in, so linking one takes "confirm it's you" — asked BEFORE the new wallet signs,
       because the server spends that signature first. Every account, the first wallet included: a social-login
       account confirms by signing in again. Inside the unlocked window (a new account's setup, or a recent
       confirm) this resolves at once. */
    const current = await AUTH.stepUp(note || 'Linking a wallet adds a new way to sign in to this account.');
    const { provider, address } = await WALLET.connect({ burn: true });
    const { message } = await api('/api/auth/wallet/nonce?purpose=link&address=' + address);
    const signature = await WALLET.sign(provider, address, message, { burn: true });
    const j = await api('/api/auth/wallet/verify', { method: 'POST', body: { address, signature, current } });
    if (j.linked) { await refresh(); onAuthChange(); }
    if (j.linked && window.SFX) SFX.play('connect');
    return j;
  };

  /* ═══ ONE WAY TO CONNECT A WALLET, FROM ANYWHERE ═══════════════════════════════════════════════
     Every control on this site that says "Connect a wallet" now calls this and connects a wallet.

     They did not before, and they disagreed with each other about what the words meant. /about's two
     buttons opened the sign-in panel and left the reader to find the wallet tab themselves. index.html's
     button branched on sign-in state. Only the profile page actually connected anything. A button whose
     label is a verb has to do the verb.

     Signed IN, it links the wallet to the account you are already in — no modal, no detour, straight to
     the wallet picker. Signed OUT, it opens the panel already running the wallet sign-in, so the picker
     is the next thing the reader sees rather than something to go hunting for. The signed-out path goes
     through the modal ON PURPOSE rather than being re-implemented here: that one handler already deals
     with a brand-new account, an address already linked to somebody, an invite the server wants first,
     and an account whose wallet is only its FIRST factor. Re-implementing that outside the modal would
     be a second copy of the hardest flow on the site, and the two would drift. */
  AUTH.connectWallet = async function (opts) {
    opts = opts || {};
    if (AUTH.user) return AUTH.linkWallet(opts.note);
    openModal();                              // always on the ways in, whatever a previous visit left showing
    const go = modal.querySelector('#btn-wallet-signin');
    if (go) go.click();                       // the picker opens itself; the panel is only here to host it
    return null;
  };

  AUTH.logout = async function () {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    AUTH.user = null;
    try { localStorage.removeItem('site-prefs'); } catch {}
    try { sessionStorage.removeItem('jsi:after-claim'); } catch {} // a claim stash must not survive into someone else's session
    try { if (window.WALLET) WALLET.forget(); } catch {} // also drop the client's remembered wallet connection on sign-out
    if (window.applySitePrefs) applySitePrefs({ siteAccent: '', confetti: true, ticker: true, musicResume: true }, false);
    if (window.SFX) SFX.play('off');
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
    if (window.SFX) SFX.play('remove');
    return j;
  };

  /* The identity in the nav pill: the person's own picture when they have uploaded one, their emoji
     when they have not, then the handle. The picture is decorative (alt="") — the handle is the name
     a screen reader gets, and the pill's aria-label already says whose wall it opens. */
  AUTH.navIdentity = function (user) {
    const pic = (user.avatarImg && window.avatarHTML) ? window.avatarHTML(user.avatarImg, 'pl-img') : '';
    const face = pic ? '<span class="pl-ava" aria-hidden="true">' + pic + '</span>' : '<span class="pl-ava pl-ava-emo" aria-hidden="true">' + roEsc(user.avatar || '🚀') + '</span>';
    return face + '<span class="pl-name">@' + roEsc(user.username) + '</span>';
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
    trg.setAttribute('data-tip', 'Opens your own public Send Wall');
    trg.innerHTML = AUTH.navIdentity(user) + ((user.og && window.ogBadge) ? ogBadge(user.og, 'in-link') : '');
    const caret = document.createElement('button');
    caret.type = 'button'; caret.className = 'np-caret-btn'; caret.id = 'nav-profile-caret';
    caret.setAttribute('aria-haspopup', 'true'); caret.setAttribute('aria-expanded', 'false'); caret.setAttribute('aria-controls', 'nav-profile-menu');
    caret.setAttribute('data-tip', 'Opens your account menu');
    caret.setAttribute('aria-label', 'Account menu for @' + user.username);
    caret.innerHTML = '<span class="np-caret" aria-hidden="true">▾</span>';
    const menu = document.createElement('div');
    menu.className = 'nav-profile-menu'; menu.id = 'nav-profile-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
    menu.setAttribute('aria-label', 'Account menu');
    const wall = document.createElement('a');
    wall.className = 'npm-item'; wall.setAttribute('role', 'menuitem'); wall.tabIndex = -1; wall.href = '/u/' + encodeURIComponent(user.username);
    wall.innerHTML = '<span class="npm-ico" aria-hidden="true">🏠</span> My Send Wall';
    const dash = document.createElement('a');
    dash.className = 'npm-item'; dash.setAttribute('role', 'menuitem'); dash.tabIndex = -1; dash.href = '/profile';
    dash.innerHTML = '<span class="npm-ico" aria-hidden="true">📊</span> Dashboard &amp; settings';
    const trk = document.createElement('a');
    trk.className = 'npm-item'; trk.setAttribute('role', 'menuitem'); trk.tabIndex = -1; trk.href = '/tracker';
    trk.innerHTML = '<span class="npm-ico" aria-hidden="true">💼</span> Wallet Tracker';
    const dat = document.createElement('a');
    dat.className = 'npm-item'; dat.setAttribute('role', 'menuitem'); dat.tabIndex = -1; dat.href = '/data';
    dat.innerHTML = '<span class="npm-ico" aria-hidden="true">🔑</span> Data API';
    menu.appendChild(wall); menu.appendChild(dash); menu.appendChild(trk); menu.appendChild(dat);
    if (user.admin) {   // only the admin account is told the page exists; the server 404s it for everyone else
      const adm = document.createElement('a');
      adm.className = 'npm-item'; adm.setAttribute('role', 'menuitem'); adm.tabIndex = -1; adm.href = '/admin';
      adm.innerHTML = '<span class="npm-ico" aria-hidden="true">🛠️</span> Admin';
      menu.appendChild(adm);
    }
    /* WHAT "DISCONNECT" MEANS DEPENDS ON HOW YOU GOT IN.
       With an email or a social login as well, your wallet is one of several ways in, so disconnecting it
       unlinks the wallet and leaves you signed in — you should never have to sign out to drop a wallet.
       With ONLY a wallet, it is the entire account: the server refuses to unlink it ("your wallet is your
       only way to sign in, so disconnecting it would lock you out") and, before this, the menu offered the
       button anyway and let the reader discover that by being refused. Wallet-only now signs you out,
       which is what disconnecting the only key you have actually means. `methods` comes straight from
       /api/me (identityTypes), so this is the server's own answer, not a guess from the shape of the UI. */
    /* Fail SAFE when we do not know. `!(user.methods || []).some(…)` reads an ABSENT methods list as
       "wallet only", which would hide Sign out for every account and turn Disconnect into a logout for
       people who have an email. Wallet-only has to be positively established: a real list, non-empty,
       and nothing in it but wallets. Not knowing means leaving both doors as they were — the server
       still refuses an unlink that would lock somebody out, so the cautious branch is never a trap. */
    const methods = Array.isArray(user.methods) ? user.methods : null;
    const walletOnly = !!methods && methods.length > 0 && !methods.some(m => m !== 'wallet');
    if (user.wallets && user.wallets.length) {
      const sep = document.createElement('div'); sep.className = 'npm-sep'; sep.setAttribute('role', 'separator'); menu.appendChild(sep);
      const disc = document.createElement('button');
      disc.type = 'button'; disc.className = 'npm-item npm-danger'; disc.id = 'npm-disconnect'; disc.setAttribute('role', 'menuitem'); disc.tabIndex = -1;
      disc.innerHTML = '<span class="npm-ico" aria-hidden="true">🔌</span> Disconnect wallet';
      disc.setAttribute('data-tip', walletOnly
        ? 'Signs you out — this wallet is the only way into this account'
        : 'Unlinks your wallet and keeps you signed in — an OG badge comes off too; your Diamond streak only pauses (disconnecting is not selling)');
      let armed = false, armT = null;
      const resetArm = () => { armed = false; if (armT) { clearTimeout(armT); armT = null; } disc.classList.remove('armed'); disc.innerHTML = '<span class="npm-ico" aria-hidden="true">🔌</span> Disconnect wallet'; };
      disc._resetArm = resetArm; // let any menu-close path disarm the two-tap confirm (see setProfileOpen)
      disc.addEventListener('click', async () => {
        if (!armed) {
          armed = true; disc.classList.add('armed');
          if (window.SFX) SFX.play('warn');
          disc.innerHTML = '<span class="npm-ico" aria-hidden="true">⚠️</span> ' + (walletOnly
            ? 'Tap again — this signs you out'
            : (AUTH.user && AUTH.user.og ? 'Tap again — OG badge comes off until you relink' : 'Tap again to confirm'));
          armT = setTimeout(resetArm, 4000); return;
        }
        clearTimeout(armT); armed = false; disc.disabled = true; disc.innerHTML = 'Disconnecting…';
        // the only key you have: disconnecting it IS signing out, so do that rather than be refused
        if (walletOnly) { setProfileOpen(wrap, false); AUTH.logout(); return; }
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
    out.setAttribute('data-tip', 'Ends this session on this device');
    out.addEventListener('click', () => { setProfileOpen(wrap, false); AUTH.logout(); });
    /* A wallet-only account would otherwise show two buttons that do the same thing under different
       names. "Disconnect wallet" is the one that matches what the reader thinks they are doing. */
    if (walletOnly && user.wallets && user.wallets.length) out.hidden = true;
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
    if (window.SFX) SFX.play('scan');
    try {
      const r = await fetch('/api/restriction/redeem', { method: 'POST', credentials: 'same-origin' });
      const j = await r.json();
      if (r.ok && j.lifted) {
        if (window.SFX) SFX.play('success');
        if (window.sendToast) sendToast('🔓 Read-only lifted — now hold your $SEND to clear it for good!');
        await refresh(); onAuthChange(); // restriction cleared → banner drops, probation banner appears
        return;
      }
      if (window.SFX) SFX.play('error');
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
    /* The APPEAL — the route that costs nothing. A permanent mute whose only stated remedy is "buy $1,000
       of $SEND" reads as a price rather than a penalty, so the free option is named first, in the same
       breath, with a real address a real person reads. */
    const appeal = r.appealEmail
      ? ' If you think it\'s a mistake, <b>appeal it</b> — email <a href="mailto:' + roEsc(r.appealEmail) + '?subject=' + encodeURIComponent('Read-only appeal') + '">' + roEsc(r.appealEmail) + '</a> and a person will look at your account. That costs nothing.'
      : '';
    const foot = perm
      ? 'This is a permanent restriction after repeated abuse.' + appeal
      : 'This lifts automatically when the timer runs out — just keep it organic. If it happens again after you\'re unpaused, the pause gets longer (a week, then permanent).' + appeal;
    const allowed = (r.allowed || []).map(a => '<li>' + roEsc(a) + '</li>').join('');
    const blocked = (r.blocked || []).map(a => '<li>' + roEsc(a) + '</li>').join('');
    const redeemHtml = r.redeemable
      ? '<div class="ro-redeem">' +
          '<p class="ro-redeem-h">🛒 Want back in now? <b>Buy &amp; hold $SEND.</b></p>' +
          '<p class="ro-redeem-t">Buy at least <b>$' + (r.redeemUsd || 25) + '</b> more $SEND (we read it straight from the chain) to lift ' + (perm ? 'your permanent read-only' : 'this') + ' immediately — then <b>keep your $SEND (don’t sell any) for ' + roDur(r.holdMs || 86400000) + '</b> to clear it for good. Sell before then and ' + (perm ? 'the <b>permanent</b> mute returns' : 'read-only comes back, <b>doubled</b>') + '.</p>' +
          '<button class="btn btn-primary btn-sm" id="ro-redeem-btn" type="button" data-tip="Re-checks your wallet on-chain and lifts read-only if it qualifies">🛒 I bought $SEND — lift my read-only</button>' +
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
    resumeBurnProof();
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
        el.className = 'nav-bal'; el.href = '/profile';
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
      badge.className = 'nav-xp'; badge.id = 'nav-xp-badge'; badge.href = '/profile';
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
      b.textContent = 'Sign in 🚪';
      b.setAttribute('data-tip', 'Sign in, or create a free account with a wallet or an email');
      b.addEventListener('click', () => openModal());
      slot.appendChild(b);
    }
  }

  let lastMeStatus = 0;   // a definite 401 from /api/me means the session is gone; anything else is weather
  async function refresh() {
    // { user: null } is the server's word for "no session cookie at all": as definite a sign-out as a 401
    try { AUTH.user = AUTH._normMe((await api('/api/me')).user) || null; lastMeStatus = AUTH.user ? 200 : 401; }
    catch (e) { AUTH.user = null; lastMeStatus = (e && e.status) || 0; }
    AUTH.signedOut = lastMeStatus === 401;   // definitely signed out — not "the server could not be asked just now"
  }
  // re-read /api/me and repaint the nav badge — for anything that changes points or the boost stack out of band
  // (an arcade boost expiring, a cash-out in another tab). Never throws: a failed refresh just leaves the badge.
  AUTH.refresh = async function () {
    const before = AUTH.user;
    await refresh();
    if (!AUTH.user && before) {
      if (lastMeStatus === 401) { onAuthChange(); }     // the session really ended (expired, ended elsewhere): the UI signs out
      else AUTH.user = before;                          // a transient /api/me failure must not sign the UI out
    }
    document.dispatchEvent(new CustomEvent('points:changed'));
  };
  // redraw the nav from AUTH.user — for the moments the identity itself changes (a new picture)
  AUTH.redraw = function () { onAuthChange(); };

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
