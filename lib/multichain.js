'use strict';
/* ===== Scanning a token on Ethereum or Solana ========================================================
   Owner, 2026-10-23: "Allow users to scan Ethereum and Solana tokens also. Enable all pools on both new chains and use
   the same scanning logic from scanning on-chain Robinhood chain tokens for Ethereum and Solana tokens also so all the
   on-chain data is presented to the users in the same way but the color of the borders on the graphic elements use the
   chains color branding, eg, blue for ethereum, and purple for solana".

   Robinhood Chain is read from its own node: PairCreated logs, the factory, Transfer ledgers, block-0 scans. Neither of
   these chains can be read that way from here — a keyless Ethereum node refuses a log walk past a couple of thousand
   blocks ("archive requests require a token"; measured 2026-10-23 on publicnode and drpc), and Solana is not an EVM at
   all. So each reading comes from the place that can give it, and the profile is built into the SAME shape the home
   chain's profile has (pairFromDex, then applyRisk), so every card, figure and flag renders the same way:

     · the pools, prices, liquidity, volume, trades and age — Dexscreener's token-pairs read (every pool of the token,
       up to its 30), and its pair read when the pasted address is a pool itself;
     · holders (the count and the top ten), contract verification, ownership, taxes, the honeypot verdict (Ethereum) and
       mint / freeze / close authorities, transfer fees, metadata and LP burn (Solana) — GoPlus Security's token_security
       read for chain 1 and its /solana/ read (measured 2026-10-23: both answer keyless, with these fields);
     · name, symbol, decimals, supply — the chain itself: eth_call on an Ethereum node, getAccountInfo on a Solana node
       (the mint's authorities are read there too, and cross-checked against GoPlus);
     · candles and the trade tape — GeckoTerminal's OHLCV and trades for the pool, priced in the pool's own quote
       token, with the quote's dollar price from Dexscreener, so the chart reads exactly as the home chain's does.

   What cannot be read is recorded as unread, never as a pass: applyRisk's dataKnown does that already, and the client
   says "not read yet". Block-0 and bundler reads need a chain's full log history and stay Robinhood Chain only.

   Everything here is injected (the fetchers, applyRisk, pairFromDex, the clock, the URLs), so the module can be run in a
   test against fake upstreams and against a fixed clock without a server. ====================================== */

const CF = require('./contractfacts.js');   // GoPlus's EVM reading, the dead addresses and the red-fact rule — shared with the home chain

const CHAINS = {
  robinhood: { slug: 'robinhood', name: 'Robinhood Chain', emoji: '🏹', color: null, evm: true, native: 'ETH', deep: true,
               explorer: 'https://robinhoodchain.blockscout.com', paths: { token: '/token/', address: '/address/', tx: '/tx/' }, ds: 'robinhood', gt: 'robinhood' },
  ethereum:  { slug: 'ethereum', name: 'Ethereum', emoji: 'Ξ', color: '#627eea', evm: true, chainId: 1, native: 'ETH', deep: 'partner',
               explorer: 'https://etherscan.io', paths: { token: '/token/', address: '/address/', tx: '/tx/' }, ds: 'ethereum', gt: 'eth', goplus: '1',
               wrapped: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' },
  solana:    { slug: 'solana', name: 'Solana', emoji: '◎', color: '#9945ff', evm: false, native: 'SOL', deep: 'partner',
               explorer: 'https://solscan.io', paths: { token: '/token/', address: '/account/', tx: '/tx/' }, ds: 'solana', gt: 'solana', goplus: 'solana',
               wrapped: 'So11111111111111111111111111111111111111112' },
};
const SCAN_CHAINS = ['robinhood', 'ethereum', 'solana'];

/* ----- addresses ----- */
const EVM_RE = /^0x[0-9a-f]{40}$/i;
const B58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// decodes a base58 string to bytes; null when a character is not in the alphabet
function b58decode(s) {
  const bytes = [];
  for (const ch of String(s)) {
    let carry = B58.indexOf(ch);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of String(s)) { if (ch !== '1') break; bytes.push(0); }
  return Uint8Array.from(bytes.reverse());
}
const isSolanaAddr = (s) => B58_RE.test(String(s || '')) && (() => { const b = b58decode(s); return !!b && b.length === 32; })();
/* What was pasted, and which chain it is on. A 0x address is the home chain's unless a chain was named (Ethereum
   shares the format: the same address can exist on both, so the caller decides the order to try). A Solana address
   is a 32-byte base58 string and is only ever Solana's. */
function parseAddress(raw, chainHint) {
  const s = String(raw || '').trim();
  const hint = chainHint ? String(chainHint).toLowerCase() : '';
  if (EVM_RE.test(s)) {
    if (hint && hint !== 'robinhood' && hint !== 'ethereum') return null;
    return { chain: hint || 'robinhood', addr: s.toLowerCase(), evm: true };
  }
  if (isSolanaAddr(s)) { if (hint && hint !== 'solana') return null; return { chain: 'solana', addr: s, evm: false }; }
  return null;
}
// the subset of a chain the client is told about (never the URLs the server reads from)
function publicMeta(slug) {
  const c = CHAINS[slug]; if (!c) return null;
  return { slug: c.slug, name: c.name, emoji: c.emoji, color: c.color, evm: c.evm, native: c.native, deep: c.deep, explorer: c.explorer, paths: c.paths, ds: c.ds, gt: c.gt };
}

/* ----- small helpers ----- */
/* A number read from a feed. Number('') and Number(null) are 0, and a 0 IS a reading ("0% tax", "a 0% top holder"), so a
   blank, a null, whitespace and anything that is not a number or a numeric string are null — not read — never 0. */
const num = (x) => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string' || x.trim() === '') return null;
  const v = Number(x); return Number.isFinite(v) ? v : null;
};
const gpFlag = (v) => (v === '1' || v === 1 ? true : v === '0' || v === 0 ? false : null);   // GoPlus answers "1"/"0"; anything else is unknown
const gpNum = num;   // GoPlus's numbers come as strings ("0.0030", "601181"); the same rule — a blank field is unread
const lc = (a) => String(a || '').toLowerCase();
/* eth_getCode's answer → is this address a contract? '0x' is a wallet (no code); an EIP-7702 delegation (0xef0100 + an address)
   is a wallet that delegated its code, so a wallet too; any other code is a contract. null when the node did not say. */
const codeKind = (code) => (typeof code !== 'string' || !/^0x[0-9a-f]*$/i.test(code) ? null : code === '0x' || /^0xef0100[0-9a-f]{40}$/i.test(code) ? false : true);
const sameAddr = (chain, a, b) => CHAINS[chain] && CHAINS[chain].evm ? lc(a) === lc(b) : String(a || '') === String(b || '');
/* The quote assets of each chain — the coins the OTHER tokens are priced in. Dexscreener's token-pairs read lists these
   as the BASE of their own pools (WETH/USDC, USDC/USDT, SOL/USDC…), so a scan of one would profile it as a token with a
   health of 100. The home chain refuses its own this way (QUOTE_SET in server.js); each address here was checked against
   that read on 2026-10-23 before it was pinned: WETH, USDC, WBTC and wrapped SOL answer 30 pools each with themselves as
   the base, USDT 6 of 30, DAI 17 of 30, Solana's USDC 24 of 30 and its USDT 10 of 30. The heuristic in scanFresh (an
   address that appears only as a quote) stays as the fallback for a quote asset not listed here. */
const QUOTE_ASSETS = {
  ethereum: new Set(['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' /* WETH */, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' /* USDC */, '0xdac17f958d2ee523a2206206994597c13d831ec7' /* USDT */,
                     '0x6b175474e89094c44da98b954eedeac495271d0f' /* DAI */, '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' /* WBTC */]),
  solana: new Set(['So11111111111111111111111111111111111111112' /* wrapped SOL */, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' /* USDC */, 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' /* USDT */]),
};
const isQuoteAsset = (slug, addr) => { const s = QUOTE_ASSETS[slug]; return !!s && s.has(CHAINS[slug] && CHAINS[slug].evm ? lc(addr) : String(addr || '')); };
// a string returned by an ERC-20 name()/symbol(): ABI-encoded, or (older tokens) a bare bytes32
function abiString(hex) {
  if (typeof hex !== 'string' || !hex || hex === '0x' || hex.length < 66) return null;   // a node can answer a number, an object or an error object: none is a string to decode
  const h = hex.slice(2);
  try {
    if (h.length === 64) { const b = Buffer.from(h, 'hex'); const end = b.indexOf(0); return b.subarray(0, end < 0 ? 32 : end).toString('utf8').trim() || null; }
    const off = parseInt(h.slice(0, 64), 16) * 2, len = parseInt(h.slice(off, off + 64), 16) * 2;
    if (!Number.isFinite(off) || !Number.isFinite(len) || off + 64 + len > h.length) return null;
    return Buffer.from(h.slice(off + 64, off + 64 + len), 'hex').toString('utf8').trim() || null;
  } catch { return null; }
}
const abiUint = (hex) => { try { return (hex && hex !== '0x') ? BigInt(hex) : null; } catch { return null; } };

const TF_SEC = { '1s': 1, '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
// GeckoTerminal's OHLCV takes a timeframe (minute | hour | day) and an aggregate; a 1s candle has no equivalent, so it is
// served as 1m and the note says so
const GT_TF = { '1s': ['minute', 1, 60], '1m': ['minute', 1, 60], '5m': ['minute', 5, 300], '15m': ['minute', 15, 900], '1h': ['hour', 1, 3600], '4h': ['hour', 4, 14400], '1d': ['day', 1, 86400] };

function createMultichain(deps) {
  const { jgetR, applyRisk, pairFromDex, riskFinish, now = () => Date.now(), fetchImpl = (typeof fetch === 'function' ? fetch : null) } = deps;
  const urls = Object.assign({
    ds: 'https://api.dexscreener.com',
    gt: 'https://api.geckoterminal.com/api/v2',
    goplus: 'https://api.gopluslabs.io/api/v1',
    ethRpc: 'https://ethereum-rpc.publicnode.com',
    solRpc: 'https://api.mainnet-beta.solana.com',
  }, deps.urls || {});
  const rpcOf = (slug) => slug === 'ethereum' ? urls.ethRpc : slug === 'solana' ? urls.solRpc : null;
  const SCAN_TTL = Number(deps.scanTtlMs) || 20 * 1000, CHART_TTL = Number(deps.chartTtlMs) || 90 * 1000, GP_TTL = 10 * 60 * 1000;
  const scanCache = new Map(), chartCache = new Map(), gpCache = new Map(), pairCache = new Map();
  const prune = (m, max) => { if (m.size > max) { const k = m.keys().next().value; m.delete(k); } };

  /* ----- a JSON-RPC call to one of the chains (POST; jgetR is GET-only) — a failure is null, never a throw ----- */
  async function rpc(slug, body) {
    const url = rpcOf(slug); if (!url || !fetchImpl) return null;
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; } finally { clearTimeout(to); }
  }
  // name / symbol / decimals / totalSupply from an Ethereum token, one batched request; each field null when unreadable
  async function evmTokenMeta(addr) {
    const calls = [['0x06fdde03', 'name'], ['0x95d89b41', 'symbol'], ['0x313ce567', 'decimals'], ['0x18160ddd', 'totalSupply']];
    const res = await rpc('ethereum', calls.map(([data], i) => ({ jsonrpc: '2.0', id: i + 1, method: 'eth_call', params: [{ to: addr, data }, 'latest'] })));
    if (!Array.isArray(res)) return null;
    const by = {}; for (const r of res) if (r && r.id) by[r.id] = r.result;
    const dec = abiUint(by[3]), sup = abiUint(by[4]);
    return { name: abiString(by[1]), symbol: abiString(by[2]), decimals: dec != null && dec <= 255n ? Number(dec) : null, totalSupply: sup != null ? sup.toString() : null };
  }
  // decimals / supply / mint and freeze authorities from a Solana mint account
  async function solMintInfo(mint) {
    const res = await rpc('solana', { jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [mint, { encoding: 'jsonParsed' }] });
    const v = res && res.result && res.result.value;
    const info = v && v.data && v.data.parsed && v.data.parsed.type === 'mint' ? v.data.parsed.info : null;
    if (!info) return v === null ? { missing: true } : null;   // null value = no account at this address (a fact); no parse = unreadable
    return { decimals: num(info.decimals), supply: info.supply != null ? String(info.supply) : null, mintAuthority: info.mintAuthority || null, freezeAuthority: info.freezeAuthority || null, program: v.owner || null };
  }

  /* ----- Dexscreener: every pool of a token, or a pool by its address ----- */
  async function dsTokenPools(slug, addr) {
    const r = await jgetR(urls.ds + '/token-pairs/v1/' + CHAINS[slug].ds + '/' + encodeURIComponent(addr));
    if (!r.ok) return { ok: false, reason: r.reason };
    const arr = Array.isArray(r.data) ? r.data : (r.data && Array.isArray(r.data.pairs) ? r.data.pairs : []);
    // raw: how many pairs the read held before any filter — Dexscreener stops this read at 30, so 30 means "30 or more"
    return { ok: true, pairs: arr.filter((d) => d && d.pairAddress && d.chainId === CHAINS[slug].ds), raw: arr.length };
  }
  async function dsPair(slug, pool) {
    const k = slug + ':' + pool, hit = pairCache.get(k);
    if (hit && now() - hit.at < 60 * 1000) return hit.v;
    const r = await jgetR(urls.ds + '/latest/dex/pairs/' + CHAINS[slug].ds + '/' + encodeURIComponent(pool));
    const d = r.ok && r.data && Array.isArray(r.data.pairs) && r.data.pairs[0] && r.data.pairs[0].pairAddress ? r.data.pairs[0] : null;
    const v = { ok: r.ok, pair: d, reason: r.reason };
    if (r.ok) { prune(pairCache, 500); pairCache.set(k, { at: now(), v }); }
    return v;
  }
  /* ----- GoPlus: the security read, kept for ten minutes (it changes slowly, and its budget is 28 a minute) ----- */
  async function goplus(slug, addr) {
    const k = slug + ':' + addr, hit = gpCache.get(k);
    if (hit && now() - hit.at < GP_TTL) return hit.v;
    const path = slug === 'solana' ? '/solana/token_security?contract_addresses=' : '/token_security/' + CHAINS[slug].goplus + '?contract_addresses=';
    const r = await jgetR(urls.goplus + path + encodeURIComponent(addr));
    let raw = null;
    if (r.ok && r.data && r.data.result && typeof r.data.result === 'object') {
      const key = Object.keys(r.data.result).find((x) => sameAddr(slug, x, addr)) || Object.keys(r.data.result)[0];
      raw = key ? r.data.result[key] : null;
    }
    const v = { ok: r.ok, raw, at: now(), reason: r.reason };
    if (r.ok) { prune(gpCache, 1000); gpCache.set(k, { at: now(), v }); }
    return v;
  }

  /* ----- the pools list the dashboard shows: every pool that prices this token, deepest first ----- */
  function poolsOf(slug, tokenAddr, pairs) {
    return pairs
      .filter((d) => d.baseToken && sameAddr(slug, d.baseToken.address, tokenAddr))   // pools where the token is what is priced, not the quote
      .map((d) => ({
        // an EVM address is lower-cased everywhere on this site (Dexscreener returns it checksummed); a Solana address keeps its case, which is the address
        address: CHAINS[slug].evm ? lc(d.pairAddress) : String(d.pairAddress), dex: d.dexId || null, labels: Array.isArray(d.labels) ? d.labels : [],
        quote: { symbol: (d.quoteToken && d.quoteToken.symbol) || '?', address: d.quoteToken && d.quoteToken.address ? (CHAINS[slug].evm ? lc(d.quoteToken.address) : String(d.quoteToken.address)) : null },
        liquidityUsd: d.liquidity && d.liquidity.usd != null ? num(d.liquidity.usd) : null,
        volume24: d.volume && d.volume.h24 != null ? num(d.volume.h24) : null,
        priceUsd: d.priceUsd != null ? num(d.priceUsd) : null,
        createdAt: d.pairCreatedAt || null, url: typeof d.url === 'string' && /^https:\/\/dexscreener\.com\//.test(d.url) ? d.url : null,
      }))
      .sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
  }

  /* ----- what GoPlus and the chain say about the contract, in the words the cards use (chainFacts) ----- */
  function evmFacts(g, meta) { return CF.evmFacts(g, meta); }   // lib/contractfacts.js: the same reading the home chain's profile uses
  function solFacts(g, mint, mainPool) {
    const st = (o) => (o && o.status != null) ? gpFlag(String(o.status)) : null;
    const auth = (o) => (o && Array.isArray(o.authority) && o.authority.length) ? o.authority.map((a) => a.address).filter(Boolean) : [];
    const fee = g && g.transfer_fee && g.transfer_fee.current_fee_rate ? gpNum(g.transfer_fee.current_fee_rate.fee_rate) : null;
    const pool = g && Array.isArray(g.dex) && mainPool ? g.dex.find((d) => d && String(d.id) === String(mainPool)) : null;
    return {
      // the chain's own answer first (getAccountInfo), GoPlus's where the chain could not be read
      mintable: mint && !mint.missing ? !!mint.mintAuthority : st(g && g.mintable),
      mintAuthority: mint && mint.mintAuthority ? mint.mintAuthority : (auth(g && g.mintable)[0] || null),
      freezable: mint && !mint.missing ? !!mint.freezeAuthority : st(g && g.freezable),
      freezeAuthority: mint && mint.freezeAuthority ? mint.freezeAuthority : (auth(g && g.freezable)[0] || null),
      closable: st(g && g.closable), balanceMutable: st(g && g.balance_mutable_authority), metadataMutable: st(g && g.metadata_mutable),
      transferFeePct: fee != null ? fee * 100 : (g && g.transfer_fee && Object.keys(g.transfer_fee).length === 0 ? 0 : null),
      transferHook: g && Array.isArray(g.transfer_hook) ? g.transfer_hook.length > 0 : null,
      nonTransferable: g ? gpFlag(g.non_transferable != null ? g.non_transferable : g.none_transferable) : null,
      trusted: g ? gpFlag(g.trusted_token != null ? String(g.trusted_token) : null) : null,
      defaultFrozen: g && g.default_account_state != null ? String(g.default_account_state) === '2' : null,
      lpBurnedPct: pool && pool.burn_percent != null ? gpNum(pool.burn_percent) : null,
      program: mint && mint.program ? mint.program : null,
      source: g ? 'goplus' : (mint && !mint.missing ? 'chain' : null),
    };
  }

  /* ----- the profile ----- */
  async function scan(slug, addr, opts = {}) {
    const C = CHAINS[slug];
    if (!C || slug === 'robinhood') return { notFound: true, reason: 'chain' };
    const key = slug + ':' + addr, hit = scanCache.get(key);
    if (hit && now() - hit.at < SCAN_TTL && !opts.fresh) return hit.v;
    const v = await scanFresh(slug, addr);
    if (!v.unavailable) { prune(scanCache, 500); scanCache.set(key, { at: now(), v }); }
    return v;
  }
  async function scanFresh(slug, addr) {
    const C = CHAINS[slug];
    // 0) a quote asset (WETH, USDC, SOL…) is what tokens are priced IN; it is named as one, never profiled as a token
    if (isQuoteAsset(slug, addr)) return { notFound: true, reason: 'quote' };
    // 1) every pool of this token
    let tp = await dsTokenPools(slug, addr);
    if (!tp.ok) return { unavailable: true, reason: 'the price feed could not be read (' + (tp.reason || 'no answer') + ')' };
    let kind = 'token', pool = null, tokenAddr = addr;
    let listRead = true, listRaw = tp.raw;   // was the token's own pool list read, and how many pairs did it hold
    let pools = poolsOf(slug, addr, tp.pairs);
    if (!pools.length) {
      // 2) nothing prices this address — is it a pool itself? Dexscreener's pair read says which token it prices
      const pr = await dsPair(slug, addr);
      if (!pr.ok) return { unavailable: true, reason: 'the price feed could not be read (' + (pr.reason || 'no answer') + ')' };
      if (!pr.pair || !pr.pair.baseToken || !pr.pair.baseToken.address) {
        // a quote asset (WETH, SOL, USDC…) shows up only as the quote side of pools, never as a base
        const asQuote = tp.pairs.some((d) => d.quoteToken && sameAddr(slug, d.quoteToken.address, addr));
        return { notFound: true, reason: asQuote ? 'quote' : 'none' };
      }
      kind = 'pool'; pool = addr; tokenAddr = C.evm ? lc(pr.pair.baseToken.address) : String(pr.pair.baseToken.address);
      if (isQuoteAsset(slug, tokenAddr)) return { notFound: true, reason: 'quote' };   // a WETH/USDC pool prices a quote asset, not a token
      /* the token's other pools — and when that second read fails, or lists the token's 30 deepest without this one, the
         pasted pool's own pair (read a moment ago) stands in, so a pool whose own read succeeded always profiles. Both
         lists are kept in `tp`, because the charted pool's full Dexscreener row is looked up there next. */
      const more = await dsTokenPools(slug, tokenAddr);
      const listed = more.ok ? more.pairs : [];
      listRead = !!more.ok; listRaw = more.ok ? more.raw : null;
      tp = { ok: true, pairs: listed.some((d) => sameAddr(slug, d.pairAddress, addr)) ? listed : listed.concat([pr.pair]) };
      pools = poolsOf(slug, tokenAddr, tp.pairs);
      if (!pools.length) return { notFound: true, reason: 'none' };
    }
    const main = pools[0];
    const mainDex = tp.pairs.find((d) => sameAddr(slug, d.pairAddress, main.address)) || null;
    if (!mainDex) return { unavailable: true, reason: 'the price feed listed a pool it did not describe' };   // main came from tp.pairs, so this cannot happen; pairFromDex(null) would throw and the scan would 502
    // 3) the security read and the chain's own metadata, side by side; neither blocks the other and neither is required
    const [gp, meta] = await Promise.all([
      goplus(slug, tokenAddr),
      C.evm ? evmTokenMeta(tokenAddr) : solMintInfo(tokenAddr),
    ]);
    const g = gp && gp.raw;
    // 4) the same shape the home chain's profile has
    const pair = pairFromDex(mainDex, slug);
    pair.chain = slug;
    pair.pair.address = main.address;   // the pool's address as this site writes it (lower-cased on an EVM chain)
    pair.links = { dex: main.url, explorer: C.explorer + C.paths.token + encodeURIComponent(tokenAddr) };
    pair.pools = pools;
    /* The token's depth across the pools listed, next to the charted pool's own (market.liquidityUsd is the deepest pool's
       and stays so): the sum of the pools whose liquidity Dexscreener gave, null when it gave none; the client says
       "across N pools · deepest $X". When a pasted pool's token list could not be read, the one pool shown is not the
       token's count or its depth, so both stay unread (null) rather than "1 pool".
       poolsCapped: Dexscreener's token-pairs read stops at 30 pairs (and the list keeps only the pools that price this
       token), so a full answer means there may be more pools than are listed — true at 30 or more, false under, null
       when the read failed. The dashboard says "30+" from it, never "every pool". */
    const known = pools.filter((o) => o.liquidityUsd != null);
    pair.market.liquidityTotalUsd = listRead && known.length ? known.reduce((a, o) => a + o.liquidityUsd, 0) : null;
    pair.market.poolCount = listRead ? pools.length : null;
    pair.poolsCapped = listRead && Number.isFinite(listRaw) ? listRaw >= 30 : null;
    const t = pair.token;
    t.address = C.evm ? lc(tokenAddr) : tokenAddr;
    if (C.evm) {
      if (meta) { if (meta.name) t.name = meta.name; if (meta.symbol) t.symbol = meta.symbol; t.decimals = meta.decimals; t.totalSupply = meta.totalSupply; }
      if (g) {
        if (t.name === 'Unknown Token' && g.token_name) t.name = String(g.token_name);
        if (t.symbol === '???' && g.token_symbol) t.symbol = String(g.token_symbol);
        // GoPlus gives the supply in whole tokens; the client divides a raw figure by the decimals, so it is only used when the
        // chain did not answer AND the decimals are known — else the supply stays unread rather than wrong by a power of ten
        if (t.totalSupply == null && g.total_supply && t.decimals != null) { const w = num(g.total_supply); if (w != null) t.totalSupply = BigInt(Math.round(w)).toString() + '0'.repeat(t.decimals); }
        t.isVerified = gpFlag(g.is_open_source);
        t.deployer = g.creator_address ? lc(g.creator_address) : null;
      }
      pair.chainFacts = evmFacts(g, meta);
      if (g) {
        /* "renounced" takes more than a zero owner. GoPlus also says whether the contract can take ownership back
           (can_take_back_ownership) or hides an owner behind the public one (hidden_owner): either means somebody can still
           change the rules, zero owner or not. Null when GoPlus gave no owner at all — not read, not renounced. */
        const f = pair.chainFacts;
        /* Renounced = the owner is a DEAD address — the zero address, 0x…dEaD or 0xdead…42069 (owner, 2026-10-24: "renounced or
           owned by a dead address … the developer of the project cannot use any of those functions anymore"). ownerBurn keeps
           which one, so the card can show where ownership went. A live owner is shown with its address, and whether it is a
           contract or a wallet (the node's eth_getCode: code = a contract; none = a wallet). */
        const own = f.owner;
        const burn = own != null && CF.isDead(own);
        t.owner = own && !burn ? own : null;
        t.ownerBurn = burn ? own : null;
        t.renounced = own == null ? null : (burn && f.takeBack !== true && f.hiddenOwner !== true);
        if (t.owner) { const r = await rpc('ethereum', { jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [t.owner, 'latest'] }); t.ownerIsContract = codeKind(r && r.result); }
        /* Each live LP holder GoPlus lists, named by the node's answer (one eth_getCode batch), not GoPlus's is_contract — which calls an
           EIP-7702 wallet a contract (review, 2026-10-24). GoPlus's answer stays, marked as GoPlus's, where the node did not say. */
        const live = Array.isArray(f.lpTop) ? f.lpTop.filter((h) => !h.dead) : [];
        if (live.length) {
          const res = await rpc('ethereum', live.map((h, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'eth_getCode', params: [h.address, 'latest'] })));
          const by = Array.isArray(res) ? new Map(res.map((x) => [x && x.id, x && x.result])) : new Map();
          live.forEach((h, i) => { const k = codeKind(by.get(i + 1)); if (k != null) { h.contract = k; h.kindSource = 'chain'; } else if (h.contract != null) h.kindSource = 'goplus'; });
        }
      }
    } else {
      const md = g && g.metadata;
      if (md && md.name) t.name = String(md.name); if (md && md.symbol) t.symbol = String(md.symbol);
      if (meta && !meta.missing) { t.decimals = meta.decimals; t.totalSupply = meta.supply; }
      else if (g && g.total_supply && t.decimals != null) { const w = num(g.total_supply); if (w != null) t.totalSupply = BigInt(Math.round(w)).toString() + '0'.repeat(t.decimals); }
      pair.chainFacts = solFacts(g, meta, main.address);
      /* Solana has no contract owner to renounce; what can be given up are the mint and freeze authorities. token.renounced
         stays null here (the client's sentence about it — "the rules can no longer be changed" — is an EVM one), and
         chainFacts.authoritiesRevoked carries Solana's answer: true when both authorities are gone, false while either is
         still held, null when neither the node nor GoPlus said. */
      const f = pair.chainFacts;
      f.authoritiesRevoked = (f.mintable === false && f.freezable === false) ? true : (f.mintable === true || f.freezable === true) ? false : null;
      t.renounced = null;
      t.owner = f.mintAuthority || f.freezeAuthority || null;
      t.isVerified = null;   // "verified source" is an EVM idea; a Solana program's verification is not read here
    }
    // 5) holders, from GoPlus: the count, and the top ten as shares of supply — pools and burn addresses are not people
    if (g) {
      const poolSet = new Set(pools.map((p) => C.evm ? lc(p.address) : p.address));
      const hs = Array.isArray(g.holders) ? g.holders : [];
      /* GoPlus names an Ethereum holder by `address`, and a Solana holder by `account` — the OWNER (a wallet, or a program's
         account such as a pool's) — with `token_account`, the vault that holds the balance. The owner is the holder, and it
         is what a pool's id (Dexscreener's) can match: an Orca whirlpool or a Meteora pool owns its vaults directly, so a
         pool vault keyed by its token account could never be excluded and was shown as a top holder. Solana rows are
         therefore keyed by `account`, matched against the pool set on both the owner and the vault, and rows of one owner
         are added up (a wallet can hold through more than one token account; the sum is of the shares GoPlus listed, no
         more). Both chains then list owners, so `kind` is 'wallets' on both — contracts and program accounts among them,
         as on the home chain — and the client's note about token accounts no longer applies. */
      const byOwner = new Map();
      for (const h of hs) {
        const owner = C.evm ? lc(h.address) : String(h.account || h.token_account || '');
        const vault = !C.evm && h.token_account ? String(h.token_account) : null;
        const pct = gpNum(h.percent) != null ? gpNum(h.percent) * 100 : null;
        if (!owner || pct == null || poolSet.has(owner) || (vault && poolSet.has(vault)) || /^0x0{40}$|^0x0{36}dead$/.test(owner)) continue;
        if (/\b(pool|raydium|orca|meteora|vault|lp|liquidity)\b/i.test(String(h.tag || ''))) continue;
        const row = byOwner.get(owner) || { address: owner, pct: 0, locked: false, contract: false };
        row.pct += pct;
        row.locked = row.locked || gpFlag(h.is_locked != null ? String(h.is_locked) : null) === true;
        row.contract = row.contract || gpFlag(h.is_contract != null ? String(h.is_contract) : null) === true;
        byOwner.set(owner, row);
      }
      const real = [...byOwner.values()].sort((a, b) => b.pct - a.pct);
      const cnt = gpNum(g.holder_count);
      pair.holders = {
        count: cnt != null && cnt > 0 ? cnt : null,
        topHolderPct: real.length ? real[0].pct : null,
        top10Pct: real.length ? real.slice(0, 10).reduce((a, b) => a + b.pct, 0) : null,
        top: real.slice(0, 10).map(({ address, pct, locked }) => ({ address, pct, locked })),
        readAt: gp.at, source: 'goplus', block: null,
        kind: 'wallets',   // owners on both chains (see above)
      };
    }
    pair.indexed = true;
    pair.priceAsOf = now();
    // 6) the same risk model; then the readings only this read has — a vendor's honeypot verdict counts as the honeypot flag
    applyRisk(pair, {}, {});
    if (pair.chainFacts && pair.chainFacts.honeypot === true) { pair.risk.honeypotSuspect = true; pair.risk.honeypotSource = 'goplus'; if (riskFinish) riskFinish(pair); }
    pair.risk.dataKnown = Object.assign({}, pair.risk.dataKnown, { snipers: false, block0: false });   // never read on these chains
    /* poolVerified: on the home chain a pasted pool is checked against its factory on-chain; here no chain read checks it —
       Dexscreener's pair read says which token it prices, and that is all that is known — so it is never claimed (the
       server words it "Dexscreener says it prices this token") */
    return { kind, pool, poolVerified: kind === 'pool' ? null : undefined, pair, pools, readAt: now(), stale: false };
  }

  /* ----- the chart: GeckoTerminal's candles and trades for one pool, in the home chart's shape -----
     `tokenAddr` (optional) names the token the chart is OF — the profile's token. Dexscreener and GeckoTerminal store some
     pools the opposite way round (measured 2026-10-23: PEPE/ETH on Uniswap v4 at 2.5%, several SHIB and BONK pools), so
     candles asked for "the base" would there be the QUOTE's price in our token, and a trade's `kind` is relative to
     GeckoTerminal's base. Its `token` parameter takes an address as well as base|quote (verified 2026-10-23 on
     /ohlcv/hour: token=<address> orients the candles AND `meta` so that meta.base is that token; a lower-cased Solana mint
     is refused — "Invalid token. Allowed values: base, quote, <the pool's two addresses>" — so an address is sent as its
     chain writes it), so the candles are asked in our token whichever way the pool is stored, and a trade is a buy when
     our token is what the trader received. Without a caller's token, Dexscreener's base is ours — the orientation the
     profile's pools list uses — and without Dexscreener, GeckoTerminal's own base, named from its meta. */
  async function candles(slug, pool, tfKey, hours, tokenAddr) {
    const C = CHAINS[slug]; if (!C || slug === 'robinhood') return null;
    const tf = GT_TF[tfKey] ? tfKey : '1h';
    const [gtf, agg, tfSec] = GT_TF[tf];
    const limit = Math.max(2, Math.min(1000, Math.ceil(((Number(hours) || 168) * 3600) / tfSec)));
    const want = tokenAddr ? (C.evm ? lc(tokenAddr) : String(tokenAddr)) : null;
    // keyed by the width served too: a day's ask and a month's ask of the same pool and candle are different answers
    const key = slug + ':' + pool + ':' + tf + ':' + limit + ':' + (want || '-'), hit = chartCache.get(key);
    if (hit && now() - hit.at < CHART_TTL) return hit.v;
    const base = urls.gt + '/networks/' + C.gt + '/pools/' + encodeURIComponent(pool);
    // the pool's two tokens and the other one's dollar price, from Dexscreener (one cached read)
    const pr = await dsPair(slug, pool);
    const d = pr.pair;
    const asOurs = (a) => a ? (C.evm ? lc(a) : String(a)) : null;
    const dBase = asOurs(d && d.baseToken && d.baseToken.address), dQuote = asOurs(d && d.quoteToken && d.quoteToken.address);
    let tok = want || dBase;
    /* the quote: the token the candles are priced in, and its dollar price. Dexscreener's priceUsd is ITS base's dollar
       price and priceNative that base's price in its quote — so when our token is its base, the quote's dollar price is
       the ratio; when our token is its quote, the other token is its base, priced in dollars directly. Nothing else is
       a dollar figure that was read. */
    let quoteSym = null, quoteUsd = null;
    if (d && tok && dBase && sameAddr(slug, tok, dBase)) {
      quoteSym = d.quoteToken && d.quoteToken.symbol ? String(d.quoteToken.symbol) : null;
      quoteUsd = num(d.priceUsd) > 0 && num(d.priceNative) > 0 ? num(d.priceUsd) / num(d.priceNative) : null;
    } else if (d && tok && dQuote && sameAddr(slug, tok, dQuote)) {
      quoteSym = d.baseToken && d.baseToken.symbol ? String(d.baseToken.symbol) : null;
      quoteUsd = num(d.priceUsd) > 0 ? num(d.priceUsd) : null;
    }
    const [oh, tr] = await Promise.all([
      jgetR(base + '/ohlcv/' + gtf + '?aggregate=' + agg + '&limit=' + limit + '&currency=token&token=' + (tok ? encodeURIComponent(tok) : 'base')),
      jgetR(base + '/trades?trade_volume_in_usd_greater_than=0'),
    ]);
    if (!oh.ok) {
      const last = chartCache.get(key);
      if (last) return Object.assign({}, last.v, { stale: true, ageMs: now() - last.at });
      return { error: 'the chart source (GeckoTerminal) could not be read just now', retry: oh.reason === 'rate-limited' || oh.reason === 'timed out' || oh.reason === 'unreachable' };
    }
    // GeckoTerminal's own naming of the two sides, oriented to the token asked for (meta.base is that token)
    const meta = oh.data && oh.data.meta && typeof oh.data.meta === 'object' ? oh.data.meta : null;
    const mBase = asOurs(meta && meta.base && meta.base.address);
    if (!tok) {
      // nobody named our token and Dexscreener did not answer: GeckoTerminal's base is taken as ours — unless that base is a
      // quote asset (WETH, USDC, SOL…) and the other side is not, which is a pool it stores the other way round: those
      // candles are the quote's price in our token, so no chart rather than the wrong one (the next ask reads Dexscreener again)
      const mQuote = asOurs(meta && meta.quote && meta.quote.address);
      if (mBase && isQuoteAsset(slug, mBase) && mQuote && !isQuoteAsset(slug, mQuote)) return { error: 'the chart source could not say which side of this pool is the token just now', retry: true };
      tok = mBase;
    }
    // the candles must be in OUR token: if GeckoTerminal says its base is the other one, nothing here may be labelled as ours
    if (mBase && tok && !sameAddr(slug, mBase, tok)) return { error: 'the chart source priced this pool the other way round, so these candles cannot be labelled', retry: false };
    // Dexscreener did not answer (or named neither side): the quote's NAME is GeckoTerminal's, and its dollar price stays unread —
    // and when neither source names the quote there is no honest unit to print, so no chart rather than a wrong one
    if (quoteSym == null && meta && meta.quote && meta.quote.symbol && (!mBase || !tok || sameAddr(slug, mBase, tok))) quoteSym = String(meta.quote.symbol);
    if (!quoteSym) return { error: 'the chart source did not say which token this pool is priced in', retry: true };
    const list = oh.data && oh.data.data && oh.data.data.attributes && Array.isArray(oh.data.data.attributes.ohlcv_list) ? oh.data.data.attributes.ohlcv_list : [];
    const cs = list.map((r) => ({ t: Number(r[0]), o: num(r[1]), h: num(r[2]), l: num(r[3]), c: num(r[4]), v: num(r[5]), n: null }))
      .filter((c) => Number.isFinite(c.t) && c.o != null && c.c != null).sort((a, b) => a.t - b.t);
    const trades = (tr.ok && tr.data && Array.isArray(tr.data.data) ? tr.data.data : []).map((x) => {
      const a = x && x.attributes; if (!a) return null;
      // a buy is a trade in which our token is what the trader received; a trade that touched neither side of ours is dropped, not guessed
      const buy = tok && a.to_token_address && sameAddr(slug, a.to_token_address, tok) ? true : tok && a.from_token_address && sameAddr(slug, a.from_token_address, tok) ? false : null;
      const ts = Date.parse(a.block_timestamp);
      return Number.isFinite(ts) && buy != null ? {
        ts, isBuy: buy, tok: num(buy ? a.to_token_amount : a.from_token_amount), quote: num(buy ? a.from_token_amount : a.to_token_amount),
        // wallet: GeckoTerminal's tx_from_address is the transaction's SIGNER (a router's caller, a bot, a smart wallet's
        // relayer), not necessarily who received the tokens; whether this was a first buy, or routed through a contract, is
        // not read here — null, never false (the home chain reads both from its own ledger)
        usd: num(a.volume_in_usd), wallet: a.tx_from_address || null, hash: a.tx_hash || null, firstBuy: null, viaContract: null,
      } : null;
    }).filter(Boolean).sort((a, b) => b.ts - a.ts);
    const supply = null;   // today's supply comes with the profile, not the chart; the client has it from there
    const v = {
      // the width actually served: a 1s ask is answered with minute candles, and says so (tfSec is the truth either way)
      pair: pool, token: tok, tf: tfKey === '1s' ? '1m' : tf, tfSec, chain: slug,
      quote: quoteSym, quoteUsd, ethUsd: null, supply, supplyAsOf: null,
      candles: cs, swaps: null,
      source: 'GeckoTerminal (candles and trades for this pool), drawn here',
      // traders: null — no per-wallet history is read on these chains (the home chain's {} means "read, and nobody"); tapeAddr
      // says what the tape's address column is: the transaction's signer
      trades, traders: null, tapeAddr: 'signer',
      explorer: C.explorer, explorerPaths: C.paths,
      tapeFrom: trades.length ? trades[trades.length - 1].ts : null, tapeTo: trades.length ? trades[0].ts : null, tapeAt: now(),
      tapeViaContract: null, exactTimes: true,
      sources: { dexscreener: !!d, geckoterminal: true },
      // an empty answer is GeckoTerminal having no candles, not a chain read of the pool: it says nothing about whether anyone traded
      note: cs.length ? (tfKey === '1s' ? 'The chart source has no one-second candles for this chain, so these are one-minute candles.' : null) : 'GeckoTerminal has no candles for this pool in this window — that says nothing about whether it traded.',
    };
    prune(chartCache, 300); chartCache.set(key, { at: now(), v });
    return v;
  }

  // the pools alone (the swap picks its route from them): the same Dexscreener read and order the profile uses, cached a minute
  const poolsCache = new Map();
  async function pools(slug, tokenAddr) {
    const C = CHAINS[slug]; if (!C || slug === 'robinhood') return null;
    const addr = C.evm ? lc(tokenAddr) : String(tokenAddr);
    const k = slug + ':' + addr, hit = poolsCache.get(k);
    if (hit && now() - hit.at < 60 * 1000) return hit.v;
    const tp = await dsTokenPools(slug, addr);
    if (!tp.ok) return { unavailable: true, reason: tp.reason };
    const d0 = tp.pairs.find((d) => d.baseToken && sameAddr(slug, d.baseToken.address, addr));
    const v = { pools: poolsOf(slug, addr, tp.pairs), symbol: d0 && d0.baseToken ? String(d0.baseToken.symbol || '') : '', priceUsd: d0 ? num(d0.priceUsd) : null };
    prune(poolsCache, 500); poolsCache.set(k, { at: now(), v });
    return v;
  }
  return { CHAINS, SCAN_CHAINS, parseAddress, publicMeta, isSolanaAddr, b58decode, scan, candles, poolsOf, pools, dsPair, _caches: { scanCache, chartCache, gpCache, pairCache } };
}

module.exports = { codeKind, createMultichain, CHAINS, SCAN_CHAINS, QUOTE_ASSETS, isQuoteAsset, parseAddress, publicMeta, isSolanaAddr, b58decode, abiString, num, TF_SEC, GT_TF };
