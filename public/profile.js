/* ===== Profile page: tracker (main), collapsible settings, prefs ===== */
// '#a8ce00' is deliberately absent: it looks identical to Default but derives a different
// bright/dark pair, so the two swatches would look the same and behave differently.
const SITE_ACCENTS = ['', '#00C805', '#ffb340', '#ff5d5d', '#5dc9ff', '#c85dff', '#ff5dd2'];
let chosenAvatar = '🚀';
let myTheme = {};

// attribute-safe HTML escape (also encodes quotes so it's safe inside src="…"/style="…")
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------- pickers ----------
   The wall's look — its colours, pictures and the avatar emoji — is edited with wallstyle.js, the same editor the pop-up on
   your own wall uses (owner, 2026-10-15), so the colour rules and the uploads are written once. What stays here is what is
   only on this page: the Account card's emoji (picked here, saved with Save Changes) and the site colour. */
const wallState = { accent: '', bg: '' };   // the wall's two colours as saved; WallStyle.wallPickers keeps them current
const IMG_KEY = { avatar: 'avatar_img', header: 'header_img', background: 'bg_img' };
function renderAvatarPicker() {
  const pick = (a) => { chosenAvatar = a; document.getElementById('pf-avatar').textContent = a; };
  pick.tip = (a) => 'Uses ' + a + ' as your avatar once you save changes';
  WallStyle.emojiPicker(document.getElementById('pf-avatar-pick'), () => chosenAvatar, pick);
}
function drawSitePicker() {
  WallStyle.picker(document.getElementById('site-accent-swatches'), { presets: () => SITE_ACCENTS, label: 'site colour', fit: (c) => c,   // the site theme fits every colour for readability itself (themeFrom)
    current: () => { const p = window.SITE_PREFS || {}; return (p.colors && p.colors.accent) || p.siteAccent || ''; },
    pick: (c) => {
      window.applySitePrefs({ siteAccent: c, colors: { accent: c || undefined } }, true);
      initThemeEditor();
      if (window.SFX) SFX.play('select');
      sendToast(c ? 'Site re-themed for you 🖌️' : 'Back to classic green 💚');
    },
    tip: (c) => (c ? 'Re-themes the whole site in this colour, just for you' : 'Puts the site colours back to classic green') });
}
function renderImgSlot(kind, url) {
  WallStyle.imageSlot(document.getElementById('slot-' + kind), kind, url, (k, u) => { myTheme[IMG_KEY[k]] = u; });
}

/* ---------- account ---------- */
let unameTimer;
document.getElementById('pf-username').addEventListener('input', e => {
  clearTimeout(unameTimer);
  const el = document.getElementById('pf-uname-status');
  unameTimer = setTimeout(async () => {
    const v = e.target.value.trim();
    if (!v || (AUTH.user && v.toLowerCase() === AUTH.user.username.toLowerCase())) { el.textContent = ''; return; }
    try {
      const j = await api('/api/username-check?u=' + encodeURIComponent(v));
      el.textContent = j.available ? '✅ available' : ('❌ ' + (j.reason || 'taken — try another'));
      el.style.color = j.available ? 'var(--green-bright)' : 'var(--red)';
    } catch {}
  }, 300);
});
async function saveProfile() {
  const wasClaim = !!(AUTH.user && AUTH.user.auto_named); // only a first handle claim may bounce back to the stashed page
  try {
    const j = await api('/api/profile', { method: 'POST', body: {
      username: document.getElementById('pf-username').value.trim(),
      avatar: chosenAvatar,
      bio: document.getElementById('pf-bio').value,
      twitter: document.getElementById('pf-twitter').value.trim(),
      instagram: document.getElementById('pf-instagram').value.trim(),
    }});
    AUTH.user = { ...AUTH.user, ...j.user, auto_named: false };
    // what was just saved is what "untouched" means now (the answer may leave a field out: then it is what was sent)
    for (const [id, k] of [['pf-username', 'username'], ['pf-bio', 'bio'], ['pf-twitter', 'twitter'], ['pf-instagram', 'instagram']]) {
      const el = document.getElementById(id); if (!el) continue;
      const v = j.user[k] != null ? String(j.user[k]) : el.value;
      el.value = v; el.dataset.filled = v;
    }
    avatarFilled = j.user.avatar || chosenAvatar;
    document.getElementById('pf-username-show').textContent = j.user.username;
    setWallLinks(j.user.username);
    document.getElementById('claim-banner').hidden = true;
    if (window.SFX) SFX.play('success');
    sendToast('Saved, @' + j.user.username + '! ✅');
    // first-time claim that started on another page (auth.js stashed the origin) → take them back there
    let back = null; try { back = sessionStorage.getItem('jsi:after-claim'); sessionStorage.removeItem('jsi:after-claim'); } catch {}
    // same-origin, single-leading-slash paths only (a '//evil.com/' pathname would be an open redirect)
    if (wasClaim && back && /^\/(?![\/\\])/.test(back) && !/\/profile\.html/.test(back)) { sendToast('Taking you back to where you were… ↩'); setTimeout(() => { location.href = back; }, 1400); }
    sendConfetti(innerWidth / 2, 200, { count: 30, emojiRatio: 0.4 });
    if (j.pointsEarned && window.showPoints) showPoints(j.pointsEarned);
    // keep the nav account control in sync after a rename/claim: the name is a LINK to the public wall
    // (href + label follow the new name), the caret beside it is the menu button (its label follows too)
    const navTrg = document.querySelector('#nav-auth .profile-link');
    if (navTrg) {
      const nm = navTrg.querySelector('.pl-name');
      const badge = navTrg.querySelector('.og-badge');
      // AUTH.user, not j.user: the merged object still carries avatarImg, which the save response does not — j.user alone swapped the pill's picture for the emoji
      navTrg.innerHTML = (window.AUTH && AUTH.navIdentity) ? AUTH.navIdentity(AUTH.user) : '<span class="pl-name">@' + j.user.username + '</span>';
      if (badge) navTrg.appendChild(badge);   // the OG badge rides along
      void nm;
      navTrg.setAttribute('href', '/u/' + encodeURIComponent(j.user.username));
      navTrg.setAttribute('aria-label', 'Your public Send Wall — @' + j.user.username);
      const wallItem = document.querySelector('#nav-profile-menu a[href^="/u/"]'); if (wallItem) wallItem.href = '/u/' + encodeURIComponent(j.user.username);
    }
    const navCaret = document.querySelector('#nav-auth .np-caret-btn');
    if (navCaret) navCaret.setAttribute('aria-label', 'Account menu for @' + j.user.username);
  } catch (e) { sendToast('⚠️ ' + e.message); }
}
function setWallLinks(name) {
  const href = '/u/' + encodeURIComponent(name);
  document.getElementById('pf-wall-link').href = href;
  document.getElementById('pf-wall-link2').href = href;
}

/* ---------- security ---------- */
/* "Confirm it's you", once: every change in this card goes through AUTH.stepUp, which asks only when this
   session is not already unlocked (a fresh sign-in, a new account's setup, or a confirm in the last while)
   and then remembers it server-side. One implementation, in auth.js, so every page asks the same way. */
const currentFactorBody = (note) => AUTH.stepUp(note);

// the unlock state, in words: when it ends, and a way to end it now (a shared computer) or start it now
let sudoTimer = null;
function renderSudo() {
  const bar = document.getElementById('sudo-bar'), txt = document.getElementById('sudo-text'), btn = document.getElementById('sudo-btn');
  if (!bar || !txt || !btn) return;
  const until = AUTH.user && AUTH.user.sudoUntil;
  const open = !!(until && until > Date.now());
  const mins = (AUTH.user && AUTH.user.verifyNeeds && AUTH.user.verifyNeeds.minutes) || 30;
  bar.classList.toggle('is-open', open);
  txt.textContent = open
    ? '🔓 Unlocked on this device until ' + new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' — the changes below won’t ask again.'
    : '🔒 Security changes ask you to confirm it’s you — once, then everything here is unlocked for ' + mins + ' minutes.';
  btn.textContent = open ? 'Lock now 🔒' : 'Unlock 🔓';
  btn.setAttribute('data-tip', open ? 'Ends the unlock on this device now — the next change asks again' : 'Confirms it\'s you now, so the changes below don\'t stop to ask');
  clearTimeout(sudoTimer);
  if (open) sudoTimer = setTimeout(renderSudo, Math.min(until - Date.now() + 500, 60e3));   // repaint when it runs out
}
async function toggleSudo() {
  try {
    if (AUTH.user && AUTH.user.sudoUntil && AUTH.user.sudoUntil > Date.now()) { await AUTH.lockSecurity(); sendToast('Locked 🔒 — the next security change will ask again'); }
    else { await AUTH.stepUp('Unlocking security changes on this device.'); sendToast('Unlocked 🔓'); }
  } catch (e) { if (e.message !== 'cancelled') sendToast('⚠️ ' + e.message); }
  renderSudo();
}
document.addEventListener('auth:sudo', renderSudo);
/* Owner, 2026-10-14: "When users are changing their info in settings do not time them out." While the unlock is open and the
   member is working in Settings (typing or clicking there), ask the server to keep it open — at most every four minutes. The
   server moves the end to 30 minutes from now, never more than four hours after the proof that opened it (keepSudo), and a
   closed unlock stays closed. Idle for 30 minutes, it ends as before. */
let sudoKeptAt = 0;
function keepSudoOpen() {
  const until = AUTH.user && AUTH.user.sudoUntil;
  if (!until || until <= Date.now() || Date.now() - sudoKeptAt < 4 * 60e3) return;
  sudoKeptAt = Date.now();
  api('/api/auth/verify/keep', { method: 'POST' }).then((j) => {
    if (!AUTH.user || !j || !j.ok) return;
    AUTH.user.sudoUntil = Date.now() + (j.sudoLeftMs || 0) - 1500;
    renderSudo();
  }).catch(() => {});
}
['input', 'keydown', 'pointerdown'].forEach((ev) => document.addEventListener(ev, (e) => {
  const p = document.getElementById('dpanel-settings');
  if (e.isTrusted && p && !p.hidden && p.contains(e.target)) keepSudoOpen();
}, true));

/* Everything about how you get into this account lives in one place — wallets, sign-in methods and the
   second factor — and that place is a <details> that opens shut. A closed panel labelled only "Security"
   tells you nothing, so the label carries the state: how many wallets are linked and whether a second
   factor is on. It is the one line somebody checks when they want to know they are covered, and now
   they can read it without opening anything. */
/* A link to a <details> scrolls to it and leaves it SHUT, which from the reader's side is a link that
   did nothing. Opening it on the jump — and on arrival with #sec-security in the URL, so a link shared
   from anywhere lands open — is the difference between a shortcut and a dead end. Focus follows, because
   somebody who arrived by keyboard has to be put where they were sent. */
/* A list that re-renders under the control you just pressed drops keyboard and screen-reader users to
   <body>. Land them on the status line that just changed instead; it is the next thing they want anyway. */
function refocus(id) {
  const el = document.getElementById(id); if (!el) return;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  try { el.focus({ preventScroll: true }); } catch {}
}
// open a Settings card, bring it into view and put focus on its heading (dashtabs.js shows the Settings tab for it first)
function openCard(id, scroll) {
  const d = document.getElementById(id);
  if (!d) return;
  d.open = true;
  const sum = d.querySelector('summary');
  if (scroll) { try { d.scrollIntoView({ behavior: window.prefersReduced && prefersReduced() ? 'auto' : 'smooth', block: 'start' }); } catch { d.scrollIntoView(); } }
  if (sum) { try { sum.setAttribute('tabindex', '-1'); sum.focus({ preventScroll: true }); } catch {} }
}
function openSecurity(scroll) { openCard('sec-security', scroll); }
/* "Edit profile ✏️" on your own wall (u.html) links to /profile.html#sec-account (owner, 2026-10-15: "Edit profile button on
   profile page should take the user to the settings on the dashboard and settings page so they can edit their profile"):
   the Settings tab, with the Account card — avatar, username, bio, X and Instagram — open and in view. Once the account has
   loaded (the card sits in the signed-in part of the page), and again if the link is followed while already here. */
let accountOpened = false;
function openAccountFromLink(signedIn) {
  if (location.hash !== '#sec-account' || !(signedIn === true || (window.AUTH && AUTH.user))) return;
  accountOpened = true;
  setTimeout(() => openCard('sec-account', true), 60);   // after the signed-in page has painted
}
addEventListener('hashchange', openAccountFromLink);
document.addEventListener('DOMContentLoaded', () => {
  const jump = document.getElementById('sec-jump-link');
  if (jump) jump.addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', '#sec-security'); openSecurity(true); });
  if (location.hash === '#sec-security') setTimeout(() => openSecurity(true), 60);   // after the page has painted
});

function securitySummary(me) {
  const el = document.getElementById('sec-state');
  if (!el || !me) return;
  const n = ((me.wallets || []).length);
  const bits = [];
  bits.push(n ? n + (n === 1 ? ' wallet' : ' wallets') : 'no wallet yet');
  bits.push(me.twofa ? '2FA on' : '2FA off');
  el.textContent = bits.join(' · ');
  el.classList.toggle('sec-state-warn', !me.twofa);
}
/* Through the SAME door every other connect on the site uses. This was a third hand-rolled copy of the
   link flow — identical to AUTH.linkWallet, since currentFactorBody is a pass-through to
   AUTH.currentFactor — and being a copy meant it missed what the shared one gained: landing the wallet
   on Robinhood Chain. Somebody linking from this page ended up on whatever network their wallet was
   showing, and then wondered why the holdings panel below was empty. The page-specific refreshes stay,
   because only this page has a holdings card and a dashboard to repaint. */
async function linkWallet() {
  try {
    const j = await AUTH.connectWallet({ note: 'Linking a wallet adds a new way to sign in to this account.' });
    if (!j) return;                       // signed out: the sign-in panel took over
    if (j.alreadyLinked) { sendToast('That wallet is already linked to your account ✅'); return; } // nothing changed — don't re-fetch everything
    if (j.linked) { sendToast('Wallet linked 🔗'); await loadMe(); loadConnectedWallet(); if (window.loadGamify) loadGamify(); if (window.refreshNavBalances) refreshNavBalances(); }
    // a wallet owned by ANOTHER account now comes back as a 409 and surfaces through the catch below
  } catch (e) { if (e.message !== 'cancelled') sendToast('⚠️ ' + (e.message || 'cancelled')); }
}
/* ---------- linked wallets ----------------------------------------------
   One account, several wallets, one Send Power score. Every control here ends
   in a `personal_sign` and nothing else: linking, unlinking and choosing the
   two-factor wallet are all proofs of ownership, never transactions. */
const shortAddr = (a) => String(a).slice(0, 6) + '…' + String(a).slice(-4);

function renderWallets(me) {
  const block = document.getElementById('wl-block');
  const list = document.getElementById('wl-list');
  if (!block || !list) return;                       // markup not on this page — never throw out of loadMe
  const ws = (me.walletList && me.walletList.length)
    ? me.walletList
    : (me.wallets || []).map((a) => ({ address: a, is2fa: false, label: '' }));
  block.hidden = !ws.length;
  if (!ws.length) { list.innerHTML = ''; return; }
  const count = document.getElementById('wl-count');
  if (count) count.textContent = ws.length + ' of ' + (me.maxWallets || 5);
  securitySummary(me);
  /* Accounts that turned wallet-2FA on before there was anything to choose have no flagged row; the
     server falls back to the oldest wallet, so show that as the key rather than leaving every row bare
     and letting someone unlink what is actually holding their account. */
  const fallback = (me.twofa === 'wallet' && !me.twofaWallet) ? ws[0].address : null;
  list.innerHTML = ws.map((w) => {
    const key = w.is2fa || w.address === fallback;
    const canPick = me.twofa === 'wallet' && !key;
    return '<li class="wl-row' + (key ? ' is-2fa' : '') + '">' +
      '<span class="wl-ico" aria-hidden="true">🦊</span>' +
      '<span class="wl-addr">' + esc(w.address) + '</span>' +
      (key ? '<span class="wl-tag">🔐 Sign-in key</span>' : '') +
      '<span class="wl-acts">' +
        (canPick ? '<button class="btn btn-ghost btn-sm js-wl-2fa" data-tip="Asks this wallet to sign, making it your two-factor key" data-a="' + esc(w.address) + '">Use for 2FA</button>' : '') +
        '<button class="btn btn-ghost btn-sm js-wl-unlink" data-tip="Unlinks this wallet, so it stops counting toward your boost" data-a="' + esc(w.address) + '">Unlink</button>' +
      '</span></li>';
  }).join('');
}

async function unlinkWallet(address) {
  if (!confirm('Unlink ' + shortAddr(address) + '?\n\nIt stops counting toward your Holder Boost and Send Call size. Unlinking is not selling: your Diamond streak is not reset (it pauses while your linked wallets hold under $100) — but a sale from this wallet still counts. Your other wallets are untouched, and you can link it again any time.')) return;
  const st = document.getElementById('wl-status');
  if (st) st.textContent = '';
  try {
    const current = await currentFactorBody('Unlinking a wallet changes how you sign in.');   // two-factor on or off: removing a way in is a security change
    const j = await api('/api/wallet/unlink', { method: 'POST', body: { address, current } });
    if (window.SFX) SFX.play('remove');
    sendToast('Wallet unlinked 🔌' + (j.ogRevoked ? ' — OG badge revoked: that wallet had sold out' : ''));
    await loadMe();
    refocus('wl-status');   // the button that had focus was just re-rendered away
    if (window.loadConnectedWallet) loadConnectedWallet();
    if (window.loadGamify) loadGamify();
    if (window.refreshNavBalances) refreshNavBalances();
  } catch (e) {
    if (e.message === 'cancelled') return;
    if (st) st.textContent = '⚠️ ' + e.message;   // the server's refusals here are instructions, so keep them on screen
    sendToast('⚠️ ' + (e.message || 'could not unlink that wallet'));
  }
}

async function makeTwofaWallet(address) {
  const st = document.getElementById('wl-status');
  if (st) st.textContent = '';
  try {
    const current = await currentFactorBody('Changing which wallet is your two-factor key.');
    sendToast('Now switch to ' + shortAddr(address) + ' in your wallet and sign ✍️');
    const { provider, address: got } = await WALLET.connect();
    if (got !== address) throw new Error('that is ' + shortAddr(got) + ' — switch to ' + shortAddr(address) + ' in your wallet app, then try again');
    const { message } = await api('/api/auth/wallet/nonce?purpose=2fa-on&address=' + address);
    const newSignature = await WALLET.sign(provider, address, message);
    await api('/api/2fa/wallet/primary', { method: 'POST', body: { address, newSignature, current } });
    if (window.SFX) SFX.play('success');
    sendToast('Two-factor wallet is now ' + shortAddr(address) + ' 🔐');
    await loadMe();
    refocus('wl-status');   // the button that had focus was just re-rendered away
  } catch (e) {
    if (e.message === 'cancelled') return;
    if (st) st.textContent = '⚠️ ' + e.message;
    sendToast('⚠️ ' + (e.message || 'could not change your two-factor wallet'));
  }
}

async function startTotp() {
  try {
    await currentFactorBody('Setting up an authenticator app changes how you sign in.');
    const j = await api('/api/2fa/totp/setup', { method: 'POST', body: {} });
    document.getElementById('totp-setup').hidden = false;
    if (window.SFX) SFX.play('open');
    document.getElementById('totp-qr').src = j.qr;
    document.getElementById('totp-secret').textContent = j.secret;
    document.getElementById('totp-confirm').focus();
  } catch (e) { if (e.message !== 'cancelled') sendToast('⚠️ ' + e.message); }
}
async function confirmTotp() {
  try {
    await api('/api/2fa/totp/enable', { method: 'POST', body: { code: document.getElementById('totp-confirm').value.trim() } });
    if (window.SFX) SFX.play('success');
    sendToast('2FA is ON 🔐');
    sendConfetti(innerWidth / 2, innerHeight / 2, { count: 40, emojiRatio: 0.3 });
    setupDone();
    loadMe();
  } catch (e) { if (e.message !== 'cancelled') sendToast('⚠️ ' + e.message); }
}
async function enableWallet2fa() {
  try {
    /* Turning this on makes THIS wallet the only way back in — disabling it and disconnecting it both need its
       signature. So say that in words before anything happens, and then make them prove they can sign with it
       right now. One click used to be enough, and a wallet whose seed was already gone locked the account
       permanently with no warning at all. */
    if (!confirm('Turn on wallet two-factor?\n\nFrom now on, signing in will need a signature from this wallet — and so will turning two-factor back off. If you lose access to the wallet, you lose access to the account.\n\nYou will be asked to sign now to prove you can.')) return;
    // confirm it's you FIRST: the server spends the wallet's signature below, so it must not be asked for after
    await currentFactorBody('Turning on wallet two-factor changes how you sign in.');
    const { provider, address } = await WALLET.connect();
    const { message } = await api('/api/auth/wallet/nonce?purpose=2fa-on&address=' + address);
    const signature = await WALLET.sign(provider, address, message);
    await api('/api/2fa/wallet/enable', { method: 'POST', body: { address, signature } });
    if (window.SFX) SFX.play('success');
    sendToast('Wallet 2FA is ON 🔐');
    setupDone();
    loadMe();
  } catch (e) { if (e.message !== 'cancelled') sendToast('⚠️ ' + (e.message || 'cancelled')); }
}
// wallet-first accounts add an email + password (a second way in; unlocks password-2FA and safe wallet disconnect)
async function addEmail(e) {
  e.preventDefault();
  const st = document.getElementById('ae-status');
  const email = document.getElementById('ae-email').value.trim(), pw = document.getElementById('ae-pw').value, pw2 = document.getElementById('ae-pw2').value;
  if (pw.length < 8) { st.textContent = '⚠️ Password needs at least 8 characters.'; if (window.SFX) SFX.play('error'); return; }
  if (pw !== pw2) { st.textContent = '⚠️ Passwords don’t match.'; if (window.SFX) SFX.play('error'); return; }
  st.textContent = '…';
  try {
    await currentFactorBody('Adding an email and password adds a way to sign in.');
    await api('/api/account/email', { method: 'POST', body: { email, password: pw } });
    if (window.SFX) SFX.play('success');
    st.textContent = ''; document.getElementById('ae-pw').value = ''; document.getElementById('ae-pw2').value = '';
    sendToast('Email + password added ✅'); loadMe();
  } catch (err) { st.textContent = err.message === 'cancelled' ? '' : '⚠️ ' + err.message; if (window.SFX && err.message !== 'cancelled') SFX.play('error'); }
}
async function confirmPassword2fa() {
  try {
    if (!confirm('Use your password as two-factor?\n\nSigning in with a wallet will then also ask for your account password — two different things a thief would need.')) return;
    /* The password IS this factor, so it is typed here even when the session is unlocked: arming a password you
       no longer remember would lock every way in. The masked pane — never the browser's clear-text dialog. */
    const typed = await AUTH._confirmFactor('password', 'Type your account password — it becomes the second step at wallet sign-in.');
    await api('/api/2fa/password/enable', { method: 'POST', body: { password: typed.password } });
    if (window.SFX) SFX.play('success');
    sendToast('Password 2FA is ON 🔐'); setupDone(); loadMe();
  } catch (e) { if (e.message !== 'cancelled') sendToast('⚠️ ' + e.message); }
}
async function disable2fa() {
  try {
    if (!confirm('Turn two-factor off?\n\nSigning in will need only your password or wallet again.')) return;
    await currentFactorBody('Turning two-factor off changes how you sign in.');
    await api('/api/2fa/disable', { method: 'POST', body: {} });
    if (window.SFX) SFX.play('off');
    sendToast('2FA turned off');
    loadMe();
  } catch (e) { if (e.message !== 'cancelled') sendToast('⚠️ ' + (e.message || 'cancelled')); }
}
// change the password: the confirm step is the old-password check, so this asks only for the new one
async function changePassword(e) {
  e.preventDefault();
  const st = document.getElementById('chpw-status');
  const pw = document.getElementById('chpw-new').value, pw2 = document.getElementById('chpw-new2').value;
  if (pw.length < 8) { st.textContent = '⚠️ Password needs at least 8 characters.'; if (window.SFX) SFX.play('error'); return; }
  if (pw !== pw2) { st.textContent = '⚠️ Passwords don’t match.'; if (window.SFX) SFX.play('error'); return; }
  st.textContent = '…';
  try {
    await currentFactorBody('Changing your password.');
    const j = await api('/api/account/password', { method: 'POST', body: { password: pw } });
    if (window.SFX) SFX.play('success');
    document.getElementById('chpw-new').value = ''; document.getElementById('chpw-new2').value = '';
    st.textContent = '';
    sendToast('Password changed 🔑' + (j.endedOthers ? ' — ' + j.endedOthers + ' other ' + (j.endedOthers === 1 ? 'device was' : 'devices were') + ' signed out' : ''));
  } catch (err) { st.textContent = err.message === 'cancelled' ? '' : '⚠️ ' + err.message; if (window.SFX && err.message !== 'cancelled') SFX.play('error'); }
}
async function changeEmail(e) {
  e.preventDefault();
  const st = document.getElementById('chem-status');
  const email = document.getElementById('chem-new').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { st.textContent = '⚠️ Enter a valid email.'; if (window.SFX) SFX.play('error'); return; }
  st.textContent = '…';
  try {
    await currentFactorBody('Changing the email you sign in with.');
    const had = AUTH.user && (AUTH.user.methods || []).includes('email');
    await api('/api/account/email/change', { method: 'POST', body: { email } });
    if (window.SFX) SFX.play('success');
    document.getElementById('chem-new').value = '';
    st.textContent = '';
    sendToast(had ? 'Email changed ✉️' : 'Email added ✉️ — you can sign in with it now');
    loadMe();
  } catch (err) { st.textContent = err.message === 'cancelled' ? '' : '⚠️ ' + err.message; if (window.SFX && err.message !== 'cancelled') SFX.play('error'); }
}
/* A new account that ticked "set up two-factor right after" lands here with a note and a way back.
   Finishing (or skipping) sends them back to where they signed up. */
function setupDone() {
  let pending = false; try { pending = sessionStorage.getItem('jsi:setup-2fa') === '1'; sessionStorage.removeItem('jsi:setup-2fa'); } catch {}
  const note = document.getElementById('setup-2fa-note'); if (note) note.hidden = true;
  if (!pending) return;
  let back = null; try { back = sessionStorage.getItem('jsi:after-2fa'); sessionStorage.removeItem('jsi:after-2fa'); } catch {}
  if (back && /^\/(?![\/\\])/.test(back)) setTimeout(() => { location.href = back; }, 900);
}
async function loadMe() {
  try {
    const me = AUTH._normMe ? AUTH._normMe((await api('/api/me')).user) : (await api('/api/me')).user;   // the unlock as a deadline on this clock
    AUTH.user = me;
    const zone = document.getElementById('pf-methods');
    zone.innerHTML = '';
    const label = { wallet: '🦊 Wallet', email: '✉️ Email', password: '🔑 Password', google: 'G Google', facebook: 'f Facebook' };
    for (const m of me.methods) {
      const s = document.createElement('span');
      s.className = 'privacy-chip';
      s.textContent = label[m] || m;
      zone.appendChild(s);
    }
    const on = !!me.twofa;
    document.getElementById('twofa-state').textContent = on ? 'ON' : 'off';
    securitySummary(me);
    document.getElementById('twofa-off').hidden = on;
    document.getElementById('twofa-on').hidden = !on;
    if (on || !loadMe.ran) document.getElementById('totp-setup').hidden = true;   // a refresh mid-setup leaves the QR code and the code box where they are
    loadMe.ran = true;
    if (on) document.getElementById('twofa-kind').textContent = ({ totp: 'authenticator app', wallet: 'wallet signature', password: 'account password' })[me.twofa] || me.twofa;
    document.getElementById('wallet-2fa-btn').disabled = !me.wallets.length;
    if (!me.wallets.length) document.getElementById('wallet-2fa-btn').title = 'Link a wallet first';
    // 'password' = a password with no email yet (a sign-up whose email was already on another account)
    const hasEmail = me.methods.includes('email'), hasPw = hasEmail || me.methods.includes('password'), hasWallet = me.wallets.length > 0;
    const aeb = document.getElementById('add-email-block'); if (aeb) aeb.hidden = hasPw;
    const cred = document.getElementById('cred-block'); if (cred) cred.hidden = !hasPw;
    const ch = document.getElementById('cred-handle'); if (ch) ch.textContent = me.username;
    const cn = document.getElementById('cred-noemail'); if (cn) cn.hidden = hasEmail;
    const cw = document.getElementById('cred-withemail'); if (cw) cw.hidden = !hasEmail;
    const ct = document.getElementById('cred-title'); if (ct) ct.textContent = hasEmail ? 'Email & password' : 'Password';
    const cl = document.getElementById('chem-label'); if (cl) cl.textContent = hasEmail ? 'New email' : 'Add an email';
    const cs = document.getElementById('chem-submit'); if (cs) cs.textContent = hasEmail ? 'Change email ✉️' : 'Add email ✉️';
    const pwBtn = document.getElementById('pw-2fa-btn'); if (pwBtn) pwBtn.hidden = !(hasPw && hasWallet); // password-2FA only makes sense for wallet sign-ins
    renderWallets(me);
    renderSudo();
  } catch {}
}


/* ---------- full colour editor ----------
   Five controls, named the way a person thinks about a page rather than after CSS variables.
   Every pick runs through the solver in prefs.js, which may adjust it for readability; when that
   happens the field shows the value actually applied rather than silently disagreeing with itself. */
const THEME_CONTROLS = [
  { key: 'accent',     label: 'Accent',      sub: 'buttons, links, highlights', fallback: '#a8ce00' },
  { key: 'background', label: 'Background',  sub: 'the page itself',            fallback: '#0b0818' },
  { key: 'text',       label: 'Text',        sub: 'body copy',                  fallback: '#eef4ff' },
  { key: 'highlight',  label: 'Gold accents', sub: 'prices, OG badges',         fallback: '#ffb340' },
  { key: 'rare',       label: 'Rare accents', sub: 'diamond tiers',             fallback: '#9fe0ff' },
];
function initThemeEditor() {
  const host = document.getElementById('theme-rows');
  if (!host) return;
  const cur = (window.SITE_PREFS && window.SITE_PREFS.colors) || {};
  host.innerHTML = THEME_CONTROLS.map(c => {
    const v = cur[c.key] || c.fallback;
    return '<div class="theme-row">' +
      '<label class="theme-lab" for="tc-' + c.key + '"><b>' + c.label + '</b><i>' + c.sub + '</i></label>' +
      '<input type="color" id="tc-' + c.key + '" value="' + v + '" aria-describedby="tc-note-' + c.key + '">' +
      '<input type="text" class="theme-hex" id="tch-' + c.key + '" value="' + v + '" maxlength="7" spellcheck="false"' +
        ' pattern="#?[0-9a-fA-F]{6}" aria-describedby="tc-note-' + c.key + '" aria-label="' + c.label + ' colour as a hex code">' +
      '<span class="theme-applied" id="tc-note-' + c.key + '" role="status" aria-live="polite"></span>' +
    '</div>';
  }).join('');

  THEME_CONTROLS.forEach(c => {
    const pick = document.getElementById('tc-' + c.key);
    const hex = document.getElementById('tch-' + c.key);
    const note = document.getElementById('tc-note-' + c.key);
    const commit = (val) => {
      if (/^[0-9a-fA-F]{6}$/.test(val)) val = '#' + val;   // a missing # is the commonest way people write one
      if (!/^#[0-9a-fA-F]{6}$/.test(val)) {
        // a rejected value used to vanish silently: the field kept the typing, nothing changed, nothing said why
        note.textContent = 'Use a 6-digit hex code starting with #, like #c6f000.';
        hex.setAttribute('aria-invalid', 'true');
        if (window.SFX) SFX.play('error');
        return;
      }
      hex.removeAttribute('aria-invalid');
      applySitePrefs({ colors: { [c.key]: val } }, true);
      // Say plainly when the solver moved the colour, and to what.
      const solved = window.themeFrom ? window.themeFrom((window.SITE_PREFS || {}).colors || {}) : {};
      const map = { accent: '--green', background: '--ink', text: '--text', highlight: '--gold', rare: '--diamond' };
      const got = solved[map[c.key]];
      if (got && got.toLowerCase() !== val.toLowerCase()) {
        note.textContent = 'Adjusted to ' + got + ' so it stays readable.';
        pick.value = got; hex.value = got;
      } else { note.textContent = ''; hex.value = val; pick.value = val; }
    };
    pick.addEventListener('input', () => commit(pick.value));
    hex.addEventListener('change', () => commit(hex.value.trim()));
  });

  const reset = document.getElementById('theme-reset');
  if (reset && !reset._wired) {
    reset._wired = true;
    reset.addEventListener('click', () => {
      // colors: null is the replace-with-empty signal — a plain merge of {} would change nothing.
      applySitePrefs({ colors: null, siteAccent: '' }, true);
      initThemeEditor();
      if (window.SFX) SFX.play('remove');
      sendToast('Colours reset 🎨');
    });
  }
}

/* ---------- site prefs ---------- */
function initSitePrefs() {
  drawSitePicker();
  initThemeEditor();
  const switches = [
    ['pref-confetti', 'confetti'],
    ['pref-ticker', 'ticker'],
    ['pref-music', 'musicResume'],
  ];
  for (const [id, key] of switches) {
    const el = document.getElementById(id);
    el.setAttribute('aria-checked', String((window.SITE_PREFS || {})[key] !== false));
    if (el.dataset.wired) continue;   // this runs on every account refresh: a second listener would flip the switch back
    el.dataset.wired = '1';
    el.addEventListener('click', () => {
      const cur = el.getAttribute('aria-checked') === 'true';
      el.setAttribute('aria-checked', String(!cur));
      applySitePrefs({ [key]: !cur }, true);
      if (!cur && window.SFX) SFX.play('on');
      if (cur && window.SFX) SFX.play('off');
      sendToast(!cur ? 'On ✅' : 'Off — noted');
    });
  }
}

/* ---------- tracker ---------- */
window.saveTrackerPrefs = function (prefs) {
  api('/api/profile', { method: 'POST', body: { tracker_prefs: prefs } }).catch(() => {});
};
/* A read can take a minute now, and the wallet picker can start another meanwhile: only the latest one paints. */
let cwRun = 0;
async function runTracker(zone, address) {
  const run = ++cwRun;
  zone.innerHTML = '<p class="modal-note" aria-live="polite">Reading the chain… ⛓️</p>';
  const note = zone.firstChild;
  let lastStage = '', lastAt = 0;   // a live region: speak when the stage changes, or every 15 s — not at every percent
  try {
    const r = await trackerReport(address, m => {
      if (run !== cwRun) return;
      const t = Date.now(), stage = m.replace(/…\s*\d+%$/, '…');
      if (stage !== lastStage || t - lastAt > 15000) { lastStage = stage; lastAt = t; note.textContent = '⛓️ ' + m; }
    }, { isStale: () => run !== cwRun || !zone.isConnected });   // a read nobody will see stops asking — and the server stops reading it
    if (run !== cwRun || !zone.isConnected) return;
    renderTracker(zone, r, AUTH.user && AUTH.user.tracker_prefs);
  } catch (e) {
    if (run !== cwRun || !zone.isConnected) return;
    const why = (e && e.message) || 'the chain may be busy — try again in a minute';
    zone.innerHTML = '<p class="modal-note">⚠️ Could not read this wallet right now — ' + String(why).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) + '.</p>';
  }
}

// The connected wallet(s): read-only analytics (holdings, trades, PNL) for the address(es) linked via signature.
function loadConnectedWallet() {
  const body = document.getElementById('cw-body');
  const sel = document.getElementById('cw-selector');
  if (!body) return;
  const wallets = (AUTH.user && AUTH.user.wallets) || [];
  if (!wallets.length) {
    sel.innerHTML = '';
    body.innerHTML =
      '<p class="modal-note" style="margin-top:0.2rem;">Connect a wallet to see your <b>$SEND &amp; $GWC holdings, trade history and PNL</b> here — pulled live from the chain. It\'s a <b>free signature, never a transaction</b>, and it unlocks your Holder Boost too.</p>' +
      '<div style="display:flex; gap:0.6rem; flex-wrap:wrap; margin-top:0.5rem;">' +
        '<button class="btn btn-primary btn-sm" id="cw-connect" data-tip="Links a wallet by signature so this panel can read it">Connect wallet 🔗</button>' +
        '<a class="btn btn-ghost btn-sm" href="/tracker.html" data-tip="Opens the tracker to follow any address read-only">Or track any wallet 💼</a>' +
      '</div>';
    const c = document.getElementById('cw-connect');
    if (c) c.addEventListener('click', linkWallet);
    return;
  }
  if (wallets.length > 1) {
    sel.innerHTML = '<span class="modal-note" style="margin:0 0.4rem 0 0;">Wallet:</span>' +
      wallets.map(w => '<button class="copy-btn cw-pick" data-tip="Loads holdings and trades for this wallet into the panel below" data-addr="' + esc(w) + '">' + esc(fmtShort(w)) + '</button>').join(' ');
    sel.querySelectorAll('.cw-pick').forEach(b => b.addEventListener('click', () => {
      sel.querySelectorAll('.cw-pick').forEach(x => x.classList.remove('lit'));
      b.classList.add('lit');
      if (window.SFX) SFX.play('scan');
      runTracker(body, b.dataset.addr);
    }));
    const first = sel.querySelector('.cw-pick'); if (first) first.classList.add('lit');
  } else sel.innerHTML = '';
  runTracker(body, wallets[0]);
}
function fmtShort(a) { return a.slice(0, 8) + '…' + a.slice(-6); }

/* ---------- static buttons ---------- */
document.getElementById('signedout-cta').addEventListener('click', () => AUTH.open());
document.getElementById('signout-btn').addEventListener('click', () => AUTH.logout().then(() => location.reload()));
document.getElementById('save-profile-btn').addEventListener('click', saveProfile);
document.getElementById('link-wallet-btn').addEventListener('click', linkWallet);
/* ---------- delete the account (X02): typed confirmation, then proof of ownership, then gone ---------- */
(function () {
  const inp = document.getElementById('acct-delete-confirm'), btn = document.getElementById('acct-delete-btn'), st = document.getElementById('acct-delete-status');
  if (!inp || !btn) return;
  inp.addEventListener('input', () => { const ok = inp.value.trim().toUpperCase() === 'DELETE'; btn.disabled = !ok; if (ok) btn.removeAttribute('title'); else btn.title = 'Type DELETE above first'; });
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    st.textContent = '';
    try {
      const proof = await (AUTH.ownershipProof ? AUTH.ownershipProof('Deleting your account is permanent.') : AUTH.currentFactor('Deleting your account is permanent.'));
      btn.disabled = true; st.textContent = 'Deleting…';
      await api('/api/account/delete', { method: 'POST', body: Object.assign({ confirm: 'DELETE', current: proof }, proof && proof.password ? { password: proof.password } : {}) });
      if (window.SFX) SFX.play('remove');
      st.textContent = 'Your account is gone. Thanks for sending it with us.';
      try { localStorage.removeItem('send.eggs.pending'); localStorage.removeItem('send.eggs.seen'); localStorage.removeItem('send.eggs.unpaid'); localStorage.removeItem('send.eggs.mine'); localStorage.removeItem('send.eggs.retry'); } catch {}
      AUTH.user = null; if (AUTH.redraw) AUTH.redraw();
      setTimeout(() => { location.href = '/'; }, 1600);
    } catch (e) {
      btn.disabled = false;
      st.textContent = e.message === 'cancelled' ? '' : '⚠️ ' + (e.message || 'could not delete the account');
      if (window.SFX && e.message !== 'cancelled') SFX.play('error');
    }
  });
})();
document.getElementById('totp-start-btn').addEventListener('click', startTotp);
document.getElementById('totp-confirm-btn').addEventListener('click', confirmTotp);
document.getElementById('wallet-2fa-btn').addEventListener('click', enableWallet2fa);
document.getElementById('twofa-disable-btn').addEventListener('click', disable2fa);
document.getElementById('add-email-form').addEventListener('submit', addEmail);
document.getElementById('pw-2fa-btn').addEventListener('click', confirmPassword2fa);
document.getElementById('chpw-form').addEventListener('submit', changePassword);
document.getElementById('chem-form').addEventListener('submit', changeEmail);
document.getElementById('sudo-btn').addEventListener('click', toggleSudo);
document.getElementById('setup-2fa-skip').addEventListener('click', () => { if (window.SFX) SFX.play('close'); sendToast('Skipped — two-factor is always here in Settings → Security'); setupDone(); });
/* Arriving from a sign-up that ticked "set up two-factor right after": open the card on it, with the note. */
try {
  if (sessionStorage.getItem('jsi:setup-2fa') === '1') {
    const note = document.getElementById('setup-2fa-note'); if (note) note.hidden = false;
    setTimeout(() => { openSecurity(true); const t = document.getElementById('totp-start-btn'); if (t) { try { t.focus({ preventScroll: true }); } catch {} } }, 120);
  }
} catch {}

/* Delegated, and guarded: the rows are re-rendered on every loadMe, so per-button listeners would leak,
   and this block must never throw — the listeners above it have no null guards, and a TypeError here
   would take the whole settings page down with it. */
(function () {
  const list = document.getElementById('wl-list');
  if (!list) return;
  list.addEventListener('click', (e) => {
    const un = e.target.closest('.js-wl-unlink');
    if (un) { unlinkWallet(un.dataset.a); return; }
    const pick = e.target.closest('.js-wl-2fa');
    if (pick) makeTwofaWallet(pick.dataset.a);
  });
})();

/* ---------- boot ---------- */
/* This runs on EVERY account refresh, not only the first (a picture saved, a wallet linked, the unlock ending), so it must never
   undo what the member is in the middle of (owner, 2026-10-14: "do not time them out and do not take them to any other page ...
   mid them changing their info"). A field is filled from the account only while it still holds what was filled last time; one
   the member has typed into keeps their typing until they save it. */
let avatarFilled = null;
function fillKeep(id, v) {
  const el = document.getElementById(id); if (!el) return;
  const typed = el.dataset.filled !== undefined && el.value !== el.dataset.filled;
  if (!typed) el.value = v;
  el.dataset.filled = v;
}
window.onAuthReady = function (user) {
  document.getElementById('signedout').hidden = !!user;
  document.getElementById('signedin').hidden = !user;
  if (!user) return;
  if (avatarFilled === null || chosenAvatar === avatarFilled) chosenAvatar = user.avatar || '🚀';   // an avatar picked but not yet saved stays picked
  avatarFilled = user.avatar || '🚀';
  wallState.accent = (user.theme && user.theme.accent) || '';
  wallState.bg = (user.theme && user.theme.wall_bg) || '';
  myTheme = user.theme || {};
  document.getElementById('pf-avatar').textContent = chosenAvatar;
  const pfShow = document.getElementById('pf-username-show');
  pfShow.textContent = user.username;
  const oldOg = pfShow.parentElement.querySelector('.og-badge'); if (oldOg) oldOg.remove();
  if (user.og && window.ogBadge) pfShow.insertAdjacentHTML('afterend', ogBadge(user.og)); // your OG badge on your own dashboard header
  fillKeep('pf-username', user.username);
  fillKeep('pf-bio', user.bio || '');
  fillKeep('pf-twitter', user.twitter || '');
  fillKeep('pf-instagram', user.instagram || '');
  setWallLinks(user.username);
  if (!user.auto_named) { try { sessionStorage.removeItem('jsi:after-claim'); } catch {} } // a stale stash must never bounce a later, unrelated save
  const claiming = user.auto_named || location.hash === '#claim';
  document.getElementById('claim-banner').hidden = !claiming;
  if (claiming) document.getElementById('sec-account').open = true;
  if (!accountOpened) openAccountFromLink(true);   // arrived from "Edit profile" on the wall: once, not on every re-render after a save
  renderAvatarPicker();
  WallStyle.wallPickers(document.getElementById('accent-swatches'), document.getElementById('bg-swatches'), wallState);
  renderImgSlot('avatar', myTheme.avatar_img);
  renderImgSlot('header', myTheme.header_img);
  renderImgSlot('background', myTheme.bg_img);
  initSitePrefs();
  loadMe();
  loadConnectedWallet();
  loadInvites();
  loadAlertList();
};

/* Your ticket and your ten codes, on the page you already know. invite.js owns the rendering (it also
   draws them inside the modal, and one copy of "which codes are spent" is one copy too many); this just
   loads it on demand and hands it the slot. #invites in the URL scrolls straight to it, which is where
   the modal's "see all my codes" button points. */
async function loadInvites() {
  const host = document.getElementById('invites-body');
  if (!host || !window.AUTH || !AUTH.loadInvite) return;
  try {
    const inv = await AUTH.loadInvite();
    await inv.mountDashboard(host);
    if (location.hash === '#invites') {
      const card = document.getElementById('invites-card');
      if (card) card.scrollIntoView({ behavior: (window.prefersReduced && prefersReduced()) ? 'auto' : 'smooth', block: 'start' });
    }
  } catch {
    // the ticket assets failed to load — say where the codes are rather than leaving an empty card
    host.innerHTML = '<h3 style="margin:0 0 0.4rem;">🎟️ Your invite codes</h3>' +
      '<p class="modal-note" style="margin:0;">Couldn’t load your codes just now — refresh the page to try again.</p>';
  }
}

/* ═══ 🔔 Post alerts — the list of walls you asked to be told about ═════════════════════════════════
   The bell says what happened; this says what you SIGNED UP for, and lets you stop without going back to
   find the wall you set it on. Rendered from AUTH.user.alerts, which the session payload already carries,
   so opening this card costs nothing. Turning one off is the same route the wall button uses — one
   endpoint, one behaviour, no second copy of the rule. */
async function loadAlertList() {
  const list = document.getElementById('alert-list'), note = document.getElementById('alert-list-note');
  if (!list || !window.AUTH || !AUTH.user) return;
  const names = Array.isArray(AUTH.user.alerts) ? AUTH.user.alerts : [];
  if (!names.length) {
    list.innerHTML = '';
    note.textContent = 'No alerts set. Open anyone’s wall and press 🔔 Alerts to be told when they post.';
    return;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  list.innerHTML = names.map(n =>
    '<li class="alert-row">' +
      '<a class="alert-who" href="/u/' + encodeURIComponent(n) + '">@' + esc(n) + '</a>' +
      '<button class="btn btn-ghost btn-sm alert-off" type="button" data-tip="Stops the bell telling you when this wall posts" data-off="' + esc(n) + '" aria-label="Turn off alerts for ' + esc(n) + '">Turn off</button>' +
    '</li>').join('');
  note.textContent = names.length === 1 ? '1 wall. They are not told.' : names.length + ' walls. They are not told.';
  if (list._wired) return;
  list._wired = true;
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-off]'); if (!b) return;
    const name = b.dataset.off;
    b.disabled = true;
    try {
      const j = await window.api('/api/alerts/' + encodeURIComponent(name), { method: 'DELETE' });
      AUTH.user.alerts = Array.isArray(j.alerts) ? j.alerts : [];
      loadAlertList();
      refocus('alert-list-note');   // the Turn-off button that had focus no longer exists
      if (window.SFX) SFX.play('remove');
      if (window.sendToast) sendToast('🔕 Alerts off for @' + name);
      if (window.announce) announce('Alerts off for ' + name);
    } catch (err) { b.disabled = false; if (window.sendToast) sendToast(err.message); }
  });
}
