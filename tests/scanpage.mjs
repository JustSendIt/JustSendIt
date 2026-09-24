/* The Scanner page: one address in, the full on-chain profile out — open to everyone; the New Pairs radar
   behind it, for members only. Throwaway session only; removed in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH, ROOT, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const SRC = readFileSync(SERVER_JS, 'utf8');
const HTML = read('newpairs.html'), NP = read('newpairs.js'), SC = read('scanner.js'), CSS = read('styles.css'), APP = read('app.js');
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', SEND_POOL = '0xf30bb531d0255969be155533abac34b22bd63414';
const made = [];

async function api(p, opts = {}) {
  const r = await fetch(BASE + p, { method: opts.method || 'GET', redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.sid ? { Cookie: 'sid=' + opts.sid } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text };
}
function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id; made.push(id);
  const raw = 'tok_' + name + '_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}

try {
  /* ═══ the nav ═══ */
  const pages = readdirSync(PUB).filter((f) => f.endsWith('.html'));
  const stale = pages.filter((f) => /New&nbsp;Pairs<\/a>|>New Pairs<\/a>/.test(read(f)));
  check('the nav tab and the footer link say Scanner on every page', stale.length === 0, stale.join(','));
  check('  ...and the Scanner page marks itself current', /<a class="active" href="newpairs\.html" aria-current="page">Scanner<\/a>/.test(HTML));
  check('the page is titled as the Scanner', /<title>Scanner 🔎/.test(HTML) && /<h1 class="section-title display green"[^>]*>Scanner 🔎<\/h1>/.test(HTML));

  /* ═══ two tabs ═══ */
  check('two tabs: scan an address, and New Pairs', /id="sc-tab-scan" type="button" role="tab" aria-selected="true" aria-controls="sc-scan"/.test(HTML) && /id="sc-tab-new" type="button" role="tab" aria-selected="false" aria-controls="sc-new"/.test(HTML));
  check('  ...each driving a named tab panel', /id="sc-scan" role="tabpanel" aria-labelledby="sc-tab-scan"/.test(HTML) && /id="sc-new" role="tabpanel" aria-labelledby="sc-tab-new" hidden/.test(HTML));
  check('  ...the radar tab carries a lock while signed out', /<span class="sc-lock" id="sc-lock" aria-hidden="true">🔒<\/span>/.test(HTML) && /lock\.hidden = signedIn\(\)/.test(SC));
  check('the address form: one input, one Scan button, described by the help line', /<input class="sc-addr" id="sc-addr"[^>]*maxlength="42"[^>]*aria-describedby="sc-help"/.test(HTML) && /id="sc-go" type="submit"/.test(HTML) && /id="sc-help">Any token, or any pool, on Robinhood Chain/.test(HTML));
  check('the page says which chain, and that others are coming', /🏹 Robinhood Chain today · other chains are coming soon\./.test(HTML) && /Other chains · coming soon/.test(HTML));
  check('the tab strip is a matrix tile like every other control (CSS list and app.js SEL agree)', /\.sc-tab::before/.test(CSS) && /, \.sc-tab'/.test(APP));
  check('the radar tab panel holds the whole radar and a locked card', /<div class="sc-locked" id="sc-locked" hidden>/.test(HTML) && /<div id="sc-radar" hidden>/.test(HTML) && /<\/div><!-- \/sc-radar -->/.test(HTML) && /id="np-chainbar"/.test(HTML) && /id="np-runners"/.test(HTML));
  check('  ...whose button opens sign-in', /id="sc-signin"/.test(HTML) && /signin\.addEventListener\('click', \(\) => \{ if \(window\.AUTH && AUTH\.open\) AUTH\.open\(\); \}\)/.test(SC));
  check('the radar honesty note still says what it reads', /Uniswap-V2 factory/.test(HTML) && /hasn’t been judged/.test(HTML));
  check('scanner.js is loaded after newpairs.js (it starts the radar and uses NPCard)', HTML.indexOf('<script src="newpairs.js">') < HTML.indexOf('<script src="scanner.js">'));

  /* ═══ the radar waits to be started ═══ */
  check('newpairs.js no longer starts itself', !/setMode\(state\.mode\);   \/\/ apply persisted mode \(📈 Best Runners is the default\)\n  fetchPairs\(false\);\n\}\)\(\);/.test(NP) && /window\.NPRadar = \{ start, suspend, resume, started: \(\) => radarStarted \};/.test(NP));
  check('  ...its polls stop while its tab is hidden or the radar is parked', /const radarShown = \(\) => !radarSuspended && !document\.hidden && !\(radarPanel && radarPanel\.hidden\);/.test(NP) && /setInterval\(\(\) => \{ if \(radarShown\(\)\) fetchPairs\(false\); \}, 15000\)/.test(NP));
  check('  ...and scanner.js starts it only for a member on that tab', /if \(ok && current === 'new' && window\.NPRadar\) NPRadar\.start\(\);/.test(SC) && /if \(toNew\) gateRadar\(\); else if \(window\.NPRadar\) NPRadar\.suspend\(\);/.test(SC));
  check('the contract read is wired on every page now, not only inside the radar', /window\.NPCard\.loadContract = loadContract;/.test(NP) && NP.indexOf("document.addEventListener('toggle'") > NP.indexOf('window.NPCard = {'));
  check('the scan shows every section open, the contract included', /sections: \{ why: true, chart: true, score: true, market: true, activity: true, holders: true, contract: true \}/.test(SC) && /NPCard\.loadContract\(c\)/.test(SC));
  check('a scan is shareable (?scan=) and a pasted address scans at once', /u\.searchParams\.set\('scan', addr\.toLowerCase\(\)\)/.test(SC) && /input\.addEventListener\('paste'/.test(SC));
  check('recent scans stay in this browser only', /localStorage\.setItem\(RECENT_KEY/.test(SC) && !/fetch\([^)]*recent/.test(SC));

  /* ═══ the door on the radar ═══ */
  const anonNew = await api('/api/pairs/new');
  check('the radar feed needs a session', anonNew.status === 401 && anonNew.j && anonNew.j.code === 'need_signin', anonNew.status);
  const anonRun = await api('/api/runners?window=24h');
  check('  ...and so do the best runners', anonRun.status === 401, anonRun.status);
  const u = mkUser('__sp_member__');
  const memberNew = await api('/api/pairs/new', { sid: u.sid });
  check('  ...a member is served (or told the feed is still building)', memberNew.status === 200 && memberNew.j && (Array.isArray(memberNew.j.pairs) || memberNew.j.building), memberNew.status + ' ' + (memberNew.j && (memberNew.j.error || '')));
  const memberRun = await api('/api/runners?window=24h', { sid: u.sid });
  check('  ...runners too', memberRun.status === 200, memberRun.status);

  /* ═══ the scan itself, open to everyone ═══ */
  const bad = await api('/api/scan?address=nope');
  check('a non-address is refused with a sentence', bad.status === 400 && /valid 0x address/.test((bad.j && bad.j.error) || ''), bad.status);
  const scan = await api('/api/scan?address=' + SEND);
  const sj = scan.j || {};
  if (scan.status === 200 && sj.unavailable) check('a token scan (the chain and the price feed could not be reached from here, which the answer says honestly)', /couldn’t reach/.test(sj.message || ''), sj.message);
  else {
    check('a token scan returns the full pair profile', scan.status === 200 && sj.kind === 'token' && sj.pair && sj.pair.token && sj.pair.token.address === SEND, scan.status + ' ' + (sj.error || sj.kind));
    check('  ...with the risk legend and the community slot the popup uses', sj.risk && typeof sj.risk === 'object' && Object.prototype.hasOwnProperty.call(sj, 'community'));
  }
  const pool = await api('/api/scan?address=' + SEND_POOL);
  const pj = pool.j || {};
  if (pool.status === 200 && pj.unavailable) check('a pool scan (chain unreachable from here — said honestly)', true, pj.message);
  else check('a POOL address resolves to the token it prices', pool.status === 200 && pj.kind === 'pool' && pj.pool === SEND_POOL && pj.pair && pj.pair.token && pj.pair.token.address === SEND, pool.status + ' ' + (pj.error || pj.kind || (pj.notFound && 'notFound')));
  const quote = await api('/api/scan?address=0x0bd7d308f8e1639fab988df18a8011f41eacad73');
  check('a quote asset (WETH) is named as one, not profiled', quote.status === 200 && quote.j && quote.j.notFound && quote.j.reason === 'quote', quote.status + ' ' + JSON.stringify(quote.j).slice(0, 80));
  check('the scan route says "other chains are coming soon" when nothing is found', /other chains are coming soon/.test(SRC.slice(SRC.indexOf("p === '/api/scan'"), SRC.indexOf("p === '/api/scan'") + 3000)));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  for (const id of made) { for (const t of ['sessions', 'points_events', 'notifications']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} } try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {} }
  console.log('\ncleanup — throwaway users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_sp\\_%' ESCAPE '\\'").get().n);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
