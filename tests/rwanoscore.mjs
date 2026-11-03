/* ===== No health score, no swap: a real-world asset counted on evidence (owner, 2026-11-03) ==============================
   The owner's answers, verbatim: "Should 'Swap in my wallet' be hidden on Robinhood Stock Tokens?" — "Only if they are RWA on the
   robinhood chain." "Should the Scanner's health score count an issuer's powers over its token? Today TSLA shows 100/100." —
   "Don't show health scores for real stocks."

   One rule, everywhere a score or a swap appears: a Robinhood Chain token Market Data COUNTS as a real-world asset on evidence
   (lib/rwa.js counted — Robinhood's registry and its code on the chain, or an issuer on this site's list confirmed by its own beacon;
   every kind) has no health score and no swap. A lookalike (a ticker or a name only), a token not confirmed on the chain yet, an
   ordinary token and every other chain keep both. Here, in four parts, each on the four kinds of token:
     1. lib/rwa.js's rule and words, on the server's own RWA answers (tests/fixtures/rwacard).
     2. The server's pieces, run from its source in a sandbox — the gate every score passes (rwaScoreGate, riskFinish), the answer copy
        (rwaGated), the Telegram verdict and message and its link to the token's scan page — and where the source runs them (applyRisk, the
        cache rescore, the radar's carried rows, withRwa, the watchlist, the runners), and the radar's "First tagged" stamp withheld.
     3. The pages, run in a sandbox: the dashboard, the DEX list row, the classic detail, the Hot Feed's test, the Safer tab and its
        empty message, the min-health filter, "First tagged" and the runners in public/newpairs.js; the button in public/swapkit.js; the
        watchlist page.
     4. The live server (this run's throwaway one): TSLA in Robinhood's registry as Market Data keeps it, and three cached profiles —
        TSLA, a lookalike with its ticker, a plain token — through /api/scan, /api/market/scan, /api/pairs/lookup, the swap routes, the
        watchlist, Best Runners and a Send Call's call-time snapshot (/api/calls/:id). Every row it writes is taken out again in the
        finally block. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { ROOT, SERVER_JS, DB_PATH } from './_paths.mjs';

const require = createRequire(import.meta.url);
const RW = require(path.join(ROOT, 'lib', 'rwa.js')), CF = require(path.join(ROOT, 'lib', 'contractfacts.js'));
const SRC = fs.readFileSync(SERVER_JS, 'utf8');
const PUB = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const FX = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'rwacard', n), 'utf8'));
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const brief = (o) => JSON.stringify(o === undefined ? null : o).slice(0, 400);
const text = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const TSLA = '0x322f0929c4625ed5bad873c95208d54e1c003b2d', LOOK = '0x7e86381a763f0ecca2bdf27c54eac403ddd48123', PLAIN = '0x' + 'c3'.repeat(20);
const T = FX('rwa-token-tsla.json'), ON = FX('rwa-token-tslaon.json'), WK = FX('rwa-token-week.json'), GOO = FX('rwa-token-googlon.json'), MEME = FX('rwa-token-gme-memecoin.json'), USDG = FX('rwa-token-usdg.json');

/* ═══ 1. the rule and its words (lib/rwa.js) ═══ */
{
  const n = RW.noScoreOf(T);
  check('counted on evidence, as Market Data counts: TSLA (Robinhood\'s registry + its code), Ondo\'s TSLAon (its beacon) and WEEK (a bond fund, on the chain) — and not GOOGLon (not confirmed yet), the GME lookalike\'s 404, USDG\'s or nothing',
    RW.counted(T) && RW.counted(ON) && RW.counted(WK) && !RW.counted(GOO) && !RW.counted(MEME) && !RW.counted(USDG) && !RW.counted(null) && !RW.counted({}) && !RW.counted({ confidence: 'confirmed' }) /* no issuer: not a row */);
  check('  ...what a profile carries in place of a score: { rwa, symbol, issuer, kind, confidence, why } — every kind counted (WEEK is a bond fund), and null for anything not counted',
    n && n.rwa === true && n.symbol === 'TSLA' && n.issuer.key === 'rhj' && n.kind === 'stock' && n.confidence === 'confirmed' && n.why === RW.NOSCORE_WHY && RW.noScoreOf(WK).kind === 'bond' && RW.noScoreOf(ON).issuer.key === 'ondo'
    && RW.noScoreOf(GOO) === null && RW.noScoreOf(MEME) === null, brief(n));
  check('  ...the words: why there is no score (built for memecoin risks; an issuer keeps powers to pause, freeze and mint by design; the card has the issuer facts) and why there is no swap — honest, no advice, nothing called safe',
    /^No health score for a tokenized real-world asset: the Scanner's score is built for memecoin risks, and an issuer keeps powers to pause the token, freeze wallets or mint more by design, so a number would mislead either way\. The real-world-asset card has the issuer facts\.$/.test(RW.NOSCORE_WHY)
    && /tokenized real-world asset on Robinhood Chain, and the Scanner does not offer swaps for those/.test(RW.NOSWAP_WHY) && ![RW.NOSCORE_WHY, RW.NOSWAP_WHY].some((w) => /\b(safe|buy now|should buy|guarantee)/i.test(w)));
}

/* ═══ 2. the server's pieces, run ═══ */
const grab = (re, what) => { const m = re.exec(SRC); if (!m) throw new Error('could not find ' + what + ' in server.js'); return m[0]; };
const rows = { [TSLA]: T };   // what Market Data counts in this sandbox: TSLA
const MKT = { rwaCounted: (a) => (rows[String(a || '').toLowerCase()] ? RW.noScoreOf(rows[String(a || '').toLowerCase()]) : null) };
const sb = { MKT, CF, RWA: RW, BASE_URL: 'http://localhost:1', BLOCKSCOUT: 'https://robinhoodchain.blockscout.com' };
vm.createContext(sb);
vm.runInContext([grab(/const RISK = \{[\s\S]*?\n\};\n/, 'RISK'), grab(/function riskFinish\(e\) \{[\s\S]*?\n\}\n/, 'riskFinish'), grab(/function rwaScoreGate\(e\) \{[\s\S]*?\n\}\n/, 'rwaScoreGate'),
  grab(/const rwaGated = [^\n]*\n/, 'rwaGated'), grab(/function scanVerdict\(p\) \{[\s\S]*?\n\}\n/, 'scanVerdict'), grab(/const tgEsc = [^\n]*\n/, 'tgEsc'), grab(/const tgUsd = [^\n]*\n/, 'tgUsd'), grab(/const tgAge = [^\n]*\n/, 'tgAge'),
  grab(/function tgScanMessage\(p\) \{[\s\S]*?\n\}\n/, 'tgScanMessage'), 'this.S = { RISK, riskFinish, rwaScoreGate, rwaGated, scanVerdict, tgScanMessage };'].join('\n'), sb);
const S = sb.S;
{
  const prof = (addr, chain, risk) => ({ ...(chain ? { chain } : {}), token: { address: addr, symbol: 'TSLA', name: 'Tesla' }, market: { marketCap: 4.5e6, liquidityUsd: 1.2e6 }, holders: { count: 900 }, pair: { ageMinutes: 600 }, txns: { h24: {} },
    risk: Object.assign({ lowHolders: true, thinData: false, sniperOk: true, dataKnown: { indexed: true, liquidity: true, holders: true, concentration: true, verified: true, snipers: true } }, risk || {}) });
  const want = 100 - S.RISK.lowHolders.w;
  const a = prof(TSLA); S.riskFinish(a);
  const e = prof(TSLA, 'ethereum'); S.riskFinish(e);
  const p = prof(PLAIN); S.riskFinish(p);
  check('the gate: TSLA (counted) finishes with health and triage null and risk.noScore saying why — its flags kept (they are readings); the same address on Ethereum and a plain token finish with their score',
    a.risk.health === null && a.risk.triage === null && a.risk.noScore && a.risk.noScore.rwa === true && a.risk.noScore.why === RW.NOSCORE_WHY && a.risk.lowHolders === true
    && e.risk.health === want && typeof e.risk.triage === 'string' && !e.risk.noScore && p.risk.health === want && !p.risk.noScore, brief([a.risk.health, a.risk.triage, e.risk.health, p.risk.health]));
  a.risk.honeypotSuspect = true; S.riskFinish(a);
  const b = prof(PLAIN, null, { health: null, triage: null, noScore: RW.noScoreOf(T) }); S.rwaScoreGate(b);
  check('  ...a later re-finish (a vendor\'s honeypot reading) keeps a counted token at no score; a token that stops being counted gets its score back from its flags, never a 0',
    a.risk.health === null && a.risk.triage === null && a.risk.honeypotSuspect === true && b.risk.health === want && !b.risk.noScore && typeof b.risk.triage === 'string', brief([a.risk, b.risk.health]));
  const cached = prof(TSLA, null, { health: 100, triage: 'ok' }), copy = S.rwaGated(cached);
  check('  ...on an answer the gate runs on a copy: the cached profile keeps what it holds, the answer carries no score', copy.risk.health === null && copy.risk.noScore && cached.risk.health === 100 && !cached.risk.noScore && copy !== cached && copy.token === cached.token);
  const sv = S.scanVerdict(copy), svP = S.scanVerdict(prof(PLAIN, null, { health: 100, triage: 'ok', lowHolders: false }));
  const tg = S.tgScanMessage(copy), tgP = S.tgScanMessage(prof(PLAIN, null, { health: 100, triage: 'ok', lowHolders: false }));
  check('  ...the Telegram verdict: no tag derived from a score — "🏛️ Real-world asset — no health score" with why, and no "health N/100" line; a plain 100 keeps its 🚀 and its number',
    sv.word === 'Real-world asset — no health score' && sv.emoji === '🏛️' && sv.note === RW.NOSCORE_WHY && sv.noScore === true && svP.word === 'Looks Good, Send It'
    && tg.includes('🏛️ <b>Real-world asset — no health score</b>') && !/health \d+\/100/.test(tg) && !/Looks Good/.test(tg) && tgP.includes('🚀 <b>Looks Good, Send It</b> · health 100/100'), tg.split('\n').slice(0, 3).join(' | '));
  check('  ...and the message links where its note points: the token\'s own scan page on the Scanner (Robinhood Chain pinned), which carries the real-world-asset card — "Its real-world-asset card"; a plain token\'s link is its own scan page too, never the radar list',
    tg.includes('🔎 <a href="http://localhost:1/newpairs?scan=' + TSLA + '&amp;chain=robinhood">Its real-world-asset card</a> · <a href="https://robinhoodchain.blockscout.com/token/' + TSLA + '">Explorer</a>')
    && tgP.includes('🔎 <a href="http://localhost:1/newpairs?scan=' + PLAIN + '&amp;chain=robinhood">Full scan on the Scanner</a>') && ![tg, tgP].some((m) => /\/newpairs"/.test(m)), [tg, tgP].map((m) => m.split('\n').find((l) => l.startsWith('🔎'))).join(' | '));
  check('  ...the radar\'s "First tagged" stamp (the cap when it first earned the 🚀 verdict, kept in runner_tokens) is not served for a profile with no score: qualMc, qualAt and xFromQual null beside risk.noScore; First seen and Peak stay',
    /const ns = !!\(e\.risk && e\.risk\.noScore\);/.test(SRC) && /qualMc: ns \? null : r\.qual_mc, qualAt: ns \? null : r\.qual_at,/.test(SRC) && /xFromFirst: x\(r\.first_mc\), xFromQual: ns \? null : x\(r\.qual_mc\),/.test(SRC)
    && /firstMc: r\.first_mc, firstSeenAt: r\.first_seen_at,/.test(SRC) && /peakMc: r\.peak_mc, peakAt: r\.peak_at,/.test(SRC));
  // where the source runs it: wherever a score is finished, and on every answer that carries a profile
  check('  ...the source runs it wherever a score is finished — applyRisk\'s end, riskFinish\'s, both of the cache rescore\'s exits, the radar\'s carried rows — and on the answers: withRwa (every Scanner answer), the watchlist, Best Runners (health null with noScore), the swap kit\'s hook',
    /e\.risk = r;\n  rwaScoreGate\(e\);\n\}/.test(SRC) && /return rwaScoreGate\(pair\);/.test(SRC) && /    rwaScoreGate\(pair\);\n  \} catch \{\}\n  return pair;/.test(SRC)
    && /if \(e\.priceStale && e\._prevRisk\) \{ e\.risk = e\._prevRisk; delete e\._prevRisk; rwaScoreGate\(e\); continue; \}/.test(SRC) && /return rwaGated\(Object\.assign\(\{\}, p, \{ rwa \}\)\);/.test(SRC)
    && /return out\.map\(rwaGated\);/.test(SRC) && /health: ns \? null : r\.cur_health, \.\.\.\(ns \? \{ noScore: ns \} : \{\}\)/.test(SRC) && /if \(!e\.chain \|\| e\.chain === 'robinhood'\) \{ try \{ n = MKT\.rwaCounted\(e\.token\.address\); \} catch \{\} \}/.test(SRC));
}

/* ═══ 3. the pages ═══ */
function sandbox() {
  const noop = () => {}, nil = () => null;
  const document = { addEventListener: noop, getElementById: nil, querySelector: nil, querySelectorAll: () => [], body: { classList: { toggle: noop, remove: noop } }, hidden: false };
  const window = { document, addEventListener: noop, dispatchEvent: noop, CSS: { escape: (x) => x } };
  const ctx = { window, document, localStorage: { getItem: nil, setItem: noop }, fetch: () => Promise.reject(new Error('offline')), setTimeout, clearTimeout, setInterval: noop, requestAnimationFrame: noop, cancelAnimationFrame: noop, console, CustomEvent: function () {}, Node: {}, atob };
  ctx.globalThis = ctx; window.window = window; vm.createContext(ctx);
  vm.runInContext(PUB('newpairs.js'), ctx); ctx.NPCard = window.NPCard;
  vm.runInContext(PUB('swapkit.js'), ctx); ctx.SwapKit = window.SwapKit;   // loaded after newpairs.js, as every page with the dashboard loads it
  return window;
}
const W = sandbox(), NPC = W.NPCard;
const DS = FX('ds-pair-tsla.json').pair, GP = FX('goplus-4663-tsla.json').result;
const SCORED = { health: 100, triage: 'ok', thinData: false, sniperOk: true, dataKnown: { indexed: true, liquidity: true, holders: true, concentration: true, verified: true, snipers: true } };
// a profile as the Scanner builds it; risk is what the server sent (a counted one: the gate's), rwa the RWA card's facts (or a lookalike's 404)
function prof(over) {
  return Object.assign({ chain: 'robinhood', indexed: true,
    token: { address: TSLA, name: DS.baseToken.name, symbol: DS.baseToken.symbol, decimals: 18, isVerified: true, deployer: GP.creator_address, renounced: null, owner: null },
    pair: { address: DS.pairAddress.toLowerCase(), ageMinutes: 2000, quoteSymbol: DS.quoteToken.symbol, createdAt: Date.now() - 2000 * 60000 },
    market: { priceUsd: Number(DS.priceUsd), liquidityUsd: DS.liquidity.usd, marketCap: DS.marketCap, fdv: DS.fdv }, volume: DS.volume, txns: DS.txns, priceChange: DS.priceChange,
    holders: { count: Number(GP.holder_count), source: 'goplus', top: [] }, links: { explorer: 'https://robinhoodchain.blockscout.com/token/' + TSLA, dex: DS.url }, chainFacts: CF.evmFacts(GP),
    risk: Object.assign({}, SCORED), rwa: null }, over || {});
}
const GATED = { health: null, triage: null, thinData: false, sniperOk: true, dataKnown: SCORED.dataKnown, noScore: RW.noScoreOf(T) };
const K = {
  counted: prof({ rwa: T }),                                              // the Scanner's answer for TSLA: the card's facts (the page holds the rule from them too)
  radar: prof({ risk: Object.assign({}, GATED), rwa: undefined }),        // a radar row or a saved one: the server's gated risk only, no card
  lookalike: prof({ token: { address: LOOK, name: 'GameStop', symbol: 'gme', decimals: 18 }, rwa: MEME }),
  plain: prof({ token: { address: PLAIN, name: 'Zq Plain', symbol: 'ZQPLAIN', decimals: 18 } }),
  ethereum: prof({ chain: 'ethereum', pools: [], rwa: T, risk: Object.assign({}, SCORED, { noScore: RW.noScoreOf(T) }) }),   // never the home chain's rule, whatever it carries
  notConfirmed: prof({ token: { address: GOO.address, name: 'Alphabet (Ondo)', symbol: 'GOOGLon', decimals: 18 }, rwa: GOO }),
};
{
  check('the page\'s words are lib/rwa.js\'s (the no-score sentence word for word; the no-swap line says the same reason the swap API refuses with)',
    NPC.RWA_NOSCORE_WHY === RW.NOSCORE_WHY && /^No swap button: this is a tokenized real-world asset on Robinhood Chain, and the Scanner does not offer swaps for those\.$/.test(NPC.RWA_NOSWAP_SAY) && RW.NOSWAP_WHY.includes('tokenized real-world asset on Robinhood Chain, and the Scanner does not offer swaps for those'));
  check('the page\'s rule is the server\'s: counted on the server\'s noScore or on the card\'s facts (confirmed / registry-listed); not on a lookalike, a token not confirmed yet, a plain token or another chain',
    !!NPC.rwaCountedOf(K.counted) && !!NPC.rwaCountedOf(K.radar) && NPC.rwaCountedOf(K.radar).why === RW.NOSCORE_WHY && !NPC.rwaCountedOf(K.lookalike) && !NPC.rwaCountedOf(K.notConfirmed) && !NPC.rwaCountedOf(K.plain) && !NPC.rwaCountedOf(K.ethereum)
    && !!NPC.rwaCountedOf(prof({ rwa: Object.assign({}, T, { confidence: 'issuer-listed' }) })));
  const dash = {}; for (const [k, p] of Object.entries(K)) dash[k] = NPC.dashboardHTML(p);
  const headOf = (h) => h.slice(0, h.indexOf('tkd-stats'));
  const scoreFree = (h) => !/tkd-health|np-gauge|\/100|Looks Good|Send It|tkd-card--score|Score breakdown/.test(h) && !h.includes('tkd-swap-btn');
  check('the dashboard of a counted RWA — the Scanner\'s answer (with the card) and a radar row (without) — shows no score anywhere: no ring, no number, no "Health N/100", no 🚀 or ✅, no score card, no Swap button',
    scoreFree(dash.counted) && scoreFree(dash.radar) && /Real-world asset — no health score/.test(headOf(dash.counted)) && /Real-world asset — no health score/.test(headOf(dash.radar)), text(headOf(dash.radar)).slice(-500));
  check('  ...in its place one honest line: with the card, its issuer\'s powers and that the card lists who holds each; without it (a radar row), the same reason and a link to its card on the Scanner page — and where the button was, why there is none',
    /<b>No health score:<\/b> the Scanner’s score is built for memecoin risks, and its issuer keeps powers over every holder’s tokens by design/.test(dash.counted) && /the real-world-asset card lists who holds each/.test(dash.counted)
    && /🏛️ <b>No health score for a tokenized real-world asset:<\/b> the Scanner’s score is built for memecoin risks, and an issuer keeps powers to pause the token, freeze wallets or mint more by design, so a number would mislead either way\. <a class="np-addr-link" href="\/newpairs\?scan=0x322f0929c4625ed5bad873c95208d54e1c003b2d" data-tip="[^"]{8,}">Its real-world-asset card<\/a> has the issuer facts\./.test(dash.radar)
    && [dash.counted, dash.radar].every((h) => /<p class="tkd-note tkd-rwa-noswap">🏛️ No swap button: this is a tokenized real-world asset on Robinhood Chain, and the Scanner does not offer swaps for those\.<\/p>/.test(h)));
  check('  ...and everything else still shows: the contract facts, the LP, the holders, the market, the activity, block 0, the bundlers — and the RWA card on the Scanner\'s answer',
    ['tkd-card--contract', 'tkd-card--holders', 'tkd-card--market', 'tkd-card--activity', 'tkd-card--block0', 'tkd-card--bundles', 'tkd-card--safety'].every((c) => dash.counted.includes(c) && dash.radar.includes(c))
    && /LP burned — held by a dead address/.test(text(dash.counted)) && dash.counted.includes('tkd-card--rwa') && !dash.radar.includes('tkd-card--rwa'));
  check('  ...a lookalike, a token not confirmed yet, a plain token and another chain keep their score and their button: the ring and its number, "Health 100/100", the score card — and no no-score or no-swap line',
    ['lookalike', 'notConfirmed', 'plain', 'ethereum'].every((k) => /np-gauge-num">100</.test(headOf(dash[k])) && /Health <b[^>]*>100<\/b>\/100/.test(dash[k]) && dash[k].includes('tkd-card--score') && dash[k].includes('tkd-swap-btn') && !dash[k].includes('tkd-rwa-noswap') && !/No health score/.test(dash[k])),
    ['lookalike', 'notConfirmed', 'plain', 'ethereum'].map((k) => k + ':' + dash[k].includes('tkd-swap-btn') + '/' + dash[k].includes('tkd-card--score')).join(' '));
  // the DEX list row, the classic detail
  const row = (k) => NPC.rowHTML(Object.assign({}, K[k], { chainFacts: null }));   // no contract read: the plain row's verdict is its score's alone
  check('the DEX list row of a counted RWA: a 🏛️ where the ring was (no number, no arc), a neutral edge (data-level "rwa", not a tier), the chip "Real-world asset — no health score" with why on it, and the spoken line with no "health N of 100"; a plain row keeps its ring, its 100 and its 🚀',
    /class="np-gauge np-gauge--none np-t-rwa" aria-hidden="true"><span class="np-gauge-rwa">🏛️<\/span>/.test(row('radar')) && !/np-gauge-num|np-gauge-arc/.test(row('radar')) && /data-level="rwa"/.test(row('radar'))
    && /<span class="np-verdict np-t-rwa" title="No health score for a tokenized real-world asset/.test(row('radar')) && !/health \d+ of 100/.test(row('radar')) && /Verdict Real-world asset — no health score\. No health score for/.test(row('radar'))
    && /np-gauge-num">100</.test(row('plain')) && /health 100 of 100/.test(row('plain')) && /Looks Good, Send It/.test(row('plain')) && /data-level="ok"/.test(row('plain')), text(row('radar')).slice(0, 300));
  const det = (k) => NPC.detailHTML(K[k]);
  check('  ...its classic detail: no score breakdown and no "N/100" in the short version, which says there is no health score and why and still names what the automatic checks found; a plain token\'s keeps its breakdown and its 100/100',
    !/Score breakdown|\/100|Overall health/.test(det('radar')) && /There is no health score for it: it is a tokenized real-world asset, and the score is built for memecoin risks — its issuer keeps powers to pause it, freeze wallets or mint more by design\./.test(text(det('radar')))
    && /GoPlus Security reports: LP not burned or locked — read the Contract card\./.test(text(det('radar'))) && !/not counted in the score|does not count/.test(text(det('radar')))
    && /Score breakdown/.test(det('plain')) && /100\/100/.test(det('plain')), text(det('radar')).slice(0, 400));
  // the Hot Feed, the Safer tab, the min-health filter, the sort, Best Runners
  const bare = (o) => Object.assign(prof(o), { chainFacts: null });   // no contract read: the floor is the score's alone here
  check('the Hot Feed never shows a counted RWA, whatever its flags read (a 100, triage ok, a clean block 0): the plain and the lookalike profiles with the same risk qualify; the Safer tab and a "min health 50" filter likewise — a token with no score never meets a score bar',
    !NPC.feedQualifies(bare({ rwa: T })) && !NPC.feedQualifies(bare({ risk: Object.assign({}, GATED) })) && NPC.feedQualifies(bare({ token: { address: PLAIN, name: 'Zq Plain', symbol: 'ZQPLAIN' } })) && NPC.feedQualifies(bare({ token: { address: LOOK, name: 'GameStop', symbol: 'gme' }, rwa: MEME }))
    && !NPC.saferOk(bare({ rwa: T })) && NPC.saferOk(bare({ token: { address: PLAIN, name: 'Zq Plain', symbol: 'ZQPLAIN' } })) && !NPC.passFilters(bare({ rwa: T }), { minHealth: 50 }) && NPC.passFilters(bare({ token: { address: PLAIN, name: 'Zq Plain', symbol: 'ZQPLAIN' } }), { minHealth: 50 })
    && NPC.passFilters(bare({ rwa: T }), {}) /* no bar set: it is listed */);
  const rm = NPC.runnerMetricsHTML({ mcap: 4.5e6, gain: 0.25, health: null, noScore: RW.noScoreOf(T), exact: true }), rp = NPC.runnerMetricsHTML({ mcap: 1e5, gain: 0.25, health: 77, exact: true });
  check('Best Runners: the server\'s noScore in the 🩺\'s place — "🏛️ no score", said in words, the reason on hover — never a number; a scored runner keeps its 🩺 77',
    /<span class="np-runner-health np-runner-noscore" role="img" aria-label="A real-world asset: no health score" title="No health score for a tokenized/.test(rm) && />🏛️ no score<\/span>/.test(rm) && !/🩺/.test(rm) && /🩺 77/.test(rp));
  check('the page source: the score sort puts a counted RWA after every scored row (never as a 0), and the Safer tab\'s hidden count says when what it hid is a real-world asset with no score, not "risky or under 75%"',
    /const hk = \(p\) => \(rwaCountedOf\(p\) \? -1 : \(p\.risk\.health \|\| 0\)\); v\.sort\(\(a, b\) => hk\(b\) - hk\(a\)\);/.test(PUB('newpairs.js')) && /a real-world asset' : 'real-world assets'\) \+ ' — no health score'/.test(PUB('newpairs.js')) && /'risky, under ' \+ SAFER_MIN \+ '%, or a real-world asset with no health score'/.test(PUB('newpairs.js')));
  // the Safer tab's empty message: why what it hid was hidden, and a button to the tab that shows each
  {
    const SE = NPC.saferEmptyHTML, plainTok = { address: PLAIN, name: 'Zq Plain', symbol: 'ZQPLAIN' };
    const rwaP = bare({ rwa: T }), riskyP = bare({ token: plainTok, risk: Object.assign({}, SCORED, { health: 10, triage: 'avoid' }) }), lowP = bare({ token: plainTok, risk: Object.assign({}, SCORED, { health: 60, triage: 'caution' }) });
    const one = typeof SE === 'function' ? SE([rwaP]) : '', mixed = typeof SE === 'function' ? SE([rwaP, riskyP]) : '', risky = typeof SE === 'function' ? SE([riskyP]) : '', low = typeof SE === 'function' ? SE([lowP]) : '';
    const btns = (h) => [...h.matchAll(/<button [^>]*id="([^"]+)"[^>]*data-tip="([^"]*)"/g)].map((m) => [m[1], m[2]]), ids = (h) => btns(h).map((b) => b[0]).join(',');
    const ALL_BTN = /<button class="btn btn-sm btn-ghost" id="np-showall" type="button" data-tip="Switches to the All tab, which shows the hidden pairs that are not high-risk">Show all<\/button>/;
    check('the Safer tab\'s empty message when what it hid is a real-world asset: it says the asset has no health score to clear the Safer bar (not that it "tripped our checks"), and its button goes to the All tab, where the asset is listed — not to Risky, which does not show it',
      /every new pair matching your filters is a tokenized real-world asset, which has no health score to clear the Safer bar, so none are shown by default\./.test(text(one)) && !/tripped our checks/.test(one) && ALL_BTN.test(one) && ids(one) === 'np-showall,np-reset2',
      text(one) + ' | ' + ids(one));
    check('  ...with risky pairs as well: "tripped our checks or is a tokenized real-world asset, which has no health score", and both buttons — All for the asset, Risky for the high-risk pair; the risky-only message keeps its words and its one button; a pair under the bar but not high-risk gets Show all, never a Risky tab that would not show it',
      /every new pair matching your filters tripped our checks or is a tokenized real-world asset, which has no health score to clear the Safer bar, so none are shown by default\./.test(text(mixed)) && ids(mixed) === 'np-showall,np-showrisky,np-reset2'
      && /All clear in Safer view — every new pair matching your filters tripped our checks, so none are shown by default\./.test(text(risky)) && ids(risky) === 'np-showrisky,np-reset2' && ids(low) === 'np-showall,np-reset2'
      && [one, mixed, risky, low].every((h) => btns(h).every((b) => b[1].length >= 8)), [ids(mixed), ids(risky), ids(low)].join(' | '));
    check('  ...the page uses it: renderEmpty hands it what the Safer tab hid (passes the filters, not the bar) and says "Nothing matches these filters" when nothing passed them; Show all switches to the All tab',
      /const hid = state\.all\.filter\(\(p\) => passFilters\(p\) && !saferOk\(p\)\);\n    if \(state\.safety === 'safer' && hid\.length\) \{ listEl\.innerHTML = saferEmptyHTML\(hid\); return; \}/.test(PUB('newpairs.js'))
      && /else if \(t\.id === 'np-showall'\) selectSafety\('all'\);/.test(PUB('newpairs.js')));
  }
  // "First tagged" — the cap when it first cleared the site's own 🚀 bar — is a stamp derived from the score
  {
    const caps = { firstMc: 1.2e6, firstSeenAt: Date.now() - 864e5, qualMc: 2.4e6, qualAt: Date.now() - 3600e3, peakMc: 5e6, peakAt: Date.now() - 1800e3, nowMc: 4.5e6, xFromFirst: 2.75, xFromQual: 0.88, offPeakPct: 10 };
    const wc = (k) => Object.assign({}, K[k], { caps }), views = (k) => [NPC.detailHTML(wc(k), { sections: { market: true } }), NPC.dashboardHTML(wc(k))];
    check('a counted RWA\'s market figures print no "First tagged" (the cap when it first earned the 🚀 verdict), even from a stamp kept from before the rule — in the classic detail and the dashboard\'s Market card; First seen and Peak still show; a plain token keeps its First tagged',
      ['counted', 'radar'].every((k) => views(k).every((h) => !/First tagged/.test(h) && /First seen/.test(h) && /Peak/.test(h))) && views('plain').every((h) => /First tagged/.test(h) && /\+0\.88x/.test(h)),
      ['counted', 'radar', 'plain'].map((k) => k + ':' + views(k).map((h) => /First tagged/.test(h)).join('/')).join(' '));
  }
  // the button itself (public/swapkit.js), whoever calls it
  const B = W.SwapKit.buttonHTML;
  check('SwapKit gives no button for a counted RWA on Robinhood Chain (the server\'s noScore or the card\'s facts), and the same button as before for a lookalike, a token not confirmed yet, a plain token and another chain',
    B(K.counted) === '' && B(K.radar) === '' && /data-swap-open/.test(B(K.lookalike)) && /data-swap-open/.test(B(K.notConfirmed)) && /data-swap-open/.test(B(K.plain)) && /data-swap-open data-swap-chain="ethereum"/.test(B(K.ethereum)));
  // the CSS of the new pieces: on the text floor, nothing cut short
  const CSS = PUB('styles.css'), block = CSS.slice(CSS.indexOf('/* a real-world asset counted on evidence has no health score'), CSS.indexOf('.np-runner-noscore') + 60);
  const sizes = [...block.matchAll(/font-size\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
  check('their CSS: every font-size on the text floor, a neutral edge and chip (no tier colour), nothing cut short', sizes.length >= 2 && sizes.every((v) => v.startsWith('max(var(--text-floor)')) && /\.np-t-rwa \{ --tri: var\(--text-dim\); \}/.test(block)
    && /\.np-row\[data-level="rwa"\], \.np-slide\[data-level="rwa"\] \{ --rowtri: var\(--ink-4\); \}/.test(block) && !/text-overflow|line-clamp|white-space:\s*nowrap|\border\s*:/.test(block), sizes.join(' | '));
}
// the watchlist page (public/watchlist.js), its rows drawn from what /api/watchlist answers
{
  const listEl = { innerHTML: '', addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const document = { getElementById: (id) => (id === 'wl-list' ? listEl : null), addEventListener() {} };
  const window = { document, AUTH: { user: { username: 'zqwatch' } } }; window.window = window;
  const wl = (p) => Object.assign({}, p, { _wl: { added_at: Date.now(), source: 'fresh' } });
  const items = [wl(K.radar), wl(K.plain)];
  const ctx = { window, document, AUTH: window.AUTH, fetch: async () => ({ status: 200, json: async () => ({ items }) }), console, setTimeout, clearTimeout };
  vm.createContext(ctx); vm.runInContext(PUB('watchlist.js'), ctx);
  await new Promise((r) => setTimeout(r, 50));
  const html = listEl.innerHTML, i = html.indexOf(DS.pairAddress.toLowerCase() + '"'), rwaRow = html.slice(0, html.indexOf('</li>') + 5), plainRow = html.slice(html.indexOf('</li>') + 5);
  check('the watchlist: a counted RWA\'s row has no ring, no number, no tier and no "health N of 100" — "Real-world asset — no health score" and why; a plain token\'s row keeps its ring, its 100 and its 🚀',
    i > 0 && /np-gauge--none/.test(rwaRow) && !/np-gauge-num/.test(rwaRow) && /data-level="rwa"/.test(rwaRow) && /Real-world asset — no health score/.test(rwaRow) && !/health \d+ of 100/.test(rwaRow) && /No health score for a tokenized/.test(rwaRow)
    && /np-gauge-num">100</.test(plainRow) && /health 100 of 100/.test(plainRow) && /Looks Good, Send It/.test(plainRow), text(html).slice(0, 400));
}

/* ═══ 4. the live server ═══ */
const PORT = process.argv[2], BASE = 'http://localhost:' + PORT;
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const made = [], NOW = Date.now(), AHEAD = NOW + 30 * 60e3;   // the cached profiles are stamped ahead, so no scan reads them live (the throwaway server reaches no chain)
const addrs = [TSLA, LOOK, PLAIN];
async function api(p, opts = {}) {
  const r = await fetch(BASE + p, { method: opts.method || 'GET', redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.sid ? { Cookie: 'sid=' + opts.sid } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, j };
}
function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, NOW, '🧪', NOW, 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id; made.push(id);
  const raw = 'tok_' + name + '_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, NOW, NOW + 864e5);
  return { id, sid: raw };
}
const bump = () => db.prepare("INSERT INTO mkt_runs (job, at, ok, ms, calls, note) VALUES ('rwa', ?, 1, 1, 0, 'tests/rwanoscore.mjs')").run(Date.now());   // Market Data's memo moves on with its runs
function cleanup() {
  try {
    for (const a of addrs) { db.prepare('DELETE FROM token_cache WHERE token_addr = ?').run(a); db.prepare('DELETE FROM scans WHERE token_addr = ?').run(a); db.prepare('DELETE FROM mkt_scan WHERE address = ?').run(a); db.prepare('DELETE FROM runner_tokens WHERE token_addr = ?').run(a); db.prepare('DELETE FROM runner_snaps WHERE token_addr = ?').run(a); }
    db.prepare("DELETE FROM mkt_state WHERE name = 'rhj_assets'").run();
    for (const id of made) { db.prepare('DELETE FROM calls WHERE user_id = ?').run(id); db.prepare('DELETE FROM watchlist WHERE user_id = ?').run(id); db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); db.prepare('DELETE FROM users WHERE id = ?').run(id); }
    db.prepare("DELETE FROM mkt_runs WHERE note = 'tests/rwanoscore.mjs'").run();
  } catch (e) { console.log('cleanup: ' + e.message); }
}
try {
  if (db.prepare("SELECT 1 FROM mkt_state WHERE name = 'rhj_assets'").get()) throw new Error('this database already holds Robinhood\'s registry answer — run me on the throwaway database (npm test)');
  // TSLA in Robinhood's registry, as Market Data keeps the answer: counted on evidence (registry-listed; its code not read here)
  db.prepare('INSERT INTO mkt_state (name, value, at) VALUES (?,?,?)').run('rhj_assets', JSON.stringify({ readAt: NOW, data: { assets: [{ address: TSLA, uid: null, symbol: 'TSLA', name: 'Tesla • Robinhood Token', status: 'ASSET_STATUS_ACTIVE', decimals: 18 }] } }), NOW);
  bump();
  const stored = (addr, name, symbol, risk) => JSON.stringify(Object.assign(prof({ token: { address: addr, name, symbol, decimals: 18, isVerified: true }, risk: Object.assign({}, SCORED, { concentrated: true, health: 80 }, risk || {}), chainFacts: null, rwa: undefined }), { pair: Object.assign({}, prof().pair, { address: '0x' + addr.slice(4, 6).repeat(20) }) }));
  const put = (addr, name, symbol, pj) => db.prepare('INSERT INTO token_cache (token_addr, pair_json, symbol, name, found, updated_at, last_read_at, reads) VALUES (?,?,?,?,1,?,?,1) ON CONFLICT(token_addr) DO UPDATE SET pair_json = excluded.pair_json, updated_at = excluded.updated_at').run(addr, pj, symbol, name, AHEAD, NOW);
  put(TSLA, 'Tesla • Robinhood Token', 'TSLA', stored(TSLA, 'Tesla • Robinhood Token', 'TSLA'));   // stored with a score, as a profile cached before the rule was
  put(LOOK, 'Tesla Moon', 'TSLA', stored(LOOK, 'Tesla Moon', 'TSLA'));
  put(PLAIN, 'Zq Plain', 'ZQRWAPLAIN', stored(PLAIN, 'Zq Plain', 'ZQRWAPLAIN'));
  const scan = (a, quiet) => api((quiet ? '/api/market/scan' : '/api/scan') + '?chain=robinhood&address=' + a);
  const sT = await scan(TSLA), sL = await scan(LOOK), sP = await scan(PLAIN), qT = await scan(TSLA, true), lT = await api('/api/pairs/lookup?token=' + TSLA), lP = await api('/api/pairs/lookup?token=' + PLAIN);
  const rk = (r) => (r.j && r.j.pair && r.j.pair.risk) || {};
  check('/api/scan on TSLA (a profile cached with a score before the rule): health and triage null, risk.noScore with lib/rwa.js\'s why, its flags kept, and the RWA card\'s facts beside it (registry-listed); /api/market/scan and /api/pairs/lookup the same',
    sT.status === 200 && 'health' in rk(sT) && rk(sT).health === null && rk(sT).triage === null && rk(sT).noScore && rk(sT).noScore.rwa === true && rk(sT).noScore.why === RW.NOSCORE_WHY && rk(sT).concentrated === true
    && sT.j.pair.rwa && sT.j.pair.rwa.confidence === 'issuer-listed' && rk(qT).health === null && rk(qT).noScore && rk(lT).health === null && rk(lT).noScore, brief([sT.status, rk(sT), sT.j && sT.j.pair && sT.j.pair.rwa && sT.j.pair.rwa.confidence]));
  check('  ...the lookalike (TSLA\'s ticker at another address) keeps its score, with the 404 that names the real one as its p.rwa; a plain token keeps its score and carries no RWA facts',
    sL.status === 200 && typeof rk(sL).health === 'number' && rk(sL).health > 0 && !rk(sL).noScore && sL.j.pair.rwa && sL.j.pair.rwa.notRwa === true && sL.j.pair.rwa.twin && sL.j.pair.rwa.twin.address === TSLA
    && sP.status === 200 && typeof rk(sP).health === 'number' && !rk(sP).noScore && sP.j.pair.rwa === null && typeof rk(lP).health === 'number', brief([rk(sL).health, sL.j && sL.j.pair && sL.j.pair.rwa && sL.j.pair.rwa.why, rk(sP).health]));
  // the swap routes: TSLA refused, word for word; the lookalike is not refused (this server reaches no chain, so it says the chain could not be read)
  const swq = await api('/api/swap/quote?chain=robinhood&token=' + TSLA + '&amount=0.01'), swb = await api('/api/swap/build', { method: 'POST', body: { chain: 'robinhood', token: TSLA, amount: '0.01', from: '0x' + '11'.repeat(20) } }), swl = await api('/api/swap/quote?chain=robinhood&token=' + LOOK + '&amount=0.01');
  check('the swap API refuses TSLA — the quote and the build — with 403 and lib/rwa.js\'s sentence, so the button cannot be forced; the lookalike is quoted as any token is (here: the chain cannot be read, never refused)',
    swq.status === 403 && swq.j.error === RW.NOSWAP_WHY && swq.j.refused === 'rwa' && swb.status === 403 && swb.j.error === RW.NOSWAP_WHY && swl.status !== 403 && !(swl.j && swl.j.refused), brief([swq, swb.status, swl]));
  // the watchlist and Best Runners, signed in
  const me = mkUser('zqrwa' + randomBytes(3).toString('hex'));
  const wlRow = (addr, pj) => db.prepare('INSERT INTO watchlist (user_id, pair_addr, token_addr, quote_symbol, snapshot, added_at) VALUES (?,?,?,?,?,?)').run(me.id, JSON.parse(pj).pair.address, addr, 'WETH', pj, NOW);
  wlRow(TSLA, stored(TSLA, 'Tesla • Robinhood Token', 'TSLA')); wlRow(PLAIN, stored(PLAIN, 'Zq Plain', 'ZQRWAPLAIN'));
  const w = await api('/api/watchlist', { sid: me.sid }), wi = ((w.j && w.j.items) || []), wT = wi.find((x) => x.token && x.token.address === TSLA) || {}, wP = wi.find((x) => x.token && x.token.address === PLAIN) || {};
  check('/api/watchlist: the saved TSLA comes back with no score (null, noScore with why) however it was stored; the plain token with its score',
    w.status === 200 && wT.risk && wT.risk.health === null && wT.risk.triage === null && wT.risk.noScore && wT.risk.noScore.why === RW.NOSCORE_WHY && wP.risk && typeof wP.risk.health === 'number' && !wP.risk.noScore, brief([w.status, wT.risk, wP.risk && wP.risk.health]));
  const run = db.prepare('INSERT INTO runner_tokens (token_addr, pair_addr, symbol, name, first_price, first_mc, first_seen_at, peak_price, cur_price, cur_mc, cur_liq, cur_pc24, cur_holders, cur_health, last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  run.run(TSLA, '0x' + 'b1'.repeat(20), 'TSLA', 'Tesla • Robinhood Token', 300, 3e6, NOW - 3600e3, 400, 396, 4.5e6, 1.2e6, 4.5, 900, 100, NOW);
  run.run(PLAIN, '0x' + 'b2'.repeat(20), 'ZQRWAPLAIN', 'Zq Plain', 1, 1e5, NOW - 3600e3, 2, 1.5, 1.5e5, 50000, 12.5, 300, 77, NOW);
  const rr = await api('/api/runners?window=24h', { sid: me.sid }), runners = (rr.j && rr.j.runners) || [], rnT = runners.find((x) => x.token === TSLA) || {}, rnP = runners.find((x) => x.token === PLAIN) || {};
  check('Best Runners: TSLA\'s stored health (100, from before the rule) is served as null with noScore; the plain runner keeps its 77',
    rr.status === 200 && 'health' in rnT && rnT.health === null && rnT.noScore && rnT.noScore.why === RW.NOSCORE_WHY && rnP.health === 77 && !rnP.noScore, brief([rr.status, rnT, rnP.health]));
  /* A Send Call's call-time snapshot: what a call's detail falls back to when the token cannot be read live (public/sendcall.js —
     the token popup and the classic detail). Stored with a score before the rule (TSLA, PLAIN), or with no score after it on a
     token that is no longer counted (the lookalike's address), it is served under the rule as it stands now. */
  const callRow = (addr, pj) => Number(db.prepare('INSERT INTO calls (user_id, token_addr, pair_addr, symbol, name, quote_symbol, entry_price, entry_mc, peak_price, cur_price, cur_mc, last_check, snapshot, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(me.id, addr, JSON.parse(pj).pair.address, JSON.parse(pj).token.symbol, JSON.parse(pj).token.name, 'WETH', 1, 1e5, 1, 1, 1e5, NOW, pj, NOW).lastInsertRowid);
  const cT = callRow(TSLA, stored(TSLA, 'Tesla • Robinhood Token', 'TSLA', { health: 100, triage: 'ok', concentrated: false })), cP = callRow(PLAIN, stored(PLAIN, 'Zq Plain', 'ZQRWAPLAIN'));
  const cL = callRow(LOOK, stored(LOOK, 'Tesla Moon', 'TSLA', { health: null, triage: null, noScore: RW.noScoreOf(T) }));
  const gc = async (id) => { const r = await api('/api/calls/' + id); return { status: r.status, snap: (r.j && r.j.snapshot) || {} }; };
  const kT = await gc(cT), kP = await gc(cP), kL = await gc(cL);
  check('a Send Call\'s call-time snapshot of TSLA (stored at 100/100 before the rule) is served with no score — health and triage null, risk.noScore with lib/rwa.js\'s why — and the RWA card\'s facts the no-score line points to; a plain token\'s snapshot keeps its score and carries no RWA facts',
    kT.status === 200 && kT.snap.risk && 'health' in kT.snap.risk && kT.snap.risk.health === null && kT.snap.risk.triage === null && kT.snap.risk.noScore && kT.snap.risk.noScore.why === RW.NOSCORE_WHY && kT.snap.rwa && kT.snap.rwa.confidence === 'issuer-listed'
    && kP.status === 200 && kP.snap.risk && kP.snap.risk.health === 80 && !kP.snap.risk.noScore && kP.snap.rwa === null, brief([kT.status, kT.snap.risk, kP.snap.risk && kP.snap.risk.health]));
  check('  ...and a snapshot that carries no score for a token that is no longer counted gets its score back from its flags (a number, never a 0 or a null), with no noScore',
    kL.status === 200 && kL.snap.risk && typeof kL.snap.risk.health === 'number' && kL.snap.risk.health > 0 && typeof kL.snap.risk.triage === 'string' && !kL.snap.risk.noScore, brief(kL.snap.risk));
} catch (e) {
  check('the live part ran to the end', false, (e && e.stack) || e);
} finally {
  cleanup(); bump(); db.prepare("DELETE FROM mkt_runs WHERE note = 'tests/rwanoscore.mjs'").run();
}

let pass = 0;
for (const [n, ok, extra] of results) { if (ok) pass++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '\n      ' + extra)); }
console.log(`\n${pass}/${results.length} passed`);
db.close();
if (pass !== results.length) process.exit(1);
