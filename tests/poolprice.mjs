/* $SEND and $GWC priced from their own pools. The maths is checked on fixed inputs; the live answer is checked
   against an independent read of the same chain (reserves, supply, burned tokens), so every figure the site
   shows for these two coins is one this suite can reproduce. Read-only: nothing is written anywhere. */
import { readFileSync } from 'node:fs';
import { SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const UA = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
// the public node rate-limits bursts (and the server under test has just read the same pools), so back off and retry
async function call(to, data) {
  for (let i = 0; ; i++) {
    const r = await fetch(RPC, { method: 'POST', headers: UA, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
    if (r.status === 429 && i < 6) { await new Promise((ok) => setTimeout(ok, 2000 * (i + 1))); continue; }
    const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
  }
}
const COINS = {
  SEND: { token: '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', pair: '0xf30bb531d0255969be155533abac34b22bd63414' },
  GWC: { token: '0x61339f11384dde4b2dc3a33e75b4dc23cc620f22', pair: '0x22df73eef683a93680dff3b51fdf3ee91e7352d9' },
};
const near = (a, b, tol) => a > 0 && b > 0 && Math.abs(a / b - 1) <= tol;

try {
  /* ═══ 1. the time-weighted median, on fixed inputs ═══ */
  const m = /\nfunction twMedian\(open, path, start, end\) \{[\s\S]*?\n\}\n/.exec(SRC);
  check('the median is one pure function', !!m);
  const twMedian = m ? new Function('return ' + m[0].trim())() : () => NaN;
  const H = 3600e3, S = 0, E = 24 * H;
  check('a pool that did not trade all day sits at its price', twMedian(1, [], S, E) === 1);
  check('a one-hour pump does not move it', twMedian(1, [{ t: 10 * H, p: 10 }, { t: 11 * H, p: 1 }], S, E) === 1);
  check('an eleven-hour pump still does not', twMedian(1, [{ t: 2 * H, p: 10 }, { t: 13 * H, p: 1 }], S, E) === 1);
  check('a move that held for most of the day does', twMedian(1, [{ t: 8 * H, p: 2 }], S, E) === 2);
  check('a dip counts the same way (the lower half)', twMedian(1, [{ t: 4 * H, p: 0.5 }], S, E) === 0.5);
  check('no time, no answer', twMedian(1, [], S, S) === null);

  /* ═══ 2. the rules around it, in the source ═══ */
  check('the guarded price is the LOWER of spot and the median, refused during a 3x spike, and only on a whole day',
    /if \(!st \|\| !\(st\.spot > 0\) \|\| !\(st\.median > 0\) \|\| st\.covered < POOL_WINDOW_MS\) return null;/.test(SRC)
    && /if \(st\.spot > st\.median \* PRICE_MAX_SPIKE\) return null;/.test(SRC) && /return Math\.min\(st\.spot, st\.median\) \* qv\.usd;/.test(SRC));
  check('  ...its dollar rate is the ten-minute-fresh one (quoteValue), never a stale ETH price', /const qv = await quoteValue\(st\.pair, st\.token\);\s+\/\/ quoteValue's ETH rate is null once it is ten minutes old/.test(SRC));
  check('the $100 check, the OG badge, the hold streak and swap rewards all use it',
    /async function sendPriceUsd\(\) \{ return guardedPriceUsd\(TOK\.SEND\); \}/.test(SRC)
    && /gwcPx = await guardedPriceUsd\(TOK\.GWC\)/.test(SRC) && /guardedPriceUsd\(TOK\.SEND\), guardedPriceUsd\(TOK\.GWC\)\]/.test(SRC)
    && /const px = await guardedPriceUsd\(movedTok\);/.test(SRC));
  check('a failed read is never cached', /\.then\(\(v\) => \{ poolStateCache\.set\(k, v\); return v; \}\)\s+\.catch\(/.test(SRC));

  /* ═══ 3. the live answer, against an independent read of the chain ═══ */
  /* A pool-priced figure is null, never guessed, when one of its chain reads was refused (the public node throttles
     bursts, and this suite runs after others that read the chain). The pool read is cached 15 s and a failed part is
     not cached, so ask again after it lapses — twice at most — before judging the figures. */
  let r, j;
  for (let i = 0; i < 3; i++) {
    r = await fetch(BASE + '/api/chain/pairs');
    j = await r.json().catch(() => null);
    const pooled = ((j && j.pairs) || []).filter(p => p && p.source === 'reserves');
    if (!pooled.some(p => p.marketCap == null || p.fdv == null || p.liquidity == null || p.liquidity.usd == null)) break;
    await new Promise(ok => setTimeout(ok, 16000));
  }
  check('/api/chain/pairs answers', r.status === 200 && j && Array.isArray(j.pairs), r.status);
  const byPair = {}; for (const p of (j && j.pairs) || []) if (p && p.pairAddress) byPair[p.pairAddress.toLowerCase()] = p;
  console.log('pairs:', ((j && j.pairs) || []).map((p) => p.baseToken.symbol + ' ' + p.priceUsd + ' src=' + (p.source || 'dexscreener') + ' liq=' + (p.liquidity && p.liquidity.usd) + ' mc=' + p.marketCap + ' vol=' + (p.volume && p.volume.h24) + ' chg=' + (p.priceChange && p.priceChange.h24)).join(' | '), 'check:', JSON.stringify(j && j.checkPrices));
  for (const [sym, c] of Object.entries(COINS)) {
    const p = byPair[c.pair];
    check('$' + sym + ' has a price on the home page cards', p && Number(p.priceUsd) > 0, p ? p.priceUsd : 'missing');
    if (!p) continue;
    const t0 = await call(c.pair, '0x0dfe1681'), res = await call(c.pair, '0x0902f1ac'), ts = await call(c.token, '0x18160ddd');
    const dead = await call(c.token, '0x70a08231' + '000000000000000000000000000000000000dead'.padStart(64, '0'));
    const d = res.slice(2), r0 = BigInt('0x' + d.slice(0, 64)), r1 = BigInt('0x' + d.slice(64, 128));
    const tokIs0 = ('0x' + t0.slice(-40)).toLowerCase() === c.token;
    const rt = Number(tokIs0 ? r0 : r1) / 1e18, rq = Number(tokIs0 ? r1 : r0) / 1e18;
    const native = rq / rt, supply = Number(BigInt(ts)) / 1e18, circ = supply - Number(BigInt(dead)) / 1e18;
    if (p.source === 'reserves') {
      const ethUsd = Number(p.priceUsd) / Number(p.priceNative);
      check('  ...priced from its pool: the price is quote reserve ÷ token reserve', near(Number(p.priceNative), native, 0.02), p.priceNative + ' vs ' + native);
      check('  ...liquidity is both sides of the pool at that price', near(p.liquidity.usd, 2 * rq * ethUsd, 0.02), p.liquidity.usd + ' vs ' + 2 * rq * ethUsd);
      check('  ...FDV is the whole supply, market cap leaves out the burned tokens', near(p.fdv, Number(p.priceUsd) * supply, 0.001) && near(p.marketCap, Number(p.priceUsd) * circ, 0.001), p.fdv + ' / ' + p.marketCap);
      check('  ...and the day\'s trades are counted, not invented', Number.isInteger(p.txns.h24.buys) && Number.isInteger(p.txns.h24.sells) && p.volume.h24 >= 0);
    } else {
      check('  ...listed by Dexscreener, and its price agrees with the pool', near(Number(p.priceNative), native, 0.05), p.priceNative + ' vs ' + native);
    }
    const cp = j.checkPrices && j.checkPrices[sym];
    check('  ...the price the checks use is shown too, and is never above the live price', cp === null || (cp > 0 && cp <= Number(p.priceUsd) * 1.02), cp);
  }
  const src = readFileSync(new URL('../public/chain.js', import.meta.url), 'utf8');
  check('the home page says when a price came from the pool', /src\.hidden = p\.source !== 'reserves'/.test(src));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
