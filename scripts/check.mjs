#!/usr/bin/env node
/* ===== npm run check — the cheap pass that runs before the expensive one =====================
 * There is no build step on this site and no transpiler, so nothing sits between a typo and
 * production. This is the substitute: a parse of every file that ships, plus the handful of
 * whole-file invariants that have actually broken things here before.
 *
 * It is deliberately dependency-free. A linter with a config file is a thing to argue about;
 * this is a thing to pass.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const problems = [];
const note = (file, msg) => problems.push(file + ': ' + msg);

/* ---- 1. every shipped JavaScript file parses ---- */
const jsFiles = [path.join(ROOT, 'server.js')]
  .concat(readdirSync(PUBLIC).filter(f => f.endsWith('.js')).map(f => path.join(PUBLIC, f)))
  .concat(existsSync(path.join(ROOT, 'tests'))
    ? readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.mjs')).map(f => path.join(ROOT, 'tests', f))
    : []);
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { note(path.relative(ROOT, f), 'does not parse\n    ' + String(e.stderr || e.message).split('\n').slice(0, 3).join('\n    ')); }
}

/* ---- 2. no inline <script> anywhere ----
   The Content-Security-Policy is `script-src 'self'` with no nonce and no 'unsafe-inline', so an inline
   script does not throw at review time, it simply never runs — in a browser, silently, in production. */
const htmlFiles = readdirSync(PUBLIC).filter(f => f.endsWith('.html'));
for (const f of htmlFiles) {
  const s = readFileSync(path.join(PUBLIC, f), 'utf8');
  for (const m of s.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] || '';
    if (/type\s*=\s*["']application\/ld\+json["']/i.test(attrs)) continue;   // data, not code — the CSP does not execute it
    if (!m[2].trim()) continue;
    note('public/' + f, 'has an inline <script>, which the CSP will silently refuse to run');
  }
}

/* ---- 3. every <script src> and <link href> a page names actually exists ----
   A renamed or deleted asset is a 404 the page recovers from by doing nothing at all. */
for (const f of htmlFiles) {
  const s = readFileSync(path.join(PUBLIC, f), 'utf8');
  for (const m of s.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const ref = m[1];
    if (/^(https?:)?\/\/|^data:|^mailto:|^#|^\?/.test(ref)) continue;
    const rel = ref.split(/[?#]/)[0];
    if (!rel || rel.endsWith('/')) continue;
    const target = rel.startsWith('/') ? path.join(PUBLIC, rel.slice(1)) : path.join(PUBLIC, rel);
    if (!existsSync(target)) {
      /* X04: the feature video and its poster are kept out of git for rights reasons. Their <video> carries
         data-optional-media, /api/config reports whether they exist, and app.js hides the section when they do
         not — so a clean checkout serves no dead player. Anything else missing is still a failure. */
      const tagStart = s.lastIndexOf('<', m.index);
      const tag = s.slice(tagStart, s.indexOf('>', m.index) + 1);
      if (/data-optional-media/.test(tag)) console.log('  · public/' + f + ': optional media not present here (hidden at runtime): ' + ref);
      else note('public/' + f, 'references a file that is not there: ' + ref);
    }
  }
}

/* ---- 3b. the matrix tiles' pointer tracking covers every tile ----
   styles.css gives a list of selectors position:relative + isolation (the tile block at its end) and the other
   stylesheets add a few of their own; app.js sets --mx/--my on the SAME list. A tile missing from app.js keeps
   its light pinned at the centre, which is the bug this check exists to catch. */
{
  const css = readFileSync(path.join(PUBLIC, 'styles.css'), 'utf8');
  const mm = css.match(/\n([^\n{}]+) \{\n  position: relative; isolation: isolate;\n/);
  const app = readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  const sm = app.match(/const SEL = '([^']+)';/);
  if (!mm || !sm) note('public/app.js', 'could not find the matrix tile lists to compare (styles.css block or app.js SEL)');
  else {
    const inCss = new Set(mm[1].split(',').map(s => s.trim()));
    for (const [f, re] of [['gate.css', /\n([^\n{}]+) \{ position: relative; isolation: isolate; \}/g], ['governance.css', /\n([^\n{}]+) \{ position: relative; isolation: isolate; \}/g], ['moderation.css', /\n([^\n{}]+) \{ position: relative; isolation: isolate; \}/g], ['invite.css', /\n([^\n{}]+) \{ isolation: isolate; \}/g], ['tokentext.css', /\n([^\n{}]+) \{ isolation: isolate; \}/g]]) {
      let src = ''; try { src = readFileSync(path.join(PUBLIC, f), 'utf8'); } catch { continue; }
      for (const x of src.matchAll(re)) x[1].split(',').map(s => s.trim()).filter(s => s.startsWith('.')).forEach(s => inCss.add(s));
    }
    const inJs = new Set(sm[1].split(',').map(s => s.trim()));
    const missing = [...inCss].filter(s => !inJs.has(s));
    const stale = [...inJs].filter(s => !inCss.has(s));
    if (missing.length) note('public/app.js', 'pointer tracking (SEL) misses tiles the CSS declares: ' + missing.join(', '));
    if (stale.length) note('public/app.js', 'pointer tracking (SEL) lists selectors no stylesheet makes a tile: ' + stale.join(', '));
  }
}

/* ---- 4. lazily-loaded assets exist too ----
   auth.js fetches these by string at runtime, so no HTML file names them and check 3 cannot see them. */
for (const ref of ['invite.js', 'invite.css', 'gate.css']) {
  if (!existsSync(path.join(PUBLIC, ref))) note('public/' + ref, 'is loaded on demand by auth.js but does not exist');
}

/* ---- 5. .dockerignore takes no trailing comments ----
   Docker reads `data  # the database` as a pattern literally named that, which matches nothing — so a
   line that looks like it excludes the live database excludes precisely nothing. This has happened here. */
const di = path.join(ROOT, '.dockerignore');
if (existsSync(di)) {
  readFileSync(di, 'utf8').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.includes('#')) note('.dockerignore:' + (i + 1), 'has a trailing comment, which Docker reads as part of the pattern');
  });
}

/* ---- 6. the client's risk weights match the server's ----
   The New Pairs panel claims to explain the health score the server computed. A flag in one and not the
   other is a chunk of that score with no stated reason, which is exactly what shipped once. */
try {
  const srv = readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const cli = readFileSync(path.join(PUBLIC, 'newpairs.js'), 'utf8');
  const RISK = eval('(' + /const RISK = (\{[\s\S]*?\n\});/.exec(srv)[1] + ')');
  const WEIGHTS = eval('(' + /const WEIGHTS = (\{[^}]*\});/.exec(cli)[1] + ')');
  for (const k of Object.keys(RISK)) {
    if (WEIGHTS[k] === undefined) note('public/newpairs.js', 'is missing risk flag "' + k + '" that the server scores');
    else if (WEIGHTS[k] !== RISK[k].w) note('public/newpairs.js', 'weights "' + k + '" at ' + WEIGHTS[k] + ' but the server scores it ' + RISK[k].w);
  }
  for (const k of Object.keys(WEIGHTS)) if (!RISK[k]) note('public/newpairs.js', 'weights "' + k + '", which the server does not score');
} catch (e) { note('newpairs risk parity', 'could not be checked: ' + e.message); }

/* ---- 7. every control carries a description ----
   "no button without a quick popup description" — enforced here rather than swept once, because a
   sweep is true on the day it lands and false the next time somebody adds a button. tips.js reads
   data-tip; a control without one falls back to its aria-label, which is a LABEL, not a description,
   and only exists for icon-only controls anyway.

   Best effort by design: these are string templates, not a DOM, so a <button whose attributes contain
   a bare `>` cannot be delimited. Those are reported as unparseable rather than silently passed. */
const TIPPED = /\bdata-tip\s*=/;
const SKIP = /\bdata-tip-skip\b/;          // opt out, deliberately ugly so it has to be argued for
const lineOf = (s, i) => s.slice(0, i).split('\n').length;
let tipped = 0, untipped = [];
/* A control is whatever the READER takes for a button, which is not the same set the parser sees:
   <a class="btn"> is styled identically to <button class="btn"> and nobody can tell them apart, and
   [role=button] is one by its own declaration. tips.js already answers all three; this is the check
   catching up with it. Plain navigational links are NOT in scope — a link that looks like a link is
   explained by where it goes. */
const CONTROLS = [
  /<button\b([^>]*)>/gi,
  /<a\b([^>]*)>/gi,                                  // filtered by isBtnLink below — class TOKENS, not substrings
  /<[a-z]+\b([^>]*\brole="button"[^>]*)>/gi,
];
/* Mirrors the CSS selector in tips.js exactly: `a.btn` is class-token matching, and `a[class*="-btn"]`
   catches the suffixed variants (oauth-btn, arc-btn). Done in code rather than in the pattern because a
   regex that tries to do token matching inline gets it subtly wrong — the first attempt anchored `^` to
   the string instead of the attribute value and went blind to fifty controls while still reporting a
   clean tree. A plain <a> is NOT a control: a link that looks like a link is explained by where it goes. */
const isBtnLink = (attrs) => {
  const cls = (/\bclass\s*=\s*"([^"]*)"/.exec(attrs) || [])[1];
  if (!cls) return false;
  return cls.split(/\s+/).some(t => t === 'btn' || t.endsWith('-btn'));
};
/* Comments are prose, not markup. A comment that says "the token symbol is a real <button> so it is
   keyboard-accessible" is an explanation, and reporting it as an undescribed control taught the last
   sweep to silence it by editing the sentence — which is the check corrupting the codebase to satisfy
   itself. Strip comments first. `//` is only taken as a comment when it does not follow a colon, so a
   https:// inside a string survives. */
/* A slash-star only opens a comment when something separates it from the token before it. Without that
   test this stripper read the slash-star inside `accept="image/*,video/mp4"` as a comment opener and
   blanked everything up to the next close marker — which in compose.js meant the check went blind to
   most of the file and silently passed an undescribed button. A regex cannot know it is inside a string
   literal; it can know that real block comments start a line or follow whitespace, and that is enough.
   (This comment says "slash-star" in words on purpose: writing the close marker inside a block comment
    ends the comment, which is exactly how the first attempt at this broke the file.) */
const decomment = (src, isHtml) => (isHtml ? src.replace(/<!--[\s\S]*?-->/g, c => c.replace(/[^\n]/g, ' ')) : src)
  .replace(/(^|\s)\/\*[\s\S]*?\*\//g, (m, pre) => pre + ' '.repeat(m.length - pre.length))   // keep line numbers stable
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
const scanForButtons = (rel, rawSrc, isHtml) => {
  const src = decomment(rawSrc, isHtml);
  const seen = new Set();
  for (const re of CONTROLS) {
    for (const m of src.matchAll(re)) {
      if (seen.has(m.index)) continue;          // role=button on a <button> is one control, not two
      seen.add(m.index);
      const attrs = m[1] || '';
      if (/^<a\b/i.test(m[0]) && !isBtnLink(attrs)) continue;
      if (SKIP.test(attrs)) continue;
      if (TIPPED.test(attrs)) { tipped++; continue; }
      untipped.push(rel + ':' + lineOf(src, m.index));
    }
  }
};
for (const f of htmlFiles) scanForButtons('public/' + f, readFileSync(path.join(PUBLIC, f), 'utf8'), true);
for (const f of readdirSync(PUBLIC).filter(f => f.endsWith('.js'))) scanForButtons('public/' + f, readFileSync(path.join(PUBLIC, f), 'utf8'), false);
if (untipped.length) {
  note('button descriptions', untipped.length + ' control' + (untipped.length === 1 ? '' : 's') +
    ' have no data-tip (tips.js has nothing to show):\n      ' + untipped.join('\n      '));
}

/* ---- 8. a description is not a second label ----
   A popup that repeats the word already printed on the button is noise the reader has to dismiss. This
   catches the laziest version of that: data-tip identical to the control's own visible text. */
for (const f of htmlFiles) {
  const src = readFileSync(path.join(PUBLIC, f), 'utf8');
  for (const m of src.matchAll(/<button\b([^>]*)>([\s\S]{0,200}?)<\/button>/gi)) {
    const tip = (/\bdata-tip\s*=\s*"([^"]*)"/.exec(m[1] || '') || [])[1];
    if (!tip) continue;
    const words = t => t.replace(/<[^>]*>/g, '').replace(/[^a-zA-Z ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (words(tip) && words(tip) === words(m[2])) {
      note('public/' + f + ':' + lineOf(src, m.index), 'data-tip just repeats the button\'s own label ("' + tip + '")');
    }
  }
}

/* ---- 9. controls built with createElement, which checks 7 and 8 cannot see ----
   Checks 7 and 8 scan HTML text. A control assembled as DOM — createElement('button') then setAttribute —
   never appears as a "<button" anywhere, so it passes them while having no description at all. That is not
   hypothetical: it is how the nav's "Sign In" and the site-wide SEND IT button both shipped bare while the
   check reported a clean tree. Heuristic by necessity — it looks for a data-tip assignment in the same
   rough block as the construction — so it is a nudge, not a proof. */
for (const f of readdirSync(PUBLIC).filter(f => f.endsWith('.js'))) {
  const src = decomment(readFileSync(path.join(PUBLIC, f), 'utf8'), false);
  for (const m of src.matchAll(/createElement\(\s*['"](button|a)['"]\s*\)/gi)) {
    const block = src.slice(m.index, m.index + 1200);          // the construction and its attribute run
    if (/data-tip/.test(block)) continue;
    if (/data-tip-skip/.test(block)) continue;
    // an <a> is only a control when it is styled as one; a plain link explains itself by where it goes
    if (m[1].toLowerCase() === 'a' && !/className\s*=\s*['"][^'"]*\bbtn\b/.test(block) && !/classList\.add\([^)]*\bbtn\b/.test(block)) continue;
    // (the <a> arm above stays loose on purpose: in script the class is often built, so a near-miss here
    //  costs a false positive, while a miss costs an undescribed control)
    note('public/' + f + ':' + lineOf(src, m.index), 'builds a <' + m[1] + '> control in script with no data-tip nearby');
  }
}

/* ---- 10. every page carries the brand ----
   theme-color paints the mobile address bar and apple-touch-icon is what iOS puts on a home screen —
   without the latter iOS screenshots the page instead. Both were partly or entirely missing (4 pages had
   no theme-color at all, and no page had an apple-touch-icon), which is the kind of gap that is invisible
   on a desktop and only shows up on somebody's phone. Enforced rather than swept, so the next page added
   cannot quietly ship without them.

   theme-color is checked against --green-bright itself: the brand colour living in seventeen places is
   how a rebrand ends up half-applied, which is exactly what happened to the value this replaced. */
{
  const css = readFileSync(path.join(PUBLIC, 'styles.css'), 'utf8');
  const brand = (/--green-bright:\s*(#[0-9a-fA-F]{6})/.exec(css) || [])[1];
  for (const f of htmlFiles) {
    const src = readFileSync(path.join(PUBLIC, f), 'utf8');
    const tc = (/<meta name="theme-color" content="(#[0-9a-fA-F]{6})">/.exec(src) || [])[1];
    if (!tc) note('public/' + f, 'has no theme-color, so its mobile address bar is browser-default');
    else if (brand && tc.toLowerCase() !== brand.toLowerCase()) note('public/' + f, 'theme-color is ' + tc + ' but the brand is ' + brand);
    if (!/rel="apple-touch-icon"/.test(src)) note('public/' + f, 'has no apple-touch-icon — iOS will screenshot the page for the home screen');
  }
}

/* ---- 11. every site page asks the age question first ----
   agegate.js has to run in <head>, after the stylesheet that styles its cover, or the page paints before
   the question is up. A page added later without it is a way into the site that never asks. The legal
   pages (privacy, terms) and the old gate redirect load no stylesheet from this site and stay readable. */
for (const f of htmlFiles) {
  const src = readFileSync(path.join(PUBLIC, f), 'utf8');
  if (!/href="\/?styles\.css"/.test(src)) continue;
  const head = src.slice(0, src.indexOf('</head>'));
  const at = head.search(/<script src="\/?agegate\.js"><\/script>/);
  if (at < 0) note('public/' + f, 'does not load agegate.js in <head> — this page would open without the 18+ question');
  else if (at < head.search(/href="\/?styles\.css"/)) note('public/' + f, 'loads agegate.js before styles.css, so its cover is unstyled for the first paint');
}

if (problems.length) {
  console.error('✗ ' + problems.length + ' problem' + (problems.length === 1 ? '' : 's') + ':\n');
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}
console.log('✓ ' + jsFiles.length + ' JS files parse · ' + htmlFiles.length + ' pages checked · ' + tipped + ' controls described · CSP, assets, .dockerignore and risk parity all clean');
