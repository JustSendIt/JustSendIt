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
const num = (x) => { const v = Number(x); return Number.isFinite(v) ? v : null; };
const gpFlag = (v) => (v === '1' || v === 1 ? true : v === '0' || v === 0 ? false : null);   // GoPlus answers "1"/"0"; anything else is unknown
const gpNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const lc = (a) => String(a || '').toLowerCase();
const sameAddr = (chain, a, b) => CHAINS[chain] && CHAINS[chain].evm ? lc(a) === lc(b) : String(a || '') === String(b || '');
// a string returned by an ERC-20 name()/symbol(): ABI-encoded, or (older tokens) a bare bytes32
function abiString(hex) {
  if (!hex || hex === '0x' || hex.length < 66) return null;
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
    return { ok: true, pairs: arr.filter((d) => d && d.pairAddress && d.chainId === CHAINS[slug].ds) };
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
  function evmFacts(g, meta) {
    if (!g) return null;
    const pct = (v) => { const n = gpNum(v); return n == null ? null : n * 100; };
    return {
      honeypot: gpFlag(g.is_honeypot), cannotSellAll: gpFlag(g.cannot_sell_all), cannotBuy: gpFlag(g.cannot_buy),
      buyTax: pct(g.buy_tax), sellTax: pct(g.sell_tax), transferTax: pct(g.transfer_tax),
      mintable: gpFlag(g.is_mintable), proxy: gpFlag(g.is_proxy), blacklist: gpFlag(g.is_blacklisted), whitelist: gpFlag(g.is_whitelisted),
      pausable: gpFlag(g.transfer_pausable), cooldown: gpFlag(g.trading_cooldown), takeBack: gpFlag(g.can_take_back_ownership), hiddenOwner: gpFlag(g.hidden_owner),
      selfdestruct: gpFlag(g.selfdestruct), externalCall: gpFlag(g.external_call), antiWhale: gpFlag(g.is_anti_whale), inDex: gpFlag(g.is_in_dex), inCex: gpFlag(g.is_in_cex),
      lpHolders: gpNum(g.lp_holder_count), lpLockedPct: Array.isArray(g.lp_holders) ? g.lp_holders.reduce((a, h) => a + (gpFlag(h.is_locked) ? (gpNum(h.percent) || 0) * 100 : 0), 0) : null,
      creator: g.creator_address ? lc(g.creator_address) : null, source: 'goplus', program: meta && meta.program || null,
    };
  }
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
    // 1) every pool of this token
    let tp = await dsTokenPools(slug, addr);
    if (!tp.ok) return { unavailable: true, reason: 'the price feed could not be read (' + (tp.reason || 'no answer') + ')' };
    let kind = 'token', pool = null, tokenAddr = addr;
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
      tp = await dsTokenPools(slug, tokenAddr);
      pools = tp.ok ? poolsOf(slug, tokenAddr, tp.pairs) : [];
      if (!pools.length) pools = poolsOf(slug, tokenAddr, [pr.pair]);
      if (!pools.length) return { notFound: true, reason: 'none' };
    }
    const main = pools[0];
    const mainDex = tp.pairs.find((d) => sameAddr(slug, d.pairAddress, main.address)) || null;
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
    const t = pair.token;
    t.address = C.evm ? lc(tokenAddr) : tokenAddr;
    if (C.evm) {
      if (meta) { if (meta.name) t.name = meta.name; if (meta.symbol) t.symbol = meta.symbol; t.decimals = meta.decimals; t.totalSupply = meta.totalSupply; }
      if (g) {
        if (t.name === 'Unknown Token' && g.token_name) t.name = String(g.token_name);
        if (t.symbol === '???' && g.token_symbol) t.symbol = String(g.token_symbol);
        // GoPlus gives the supply in whole tokens; the client divides a raw figure by the decimals, so it is only used when the
        // chain did not answer AND the decimals are known — else the supply stays unread rather than wrong by a power of ten
        if (t.totalSupply == null && g.total_supply && t.decimals != null) { const w = Number(g.total_supply); if (Number.isFinite(w)) t.totalSupply = BigInt(Math.round(w)).toString() + '0'.repeat(t.decimals); }
        t.isVerified = gpFlag(g.is_open_source);
        const own = g.owner_address != null ? lc(g.owner_address) : null;
        t.owner = own && !/^0x0{40}$/.test(own) ? own : null;
        t.renounced = own == null || own === '' ? null : /^0x0{40}$/.test(own);
        t.deployer = g.creator_address ? lc(g.creator_address) : null;
      }
      pair.chainFacts = evmFacts(g, meta);
    } else {
      const md = g && g.metadata;
      if (md && md.name) t.name = String(md.name); if (md && md.symbol) t.symbol = String(md.symbol);
      if (meta && !meta.missing) { t.decimals = meta.decimals; t.totalSupply = meta.supply; }
      else if (g && g.total_supply && t.decimals != null) { const w = Number(g.total_supply); if (Number.isFinite(w)) t.totalSupply = BigInt(Math.round(w)).toString() + '0'.repeat(t.decimals); }
      pair.chainFacts = solFacts(g, meta, main.address);
      // Solana's answer to "renounced": the mint and freeze authorities are gone, so nobody can mint more or freeze accounts
      const f = pair.chainFacts;
      t.renounced = (f.mintable === false && f.freezable === false) ? true : (f.mintable === true || f.freezable === true) ? false : null;
      t.owner = f.mintAuthority || f.freezeAuthority || null;
      t.isVerified = null;   // "verified source" is an EVM idea; a Solana program's verification is not read here
    }
    // 5) holders, from GoPlus: the count, and the top ten as shares of supply — pools and burn addresses are not people
    if (g) {
      const poolSet = new Set(pools.map((p) => C.evm ? lc(p.address) : p.address));
      const hs = Array.isArray(g.holders) ? g.holders : [];
      const real = hs.map((h) => ({
        address: C.evm ? lc(h.address) : String(h.token_account || h.address || ''),
        pct: gpNum(h.percent) != null ? gpNum(h.percent) * 100 : null,
        locked: gpFlag(h.is_locked != null ? String(h.is_locked) : null) === true, tag: h.tag || '',
        contract: gpFlag(h.is_contract != null ? String(h.is_contract) : null) === true,
      })).filter((h) => h.address && h.pct != null && !poolSet.has(h.address) && !/^0x0{40}$|^0x0{36}dead$/.test(h.address)
        && !/\b(pool|raydium|orca|meteora|vault|lp|liquidity)\b/i.test(h.tag));
      const cnt = gpNum(g.holder_count);
      pair.holders = {
        count: cnt != null && cnt > 0 ? cnt : null,
        topHolderPct: real.length ? real[0].pct : null,
        top10Pct: real.length ? real.slice(0, 10).reduce((a, b) => a + b.pct, 0) : null,
        top: real.slice(0, 10).map(({ address, pct, locked }) => ({ address, pct, locked })),
        readAt: gp.at, source: 'goplus', block: null,
        kind: C.evm ? 'wallets' : 'token accounts',   // GoPlus lists Solana holders by token account, not by owner wallet
      };
    }
    pair.indexed = true;
    pair.priceAsOf = now();
    // 6) the same risk model; then the readings only this read has — a vendor's honeypot verdict counts as the honeypot flag
    applyRisk(pair, {}, {});
    if (pair.chainFacts && pair.chainFacts.honeypot === true) { pair.risk.honeypotSuspect = true; pair.risk.honeypotSource = 'goplus'; if (riskFinish) riskFinish(pair); }
    pair.risk.dataKnown = Object.assign({}, pair.risk.dataKnown, { snipers: false, block0: false });   // never read on these chains
    return { kind, pool, poolVerified: kind === 'pool' ? true : undefined, pair, pools, readAt: now(), stale: false };
  }

  /* ----- the chart: GeckoTerminal's candles and trades for one pool, in the home chart's shape ----- */
  async function candles(slug, pool, tfKey, hours) {
    const C = CHAINS[slug]; if (!C || slug === 'robinhood') return null;
    const tf = GT_TF[tfKey] ? tfKey : '1h';
    const key = slug + ':' + pool + ':' + tf, hit = chartCache.get(key);
    if (hit && now() - hit.at < CHART_TTL) return hit.v;
    const [gtf, agg, tfSec] = GT_TF[tf];
    const limit = Math.max(2, Math.min(1000, Math.ceil(((Number(hours) || 168) * 3600) / tfSec)));
    const base = urls.gt + '/networks/' + C.gt + '/pools/' + encodeURIComponent(pool);
    // the pool's quote and its dollar price, from Dexscreener (one cached read): the candles are priced in the quote token
    const pr = await dsPair(slug, pool);
    const d = pr.pair;
    const quoteSym = d && d.quoteToken && d.quoteToken.symbol ? String(d.quoteToken.symbol) : C.native;
    const quoteUsd = d && num(d.priceUsd) && num(d.priceNative) > 0 ? num(d.priceUsd) / num(d.priceNative) : null;
    const [oh, tr] = await Promise.all([
      jgetR(base + '/ohlcv/' + gtf + '?aggregate=' + agg + '&limit=' + limit + '&currency=token&token=base'),
      jgetR(base + '/trades?trade_volume_in_usd_greater_than=0'),
    ]);
    if (!oh.ok) {
      const last = chartCache.get(key);
      if (last) return Object.assign({}, last.v, { stale: true, ageMs: now() - last.at });
      return { error: 'the chart source (GeckoTerminal) could not be read just now', retry: oh.reason === 'rate-limited' || oh.reason === 'timed out' || oh.reason === 'unreachable' };
    }
    const list = oh.data && oh.data.data && oh.data.data.attributes && Array.isArray(oh.data.data.attributes.ohlcv_list) ? oh.data.data.attributes.ohlcv_list : [];
    const cs = list.map((r) => ({ t: Number(r[0]), o: num(r[1]), h: num(r[2]), l: num(r[3]), c: num(r[4]), v: num(r[5]), n: null }))
      .filter((c) => Number.isFinite(c.t) && c.o != null && c.c != null).sort((a, b) => a.t - b.t);
    const baseAddr = d && d.baseToken && d.baseToken.address ? String(d.baseToken.address) : null;
    const trades = (tr.ok && tr.data && Array.isArray(tr.data.data) ? tr.data.data : []).map((x) => {
      const a = x && x.attributes; if (!a) return null;
      const buy = a.kind === 'buy';
      const ts = Date.parse(a.block_timestamp);
      return Number.isFinite(ts) ? {
        ts, isBuy: buy, tok: num(buy ? a.to_token_amount : a.from_token_amount), quote: num(buy ? a.from_token_amount : a.to_token_amount),
        usd: num(a.volume_in_usd), wallet: a.tx_from_address || null, hash: a.tx_hash || null, firstBuy: false, viaContract: false,
      } : null;
    }).filter(Boolean).sort((a, b) => b.ts - a.ts);
    const supply = null;   // today's supply comes with the profile, not the chart; the client has it from there
    const v = {
      // the width actually served: a 1s ask is answered with minute candles, and says so (tfSec is the truth either way)
      pair: pool, token: baseAddr, tf: tfKey === '1s' ? '1m' : tf, tfSec, chain: slug,
      quote: quoteSym, quoteUsd, ethUsd: null, supply, supplyAsOf: null,
      candles: cs, swaps: null,
      source: 'GeckoTerminal (candles and trades for this pool), drawn here',
      trades, traders: {},
      explorer: C.explorer, explorerPaths: C.paths,
      tapeFrom: trades.length ? trades[trades.length - 1].ts : null, tapeTo: trades.length ? trades[0].ts : null, tapeAt: now(),
      tapeViaContract: 0, exactTimes: true,
      sources: { dexscreener: !!d, geckoterminal: true },
      note: cs.length ? (tfKey === '1s' ? 'The chart source has no one-second candles for this chain, so these are one-minute candles.' : null) : 'No candles for this pool in the window — the pool exists; nobody traded it.',
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

module.exports = { createMultichain, CHAINS, SCAN_CHAINS, parseAddress, publicMeta, isSolanaAddr, b58decode, abiString, TF_SEC, GT_TF };
