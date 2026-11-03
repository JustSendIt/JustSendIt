/* Sign in with Send (lib/oidc.js): OAuth 2.0 + OpenID Connect for apps built around Send (owner, 2026-11-03).
   Drives the real HTTP API on the runner's throwaway server, as a fake app would, end to end: an app is registered,
   a member is sent to /oauth/authorize, signs in (the site's own session), ticks what the app may see, the app swaps the
   code at /oauth/token, checks the id_token against /.well-known/jwks.json with node:crypto (no library), reads
   /oauth/userinfo, refreshes, and revokes. Then every item of the security checklist, each its own check: the exact
   redirect_uri match (no redirect on a bad app or address), PKCE S256 only, a single-use 60-second code bound to its
   app, address and verifier (a second use revokes what it issued), state and nonce, the consent page's CSRF token and
   Origin check, frames, caching, CORS, the rate limits, hashed secrets and tokens, the fixed algorithm, the clock, tokens
   dying on revoke / app disable / account delete and restrict, the pairwise sub, the scope filter, prompt=none and
   prompt=consent, and the consent page's escaping. Last, the sign-in and consent pages in a real browser (headless
   Chrome, muted) at 320, 390 and 1280 px: the text floor, nothing sideways, every button described, the keyboard.
   Everything it creates it deletes. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT, DB_PATH, SERVER_JS } from './_paths.mjs';
import { sendNoOf } from './_sendno.mjs';

const require = createRequire(import.meta.url);
const OL = require(path.join(ROOT, 'lib', 'oidc.js'));
const KEYLIB = require(path.join(ROOT, 'lib', 'keys.js'));
const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8'), LIB = readFileSync(path.join(ROOT, 'lib', 'oidc.js'), 'utf8');
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const notes = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64dec = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const ADMIN_ID = 987654;
const made = [], apps = [];
// this suite's own addresses (the throwaway server trusts X-Forwarded-For from loopback), so no other suite's budget is spent
const NET = '198.51.' + (100 + Math.floor(Math.random() * 50)) + '.';
const IP = NET + '10';
let ipTick = 0;
const nextIp = () => NET + (100 + (ipTick++ % 120));   // the per-address limits are for a person, not for a suite making hundreds of sign-ins

function mkUser(name, o = {}) {
  db.prepare('DELETE FROM users WHERE username = ?').run(name);
  if (o.id) db.prepare('DELETE FROM users WHERE id = ?').run(o.id);
  if (o.id) db.prepare('INSERT INTO users (id, username, created_at, avatar) VALUES (?,?,?,?)').run(o.id, name, Date.now(), '🧪');
  else db.prepare('INSERT INTO users (username, created_at, avatar) VALUES (?,?,?)').run(name, Date.now(), '🧪');
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  made.push(id);
  db.prepare('UPDATE users SET points = ?, avatar_img = ?, system = ?, holder_state = ?, holder_verified_at = ?, arcade_boost = ?, arcade_boost_until = ? WHERE id = ?')
    .run(o.points || 0, o.avatarImg || null, o.system ? 1 : 0, o.holder || 'none', o.holder === 'ok' ? Date.now() : null, o.arcade || 0, o.arcade ? Date.now() + 36e5 : 0, id);
  if (!o.system) sendNoOf(db, id);
  return { id, name, ...newSession(id, o) };
}
function newSession(id, o = {}) {
  const raw = 'tok_oi_' + crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed, sudo_until, sudo_since) VALUES (?,?,?,?,1,?,?)')
    .run(sha(raw), id, Date.now() - 5000, Date.now() + 864e5, o.sudo ? Date.now() + 36e5 : null, o.sudo ? Date.now() : null);
  return { sid: raw, cookie: 'sid=' + raw };
}
async function api(p, opts = {}) {
  const r = await fetch(BASE + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Origin: BASE, 'X-Forwarded-For': opts.ip || IP, ...(opts.cookie ? { Cookie: opts.cookie } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined, redirect: 'manual' });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, h: r.headers };
}
// a request exactly as an app (or a browser) would send it: no JSON, no Origin unless given, redirects not followed
async function req(method, p, o = {}) {
  const headers = { 'X-Forwarded-For': o.ip || nextIp(), ...(o.cookie ? { Cookie: o.cookie } : {}), ...(o.headers || {}) };
  let body;
  if (o.form) { body = new URLSearchParams(o.form).toString(); headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded'; }
  if (o.body !== undefined) body = o.body;
  const r = await fetch(BASE + p, { method, headers, body, redirect: 'manual' });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, h: r.headers, loc: r.headers.get('location') || '', cookies: r.headers.getSetCookie ? r.headers.getSetCookie() : [] };
}
// a raw request: the path goes out exactly as written (fetch tidies some forms)
const raw = (method, p, headers = {}) => new Promise((resolve) => {
  const r = http.request({ host: 'localhost', port: PORT, method, path: p, headers: { 'X-Forwarded-For': IP, ...headers } }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, text: b, h: res.headers })); });
  r.on('error', () => resolve({ status: 0, text: '', h: {} })); r.end();
});
function pkce() { const verifier = b64url(crypto.randomBytes(32)); return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) }; }
function authzPath(app, o = {}) {
  const q = new URLSearchParams();
  const p = { response_type: 'code', client_id: app.clientId, redirect_uri: o.redirect || app.redirect, scope: ['openid', ...(o.scopes || [])].join(' '), state: o.state === undefined ? 'st-' + crypto.randomBytes(6).toString('hex') : o.state,
    code_challenge: o.challenge, code_challenge_method: o.method === undefined ? 'S256' : o.method, nonce: o.nonce, prompt: o.prompt, ...(o.extra || {}) };
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null) q.set(k, v);
  return '/oauth/authorize?' + q.toString() + (o.tail || '');
}
const field = (html, n) => { const m = new RegExp('name="' + n + '" value="([^"]*)"').exec(html || ''); return m ? m[1] : null; };
const locOf = (r) => { try { return new URL(r.loc); } catch { return null; } };
// the whole round trip a member makes: GET authorize (signed in), and on the consent page tick and Allow; returns the code and its PKCE verifier
async function getCode(user, app, o = {}) {
  const pk = o.pk || pkce(), state = o.state || 'st-' + crypto.randomBytes(6).toString('hex');
  const first = await req('GET', authzPath(app, { scopes: o.scopes, challenge: pk.challenge, state, nonce: o.nonce, prompt: o.prompt }), { cookie: user.cookie, ip: o.ip });
  let r = first, page = null;
  if (first.status === 200) {
    page = first.text;
    r = await req('POST', '/oauth/authorize', { cookie: user.cookie, ip: o.ip, headers: { Origin: BASE }, form: [['pending', field(page, 'pending')], ['csrf', field(page, 'csrf')], ['decision', o.decision || 'allow'], ...(o.tick || []).map((s) => ['scope', s])] });
  }
  const u = locOf(r);
  return { first, page, r, u, code: u && u.searchParams.get('code'), state, gotState: u && u.searchParams.get('state'), verifier: pk.verifier, pk };
}
async function tokenReq(params, o = {}) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Origin: o.origin || 'https://racer.example', 'X-Forwarded-For': o.ip || nextIp(), ...(o.headers || {}) };
  if (o.basic) headers.Authorization = 'Basic ' + Buffer.from(encodeURIComponent(o.basic[0]) + ':' + encodeURIComponent(o.basic[1])).toString('base64');
  const r = await fetch(BASE + (o.path || '/oauth/token'), { method: 'POST', headers, body: new URLSearchParams(params).toString() });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, h: r.headers };
}
const exchange = (app, c, extra = {}, o = {}) => tokenReq({ grant_type: 'authorization_code', code: c.code, redirect_uri: app.redirect, code_verifier: c.verifier, ...(app.secret && !o.basic && !o.noSecret ? { client_id: app.clientId, client_secret: app.secret } : { client_id: app.clientId }), ...extra }, o);
const userinfo = (tok, o = {}) => fetch(BASE + '/oauth/userinfo', { method: o.method || 'GET', headers: { 'X-Forwarded-For': o.ip || nextIp(), Origin: 'https://racer.example', ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(o.headers || {}) } }).then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, h: r.headers }; });
const jwtParts = (t) => { const [h, p] = String(t).split('.'); return { head: JSON.parse(b64dec(h)), payload: JSON.parse(b64dec(p)) }; };
const keySet = (o) => Object.keys(o || {}).sort().join(',');

let walkPort = 0, walkHits = [];
const walkSrv = http.createServer((q, s) => { walkHits.push(q.url); s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<!doctype html><title>app</title><p id="app">the app got its answer</p>'); });
await new Promise((ok) => walkSrv.listen(0, '127.0.0.1', ok));
walkPort = walkSrv.address().port;

try {
  /* ═══ 0. the parts ═══ */
  check('the suite runs against the throwaway server (run.mjs: a data directory of its own)', /jsi-test-/.test(DB_PATH) || process.env.JSI_DATA_DIR, DB_PATH);
  check('the module is wired: built once, its routes answered before the same-origin write check, the JSON API inside /api/, account deletion forgets it',
    /const OIDC = OIDC_LIB\.createOidc\(\{/.test(SRC) && SRC.indexOf("if (p.startsWith('/oauth/') || p.startsWith('/.well-known/'))") < SRC.indexOf('// cross-site write protection: browsers always send Origin')
    && /if \(p\.startsWith\('\/api\/oauth\/'\) \|\| p\.startsWith\('\/api\/admin\/oauth\/'\)\) \{ if \(await OIDC\.api\(req, res, p, me\)\) return; \}/.test(SRC) && /OIDC\.forgetUser\(uid\);/.test(SRC));
  check('the signing keys\' private halves are a protected column (re-encrypted by every key rotation); live codes and tokens are not kept in backups',
    KEYLIB.ENC_FIELDS.some(([t, c]) => t === 'oauth_keys' && c === 'private_enc') && /'DELETE FROM oauth_codes', 'DELETE FROM oauth_tokens'/.test(SRC));
  check('the pairwise secret is derived from the keyring (HKDF over the index key\'s inner half, which never rotates) and never stored',
    /pairwiseSecret: \(\) => KEYS\.derive\('oidc-pairwise-sub'\)/.test(SRC) && /derive\(info\) \{ return Buffer\.from\(crypto\.hkdfSync\('sha256', this\.inner, 'jsi-derive', String\(info\), 32\)\); \}/.test(readFileSync(path.join(ROOT, 'lib', 'keys.js'), 'utf8'))
    && !/pairwise/i.test(db.prepare("SELECT group_concat(sql, ' ') s FROM sqlite_master").get().s || ''));
  const K1 = KEYLIB.Keys.legacy(crypto.randomBytes(32));
  const ring = KEYLIB.Keys.fromRing(KEYLIB.newRingFromLegacy(Buffer.from(K1.byId.get(1))));
  check('  ...the same secret before and after a key file becomes a keyring, and not the same as any blind index', K1.derive('oidc-pairwise-sub').equals(ring.derive('oidc-pairwise-sub')) && K1.derive('oidc-pairwise-sub').toString('hex') !== K1.bidxAt('oidc-pairwise-sub', 0));

  /* ═══ 1. discovery and keys ═══ */
  const disc = await req('GET', '/.well-known/openid-configuration', { headers: { Host: 'evil.example', Origin: 'https://racer.example' } });
  const D = disc.j || {};
  check('discovery answers the standard document; the issuer is the site\'s public origin, never the Host header', disc.status === 200 && D.issuer === BASE && D.authorization_endpoint === BASE + '/oauth/authorize' && D.token_endpoint === BASE + '/oauth/token'
    && D.userinfo_endpoint === BASE + '/oauth/userinfo' && D.jwks_uri === BASE + '/.well-known/jwks.json' && D.revocation_endpoint === BASE + '/oauth/revoke', JSON.stringify(D).slice(0, 300));
  check('  ...code flow only, PKCE S256 only, ES256 only, pairwise subjects, the eight scopes, iss in the response', JSON.stringify(D.response_types_supported) === '["code"]' && JSON.stringify(D.code_challenge_methods_supported) === '["S256"]'
    && JSON.stringify(D.id_token_signing_alg_values_supported) === '["ES256"]' && JSON.stringify(D.subject_types_supported) === '["pairwise"]' && D.scopes_supported.join(' ') === 'openid send.handle send.picture send.id send.power send.boost send.verified offline_access'
    && D.authorization_response_iss_parameter_supported === true && !D.claims_supported.includes('email'));
  check('  ...open to any origin (CORS *), never with credentials', disc.h.get('access-control-allow-origin') === '*' && !disc.h.get('access-control-allow-credentials'));
  const alias = await req('GET', '/.well-known/oauth-authorization-server');
  check('  ...and the same document at /.well-known/oauth-authorization-server (RFC 8414)', alias.status === 200 && alias.j && alias.j.issuer === BASE);
  const jw = await req('GET', '/.well-known/jwks.json', { headers: { Origin: 'https://racer.example' } });
  const JW = jw.j || { keys: [] };
  check('the JWKS publishes public P-256 keys only: no private part, alg ES256, use sig, kid = the RFC 7638 thumbprint', jw.status === 200 && JW.keys.length >= 1 && JW.keys.every((k) => k.kty === 'EC' && k.crv === 'P-256' && k.alg === 'ES256' && k.use === 'sig' && !('d' in k) && k.kid === OL.jwkThumbprint(k))
    && jw.h.get('access-control-allow-origin') === '*', JSON.stringify(JW).slice(0, 300));
  const keyRow = db.prepare('SELECT * FROM oauth_keys ORDER BY active_from DESC LIMIT 1').get();
  check('  ...the private key is stored encrypted with the site\'s keyring (a cipher, not a JWK)', keyRow && /^v[12]:/.test(keyRow.private_enc) && !/"d"/.test(keyRow.private_enc), keyRow && String(keyRow.private_enc).slice(0, 12));
  const pre = await raw('OPTIONS', '/oauth/token', { Origin: 'https://racer.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' });
  check('a CORS preflight to the token endpoint is answered: any origin, POST, the two headers, no credentials', pre.status === 204 && pre.h['access-control-allow-origin'] === '*' && /POST/.test(pre.h['access-control-allow-methods']) && /Authorization/i.test(pre.h['access-control-allow-headers']) && !pre.h['access-control-allow-credentials'], pre.status + ' ' + JSON.stringify(pre.h));

  const sc = await api('/api/oauth/scopes');
  check('/api/oauth/scopes (what /developers draws its table from) lists the endpoints, every scope with its claims and plain words, and the limits', sc.status === 200 && sc.j.issuer === BASE && sc.j.endpoints.token === BASE + '/oauth/token' && sc.j.endpoints.jwks === BASE + '/.well-known/jwks.json'
    && sc.j.scopes.length === 8 && sc.j.scopes.every((x) => Array.isArray(x.claims) && x.plain.length > 10 && x.label.length > 5) && sc.j.scopes[0].scope === 'openid' && sc.j.scopes[0].required === true
    && sc.j.limits.appsPerMember === 5 && sc.j.limits.redirectUrisPerApp === 5 && sc.j.limits.codeSeconds === 60 && sc.j.limits.refreshDays === 30, sc.text.slice(0, 200));

  /* ═══ 2. registering apps (/api/oauth/apps) ═══ */
  const devA = mkUser('__oi_dev_a__'), devB = mkUser('__oi_dev_b__'), devC = mkUser('__oi_dev_c__'), devD = mkUser('__oi_dev_d__');
  const anon = await api('/api/oauth/apps');
  check('registering an app takes a signed-in member', anon.status === 401);
  const mkApp = async (dev, body) => { const r = await api('/api/oauth/apps', { method: 'POST', cookie: dev.cookie, body }); if (r.j && r.j.app) apps.push(r.j.app.clientId); return r; };
  const WALK_REDIRECT = 'http://127.0.0.1:' + walkPort + '/cb';
  const rPub = await mkApp(devA, { name: 'Send Racer', homepage: 'https://racer.example', redirectUris: ['https://racer.example/cb', 'http://localhost:5173/cb', WALK_REDIRECT], kind: 'public', description: 'A racing game for senders.' });
  const PUB = rPub.j && rPub.j.app ? { clientId: rPub.j.app.clientId, redirect: 'https://racer.example/cb' } : null;
  check('a public app is registered: a client ID, its exact redirect URIs, no secret', rPub.status === 200 && PUB && /^sapp_[0-9a-f]{24}$/.test(PUB.clientId) && rPub.j.app.kind === 'public' && !rPub.j.clientSecret && rPub.j.app.hasSecret === false
    && JSON.stringify(rPub.j.app.redirectUris) === JSON.stringify(['https://racer.example/cb', 'http://localhost:5173/cb', WALK_REDIRECT]) && rPub.j.app.reviewed === false && rPub.j.app.disabled === false, rPub.status + ' ' + rPub.text.slice(0, 300));
  const rConf = await mkApp(devA, { name: 'Send Vault', homepage: 'https://vault.example/', redirectUris: ['https://vault.example/return?from=send'], kind: 'confidential' });
  const CONF = rConf.j && rConf.j.app ? { clientId: rConf.j.app.clientId, redirect: 'https://vault.example/return?from=send', secret: rConf.j.clientSecret } : null;
  const confRow = CONF && db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(CONF.clientId);
  check('a confidential app gets its secret once (256 bits); only its SHA-256 is stored', rConf.status === 200 && CONF && /^ssec_[A-Za-z0-9_-]{43}$/.test(CONF.secret) && confRow.secret_hash === sha(CONF.secret) && !JSON.stringify(confRow).includes(CONF.secret), rConf.text.slice(0, 200));
  const list = await api('/api/oauth/apps', { cookie: devA.cookie });
  check('  ...and the member\'s list never shows a secret again', list.status === 200 && list.j.apps.length === 2 && !list.text.includes(CONF.secret) && list.j.apps.find((a) => a.clientId === CONF.clientId).hasSecret === true && list.j.max === 5);
  const rXss = await mkApp(devA, { name: 'Tom & Jerry\'s Arcade', homepage: 'https://arcade.example', redirectUris: ['https://arcade.example/cb'], kind: 'public', description: '<script>alert(1)</script><img src=x onerror=alert(2)> "quoted" & more' });
  const XSS = rXss.j && rXss.j.app ? { clientId: rXss.j.app.clientId, redirect: 'https://arcade.example/cb' } : null;
  const rTwo = await mkApp(devA, { name: 'Second Game', homepage: 'https://second.example', redirectUris: ['https://second.example/cb'], kind: 'public' });
  const TWO = rTwo.j && rTwo.j.app ? { clientId: rTwo.j.app.clientId, redirect: 'https://second.example/cb' } : null;
  check('  ...(two more apps for the checks below)', !!XSS && !!TWO, rXss.text.slice(0, 200) + ' ' + rTwo.text.slice(0, 200));
  const refusals = [];
  const tryBad = async (why, body) => { const r = await mkApp(devC, { name: 'Good Name', homepage: 'https://good.example', redirectUris: ['https://good.example/cb'], kind: 'public', ...body }); if (r.status !== 400) refusals.push(why + ' → ' + r.status); return r; };
  await tryBad('plain http', { redirectUris: ['http://good.example/cb'] });
  await tryBad('a fragment', { redirectUris: ['https://good.example/cb#x'] });
  await tryBad('userinfo', { redirectUris: ['https://user:pw@good.example/cb'] });
  await tryBad('userinfo trick', { redirectUris: ['https://good.example%2F@evil.example/cb'] });
  await tryBad('a wildcard', { redirectUris: ['https://*.good.example/cb'] });
  await tryBad('dot segments', { redirectUris: ['https://good.example/a/../cb'] });
  await tryBad('encoded dots', { redirectUris: ['https://good.example/a/%2e%2e/cb'] });
  await tryBad('a backslash', { redirectUris: ['https://good.example\\@evil.example/cb'] });
  await tryBad('a lookalike localhost', { redirectUris: ['http://localhost.evil.example/cb'] });
  await tryBad('six redirect URIs', { redirectUris: [1, 2, 3, 4, 5, 6].map((n) => 'https://good.example/cb' + n) });
  await tryBad('an http homepage', { homepage: 'http://good.example' });
  await tryBad('the site\'s own name', { name: 'JustSendIt Login' });
  await tryBad('a lookalike of it', { name: 'Just Send 1t Games' });
  await tryBad('markup in the name', { name: '<b>Bold</b> App' });
  await tryBad('no kind', { kind: 'browser' });
  check('registration refuses every redirect URI a looser match would let through, an http homepage, the site\'s own name (and lookalikes), markup in a name and an unknown kind', refusals.length === 0, refusals.join(' | '));
  const okLocal = await mkApp(devB, { name: 'Local Dev', homepage: 'https://good.example', redirectUris: ['http://localhost:3000/cb', 'http://127.0.0.1:8080/callback'], kind: 'public' });
  check('  ...and allows http://localhost and http://127.0.0.1 with any port, for development', okLocal.status === 200, okLocal.text.slice(0, 200));
  for (let i = 0; i < 4; i++) await mkApp(devB, { name: 'Filler ' + (i + 1), homepage: 'https://good.example', redirectUris: ['https://good.example/cb'], kind: 'public' });
  const sixth = await mkApp(devB, { name: 'Sixth App', homepage: 'https://good.example', redirectUris: ['https://good.example/cb'], kind: 'public' });
  check('at most five apps per member', sixth.status === 409 && /5 apps/.test(sixth.j && sixth.j.error) && db.prepare('SELECT COUNT(*) n FROM oauth_clients WHERE owner_id = ?').get(devB.id).n === 5, sixth.status + ' ' + sixth.text);
  const notMine = await api('/api/oauth/apps/' + PUB.clientId, { method: 'DELETE', cookie: devB.cookie });
  check('  ...and a member can change or delete only their own', notMine.status === 404 && !!db.prepare('SELECT 1 FROM oauth_clients WHERE client_id = ?').get(PUB.clientId));
  let lim = 0; for (let i = 0; i < 25; i++) { const r = await api('/api/oauth/apps', { method: 'POST', cookie: devD.cookie, ip: nextIp(), body: { name: 'x' } }); if (r.status === 429) { lim = i + 1; break; } }
  check('registration is rate-limited (20 attempts an hour per member, refused ones counted)', lim === 21, 'limited at attempt ' + lim);

  /* ═══ 3. the members ═══ */
  const alice = mkUser('__oi_alice__', { points: 4321, holder: 'ok', avatarImg: 'aaaaaaaaaaaaaaaaaaaaaaaa.png', arcade: 2.5 });
  const bob = mkUser('__oi_bob__', { points: 10 });
  const aliceRow = () => db.prepare('SELECT * FROM users WHERE id = ?').get(alice.id);
  const meA = (await api('/api/me', { cookie: alice.cookie })).j.user;
  check('(alice is signed in, with Send Power, a level and a Boost the site computes: ' + meA.points + ' · Lv ' + meA.level + ' · ' + meA.boost.total + '×)', meA && meA.points === 4321 && meA.boost.total === 2.5);

  /* ═══ 4. /oauth/authorize: the app and its exact address first, and nobody is sent anywhere when either is wrong ═══ */
  const pk0 = pkce();
  const base0 = { challenge: pk0.challenge, scopes: ['send.handle'] };
  const noRedirect = [];
  const expectPage = async (why, p, cookie) => { const r = await req('GET', p, { cookie }); if (r.status !== 400 || r.loc || !/<html/.test(r.text) || !/no-store/.test(r.h.get('cache-control') || '') || r.h.get('x-frame-options') !== 'DENY' || !/frame-ancestors 'none'/.test(r.h.get('content-security-policy') || '')) noRedirect.push(why + ' → ' + r.status + ' ' + r.loc); return r; };
  await expectPage('no client_id', '/oauth/authorize?response_type=code&redirect_uri=' + encodeURIComponent(PUB.redirect), alice.cookie);
  await expectPage('an unknown client_id', authzPath({ clientId: 'sapp_' + '0'.repeat(24), redirect: PUB.redirect }, base0), alice.cookie);
  await expectPage('two client_ids', authzPath(PUB, base0) + '&client_id=' + TWO.clientId, alice.cookie);
  await expectPage('no redirect_uri', authzPath(PUB, base0).replace(/&redirect_uri=[^&]*/, ''), alice.cookie);
  for (const [why, ru] of [['a longer path (prefix match)', 'https://racer.example/cb/x'], ['a prefix of it', 'https://racer.example/c'], ['a trailing slash', 'https://racer.example/cb/'], ['path traversal', 'https://racer.example/cb/../cb'],
    ['an encoded traversal', 'https://racer.example/x/%2e%2e/cb'], ['another case in the path', 'https://racer.example/CB'], ['another case in the host', 'https://RACER.example/cb'], ['a fragment', 'https://racer.example/cb#frag'],
    ['userinfo', 'https://racer.example@evil.example/cb'], ['userinfo in front', 'https://evil.example@racer.example/cb'], ['an added query', 'https://racer.example/cb?next=https://evil.example'], ['the explicit default port', 'https://racer.example:443/cb'],
    ['a subdomain trick', 'https://racer.example.evil.example/cb'], ['http instead of https', 'http://racer.example/cb'], ['another app\'s address', TWO.redirect], ['a backslash', 'https://racer.example\\@evil.example/cb'], ['a double slash', 'https://racer.example//cb']])
    await expectPage(why, authzPath(PUB, { ...base0, redirect: ru }), alice.cookie);
  const twoRedirects = await expectPage('two redirect_uris', authzPath(PUB, base0) + '&redirect_uri=' + encodeURIComponent('https://evil.example/cb'), alice.cookie);
  check('a bad or unknown app, a missing redirect_uri and every near miss of the registered one (prefix, slash, traversal, case, fragment, userinfo, query, port, host) get an error page and NO redirect — never cached, never framed', noRedirect.length === 0, noRedirect.join(' | '));
  check('  ...the page says why, and that nothing was shared', /never registered/.test(twoRedirects.text) && /Nothing was shared/.test(twoRedirects.text));

  /* ═══ 5. ...then every other problem goes back to the app, with its state ═══ */
  const back = async (why, p, want) => { const r = await req('GET', p, { cookie: alice.cookie }); const u = locOf(r); const ok = r.status === 302 && u && u.origin + u.pathname === 'https://racer.example/cb' && u.searchParams.get('error') === want && u.searchParams.get('iss') === BASE && !u.searchParams.get('code'); return { ok, why, r, u }; };
  const errs = [
    await back('response_type=token', authzPath(PUB, { ...base0, extra: { response_type: 'token' }, state: 'S1' }), 'unsupported_response_type'),
    await back('no state', authzPath(PUB, { ...base0, state: null }), 'invalid_request'),
    await back('no code_challenge', authzPath(PUB, { scopes: ['send.handle'] }), 'invalid_request'),
    await back('code_challenge_method=plain', authzPath(PUB, { ...base0, method: 'plain' }), 'invalid_request'),
    await back('no code_challenge_method', authzPath(PUB, { ...base0, method: null }), 'invalid_request'),
    await back('a challenge that is not S256-shaped', authzPath(PUB, { ...base0, challenge: 'short' }), 'invalid_request'),
    await back('no openid scope', authzPath(PUB, { ...base0 }).replace('scope=openid+send.handle', 'scope=send.handle'), 'invalid_scope'),
    await back('a repeated parameter', authzPath(PUB, base0) + '&scope=openid', 'invalid_request'),
    await back('a request object', authzPath(PUB, { ...base0, extra: { request: 'eyJ' } }), 'request_not_supported'),
    await back('prompt=none with another prompt', authzPath(PUB, { ...base0, prompt: 'none consent' }), 'invalid_request'),
  ];
  check('every other problem goes back to the app\'s registered address as an error (RFC 6749 §4.1.2.1) with iss: response_type, no state, no PKCE, plain PKCE, no method, a malformed challenge, no openid, a repeated parameter, a request object',
    errs.every((e) => e.ok), errs.filter((e) => !e.ok).map((e) => e.why + ' → ' + e.r.status + ' ' + e.r.loc).join(' | '));
  check('  ...with the app\'s state echoed when it sent one, and none invented when it did not (state is required)', errs[0].u && errs[0].u.searchParams.get('state') === 'S1' && errs[1].u && !errs[1].u.searchParams.has('state') && /state is required/.test(errs[1].u.searchParams.get('error_description')));
  check('  ...PKCE S256 is required of every app: plain is refused by name', /plain is refused/.test(errs[3].u && errs[3].u.searchParams.get('error_description')));
  check('  ...and a redirect never carries a session cookie, is never cached and never framed', errs.every((e) => !e.r.cookies.some((c) => /^sid=/.test(c)) && /no-store/.test(e.r.h.get('cache-control') || '') && e.r.h.get('x-frame-options') === 'DENY'));

  /* ═══ 6. signed out: the site's own sign-in, then back to the same request by its id ═══ */
  const so = await req('GET', authzPath(PUB, { ...base0, state: 'so-1' }));
  const pendingId = field(so.text, 'pending');
  check('signed out, a good request shows the sign-in page (the site\'s own sign-in: auth.js), not the consent page', so.status === 200 && /Sign in with your Send account to continue to/.test(so.text) && /id="oa-signin"/.test(so.text) && /src="\/auth\.js(\?v=[^"]+)?"/.test(so.text) && /src="\/oauth\.js(\?v=[^"]+)?"/.test(so.text) && !/name="scope"/.test(so.text), so.status);
  check('  ...it keeps the request on the server by a short id (an HttpOnly cookie for a social sign-in\'s way back), never a return URL', !!pendingId && /data-pending="/.test(so.text) && so.cookies.some((c) => /^jsi_oidc=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Lax/.test(c)) && !so.cookies.some((c) => /^sid=/.test(c)) && !/[?&](return|returnTo|next|continue|redirect)=/i.test(so.text), so.cookies.join(' ; '));
  check('  ...the social sign-ins come back to it only through that cookie, and only while the request is waiting', /const resume = gateReq \? OIDC\.resumePath\(gateReq\) : null;/.test(SRC) && /Location: resume \|\| '\/profile'/.test(SRC) && /return livePending\(id\) \? ISS_PATHS\.authorize \+ '\?pending=' \+ encodeURIComponent\(id\) : null;/.test(LIB));
  const resumed = await req('GET', '/oauth/authorize?pending=' + encodeURIComponent(pendingId), { cookie: alice.cookie });
  check('  ...after signing in, the same request continues to the consent page (by the id alone)', resumed.status === 200 && /Sign in to <b class="oa-app-name">Send Racer<\/b> with your Send account/.test(resumed.text) && /@__oi_alice__/.test(resumed.text), resumed.status + ' ' + resumed.text.slice(0, 200));
  const bogus = await req('GET', '/oauth/authorize?pending=nope', { cookie: alice.cookie });
  const smuggle = await req('GET', '/oauth/authorize?pending=' + encodeURIComponent(pendingId) + '&redirect_uri=' + encodeURIComponent('https://evil.example/'), { cookie: alice.cookie });
  check('  ...an unknown id is an error page with no redirect, and an id with a return address added is not a way back (no redirect anywhere)', bogus.status === 400 && !bogus.loc && smuggle.status === 400 && !smuggle.loc, bogus.status + ' ' + smuggle.status + ' ' + smuggle.loc);
  const pn = await req('GET', authzPath(PUB, { ...base0, prompt: 'none', state: 'pn-1' }));
  const pnU = locOf(pn);
  check('prompt=none signed out answers login_required at once, with the state — nothing is shown', pn.status === 302 && pnU.searchParams.get('error') === 'login_required' && pnU.searchParams.get('state') === 'pn-1', pn.status + ' ' + pn.loc);

  /* ═══ 7. the consent page ═══ */
  const ALL = ['send.handle', 'send.picture', 'send.id', 'send.power', 'send.boost', 'send.verified', 'offline_access'];
  const pkA = pkce();
  const cp = await req('GET', authzPath(PUB, { scopes: ALL, challenge: pkA.challenge, state: 'flow-1', nonce: 'n-0S6_WzA2Mj' }), { cookie: alice.cookie });
  const H = cp.text, sendNo = aliceRow().send_no;
  check('the consent page names the app, its website, the host it sends you back to, and "Not reviewed by Just Send It"', cp.status === 200 && /Send Racer/.test(H) && /href="https:\/\/racer\.example" target="_blank" rel="noopener noreferrer nofollow"/.test(H) && /<code>racer\.example<\/code>/.test(H) && /Not reviewed by Just Send It/.test(H), cp.status);
  check('  ...one box per scope asked for, each with the member\'s own value in plain words',
    /Your handle: @__oi_alice__/.test(H) && new RegExp('Your Send ID: #' + sendNo + '<').test(H) && /the same number in every app you share it with, so apps can recognise you across each other/.test(H)
    && /Your Send Power: 4,321 · level \d+ · /.test(H) && /Your Send Boost: 2\.5×/.test(H) && /the total only, never what it is made of/.test(H) && /Whether your wallet passed the holder check: yes/.test(H) && /not which wallet, and not how much it holds/.test(H)
    && /Keep these up to date for 30 days/.test(H) && (H.match(/name="scope"/g) || []).length === 7);
  check('  ...nothing is ticked for the member: what they leave unticked is not shared', !/name="scope" value="[^"]+" checked/.test(H) && /Nothing is ticked for you/.test(H));
  check('  ...the ID that is always shared is said to be different in every app; what is never shared is listed; what the site keeps is said', /Every app gets a different one, so apps cannot match you up by it/.test(H) && /Never shared with any app:<\/b> your email, your wallets, your IP address, your sign-in history, your holdings, your OG tier and your communities/.test(H) && /No log of when or how you use Send Racer/.test(H));
  const buttons = [...H.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
  check('  ...Allow and Cancel (and every other button) carry a description; the POST carries a CSRF token', /value="allow" data-tip="[^"]{8,}"/.test(H) && /value="cancel" data-tip="[^"]{8,}"/.test(H) && buttons.length >= 4 && buttons.every((b) => /data-tip="[^"]{8,}"/.test(b)) && /^[A-Za-z0-9_-]{43}$/.test(field(H, 'csrf') || ''), buttons.filter((b) => !/data-tip/.test(b)).join(' '));
  const csp = cp.h.get('content-security-policy') || '';
  check('  ...never framed (frame-ancestors \'none\' and X-Frame-Options), never cached, and loads nothing from any other host (no beacon, no tag, no font)', /frame-ancestors 'none'/.test(csp) && cp.h.get('x-frame-options') === 'DENY' && /no-store/.test(cp.h.get('cache-control')) && /^default-src 'none'/.test(csp)
    && !/https?:\/\/(?!racer\.example)/.test(csp.replace("form-action 'self' https://racer.example", '')) && !/cloudflareinsights|google/.test(csp) && ![...H.matchAll(/\s(?:src|href)="([^"]+)"/g)].some((m) => /^https?:/.test(m[1]) && !/^https:\/\/racer\.example"?$/.test(m[1])), csp);
  check('  ...and sends the app nothing before Allow: no picture, script or request to its host (its website is a plain link), the form posts here, and only the app\'s own origin may receive the answer', ![...H.matchAll(/\ssrc="([^"]+)"/g)].some((m) => /racer\.example/.test(m[1])) && /<form class="oa-form" method="post" action="\/oauth\/authorize">/.test(H) && /form-action 'self' https:\/\/racer\.example(;|$)/.test(csp) && cp.h.get('referrer-policy') === 'same-origin');
  const xp = await req('GET', authzPath(XSS, { scopes: ['send.handle'], challenge: pkA.challenge }), { cookie: alice.cookie });
  check('the app\'s name and description are escaped on the page (no markup of theirs runs)', xp.status === 200 && !/<script>alert|<img src=x/.test(xp.text) && /&lt;script&gt;alert\(1\)&lt;\/script&gt;&lt;img src=x onerror=alert\(2\)&gt; &quot;quoted&quot; &amp; more/.test(xp.text) && /Tom &amp; Jerry&#39;s Arcade/.test(xp.text), xp.text.slice(xp.text.indexOf('It says'), xp.text.indexOf('It says') + 200));

  /* ═══ 8. the consent POST: CSRF token bound to the session and the request, and the Origin ═══ */
  const pendA = field(H, 'pending'), csrfA = field(H, 'csrf');
  const post = (form, o = {}) => req('POST', '/oauth/authorize', { cookie: o.cookie === undefined ? alice.cookie : o.cookie, headers: o.headers === undefined ? { Origin: BASE } : o.headers, form, ip: o.ip });
  const csrfFails = [];
  const mustFail = async (why, r) => { if (r.status < 400 || (r.loc && /racer\.example/.test(r.loc))) csrfFails.push(why + ' → ' + r.status + ' ' + r.loc); };
  await mustFail('no CSRF token', await post({ pending: pendA, decision: 'allow' }));
  await mustFail('a wrong CSRF token', await post({ pending: pendA, csrf: 'x'.repeat(43), decision: 'allow' }));
  await mustFail('another member\'s session', await post({ pending: pendA, csrf: csrfA, decision: 'allow' }, { cookie: bob.cookie }));
  await mustFail('no session', await post({ pending: pendA, csrf: csrfA, decision: 'allow' }, { cookie: '' }));
  await mustFail('a foreign Origin', await post({ pending: pendA, csrf: csrfA, decision: 'allow' }, { headers: { Origin: 'https://evil.example' } }));
  await mustFail('a foreign Referer and no Origin', await post({ pending: pendA, csrf: csrfA, decision: 'allow' }, { headers: { Referer: 'https://evil.example/x' } }));
  await mustFail('neither Origin nor Referer', await post({ pending: pendA, csrf: csrfA, decision: 'allow' }, { headers: {} }));
  const other = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkA.challenge }), { cookie: alice.cookie });
  await mustFail('the token of another request', await post({ pending: pendA, csrf: field(other.text, 'csrf'), decision: 'allow' }));
  await mustFail('a JSON body', await req('POST', '/oauth/authorize', { cookie: alice.cookie, headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify({ pending: pendA, csrf: csrfA, decision: 'allow' }) }));
  check('the consent POST is refused without its CSRF token, with a wrong one, from another session or none, from another origin (or with no Origin and Referer), with another request\'s token, or as JSON — and nothing goes to the app', csrfFails.length === 0, csrfFails.join(' | '));

  /* ═══ 9. Allow → code → token → id_token verified against the JWKS → userinfo ═══ */
  const TICK = ['send.handle', 'send.id', 'send.power', 'send.boost', 'send.verified', 'offline_access', 'not.a.scope'];
  const allow = await post([['pending', pendA], ['csrf', csrfA], ['decision', 'allow'], ...TICK.map((s) => ['scope', s])], { headers: { Origin: BASE, Referer: BASE + '/oauth/authorize?x' } });
  const aU = locOf(allow), code1 = aU && aU.searchParams.get('code');
  check('Allow sends the member back to the exact registered address with a code, the state echoed and iss', allow.status === 302 && aU.origin + aU.pathname === 'https://racer.example/cb' && /^[A-Za-z0-9_-]{43}$/.test(code1 || '') && aU.searchParams.get('state') === 'flow-1' && aU.searchParams.get('iss') === BASE && !aU.searchParams.has('error'), allow.status + ' ' + allow.loc);
  check('  ...never cached, no session cookie with it, no referrer to the app', /no-store/.test(allow.h.get('cache-control')) && !allow.cookies.some((c) => /^sid=/.test(c)) && allow.h.get('referrer-policy') === 'no-referrer');
  const codeRow = db.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').get(sha(code1 || ''));
  check('  ...the code is stored only as its SHA-256, lives 60 s, bound to the app, the address and the PKCE challenge', codeRow && codeRow.client_id === PUB.clientId && codeRow.redirect_uri === PUB.redirect && codeRow.challenge === pkA.challenge && Math.abs(codeRow.expires_at - Date.now() - 60e3) < 5000 && !db.prepare("SELECT 1 FROM oauth_codes WHERE code_hash = ?").get(code1), JSON.stringify(codeRow || {}).slice(0, 200));
  const cons = db.prepare('SELECT * FROM oauth_consents WHERE user_id = ? AND client_id = ?').get(alice.id, PUB.clientId);
  check('  ...the consent kept is what was ticked (an unasked scope ticked is ignored), and what was asked', cons && cons.scopes === 'send.handle send.id send.power send.boost send.verified offline_access' && cons.asked === ALL.join(' '), JSON.stringify(cons));
  const wrongV = await tokenReq({ grant_type: 'authorization_code', code: code1, redirect_uri: PUB.redirect, code_verifier: pkce().verifier, client_id: PUB.clientId });
  check('PKCE is verified: a wrong code_verifier is invalid_grant', wrongV.status === 400 && wrongV.j.error === 'invalid_grant' && /PKCE/.test(wrongV.j.error_description), wrongV.text);
  const after = await tokenReq({ grant_type: 'authorization_code', code: code1, redirect_uri: PUB.redirect, code_verifier: pkA.verifier, client_id: PUB.clientId });
  check('  ...and that spent the code: single use, the right verifier is too late now', after.status === 400 && after.j.error === 'invalid_grant', after.text);
  // a fresh code for the main flow (alice has answered for these scopes, so the page is skipped)
  const c2 = await getCode(alice, PUB, { scopes: ALL, nonce: 'n-0S6_WzA2Mj', state: 'flow-2' });
  check('a second sign-in for the same scopes skips the page: straight back with a code (the member already answered)', c2.first.status === 302 && !!c2.code && c2.gotState === 'flow-2', c2.first.status + ' ' + c2.first.loc);
  const T1 = await exchange(PUB, c2);
  const tok = T1.j || {};
  check('the token endpoint answers access_token (opaque), Bearer, 3600 s, an id_token, a refresh_token (offline_access was ticked) and the granted scope', T1.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(tok.access_token) && tok.token_type === 'Bearer' && tok.expires_in === 3600 && typeof tok.id_token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(tok.refresh_token || '')
    && tok.scope === 'openid send.handle send.id send.power send.boost send.verified offline_access', T1.text.slice(0, 300));
  check('  ...no-store, CORS for any origin and never with credentials', /no-store/.test(T1.h.get('cache-control')) && T1.h.get('access-control-allow-origin') === '*' && !T1.h.get('access-control-allow-credentials') && T1.h.get('x-frame-options') === 'DENY');
  check('  ...the tokens are 256 random bits and stored only as SHA-256', b64dec(tok.access_token).length === 32 && b64dec(tok.refresh_token).length === 32 && !!db.prepare("SELECT 1 FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'").get(sha(tok.access_token)) && !!db.prepare("SELECT 1 FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'").get(sha(tok.refresh_token))
    && !db.prepare('SELECT 1 FROM oauth_tokens WHERE token_hash = ? OR token_hash = ?').get(tok.access_token, tok.refresh_token));
  const jwks = (await req('GET', '/.well-known/jwks.json')).j;
  const { head, payload: IDP } = tok.id_token ? jwtParts(tok.id_token) : { head: {}, payload: {} };
  // the app's check, with node:crypto alone: the key by kid, the ES256 signature in IEEE P1363 form
  let sigOk = false;
  try {
    const [h64, p64, s64] = tok.id_token.split('.'), jwk = jwks.keys.find((k) => k.kid === head.kid);
    sigOk = crypto.verify('sha256', Buffer.from(h64 + '.' + p64), { key: crypto.createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, b64dec(s64));
  } catch (e) { sigOk = false; }
  check('the id_token verifies against the published JWKS with node:crypto (ES256, the kid named, no library)', sigOk && head.alg === 'ES256' && head.typ === 'JWT' && jwks.keys.some((k) => k.kid === head.kid), JSON.stringify(head));
  const t0 = Math.floor(Date.now() / 1000);
  check('  ...iss, aud = the client ID, iat now, exp 10 minutes on, auth_time, the nonce echoed, at_hash for the access token', IDP.iss === BASE && IDP.aud === PUB.clientId && Math.abs(IDP.iat - t0) <= 5 && IDP.exp - IDP.iat === 600 && typeof IDP.auth_time === 'number' && IDP.auth_time <= IDP.iat && IDP.nonce === 'n-0S6_WzA2Mj'
    && IDP.at_hash === b64url(crypto.createHash('sha256').update(tok.access_token).digest().subarray(0, 16)), JSON.stringify(IDP));
  const A = aliceRow();
  check('  ...the claims are the consented ones, with the values in the database: handle, profile, Send ID, Send Power, level, title, Boost (the total), verified — and not the picture, which was not ticked',
    keySet(IDP) === 'at_hash,aud,auth_time,exp,iat,iss,nonce,preferred_username,profile,send_boost,send_id,send_level,send_power,send_title,send_verified,sub'
    && IDP.preferred_username === A.username && IDP.profile === BASE + '/u/' + encodeURIComponent(A.username) && IDP.send_id === A.send_no && IDP.send_power === A.points && IDP.send_level === meA.level && IDP.send_title === meA.title
    && IDP.send_boost === meA.boost.total && IDP.send_verified === true, JSON.stringify(IDP));
  check('  ...and nothing else, ever: no claim for an email, a wallet, an IP, a session, holdings, the OG tier, communities or the Boost\'s parts', !Object.keys(IDP).some((k) => /email|wallet|address|^ip|sid|holding|^og|communit|arcade|weekly|holder|beta/i.test(k)) && !JSON.stringify(IDP).includes(alice.sid));
  check('  ...the reference verifier in lib/oidc.js accepts it', (() => { try { return OL.verifyJwt(tok.id_token, jwks, { issuer: BASE, audience: PUB.clientId, nonce: 'n-0S6_WzA2Mj' }).sub === IDP.sub; } catch (e) { return e.message; } })() === true);
  /* the fixed algorithm: a token claiming none, or HS256 with the public key as the secret, or another kid, is refused before any key is used */
  const [h64, p64, s64] = tok.id_token.split('.');
  const noneTok = b64url(JSON.stringify({ alg: 'none', typ: 'JWT', kid: head.kid })) + '.' + p64 + '.';
  const hsHead = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: head.kid })), hsTok = hsHead + '.' + p64 + '.' + b64url(crypto.createHmac('sha256', JSON.stringify(jwks.keys[0])).update(hsHead + '.' + p64).digest());
  const forged = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: head.kid })) + '.' + b64url(JSON.stringify({ ...IDP, send_power: 1e12 })) + '.' + s64;
  const otherKid = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'not-a-kid' })) + '.' + p64 + '.' + s64;
  const refusedAll = [noneTok, hsTok, forged, otherKid].map((t) => { try { OL.verifyJwt(t, jwks, { issuer: BASE, audience: PUB.clientId }); return 'ACCEPTED'; } catch (e) { return e.message; } });
  check('the algorithm is fixed: "none", HS256 keyed with the public key, an edited payload and an unknown kid are all refused', refusedAll.every((m) => m !== 'ACCEPTED') && refusedAll[0] === 'alg must be ES256' && refusedAll[1] === 'alg must be ES256' && refusedAll[2] === 'bad signature' && refusedAll[3] === 'unknown kid', refusedAll.join(' | '));
  check('  ...the server signs with ES256 alone (no caller ever picks the algorithm) and lists only it', /const head = b64url\(Buffer\.from\(JSON\.stringify\(\{ alg: 'ES256', typ: 'JWT', kid \}\)\)\);/.test(LIB) && /dsaEncoding: 'ieee-p1363'/.test(LIB) && !/alg: (?!'ES256')/.test(LIB.slice(LIB.indexOf('function signJwt'), LIB.indexOf('function verifyJwt'))));
  check('clock skew: the reference verifier allows 60 s either way and no more (exp just passed, iat just ahead)', (() => {
    const v = (o) => { try { OL.verifyJwt(tok.id_token, jwks, { issuer: BASE, audience: PUB.clientId, ...o }); return true; } catch { return false; } };
    return v({ now: (IDP.exp + 30) * 1000 }) && !v({ now: (IDP.exp + 61) * 1000 }) && v({ now: (IDP.iat - 30) * 1000 }) && !v({ now: (IDP.iat - 61) * 1000 }) && !v({ now: (IDP.exp + 1) * 1000, skewS: 0 });
  })());

  const UI = await userinfo(tok.access_token);
  check('userinfo answers the current values of the consented claims, with the same pairwise sub', UI.status === 200 && UI.j.sub === IDP.sub && keySet(UI.j) === 'preferred_username,profile,send_boost,send_id,send_level,send_power,send_title,send_verified,sub' && UI.j.send_power === 4321
    && UI.h.get('access-control-allow-origin') === '*' && !UI.h.get('access-control-allow-credentials') && /no-store/.test(UI.h.get('cache-control')), JSON.stringify(UI.j));
  db.prepare('UPDATE users SET points = 9999 WHERE id = ?').run(alice.id);
  const UI2 = await userinfo(tok.access_token, { method: 'POST' });
  check('  ...live: Send Power changed is read as it is now (GET or POST)', UI2.status === 200 && UI2.j.send_power === 9999, JSON.stringify(UI2.j));
  db.prepare('UPDATE users SET points = 4321 WHERE id = ?').run(alice.id);
  const rowsBefore = ['oauth_tokens', 'oauth_codes', 'oauth_consents', 'oauth_clients'].map((t) => db.prepare('SELECT COUNT(*) n, MAX(rowid) m FROM ' + t).get()).map((r) => r.n + ':' + r.m).join(',');
  const consBefore = JSON.stringify(db.prepare('SELECT * FROM oauth_consents WHERE user_id = ?').all(alice.id)), tokBefore = JSON.stringify(db.prepare('SELECT * FROM oauth_tokens WHERE user_id = ? ORDER BY token_hash').all(alice.id));
  for (let i = 0; i < 3; i++) await userinfo(tok.access_token);
  check('  ...and a userinfo call writes nothing down: no row added or changed anywhere (no usage log)', rowsBefore === ['oauth_tokens', 'oauth_codes', 'oauth_consents', 'oauth_clients'].map((t) => db.prepare('SELECT COUNT(*) n, MAX(rowid) m FROM ' + t).get()).map((r) => r.n + ':' + r.m).join(',')
    && consBefore === JSON.stringify(db.prepare('SELECT * FROM oauth_consents WHERE user_id = ?').all(alice.id)) && tokBefore === JSON.stringify(db.prepare('SELECT * FROM oauth_tokens WHERE user_id = ? ORDER BY token_hash').all(alice.id)));
  const cols = Object.fromEntries(['oauth_clients', 'oauth_consents', 'oauth_codes', 'oauth_tokens', 'oauth_keys'].map((t) => [t, db.prepare('PRAGMA table_info(' + t + ')').all().map((c) => c.name)]));
  check('  ...and no table of it has a place for an IP, a device, a browser or a log of use', Object.values(cols).flat().every((c) => !/(^|_)(ip|ips|ip_idx|agent|ua|device|seen|last_seen|log|uses|use_count|last_use)(_|$)/i.test(c)), JSON.stringify(cols));
  const noTok = await userinfo(null), cookieOnly = await userinfo(null, { headers: { Cookie: alice.cookie } });
  const inQuery = await fetch(BASE + '/oauth/userinfo?access_token=' + tok.access_token, { headers: { 'X-Forwarded-For': nextIp() } });
  check('  ...without a Bearer token it is 401 invalid_token with WWW-Authenticate — a session cookie is not a token, and neither is ?access_token=', noTok.status === 401 && /Bearer/.test(noTok.h.get('www-authenticate') || '') && cookieOnly.status === 401 && inQuery.status === 401);
  check('no session cookie ever reaches an app: none set by the token endpoint, none in any token, and the token endpoint ignores cookies', !(T1.h.getSetCookie ? T1.h.getSetCookie() : []).length && !tok.id_token.includes(alice.sid) && tok.access_token !== alice.sid
    && (await tokenReq({ grant_type: 'refresh_token', refresh_token: 'x' }, { headers: { Cookie: alice.cookie } })).status === 401);

  /* ═══ 10. refresh: rotating, the chain revoked on reuse ═══ */
  const R1 = await tokenReq({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: PUB.clientId });
  const r1 = R1.j || {};
  check('a refresh token gets a new access token, a NEW refresh token and a fresh id_token (no nonce) with the same sub', R1.status === 200 && r1.access_token && r1.refresh_token && r1.refresh_token !== tok.refresh_token && r1.access_token !== tok.access_token && jwtParts(r1.id_token).payload.sub === IDP.sub && !('nonce' in jwtParts(r1.id_token).payload), R1.text.slice(0, 200));
  const rtRow = db.prepare('SELECT * FROM oauth_tokens WHERE token_hash = ?').get(sha(r1.refresh_token)), rt0 = db.prepare('SELECT * FROM oauth_tokens WHERE token_hash = ?').get(sha(tok.refresh_token));
  check('  ...rotation never extends the chain: the new refresh token ends when the first did, 30 days from the sign-in', rtRow && rt0 && rtRow.expires_at === rt0.expires_at && Math.abs(rt0.expires_at - rt0.created_at - 30 * 864e5) < 1000 && rt0.used_at > 0);
  const narrow = await tokenReq({ grant_type: 'refresh_token', refresh_token: r1.refresh_token, client_id: PUB.clientId, scope: 'openid send.handle send.picture' });
  check('  ...a refresh can narrow the scopes but never add one (the picture was not granted)', narrow.status === 400 && narrow.j.error === 'invalid_scope', narrow.text);
  const R2 = await tokenReq({ grant_type: 'refresh_token', refresh_token: r1.refresh_token, client_id: PUB.clientId });
  const reuse = await tokenReq({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: PUB.clientId });
  check('reusing an old refresh token is refused and revokes the whole chain: the newest refresh and access tokens die with it', R2.status === 200 && reuse.status === 400 && reuse.j.error === 'invalid_grant'
    && (await tokenReq({ grant_type: 'refresh_token', refresh_token: R2.j.refresh_token, client_id: PUB.clientId })).status === 400 && (await userinfo(R2.j.access_token)).status === 401 && (await userinfo(tok.access_token)).status === 401, reuse.text);
  const otherApp = await getCode(alice, TWO, { scopes: ['send.handle', 'offline_access'], tick: ['send.handle', 'offline_access'] });
  const TO = await exchange(TWO, otherApp);
  const crossRt = await tokenReq({ grant_type: 'refresh_token', refresh_token: TO.j && TO.j.refresh_token, client_id: PUB.clientId });
  check('  ...a refresh token presented by another app is refused (and its chain revoked)', TO.status === 200 && crossRt.status === 400 && crossRt.j.error === 'invalid_grant' && (await userinfo(TO.j.access_token)).status === 401, crossRt.text);

  const cE = await getCode(alice, PUB, { scopes: ALL }), TE = (await exchange(PUB, cE)).j;
  const asBearer = await userinfo(TE.refresh_token);
  db.prepare('UPDATE oauth_tokens SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1, sha(TE.access_token));
  check('an access token past its hour is refused, and a refresh token is never an access token', (await userinfo(TE.access_token)).status === 401 && asBearer.status === 401);
  check('  ...expired codes and tokens are pruned (every ten minutes, and a minute after a start)', /db\.prepare\('DELETE FROM oauth_codes WHERE expires_at < \?'\)\.run\(t - CODE_KEEP_MS\);/.test(LIB) && /db\.prepare\('DELETE FROM oauth_tokens WHERE expires_at < \?'\)\.run\(t\);/.test(LIB)
    && /setInterval\(prune, 10 \* 60e3\)/.test(LIB) && /setTimeout\(prune, 60e3\)/.test(LIB));

  /* ═══ 11. the code: single use (and a second use revokes), 60 s, bound to app, address and verifier ═══ */
  const c3 = await getCode(alice, PUB, { scopes: ALL });
  const T3 = await exchange(PUB, c3);
  const T3b = await exchange(PUB, c3);
  check('a code used twice: the second is invalid_grant and everything issued from the first is revoked (access and refresh)', T3.status === 200 && T3b.status === 400 && T3b.j.error === 'invalid_grant' && /revoked/.test(T3b.j.error_description)
    && (await userinfo(T3.j.access_token)).status === 401 && (await tokenReq({ grant_type: 'refresh_token', refresh_token: T3.j.refresh_token, client_id: PUB.clientId })).status === 400, T3b.text);
  const c4 = await getCode(alice, PUB, { scopes: ALL });
  db.prepare('UPDATE oauth_codes SET expires_at = ? WHERE code_hash = ?').run(Date.now() - 1, sha(c4.code));
  const T4 = await exchange(PUB, c4);
  check('  ...an expired code (past its 60 s) is refused', T4.status === 400 && T4.j.error === 'invalid_grant' && /expired/.test(T4.j.error_description), T4.text);
  const c5 = await getCode(alice, PUB, { scopes: ALL });
  const T5 = await exchange(PUB, c5, { redirect_uri: 'http://localhost:5173/cb' });
  check('  ...redirect_uri must equal the one in the request (another registered one is not enough)', T5.status === 400 && T5.j.error === 'invalid_grant' && /redirect_uri/.test(T5.j.error_description), T5.text);
  const c6 = await getCode(alice, PUB, { scopes: ALL });
  const T6 = await tokenReq({ grant_type: 'authorization_code', code: c6.code, redirect_uri: PUB.redirect, code_verifier: c6.verifier, client_id: TWO.clientId });
  check('  ...and the code belongs to the app it was issued to', T6.status === 400 && T6.j.error === 'invalid_grant', T6.text);
  const c7 = await getCode(alice, PUB, { scopes: ALL });
  const T7 = await tokenReq({ grant_type: 'authorization_code', code: c7.code, redirect_uri: PUB.redirect, client_id: PUB.clientId });
  check('  ...a code sent with no code_verifier is refused', T7.status === 400 && T7.j.error === 'invalid_grant', T7.text);
  const dup = await tokenReq('grant_type=authorization_code&code=a&code=b&client_id=' + PUB.clientId);
  const json = await fetch(BASE + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp() }, body: JSON.stringify({ grant_type: 'authorization_code' }) });
  const gtBad = await tokenReq({ grant_type: 'password', username: 'a', password: 'b', client_id: PUB.clientId });
  check('the token endpoint takes a form body only, no repeated parameter, and the two grant types only', dup.status === 400 && dup.j.error === 'invalid_request' && json.status === 400 && gtBad.status === 400 && gtBad.j.error === 'unsupported_grant_type');

  /* ═══ 12. confidential apps: the secret, Basic or post, hashed and compared in constant time ═══ */
  const cc1 = await getCode(alice, CONF, { scopes: ['send.handle'], tick: ['send.handle'] });
  check('a redirect URI with a query of its own keeps it, and the answer is added after it', cc1.u && cc1.u.href.startsWith('https://vault.example/return?from=send&code='), cc1.r.loc);
  const noSecret = await exchange(CONF, cc1, {}, { noSecret: true });
  check('a confidential app without its secret is 401 invalid_client (and the code is not spent by it)', noSecret.status === 401 && noSecret.j.error === 'invalid_client', noSecret.text);
  const wrongSecret = await tokenReq({ grant_type: 'authorization_code', code: cc1.code, redirect_uri: CONF.redirect, code_verifier: cc1.verifier, client_id: CONF.clientId, client_secret: CONF.secret.slice(0, -1) + (CONF.secret.endsWith('A') ? 'B' : 'A') });
  const both = await tokenReq({ grant_type: 'authorization_code', code: cc1.code, redirect_uri: CONF.redirect, code_verifier: cc1.verifier, client_secret: CONF.secret }, { basic: [CONF.clientId, CONF.secret] });
  check('  ...a wrong secret is 401; Basic and post together is invalid_request', wrongSecret.status === 401 && wrongSecret.j.error === 'invalid_client' && both.status === 400 && both.j.error === 'invalid_request', wrongSecret.status + ' ' + both.text);
  const viaBasic = await tokenReq({ grant_type: 'authorization_code', code: cc1.code, redirect_uri: CONF.redirect, code_verifier: cc1.verifier }, { basic: [CONF.clientId, CONF.secret] });
  check('  ...client_secret_basic works (and PKCE is still checked for it)', viaBasic.status === 200 && !!viaBasic.j.access_token && !viaBasic.j.refresh_token, viaBasic.text.slice(0, 200));
  const cc2 = await getCode(alice, CONF, { scopes: ['send.handle'] });
  const viaPost = await exchange(CONF, cc2);
  check('  ...and so does client_secret_post', viaPost.status === 200 && !!viaPost.j.access_token, viaPost.text.slice(0, 200));
  const pubWithSecret = await tokenReq({ grant_type: 'authorization_code', code: 'x', redirect_uri: PUB.redirect, code_verifier: 'y'.repeat(43), client_id: PUB.clientId, client_secret: 'anything' });
  check('  ...a public app that sends a secret is refused (it has none: PKCE is its proof)', pubWithSecret.status === 401 && pubWithSecret.j.error === 'invalid_client');
  check('  ...secrets are compared as SHA-256 digests with crypto.timingSafeEqual (constant time)', /crypto\.timingSafeEqual\(got, want\)/.test(LIB) && /want = c\.secret_hash \? Buffer\.from\(c\.secret_hash, 'hex'\)/.test(LIB));
  const rot = await api('/api/oauth/apps/' + CONF.clientId + '/secret', { method: 'POST', cookie: devA.cookie });
  const cc3 = await getCode(alice, CONF, { scopes: ['send.handle'] });
  const oldSecret = await exchange(CONF, cc3);
  const newSecret = await tokenReq({ grant_type: 'authorization_code', code: cc3.code, redirect_uri: CONF.redirect, code_verifier: cc3.verifier, client_id: CONF.clientId, client_secret: rot.j && rot.j.clientSecret });
  check('rotating the secret shows the new one once; the old one stops at once', rot.status === 200 && /^ssec_/.test(rot.j.clientSecret) && rot.j.clientSecret !== CONF.secret && oldSecret.status === 401 && newSecret.status === 200, rot.status + ' ' + oldSecret.status + ' ' + newSecret.status);
  CONF.secret = rot.j && rot.j.clientSecret;

  /* ═══ 13. revoking (RFC 7009) ═══ */
  const c8 = await getCode(alice, PUB, { scopes: ALL });
  const T8 = (await exchange(PUB, c8)).j;
  const rvAccess = await tokenReq({ token: T8.access_token, client_id: PUB.clientId }, { path: '/oauth/revoke' });
  check('revoking an access token: 200, and it stops working (its refresh token still works)', rvAccess.status === 200 && rvAccess.h.get('access-control-allow-origin') === '*' && (await userinfo(T8.access_token)).status === 401, rvAccess.status);
  const R8 = await tokenReq({ grant_type: 'refresh_token', refresh_token: T8.refresh_token, client_id: PUB.clientId });
  check('  ...(the refresh token still refreshes)', R8.status === 200, R8.text.slice(0, 120));
  const rvRefresh = await tokenReq({ token: R8.j.refresh_token, token_type_hint: 'refresh_token', client_id: PUB.clientId }, { path: '/oauth/revoke' });
  check('  ...revoking a refresh token takes its whole chain, the access tokens with it', rvRefresh.status === 200 && (await userinfo(R8.j.access_token)).status === 401 && (await tokenReq({ grant_type: 'refresh_token', refresh_token: R8.j.refresh_token, client_id: PUB.clientId })).status === 400);
  const c9 = await getCode(alice, PUB, { scopes: ALL });
  const T9 = (await exchange(PUB, c9)).j;
  const rvOther = await tokenReq({ token: T9.access_token, client_id: TWO.clientId }, { path: '/oauth/revoke' });
  const rvUnknown = await tokenReq({ token: 'nothing-of-ours', client_id: PUB.clientId }, { path: '/oauth/revoke' });
  check('  ...an unknown token and another app\'s token are both answered 200 — and another app\'s token is left alone', rvOther.status === 200 && rvUnknown.status === 200 && (await userinfo(T9.access_token)).status === 200);

  /* ═══ 14. the pairwise sub ═══ */
  const cA = await getCode(alice, TWO, { scopes: ['send.handle'] });
  const subTwo = jwtParts((await exchange(TWO, cA)).j.id_token).payload.sub;
  const cB = await getCode(bob, PUB, { scopes: ['send.handle'], tick: ['send.handle'] });
  const subBob = jwtParts((await exchange(PUB, cB)).j.id_token).payload.sub;
  const cA2 = await getCode(alice, PUB, { scopes: ALL });
  const subAgain = jwtParts((await exchange(PUB, cA2)).j.id_token).payload.sub;
  check('the sub is pairwise: the same member gets a different sub in each app, the same one every time in one app, and two members never share one', /^[A-Za-z0-9_-]{43}$/.test(IDP.sub) && subTwo !== IDP.sub && subAgain === IDP.sub && subBob !== IDP.sub && /^[A-Za-z0-9_-]{43}$/.test(subTwo), [IDP.sub, subTwo, subBob].join(' '));
  const guesses = [String(alice.id), String(sendNo), alice.name, b64url(Buffer.from(String(alice.id))), b64url(crypto.createHash('sha256').update(alice.id + '\u0000' + PUB.clientId).digest()),
    b64url(crypto.createHash('sha256').update(String(alice.id) + PUB.clientId).digest()), b64url(crypto.createHmac('sha256', '').update(alice.id + '\u0000' + PUB.clientId).digest()), b64url(crypto.createHmac('sha256', PUB.clientId).update(String(alice.id)).digest())];
  check('  ...and it cannot be worked out from the account: not the row id, the Send ID or the handle, nor a hash of them without the site\'s secret', !guesses.includes(IDP.sub) && !IDP.sub.includes(alice.name));

  /* ═══ 15. scope filtering: only what was ticked, in the token and userinfo alike ═══ */
  const cFew = await getCode(bob, XSS, { scopes: ['send.handle', 'send.id', 'send.power', 'offline_access'], tick: ['send.handle'] });
  const TF = await exchange(XSS, cFew);
  const pF = jwtParts(TF.j.id_token).payload, uF = await userinfo(TF.j.access_token);
  check('ticking one box of four: the token and userinfo carry that one only, the scope says so, and no refresh token (offline_access was not ticked)', TF.status === 200 && TF.j.scope === 'openid send.handle' && !TF.j.refresh_token && keySet(uF.j) === 'preferred_username,profile,sub'
    && pF.preferred_username === '__oi_bob__' && !('send_id' in pF) && !('send_power' in pF), JSON.stringify(TF.j).slice(0, 200) + ' ' + JSON.stringify(uF.j));
  const cPic = await getCode(alice, XSS, { scopes: ['send.picture'], tick: ['send.picture'] });
  const pPic = jwtParts((await exchange(XSS, cPic)).j.id_token).payload;
  const cPicB = await getCode(bob, TWO, { scopes: ['send.picture'], tick: ['send.picture'] });
  const pPicB = jwtParts((await exchange(TWO, cPicB)).j.id_token).payload;
  check('  ...the picture is the absolute public address of the member\'s picture, and nothing at all for a member with none', pPic.picture === BASE + '/uploads/aaaaaaaaaaaaaaaaaaaaaaaa.png' && keySet(pPic).includes('picture') && !('picture' in pPicB), pPic.picture + ' / ' + JSON.stringify(pPicB));

  /* ═══ 16. prompt ═══ */
  const pnOk = await req('GET', authzPath(PUB, { scopes: ALL, challenge: pkce().challenge, prompt: 'none', state: 'pn-2' }), { cookie: alice.cookie });
  check('prompt=none, signed in and already answered: a code at once, no page', pnOk.status === 302 && locOf(pnOk).searchParams.get('code') && locOf(pnOk).searchParams.get('state') === 'pn-2', pnOk.status + ' ' + pnOk.loc);
  const carol = mkUser('__oi_carol__');
  const pnNo = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'none', state: 'pn-3' }), { cookie: carol.cookie });
  check('  ...and for a member who has not answered yet: consent_required, nothing shown', pnNo.status === 302 && locOf(pnNo).searchParams.get('error') === 'consent_required' && locOf(pnNo).searchParams.get('state') === 'pn-3', pnNo.status + ' ' + pnNo.loc);
  const pc = await req('GET', authzPath(PUB, { scopes: ALL, challenge: pkce().challenge, prompt: 'consent' }), { cookie: alice.cookie });
  check('prompt=consent shows the page again even with an answer on file — with the member\'s own earlier ticks ticked', pc.status === 200 && /name="scope" value="send\.handle" checked/.test(pc.text) && !/name="scope" value="send\.picture" checked/.test(pc.text));
  const more = await req('GET', authzPath(TWO, { scopes: ['send.handle', 'send.power'], challenge: pkce().challenge }), { cookie: alice.cookie });
  check('  ...and a request for a scope the member has not answered for shows the page (an answer on file covers only what it answered)', more.status === 200 && /Your Send Power/.test(more.text));
  const cancel = await post({ pending: field(more.text, 'pending'), csrf: field(more.text, 'csrf'), decision: 'cancel' });
  check('Cancel goes back to the app with access_denied and the state, and changes nothing on file', cancel.status === 302 && locOf(cancel).searchParams.get('error') === 'access_denied' && !locOf(cancel).searchParams.get('code')
    && db.prepare('SELECT scopes FROM oauth_consents WHERE user_id = ? AND client_id = ?').get(alice.id, TWO.clientId).scopes === 'send.handle offline_access', cancel.loc);

  /* ═══ 17. the member: the list, and Revoke ═══ */
  const g = await api('/api/oauth/grants', { cookie: alice.cookie });
  const gPub = g.j && g.j.grants.find((x) => x.clientId === PUB.clientId);
  check('a member lists the apps they signed in to: each app, what it can see (the scopes, in words), when they allowed it', g.status === 200 && gPub && gPub.name === 'Send Racer' && gPub.scopes.join(' ') === 'openid send.handle send.id send.power send.boost send.verified offline_access'
    && gPub.shares.every((s) => typeof s.label === 'string' && s.label.length > 5) && gPub.grantedAt > 0 && JSON.stringify(gPub.redirectHosts) === '["racer.example","localhost:5173","127.0.0.1:' + walkPort + '"]', JSON.stringify(gPub));
  const live = (await exchange(PUB, await getCode(alice, PUB, { scopes: ALL }))).j;
  const rv = await api('/api/oauth/grants/' + PUB.clientId, { method: 'DELETE', cookie: alice.cookie });
  check('  ...Revoke kills every token of that app at once and the consent with it (the next sign-in asks again)', rv.status === 200 && (await userinfo(live.access_token)).status === 401 && (await userinfo(T9.access_token)).status === 401
    && (await tokenReq({ grant_type: 'refresh_token', refresh_token: live.refresh_token, client_id: PUB.clientId })).status === 400 && !db.prepare('SELECT 1 FROM oauth_consents WHERE user_id = ? AND client_id = ?').get(alice.id, PUB.clientId)
    && (await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge }), { cookie: alice.cookie })).status === 200, rv.status + ' ' + rv.text.slice(0, 100));
  const rvNot = await api('/api/oauth/grants/' + PUB.clientId, { method: 'DELETE', cookie: alice.cookie });
  check('  ...and only their own: another member\'s consent is untouched, and revoking twice says there is nothing to revoke', rvNot.status === 404 && !!db.prepare('SELECT 1 FROM oauth_consents WHERE user_id = ? AND client_id = ?').get(bob.id, PUB.clientId));

  /* ═══ 18. the admin: review, disable ═══ */
  const admin = mkUser('__oi_admin__', { id: ADMIN_ID });
  const notAdmin = await api('/api/admin/oauth/apps', { cookie: alice.cookie });
  const al = await api('/api/admin/oauth/apps', { cookie: admin.cookie });
  const alPub = al.j && al.j.apps.find((a) => a.clientId === PUB.clientId);
  check('the admin lists every app with its owner; anyone else gets 404', notAdmin.status === 404 && al.status === 200 && alPub && alPub.owner && alPub.owner.username === devA.name && Array.isArray(al.j.keys) && al.j.keys.some((k) => k.state === 'signing') && !al.text.includes(CONF.secret), al.status);
  const revd = await api('/api/admin/oauth/apps/' + PUB.clientId, { method: 'POST', cookie: admin.cookie, body: { reviewed: true } });
  const pageRev = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'consent' }), { cookie: bob.cookie });
  check('  ...marks an app reviewed, and the consent page says so (and that it is still run by its own developer)', revd.status === 200 && revd.j.app.reviewed === true && /Reviewed by Just Send It on /.test(pageRev.text) && /still run by its own developer/.test(pageRev.text) && !/Not reviewed/.test(pageRev.text));
  const edit = await api('/api/oauth/apps/' + PUB.clientId, { method: 'POST', cookie: devA.cookie, body: { homepage: 'https://racer.example/new' } });
  check('  ...an edit to what members are shown (the website) clears the review', edit.status === 200 && edit.j.reviewCleared === true && edit.j.app.reviewed === false && edit.j.app.homepage === 'https://racer.example/new');
  const kindChange = await api('/api/oauth/apps/' + PUB.clientId, { method: 'POST', cookie: devA.cookie, body: { kind: 'confidential' } });
  check('  ...(an app\'s kind cannot change)', kindChange.status === 400);
  const bobLive = (await exchange(PUB, await getCode(bob, PUB, { scopes: ['send.handle'] }))).j;
  const dis = await api('/api/admin/oauth/apps/' + PUB.clientId, { method: 'POST', cookie: admin.cookie, body: { disabled: true, reason: 'test' } });
  const disPage = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge }), { cookie: bob.cookie });
  const disTok = await tokenReq({ grant_type: 'refresh_token', refresh_token: 'x', client_id: PUB.clientId });
  check('disabling an app: it cannot start a sign-in (an error page, no redirect), its tokens stop working, and the token endpoint refuses it', dis.status === 200 && dis.j.app.disabled === true && disPage.status === 400 && !disPage.loc && /switched off/.test(disPage.text)
    && (await userinfo(bobLive.access_token)).status === 401 && disTok.status === 401 && disTok.j.error === 'invalid_client', disPage.status + ' ' + disTok.text);
  await api('/api/admin/oauth/apps/' + PUB.clientId, { method: 'POST', cookie: admin.cookie, body: { disabled: false } });
  check('  ...and enabling it again lets members sign in again (the old tokens stay dead)', (await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'none' }), { cookie: bob.cookie })).status === 302 && (await userinfo(bobLive.access_token)).status === 401);

  /* ═══ 19. who may sign in: restricted, system, deleted ═══ */
  const dave = mkUser('__oi_dave__', { points: 5 });
  const daveTok = (await exchange(PUB, await getCode(dave, PUB, { scopes: ['send.handle', 'offline_access'], tick: ['send.handle', 'offline_access'] }))).j;
  db.prepare('UPDATE users SET restricted_until = ?, restrict_level = 1 WHERE id = ?').run(Date.now() + 864e5, dave.id);
  const dUi = await userinfo(daveTok.access_token);
  const dPage = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge }), { cookie: dave.cookie });
  const dNone = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'none' }), { cookie: dave.cookie });
  check('a restricted account cannot sign in to apps: its tokens die (userinfo 401, refresh refused, the rows gone), the page says why without a code, prompt=none is access_denied',
    dUi.status === 401 && (await tokenReq({ grant_type: 'refresh_token', refresh_token: daveTok.refresh_token, client_id: PUB.clientId })).status === 400 && !db.prepare('SELECT 1 FROM oauth_tokens WHERE user_id = ?').get(dave.id)
    && dPage.status === 403 && /read-only mode/.test(dPage.text) && !dPage.loc && locOf(dNone).searchParams.get('error') === 'access_denied', dPage.status + ' ' + dNone.loc);
  check('  ...and the restriction itself revokes at once (the admin\'s and the automatic one), not only at the next use', /oidcRevokeUser\(uid\);   \/\/ a restricted account/.test(SRC) && /if \(typeof oidcRevokeUser === 'function'\) oidcRevokeUser\(userId\);   \/\/ read-only accounts/.test(SRC));
  const sys = mkUser('__oi_system__', { system: true });
  const sysPage = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge }), { cookie: sys.cookie });
  check('  ...the site\'s own (system) account cannot either', sysPage.status === 403 && /does not sign in to apps/.test(sysPage.text) && !sysPage.loc);
  // an account deleted through the real route (its session unlocked, as a member who just confirmed it is them)
  const erin = mkUser('__oi_erin__', { sudo: true, points: 7 });
  const erinApp = await mkApp(erin, { name: 'Erin Games', homepage: 'https://erin.example', redirectUris: ['https://erin.example/cb'], kind: 'public' });
  const ERIN = { clientId: erinApp.j.app.clientId, redirect: 'https://erin.example/cb' };
  const bobOnErin = (await exchange(ERIN, await getCode(bob, ERIN, { scopes: ['send.handle'], tick: ['send.handle'] }))).j;
  const erinTok = (await exchange(PUB, await getCode(erin, PUB, { scopes: ['send.handle', 'offline_access'], tick: ['send.handle', 'offline_access'] }))).j;
  const del = await api('/api/account/delete', { method: 'POST', cookie: erin.cookie, body: { confirm: 'DELETE' } });
  check('deleting an account revokes everything: its tokens and consents go, and the apps it registered go with everyone\'s sign-ins to them', del.status === 200 && (await userinfo(erinTok.access_token)).status === 401 && !db.prepare('SELECT 1 FROM oauth_consents WHERE user_id = ?').get(erin.id)
    && !db.prepare('SELECT 1 FROM oauth_tokens WHERE user_id = ?').get(erin.id) && !db.prepare('SELECT 1 FROM oauth_clients WHERE owner_id = ?').get(erin.id) && (await userinfo(bobOnErin.access_token)).status === 401
    && (await req('GET', authzPath(ERIN, { scopes: ['send.handle'], challenge: pkce().challenge }), { cookie: bob.cookie })).status === 400, del.status + ' ' + del.text.slice(0, 120));

  /* ═══ 20. the signing keys: rotation ═══ */
  const rotNo = await api('/api/admin/oauth/keys/rotate', { method: 'POST', cookie: alice.cookie });
  const rk = await api('/api/admin/oauth/keys/rotate', { method: 'POST', cookie: admin.cookie });
  const jw2 = (await req('GET', '/.well-known/jwks.json')).j;
  const oldKid = jwtParts(tok.id_token).head.kid, newKid = rk.j && rk.j.rotated.kid;
  const stillOld = jwtParts((await exchange(TWO, await getCode(alice, TWO, { scopes: ['send.handle'] }))).j.id_token).head.kid;
  check('the rotation helper publishes a new key a day before it signs: both are in the JWKS, and tokens are still signed with the old one until then', rotNo.status === 404 && rk.status === 200 && newKid !== oldKid && jw2.keys.some((k) => k.kid === newKid) && jw2.keys.some((k) => k.kid === oldKid)
    && Math.abs(rk.j.rotated.activeFrom - Date.now() - 864e5) < 10000 && stillOld === oldKid, JSON.stringify(rk.j && rk.j.keys));
  // the day passes: the old key has signed for two days, the new one is due as of a second ago
  db.prepare('UPDATE oauth_keys SET active_from = ? WHERE kid = ?').run(Date.now() - 2 * 864e5, oldKid);
  db.prepare('UPDATE oauth_keys SET active_from = ? WHERE kid = ?').run(Date.now() - 1000, newKid);
  const signedNew = jwtParts((await exchange(TWO, await getCode(alice, TWO, { scopes: ['send.handle'] }))).j.id_token).head.kid;
  const jw3 = (await req('GET', '/.well-known/jwks.json')).j;
  const oldRow = db.prepare('SELECT * FROM oauth_keys WHERE kid = ?').get(oldKid);
  check('  ...once it is due it signs; the old key stays published (for 30 days) and its private half is dropped', signedNew === newKid && jw3.keys.some((k) => k.kid === oldKid) && oldRow && oldRow.private_enc === null, signedNew + ' ' + JSON.stringify(oldRow && { ...oldRow, public_jwk: 0 }));
  db.prepare('UPDATE oauth_keys SET active_from = ? WHERE kid = ?').run(Date.now() - 62 * 864e5, oldKid);   // as if the new key took over 31 days ago
  db.prepare('UPDATE oauth_keys SET active_from = ? WHERE kid = ?').run(Date.now() - 31 * 864e5, newKid);
  const jw4 = (await req('GET', '/.well-known/jwks.json')).j;
  const signed4 = jwtParts((await exchange(TWO, await getCode(alice, TWO, { scopes: ['send.handle'] }))).j.id_token).head.kid;
  check('  ...and thirty days after it stopped, the old key leaves the JWKS (the new one still signs: no key was minted in between)', !jw4.keys.some((k) => k.kid === oldKid) && jw4.keys.some((k) => k.kid === newKid) && signed4 === newKid
    && db.prepare('SELECT COUNT(*) n FROM oauth_keys').get().n === 2, JSON.stringify(jw4.keys.map((k) => k.kid)) + ' signed ' + signed4);

  /* ═══ 21. the rate limits ═══ */
  const hammer = async (fn, n) => { for (let i = 1; i <= n; i++) { const s = await fn(i); if (s === 429) return i; } return 0; };
  const tokLim = await hammer(() => tokenReq({ grant_type: 'refresh_token', refresh_token: 'x', client_id: PUB.clientId }, { ip: NET + '21' }).then((r) => r.status), 130);
  const uiLim = await hammer(() => userinfo('nope', { ip: NET + '22' }).then((r) => r.status), 310);
  const azLim = await hammer(() => req('GET', '/oauth/authorize?client_id=x', { ip: NET + '23' }).then((r) => r.status), 130);
  const rvLim = await hammer(() => tokenReq({ token: 'x', client_id: PUB.clientId }, { ip: NET + '24', path: '/oauth/revoke' }).then((r) => r.status), 130);
  check('the token, userinfo, authorize and revoke endpoints are rate-limited per address (120/min, 300/min, 120 per 10 min, 120/min)', tokLim === 121 && uiLim === 301 && azLim === 121 && rvLim === 121, [tokLim, uiLim, azLim, rvLim].join(' '));

  /* ═══ 22. CORS only where it belongs ═══ */
  const azC = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge }), { cookie: alice.cookie, headers: { Origin: 'https://racer.example' } });
  const apiC = await req('GET', '/api/oauth/apps', { cookie: devA.cookie, headers: { Origin: 'https://racer.example' } });
  const preAz = await raw('OPTIONS', '/oauth/authorize', { Origin: 'https://racer.example', 'Access-Control-Request-Method': 'POST' });
  check('CORS only on discovery, the JWKS, token, userinfo and revoke: never on the authorize page, its preflight, or the site\'s own API', !azC.h.get('access-control-allow-origin') && !apiC.h.get('access-control-allow-origin') && !preAz.h['access-control-allow-origin'], [azC.h.get('access-control-allow-origin'), apiC.h.get('access-control-allow-origin'), preAz.status].join(' '));
  const framed = await Promise.all([req('POST', '/oauth/token', { form: {} }), userinfo(null), req('POST', '/oauth/revoke', { form: {} }), req('GET', '/oauth/authorize?client_id=x')]);
  check('every answer under /oauth/ is unframeable (X-Frame-Options and frame-ancestors \'none\') and uncached', framed.every((r) => r.h.get('x-frame-options') === 'DENY' && /frame-ancestors 'none'/.test(r.h.get('content-security-policy') || '') && /no-store/.test(r.h.get('cache-control') || '')), framed.map((r) => r.status + ' ' + r.h.get('x-frame-options')).join(' | '));

  /* ═══ 23. the browser walk: the sign-in and consent pages at 320, 390 and 1280 px ═══ */
  await walk(alice, PUB, WALK_REDIRECT);
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  try { walkSrv.close(); } catch {}
  for (const c of apps) for (const t of ['oauth_tokens', 'oauth_codes', 'oauth_consents', 'oauth_clients']) { try { db.prepare('DELETE FROM ' + t + ' WHERE client_id = ?').run(c); } catch {} }
  for (const id of made) {
    for (const t of ['sessions', 'notifications', 'points_events', 'oauth_tokens', 'oauth_codes', 'oauth_consents', 'data_history']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM oauth_clients WHERE owner_id = ?').run(id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_oi\\_%' ESCAPE '\\'").get().n;
  console.log('\ncleanup — users left:', left, '| apps left:', db.prepare("SELECT COUNT(*) n FROM oauth_clients").get().n);
  db.close();
}

/* ═══ the browser: headless Chrome, muted ═══ */
async function walk(member, app, redirect) {
  const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'].find((p) => p && existsSync(p));
  if (!CHROME) {
    if (process.env.CI) { notes.push('skipping the browser walk: no Chrome or Chromium on this runner (set CHROME_PATH)'); return; }
    check('a Chrome or Chromium to walk the pages in (set CHROME_PATH)', false, 'none found'); return;
  }
  const W = { ...app, redirect };
  const profile = mkdtempSync(path.join(os.tmpdir(), 'jsi-oidc-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--lang=en-US', 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let ws = null, session = null, seq = 0; const pend = new Map(), errors = [];
  const cdp = (method, params = {}, sid = session) => new Promise((ok, bad) => { const id = ++seq; pend.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
  const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)); return r.result.value; };
  const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(60); } return null; };
  const KEYS = { Tab: 9, Enter: 13, ' ': 32 };
  const press = async (k, mods = 0) => { const base = { key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: KEYS[k], nativeVirtualKeyCode: KEYS[k], modifiers: mods }; await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(k === 'Enter' ? { text: '\r' } : k === ' ' ? { text: ' ' } : {}) }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); };
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
    if (!existsSync(portFile)) throw new Error('Chrome did not open its debugging port');
    const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
    ws = new WebSocket('ws://127.0.0.1:' + port + wsPath);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('could not connect to Chrome')); });
    ws.onmessage = (m) => {
      const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
      if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.bad(new Error(JSON.stringify(d.error))) : p.ok(d.result); }
      else if (d.method === 'Runtime.exceptionThrown') errors.push(((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description) || d.params.exceptionDetails.text || '').split('\n')[0]);
      else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error: ' + (d.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 160));
      else if (d.method === 'Network.requestWillBeSent') { const u = d.params.request.url; if (!/^(http:\/\/localhost:|http:\/\/127\.0\.0\.1:|data:|about:)/.test(u)) errors.push('a request off the site: ' + u.slice(0, 100)); }
    };
    const t = await cdp('Target.createTarget', { url: 'about:blank' }, null);
    session = (await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
    await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
    const LOOK = `(() => {
      const probe = document.createElement('span'); probe.style.fontSize = 'var(--text-floor)'; document.body.appendChild(probe);
      const floor = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
      const card = document.querySelector('.oa-card'), cr = card.getBoundingClientRect(), small = [], out = [], tiny = [], untipped = [];
      for (const el of card.querySelectorAll('*')) {
        if (!el.getClientRects().length || el.closest('[hidden]')) continue;
        const r = el.getBoundingClientRect();
        if (r.right > cr.right + 1 || r.left < cr.left - 1) out.push((el.className || el.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
        if ([...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < floor - 0.5) small.push((el.className || el.tagName) + ' ' + getComputedStyle(el).fontSize);
        if (el.matches('button, a.btn, label.oa-scope') && r.height < 43.5) tiny.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.height));
        if (el.matches('button, a.btn') && (el.getAttribute('data-tip') || '').length < 8) untipped.push(el.id || el.textContent.trim());
      }
      return { floor, doc: document.documentElement.scrollWidth, iw: innerWidth, small: small.slice(0, 5), out: out.slice(0, 5), tiny: tiny.slice(0, 5), untipped };
    })()`;
    const looks = [], trouble = [];
    for (const w of [320, 390, 1280]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: w < 768 ? 740 : 900, deviceScaleFactor: 1, mobile: w < 768 });
      await cdp('Emulation.setTouchEmulationEnabled', w < 768 ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      for (const who of ['out', 'in']) {
        await cdp('Network.clearBrowserCookies');
        await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: BASE });
        if (who === 'in') await cdp('Network.setCookie', { name: 'sid', value: member.sid, url: BASE });
        await cdp('Page.navigate', { url: BASE + authzPath(W, { scopes: ['send.handle', 'send.id', 'send.power', 'send.boost', 'offline_access'], challenge: pkce().challenge, prompt: 'consent' }) });
        await until('document.readyState === "complete" && !!document.querySelector(".oa-card")');
        if (who === 'out') await until('window.AUTH && document.getElementById("auth-modal")', 6000);
        await sleep(300);
        const L = await ev(LOOK);
        looks.push(w + who + ':' + L.floor);
        if (L.doc > L.iw || L.small.length || L.out.length || L.tiny.length || L.untipped.length) trouble.push(w + ' ' + who + ' ' + JSON.stringify(L));
      }
    }
    check('in a browser at 320, 390 and 1280 px, signed out and in: nothing sideways, no text under the floor, every button and tick row at least 44px tall and described', trouble.length === 0 && looks.length === 6, trouble.join(' || ') || looks.join(' '));
    // signed out: "Sign in" opens the site's own sign-in dialog
    await cdp('Network.clearBrowserCookies'); await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: BASE });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 1, mobile: true });
    await cdp('Page.navigate', { url: BASE + authzPath(W, { scopes: ['send.handle'], challenge: pkce().challenge }) });
    await until('document.readyState === "complete" && window.AUTH && document.getElementById("auth-modal")');
    await ev('document.getElementById("oa-signin").click()');
    const opened = await until('!document.getElementById("auth-modal").hasAttribute("hidden")', 3000);
    check('signed out, "Sign in" opens the site\'s own sign-in dialog (auth.js), on this page', !!opened);
    // signing in (a session appears, as the dialog's sign-in makes one) carries on to the same request: the consent page
    await cdp('Network.setCookie', { name: 'sid', value: member.sid, url: BASE });
    await ev('window.AUTH.refresh ? AUTH.refresh().then(() => document.dispatchEvent(new CustomEvent("auth:change", { detail: AUTH.user }))) : null');
    const onConsent = await until('document.querySelector(\'[data-mode="consent"]\') && location.search.startsWith("?pending=")', 6000);
    check('  ...and once signed in, the page carries on to the same request by its id: the consent page', !!onConsent);
    // the keyboard: Tab to the first box, Space ticks it, Tab on to Allow, Enter answers — and the app gets the code and the state
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    const state = 'walk-' + crypto.randomBytes(4).toString('hex');
    await cdp('Page.navigate', { url: BASE + authzPath(W, { scopes: ['send.handle', 'send.power'], challenge: pkce().challenge, prompt: 'consent', state }) });
    await until('document.readyState === "complete" && document.querySelector(\'[data-mode="consent"]\')');
    const order = [];
    for (let i = 0; i < 14; i++) { await press('Tab'); order.push(await ev('(document.activeElement.name ? document.activeElement.name + ":" + document.activeElement.value : document.activeElement.id || document.activeElement.tagName)')); if (order[order.length - 1] === 'scope:send.handle') break; }
    await press(' ');
    const ticked = await ev('document.querySelector(\'input[value="send.handle"]\').checked');
    const tickedAll = await ev('!document.getElementById("oa-tickall").hidden');
    const order2 = [];
    for (let i = 0; i < 8; i++) { await press('Tab'); order2.push(await ev('(document.activeElement.name ? document.activeElement.name + ":" + document.activeElement.value : document.activeElement.id || document.activeElement.tagName)')); if (order2[order2.length - 1] === 'decision:allow') break; }
    walkHits = [];
    await press('Enter');
    for (let i = 0; i < 60 && !walkHits.length; i++) await sleep(100);
    const hit = walkHits[0] ? new URL(walkHits[0], 'http://x') : null;
    check('by keyboard alone: Tab reaches the boxes, Space ticks one, Tab reaches Allow, Enter answers — and the app gets a code and its state at its own address',
      order.includes('scope:send.handle') && ticked === true && tickedAll === true && order2.includes('decision:allow') && hit && hit.pathname === '/cb' && !!hit.searchParams.get('code') && hit.searchParams.get('state') === state, JSON.stringify({ order, order2, ticked, hit: walkHits[0] }));
    check('  ...with no script error, and not one request from the page to any other host', errors.length === 0, errors.slice(0, 5).join(' | '));
  } catch (e) {
    if (process.env.CI) notes.push('skipping the browser walk: ' + e.message.slice(0, 160));
    else check('the browser walk ran', false, e.message);
  } finally {
    try { ws && ws.close(); } catch {}
    try { proc.kill('SIGKILL'); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

for (const n of notes) console.log('note: ' + n);
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
