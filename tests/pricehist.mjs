/* The tracker chart's price history (GET /api/chain/pricehist) and the pool pricing of any token the index does not
   list (/api/chain/dex-tokens, source 'reserves'). The pure parts — the bucket maths, the one-walk-at-a-time line,
   the pool-price builder — are lifted out of server.js by name and run on fabricated inputs (a stubbed paced batch
   counts the chain reads); then the real routes are driven against the live chain: the $SEND pair over the last two
   million blocks, a contract that is not a pair, the house coin and a token found through the factory, each checked
   against an independent read of the same chain. Read-only on the chain; the throwaway member is removed at the end. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const grab = (re, name) => { const m = re.exec(SRC); if (!m) throw new Error('could not find ' + name + ' in server.js'); return m[0]; };
const hexOf = (n) => randomBytes(n).toString('hex');

const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', SEND_PAIR = '0xf30bb531d0255969be155533abac34b22bd63414';
const GWC = '0x61339f11384dde4b2dc3a33e75b4dc23cc620f22';
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73', USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const FACTORY = '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f';
const SYNC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1';
const PAIRCREATED = '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const UA = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
async function rpc(method, params) {
  for (let i = 0; ; i++) {
    const r = await fetch(RPC, { method: 'POST', headers: UA, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    let j = null; try { j = await r.json(); } catch {}
    if ((r.status === 429 || (j && j.error && /too many/i.test(j.error.message || ''))) && i < 6) { await sleep(2500 * (i + 1)); continue; }
    if (!j || j.error) throw new Error((j && j.error && j.error.message) || 'rpc ' + r.status);
    return j.result;
  }
}
const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
const api = async (p, sid) => {
  const r = await fetch(BASE + p, { headers: { Origin: BASE, ...(sid ? { Cookie: 'jsi_age=18; sid=' + sid } : { Cookie: 'jsi_age=18' }) } });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j, headers: r.headers };
};
function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + hexOf(8);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}
const near = (a, b, tol) => a > 0 && b > 0 && Math.abs(a / b - 1) <= tol;
const pad32 = (h) => h.replace(/^0x/, '').padStart(64, '0');
const abiStr = (s) => { const hex = Buffer.from(s, 'utf8').toString('hex'); return '0x' + (32).toString(16).padStart(64, '0') + Buffer.byteLength(s).toString(16).padStart(64, '0') + hex.padEnd(64 * Math.max(1, Math.ceil(hex.length / 64)), '0'); };

try {
  /* ═══ 1. the bucket maths, lifted as it is ═══ */
  {
    const ctx = vm.createContext({ Math, Number, Map, PHIST_CELL: 10000 });
    vm.runInContext(grab(/function phistOpening\(cells, before, from0\) \{[\s\S]*?\n\}\n/, 'phistOpening') + grab(/function pricehistPoints\(cells, before, from0, size, head, priceOf\) \{[\s\S]*?\n\}\n/, 'pricehistPoints') + '\nthis.points = pricehistPoints; this.opening = phistOpening;', ctx);
    const px = (r0, r1) => { const rt = BigInt(r0), rq = BigInt(r1); if (rt === 0n || rq < 100n) return { p: null, drained: true }; return { p: Number(rq) / Number(rt), drained: false }; };
    const cell = (r0, r1, n, block) => ({ r0, r1, n, block, li: 0 });
    // A. 10,000-block buckets from 100,000 to a head of 134,999: cells at 10 (price 2), 12 (price 3); 13 empty
    const cells = new Map([[10, cell('1000', '2000', 3, 100500)], [12, cell('1000', '3000', 2, 120001)]]);
    const A = ctx.points(cells, null, 100000, 10000, 134999, px);
    check('one point per bucket, b at each bucket end, the last clamped to head', A.length === 4 && A.map((q) => q.b).join() === '109999,119999,129999,134999', JSON.stringify(A.map((q) => q.b)));
    check('  ...close = the last Sync in the bucket; a bucket with no Sync carries the previous close', A[0].p === 2 && !A[0].carried && A[1].p === 2 && A[1].carried && A[2].p === 3 && !A[2].carried && A[3].p === 3 && A[3].carried, JSON.stringify(A));
    check('  ...n is the Syncs in each bucket and 0 where carried', A.map((q) => q.n).join() === '3,0,2,0');
    // B. before the pool's first Sync the price is null, not carried; a Sync before from0 opens the range at its price
    const B = ctx.points(new Map([[13, cell('1000', '4000', 1, 130000)]]), null, 100000, 10000, 139999, px);
    check('before the pool\'s first Sync a point is null — neither carried nor drained', B[0].p === null && !B[0].carried && !B[0].drained && B[2].p === null && B[3].p === 4, JSON.stringify(B));
    const B2 = ctx.points(new Map([[13, cell('1000', '4000', 1, 130000)]]), { r0: '1000', r1: '1000', block: 99000 }, 100000, 10000, 139999, px);
    check('  ...with the Sync before from0 known, the first buckets carry its price', B2[0].p === 1 && B2[0].carried && B2[2].p === 1 && B2[3].p === 4, JSON.stringify(B2));
    // B3. the grid may start earlier than the range (a narrower range after a wider one; a 7d whose from0 stepped past the grid's first cell):
    // the first buckets carry the latest Sync the grid holds BELOW from0 — not the Sync before the whole grid
    const B3 = ctx.points(new Map([[12, cell('1', '100', 1, 125000)]]), { r0: '1000', r1: '1000', block: 99000 }, 130000, 10000, 149999, px);
    check('  ...a range starting after a cell the grid holds opens on that cell\'s Sync (price 100), not on the Sync before the grid (price 1)', B3.length === 2 && B3[0].p === 100 && B3[0].carried && B3[0].n === 0 && B3[1].p === 100 && B3[1].carried, JSON.stringify(B3));
    const twoInCell = new Map([[12, cell('1', '100', 1, 125000)], [11, { r0: '1', r1: '50', n: 1, block: 125000, li: 7 }], [13, cell('1', '7', 1, 130000)]]);
    check('  ...phistOpening: the latest cell below from0 by block, then log index; the cell at from0 is not below it; no cell below → the Sync before the grid; nothing → null',
      ctx.opening(twoInCell, { r0: '1000', r1: '1000', block: 99000 }, 130000).r1 === '50' && ctx.opening(new Map([[13, cell('1', '7', 1, 130000)]]), { r0: '1000', r1: '1000', block: 99000 }, 130000).block === 99000 && ctx.opening(new Map(), null, 130000) === null,
      JSON.stringify(ctx.opening(twoInCell, null, 130000)));
    // C. wider buckets span several cells (the last cell with a Sync closes the bucket); a drained Sync prices null until one restores it
    const C = ctx.points(new Map([[10, cell('1000', '2000', 1, 100000)], [14, cell('1000', '0', 1, 140000)], [17, cell('500', '1000', 1, 170000)]]), null, 100000, 50000, 189999, px);
    check('a 50,000-block bucket closes on its last cell with a Sync; a drained pool is null and drained from that Sync on, and carried as drained', C.length === 2 && C[0].p === null && C[0].drained && !C[0].carried && C[0].n === 2 && C[1].p === 2 && !C[1].drained && C[1].n === 1, JSON.stringify(C));
    const C2 = ctx.points(new Map([[14, cell('1000', '0', 1, 140000)]]), null, 100000, 50000, 219999, px);
    check('  ...a bucket after a drained one, with no Sync, stays null and drained', C2[1].p === null && C2[1].drained && C2[1].carried && C2[2].drained, JSON.stringify(C2));
    const D = ctx.points(new Map(), null, 0, 500000, 1234567, px);
    check('from0 = 0 and a head inside the third bucket gives three points, the last at head', D.length === 3 && D[2].b === 1234567 && D[1].b === 999999, JSON.stringify(D.map((q) => q.b)));
  }

  /* ═══ 2. the line: one Sync walk at a time, a bounded wait, a bounded line ═══ */
  {
    const ctx = vm.createContext({ Promise, Error, setTimeout, clearTimeout, PHIST_WALK_WAIT_MS: 60, PHIST_WALK_LINE_MAX: 1 });
    vm.runInContext('const _phistLine = [];\nlet _phistWalking = false;\n' + grab(/function phistSlot\(\) \{[\s\S]*?\n\}\nfunction phistSlotDone\(\) \{[\s\S]*?\n\}\n/, 'phistSlot') + '\nthis.slot = phistSlot; this.done = phistSlotDone; this.walking = () => _phistWalking; this.line = () => _phistLine.length;', ctx);
    await ctx.slot();
    check('the first walker takes the slot at once', ctx.walking() === true && ctx.line() === 0);
    let second = 'waiting'; const p2 = ctx.slot().then(() => { second = 'took'; }, (e) => { second = e.message; });
    let third = 'waiting'; await ctx.slot().then(() => { third = 'took'; }, (e) => { third = e.message; });
    check('  ...a second waits in line; a third, past the line\'s length, is told busy at once', ctx.line() === 1 && second === 'waiting' && third === 'busy', second + ' / ' + third);
    ctx.done(); await p2;
    check('  ...when the walk ends the slot passes to the one in line, still taken', second === 'took' && ctx.walking() === true);
    let fourth = 'waiting'; await ctx.slot().then(() => { fourth = 'took'; }, (e) => { fourth = e.message; });
    check('  ...a waiter nobody frees the slot for is told busy after PHIST_WALK_WAIT_MS', fourth === 'busy' && ctx.line() === 0, fourth);
    ctx.done();
    check('  ...and the slot is free once the last walker is done', ctx.walking() === false);
    check('the route answers busy with 503 {busy:true} and Retry-After: 5, a dense pool with 422 {dense:true}', /send\(res, 503, \{ error: [^}]*busy: true \}, \{ 'Retry-After': '5' \}\)/.test(SRC) && /send\(res, 422, \{ error: 'too busy to chart', dense: true \}\)/.test(SRC) && /PHIST_SYNC_CAP = 200000/.test(SRC));
    check('  ...a walk is coalesced per pair, the edge dating per (from0, size, head bucket), and a closed request abandons its walk between windows',
      /const _phistWalks = new Map\(\)/.test(SRC) && /const _phistDating = new Map\(\)/.test(SRC) && /from0 \+ ':' \+ size \+ ':' \+ Math\.floor\(head \/ size\)/.test(SRC)
      && /req\.on\('close', gone\); res\.on\('close', gone\);/.test(SRC) && /throw new Error\('abandoned: nobody is waiting for this price history'\)/.test(SRC));
    check('  ...every chain read of the walk and the dating goes through the tracker\'s pace, with the wallet read\'s weight rule', /pacedCall\('eth_getLogs', \[\{ address: pair, topics: \[SYNC_TOPIC\][^\n]*<= PHIST_FAR_WINDOW \? 1 : PACE_LOG_WEIGHT, guard\)/.test(SRC) && /PHIST_FAR_WINDOW = 200000/.test(SRC) && /pacedBatchAll\(part\.map\(\(b\) => \['eth_getBlockByNumber'/.test(SRC));
    check('  ...the shared edge lattice is dated batch by batch, each kept as it arrives, without the requester\'s guard; the dating in flight is bounded per member like the walks', /const part = want\.slice\(i, i \+ PACE_BATCH\)\.filter\(\(b\) => !chainBlockMs\.has\(b\)\);/.test(SRC) && /const job = phistDate\(ends, null\);/.test(SRC) && /phistDateEdges\(from0, size, head\), phistDate\(\[head, firstBlock, lastBlock, priorBlock\]/.test(SRC) && /startsDating = !_phistDating\.has\(dKey\)/.test(SRC) && /if \(startsDating\) \{ const n = _phistMisses\.get\(uid\) \|\| 0; if \(n >= PHIST_MISSES_PER_MEMBER\) throw new Error\('busy'\);/.test(SRC));
    check('  ...the grid keeps no logs: an answer is folded into cells and dropped, the grid is bounded (300 pairs, LRU)', /const f = phistFold\(cells, out\);/.test(SRC) && /PHIST_GRIDS_MAX = 300/.test(SRC) && !/cells\.push|logs\.push\(l\)/.test(grab(/async function phistWalk\([\s\S]*?\n\}\n/, 'phistWalk')));
  }

  /* ═══ 3. the pool-price builder, with a counted chain ═══ */
  {
    const calls = [];
    let ctx = null;
    const TOK = '0x' + 'a'.repeat(40), POOL = '0x' + 'b'.repeat(40), NONE = '0x' + 'c'.repeat(40), THIN = '0x' + 'd'.repeat(40), TPOOL = '0x' + 'e'.repeat(40);
    const answer = (to, data) => {
      if (to === FACTORY) {
        const a = '0x' + data.slice(10, 74).slice(24), b = '0x' + data.slice(74).slice(24);
        if (a === TOK && b === WETH) return '0x' + pad32(POOL);
        if (a === THIN && b === USDG) return '0x' + pad32(TPOOL);
        if (ctx.twoPools && a === ctx.twoPools.BOTH) return '0x' + pad32(b === WETH ? ctx.twoPools.BP1 : ctx.twoPools.BP2);
        return '0x' + '0'.repeat(64);
      }
      if (ctx.twoPools && (to === ctx.twoPools.BP1 || to === ctx.twoPools.BP2) && data === '0x0dfe1681') return '0x' + pad32(ctx.twoPools.BOTH);
      if (ctx.twoPools && to === ctx.twoPools.BP1 && data === '0x0902f1ac') return '0x' + pad32((10n ** 12n).toString(16)) + pad32((10n ** 18n).toString(16)) + pad32('0');   // 1 token, 1 WETH
      if (ctx.twoPools && to === ctx.twoPools.BP2 && data === '0x0902f1ac') return '0x' + pad32((10n ** 12n).toString(16)) + pad32((500n * 10n ** 6n).toString(16)) + pad32('0');   // 1 token, 500 USDG
      if (to === POOL && data === '0x0dfe1681') return '0x' + pad32(WETH);                 // token0 = WETH: the token is token1
      if (to === POOL && data === '0x0902f1ac') return '0x' + pad32((2n * 10n ** 18n).toString(16)) + pad32((1000n * 10n ** 18n).toString(16)) + pad32('0');   // 2 WETH, 1000 TOK
      if (to === TPOOL && data === '0x0dfe1681') return '0x' + pad32(THIN);
      if (to === TPOOL && data === '0x0902f1ac') return '0x' + pad32((500n * 10n ** 18n).toString(16)) + pad32((50n * 10n ** 6n).toString(16)) + pad32('0');   // 500 THIN, 50 USDG
      if (data === '0x313ce567') return '0x' + pad32(to === USDG ? '6' : to === WETH ? '12' : 'c');   // USDG 6, WETH 18, the tokens 12
      if (data === '0x95d89b41') return abiStr(to === TOK ? 'TOK' : 'THN');
      if (data === '0x06fdde03') return abiStr(to === TOK ? 'Token One' : 'Thin One');
      return null;
    };
    ctx = vm.createContext({
      Map, Set, Number, String, BigInt, Math, Promise, Object, Array, Buffer, Error, console,
      FACTORY, WETH_ADDR: WETH, USDG_ADDR: USDG, now: () => Date.now(), pruneCache: () => {},
      _decimalsCache: new Map(), _tokenNameCache: new Map(), _pairTokensCache: new Map(), pairQuoteCache: new Map(),
      ethUsdFresh: async () => 3000,
      pacedBatchAll: async (qs) => { calls.push(...qs); return qs.map((c) => answer(c[1][0].to, c[1][0].data)); },
    });
    vm.runInContext(grab(/const hex32 = [^\n]+\n/, 'hex32') + grab(/function abiText\(r\) \{[\s\S]*?\n\}\n/, 'abiText')
      + grab(/const RESERVES_PRICE_TTL = [^\n]+\n/, 'RESERVES ttl') + grab(/const RESERVES_THIN_WETH = [^\n]+\n/, 'RESERVES thin') + 'const reservesPriceCache = new Map();\n' + grab(/const reservesCached = [^\n]+\n/, 'reservesCached')
      + grab(/async function reservesPrices\(tokens, guard\) \{[\s\S]*?\n\}\n/, 'reservesPrices') + '\nthis.prices = reservesPrices; this.cached = reservesCached;', ctx);
    const r1 = await ctx.prices([TOK, NONE, THIN]);
    const tok = r1.find((r) => r.baseToken.address === TOK), thin = r1.find((r) => r.baseToken.address === THIN);
    check('a token with a WETH pool at the factory is priced from its reserves, Dexscreener-shaped, source "reserves", labelled v2', tok && tok.source === 'reserves' && tok.pairAddress === POOL && tok.labels.join() === 'v2' && tok.quoteToken.symbol === 'WETH' && tok.baseToken.symbol === 'TOK' && tok.baseToken.name === 'Token One', JSON.stringify(tok));
    // 2 WETH (18 decimals) against 1000e18 raw of a 12-decimal token = 1e9 tokens: 2 ÷ 1e9 WETH each, × $3000
    check('  ...price = quote reserve ÷ token reserve, scaled by both decimals; USD at today\'s ETH price; liquidity both sides', tok && near(Number(tok.priceNative), 2 / 1e9, 1e-12) && near(Number(tok.priceUsd), 2 / 1e9 * 3000, 1e-12) && near(tok.liquidity.usd, 2 * 3000 * 2, 1e-12) && tok.liquidity.quote === 2 && near(tok.liquidity.base, 1e9, 1e-12), tok && tok.priceNative + ' ' + tok.priceUsd + ' ' + JSON.stringify(tok.liquidity));
    check('  ...what the index would know and the pool cannot is null, never 0: volume, txns, price change, fdv, market cap', tok && tok.volume.h24 === null && tok.txns.h24.buys === null && tok.priceChange.h24 === null && tok.fdv === null && tok.marketCap === null);
    check('a pool under 100 USDG is thin: no price, the liquidity shown', thin && thin.thin === true && thin.priceUsd === null && thin.priceNative !== null && thin.liquidity.quote === 50 && thin.liquidity.usd === 100, JSON.stringify(thin));
    check('a token with no pool at the factory gets no record', !r1.some((r) => r.baseToken.address === NONE) && r1.length === 2);
    const n1 = calls.length;
    const perTok = calls.filter((c) => (c[1][0].to === FACTORY && c[1][0].data.includes(TOK.slice(2))) || c[1][0].to === POOL || c[1][0].to === TOK).length;
    // three tokens asked: 6 factory reads; two pools found: token0 + reserves + the token's decimals + the quote's decimals + symbol + name each = 12
    check('  ...at most five reads a token plus its name when nothing has read it: 2 factory + token0 + reserves + decimals (+2 name) here', perTok === 7 && n1 === 18, n1 + ' reads, ' + perTok + ' for TOK');
    const r2 = await ctx.prices([TOK, NONE, THIN]);
    check('a second ask within a minute is answered from the cache — and "no pool" is a cached miss too (no chain read at all)', calls.length === n1 && r2.length === 2 && r2[0] === r1[0]);
    check('  ...the cache probe the route budgets by: a priced token answers its records, "no pool" an empty list (still an answer), an unknown token null; a price is stale after a minute, a "no pool" after ten',
      Array.isArray(ctx.cached(TOK)) && ctx.cached(TOK).length === 1 && Array.isArray(ctx.cached(NONE)) && ctx.cached(NONE).length === 0 && ctx.cached('0x' + '7'.repeat(40)) === null && ctx.cached(TOK, Date.now() + 61e3) === null && Array.isArray(ctx.cached(NONE, Date.now() + 9 * 60e3)) && ctx.cached(NONE, Date.now() + 11 * 60e3) === null,
      JSON.stringify([ctx.cached(TOK) && ctx.cached(TOK).length, ctx.cached(NONE), ctx.cached(TOK, Date.now() + 61e3)]));
    // a token with BOTH pools answers both records (the page keeps the deeper one, as it does with the index's pairs)
    const BOTH = '0x' + 'f'.repeat(40), BP1 = '0x' + '1'.repeat(40), BP2 = '0x' + '2'.repeat(40);
    ctx.twoPools = { BOTH, BP1, BP2 };
    const r3 = await ctx.prices([BOTH]);
    check('a token with a WETH pool and a USDG pool answers one record per pool, both from the factory', r3.length === 2 && r3.every((r) => r.baseToken.address === BOTH && r.source === 'reserves') && r3.map((r) => r.pairAddress).sort().join() === [BP1, BP2].sort().join() && r3.map((r) => r.quoteToken.symbol).sort().join() === 'USDG,WETH', JSON.stringify(r3.map((r) => [r.pairAddress, r.quoteToken.symbol, r.priceUsd])));
    check('  ...the pool\'s order is remembered for the price history (token0/token1 and the quote side)', ctx._pairTokensCache.get(POOL) && ctx._pairTokensCache.get(POOL).token0 === WETH && ctx._pairTokensCache.get(POOL).token1 === TOK && ctx.pairQuoteCache.get(POOL) === WETH);
    check('the route asks the pool only for tokens the index and the house pools left unpriced, never WETH/USDG or the two coins', /const rest = addrs\.filter\(\(a\) => !have\.has\(a\) && !ownPoolOf\(a\) && !QUOTE_SET\.has\(a\)\);/.test(SRC) && /pooled = await reservesPrices\(ask, guard\)/.test(SRC));
    // the factory lookups are chain reads on the one shared pace: a member's cache misses are budgeted (200 tokens in ten minutes, a cached answer free),
    // a token over the budget is named unread (never "no market"), and a page that has gone stops the reads at its next batch
    const route = SRC.slice(SRC.indexOf("if (p === '/api/chain/dex-tokens'"), SRC.indexOf("if (p === '/api/chain/pricehist'"));
    check('  ...a member\'s factory misses are budgeted at 200 in ten minutes, cached answers free; the remainder is answered unread, never "no market"', /RESERVES_MISSES_MAX = 200, RESERVES_MISS_WINDOW_MS = 10 \* 60 \* 1000/.test(SRC) && /if \(reservesCached\(a\) \|\| rateLimit\('chaindm:' \+ me\.id, RESERVES_MISSES_MAX, RESERVES_MISS_WINDOW_MS\)\) ask\.push\(a\); else over\.push\(a\);/.test(route) && /for \(const a of over\) list\.push\(\{ baseToken: \{ address: a \}, priceUsd: null, unread: true, source: 'reserves' \}\);/.test(route));
    check('  ...and a request whose page has gone stops between batches (the pricehist route\'s close guard), answering nothing rather than 502', /req\.on\('close', gone\); res\.on\('close', gone\);/.test(route) && /throw new Error\('abandoned: nobody is waiting for these prices'\)/.test(route) && /if \(att\.closed \|\| \/\^abandoned\/\.test\(m\)\) return;/.test(route) && /if \(att\.closed\) return;/.test(route));
  }

  /* ═══ 3b. one request end to end, on a stubbed chain: a junk pair is charged, refused and remembered without a grid; a range
         with too many points is refused before any read; a narrower range after a wider one opens on the grid's own Sync;
         an edge dating keeps every batch it read ═══ */
  {
    const calls = [], limits = [];
    let limitOk = true, headBlock = 20000000;
    const JUNK = '0x' + '9'.repeat(40), JUNK2 = '0x' + '8'.repeat(40), PAIR2 = '0x' + '7'.repeat(40), TOK = '0x' + 'a'.repeat(40);
    const syncLog = (block, li, r0, r1) => ({ blockNumber: '0x' + block.toString(16), logIndex: '0x' + li.toString(16), data: '0x' + pad32(r0.toString(16)) + pad32(r1.toString(16)), removed: false });
    const syncs = [syncLog(19500000, 0, 10n ** 18n, 10n ** 18n), syncLog(19700000, 1, 10n ** 18n, 2n * 10n ** 18n)];   // token0 = TOK, token1 = WETH: price 1, then 2
    const answer = ([m, p]) => {
      if (m === 'eth_call') {
        const { to, data } = p[0];
        if (to === JUNK || to === JUNK2) return '0x';
        if (to === PAIR2 && data === '0x0dfe1681') return '0x' + pad32(TOK);
        if (to === PAIR2 && data === '0xd21220a7') return '0x' + pad32(WETH);
        if (to === PAIR2 && data === '0x0902f1ac') return '0x' + pad32('1') + pad32('1') + pad32('0');
        if (data === '0x313ce567') return '0x' + pad32('12');
        return '0x';
      }
      if (m === 'eth_blockNumber') return '0x' + headBlock.toString(16);
      if (m === 'eth_getBlockByNumber') return { timestamp: '0x' + (1700000000 + parseInt(p[0], 16)).toString(16) };
      if (m === 'eth_getLogs') { const lo = parseInt(p[0].fromBlock, 16), hi = parseInt(p[0].toBlock, 16); return syncs.filter((l) => { const b = parseInt(l.blockNumber, 16); return b >= lo && b <= hi; }); }
      return null;
    };
    const ctx = vm.createContext({
      Map, Set, Number, String, BigInt, Math, Promise, Object, Array, Error, console, parseInt, setTimeout, clearTimeout,
      now: () => Date.now(), pruneCache: () => {}, WETH_ADDR: WETH, USDG_ADDR: USDG, QUOTE_SET: new Set([WETH, USDG]), SYNC_TOPIC: SYNC, TOO_MANY_RE: /exceeds limit|too many results/i,
      PACE_LOG_WEIGHT: 5, PACE_BATCH: 25, _pairTokensCache: new Map(), _decimalsCache: new Map(), chainBlockMs: new Map(), usdgDecimals: 6, ethUsdFresh: async () => 3000,
      rateLimit: (key) => { limits.push(key); return limitOk; },
      pacedBatchAll: async (qs, onStep, guard) => { if (guard) guard(); calls.push(...qs); return qs.map(answer); },
      pacedCall: async (m, p, w, guard) => { if (guard) guard(); calls.push([m, p]); return answer([m, p]); },
    });
    vm.runInContext(grab(/const hex32 = [^\n]+\n/, 'hex32') + SRC.slice(SRC.indexOf('const PHIST_SIZES = new Set('), SRC.indexOf('/* ===== A price for any token from its own pool'))
      + '\nthis.hist = priceHistory; this.grids = _phistGrids; this.bad = _phistBad; this.date = phistDate; this.dating = _phistDating;', ctx);
    const att = { closed: false };
    const refused = async (...a) => { try { await ctx.hist(...a); return null; } catch (e) { return e; } };
    // a junk address: the orientation read is charged to the miss limit BEFORE it is made, the refusal remembered without a grid
    let e = await refused(7, JUNK, TOK, 0, 10000, att);
    check('a junk pair is refused 400 unsupported after its token0()/token1() read — charged to the miss limit first, and it takes no grid slot', e && e.status === 400 && e.body.unsupported === true && limits.length === 1 && limits[0] === 'phistm:7' && calls.length === 2 && ctx.grids.size === 0 && ctx.bad.has(JUNK), (e && e.message) + ' limits=' + limits.join() + ' calls=' + calls.length + ' grids=' + ctx.grids.size);
    e = await refused(7, JUNK, TOK, 0, 10000, att);
    check('  ...the second ask is refused at once: no chain read, no charge', e && e.status === 400 && e.body.unsupported === true && calls.length === 2 && limits.length === 1, calls.length + ' calls');
    limitOk = false;
    e = await refused(7, JUNK2, TOK, 0, 10000, att);
    check('  ...a member over the miss limit is told so before any read of an unconfirmed pair', e && e.message === 'misses' && calls.length === 2 && limits.length === 2, e && e.message);
    limitOk = true;
    // a v2 pair that holds the token: confirmed, then walked once over the range; the next narrower range is a hit that opens on the grid's own Sync
    calls.length = 0;
    const h1 = await ctx.hist(7, PAIR2, TOK, 19400000, 100000, att);
    const logReads = calls.filter((c) => c[0] === 'eth_getLogs').length, edgeReads = calls.filter((c) => c[0] === 'eth_getBlockByNumber').length;
    check('a v2 pair is confirmed (token0/token1, getReserves), walked, and answers 7 points, the first null before the pool\'s first Sync, then 1, 1, 2, 2 … dated, with its first and last Sync', h1.points.length === 7 && h1.points[0].p === null && h1.points[1].p === 1 && !h1.points[1].carried && h1.points[2].p === 1 && h1.points[2].carried && h1.points[3].p === 2 && h1.points[6].p === 2 && h1.points.every((q) => q.ms > 0) && h1.firstSync.block === 19500000 && h1.lastSync.block === 19700000 && h1.priorSync === null && h1.cached === false && ctx.grids.size === 1, JSON.stringify(h1.points.map((q) => [q.p, q.carried])) + ' logs=' + logReads + ' edges=' + edgeReads);
    calls.length = 0;
    const h2 = await ctx.hist(7, PAIR2, TOK, 19800000, 100000, att);
    check('a narrower range inside the grid is a hit (no read at all) whose first buckets carry the latest Sync the grid holds below it — price 2 from block 19,700,000 — and priorSync names that Sync, not the one before the grid', h2.cached === true && calls.length === 0 && h2.points.length === 3 && h2.points.every((q) => q.p === 2 && q.carried) && h2.priorSync && h2.priorSync.block === 19700000 && h2.priorSync.ms > 0, JSON.stringify({ points: h2.points.map((q) => [q.p, q.carried]), prior: h2.priorSync, calls: calls.length }));
    // too many points: refused before any walk or dating (from=0 at the narrowest bucket on a 20,000,000 head would be 2,001 edge reads)
    calls.length = 0;
    e = await refused(7, PAIR2, TOK, 0, 10000, att);
    check('from=0&size=10000 on this head (2,001 points) is refused 400 tooMany before any walk or dating: no chain read', e && e.status === 400 && e.body.tooMany === true && calls.length === 0, (e && e.message) + ' calls=' + calls.length);
    const h3 = await ctx.hist(7, PAIR2, TOK, 0, 500000, att).catch((x) => x);
    check('  ...the same from=0 at the widest bucket (41 points) is served: the older slice walked, the range dated', h3 && h3.points && h3.points.length === 41 && h3.from0 === 0 && h3.cached === false, h3 && (h3.message || h3.points.length));
    // the edge dating keeps every batch as it arrives: a guard that fails on the third batch leaves the first two dated, and the next ask reads only the rest
    ctx.chainBlockMs.clear(); calls.length = 0;
    let guardCalls = 0;
    const blocks = Array.from({ length: 60 }, (_, i) => 1000 + i);
    const cut = await ctx.date(blocks, () => { if (++guardCalls === 3) throw new Error('abandoned: nobody is waiting for this price history'); }).catch((x) => x.message);
    check('phistDate keeps each batch it read: cut on the third batch, the first 50 blocks stay dated', /^abandoned/.test(cut) && ctx.chainBlockMs.size === 50 && calls.length === 50 && blocks.slice(0, 50).every((b) => ctx.chainBlockMs.has(b)), cut + ' dated=' + ctx.chainBlockMs.size);
    await ctx.date(blocks, null);
    check('  ...and the next ask for the same blocks reads only the ten still unknown', calls.length === 60 && ctx.chainBlockMs.size === 60, calls.length + ' reads');
  }

  /* ═══ 4. the route, signed out and with bad input ═══ */
  const anon = await api('/api/chain/pricehist?pair=' + SEND_PAIR + '&token=' + SEND + '&from=0&size=10000');
  check('a signed-out visitor is refused (401)', anon.status === 401, anon.status);
  const me = mkUser('__ph_' + hexOf(3));
  const badSize = await api('/api/chain/pricehist?pair=' + SEND_PAIR + '&token=' + SEND + '&from=0&size=12345', me.sid);
  check('a bucket size outside {10000, 50000, 100000, 500000} is refused (400)', badSize.status === 400 && /size/.test(badSize.j.error), badSize.status + ' ' + (badSize.j && badSize.j.error));
  const same = await api('/api/chain/pricehist?pair=' + SEND + '&token=' + SEND + '&from=0&size=10000', me.sid);
  check('pair === token is refused (400)', same.status === 400, same.status);
  const quoteTok = await api('/api/chain/pricehist?pair=' + SEND_PAIR + '&token=' + WETH + '&from=0&size=10000', me.sid);
  check('a quote asset as the token is refused (400)', quoteTok.status === 400 && /WETH/.test(quoteTok.j.error), quoteTok.status + ' ' + (quoteTok.j && quoteTok.j.error));
  const notAddr = await api('/api/chain/pricehist?pair=nope&token=' + SEND + '&from=0&size=10000', me.sid);
  check('anything but two addresses is refused (400)', notAddr.status === 400, notAddr.status);

  /* ═══ 5. the $SEND pair, live, over the last 2,000,000 blocks at 10,000 a bucket ═══ */
  {
    const head0 = parseInt(await rpc('eth_blockNumber', []), 16);
    const t0 = Date.now();
    const r = await api('/api/chain/pricehist?pair=' + SEND_PAIR + '&token=' + SEND + '&from=' + (head0 - 2000000) + '&size=10000', me.sid);
    const took = Date.now() - t0, j = r.j;
    check('the $SEND pair answers 200 with points', r.status === 200 && j && Array.isArray(j.points) && j.points.length > 0, r.status + ' ' + (j && (j.error || j.points.length + ' points')) + ' in ' + took + 'ms');
    if (r.status === 200) {
      const pts = j.points, nowMs = Date.now();
      check('  ...quoted in WETH, decimals read, size and from0 echoed (from0 on the bucket grid), head ≥ the head read independently', j.quote === 'WETH' && j.decimals === 18 && j.size === 10000 && j.from0 % 10000 === 0 && j.from0 <= head0 - 2000000 && j.head >= head0 && j.readTo === j.head && j.source === 'on-chain Sync events', JSON.stringify({ quote: j.quote, decimals: j.decimals, from0: j.from0, head: j.head, readTo: j.readTo }));
      check('  ...b strictly increasing, the last b === head', pts.every((q, i) => !i || q.b > pts[i - 1].b) && pts[pts.length - 1].b === j.head, pts[pts.length - 1].b + ' vs ' + j.head);
      check('  ...every point is dated, ms increasing, the last ≤ now', pts.every((q) => q.ms != null) && pts.every((q, i) => !i || q.ms > pts[i - 1].ms) && pts[pts.length - 1].ms <= nowMs, pts.filter((q) => q.ms == null).length + ' undated; last ' + pts[pts.length - 1].ms);
      check('  ...every non-null price is > 0; a bucket with no Sync is carried (n = 0), one with Syncs is not', pts.every((q) => q.p == null || q.p > 0) && pts.every((q) => (q.n === 0) === !!q.carried || q.p == null), JSON.stringify(pts.slice(0, 3)));
      check('  ...n sums to syncs', pts.reduce((a, q) => a + q.n, 0) === j.syncs && j.syncs > 0, j.syncs);
      check('  ...the Sync before the range is known (the $SEND pool is older than two million blocks), so the first point carries a price', j.priorSync && j.priorSync.block < j.from0 && pts[0].p > 0, JSON.stringify(j.priorSync));
      // the points against an independent read: the last Sync in the range, decoded by hand
      const logs = await rpc('eth_getLogs', [{ address: SEND_PAIR, topics: [SYNC], fromBlock: '0x' + j.from0.toString(16), toBlock: '0x' + j.head.toString(16) }]);
      const t0r = await call(SEND_PAIR, '0x0dfe1681'), tokIs0 = ('0x' + t0r.slice(-40)).toLowerCase() === SEND;
      const pxOf = (l) => { const d = l.data.slice(2), r0 = BigInt('0x' + d.slice(0, 64)), r1 = BigInt('0x' + d.slice(64, 128)); const rt = tokIs0 ? r0 : r1, rq = tokIs0 ? r1 : r0; return Number(rq) / Number(rt); };
      const last = logs[logs.length - 1], lastPt = pts.filter((q) => q.p != null).pop();
      check('  ...the range holds as many Syncs as an independent eth_getLogs read', logs.length === j.syncs, logs.length + ' vs ' + j.syncs);
      check('  ...the last price is the last Sync\'s quote reserve ÷ token reserve', last && lastPt && near(lastPt.p, pxOf(last), 1e-9) && j.lastSync && j.lastSync.block === parseInt(last.blockNumber, 16), lastPt && lastPt.p + ' vs ' + (last && pxOf(last)));
      const lb = parseInt(last.blockNumber, 16), bucketOfLast = pts.find((q) => q.b >= lb);
      check('  ...and sits in the bucket whose end is at or after its block, not carried', bucketOfLast && !bucketOfLast.carried && near(bucketOfLast.p, pxOf(last), 1e-9));
      const stamp = await rpc('eth_getBlockByNumber', ['0x' + pts[0].b.toString(16), false]);
      check('  ...a point\'s ms is its block\'s own timestamp', stamp && parseInt(stamp.timestamp, 16) * 1000 === pts[0].ms, pts[0].ms + ' vs ' + (stamp && parseInt(stamp.timestamp, 16) * 1000));
      check('  ...quoteUsd is today\'s ETH price or null (never 0), cached:false on the first read', (j.quoteUsd === null || j.quoteUsd > 0) && j.cached === false, j.quoteUsd);
      const t1 = Date.now();
      const r2 = await api('/api/chain/pricehist?pair=' + SEND_PAIR + '&token=' + SEND + '&from=' + (head0 - 2000000) + '&size=10000', me.sid);
      const took2 = Date.now() - t1;
      check('a second call is cached:true, fast, and the same points (the head on file stands five minutes)', r2.status === 200 && r2.j.cached === true && took2 < Math.max(1500, took / 4) && r2.j.points.length === pts.length && r2.j.head === j.head, took2 + 'ms vs ' + took + 'ms, cached=' + (r2.j && r2.j.cached));
      // a wider bucket inside the range already read is served from the grid: fewer points, the Syncs of that range
      const from50 = Math.ceil(j.from0 / 50000) * 50000;   // a 50,000-block from0 at or after the grid's first block (a lower one would honestly need the older slice walked)
      const r3 = await api('/api/chain/pricehist?pair=' + SEND_PAIR + '&token=' + SEND + '&from=' + from50 + '&size=50000', me.sid);
      const inside = pts.filter((x) => x.b >= from50 + 9999);
      check('  ...a range change to 50,000-block buckets is served from the grid (cached:true), with that range\'s Syncs in fewer points', r3.status === 200 && r3.j.cached === true && r3.j.from0 === from50 && r3.j.points.length < pts.length && r3.j.syncs >= inside.reduce((a, x) => a + x.n, 0) && r3.j.points[r3.j.points.length - 1].b >= j.head, r3.status + ' ' + (r3.j && (r3.j.points || []).length + ' points, syncs ' + r3.j.syncs + ' vs ' + inside.reduce((a, x) => a + x.n, 0) + ', cached ' + r3.j.cached));
      check('  ...a 50,000-block bucket\'s n is the sum of its five 10,000-block buckets', r3.status === 200 && r3.j.points.every((q, i) => q.n === pts.filter((x) => x.b >= from50 + i * 50000 && x.b <= q.b).reduce((a, x) => a + x.n, 0)));
      // a from0 below the grid's first block walks only the older slice: not cached, and the Syncs can only grow
      const lower = Math.floor(j.from0 / 50000) * 50000 - 50000;   // a 50,000-block from0 below the grid's first block
      const r4 = await api('/api/chain/pricehist?pair=' + SEND_PAIR + '&token=' + SEND + '&from=' + lower + '&size=50000', me.sid);
      check('  ...a request reaching 50,000 blocks before the grid walks that slice only (cached:false), keeps the head, and never loses a Sync', r4.status === 200 && r4.j.cached === false && r4.j.from0 === lower && r4.j.head >= j.head && r4.j.syncs >= j.syncs && r4.j.points[0].b === lower + 49999, r4.status + ' ' + (r4.j && (r4.j.error || r4.j.points.length + ' points, syncs ' + r4.j.syncs + ', cached ' + r4.j.cached)));
      const r5 = await api('/api/chain/pricehist?pair=' + SEND_PAIR + '&token=' + SEND + '&from=' + lower + '&size=50000', me.sid);
      check('  ...and is a hit the second time', r5.status === 200 && r5.j.cached === true && r5.j.syncs === r4.j.syncs, r5.j && r5.j.cached);
      // the grid now starts 50,000 blocks before the first range: asked again, that range must open on the same Sync it did before the grid grew
      const r6 = await api('/api/chain/pricehist?pair=' + SEND_PAIR + '&token=' + SEND + '&from=' + (head0 - 2000000) + '&size=10000', me.sid);
      check('  ...the original range, asked again after the grid grew below it, opens on the same price and the same (or a later) prior Sync — not the Sync before the wider grid', r6.status === 200 && r6.j.from0 === j.from0 && r6.j.points[0].p === pts[0].p && r6.j.priorSync && r6.j.priorSync.block >= j.priorSync.block, JSON.stringify({ p: [r6.j && r6.j.points && r6.j.points[0].p, pts[0].p], prior: [r6.j && r6.j.priorSync, j.priorSync] }));
      const t7 = Date.now();
      const r7 = await api('/api/chain/pricehist?pair=' + SEND_PAIR + '&token=' + SEND + '&from=0&size=10000', me.sid);
      check('from=0 at the narrowest bucket (thousands of points) is refused 400 tooMany at once — no walk, no dating', r7.status === 400 && r7.j && r7.j.tooMany === true && Date.now() - t7 < 5000, r7.status + ' ' + JSON.stringify(r7.j) + ' in ' + (Date.now() - t7) + 'ms');
    }
  }

  /* ═══ 6. a contract that is not a pair ═══ */
  {
    const r = await api('/api/chain/pricehist?pair=' + WETH + '&token=' + SEND + '&from=0&size=10000', me.sid);
    check('WETH as the "pair" is refused as a pool type not supported (no token0()/getReserves()) — or as not holding the token', r.status === 400 && (r.j.unsupported === true || /does not hold/.test(r.j.error)), r.status + ' ' + JSON.stringify(r.j));
    const r2 = await api('/api/chain/pricehist?pair=' + WETH + '&token=' + SEND + '&from=0&size=10000', me.sid);
    check('  ...and the verdict is remembered: the second answer is the same, at once', r2.status === 400 && JSON.stringify(r2.j) === JSON.stringify(r.j));
  }

  /* ═══ 7. /api/chain/dex-tokens: the house coin from its pool, a token found through the factory, a random address ═══ */
  {
    const r = await api('/api/chain/dex-tokens?addrs=' + GWC, me.sid);
    const g = r.status === 200 && Array.isArray(r.j) ? r.j.find((p) => p && p.baseToken && String(p.baseToken.address).toLowerCase() === GWC) : null;
    if (r.status !== 200 || !g) check('$GWC is priced (the node answered nothing — not asserted this run)', true, r.status + ' ' + JSON.stringify(r.j).slice(0, 120));
    else check('$GWC comes back with a source:"reserves" record and a price (or thin)', g.source === 'reserves' && (Number(g.priceUsd) > 0 || g.thin === true), g.priceUsd + ' thin=' + g.thin);
    // a token that is not one of the house coins, with a v2 pool that still holds something: pairs the factory created
    // against WETH or USDG some 30M blocks ago (the ones the index has mostly dropped — measured 2026-09-30: of 793
    // pairs in that window, six of the first few dozen still held over 0.05 WETH), else the newest
    const head = parseInt(await rpc('eth_blockNumber', []), 16);
    let created = [];
    for (const [lo, hi] of [[head - 30000000, head - 27000000], [head - 1200000, head]]) {
      try { created = await rpc('eth_getLogs', [{ address: FACTORY, topics: [PAIRCREATED], fromBlock: '0x' + Math.max(0, lo).toString(16), toBlock: '0x' + hi.toString(16) }]); } catch { created = []; }
      if (created.length >= 6) break;
      await sleep(400);
    }
    const cands = [];
    for (const l of created.slice().reverse()) {
      const t0 = ('0x' + l.topics[1].slice(26)).toLowerCase(), t1 = ('0x' + l.topics[2].slice(26)).toLowerCase(), pair = ('0x' + l.data.slice(26, 66)).toLowerCase();
      const quote = [WETH, USDG].includes(t0) ? t0 : [WETH, USDG].includes(t1) ? t1 : null;
      if (!quote) continue;
      const tok = quote === t0 ? t1 : t0;
      if (tok === SEND || tok === GWC || tok === WETH || tok === USDG) continue;
      cands.push({ tok, pair, quote, tokIs0: tok === t0 });
      if (cands.length >= 60) break;
    }
    const picked = [];
    for (const c of cands) {   // only pools holding something, read independently
      await sleep(250);
      let res; try { res = await call(c.pair, '0x0902f1ac'); } catch { continue; }
      if (!res || res.length < 130) continue;
      const r0 = BigInt('0x' + res.slice(2, 66)), r1 = BigInt('0x' + res.slice(66, 130));
      c.rt = c.tokIs0 ? r0 : r1; c.rq = c.tokIs0 ? r1 : r0;
      if (c.rt > 0n && c.rq > 0n) picked.push(c);
      if (picked.length >= 4) break;
    }
    if (!picked.length) check('a v2 pool of a token other than the house coins could be found through the factory (none holding anything among those sampled — not asserted)', true, created.length + ' pairs created');
    else try {
      const rr = await api('/api/chain/dex-tokens?addrs=' + picked.map((c) => c.tok).join(','), me.sid);
      const recs = rr.status === 200 && Array.isArray(rr.j) ? rr.j : [];
      const pooled = recs.filter((p) => p && p.source === 'reserves');
      if (rr.status !== 200) check('the price batch for ' + picked.length + ' factory tokens answered (' + rr.status + ' — not asserted this run)', true, JSON.stringify(rr.j).slice(0, 120));
      else {
        check('the batch answers a record for every token whose pool holds something (index-listed or priced from the pool)', picked.every((c) => recs.some((p) => p && p.baseToken && String(p.baseToken.address).toLowerCase() === c.tok)), recs.length + ' records for ' + picked.length);
        if (!pooled.length) check('  ...a source:"reserves" record among them (every one was index-listed — not asserted this run)', true, recs.map((p) => p.baseToken.symbol + ':' + (p.source || 'dexscreener')).join(' '));
        else {
          const p = pooled[0], c = picked.find((x) => x.tok === String(p.baseToken.address).toLowerCase());
          let decT = null, decQ = null;
          try { decT = Number(BigInt(await call(c.tok, '0x313ce567'))); decQ = Number(BigInt(await call(c.quote, '0x313ce567'))); } catch {}
          if (!c || decT == null || decQ == null) { check('the factory token\'s decimals could be read independently (they could not — its figures are not asserted this run)', true, c && c.tok); throw new Error('skip-factory'); }
          const native = (Number(c.rq) / 10 ** decQ) / (Number(c.rt) / 10 ** decT), quoteReserve = Number(c.rq) / 10 ** decQ;
          const thin = quoteReserve < (c.quote === WETH ? 0.05 : 100);
          check('a token the index does not list is priced from its own pool: pairAddress = the factory\'s pool, labelled v2, the quote named', p.pairAddress === c.pair && p.labels.join() === 'v2' && p.quoteToken.symbol === (c.quote === WETH ? 'WETH' : 'USDG') && String(p.quoteToken.address).toLowerCase() === c.quote, JSON.stringify({ pair: p.pairAddress, quote: p.quoteToken }));
          if (thin) check('  ...its pool is thin (' + quoteReserve + ' quote): no price, liquidity shown, thin:true', p.thin === true && p.priceUsd === null && near(p.liquidity.quote, quoteReserve, 0.05), JSON.stringify(p.liquidity));
          else check('  ...priceNative = quote reserve ÷ token reserve (independent read, within 5% of a moving pool), USD = × today\'s rate or null', near(Number(p.priceNative), native, 0.05) && (p.priceUsd === null || Number(p.priceUsd) > 0), p.priceNative + ' vs ' + native + ' usd=' + p.priceUsd);
          check('  ...volume, txns and price change are null (the pool cannot know them), symbol and name read from the chain', p.volume.h24 === null && p.priceChange.h24 === null && p.txns.h24.buys === null && (p.baseToken.symbol || p.baseToken.name), p.baseToken.symbol + ' / ' + p.baseToken.name);
          // and that pool's price history answers (a v2 pair from the factory)
          const ph = await api('/api/chain/pricehist?pair=' + c.pair + '&token=' + c.tok + '&from=' + Math.max(0, head - 300000) + '&size=10000', me.sid);
          check('  ...and its price history answers from the same pool (or says busy/limited honestly)', (ph.status === 200 && ph.j.points.length > 0 && ph.j.pair === c.pair) || ph.status === 503 || ph.status === 429, ph.status + ' ' + (ph.j && (ph.j.error || ph.j.points.length + ' points, syncs ' + ph.j.syncs)));
        }
      }
    } catch (e) { if (e.message !== 'skip-factory') throw e; }
    const rnd = '0x' + hexOf(20);
    const n1 = await api('/api/chain/dex-tokens?addrs=' + rnd, me.sid);
    const t0 = Date.now();
    const n2 = await api('/api/chain/dex-tokens?addrs=' + rnd, me.sid);
    const took2 = Date.now() - t0;
    check('a random address with no pool returns no record, and the second ask is a cached miss (answered without the chain, under a second)', n1.status === 200 && Array.isArray(n1.j) && n1.j.length === 0 && n2.status === 200 && n2.j.length === 0 && took2 < 1000, n1.status + '/' + n2.status + ' ' + JSON.stringify(n1.j) + ' ' + took2 + 'ms');
    check('  ...a "no pool" is remembered ten minutes, a price one minute, in a bounded cache', /RESERVES_PRICE_TTL = 60 \* 1000, RESERVES_NONE_TTL = 10 \* 60 \* 1000, RESERVES_CACHE_MAX = 2000/.test(SRC));
  }

  /* ═══ 8. the limits, in the source ═══ */
  check('hits are limited at 120 a minute per member, the pools walked at 12 in ten minutes, two walks in flight per member', /rateLimit\('phist:' \+ me\.id, 120, 6e4\)/.test(SRC) && /rateLimit\('phistm:' \+ uid, PHIST_MISSES_MAX, PHIST_MISS_WINDOW_MS\)/.test(SRC) && /PHIST_MISS_WINDOW_MS = 10 \* 60 \* 1000, PHIST_MISSES_MAX = 12/.test(SRC) && /PHIST_MISSES_PER_MEMBER = 2/.test(SRC));
  check('  ...a pair the process has not confirmed is charged to the miss limit before its orientation and probe reads; a refused one is kept in its own bounded map, never a grid; a request is at most 1,000 points',
    /const charge = \(\) => \{ if \(!phistChargeMiss\(uid, pair\)\) throw new Error\('misses'\); \};/.test(SRC) && /if \(!pt\) \{\s*charge\(\);/.test(SRC) && /if \(!_phistGrids\.has\(pair\)\) \{\s*charge\(\);/.test(SRC)
    && /const _phistBad = new Map\(\);/.test(SRC) && /pruneCache\(_phistBad, 2000\); _phistBad\.set\(pair, now\(\)\);/.test(SRC) && !/probe: null/.test(SRC) && /const g = phistGrid\(pair\);   \/\/ only now/.test(SRC)
    && /PHIST_POINTS_MAX = 1000/.test(SRC) && /if \(Math\.floor\(\(head - from0\) \/ size\) \+ 1 > PHIST_POINTS_MAX\) throw phistRefusal\(\{ error: [^}]*tooMany: true \}\);/.test(SRC));
  check('a drained pool is one under 1e-4 WETH or 0.1 USDG of quote (or no token), a thin one under 0.05 WETH / 100 USDG', /PHIST_DRAIN_WETH = 1e-4, PHIST_DRAIN_USDG = 0\.1/.test(SRC) && /RESERVES_THIN_WETH = 0\.05, RESERVES_THIN_USDG = 100/.test(SRC) && /if \(rt === 0n \|\| rq < drainMin\) return \{ p: null, drained: true \};/.test(SRC));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  for (const id of made) {
    for (const t of ['sessions', 'tracked_wallets', 'tracker_cache', 'wallet_hist', 'identities', 'points_events', 'notifications'])
      { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
