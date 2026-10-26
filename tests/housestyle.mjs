/* ===== The house style: wide screens, type, and the composer (2026-10-26) ===================================================
   Owner: "On wider screens use more of the screen to show the feature elements and the information … reduce scrolling across
   the whole platform. Do not change anything functionally … best UI/UX and accessibility … a subtle avant-garde styling to the
   typography …" and "Make sure users can easily get to the Send Wall and their Send Wall from the composer … make sure that all
   the example text always shows … responsive in font size so the user never has to scroll to read the example text."

   1. The type voices and their fonts: Newsreader (introductions) and IBM Plex Mono (labels) declared site-wide, files present.
   2. The wide layer: page width tiers, the title rail, one shared drop capital — and the guarantees that make it safe:
      every page-layout rule lives at 1280px and up (phones and tablets are untouched), nothing is hidden, cut or reordered,
      and its hairline token never takes over the white paper's own --rule.
   3. The composer: the two walls one tap from the box (signed in, after a post, and the public wall signed out), each link
      closing the dialog first; a dialog that grows with the screen; and empty writing boxes as tall as their whole example
      text, re-measured whenever the box changes width, its example text changes, or the fonts arrive. */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PUB = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

const RESP = PUB('responsive.css'), FONTS = PUB('fonts/fonts.css'), LIC = PUB('fonts/LICENSES.md');
const start = RESP.indexOf('═══ The house style: wide screens and type');
const HOUSE = start < 0 ? '' : RESP.slice(RESP.lastIndexOf('/*', start));
const bare = HOUSE.replace(/\/\*[\s\S]*?\*\//g, '');

/* ═══ 1. type voices ═══ */
{
  const face = (fam, style, w) => new RegExp("font-family: '" + fam + "';\\s*font-style: " + style + ';\\s*font-weight: ' + w + ';[\\s\\S]*?src: url\\(([^)]+)\\)').exec(FONTS);
  const faces = [face('Newsreader', 'normal', 400), face('Newsreader', 'normal', 600), face('Newsreader', 'italic', 400), face('IBM Plex Mono', 'normal', 600)];
  check('the two accent voices are declared site-wide in fonts.css (Newsreader 400/600/italic, IBM Plex Mono 600), every file present, licences no longer "whitepaper only"',
    faces.every((m) => m && fs.existsSync(path.join(ROOT, 'public', 'fonts', m[1]))) && !/\| Newsreader \(whitepaper only\)/.test(LIC) && !/\| IBM Plex Mono \(whitepaper only\)/.test(LIC),
    faces.map((m) => (m ? m[1] : 'missing')).join(','));
  check('  ...the voices are tokens: --font-serif is Newsreader, --font-mono IBM Plex Mono (so the site\'s --mono follows)',
    /--font-serif: 'Newsreader',/.test(bare) && /--font-mono: 'IBM Plex Mono',/.test(bare));
  check('  ...section introductions take the serif, small uppercase labels and table heads the mono voice with tabular figures; headings balance, paragraphs avoid orphans',
    /\.section-sub \{ font-family: var\(--font-serif\);/.test(bare) && /\.dash-k, \.tkd-kicker,[\s\S]*?\{\s*font-family: var\(--font-mono\); font-weight: 600; letter-spacing: 0\.06em; font-variant-numeric: tabular-nums slashed-zero;/.test(bare)
    && /h1, h2, h3, h4, \.section-title \{ text-wrap: balance; \}/.test(bare) && /p, li, dd, blockquote, \.section-sub \{ text-wrap: pretty; \}/.test(bare));
}

/* ═══ 2. the wide layer ═══ */
{
  check('the house style is the last section of responsive.css (loaded last on every app page)', start > 0 && RESP.trimEnd().endsWith('}'));
  check('the page width steps out at 1280 / 1600 / 2000px: 1200 / 1440 / 1680px for reading pages (1040px below); tools and dashboards (profile, tracker, watchlist, scanner) share one wider width, 92% of the screen up to 2240px',
    /--page-max: 1040px;/.test(bare) && /@media \(min-width: 1280px\) \{ :root \{ --page-max: 1200px; --dash-max: max\(var\(--page-max\), min\(92vw, 2240px\)\); \} \}/.test(bare)
    && /--dash-max: var\(--page-max\);/.test(bare) && (bare.match(/var\(--dash-max\)/g) || []).length >= 5 && !/min\(1680px, calc\(100% - 2 \* var\(--sc-gutter\)\)\)/.test(bare) && /@media \(min-width: 1600px\) \{ :root \{ --page-max: 1440px; \} \}/.test(bare) && /@media \(min-width: 2000px\) \{ :root \{ --page-max: 1680px; \} \}/.test(bare));
  check('  ...a section\'s title and introduction sit in a left rail beside its content, under the house hairline',
    /section > \.wrap > \.section-title, section > \.wrap > \.section-title \+ \.section-sub \{\s*float: left; clear: left; width: var\(--rail\);/.test(bare)
    && /section > \.wrap:has\(> \.section-title\) > :not\(\.section-title\):not\(\.section-title \+ \.section-sub\) \{\s*margin-left: calc\(var\(--rail\) \+ var\(--rail-gap\)\);/.test(bare));
  // every rule outside the type layer sits in a 1280px-and-up block: walk the top level of the section
  const top = []; let depth = 0, buf = '';
  for (const ch of bare) { buf += ch; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { top.push(buf.trim()); buf = ''; } } }
  const TYPE_OK = /^(:root|html|h1, h2, h3, h4, \.section-title|p, li, dd, blockquote, \.section-sub|\.section-sub|\.section-sub b, \.section-sub strong|\.dash-k, \.tkd-kicker)/;
  const stray = top.filter((b) => !/^@media \((min-width: (1[2-9]\d\d|[2-9]\d\d\d)px)\)/.test(b) && !TYPE_OK.test(b));
  check('  ...every layout rule lives at 1280px and up — phones and tablets are untouched (only the type layer applies at every width)', top.length > 20 && stray.length === 0, stray.map((b) => b.slice(0, 60)).join(' | '));
  const mediaConds = [...bare.matchAll(/@media ([^{]+)\{/g)].map((m) => m[1].trim());
  check('  ...and no block in it targets a narrower screen', mediaConds.every((c) => /min-width: (1[2-9]\d\d|[2-9]\d\d\d)px/.test(c)), mediaConds.filter((c) => !/min-width: (1[2-9]\d\d|[2-9]\d\d\d)px/.test(c)).join(' | '));
  check('nothing in it hides content, cuts text off or reorders what a reader hears: no display:none (except on an empty box), visibility:hidden, line-clamp, ellipsis or order',
    !/display:\s*none|visibility:\s*hidden|line-clamp|text-overflow:\s*ellipsis|(^|[;{\s])order:/.test(bare.replace(/[^{}]*:empty \{ display: none; \}/g, '')));   // an EMPTY box may fold away: there is nothing in it to hide
  check('one drop capital for every page header\'s introduction (the display face, two lines), with a fallback where initial-letter is missing — and no other',
    (bare.match(/::first-letter/g) || []).length === 2 && /:is\(header\.np-hero, header\.profile-hero\) > h1 \+ \.section-sub::first-letter \{[\s\S]*?initial-letter: 2;/.test(bare) && /@supports not \(\(initial-letter: 2\) or \(-webkit-initial-letter: 2\)\)/.test(bare));
  check('its hairline is --house-rule: the white paper keeps its own --rule (dark on screen, light in print)',
    /--house-rule:/.test(bare) && !/(^|[\s;{])--rule:/.test(bare) && !/var\(--rule\)/.test(bare) && /--rule:\s+#22261b;/.test(PUB('whitepaper.html')));
  check('every page the platform shows has its own wide section (home, feeds, profile/tracker/watchlist, scanner, arcade, communities, about/white paper/data)',
    ['Home (index.html)', 'The Wall, Support and a member', 'Profile, wallet tracker and watchlist', 'The Scanner and the New Pairs radar', 'The Arcade (arcade.html)', 'Communities, a community, a squad', 'About, the white paper and Your data'].every((t) => HOUSE.includes('/* ─── ' + t)));
}

/* ═══ 3. the composer ═══ */
{
  const C = PUB('compose.js'), APP = PUB('app.js'), CSS = PUB('styles.css');
  check('the composer shows where the post goes and both walls one tap away: the Send Wall and the member\'s own',
    /<nav class="cmp-walls" aria-label="Your walls">/.test(C) && /id="compose-go-wall" href="\/wall" data-tip="Closes the composer and opens the Send Wall, where everyone’s posts land">🧱 Send Wall<\/a>/.test(C)
    && /id="compose-go-mine" href="\/profile" data-tip="Closes the composer and opens your own wall: your posts, pins and daily check-in">🏠 My Send Wall<\/a>/.test(C));
  check('  ...the member\'s own wall is /u/<their name>, set each time the box opens (in the box and after a post)',
    /const mine = '\/u\/' \+ encodeURIComponent\(AUTH\.user\.username\);\s*modal\.querySelectorAll\('#compose-go-mine, #compose-done-mine'\)\.forEach\(\(a\) => \{ a\.href = mine; \}\);/.test(C)
    && /id="compose-done-mine" href="\/profile" data-tip="Closes this and opens your own wall, with everything you have posted">🏠 My Send Wall<\/a>/.test(C));
  check('  ...signed out, the public wall is one tap away too (reading needs no account), and every wall link closes the dialog first',
    /id="compose-out-wall" href="\/wall" data-tip="Opens the public Send Wall; reading it needs no account">🧱 Read the Send Wall<\/a>/.test(C)
    && /modal\.querySelectorAll\('#compose-go-wall, #compose-go-mine, #compose-out-wall, #compose-done-mine'\)\.forEach\(\(a\) => a\.addEventListener\('click', \(\) => close\(\)\)\);/.test(C));
  check('the dialog grows with the screen (to 760px) and keeps whole on a short screen by trimming air, not words',
    /#compose-modal \.modal-card \{ width: min\(clamp\(420px, 54vw, 760px\), 100%\); \}/.test(CSS) && /@media \(max-height: 780px\) \{ #compose-modal \.modal-card \{ padding-block: 1\.05rem 1\.1rem; \}/.test(CSS)
    && /\.cmp-walls \.btn \{ flex: 1 1 0; min-width: max-content;/.test(CSS));
  check('an empty writing box is as tall as its whole example text: measured with a copy carrying the box\'s font, padding and wrapping',
    /window\.fitPlaceholder = function \(ta\) \{/.test(APP) && /m\.textContent = text;/.test(APP) && /font: cs\.font,/.test(APP) && /whiteSpace: 'pre-wrap', overflowWrap: 'break-word'/.test(APP)
    && /if \(need > \(parseFloat\(cs\.minHeight\) \|\| 0\) \+ 1\) ta\.style\.minHeight = need \+ 'px';/.test(APP));
  check('  ...and measured again when the box changes width, its example text changes, a box is added, or the fonts arrive — on every page',
    /new ResizeObserver\(\(es\) => es\.forEach\(\(e\) => window\.fitPlaceholder\(e\.target\)\)\)/.test(APP) && /attributeFilter: \['placeholder'\]/.test(APP) && /document\.fonts\.ready\.then/.test(APP)
    && /root\.querySelectorAll\('textarea\[placeholder\]'\)\.forEach\(watch\)/.test(APP));
}

/* ═══ 4. the white paper's contract addresses ═══ */
{
  const WP = PUB('whitepaper.html');
  // owner, 2026-10-26: "make all contract addresses in the whitepaper full address and if the user clicks on them it copies the address"
  check('the white paper writes every contract address out in full, each one a button that copies it (app.js data-copy) and says so',
    /<button type="button" class="wp-addr" data-copy="0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105" data-tip="Copies the \$SEND contract address to your clipboard">0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105<span class="wp-addr-ico" aria-hidden="true">⧉<\/span><\/button>/.test(WP)
    && /<button type="button" class="wp-addr" data-copy="0x61339f11384dde4b2dc3a33e75b4dc23cc620f22" data-tip="Copies the \$GWC contract address to your clipboard">0x61339f11384dde4b2dc3a33e75b4dc23cc620f22/.test(WP)
    && !/0x[0-9a-f]{4,}(&hellip;|…)[0-9a-f]{4,}/i.test(WP));
  check('  ...a full address wraps anywhere and its table fits a phone whole; the button is a full-size target with a visible focus ring',
    /\.wp-addr \{[^}]*min-height: 44px;[^}]*overflow-wrap: anywhere; word-break: break-all; cursor: copy; \}/.test(WP) && /table:has\(\.wp-addr\) \{ min-width: 0; \}/.test(WP) && /\.wp-addr:focus-visible \{ outline: 3px solid/.test(WP));
}

let pass = 0;
for (const [n, ok, extra] of results) { if (ok) pass++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok || !extra ? '' : '\n      ' + extra)); }
console.log(`\n${pass}/${results.length} passed`);
if (pass !== results.length) process.exit(1);
