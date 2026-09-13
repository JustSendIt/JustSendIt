/* The dashboard's other half: what the site TAKES, what it TRACKS, and whether the page still says the
 * same thing the code does.
 *
 * The reason this suite exists is narrow and specific. Every number on the dashboard used to be typed
 * into public/gamify.js by hand, and by the time anyone checked, five of the daily caps were wrong, the
 * Send Call X-ladder was overstated by 8.5x at the top rung, the per-action ceiling was quoted at nearly
 * seven times its real value, and the beta badge was missing from the boost stack entirely. None of that
 * was caught by a test, because no test compared the two.
 *
 * So this suite compares them. It asserts that the server SHIPS its constants, that the client READS them
 * rather than keeping a copy, and that no stale figure has crept back into any served page.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, SERVER_JS } from './_paths.mjs';

const SRC = readFileSync(SERVER_JS, 'utf8');
const P = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const GAMIFY = P('gamify.js'), ABOUT = P('about.html'), CSS = P('styles.css');
const SENDCALL = P('sendcall.js'), COMMUNITY = P('community.js'), COMMUNITIES = P('communities.html');
const WP = readFileSync(path.join(ROOT, 'WHITEPAPER.html'), 'utf8');
const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

try {
  /* ═══════════ 1. the server ships its rulebook ═══════════
     Every constant the dashboard prints has to travel with the payload. A number the client remembers is
     a number that will eventually be wrong. */
  {
    const g = SRC.match(/function gamifySummary\(u\) \{[\s\S]*?\n\}/);
    check('EXTRACT gamifySummary', !!g);
    const src = g ? g[0] : '';
    for (const k of ['dailyCap: DAILY_CAP', 'socialDayCap: SOCIAL_DAY_CAP', 'eventCap: PTS_EVENT_CAP',
                     'socialSpentToday', 'holdFloorUsd: MIN_HOLD_USD', 'callXFirst: PTS.call_x',
                     'callXStep: CALL_X_STEP', 'callBudget: CALL_POINTS_CAP', 'communityMult: COMMUNITY_MULT',
                     'betaBadgeMult: BETA_BADGE_MULT', 'appealEmail: APPEAL_EMAIL',
                     'commXp: COMM_XP', 'convXp: CONV_XP', 'convDailyCap: CONV_DAILY_CAP',
                     'readOnlyAllowed: READONLY_ALLOWED', 'readOnlyBlocked: READONLY_BLOCKED',
                     'callSpamMin: CALL_SPAM_MIN'])
      check('rules ships ' + k.split(':')[0], src.includes(k));
    for (const k of ['boost: effectiveMult(u.id)', 'restriction: restrictionOf(u)', 'probation: probationOf(u)',
                     'strikes: u.strikes', 'decay: decayState(u)', 'beta: betaState(u)', 'rugPenalty: RUG_PENALTY'])
      check('payload ships ' + k.split(':')[0], src.includes(k));
  }

  /* ═══════════ 2. the client reads them instead of remembering ═══════════ */
  {
    check('client: daily caps come from the payload, not a string', /rules\.dailyCap\[k\]/.test(GAMIFY));
    check('client: no hand-typed "/day" cap survives in the quest copy', !/Capped \d+\/day|Up to \d+\/day/.test(GAMIFY));
    check('client: the X ladder is computed from callXFirst/callXStep', /rules\.callXFirst[\s\S]{0,400}?first \* \(1 \+ \(m - 1\) \* step\)/.test(GAMIFY));
    // the served COPY, not the code comments that explain why it changed
    const copyOnly = (f) => f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    check('client: no served copy still promises the old multiplicative ladder',
      !/\+8,500|2x → \+340|3x → \+510/.test(copyOnly(GAMIFY) + copyOnly(SENDCALL) + ABOUT));
    check('client: the per-action ceiling is the server\'s, not 500,000', /rules\.eventCap/.test(GAMIFY) && !/Math\.min\(500000/.test(GAMIFY));
    check('client: the rolling 24h ceiling is rendered with what has been spent', /socialSpentToday/.test(GAMIFY) && /Rolling 24h ceiling/.test(GAMIFY));
    check('client: the boost total is the server\'s number', /g\.boost && g\.boost\.total > 0\) \? g\.boost\.total/.test(GAMIFY));
    check('client: the beta badge is in the stack it used to be missing from', /g\.boost && g\.boost\.beta > 1/.test(GAMIFY) && /Beta badge/.test(GAMIFY));
    check('client: the read-only lists come from the server, with no local copy',
      /rules\.readOnlyAllowed/.test(GAMIFY) && /rules\.readOnlyBlocked/.test(GAMIFY) && !/'Customizing your wall'\]/.test(GAMIFY));
  }

  /* ═══════════ 3. the REKT section exists and covers every way to lose ═══════════ */
  {
    for (const [name, re] of [
      ['decay', /function decayCard\(g\)/], ['read-only', /function restrictCard\(g\)/],
      ['revocations', /function revokeCard\(g\)/], ['call penalties', /function callRiskCard\(g\)/],
      ['the participation gate', /function gateCard\(g\)/], ['the beta reset', /function betaCard\(g\)/],
    ]) check('rekt: a card for ' + name, re.test(GAMIFY));
    check('rekt: it is rendered, not defined and forgotten', /rektBlock\(g\) \+/.test(GAMIFY));
    check('rekt: it is NOT hidden behind a <details>', !/<details[^>]*>[\s\S]{0,200}rektBlock/.test(GAMIFY));
    check('rekt: the free appeal route is offered alongside the buy-out', /appeal to a person at/.test(GAMIFY));
    check('rekt: the beta reset is stated before it happens', /every balance on the site goes to zero/.test(GAMIFY));
    check('rekt: the $100 floor is named per coin', /under the \$' \+ floor \+ ' floor/.test(GAMIFY));
    check('record: everything tracked gets a row', /function recordBlock\(g\)/.test(GAMIFY) && /recordBlock\(g\) \+/.test(GAMIFY));
  }

  /* ═══════════ 4. risk is never colour alone ═══════════
     A red border that means "this is costing you" is invisible to a reader who cannot separate red from
     green, to a monochrome display, and to print. Every risk row carries a glyph and words as well. */
  {
    check('a11y: risk rows carry a glyph, not just a hue', /rekt-dot/.test(CSS) && /aria-hidden="true">▲/.test(GAMIFY));
    check('a11y: the record tiles carry a border position as well as a colour', /\.rec-ok\s*\{ border-left-color/.test(CSS));
    check('a11y: the strike ladder names the rung you are on in words', /you are here/.test(GAMIFY));
    check('a11y: a high-contrast preference is honoured', /@media \(prefers-contrast: more\)/.test(CSS));
    check('a11y: the XP table can scroll without the page scrolling sideways', /\.gxp-table-wrap \{ [^}]*overflow-x: auto/.test(CSS));
    check('a11y: name/value pairs are a real definition list', /<dl class="rec-grid">/.test(GAMIFY) && /<dt class="rec-k">/.test(GAMIFY));
  }

  /* ═══════════ 5. the rocket-cursor namespace is not re-entered ═══════════
     public/rocketize.js owns every `.rk-*` class. The REKT section originally used `.rk-card`, `.rk-p`
     and friends, and `.rk-p` is the cursor's PARTICLE — `position: fixed` — so a paragraph of decay copy
     was torn out of its card and flung to the top-left of the page. */
  {
    const rocket = ['rk-on', 'rk-layer', 'rk-cursor', 'rk-p', 'rk-trail', 'rk-burst'];
    for (const c of rocket) check('cursor namespace: gamify.js does not use .' + c, !new RegExp('[\'"\\s.]' + c + '[\'"\\s]').test(GAMIFY));
    check('cursor namespace: .rk-p is still the cursor particle', /\.rk-p \{ position: fixed/.test(CSS));
    check('rekt uses its own prefix', /\.rekt-card \{/.test(CSS));
  }

  /* ═══════════ 6. no stale figure survives in anything a user can read ═══════════ */
  {
    const served = GAMIFY + ABOUT + SENDCALL + COMMUNITY + COMMUNITIES;
    check('$25 community/OG floor is gone from every served page', !/at least \$25|least <b>\$25<\/b>/.test(served), (served.match(/\$25\b/g) || []).length);
    check('$25 is gone from the whitepaper and README too', !/at least \$25/.test(WP + README));
    /* DAILY_CAP really is a rolling 24h window, so "rolling 24 hours" is correct where it describes THAT.
       The claim being hunted here is the different one: that a CHECK-IN is judged on a rolling window. It
       is judged on the UTC calendar day, and a doc that says otherwise costs someone a day of protection. */
    check('no page still claims the CHECK-IN is judged on a rolling window',
      !/check.?in[^.]{0,50}(inside|within) the last 24 hours/i.test(served + WP + README));
    check('no page still claims there is no appeal route',
      !/there(’s| is| was)? no appeal route and/i.test(served + WP + README));
    check('the free appeal address is given where a restricted account will see it', /GWCRH@atomicmail\.io/.test(ABOUT) && /appealEmail/.test(SRC));
    check('the decay sweep batch is stated as 500, not 200', !/takes up to \*\*200\*\*/.test(README));
    check('conviction is not described as accruing over time', !/conviction[^.]{0,60}(rises|climbs) the longer/i.test(served));
    check('going live is described as verified slots, not taps of Join', /verified holder slots/.test(served));
  }

  /* ═══════════ 7. the forecast and the charge are one function ═══════════ */
  {
    check('decayReasons exists and is shared', /function decayReasons\(u, showedUp, streak\)/.test(SRC));
    check('decayUser calls it rather than repeating the arithmetic', /const d = decayReasons\(u, showedUp, streak\);/.test(SRC));
    check('decayState calls the same one', /function decayState\(u\)[\s\S]{0,400}?decayReasons\(u, showedUp, streak\)/.test(SRC));
    check('the rates are declared exactly once', (SRC.match(/DECAY\.BASE_PCT \+ \(streak/g) || []).length === 1);
  }

  /* ═══════════ 8. the read-only promise matches the routes ═══════════
     The blocked list is shown to a restricted account AS A PROMISE. It had nine entries while
     blockReadOnly guarded twenty routes, so it promised that Rocket Run, communities, proposals, profile
     edits and uploads were unaffected — all of which are refused. */
  {
    const blocked = SRC.match(/const READONLY_BLOCKED = \[[\s\S]*?\];/);
    check('EXTRACT READONLY_BLOCKED', !!blocked);
    const b = blocked ? blocked[0] : '';
    for (const item of ['Playing Rocket Run', 'Minting a Data API key', 'Editing your profile',
                        'Uploading images or video', 'Starting, joining or posting in a community',
                        'Creating or voting on proposals'])
      check('blocked list names: ' + item, b.includes(item));
    const sites = (SRC.match(/blockReadOnly\(res, me\)\) return;/g) || []).length;
    check('blockReadOnly still guards the routes the list describes', sites >= 20, sites + ' call sites');
    check('the check-in is deliberately NOT among them', /\/api\/checkin[\s\S]{0,400}?rateLimit\('checkin:/.test(SRC) && !/\/api\/checkin[\s\S]{0,200}?blockReadOnly/.test(SRC));
  }

  /* ═══════════ 9. a dollar floor never silently becomes a dust floor ═══════════
     holdsToken raised `need` to the dollar equivalent only when a price was in hand, and otherwise left it
     at OG_DUST_WEI — so with an unreadable community price, a slot the whole site calls "$100 of the
     token" was satisfied by 1e-9 of it, and with it the go-live count and the flat 10x. */
  {
    check('holdsToken refuses to decide without a price', /if \(minUsd > 0\) \{\s*\n\s*if \(!\(priceUsd > 0\)\) return null;/.test(SRC));
    check('the revocation sweep treats undecided as "leave them alone"', /if \(holds === null\) continue;/.test(SRC));
    check('the join path says which one it is', /if \(holds === null\) return bad\(res,[\s\S]{0,160}?Nothing has been decided/.test(SRC));
    check('the posting path does too', /if \(holdsP === null\) return bad\(res,[\s\S]{0,160}?Nothing has been decided/.test(SRC));
    check('starting a community does too', /if \(holdsC === null\) return bad\(res,[\s\S]{0,200}?Nothing has been decided/.test(SRC));
  }

  /* ═══════════ 10. losses are in the ledger the user can read ═══════════ */
  {
    check('the Loot Log keeps the negative rows it used to discard',
      /filter\(x => x\.total !== 0\)/.test(GAMIFY) && /const losses = all\.filter\(x => x\.total < 0\)/.test(GAMIFY));
    check('losses get their own list', /loot-losses/.test(GAMIFY) && /Taken back/.test(GAMIFY));
    check('a negative day is signed and coloured as a loss', /const signed = \(v\)/.test(GAMIFY) && /kpi-dn/.test(GAMIFY));
    check('a negative day does not sit in a gain-coloured chip', /\.pc-today\.is-down \{[^}]*background: rgba\(255,93,93/.test(CSS));
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join('\n'));
}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
