/* ===== The landing page: Mission Control and the $SEND-only page (owner, 2026-10-23; redone 2026-11-17) =====
   2026-10-23: "Redo the landing Hero so its more of a fun dashboard that shows the users at first glance everything on the
   landing page". 2026-11-17: "Take the whole landing index page content and redo it so it's super high tech, the wording is
   not redundant and too lengthy. Make sure everything is quick to understand for users and remove anything mentioning GWC on
   the landing page. Keep the landing page focused on Send."
   So: the hero's top is the identity band (the mark, the words, the four buttons); under it, Mission Control — the live $SEND
   reading across the top, then one tile per section or page, each a name, one line or a live reading, and one way in (the long
   reads the tiles used to fold are the sections themselves now, so nothing is said twice). The look is its own layer,
   public/landing.css, scoped to body.lp. Source-checked, no server: the page is static and every rule here is mechanical.
   tests/landing.mjs loads the page in a real browser (320–1920px, the grid, the targets, the words on screen). */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

try {
  const I = read('index.html'), CSS = read('styles.css'), LP = read('landing.css'), RESP = read('responsive.css'), HOME = read('home.js'), CHAIN = read('chain.js'), APP = read('app.js'), TOUR = read('tour.js'), EGGS = read('eggs.js'), ABOUT = read('about.html'), SENDY = read('sendy.js');
  const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8'), SERVER = readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const hero = I.slice(I.indexOf('<header class="hero hero-dash">'), I.indexOf('</header>'));
  const dashAt = hero.indexOf('<section class="dash"');
  const dash = hero.slice(dashAt, hero.indexOf('</section>', dashAt));
  const tiles = [...dash.matchAll(/<article class="dash-tile ([^"]*)" id="(dash-[a-z]+)"([^>]*)>([\s\S]*?)<\/article>/g)].map((m) => ({ cls: m[1], id: m[2], attrs: m[3], body: m[4] }));
  const text = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
  const pages = readdirSync(PUB).filter((f) => f.endsWith('.html'));

  /* ═══ 1. about $SEND: no $GWC anywhere on the landing page, its scripts or its tour ═══ */
  const gwc = /\bgwc\b|generational/i;
  check('no $GWC or Generational Wealth Coin anywhere in index.html — the head (title, description, Open Graph, the JSON-LD), the tape, the body, the footer, the comments', !gwc.test(I), (I.match(/.{0,40}(gwc|generational).{0,40}/i) || [''])[0]);
  check('  ...nor in what the page\'s scripts write into it: home.js reads, quotes and announces $SEND only (no coin picker, no OG strip), and chain.js fills only the cards the page has',
    !gwc.test(HOME) && !/og-banner|data-og-deadline|choice-|pickSwap/.test(HOME) && /for \(const key of \['SEND'\]\) \{\s*const p = pairs\[key\];/.test(HOME) && /const swapPick = 'SEND';/.test(HOME) && /const TAX_BPS = \{ SEND: 100 \};/.test(HOME)
    && /const keys = Object\.keys\(TOKENS\)\.filter\(k => document\.getElementById\('price-' \+ k\)\);\s*if \(!keys\.length\) return;/.test(CHAIN));
  check('  ...nor in the tour that walks this page, nor in Sendy\'s how-to-buy answer (the swap is $SEND\'s)', !gwc.test(TOUR) && /swap it into \$SEND on the swap \(\/swap\)/.test(SENDY) && !/\$SEND or \$GWC on the swap/.test(SENDY));
  check('  ...the page\'s one coin entity is $SEND (SEND IT), with the address the page shows; the page is about the site and $SEND',
    /"@id": "https:\/\/sendrh\.com\/#send"/.test(I) && !/#gwc/.test(I) && /"about": \[\{ "@id": "https:\/\/sendrh\.com\/#organization" \}, \{ "@id": "https:\/\/sendrh\.com\/#send" \}\]/.test(I));
  check('  ...and the parts that only made sense with both coins are gone: the OG strip and tile (a badge for holding both), the $GWC card, the "Powered by" section and its Telegram link, the coin picker',
    !/og-banner|og-confetti|data-og-deadline|id="dash-og"|id="dash-gwc"|id="dash-origin"|id="origin"|origin-pair|gwc-hero|t\.me\/|choice-GWC|choice-SEND|swap-choice/.test(I));

  /* ═══ 2. Mission Control: the $SEND reading, then nine tiles ═══ */
  const ORDER = ['dash-send', 'dash-swap', 'dash-guide', 'dash-beta', 'dash-rocketize', 'dash-watch', 'dash-wall', 'dash-tracker', 'dash-scanner', 'dash-communities'];
  check('the hero holds Mission Control, labelled by its own heading: the $SEND reading, then the swap, the guide, the beta, Rocketize, the video, the Wall, the tracker, the Scanner and the communities',
    /<section class="dash" aria-labelledby="dash-title">\s*<h2 class="dash-title" id="dash-title">/.test(dash) && tiles.map((t) => t.id).join() === ORDER.join(), tiles.map((t) => t.id).join());
  const bad = tiles.filter((t) => !((t.body.match(/class="btn btn-ghost btn-sm dash-go"/g) || []).length === 1 && !/<details/.test(t.body)
    && /<div class="dash-head">\s*<span class="dash-ico" aria-hidden="true">/.test(t.body) && /<h3 class="dash-name">[^<]+<span class="dash-name-sub">[^<]+<\/span><\/h3>/.test(t.body) && /<div class="dash-glance">/.test(t.body)
    && /<div class="dash-act">\s*<div class="dash-foot">/.test(t.body))).map((t) => t.id);
  check('  ...each tile: a head (icon, a name with a one-line sub), a glance, and one way in — no drop-down: the long read is the section itself, so nothing is said twice', tiles.length === 10 && !bad.length, bad.join());
  const WAY = { 'dash-send': ['a', '/tokens'], 'dash-swap': ['a', '/swap'], 'dash-guide': ['a', '/guide'], 'dash-beta': ['a', '/beta'], 'dash-rocketize': ['a', '/rocketize'], 'dash-watch': ['button', 'watch'], 'dash-wall': ['a', '/wall'], 'dash-tracker': ['a', '/tracker'], 'dash-scanner': ['a', '/newpairs'], 'dash-communities': ['a', '/communities'] };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wrongWay = tiles.filter((t) => { const [tag, to] = WAY[t.id] || []; if (!tag) return true; const re = tag === 'a' ? new RegExp('<a class="btn btn-ghost btn-sm dash-go" href="' + esc(to) + '" data-tip="[^"]+">') : new RegExp('<button class="btn btn-ghost btn-sm dash-go" type="button" data-jump="' + to + '" data-tip="[^"]+">'); return !re.test(t.body); }).map((t) => t.id);
  check('  ...the way in is the section\'s own address where it has one (/tokens, /swap, /guide, /beta, /rocketize), the page for the Wall, the tracker, the Scanner and the communities, and a jump button for the video', !wrongWay.length, wrongWay.join());
  check('  ...every arrow is tied to its label (a no-break space), ↓ for a section below and → for another page', (dash.match(/&nbsp;[↓→]<\/(a|button)>/g) || []).length === 10 && !/ [↓→]<\/(a|button)>/.test(dash));
  check('  ...the jump lands on an id the page has, and the video tile is marked data-needs-video (app.js hides it with the video\'s section on a deploy without the file)',
    /<section class="alt-bg" id="watch">/.test(I) && /<article class="dash-tile is-watch" id="dash-watch" data-needs-video>/.test(I)
    && /if \(media\.video === false\) \{[^\n]*document\.querySelectorAll\('\[data-needs-video\]'\)\.forEach\(el => \{ el\.hidden = true; \}\);/.test(APP));
  check('  ...the jump buttons scroll to and focus the section through the same go() a section link uses, and leave the address alone',
    /document\.addEventListener\('click', \(e\) => \{\s*const b = e\.target\.closest && e\.target\.closest\('button\[data-jump\]'\); if \(!b\) return;\s*go\(b\.dataset\.jump, true, true\);\s*\}\);/.test(HOME));

  /* ═══ 3. the readings: the ids the sections' scripts write, once each, never a figure of the page's own ═══ */
  const once = (id) => (I.match(new RegExp('id="' + id + '"', 'g')) || []).length === 1;
  check('the $SEND tile carries the market-cap reading by the ids home.js writes (label, value, delta, source line, banner), each once, starting as a dash, not a number',
    ['mcap-label-SEND', 'mcap-value-SEND', 'mcap-delta-SEND', 'mcap-sub-SEND', 'mcap-banner-SEND', 'mcap-a11y'].every(once)
    && /<span class="mcap-value" id="mcap-value-SEND">\$———<\/span>/.test(I) && (I.match(/\$———/g) || []).length === 1);
  check('  ...home.js labels it "Market cap · live" (or FDV when that is all there is)', /lbl\.textContent = hasMc \? 'Market cap · live' : 'FDV \(fully diluted\) · live';/.test(HOME));
  check('the swap tile shows the ETH price the swap\'s quotes are priced in, from the same pair reading (ETH/USD = priceUsd ÷ priceNative), hidden until read; "right now" only on a pass that read one',
    /<span class="dash-sub" id="dash-eth" hidden><\/span>/.test(I) && /const ethEl = document\.getElementById\('dash-eth'\);\s*if \(ethEl && lastEthUsd\) \{ ethEl\.textContent = '1 ETH ≈ ' \+ fmtUsd\(Math\.round\(lastEthUsd\)\) \+ \(ethFresh \? ' right now' : ' · last reading'\); ethEl\.hidden = false; \}/.test(HOME)
    && /let ethFresh = false;/.test(HOME) && /if \(ethEl && !ethEl\.hidden\) ethEl\.textContent = ethEl\.textContent\.replace\(' right now', ' · last reading'\);/.test(HOME));
  check('the beta tile\'s clock and leader are written by the beta code from its one /api/beta reading (the clock text is the section\'s; the leader is the top of the same list, a link to their wall)',
    /<span class="dash-big" id="dash-beta-count">—<\/span>/.test(I) && /<span class="dash-sub" id="dash-beta-lead">reading the board…<\/span>/.test(I)
    && /const dashCount = document\.getElementById\('dash-beta-count'\), dashLead = document\.getElementById\('dash-beta-lead'\);/.test(HOME) && /count\.textContent = text;\s*if \(dashCount\) dashCount\.textContent = text;/.test(HOME)
    && /if \(dashLead\) dashLead\.innerHTML = \(j\.top \|\| \[\]\)\.length\s*\? '🥇 <a href="\/u\/' \+ encodeURIComponent\(j\.top\[0\]\.username\) \+ '">@' \+ esc\(j\.top\[0\]\.username\) \+ '<\/a> leads with ' \+ Number\(j\.top\[0\]\.points \|\| 0\)\.toLocaleString\('en-US'\) \+ ' Send Power'/.test(HOME)
    && /if \(dashLead\) dashLead\.textContent = 'Board unavailable right now\.';/.test(HOME));
  check('  ...its label says "resets in" until the moment passes, and its chip says final (and goes quiet) once the board is settled, like the section\'s',
    /const k = document\.querySelector\('#dash-beta \.dash-k'\); if \(k\) k\.textContent = left <= 0 \? 'Beta ended · final board' : 'Send Power resets in';/.test(HOME) && /<span class="dash-k">Send Power resets in<\/span>/.test(I)
    && /const tile = document\.getElementById\('dash-beta'\);\s*if \(tile\) \{ tile\.classList\.toggle\('is-over', settled\); const chip = tile\.querySelector\('\.dash-live > span'\); if \(chip\) chip\.textContent = settled \? 'final' : 'live'; \}/.test(HOME));
  check('the tour\'s re-measure timers cannot throw after the tour has been ended (positionAll guards the spot and the tip, not only the target)', /function positionAll\(target\) \{\s*if \(!target \|\| !spot \|\| !tip\) return;/.test(TOUR));

  /* ═══ 4. the identity band keeps every hook the scripts, the eggs and the tour reach for ═══ */
  const seq = ['<header class="hero hero-dash">', '<button type="button" class="hero-logo-btn"', '<h1 class="display">Just $Send It! <span class="rocket">🚀</span></h1>', '<p class="tag">', '<p class="hero-lede">', '<div class="hero-chips">', '<div class="rh-badge"><span class="dot"></span>', '<a class="risk-chip" href="/guide">', '<div class="hero-actions">', '<div class="cta-row">', '<section class="dash"', '<div class="dash-grid">', '<details class="reassure">', '<span class="sr-only" role="status" aria-live="polite" id="mcap-a11y">'].map((s) => I.indexOf(s));
  check('the home header is .hero.hero-dash; in order: the logo button, the h1 with its rocket, the tag, the lede, the chips (the LIVE dot, the risk chip), the actions row, then the dashboard with the New-here drop-down at its foot', seq.every((p, i) => p >= 0 && (i === 0 || p > seq[i - 1])) && (I.match(/<details class="reassure">/g) || []).length === 1 && !/<details class="reassure" open/.test(I), seq.join());
  check('the lede — the one plain sentence on what the site is, which the SEO pass pins word for word — names $SEND alone', /<p class="hero-lede">Just Send It \(sendrh\.com\) is an independent community site for \$SEND, the SEND IT memecoin on Robinhood Chain\. Entertainment only, not affiliated with Robinhood\.<\/p>/.test(hero));
  const cat = EGGS.match(/const CATALOG = \[[\s\S]*?\n  \];/);
  const idxEggs = cat ? [...cat[0].matchAll(/\[\d+, "index\.html", "(?:taps|hold|dwell)\('([^']+)'/g)].map((m) => m[1]) : [];
  // each selector resolved for what it really names; a new egg on this page has to be added here, or the check fails it as unknown
  const slice = (from, to) => { const a = I.indexOf(from); return a < 0 ? '' : I.slice(a, to ? I.indexOf(to, a) : undefined); };
  const floats = slice('<span class="hero-floats"', '</span>\n  </span>'), ticker = slice('<div class="ticker-track">', '</div>');
  const tickerSpans = [...ticker.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]);
  const EGG_HAS = {
    '.hero-logo-btn': () => /<button type="button" class="hero-logo-btn"/.test(hero),
    '.hero h1 .rocket': () => /<h1 class="display">[^\n]*<span class="rocket">/.test(hero),
    '.ticker-track span:nth-child(6)': () => tickerSpans[5] === 'ENTERTAINMENT ONLY',   // egg 15's line is about this item
    '.hero-floats span:nth-child(7)': () => /🪙/.test((floats.match(/<span class="float-emoji[^>]*>[^<]*<\/span>/g) || [])[6] || ''),   // egg 16: the coin
    '.hero-floats span:nth-child(4)': () => /🚀/.test((floats.match(/<span class="float-emoji[^>]*>[^<]*<\/span>/g) || [])[3] || ''),   // egg 17: a rocket
    '.dash-title-ico': () => /<h2 class="dash-title" id="dash-title"><span class="dash-title-ico" aria-hidden="true">🛸<\/span>/.test(hero),   // egg 18: the saucer
    '.rh-badge .dot': () => /<div class="rh-badge"><span class="dot"><\/span>/.test(hero),
    'details.reassure summary': () => /<details class="reassure">\s*<summary>/.test(hero),
    '#watch .section-title': () => /class="section-title/.test(slice('<section class="alt-bg" id="watch">', '</section>')),
    '#emblem-SEND': () => I.includes('id="emblem-SEND"'),
    '.beta-k': () => /class="beta-k"/.test(slice('<section id="beta"', '</section>')),
    '#guide .step-num': () => /class="step-num"/.test(slice('<section id="guide">', '</section>')),
  };
  const missingEgg = idxEggs.filter((sel) => !(EGG_HAS[sel] && EGG_HAS[sel]()));
  check('every egg hunted on the home page still has its element, each selector resolved for what it names (' + idxEggs.length + ' selectors)', idxEggs.length >= 12 && !missingEgg.length, missingEgg.join(' | '));
  check('  ...the tape is six items twice (the loop scrolls by half), the sixth ENTERTAINMENT ONLY', tickerSpans.length === 12 && tickerSpans.slice(0, 6).join() === tickerSpans.slice(6).join(), tickerSpans.join(' / '));
  check('  ...the float field keeps its twelve glyphs, reachable on a laptop between 1200 and 1599px and hidden only under 1200px',
    (hero.match(/<span class="float-emoji/g) || []).length === 12
    && /@media \(min-width: 1200px\) and \(max-width: 1599px\) \{\s*\.hero-floats \.float-emoji:nth-child\(1\), [^{]*:nth-child\(4\),[^{]*:nth-child\(11\) \{ left: calc\(\(100% - 1040px\) \/ 2 - 2\.8rem\) !important; \}\s*\.hero-floats \.float-emoji:nth-child\(2\), [^{]*:nth-child\(7\),[^{]*:nth-child\(12\) \{ right: calc\(\(100% - 1040px\) \/ 2 - 2\.8rem\) !important; \}/.test(CSS)
    && /@media \(max-width: 1199px\) \{\s*\.hero-dash \.float-emoji \{ display: none; \}\s*\}/.test(CSS));
  check('the tour points at the $SEND tile and the Wall tile, both of which exist', /\{ sel: '#dash-send', title: 'This number is alive 📈'/.test(TOUR) && /\{ sel: '#dash-wall', title: 'Meet the Send Wall 🧱'/.test(TOUR) && I.includes('id="dash-send"') && I.includes('id="dash-wall"'));
  check('the quick-path cards under the old hero are gone from the home page; the About page keeps its own', !/What you can do here|do-grid|do-card/.test(I) && /<div class="do-grid">/.test(ABOUT) && /\.do-card \{/.test(CSS));

  /* ═══ 5. the words: short, plain, honest ═══ */
  const dashText = text(dash);
  check('nothing on the dashboard tells anyone to buy, promises safety, or states a dollar figure of its own (the readings arrive from the scripts)',
    !/\b(buy now|should buy|guaranteed|never hacked|100% safe|safe investment|to the moon)\b/i.test(dashText) && !/\$\d/.test(dashText));
  check('  ...and nowhere else on the page either: the hero\'s first button says Swap, not Buy', !/\b(buy now|should buy|guaranteed|never hacked|100% safe|safe investment|to the moon)\b/i.test(text(I)) && /<a class="btn btn-primary" href="\/swap" data-tip="[^"]+">Swap to \$SEND<\/a>/.test(I) && !/>Buy \$Send/.test(I));
  const lines = tiles.map((t) => text((t.body.match(/<p class="dash-line">([\s\S]*?)<\/p>/) || ['', ''])[1]).trim()).filter(Boolean);
  check('  ...every tile\'s line is one short sentence or two (at most 100 characters): a glance, not a read', lines.length >= 8 && lines.every((l) => l.length <= 100), lines.filter((l) => l.length > 100).join(' | '));
  // the gates are the server's (blockReadOnly → needsHolderProof): posting and tracking both wait behind the $SEND wallet check (0536742 put the Wall's on the page)
  check('the tiles say what the pages they point at say: anyone can read the Wall, posting and tracking take a free account and the $SEND wallet check, the 10× is a verified holder\'s in a live community',
    /Anyone can read it\. Posting takes a free account and a \$SEND wallet check\./.test(dashText) && /Any wallet's coins, value and PNL\. Takes a free account and a \$SEND wallet check\./.test(dashText)
    && /Live at 10 verified holders; then each verified holder in it earns a flat 10× on their points\./.test(dashText)
    && /with your free account and its \$SEND wallet check, track any wallet in the <a href="\/tracker">Wallet Tracker<\/a>/.test(I));
  check('the $SEND facts are said once on the card (the tax, the contract; the pool is in the card\'s own sub) — the long tokenomics paragraph under the cards is gone',
    /<dl class="lp-spec">\s*<div><dt>Tax<\/dt><dd>1% on every buy, sell and transfer, all of it added to the liquidity pool<\/dd><\/div>\s*<div><dt>Contract<\/dt><dd>Verified, ownership renounced: the fee can’t change, and there is no tax wallet<\/dd><\/div>/.test(I)
    && !/tokenomics:/.test(I) && (text(slice('<section id="tokens"', '</section>')).match(/1%/g) || []).length === 1);
  check('the swap is one pair (ETH → $SEND) with a label on its amount box', /<div class="lp-swap-head"><span class="lp-swap-k">You pay<\/span> <b>ETH<\/b>/.test(I) && /<label class="lp-swap-label" for="swap-amt">ETH to spend<\/label>/.test(I) && /<input class="addr-input lp-amt" id="swap-amt"/.test(I));
  check('the page closes on $SEND elsewhere: the coin\'s first home (JustSendItCoin.com, its own tagline) and the community X account as the site\'s (rel="me"); the Wall is a tile, not said twice',
    /<section id="send-links" class="alt-bg-2">/.test(I) && /“You don’t hold it\. You send it\.”/.test(I) && /<a class="btn btn-ghost" href="https:\/\/JustSendItCoin\.com" target="_blank" rel="noopener"/.test(I)
    && /<a class="btn btn-ghost" href="https:\/\/x\.com\/sendrh_" target="_blank" rel="me noopener"/.test(I) && !/href="\/wall"/.test(slice('<section id="send-links"', '</section>')) && (I.match(/href="\/wall"/g) || []).length === 3);   // the menu, the tile, the footer's nav
  // an id another page uses would pull that page into the Home rules in responsive.css (about.html has a #join)
  check('  ...its id is the home page\'s alone, and the wide-screen Home rules name it', pages.filter((f) => /id="send-links"/.test(read(f))).join() === 'index.html' && /#send-links > \.wrap/.test(RESP) && !/#join\b/.test(RESP));

  /* ═══ 6. the look: its own layer, scoped so it cannot leak ═══ */
  check('landing.css is linked by index.html alone, after rocketize.css and before responsive.css, and only index.html\'s body carries .lp',
    pages.filter((f) => /href="\/?landing\.css"/.test(read(f))).join() === 'index.html' && /<link rel="stylesheet" href="rocketize\.css">\n<link rel="stylesheet" href="landing\.css">\n<link rel="stylesheet" href="responsive\.css">/.test(I)
    && /<body class="lp" data-intro="1">/.test(I) && pages.filter((f) => /<body[^>]*class="[^"]*\blp\b/.test(read(f))).join() === 'index.html');
  // every selector list in the file (inside @media too, never a keyframe step), split at its top-level commas only (:is() keeps its own)
  const lpSel = [...LP.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[{};])\s*([^\s{}@;][^{};]*)\{/g)].map((m) => m[1].trim()).filter((s) => !/^(from|to|\d)/.test(s));
  const topLevel = (s) => { const out = []; let depth = 0, cur = ''; for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const loose = lpSel.filter((s) => !topLevel(s).every((part) => /^(html\.motion-off\s+)?body\.lp\b/.test(part.trim())));
  check('  ...every rule in it is scoped to body.lp (About and the White Paper share .hero, .ticker, .card, .step, .reassure and .section-title)', lpSel.length > 40 && !loose.length, loose.slice(0, 4).join(' | '));
  check('  ...every font-size in it is floored, and it brings no font of its own (Plex Mono, Rubik and the wordmark\'s face are the site\'s)',
    !(LP.match(/font-size:(?!\s*max\(var\(--text-floor\))/g) || []).length && (LP.match(/font-size:/g) || []).length >= 12 && !/@font-face|url\(/.test(LP));
  check('  ...the grid: one column on a phone, two from 560px, three from 1000px; the $SEND reading spans every column, and a ninth tile closes its row (with the video tile hidden, the last of eight does)',
    /\.dash-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/.test(CSS) && /@media \(max-width: 559px\) \{ \.dash-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(CSS)
    && /body\.lp \.dash-grid > \.dash-tile\.is-send \{ grid-column: 1 \/ -1; \}/.test(LP)
    && /@media \(min-width: 560px\) and \(max-width: 999\.98px\) \{[\s\S]*?body\.lp \.dash-grid:not\(:has\(> \.dash-tile\[hidden\]\)\) > \.dash-tile:last-child \{ grid-column: 1 \/ -1; \}\s*\}/.test(LP)
    && /@media \(min-width: 1000px\) \{\s*body\.lp \.dash-grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}\s*body\.lp \.dash-grid:has\(> \.dash-tile\[hidden\]\) > \.dash-tile:last-child \{ grid-column: span 2; \}\s*\}/.test(LP)
    && /\.hero-dash \.dash-grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); gap: 1rem; \}/.test(RESP) && !/repeat\(4, minmax\(0, 1fr\)\)/.test(RESP.slice(RESP.indexOf('/* ─── Home (index.html) ─── */'), RESP.indexOf('/* ─── The Wall, Support'))));
  check('  ...each tile is a container: the big readings are sized by the tile (cqi), floored, with a floored fallback first for an engine without cqi',
    /\.dash-tile \{[\s\S]*?container-type: inline-size;/.test(CSS) && /\.dash-big \{[^}]*font-size: max\(var\(--text-floor\), 2rem\); font-size: max\(var\(--text-floor\), clamp\(1\.1rem, 11cqi, 2\.4rem\)\)/.test(CSS)
    && /body\.lp \.dash-tile\.is-send \.mcap-value \{ font-size: max\(var\(--text-floor\), 2\.2rem\); font-size: max\(var\(--text-floor\), clamp\(1\.6rem, 7cqi, 3\.4rem\)\); \}/.test(LP));
  check('  ...the readings are telemetry (Plex Mono, tabular figures), the live pills square LEDs that keep their word, the tiles instrument panels with corner ticks',
    /body\.lp :is\(\.dash-big, \.dash-tile \.mcap-value, \.beta-count, \.price-big\) \{\s*font-family: var\(--font-mono\); font-weight: 600; font-variant-numeric: tabular-nums slashed-zero;/.test(LP)
    && /<span class="dash-live"><i aria-hidden="true"><\/i><span>live<\/span><\/span>/.test(dash) && /body\.lp \.dash-tile::before \{\s*content: ''; position: absolute; inset: 5px; z-index: 1; pointer-events: none;/.test(LP));
  check('  ...the radar around the logo turns on transform alone, and stops under ⏸ (html.motion-off), under reduced motion and in forced colours',
    /@keyframes lp-turn \{ to \{ transform: rotate\(360deg\); \} \}/.test(LP) && /html\.motion-off body\.lp \.hero-logo-btn::after \{ animation: none; \}/.test(LP) && /html\.motion-off body\.lp \.hero-logo-btn::before \{ animation: none; background: none; \}/.test(LP)
    && /@media \(prefers-reduced-motion: reduce\) \{\s*body\.lp \.hero-logo-btn::before, body\.lp \.hero-logo-btn::after \{ animation: none; \}/.test(LP) && /@media \(forced-colors: active\) \{[\s\S]*?body\.lp \.hero-logo-btn::before, body\.lp \.hero-logo-btn::after \{ content: none; \}/.test(LP));
  check('  ...the live dots pause with the ⏸ switch and under reduced motion, which also stops the tile lift', /html\.motion-off \.dash-live i,/.test(CSS) && /@media \(prefers-reduced-motion: reduce\) \{\s*\.dash-tile, \.dash-ico \{ transition: none; \}\s*\.dash-tile:hover, \.dash-tile:hover \.dash-ico \{ transform: none; \}\s*\.dash-live i \{ animation: none; \}/.test(CSS));
  check('  ...the four hero buttons and the contract\'s Copy are 44px targets at every width, and on a phone the four are a 2×2',
    /body\.lp \.hero-actions \.cta-row \.btn \{ min-height: 44px; \}/.test(LP) && /body\.lp \.contract-box \.copy-btn \{ min-height: 44px; \}/.test(LP) && /@media \(max-width: 559px\) \{\s*\.hero-actions \.cta-row \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/.test(CSS));
  check('the home hero is as tall as what it holds and its column is the 1040px .wrap; the shared .hero (About\'s poster) keeps its 88vh and its 340px mark',
    /\.hero\.hero-dash \{ min-height: 0; justify-content: flex-start;/.test(CSS) && /\.hero-dash > \.hero-content \{ width: 100%; max-width: 1040px;/.test(CSS) && /\.hero \{\s*position: relative; min-height: 88vh;/.test(CSS) && /\.hero-logo \{\s*width: min\(340px, 68vw\);/.test(CSS)
    && /<header class="hero about-hero">/.test(ABOUT) && !/hero-dash|class="lp"/.test(ABOUT));
  check('the styles the old page needed are gone with it: the OG strip, the $GWC and origin cards, the drop-downs, the coin picker',
    !/\.og-banner|\.og-confetti|\.gwc-hero|\.origin-pair|\.dash-more|\.swap-row|\.swap-choice \{/.test(CSS + RESP) && !/#origin/.test(RESP));

  /* ═══ 7. the docs say the same ═══ */
  check('Sendy\'s site map says the home page is about $SEND and opens with Mission Control, without the $GWC links', /\/ — home, about \$SEND: Mission Control at the top \(a dashboard:/.test(SERVER) && !/the \$GWC and JustSendItCoin\.com links/.test(SERVER));
  check('  ...and the README row says the same: the $SEND reading, one tile per section or page, no drop-downs, the landing.css layer', /\| \*\*🛸 Mission Control \(the hero\)\*\* \| The top of the home page is a dashboard of everything on it, and the home page is about \$SEND/.test(README)
    && /`public\/landing\.css`, scoped to `body\.lp`/.test(README) && !/the OG badge with the countdown to its window's close/.test(README));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
