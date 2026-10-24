/* ===== The tour with Sendy, right after sign-up (owner, 2026-10-24) =================================================
   "Make a whole tutorial onboarding experience right after users sign-up for the platform that shows the user everything that
   they have access to with a verified account on the platform. Allow users to skip this if they want to just explore
   themselves. … Make it the tutorial a fun experience with Sendy being their guide through the tutorial and flying around the
   site showing you each step of the tutorial and explaining it to the users."

   1. The shape, in the source: the server's record (three columns, onboardOf, /api/me, /api/onboard), public/onboard.js (the
      steps, the guide, the waits, skip / back / next / finish, the keyboard, reduced motion, instant scrolls), its place on every
      page Sendy is on, Sendy's "Show me around", the homepage tour standing aside, the styles.
   2. The steps run in a sandbox: 21 of them, a hello and a finish, every page the account can use, simple text on each, and
      every thing a step lights up exists on that step's page (an anchor renamed later fails here, not on a new member).
   3. A server of its own: a brand-new account is due; step / skip / done / replay move it; an account from before the tour is
      never offered it; refusals. Everything lives in a temporary directory, deleted. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { ROOT, SERVER_JS } from './_paths.mjs';

const SRC = fs.readFileSync(SERVER_JS, 'utf8');
const PUB = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const OB = PUB('onboard.js'), SENDY = PUB('sendy.js'), TOUR = PUB('tour.js'), CSS = PUB('styles.css');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ═══ 1. the shape ═══ */
{
  check('the server keeps the tour per account: onboard_state (null never offered · due · done · skipped), the step, when it ended — and it is due for every account made since it shipped, until finished or skipped',
    /"ALTER TABLE users ADD COLUMN onboard_state TEXT"/.test(SRC) && /"ALTER TABLE users ADD COLUMN onboard_step INTEGER"/.test(SRC) && /"ALTER TABLE users ADD COLUMN onboard_at INTEGER"/.test(SRC)
    && /const state = u\.onboard_state \|\| \(u\.created_at >= ONBOARD_SINCE \? 'due' : null\);/.test(SRC) && /onboard: onboardOf\(me\),/.test(SRC));
  check('  .../api/onboard: signed in, rate-limited, a small body; step (0–60), done, skip, replay — only the member\'s own row',
    /if \(p === '\/api\/onboard' && req\.method === 'POST'\) \{\s*if \(!me\) return bad\(res, 'sign in first', 401\);/.test(SRC) && /rateLimit\('onboard:' \+ me\.id, 120, 10 \* 60e3\)/.test(SRC) && /readBody\(req, 1024\)/.test(SRC)
    && /step < 0 \|\| step > ONBOARD_MAX_STEP\) return bad\(res, 'bad step'\)/.test(SRC) && /\} else return bad\(res, 'unknown action'\);/.test(SRC) && /WHERE id = \?'\)\.run\(action === 'done' \? 'done' : 'skipped', now\(\), me\.id\)/.test(SRC));
  const pages = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html') && /sendy\.js"><\/script>/.test(PUB(f)));
  check('every page Sendy is on loads the tour right after him (' + pages.length + ' pages)', pages.length >= 15 && pages.every((f) => /<script src="(\/?)sendy\.js"><\/script>\n<script src="\1onboard\.js"><\/script>/.test(PUB(f))), pages.filter((f) => !/onboard\.js/.test(PUB(f))).join(','));
  check('Sendy\'s menu offers it again to members ("🎓 Show me around", hidden signed out, its tip says what it does); his "welcome back" bubble waits while the tour is up; the homepage tour for visitors stands aside for a member on it',
    /id="sendy-tour" type="button" hidden data-tip="Takes the guided tour of everything your account can do/.test(SENDY) && /if \(tourBtn\) tourBtn\.addEventListener\('click', \(\) => \{ closePopup\(\); if \(window\.ONBOARD\) ONBOARD\.replay\(\); \}\);/.test(SENDY)
    && /if \(window\.ONBOARD && \(ONBOARD\.active\(\) \|\| ONBOARD\.due\(\)\)\) return; if \(e\.detail && e\.detail\.username\) say\('signin'/.test(SENDY) && /if \(window\.ONBOARD && \(ONBOARD\.active\(\) \|\| ONBOARD\.due\(\)\)\) return;   \/\/ a new member is on the tour with Sendy/.test(TOUR));
  check('it waits for what the member is in the middle of: signed out, choosing a handle, the 18+ question, the sign-in window, writing a post, a full-screen view, the bell, the ticket, a burn proof, the homepage tour, a handle or two-factor being set up',
    /if \(u\.auto_named\) return 'claim';/.test(OB) && /if \(window\.AGE && AGE\.needed\) return 'age';/.test(OB) && /\['auth-modal', 'compose-modal', 'full-view', 'notif-panel'\]/.test(OB)
    && /#invite-overlay\[data-open\], \.bp-overlay:not\(\[hidden\]\), \.tour-welcome-wrap, \.tour-tip/.test(OB) && /\^#\(claim\|sec-security\)/.test(OB) && /waitT = setTimeout\(\(\) => start\(n, opts\), 900\)/.test(OB));
  check('the controls: Skip at every step (and Esc), Back, Next — "Fly to …" when the next step is on another page — and a finish; ← → step; focus stays in the card; a member who wandered off gets a small offer to carry on, not a wall',
    /data-ob="skip"/.test(OB) && /data-ob="back"/.test(OB) && /'Fly to ' \+ esc\(pageName\(pageOf\(next\)\)\) \+ ' →'/.test(OB) && /data-ob="finish"/.test(OB) && /if \(e\.key === 'Escape'\)/.test(OB)
    && /e\.key === 'ArrowRight'/.test(OB) && /e\.key === 'ArrowLeft'/.test(OB) && /e\.key === 'Tab'/.test(OB) && /function offerResume\(n\)/.test(OB) && /data-ob="later"/.test(OB) && /I’ll explore myself/.test(OB));
  check('Sendy the guide: the corner Sendy\'s sprite and faces (sendy-acts.json), a curved flight that leans into it, off the edge between pages; without motion he just appears; the corner Sendy steps aside while the tour is up',
    /url\(\/assets\/sendy-idle\.png\)/.test(CSS) && /fetch\('\/assets\/sendy-acts\.json'\)/.test(OB) && /function flyTo\(x, y, cb\)/.test(OB) && /if \(reduced\(\) \|\| !guide\.animate \|\| len < 8\) \{ place\(x, y\);/.test(OB)
    && /flyTo\(window\.innerWidth \+ 40,/.test(OB) && /html\.ob-on #sendy-widget \{ display: none !important; \}/.test(CSS) && /setTimeout\(end, 1700\);/.test(OB));
  check('every scroll the tour makes is instant (the site\'s smooth scroll would still be moving when the layout is measured), a short page gets room at its end, and the card is placed where it does not cover what is lit — nor does Sendy, where a clear perch exists; a target pushed down by a section still loading is fitted again',
    !/behavior: 'auto'/.test(OB) && (OB.match(/behavior: 'instant'/g) || []).length >= 4 && /pad\.className = 'ob-spacer'/.test(OB) && /\.ob-spacer \{ display: block; height: 100vh;/.test(CSS)
    && /if \(H - r\.bottom - G - M >= ch\) \{ side = 'below';/.test(OB) && /card\.classList\.toggle\('ob-top', low\);/.test(OB)
    && /const best = tries\.find\(\(\[x, y\]\) => onScreen\(x, y\) && clear\(x, y\)\);/.test(OB)
    && /\[450, 1100, 2200\]\.forEach\(\(ms\) => setTimeout\(\(\) => \{ if \(root && seq === show\.seq && mode === 'step' && refit\(\)\) relayout\(\); \}, ms\)\);/.test(OB)
    && /fitAt = \{ y: t\.getBoundingClientRect\(\)\.top, s: window\.scrollY \};/.test(OB) && /refit\(\);\n\s+const L = layout\(\);/.test(OB) && /if \(over\(sx, sy\) > over\(sx, upY\)\) sy = upY;/.test(OB)
    && /if \(guide\.classList\.contains\('is-flying'\)\) landAt = \{ x: L\.sx, y: L\.sy \};/.test(OB));
  check('the progress is kept: on the server on every step, finish and skip, and in this browser for the jump between pages; finishing celebrates (the success sound and confetti), skipping says how to come back',
    /save\('step', idx\)/.test(OB) && /save\('skip', idx\)/.test(OB) && /save\('done', idx\)/.test(OB) && /save\('replay'\)/.test(OB) && /sfx\('success'\)/.test(OB) && /sendConfetti/.test(OB) && /Replay it any time from Sendy’s menu/.test(OB));
  const tourCss = CSS.slice(CSS.indexOf('/* ===== The tour with Sendy, right after sign-up'));
  check('the styles: every size on the text floor, a bottom sheet on a phone (a top sheet when the target is low), motion off under reduced motion and the site\'s ⏸', tourCss.length > 500 && !/font-size:\s*(?!max\(var\(--text-floor\))[0-9.]+(rem|px|em)/.test(tourCss)
    && /@media \(max-width: 767px\) \{\s*\.ob-card, \.ob-card\.ob-resume \{/.test(tourCss) && /\.ob-card\.ob-top \{ top: 0 !important;/.test(tourCss) && /@media \(prefers-reduced-motion: reduce\) \{ \.ob-sprite \{ animation: none; \}/.test(tourCss) && /html\.motion-off \.ob-sprite \{ animation: none; \}/.test(tourCss));
}

/* ═══ 2. the steps, run ═══ */
{
  const noop = () => {}, nil = () => null;
  const ls = new Map();
  const document = { readyState: 'complete', addEventListener: noop, removeEventListener: noop, querySelector: nil, querySelectorAll: () => [], getElementById: nil, documentElement: { classList: { contains: () => false, add: noop, remove: noop, toggle: noop } }, body: { appendChild: noop } };
  const window = { document, addEventListener: noop, removeEventListener: noop, innerWidth: 1280, innerHeight: 860, matchMedia: () => ({ matches: false }), AUTH: { user: { username: 'newbie', holderVerified: false, holderProof: { minUsd: 100 } }, ready: null } };
  const ctx = { window, document, location: { pathname: '/', hash: '' }, localStorage: { getItem: (k) => ls.get(k) || null, setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) }, sessionStorage: { getItem: nil, setItem: noop, removeItem: noop }, fetch: () => Promise.reject(new Error('offline')), setTimeout, clearTimeout, console, Image: function () {}, CustomEvent: function () {} };
  ctx.globalThis = ctx; window.window = window; ctx.AUTH = window.AUTH;   // a page's globals are its window's
  vm.createContext(ctx); vm.runInContext(OB, ctx);
  const S = window.ONBOARD.STEPS, txt = (v) => (typeof v === 'function' ? v() : v);
  check('21 steps: a hello first (any page), a finish last, and every part of the account between — the account bar, the bell, the one rule for doing things, posting, the Wall, the Scanner (scan, Send Calls, swaps, the radar), communities and squads, the wallet tracker, the Arcade, the profile (dashboard, wallet, settings) and the member\'s own wall',
    S.length === 21 && S[0].id === 'hello' && S[0].page === '*' && S[20].final === true && S.map((x) => x.id).join() === 'hello,you,bell,unlock,fab,wall,feed,scan,call,swap,radar,comms,squads,tracker,rocket,slots,dash,link,safe,mywall,done', S.map((x) => x.id).join());
  check('  ...each step simple and direct: a title and at most three short sentences (never over 300 characters)', S.every((x) => txt(x.title).length > 3 && txt(x.title).length <= 60 && txt(x.body).length <= 300 && (txt(x.body).match(/[.!?](\s|$)/g) || []).length <= 3),
    S.filter((x) => txt(x.body).length > 300 || (txt(x.body).match(/[.!?](\s|$)/g) || []).length > 3).map((x) => x.id + ':' + txt(x.body).length).join(' '));
  const unlock = S.find((x) => x.id === 'unlock');
  check('  ...the one rule is said as a rule, never a tip: what it opens, the floor read from the account ($100), that linking is read-only, and that reading needs nothing; a verified member is told it is all open',
    /Posting, Send Calls, reactions, votes and communities open once a wallet you link holds \$100 of \$SEND bought on the market, kept for at least a day\./.test(txt(unlock.body)) && /Linking is read-only — a signature, never a transaction — and if you’d rather just read, you never need to\./.test(txt(unlock.body))
    && (window.AUTH.user.holderVerified = true, /all open to you/.test(txt(unlock.body)) && txt(unlock.title) === 'You’re verified ✅') && (window.AUTH.user.holderVerified = false, true));
  check('  ...nothing on the tour tells anyone to buy, promises a gain or claims an endorsement', !S.some((x) => /\bbuy (now|this|some|more|it|today)\b|should buy|guarantee|profit is|affiliated with robinhood/i.test(txt(x.title) + ' ' + txt(x.body))) && S.some((x) => /never tell you to buy/.test(txt(x.body))) && /never financial advice/.test(txt(S[20].body)));
  // every thing a step lights up exists on its page (or is made by the script that page runs)
  const PAGE_FILE = { '/': 'index.html', '/wall': 'wall.html', '/newpairs': 'newpairs.html', '/communities': 'communities.html', '/tracker': 'tracker.html', '/arcade': 'arcade.html', '/profile': 'profile.html' };
  const allJs = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.js')).map((f) => PUB(f)).join('\n');
  const exists = (html, q) => q.startsWith('#') ? (html.includes('id="' + q.slice(1) + '"') || allJs.includes(".id = '" + q.slice(1) + "'") || allJs.includes('id="' + q.slice(1) + '"'))
    : /^\[data-([a-z-]+)="([^"]+)"\]$/.test(q) ? html.includes(q.slice(1, -1)) : q === 'main h1' ? /<main[\s>]/.test(html) : false;
  const missing = [];
  for (const x of S) {
    if (!x.sel) continue;
    const pg = typeof x.page === 'function' ? '/u' : x.page;
    const html = pg === '/u' ? PUB('u.html') : PUB(PAGE_FILE[pg]);
    if (!exists(html, x.sel[0])) missing.push(x.id + ' ' + x.sel[0]);
  }
  check('  ...every step\'s first target exists on that step\'s page (or is made by the site\'s own script) — a renamed anchor fails here, not on a new member', missing.length === 0, missing.join(', '));
  check('  ...the pages it visits, in order: home → the Wall → the Scanner → Communities → the wallet tracker → the Arcade → the profile → the member\'s own wall',
    [...new Set(S.slice(1).map((x) => (typeof x.page === 'function' ? '/u/me' : x.page)))].join(' ') === '/ /wall /newpairs /communities /tracker /arcade /profile /u/me');
}

/* ═══ 3. a server of its own ═══ */
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-onboard-'));
const DATA = path.join(T, 'data'); fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(DATA, '.data_key'), randomBytes(32).toString('hex'), { mode: 0o600 });   // a throwaway key, never printed
const PORT = await freePort(), BASE = 'http://localhost:' + PORT;
const ENV = { ...process.env, PORT: String(PORT), JSI_DATA_DIR: DATA, DATA_DIR: DATA, BASE_URL: BASE, NODE_ENV: 'test', SEED_INVITE_CODE: '12345', TOS_GATE: '1', TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback', SEED_CODES_OPEN: '1',
  DATA_KEY: '', DATA_KEY_FILE: '', BACKUP_DIR: path.join(T, 'backups'), KEY_ROTATE_EXTRA_DBS: '', RPC_URL: 'http://127.0.0.1:9/', CHART_SRC_DS_URL: 'http://127.0.0.1:9/', CHART_SRC_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_DS_URL: 'http://127.0.0.1:9/' };
const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER_JS], { cwd: ROOT, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
const openDb = () => { const d = new DatabaseSync(path.join(DATA, 'app.db')); d.exec('PRAGMA busy_timeout = 5000'); return d; };
const TOS_VERSION = (/const TOS_VERSION = '([^']+)'/.exec(SRC) || [])[1];
function freshPass() {
  const d = openDb(), c = 'OBTEST' + randomBytes(4).toString('hex').toUpperCase(), tok = randomBytes(24).toString('hex');
  d.prepare('INSERT INTO invite_codes (code, owner_id, created_at, used_at, pass, tos_at, tos_version) VALUES (?,NULL,?,?,?,?,?)').run(c, Date.now(), Date.now(), createHash('sha256').update(tok).digest('hex'), Date.now(), TOS_VERSION);
  d.close();
  return 'jsi_pass=' + tok + '; jsi_age=18';
}
let ipN = 0;
async function api(p, { method = 'GET', body, sid, pass } = {}) {
  const headers = { Origin: BASE, 'X-Forwarded-For': '10.66.' + (++ipN) + '.1' };
  if (body) headers['Content-Type'] = 'application/json';
  const ck = [sid ? 'sid=' + sid : '', pass || ''].filter(Boolean).join('; '); if (ck) headers.Cookie = ck;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  const m = /sid=([^;]+)/.exec(r.headers.get('set-cookie') || '');
  return { status: r.status, j, sid: m ? m[1] : null };
}
async function account() {
  const n = 'ob' + randomBytes(3).toString('hex');
  const r = await api('/api/auth/register', { method: 'POST', pass: freshPass(), body: { username: n, email: n + '@example.com', password: 'onboard-pass-' + n } });
  if (r.status !== 200 || !r.sid) throw new Error('could not make an account: ' + r.status + ' ' + JSON.stringify(r.j));
  return { name: n, sid: r.sid };
}
const ob = async (a) => ((await api('/api/me', { sid: a.sid })).j.user || {}).onboard;
const post = (a, body) => api('/api/onboard', { method: 'POST', sid: a.sid, body });
try {
  let up = false;
  for (let i = 0; i < 150 && !up; i++) { try { const r = await fetch(BASE + '/healthz'); up = r.ok; } catch {} if (!up) await sleep(200); }
  check('the server came up', up, log.slice(-300));
  const A = await account();
  check('a brand-new account is due for the tour, at its first step — whichever way it signed up, the next page it opens starts it', JSON.stringify(await ob(A)) === JSON.stringify({ due: true, state: 'due', step: 0 }), JSON.stringify(await ob(A)));
  const s7 = await post(A, { action: 'step', step: 7 });
  check('  ...its place is kept as it goes (step 7), and is what /api/me says on another device', s7.status === 200 && s7.j.onboard.step === 7 && (await ob(A)).step === 7 && (await ob(A)).due === true);
  const sk = await post(A, { action: 'skip', step: 7 });
  check('  ...skipping ends it (not due, "skipped", the step it was at kept) and a later step report cannot bring it back', sk.status === 200 && sk.j.onboard.due === false && sk.j.onboard.state === 'skipped'
    && (await post(A, { action: 'step', step: 9 })).status === 200 && (await ob(A)).state === 'skipped' && (await ob(A)).step === 7);
  const rp = await post(A, { action: 'replay' });
  check('  ..."Show me around" (replay) makes it due again from the start', rp.status === 200 && JSON.stringify(rp.j.onboard) === JSON.stringify({ due: true, state: 'due', step: 0 }));
  const dn = await post(A, { action: 'done', step: 20 });
  check('  ...finishing ends it as done, with when', dn.status === 200 && dn.j.onboard.state === 'done' && dn.j.onboard.due === false && (() => { const d = openDb(); try { const r = d.prepare('SELECT onboard_at FROM users WHERE username = ?').get(A.name); return r && Math.abs(r.onboard_at - Date.now()) < 60000; } finally { d.close(); } })());
  // an account from before the tour shipped: never offered it
  const B = await account();
  { const d = openDb(); try { d.prepare('UPDATE users SET created_at = ?, onboard_state = NULL WHERE username = ?').run(Date.UTC(2026, 8, 1), B.name); } finally { d.close(); } }
  check('an account from before the tour shipped is never offered it (it can still take it from Sendy\'s menu)', (await ob(B)).due === false && (await ob(B)).state === null && (await post(B, { action: 'replay' })).j.onboard.due === true);
  check('refusals: signed out 401, an unknown action 400, a step outside 0–60 400, a step that is not a whole number 400',
    (await api('/api/onboard', { method: 'POST', body: { action: 'done' } })).status === 401 && (await post(A, { action: 'nope' })).status === 400
    && (await post(B, { action: 'step', step: 61 })).status === 400 && (await post(B, { action: 'step', step: -1 })).status === 400 && (await post(B, { action: 'step', step: 2.5 })).status === 400);
} catch (e) {
  check('the suite ran to the end', false, (e && e.stack) || e);
} finally {
  proc.kill('SIGTERM'); await sleep(400); try { if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL'); } catch {}
  fs.rmSync(T, { recursive: true, force: true });
}

let pass = 0;
for (const [n, ok, extra] of results) { if (ok) pass++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok || !extra ? '' : '\n      ' + extra)); }
console.log(`\n${pass}/${results.length} passed`);
if (pass !== results.length) process.exit(1);
