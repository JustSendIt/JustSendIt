/* ===== Profile page: tracker (main), collapsible settings, prefs ===== */
const AVATARS = ['🚀','🦍','🐸','💎','🤝','🧨','🥷','👑','🦖','🌕','💸','🔥'];
const ACCENTS = ['', '#b4ff2b', '#00C805', '#ffb340', '#ff5d5d', '#5dc9ff', '#c85dff', '#ff5dd2', '#ffffff'];
const BGS = ['', '#0a0e14', '#101a10', '#1a1210', '#10121a', '#1a101a', '#000000'];
// '#8ee000' is deliberately absent: it looks identical to Default but derives a different
// bright/dark pair, so the two swatches would look the same and behave differently.
const SITE_ACCENTS = ['', '#00C805', '#ffb340', '#ff5d5d', '#5dc9ff', '#c85dff', '#ff5dd2'];
let chosenAvatar = '🚀', chosenAccent = '', chosenBg = '';
let myTheme = {};

// attribute-safe HTML escape (also encodes quotes so it's safe inside src="…"/style="…")
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------- pickers ---------- */
function renderAvatarPicker() {
  const zone = document.getElementById('pf-avatar-pick');
  zone.innerHTML = '';
  for (const a of AVATARS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'react-btn' + (a === chosenAvatar ? ' lit' : '');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(a === chosenAvatar));
    b.setAttribute('aria-label', 'avatar ' + a);
    b.textContent = a;
    b.addEventListener('click', () => { chosenAvatar = a; document.getElementById('pf-avatar').textContent = a; renderAvatarPicker(); });
    zone.appendChild(b);
  }
}
function renderSwatches(zoneId, colors, current, onPick) {
  const zone = document.getElementById(zoneId);
  zone.innerHTML = '';
  for (const c of colors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = c || 'linear-gradient(135deg, #8ee000, #ffb340)';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c === current));
    b.setAttribute('aria-label', c ? 'color ' + c : 'default');
    b.title = c || 'default';
    b.addEventListener('click', () => { onPick(c); renderSwatches(zoneId, colors, c, onPick); });
    zone.appendChild(b);
  }
}

/* ---------- wall style ---------- */
async function saveWallColor(body) {
  try { await api('/api/profile', { method: 'POST', body }); sendToast('Wall updated 🎨'); }
  catch (e) { sendToast('⚠️ ' + e.message); }
}
function renderImgSlot(kind, url) {
  const zone = document.getElementById('slot-' + kind);
  zone.innerHTML = '';
  if (url) {
    if (/\.(mp4|webm)$/i.test(url)) {
      // muted + loop + playsinline + preload=metadata: a profile video must never demand attention,
      // never play sound, and never block first paint.
      const v = document.createElement('video');
      v.src = url; v.muted = true; v.loop = true; v.autoplay = true;
      v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'metadata';
      v.setAttribute('aria-label', 'current ' + kind + ' video');
      zone.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = url; img.alt = 'current ' + kind + ' image';
      zone.appendChild(img);
    }
  } else {
    const d = document.createElement('div');
    d.className = 'none'; d.textContent = 'none';
    zone.appendChild(d);
  }
  const up = document.createElement('label');
  up.className = 'file-label';
  up.innerHTML = '📷 ' + (url ? 'Replace' : 'Upload') + '<input type="file" accept="image/*,video/mp4,video/webm" hidden>';
  up.querySelector('input').addEventListener('change', e => uploadThemeImage(kind, e.target));
  zone.appendChild(up);
  if (url) {
    const rm = document.createElement('button');
    rm.className = 'react-btn';
    rm.textContent = '🗑';
    rm.setAttribute('aria-label', 'remove ' + kind + ' image');
    rm.addEventListener('click', async () => {
      try {
        await api('/api/profile/image', { method: 'POST', body: { kind, remove: true } });
        myTheme[kind === 'avatar' ? 'avatar_img' : kind === 'header' ? 'header_img' : 'bg_img'] = null;
        renderImgSlot(kind, null);
        sendToast('Removed');
      } catch (err) { sendToast(err.message); }
    });
    zone.appendChild(rm);
  }
}
async function uploadThemeImage(kind, input) {
  const f = input.files[0]; if (!f) return;
  const animated = /^video\//.test(f.type) || f.type === 'image/gif';
  if (animated) {
    // A canvas re-encode would flatten a GIF to one frame and cannot handle video at all, so these
    // stream through the same validated upload path the Send Wall uses — magic-byte checked, size
    // capped per type, and compressed identically. One pipeline, one set of limits.
    const cap = f.type === 'image/gif' ? 25 : 64;
    if (f.size > cap * 1024 * 1024) { sendToast('Too big — keep it under ' + cap + 'MB'); return; }
    sendToast('Uploading…');
    try {
      const r = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': f.type, 'X-Filename': encodeURIComponent(f.name || 'media') }, body: f });
      const u = await r.json();
      if (!r.ok || !u.url) throw new Error(u.error || 'upload failed');
      const j = await api('/api/profile/image', { method: 'POST', body: { kind, image: u.url } });
      myTheme[kind === 'avatar' ? 'avatar_img' : kind === 'header' ? 'header_img' : 'bg_img'] = j.url;
      renderImgSlot(kind, j.url);
      sendToast('Looking good 😎');
    } catch (err) { sendToast('⚠️ ' + (err.message || 'upload failed')); }
    return;
  }
  if (f.size > 8 * 1024 * 1024) { sendToast('Too big — keep it under 8MB 🐘'); return; }
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = async () => {
      const maxW = kind === 'avatar' ? 400 : 1400;
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = img.width * scale; c.height = img.height * scale;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      try {
        const j = await api('/api/profile/image', { method: 'POST', body: { kind, image: c.toDataURL('image/jpeg', 0.85) } });
        myTheme[kind === 'avatar' ? 'avatar_img' : kind === 'header' ? 'header_img' : 'bg_img'] = j.url;
        renderImgSlot(kind, j.url);
        sendToast('Looking good 😎');
        sendConfetti(innerWidth / 2, innerHeight / 2, { count: 24, emojiRatio: 0.4 });
      } catch (err) { sendToast('⚠️ ' + err.message); }
    };
    img.src = rd.result;
  };
  rd.readAsDataURL(f);
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
    document.getElementById('pf-username-show').textContent = j.user.username;
    setWallLinks(j.user.username);
    document.getElementById('claim-banner').hidden = true;
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
      if (nm) nm.textContent = j.user.avatar + ' @' + j.user.username; else navTrg.textContent = j.user.avatar + ' @' + j.user.username;
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
/* Proof of the account's CURRENT second factor, for changes that add or remove a way in. Linking a wallet is
   one of those: a wallet on the account can sign in with it, so attaching one from a borrowed session was
   enough to take the account permanently. Returns {} when the account has no factor to prove. */
async function currentFactorBody(note) {
  const m = AUTH.user && AUTH.user.twofa;
  if (!m) return {};
  if (m === 'password') {
    const pw = prompt((note || 'Confirm this change') + '\n\nEnter your account password:');
    if (!pw) throw new Error('cancelled');
    return { password: pw };
  }
  if (m === 'totp') {
    const code = prompt((note || 'Confirm this change') + '\n\nEnter the 6-digit code from your authenticator app:');
    if (!code) throw new Error('cancelled');
    return { code: code.trim() };
  }
  // wallet 2FA: sign a management challenge with a wallet ALREADY on the account
  sendToast('Connect the wallet your two-factor is set to, and sign to confirm ✍️');
  const { provider, address } = await WALLET.connect();
  const { message } = await api('/api/auth/wallet/nonce?purpose=manage&address=' + address);
  const signature = await provider.request({ method: 'personal_sign', params: [message, address] });
  return { address, signature };
}
async function linkWallet() {
  try {
    const current = await currentFactorBody('Linking a wallet adds a new way to sign in to this account.');
    const { provider, address } = await WALLET.connect();
    const { message } = await api('/api/auth/wallet/nonce?purpose=link&address=' + address);
    const signature = await provider.request({ method: 'personal_sign', params: [message, address] });
    const j = await api('/api/auth/wallet/verify', { method: 'POST', body: { address, signature, current } });
    if (j.alreadyLinked) { sendToast('That wallet is already linked to your account ✅'); return; } // nothing changed — don't re-fetch everything
    if (j.linked) { sendToast('Wallet linked 🔗'); await loadMe(); loadConnectedWallet(); if (window.loadGamify) loadGamify(); if (window.refreshNavBalances) refreshNavBalances(); }
    // a wallet owned by ANOTHER account now comes back as a 409 and surfaces through the catch below
  } catch (e) { if (e.message !== 'cancelled') sendToast('⚠️ ' + (e.message || 'cancelled')); }
}
async function startTotp() {
  try {
    const j = await api('/api/2fa/totp/setup', { method: 'POST' });
    document.getElementById('totp-setup').hidden = false;
    document.getElementById('totp-qr').src = j.qr;
    document.getElementById('totp-secret').textContent = j.secret;
    document.getElementById('totp-confirm').focus();
  } catch (e) { sendToast('⚠️ ' + e.message); }
}
async function confirmTotp() {
  try {
    await api('/api/2fa/totp/enable', { method: 'POST', body: { code: document.getElementById('totp-confirm').value.trim() } });
    sendToast('2FA is ON 🔐');
    sendConfetti(innerWidth / 2, innerHeight / 2, { count: 40, emojiRatio: 0.3 });
    loadMe();
  } catch (e) { sendToast('⚠️ ' + e.message); }
}
async function enableWallet2fa() {
  try {
    /* Turning this on makes THIS wallet the only way back in — disabling it and disconnecting it both need its
       signature. So say that in words before anything happens, and then make them prove they can sign with it
       right now. One click used to be enough, and a wallet whose seed was already gone locked the account
       permanently with no warning at all. */
    if (!confirm('Turn on wallet two-factor?\n\nFrom now on, signing in will need a signature from this wallet — and so will turning two-factor back off. If you lose access to the wallet, you lose access to the account.\n\nYou will be asked to sign now to prove you can.')) return;
    const current = await currentFactorBody('Turning on wallet two-factor changes how you sign in.');
    const { provider, address } = await WALLET.connect();
    const { message } = await api('/api/auth/wallet/nonce?purpose=2fa-on&address=' + address);
    const signature = await provider.request({ method: 'personal_sign', params: [message, address] });
    const body = { address, signature, current };
    // an account with a password proves it with the password, so a borrowed session alone can never arm the lock
    if (!(AUTH.user && AUTH.user.twofa) && AUTH.user && (AUTH.user.methods || []).includes('email')) {
      const pw = prompt('Turning on wallet two-factor means this wallet becomes required to sign in.\n\nEnter your account password to confirm:');
      if (!pw) throw new Error('cancelled');
      body.password = pw;
    }
    await api('/api/2fa/wallet/enable', { method: 'POST', body });
    sendToast('Wallet 2FA is ON 🔐');
    loadMe();
  } catch (e) { sendToast('⚠️ ' + (e.message || 'cancelled')); }
}
// wallet-first accounts add an email + password (a second way in; unlocks password-2FA and safe wallet disconnect)
async function addEmail(e) {
  e.preventDefault();
  const st = document.getElementById('ae-status');
  const email = document.getElementById('ae-email').value.trim(), pw = document.getElementById('ae-pw').value, pw2 = document.getElementById('ae-pw2').value;
  if (pw.length < 8) { st.textContent = '⚠️ Password needs at least 8 characters.'; return; }
  if (pw !== pw2) { st.textContent = '⚠️ Passwords don’t match.'; return; }
  const body = { email, password: pw };
  // adding a login credential is a 2FA-gated change: supply the current factor
  if (AUTH.user && AUTH.user.twofa === 'totp') body.code = document.getElementById('ae-code').value.trim();
  if (AUTH.user && AUTH.user.twofa === 'wallet') {
    try {
      st.textContent = 'Sign with your linked wallet to confirm… ✍️';
      const { provider, address } = await WALLET.connect();
      const { message } = await api('/api/auth/wallet/nonce?purpose=manage&address=' + address);
      body.address = address; body.signature = await provider.request({ method: 'personal_sign', params: [message, address] });
    } catch (err) { st.textContent = err.message === 'cancelled' ? '' : '⚠️ ' + (err.message || 'cancelled'); return; }
  }
  st.textContent = '…';
  try {
    await api('/api/account/email', { method: 'POST', body });
    st.textContent = ''; document.getElementById('ae-pw').value = ''; document.getElementById('ae-pw2').value = '';
    sendToast('Email + password added ✅'); loadMe();
  } catch (err) { st.textContent = '⚠️ ' + err.message; }
}
async function confirmPassword2fa() {
  try {
    await api('/api/2fa/password/enable', { method: 'POST', body: { password: document.getElementById('pw2fa-pass').value } });
    document.getElementById('pw2fa-pass').value = '';
    sendToast('Password 2FA is ON 🔐'); loadMe();
  } catch (e) { sendToast('⚠️ ' + e.message); }
}
async function disable2fa() {
  try {
    if (AUTH.user && AUTH.user.twofa === 'password') {
      await api('/api/2fa/disable', { method: 'POST', body: { password: document.getElementById('twofa-disable-pw').value } });
    } else if (AUTH.user && AUTH.user.twofa === 'wallet') {
      // wallet 2FA can only be removed by signing with a linked wallet
      const { provider, address } = await WALLET.connect();
      const { message } = await api('/api/auth/wallet/nonce?purpose=manage&address=' + address);
      const signature = await provider.request({ method: 'personal_sign', params: [message, address] });
      await api('/api/2fa/disable', { method: 'POST', body: { address, signature } });
    } else {
      await api('/api/2fa/disable', { method: 'POST', body: { code: document.getElementById('twofa-disable-code').value.trim() } });
    }
    sendToast('2FA turned off');
    loadMe();
  } catch (e) { sendToast('⚠️ ' + (e.message || 'cancelled')); }
}
async function loadMe() {
  try {
    const me = (await api('/api/me')).user;
    AUTH.user = me;
    const zone = document.getElementById('pf-methods');
    zone.innerHTML = '';
    const label = { wallet: '🦊 Wallet', email: '✉️ Email', google: 'G Google', facebook: 'f Facebook' };
    for (const m of me.methods) {
      const s = document.createElement('span');
      s.className = 'privacy-chip';
      s.textContent = label[m] || m;
      zone.appendChild(s);
    }
    const on = !!me.twofa;
    document.getElementById('twofa-state').textContent = on ? 'ON' : 'off';
    document.getElementById('twofa-off').hidden = on;
    document.getElementById('twofa-on').hidden = !on;
    document.getElementById('totp-setup').hidden = true;
    if (on) document.getElementById('twofa-kind').textContent = ({ totp: 'authenticator app', wallet: 'wallet signature', password: 'account password' })[me.twofa] || me.twofa;
    // the disable control matches the factor: a code for authenticator 2FA, the password for password-2FA, a signature (no field) for wallet 2FA
    document.getElementById('twofa-disable-code').style.display = (on && me.twofa === 'totp') ? '' : 'none';
    const dpw = document.getElementById('twofa-disable-pw'); if (dpw) dpw.hidden = !(on && me.twofa === 'password');
    document.getElementById('wallet-2fa-btn').disabled = !me.wallets.length;
    if (!me.wallets.length) document.getElementById('wallet-2fa-btn').title = 'Link a wallet first';
    const hasEmail = me.methods.includes('email'), hasWallet = me.wallets.length > 0;
    const aeb = document.getElementById('add-email-block'); if (aeb) { aeb.hidden = hasEmail; const f = document.getElementById('ae-factor'); if (f) f.hidden = me.twofa !== 'totp'; }
    const pwBtn = document.getElementById('pw-2fa-btn'); if (pwBtn) pwBtn.hidden = !(hasEmail && hasWallet); // password-2FA only makes sense for wallet sign-ins
    const pws = document.getElementById('pw2fa-setup'); if (pws) pws.hidden = true;
  } catch {}
}


/* ---------- full colour editor ----------
   Five controls, named the way a person thinks about a page rather than after CSS variables.
   Every pick runs through the solver in prefs.js, which may adjust it for readability; when that
   happens the field shows the value actually applied rather than silently disagreeing with itself. */
const THEME_CONTROLS = [
  { key: 'accent',     label: 'Accent',      sub: 'buttons, links, highlights', fallback: '#8ee000' },
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
        ' aria-label="' + c.label + ' colour as a hex code">' +
      '<span class="theme-applied" id="tc-note-' + c.key + '" role="status" aria-live="polite"></span>' +
    '</div>';
  }).join('');

  THEME_CONTROLS.forEach(c => {
    const pick = document.getElementById('tc-' + c.key);
    const hex = document.getElementById('tch-' + c.key);
    const note = document.getElementById('tc-note-' + c.key);
    const commit = (val) => {
      if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
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
      sendToast('Colours reset 🎨');
    });
  }
}

/* ---------- site prefs ---------- */
function initSitePrefs() {
  const p = window.SITE_PREFS || {};
  renderSwatches('site-accent-swatches', SITE_ACCENTS, (p.colors && p.colors.accent) || p.siteAccent || '', c => {
    applySitePrefs({ siteAccent: c, colors: { accent: c || undefined } }, true);
    initThemeEditor();
    sendToast(c ? 'Site re-themed for you 🖌️' : 'Back to classic green 💚');
  });
  initThemeEditor();
  const switches = [
    ['pref-confetti', 'confetti'],
    ['pref-ticker', 'ticker'],
    ['pref-music', 'musicResume'],
  ];
  for (const [id, key] of switches) {
    const el = document.getElementById(id);
    el.setAttribute('aria-checked', String((window.SITE_PREFS || {})[key] !== false));
    el.addEventListener('click', () => {
      const cur = el.getAttribute('aria-checked') === 'true';
      el.setAttribute('aria-checked', String(!cur));
      applySitePrefs({ [key]: !cur }, true);
      sendToast(!cur ? 'On ✅' : 'Off — noted');
    });
  }
}

/* ---------- tracker ---------- */
window.saveTrackerPrefs = function (prefs) {
  api('/api/profile', { method: 'POST', body: { tracker_prefs: prefs } }).catch(() => {});
};
async function runTracker(zone, address) {
  zone.innerHTML = '<p class="modal-note" aria-live="polite">Reading the chain… ⛓️</p>';
  const note = zone.firstChild;
  try {
    const r = await trackerReport(address, m => { note.textContent = '⛓️ ' + m; });
    renderTracker(zone, r, AUTH.user && AUTH.user.tracker_prefs);
  } catch (e) {
    zone.innerHTML = '<p class="modal-note">⚠️ Could not read this wallet right now — the explorer may be busy. Try again in a minute.</p>';
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
        '<button class="btn btn-primary btn-sm" id="cw-connect">Connect wallet 🔗</button>' +
        '<a class="btn btn-ghost btn-sm" href="/tracker.html">Or track any wallet 💼</a>' +
      '</div>';
    const c = document.getElementById('cw-connect');
    if (c) c.addEventListener('click', linkWallet);
    return;
  }
  if (wallets.length > 1) {
    sel.innerHTML = '<span class="modal-note" style="margin:0 0.4rem 0 0;">Wallet:</span>' +
      wallets.map(w => '<button class="copy-btn cw-pick" data-addr="' + esc(w) + '">' + esc(fmtShort(w)) + '</button>').join(' ');
    sel.querySelectorAll('.cw-pick').forEach(b => b.addEventListener('click', () => {
      sel.querySelectorAll('.cw-pick').forEach(x => x.classList.remove('lit'));
      b.classList.add('lit');
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
document.getElementById('totp-start-btn').addEventListener('click', startTotp);
document.getElementById('totp-confirm-btn').addEventListener('click', confirmTotp);
document.getElementById('wallet-2fa-btn').addEventListener('click', enableWallet2fa);
document.getElementById('twofa-disable-btn').addEventListener('click', disable2fa);
document.getElementById('add-email-form').addEventListener('submit', addEmail);
document.getElementById('pw-2fa-btn').addEventListener('click', () => { const b = document.getElementById('pw2fa-setup'); b.hidden = false; document.getElementById('pw2fa-pass').focus(); });
document.getElementById('pw2fa-confirm-btn').addEventListener('click', confirmPassword2fa);
document.getElementById('pw2fa-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmPassword2fa(); });

/* ---------- boot ---------- */
window.onAuthReady = function (user) {
  document.getElementById('signedout').hidden = !!user;
  document.getElementById('signedin').hidden = !user;
  if (!user) return;
  chosenAvatar = user.avatar || '🚀';
  chosenAccent = (user.theme && user.theme.accent) || '';
  chosenBg = (user.theme && user.theme.wall_bg) || '';
  myTheme = user.theme || {};
  document.getElementById('pf-avatar').textContent = chosenAvatar;
  const pfShow = document.getElementById('pf-username-show');
  pfShow.textContent = user.username;
  const oldOg = pfShow.parentElement.querySelector('.og-badge'); if (oldOg) oldOg.remove();
  if (user.og && window.ogBadge) pfShow.insertAdjacentHTML('afterend', ogBadge(user.og)); // your OG badge on your own dashboard header
  document.getElementById('pf-username').value = user.username;
  document.getElementById('pf-bio').value = user.bio || '';
  document.getElementById('pf-twitter').value = user.twitter || '';
  document.getElementById('pf-instagram').value = user.instagram || '';
  setWallLinks(user.username);
  if (!user.auto_named) { try { sessionStorage.removeItem('jsi:after-claim'); } catch {} } // a stale stash must never bounce a later, unrelated save
  const claiming = user.auto_named || location.hash === '#claim';
  document.getElementById('claim-banner').hidden = !claiming;
  if (claiming) document.getElementById('sec-account').open = true;
  renderAvatarPicker();
  renderSwatches('accent-swatches', ACCENTS, chosenAccent, c => { chosenAccent = c; saveWallColor({ accent: c }); });
  renderSwatches('bg-swatches', BGS, chosenBg, c => { chosenBg = c; saveWallColor({ wall_bg: c }); });
  renderImgSlot('avatar', myTheme.avatar_img);
  renderImgSlot('header', myTheme.header_img);
  renderImgSlot('background', myTheme.bg_img);
  initSitePrefs();
  loadMe();
  loadConnectedWallet();
};
