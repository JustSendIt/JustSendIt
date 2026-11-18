/* 💎 OG Diamond: bought both coins in the first month of $GWC and a net buyer of both that month → 20×.
   The decision is checked on fixed inputs (the pure function the grant uses), the payout through the real API
   with DB-minted fixtures, and the copy on every page that explains OG. Everything made here is deleted. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH, ROOT, SERVER_JS } from './_paths.mjs';
import { makeFakeBought } from './_ogfake.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');   // the server writes meanwhile: wait a moment, never fail with "database is locked"
const SRC = readFileSync(SERVER_JS, 'utf8');
const pub = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const hex = (n) => randomBytes(n).toString('hex');
const made = [];
function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + hex(6);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}
async function api(p, sid) {
  const r = await fetch(BASE + p, { headers: { Origin: BASE, ...(sid ? { Cookie: 'sid=' + sid } : {}) } });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}

try {
  /* ═══ 1. the rule, as constants ═══ */
  check('Diamond is tier 4, named Diamond, paying 20×', /const OG_TIER = \{ DIAMOND: 4, GOLD: 3/.test(SRC) && /const OG_DIAMOND_MULT = 20;/.test(SRC)
    && /const OG_TIER_MULT = \{ 4: OG_DIAMOND_MULT, 3: OG_BONUS/.test(SRC) && /const OG_TIER_NAME = \{ 4: 'Diamond', 3: 'Gold'/.test(SRC));
  check('  ...its window is the first month (30 days) of $GWC', /const OG_DIAMOND_START = OG_LAUNCH\.GWC;/.test(SRC) && /const OG_DIAMOND_END = OG_LAUNCH\.GWC \+ OG_MONTH_MS;/.test(SRC) && /const OG_WINDOW_MS = 30 \* 24 \* 3600 \* 1000;/.test(SRC));
  check('  ...the scan counts market buys and sells inside that month, per wallet', /if \(buyAmt > 0n && inMonth\(ts\)\) monthBoughtWei \+= buyAmt;/.test(SRC) && /if \(sellAmt > 0n && inMonth\(ts\)\) monthSoldWei \+= sellAmt;/.test(SRC)
    && /const buyAmt = to === w \? \(isAcquisition\(from\) \? v : routed\.take\(r, 'out', v\)\) : 0n;/.test(SRC));   // a routed buy counts too, capped at what the pool sent
  /* since "$100 bought" (2026-11-17) the month is the member's verdict for the whole wallet set (lib/acquire.js: counted buys in, own
     sales out, a traced piece only from an origin that was itself a net buyer that month); a wallet whose badge is spent on another
     account adds no buys (the verdicts' claims) — section 5 */
  check('  ...decided across EVERY linked wallet by the verdicts: the month\'s flows read only where the verdict answered yes', /f\.month\[c\.key\] = s\.diamondMonth === true \? \{ in: BigInt\(s\.monthIn \|\| '0'\), out: BigInt\(s\.monthOut \|\| '0'\) \} : \{ in: 0n, out: 0n \};/.test(SRC)
    && /const diamondOk = ogDiamondOk\(!scanFailed, best, holdsAny, facts\.month\);/.test(SRC));
  check('Diamond keeps every Gold perk (a free data key)', /const DATA_TIER_DISCOUNT = \{ 4: 1, 3: 1,/.test(SRC) && /row\.og_tier >= OG_TIER\.GOLD/.test(SRC));
  // the sweep also asks a Silver left open to be lifted since 2026-11-17 (og_lift; tests/ogsilver.mjs) — the Gold clause is unchanged.
  // "Once" is once per WALLET SET since Diamond-on-link (owner, 2026-11-17): linking a wallet re-opens the question at once (ogOnLink,
  // before linkWalletTo awaits anything) and the link's checkOg asks it — run on a stubbed chain in section 5
  check('a live Gold account is asked the Diamond question by the sweep once per wallet set: a link re-opens it', /WHERE \(u\.og_tier = 0 OR \(u\.og_tier = 3 AND u\.og_diamond_at IS NULL\) OR \(u\.og_tier = 2 AND u\.og_lift = 1\)\) AND u\.og_revoked = 0/.test(SRC)
    && /const upgrading = !requal && u\.og_tier === OG_TIER\.GOLD && !u\.og_diamond_at;/.test(SRC)   // a Gold whose $GWC was found sold is re-decided on $SEND alone first (og_requal)
    && /\nasync function linkWalletTo\(me, address, how\) \{\n  insertIdentity\(me\.id, 'wallet', address\);\n  ogOnLink\(me\.id\);/.test(SRC)
    && /db\.prepare\('UPDATE users SET og_diamond_at = NULL WHERE id = \? AND og = 1 AND og_tier = \? AND og_revoked = 0 AND og_requal = 0'\)\.run\(userId, OG_TIER\.GOLD\);/.test(SRC)
    && /checkOg\(me\.id, \{ link: true \}\)\.catch/.test(SRC));
  // the floor is each coin SUMMED over every linked wallet (2026-11-17) — it used to value only the one wallet that earned the tier
  check('  ...an upgrade needs the same $100 of each BOUGHT a grant does, across the wallets, and a verdict not complete is never an answer', /if \(scanFailed \|\| facts\.diamondUndecided\) return OG_TIER\.GOLD;/.test(SRC)
    && /return await grantDiamondUpgrade\(userId, best, held, \{ same, monthFrom, floor \}\);/.test(SRC)
    && /if \(!\(floor\.SEND === true && floor\.GWC === true\)\) \{/.test(SRC) && !/best\.(SEND|GWC)\.balWei/.test(SRC));
  /* revocation is by tier since 2026-11-17, and since the owner's "Drop to Silver" the same day a sell-out of $SEND ends Diamond
     (and Gold) for good while a sell-out of $GWC alone drops them to what $SEND alone earns (tests/ogsilver.mjs runs both) */
  check('Diamond (and Gold) need both coins; selling out of $SEND loses them for good, selling out of $GWC alone drops them (ogLoss)', /const OG_TIER_NEEDS = \{ 4: \['SEND', 'GWC'\], 3: \['SEND', 'GWC'\],/.test(SRC)
    && /if \(sendTok <= OG_DUST \|\| gwcTok <= OG_DUST\) ogAfterHolderRead\(userId, sendTok, gwcTok\);/.test(SRC)
    && /const loss = ogLoss\(gone\);\n\s+if \(loss === 'revoke'\) \{\n\s+db\.prepare\('UPDATE users SET og = 0, og_tier = 0, og_revoked = 1, og_requal = 0, og_lift = 0, og_paused_tier = 0, og_paused_at = 0 WHERE id = \?'\)/.test(SRC)
    && /return gone\.includes\('SEND'\) \? 'revoke' : 'drop';/.test(SRC));

  /* ═══ 2. the decision, on fixed inputs ═══ */
  const m = /\nfunction ogDiamondOk\(complete, best, holdsAny, month\) \{[\s\S]*?\n\}\n/.exec(SRC);
  check('the Diamond decision is one pure function', !!m);
  const ok = m ? new Function('OG_TIER', 'return ' + m[0].trim())({ DIAMOND: 4, GOLD: 3, SILVER: 2, BRONZE: 1, NONE: 0 }) : () => null;
  const gold = { SEND: { tier: 3 }, GWC: { tier: 3 } }, both = { SEND: true, GWC: true };
  const flows = (si, so, gi, go) => ({ SEND: { in: si, out: so }, GWC: { in: gi, out: go } });
  check('bought both in the month and bought more than sold of each → Diamond', ok(true, gold, both, flows(100n, 40n, 50n, 0n)) === true);
  check('sold more $GWC than bought that month → not Diamond', ok(true, gold, both, flows(100n, 40n, 50n, 60n)) === false);
  check('sold exactly what was bought → not a net accumulator', ok(true, gold, both, flows(100n, 100n, 50n, 0n)) === false);
  check('bought only one coin in the month → not Diamond', ok(true, gold, both, flows(100n, 0n, 0n, 0n)) === false);
  check('no longer holds one coin → not Diamond', ok(true, gold, { SEND: true, GWC: false }, flows(100n, 0n, 50n, 0n)) === false);
  check('a silver or bronze buyer cannot be Diamond', ok(true, { SEND: { tier: 3 }, GWC: { tier: 2 } }, both, flows(100n, 0n, 50n, 0n)) === false);
  check('an incomplete read is never Diamond (a wallet not read could hold the sells)', ok(false, gold, both, flows(100n, 0n, 50n, 0n)) === false);

  /* ═══ 3. the payout and the badge, through the API ═══ */
  const d = mkUser('__dog_' + hex(3));
  db.prepare('UPDATE users SET og = 1, og_tier = 4, og_diamond_at = ? WHERE id = ?').run(Date.now(), d.id);
  db.prepare('INSERT INTO holder_state (user_id, send_tok, gwc_tok, last_check) VALUES (?,?,?,?)').run(d.id, 5_000_000, 20_000_000, Date.now());
  const me = await api('/api/me', d.sid);
  check('/api/me reports tier 4', me.j && me.j.user && me.j.user.og === 4, me.j && me.j.user && me.j.user.og);
  check('  ...and the OG part of the boost is 20×', me.j && me.j.user && me.j.user.boost && me.j.user.boost.og === 20, JSON.stringify(me.j && me.j.user && me.j.user.boost));
  db.prepare('UPDATE holder_state SET gwc_tok = 0 WHERE user_id = ?').run(d.id);
  const sold = await api('/api/me', d.sid);
  check('  ...and pays nothing while one coin reads empty', sold.j && sold.j.user && sold.j.user.boost && sold.j.user.boost.og === 1, JSON.stringify(sold.j && sold.j.user && sold.j.user.boost));
  db.prepare('UPDATE holder_state SET gwc_tok = 20000000, send_tok = 0 WHERE user_id = ?').run(d.id);
  const soldS = await api('/api/me', d.sid);
  check('  ...whichever coin it is', soldS.j && soldS.j.user && soldS.j.user.boost && soldS.j.user.boost.og === 1, JSON.stringify(soldS.j && soldS.j.user && soldS.j.user.boost));
  // a Silver needs only $SEND since 2026-11-17: the same empty $GWC that stops Diamond's pay leaves Silver's 5×
  db.prepare('UPDATE users SET og_tier = 2 WHERE id = ?').run(d.id);
  db.prepare('UPDATE holder_state SET gwc_tok = 0, send_tok = 5000000 WHERE user_id = ?').run(d.id);
  const silver = await api('/api/me', d.sid);
  check('a Silver with no $GWC is still paid its 5× (Silver needs $SEND alone)', silver.j && silver.j.user && silver.j.user.boost && silver.j.user.boost.og === 5, JSON.stringify(silver.j && silver.j.user && silver.j.user.boost));
  const camp = await api('/api/og/campaign');
  check('/api/og/campaign states the Diamond month, its 20×, and that it has closed', camp.j && camp.j.diamond && camp.j.diamond.mult === 20 && camp.j.diamond.until - camp.j.diamond.from === 30 * 864e5 && camp.j.diamond.closed === true && camp.j.name[4] === 'Diamond' && camp.j.mult[4] === 20, JSON.stringify(camp.j && camp.j.diamond));

  /* ═══ 4. every page that explains OG says so ═══ */
  const APP = pub('app.js'), GAM = pub('gamify.js'), IDX = pub('index.html'), ABOUT = pub('about.html'), WP = pub('whitepaper.html'), README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  check('the badge knows tier 4 (name, 20×, tooltip)', /4: \{ name: 'Diamond', mult: 20,/.test(APP));
  check('  ...and wears its own colour, not Gold’s or the Diamond Hands cyan', /\.og-badge--diamond \{/.test(pub('styles.css')) && /--og-diamond:/.test(pub('styles.css')));
  // the home page is about $SEND alone (2026-11-17): its OG banner promotes only a window open on $SEND alone, so it never names
  // Diamond (a both-coins tier, long closed) — the pages below explain it
  check('the home page\'s OG banner promotes a $SEND-only window and never Diamond: the pages below explain Diamond', !/og-banner|Diamond 20×|Diamond/.test(IDX) && /<aside class="lp-og" id="lp-og"/.test(IDX));
  check('the dashboard block and its rules card explain it', /tier === 4 \? 'in the first month of \$GWC and bought more of each than you sold that month'/.test(GAM) && /💎 Diamond — 20×\.<\/b> Bought both in the first month of \$GWC/.test(GAM));
  check('the About page OG rules list it', /💎 Diamond — 20×\.<\/b> The first believers: bought both in the <b>first month of \$GWC<\/b>/.test(ABOUT));
  check('the whitepaper lists it', /Diamond &mdash; 20&times;\.<\/strong> You bought both in the <strong>first month of \$GWC<\/strong>/.test(WP));
  // the table has said which coins each tier needs since 2026-11-17 (Diamond: both), so the row is read through that column
  check('the README table and rules list it', /\| 💎 Diamond \| \*\*20×\*\* \| both coins \| the \*\*first month of \$GWC\*\*/.test(README) && /\*\*💎 Diamond — the first believers\.\*\*/.test(README));
  check('no OG copy tells anyone to buy', !/'Buy <b>both \$Send and \$GWC<\/b>/.test(GAM));

  /* ═══ 5. Diamond supersedes Gold on a link (owner, 2026-11-17: "If a person connects a wallet that qualifies for diamond OG
     have that super-seed their Gold OG badge status") ═══
     The real linkWalletTo, checkOg, grantDiamondUpgrade and the bought verdicts' adapter (ogBoughtFacts), lifted out of server.js
     and run against an in-memory database. Since "$100 bought" checkOg reads no chain: it decides on each member's per-coin
     verdicts, which here are built from per-wallet facts (tests/_ogfake.mjs; the engine runs on real chain data in
     tests/acquire.mjs and end to end in tests/bought.mjs). A Gold is asked the Diamond question once per wallet set: a link
     re-opens it at once (ogOnLink); verdicts made for the older wallets are no answer (nothing is written until they are made
     again, and the link's right to ask travels with the request for them); every wallet a Diamond rests on is claimed for the
     account (ogClaimWallets); and a wallet whose badge is spent on another account adds no buys here. Wallets and accounts are
     made up. */
  {
    const DAY = 864e5;
    const val = (expr, env = {}) => new Function(...Object.keys(env), 'return (' + expr + ');')(...Object.values(env));
    const constSrc = (name) => { const mm = new RegExp('\\nconst ' + name + ' = ([^;\\n]+);').exec(SRC); return mm ? mm[1] : null; };
    const fnSrc = (name) => {
      const one = new RegExp('\\n(function ' + name + '\\([^)]*\\) \\{[^\\n]*\\})\\n').exec(SRC);
      if (one) return one[1];
      const mm = new RegExp('\\n(function ' + name + '\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\})\\n').exec(SRC);
      return mm ? mm[1] : null;
    };
    const asyncSrc = (name) => { const mm = new RegExp('\\n(async function ' + name + '\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\})\\n').exec(SRC); return mm ? mm[1] : null; };
    const C = (await api('/api/og/campaign')).j || {};
    const OG_TIER = val(constSrc('OG_TIER')), OG_LAUNCH = val(constSrc('OG_LAUNCH')), OG_DIAMOND_MULT = val(constSrc('OG_DIAMOND_MULT'));
    const ENV0 = { OG_TIER, OG_LAUNCH, OG_TIER_CLOSE: { 3: C.closes && C.closes.gold, 2: C.closes && C.closes.silver, 1: C.closes && C.closes.bronze },
      OG_TIER_NAME: val(constSrc('OG_TIER_NAME')), OG_TIER_MULT: val(constSrc('OG_TIER_MULT'), { OG_DIAMOND_MULT, OG_BONUS: val(constSrc('OG_BONUS')) }),
      OG_TIER_NEEDS: val(constSrc('OG_TIER_NEEDS')), OG_MIN_HOLD_USD: val(constSrc('MIN_HOLD_USD')) };
    const PURE = ['ogTierForBuy', 'ogBetterScan', 'ogAccountTier', 'ogDiamondOk', 'ogLiftable', 'ogLiftWhat', 'ogReadDecides', 'ogClaimWallets', 'ogCapped',
      'ogGrantText', 'ogRevokedText', 'ogDropText', 'ogRestoreText', 'ogHeldThrough',
      // what checkOg and the lift reach since the 2026-11-18 OG review: the drop proven by the badge's own grant, the pause's continuity, their notes
      'ogDropPick', 'ogDropOffText', 'ogGoldHeldBack', 'ogPauseHeld', 'ogResumeText', 'ogPauseSilverText', 'ogPauseRevokedText', 'ogDiamondText'];
    const SYNC = ['ogRequalify', 'ogAgain', 'ogOnLink', 'ogRevokedWallets', 'ogRevokedWalletRows', 'ogBoughtFacts', 'ogRaiseOnLink'];
    const ASYNC = ['checkOg', 'liftOgSilver', 'grantDiamondUpgrade', 'restoreOg', 'linkWalletTo'];
    const missing = [...PURE, ...SYNC].filter((n) => !fnSrc(n)).concat(ASYNC.filter((n) => !asyncSrc(n)));
    check('linkWalletTo, checkOg, grantDiamondUpgrade and the Diamond-on-link steps can be lifted out of server.js', !missing.length, missing.join(', '));
    const L = new Function(...Object.keys(ENV0), PURE.map(fnSrc).join('\n') + '\nreturn { ' + PURE.join(', ') + ' };')(...Object.values(ENV0));

    const TOKS = { SEND: '0xsend', GWC: '0xgwc' };
    const SCANS = new Map();     // wallet + ':' + coin -> what that wallet bought and holds (the verdicts are built from these)
    const PX = { SEND: 0.001, GWC: 0.001 };   // the stand-in's $ per token: 1,000,000 tokens = $1,000 bought
    const EMPTY = { tier: 0, firstBuyMs: null, holds: false, balWei: '0', dumped: false, notAccumulator: false, monthBoughtWei: '0', monthSoldWei: '0' };
    // one coin in one wallet: bought at `ts`, holding `tokens`; month flows only when given
    const sc = (coin, ts, month, tokens = 1_000_000) => ({ ...EMPTY, tier: L.ogTierForBuy(ts, OG_LAUNCH[coin]), firstBuyMs: ts, holds: tokens > 0,
      balWei: (BigInt(tokens) * 10n ** 18n).toString(), ...(month ? { monthBoughtWei: month[0], monthSoldWei: month[1] } : {}) });
    const M = ['5', '1'];                                                                   // bought 5, sold 1 inside $GWC's first month: a net buyer
    const MONTH = { SEND: OG_LAUNCH.SEND + 2 * DAY, GWC: OG_LAUNCH.GWC + 3 * DAY };         // inside $GWC's first month (both Gold)
    const LATE = OG_LAUNCH.GWC + 31 * DAY;                                                  // Gold, but after that month
    const both = (w, ts, month) => { SCANS.set(w + ':SEND', sc('SEND', typeof ts === 'object' ? ts.SEND : ts, month)); SCANS.set(w + ':GWC', sc('GWC', typeof ts === 'object' ? ts.GWC : ts, month)); };
    check('fixtures sit in the windows they claim (the month buys and the later ones are all Gold)', [MONTH.SEND, LATE].every((t) => L.ogTierForBuy(t, OG_LAUNCH.SEND) === 3)
      && [MONTH.GWC, LATE].every((t) => L.ogTierForBuy(t, OG_LAUNCH.GWC) === 3) && MONTH.SEND < OG_LAUNCH.GWC + 30 * DAY && LATE > OG_LAUNCH.GWC + 30 * DAY,
      JSON.stringify({ closes: C.closes }));

    const harness = (grantUntil) => {
      const mem = new DatabaseSync(':memory:');
      mem.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, og INTEGER NOT NULL DEFAULT 0, og_tier INTEGER NOT NULL DEFAULT 0, og_revoked INTEGER NOT NULL DEFAULT 0,
        og_diamond_at INTEGER, og_lift INTEGER NOT NULL DEFAULT 0, og_buy_ms INTEGER NOT NULL DEFAULT 0, og_checked_at INTEGER NOT NULL DEFAULT 0, og_dq INTEGER NOT NULL DEFAULT 0,
        og_try_at INTEGER NOT NULL DEFAULT 0, system INTEGER NOT NULL DEFAULT 0, og_requal INTEGER NOT NULL DEFAULT 0, og_cap INTEGER NOT NULL DEFAULT 0,
        og_recheck INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, og_paused_tier INTEGER NOT NULL DEFAULT 0, og_paused_at INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE identities (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, addr TEXT, identifier_enc TEXT, linked_at INTEGER);
        CREATE TABLE og_claims (addr_idx TEXT PRIMARY KEY, user_id INTEGER NOT NULL, tier INTEGER NOT NULL, claimed_at INTEGER NOT NULL);`);
      const notes = [];
      const walletAddresses = (uid) => mem.prepare("SELECT addr FROM identities WHERE user_id = ? AND type = 'wallet' ORDER BY rowid").all(uid).map((r) => r.addr);
      const FAKE = makeFakeBought({ mem, walletsOf: walletAddresses, SCANS, PX, TOKS });
      const reads = { n: 0 };   // every time checkOg read a verdict
      const BOUGHT = { stateOf: (uid, t) => { reads.n++; return FAKE.BOUGHT.stateOf(uid, t); }, want: (uid, t, o) => FAKE.BOUGHT.want(uid, t, o) };
      const E = {
        db: mem, now: () => Date.now(), bidx: (a) => 'idx:' + String(a).toLowerCase(), notify: (uid, emo, text) => notes.push({ uid, text }),
        walletAddresses, insertIdentity: (uid, type, addr) => mem.prepare('INSERT INTO identities (user_id, type, addr, identifier_enc, linked_at) VALUES (?,?,?,?,?)').run(uid, type, addr, addr, Date.now()),
        decField: (x) => x,   // the restore reads the wallets linked when a badge was removed (ogRevokedWallets): stored plain here
        OG_MAX_WALLETS: 5, TOK: TOKS, OG_PAIR: { SEND: '0xp1', GWC: '0xp2' }, ...ENV0, OG_DIAMOND_MULT, OG_GRANT_UNTIL_MS: grantUntil,
        OG_MONTH_MS: 30 * DAY, OG_DUST: val(constSrc('OG_DUST')), OG_DUST_WEI: 1000000000n, BOUGHT,
        _ogScanning: new Set(), _ogRescan: new Set(), _ogRescanLink: new Set(),
        // what else linkWalletTo touches — stubbed: the link's alert, sessions, points, holdings caches, the participation check
        sudoOthersOff: () => {}, forgetHoldings: () => {}, refreshSupplyForUser: () => {}, erc20Balance: async () => 0n, awardPoints: () => {}, PTS: { connect_wallet: 0 },
        restrictionOf: () => null, probationOf: () => null, balCache: new Map(), needsHolderProof: () => false, queueHolderProof: () => {},
      };
      const K = new Function(...Object.keys(E), [...PURE.map(fnSrc), ...SYNC.map(fnSrc), ...ASYNC.map(asyncSrc)].join('\n') + '\nreturn { checkOg, linkWalletTo };')(...Object.values(E));
      let uid = 0;
      const link = (id, w) => mem.prepare("INSERT INTO identities (user_id, type, addr, identifier_enc) VALUES (?, 'wallet', ?, ?)").run(id, w, w);   // no link time: a legacy row
      return {
        K, notes, link, FAKE, reads,
        user: (wallets) => { uid++; mem.prepare('INSERT INTO users (id) VALUES (?)').run(uid); for (const w of wallets) link(uid, w); return uid; },
        gold: (id, askedAt) => mem.prepare('UPDATE users SET og = 1, og_tier = 3, og_diamond_at = ? WHERE id = ?').run(askedAt, id),   // a Gold, asked the question (askedAt) or not (null)
        claim: (w, id, tier) => mem.prepare('INSERT INTO og_claims (addr_idx, user_id, tier, claimed_at) VALUES (?,?,?,?)').run('idx:' + w, id, tier, Date.now()),
        unlink: (id, w) => mem.prepare("DELETE FROM identities WHERE user_id = ? AND addr = ?").run(id, w),
        set: (id, cols) => mem.prepare('UPDATE users SET ' + Object.keys(cols).map((k) => k + ' = ?').join(', ') + ' WHERE id = ?').run(...Object.values(cols), id),
        row: (id) => mem.prepare('SELECT * FROM users WHERE id = ?').get(id),
        claims: (id) => mem.prepare('SELECT addr_idx, tier FROM og_claims WHERE user_id = ? ORDER BY addr_idx').all(id).map((r) => r.addr_idx.replace('idx:', '') + '=' + r.tier).join(','),
        // the link's own checkOg runs behind the link's balance read: let it finish
        idle: async () => { for (let i = 0, calm = 0; i < 200 && calm < 2; i++) { await new Promise((ok) => setTimeout(ok, 15)); calm = E._ogScanning.size || E._ogRescan.size ? 0 : calm + 1; } },
        lastNote: (id) => (notes.filter((n) => n.uid === id).pop() || {}).text || '',
      };
    };
    const H = harness(Date.now() + 365 * DAY);
    const me = (id) => ({ id, sid: 'test-session' });

    /* (a) the owner's case: X is Diamond on wallet A; X unlinks A; Gold Y links A → Y stays Gold */
    {
      both('0xda1', MONTH, M); both('0xdb1', LATE);
      const X = H.user(['0xda1']);
      const tX = await H.K.checkOg(X);
      check('X bought both in the first month of $GWC, a net buyer: Diamond, and wallet A is claimed for X', tX === 4 && H.row(X).og_tier === 4 && H.claims(X) === '0xda1=4', JSON.stringify({ tX, r: H.row(X), c: H.claims(X) }));
      H.unlink(X, '0xda1');
      const Y = H.user(['0xdb1']);
      const tY = await H.K.checkOg(Y);
      const askedBefore = H.row(Y).og_diamond_at;
      check('  ...Y bought both later in the Gold window: Gold, asked the Diamond question once (no)', tY === 3 && askedBefore > 0 && H.claims(Y) === '0xdb1=3', JSON.stringify({ tY, r: H.row(Y) }));
      const n0 = H.reads.n;
      await H.K.linkWalletTo(me(Y), '0xda1', 'signature'); await H.idle();
      check('X unlinked A, Gold Y links A: the question is asked again with A — and Y stays Gold (A\'s month backs X, not Y)',
        H.reads.n > n0 && H.row(Y).og_tier === 3 && H.row(Y).og_diamond_at >= askedBefore && H.claims(Y) === '0xdb1=3' && H.claims(X) === '0xda1=4',
        JSON.stringify({ r: H.row(Y), cY: H.claims(Y), cX: H.claims(X), reads: H.reads.n - n0 }));
    }
    /* (b) a wallet claimed elsewhere adds no buys — but does not stop the account's OWN Diamond wallet */
    {
      both('0xdc2', LATE); both('0xda2', MONTH, M); both('0xdb2', MONTH, M);
      const Y2 = H.user(['0xdc2']);
      await H.K.checkOg(Y2);
      H.claim('0xda2', 9001, 4); H.link(Y2, '0xda2');                                       // linked earlier, its badge spent on another account
      await H.K.linkWalletTo(me(Y2), '0xdb2', 'signature'); await H.idle();
      check('a Gold links its own wallet that qualifies for Diamond: Diamond, beside a linked wallet claimed by another account (which is not taken)',
        H.row(Y2).og_tier === 4 && H.claims(Y2) === '0xdb2=4,0xdc2=3' && /^OG Diamond unlocked!/.test(H.lastNote(Y2)),
        JSON.stringify({ r: H.row(Y2), c: H.claims(Y2), note: H.lastNote(Y2) }));
      /* (c) the upgrade CLAIMS the wallet its Diamond rests on: unlinked and linked to another Gold, it makes no second Diamond */
      H.unlink(Y2, '0xdb2');
      both('0xdd3', LATE);
      const Z = H.user(['0xdd3']);
      await H.K.checkOg(Z);
      await H.K.linkWalletTo(me(Z), '0xdb2', 'signature'); await H.idle();
      check('  ...that wallet, unlinked and linked to another Gold account, makes no second Diamond: it was claimed with the upgrade',
        H.row(Z).og_tier === 3 && H.row(Z).og_diamond_at > 0 && H.claims(Z) === '0xdd3=3', JSON.stringify({ r: H.row(Z), c: H.claims(Z) }));
    }
    /* (d) a claim written by another account after the verdicts were made: no Diamond, nothing taken, the question left open */
    {
      both('0xdc4', LATE); both('0xdb4', MONTH, M);
      const Y4 = H.user(['0xdc4']);
      await H.K.checkOg(Y4);
      H.link(Y4, '0xdb4'); H.set(Y4, { og_diamond_at: null });
      H.FAKE.freeze(Y4);                                                                    // the verdicts for both wallets, made before the claim
      H.claim('0xdb4', 9002, 4);
      await H.K.checkOg(Y4);
      H.FAKE.thaw(Y4);
      check('a wallet the Diamond rests on, claimed by another account after the verdicts were made: still Gold, the claim not taken, the question left open',
        H.row(Y4).og_tier === 3 && H.row(Y4).og_diamond_at === null && H.claims(Y4) === '0xdc4=3' && H.claims(9002) === '0xdb4=4', JSON.stringify({ r: H.row(Y4), c: H.claims(Y4) }));
    }
    /* (e) a link after the verdicts were made: they are for the older wallets — nothing is written on them, and the request for new
       ones carries the link's right to ask; made again, the account is Diamond */
    {
      both('0xdc5', LATE); both('0xdb5', MONTH, M);
      const Y5 = H.user(['0xdc5']); H.gold(Y5, null); H.claim('0xdc5', Y5, 3);       // a Gold not yet asked
      H.FAKE.freeze(Y5);                                                              // its verdicts, made for 0xdc5 alone
      const w0 = H.FAKE.wants.length;
      await H.K.linkWalletTo(me(Y5), '0xdb5', 'signature'); await H.idle();
      const asked = H.FAKE.wants.slice(w0).filter((x) => x.uid === Y5);
      check('a wallet linked after the verdicts were made: they are no answer — the older wallets\' "not Diamond" is never written, nothing is claimed',
        H.row(Y5).og_tier === 3 && H.row(Y5).og_diamond_at === null && H.claims(Y5) === '0xdc5=3', JSON.stringify({ r: H.row(Y5), c: H.claims(Y5) }));
      check('  ...the worker is asked for the verdicts of the wallets linked now, with the link\'s right to ask (opts.link)', asked.length >= 1 && asked.every((x) => x.opts.link === true && x.opts.prio === 2), JSON.stringify(asked));
      H.FAKE.thaw(Y5);
      await H.K.checkOg(Y5, { link: true });                                          // what boughtOnVerdict does when they are written
      check('  ...made again for the wallets linked now: Diamond, the new wallet claimed', H.row(Y5).og_tier === 4 && H.claims(Y5) === '0xdb5=4,0xdc5=3', JSON.stringify({ r: H.row(Y5), c: H.claims(Y5) }));
      check('  ...and the server hands the link\'s right on when a verdict is written (boughtOnVerdict → checkOg({ link }))', /checkOg\(uid, \{ link: !!\(opts && opts\.link\) \}\)/.test(SRC)
        && /if \(deps\.onVerdict\) try \{ deps\.onVerdict\(uid, t, before, after, opts\); \}/.test(readFileSync(path.join(ROOT, 'lib', 'bought.js'), 'utf8')));
    }
    /* (f) a Gold already asked (og_diamond_at set) links a wallet that qualifies → Diamond; the question re-opens at once */
    {
      both('0xdc6', LATE); both('0xdb6', MONTH, M);
      const Y6 = H.user(['0xdc6']); H.gold(Y6, Date.now() - 30 * DAY); H.claim('0xdc6', Y6, 3);
      const p = H.K.linkWalletTo(me(Y6), '0xdb6', 'signature');
      const reopened = H.row(Y6).og_diamond_at === null;                              // before the link's first await has resolved
      await p; await H.idle();
      check('a Gold already asked the Diamond question links a wallet that qualifies: the question re-opens at once, before the link awaits anything',
        reopened, JSON.stringify(H.row(Y6)));
      check('  ...and the account is Diamond, with the new wallet claimed and a note', H.row(Y6).og_tier === 4 && H.claims(Y6) === '0xdb6=4,0xdc6=3' && /^OG Diamond unlocked!/.test(H.lastNote(Y6)),
        JSON.stringify({ r: H.row(Y6), c: H.claims(Y6), note: H.lastNote(Y6) }));
      const n0 = H.reads.n;
      await H.K.linkWalletTo(me(Y6), '0xdz6', 'signature'); await H.idle();
      check('  ...a Diamond linking another wallet is not asked again (Diamond is final)', H.reads.n === n0 && H.row(Y6).og_tier === 4, H.reads.n - n0);
    }
    /* (g) after the grant window and its grace (OG_GRANT_UNTIL_MS): on a link only, never by the sweep (owner's Q7) */
    {
      const H2 = harness(Date.now() - DAY);
      both('0xdc7', LATE); both('0xdb7', MONTH, M);
      const Y7 = H2.user(['0xdc7']); H2.gold(Y7, null);
      const n0 = H2.reads.n;
      const t = await H2.K.checkOg(Y7);
      check('past the grant window, the sweep\'s check of a Gold not yet asked reads nothing', t === 3 && H2.reads.n === n0 && H2.row(Y7).og_diamond_at === null, JSON.stringify({ t, n: H2.reads.n - n0 }));
      await H2.K.linkWalletTo(me(Y7), '0xdb7', 'signature'); await H2.idle();
      check('  ...but a link still asks: Diamond', H2.row(Y7).og_tier === 4 && H2.claims(Y7) === '0xdb7=4', JSON.stringify({ r: H2.row(Y7), c: H2.claims(Y7) }));
      /* two links before the verdicts are made again: both requests carry the link's right, and the verdicts then decide */
      both('0xdc8', LATE); both('0xdb8', MONTH, M);
      const Y8 = H2.user(['0xdc8']); H2.gold(Y8, Date.now() - 30 * DAY);
      H2.FAKE.freeze(Y8);
      const w0 = H2.FAKE.wants.length;
      await H2.K.linkWalletTo(me(Y8), '0xde8', 'signature');                          // a wallet with nothing in it
      await H2.K.linkWalletTo(me(Y8), '0xdb8', 'signature'); await H2.idle();         // the Diamond wallet
      const asked = H2.FAKE.wants.slice(w0).filter((x) => x.uid === Y8);
      check('  ...past the grant window, links before the verdicts are made again ask for them with the link\'s right', H2.row(Y8).og_tier === 3 && asked.length >= 2 && asked.every((x) => x.opts.link === true), JSON.stringify(asked));
      H2.FAKE.thaw(Y8);
      await H2.K.checkOg(Y8, { link: true });
      check('  ...and once made, the link\'s right decides it past the window: Diamond', H2.row(Y8).og_tier === 4 && H2.claims(Y8) === '0xdb8=4', JSON.stringify({ r: H2.row(Y8), c: H2.claims(Y8) }));
    }
    /* (h) a wallet whose month buys were counted is claimed too, not only the wallets that earned each coin's Gold */
    {
      both('0xdc9', LATE); both('0xdr9', LATE);
      SCANS.set('0xdp9:SEND', sc('SEND', MONTH.SEND, ['3', '3'])); SCANS.set('0xdp9:GWC', sc('GWC', MONTH.GWC, ['5', '1']));   // alone: sold as much $SEND as it bought that month
      SCANS.set('0xdq9:SEND', sc('SEND', MONTH.SEND + DAY, ['2', '0'])); SCANS.set('0xdq9:GWC', sc('GWC', MONTH.GWC + DAY, ['2', '0']));
      const Y9 = H.user(['0xdc9']);
      await H.K.checkOg(Y9);
      H.link(Y9, '0xdp9');
      await H.K.linkWalletTo(me(Y9), '0xdq9', 'signature'); await H.idle();
      check('a Diamond that rests on two wallets\' month buys (the second earned no coin\'s Gold, it only bought more): both are claimed',
        H.row(Y9).og_tier === 4 && H.claims(Y9) === '0xdc9=3,0xdp9=4,0xdq9=4', JSON.stringify({ r: H.row(Y9), c: H.claims(Y9) }));
      H.unlink(Y9, '0xdq9');
      const Z9 = H.user(['0xdr9']);
      await H.K.checkOg(Z9);
      await H.K.linkWalletTo(me(Z9), '0xdq9', 'signature'); await H.idle();
      check('  ...so that wallet, linked to another Gold account, makes no second Diamond', H.row(Z9).og_tier === 3 && H.claims(Z9) === '0xdr9=3', JSON.stringify({ r: H.row(Z9), c: H.claims(Z9) }));
    }
    /* (i) an unlink after the verdicts were made: nothing is decided on wallets the account no longer has */
    {
      both('0xdc13', LATE); both('0xdq13', MONTH, M);
      const U = H.user(['0xdc13', '0xdq13']); H.gold(U, null); H.claim('0xdc13', U, 3);
      H.FAKE.freeze(U);                                                                 // made while 0xdq13 was linked: Diamond-able
      H.unlink(U, '0xdq13');
      await H.K.checkOg(U);
      check('a wallet unlinked after the verdicts were made: no Diamond on it, nothing claimed on it, the question left open',
        H.row(U).og_tier === 3 && H.row(U).og_diamond_at === null && H.claims(U) === '0xdc13=3', JSON.stringify({ r: H.row(U), c: H.claims(U) }));
      H.FAKE.thaw(U);
      await H.K.checkOg(U);
      check('  ...made again without it: asked, and not Diamond', H.row(U).og_tier === 3 && H.row(U).og_diamond_at > 0 && H.claims(U) === '0xdc13=3', JSON.stringify({ r: H.row(U), c: H.claims(U) }));
    }
    /* (j) a link raises a lower badge too — raise-only, up to the account's cap (owner, 2026-11-17: the buy date correct for everyone) */
    {
      const SILVER_TS = C.closes.gold + 5 * DAY, BRONZE_TS = C.closes.silver + 5 * DAY;
      SCANS.set('0xbz1:SEND', sc('SEND', BRONZE_TS)); SCANS.set('0xbz2:SEND', sc('SEND', SILVER_TS));
      const B1 = H.user(['0xbz1']); H.set(B1, { og: 1, og_tier: 1, og_buy_ms: BRONZE_TS }); H.claim('0xbz1', B1, 1);
      await H.K.linkWalletTo(me(B1), '0xbz2', 'signature'); await H.idle();
      check('a Bronze links a wallet whose $SEND was bought in Silver\'s window: raised to Silver, dated by that buy, the wallet claimed',
        H.row(B1).og_tier === 2 && H.row(B1).og_buy_ms === SILVER_TS && H.claims(B1) === '0xbz1=1,0xbz2=2' && /^Your Bronze is now OG Silver!/.test(H.lastNote(B1)), JSON.stringify({ r: H.row(B1), c: H.claims(B1), n: H.lastNote(B1) }));
      both('0xsg1', LATE);
      SCANS.set('0xsv1:SEND', sc('SEND', SILVER_TS));
      const S1 = H.user(['0xsv1']); H.set(S1, { og: 1, og_tier: 2, og_buy_ms: SILVER_TS }); H.claim('0xsv1', S1, 2);
      await H.K.linkWalletTo(me(S1), '0xsg1', 'signature'); await H.idle();
      check('  ...an uncapped Silver links a wallet that bought both coins in the Gold window: raised to Gold', H.row(S1).og_tier === 3 && H.claims(S1) === '0xsg1=3,0xsv1=2', JSON.stringify({ r: H.row(S1), c: H.claims(S1) }));
      both('0xsg2', LATE);
      SCANS.set('0xsv2:SEND', sc('SEND', SILVER_TS));
      const S2 = H.user(['0xsv2']); H.set(S2, { og: 1, og_tier: 2, og_buy_ms: SILVER_TS, og_cap: 2 }); H.claim('0xsv2', S2, 2);
      await H.K.linkWalletTo(me(S2), '0xsg2', 'signature'); await H.idle();
      check('  ...a Silver held to Silver (og_cap: it sold out of $GWC once) is never raised past it — only dated by its earlier $SEND buy', H.row(S2).og_tier === 2 && H.row(S2).og_buy_ms === LATE && H.claims(S2) === '0xsg2=2,0xsv2=2', JSON.stringify({ r: H.row(S2), c: H.claims(S2) }));
      SCANS.set('0xbz3:SEND', sc('SEND', BRONZE_TS + DAY));
      const B2 = H.user(['0xbz2b']); SCANS.set('0xbz2b:SEND', sc('SEND', BRONZE_TS)); H.set(B2, { og: 1, og_tier: 1, og_buy_ms: BRONZE_TS }); H.claim('0xbz2b', B2, 1);
      await H.K.linkWalletTo(me(B2), '0xbz3', 'signature'); await H.idle();
      check('  ...a link that shows nothing earlier or higher changes nothing (never lowered, nothing claimed)', H.row(B2).og_tier === 1 && H.row(B2).og_buy_ms === BRONZE_TS && H.claims(B2) === '0xbz2b=1', JSON.stringify({ r: H.row(B2), c: H.claims(B2) }));
      H.claim('0xbz9', 9003, 2); SCANS.set('0xbz9:SEND', sc('SEND', SILVER_TS));
      const B3 = H.user(['0xbz8']); SCANS.set('0xbz8:SEND', sc('SEND', BRONZE_TS)); H.set(B3, { og: 1, og_tier: 1, og_buy_ms: BRONZE_TS }); H.claim('0xbz8', B3, 1);
      await H.K.linkWalletTo(me(B3), '0xbz9', 'signature'); await H.idle();
      check('  ...and a wallet whose badge backs another account raises nothing here', H.row(B3).og_tier === 1 && H.claims(B3) === '0xbz8=1', JSON.stringify({ r: H.row(B3), c: H.claims(B3) }));
    }
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
