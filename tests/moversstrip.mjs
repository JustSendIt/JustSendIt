/* The top gainers strip under the nav on every page (owner, 2026-11-17: "on the market data banner, only show positive percentage
   gains" and "Also add that as a sticky banner to every page on the site"). public/movers-strip.js puts it right after the nav of every
   page that has the nav; it reads GET /api/market/movers (the server ranks the biggest 24 h rises among CoinGecko's 100 largest — only
   coins that went up). The throwaway server here has read no market, so the browser part answers /api/market/movers itself with the
   server's own answer (tests/fixtures/market/movers.json, dumped by tests/marketdata.mjs) in a muted headless Chrome.
   Checked: every page with the nav loads the strip (and only those); on a real page it sits right under the nav, sticks with it, and
   nav.js counts it into --nav-h so the page's own sticky bars (the Scanner's controls) clear it; it fits at 320 px (no sideways scroll,
   one row); each coin links to /market?coin=<id>; the strip says so in one line while it reads or when it cannot, and its room never
   comes and goes. No rows are written. */
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const PUB = path.join(ROOT, 'public');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const MOVERS = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'market', 'movers.json'), 'utf8'));

/* ─── 1. the pages and the code ─── */
const pages = readdirSync(PUB).filter((f) => f.endsWith('.html'));
const withNav = pages.filter((f) => /<nav class="nav/.test(readFileSync(path.join(PUB, f), 'utf8')));
const loads = (f) => { const s = readFileSync(path.join(PUB, f), 'utf8'); const m = s.match(/<script src="(\/?)nav\.js"><\/script>\n<script src="\1movers-strip\.js"><\/script>/); return !!m; };
check('every page with the nav (' + withNav.length + ') loads movers-strip.js right after nav.js, the same way it loads nav.js (absolute where the page is served below a path, like /u/<name>); no page without the nav does',
  withNav.length >= 18 && withNav.every(loads) && pages.filter((f) => !withNav.includes(f)).every((f) => !/movers-strip\.js/.test(readFileSync(path.join(PUB, f), 'utf8'))) && /src="\/movers-strip\.js"/.test(readFileSync(path.join(PUB, 'u.html'), 'utf8')),
  withNav.filter((f) => !loads(f)).join(', '));
const JS = readFileSync(path.join(PUB, 'movers-strip.js'), 'utf8'), NAVJS = readFileSync(path.join(PUB, 'nav.js'), 'utf8'), CSS = readFileSync(path.join(PUB, 'styles.css'), 'utf8');
check('  ...it reads only /api/market/movers, shows only rises (a row with a change at or under 0 is never drawn), links each coin to /market?coin=<id>, and on Market Data opens the coin in place (movers:open) instead of leaving the page',
  (JS.match(/fetch\(/g) || []).length === 1 && /fetch\('\/api\/market\/movers'/.test(JS) && /val\(r\.change24h\) > 0/.test(JS) && /'\/market\?coin=' \+ encodeURIComponent\(r\.id\)/.test(JS) && /new CustomEvent\('movers:open'/.test(JS));
check('  ...nav.js publishes --nav-bar-h (the nav alone, where the strip sticks) and --nav-h (the nav and the strip), and watches the strip from the start and on its own word (mvstrip:change)',
  /setProperty\('--nav-bar-h'/.test(NAVJS) && /setProperty\('--nav-h', Math\.round\(h \+ sh\)/.test(NAVJS) && /addEventListener\('mvstrip:change', watchStrip\)/.test(NAVJS) && /\n    watchStrip\(\);/.test(NAVJS)
  && /\.mv-strip \{ position: sticky; top: var\(--nav-bar-h, 58px\);/.test(CSS) && /margin: 0; padding: 0;/.test(CSS.slice(CSS.indexOf('.mv-strip {'), CSS.indexOf('.mv-strip {') + 400)));
check('  ...it moves only where motion is wanted: it stops for a pointer or the keyboard, stops as a row for a keyboard focus, and stands still under ⏸ and reduced motion; every font-size sits on the text floor',
  /\.mv-strip:hover \.mv-track, \.mv-strip:focus-within \.mv-track \{ animation-play-state: paused; \}/.test(CSS) && /\.mv-strip:has\(\.mv-mover:focus-visible\) \.mv-track \{ animation: none; \}/.test(CSS)
  && /html\.motion-off \.mv-track \{ animation: none; \}/.test(CSS) && /@media \(prefers-reduced-motion: reduce\) \{\n  \.mv-track \{ animation: none; \}/.test(CSS)
  && [...CSS.slice(CSS.indexOf('/* ===== The top gainers strip'), CSS.indexOf('@media (forced-colors: active) { .mv-mover')).matchAll(/font-size:\s*([^;]+);/g)].every((m) => /^max\(var\(--text-floor\)/.test(m[1].trim())));

/* ─── 2. in a real browser, on the site's own pages ─── */
function findChrome() {
  const c = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return c.find((p) => p && existsSync(p)) || null;
}
const CHROME = findChrome();
let MODE = 'ok';   // what /api/market/movers answers: 'ok' (the server's own answer), 'down' (503)
let chrome = null, chromeDir = null, ws = null, session = null, seq = 0;
const pend = new Map(), pageErrors = [];
const cdp = (method, params = {}, sid = session) => new Promise((ok, bad) => { const id = ++seq; pend.set(id, { ok, bad, method }); ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
async function startChrome() {
  chromeDir = mkdtempSync(path.join(os.tmpdir(), 'jsi-mvstrip-'));
  const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + chromeDir, '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--lang=en-US', 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; chrome.stderr.on('data', (d) => { err += d; });
  const portFile = path.join(chromeDir, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error('Chrome did not open its debugging port: ' + err.slice(0, 300));
  const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
  ws = new WebSocket('ws://127.0.0.1:' + port + wsPath);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('could not connect to Chrome')); });
  ws.onmessage = (m) => {
    const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.bad(new Error(p.method + ' ' + JSON.stringify(d.error))) : p.ok(d.result); }
    else if (d.method === 'Fetch.requestPaused') {
      const down = MODE === 'down', body = Buffer.from(JSON.stringify(down ? { error: 'The market could not be read just now' } : MOVERS));
      cdp('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: down ? 503 : 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }], body: body.toString('base64') }).catch(() => {});
    }
    else if (d.method === 'Runtime.exceptionThrown') pageErrors.push(((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description) || d.params.exceptionDetails.text || '').split('\n')[0]);
  };
  const t = await cdp('Target.createTarget', { url: 'about:blank' }, null);
  session = (await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*/api/market/movers*' }] });
}
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}
async function until(expr, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(60); }
  return null;
}
async function open(p, width = 1280, height = 900) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
  await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: BASE });   // the 18+ answer, so the age question does not cover the page
  await cdp('Page.navigate', { url: BASE + p });
  await until('document.readyState === "complete" && !!document.getElementById("mv-strip")');
}
const READY = '!!document.querySelector("#mv-strip-win .mv-list:not(.mv-dup) [data-mover]")';
const STATE = `(() => { const s = document.getElementById('mv-strip'), nav = document.querySelector('body > nav.nav'), cs = getComputedStyle(s), sr = s.getBoundingClientRect(), nr = nav.getBoundingClientRect(), root = getComputedStyle(document.documentElement);
  const links = [...s.querySelectorAll('.mv-list:not(.mv-dup) [data-mover]')];
  return { after: nav.nextElementSibling === s, pos: cs.position, top: Math.round(sr.top), navB: Math.round(nr.bottom), h: Math.round(sr.height), w: Math.round(sr.width), sw: document.documentElement.scrollWidth, iw: innerWidth,
    navH: parseFloat(root.getPropertyValue('--nav-h')), bar: parseFloat(root.getPropertyValue('--nav-bar-h')), n: links.length, hrefs: links.map((a) => a.getAttribute('href')), rises: links.every((a) => /▲ \\+/.test(a.textContent)), text: (s.querySelector('#mv-strip-win') || {}).textContent || '' }; })()`;

if (!CHROME) check('the browser part (no Chrome on this machine to run it)', false, 'set CHROME_PATH');
else try {
  await startChrome();
  const want = MOVERS.rows.map((r) => '/market?coin=' + r.id);
  const seen = {};
  for (const p of ['/', '/about', '/newpairs', '/communities', '/whitepaper', '/data']) {
    await open(p); await until(READY);
    seen[p] = await ev(STATE);
  }
  const bad = Object.entries(seen).filter(([, s]) => !(s.after && s.pos === 'sticky' && Math.abs(s.top - s.navB) <= 1 && s.h <= 64 && Math.abs(s.navH - (s.bar + s.h)) <= 1 && s.n === MOVERS.rows.length && s.rises && JSON.stringify(s.hrefs) === JSON.stringify(want) && s.sw <= s.iw));
  check('on the home page, About, the Scanner, Communities, the White Paper and the Data API page the strip sits right under the nav, sticky at its height, one row tall, and --nav-h counts the nav and the strip; it shows the server\'s rises in order (only rises), each a link to /market?coin=<id>, with no sideways scroll',
    Object.keys(seen).length === 6 && !bad.length, JSON.stringify(bad.length ? bad : seen).slice(0, 900));
  // scrolled: still under the nav; a page's own sticky bar (Market Data's side column, sticky from 1280 px) stops below the strip, not under it
  await open('/market'); await until(READY);
  await ev('window.scrollTo(0, Math.min(document.documentElement.scrollHeight, 2400)), true'); await sleep(300);
  const scrolled = await ev(`(() => { const s = document.getElementById('mv-strip').getBoundingClientRect(), n = document.querySelector('body > nav.nav').getBoundingClientRect(), c = [...document.querySelectorAll('#mkt-side, .np-viewswitch, .np-controls, .dtabs')].find((e) => e.getClientRects().length && getComputedStyle(e).position === 'sticky' && e.getBoundingClientRect().height > 0); const cr = c ? c.getBoundingClientRect() : null; return { y: scrollY, sTop: Math.round(s.top), sBottom: Math.round(s.bottom), nBottom: Math.round(n.bottom), ctl: cr ? Math.round(cr.top) : null, ctlSticky: c ? getComputedStyle(c).position : null }; })()`);
  check('  ...scrolled down a page the strip is still right under the nav, and a page\'s own sticky bar (Market Data\'s side column) stops below the strip, never under it',
    scrolled.y > 200 && Math.abs(scrolled.sTop - scrolled.nBottom) <= 1 && scrolled.ctl != null && scrolled.ctl >= scrolled.sBottom - 1, JSON.stringify(scrolled));
  // a phone: one row, inside the screen
  const phone = {};
  for (const w of [320, 390]) { await open('/', w, 760); await until(READY); phone[w] = await ev(STATE); }
  check('  ...at 320 and 390 px the strip is one row inside the screen and the page has no sideways scroll', [320, 390].every((w) => phone[w].h <= 64 && phone[w].w <= w && phone[w].sw <= phone[w].iw), JSON.stringify(phone).slice(0, 600));
  // a coin pressed on another page goes to Market Data with it
  await open('/about'); await until(READY);
  const first = MOVERS.rows[0].id;
  await ev('document.querySelector("#mv-strip-win .mv-list:not(.mv-dup) [data-mover]").click(), true');
  const went = await until('location.pathname === "/market" ? location.pathname + location.search : null', 8000);
  check('  ...a coin pressed on another page opens Market Data, which takes ?coin= out of the address once it has it', went === '/market' || went === '/market?coin=' + first, String(went));
  // the market cannot be read: one honest line in the strip's own room — it never comes and goes
  MODE = 'down';
  await open('/about'); await until('/Can’t read the top gainers just now/.test(document.getElementById("mv-strip-win").textContent)');
  const down = await ev(STATE);
  MODE = 'ok';
  check('  ...when the market cannot be read the strip keeps its room with one line ("Can’t read the top gainers just now.") — never an empty bar, never a made-up rise — and --nav-h still counts it',
    /^Can’t read the top gainers just now\.$/.test(down.text) && down.n === 0 && down.h <= 64 && Math.abs(down.navH - (down.bar + down.h)) <= 1, JSON.stringify(down));
  check('no script error on these pages', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  if (chrome) { try { ws.close(); } catch {} chrome.kill('SIGTERM'); await sleep(300); }
  if (chromeDir) { try { rmSync(chromeDir, { recursive: true, force: true }); } catch {} }
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
