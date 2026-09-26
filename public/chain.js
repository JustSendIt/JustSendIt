/* ===== Robinhood Chain + token data layer ===== */
const RH_CHAIN = {
  id: 4663,
  hexId: '0x1237',
  name: 'Robinhood Chain',
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://robinhoodchain.blockscout.com',
  currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
};

const TOKENS = {
  SEND: {
    symbol: 'SEND', name: 'SEND IT',
    address: '0xa40a9C0e2E9bf7a3b9deb9ebed2b59E77d01e105',
    pair: '0xf30Bb531d0255969be155533AbAC34b22bD63414',
    decimals: 18,
    dexscreener: 'https://dexscreener.com/robinhood/0xf30bb531d0255969be155533abac34b22bd63414',
  },
  GWC: {
    symbol: 'GWC', name: 'Generational Wealth Coin',
    address: '0x61339F11384dDe4B2dc3a33E75B4dc23Cc620F22',
    pair: '0x22Df73eEf683a93680DFF3b51fDf3eE91e7352d9',
    decimals: 18,
    dexscreener: 'https://dexscreener.com/robinhood/0x22df73eef683a93680dff3b51fdf3ee91e7352d9',
  },
};

const ROUTER = '0x89e5DB8B5aA49aA85AC63f691524311AEB649eba'; // Uniswap v2-style router on Robinhood Chain
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
// Freeze the swap constants so nothing (a later bug, a rogue extension sharing the page) can mutate the
// router/token/pair addresses the swap tx is built from. Defense-in-depth — the only value-moving tx reads these.
Object.freeze(TOKENS); Object.freeze(TOKENS.SEND); Object.freeze(TOKENS.GWC);

/* ---- ABI encoding helpers (vanilla, no libs) ---- */
function w256(hexOrBig) {
  const h = typeof hexOrBig === 'bigint' ? hexOrBig.toString(16) : String(hexOrBig).replace('0x', '');
  return h.padStart(64, '0');
}
function addrWord(a) { return w256(a.toLowerCase().replace('0x', '')); }

function parseEth(str) {
  // decimal string -> wei BigInt, precision-safe
  const s = String(str).trim();
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const [whole = '0', frac = ''] = s.split('.');
  const fracPadded = (frac + '0'.repeat(18)).slice(0, 18);
  return BigInt(whole || '0') * 10n ** 18n + BigInt(fracPadded || '0');
}

async function quoteEthToToken(tokenKey, weiIn) {
  const t = TOKENS[tokenKey];
  const data = '0x' + 'd06ca61f' + w256(weiIn) + w256(0x40n) + w256(2n) + addrWord(WETH) + addrWord(t.address);
  const res = await rpcCall('eth_call', [{ to: ROUTER, data }, 'latest']);
  const words = res.replace('0x', '').match(/.{64}/g) || [];
  return BigInt('0x' + (words[words.length - 1] || '0'));
}

function buildSwapCalldata(tokenKey, minOut, recipient) {
  // swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)
  const t = TOKENS[tokenKey];
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
  return '0x' + 'b6f9de95' +
    w256(minOut) +           // amountOutMin
    w256(0x80n) +            // offset to path array
    addrWord(recipient) +    // to
    w256(deadline) +         // deadline
    w256(2n) +               // path length
    addrWord(WETH) + addrWord(t.address);
}

// use the wallet the user picked via the universal connect layer (falls back to window.ethereum)
function wprov() { return (window.WALLET && WALLET.get()) || window.ethereum || null; }
async function walletConnect() {
  if (window.WALLET) return WALLET.connect();
  if (!window.ethereum) throw new Error('no wallet');
  const a = await window.ethereum.request({ method: 'eth_requestAccounts' });
  return { provider: window.ethereum, address: a && a[0] };
}

/* Put a wallet on Robinhood Chain, adding the network if it has never seen it.
   `prov` is explicit so this acts on the wallet that was actually just connected. It used to always read
   wprov(), which answers with WALLET.get() or window.ethereum — in a browser with two wallets installed
   that can be a DIFFERENT provider from the one the picker just returned, so the switch prompt would
   land in the wrong wallet.
   `why` only changes the wording of the refusal toast: this is called from the swap AND from every
   connect now, and "switch to Robinhood Chain to swap" is the wrong sentence when nobody is swapping. */
async function ensureRobinhoodChain(prov, why) {
  const p = prov || wprov(); if (!p) { sendToast('No wallet connected 🔌'); return false; }
  /* Ask before telling. Most wallets no-op a switch to the chain they are already on, but some show a
     prompt anyway — and a pointless confirmation on every single connect is exactly the friction this
     is meant to remove. */
  try {
    const cur = await p.request({ method: 'eth_chainId' });
    if (String(cur).toLowerCase() === RH_CHAIN.hexId.toLowerCase()) return true;
  } catch {}
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: RH_CHAIN.hexId }] });
    return true;
  } catch (e) {
    if (e && (e.code === 4902 || (e.message || '').includes('Unrecognized'))) {
      return addRobinhoodChain(p);
    }
    if (e && e.code === 4001) sendToast(why === 'swap' ? 'Switch to Robinhood Chain to swap 🟢' : 'Stay on Robinhood Chain to see your balances 🟢');
    return false;
  }
}

/*
 * In-page swap: native ETH -> token through the chain's existing public
 * Uniswap v2 router. No custom contracts, no approvals needed for ETH-in;
 * the user reviews and signs everything in their own wallet.
 */
async function executeSwap(tokenKey, ethAmountStr, slippagePct) {
  // every message goes to the toast AND the swap panel's inline status line, so a failure reason doesn't vanish in 2.6s
  const say = (m, kind) => { sendToast(m); if (typeof window.swapStatus === 'function') window.swapStatus(m, kind || 'error'); };
  const weiIn = parseEth(ethAmountStr);
  if (!weiIn || weiIn <= 0n) { say('Enter an ETH amount first ✍️'); return; }
  let address, provider;
  try { const c = await walletConnect(); address = c.address; provider = c.provider; }
  catch (e) { if (e && e.message !== 'cancelled') say('Connect your wallet to swap 🔌'); return; }
  if (!address) { say('Connect your wallet to swap 🔌'); return; }
  if (!(await ensureRobinhoodChain(null, 'swap'))) { if (typeof window.swapStatus === 'function') window.swapStatus('Switch your wallet to Robinhood Chain to swap ⛓️', 'error'); return; } // ensureRobinhoodChain already toasted — inline line only, no double announcement
  // balance pre-check: no ETH on this chain is the #1 first-timer failure — name it instead of a generic "rejected"
  const ethIn = toNum(weiIn, 18);
  let bal = null; try { bal = await ethBalance(address); } catch {}
  if (bal != null && bal < ethIn + 0.0003) { say('Not enough ETH on Robinhood Chain — this wallet has ' + bal.toFixed(4) + ' ETH and the swap needs ' + ethIn + ' plus a little gas. Bridge some over first 🌉'); return; }
  let quoted;
  try { quoted = await quoteEthToToken(tokenKey, weiIn); }
  catch (e) { say('Could not fetch a quote — try again 📡'); return; }
  const bps = BigInt(Math.round((100 - slippagePct) * 100));
  const minOut = quoted * bps / 10000n;
  const data = buildSwapCalldata(tokenKey, minOut, address);
  try {
    const hash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: address, to: ROUTER, value: '0x' + weiIn.toString(16), data }],
    });
    say('Swap sent! 🚀 Watch it on the explorer', 'ok');
    sendConfetti(innerWidth / 2, innerHeight / 2, { count: 70, emojiRatio: 0.4 });
    return hash;
  } catch (e) {
    if (e && e.code === 4001) say('Swap cancelled — nothing was sent', 'info');
    else say('Your wallet rejected the transaction 😬 — nothing left your wallet. Usual causes: not enough ETH for gas, or the price moved past the slippage guard. Try again.');
  }
}

/* ---- RPC helpers ---- */
async function rpcCall(method, params) {
  const res = await fetch(RH_CHAIN.rpc, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
function toNum(bi, decimals = 18) {
  return Number(bi) / 10 ** decimals;
}

/* ---- Dexscreener prices ----
   Read through THIS site (/api/chain/pairs), never from the browser: a direct call handed Dexscreener every
   visitor's IP address every 30 seconds for as long as the homepage was open. The server caches it, so one
   fetch serves everyone. */
async function fetchPairs() {
  const res = await fetch('/api/chain/pairs', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('prices ' + res.status);
  const j = await res.json();
  const out = {};
  for (const p of j.pairs || j.pair ? (j.pairs || [j.pair]) : []) {
    for (const key of Object.keys(TOKENS)) {
      if (p.pairAddress && p.pairAddress.toLowerCase() === TOKENS[key].pair.toLowerCase()) out[key] = p;
    }
  }
  return out;
}

function fmtUsd(n, small) {
  if (n == null || isNaN(n)) return '—';
  if (small && n > 0 && n < 0.001) {
    return '$' + Number(n).toPrecision(3).replace(/e-?\d+$/, m => '×10' + m.replace('e', ''));
  }
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 8 : 2 });
}

/* ---- landing page token cards ---- */
async function initTokenCards() {
  try {
    const pairs = await fetchPairs();
    for (const key of Object.keys(TOKENS)) {
      const p = pairs[key]; if (!p) continue;
      const price = document.getElementById('price-' + key);
      const chg = document.getElementById('chg-' + key);
      const liq = document.getElementById('liq-' + key);
      const vol = document.getElementById('vol-' + key);
      const fdv = document.getElementById('fdv-' + key);
      if (price) { price.textContent = fmtUsd(Number(p.priceUsd), true); price.classList.remove('skeleton'); }
      if (chg) {
        const c = p.priceChange && p.priceChange.h24 != null ? Number(p.priceChange.h24) : null;
        if (c != null) {
          chg.textContent = (c >= 0 ? '▲ +' : '▼ ') + c.toFixed(2) + '% (24h)';
          chg.classList.add(c >= 0 ? 'up' : 'down');
        } else chg.remove();
      }
      if (liq && p.liquidity) liq.innerHTML = 'Liquidity <b>' + fmtUsd(p.liquidity.usd) + '</b>';
      if (vol && p.volume) vol.innerHTML = '24h Vol <b>' + fmtUsd(p.volume.h24) + '</b>';
      if (fdv && p.fdv != null) fdv.innerHTML = 'FDV <b>' + fmtUsd(p.fdv) + '</b>';
      const src = document.getElementById('src-' + key); if (src) src.hidden = p.source !== 'reserves';   // say where a price came from when it is not the index
      // Dexscreener branding (logo + banner) so the cards match the token's on-chain listing
      const info = p.info || {};
      const logo = dexImg(info.imageUrl), banner = dexImg(info.header || info.openGraph);
      const emblem = document.getElementById('emblem-' + key);
      if (emblem && logo) {
        const im = document.createElement('img'); im.className = 'tok-logo-img'; im.alt = ''; im.loading = 'lazy'; im.decoding = 'async';
        im.addEventListener('error', () => { emblem.textContent = key === 'SEND' ? '$S' : '$G'; emblem.classList.remove('has-logo'); });
        emblem.textContent = ''; emblem.appendChild(im); emblem.classList.add('has-logo'); im.src = logo;
      }
      const bannerEl = document.getElementById('banner-' + key);
      if (bannerEl && banner) {
        const im = document.createElement('img'); im.className = 'tok-banner-img'; im.alt = ''; im.loading = 'lazy'; im.decoding = 'async';
        im.addEventListener('error', () => { bannerEl.hidden = true; });
        bannerEl.textContent = ''; bannerEl.appendChild(im); bannerEl.hidden = false; im.src = banner;
      }
    }
  } catch (e) { console.warn('price load failed', e); }
}
// only trust Dexscreener's own CDN (matches the CSP img-src allow-list) and reject any URL that could break out of markup
// token artwork arrives as our own /api/img path (the server rewrites every CDN URL it sends); a raw CDN URL is
// wrapped the same way, so a picture never loads from Dexscreener in the visitor's browser
function dexImg(u) {
  if (typeof u !== 'string' || /["'<>\s]/.test(u)) return null;
  if (/^\/api\/img\?u=https%3A%2F%2F(cdn|dd)\.dexscreener\.com%2F/i.test(u)) return u;
  if (/^https:\/\/(cdn|dd)\.dexscreener\.com\//.test(u)) return '/api/img?u=' + encodeURIComponent(u);
  return null;
}

/* ---- add chain to wallet ---- */
/* `prov` for the same reason ensureRobinhoodChain takes one: with two wallets installed, wprov() can
   answer with a different provider than the one being set up, and the add prompt lands in the wrong one. */
async function addRobinhoodChain(prov) {
  const p = prov || wprov();
  if (!p) {
    sendToast('No wallet detected — install MetaMask or Rabby first 🦊');
    return false;
  }
  try {
    await p.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: RH_CHAIN.hexId,
        chainName: RH_CHAIN.name,
        rpcUrls: [RH_CHAIN.rpc],
        blockExplorerUrls: [RH_CHAIN.explorer],
        nativeCurrency: RH_CHAIN.currency,
      }],
    });
    sendToast('Robinhood Chain added! 🟢');
    return true;
  } catch (e) {
    if (e && e.code === 4001) sendToast('Request cancelled in wallet');
    else sendToast('Wallet said no 😅 — add it manually below');
    return false;
  }
}

async function watchToken(tokenKey) {
  const p = wprov(); if (!p) { sendToast('No wallet detected 🦊'); return; }
  const t = TOKENS[tokenKey];
  try {
    await p.request({
      method: 'wallet_watchAsset',
      params: { type: 'ERC20', options: { address: t.address, symbol: t.symbol, decimals: t.decimals } },
    });
    sendToast('$' + t.symbol + ' added to your wallet 👀');
  } catch { /* user closed */ }
}

/* ---- full wallet breakdown: every ERC-20 held + ETH, prices, best-effort PNL ---- */
async function ethBalance(wallet) {
  const res = await rpcCall('eth_getBalance', [wallet, 'latest']);
  return toNum(BigInt(res || '0x0'), 18);
}

async function dexPricesFor(addresses, failed) {
  // batch price lookup, up to 30 per call; returns {addrLower: pairInfo}. A batch that could not be read is waited
  // out once or twice when throttled, then named in `failed` — a price that was not read is unknown, not zero.
  const out = {};
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const res = await fetch('/api/chain/dex-tokens?addrs=' + encodeURIComponent(chunk.join(',')), { credentials: 'same-origin' });   // via this site: the token list is a fingerprint of the wallet
        if (res.status === 429 && attempt < 2) { await new Promise(r => setTimeout(r, 15000 * (attempt + 1))); continue; }
        if (!res.ok) throw new Error('prices ' + res.status);
        const arr = await res.json();
        for (const pairInfo of arr || []) {
          const base = (pairInfo.baseToken && pairInfo.baseToken.address || '').toLowerCase();
          // keep the deepest pool per token
          if (base && (!out[base] || (pairInfo.liquidity && pairInfo.liquidity.usd || 0) > (out[base].liquidity && out[base].liquidity.usd || 0))) {
            out[base] = pairInfo;
          }
        }
        ok = true;
      } catch (e) { console.warn('price batch failed', e); break; }
    }
    if (!ok && Array.isArray(failed)) failed.push(...chunk);
  }
  return out;
}

