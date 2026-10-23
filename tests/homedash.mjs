/* ===== The Mission Control hero (owner, 2026-10-23) =====
   "Redo the landing Hero so its more of a fun dashboard that shows the users at first glance everything on the landing
   page so users can easily access all the info and have long text as drop downs for those sections on the landing
   dashboard." The hero's top is the identity band (the mark, the words, the four buttons, the New-here drop-down); under
   it, Mission Control: twelve tiles, one per thing on the page, each with a one-line glance, the live reading where there
   is one, a More drop-down holding the long read, and one way in. Source-checked, no server: the page is static and every
   rule here is mechanical. The browser side (the grid at 320–1920, the rows, the keyboard) was walked in headless Chrome. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

try {
  const I = read('index.html'), CSS = read('styles.css'), HOME = read('home.js'), APP = read('app.js'), TOUR = read('tour.js'), EGGS = read('eggs.js'), ABOUT = read('about.html');
  const hero = I.slice(I.indexOf('<header class="hero hero-dash">'), I.indexOf('</header>'));
  const dashAt = hero.indexOf('<section class="dash"');
  const dash = hero.slice(dashAt, hero.indexOf('</section>', dashAt));
  const tiles = [...dash.matchAll(/<article class="dash-tile ([^"]*)" id="(dash-[a-z]+)"([^>]*)>([\s\S]*?)<\/article>/g)].map((m) => ({ cls: m[1], id: m[2], attrs: m[3], body: m[4] }));

  /* ═══ 1. the dashboard: twelve tiles, every section and every quick path, in this order ═══ */
  const ORDER = ['dash-send', 'dash-gwc', 'dash-guide', 'dash-swap', 'dash-beta', 'dash-og', 'dash-rocketize', 'dash-watch', 'dash-wall', 'dash-tracker', 'dash-communities', 'dash-origin'];
  check('the hero holds Mission Control, labelled by its own heading, with twelve tiles in page order: the two coins, the guide, the swap, the beta, the OG badge, Rocketize, the video, the Wall, the tracker, the communities, the $GWC/OG-site cards',
    /<section class="dash" aria-labelledby="dash-title">\s*<h2 class="dash-title" id="dash-title">/.test(dash) && tiles.map((t) => t.id).join() === ORDER.join(), tiles.map((t) => t.id).join());
  const bad = tiles.filter((t) => !((t.body.match(/class="btn btn-ghost btn-sm dash-go"/g) || []).length === 1 && (t.body.match(/<details class="dash-more">/g) || []).length === 1
    && t.body.indexOf('<div class="dash-foot">') < t.body.indexOf('<details class="dash-more">') && /<summary data-tip="[^"]+">More<\/summary>\s*<div class="dash-more-body">\s*<p>/.test(t.body)
    && /<div class="dash-head">\s*<span class="dash-ico" aria-hidden="true">/.test(t.body) && /<h3 class="dash-name">/.test(t.body) && /<div class="dash-glance">/.test(t.body))).map((t) => t.id);
  check('  ...each tile: a head (icon, h3 name), a glance, then one action block — the way in first, the More drop-down (a native details, a described summary, a long read) beside it', tiles.length === 12 && !bad.length, bad.join());
  const WAY = { 'dash-send': ['a', '/tokens'], 'dash-gwc': ['a', '/tokens'], 'dash-guide': ['a', '/guide'], 'dash-swap': ['a', '/swap'], 'dash-beta': ['a', '/beta'], 'dash-og': ['a', '/about#og-rules'], 'dash-rocketize': ['a', '/rocketize'], 'dash-watch': ['button', 'watch'], 'dash-wall': ['a', '/wall'], 'dash-tracker': ['a', '/tracker'], 'dash-communities': ['a', '/communities'], 'dash-origin': ['button', 'origin'] };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wrongWay = tiles.filter((t) => { const [tag, to] = WAY[t.id] || []; if (!tag) return true; const re = tag === 'a' ? new RegExp('<a class="btn btn-ghost btn-sm dash-go" href="' + esc(to) + '" data-tip="[^"]+">') : new RegExp('<button class="btn btn-ghost btn-sm dash-go" type="button" data-jump="' + to + '" data-tip="[^"]+">'); return !re.test(t.body); }).map((t) => t.id);
  check('  ...the way in is the section\'s own address where it has one (/tokens, /guide, /swap, /beta, /rocketize), the page for the Wall, the tracker, the communities and the OG rules, and a jump button for the video and the $GWC/OG-site cards', !wrongWay.length, wrongWay.join());
  check('  ...and every jump lands on an id the page has (the video section; the cards\' section, which gained one)', /<section class="alt-bg" id="watch">/.test(I) && /<section id="origin">\s*<div class="origin-pair">/.test(I));
  check('  ...the video tile is marked data-needs-video, and app.js hides it with the video\'s section on a deploy without the file',
    /<article class="dash-tile is-watch" id="dash-watch" data-needs-video>/.test(I) && /if \(media\.video === false\) \{[^\n]*document\.querySelectorAll\('\[data-needs-video\]'\)\.forEach\(el => \{ el\.hidden = true; \}\);/.test(APP));

  /* ═══ 2. the readings: the ids the sections' scripts write, once each, never a figure of the page's own ═══ */
  const once = (id) => (I.match(new RegExp('id="' + id + '"', 'g')) || []).length === 1;
  check('the two coin tiles carry the market-cap readings by the ids home.js writes (label, value, delta, source line, banner), each once on the page, and both start as a dash, not a number',
    ['mcap-label-SEND', 'mcap-value-SEND', 'mcap-delta-SEND', 'mcap-sub-SEND', 'mcap-banner-SEND', 'mcap-label-GWC', 'mcap-value-GWC', 'mcap-delta-GWC', 'mcap-sub-GWC', 'mcap-banner-GWC', 'mcap-a11y'].every(once)
    && /<span class="mcap-value" id="mcap-value-SEND">\$———<\/span>/.test(I) && /<span class="mcap-value" id="mcap-value-GWC">\$———<\/span>/.test(I) && (I.match(/\$———/g) || []).length === 2);
  check('  ...home.js labels the reading "Market cap · live" (or FDV when that is all there is) — the tile\'s own name says which coin; the old panel buttons are gone', /lbl\.textContent = hasMc \? 'Market cap · live' : 'FDV \(fully diluted\) · live';/.test(HOME) && !/data-mcap-jump|mcap-panel/.test(HOME + I + CSS));
  check('the swap tile shows the ETH price the swap\'s quotes are priced in, from the same pair reading (ETH/USD = priceUsd ÷ priceNative), hidden until read',
    /<span class="dash-sub" id="dash-eth" hidden><\/span>/.test(I) && /const ethEl = document\.getElementById\('dash-eth'\);\s*if \(ethEl && lastEthUsd\) \{ ethEl\.textContent = '1 ETH ≈ ' \+ fmtUsd\(Math\.round\(lastEthUsd\)\) \+ \(ethFresh \? ' right now' : ' · last reading'\); ethEl\.hidden = false; \}/.test(HOME));
  check('the beta tile\'s clock and leader are written by the beta code from its one /api/beta reading (the clock text is the section\'s; the leader is the top of the same list, a link to their wall)',
    /<span class="dash-big" id="dash-beta-count">—<\/span>/.test(I) && /<span class="dash-sub" id="dash-beta-lead">reading the board…<\/span>/.test(I)
    && /const dashCount = document\.getElementById\('dash-beta-count'\), dashLead = document\.getElementById\('dash-beta-lead'\);/.test(HOME) && /count\.textContent = text;\s*if \(dashCount\) dashCount\.textContent = text;/.test(HOME)
    && /if \(dashLead\) dashLead\.innerHTML = \(j\.top \|\| \[\]\)\.length\s*\? '🥇 <a href="\/u\/' \+ encodeURIComponent\(j\.top\[0\]\.username\) \+ '">@' \+ esc\(j\.top\[0\]\.username\) \+ '<\/a> leads with ' \+ Number\(j\.top\[0\]\.points \|\| 0\)\.toLocaleString\('en-US'\) \+ ' Send Power'/.test(HOME)
    && /if \(dashLead\) dashLead\.textContent = 'Board unavailable right now\.';/.test(HOME));
  check('the OG tile\'s clock is a third [data-og-deadline] the strip\'s timer code already fills, with the open tier\'s name in .og-tier-label',
    /<span class="dash-k"><span class="og-tier-label">this window<\/span> closes in<\/span>\s*<span class="dash-big" data-og-deadline="" data-og-window="current">—<\/span>/.test(I)
    && (dash.match(/data-og-window="current"/g) || []).length === 1 && (I.match(/data-og-window="current"/g) || []).length === 3);   // one on the tile, two in the strip (tests/chrome.mjs counts those inside the strip)
  check('  ...and the tile follows the strip\'s states: closed → the chip says closed and the label stops counting (home.js), red in the last three days and dim once closed (CSS on the same elements the strip\'s timer marks)',
    /const tile = document\.getElementById\('dash-og'\);\s*if \(tile && loaded\) \{\s*tile\.classList\.toggle\('is-over', allClosed\);\s*const chip = tile\.querySelector\('\.dash-live > span'\); if \(chip\) chip\.textContent = allClosed \? 'closed' : 'live';\s*const k = tile\.querySelector\('\.dash-k'\); if \(k && allClosed\) k\.textContent = 'every window has closed';/.test(HOME)
    && /\.dash-glance\.og-timer-soon \.dash-big \{ color: var\(--red\);/.test(CSS) && /\.dash-big\.og-timer-closed \{ color: var\(--text-dim\); text-shadow: none; \}/.test(CSS)
    && /\.dash-tile\.is-over \.dash-live i \{ animation: none; background: var\(--text-mute\); \}/.test(CSS));
  check('  ...and its way in is painted by paintCta with the strip\'s own call (rules signed out, the wallet check signed in, the badge once OG), so one screen never shows two different calls',
    /const tgo = document\.querySelector\('#dash-og \.dash-go'\);\s*if \(tgo\) \{ tgo\.textContent = text \+ '\\u00a0→'; tgo\.setAttribute\('href', href\); tgo\.setAttribute\('data-tip', tail\); \}/.test(HOME));
  check('the beta tile\'s label stops saying "resets in" once the moment has passed, and its chip says final (and goes quiet) once the board is settled, like the section\'s',
    /const k = document\.querySelector\('#dash-beta \.dash-k'\); if \(k\) k\.textContent = left <= 0 \? 'Beta ended · Send Power' : 'Beta ends · Send Power resets in';/.test(HOME)
    && /const tile = document\.getElementById\('dash-beta'\);\s*if \(tile\) \{ tile\.classList\.toggle\('is-over', settled\); const chip = tile\.querySelector\('\.dash-live > span'\); if \(chip\) chip\.textContent = settled \? 'final' : 'live'; \}/.test(HOME));
  check('the swap tile says "right now" only on a pass that read an ETH price; a failed poll turns an earlier reading into "last reading"',
    /let ethFresh = false;/.test(HOME) && /\{ lastEthUsd = Number\(p\.priceUsd\) \/ Number\(p\.priceNative\); ethFresh = true; \}/.test(HOME) && /\(ethFresh \? ' right now' : ' · last reading'\)/.test(HOME)
    && /if \(ethEl && !ethEl\.hidden\) ethEl\.textContent = ethEl\.textContent\.replace\(' right now', ' · last reading'\);/.test(HOME));
  check('the tour\'s re-measure timers cannot throw after the tour has been ended (positionAll guards the spot and the tip, not only the target)', /function positionAll\(target\) \{\s*if \(!target \|\| !spot \|\| !tip\) return;/.test(TOUR));
  check('the jump buttons scroll to and focus the section through the same go() a section link uses, and leave the address alone',
    /document\.addEventListener\('click', \(e\) => \{\s*const b = e\.target\.closest && e\.target\.closest\('button\[data-jump\]'\); if \(!b\) return;\s*go\(b\.dataset\.jump, true, true\);\s*\}\);/.test(HOME));

  /* ═══ 3. the identity band keeps every hook the scripts, the eggs and the tour reach for ═══ */
  const seq = ['<header class="hero hero-dash">', '<button type="button" class="hero-logo-btn"', '<h1 class="display">Just $Send It! <span class="rocket">🚀</span></h1>', '<p class="tag">', '<p class="hero-lede">', '<div class="hero-chips">', '<div class="rh-badge"><span class="dot"></span>', '<a class="risk-chip" href="/guide">', '<div class="hero-actions">', '<div class="cta-row">', '<section class="dash"', '<div class="dash-grid">', '<details class="reassure">', '<span class="sr-only" role="status" aria-live="polite" id="mcap-a11y">'].map((s) => I.indexOf(s));
  check('the home header is .hero.hero-dash; in order: the logo button, the h1 with its rocket, the tag, the lede, the chips (the LIVE dot, the risk chip), the actions row (the four buttons), then the dashboard with the New-here drop-down at its foot', seq.every((p, i) => p >= 0 && (i === 0 || p > seq[i - 1])) && (I.match(/<details class="reassure">/g) || []).length === 1, seq.join());
  const cat = EGGS.match(/const CATALOG = \[[\s\S]*?\n  \];/)[0];
  const idxEggs = [...cat.matchAll(/\[\d+, "index\.html", "(?:taps|hold|dwell)\('([^']+)'/g)].map((m) => m[1]);
  // each selector resolved for what it really names (a last-token search was satisfied by any <span> or <summary> on the page);
  // a new egg on this page has to be added here, or the check fails it as unknown
  const slice = (from, to) => { const a = I.indexOf(from); return a < 0 ? '' : I.slice(a, to ? I.indexOf(to, a) : undefined); };
  const floats = slice('<span class="hero-floats"', '</span>\n  </span>'), ticker = slice('<div class="ticker-track">', '</div>'), confetti = slice('<span class="og-confetti"', '</span></span>');
  const EGG_HAS = {
    '.hero-logo-btn': () => /<button type="button" class="hero-logo-btn"/.test(hero),
    '.hero h1 .rocket': () => /<h1 class="display">[^\n]*<span class="rocket">/.test(hero),
    '.ticker-track span:nth-child(6)': () => (ticker.match(/<span>/g) || []).length >= 6,
    '.hero-floats span:nth-child(7)': () => (floats.match(/<span class="float-emoji/g) || []).length >= 7,
    '.hero-floats span:nth-child(4)': () => (floats.match(/<span class="float-emoji/g) || []).length >= 4,
    '.og-confetti span:last-child': () => (confetti.match(/<span>/g) || []).length >= 1,
    '.rh-badge .dot': () => /<div class="rh-badge"><span class="dot"><\/span>/.test(hero),
    'details.reassure summary': () => /<details class="reassure">\s*<summary>/.test(hero),
    '#watch .section-title': () => /class="section-title/.test(slice('<section class="alt-bg" id="watch">', '</section>')),
    '#emblem-SEND': () => I.includes('id="emblem-SEND"'),
    '.beta-k': () => /class="beta-k"/.test(slice('<section id="beta"', '</section>')),
    '#guide .step-num': () => /class="step-num"/.test(slice('<section id="guide">', '</section>')),
  };
  const missingEgg = idxEggs.filter((sel) => !(EGG_HAS[sel] && EGG_HAS[sel]()));
  check('every egg hunted on the home page still has its element, each selector resolved for what it names (' + idxEggs.length + ' selectors)', idxEggs.length >= 12 && !missingEgg.length, missingEgg.join(' | '));
  check('  ...and the two float-field eggs (the 4th and 7th glyphs) are reachable on a laptop: between 1200 and 1599px the rails are pinned to the column\'s edge, and the field is hidden only under 1200px',
    /@media \(min-width: 1200px\) and \(max-width: 1599px\) \{\s*\.hero-floats \.float-emoji:nth-child\(1\), [^{]*:nth-child\(4\),[^{]*:nth-child\(11\) \{ left: calc\(\(100% - 1040px\) \/ 2 - 2\.8rem\) !important; \}\s*\.hero-floats \.float-emoji:nth-child\(2\), [^{]*:nth-child\(7\),[^{]*:nth-child\(12\) \{ right: calc\(\(100% - 1040px\) \/ 2 - 2\.8rem\) !important; \}/.test(CSS)
    && /@media \(max-width: 1199px\) \{\s*\.hero-dash \.float-emoji \{ display: none; \}\s*\}/.test(CSS) && !/@media \(max-width: 1499px\) \{\s*\.float-emoji/.test(CSS));
  check('  ...the float field keeps its twelve glyphs (eggs 16 and 17 count on the 4th and the 7th)', (hero.match(/<span class="float-emoji/g) || []).length === 12);
  check('the tour points at the $SEND tile and the Wall tile, both of which exist', /\{ sel: '#dash-send', title: 'This number is alive 📈'/.test(TOUR) && /\{ sel: '#dash-wall', title: 'Meet the Send Wall 🧱'/.test(TOUR) && I.includes('id="dash-send"') && I.includes('id="dash-wall"'));
  check('the quick-path cards under the old hero are gone from the home page (their destinations are tiles now); the About page keeps its own', !/What you can do here|do-grid|do-card/.test(I) && /<div class="do-grid">/.test(ABOUT) && /\.do-card \{/.test(CSS));
  check('the lede, which the SEO pass pins word for word, is unchanged', /<p class="hero-lede">Just Send It \(sendrh\.com\) is an independent community site for \$SEND, the SEND IT memecoin, and \$GWC on Robinhood Chain\. Entertainment only, not affiliated with Robinhood\.<\/p>/.test(hero));

  /* ═══ 4. the words ═══ */
  const dashText = dash.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
  check('nothing on the dashboard tells anyone to buy, promises safety, or states a dollar figure of its own (the readings arrive from the scripts; the only figures in the copy are the sections\' facts)',
    !/\b(buy now|should buy|guaranteed|never hacked|100% safe|safe investment|to the moon)\b/i.test(dashText) && !/\$\d/.test(dashText) && /not a reason to buy/.test(dashText));
  check('the tiles say what the pages they point at say: posting on the Wall takes the holder check too, the tracker lists the transactions that moved a token, the 10× is a verified holder\'s, and the X account is the community\'s, not $GWC\'s',
    /Reading is open to anyone\. Posting takes a free account and a read-only wallet check that you hold \$SEND — the rule is on the About page\./.test(dash) && /Every transaction that moved a token is listed, with filters/.test(dash)
    && /a verified holder in a live one earns a flat 10× on their points/.test(dash) && !/joining a live one adds/.test(dash) && /GenerationalWealthCoin\.com and its Telegram, the community X account — and JustSendItCoin\.com/.test(dash) && !/its Telegram and X\b/.test(dash));
  check('  ...and the prose that names the drop-down (the README row, Sendy\'s site map, the comments) uses the word on the summaries', /a \*\*More\*\* drop‑down/.test(readFileSync(path.join(ROOT, 'README.md'), 'utf8')) && /a More drop-down holding the long read/.test(readFileSync(path.join(ROOT, 'server.js'), 'utf8')) && /a More drop-down holding the long read/.test(I) && !/Details drop-down/.test(I + CSS));
  check('the long reads are drop-downs: twelve More summaries, none open by default; the New-here read is closed too', (dash.match(/<details class="dash-more">/g) || []).length === 12 && !/<details class="dash-more" open/.test(dash) && !/<details class="reassure" open/.test(hero));

  /* ═══ 5. the styles ═══ */
  check('the home hero is as tall as what it holds and its column is the 1040px .wrap; the shared .hero (About\'s poster) keeps its 88vh, its 340px mark and its float field under 1100px',
    /\.hero\.hero-dash \{ min-height: 0; justify-content: flex-start;/.test(CSS) && /\.hero-dash > \.hero-content \{ width: 100%; max-width: 1040px;/.test(CSS) && /\.hero-dash \.hero-logo \{ width: min\(220px, 56vw\); \}/.test(CSS)
    && /\.hero \{\s*position: relative; min-height: 88vh;/.test(CSS) && /\.hero-logo \{\s*width: min\(340px, 68vw\);/.test(CSS) && /@media \(max-width: 1099px\) \{\s*\.float-emoji \{ display: none; \}\s*\}/.test(CSS)
    && /<header class="hero about-hero">/.test(ABOUT) && !/hero-dash/.test(ABOUT));
  check('the dashboard is a <section> without the page\'s section padding, two columns from 560px and one below', /\.dash \{ width: 100%; padding: 0; text-align: left; \}/.test(CSS) && /\.dash-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/.test(CSS) && /@media \(max-width: 559px\) \{ \.dash-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(CSS));
  check('  ...each tile is a container: the big readings are sized by the tile (cqi), floored like all text, with a floored fallback first for an engine without cqi',
    /\.dash-tile \{[\s\S]*?container-type: inline-size;/.test(CSS) && /\.dash-big \{[^}]*font-size: max\(var\(--text-floor\), 2rem\); font-size: max\(var\(--text-floor\), clamp\(1\.1rem, 11cqi, 2\.4rem\)\)/.test(CSS)
    && /\.dash-tile \.mcap-value \{ font-size: max\(var\(--text-floor\), 2rem\); font-size: max\(var\(--text-floor\), clamp\(1\.1rem, 12cqi, 2\.6rem\)\);/.test(CSS));
  check('  ...the phone and narrow-pair paddings come after the base rule (an earlier equal-weight rule lost the tie), the narrowest pairs stop floating the foot so the button can span, the LIVE word is never clipped, and the More pill stays 44px',
    (() => { const base = CSS.indexOf('.dash-tile {\n  --tile:'); return base > 0 && CSS.indexOf('@media (max-width: 559px) { .dash-tile { padding:') > base && CSS.indexOf('@media (min-width: 560px) and (max-width: 639px) { .dash-tile { padding:') > base; })()
    && /@container \(max-width: 230px\) \{\s*\.dash-ico \{[^}]*\}\s*\.dash-foot \{ float: none; margin-right: 0; \}\s*\.dash-go \{ width: 100%;[^}]*\}\s*\}/.test(CSS) && !/\.dash-live > span \{ position: absolute/.test(CSS) && !/\.dash-more > summary \{ min-height: 36px/.test(CSS));
  check('  ...while a read is open the tiles keep their own heights (:has), the banner behind a coin tile is dimmer and its source line is --text-dim (the lettering under it measured 3.9:1 with --text-mute), and every arrow is tied to its label',
    /\.dash-grid:has\(\.dash-more\[open\]\) \{ align-items: start; \}/.test(CSS) && /\.dash-tile > \.mcap-banner \{[^}]*opacity: 0\.22; \}/.test(CSS) && /\.dash-tile\.is-token \.mcap-sub \{ color: var\(--text-dim\); \}/.test(CSS)
    && (dash.match(/&nbsp;[↓→]<\/(a|button)>/g) || []).length === 12 && !/ [↓→]<\/(a|button)>/.test(dash) && /tgo\.textContent = text \+ '\\u00a0→';/.test(HOME));
  check('  ...on a phone the four buttons are a 2×2, not a stack', /@media \(max-width: 559px\) \{\s*\.hero-actions \.cta-row \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/.test(CSS));
  check('  ...the way in floats at the left of the action block and the More pill takes its line; the opened read clears both (full width, no script)', /\.dash-act \{ display: flow-root; margin-top: auto; \}/.test(CSS) && /\.dash-foot \{ float: left;/.test(CSS) && /\.dash-more-body \{ clear: both;/.test(CSS));
  check('  ...the summary is a pill on the control ladder with a drawn chevron and a visible focus ring; the native marker is hidden',
    /\.dash-more > summary \{[\s\S]*?background: var\(--ctl-fill-lo\); border: 1\.5px solid var\(--ctl-fill-lo\); color: var\(--ctl-ink\);/.test(CSS) && /\.dash-more > summary::after \{ content: '▾'; \}/.test(CSS) && /\.dash-more\[open\] > summary::after \{ content: '▴'; \}/.test(CSS)
    && /\.dash-more > summary:focus-visible \{ outline: 3px solid var\(--focus\);/.test(CSS) && /\.dash-more > summary::-webkit-details-marker \{ display: none; \}/.test(CSS));
  check('  ...the live dots pause with the ⏸ switch and under reduced motion, which also stops the tile lift',
    /html\.motion-off \.dash-live i,/.test(CSS) && /@media \(prefers-reduced-motion: reduce\) \{\s*\.dash-tile, \.dash-ico, \.dash-more > summary \{ transition: none; \}\s*\.dash-tile:hover, \.dash-tile:hover \.dash-ico \{ transform: none; \}\s*\.dash-live i \{ animation: none; \}/.test(CSS));
  check('  ...from 1000px the band is a grid: the mark beside the words, the actions across both, the four buttons on one line (805px of words at the floor; at 900–999px they wrapped), every rule scoped to the band so About\'s hero is untouched',
    /@media \(min-width: 1000px\) \{[\s\S]*?\.hero-top \{ display: grid; grid-template-columns: auto minmax\(0, 1fr\);[\s\S]*?\.hero-actions \{ grid-column: 1 \/ -1;[\s\S]*?\.hero-top \.hero-logo \{ width: 200px; \}\s*\.hero-top h1 \{[\s\S]*?\.hero-actions \.cta-row \.btn \{ padding: 0\.75rem 1rem; \}\s*\}/.test(CSS)
    && !/@media \(min-width: 900px\) \{[\s\S]{0,400}\.hero-top/.test(CSS) && !/\n  \.hero h1 \{ margin-top: 0;/.test(CSS) && !/\n  \.hero-logo \{ width: 200px; \}/.test(CSS));
  check('Sendy\'s site map and the README say the home page opens with Mission Control', /\/ — home: Mission Control at the top \(a dashboard:/.test(readFileSync(path.join(ROOT, 'server.js'), 'utf8')) && /\| \*\*🛸 Mission Control \(the hero\)\*\* \|/.test(readFileSync(path.join(ROOT, 'README.md'), 'utf8')));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
