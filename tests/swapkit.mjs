/* ===== Swap in my wallet — the swap button on every token's on-chain detail (owner, 2026-10-23) =======================
   "Enable one click swaps like you have for the Send token on the landing page as simple button on every token on-chain
   details that takes the contract address and sets up a swap in their wallet to purchase that token they are looking at."

   1. The encodings, exactly: lib/swapkit.js builds Uniswap v2 getAmountsOut / swapExactETHForTokensSupportingFeeOnTransferTokens,
      QuoterV2 quoteExactInputSingle and SwapRouter02 multicall(deadline, [exactInputSingle]) calldata — every selector and word is
      pinned against hand-assembled bytes (the three swap encodings were simulated on Ethereum mainnet by eth_call on 2026-10-23
      and executed). Amount parsing, the impact arithmetic, the router allow-list.
   2. The shape of it, in the source: the server's routes and wiring, the client's panel, the dashboard's button, the seven pages
      that load it, the legal pages, the sound rules the landing page's swap already keeps.
   3. A server of its own with EVERY upstream faked — the home chain's node (getAmountsOut for $SEND), an Ethereum node (QuoterV2,
      the pool's fee, decimals, getAmountsOut for a v2 token), Dexscreener's token-pairs (the PEPE and BONK fixtures), a Solana node
      (BONK's mint, a signature's status), Jupiter (quote + swap): a quote and a build on each chain, the refusals, the rate limits,
      and the raw Jupiter answer never leaving the server. Everything lives in a temporary directory, deleted. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { ROOT, SERVER_JS } from './_paths.mjs';
const SK = createRequire(import.meta.url)(path.join(ROOT, 'lib', 'swapkit.js'));

const SRC = fs.readFileSync(SERVER_JS, 'utf8');
const LIB = fs.readFileSync(path.join(ROOT, 'lib', 'swapkit.js'), 'utf8');
const PUB = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const FIX = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'multichain', f), 'utf8'));
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PEPE = '0x6982508145454ce325ddbe47a25d4ec3d2311933', WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', PEPE_V3 = '0x11950d141ecb863f01007add7d1a342041227b58';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', SOLM = 'So11111111111111111111111111111111111111112';
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', RH_ROUTER = '0x89e5db8b5aa49aa85ac63f691524311aeb649eba', RH_WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const ME = '0x00000000219ab540356cbb839cbe05303d7705fa', ME_SOL = 'H5g7jkKkFVm2mvSPjaY6a6RkcPEiMR6dC7ekm3uZCGuw';
const w = (v) => BigInt(v).toString(16).padStart(64, '0');
const aw = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

/* ═══ 1. the encodings ═══ */
{
  check('an amount of the native coin parses to its raw integer, and only a plain positive number does', SK.parseAmount('0.05', 18) === 50000000000000000n && SK.parseAmount('1', 9) === 1000000000n && SK.parseAmount('.5', 18) === 500000000000000000n
    && SK.parseAmount('0', 18) === null && SK.parseAmount('abc', 18) === null && SK.parseAmount('1e3', 18) === null && SK.parseAmount('-1', 18) === null && SK.parseAmount('', 18) === null && SK.parseAmount('0.0000000000000000001', 18) === null /* 19 decimals */);
  check('getAmountsOut(amountIn, path): selector d06ca61f, the array at offset 0x40, its length, the addresses', SK.encGetAmountsOut(10n ** 17n, [WETH, PEPE]) === '0xd06ca61f' + w(10n ** 17n) + w(0x40) + w(2) + aw(WETH) + aw(PEPE));
  check('swapExactETHForTokensSupportingFeeOnTransferTokens(minOut, path, to, deadline): selector b6f9de95, the path at 0x80, the receiver, the deadline — the landing page\'s encoding',
    SK.encSwapV2(7n, [WETH, PEPE], ME, 1800000000n) === '0xb6f9de95' + w(7) + w(0x80) + aw(ME) + w(1800000000) + w(2) + aw(WETH) + aw(PEPE));
  check('QuoterV2 quoteExactInputSingle((tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96)): selector c6a5026a, the struct inline, the fee as a NUMBER (3000, not hex digits 0x3000), the limit zero',
    SK.encQuoteV3(WETH, PEPE, 10n ** 17n, 3000) === '0xc6a5026a' + aw(WETH) + aw(PEPE) + w(10n ** 17n) + w(3000) + w(0));
  const v3 = SK.encSwapV3(WETH, PEPE, 3000, ME, 10n ** 17n, 1n, 1800000000n);
  const inner = '04e45aaf' + aw(WETH) + aw(PEPE) + w(3000) + aw(ME) + w(10n ** 17n) + w(1) + w(0);
  check('SwapRouter02 multicall(deadline, [exactInputSingle(…)]): selector 5ae401dc, the deadline, one bytes element of 0xe4 bytes (4 + 7 × 32) padded to a word, exactInputSingle\'s 7-field struct without a deadline (04e45aaf) — simulated on mainnet 2026-10-23',
    v3 === '0x5ae401dc' + w(1800000000) + w(0x40) + w(1) + w(0x20) + w(inner.length / 2) + inner + '0'.repeat((64 - (inner.length % 64)) % 64) && inner.length / 2 === 0xe4 && (v3.length - 10) % 64 === 0 /* whole words after the selector */, v3.length);
  check('price impact is the shortfall against a sliver\'s marginal rate, in %; unknowable without the reference', Math.abs(SK.impactFrom(90n * 10n ** 18n, 10n ** 18n, 10n ** 16n, 10n ** 14n) - 10) < 1e-9 && SK.impactFrom(10n ** 18n, 10n ** 18n, 10n ** 14n, 10n ** 14n) === 0 && SK.impactFrom(1n, 1n, 0n, 1n) === null);
  check('the routers a transaction may ever be sent to: the home chain\'s v2 router (the landing page\'s), Uniswap v2 / SwapRouter02 / SushiSwap on Ethereum — and the client holds the same list',
    SK.ALLOWED_TO.robinhood.join() === RH_ROUTER && SK.ALLOWED_TO.ethereum.join() === '0x7a250d5630b4cf539739df2c5dacb4c659f2488d,0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45,0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f'
    && /robinhood: \['0x89e5db8b5aa49aa85ac63f691524311aeb649eba'\]/.test(PUB('swapkit.js')) && /ethereum: \['0x7a250d5630b4cf539739df2c5dacb4c659f2488d', '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f'\]/.test(PUB('swapkit.js'))
    && SK.ROUTERS.robinhood.v2 === '0x89e5db8b5aa49aa85ac63f691524311aeb649eba' && /const SWAP_ROUTER = '0x89e5db8b5aa49aa85ac63f691524311aeb649eba';/.test(SRC) && SK.ROUTERS.solana.jupiter === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
  check('slippage defaults to the landing page\'s 10% and is clamped to [0.1, 49] (never past half); the deadline is 20 minutes', SK.SLIPPAGE_DEFAULT === 10 && /SLIPPAGE_MIN = 0\.1, SLIPPAGE_MAX = 49/.test(LIB) && /const DEADLINE_S = 20 \* 60;/.test(LIB) && /const SLIP = 10;/.test(PUB('swapkit.js')));
}

/* ═══ 2. the shape of it ═══ */
{
  const CL = PUB('swapkit.js'), NP = PUB('newpairs.js'), WL = PUB('wallet.js'), CSS = PUB('styles.css'), TERMS = PUB('terms.html'), PRIV = PUB('privacy.html'), README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), ENV = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8'), RUN = fs.readFileSync(path.join(ROOT, 'tests', 'run.mjs'), 'utf8');
  check('the server wires the module with the chain\'s node (a revert is null, an unreachable node says so), the metered fetchers, Jupiter\'s URL and key from env',
    /const swapkit = \(\) => _skInst \|\| \(_skInst = SWAPKIT\.createSwapKit\(\{/.test(SRC) && /rhCall: async \(to, data\) => \{\s*try \{ return await rpc\('eth_call', \[\{ to, data \}, 'latest'\]\); \}/.test(SRC) && /return null; throw Object\.assign\(new Error\('Robinhood Chain could not be read'\), \{ unavailable: true \}\);/.test(SRC)
    && /jupiter: process\.env\.JUPITER_URL \|\| 'https:\/\/api\.jup\.ag'/.test(SRC) && /jupiterKey: process\.env\.JUPITER_API_KEY \|\| ''/.test(SRC) && /'api\.jup\.ag': 25,/.test(SRC) && /JUPITER_API_KEY=\nJUPITER_URL=/.test(ENV) && /JUPITER_URL: 'http:\/\/127\.0\.0\.1:9'/.test(RUN));
  check('three routes, no session, rate-limited by client: the quote, the build (the wallet address checked for the chain), a Solana signature\'s status',
    /if \(p === '\/api\/swap\/quote' && req\.method === 'GET'\) \{\s*if \(!rateLimit\('swapq:' \+ clientIp\(req\), 60, 6e4\)\)/.test(SRC) && /if \(p === '\/api\/swap\/build' && req\.method === 'POST'\) \{\s*if \(!rateLimit\('swapb:' \+ clientIp\(req\), 20, 6e4\)\)/.test(SRC)
    && /if \(chain === 'solana' \? !MC\.isSolanaAddr\(from\) : !\/\^0x\[0-9a-fA-F\]\{40\}\$\/\.test\(from\)\) return bad\(res, 'the wallet address the swap is for is needed'\);/.test(SRC) && /if \(p === '\/api\/swap\/status' && req\.method === 'GET'\)/.test(SRC) && /const b = await readBody\(req, 4096\);/.test(SRC));
  check('the module keeps Jupiter\'s raw answer only for build(): quote() drops it, and the Ethereum route only ever takes WETH-quoted pools whose DEX it can route', /async function quote\(chain, token, amountStr, opts\) \{ const q = await quoteFull\(chain, token, amountStr, opts\); delete q\.jupiter; return q; \}/.test(LIB)
    && /if \(quote !== R\.weth\) \{ otherQuotes\.add\(/.test(LIB) && /if \(dex === 'uniswap' && labels\.includes\('v2'\)\)/.test(LIB) && /else if \(dex === 'uniswap' && labels\.includes\('v3'\)\)/.test(LIB) && /else if \(dex === 'sushiswap'/.test(LIB)
    && /fee = firstWord\(await call\(pool\.address, '0xddca3f43'\)\)/.test(LIB) && /if \(fee == null \|\| fee > 1000000n\) continue;/.test(LIB) && /Number\(q\.priceImpactPct\) \* 100/.test(LIB) && /wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto'/.test(LIB));
  check('the client: one button per detail (its tip says what happens), a panel with presets, the quote lines, a status line and the honest note; the transaction\'s to / chainId are checked against its own list before the wallet sees it; the receipt is read through the wallet\'s node',
    /data-swap-open data-swap-chain="' \+ esc\(chain\) \+ '" data-swap-token="' \+ esc\(t\.address\) \+ '"/.test(CL) && /nothing moves until you confirm there/.test(CL) && /'<dl class="tkd-swap-lines" aria-live="polite">'/.test(CL)
    && /if \(!TO_OK\[chain\]\.includes\(String\(r\.tx\.to \|\| ''\)\.toLowerCase\(\)\) \|\| String\(r\.tx\.chainId\)\.toLowerCase\(\) !== c\.hexId/.test(CL) && /method: 'eth_sendTransaction', params: \[\{ from: address, to: r\.tx\.to, value: r\.tx\.value, data: r\.tx\.data, chainId: c\.hexId \}\]/.test(CL) && /if \(!\(await onChain\(prov, c\.hexId, 1\)\)\)/.test(CL)
    && /method: 'eth_getTransactionReceipt', params: \[hash\]/.test(CL) && /method: 'eth_getBalance', params: \[address, 'latest'\]/.test(CL) && /WALLET\.connect\(\{ noSwitch: true \}\)/.test(CL) && /never asks for a token approval, and cannot cancel, reverse or refund a swap/.test(CL) && /never a tip to buy — most new tokens go to zero/.test(CL)
    && !/fetch\('https?:\/\//.test(CL) /* the browser talks only to this site and to the wallet */);
  check('  ...Solana: Wallet Standard discovery (register-wallet / app-ready), connect, signAndSendTransaction with the bytes on solana:mainnet, the signature base58-encoded, Jupiter\'s program checked, a simulation failure stops it',
    /window\.addEventListener\('wallet-standard:register-wallet'/.test(CL) && /new CustomEvent\('wallet-standard:app-ready', \{ detail: solApi \}\)/.test(CL) && /w\.features\['standard:connect'\]\.connect\(\)/.test(CL)
    && /signAndSendTransaction\(\{ account, transaction: txBytes, chain: 'solana:mainnet' \}\)/.test(CL) && /if \(!keys \|\| keys\[0\] !== account\.address \|\| !keys\.includes\(JUPITER\)\)/.test(CL) && !/r\.tx\.program !== JUPITER/.test(CL) && /if \(r\.tx\.simulationError\)/.test(CL) && /'\/api\/swap\/status\?chain=solana&sig='/.test(CL));
  check('  ...the sounds a buy may make are the landing page\'s: swap when the wallet sends it, error / warn / select otherwise — never launch, coin, success or a fanfare', (() => { const used = [...CL.matchAll(/sfx\('([a-z]+)'\)/g)].map((m) => m[1]); return used.includes('swap') && used.every((n) => ['swap', 'error', 'warn', 'select'].includes(n)); })());
  check('  ...a cancelled wallet prompt (4001) is the visitor\'s own choice and says so, with no error sound; a wallet not on the chain is switched (and Robinhood Chain added if unknown) before anything is built',
    /if \(e && e\.code === 4001\) \{ status\(panel, 'Swap cancelled in your wallet — nothing was sent', 'info'\); return; \}/.test(CL) && /async function ensureChain\(prov, chain\)/.test(CL) && /method: 'wallet_addEthereumChain', params: \[CH\[chain\]\.add\]/.test(CL) && /if \(on === 'declined'\) \{ status\(panel, 'Network switch cancelled in your wallet — nothing was sent', 'info'\); return; \}/.test(CL)
    && /const unknownChain = \(e\) => errs\(e\)\.some\(\(x\) => x\.code === 4902/.test(CL) && /return \(await onChain\(prov, want, 8\)\) \? 'ok' : 'failed';/.test(CL));
  check('  ...the home chain\'s $SEND / $GWC buys still earn Send Points through the receipt-verified route, nothing else does', /if \(chain !== 'robinhood' \|\| !HOME_CREDIT\.includes\(String\(token\)\.toLowerCase\(\)\)\) return;/.test(CL) && /post\('\/api\/gamify\/swap', \{ txHash: hash \}\)/.test(CL) && /HOME_CREDIT = \['0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', '0x61339f11384dde4b2dc3a33e75b4dc23cc620f22'\]/.test(CL));
  check('the dashboard: the button sits in the action group under the caveat, on every chain (hideSwap leaves it out), and mountDashboard wires the panel; the header comment tells the truth about the one CTA',
    /\(window\.SwapKit && !opts\.hideSwap \? SwapKit\.buttonHTML\(p\) : ''\) \+/.test(NP) && /if \(window\.SwapKit\) SwapKit\.mount\(root\);/.test(NP) && NP.indexOf('tkd-caveat') < NP.indexOf('SwapKit.buttonHTML(p)') && !/No buy\/swap CTA anywhere/.test(NP) && /a tool beside the read, never a tip/.test(NP));
  check('every page that renders the token detail loads swapkit.js after wallet.js and tokenmodal.js', ['community.html', 'squad.html', 'newpairs.html', 'support.html', 'wall.html', 'watchlist.html', 'u.html'].every((f) => { const h = PUB(f); const s = h.indexOf('swapkit.js"></script>'); return s > 0 && s > h.indexOf('wallet.js"></script>') && s > h.indexOf('tokenmodal.js"></script>'); }));
  check('a connect may skip the home-chain courtesy switch (the swap on an Ethereum token puts the wallet where it needs it) — the pinned connect text is untouched', /if \(!\(opts && opts\.noSwitch\) && typeof window\.ensureRobinhoodChain === 'function'\) chainOk = await window\.ensureRobinhoodChain\(chosen\.provider, 'connect'\);/.test(WL));
  check('the panel is framed in the chain\'s colour, every size floored, and a high impact is said in words as well as colour', /\.tkd-swap \{ margin-top: 0\.8rem;[^\n]*border: 2px solid color-mix\(in srgb, var\(--chain, var\(--green\)\) 58%, var\(--ink-4\)\)/.test(CSS)
    && !/font-size:\s*(?!max\(var\(--text-floor\))[0-9.]+(rem|px|em)/.test(CSS.slice(CSS.indexOf('/* ===== Swap in my wallet (owner, 2026-10-23)'))) && /⚠️ high — this size moves the pool/.test(CL));
  check('the terms say the swaps are the only transactions the Site prepares, name the routers on each chain and Jupiter, and moved to 2026-10-23 with the server\'s TOS_VERSION; the privacy policy says what the server sends to Jupiter and that the Ethereum receipt is the wallet\'s node\'s',
    /The only transactions we ever prepare are swaps — in the swap widget on the home page, and behind the <b>Swap in my wallet<\/b> button/.test(TERMS) && /a Uniswap v2 router on Robinhood Chain; a Uniswap or SushiSwap router on Ethereum; Jupiter's aggregator program/.test(TERMS)
    && /Ethereum and Solana, whose tokens the Scanner reads and the swap button can buy, are run by others too/.test(TERMS) && /Version 2026-10-23 ·/.test(TERMS) && /const TOS_VERSION = '2026-10-23';/.test(SRC)
    && /passes your wallet's public address and the amount to Jupiter \(jup\.ag\), which builds the transaction, and your wallet signs and sends it/.test(PRIV) && /A swap built from a token's detail on Ethereum is sent and its receipt read by your own wallet's node, not by us/.test(PRIV)
    && /every token's on‑chain detail carries 🚀 Swap in my wallet/.test(README) && /every token's detail has a 🚀 Swap in my wallet button/.test(SRC));
  check('nothing new tells anyone to buy', !/\bbuy (now|this|some|more|it|today)\b|should buy|don't miss/i.test(CL + LIB));
  check('the budgets: Jupiter (25/min), the Ethereum node (240) and the Solana node (120) are metered for every reader; one reader gets 12 Solana quotes and 6 Solana builds a minute; the status poll is 40',
    /'ethereum-rpc\.publicnode\.com': 240,/.test(SRC) && /'api\.mainnet-beta\.solana\.com': 120,/.test(SRC) && /rateLimit\('swapqs:' \+ clientIp\(req\), 12, 6e4\)/.test(SRC) && /rateLimit\('swapbs:' \+ clientIp\(req\), 6, 6e4\)/.test(SRC) && /rateLimit\('swaps:' \+ clientIp\(req\), 40, 6e4\)/.test(SRC)
    && /await meter\(ethHost, 'The Ethereum node'\);/.test(LIB) && /const solPost = async \(method, params\) => \{ await meter\(solHost, 'The Solana node'\);/.test(LIB) && /await meter\(jupHost, 'Jupiter'\);/.test(LIB));
  check('  ...a Robinhood Chain node error is a revert only when it says so (a bare /execution/ also matched "execution timeout")', /if \(\/revert\|invalid opcode\|out of gas\/i\.test\(String\(\(e && e\.message\) \|\| ''\)\)\) return null;/.test(SRC));
}

/* ═══ 2b. the client's checks, run: the panel's own code in a sandbox ═══ */
{
  const win = { addEventListener() {}, dispatchEvent() {} };
  const ctx = { window: win, document: { addEventListener() {} }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, atob: (b) => Buffer.from(b, 'base64').toString('binary'), console };
  vm.createContext(ctx); vm.runInContext(PUB('swapkit.js'), ctx);
  const C = win.SwapKit, FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'swapkit', 'jup-swap-sol-bonk.json'), 'utf8'));
  const bytes = Uint8Array.from(Buffer.from(FX.swapTransaction, 'base64')), keys = C.solTxKeys(bytes);
  check('the panel reads a real Jupiter transaction\'s bytes (captured 2026-10-24, never signed): the fee payer is the wallet it was built for, and Jupiter\'s program is among its keys', !!keys && keys[0] === FX.userPublicKey && keys.includes('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'), keys && keys.slice(0, 3).join(','));
  const other = bytes.slice(); other[1 + 64 * other[0] + 1 + 3 + 1] ^= 0xff;   // one byte of the fee payer's key changed
  check('  ...a transaction someone else pays for reads as such, and bytes that are not a transaction read as nothing', C.solTxKeys(other)[0] !== FX.userPublicKey && C.solTxKeys(new Uint8Array([1, 2, 3])) === null && C.solTxKeys(Uint8Array.from(Buffer.from('a fake serialized v0 transaction'))) === null);
  check('  ...a wallet\'s chain id is read whatever its form (a number, uppercase hex, a leading zero, decimal)', C.hexChain(1) === '0x1' && C.hexChain('0x01') === '0x1' && C.hexChain('0X1237') === '0x1237' && C.hexChain('4663') === '0x1237' && C.hexChain(null) === '');
}

/* ═══ 3. a server of its own, every upstream faked ═══
   Each route is reached for its own reason: PEPE's deepest pool is Uniswap v2 and its router answers, so v2 wins; TOKV3 has only a v3 pool;
   TOKSU only a SushiSwap pool; TOKUSDC trades only against stablecoins; TOKUNR's ETH pool is on a DEX this site cannot route; TOKDRAIN's
   pool does not quote; TOKERR's node answers an error that is not a revert; TOKTAX carries GoPlus's buy tax; on the home chain TOKU's
   direct pool is dust and its USDG pool is real. Jupiter answers 200, 400 (no route), 401, 500 or 429 as the suite sets it. */
const hits = {}; const count = (k) => { hits[k] = (hits[k] || 0) + 1; };
const dsPepe = FIX('ds-token-pairs-ethereum-pepe.json'), dsBonk = FIX('ds-token-pairs-solana-bonk.json'), dsBonkOrca = FIX('ds-pair-solana-bonk-orca.json');
const JUPFX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'swapkit', 'jup-swap-sol-bonk.json'), 'utf8'));
const tok = (n) => '0x' + String(n).repeat(40).slice(0, 40);
const TOKV3 = tok('a3'), TOKSU = tok('5a'), TOKUSDC = tok('c0'), TOKUNR = tok('b7'), TOKDRAIN = tok('d1'), TOKERR = tok('e7'), TOKTAX = tok('7a'), TOKU = tok('9b');
const V3POOL = tok('3f'), SUPOOL = tok('5b'), USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', RH_USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const T0 = dsPepe[0];
// a Dexscreener pair for a test token, from the real PEPE pair: only the fields under test change
const dsPair = (base, dexId, labels, pairAddress, quote, liq) => Object.assign(structuredClone(T0), { dexId, labels, pairAddress, baseToken: { address: base, name: 'Test ' + base.slice(2, 6), symbol: 'T' + base.slice(2, 5).toUpperCase() }, quoteToken: quote, liquidity: { usd: liq, base: 1, quote: 1 }, priceUsd: '0.5' });
const WETHQ = { address: WETH, name: 'Wrapped Ether', symbol: 'WETH' };
const DS = {
  [TOKV3]: [dsPair(TOKV3, 'uniswap', ['v3'], V3POOL, WETHQ, 900000)],
  [TOKSU]: [dsPair(TOKSU, 'sushiswap', [], SUPOOL, WETHQ, 500000)],
  [TOKUSDC]: [dsPair(TOKUSDC, 'uniswap', ['v2'], tok('c1'), { address: USDC, name: 'USD Coin', symbol: 'USDC' }, 800000), dsPair(TOKUSDC, 'uniswap', ['v3'], tok('c2'), { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', name: 'Tether', symbol: 'USDT' }, 400000)],
  [TOKUNR]: [dsPair(TOKUNR, 'pancakeswap', ['v3'], tok('b8'), WETHQ, 700000)],
  [TOKDRAIN]: [dsPair(TOKDRAIN, 'uniswap', ['v2'], tok('d2'), WETHQ, 600000)],
  [TOKERR]: [dsPair(TOKERR, 'uniswap', ['v2'], tok('e8'), WETHQ, 600000)],
  [TOKTAX]: [dsPair(TOKTAX, 'uniswap', ['v2'], tok('7b'), WETHQ, 600000)],
};
const jupQuote = { inputMint: SOLM, inAmount: '100000000', outputMint: BONK, outAmount: '328406166413', otherAmountThreshold: '295565549772', swapMode: 'ExactIn', slippageBps: 1000, platformFee: null, priceImpactPct: '0.00187321282483121717473634', routePlan: [{ swapInfo: { ammKey: '5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9', label: 'Whirlpool', inputMint: SOLM, outputMint: BONK, inAmount: '100000000', outAmount: '328406166413' }, percent: 100 }], contextSlot: 460660119 };
let lastSwapBody = null, jupMode = 'ok', solMode = 'ok', rhRouterCalls = 0;
const SIG = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW', SIG_FAIL = SIG.replace(/.{4}$/, 'FaiL'), BLOCK_HEIGHT = 438771600;
const rpcOk = (j, result) => ({ jsonrpc: '2.0', id: j.id, result }), revert = (j) => ({ jsonrpc: '2.0', id: j.id, error: { code: 3, message: 'execution reverted' } });
const amountsOut = (j, data, k) => { const amt = BigInt('0x' + data.slice(10, 74)); const n = (data.length - 10 - 192) / 64; const out = k(amt); return rpcOk(j, '0x' + w(0x20) + w(n) + w(amt) + (n === 3 ? w(amt) : '') + w(out)); };
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  let body = ''; req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const p = u.pathname; count(p);
    let j = {}; try { j = JSON.parse(body); } catch {}
    if (p === '/cg') return send(200, { ethereum: { usd: 2400 } });   // CoinGecko's ETH price
    if (p === '/rh') {   // the home chain's node: the v2 router for [WETH, SEND] (linear) and TOKU (a dust direct pool, a real USDG pool)
      const c = j.params && j.params[0] || {}; const to = String(c.to || '').toLowerCase(), data = String(c.data || '');
      if (to === RH_ROUTER && data.startsWith('0xd06ca61f')) {
        rhRouterCalls++;
        if (data.endsWith(aw(RH_WETH) + aw(SEND)) && data.includes(w(2) + aw(RH_WETH))) return send(200, amountsOut(j, data, (a) => a * 1000000n));
        if (data.endsWith(aw(RH_WETH) + aw(TOKU))) return send(200, amountsOut(j, data, (a) => a * 10n));                       // dust
        if (data.endsWith(aw(RH_WETH) + aw(RH_USDG) + aw(TOKU))) return send(200, amountsOut(j, data, (a) => a * 1000n));        // the real pool
        return send(200, revert(j));
      }
      if ((to === SEND || to === TOKU) && data === '0x313ce567') return send(200, rpcOk(j, '0x' + w(18)));
      return send(200, revert(j));
    }
    if (p === '/eth') {
      const c = j.params && j.params[0] || {}; const to = String(c.to || '').toLowerCase(), data = String(c.data || '');
      const pathEnds = (t) => data.endsWith(aw(WETH) + aw(t));
      if (to === SK.ROUTERS.ethereum.uniV2 && data.startsWith('0xd06ca61f')) {
        if (pathEnds(PEPE)) return send(200, amountsOut(j, data, (a) => a * 520000000n * (a >= 10n ** 16n ? 95n : 100n) / 100n));   // 5% short at size → an impact shows
        if (pathEnds(TOKTAX)) return send(200, amountsOut(j, data, (a) => a * 1000n));
        if (pathEnds(TOKERR)) return send(200, { jsonrpc: '2.0', id: j.id, error: { code: -32005, message: 'rate limit exceeded' } });   // not a revert
        return send(200, revert(j));   // TOKDRAIN, and everything else
      }
      if (to === SK.ROUTERS.ethereum.sushiV2 && data.startsWith('0xd06ca61f') && pathEnds(TOKSU)) return send(200, amountsOut(j, data, (a) => a * 2000n));
      if (to === V3POOL && data === '0xddca3f43') return send(200, rpcOk(j, '0x' + w(3000)));
      if (to === SK.ROUTERS.ethereum.uniV3Quoter && data.startsWith('0xc6a5026a') && data.slice(10 + 64, 10 + 128) === aw(TOKV3)) {
        const amt = BigInt('0x' + data.slice(10 + 128, 10 + 192)), fee = BigInt('0x' + data.slice(10 + 192, 10 + 256));
        if (fee !== 3000n) return send(200, revert(j));
        return send(200, rpcOk(j, '0x' + w(amt * 3000n * (amt >= 10n ** 16n ? 9n : 10n) / 10n) + w(0) + w(0) + w(0)));   // 10% short at size
      }
      if ([PEPE, TOKV3, TOKSU, TOKTAX].includes(to) && data === '0x313ce567') return send(200, rpcOk(j, '0x' + w(18)));
      return send(200, revert(j));
    }
    if (p === '/sol') {
      if (solMode === 'down') return send(503, { error: 'unavailable' });
      if (j.method === 'getAccountInfo' && j.params && j.params[0] === BONK) return send(200, rpcOk(j, { context: { slot: 1 }, value: { data: { parsed: { info: { decimals: 5, freezeAuthority: null, isInitialized: true, mintAuthority: null, supply: '8799432013884029428' }, type: 'mint' }, program: 'spl-token', space: 82 }, owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', lamports: 1, executable: false } }));
      if (j.method === 'getSignatureStatuses') { const s = j.params && j.params[0] && j.params[0][0]; return send(200, rpcOk(j, { context: { slot: 2 }, value: [s === SIG ? { slot: 460660200, confirmations: null, err: null, confirmationStatus: 'finalized' } : s === SIG_FAIL ? { slot: 460660201, confirmations: null, err: { InstructionError: [3, { Custom: 6001 }] }, confirmationStatus: 'confirmed' } : null] })); }
      if (j.method === 'getBlockHeight') return send(200, rpcOk(j, BLOCK_HEIGHT));
      return send(200, rpcOk(j, { context: { slot: 1 }, value: null }));
    }
    if (p.startsWith('/ds/token-pairs/v1/')) {
      const [, , , , chain, addr] = p.split('/');
      if (chain === 'ethereum' && addr.toLowerCase() === PEPE) return send(200, dsPepe);
      if (chain === 'ethereum' && DS[addr.toLowerCase()]) return send(200, DS[addr.toLowerCase()]);
      if (chain === 'solana' && addr === BONK) return send(200, dsBonk);
      return send(200, []);
    }
    if (p.startsWith('/ds/latest/dex/pairs/')) { const [, , , , , chain, pool] = p.split('/'); if (chain === 'solana' && pool === '5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9') return send(200, dsBonkOrca); return send(200, { schemaVersion: '1.0.0', pairs: null }); }
    if (p === '/jup/swap/v1/quote') {
      if (jupMode === '401') return send(401, { code: 401, message: 'Unauthorized' });
      if (jupMode === '500') return send(500, { error: 'internal' });
      if (jupMode === '429') return send(429, { error: 'Too many requests' });
      if (u.searchParams.get('outputMint') !== BONK) return send(400, { error: 'The token is not tradable', errorCode: 'TOKEN_NOT_TRADABLE' });
      return send(200, Object.assign({}, jupQuote, { inAmount: u.searchParams.get('amount'), slippageBps: Number(u.searchParams.get('slippageBps')) }));
    }
    if (p === '/jup/swap/v1/swap') { lastSwapBody = j; if (!j.userPublicKey || !j.quoteResponse) return send(400, { error: 'bad' }); return send(200, { swapTransaction: JUPFX.swapTransaction, lastValidBlockHeight: JUPFX.lastValidBlockHeight, prioritizationFeeLamports: 1000, computeUnitLimit: 200000, simulationError: null }); }
    send(404, { error: 'not here: ' + p });
  });
});
await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
fake.unref();
const FAKE = 'http://127.0.0.1:' + fake.address().port;
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const PORT = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-sk-'));
fs.writeFileSync(path.join(dataDir, '.data_key'), (await import('node:crypto')).randomBytes(32).toString('hex') + '\n', { mode: 0o600 });   // a throwaway key, never printed
const env = { ...process.env, PORT: String(PORT), JSI_DATA_DIR: dataDir, DATA_DIR: dataDir, BASE_URL: 'http://localhost:' + PORT, NODE_ENV: 'test',
  SEED_INVITE_CODE: '12345', TOS_GATE: '1', TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback', SEED_CODES_OPEN: '1', DATA_KEY: '', DATA_KEY_FILE: '', BACKUP_DIR: path.join(dataDir, 'backups'), KEY_ROTATE_EXTRA_DBS: '',
  RPC_URL: FAKE + '/rh', CHART_SRC_DS_URL: 'http://127.0.0.1:9/', CHART_SRC_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_DS_URL: 'http://127.0.0.1:9/',
  MC_DEXSCREENER_URL: FAKE + '/ds', MC_GECKO_URL: FAKE + '/gt', MC_GOPLUS_URL: FAKE + '/gp', ETH_RPC_URL: FAKE + '/eth', SOL_RPC_URL: FAKE + '/sol', JUPITER_URL: FAKE + '/jup', ETHUSD_URL: FAKE + '/cg',
  OUTBOUND_MAX_WAIT_MS: '2000', ['OUTBOUND_RPM_' + ('127.0.0.1:' + fake.address().port).replace(/[^A-Z0-9]/gi, '_')]: '6000' };   // every fake upstream shares one host here; the vendors' own meters are pinned above
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
const B = 'http://localhost:' + PORT;
async function api(p, body) {
  let r; try { r = await fetch(B + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined); } catch (e) { throw new Error('fetch failed on ' + p + ': ' + ((e && e.cause && e.cause.code) || e.message) + ' · server log: ' + log.slice(-400).replace(/\s+/g, ' ')); }
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
const q = (chain, token, amount, extra) => api('/api/swap/quote?chain=' + chain + '&token=' + token + '&amount=' + amount + (extra || ''));
try {
  let up = false;
  for (let i = 0; i < 150 && !up; i++) { try { const r = await fetch(B + '/healthz'); up = r.ok; } catch {} if (!up) await sleep(200); }
  check('the server came up with every upstream pointed at the fake', up, log.slice(-300));

  /* ── the home chain ── */
  const rq = await q('robinhood', SEND, '0.01');
  const r = rq.j || {};
  check('a $SEND quote on Robinhood Chain: ETH in wei, the router\'s amountOut, its 1% tax (the contract\'s own) taken off what lands, the 10% minimum on what lands, 0 impact from a linear fake, the direct route, decimals and ETH\'s dollar price read',
    rq.status === 200 && r.chain === 'robinhood' && r.native === 'ETH' && r.amountIn === (10n ** 16n).toString() && r.amountOut === (10n ** 22n).toString() && r.taxPct === 1 && r.taxSource === 'contract'
    && r.amountLanded === (99n * 10n ** 20n).toString() && r.minOut === (891n * 10n ** 19n).toString() && r.minLanded === r.minOut && r.impactPct === 0 && r.route && r.route.kind === 'v2' && r.route.router === RH_ROUTER
    && r.route.path.join() === RH_WETH + ',' + SEND && r.decimals === 18 && r.slippagePct === 10 && r.nativeUsd === 2400 && !('jupiter' in r), rq.status + ' ' + JSON.stringify(r).slice(0, 300));
  const callsBefore = rhRouterCalls; const again = await q('robinhood', SEND, '0.01');
  check('  ...the same quote a moment later is the kept one: the router is not asked again (10 s), and the answer is the same', again.status === 200 && again.j.amountOut === r.amountOut && rhRouterCalls === callsBefore, rhRouterCalls - callsBefore + ' new router calls');
  const rb = await api('/api/swap/build', { chain: 'robinhood', token: SEND, amount: '0.01', from: ME, slippage: 10 });
  const t = (rb.j && rb.j.tx) || {};
  check('  ...its build: to the router, chain 0x1237, the value in hex, the fee-on-transfer calldata with the taxed minimum, the path and the receiver, a 20-minute deadline', rb.status === 200 && t.kind === 'evm' && t.to === RH_ROUTER && t.chainId === '0x1237' && t.value === '0x' + (10n ** 16n).toString(16)
    && t.data.startsWith('0xb6f9de95' + w(891n * 10n ** 19n) + w(0x80) + aw(ME)) && t.data.endsWith(w(2) + aw(RH_WETH) + aw(SEND)) && t.deadline > Date.now() / 1000 + 19 * 60 && t.deadline < Date.now() / 1000 + 21 * 60, rb.status + ' ' + JSON.stringify(rb.j).slice(0, 300));
  const uq = await q('robinhood', TOKU, '0.01'), ub = await api('/api/swap/build', { chain: 'robinhood', token: TOKU, amount: '0.01', from: ME });
  check('  ...both home-chain paths are asked and the better fill wins: a dust WETH pool does not pre-empt the token\'s USDG pool, and the build carries the three-hop path',
    uq.status === 200 && uq.j.route.path.join() === RH_WETH + ',' + RH_USDG + ',' + TOKU && uq.j.amountOut === (10n ** 19n).toString() && /through USDG/.test(uq.j.route.dex) && uq.j.taxPct === null
    && ub.status === 200 && ub.j.tx.data.endsWith(w(3) + aw(RH_WETH) + aw(RH_USDG) + aw(TOKU)), uq.status + ' ' + JSON.stringify(uq.j).slice(0, 220));
  check('  ...a token with no pool against ETH or USDG on the home chain is "cannot route", not a transaction', /no pool on Robinhood Chain prices this token against ETH or USDG/.test((await q('robinhood', PEPE, '0.01')).j.unsupported || ''));

  /* ── Ethereum ── */
  const eq = await q('ethereum', PEPE, '0.05'), e = eq.j || {};
  check('a PEPE quote on Ethereum takes the deepest WETH pool Dexscreener lists — Uniswap v2 — through Uniswap\'s v2 router, with the impact against a sliver, the symbol, the dollar price of that pool and ETH\'s',
    eq.status === 200 && e.route && e.route.kind === 'v2' && e.route.dex === 'Uniswap v2' && e.route.router === SK.ROUTERS.ethereum.uniV2 && e.route.pool === '0xa43fe16908251ee70ef74718545e4fe6c5ccec9f'
    && e.amountOut === (5n * 10n ** 16n * 520000000n * 95n / 100n).toString() && Math.abs(e.impactPct - 5) < 1e-6 && e.symbol === 'PEPE' && e.tokenUsd === Number(dsPepe.find((d) => d.pairAddress.toLowerCase() === e.route.pool).priceUsd) && e.nativeUsd === 2400 && e.taxPct === null,
    eq.status + ' ' + JSON.stringify(e).slice(0, 300));
  const v3q = await q('ethereum', TOKV3, '0.05'), v3b = await api('/api/swap/build', { chain: 'ethereum', token: TOKV3, amount: '0.05', from: ME });
  const et = (v3b.j && v3b.j.tx) || {};
  check('  ...a token whose only ETH pool is Uniswap v3: the pool\'s fee read (3000), quoted by QuoterV2, built as SwapRouter02 multicall(deadline, [exactInputSingle]) with the receiver, the amount and the minimum, value attached, chain 0x1',
    v3q.status === 200 && v3q.j.route.kind === 'v3' && v3q.j.route.pool === V3POOL && v3q.j.route.fee === 3000 && Math.abs(v3q.j.impactPct - 10) < 1e-6
    && v3b.status === 200 && et.to === SK.ROUTERS.ethereum.uniV3 && et.chainId === '0x1' && et.value === '0x' + (5n * 10n ** 16n).toString(16) && et.data.startsWith('0x5ae401dc') && et.data.includes('04e45aaf' + aw(WETH) + aw(TOKV3) + w(3000) + aw(ME) + w(5n * 10n ** 16n) + w(BigInt(v3b.j.minOut))),
    v3q.status + ' ' + JSON.stringify(v3q.j).slice(0, 200));
  const suq = await q('ethereum', TOKSU, '0.05');
  check('  ...a token whose only ETH pool is on SushiSwap goes through Sushi\'s v2 router', suq.status === 200 && suq.j.route.kind === 'v2' && suq.j.route.router === SK.ROUTERS.ethereum.sushiV2 && suq.j.route.dex === 'SushiSwap v2' && suq.j.amountOut === (5n * 10n ** 16n * 2000n).toString(), JSON.stringify(suq.j).slice(0, 200));
  const why = async (t2) => (await q('ethereum', t2, '0.05')).j;
  const [wUsdc, wUnr, wDrain, wErr] = [await why(TOKUSDC), await why(TOKUNR), await why(TOKDRAIN), await why(TOKERR)];
  check('  ...a refusal says why: no ETH pool (naming what it trades against), a DEX this site cannot route (named), ETH pools that did not quote this amount — and a node error that is not a revert is "unavailable", never a fact about the token',
    /has no pool against ETH — its pools trade against USDC, USDT, and this panel swaps from ETH/.test(wUsdc.unsupported || '') && /on a DEX this site cannot route \(pancakeswap v3\)/.test(wUnr.unsupported || '')
    && /did not quote this amount/.test(wDrain.unsupported || '') && !wErr.unsupported && /the Ethereum node refused the read \(rate limit exceeded\)/.test(wErr.unavailable || ''), JSON.stringify([wUsdc.unsupported, wUnr.unsupported, wDrain.unsupported, wErr.unavailable]));
  const tq = await q('ethereum', TOKTAX, '0.05', '&tax=5'), tb = await api('/api/swap/build', { chain: 'ethereum', token: TOKTAX, amount: '0.05', from: ME, tax: 5 });
  const out = 5n * 10n ** 16n * 1000n, landed = out * 95n / 100n, least = landed * 90n / 100n;
  check('  ...GoPlus\'s 5% buy tax, passed in by the panel, is taken off what lands and the v2 minimum leaves room for it (or every such buy would revert); a 60% tax is not built',
    tq.status === 200 && tq.j.taxPct === 5 && tq.j.taxSource === 'goplus' && tq.j.amountOut === out.toString() && tq.j.amountLanded === landed.toString() && tq.j.minOut === least.toString() && tq.j.minLanded === least.toString()
    && tb.status === 200 && tb.j.tx.data.startsWith('0xb6f9de95' + w(least)) && /keeps 60% of every buy as a tax/.test((await q('ethereum', TOKTAX, '0.05', '&tax=60')).j.unsupported || ''), JSON.stringify(tq.j).slice(0, 260));
  check('  ...a build without a wallet address, or with a Solana one, is refused', (await api('/api/swap/build', { chain: 'ethereum', token: PEPE, amount: '0.05' })).status === 400 && (await api('/api/swap/build', { chain: 'ethereum', token: PEPE, amount: '0.05', from: ME_SOL })).status === 400);

  /* ── Solana ── */
  const sq = await q('solana', BONK, '0.1'), s = sq.j || {};
  check('a BONK quote on Solana comes from Jupiter: lamports in, outAmount, Jupiter\'s own threshold as the minimum, its impact as a percent (a fraction × 100), the route labelled, decimals from the mint, the deepest pool\'s dollar price, SOL\'s from the SOL pool',
    sq.status === 200 && s.chain === 'solana' && s.native === 'SOL' && s.amountIn === '100000000' && s.amountOut === '328406166413' && s.minOut === '295565549772' && s.minLanded === s.minOut && Math.abs(s.impactPct - 0.187321282483121717473634) < 1e-9
    && s.route && s.route.kind === 'jupiter' && s.route.dex === 'Jupiter → Whirlpool' && s.route.program === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' && s.decimals === 5 && s.nativeUsd > 0 && s.tokenUsd > 0 && s.symbol === 'Bonk' && !('jupiter' in s), sq.status + ' ' + JSON.stringify(s).slice(0, 300));
  const swapsBefore = hits['/jup/swap/v1/quote'] || 0;
  const sb = await api('/api/swap/build', { chain: 'solana', token: BONK, amount: '0.1', from: ME_SOL });
  check('  ...its build reuses the quote just made (Jupiter is not asked for it again), asks /swap with it and the wallet\'s public key (SOL wrapped, dynamic compute, auto priority fee), and hands back the serialized transaction and its last valid block — the raw quote never leaves the server',
    sb.status === 200 && sb.j.tx && sb.j.tx.kind === 'solana' && sb.j.tx.swapTransaction === JUPFX.swapTransaction && sb.j.tx.lastValidBlockHeight === JUPFX.lastValidBlockHeight && (hits['/jup/swap/v1/quote'] || 0) === swapsBefore
    && lastSwapBody && lastSwapBody.userPublicKey === ME_SOL && lastSwapBody.quoteResponse && lastSwapBody.quoteResponse.outAmount === '328406166413' && lastSwapBody.wrapAndUnwrapSol === true && lastSwapBody.dynamicComputeUnitLimit === true && lastSwapBody.prioritizationFeeLamports === 'auto' && !('jupiter' in sb.j), sb.status + ' ' + JSON.stringify(sb.j).slice(0, 300));
  check('  ...a Solana build with an EVM address is refused; a mint Jupiter answers 400 for is "Jupiter finds no route", not an error; an amount with more decimals than SOL has is refused by name',
    (await api('/api/swap/build', { chain: 'solana', token: BONK, amount: '0.1', from: ME })).status === 400 && /Jupiter finds no route/.test((await q('solana', ME_SOL, '0.1')).j.unsupported || '')
    && /SOL takes at most 9 decimal places/.test((await q('solana', BONK, '0.0000000001')).j.error || ''));
  const jm = {};
  for (const [mode, amt] of [['401', '0.2'], ['500', '0.3'], ['429', '0.4']]) { jupMode = mode; jm[mode] = await q('solana', BONK, amt); }
  jupMode = 'ok';
  check('  ...Jupiter not answering — a 401 from a wrong key, a 500, a 429 — is said as Jupiter not answering (a 200 with unavailable), never as "no route" for the token and never as a 502',
    jm['401'].status === 200 && /Jupiter could not be read \(upstream 401\)/.test(jm['401'].j.unavailable || '') && !jm['401'].j.unsupported
    && jm['500'].status === 200 && /Jupiter could not be read \(upstream 500\)/.test(jm['500'].j.unavailable || '') && jm['429'].status === 200 && /Jupiter could not be read \(rate-limited\)/.test(jm['429'].j.unavailable || ''),
    JSON.stringify(Object.fromEntries(Object.entries(jm).map(([k, v]) => [k, v.status + ' ' + (v.j && (v.j.unavailable || v.j.unsupported || v.j.error))]))));
  const st = async (sig, extra) => api('/api/swap/status?chain=solana&sig=' + sig + (extra || ''));
  const [sFin, sFail, sPend, sExp] = [await st(SIG), await st(SIG_FAIL), await st(SIG.replace(/.$/, '1'), '&lvbh=' + (BLOCK_HEIGHT + 10)), await st(SIG.replace(/.$/, '2'), '&lvbh=' + (BLOCK_HEIGHT - 10))];
  solMode = 'down'; const sDown = await st(SIG); solMode = 'ok';
  check('a Solana signature\'s standing: finalized, failed (with the program\'s error), pending while its last valid block is ahead, EXPIRED once the chain is past it, and "unavailable" when the node does not answer; a malformed one is refused and an EVM chain is told where its receipt comes from',
    sFin.j.status === 'finalized' && sFail.j.status === 'failed' && sFail.j.err && sPend.j.status === 'pending' && sExp.j.status === 'expired' && sExp.j.blockHeight === BLOCK_HEIGHT && /the Solana node could not be read/.test(sDown.j.unavailable || '')
    && (await st('zzz')).status === 400 && /your wallet/.test((await api('/api/swap/status?chain=ethereum&sig=' + SIG)).j.error), JSON.stringify([sFin.j, sFail.j.status, sPend.j, sExp.j, sDown.j]));

  /* ── refusals and budgets ── */
  check('a bad amount, a bad address, an unknown chain and a mismatched chain are 400s with a reason', (await q('ethereum', PEPE, 'abc')).status === 400 && (await q('ethereum', 'nope', '1')).status === 400
    && (await q('base', PEPE, '1')).status === 400 && (await q('solana', PEPE, '1')).status === 400 && (await q('ethereum', PEPE, '0')).status === 400);
  check('the slippage is clamped: 99 becomes 49, 0 becomes 10 (the default), 0.01 becomes 0.1', (await q('robinhood', SEND, '0.02', '&slippage=99')).j.slippagePct === 49 && (await q('robinhood', SEND, '0.02', '&slippage=0')).j.slippagePct === 10 && (await q('robinhood', SEND, '0.02', '&slippage=0.01')).j.slippagePct === 0.1);
  check('the Ethereum pool list was read once a minute, not per quote (cached); GoPlus and GeckoTerminal were never asked; CoinGecko only through ETHUSD_URL', (hits['/ds/token-pairs/v1/ethereum/' + PEPE] || 0) <= 2 && !Object.keys(hits).some((k) => k.startsWith('/gp') || k.startsWith('/gt')) && hits['/cg'] >= 1, JSON.stringify(hits));
  // one reader may spend a share of Jupiter's keyless budget, not all of it: 12 Solana quotes a minute (asked last, so nothing above trips it)
  let lim = null; for (let i = 0; i < 16 && !lim; i++) { const x = await q('solana', BONK, '0.' + (5 + i) + '1'); if (x.status === 429) lim = x; }
  check('one reader\'s Solana quotes are capped (12 a minute) so Jupiter\'s shared budget is not one reader\'s', !!lim && /too many Solana quotes/.test(lim.j.error || ''));
} catch (e) {
  check('the suite ran to the end', false, (e && e.stack || e) + ' · log: ' + log.slice(-300).replace(/\s+/g, ' '));
} finally {
  server.kill('SIGTERM'); await sleep(400); try { if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL'); } catch {}   // killed is true once a signal is SENT; exitCode/signalCode say it ended
  fs.rmSync(dataDir, { recursive: true, force: true });
  fake.close();
}

let pass = 0;
for (const [n, ok, extra] of results) { if (ok) pass++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok || !extra ? '' : '\n      ' + extra)); }
console.log(`\n${pass}/${results.length} passed`);
if (pass !== results.length) process.exit(1);
