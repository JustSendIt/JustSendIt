/* ===== The Scanner on Ethereum and Solana (owner, 2026-10-23) =====================================================
   "Allow users to scan Ethereum and Solana tokens also. Enable all pools on both new chains and use the same scanning
   logic … so all the on-chain data is presented to the users in the same way but the color of the borders on the graphic
   elements use the chains color branding, eg, blue for ethereum, and purple for solana".

   1. The shape of it, in the source: lib/multichain.js (the address classifier, the chain table, what each reading comes
      from), the server's wiring (the chain parameter, the Ethereum retry, the scans_mc store, the chart route), the client
      (the chain table and colours, the gated home-chain-only cards, the pools card, the chart's chain, the Scanner's chooser).
   2. A real server of its own, with EVERY upstream faked from fixtures captured on 2026-10-23 (Dexscreener's token-pairs and
      pair reads, GoPlus's Ethereum and Solana security reads, GeckoTerminal's candles and trades, an Ethereum node's
      eth_call batch, a Solana node's getAccountInfo) and the home chain's node unreachable: a Solana token, an Ethereum
      token, an Ethereum pool, a 0x address the home chain cannot read that trades on Ethereum, a quote asset, nothing,
      the refusals, the recent list, the chart on both chains, and the caches. Everything lives in a temporary directory,
      deleted. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, SERVER_JS } from './_paths.mjs';
const MC = createRequire(import.meta.url)(path.join(ROOT, 'lib', 'multichain.js'));

const SRC = fs.readFileSync(SERVER_JS, 'utf8');
const LIB = fs.readFileSync(path.join(ROOT, 'lib', 'multichain.js'), 'utf8');
const PUB = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const FIX = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'multichain', f), 'utf8'));
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PEPE = '0x6982508145454ce325ddbe47a25d4ec3d2311933', PEPE_V2 = '0xa43fe16908251ee70ef74718545e4fe6c5ccec9f', WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', BONK_ORCA = '5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9';
const NOBODY = '0x1111111111111111111111111111111111111111';

/* ═══ 1. the shape of it ═══ */
{
  const NP = PUB('newpairs.js'), CH = PUB('chart.js'), SC = PUB('scanner.js'), HTML = PUB('newpairs.html'), CSS = PUB('styles.css'), PRIV = PUB('privacy.html'), README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), ENV = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  // the address classifier
  check('a 0x address is the home chain\'s unless Ethereum is named; a Solana address (32 bytes of base58) is only ever Solana\'s; junk and a mismatched hint are refused',
    JSON.stringify(MC.parseAddress(PEPE.toUpperCase().replace('0X', '0x'))) === JSON.stringify({ chain: 'robinhood', addr: PEPE, evm: true })
    && JSON.stringify(MC.parseAddress(PEPE, 'ethereum')) === JSON.stringify({ chain: 'ethereum', addr: PEPE, evm: true })
    && JSON.stringify(MC.parseAddress(BONK)) === JSON.stringify({ chain: 'solana', addr: BONK, evm: false }) && MC.parseAddress(BONK, 'solana').addr === BONK
    && MC.parseAddress(BONK, 'ethereum') === null && MC.parseAddress(PEPE, 'solana') === null && MC.parseAddress('nope') === null && MC.parseAddress('z'.repeat(44)) === null /* 33 bytes */ && MC.parseAddress('a'.repeat(31)) === null && MC.parseAddress('0OIl' + 'a'.repeat(30)) === null);
  check('  ...the base58 decoder is real (BONK decodes to 32 bytes; a 0 is a leading 1)', MC.b58decode(BONK).length === 32 && MC.b58decode('11').length === 2 && MC.b58decode('1' + '1'.repeat(31)).length === 32 && MC.b58decode('0') === null);
  const em = MC.publicMeta('ethereum'), sm = MC.publicMeta('solana'), rm = MC.publicMeta('robinhood');
  check('the chain table: Ethereum is blue (#627eea) and reads Etherscan, Solana is purple (#9945ff) and reads Solscan (accounts, not addresses), the home chain keeps its own colours; the client is never told a URL the server reads from',
    em.color === '#627eea' && em.explorer === 'https://etherscan.io' && em.paths.address === '/address/' && em.ds === 'ethereum' && em.gt === 'eth'
    && sm.color === '#9945ff' && sm.explorer === 'https://solscan.io' && sm.paths.address === '/account/' && sm.evm === false && sm.native === 'SOL'
    && rm.color === null && !('rpc' in em) && !('goplus' in em) && MC.SCAN_CHAINS.join() === 'robinhood,ethereum,solana');
  check('an ERC-20 string is decoded whether ABI-encoded or a bare bytes32', MC.abiString('0x' + '20'.padStart(64, '0') + '4'.padStart(64, '0') + Buffer.from('Pepe').toString('hex').padEnd(64, '0')) === 'Pepe' && MC.abiString('0x' + Buffer.from('PEPE').toString('hex').padEnd(64, '0')) === 'PEPE' && MC.abiString('0x') === null);
  // what each reading comes from, in the source
  check('every pool of the token comes from Dexscreener\'s token-pairs read (pools where the token is what is priced, deepest first), and a pasted pool resolves through its pair read',
    /urls\.ds \+ '\/token-pairs\/v1\/' \+ CHAINS\[slug\]\.ds \+ '\/'/.test(LIB) && /\.filter\(\(d\) => d\.baseToken && sameAddr\(slug, d\.baseToken\.address, tokenAddr\)\)/.test(LIB) && /\.sort\(\(a, b\) => \(b\.liquidityUsd \|\| 0\) - \(a\.liquidityUsd \|\| 0\)\)/.test(LIB)
    && /urls\.ds \+ '\/latest\/dex\/pairs\/' \+ CHAINS\[slug\]\.ds \+ '\/'/.test(LIB) && /kind = 'pool'; pool = addr; tokenAddr = C\.evm \? lc\(pr\.pair\.baseToken\.address\) : String\(pr\.pair\.baseToken\.address\);/.test(LIB) && /address: CHAINS\[slug\]\.evm \? lc\(d\.pairAddress\) : String\(d\.pairAddress\)/.test(LIB));
  check('holders, verification, ownership, taxes and the honeypot verdict (Ethereum) and the authorities, fees and LP burn (Solana) come from GoPlus; name, symbol, decimals and supply from the chain\'s own node — and a supply GoPlus gives in whole tokens is used only when the decimals are known',
    /'\/solana\/token_security\?contract_addresses=' : '\/token_security\/' \+ CHAINS\[slug\]\.goplus/.test(LIB) && /function evmFacts\(g, meta\)/.test(LIB) && /function solFacts\(g, mint, mainPool\)/.test(LIB)
    && /\['0x06fdde03', 'name'\], \['0x95d89b41', 'symbol'\], \['0x313ce567', 'decimals'\], \['0x18160ddd', 'totalSupply'\]/.test(LIB) && /method: 'getAccountInfo', params: \[mint, \{ encoding: 'jsonParsed' \}\]/.test(LIB)
    && (LIB.match(/g\.total_supply && t\.decimals != null\)/g) || []).length === 2);
  check('the profile is the home chain\'s shape (pairFromDex, then the same applyRisk); a vendor\'s honeypot verdict becomes the honeypot flag with its source named, and block 0 is recorded as never read',
    /const pair = pairFromDex\(mainDex, slug\);/.test(LIB) && /applyRisk\(pair, \{\}, \{\}\);/.test(LIB) && /pair\.risk\.honeypotSuspect = true; pair\.risk\.honeypotSource = 'goplus'; if \(riskFinish\) riskFinish\(pair\);/.test(LIB)
    && /\{ snipers: false, block0: false \}/.test(LIB) && /function riskFinish\(e\) \{/.test(SRC));
  check('pools, burn addresses and pool-tagged accounts are not holders; Solana holders are named for what they are (token accounts)',
    /!poolSet\.has\(h\.address\) && !\/\^0x0\{40\}\$\|\^0x0\{36\}dead\$\/\.test\(h\.address\)/.test(LIB) && /kind: C\.evm \? 'wallets' : 'token accounts'/.test(LIB));
  check('the chart: GeckoTerminal\'s candles priced in the pool\'s quote token with the quote\'s dollar price from Dexscreener, its trades as the tape, a 1s ask served as 1m and said so, cached, and the explorer\'s own paths carried for the client',
    /'\/ohlcv\/' \+ gtf \+ '\?aggregate=' \+ agg \+ '&limit=' \+ limit \+ '&currency=token&token=base'/.test(LIB) && /'\/trades\?trade_volume_in_usd_greater_than=0'/.test(LIB)
    && /quoteUsd = d && num\(d\.priceUsd\) && num\(d\.priceNative\) > 0 \? num\(d\.priceUsd\) \/ num\(d\.priceNative\) : null/.test(LIB) && /'1s': \['minute', 1, 60\]/.test(LIB) && /explorer: C\.explorer, explorerPaths: C\.paths/.test(LIB)
    && /chartCache\.set\(key, \{ at: now\(\), v \}\)/.test(LIB) && /swaps: null/.test(LIB));
  // the server
  check('the server reads the module with its own fetchers, risk model and clock, and every upstream URL is env (so this suite can fake them)',
    /const mc = \(\) => _mcInst \|\| \(_mcInst = MC\.createMultichain\(\{ jgetR, applyRisk, pairFromDex, riskFinish, now, urls: MC_URLS \}\)\);/.test(SRC)
    && /ds: process\.env\.MC_DEXSCREENER_URL \|\| 'https:\/\/api\.dexscreener\.com'/.test(SRC) && /ethRpc: process\.env\.ETH_RPC_URL \|\| 'https:\/\/ethereum-rpc\.publicnode\.com'/.test(SRC) && /solRpc: process\.env\.SOL_RPC_URL \|\| 'https:\/\/api\.mainnet-beta\.solana\.com'/.test(SRC)
    && /ETH_RPC_URL=\nSOL_RPC_URL=\nMC_DEXSCREENER_URL=\nMC_GECKO_URL=\nMC_GOPLUS_URL=/.test(ENV));
  check('the scan route takes the address\'s chain (or ?chain=), tries Ethereum for a 0x address the home chain has nothing for or cannot read, and keeps the other chains\' scans in their own (chain, token) store',
    /const parsed = MC\.parseAddress\(url\.searchParams\.get\('address'\), chainQ \|\| null\);/.test(SRC) && /if \(parsed\.chain !== 'robinhood'\) \{/.test(SRC) && (SRC.match(/await tryEthereum\(/g) || []).length === 2
    && /CREATE TABLE IF NOT EXISTS scans_mc \(/.test(SRC) && /PRIMARY KEY \(chain, token_addr\)/.test(SRC) && /function scanRecordMc\(chain, tok, kind, pool, pair, readAt, counted\)/.test(SRC) && /v = v\.concat\(mcRows\)\.sort\(\(a, b\) => b\.lastAt - a\.lastAt\)\.slice\(0, SCAN_RECENT_N\);/.test(SRC));
  check('the chart route serves a pool on another chain from the module; the home chain\'s path is untouched', /if \(chainQ !== 'robinhood'\) \{\s*if \(!MC\.SCAN_CHAINS\.includes\(chainQ\)\) return bad\(res, 'unknown chain'\);/.test(SRC) && /let d = null; try \{ d = await mc\(\)\.candles\(chainQ, pp\.addr, tfq, hoursq\); \}/.test(SRC));
  // the client
  check('the client knows the three chains, their colours and explorers; a profile from another chain wears its chain\'s colour as --tok and --chain, and carries data-chain',
    /ethereum: \{ slug: 'ethereum', name: 'Ethereum', emoji: 'Ξ', color: '#627eea'/.test(NP) && /solana: \{ slug: 'solana', name: 'Solana', emoji: '◎', color: '#9945ff'/.test(NP) && /paths: \{ token: '\/token\/', address: '\/account\/', tx: '\/tx\/' \}/.test(NP)
    && /if \(c\.color\) return '--tok:' \+ c\.color \+ ';--tok-soft:color-mix\(in srgb, ' \+ c\.color \+ ' 14%, transparent\);--chain:' \+ c\.color;/.test(NP) && /data-chain="' \+ esc\(chainOf\(p\)\.slug\) \+ '"/.test(NP) && /CHAIN_META, chainOf,/.test(NP));
  check('  ...the kicker names the chain with a chip; Send Calls, the watchlist, pins and the community slot are the home chain\'s; block 0 and bundlers give way to one honest card; the contract card lists the facts the profile carries; every pool has a chart button',
    /\(foreignChain\(p\) \? ' ·' \+ chainChipHTML\(p\) : ' · ' \+ esc\(chainOf\(p\)\.emoji \+ ' ' \+ chainOf\(p\)\.name\)\)/.test(NP) && /opts\.hideCall \|\| foreignChain\(p\) \|\| !\(window\.COMPOSE/.test(NP) && /window\.Watchlist && !foreignChain\(p\) \?/.test(NP) && /\(foreignChain\(p\) \? '' : pinBtnHTML\(p\)\)/.test(NP)
    && /window\.tokenCommunitySlot && !foreignChain\(p\) \?/.test(NP) && /dashCard\(u, 'chainreads', hc, '⛓️ Chain reads'/.test(NP) && /const cBundles = foreignChain\(p\) \? '' : dashCard/.test(NP)
    && /function chainFactsHTML\(p\)/.test(NP) && /rows\.push\(\['Mint authority', yn\(f\.mintable/.test(NP) && /rows\.push\(\['Honeypot check', yn\(f\.honeypot/.test(NP) && /function poolsHTML\(p, from, to\)/.test(NP) && /const POOLS_SHOWN = 6;/.test(NP) && /data-pool-chart="' \+ esc\(o\.address\) \+ '"/.test(NP)
    && /Send Calls, the watchlist and wall pins work with Robinhood Chain tokens; on ' \+ esc\(chainOf\(p\)\.name\) \+ ' the Scanner reads the profile\./.test(NP));
  check('  ...the honesty copy stays, and the vendor\'s honeypot verdict is said as a vendor\'s reading; a 100 on another chain never waits on block 0; a Solana program is not called "unverified"',
    /never a tip to buy\. Most new tokens go to zero\./.test(NP) && /GoPlus Security's automated check says this token cannot be sold once bought — a vendor's reading, not an audit/.test(NP)
    && /if \(tri === 'ok' && health >= 100 && !sniperOk\(p\) && !foreignChain\(p\)\)/.test(NP) && /if \(!dk\.verified && chainOf\(p\)\.slug !== 'solana'\)/.test(NP) && /Mint and freeze authorities revoked/.test(NP));
  check('the chart host carries its chain: another chain\'s candles are asked with ?chain=, re-asked once a minute instead of a reserves tick, with no markers and no 1s button; the embeds use the chain\'s slugs; a Solana pool address keeps its case',
    /const chainQ = host\.dataset\.chain && host\.dataset\.chain !== 'robinhood' \? 'chain=' \+ encodeURIComponent\(host\.dataset\.chain\) \+ '&' : '';/.test(CH) && /if \(host\.dataset\.chain && host\.dataset\.chain !== 'robinhood'\) return;   \/\/ Send Calls and Sent Its are the home chain's/.test(CH)
    && /host\._tick = setInterval\(\(\) => \{ if \(!document\.hidden && host\.isConnected && host\._visible\) load\(host, true\); \}, every\);/.test(CH) && /TF\.filter\(\(\[k\]\) => !\(k === '1s' && host\.dataset\.chain && host\.dataset\.chain !== 'robinhood'\)\)/.test(CH)
    && /url: \(pair, ds\) => 'https:\/\/dexscreener\.com\/' \+ \(ds \|\| 'robinhood'\) \+ '\/' \+ pair/.test(CH) && /const poolAddr = \(wrap\) =>/.test(CH) && /applySources\(wrap, \{ dexscreener: true, geckoterminal: true \}\); return; \}/.test(CH)
    && /const pAddr = \(data\.explorerPaths && data\.explorerPaths\.address\) \|\| '\/address\/'/.test(CH) && /\(data\.swaps != null \? ', from ' \+ data\.swaps/.test(CH)
    && /data-chain="' \+ esc\(ch\.slug\) \+ '" data-ds="' \+ esc\(ch\.ds \|\| ''\) \+ '" data-gt="' \+ esc\(ch\.gt \|\| ''\) \+ '"/.test(NP) && /data-poll="' \+ \(far \? '60000' : '2000'\) \+ '"/.test(NP) && /📊 Candles<\/button>/.test(NP));
  check('the Scanner takes a Solana address (its case kept), offers Auto / Robinhood Chain / Ethereum / Solana, names the chain in its status, carries a chip\'s chain, and shares ?chain=',
    /const ADDR = \/\^0x\[0-9a-fA-F\]\{40\}\$\/, SOL_ADDR = \/\^\[1-9A-HJ-NP-Za-km-z\]\{32,44\}\$\/;/.test(SC) && /const isAddr = \(s\) => ADDR\.test\(s\) \|\| SOL_ADDR\.test\(s\);/.test(SC) && /localStorage\.getItem\('sc:chain'\)/.test(SC)
    && /const chainQ = SOL_ADDR\.test\(addr\) && !ADDR\.test\(addr\) \? 'solana' : \(chainWant && chainWant !== 'auto' \? chainWant : \(chainPick !== 'auto' \? chainPick : ''\)\);/.test(SC) && /setStatus\('Reading ' \+ where \+ ' for ' \+ shortAddr\(addr\) \+ '…', 'busy'\);/.test(SC)
    && /scan\(b\.getAttribute\('data-scan'\), true, b\.getAttribute\('data-scan-chain'\) \|\| null\);/.test(SC) && /const wantChain = \['robinhood', 'ethereum', 'solana'\]\.includes\(q\.get\('chain'\)\)/.test(SC) && /A 0x address is 42 characters long; a Solana address is 32 to 44 letters and digits/.test(SC)
    && /maxlength="44"/.test(HTML) && /data-chain="auto"/.test(HTML) && /<button class="sc-chain sc-chain--solana" type="button" aria-pressed="false" data-chain="solana"/.test(HTML) && /data-scan-chain="solana"/.test(HTML));
  check('the styles frame another chain\'s dashboard, cards, action bar and chart in the chain\'s colour; the home chain is untouched; the chooser\'s chosen chain takes its colour; every new size is floored',
    /\.tkd\[data-chain="ethereum"\], \.sc-chain--ethereum \{ --chain: #627eea; \}/.test(CSS) && /\.tkd\[data-chain="solana"\], \.sc-chain--solana \{ --chain: #9945ff; \}/.test(CSS)
    && /\.tkd\[data-chain\]:not\(\[data-chain="robinhood"\]\) \.onchain-chart \{ border-color: color-mix\(in srgb, var\(--chain\) 58%, var\(--ink-4\)\); \}/.test(CSS) && /button\.sc-chain--ethereum\.is-on, button\.sc-chain--solana\.is-on \{ background: color-mix\(in srgb, var\(--chain\) 26%, var\(--ink-2\)\); border-color: var\(--chain\);/.test(CSS)
    && !/font-size:\s*(?!max\(var\(--text-floor\))[0-9.]+(rem|px|em)/.test(CSS.slice(CSS.indexOf('/* ===== Chains (owner, 2026-10-23)'))));
  check('the privacy page says what the server asks about a token on another chain (and its version moved); the README and Sendy\'s map say the Scanner reads the three chains',
    /When you scan an Ethereum or Solana token, the server asks the same kind of services about that chain: Dexscreener and GoPlus Security for the token, CoinGecko's GeckoTerminal for its candles and trades, and a public node for that chain/.test(PRIV) && /Version 2026-10-23 · \$Send \/ JustSendIt/.test(PRIV)
    && /on Robinhood Chain, Ethereum or Solana\*\* \(owner, 2026‑10‑23; Ethereum tokens are framed in Ethereum blue, Solana tokens in Solana purple/.test(README) && /paste any token or pool address on Robinhood Chain, Ethereum or Solana for its on-chain profile \(every pool of the token; Ethereum tokens are framed blue, Solana purple\)/.test(SRC));
  check('nothing in the new code tells anyone to buy, and the home chain\'s 0x addresses are still lower-cased while a Solana address never is', !/\bbuy now\b|should buy/i.test(LIB + SC) && /addr: s\.toLowerCase\(\), evm: true/.test(LIB) && /return \{ chain: 'solana', addr: s, evm: false \}/.test(LIB));
}

/* ═══ 2. a server of its own, every upstream faked ═══ */
const hits = {};
const count = (k) => { hits[k] = (hits[k] || 0) + 1; };
const dsPepe = FIX('ds-token-pairs-ethereum-pepe.json'), dsBonk = FIX('ds-token-pairs-solana-bonk.json'), dsPepeV2 = FIX('ds-pair-ethereum-pepe-v2.json'), dsBonkOrca = FIX('ds-pair-solana-bonk-orca.json');
const gpPepe = FIX('goplus-ethereum-pepe.json'), gpBonk = FIX('goplus-solana-bonk.json'), gtOhlcv = FIX('gt-ohlcv-eth-pepe-hour.json'), gtTrades = FIX('gt-trades-eth-pepe.json');
const w256 = (hex) => String(hex).replace(/^0x/, '').padStart(64, '0');
const abiStr = (s) => '0x' + w256('20') + w256((s.length).toString(16)) + Buffer.from(s).toString('hex').padEnd(64, '0');
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const p = u.pathname;
    count(p.split('?')[0]);
    if (p === '/eth') {   // an Ethereum node: the metadata batch for PEPE; anything else unreadable
      let arr = []; try { arr = JSON.parse(body); } catch {}
      if (!Array.isArray(arr)) return send(200, { jsonrpc: '2.0', id: 1, result: '0x' });
      return send(200, arr.map((c) => {
        const to = String((c.params && c.params[0] && c.params[0].to) || '').toLowerCase(), data = (c.params && c.params[0] && c.params[0].data) || '';
        if (to !== PEPE) return { jsonrpc: '2.0', id: c.id, result: '0x' };
        const r = data === '0x06fdde03' ? abiStr('Pepe') : data === '0x95d89b41' ? abiStr('PEPE') : data === '0x313ce567' ? '0x' + w256('12') : data === '0x18160ddd' ? '0x' + w256((420689899999994793799999999999997n).toString(16)) : '0x';
        return { jsonrpc: '2.0', id: c.id, result: r };
      }));
    }
    if (p === '/sol') {   // a Solana node: BONK's mint account; any other address has no account
      let j = {}; try { j = JSON.parse(body); } catch {}
      const mint = j.params && j.params[0];
      if (j.method === 'getAccountInfo' && mint === BONK) return send(200, { jsonrpc: '2.0', id: j.id, result: { context: { slot: 1 }, value: { data: { parsed: { info: { decimals: 5, freezeAuthority: null, isInitialized: true, mintAuthority: null, supply: '8799432013884029428' }, type: 'mint' }, program: 'spl-token', space: 82 }, owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', lamports: 1, executable: false } } });
      return send(200, { jsonrpc: '2.0', id: j.id || 1, result: { context: { slot: 1 }, value: null } });
    }
    if (p.startsWith('/ds/token-pairs/v1/')) {
      const [, , , , chain, addr] = p.split('/');
      if (chain === 'ethereum' && addr.toLowerCase() === PEPE) return send(200, dsPepe);
      if (chain === 'ethereum' && addr.toLowerCase() === WETH) return send(200, dsPepe);   // WETH shows up only as the quote side of these pools
      if (chain === 'solana' && addr === BONK) return send(200, dsBonk);
      return send(200, []);
    }
    if (p.startsWith('/ds/latest/dex/pairs/')) {
      const [, , , , , chain, pool] = p.split('/');
      if (chain === 'ethereum' && pool.toLowerCase() === PEPE_V2) return send(200, dsPepeV2);
      if (chain === 'solana' && pool === BONK_ORCA) return send(200, dsBonkOrca);
      return send(200, { schemaVersion: '1.0.0', pairs: null });
    }
    if (p === '/gp/token_security/1') return send(200, (u.searchParams.get('contract_addresses') || '').toLowerCase() === PEPE ? gpPepe : { code: 1, message: 'OK', result: {} });
    if (p === '/gp/solana/token_security') return send(200, u.searchParams.get('contract_addresses') === BONK ? gpBonk : { code: 1, message: 'ok', result: {} });
    if (/^\/gt\/networks\/(eth|solana)\/pools\/[^/]+\/ohlcv\/(minute|hour|day)$/.test(p)) return send(200, gtOhlcv);
    if (/^\/gt\/networks\/(eth|solana)\/pools\/[^/]+\/trades$/.test(p)) return send(200, gtTrades);
    send(404, { error: 'not here: ' + p });
  });
});
await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
fake.unref();
const FAKE = 'http://127.0.0.1:' + fake.address().port;

const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const PORT = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-mc-'));
// a throwaway data key, written before the server starts (it refuses to invent one over an empty directory); never printed
fs.writeFileSync(path.join(dataDir, '.data_key'), (await import('node:crypto')).randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
const env = { ...process.env, PORT: String(PORT), JSI_DATA_DIR: dataDir, DATA_DIR: dataDir, BASE_URL: 'http://localhost:' + PORT, NODE_ENV: 'test',
  SEED_INVITE_CODE: '12345', TOS_GATE: '1', TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback', SEED_CODES_OPEN: '1',
  DATA_KEY: '', DATA_KEY_FILE: '', BACKUP_DIR: path.join(dataDir, 'backups'), KEY_ROTATE_EXTRA_DBS: '',
  RPC_URL: 'http://127.0.0.1:9/', CHART_SRC_DS_URL: 'http://127.0.0.1:9/', CHART_SRC_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_DS_URL: 'http://127.0.0.1:9/',
  MC_DEXSCREENER_URL: FAKE + '/ds', MC_GECKO_URL: FAKE + '/gt', MC_GOPLUS_URL: FAKE + '/gp', ETH_RPC_URL: FAKE + '/eth', SOL_RPC_URL: FAKE + '/sol',
  OUTBOUND_MAX_WAIT_MS: '2000' };
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
const B = 'http://localhost:' + PORT;
async function api(p) {
  let r; try { r = await fetch(B + p); } catch (e) { throw new Error('fetch failed on ' + p + ': ' + (e && e.cause && e.cause.code || e.message) + ' · server log: ' + log.slice(-400).replace(/\s+/g, ' ')); }
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
try {
  let up = false;
  for (let i = 0; i < 150 && !up; i++) { try { const r = await fetch(B + '/healthz'); up = r.ok; } catch {} if (!up) await sleep(200); }
  check('the server came up with every upstream pointed at the fake', up, log.slice(-300));

  /* ── a Solana token ── */
  const sol = await api('/api/scan?address=' + BONK);
  const sj = sol.j || {}, sp = sj.pair || {};
  check('a Solana address scans as a Solana token: the chain, its purple, Solscan, the profile in the home shape', sol.status === 200 && sj.kind === 'token' && sj.chain === 'solana' && sj.chainMeta && sj.chainMeta.color === '#9945ff'
    && sp.chain === 'solana' && sp.token && sp.token.address === BONK && sp.token.symbol === 'Bonk' && sp.links && sp.links.explorer === 'https://solscan.io/token/' + BONK && sp.indexed === true && sp.risk && typeof sp.risk.health === 'number',
    sol.status + ' ' + JSON.stringify(sj).slice(0, 200));
  check('  ...every pool of the token, deepest first, with its DEX, labels, quote and liquidity', Array.isArray(sj.pools) && sj.pools.length === 4 && sj.pools[0].address === BONK_ORCA && sj.pools[0].dex === 'orca' && sj.pools[0].labels[0] === 'wp' && sj.pools[0].quote.symbol === 'SOL'
    && sj.pools.every((o, i, a) => i === 0 || (a[i - 1].liquidityUsd || 0) >= (o.liquidityUsd || 0)) && JSON.stringify(sp.pools) === JSON.stringify(sj.pools), JSON.stringify(sj.pools || []).slice(0, 200));
  check('  ...holders from GoPlus (the count; the top ten as token accounts, no pool among them), decimals and supply from the chain\'s node, the authorities both revoked', sp.holders && sp.holders.count === 1020153 && sp.holders.source === 'goplus' && sp.holders.kind === 'token accounts'
    && sp.holders.top.length > 0 && sp.holders.top.every((h) => h.address !== BONK_ORCA && h.pct > 0) && sp.token.decimals === 5 && sp.token.totalSupply === '8799432013884029428'
    && sp.chainFacts && sp.chainFacts.mintable === false && sp.chainFacts.freezable === false && sp.token.renounced === true && sp.token.isVerified === null && sp.chainFacts.transferFeePct === 0,
    JSON.stringify({ h: sp.holders && { count: sp.holders.count, kind: sp.holders.kind, n: sp.holders.top && sp.holders.top.length }, dec: sp.token && sp.token.decimals, f: sp.chainFacts }).slice(0, 300));
  check('  ...the risk model records block 0 as never read, nothing is said about the home chain\'s community, and the scan is kept (its count starts at 1)', sp.risk.dataKnown && sp.risk.dataKnown.snipers === false && sj.community === null && sj.scan && sj.scan.kept === true && sj.scan.count === 1, JSON.stringify(sj.scan));

  /* ── an Ethereum token, named ── */
  const eth = await api('/api/scan?address=' + PEPE.toUpperCase().replace('0X', '0x') + '&chain=ethereum');
  const ej = eth.j || {}, ep = ej.pair || {};
  check('a 0x address with ?chain=ethereum scans on Ethereum: blue, Etherscan, name and decimals from the node, verification and ownership from GoPlus', eth.status === 200 && ej.chain === 'ethereum' && ej.chainMeta.color === '#627eea' && ep.token.address === PEPE
    && ep.token.name === 'Pepe' && ep.token.symbol === 'PEPE' && ep.token.decimals === 18 && ep.token.totalSupply === '420689899999994793799999999999997' && ep.token.isVerified === true && ep.token.renounced === true && ep.token.owner === null
    && ep.links.explorer === 'https://etherscan.io/token/' + PEPE && ep.holders.count === 601181 && ep.holders.kind === 'wallets' && ep.holders.top.length >= 8 && !ep.holders.top.some((h) => h.address === PEPE_V2),   // the pool is in GoPlus's ten and is not a holder
    eth.status + ' ' + JSON.stringify({ t: ep.token, h: ep.holders && ep.holders.count }).slice(0, 300));
  check('  ...its pools (a v2, v3s, a v4), its contract facts (no honeypot, no taxes, not mintable), and the same honesty: a 100 is only what could be read', Array.isArray(ej.pools) && ej.pools.length === 4 && ej.pools[0].address === PEPE_V2 && ej.pools[0].dex === 'uniswap' && ej.pools[0].labels[0] === 'v2' && ej.pools.some((o) => o.labels.includes('v3'))
    && ep.chainFacts.honeypot === false && ep.chainFacts.buyTax === 0 && ep.chainFacts.sellTax === 0 && ep.chainFacts.mintable === false && ep.chainFacts.source === 'goplus' && ep.risk.honeypotSuspect === false && ep.risk.dataKnown.verified === true && ep.risk.dataKnown.holders === true,
    JSON.stringify({ pools: (ej.pools || []).map((o) => o.labels), hp: ep.risk && ep.risk.honeypotSuspect, dk: ep.risk && ep.risk.dataKnown, f: ep.chainFacts && { h: ep.chainFacts.honeypot, b: ep.chainFacts.buyTax, s: ep.chainFacts.sellTax, m: ep.chainFacts.mintable, src: ep.chainFacts.source } }).slice(0, 400));

  /* ── a 0x address the home chain cannot read, found on Ethereum ── */
  const auto = await api('/api/scan?address=' + PEPE);
  const aj = auto.j || {};
  check('a bare 0x address is tried on the home chain first; with that node unreachable and the token on Ethereum, its Ethereum profile is served and the answer says why', auto.status === 200 && aj.chain === 'ethereum' && aj.pair && aj.pair.token.address === PEPE
    && /Robinhood Chain could not be read just now; this address trades on Ethereum/.test(aj.note || ''), auto.status + ' ' + JSON.stringify(aj).slice(0, 160));

  /* ── a pool, a quote asset, nothing, refusals ── */
  const pool = await api('/api/scan?address=' + PEPE_V2 + '&chain=ethereum');
  check('a POOL address on Ethereum resolves to the token it prices, and is recorded as a pool scan', pool.status === 200 && pool.j && pool.j.kind === 'pool' && pool.j.pool === PEPE_V2 && pool.j.poolVerified === true && pool.j.pair.token.address === PEPE, pool.status + ' ' + JSON.stringify(pool.j).slice(0, 120));
  const quote = await api('/api/scan?address=' + WETH + '&chain=ethereum');
  check('a quote asset (WETH) is named as one, not profiled', quote.status === 200 && quote.j && quote.j.notFound && quote.j.reason === 'quote' && /base trading asset on Ethereum/.test(quote.j.message), JSON.stringify(quote.j).slice(0, 160));
  const none = await api('/api/scan?address=' + NOBODY + '&chain=ethereum');
  check('an address no pool prices is "not found" on that chain, and the words say the price feed indexes none', none.status === 200 && none.j && none.j.notFound && none.j.reason === 'none' && /No token or pool found at this address on Ethereum/.test(none.j.message), JSON.stringify(none.j).slice(0, 160));
  const both = await api('/api/scan?address=' + NOBODY);
  check('  ...and a bare 0x address that neither the home chain nor Ethereum has is said to be on neither', both.status === 200 && both.j && (both.j.unavailable || both.j.notFound) && (both.j.unavailable ? /couldn’t reach/.test(both.j.message) : /Robinhood Chain or Ethereum/.test(both.j.message)), JSON.stringify(both.j).slice(0, 160));
  const bad1 = await api('/api/scan?address=nope'), bad2 = await api('/api/scan?address=' + BONK + '&chain=ethereum'), bad3 = await api('/api/scan?address=' + PEPE + '&chain=bogus');
  check('junk, a Solana address with ?chain=ethereum, and an unknown chain are refused with a sentence (the 400 still says "valid 0x address")', bad1.status === 400 && /valid 0x address/.test(bad1.j.error) && bad2.status === 400 && bad3.status === 400 && /unknown chain/.test(bad3.j.error), [bad1.status, bad2.status, bad3.status].join(' '));

  /* ── the recent list ── */
  const rec = await api('/api/scan/recent');
  const rl = (rec.j && rec.j.scans) || [];
  check('the public recent list carries the other chains\' scans, each saying its chain, newest first, nine keys and nothing about a person', rec.status === 200 && rl.some((x) => x.chain === 'solana' && x.token === BONK && x.symbol === 'Bonk') && rl.some((x) => x.chain === 'ethereum' && x.token === PEPE)
    && rl.every((x) => Object.keys(x).length === 9 && 'chain' in x) && rl.every((x, i, a) => i === 0 || a[i - 1].lastAt >= x.lastAt), JSON.stringify(rl).slice(0, 200));

  /* ── the chart ── */
  const ch = await api('/api/chart?chain=ethereum&pair=' + PEPE_V2 + '&tf=1h&hours=168');
  const cj = ch.j || {};
  check('a pool\'s chart on Ethereum: GeckoTerminal\'s candles in the pool\'s quote (WETH) with the quote\'s dollar price, its trades as the tape, Etherscan\'s paths, both sources listed', ch.status === 200 && cj.chain === 'ethereum' && cj.tf === '1h' && cj.tfSec === 3600 && Array.isArray(cj.candles) && cj.candles.length === 3 && cj.candles[0].t < cj.candles[1].t && cj.candles[0].c > 0
    && cj.quote === 'WETH' && Math.abs(cj.quoteUsd - Number(dsPepeV2.pairs[0].priceUsd) / Number(dsPepeV2.pairs[0].priceNative)) < 1e-6 && cj.trades.length === 12 && cj.trades[0].ts >= cj.trades[1].ts && typeof cj.trades[0].isBuy === 'boolean' && /^0x[0-9a-f]{40}$/.test(cj.trades[0].wallet) && /^0x[0-9a-f]{64}$/.test(cj.trades[0].hash)
    && cj.explorer === 'https://etherscan.io' && cj.explorerPaths.address === '/address/' && cj.sources.dexscreener === true && cj.sources.geckoterminal === true && cj.swaps === null && /GeckoTerminal/.test(cj.source),
    ch.status + ' ' + JSON.stringify({ n: cj.candles && cj.candles.length, q: cj.quote, qu: cj.quoteUsd, t: cj.trades && cj.trades.length, e: cj.error }));
  const chs = await api('/api/chart?chain=solana&pair=' + BONK_ORCA + '&tf=1s&hours=0.05');
  check('  ...a Solana pool\'s chart keeps the address\'s case, serves a 1s ask as 1m and says so, and links Solscan accounts', chs.status === 200 && chs.j.chain === 'solana' && chs.j.pair === BONK_ORCA && chs.j.tf === '1m' && /one-minute candles/.test(chs.j.note || '') && chs.j.explorerPaths.address === '/account/' && chs.j.quote === 'SOL',
    chs.status + ' ' + JSON.stringify(chs.j).slice(0, 160));
  const chb = await api('/api/chart?chain=bogus&pair=' + PEPE_V2), chb2 = await api('/api/chart?chain=ethereum&pair=nope'), chb3 = await api('/api/chart?pair=nope&token=nope');
  check('  ...an unknown chain or a bad pool is refused; the home chain\'s chart route is as it was', chb.status === 400 && chb2.status === 400 && chb3.status === 400, [chb.status, chb2.status, chb3.status].join(' '));

  /* ── the caches ── */
  await api('/api/scan?address=' + PEPE + '&chain=ethereum'); await api('/api/chart?chain=ethereum&pair=' + PEPE_V2 + '&tf=1h&hours=168');
  check('a second scan and a second chart within the window are answered from the caches: GoPlus asked once per token, GeckoTerminal\'s candles once per pool and width', hits['/gp/token_security/1'] === 1 && hits['/gp/solana/token_security'] === 1 && hits['/gt/networks/eth/pools/' + PEPE_V2 + '/ohlcv/hour'] === 1, JSON.stringify(hits));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  try { server.kill('SIGTERM'); } catch {}
  await sleep(300);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  fake.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
