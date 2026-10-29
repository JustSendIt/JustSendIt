/* ===== The site's numbers in the nav, and their pop-up (owner, 2026-10-29) ======================================================
   "In the active sender tracker in the nav also add the number of total verified users total lifetime site views." Then: "When
   users click on this section pull up a popup that shows a graph over time of all three of these stats in a simple to understand
   graphic that quickly shows the data to the users."

   1. The files: the pill (a described <button> that says it opens a dialog), the new first tier .is-snug, the pill as a 📊
      alone in the open row at .is-tight, the lazily-loaded sitestats.js (in check.mjs's list and versioned by /api/config),
      the pop-up's code (FullView, hand-drawn SVG, no inline handlers, honest words for the verified line and the people
      count), the short number format run as written, the privacy page, the README — and what Sendy answers from it.
   2. A server of this suite's own on a throwaway database. Empty first: a view count the site never made is null, never 0. Then
      seeded before its first answer and started again: visits_daily rows for 101 days with one day missing, members in every
      holder_state, a deleted and a system account that must not count, one verified with no recorded day — /api/presence's new
      keys (the rate-limited answer too) and /api/site-stats's shape and every number, its limit, and that it carries no names;
      then a member passing the check while the pill's memo is a minute old: the pill and the pop-up agree, the charts made once.
   3. The same server in a muted headless Chrome: the bar at 320–2048 px, signed out and in, never wider than the screen, the
      new numbers shown where there is room and .is-snug (only when it is needed) where not, always one way in to the pop-up;
      the pill's name and words; a re-fit that leaves a scrolled page in place, and a fresh /about#og-rules that lands; the
      pop-up at 320, 390, 641 and 1280 px and on the 📊 alone — opened by Enter on the pill, or 📊 Site numbers in the menu
      where the pill is not in the bar — the three charts drawn from the answer and worded honestly, no sideways scroll, no
      label broken inside, nothing under the text floor, controls 44px, focus in it and kept there by Tab (and after Try
      again), Esc closes it and focus goes back, and no script error. Without a browser (a CI runner with no
      Chrome) the third part is skipped and the run says so; on a machine that has one, a browser that will not start fails.
   Everything it makes is in its own temporary directories, deleted at the end. */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './_paths.mjs';

const PUB = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const results = [], notes = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAV = PUB('nav.js'), SS = PUB('sitestats.js'), CSS = PUB('styles.css'), APP = PUB('app.js'), PRIV = PUB('privacy.html');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'), CHECK = fs.readFileSync(path.join(ROOT, 'scripts', 'check.mjs'), 'utf8'), README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const decomment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/* ═══ 1. the files ═══ */
const pill = NAV.slice(NAV.indexOf('    var notif = document.getElementById(\'nav-notif\');'), NAV.indexOf('  if (document.readyState === \'loading\')'));
check('the pill is a <button type="button"> that says it opens a dialog, with a description of what it does (data-tip, 8+ characters) instead of a title',
  /var live = document\.createElement\('button'\);\n      live\.type = 'button'; live\.id = 'nav-live'; live\.className = 'nav-live';/.test(pill) && /live\.setAttribute\('aria-haspopup', 'dialog'\);/.test(pill)
    && /live\.setAttribute\('data-tip', STATS_TIP\);/.test(pill) && (/var STATS_TIP = '([^']|\\')+';/.exec(pill) || [''])[0].length > 30 && !/live\.title\s*=/.test(pill) && !/live\.href/.test(pill));
check('  ...the count, the label, then the two new parts in .nav-live-more, each a "·" until the first answer',
  pill.includes('<b class="nav-live-n">·</b><span class="nav-live-lbl">Sending&nbsp;it</span>') && pill.includes('<span class="nav-live-more">') && pill.includes('<b class="nav-live-vn">·</b><span class="nav-live-word">verified</span>')
    && pill.includes('<b class="nav-live-wn">·</b><span class="nav-live-word">views</span>'));
check('  ...its name reads all three numbers in words, and a number the server could not read says so (never a 0)',
  /live\.setAttribute\('aria-label', j\.active \+ ' ' \+ \(j\.active === 1 \? 'person' : 'people'\) \+ ' Sending it right now, ' \+/.test(pill) && /'verified members not known just now'/.test(pill) && /'page views not known just now'/.test(pill)
    && /if \(known\(j\.verified\)\) vEl\.textContent = shortNum\(j\.verified\);/.test(pill) && /if \(known\(j\.views\)\) wEl\.textContent = shortNum\(j\.views\);/.test(pill));
// the short format, run as written
let shortNum = null;
try { shortNum = new Function(/(function shortNum\(n\) \{[\s\S]*?\n      \})/.exec(pill)[1] + '\nreturn shortNum;')(); } catch (e) { notes.push('could not run shortNum(): ' + e.message); }
const CASES = [[0, '0'], [7, '7'], [999, '999'], [1000, '1K'], [1234, '1.2K'], [2833, '2.8K'], [2899, '2.8K'], [9999, '9.9K'], [12345, '12K'], [999999, '999K'], [1000000, '1M'], [1234567, '1.2M'], [25e9, '25B']];
const wrong = shortNum ? CASES.filter(([n, s]) => shortNum(n) !== s).map(([n, s]) => n + '→' + shortNum(n) + ' (want ' + s + ')') : ['not run'];
check('the short number format: whole under 1,000, then 1.2K / 12K / 1.2M — cut, never rounded up (2,899 is 2.8K, never 2.9K)', !wrong.length, wrong.join(', '));
check('a press (Enter and Space are presses of a <button>) fetches public/sitestats.js once — versioned from /api/config — and opens it; a failed fetch says so',
  /live\.addEventListener\('click', function \(\) \{ openStats\(live\); \}\);/.test(pill) && /sc\.src = '\/sitestats\.js' \+ \(av\['sitestats\.js'\] \? '\?v=' \+ encodeURIComponent\(av\['sitestats\.js'\]\) : ''\);/.test(pill)
    && /if \(window\.SiteStats\) return Promise\.resolve\(window\.SiteStats\);/.test(pill) && /sendToast\('⚠️ The numbers could not load — reload the page and try again\.'\)/.test(pill)
    && /'sitestats\.js': assetVer\('sitestats\.js'\)/.test(SRV) && /\['sitestats\.js', 'nav\.js'\]/.test(CHECK) && fs.existsSync(path.join(ROOT, 'public', 'sitestats.js')));
check('where the bar has no room for the pill, the pop-down menu carries the same way in (a described button), shown only then',
  /var entry = document\.createElement\('button'\);\n      entry\.type = 'button'; entry\.className = 'nav-stats-open';/.test(pill) && /entry\.setAttribute\('data-tip', STATS_TIP\);/.test(pill) && /entry\.addEventListener\('click', function \(\) \{ close\(\); openStats\(toggle\); \}\);/.test(pill)
    && /\.nav-stats-open \{ display: none; \}/.test(CSS) && /\.nav\.is-compact\.is-tight \.nav-menu > \.nav-stats-open \{ display: flex; \}/.test(CSS) && /@media \(max-width: 560px\) \{ \.nav\.is-compact \.nav-menu > \.nav-stats-open \{ display: flex; \} \}/.test(CSS)
    && /:scope > a, :scope > \.nav-stats-open/.test(NAV));
check('the bar lets the new numbers go first: .is-snug heads the tiers, and on a wide screen the row is tried without them before it loses the live count',
  /var TIERS = \['is-snug', 'is-tight', 'is-tighter', 'is-tightest', 'is-bare'\];/.test(NAV) && /nav\.classList\.add\('is-snug'\);\n          if \(rowFits\(\)\) compact = false;/.test(NAV)
    && /\.nav\.is-snug \.nav-live-more \{ display: none; \}/.test(CSS) && /@media \(max-width: 700px\) \{ \.nav-live-lbl, \.nav-live-more \{ display: none; \}/.test(CSS));
const fitFn = NAV.slice(NAV.indexOf('    function fit() {'), NAV.indexOf('    function fitSoon()'));
check('  ...and measuring never moves the page: scroll anchoring is off while the row is tried, and fit() never scrolls — the one real change is made with anchoring back on, for the browser to follow (a scroll of ours cancelled its glide to a #section)',
  /var anchoring = function \(on\) \{ html\.style\.overflowAnchor = on \? anchor0\[0\] : 'none'; body\.style\.overflowAnchor = on \? anchor0\[1\] : 'none'; \};/.test(fitFn) && /anchoring\(false\);/.test(fitFn)
    && /nav\.className = before \+ ' is-measuring'; void nav\.offsetHeight;\n        anchoring\(true\);\n        nav\.className = after; void nav\.offsetHeight;/.test(fitFn) && /\} else anchoring\(true\);/.test(fitFn) && !/scroll(To|By)\s*\(/.test(decomment(fitFn)));
check('in the open row of links .is-tight leaves the pill as a 📊 button alone — the row\'s way in to the numbers, since only the pop-down carries 📊 Site numbers; in the pop-down form .is-tight hides it as before',
  /live\.innerHTML = '<span class="nav-live-ico" aria-hidden="true">📊<\/span><span class="nav-live-dot"/.test(pill) && /\.nav-live-ico \{ display: none;/.test(CSS)
    && /\.nav\.is-compact\.is-tight \.nav-live \{ display: none; \}/.test(CSS) && /\.nav\.is-tight \.nav-live > :not\(\.nav-live-ico\) \{ display: none; \}/.test(CSS) && /\.nav\.is-tight \.nav-live \.nav-live-ico \{ display: inline; \}/.test(CSS)
    && !/\.nav\.is-tight \.nav-live,/.test(CSS));
check('until the first answer each "·" stands in the room its number will take (so the new numbers never show and then vanish), and the first answer is measured again as a whole',
  /\.nav-live:not\(\.is-live\) \.nav-live-n, \.nav-live:not\(\.is-live\) \.nav-live-vn, \.nav-live:not\(\.is-live\) \.nav-live-wn \{ display: inline-block; min-width: 1ch; text-align: center; \}/.test(CSS)
    && /\.nav-live:not\(\.is-live\) \.nav-live-wn \{ min-width: 3\.4ch; \}/.test(CSS) && /var first = !live\.classList\.contains\('is-live'\);\n        live\.classList\.add\('is-live'\);\n        if \(first\) fitSoon\(\);/.test(pill));
const ssCode = decomment(SS);
check('the pop-up opens in FullView as a centred sheet with its heading, from GET /api/site-stats; FullView knows the sheet',
  /FullView\.open\(\{ title: 'Just Send It, in numbers', size: 'sheet', closeLabel: 'Close the numbers', opener: o\.opener,/.test(SS) && /fetch\('\/api\/site-stats', \{ credentials: 'same-origin' \}\)/.test(SS)
    && /root\.classList\.toggle\('is-sheet', o\.size === 'sheet'\);/.test(APP) && /\.cf\.is-sheet \.cf-dialog \{ max-width: 1200px; height: auto; max-height: 100%; \}/.test(CSS));
check('  ...CSP-safe and library-free: no inline handler, no <script>, no style attribute, no outside address; the charts are SVG it draws itself',
  !/\son[a-z]+\s*=\s*\\?["']/i.test(ssCode) && !/<script/i.test(ssCode) && !/style="/.test(ssCode) && !/https?:\/\//.test(ssCode) && /<svg class="ss-svg" viewBox="0 0 ' \+ W \+ ' ' \+ H \+ '" preserveAspectRatio="none" role="img"/.test(SS));
check('  ...honest copy: when counting began, from the data; the verified line "each is counted from the day their wallet last passed it", and never the count on past days; the foot line and the Wall link',
  /'Since ' \+ began\(vis\.since\)/.test(SS) && /'Pages opened by people since ' \+ began\(now\.viewsSince\)/.test(SS) && /Members whose wallet passed the on-chain holder check \(the check that lets an account post\)\. On the line, each is counted from the day their wallet last passed it\./.test(SS)
    && /it is not a record of the count on past days/.test(SS) && /Counted by this site from its own records — no tracker, no third party\./.test(SS) && /<a class="ss-wall" href="\/wall">See who’s posting on the Wall →<\/a>/.test(SS)
    && !/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(ssCode));   // no date written in: every date comes from the answer
check('  ...a day of the verified line, and its table\'s column, say what it is ("5 of today\'s verified members had last passed the check by then"), never "5 verified members" on a past day',
  /kind: 'steps', title: function \(v\) \{ return whole\(v\) \+ ' of today’s verified members had last passed the check by then'; \}/.test(SS) && /col: 'Of today’s verified members, passed by this day'/.test(SS)
    && !/kind: 'steps', one:/.test(SS) && !/col: 'Verified members'/.test(SS));
check('  ...the people count says what it counts: once per network and browser a day (countVisit fingerprints the address and the browser string), never "once per device"',
  /'once per network and browser a day \(a phone that changes network counts twice\), bots left out'/.test(SS) && !/once per device/.test(SS)
    && /'v:' \+ fp\(\(clientIp\(req\) \|\| ''\) \+ '\\n' \+ ua\)/.test(SRV));
check('  ...every note under a chart is a sentence: its first letter a capital, whichever part leads it ("The last 90 days shown.")',
  /return t \? '<p class="ss-meta">' \+ t\.charAt\(0\)\.toUpperCase\(\) \+ t\.slice\(1\) \+ '\.<\/p>' : '';/.test(SS));
check('  ...after Try again, focus stays in the dialog (the dialog itself, then the new Try again if that fails too), never on the page under it',
  /if \(dlg && box\.contains\(document\.activeElement\)\) \{ try \{ dlg\.focus\(\{ preventScroll: true \}\); \} catch \(e\) \{\} \}/.test(SS) && /b\.addEventListener\('click', function \(\) \{ load\(box, alive, true\); \}\);/.test(SS));
check('  ...while it is open, all three numbers now follow the bar\'s own poll, so the pill and the pop-up agree',
  /\[\['\.ss-live-num', j\.active\], \['\.ss-ver-num', j\.verified\], \['\.ss-views-num', j\.views\]\]/.test(SS) && /numClass: 'ss-ver-num'/.test(SS) && /numClass: 'ss-views-num'/.test(SS));
check('the server: three numbers from the database (verified = not system, not deleted, holder_state \'ok\'; views = SUM(views) of visits_daily since MIN(day)), kept a minute, the charts five, the live count never',
  /const SITE_TOTALS_MS = 60e3, SITE_SERIES_MS = 5 \* 60e3, SITE_SERIES_DAYS = 90;/.test(SRV) && /const SITE_VERIFIED_WHERE = "system = 0 AND deleted_at IS NULL AND holder_state = 'ok'";/.test(SRV)
    && /SELECT COALESCE\(SUM\(views\), 0\) n, MIN\(day\) since FROM visits_daily/.test(SRV) && /now: \{ active: presenceCount\(\), activeWindowSec: Math\.round\(PRESENCE_WINDOW \/ 1000\), verified: t\.verified, views: t\.views, viewsSince: t\.viewsSince \}/.test(SRV)
    && /siteTotalsSet\(\{ verified: verifiedTotal, views: viewsTotal, viewsSince: first \}\);/.test(SRV)
    && /if \(!rateLimit\('pres:' \+ clientIp\(req\), 240, 6e4\)\) return send\(res, 200, \{ active: presenceCount\(\), \.\.\.siteTotals\(\) \}\);/.test(SRV)
    && /if \(!rateLimit\('sstats:' \+ clientIp\(req\), 120, 6e4\)\) return send\(res, 429, \{ error: 'slow down' \}, \{ 'Retry-After': '60' \}\);/.test(SRV));
check('the privacy page says what the pop-up shows everyone: the daily totals, the verified count AND the day-by-day line of when today\'s verified members last passed (one day\'s step can be one member\'s) — in the short version and in its rows',
  /Its daily totals — how many people opened a page, and how many pages were opened — are also shown to everyone in the numbers pop-up behind the menu bar's &ldquo;Sending it&rdquo; count, and so are the number of verified members and a day-by-day line of how many of them had last passed the holder check by each day: counts only, never who \(though while there are few members, one day's step in that line can be a single member's\)\./.test(PRIV)
    && /The number of members who pass the holder check now is public in the menu bar's numbers pop-up, with a line of how many of them had last passed it by each day/.test(PRIV) && /A member who loses the pass, or deletes the account, leaves the count and the line\./.test(PRIV)
    && /everyone sees each day's totals of people and page views in the menu bar's numbers pop-up — totals only, never who/.test(PRIV) && /Version 2026-10-29 · \$Send/.test(PRIV) && !/shown only to the operator/.test(PRIV));
const readmeRow = (README.split('\n').find((l) => l.startsWith('| **● The site\'s numbers, in the nav** |')) || '');
check('the README describes the pill, the pop-up, the three definitions and /api/site-stats — the definitions first, the pill as a pattern (no example figures to drift from the site\'s, no "2.8K" for a sentence splitter to break)',
  /^\| \*\*● The site's numbers, in the nav\*\* \| The three numbers beside the 🔔 in the menu bar mean: \*\*Sending it\*\*, the people with a page of the site open in the last minute or so; \*\*verified members\*\*, the accounts whose wallet passed the on‑chain holder check/.test(readmeRow)
    && readmeRow.includes('`● N Sending it · ✓ N verified · N views`') && !/\d\.\d/.test(readmeRow.replace(/`[^`]*`/g, '')) && !/\b\d+ (Sending it|verified\b)/.test(readmeRow)
    && /`holder_state = 'ok'`/.test(readmeRow) && /GET \/api\/site-stats/.test(readmeRow) && /not a record of the count on past days/.test(readmeRow) && /📊 Site numbers/.test(readmeRow));
// …and what Sendy (lib/sendybrain.js, which serves README §1–4 to everyone) answers from it, run over this tree's own files
let sendyNav = null;
try {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const SB = req(path.join(ROOT, 'lib', 'sendybrain.js')), MD = req(path.join(ROOT, 'lib', 'marketdata.js'));
  const sdb = new DatabaseSync(':memory:');
  sdb.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, points INTEGER DEFAULT 0, system INTEGER DEFAULT 0, deleted_at INTEGER, created_at INTEGER);
    CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, text TEXT, board TEXT, community_id INTEGER, call_id INTEGER, private INTEGER DEFAULT 0, squad_id INTEGER, created_at INTEGER);
    CREATE TABLE comments (id INTEGER PRIMARY KEY, post_id INTEGER, user_id INTEGER, text TEXT, created_at INTEGER);
    CREATE TABLE calls (id INTEGER PRIMARY KEY, user_id INTEGER, token_addr TEXT, symbol TEXT, name TEXT, post_id INTEGER, squad_id INTEGER, wallet TEXT, created_at INTEGER);
    CREATE TABLE communities (id INTEGER PRIMARY KEY, symbol TEXT, name TEXT, token_addr TEXT, status TEXT, official INTEGER, demo INTEGER, member_count INTEGER, qual_count INTEGER, c_price REAL, c_mc REAL, c_liq REAL, c_holders INTEGER, c_at INTEGER, created_at INTEGER, went_live_at INTEGER);
    CREATE TABLE squads (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE token_cache (token_addr TEXT, pair_json TEXT, symbol TEXT, name TEXT, found INTEGER, reads INTEGER, updated_at INTEGER);
    CREATE TABLE sendy_qa (id INTEGER PRIMARY KEY, q TEXT, a TEXT, page TEXT, at INTEGER, up INTEGER DEFAULT 0, down INTEGER DEFAULT 0);`);
  MD.migrate(sdb);
  const brain = SB.createSendyBrain({ db: sdb, root: ROOT, siteMap: '' });
  brain.migrate(); await brain.tick();
  sendyNav = [];
  for (const q of ['what do the numbers in the nav mean?', 'what does verified mean in the nav?']) sendyNav.push((await brain.answerBrain(q, '/', [])).answer || '');
  try { sdb.close(); } catch {}
} catch (e) { notes.push('could not run Sendy\'s brain: ' + e.message); }
check('  ...so Sendy, asked "what do the numbers in the nav mean?" (or what "verified" means there), quotes the three definitions — not example figures, and no "2. 8K"',
  sendyNav && sendyNav.length === 2 && sendyNav.every((a) => /Sending it ?, the people with a page of the site open/.test(a) && /verified members ?, the accounts whose wallet passed the on‑chain holder check/.test(a) && /views ?, the pages opened by people/.test(a)
    && !/\d\. \d/.test(a) && !/\b\d+ Sending it|✓ \d/.test(a)), JSON.stringify(sendyNav).slice(0, 400));

/* ═══ 2. a server of our own ═══ */
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const PORT = await freePort();
const B = 'http://localhost:' + PORT;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-navstats-'));
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
fs.writeFileSync(path.join(dataDir, '.data_key'), randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
// nothing it does leaves this machine: a fetch to anywhere but here fails at once, as a dead address would
const guard = path.join(dataDir, 'guard.mjs');
fs.writeFileSync(guard, `const real = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  let u = null; try { u = new URL(typeof input === 'string' ? input : (input && input.url) || String(input)); } catch {}
  if (u && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]')) return real.call(this, input, init);
  throw new TypeError('fetch failed');
};
`);
const DEAD = 'http://127.0.0.1:9/';
const env = { ...process.env, PORT: String(PORT), JSI_DATA_DIR: dataDir, DATA_DIR: dataDir, BASE_URL: B, NODE_ENV: 'test', SEED_INVITE_CODE: '12345', TOS_GATE: '1',
  TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback', SEED_CODES_OPEN: '1', DATA_KEY: '', DATA_KEY_FILE: '', BACKUP_DIR: path.join(dataDir, 'backups'), KEY_ROTATE_EXTRA_DBS: '',
  RPC_URL: DEAD, CHART_SRC_DS_URL: DEAD, CHART_SRC_GT_URL: DEAD, TOKSEARCH_GT_URL: DEAD, TOKSEARCH_DS_URL: DEAD, MC_DEXSCREENER_URL: DEAD, MC_GECKO_URL: DEAD, MC_GOPLUS_URL: DEAD,
  ETH_RPC_URL: DEAD, SOL_RPC_URL: DEAD, JUPITER_URL: DEAD, MARKET_COLLECT: '0', BLOCKSCOUT_URL: '', OUTBOUND_MAX_WAIT_MS: '2000' };
let server = null, slog = '';
async function boot() {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', pathToFileURL(guard).href, 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
  for (let i = 0; i < 150; i++) { try { if ((await fetch(B + '/healthz')).ok) return true; } catch {} await sleep(150); }
  return false;
}
async function halt() { if (!server) return; const s = server; server = null; const done = new Promise((r) => s.once('exit', r)); try { s.kill('SIGTERM'); } catch {} await Promise.race([done, sleep(4000)]); }
const ip = () => '198.51.100.' + (1 + (randomBytes(1)[0] % 250));   // TEST-NET-2: a fresh address for each limit that is counted
async function api(p, o = {}) {
  const r = await fetch(B + p, { headers: { 'X-Forwarded-For': o.ip || ip(), ...(o.headers || {}) } });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, h: (k) => r.headers.get(k) || '' };
}
const today = new Date().toISOString().slice(0, 10);
const dayOff = (n) => new Date(Date.parse(today + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const at = (n) => Date.parse(dayOff(n) + 'T12:00:00Z');
let db = null, chromeProc = null, profile = null;
let SEED = null;

try {
  /* — empty: nothing counted yet is null, never 0 — */
  check('the suite\'s own server comes up on an empty database', await boot(), slog.slice(-300));
  const e1 = await api('/api/presence'), e2 = await api('/api/site-stats');
  check('before the site has counted a page: /api/presence says views and since are not known (null), and 0 verified members is a real 0',
    e1.status === 200 && e1.j && typeof e1.j.active === 'number' && e1.j.views === null && e1.j.viewsSince === null && e1.j.verified === 0, e1.text);
  check('  ...and /api/site-stats draws no day it did not count: no visitor or view days, no since, no verified line',
    e2.status === 200 && e2.j && e2.j.now.views === null && e2.j.visitors.since === null && e2.j.visitors.days.length === 0 && e2.j.views.days.length === 0 && e2.j.verified.days.length === 0 && e2.j.verified.since === null && e2.j.now.verified === 0, e2.text.slice(0, 300));
  await halt();

  /* — seeded, then started again (the numbers are kept in memory, so a fresh start reads the seed) — */
  db = new DatabaseSync(path.join(dataDir, 'app.db')); db.exec('PRAGMA busy_timeout = 5000');
  const rows = [];
  for (let n = 100; n >= 0; n--) {
    if (n === 5) continue;   // a day the site served no page at all: no row
    const visitors = 10 + (n % 7), views = 3 * visitors + (n % 4);
    rows.push([dayOff(n), visitors, views]);
    db.prepare('INSERT INTO visits_daily (day, visitors, members, views, bots) VALUES (?,?,?,?,?)').run(dayOff(n), visitors, 1, views, 40);
  }
  const mk = (name, extra) => {
    db.prepare('INSERT INTO users (username, created_at, avatar) VALUES (?,?,?)').run(name, at(120), '🧪');
    const id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
    const all = { onboard_state: 'done', ...extra };
    db.prepare('UPDATE users SET ' + Object.keys(all).map((k) => k + ' = ?').join(', ') + ' WHERE id = ?').run(...Object.values(all), id);
    return id;
  };
  mk('ns_ok_old', { holder_state: 'ok', holder_verified_at: at(95) });   // before the 90 days shown: carried into the first
  mk('ns_ok_b', { holder_state: 'ok', holder_verified_at: at(10) });
  mk('ns_ok_c', { holder_state: 'ok', holder_verified_at: at(3) });
  mk('ns_ok_d', { holder_state: 'ok', holder_verified_at: at(3) });
  mk('ns_ok_today', { holder_state: 'ok', holder_verified_at: Date.now() - 1000 });
  mk('ns_ok_nodate', { holder_state: 'ok' });   // verified, with no day kept
  mk('ns_pending', { holder_state: 'pending', holder_verified_at: at(20) });   // a re-check under way: not verified now
  mk('ns_failed', { holder_state: 'failed' });
  mk('ns_none', {});
  mk('ns_deleted', { holder_state: 'ok', holder_verified_at: at(30), deleted_at: at(2) });
  mk('ns_system', { holder_state: 'ok', holder_verified_at: at(40), system: 1 });
  const member = mk('ns_member', {});
  const sid = 'tok_ns_' + randomBytes(10).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(sid).digest('hex'), member, Date.now(), Date.now() + 864e5);
  const viewsTotal = rows.reduce((a, r) => a + r[2], 0);
  SEED = { rows, viewsTotal, sid, first: dayOff(100) };
  check('the seeded server comes up', await boot(), slog.slice(-300));

  const pr = await api('/api/presence?pid=navstatsprobe');
  check('/api/presence answers { active, verified, views, viewsSince }: 6 verified (the deleted, the system account, the pending, the failed and the never-asked left out), every view since the first counted day',
    pr.status === 200 && pr.j && Object.keys(pr.j).sort().join() === 'active,verified,views,viewsSince' && pr.j.active >= 1 && pr.j.verified === 6 && pr.j.views === viewsTotal && pr.j.viewsSince === dayOff(100), pr.text);
  const one = ip();
  let last = null;
  for (let i = 0; i < 241; i++) last = await api('/api/presence', { ip: one });
  check('  ...and an address over its limit still gets the same answer (it is just not counted as present again)',
    last.status === 200 && last.j && Object.keys(last.j).sort().join() === 'active,verified,views,viewsSince' && last.j.verified === 6 && last.j.views === viewsTotal, last.text);

  const ss = await api('/api/site-stats');
  const j = ss.j || {};
  check('/api/site-stats: { at, maxDays, now, visitors, views, verified }, public, never cached by the browser',
    ss.status === 200 && Object.keys(j).sort().join() === 'at,maxDays,now,verified,views,visitors' && typeof j.at === 'number' && j.maxDays === 90 && /no-store/.test(ss.h('cache-control')), ss.status + ' ' + Object.keys(j).join());
  check('  ...now: the live count, its window, and the same 6 verified and every view, with the day counting began',
    j.now && Object.keys(j.now).sort().join() === 'active,activeWindowSec,verified,views,viewsSince' && j.now.active >= 1 && j.now.activeWindowSec === 75 && j.now.verified === 6 && j.now.views === viewsTotal && j.now.viewsSince === dayOff(100), JSON.stringify(j.now));
  const vd = (j.visitors && j.visitors.days) || [], wd = (j.views && j.views.days) || [];
  const byDay = new Map(rows.map((r) => [r[0], r]));
  const exact = vd.length === 90 && wd.length === 90 && vd.every((d, i) => d[0] === dayOff(89 - i) && d[0] === wd[i][0] && (byDay.has(d[0]) ? d[1] === byDay.get(d[0])[1] && wd[i][1] === byDay.get(d[0])[2] : d[1] === null && wd[i][1] === null));
  check('  ...visitors and views: one entry a day for the last 90 days (101 were counted), today last, each the day\'s own total — and the day with no record is null, never 0',
    exact && j.visitors.since === dayOff(100) && j.views.since === dayOff(100) && j.visitors.today === today && vd[vd.length - 1][0] === today && vd.find((d) => d[0] === dayOff(5))[1] === null, JSON.stringify(vd.slice(-7)));
  const ver = j.verified || {}, vdays = ver.days || [];
  const cum = (d) => (vdays.find((x) => x[0] === d) || [])[1];
  check('  ...verified: basis "last-pass", each of today\'s verified members on the day their wallet last passed, as a running total (the one from before the 90 days carried into the first), the one with no day counted apart',
    ver.basis === 'last-pass' && ver.since === dayOff(95) && vdays.length === 90 && vdays[0][0] === dayOff(89) && vdays[0][1] === 1 && cum(dayOff(11)) === 1 && cum(dayOff(10)) === 2 && cum(dayOff(4)) === 2 && cum(dayOff(3)) === 4
      && cum(dayOff(1)) === 4 && cum(today) === 5 && ver.undated === 1 && vdays.every((d, i) => i === 0 || d[1] >= vdays[i - 1][1]) && cum(today) + ver.undated === j.now.verified, JSON.stringify(vdays.slice(-12)) + ' undated ' + ver.undated);
  const names = ['ns_ok_old', 'ns_ok_b', 'ns_member', 'ns_deleted', 'ns_system', 'navstatsprobe'];
  check('  ...aggregates only: no name, no id, no per-person row anywhere in it', !names.some((n) => ss.text.includes(n)) && !/"(id|userId|username|user_id)"/.test(ss.text), names.filter((n) => ss.text.includes(n)).join());
  const two = ip();
  const codes = [];
  for (let i = 0; i < 121; i++) codes.push((await api('/api/site-stats', { ip: two })).status);
  const r429 = await api('/api/site-stats', { ip: two });
  // the other address is one ip() never picks (it picks .1–.250), so it can never be the limited one
  check('  ...limited per address: 120 a minute, then 429 with a Retry-After (another address is not affected)',
    codes.slice(0, 120).every((c) => c === 200) && codes[120] === 429 && r429.status === 429 && r429.h('retry-after') === '60' && (await api('/api/site-stats', { ip: '198.51.100.253' })).status === 200, codes.slice(118).join());
  const cfg = await api('/api/config');
  check('/api/config versions sitestats.js, so a deploy reaches the pop-up the moment it lands', cfg.j && cfg.j.assets && typeof cfg.j.assets['sitestats.js'] === 'string' && cfg.j.assets['sitestats.js'].length > 3, JSON.stringify(cfg.j && cfg.j.assets));

  /* — the pill and the pop-up agree, and the charts are not made again on every ask: a member passes the check after the
     pill's minute-long memo has read 6; the pop-up's first ask makes the charts with 7 and hands 7 to that memo — so the
     next ask is the same answer (same `at`) and the pill says 7 too. (It used to compare its fresh 7 with the memo's 6 and
     make the charts again on every ask, while the pill kept saying 6.) Then back as it was, on a fresh start. — */
  await halt();
  check('  (started again, for a fresh memo)', await boot(), slog.slice(-300));
  const p6 = await api('/api/presence');
  db.prepare("UPDATE users SET holder_state = 'ok' WHERE username = 'ns_pending'").run();
  const s1 = await api('/api/site-stats'), s2 = await api('/api/site-stats'), p7 = await api('/api/presence');
  check('a member who passes the check while the pill\'s memo says 6: the pop-up says 7, asked twice it is the same answer (the charts made once), and the pill says 7 with it',
    p6.j && p6.j.verified === 6 && s1.j && s1.j.now.verified === 7 && s2.j && s2.j.now.verified === 7 && s1.j.at === s2.j.at && p7.j && p7.j.verified === 7 && s1.j.verified.days[s1.j.verified.days.length - 1][1] + s1.j.verified.undated === 7,
    JSON.stringify({ p6: p6.j && p6.j.verified, s1: s1.j && [s1.j.now.verified, s1.j.at], s2: s2.j && [s2.j.now.verified, s2.j.at], p7: p7.j && p7.j.verified }));
  db.prepare("UPDATE users SET holder_state = 'pending' WHERE username = 'ns_pending'").run();
  await halt();
  check('  (started again, as seeded)', await boot(), slog.slice(-300));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the server part ran to the end', false, e && e.message);
}

/* ═══ 3. in a browser ═══ */
function findChrome() {
  const c = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return c.find((p) => p && fs.existsSync(p)) || null;
}
const CHROME = findChrome();
let ws = null, session = null, seq = 0, fetchMode = 'pass';
const held = [];
const pend = new Map(), errors = [];
const cdp = (method, params = {}, sid = session) => new Promise((ok, bad) => { const id = ++seq; pend.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
}
async function until(expr, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(60); }
  return null;
}
async function startChrome() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-navstats-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--lang=en-US', 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  chromeProc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; chromeProc.stderr.on('data', (d) => { err += d; });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) throw new Error('Chrome did not open its debugging port: ' + err.slice(0, 300));
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  ws = new WebSocket('ws://127.0.0.1:' + port + wsPath);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('could not connect to Chrome')); });
  ws.onmessage = (m) => {
    const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.bad(new Error(d.method + ' ' + JSON.stringify(d.error))) : p.ok(d.result); }
    else if (d.method === 'Fetch.requestPaused' && fetchMode === 'hold') held.push(d.params.requestId);   // the first-answer check: /api/presence kept waiting
    else if (d.method === 'Fetch.requestPaused') {   // the Try again check: the numbers fail on purpose, then come
      cdp(fetchMode === 'fail' ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest', fetchMode === 'fail'
        ? { requestId: d.params.requestId, responseCode: 500, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"error":"test"}').toString('base64') }
        : { requestId: d.params.requestId }).catch(() => {});
    }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text || '').split('\n')[0]);
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error: ' + (d.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 160));
  };
  const t = await cdp('Target.createTarget', { url: 'about:blank' }, null);
  session = (await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
}
const KEYS = { Tab: 9, Escape: 27, Enter: 13 };
async function press(k, mods = 0) {
  const base = { key: k, code: k, windowsVirtualKeyCode: KEYS[k], nativeVirtualKeyCode: KEYS[k], modifiers: mods };
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
async function open(w, who) {
  await cdp('Network.clearBrowserCookies');
  await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: B });   // the 18+ answer, so the age question does not cover the page
  if (who === 'in') await cdp('Network.setCookie', { name: 'sid', value: SEED.sid, url: B });
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: w < 768 ? 740 : 860, deviceScaleFactor: 1, mobile: w < 768 });
  await cdp('Emulation.setTouchEmulationEnabled', w < 768 ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });   // a phone: pointer coarse, the 44px controls
  await cdp('Page.navigate', { url: B + '/wall' });
  await until('document.readyState === "complete" && !!document.getElementById("nav-live")');
  const painted = await until('document.querySelector("#nav-live.is-live") && /\\d/.test(document.querySelector(".nav-live-vn").textContent)', 8000);
  if (who === 'in') await until('window.AUTH && AUTH.user && document.querySelector(".profile-link")', 6000);
  await sleep(500);   // the balances pill and the bell settle; nav.js re-fits on its own
  return !!painted;
}
const BAR = `(() => {
  const n = document.querySelector('nav.nav'), menu = document.getElementById('nav-menu'), l = document.getElementById('nav-live');
  const vis = (e) => !!e && e.getClientRects().length > 0, more = l && l.querySelector('.nav-live-more');
  const rowFits = () => { const a = menu.querySelectorAll('a'), f = a[0], z = a[a.length - 1]; const wrapped = f && z && (Math.abs(z.getBoundingClientRect().top - f.getBoundingClientRect().top) > 4 || menu.getBoundingClientRect().height > f.getBoundingClientRect().height * 1.5); return !wrapped && n.scrollWidth <= n.clientWidth; };
  // the open row at .is-tight: the pill as a 📊 button alone (there .is-snug is beside the point: the new numbers are not shown either way)
  const icon = n.classList.contains('is-tight') && !n.classList.contains('is-compact');
  let needed = null;   // was .is-snug needed? take it off for a moment and see whether the bar still holds
  if (n.classList.contains('is-snug') && !icon && vis(l) && innerWidth > 700) { n.classList.remove('is-snug'); needed = n.classList.contains('is-compact') ? n.scrollWidth > n.clientWidth : !rowFits(); n.classList.add('is-snug'); }
  const tiers = ['is-snug', 'is-tight', 'is-tighter', 'is-tightest', 'is-bare'].filter((t) => n.classList.contains(t));
  const lr = l && vis(l) ? l.getBoundingClientRect() : null, ctl = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-ctl')) || 0;
  return { cls: [...n.classList].join(' '), tiers, fits: n.scrollWidth <= n.clientWidth && document.documentElement.scrollWidth <= innerWidth, sw: n.scrollWidth, cw: n.clientWidth, doc: document.documentElement.scrollWidth,
    pill: vis(l), more: vis(more), needed, icon, ico: vis(l && l.querySelector('.nav-live-ico')), pw: lr ? Math.round(lr.width) : 0, ph: lr ? Math.round(lr.height) : 0, ctl,
    entry: vis(document.querySelector('.nav-stats-open')) || null, text: l ? l.innerText.replace(/\\s+/g, ' ').trim() : '', label: l ? l.getAttribute('aria-label') : '',
    tag: l && l.tagName, type: l && l.getAttribute('type'), pop: l && l.getAttribute('aria-haspopup'), tip: l && l.getAttribute('data-tip'), title: l && l.getAttribute('title') };
})()`;
// the dialog as a reader meets it: its parts, its charts, the floor, the edges, the controls
const POP = `(() => {
  const root = document.getElementById('full-view'), d = root && root.querySelector('.cf-dialog'), stage = root && root.querySelector('.cf-stage');
  const probe = document.createElement('span'); probe.style.fontSize = 'var(--text-floor)'; document.body.appendChild(probe);
  const floor = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
  const small = [], out = [], tiny = [];
  const dr = d.getBoundingClientRect();
  for (const el of d.querySelectorAll('*')) {   // the dialog, not the dimmed edge around it
    if (el.closest('.sr-only') || el.closest('svg') || el.closest('details:not([open]) > :not(summary)') || !el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (!el.closest('.ss-tbl') && (r.right > dr.right + 1 || r.left < dr.left - 1)) out.push((el.className || el.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
    if ([...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < floor - 0.5) small.push((el.className || el.tagName) + ' ' + getComputedStyle(el).fontSize);
    if (el.matches('button, summary, a[href]') && (r.height < 43.5)) tiny.push((el.className || el.tagName) + ' ' + Math.round(r.height));
  }
  const cards = [...root.querySelectorAll('.ss-card')].map((c) => {
    const svg = c.querySelector('svg.ss-svg');
    return { id: c.className, h3: (c.querySelector('h3') || {}).textContent, num: (c.querySelector('.ss-num') || {}).textContent, unit: (c.querySelector('.ss-unit') || {}).textContent, what: (c.querySelector('.ss-what') || {}).textContent,
      meta: [...c.querySelectorAll('.ss-meta, .ss-undated')].map((m) => m.textContent).join(' | '), svgW: svg ? Math.round(svg.getBoundingClientRect().width) : 0, cardW: Math.round(c.getBoundingClientRect().width), label: svg && svg.getAttribute('aria-label'),
      bars: svg ? svg.querySelectorAll('rect.ss-bar').length : 0, barsTitled: svg ? [...svg.querySelectorAll('rect.ss-bar')].every((b) => b.querySelector('title') && b.querySelector('title').textContent.length > 5) : false,
      hits: svg ? [...svg.querySelectorAll('rect.ss-hit')].map((h) => h.querySelector('title') ? h.querySelector('title').textContent : '') : [], line: !!(svg && svg.querySelector('path.ss-line')),
      todayBar: svg && svg.querySelector('rect.ss-bar.is-today') ? svg.querySelector('rect.ss-bar.is-today title').textContent : null, none: svg ? [...svg.querySelectorAll('rect.ss-bar.is-none title')].map((t) => t.textContent) : [],
      y: [...c.querySelectorAll('.ss-y span')].map((s) => s.textContent), x: [...c.querySelectorAll('.ss-x > span')].map((s) => s.textContent), xRows: (() => { const t = [...c.querySelectorAll('.ss-x > span')].map((s) => Math.round(s.getBoundingClientRect().top)); return new Set(t).size; })(),
      broken: [...c.querySelectorAll('.ss-nb')].filter((e) => e.getClientRects().length > 1).map((e) => e.textContent), metas: [...c.querySelectorAll('.ss-meta')].map((m) => m.textContent), colHead: (c.querySelector('thead th:last-child') || {}).textContent, summary: (c.querySelector('details > summary') || {}).textContent, sumTip: c.querySelector('details > summary') && c.querySelector('details > summary').getAttribute('data-tip') };
  });
  const lb = d.getAttribute('aria-labelledby');
  return { open: !root.hidden, role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), title: lb && document.getElementById(lb) ? document.getElementById(lb).textContent : null, inside: root.contains(document.activeElement),
    xTip: (root.querySelector('.cf-x') || {}).getAttribute && root.querySelector('.cf-x').getAttribute('data-tip'), cards, wall: (root.querySelector('a.ss-wall') || {}).getAttribute && root.querySelector('a.ss-wall').getAttribute('href'),
    note: (root.querySelector('.ss-note') || {}).textContent, doc: document.documentElement.scrollWidth, iw: innerWidth, stageSW: stage.scrollWidth, stageCW: stage.clientWidth, floor, cols: getComputedStyle(root.querySelector('.ss-cards')).gridTemplateColumns.split(' ').length, small: small.slice(0, 6), out: out.slice(0, 6), tiny: tiny.slice(0, 6) };
})()`;

if (!SEED) notes.push('skipping the browser checks: the seeded server did not come up');
else if (!CHROME) {
  if (process.env.CI) notes.push('skipping the browser checks: no Chrome or Chromium on this runner (set CHROME_PATH to run them)');
  else check('a Chrome or Chromium to drive the bar and the pop-up in (set CHROME_PATH)', false, 'none found');
} else {
  let up = false;
  try { await startChrome(); up = true; }
  catch (e) {
    if (process.env.CI) notes.push('skipping the browser checks: Chrome would not start here (' + e.message.slice(0, 160) + ')');
    else check('headless Chrome starts and takes commands', false, e.message);
  }
  if (up) {
    try {
      const short = (n) => shortNum ? shortNum(n) : String(n);
      const longDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
      /* — the bar, every width, signed out and in — */
      const bars = [];
      // up to 1440, and the wide screens where the open row of links has room for no count (the review found no way in at all
      // there: 1728 signed out — a MacBook Pro's — and 1920 signed in)
      const WIDTHS = [320, 360, 375, 390, 768, 1024, 1280, 1440, 1600, 1728, 1760, 1920, 1960, 2048];
      for (const who of ['out', 'in']) for (const w of WIDTHS) {
        const painted = await open(w, who);
        bars.push({ who, w, painted, ...(await ev(BAR)) });
      }
      const over = bars.filter((b) => !b.fits).map((b) => b.who + '@' + b.w + ' ' + b.sw + '/' + b.cw + ' doc ' + b.doc);
      check('the bar never runs past the screen — ' + WIDTHS.join(', ') + ' px, signed out and signed in (' + WIDTHS.length * 2 + ' loads, the numbers painted in each)', bars.length === WIDTHS.length * 2 && bars.every((b) => b.painted) && !over.length, over.join(' | ') || bars.filter((b) => !b.painted).map((b) => b.who + '@' + b.w).join());
      const icons = bars.filter((b) => b.icon), badIcon = icons.filter((b) => !b.pill || !b.ico || b.text !== '📊' || b.more || b.entry || b.ph < b.ctl - 1 || b.pw < b.ctl - 1);
      check('  ...where the open row of links has no room for the count (.is-tight), the pill stays as a 📊 button alone, as tall and as wide as the bar\'s other controls (--nav-ctl) — at ' + (icons.map((b) => b.who + '@' + b.w).join(', ') || 'none of these widths'),
        icons.length >= 2 && icons.some((b) => b.who === 'out') && icons.some((b) => b.who === 'in') && !badIcon.length && bars.filter((b) => !b.icon && b.ico).length === 0, JSON.stringify(badIcon.concat(icons.length ? [] : bars.filter((b) => b.w >= 1600).map((b) => b.who + '@' + b.w + ' ' + b.cls))).slice(0, 400));
      const shown = bars.filter((b) => b.more), snug = bars.filter((b) => b.pill && !b.icon && !b.more && b.w > 700);
      const badShown = shown.filter((b) => b.tiers.includes('is-snug') || !/· ✓ \d+ verified · [\d.]+[KMB]? views$/.test(b.text));
      const badSnug = snug.filter((b) => !b.tiers.includes('is-snug') || b.needed !== true);
      check('  ...the new numbers are shown where there is room ("· ✓ 6 verified · 2.8K views"), and where there is not the bar is .is-snug — only when it is needed (without it the bar would not hold)',
        shown.length >= 4 && snug.length >= 1 && !badShown.length && !badSnug.length, 'shown ' + shown.map((b) => b.who + '@' + b.w).join(',') + ' snug ' + snug.map((b) => b.who + '@' + b.w + ':' + b.needed).join(',') + ' bad ' + JSON.stringify(badShown.concat(badSnug)).slice(0, 300));
      const order = bars.filter((b) => b.tiers.length && b.tiers[0] !== 'is-snug');
      check('  ....is-snug is always the first tier on: no later tier without it', !order.length, order.map((b) => b.who + '@' + b.w + ' ' + b.tiers.join(' ')).join(' | '));
      const noWay = bars.filter((b) => !b.pill && !b.entry);
      check('  ...always exactly one way in: wherever the pill is not in the bar, the menu holds 📊 Site numbers; where it is (whole or as 📊), the menu does not', !noWay.length && bars.filter((b) => b.pill && b.entry).length === 0, noWay.map((b) => b.who + '@' + b.w + ' ' + b.cls).join());
      const p = bars.find((b) => b.who === 'out' && b.w === 1280);
      const wantLabel = new RegExp('^\\d+ (person|people) Sending it right now, 6 verified members, ' + SEED.viewsTotal.toLocaleString('en-US').replace(/,/g, ',') + ' page views since ' + longDay(SEED.first) + '$');
      check('the pill is a button (type="button", aria-haspopup="dialog") with a description and no title, named by all three numbers in words; its words say ' + '"✓ 6 verified · ' + short(SEED.viewsTotal) + ' views"',
        p && p.tag === 'BUTTON' && p.type === 'button' && p.pop === 'dialog' && p.tip && p.tip.length >= 8 && !p.title && wantLabel.test(p.label) && p.text.endsWith('✓ 6 verified · ' + short(SEED.viewsTotal) + ' views'), p && JSON.stringify({ label: p.label, text: p.text, tip: p.tip }));

      /* — the first answer. Before it the numbers are "·", each in about the room its real number takes, so the new numbers
         show before it only where they still show after it. (With bare "·" the bar was measured ~12px narrower than it would
         be: in that band they showed for a moment and vanished when the answer came.) The narrowest width that shows them is
         found by halving, signed in, first with /api/presence kept waiting, then with its answer in. — */
      await cdp('Network.clearBrowserCookies');
      await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: B });
      await cdp('Network.setCookie', { name: 'sid', value: SEED.sid, url: B });
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false });
      await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
      fetchMode = 'hold'; held.length = 0;
      await cdp('Fetch.enable', { patterns: [{ urlPattern: '*/api/presence*' }] });
      await cdp('Page.navigate', { url: B + '/wall' });
      await until('document.readyState === "complete" && !!document.getElementById("nav-live") && window.AUTH && AUTH.user && document.querySelector(".profile-link")', 8000);
      await sleep(600);
      const moreAt = async (w) => {
        await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: 860, deviceScaleFactor: 1, mobile: false });
        await ev('dispatchEvent(new Event("resize")), true'); await sleep(180);
        return ev('(() => { const m = document.querySelector("#nav-live .nav-live-more"); return !!m && m.getClientRects().length > 0; })()');
      };
      const narrowest = async () => {
        let lo = 701, hi = 1400;
        if (await moreAt(lo) || !(await moreAt(hi))) return null;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await moreAt(mid)) hi = mid; else lo = mid; }
        return hi;
      };
      const beforeLive = await ev('!document.querySelector("#nav-live.is-live") && document.querySelector(".nav-live-vn").textContent === "·"');
      const tBefore = await narrowest();
      fetchMode = 'pass';
      while (held.length) await cdp('Fetch.continueRequest', { requestId: held.shift() }).catch(() => {});
      await cdp('Fetch.disable');
      const answered = await until('document.querySelector("#nav-live.is-live") && /\\d/.test(document.querySelector(".nav-live-vn").textContent)', 8000);
      await sleep(300);
      const tAfter = await narrowest();
      check('the new numbers never show and then vanish when the first answer comes: before it they show from ' + tBefore + 'px, after it from ' + tAfter + 'px (signed in) — never from a narrower width before than after',
        beforeLive && !!answered && tBefore !== null && tAfter !== null && tBefore >= tAfter - 1, JSON.stringify({ beforeLive, answered: !!answered, tBefore, tAfter }));

      /* — a re-fit (a resize) on a long page scrolled down: the bar is measured again and the page stays where it was — */
      const kept = [];
      for (const w of [1024, 1280]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: 860, deviceScaleFactor: 1, mobile: false });
        await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
        await cdp('Page.navigate', { url: B + '/about' });
        await until('document.readyState === "complete" && document.querySelector("#nav-live.is-live")', 8000); await sleep(600);
        await ev('window.scrollTo({ top: 1800, behavior: "instant" }), window.__fits = 0, new MutationObserver((r) => { window.__fits += r.filter((x) => x.attributeName === "class").length; }).observe(document.querySelector("nav.nav"), { attributes: true }), true');
        await sleep(300);
        const y0 = await ev('scrollY');
        await ev('dispatchEvent(new Event("resize")), true'); await sleep(500);
        kept.push({ w, y0, y1: await ev('scrollY'), refits: await ev('window.__fits') });
      }
      check('a re-fit of the bar on a long page scrolled down (a resize at 1024 and 1280 px) leaves the page where it was — it used to move up 42px for each way the row was tried',
        kept.every((k) => k.y0 >= 1000 && k.refits > 0 && k.y1 === k.y0), JSON.stringify(kept));
      /* — a fresh load of a link to a #section (the site links to /about#og-rules five times): the browser glides there, and the
         bar's fitting (fonts, the first answer) must not stop it — a scroll of fit()'s own once left it near the top — */
      const landed = [];
      for (const [w, who, url] of [[1024, 'out', '/about#og-rules'], [1280, 'out', '/about#og-rules'], [1600, 'out', '/about#og-rules'], [1280, 'in', '/about#og-rules']]) {
        await cdp('Page.navigate', { url: 'about:blank' }); await sleep(100);
        await cdp('Network.clearBrowserCookies');
        await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: B });
        if (who === 'in') await cdp('Network.setCookie', { name: 'sid', value: SEED.sid, url: B });
        await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: 860, deviceScaleFactor: 1, mobile: false });
        await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
        await cdp('Page.navigate', { url: B + url });
        await until('document.readyState === "complete"');
        let y = -1, still = 0;
        for (let i = 0; i < 100 && still < 8; i++) { await sleep(100); const v = await ev('scrollY'); if (v === y) still++; else { still = 0; y = v; } }   // until the glide and the fitting are over
        const r = await ev('(() => { const el = document.getElementById("og-rules"); return { y: Math.round(scrollY), top: el ? Math.round(el.getBoundingClientRect().top) : null, live: !!document.querySelector("#nav-live.is-live"), cls: document.querySelector("nav.nav").className }; })()');
        landed.push({ w, who, ...r });
      }
      check('a fresh load of /about#og-rules (1024, 1280 and 1600 px; signed out and in) ends with that section at the top of the screen, under the bar — not stopped short by the bar\'s fitting',
        landed.every((l) => l.top !== null && l.top >= 0 && l.top <= 220 && l.y > 1000), JSON.stringify(landed));

      /* — the pop-up: Enter on the pill at 1280, the menu's 📊 Site numbers at 390 (signed in) and 320 — */
      const visDays = SEED.rows.filter((r) => r[0] >= new Date(Date.parse(today + 'T00:00:00Z') - 89 * 864e5).toISOString().slice(0, 10));
      const maxPeople = Math.max(...visDays.map((r) => r[1])), maxViews = Math.max(...visDays.map((r) => r[2]));
      // …and at 641 (the tablet width the cards once went two to a row, too narrow for their charts), and where the open row
      // shows the pill as 📊 alone (Enter on it)
      const iconAt = bars.find((b) => b.icon && b.who === 'in') || bars.find((b) => b.icon);
      const WALK = [[1280, 'out', 'pill'], [390, 'in', 'menu'], [320, 'out', 'menu'], [641, 'out', 'pill']].concat(iconAt ? [[iconAt.w, iconAt.who, 'pill']] : []);
      for (const [w, who, how] of WALK) {
        errors.length = 0;
        await open(w, who);
        const asIcon = how === 'pill' && (await ev('document.querySelector("nav.nav").classList.contains("is-tight") && !!(document.querySelector("#nav-live .nav-live-ico") || { getClientRects: () => [] }).getClientRects().length'));
        if (how === 'pill') { await ev('document.getElementById("nav-live").focus(), true'); await press('Enter'); }
        else { await ev('document.getElementById("nav-toggle").click(), true'); await until('document.getElementById("nav-menu").classList.contains("open")', 3000); await ev('document.querySelector(".nav-stats-open").click(), true'); }
        const ready = await until('document.querySelector("#full-view:not([hidden]) .ss-cards")', 8000);
        const s = ready ? await ev(POP) : null;
        const tag = w + 'px' + (who === 'in' ? ', signed in' : '') + (how === 'pill' ? (asIcon ? ' (Enter on the pill, a 📊 alone in the open row)' : ' (Enter on the pill)') : ' (📊 Site numbers in the menu)');
        check('at ' + tag + ': it opens as a modal dialog labelled "Just Send It, in numbers", with focus inside it and a described ✕',
          s && s.open && s.role === 'dialog' && s.modal === 'true' && s.title === 'Just Send It, in numbers' && s.inside && s.xTip && s.xTip.length > 10, s && JSON.stringify({ role: s.role, modal: s.modal, title: s.title, inside: s.inside }));
        if (!s) continue;
        const [c1, c2, c3] = s.cards;
        check('  ...three cards in order — Sending it, Verified members, Views — each with its number now: the live count, 6, and every view', s.cards.length === 3 && c1.h3 === 'Sending it' && c2.h3 === 'Verified members' && c3.h3 === 'Views'
          && /^\d+$/.test(c1.num) && c1.unit === 'right now' && c2.num === '6' && c2.unit === 'now' && c3.num === SEED.viewsTotal.toLocaleString('en-US') && c3.unit === 'since ' + longDay(SEED.first), JSON.stringify(s.cards.map((c) => [c.h3, c.num, c.unit])));
        check('  ...the three charts drawn from the answer: 90 bars of people and of views (the missing day a marked stub, never a 0), the verified step line, every bar and every day titled; today says "today so far"',
          c1.bars === 90 && c3.bars === 90 && c1.barsTitled && c3.barsTitled && c2.line && c1.hits.length === 90 && c2.hits.length === 90 && c3.hits.length === 90 && [c1, c2, c3].every((c) => c.hits.every((t) => t.length > 5))
            && c1.none.length === 1 && /no record — the site counted nothing that day/.test(c1.none[0]) && /\(today so far\): \d+ (people|person)$/.test(c1.todayBar) && /\(today so far\): [\d,]+ views?$/.test(c3.todayBar)
            && /\(today so far\): 5 of today’s verified members had last passed the check by then$/.test(c2.hits[89]), JSON.stringify({ b: [c1.bars, c3.bars], none: c1.none, today: [c1.todayBar, c3.todayBar, c2.hits[89]] }));
        check('  ...the verified line never calls a day\'s step that day\'s count: every day "N of today\'s verified members had last passed the check by then", and its table\'s column says the same',
          c2.hits.length === 90 && c2.hits.every((t) => /^\d{1,2} [A-Z][a-z]{2,3}( \(today so far\))?: \d+ of today’s verified members had last passed the check by then$/.test(t)) && c2.colHead === 'Of today’s verified members, passed by this day',
          JSON.stringify({ some: c2.hits.slice(-2), col: c2.colHead }));
        check('  ...every note is a sentence with a capital (the Views card\'s is "The last 90 days shown."), and the people are counted once per network and browser a day',
          [c1, c2, c3].every((c) => c.metas.every((m) => /^[A-Z]/.test(m))) && c3.metas.join() === 'The last 90 days shown.' && c1.metas.some((m) => m.includes('once per network and browser a day (a phone that changes network counts twice), bots left out')),
          JSON.stringify([c1.metas, c3.metas]));
        check('  ...a date, or "today so far", is never broken inside, and each chart has room: ' + (s.cols === 1 ? 'one card a row' : s.cols + ' cards a row') + ', the charts ' + s.cards.map((c) => c.svgW).join('/') + 'px wide',
          [c1, c2, c3].every((c) => !c.broken.length && c.svgW >= Math.min(280, w - 120)) && (w >= 900 || s.cols === 1 || s.cards.every((c) => c.svgW >= 280)) && (w !== 641 || (s.cols === 1 && [c1, c2, c3].every((c) => c.xRows === 1))),
          JSON.stringify({ cols: s.cols, w: s.cards.map((c) => [c.svgW, c.cardW]), broken: s.cards.map((c) => c.broken), rows: s.cards.map((c) => c.xRows) }));
        check('  ...each scale labelled from the same numbers: the highest day on the y side (0 at the baseline), the first and last days under it, the chart as wide as its card',
          c1.y.join() === maxPeople + ',0' && c3.y.join() === maxViews + ',0' && c2.y.join() === '5,0' && /today so far$/.test(c1.x[c1.x.length - 1]) && c1.x.length === 2 && [c1, c2, c3].every((c) => c.svgW > c.cardW * 0.45 && c.svgW <= c.cardW),
          JSON.stringify({ y: [c1.y, c2.y, c3.y], x: c1.x, w: s.cards.map((c) => [c.svgW, c.cardW]) }));
        check('  ...what each counts, in a sentence: when counting began (from the data), that the last 90 days are shown, and that the verified line is each member from the day their wallet last passed — not the count on past days',
          /^Right now counts the people with the site open in the last minute or so; the chart counts the different people who opened a page each day\.$/.test(c1.what) && c1.meta.includes('Since ' + longDay(SEED.first) + ', when the site began counting') && /the last 90 days shown/.test(c1.meta)
            && /On the line, each is counted from the day their wallet last passed it\.$/.test(c2.what) && /it is not a record of the count on past days/.test(c2.meta) && /1 verified member has no recorded day and is not in the line\./.test(c2.meta)
            && c3.what.startsWith('Pages opened by people since ' + longDay(SEED.first) + ', when the site began counting') && /summary|Show the numbers/.test(c1.summary) && c1.sumTip,
          JSON.stringify([c1.what, c1.meta, c2.what, c2.meta, c3.what]).slice(0, 500));
        check('  ...the foot: the way to the Wall, and how the numbers were counted', s.wall === '/wall' && /^Counted by this site from its own records — no tracker, no third party\./.test(s.note));
        check('  ...no sideways scroll, nothing outside the dialog, no text under the floor (' + Math.round(s.floor * 10) / 10 + 'px here), every control at least 44px',
          s.doc <= s.iw && s.stageSW <= s.stageCW && !s.out.length && !s.small.length && !s.tiny.length, JSON.stringify({ doc: s.doc, iw: s.iw, stage: [s.stageSW, s.stageCW], out: s.out, small: s.small, tiny: s.tiny }));
        // the table: every day, newest first
        await ev('document.querySelector("#full-view .ss-card--live details").open = true, true');
        const t = await ev('(() => { const rows = [...document.querySelectorAll("#full-view .ss-card--live details tbody tr")]; return { n: rows.length, first: rows[0] && rows[0].innerText.replace(/\\s+/g, " "), none: rows.filter((r) => /no record/.test(r.innerText)).length, sw: document.documentElement.scrollWidth, iw: innerWidth }; })()');
        check('  ..."Show the numbers" opens a table of every day, newest first (today so far at the top, the missing day "no record"), still with no sideways scroll',
          t.n === 90 && new RegExp('^' + longDay(today) + ' \\(today so far\\) \\d+$').test(t.first) && t.none === 1 && t.sw <= t.iw, JSON.stringify(t));
        // Tab stays inside; Esc closes; focus goes back to what opened it
        const outs = [];
        for (let i = 0; i < 14; i++) { await press('Tab'); if (!(await ev('document.getElementById("full-view").contains(document.activeElement)'))) outs.push(i); }
        await press('Tab', 8);   // Shift+Tab
        const back = await ev('document.getElementById("full-view").contains(document.activeElement)');
        check('  ...Tab and Shift+Tab never leave it', !outs.length && back, outs.join());
        /* a description that Tab put up answers the first Esc (tips.js: dismissible without closing the dialog it sits in), so it
           takes two here; straight after opening, one (below, at 1280) */
        let escs = 0, closed = null;
        while (escs < 2 && !closed) { await press('Escape'); escs++; closed = await until('document.getElementById("full-view").hidden', 1500); }
        const focus = await ev('document.activeElement && (document.activeElement.id || document.activeElement.className)');
        const want = how === 'pill' ? 'nav-live' : 'nav-toggle';
        check('  ...Esc closes it (after the description a Tab put up, which the first Esc closes), and focus goes back to ' + (how === 'pill' ? 'the pill' : 'the ≡ menu button (the menu closed when the pop-up opened)'), !!closed && focus === want, escs + ' Esc · focus ' + focus);
        check('  ...and no script error or console error on the way', !errors.length, errors.slice(0, 4).join(' | '));
      }
      /* — Esc straight after opening, the backdrop and the ✕, at 1280 — */
      await open(1280, 'out');
      await ev('document.getElementById("nav-live").focus(), true'); await press('Enter');
      await until('document.querySelector("#full-view:not([hidden]) .ss-cards")', 8000);
      await press('Escape');
      const oneEsc = await until('document.getElementById("full-view").hidden', 1500);
      check('opened and closed at once: one Esc closes it, and focus is back on the pill', !!oneEsc && (await ev('document.activeElement && document.activeElement.id')) === 'nav-live');
      await ev('document.getElementById("nav-live").click(), true');
      await until('document.querySelector("#full-view:not([hidden]) .ss-cards")', 8000);
      await ev('document.querySelector("#full-view .cf-backdrop").click(), true');
      const byEdge = await until('document.getElementById("full-view").hidden', 3000);
      await ev('document.getElementById("nav-live").click(), true');
      await until('document.querySelector("#full-view:not([hidden]) .ss-cards")', 8000);
      await ev('document.querySelector("#full-view .cf-x").click(), true');
      const byX = await until('document.getElementById("full-view").hidden', 3000);
      check('a press on the dimmed edge closes it, and so does ✕ Close (the second open reads the already-loaded code)', !!byEdge && !!byX && (await ev('document.querySelectorAll("script[src*=\\"sitestats.js\\"]").length')) === 1);

      /* — Try again: the numbers do not come (a 500, held by the browser's own request interception), Enter on Try again; it
         fails again, then works. Focus never drops to the page under the dialog (it used to land on <body>). — */
      await open(1280, 'out');
      fetchMode = 'fail';
      await cdp('Fetch.enable', { patterns: [{ urlPattern: '*/api/site-stats*' }] });
      await ev('document.getElementById("nav-live").focus(), true'); await press('Enter');
      const errShown = await until('document.querySelector("#full-view:not([hidden]) .ss-retry")', 8000);
      await ev('document.querySelector("#full-view .ss-retry").focus(), true');
      const where = '({ inside: document.getElementById("full-view").contains(document.activeElement), on: document.activeElement ? document.activeElement.tagName + "." + document.activeElement.className : "" })';
      await press('Enter');   // fails again
      await sleep(150); await until('document.querySelector("#full-view .ss-retry") && !document.querySelector("#full-view .ss[aria-busy]")', 5000); await sleep(100);
      const f1 = await ev(where);
      fetchMode = 'pass';
      await press('Enter');   // on the new Try again: this time the numbers come
      await until('document.querySelector("#full-view .ss-cards")', 8000); await sleep(150);
      const f2 = await ev(where);
      await cdp('Fetch.disable');
      check('after Try again (Enter), focus stays in the dialog: on the new Try again when it fails again, on the dialog itself once the numbers are drawn — never on the page under it',
        !!errShown && f1.inside && /^BUTTON\..*ss-retry/.test(f1.on) && f2.inside && /cf-dialog/.test(f2.on), JSON.stringify({ errShown: !!errShown, f1, f2 }));
      // the numbers now follow the bar's poll while it is open: all three, as the pill shows them
      await ev('document.dispatchEvent(new CustomEvent("jsi:presence", { detail: { active: 2, verified: 7, views: 99999, viewsSince: "' + SEED.first + '" } })), true');
      const follow = await ev('[".ss-live-num", ".ss-ver-num", ".ss-views-num"].map((s) => (document.querySelector("#full-view " + s) || {}).textContent)');
      check('  ...and while it is open, the number now of all three cards follows the bar\'s own poll (the pill and the pop-up agree)', follow[0] === '2' && follow[1] === '7' && follow[2] === '99,999', JSON.stringify(follow));
      await ev('FullView.close(), true');
    } catch (e) {
      console.error('ERROR', e && e.stack);
      check('the browser part ran to the end', false, e && e.message);
    }
  }
}

try { if (ws) ws.close(); } catch {}
if (chromeProc) { try { chromeProc.kill('SIGKILL'); } catch {} await sleep(300); }
if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
try { if (db) db.close(); } catch {}
await halt();
try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
for (const n of notes) console.log('NOTE ' + n);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
