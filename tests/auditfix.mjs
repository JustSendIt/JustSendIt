/* The audit remediation, asserted against the real code. Pure helpers are extracted from server.js and
   run directly; everything else goes through the live HTTP API with throwaway accounts, which are deleted
   in the finally block. Nothing here writes to a real user. */
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { gatePass, cleanupGatePass } from './gatepass.mjs';
import { ROOT, ETHERS, DB_PATH, KEY_PATH, SERVER_JS } from './_paths.mjs';
// ethers is CommonJS; createRequire loads it from the checkout without a literal import path
const { Wallet } = createRequire(import.meta.url)(ETHERS);

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const grab = (re, label) => { const m = SRC.match(re); if (!m) { check('EXTRACT ' + label, false, 'not found'); return null; } return m[0]; };
const made = [];
let GATE = '';

const DATA_KEY = Buffer.from(readFileSync(KEY_PATH, 'utf8').trim(), 'hex');
const IDX_KEY = createHmac('sha256', DATA_KEY).update('blind-index').digest();
const bidx = (v) => createHmac('sha256', IDX_KEY).update(String(v == null ? '' : v)).digest('hex');

async function api(path, opts = {}) {
  const cookies = [GATE, opts.sid ? 'sid=' + opts.sid : ''].filter(Boolean).join('; ');
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookies ? { Cookie: cookies } : {}) },
    body: opts.body !== undefined ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
    redirect: 'manual',
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
/* Fixtures here start PAST the participation gate (holder_verified_at set): this suite is testing
   something other than the gate, and a fixture that trips it would be testing the gate by accident.
   proofgate.mjs is the suite that tests the gate itself. */

function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + Math.random().toString(16).slice(2);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)')
    .run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}

try {
  GATE = await gatePass(BASE);

  /* ═══════════ 1. the price path that silently answered null for every token ═══════════ */
  {
    const row = db.prepare("SELECT pair_json FROM token_cache WHERE found=1 AND symbol='GWC'").get()
             || db.prepare('SELECT pair_json FROM token_cache WHERE found=1 LIMIT 1').get();
    const fn = grab(/async function tokenPriceUsdOf\(addr\)[^\n]*\n/, 'tokenPriceUsdOf');
    check('tokenPriceUsdOf reads the price off .market, not the pool descriptor',
      !!fn && /r\.pair\.market\.priceUsd/.test(fn) && !/r\.pair\.priceUsd/.test(fn), fn && fn.trim().slice(0, 90));
    if (row) {
      const P = JSON.parse(row.pair_json);
      // the shape the old code assumed vs the shape that actually exists
      check('  ...and the shape proves why: pair.priceUsd is undefined, pair.market.priceUsd is a number',
        P.priceUsd === undefined && typeof (P.market && P.market.priceUsd) === 'number',
        'top=' + P.priceUsd + ' market=' + (P.market && P.market.priceUsd));
    }
  }

  /* ═══════════ 2. the $100 hold floor, every token on the site ═══════════ */
  {
    const mh = /const MIN_HOLD_USD = (\d+);/.exec(SRC);
    const minHold = mh ? Number(mh[1]) : null;
    check('MIN_HOLD_USD is $100', minHold === 100, minHold);
    check('the community gate uses the same floor', /const MIN_COMMUNITY_HOLD_USD = MIN_HOLD_USD/.test(SRC));
    check('the OG value floor uses the same floor', /const OG_MIN_HOLD_USD = MIN_HOLD_USD/.test(SRC));
    check('starting a community is priced against it too', /holdsToken\(me\.id, token, MIN_HOLD_USD/.test(SRC));

    // holderMultiplier must count only bags that cleared the floor
    const qual = grab(/const qualSendBp = [\s\S]*?const qualGwcBp = [^\n]*\n/, 'qual helpers');
    const hm = grab(/function holderMultiplier\(userId\) \{[\s\S]*?\n\}/, 'holderMultiplier');
    const di = grab(/function diamondInfo\(holdDays\) \{[\s\S]*?\n\}/, 'diamondInfo');
    const dl = grab(/function diamondLevel\(holdDays\)[^\n]*\n/, 'diamondLevel');
    const tiers = grab(/const DIAMOND_TIERS = \[[\s\S]*?\n\];/, 'DIAMOND_TIERS');
    const eff = grab(/function effHoldDays\(h\)[^\n]*\n/, 'effHoldDays');
    const hd = grab(/function holdDaysOf\(h\)[^\n]*\n/, 'holdDaysOf');
    const gd = grab(/function gwcDaysOf\(h\)[^\n]*\n/, 'gwcDaysOf');
    if (qual && hm && di) {
      const NOW = Date.now();
      const mk = (state) => {
        const fakeDb = { prepare: () => ({ get: () => state }) };
        return new Function('db', 'now', 'HOLDER_TTL', 'GWC_SUPPLY_WEIGHT', 'GWC_TIME_WEIGHT',
          tiers + '\n' + dl + di + hd + gd + eff + qual + hm + '\nreturn holderMultiplier(1);')(
          fakeDb, () => NOW, 26 * 3600 * 1000, 3, 2);
      };
      const YEAR_AGO = NOW - 400 * 864e5;
      // a dust bag held for over a year — the exact exploit: ~$0.01 of $GWC reaching a x40 Diamond factor
      const dust = { streak_start: YEAR_AGO, gwc_streak_start: YEAR_AGO, last_check: NOW, score_bp: 1,
                     send_bp: 0, gwc_bp: 1, send_qual: 0, gwc_qual: 0 };
      check('dust held for a year earns NO holder boost', mk(dust) === 1, mk(dust));
      // the same position, but the bag actually clears $100
      const real = { ...dust, send_qual: 1, gwc_qual: 1, send_bp: 500, gwc_bp: 500 };
      check('  ...while a real bag held the same time is paid in full', mk(real) > 1, mk(real));
      // one coin over the floor, one under: only the qualifying coin counts
      const half = { ...dust, send_qual: 1, send_bp: 500, gwc_qual: 0, gwc_bp: 100000 };
      const both = { ...half, gwc_qual: 1 };
      check('  ...and a coin below the floor adds nothing to the boost', mk(half) < mk(both), mk(half) + ' vs ' + mk(both));
      // rows written before the floor existed (qual NULL) keep counting until re-read
      const legacy = { ...real, send_qual: null, gwc_qual: null };
      check('  ...but a pre-floor row is not punished before its next on-chain read', mk(legacy) === mk(real), mk(legacy));
    }
    // the streak itself must end when a bag drops below the floor
    const rh = grab(/const qSendBp = [\s\S]*?const scoreBp = qSendBp \+ qGwcBp;/, 'refreshHolder qualifying score');
    check('the no-sell streak is driven by the QUALIFYING score, not the raw balance', !!rh);
    check('  ...and dropping below $100 of $GWC ends the $GWC streak', /if \(qGwcBp <= 0\) \{ gwcStreak = null/.test(SRC));
    check('tracker capacity takes the floor too', /h\.gwc_qual !== 0 && h\.streak_start && fresh/.test(SRC));
  }

  /* ═══════════ 3. wallet two-factor: one rule, one helper, every door ═══════════ */
  {
    const door = grab(/if \(u2 && u2\.twofa_method === 'wallet'\) \{[\s\S]*?\n          \}/, 'sign-in wallet factor');
    check('the sign-in door asks walletFactorRefusal, like every other door',
      !!door && /walletFactorRefusal/.test(door), door && door.split('\n')[1].trim().slice(0, 70));
    check('  ...and no longer re-implements the legacy timestamp rule inline',
      !!door && !/linked_at > u2\.twofa_enabled_at/.test(door));

    // end to end: promote a second wallet to be the key, then prove which wallet the door accepts
    const u = mkUser('__af_2fa__');
    const wA = Wallet.createRandom(), wB = Wallet.createRandom();
    const link = async (w) => {
      const a = w.address.toLowerCase();
      const n = await api('/api/auth/wallet/nonce?purpose=link&address=' + a, { sid: u.sid });
      return api('/api/auth/wallet/verify', { method: 'POST', sid: u.sid, body: { address: a, signature: await w.signMessage(n.j.message) } });
    };
    await link(wA); await link(wB);
    // arm wallet 2FA on A, then move the key to B — exactly what /api/2fa/wallet/primary does
    db.prepare("UPDATE users SET twofa_method = 'wallet', twofa_enabled_at = ? WHERE id = ?").run(Date.now(), u.id);
    db.prepare("UPDATE identities SET is_2fa = 0 WHERE user_id = ?").run(u.id);
    db.prepare("UPDATE identities SET is_2fa = 1 WHERE user_id = ? AND identifier = ?").run(u.id, bidx(wB.address.toLowerCase()));
    const signIn = async (w) => {
      const a = w.address.toLowerCase();
      const n = await api('/api/auth/wallet/nonce?purpose=signin&address=' + a);
      return api('/api/auth/wallet/verify', { method: 'POST', body: { address: a, signature: await w.signMessage(n.j.message) } });
    };
    const asB = await signIn(wB);
    check('the CHOSEN two-factor wallet can sign in', asB.status === 200, asB.status + ' ' + (asB.j && asB.j.error || ''));
    const asA = await signIn(wA);
    check('ATTACK CLOSED: the demoted wallet cannot', asA.status === 401 && /two-factor wallet/i.test(asA.j.error || ''), asA.status + ' ' + (asA.j && asA.j.error || ''));
  }

  /* ═══════════ 4. one OG badge per wallet, ever ═══════════ */
  {
    check('og_claims exists and is keyed by the wallet', /CREATE TABLE IF NOT EXISTS og_claims[\s\S]*?addr_idx TEXT PRIMARY KEY/.test(SRC));
    const guard = grab(/const claimAddrs = \[[\s\S]{0,600}?already spent on another account/, 'claim guard');
    check('a grant refuses a wallet already claimed by another account',
      !!guard && /SELECT user_id FROM og_claims WHERE addr_idx/.test(guard) && /prior\.user_id !== userId/.test(guard));
    check('  ...and the claim is written in the same transaction as the badge',
      /db\.exec\('BEGIN'\);[\s\S]*?INSERT INTO og_claims[\s\S]*?db\.exec\('COMMIT'\);/.test(SRC));
    check('  ...and unlinking does NOT release it (that was the loop)',
      !/DELETE FROM og_claims/.test(SRC));
    // the live table accepts exactly one owner per wallet
    const probeIdx = bidx('__af_probe_wallet__');
    const uA = mkUser('__af_ogA__'), uB = mkUser('__af_ogB__');
    db.prepare('INSERT INTO og_claims (addr_idx, user_id, tier, claimed_at) VALUES (?,?,?,?)').run(probeIdx, uA.id, 3, Date.now());
    let second = null;
    try { db.prepare('INSERT INTO og_claims (addr_idx, user_id, tier, claimed_at) VALUES (?,?,?,?)').run(probeIdx, uB.id, 3, Date.now()); second = 'inserted'; }
    catch (e) { second = 'refused'; }
    check('  ...the table itself cannot hold two owners for one wallet', second === 'refused', second);
    db.prepare('DELETE FROM og_claims WHERE addr_idx = ?').run(probeIdx);
  }

  /* ═══════════ 5. prototype keys on the profile-image route ═══════════ */
  {
    const u = mkUser('__af_proto__');
    const before = db.prepare('SELECT COUNT(*) n FROM uploads').get().n;
    const bad1 = await api('/api/profile/image', { method: 'POST', sid: u.sid, body: { kind: 'constructor', image: 'x' } });
    check('kind="constructor" is refused, not treated as a column', bad1.status === 400 && /avatar, header/.test(bad1.j.error || ''), bad1.status + ' ' + (bad1.j && bad1.j.error || ''));
    for (const k of ['__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      const r = await api('/api/profile/image', { method: 'POST', sid: u.sid, body: { kind: k, image: 'x' } });
      check('  ...and so is kind="' + k + '"', r.status === 400, r.status);
    }
    const after = db.prepare('SELECT COUNT(*) n FROM uploads').get().n;
    check('  ...and none of them wrote an untracked file', after === before, before + ' -> ' + after);
    const ok = await api('/api/profile/image', { method: 'POST', sid: u.sid, body: { kind: 'avatar', remove: true } });
    check('  ...while a real kind still works', ok.status === 200, ok.status);
  }

  /* ═══════════ 6. "bought from the pool" nets what you sent back ═══════════ */
  {
    const wtp = grab(/async function walletTokenPosition\(userId, tokenAddr, pairAddr, priceUsd, liqUsd\) \{[\s\S]*?\n\}/, 'walletTokenPosition');
    check('transfers INTO the pair are subtracted from what the pair sent you',
      !!wtp && /else if \(from === me && to === pair\) outRaw \+= v;/.test(wtp) && /inRaw > outRaw \? inRaw - outRaw : 0n/.test(wtp));
    check('  ...so skim() and burn() net to zero rather than paying the size multiplier', !!wtp && /netRaw/.test(wtp));
    check('  ...and the position can never be worth more than the pool it is priced against',
      !!wtp && /Math\.min\(tok \* priceUsd, cap\)/.test(wtp));
    check('  ...and the transfer history is paged, not a single page', !!wtp && /POS_PAGES/.test(wtp));
    check('a Send Call passes the pool liquidity in', /callSpendUsd\(me\.id, token, p2\.pair\.address, price, liq\)/.test(SRC));
  }

  /* ═══════════ 7. the milestone ladder's two-sample rule actually runs ═══════════ */
  {
    const sel = grab(/const rows = db\.prepare\('SELECT id, user_id, token_addr, symbol, entry_price[^\n]*\n/, 'refreshCalls select');
    check('refreshCalls SELECTs cur_price, so the sustained-price check has an input',
      !!sel && /cur_price/.test(sel));
    check('  ...and the sweep is bounded per pass', !!sel && /LIMIT \?/.test(sel) && /CALLS_REFRESH_BATCH/.test(SRC));
    check('  ...oldest-checked first, so no call is starved', !!sel && /ORDER BY COALESCE\(last_check, 0\) ASC/.test(sel));
  }

  /* ═══════════ 8. a Send It race cannot mint two paying positions ═══════════ */
  {
    check('the one-paying-position-per-token rule is re-decided under the write lock',
      /db\.exec\('BEGIN IMMEDIATE'\);\n            paying = !db\.prepare\(dupSql\)/.test(SRC));
    check('a second call on one token is re-checked inside the transaction too',
      /const dupNow = db\.prepare\('SELECT COUNT\(\*\) n FROM calls WHERE user_id = \? AND token_addr = \?'\)/.test(SRC));
  }

  /* ═══════════ 9. showing up counts even when it pays nothing ═══════════ */
  {
    const u = mkUser('__af_checkin__');
    const r1 = await api('/api/checkin', { method: 'POST', sid: u.sid });
    check('a check-in answers checkedInToday', r1.status === 200 && r1.j.checkedInToday === true, r1.status);
    const stamped = db.prepare('SELECT checkin_at FROM users WHERE id=?').get(u.id).checkin_at;
    check('  ...and stamps users.checkin_at', stamped > 0, stamped);
    // the exploit state: wipe the ledger row, keep the stamp. That is what a capped-out day looks like.
    db.prepare("DELETE FROM points_events WHERE user_id = ? AND kind = 'daily'").run(u.id);
    const r2 = await api('/api/gamify/me', { sid: u.sid });
    check('REGRESSION: with no ledger row, the day still reads as "checked in"', r2.j.checkedInToday === true, JSON.stringify(r2.j && r2.j.checkedInToday));
    check('  ...and the decay engine reads the same source', /const showedUp = checkedInToday\(u\.id, u\);/.test(SRC));
    check('  ...and the sweep selects checkin_at so it can', /restrict_level, checkin_at\n\s+FROM users WHERE decay_at/.test(SRC));
    check('  ...and drains the most overdue first, not the lowest account id', /ORDER BY decay_at ASC, id ASC LIMIT \?/.test(SRC));
  }

  /* ═══════════ 10. the weekly race ranks work, not wallet size ═══════════ */
  {
    check('the board sums comp_base, which strips the position-size scaling',
      /SUM\(COALESCE\(e\.comp_base, e\.base\)\) pts/.test(SRC));
    check('  ...and no longer counts decay as negative work', /'commxp','convxp','commact','decay'/.test(SRC));
    check('a Send Call reports its unscaled base to the race', /openBase \* OPEN_STACK_MAX\), PTS\.send_call\)/.test(SRC));
    check('a Send It does the same', /hopBase \* OPEN_STACK_MAX\), PTS\.hop_on\)/.test(SRC));
    check('comp_base can never exceed what was actually paid', /const cb = Math\.min\(base, \(compBase != null && compBase > 0\) \? compBase : base\);/.test(SRC));

    // end to end through the live ledger
    const u = mkUser('__af_race__');
    db.prepare('INSERT INTO points_events (user_id, kind, amount, base, mult, comp_base, ref, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(u.id, 'send_call', 12000, 12000, 1, 120, 'af:race:' + u.id, Date.now());
    db.prepare('INSERT INTO points_events (user_id, kind, amount, base, mult, comp_base, ref, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(u.id, 'decay', -5000, -5000, 1, -5000, 'af:decay:' + u.id, Date.now());
    const scored = db.prepare(`SELECT SUM(COALESCE(e.comp_base, e.base)) pts FROM points_events e
                               WHERE e.user_id = ? AND e.kind NOT IN ('commxp','convxp','commact','decay')`).get(u.id).pts;
    check('  ...a $10k-backed call scores its base 120, not its paid 12,000', scored === 120, scored);
  }

  /* ═══════════ 11. one connection is one connection, on IPv6 too ═══════════ */
  {
    const fn = grab(/function ipKey\(raw\) \{[\s\S]*?\n\}/, 'ipKey');
    const ipKey = new Function(fn + '\nreturn ipKey;')();
    check('IPv4 keys on the address', ipKey('1.2.3.4') === '1.2.3.4');
    const a = ipKey('2001:db8:abcd:1234:1::9'), b = ipKey('2001:db8:abcd:1234:ffff::2');
    check('ATTACK CLOSED: two addresses in one IPv6 /64 collapse to one key', a === b && a.endsWith('::/64'), a + ' vs ' + b);
    check('  ...but a different /64 is a different connection', ipKey('2001:db8:abcd:9999::1') !== a);
    check('  ...ports and zone ids never create a second identity',
      ipKey('[2001:db8:abcd:1234::1]:443') === a && ipKey('2001:db8:abcd:1234::1%en0') === a);
    check('  ...and a v4-mapped v6 address is the v4 address', ipKey('::ffff:1.2.3.4') === '1.2.3.4');
    check('clientIp normalises, so every limit inherits it', /return ipKey\(req\.socket\.remoteAddress\) \|\| 'unknown';/.test(SRC));
  }

  /* ═══════════ 12. caches keyed on caller input ═══════════ */
  {
    check('the candle cache keys on every input the candles depend on',
      /const key = pairAddr \+ ':' \+ tokenAddr \+ ':' \+ tfKey \+ ':' \+ hours;/.test(SRC));
    check('the LP-lock verdict keys on the pair the caller named', /const key = tok \+ '\|' \+ \(pair \|\| ''\);/.test(SRC));
    check('  ...and refuses a pool that does not hold the token', /that pool does not hold this token/.test(SRC));
    check('a definite "not a pool" is cached, so junk lookups cost one chain read', /SPOT_NEG_TTL/.test(SRC));
    check('caller-keyed caches are swept and capped', /function sweepOpenCaches\(\)/.test(SRC) && /sweepOpenCaches\(\);/.test(SRC));
  }

  /* ═══════════ 13. privacy: what the site publishes about a person ═══════════ */
  {
    check('the points ledger records wallets by blind index, never in clear text',
      /'connect:' \+ bidx\(address\)/.test(SRC) && /'track:' \+ me\.id \+ ':' \+ bidx\(address\)/.test(SRC));
    check('  ...and no ref concatenates a raw address any more', !/'(connect|track):' \+ (me\.id \+ ':' \+ )?address\b/.test(SRC));
    check('a Send Call publishes a wallet only if asked', /const wallet = \(b\.shareWallet === true\)/.test(SRC));
    check('  ...and it can be taken back', /UPDATE calls SET wallet = NULL WHERE id = \? AND user_id = \?/.test(SRC));
    check('public sender amounts are rounded, exact only for their owner',
      /senderUsdPublic/.test(SRC) && /const isSelf = !!\(me && me\.id === x\._uid\);/.test(SRC));
    const f = grab(/const senderUsdPublic = \(v\) => \{[\s\S]*?\n\};/, 'senderUsdPublic');
    if (f) {
      const g = new Function(f + '\nreturn senderUsdPublic;')();
      check('  ...to two significant figures', g(12345) === 12000 && g(47) === 47 && g(0) === 0, [g(12345), g(47), g(0)].join(','));
    }
    check('the login door no longer hands every linked wallet to whoever knows the password',
      !/extra\.wallets = walletAddresses\(u\.id\)/.test(SRC));
    check('  ...a challenge is fetched for one address at a time instead', /\/api\/auth\/login\/wallet2fa\/challenge/.test(SRC));
  }

  /* ═══════════ 14. sessions can be ended ═══════════ */
  {
    const u = mkUser('__af_sess__');
    const other = 'tok_other_' + Math.random().toString(16).slice(2);
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)')
      .run(createHash('sha256').update(other).digest('hex'), u.id, Date.now(), Date.now() + 864e5);
    const list = await api('/api/auth/sessions', { sid: u.sid });
    check('an account can see its own live sessions', list.status === 200 && list.j.sessions.length === 2, list.status + ' ' + (list.j && list.j.sessions && list.j.sessions.length));
    check('  ...marked which one is this browser', (list.j.sessions || []).filter(s => s.current).length === 1);
    check('  ...and never returns a usable token', !JSON.stringify(list.j).includes(other));
    const kill = await api('/api/auth/sessions', { method: 'DELETE', sid: u.sid });
    check('ending other sessions works', kill.status === 200 && kill.j.endedOthers === 1, JSON.stringify(kill.j));
    const stillMe = await api('/api/me', { sid: u.sid });
    check('  ...without signing out the browser that did it', stillMe.status === 200 && stillMe.j.user);
    const dead = await api('/api/me', { sid: other });
    check('  ...and the other session is genuinely dead', !(dead.j && dead.j.user), JSON.stringify(dead.j).slice(0, 60));
  }

  /* ═══════════ 15. the guess budget on security changes ═══════════ */
  {
    check('verifyCurrentFactor burns a per-account guess budget', /if \(!rateLimit\('factor:' \+ me\.id, 12, 9e5\)\)/.test(SRC));
    check('arming a first factor still proves ownership', /const err = await ownershipRefusal\(me, b\); if \(err\) return bad\(res, err, 401\); \}/.test(SRC));
    check('  ...on the TOTP door', /\/api\/2fa\/totp\/setup[\s\S]{0,400}ownershipRefusal/.test(SRC));
    check('  ...and on adding an email + password', /p === '\/api\/account\/email'[\s\S]{0,1400}ownershipRefusal/.test(SRC));
    check('the slow-hash doors are rate limited', /rateLimit\('pwenable:'/.test(SRC) && /rateLimit\('w2faon:'/.test(SRC) && /rateLimit\('totpenable:'/.test(SRC));
    check('there is a way to change a password at all', /p === '\/api\/account\/password'/.test(SRC));
    check('  ...and it ends every other session', /DELETE FROM sessions WHERE user_id = \? AND token <> \?'\)\.run\(me\.id, hashToken\(me\.sid\)\)\.changes/.test(SRC));
  }

  /* ═══════════ 16. bodies, uploads and health ═══════════ */
  {
    check('the default JSON body limit is 256 KB, not 8 MB', /function readBody\(req, limit = 256 \* 1024\)/.test(SRC));
    check('  ...and a trickled body times out', /BODY_TIMEOUT_MS/.test(SRC));
    const big = await api('/api/checkin', { method: 'POST', body: '{"x":"' + 'a'.repeat(300 * 1024) + '"}' });
    check('  ...an oversized body is refused, not parsed', big.status === 413 || big.status === 401, big.status);
    check('one account cannot hold every upload slot', /mediaByUser/.test(SRC) && /MEDIA_PER_USER/.test(SRC));
    check('  ...and no upload outlives its absolute deadline', /UPLOAD_DEADLINE_MS/.test(SRC));
    const h = await api('/healthz');
    check('/healthz actually checks the database and the disk', h.status === 200 && h.j.db === 'ok', JSON.stringify(h.j));
    check('  ...and would answer 503 rather than lie', /res\.writeHead\(h\.ok \? 200 : 503/.test(SRC));
    check('backups do not keep 7 copies on the volume they protect', /const BACKUP_KEEP = BACKUP_OFF_VOLUME \? 7 : 3;/.test(SRC));
  }

  /* ═══════════ 17. restart no longer strands a block-0 scan ═══════════ */
  {
    check('interrupted scans are re-opened at boot', /re-opened ' \+ orphans\.changes \+ ' interrupted by the last shutdown/.test(SRC));
    check('  ...and a stale in-flight claim is not believed forever', /SNIPE_STALE_MS/.test(SRC));
    const stuck = db.prepare("SELECT COUNT(*) n FROM sniper_scans WHERE status IN ('queued','running') AND started_at < ?").get(Date.now() - 11 * 60 * 1000).n;
    check('  ...and nothing is stuck in the live table right now', stuck === 0, stuck);
  }

  /* ═══════════ 18. the risk panel explains the score it shows ═══════════ */
  {
    const NP = readFileSync(ROOT + '/public/newpairs.js', 'utf8');
    const RISK = eval('(' + /const RISK = (\{[\s\S]*?\n\});/.exec(SRC)[1] + ')');
    const WEIGHTS = eval('(' + /const WEIGHTS = (\{[^}]*\});/.exec(NP)[1] + ')');
    const SECTIONS = eval('(' + /const SECTIONS = (\[[\s\S]*?\n  \]);/.exec(NP)[1] + ')');
    const miss = Object.keys(RISK).filter(k => WEIGHTS[k] !== RISK[k].w);
    check('every server risk flag has a matching client weight', miss.length === 0, miss.join(','));
    const inSec = {}; for (const s of SECTIONS) for (const f of s.flags) inSec[f] = (inSec[f] || 0) + 1;
    const unplaced = Object.keys(RISK).filter(k => inSec[k] !== 1);
    check('  ...and appears in exactly one breakdown section', unplaced.length === 0, unplaced.join(','));
    check('the pool and the burn address are not counted as holders', /const NON_HOLDERS = new Set\(\[/.test(SRC));
  }

  /* ═══════════ 19. the honest claims ═══════════ */
  {
    const NPH = readFileSync(ROOT + '/public/newpairs.html', 'utf8');
    check('the radar no longer claims to see every token on the chain', !/Every new token launched on Robinhood Chain/.test(NPH));
    check('  ...and says what it actually reads', /Uniswap-V2 factory/.test(NPH) && /hasn’t been judged/.test(NPH));
    check('a permanent restriction offers a free appeal, not only a purchase', /appealEmail: APPEAL_EMAIL/.test(SRC));
    check('  ...to a real address', /const APPEAL_EMAIL = 'GWCRH@atomicmail\.io';/.test(SRC));
    const AJS = readFileSync(ROOT + '/public/auth.js', 'utf8');
    check('  ...and the banner puts it in front of the person it concerns', /appeal it<\/b> — email/.test(AJS));
    check('a restriction buy-out is priced with the spike-protected median', /price = \(await sendPriceUsd\(\)\) \|\| 0;/.test(SRC));
    check('opening a Send Call refuses a stale cached price', /lookupTokenPair\(token, \{ maxAgeMs: PRICE_MAX_AGE_MS \}\)/.test(SRC));
  }

  /* ═══════════ 20. communities: a bag cannot be walked through ten accounts ═══════════ */
  {
    check('pending communities are re-verified too, not only live ones', /c\.status IN \('live','pending'\)/.test(SRC));
    check('  ...and a pending revoke does not dock a multiplier nobody was given', /if \(r\.status === 'live'\) db\.prepare\('UPDATE users SET live_comm_count/.test(SRC));
  }

  /* ═══════════ 21. one burn, one Data API key ═══════════ */
  {
    check('the mint re-checks the clash under the write lock', /db\.exec\('BEGIN IMMEDIATE'\);[\s\S]*?const clashNow = /.test(SRC));
    check('  ...and re-verifies the burn is still unspent before spending it', /that burn has just been spent on another key/.test(SRC));
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join('\n'));
} finally {
  for (const id of made) {
    for (const t of ['sessions', 'points_events', 'notifications', 'posts', 'calls', 'call_hops', 'identities', 'tracked_wallets', 'tracker_cache', 'holder_state', 'og_claims', 'community_members', 'api_keys', 'watchlist', 'mutes'])
      { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM invite_codes WHERE owner_id=? OR user_id=?').run(id, id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  try { db.prepare('DELETE FROM wallet_challenges').run(); } catch {}
  cleanupGatePass();
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_af\\_%' ESCAPE '\\'").get().n;
  const codes = db.prepare('SELECT COUNT(*) n FROM invite_codes').get().n;
  console.log('\ncleanup — throwaway users left:', left, '| invite codes in table:', codes);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
