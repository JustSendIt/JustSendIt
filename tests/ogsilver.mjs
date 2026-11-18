/* 🥈 OG after the beta (owner, 2026-11-17): "Moving forward after beta, only consider people who have bought Send for the
   silver OG and bronze OG badges."
     Gold (10×) and Diamond (20×) — unchanged: both coins, and kept only while both are held.
     Silver (5×) and Bronze (3×) — $SEND alone: the earliest $SEND buy's tier, CAPPED at Silver (a $SEND buy before the beta
     ended without $GWC is Silver, never Gold); $GWC is not needed to earn, hold or keep them.
     The account's tier is the better of the two. The $100 floor is each coin SUMMED over every linked wallet, and of equal
     tiers the EARLIEST buy dates the badge.
   The decision is checked as pure functions lifted out of server.js and run on fixed inputs (no chain is needed — a grant
   is otherwise only reachable through a full on-chain replay), the payout and the campaign clock through the real API with
   DB-minted fixtures, and the wiring by reading the source. Everything made here is deleted. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');   // the server writes meanwhile: wait a moment, never fail with "database is locked"
const SRC = readFileSync(SERVER_JS, 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const hex = (n) => randomBytes(n).toString('hex');
const DAY = 864e5;
const made = [];
function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + hex(6);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + DAY);
  return { id, sid: raw };
}
async function api(p, sid) {
  const r = await fetch(BASE + p, { headers: { Origin: BASE, ...(sid ? { Cookie: 'sid=' + sid } : {}) } });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
// a top-level function of server.js, as source: one-liners and multi-line bodies (closed by a `}` in column 0)
function fnSrc(name) {
  const one = new RegExp('\\n(function ' + name + '\\([^)]*\\) \\{[^\\n]*\\})\\n').exec(SRC);
  if (one) return one[1];
  const m = new RegExp('\\n(function ' + name + '\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\})\\n').exec(SRC);
  return m ? m[1] : null;
}
const constSrc = (name) => { const m = new RegExp('\\nconst ' + name + ' = ([^;\\n]+);').exec(SRC); return m ? m[1] : null; };
const val = (expr, env = {}) => new Function(...Object.keys(env), 'return (' + expr + ');')(...Object.values(env));

try {
  /* ═══ 0. the rule's inputs, from the server itself ═══ */
  const camp = await api('/api/og/campaign');
  const C = camp.j || {};
  check('/api/og/campaign answers', camp.status === 200 && C.closes && C.closes.gold > 0, camp.status);
  const OG_TIER = val(constSrc('OG_TIER'));
  const OG_LAUNCH = val(constSrc('OG_LAUNCH'));
  const OG_TIER_NAME = val(constSrc('OG_TIER_NAME'));
  const OG_TIER_MULT = val(constSrc('OG_TIER_MULT'), { OG_DIAMOND_MULT: val(constSrc('OG_DIAMOND_MULT')), OG_BONUS: val(constSrc('OG_BONUS')) });
  const OG_TIER_NEEDS = val(constSrc('OG_TIER_NEEDS'));
  const OG_MIN_HOLD_USD = val(constSrc('MIN_HOLD_USD'));
  // the deadlines as this server computes them (BETA_END can move Gold and Silver): read back, never re-derived here
  const OG_TIER_CLOSE = { 3: C.closes.gold, 2: C.closes.silver, 1: C.closes.bronze };
  check('the floor is $100, and Gold closes when the beta ends', OG_MIN_HOLD_USD === 100 && /const OG_MIN_HOLD_USD = MIN_HOLD_USD;/.test(SRC) && C.closes.gold === C.betaEndsAt, OG_MIN_HOLD_USD);
  const NAMES = ['ogTierForBuy', 'ogBetterScan', 'ogFloorOk', 'ogAccountTier', 'ogNeeds', 'ogSoldOut', 'ogTierNow', 'ogGrantText', 'ogRevokedText', 'ogDiamondOk', 'ogLiftable', 'ogLiftWhat', 'ogReadDecides'];
  const missing = NAMES.filter((n) => !fnSrc(n));
  check('the rule is pure functions of server.js (' + NAMES.join(', ') + ')', !missing.length, missing.join(', '));
  const ENV = { OG_TIER, OG_TIER_CLOSE, OG_TIER_NAME, OG_TIER_MULT, OG_TIER_NEEDS, OG_LAUNCH, OG_MIN_HOLD_USD };
  const L = new Function(...Object.keys(ENV), NAMES.map(fnSrc).join('\n') + '\nreturn { ' + NAMES.join(', ') + ' };')(...Object.values(ENV));

  // a wallet's scan of one coin, the shape ogScan returns (tier from its earliest buy, balance in wei)
  const scan = (coin, ts, wallet, tokens = 1000) => ({ tier: L.ogTierForBuy(ts, OG_LAUNCH[coin]), firstBuyMs: ts, balWei: (BigInt(tokens) * 10n ** 18n).toString(), wallet });
  const GOLD_TS = { SEND: OG_LAUNCH.SEND + 2 * DAY, GWC: OG_LAUNCH.GWC + 3 * DAY };   // both well before the beta ended
  const SILVER_TS = C.closes.gold + 5 * DAY;                                          // after the beta, inside Silver
  const BRONZE_TS = C.closes.silver + 5 * DAY;                                        // after Silver closed, inside Bronze
  const AFTER_TS = C.closes.bronze + DAY;                                             // after every window
  const OK = { SEND: true, GWC: true };
  check('fixtures sit in the windows they claim', L.ogTierForBuy(GOLD_TS.SEND, OG_LAUNCH.SEND) === 3 && L.ogTierForBuy(GOLD_TS.GWC, OG_LAUNCH.GWC) === 3
    && L.ogTierForBuy(SILVER_TS, OG_LAUNCH.SEND) === 2 && L.ogTierForBuy(BRONZE_TS, OG_LAUNCH.SEND) === 1 && L.ogTierForBuy(AFTER_TS, OG_LAUNCH.SEND) === 0);

  /* ═══ 1. the tier, on fixed inputs ═══ */
  {
    const s = scan('SEND', SILVER_TS, '0xs1');
    const r = L.ogAccountTier({ best: { SEND: s }, holdsAny: { SEND: true }, diamondOk: false, floor: { SEND: true, GWC: false } });
    check('a $SEND-only buyer in the Silver window → Silver, on $SEND alone', r.tier === 2 && r.basis === 'send' && !r.capped, JSON.stringify(r));
    check('  ...dated by that $SEND buy, and claiming only the $SEND wallet', r.buyMs === SILVER_TS && r.wallets.length === 1 && r.wallets[0] === '0xs1', JSON.stringify(r.wallets));
    check('  ...and needing only $SEND kept', JSON.stringify(r.needs) === '["SEND"]', JSON.stringify(r.needs));
    const noFloor = L.ogAccountTier({ best: { SEND: s }, holdsAny: { SEND: true }, diamondOk: false });
    check('  ...$GWC never asked: no $GWC scan, no $GWC price, still Silver', noFloor.tier === 2 && L.ogAccountTier({ best: { SEND: s }, holdsAny: { SEND: true }, diamondOk: false, floor: { SEND: true, GWC: null } }).tier === 2);
  }
  {
    const s = scan('SEND', GOLD_TS.SEND, '0xs1');
    const r = L.ogAccountTier({ best: { SEND: s }, holdsAny: { SEND: true }, diamondOk: false, floor: OK });
    check('$SEND bought before the beta ended, no $GWC → Silver (capped), never Gold', r.tier === 2 && r.basis === 'send' && r.capped === true && r.buyMs === GOLD_TS.SEND, JSON.stringify(r));
    const d = L.ogAccountTier({ best: { SEND: s }, holdsAny: { SEND: true }, diamondOk: true, floor: OK });
    check('  ...and a Diamond answer cannot lift a $SEND-only account past Silver', d.tier === 2, d.tier);
  }
  {
    const best = { SEND: scan('SEND', GOLD_TS.SEND, '0xs1'), GWC: scan('GWC', GOLD_TS.GWC, '0xg1') };
    const r = L.ogAccountTier({ best, holdsAny: OK, diamondOk: false, floor: OK });
    check('both coins in the Gold window → Gold, on both', r.tier === 3 && r.basis === 'both' && JSON.stringify(r.needs) === '["SEND","GWC"]', JSON.stringify(r));
    check('  ...dated by the later coin’s earliest buy, claiming both wallets', r.buyMs === Math.max(GOLD_TS.SEND, GOLD_TS.GWC) && r.wallets.length === 2, r.buyMs + ' ' + JSON.stringify(r.wallets));
    const one = L.ogAccountTier({ best: { SEND: scan('SEND', GOLD_TS.SEND, '0xw'), GWC: scan('GWC', GOLD_TS.GWC, '0xw') }, holdsAny: OK, diamondOk: false, floor: OK });
    check('  ...one wallet that bought both is claimed once', one.tier === 3 && one.wallets.length === 1, JSON.stringify(one.wallets));
    const dia = L.ogAccountTier({ best, holdsAny: OK, diamondOk: true, floor: OK });
    check('Diamond unchanged: both in the Gold window and a Diamond answer → Diamond', dia.tier === 4 && dia.basis === 'both', JSON.stringify(dia));
    const gwcGone = L.ogAccountTier({ best, holdsAny: { SEND: true, GWC: false }, diamondOk: false, floor: OK });
    check('a Gold buyer who no longer holds $GWC is Silver on $SEND alone (Gold needs both held)', gwcGone.tier === 2 && gwcGone.basis === 'send' && gwcGone.capped, JSON.stringify(gwcGone));
  }
  {
    const late = L.ogAccountTier({ best: { SEND: scan('SEND', GOLD_TS.SEND, '0xs1'), GWC: scan('GWC', SILVER_TS, '0xg1') }, holdsAny: OK, diamondOk: false, floor: OK });
    check('$SEND early and $GWC after the beta → Silver, on $SEND alone (a tie claims one wallet, not two)', late.tier === 2 && late.basis === 'send' && late.wallets.length === 1 && late.wallets[0] === '0xs1', JSON.stringify(late));
    const bronze = L.ogAccountTier({ best: { SEND: scan('SEND', BRONZE_TS, '0xs1') }, holdsAny: { SEND: true }, diamondOk: false, floor: { SEND: true, GWC: false } });
    check('a $SEND-only buyer in the Bronze window → Bronze', bronze.tier === 1 && bronze.basis === 'send' && !bronze.capped && bronze.buyMs === BRONZE_TS, JSON.stringify(bronze));
    const gwcOnly = L.ogAccountTier({ best: { GWC: scan('GWC', GOLD_TS.GWC, '0xg1') }, holdsAny: { GWC: true }, diamondOk: false, floor: OK });
    check('$GWC alone earns nothing', gwcOnly.tier === 0 && gwcOnly.basis === null, JSON.stringify(gwcOnly));
    const sold = L.ogAccountTier({ best: { SEND: scan('SEND', SILVER_TS, '0xs1'), GWC: scan('GWC', GOLD_TS.GWC, '0xg1') }, holdsAny: { SEND: false, GWC: true }, diamondOk: false, floor: OK });
    check('$SEND bought but no longer held → nothing', sold.tier === 0, JSON.stringify(sold));
    check('a $SEND buy after every window → nothing', L.ogAccountTier({ best: {}, holdsAny: { SEND: true }, diamondOk: false, floor: OK }).tier === 0 && L.ogTierForBuy(AFTER_TS, OG_LAUNCH.SEND) === 0);
  }

  /* ═══ 2. the earliest buy, across every linked wallet ═══ */
  {
    const pickBest = (scans) => { let b; for (const s of scans) if (L.ogBetterScan(b, s)) b = s; return b; };
    const a = scan('SEND', SILVER_TS + 20 * DAY, '0xlater'), b = scan('SEND', SILVER_TS, '0xearlier');
    check('of two Silver $SEND wallets, the EARLIER buy is kept, whichever was read first', pickBest([a, b]).wallet === '0xearlier' && pickBest([b, a]).wallet === '0xearlier', pickBest([a, b]).wallet);
    const g = scan('SEND', GOLD_TS.SEND, '0xgold'), s = scan('SEND', SILVER_TS, '0xsilver');
    check('  ...and a higher tier always beats a lower one', pickBest([s, g]).wallet === '0xgold' && pickBest([g, s]).wallet === '0xgold');
    const r = L.ogAccountTier({ best: { SEND: pickBest([a, b]) }, holdsAny: { SEND: true }, diamondOk: false, floor: OK });
    check('  ...so og_buy_ms is the earliest $SEND buy across the wallets', r.buyMs === SILVER_TS, r.buyMs);
    const both = L.ogAccountTier({ best: { SEND: pickBest([scan('SEND', GOLD_TS.SEND + 9 * DAY, '0xa'), scan('SEND', GOLD_TS.SEND, '0xb')]), GWC: pickBest([scan('GWC', GOLD_TS.GWC + 9 * DAY, '0xc'), scan('GWC', GOLD_TS.GWC, '0xd')]) }, holdsAny: OK, diamondOk: false, floor: OK });
    check('  ...and on both coins, the later of the two coins’ EARLIEST buys', both.tier === 3 && both.buyMs === Math.max(GOLD_TS.SEND, GOLD_TS.GWC) && both.wallets.join() === '0xb,0xd', both.buyMs + ' ' + both.wallets.join());
  }

  /* ═══ 3. the $100 floor, summed over the wallets ═══ */
  {
    const px = 0.0001;                                   // $ per token: 600,000 tokens = $60
    const w60 = 600000n * 10n ** 18n;
    check('$60 in one wallet is under the floor', L.ogFloorOk(w60, px) === false);
    check('$60 + $60 in two wallets clears it — the floor sums the wallets', L.ogFloorOk(w60 + w60, px) === true);
    check('  ...a decimal string sums the same', L.ogFloorOk((w60 * 2n).toString(), px) === true);
    check('an unreadable price is no answer (null), never a "no"', L.ogFloorOk(w60 * 2n, null) === null && L.ogFloorOk(w60 * 2n, 0) === null);
    const best = { SEND: scan('SEND', GOLD_TS.SEND, '0xs1'), GWC: scan('GWC', GOLD_TS.GWC, '0xg1') };
    const shortG = L.ogAccountTier({ best, holdsAny: OK, diamondOk: false, floor: { SEND: true, GWC: false } });
    check('both coins in the Gold window, $GWC under the floor, $SEND over it → Silver on $SEND alone', shortG.tier === 2 && shortG.basis === 'send', JSON.stringify(shortG));
    const shortS = L.ogAccountTier({ best, holdsAny: OK, diamondOk: false, floor: { SEND: false, GWC: true } });
    check('$SEND under the floor → nothing today (a real answer: "short")', shortS.tier === 0 && shortS.short === true && !shortS.unknown, JSON.stringify(shortS));
    const noGwcPx = L.ogAccountTier({ best, holdsAny: OK, diamondOk: false, floor: { SEND: true, GWC: null } });
    check('a Gold history with no $GWC price is no answer — never a Silver in place of the Gold it may be', noGwcPx.tier === 0 && noGwcPx.unknown === true, JSON.stringify(noGwcPx));
    const noSendPx = L.ogAccountTier({ best: { SEND: scan('SEND', SILVER_TS, '0xs1') }, holdsAny: { SEND: true }, diamondOk: false, floor: { SEND: null, GWC: true } });
    check('no $SEND price is no answer for a $SEND-only badge either', noSendPx.tier === 0 && noSendPx.unknown === true, JSON.stringify(noSendPx));
    check('  ...a $SEND price with $SEND under the floor is a real "no", whatever $GWC’s price', L.ogAccountTier({ best, holdsAny: OK, diamondOk: false, floor: { SEND: false, GWC: null } }).short === true);
  }

  /* ═══ 4. keeping it: what each tier must hold ═══ */
  {
    check('Silver and Bronze need $SEND only; Gold and Diamond need both', JSON.stringify(OG_TIER_NEEDS) === JSON.stringify({ 1: ['SEND'], 2: ['SEND'], 3: ['SEND', 'GWC'], 4: ['SEND', 'GWC'] }), JSON.stringify(OG_TIER_NEEDS));
    for (const t of [2, 1]) {
      check(OG_TIER_NAME[t] + ': selling out of $GWC keeps it', L.ogSoldOut(t, { SEND: true, GWC: false }).length === 0);
      check(OG_TIER_NAME[t] + ': selling out of $SEND revokes it', L.ogSoldOut(t, { SEND: false, GWC: true }).join() === 'SEND');
    }
    for (const t of [3, 4]) {
      check(OG_TIER_NAME[t] + ': selling out of EITHER coin revokes it', L.ogSoldOut(t, { SEND: true, GWC: false }).join() === 'GWC' && L.ogSoldOut(t, { SEND: false, GWC: true }).join() === 'SEND' && L.ogSoldOut(t, { SEND: false, GWC: false }).length === 2);
      check(OG_TIER_NAME[t] + ': holding both keeps it', L.ogSoldOut(t, OK).length === 0);
    }
    check('a legacy badge with no tier is held to both coins, as the Gold it was', L.ogSoldOut(0, { SEND: true, GWC: false }).join() === 'GWC');
    const sil = L.ogRevokedText(2, ['SEND']), gol = L.ogRevokedText(3, ['GWC']);
    check('the revocation note says what THAT tier needed', /OG Silver removed — Silver requires holding \$SEND, and you sold out of it\./.test(sil) && !/BOTH|GWC/.test(sil), sil);
    check('  ...and for Gold, both coins and which one went', /OG Gold removed — Gold requires holding BOTH \$SEND and \$GWC, and you sold out of \$GWC\./.test(gol), gol);
  }

  /* ═══ 5. what a new badge says ═══ */
  {
    const silver = L.ogGrantText({ tier: 2, basis: 'send', capped: false }), capped = L.ogGrantText({ tier: 2, basis: 'send', capped: true });
    const bronze = L.ogGrantText({ tier: 1, basis: 'send', capped: false }), gold = L.ogGrantText({ tier: 3, basis: 'both' }), dia = L.ogGrantText({ tier: 4, basis: 'both' });
    check('a $SEND-only Silver says $SEND, never "both $SEND and $GWC"', /^OG Silver unlocked! You bought \$SEND inside the silver window, and still hold it/.test(silver) && !/BOTH|GWC|both/.test(silver), silver);
    check('  ...pays 5× (+4×), and says only a $SEND sell-out takes it', /a 5× Send Power bonus on everything \(\+4×/.test(silver) && /Keep holding \$SEND: sell out of it and it goes\.$/.test(silver), silver);
    check('  ...a capped one says the $SEND buy came before the beta ended', /You bought \$SEND before the beta ended \(on \$SEND alone, that is Silver\)/.test(capped) && !/GWC/.test(capped), capped);
    check('a $SEND-only Bronze says $SEND and 3×', /^OG Bronze unlocked! You bought \$SEND inside the bronze window/.test(bronze) && /a 3× Send Power bonus/.test(bronze) && !/GWC/.test(bronze), bronze);
    check('Gold still says both coins', /^OG Gold unlocked! You bought BOTH \$SEND and \$GWC inside the gold window, and still hold both/.test(gold) && /sell out of either and it goes\.$/.test(gold), gold);
    check('Diamond still says the first month of $GWC', /^OG Diamond unlocked! You bought BOTH \$SEND and \$GWC in the first month of \$GWC/.test(dia) && /a 20× Send Power bonus/.test(dia), dia);
    const lifted = L.ogGrantText({ tier: 3, basis: 'both' }, 2);
    check('a lifted badge says what it was: "Your Silver badge is now Gold."', /^OG Gold unlocked! Your Silver badge is now Gold\. You bought BOTH \$SEND and \$GWC/.test(lifted) && !/Your/.test(gold), lifted);
    check('no OG copy here tells anyone to buy', !/\b(buy now|you should buy|go buy|buy more)\b/i.test(silver + capped + bronze + gold + dia + L.ogRevokedText(2, ['SEND'])));
  }

  /* ═══ 6. the campaign clock ═══ */
  {
    const t0 = Date.now();
    check('/api/og/campaign says which coins each tier needs', C.needs && JSON.stringify(C.needs) === JSON.stringify({ 1: ['SEND'], 2: ['SEND'], 3: ['SEND', 'GWC'], 4: ['SEND', 'GWC'] }), JSON.stringify(C.needs));
    check('  ...and tierNow is the tier a buy right now earns under the new rule', C.tierNow === L.ogTierNow(t0), C.tierNow + ' vs ' + L.ogTierNow(t0));
    const at = (t) => L.ogTierNow(t);
    check('ogTierNow: Gold before the beta ended, Silver after it, then Bronze, then nothing', at(C.closes.gold - DAY) === 3 && at(C.closes.gold + DAY) === 2 && at(C.closes.silver + DAY) === 1 && at(C.closes.bronze + DAY) === 0,
      [at(C.closes.gold - DAY), at(C.closes.gold + DAY), at(C.closes.silver + DAY), at(C.closes.bronze + DAY)].join(','));
    check('  ...nothing before $SEND existed (a $GWC buy alone earns nothing)', at(OG_LAUNCH.SEND - DAY) === 0);
    check('every field the clock had is still there', ['open', 'tierNow', 'endsAt', 'closes', 'diamond', 'betaEndsAt', 'mult', 'name', 'windows'].every((k) => k in C), Object.keys(C).join(','));
    check('  ...in the source: tierNow from ogTierNow, needs from OG_TIER_NEEDS', /tierNow: ogTierNow\(t\),/.test(SRC) && /needs: OG_TIER_NEEDS,/.test(SRC)
      && /return Math\.max\(Math\.min\(sendT, gwcT\), Math\.min\(sendT, OG_TIER\.SILVER\)\);/.test(SRC));
  }

  /* ═══ 7. the wiring: every path runs the rule ═══ */
  {
    check('checkOg keeps the EARLIEST of equal tiers per coin', /if \(ogBetterScan\(best\[c\.key\], s\)\) best\[c\.key\] = \{ \.\.\.s, wallet: a \};/.test(SRC) && !/s\.tier > best\[c\.key\]\.tier\) best\[c\.key\]/.test(SRC));
    check('checkOg sums each coin over every linked wallet for the floor', /held\[c\.key\] \+= BigInt\(s\.balWei \|\| '0'\)/.test(SRC)
      && /const floor = \{ SEND: ogFloorOk\(held\.SEND, sendPx\), GWC: ogFloorOk\(held\.GWC, gwcPx\) \};/.test(SRC));
    check('  ...and so does the Diamond upgrade (no single-wallet floor is left anywhere)', /return await grantDiamondUpgrade\(userId, best, held\);/.test(SRC)
      && /ogFloorOk\(held && held\.SEND, sendPx\) && ogFloorOk\(held && held\.GWC, gwcPx\)/.test(SRC) && !/best\.(SEND|GWC)\.balWei/.test(SRC));
    check('the grant decides with ogAccountTier and claims only the wallets that earned it', /const pick = ogAccountTier\(\{ best, holdsAny, diamondOk, floor \}\);/.test(SRC)
      && /const claimAddrs = \[\.\.\.new Set\(pick\.wallets\.filter\(Boolean\)\)\];/.test(SRC) && /\.run\(tier, buyMs, lift, now\(\), scanFailed \? null : now\(\), userId\)/.test(SRC) && /const buyMs = pick\.buyMs;/.test(SRC)
      && /const lift = ogLiftable\(pick, failed\.SEND\) \? 1 : 0;/.test(SRC));
    // a failed read holds up only an answer it could change (ogReadDecides; section 9 runs it): the old blanket rule stopped every $SEND-only grant
    check('  ...a failed read holds up only an answer it could change (no blanket "any read failed: no $SEND-only badge")', !/if \(scanFailed && pick\.basis !== 'both'\) return 0;/.test(SRC)
      && /if \(!ogReadDecides\(pick, failed\)\) return 0;/.test(SRC) && /if \(!ogReadDecides\(hist, failed\)\) return 0;/.test(SRC) && /if \(pick\.unknown\) return 0;/.test(SRC));
    check('  ...and the note it sends is the one ogGrantText writes', /notify\(userId, tier === OG_TIER\.DIAMOND \? '💎' : '🏅', ogGrantText\(pick\), 'og'\);/.test(SRC));
    check('refreshHolder revokes by tier', /const gone = cur && \(cur\.og \|\| cur\.og_tier\) \? ogSoldOut\(cur\.og_tier, \{ SEND: sendTok > OG_DUST, GWC: gwcTok > OG_DUST \}\) : \[\];\n\s+if \(gone\.length\) \{\n\s+db\.prepare\('UPDATE users SET og = 0, og_tier = 0, og_revoked = 1 WHERE id = \?'\)\.run\(userId\);\n\s+notify\(userId, '💔', ogRevokedText\(cur\.og_tier, gone\), 'og'\);/.test(SRC));
    check('the full disconnect and the single-wallet unlink both revoke by tier, reading only the coins it needs',
      (SRC.match(/if \(ogSoldOut\(me\.og_tier, Object\.fromEntries\(need2?\.map\(\(k, i\) => \[k, !!hs2?\[i\]\]\)\)\)\.length\) revokeOg = true;/g) || []).length === 2
      && (SRC.match(/= ogNeeds\(me\.og_tier\), hs2? = await Promise\.all\(need2?\.map\(\(k\) => holdsToken\(me\.id, TOK\[k\]\)\)\)/g) || []).length === 2
      && !/holdsToken\(me\.id, TOK\.SEND\), holdsToken\(me\.id, TOK\.GWC\)/.test(SRC));
    check('the multiplier is paid while the coins the tier needs are held', /!ogSoldOut\(tier, \{ SEND: \(h\.send_tok \|\| 0\) > OG_DUST, GWC: \(h\.gwc_tok \|\| 0\) > OG_DUST \}\)\.length\) og = OG_TIER_MULT\[tier\] \|\| 1;/.test(SRC));
    check('the grant sweep re-tests "did not qualify" accounts every 6 hours (so $SEND-only buyers are picked up on their own), and a Silver that may be lifted',
      /WHERE \(u\.og_tier = 0 OR \(u\.og_tier = 3 AND u\.og_diamond_at IS NULL\) OR \(u\.og_tier = 2 AND u\.og_lift = 1\)\) AND u\.og_revoked = 0 AND u\.system = 0\s+AND u\.og_checked_at < \? AND u\.og_try_at < \?/.test(SRC) && /const OG_RESCAN_MS = 6 \* 3600 \* 1000;/.test(SRC));
    check('checkOg asks a Silver marked og_lift again (liftOgSilver), not only an un-tiered account or an un-asked Gold', /const lifting = u\.og_tier === OG_TIER\.SILVER && !!u\.og_lift;/.test(SRC)
      && /if \(u\.og_tier > 0 && !upgrading && !lifting\) return u\.og_tier;/.test(SRC) && /if \(lifting\) return await liftOgSilver\(userId, u, \{ best, holdsAny, diamondOk, held, failed \}\);/.test(SRC)
      && /"ALTER TABLE users ADD COLUMN og_lift INTEGER NOT NULL DEFAULT 0",/.test(SRC));
    check('  ...a check that arrives mid-scan is not dropped: the running scan goes again as it ends, with the wallets linked then',
      /if \(_ogScanning\.has\(userId\)\) \{ _ogRescan\.add\(userId\); return 0; \}/.test(SRC) && /if \(_ogRescan\.delete\(userId\)\) setImmediate\(\(\) => \{ checkOg\(userId\)\.catch\(\(\) => \{\}\); \}\);/.test(SRC));
    check('  ...and a wallet claimed by another account is never the scan a tier is earned on (it hid every other wallet of that coin)',
      /const claimedElsewhere = new Set\(addrs\.filter\(/.test(SRC) && /if \(ogDisqualified\(s\) \|\| claimedElsewhere\.has\(a\)\) \{ sawDq = true; continue; \}\s*\n\s*if \(ogBetterScan\(best\[c\.key\], s\)\)/.test(SRC));
  }

  /* ═══ 8. the payout and the dashboard, through the API ═══ */
  {
    const fx = async (tier, send, gwc) => {
      const u = mkUser('__ogs_' + tier + '_' + hex(3));
      db.prepare('UPDATE users SET og = 1, og_tier = ?, og_buy_ms = ? WHERE id = ?').run(tier, SILVER_TS, u.id);
      db.prepare('INSERT INTO holder_state (user_id, send_tok, gwc_tok, last_check) VALUES (?,?,?,?)').run(u.id, send, gwc, Date.now());
      const me = await api('/api/me', u.sid);
      return { u, og: me.j && me.j.user && me.j.user.boost ? me.j.user.boost.og : null };
    };
    const s1 = await fx(2, 5_000_000, 0);
    check('a Silver with $SEND and no $GWC is paid 5×', s1.og === 5, s1.og);
    const s0 = await fx(2, 0, 20_000_000);
    check('  ...a Silver with $GWC and no $SEND is paid nothing', s0.og === 1, s0.og);
    const b1 = await fx(1, 5_000_000, 0);
    check('a Bronze with $SEND and no $GWC is paid 3×', b1.og === 3, b1.og);
    const g0 = await fx(3, 5_000_000, 0);
    check('a Gold with no $GWC is paid nothing (Gold needs both)', g0.og === 1, g0.og);
    const g1 = await fx(3, 5_000_000, 20_000_000);
    check('  ...and 10× holding both', g1.og === 10, g1.og);
    const gs = await api('/api/gamify/me', s1.u.sid), gg = await api('/api/gamify/me', g1.u.sid);
    check('the dashboard is told what the badge must keep holding', gs.j && JSON.stringify(gs.j.ogNeeds) === '["SEND"]' && gg.j && JSON.stringify(gg.j.ogNeeds) === '["SEND","GWC"]', JSON.stringify(gs.j && gs.j.ogNeeds) + ' ' + JSON.stringify(gg.j && gg.j.ogNeeds));
    check('  ...and when its tier was earned', gs.j && gs.j.ogBuyMs === SILVER_TS && gs.j.ogTier === 2, gs.j && gs.j.ogBuyMs);
  }
  /* ═══ 9. checkOg itself, on a stubbed chain (2026-11-17 review round) ═══
     The real checkOg, liftOgSilver and grantDiamondUpgrade, lifted out of server.js and run against an in-memory database and
     a stub ogScan that answers per (wallet, coin) — the only thing missing is the explorer. This is where the order wallets
     are linked in, a read that fails, a wallet linked mid-scan and a wallet claimed elsewhere are each put to the code. */
  {
    const asyncSrc = (name) => { const m = new RegExp('\\n(async function ' + name + '\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\})\\n').exec(SRC); return m ? m[1] : null; };
    const ASYNC = ['checkOg', 'liftOgSilver', 'grantDiamondUpgrade'];
    const missingA = ASYNC.filter((n) => !asyncSrc(n));
    check('checkOg, liftOgSilver and grantDiamondUpgrade can be lifted out of server.js', !missingA.length, missingA.join(', '));
    const mem = new DatabaseSync(':memory:');
    mem.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, og INTEGER NOT NULL DEFAULT 0, og_tier INTEGER NOT NULL DEFAULT 0, og_revoked INTEGER NOT NULL DEFAULT 0,
      og_diamond_at INTEGER, og_lift INTEGER NOT NULL DEFAULT 0, og_buy_ms INTEGER NOT NULL DEFAULT 0, og_checked_at INTEGER NOT NULL DEFAULT 0, og_dq INTEGER NOT NULL DEFAULT 0,
      og_try_at INTEGER NOT NULL DEFAULT 0, system INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE identities (user_id INTEGER, type TEXT, addr TEXT);
      CREATE TABLE og_claims (addr_idx TEXT PRIMARY KEY, user_id INTEGER NOT NULL, tier INTEGER NOT NULL, claimed_at INTEGER NOT NULL);`);
    const TOKS = { SEND: '0xsend', GWC: '0xgwc' };
    const SCANS = new Map();     // wallet + ':' + coin -> scan facts, or 'fail'
    const PX = { SEND: 0.001, GWC: 0.001 };   // $ per token: 1,000,000 tokens = $1,000
    let delayMs = 0;
    const notes9 = [];
    const E9 = {
      db: mem, now: () => Date.now(), bidx: (a) => 'idx:' + String(a).toLowerCase(), notify: (uid, emo, text) => notes9.push({ uid, text }),
      walletAddresses: (uid) => mem.prepare("SELECT addr FROM identities WHERE user_id = ? AND type = 'wallet' ORDER BY rowid").all(uid).map((r) => r.addr),
      OG_MAX_WALLETS: 5, TOK: TOKS, OG_PAIR: { SEND: '0xp1', GWC: '0xp2' }, OG_LAUNCH, OG_TIER, OG_TIER_CLOSE, OG_TIER_NAME, OG_TIER_MULT, OG_TIER_NEEDS, OG_MIN_HOLD_USD,
      OG_DIAMOND_MULT: val(constSrc('OG_DIAMOND_MULT')), OG_GRANT_UNTIL_MS: Date.now() + 365 * DAY,
      ogDisqualified: (f) => !!(f.dumped && f.notAccumulator),
      guardedPriceUsd: async (t) => (t === TOKS.SEND ? PX.SEND : PX.GWC),
      ogScan: async (a, token) => {
        if (delayMs) await new Promise((ok) => setTimeout(ok, delayMs));
        const r = SCANS.get(a + ':' + (token === TOKS.SEND ? 'SEND' : 'GWC'));
        if (r === 'fail') throw new Error('og scan: history longer than the page budget');
        return r || { tier: 0, firstBuyMs: null, holds: false, balWei: '0', dumped: false, notAccumulator: false, monthBoughtWei: '0', monthSoldWei: '0' };
      },
      _ogScanning: new Set(), _ogRescan: new Set(),
    };
    const K = new Function(...Object.keys(E9), [...NAMES.map(fnSrc), ...ASYNC.map(asyncSrc)].join('\n') + '\nreturn { checkOg, liftOgSilver };')(...Object.values(E9));
    // a scan of one coin in one wallet: bought at `ts`, holding `tokens`; month flows only when asked (the Diamond question)
    const sc = (coin, ts, tokens = 1_000_000, extra = {}) => ({ tier: L.ogTierForBuy(ts, OG_LAUNCH[coin]), firstBuyMs: ts, holds: tokens > 0, balWei: (BigInt(tokens) * 10n ** 18n).toString(),
      dumped: false, notAccumulator: false, monthBoughtWei: '0', monthSoldWei: '0', ...extra });
    let uid = 0;
    const user = (wallets) => { uid++; mem.prepare('INSERT INTO users (id) VALUES (?)').run(uid); for (const w of wallets) link(uid, w); return uid; };
    const link = (id, w) => mem.prepare("INSERT INTO identities (user_id, type, addr) VALUES (?, 'wallet', ?)").run(id, w);
    const row = (id) => mem.prepare('SELECT * FROM users WHERE id = ?').get(id);
    const claims = (id) => mem.prepare('SELECT addr_idx, tier FROM og_claims WHERE user_id = ? ORDER BY addr_idx').all(id).map((r) => r.addr_idx.replace('idx:', '') + '=' + r.tier).join(',');
    const settle = () => new Promise((ok) => setTimeout(ok, 50));

    /* (a)/(b) the $SEND wallet linked first, then the $GWC one: Silver (capped, left open), then Gold */
    {
      SCANS.set('0xa1:SEND', sc('SEND', GOLD_TS.SEND)); SCANS.set('0xb1:GWC', sc('GWC', GOLD_TS.GWC));
      const id = user(['0xa1']);
      const t1 = await K.checkOg(id), r1 = row(id);
      check('$SEND wallet linked alone (bought before the beta ended): Silver, capped, and left open to be lifted (og_lift)', t1 === 2 && r1.og_tier === 2 && r1.og_lift === 1 && r1.og_buy_ms === GOLD_TS.SEND && claims(id) === '0xa1=2', JSON.stringify({ t1, r1, claims: claims(id) }));
      link(id, '0xb1');
      const t2 = await K.checkOg(id), r2 = row(id);
      check('  ...the $GWC wallet linked next lifts it to Gold: the both-coins tier, dated by the later coin, both wallets claimed, no longer open', t2 === 3 && r2.og_tier === 3 && r2.og_lift === 0 && r2.og_buy_ms === Math.max(GOLD_TS.SEND, GOLD_TS.GWC) && claims(id) === '0xa1=3,0xb1=3' && r2.og_diamond_at > 0,
        JSON.stringify({ t2, r2, claims: claims(id) }));
      check('  ...and the note says the Silver became Gold, on both coins', /^OG Gold unlocked! Your Silver badge is now Gold\. You bought BOTH \$SEND and \$GWC inside the gold window/.test((notes9.filter((n) => n.uid === id).pop() || {}).text || ''), (notes9.filter((n) => n.uid === id).pop() || {}).text);
    }
    /* Diamond through the same door */
    {
      const m = { monthBoughtWei: '5', monthSoldWei: '1' };
      SCANS.set('0xa2:SEND', sc('SEND', GOLD_TS.SEND, 1_000_000, m)); SCANS.set('0xb2:GWC', sc('GWC', GOLD_TS.GWC, 1_000_000, m));
      const id = user(['0xa2']);
      await K.checkOg(id); link(id, '0xb2');
      const t = await K.checkOg(id);
      check('  ...a capped Silver whose wallets show a Diamond month lifts straight to Diamond', t === 4 && row(id).og_tier === 4 && claims(id) === '0xa2=4,0xb2=4', JSON.stringify({ t, r: row(id) }));
    }
    /* (d) both coins in the Gold window, $GWC under the floor today: Silver now, Gold once $GWC is back over it */
    {
      SCANS.set('0xa3:SEND', sc('SEND', GOLD_TS.SEND)); SCANS.set('0xb3:GWC', sc('GWC', GOLD_TS.GWC, 50_000));   // $50 of $GWC
      const id = user(['0xa3', '0xb3']);
      const t1 = await K.checkOg(id);
      check('$GWC under the floor: Silver on $SEND alone, left open (never final while Gold is in reach)', t1 === 2 && row(id).og_lift === 1 && claims(id) === '0xa3=2', JSON.stringify({ t1, r: row(id), claims: claims(id) }));
      const t2 = await K.checkOg(id);
      check('  ...asked again with nothing new: still Silver, still open, never lowered', t2 === 2 && row(id).og_tier === 2 && row(id).og_lift === 1, JSON.stringify({ t2, r: row(id) }));
      SCANS.set('0xb3:GWC', sc('GWC', GOLD_TS.GWC, 500_000));   // topped up to $500
      const t3 = await K.checkOg(id);
      check('  ...$GWC topped up past the floor: Gold on the next ask', t3 === 3 && row(id).og_tier === 3 && claims(id) === '0xa3=3,0xb3=3', JSON.stringify({ t3, r: row(id), claims: claims(id) }));
    }
    /* (c) a wallet linked while the first scan is running */
    {
      SCANS.set('0xa4:SEND', sc('SEND', GOLD_TS.SEND)); SCANS.set('0xb4:GWC', sc('GWC', GOLD_TS.GWC));
      const id = user(['0xa4']);
      delayMs = 20;
      const first = K.checkOg(id);
      await new Promise((ok) => setTimeout(ok, 5));
      link(id, '0xb4');
      const second = await K.checkOg(id);
      const t1 = await first;
      delayMs = 0;
      for (let i = 0; i < 40 && row(id).og_tier !== 3; i++) await settle();
      check('a wallet linked mid-scan: the late check is not dropped — the scan runs again as it ends, and the account is Gold',
        second === 0 && t1 === 2 && row(id).og_tier === 3 && claims(id) === '0xa4=3,0xb4=3', JSON.stringify({ second, t1, r: row(id), claims: claims(id) }));
    }
    /* finding 2: a failed $GWC read cannot hold up a $SEND-only badge */
    {
      SCANS.set('0xw1:SEND', sc('SEND', SILVER_TS)); SCANS.set('0xw2:GWC', 'fail');
      const id = user(['0xw1', '0xw2']);
      const t = await K.checkOg(id);
      check('a $GWC read that fails on every attempt no longer blocks a $SEND-only Silver (it cannot change it)', t === 2 && row(id).og_tier === 2 && row(id).og_lift === 0 && claims(id) === '0xw1=2', JSON.stringify({ t, r: row(id), claims: claims(id) }));
    }
    {
      SCANS.set('0xw3:SEND', sc('SEND', GOLD_TS.SEND)); SCANS.set('0xw4:GWC', 'fail');
      const id = user(['0xw3', '0xw4']);
      const t = await K.checkOg(id);
      check('  ...a capped Silver with a $GWC read that failed is granted and left open: the $GWC wallet may make it Gold later', t === 2 && row(id).og_lift === 1, JSON.stringify({ t, r: row(id) }));
      SCANS.set('0xw4:GWC', sc('GWC', GOLD_TS.GWC));
      const t2 = await K.checkOg(id);
      check('  ...and once that read completes, it is Gold', t2 === 3 && row(id).og_tier === 3, JSON.stringify({ t2, r: row(id) }));
    }
    {
      SCANS.set('0xw5:SEND', sc('SEND', SILVER_TS + 20 * DAY)); SCANS.set('0xw6:SEND', 'fail');
      const id = user(['0xw5', '0xw6']);
      const t = await K.checkOg(id);
      check('a failed $SEND read on another wallet: a Silver is still granted (it cannot be beaten on $SEND alone), left open for its date', t === 2 && row(id).og_lift === 1 && row(id).og_buy_ms === SILVER_TS + 20 * DAY, JSON.stringify({ t, r: row(id) }));
      SCANS.set('0xw6:SEND', sc('SEND', SILVER_TS));
      const t2 = await K.checkOg(id);
      check('  ...once it reads, the earlier $SEND buy dates the badge, that wallet is claimed too, and nothing is left open (uncapped)', t2 === 2 && row(id).og_buy_ms === SILVER_TS && row(id).og_lift === 0 && claims(id) === '0xw5=2,0xw6=2', JSON.stringify({ t2, r: row(id), claims: claims(id) }));
    }
    {
      SCANS.set('0xw7:SEND', sc('SEND', BRONZE_TS)); SCANS.set('0xw8:SEND', 'fail');
      const id = user(['0xw7', '0xw8']);
      const t = await K.checkOg(id);
      check('  ...but a Bronze waits for every $SEND wallet (the unread one may hold a Silver buy): nothing written', t === 0 && row(id).og_tier === 0 && row(id).og_checked_at === 0, JSON.stringify({ t, r: row(id) }));
    }
    {
      SCANS.set('0xw9:GWC', 'fail');
      const id = user(['0xw9']);
      const t = await K.checkOg(id);
      check('no $SEND buy and a failed $GWC read is a real "did not qualify" ($GWC alone earns nothing), recorded and re-tested in 6 hours', t === 0 && row(id).og_tier === 0 && row(id).og_checked_at > 0, JSON.stringify({ t, r: row(id) }));
    }
    /* finding 3: a wallet claimed elsewhere does not hide this account's own wallet */
    {
      SCANS.set('0xc1:SEND', sc('SEND', GOLD_TS.SEND)); SCANS.set('0xc2:SEND', sc('SEND', SILVER_TS));
      mem.prepare('INSERT INTO og_claims (addr_idx, user_id, tier, claimed_at) VALUES (?,?,?,?)').run('idx:0xc1', 9999, 3, Date.now());
      const id = user(['0xc1', '0xc2']);
      const t = await K.checkOg(id);
      check('an earlier $SEND wallet already claimed by another account: this account\'s own wallet earns its Silver, and only it is claimed', t === 2 && row(id).og_tier === 2 && row(id).og_dq === 0 && row(id).og_buy_ms === SILVER_TS && claims(id) === '0xc2=2' && row(id).og_lift === 0,
        JSON.stringify({ t, r: row(id), claims: claims(id) }));
    }
    /* the lift never lowers, never steals a claim, never touches a revoked badge */
    {
      SCANS.set('0xd1:SEND', sc('SEND', GOLD_TS.SEND)); SCANS.set('0xd2:GWC', sc('GWC', GOLD_TS.GWC));
      const id = user(['0xd1']);
      await K.checkOg(id);
      mem.prepare('INSERT INTO og_claims (addr_idx, user_id, tier, claimed_at) VALUES (?,?,?,?)').run('idx:0xd2', 9998, 3, Date.now());
      link(id, '0xd2');
      const t = await K.checkOg(id);
      check('a capped Silver whose $GWC wallet is claimed by another account stays Silver (claims are not stolen), still open', t === 2 && row(id).og_tier === 2 && row(id).og_lift === 1 && claims(id) === '0xd1=2', JSON.stringify({ t, r: row(id), claims: claims(id) }));
      SCANS.set('0xd1:SEND', sc('SEND', GOLD_TS.SEND, 1000));   // $1 of $SEND: under the floor today
      const t2 = await K.checkOg(id);
      check('  ...$SEND under the floor on a re-ask: the badge is never lowered by it', t2 === 2 && row(id).og_tier === 2, JSON.stringify({ t2, r: row(id) }));
      mem.prepare('UPDATE users SET og = 0, og_tier = 0, og_revoked = 1 WHERE id = ?').run(id);
      SCANS.set('0xd1:SEND', sc('SEND', GOLD_TS.SEND));
      check('  ...and a revoked account is never asked again', await K.checkOg(id) === 0 && row(id).og_tier === 0);
    }
    {
      SCANS.set('0xe1:SEND', sc('SEND', SILVER_TS));
      const id = user(['0xe1']);
      const t = await K.checkOg(id);
      check('a Silver bought after the beta is final, as before: not left open, never re-scanned', t === 2 && row(id).og_lift === 0 && await K.checkOg(id) === 2, JSON.stringify({ t, r: row(id) }));
    }
    /* the sweep's own query, run on these rows: it picks a Silver left open */
    {
      const m = /const rows = db\.prepare\(`(SELECT u\.id FROM users u\s+WHERE \(u\.og_tier = 0 OR[\s\S]*?)`\)\.all\(/.exec(SRC);
      let picked = [];
      if (m) {
        const id = user([]); link(id, '0xf1');
        mem.prepare('UPDATE users SET og = 1, og_tier = 2, og_lift = 1 WHERE id = ?').run(id);
        const id2 = user([]); link(id2, '0xf2');
        mem.prepare('UPDATE users SET og = 1, og_tier = 2, og_lift = 0 WHERE id = ?').run(id2);
        picked = mem.prepare(m[1]).all(Date.now(), Date.now(), 1000).map((r) => r.id);
        check('the grant sweep\'s query, run as written: it picks a Silver left open and skips a final one', picked.includes(id) && !picked.includes(id2), JSON.stringify(picked));
      } else check('the grant sweep\'s query can be read from server.js', false);
    }
    /* the pure rules behind it */
    const base = { tier: 2, basis: 'send', capped: false };
    check('ogLiftable: only a $SEND-only Silver, and only when capped or a $SEND read failed', L.ogLiftable({ ...base, capped: true }, false) && L.ogLiftable(base, true) && !L.ogLiftable(base, false)
      && !L.ogLiftable({ tier: 3, basis: 'both' }, true) && !L.ogLiftable({ tier: 1, basis: 'send', capped: false }, true));
    check('ogLiftWhat: up to a higher tier, to an earlier date, else nothing — never down, never on an unreadable price',
      L.ogLiftWhat({ tier: 3, basis: 'both' }, 5) === 'up' && L.ogLiftWhat({ tier: 2, basis: 'send', buyMs: 4 }, 5) === 'earlier' && L.ogLiftWhat({ tier: 2, basis: 'send', buyMs: 6 }, 5) === null
      && L.ogLiftWhat({ tier: 1, basis: 'send', buyMs: 1 }, 5) === null && L.ogLiftWhat({ tier: 0 }, 5) === null && L.ogLiftWhat({ tier: 0, unknown: true }, 5) === null);
    check('ogReadDecides: a failed $SEND read holds up a "no" and a Bronze; a failed $GWC read holds up nothing; Silver and Gold are written',
      !L.ogReadDecides({ tier: 0 }, { SEND: true }) && L.ogReadDecides({ tier: 0 }, { GWC: true }) && !L.ogReadDecides({ tier: 1, basis: 'send' }, { SEND: true }) && L.ogReadDecides({ tier: 1, basis: 'send' }, { GWC: true })
      && L.ogReadDecides({ tier: 2, basis: 'send' }, { SEND: true, GWC: true }) && L.ogReadDecides({ tier: 3, basis: 'both' }, { SEND: true }));
    mem.close();
  }

  /* ═══ 10. the Arcade's OG card knows a revoked account ═══ */
  {
    const r = mkUser('__ogs_rv_' + hex(3)), k = mkUser('__ogs_ok_' + hex(3));
    db.prepare('UPDATE users SET og = 0, og_tier = 0, og_revoked = 1 WHERE id = ?').run(r.id);
    const a = await api('/api/competitions', r.sid), b = await api('/api/competitions', k.sid);
    check('/api/competitions tells a revoked member\'s OG card so (og.mine.revoked), and an ordinary one not', a.status === 200 && a.j.og && a.j.og.mine && a.j.og.mine.revoked === true && b.j.og.mine.revoked === false, JSON.stringify([a.j && a.j.og && a.j.og.mine, b.j && b.j.og && b.j.og.mine]));
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  for (const id of made) {
    for (const t of ['sessions', 'holder_state', 'notifications', 'points_events']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {}
  }
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
