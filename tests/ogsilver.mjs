/* 🥈 OG after the beta (owner, 2026-11-17): "Moving forward after beta, only consider people who have bought Send for the
   silver OG and bronze OG badges."
     Gold (10×) and Diamond (20×) — unchanged: both coins, and kept only while both are held.
     Silver (5×) and Bronze (3×) — $SEND alone: the earliest $SEND buy's tier, CAPPED at Silver (a $SEND buy before the beta
     ended without $GWC is Silver, never Gold); $GWC is not needed to earn, hold or keep them.
     The account's tier is the better of the two. The $100 floor is each coin SUMMED over every linked wallet, and of equal
     tiers the EARLIEST buy dates the badge.
   The decision is checked as pure functions lifted out of server.js and run on fixed inputs (no chain is needed — a grant
   is otherwise only reachable through a full on-chain replay), the payout and the campaign clock through the real API with
   DB-minted fixtures, and the wiring by reading the source. Everything made here is deleted.
   The same day's two decisions (sections 11 and 12): a Gold or Diamond that sells out of $GWC but keeps $SEND drops to
   what $SEND alone earns (Silver, or Bronze) instead of being revoked — only selling out of $SEND ends a badge for good,
   and Gold and Diamond do not come back — and badges already revoked under the old rule are re-checked on-chain once and
   restored as Silver or Bronze where $SEND alone earns it. */
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
  const NAMES = ['ogTierForBuy', 'ogBetterScan', 'ogFloorOk', 'ogAccountTier', 'ogNeeds', 'ogSoldOut', 'ogTierNow', 'ogGrantText', 'ogRevokedText', 'ogDiamondOk', 'ogLiftable', 'ogLiftWhat', 'ogReadDecides',
    'ogClaimWallets', 'ogLoss', 'ogCapped', 'ogHeldThrough', 'ogDropText', 'ogDropLostText', 'ogRestoreText', 'ogPausedDropText'];
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
    // since the owner's "Drop to Silver" (2026-11-17) only a sell-out of $SEND revokes, so that is what every revocation note says (section 11 runs the drop)
    const sil = L.ogRevokedText(2, ['SEND']), gol = L.ogRevokedText(3, ['SEND']), gol2 = L.ogRevokedText(3, ['SEND', 'GWC']);
    check('the revocation note says $SEND was sold out, which that tier needed, and that only that ends a badge', /^OG Silver removed — you sold out of \$SEND, which Silver needs\. Selling out of \$SEND ends an OG badge for good: it can’t be reclaimed\.$/.test(sil) && !/GWC/.test(sil), sil);
    check('  ...and for Gold the same, or both coins when both went', /^OG Gold removed — you sold out of \$SEND, which Gold needs\./.test(gol) && /^OG Gold removed — you sold out of both \$SEND and \$GWC\. Selling out of \$SEND ends/.test(gol2), gol + ' | ' + gol2);
  }

  /* ═══ 5. what a new badge says ═══ */
  {
    const silver = L.ogGrantText({ tier: 2, basis: 'send', capped: false }), capped = L.ogGrantText({ tier: 2, basis: 'send', capped: true });
    const bronze = L.ogGrantText({ tier: 1, basis: 'send', capped: false }), gold = L.ogGrantText({ tier: 3, basis: 'both' }), dia = L.ogGrantText({ tier: 4, basis: 'both' });
    check('a $SEND-only Silver says $SEND, never "both $SEND and $GWC"', /^OG Silver unlocked! You bought \$SEND inside the silver window, and still hold it/.test(silver) && !/BOTH|GWC|both/.test(silver), silver);
    check('  ...pays 5× (+4×), and says only a $SEND sell-out takes it', /a 5× Send Power bonus on everything \(\+4×/.test(silver) && /Keep holding \$SEND: sell out of it and it goes\.$/.test(silver), silver);
    check('  ...a capped one says the $SEND buy came before the beta ended', /You bought \$SEND before the beta ended \(on \$SEND alone, that is Silver\)/.test(capped) && !/GWC/.test(capped), capped);
    check('a $SEND-only Bronze says $SEND and 3×', /^OG Bronze unlocked! You bought \$SEND inside the bronze window/.test(bronze) && /a 3× Send Power bonus/.test(bronze) && !/GWC/.test(bronze), bronze);
    check('Gold still says both coins — and that selling $GWC drops it, selling $SEND ends it', /^OG Gold unlocked! You bought BOTH \$SEND and \$GWC inside the gold window, and still hold both/.test(gold) && /Keep holding both: sell out of \$GWC and it drops to Silver or Bronze on \$SEND alone; sell out of \$SEND and it goes\.$/.test(gold), gold);
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
    check('  ...and so does the Diamond upgrade (no single-wallet floor is left anywhere)', /return await grantDiamondUpgrade\(userId, best, held, \{ same, monthFrom \}\);/.test(SRC)
      && /ogFloorOk\(held && held\.SEND, sendPx\) && ogFloorOk\(held && held\.GWC, gwcPx\)/.test(SRC) && !/best\.(SEND|GWC)\.balWei/.test(SRC));
    check('the grant decides with ogAccountTier and claims only the wallets that earned it', /const pick = ogAccountTier\(\{ best, holdsAny, diamondOk, floor \}\);/.test(SRC)
      && /another account's grant while this scan was running\. A Diamond claims every wallet it rests on \(ogClaimWallets\)\. \*\/\n\s+const claimAddrs = ogClaimWallets\(pick, monthFrom\);/.test(SRC) && /\.run\(tier, buyMs, lift, now\(\), scanFailed \? null : now\(\), userId\)/.test(SRC) && /const buyMs = pick\.buyMs;/.test(SRC)
      && /const lift = ogLiftable\(pick, failed\.SEND, u\.og_cap\) \? 1 : 0;/.test(SRC));
    // a failed read holds up only an answer it could change (ogReadDecides; section 9 runs it): the old blanket rule stopped every $SEND-only grant
    check('  ...a failed read holds up only an answer it could change (no blanket "any read failed: no $SEND-only badge")', !/if \(scanFailed && pick\.basis !== 'both'\) return 0;/.test(SRC)
      && /if \(!ogReadDecides\(pick, failed\)\) return 0;/.test(SRC) && /if \(!ogReadDecides\(hist, failed\)\) return 0;/.test(SRC) && /if \(pick\.unknown\) return 0;/.test(SRC));
    check('  ...and the note it sends is the one ogGrantText writes', /notify\(userId, tier === OG_TIER\.DIAMOND \? '💎' : '🏅', ogGrantText\(pick\), 'og'\);/.test(SRC));
    // since 2026-11-17 (the owner's "Drop to Silver") a sell-out of $SEND revokes and a sell-out of $GWC alone drops (ogLoss); section 11 runs both
    check('refreshHolder decides by tier, after its reads (a read that fails throws first), in ogAfterHolderRead', /if \(sendTok <= OG_DUST \|\| gwcTok <= OG_DUST\) ogAfterHolderRead\(userId, sendTok, gwcTok\);/.test(SRC)
      && SRC.indexOf('ogAfterHolderRead(userId, sendTok, gwcTok);') > SRC.indexOf('const sendTok = Number(sendWei) / 1e18')
      && /const gone = cur && \(cur\.og \|\| cur\.og_tier\) \? ogSoldOut\(cur\.og_tier, \{ SEND: sendTok > OG_DUST, GWC: gwcTok > OG_DUST \}\) : \[\];\n\s+const loss = ogLoss\(gone\);/.test(SRC));
    check('the full disconnect and the single-wallet unlink both decide by tier, reading only the coins it needs, while the wallet is still linked (ogLeaveVerdict, then ogOnLeave)',
      /const ogV = await ogLeaveVerdict\(me\), revokeOg = ogV === 'revoke';/.test(SRC) && /ogOnLeave\(me\.id, ogV, true\);/.test(SRC)
      && /const ogV2 = await ogLeaveVerdict\(me\), revokeOg = ogV2 === 'revoke';/.test(SRC) && /ogOnLeave\(me\.id, ogV2, linked\.length === 1\);/.test(SRC)
      && SRC.indexOf('const ogV2 = await ogLeaveVerdict(me)') < SRC.indexOf("DELETE FROM identities WHERE user_id = ? AND type = 'wallet' AND identifier = ?")
      && /const need = ogNeeds\(me\.og_tier\), hs = await Promise\.all\(need\.map\(\(k\) => holdsToken\(me\.id, TOK\[k\]\)\)\);/.test(SRC)
      && !/holdsToken\(me\.id, TOK\.SEND\), holdsToken\(me\.id, TOK\.GWC\)/.test(SRC));
    check('the multiplier is paid while the coins the tier needs are held', /!ogSoldOut\(tier, \{ SEND: \(h\.send_tok \|\| 0\) > OG_DUST, GWC: \(h\.gwc_tok \|\| 0\) > OG_DUST \}\)\.length\) og = OG_TIER_MULT\[tier\] \|\| 1;/.test(SRC));
    check('the grant sweep re-tests "did not qualify" accounts every 6 hours (so $SEND-only buyers are picked up on their own), and a Silver that may be lifted',
      /WHERE \(u\.og_tier = 0 OR \(u\.og_tier = 3 AND u\.og_diamond_at IS NULL\) OR \(u\.og_tier = 2 AND u\.og_lift = 1\)\) AND u\.og_revoked = 0 AND u\.system = 0\s+AND u\.og_checked_at < \? AND u\.og_try_at < \?/.test(SRC) && /const OG_RESCAN_MS = 6 \* 3600 \* 1000;/.test(SRC));
    check('checkOg asks a Silver marked og_lift again (liftOgSilver), not only an un-tiered account or an un-asked Gold', /const lifting = !requal && u\.og_tier === OG_TIER\.SILVER && !!u\.og_lift;/.test(SRC)
      && /if \(u\.og_tier > 0 && !upgrading && !lifting && !requal\) return u\.og_tier;/.test(SRC) && /if \(lifting\) return await liftOgSilver\(userId, u, \{ best, holdsAny, diamondOk, held, failed, same, monthFrom \}\);/.test(SRC)
      && /"ALTER TABLE users ADD COLUMN og_lift INTEGER NOT NULL DEFAULT 0",/.test(SRC));
    check('  ...a check that arrives mid-scan is not dropped: the running scan goes again as it ends, with the wallets linked then',
      /if \(_ogScanning\.has\(userId\)\) \{ ogAgain\(userId, opts\); return 0; \}/.test(SRC) && /function ogAgain\(userId, opts\) \{ _ogRescan\.add\(userId\); if \(opts && opts\.link\) _ogRescanLink\.add\(userId\); \}/.test(SRC)
      && /if \(_ogRescan\.delete\(userId\)\) \{ const link = _ogRescanLink\.delete\(userId\); setImmediate\(\(\) => \{ checkOg\(userId, link \? \{ link: true \} : \{\}\)\.catch\(\(\) => \{\}\); \}\); \}/.test(SRC));
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
    const ASYNC = ['checkOg', 'liftOgSilver', 'grantDiamondUpgrade', 'restoreOg', 'ogLeaveVerdict'];
    const SYNC = ['ogAfterHolderRead', 'ogRequalSoon', 'ogOnLeave', 'ogRequalify', 'ogAgain', 'ogOnLink'];   // the drop and the restore (section 11)
    const missingA = ASYNC.filter((n) => !asyncSrc(n)).concat(SYNC.filter((n) => !fnSrc(n)));
    check('checkOg, liftOgSilver, grantDiamondUpgrade and the drop and restore steps can be lifted out of server.js', !missingA.length, missingA.join(', '));
    const mem = new DatabaseSync(':memory:');
    mem.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, og INTEGER NOT NULL DEFAULT 0, og_tier INTEGER NOT NULL DEFAULT 0, og_revoked INTEGER NOT NULL DEFAULT 0,
      og_diamond_at INTEGER, og_lift INTEGER NOT NULL DEFAULT 0, og_buy_ms INTEGER NOT NULL DEFAULT 0, og_checked_at INTEGER NOT NULL DEFAULT 0, og_dq INTEGER NOT NULL DEFAULT 0,
      og_try_at INTEGER NOT NULL DEFAULT 0, system INTEGER NOT NULL DEFAULT 0,
      og_requal INTEGER NOT NULL DEFAULT 0, og_cap INTEGER NOT NULL DEFAULT 0, og_recheck INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER);
      CREATE TABLE identities (user_id INTEGER, type TEXT, addr TEXT);
      CREATE TABLE og_claims (addr_idx TEXT PRIMARY KEY, user_id INTEGER NOT NULL, tier INTEGER NOT NULL, claimed_at INTEGER NOT NULL);`);
    const TOKS = { SEND: '0xsend', GWC: '0xgwc' };
    const SCANS = new Map();     // wallet + ':' + coin -> scan facts, or 'fail'
    const PX = { SEND: 0.001, GWC: 0.001 };   // $ per token: 1,000,000 tokens = $1,000
    let delayMs = 0, scanNow = 0, scanMax = 0;
    const notes9 = [];
    const HOLDS = new Map();     // user id + ':' + coin -> what holdsToken answers (the disconnect / unlink read), or 'fail'
    const E9 = {
      db: mem, now: () => Date.now(), bidx: (a) => 'idx:' + String(a).toLowerCase(), notify: (uid, emo, text) => notes9.push({ uid, text }),
      walletAddresses: (uid) => mem.prepare("SELECT addr FROM identities WHERE user_id = ? AND type = 'wallet' ORDER BY rowid").all(uid).map((r) => r.addr),
      OG_MAX_WALLETS: 5, TOK: TOKS, OG_PAIR: { SEND: '0xp1', GWC: '0xp2' }, OG_LAUNCH, OG_TIER, OG_TIER_CLOSE, OG_TIER_NAME, OG_TIER_MULT, OG_TIER_NEEDS, OG_MIN_HOLD_USD,
      OG_DIAMOND_MULT: val(constSrc('OG_DIAMOND_MULT')), OG_GRANT_UNTIL_MS: Date.now() + 365 * DAY,
      ogDisqualified: (f) => !!(f.dumped && f.notAccumulator),
      guardedPriceUsd: async (t) => (t === TOKS.SEND ? PX.SEND : PX.GWC),
      ogScan: async (a, token) => {
        scanNow++; scanMax = Math.max(scanMax, scanNow);   // how many walks of the explorer run at once
        try {
          if (delayMs) await new Promise((ok) => setTimeout(ok, delayMs));
          const r = SCANS.get(a + ':' + (token === TOKS.SEND ? 'SEND' : 'GWC'));
          if (r === 'fail') throw new Error('og scan: history longer than the page budget');
          return r || { tier: 0, firstBuyMs: null, holds: false, balWei: '0', dumped: false, notAccumulator: false, monthBoughtWei: '0', monthSoldWei: '0' };
        } finally { scanNow--; }
      },
      _ogScanning: new Set(), _ogRescan: new Set(), _ogRescanLink: new Set(),
      OG_MONTH_MS: 30 * DAY, OG_DUST: val(constSrc('OG_DUST')), _ogRequalQueue: { tail: Promise.resolve() },
      holdsToken: async (uid, tok) => { const v = HOLDS.get(uid + ':' + (tok === TOKS.SEND ? 'SEND' : 'GWC')); if (v === 'fail') throw new Error('rpc: no answer'); return !!v; },
    };
    const K = new Function(...Object.keys(E9), [...NAMES.map(fnSrc), ...ASYNC.map(asyncSrc), ...SYNC.map(fnSrc)].join('\n') + '\nreturn { checkOg, liftOgSilver, ogAfterHolderRead, ogLeaveVerdict, ogOnLeave };')(...Object.values(E9));
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
      /* since Diamond-on-link (2026-11-17) the scan of the older wallets writes nothing at all — the wallet set changed under it
         (checkOg's `same`) — where it used to write a Silver the re-run then lifted: one answer, one note, on the wallets linked now */
      const notesA4 = notes9.filter((n) => n.uid === id);
      check('a wallet linked mid-scan: the late check is not dropped — the scan of the older wallets writes nothing, runs again as it ends, and the account is Gold',
        second === 0 && t1 === 0 && row(id).og_tier === 3 && claims(id) === '0xa4=3,0xb4=3' && notesA4.length === 1 && /^OG Gold unlocked! You bought BOTH/.test(notesA4[0].text),
        JSON.stringify({ second, t1, r: row(id), claims: claims(id), notes: notesA4.length }));
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
    /* ═══ 11. Selling $GWC is a drop, not the end (owner, 2026-11-17) ═══
       "A member who earned Gold with both coins later sells all their $GWC but keeps their $SEND" → "Drop to Silver"; and
       "Past losses" → "Re-check and restore". The real refreshHolder step (ogAfterHolderRead), the disconnect / unlink steps
       (ogLeaveVerdict, ogOnLeave), the re-decision (ogRequalify) and the restore (restoreOg), on the same stubbed chain. */
    const until = async (f) => { for (let i = 0; i < 80 && !f(); i++) await settle(); return f(); };
    const lastNote = (id) => (notes9.filter((n) => n.uid === id).pop() || {}).text || '';
    const noteCount = (id) => notes9.filter((n) => n.uid === id).length;
    const unlink = (id, w) => mem.prepare("DELETE FROM identities WHERE user_id = ? AND addr = ?").run(id, w);
    const me = (id) => ({ ...row(id) });
    {
      check('ogLoss: $SEND among the coins sold out revokes; $GWC alone drops; nothing gone is nothing',
        L.ogLoss([]) === null && L.ogLoss(null) === null && L.ogLoss(['GWC']) === 'drop' && L.ogLoss(['SEND']) === 'revoke' && L.ogLoss(['SEND', 'GWC']) === 'revoke');
      check('ogCapped: an account held to Silver (og_cap 2) or Bronze is capped; none (0) or Gold is not', L.ogCapped(2) && L.ogCapped(1) && !L.ogCapped(0) && !L.ogCapped(3) && !L.ogCapped(undefined));
      check('ogLiftable: a capped Silver is never left open for Gold — only for the date a $SEND wallet not read may hold',
        !L.ogLiftable({ tier: 2, basis: 'send', capped: true }, false, 2) && L.ogLiftable({ tier: 2, basis: 'send', capped: true }, true, 2) && L.ogLiftable({ tier: 2, basis: 'send', capped: true }, false, 0));
      check('ogHeldThrough: one stretch from before the mark → held; a hand-over between linked wallets at one moment → held; a gap, a start after the mark, an end, or nothing → not',
        L.ogHeldThrough([[1, null]], 5) && L.ogHeldThrough([[12, null], [1, 10], [10, 12]], 5) && !L.ogHeldThrough([[1, 10], [12, null]], 5)
        && !L.ogHeldThrough([[6, null]], 5) && !L.ogHeldThrough([[1, 10]], 5) && !L.ogHeldThrough([], 5) && L.ogHeldThrough([[1, 3], [2, null]], 5));
    }
    /* ogScan's own stretches of holding (heldSpans), on a replayed history — the restore pass's "held without a break" */
    {
      const scanSrc = asyncSrc('ogScan');
      let rowsX = [], balX = 0n;
      const SX = scanSrc ? new Function('OG_ROUTERS', 'ogTransfers', 'routedPoolFlows', 'erc20Balance', 'OG_DUST_WEI', 'OG_DIAMOND_START', 'OG_DIAMOND_END', 'OG_MONTH_MS', 'ogTierForBuy', 'OG_TIER',
        scanSrc + '\nreturn ogScan;')([], async () => rowsX, async () => ({ take: () => 0n }), async () => balX, 1000000000n, OG_LAUNCH.GWC, OG_LAUNCH.GWC + 30 * DAY, 30 * DAY, L.ogTierForBuy, OG_TIER) : null;
      const W = '0x000000000000000000000000000000000000aaaa', POOL = '0x000000000000000000000000000000000000bbbb', OTHER = '0x000000000000000000000000000000000000cccc';
      let n = 0;
      const tx = (from, to, tokens, ts) => ({ from: { hash: from }, to: { hash: to }, total: { value: (BigInt(tokens) * 10n ** 18n).toString() }, timestamp: new Date(ts).toISOString(), block_number: String(++n), log_index: '0' });
      const t1 = GOLD_TS.SEND, t2 = t1 + 40 * DAY, t3 = t2 + 10 * DAY, t4 = t3 + 5 * DAY;
      let spans = null, spans2 = null;
      if (SX) {
        rowsX = [tx(POOL, W, 100, t1), tx(W, POOL, 100, t2), tx(POOL, W, 50, t3)]; balX = 50n * 10n ** 18n;
        spans = (await SX(W, '0xsend', POOL, OG_LAUNCH.SEND)).heldSpans;
        // out to another wallet and back inside one moment: no gap
        rowsX = [tx(POOL, W, 100, t1), tx(W, OTHER, 100, t4), tx(OTHER, W, 100, t4)]; balX = 100n * 10n ** 18n;
        spans2 = (await SX(W, '0xsend', POOL, OG_LAUNCH.SEND)).heldSpans;
      }
      check('ogScan reports the stretches a wallet held more than dust: bought, sold out, bought back → two stretches, the last still open',
        JSON.stringify(spans) === JSON.stringify([[t1, t2], [t3, null]]), JSON.stringify(spans));
      check('  ...and coins that leave and come back within one moment are no gap (each moment judged by its last row)', JSON.stringify(spans2) === JSON.stringify([[t1, null]]), JSON.stringify(spans2));
    }
    /* (a) Gold sells all its $GWC, keeps $SEND bought before the beta ended → Silver */
    {
      SCANS.set('0xg1:SEND', sc('SEND', GOLD_TS.SEND)); SCANS.set('0xg2:GWC', sc('GWC', GOLD_TS.GWC));
      const id = user(['0xg1', '0xg2']);
      const t0 = await K.checkOg(id);
      check('(drop) the fixture: both coins in the Gold window → Gold', t0 === 3 && row(id).og_tier === 3 && claims(id) === '0xg1=3,0xg2=3', JSON.stringify({ t0, claims: claims(id) }));
      SCANS.set('0xg2:GWC', sc('GWC', GOLD_TS.GWC, 0));   // every $GWC sold
      delayMs = 20;
      const loss = K.ogAfterHolderRead(id, 1_000_000, 0), mid = row(id);
      check('a Gold that sells all its $GWC and keeps $SEND is NOT revoked: marked to be re-decided on $SEND alone (og_requal) and held to Silver (og_cap) — no tier guessed meanwhile',
        loss === 'drop' && mid.og_revoked === 0 && mid.og_requal === 1 && mid.og_cap === 2 && mid.og_tier === 3 && mid.og === 1, JSON.stringify(mid));
      check('  ...a second read that finds the same thing while it waits marks nothing again', K.ogAfterHolderRead(id, 1_000_000, 0) === 'drop' && row(id).og_requal === 1);
      await until(() => row(id).og_requal === 0);
      delayMs = 0;
      const r = row(id), note = lastNote(id);
      check('  ...and the $SEND history, read at once, makes it Silver: dated by the earliest $SEND buy, that wallet claimed at Silver, nothing left open, never revoked',
        r.og_tier === 2 && r.og === 1 && r.og_revoked === 0 && r.og_requal === 0 && r.og_cap === 2 && r.og_buy_ms === GOLD_TS.SEND && r.og_lift === 0 && /(^|,)0xg1=2(,|$)/.test(claims(id)), JSON.stringify({ r, claims: claims(id) }));
      check('  ...with the note "Your OG Gold is now OG Silver — you no longer hold $GWC, and Silver needs only $SEND…" (5×, Gold gone, $SEND to keep; never "buy")',
        /^Your OG Gold is now OG Silver — you no longer hold \$GWC, and Silver needs only \$SEND\. Your \$SEND, bought before the beta ended and still held \(checked on-chain\), keeps it: a 5× Send Power bonus on everything \(\+4×/.test(note)
        && /Gold doesn’t come back\. Keep holding \$SEND: sell out of it and OG goes for good\.$/.test(note) && !/\b(buy now|buy more|go buy|you should buy)\b/i.test(note), note);
      check('  ...a Silver now: the same read again changes nothing (it needs only $SEND)', K.ogAfterHolderRead(id, 1_000_000, 0) === null && row(id).og_tier === 2);
      /* Gold does not come back: $GWC bought back, every wallet disconnected and relinked — a fresh grant, held to Silver */
      SCANS.set('0xg2:GWC', sc('GWC', GOLD_TS.GWC));
      HOLDS.set(id + ':SEND', true); HOLDS.set(id + ':GWC', true);
      K.ogOnLeave(id, await K.ogLeaveVerdict(me(id)), true); unlink(id, '0xg1'); unlink(id, '0xg2');
      check('  ...disconnected (still holding $SEND): paused, not revoked, still held to Silver', row(id).og_tier === 0 && row(id).og_revoked === 0 && row(id).og_cap === 2);
      link(id, '0xg1'); link(id, '0xg2');
      const t2 = await K.checkOg(id);
      check('  ...relinked with $GWC bought back: Silver again, never Gold — $GWC is not even read (og_cap), and nothing is left open for Gold',
        t2 === 2 && row(id).og_tier === 2 && row(id).og_lift === 0 && row(id).og_revoked === 0, JSON.stringify({ t2, r: row(id) }));
    }
    /* a $GWC sell-off found by one holder sweep: the re-decisions run one at a time, not all at once against the explorer */
    {
      const ids = [1, 2, 3].map((i) => { SCANS.set('0xq' + i + ':SEND', sc('SEND', GOLD_TS.SEND)); const id = user(['0xq' + i]); mem.prepare('UPDATE users SET og = 1, og_tier = 3, og_diamond_at = ? WHERE id = ?').run(Date.now(), id); return id; });
      delayMs = 15; scanMax = 0;
      for (const id of ids) K.ogAfterHolderRead(id, 1_000_000, 0);
      await until(() => ids.every((id) => row(id).og_requal === 0));
      delayMs = 0;
      check('three Golds found without $GWC by one sweep: each re-decided to Silver, ONE walk of the explorer at a time (ogRequalSoon\'s queue)',
        ids.every((id) => row(id).og_tier === 2) && scanMax === 1, JSON.stringify({ tiers: ids.map((id) => row(id).og_tier), scanMax }));
    }
    /* (b) the same, with $SEND bought only in Bronze's window → Bronze */
    {
      SCANS.set('0xbr1:SEND', sc('SEND', BRONZE_TS));
      const id = user(['0xbr1']);
      mem.prepare('UPDATE users SET og = 1, og_tier = 3, og_buy_ms = ?, og_checked_at = ?, og_diamond_at = ? WHERE id = ?').run(GOLD_TS.GWC, Date.now(), Date.now(), id);
      const loss = K.ogAfterHolderRead(id, 1_000_000, 0);
      await until(() => row(id).og_requal === 0);
      const r = row(id), note = lastNote(id);
      check('a Gold whose linked wallets show $SEND bought only in Bronze\'s window, $GWC sold → Bronze, dated by that buy',
        loss === 'drop' && r.og_tier === 1 && r.og_revoked === 0 && r.og_buy_ms === BRONZE_TS && claims(id) === '0xbr1=1', JSON.stringify({ r, claims: claims(id) }));
      check('  ..."Your OG Gold is now OG Bronze — … Bronze needs only $SEND. Your $SEND, bought inside the bronze window…", 3×',
        /^Your OG Gold is now OG Bronze — you no longer hold \$GWC, and Bronze needs only \$SEND\. Your \$SEND, bought inside the bronze window and still held/.test(note) && /a 3× Send Power bonus/.test(note), note);
    }
    /* (c) Gold sells all its $SEND → revoked for good */
    {
      SCANS.set('0xc5:SEND', sc('SEND', GOLD_TS.SEND)); SCANS.set('0xc6:GWC', sc('GWC', GOLD_TS.GWC));
      const id = user(['0xc5', '0xc6']);
      await K.checkOg(id);
      const loss = K.ogAfterHolderRead(id, 0, 1_000_000), r = row(id);
      check('a Gold that sells all its $SEND (keeping $GWC) is revoked for good at once — nothing to re-decide',
        loss === 'revoke' && r.og_revoked === 1 && r.og_tier === 0 && r.og === 0 && r.og_requal === 0, JSON.stringify(r));
      check('  ...told so: "OG Gold removed — you sold out of $SEND, which Gold needs. Selling out of $SEND ends an OG badge for good…"', /^OG Gold removed — you sold out of \$SEND, which Gold needs\. Selling out of \$SEND ends an OG badge for good: it can’t be reclaimed\.$/.test(lastNote(id)), lastNote(id));
      check('  ...and never asked again', await K.checkOg(id) === 0 && row(id).og_revoked === 1);
      const id2 = user(['0xc7']);
      mem.prepare('UPDATE users SET og = 1, og_tier = 2 WHERE id = ?').run(id2);
      check('  ...a Silver that sells all its $SEND is revoked the same way; one that sells only $GWC keeps it', K.ogAfterHolderRead(id2, 5, 0) === null && row(id2).og_tier === 2
        && K.ogAfterHolderRead(id2, 0, 5) === 'revoke' && row(id2).og_revoked === 1);
    }
    /* (d) Diamond sells its $GWC → Silver */
    {
      const m = { monthBoughtWei: '5', monthSoldWei: '1' };
      SCANS.set('0xd5:SEND', sc('SEND', GOLD_TS.SEND, 1_000_000, m)); SCANS.set('0xd6:GWC', sc('GWC', GOLD_TS.GWC, 1_000_000, m));
      const id = user(['0xd5', '0xd6']);
      const t0 = await K.checkOg(id);
      SCANS.set('0xd6:GWC', sc('GWC', GOLD_TS.GWC, 0, m));
      const loss = K.ogAfterHolderRead(id, 1_000_000, 0);
      await until(() => row(id).og_requal === 0);
      check('a Diamond that sells all its $GWC and keeps $SEND → Silver, not revoked; "Your OG Diamond is now OG Silver…"',
        t0 === 4 && loss === 'drop' && row(id).og_tier === 2 && row(id).og_revoked === 0 && /^Your OG Diamond is now OG Silver — /.test(lastNote(id)) && /Diamond doesn’t come back/.test(lastNote(id)), JSON.stringify({ t0, r: row(id), note: lastNote(id) }));
    }
    /* a Gold being asked the Diamond question when its $GWC is found sold: the upgrade does not land on it */
    {
      const m = { monthBoughtWei: '5', monthSoldWei: '1' };
      SCANS.set('0xdq1:SEND', sc('SEND', GOLD_TS.SEND, 1_000_000, m)); SCANS.set('0xdq2:GWC', sc('GWC', GOLD_TS.GWC, 1_000_000, m));
      const id = user(['0xdq1', '0xdq2']);
      mem.prepare('UPDATE users SET og = 1, og_tier = 3, og_buy_ms = ?, og_diamond_at = NULL WHERE id = ?').run(GOLD_TS.GWC, id);
      delayMs = 20;
      const asking = K.checkOg(id);
      await new Promise((ok) => setTimeout(ok, 5));
      mem.prepare('UPDATE users SET og_requal = 1, og_cap = 2 WHERE id = ?').run(id);   // refreshHolder found its $GWC sold meanwhile
      await asking;
      delayMs = 0;
      const mid = row(id);
      const t = await K.checkOg(id);
      check('a Gold whose $GWC is found sold while it is being asked the Diamond question is never made Diamond: it is re-decided on $SEND alone (Silver)',
        mid.og_tier === 3 && mid.og_requal === 1 && t === 2 && row(id).og_tier === 2, JSON.stringify({ mid, t, r: row(id) }));
    }
    /* (e) a read that fails is never an answer */
    {
      SCANS.set('0xe5:SEND', 'fail');
      const id = user(['0xe5']);
      mem.prepare('UPDATE users SET og = 1, og_tier = 3, og_buy_ms = ?, og_diamond_at = ? WHERE id = ?').run(GOLD_TS.GWC, Date.now(), id);
      const before = noteCount(id);
      K.ogAfterHolderRead(id, 1_000_000, 0);
      await until(() => row(id).og_try_at > 0);
      await settle();
      const r = row(id);
      check('a $SEND history that cannot be read is no answer: still Gold on the record, still waiting (paid nothing), never revoked, no note',
        r.og_tier === 3 && r.og_requal === 1 && r.og_revoked === 0 && noteCount(id) === before, JSON.stringify(r));
      // the sweep's own re-decision query, run as written: it picks this one up once its hour is up
      const q = /const requal = db\.prepare\(`(SELECT u\.id FROM users u WHERE u\.og_requal = 1[\s\S]*?)`\)\.all\(/.exec(SRC);
      mem.prepare('UPDATE users SET og_try_at = ? WHERE id = ?').run(Date.now() - 2 * 3600e3, id);
      const picked = q ? mem.prepare(q[1]).all(Date.now() - 3600e3, 10).map((x) => x.id) : [];
      check('  ...and the grant sweep\'s re-decision query, run as written, asks it again within the hour', picked.includes(id), q ? JSON.stringify(picked) : 'query not found');
      SCANS.set('0xe5:SEND', sc('SEND', GOLD_TS.SEND));
      const t = await K.checkOg(id);
      check('  ...once the read completes: Silver', t === 2 && row(id).og_tier === 2 && row(id).og_requal === 0, JSON.stringify({ t, r: row(id) }));
      // a Bronze answer with another $SEND wallet unread waits (that wallet may hold a Silver buy)
      SCANS.set('0xe6:SEND', sc('SEND', BRONZE_TS)); SCANS.set('0xe7:SEND', 'fail');
      const id2 = user(['0xe6', '0xe7']);
      mem.prepare('UPDATE users SET og = 1, og_tier = 3, og_requal = 1, og_cap = 2 WHERE id = ?').run(id2);
      const t2 = await K.checkOg(id2);
      check('  ...a Bronze answer with a $SEND wallet unread is no answer either: still waiting', t2 === 0 && row(id2).og_tier === 3 && row(id2).og_requal === 1 && row(id2).og_revoked === 0, JSON.stringify(row(id2)));
      // the disconnect / unlink read failing: no verdict, nothing written but the pause
      HOLDS.set(id2 + ':SEND', 'fail'); HOLDS.set(id2 + ':GWC', false);
      check('  ...and a disconnect or unlink whose holdings read fails gives no verdict (keep — never a revocation)', await K.ogLeaveVerdict(me(id2)) === null);
    }
    /* (f) nothing earned on $SEND alone → revoked, as before */
    {
      SCANS.set('0xf5:SEND', sc('SEND', AFTER_TS));
      const id = user(['0xf5']);
      mem.prepare('UPDATE users SET og = 1, og_tier = 3, og_requal = 1, og_cap = 2 WHERE id = ?').run(id);
      const t = await K.checkOg(id);
      check('$GWC sold and the only $SEND buy came after Bronze closed: nothing earned on $SEND alone → revoked for good, and told why',
        t === 0 && row(id).og_revoked === 1 && row(id).og_tier === 0 && row(id).og_requal === 0
        && /^OG Gold removed — you no longer hold \$GWC, which Gold needs, and on \$SEND alone none of your linked wallets shows a \$SEND buy that earns Silver or Bronze/.test(lastNote(id)), JSON.stringify({ t, r: row(id), note: lastNote(id) }));
      SCANS.set('0xf6:SEND', sc('SEND', GOLD_TS.SEND, 0));
      const id2 = user(['0xf6']);
      mem.prepare('UPDATE users SET og = 1, og_tier = 3, og_requal = 1, og_cap = 2 WHERE id = ?').run(id2);
      await K.checkOg(id2);
      check('  ...and no $SEND left by the time it is read: revoked — sold out of both', row(id2).og_revoked === 1 && /^OG Gold removed — you sold out of both \$SEND and \$GWC\./.test(lastNote(id2)), lastNote(id2));
    }
    /* (g) the unlink and disconnect paths */
    {
      SCANS.set('0xu1:SEND', sc('SEND', GOLD_TS.SEND)); SCANS.set('0xu2:GWC', sc('GWC', GOLD_TS.GWC)); SCANS.set('0xu3:SEND', sc('SEND', SILVER_TS));
      const id = user(['0xu1', '0xu2', '0xu3']);
      await K.checkOg(id);
      SCANS.set('0xu2:GWC', sc('GWC', GOLD_TS.GWC, 0));
      HOLDS.set(id + ':SEND', true); HOLDS.set(id + ':GWC', false);
      const v = await K.ogLeaveVerdict(me(id));   // read while every wallet is still linked
      unlink(id, '0xu2'); K.ogOnLeave(id, v, false);
      const mid = row(id);
      check('(unlink) a Gold with no $GWC left unlinks its emptied $GWC wallet: a drop, not a revocation — re-decided on the wallets that stay',
        v === 'drop' && mid.og_revoked === 0 && mid.og_requal === 1 && mid.og_cap === 2 && mid.og_tier === 3, JSON.stringify({ v, mid }));
      const t = await K.checkOg(id);
      check('  ...the check run after the unlink makes it Silver, from the $SEND wallet that bought before the beta ended', t === 2 && row(id).og_tier === 2 && row(id).og_buy_ms === GOLD_TS.SEND && /^Your OG Gold is now OG Silver/.test(lastNote(id)), JSON.stringify({ t, r: row(id) }));
      // the last wallet: paused and held to Silver, not revoked
      SCANS.set('0xu5:SEND', sc('SEND', GOLD_TS.SEND)); SCANS.set('0xu5:GWC', sc('GWC', GOLD_TS.GWC));
      const id2 = user(['0xu5']);
      await K.checkOg(id2);
      HOLDS.set(id2 + ':SEND', true); HOLDS.set(id2 + ':GWC', false);
      const v2 = await K.ogLeaveVerdict(me(id2));
      unlink(id2, '0xu5'); K.ogOnLeave(id2, v2, true);
      check('  ...unlinking the last wallet: paused (no wallet to read), held to Silver, never revoked while $SEND is held', v2 === 'drop' && row(id2).og_tier === 0 && row(id2).og === 0 && row(id2).og_cap === 2 && row(id2).og_revoked === 0 && row(id2).og_requal === 0, JSON.stringify(row(id2)));
      link(id2, '0xu5');
      check('  ...relinked (its $GWC bought back meanwhile): Silver, never Gold again', await K.checkOg(id2) === 2 && row(id2).og_tier === 2);
      // $SEND gone: the unlink revokes
      SCANS.set('0xu7:SEND', sc('SEND', GOLD_TS.SEND)); SCANS.set('0xu8:GWC', sc('GWC', GOLD_TS.GWC));
      const id3 = user(['0xu7', '0xu8']);
      await K.checkOg(id3);
      HOLDS.set(id3 + ':SEND', false); HOLDS.set(id3 + ':GWC', true);
      const v3 = await K.ogLeaveVerdict(me(id3));
      unlink(id3, '0xu7'); K.ogOnLeave(id3, v3, false);
      check('  ...a Gold that sold out of $SEND and then unlinks is revoked for good, as before', v3 === 'revoke' && row(id3).og_revoked === 1 && row(id3).og_tier === 0, JSON.stringify({ v3, r: row(id3) }));
      // the full disconnect: every wallet goes
      SCANS.set('0xu9:SEND', sc('SEND', GOLD_TS.SEND)); SCANS.set('0xua:GWC', sc('GWC', GOLD_TS.GWC));
      const id4 = user(['0xu9', '0xua']);
      await K.checkOg(id4);
      mem.prepare('UPDATE users SET og_requal = 1, og_cap = 2 WHERE id = ?').run(id4);   // its $GWC was found sold a moment ago
      HOLDS.set(id4 + ':SEND', true); HOLDS.set(id4 + ':GWC', false);
      const v4 = await K.ogLeaveVerdict(me(id4));
      K.ogOnLeave(id4, v4, true); unlink(id4, '0xu9'); unlink(id4, '0xua');
      check('(disconnect) a Gold with no $GWC that disconnects every wallet: paused and held to Silver, not revoked — and no longer waiting on a read it has no wallet for',
        v4 === 'drop' && row(id4).og_tier === 0 && row(id4).og_revoked === 0 && row(id4).og_cap === 2 && row(id4).og_requal === 0, JSON.stringify(row(id4)));
      const id5 = user(['0xub']);
      mem.prepare('UPDATE users SET og = 1, og_tier = 3 WHERE id = ?').run(id5);
      HOLDS.set(id5 + ':SEND', true); HOLDS.set(id5 + ':GWC', true);
      const v5 = await K.ogLeaveVerdict(me(id5));
      K.ogOnLeave(id5, v5, true);
      check('  ...one still holding both is only paused, as before (never capped)', v5 === null && row(id5).og_tier === 0 && row(id5).og_revoked === 0 && row(id5).og_cap === 0);
      HOLDS.set(id5 + ':SEND', 'fail');
      mem.prepare('UPDATE users SET og = 1, og_tier = 3 WHERE id = ?').run(id5);
      K.ogOnLeave(id5, await K.ogLeaveVerdict(me(id5)), true);
      check('  ...and one whose read fails is only paused (a failed read is never a revocation, nor a cap)', row(id5).og_revoked === 0 && row(id5).og_cap === 0 && row(id5).og_tier === 0);
    }
    /* (h) the restore pass: a badge revoked before the rule, re-checked once */
    {
      const T0 = GOLD_TS.GWC + 10 * DAY;   // when the badge was last checked (it was held then)
      const revoked = (wallets, at = T0) => { const id = user(wallets); mem.prepare('UPDATE users SET og = 0, og_tier = 0, og_revoked = 1, og_recheck = 1, og_checked_at = ?, og_buy_ms = ? WHERE id = ?').run(at, GOLD_TS.GWC, id); return id; };
      SCANS.set('0xr1:SEND', sc('SEND', GOLD_TS.SEND, 1_000_000, { heldSpans: [[GOLD_TS.SEND, null]] }));
      const id = revoked(['0xr1']);
      check('(restore) a revoked badge is not re-checked by an ordinary check — only by the restore pass', await K.checkOg(id) === 0 && row(id).og_revoked === 1 && row(id).og_recheck === 1);
      const t = await K.checkOg(id, { restore: true }), r = row(id), note = lastNote(id);
      check('revoked, still holds $SEND (held without a break since its last check, $1,000 of it), bought before the beta ended → Silver restored, held to Silver, its $SEND wallet claimed, dated by that buy',
        t === 2 && r.og === 1 && r.og_tier === 2 && r.og_revoked === 0 && r.og_recheck === 3 && r.og_cap === 2 && r.og_buy_ms === GOLD_TS.SEND && claims(id) === '0xr1=2', JSON.stringify({ t, r, claims: claims(id) }));
      check('  ...with a notification: "OG Silver restored! …" — honest about why, never "buy"',
        /^OG Silver restored! Your badge was removed while OG still needed both \$SEND and \$GWC to keep\. Since the beta ended, Silver needs only \$SEND, and your linked wallets show \$SEND bought before the beta ended, held without a break since your badge was last checked, and worth \$100 or more today \(checked on-chain\)/.test(note)
        && /Keep holding \$SEND: sell out of it and it goes for good\.$/.test(note) && !/\b(buy now|buy more|go buy|you should buy)\b/i.test(note), note);
      const n0 = noteCount(id);
      check('  ...and it runs once: asked again, nothing changes and nothing more is said', await K.checkOg(id, { restore: true }) === 2 && row(id).og_recheck === 3 && noteCount(id) === n0);
      SCANS.set('0xr2:SEND', sc('SEND', GOLD_TS.SEND, 0, { heldSpans: [[GOLD_TS.SEND, T0 + DAY]] }));
      const id2 = revoked(['0xr2']);
      const t2 = await K.checkOg(id2, { restore: true });
      check('revoked, and its $SEND is gone → stays revoked, marked re-checked (2), no note', t2 === 0 && row(id2).og_revoked === 1 && row(id2).og_recheck === 2 && noteCount(id2) === 0, JSON.stringify(row(id2)));
      check('  ...and is never asked again', await K.checkOg(id2, { restore: true }) === 0 && row(id2).og_recheck === 2);
      SCANS.set('0xr3:SEND', sc('SEND', GOLD_TS.SEND, 1_000_000, { heldSpans: [[GOLD_TS.SEND, T0 + DAY], [T0 + 5 * DAY, null]] }));
      const id3 = revoked(['0xr3']);
      await K.checkOg(id3, { restore: true });
      check('revoked, holds $SEND today but sold out of it after its last check and bought back → stays revoked (nobody who sold out of $SEND is restored)', row(id3).og_revoked === 1 && row(id3).og_recheck === 2, JSON.stringify(row(id3)));
      SCANS.set('0xr4:SEND', sc('SEND', GOLD_TS.SEND, 0, { heldSpans: [[GOLD_TS.SEND, T0 + DAY]] }));
      SCANS.set('0xr5:SEND', { tier: 0, firstBuyMs: null, holds: true, balWei: (10n ** 24n).toString(), dumped: false, notAccumulator: false, monthBoughtWei: '0', monthSoldWei: '0', heldSpans: [[T0 + DAY, null]] });
      const id4 = revoked(['0xr4', '0xr5']);
      await K.checkOg(id4, { restore: true });
      check('revoked, its $SEND moved from one linked wallet to another (no moment without it) → restored, the buying wallet claimed', row(id4).og_tier === 2 && row(id4).og_revoked === 0 && claims(id4) === '0xr4=2', JSON.stringify({ r: row(id4), claims: claims(id4) }));
      SCANS.set('0xr6:SEND', sc('SEND', GOLD_TS.SEND, 1_000_000, { heldSpans: [[GOLD_TS.SEND, null]] }));
      mem.prepare('INSERT INTO og_claims (addr_idx, user_id, tier, claimed_at) VALUES (?,?,?,?)').run('idx:0xr6', 9997, 2, Date.now());
      const id5 = revoked(['0xr6']);
      await K.checkOg(id5, { restore: true });
      check('revoked, its only $SEND wallet\'s badge is claimed by another account → stays revoked, and that claim is untouched',
        row(id5).og_revoked === 1 && row(id5).og_recheck === 2 && mem.prepare('SELECT user_id FROM og_claims WHERE addr_idx = ?').get('idx:0xr6').user_id === 9997, JSON.stringify(row(id5)));
      SCANS.set('0xr7:SEND', sc('SEND', GOLD_TS.SEND, 50_000, { heldSpans: [[GOLD_TS.SEND, null]] }));   // $50
      const id6 = revoked(['0xr7']);
      await K.checkOg(id6, { restore: true });
      check('revoked, still holding $SEND but $50 of it today (under the $100 floor) → stays revoked', row(id6).og_revoked === 1 && row(id6).og_recheck === 2, JSON.stringify(row(id6)));
      SCANS.set('0xr8:SEND', sc('SEND', BRONZE_TS, 1_000_000, { heldSpans: [[BRONZE_TS, null]] }));
      const id7 = revoked(['0xr8'], BRONZE_TS + 10 * DAY);
      await K.checkOg(id7, { restore: true });
      check('revoked, its $SEND bought in Bronze\'s window and held → Bronze restored, "OG Bronze restored!"', row(id7).og_tier === 1 && row(id7).og_revoked === 0 && /^OG Bronze restored! /.test(lastNote(id7)), JSON.stringify({ r: row(id7), note: lastNote(id7) }));
      SCANS.set('0xr9:SEND', sc('SEND', BRONZE_TS, 1_000_000, { heldSpans: [[BRONZE_TS, null]] })); SCANS.set('0xra:SEND', 'fail');
      const id8 = revoked(['0xr9', '0xra'], BRONZE_TS + 10 * DAY);
      await K.checkOg(id8, { restore: true });
      check('a Bronze answer with a $SEND wallet unread decides nothing: still revoked, still to be re-checked (1)', row(id8).og_revoked === 1 && row(id8).og_recheck === 1, JSON.stringify(row(id8)));
      SCANS.set('0xrb:SEND', sc('SEND', GOLD_TS.SEND, 1_000_000, { heldSpans: [[GOLD_TS.SEND, null]] })); SCANS.set('0xrc:SEND', 'fail');
      const id9 = revoked(['0xrb', '0xrc']);
      await K.checkOg(id9, { restore: true });
      check('  ...but a Silver held without a break is decided with one unread (nothing that wallet holds could lower it or open a gap)', row(id9).og_tier === 2 && row(id9).og_revoked === 0, JSON.stringify(row(id9)));
      SCANS.set('0xrd:SEND', sc('SEND', GOLD_TS.SEND, 1_000_000, { heldSpans: [[GOLD_TS.SEND, null]] }));
      const idA = revoked(['0xrd']);
      PX.SEND = null;
      await K.checkOg(idA, { restore: true });
      PX.SEND = 0.001;
      check('no $SEND price decides nothing: still to be re-checked', row(idA).og_revoked === 1 && row(idA).og_recheck === 1, JSON.stringify(row(idA)));
      const idB = revoked(['0xrd']);
      mem.prepare('UPDATE users SET og_recheck = 0 WHERE id = ?').run(idB);
      check('a badge revoked under the new rule (not a candidate, og_recheck 0) is never restored, even when the pass asks', await K.checkOg(idB, { restore: true }) === 0 && row(idB).og_revoked === 1);
      // the pass's own query, run as written: candidates with a wallet only — never deleted, the site's own, wallet-less or already re-checked
      const q = /const back = db\.prepare\(`(SELECT u\.id FROM users u WHERE u\.og_recheck = 1[\s\S]*?)`\)\.all\(/.exec(SRC);
      const cand = revoked(['0xre']), del = revoked(['0xrf']), sys = revoked(['0xrg']), bare = revoked([]);
      mem.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(Date.now(), del);
      mem.prepare('UPDATE users SET system = 1 WHERE id = ?').run(sys);
      const picked = q ? mem.prepare(q[1]).all(Date.now() - 3600e3, 1000).map((x) => x.id) : [];
      check('the restore pass\'s query, run as written: a candidate with a wallet; never a deleted account, the site\'s own, one with no wallet, or one already re-checked',
        picked.includes(cand) && !picked.includes(del) && !picked.includes(sys) && !picked.includes(bare) && !picked.includes(id) && !picked.includes(id2), q ? JSON.stringify(picked) : 'query not found');
      check('  ...and checkOg itself refuses a deleted or system account even when asked', await K.checkOg(del, { restore: true }) === 0 && await K.checkOg(sys, { restore: true }) === 0 && row(del).og_recheck === 1 && row(sys).og_recheck === 1);
      // a restored badge is an ordinary Silver: selling out of $SEND ends it
      check('a restored Silver that later sells out of $SEND is revoked for good like any other', K.ogAfterHolderRead(id, 0, 0) === 'revoke' && row(id).og_revoked === 1 && row(id).og_recheck === 3);
    }
    mem.close();
  }

  /* ═══ 10. the Arcade's OG card knows a revoked account ═══ */
  {
    const r = mkUser('__ogs_rv_' + hex(3)), k = mkUser('__ogs_ok_' + hex(3));
    db.prepare('UPDATE users SET og = 0, og_tier = 0, og_revoked = 1 WHERE id = ?').run(r.id);
    const a = await api('/api/competitions', r.sid), b = await api('/api/competitions', k.sid);
    check('/api/competitions tells a revoked member\'s OG card so (og.mine.revoked), and an ordinary one not', a.status === 200 && a.j.og && a.j.og.mine && a.j.og.mine.revoked === true && b.j.og.mine.revoked === false, JSON.stringify([a.j && a.j.og && a.j.og.mine, b.j && b.j.og && b.j.og.mine]));
  }

  /* ═══ 12. the drop and the restore, through the API ═══ */
  {
    const u = mkUser('__ogs_rq_' + hex(3));
    db.prepare('UPDATE users SET og = 1, og_tier = 3, og_requal = 1, og_cap = 2, og_buy_ms = ? WHERE id = ?').run(GOLD_TS.GWC, u.id);
    db.prepare('INSERT INTO holder_state (user_id, send_tok, gwc_tok, last_check) VALUES (?,?,?,?)').run(u.id, 5_000_000, 20_000_000, Date.now());
    const a = await api('/api/me', u.sid);
    check('a Gold waiting to be re-decided on $SEND alone is paid NO OG bonus — not Gold\'s 10×, even with $GWC read back in its wallets', a.j && a.j.user && a.j.user.boost && a.j.user.boost.og === 1, JSON.stringify(a.j && a.j.user && a.j.user.boost));
    db.prepare('UPDATE holder_state SET gwc_tok = 0 WHERE user_id = ?').run(u.id);
    const b = await api('/api/me', u.sid);
    check('  ...nor a guessed Silver 5× while its $GWC reads empty', b.j && b.j.user && b.j.user.boost && b.j.user.boost.og === 1, JSON.stringify(b.j && b.j.user && b.j.user.boost));
    const g = await api('/api/gamify/me', u.sid);
    check('  ...and the dashboard is told it is waiting (ogRequal), so it says so', g.j && g.j.ogRequal === true && g.j.ogTier === 3, JSON.stringify(g.j && { ogRequal: g.j.ogRequal, ogTier: g.j.ogTier }));
    const e = await api('/api/data/eligibility', u.sid);
    db.prepare('UPDATE users SET og_requal = 0 WHERE id = ?').run(u.id);
    const e2 = await api('/api/data/eligibility', u.sid);
    check('  ...nor Gold\'s free Data API key while it waits (Gold is gone from the moment its $GWC is found sold); a Gold still holding both is offered it',
      e.status === 200 && e.j && e.j.free === false && e.j.tier === 0 && e2.j && e2.j.free === true && e2.j.tier === 3, JSON.stringify([e.j && { free: e.j.free, tier: e.j.tier }, e2.j && { free: e2.j.free, tier: e2.j.tier }]));
    check('  ...and a free Gold key already minted stops answering while it waits', /if \(row\.source === 'og_gold' && !\(row\.og && row\.og_tier >= OG_TIER\.GOLD && !row\.og_requal\)/.test(SRC) && /u\.og, u\.og_tier, u\.og_requal FROM api_keys k JOIN users u/.test(SRC));
    db.prepare('UPDATE users SET og_requal = 0, og_tier = 2 WHERE id = ?').run(u.id);
    const c = await api('/api/me', u.sid);
    check('  ...once decided Silver, it is paid Silver\'s 5× on $SEND alone', c.j && c.j.user && c.j.user.boost && c.j.user.boost.og === 5, JSON.stringify(c.j && c.j.user && c.j.user.boost));
    const r = mkUser('__ogs_rs_' + hex(3)), k = mkUser('__ogs_rk_' + hex(3));
    db.prepare('UPDATE users SET og = 0, og_tier = 0, og_revoked = 1, og_recheck = 1 WHERE id = ?').run(r.id);
    db.prepare('UPDATE users SET og = 0, og_tier = 0, og_revoked = 1, og_recheck = 2 WHERE id = ?').run(k.id);
    const gr = await api('/api/gamify/me', r.sid), gk = await api('/api/gamify/me', k.sid);
    check('a badge revoked before the rule and not yet re-checked: the dashboard is told (ogRestorePending); one already re-checked is not', gr.j && gr.j.ogRestorePending === true && gr.j.ogRevoked === true && gk.j && gk.j.ogRestorePending === false,
      JSON.stringify([gr.j && gr.j.ogRestorePending, gk.j && gk.j.ogRestorePending]));
    const cr = await api('/api/competitions', r.sid), ck = await api('/api/competitions', k.sid);
    check('  ...and so is the Arcade\'s OG card (og.mine.recheck)', cr.j && cr.j.og && cr.j.og.mine && cr.j.og.mine.recheck === true && ck.j && ck.j.og.mine.recheck === false && ck.j.og.mine.revoked === true,
      JSON.stringify([cr.j && cr.j.og && cr.j.og.mine, ck.j && ck.j.og && ck.j.og.mine]));
    // the boot migration itself, run as written on a database from before the rule: once, and never again on a later boot
    const bootM = /\n(try \{ db\.exec\('ALTER TABLE users ADD COLUMN og_recheck[^\n]*)\n/.exec(SRC);
    let marks = null;
    if (bootM) {
      const m2 = new DatabaseSync(':memory:');
      m2.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, og_revoked INTEGER NOT NULL DEFAULT 0)');
      m2.prepare('INSERT INTO users (id, og_revoked) VALUES (1, 1), (2, 0)').run();
      new Function('db', bootM[1])(m2);                                         // the boot that brings the rule
      m2.prepare('INSERT INTO users (id, og_revoked) VALUES (3, 1)').run();     // revoked afterwards, under the new rule
      new Function('db', bootM[1])(m2);                                         // any later boot
      marks = m2.prepare('SELECT id, og_recheck FROM users ORDER BY id').all().map((x) => x.id + '=' + x.og_recheck).join(',');
      m2.close();
    }
    check('the restore pass\'s candidates are every badge already revoked as the rule arrives — marked only on the boot that adds the column (a badge revoked after it never is)',
      marks === '1=1,2=0,3=0', marks);
    check('  ...paced on its own, one a tick, by the grant sweep (which asks a waiting re-decision first, at any date), and counted in the log',
      /const OG_RESTORE_SWEEP_CAP = 1;/.test(SRC) && /for \(const r of back\) \{ try \{ await checkOg\(r\.id, \{ restore: true \}\); \} catch \{\} \}\n\s+if \(back\.length\) ogRestoreLog\(\);/.test(SRC)
      && /for \(const r of requal\) \{ try \{ await checkOg\(r\.id\); \} catch \{\} \}\n\s+if \(now\(\) <= OG_GRANT_UNTIL_MS\) await ogGrantTick\(OG_GRANT_SWEEP_CAP - requal\.length\);/.test(SRC));
    check('effectiveMult pays no OG bonus while a re-decision waits', /if \(tier > 0 && !row\.og_requal\) \{/.test(SRC) && /SELECT og, og_tier, og_requal, live_comm_count, beta_rank FROM users WHERE id = \?/.test(SRC));
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
