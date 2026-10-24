/* The Scanner's chain pin (owner, 2026-10-23): a 0x address sent with ?chain=robinhood — the page's "Robinhood Chain" button,
   whose tip says "Reads a 0x address on Robinhood Chain only" — is read on Robinhood Chain and nowhere else. It is never handed
   to Ethereum when the home chain cannot read it or has nothing, and its words name only the chain that was looked at. Auto
   (no ?chain) still carries a 0x address on to Ethereum; here the runner points Ethereum's upstreams at a dead address, so Auto
   has nothing of Ethereum's to serve and answers on the home chain. Read-only: nothing here writes a row. */
import { readFileSync } from 'node:fs';
import { SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const SRC = readFileSync(SERVER_JS, 'utf8');
const NOBODY = '0x1111111111111111111111111111111111111111';   // a 0x address no chain has a token or a pool at

async function api(p) {
  const r = await fetch(BASE + p, { redirect: 'manual', headers: { Origin: BASE } });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text };
}
const brief = (r) => r.status + ' ' + JSON.stringify(r.j).slice(0, 220);
const words = (j) => String((j && j.message) || '') + ' ' + String((j && j.reason) || '');

try {
  /* ═══ the route's own text ═══ */
  const from = SRC.indexOf("p === '/api/scan' && req.method === 'GET'"), to = SRC.indexOf("p === '/api/scan/recent'");
  const route = from >= 0 && to > from ? SRC.slice(from, to) : '';
  check('the scan route knows a pin (?chain=robinhood), and tryEthereum stands down at once when it is set — the two call sites untouched',
    /const pinned = chainQ === 'robinhood';/.test(route) && /const tryEthereum = async \(why\) => \{[^\n]*\n\s*if \(pinned\) return false;/.test(route) && (route.match(/if \(await tryEthereum\(/g) || []).length === 2);
  check('  ...and the not-found words are two: pinned names Robinhood Chain alone and no other chain by name; Auto\'s words are the old ones, byte for byte',
    /message: pinned\s*\n?\s*\? 'No token or pool found at this address on Robinhood Chain — the chain says so, and the price feed indexes none\. It may be a wallet, a contract that is not a token, or a token on another chain; Auto tries the other chains an address like this can be on\.'/.test(route)
    && /: 'No token or pool found at this address on Robinhood Chain or Ethereum — the chain says so, and the price feed indexes none\. It may be a wallet, a contract that is not a token, or an address on another chain\. A Solana address scans here too\.' \}\);/.test(route));

  /* ═══ pinned to Robinhood Chain ═══ */
  const pin = await api('/api/scan?address=' + NOBODY + '&chain=robinhood');
  const pj = pin.j || {};
  check('a 0x address pinned to Robinhood Chain is answered on Robinhood Chain — not found or unavailable — with no profile and no "this is its Ethereum profile" note',
    pin.status === 200 && pj.chain === 'robinhood' && (pj.notFound === true || pj.unavailable === true) && !pj.pair && !pj.note && !pj.kind, brief(pin));
  check('  ...and its words never mention Ethereum', pin.status === 200 && !/ethereum/i.test(words(pj)), words(pj).slice(0, 200));
  if (pj.notFound) check('  ...the not-found words name Robinhood Chain as the one chain looked at', /^No token or pool found at this address on Robinhood Chain — /.test(pj.message || ''), pj.message);
  else check('  ...the home chain could not be read this run (' + (pj.reason || 'no reason given') + '), so the pinned not-found wording was not exercised; the unavailable words are checked instead (they judge nothing)',
    pj.unavailable === true && /try again in a moment/.test(pj.message || '') && /couldn’t reach|Lots of scans/.test(pj.message || ''), pj.message);

  /* ═══ Auto: no ?chain ═══ */
  const auto = await api('/api/scan?address=' + NOBODY);
  const aj = auto.j || {};
  check('the same address with no ?chain (Auto) is answered on Robinhood Chain here too — Ethereum\'s upstreams are a dead address in this run, so Ethereum had nothing to serve',
    auto.status === 200 && aj.chain === 'robinhood' && (aj.notFound === true || aj.unavailable === true) && !aj.pair, brief(auto));
  if (aj.notFound) check('  ...and its not-found words are the Auto ones, naming Robinhood Chain or Ethereum', /^No token or pool found at this address on Robinhood Chain or Ethereum — /.test(aj.message || ''), aj.message);
  else check('  ...the home chain could not be read this run (' + (aj.reason || 'no reason given') + '), so the Auto not-found wording was not exercised; the unavailable words are checked instead (they judge nothing)',
    aj.unavailable === true && /try again in a moment/.test(aj.message || '') && /couldn’t reach|Lots of scans/.test(aj.message || ''), aj.message);

  /* ═══ pinned to Ethereum ═══ */
  const eth = await api('/api/scan?address=' + NOBODY + '&chain=ethereum');
  const ej = eth.j || {};
  check('?chain=ethereum with that address is answered on Ethereum — not found or unavailable — never on the home chain',
    eth.status === 200 && ej.chain === 'ethereum' && (ej.notFound === true || ej.unavailable === true) && !ej.pair, brief(eth));
  check('  ...and its words name Ethereum, not Robinhood Chain', eth.status === 200 && /Ethereum/.test(words(ej)) && !/Robinhood Chain/.test(words(ej)), words(ej).slice(0, 200));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
