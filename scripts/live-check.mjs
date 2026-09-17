#!/usr/bin/env node
/* ===== npm run live-check -- https://sendrh.com ===================================================
 * The go-live probe. Run it against the DEPLOYED origin, from anywhere, after DNS and Cloudflare are set:
 * it asks the site the questions a launch can fail on and prints one line per answer.
 *
 *   PASS  what it should be
 *   WARN  works, but something worth knowing (not behind Cloudflare, a data vendor unreachable)
 *   FAIL  a visitor would hit this — fix before sharing a code
 *   SKIP  does not apply (an http:// origin has no HSTS to check)
 *
 * Dependency-free, read-only, and it creates nothing on the site: the one POST it makes is the 18+ answer,
 * which sets a cookie on this client and touches no account. Exit code 1 when anything FAILs, so it can
 * gate a deploy. Also runs against a local server (tests/livecheck.mjs does), where the https-only and
 * Cloudflare-only checks are skipped or warned rather than failed.
 */
const ORIGIN = String(process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+$/.test(ORIGIN)) { console.error('usage: npm run live-check -- https://your.domain'); process.exit(2); }
const HTTPS = ORIGIN.startsWith('https://');
const HOST = new URL(ORIGIN).host;
const SEND_TOKEN = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105';   // $SEND — public, on every page of the site

const rows = [];
let fails = 0;
const say = (level, name, extra) => { rows.push([level, name, extra]); if (level === 'FAIL') fails++; };
const pass = (name, ok, extra) => say(ok ? 'PASS' : 'FAIL', name, extra);
const warn = (name, ok, extra) => say(ok ? 'PASS' : 'WARN', name, extra);

async function get(path, opts = {}) {
  const url = /^https?:/.test(path) ? path : ORIGIN + path;
  try {
    const r = await fetch(url, { method: opts.method || 'GET', redirect: 'manual', signal: AbortSignal.timeout(opts.timeout || 20000),
      headers: { 'User-Agent': 'JustSendIt-live-check', Accept: opts.accept || '*/*', ...(opts.headers || {}) }, body: opts.body });
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: true, status: r.status, headers: r.headers, buf, text: buf.toString('utf8') };
  } catch (e) { return { ok: false, status: 0, headers: new Headers(), buf: Buffer.alloc(0), text: '', err: e && (e.cause && e.cause.code || e.name || e.message) }; }
}
const h = (r, name) => (r.headers.get(name) || '');

/* ---- 1. the process is up and can write ---- */
const hz = await get('/healthz');
let hzj = null; try { hzj = JSON.parse(hz.text); } catch {}
pass('/healthz answers ok:true (the process is up and its disk is writable)', hz.status === 200 && hzj && hzj.ok === true, hz.ok ? hz.status + ' ' + hz.text.slice(0, 80) : 'unreachable: ' + hz.err);
if (!hz.ok) { print(); process.exit(1); }

/* ---- 2. the front door ---- */
const home = await get('/', { accept: 'text/html' });
pass('the homepage is served', home.status === 200 && /text\/html/.test(h(home, 'content-type')), home.status + ' ' + h(home, 'content-type'));
const csp = h(home, 'content-security-policy');
pass("a strict Content-Security-Policy is on (script-src 'self')", /script-src 'self'/.test(csp), csp.slice(0, 120) || '(none)');
pass('the policy names no third party for scripts, fonts or images', csp && !/googleapis|gstatic|dexscreener|blockscout|cloudflareinsights/.test(csp), csp.slice(0, 160));
pass('nothing was injected into the page that the policy would block (Rocket Loader off)', !/rocket-loader|rocketloader/i.test(home.text));
pass('no analytics beacon was injected (Web Analytics automatic setup off)', !/cloudflareinsights\.com|beacon\.min\.js/i.test(home.text));
pass('the age gate is on the page', /agegate\.js/.test(home.text));
pass('no X-Powered-By header', !h(home, 'x-powered-by'));
const cfRay = h(home, 'cf-ray');
warn('Cloudflare is in front of the origin (cf-ray present)', !!cfRay, cfRay ? 'cf-ray ' + cfRay : 'no cf-ray header — requests reach the origin directly');
if (cfRay) {
  pass('Cloudflare is not caching the page HTML', !/HIT/i.test(h(home, 'cf-cache-status')), h(home, 'cf-cache-status') || '(no cf-cache-status)');
}

/* ---- 3. https, and one hostname ---- */
if (HTTPS) {
  pass('HSTS is sent over https', /max-age=\d+/.test(h(home, 'strict-transport-security')), h(home, 'strict-transport-security') || '(none)');
  const plain = await get('http://' + HOST + '/', { timeout: 10000 });
  if (!plain.ok) say('WARN', 'http:// redirects to https (could not connect on port 80)', plain.err);
  else pass('http:// redirects to https', plain.status >= 301 && plain.status <= 308 && /^https:\/\//.test(h(plain, 'location')), plain.status + ' → ' + h(plain, 'location'));
} else {
  say('SKIP', 'HSTS and the http→https redirect (this origin is http)', '');
}
if (!/^www\./.test(HOST) && !/^(localhost|127\.0\.0\.1)(:|$)/.test(HOST)) {
  const www = await get(ORIGIN.replace('://', '://www.') + '/about.html', { timeout: 10000 });
  if (!www.ok) say('WARN', 'www.' + HOST + ' redirects to the apex (www does not resolve or connect — fine if you never created the record)', www.err);
  else pass('www.' + HOST + ' redirects to the apex, keeping the path', www.status >= 301 && www.status <= 308 && new RegExp('^' + ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/about\\.html').test(h(www, 'location')), www.status + ' → ' + (h(www, 'location') || '(served the page on www: every POST there would fail the Origin check)'));
} else {
  say('SKIP', 'the www redirect (no apex domain here)', '');
}

/* ---- 4. BASE_URL matches the address people use (the CSRF check, cookies, SEO links) ---- */
const yes = await get('/api/age', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ confirm: true, age: 18 }) });
pass('a browser POST from this origin is accepted (BASE_URL matches the address in use)', yes.status === 200, yes.status + ' ' + yes.text.slice(0, 100));
if (yes.status === 200) {
  const sc = h(yes, 'set-cookie');
  pass('the cookie it sets is ' + (HTTPS ? 'Secure' : 'set (Secure would apply over https)'), /jsi_age=18/.test(sc) && (!HTTPS || /;\s*Secure/i.test(sc)), sc.slice(0, 120));
}
const evil = await get('/api/age', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ confirm: true, age: 18 }) });
pass('a POST from another origin is refused', evil.status === 403, evil.status);
const robots = await get('/robots.txt');
pass('robots.txt carries this origin (BASE_URL is set to it)', robots.status === 200 && robots.text.includes(HOST), robots.text.split('\n').find((l) => /sitemap/i.test(l)) || robots.status);
const sitemap = await get('/sitemap.xml');
pass('sitemap.xml carries this origin', sitemap.status === 200 && sitemap.text.includes(HOST), sitemap.status);

/* ---- 5. the API is served by the origin, uncached, and says the site's rules ---- */
const gs = await get('/api/gate/state');
let gsj = null; try { gsj = JSON.parse(gs.text); } catch {}
pass('/api/gate/state answers with the entry rules', gs.status === 200 && gsj && gsj.ageMin === 18 && gsj.rules && typeof gsj.rules.holdMinUsd === 'number', gs.status + ' ' + gs.text.slice(0, 100));
pass('API answers are not cached (no-store)', /no-store/.test(h(gs, 'cache-control')), h(gs, 'cache-control'));
if (cfRay) pass('Cloudflare does not cache the API', !/HIT/i.test(h(gs, 'cf-cache-status')), h(gs, 'cf-cache-status') || '(dynamic)');
const cfg = await get('/api/config');
let cfgj = null; try { cfgj = JSON.parse(cfg.text); } catch {}
pass('/api/config is served', cfg.status === 200 && cfgj && cfgj.features, cfg.status);
if (cfgj && cfgj.media) warn('the theme song and the feature video are on the box (they ship outside git)', cfgj.media.audio !== false && cfgj.media.video !== false, JSON.stringify(cfgj.media));

/* ---- 6. the pages reach nothing but this site ---- */
const priv = await get('/privacy.html', { accept: 'text/html' });
pass('the privacy page is served', priv.status === 200, priv.status);
pass('the support email is readable (Email Address Obfuscation off)', /href="mailto:[^"]+"/.test(priv.text) && !/__cf_email__|data-cfemail/.test(priv.text), /data-cfemail/.test(priv.text) ? 'Cloudflare rewrote the address; its decoder script is blocked by the CSP, so visitors see [email protected]' : 'mailto link intact');
const fontsCss = await get('/fonts/fonts.css');
pass('fonts are served from this site', fontsCss.status === 200 && /text\/css/.test(h(fontsCss, 'content-type')), fontsCss.status + ' ' + h(fontsCss, 'content-type'));
const woffName = (fontsCss.text.match(/url\(([^)]+\.woff2)\)/) || [])[1];
if (woffName) {
  const woff = await get('/fonts/' + woffName);
  pass('a font file is served with the right type', woff.status === 200 && /font\/woff2/.test(h(woff, 'content-type')), woff.status + ' ' + h(woff, 'content-type'));
}
const asset = (home.text.match(/href="(\/?styles\.css\?v=[^"]+)"/) || [])[1];
if (asset) {
  const css = await get('/' + asset.replace(/^\//, ''));
  pass('versioned assets are cacheable for a year (immutable)', css.status === 200 && /immutable/.test(h(css, 'cache-control')), h(css, 'cache-control'));
}
const brand = await get('/api/brand/' + SEND_TOKEN + '/logo');
warn('token artwork comes through the origin (the brand proxy reaches the CDN)', brand.status === 200 && /^image\//.test(h(brand, 'content-type')), brand.status + ' ' + h(brand, 'content-type'));

/* ---- 7. the data the pages need can be read from the origin ---- */
const pairs = await get('/api/chain/pairs');
warn('live $SEND / $GWC market data (Dexscreener reachable from the origin)', pairs.status === 200 && /pairAddress/.test(pairs.text), pairs.status + ' ' + pairs.text.slice(0, 80));
const look = await get('/api/pairs/lookup?token=' + SEND_TOKEN);
let lj = null; try { lj = JSON.parse(look.text); } catch {}
const holders = lj && lj.pair && lj.pair.holders && lj.pair.holders.count;
warn('holder counts and contract flags are readable (GoPlus / explorer reachable from the origin)', holders != null, holders != null ? holders + ' holders' : look.status + ' — holder data unknown: check BLOCKSCOUT_URL / GOPLUS_KEY and the outbound log');

/* ---- 8. uploads and unknown paths are answered by the origin, not a proxy error page ---- */
const missingUpload = await get('/uploads/000000000000000000000000.jpg');
pass('a missing upload is a 404 from the site, not a proxy error', missingUpload.status === 404 && /didn’t send|not found/i.test(missingUpload.text), missingUpload.status);
const nf = await get('/no-such-page-' + Date.now());
pass('an unknown page is the site’s own 404', nf.status === 404 && /text\/html/.test(h(nf, 'content-type')), nf.status);

print();
process.exit(fails ? 1 : 0);

function print() {
  const width = Math.max(...rows.map(([, n]) => n.length));
  for (const [level, name, extra] of rows) console.log(level.padEnd(5) + name.padEnd(width + 2) + (extra ? '  [' + String(extra).replace(/\s+/g, ' ').slice(0, 160) + ']' : ''));
  const counts = ['PASS', 'WARN', 'FAIL', 'SKIP'].map((l) => l + ' ' + rows.filter((r) => r[0] === l).length).join(' · ');
  console.log('\n' + (fails ? '✗ ' : '✓ ') + ORIGIN + ' — ' + counts + (fails ? '\n  fix every FAIL before sharing a code' : ''));
}
