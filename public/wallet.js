/* ===== Universal EVM wallet connect (read-only) =====
 * Works with ANY injected EVM wallet via EIP-6963 multi-wallet discovery (MetaMask, Coinbase,
 * Rabby, Brave, OKX, Trust, Frame, Phantom-EVM, …) with a legacy window.ethereum fallback, plus
 * mobile deep-links that reopen this site inside a wallet's in-app browser for phones with no
 * injected provider. STRICTLY READ-ONLY: this layer only ever requests accounts + a signature
 * (personal_sign, gas-free, moves nothing). It NEVER sends a transaction. The one on-chain action
 * on the whole site (the opt-in swap) lives in chain.js and is user-signed in their own wallet.
 * A wallet that cannot sign at all (GMGN's), or one not on the list, is pointed at the burn proof
 * (burnproof.js): the member sends $SEND to the burn address from their own wallet app, and the
 * server only reads the chain. Nothing here builds or sends that transaction either.
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

  // the provider this browser used last (by rdns): marked "Last used" and focused first in the list; the swap reuses it
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

  /* --- the registry of wallets, ordered by how well they fit THIS site (Robinhood Chain first) ---
     Every wallet that injects an EIP-6963 / window.ethereum provider (an extension, or this page opened in the wallet app's
     own browser) connects here the same way — one personal_sign — so a wallet not named below still works; the list is for
     branding, ranking, and the download / open links. Owner, 2026-10-20: "add all wallets on the open market … abiding by the read-only sign rules": every entry
     goes through that one read-only path, none through a wallet's own SDK.
     The picker lists them all; the home guide shows the first FEATURED at once and the rest behind "Show all". `deep(full,bare)` → a mobile
     universal-link that reopens this page inside the wallet's in-app browser (only ones measured to work). `get` → the
     official download page (each one checked to answer and still offer the wallet, 2026-10-20). `chain:true` → ships
     Robinhood Chain (Robinhood Wallet, Phantom, Rabby and the Coinbase Wallet app verified 2026-10-09; Uniswap Wallet per
     Uniswap's launch post of 2026-07-02). `re` matches the wallet's announced EIP-6963 name/rdns so a detected wallet gets
     branded + prioritized. A wallet with no injected provider and no in-app browser (a WalletConnect-only app such as
     Kraken Wallet, a bare hardware wallet such as a Ledger, Exodus since it dropped both in Oct 2026) is left out: it has
     no way to connect here; Ctrl Wallet (ex-XDEFI) shut down in Aug 2026. */
  const FEATURED = 8;
  const KNOWN = [
    { key: 'robinhood', name: 'Robinhood Wallet', emoji: '🪶', re: /robinhood/i, chain: true, badge: 'Supports Robinhood Chain', get: 'https://robinhood.com/wallet/' },
    { key: 'phantom', name: 'Phantom', emoji: '👻', re: /phantom/i, chain: true, badge: 'Supports Robinhood Chain', get: 'https://phantom.com/download', deep: (full, bare) => 'https://phantom.app/ul/browse/' + encodeURIComponent(full) + '?ref=' + encodeURIComponent(location.origin) },
    /* GMGN holds its wallets for you and gives no way to sign a message for another site, so it cannot connect here.
       `burn`: in the main list wherever a wallet is being proved (connect({ burn: true })), and its row opens Burn
       Verification — the way it CAN be proved. If it ever announces a provider of its own, that is tried like any wallet. */
    { key: 'gmgn', name: 'GMGN', emoji: '📈', re: /gmgn/i, burn: true, badge: 'Verifies by a burn — no signature', get: 'https://gmgn.ai/' },
    { key: 'metamask', name: 'MetaMask', emoji: '🦊', re: /metamask/i, get: 'https://metamask.io/download/', deep: (full, bare) => 'https://metamask.app.link/dapp/' + bare },
    { key: 'coinbase', name: 'Coinbase Wallet', emoji: '🔵', re: /coinbase/i, chain: true, badge: 'Supports Robinhood Chain', get: 'https://www.coinbase.com/wallet/downloads', deep: (full) => 'https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent(full) },
    { key: 'trust', name: 'Trust Wallet', emoji: '🛡️', re: /trust ?wallet|trustwallet/i, get: 'https://trustwallet.com/download', deep: (full) => 'https://link.trustwallet.com/open_url?coin_id=60&url=' + encodeURIComponent(full) },
    { key: 'rabby', name: 'Rabby', emoji: '🐰', re: /rabby/i, chain: true, badge: 'Supports Robinhood Chain', get: 'https://rabby.io/' },
    { key: 'okx', name: 'OKX Wallet', emoji: '⭕', re: /okx|okex/i, get: 'https://www.okx.com/download', deep: (full) => 'https://www.okx.com/download?deeplink=' + encodeURIComponent('okx://wallet/dapp/url?dappUrl=' + encodeURIComponent(full)) },
    { key: 'rainbow', name: 'Rainbow', emoji: '🌈', re: /rainbow/i, get: 'https://rainbow.me/' },
    // ...and the rest of the market, alphabetically
    { key: '1inch', name: '1inch Wallet', emoji: '1️⃣', re: /1inch/i, get: 'https://1inch.com/wallet' },
    { key: 'ambire', name: 'Ambire', emoji: '🅰️', re: /ambire/i, get: 'https://www.ambire.com/' },
    { key: 'backpack', name: 'Backpack', emoji: '🎒', re: /backpack/i, get: 'https://backpack.app/' },
    { key: 'binance', name: 'Binance Wallet', emoji: '🟨', re: /binance/i, get: 'https://www.binance.com/en/web3wallet' },
    { key: 'bitget', name: 'Bitget Wallet', emoji: '🅱️', re: /bitget|bitkeep/i, get: 'https://web3.bitget.com/' },
    { key: 'brave', name: 'Brave Wallet', emoji: '🦁', re: /brave/i, get: 'https://brave.com/wallet/' },
    { key: 'coin98', name: 'Coin98', emoji: '🟡', re: /coin98/i, get: 'https://coin98.com/wallet' },
    { key: 'core', name: 'Core', emoji: '🔺', re: /\bcore\b|app\.core|avalanche/i, get: 'https://core.app/' },
    { key: 'cryptocom', name: 'Crypto.com Onchain', emoji: '💠', re: /crypto\.com|cdcwallet|com\.crypto\.wallet/i, get: 'https://crypto.com/onchain' },
    { key: 'enkrypt', name: 'Enkrypt', emoji: '🔐', re: /enkrypt/i, get: 'https://www.enkrypt.com/' },
    { key: 'frame', name: 'Frame', emoji: '🖼️', re: /\bframe\b/i, get: 'https://frame.sh/' },
    { key: 'imtoken', name: 'imToken', emoji: '🔷', re: /imtoken/i, get: 'https://token.im/' },
    { key: 'keplr', name: 'Keplr', emoji: '🌌', re: /keplr/i, get: 'https://www.keplr.app/' },
    { key: 'magiceden', name: 'Magic Eden Wallet', emoji: '🪄', re: /magic ?eden/i, get: 'https://wallet.magiceden.io/' },
    { key: 'mathwallet', name: 'MathWallet', emoji: '➗', re: /math ?wallet/i, get: 'https://mathwallet.org/' },
    { key: 'mew', name: 'MEW wallet', emoji: '🐱', re: /\bmew\b|myetherwallet/i, get: 'https://www.mewwallet.com/' },
    { key: 'nightly', name: 'Nightly', emoji: '🌙', re: /nightly/i, get: 'https://nightly.app/' },
    { key: 'safepal', name: 'SafePal', emoji: '🔒', re: /safepal/i, get: 'https://www.safepal.com/' },
    { key: 'taho', name: 'Taho', emoji: '🐾', re: /taho|tally ?ho/i, get: 'https://taho.xyz/' },
    { key: 'talisman', name: 'Talisman', emoji: '🧿', re: /talisman/i, get: 'https://talisman.xyz/' },
    { key: 'tokenpocket', name: 'TokenPocket', emoji: '👝', re: /tokenpocket|token ?pocket/i, get: 'https://www.tokenpocket.pro/' },
    { key: 'uniswap', name: 'Uniswap Wallet', emoji: '🦄', re: /uniswap/i, chain: true, badge: 'Supports Robinhood Chain', get: 'https://wallet.uniswap.org/' },
    { key: 'zerion', name: 'Zerion', emoji: '🟣', re: /zerion/i, get: 'https://zerion.io/' },
  ];
  function knownFor(info) { const s = (info && (info.name + ' ' + (info.rdns || ''))) || ''; return KNOWN.find(k => k.re.test(String(s))) || null; }
  function knownRank(info) { const k = knownFor(info); return k ? KNOWN.indexOf(k) : 90; }

  // --- picker modal ---
  let overlay = null, resolver = null, lastFocus = null, releaseTrap = null, prevOverflow = '', pickOpts = {};
  // the way for a wallet that cannot sign, or is not listed: close the picker (the caller hears a quiet 'cancelled') and open the burn proof
  function toBurn(key) {
    close(null);
    if (window.AUTH && AUTH.openBurnProof) AUTH.openBurnProof({ wallet: key || '' });
  }
  function buildModal() {
    overlay = document.createElement('div');
    overlay.className = 'wc-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Connect a wallet');
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="wc-modal">' +
        '<button class="wc-x" type="button" aria-label="Close" data-tip="Closes the wallet picker without connecting anything">✕</button>' +
        '<h2 class="wc-title">Connect a wallet</h2>' +
        '<p class="wc-note">🔒 <b>Read-only.</b> We only read your address &amp; token balances — <b>we can never move your funds</b> and will never ask you to approve a transaction to connect. Any wallet that shows up in this browser — an extension, or this page opened in the wallet app’s own browser — connects the same way: one signed message, never a transaction. A wallet that only pairs by QR code can’t connect here.</p>' +
        '<div class="wc-list" id="wc-list"></div>' +
        '<div class="wc-foot" id="wc-foot"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector('.wc-x').addEventListener('click', () => close(null));
    /* Captured, and stopped there: the picker is the topmost layer whenever it is up, so Esc is its alone.
       As a plain bubbling listener it ran alongside the sign-in modal's and the ticket's own Esc handlers,
       and whichever of those registered later fired too — closing the thing beneath the picker as well. */
    document.addEventListener('keydown', (e) => { if (!overlay.hidden && e.key === 'Escape') { e.stopPropagation(); close(null); } }, true);
  }

  function badgeHTML(k) { return (k && k.badge) ? '<span class="wc-badge">' + (k.burn ? '🔥 ' : '✓ ') + esc(k.badge) + '</span>' : ''; }   // a tick says "works here"; the burn row's badge says why it doesn't
  function renderList() {
    const wraps = list();
    const listEl = overlay.querySelector('#wc-list');
    const footEl = overlay.querySelector('#wc-foot');
    const detected = new Set(wraps.map(v => { const k = knownFor(v.info); return k ? k.key : null; }).filter(Boolean));
    listEl.innerHTML = '';
    // 1) wallets detected in this browser → one-tap Connect (popular ones sorted first, branded)
    if (wraps.length) {
      const last = remembered();
      for (const v of wraps) {
        const k = knownFor(v.info);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wc-item' + (k && k.chain ? ' wc-feat' : '');
        const icon = v.info.icon
          ? '<img class="wc-ico" src="' + esc(v.info.icon) + '" alt="">'
          : '<span class="wc-ico wc-ico-emoji" aria-hidden="true">' + (k ? k.emoji : '👛') + '</span>';
        b.innerHTML = icon + '<span class="wc-name">' + esc(v.info.name || 'Wallet') + badgeHTML(k && !k.burn ? k : null) + (v === last ? '<span class="wc-badge wc-last">Last used</span>' : '') + '</span><span class="wc-go" aria-hidden="true">Connect →</span>';   // a detected one is tried like any wallet: no "can't sign" badge on it
        b.setAttribute('data-tip', 'Connects using this wallet');
        if (v === last) b.setAttribute('data-last', '');
        b.addEventListener('click', () => finish(v));
        listEl.appendChild(b);
      }
    } else {
      listEl.innerHTML = '<p class="wc-empty">No wallet detected in this browser.' + (pickOpts.burn ? ' Using GMGN, or a wallet inside an app? Prove it by a burn — below.' : '') + '</p>';
    }
    // 2) popular hot wallets you don't have here yet → open in-app (mobile) or get the app
    const mobile = isMobile();
    const full = location.href, bare = location.host + location.pathname + location.search;
    const undetected = KNOWN.filter(k => !detected.has(k.key) && (!k.burn || pickOpts.burn));   // GMGN only where a wallet is being proved
    footEl.innerHTML = '';
    if (undetected.length) {
      footEl.innerHTML = '<div class="wc-sub">' + (wraps.length ? 'More wallets' : (mobile ? '📱 Open this page in a wallet app’s own browser — or get one' : 'Wallets — get one, then reload')) + '</div>';
      const row = (k) => {
        if (k.burn) {   // GMGN: cannot sign here, so its row opens Burn Verification instead of a download page
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'wc-deep wc-burn';
          b.innerHTML = '<span class="wc-ico wc-ico-emoji" aria-hidden="true">' + k.emoji + '</span><span class="wc-name">' + esc(k.name) + badgeHTML(k) + '</span><span class="wc-go" aria-hidden="true">Verify 🔥</span>';
          b.setAttribute('data-tip', 'Opens Burn Verification: send the exact dust amount of $SEND it shows from your ' + k.name + ' wallet to the burn address, instead of signing');
          b.addEventListener('click', () => toBurn(k.key));
          return b;
        }
        const a = document.createElement('a');
        a.rel = 'noopener nofollow';
        let label;
        if (mobile && k.deep) { a.href = k.deep(full, bare); label = 'Open ↗'; }
        else { a.href = k.get; a.target = '_blank'; label = 'Get ↗'; }
        a.className = 'wc-deep' + (k.chain ? ' wc-feat' : '');
        a.innerHTML = '<span class="wc-ico wc-ico-emoji" aria-hidden="true">' + k.emoji + '</span><span class="wc-name">' + esc(k.name) + badgeHTML(k) + '</span><span class="wc-go" aria-hidden="true">' + label + '</span>';
        return a;
      };
      // every wallet on the market, the best-fitting first (owner: all of them visible where people sign up)
      for (const k of undetected) footEl.appendChild(row(k));
      // wallets that ship Robinhood Chain are called out; most other EVM wallets can add it (chain id 4663), a few run a fixed list
      if (!detected.has('robinhood')) {
        const tip = document.createElement('p');
        tip.className = 'wc-tip';
        tip.innerHTML = '🪶 <b>On Robinhood Chain?</b> Robinhood Wallet, Phantom, Rabby, Coinbase Wallet and Uniswap Wallet ship it. Most other wallets here can add the network (chain ID 4663); a few run a fixed list and can\'t. On a phone, open this page in the wallet\'s in-app <b>Web3 browser</b>.';
        footEl.appendChild(tip);
      }
    }
    // 3) a wallet that is not on this list, or cannot sign: Burn Verification (only where a wallet is being proved)
    if (pickOpts.burn) {
      const sub = document.createElement('div');
      sub.className = 'wc-sub';
      sub.textContent = 'Not on the list, or can’t sign?';
      footEl.appendChild(sub);
      const any = document.createElement('button');
      any.type = 'button';
      any.className = 'wc-deep wc-burn';
      any.innerHTML = '<span class="wc-ico wc-ico-emoji" aria-hidden="true">🔥</span><span class="wc-name">My wallet isn’t listed, or can’t sign</span><span class="wc-go" aria-hidden="true">Verify 🔥</span>';
      any.setAttribute('data-tip', 'Opens Burn Verification for any wallet: send the exact dust amount of $SEND shown from it to the burn address, within an hour');
      any.addEventListener('click', () => toBurn(''));
      footEl.appendChild(any);
    }
  }

  function openPicker(opts) {
    pickOpts = opts || {};
    if (!overlay) buildModal();
    renderList();
    // late wallets announce for a moment after opening: redraw only when the announced set changed, so a redraw never takes the focus
    const sig = () => list().map((v) => keyOf(v.info, v.provider)).join('|');
    let ticks = 0, last = sig();
    const iv = setInterval(() => { if (overlay.hidden || ++ticks > 8) { clearInterval(iv); return; } const s = sig(); if (s !== last) { last = s; renderList(); } }, 350);
    lastFocus = document.activeElement;
    overlay.hidden = false;
    if (window.SFX) SFX.play('open');
    prevOverflow = document.body.style.overflow;   // the sign-in modal or the ticket beneath may hold the scroll lock — hand it back, not ''
    document.body.style.overflow = 'hidden';
    // the wallet this browser used last, else its first wallet, else the first in the list: one press, as before the list opened every time
    const first = overlay.querySelector('.wc-item[data-last]') || overlay.querySelector('.wc-item') || overlay.querySelector('.wc-deep') || overlay.querySelector('.wc-x');
    if (first) first.focus();
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }   // never stack a second trap on the same card
    if (window.trapFocus) { try { releaseTrap = window.trapFocus(overlay.querySelector('.wc-modal')); } catch {} }
    return new Promise((res) => { resolver = res; });
  }
  function close(v) {
    if (!overlay) return;
    overlay.hidden = true;
    if (!v && window.SFX) SFX.play('close');
    document.body.style.overflow = prevOverflow;
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch {} }
    const r = resolver; resolver = null;
    if (r) r(v || null);
  }
  function finish(v) { selected = v; remember(v); close(v); }

  // Public: open the picker and resolve with the chosen provider wrapper (or null if dismissed)
  function pick(opts) { return openPicker(opts); }

  /* Public: connect (read-only) — returns { provider, address, info }. opts.burn: this connect PROVES a wallet (sign-in,
     sign-up, linking), so the picker also offers the burn proof for a wallet that cannot sign or is not listed. Left off
     where a particular wallet's own signature is the point (two-factor, "confirm it's you"). */
  async function connect(opts) {
    const all = list();
    let chosen = null;
    /* Proving a wallet (sign-in, sign-up, linking) always shows the list: every wallet on the market, the ones this
       browser has at the top and focused — so a browser with one wallet installed still sees the rest, GMGN and the burn
       proof (owner, 2026-10-20: "I don't see all the new wallets in the sign-up screen"). Where one particular wallet
       has to sign (two-factor, "confirm it's you"), an only wallet connects without the list (opts.choose). */
    if (opts && opts.choose) {
      // one particular wallet has to sign (two-factor, "confirm it's you"): only an only-wallet is assumed — with several, the
      // person picks (the one used last focused), or a wallet linked a minute ago would be asked and refused, again and again
      if (all.length === 1) chosen = all[0];
    } else if (!(opts && opts.burn)) {
      chosen = selected || remembered();   // the swap: the wallet in use
      if (!chosen && all.length === 1) chosen = all[0];
    }
    if (!chosen) {
      chosen = await openPicker(opts);
      if (!chosen) throw new Error('cancelled');
    }
    selected = chosen; remember(chosen);
    let accts;
    try { accts = await chosen.provider.request({ method: 'eth_requestAccounts' }); }
    catch (e) { throw explain(e, opts); }
    if (!accts || !accts[0]) throw new Error('No account authorized');
    /* EVERY connect lands on Robinhood Chain — sign-in, linking a wallet, and the swap alike. It used to
       be the swap's job alone, so somebody who connected from anywhere else stayed on whatever network
       their wallet happened to be showing, and the site read their balances and holdings on a chain they
       were not on: no tokens, no Holder Boost, nothing wrong on screen to explain it.

       Deliberately NOT fatal. The signature that proves a wallet is yours is chain-agnostic, so refusing
       the switch must not refuse the sign-in — it would be a worse outcome than the one being fixed. The
       result rides along as chainOk so a caller can say something useful, and ensureRobinhoodChain asks
       eth_chainId before prompting, so a wallet already on the right chain is never interrupted. */
    let chainOk = null;
    try { if (typeof window.ensureRobinhoodChain === 'function') chainOk = await window.ensureRobinhoodChain(chosen.provider, 'connect'); }
    catch { chainOk = false; }
    /* The person who declined the prompt, or whose wallet is locked: say so — connect() is where the account was asked
       for, so that refusal is a cancelled connect, not a chain problem. (eth_requestAccounts threw above; this is only
       reached when it answered.) */
    return { provider: chosen.provider, address: accts[0], info: chosen.info, chainOk: chainOk };
  }

  function forget() { selected = null; try { localStorage.removeItem(LS_KEY); } catch {} }

  /* ---- signing (read-only): one way, for every wallet ----
     personal_sign's first parameter is DATA (EIP-191): the message's bytes, as hex. MetaMask and most wallets also
     accept the plain text, but some refuse anything but hex ("message must be a hex string") — so the message goes
     as hex everywhere, and a wallet that unexpectedly wants the text gets it on one more try. The wallet shows the
     decoded text either way, and MetaMask still recognises the EIP-4361 sign-in message in it. The answer is passed
     back as the wallet gave it: 65 bytes from a key, longer from a smart-contract wallet (ERC-1271 / ERC-6492) — the
     server checks both. */
  const utf8Hex = (s) => '0x' + Array.from(new TextEncoder().encode(String(s)), (b) => b.toString(16).padStart(2, '0')).join('');
  const isHexSig = (s) => typeof s === 'string' && /^0x[0-9a-fA-F]{2,}$/.test(s);
  const wantsText = (e) => { const m = String((e && e.message) || ''); return (e && (e.code === -32602 || e.code === -32000)) || /invalid param|must be a (utf-?8 )?string|not a hex|expected string/i.test(m); };
  async function sign(provider, address, message, opts) {   // opts.burn: proving a wallet — a refusal may point at the burn proof
    const p = provider || get();
    if (!p) throw new Error('No wallet connected');
    let sig;
    try {
      try { sig = await p.request({ method: 'personal_sign', params: [utf8Hex(message), address] }); }
      catch (e) { if (!wantsText(e)) throw e; sig = await p.request({ method: 'personal_sign', params: [String(message), address] }); }
    } catch (e) { throw explain(e, opts); }
    if (!isHexSig(sig)) throw new Error('the wallet did not return a signature — try again, or try another wallet');
    return sig;
  }
  /* What a wallet's refusal means, in words a person can act on. Codes are EIP-1193 / EIP-1474; the message
     tests cover wallets that use the code loosely. 'cancelled' is what every caller already treats as "say
     nothing": the person closed the prompt themselves. Anything unrecognised is passed on as the wallet said it. */
  function explain(e, opts) {
    // the words come from strings only: a wallet that rejects with a bare object (a code, a nested data.message) must not become "[object Object]"
    const code = e && e.code, m = typeof e === 'string' ? e : String((e && (e.message || (e.data && e.data.message))) || '');
    if (m === 'cancelled') return e;
    if (code === 4001 || /user (rejected|denied|cancel|declined)|rejected the request|denied (message|transaction|account)/i.test(m)) return new Error('cancelled');
    if (code === -32002 || /already pending|request already|already (processing|in progress)/i.test(m)) return Object.assign(new Error('Your wallet already has a request open — open the wallet, approve or dismiss it, then try again.'), { code });
    if (code === 4100 || code === 4200 || /unsupported method|method not (supported|found)|unauthorized/i.test(m)) return Object.assign(new Error('This wallet can’t sign a message here — try another wallet' + (opts && opts.burn ? ', or prove it by a burn instead (🔥 below the wallet button, or in Settings → Security).' : '.')), { code });   // the burn hint only where a burn can stand in: never for two-factor or "confirm it's you"
    if (code === 4900 || code === 4901 || /disconnected|not connected|no accounts|unlock/i.test(m)) return Object.assign(new Error('Your wallet is locked or disconnected — unlock it, then try again.'), { code });
    const out = new Error(m.replace(/^(MetaMask|Coinbase Wallet|Phantom|Rabby|Trust Wallet)[^:]*:\s*/i, '').trim() || 'the wallet could not do that');
    if (code !== undefined) out.code = code;
    return out;
  }

  /* The curated registry, exposed so other surfaces (the How-to-Buy guide) can render the SAME list the
     picker shows. Copied, not shared, so a caller cannot mutate the registry the picker depends on. */
  function known() { return KNOWN.map((k, i) => ({ key: k.key, name: k.name, emoji: k.emoji, get: k.get, chain: !!k.chain, burn: !!k.burn, badge: k.badge || '', featured: i < FEATURED })); }   // every wallet the list names, GMGN (burn: verified by a burn) included
  window.WALLET = { list, get, getInfo, request, connect, pick, forget, isMobile, hasInjected, known, sign, explain };
})();
