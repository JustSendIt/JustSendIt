/* 💎 OG Diamond: bought both coins in the first month of $GWC and a net buyer of both that month → 20×.
   The decision is checked on fixed inputs (the pure function the grant uses), the payout through the real API
   with DB-minted fixtures, and the copy on every page that explains OG. Everything made here is deleted. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH, ROOT, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
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
  check('  ...summed across EVERY linked wallet, disqualified or not', /month\[c\.key\]\.in \+= BigInt\(s\.monthBoughtWei \|\| '0'\); month\[c\.key\]\.out \+= BigInt\(s\.monthSoldWei \|\| '0'\);\n\s+if \(s\.tier === OG_TIER\.NONE\) continue;/.test(SRC));
  check('Diamond keeps every Gold perk (a free data key)', /const DATA_TIER_DISCOUNT = \{ 4: 1, 3: 1,/.test(SRC) && /row\.og_tier >= OG_TIER\.GOLD/.test(SRC));
  check('a live Gold account is asked the Diamond question by the sweep, once', /WHERE \(u\.og_tier = 0 OR \(u\.og_tier = 3 AND u\.og_diamond_at IS NULL\)\) AND u\.og_revoked = 0/.test(SRC)
    && /const upgrading = u\.og_tier === OG_TIER\.GOLD && !u\.og_diamond_at;/.test(SRC));
  check('  ...an upgrade needs the same $100 of each a grant does, and a failed read is never an answer', /if \(scanFailed\) return OG_TIER\.GOLD;/.test(SRC)
    && /Number\(best\.SEND\.balWei \|\| 0\) \/ 1e18 \* sendPx >= OG_MIN_HOLD_USD && Number\(best\.GWC\.balWei \|\| 0\) \/ 1e18 \* gwcPx >= OG_MIN_HOLD_USD/.test(SRC));
  check('selling out of either coin still loses it for good (the revocation is tier-agnostic)', /if \(sendTok <= OG_DUST \|\| gwcTok <= OG_DUST\) \{[\s\S]{0,200}UPDATE users SET og = 0, og_tier = 0, og_revoked = 1/.test(SRC));

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
  const camp = await api('/api/og/campaign');
  check('/api/og/campaign states the Diamond month, its 20×, and that it has closed', camp.j && camp.j.diamond && camp.j.diamond.mult === 20 && camp.j.diamond.until - camp.j.diamond.from === 30 * 864e5 && camp.j.diamond.closed === true && camp.j.name[4] === 'Diamond' && camp.j.mult[4] === 20, JSON.stringify(camp.j && camp.j.diamond));

  /* ═══ 4. every page that explains OG says so ═══ */
  const APP = pub('app.js'), GAM = pub('gamify.js'), IDX = pub('index.html'), ABOUT = pub('about.html'), WP = pub('whitepaper.html'), README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  check('the badge knows tier 4 (name, 20×, tooltip)', /4: \{ name: 'Diamond', mult: 20,/.test(APP));
  check('  ...and wears its own colour, not Gold’s or the Diamond Hands cyan', /\.og-badge--diamond \{/.test(pub('styles.css')) && /--og-diamond:/.test(pub('styles.css')));
  check('the homepage OG banner names Diamond 20× and who it is for', /💎 Diamond 20×<\/b> for those who bought both in \$GWC’s first month and bought more of each than they sold that month/.test(IDX) && /Diamond, 20 times Send Power/.test(IDX));
  check('the dashboard block and its rules card explain it', /tier === 4 \? 'in the first month of \$GWC and bought more of each than you sold that month'/.test(GAM) && /💎 Diamond — 20×\.<\/b> Bought both in the first month of \$GWC/.test(GAM));
  check('the About page OG rules list it', /💎 Diamond — 20×\.<\/b> The first believers: bought both in the <b>first month of \$GWC<\/b>/.test(ABOUT));
  check('the whitepaper lists it', /Diamond &mdash; 20&times;\.<\/strong> You bought both in the <strong>first month of \$GWC<\/strong>/.test(WP));
  check('the README table and rules list it', /\| 💎 Diamond \| \*\*20×\*\* \| the \*\*first month of \$GWC\*\*/.test(README) && /\*\*💎 Diamond — the first believers\.\*\*/.test(README));
  check('no OG copy tells anyone to buy', !/'Buy <b>both \$Send and \$GWC<\/b>/.test(GAM));
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
