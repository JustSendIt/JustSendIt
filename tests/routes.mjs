/* Page routes (owner, 2026-10-15: "Fix all the domain page routes so they just say their name in the website domain so its
   sendrh.com/about not sendrh.com/about.html ... make sure every page is just their name and not the . file name or a # in
   front of it but make sure all functionality and page routes still work as they currently do").
   Drives the real server: every page at its name; every old spelling a single 301 to it with the query kept; the home page's
   sections at their own addresses; the template, unknown names, slash-ended and nested paths never served as pages; and the
   page code that keeps a # out of the address. No database rows. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const read = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
// a raw request: the path goes out exactly as written (fetch would tidy /x/../ and the like first)
const raw = (method, p, headers) => new Promise((resolve) => {
  const r = http.request({ host: 'localhost', port: PORT, method, path: p, headers: headers || {} }, (res) => {
    let b = ''; res.on('data', (d) => { b += d; });
    res.on('end', () => resolve({ status: res.statusCode, text: b, location: res.headers.location || '', type: res.headers['content-type'] || '', etag: res.headers.etag || '', cc: res.headers['cache-control'] || '' }));
  });
  r.on('error', () => resolve({ status: 0, text: '', location: '', type: '', etag: '', cc: '' })); r.end();
});
const ROUTES = createRequire(import.meta.url)(path.join(ROOT, 'lib', 'routes.js'));
const PAGES = ROUTES.pageNames(path.join(ROOT, 'public'));

try {
  /* ═══ 1. every page at its name ═══ */
  const names = [...PAGES].filter((n) => n !== 'index' && n !== 'community').sort();
  const wrong = [];
  for (const n of names) { const r = await raw('GET', '/' + n); if (r.status !== 200 || !/text\/html/.test(r.type) || !/<title>/.test(r.text)) wrong.push('/' + n + ' → ' + r.status); }
  check('every page is served at its name: ' + names.map((n) => '/' + n).join(' '), names.length >= 15 && !wrong.length, wrong.join(' | '));
  const home = await raw('GET', '/'), comm = await raw('GET', '/community?id=1');
  check('  ...the home page at /, and a community at /community?id=N (its own page, or a 404 for an id that is not there)', home.status === 200 && /<title>/.test(home.text) && (comm.status === 200 || comm.status === 404), home.status + ' ' + comm.status);
  const a1 = await raw('GET', '/about'), a304 = await raw('GET', '/about', { 'If-None-Match': a1.etag }), ahead = await raw('HEAD', '/about');
  check('  ...with the same caching as before: an ETag, a 304 when it has not changed, and HEAD', a1.etag && a304.status === 304 && ahead.status === 200 && ahead.text === '', [a1.etag, a304.status, ahead.status].join(' '));

  /* ═══ 2. every old spelling: one 301 to the name, the query kept ═══ */
  const olds = [];
  for (const n of names.concat(['community'])) {
    const q = n === 'community' ? '?id=5&y=2' : '?x=1&y=2';   // a community page is a community: it carries its id
    const r = await raw('GET', '/' + n + '.html' + q);
    if (r.status !== 301 || r.location !== '/' + n + q) olds.push('/' + n + '.html → ' + r.status + ' ' + r.location);
  }
  check('every old /<page>.html address is a 301 straight to /<page>, its query kept (shared links, bookmarks, old notifications)', !olds.length, olds.join(' | '));
  const forms = [['/About', '/about'], ['/ABOUT.HTML?q=1', '/about?q=1'], ['/about/', '/about'], ['/about.html/', '/about'], ['/index', '/'], ['/index.html?ref=x', '/?ref=x'],
    ['/Newpairs?scan=0xabc', '/newpairs?scan=0xabc'], ['/community.html?id=5', '/community?id=5'], ['/squad.html?id=3', '/squad?id=3']];
  const bad = [];
  for (const [from, to] of forms) { const r = await raw('GET', from); if (r.status !== 301 || r.location !== to) bad.push(from + ' → ' + r.status + ' ' + r.location); }
  check('  ...and so is every other spelling: capitals, a trailing slash, /index', !bad.length, bad.join(' | '));
  const cNoId = await raw('GET', '/community.html'), cNoId2 = await raw('GET', '/community');
  check('  ...an old community link with no id goes straight to the list of communities, in one hop', cNoId.status === 301 && cNoId.location === '/communities' && cNoId2.status === 301 && cNoId2.location === '/communities', cNoId.location + ' ' + cNoId2.location);
  const dots = await raw('GET', '/x/../about'), dot2 = await raw('GET', '/./wall');
  check('  ...dot segments are resolved before routing (/x/../about is /about)', dots.status === 200 && dot2.status === 200, dots.status + ' ' + dot2.status);
  const loc = [];
  for (const p of ['//evil.com/about.html', '/.//evil.com/about', '/%2f%2fevil.com/about.html']) { const r = await raw('GET', p); if (r.location && !/^\/[^/\\]/.test(r.location)) loc.push(p + ' → ' + r.location); }
  check('  ...a redirect never leaves the site (the Location is built from the page name, never the raw path)', !loc.length, loc.join(' | '));

  /* ═══ 3. the home page's sections ═══ */
  const secs = [];
  for (const s of ROUTES.HOME_SECTIONS) {
    const r = await raw('GET', '/' + s);
    if (r.status !== 200 || !/<link rel="canonical" href="[^"]*\/">/.test(r.text) || !r.text.includes('id="' + s + '"')) secs.push('/' + s + ' → ' + r.status);
  }
  check('/guide, /swap, /tokens, /beta and /rocketize serve the home page (its canonical stays /), which has each section', ROUTES.HOME_SECTIONS.join() === 'guide,swap,tokens,beta,rocketize' && !secs.length, secs.join(' | '));
  const sx = await raw('GET', '/swap.html'), ss = await raw('GET', '/swap/');
  check('  ...a section is not a file: /swap.html is a 404, /swap/ a 301 to /swap', sx.status === 404 && ss.status === 301 && ss.location === '/swap', sx.status + ' ' + ss.status + ' ' + ss.location);
  // owner, 2026-10-21: sendrh.com/rocketize goes to Rocketize your pic. The section shares its name with its script and styles,
  // which must still load as files (the home page links them relatively: at /rocketize they resolve to /rocketize.js and .css)
  const rz = await raw('GET', '/rocketize'), rzJs = await raw('GET', '/rocketize.js'), rzCss = await raw('GET', '/rocketize.css'), rzUp = await raw('GET', '/Rocketize/?a=1');
  check('  .../rocketize is the Rocketize your pic section (the picture editor), and rocketize.js and rocketize.css still load as files',
    rz.status === 200 && /<section id="rocketize"[^>]*>[\s\S]*?id="rz-pick"/.test(rz.text) && /<script src="rocketize\.js(\?v=[\w-]+)?"><\/script>/.test(rz.text) && /<link rel="stylesheet" href="rocketize\.css(\?v=[\w-]+)?">/.test(rz.text)
    && rzJs.status === 200 && /\(function \(\) \{/.test(rzJs.text) && rzCss.status === 200 && !/<html/i.test(rzCss.text) && rzUp.status === 301 && rzUp.location === '/rocketize?a=1',
    [rz.status, rzJs.status, rzCss.status, rzUp.status, rzUp.location].join(' '));

  /* ═══ 4. never a page where there should be none ═══ */
  const not = [];
  for (const p of ['/u', '/u.html', '/u/', '/no-such-page', '/styles', '/assets', '/fonts', '/api', '/about/extra', '/profile/settings', '/.DS_Store', '/.env']) {
    const r = await raw('GET', p);
    if (r.status !== 404 && !(r.status === 301 && /^\/(?!profile\/|about\/)/.test(r.location))) not.push(p + ' → ' + r.status + ' ' + r.location);
  }
  check('the wall template, unknown names, nested paths and hidden files are a 404 (relative styles and scripts would break under a nested path)', !not.length, not.join(' | '));
  const legacyU = await raw('GET', '/u.html?u=someone&x=1'), legacyU2 = await raw('GET', '/u?u=someone');
  check('  ...the old /u.html?u=<name> (and /u?u=) still reach that wall', legacyU.status === 301 && legacyU.location === '/u/someone?x=1' && legacyU2.status === 301 && legacyU2.location === '/u/someone', legacyU.location + ' ' + legacyU2.location);
  const w1 = await raw('POST', '/about'), w2 = await raw('OPTIONS', '/wall'), w3 = await raw('POST', '/swap');
  check('  ...and a page is only read: POST and OPTIONS on a clean address are refused (405)', w1.status === 405 && w2.status === 405 && w3.status === 405, [w1.status, w2.status, w3.status].join(' '));

  /* ═══ 5. the route table itself ═══ */
  const R = (p) => JSON.stringify(ROUTES.resolve(PAGES, p));
  check('lib/routes.js: the one table the server and scripts/check.mjs share', R('/about') === '{"page":"about"}' && R('/about.html') === '{"redirect":"/about"}' && R('/') === '{"page":"index"}'
    && R('/swap') === '{"section":"swap"}' && R('/rocketize') === '{"section":"rocketize"}' && R('/rocketize.html') === 'null' && R('/u') === 'null' && R('/admin') === 'null' && R('/assets/x.png') === 'null' && R('/nope') === 'null' && ROUTES.cleanPath('index.html') === '/' && ROUTES.cleanPath('wall.html') === '/wall');

  /* ═══ 6. the page code: no # in the address ═══ */
  const DT = read('dashtabs.js'), HJ = read('home.js'), SY = read('sendy.js'), EG = read('eggs.js'), AU = read('auth.js'), CHK = readFileSync(path.join(ROOT, 'scripts', 'check.mjs'), 'utf8');
  check('the dashboard no longer writes #tab-… into the address (a refresh restores the tab from this device); a #tab- link it follows is tidied away',
    !/replaceState\(null, '', '#tab-' \+ name\)/.test(DT) && /if \(\/\^#tab-\/\.test\(location\.hash\)\) \{ try \{ history\.replaceState\(history\.state, '', location\.pathname \+ location\.search\); \} catch \{\} \}/.test(DT));
  check('the home page scrolls to a section at its address, moves between them with no reload (Back too), and turns an old /#swap into /swap',
    /const at = \(\) => \{ const m = \/\^\\\/\(guide\|swap\|tokens\|beta\|rocketize\)\\\/\?\$\/\.exec\(location\.pathname\);/.test(HJ)
    && /const SECTIONS = \['guide', 'swap', 'tokens', 'beta', 'rocketize'\];/.test(HJ) && /\/\^#\(guide\|swap\|tokens\|beta\|rocketize\)\$\/\.test\(location\.hash\)/.test(HJ)
    && /\/\^\\\/\(guide\|swap\|tokens\|beta\|rocketize\)\$\/\.exec\(a\.getAttribute\('href'\) \|\| ''\)/.test(HJ) && /history\.pushState\(history\.state, '', '\/' \+ m\[1\]\)/.test(HJ)
    && /history\.replaceState\(history\.state, '', '\/' \+ location\.hash\.slice\(1\) \+ location\.search\)/.test(HJ) && /if \(location\.pathname === shownPath\) return;/.test(HJ));
  check('Sendy knows the page by its name (and its sections as the home page), and turns a page name in an answer into a link; the eggs find their page the same way',
    /'\/newpairs': \{ tips:/.test(SY) && /return \/\^\\\/\(index\|guide\|swap\|tokens\|beta\|rocketize\)\$\/\.test\(p\) \? '\/' : p;/.test(SY) && /\|whitepaper\|guide\|swap\|tokens\|beta\|rocketize\)\(\?:/.test(SY) && /\(\?<!\[\\w\/\.\]\)\\\/\(\?:about\|arcade\|communities/.test(SY)
    && /\/\^\\\/\(index\(\\\.html\)\?\|guide\|swap\|tokens\|beta\|rocketize\)\$\/\.test\(p\)\) return 'index\.html';/.test(EG)
    && /if \(\/\^\\\/\(guide\|swap\|tokens\|beta\|rocketize\)\$\/\.test\(href\) && document\.getElementById\(href\.slice\(1\)\)\) return sound\('select'\);/.test(read('sfx.js')));
  check('sign-in and two-factor still know when they are on the dashboard (/profile, or an old /profile.html on its way there)', /const onProfile = \/\^\\\/profile\(\\\.html\)\?\\\/\?\$\/\.test\(location\.pathname\);/.test(AU));
  const SQ = read('squad.js'), SRV = readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  check('the squad page keeps its tab out of the address too (remembered for this browser tab; a #calls link opens Calls, then is tidied)',
    !/history\.replaceState\(null, '', location\.pathname \+ location\.search \+ '#' \+ which\)/.test(SQ) && /sessionStorage\.setItem\('sqd:tab:' \+ id, which\);/.test(SQ)
    && /if \(TABS\.indexOf\(h\) >= 0\) \{ tab = h; try \{ history\.replaceState\(history\.state, '', location\.pathname \+ location\.search\); \} catch \{\} return; \}/.test(SQ));
  check('Sendy is told the pages and sections by their names (no .html, no /#): its site map and the heading over each page\'s text',
    /the How to Buy guide \(\/guide\), the swap \(\/swap\), the tokens \(\/tokens\), the beta board \(\/beta\), Rocketize your pic \(\/rocketize:/.test(SRV) && !/\(\/#(guide|swap|tokens)\)/.test(SRV) && /'=== the page ' \+ ROUTES\.cleanPath\(f \+ '\.html'\)/.test(SRV));
  check('scripts/check.mjs fails a page link by file name, a relative page link in a script, and a link to a page the server does not answer',
    /links a page by its file name/.test(CHK) && /links a page relatively/.test(CHK) && /links to a page the server does not answer/.test(CHK) && /const ROUTES = createRequire\(import\.meta\.url\)\(path\.join\(ROOT, 'lib', 'routes\.js'\)\);/.test(CHK));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
