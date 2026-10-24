'use strict';
/* ===== A swap for any token the Scanner shows, built here and signed in the reader's own wallet ======================
   Owner, 2026-10-23: "Enable one click swaps like you have for the Send token on the landing page as simple button on
   every token on-chain details that takes the contract address and sets up a swap in their wallet to purchase that token
   they are looking at."

   The landing page's swap (public/chain.js) is ETH → $SEND / $GWC through Robinhood Chain's public Uniswap v2 router, the
   quote read in the browser, the transaction built in the browser and signed in the wallet. This module is the same idea
   for any token, on three chains, with the quote and the transaction built on the server (one place to keep the router
   addresses, the ABI encodings and the Jupiter calls; the browser still talks only to this site and to its own wallet):

     · Robinhood Chain — ETH → token through the same v2 router the landing page uses, path [WETH, token], or [WETH, USDG,
       token] when the token's only pool is priced in USDG; the quote is getAmountsOut on the chain's node.
     · Ethereum — ETH → token through the deepest Uniswap pool Dexscreener lists for it: a v2 pool through Uniswap's v2
       router (swapExactETHForTokensSupportingFeeOnTransferTokens, as on the home chain), a v3 pool through SwapRouter02
       (multicall(deadline, [exactInputSingle]) with the pool's own fee, quoted by QuoterV2), or a SushiSwap v2 pool through
       Sushi's router. Measured 2026-10-23 by eth_call simulation on mainnet: all three encodings execute.
     · Solana — SOL → token through Jupiter's swap API (v1 quote + swap, keyless at half a request a second, or keyed):
       Jupiter returns a serialized v0 transaction; the wallet signs and sends it itself (Wallet Standard
       solana:signAndSendTransaction), so the browser needs no Solana node.

   What this module never does: hold funds, approve anything, pick an amount, or send. It answers a quote and a transaction
   for the wallet to show; the person decides. Every number it returns was read from a router, a quoter or Jupiter in the
   same call — nothing is estimated from a price feed. Everything is injected so a test can run it against fakes. ===== */

const EVM_RE = /^0x[0-9a-f]{40}$/i;
const ROUTERS = {
  robinhood: { v2: '0x89e5db8b5aa49aa85ac63f691524311aeb649eba', weth: '0x0bd7d308f8e1639fab988df18a8011f41eacad73', usdg: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', chainId: '0x1237', native: 'ETH', decimals: 18 },
  ethereum: {
    uniV2: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', uniV3: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', uniV3Quoter: '0x61ffe014ba17989e743c5f6cb21bf9697530b21e', sushiV2: '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f',
    weth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', chainId: '0x1', native: 'ETH', decimals: 18,
  },
  solana: { jupiter: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', solMint: 'So11111111111111111111111111111111111111112', native: 'SOL', decimals: 9 },
};
// the addresses the browser may ever be told to send value to, per chain (defense in depth: the client checks `to` against this list too)
const ALLOWED_TO = {
  robinhood: [ROUTERS.robinhood.v2],
  ethereum: [ROUTERS.ethereum.uniV2, ROUTERS.ethereum.uniV3, ROUTERS.ethereum.sushiV2],
};
const SLIPPAGE_DEFAULT = 10, SLIPPAGE_MIN = 0.1, SLIPPAGE_MAX = 49;   // the landing page's generous guard for thin pools and taxed tokens; never past half
const DEADLINE_S = 20 * 60;

/* ----- ABI ----- */
const w256 = (v) => (typeof v === 'bigint' || typeof v === 'number' ? BigInt(v).toString(16) : /^0x/i.test(String(v)) ? String(v).slice(2) : BigInt(String(v)).toString(16)).padStart(64, '0');   // numbers and decimal strings are values; 0x-strings are already hex
const addrWord = (a) => w256('0x' + String(a).toLowerCase().replace(/^0x/, ''));
const lastWord = (hex) => { const h = String(hex || '').replace(/^0x/, ''); return h.length >= 64 ? BigInt('0x' + h.slice(-64)) : null; };
const firstWord = (hex) => { const h = String(hex || '').replace(/^0x/, ''); return h.length >= 64 ? BigInt('0x' + h.slice(0, 64)) : null; };
const encGetAmountsOut = (amountIn, path) => '0xd06ca61f' + w256(amountIn) + w256(0x40) + w256(path.length) + path.map(addrWord).join('');
const encSwapV2 = (minOut, path, to, deadline) => '0xb6f9de95' + w256(minOut) + w256(0x80) + addrWord(to) + w256(deadline) + w256(path.length) + path.map(addrWord).join('');
const encQuoteV3 = (tokenIn, tokenOut, amountIn, fee) => '0xc6a5026a' + addrWord(tokenIn) + addrWord(tokenOut) + w256(amountIn) + w256(fee) + w256(0);
function encSwapV3(tokenIn, tokenOut, fee, recipient, amountIn, minOut, deadline) {
  const inner = '04e45aaf' + addrWord(tokenIn) + addrWord(tokenOut) + w256(fee) + addrWord(recipient) + w256(amountIn) + w256(minOut) + w256(0);
  const len = inner.length / 2, padded = inner + '0'.repeat((64 - (inner.length % 64)) % 64);
  return '0x5ae401dc' + w256(deadline) + w256(0x40) + w256(1) + w256(0x20) + w256(len) + padded;   // multicall(uint256 deadline, bytes[] data)
}
/* a decimal amount of the native coin → its raw integer (wei, lamports); null when it is not a plain positive number */
function parseAmount(str, decimals) {
  const s = String(str == null ? '' : str).trim();
  if (!/^\d{1,12}(\.\d{1,18})?$/.test(s) && !/^\.\d{1,18}$/.test(s)) return null;
  const [whole = '0', frac = ''] = s.split('.');
  const f = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const v = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(f || '0');
  return v > 0n ? v : null;
}
const human = (raw, decimals) => { try { const d = BigInt(decimals || 0); const b = BigInt(raw); const i = b / 10n ** d, f = b % 10n ** d; return Number(i) + Number(f) / Number(10n ** d); } catch { return null; } };
// price impact from a reference quote: how much worse this size fills than a sliver at the pool's marginal rate, in %
function impactFrom(outBig, inBig, refOut, refIn) {
  if (!(outBig > 0n) || !(refOut > 0n) || !(refIn > 0n)) return null;
  const spot = Number(refOut) / Number(refIn);           // tokens per wei at the margin
  const got = Number(outBig) / Number(inBig);
  return spot > 0 ? Math.max(0, (1 - got / spot) * 100) : null;
}

function createSwapKit(deps) {
  const { mc, rhCall, ethUsd, take, jgetR, now = () => Date.now(), fetchImpl = (typeof fetch === 'function' ? fetch : null) } = deps;   // jgetR(url, headers?) → { ok, data, reason }
  const urls = Object.assign({ ethRpc: 'https://ethereum-rpc.publicnode.com', solRpc: 'https://api.mainnet-beta.solana.com', jupiter: 'https://api.jup.ag' }, deps.urls || {});
  const jupKey = deps.jupiterKey || '';
  const jupHost = (() => { try { return new URL(urls.jupiter).host; } catch { return 'api.jup.ag'; } })();

  async function post(url, body, headers) {
    if (!fetchImpl) return null;
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetchImpl(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', accept: 'application/json' }, headers || {}), body: JSON.stringify(body), signal: ctrl.signal });
      const j = await r.json().catch(() => null);
      return { ok: r.ok, status: r.status, data: j };
    } catch (e) { return { ok: false, status: 0, data: null, reason: e && e.name === 'AbortError' ? 'timed out' : 'unreachable' }; }
    finally { clearTimeout(to); }
  }
  // an eth_call on Ethereum's node; a revert or no answer is null (the caller says which it is by what it tried)
  async function ethCall(to, data) {
    const r = await post(urls.ethRpc, { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] });
    if (!r || !r.ok || !r.data) throw Object.assign(new Error('the Ethereum node could not be read'), { unavailable: true });
    if (r.data.error) return null;
    return r.data.result || null;
  }
  const evmCall = (chain) => chain === 'ethereum' ? ethCall : rhCall;

  /* ----- the route: which pool, which router, and the quote for this size ----- */
  async function evmRoute(chain, token, amountIn) {
    const R = ROUTERS[chain]; const call = evmCall(chain);
    const REF = 10n ** 14n;   // a sliver: too small to move any pool, big enough to price
    const tryV2 = async (router, path, dex) => {
      let out, ref;
      try { out = lastWord(await call(router, encGetAmountsOut(amountIn, path))); ref = lastWord(await call(router, encGetAmountsOut(REF, path))); } catch (e) { if (e && e.unavailable) throw e; return null; }
      if (!(out > 0n)) return null;
      return { kind: 'v2', dex, router, path, amountOut: out, impactPct: impactFrom(out, amountIn, ref, REF) };
    };
    if (chain === 'robinhood') {
      return (await tryV2(R.v2, [R.weth, token], 'Uniswap v2 (Robinhood Chain)')) || (await tryV2(R.v2, [R.weth, R.usdg, token], 'Uniswap v2 (Robinhood Chain), through USDG')) || { unsupported: 'no pool on Robinhood Chain prices this token against ETH or USDG' };
    }
    // Ethereum: the deepest pool first; only pools whose router this module knows
    const pr = await mc.pools('ethereum', token);
    if (!pr || pr.unavailable) throw Object.assign(new Error('the price feed could not be read'), { unavailable: true });
    const pools = (pr.pools || []);
    for (const pool of pools) {
      const labels = pool.labels || [], dex = String(pool.dex || '').toLowerCase();
      const quote = pool.quote && pool.quote.address ? String(pool.quote.address).toLowerCase() : '';
      if (quote !== R.weth) continue;   // ETH in: only WETH-quoted pools can take it in one hop
      if (dex === 'uniswap' && labels.includes('v2')) { const r = await tryV2(R.uniV2, [R.weth, token], 'Uniswap v2'); if (r) return Object.assign(r, { pool: pool.address }); }
      else if (dex === 'uniswap' && labels.includes('v3')) {
        let fee = null; try { fee = firstWord(await call(pool.address, '0xddca3f43')); } catch (e) { if (e && e.unavailable) throw e; }   // fee() — the pool's own tier
        if (fee == null || fee > 1000000n) continue;
        let out = null, ref = null;
        try { out = firstWord(await call(R.uniV3Quoter, encQuoteV3(R.weth, token, amountIn, fee))); ref = firstWord(await call(R.uniV3Quoter, encQuoteV3(R.weth, token, REF, fee))); } catch (e) { if (e && e.unavailable) throw e; }
        if (out > 0n) return { kind: 'v3', dex: 'Uniswap v3', router: R.uniV3, pool: pool.address, fee: Number(fee), amountOut: out, impactPct: impactFrom(out, amountIn, ref, REF) };
      } else if (dex === 'sushiswap' && (!labels.length || labels.includes('v2'))) { const r = await tryV2(R.sushiV2, [R.weth, token], 'SushiSwap v2'); if (r) return Object.assign(r, { pool: pool.address }); }
    }
    return { unsupported: pools.length ? 'this token’s pools are on a DEX this site cannot route (' + [...new Set(pools.map((p) => (p.dex || 'unknown') + (p.labels && p.labels.length ? ' ' + p.labels.join('/') : '')))].slice(0, 4).join(', ') + ')' : 'no pool prices this token', deepest: pools[0] || null };
  }
  async function evmDecimals(chain, token) {
    try { const r = await evmCall(chain)(token, '0x313ce567'); const d = firstWord(r); return d != null && d <= 255n ? Number(d) : null; } catch { return null; }
  }

  /* ----- Solana: Jupiter ----- */
  const jupHeaders = () => jupKey ? { 'x-api-key': jupKey } : {};
  async function jupQuote(mint, lamports, slippageBps) {
    const url = urls.jupiter + '/swap/v1/quote?inputMint=' + ROUTERS.solana.solMint + '&outputMint=' + encodeURIComponent(mint) + '&amount=' + lamports.toString() + '&slippageBps=' + slippageBps;
    const r = jgetR ? await jgetR(url, jupHeaders()) : null;
    if (!r) throw Object.assign(new Error('Jupiter could not be asked'), { unavailable: true });
    if (!r.ok) {
      if (r.reason === 'rate-limited' || r.reason === 'timed out' || r.reason === 'unreachable') throw Object.assign(new Error('Jupiter could not be read (' + r.reason + ')'), { unavailable: true });
      return null;   // a 4xx: no route for this pair at this size
    }
    const q = r.data;
    if (!q || !q.outAmount) return null;
    return q;
  }
  async function jupSwap(quoteResponse, userPublicKey) {
    if (take) { try { await take(jupHost); } catch { throw Object.assign(new Error('Jupiter budget spent — try again shortly'), { unavailable: true }); } }
    const r = await post(urls.jupiter + '/swap/v1/swap', { quoteResponse, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto' }, jupHeaders());
    if (!r || !r.ok || !r.data || !r.data.swapTransaction) throw Object.assign(new Error('Jupiter could not build the transaction' + (r && r.data && r.data.error ? ' (' + String(r.data.error).slice(0, 120) + ')' : '')), { unavailable: !(r && r.ok) });
    return { swapTransaction: String(r.data.swapTransaction), lastValidBlockHeight: r.data.lastValidBlockHeight != null ? Number(r.data.lastValidBlockHeight) : null, simulationError: r.data.simulationError || null };
  }
  const solDecCache = new Map();
  async function solDecimals(mint) {
    if (solDecCache.has(mint)) return solDecCache.get(mint);
    const r = await post(urls.solRpc, { jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [mint, { encoding: 'jsonParsed' }] });
    const info = r && r.ok && r.data && r.data.result && r.data.result.value && r.data.result.value.data && r.data.result.value.data.parsed && r.data.result.value.data.parsed.info;
    const d = info && Number.isInteger(info.decimals) ? info.decimals : null;
    if (d != null) solDecCache.set(mint, d);
    return d;
  }
  // SOL in dollars, from the token's deepest SOL-quoted pool (Dexscreener: priceUsd ÷ priceNative), when there is one
  async function solUsd(pools) {
    const p = (pools || []).find((o) => o.quote && o.quote.address === ROUTERS.solana.solMint);
    if (!p || !mc.dsPair) return null;
    try { const pr = await mc.dsPair('solana', p.address); const d = pr && pr.pair; const u = d && Number(d.priceUsd), n = d && Number(d.priceNative); return u > 0 && n > 0 ? u / n : null; } catch { return null; }
  }

  /* ----- the quote; quoteFull keeps Jupiter's raw answer for build(), quote() drops it ----- */
  async function quoteFull(chain, token, amountStr, opts = {}) {
    const R = ROUTERS[chain]; if (!R) return { unsupported: 'unknown chain' };
    const slippage = Math.min(SLIPPAGE_MAX, Math.max(SLIPPAGE_MIN, Number(opts.slippagePct) || SLIPPAGE_DEFAULT));
    const amountIn = parseAmount(amountStr, R.decimals);
    if (!amountIn) return { bad: 'enter an amount of ' + R.native + ' as a plain number' };
    const base = { chain, token, native: R.native, nativeDecimals: R.decimals, amountIn: amountIn.toString(), slippagePct: slippage, at: now() };
    if (chain === 'solana') {
      const pr = await mc.pools('solana', token);
      if (!pr || pr.unavailable) return Object.assign(base, { unavailable: 'the price feed could not be read' });
      const q = await jupQuote(token, amountIn, Math.round(slippage * 100));
      if (!q) return Object.assign(base, { unsupported: 'Jupiter finds no route for this token at this size' });
      const label = Array.isArray(q.routePlan) && q.routePlan[0] && q.routePlan[0].swapInfo ? String(q.routePlan[0].swapInfo.label || '') : '';
      return Object.assign(base, {
        amountOut: String(q.outAmount), minOut: String(q.otherAmountThreshold || q.outAmount),
        impactPct: q.priceImpactPct != null && Number.isFinite(Number(q.priceImpactPct)) ? Number(q.priceImpactPct) * 100 : null,   // Jupiter reports a fraction (0.0019 = 0.19%; measured 2026-10-23)
        route: { kind: 'jupiter', dex: 'Jupiter' + (label ? ' → ' + label + (q.routePlan.length > 1 ? ' +' + (q.routePlan.length - 1) : '') : ''), program: R.jupiter, hops: Array.isArray(q.routePlan) ? q.routePlan.length : null },
        decimals: await solDecimals(token), symbol: pr.symbol || null, tokenUsd: pr.priceUsd, nativeUsd: await solUsd(pr.pools), jupiter: q,
      });
    }
    let route;
    try { route = await evmRoute(chain, token, amountIn); } catch (e) { return Object.assign(base, { unavailable: e && e.unavailable ? e.message : 'the chain could not be read' }); }
    if (route.unsupported) return Object.assign(base, { unsupported: route.unsupported, deepest: route.deepest ? { dex: route.deepest.dex, labels: route.deepest.labels, url: route.deepest.url } : null });
    const minOut = route.amountOut * BigInt(Math.round((100 - slippage) * 100)) / 10000n;
    const decimals = await evmDecimals(chain, token);
    let usd = null; try { usd = ethUsd ? await ethUsd() : null; } catch {}
    let tokenUsd = null, symbol = null;
    if (chain === 'ethereum') { try { const pr = await mc.pools('ethereum', token); if (pr && !pr.unavailable) { tokenUsd = pr.priceUsd; symbol = pr.symbol || null; } } catch {} }
    return Object.assign(base, {
      amountOut: route.amountOut.toString(), minOut: minOut.toString(), impactPct: route.impactPct,
      route: { kind: route.kind, dex: route.dex, router: route.router, pool: route.pool || null, fee: route.fee || null, path: route.path || null },
      decimals, symbol, tokenUsd, nativeUsd: usd > 0 ? usd : null,
    });
  }

  async function quote(chain, token, amountStr, opts) { const q = await quoteFull(chain, token, amountStr, opts); delete q.jupiter; return q; }

  /* ----- public: the transaction, for the wallet to show ----- */
  async function build(chain, token, amountStr, from, opts = {}) {
    const R = ROUTERS[chain]; if (!R) return { unsupported: 'unknown chain' };
    if (chain === 'solana') {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(from || ''))) return { bad: 'a wallet address is needed to build the swap' };
      const q = await quoteFull(chain, token, amountStr, opts);
      if (!q.amountOut) return q;
      let tx; try { tx = await jupSwap(q.jupiter, from); } catch (e) { return Object.assign(q, { unavailable: e.message, jupiter: undefined }); }
      return Object.assign(q, { jupiter: undefined, tx: { kind: 'solana', swapTransaction: tx.swapTransaction, lastValidBlockHeight: tx.lastValidBlockHeight, simulationError: tx.simulationError, program: R.jupiter } });
    }
    if (!EVM_RE.test(String(from || ''))) return { bad: 'a wallet address is needed to build the swap' };
    const q = await quote(chain, token, amountStr, opts);   // nothing raw to keep on an EVM chain
    if (!q.amountOut) return q;
    const amountIn = BigInt(q.amountIn), minOut = BigInt(q.minOut), deadline = BigInt(Math.floor(now() / 1000) + DEADLINE_S);
    const r = q.route;
    const data = r.kind === 'v3' ? encSwapV3(R.weth, token, r.fee, from, amountIn, minOut, deadline) : encSwapV2(minOut, r.path, from, deadline);
    if (!ALLOWED_TO[chain].includes(r.router)) return Object.assign(q, { unavailable: 'route refused' });   // cannot happen; belt and braces
    return Object.assign(q, { tx: { kind: 'evm', chainId: R.chainId, to: r.router, data, value: '0x' + amountIn.toString(16), deadline: Number(deadline) } });
  }

  /* ----- public: a Solana signature's standing (an EVM receipt is read by the wallet's own node, in the browser) ----- */
  async function status(chain, sig) {
    if (chain !== 'solana') return { bad: 'status is read for Solana signatures; an Ethereum receipt comes from your wallet' };
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(String(sig || ''))) return { bad: 'bad signature' };
    const r = await post(urls.solRpc, { jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses', params: [[sig], { searchTransactionHistory: true }] });
    if (!r || !r.ok || !r.data || !r.data.result) return { unavailable: 'the Solana node could not be read' };
    const v = Array.isArray(r.data.result.value) ? r.data.result.value[0] : null;
    if (!v) return { status: 'pending' };
    return { status: v.err ? 'failed' : (v.confirmationStatus || (v.confirmations == null ? 'finalized' : 'confirmed')), err: v.err || null, slot: v.slot || null };
  }

  return { ROUTERS, ALLOWED_TO, quote, build, status, parseAmount, human, SLIPPAGE_DEFAULT };
}

module.exports = { createSwapKit, ROUTERS, ALLOWED_TO, parseAmount, human, encGetAmountsOut, encSwapV2, encSwapV3, encQuoteV3, impactFrom, SLIPPAGE_DEFAULT };
