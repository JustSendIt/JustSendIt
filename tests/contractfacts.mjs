/* ===== A contract's red powers, a renounce that neutralises them, and who holds the LP (owner, 2026-10-24) ===============
   "apply the red flag rule to robinhood too. Also make sure to check if a contract is renounced cause then that negates any
   functions that may have been written in the contract originally. Having it be renounced or owned by a dead address makes it
   so that the developer of the project cannot use any of those functions anymore. Also make sure to check is liquidity is
   locked by checking if the liquidity is owned by a dead address also. Make sure if another address is the owner of the
   contract or liquidity make sure the users can see that contract address."

   1. lib/contractfacts.js on GoPlus's REAL chain-4663 readings of $SEND and $GWC (captured 2026-10-24): the dead addresses,
      the LP split (burned / locker / everyone else, each with its address), and the rule — a power an owner calls is
      neutralised by a real renounce, nothing else is.
   2. The page and the server apply the SAME rule: public/newpairs.js run in a sandbox, its redFactsOf beside redFacts on a
      matrix of profiles, and its list beside RED_EVM word for word.
   3. The server's own pieces, run: lpBurnRead against a stub node, homeOwner, and scanVerdict.
   4. The dashboards, rendered: $SEND as it is (renounced → its blacklist neutralised, the rocket kept; 88% of its LP held by a
      contract, named with a link), the same token with a live owner (Caution, the owner named), and $GWC (all LP burned). */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, SERVER_JS } from './_paths.mjs';
const CF = createRequire(import.meta.url)(path.join(ROOT, 'lib', 'contractfacts.js'));
const SRC = fs.readFileSync(SERVER_JS, 'utf8'), NP = fs.readFileSync(path.join(ROOT, 'public', 'newpairs.js'), 'utf8');
const FIX = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'contractfacts', n), 'utf8')).result;
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', SEND_LP_HOLDER = '0x99e192d330b37d8858d8a32cea7916faf3c22e12', LIVE_OWNER = '0x1234567890abcdef1234567890abcdef12345678';
const gSend = FIX('goplus-4663-send.json'), gGwc = FIX('goplus-4663-gwc.json');

/* ═══ 1. the module ═══ */
{
  check('the dead addresses: the zero address, 0x…dEaD (any case) and 0xdead…42069 — and nothing else', CF.isDead('0x0000000000000000000000000000000000000000') && CF.isDead('0x000000000000000000000000000000000000dEaD') && CF.isDead('0xdEAD000000000000000042069420694206942069')
    && !CF.isDead(SEND_LP_HOLDER) && !CF.isDead('0x000000000000000000000000000000000000beef') && !CF.isDead('') && !CF.isDead(null) && CF.DEAD_ADDRS.size === 3);
  const fs1 = CF.evmFacts(gSend), fg = CF.evmFacts(gGwc);
  check('$SEND as GoPlus reads it on Robinhood Chain: owner the zero address, a blacklist and a whitelist in the code, no mint, no pause, 1% taxes', fs1.owner === '0x0000000000000000000000000000000000000000' && fs1.blacklist === true && fs1.whitelist === true && fs1.mintable === false && fs1.pausable === false
    && fs1.ownerChangeBalance === false && fs1.slippageModifiable === false && fs1.takeBack === false && fs1.hiddenOwner === false && Math.abs(fs1.buyTax - 1) < 1e-9, JSON.stringify(fs1).slice(0, 300));
  check('  ...its LP: 11.54% burned (0x…dEaD; GoPlus also marks it locked, so it is not counted twice), nothing in a locker, 88.08% held by a contract — each holder with its address', Math.abs(fs1.lpBurnedPct - 11.54) < 0.001 && fs1.lpLockerPct === 0 && Math.abs(fs1.lpLockedPct - 11.54) < 0.001
    && fs1.lpTop.some((h) => h.address === SEND_LP_HOLDER && Math.abs(h.pct - 88.0757) < 0.001 && h.contract === true && !h.dead && !h.locked) && fs1.lpTop.every((h) => /^0x[0-9a-f]{40}$/.test(h.address)) && fs1.lpSource === 'goplus', JSON.stringify(fs1.lpTop));
  check('$GWC: every LP token at a dead address — 100% burned', Math.abs(fg.lpBurnedPct - 100) < 1e-9 && fg.lpLockerPct === 0 && fg.lpTop.every((h) => h.dead));
  check('a blank share is unread, never 0; no LP holders listed is unread, never 0; no GoPlus answer is no facts', CF.evmFacts(Object.assign({}, gSend, { lp_holders: [{ address: SEND_LP_HOLDER, percent: '', is_locked: 0 }, { address: '0x000000000000000000000000000000000000dEaD', percent: '' , is_locked: 1 }] })).lpBurnedPct === null
    && CF.evmFacts(Object.assign({}, gSend, { lp_holders: [] })).lpBurnedPct === null && CF.evmFacts(null) === null);
  const prof = (over, factsOver, tokenOver) => Object.assign({ chain: 'robinhood', token: Object.assign({ renounced: true }, tokenOver || {}), chainFacts: Object.assign(CF.evmFacts(gSend), factsOver || {}), risk: {} }, over || {});
  const r1 = CF.redFacts(prof()), r2 = CF.redFacts(prof({}, {}, { renounced: false })), r3 = CF.redFacts(prof({}, { takeBack: true })), r4 = CF.redFacts(prof({}, { hiddenOwner: true, mintable: true }));
  check('the rule: $SEND renounced → its blacklist is neutralised (found nothing); the same code with a live owner → blacklist found', r1.found.length === 0 && r1.neutralised.join() === 'blacklist' && r2.found.join() === 'blacklist' && r2.neutralised.length === 0, JSON.stringify([r1, r2]));
  check('  ...a take-back path or a hidden owner makes the renounce not real: nothing is neutralised, and the path itself is found', r3.found.join() === 'blacklist,takeBack' && r3.neutralised.length === 0 && r4.found.join() === 'mintable,blacklist,hiddenOwner', JSON.stringify([r3, r4]));
  const r5 = CF.redFacts(prof({}, { honeypot: true, cannotSellAll: true, selfdestruct: true, pausable: true }));
  check('  ...what is not an owner\'s call stays red whatever the owner: a honeypot, a sell limit, self-destruct; the owner\'s pause is neutralised', r5.found.join() === 'honeypot,cannotSellAll,selfdestruct' && r5.neutralised.join() === 'blacklist,pausable', JSON.stringify(r5));
  check('  ...a honeypot already on the floor (risk.honeypotSuspect) is not said twice; Solana: a held authority is found, a revoked one is not', CF.redFacts(prof({ risk: { honeypotSuspect: true } }, { honeypot: true }, { renounced: false })).found.join() === 'blacklist'
    && CF.redFacts({ chain: 'solana', chainFacts: { mintable: true, freezable: false } }).found.join() === 'mintable' && CF.redFacts({ chain: 'solana', chainFacts: { mintable: false, freezable: false } }).found.length === 0 && CF.redFacts({ chain: 'robinhood' }).found.length === 0);
  check('the owner-gated powers are exactly the owner\'s calls: mint, blacklist, pause, change balances, change the tax, set one wallet\'s tax, change the trade caps', [...CF.OWNER_GATED].sort().join() === 'antiWhaleModifiable,blacklist,mintable,ownerChangeBalance,pausable,personalSlippage,slippageModifiable');
  // review, 2026-10-24: a proxy's code can be swapped by whoever administers it — a renounced owner() neutralises nothing there
  const rp = CF.redFacts(prof({}, { proxy: true, mintable: true }));
  check('  ...a PROXY is never really renounced: its owner powers stay found (the admin can swap the code), and the page says why', rp.found.join() === 'mintable,blacklist' && rp.neutralised.length === 0 && CF.renouncedReal(prof({}, { proxy: true })) === false, JSON.stringify(rp));
  check('  ...an older stored profile whose owner is 0x…dEaD (renounced stored false, no ownerBurn) counts as renounced', CF.renouncedReal({ token: { owner: '0x000000000000000000000000000000000000dead', renounced: false }, chainFacts: {} }) === true && CF.renouncedReal({ token: { owner: LIVE_OWNER, renounced: false }, chainFacts: {} }) === false);
  check('  ...GoPlus names the pool its LP figures are for (one pool listed), and its LP supply — so a caller can refuse to mix two pools', fs1.lpPool === '0xf30bb531d0255969be155533abac34b22bd63414' && Math.abs(fs1.lpTotalSupply - 19758.5954725548) < 1e-6 && CF.evmFacts(Object.assign({}, gSend, { dex: [{ pair: '0x' + 'a'.repeat(40) }, { pair: '0x' + 'b'.repeat(40) }] })).lpPool === null);
}

/* ═══ 2. the page applies the same rule ═══ */
const noop = () => {}, nil = () => null;
const document = { addEventListener: noop, getElementById: nil, querySelector: nil, querySelectorAll: () => [], body: { classList: { toggle: noop, remove: noop } }, hidden: false };
const window = { document, addEventListener: noop, CSS: { escape: (x) => x } };
const ctx = { window, document, localStorage: { getItem: nil, setItem: noop }, fetch: () => Promise.reject(new Error('offline')), setTimeout, clearTimeout, setInterval: noop, requestAnimationFrame: noop, cancelAnimationFrame: noop, console, CustomEvent: function () {}, Node: {} };
ctx.globalThis = ctx; window.window = window; vm.createContext(ctx); vm.runInContext(NP, ctx);
const NPC = window.NPCard;
{
  check('the page\'s list is the server\'s, key for key and word for word, with the same owner-gated set and dead addresses', JSON.stringify(NPC.VENDOR_EVM) === JSON.stringify(CF.RED_EVM) && NPC.OWNER_GATED.slice().sort().join() === [...CF.OWNER_GATED].sort().join() && NPC.DEAD_ADDRS.slice().sort().join() === [...CF.DEAD_ADDRS].sort().join());
  const KEYS = ['honeypot', 'cannotSellAll', 'cannotBuy', 'mintable', 'blacklist', 'pausable', 'ownerChangeBalance', 'slippageModifiable', 'hiddenOwner', 'takeBack', 'selfdestruct'];
  let n = 0, bad = [];
  for (let mask = 0; mask < 64; mask++) for (const ren of [true, false, null]) for (const chain of ['robinhood', 'ethereum']) for (const hp of [false, true]) {
    const facts = {}; KEYS.forEach((k, i) => { facts[k] = (mask >> (i % 6)) & 1 ? (i < 6 ? true : (mask & 32) ? true : false) : false; });
    const p = { chain, token: { renounced: ren }, chainFacts: facts, risk: { honeypotSuspect: hp } };
    const a = CF.redFacts(p), b = NPC.redFactsOf(p); n++;
    if (a.found.join() !== b.found.join() || a.neutralised.join() !== b.neutralised.join()) bad.push(JSON.stringify({ p, a, b }));
  }
  for (const sol of [{ mintable: true, freezable: true }, { mintable: false, freezable: true }, { mintable: false, freezable: false }]) { const p = { chain: 'solana', token: {}, chainFacts: sol, risk: {} }; const a = CF.redFacts(p), b = NPC.redFactsOf(p); n++; if (a.found.join() !== b.found.join()) bad.push(JSON.stringify({ sol, a, b })); }
  check('on ' + n + ' profiles (every chain, renounced / owned / unread, honeypot flagged or not) the page and the server find and neutralise the same powers', bad.length === 0, bad.slice(0, 2).join(' | '));
}

/* ═══ 3. the server's own pieces, run ═══ */
const grab = (re, what) => { const m = re.exec(SRC); if (!m) throw new Error('could not find ' + what + ' in server.js'); return m[0]; };
{
  check('the server and the page agree on the VERDICT, not just the facts: across triage × thin data × block 0 × red powers × renounced × proxy, the server\'s red Caution is the page\'s red Caution, a worse triage keeps its own word, and neither gives 🚀 or ✅ over a live red power',
    (() => {
      const vb = { CF, Object, Math }; vm.createContext(vb); vm.runInContext(grab(/function scanVerdict\(p\) \{[\s\S]*?\n\}\n/, 'scanVerdict') + 'this.v = scanVerdict;', vb);
      const bad = [];
      for (const triage of ['ok', 'caution', 'high', 'avoid']) for (const thin of [false, true]) for (const sniperOk of [true, null]) for (const red of [[], ['blacklist'], ['selfdestruct']]) for (const ren of [true, false, null]) for (const proxy of [false, true]) {
        const facts = Object.assign(CF.evmFacts(gSend), { blacklist: false, whitelist: false, proxy }); red.forEach((k) => { facts[k] = true; });
        const health = triage === 'ok' ? 100 : triage === 'caution' ? 60 : triage === 'high' ? 30 : 5;
        const p = { chain: 'robinhood', token: { address: SEND, renounced: ren }, chainFacts: facts, risk: { health, triage, thinData: thin, sniperOk, dataKnown: { indexed: !thin, liquidity: true, holders: !thin } }, market: {}, holders: {}, txns: { h24: {} }, pair: {}, volume: {}, priceChange: {} };
        const sv = vb.v(p), pv = NPC.verdictWordOf(p), redFound = CF.redFacts(p).found.length > 0;
        const sRed = sv.word === 'Caution' && /^The contract read reports/.test(sv.note || '');
        if (sRed !== pv.vendor) bad.push({ triage, thin, sniperOk, red, ren, proxy, server: sv.word, page: pv.word });
        if (redFound && (/Send It|^Looks Good$/.test(sv.word) || /Send It|^Looks Good$/.test(pv.word))) bad.push({ green: true, triage, red, ren, proxy, server: sv.word, page: pv.word });
      }
      if (bad.length) console.log('    verdict mismatches:', JSON.stringify(bad.slice(0, 3)));
      return bad.length === 0;
    })());
  check('the server reads the owner and the LP the new way: owner() → dead = renounced and a live owner\'s eth_getCode; the LP at every dead address on-chain, in one batch, kept 15 min; the profile carries chainFacts; the verdict, the Hot Feed and the lazy read apply the rule',
    /const dead = CF\.isDead\(a\);/.test(SRC) && /isContract = MC\.codeKind\(await rpc\('eth_getCode', \[a, 'latest'\]\)\)/.test(SRC) && /async function lpBurnRead\(pair\) \{/.test(SRC) && /const LP_BURN_TTL = 15 \* 60 \* 1000;/.test(SRC)
    && /const chainFacts = g \? CF\.evmFacts\(g\) : null;/.test(SRC) && /lpBurnRead\(t\.pair\),\s+\/\/ the LP at dead addresses/.test(SRC) && (SRC.match(/reserves, ownerInfo, tokenDec, gp, lpBurn\)/g) || []).length === 3 /* the signature and both build sites */
    && /const red = CF\.redFacts\(pp\)\.found;/.test(SRC) && /if \(red\.length && \(r\.triage === 'ok' \|\| r\.triage === 'caution'\)/.test(SRC) && /!CF\.redFacts\(Object\.assign\(\{ chain: 'robinhood' \}, p\)\)\.found\.length\);/.test(SRC)
    && /if \(out\.renounced === true\) \{ const NEUTRAL = new Set\(/.test(SRC) && /const BURN = CF\.DEAD_ADDRS;/.test(SRC));
  // lpBurnRead against a stub node: totalSupply 1e18; 0x0 holds 1000 wei (Uniswap's minimum), 0x…dead 0.25e18, 0xdead…42069 0.05e18
  const calls = [];
  const sb = { CF, now: () => 1e12, pruneCache: noop, BigInt, Number, Map, console,
    rpcBatch: async (cs) => { calls.push(cs); const bal = { '0000000000000000000000000000000000000000': 1000n, '000000000000000000000000000000000000dead': 25n * 10n ** 16n, 'dead000000000000000042069420694206942069': 5n * 10n ** 16n };
      return cs.map(([, [c]]) => c.data === '0x18160ddd' ? '0x' + (10n ** 18n).toString(16) : '0x' + (bal[c.data.slice(-40)] || 0n).toString(16)); } };
  vm.createContext(sb);
  vm.runInContext(grab(/const _lpBurnCache = new Map\(\);[\s\S]*?\nasync function lpBurnRead\(pair\) \{[\s\S]*?\n\}\n/, 'lpBurnRead') + grab(/function homeOwner\(ownerInfo, g\) \{[\s\S]*?\n\}\n/, 'homeOwner') + 'this.lpBurnRead = lpBurnRead; this.homeOwner = homeOwner;', sb);
  const lb = await sb.lpBurnRead('0x' + 'f3'.repeat(20)), again = await sb.lpBurnRead('0x' + 'f3'.repeat(20));
  check('lpBurnRead: totalSupply and every dead address\'s balance in ONE batch; 30% burned (0x…dead 25% + 0xdead…42069 5%; Uniswap\'s 1000-wei minimum at the zero address is NOT counted, on either side); the second ask is kept', lb && Math.abs(lb.burnedPct - 30) < 0.0001 && lb.source === 'chain' && calls.length === 1 && calls[0].length === 4 && again === lb && lb.by.length === 2 && lb.supplyTokens === 1, JSON.stringify(lb));
  sb.rpcBatch = async (cs) => cs.map(([, [c]]) => c.data === '0x18160ddd' ? '0x3e8' : c.data.endsWith('0'.repeat(40)) ? '0x3e8' : '0x0');   // a drained pool: only the 1000-wei minimum left
  const em = await sb.lpBurnRead('0x' + 'e1'.repeat(20));
  check('  ...a pool whose LP was all withdrawn (only Uniswap\'s minimum left) is EMPTIED, never "100% burned"', em && em.emptied === true && em.burnedPct === null, JSON.stringify(em));
  sb.rpcBatch = async () => { throw new Error('Too Many Requests'); };
  check('  ...a node that does not answer is unread (null), never 0% burned', (await sb.lpBurnRead('0x' + 'aa'.repeat(20))) === null);
  // the LP holders' kind from the node: $SEND's 88% holder is an EIP-7702 wallet (0xef0100 + the delegate) — GoPlus calls it a contract
  const kb = { CF, MC: { codeKind: (c) => (typeof c !== 'string' ? null : c === '0x' || /^0xef0100[0-9a-f]{40}$/i.test(c) ? false : true) }, now: () => 1e12, pruneCache: noop, Map, Set, LP_BURN_TTL: 9e5, console,
    rpcBatch: async (cs) => cs.map(([, [a]]) => a === SEND_LP_HOLDER ? '0xef010069007702764179f14f51cdce752f4f775d74e139' : '0x6080604052') };
  vm.createContext(kb);
  vm.runInContext(grab(/const _kindCache = new Map\(\);[\s\S]*?\nasync function addrKinds\(addrs\) \{[\s\S]*?\n\}\n/, 'addrKinds') + grab(/async function markLpKinds\(p\) \{[\s\S]*?\n\}\n/, 'markLpKinds') + 'this.mark = markLpKinds;', kb);
  const kp = { chainFacts: CF.evmFacts(gSend) }; await kb.mark(kp);
  const k99 = kp.chainFacts.lpTop.find((h) => h.address === SEND_LP_HOLDER), k2a = kp.chainFacts.lpTop.find((h) => h.address === '0x2ac03e14cfe755426daaee0a4994184ce81482f8');
  check('markLpKinds asks the node (one eth_getCode batch) and names each live LP holder by its answer: $SEND\'s 88% holder is a WALLET (EIP-7702 delegated), the 0.4% one a contract — dead addresses are not asked', k99.contract === false && k99.kindSource === 'chain' && k2a.contract === true && k2a.kindSource === 'chain' && kp.chainFacts.lpTop.filter((h) => h.dead).every((h) => h.kindSource === undefined), JSON.stringify([k99, k2a]));
  check('the server pieces the review asked for are in place: a GoPlus miss carries the last facts (staleAt); GoPlus\'s honeypot goes on the home floor; GoPlus\'s LP rows only for the profile\'s own pool; the lazy read neutralises only the owner\'s calls, never over a proxy, a take-back, a hidden owner or a source with other access; the LP read on-chain there too; the watchlist applies the rule',
    /if \(!p\.chainFacts\) \{ const prevF = /.test(SRC) && /staleAt: prevF\.chainFacts\.staleAt/.test(SRC) && (SRC.match(/goplusHoneypotFloor\((e|p)\);/g) || []).length === 2 && /e\.risk\.honeypotSuspect = true; e\.risk\.honeypotSource = 'goplus'; riskFinish\(e\);/.test(SRC)
    && /if \(chainFacts\.lpTop && !\(chainFacts\.lpPool === pairA \|\| bySupply\)\)/.test(SRC) && /const NEUTRAL = new Set\(\['mint', 'blacklist', 'pausable', 'fees', 'balance', 'perwallet', 'maxlimits-mod'\]\);/.test(SRC)
    && /gpFlag\(g\.is_proxy\) === true\)/.test(SRC) && /onlyRole\|hasRole\|AccessControl/.test(SRC) && /const lb = await lpBurnRead\(pair\);/.test(SRC)
    && /const r0 = p\.risk \|\| \{\}, red = window\.NPCard && NPCard\.redFactsOf \? NPCard\.redFactsOf\(p\)\.found : \[\];/.test(fs.readFileSync(path.join(ROOT, 'public', 'watchlist.js'), 'utf8')));
  const o1 = sb.homeOwner({ owner: '0x000000000000000000000000000000000000dEaD', renounced: true, isContract: null }, null), o2 = sb.homeOwner({ owner: LIVE_OWNER, renounced: false, isContract: true }, null), o3 = sb.homeOwner({ owner: null, renounced: null }, gSend);
  check('homeOwner: an owner at 0x…dEaD is renounced and kept as ownerBurn (never as a live owner); a live owner keeps its address and kind; with no owner() the GoPlus owner_address answers, said as GoPlus\'s',
    o1.renounced === true && o1.owner === null && o1.ownerBurn === '0x000000000000000000000000000000000000dead' && o2.owner === LIVE_OWNER && o2.ownerIsContract === true && o2.renounced === false && o3.renounced === true && o3.ownerSource === 'goplus' && o3.ownerBurn === '0x0000000000000000000000000000000000000000', JSON.stringify([o1, o2, o3]));
  const vb = { CF, Object, Math }; vm.createContext(vb); vm.runInContext(grab(/function scanVerdict\(p\) \{[\s\S]*?\n\}\n/, 'scanVerdict') + 'this.v = scanVerdict;', vb);
  const base = (renounced) => ({ token: { renounced }, chainFacts: CF.evmFacts(gSend), risk: { health: 100, triage: 'ok', sniperOk: true, thinData: false } });
  check('scanVerdict (the server\'s own verdict — Telegram, the runners): $SEND renounced keeps 🚀; the same code with a live owner is 🟡 Caution naming the blacklist', vb.v(base(true)).word === 'Looks Good, Send It' && vb.v(base(false)).word === 'Caution' && /blacklist/.test(vb.v(base(false)).note), JSON.stringify([vb.v(base(true)).word, vb.v(base(false))]));
}

/* ═══ 4. the dashboards ═══ */
{
  const text = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const home = (tokenOver, factsOver) => ({ chain: 'robinhood', indexed: true,
    token: Object.assign({ address: SEND, name: 'SEND IT', symbol: 'SEND', decimals: 18, totalSupply: '1000000000000000000000000000', isVerified: true, renounced: true, owner: null, ownerBurn: '0x0000000000000000000000000000000000000000', ownerSource: 'chain' }, tokenOver || {}),
    pair: { address: '0xf30bb531d0255969be155533abac34b22bd63414', ageMinutes: 9000, quoteSymbol: 'WETH' }, market: { priceUsd: 0.0002, liquidityUsd: 13653, marketCap: 200000, fdv: 200000 },
    volume: { m5: 1, h1: 10, h6: 100, h24: 5000 }, txns: { h1: { buys: 5, sells: 4 }, h6: { buys: 10, sells: 9 }, h24: { buys: 50, sells: 40 } }, priceChange: { h1: 1, h6: 2, h24: 3 },
    holders: { count: 900, topHolderPct: 5, top10Pct: 30, top: [], source: 'chain', block: 123 }, links: { explorer: 'https://robinhoodchain.blockscout.com/token/' + SEND, dex: 'https://dexscreener.com/robinhood/x' },
    chainFacts: Object.assign(CF.evmFacts(gSend), { lpBurnedPct: 11.54, lpBurnSource: 'chain' }, factsOver || {}, { lpTop: ((factsOver && factsOver.lpTop) || CF.evmFacts(gSend).lpTop).map((h) => h.address === SEND_LP_HOLDER ? Object.assign({}, h, { contract: false, kindSource: 'chain' }) : h) }),
    risk: { health: 100, triage: 'ok', thinData: false, sniperOk: true, dataKnown: { indexed: true, liquidity: true, holders: true, concentration: true, verified: true, snipers: true } } });
  const sendNow = NPC.dashboardHTML(home()), sendT = text(sendNow);
  check('$SEND as it is: renounced to the zero address → still 🚀 Looks Good, Send It; the owner line says where ownership went and that its blacklist can no longer be used; the Contract card says the same on the row',
    /Looks Good, Send It/.test(sendT) && /Ownership renounced — the owner is the zero address 0x0000…0000 nobody holds a key to, so the deployer can no longer change the contract\. Its blacklist function can no longer be used by the owner\./.test(sendT)
    && /Blacklist yes — but ownership is renounced, so the owner can no longer use it/.test(sendT) && /Renounced, so the owner can no longer use its blacklist/.test(sendT), sendT.slice(sendT.indexOf('Ownership renounced') - 20, sendT.indexOf('Ownership renounced') + 260));
  check('  ...its LP: 11.54% burned (read on-chain), nothing in a locker, and 88.08% held by a contract — its address a link to the explorer with a copy button, and the warning that most of the LP is neither burned nor locked',
    /LP burned — held by a dead address 11\.5\d?% read on-chain/.test(sendT) && /LP in a locker \(GoPlus marks it locked\) 0%/.test(sendT) && /Who else holds the LP 0x99e1…2e12 ↗ 📋 88\.\d+% \(a wallet\)/.test(sendT)
    && sendNow.includes('href="https://robinhoodchain.blockscout.com/address/' + SEND_LP_HOLDER + '"') && sendNow.includes('data-copy="' + SEND_LP_HOLDER + '"') && /Most of the LP is neither burned nor in a locker — whoever holds it can pull it \(a contract, only if its code has a way to\)\./.test(sendT), sendT.slice(sendT.indexOf('LP burned'), sendT.indexOf('LP burned') + 300));
  const owned = NPC.dashboardHTML(home({ renounced: false, owner: LIVE_OWNER, ownerBurn: null, ownerIsContract: true })), ownedT = text(owned);
  check('the same code with a LIVE owner: 🟡 Caution naming the blacklist (never the rocket); the owner shown as a link with a copy button, said to be a contract; the Blacklist row red',
    !/Looks Good, Send It/.test(ownedT) && /GoPlus Security reports: blacklist/.test(ownedT) && /Owner 0x1234…5678 ↗ 📋 \(a contract\) — can still change the contract\./.test(ownedT) && owned.includes('href="https://robinhoodchain.blockscout.com/address/' + LIVE_OWNER + '"') && /<b class="tkd-bad">yes — wallets can be blocked<\/b>/.test(owned),
    ownedT.slice(ownedT.indexOf('Owner 0x') - 20, ownedT.indexOf('Owner 0x') + 160));
  const gwc = text(NPC.dashboardHTML(home({ address: '0x61339f11384dde4b2dc3a33e75b4dc23cc620f22', symbol: 'GWC' }, Object.assign(CF.evmFacts(gGwc), { lpBurnedPct: 100, lpBurnSource: 'chain' }))));
  const lpMany = text(NPC.dashboardHTML(home({}, { lpHolders: 14, lpTop: Array.from({ length: 8 }, (_, i) => ({ address: '0x' + String(i + 1).repeat(40).slice(0, 40), pct: i === 7 ? null : 8, dead: false, locked: false, contract: true, tag: null })) })));
  check('every LP holder GoPlus lists is shown (8 here, not 5), a blank share is "share not read" (never dropped), GoPlus\'s own "is a contract" is said as GoPlus\'s, and the list says it is GoPlus\'s top 8 of 14',
    (lpMany.match(/↗ 📋/g) || []).length >= 8 && /share not read/.test(lpMany) && /\(a contract, per GoPlus\)/.test(lpMany) && /GoPlus lists its top 8 of 14 LP holders/.test(lpMany), lpMany.slice(lpMany.indexOf('Who else'), lpMany.indexOf('Who else') + 200));
  const other = text(NPC.dashboardHTML(home({}, { lpTop: null, lpLockerPct: null, lpOtherPool: '0x' + 'ab'.repeat(20) })));
  check('when GoPlus read ANOTHER pool, its locker share and holders are not shown for this one — the card says which pool it read', /not read for this pool — GoPlus read another pool, 0xabab…abab ↗/.test(other) && !/Who else holds the LP/.test(other), other.slice(other.indexOf('LP in a locker'), other.indexOf('LP in a locker') + 140));
  const prox = text(NPC.dashboardHTML(home({}, { proxy: true })));
  check('a renounced PROXY: "Not truly renounced — … the contract is a proxy", the blacklist row red, and no rocket', /Not truly renounced — the owner reads as the zero address 0x0000…0000 ?, but GoPlus Security reads that the contract is a proxy, so whoever administers it can swap its code\./.test(prox) && !/Looks Good, Send It/.test(prox), prox.slice(prox.indexOf('Not truly'), prox.indexOf('Not truly') + 220));
  check('$GWC: 100% of its LP burned; nobody else holds any; no LP warning', /LP burned — held by a dead address 100% read on-chain/.test(gwc) && /Who else holds the LP nobody else among the LP holders GoPlus lists/.test(gwc) && !/neither burned nor in a locker/.test(gwc));
  const eth = text(NPC.dashboardHTML(Object.assign(home({ renounced: true, owner: null, ownerBurn: '0x000000000000000000000000000000000000dead' }), { chain: 'ethereum', pools: [] })));
  const two = text(NPC.dashboardHTML(home({}, { pausable: true })));
  check('several neutralised powers are named as a list ("blacklist and pausable transfers"); an LP holder that is the token\'s own contract is named as that, and a share under 0.1% is "<0.1%", never "0%"',
    /Its blacklist and pausable transfers functions can no longer be used by the owner\./.test(two)
    && /this token’s own contract/.test(text(NPC.dashboardHTML(home({}, { lpTop: [{ address: SEND, pct: 60, dead: false, locked: false, contract: true, tag: null }, { address: SEND_LP_HOLDER, pct: 0.004, dead: false, locked: false, contract: true, tag: null }] })))) && /&lt;0\.1%/.test(text(NPC.dashboardHTML(home({}, { lpTop: [{ address: SEND_LP_HOLDER, pct: 0.004, dead: false, locked: false, contract: true, tag: null }] })))), two.slice(two.indexOf('Its blacklist'), two.indexOf('Its blacklist') + 120));
  check('on Ethereum the same rule: renounced to 0x…dEaD → the blacklist neutralised, the owner line naming the burn address (per GoPlus)', /Ownership renounced — the owner is a burn address 0x0000…dead nobody holds a key to, so the deployer can no longer change the contract \(per GoPlus\)\./.test(eth) && !/GoPlus Security reports: blacklist/.test(eth), eth.slice(eth.indexOf('Ownership renounced'), eth.indexOf('Ownership renounced') + 200));
}

let pass = 0;
for (const [n, ok, extra] of results) { if (ok) pass++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok || !extra ? '' : '\n      ' + extra)); }
console.log(`\n${pass}/${results.length} passed`);
if (pass !== results.length) process.exit(1);
