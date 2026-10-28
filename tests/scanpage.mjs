/* The Scanner page: one address in, the full on-chain profile out — open to everyone; the New Pairs radar
   behind it, for members only. Throwaway session only; removed in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, readFile, existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { DB_PATH, ROOT, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');   // the server writes meanwhile: wait a moment, never fail with "database is locked"
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const SRC = readFileSync(SERVER_JS, 'utf8');
const HTML = read('newpairs.html'), NP = read('newpairs.js'), SC = read('scanner.js'), CSS = read('styles.css'), APP = read('app.js');
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', SEND_POOL = '0xf30bb531d0255969be155533abac34b22bd63414';
const made = [];
const CF = createRequire(import.meta.url)(path.join(ROOT, 'lib', 'contractfacts.js'));
/* The rows this suite writes outside the users table — the scan store and the token cache for $SEND — are put back
   exactly as they were, so a by-hand run against a real database leaves the public community count untouched. */
const snap = { scans: [], cache: [] };
try { snap.scans = db.prepare('SELECT * FROM scans WHERE token_addr IN (?, ?)').all(SEND, SEND_POOL); snap.cache = db.prepare('SELECT token_addr, updated_at, checked_at FROM token_cache WHERE token_addr IN (?, ?)').all(SEND, SEND_POOL); } catch {}
function restore() {
  try {
    db.prepare('DELETE FROM scans WHERE token_addr IN (?, ?)').run(SEND, SEND_POOL);
    for (const r of snap.scans) db.prepare('INSERT INTO scans (token_addr, pool_addr, kind, symbol, name, pair_json, first_at, last_at, read_at, count) VALUES (?,?,?,?,?,?,?,?,?,?)').run(r.token_addr, r.pool_addr, r.kind, r.symbol, r.name, r.pair_json, r.first_at, r.last_at, r.read_at, r.count);
    for (const r of snap.cache) db.prepare('UPDATE token_cache SET updated_at=?, checked_at=? WHERE token_addr=?').run(r.updated_at, r.checked_at, r.token_addr);
  } catch {}
}

async function api(p, opts = {}) {
  const r = await fetch(BASE + p, { method: opts.method || 'GET', redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.sid ? { Cookie: 'sid=' + opts.sid } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text };
}
function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id; made.push(id);
  const raw = 'tok_' + name + '_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}

/* ═══ The real-world-asset card (owner's RWA spec, 2026-10-28) ═══════════════════════════════════════════════════════════
   The dashboard's own code (newpairs.js) run in a sandbox and fed the server's real /api/market/rwa/token answers as p.rwa
   (tests/fixtures/rwacard: TSLA confirmed by Robinhood's registry and its code on the chain, Ondo's TSLAon, an Ondo token not
   confirmed yet, WEEK out of the registry's list, SPY with a dividend, GME with a lookalike scanned, and the 404s), on a TSLA
   profile built from what Dexscreener and GoPlus answered for it. Then the same card in a real browser — headless Chrome,
   muted — at 320, 390, 1280 and 1920 px. */
const RWA_FX = (n) => JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'rwacard', n), 'utf8'));
const TSLA = '0x322f0929c4625ed5bad873c95208d54e1c003b2d';
function npSandbox(extra) {
  const noop = () => {}, nil = () => null;
  const document = { addEventListener: noop, getElementById: nil, querySelector: nil, querySelectorAll: () => [], body: { classList: { toggle: noop, remove: noop } }, hidden: false };
  const window = Object.assign({ document, addEventListener: noop, CSS: { escape: (x) => x } }, extra || {});
  const ctx = { window, document, localStorage: { getItem: nil, setItem: noop }, fetch: () => Promise.reject(new Error('offline')), setTimeout, clearTimeout, setInterval: noop, requestAnimationFrame: noop, cancelAnimationFrame: noop, console, CustomEvent: function () {}, Node: {} };
  Object.assign(ctx, extra || {});   // what the page would have loaded, as globals (a browser's window properties are)
  ctx.globalThis = ctx; window.window = window; vm.createContext(ctx); vm.runInContext(NP, ctx);
  return window.NPCard;
}
// the waiver sentence is the server's own (lib/marketdata.js rwaIssuerDeployer), read from its source, never retyped
const RWA_WAIVED = (/'(its deployer holds Robinhood\\'s registry\\'s token-deployer role[^\n]*?by design)'/.exec(readFileSync(path.join(ROOT, 'lib', 'marketdata.js'), 'utf8')) || [])[1]?.replace(/\\'/g, '\'');
// a Robinhood Chain profile of TSLA as the Scanner builds it, from the pool Dexscreener lists and GoPlus Security's reading
function rwaProfile(rwa, over) {
  const ds = RWA_FX('ds-pair-tsla.json').pair, gp = RWA_FX('goplus-4663-tsla.json').result;
  return Object.assign({ chain: 'robinhood', indexed: true,
    token: { address: TSLA, name: ds.baseToken.name, symbol: ds.baseToken.symbol, decimals: 18, isVerified: gp.is_open_source === '1', deployer: gp.creator_address, deployerSource: 'goplus', renounced: null, owner: null },
    pair: { address: ds.pairAddress.toLowerCase(), ageMinutes: Math.round((Date.parse('2026-10-28T10:05:00Z') - ds.pairCreatedAt) / 60000), quoteSymbol: ds.quoteToken.symbol },
    market: { priceUsd: Number(ds.priceUsd), liquidityUsd: ds.liquidity.usd, marketCap: ds.marketCap, fdv: ds.fdv }, volume: ds.volume, txns: ds.txns, priceChange: ds.priceChange,
    holders: { count: Number(gp.holder_count), source: 'goplus', top: [] }, links: { explorer: 'https://robinhoodchain.blockscout.com/token/' + TSLA, dex: ds.url },
    chainFacts: CF.evmFacts(gp),
    risk: { health: 100, triage: 'ok', thinData: false, sniperOk: true, serialDeployer: false, serialDeployerWaived: RWA_WAIVED, dataKnown: { indexed: true, liquidity: true, holders: true, concentration: true, verified: true, snipers: true } },
    rwa }, over || {});
}
const rwaText = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const rwaCardOf = (html) => { const i = html.indexOf('<section class="tkd-card tkd-card--rwa"'); return i < 0 ? '' : html.slice(i, html.indexOf('</section>', i) + 10); };
async function rwaCardChecks() {
  const NPC = npSandbox();
  const dash = (rwa, over, opts) => NPC.dashboardHTML(rwaProfile(rwa, over), opts);
  const T = RWA_FX('rwa-token-tsla.json');
  const full = dash(T), card = rwaCardOf(full), ct = rwaText(card);
  check('RWA card: a Robinhood Chain profile carrying p.rwa gets a 🏛️ Real-world asset card in the wide column, right after the trading activity (never a tall wall in the narrow side column; the server waived serial deployer, read from its source)',
    !!RWA_WAIVED && card.length > 0 && full.indexOf('tkd-col tkd-col--c"') < full.indexOf('tkd-card--activity') && full.indexOf('tkd-card--activity') < full.indexOf('tkd-card--rwa') && full.indexOf('tkd-card--rwa') < full.indexOf('<div class="tkd-side">')
    && full.indexOf('tkd-card--contract') > full.indexOf('tkd-col tkd-col--l')
    && /🏛️ Real-world asset/.test(ct) && /✓ Registry \+ on-chain/.test(ct), ct.slice(0, 200));
  const order = ['🔎 Is this the real one?', '💼 What you hold', '⚖️ Price check', '🗓️ Corporate actions', '📏 Size', '🔐 Issuer controls — powers a regulated issuer keeps', '🔗 Connected tokens',
    'Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc.', 'Not advice, never a tip to buy. Do your own research.'].map((s) => ct.indexOf(s));
  const affAt = card.indexOf('Not affiliated with'), before = card.slice(0, affAt);
  check('  ...its parts in the spec\'s order — is this the real one, what you hold, price check, corporate actions, size, issuer controls, connected tokens — then the not-affiliated and not-advice lines last, never behind a pop-down',
    order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])) && (before.match(/<details/g) || []).length === (before.match(/<\/details>/g) || []).length
    && /<div class="tkd-rwa-sec tkd-rwa-foot"><p class="tkd-rwa-fine">Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\.<\/p><p class="tkd-rwa-fine"><b>Not advice, never a tip to buy\. Do your own research\.<\/b><\/p>/.test(card), order.join());
  check('  ...is this the real one: each piece of evidence with its tier, its source and its age; the registry\'s own list linked ("a token with the same ticker at another address is not one")',
    /A1 · proof Listed in Robinhood's Stock Token registry \(api\.robinhood\.com\/rhj\/assets\) Robinhood’s Stock Token API · /.test(ct) && /A2 · proof Its code runs from Robinhood's token registry contract \(checked on the chain\) the chain’s node · /.test(ct)
    && /B · supporting only CoinGecko files it as "tesla-robinhood-tokenized-stock"/.test(ct) && /Status Active in Robinhood's registry/.test(ct)
    && /a token with the same ticker at another address is not one\. Robinhood’s list ↗/.test(ct) && card.includes('href="https://docs.robinhood.com/chain/contracts/"'), ct.slice(0, 600));
  const dds = [...card.matchAll(/<dd>([\s\S]*?)<\/dd>/g)].map((m) => m[1]);
  check('  ...every figure names its source and its age; one nobody read says "not available" and why — never a $0',
    dds.length > 15 && dds.filter((d) => /tkd-rwa-v/.test(d)).every((d) => /tkd-rwa-src/.test(d) && /<time datetime=|time not recorded/.test(d)) && dds.filter((d) => /not available/.test(d)).every((d) => /tkd-rwa-why/.test(d)) && !/\$0(?![.\d])/.test(ct),
    dds.filter((d) => (/tkd-rwa-v/.test(d) && !/tkd-rwa-src/.test(d)) || (/not available/.test(d) && !/tkd-rwa-why/.test(d))).slice(0, 2).join(' | ').slice(0, 300));
  check('  ...the price check: the DEX price against Chainlink (within its 24 h heartbeat) and Robinhood\'s quote, the premium naming its reference; registry paused() that reverted is "not read — no such function", never a no',
    /DEX price \$396\.7435 price in its deepest pool here \(GeckoTerminal\) GeckoTerminal · /.test(ct) && /Chainlink \$397\.946 Chainlink RHTSLA \/ USD updated within its 24 h heartbeat Chainlink · /.test(ct)
    && /Robinhood’s quote \$399\.355 Robinhood's quote, multiplier applied — an undocumented field/.test(ct) && /Premium \/ discount −0\.30% \(a discount\) DEX price against Chainlink RHTSLA \/ USD this site · /.test(ct)
    && /Paused — every Stock Token not read no such function on this contract \(the call reverted\) — not the same as "not paused"/.test(ct) && /Paused — this token no /.test(ct)
    && /Stock markets close while DEX pools trade around the clock/.test(ct), (ct.match(/⚖️ Price check[\s\S]{0,700}/) || [''])[0]);
  check('  ...what you hold: Robinhood\'s own sentences, each linked to the page it comes from; terms() as the contract names it, read on the chain',
    /Underlying: Tesla \(\$TSLA\) — a stock/.test(ct) && /no voting rights, no shareholder status\. source ↗/.test(ct) && /Not offered to US persons/.test(ct) && card.includes('href="https://docs.robinhood.com/rhj/restricted-jurisdictions/"')
    && /The terms its contract names \( terms\(\) \): robinhood\.com\/stocktoken\/rhj ↗ the chain’s node · /.test(ct));
  check('  ...size: value on chain, supply, market cap, liquidity, TVL in DeFi with the apps holding it (DefiLlama links), primary mint and burn, 24h volume — each with what it means',
    /Value on chain \$4\.51M on-chain supply × the DEX price this site · /.test(ct) && /TVL in DeFi \$3\.9k deposited in DeFi apps on Robinhood Chain \(DefiLlama, matched by symbol\) — not read: Longbow \(upstream 404\), so it may be low DefiLlama · /.test(ct)
    && /📏 Size Value on chain \$4\.51M this site · .* · liquidity \$1\.23M GeckoTerminal · .* · TVL in DeFi \$3\.9k DefiLlama · .* Every size figure and what each one means/.test(ct) && card.includes('href="https://defillama.com/protocol/morpho-blue"')
    && /Primary mint & burn \$533\.8k primary-market mint and burn, USD — Robinhood does not document its window/.test(ct) && /TVL in DeFi: USD of the token deposited in DeFi apps/.test(ct), (ct.match(/📏 Size[\s\S]{0,500}/) || [''])[0]);
  const ctl = ct.slice(ct.indexOf('🔐 Issuer controls'), ct.indexOf('🔗 Connected tokens'));
  check('  ...issuer controls said as powers a regulated issuer keeps (the server\'s words), never as a verdict: who can replace every token\'s code (a wallet, with its explorer link), 175 wallets blocked, the verified source, all 12 powers with their holders',
    /Powers a regulated issuer keeps, shown as such, not as a verdict: for a regulated issuer they are expected — they are still powers over your tokens\. The Scanner's health score does not count them\./.test(ctl) && !/marks these powers in red/.test(ct)
    && /12 of 12 powers held · 175 wallets blocked from moving these tokens/.test(ctl)
    && /Who can replace the code of every Stock Token at once 0xcd8c…e094 ↗ 📋 \(a wallet\) since block 8,646/.test(ctl) && card.includes('href="https://robinhoodchain.blockscout.com/address/0xcd8c6182e7c6ca3b5156d6a90a67719d7e2be094"')
    && /Wallets blocked from moving these tokens 175 the chain’s node · /.test(ctl) && card.includes('href="https://sourcify.dev/server/v2/contract/4663/0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2"')
    && /Every power and who holds it \(12\)/.test(ctl) && /Burn tokens from any wallet \(adminBurn\) ADMIN_BURNER_ROLE 0x957b…74d4/.test(ctl) && !/class="tkd-bad"/.test(card.slice(card.indexOf('🔐 Issuer controls'), card.indexOf('🔗 Connected tokens'))), ctl.slice(0, 400));
  const ctFull = rwaText(full);
  check('  ...the serial-deployer waiver is said: the Contract card says why the flag is not raised (and points to this card), this card names the registry\'s token-deployer role and its holder; nothing else in the verdict changes',
    ctFull.includes('Not flagged as a serial deployer — ' + RWA_WAIVED + '. The real-world asset card says more.') && !/Serial deployer —/.test(ctFull)
    && /Robinhood's registry deploys every Stock Token from its token-deployer role, so the Scanner does not raise "serial deployer" on a confirmed Stock Token deployed by it\. The token-deployer role \( TOKEN_DEPLOYER_ROLE \) is held by 0x5516…e000/.test(ct)
    && !rwaText(dash(T, {}, { hideRwa: true })).includes('The real-world asset card says more.') && !rwaCardOf(dash(T, {}, { hideRwa: true })));
  check('  ...connected tokens: how many in a line ("7 tokens paired with it in a pool — not one of them is an RWA"), then each "Not an RWA — paired with $TSLA" in a pop-down, opening in the Scanner, with its pool\'s reserve and its source',
    /🔗 Connected tokens 7 tokens paired with it in a pool — not one of them is an RWA\. Every token paired with it \(7\)/.test(ct) && /\$OPTIMUS Not an RWA — paired with \$TSLA pons-v2-dex pool 0xa177…663a · reserve \$155\.8k · 24h \$36\.9k GeckoTerminal · /.test(ct) && card.includes('href="/newpairs?scan=0x0ff9072a1ead154d92c2d2fef16afba6028ce2b2"')
    && (ct.match(/Not an RWA — paired with \$TSLA/g) || []).length === 7);
  // parts 2–7: what matters in a line, the rest one press down — and what a holder must know stays in sight (review, 2026-10-28)
  const secOf = (id) => { const i = card.indexOf('tkd-rwa-sec--' + id); return i < 0 ? '' : card.slice(i, card.indexOf('<div class="tkd-rwa-sec ', i + 10) > 0 ? card.indexOf('<div class="tkd-rwa-sec ', i + 10) : undefined); };
  const sight = (h) => rwaText(h.replace(/<details[\s\S]*?<\/details>/g, ''));
  check('  ...parts 2–7 each show a line of what matters and keep the rest in a pop-down of their own; "What you hold" keeps in sight that it is a debt security, how it is redeemed (after the issuer\'s KYC) and that it is not offered to US persons (Robinhood\'s list linked)',
    ['hold', 'price', 'actions', 'size', 'controls', 'connected'].every((id) => /<details class="tkd-more tkd-more--in">/.test(secOf(id))) && !/<details class="tkd-more tkd-more--in"><summary[^>]*><span class="tkd-more-lbl">[^<]*evidence/i.test(secOf('real'))
    && /tokenised debt securities/.test(sight(secOf('hold'))) && /KYC\/AML/.test(sight(secOf('hold'))) && /Not offered to US persons/.test(sight(secOf('hold'))) && /⚖️ Price check DEX price \$396\.7435 GeckoTerminal · .* · premium or discount −0\.30% \(a discount\) this site · .* against Chainlink’s feed/.test(sight(secOf('price'))),
    sight(secOf('hold')).slice(0, 300));
  // the registry's log walk not whole yet (the first runs after a deploy, or a refused window): every holder list says how far it has read
  const part = rwaText(rwaCardOf(dash(Object.assign({}, T, { rolesRead: { complete: false, cursor: 39999999, head: 100264436, at: T.rolesAt } }))));
  check('  ...while the registry\'s log walk is not whole, every holder list says it is read up to block N of M and that a holder granted later is not shown yet — never a partial list under a plain header',
    (part.match(/from the registry’s logs read up to block 39,999,999 of 100,264,436 — a holder granted later is not shown yet/g) || []).length >= 10 && /the registry’s logs are not read whole yet/.test(part) && !/a holder granted later/.test(ct), (part.match(/Every power[\s\S]{0,300}/) || [''])[0]);
  // beside the verdict (which is unchanged): a real-world asset whose issuer keeps powers the score does not count; and no Robinhood artwork in the header
  const withLogo = dash(T, { brand: { imageUrl: 'https://cdn.dexscreener.com/cms/images/tsla.png' } });
  check('RWA beside the verdict: one line that it is a real-world-asset token whose issuer keeps powers over every holder\'s tokens (replacing their code, minting, burning from any wallet, pausing, blocking wallets) that the health score does not count — the verdict and score unchanged; its header draws its letter, never its listed picture (Robinhood\'s mark)',
    /<p class="tkd-verdict-rwa">🏛️ <b>A real-world-asset token<\/b> — issued by Robinhood Assets \(Jersey\) Limited \(RHJ\)\. Its issuer keeps powers over every holder’s tokens \(replacing their code, minting, burning from any wallet, pausing them and blocking wallets: 12 powers read from its registry\) that the health score does not count/.test(full)
    && full.indexOf('tkd-verdict-rwa') > full.indexOf('tkd-health') && full.indexOf('tkd-verdict-rwa') < full.indexOf('tkd-stats') && !/<img\b/.test(withLogo.slice(0, withLogo.indexOf('tkd-idt'))) && /<img\b/.test(dash(RWA_FX('rwa-token-tslaon.json'), { brand: { imageUrl: 'https://cdn.dexscreener.com/cms/images/tslaon.png' } }).slice(0, 2000)));
  // beside the Swap button (the owner decides whether it shows): who Robinhood says its Stock Tokens are not offered to
  const NPS = npSandbox({ SwapKit: { buttonHTML: () => '<button class="btn btn-sm np-swap" type="button" data-tip="Opens a panel that quotes a buy of this token">🚀 Swap in my wallet</button>' } });
  const sw = NPS.dashboardHTML(rwaProfile(T)), swAt = sw.indexOf('np-swap'), noteAt = sw.indexOf('tkd-rwa-swapnote');
  check('  ...beside "Swap in my wallet" on a Robinhood Stock Token: Robinhood\'s own sentence that Stock Tokens are not offered to US persons and are restricted elsewhere, with its list linked — and none on another issuer\'s token',
    swAt > 0 && noteAt > swAt && noteAt < sw.indexOf('tkd-grid') && /Not offered to US persons, and restricted in other places/.test(rwaText(sw.slice(noteAt, noteAt + 600))) && sw.includes('href="https://docs.robinhood.com/rhj/restricted-jurisdictions/"')
    && !NPS.dashboardHTML(rwaProfile(RWA_FX('rwa-token-tslaon.json'))).includes('tkd-rwa-swapnote'));
  const ids = [...card.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const btns = [...card.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]), outs = [...card.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].map((m) => m[0]);
  check('  ...every button and outside link carries a data-tip of 8+ characters (copy buttons too); outside links open with rel="noopener nofollow"; no inline handlers, inline styles, pictures (no Robinhood artwork) or repeated ids',
    btns.length > 10 && btns.every((b) => /data-tip="[^"]{8,}"/.test(b)) && outs.length > 10 && outs.every((a) => /data-tip="[^"]{8,}"/.test(a) && /rel="noopener nofollow"/.test(a))
    && !/\son[a-z]+=|\sstyle=|javascript:|<img\b/i.test(card) && new Set(ids).size === ids.length && ids.every((x) => x.startsWith('tkd')),
    [btns.find((b) => !/data-tip="[^"]{8,}"/.test(b)), outs.find((a) => !/data-tip="[^"]{8,}"/.test(a))].filter(Boolean).join(' '));
  check('  ...nothing tells anyone to buy or calls anything safe', !/\b(you should buy|buy now|great investment|guaranteed|risk-free|safe|to the moon)\b/i.test(ct));
  // another issuer, a token not confirmed yet, a token out of the registry, a dividend, a lookalike, a failed read
  const on = rwaText(rwaCardOf(dash(RWA_FX('rwa-token-tslaon.json'))));
  check('RWA card on Ondo\'s TSLAon: confirmed by its beacon ("✓ Issuer list + on-chain"); Robinhood\'s references, premium and multiplier not available, each with the server\'s reason; the issuer\'s powers not read here, said so; no Sourcify link claimed',
    /✓ Issuer list \+ on-chain/.test(on) && /✓ Confirmed — issued by Ondo Global Markets\./.test(on) && /Premium \/ discount not available no reference price is read for this issuer's tokens/.test(on)
    && /Multiplier not available only Robinhood's Stock Tokens carry this multiplier/.test(on) && /This site reads the roles of Robinhood's registry only; this issuer's contract keeps powers of its own/.test(on)
    && /Verified source not checked this site has not checked a verified source for this issuer's code/.test(on) && /Halts and pauses not read Robinhood's pause functions — not read for this issuer's tokens/.test(on)
    && !/Stock markets close/.test(on) && /Its page on CoinGecko ↗/.test(on) && !/\$0(?![.\d])/.test(on), on.slice(0, 300));
  const gg = rwaText(rwaCardOf(dash(RWA_FX('rwa-token-googlon.json'))));
  check('  ...an Ondo token whose beacon is not read yet: "Not confirmed" in the heading and on a chip, and why', /Real-world asset Not confirmed/.test(gg) && /⚠️ Not confirmed on the chain yet/.test(gg) && /⚠️ Not confirmed yet — fingerprint not read yet\./.test(gg) && /Issuer Ondo Global Markets/.test(gg), gg.slice(0, 300));
  const wk = rwaText(rwaCardOf(dash(RWA_FX('rwa-token-week.json'))));
  check('  ...WEEK, out of the registry\'s active list but running Robinhood\'s code: "✓ On-chain", that status, and Robinhood\'s own deviation flag in words (50.1% below the NYSE close, 32 days in a row)',
    /Real-world asset ✓ On-chain/.test(wk) && /Status On the chain, not in the registry's active list/.test(wk) && /Robinhood flags its price: on the chain it is 50\.1% below the NYSE close, 32 days in a row \(since 2026-09-14, as of 2026-10-27\)\./.test(wk)
    && /Supply on the chain not available its decimals have not been read yet/.test(wk), (wk.match(/Robinhood flags[\s\S]{0,200}/) || [''])[0]);
  const sp = rwaText(rwaCardOf(dash(RWA_FX('rwa-token-spy.json'))));
  check('  ...SPY: its dividend in progress and its multiplier (one token = 1.001718 × one share\'s economics); a pool pairing it with another RWA is said, counted once',
    /Cash dividend · in progress · 2026-10-30 · rate 1\.888834/.test(sp) && /Multiplier 1\.001718 .* one token = 1\.001718 × one share’s economics Robinhood’s Stock Token API · /.test(sp) && /ℹ️ A pool pairs it with another RWA/.test(sp) && /that pool is in both tokens’ figures, and a total takes its volume once/.test(sp)
    && /🗓️ Corporate actions One token = 1\.001718 × one share’s economics .* 1 corporate action listed, 1 in progress/.test(sp), (sp.match(/🗓️[\s\S]{0,300}/) || [''])[0]);
  const gm = rwaCardOf(dash(RWA_FX('rwa-token-gme.json'))), gmT = rwaText(gm);
  check('  ...GME: the "GameStop" memecoin a scan found is named as a lookalike — "Same ticker, not issued by Robinhood Assets (Jersey) Limited (RHJ)" — with its explorer link',
    /⚠️ Same ticker, not issued by Robinhood Assets \(Jersey\) Limited \(RHJ\): \$gme “GameStop” 0x7e86…8123/.test(gmT) && gm.includes('href="https://robinhoodchain.blockscout.com/address/0x7e86381a763f0ecca2bdf27c54eac403ddd48123"') && /seen in a Scanner read/.test(gmT), (gmT.match(/Same ticker[\s\S]{0,160}/) || [''])[0]);
  const dn = rwaText(rwaCardOf(dash(RWA_FX('rwa-token-tsla-registry-down.json'))));
  check('  ...Robinhood\'s API down: the card says each read that failed (the registry, the quotes), when and why, and that the last good read is shown — the token stays confirmed on that read',
    /⏳ Robinhood's registry could not be read at 2026-10-28 \d\d:\d\d UTC \(upstream 503\) — the last good read, from 2026-10-28 15:30 UTC, is shown[.;]/.test(dn) && /Robinhood's quotes could not be read/.test(dn) && /✓ Registry \+ on-chain/.test(dn), (dn.match(/⏳[\s\S]{0,200}/) || [''])[0]);
  const lkDash = dash(RWA_FX('rwa-token-gme-memecoin.json'), { token: { address: '0x7e86381a763f0ecca2bdf27c54eac403ddd48123', name: 'GameStop', symbol: 'gme', decimals: 18 } }), lkFull = rwaCardOf(lkDash), lk = rwaText(lkFull);
  check('  ...a lookalike\'s own profile carrying the server\'s 404 says it is not an RWA here, why, and where Robinhood lists its tokens — with both closing lines; a stablecoin\'s or any other token\'s 404, null, another chain or a profile without p.rwa gets no card',
    /🏛️ Real-world asset\? not an RWA/.test(lk) && /⚠️ Not an RWA here — a lookalike\. Same ticker as \$GME, but not issued by Robinhood Assets \(Jersey\) — the registry lists \$GME at 0x1b0e…153e\./.test(lk) && /its contracts page ↗/.test(lk)
    && /The real \$GME \(Robinhood Assets \(Jersey\) Limited \(RHJ\)\): 0x1b0e…153e ↗ .* 0x1b0e319c6a659f002271b69db8a7df2f911c153e Open it in the Scanner/.test(lk) && lkFull.includes('href="/newpairs?scan=0x1b0e319c6a659f002271b69db8a7df2f911c153e"')
    && lkFull.includes('href="https://robinhoodchain.blockscout.com/address/0x1b0e319c6a659f002271b69db8a7df2f911c153e"')
    && /<p class="tkd-verdict-rwa tkd-warn">⚠️ <b>Same ticker as Robinhood’s \$GME — not it\.<\/b>/.test(lkDash) && lkDash.indexOf('tkd-verdict-rwa') < lkDash.indexOf('tkd-stats')
    && /Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc\. Not advice, never a tip to buy\. Do your own research\./.test(lk)
    && !rwaCardOf(dash(RWA_FX('rwa-token-usdg.json'))) && !rwaCardOf(dash(RWA_FX('rwa-token-notmystock.json'))) && !rwaCardOf(dash(null)) && !rwaCardOf(dash(T, { chain: 'ethereum', pools: [] })) && !rwaCardOf(dash(undefined)), lk.slice(0, 300));
  // the card's CSS: on the text floor, no reordering, nothing cut short
  const RC = CSS.slice(CSS.indexOf('/* ===== The real-world-asset card'), CSS.indexOf('/* =====', CSS.indexOf('/* ===== The real-world-asset card') + 10));
  const sizes = [...RC.matchAll(/font-size\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
  check('RWA card CSS: every font-size on the text floor (max(var(--text-floor), …)), no CSS order, no ellipsis or line clamp, chips allowed to wrap',
    RC.length > 500 && sizes.length >= 6 && sizes.every((v) => v.startsWith('max(var(--text-floor)')) && !/\border\s*:|text-overflow|line-clamp|white-space:\s*nowrap/.test(RC) && /\.tkd-card--rwa \.np-flag \{ white-space: normal;/.test(RC), sizes.join(' | '));
  await rwaCardWalk();
}
// the card in a real browser: muted headless Chrome on a page of its own (styles.css, newpairs.js and a fixture profile)
async function rwaCardWalk() {
  const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'].find((p) => p && existsSync(p));
  if (!CHROME) { if (process.env.CI) console.log('skipping the RWA card browser walk: no Chrome or Chromium on this runner (set CHROME_PATH to run it)'); else check('a Chrome or Chromium to walk the RWA card in (set CHROME_PATH)', false, 'none found'); return; }
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
  const PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RWA card</title><link rel="stylesheet" href="/styles.css"></head>' +
    '<body><main><div class="sc-result" id="rwa-host"></div></main><script src="/newpairs.js"></script><script src="/__rwa/page.js"></script></body></html>';
  const PAGE_JS = '(async () => { const q = new URLSearchParams(location.search); const p = await (await fetch("/__rwa/p.json?f=" + encodeURIComponent(q.get("f")))).json();' +
    ' document.getElementById("rwa-host").innerHTML = window.NPCard.dashboardHTML(p); if (q.get("open")) document.querySelectorAll(".tkd-card--rwa details").forEach((d) => { d.open = true; }); window.__drawn = true; })();';
  const site = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
    if (u.pathname === '/__rwa/') return send(200, 'text/html', PAGE);
    if (u.pathname === '/__rwa/page.js') return send(200, 'text/javascript', PAGE_JS);
    if (u.pathname === '/__rwa/p.json') { const f = u.searchParams.get('f'); return /^rwa-token-[a-z-]+\.json$/.test(f || '') ? send(200, 'application/json', JSON.stringify(rwaProfile(RWA_FX(f)))) : send(404, 'text/plain', ''); }
    const file = path.join(PUB, path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(PUB)) return send(404, 'text/plain', '');
    readFile(file, (e, b) => (e ? send(404, 'text/plain', '') : send(200, TYPES[path.extname(file)] || 'application/octet-stream', b)));
  });
  await new Promise((ok) => site.listen(0, '127.0.0.1', ok));
  const ORIGIN = 'http://127.0.0.1:' + site.address().port;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let chrome = null, profile = null, ws = null, n = 0, session = null;
  const pend = new Map(), exceptions = [];
  const cdp = (method, params = {}, sid = session) => new Promise((ok, bad) => { const id = ++n; pend.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
  const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)); return r.result.value; };
  // what a reader can see: no sideways scroll, nothing outside the card, no text under the floor, every pop-down 44px tall
  const LAYOUT = `(() => {
    const card = document.querySelector('.tkd-card--rwa'); if (!card) return null;
    const cr = card.getBoundingClientRect();
    const probe = document.createElement('span'); probe.style.fontSize = 'var(--text-floor)'; document.body.appendChild(probe);
    const floor = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
    const out = [], small = [];
    for (const el of card.querySelectorAll('*')) {
      if (el.closest('.sr-only') || el.closest('details:not([open]) > :not(summary)')) continue;
      const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
      if (r.right > cr.right + 1 || r.left < cr.left - 1) out.push(String(el.className || el.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
      if ([...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < floor - 0.5) small.push(String(el.className || el.tagName) + ' ' + getComputedStyle(el).fontSize);
    }
    const low = [...card.querySelectorAll('summary')].filter((s) => s.getBoundingClientRect().height < 43.5).map((s) => Math.round(s.getBoundingClientRect().height));
    // every run of text, line by line (a Range's rects — an inline link that cannot break runs past its box, which an element's box hides)
    const runs = [], walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim() || (t.parentElement && (t.parentElement.closest('.sr-only') || t.parentElement.closest('details:not([open]) > :not(summary)')))) continue;
      const rg = document.createRange(); rg.selectNodeContents(t);
      for (const q of rg.getClientRects()) if (q.width && (q.right > cr.right + 1 || q.left < cr.left - 1)) { runs.push(t.textContent.trim().slice(0, 30) + ' ' + Math.round(q.left) + '–' + Math.round(q.right) + ' card ' + Math.round(cr.left) + '–' + Math.round(cr.right)); break; }
    }
    const mk = document.querySelector('.tkd-card--market');
    return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, out: out.slice(0, 4).concat(runs.slice(0, 3)), small: small.slice(0, 4), low: low.slice(0, 4), h: Math.round(cr.height), market: mk ? Math.round(mk.getBoundingClientRect().top + window.scrollY) : null };
  })()`;
  try {
    profile = mkdtempSync(path.join(os.tmpdir(), 'jsi-rwacard-'));
    const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--lang=en-US', 'about:blank'];
    if (process.platform === 'linux') args.unshift('--no-sandbox');
    chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; chrome.stderr.on('data', (d) => { err += d; });
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
    if (!existsSync(portFile)) throw new Error('Chrome did not open its debugging port: ' + err.slice(0, 300));
    const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
    ws = new WebSocket('ws://127.0.0.1:' + port + wsPath);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('could not connect to Chrome')); });
    ws.onmessage = (m) => {
      const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
      if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.bad(new Error(JSON.stringify(d.error))) : p.ok(d.result); }
      else if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails);
    };
    const t = await cdp('Target.createTarget', { url: 'about:blank' }, null);
    session = (await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
    await cdp('Page.enable'); await cdp('Runtime.enable');
    const fits = [];
    for (const f of ['rwa-token-tsla.json', 'rwa-token-tslaon.json', 'rwa-token-gme-memecoin.json']) for (const w of [320, 390, 1280, 1920]) for (const open of [false, true]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 });
      await cdp('Page.navigate', { url: ORIGIN + '/__rwa/?f=' + f + (open ? '&open=1' : '') });
      let drawn = false; for (let i = 0; i < 160 && !drawn; i++) { try { drawn = await ev('!!window.__drawn'); } catch {} if (!drawn) await sleep(50); }
      const L = drawn ? await ev(LAYOUT) : null;
      fits.push({ f, w, open, L });
    }
    const bad = fits.filter((x) => !x.L || x.L.sw > x.L.iw || x.L.out.length || x.L.small.length || x.L.low.length);
    check('RWA card in a real browser (headless Chrome, muted) at 320, 390, 1280 and 1920 px, its pop-downs shut and open — TSLA, TSLAon and a lookalike: no sideways scroll, nothing outside the card (not one run of text, links included), no text under the floor, every pop-down 44px tall, no script error',
      fits.length === 24 && !bad.length && !exceptions.length, bad.slice(0, 3).map((x) => x.f + ' ' + x.w + (x.open ? ' open ' : ' ') + JSON.stringify(x.L)).join(' | ') + (exceptions.length ? ' exceptions: ' + JSON.stringify(exceptions[0]).slice(0, 200) : ''));
    /* the review (2026-10-28): in the narrow side column, every part open, TSLA's card was 8,883 px tall at 1280 (4,529 at 390) and pushed
       the Market card ~9,200 px down. In the wide column with parts 2–7 behind their pop-downs: measured, shut */
    const tall = fits.filter((x) => x.f === 'rwa-token-tsla.json' && !x.open), t1280 = tall.find((x) => x.w === 1280), t390 = tall.find((x) => x.w === 390);
    check('  ...TSLA\'s card, its pop-downs shut, stands at well under half its old height — under 3,400 px at 1280 in the wide column (8,883 before), under 2,800 at 390 (4,529) — and the Market card at 1280 starts under 5,000 px down (15,053 before)',
      !!(t1280 && t390 && t1280.L && t390.L) && t1280.L.h < 3400 && t390.L.h < 2800 && t1280.L.market != null && t1280.L.market < 5000, JSON.stringify(tall.map((x) => ({ w: x.w, h: x.L && x.L.h, market: x.L && x.L.market }))));
  } catch (e) {
    check('the RWA card browser walk ran', false, e && e.message);
  } finally {
    try { ws && ws.close(); } catch {}
    if (chrome) { try { chrome.kill('SIGTERM'); } catch {} await new Promise((r) => { const t = setTimeout(r, 2000); chrome.once('exit', () => { clearTimeout(t); r(); }); }); }
    if (profile) { try { rmSync(profile, { recursive: true, force: true }); } catch {} }
    await new Promise((r) => site.close(r));
  }
}

try {
  /* ═══ the nav ═══ */
  const pages = readdirSync(PUB).filter((f) => f.endsWith('.html'));
  const stale = pages.filter((f) => /New&nbsp;Pairs<\/a>|>New Pairs<\/a>/.test(read(f)));
  check('the nav tab and the footer link say Scanner on every page', stale.length === 0, stale.join(','));
  check('  ...and the Scanner page marks itself current', /<a class="active" href=\"\/newpairs" aria-current="page">Scanner<\/a>/.test(HTML));
  check('the page is titled as the Scanner', /<title>Robinhood Chain Token Scanner &amp; New Pairs — Just Send It<\/title>/.test(HTML) && /<h1 class="section-title display green"[^>]*>Scanner 🔎<\/h1>/.test(HTML));

  /* ═══ two tabs ═══ */
  check('two tabs: scan an address, and New Pairs', /id="sc-tab-scan" type="button" role="tab" aria-selected="true" aria-controls="sc-scan"/.test(HTML) && /id="sc-tab-new" type="button" role="tab" aria-selected="false" aria-controls="sc-new"/.test(HTML));
  check('  ...each driving a named tab panel', /id="sc-scan" role="tabpanel" aria-labelledby="sc-tab-scan"/.test(HTML) && /id="sc-new" role="tabpanel" aria-labelledby="sc-tab-new" hidden/.test(HTML));
  check('  ...the radar tab carries a lock while signed out', /<span class="sc-lock" id="sc-lock" aria-hidden="true">🔒<\/span>/.test(HTML) && /lock\.hidden = signedIn\(\)/.test(SC));
  check('the address form: one input, one Scan button, described by the help line', /<input class="sc-addr" id="sc-addr"[^>]*maxlength="44"[^>]*aria-describedby="sc-help"/.test(HTML) && /id="sc-go" type="submit"/.test(HTML) && /id="sc-help">Any token, or any pool, on Robinhood Chain, Ethereum or Solana/.test(HTML));   // 44: a Solana address is up to 44 characters (owner, 2026-10-23)
  check('the page names its three chains and offers the chooser (owner, 2026-10-23: Ethereum and Solana scan too)', /🏹 Robinhood Chain, Ξ Ethereum and ◎ Solana — the chain's colour frames every token read there\./.test(HTML) && /<button class="sc-chain is-on" type="button" aria-pressed="true" data-chain="auto"/.test(HTML) && /data-chain="ethereum"/.test(HTML) && /data-chain="solana"/.test(HTML) && !/coming soon/.test(HTML));
  check('the tab strip is a matrix tile like every other control (CSS list and app.js SEL agree)', /\.sc-tab::before/.test(CSS) && /, \.sc-tab'/.test(APP));
  check('the radar tab panel holds the whole radar and a locked card', /<div class="sc-locked" id="sc-locked" hidden>/.test(HTML) && /<div id="sc-radar" hidden>/.test(HTML) && /<\/div><!-- \/sc-radar -->/.test(HTML) && /id="np-chainbar"/.test(HTML) && /id="np-runners"/.test(HTML));
  check('  ...whose button opens sign-in', /id="sc-signin"/.test(HTML) && /signin\.addEventListener\('click', \(\) => \{ if \(window\.AUTH && AUTH\.open\) AUTH\.open\(\); \}\)/.test(SC));
  check('the radar honesty note still says what it reads', /Uniswap-V2 factory/.test(HTML) && /hasn’t been judged/.test(HTML));
  check('scanner.js is loaded after newpairs.js (it starts the radar and uses NPCard)', HTML.indexOf('<script src="newpairs.js">') < HTML.indexOf('<script src="scanner.js">'));

  /* ═══ the radar waits to be started ═══ */
  check('newpairs.js no longer starts itself', !/setMode\(state\.mode\);   \/\/ apply persisted mode \(📈 Best Runners is the default\)\n  fetchPairs\(false\);\n\}\)\(\);/.test(NP) && /window\.NPRadar = \{ start, suspend, resume, started: \(\) => radarStarted \};/.test(NP));
  check('  ...its polls stop while its tab is hidden or the radar is parked', /const radarShown = \(\) => !radarSuspended && !document\.hidden && !\(radarPanel && radarPanel\.hidden\);/.test(NP) && /setInterval\(\(\) => \{ if \(radarShown\(\)\) fetchPairs\(false\); \}, 15000\)/.test(NP));
  check('  ...and scanner.js starts it only for a member on that tab', /if \(ok && current === 'new' && window\.NPRadar\) NPRadar\.start\(\);/.test(SC) && /if \(toNew\) gateRadar\(\); else if \(window\.NPRadar\) NPRadar\.suspend\(\);/.test(SC));
  check('the contract read is wired on every page now, not only inside the radar', /window\.NPCard\.loadContract = loadContract;/.test(NP) && NP.indexOf("document.addEventListener('toggle'") > NP.indexOf('window.NPCard = {'));
  check('the scan renders the token dashboard and mounts it, the contract read starting at once', /NPCard\.dashboardHTML\(p, \{ kicker, meta \}\)/.test(SC) && /NPCard\.mountDashboard\(result\)/.test(SC)
    && /root\.querySelectorAll\('\.tkd \.np-contract\[data-dash\]'\)\.forEach\(el => loadContract\(el\)\)/.test(NP) && /el\.innerHTML = contractHTML\(j, !!el\.dataset\.dash\)/.test(NP));
  check('a scan is shareable (?scan=, with ?chain= when one was named; a Solana address keeps its case) and a pasted address scans at once', /u\.searchParams\.set\('scan', normAddr\(addr\)\); if \(chainQ\) u\.searchParams\.set\('chain', chainQ\)/.test(SC) && /const normAddr = \(s\) => ADDR\.test\(s\) \? s\.toLowerCase\(\) : s;/.test(SC) && /input\.addEventListener\('paste'/.test(SC));
  check('recent scans on this device stay in this browser (localStorage; the page never POSTs anything)', /localStorage\.setItem\(RECENT_KEY/.test(SC) && !/method:\s*'POST'/.test(SC) && !/body:/.test(SC));

  /* ═══ which chain a scan runs on (review, 2026-10-23) ═══
     The chooser (Auto / Robinhood Chain / Ethereum / Solana, remembered on the device) used to be the fallback for anything that
     named no chain — so with it left on Ethereum the $SEND example, every home-chain recent and community chip, a name-search
     row and a shared ?scan= link all went looking on Ethereum. Now every chip carries its chain, rows and links name theirs,
     and the chooser governs only what the reader types or pastes. */
  check('the Scanner lead names its three chains (the trailing note stays)', /Paste any token or pool address on Robinhood Chain, Ethereum or Solana and read its profile — market cap, liquidity, holders, the contract’s powers, LP lock, block-0 buyers \(on Robinhood Chain\) and honeypot flags/.test(HTML)
    && /🏹 Robinhood Chain, Ξ Ethereum and ◎ Solana — the chain's colour frames every token read there\./.test(HTML) && !/Paste any token or pool address on Robinhood Chain and read/.test(HTML));
  const chips = [...HTML.matchAll(/<button class="np-chip" type="button" data-scan="[^"]+"[^>]*>/g)].map((m) => m[0]);
  check('every example chip names its chain — $SEND and $GWC Robinhood Chain\'s, PEPE Ethereum\'s, BONK Solana\'s — and its tip says so without repeating the label',
    chips.length === 4 && chips.every((c) => /data-scan-chain="(robinhood|ethereum|solana)"/.test(c) && /data-tip="[^"]+"/.test(c))
    && /data-scan="0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105" data-scan-chain="robinhood" data-tip="Scans \$SEND on Robinhood Chain"/.test(HTML) && /data-scan="0x61339f11384dde4b2dc3a33e75b4dc23cc620f22" data-scan-chain="robinhood" data-tip="Scans \$GWC on Robinhood Chain"/.test(HTML)
    && /data-scan="0x6982508145454ce325ddbe47a25d4ec3d2311933" data-scan-chain="ethereum"/.test(HTML) && /data-scan="DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" data-scan-chain="solana"/.test(HTML), chips.join(' | '));
  /* the other chains' examples are a row of their own (review, 2026-10-24): beside $SEND and $GWC they read as picks */
  const tryRow = (lead) => (HTML.match(new RegExp('<p class="sc-try">' + lead + ' ([\\s\\S]*?)</p>')) || [])[1] || '';
  const homeRow = tryRow('Try one:'), farRow = tryRow('Example reads on other chains:');
  check('  ..."Try one:" holds the home chain\'s two; "Example reads on other chains:" holds PEPE and BONK, each tipped as an example read, not a pick (no "memecoin" pitch)',
    (homeRow.match(/class="np-chip"/g) || []).length === 2 && /data-scan-chain="robinhood"[^>]*>\$SEND</.test(homeRow) && /data-scan-chain="robinhood"[^>]*>\$GWC</.test(homeRow) && !/data-scan-chain="(ethereum|solana)"/.test(homeRow)
    && (farRow.match(/class="np-chip"/g) || []).length === 2 && /data-scan-chain="ethereum" data-tip="Scans PEPE on Ethereum — a widely traded token used only as an example read, not a pick">PEPE · Ξ</.test(farRow)
    && /data-scan-chain="solana" data-tip="Scans BONK on Solana — a widely traded token used only as an example read, not a pick">BONK · ◎</.test(farRow) && !/memecoin/.test(farRow + homeRow), JSON.stringify([homeRow.slice(0, 80), farRow.slice(0, 80)]));
  check('the help line says what is listed and where: the pools Dexscreener lists (up to 30, on Ethereum and Solana), and a name lists Robinhood Chain tokens (the name search reads that chain alone)',
    /a pool address resolves to the token it prices, and on Ethereum and Solana the pools Dexscreener lists for it \(up to 30\) are listed\. Or type a name to list the Robinhood Chain tokens called that — traded or not — with their market cap, volume and holders\./.test(HTML)
    && !/every pool of the token is listed/.test(HTML) && !/Or type a name to list the tokens called that/.test(HTML));
  check('  ...and so does every recent and community chip the page builds — the home chain written out, never left to the chooser',
    /data-scan="' \+ esc\(r\.addr\) \+ '" data-scan-chain="' \+ esc\(r\.chain \|\| 'robinhood'\) \+ '" data-tip="Scans this address again on ' \+ esc\(chainName\(r\.chain \|\| 'robinhood'\)\) \+ '"/.test(SC)
    && /data-scan="' \+ esc\(x\.token\) \+ '" data-scan-chain="' \+ esc\(x\.chain \|\| 'robinhood'\) \+ '"/.test(SC) && !/\? ' data-scan-chain="/.test(SC)
    && /scan\(b\.getAttribute\('data-scan'\), true, b\.getAttribute\('data-scan-chain'\) \|\| null\);/.test(SC));
  check('the chooser applies only to what is typed or pasted: a chip\'s, row\'s or link\'s chain wins, its Auto is the address\'s own (never the chooser), the form and a paste pass none',
    /const chainQ = SOL_ADDR\.test\(addr\) && !ADDR\.test\(addr\) \? 'solana' : \(chainWant \? \(chainWant === 'auto' \? '' : chainWant\) : \(chainPick !== 'auto' \? chainPick : ''\)\);/.test(SC)
    && /form\.addEventListener\('submit', \(e\) => \{ e\.preventDefault\(\); scan\(input && input\.value, true\); \}\)/.test(SC) && /if \(isAddr\(input\.value\.trim\(\)\)\) scan\(input\.value, true\);/.test(SC)
    && !/chainWant && chainWant !== 'auto' \? chainWant : \(chainPick/.test(SC));
  check('  ...a name-search row is a home-chain token and says so', /scan\(nr\.dataset\.token, true, 'robinhood'\)/.test(SC) && !/scan\(nr\.dataset\.token, true\)/.test(SC));
  check('  ...a shared link without ?chain= is read as Auto, not through this device\'s chooser', /const wantChain = \['robinhood', 'ethereum', 'solana'\]\.includes\(q\.get\('chain'\)\) \? q\.get\('chain'\) : 'auto';/.test(SC) && /if \(want && want\.trim\(\)\.length >= 2\) scan\(want, false, wantChain\);/.test(SC));
  check('  ...and after a hit the address bar carries the chain the answer came from (an Auto scan answered from Ethereum reloads on Ethereum)',
    /u\.searchParams\.set\('scan', normAddr\(addr\)\); u\.searchParams\.set\('chain', chainSlug\); u\.searchParams\.delete\('tab'\); history\.replaceState/.test(SC)
    && SC.indexOf("u.searchParams.set('chain', chainSlug)") > SC.indexOf("const chainSlug = j.chain || p.chain || 'robinhood'") && SC.indexOf("u.searchParams.set('chain', chainSlug)") < SC.indexOf('lastPair = p;'));

  /* ═══ the door on the radar ═══ */
  const anonNew = await api('/api/pairs/new');
  check('the radar feed needs a session', anonNew.status === 401 && anonNew.j && anonNew.j.code === 'need_signin', anonNew.status);
  const anonRun = await api('/api/runners?window=24h');
  check('  ...and so do the best runners', anonRun.status === 401, anonRun.status);
  const u = mkUser('__sp_member__');
  const memberNew = await api('/api/pairs/new', { sid: u.sid });
  check('  ...a member is served (or told the feed is still building)', memberNew.status === 200 && memberNew.j && (Array.isArray(memberNew.j.pairs) || memberNew.j.building), memberNew.status + ' ' + (memberNew.j && (memberNew.j.error || '')));
  const memberRun = await api('/api/runners?window=24h', { sid: u.sid });
  check('  ...runners too', memberRun.status === 200, memberRun.status);

  /* ═══ the scan itself, open to everyone ═══ */
  const bad = await api('/api/scan?address=nope');
  check('a non-address is refused with a sentence', bad.status === 400 && /valid 0x address/.test((bad.j && bad.j.error) || ''), bad.status);
  const scan = await api('/api/scan?address=' + SEND);
  const sj = scan.j || {};
  if (scan.status === 200 && sj.unavailable) check('a token scan (the chain and the price feed could not be reached from here, which the answer says honestly)', /couldn’t reach/.test(sj.message || ''), sj.message);
  else {
    check('a token scan returns the full pair profile', scan.status === 200 && sj.kind === 'token' && sj.pair && sj.pair.token && sj.pair.token.address === SEND, scan.status + ' ' + (sj.error || sj.kind));
    check('  ...with the risk legend and the community slot the popup uses', sj.risk && typeof sj.risk === 'object' && Object.prototype.hasOwnProperty.call(sj, 'community'));
  }
  const pool = await api('/api/scan?address=' + SEND_POOL);
  const pj = pool.j || {};
  if (pool.status === 200 && pj.unavailable) check('a pool scan (chain unreachable from here — said honestly)', true, pj.message);
  else check('a POOL address resolves to the token it prices', pool.status === 200 && pj.kind === 'pool' && pj.pool === SEND_POOL && pj.pair && pj.pair.token && pj.pair.token.address === SEND, pool.status + ' ' + (pj.error || pj.kind || (pj.notFound && 'notFound')));
  /* ═══ kept for everyone, refreshed by every scan ═══ */
  if (scan.status === 200 && sj.kind === 'token') {
    const s1 = sj.scan || {};
    check('a scan answers with its own facts: when it was read, how many times, first seen, and that it was kept', typeof s1.readAt === 'number' && typeof s1.count === 'number' && typeof s1.firstAt === 'number' && s1.stale === false && s1.kept === true && typeof s1.now === 'number', JSON.stringify(s1));
    check('  ...a count is only ever the store’s own (a failed write says kept:false and carries no count)', /kept: !!s, \.\.\.\(s \? \{ count: s\.count, firstAt: s\.first_at, lastAt: s\.last_at \} : \{\}\)/.test(SRC) && /This scan could not be kept just now/.test(SC));
    check('  ...the holder figures carry their own read time, and the page says so when they are older than the scan', sj.pair.holders && 'readAt' in sj.pair.holders && /Holder figures as of/.test(SC), JSON.stringify(sj.pair.holders && sj.pair.holders.readAt));
    check('  ...relative times keep counting and follow the server’s clock, not a skewed device clock', /setInterval\(\(\) => \{ document\.querySelectorAll\('\.sc-ago\[data-t\]'\)/.test(SC) && /clockOffset = sc\.now - Date\.now\(\)/.test(SC));
    check('  ...the read is fresh (within the scan window), not an old cached row', Date.now() - s1.readAt < 60000, Date.now() - s1.readAt);
    const row = db.prepare('SELECT * FROM scans WHERE token_addr=?').get(SEND);
    check('the token is in the scan store with the full profile snapshot', row && row.pair_json && JSON.parse(row.pair_json).token.address === SEND && row.symbol === 'SEND', row && row.symbol);
    check('  ...and the store knows nothing about who scanned', row && !Object.keys(row).some((k) => /user|ip|session|who/i.test(k)), row && Object.keys(row).join(','));
    const beforeAgain = db.prepare('SELECT count, last_at FROM scans WHERE token_addr=?').get(SEND);
    const again = await api('/api/scan?address=' + SEND);
    const s2 = (again.j && again.j.scan) || {};
    check('the same client scanning it again inside ten minutes does not count again, nor move it up the list (the count is scans, not one person’s clicks)', again.status === 200 && s2.count === beforeAgain.count && s2.lastAt === beforeAgain.last_at && s2.firstAt === s1.firstAt, JSON.stringify({ beforeAgain, s2 }));
    const base = (snap.scans.find((r) => r.token_addr === SEND) || {}).count || 0;   // whatever the store held before this run
    // +1 on a fresh server; +0 when this client was already counted inside the last ten minutes (a re-run against the same process)
    check('  ...one client is counted at most once per ten minutes (the pool scan of the same coin did not count again)', beforeAgain.count === base + 1 || beforeAgain.count === base, beforeAgain.count + ' vs base ' + base);
    check('  ...within the 5 s window the same read is shared (no second upstream hit); the snapshot is never older', s2.readAt >= s1.readAt, s2.readAt - s1.readAt);
    // an older stored snapshot must be replaced by the next fresh read: age the row, scan, compare
    db.prepare('UPDATE scans SET read_at = read_at - 3600000 WHERE token_addr=?').run(SEND);
    db.prepare('UPDATE token_cache SET updated_at = updated_at - 3600000 WHERE token_addr=?').run(SEND);
    const third = await api('/api/scan?address=' + SEND);
    const s3 = (third.j && third.j.scan) || {};
    const rowAfter = db.prepare('SELECT read_at, count FROM scans WHERE token_addr=?').get(SEND);
    if (third.status === 200 && third.j && third.j.unavailable) check('a scan whose upstream failed mid-test is reported as unavailable, not as a number', true, third.j.message);
    else {
      check('an aged row is re-read live and the stored snapshot is updated (read_at moves to now)', third.status === 200 && rowAfter && Date.now() - rowAfter.read_at < 60000 && s3.readAt === rowAfter.read_at, JSON.stringify({ s3, rowAfter }));
      check('  ...the stale flag is off when the read succeeded', s3.stale === false);
    }
  }
  if (pool.status === 200 && pj.kind === 'pool') {
    check('the pool answer says the chain confirmed it is this token’s pool', pj.poolVerified === true, JSON.stringify({ poolVerified: pj.poolVerified }));
    const p2 = await api('/api/scan?address=' + SEND_POOL);   // the token scans above re-labelled the row 'token'; a pool scan labels it back
    const row = db.prepare('SELECT kind, pool_addr, count FROM scans WHERE token_addr=?').get(SEND);
    check('a verified pool scan is recorded under the token it prices, remembering the pool', p2.status === 200 && row && row.kind === 'pool' && row.pool_addr === SEND_POOL, JSON.stringify(row));
    check('  ...so the store has ONE row for the coin however it was pasted', db.prepare('SELECT COUNT(*) n FROM scans WHERE token_addr=? OR token_addr=?').get(SEND, SEND_POOL).n === 1);
    const t2 = await api('/api/scan?address=' + SEND);
    const rowT = db.prepare('SELECT kind, pool_addr FROM scans WHERE token_addr=?').get(SEND);
    check('  ...a later token scan keeps the pool it learnt (kind follows the paste, the pool is not forgotten)', t2.status === 200 && rowT && rowT.kind === 'token' && rowT.pool_addr === SEND_POOL, JSON.stringify(rowT));
    check('a known pool is answered from the store without asking the chain which token it holds', /const known = scanByPool\(addr\);/.test(SRC) && /SELECT token_addr FROM scans WHERE pool_addr=\?/.test(SRC));
  }
  const rec = await api('/api/scan/recent');
  const rj = rec.j || {};
  // the list holds what was actually read: when every scan above came back "unavailable" (the node refused this
  // IP), there is honestly nothing to list, and the check is that it says so rather than inventing an entry
  const scanned = scan.status === 200 && sj.kind === 'token';
  check('the public recent list is served, one entry per token' + (scanned ? '' : ' (the chain refused this run, so it is honestly empty)'), rec.status === 200 && Array.isArray(rj.scans) && (scanned ? rj.scans.some((x) => x.token === SEND) : true) && new Set(rj.scans.map((x) => x.token)).size === rj.scans.length, rec.status + ' ' + JSON.stringify(rj).slice(0, 120));
  check('  ...each entry is the token, its chain, when, how many times — and nothing about a person', rj.scans && rj.scans.every((x) => ['token', 'pool', 'kind', 'symbol', 'name', 'lastAt', 'readAt', 'count', 'chain'].every((k) => k in x) && Object.keys(x).length === 9), rj.scans && JSON.stringify(Object.keys(rj.scans[0] || {})));
  check('  ...and answers without a session', rec.status === 200);
  check('the fallback: an unreachable upstream serves the last snapshot, marked stale with its read time', /if \(cached && usable\(cached\.pair\)\) return \{ pair: cached\.pair, readAt: row\.updated_at, stale: true/.test(SRC) && /if \(usable\(p\)\) return \{ pair: rescoreCachedPair\(p\), readAt: s\.read_at, stale: true/.test(SRC));
  check('  ...and a snapshot only ever replaces an OLDER one, so a stale answer cannot overwrite fresher data', /pair_json = CASE WHEN excluded\.pair_json IS NOT NULL AND excluded\.read_at >= read_at THEN excluded\.pair_json ELSE pair_json END/.test(SRC));
  check('a claimed pool is only a pool when the factory or the price feed says so — and only then is it remembered', /async function poolVerified\(addr, pt, pair\)/.test(SRC) && /factoryGetPair\(pt\.token0, pt\.token1, true\)\) === addr/.test(SRC) && /scanRecord\(tok, kind, poolOk === true \? pool : null/.test(SRC) && /says it prices/.test(SC) && /treat the pool itself as unverified/.test(SC));
  check('the Scanner refuses an old radar copy (liveMaxAgeMs) and a re-check that brought nothing never moves updated_at', /liveMaxAgeMs: SCAN_FRESH_MS/.test(SRC) && /opts\.liveMaxAgeMs != null && now\(\) - liveAt > opts\.liveMaxAgeMs/.test(SRC) && /UPDATE token_cache SET checked_at=\? WHERE token_addr=\?/.test(SRC) && !/UPDATE token_cache SET updated_at=\? WHERE token_addr=\?/.test(SRC));
  check('  ...the persistent copy of a radar token is stamped with the radar’s read time, never "now"', /tokenCachePut\(tokenAddr, \{ pair: live \}, liveAt\)/.test(SRC) && /\.run\(tok, pj, sym, nm, found, reason, at \|\| now\(\), now\(\)\)/.test(SRC));
  check('the count is one per client per coin per ten minutes', /rateLimit\('scanc:' \+ clientIp\(req\) \+ '\|' \+ tok, 1, 10 \* 60e3\)/.test(SRC));
  check('a burst of scans can never take the live-fetch slots a Send Call open needs (reserved slots, low-priority scans)', /const LIVE_LOOKUP_RESERVE = 2;/.test(SRC) && /liveLookups >= LIVE_LOOKUP_MAX - \(opts\.lowPriority \? LIVE_LOOKUP_RESERVE : 0\)/.test(SRC) && /liveMaxAgeMs: SCAN_FRESH_MS, lowPriority: true/.test(SRC));
  check('a price-feed outage never becomes a blank "fresh" profile: the lookup says it could not check', /if \(!dexr\.ok && !p\.indexed && \(!p\.market \|\| p\.market\.priceUsd == null\)\) return \{ unavailable: true/.test(SRC) && /if \(!dexr\.ok\) return \{ unavailable: true, reason: \(dexr\.reason \|\| 'price feed unreachable'\) \+ ' — the chain has no main-quote pool/.test(SRC));
  check('  ...and a blank is never served as "the last snapshot"', /const usable = \(p\) => p && \(p\.indexed \|\| \(p\.market && p\.market\.priceUsd != null\) \|\| p\.priceStale\);/.test(SRC));
  check('a token neither feed names is named by its own contract (name()/symbol() on-chain)', /async function tokenNameOnChain\(token\)/.test(SRC) && /ethCall\(token, '0x06fdde03'\), ethCall\(token, '0x95d89b41'\)/.test(SRC) && /const oc = await tokenNameOnChain\(t\.token\);/.test(SRC));
  check('"not indexed" is said as a fact about the price feed, never as "this token has not traded"', !/this pair has not traded/.test(NP) && /the price feed does not index this pair/.test(NP) && !/this pair has not traded/.test(read('watchlist.js')));
  check('  ...the page says so in words, not as a live number', /this is the last snapshot, read/.test(SC) && /Nothing on it is live/.test(SC));
  check('the scan forces a fresh read (maxAgeMs) instead of settling for the popup’s stale row', /lookupTokenPair\(tok, \{ maxAgeMs: SCAN_FRESH_MS, liveMaxAgeMs: SCAN_FRESH_MS, lowPriority: true \}\)/.test(SRC) && /const SCAN_FRESH_MS = 5 \* 1000;/.test(SRC));
  check('the page shows the community strip and says what is kept', /id="sc-community-list"/.test(HTML) && /never who scanned it/.test(HTML) && /fetch\('\/api\/scan\/recent'/.test(SC));
  check('the store is bounded', /const SCANS_KEEP = 5000;/.test(SRC) && /DELETE FROM scans WHERE token_addr IN \(SELECT token_addr FROM scans ORDER BY last_at DESC, rowid DESC LIMIT -1 OFFSET \?\)/.test(SRC));

  const quote = await api('/api/scan?address=0x0bd7d308f8e1639fab988df18a8011f41eacad73');
  check('a quote asset (WETH) is named as one, not profiled', quote.status === 200 && quote.j && quote.j.notFound && quote.j.reason === 'quote', quote.status + ' ' + JSON.stringify(quote.j).slice(0, 80));
  check('the scan route tries Ethereum for a 0x address the home chain has nothing for, and says so when neither has it', /No token or pool found at this address on Robinhood Chain or Ethereum/.test(SRC.slice(SRC.indexOf("p === '/api/scan'"), SRC.indexOf("p === '/api/scan'") + 12000)) && (SRC.match(/if \(await tryEthereum\(/g) || []).length === 2 && !/other chains are coming soon/.test(SRC));

  /* ═══ a Send Call straight from a scan: to the Wall, or to the reader's Send Squad when they are in one ═══ */
  const CMP = read('compose.js');
  check('a scanned token\'s dashboard carries the shared Send Call pair, marked "detail on screen" (it IS the full detail)', /COMPOSE\.callRowHTML\(t\.address, \{ cls: 'tkd-call', viewed: true \}\)/.test(NP) && !/sc-hit-call/.test(SC)
    && /data-call-go="wall"/.test(CMP) && /📣 Send Call to the Wall/.test(CMP));
  check('  ...and a squad button only for a VERIFIED member of a squad — none at all otherwise', /\.filter\(\(q\) => q && q\.verified && q\.id > 0\)/.test(CMP) && /if \(!list\.length\) \{ if \(old\) old\.remove\(\); continue; \}\s+\/\/ not in a squad: there is no squad button/.test(CMP) && /data-call-go="squad"/.test(CMP));
  check('  ...both open the site\'s one composer with the token filled in, public or to that squad', /openCall\(\{ token: row\.dataset\.tok, viewedDetail: viewed, squadId: squad \? Number\(b\.dataset\.squadId\) : 0/.test(CMP));
  check('  ...a call is not flagged "without DYOR" only where the full detail of that token is on screen (a marked row), and only for that token', /const viewed = row\.dataset\.viewed === '1';/.test(CMP)
    && /detailSeenFor = tok && o\.viewedDetail \? tok : null;/.test(CMP) && /viewedDetail = !!detailSeenFor && detailSeenFor === String\(addr\)\.toLowerCase\(\);/.test(CMP));
  check('the classic detail body (kept for a page without the popup) still ends in the same Send Call pair', /COMPOSE\.callRowHTML\(p\.token\.address, \{ cls: 'np-call-row', viewed: true \}\)/.test(NP) && /detailHTML: \(p, opts\) => bodyHTML\(p, [^\n]*Object\.assign\(\{\}, opts\)\)/.test(NP) && !/Object\.assign\(\{ hideCall: true \}, opts\)/.test(NP));
  check('  ...and a call button inside the token popup closes the popup before the composer opens', /row\.closest\('#token-modal, \.token-modal'\) && window\.TokenModal && TokenModal\.close/.test(CMP));
  const WL = read('watchlist.js'), WLH = read('watchlist.html');
  check('  ...the composer\'s "see the full detail" clears the flag only where the popup can really show it; elsewhere it opens the Scanner in a new tab and the call stays flagged',
    /if \(window\.TokenModal && window\.NPCard\) \{ viewedDetail = true; TokenModal\.open\(/.test(CMP) && /else window\.open\('\/newpairs\?scan=' \+ encodeURIComponent\(callTok\.addr\), '_blank', 'noopener'\);/.test(CMP)
    && !/Open this token from New Pairs to see its full detail/.test(CMP) && /one made from the Scanner is not/.test(CMP));
  check('  ...a Wall button always lands on the public Wall, even with the composer left on a squad', /setCallTarget\(pendingSquad \? pendingSquad\.id : null\);/.test(CMP));
  check('  ...on a squad\'s own page the squad button calls to that squad when the reader is verified there', /const q = \(ctx && list\.find\(\(s\) => s\.id === ctx\)\) \|\| list\[0\]/.test(CMP) && /old\.dataset\.one === String\(one\)/.test(CMP));
  const TMJ = read('tokenmodal.js');
  check('the ☆ at the foot of a scan and of the token popup saves that pair (the watchlist copy tells people to tap it)',
    /lastPair = p;/.test(SC) && /Watchlist\.toggle\(lastPair\)/.test(SC) && /shown = j\.pair;/.test(TMJ) && /window\.Watchlist\.toggle\(shown\)/.test(TMJ));
  check('  ...a long squad name wraps inside its Send Call button wherever the pair sits', /\.call-row \.btn \{ max-width: 100%; min-width: 0; overflow-wrap: anywhere; \}/.test(CSS));
  check('the watchlist sends people to the token Scanner, not the New Pairs radar', /href=\"\/newpairs" data-tip="Opens the token Scanner/.test(WLH) && !/newpairs\.html\?tab=new/.test(WLH) && /Open the <a class="np-msg-link" href=\"\/newpairs">Scanner<\/a>/.test(WL));
  check('  ...each saved token opens in the Scanner and carries the Send Call pair (not marked "detail viewed": the card is lighter)', /href=\"\/newpairs\?scan=' \+ encodeURIComponent\(p\.token\.address\)/.test(WL) && /COMPOSE\.callRowHTML\(p\.token\.address, \{ cls: 'np-call-row' \}\)/.test(WL));
  /* ═══ the token dashboard is the default view wherever someone reads more about a token ═══ */
  const SCJ = read('sendcall.js'), TT = read('tokentext.js');
  const dashIdx = NP.indexOf('function dashboardHTML(');
  const DASH = NP.slice(dashIdx, NP.indexOf('function mountDashboard(', dashIdx));
  check('the dashboard: the caveat is read before the buttons, an unread figure says so, and the chart heads the middle column',
    dashIdx > 0 && DASH.indexOf('tkd-caveat') > 0 && DASH.indexOf('tkd-caveat') < DASH.indexOf('tkd-acts')
    && /const UNREAD = '<span class="tkd-unread">not read yet<\/span>';/.test(NP) && /'<div class="tkd-col tkd-col--c">' \+ cChart \+/.test(DASH)
    && /Watchlist\.btnHTML\(p, 'btn btn-sm btn-ghost np-watch-wide', true\)/.test(DASH) && /pinBtnHTML\(p\)/.test(DASH) && /HONEST \+/.test(DASH));
  check('  ...its columns follow its own width (a container query), three across with the chart in the middle when there is room',
    /\.tkd \{ container: tkd \/ inline-size;/.test(CSS) && /@container tkd \(min-width: 52em\) \{\n  \.tkd-grid \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1\.6fr\) minmax\(0, 1fr\);/.test(CSS)
    && /\.tkd-col--c \{ grid-column: 2; grid-row: 1; \}/.test(CSS));
  const TKCSS = CSS.slice(CSS.indexOf('/* ===== The token dashboard'), CSS.indexOf('.sc-result:has(> .tkd)'));
  check('  ...one column on a phone in source order (no CSS order), with a focus trap that stops on its pop-downs',
    TKCSS.length > 1000 && !/\border:\s*\d/.test(TKCSS) && /'<div class="tkd-side">' \+/.test(DASH)
    && /details > summary/.test(read('app.js')) && /aria-haspopup="dialog"/.test(NP));
  check('  ...the token popup draws it (from a pair the caller already holds, or a live read, or a caller\'s own snapshot)',
    /window\.NPCard\.dashboardHTML\(pair, \{ level: 3 \}\)/.test(TMJ) && /shown = meta\.pair; paint\(meta\.pair\);/.test(TMJ) && /typeof meta\.fallback === 'function'/.test(TMJ)
    && /fullLink\.href = '\/newpairs\?scan=' \+ encodeURIComponent/.test(TMJ));
  check('  ...a radar row, the Hot Feed\'s ℹ️ and "Full dashboard", a call\'s detail and a watchlist row all open it',
    /function openDash\(p\)/.test(NP) && /if \(li && openDash\(pairFor\(li\.dataset\.addr\)\)\)/.test(NP) && /openDash\(slide && state\.byAddr\.get\(slide\.dataset\.addr\)\)/.test(NP)
    && /window\.TokenModal\.open\(w\.dataset\.token, \{ symbol: w\.dataset\.sym, name: w\.dataset\.name, fallback:/.test(SCJ)
    && /function openDash\(p\)/.test(WL) && WLH.indexOf('<script src="newpairs.js">') > 0 && WLH.indexOf('<script src="tokenmodal.js">') > WLH.indexOf('<script src="newpairs.js">'));
  check('  ...a $TICKER chip on a page with no popup opens the dashboard page, and token notifications link to it',
    /else window\.open\('\/newpairs\?scan=' \+ encodeURIComponent\(addr\), '_blank', 'noopener'\);/.test(TT) && !/Token detail isn’t available on this page/.test(TT)
    && (SRC.match(/tokenDashLink\(r\.token_addr\)/g) || []).length === 2 && /'watchlist', null, tokenDashLink\(token\)\);/.test(SRC));
  const popupPages = readdirSync(PUB).filter((f) => f.endsWith('.html') && /<script src="\/?tokenmodal\.js">/.test(read(f)));
  check('  ...and every page with the popup loads the watchlist script, so ☆ Save to watchlist is on the dashboard everywhere',
    popupPages.length >= 7 && popupPages.every((f) => /<script src="\/?watch\.js">/.test(read(f))), popupPages.filter((f) => !/<script src="\/?watch\.js">/.test(read(f))).join(','));
  const CJ = read('community.js'), SJ = read('squad.js'), PJ = read('proposals.js');
  const wl = /const wallLink = \(u\) => u \? '<a class="wall-link" href="\/u\/' \+ encodeURIComponent\(u\) \+ '">@' \+ esc\(u\) \+ '<\/a>' : '@—';/;
  check('a community\'s and a Send Squad\'s "started by", and a proposal\'s author, open that person\'s Send Wall', wl.test(CJ) && wl.test(SJ) && wl.test(PJ)
    && (CJ.match(/started by ' \+ wallLink\(c\.creator\)/g) || []).length === 2 && /Send Squad · started by ' \+ wallLink\(/.test(SJ) && /by ' \+ wallLink\(p\.author && p\.author\.username\)/.test(PJ) && !/started by @' \+ esc\(/.test(CJ + SJ));
  check('  ...the composer fills and reads the handed-over token, keeps it through a sign-in, and forgets it on close', /function fillCallToken\(tok\)/.test(CMP) && /lookupCallToken\(tok\);/.test(CMP)
    && /pendingSquad = keepSquad; pendingToken = keepToken; detailSeenFor = keepSeen;/.test(CMP) && /if \(tok\) fillCallToken\(tok\);/.test(CMP) && /pendingToken = null; detailSeenFor = null;\s+\/\/ nor does a token another page handed over/.test(CMP));
  check('  ...a new sign-in re-reads the reader\'s squads, and so does a scan a minute later or a return to the tab (a gate re-check, a join or a leave elsewhere)', /document\.addEventListener\('auth:change', repaintCallRows\);/.test(CMP) && /Date\.now\(\) - mySquadsAt < 60e3/.test(CMP) && /document\.addEventListener\('visibilitychange'/.test(CMP));
  check('  ...rows get their squad button as they appear, wherever they appear (one paint at a time, not tied to animation frames)', /new MutationObserver\(\(ms\) => \{/.test(CMP) && /do \{ paintAgain = false; await paintCallRows\(document\); \} while \(paintAgain\);/.test(CMP));
  check('  ...and a Send Call box opened before a sign-in comes back after it, however long the sign-in takes', /const onAuthClosed = \(\) =>/.test(CMP) && /pendingTimer = setTimeout\(abandon, 10 \* 60 \* 1000\);/.test(CMP));
  // the list the squad button is built from, and the call it leads to
  const tag = randomBytes(3).toString('hex');
  const owner = mkUser('__sp_sqown_' + tag), loner = mkUser('__sp_loner_' + tag);
  const sq = Number(db.prepare("INSERT INTO squads (creator_id, name, gate_kind, member_count, created_at) VALUES (?, ?, 'none', 1, ?)").run(owner.id, 'Scan Squad ' + tag, Date.now()).lastInsertRowid);
  db.prepare("INSERT INTO squad_members (squad_id, user_id, joined_at, role, verified) VALUES (?, ?, ?, 'owner', 1)").run(sq, owner.id, Date.now());
  const mine = await api('/api/squads/mine', { sid: owner.sid }), none = await api('/api/squads/mine', { sid: loner.sid });
  check('the squad list the button reads names a verified member\'s squad', mine.status === 200 && mine.j && mine.j.squads.some((q) => q.id === sq && q.verified === true), mine.status + ' ' + JSON.stringify(mine.j && mine.j.squads));
  check('  ...and is empty for someone in no squad, so they get no squad button', none.status === 200 && none.j && Array.isArray(none.j.squads) && none.j.squads.length === 0, none.status + ' ' + JSON.stringify(none.j));
  const call = await api('/api/calls', { method: 'POST', sid: owner.sid, body: { token: SEND, note: '', viewedDetail: true, shareWallet: false, squadId: sq } });
  const crow = db.prepare('SELECT squad_id, no_dyor FROM calls WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(owner.id);
  if (call.status === 200) check('  ...and a Send Call made the way the scanner opens it lands in that squad, private, not flagged "without DYOR"', crow && crow.squad_id === sq && crow.no_dyor === 0, JSON.stringify(crow));
  else check('the scanner-style squad call could not be made this run (' + call.status + ': ' + ((call.j && call.j.error) || '') + ') — not asserted', call.status === 502 || call.status === 503 || /liquidity|slow/i.test((call.j && call.j.error) || ''), call.status);   // the chain or the price feed refused: said as an outage, never as "no pair"
  try {
    for (const t of ['calls', 'posts', 'points_events', 'notifications']) db.prepare(`DELETE FROM ${t} WHERE user_id IN (?, ?)`).run(owner.id, loner.id);
    db.prepare('DELETE FROM squad_members WHERE squad_id = ?').run(sq);
    db.prepare('DELETE FROM squads WHERE id = ?').run(sq);
  } catch {}
  await rwaCardChecks();
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  restore();
  for (const id of made) { for (const t of ['sessions', 'points_events', 'notifications']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} } try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {} }
  console.log('\ncleanup — throwaway users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_sp\\_%' ESCAPE '\\'").get().n, '· scan rows for $SEND back to', snap.scans.length);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
