'use strict';
/* ===== Robinhood Chain RWAs: what counts as one, on what evidence, and its figures (owner, 2026-10-28) ===================
   Owner's request: "Add in a whole RWA section that just looks at Robinhood RWAs … Show all the top RWAs and show all the tokens
   that are connected to those RWAs and filter them by TVL and Liquidity and Market Cap. Add in as much detail as possible to
   determine what is an RWA vs not an RWA … so our Users can best do their own research or DYOR".

   This module is the pure half: no request, no database, no clock of its own. lib/marketdata.js reads the sources (its 'rwa'
   job) and keeps what they answered; everything here turns those answers into the rows the page and the Send API serve.

   WHAT COUNTS AS AN RWA HERE — decided on evidence, never on a name (measured 2026-10-28; scratchpad research, landscape §3):
     · A1, Robinhood's registry: the address is a deployment on chain 4663 in GET api.robinhood.com/rhj/assets. Robinhood says
       a token with the same ticker at another address is not one of its Stock Tokens.
     · A2, the chain's own fingerprint: the token's ERC-1967 beacon slot holds Robinhood's AccessControlsRegistry, so its code is
       the registry's (a BeaconProxy cannot run anyone else's). It also finds RHJ tokens no longer in the registry's list (WEEK).
       A1 and A2 → 'confirmed'; A1 with the slot not read yet → 'issuer-listed'; A2 alone → 'confirmed', its status saying so.
     · A3, other issuers this site lists by address, each confirmed only once its own beacon (or, for Midas's ERC-1967 proxy,
       a live implementation slot) has been read on the chain; until then 'not-confirmed' with why.
     · Tier B (CoinGecko's id, a Chainlink feed named for the ticker) is shown as supporting evidence and never qualifies a token.
     · Tier D (a name or a symbol) never qualifies: a token in our reads with an RWA's ticker that is not Tier A is a LOOKALIKE —
       listed on that RWA's detail as "same ticker, not issued by …", never in the RWA list.
   Fiat-backed stablecoins and tokens merely paired with an RWA are listed apart and never counted (DefiLlama's and rwa.xyz's
   defaults keep stablecoins out of RWA totals).

   THE FIGURES follow lib/marketdata.js's contract exactly ({ v, src, at, why?, label? }; unknown = null with a reason in words,
   never 0): fig() and none() below are copies of that module's (it requires this one, so it cannot be required back), and
   tests/marketdata.mjs holds the two to the same answers. A yes/no reading (halted, paused) is a fact: { v: true | false | null,
   src, at, why? } — a call the contract reverted is "no such function", never false. ======================================== */

const { id: keccakId, AbiCoder, keccak256 } = require('ethers');
const ABI = AbiCoder.defaultAbiCoder();

/* ----- the figure contract (copied from lib/marketdata.js; tests/marketdata.mjs compares them) ----- */
const num = (x) => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string' || x.trim() === '') return null;
  const v = Number(x); return Number.isFinite(v) ? v : null;
};
function fig(v, src, at, extra) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
  const o = { v: n, src: src || 'site', at: at || null };
  if (extra) Object.assign(o, extra);
  if (n == null && !o.why) o.why = 'not read';
  if (n != null) delete o.why;
  return o;
}
const none = (why, src, at, extra) => Object.assign({ v: null, src: src || 'site', at: at || null, why }, extra || {});
// a yes/no reading: true or false as read, or null with why (never false for "could not read" or "no such function")
const fact = (v, src, at, extra) => { const o = Object.assign({ v: typeof v === 'boolean' ? v : null, src: src || 'site', at: at || null }, extra || {}); if (o.v == null && !o.why) o.why = 'not read'; if (o.v != null) delete o.why; return o; };
const lc = (s) => String(s || '').toLowerCase();
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const EVM_RE = /^0x[0-9a-f]{40}$/i;
const short = (a) => (typeof a === 'string' && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : String(a || ''));   // 0x + 4 … 4, as the site's shortAddr (4 … 2 is a vanity address's to match)
const utc = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'a time not recorded');
const nullLast = (dir, get) => (a, b) => {
  const x = get(a), y = get(b);
  if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
  return dir === 'asc' ? x - y : y - x;
};
const ymd = (o) => (o && Number.isInteger(o.year) && Number.isInteger(o.month) && Number.isInteger(o.day) ? o.year + '-' + String(o.month).padStart(2, '0') + '-' + String(o.day).padStart(2, '0') : null);

/* ===== The contracts and the calls (every selector and topic computed here with ethers' id(), never typed from memory;
   tests/marketdata.mjs checks each against the verified ABIs Sourcify served for the registry and Stock.sol) ===== */
const CHAIN_ID = 4663;
const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';
const SLOT = {
  beacon: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',   // ERC-1967 beacon slot: keccak('eip1967.proxy.beacon') - 1
  impl: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',     // ERC-1967 implementation slot: keccak('eip1967.proxy.implementation') - 1
};
const sel = (sig) => keccakId(sig).slice(0, 10);
// a contract's runtime code, as its keccak (null for an address with no code): what the A2 code check compares
const codeHash = (hex) => (typeof hex === 'string' && /^0x(?:[0-9a-f]{2})+$/i.test(hex) ? keccak256(hex) : null);
const SELECTORS = {
  totalSupply: sel('totalSupply()'), decimals: sel('decimals()'), name: sel('name()'), symbol: sel('symbol()'),
  // Stock.sol (the RHJ implementation, 0xb354…5ae2)
  tokenPaused: sel('tokenPaused()'), oraclePaused: sel('oraclePaused()'), uiMultiplier: sel('uiMultiplier()'), newUIMultiplier: sel('newUIMultiplier()'), effectiveAt: sel('effectiveAt()'), terms: sel('terms()'),
  // the AccessControlsRegistry (Robinhood's beacon, 0xe10b…1b00), and any UpgradeableBeacon
  paused: sel('paused()'), implementation: sel('implementation()'),
  // a Chainlink feed proxy
  latestRoundData: sel('latestRoundData()'), description: sel('description()'),
  aggregate3: sel('aggregate3((address,bool,bytes)[])'),
};
const TOPICS = {
  RoleGranted: keccakId('RoleGranted(bytes32,address,address)'), RoleRevoked: keccakId('RoleRevoked(bytes32,address,address)'),
  Blocked: keccakId('Blocked(address)'), Unblocked: keccakId('Unblocked(address)'), Upgraded: keccakId('Upgraded(address)'),
  Paused: keccakId('Paused()'), Unpaused: keccakId('Unpaused()'),
};
/* The registry's roles, named by the keccak of each candidate name (DEFAULT_ADMIN_ROLE is 0x00…); a hash none of these makes is
   "an unnamed role" (one holder had such a role on 2026-10-28: id 0xb4e5de73…). */
const ROLE_CANDIDATES = ['BEACON_UPGRADER_ROLE', 'MINTER_ROLE', 'BURNER_ROLE', 'ADMIN_BURNER_ROLE', 'PAUSER_ROLE', 'TOKEN_PAUSER_ROLE', 'ORACLE_PAUSER_ROLE', 'MULTIPLIER_UPDATER_ROLE', 'METADATA_UPDATER_ROLE', 'BLOCKER_ROLE', 'TOKEN_DEPLOYER_ROLE'];
const ROLE_NAMES = { ['0x' + '0'.repeat(64)]: 'DEFAULT_ADMIN_ROLE' };
for (const n of ROLE_CANDIDATES) ROLE_NAMES[keccakId(n)] = n;
const roleName = (id) => ROLE_NAMES[lc(id)] || 'an unnamed role';
// what each role lets its holder do, in the words the page shows (the role names are the contract's; the powers are its functions)
const POWERS = [
  ['BEACON_UPGRADER_ROLE', 'Replace the code of every Robinhood Stock Token at once (the beacon\'s upgradeTo)'],
  ['MINTER_ROLE', 'Mint new tokens'],
  ['BURNER_ROLE', 'Burn tokens'],
  ['ADMIN_BURNER_ROLE', 'Burn tokens from any wallet (adminBurn)'],
  ['PAUSER_ROLE', 'Pause every Stock Token at once (the registry\'s pause)'],
  ['TOKEN_PAUSER_ROLE', 'Pause one token'],
  ['ORACLE_PAUSER_ROLE', 'Pause the price-oracle flag'],
  ['BLOCKER_ROLE', 'Block wallets from moving these tokens'],
  ['MULTIPLIER_UPDATER_ROLE', 'Change the corporate-action multiplier'],
  ['METADATA_UPDATER_ROLE', 'Change a token\'s name and metadata'],
  ['TOKEN_DEPLOYER_ROLE', 'Deploy new Stock Tokens'],
  ['DEFAULT_ADMIN_ROLE', 'Grant and revoke every role above'],
];

/* ===== The issuers ===================================================================================================
   Robinhood's tokens come from its registry (A1) and the chain (A2). The others are listed here BY ADDRESS, each address one a
   source gave on 2026-10-28 (the research's samples), never guessed; each is confirmed only by its own on-chain fingerprint.
   Left out, and why: Maple's syrupUSDG (0x4085…74f7) is a yield-bearing dollar token (CoinGecko files it as a yield-bearing
   stablecoin), not a share, fund or commodity; TownSquare's townREIT — rwa.xyz lists it, but no source gave its contract address;
   ST0x lists 59 assets on rwa.xyz, of which only the seven wrapped shares below have an address in the samples (GeckoTerminal's
   search); Anchored has 113 contracts on the chain, of which only the four below had any supply. */
const ISSUERS = {
  rhj: { key: 'rhj', name: 'Robinhood Assets (Jersey) Limited (RHJ)', short: 'Robinhood Assets (Jersey)', registry: '0xe10b6f6b275de231345c20d14ab812db62151b00' },
  ondo: { key: 'ondo', name: 'Ondo Global Markets', short: 'Ondo Global Markets', beacons: ['0xc6fbc077d53d01f73e3195b2b916fd95555ba222'], global: true },
  anchored: { key: 'anchored', name: 'Anchored (aStock)', short: 'Anchored', beacons: ['0xfe296a422b74cb22bb3c507311f0663fd0d95dd8'], global: true },
  // the wrapped shares (wt*) are ERC-4626 vaults over receipt-vault tokens (t*); either beacon is ST0x's
  st0x: { key: 'st0x', name: 'ST0x (S01 Issuer GmbH)', short: 'ST0x', beacons: ['0x9fd790f65ca3af2772358c653f097f0a4c7ee7d2', '0x24e98b8f8f951b1868df88762cef589aedbc01eb'] },
  midas: { key: 'midas', name: 'Midas', short: 'Midas', proxy: 'erc1967' },
};
const ISSUER_KEYS = Object.keys(ISSUERS);
const issuerOf = (k) => (ISSUERS[k] ? { key: k, name: ISSUERS[k].name } : null);
// [address, issuer, symbol as the source gave it, name as the source gave it (null until the chain names it), CoinGecko id]
const CURATED_ROWS = [
  // Ondo Global Markets: CoinGecko's platform map (coins/list?include_platform=true), every id *-ondo-tokenized-* with a robinhood address
  ['0xe10cc5f0cd0c90322ebeb33e7757b2c9090146dc', 'ondo', 'googlon', 'Alphabet Class A (Ondo Tokenized Stock)', 'alphabet-class-a-ondo-tokenized-stock'],
  ['0x9bf86418caf2b7a939603d6c24219a77bf7f9b33', 'ondo', 'aaplon', 'Apple (Ondo Tokenized Stock)', 'apple-ondo-tokenized-stock'],
  ['0x900f8970d2fae8060d06bb29234f629c837c3383', 'ondo', 'bmnron', 'BitMine Immersion Technologies (Ondo Tokenized Stock)', 'bitmine-immersion-technologies-ondo-tokenized-stocks'],
  ['0x369c4748e98c153e9b7adebc3e71e9e2a5f60dc0', 'ondo', 'crclon', 'Circle Internet Group (Ondo Tokenized Stock)', 'circle-internet-group-ondo-tokenized-stock'],
  ['0xb094d0d3221d7f7a9f14b0f78c34cd38d7acf6f2', 'ondo', 'gmeon', 'GameStop (Ondo Tokenized Stock)', 'gamestop-ondo-tokenized-stock'],
  ['0x300fe8a40701ce81460503fb886f9ed81a3b5e14', 'ondo', 'qqqon', 'Invesco QQQ ETF (Ondo Tokenized ETF)', 'invesco-qqq-etf-ondo-tokenized-etf'],
  ['0x75113389169b154ddac67ca7efa542680d75f072', 'ondo', 'fxion', 'iShares China Large-Cap ETF (Ondo Tokenized)', 'ishares-china-large-cap-etf-ondo-tokenized'],
  ['0x7b5026cfcb4de0cf3d9a39fe2a541514b71437a2', 'ondo', 'metaon', 'Meta Platforms (Ondo Tokenized Stock)', 'meta-platforms-ondo-tokenized-stock'],
  ['0x09dedc334fc47ab543e5d70c7fd9d2b1aea175bd', 'ondo', 'mstron', 'MicroStrategy (Ondo Tokenized Stock)', 'microstrategy-ondo-tokenized-stock'],
  ['0xf1b95ae4e7700b962714702ea53784dc8492a856', 'ondo', 'nvdaon', 'NVIDIA (Ondo Tokenized Stock)', 'nvidia-ondo-tokenized-stock'],
  ['0x43cac729218c62210d71d66b7f0ec93990d8d8cc', 'ondo', 'hoodon', 'Robinhood Markets (Ondo Tokenized Stock)', 'robinhood-markets-ondo-tokenized-stock'],
  ['0x9b8294f24453379aa87c807ab82bf1d5722153fc', 'ondo', 'spcxon', 'SpaceX (Ondo Tokenized Stock)', 'spacex-ondo-tokenized-stock'],
  ['0x533c5571ae586985e1fddfaa24304284d970c62a', 'ondo', 'spyon', 'SPDR S&P 500 ETF (Ondo Tokenized ETF)', 'spdr-s-p-500-etf-ondo-tokenized-etf'],
  ['0xb197f36c25ba9b66960688882a4dc595c6b04309', 'ondo', 'tslaon', 'Tesla (Ondo Tokenized Stock)', 'tesla-ondo-tokenized-stock'],
  ['0xa8f72952653864f7457e0c307fdb415e03c2ece1', 'ondo', 'cperon', 'US Copper Index Fund (Ondo Tokenized)', 'us-copper-index-fund-ondo-tokenized'],
  // Anchored aStock: the four of its 113 contracts with any supply on 2026-10-28 (CoinGecko ids *-astock / *-anchored-tokenized-*)
  ['0x17683e492d0c8910f7c0157d04af31cb7a23ad71', 'anchored', 'aaapl', 'Apple aStock', 'apple-astock'],
  ['0xda230a7ec7aff66e62ff3e225c3d9c42093c23ae', 'anchored', 'amrna', 'Moderna Inc aStock', 'moderna-inc-astock'],
  ['0x5f3b897deea4ea0cb6aefe50bd2ae556cf6f4b63', 'anchored', 'abot', 'RoboStrategy Inc aStock', 'robostrategy-inc-astock'],
  ['0x4fc5b9f8933597d3ecf84d0611687e1dc8dd576f', 'anchored', 'abil', 'SPDR Bloomberg 1-3 Month T-Bill ETF (Anchored Tokenized ETF)', 'spdr-bloomberg-1-3-month-t-bill-etf-anchored-tokenized-etf'],
  // ST0x wrapped shares: the chain's own name() for the two the research read, GeckoTerminal's pool names for the symbols of the rest
  ['0x23a0944e82766242da76cb0f77e0b7812e5487ea', 'st0x', 'wtWMT', 'Wrapped Walmart Inc. ST0x', null],
  ['0x06096908dbc38fc54509024674e4fd1891b5f7ca', 'st0x', 'wtSNES', 'Wrapped SenesTech, Inc. ST0x', null],
  ['0xbe127eed812dc1f622227fadc8639d4138b47b2e', 'st0x', 'wtPLBY', null, null],
  ['0x81f40cbcfae7a1ad1f4474ed95a210dfa3b90b0f', 'st0x', 'wtDIS', null, null],
  ['0x685dfd386968b58d895f934485820c479c79a8bb', 'st0x', 'wtFGI', null, null],
  ['0xb7fc2b7881cceeb73d8deccf69b6acb8ac2e0826', 'st0x', 'wtDNUT', null, null],
  ['0xb80bd4d599eebbf2851d4e7f5594918b82ff1823', 'st0x', 'wtGRND', null, null],
  // Midas Fasanara Global Open: an ERC-1967 proxy (its admin read on the chain), CoinGecko id midas-fasanara-global-open
  ['0xfed493f38c1aacb4ea4e6a11f8b9287849ee0096', 'midas', 'mGLO', 'Midas Fasanara Global Open', 'midas-fasanara-global-open'],
];
const CURATED = new Map(CURATED_ROWS.map(([address, issuer, symbol, name, geckoId]) => [address, { address, issuer, symbol, name, geckoId }]));
// the chain's quote assets: a pool against one of these is a market for the RWA, not a token "connected" to it
const QUOTES = new Set(['0x5fc5360d0400a0fd4f2af552add042d716f1d168', '0x0bd7d308f8e1639fab988df18a8011f41eacad73', '0x0000000000000000000000000000000000000000']);
// fiat-backed stablecoins' addresses on Robinhood Chain, by DefiLlama's id (USDG: Robinhood's Token Contracts page)
const STABLE_ADDR = { 286: { address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', issuer: 'Paxos' } };
const CONNECTED_FLOOR = 1000;   // a pool pairing a token with an RWA is listed from this reserve (USD) up; those below are counted

/* ===== What kind of asset is underneath ===== */
const ETF_SET = new Set(['SPY', 'QQQ', 'VTI', 'SCHD', 'SPMO', 'XLK', 'SMH', 'SOXX', 'EWY', 'EWT', 'INDA']);
const BOND_SET = new Set(['SGOV', 'SHY', 'BND', 'WEEK']);
const COMMODITY_SET = new Set(['GLD', 'SLV', 'USO', 'GDX', 'CPER']);
const ETF_NAME = /\b(ETF|Trust|Fund|iShares|SPDR|Invesco|Vanguard|Schwab|Roundhill)\b/;
const BOND_NAME = /\b(T-?Bills?|Treasury|Treasuries|Bonds?)\b/i;   // "iShares 0-3 Month Treasury Bond", "SPDR Bloomberg 1-3 Month T-Bill ETF"
function kindOf(sym, name, issuer) {
  const s = String(sym || '').toUpperCase(), n = String(name || '');
  if (BOND_SET.has(s) || BOND_NAME.test(n)) return 'bond';
  if (COMMODITY_SET.has(s)) return 'commodity';
  if (ETF_SET.has(s) || ETF_NAME.test(n)) return 'etf';
  if (issuer === 'midas') return 'credit';
  return 'stock';   // every other share Robinhood's registry lists, ADRs included
}
/* The underlying of one token, so the "top RWAs" view groups one share's tokens together: Robinhood's ticker is the underlying's;
   Ondo's symbol less its "on" (TSLAon → TSLA), Anchored's less its leading "a", ST0x's less "wt"/"t"; the names less the issuer's
   suffix. */
function underlyingOf(issuer, symbol, name) {
  const s = String(symbol || ''), n = String(name || '');
  let us = s, un = n;
  if (issuer === 'rhj') un = n.replace(/\s*•\s*Robinhood Token\s*$/, '');
  else if (issuer === 'ondo') { us = s.replace(/on$/i, '').toUpperCase(); un = n.replace(/\s*\(Ondo Tokenized(?: Stock| ETF)?\)\s*$/i, ''); }
  else if (issuer === 'anchored') { us = s.replace(/^a/i, '').toUpperCase(); un = n.replace(/\s*\(Anchored Tokenized(?: Stock| ETF)?\)\s*$/i, '').replace(/\s+aStock\s*$/i, ''); }
  else if (issuer === 'st0x') { us = s.replace(/^w?t/, '').toUpperCase(); un = n.replace(/^Wrapped\s+/i, '').replace(/\s+ST0x\s*$/i, ''); }
  return { symbol: us || null, name: un || null, kind: kindOf(us, un, issuer) };
}

/* ===== The vendors' answers, read =====
   Every parser keeps only what a later step uses, as the source gave it (numbers through num(): a blank is not a 0); an answer
   without the list it should carry is a failed read (ok:false, why), never "none". Robinhood's logo URLs are never kept. */
const pickDep = (deps) => (Array.isArray(deps) ? deps : []).find((d) => d && Number(d.chainId) === CHAIN_ID && EVM_RE.test(String(d.contractAddress || ''))) || null;
const tradingOf = (t) => {
  if (!t || typeof t !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(t).slice(0, 8)) {
    if (v && typeof v === 'object') { const o = {}; for (const [k2, v2] of Object.entries(v).slice(0, 6)) if (typeof v2 === 'string' || typeof v2 === 'boolean' || v2 === null) o[clip(k2, 40)] = typeof v2 === 'string' ? clip(v2, 40) : v2; out[clip(k, 40)] = o; }
    else if (typeof v === 'string' || typeof v === 'boolean' || v === null) out[clip(k, 40)] = typeof v === 'string' ? clip(v, 40) : v;
  }
  return out;
};
function parseRhjAssets(j) {
  if (!j || !Array.isArray(j.assets)) return { ok: false, why: 'answered without an assets list' };
  const assets = [];
  for (const a of j.assets) {
    const d = a && pickDep(a.deployments); if (!d || !a.tokenSymbol) continue;
    assets.push({
      address: lc(d.contractAddress), uid: /^0x[0-9a-f]{64}$/i.test(String(a.id || '')) ? lc(a.id) : null, symbol: clip(a.tokenSymbol, 24), name: clip(a.tokenName, 120),
      multiplier: num(a.currentMultiplier), pendingMultiplier: num(a.pendingMultiplier), pendingAt: (a.pendingMultiplierEffectiveTime && Date.parse(a.pendingMultiplierEffectiveTime)) || null,
      status: clip(a.status, 40), decimals: Number.isInteger(a.tokenDecimals) ? a.tokenDecimals : null, isin: /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(String(a.isin || '')) ? a.isin : null,
      replicator: d.replicatorEnabled === true, transporter: d.transporterEnabled === true, trading: tradingOf(a.tradingCapabilities),
    });
  }
  return { ok: true, assets };
}
function parseRhjPrices(j) {
  if (!j || !Array.isArray(j.quotes)) return { ok: false, why: 'answered without a quotes list' };
  const quotes = {}; let generatedAt = null;
  for (const q of j.quotes) {
    const d = q && pickDep(q.deployments); if (!d) continue;
    const g = (q.generatedAt && Date.parse(q.generatedAt)) || null; if (g && (!generatedAt || g > generatedAt)) generatedAt = g;
    const tb = num(q.tokenBid), ta = num(q.tokenAsk), b = num(q.bid), a = num(q.ask);
    quotes[lc(d.contractAddress)] = { symbol: clip(q.tokenSymbol, 24), bid: b, ask: a, tokenBid: tb, tokenAsk: ta, mid: tb > 0 && ta > 0 ? (tb + ta) / 2 : null, rawMid: b > 0 && a > 0 ? (b + a) / 2 : null,
      halted: typeof q.isTradingHalt === 'boolean' ? q.isTradingHalt : null, at: g, mintBurnUsd: num(q.mintBurnUsdVolume), mintBurnTokens: num(q.mintBurnTokenVolume), dailyVolume: num(q.dailyTradingVolume), high: num(q.dailyHigh), low: num(q.dailyLow) };
  }
  return { ok: true, quotes, generatedAt };
}
const ACTION_WORDS = { FORWARD_SPLIT: 'forward split', REVERSE_SPLIT: 'reverse split', CASH_DIVIDEND: 'cash dividend', STOCK_DIVIDEND: 'stock dividend', SPIN_OFF: 'spin-off', CASH_MERGER: 'cash merger', STOCK_MERGER: 'stock merger',
  STOCK_AND_CASH_MERGER: 'stock and cash merger', REDEMPTION: 'redemption', NAME_CHANGE: 'name change', WORTHLESS_REMOVAL: 'worthless removal', RIGHTS_DISTRIBUTION: 'rights distribution', UNIT_SPLIT: 'unit split' };
function parseRhjActions(j) {
  if (!j || !Array.isArray(j.corpActions)) return { ok: false, why: 'answered without a corporate-actions list' };
  const actions = [];
  for (const c of j.corpActions) {
    const d = c && pickDep(c.deployments); if (!d) continue;
    const code = String(c.type || '').replace(/^CORPORATE_ACTION_TYPE_/, ''), st = String(c.status || '').replace(/^CORPORATE_ACTION_STATUS_/, '');
    const det = c.details && typeof c.details === 'object' ? Object.values(c.details)[0] : null, details = {};
    if (det && typeof det === 'object') for (const [k, v] of Object.entries(det).slice(0, 8)) details[clip(k, 40)] = /Rate$|^rate$/.test(k) ? num(v) : clip(v, 24);
    actions.push({ id: /^0x[0-9a-f]{64}$/i.test(String(c.id || '')) ? lc(c.id) : null, address: lc(d.contractAddress), symbol: clip(c.tokenSymbol, 24), type: clip(code, 40), typeWords: ACTION_WORDS[code] || lc(code).replace(/_/g, ' '),
      status: st === 'IN_PROGRESS' ? 'in progress' : st === 'COMPLETED' ? 'completed' : lc(st).replace(/_/g, ' '), date: ymd(c.processDate), details });
  }
  return { ok: true, actions };
}
function parseRhjDeviations(j) {
  if (!j || !Array.isArray(j.rows)) return { ok: false, why: 'answered without a rows list' };
  const rows = {};
  for (const r of j.rows) {
    const d = r && pickDep(r.deployments); if (!d) continue;
    const dir = r.direction === 'DEVIATION_DIRECTION_PREMIUM' ? 'premium' : r.direction === 'DEVIATION_DIRECTION_DISCOUNT' ? 'discount' : null, p = num(r.deviationPct);
    rows[lc(d.contractAddress)] = { symbol: clip(r.tokenSymbol, 24), pct: p == null || !dir ? null : dir === 'discount' ? -Math.abs(p) : Math.abs(p), direction: dir, days: Number.isInteger(r.consecutiveDays) ? r.consecutiveDays : null,
      since: ymd(r.firstObserved), nyseClose: num(r.nyseClosePrice && r.nyseClosePrice.amount), onchainPrice: num(r.onchainPrice && r.onchainPrice.amount) };
  }
  return { ok: true, asOf: ymd(j.asOf), rows };
}
/* Chainlink's public directory for the chain: the feeds named "Robinhood <TICKER> / USD" (or "-USD") and "GLD / USD", by ticker.
   A feed is a REFERENCE for the underlying's own price only when the directory says it prices the tokenised share: its
   productTypeCode is 'primaryTokenizedPrice', or it keeps US equity hours (the shared-SVR "Robinhood SGOV-USD" feeds carry no
   product code). "GLD / USD" is not one: the directory calls it a 'dex_state_price' with crypto (24/7) hours — the token's own DEX
   price — so a premium against it would compare the DEX with itself. It is kept, as supporting evidence only (ref: false). */
const FEED_NAME = /^Robinhood\s+([A-Za-z0-9.]{1,12})\s*(?:\/|-)\s*USD$/, GLD_FEED = /^GLD\s*\/\s*USD$/;
function parseChainlinkDirectory(j) {
  if (!Array.isArray(j)) return { ok: false, why: 'answered without a list of feeds' };
  const feeds = [];
  for (const f of j) {
    const name = String((f && f.name) || '').trim(), m = FEED_NAME.exec(name);
    const ticker = m ? m[1].toUpperCase() : GLD_FEED.test(name) ? 'GLD' : null;
    if (!ticker || !EVM_RE.test(String(f.proxyAddress || ''))) continue;
    const d = f.docs && typeof f.docs === 'object' ? f.docs : {};
    const ref = d.attributeType !== 'dex_state_price' && (d.productTypeCode === 'primaryTokenizedPrice' || /equities/i.test(String(d.marketHours || '')));
    feeds.push({ ticker, name: clip(name, 60), proxy: lc(f.proxyAddress), heartbeat: num(f.heartbeat), decimals: Number.isInteger(f.decimals) ? f.decimals : null, path: clip(f.path, 80),
      ref, priceKind: clip(d.attributeType, 40) || null, product: clip(d.productTypeCode, 40) || null, hours: clip(d.marketHours, 40) || null });
  }
  return { ok: true, feeds };
}
/* DefiLlama's /protocols answer (the liquidity job downloads it every 3 h): every protocol with a TVL on Robinhood Chain */
function parseLlamaProtocols(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const v = p && p.chainTvls ? num(p.chainTvls['Robinhood Chain']) : null;
    if (!(v > 0) || !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(String(p.slug || ''))) continue;
    out.push({ slug: p.slug, name: clip(p.name, 80), category: clip(p.category, 40), rhTvl: v });
  }
  return out.sort((a, b) => b.rhTvl - a.rhTvl);
}
/* The protocols whose per-token deposits are read (top 12 by Robinhood Chain TVL): their DefiLlama categories exclude the ones whose
   TVL is DEX liquidity (shown as Liquidity already: DEXs, launchpads' pools, LP lockers), an exchange's wallets (CEX), deposits made
   into another app that is read itself (curators, yield aggregators, liquidity managers — counted twice otherwise) and perpetuals
   (synthetic exposure, not the token). The RWA category is read first, whatever its size. */
const TVL_SKIP = new Set(['Dexs', 'CEX', 'Launchpad', 'Token Locker', 'Risk Curators', 'Yield Aggregator', 'Liquidity Manager', 'Derivatives']);
function tvlPicks(protocols, n = 12) {
  const ok = (protocols || []).filter((p) => !TVL_SKIP.has(p.category));
  return ok.filter((p) => p.category === 'RWA').concat(ok.filter((p) => p.category !== 'RWA')).slice(0, n);
}
function parseLlamaProtocol(j) {
  const c = j && j.chainTvls && j.chainTvls['Robinhood Chain'];
  if (!j || typeof j !== 'object' || !j.chainTvls) return { ok: false, why: 'answered without chainTvls' };
  const list = c && Array.isArray(c.tokensInUsd) ? c.tokensInUsd : [];
  const last = list.length ? list[list.length - 1] : null;
  const tokens = {};
  if (last && last.tokens && typeof last.tokens === 'object') for (const [k, v] of Object.entries(last.tokens)) { const x = num(v); if (x != null && x >= 0) tokens[String(k).toUpperCase().slice(0, 40)] = x; }
  return { ok: true, name: clip(j.name, 80), category: clip(j.category, 40), date: last && num(last.date) ? num(last.date) * 1000 : null, tokens };
}
/* DefiLlama's stablecoins (with prices): the ones circulating on Robinhood Chain, with how DefiLlama says each is backed */
function parseStablecoins(j) {
  if (!j || !Array.isArray(j.peggedAssets)) return { ok: false, why: 'answered without a peggedAssets list' };
  const rows = [];
  for (const s of j.peggedAssets) {
    const c = s && s.chainCirculating && s.chainCirculating['Robinhood Chain'];
    const v = c && c.current ? num(c.current[s.pegType] != null ? c.current[s.pegType] : c.current.peggedUSD) : null;
    if (!(v > 0)) continue;
    rows.push({ id: clip(s.id, 12), symbol: clip(s.symbol, 24), name: clip(s.name, 80), pegMechanism: clip(s.pegMechanism, 40), pegType: clip(s.pegType, 24), circulating: v, price: num(s.price), geckoId: clip(s.gecko_id, 80) });
  }
  return { ok: true, rows: rows.sort((a, b) => b.circulating - a.circulating) };
}
/* GeckoTerminal's tokens/multi answer (up to 30 tokens a call): price, FDV, market cap, its own total of reserves, 24 h volume */
const pos = (x) => { const v = num(x); return v != null && v > 0 ? v : null; };   // GeckoTerminal's 0 is a figure it did not read
function parseGtMulti(j) {
  if (!j || !Array.isArray(j.data)) return { ok: false, why: 'answered without a data list' };
  const tokens = {};
  for (const d of j.data) {
    const a = (d && d.attributes) || {}; if (!EVM_RE.test(String(a.address || ''))) continue;
    // no reserve (GeckoTerminal's 0.0) means no pool it indexes holds the token: its volume of 0.0 then is not a measured zero either
    const reserveUsd = pos(a.total_reserve_in_usd);
    tokens[lc(a.address)] = { symbol: clip(a.symbol, 40), name: clip(a.name, 120), decimals: Number.isInteger(a.decimals) ? a.decimals : null, geckoId: clip(a.coingecko_coin_id, 80), priceUsd: num(a.price_usd),
      fdv: num(a.fdv_usd), mcap: pos(a.market_cap_usd), reserveUsd, volume24h: reserveUsd == null ? null : num(a.volume_usd && a.volume_usd.h24), ...(reserveUsd == null ? { noPool: true } : {}), logo: typeof a.image_url === 'string' ? a.image_url : null };
  }
  return { ok: true, tokens };
}
/* GeckoTerminal's pools of one token (/networks/robinhood/tokens/<address>/pools?page=1): each pool's two sides, reserve and volume.
   Read without its include= list, so a side's symbol is the pool's own name ("OPTIMUS / TSLA", "TSLA / USDG 0.3%") less its fee. */
const sideId = (rel) => { const s = String((rel && rel.data && rel.data.id) || ''); return s.startsWith('robinhood_') ? lc(s.slice(10)) : null; };
function parseGtTokenPools(j) {
  if (!j || !Array.isArray(j.data)) return { ok: false, why: 'answered without a data list' };
  const inc = new Map(((j.included) || []).filter((x) => x && x.id).map((x) => [x.id, (x.attributes) || {}]));
  const pools = [];
  for (const d of j.data) {
    const a = (d && d.attributes) || {}, rel = (d && d.relationships) || {};
    const pool = lc(a.address); if (!/^0x[0-9a-f]{40,64}(?:-0x[0-9a-f]{40,64})?$/.test(pool)) continue;   // an Ekubo pool's id is two words joined by "-"
    const [bn, qn] = String(a.name || '').split(' / ');
    const b = sideId(rel.base_token), q = sideId(rel.quote_token); if (!EVM_RE.test(String(b || '')) || !EVM_RE.test(String(q || ''))) continue;
    const bi = inc.get('robinhood_' + b) || {}, qi = inc.get('robinhood_' + q) || {};
    pools.push({ pool, dex: clip(rel.dex && rel.dex.data && rel.dex.data.id, 60), name: clip(a.name, 120),
      base: { address: b, symbol: clip(bi.symbol || (bn || '').trim(), 40) || null, name: clip(bi.name, 80), logo: typeof bi.image_url === 'string' ? bi.image_url : null },
      quote: { address: q, symbol: clip(qi.symbol || String(qn || '').replace(/\s+[\d.]+%$/, '').trim(), 40) || null, name: clip(qi.name, 80), logo: typeof qi.image_url === 'string' ? qi.image_url : null },
      reserveUsd: pos(a.reserve_in_usd), volume24h: num(a.volume_usd && a.volume_usd.h24), createdAt: (a.pool_created_at && Date.parse(a.pool_created_at)) || null });
  }
  return { ok: true, pools };
}

/* ===== Reading the chain: Multicall3 batches and the registry's logs ===== */
const word = (data, i) => { const d = String(data || '').replace(/^0x/, ''); return d.length >= (i + 1) * 64 ? d.slice(i * 64, (i + 1) * 64) : null; };
const wordAddr = (w) => (w ? '0x' + w.slice(24).toLowerCase() : null);
const topicAddr = (t) => (typeof t === 'string' && t.length === 66 ? '0x' + t.slice(26).toLowerCase() : null);
function encodeAggregate3(subcalls) {
  return SELECTORS.aggregate3 + ABI.encode(['tuple(address,bool,bytes)[]'], [subcalls.map((s) => [s.target, true, s.data])]).slice(2);
}
// the answer of one aggregate3 call: [{ ok, data }] per subcall, or null when the node gave nothing a multicall answers with
function decodeAggregate3(hex) {
  if (typeof hex !== 'string' || hex.length < 130) return null;
  try { return ABI.decode(['tuple(bool,bytes)[]'], hex)[0].map((r) => ({ ok: !!r[0], data: r[1] })); } catch { return null; }
}
/* one subcall's answer, by what it returns. A failed call, or an answer too short for its type, is "no such function" (absent):
   stored as such, never as false or 0. */
function decodeAs(type, r) {
  if (!r || !r.ok) return { absent: true };
  const d = String(r.data || '0x');
  try {
    if (type === 'uint') { const w = word(d, 0); return w ? { v: BigInt('0x' + w) } : { absent: true }; }
    if (type === 'bool') { const w = word(d, 0); return w ? { v: BigInt('0x' + w) !== 0n } : { absent: true }; }
    if (type === 'address') { const w = word(d, 0); return w ? { v: wordAddr(w) } : { absent: true }; }
    if (type === 'string') { const s = ABI.decode(['string'], d)[0]; return { v: String(s).slice(0, 200) }; }
    if (type === 'round') { const x = ABI.decode(['uint80', 'int256', 'uint256', 'uint256', 'uint80'], d); return { v: { answer: x[1], updatedAt: Number(x[3]) } }; }
  } catch { return { absent: true }; }
  return { absent: true };
}
const MAX_SUBCALLS = 150;   // per eth_call (one aggregate3)
const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
/* The state reads of one run, as subcalls: every RWA token's totalSupply(); the name, symbol and decimals of a listed token the chain
   has not named yet; Robinhood's tokens' pause flags and multiplier; the registry's paused() and implementation(); the other issuers'
   beacons' implementation(); terms() once; each Chainlink feed's latestRoundData() and description(). */
function stateSubcalls(p) {
  const out = [], add = (target, data, key, type) => out.push({ target, data, key, type });
  for (const a of p.supply || []) add(a, SELECTORS.totalSupply, a + '|supply', 'uint');
  for (const a of p.meta || []) { add(a, SELECTORS.name, a + '|name', 'string'); add(a, SELECTORS.symbol, a + '|symbol', 'string'); add(a, SELECTORS.decimals, a + '|decimals', 'uint'); }
  for (const a of p.rhj || []) for (const k of ['tokenPaused', 'oraclePaused']) add(a, SELECTORS[k], a + '|' + k, 'bool');
  for (const a of p.rhj || []) for (const k of ['uiMultiplier', 'newUIMultiplier', 'effectiveAt']) add(a, SELECTORS[k], a + '|' + k, 'uint');
  add(ISSUERS.rhj.registry, SELECTORS.paused, 'registry|paused', 'bool');
  add(ISSUERS.rhj.registry, SELECTORS.implementation, 'beacon|' + ISSUERS.rhj.registry, 'address');
  for (const b of p.beacons || []) add(b, SELECTORS.implementation, 'beacon|' + b, 'address');
  if (p.termsFrom) add(p.termsFrom, SELECTORS.terms, 'registry|terms', 'string');
  for (const f of p.feeds || []) { add(f, SELECTORS.latestRoundData, f + '|round', 'round'); add(f, SELECTORS.description, f + '|description', 'string'); }
  return out;
}
/* The registry's logs, folded into who holds which role (and since which block), the wallets blocked, the code upgrades and the
   pauses — forward from the state the last walk left, in the chain's order. */
function foldRegistryLogs(prev, logs) {
  const s = prev && typeof prev === 'object' ? JSON.parse(JSON.stringify(prev)) : {};
  s.holders = s.holders || {}; s.blocked = s.blocked || []; s.upgrades = s.upgrades || []; s.pauses = s.pauses || []; s.logs = s.logs || 0;
  const blocked = new Set(s.blocked);
  const sorted = (Array.isArray(logs) ? logs : []).filter((l) => l && Array.isArray(l.topics) && lc(l.address) === ISSUERS.rhj.registry && !l.removed)
    .sort((a, b) => (parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16)) || (parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16)));
  for (const l of sorted) {
    const t0 = lc(l.topics[0]), block = parseInt(l.blockNumber, 16);
    s.logs++;
    if (t0 === TOPICS.RoleGranted || t0 === TOPICS.RoleRevoked) {
      const role = lc(l.topics[1]), who = topicAddr(l.topics[2]); if (!role || !who) continue;
      const h = s.holders[role] || (s.holders[role] = {});
      if (t0 === TOPICS.RoleGranted) { if (h[who] == null) h[who] = block; } else delete h[who];
      if (!Object.keys(h).length) delete s.holders[role];
    } else if (t0 === TOPICS.Blocked) { const w = topicAddr(l.topics[1]); if (w) blocked.add(w); }
    else if (t0 === TOPICS.Unblocked) { const w = topicAddr(l.topics[1]); if (w) blocked.delete(w); }
    else if (t0 === TOPICS.Upgraded) { const w = topicAddr(l.topics[1]); if (w) s.upgrades.push({ implementation: w, block }); }
    else if (t0 === TOPICS.Paused || t0 === TOPICS.Unpaused) s.pauses.push({ paused: t0 === TOPICS.Paused, block });
  }
  s.blocked = [...blocked].sort();
  s.upgrades = s.upgrades.slice(-20); s.pauses = s.pauses.slice(-20);
  return s;
}
// the role holders as rows: [{ role, roleId, holder, since }] — the order of POWERS, an unnamed role last
function roleRows(roles) {
  const out = [], order = POWERS.map(([r]) => r);
  for (const [id, h] of Object.entries((roles && roles.holders) || {})) for (const [holder, since] of Object.entries(h)) out.push({ role: roleName(id), roleId: id, holder, since: { block: since } });
  return out.sort((a, b) => ((order.indexOf(a.role) + 1 || 99) - (order.indexOf(b.role) + 1 || 99)) || a.holder.localeCompare(b.holder));
}
const holdersOf = (roles, name) => { for (const [id, h] of Object.entries((roles && roles.holders) || {})) if (roleName(id) === name) return Object.keys(h); return []; };

/* ===== Is it an RWA? ===================================================================================================
   f: { asset (Robinhood's registry row, or null), registryAt (when the registry was last read well; null: never), chain (this
   address's on-chain reads: beacon, beaconAt, impl, implAt, codeMatch, codeAt), curated (this site's list), geckoId, geckoSrc
   ('site' when the id is this site's list's, else GeckoTerminal's), geckoAt, feed (Chainlink's, for the ticker), chainlinkAt,
   rhjNamed (which of Robinhood's other answers — /prices, /price-deviations, /corporate-actions — name the address), rhjNamedAt }.
   The answer: { rwa, issuer, confidence, status, evidence, why, mismatch?, pending? }.
   A2 is the beacon slot AND the code: any contract can write any value into its own storage, so a slot naming Robinhood's registry
   proves nothing alone. A token the registry does not list counts only when its runtime code is also the very code the registry's
   own Stock Tokens run (an OpenZeppelin BeaconProxy whose beacon — Robinhood's registry — is an immutable inside that code; the job
   compares the code's keccak with the registry tokens' own, codeMatch). Until then it is counted nowhere. */
const GECKO_RWA = /-robinhood-tokenized-stock$|-robinhood-token$|-ondo-tokenized|-astock$|-anchored-tokenized/;
function classify(address, f) {
  const a = lc(address), ev = [], c = f.chain || {};
  const beaconRead = c.beaconAt != null, beacon = beaconRead ? lc(c.beacon) : null;
  const named = Array.isArray(f.rhjNamed) ? f.rhjNamed.filter(Boolean) : [];
  const tierB = () => {
    if (f.geckoId && GECKO_RWA.test(f.geckoId)) ev.push(f.geckoSrc === 'site'
      // the id this site's own list carries (the research read CoinGecko's platform map on 2026-10-28): said as this site's, never as a read of GeckoTerminal's
      ? { tier: 'B', kind: 'coingecko', text: 'CoinGecko files it as "' + f.geckoId + '" — from this site\'s list, taken from CoinGecko\'s platform map on 2026-10-28 (supporting evidence only — never enough on its own)', src: 'site', at: null }
      : { tier: 'B', kind: 'coingecko', text: 'CoinGecko files it as "' + f.geckoId + '" (supporting evidence only — never enough on its own)', src: 'geckoterminal', at: f.geckoAt || null });
    if (f.feed) ev.push({ tier: 'B', kind: 'chainlink', text: f.feed.ref === false ? 'Chainlink publishes a "' + f.feed.name + '" feed for this ticker, priced from the token\'s own DEX trading (supporting evidence only)' : 'Chainlink publishes a "' + f.feed.name + '" price feed for this ticker (supporting evidence only)', src: 'chainlink', at: f.chainlinkAt || null });
    if (named.length && !f.asset) ev.push({ tier: 'B', kind: 'robinhood-api', text: 'Robinhood\'s own ' + named.join(' and ') + ' answer names this address (supporting evidence only — the registry\'s list and the chain are what count)', src: 'robinhood', at: f.rhjNamedAt || null });
  };
  const rhj = issuerOf('rhj');
  // Robinhood: the registry's word (A1), the chain's (A2)
  const slot = beaconRead && beacon === ISSUERS.rhj.registry;
  if (f.asset) {
    ev.push({ tier: 'A1', kind: 'registry', text: 'Listed in Robinhood\'s Stock Token registry (api.robinhood.com/rhj/assets)', src: 'robinhood', at: f.registryAt || null });
    if (slot) ev.push({ tier: 'A2', kind: 'fingerprint', text: 'Its code runs from Robinhood\'s token registry contract (checked on the chain)', src: 'rpc', at: c.beaconAt });
    tierB();
    const st = { code: f.asset.status || null, text: f.asset.status === 'ASSET_STATUS_ACTIVE' ? 'Active in Robinhood\'s registry' : f.asset.status === 'ASSET_STATUS_INACTIVE' ? 'Inactive in Robinhood\'s registry' : 'Listed in Robinhood\'s registry (status ' + (f.asset.status || 'not given') + ')' };
    if (slot) return { rwa: true, issuer: rhj, confidence: 'confirmed', status: st, evidence: ev };
    if (!beaconRead) return { rwa: true, issuer: rhj, confidence: 'issuer-listed', status: st, evidence: ev, why: 'fingerprint not read yet' };
    return { rwa: true, issuer: rhj, confidence: 'issuer-listed', status: st, evidence: ev, mismatch: true,
      why: 'Robinhood\'s registry lists it, but its beacon slot reads ' + (beacon || 'nothing') + ' — not Robinhood\'s registry (checked on the chain)' };
  }
  if (slot) {
    // not in the registry's list: its beacon slot names the registry — and its code must be the registry tokens' own before it counts
    const st = { code: null, text: f.registryAt ? 'On the chain, not in the registry\'s active list' : 'On the chain; Robinhood\'s registry has not been read yet' };
    if (c.codeMatch === true) {
      ev.push({ tier: 'A2', kind: 'fingerprint', text: 'Its code runs from Robinhood\'s token registry contract (checked on the chain: its beacon slot names the registry, and its code is the very proxy code the registry\'s own Stock Tokens run)', src: 'rpc', at: Math.max(c.beaconAt, c.codeAt || 0) });
      tierB();
      return { rwa: true, issuer: rhj, confidence: 'confirmed', status: st, evidence: ev };
    }
    ev.push({ tier: 'B', kind: 'beacon-slot', text: 'Its beacon slot names Robinhood\'s registry (checked on the chain) — any contract can write that slot, so it counts only once its code is also the code Robinhood\'s own Stock Tokens run', src: 'rpc', at: c.beaconAt });
    tierB();
    if (c.codeMatch === false) return { rwa: false, issuer: null, confidence: null, status: null, evidence: ev,
      why: 'Its beacon slot names Robinhood\'s registry, but its code is not the code Robinhood\'s Stock Tokens run (checked on the chain) — any contract can write that slot, so it is not an RWA here' };
    // Robinhood's own answers name it (WEEK, out of the registry's active list): shown, not confirmed, counted nowhere, until its code is compared
    if (named.length) return { rwa: true, issuer: rhj, confidence: 'not-confirmed', status: st, evidence: ev, why: 'its code has not been compared with Robinhood\'s Stock Tokens\' yet' };
    return { rwa: false, issuer: null, confidence: null, status: null, evidence: ev, pending: true,
      why: 'Not confirmed as an RWA yet: its beacon slot names Robinhood\'s registry, but its code has not been compared with Robinhood\'s Stock Tokens\' yet — any contract can write that slot, so it is not counted until its code matches' };
  }
  // another issuer on this site's list, confirmed by its own fingerprint
  const cur = f.curated || CURATED.get(a);
  if (cur) {
    const is = ISSUERS[cur.issuer];
    const listed = 'On this site\'s list of ' + is.name + ' tokens (by address, from ' + (cur.geckoId ? 'CoinGecko\'s platform map' : 'GeckoTerminal and the chain') + ')';
    if (is.proxy === 'erc1967') {
      const implRead = c.implAt != null, live = implRead && EVM_RE.test(String(c.impl || '')) && !/^0x0{40}$/.test(c.impl);
      if (live) { ev.push({ tier: 'A3', kind: 'curated', text: listed + ', and it is a live ERC-1967 proxy (its implementation slot reads ' + c.impl + ', checked on the chain)', src: 'rpc', at: c.implAt }); tierB(); return { rwa: true, issuer: issuerOf(cur.issuer), confidence: 'confirmed', status: { code: null, text: 'On this site\'s list; confirmed on the chain' }, evidence: ev }; }
      ev.push({ tier: 'A3', kind: 'curated', text: listed, src: 'site', at: null }); tierB();
      if (!implRead) return { rwa: true, issuer: issuerOf(cur.issuer), confidence: 'not-confirmed', status: { code: null, text: 'On this site\'s list; not confirmed on the chain yet' }, evidence: ev, why: 'fingerprint not read yet' };
      return { rwa: false, issuer: issuerOf(cur.issuer), confidence: 'not-confirmed', status: { code: null, text: 'Its implementation slot is empty' }, evidence: ev, why: listed + ', but its implementation slot is empty (checked on the chain) — not counted' };
    }
    const match = beaconRead && is.beacons.includes(beacon);
    if (match) { ev.push({ tier: 'A3', kind: 'curated', text: listed + ', and its code runs from ' + is.short + '\'s beacon ' + beacon + ' (checked on the chain)', src: 'rpc', at: c.beaconAt }); tierB(); return { rwa: true, issuer: issuerOf(cur.issuer), confidence: 'confirmed', status: { code: null, text: 'On this site\'s list; confirmed on the chain' }, evidence: ev }; }
    ev.push({ tier: 'A3', kind: 'curated', text: listed, src: 'site', at: null }); tierB();
    if (!beaconRead) return { rwa: true, issuer: issuerOf(cur.issuer), confidence: 'not-confirmed', status: { code: null, text: 'On this site\'s list; not confirmed on the chain yet' }, evidence: ev, why: 'fingerprint not read yet' };
    return { rwa: false, issuer: issuerOf(cur.issuer), confidence: 'not-confirmed', status: { code: null, text: 'Its beacon is not ' + is.short + '\'s' }, evidence: ev,
      why: listed + ', but its beacon slot reads ' + (beacon || 'nothing') + ' — not ' + is.short + '\'s beacon (checked on the chain) — not counted' };
  }
  tierB();
  // Robinhood's own answers name it, but the registry does not list it: never "not an RWA" before the chain has been asked
  if (named.length) {
    if (!beaconRead) return { rwa: false, issuer: null, confidence: null, status: null, evidence: ev, pending: true,
      why: 'Not confirmed as an RWA yet: Robinhood\'s own ' + named.join(' and ') + ' answer names it, but it is not in the registry\'s active list and its code has not been checked on the chain yet — it may still be one of Robinhood\'s Stock Tokens' };
    return { rwa: false, issuer: null, confidence: null, status: null, evidence: ev,
      why: 'Robinhood\'s own ' + named.join(' and ') + ' answer names it, but it is not in the registry, and its beacon slot reads ' + (beacon || 'nothing') + ' — not Robinhood\'s registry (checked on the chain)' };
  }
  return { rwa: false, issuer: null, confidence: null, status: null, evidence: ev, why: null };
}

/* ===== A token's figures, and the rows ================================================================================
   input: { now, batch: { at, rows } (the newest finished GeckoTerminal batch, mkt_pool_snap rows), assets, prices, actions,
   deviations, chainlink (each as the job keeps it: { readAt, data, failAt?, failWhy? }), chain (rwa_chain), tvl (rwa_tvl), gt
   (rwa_gt), logo (a raw logo URL → what the answer may carry, or null) }. The answer: { rows (one per RWA token, with its
   figures; _pools and _globalMc are for the sums and are dropped before serving), cls (every candidate's classification, by
   address), rwaSet, feeds (by ticker), assets, quotes, devs, protosRead, tvlUnread, symClash }.

   ONE BASIS for liquidity and volume (review, 2026-10-28): every token's is GeckoTerminal's own per-token figure from its token
   read (tokens/multi, which the job reads for every RWA token in rotation) — never a sum of whole pool reserves for some tokens and
   GeckoTerminal's figure for the rest, which ranked the deepest RWAs below shallower ones. GeckoTerminal's per-token total is its
   own measure (TSLA's came to $1.21M while the whole reserves of its first 20 pools summed to $2.67M), so the labels say whose it is.
   The newest pool batch still says which pools pair two RWAs (pairsRwa), and takes a shared pool's volume off a total once. */
const TVL_KEEP = 2 * 24 * 3600e3;    // an app's last good deposits are kept this long while its reads fail, then dropped (with why)
const TVL_STALE = 12 * 3600e3;       // two of the 6-hour rounds: a figure resting on an older read says so
const RHJ_LIST_RANK = (r) => (r.issuer.key === 'rhj' && (r.evidence || []).some((e) => e.tier === 'A1') ? 4 : r.issuer.key === 'rhj' && r.confidence === 'confirmed' ? 3 : r.confidence === 'confirmed' ? 2 : r.confidence === 'issuer-listed' ? 1 : 0);
// a logo file named after the token's own address is Robinhood's artwork (CoinGecko re-hosts Robinhood's logo for its Stock Tokens under that name)
const ownLogo = (u, a) => typeof u === 'string' && EVM_RE.test(String(a || '')) && new RegExp('/(?:0x)?' + a.slice(2) + '\\.(?:png|jpe?g|webp|svg|gif)(?:\\?|$)', 'i').test(u);
function buildRows(input) {
  const now = input.now, B = input.batch || { at: null, rows: [] }, logo = input.logo || (() => null);
  const st = (o) => (o && o.data) || null;
  const assetsD = st(input.assets), pricesD = st(input.prices), devD = st(input.deviations), linkD = st(input.chainlink), tvlS = input.tvl || null, gtS = input.gt || null;
  const chain = input.chain || {}, chainTok = chain.tokens || {};
  const assets = new Map(((assetsD && assetsD.assets) || []).map((x) => [x.address, x]));
  const registryAt = assetsD ? input.assets.readAt : null;
  const quotes = (pricesD && pricesD.quotes) || {}, devs = (devD && devD.rows) || {};
  const actions = ((st(input.actions) || {}).actions || []), actionsOf = new Set(actions.map((x) => x.address));
  // a ticker's feed: one that prices the share (a reference) over one that does not, whichever the directory lists first
  const feeds = new Map();
  for (const f of (linkD && linkD.feeds) || []) { const prev = feeds.get(f.ticker); if (!prev || (prev.ref === false && f.ref !== false)) feeds.set(f.ticker, f); }
  const gtTok = (gtS && gtS.tokens) || {};
  // batch rows by token (either side) and the CoinGecko ids GeckoTerminal gave
  const poolsOf = new Map(), baseOf = new Map(), geckoOf = new Map();
  for (const r of B.rows || []) {
    for (const side of [r.base_addr, r.quote_addr]) { if (!side) continue; if (!poolsOf.has(side)) poolsOf.set(side, []); poolsOf.get(side).push(r); }
    if (r.base_addr) { if (!baseOf.has(r.base_addr)) baseOf.set(r.base_addr, []); baseOf.get(r.base_addr).push(r); if (r.base_gecko_id && !geckoOf.has(r.base_addr)) geckoOf.set(r.base_addr, r.base_gecko_id); }
  }
  /* the candidates: the registry's tokens, this site's list, Robinhood's other answers (prices, deviations, corporate actions), and every
     address the chain has fingerprinted (the job reads the slot of a batch token whose CoinGecko id or name hints at an issuer — a hint
     picks what to check, never what qualifies) */
  const cand = new Set([...assets.keys(), ...CURATED.keys(), ...Object.keys(quotes), ...Object.keys(devs), ...Object.keys(chainTok).filter((a) => chainTok[a] && chainTok[a].beaconAt != null)]);
  for (const x of actions) cand.add(x.address);
  const cls = new Map();
  for (const a of cand) {
    const asset = assets.get(a) || null, cur = CURATED.get(a) || null, ct = chainTok[a] || {}, gtA = gtTok[a] && !gtTok[a].absent ? gtTok[a] : null;
    const sym0 = asset ? asset.symbol : (ct.symbol || (gtA && gtA.symbol) || (cur && cur.symbol) || (quotes[a] && quotes[a].symbol) || (devs[a] && devs[a].symbol) || null);
    const named = [quotes[a] ? '/prices' : null, devs[a] ? '/price-deviations' : null, actionsOf.has(a) ? '/corporate-actions' : null].filter(Boolean);
    const namedAt = [quotes[a] && input.prices ? input.prices.readAt : null, devs[a] && input.deviations ? input.deviations.readAt : null, actionsOf.has(a) && input.actions ? input.actions.readAt : null].filter(Number.isFinite);
    // the CoinGecko id: GeckoTerminal's (the batch, then its token read) — this site's own list only when neither gave one, and said so
    const gid = geckoOf.get(a) || (gtA && gtA.geckoId) || null;
    const k = classify(a, { asset, registryAt, chain: ct, curated: cur, geckoId: gid || (cur && cur.geckoId) || null, geckoSrc: gid ? 'geckoterminal' : 'site', geckoAt: geckoOf.get(a) ? B.at : gtA && gtA.geckoId ? gtA.at : null,
      feed: (asset || (ct.beaconAt != null && lc(ct.beacon) === ISSUERS.rhj.registry)) && sym0 ? feeds.get(String(sym0).toUpperCase()) || null : null, chainlinkAt: input.chainlink ? input.chainlink.readAt : null,
      rhjNamed: named, rhjNamedAt: namedAt.length ? Math.max(...namedAt) : null });
    cls.set(a, Object.assign(k, { symbol: sym0 }));
  }
  const rwaSet = new Set([...cls].filter(([, k]) => k.rwa).map(([a]) => a));
  /* TVL in DeFi: DefiLlama's per-token deposits are keyed by symbol, so each symbol goes to ONE RWA token — the token in Robinhood's
     registry first, then another of Robinhood's confirmed on the chain, then any other issuer's; two tokens tied at the top share the
     symbol and get neither (and say so). A token whose code is not confirmed never takes a symbol from one that is. */
  const symTo = new Map(), symClash = new Set();
  for (const a of rwaSet) {
    const k = cls.get(a), s = String(k.symbol || '').toUpperCase(); if (!s) continue;
    const rank = RHJ_LIST_RANK(k), prev = symTo.get(s);
    if (!prev || rank > prev.rank) { symTo.set(s, { a, rank }); symClash.delete(s); }
    else if (rank === prev.rank) symClash.add(s);
  }
  /* the apps whose deposits are summed: each one read well within TVL_KEEP. One the job could not read (never, or not for longer than
     that) is named on every figure it may be missing from — a token with no deposits in the apps that were read is "not in the N
     apps read; not read: …", never "lists no deposits", and a sum is marked as possibly low */
  const tvlReads = (tvlS && tvlS.reads) || {}, picks = tvlS && Array.isArray(tvlS.picks) ? tvlS.picks : Object.keys(tvlReads);
  const tvlBy = new Map(), protosRead = [], tvlUnread = [];
  for (const slug of picks) {
    const r = tvlReads[slug], name = (r && r.name) || slug;
    if (!r || !r.ok || !Number.isFinite(r.at) || now - r.at > TVL_KEEP) {
      tvlUnread.push({ slug, name, why: !r ? 'not read yet' : r.ok && Number.isFinite(r.at) ? 'its last good read, from ' + utc(r.at) + ', is more than 2 days old' : (r.failWhy || 'not read') + (r.droppedAt ? '; its deposits from ' + utc(r.lastAt) + ' were dropped after 2 days' : '') });
      continue;
    }
    protosRead.push(slug);
    const kept = Number.isFinite(r.failAt) && r.failAt >= r.at;
    for (const [s, usd] of Object.entries(r.tokens || {})) {
      const t = symClash.has(s) ? null : symTo.get(s); if (!t) continue;
      if (!tvlBy.has(t.a)) tvlBy.set(t.a, []);
      tvlBy.get(t.a).push({ slug, name, category: r.category || null, usd, at: r.at, ...(kept ? { kept: true, failAt: r.failAt, failWhy: r.failWhy || 'not read' } : {}) });
    }
  }
  const readAts = protosRead.map((s) => tvlReads[s].at), tvlAt = readAts.length ? Math.min(...readAts) : (tvlS && tvlS.readAt) || null;
  // an app read before but not since (its deposits kept): a "none" resting on it says so, with its time
  const keptApps = protosRead.filter((slug) => Number.isFinite(tvlReads[slug].failAt) && tvlReads[slug].failAt >= tvlReads[slug].at);
  const keptW = keptApps.length ? ' — ' + keptApps.slice(0, 3).map((slug) => tvlReads[slug].name + ' as read at ' + utc(tvlReads[slug].at) + ' (not read since: ' + (tvlReads[slug].failWhy || 'no answer') + ')').join(', ') : '';
  const unreadW = tvlUnread.length ? tvlUnread.slice(0, 3).map((x) => x.name + ' (' + x.why + ')').join(', ') + (tvlUnread.length > 3 ? ', and ' + (tvlUnread.length - 3) + ' more' : '') : '';
  const registryPaused = chain.registry || {};
  const rows = [];
  for (const a of rwaSet) {
    const k = cls.get(a), asset = assets.get(a) || null, cur = CURATED.get(a) || null, ct = chainTok[a] || {}, isRhj = k.issuer.key === 'rhj';
    const gRaw = gtTok[a] || null, gAbs = !!(gRaw && gRaw.absent), g = gRaw && !gAbs ? gRaw : null;
    const symbol = asset ? asset.symbol : ct.symbol || (g && g.symbol) || (cur && cur.symbol) || k.symbol || null;
    const name = asset ? asset.name : ct.name || (g && g.name) || (cur && cur.name) || null;
    const und = underlyingOf(k.issuer.key, symbol, name);
    const bp = (baseOf.get(a) || []).slice().sort((x, y) => (y.reserve_usd || 0) - (x.reserve_usd || 0)), top = bp[0] || null;
    const held = poolsOf.get(a) || [];
    // why GeckoTerminal's token read gave nothing for it: not run yet, or run without an entry for it
    const gtWhy = gAbs ? 'GeckoTerminal\'s token read (' + utc(gRaw.at) + ') has no entry for it' : 'GeckoTerminal\'s token read of it has not run yet';
    const gtAt = gAbs ? gRaw.at : null;
    // price: its deepest pool among the most-traded we keep (read every 10 minutes), else GeckoTerminal's token read
    const priceUsd = top ? fig(top.price_usd, 'geckoterminal', B.at, { label: 'price in its deepest pool here (GeckoTerminal)' })
      : g ? fig(g.priceUsd, 'geckoterminal', g.at, { label: 'GeckoTerminal\'s token price (not among the most-traded pools we keep)', why: 'GeckoTerminal gave no price for it' + (g.noPool ? ' — it indexes no pool with a reserve for it' : '') })
      : none(B.at || gRaw ? 'not among the most-traded pools we keep, and ' + gtWhy : 'the chain\'s pools have not been read yet', 'geckoterminal', gtAt || B.at);
    // supply, from the chain
    const dec = asset && asset.decimals != null ? asset.decimals : ct.decimals != null ? ct.decimals : null;
    const supply = ct.supplyRaw != null && dec != null ? fig(Number(BigInt(ct.supplyRaw)) / Math.pow(10, dec), 'rpc', ct.supplyAt, { label: 'totalSupply() read on the chain', decimals: dec })
      : none(ct.supplyRaw == null ? (ct.supplyAbsent ? 'the chain answered no totalSupply() for it' : 'its supply has not been read on the chain yet') : 'its decimals have not been read yet', 'rpc', ct.supplyAt || null);
    const value = supply.v != null && priceUsd.v != null ? fig(supply.v * priceUsd.v, 'site', Math.min(supply.at || now, priceUsd.at || now), { label: 'on-chain supply × the DEX price' })
      : none(supply.v == null && priceUsd.v == null ? 'neither its on-chain supply nor a DEX price has been read' : supply.v == null ? 'its on-chain supply has not been read' : 'no DEX price has been read for it', 'site', null, { label: 'on-chain supply × the DEX price' });
    /* market cap: GeckoTerminal's (CoinGecko's figure). Only a multi-chain issuer's (Ondo, Anchored: ISSUERS[].global) is every
       chain's; Robinhood's Stock Tokens live on chain 4663 alone (its registry lists one deployment for each), so a market cap above
       their FDV is said for what it is — CoinGecko counts their supply differently from the chain — and ranked like any other */
    const mc = top ? top.mcap_usd : g ? g.mcap : null, fdv = top ? top.fdv_usd : g ? g.fdv : null, mcAt = top ? B.at : g ? g.at : gtAt;
    const globalMc = mc != null && !!ISSUERS[k.issuer.key].global;
    const aboveFdv = mc != null && !globalMc && fdv != null && fdv > 0 && mc > fdv * 1.01;
    const mcap = mc == null ? none(top || g ? 'GeckoTerminal has no market cap for it' : gtWhy, 'geckoterminal', mcAt)
      : fig(mc, 'geckoterminal', mcAt, globalMc ? { global: true, label: 'CoinGecko\'s figure, every chain — not this chain\'s; never mixed with the value on chain' }
        : aboveFdv ? { aboveFdv: true, label: 'market cap (GeckoTerminal) — above its FDV here: CoinGecko counts its supply differently from the chain' } : { label: 'market cap (GeckoTerminal)' });
    // liquidity and volume: GeckoTerminal's own figures for the token (its token read) — one basis for every token
    const pairsRwa = held.some((p) => { const o = p.base_addr === a ? p.quote_addr : p.base_addr; return o && o !== a && rwaSet.has(o); });
    const liquidity = g ? fig(g.reserveUsd, 'geckoterminal', g.at, Object.assign({ label: 'GeckoTerminal\'s total for it across its pools on the chain (its token read)', why: 'GeckoTerminal indexes no pool with a reserve for it' }, pairsRwa ? { pairsRwa: true } : {}))
      : none(gtWhy, 'geckoterminal', gtAt, pairsRwa ? { pairsRwa: true } : {});
    const volume24h = g ? fig(g.volume24h, 'geckoterminal', g.at, { label: 'DEX volume, 24 h — GeckoTerminal\'s total for it across its pools (its token read)', why: g.noPool ? 'GeckoTerminal indexes no pool with a reserve for it' : 'GeckoTerminal gave no 24 h volume for it' })
      : none(gtWhy, 'geckoterminal', gtAt);
    // TVL in DeFi (DefiLlama, matched by symbol)
    const tvlLabel = 'deposited in DeFi apps on Robinhood Chain (DefiLlama, matched by symbol)';
    const tp = (tvlBy.get(a) || []).slice().sort((x, y) => y.usd - x.usd);
    const sClash = symClash.has(String(symbol || '').toUpperCase());
    const missing = tvlUnread.length ? { missingApps: tvlUnread.map((x) => x.slug) } : {};
    let tvl;
    if (!protosRead.length) tvl = none(tvlS && (tvlS.readAt || tvlS.failAt) ? 'none of DefiLlama\'s per-app deposits could be read' + (unreadW ? ' — ' + unreadW : '') : 'DefiLlama\'s per-app deposits have not been read yet', 'defillama', tvlAt, Object.assign({ label: tvlLabel }, missing));
    else if (sClash) tvl = none('two RWA tokens share its symbol, so DefiLlama\'s deposits (keyed by symbol) are attributed to neither', 'defillama', tvlAt, { label: tvlLabel });
    else if (tp.length) {
      const oldest = Math.min(...tp.map((x) => x.at)), stale = now - oldest > TVL_STALE;
      tvl = fig(sum(tp.map((x) => x.usd)), 'defillama', oldest, Object.assign({
        label: tvlLabel + (tvlUnread.length ? ' — not read: ' + unreadW + ', so it may be low' : '') + (stale ? ' — resting on a read from ' + utc(oldest) + ', more than 12 h old' : ''),
        protocols: tp.map((x) => Object.assign({ name: x.name, slug: x.slug, category: x.category, usd: x.usd, at: x.at }, x.kept ? { kept: true, keptWhy: 'DefiLlama could not be read for it since ' + utc(x.failAt) + ' (' + x.failWhy + '): its last good deposits, from ' + utc(x.at) + ', are shown' } : {})),
      }, missing, stale ? { stale: true } : {}));
    } else if (tvlUnread.length) tvl = none('not in the ' + protosRead.length + ' app' + (protosRead.length === 1 ? '' : 's') + ' DefiLlama answered for; not read: ' + unreadW, 'defillama', tvlAt, Object.assign({ label: tvlLabel, protocols: [] }, missing));
    else tvl = none('DefiLlama lists no DeFi deposits of it on Robinhood Chain' + keptW, 'defillama', tvlAt, Object.assign({ label: tvlLabel, protocols: [] }, keptApps.length && now - tvlAt > TVL_STALE ? { stale: true } : {}));
    // the halts and pauses (read before the price check: a paused oracle means "do not trust the price")
    const q = quotes[a] || null;
    const halted = !isRhj ? fact(null, 'robinhood', null, { why: 'Robinhood reports halts for its own Stock Tokens only' }) : q ? fact(q.halted, 'robinhood', q.at || input.prices.readAt, { why: 'Robinhood\'s quote did not say' }) : fact(null, 'robinhood', null, { why: pricesD ? 'Robinhood\'s /prices answer has no quote for it' : 'Robinhood\'s quotes have not been read yet' });
    const pf = (v, absent, at, label) => (absent ? fact(null, 'rpc', at, { why: 'no such function on this contract (the call reverted) — not the same as "not paused"', absent: true, label }) : fact(v, 'rpc', at, { why: 'not read on the chain yet', label }));
    const paused = isRhj ? {
      global: pf(registryPaused.paused, registryPaused.pausedAbsent, registryPaused.at || null, 'paused() on Robinhood\'s registry: every Stock Token at once'),
      token: pf(ct.tokenPaused, ct.tokenPausedAbsent, ct.stateAt || null, 'tokenPaused(): this token alone'),
      oracle: pf(ct.oraclePaused, ct.oraclePausedAbsent, ct.stateAt || null, 'oraclePaused(): Robinhood\'s advisory price-oracle flag'),
    } : { global: fact(null, 'rpc', null, { why: 'Robinhood\'s pause functions — not read for this issuer\'s tokens' }), token: fact(null, 'rpc', null, { why: 'Robinhood\'s pause functions — not read for this issuer\'s tokens' }), oracle: fact(null, 'rpc', null, { why: 'Robinhood\'s pause functions — not read for this issuer\'s tokens' }) };
    const oraclePaused = paused.oracle.v === true;
    // the underlying's own price: Chainlink's feed read on the chain (one that prices the share), Robinhood's quote
    const feed = isRhj && symbol ? feeds.get(String(symbol).toUpperCase()) || null : null, fr = feed && feed.ref !== false ? (chain.feeds || {})[feed.proxy] || null : null;
    let chainlink;
    if (!isRhj) chainlink = none('Chainlink\'s Robinhood feeds price Robinhood\'s Stock Tokens; no reference is read for this issuer\'s tokens', 'chainlink', null);
    else if (!feed) chainlink = none(input.chainlink && input.chainlink.data ? 'Chainlink\'s public directory lists no feed for this ticker (it lists ' + feeds.size + ')' : 'Chainlink\'s directory has not been read yet', 'chainlink', input.chainlink ? input.chainlink.readAt : null);
    else if (feed.ref === false) chainlink = none('Chainlink\'s "' + feed.name + '" feed is priced from the token\'s own DEX trading (a ' + (feed.priceKind || 'DEX-state price').replace(/_/g, ' ') + ', per Chainlink\'s directory), not from the share — so it is not used as the underlying\'s price', 'chainlink', input.chainlink ? input.chainlink.readAt : null, { proxy: feed.proxy, notReference: true });
    else if (!fr || fr.answer == null) chainlink = none(fr && fr.absent ? 'the feed answered no latestRoundData()' : 'the feed has not been read on the chain yet', 'chainlink', fr ? fr.at : null, { proxy: feed.proxy });
    else {
      const dd = feed.decimals != null ? feed.decimals : 8, upd = fr.updatedAt ? fr.updatedAt * 1000 : null, ans = Number(BigInt(fr.answer)) / Math.pow(10, dd);
      // Chainlink's own rule: a zero or negative answer is rejected, never shown as a price
      chainlink = !(ans > 0) ? none('the feed answered ' + ans + ', which is not a price (Chainlink: reject zero or negative answers)', 'chainlink', upd || fr.at, { proxy: feed.proxy })
        : fig(ans, 'chainlink', upd || fr.at, Object.assign({ label: 'Chainlink ' + (fr.description || feed.name) + (oraclePaused ? ' — its oracle is paused for a corporate action: Robinhood says not to trust this price until it is unpaused' : ''), proxy: feed.proxy, heartbeat: feed.heartbeat, stale: !!(upd && feed.heartbeat && now - upd > feed.heartbeat * 1000) }, oraclePaused ? { oraclePaused: true } : {}));
    }
    const robinhood = !isRhj ? none('Robinhood quotes its own Stock Tokens only', 'robinhood', null)
      : !pricesD ? none('Robinhood\'s quotes have not been read yet', 'robinhood', null)
      : !q ? none('Robinhood\'s /prices answer has no quote for it', 'robinhood', input.prices.readAt)
      : fig(q.mid, 'robinhood', q.at || input.prices.readAt, { label: 'Robinhood\'s quote, multiplier applied — an undocumented field (tokenBid / tokenAsk mid)', why: 'Robinhood\'s quote carries no token bid and ask' });
    /* premium or discount: the DEX price against Chainlink first (unless it is stale), else Robinhood's quote. While Robinhood's price
       oracle for the token is paused for a corporate action its price is "temporarily unavailable" (Robinhood's oracles page: a paused
       oracle may still return a value — treat true as do not trust the price), so no premium is worked out then */
    const freshC = chainlink.v != null && !chainlink.stale, ref = freshC ? chainlink : robinhood.v != null ? robinhood : chainlink.v != null ? chainlink : null;
    const premium = !isRhj ? none('no reference price is read for this issuer\'s tokens', 'site', null)
      : oraclePaused ? none('Robinhood\'s price oracle for it is paused for a corporate action (oraclePaused() on the chain): Robinhood says to treat its price as temporarily unavailable, so no premium is worked out', 'site', paused.oracle.at || null)
      : priceUsd.v == null ? none('no DEX price has been read for it', 'site', null)
      : !ref ? none('no reference price has been read for its underlying', 'site', null)
      : fig((priceUsd.v / ref.v - 1) * 100, 'site', Math.min(priceUsd.at || now, ref.at || now), { label: 'DEX price against ' + (ref === robinhood ? 'Robinhood\'s quote' : ref.label) + (ref.stale ? ' (stale: older than its heartbeat)' : ''), ref: ref === robinhood ? 'robinhood' : 'chainlink' });
    const dv = devs[a] || null;
    const deviation = dv ? { pct: dv.pct, direction: dv.direction, days: dv.days, since: dv.since, asOf: devD.asOf || null, src: 'robinhood', at: input.deviations.readAt } : null;
    // the multiplier (RHJ's word; the chain's when it differs)
    const ui = ct.uiMultiplier != null ? Number(BigInt(ct.uiMultiplier)) / 1e18 : null, nu = ct.newUIMultiplier != null ? Number(BigInt(ct.newUIMultiplier)) / 1e18 : null;
    const pending = isRhj && nu != null && ui != null && nu !== ui ? { v: nu, effectiveAt: ct.effectiveAt ? Number(ct.effectiveAt) * 1000 : null, src: 'rpc', at: ct.stateAt } : null;
    const multiplier = !isRhj ? none('only Robinhood\'s Stock Tokens carry this multiplier (ERC-8056 uiMultiplier)', 'site', null)
      : asset ? fig(asset.multiplier, 'robinhood', registryAt, { label: 'shares of the underlying one token carries (RHJ currentMultiplier)', onchain: ui, pending })
      : fig(ui, 'rpc', ct.stateAt, { label: 'shares of the underlying one token carries (uiMultiplier() on the chain)', pending, why: 'its multiplier has not been read on the chain yet' });
    const mintBurnUsd = !isRhj ? none('Robinhood publishes primary-market figures for its own Stock Tokens only', 'robinhood', null)
      : q ? fig(q.mintBurnUsd, 'robinhood', q.at || input.prices.readAt, { label: 'primary-market mint and burn, USD — Robinhood does not document its window', why: 'Robinhood\'s quote carries no mint and burn figure' })
      : none(pricesD ? 'Robinhood\'s /prices answer has no quote for it' : 'Robinhood\'s quotes have not been read yet', 'robinhood', pricesD ? input.prices.readAt : null);
    const flags = [];
    if (premium.v != null && Math.abs(premium.v) >= 5) flags.push('premium');
    if (halted.v === true) flags.push('halted');
    if (paused.global.v === true || paused.token.v === true) flags.push('paused');
    if (oraclePaused) flags.push('oracle-paused');
    if (deviation) flags.push('deviation');
    if (pairsRwa) flags.push('pairs-rwa');
    if (globalMc) flags.push('global-mcap');
    if (chainlink.stale) flags.push('stale-reference');
    if (k.confidence === 'not-confirmed') flags.push('not-confirmed');
    if (k.mismatch) flags.push('fingerprint-mismatch');
    /* no Robinhood artwork: a Robinhood Stock Token's picture is Robinhood's mark (CoinGecko and GeckoTerminal serve Robinhood's own
       logo for them), so its row draws the letter instead; any picture named after the token's own address is left out too */
    const rawLogo = isRhj ? null : (top && top.base_logo) || (g && g.logo) || null;
    rows.push({
      address: a, symbol, name, logo: rawLogo && !ownLogo(rawLogo, a) ? logo(rawLogo) : null, issuer: k.issuer, underlying: und, confidence: k.confidence, evidence: k.evidence, status: k.status, ...(k.why ? { why: k.why } : {}),
      priceUsd, supply, value, mcap, liquidity, tvl, volume24h, reference: { chainlink, robinhood }, premium, deviation, multiplier, halted, paused, mintBurnUsd, flags,
      _pools: held.map((p) => ({ pool: p.pool, reserve: p.reserve_usd > 0 ? p.reserve_usd : null, vol: p.vol_h24, other: p.base_addr === a ? p.quote_addr : p.base_addr })), _globalMc: globalMc,
    });
  }
  return { rows, cls, rwaSet, feeds, assets, quotes, devs, protosRead, tvlUnread, symClash };
}
/* A sum of figures over rows: the rows with no figure are left out and counted (never added as 0); its time is the oldest figure's. */
function sumFig(rows, key, label, src, at) {
  const vs = rows.map((r) => r[key]).filter((f) => f && f.v != null);
  const missing = rows.length - vs.length;
  if (!vs.length) return none(rows.length === 1 ? (rows[0][key] && rows[0][key].why) || 'not read' : rows.length ? 'none of its ' + rows.length + ' tokens has this figure' : 'no tokens', src || 'site', at || null, { label });
  const ats = vs.map((f) => f.at).filter(Number.isFinite);
  return fig(sum(vs.map((f) => f.v)), src || 'site', at || (ats.length ? Math.min(...ats) : null), Object.assign({ label: label + (missing ? ' — ' + missing + ' without one ' + (missing === 1 ? 'is' : 'are') + ' left out' : '') }, missing ? { missing } : {}));
}
/* Liquidity and volume over several tokens: GeckoTerminal's per-token figures added up (one basis). A pool pairing two of these tokens
   (QQQ / SPY) is in both tokens' volume, so its 24 h volume — as the newest pool batch read it — is taken off the total once; the
   liquidity figure is GeckoTerminal's per-token total (it comes to less than the pools' whole reserves), and the label says how many
   pools pair two of them. */
function tokSumFig(rows, which, label) {
  const key = which === 'liquidity' ? 'liquidity' : 'volume24h';
  const base = sumFig(rows, key, label, 'geckoterminal');
  if (base.v == null) return base;
  const inSet = new Set(rows.filter((r) => r[key] && r[key].v != null).map((r) => r.address)), shared = new Map();
  for (const r of rows) if (inSet.has(r.address)) for (const p of r._pools || []) if (p.other && p.other !== r.address && inSet.has(p.other)) shared.set(p.pool, p);
  if (!shared.size) return base;
  if (which === 'liquidity') return Object.assign(base, { label: base.label + ' — ' + shared.size + ' pool' + (shared.size === 1 ? ' pairs' : 's pair') + ' two of these tokens', pairPools: shared.size });
  const vols = [...shared.values()].map((p) => p.vol).filter((v) => v != null && v >= 0), off = sum(vols);
  if (!vols.length || off > base.v) return Object.assign(base, { label: base.label + ' — ' + shared.size + ' pool' + (shared.size === 1 ? ' pairs' : 's pair') + ' two of these tokens, and its volume may be in both tokens\' figures', pairPools: shared.size });
  return Object.assign(fig(base.v - off, 'geckoterminal', base.at, { label: base.label + ' — less the 24 h volume of the ' + vols.length + ' pool' + (vols.length === 1 ? '' : 's') + ' pairing two of these tokens, which is in both tokens\' figures' }), base.missing ? { missing: base.missing } : {}, { pairPools: shared.size });
}
/* The "top RWAs" view: the tokens of one underlying together. A token joins Robinhood's group of the same ticker; otherwise it is its
   own group. The group's main token (the row a press opens, its premium and chip) is the strongest evidence first: a token in
   Robinhood's registry, then another of Robinhood's confirmed on the chain, then any confirmed token, then by value — so a token the
   registry does not list can never become a group's main token while one it lists is there. A token not confirmed on the chain is
   listed in the group but left out of its sums, as it is out of the totals. */
function groupRows(rows, at) {
  const rhjTickers = new Set(rows.filter((r) => r.issuer.key === 'rhj' && r.underlying.symbol).map((r) => r.underlying.symbol.toUpperCase()));
  const by = new Map();
  for (const r of rows) {
    const t = String(r.underlying.symbol || r.symbol || r.address).toUpperCase();
    const key = rhjTickers.has(t) ? t : r.issuer.key + ':' + t;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  const out = [];
  for (const [key, ts] of by) {
    ts.sort((x, y) => (RHJ_LIST_RANK(y) - RHJ_LIST_RANK(x)) || ((y.value.v || 0) - (x.value.v || 0)));
    const main = ts[0], sumd = ts.filter((r) => r.confidence !== 'not-confirmed'), nc = ts.length - sumd.length;
    const of = ' over its ' + sumd.length + ' token' + (sumd.length === 1 ? '' : 's') + (nc ? ' (' + nc + ' not confirmed on the chain yet ' + (nc === 1 ? 'is' : 'are') + ' left out)' : '');
    const anyGlobal = sumd.some((r) => r._globalMc);
    const flags = [...new Set(ts.flatMap((r) => r.flags))];
    const nonePending = (lbl, src) => none('its token' + (ts.length === 1 ? ' is' : 's are') + ' not confirmed on the chain yet, so ' + (ts.length === 1 ? 'its figures are' : 'their figures are') + ' not counted', src, null, { label: lbl });
    const S = (fn) => (sumd.length ? fn() : null);
    out.push({
      key, underlying: Object.assign({}, main.underlying), issuers: [...new Map(ts.map((r) => [r.issuer.key, r.issuer])).values()],
      tokens: ts.map((r) => ({ address: r.address, symbol: r.symbol, name: r.name, issuer: r.issuer, confidence: r.confidence })),
      main: main.address, logo: main.logo,
      value: S(() => sumFig(sumd, 'value', 'value on chain' + of + ' (on-chain supply × the DEX price)', 'site')) || nonePending('value on chain (on-chain supply × the DEX price)', 'site'),
      liquidity: S(() => tokSumFig(sumd, 'liquidity', 'GeckoTerminal\'s liquidity figures' + of + ', added up')) || nonePending('GeckoTerminal\'s liquidity figures', 'geckoterminal'),
      mcap: Object.assign(S(() => sumFig(sumd, 'mcap', 'market cap' + of + ' (GeckoTerminal)' + (anyGlobal ? ' — includes CoinGecko\'s every-chain figure for a multi-chain issuer\'s token' : ''), 'geckoterminal')) || nonePending('market cap (GeckoTerminal)', 'geckoterminal'), anyGlobal ? { global: true } : {}),
      tvl: S(() => sumFig(sumd, 'tvl', 'deposited in DeFi apps on Robinhood Chain' + of + ' (DefiLlama, matched by symbol)', 'defillama')) || nonePending('deposited in DeFi apps on Robinhood Chain (DefiLlama, matched by symbol)', 'defillama'),
      volume24h: S(() => tokSumFig(sumd, 'volume', 'GeckoTerminal\'s 24 h volume figures' + of + ', added up')) || nonePending('GeckoTerminal\'s 24 h volume figures', 'geckoterminal'),
      premium: main.premium, flags,
    });
  }
  return out;
}
/* Tokens connected to an RWA: a pool pairing a token with an RWA where the other side is not USDG, WETH or another RWA (a memecoin
   paired with TSLA). Not RWAs, and labelled so; listed from CONNECTED_FLOOR of reserve up, the rest counted (a reserve GeckoTerminal
   did not read is counted apart, never as under the floor). One pool once, the newest read of it. */
function connectedRows(pools, rwaSet, symOf, floor = CONNECTED_FLOOR) {
  const by = new Map();
  for (const p of pools || []) { const k = p.pool, prev = by.get(k); if (!prev || (p.at || 0) > (prev.at || 0)) by.set(k, p); }
  const rows = []; let below = 0, unread = 0;
  for (const p of by.values()) {
    const bR = rwaSet.has(p.base.address), qR = rwaSet.has(p.quote.address);
    if (bR === qR) continue;   // neither side an RWA, or both (a market between two RWAs)
    const rwa = bR ? p.base : p.quote, other = bR ? p.quote : p.base;
    if (QUOTES.has(other.address)) continue;
    if (p.reserveUsd == null) { unread++; continue; }
    if (p.reserveUsd < floor) { below++; continue; }
    const rs = symOf(rwa.address) || rwa.symbol;
    rows.push({ address: other.address, symbol: other.symbol || null, name: other.name || null, logoRaw: other.logo || null, rwa: { address: rwa.address, symbol: rs },
      pool: p.pool, dex: p.dex || null, reserveUsd: fig(p.reserveUsd, 'geckoterminal', p.at, { label: 'the pool\'s whole reserve, both sides (GeckoTerminal)' }),
      volume24h: fig(p.volume24h, 'geckoterminal', p.at, { label: 'the pool\'s DEX volume, 24 h (GeckoTerminal)', why: 'GeckoTerminal gave no 24 h volume for this pool' }),
      label: 'Not an RWA — paired with $' + (rs || short(rwa.address)), src: p.src || 'geckoterminal' });
  }
  return { rows: rows.sort((x, y) => y.reserveUsd.v - x.reserveUsd.v), below, unread, floor };
}
/* Lookalikes: a token our reads met (the pool batch, the connected pools, the radar's new pairs, what people scanned) with an RWA's
   ticker, or an RWA's underlying name, that is not itself an RWA — "same ticker, not issued by <issuer>". */
function lookalikesOf(rows, candidates, rwaSet) {
  const byTicker = new Map(), byName = new Map();
  for (const r of rows) {
    for (const t of [r.symbol, r.underlying.symbol]) { const k = lc(t); if (k) { if (!byTicker.has(k)) byTicker.set(k, []); byTicker.get(k).push(r); } }
    for (const n of [r.name, r.underlying.name]) { const k = lc(n).trim(); if (k.length >= 3) { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(r); } }
  }
  const out = new Map(), seen = new Set();
  for (const c of candidates || []) {
    const a = lc(c.address); if (!EVM_RE.test(a) || rwaSet.has(a) || QUOTES.has(a)) continue;
    const hit = new Set([...(byTicker.get(lc(c.symbol)) || []), ...(byName.get(lc(c.name).trim()) || [])]);
    for (const r of hit) {
      const k = r.address + '|' + a; if (seen.has(k)) continue; seen.add(k);
      if (!out.has(r.address)) out.set(r.address, []);
      out.get(r.address).push({ address: a, symbol: clip(c.symbol, 40), name: clip(c.name, 80), src: c.src || null });
    }
  }
  return out;
}
/* The RWA token that shares a lookalike's ticker, the strongest evidence first: a token in Robinhood's registry, then another of
   Robinhood's confirmed on the chain, then any confirmed token, then one still being confirmed. */
function twinOf(address, symbol, rows) {
  const a = lc(address), s = lc(symbol); if (!s) return null;
  const same = (rows || []).filter((r) => lc(r.symbol) === s && r.address !== a);
  return same.sort((x, y) => RHJ_LIST_RANK(y) - RHJ_LIST_RANK(x))[0] || null;
}
/* "Not an RWA here": what evidence is missing, in words. A lookalike is told where the real one is — worded by that token's own
   evidence: "the registry lists" only for a token in Robinhood's registry; a token of Robinhood's found by the chain alone is said as
   such; a token not confirmed on the chain yet is never asserted to be its issuer's (the answer carries its full address as twin). */
function notRwaWhy(address, k, ctx) {
  const a = lc(address);
  if (ctx.stable) return ctx.stable.symbol + ' is a fiat-backed stablecoin — listed apart, not counted as an RWA here (DefiLlama and rwa.xyz count stablecoins apart)';
  if (k && k.why) return k.why;
  const twin = twinOf(a, ctx.symbol, ctx.rows);
  if (twin) {
    const w = '$' + twin.symbol, at = short(twin.address), a1 = (twin.evidence || []).some((e) => e.tier === 'A1');
    if (twin.issuer.key === 'rhj' && a1) return 'Same ticker as ' + w + ', but not issued by Robinhood Assets (Jersey) — the registry lists ' + w + ' at ' + at;
    if (twin.issuer.key === 'rhj' && twin.confidence === 'confirmed') return 'Same ticker as ' + w + ', but not issued by Robinhood Assets (Jersey) — Robinhood\'s ' + w + ' at ' + at + ' runs from its registry (it is not in the registry\'s active list)';
    if (twin.confidence === 'confirmed') return 'Same ticker as ' + w + ', but not issued by ' + twin.issuer.name + ' — its token is at ' + at;
    return 'Same ticker as ' + w + ', which this site lists at ' + at + ' among ' + twin.issuer.name + '\'s tokens, not confirmed on the chain yet — this token is not on that list';
  }
  // a token Robinhood's own answers name, or one whose slot names the registry, is said by classify (k.why) — never "not an RWA" before the chain is asked
  const reg = ctx.registryRead ? 'it is not in Robinhood\'s Stock Token registry' : 'Robinhood\'s Stock Token registry has not been read yet';
  const fp = ctx.beaconRead ? ', its code does not run from an issuer\'s registry or beacon (checked on the chain)' : '';
  return 'Not an RWA here: ' + reg + fp + ', and it is not on this site\'s list of other issuers\' tokens. A name or a symbol is never enough.';
}

/* ===== What a holder holds, per issuer (curated; every sentence carries the page it comes from) ===== */
const RHJ_DOCS = 'https://docs.robinhood.com/rhj';
const ISSUER_TEXT = {
  rhj: [
    { text: 'Stock Tokens are tokenised debt securities issued by Robinhood Assets (Jersey) Limited. They give economic exposure to the underlying share or ETF but no legal or beneficial rights in it, or against its issuer — no voting rights, no shareholder status.', href: RHJ_DOCS + '/product/' },
    { text: 'Robinhood\'s FAQ says every Stock Token in circulation is backed 1:1 by the underlying, held by its US-based custody partner.', href: RHJ_DOCS + '/faq/' },
    // the custodian's name is on a page of its own: the sentence links the page it comes from
    { text: 'Robinhood\'s service-providers page names Alpaca Securities LLC as the broker and custodian.', href: RHJ_DOCS + '/service-providers/' },
    { text: 'Holders can sell on the secondary market, or redeem directly with the issuer where no authorised participant does it for them, after completing the issuer\'s KYC/AML checks.', href: RHJ_DOCS + '/faq/' },
    { text: 'Robinhood\'s product page lists no fee to subscribe, none to redeem in the first 90 days from issuance, and 0.05% to redeem after that.', href: RHJ_DOCS + '/product/' },
    { text: 'Not offered to US persons, and restricted in other places, including Canada, the United Kingdom and Switzerland; Robinhood lists the prohibited jurisdictions.', href: RHJ_DOCS + '/restricted-jurisdictions/' },
    { text: 'Dividends are not paid out: they raise the token\'s multiplier, so one token comes to stand for more than one share.', href: RHJ_DOCS + '/faq/' },
    { text: 'Robinhood publishes the Base Prospectus and Final Terms; the Liechtenstein Financial Market Authority approved the Base Prospectus, which Robinhood notes is not an endorsement.', href: RHJ_DOCS },
    { text: 'Robinhood lists its Stock Tokens at docs.robinhood.com/chain/contracts — a token with the same ticker at another address is not one.', href: 'https://docs.robinhood.com/chain/contracts/' },
  ],
  ondo: [{ text: 'Issued by Ondo Global Markets. As read on the chain by this site\'s research (2026-10-28): a beacon proxy whose code has a compliance() check, minting and burning by role, and a token pause. The issuer\'s terms are not read by this site.', href: null }],
  anchored: [{ text: 'Issued by Anchored (aStock). As read on the chain by this site\'s research (2026-10-28): a beacon proxy whose code has a compliance and block check and transfer and redemption pauses. The issuer\'s terms are not read by this site.', href: null }],
  st0x: [{ text: 'Issued by ST0x (S01 Issuer GmbH, per rwa.xyz). As read on the chain by this site\'s research (2026-10-28): a wrapped share (an ERC-4626 vault) over a receipt-vault token whose code includes confiscation and freeze powers. The issuer\'s terms are not read by this site.', href: null }],
  midas: [{ text: 'Midas Fasanara Global Open (mGLO): rwa.xyz names its issuer as Aureum Securitisation Fund and its manager as Fasanara. As read on the chain by this site\'s research (2026-10-28): an ERC-1967 proxy with blacklist, pause and governed burn powers. The issuer\'s terms are not read by this site.', href: null }],
};
function issuerProfile(row, extra) {
  const k = row.issuer.key, cur = CURATED.get(row.address);
  const out = { issuer: row.issuer, sentences: (ISSUER_TEXT[k] || []).map((s) => Object.assign({}, s)) };
  if (k === 'rhj') out.terms = extra && typeof extra.terms === 'string' && /^https:\/\/[^\s"'<>]{1,200}$/.test(extra.terms) ? { v: extra.terms, src: 'rpc', at: extra.termsAt || null, label: 'terms() read on the chain' } : { v: null, src: 'rpc', at: null, why: 'terms() has not been read on the chain yet' };
  if (cur && cur.geckoId) out.coingecko = 'https://www.coingecko.com/en/coins/' + cur.geckoId;
  return out;
}

module.exports = {
  CHAIN_ID, MULTICALL3, SLOT, SELECTORS, TOPICS, ROLE_NAMES, ROLE_CANDIDATES, POWERS, ISSUERS, ISSUER_KEYS, CURATED, QUOTES, STABLE_ADDR, CONNECTED_FLOOR, TVL_SKIP, GECKO_RWA, MAX_SUBCALLS,
  num, fig, none, fact, nullLast, short, chunk, codeHash, roleName, holdersOf, kindOf, underlyingOf, issuerOf,
  parseRhjAssets, parseRhjPrices, parseRhjActions, parseRhjDeviations, parseChainlinkDirectory, parseLlamaProtocols, parseLlamaProtocol, tvlPicks, parseStablecoins, parseGtMulti, parseGtTokenPools,
  encodeAggregate3, decodeAggregate3, decodeAs, stateSubcalls, foldRegistryLogs, roleRows,
  classify, buildRows, sumFig, tokSumFig, groupRows, TVL_KEEP, TVL_STALE, connectedRows, lookalikesOf, notRwaWhy, twinOf, issuerProfile, ISSUER_TEXT, utc,
};
