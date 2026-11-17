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
      390 and 1280 px. Without Chrome (a CI runner with none) the browser part is skipped and the run says so; on a machine that has
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
    else sig = await w.signMessage(/^0x([0-9a-f]{2})*$/i.test(p.msg) ? getBytes(p.msg) : String(p.msg));
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
      if (method === 'personal_sign') { const id = ++n; return new Promise((ok, no) => { pending.set(id, { ok, no }); window.__jsiSign(JSON.stringify({ id, msg: params[0], address: params[1] })); }); }
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
async function toJoinStep() {
  await ev('(() => { const b = document.getElementById("gs-join"); b.focus(); AUTH.startJoin(); return true; })()');
  if (!await until('document.querySelector("#invite-overlay[data-open] #step-ticket[data-active]")', 10000)) return false;
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
      check('wallet: a redeemed code goes straight to the ticket\'s last step (no terms step, as on the live site)', await toJoinStep());
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
      const s = await ev(`({ focus: ${FOCUS}, sel: document.getElementById('tab-email').getAttribute('aria-selected'), u: document.getElementById('f-username').value, e: document.getElementById('f-email').value,
        pw: !!document.getElementById('f-password').value, ticketPw: ['inv-join-pw', 'inv-join-pw2'].map((id) => document.getElementById(id).value.length), btn: document.getElementById('email-submit').textContent,
        tip: document.getElementById('inv-join-emailbtn').getAttribute('data-tip') })`);
      check('email: "Use email instead" opens the email sign-up form filled with what was typed', s.sel === 'true' && s.u === who && s.e === who + '@example.com' && s.pw && /Create Account/.test(s.btn), JSON.stringify(s));
      check('  ...focus is on the Email tab now selected, not the Wallet tab beside it (SU-7)', s.focus === 'tab-email', s.focus);
      check('  ...the button\'s tip says what it does: it opens the form, and the account is made by Create Account there (SU-7)', /^Opens the email sign-up form/.test(s.tip) && /Create Account/.test(s.tip) && !/^Makes the account/.test(s.tip), s.tip);
      check('  ...and the password typed on the ticket no longer waits in its hidden fields (SU-6)', s.ticketPw.join() === '0,0', s.ticketPw.join());
      await ev('document.getElementById("email-submit").click(), true');
      const user = await until('window.AUTH && AUTH.user && AUTH.user.username', 12000);
      await until('document.getElementById("auth-modal").hasAttribute("hidden")', 4000);
      await sleep(400);
      const st = await ev(`({ ov: document.body.style.overflow, up: ${DIALOG_UP}, focus: ${FOCUS} })`);
      check('  ...the account is made, and with nothing open the page is unlocked, focus still on the page (SU-1)', user === who && st.ov === '' && !st.up && st.focus && st.focus !== 'BODY', JSON.stringify([user, st]));
      check('  ...and scrolls under the wheel (SU-1)', await wheelScrolls() > 100);
    } catch (e) { check('the email walk ran to the end', false, e && e.message); }

    /* — Burn Verification: the form first, the ticket, then Continue — */
    try {
      await fresh(1280); await setWallet(null); await openAbout();
      const who = name();
      await ev('(() => { const b = document.getElementById("gs-join"); b.focus(); AUTH.openBurnSignup(true); return true; })()');
      await until('!document.getElementById("pane-burn").hidden', 6000);
      await typeVal('b-username', who); await typeVal('b-email', who + '@example.com'); await typeVal('b-pw', 'hunter2hunter2'); await typeVal('b-pw2', 'hunter2hunter2');
      await typeVal('b-addr', Wallet.createRandom().address);
      await ev('document.getElementById("burn-submit").click(), true');
      const raised = await until('document.querySelector("#invite-overlay[data-open] #step-ticket[data-active]")', 10000);
      check('burn: with no ticket yet, the burn form raises the ticket first', !!raised);
      await redeem();
      await sleep(200);
      const j = await ev(`({ focus: ${FOCUS}, btn: document.getElementById('inv-join').textContent, panel: document.getElementById('inv-join-panel').hidden,
        enabled: [...document.querySelectorAll('#inv-join-panel input')].filter((i) => !i.disabled).map((i) => i.id) })`);
      check('  ...its last step says Continue, with the wallet fields hidden and every one of them disabled', /Continue/.test(j.btn) && j.panel && j.enabled.length === 0, JSON.stringify(j));
      check('  ...and focus is on Continue, not lost on <body> behind a hidden field (SU-4)', j.focus === 'inv-join', j.focus);
      await ev('document.getElementById("inv-join").click(), true');
      const user = await until('window.AUTH && AUTH.user && AUTH.user.username', 12000);
      const bp = await until('document.querySelector(".bp-overlay:not([hidden]) .bp-x")', 10000);
      check('  ...Continue makes the account from the burn form and opens the burn step', user === who && !!bp, JSON.stringify([user, !!bp]));
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
