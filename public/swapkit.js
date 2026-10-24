/* ===== Swap in my wallet — one button on every token's on-chain detail (owner, 2026-10-23) ===========================
 * "Enable one click swaps like you have for the Send token on the landing page as simple button on every token on-chain
 * details that takes the contract address and sets up a swap in their wallet to purchase that token they are looking at."
 *
 * The button opens a small panel under the token's actions. The reader types an amount of the chain's own coin (ETH on
 * Robinhood Chain and Ethereum, SOL on Solana); the server quotes it from the router or from Jupiter (/api/swap/quote)
 * and, on "Swap in my wallet", builds the transaction (/api/swap/build) for the reader's OWN wallet to show, check and
 * sign. Nothing moves until the wallet confirms it; the site never holds funds and never asks for a token approval.
 *   · EVM (Robinhood Chain, Ethereum): the wallet is asked to be on the token's chain (added, on Robinhood Chain, if it has
 *     never seen it); the transaction's `to` is checked against the routers THIS file knows before it is handed over; the
 *     receipt is read through the wallet's own node — the browser talks only to this site and to the wallet.
 *   · Solana: a Wallet Standard wallet (Phantom, Solflare, Backpack …) signs and sends Jupiter's serialized transaction
 *     itself; the signature's standing is read through this site.
 * Sounds: 'swap' when the wallet sends it, 'error' / 'warn' for a refusal or a warning, 'select' for a preset — a buy never
 * gets a reward fanfare (the same rule the landing page's swap keeps). CSP-safe: addEventListener only, no inline JS. */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sfx = (n) => { try { if (window.SFX) SFX.play(n); } catch {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SLIP = 10;   // % — the landing page's generous guard for thin pools and taxed tokens; the server clamps it to [0.1, 49]
  const IMPACT_WARN = 5;
  const CH = {
    robinhood: { name: 'Robinhood Chain', native: 'ETH', hexId: '0x1237', evm: true, tx: 'https://robinhoodchain.blockscout.com/tx/', presets: ['0.01', '0.05', '0.1', '0.25'],
      add: { chainId: '0x1237', chainName: 'Robinhood Chain', rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: ['https://robinhoodchain.blockscout.com'] } },
    ethereum: { name: 'Ethereum', native: 'ETH', hexId: '0x1', evm: true, tx: 'https://etherscan.io/tx/', presets: ['0.01', '0.05', '0.1', '0.25'] },
    solana: { name: 'Solana', native: 'SOL', evm: false, tx: 'https://solscan.io/tx/', presets: ['0.1', '0.5', '1', '2'] },
  };
  // the only addresses a built transaction may ever send value to — the same list lib/swapkit.js holds (ALLOWED_TO); anything else is refused here
  const TO_OK = {
    robinhood: ['0x89e5db8b5aa49aa85ac63f691524311aeb649eba'],
    ethereum: ['0x7a250d5630b4cf539739df2c5dacb4c659f2488d', '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f'],
  };
  const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
  const HOME_CREDIT = ['0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', '0x61339f11384dde4b2dc3a33e75b4dc23cc620f22'];   // $SEND, $GWC: the two coins /api/gamify/swap credits

  /* ---- numbers ---- */
  const units = (raw, dec) => { try { const b = BigInt(raw), d = BigInt(dec); return Number(b / 10n ** d) + Number(b % 10n ** d) / Number(10n ** d); } catch { return null; } };
  function fmt(x) {
    if (x == null || !isFinite(x)) return '—';
    if (x >= 1e6) return x.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (x >= 1) return x.toLocaleString(undefined, { maximumFractionDigits: x >= 1000 ? 2 : 4 });
    return x === 0 ? '0' : Number(x.toPrecision(4)).toString();
  }
  const usd = (x) => x == null || !isFinite(x) ? '' : ' (≈ $' + (x >= 1 ? x.toLocaleString(undefined, { maximumFractionDigits: 2 }) : Number(x.toPrecision(3))) + ')';
  const short = (a) => { const s = String(a || ''); return s.length > 14 ? s.slice(0, 6) + '…' + s.slice(-4) : s; };
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58enc(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let zeros = 0; while (zeros < u.length && u[zeros] === 0) zeros++;
    const digits = [];
    for (let i = zeros; i < u.length; i++) { let carry = u[i]; for (let j = 0; j < digits.length; j++) { carry += digits[j] * 256; digits[j] = carry % 58; carry = Math.floor(carry / 58); } while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); } }
    let s = '1'.repeat(zeros); for (let k = digits.length - 1; k >= 0; k--) s += B58[digits[k]]; return s;
  }
  const b64bytes = (b64) => Uint8Array.from(atob(String(b64)), (c) => c.charCodeAt(0));

  /* ---- Solana wallets: the Wallet Standard registry (a wallet announces itself; the page asks who is there) ---- */
  const solWallets = [];
  function solRegister(w) {
    try {
      if (!w || !w.features || !w.features['standard:connect'] || !w.features['solana:signAndSendTransaction']) return;
      if (!(Array.isArray(w.chains) && w.chains.includes('solana:mainnet'))) return;
      if (!solWallets.some((x) => x === w || x.name === w.name)) solWallets.push(w);
    } catch {}
  }
  const solApi = { register: (...ws) => { ws.forEach(solRegister); return () => {}; } };
  try {
    window.addEventListener('wallet-standard:register-wallet', (e) => { try { if (typeof e.detail === 'function') e.detail(solApi); } catch {} });
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: solApi }));
  } catch {}

  /* ---- markup ---- */
  const chainOf = (p) => (window.NPCard && NPCard.chainOf ? NPCard.chainOf(p).slug : (p && p.chain) || 'robinhood');
  function buttonHTML(p) {
    const chain = chainOf(p), c = CH[chain]; const t = (p && p.token) || {};
    if (!c || !t.address) return '';
    const sym = t.symbol ? '$' + t.symbol : 'this token';
    const px = p.market && Number(p.market.priceUsd) > 0 ? Number(p.market.priceUsd) : null;   // the profile's own price: the home chain's quote carries no dollar figure of its own
    return '<button type="button" class="btn btn-sm btn-primary tkd-swap-btn" data-swap-open data-swap-chain="' + esc(chain) + '" data-swap-token="' + esc(t.address) + '" data-swap-symbol="' + esc(t.symbol || '') + '"' + (px ? ' data-swap-usd="' + px + '"' : '') + ' aria-expanded="false" ' +
      'data-tip="' + esc('Opens a panel that quotes a buy of ' + sym + ' with ' + c.native + ' on ' + c.name + ' and builds it for your own wallet to review and sign — nothing moves until you confirm there') + '">🚀 Swap in my wallet</button>';
  }
  const line = (k, label, v) => '<dt>' + esc(label) + '</dt><dd data-swap-line="' + k + '">' + v + '</dd>';
  function panelHTML(chain, symbol) {
    const c = CH[chain]; const sym = symbol ? '$' + symbol : 'this token';
    return '<div class="tkd-swap" data-chain="' + esc(chain) + '">' +
      '<div class="tkd-swap-head"><b>Buy ' + esc(sym) + ' with ' + esc(c.native) + '</b> <span class="tkd-swap-chain">on ' + esc(c.name) + ' · ' + SLIP + '% slippage guard</span></div>' +
      '<label class="tkd-swap-amt"><span>' + esc(c.native) + ' to spend</span><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="' + esc(c.presets[1]) + '" maxlength="20" aria-label="' + esc(c.native + ' amount to swap for ' + sym) + '"></label>' +
      '<div class="tkd-swap-presets" role="group" aria-label="Amount presets">' + c.presets.map((v) => '<button type="button" class="btn btn-sm btn-ghost" data-swap-preset="' + v + '" data-tip="' + esc('Sets the amount to ' + v + ' ' + c.native) + '">' + v + ' ' + esc(c.native) + '</button>').join('') + '</div>' +
      '<dl class="tkd-swap-lines" aria-live="polite">' + line('pay', 'You spend', '—') + line('get', 'You get about', 'enter an amount ☝️') + line('min', 'At least', '—') + line('impact', 'Price impact', '—') + line('route', 'Route', '—') + '</dl>' +
      '<p class="tkd-swap-status" role="status" aria-live="polite"></p>' +
      '<div class="tkd-swap-go">' +
        '<button type="button" class="btn btn-primary" data-swap-go data-tip="Builds this swap and hands it to your wallet, which shows it for you to check and sign — nothing is sent until you confirm there">Swap in my wallet 🚀</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-swap-close data-tip="Closes the swap panel; nothing is sent">Close</button>' +
      '</div>' +
      '<p class="tkd-swap-note">Your wallet shows this transaction before anything moves — check that <b>To</b> is the router named in the route line and the amount is yours. This site never holds funds, never asks for a token approval, and cannot cancel, reverse or refund a swap. A quote moves with the market; the slippage guard is the most the price may move before the swap fails instead of filling. ' +
        (chain === 'solana' ? 'Jupiter builds the Solana transaction from your wallet\'s public key. ' : '') + 'Not advice, never a tip to buy — most new tokens go to zero.</p>' +
    '</div>';
  }

  /* ---- the panel's state ---- */
  const setLine = (panel, k, html, warn) => { const el = panel.querySelector('[data-swap-line="' + k + '"]'); if (!el) return; el.innerHTML = html; el.classList.toggle('is-warn', !!warn); };
  function status(panel, msg, kind, html) {
    const el = panel.querySelector('.tkd-swap-status'); if (!el) return;
    if (html) el.innerHTML = msg; else el.textContent = msg;
    el.className = 'tkd-swap-status' + (kind ? ' is-' + kind : '');
  }
  const txLink = (chain, id) => '<a href="' + esc(CH[chain].tx + id) + '" target="_blank" rel="noopener nofollow">' + esc(short(id)) + ' ↗</a>';
  function resetLines(panel, hint) {
    setLine(panel, 'pay', '—'); setLine(panel, 'get', hint || 'enter an amount ☝️'); setLine(panel, 'min', '—'); setLine(panel, 'impact', '—'); setLine(panel, 'route', '—');
    panel._q = null;
  }
  function renderQuote(panel, q) {
    const chain = panel.dataset.chain, c = CH[chain];
    const sym = q.symbol ? '$' + q.symbol : panel.dataset.symbol ? '$' + panel.dataset.symbol : 'tokens';   // the home chain's quote names no symbol; the profile does
    const tokUsd = q.tokenUsd > 0 ? q.tokenUsd : Number(panel.dataset.usd) > 0 ? Number(panel.dataset.usd) : null;   // likewise its dollar price
    const inN = units(q.amountIn, q.nativeDecimals);
    const outN = q.decimals != null ? units(q.amountOut, q.decimals) : null, minN = q.decimals != null ? units(q.minOut, q.decimals) : null;
    setLine(panel, 'pay', esc(fmt(inN) + ' ' + c.native) + esc(usd(q.nativeUsd > 0 && inN != null ? inN * q.nativeUsd : null)));
    setLine(panel, 'get', outN != null ? esc(fmt(outN) + ' ' + sym) + esc(usd(tokUsd ? outN * tokUsd : null)) : esc(q.amountOut + ' base units of ' + sym + ' (decimals unread)'));
    setLine(panel, 'min', minN != null ? esc(fmt(minN) + ' ' + sym + ' — or the swap fails instead of filling') : esc(q.minOut + ' base units'));
    const imp = q.impactPct;
    setLine(panel, 'impact', imp == null ? 'not read' : esc((imp < 0.01 ? '<0.01' : imp.toFixed(2)) + '%') + (imp >= IMPACT_WARN ? ' <b>⚠️ high — this size moves the pool</b>' : ''), imp != null && imp >= IMPACT_WARN);
    const r = q.route || {};
    setLine(panel, 'route', esc(r.dex || '—') + (r.fee ? esc(' · ' + (r.fee / 10000) + '% pool') : '') + (r.hops > 1 ? esc(' · ' + r.hops + ' hops') : '') +
      ' · To: <code>' + esc(short(r.router || r.program || '')) + '</code>' + (r.router || r.program ? ' <button type="button" class="copy-btn" data-copy="' + esc(r.router || r.program) + '" data-tip="Copies the router address your wallet will show as To, so you can compare it">Copy</button>' : ''));
    if (imp != null && imp >= IMPACT_WARN && panel._warnedAt !== q.amountIn) { panel._warnedAt = q.amountIn; sfx('warn'); }
    panel._q = q;
  }
  async function getJSON(url) { try { const r = await fetch(url, { credentials: 'same-origin' }); return await r.json(); } catch { return null; } }
  async function post(url, body) { try { const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return await r.json(); } catch { return null; } }

  /* ---- the quote: typed, debounced, the newest answer wins ---- */
  async function quote(panel) {
    const input = panel.querySelector('input'); const amount = String(input.value || '').trim();
    const seq = (panel._seq = (panel._seq || 0) + 1);
    if (!amount) { resetLines(panel); status(panel, '', ''); return; }
    if (!/^\d{0,12}(\.\d{0,18})?$/.test(amount) || !(Number(amount) > 0)) { resetLines(panel, 'a plain number, please'); status(panel, 'Enter the amount as a plain number, like ' + CH[panel.dataset.chain].presets[1] + ' ✍️', 'error'); return; }
    status(panel, 'Asking the router…', 'busy');
    const j = await getJSON('/api/swap/quote?chain=' + encodeURIComponent(panel.dataset.chain) + '&token=' + encodeURIComponent(panel.dataset.token) + '&amount=' + encodeURIComponent(amount) + '&slippage=' + SLIP);
    if (seq !== panel._seq) return;   // a newer amount was typed meanwhile
    if (!j) { resetLines(panel, 'no quote'); status(panel, 'Could not reach the site for a quote — try again 📡', 'error'); return; }
    if (j.error) { resetLines(panel, 'no quote'); status(panel, j.error, 'error'); return; }
    if (j.unavailable) { resetLines(panel, 'no quote'); status(panel, 'No quote: ' + j.unavailable + '. Nothing was sent — try again in a moment.', 'error'); return; }
    if (j.unsupported) { resetLines(panel, 'no route'); status(panel, 'This site cannot build that swap: ' + j.unsupported + '.' + (j.deepest && j.deepest.url ? ' Its deepest pool is on Dexscreener.' : ''), 'error'); return; }
    if (!j.amountOut) { resetLines(panel, 'no quote'); status(panel, 'No quote came back — try again', 'error'); return; }
    renderQuote(panel, j);
    status(panel, 'Quoted just now — a live price, not a promise. Press the button to build it for your wallet.', 'info');
  }

  /* ---- EVM: Robinhood Chain and Ethereum ---- */
  async function ensureChain(prov, chain) {
    const want = CH[chain].hexId;
    try { const cur = await prov.request({ method: 'eth_chainId' }); if (String(cur).toLowerCase() === want) return true; } catch {}
    try { await prov.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] }); }
    catch (e) {
      const unknown = e && (e.code === 4902 || /unrecognized|unknown chain|not (been )?added|unsupported chain/i.test(String((e && e.message) || '')));
      if (!(unknown && CH[chain].add)) return false;
      try { await prov.request({ method: 'wallet_addEthereumChain', params: [CH[chain].add] }); } catch { return false; }
    }
    try { const cur = await prov.request({ method: 'eth_chainId' }); return String(cur).toLowerCase() === want; } catch { return false; }
  }
  async function goEvm(panel, q) {
    const chain = panel.dataset.chain, c = CH[chain], amount = panel.querySelector('input').value.trim();
    if (!window.WALLET || !WALLET.connect) { sfx('error'); status(panel, 'The wallet helper did not load — reload the page and try again', 'error'); return; }
    let prov, address;
    try { const w = await WALLET.connect({ noSwitch: true }); prov = w.provider; address = w.address; }
    catch (e) { if (e && e.message === 'cancelled') status(panel, 'Connect cancelled — nothing was sent', 'info'); else { sfx('error'); status(panel, 'Connect a wallet to swap 🔌' + (e && e.message ? ' — ' + e.message : ''), 'error'); } return; }
    if (!address) { sfx('error'); status(panel, 'Connect a wallet to swap 🔌', 'error'); return; }
    if (!(await ensureChain(prov, chain))) { sfx('error'); status(panel, 'Switch your wallet to ' + c.name + ' to swap ⛓️ — nothing was sent', 'error'); return; }
    try {   // the balance, through the wallet's own node: "no ETH on this chain" is the first-timer failure worth naming
      const bal = BigInt(await prov.request({ method: 'eth_getBalance', params: [address, 'latest'] }));
      const need = BigInt(q.amountIn) + 300000000000000n;   // plus a little gas (the landing page's reserve)
      if (bal < need) { sfx('error'); status(panel, 'Not enough ' + c.native + ' on ' + c.name + ' — this wallet has ' + fmt(units(bal.toString(), 18)) + ' ' + c.native + ' and the swap needs ' + amount + ' plus a little gas. Nothing was sent.', 'error'); return; }
    } catch {}
    status(panel, 'Building the transaction…', 'busy');
    const r = await post('/api/swap/build', { chain, token: panel.dataset.token, amount, from: address, slippage: SLIP });
    if (!r || !r.tx) { sfx('error'); status(panel, (r && (r.error || r.unavailable || r.unsupported)) ? 'Could not build the swap: ' + (r.error || r.unavailable || r.unsupported) : 'Could not build the swap — try again 📡', 'error'); return; }
    if (!TO_OK[chain].includes(String(r.tx.to || '').toLowerCase()) || String(r.tx.chainId).toLowerCase() !== c.hexId || !/^0x[0-9a-f]+$/i.test(String(r.tx.value || ''))) {
      sfx('error'); status(panel, 'The transaction did not match a router this page knows — nothing was sent.', 'error'); return;
    }
    renderQuote(panel, r);   // the build re-quoted; the lines show what the wallet is about to be handed
    status(panel, 'Check it in your wallet: To ' + short(r.tx.to) + ' on ' + c.name + ', ' + amount + ' ' + c.native + '…', 'busy');
    let hash;
    try { hash = await prov.request({ method: 'eth_sendTransaction', params: [{ from: address, to: r.tx.to, value: r.tx.value, data: r.tx.data }] }); }
    catch (e) {
      if (e && e.code === 4001) { status(panel, 'Swap cancelled in your wallet — nothing was sent', 'info'); return; }
      sfx('error'); status(panel, 'Your wallet rejected the transaction 😬 — nothing left your wallet. Usual causes: not enough ' + c.native + ' for gas, or the price moved past the slippage guard. Try again.', 'error'); return;
    }
    sfx('swap');   // the wallet signed it and it went out
    if (window.sendConfetti) sendConfetti(innerWidth / 2, innerHeight / 2, { count: 70, emojiRatio: 0.4 });
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash))) { status(panel, 'Swap sent — check your wallet for the result ⏳', 'ok'); return; }
    const link = txLink(chain, hash);
    status(panel, 'Sent! 🚀 ' + link + ' — waiting for ' + esc(c.name) + '…', 'ok', true);
    for (let i = 0; i < 60; i++) {   // the receipt, through the wallet's own node
      await sleep(3000);
      try {
        const rc = await prov.request({ method: 'eth_getTransactionReceipt', params: [hash] });
        if (!rc) continue;
        if (rc.status === '0x1') { status(panel, 'Confirmed ✅ ' + link + ' — the tokens are in your wallet.', 'ok', true); credit(chain, panel.dataset.token, hash); }
        else { sfx('error'); status(panel, 'Reverted on-chain 😬 — nothing was taken except gas. ' + link, 'error', true); }
        return;
      } catch {}
    }
    status(panel, 'Still pending after three minutes — the explorer link shows what happened ⏳ ' + link, 'info', true);
  }
  // $SEND / $GWC bought on the home chain earn Send Points like the landing page's swap: the server re-verifies the receipt (a no-op signed out)
  function credit(chain, token, hash) {
    if (chain !== 'robinhood' || !HOME_CREDIT.includes(String(token).toLowerCase())) return;
    const ask = async (tries) => {
      await sleep(12000);
      const j = await post('/api/gamify/swap', { txHash: hash });
      if (j && j.awarded > 0) { if (window.sendToast) sendToast('+' + j.awarded + ' Send Points for that swap! 🎮'); if (window.showPoints) showPoints(j.awarded); return; }
      if (j && /few blocks/i.test(String(j.error || '')) && tries > 0) return ask(tries - 1);
    };
    ask(2).catch(() => {});
  }

  /* ---- Solana ---- */
  async function goSol(panel, q) {
    const amount = panel.querySelector('input').value.trim();
    if (!solWallets.length) { sfx('error'); status(panel, 'No Solana wallet found in this browser. A Solana wallet extension (Phantom, Solflare, Backpack and others) adds one; on a phone, open this page inside the wallet app\'s own browser. Nothing was sent.', 'error'); return; }
    let w = solWallets.length === 1 ? solWallets[0] : panel._solPick;
    if (!w) {   // several wallets: the reader picks
      status(panel, 'Pick the wallet to swap with: ', 'info');
      const el = panel.querySelector('.tkd-swap-status');
      const box = document.createElement('span'); box.className = 'tkd-swap-wallets';
      solWallets.forEach((x, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm btn-ghost'; b.dataset.swapWallet = String(i); b.textContent = x.name || 'Wallet ' + (i + 1); b.setAttribute('data-tip', 'Swaps with ' + (x.name || 'this wallet') + ' — it will ask you to connect, then show the transaction'); box.appendChild(b); });
      el.appendChild(box);
      return;
    }
    let account;
    try { const r = await w.features['standard:connect'].connect(); const accts = (r && r.accounts) || []; account = accts.find((a) => Array.isArray(a.chains) && a.chains.includes('solana:mainnet')) || accts[0]; }
    catch (e) { status(panel, 'Connect cancelled — nothing was sent', 'info'); return; }
    if (!account || !account.address) { sfx('error'); status(panel, 'The wallet gave no Solana account — nothing was sent', 'error'); return; }
    status(panel, 'Building the transaction with Jupiter…', 'busy');
    const r = await post('/api/swap/build', { chain: 'solana', token: panel.dataset.token, amount, from: account.address, slippage: SLIP });
    if (!r || !r.tx || !r.tx.swapTransaction) { sfx('error'); status(panel, (r && (r.error || r.unavailable || r.unsupported)) ? 'Could not build the swap: ' + (r.error || r.unavailable || r.unsupported) : 'Could not build the swap — try again 📡', 'error'); return; }
    if (r.tx.program !== JUPITER) { sfx('error'); status(panel, 'The transaction did not come from Jupiter\'s program — nothing was sent.', 'error'); return; }
    if (r.tx.simulationError) { sfx('warn'); status(panel, 'Jupiter simulated this swap and it failed (' + String((r.tx.simulationError && r.tx.simulationError.error) || r.tx.simulationError).slice(0, 120) + ') — nothing was sent. Try a smaller amount.', 'error'); return; }
    renderQuote(panel, r);
    status(panel, 'Check it in your wallet: a Jupiter swap of ' + amount + ' SOL…', 'busy');
    let sig = null;
    try {
      const out = await w.features['solana:signAndSendTransaction'].signAndSendTransaction({ account, transaction: b64bytes(r.tx.swapTransaction), chain: 'solana:mainnet' });
      const s0 = Array.isArray(out) ? out[0] : out; sig = s0 && s0.signature ? b58enc(s0.signature) : null;
    } catch (e) {
      const m = String((e && e.message) || '');
      if ((e && e.code === 4001) || /reject|cancel|denied|declined/i.test(m)) { status(panel, 'Swap cancelled in your wallet — nothing was sent', 'info'); return; }
      sfx('error'); status(panel, 'Your wallet did not send it 😬' + (m ? ' — ' + m.slice(0, 140) : '') + '. Usual causes: not enough SOL for the swap and its fee, or the price moved past the slippage guard.', 'error'); return;
    }
    sfx('swap');
    if (window.sendConfetti) sendConfetti(innerWidth / 2, innerHeight / 2, { count: 70, emojiRatio: 0.4 });
    if (!sig) { status(panel, 'Swap sent — check your wallet for the result ⏳', 'ok'); return; }
    const link = txLink('solana', sig);
    status(panel, 'Sent! 🚀 ' + link + ' — waiting for Solana…', 'ok', true);
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const s = await getJSON('/api/swap/status?chain=solana&sig=' + encodeURIComponent(sig));
      if (s && (s.status === 'confirmed' || s.status === 'finalized')) { status(panel, 'Confirmed ✅ ' + link + ' — the tokens are in your wallet.', 'ok', true); return; }
      if (s && s.status === 'failed') { sfx('error'); status(panel, 'Failed on-chain 😬 — only the network fee was taken. ' + link, 'error', true); return; }
    }
    status(panel, 'Still unconfirmed after two minutes — the explorer link shows what happened ⏳ ' + link, 'info', true);
  }

  async function go(panel) {
    if (panel._busy) return;
    const q = panel._q;
    if (!q || !q.amountOut) { sfx('error'); status(panel, 'Enter an amount and wait for the quote first ✍️', 'error'); return; }
    panel._busy = true; panel.querySelector('[data-swap-go]').setAttribute('aria-busy', 'true');
    try { if (CH[panel.dataset.chain].evm) await goEvm(panel, q); else await goSol(panel, q); }
    finally { panel._busy = false; const b = panel.querySelector('[data-swap-go]'); if (b) b.removeAttribute('aria-busy'); }
  }

  /* ---- wiring: one delegated listener per dashboard ---- */
  function open(btn) {
    const bar = btn.closest('.tkd-actbar') || btn.parentElement;
    let panel = bar.querySelector('.tkd-swap');
    if (!panel) {
      bar.insertAdjacentHTML('beforeend', panelHTML(btn.dataset.swapChain, btn.dataset.swapSymbol));
      panel = bar.querySelector('.tkd-swap'); panel.dataset.token = btn.dataset.swapToken; panel.dataset.symbol = btn.dataset.swapSymbol || ''; if (btn.dataset.swapUsd) panel.dataset.usd = btn.dataset.swapUsd;
      panel.querySelector('input').addEventListener('input', () => { clearTimeout(panel._t); panel._t = setTimeout(() => quote(panel), 450); });
      panel.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(panel._t); quote(panel).then(() => { if (panel._q) go(panel); }); } });
      btn.setAttribute('aria-expanded', 'true'); panel.querySelector('input').focus();
      return;
    }
    const show = panel.hidden; panel.hidden = !show; btn.setAttribute('aria-expanded', String(show));
    if (show) panel.querySelector('input').focus();
  }
  function onClick(e) {
    const t = e.target.closest('[data-swap-open], [data-swap-preset], [data-swap-close], [data-swap-go], [data-swap-wallet]'); if (!t) return;
    const panel = t.closest('.tkd-swap');
    if (t.hasAttribute('data-swap-open')) return open(t);
    if (!panel) return;
    if (t.hasAttribute('data-swap-preset')) { panel.querySelector('input').value = t.dataset.swapPreset; sfx('select'); quote(panel); return; }
    if (t.hasAttribute('data-swap-close')) { panel.hidden = true; const b = (t.closest('.tkd-actbar') || document).querySelector('[data-swap-open]'); if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); } return; }
    if (t.hasAttribute('data-swap-wallet')) { panel._solPick = solWallets[Number(t.dataset.swapWallet)] || null; go(panel); return; }
    if (t.hasAttribute('data-swap-go')) go(panel);
  }
  function mount(root) {
    if (!root || !root.querySelectorAll) return;
    const dashes = root.matches && root.matches('.tkd') ? [root] : root.querySelectorAll('.tkd');
    dashes.forEach((dash) => { if (dash._swapWired) return; dash._swapWired = true; dash.addEventListener('click', onClick); });
  }

  window.SwapKit = { buttonHTML, panelHTML, mount, CH, TO_OK, SLIP, IMPACT_WARN, b58enc, fmt, units, _solWallets: solWallets };
})();
