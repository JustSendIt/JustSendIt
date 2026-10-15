/* Tokens by name (owner, 2026-10-14: "Allow users to search a token by it's name also and pull up all tokens with that name
   even if there is no volume, show the market cap, the volume, and the holder count. in the preview"). The runner points the
   two outside searches (GeckoTerminal, Dexscreener) at a little server of canned answers (tests/run.mjs): an unknown word gets
   empty, healthy answers, "zqfixture" real-shaped ones, "zqhalf" a GeckoTerminal outage. So this drives the real route over the
   site's own records and over real response shapes, with no outside call. Throwaway rows only, removed at the end. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { ROOT, DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const read = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const addr = () => '0x' + randomBytes(20).toString('hex');
const made = { runner: [], cache: [], ledger: [] };
const get = async (q) => { const r = await fetch(BASE + '/api/search/tokens?q=' + encodeURIComponent(q)); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {} return { status: r.status, j, text }; };

try {
  const word = 'zq' + randomBytes(3).toString('hex');   // a name no real token has
  const now = Date.now();
  const A = addr(), B = addr(), C = addr();
  const run = (t, sym, name, mc, liq) => { db.prepare('INSERT INTO runner_tokens (token_addr, pair_addr, symbol, name, first_seen_at, cur_mc, cur_liq, last_seen_at) VALUES (?,?,?,?,?,?,?,?)').run(t, addr(), sym, name, now, mc, liq, now); made.runner.push(t); };
  run(A, word.toUpperCase(), 'The ' + word + ' Coin', 12345, 5000);
  run(B, 'QUIET', word + ' Quiet', null, null);          // a token with no price and no trades still belongs on the list
  db.prepare('INSERT INTO holder_index (token_addr, last_block, holders, status, updated_at) VALUES (?,?,?,?,?)').run(A, 1, 321, 'ok', now); made.ledger.push(A);
  db.prepare('INSERT INTO token_cache (token_addr, pair_json, symbol, name, found, updated_at, last_read_at) VALUES (?,?,?,?,?,?,?)').run(C, JSON.stringify({ market: { marketCap: 999, liquidityUsd: 10 }, volume: { h24: 0 }, holders: { count: 7 }, pair: { address: addr() } }), 'CACHED', word + ' cached', 1, now, now); made.cache.push(C);

  const r = await get(word);
  const it = (r.j && r.j.items) || [];
  const a = it.find((t) => t.token === A), b = it.find((t) => t.token === B), c = it.find((t) => t.token === C);
  check('a name finds every token the site knows by it — a priced one, one with no price or trades, a cached one', r.status === 200 && a && b && c && r.j.total === 3, r.text.slice(0, 300));
  check('  ...the radar\'s figure, labelled "MC/FDV" (the radar keeps a market cap, or the FDV when that is all it had)', a && a.marketCap === 12345 && a.marketCapKind === 'either', JSON.stringify(a));
  check('  ...no volume known is null ("volume unknown"), never a zero nobody reported; a reported 0 stays 0 ("no trades")', a && a.volume24h === null && c && c.volume24h === 0, JSON.stringify([a && a.volume24h, c && c.volume24h]));
  check('  ...holders from the site\'s own chain ledger; a stored count with no read time is not passed off as current', a && a.holders === 321 && a.holdersSource === 'chain' && c && c.holdersSource !== 'scan', JSON.stringify([a, c]));
  check('  ...a token with no price and no trades is listed (market cap and volume unknown), not dropped', b && b.marketCap === null && b.volume24h === null && it.indexOf(b) >= 0, it.map((t) => t.symbol).join(','));
  const sym = await get('$' + word.toUpperCase());
  check('a symbol with its $ works, in any letter case', sym.j && sym.j.items && sym.j.items.some((t) => t.token === A), sym.text.slice(0, 200));
  const none = await get(word + 'nomatch');
  check('a name nothing has gives an empty list, not an error', none.status === 200 && none.j && none.j.items.length === 0 && none.j.total === 0, none.text.slice(0, 200));
  const pct = await get('%_');
  check('wildcards are words, not wildcards: "%_" does not list every token', pct.status === 200 && pct.j && !pct.j.items.some((t) => t.token === A || t.token === B), pct.text.slice(0, 200));
  const short = await get('z'), anAddr = await get(A);
  const partialAddr = await get('0x1234'), dollarS = await get('$s');
  check('one character, an address or the start of one (the address search\'s job) lists nothing here, and says why', short.j && short.j.tooShort === true && dollarS.j && dollarS.j.tooShort === true && anAddr.j && anAddr.j.address === true && partialAddr.j && partialAddr.j.address === true, [short.text, dollarS.text, anAddr.text, partialAddr.text].join(' | '));

  // real response shapes, from the runner's canned answers
  const fx = await get('zqfixture');
  const byS = (sym) => ((fx.j && fx.j.items) || []).find((t) => t.symbol === sym);
  check('a Uniswap v4 pool (a 32-byte id) counts: its token is listed', byS('ZQV4') && byS('ZQV4').volume24h === 5000 && byS('ZQV4').marketCap === 12000 && byS('ZQV4').marketCapKind === 'fdv', fx.text.slice(0, 400));
  check('  ...a name GeckoTerminal sends HTML-escaped is decoded once ("S&P", not "S&amp;P")', byS('ZQSP') && byS('ZQSP').name === 'S&P Zqfixture', JSON.stringify(byS('ZQSP')));
  check('  ...an FDV of "0.0" is unknown, and the other source\'s true market cap is used; one pool from two sources is counted once', byS('ZQSP') && byS('ZQSP').marketCap === 8000 && byS('ZQSP').marketCapKind === 'mcap' && byS('ZQSP').pools === 1 && byS('ZQSP').volume24h === 650 && byS('ZQSP').sources.includes('geckoterminal') && byS('ZQSP').sources.includes('dexscreener'), JSON.stringify(byS('ZQSP')));
  check('  ...USDG (what tokens trade against) is not a result', !byS('USDG'), fx.text.slice(0, 300));
  check('  ...a name thousands of characters long is cut at 120, and the answer says it was', byS('ZQLONG') && Array.from(byS('ZQLONG').name).length === 120 && byS('ZQLONG').nameCut === true, JSON.stringify(byS('ZQLONG') && byS('ZQLONG').name.length));
  check('  ...both sources answered: nothing is marked missing', fx.j && Array.isArray(fx.j.partial) && fx.j.partial.length === 0, JSON.stringify(fx.j && fx.j.partial));
  const half = await get('zqhalf');
  check('when GeckoTerminal cannot be asked, the answer says so (partial) — never a plain "no token"', half.j && Array.isArray(half.j.partial) && half.j.partial.includes('GeckoTerminal') && half.j.items.length === 0 && !half.j.error, half.text);

  // the outside searches: Robinhood Chain only, from the server, with a short wait, kept three minutes, rate-limited per visitor
  check('the outside searches are narrowed to Robinhood Chain (GeckoTerminal network=robinhood; Dexscreener pairs kept to chainId robinhood)',
    /tokSearchAsk\('search:geckoterminal', TOKSEARCH_GT_URL \+ '\?query=' \+ encodeURIComponent\(q\) \+ '&network=robinhood&include=base_token&page=1'\)/.test(SRC) && /if \(!p \|\| p\.chainId !== 'robinhood' \|\| !p\.baseToken\) continue;/.test(SRC));
  check('  ...hold a person waiting for at most 1.5 s of our outbound meter, from the search\'s own small share of each vendor (the dashboards and the chart switch keep the rest)', /jgetR\(TOKSEARCH_DS_URL \+ '\?q=' \+ encodeURIComponent\(q\), 1500\)/.test(SRC) && /async function jgetR\(url, maxWait\)/.test(SRC)
    && /'search:geckoterminal': 4,/.test(SRC) && /'search:goplus': 8,/.test(SRC) && /await outboundTake\('search:goplus', 0\);/.test(SRC) && /goplusToken\(t\.token, \{ maxWait: 500, absent: true \}\)/.test(SRC));
  check('  ...answers are kept three minutes, holders an hour ("GoPlus has none" ten minutes, not pending); the route is rate-limited per visitor, with Retry-After', /TOKSEARCH_TTL = 180e3/.test(SRC) && /TOK_HOLDER_TTL = 3600e3;/.test(SRC) && /rateLimit\('toksearch:' \+ clientIp\(req\), 30, 6e4\)/.test(SRC) && /'Retry-After': '15'/.test(SRC) && /c\.n == null \? 10 \* 60e3 : TOK_HOLDER_TTL/.test(SRC));
  check('  ...and a token is listed only when its name or symbol holds the words (an outside index\'s fuzzy hits are dropped)', /const hit = \(t\) => \(t\.name \|\| ''\)\.normalize\('NFC'\)\.toLowerCase\(\)\.includes\(ql\) \|\| \(t\.symbol \|\| ''\)\.normalize\('NFC'\)\.toLowerCase\(\)\.includes\(ql\);/.test(SRC));

  // the three places a name can be typed
  const SJ = read('search.js'), NJ = read('newpairs.js'), SC = read('scanner.js'), HTML = read('newpairs.html'), PRIV = read('privacy.html');
  check('the menu search lists tokens by name under the senders, each row with market cap, 24h volume and holders, opening its dashboard',
    /if \(named\) drop\.appendChild\(tokSection\(q\)\);/.test(SJ) && /fetch\('\/api\/search\/tokens\?q=' \+ encodeURIComponent\(q\), \{ credentials: 'same-origin' \}\)/.test(SJ) && /'MC '/.test(SJ) && /'no trades in 24h'/.test(SJ) && /' holders'/.test(SJ) && /'\/newpairs\.html\?scan=' \+ encodeURIComponent\(t\.token\)/.test(SJ)
    && /tokDebounce = setTimeout\(\(\) => \{ if \(current\(\) === q\) askTokens\(q\); \}, 700\);/.test(SJ));
  check('  ...holders still being read are filled in by up to three follow-ups (3.5, 7, 14 s), in place; a failed or empty one changes nothing', /3500 \* Math\.pow\(2, n\)/.test(SJ) && /if \(!live\(\) \|\| k\.error \|\| !Array\.isArray\(k\.items\) \|\| !k\.items\.length\) return;/.test(SJ) && /el\.textContent = tokStats\(t, !!ans\.pending\)/.test(SJ));
  check('  ...a half answer is never "no token": it names the source that could not be asked; an error is shown, never kept', /could not be asked just now — this list may be missing tokens\./.test(SJ) && /shown, never kept: the next keystroke or the retry asks again/.test(SJ) && /'Too many token searches in the last minute — trying again in a few seconds\.'/.test(SJ));
  check('the Scanner\'s box takes a name too (and ?scan=<name> in the address bar), each token a scan away; 40 hex without 0x is an address', /if \(!ADDR\.test\(addr\) && window\.TokenNames && TokenNames\.isNameQuery\(addr\)\) \{ names\(TokenNames\.normQ\(addr\), heard\); return; \}/.test(SC)
    && /if \(\/\^\[0-9a-f\]\{40\}\$\/i\.test\(addr\)\) return scan\('0x' \+ addr, heard\);/.test(SC) && /if \(want && want\.trim\(\)\.length >= 2\) scan\(want\);/.test(SC)
    && /placeholder="0x… paste an address, or type a name"/.test(HTML) && /scan\(nr\.dataset\.token, true\)/.test(SC));
  check('  ...and so does the DEX List\'s search, above the radar\'s live pairs — a hex-looking name (BEEF) is a name, an address clears it', /namedTokens\(state\.q\);/.test(NJ) && /b\.innerHTML = TokenNames\.blockHTML\(j, q\);/.test(NJ) && /if \(!window\.TokenNames \|\| !TokenNames\.isNameQuery\(q\)\) \{ clearNamed\(\); return; \}/.test(NJ) && /clearNamed\(\);                                   \/\/ an address is not a name/.test(NJ));
  check('the figures never lose their words: FDV is called FDV, MC/FDV when unsure, an unread figure says so, a tiny one is "< $0.01"', /\(k === 'fdv' \? 'FDV ' : k === 'either' \? 'MC\/FDV ' : 'MC '\)/.test(SJ) && /'market cap unknown'/.test(SJ) && /'volume unknown'/.test(SJ) && /'holders unknown'/.test(SJ) && /'holders not read yet'/.test(SJ) && /'< \$0\.01'/.test(SJ));
  check('the privacy page says the server asks GeckoTerminal and Dexscreener which tokens match a name, with the words only', /which tokens match a name typed into a search — the words typed, nothing about who typed them/.test(PRIV));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  for (const t of made.runner) { try { db.prepare('DELETE FROM runner_tokens WHERE token_addr = ?').run(t); } catch {} }
  for (const t of made.cache) { try { db.prepare('DELETE FROM token_cache WHERE token_addr = ?').run(t); } catch {} }
  for (const t of made.ledger) { try { db.prepare('DELETE FROM holder_index WHERE token_addr = ?').run(t); } catch {} }
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
