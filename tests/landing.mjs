/* ===== The landing page in a real browser (2026-11-17) =====
   The owner had the landing page redone: about $SEND only (every $GWC mention gone), short, quick to read, and "super high
   tech" (public/landing.css, scoped to body.lp). tests/homedash.mjs holds the markup and the styles to that; this suite loads
   the page itself in a muted headless Chrome against the runner's throwaway server (its chain reads go to a dead address, so
   every reading takes its honest "not read yet" branch) and holds what only a browser can show:
     · at 320, 390, 768, 1024, 1280 and 1920 px: nothing past the screen's edge, every word at the text floor, every control at
       least 44px, no text cut with "…", and the dashboard a grid with no hole (the $SEND reading across the top, every row
       full: one column on a phone, two on a tablet, three from 1000px);
     · no $GWC or Generational Wealth Coin anywhere in the page once its scripts have run (the head, the tape, the body);
     · the section addresses (/swap, /guide, /tokens, /beta, /rocketize) scroll to their sections;
     · the swap quotes $SEND without a coin picker, and the page throws no script error;
     · the radar around the logo stops under ⏸ (html.motion-off) and under the OS reduced-motion setting.
   LANDING_SHOTS=<dir> saves a full-page screenshot per width there (for a person to look at; never in a normal run).
   Without Chrome (a CI runner with none) the suite says so and skips; on a machine that has one, a browser that will not
   start fails. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const results = [], notes = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

function findChrome() {
  const c = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return c.find((p) => p && fs.existsSync(p)) || null;
}
const CHROME = findChrome();
let ws = null, session = null, seq = 0, chromeProc = null, profile = null;
const pend = new Map(), errors = [];
const cdp = (method, params = {}, sid = session) => new Promise((ok, bad) => { const id = ++seq; pend.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
}
async function until(expr, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(100); }
  return null;
}
async function startChrome() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-landing-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--lang=en-US', '--hide-scrollbars', 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  chromeProc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let err = ''; chromeProc.stderr.on('data', (d) => { err += d; });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) throw new Error('Chrome did not open its debugging port: ' + err.slice(0, 300));
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  ws = new WebSocket('ws://127.0.0.1:' + port + wsPath);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('could not connect to Chrome')); });
  ws.onmessage = (m) => {
    const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.bad(new Error(JSON.stringify(d.error))) : p.ok(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text || '').split('\n')[0]);
  };
  const t = await cdp('Target.createTarget', { url: 'about:blank' }, null);
  session = (await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  // every visit a returning visitor who has answered the 18+ question, seen the intro and skipped the tour: the page itself, uncovered
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.clear(); localStorage.setItem('jsi-tour-v1', 'skipped'); sessionStorage.setItem('intro-seen', '1'); } catch (e) {}" });
  await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: BASE });
}
async function open(p, width, reduced) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  await cdp('Page.navigate', { url: BASE + p });
  await until('document.readyState === "complete" && !!document.querySelector(".dash-grid")', 15000);
  await sleep(1200);   // the scripts' first pass (the readings, the wallet list, the board) has had its turn
}

const LOOK = `(() => {
  const iw = innerWidth;
  const probe = document.createElement('span'); probe.style.fontSize = 'var(--text-floor)'; document.body.appendChild(probe);
  const floor = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
  const desc = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const out = [], small = [], tiny = [], cut = [];
  for (const root of [document.querySelector('.ticker'), document.querySelector('main'), document.querySelector('footer')]) {
    for (const el of root.querySelectorAll('*')) {
      if (!vis(el) || el.closest('.ticker-track, .hero-floats, .sr-only')) continue;   // the tape scrolls inside its clip; the drift field is clipped decoration
      const shared = el.closest('.onchain-chart');   // the chart widget is shared with the Scanner and the watchlist, which hold it to these rules
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      // past the screen with nothing between it and the page that clips or scrolls it; or past the box of a clipping ancestor
      // (.hero and every tile clip: a word cut there is as lost as one past the edge); a scroll box may hold more than it shows
      let a = el.parentElement, clip = null;
      while (a && a !== document.body) { const o = getComputedStyle(a).overflowX; if (o !== 'visible') { clip = { a, o }; break; } a = a.parentElement; }
      if (!clip) { if (r.right > iw + 1 || r.left < -1) out.push(desc(el) + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); }
      else if (/hidden|clip/.test(clip.o) && !shared && !el.closest('[aria-hidden="true"]')) {
        const cr = clip.a.getBoundingClientRect();
        if (r.right > cr.right + 1 || r.left < cr.left - 1) out.push(desc(el) + ' cut by ' + desc(clip.a) + ' ' + Math.round(r.left) + '..' + Math.round(r.right) + ' in ' + Math.round(cr.left) + '..' + Math.round(cr.right));
      }
      const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (text && !shared && /hidden|clip/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) cut.push(desc(el) + ' clips its own text');
      if (text && !shared && parseFloat(cs.fontSize) < floor - 0.5) small.push(desc(el) + ' ' + cs.fontSize);
      if (text && (cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none'))) cut.push(desc(el));
      if (!shared && el.matches('button, .btn, summary, input:not([type=hidden]), select, [role=button], .copy-btn') && (r.height < 43.5 || r.width < 43.5)) tiny.push(desc(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  }
  const grid = document.querySelector('.dash-grid'), g = grid.getBoundingClientRect();
  const tiles = [...grid.children].filter(vis).map((t) => ({ id: t.id, r: t.getBoundingClientRect() }));
  const rows = new Map(); for (const t of tiles) { const k = Math.round(t.r.top); rows.set(k, (rows.get(k) || []).concat(t)); }
  const holes = [...rows.values()].filter((row) => Math.abs(Math.max(...row.map((t) => t.r.right)) - g.right) > 2 || Math.abs(Math.min(...row.map((t) => t.r.left)) - g.left) > 2).map((row) => row.map((t) => t.id).join('+'));
  const send = tiles.find((t) => t.id === 'dash-send');
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const video = document.getElementById('dash-watch');
  return { iw, floor, videoHidden: !!(video && video.hidden), out: out.slice(0, 8), small: small.slice(0, 8), tiny: tiny.slice(0, 8), cut: cut.slice(0, 8), holes, cols, rows: rows.size, tiles: tiles.length,
    sendFull: !!send && Math.abs(send.r.width - g.width) < 2, docH: document.documentElement.scrollHeight };
})()`;

if (!CHROME) {
  if (process.env.CI) notes.push('skipping the browser walk: no Chrome or Chromium on this runner (set CHROME_PATH to run it)');
  else check('a Chrome or Chromium to load the landing page in (set CHROME_PATH)', false, 'none found');
} else {
  let up = false;
  try { await startChrome(); up = true; }
  catch (e) {
    if (process.env.CI) notes.push('skipping the browser walk: Chrome would not start here (' + e.message.slice(0, 160) + ')');
    else check('headless Chrome starts and takes commands', false, e.message);
  }
  if (up) {
    const SHOTS = process.env.LANDING_SHOTS || '';
    const COLS = { 320: 1, 390: 1, 768: 2, 1024: 3, 1280: 3, 1920: 3 };
    for (const w of Object.keys(COLS).map(Number)) {
      try {
        await open('/', w);
        const L = await ev(LOOK);
        check(w + 'px: nothing past the screen\'s edge, every word at the text floor (' + L.floor + 'px), every control 44px, nothing cut with "…"',
          !L.out.length && !L.small.length && !L.tiny.length && !L.cut.length, JSON.stringify({ out: L.out, small: L.small, tiny: L.tiny, cut: L.cut }));
        check('  ...the dashboard: ' + COLS[w] + ' column(s), the $SEND reading across the top, every row full (' + L.tiles + ' tiles in ' + L.rows + ' rows' + (L.videoHidden ? ', the video tile hidden: no video file here' : '') + ')',
          L.cols === COLS[w] && L.sendFull && !L.holes.length && L.tiles === (L.videoHidden ? 9 : 10), JSON.stringify({ cols: L.cols, sendFull: L.sendFull, holes: L.holes, tiles: L.tiles, videoHidden: L.videoHidden }));
        if (SHOTS) {
          await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: Math.min(L.docH, 16000), deviceScaleFactor: 1, mobile: w < 768 });
          await sleep(400);
          fs.mkdirSync(SHOTS, { recursive: true });
          const H = w < 768 ? 1300 : 1100;   // the page in slices a person can read
          for (let y = 0, i = 0; y < L.docH; y += H, i++) {
            const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y, width: w, height: Math.min(H, L.docH - y), scale: 1 } });
            fs.writeFileSync(path.join(SHOTS, 'landing-' + w + '-' + String(i).padStart(2, '0') + '.png'), Buffer.from(shot.data, 'base64'));
          }
        }
      } catch (e) { check('the look at ' + w + 'px ran to the end', false, e && e.message); }
    }

    try {
      await open('/', 1280);
      const words = await ev(`(() => { const html = document.documentElement.outerHTML.replace(/<script\\b[^>]*src=[^>]*><\\/script>/g, ''); return { html: (html.match(/\\bgwc\\b|generational/gi) || []).length, text: (document.body.innerText.match(/\\bgwc\\b|generational/gi) || []).length, title: document.title }; })()`);
      check('no $GWC or Generational Wealth Coin anywhere on the page once its scripts have run: the head, the tape, the body', words.html === 0 && words.text === 0, JSON.stringify(words));
      check('  ...and the swap has no coin picker: one pair, ETH → $SEND', await ev('!document.getElementById("choice-GWC") && !document.getElementById("choice-SEND") && /You pay\\s+ETH[\\s\\S]*you get\\s+\\$SEND/.test(document.querySelector(".lp-swap-head").textContent)'));
      await ev('(() => { const a = document.getElementById("swap-amt"); a.value = "0.01"; a.dispatchEvent(new Event("input", { bubbles: true })); })()');
      const q = await until('(() => { const t = document.getElementById("swap-quote").textContent; return t && t !== "quoting…" && t !== "enter an amount ☝️" ? t : null; })()', 12000);
      check('  ...an amount asks for a $SEND quote and says what came back (the runner\'s chain is a dead address: "quote unavailable")', q === 'quote unavailable 📡' || /^~[\d,]+ \$SEND/.test(q || ''), q);
      check('  ...a preset fills the amount', await ev('(() => { document.querySelector("[data-amt=\\"0.05\\"]").click(); return document.getElementById("swap-amt").value === "0.05"; })()'));
      const before = await ev('getComputedStyle(document.querySelector(".hero-logo-btn"), "::before").animationName');
      await ev('document.documentElement.classList.add("motion-off")');
      const paused = await ev('[getComputedStyle(document.querySelector(".hero-logo-btn"), "::before").animationName, getComputedStyle(document.querySelector(".hero-logo-btn"), "::after").animationName].join()');
      check('the radar turns, and stops under ⏸ (html.motion-off)', before === 'lp-turn' && paused === 'none,none', before + ' → ' + paused);
      await open('/', 1280, true);
      const reduced = await ev('[getComputedStyle(document.querySelector(".hero-logo-btn"), "::before").animationName, getComputedStyle(document.querySelector(".hero-logo-btn"), "::after").animationName].join()');
      check('  ...and under the OS reduced-motion setting', reduced === 'none,none', reduced);
    } catch (e) { check('the page walk ran to the end', false, e && e.message); }

    for (const s of ['swap', 'guide', 'tokens', 'beta', 'rocketize']) {
      try {
        await open('/' + s, 1280, true);
        const at = await until(`(() => { const r = document.getElementById(${JSON.stringify(s)}).getBoundingClientRect(); return scrollY > 200 && r.top > -2 && r.top < 260 ? Math.round(r.top) : null; })()`, 6000);
        check('/' + s + ' opens the page at its section', at !== null && await ev('location.pathname') === '/' + s, at);
      } catch (e) { check('/' + s + ' ran to the end', false, e && e.message); }
    }
    check('no script error on any load', errors.length === 0, errors.slice(0, 4).join(' | '));
  }
}

try { if (ws) ws.close(); } catch {}
if (chromeProc) { try { process.kill(-chromeProc.pid, 'SIGKILL'); } catch {} try { chromeProc.kill('SIGKILL'); } catch {} await sleep(300); }
if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
for (const n of notes) console.log('NOTE ' + n);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
