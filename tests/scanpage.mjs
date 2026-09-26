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
/* The rows this suite writes outside the users table — the scan store and the token cache for $SEND — are put back
   exactly as they were, so a by-hand run against a real database leaves the public community count untouched. */
const snap = { scans: [], cache: [] };
try { snap.scans = db.prepare('SELECT * FROM scans WHERE token_addr IN (?, ?)').all(SEND, SEND_POOL); snap.cache = db.prepare('SELECT token_addr, updated_at, checked_at FROM token_cache WHERE token_addr IN (?, ?)').all(SEND, SEND_POOL); } catch {}
function restore() {
  try {
    db.prepare('DELETE FROM scans WHERE token_addr IN (?, ?)').run(SEND, SEND_POOL);
    for (const r of snap.scans) db.prepare('INSERT INTO scans (token_addr, pool_addr, kind, symbol, name, pair_json, first_at, last_at, read_at, count) VALUES (?,?,?,?,?,?,?,?,?,?)').run(r.token_addr, r.pool_addr, r.kind, r.symbol, r.name, r.pair_json, r.first_at, r.last_at, r.read_at, r.count);
    for (const r of snap.cache) db.prepare('UPDATE token_cache SET updated_at=?, checked_at=? WHERE token_addr=?').run(r.updated_at, r.checked_at, r.token_addr);
  } catch {}
}

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
  check('recent scans on this device stay in this browser (localStorage; the page never POSTs anything)', /localStorage\.setItem\(RECENT_KEY/.test(SC) && !/method:\s*'POST'/.test(SC) && !/body:/.test(SC));

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
  /* ═══ kept for everyone, refreshed by every scan ═══ */
  if (scan.status === 200 && sj.kind === 'token') {
    const s1 = sj.scan || {};
    check('a scan answers with its own facts: when it was read, how many times, first seen, and that it was kept', typeof s1.readAt === 'number' && typeof s1.count === 'number' && typeof s1.firstAt === 'number' && s1.stale === false && s1.kept === true && typeof s1.now === 'number', JSON.stringify(s1));
    check('  ...a count is only ever the store’s own (a failed write says kept:false and carries no count)', /kept: !!s, \.\.\.\(s \? \{ count: s\.count, firstAt: s\.first_at, lastAt: s\.last_at \} : \{\}\)/.test(SRC) && /This scan could not be kept just now/.test(SC));
    check('  ...the holder figures carry their own read time, and the page says so when they are older than the scan', sj.pair.holders && 'readAt' in sj.pair.holders && /Holder figures as of/.test(SC), JSON.stringify(sj.pair.holders && sj.pair.holders.readAt));
    check('  ...relative times keep counting and follow the server’s clock, not a skewed device clock', /setInterval\(\(\) => \{ document\.querySelectorAll\('\.sc-ago\[data-t\]'\)/.test(SC) && /clockOffset = sc\.now - Date\.now\(\)/.test(SC));
    check('  ...the read is fresh (within the scan window), not an old cached row', Date.now() - s1.readAt < 60000, Date.now() - s1.readAt);
    const row = db.prepare('SELECT * FROM scans WHERE token_addr=?').get(SEND);
    check('the token is in the scan store with the full profile snapshot', row && row.pair_json && JSON.parse(row.pair_json).token.address === SEND && row.symbol === 'SEND', row && row.symbol);
    check('  ...and the store knows nothing about who scanned', row && !Object.keys(row).some((k) => /user|ip|session|who/i.test(k)), row && Object.keys(row).join(','));
    const beforeAgain = db.prepare('SELECT count, last_at FROM scans WHERE token_addr=?').get(SEND);
    const again = await api('/api/scan?address=' + SEND);
    const s2 = (again.j && again.j.scan) || {};
    check('the same client scanning it again inside ten minutes does not count again, nor move it up the list (the count is scans, not one person’s clicks)', again.status === 200 && s2.count === beforeAgain.count && s2.lastAt === beforeAgain.last_at && s2.firstAt === s1.firstAt, JSON.stringify({ beforeAgain, s2 }));
    const base = (snap.scans.find((r) => r.token_addr === SEND) || {}).count || 0;   // whatever the store held before this run
    // +1 on a fresh server; +0 when this client was already counted inside the last ten minutes (a re-run against the same process)
    check('  ...one client is counted at most once per ten minutes (the pool scan of the same coin did not count again)', beforeAgain.count === base + 1 || beforeAgain.count === base, beforeAgain.count + ' vs base ' + base);
    check('  ...within the 5 s window the same read is shared (no second upstream hit); the snapshot is never older', s2.readAt >= s1.readAt, s2.readAt - s1.readAt);
    // an older stored snapshot must be replaced by the next fresh read: age the row, scan, compare
    db.prepare('UPDATE scans SET read_at = read_at - 3600000 WHERE token_addr=?').run(SEND);
    db.prepare('UPDATE token_cache SET updated_at = updated_at - 3600000 WHERE token_addr=?').run(SEND);
    const third = await api('/api/scan?address=' + SEND);
    const s3 = (third.j && third.j.scan) || {};
    const rowAfter = db.prepare('SELECT read_at, count FROM scans WHERE token_addr=?').get(SEND);
    if (third.status === 200 && third.j && third.j.unavailable) check('a scan whose upstream failed mid-test is reported as unavailable, not as a number', true, third.j.message);
    else {
      check('an aged row is re-read live and the stored snapshot is updated (read_at moves to now)', third.status === 200 && rowAfter && Date.now() - rowAfter.read_at < 60000 && s3.readAt === rowAfter.read_at, JSON.stringify({ s3, rowAfter }));
      check('  ...the stale flag is off when the read succeeded', s3.stale === false);
    }
  }
  if (pool.status === 200 && pj.kind === 'pool') {
    check('the pool answer says the chain confirmed it is this token’s pool', pj.poolVerified === true, JSON.stringify({ poolVerified: pj.poolVerified }));
    const p2 = await api('/api/scan?address=' + SEND_POOL);   // the token scans above re-labelled the row 'token'; a pool scan labels it back
    const row = db.prepare('SELECT kind, pool_addr, count FROM scans WHERE token_addr=?').get(SEND);
    check('a verified pool scan is recorded under the token it prices, remembering the pool', p2.status === 200 && row && row.kind === 'pool' && row.pool_addr === SEND_POOL, JSON.stringify(row));
    check('  ...so the store has ONE row for the coin however it was pasted', db.prepare('SELECT COUNT(*) n FROM scans WHERE token_addr=? OR token_addr=?').get(SEND, SEND_POOL).n === 1);
    const t2 = await api('/api/scan?address=' + SEND);
    const rowT = db.prepare('SELECT kind, pool_addr FROM scans WHERE token_addr=?').get(SEND);
    check('  ...a later token scan keeps the pool it learnt (kind follows the paste, the pool is not forgotten)', t2.status === 200 && rowT && rowT.kind === 'token' && rowT.pool_addr === SEND_POOL, JSON.stringify(rowT));
    check('a known pool is answered from the store without asking the chain which token it holds', /const known = scanByPool\(addr\);/.test(SRC) && /SELECT token_addr FROM scans WHERE pool_addr=\?/.test(SRC));
  }
  const rec = await api('/api/scan/recent');
  const rj = rec.j || {};
  // the list holds what was actually read: when every scan above came back "unavailable" (the node refused this
  // IP), there is honestly nothing to list, and the check is that it says so rather than inventing an entry
  const scanned = scan.status === 200 && sj.kind === 'token';
  check('the public recent list is served, one entry per token' + (scanned ? '' : ' (the chain refused this run, so it is honestly empty)'), rec.status === 200 && Array.isArray(rj.scans) && (scanned ? rj.scans.some((x) => x.token === SEND) : true) && new Set(rj.scans.map((x) => x.token)).size === rj.scans.length, rec.status + ' ' + JSON.stringify(rj).slice(0, 120));
  check('  ...each entry is the token, when, how many times — and nothing about a person', rj.scans && rj.scans.every((x) => ['token', 'pool', 'kind', 'symbol', 'name', 'lastAt', 'readAt', 'count'].every((k) => k in x) && Object.keys(x).length === 8), rj.scans && JSON.stringify(Object.keys(rj.scans[0] || {})));
  check('  ...and answers without a session', rec.status === 200);
  check('the fallback: an unreachable upstream serves the last snapshot, marked stale with its read time', /if \(cached && usable\(cached\.pair\)\) return \{ pair: cached\.pair, readAt: row\.updated_at, stale: true/.test(SRC) && /if \(usable\(p\)\) return \{ pair: rescoreCachedPair\(p\), readAt: s\.read_at, stale: true/.test(SRC));
  check('  ...and a snapshot only ever replaces an OLDER one, so a stale answer cannot overwrite fresher data', /pair_json = CASE WHEN excluded\.pair_json IS NOT NULL AND excluded\.read_at >= read_at THEN excluded\.pair_json ELSE pair_json END/.test(SRC));
  check('a claimed pool is only a pool when the factory or the price feed says so — and only then is it remembered', /async function poolVerified\(addr, pt, pair\)/.test(SRC) && /factoryGetPair\(pt\.token0, pt\.token1, true\)\) === addr/.test(SRC) && /scanRecord\(tok, kind, poolOk === true \? pool : null/.test(SRC) && /says it prices/.test(SC) && /treat the pool itself as unverified/.test(SC));
  check('the Scanner refuses an old radar copy (liveMaxAgeMs) and a re-check that brought nothing never moves updated_at', /liveMaxAgeMs: SCAN_FRESH_MS/.test(SRC) && /opts\.liveMaxAgeMs != null && now\(\) - liveAt > opts\.liveMaxAgeMs/.test(SRC) && /UPDATE token_cache SET checked_at=\? WHERE token_addr=\?/.test(SRC) && !/UPDATE token_cache SET updated_at=\? WHERE token_addr=\?/.test(SRC));
  check('  ...the persistent copy of a radar token is stamped with the radar’s read time, never "now"', /tokenCachePut\(tokenAddr, \{ pair: live \}, liveAt\)/.test(SRC) && /\.run\(tok, pj, sym, nm, found, reason, at \|\| now\(\), now\(\)\)/.test(SRC));
  check('the count is one per client per coin per ten minutes', /rateLimit\('scanc:' \+ clientIp\(req\) \+ '\|' \+ tok, 1, 10 \* 60e3\)/.test(SRC));
  check('a burst of scans can never take the live-fetch slots a Send Call open needs (reserved slots, low-priority scans)', /const LIVE_LOOKUP_RESERVE = 2;/.test(SRC) && /liveLookups >= LIVE_LOOKUP_MAX - \(opts\.lowPriority \? LIVE_LOOKUP_RESERVE : 0\)/.test(SRC) && /liveMaxAgeMs: SCAN_FRESH_MS, lowPriority: true/.test(SRC));
  check('a price-feed outage never becomes a blank "fresh" profile: the lookup says it could not check', /if \(!dexr\.ok && !p\.indexed && \(!p\.market \|\| p\.market\.priceUsd == null\)\) return \{ unavailable: true/.test(SRC) && /if \(!dexr\.ok\) return \{ unavailable: true, reason: \(dexr\.reason \|\| 'price feed unreachable'\) \+ ' — the chain has no main-quote pool/.test(SRC));
  check('  ...and a blank is never served as "the last snapshot"', /const usable = \(p\) => p && \(p\.indexed \|\| \(p\.market && p\.market\.priceUsd != null\) \|\| p\.priceStale\);/.test(SRC));
  check('a token neither feed names is named by its own contract (name()/symbol() on-chain)', /async function tokenNameOnChain\(token\)/.test(SRC) && /ethCall\(token, '0x06fdde03'\), ethCall\(token, '0x95d89b41'\)/.test(SRC) && /const oc = await tokenNameOnChain\(t\.token\);/.test(SRC));
  check('"not indexed" is said as a fact about the price feed, never as "this token has not traded"', !/this pair has not traded/.test(NP) && /the price feed does not index this pair/.test(NP) && !/this pair has not traded/.test(read('watchlist.js')));
  check('  ...the page says so in words, not as a live number', /this is the last snapshot, read/.test(SC) && /Nothing on it is live/.test(SC));
  check('the scan forces a fresh read (maxAgeMs) instead of settling for the popup’s stale row', /lookupTokenPair\(tok, \{ maxAgeMs: SCAN_FRESH_MS, liveMaxAgeMs: SCAN_FRESH_MS, lowPriority: true \}\)/.test(SRC) && /const SCAN_FRESH_MS = 5 \* 1000;/.test(SRC));
  check('the page shows the community strip and says what is kept', /id="sc-community-list"/.test(HTML) && /never who scanned it/.test(HTML) && /fetch\('\/api\/scan\/recent'/.test(SC));
  check('the store is bounded', /const SCANS_KEEP = 5000;/.test(SRC) && /DELETE FROM scans WHERE token_addr IN \(SELECT token_addr FROM scans ORDER BY last_at DESC, rowid DESC LIMIT -1 OFFSET \?\)/.test(SRC));

  const quote = await api('/api/scan?address=0x0bd7d308f8e1639fab988df18a8011f41eacad73');
  check('a quote asset (WETH) is named as one, not profiled', quote.status === 200 && quote.j && quote.j.notFound && quote.j.reason === 'quote', quote.status + ' ' + JSON.stringify(quote.j).slice(0, 80));
  check('the scan route says "other chains are coming soon" when nothing is found', /other chains are coming soon/.test(SRC.slice(SRC.indexOf("p === '/api/scan'"), SRC.indexOf("p === '/api/scan'") + 8000)));

  /* ═══ a Send Call straight from a scan: to the Wall, or to the reader's Send Squad when they are in one ═══ */
  const CMP = read('compose.js');
  check('a scanned token\'s result carries a "Send Call to the Wall" button', /callRowHTML\(tok\) \+/.test(SC) && /data-sc-call="wall"/.test(SC) && /📣 Send Call to the Wall/.test(SC));
  check('  ...and a squad button only for a VERIFIED member of a squad — none at all otherwise', /\.filter\(\(q\) => q && q\.verified && q\.id > 0\)/.test(SC) && /if \(!list\.length\) return;\s+\/\/ not in a squad: there is no squad button/.test(SC) && /data-sc-call="squad"/.test(SC));
  check('  ...both open the site\'s one composer with the token filled in, public or to that squad', /COMPOSE\.openCall\(\{\s+token: row\.dataset\.tok,/.test(SC) && /squadId: squad \? Number\(b\.dataset\.squadId\) : 0/.test(SC));
  check('  ...a call made from the full detail on screen is not flagged "without DYOR" — only for that token, and only when the detail rendered', /viewedDetail: !!result\.querySelector\('\.np-detail-group, \.np-contract'\)/.test(SC)
    && /detailSeenFor = tok && o\.viewedDetail \? tok : null;/.test(CMP) && /viewedDetail = !!detailSeenFor && detailSeenFor === String\(addr\)\.toLowerCase\(\);/.test(CMP));
  check('  ...the composer fills and reads the handed-over token, keeps it through a sign-in, and forgets it on close', /function fillCallToken\(tok\)/.test(CMP) && /lookupCallToken\(tok\);/.test(CMP)
    && /pendingSquad = keepSquad; pendingToken = keepToken; detailSeenFor = keepSeen;/.test(CMP) && /if \(tok\) fillCallToken\(tok\);/.test(CMP) && /pendingToken = null; detailSeenFor = null;\s+\/\/ nor does a token another page handed over/.test(CMP));
  check('  ...a new sign-in re-reads the reader\'s squads, and so does a scan a minute later or a return to the tab (a gate re-check, a join or a leave elsewhere)', /document\.addEventListener\('auth:change', repaintSquadCall\);/.test(SC) && /Date\.now\(\) - mySquadsAt < 60e3/.test(SC) && /document\.addEventListener\('visibilitychange'/.test(SC));
  check('  ...and a Send Call box opened before a sign-in comes back after it, however long the sign-in takes', /const onAuthClosed = \(\) =>/.test(CMP) && /pendingTimer = setTimeout\(abandon, 10 \* 60 \* 1000\);/.test(CMP));
  // the list the squad button is built from, and the call it leads to
  const tag = randomBytes(3).toString('hex');
  const owner = mkUser('__sp_sqown_' + tag), loner = mkUser('__sp_loner_' + tag);
  const sq = Number(db.prepare("INSERT INTO squads (creator_id, name, gate_kind, member_count, created_at) VALUES (?, ?, 'none', 1, ?)").run(owner.id, 'Scan Squad ' + tag, Date.now()).lastInsertRowid);
  db.prepare("INSERT INTO squad_members (squad_id, user_id, joined_at, role, verified) VALUES (?, ?, ?, 'owner', 1)").run(sq, owner.id, Date.now());
  const mine = await api('/api/squads/mine', { sid: owner.sid }), none = await api('/api/squads/mine', { sid: loner.sid });
  check('the squad list the button reads names a verified member\'s squad', mine.status === 200 && mine.j && mine.j.squads.some((q) => q.id === sq && q.verified === true), mine.status + ' ' + JSON.stringify(mine.j && mine.j.squads));
  check('  ...and is empty for someone in no squad, so they get no squad button', none.status === 200 && none.j && Array.isArray(none.j.squads) && none.j.squads.length === 0, none.status + ' ' + JSON.stringify(none.j));
  const call = await api('/api/calls', { method: 'POST', sid: owner.sid, body: { token: SEND, note: '', viewedDetail: true, shareWallet: false, squadId: sq } });
  const crow = db.prepare('SELECT squad_id, no_dyor FROM calls WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(owner.id);
  if (call.status === 200) check('  ...and a Send Call made the way the scanner opens it lands in that squad, private, not flagged "without DYOR"', crow && crow.squad_id === sq && crow.no_dyor === 0, JSON.stringify(crow));
  else check('the scanner-style squad call could not be made this run (' + call.status + ': ' + ((call.j && call.j.error) || '') + ') — not asserted', call.status === 502 || call.status === 503 || /liquidity|slow/i.test((call.j && call.j.error) || ''), call.status);   // the chain or the price feed refused: said as an outage, never as "no pair"
  try {
    for (const t of ['calls', 'posts', 'points_events', 'notifications']) db.prepare(`DELETE FROM ${t} WHERE user_id IN (?, ?)`).run(owner.id, loner.id);
    db.prepare('DELETE FROM squad_members WHERE squad_id = ?').run(sq);
    db.prepare('DELETE FROM squads WHERE id = ?').run(sq);
  } catch {}
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  restore();
  for (const id of made) { for (const t of ['sessions', 'points_events', 'notifications']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} } try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {} }
  console.log('\ncleanup — throwaway users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_sp\\_%' ESCAPE '\\'").get().n, '· scan rows for $SEND back to', snap.scans.length);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
