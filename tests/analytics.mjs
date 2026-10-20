/* Google Analytics (owner, 2026-10-17): "add in google analytic and add analytics api data to the admin page".
   1. lib/ga.js, the reports reader, against a stubbed Google: a real RS256 assertion, the token exchange, the three API
      calls, the shaping, a part that fails left out (never zero), the token kept and re-asked after a 401.
   2. public/ga.js, the page tag, in a sandbox: it loads nothing until a measurement id is filled in, and never for a
      browser sending Global Privacy Control or Do Not Track, one that turned it off, or the admin page; what it sends
      carries no query string; the privacy page's switch.
   3. The server on the runner's throwaway database (no GA set up there): /ga.js, the CSP, which pages load the tag,
      the admin route and script (admin only), the privacy page — and the admin section's drawing, in a sandbox.
   Everything it creates it deletes. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, randomBytes, generateKeyPairSync, createVerify } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { ROOT, DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const require = createRequire(import.meta.url);
const GA = require(path.join(ROOT, 'lib', 'ga.js'));
const PUB = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

/* ═══ 1. the reports reader ═══ */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const KEY = JSON.stringify({ type: 'service_account', client_email: 'reader@site-123.iam.gserviceaccount.com', private_key: privateKey, private_key_id: 'abc' });
try {
  let threw = null; try { GA.parseKey('{"type":"authorized_user"}'); } catch (e) { threw = e; }
  let threw2 = null; try { GA.parseKey('not json'); } catch (e) { threw2 = e; }
  check('a key that is not a service account key is refused with a reason', threw && /not a Google service account key/.test(threw.message) && threw2 && /not JSON/.test(threw2.message));
  const jwt = GA.signedAssertion(GA.parseKey(KEY), 1700000000);
  const [h, b, sig] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  const ok = createVerify('RSA-SHA256').update(h + '.' + b).verify(publicKey, Buffer.from(sig, 'base64url'));
  check('the token request is a JWT signed RS256 with the service account\'s key, for read-only Analytics, good for an hour', ok && JSON.parse(Buffer.from(h, 'base64url').toString()).alg === 'RS256' && claims.iss === 'reader@site-123.iam.gserviceaccount.com' && claims.scope === 'https://www.googleapis.com/auth/analytics.readonly' && claims.aud === GA.TOKEN_URL && claims.exp - claims.iat === 3600, JSON.stringify(claims));
  let bad = null; try { GA.makeClient({ propertyId: 'properties/12', readKey: async () => KEY, fetch: async () => ({}), now: () => 0 }); } catch (e) { bad = e; }
  check('a property id that is not the property\'s number is refused before anything is asked', bad && /numeric id/.test(bad.message));

  // a stubbed Google: one token endpoint, three report methods
  const calls = [];
  let T = 1e12, failDevices = false, unauthorizedOnce = false, extrasOn = true, masterOff = false;
  const rep = (dims, mets, rows) => ({ dimensionHeaders: dims.map((name) => ({ name })), metricHeaders: mets.map((name) => ({ name })), rows: rows.map((r) => ({ dimensionValues: r[0].map((value) => ({ value })), metricValues: r[1].map((value) => ({ value: String(value) })) })) });
  const TOT = ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'engagementRate', 'averageSessionDuration'];
  const fakeFetch = async (url, o) => {
    calls.push({ url, body: o.body, auth: o.headers && o.headers.Authorization });
    const json = (status, j) => ({ ok: status >= 200 && status < 300, status, json: async () => j });
    if (url === GA.TOKEN_URL) return json(200, { access_token: 'tok-' + calls.length, expires_in: 3600, token_type: 'Bearer' });
    if (unauthorizedOnce) { unauthorizedOnce = false; return json(401, { error: { message: 'Request had invalid authentication credentials.' } }); }
    if (url.endsWith(':batchRunReports')) return json(200, { reports: [
      rep(['dateRange'], TOT, [[['d7'], [70, 30, 90, 400, 0.61, 95.5]], [['d28'], [250, 120, 310, 1500, 0.58, 101]]]),   // no visits today: no row
      rep(['date'], ['activeUsers', 'sessions', 'screenPageViews'], [[['20261016'], [12, 14, 50]], [['20261017'], [9, 10, 41]]]),
      rep(['pagePath'], ['screenPageViews', 'activeUsers'], [[['/newpairs'], [600, 140]], [['/'], [500, 200]]]),
      rep(['sessionSource'], ['sessions', 'activeUsers'], [[['(direct)'], [150, 110]], [['x.com'], [60, 50]]]),
      rep(['country'], ['activeUsers'], [[['United States'], [180]], [['Canada'], [20]]]),
    ] });
    if (url.endsWith(':runReport')) return failDevices ? json(500, { error: { message: 'backend error' } }) : json(200, rep(['deviceCategory'], ['activeUsers'], [[['mobile'], [150]], [['desktop'], [100]]]));
    if (url.endsWith(':runRealtimeReport')) return json(200, rep([], ['activeUsers'], [[[], [4]]]));
    if (url.startsWith(GA.ADMIN_BASE + '/v1beta/properties/123456789/dataStreams')) return json(200, { dataStreams: [{ name: 'properties/123456789/dataStreams/77', type: 'WEB_DATA_STREAM', displayName: 'sendrh.com', webStreamData: { measurementId: 'G-TEST12345' } }] });
    if (url === GA.ADMIN_BASE + '/v1alpha/properties/123456789/dataStreams/77/enhancedMeasurementSettings') return json(200, masterOff
      ? { outboundClicksEnabled: true, pageChangesEnabled: true, scrollsEnabled: true }   // Google leaves a false boolean out: streamEnabled absent = the master switch is off
      : { streamEnabled: true, outboundClicksEnabled: extrasOn, siteSearchEnabled: false, formInteractionsEnabled: extrasOn, fileDownloadsEnabled: false, videoEngagementEnabled: false, scrollsEnabled: false, pageChangesEnabled: extrasOn });
    return json(404, {});
  };
  const client = GA.makeClient({ propertyId: '123456789', readKey: async () => KEY, fetch: fakeFetch, now: () => T, measurementId: 'G-TEST12345' });
  const r1 = await client.report();
  const tok = calls.filter((c) => c.url === GA.TOKEN_URL), apiCalls = calls.filter((c) => c.url !== GA.TOKEN_URL);
  check('one token exchange (the JWT-bearer grant), then the property\'s batchRunReports, runReport and runRealtimeReport, and the Admin API\'s stream settings, all with that token', tok.length === 1 && /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/.test(tok[0].body) && apiCalls.slice(0, 3).map((c) => c.url.replace(GA.API_BASE, '')).join() === '/properties/123456789:batchRunReports,/properties/123456789:runReport,/properties/123456789:runRealtimeReport' && apiCalls.length === 5 && apiCalls.every((c) => c.auth === 'Bearer tok-1'), JSON.stringify(calls.map((c) => c.url)));
  check('  ...the stream behind the site\'s measurement id is found, and Google\'s automatic extras that are on are named (outbound clicks carry link addresses)', r1.stream && r1.stream.found === true && r1.stream.stream === 'sendrh.com' && r1.stream.extrasOn.join() === "outbound link clicks (with the link's address),page views on in-page address changes (sent with the full address, ?query included),form interactions", JSON.stringify(r1.stream));
  const sentBatch = JSON.parse(apiCalls[0].body).requests;
  check('  ...the batch asks for the totals over today / 7 / 28 days, the daily series, top pages, sources and countries', sentBatch.length === 5 && sentBatch[0].dateRanges.map((x) => x.name).join() === 'today,d7,d28' && sentBatch[1].dimensions[0].name === 'date' && sentBatch[2].dimensions[0].name === 'pagePath' && sentBatch[3].dimensions[0].name === 'sessionSource' && sentBatch[4].dimensions[0].name === 'country');
  check('the report: totals per range (a range with no visits: counts 0, rates "—"), all 28 days with quiet ones as zeros, pages, sources, countries, devices and the last 30 minutes, all Google\'s figures', r1.totals.d28.activeUsers === 250 && r1.totals.d7.screenPageViews === 400 && r1.totals.d28.engagementRate === 0.58 && r1.totals.today.activeUsers === 0 && r1.totals.today.engagementRate === null && r1.totals.today.averageSessionDuration === null && r1.daily.length === 28 && r1.daily[27].date === '20261017' && r1.daily[27].views === 41 && r1.daily[26].activeUsers === 12 && r1.daily[0].date === '20260920' && r1.daily[0].activeUsers === 0 && r1.daily.slice(0, 26).every((d) => d.activeUsers === 0) && r1.pages[0].path === '/newpairs' && r1.pages[0].views === 600 && r1.sources[1].source === 'x.com' && r1.countries[0].users === 180 && r1.devices[0].device === 'mobile' && r1.realtime.activeUsers === 4 && Object.keys(r1.errors).length === 0, JSON.stringify(r1).slice(0, 300));
  // the token is kept; a part that fails is left out with its reason; a 401 makes it ask for a new token
  calls.length = 0; failDevices = true; T += 60000;
  const r2 = await client.report();
  check('  ...the token is kept for the next read (no new exchange); a part Google cannot answer carries its reason and is left out — never zero', calls.every((c) => c.url !== GA.TOKEN_URL) && r2.devices === undefined && /500/.test(r2.errors.devices) && r2.totals.d28.activeUsers === 250);
  calls.length = 0; failDevices = false; extrasOn = false; T += 60000;
  const rOff = await client.report();
  check('  ...with every extra off, none is named (page views only, as the privacy page says)', rOff.stream && rOff.stream.found && rOff.stream.extrasOn.length === 0);
  masterOff = true; T += 60000;
  const rMaster = await client.report(); masterOff = false;
  check('  ...with the enhanced-measurement master switch off (Google leaves streamEnabled out), nothing is named though the stored per-extra flags still say true', rMaster.stream.found && rMaster.stream.extrasOn.length === 0, JSON.stringify(rMaster.stream));
  calls.length = 0; unauthorizedOnce = true; T += 60000;
  const r3 = await client.report();
  check('  ...a 401 drops the token, so the next call exchanges for a fresh one', /401/.test(r3.errors.reports || '') && calls.filter((c) => c.url === GA.TOKEN_URL).length === 1 && r3.devices && r3.devices.length === 2, JSON.stringify(r3.errors));
  // a key the server cannot read: said so, and the key's contents never appear in any error
  const c2 = GA.makeClient({ propertyId: '1', readKey: async () => { throw new Error('the key file (GA_KEY_FILE) could not be read by the server'); }, fetch: fakeFetch, now: () => T });
  const r4 = await c2.report();
  check('a key file the server cannot read: every part says so, and nothing is drawn as zero', /could not be read/.test(r4.errors.reports) && r4.totals === undefined && !JSON.stringify(r4).includes('PRIVATE KEY'));
} catch (e) { check('the reader section ran to the end', false, e && e.stack); }

/* ═══ 2. the page tag ═══ */
function runTag({ id, gpc, dnt, off, pathname, referrer, age, noStorage, said }) {
  const appended = [], store = new Map(off ? [['jsi:analytics', 'off']] : []);
  const btn = { hidden: true, textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, listeners: [], addEventListener(t, f) { this.listeners.push(f); } };
  const say = { textContent: '' };
  const win = { doNotTrack: dnt ? '1' : undefined };
  const session = new Map(said === 'no' ? [['jsi-age-no', '1']] : []);
  const waiters = [];
  if (age) win.AGE = { needed: age === 'pending', whenOk: (fn) => { if (age === 'pending') waiters.push(fn); else fn(); } };
  const ctx = {
    window: win, navigator: { globalPrivacyControl: !!gpc, doNotTrack: dnt ? '1' : 'unspecified' },
    sessionStorage: { getItem: (k) => (session.has(k) ? session.get(k) : null) },
    location: { origin: 'https://sendrh.com', pathname: pathname || '/newpairs' },
    localStorage: noStorage ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } } : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    document: { readyState: 'complete', referrer: referrer || '', title: 'Page title — Just Send It', cookie: said === 'none' || said === 'no' || age === 'pending' ? '' : 'jsi_age=18', head: { appendChild: (el) => appended.push(el) }, createElement: () => ({}), addEventListener() {}, querySelector: (sel) => (sel === '[data-ga-optout]' ? btn : sel === '[data-ga-state]' ? say : null) },
    Date, encodeURIComponent,
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(PUB('ga.js').replace('__GA_MEASUREMENT_ID__', id || ''), ctx);
  return { appended, get layer() { return win.dataLayer; }, btn, say, store, win, answerYes: () => { win.AGE.needed = false; waiters.splice(0).forEach((f) => f()); } };
}
try {
  const none = runTag({});
  check('with no measurement id filled in, the tag loads nothing and sends nothing; the privacy page says it is not on', none.appended.length === 0 && none.layer === undefined && /not turned on for this site/.test(none.say.textContent) && none.btn.hidden === true);
  const on = runTag({ id: 'G-TEST12345', pathname: '/newpairs', referrer: 'https://sendrh.com/u/someone?code=SECRET#x' });
  const cfg = on.layer && [...on.layer].find((a) => a[0] === 'config');
  check('with an id: gtag.js from googletagmanager.com, configured with Google Signals and ad personalisation off', on.appended.length === 1 && on.appended[0].src === 'https://www.googletagmanager.com/gtag/js?id=G-TEST12345' && on.appended[0].async === true && cfg && cfg[1] === 'G-TEST12345' && cfg[2].allow_google_signals === false && cfg[2].allow_ad_personalization_signals === false);
  check('  ...the page and the page you came from are sent WITHOUT their query strings or # parts (no invite or referral code leaves), and a profile it came from without its name', cfg && cfg[2].page_location === 'https://sendrh.com/newpairs' && cfg[2].page_referrer === 'https://sendrh.com/u/', JSON.stringify(cfg && cfg[2]));   // and a profile it came from, only as "a profile"
  for (const [label, o] of [['Global Privacy Control', { gpc: true }], ['Do Not Track', { dnt: true }], ['a visitor who turned it off here', { off: true }], ['the admin page', { pathname: '/admin' }], ['a visitor who answered "under 18"', { said: 'no', age: 'answered' }], ['a page without the 18+ question, for a visitor who never answered it', { said: 'none' }]]) {
    const t = runTag({ id: 'G-TEST12345', ...o });
    check('  ...nothing loads for ' + label, t.appended.length === 0 && t.layer === undefined);
  }
  // the 18+ question: nothing while it is up; it starts on "yes"
  const waiting = runTag({ id: 'G-TEST12345', age: 'pending' });
  const before18 = waiting.appended.length;
  waiting.answerYes();
  check('with the 18+ question up, nothing loads until it is answered yes — then the tag starts', before18 === 0 && waiting.appended.length === 1 && waiting.layer && [...waiting.layer].some((a) => a[0] === 'config'));
  // a profile, a post, a Send ID: sent as the kind of page; a community or squad without its name
  const prof = runTag({ id: 'G-TEST12345', pathname: '/u/SlayMe', referrer: 'https://sendrh.com/u/Somebody?tab=wall' });
  const pc = [...prof.layer].find((a) => a[0] === 'config')[2];
  const comm = runTag({ id: 'G-TEST12345', pathname: '/community', referrer: 'https://x.com/some/post?s=1' });
  const cc = [...comm.layer].find((a) => a[0] === 'config')[2];
  const plain = runTag({ id: 'G-TEST12345', pathname: '/wall' });
  check('a member\'s profile goes as just "/u/" titled "A sender profile" (the referrer too); a community keeps its address but not its name; other pages keep their title', pc.page_location === 'https://sendrh.com/u/' && pc.page_title === 'A sender profile' && pc.page_referrer === 'https://sendrh.com/u/' && cc.page_location === 'https://sendrh.com/community' && cc.page_title === 'A community' && cc.page_referrer === 'https://x.com/some/post' && [...plain.layer].find((a) => a[0] === 'config')[2].page_title === 'Page title — Just Send It', JSON.stringify([pc, cc]));
  // a browser that will not keep site storage: the switch still stops it on this page, and says the choice cannot be kept
  const nost = runTag({ id: 'G-TEST12345', noStorage: true });
  nost.btn.listeners[0]();
  check('the switch in a browser that blocks site storage: turns it off here and says the choice cannot be remembered, pointing to Global Privacy Control', nost.win['ga-disable-G-TEST12345'] === true && /turned off in this browser/.test(nost.say.textContent) && /does not let the site remember the choice, so it cannot hold on other pages — Global Privacy Control/.test(nost.say.textContent), nost.say.textContent);
  const sw = runTag({ id: 'G-TEST12345' });
  const before = sw.say.textContent, label1 = sw.btn.textContent;
  sw.btn.listeners[0]();
  check('the privacy page\'s switch: says it is on, turns it off in this browser (remembered here, stops it on this page too), and back on', /is on in this browser/.test(before) && /Turn off/.test(label1) && sw.store.get('jsi:analytics') === 'off' && /turned off in this browser/.test(sw.say.textContent) && sw.win['ga-disable-G-TEST12345'] === true && /Turn Google Analytics back on/.test(sw.btn.textContent) && (sw.btn.listeners[0](), !sw.store.has('jsi:analytics')));
  const gpcSw = runTag({ id: 'G-TEST12345', gpc: true });
  check('  ...for a browser sending Global Privacy Control it says why nothing loads, and offers no switch', /Global Privacy Control or Do Not Track/.test(gpcSw.say.textContent) && gpcSw.btn.hidden === true);
} catch (e) { check('the tag section ran to the end', false, e && e.stack); }

/* ═══ 3. the server, the pages, the admin section ═══ */
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const made = [];
const sha = (t) => createHash('sha256').update(String(t)).digest('hex');
function mkUser(name, id) {
  db.prepare('DELETE FROM users WHERE username=?').run(name);
  if (id) db.prepare('INSERT INTO users (id, username, created_at, avatar, holder_verified_at, holder_state, auto_named) VALUES (?,?,?,?,?,?,0)').run(id, name, Date.now(), '🧪', Date.now(), 'ok');
  else db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state, auto_named) VALUES (?,?,?,?,?,0)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const uid = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(uid);
  const raw = 'tok_' + name + '_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(sha(raw), uid, Date.now(), Date.now() + 864e5);
  return { id: uid, cookie: 'sid=' + raw + '; jsi_age=18' };
}
const get = (p, cookie, extra) => new Promise((resolve) => {
  const r = http.request({ host: 'localhost', port: PORT, method: 'GET', path: p, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(extra || {}) } }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, text: b, h: res.headers })); });
  r.on('error', () => resolve({ status: 0, text: '', h: {} })); r.end();
});
try {
  const tag = await get('/ga.js');
  check('/ga.js is served as script, revalidated every time, with no measurement id filled in (this runner has none set)', tag.status === 200 && /javascript/.test(tag.h['content-type']) && tag.h['cache-control'] === 'no-cache' && /var ID = '';/.test(tag.text) && !/__GA_MEASUREMENT_ID__/.test(tag.text), tag.status + ' ' + tag.h['content-type']);
  const again = await get('/ga.js', null, { 'If-None-Match': tag.h.etag });
  check('  ...and a browser that has it gets a 304', again.status === 304);
  const page = await get('/about');
  check('with Google Analytics off, no page\'s CSP names any Google host', page.status === 200 && !/google/i.test(page.h['content-security-policy'] || ''), page.h['content-security-policy']);
  check('  ...and with it on, the CSP adds exactly gtag.js\'s host and Google\'s collection hosts (Google\'s own CSP guidance)', /"script-src 'self' https:\/\/static\.cloudflareinsights\.com" \+ \(GA_ID \? ' https:\/\/www\.googletagmanager\.com' : ''\)/.test(SRC) && /\(GA_ID \? ' https:\/\/\*\.google-analytics\.com https:\/\/\*\.analytics\.google\.com https:\/\/www\.googletagmanager\.com' : ''\)/.test(SRC) && /\(GA_ID \? ' https:\/\/\*\.google-analytics\.com https:\/\/\*\.googletagmanager\.com' : ''\)/.test(SRC));
  const pages = readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html'));
  const missing = pages.filter((f) => !['admin.html', 'gate.html'].includes(f) && !/<script src="\/ga\.js" defer><\/script>\n<\/head>/.test(PUB(f)));
  check('every page loads the tag at the end of its head — except the admin page and the 18+ check, which never do', missing.length === 0 && !/ga\.js/.test(PUB('admin.html').replace('adminanalytics.js', '')) && !/ga\.js/.test(PUB('gate.html')), missing.join(','));
  // the admin route and script: the admin's alone
  const admin = mkUser('__ga_admin__', 987654), member = mkUser('__ga_member__');
  const leaks = [];
  for (const [who, ck] of [['visitor', null], ['member', member.cookie]]) {
    const a = await get('/api/admin/analytics', ck), s = await get('/adminanalytics.js', ck), s2 = await get('/AdminAnalytics.js', ck);
    if (a.status !== 404 || s.status !== 404 || s2.status !== 404 || /api\/admin\/analytics/.test(s.text)) leaks.push(who + ' ' + a.status + '/' + s.status + '/' + s2.status);
  }
  check('the analytics route and the admin section\'s script are the admin\'s alone: 404 for a visitor and a member', leaks.length === 0, leaks.join(' | '));
  const aj = await get('/api/admin/analytics', admin.cookie);
  let j = null; try { j = JSON.parse(aj.text); } catch {}
  check('  ...the admin gets what is set up — here nothing: the tag and the reports are off, with the three settings named', aj.status === 200 && j && j.setup.tag === false && j.setup.api === false && j.report === null && j.setup.missing.join() === 'GA_MEASUREMENT_ID,GA_PROPERTY_ID,GA_KEY_FILE', aj.text.slice(0, 200));
  const sj = await get('/adminanalytics.js', admin.cookie);
  check('  ...and the script, kept by nobody (private, no-store)', sj.status === 200 && /\/api\/admin\/analytics/.test(sj.text) && /private/.test(sj.h['cache-control'] || '') && /no-store/.test(sj.h['cache-control'] || ''));
  check('the reports are kept 10 minutes and read again on request (6 a minute), one read at a time; the key file is read only for a token', /const GA_TTL = 10 \* 60 \* 1000;/.test(SRC) && /rateLimit\('ga-refresh:' \+ me\.id, 6, 6e4\)/.test(SRC) && /if \(gaInflight\) return gaInflight;/.test(SRC) && /readKey: async \(\) => \{ try \{ return await fs\.promises\.readFile\(GA_KEY_FILE, 'utf8'\); \}/.test(SRC));
} catch (e) { check('the server section ran to the end', false, e && e.stack); }

// the cache: a read in which Google answered nothing never replaces good figures
try {
  const answers = [];
  const cctx = vm.createContext({ GA4: { makeClient: () => ({ report: async () => answers.shift() }) }, now: () => 5, fs: {}, fetch: () => {}, AbortSignal: { timeout: () => null }, process: { env: {} }, GA_PROPERTY: '1', GA_KEY_FILE: '/x', GA_ID: 'G-X', Error, Object });
  vm.runInContext(/const GA_TTL = [^\n]+\n/.exec(SRC)[0] + /let gaCache = [^\n]+\n/.exec(SRC)[0] + /async function gaReport\(force\) \{[\s\S]*?\n\}\n/.exec(SRC)[0] + 'this.read = gaReport; this.cache = () => gaCache;', cctx);
  answers.push({ totals: { d28: { activeUsers: 9 } }, errors: {} }, { errors: { reports: 'HTTP 503', devices: 'HTTP 503', realtime: 'HTTP 503' } }, { devices: [{ device: 'mobile', users: 3 }], errors: { reports: 'HTTP 500' } });
  const g1 = await cctx.read(true);
  let threw = null; try { await cctx.read(true); } catch (e) { threw = e; }
  const keptData = cctx.cache().data;
  const g3 = await cctx.read(true);
  check('the server keeps the last good figures when Google answers nothing (the failure is reported beside them); a read with any part answered replaces them', g1.totals.d28.activeUsers === 9 && threw && /did not answer: HTTP 503/.test(threw.message) && keptData.totals.d28.activeUsers === 9 && g3.devices && cctx.cache().data === g3);
} catch (e) { check('the cache section ran to the end', false, e && e.stack); }

// the privacy page
try {
  const P = PUB('privacy.html');
  check('the privacy policy names Google Analytics, what it sends, that ad features are off, and that GPC / Do Not Track / the switch stop it', /when the operator has turned it on — <b>Google Analytics<\/b>/.test(P) && /without anything after a \? or #/.test(P) && /Google Signals and ad personalisation are switched off/.test(P) && /Global Privacy Control or Do Not Track/.test(P) && /nothing that identifies you — your name, account, email or wallet — is sent/.test(P) && /It records page views only: Google's automatic extras \(outbound link clicks, site search, form interactions, file downloads, video and scroll events\) are switched off/.test(P));
  check('  ...it says the tag waits for the 18+ answer, and sends a profile, post or Send ID only as that kind of page, a community or squad without its name; the static line is true without JavaScript', /Once you have answered the 18\+ question with yes/.test(P) && /never starts before the 18\+ question is answered yes, or after an answer of under 18/.test(P) && /a member's profile, a post or a Send ID is sent only as that kind of page, and a community or a Send Squad without its name/.test(P) && /<span data-ga-state>Once this page has loaded, this line shows whether Google Analytics runs in your browser/.test(P));
  check('  ...the privacy page dresses the tooltip its switch uses (gate.css carries .tip-bubble), and the whitepaper\'s CSP figure and caption no longer say Google never sees a visitor', /\.tip-bubble \{ position: fixed; z-index: 9990;/.test(PUB('gate.css')) && !/so Google, Dexscreener and Blockscout never see a visitor's address/.test(PUB('whitepaper.html')) && /Google Analytics' tag, only while the operator has it turned on/.test(PUB('whitepaper.html')));
  check('  ...its cookie table lists the Google Analytics cookies, and it no longer says there are no third-party cookies or that Google never sees your IP', /<code>_ga<\/code> and <code>_ga_…<\/code>/.test(P) && !/There are no third-party cookies/.test(P) && !/so Google, Dexscreener and Blockscout never see your IP address/.test(P));
  check('  ...it has the switch (a described button the tag wires, with the page\'s tooltip script), and its version moved (2026-10-18, again 2026-10-20 for burn proofs)', /<span data-ga-state>[^<]+<\/span> <button class="g-btn g-btn-ghost" type="button" data-ga-optout hidden data-tip="[^"]+">/.test(P) && /<script src="tips\.js" defer><\/script>/.test(P) && /Version 2026-10-20 · \$Send/.test(P));
} catch (e) { check('the privacy section ran to the end', false, e && e.stack); }

// the admin section, drawn in a sandbox from a report and from "not set up"
async function drawAdmin(answer) {
  const el = (id) => ({ id, hidden: true, innerHTML: '', textContent: '', disabled: false, listeners: [], addEventListener(t, f) { this.listeners.push(f); } });
  const els = { 'adm-ga': el('adm-ga'), 'adm-ga-sum': el('adm-ga-sum'), 'adm-ga-body': el('adm-ga-body'), 'adm-ga-refresh': el('adm-ga-refresh') };
  const asked = [];
  const ctx = vm.createContext({ document: { getElementById: (id) => els[id] || null, addEventListener() {} }, window: { api: async (u) => { asked.push(u); return answer; } },
    AUTH: { user: { username: 'Send', admin: true }, ready: Promise.resolve() }, Date, Math, Number, String, Object, Array, Promise, JSON });
  ctx.window.AUTH = ctx.AUTH;
  vm.runInContext(PUB('adminanalytics.js'), ctx);
  await flush();
  return { els, asked };
}
try {
  const report = { at: 1e12, propertyId: '123', errors: { devices: 'the Analytics Data API answered 500: backend error' },
    totals: { today: { activeUsers: 3, newUsers: 1, sessions: 4, screenPageViews: 9, engagementRate: 0.5, averageSessionDuration: 40 }, d7: { activeUsers: 70, newUsers: 30, sessions: 90, screenPageViews: 400, engagementRate: 0.61, averageSessionDuration: 95 }, d28: { activeUsers: 1250, newUsers: 620, sessions: 1310, screenPageViews: 5500, engagementRate: 0.583, averageSessionDuration: 101 } },
    daily: [{ date: '20261016', activeUsers: 12, sessions: 14, views: 50 }, { date: '20261017', activeUsers: 40, sessions: 44, views: 120 }],
    pages: [{ path: '/newpairs', views: 600, users: 140 }, { path: '/<script>', views: 1, users: 1 }], sources: [{ source: '(direct)', sessions: 150, users: 110 }], countries: [{ country: 'United States', users: 180 }], realtime: { activeUsers: 4 },
    stream: { checked: true, found: true, stream: 'sendrh.com', extrasOn: ["outbound link clicks (with the link's address)"] } };
  const a = await drawAdmin({ setup: { tag: true, api: true, measurementId: 'G-TEST12345', propertyId: '123', missing: [] }, report, cachedAt: 1e12 });
  const H = a.els['adm-ga-body'].innerHTML;
  check('the admin section, for the admin: shown, asked once, and the tiles carry Google\'s figures (right now, today, 7 and 28 days, visits, views, engagement, average visit)', a.els['adm-ga'].hidden === false && a.asked.join() === '/api/admin/analytics' && /<b>4<\/b><span>on the site right now/.test(H) && /<b>3<\/b><span>visitors today/.test(H) && /<b>70<\/b><span>visitors, last 7 days/.test(H) && /<b>1,250<\/b><span>visitors, last 28 days<\/span><i>620 of them new/.test(H) && /<b>5,500<\/b><span>page views/.test(H) && /<b>58\.3%<\/b><span>engaged visits/.test(H) && /<b>1 min 41 s<\/b><span>average visit/.test(H), H.slice(0, 500));
  check('  ...the days drawn as bars to one scale, the busiest named; the tables; a page path from Google is escaped, never markup', /<svg viewBox="0 0 560 140" role="img" aria-label="Visitors a day for the last 2 days; the busiest was 17 Oct with 40"/.test(H) && (H.match(/<rect /g) || []).length === 2 && /busiest: 17 Oct, 40 visitors/.test(H) && /<td>\/newpairs<\/td><td>600<\/td><td>140<\/td>/.test(H) && /&lt;script&gt;/.test(H) && !/<td><script>/.test(H));
  check('  ...a part Google could not answer is named with its reason and left out (no devices table), never drawn as zero', /Google could not answer part of this: <b>devices<\/b> — the Analytics Data API answered 500/.test(H) && !/<h3>Devices<\/h3>/.test(H));
  check('  ...Google\'s enhanced measurement recording more than page views is a loud warning naming each extra and where to turn it off', /Google’s enhanced measurement is recording more than page views<\/b> on the stream “sendrh\.com”: outbound link clicks \(with the link&#39;s address\)\. The privacy page promises page views only — turn these off in Google Analytics → Admin → Data streams/.test(H));
  const clean = await drawAdmin({ setup: { tag: true, api: true, measurementId: 'G-TEST12345', propertyId: '123', missing: [] }, report: { ...report, errors: {}, stream: { checked: true, found: true, stream: 'sendrh.com', extrasOn: [] } } });
  const unknown = await drawAdmin({ setup: { tag: true, api: true, measurementId: 'G-TEST12345', propertyId: '123', missing: [] }, report: { ...report, errors: {}, stream: { checked: false, why: 'the Analytics Admin API answered 403: disabled' } } });
  check('  ...all off: said so; could not be read: said, with the reason and the setting to check by hand — never assumed off', /✔ Google’s enhanced measurement extras are off/.test(clean.els['adm-ga-body'].innerHTML) && /Could not check Google’s enhanced measurement settings \(the Analytics Admin API answered 403: disabled\)/.test(unknown.els['adm-ga-body'].innerHTML));
  check('  ...the refresh button asks Google now (refresh=1)', (a.els['adm-ga-refresh'].listeners[0](), await flush(), a.asked[1] === '/api/admin/analytics?refresh=1'));
  // figures that do not exist read "—"; the bars share one scale
  const thin = await drawAdmin({ setup: { tag: true, api: true, measurementId: 'G-TEST12345', propertyId: '123', missing: [] }, report: { at: 1e12, errors: {}, totals: { today: { activeUsers: 0, newUsers: 0, sessions: 0, screenPageViews: 0, engagementRate: null, averageSessionDuration: null }, d7: { activeUsers: 0, newUsers: 0, sessions: 0, screenPageViews: 0, engagementRate: null, averageSessionDuration: null }, d28: { activeUsers: 10, newUsers: 10, sessions: 10, screenPageViews: 30, engagementRate: null, averageSessionDuration: 119.6 } }, daily: [{ date: '20261016', activeUsers: 10, sessions: 1, views: 1 }, { date: '20261017', activeUsers: 5, sessions: 1, views: 1 }], pages: [], sources: [], countries: [], devices: [], stream: { checked: true, found: true, stream: 's', extrasOn: [] } } });
  const TH = thin.els['adm-ga-body'].innerHTML;
  check('  ...a figure that does not exist (no realtime answer, a rate over no visits) reads "—", never 0; 119.6 s reads "2 min 0 s"', /<b>—<\/b><span>on the site right now<\/span><i>not answered/.test(TH) && /<b>—<\/b><span>engaged visits/.test(TH) && /<b>2 min 0 s<\/b><span>average visit/.test(TH), TH.slice(0, 300));
  check('  ...the bars share one scale (10 and 5 visitors: 122 and 61 high)', /<rect x="0\.0" y="18" width="279\.0" height="122"/.test(TH) && /height="61"/.test(TH), (TH.match(/<rect[^>]+>/g) || []).join(' '));
  const kept = await drawAdmin({ setup: { tag: true, api: true, measurementId: 'G-TEST12345', propertyId: '123', missing: [] }, report, cachedAt: 5e11, error: 'Google Analytics did not answer: 503' });
  check('  ...when Google does not answer, the last figures stay, and the line says which time they are from', /⚠️ Google Analytics did not answer: 503 — showing the figures from /.test(kept.els['adm-ga-sum'].textContent) && /visitors, last 28 days/.test(kept.els['adm-ga-body'].innerHTML));
  const thr = await drawAdmin({ setup: { tag: true, api: true, measurementId: 'G-TEST12345', propertyId: '123', missing: [] }, report, cachedAt: 1e12, throttled: true });
  check('  ...a refresh asked for too often says so (the figures shown are the kept ones)', /Refreshed too often/.test(thr.els['adm-ga-sum'].textContent));
  const half = await drawAdmin({ setup: { tag: true, api: false, measurementId: 'G-TEST12345', propertyId: null, missing: ['GA_PROPERTY_ID', 'GA_KEY_FILE'], invalid: ['GA_PROPERTY_ID'] }, report: null });
  check('  ...the tag on but no reports: says the tag is counting visitors (not "not set up"); a set-but-wrong property id is named as such', /The page tag is on and counting visitors; the reports here are not set up yet/.test(half.els['adm-ga-sum'].textContent) && /GA_PROPERTY_ID is set but not valid — use the property’s number/.test(half.els['adm-ga-body'].innerHTML));
  const b = await drawAdmin({ setup: { tag: false, api: false, measurementId: null, propertyId: null, missing: ['GA_MEASUREMENT_ID', 'GA_PROPERTY_ID', 'GA_KEY_FILE'] }, report: null });
  const B = b.els['adm-ga-body'].innerHTML;
  check('not set up: it says so, and names exactly what the operator sets (the measurement id; the property, the key file, Viewer access, the Data API)', /Not set up yet/.test(b.els['adm-ga-sum'].textContent) && /<code>GA_MEASUREMENT_ID<\/code>/.test(B) && /<code>GA_PROPERTY_ID<\/code>/.test(B) && /<code>GA_KEY_FILE<\/code>/.test(B) && /<b>Viewer<\/b> access/.test(B) && /Google Analytics Data API/.test(B) && b.els['adm-ga-refresh'].hidden === true);
} catch (e) { check('the admin section ran to the end', false, e && e.stack); }

try {
  for (const id of made) { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); db.prepare('DELETE FROM users WHERE id = ?').run(id); }
  check('cleanup: the test accounts and their sessions are gone', made.every((id) => !db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)));
} catch (e) { check('cleanup ran', false, e && e.stack); }
db.close();

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !x ? '' : '  — ' + x)); if (ok) pass++; }
console.log(`${pass}/${results.length} passed`);
