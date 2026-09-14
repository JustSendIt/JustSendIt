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
const WL = readFileSync(path.join(ROOT, 'public', 'watchlist.js'), 'utf8');
/* newpairs.js with its comments removed. Several fixes here are explained by quoting the code they
   replaced, so a "this is gone" assertion has to read the source, not the story about the source. */
const NP_CODE = NP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
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
      /activeFilterCount\(f\) === 0\) return clearsSiteBar\(p\)/.test(NP));
    check('  ...and the site\'s own bar is a named predicate, testable in one place',
      /function clearsSiteBar\(p\) \{[\s\S]{0,220}?!thinData\(p\)[\s\S]{0,160}?sniperOk\(p\)/.test(NP));
    check('four things can never be waived by any setting', /const VERDICT_FLOOR = \['honeypotSuspect', 'dumping', 'sniperDump'\]/.test(NP) && /triageOf\(p\) === 'avoid'\) return true/.test(NP));
    check('  ...and no strategy can turn them off', !/hide: \{[^}]*honeypotSuspect: false/.test(NP));
    /* ONE RULE: A FULL 100 EARNS THE ROCKET.
       The tag used to need more than the score — readable data, the risk model's top tier and a finished
       block-0 scan — so on a board whose explorer is unreachable every 100 fell through to the milder
       tag. Measured at the time: three tokens scored 100 and not one wore the rocket. The score is the
       whole rule now, and the floor is the only thing that can take it away. */
    check('every token scoring a full 100 earns the rocket',
      /if \(health >= 100 && !floorBreached\(p\)\) \{/.test(NP)
      && /ico: '🚀', word: 'Looks Good, Send It'/.test(NP));
    check('  ...and the score is the whole of the rule — no data or block-0 gate on top of it',
      /const earnsSendIt = \(p\) => healthOfP\(p\) >= 100 && !floorBreached\(p\);/.test(NP));
    check('  ...but the floor still takes it away at any score',
      /health >= 100 && !floorBreached\(p\)/.test(NP) && /const VERDICT_FLOOR = \['honeypotSuspect', 'dumping', 'sniperDump'\]/.test(NP));
    check('  ...and the reason says what a 100 does and does not mean',
      /score this a full 100 out of 100[\s\S]{0,140}?not a promise, and it is not the same as safe/.test(NP));
    check('the Hot Feed can never show what the tag would not',
      /const feedQualifies = \(p\) => earnsSendIt\(p\) && \(!readerBarLive\(\) \|\| meetsYourBar\(p\)\);/.test(NP));
    check('  ...while still narrowing to the reader\'s own settings when they set any',
      /!readerBarLive\(\) \|\| meetsYourBar\(p\)/.test(NP));

    check('the site\'s own bar keeps the rocket and its caveat', /word: 'Looks Good, Send It'[\s\S]{0,200}?most new tokens still go to zero/.test(NP));
    /* Both indicators read GREEN. A different hue for the same sentence only said "yours counts for
       less", and colour was never carrying the attribution anyway — it reaches neither a screen reader,
       nor a colour-blind reader, nor forced-colours mode. Pinned so the split is not reintroduced as if
       it were a safeguard. */
    check('both bars read the same green, since colour never carried the claim',
      /\.np-verdict\.np-t-yours \{[^}]*var\(--green-bright\)/.test(CSS)
      && /\.np-verdict\.np-t-perfect \{[^}]*var\(--green-bright\)/.test(CSS)
      && !/\.np-t-yours[^}]*var\(--diamond\)/.test(CSS));
    check('  ...including the detail heading, which is the only verdict text off the scanner page',
      /\.np-why-h \.np-verdict-word\.np-t-perfect, \.np-why-h \.np-verdict-word\.np-t-yours \{/.test(CSS));

    /* "Why WE say" is the site endorsing. It may only appear over the site's own bar — and this heading
       renders ONLY when flags.length is truthy, so without the split it would have printed the site's
       endorsement directly above a list of warnings the site itself raised. */
    check('only the site says "Why we say"', /T\.yours \? 'Why your settings say ' : 'Why we say '/.test(NP));
    check('  ...which matters because that heading is the only verdict text off the scanner page',
      /window\.NPCard = \{/.test(NP) && /detailHTML:/.test(NP));
    check('the feed slide repaints its spoken line, not just its chip', /np-slide-sr'\); if \(srSlide\) srSlide\.textContent = srLine\(p\)/.test(NP));
    check('the watchlist awards the same words on the same test', /h >= 100 && sniperOk\) return \{ cls: 'np-t-ok np-t-perfect'/.test(WL));
    check('the server mirror stays the site\'s bar alone', /It has no second bar and must not grow one/.test(SRC));
    /* The feed's own copy has to say which bar it is following, and an empty feed has to say WHY —
       "check back soon" is the wrong answer when the real one is "your filter excluded everything". */
    check('  ...and the feed says whose bar it is showing', /The fresh tokens that clear <b>your<\/b> settings/.test(NP) && /judged against your filters rather than ours/.test(NP));
    check('  ...and an empty feed blames the right thing', /Nothing on the board clears your settings right now/.test(NP));
  }

  /* ═══════════ 5. pressing a strategy shows the settings move ═══════════ */
  {
    check('the settings are written BEFORE anything animates', /state\.filters = already \? defaultFilters\(\) : strategyFilters\(id\);\s*\n\s*syncControls\(\);/.test(NP));
    check('the controls it changed are marked', /function markChanged\(before, after\)/.test(NP) && /np-f-moved/.test(CSS));
    check('  ...and the mark carries a WORD, not just a colour', /\.np-f-moved::after \{\s*\n?\s*content: 'changed'/.test(CSS));
    check('  ...which survives reduced motion', /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]{0,200}?npMoved/.test(CSS));
    check('the panel opens so the reader can fine-tune from there', /if \(panel && panel\.hidden && !already && window\.npSetFiltersOpen\)/.test(NP));
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

  /* ═══════════ 6b. the settings open as a pop-down, and close four ways ═══════════
     It used to be an inline block: opening it shoved the whole list down the page, and on a panel this
     tall the rows you were reading vanished underneath it. */
  {
    check('the panel floats over the list instead of pushing it', /\.np-filters \{\s*\n\s*position: absolute;/.test(CSS));
    check('  ...and scrolls inside itself rather than growing without limit', /max-height: min\(70vh, 620px\); overflow-y: auto/.test(CSS));
    check('  ...and sits above the sticky controls row', /\.np-controls \{ position: sticky[^}]*z-index: 30/.test(CSS) && /\.np-filters \{[\s\S]{0,120}?z-index: 45/.test(CSS));
    check('it is announced as a dialog with a name', /role="dialog"[^>]*aria-labelledby="np-fhead-title"/.test(HTML) && /id="np-fhead-title"/.test(HTML));
    check('there is a visible close button', /id="np-fclose"[^>]*aria-label="Close scanner settings"/.test(HTML));
    for (const [route, re] of [
      ['the ✕', /fclose\.addEventListener\('click', \(\) => setFiltersOpen\(false, true\)\)/],
      ['Escape', /e\.key !== 'Escape' && e\.key !== 'Esc'\)\) return;[\s\S]{0,200}?setFiltersOpen\(false, true\)/],
      ['a tap outside', /backdrop\.addEventListener\('click', \(\) => setFiltersOpen\(false, true\)\)/],
      ['the trigger again', /more\.addEventListener\('click', \(\) => setFiltersOpen\(filters\.hidden, true\)\)/],
    ]) check('  ...closable by ' + route, re.test(NP));
    check('closing hands focus back to the trigger, never to <body>', /else if \(refocus\) \{ try \{ more\.focus\(\); \} catch \{\} \}/.test(NP));
    check('opening moves focus into the panel so it is announced', /h\.focus\(\{ preventScroll: true \}\)/.test(NP));
    check('the backdrop is shown and hidden with the panel', /if \(backdrop\) backdrop\.hidden = !open;/.test(NP));
    check('on a phone it becomes a bottom sheet rather than a tall box in a narrow column',
      /@media \(max-width: 760px\) \{[\s\S]{0,400}?position: fixed; left: 0; right: 0; bottom: 0/.test(CSS));
    check('a strategy opens it through the same opener, so focus and backdrop follow',
      /window\.npSetFiltersOpen\(true, false\)/.test(NP) && !/panel\.hidden = false; if \(more\)/.test(NP));
  }

  /* ═══════════ 6c. the panel's own buttons are reachable ═══════════
     Measured with the panel open and scrolled to its end: the footer sat at 805–849 while #music-player
     held 788–849 (z 250) and #compose-fab 799–850 (z 240), against the panel's z 45. Save and Reset were
     not near the pinned controls, they were UNDER them. Two fixes: the panel reserves that strip, and both
     actions also sit in the sticky header so neither needs a scroll to the end of eight groups. */
  {
    // the strip the pinned controls own is declared once, not re-derived per rule
    check('the pinned-control clearance is a single token', /--fab-clear: calc\(5\.5rem \+ env\(safe-area-inset-bottom, 0px\)\);/.test(CSS));
    check('  ...and the page footer uses that token rather than its own copy', /footer \{\s*\n\s*padding-bottom: var\(--fab-clear\);/.test(CSS));
    check('the pop-down reserves the strip so its footer clears the pinned controls',
      /\.np-filters \{[\s\S]{0,700}?padding-bottom: calc\(0\.7rem \+ var\(--fab-clear\)\);/.test(CSS));
    check('  ...and so does the phone bottom sheet, which is pinned to the same edge',
      /@media \(max-width: 760px\) \{[\s\S]{0,700}?padding-bottom: calc\(0\.7rem \+ var\(--fab-clear\)\);/.test(CSS));
    check('  ...and the footer is not left below the panel stacking floor', /\.np-filters-foot \{ position: relative; z-index: 1; \}/.test(CSS));

    check('Save is offered at the top of the panel as well as the bottom',
      /id="np-savenow-top"/.test(HTML) && /id="np-savenow"/.test(HTML));
    check('Reset is offered at the top of the panel as well as the bottom',
      /id="np-reset-top"/.test(HTML) && /id="np-reset"/.test(HTML));
    check('  ...both inside the sticky header, so they stay in reach while scrolling',
      /class="np-fhead"[\s\S]{0,600}?id="np-savenow-top"[\s\S]{0,200}?id="np-reset-top"/.test(HTML));
    check('  ...and the header pair is laid out, not stacked on the title',
      /\.np-fhead-acts \{ display: flex;/.test(CSS));

    /* The event-as-argument bug again: saveCurrentView(host) handed straight to addEventListener receives
       the click Event as `host`, and the name box would open inside nothing. */
    check('neither Save button is handed the raw click event as its target',
      !/addEventListener\('click', saveCurrentView\)/.test(NP));
    check('  ...and the function guards the argument it is given anyway',
      /\(host && host\.nodeType === 1\) \? host : document\.querySelector\('\.np-filters-foot'\)/.test(NP));
    check('the name box opens where Save was pressed', /where\.appendChild\(form\)/.test(NP));
    check('  ...and only one is ever open', /forEach\(f => \{ if \(f\.parentElement !== where\) f\.remove\(\); \}\)/.test(NP));
    check('Escape out of the name box does not also shut the panel',
      /e\.preventDefault\(\); e\.stopPropagation\(\); done\(false\)/.test(NP));
    check('Reset says it happened, since from the header the cleared controls are off-screen',
      /sendToast\('Filters reset/.test(NP) && /announce\('Filters reset\./.test(NP));
  }

  /* ═══════════ 6d. the Hot Feed: what it shows, and whether you can get to it ═══════════
     Three complaints, one audit, and largely one root cause — the card was taller than the box it was
     given, inside a scroller that was itself taller than the screen. */
  {
    /* THE DATA. patchFeedSlide walked querySelectorAll('.np-slide-stats b')[0..3] while slideHTML laid out
       FIVE cells in a different order, so every poll wrote liquidity under "Market cap", volume under
       "Liquidity", holders under "Volume 24h" and a percentage under "Holders" — and never touched "Top
       wallet". `stats.length >= 4` passed at 5, so it was silent. */
    check('the feed stats are keyed, never positional', /const b = el\.querySelector\('\.np-slide-stats \[data-k="' \+ c\.k \+ '"\] b'\)/.test(NP));
    check('  ...and one table drives both the render and the repaint',
      /function statCells\(p\)/.test(NP) && /const statsHTML = \(p\) =>/.test(NP) && /function patchStats\(el, p\)/.test(NP));
    /* Against CODE only. The comment that replaced this bug quotes the old guard verbatim to explain it,
       and an assertion that reads prose as source has fooled this suite more than once. */
    check('  ...so the positional walk is gone for good',
      !/querySelectorAll\('\.np-slide-stats b'\)/.test(NP_CODE) && !/stats\.length >= 4/.test(NP_CODE));
    check('  ...and every cell the table declares is repainted, "Top wallet" included',
      (NP.match(/\{ k: '(mc|liq|vol|holders|top)'/g) || []).length === 5);
    check('a reading we could not take says so, rather than showing a dash beside real figures',
      /'not read yet'/.test(NP) && /\.np-slide-stats b\.dim \{/.test(CSS));

    /* AGE. The one number on a freshness feed that was nailed to build time — and the sr-only line WAS
       being repainted with the fresh value, so the two disagreed about the same card. */
    check('age is repainted, not frozen at build time', /el\.querySelector\('\.np-slide-age'\)/.test(NP) && /npFmtAge\(p\.pair\.ageMinutes\)/.test(NP));
    check('  ...by name, so the async community slot beside it survives', !/np-slide-sub'\)[^\n]*innerHTML/.test(NP));
    check('  ...and the index status with it', /el\.querySelector\('\.np-slide-indexed'\)/.test(NP));

    /* THE SCROLLING. .np-feed is a <section>, so `section { padding: 4.2rem 1.25rem }` handed the scroller
       134px of dead height and took 40px off every card. These two must stay together: the track's
       height: 100% resolves against the shell's CONTENT box. */
    check('the track scrolls and the shell only positions',
      /\.np-feed \{ position: relative; padding: 0; overflow: hidden;/.test(CSS)
      && /\.np-feed-track \{ height: 100%; overflow-y: auto;/.test(CSS));
    check('  ...so the pinned chrome stops scrolling away with the cards', /\.np-feed-track \{[^}]*scroll-snap-type: y mandatory/.test(CSS));
    check('the card is no longer a scroll dead-end',
      !/\.np-slide-inner \{[^}]*overscroll-behavior: contain/.test(CSS)
      && /\.np-feed-track \{[^}]*overscroll-behavior: contain/.test(CSS));
    check('  ...and is never overflow:hidden, which would hide the honesty line rather than scroll it',
      !/\.np-slide-inner \{[^}]*overflow: hidden/.test(CSS));
    check('flipping a card moves the feed, not the document',
      /function scrollFeedTo\(el, smooth\)/.test(NP) && !/scrollToSlide\(i\)[^\n]*scrollIntoView/.test(NP));
    check('  ...and the active-slide observer watches the element that actually scrolls',
      /root: feedTrack \|\| feedEl/.test(NP));
    check('reduced motion follows the scroller', /prefers-reduced-motion: reduce\) \{ \.np-feed-track \{ scroll-behavior: auto/.test(CSS));

    /* THE FIT. The strategy row and the body's FAB reserve were the last of the page scroll that let the
       page creep behind a feed sized for a whole viewport. */
    check('feed mode hides the strategy row that pushed it below the fold',
      /body\.np-mode-feed #np-strategies/.test(CSS) && /body\.np-mode-feed #np-strat-note/.test(CSS));
    check('  ...and the page stops reserving a strip below a feed with nothing under it',
      /body\.np-mode-feed \{ padding-bottom: 0; \}/.test(CSS));
    check('the action rail no longer covers the card — or the honesty line',
      /\.np-slide-rail \{ position: absolute; right: 0\.6rem; bottom: 0\.6rem;/.test(CSS)
      && !/\.np-slide-rail \{[^}]*var\(--fab-clear\)/.test(CSS));
    check('  ...and the strip it occupies is reserved by the slide, so the card cannot grow into it',
      /\.np-slide \{ padding-bottom: calc\(0\.6rem \+ 46px \+ 0\.6rem\); \}/.test(CSS));
    check('the prev/next pair leaves the rail\'s column and only shows where there is a gutter',
      /\.np-feed-nav \{ position: absolute; left: 0\.6rem/.test(CSS)
      && /@media \(hover: hover\) and \(min-width: 700px\) \{ \.np-feed-nav \{ display: flex; \} \}/.test(CSS));
    check('  ...replacing the blanket hide that left touch readers no forward control at all',
      !/@media \(hover: none\) \{ \.np-feed-nav \{ display: none; \} \}/.test(CSS));
    /* --fab-clear is a deliberate single-token invariant elsewhere; the rail stopping using it must not
       take the token or its other call sites with it. */
    check('the shared clearance token and its other users are untouched',
      /--fab-clear: calc\(5\.5rem/.test(CSS) && /padding-bottom: var\(--fab-clear\)/.test(CSS));
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
