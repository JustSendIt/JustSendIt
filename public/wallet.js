/* ===== Universal EVM wallet connect (read-only) =====
 * Works with ANY injected EVM wallet via EIP-6963 multi-wallet discovery (MetaMask, Coinbase,
 * Rabby, Brave, OKX, Trust, Frame, Phantom-EVM, …) with a legacy window.ethereum fallback, plus
 * mobile deep-links that reopen this site inside a wallet's in-app browser for phones with no
 * injected provider. STRICTLY READ-ONLY: this layer only ever requests accounts + a signature
 * (personal_sign, gas-free, moves nothing). It NEVER sends a transaction. The one on-chain action
 * on the whole site (the opt-in swap) lives in chain.js and is user-signed in their own wallet.
 * Load this BEFORE chain.js / auth.js / profile.js. */
(function () {
  const LS_KEY = 'sendit_wallet_rdns';
  const discovered = new Map(); // key(rdns|uuid|name) -> { info, provider }

  function keyOf(info, provider) { return (info && (info.rdns || info.uuid || info.name)) || (provider === window.ethereum ? 'window.ethereum' : 'unknown'); }

  // --- EIP-6963 discovery ---
  window.addEventListener('eip6963:announceProvider', (e) => {
    const d = e.detail; if (!d || !d.info || !d.provider) return;
    discovered.set(keyOf(d.info, d.provider), { info: d.info, provider: d.provider });
  });
  function requestAnnounce() { try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch {} }
  requestAnnounce();
  // some wallets inject late — re-ask a couple of times
  setTimeout(requestAnnounce, 200);
  setTimeout(requestAnnounce, 1200);

  // --- legacy fallback: fold window.ethereum (and multi-provider array) into the list ---
  function foldLegacy() {
    const eth = window.ethereum;
    if (!eth) return;
    const legacyName = eth.isMetaMask ? 'MetaMask' : eth.isCoinbaseWallet ? 'Coinbase Wallet' : eth.isRabby ? 'Rabby' : eth.isTrust ? 'Trust Wallet' : eth.isBraveWallet ? 'Brave Wallet' : 'Browser Wallet';
    const arr = Array.isArray(eth.providers) && eth.providers.length ? eth.providers : [eth];
    for (const p of arr) {
      // skip if an EIP-6963 entry already exposes this exact provider object
      let dup = false; discovered.forEach(v => { if (v.provider === p) dup = true; });
      if (dup) continue;
      const nm = p.isMetaMask ? 'MetaMask' : p.isCoinbaseWallet ? 'Coinbase Wallet' : p.isRabby ? 'Rabby' : p.isTrust ? 'Trust Wallet' : p.isBraveWallet ? 'Brave Wallet' : legacyName;
      const kk = 'legacy:' + nm;
      if (!discovered.has(kk)) discovered.set(kk, { info: { name: nm, rdns: kk, icon: '' }, provider: p });
    }
  }

  function list() { foldLegacy(); return Array.from(discovered.values()).sort((a, b) => knownRank(a.info) - knownRank(b.info)); }
  const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  function hasInjected() { return list().length > 0; }

  // remembered provider (by rdns) so returning users reconnect without the picker
  function remembered() {
    let rdns = ''; try { rdns = localStorage.getItem(LS_KEY) || ''; } catch {}
    if (!rdns) return null;
    for (const v of list()) if ((v.info.rdns || v.info.name) === rdns) return v;
    return null;
  }
  function remember(v) { try { localStorage.setItem(LS_KEY, v.info.rdns || v.info.name || ''); } catch {} }

  let selected = null; // {info, provider}
  function get() { return (selected && selected.provider) || (window.ethereum || null); }
  function getInfo() { return selected ? selected.info : null; }
  function request(args) {
    const p = get();
    if (!p) return Promise.reject(new Error('No wallet connected'));
    return p.request(args);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => { if (window.sendToast) sendToast(m); };

  // --- curated registry of popular hot wallets, ordered by how well they fit THIS site (Robinhood Chain first) ---
  // `deep(full,bare)` → a mobile universal-link that reopens this page inside the wallet's in-app browser.
  // `get` → official download page. `chain:true` → natively supports Robinhood Chain (verified). `re` matches the
  // wallet's announced EIP-6963 name/rdns so a detected wallet gets branded + prioritized.
  const KNOWN = [
    { key: 'robinhood', name: 'Robinhood Wallet', emoji: '🪶', re: /robinhood/i, chain: true, badge: 'Supports Robinhood Chain', get: 'https://robinhood.com/wallet/' },
    { key: 'phantom', name: 'Phantom', emoji: '👻', re: /phantom/i, get: 'https://phantom.app/download', deep: (full, bare) => 'https://phantom.app/ul/browse/' + encodeURIComponent(full) + '?ref=' + encodeURIComponent(location.origin) },
    { key: 'metamask', name: 'MetaMask', emoji: '🦊', re: /metamask/i, get: 'https://metamask.io/download/', deep: (full, bare) => 'https://metamask.app.link/dapp/' + bare },
    { key: 'coinbase', name: 'Coinbase Wallet', emoji: '🔵', re: /coinbase/i, get: 'https://www.coinbase.com/wallet/downloads', deep: (full) => 'https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent(full) },
    { key: 'trust', name: 'Trust Wallet', emoji: '🛡️', re: /trust/i, get: 'https://trustwallet.com/download', deep: (full) => 'https://link.trustwallet.com/open_url?coin_id=60&url=' + encodeURIComponent(full) },
    { key: 'rabby', name: 'Rabby', emoji: '🐰', re: /rabby/i, get: 'https://rabby.io/' },
    { key: 'okx', name: 'OKX Wallet', emoji: '⭕', re: /okx|okex/i, get: 'https://www.okx.com/download', deep: (full) => 'https://www.okx.com/download?deeplink=' + encodeURIComponent('okx://wallet/dapp/url?dappUrl=' + encodeURIComponent(full)) },
    { key: 'rainbow', name: 'Rainbow', emoji: '🌈', re: /rainbow/i, get: 'https://rainbow.me/' },
  ];
  function knownFor(info) { const s = (info && (info.name + ' ' + (info.rdns || ''))) || ''; return KNOWN.find(k => k.re.test(String(s))) || null; }
  function knownRank(info) { const k = knownFor(info); return k ? KNOWN.indexOf(k) : 90; }

  // --- picker modal ---
  let overlay = null, resolver = null, lastFocus = null;
  function buildModal() {
    overlay = document.createElement('div');
    overlay.className = 'wc-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Connect a wallet');
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="wc-modal">' +
        '<button class="wc-x" type="button" aria-label="Close">✕</button>' +
        '<h2 class="wc-title">Connect a wallet</h2>' +
        '<p class="wc-note">🔒 <b>Read-only.</b> We only read your address &amp; token balances — <b>we can never move your funds</b> and will never ask you to approve a transaction to connect.</p>' +
        '<div class="wc-list" id="wc-list"></div>' +
        '<div class="wc-foot" id="wc-foot"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector('.wc-x').addEventListener('click', () => close(null));
    document.addEventListener('keydown', (e) => { if (!overlay.hidden && e.key === 'Escape') close(null); });
  }

  function badgeHTML(k) { return (k && k.badge) ? '<span class="wc-badge">✓ ' + esc(k.badge) + '</span>' : ''; }
  function renderList() {
    const wraps = list();
    const listEl = overlay.querySelector('#wc-list');
    const footEl = overlay.querySelector('#wc-foot');
    const detected = new Set(wraps.map(v => { const k = knownFor(v.info); return k ? k.key : null; }).filter(Boolean));
    listEl.innerHTML = '';
    // 1) wallets detected in this browser → one-tap Connect (popular ones sorted first, branded)
    if (wraps.length) {
      for (const v of wraps) {
        const k = knownFor(v.info);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wc-item' + (k && k.chain ? ' wc-feat' : '');
        const icon = v.info.icon
          ? '<img class="wc-ico" src="' + esc(v.info.icon) + '" alt="">'
          : '<span class="wc-ico wc-ico-emoji" aria-hidden="true">' + (k ? k.emoji : '👛') + '</span>';
        b.innerHTML = icon + '<span class="wc-name">' + esc(v.info.name || 'Wallet') + badgeHTML(k) + '</span><span class="wc-go" aria-hidden="true">Connect →</span>';
        b.addEventListener('click', () => finish(v));
        listEl.appendChild(b);
      }
    } else {
      listEl.innerHTML = '<p class="wc-empty">No wallet detected in this browser.</p>';
    }
    // 2) popular hot wallets you don't have here yet → open in-app (mobile) or get the app
    const mobile = isMobile();
    const full = location.href, bare = location.host + location.pathname + location.search;
    const undetected = KNOWN.filter(k => !detected.has(k.key));
    footEl.innerHTML = '';
    if (undetected.length) {
      footEl.innerHTML = '<div class="wc-sub">' + (wraps.length ? 'More popular wallets' : (mobile ? '📱 Open this page in your wallet app' : 'Popular wallets — get one, then reload')) + '</div>';
      for (const k of undetected) {
        const a = document.createElement('a');
        a.rel = 'noopener nofollow';
        let label;
        if (mobile && k.deep) { a.href = k.deep(full, bare); label = 'Open ↗'; }
        else { a.href = k.get; a.target = '_blank'; label = mobile ? 'Get app ↗' : 'Get ↗'; }
        a.className = 'wc-deep' + (k.chain ? ' wc-feat' : '');
        a.innerHTML = '<span class="wc-ico wc-ico-emoji" aria-hidden="true">' + k.emoji + '</span><span class="wc-name">' + esc(k.name) + badgeHTML(k) + '</span><span class="wc-go" aria-hidden="true">' + label + '</span>';
        footEl.appendChild(a);
      }
      // Robinhood Wallet is the only major hot wallet that natively supports Robinhood Chain — call it out
      if (!detected.has('robinhood')) {
        const tip = document.createElement('p');
        tip.className = 'wc-tip';
        tip.innerHTML = '🪶 <b>On Robinhood Chain?</b> Robinhood Wallet supports it natively — get the app, then open this page in its in-app <b>Web3 browser</b>.';
        footEl.appendChild(tip);
      }
    }
  }

  function openPicker() {
    if (!overlay) buildModal();
    renderList();
    // keep re-rendering briefly as late wallets announce
    let ticks = 0; const iv = setInterval(() => { if (overlay.hidden || ++ticks > 8) { clearInterval(iv); return; } renderList(); }, 350);
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    const first = overlay.querySelector('.wc-item, .wc-deep, .wc-x'); if (first) first.focus();
    if (window.trapFocus) { try { window.trapFocus(overlay.querySelector('.wc-modal')); } catch {} }
    return new Promise((res) => { resolver = res; });
  }
  function close(v) {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch {} }
    const r = resolver; resolver = null;
    if (r) r(v || null);
  }
  function finish(v) { selected = v; remember(v); close(v); }

  // Public: open the picker and resolve with the chosen provider wrapper (or null if dismissed)
  function pick() { return openPicker(); }

  // Public: connect (read-only) — returns { provider, address, info }.
  async function connect() {
    // fast path: a single wallet, or a remembered one, connects without the picker
    const all = list();
    let chosen = selected;
    if (!chosen) chosen = remembered();
    if (!chosen && all.length === 1) chosen = all[0];
    if (!chosen) {
      chosen = await openPicker();
      if (!chosen) throw new Error('cancelled');
    }
    selected = chosen; remember(chosen);
    const accts = await chosen.provider.request({ method: 'eth_requestAccounts' });
    if (!accts || !accts[0]) throw new Error('No account authorized');
    return { provider: chosen.provider, address: accts[0], info: chosen.info };
  }

  function forget() { selected = null; try { localStorage.removeItem(LS_KEY); } catch {} }

  /* The curated registry, exposed so other surfaces (the How-to-Buy guide) can render the SAME list the
     picker shows. Copied, not shared, so a caller cannot mutate the registry the picker depends on. */
  function known() { return KNOWN.map(k => ({ key: k.key, name: k.name, emoji: k.emoji, get: k.get, chain: !!k.chain, badge: k.badge || '' })); }
  window.WALLET = { list, get, getInfo, request, connect, pick, forget, isMobile, hasInjected, known };
})();
