/* Full-screen charts (owner, 2026-10-14: "Allow a user to expand any chart to full screen pop up and easily be able to close
   it"). Source-checked: every chart on the site carries the ⤢ and is a unit the viewer can open; the viewer (ChartFull in
   app.js) moves a live chart in and back, copies a drawn-once one, and closes on ✕, Esc, the dimmed edge and Back; it sits
   above the page's own pop-ups and under the toasts and tips. The real-browser behaviour (sizes, redraws, focus) was checked
   in a muted headless Chrome when it was built; this pins the pieces that make it work. No server. */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

try {
  const APP = read('app.js'), CJ = read('chart.js'), NP = read('newpairs.js'), WL = read('watchlist.js'), WC = read('walletchart.js'),
    ADM = read('admin.js'), GM = read('gamify.js'), CSS = read('styles.css'), IDX = read('index.html'), TOUR = read('tour.js');

  /* ═══ 1. every chart has the ⤢, in its unit ═══ */
  const opens = [];
  for (const f of readdirSync(PUB).filter((x) => /\.(js|html)$/.test(x))) for (const m of read(f).matchAll(/<button\b[^>]*\bdata-cf-open\b[^>]*>/g)) opens.push([f, m[0]]);
  const files = [...new Set(opens.map(([f]) => f))].sort().join(',');
  check('a ⤢ on every chart: the price chart (chart.js), its switch and the volume bars (newpairs.js), the wallet chart, the admin day charts, the Loot Log',
    files === 'admin.js,chart.js,gamify.js,newpairs.js,walletchart.js' && opens.length === 6, files + ' · ' + opens.length);
  const badBtn = opens.filter(([, t]) => !/data-tip="[^"]+"/.test(t) || !/aria-label="[^"]+"/.test(t) || !/aria-haspopup="dialog"/.test(t) || !/type="button"/.test(t) || !/<i class="cf-ico" aria-hidden="true">/.test(t + '<i class="cf-ico" aria-hidden="true">'));
  check('  ...each one a described button (a tip, a name, and it says it opens a dialog)', !badBtn.length, badBtn.map(([f]) => f).join(','));
  check('  ...the price chart: the ⤢ is in its head, and a chart on its own is its own unit (inside a switch, the whole switch goes)',
    /'<button class="cf-open" type="button" data-cf-open aria-haspopup="dialog"/.test(CJ) && /if \(!host\.closest\('\[data-cf-unit\]'\)\) \{ host\.setAttribute\('data-cf-unit', ''\);/.test(CJ));
  check('  ...the switch is the unit (with its title), and its own ⤢ beside the source buttons stands in for the head\'s when another site lists the pool',
    /'<div class="chart-switch" data-pair="' \+ esc\(p\.pair\.address\) \+ '" data-sym="' \+ esc\(p\.token\.symbol \|\| ''\) \+ '" data-cf-unit data-cf-title="/.test(NP)
    && /'<div class="chart-src-row">' \+/.test(NP) && /wrap\.classList\.toggle\('has-src', any\);/.test(CJ)
    && /\.chart-switch\.has-src > \.chart-src-row \{ display: flex;/.test(CSS) && /\.chart-switch\.has-src \.oc-head \.cf-open \{ display: none; \}/.test(CSS) && /\.chart-src-row \{ display: none; \}/.test(CSS));
  check('  ...every chart is named in the pop-up: $SEND and $GWC on the home page, the token\'s symbol elsewhere, "Value over time", the admin chart\'s title',
    /data-cf-title="\$SEND price chart"/.test(IDX) && /data-cf-title="\$GWC price chart"/.test(IDX) && /data-cf-title="' \+ esc\(p\.token\.symbol \? '\$' \+ p\.token\.symbol \+ ' price chart' : 'Price chart'\) \+ '"/.test(WL)
    && /host\.setAttribute\('data-cf-title', 'Value over time'\);/.test(WC) && /data-cf-unit="clone" data-cf-title="' \+ esc\(title\) \+ '"/.test(ADM));
  check('  ...the wallet chart is moved in inside a .trk-dash (its styles live there) and followed if the report is drawn again while it is open',
    /host\.setAttribute\('data-cf-unit', ''\); host\.setAttribute\('data-cf-key', 'wallet-chart'\); host\.setAttribute\('data-cf-ctx', 'trk-dash'\);/.test(WC));
  check('  ...the drawn-once charts are copies: the admin day bars, the volume bars, and the Loot Log only when it has something to chart (its nudge left out)',
    /<figure class="adm-chart ' \+ cls \+ '" data-cf-unit="clone"/.test(ADM) && /'<div class="np-vol-wrap" data-cf-unit="clone" data-cf-title="'/.test(NP)
    && /const full = bd\.length \? '<button class="cf-open"/.test(GM) && /return '<div class="loot"' \+ \(bd\.length \? ' data-cf-unit="clone"/.test(GM) && /'<li class="ll-nudge" data-cf-drop>/.test(GM));
  check('the price chart redraws sharp whenever its own box changes size (opened full screen, put back), not only when the window does',
    /new ResizeObserver\(\(\) => \{\n        const r = host\.querySelector\('\.oc-canvas'\)\.getBoundingClientRect\(\)/.test(CJ) && /if \(host\._data\) paint\(host, true\);/.test(CJ));

  /* ═══ 2. the viewer ═══ */
  check('the pop-up is a labelled modal dialog, built once on first use, with a "✕ Close" button that says Esc and Back work too',
    /root\.id = 'full-view'; root\.className = 'cf'; root\.hidden = true;/.test(APP) && /'<div class="cf-dialog" role="dialog" aria-modal="true" aria-labelledby="cf-title" tabindex="-1">'/.test(APP)
    && /<button class="cf-x" type="button" data-cf-close aria-label="Close full screen" data-tip="Closes this and takes you back to the page — Esc or your browser&#39;s Back does the same">✕ Close<\/button>/.test(APP)
    && /FullView\.open\(\{ title: unit\.getAttribute\('data-cf-title'\) \|\| 'Chart', turnHint: true, opener: btn, fill: \(stage\) => \{/.test(APP));
  check('  ...it closes on ✕, on the dimmed edge, on Esc (after the chart\'s own Esc, which clears a crosshair or zoom first), and on Back',
    /root\.addEventListener\('click', \(e\) => \{ if \(e\.target\.closest\('\[data-cf-close\]'\)\) close\(e\.detail > 0 \? 'pointer' : 'key'\); \}\);/.test(APP) && /'<div class="cf-backdrop" data-cf-close><\/div>'/.test(APP)
    && /if \(!e\.defaultPrevented\) \{ e\.preventDefault\(\); close\('key'\); \}/.test(APP) && /history\.pushState\(\{ cf: 1 \}, ''\)/.test(APP)
    && /if \(backing\) \{ backing = false; return; \}\n    if \(!view \|\| !view\.pushed\) return;/.test(APP) && /    close\('history'\);\n  \}\);/.test(APP)
    && /if \(v\.pushed && how !== 'history'\) \{ try \{ if \(history\.state && history\.state\.cf\) \{ backing = true; history\.back\(\); \} \} catch \{\} \}/.test(APP));
  check('  ...only Esc is kept from the page underneath (the chart\'s tab and radio arrows still reach the shared handler); the Hot Feed steps aside while it is open',
    /if \(e\.key !== 'Escape' && e\.key !== 'Esc'\) return;/.test(APP) && /if \(window\.ChartFull && ChartFull\.isOpen\(\)\) return;/.test(NP));
  check('  ...a live chart is moved in (the same chart, still updating) with a placeholder of its size left behind, and moved back on close',
    /cur\.ph = holder\(unit\);\n        move\(ctx, unit\);/.test(APP) && /if \(c\.ph && c\.ph\.isConnected\) move\(c\.ph\.parentNode, c\.shown, c\.ph\);/.test(APP) && /return putBack;/.test(APP)
    && /ph\.style\.height = Math\.round\(unit\.getBoundingClientRect\(\)\.height\) \+ 'px';/.test(APP) && /typeof parent\.moveBefore === 'function'/.test(APP));
  check('  ...a copy loses its buttons, its ids and anything marked to drop, and shows its bars at full length',
    /c\.querySelectorAll\('button, \[data-cf-drop\]'\)\.forEach\(\(x\) => x\.remove\(\)\);/.test(APP) && /for \(const a of \['id', 'aria-labelledby', 'aria-describedby', 'aria-controls'\]\) x\.removeAttribute\(a\);/.test(APP)
    && /c\.querySelectorAll\('\[data-fill\]'\)\.forEach/.test(APP));
  check('  ...the page under it does not scroll, focus stays inside (the pop-up takes it, ✕ is the first stop) and returns to the ⤢ on close; it sounds open and close',
    /if \(window\.lockScroll\) lockScroll\(\);/.test(APP) && /release = window\.trapFocus \? trapFocus\(dialog\) : null;/.test(APP) && /try \{ dialog\.focus\(\{ preventScroll: true \}\); \} catch \{\}/.test(APP)
    && /return \(u && \[\.\.\.u\.querySelectorAll\('\[data-cf-open\]'\)\]\.find\(drawn\)\) \|\| null;/.test(APP) && /const to = drawn\(back\) \? back : drawn\(v\.opener\) \? v\.opener : null;/.test(APP)
    && /if \(how !== 'key' && window\.sendTips\) sendTips\.hide\(\);/.test(APP) && /if \(window\.SFX\) SFX\.play\('open'\);/.test(APP)
    && /if \(e\.shiftKey && \(document\.activeElement === first \|\| document\.activeElement === container\)\) \{ e\.preventDefault\(\); last\.focus\(\); \}/.test(APP));
  check('  ...the tour waits while a chart is open full screen', /for \(const id of \['auth-modal', 'compose-modal', 'full-view'\]\)/.test(TOUR));

  /* ═══ 3. where it sits, and how the chart fills it ═══ */
  const z = (sel) => { const m = CSS.match(new RegExp(sel.replace(/[.#[\]]/g, (c) => '\\' + c) + ' \\{[^}]*?z-index: (\\d+)')); return m ? +m[1] : null; };
  const cfZ = z('.cf'), tmZ = z('.tm-modal'), compZ = z('#compose-modal'), toastZ = z('#toast-zone'), tipZ = z('.tip-bubble');
  check('a plain fixed layer (not the browser\'s top layer, which would hide the toasts and tips): over the token dashboard and the composer, under the toasts and tips',
    /\.cf \{ position: fixed; inset: 0; z-index: 460;/.test(CSS) && cfZ > tmZ && cfZ > compZ && cfZ < toastZ && cfZ < tipZ && !/showModal\(|requestFullscreen\(/.test(APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')), [cfZ, tmZ, compZ, toastZ, tipZ].join(' '));
  check('  ...closed, it has no box at all (agegate.js and arcade.js find an open dialog by its box)', /\.cf\[hidden\] \{ display: none; \}/.test(CSS));
  check('  ...the chart takes the room: the plot grows to fill the screen and never under a readable height; an outside chart\'s frame and the wallet chart too',
    /\.cf \.oc-plot \{ flex: 1 1 auto; min-height: 240px;/.test(CSS) && /\.cf \.oc-canvas \{ position: absolute; inset: 0; width: 100%; height: 100%; \}/.test(CSS)
    && /\.cf \.chart-embed \{ position: relative; height: auto;/.test(CSS) && /\.cf \.trk-dash \.wc-plot \{ flex: 1 1 auto; aspect-ratio: auto;/.test(CSS)
    && /\.cf \.adm-chart-plot \{ flex: 1 1 auto; height: auto;/.test(CSS) && /\.cf \.np-vol \{ flex: 1 1 auto; height: auto;/.test(CSS) && /\.cf \.cf-open \{ display: none; \}/.test(CSS));
  check('  ...edge to edge on a phone, with a hint to turn it sideways (on a phone only, not a narrow desktop window); a fade in that the ⏸ and reduced motion switch off',
    /@media \(max-width: 640px\) \{\n  \.cf \{ padding: 0; \}/.test(CSS) && /@media \(orientation: portrait\) and \(max-width: 640px\) and \(pointer: coarse\) \{ \.cf\.has-turn \.cf-turn \{ display: block; \} \}/.test(CSS) && /root\.classList\.toggle\('has-turn', !!o\.turnHint\);/.test(APP)
    && /@media \(prefers-reduced-motion: no-preference\) \{\n  \.cf:not\(\[hidden\]\) \.cf-dialog \{ animation: cf-in/.test(CSS) && /html\.motion-off \.cf \.cf-dialog \{ animation: none; \}/.test(CSS)
    && /@keyframes cf-in \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/.test(CSS));
  check('  ...the ⤢ is a 34px square (44px for a finger), drawn as an icon, never colour alone', /\.cf-open \{ flex: 0 0 auto; display: inline-flex;[^}]*width: 34px; height: 34px;/.test(CSS) && /@media \(pointer: coarse\) \{ \.cf-open \{ width: 44px; height: 44px; \} \}/.test(CSS) && /\.cf-ico \{ display: block; width: 1em; height: 1em; background: currentColor;/.test(CSS));

  /* ═══ 4. after the first review (2026-10-14) ═══ */
  check('Esc is the chart\'s only when it has something to clear (a zoom, a crosshair); otherwise it closes the full-screen view',
    /else if \(k === 'Home' \|\| \(k === 'Escape' && isZoomed\(host\._view\)\)\) \{ host\._view = defaultView\(\); redraw\(\); \}/.test(CJ)
    && /else if \(e\.key === 'Escape'\) \{ if \(C\.hover == null\) return; setHover\(C, null\); e\.preventDefault\(\); return; \}/.test(WC));
  check('  ...a chart moved with moveBefore is restyled where it lands (Chrome kept the pop-up\'s layout on the wallet chart, and its ⤢ hidden)',
    /parent\.moveBefore\(node, before \|\| null\);\n        const d = node\.style\.display; node\.style\.display = 'none'; void node\.offsetWidth; node\.style\.display = d;/.test(APP));
  check('  ...an outside chart\'s frame is a Tab stop, and focus that wanders out of the pop-up is brought back (not from the layers above it)',
    /details > summary,iframe,video\[controls\],audio\[controls\],\[tabindex\]/.test(APP) && /document\.addEventListener\('focusin', \(e\) => \{\n    if \(!view \|\| !root \|\| root\.contains\(e\.target\)\) return;/.test(APP)
    && /e\.target\.closest\('#age-gate, \.wc-overlay, \.bp-overlay, #auth-modal, #invite-overlay, #toast-zone, \.tip-bubble'\)/.test(APP));
  check('  ...on a short screen (a phone held sideways) every chart is sized to the room under it, its time axis on screen',
    /@media \(max-height: 520px\) \{\n  \.cf \{ padding: 0; \}/.test(CSS) && /  \.cf \.oc-plot \{ min-height: 150px; min-height: max\(150px, calc\(100vh - 205px\)\); min-height: max\(150px, calc\(100dvh - 205px\)\); \}/.test(CSS)
    && /  \.cf \.chart-embed \{ min-height: 180px;/.test(CSS) && /  \.cf \.trk-dash \.wc-plot \{ min-height: 150px;/.test(CSS) && /  \.cf \.adm-chart-plot \{ min-height: 140px;/.test(CSS) && /  \.cf \.np-vol \{ min-height: 130px;/.test(CSS));
  check('  ...a resize drops the old crosshair and card, and decides again whether the transactions tape scrolls (and so is a Tab stop)',
    /cv\._hover = null; cv\.style\.cursor = ''; hideTip\(host\);\n        if \(host\._data\) paint\(host, true\);[^\n]*\n        fitTape\(host\);/.test(CJ) && /function fitTape\(host\) \{/.test(CJ) && /requestAnimationFrame\(\(\) => fitTape\(host\)\);/.test(CJ));
  check('  ...each ⤢ is named after its own chart, so two on a page can be told apart',
    /aria-label="Show the ' \+ esc\(host\.closest\('\[data-cf-unit\]'\)\.getAttribute\('data-cf-title'\) \|\| 'price chart'\) \+ ' full screen"/.test(CJ)
    && /aria-label="Show the ' \+ esc\(p\.token\.symbol \? '\$' \+ p\.token\.symbol \+ ' price chart' : 'price chart'\) \+ ' full screen"/.test(NP) && /aria-label="Show the value over time chart full screen"/.test(WC)
    && !opens.some(([, t]) => /aria-label="Show this chart full screen"/.test(t)));
  check('  ...copies leave out what only works on the page: the Loot Log\'s window toggle and its in-page link, the admin chart\'s pointer to the table below',
    /<div class="ll-toggle" role="group" aria-label="Achievement log window" data-cf-drop>/.test(GM) && /'<span data-cf-drop> · <a href="#rekt-h">/.test(GM)
    && /'<span class="sr-only" id="' \+ note \+ '" data-cf-drop>Every day’s number is in the table below\.<\/span>'/.test(ADM) && /aria-describedby="' \+ note \+ '"/.test(ADM)
    && /<figcaption>' \+ esc\(title\) \+ ' <small>' \+ esc\(sub\) \+ '<\/small><\/figcaption>' \+\n      '<button class="cf-open"/.test(ADM));
  check('  ...the switch\'s ⤢ stays at the top right on a phone, the source buttons wrapping beside it',
    /\.chart-switch\.has-src > \.chart-src-row \{ display: flex; align-items: flex-start; justify-content: space-between; gap: 0\.5rem; min-width: 0; \}/.test(CSS) && /\.chart-src-row > \.chart-src \{ flex: 0 1 auto; min-width: 0; \}/.test(CSS));
  check('a price chart is drawn at its own box\'s size (a phone\'s under 240px wide, a sideways phone\'s under 160px tall), not squeezed from a bigger picture',
    /const W = r\.width >= 1 \? Math\.round\(r\.width\) : 240, H = r\.height >= 1 \? Math\.round\(r\.height\) : 160;/.test(CJ));
} catch (e) {
  check('the suite ran to the end', false, e && e.message);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
