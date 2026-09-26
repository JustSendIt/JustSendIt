/* tradeLegs — how the wallet tracker decides what a transaction was — run on its own, on hand-built transactions of
   every shape the reviews raised. The function is lifted out of server.js as it is (no copy to drift), with the few
   constants it reads, and fed receipts' Transfer legs in log order. Numbers are small integers so every expected
   cost can be read off the leg list. No server, no chain. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SERVER_JS } from './_paths.mjs';

const SRC = readFileSync(SERVER_JS, 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const grab = (re, name) => { const m = re.exec(SRC); if (!m) throw new Error('could not find ' + name + ' in server.js'); return m[0]; };

const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73', USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const Z = '0x' + '0'.repeat(40), DEAD = '0x000000000000000000000000000000000000dead';
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);                       // the token, and another token
const w = '0x' + '1'.repeat(40), pool = '0x' + '2'.repeat(40), pool2 = '0x' + '6'.repeat(40), router = '0x' + '3'.repeat(40);
const taxWallet = '0x' + '4'.repeat(40), other = '0x' + '5'.repeat(40), vault = '0x' + '7'.repeat(40), bundler = '0x' + '8'.repeat(40);

try {
  const fn = grab(/function tradeLegs\(entry, w, a\) \{[\s\S]*?\n\}\n/, 'tradeLegs');
  const sentBy = grab(/const sentBy = \(e, w\) => [^\n]+/, 'sentBy');
  const ctx = vm.createContext({ BigInt, Math, Map, Set, Infinity, WETH_ADDR: WETH, USDG_ADDR: USDG, ZERO_ADDR: Z, DEAD_ADDR: DEAD });
  vm.runInContext(sentBy + '\n' + fn + '\nthis.tradeLegs = tradeLegs;', ctx);
  const T = (legs, from = w, ops = []) => ctx.tradeLegs({ from, ops, legs: legs.map(([t, f, to, v]) => [t, f, to, BigInt(v)]) }, w, A);
  const buy = (r) => r && r[0] === 1 ? Number(r[1]) + Number(r[2]) : null, sell = (r) => r && r[3] === 1 ? Number(r[4]) + Number(r[5]) : null;

  /* ═══ v2 (paid first, pays out after) ═══ */
  let r = T([[WETH, Z, router, 100], [WETH, router, pool, 100], [A, pool, router, 1000], [A, router, w, 1000]]);
  check('a buy through a router (ETH wrapped, pool → router → wallet) costs what the pool took in', buy(r) === 100 && r[3] === 0, JSON.stringify(r));
  r = T([[WETH, router, pool, 100], [A, pool, A, 50], [A, pool, router, 950], [A, router, w, 950]]);
  check('  ...a taxed buy (the pool pays the token contract its cut first) still costs everything the pool took', buy(r) === 100, JSON.stringify(r));
  r = T([[WETH, router, pool, 100], [A, pool, router, 950], [A, pool, A, 50], [A, router, w, 950]]);
  check('  ...and the same with the tax leg after the buyer\'s', buy(r) === 100, JSON.stringify(r));
  r = T([[WETH, w, pool, 100], [A, pool, w, 1000]]);
  check('a buy straight from the pool', buy(r) === 100, JSON.stringify(r));
  r = T([[A, w, A, 50], [A, w, pool, 950], [WETH, pool, router, 90], [WETH, router, Z, 90]]);
  check('a taxed sell: proceeds are what the pool paid out, the tax leg is part of what was sold, not a sale', sell(r) === 90 && r[0] === 0, JSON.stringify(r));
  r = T([[A, w, A, 50], [A, A, pool, 200], [WETH, pool, router, 20], [A, w, pool, 950], [WETH, pool, other, 90]]);
  check('  ...the token\'s own swap-back in the same transaction is never the seller\'s proceeds', sell(r) === 90, JSON.stringify(r));
  r = T([[WETH, router, pool, 100], [A, pool, taxWallet, 50], [A, pool, router, 950], [A, router, w, 950]]);
  check('buy tax paid straight to a tax wallet (who paid nothing) takes no share of the buyer\'s cost', buy(r) === 100, JSON.stringify(r));
  r = T([[WETH, w, pool, 60], [WETH, other, pool, 40], [A, pool, w, 600], [A, pool, other, 400]]);
  check('  ...but a real co-buyer who paid in shares the swap by tokens', buy(r) === 60, JSON.stringify(r));

  /* ═══ v3 / concentrated liquidity (pays out first, is paid in its callback) ═══ */
  r = T([[A, pool, w, 1000], [WETH, w, pool, 100]]);
  check('a v3 buy (the pool pays first, then is paid) is a buy at what the pool took', buy(r) === 100, JSON.stringify(r));
  r = T([[WETH, pool, router, 90], [A, w, pool, 1000], [WETH, router, Z, 90]]);
  check('a v3 sell with the WETH unwrapped for the wallet is a sell at what the pool paid', sell(r) === 90, JSON.stringify(r));
  r = T([[A, pool, router, 1000], [WETH, Z, router, 100], [WETH, router, pool, 100], [A, router, w, 1000]]);
  check('  ...a v3 buy delivered through a router is counted once, never twice', buy(r) === 100, JSON.stringify(r));
  r = T([[WETH, w, pool, 50], [A, pool, w, 500], [A, pool2, w, 500], [WETH, w, pool2, 50]]);
  check('a buy split across a v2 pool and a v3 pool costs both halves', buy(r) === 100, JSON.stringify(r));

  /* ═══ what is not a trade, or not the wallet's ═══ */
  r = T([[A, other, w, 1000]]);
  check('a transfer from someone else is not a trade', r === null, JSON.stringify(r));
  r = T([[A, w, pool, 1000], [WETH, w, pool, 100]]);
  check('adding liquidity (both coins into the pool, nothing out) is not a sell', r === null || (r[0] === 0 && r[3] === 0), JSON.stringify(r));
  r = T([[A, w, vault, 1000], [B, w, vault, 5], [WETH, vault, w, 90]]);
  check('a shared vault that took another token in the same turn (one WETH payout for two tokens) is marked unvalued, not double-counted', r && r[3] === 1 && (r[7] & 2) === 2 && r[4] === '0', JSON.stringify(r));
  r = T([[WETH, vault, w, 90], [A, w, vault, 1000], [B, vault, w, 5], [WETH, w, vault, 10]]);
  check('  ...while two separate turns through the same vault are two swaps, each valued', sell(r) === 90 && r[7] === 0, JSON.stringify(r));
  r = T([[WETH, other, pool, 100], [A, pool, w, 1000]], bundler);
  check('a swap that paid this wallet in someone else\'s transaction is flagged (cost not the wallet\'s to read)', r && r[0] === 2 && r[1] === '0', JSON.stringify(r));
  r = T([[WETH, w, pool, 100], [A, pool, w, 1000]], bundler, [w]);
  check('  ...unless the wallet is a smart account whose UserOperation ran in it: then it is the wallet\'s own buy', buy(r) === 100, JSON.stringify(r));
  r = T([[A, w, pool, 1000], [WETH, pool, w, 90], [WETH, w, pool2, 50], [A, pool2, w, 400]]);
  check('a sell then a rebuy in one transaction says the sell came first', r && r[0] === 1 && r[3] === 1 && r[6] === 1 && buy(r) === 50 && sell(r) === 90, JSON.stringify(r));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
