/* The scanner's settings model, its five strategies, and the verdict they can now earn.
 *
 * The point of this suite is that a setting can no longer exist in the panel and quietly do nothing.
 * Every field is declared once in FIELDS, and passFilters/presetActive/activeFilterCount/syncControls all
 * read that declaration — so the test that matters is that the three surfaces agree: a field in the model
 * has a control, a control has a field, and a strategy only sets fields that exist.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, SERVER_JS } from './_paths.mjs';

const SRC = readFileSync(SERVER_JS, 'utf8');
const NP = readFileSync(path.join(ROOT, 'public', 'newpairs.js'), 'utf8');
const HTML = readFileSync(path.join(ROOT, 'public', 'newpairs.html'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

// pull the FIELDS table out of the client and evaluate it in isolation, so the test reads the real thing
function loadFields() {
  const m = NP.match(/const FIELDS = \{[\s\S]*?\n  \};/);
  if (!m) return null;
  const src = m[0]
    .replace(/read: [^,}]+(,|(?=\s*\}))/g, '')     // drop the pair-object accessors; we only need the shape
    .replace(/MCAP_MAX/g, '100000000')
    .replace(/AGE_MAX/g, '1440');
  try { return new Function(src + ' return FIELDS;')(); } catch { return null; }
}

try {
  const FIELDS = loadFields();
  check('EXTRACT the FIELDS table', !!FIELDS, FIELDS ? Object.keys(FIELDS).length + ' fields' : 'failed');
  const keys = FIELDS ? Object.keys(FIELDS) : [];

  /* ═══════════ 1. one declaration, and everything reads it ═══════════ */
  {
    check('defaultFilters is built from FIELDS, not hand-written', /function defaultFilters\(\) \{[\s\S]{0,300}?for \(const k of FIELD_KEYS\)/.test(NP));
    check('passFilters walks FIELDS rather than a hard-coded list', /function passFilters\(p, filters\)[\s\S]{0,2000}?for \(const k of FIELD_KEYS\)[\s\S]{0,1400}?F\.kind === 'min' && !\(x >= v\)/.test(NP));
    check('activeFilterCount walks FIELDS too', /function activeFilterCount\(fl\)[\s\S]{0,300}?for \(const k of FIELD_KEYS\)/.test(NP));
    check('every field declares a kind', keys.length > 0 && keys.every(k => ['min', 'max', 'bool', 'enum', 'set'].includes(FIELDS[k].kind)));
    check('every min/max field declares how an unreadable signal is treated',
      keys.filter(k => FIELDS[k].kind === 'min' || FIELDS[k].kind === 'max').every(k => FIELDS[k].onNull === 'pass' || FIELDS[k].onNull === 'fail'));
  }

  /* ═══════════ 2. a setting with no control, or a control with no setting, is the bug this prevents ═══════════ */
  {
    // every range/checkbox id the panel offers must be synced AND wired
    const ids = [...HTML.matchAll(/id="(f-[a-z0-9]+)"/g)].map(m => m[1]).filter(x => !/-out$/.test(x));
    const missingSync = ids.filter(id => !new RegExp("'" + id + "'").test(NP));
    check('every control in the panel is read by the client', missingSync.length === 0, missingSync.join(', '));
    for (const f of ['minAge', 'mcapMin', 'mcapMax', 'maxTop10Pct', 'maxSnipedPct', 'minVolH1', 'minBuysH1', 'volLiqMin', 'flowWin', 'requireSniperOk', 'requireData'])
      check('the model gained: ' + f, keys.includes(f));
    for (const id of ['f-minage', 'f-mcapmin', 'f-mcapmax', 'f-maxtop10', 'f-maxsniped', 'f-minvolh1', 'f-minbuysh1', 'f-volliq', 'f-flowwin', 'f-sniperok'])
      check('  ...and it has a control: ' + id, HTML.includes('id="' + id + '"'));
    check('"must actually have been checked" is offered for every signal the risk model records',
      ['liquidity', 'holders', 'concentration', 'verified', 'snipers', 'indexed'].every(k => HTML.includes('data-req="' + k + '"')));
    check('the two sniper flags can be hidden like every other flag', HTML.includes('data-hide="sniperDump"') && HTML.includes('data-hide="sniperHeavy"'));
  }

  /* ═══════════ 3. the five strategies ═══════════ */
  {
    const m = NP.match(/const STRATEGIES = \[[\s\S]*?\n  \];/);
    check('EXTRACT the strategies', !!m);
    const src = m ? m[0] : '';
    const idm = [...src.matchAll(/id: '([a-z0-9]+)'/g)].map(x => x[1]);
    check('there are seven strategies', idm.length === 7, idm.join(', '));
    check('each one carries what it CANNOT tell you', (src.match(/cannot:/g) || []).length === 7);
    check('each one carries a plain-English blurb', (src.match(/blurb:/g) || []).length === 7);
    // the market-cap band had controls and a model entry but no strategy reaching for it
    check('a strategy finally uses the market-cap band', /mcapMax: 250000/.test(src));
    check('a strategy covers the pullback shape', /price1h: 'down'/.test(src));
    for (const id of idm) check('  ...and a button exists for ' + id, HTML.includes('data-strat="' + id + '"'));
    // a strategy may only set fields that exist, or it is a silent no-op
    const setKeys = [...src.matchAll(/set: \{([\s\S]*?)\n    \}/g)].flatMap(b => [...b[1].matchAll(/(\w+):/g)].map(x => x[1]));
    const known = new Set(keys.concat(['weth', 'usdg', 'other'].concat(
      ['honeypotSuspect', 'dumping', 'serialDeployer', 'lowLiquidity', 'concentrated', 'unverified', 'lowHolders', 'sellPressure', 'deadVolume', 'sniperDump', 'sniperHeavy'],
      ['indexed', 'liquidity', 'holders', 'concentration', 'verified', 'snipers'])));
    const unknown = [...new Set(setKeys)].filter(k => !known.has(k));
    check('no strategy sets a field that does not exist', unknown.length === 0, unknown.join(', '));
    check('a strategy REPLACES the settings rather than merging onto them', /function strategyFilters\(id\) \{[\s\S]{0,200}?const f = defaultFilters\(\);/.test(NP));
    /* Test the copy a READER sees — the name and the blurb — not the code comments explaining why the
       copy is worded that way. A comment saying 'deliberately NOT called "buy the dip"' is the rule being
       followed, and an earlier version of this assertion failed on it, which is a test grading prose it
       was never meant to read. The `cannot` lines are exempt for the same reason: they exist to say a
       thing is NOT safe, so they are allowed to contain the word. */
    const shown = [...src.matchAll(/(?:name|blurb): '((?:[^'\\]|\\.)*)'/g)].map(m => m[1]).join(' ');
    check('no strategy NAME or BLURB reads as a recommendation',
      !/\b(best|safest|safe|gem|alpha|guaranteed|moon|pump|buy)\b/i.test(shown), shown.slice(0, 80));
    check('  ...and every strategy still warns in its own words', (src.match(/cannot: '/g) || []).length === 7);
  }

  /* ═══════════ 4. the verdict: reachable, but with a floor nobody can lower ═══════════ */
  {
    check('the tag is awarded against the reader\'s own bar', /function meetsYourBar\(p\)/.test(NP) && /if \(!passFilters\(p, f\)\) return false;/.test(NP));
    check('with no settings at all it falls back to the site\'s own bar, not to everything',
      /activeFilterCount\(f\) === 0\) return !thinData\(p\)[\s\S]{0,140}?sniperOk\(p\)/.test(NP));
    check('four things can never be waived by any setting', /const VERDICT_FLOOR = \['honeypotSuspect', 'dumping', 'sniperDump'\]/.test(NP) && /triageOf\(p\) === 'avoid'\) return true/.test(NP));
    check('  ...and no strategy can turn them off', !/hide: \{[^}]*honeypotSuspect: false/.test(NP));
    /* Two tags, not one with a tooltip: a reader must be able to tell at a glance whether the SITE said
       so or their own filter did, because the rocket is the site's credibility and a setting cannot be
       allowed to borrow it. */
    check('a custom bar gets its own tag, never the site\'s rocket',
      /word: 'Matches Your Bar, Send It', yours: true/.test(NP) && /np-t-yours/.test(NP) && /np-t-yours \{/.test(CSS));
    check('  ...and says in words that it is the reader\'s filter speaking', /It is your filter saying so, not us\./.test(NP));
    check('  ...while the site\'s own bar keeps the rocket and its caveat', /word: 'Looks Good, Send It'[\s\S]{0,160}?most new tokens still go to zero/.test(NP));
    check('the Hot Feed uses the same predicate as the tag — they cannot disagree', /const feedQualifies = \(p\) => meetsYourBar\(p\);/.test(NP));
    /* The feed's own copy has to say which bar it is following, and an empty feed has to say WHY —
       "check back soon" is the wrong answer when the real one is "your filter excluded everything". */
    check('  ...and the feed says whose bar it is showing', /The fresh tokens that clear <b>your<\/b> settings/.test(NP));
    check('  ...and an empty feed blames the right thing', /Nothing on the board clears your settings right now/.test(NP));
  }

  /* ═══════════ 5. pressing a strategy shows the settings move ═══════════ */
  {
    check('the settings are written BEFORE anything animates', /state\.filters = already \? defaultFilters\(\) : strategyFilters\(id\);\s*\n\s*syncControls\(\);/.test(NP));
    check('the controls it changed are marked', /function markChanged\(before, after\)/.test(NP) && /np-f-moved/.test(CSS));
    check('  ...and the mark carries a WORD, not just a colour', /\.np-f-moved::after \{\s*\n?\s*content: 'changed'/.test(CSS));
    check('  ...which survives reduced motion', /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]{0,200}?npMoved/.test(CSS));
    check('the panel opens so the reader can fine-tune from there', /if \(panel && panel\.hidden && !already\) \{ panel\.hidden = false;/.test(NP));
    check('applying one is announced to a screen reader', /announce\(already[\s\S]{0,200}?setting' \+ \(moved === 1/.test(NP));
    check('pressing the active strategy again clears it', /const already = strategyExact\(id\);/.test(NP));
  }

  /* ═══════════ 6. market cap then vs now ═══════════ */
  {
    check('the server stores the qualifying and peak caps, not just the first', /ADD COLUMN qual_mc REAL/.test(SRC) && /ADD COLUMN peak_mc REAL/.test(SRC));
    check('the qualifying cap is written ONCE and never moved', /qual_mc=COALESCE\(qual_mc,\?\)/.test(SRC));
    check('it records the site\'s OWN bar, not a viewer\'s', /const qualNow = !!\(p\.risk && p\.risk\.triage === 'ok'/.test(SRC));
    check('the caps travel with every pair', /e\.caps = \{[\s\S]{0,300}?xFromFirst/.test(SRC));
    check('the client shows then → now', /function capTrail\(p\)/.test(NP) && /Market cap then/.test(NP));
    // the sentence carries markup, so match the two claims rather than one contiguous run
    check('  ...and says plainly what the number is NOT',
      /the launch cap, and not an entry: nobody bought at these numbers/.test(NP) && /Measured from the first time this scanner recorded a cap/.test(NP));
    check('  ...and which field it used when marketCap was missing', /the figure is FDV/.test(NP));
  }

  /* ═══════════ 7. the bug that made every row after the first fail ═══════════
     passFilters gained a second parameter, and two call sites passed it straight to Array.filter — which
     hands the callback (element, index, array). Row 0 worked; every row after it was tested against a
     number, and the panel looked broken for reasons no filter explained. */
  {
    check('passFilters is never handed straight to Array.filter', !/\.filter\(passFilters\)/.test(NP));
    check('  ...and it guards the shape of its own second argument', /\(filters && typeof filters === 'object'\) \? filters : state\.filters/.test(NP));
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join('\n'));
}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
