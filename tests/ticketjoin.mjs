/* ===== The ticket's last step: one press makes the account, and leaves the page as it found it (2026-11-16) ===================
   e7cab65 (#7) put the wallet sign-up on the ticket's last step: the @username, an optional email and password, then one press that
   opens the sign-up dialog already asking the wallet for its read-only signature. A review of it in a real browser found:
     · SU-1 every hand-off from that step (the wallet, "Use email instead", Burn Verification's Continue) opened the sign-up dialog
       OVER the ticket and only then closed the ticket. The dialog remembered the ticket's scroll lock as the page's own and put it
       back when it closed, with nothing left open to take it off: a new member's page could not scroll until they left it. A
       cancelled picker and a closed dialog did the same, and focus fell to <body>.
     · SU-2 the press is the sign-in panel's own button, made at once — so that panel's "Set up two-factor right after" box could
       never be ticked, and its terms line was never in view before the account existed. Both are on the step now.
     · SU-4 the Burn Verification continuation began with focus on <body> (a hidden email field had taken it).
     · SU-5 the "Add an email & password" toggle was 24px tall on a phone.
     · SU-6 the typed password stayed in the ticket's hidden fields, and a reopened ticket still said "Opening your wallet…".
     · SU-7 after "Use email instead" focus sat on the unselected Wallet tab.
   1. A server of this suite's own on a throwaway database, set as the live site is: no terms step (TOS_GATE off). Each walk redeems a
      code of its own, minted in that database (a code admits one account).
   2. A muted headless Chrome with a fake EIP-6963 wallet whose signatures are made here, in Node, with a fresh ethers key. Each walk
      is a new visitor (cookies, storage, its own address for the per-address limits) on /about, starting from its "Create account"
      button: the wallet join, the 2FA box, "Use email instead", Burn Verification, a cancelled picker; and the step's look at 320,
      390 and 1280 px.
   3. The sign-in dialog itself, chooser first (2026-11-24, owner: "as intuitive as possible all the way through clicking the button
      to getting an account"): Continue with wallet connects before anything is asked — a returning wallet is signed in, a new one
      gets its @username step in the same dialog, with no second signature; a cancelled picker or signature, Back, Esc, the focus
      trap, an expired proof, and the look of every step at 320 and 1280 px. The walks reuse the accounts the earlier walks make. Without Chrome (a CI runner with none) the browser part is skipped and the run says so; on a machine that has
      one, a browser that will not start fails.
   Everything it makes is in its own temporary directories, deleted at the end. Nothing leaves this machine. */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, ETHERS } from './_paths.mjs';

const { Wallet, getBytes } = createRequire(import.meta.url)(ETHERS);
const results = [], notes = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ═══ 1. a server of our own ═══ */
const freePort = async () => {
  for (;;) {
    const p = await new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => ok(q)); }); });
    if (p !== 8642) return p;   // never the live server's port
  }
};
const PORT = await freePort();
const B = 'http://localhost:' + PORT;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-ticketjoin-'));
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
fs.writeFileSync(path.join(dataDir, '.data_key'), randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
const guard = path.join(dataDir, 'guard.mjs');
fs.writeFileSync(guard, `const real = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  let u = null; try { u = new URL(typeof input === 'string' ? input : (input && input.url) || String(input)); } catch {}
  if (u && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]')) return real.call(this, input, init);
  throw new TypeError('fetch failed');
};
`);
const DEAD = 'http://127.0.0.1:9/';
const env = { ...process.env, PORT: String(PORT), JSI_DATA_DIR: dataDir, DATA_DIR: dataDir, BASE_URL: B, NODE_ENV: 'test', SEED_INVITE_CODE: '12345', TOS_GATE: '0',
  TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback', SEED_CODES_OPEN: '1', DATA_KEY: '', DATA_KEY_FILE: '', BACKUP_DIR: path.join(dataDir, 'backups'), KEY_ROTATE_EXTRA_DBS: '',
  RPC_URL: DEAD, CHART_SRC_DS_URL: DEAD, CHART_SRC_GT_URL: DEAD, TOKSEARCH_GT_URL: DEAD, TOKSEARCH_DS_URL: DEAD, MC_DEXSCREENER_URL: DEAD, MC_GECKO_URL: DEAD, MC_GOPLUS_URL: DEAD,
  ETH_RPC_URL: DEAD, SOL_RPC_URL: DEAD, JUPITER_URL: DEAD, MARKET_COLLECT: '0', BLOCKSCOUT_URL: '', OUTBOUND_MAX_WAIT_MS: '2000', VOICE_MEMOS: '', ANTHROPIC_API_KEY: '',
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', FACEBOOK_APP_ID: '', FACEBOOK_APP_SECRET: '', X_CLIENT_ID: '', X_CLIENT_SECRET: '', INSTAGRAM_APP_ID: '', INSTAGRAM_APP_SECRET: '' };
let server = null, slog = '';
async function boot() {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', pathToFileURL(guard).href, 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
  for (let i = 0; i < 200; i++) { if (server.exitCode != null) return false; try { if ((await fetch(B + '/healthz')).ok) return true; } catch {} await sleep(150); }
  return false;
}
let db = null;
// a site-minted code (owner_id NULL, kept open by SEED_CODES_OPEN), one per walk
function mintCode() {
  if (!db) { db = new DatabaseSync(path.join(dataDir, 'app.db')); db.exec('PRAGMA busy_timeout = 5000'); }
  const code = 'TJ' + randomBytes(5).toString('hex').toUpperCase();
  db.prepare('INSERT INTO invite_codes (code, owner_id, created_at) VALUES (?,NULL,?)').run(code, Date.now());
  return code;
}
async function halt() { if (!server) return; const s = server; server = null; const done = new Promise((r) => s.once('exit', r)); try { s.kill('SIGTERM'); } catch {} await Promise.race([done, sleep(4000)]); }

/* ═══ 2. in a browser ═══ */
function findChrome() {
  const c = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return c.find((p) => p && fs.existsSync(p)) || null;
}
const CHROME = findChrome();
let ws = null, session = null, seq = 0, chromeProc = null, profile = null;
const pend = new Map(), errors = [], wallets = new Map();
let signs = 0;   // signatures the fake wallet has made (one sign-up = one signature, whichever way the name comes)
const cdp = (method, params = {}, sid = session) => new Promise((ok, bad) => { const id = ++seq; pend.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
}
async function until(expr, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(80); }
  return null;
}
// the fake wallet asks Node to sign: the key never enters the page
async function onSign(payload) {
  let id = 0, sig = null, err = null;
  try {
    const p = JSON.parse(payload); id = p.id;
    const w = wallets.get(String(p.address).toLowerCase());
    if (!w) err = 'unknown account';
    else { sig = await w.signMessage(/^0x([0-9a-f]{2})*$/i.test(p.msg) ? getBytes(p.msg) : String(p.msg)); signs++; }
  } catch (e) { err = e.message; }
  cdp('Runtime.evaluate', { expression: 'window.__jsiSigned && window.__jsiSigned(' + JSON.stringify(id) + ', ' + JSON.stringify(sig) + ', ' + JSON.stringify(err) + ')' }).catch(() => {});
}
async function startChrome() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-ticketjoin-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--lang=en-US', 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  // its own process group, so the whole browser goes at the end even if it was still starting (a slow start under load was left running)
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
    else if (d.method === 'Runtime.bindingCalled' && d.params.name === '__jsiSign') onSign(d.params.payload);
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text || '').split('\n')[0]);
  };
  const t = await cdp('Target.createTarget', { url: 'about:blank' }, null);
  session = (await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Runtime.addBinding', { name: '__jsiSign' });
}
let walletScript = null;
// an EIP-6963 wallet on Robinhood Chain that signs whatever it is asked (a real wallet shows the message first)
async function setWallet(addr) {
  if (walletScript) { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: walletScript }); walletScript = null; }
  if (!addr) return;
  walletScript = (await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const ADDR = ${JSON.stringify(addr)}, pending = new Map(); let n = 0;
    window.__jsiSigned = (id, sig, err) => { const p = pending.get(id); pending.delete(id); if (!p) return; if (err) p.no(Object.assign(new Error(err), { code: 4001 })); else p.ok(sig); };
    const provider = { request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ADDR];
      if (method === 'eth_chainId') return '0x1237';
      if (method === 'wallet_switchEthereumChain') return null;
      if (method === 'personal_sign') {
        if (window.__jsiDecline) { window.__jsiDecline = false; throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); }   // the person says no, once
        const id = ++n; return new Promise((ok, no) => { pending.set(id, { ok, no }); window.__jsiSign(JSON.stringify({ id, msg: params[0], address: params[1] })); });
      }
      throw Object.assign(new Error('unsupported ' + method), { code: 4200 });
    }, on() {}, removeListener() {} };
    const info = Object.freeze({ uuid: '6f1c7e2a-0000-4000-8000-0000000000aa', name: 'Test Wallet', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E', rdns: 'test.ticketjoin.wallet' });
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
  })();` })).identifier;
}
function newWallet() { const w = Wallet.createRandom(); wallets.set(w.address.toLowerCase(), w); return w.address; }
let ipN = 1 + (randomBytes(1)[0] % 100);
// a new visitor: no cookies but the 18+ answer, nothing stored, no intro or visitor tour in the way, its own address
async function fresh(width) {
  await cdp('Network.clearBrowserCookies');
  await cdp('Network.setExtraHTTPHeaders', { headers: { 'X-Forwarded-For': '198.51.100.' + (ipN++ % 250 + 1) } });
  await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: B });
  const phone = width < 768;
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: phone ? 760 : 900, deviceScaleFactor: 1, mobile: phone });
  await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await cdp('Page.navigate', { url: B + '/robots.txt' });
  await until('location.pathname === "/robots.txt" && document.readyState === "complete"', 5000);
  await ev(`(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('jsi-tour-v1', 'done'); sessionStorage.setItem('intro-seen', '1'); return true; })()`);
}
async function openAbout() {
  await cdp('Page.navigate', { url: B + '/about' });
  await until('document.readyState === "complete" && window.AUTH && AUTH.startJoin && document.getElementById("auth-modal") && document.getElementById("gs-join")', 15000);
  await until('document.body.style.overflow === ""', 10000);   // nothing up over the page yet
  await sleep(400);
}
const DIALOG_UP = `!!document.querySelector('#auth-modal:not([hidden]), #invite-overlay[data-open], .wc-overlay:not([hidden]), .bp-overlay:not([hidden])')`;
const FOCUS = `(() => { const a = document.activeElement; return a ? (a.id || a.tagName) : null; })()`;
// "Create account →" on /about, focused as a reader's press leaves it, then the ticket: I have a code, the code, the last step
async function redeem() {
  await ev('document.getElementById("inv-have").click(), true');
  await until('document.querySelector("#step-code[data-active]")', 4000);
  await ev(`(() => { document.getElementById('inv-in').value = ${JSON.stringify(mintCode())}; document.getElementById('inv-go').click(); return true; })()`);
  return !!await until('document.querySelector("#invite-overlay[data-open] #step-join[data-active]")', 8000);
}
/* Open sign-up (2026-11-24): "Create account" opens the sign-up dialog itself (checked below). The ticket's last step — what these
   walks test — is where a member's code leads, entered on purpose ("Got a code from a member? Enter it"), so they come in that way. */
async function toJoinStep() {
  await ev('(() => { const b = document.getElementById("gs-join"); b.focus(); AUTH.openInvite({ code: true }); return true; })()');
  if (!await until('document.querySelector("#invite-overlay[data-open] #step-code[data-active]")', 10000)) return false;
  return redeem();
}
async function pickWallet() {
  if (!await until('document.querySelector(".wc-overlay:not([hidden]) .wc-item")', 10000)) return false;
  return ev('(() => { const b = [...document.querySelectorAll(".wc-overlay .wc-item")].find((x) => /Test Wallet/.test(x.textContent)); if (!b) return false; b.click(); return true; })()');
}
// the reader's own scroll: wheel ticks over the page, not a script's scrollTo (which a scroll lock does not stop)
async function wheelScrolls() {
  // instant: the site's html is scroll-behavior: smooth, and a smooth trip back to the top (from wherever focus left the page)
  // still running when the wheel turns carries the page back to 0 over it
  await ev('window.scrollTo({ top: 0, behavior: "instant" }), true');
  await until('scrollY === 0', 2000); await sleep(100);
  for (let i = 0; i < 4; i++) { await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 300, y: 400, deltaX: 0, deltaY: 400 }); await sleep(100); }
  return Number(await until('scrollY > 100 ? Math.round(scrollY) : 0', 3000)) || 0;
}
const name = () => 'tj_' + randomBytes(4).toString('hex');
const key = (k, code) => cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code }).then(() => cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }));
const STEP = `(() => { const m = document.getElementById('auth-modal'); if (!m || m.hidden) return 'closed'; const p = [...m.querySelectorAll('.auth-step, #pane-2fa, #pane-confirm')].find((x) => !x.hidden); return p ? p.id : null; })()`;
// the sign-in dialog as a reader meets it at this width: every control 44px, every word at the floor, nothing past the card's edge or cut with "…"
const DLOOK = `(() => {
  const card = document.querySelector('#auth-modal .modal-card');
  const probe = document.createElement('span'); probe.style.fontSize = 'var(--text-floor)'; document.body.appendChild(probe);
  const floor = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
  const small = [], out = [], tiny = [], cut = [], untipped = [];
  const cr = card.getBoundingClientRect();
  for (const el of card.querySelectorAll('*')) {
    if (!el.getClientRects().length || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.right > cr.right + 1 || r.left < cr.left - 1) out.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
    if (!el.matches('.modal-x') && [...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && parseFloat(cs.fontSize) < floor - 0.5) small.push((el.id || el.className || el.tagName) + ' ' + cs.fontSize);
    if (el.matches('button, summary, input:not([type=checkbox]), label.w-opt, a.oauth-btn') && r.height < 43.5) tiny.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.height) + 'px');
    if (el.matches('button') && (el.getAttribute('data-tip') || '').length < 8) untipped.push(el.id || el.className);
    if (cs.textOverflow === 'ellipsis' && cs.overflow === 'hidden') cut.push(el.id || el.className);
  }
  return { doc: document.documentElement.scrollWidth, iw: innerWidth, cardSW: card.scrollWidth, cardCW: card.clientWidth, small, out, tiny, cut, untipped };
})()`;
const typeVal = (id, v) => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
// the join step as a reader meets it at this width: the controls, the floor, the edges
const LOOK = `(() => {
  const step = document.getElementById('step-join'), ov = document.getElementById('invite-overlay');
  const probe = document.createElement('span'); probe.style.fontSize = 'var(--text-floor)'; document.body.appendChild(probe);
  const floor = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
  const small = [], out = [], tiny = [], cut = [];
  for (const el of step.querySelectorAll('*')) {
    if (!el.getClientRects().length || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.right > innerWidth + 1 || r.left < -1) out.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
    if ([...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && parseFloat(cs.fontSize) < floor - 0.5) small.push((el.id || el.className || el.tagName) + ' ' + cs.fontSize);
    if (el.matches('button, summary, input:not([type=checkbox]), label.w-opt') && r.height < 43.5) tiny.push((el.id || el.tagName) + ' ' + Math.round(r.height) + 'px');
    if (cs.textOverflow === 'ellipsis' && cs.overflow === 'hidden') cut.push(el.id || el.className);
  }
  const sum = document.querySelector('#inv-join-extra > summary'), opt = document.getElementById('inv-join-2fa-opt'), terms = document.getElementById('inv-join-terms');
  return { floor, doc: document.documentElement.scrollWidth, ovSW: ov.scrollWidth, ovCW: ov.clientWidth, iw: innerWidth, small, out, tiny, cut,
    sumH: sum ? Math.round(sum.getBoundingClientRect().height) : 0, sumMarker: sum ? getComputedStyle(sum).display : null,
    optH: opt && opt.getClientRects().length ? Math.round(opt.getBoundingClientRect().height) : 0,
    terms: terms && terms.getClientRects().length ? terms.textContent : null, termLinks: terms ? [...terms.querySelectorAll('a')].map((a) => a.getAttribute('href')) : [] };
})()`;

if (!CHROME) {
  if (process.env.CI) notes.push('skipping the browser walks: no Chrome or Chromium on this runner (set CHROME_PATH to run them)');
  else check('a Chrome or Chromium to walk the ticket in (set CHROME_PATH)', false, 'none found');
} else if (!await boot()) {
  check('the suite\'s own server starts', false, slog.slice(-400));
} else {
  let up = false;
  try { await startChrome(); up = true; }
  catch (e) {
    if (process.env.CI) notes.push('skipping the browser walks: Chrome would not start here (' + e.message.slice(0, 160) + ')');
    else check('headless Chrome starts and takes commands', false, e.message);
  }
  if (up) {
    /* — the wallet join: one press, the account, and a page that scrolls — */
    try {
      await fresh(1280); await setWallet(newWallet()); await openAbout();
      const direct = await (async () => {
        await ev('(() => { const b = document.getElementById("gs-join"); b.focus(); AUTH.startJoin(); return true; })()');
        const up = await until('!document.getElementById("auth-modal").hidden', 6000);
        const s = await ev(`({ ticket: !!document.querySelector('#invite-overlay[data-open]'), step: ${STEP}, focus: ${FOCUS}, create: document.getElementById('seg-signup').getAttribute('aria-pressed') })`);
        await ev('(() => { const x = document.querySelector("#auth-modal .modal-x"); if (x) x.click(); return true; })()');
        await until(`!${DIALOG_UP}`, 4000);
        return up && !s.ticket && s.step === 'pane-choose' && s.focus === 'btn-wallet-signin' && s.create === 'true' ? true : JSON.stringify(s);
      })();
      check('"Create account" opens the dialog at once on the ways in, focused on Continue with wallet, its email form set to Create account — no ticket, no code (open sign-up, 2026-11-24)', direct === true, direct);
      check('wallet: a member\'s code, entered on purpose, still leads to the ticket\'s last step (no terms step, as on the live site)', await toJoinStep());
      const look = await ev(LOOK);
      check('  ...the step says what making the account means, as the sign-in panel does: 18 or over, the Terms and the Privacy policy (SU-2)',
        /18 or over/.test(look.terms || '') && /Terms/.test(look.terms) && look.termLinks.join(' ') === '/terms /privacy', JSON.stringify([look.terms, look.termLinks]));
      check('  ...and offers "Set up two-factor right after", unticked (SU-2)',
        await ev('(() => { const b = document.getElementById("inv-join-2fa"); return !!b && !b.checked && !b.disabled && /two-factor right after/.test(b.closest("label").textContent); })()'));
      const who = name();
      await typeVal('inv-join-user', who);
      await ev('document.getElementById("inv-join").click(), true');
      check('  ...one press opens the wallet picker, the ticket already closed behind it', await pickWallet() && await ev('!document.querySelector("#invite-overlay[data-open]")'));
      const user = await until('window.AUTH && AUTH.user && AUTH.user.username', 12000);
      check('  ...and the read-only signature makes the account with the name typed on the ticket', user === who, user);
      await until('document.getElementById("auth-modal").hasAttribute("hidden")', 4000);
      await sleep(400);
      const st = await ev(`({ ov: document.body.style.overflow, up: ${DIALOG_UP}, focus: ${FOCUS}, path: location.pathname })`);
      check('  ...with nothing left open, nothing holds the scroll lock: the body\'s overflow is back to "" (SU-1)', st.ov === '' && !st.up && st.path === '/about', JSON.stringify(st));
      check('  ...and focus is somewhere on the page, not dropped on <body>', st.focus && st.focus !== 'BODY', st.focus);
      const y = await wheelScrolls();
      check('  ...and the new member\'s page scrolls under the wheel (SU-1)', y > 100, 'scrollY ' + y);
    } catch (e) { check('the wallet walk ran to the end', false, e && e.message); }

    /* — open sign-up, the plain way (2026-11-24): "Create account", Continue with wallet, the signature, then the @username in the
       same dialog — no code anywhere, nothing asked before the wallet, and no loop: one picker, one signature, the account — */
    let returning = null;   // that wallet and its account, signed in again below
    try {
      const addr = newWallet();
      await fresh(1280); await setWallet(addr); await openAbout();
      await ev('(() => { const b = document.getElementById("gs-join"); b.focus(); AUTH.startJoin(); return true; })()');
      await until('!document.getElementById("auth-modal").hidden', 6000);
      const s0 = signs;
      await ev('document.getElementById("btn-wallet-signin").click(), true');
      const picked = await pickWallet();
      const named = await until(`${STEP} === 'pane-wallet' && document.activeElement && document.activeElement.id === 'w-username'`, 12000);
      const ns = await ev(`({ shown: !document.getElementById('w-connected').hidden, addr: document.getElementById('w-addr').textContent, title: document.getElementById('w-addr').title,
        btn: document.getElementById('w-create').textContent, tip: document.getElementById('w-create').getAttribute('data-tip'), user: !!(window.AUTH && AUTH.user), picker: !!document.querySelector('.wc-overlay:not([hidden])') })`);
      check('open sign-up with a wallet: Continue with wallet asks nothing first; a new wallet comes back to "Pick your @username" in the same dialog, the name field focused',
        picked && !!named && !ns.user && !ns.picker && signs - s0 === 1, JSON.stringify([picked, !!named, ns, signs - s0]));
      check('  ...showing the wallet it connected (short form, the whole address in its title) and "Create my account ✨"',
        ns.shown && ns.addr === addr.slice(0, 6) + '…' + addr.slice(-4) && ns.title.toLowerCase() === addr.toLowerCase() && /Create my account/.test(ns.btn) && (ns.tip || '').length >= 8, JSON.stringify(ns));
      /* the proof behind the name step is ten minutes long and single-use: when it has gone (a 401 on /api/auth/wallet/signup),
         the step says so, keeps the name, and its button connects again — here the 401 is the page's own fetch answering it once */
      const who = name();
      await typeVal('w-username', who);
      await ev(`(() => { const real = window.fetch; let once = true; window.fetch = function (u, o) { if (once && String(u).includes('/api/auth/wallet/signup')) { once = false; return Promise.resolve(new Response(JSON.stringify({ error: 'that wallet connection expired — connect your wallet again' }), { status: 401, headers: { 'Content-Type': 'application/json' } })); } return real.apply(this, arguments); }; return true; })()`);
      await ev('document.getElementById("w-create").click(), true');
      const ex = await until(`/expired/.test(document.getElementById('w-create-status').textContent) && ({ btn: document.getElementById('w-create').textContent, name: document.getElementById('w-username').value, shown: !document.getElementById('w-connected').hidden, focus: ${FOCUS}, step: ${STEP} })`, 6000);
      check('  ...an expired proof (401) is said beside the button, the name kept, and the button connects the wallet again — no dead end',
        ex && ex.step === 'pane-wallet' && ex.name === who && !ex.shown && /Connect wallet/.test(ex.btn) && ex.focus === 'w-create', JSON.stringify(ex));
      // Back: to the ways in, focused on the wallet button; then the plain way again, all the way to the account
      await ev('document.querySelector("#pane-wallet [data-back]").click(), true');
      const back = await ev(`({ step: ${STEP}, focus: ${FOCUS} })`);
      check('  ...Back returns to the ways in, focused on Continue with wallet', back.step === 'pane-choose' && back.focus === 'btn-wallet-signin', JSON.stringify(back));
      const s1 = signs;
      await ev('document.getElementById("btn-wallet-signin").click(), true');
      await pickWallet();
      await until(`${STEP} === 'pane-wallet'`, 12000);
      const kept = await ev('document.getElementById("w-username").value');
      await ev('document.getElementById("w-create").click(), true');
      const user = await until('window.AUTH && AUTH.user && AUTH.user.username', 12000);
      await sleep(1500);   // long enough for a loop to show itself: a second picker, the ticket, the dialog back
      const st = await ev(`({ ov: document.body.style.overflow, up: ${DIALOG_UP}, picker: !!document.querySelector('.wc-overlay:not([hidden])'), ticket: !!document.querySelector('#invite-overlay[data-open]') })`);
      check('  ...then Create my account makes it with that name: one picker and one signature for the account — and nothing comes back (no second picker, no ticket, no dialog)',
        kept === who && user === who && signs - s1 === 1 && !st.up && !st.picker && !st.ticket && st.ov === '', JSON.stringify([kept, user, signs - s1, st]));
      if (user === who) returning = { addr, who };
    } catch (e) { check('the open wallet sign-up walk ran to the end', false, e && e.message); }

    /* — that wallet again, signed out: Continue with wallet signs it straight in — no name step, one signature — */
    try {
      if (!returning) throw new Error('no account from the walk above');
      await ev('AUTH.logout().then(() => true)');
      await until('!(window.AUTH && AUTH.user)', 4000);
      await ev('(() => { document.querySelector("#nav-auth .profile-link").click(); return true; })()');
      await until('!document.getElementById("auth-modal").hidden', 6000);
      const nav = await ev(`({ step: ${STEP}, focus: ${FOCUS} })`);
      const s0 = signs;
      let sawName = false;
      await ev('document.getElementById("btn-wallet-signin").click(), true');
      await pickWallet();
      const end = Date.now() + 12000;
      let user = null;
      while (Date.now() < end && !user) { if (await ev(STEP) === 'pane-wallet') sawName = true; user = await ev('window.AUTH && AUTH.user && AUTH.user.username'); if (!user) await sleep(80); }
      await sleep(500);
      check('a returning wallet: the nav\'s Sign in opens the ways in, and Continue with wallet signs it straight back in — no name step, one signature, nothing left open',
        nav.step === 'pane-choose' && nav.focus === 'btn-wallet-signin' && user === returning.who && !sawName && signs - s0 === 1 && !await ev(DIALOG_UP), JSON.stringify([nav, user, sawName, signs - s0]));
    } catch (e) { check('the returning wallet walk ran to the end', false, e && e.message); }

    /* — no account made: a closed picker, a declined signature, Esc and the focus trap, on the ways in — */
    try {
      await fresh(1280); await setWallet(newWallet()); await openAbout();
      await ev('(() => { const b = document.getElementById("gs-join"); b.focus(); AUTH.open(); return true; })()');
      await until('!document.getElementById("auth-modal").hidden', 6000);
      const nb = await ev(`(() => { const b = document.querySelector('#nav-auth .profile-link'); return b ? { text: b.textContent, tip: b.getAttribute('data-tip') } : null; })()`);
      check('the nav button says "Sign in" and its tip offers a free account with a wallet or an email (no invite code)',
        nb && nb.text === 'Sign in 🚪' && /create a free account/i.test(nb.tip) && !/invite/i.test(nb.tip), JSON.stringify(nb));
      await ev('document.getElementById("btn-wallet-signin").click(), true');
      await until('document.querySelector(".wc-overlay:not([hidden]) .wc-x")', 8000);
      await ev('document.querySelector(".wc-overlay:not([hidden]) .wc-x").click(), true');
      await until('!document.querySelector(".wc-overlay:not([hidden])")', 4000);
      await sleep(300);
      const a = await ev(`({ step: ${STEP}, focus: ${FOCUS}, status: document.getElementById('wallet-status').textContent, err: document.getElementById('wallet-status').classList.contains('is-err') })`);
      check('a closed picker is no error: still on the ways in, nothing said, the focus back on Continue with wallet', a.step === 'pane-choose' && a.focus === 'btn-wallet-signin' && a.status === '' && !a.err, JSON.stringify(a));
      await ev('window.__jsiDecline = true');
      const s0 = signs;
      await ev('document.getElementById("btn-wallet-signin").click(), true');
      await pickWallet();
      await until(`document.getElementById('wallet-status').textContent === '' && !document.querySelector('.wc-overlay:not([hidden])')`, 6000);
      await sleep(300);
      const b = await ev(`({ step: ${STEP}, status: document.getElementById('wallet-status').textContent, user: !!(window.AUTH && AUTH.user) })`);
      check('  ...a declined signature too: back on the ways in, nothing signed, no account, the button ready again', b.step === 'pane-choose' && b.status === '' && !b.user && signs === s0, JSON.stringify(b));
      // the focus trap holds over twenty Tabs, and Esc closes, handing the focus back to the button that opened it
      let escaped = 0; const seen = new Set();
      for (let i = 0; i < 20; i++) { await key('Tab', 9); const f = await ev(`(() => { const a = document.activeElement; return document.getElementById('auth-modal').contains(a) ? (a.id || a.textContent.trim().slice(0, 20)) : null; })()`); if (f == null) escaped++; else seen.add(f); }
      // the first Esc may only close the description a Tab put up (tips.js, SC 1.4.13); the next closes the dialog
      await key('Escape', 27); await sleep(150);
      if (await ev(DIALOG_UP)) await key('Escape', 27);
      await until(`!${DIALOG_UP}`, 3000);
      const c = await ev(`({ up: ${DIALOG_UP}, focus: ${FOCUS}, ov: document.body.style.overflow })`);
      check('  ...Tab goes round the dialog\'s controls and never leaves it, and Esc closes it, the focus back where it was and the page unlocked', escaped === 0 && seen.size >= 5 && !c.up && c.focus === 'gs-join' && c.ov === '', JSON.stringify([escaped, [...seen], c]));
    } catch (e) { check('the cancel-on-the-ways-in walk ran to the end', false, e && e.message); }

    /* — open sign-up with an email — */
    try {
      await fresh(1280); await setWallet(null); await openAbout();
      await ev('(() => { AUTH.startJoin({ tab: "email" }); return true; })()');
      await until('!document.getElementById("pane-email").hidden', 6000);
      const e0 = await ev(`({ focus: ${FOCUS}, btn: document.getElementById('email-submit').textContent, create: document.getElementById('seg-signup').getAttribute('aria-pressed'), pw2: !!document.getElementById('f-password2').getClientRects().length })`);
      check('email sign-up opens on Create account, the focus on its first field, a password typed twice', e0.focus === 'f-username' && /^Create account/.test(e0.btn) && e0.create === 'true' && e0.pw2, JSON.stringify(e0));
      // an error is said beside the button and the focus goes to its field: a name too short, nothing sent
      await typeVal('f-username', 'ab');
      await ev('(() => { document.getElementById("email-form").requestSubmit(); return true; })()');
      await sleep(200);
      const e1 = await ev(`({ focus: ${FOCUS}, status: document.getElementById('email-status').textContent, invalid: document.getElementById('f-username').getAttribute('aria-invalid') })`);
      check('  ...a mistake is said beside the button, on its field (focused, marked invalid), before anything is sent', e1.focus === 'f-username' && /username/.test(e1.status) && e1.invalid === 'true', JSON.stringify(e1));
      const who = name();
      await typeVal('f-username', who); await typeVal('f-email', who + '@example.com'); await typeVal('f-password', 'hunter2hunter2');
      const pw2 = await ev('!!document.getElementById("f-password2")');
      if (pw2) await typeVal('f-password2', 'hunter2hunter2');
      await ev('(() => { const f = document.getElementById("email-form"); f.requestSubmit ? f.requestSubmit() : f.querySelector("[type=submit]").click(); return true; })()');
      const user = await until('window.AUTH && AUTH.user && AUTH.user.username', 12000);
      await sleep(800);
      const st = await ev(`({ up: ${DIALOG_UP}, ticket: !!document.querySelector('#invite-overlay[data-open]') })`);
      check('open sign-up with an email: a name, an email and a password make the account — no code asked, nothing left open', user === who && !st.up && !st.ticket, JSON.stringify([user, st]));
    } catch (e) { check('the open email sign-up walk ran to the end', false, e && e.message); }

    /* — the two-factor box on the ticket reaches the sign-up — */
    try {
      await fresh(1280); await setWallet(newWallet()); await openAbout();
      await toJoinStep();
      const who = name();
      await typeVal('inv-join-user', who);
      await ev('document.getElementById("inv-join-2fa").click(), true');
      await ev('document.getElementById("inv-join").click(), true');
      await pickWallet();
      const went = await until('location.pathname === "/profile" && location.hash === "#sec-security" && location.pathname', 15000);
      check('2FA: ticked on the ticket, the new account goes straight on to Settings → Security to set it up (SU-2)', went === '/profile', await ev('location.pathname + location.hash'));
    } catch (e) { check('the two-factor walk ran to the end', false, e && e.message); }

    /* — "Use email instead": the form, the focus, the page — */
    try {
      await fresh(1280); await setWallet(null); await openAbout();
      await toJoinStep();
      const who = name();
      await typeVal('inv-join-user', who);
      await ev('document.getElementById("inv-join-extra").open = true');
      await typeVal('inv-join-email', who + '@example.com'); await typeVal('inv-join-pw', 'hunter2hunter2'); await typeVal('inv-join-pw2', 'hunter2hunter2');
      await ev('document.getElementById("inv-join-emailbtn").click(), true');
      await until('!document.getElementById("pane-email").hidden', 6000);
      const s = await ev(`({ focus: ${FOCUS}, step: ${STEP}, u: document.getElementById('f-username').value, e: document.getElementById('f-email').value,
        pw: !!document.getElementById('f-password').value, pw2: !!document.getElementById('f-password2').value, ticketPw: ['inv-join-pw', 'inv-join-pw2'].map((id) => document.getElementById(id).value.length), btn: document.getElementById('email-submit').textContent,
        tip: document.getElementById('inv-join-emailbtn').getAttribute('data-tip') })`);
      check('email: "Use email instead" opens the email sign-up form filled with what was typed (both passwords)', s.step === 'pane-email' && s.u === who && s.e === who + '@example.com' && s.pw && s.pw2 && /Create account/.test(s.btn), JSON.stringify(s));
      check('  ...focus is on that form — its Create account button, every field filled — not on the ways in behind it (SU-7)', s.focus === 'email-submit', s.focus);
      check('  ...the button\'s tip says what it does: it opens the form, and the account is made by Create account there (SU-7)', /^Opens the email sign-up form/.test(s.tip) && /Create account/.test(s.tip) && !/^Makes the account/.test(s.tip), s.tip);
      check('  ...and the password typed on the ticket no longer waits in its hidden fields (SU-6)', s.ticketPw.join() === '0,0', s.ticketPw.join());
      await ev('document.getElementById("email-submit").click(), true');
      const user = await until('window.AUTH && AUTH.user && AUTH.user.username', 12000);
      await until('document.getElementById("auth-modal").hasAttribute("hidden")', 4000);
      await sleep(400);
      const st = await ev(`({ ov: document.body.style.overflow, up: ${DIALOG_UP}, focus: ${FOCUS} })`);
      check('  ...the account is made, and with nothing open the page is unlocked, focus still on the page (SU-1)', user === who && st.ov === '' && !st.up && st.focus && st.focus !== 'BODY', JSON.stringify([user, st]));
      check('  ...and scrolls under the wheel (SU-1)', await wheelScrolls() > 100);
    } catch (e) { check('the email walk ran to the end', false, e && e.message); }

    /* — a member's code, entered on purpose ("Got a code from a member? Enter it"): still works, so they are credited — */
    try {
      await fresh(1280); await setWallet(null); await openAbout();
      await ev("(() => { AUTH.open(); return true; })()");
      await until('!document.getElementById("auth-modal").hidden', 6000);
      const tip = await ev('(document.getElementById("auth-ticket") || {}).textContent || ""');
      await ev('document.getElementById("auth-ticket").click(), true');
      const atCode = await until('document.querySelector("#invite-overlay[data-open] #step-code[data-active]")', 8000);
      await ev(`(() => { document.getElementById('inv-in').value = ${JSON.stringify(mintCode())}; document.getElementById('inv-go').click(); return true; })()`);
      const atJoin = await until('document.querySelector("#invite-overlay[data-open] #step-join[data-active]")', 8000);
      check('a member\'s code: "Enter it" opens the code box (not the join step), and the code still takes you on to the join step', /Enter it/.test(tip) && !!atCode && !!atJoin, JSON.stringify([tip, !!atCode, !!atJoin]));
      await ev('(() => { const x = document.getElementById("inv-x"); if (x) x.click(); return true; })()');
    } catch (e) { check('the code walk ran to the end', false, e && e.message); }

    /* — Burn Verification: the form makes the account, then the burn step — */
    try {
      await fresh(1280); await setWallet(null); await openAbout();
      const who = name();
      await ev('(() => { const b = document.getElementById("gs-join"); b.focus(); AUTH.openBurnSignup(true); return true; })()');
      await until('!document.getElementById("pane-burn").hidden', 6000);
      const bf = await ev(FOCUS);
      check('burn: Burn Verification opens on its own form, the focus on its first field', bf === 'b-username', bf);
      await typeVal('b-username', who); await typeVal('b-email', who + '@example.com'); await typeVal('b-pw', 'hunter2hunter2'); await typeVal('b-pw2', 'hunter2hunter2');
      await typeVal('b-addr', Wallet.createRandom().address);
      await ev('document.getElementById("burn-submit").click(), true');
      const raised = await until('document.querySelector("#invite-overlay[data-open] #step-ticket[data-active]")', 2500);
      const user = await until('window.AUTH && AUTH.user && AUTH.user.username', 12000);
      const bp = await until('document.querySelector(".bp-overlay:not([hidden]) .bp-x")', 10000);
      check('burn: the burn form makes the account at once — no ticket raised (open sign-up) — and opens the burn step', !raised && user === who && !!bp, JSON.stringify([!!raised, user, !!bp]));
      await ev('(() => { const x = document.querySelector(".bp-overlay:not([hidden]) .bp-x"); if (x) x.click(); return true; })()');
      await until(`!${DIALOG_UP}`, 4000);
      await sleep(400);
      const st = await ev(`({ ov: document.body.style.overflow, up: ${DIALOG_UP} })`);
      check('  ...and with the burn step closed, the page is unlocked and scrolls (SU-1)', st.ov === '' && !st.up && await wheelScrolls() > 100, JSON.stringify(st));
    } catch (e) { check('the burn walk ran to the end', false, e && e.message); }

    /* — a picker closed, then the dialog, with no account made — */
    try {
      await fresh(1280); await setWallet(newWallet()); await openAbout();
      await toJoinStep();
      await typeVal('inv-join-user', name());
      await ev('document.getElementById("inv-join").click(), true');
      await until('document.querySelector(".wc-overlay:not([hidden]) .wc-x")', 10000);
      await ev('document.querySelector(".wc-overlay:not([hidden]) .wc-x").click(), true');
      await until('!document.querySelector(".wc-overlay:not([hidden])")', 4000);
      await sleep(300);
      await ev('document.querySelector("#auth-modal .modal-x").click(), true');
      await until(`!${DIALOG_UP}`, 4000);
      await sleep(300);
      const st = await ev(`({ ov: document.body.style.overflow, up: ${DIALOG_UP}, focus: ${FOCUS}, user: !!(window.AUTH && AUTH.user) })`);
      check('cancel: picker closed, then the dialog, no account — the page is unlocked and focus is back on the button (SU-1)', st.ov === '' && !st.up && !st.user && st.focus === 'gs-join', JSON.stringify(st));
      check('  ...and scrolls under the wheel (SU-1)', await wheelScrolls() > 100);
      await ev('AUTH.openInvite(), true');
      await until('document.querySelector("#invite-overlay[data-open] #step-join[data-active]")', 8000);
      const again = await ev(`({ err: document.getElementById('inv-join-err').textContent, pw: ['inv-join-pw', 'inv-join-pw2'].map((id) => document.getElementById(id).value.length).join() })`);
      check('  ...a reopened ticket is back on its last step without the stale "Opening your wallet…" (SU-6)', again.err === '' && again.pw === '0,0', JSON.stringify(again));
      await ev('document.getElementById("inv-browse3").click(), true');
    } catch (e) { check('the cancel walk ran to the end', false, e && e.message); }

    /* — the step's look: a phone, the narrowest phone, a laptop — */
    for (const w of [390, 320, 1280]) {
      try {
        await fresh(w); await setWallet(null); await openAbout();
        await toJoinStep();
        await ev('document.getElementById("inv-join-extra").open = true');
        await sleep(250);
        const L = await ev(LOOK);
        check('look ' + w + 'px: the "Add an email & password" toggle and the two-factor box are 44px targets, the toggle keeps its triangle (SU-5)',
          L.sumH >= 44 && L.optH >= 44 && L.sumMarker === 'list-item', JSON.stringify({ sumH: L.sumH, optH: L.optH, marker: L.sumMarker }));
        check('  ...every control on the step is 44px, every word at the floor, nothing past the edge or cut with "…"',
          !L.tiny.length && !L.small.length && !L.out.length && !L.cut.length && L.doc <= L.iw && L.ovSW <= L.ovCW + 1, JSON.stringify({ tiny: L.tiny, small: L.small, out: L.out, cut: L.cut, doc: L.doc, iw: L.iw, ovSW: L.ovSW, ovCW: L.ovCW }));
      } catch (e) { check('the look at ' + w + 'px ran to the end', false, e && e.message); }
    }
    for (const w of [320, 1280]) {
      try {
        await fresh(w); await setWallet(null); await openAbout();
        const bad = [];
        const measure = async (label) => { const L = await ev(DLOOK); if (L.tiny.length || L.small.length || L.out.length || L.cut.length || L.untipped.length || L.doc > L.iw || L.cardSW > L.cardCW + 1) bad.push(label + ' ' + JSON.stringify(L)); };
        await ev('AUTH.open(), true'); await until('!document.getElementById("auth-modal").hidden', 6000); await sleep(250);
        await measure('ways in');
        await ev('document.querySelector("#w-works").open = true, document.querySelector("#pane-choose .auth-more").open = true'); await sleep(150); await measure('ways in, folds open');
        await ev('document.getElementById("btn-email-go").click(), true'); await measure('email, sign in');
        await ev('document.getElementById("seg-signup").click(), true'); await sleep(150); await measure('email, create account');
        await ev('document.querySelector("#pane-email [data-back]").click(), true');
        await ev('document.getElementById("btn-burn-alt").click(), true'); await measure('burn');
        await ev('document.querySelector("#auth-modal .modal-x").click(), true');
        await ev('AUTH.openSignup({ tab: "wallet", username: "look_only" }), true'); await sleep(250);
        await ev('document.getElementById("w-extra").open = true'); await sleep(150); await measure('name step');
        await ev('document.querySelector("#auth-modal .modal-x").click(), true');
        check('the sign-in dialog at ' + w + 'px: every step\'s controls are 44px and described, every word at the floor, nothing past the edge or cut with "…"', !bad.length, bad.join(' | ').slice(0, 900));
      } catch (e) { check('the dialog look at ' + w + 'px ran to the end', false, e && e.message); }
    }
    check('no script error on any page of any walk', errors.length === 0, errors.slice(0, 4).join(' | '));
  }
}

try { if (ws) ws.close(); } catch {}
if (chromeProc) { try { process.kill(-chromeProc.pid, 'SIGKILL'); } catch {} try { chromeProc.kill('SIGKILL'); } catch {} await sleep(300); }
if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
try { if (db) db.close(); } catch {}
await halt();
try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
for (const n of notes) console.log('NOTE ' + n);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
