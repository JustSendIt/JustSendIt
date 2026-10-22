/* ===== Proving a wallet by a burn — the panel =====
   Owner, 2026-10-20: a wallet that cannot sign a message (GMGN's, or any wallet an app holds for you), or a member who
   would rather not sign, proves the wallet is theirs by sending a dust amount of $SEND — or of ETH (owner, 2026-10-21) —
   from it to the burn address 0x…dEaD within an hour. The server reads the chain and links the wallet when it sees that
   burn, sent by the wallet itself (server.js, "Proving a wallet by a burn" — the rule lives there; this only shows it).
   Each coin has one exact dust figure the server picks for each hour (a few cents' worth at most): a burn the wallet
   makes for any other reason never carries it, so nobody can claim a wallet by keeping a window open on it.

   What this panel never does: build, ask for or send that transaction. It shows the two addresses and a clock, and
   the member makes the burn in their own wallet app. It also never signs anyone in: a burn proves a wallet, not a
   person at the keyboard, so an account that uses it signs in with an email and a password — set here first if the
   account has none.

   Loaded on demand by AUTH.openBurnProof (auth.js), like the ticket. Lives above the ticket (9000) and the wallet
   picker (9100), under the toasts (9200) and "confirm it's you" (9500), which window.api opens over it when asked. */
(function () {
  'use strict';
  if (window.BURNPROOF) return;
  const RESUME_KEY = 'jsi:burnproof';
  const RECENT_MS = 15 * 60e3;   // a window that ended this recently still says how, whichever page asks
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (a) => String(a || '').slice(0, 6) + '…' + String(a || '').slice(-4);
  const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || '').trim());
  const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
  const sfx = (n) => { if (window.SFX) SFX.play(n); };
  const toast = (m, ms) => { if (window.sendToast) sendToast(m, ms); };
  const call = (url, opts) => window.api(url, opts);   // auth.js: opens "confirm it's you" on need_verify and retries once
  const explorer = () => ((window.RH_CHAIN && RH_CHAIN.explorer) || 'https://robinhoodchain.blockscout.com').replace(/\/+$/, '');

  let root = null, body = null, statusEl = null, state = null, fresh = null, deadlineAt = 0, draft = '', drawn = '';
  let pollT = 0, clockT = 0, bgT = 0, lastFocus = null, releaseTrap = null, prevOverflow = '', busy = false, pollErr = false, dismissed = 0;

  function build() {
    root = document.createElement('div');
    root.className = 'bp-overlay';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'bp-title');
    root.innerHTML =
      '<div class="bp-card">' +
        '<button class="bp-x" type="button" aria-label="Close" data-tip="Closes this panel; an hour that is running keeps being checked without it">✕</button>' +
        '<p class="bp-kicker">🔥 No signature needed</p>' +
        '<h2 class="bp-title" id="bp-title" tabindex="-1">Prove a wallet by a burn</h2>' +
        '<div id="bp-body"></div>' +
        '<p class="modal-note bp-status" id="bp-status" role="status" aria-live="polite"></p>' +
      '</div>';
    document.body.appendChild(root);
    body = root.querySelector('#bp-body');
    statusEl = root.querySelector('#bp-status');
    // the backdrop closes it — when the press began there too (a text selection dragged out of the card is not a click outside)
    let downOnRoot = false;
    root.addEventListener('pointerdown', (e) => { downOnRoot = e.target === root; });
    root.addEventListener('click', (e) => { if (e.target === root && downOnRoot) close(); downOnRoot = false; });
    root.querySelector('.bp-x').addEventListener('click', () => close());
    body.addEventListener('click', onClick);
    body.addEventListener('submit', onSubmit);
    body.addEventListener('input', (e) => { if (e.target && e.target.id === 'bp-addr') draft = e.target.value; });
    /* Esc from inside the panel, bubbling: a tooltip's Esc stops in the capture phase before it gets here (tips.js), and
       "confirm it's you" raised over the panel holds the focus, so its Esc never reaches this one. */
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) { e.stopPropagation(); close(); } });
    // ...and with the focus nowhere in particular (on the page), Esc is still the panel's while it is the top layer
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || root.hidden || root.contains(e.target) || document.querySelector('#auth-modal:not([hidden]), .wc-overlay:not([hidden])')) return;
      e.preventDefault(); e.stopImmediatePropagation();   // this Esc is the panel's: the ticket beneath must not close as well
      close();
    });
    document.addEventListener('visibilitychange', () => { if (!root.hidden && document.visibilityState === 'visible') load(); });
  }

  function setStatus(text, bad) { statusEl.textContent = text || ''; statusEl.classList.toggle('is-err', !!bad); if (bad) sfx('error'); }

  /* ---------- what the panel shows, from the server's answer ---------- */
  const intro = () =>
    '<p class="modal-note">For a wallet that can’t sign a message — a <b>GMGN</b> wallet, for one — or when you’d rather not sign. ' +
    'You send <b>a dust amount of $SEND or ETH</b> from that wallet to the burn address — the exact figure this panel gives you, a few cents’ worth at most — and the site sees on Robinhood Chain that the wallet itself sent it.</p>';
  const warnings = () =>
    '<ul class="bp-rules">' +
      '<li>🔥 <b>Whatever you send is destroyed for good</b> — nobody can get it back, us included — and the transaction costs a little ETH for gas (unless your smart wallet’s gas is sponsored).</li>' +
      '<li>🙋 <b>You make the transaction yourself</b>, in your own wallet app. This site never sends it and never asks your wallet to.</li>' +
      '<li>🛑 <b>Only ever to the burn address shown here, and only the amount on your own screen.</b> Anyone who asks you to send somewhere else, or a different or larger amount to prove a wallet, is not us.</li>' +
      '<li>✍️ <b>It has to be the wallet’s own transaction</b>, sent from its own address (or, for $SEND, as its own smart-account UserOperation, even when a bundler carries it). A Safe or multisig run by an owner key, or a send a relayer makes for it outside a UserOperation, doesn’t count — such a wallet can usually sign a message instead.</li>' +
      '<li>⛽ <b>ETH counts only when it goes straight from the wallet to the burn address</b>, in a transaction sent from the wallet’s own address — from any wallet app, GMGN included. ETH that a smart account, a contract, a relayer or a bundler moves for the wallet isn’t traced: a smart-account wallet sends $SEND instead.</li>' +
      '<li>⏳ Inside a day of your last buy, burning more than 2% of the $SEND bag you joined with counts like a sale in the first-day watch — dust doesn’t, and ETH never touches it.</li>' +
    '</ul>';

  function viewSignedOut() {
    return intro() +
      '<p class="modal-note">🔑 <b>A burn can’t sign you in</b>, so this works for an account with an <b>email and a password</b> — that’s how you’ll sign in. Make one, or sign in to yours, and this panel opens again.</p>' +
      '<div class="bp-actions">' +
        '<button class="btn btn-primary" type="button" data-bp="join" data-tip="Opens account creation with an email and a password; this panel comes back once you are in">Create an account ✨</button>' +
        '<button class="btn btn-ghost" type="button" data-bp="signin" data-tip="Opens email and password sign-in; this panel comes back once you are in">I have an account — sign in 🚪</button>' +
      '</div>';
  }

  function viewNeedEmail(s) {
    if (s.passwordOnly) {
      return intro() +
        '<p class="modal-note">🔑 A burn can’t sign you in, so this needs an <b>email</b> on your account as well as its password. Yours has a password but no email yet.</p>' +
        '<form class="bp-form" data-form="email" novalidate>' +
          '<label class="f-label" for="bp-email">Email</label>' +
          '<input class="addr-input" id="bp-email" type="email" autocomplete="email" placeholder="you@example.com">' +
          '<button class="btn btn-primary" type="submit" data-tip="Adds this email to your account so you can sign in with it and your password">Add this email ✉️</button>' +
        '</form>';
    }
    return intro() +
      '<p class="modal-note">🔑 A burn can’t sign you in, so first give your account an <b>email and a password</b> — that’s how you’ll sign in from now on, wallet or not.</p>' +
      '<form class="bp-form" data-form="emailpw" novalidate>' +
        '<label class="f-label" for="bp-email">Email</label>' +
        '<input class="addr-input" id="bp-email" type="email" autocomplete="email" placeholder="you@example.com">' +
        '<label class="f-label" for="bp-pw">Password <span class="f-hint">(8+ characters)</span></label>' +
        '<input class="addr-input" id="bp-pw" type="password" autocomplete="new-password" placeholder="••••••••">' +
        '<label class="f-label" for="bp-pw2">Confirm password</label>' +
        '<input class="addr-input" id="bp-pw2" type="password" autocomplete="new-password" placeholder="••••••••">' +
        '<button class="btn btn-primary" type="submit" data-tip="Adds the email and password to your account, then goes on to the burn">Add email + password 🔐</button>' +
      '</form>';
  }

  function viewStart(s, lead) {
    const full = s.wallets >= s.maxWallets;
    const p = s.proof;
    const value = draft || (p && p.status !== 'linked' && p.address) || '';   // never a wallet that is already on the account
    return (lead || intro()) +
      (full
        ? '<p class="modal-note is-err">⚠️ This account already has ' + esc(s.maxWallets) + ' wallets linked — unlink one in Settings → Security, then come back.</p>'
        : '<form class="bp-form" data-form="start" novalidate>' +
            '<label class="f-label" for="bp-addr">The wallet’s address <span class="f-hint">— copy it from the wallet app, starts with 0x</span></label>' +
            '<input class="addr-input" id="bp-addr" autocomplete="off" spellcheck="false" maxlength="42" placeholder="0x…" value="' + esc(value) + '">' +
            '<ol class="bp-steps">' +
              '<li>Start your hour below.</li>' +
              '<li>In that wallet’s own app, send <b>the exact amount of $SEND or of ETH</b> this panel shows to the burn address it shows — either one.</li>' +
              '<li>The site sees the burn and links the wallet — you can close this, it keeps checking.</li>' +
            '</ol>' +
            warnings() +
            '<button class="btn btn-primary" type="submit" data-tip="Starts the one hour in which the burn from this wallet has to arrive">Start my hour ⏱️</button>' +
          '</form>');
  }

  const readText = (s) => {
    const ch = (s && s.chain) || {};
    if (ch.failing) return '⚠️ The chain isn’t answering right now — the hour waits, and the burn is checked as soon as it answers.';
    if (ch.readAgoMs == null) return '⛓️ Watching the chain…';
    const sec = Math.max(1, Math.round(ch.readAgoMs / 1000));
    return '⛓️ Watching the chain — last read ' + (sec < 120 ? sec + ' s' : Math.round(sec / 60) + ' min') + ' ago.';
  };
  const foreignText = '⚠️ A burn of that amount arrived, but it was sent by another address (an owner key, a relayer, or an app with an allowance) — it doesn’t count. Send one from the wallet itself.';
  const wantText = (p) => 'exactly ' + p.amountText + ' $SEND' + (p.ethAmountText ? ' or exactly ' + p.ethAmountText + ' ETH' : '');
  const seenText = (p) => '⚠️ A burn of ' + p.amountSeen + ' from this wallet arrived — the proof needs ' + wantText(p) + '. Send that; the hour is still running.';

  function viewOpen(s) {
    const p = s.proof;
    const eth = p.ethAmountText;
    return '<p class="modal-note bp-lead">' + (eth
          ? 'Send <b>one</b> of these from <b class="bp-mono">' + esc(short(p.address)) + '</b> to the burn address below: exactly <b class="bp-mono">' + esc(p.amountText) + ' $SEND</b>, or exactly <b class="bp-mono">' + esc(eth) + ' ETH</b>. '
          : 'Send exactly <b class="bp-mono">' + esc(p.amountText) + ' $SEND</b> from <b class="bp-mono">' + esc(short(p.address)) + '</b> to the burn address below. ') +
        '<span id="bp-clock" aria-live="off"></span></p>' +
      '<div class="f-label">The burn address <span class="f-hint">— the recipient, whichever coin you send</span></div>' +
      '<div class="contract-box bp-box"><code>' + esc(s.burnAddress) + '</code>' +
        '<button class="copy-btn" type="button" data-copy="' + esc(s.burnAddress) + '" data-tip="Copies the burn address to paste into your wallet as the recipient">Copy 📋</button></div>' +
      '<div class="f-label">' + (eth ? 'Either this' : 'The') + ' exact amount of $SEND <span class="f-hint">— any other amount doesn’t count</span></div>' +
      '<div class="contract-box bp-box bp-amount"><code>' + esc(p.amountText) + ' $SEND</code>' +
        '<button class="copy-btn" type="button" data-copy="' + esc(p.amountText) + '" data-tip="Copies the exact $SEND amount to paste into your wallet\'s amount field">Copy 📋</button></div>' +
      '<div class="f-label">The coin: $SEND on Robinhood Chain (chain ID ' + esc(s.chainId) + ')</div>' +
      '<div class="contract-box bp-box"><code>' + esc(s.token) + '</code>' +
        '<button class="copy-btn" type="button" data-copy="' + esc(s.token) + '" data-tip="Copies the $SEND contract, to find the right coin in your wallet">Copy 📋</button></div>' +
      (eth
        ? '<div class="f-label">Or this exact amount of ETH <span class="f-hint">— Robinhood Chain’s own coin, the one you pay gas with; any other amount doesn’t count</span></div>' +
          '<div class="contract-box bp-box bp-amount"><code>' + esc(eth) + ' ETH</code>' +
            '<button class="copy-btn" type="button" data-copy="' + esc(eth) + '" data-tip="Copies the exact ETH amount to paste into your wallet\'s amount field">Copy 📋</button></div>'
        : p.ethNone === 'contract'
          ? '<p class="modal-note">This wallet has code on Robinhood Chain (a smart-contract wallet), so this hour takes <b>$SEND</b> only: ETH it sends goes through that code, which the site can’t trace back to it. A smart account counts with $SEND sent as its own ERC-4337 operation; a Safe or multisig transaction that an owner key executes doesn’t count — such a wallet can usually sign a message instead.</p>'
          : p.ethNone === 'busy'
          ? '<p class="modal-note">This wallet sent more than ten transactions in about the two minutes before this hour started — too many for the site to pick an ETH send out among them — so this hour takes <b>$SEND</b> only. Or wait until it is quieter, cancel this and start a new hour.</p>'
          : '<p class="modal-note">This hour started before ETH could be used, so it takes <b>$SEND</b> only. To send ETH instead, cancel it and start a new hour.</p>') +
      '<p class="modal-note">✅ <b>From that wallet itself.</b> A transfer from any other wallet, one an app makes from it with an allowance, or a relayed send doesn’t count. The full address you’re proving: <span class="bp-mono">' + esc(p.address) + '</span></p>' +
      '<p class="modal-note is-err" id="bp-foreign"' + (p.foreignSeen ? '' : ' hidden') + '>' + esc(foreignText) + '</p>' +
      '<p class="modal-note is-err" id="bp-seen"' + (p.amountSeen ? '' : ' hidden') + '>' + (p.amountSeen ? esc(seenText(p)) : '') + '</p>' +
      warnings() +
      '<p class="modal-note" id="bp-read">' + esc(readText(s)) + '</p>' +
      '<div class="bp-actions">' +
        '<button class="btn btn-ghost" type="button" data-bp="close" data-tip="Closes this panel; the hour keeps running and the burn is still checked">Close — keep checking</button>' +
        '<button class="btn btn-ghost" type="button" data-bp="cancel" data-tip="Ends this hour now; nothing is linked">Cancel this proof</button>' +
      '</div>';
  }

  function viewLinked(s) {
    const p = s.proof;
    const tx = p.tx ? '<a href="' + esc(explorer() + '/tx/' + p.tx) + '" target="_blank" rel="noopener nofollow" data-tip="Opens the burn on the chain explorer in a new tab">the burn on the explorer ↗</a>' : '';
    if (!p.tx) return '<p class="modal-note bp-ok">✅ <b>Linked.</b> <span class="bp-mono">' + esc(short(p.address)) + '</span> was linked by its signature while this hour ran, so no burn is needed.</p>' +
      '<div class="bp-actions"><button class="btn btn-primary" type="button" data-bp="close" data-tip="Closes this panel">Done ✅</button></div>';
    return '<p class="modal-note bp-ok">✅ <b>Proved.</b> <span class="bp-mono">' + esc(short(p.address)) + '</span> is linked to your account' + (tx ? ' — see ' + tx : '') + '.</p>' +
      '<p class="modal-note">Its holdings count toward your account from now on, and the $SEND check runs on its own. You sign in with your email and password, as before.</p>' +
      '<div class="bp-actions">' +
        '<button class="btn btn-primary" type="button" data-bp="close" data-tip="Closes this panel">Done ✅</button>' +
        (s.wallets < s.maxWallets ? '<button class="btn btn-ghost" type="button" data-bp="another" data-tip="Starts again for a different wallet">Prove another wallet</button>' : '') +
      '</div>';
  }

  // a window this page watched end, or one that ended a little while ago (reopened, or on another page): say how it went
  const shown = (p) => !!p && p.id !== dismissed && (fresh === p.id || (p.doneAgoMs != null && p.doneAgoMs < RECENT_MS));

  /* Draws the view the answer calls for. A poll that leaves the same view in place does not rebuild it — that would take the
     focus, a half-typed email or a selection away every five seconds — it only refreshes the clock-free lines. */
  function render() {
    if (!root || root.hidden) return;   // a late answer must not draw (or start a clock) in a closed panel; open() draws afresh
    const signedIn = !!(window.AUTH && AUTH.user);
    const s = state, p = s && s.proof;
    const key = !signedIn ? 'out' : !s ? 'wait' : s.needEmail ? 'email:' + (s.passwordOnly ? 1 : 0)
      : (p && p.status === 'open') ? 'open:' + p.id
      : (p && shown(p)) ? p.status + ':' + p.id + ':' + s.wallets : 'start:' + (s.wallets >= s.maxWallets ? 1 : 0);
    if (key === drawn) {
      if (key.startsWith('open:')) {
        const r = root.querySelector('#bp-read'); if (r) r.textContent = readText(s);
        const f = root.querySelector('#bp-foreign'); if (f) f.hidden = !p.foreignSeen;
        const w = root.querySelector('#bp-seen'); if (w) { w.hidden = !p.amountSeen; w.textContent = p.amountSeen ? seenText(p) : ''; }
      }
      return;
    }
    const hadFocus = root.contains(document.activeElement) && document.activeElement !== root.querySelector('.bp-x');
    drawn = key;
    clearInterval(clockT); clockT = 0;
    if (!signedIn) body.innerHTML = viewSignedOut();
    else if (!s) body.innerHTML = '<p class="modal-note">Reading…</p>';
    else if (s.needEmail) body.innerHTML = viewNeedEmail(s);
    else if (p && p.status === 'open') { body.innerHTML = viewOpen(s); startClock(); }
    else if (p && p.status === 'linked' && shown(p)) body.innerHTML = viewLinked(s);
    else {
      // a window that ended without a link says why, above the form that starts the next hour
      let lead = null;
      if (p && shown(p) && p.status === 'expired') lead = '<p class="modal-note is-err">⏱️ ' + esc(cap(p.reason || 'the hour ended without a burn')) + '.</p>';
      if (p && shown(p) && p.status === 'refused') lead = '<p class="modal-note is-err">⚠️ ' + esc(cap(p.reason || 'that burn could not link the wallet')) + '.</p>';
      if (p && shown(p) && p.status === 'cancelled') lead = '<p class="modal-note">Cancelled' + (p.reason && p.reason !== 'you cancelled it' ? ': ' + esc(p.reason) : '') + ' — nothing was linked.</p>';
      body.innerHTML = viewStart(s, lead ? lead + '<p class="modal-note">Starting again opens a new hour for the same wallet — or paste a different one.</p>' : null);
    }
    // the control that held the focus went with the old view: put it somewhere a keyboard can carry on from
    if (hadFocus && !root.contains(document.activeElement)) { const t = root.querySelector('#bp-title'); if (t) t.focus({ preventScroll: true }); }
  }

  function startClock() {
    const draw = () => {
      const e = root.querySelector('#bp-clock'); if (!e) return;
      const left = Math.max(0, deadlineAt - Date.now());
      if (!left) { e.textContent = '⏱️ The hour is up — checking the last blocks before the deadline…'; return; }
      const m = Math.floor(left / 60000), sec = Math.floor((left % 60000) / 1000);
      const at = new Date(deadlineAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      e.textContent = '⏳ ' + m + ':' + String(sec).padStart(2, '0') + ' left — it has to land before ' + at + '.';
    };
    draw();
    clockT = setInterval(() => { if (document.visibilityState === 'visible') draw(); }, 1000);
  }

  /* ---------- talking to the server ---------- */
  function take(j) {
    const before = state && state.proof;
    state = j;
    const p = j && j.proof;
    if (p && p.status === 'open') { deadlineAt = Date.now() + (p.leftMs || 0); fresh = p.id; }
    // the window this page watched just ended: say how, once
    if (before && p && before.id === p.id && before.status === 'open' && p.status !== 'open') onEnded(p);
  }
  function onEnded(p) {
    fresh = p.id;
    if (p.status === 'linked' && !p.tx) {
      // linked by its signature while the hour ran: that door already said so — just repaint what shows the wallets
      if (window.AUTH && AUTH.refresh) AUTH.refresh().then(() => { if (AUTH.redraw) AUTH.redraw(); }).catch(() => {});
      document.dispatchEvent(new CustomEvent('jsi:walletlinked', { detail: { address: p.address, how: 'signature' } }));
    } else if (p.status === 'linked') {
      sfx('powerup');
      toast('🔥 Wallet proved by burn — ' + short(p.address) + ' is linked ✅', 7000);
      if (window.sendConfetti) { try { sendConfetti(innerWidth / 2, innerHeight / 3, { count: 40, emojiRatio: 0.4 }); } catch {} }
      if (window.AUTH && AUTH.refresh) AUTH.refresh().then(() => { if (AUTH.redraw) AUTH.redraw(); }).catch(() => {});
      document.dispatchEvent(new CustomEvent('jsi:walletlinked', { detail: { address: p.address, how: 'burn' } }));
    } else if (p.status === 'expired' || p.status === 'refused') {
      sfx('warn');
      if (root.hidden) toast('🔥 Your burn proof ended without a link: ' + (p.reason || 'the hour ended without the burn') + '. Start again in Settings → Security (Prove one by a burn).', 12000);
    }
  }
  async function load() {
    if (!(window.AUTH && AUTH.user)) { state = null; render(); return; }
    try {
      take(await call('/api/wallet/burnproof'));
      if (pollErr) { pollErr = false; setStatus(''); }   // it answered again: the old error is not true any more
    } catch (e) {
      // said (and sounded) once while the panel is up, not on every poll of an outage
      if (!pollErr && !root.hidden) setStatus('⚠️ ' + cap((e && e.message) || 'could not read where your proof stands'), true);
      pollErr = true;
    }
    if (!root.hidden) render();
    schedule();
  }
  // asked every 5 s while the panel is up and an hour runs; every 30 s behind it (the page can still say "proved")
  function schedule() {
    clearTimeout(pollT); clearTimeout(bgT); pollT = 0; bgT = 0;
    const open = state && state.proof && state.proof.status === 'open';
    if (!open) {
      // the first read failed: there is nothing to show yet, so ask again rather than sit on "Reading…"
      if (!state && pollErr && root && !root.hidden && window.AUTH && AUTH.user) pollT = setTimeout(() => { if (document.visibilityState === 'visible') load(); else schedule(); }, 10000);
      return;
    }
    if (!root.hidden) pollT = setTimeout(() => { if (document.visibilityState === 'visible') load(); else schedule(); }, 5000);
    else bgT = setTimeout(() => { if (document.visibilityState === 'visible') load(); else schedule(); }, 30000);
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const form = e.target.closest('form'); if (!form) return;
    const kind = form.getAttribute('data-form');
    const btn = form.querySelector('button[type=submit]');
    busy = true; if (btn) btn.disabled = true;
    try {
      if (kind === 'start') {
        const address = String(root.querySelector('#bp-addr').value || '').trim();
        if (!isAddr(address)) throw new Error('paste the wallet’s address: 0x followed by 40 letters and numbers');
        setStatus('Starting your hour…');
        take(await call('/api/wallet/burnproof/start', { method: 'POST', body: { address } }));
        draft = '';
        sfx('scan');
        setStatus('');
      } else if (kind === 'emailpw' || kind === 'email') {
        const email = String(root.querySelector('#bp-email').value || '').trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('enter a valid email');
        if (kind === 'emailpw') {
          const pw = root.querySelector('#bp-pw').value, pw2 = root.querySelector('#bp-pw2').value;
          if (pw.length < 8) throw new Error('the password needs at least 8 characters');
          if (pw !== pw2) throw new Error('the two passwords don’t match');
          setStatus('Adding your email and password…');
          await call('/api/account/email', { method: 'POST', body: { email, password: pw } });
          root.querySelector('#bp-pw').value = ''; root.querySelector('#bp-pw2').value = '';
        } else {
          setStatus('Adding your email…');
          await call('/api/account/email/change', { method: 'POST', body: { email } });
        }
        sfx('success');
        toast('✉️ Email added — you sign in with it and your password now.');
        setStatus('');
        if (window.AUTH && AUTH.refresh) { try { await AUTH.refresh(); } catch {} }
        take(await call('/api/wallet/burnproof'));
      }
      render(); schedule();
    } catch (err) {
      if (err && err.message === 'cancelled') setStatus('');
      else if (err && err.code === 'need_email') { setStatus(''); try { take(await call('/api/wallet/burnproof')); } catch {} render(); }
      else setStatus('⚠️ ' + cap((err && err.message) || 'that didn’t work — try again'), true);
    }
    busy = false; if (btn && btn.isConnected) btn.disabled = false;
  }

  async function onClick(e) {
    const b = e.target.closest('[data-bp]'); if (!b) return;
    const what = b.getAttribute('data-bp');
    if (what === 'close') { close(); return; }
    if (what === 'another') { dismissed = (state && state.proof && state.proof.id) || 0; fresh = null; draft = ''; render(); return; }   // the next poll brings the same proof back: it stays dismissed
    if (what === 'join' || what === 'signin') {
      // auth.js opens this again once they are in (a page change included) — if they get in within the next quarter hour
      try { sessionStorage.setItem(RESUME_KEY, String(Date.now())); } catch {}
      close();
      const emailTab = () => { const t = document.querySelector('#auth-modal #tab-email'); if (t) t.click(); };
      if (what === 'join') { if (window.AUTH && AUTH.startJoin) AUTH.startJoin({ tab: 'email', then: emailTab }); }   // `then`: after the ticket, too
      else if (window.AUTH && AUTH.open) { AUTH.open(); emailTab(); }
      return;
    }
    if (what === 'cancel') {
      if (busy) return; busy = true; b.disabled = true;
      try {
        take(await call('/api/wallet/burnproof/cancel', { method: 'POST', body: {} }));
        const p = state && state.proof;
        // only a window the server really called off is "cancelled"; one that had just linked or ended says so instead
        if (p && p.status === 'cancelled') { fresh = p.id; sfx('off'); setStatus(''); } else setStatus('');
        render(); schedule();
      } catch (err) { setStatus('⚠️ ' + cap((err && err.message) || 'could not cancel it'), true); }
      busy = false; if (b.isConnected) b.disabled = false;
    }
  }

  /* ---------- open / close ---------- */
  function open(opts) {
    opts = opts || {};
    if (!root) build();
    if (opts.address && isAddr(opts.address)) draft = opts.address;
    if (root.hidden) {
      lastFocus = document.activeElement;
      prevOverflow = document.body.style.overflow;   // the ticket or a page beneath may hold the scroll lock — hand it back, not ''
      root.hidden = false;
      document.body.style.overflow = 'hidden';
      sfx('open');
      if (releaseTrap) { releaseTrap(); releaseTrap = null; }
      if (window.trapFocus) { try { releaseTrap = window.trapFocus(root.querySelector('.bp-card')); } catch {} }
    }
    setStatus(''); pollErr = false;
    if (!(window.AUTH && AUTH.user)) state = null;
    drawn = '';
    render();
    const x = root.querySelector('.bp-x'); if (x) x.focus();
    load();
  }
  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    clearInterval(clockT); clockT = 0;
    for (const id of ['bp-pw', 'bp-pw2']) { const i = root.querySelector('#' + id); if (i) i.value = ''; }   // a password typed then left must not wait in a hidden field
    document.body.style.overflow = prevOverflow;
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    if (lastFocus && lastFocus.focus && lastFocus.isConnected) { try { lastFocus.focus(); } catch {} }
    sfx('close');
    document.dispatchEvent(new CustomEvent('jsi:burnproofclose'));
    schedule();   // an hour still running keeps being asked about, more slowly
  }

  document.addEventListener('auth:change', () => { if (root && !(window.AUTH && AUTH.user)) { state = null; clearTimeout(pollT); clearTimeout(bgT); if (!root.hidden) render(); } });
  window.BURNPROOF = { open, close, isOpen: () => !!(root && !root.hidden) };
})();
