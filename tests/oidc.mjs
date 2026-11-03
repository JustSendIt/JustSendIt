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
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT, DB_PATH, SERVER_JS, DATA_DIR } from './_paths.mjs';
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
const made = [], apps = [], madeFiles = [];
// this suite's own addresses (the throwaway server trusts X-Forwarded-For from loopback), so no other suite's budget is spent
const NET = '198.51.' + (100 + Math.floor(Math.random() * 50)) + '.';
const IP = NET + '10';
let ipTick = 0;
const nextIp = () => NET + (100 + (ipTick++ % 120));   // the per-address limits are for a person, not for a suite making hundreds of sign-ins

// a member signs in with a password (an email identity, scrypt as the server writes it): what "Confirm it's you" asks for
function givePassword(id, pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc, secret, linked_at) VALUES (?, 'email', ?, 'v1:test', ?, ?)").run(id, 'oi-test-' + crypto.randomBytes(8).toString('hex'), salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'), Date.now());
}
/* Members are made as if they had just confirmed it is them (an open "Confirm it's you" window, as a fresh sign-in of an
   account whose only proof is its sign-in has), so a first Allow passes as it does for them; o.sudo === false makes a
   session with no window, which is asked. */
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
  const raw = 'tok_oi_' + crypto.randomBytes(16).toString('hex'), at = Date.now() - (o.ageMs || 5000), sudo = o.sudo !== false;
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed, sudo_until, sudo_since) VALUES (?,?,?,?,1,?,?)')
    .run(sha(raw), id, at, Date.now() + 864e5, sudo ? Date.now() + 36e5 : null, sudo ? at : null);
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
  const WIRE = SRC.slice(SRC.indexOf('const OIDC = OIDC_LIB.createOidc'), SRC.indexOf('function oidcRevokeUser'));
  check('the sub is a random 256-bit id per (member, app), made at the first grant and STORED (oauth_subjects): no key derives it, so no key change can move it',
    /CREATE TABLE IF NOT EXISTS oauth_subjects/.test(LIB) && /\.run\(userId, clientId, randTok\(32\)\)/.test(LIB) && /subFor\(me\.id, c\.client_id\);   \/\/ the member's private id in this app: made at the first grant/.test(LIB)
    && !/pairwiseSecret|derive\(/.test(WIRE) && !/derive\(info\)/.test(readFileSync(path.join(ROOT, 'lib', 'keys.js'), 'utf8')) && !/createHmac/.test(LIB));
  const credRoutes = ["if (p === '/api/auth/sessions' && req.method === 'DELETE')", "if (p === '/api/account/password' && req.method === 'POST')", "if (p === '/api/2fa/disable' && req.method === 'POST')"]
    .map((h) => { const i = SRC.indexOf(h); return i < 0 ? '' : SRC.slice(i, SRC.indexOf('return send(res, 200', i)); });
  check('a password change, "end other sessions" and two-factor turned off each end every app\'s grant (OIDC.revokeAllGrants), where the sessions and the data-key secret are reset',
    credRoutes.every((r) => /resetDataKeySecret\(me\.id/.test(r) && /const appsSignedOut = oidcRevokeAll\(me\.id\);/.test(r)) && /function oidcRevokeAll\(userId\) \{ try \{ return OIDC\.revokeAllGrants\(userId\);/.test(SRC)
    && /ownershipRefusal: \(me, b\) => ownershipRefusal\(me, b\)/.test(WIRE) && /OIDC\.seedFirstParty\(\{ clientId: 'sendy\.gg'/.test(SRC), credRoutes.map((r) => r.length).join(' '));

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
  const mkApp = async (dev, body, ip) => { const r = await api('/api/oauth/apps', { method: 'POST', cookie: dev.cookie, body, ip }); if (r.j && r.j.app) apps.push(r.j.app.clientId); return r; };
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

  /* ═══ 5. ...then every other problem goes back to the app, with its state: at once for a reviewed app, by the member's press for any other ═══ */
  const reviewedSet = (app, yes) => db.prepare('UPDATE oauth_clients SET reviewed_at = ?, reviewed_by = NULL WHERE client_id = ?').run(yes ? Date.now() : null, app.clientId);
  // an app nobody reviewed: a page (never a redirect) that says what went wrong, with one link back to its own address carrying the answer
  const linkBack = (r) => { const m = /<a class="btn btn-primary" href="([^"]+)" rel="noreferrer nofollow" data-tip="[^"]{8,}">Go back to ([^<]+)<\/a>/.exec(r.text || ''); try { return m ? { u: new URL(m[1].replace(/&amp;/g, '&')), host: m[2] } : null; } catch { return null; } };
  const unrev = [];
  for (const [why, p, want] of [['response_type=token', authzPath(PUB, { ...base0, extra: { response_type: 'token' }, state: 'U1' }), 'unsupported_response_type'], ['plain PKCE', authzPath(PUB, { ...base0, method: 'plain' }), 'invalid_request'],
    ['no client data but its ID and address', '/oauth/authorize?client_id=' + PUB.clientId + '&redirect_uri=' + encodeURIComponent(PUB.redirect), 'unsupported_response_type'], ['prompt=none signed out', authzPath(PUB, { ...base0, prompt: 'none' }), 'login_required']]) {
    const r = await req('GET', p, why.includes('signed out') ? {} : { cookie: alice.cookie }), l = linkBack(r);
    if (!(r.status === 400 && !r.loc && /<html/.test(r.text) && l && l.u.origin + l.u.pathname === 'https://racer.example/cb' && l.u.searchParams.get('error') === want && l.u.searchParams.get('iss') === BASE && l.host === 'racer.example' && /has not been reviewed by Just Send It/.test(r.text))) unrev.push(why + ' → ' + r.status + ' ' + r.loc);
  }
  check('an app nobody here reviewed is never sent an error on its own (its address is whatever its developer typed): the member gets a page saying what went wrong and a link back that carries the answer — so this site is no redirector anyone can aim', unrev.length === 0, unrev.join(' | '));
  reviewedSet(PUB, true);   // ...and a reviewed one is answered at once, as RFC 6749 §4.1.2.1 says
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
    await back('a max_age that is not a number of seconds', authzPath(PUB, { ...base0, extra: { max_age: '1h' } }), 'invalid_request'),
  ];
  check('for a reviewed app every other problem goes back to its registered address as an error (RFC 6749 §4.1.2.1) with iss: response_type, no state, no PKCE, plain PKCE, no method, a malformed challenge, no openid, a repeated parameter, a request object, a bad max_age',
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
  check('prompt=none signed out answers a reviewed app login_required at once, with the state — nothing is shown', pn.status === 302 && pnU.searchParams.get('error') === 'login_required' && pnU.searchParams.get('state') === 'pn-1', pn.status + ' ' + pn.loc);
  reviewedSet(PUB, false);

  /* ═══ 7. the consent page ═══ */
  const ALL = ['send.handle', 'send.picture', 'send.id', 'send.power', 'send.boost', 'send.verified', 'offline_access'];
  const pkA = pkce();
  const cp = await req('GET', authzPath(PUB, { scopes: ALL, challenge: pkA.challenge, state: 'flow-1', nonce: 'n-0S6_WzA2Mj' }), { cookie: alice.cookie });
  const H = cp.text, sendNo = aliceRow().send_no;
  check('the consent page names the app, its website, the host it sends you back to, and "Not reviewed by Just Send It"', cp.status === 200 && /Send Racer/.test(H) && /href="https:\/\/racer\.example" target="_blank" rel="noopener noreferrer nofollow"/.test(H) && /<code>racer\.example<\/code>/.test(H) && /Not reviewed by Just Send It/.test(H), cp.status);
  check('  ...one box per scope asked for, each with the member\'s own value in plain words',
    /Your handle: @__oi_alice__/.test(H) && new RegExp('Your Send ID: #' + sendNo + '<').test(H) && /the same number in every app you share it with, so apps can recognise you across each other/.test(H)
    && /Your Send Power: 4,321 · level \d+ · /.test(H) && /Your Send Boost: 2\.5×/.test(H) && /made of how much \$SEND and \$GWC your wallets hold[^<]*the app can estimate your holdings from it/.test(H) && !/never what it is made of/.test(H)
    && /your exact Send Power is public on your Send Wall and the leaderboards next to your handle, so the app can find your handle by it/.test(H) && /it is public there next to your handle, so the app can find your handle by it/.test(H) && /Whether your wallet passed the holder check: yes/.test(H) && /not which wallet, and not how much it holds/.test(H)
    && /Keep these up to date for 30 days/.test(H) && (H.match(/name="scope"/g) || []).length === 7);
  check('  ...nothing is ticked for the member: what they leave unticked is not shared', !/name="scope" value="[^"]+" checked/.test(H) && /Nothing is ticked for you/.test(H));
  check('  ...the ID that is always shared is said to be different in every app; what is never shared is listed; what the site keeps is said', /Every app gets a different one, so apps cannot match you up by it/.test(H) && /Never shared with any app:<\/b> your email, your wallets, your IP address and your sign-in history\. Your holdings, OG tier and communities are not sent as such, but your Send Boost, if you tick it, is made from them/.test(H)
    && /Leaving your handle unticked keeps it out of what is sent, but your Send Power and your picture are public on your Send Wall next to it, and your Send ID can lead back to it \(see its box\)\./.test(H) && /No log of when or how you use Send Racer/.test(H)
    && /Send IDs go in the order members joined, and when each member joined is public on their Send Wall, so the app can narrow down who you are by it and may find your handle/.test(H));
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
  const again = await tokenReq({ grant_type: 'authorization_code', code: code1, redirect_uri: PUB.redirect, code_verifier: pkA.verifier, client_id: PUB.clientId });
  check('  ...a wrong verifier does not use the code up (whoever holds a code without its verifier cannot spend it); the right one then works, once',
    after.status === 200 && !!(after.j && after.j.access_token) && again.status === 400 && again.j.error === 'invalid_grant' && /already used/.test(again.j.error_description), after.status + ' ' + again.text);
  // a fresh code for the main flow (alice has answered for these scopes, so the page is skipped)
  const c2 = await getCode(alice, PUB, { scopes: ALL, nonce: 'n-0S6_WzA2Mj', state: 'flow-2' });
  check('a second sign-in for the same scopes skips the page: straight back with a code (the member already answered)', c2.first.status === 302 && !!c2.code && c2.gotState === 'flow-2', c2.first.status + ' ' + c2.first.loc);
  const T1 = await exchange(PUB, c2);
  const tok = T1.j || {};
  check('the token endpoint answers access_token (opaque), Bearer, 3600 s, an id_token, a refresh_token (offline_access was ticked) and the granted scope', T1.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(tok.access_token) && tok.token_type === 'Bearer' && tok.expires_in === 3600 && typeof tok.id_token === 'string' && /^[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$/.test(tok.refresh_token || '')
    && tok.scope === 'openid send.handle send.id send.power send.boost send.verified offline_access', T1.text.slice(0, 300));
  check('  ...no-store, CORS for any origin and never with credentials', /no-store/.test(T1.h.get('cache-control')) && T1.h.get('access-control-allow-origin') === '*' && !T1.h.get('access-control-allow-credentials') && T1.h.get('x-frame-options') === 'DENY');
  check('  ...the tokens are 256 random bits and stored only as SHA-256', b64dec(tok.access_token).length === 32 && /^[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$/.test(tok.refresh_token || '') && b64dec(tok.refresh_token.split('.')[1]).length === 32 && !!db.prepare("SELECT 1 FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'").get(sha(tok.access_token)) && !!db.prepare("SELECT 1 FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'").get(sha(tok.refresh_token))
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
  check('  ...iss, aud = the client ID, iat now, exp 10 minutes on, no auth_time (the app sent neither max_age nor prompt=login: nothing read off the session goes out), the nonce echoed, at_hash for the access token', IDP.iss === BASE && IDP.aud === PUB.clientId && Math.abs(IDP.iat - t0) <= 5 && IDP.exp - IDP.iat === 600 && !('auth_time' in IDP) && IDP.nonce === 'n-0S6_WzA2Mj'
    && IDP.at_hash === b64url(crypto.createHash('sha256').update(tok.access_token).digest().subarray(0, 16)), JSON.stringify(IDP));
  const A = aliceRow();
  check('  ...the claims are the consented ones, with the values in the database: handle, profile, Send ID, Send Power, level, title, Boost (the total), verified — and not the picture, which was not ticked',
    keySet(IDP) === 'at_hash,aud,exp,iat,iss,nonce,preferred_username,profile,send_boost,send_id,send_level,send_power,send_title,send_verified,sub'
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
  check('userinfo answers the current values of the consented claims, with the same pairwise sub, and names the app the token was issued to (aud, client_id)', UI.status === 200 && UI.j.sub === IDP.sub && keySet(UI.j) === 'aud,client_id,preferred_username,profile,send_boost,send_id,send_level,send_power,send_title,send_verified,sub' && UI.j.send_power === 4321 && UI.j.aud === PUB.clientId && UI.j.client_id === PUB.clientId
    && UI.h.get('access-control-allow-origin') === '*' && !UI.h.get('access-control-allow-credentials') && /no-store/.test(UI.h.get('cache-control')), JSON.stringify(UI.j));
  db.prepare('UPDATE users SET points = 9999 WHERE id = ?').run(alice.id);
  const UI2 = await userinfo(tok.access_token, { method: 'POST' });
  check('  ...live: Send Power changed is read as it is now (GET or POST)', UI2.status === 200 && UI2.j.send_power === 9999, JSON.stringify(UI2.j));
  db.prepare('UPDATE users SET points = 4321 WHERE id = ?').run(alice.id);
  const tablesNow = () => ['oauth_tokens', 'oauth_codes', 'oauth_consents', 'oauth_clients'].map((t) => sha(JSON.stringify(db.prepare('SELECT * FROM ' + t + ' ORDER BY 1').all()))).join(',');
  const rowsBefore = tablesNow();
  const consBefore = JSON.stringify(db.prepare('SELECT * FROM oauth_consents WHERE user_id = ?').all(alice.id)), tokBefore = JSON.stringify(db.prepare('SELECT * FROM oauth_tokens WHERE user_id = ? ORDER BY token_hash').all(alice.id));
  for (let i = 0; i < 3; i++) await userinfo(tok.access_token);
  check('  ...and a userinfo call writes nothing down: no row added or changed anywhere (no usage log)', rowsBefore === tablesNow()
    && consBefore === JSON.stringify(db.prepare('SELECT * FROM oauth_consents WHERE user_id = ?').all(alice.id)) && tokBefore === JSON.stringify(db.prepare('SELECT * FROM oauth_tokens WHERE user_id = ? ORDER BY token_hash').all(alice.id)));
  const cols = Object.fromEntries(['oauth_clients', 'oauth_consents', 'oauth_codes', 'oauth_tokens', 'oauth_keys'].map((t) => [t, db.prepare('PRAGMA table_info(' + t + ')').all().map((c) => c.name)]));
  check('  ...and no table of it has a place for an IP, a device, a browser or a log of use', Object.values(cols).flat().every((c) => !/(^|_)(ip|ips|ip_idx|agent|ua|device|seen|last_seen|log|uses|use_count|last_use)(_|$)/i.test(c)), JSON.stringify(cols));
  const noTok = await userinfo(null), cookieOnly = await userinfo(null, { headers: { Cookie: alice.cookie } });
  const inQuery = await fetch(BASE + '/oauth/userinfo?access_token=' + tok.access_token, { headers: { 'X-Forwarded-For': nextIp() } });
  const badTok = await userinfo('not-a-live-token');
  check('  ...without a Bearer token it is 401 with WWW-Authenticate — a session cookie is not a token, and neither is ?access_token=', noTok.status === 401 && /Bearer/.test(noTok.h.get('www-authenticate') || '') && cookieOnly.status === 401 && inQuery.status === 401);
  check('  ...RFC 6750 §3.1: a request with no credentials at all is challenged without an error code; one with a bad token is told invalid_token',
    /^Bearer realm="[^"]+"$/.test(noTok.h.get('www-authenticate') || '') && /^Bearer realm="[^"]+", error="invalid_token"$/.test(badTok.h.get('www-authenticate') || '') && badTok.status === 401, noTok.h.get('www-authenticate') + ' | ' + badTok.h.get('www-authenticate'));
  check('no session cookie ever reaches an app: none set by the token endpoint, none in any token, and the token endpoint ignores cookies', !(T1.h.getSetCookie ? T1.h.getSetCookie() : []).length && !tok.id_token.includes(alice.sid) && tok.access_token !== alice.sid
    && (await tokenReq({ grant_type: 'refresh_token', refresh_token: 'x' }, { headers: { Cookie: alice.cookie } })).status === 401);

  /* ═══ 10. refresh: rotating, the chain revoked on reuse ═══ */
  const rt0Row = db.prepare('SELECT * FROM oauth_tokens WHERE token_hash = ?').get(sha(tok.refresh_token));
  const R1 = await tokenReq({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: PUB.clientId });
  const r1 = R1.j || {};
  check('a refresh token gets a new access token, a NEW refresh token and a fresh id_token (no nonce) with the same sub', R1.status === 200 && r1.access_token && r1.refresh_token && r1.refresh_token !== tok.refresh_token && r1.access_token !== tok.access_token && jwtParts(r1.id_token).payload.sub === IDP.sub && !('nonce' in jwtParts(r1.id_token).payload), R1.text.slice(0, 200));
  const rtRow = db.prepare('SELECT * FROM oauth_tokens WHERE token_hash = ?').get(sha(r1.refresh_token)), rt0 = db.prepare('SELECT * FROM oauth_tokens WHERE token_hash = ?').get(sha(tok.refresh_token));
  check('  ...rotation never extends the chain: the new refresh token ends when the first did, 30 days from the sign-in, and names the same chain', rtRow && rt0Row && rtRow.expires_at === rt0Row.expires_at && Math.abs(rt0Row.expires_at - rt0Row.created_at - 30 * 864e5) < 1000
    && r1.refresh_token.split('.')[0] === tok.refresh_token.split('.')[0] && rtRow.grant_id === r1.refresh_token.split('.')[0]);
  check('  ...and keeps no timeline: the used refresh token is not kept at all (no spent row to count), and every refresh token of the chain carries the chain\'s start as its date, not its own',
    !rt0 && rtRow.created_at === rt0Row.created_at && rtRow.used_at == null && db.prepare("SELECT COUNT(*) n FROM oauth_tokens WHERE grant_id = ? AND kind = 'refresh'").get(rtRow.grant_id).n === 1, JSON.stringify({ gone: !rt0, c0: rt0Row && rt0Row.created_at, c1: rtRow && rtRow.created_at }));
  const narrow = await tokenReq({ grant_type: 'refresh_token', refresh_token: r1.refresh_token, client_id: PUB.clientId, scope: 'openid send.handle send.picture' });
  check('  ...a refresh can narrow the scopes but never add one (the picture was not granted)', narrow.status === 400 && narrow.j.error === 'invalid_scope', narrow.text);
  const R2 = await tokenReq({ grant_type: 'refresh_token', refresh_token: r1.refresh_token, client_id: PUB.clientId });
  const accessKept = db.prepare("SELECT COUNT(*) n FROM oauth_tokens WHERE grant_id = ? AND kind = 'access'").get(rtRow.grant_id).n;
  const uiPrev = await userinfo(r1.access_token), uiOld = await userinfo(tok.access_token);
  check('  ...a chain holds at most two access tokens: after two refreshes the newest and the one it replaced work (the replaced one keeps its hour), the oldest has ended', R2.status === 200 && accessKept === 2 && uiPrev.status === 200 && uiOld.status === 401, accessKept + ' ' + uiPrev.status + ' ' + uiOld.status);
  const reuse = await tokenReq({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: PUB.clientId });
  check('reusing an old refresh token (two rotations back: it is no longer stored, but it names its chain) is refused and revokes the whole chain: the newest refresh and access tokens die with it', R2.status === 200 && reuse.status === 400 && reuse.j.error === 'invalid_grant' && /already used/.test(reuse.j.error_description)
    && (await tokenReq({ grant_type: 'refresh_token', refresh_token: R2.j.refresh_token, client_id: PUB.clientId })).status === 400 && (await userinfo(R2.j.access_token)).status === 401 && (await userinfo(tok.access_token)).status === 401, reuse.text);
  const otherApp = await getCode(alice, TWO, { scopes: ['send.handle', 'offline_access'], tick: ['send.handle', 'offline_access'] });
  const TO = await exchange(TWO, otherApp);
  const crossRt = await tokenReq({ grant_type: 'refresh_token', refresh_token: TO.j && TO.j.refresh_token, client_id: PUB.clientId });
  const crossOld = await tokenReq({ grant_type: 'refresh_token', refresh_token: (TO.j && TO.j.refresh_token || '').split('.')[0] + '.' + b64url(crypto.randomBytes(32)), client_id: PUB.clientId });
  check('  ...a refresh token presented by another app is refused as none of ours, and nothing is done to it: its own app\'s tokens still work (RFC 6749 §4.1.3, as for codes)', TO.status === 200 && crossRt.status === 400 && crossRt.j.error === 'invalid_grant' && /not one of ours/.test(crossRt.j.error_description)
    && crossOld.status === 400 && /not one of ours/.test(crossOld.j.error_description) && (await userinfo(TO.j.access_token)).status === 200 && (await tokenReq({ grant_type: 'refresh_token', refresh_token: TO.j.refresh_token, client_id: TWO.clientId })).status === 200, crossRt.text + ' ' + crossOld.text);

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
  const T6own = await exchange(PUB, c6);
  check('  ...and the code belongs to the app it was issued to: presented by another app it is answered as none of ours and left alone — its own app then swaps it', T6.status === 400 && T6.j.error === 'invalid_grant' && /not one of ours/.test(T6.j.error_description) && T6own.status === 200, T6.text + ' ' + T6own.status);
  // a code that leaked (they travel in the callback URL): presented under ANY other public client_id, with no verifier, it neither burns the code nor revokes what its own app was given
  const cLeak = await getCode(alice, CONF, { scopes: ['send.handle'], tick: ['send.handle'] }), TLeak = await exchange(CONF, cLeak);
  const leakAfter = await tokenReq({ grant_type: 'authorization_code', code: cLeak.code, redirect_uri: 'x', code_verifier: 'x', client_id: TWO.clientId });
  const cLeak2 = await getCode(alice, CONF, { scopes: ['send.handle'] });
  const leakFirst = await tokenReq({ grant_type: 'authorization_code', code: cLeak2.code, redirect_uri: 'x', code_verifier: 'x', client_id: TWO.clientId });
  const leakFirstPub = await tokenReq({ grant_type: 'authorization_code', code: cLeak2.code, redirect_uri: CONF.redirect, code_verifier: 'x'.repeat(43), client_id: CONF.clientId, client_secret: CONF.secret });
  const TLeak2 = await exchange(CONF, cLeak2);
  check('a leaked code presented under another app\'s client_id, used or not, changes nothing: the real app\'s tokens still work and its own exchange still goes through (a wrong verifier does not spend it either)',
    TLeak.status === 200 && leakAfter.status === 400 && /not one of ours/.test(leakAfter.j.error_description) && (await userinfo(TLeak.j.access_token)).status === 200
    && leakFirst.status === 400 && leakFirstPub.status === 400 && /PKCE/.test(leakFirstPub.j.error_description) && TLeak2.status === 200, [TLeak.status, leakAfter.text, leakFirst.status, leakFirstPub.status, TLeak2.status].join(' '));
  const c7 = await getCode(alice, PUB, { scopes: ALL });
  const T7 = await tokenReq({ grant_type: 'authorization_code', code: c7.code, redirect_uri: PUB.redirect, client_id: PUB.clientId });
  check('  ...a code sent with no code_verifier is refused', T7.status === 400 && T7.j.error === 'invalid_grant', T7.text);
  const dup = await tokenReq('grant_type=authorization_code&code=a&code=b&client_id=' + PUB.clientId);
  const json = await fetch(BASE + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp() }, body: JSON.stringify({ grant_type: 'authorization_code' }) });
  const gtBad = await tokenReq({ grant_type: 'password', username: 'a', password: 'b', client_id: PUB.clientId });
  const gtNone = await tokenReq({ client_id: PUB.clientId, code: 'x' });
  check('the token endpoint takes a form body only, no repeated parameter, and the two grant types only', dup.status === 400 && dup.j.error === 'invalid_request' && json.status === 400 && gtBad.status === 400 && gtBad.j.error === 'unsupported_grant_type');
  check('  ...and a request with no grant_type at all is invalid_request (RFC 6749 §5.2: a missing parameter), not unsupported_grant_type', gtNone.status === 400 && gtNone.j.error === 'invalid_request' && /grant_type is required/.test(gtNone.j.error_description), gtNone.text);
  const spentCode = db.prepare('SELECT used_at FROM oauth_codes WHERE code_hash = ?').get(sha(c3.code));
  check('  ...a spent code is only flagged (used_at = 1), with no time of its use', spentCode && spentCode.used_at === 1, JSON.stringify(spentCode));

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
  const rvBadBasic = await tokenReq({ token: 'x' }, { path: '/oauth/revoke', basic: [CONF.clientId, 'not-the-secret'] }), tkBadBasic = await tokenReq({ grant_type: 'refresh_token', refresh_token: 'x' }, { basic: [CONF.clientId, 'not-the-secret'] });
  check('  ...a wrong secret sent by Basic is 401 invalid_client with the Basic challenge (RFC 6749 §5.2), at revoke as at the token endpoint', rvBadBasic.status === 401 && rvBadBasic.j.error === 'invalid_client' && /^Basic realm="/.test(rvBadBasic.h.get('www-authenticate') || '')
    && /^Basic realm="/.test(tkBadBasic.h.get('www-authenticate') || ''), rvBadBasic.status + ' ' + rvBadBasic.h.get('www-authenticate'));

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
  check('ticking one box of four: the token and userinfo carry that one only, the scope says so, and no refresh token (offline_access was not ticked)', TF.status === 200 && TF.j.scope === 'openid send.handle' && !TF.j.refresh_token && keySet(uF.j) === 'aud,client_id,preferred_username,profile,sub'
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
  reviewedSet(PUB, true);
  const pnNo = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'none', state: 'pn-3' }), { cookie: carol.cookie });
  const pnOut = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'none', state: 'pn-3' }));
  const pnAns = (r) => { const u = locOf(r); return u ? [u.searchParams.get('error'), u.searchParams.get('error_description'), u.searchParams.get('state')].join('|') : String(r.status); };
  check('  ...and a signed-in member who has not answered yet is answered EXACTLY as a signed-out visitor (login_required, the same words): before Allow an app learns nothing, not even that a Send account is signed in on the browser (a reviewed app)',
    pnNo.status === 302 && locOf(pnNo).searchParams.get('error') === 'login_required' && pnAns(pnNo) === pnAns(pnOut) && locOf(pnNo).searchParams.get('state') === 'pn-3' && !/consent_required/.test(LIB.slice(LIB.indexOf('function proceed('), LIB.indexOf('function authorizeGet('))), pnAns(pnNo) + ' / ' + pnAns(pnOut));
  reviewedSet(PUB, false);
  const pnNoU = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'none', state: 'pn-4' }), { cookie: carol.cookie }), pnL = linkBack(pnNoU);
  check('  ...(an app nobody reviewed gets that answer only by the member\'s press on the page that says so)', pnNoU.status === 400 && !pnNoU.loc && pnL && pnL.u.searchParams.get('error') === 'login_required' && pnL.u.searchParams.get('state') === 'pn-4' && /You have not allowed Send Racer yet/.test(pnNoU.text), pnNoU.status + ' ' + pnNoU.loc);
  const consentAt = db.prepare('SELECT updated_at FROM oauth_consents WHERE user_id = ? AND client_id = ?').get(alice.id, PUB.clientId).updated_at;
  const pc = await req('GET', authzPath(PUB, { scopes: ALL, challenge: pkce().challenge, prompt: 'consent' }), { cookie: alice.cookie });
  check('prompt=consent shows the page again even with an answer on file — and every box starts unticked, as the page and the docs say', pc.status === 200 && (pc.text.match(/name="scope"/g) || []).length === 7 && !/name="scope" value="[^"]+" checked/.test(pc.text) && /Nothing is ticked for you/.test(pc.text));
  await sleep(5);
  const pcSame = await post([['pending', field(pc.text, 'pending')], ['csrf', field(pc.text, 'csrf')], ['decision', 'allow'], ...['send.handle', 'send.id', 'send.power', 'send.boost', 'send.verified', 'offline_access'].map((x) => ['scope', x])]);
  check('  ...and answering it the same way again changes nothing on file: the consent\'s "last changed" stays (it is never a "last signed in")', pcSame.status === 302 && !!locOf(pcSame).searchParams.get('code')
    && db.prepare('SELECT updated_at FROM oauth_consents WHERE user_id = ? AND client_id = ?').get(alice.id, PUB.clientId).updated_at === consentAt, pcSame.status + ' ' + pcSame.loc);
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
  await api('/api/admin/oauth/apps/' + PUB.clientId, { method: 'POST', cookie: admin.cookie, body: { reviewed: true } });
  const descEdit = await api('/api/oauth/apps/' + PUB.clientId, { method: 'POST', cookie: devA.cookie, body: { description: 'Karts, now with boost pads.' } });
  check('  ...and so does an edit to its description alone (members read it on the consent page, right under the review)', descEdit.status === 200 && descEdit.j.reviewCleared === true && descEdit.j.app.reviewed === false, descEdit.text.slice(0, 200));
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
  check('a restricted account cannot sign in to apps: its tokens die (userinfo 401, refresh refused, the rows gone) and its consents with them (as a revoke ends them), the page says why without a code',
    dUi.status === 401 && (await tokenReq({ grant_type: 'refresh_token', refresh_token: daveTok.refresh_token, client_id: PUB.clientId })).status === 400 && !db.prepare('SELECT 1 FROM oauth_tokens WHERE user_id = ?').get(dave.id)
    && !db.prepare('SELECT 1 FROM oauth_consents WHERE user_id = ?').get(dave.id) && !!db.prepare('SELECT 1 FROM oauth_subjects WHERE user_id = ?').get(dave.id)
    && dPage.status === 403 && /read-only mode/.test(dPage.text) && !dPage.loc, dPage.status);
  // prompt=none tells an app nothing about moderation: a restricted member is answered exactly as a signed-out visitor, even by an app they once allowed
  reviewedSet(PUB, true);
  const dNone = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'none', state: 'd-1' }), { cookie: dave.cookie });
  const outNone = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'none', state: 'd-1' }));
  const sysNone = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'none', state: 'd-1' }), { cookie: mkUser('__oi_system2__', { system: true }).cookie });
  const same = (r) => { const u = locOf(r); return u ? [u.searchParams.get('error'), u.searchParams.get('error_description'), u.searchParams.get('state')].join('|') : r.status + ''; };
  reviewedSet(PUB, false);
  check('  ...and prompt=none answers a restricted (or system) account exactly as it answers a signed-out visitor — login_required, the same words — so no app learns a moderation status',
    dNone.status === 302 && same(dNone) === same(outNone) && same(sysNone) === same(outNone) && /^login_required\|/.test(same(outNone)), [same(dNone), same(outNone), same(sysNone)].join(' / '));
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
  // 4,000 userinfo requests with a token this site does not know, from one address, then 429 (sent a hundred at a time: each is counted as it arrives)
  let uiLim = 0; { let n401 = 0, n429 = 0; for (let i = 0; i < 4010; i += 100) for (const r of await Promise.all(Array.from({ length: Math.min(100, 4010 - i) }, () => userinfo('nope', { ip: NET + '22' })))) { if (r.status === 401) n401++; else if (r.status === 429) n429++; } uiLim = n401 === OL.LIMITS.uiRefused && n429 === 10 ? OL.LIMITS.uiRefused + 1 : -n401; }
  const azLim = await hammer(() => req('GET', '/oauth/authorize?client_id=x', { ip: NET + '23' }).then((r) => r.status), 130);
  const rvLim = await hammer(() => tokenReq({ token: 'x', client_id: PUB.clientId }, { ip: NET + '24', path: '/oauth/revoke' }).then((r) => r.status), 130);
  check('refused requests are rate-limited per address: 120 token requests a minute that carry nothing real, 4,000 userinfo requests with a token this site does not know, 120 sign-in pages in 10 minutes, 120 revokes a minute', tokLim === 121 && uiLim === 4001 && OL.LIMITS.uiRefused === 4000 && azLim === 121 && rvLim === 121, [tokLim, uiLim, azLim, rvLim].join(' '));

  /* ═══ 22. CORS only where it belongs ═══ */
  const azC = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge }), { cookie: alice.cookie, headers: { Origin: 'https://racer.example' } });
  const apiC = await req('GET', '/api/oauth/apps', { cookie: devA.cookie, headers: { Origin: 'https://racer.example' } });
  const preAz = await raw('OPTIONS', '/oauth/authorize', { Origin: 'https://racer.example', 'Access-Control-Request-Method': 'POST' });
  check('CORS only on discovery, the JWKS, token, userinfo and revoke: never on the authorize page, its preflight, or the site\'s own API', !azC.h.get('access-control-allow-origin') && !apiC.h.get('access-control-allow-origin') && !preAz.h['access-control-allow-origin'], [azC.h.get('access-control-allow-origin'), apiC.h.get('access-control-allow-origin'), preAz.status].join(' '));
  const framed = await Promise.all([req('POST', '/oauth/token', { form: {} }), userinfo(null), req('POST', '/oauth/revoke', { form: {} }), req('GET', '/oauth/authorize?client_id=x')]);
  check('every answer under /oauth/ is unframeable (X-Frame-Options and frame-ancestors \'none\') and uncached', framed.every((r) => r.h.get('x-frame-options') === 'DENY' && /frame-ancestors 'none'/.test(r.h.get('content-security-policy') || '') && /no-store/.test(r.h.get('cache-control') || '')), framed.map((r) => r.status + ' ' + r.h.get('x-frame-options')).join(' | '));

  /* ═══ 23. "Confirm it's you" on a member's first Allow for an app (the owner's fold-in) ═══ */
  const confirmOf = (html) => { const m = /<fieldset class="oa-confirm" id="oa-confirm">([\s\S]*?)<\/fieldset>/.exec(html || ''); return m ? m[1] : null; };
  const fay = mkUser('__oi_fay__', { sudo: false, points: 11 }); givePassword(fay.id, 'fay-password-1');
  const fPage = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge, state: 'fay-1' }), { cookie: fay.cookie });
  const fBox = confirmOf(fPage.text);
  check('a member\'s first Allow for an app asks "Confirm it\'s you" (the site\'s own step) on the consent page: the password field this account needs, said to go to Just Send It only',
    fPage.status === 200 && /data-confirm="first"/.test(fPage.text) && fBox && /name="password" autocomplete="current-password"/.test(fBox) && !/name="code"/.test(fBox) && /first time you are letting Send Racer in/.test(fBox) && /never to Send Racer/.test(fBox), fPage.status + ' ' + (fBox || '').slice(0, 200));
  const fForm = (extra) => [['pending', field(fPage.text, 'pending')], ['csrf', field(fPage.text, 'csrf')], ['decision', 'allow'], ['scope', 'send.handle'], ...extra];
  const fNone = await post(fForm([]), { cookie: fay.cookie }), fWrong = await post(fForm([['password', 'not-it']]), { cookie: fay.cookie });
  check('  ...Allow with no proof, or the wrong password, is refused (401) on the same page, saying why, keeping what was ticked: no code, nothing saved',
    fNone.status === 401 && !fNone.loc && /class="oa-err" role="alert"/.test(fNone.text) && /name="scope" value="send\.handle" checked/.test(fNone.text) && fWrong.status === 401 && /password/.test(confirmOf(fWrong.text) || '')
    && !db.prepare('SELECT 1 FROM oauth_consents WHERE user_id = ?').get(fay.id) && !db.prepare('SELECT 1 FROM oauth_codes WHERE user_id = ?').get(fay.id), fNone.status + ' ' + fWrong.status);
  const fOk = await post(fForm([['password', 'fay-password-1']]), { cookie: fay.cookie });
  check('  ...with the right password it goes through: a code, and the consent saved', fOk.status === 302 && !!locOf(fOk).searchParams.get('code') && locOf(fOk).searchParams.get('state') === 'fay-1' && !!db.prepare('SELECT 1 FROM oauth_consents WHERE user_id = ? AND client_id = ?').get(fay.id, PUB.clientId), fOk.status + ' ' + fOk.loc);
  const fay2 = newSession(fay.id, { sudo: false });
  const fAgain = await getCode({ ...fay, ...fay2 }, PUB, { scopes: ['send.handle'], prompt: 'consent', tick: ['send.handle'] });
  check('  ...and once the app is allowed, asking again (prompt=consent) needs no second proof', fAgain.first.status === 200 && !confirmOf(fAgain.page) && !!fAgain.code, fAgain.first.status + ' ' + fAgain.r.status);
  // the reported attack: a copied session cookie (no unlocked window) lets an app of the thief's own in with one press
  const spin = await mkApp(devC, { name: 'Spin Palace', homepage: 'https://spin.example', redirectUris: ['https://spin.example/cb'], kind: 'public' });
  const SPIN = { clientId: spin.j.app.clientId, redirect: 'https://spin.example/cb' };
  const stolen = newSession(alice.id, { sudo: false });
  const sPage = await req('GET', authzPath(SPIN, { scopes: ['send.handle', 'send.id', 'send.power', 'offline_access'], challenge: pkce().challenge }), { cookie: stolen.cookie });
  const sAllow = await post([['pending', field(sPage.text, 'pending')], ['csrf', field(sPage.text, 'csrf')], ['decision', 'allow'], ...['send.handle', 'send.id', 'send.power', 'offline_access'].map((x) => ['scope', x])], { cookie: stolen.cookie });
  check('  ...so a copied session cookie cannot connect an app to the account with one press: no code, no consent, no tokens', sPage.status === 200 && !!confirmOf(sPage.text) && sAllow.status === 401 && !sAllow.loc
    && !db.prepare('SELECT 1 FROM oauth_consents WHERE user_id = ? AND client_id = ?').get(alice.id, SPIN.clientId), sPage.status + ' ' + sAllow.status + ' ' + sAllow.loc);
  const ivy = mkUser('__oi_ivy__', { sudo: false });   // no password, no two-factor, no wallet: her sign-in is her only proof
  const iPage = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge }), { cookie: ivy.cookie }), iBox = confirmOf(iPage.text);
  check('  ...an account whose only proof is signing in is asked to sign in again (a button that does it), with no password field to fill', iBox && /id="oa-again" data-tip="[^"]{8,}">Sign in again</.test(iBox) && !/name="password"/.test(iBox), (iBox || '').slice(0, 200));
  const jo = mkUser('__oi_jo__', { sudo: false });
  db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc, linked_at) VALUES (?, 'wallet', ?, 'v1:test', ?)").run(jo.id, 'oi-wallet-' + crypto.randomBytes(8).toString('hex'), Date.now() - 40 * 864e5);
  db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(Date.now() - 41 * 864e5, jo.id);
  const jPage = await req('GET', authzPath(PUB, { scopes: ['send.handle'], challenge: pkce().challenge }), { cookie: jo.cookie }), jBox = confirmOf(jPage.text);
  check('  ...and a wallet account signs with a wallet old enough to vouch: the button, the two fields it fills, and the site\'s wallet script on the page (the same signature every security change takes)',
    jBox && /id="oa-wallet" data-tip="[^"]{8,}">Sign with wallet</.test(jBox) && /name="address"/.test(jBox) && /name="signature"/.test(jBox) && /src="\/wallet\.js(\?v=[^"]+)?"/.test(jPage.text) && !/src="\/auth\.js/.test(jPage.text)
    && /purpose=manage&address=/.test(readFileSync(path.join(ROOT, 'public', 'oauth.js'), 'utf8')), (jBox || '').slice(0, 200));

  /* ═══ 24. max_age and prompt=login (OIDC Core 3.1.2.1): a fresh proof, or login_required ═══ */
  const gus = mkUser('__oi_gus__', { sudo: false, ageMs: 3 * 36e5 }); givePassword(gus.id, 'gus-password-1');
  const gPw = (page) => post([['pending', field(page, 'pending')], ['csrf', field(page, 'csrf')], ['decision', 'allow'], ['scope', 'send.handle'], ['password', 'gus-password-1']], { cookie: gus.cookie });
  const g0 = await req('GET', authzPath(TWO, { scopes: ['send.handle'], challenge: pkce().challenge }), { cookie: gus.cookie });
  await gPw(g0.text);   // his first Allow for TWO (a three-hour-old session, his password)
  // a proof opens the site's "Confirm it's you" window, which is an authentication too: shut it, so each check below sees only the old sign-in
  const shut = () => db.prepare('UPDATE sessions SET sudo_until = NULL, sudo_since = NULL WHERE token = ?').run(sha(gus.sid));
  const tAt = async (o) => { shut(); const pk = pkce(); const r = await req('GET', authzPath(TWO, { scopes: ['send.handle'], challenge: pk.challenge, ...o }), { cookie: gus.cookie }); return { r, pk }; };
  const ma0 = await tAt({ extra: { max_age: '0' } });
  check('max_age=0 with a sign-in three hours old: no code at once — the consent page asks for a fresh proof ("Confirm it\'s you", not the open window)', ma0.r.status === 200 && /data-confirm="fresh"/.test(ma0.r.text) && /asked for a fresh sign-in/.test(confirmOf(ma0.r.text) || ''), ma0.r.status + ' ' + ma0.r.loc);
  const t0s = Math.floor(Date.now() / 1000);
  const ma0ok = await gPw(ma0.r.text), ma0c = locOf(ma0ok) && locOf(ma0ok).searchParams.get('code');
  const ma0t = ma0c ? (await tokenReq({ grant_type: 'authorization_code', code: ma0c, redirect_uri: TWO.redirect, code_verifier: ma0.pk.verifier, client_id: TWO.clientId })).j : {};
  const ma0p = ma0t && ma0t.id_token ? jwtParts(ma0t.id_token).payload : {};
  check('  ...and after it, the ID token\'s auth_time is the proof\'s own time (what max_age asked about), not the old sign-in', ma0ok.status === 302 && ma0p.auth_time >= t0s - 2 && ma0p.auth_time <= t0s + 10, JSON.stringify({ s: ma0ok.status, at: ma0p.auth_time, t0s }));
  reviewedSet(TWO, true);
  const maNone = await tAt({ prompt: 'none', extra: { max_age: '60' } });
  reviewedSet(TWO, false);
  check('  ...prompt=none with a max_age the sign-in is older than answers login_required (nothing shown)', maNone.r.status === 302 && locOf(maNone.r).searchParams.get('error') === 'login_required' && !locOf(maNone.r).searchParams.get('code'), maNone.r.status + ' ' + maNone.r.loc);
  const pl = await tAt({ prompt: 'login' });
  const plNo = await post([['pending', field(pl.r.text, 'pending')], ['csrf', field(pl.r.text, 'csrf')], ['decision', 'allow'], ['scope', 'send.handle']], { cookie: gus.cookie });
  check('prompt=login asks for a fresh proof too (never just the consent page), and Allow without one is refused', pl.r.status === 200 && /data-confirm="fresh"/.test(pl.r.text) && plNo.status === 401 && !plNo.loc, pl.r.status + ' ' + plNo.status);
  const maBigT = Math.floor(Date.now() / 1000), maBig = await tAt({ extra: { max_age: '86400' } }), maBigC = locOf(maBig.r) && locOf(maBig.r).searchParams.get('code');
  const maBigP = maBigC ? jwtParts((await tokenReq({ grant_type: 'authorization_code', code: maBigC, redirect_uri: TWO.redirect, code_verifier: maBig.pk.verifier, client_id: TWO.clientId })).j.id_token).payload : {};
  const gSid = db.prepare('SELECT created_at FROM sessions WHERE token = ?').get(sha(gus.sid)).created_at;
  check('a max_age the sign-in meets: the code at once, and auth_time worked out from the request (the earliest time max_age allows, with the code\'s minute to spare), not read off the session — never later than the truth, still inside max_age', maBig.r.status === 302 && !!maBigC && Math.abs(maBigP.auth_time - (maBigT - 86400 + 60)) <= 3 && maBigP.auth_time * 1000 <= gSid && Math.floor(Date.now() / 1000) - maBigP.auth_time <= 86400, JSON.stringify({ at: maBigP.auth_time, sid: Math.floor(gSid / 1000) }));
  const gus2 = newSession(gus.id, { sudo: false, ageMs: 3 * 36e5 - 20 * 60e3 });   // a sign-in a little under three hours ago
  const maMidT = Math.floor(Date.now() / 1000), maMid = await (async () => { const pk = pkce(); const r = await req('GET', authzPath(TWO, { scopes: ['send.handle'], challenge: pk.challenge, extra: { max_age: String(3 * 3600) } }), { cookie: gus2.cookie }); return { r, pk }; })();
  const maMidC = locOf(maMid.r) && locOf(maMid.r).searchParams.get('code');
  const maMidP = maMidC ? jwtParts((await tokenReq({ grant_type: 'authorization_code', code: maMidC, redirect_uri: TWO.redirect, code_verifier: maMid.pk.verifier, client_id: TWO.clientId })).j.id_token).payload : {};
  const g2Sid = db.prepare('SELECT created_at FROM sessions WHERE token = ?').get(sha(gus2.sid)).created_at;
  check('  ...and with a sign-in just inside max_age it is the same request-made value: never later than the truth, and what an OIDC library checks at the exchange still passes', !!maMidC && Math.abs(maMidP.auth_time - (maMidT - 3 * 3600 + 60)) <= 3 && maMidP.auth_time * 1000 <= g2Sid && Math.floor(Date.now() / 1000) - maMidP.auth_time <= 3 * 3600, JSON.stringify({ s: maMid.r.status, at: maMidP.auth_time, sid: Math.floor(g2Sid / 1000) }));
  check('  ...discovery lists prompt=login now that it is honoured', D.prompt_values_supported && (await req('GET', '/.well-known/openid-configuration')).j.prompt_values_supported.includes('login'));

  /* ═══ 25. auth_time is not a fingerprint: one session, two apps from two developers ═══ */
  const kim = mkUser('__oi_kim__');
  const kSid = db.prepare('SELECT created_at FROM sessions WHERE token = ?').get(sha(kim.sid)).created_at;
  const k1 = jwtParts((await exchange(PUB, await getCode(kim, PUB, { scopes: ['send.handle'], tick: ['send.handle'] }))).j.id_token).payload;
  const k2 = jwtParts((await exchange(SPIN, await getCode(kim, SPIN, { scopes: ['send.handle'], tick: ['send.handle'] }))).j.id_token).payload;
  check('two apps signed in from one session get different subs and, asking nothing of the sign-in time, no auth_time at all: nothing read off the session, which they could match a member up by',
    k1.sub !== k2.sub && !('auth_time' in k1) && !('auth_time' in k2) && kSid > 0, JSON.stringify({ a: k1.auth_time, b: k2.auth_time, s: Math.floor(kSid / 1000) }));

  /* ═══ 26. a password change, "end other sessions" and two-factor off: every app's grant ends ═══ */
  const credEvents = [
    ['"end other sessions"', (u) => api('/api/auth/sessions', { method: 'DELETE', cookie: u.cookie })],
    ['a password change', (u) => api('/api/account/password', { method: 'POST', cookie: u.cookie, body: { password: 'a-new-password-2' } })],
    ['two-factor turned off', (u) => api('/api/2fa/disable', { method: 'POST', cookie: u.cookie, body: {} })],
  ];
  for (const [what, act] of credEvents) {
    const m = mkUser('__oi_cred_' + credEvents.findIndex((x) => x[0] === what) + '__', { points: 900 }); givePassword(m.id, 'cred-password-1');
    const thief = { ...m, ...newSession(m.id) };   // a session the member is about to shut out, which let two apps in
    const tp = (await exchange(PUB, await getCode(thief, PUB, { scopes: ['send.handle', 'send.power', 'offline_access'], tick: ['send.handle', 'send.power', 'offline_access'] }))).j;
    const tc = (await exchange(CONF, await getCode(thief, CONF, { scopes: ['send.handle', 'offline_access'], tick: ['send.handle', 'offline_access'] }))).j;
    const subBefore = db.prepare('SELECT sub FROM oauth_subjects WHERE user_id = ? AND client_id = ?').get(m.id, PUB.clientId);
    const r = await act(m);
    const after = [await tokenReq({ grant_type: 'refresh_token', refresh_token: tp.refresh_token, client_id: PUB.clientId }), await tokenReq({ grant_type: 'refresh_token', refresh_token: tc.refresh_token, client_id: CONF.clientId, client_secret: CONF.secret }),
      await userinfo(tp.access_token), await userinfo(tc.access_token)].map((x) => x.status);
    const left = ['oauth_consents', 'oauth_tokens', 'oauth_codes'].map((t) => db.prepare('SELECT COUNT(*) n FROM ' + t + ' WHERE user_id = ?').get(m.id).n);
    const back2 = await getCode(m, PUB, { scopes: ['send.handle'], tick: ['send.handle'] });
    const subAfter = db.prepare('SELECT sub FROM oauth_subjects WHERE user_id = ? AND client_id = ?').get(m.id, PUB.clientId);
    check(what + ' ends every app\'s grant: the refresh tokens are refused, userinfo answers 401, no consent, code or token is left — and the next sign-in asks again, under the same private ID',
      r.status === 200 && r.j.appsSignedOut === 2 && after.join(' ') === '400 400 401 401' && left.join(' ') === '0 0 0' && back2.first.status === 200 && !!back2.code && subBefore && subAfter && subBefore.sub === subAfter.sub,
      JSON.stringify({ st: r.status, j: r.j, after, left, again: back2.first.status }));
  }

  /* ═══ 27. the rate limits: per app first, generous per address, and nobody spends an app's budget with junk ═══ */
  const ccL = await getCode(alice, CONF, { scopes: ['send.handle'] });
  const oneIp = NET + '31';
  let confHit = 0; for (let i = 0; i < 130; i++) { const r = await tokenReq({ grant_type: 'authorization_code', code: 'junk-' + i, redirect_uri: CONF.redirect, code_verifier: 'v'.repeat(43) }, { ip: oneIp, basic: [CONF.clientId, CONF.secret], headers: { 'User-Agent': 'SendDiamondForge/1.0 (+https://sendy.gg)' } }); if (r.status === 429) { confHit = i + 1; break; } }
  const confReal = await tokenReq({ grant_type: 'authorization_code', code: ccL.code, redirect_uri: CONF.redirect, code_verifier: ccL.verifier }, { ip: oneIp, basic: [CONF.clientId, CONF.secret] });
  check('a server app that proved its secret is limited by its own budget (600 a minute), not by the 120 a minute one address may have refused: 130 from one address, then a real exchange works',
    confHit === 0 && confReal.status === 200 && !!confReal.j.access_token, confHit + ' ' + confReal.status + ' ' + confReal.text.slice(0, 120));
  const ccP = await getCode(alice, PUB, { scopes: ['send.handle'] });
  let junk = 0;
  await Promise.all([0, 1, 2, 3, 4, 5].map(async (k) => { for (let i = 0; i < 100; i++) { const r = await tokenReq({ grant_type: 'authorization_code', code: 'junk', client_id: PUB.clientId, redirect_uri: PUB.redirect, code_verifier: 'v'.repeat(43) }, { ip: NET + (40 + k) }); if (r.status === 400) junk++; } }));
  const pubReal = await exchange(PUB, ccP, {}, { ip: NET + '47' });
  check('600 junk exchanges naming a public app (its client_id is public) from six addresses do not lock it out: the member\'s real one goes through', junk === 600 && pubReal.status === 200 && !!pubReal.j.access_token, junk + ' ' + pubReal.status + ' ' + pubReal.text.slice(0, 120));
  check('  ...a server app\'s limits are its own with the per-address caps above them as backstops (token, userinfo, handles), a browser app has no shared minute, and /developers says so',
    OL.LIMITS.tokenAddr > OL.LIMITS.tokenApp && OL.LIMITS.uiAddr >= OL.LIMITS.uiApp && OL.LIMITS.handlesAddr > OL.LIMITS.handlesApp && /'oa-ui-client:' \+ cid/.test(LIB) && /'oa-handles-client:' \+ c\.client_id/.test(LIB)
    && /600 exchanges and refreshes that go through/.test(readFileSync(path.join(ROOT, 'public', 'developers.html'), 'utf8')) && /A browser app has no shared minute at all/.test(readFileSync(path.join(ROOT, 'public', 'developers.html'), 'utf8')));

  /* ═══ 28. a token says which app it was issued to: userinfo's aud, and introspection for an app's own tokens ═══ */
  const subst = (await exchange(PUB, await getCode(alice, PUB, { scopes: ['send.handle', 'send.id', 'offline_access'] }))).j;
  const ui28 = await userinfo(subst.access_token);
  const introOwn = await tokenReq({ token: subst.access_token, client_id: PUB.clientId }, { path: '/oauth/introspect' });
  const introOther = await tokenReq({ token: subst.access_token }, { path: '/oauth/introspect', basic: [CONF.clientId, CONF.secret] });
  const introUnknown = await tokenReq({ token: 'nothing' }, { path: '/oauth/introspect', basic: [CONF.clientId, CONF.secret] });
  check('a backend handed another app\'s token for the same member can tell: userinfo names the app it was issued to (aud, client_id)', ui28.status === 200 && ui28.j.aud === PUB.clientId && ui28.j.client_id === PUB.clientId, JSON.stringify(ui28.j));
  check('  ...and introspection (RFC 7662, in discovery) describes an app\'s own token — and answers another app\'s exactly as an unknown one, { active: false }',
    D.introspection_endpoint === BASE + '/oauth/introspect' && introOwn.status === 200 && introOwn.j.active === true && introOwn.j.client_id === PUB.clientId && introOwn.j.aud === PUB.clientId && introOwn.j.sub === ui28.j.sub && introOwn.j.token_type === 'Bearer'
    && introOther.status === 200 && JSON.stringify(introOther.j) === '{"active":false}' && JSON.stringify(introUnknown.j) === '{"active":false}' && introOwn.h.get('access-control-allow-origin') === '*', JSON.stringify([introOwn.j, introOther.j]));

  /* ═══ 29. what the consent page shows about an app cannot pass for the site ═══ */
  const devE = mkUser('__oi_dev_e__');
  const lookalikes = [];
  const tryLook = async (why, body) => { const r = await mkApp(devE, { name: 'Clean Name', homepage: 'https://clean.example', redirectUris: ['https://clean.example/cb'], kind: 'public', ...body }, nextIp()); if (r.status !== 400) lookalikes.push(why + ' → ' + r.status + ' ' + r.text.slice(0, 80)); return r; };
  await tryLook('a Cyrillic е in the name', { name: 'Just Sеnd It' });
  await tryLook('a Cyrillic ѕ in the name', { name: 'Juѕt Send It' });
  await tryLook('the button\'s own words', { name: 'Sign in with Send' });
  await tryLook('the account\'s', { name: 'Send Account Login' });
  await tryLook('the first app\'s name', { name: 'Sendy\'s Metaverse' });
  await tryLook('staff words', { name: 'Official Send Support' });
  await tryLook('an admin', { name: 'Admin Rewards' });
  await tryLook('a homograph homepage', { homepage: 'https://ѕendrh.com' });
  await tryLook('the site\'s own address as homepage', { homepage: 'https://localhost/about' });
  await tryLook('a homepage spelling the site\'s name', { homepage: 'https://sendrh.com.evil.example' });
  await tryLook('the site\'s name in the description', { description: 'The official Just Send It rewards app. After Allow, paste your recovery phrase.' });
  await tryLook('its other name in the description', { description: 'Run by SendRH.' });
  await tryLook('an international redirect host', { redirectUris: ['https://例え.jp/cb'] });
  await tryLook('a Unicode redirect path', { redirectUris: ['https://racer.example/路径'] });
  check('registration refuses every way to pass for the site: lookalike letters, its button and account words, the first app\'s name, staff words, a homograph or site homepage, its name in a description — and any redirect address not in plain ASCII', lookalikes.length === 0, lookalikes.join(' | '));
  const fine = await mkApp(devE, { name: 'Supportive Racers', homepage: 'https://xn--rcer-loa.example/play', redirectUris: ['https://xn--rcer-loa.example/cb'], kind: 'public', description: 'Just send your kart flying.' }, nextIp());
  const FINE = fine.j && fine.j.app ? { clientId: fine.j.app.clientId, redirect: 'https://xn--rcer-loa.example/cb' } : null;
  const finePage = FINE ? await req('GET', authzPath(FINE, { scopes: ['send.handle'], challenge: pkce().challenge }), { cookie: alice.cookie }) : { text: '' };
  check('  ...while ordinary words stay fine (a "supportive" name, "just send" in a sentence), and the page shows the homepage as the address it is (an xn-- name as xn--), under "Its developer says"',
    fine.status === 200 && />xn--rcer-loa\.example\/play</.test(finePage.text) && /<dt>Its developer says<\/dt><dd>Just send your kart flying\.<\/dd>/.test(finePage.text), fine.status + ' ' + fine.text.slice(0, 160));

  /* ═══ 30. a registered address no answer can be written to (from before plain ASCII was required) ═══ */
  const old = await mkApp(devE, { name: 'Old Kart', homepage: 'https://oldkart.example', redirectUris: ['https://oldkart.example/cb'], kind: 'public' }, nextIp());
  const OLD = { clientId: old.j.app.clientId, redirect: 'https://例え.jp/cb' };
  db.prepare('UPDATE oauth_clients SET redirect_uris = ?, reviewed_at = ? WHERE client_id = ?').run(JSON.stringify([OLD.redirect]), Date.now(), OLD.clientId);
  const oldA = await req('GET', authzPath(OLD, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'none' }), { cookie: alice.cookie });
  const oldB = await req('GET', authzPath(OLD, { scopes: ['send.handle'], challenge: pkce().challenge, method: 'plain' }), { cookie: alice.cookie });
  check('an app whose registered address is not plain ASCII gets an error page, never a server error: nothing saved, nobody sent anywhere', oldA.status === 400 && oldB.status === 400 && !oldA.loc && /cannot send you back to/.test(oldA.text)
    && !db.prepare('SELECT 1 FROM oauth_consents WHERE client_id = ?').get(OLD.clientId) && !db.prepare('SELECT 1 FROM oauth_codes WHERE client_id = ?').get(OLD.clientId), oldA.status + ' ' + oldB.status);

  /* ═══ 31. an app the admin switched off stays switched off ═══ */
  await api('/api/admin/oauth/apps/' + SPIN.clientId, { method: 'POST', cookie: admin.cookie, body: { disabled: true, reason: 'phishing description' } });
  const delOff = await api('/api/oauth/apps/' + SPIN.clientId, { method: 'DELETE', cookie: devC.cookie });
  const newOff = await api('/api/oauth/apps', { method: 'POST', cookie: devC.cookie, ip: nextIp(), body: { name: 'Spin Palace Two', homepage: 'https://spin.example', redirectUris: ['https://spin.example/cb'], kind: 'public' } });
  const sameHost = await mkApp(devE, { name: 'Wheel Town', homepage: 'https://wheel.example', redirectUris: ['https://spin.example/again'], kind: 'public' }, nextIp());
  const offRow = db.prepare('SELECT disabled_reason FROM oauth_clients WHERE client_id = ?').get(SPIN.clientId);
  check('an app switched off by the admin cannot be deleted by its developer (its record and reason stay), its developer cannot register another meanwhile, and nobody can reuse its address\'s host',
    delOff.status === 409 && offRow && offRow.disabled_reason === 'phishing description' && newOff.status === 409 && sameHost.status === 400 && /switched off/.test(sameHost.j && sameHost.j.error), [delOff.status, newOff.status, sameHost.status].join(' '));

  /* ═══ 32. a flood of sign-in pages cannot push out a member's sign-in in progress ═══ */
  const vPage = await req('GET', authzPath(TWO, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'consent', state: 'v-1' }), { cookie: alice.cookie });
  const flood = [];
  for (let n = 0; n < 26; n++) for (let k = 0; k < 4; k++) flood.push('2001:db8:' + (0x100 + n).toString(16) + ':' + k + '::7');
  let served = 0;
  for (let i = 0; i < flood.length; i += 26) await Promise.all(flood.slice(i, i + 26).map(async (ip) => { for (let j = 0; j < OL.PENDING_PER_ADDR; j++) { const r = await req('GET', authzPath(TWO, { scopes: ['send.handle'], challenge: pkce().challenge }), { ip }); if (r.status === 200) served++; } }));
  const vAllow = await post([['pending', field(vPage.text, 'pending')], ['csrf', field(vPage.text, 'csrf')], ['decision', 'allow'], ['scope', 'send.handle']]);
  check('5,200 anonymous sign-in pages from 104 addresses in 26 IPv6 /48s (each within its own limits) push out only their own: the member\'s waiting sign-in still answers with a code',
    served === flood.length * OL.PENDING_PER_ADDR && vAllow.status === 302 && locOf(vAllow).searchParams.get('state') === 'v-1' && !!locOf(vAllow).searchParams.get('code'), served + ' ' + vAllow.status + ' ' + vAllow.text.slice(0, 120));

  /* ═══ 33. sendy.gg, the first app: seeded from the environment, reviewed, owned by nobody ═══ */
  const SENDY_SECRET = process.env.CONNECT_SENDY_TEST_SECRET || '';
  const SENDY = { clientId: 'sendy.gg', redirect: 'https://sendy.gg/api/sendrh/callback' };
  const sRow = db.prepare("SELECT * FROM oauth_clients WHERE client_id = 'sendy.gg'").get();
  check('sendy.gg is seeded at boot from CONNECT_SENDY_SECRET_HASH: confidential, reviewed, owned by no member, its secret known only as the SHA-256 given, its one address the default',
    !!SENDY_SECRET && sRow && sRow.owner_id === null && sRow.kind === 'confidential' && sRow.reviewed_at > 0 && sRow.secret_hash === sha(SENDY_SECRET) && sRow.name === 'Sendy\'s Metaverse' && sRow.redirect_uris === JSON.stringify([SENDY.redirect]), JSON.stringify(sRow && { ...sRow, secret_hash: !!sRow.secret_hash }));
  const GAME_UA = { 'User-Agent': 'SendDiamondForge/1.0 (+https://sendy.gg)' };
  const sc1 = await getCode(alice, SENDY, { scopes: ['send.handle', 'send.id', 'send.power'], tick: ['send.handle', 'send.id', 'send.power'] });
  const sTok = await tokenReq({ grant_type: 'authorization_code', code: sc1.code, redirect_uri: SENDY.redirect, code_verifier: sc1.verifier }, { basic: ['sendy.gg', SENDY_SECRET], headers: GAME_UA, ip: NET + '61' });
  const sUi = sTok.j && sTok.j.access_token ? await userinfo(sTok.j.access_token, { headers: GAME_UA }) : { j: {} };
  check('  ...the game signs a member in exactly as it calls it: code + PKCE, client_secret_basic from its server, then userinfo — handle, Send ID, Send Power, level and title, aud sendy.gg',
    sc1.first.status === 200 && /Reviewed by Just Send It/.test(sc1.page) && sTok.status === 200 && jwtParts(sTok.j.id_token).payload.aud === 'sendy.gg' && !sTok.j.refresh_token
    && sUi.j.preferred_username === alice.name && sUi.j.send_id === aliceRow().send_no && sUi.j.send_power === aliceRow().points && typeof sUi.j.send_level === 'number' && sUi.j.aud === 'sendy.gg', sTok.status + ' ' + JSON.stringify(sUi.j));
  const sNone = await req('GET', authzPath(SENDY, { scopes: ['send.handle', 'send.id', 'send.power'], challenge: pkce().challenge, prompt: 'none' }), { cookie: alice.cookie });
  check('  ...a reviewed app: prompt=none answers it at once (a code for a member who allowed it)', sNone.status === 302 && !!locOf(sNone).searchParams.get('code'), sNone.status + ' ' + sNone.loc);
  const hcall = (body, o = {}) => fetch(BASE + '/oauth/handles', { method: 'POST', headers: { 'Content-Type': o.type || 'application/json', 'X-Forwarded-For': o.ip || nextIp(), ...GAME_UA,
    ...(o.basic === null ? {} : { Authorization: 'Basic ' + Buffer.from((o.basic || ['sendy.gg', SENDY_SECRET]).map(encodeURIComponent).join(':')).toString('base64') }) }, body: typeof body === 'string' ? body : JSON.stringify(body) })
    .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, h: r.headers }; });
  const erinRow = db.prepare('SELECT username FROM users WHERE id = ?').get(erin.id);
  const h1 = await hcall({ handles: ['@' + alice.name.toUpperCase(), 'nobody_here_' + crypto.randomBytes(3).toString('hex'), erinRow.username, '__oi_erin__', 'deleted-5', alice.name] });
  check('the handles check (POST /oauth/handles): yes or no for each, case-insensitive, an @ allowed, a deleted account\'s name (deleted-<id>, or its old one) never a yes, nothing more about anyone',
    h1.status === 200 && h1.j.handles[alice.name] === true && Object.values(h1.j.handles).filter(Boolean).length === 1 && h1.j.handles[erinRow.username.toLowerCase()] === false && h1.j.handles['__oi_erin__'] === false && h1.j.handles['deleted-5'] === false
    && JSON.stringify(h1.j.taken) === JSON.stringify([alice.name]) && Object.keys(h1.j).sort().join(',') === 'handles,taken' && !h1.h.get('access-control-allow-origin'), JSON.stringify(h1.j) + ' ' + erinRow.username);
  const h51 = await hcall({ handles: Array.from({ length: 51 }, (_, i) => 'name' + i) }), hNo = await hcall({ handles: ['x'] }, { basic: null }), hBad = await hcall({ handles: ['x'] }, { basic: ['sendy.gg', 'wrong'] });
  const hConf = await hcall({ handles: ['x'] }, { basic: [CONF.clientId, CONF.secret] }), hPub = await hcall({ handles: ['x'], client_id: PUB.clientId }, { basic: null });
  const hForm = await hcall('handles=' + encodeURIComponent(alice.name) + '&handles=zz_none_here', { type: 'application/x-www-form-urlencoded' });
  check('  ...at most 50 a call; only a reviewed server app that proves its secret may ask (an unreviewed one, a public one, none or a wrong secret are refused, with stable error codes); a form works as JSON does',
    h51.status === 400 && h51.j.error === 'invalid_request' && hNo.status === 401 && hNo.j.error === 'invalid_client' && hBad.status === 401 && /^Basic realm=/.test(hBad.h.get('www-authenticate') || '')
    && hConf.status === 403 && hConf.j.error === 'unauthorized_client' && hPub.status === 403 && hForm.status === 200 && hForm.j.handles[alice.name] === true && hForm.j.handles['zz_none_here'] === false,
    [h51.status, hNo.status, hBad.status, hConf.status, hPub.status, hForm.status].join(' '));
  const sAdmin = (await api('/api/admin/oauth/apps', { cookie: admin.cookie })).j.apps.find((a) => a.clientId === 'sendy.gg');
  const sOff = await api('/api/admin/oauth/apps/sendy.gg', { method: 'POST', cookie: admin.cookie, body: { disabled: true, reason: 'test' } });
  const sOffPage = await req('GET', authzPath(SENDY, { scopes: ['send.handle'], challenge: pkce().challenge }), { cookie: alice.cookie });
  await api('/api/admin/oauth/apps/sendy.gg', { method: 'POST', cookie: admin.cookie, body: { disabled: false } });
  const sGrant = await api('/api/oauth/grants', { cookie: alice.cookie });
  check('  ...the admin lists it (no owner: set up by the operator) and can still switch it off; members see and revoke it like any other',
    sAdmin && sAdmin.owner === null && sAdmin.reviewed === true && sOff.status === 200 && sOffPage.status === 400 && /switched off/.test(sOffPage.text) && sGrant.j.grants.some((g) => g.clientId === 'sendy.gg'), JSON.stringify(sAdmin && { owner: sAdmin.owner, reviewed: sAdmin.reviewed }) + ' ' + sOffPage.status);
  // seeding, in a database of its own: the owner-NOT-NULL table of the first build is rebuilt row for row, and no hash means no app
  const mdb = new DatabaseSync(':memory:');
  mdb.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)'); mdb.exec('INSERT INTO users (id) VALUES (1)');
  mdb.exec("CREATE TABLE oauth_clients (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL UNIQUE, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', homepage TEXT NOT NULL, redirect_uris TEXT NOT NULL, kind TEXT NOT NULL, secret_hash TEXT, secret_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, reviewed_at INTEGER, reviewed_by INTEGER, disabled_at INTEGER, disabled_by INTEGER, disabled_reason TEXT)");
  mdb.prepare("INSERT INTO oauth_clients (client_id, owner_id, name, homepage, redirect_uris, kind, created_at, updated_at) VALUES ('sapp_aaaaaaaaaaaaaaaaaaaaaaaa', 1, 'Kept', 'https://kept.example', '[\"https://kept.example/cb\"]', 'public', 1, 1)").run();
  const mo = OL.createOidc({ db: mdb, now: () => Date.now(), encField: () => 'x', decField: () => null, hashToken: sha, parseCookies: () => ({}), getUser: () => null, rateLimit: () => true, rateHits: () => 0, clientIp: () => '192.0.2.1',
    send() {}, bad() {}, readBody: async () => ({}), blockSanctioned: () => false, isAdmin: () => false, ownershipRefusal: async () => null, verifyNeeds: () => ({}), origin: () => 'https://site.example', escHtml: (v) => String(v), assetVer: () => '',
    secHeaders: {}, levelForXp: () => 1, titleFor: () => 't', effectiveMult: () => ({ total: 1 }), restrictionOf: () => null, sendNoOf: () => 1, nameKey: (v) => String(v).toLowerCase(), reservedKeys: () => ['justsendit'], rotateDays: () => 0, log: () => {} });
  const ownerCol = mdb.prepare('PRAGMA table_info(oauth_clients)').all().find((c) => c.name === 'owner_id');
  const s1 = mo.seedFirstParty({ clientId: 'sendy.gg', name: 'Sendy\'s Metaverse', homepage: 'https://sendy.gg', redirect: 'https://sendy.gg/api/sendrh/callback', secretHash: sha('s1') });
  const s2 = mo.seedFirstParty({ clientId: 'sendy.gg', name: 'Sendy\'s Metaverse', homepage: 'https://sendy.gg', redirect: 'https://sendy.gg/api/sendrh/callback', secretHash: '' });
  let s3 = null; try { mo.seedFirstParty({ clientId: 'evil.example', secretHash: sha('x') }); s3 = 'seeded'; } catch (e) { s3 = e.message; }
  check('  ...an old table (owner_id NOT NULL) is rebuilt with its rows; with no hash the app is not seeded and one seeded before loses its secret (it signs nobody in); only the first-party ID can be seeded',
    ownerCol.notnull === 0 && mdb.prepare("SELECT name FROM oauth_clients WHERE client_id = 'sapp_aaaaaaaaaaaaaaaaaaaaaaaa'").get().name === 'Kept' && s1.seeded === true && s2.seeded === false
    && mdb.prepare("SELECT secret_hash FROM oauth_clients WHERE client_id = 'sendy.gg'").get().secret_hash === null && /not a first-party client ID/.test(s3), JSON.stringify({ nn: ownerCol.notnull, s1, s2, s3 }));
  mdb.close();

  /* ═══ 35. review two: no member and no junk spends an app's budget; codes and tokens stay their own app's; nothing says more than it should ═══ */
  const devF = mkUser('__oi_dev_f__');
  const burnApp = await mkApp(devF, { name: 'Burn Racer', homepage: 'https://burn.example', redirectUris: ['https://burn.example/cb'], kind: 'public' }, nextIp());
  const BURN = { clientId: burnApp.j.app.clientId, redirect: 'https://burn.example/cb' };
  const mal = mkUser('__oi_mallory__', { points: 50 }), ann = mkUser('__oi_ann__', { points: 60 }), zed = mkUser('__oi_zed__', { points: 70 });
  // (a) one spent code, replayed from five addresses (the code row is kept ten minutes, so one code would do for ten)
  const mc = await getCode(mal, BURN, { scopes: ['offline_access'], tick: ['offline_access'] });
  const mx = await exchange(BURN, mc);
  const replays = {};
  await Promise.all([1, 2, 3, 4, 5].map(async (k) => { for (let i = 0; i < 121; i++) { const r = await tokenReq({ grant_type: 'authorization_code', code: mc.code, redirect_uri: BURN.redirect, code_verifier: 'x'.repeat(43), client_id: BURN.clientId }, { ip: NET + (70 + k) }); replays[r.status] = (replays[r.status] || 0) + 1; } }));
  const annX = await exchange(BURN, await getCode(ann, BURN, { scopes: ['send.handle'], tick: ['send.handle'] }));
  check('one spent code replayed 605 times from five addresses is refused against those addresses only (120 each, then 429): the app\'s budget is untouched, and another member\'s exchange goes through',
    mx.status === 200 && replays[400] === 600 && replays[429] === 5 && annX.status === 200 && !!annX.j.access_token, JSON.stringify(replays) + ' ' + annX.status + ' ' + annX.text.slice(0, 120));
  // (b) one member rotating refresh tokens as fast as they can, on as many sign-ins as they like, from one address
  const chains = [];
  for (let i = 0; i < 4; i++) chains.push((await exchange(BURN, await getCode(mal, BURN, { scopes: ['offline_access'] }))).j.refresh_token);
  let rotN = 0; const heldBy = {};
  for (let round = 0; round < 10; round++) for (let k = 0; k < chains.length; k++) {
    const r = await tokenReq({ grant_type: 'refresh_token', refresh_token: chains[k], client_id: BURN.clientId }, { ip: NET + '80' });
    if (r.status === 200) { rotN++; chains[k] = r.j.refresh_token; } else { const w = r.status + ' ' + (r.j && r.j.error_description); heldBy[w] = (heldBy[w] || 0) + 1; }
  }
  const annX2 = await exchange(BURN, await getCode(ann, BURN, { scopes: ['send.handle'] }));
  check('one member\'s refresh loop is held to their own share in the app (30 successful token requests a minute, their 5 exchanges included): 25 rotations, never the app\'s 600 — and another member\'s exchange goes through',
    rotN === 25 && Object.keys(heldBy).length === 1 && /^429 too many token requests for this member in this app/.test(Object.keys(heldBy)[0]) && annX2.status === 200, rotN + ' ' + JSON.stringify(heldBy) + ' ' + annX2.status);
  // (c) one sign-in chain refreshed again and again
  const annRt = (await exchange(BURN, await getCode(ann, BURN, { scopes: ['send.handle', 'offline_access'], tick: ['send.handle', 'offline_access'], prompt: 'consent' }))).j;
  let rt = annRt.refresh_token, okN = 0, last = null;
  for (let i = 0; i < 11; i++) { const r = await tokenReq({ grant_type: 'refresh_token', refresh_token: rt, client_id: BURN.clientId }); if (r.status === 200) { okN++; rt = r.j.refresh_token; } else last = r; }
  check('one sign-in chain refreshes at most 10 times a minute (and 120 an hour): the 11th is 429 before anything is spent, so the token still works afterwards',
    okN === 10 && last && last.status === 429 && /too many refreshes of this sign-in/.test(last.j.error_description) && !!db.prepare("SELECT 1 FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'").get(sha(rt))
    && OL.LIMITS.refreshChain === 10 && OL.LIMITS.refreshChainHour === 120 && /'oa-token-chainh:' \+ grantId, LIMITS\.refreshChainHour, 36e5/.test(LIB), okN + ' ' + (last && last.text));
  // (d) userinfo: one member with three tokens calls as fast as they can
  const zt = [];
  for (let i = 0; i < 3; i++) zt.push((await exchange(BURN, await getCode(zed, BURN, { scopes: ['send.handle'], tick: ['send.handle'] }))).j.access_token);
  let z200 = 0; const z429 = {};
  for (const t of zt) for (let i = 0; i < 200; i += 50) for (const r of await Promise.all(Array.from({ length: 50 }, () => userinfo(t, { ip: NET + '81' })))) { if (r.status === 200) z200++; else { const w = r.status + ' ' + (r.j && r.j.error_description); z429[w] = (z429[w] || 0) + 1; } }
  const annUi = await userinfo(annX2.j.access_token);
  check('userinfo: one member\'s calls are held to their share in the app across all their tokens (120 a minute), checked before the app\'s 3,000 and counted against it only when answered — so 600 calls on three tokens spend 120 of it, and another member\'s userinfo answers',
    z200 === 120 && Object.keys(z429).every((w) => /^429 too many (userinfo requests for this member in this app|requests with this token)/.test(w)) && annUi.status === 200, z200 + ' ' + JSON.stringify(z429) + ' ' + annUi.status);
  // (e) introspection junk naming a browser app, from six addresses, and a member introspecting their own token over and over
  const intro = {};
  await Promise.all([0, 1, 2, 3, 4, 5].map(async (k) => { for (let i = 0; i < 101; i++) { const r = await tokenReq({ token: 'junk-' + k + '-' + i, client_id: BURN.clientId }, { path: '/oauth/introspect', ip: NET + (90 + k) }); intro[r.status] = (intro[r.status] || 0) + 1; } }));
  const introOne = {}; for (let i = 0; i < 122; i++) { const r = await tokenReq({ token: 'junk-one-' + i, client_id: BURN.clientId }, { path: '/oauth/introspect', ip: NET + '96' }); introOne[r.status] = (introOne[r.status] || 0) + 1; }
  let zi = {}; for (let i = 0; i < 32; i++) { const r = await tokenReq({ token: zt[0], client_id: BURN.clientId }, { path: '/oauth/introspect', ip: NET + '97' }); zi[r.status + (r.j && r.j.active ? ':on' : '')] = (zi[r.status + (r.j && r.j.active ? ':on' : '')] || 0) + 1; }
  const introAnn = await tokenReq({ token: annX2.j.access_token, client_id: BURN.clientId }, { path: '/oauth/introspect', ip: NET + '98' });
  check('introspection: 606 junk tokens naming a browser app (its client_id is public) are { active: false } and count against their addresses (120 each, then 429), never the app\'s 600; a member introspecting their own token is held to 30 a minute; the app\'s own introspection of a live token still answers',
    intro[200] === 606 && introOne[200] === 120 && introOne[429] === 2 && zi['200:on'] === 30 && zi['429'] === 2 && introAnn.status === 200 && introAnn.j.active === true, JSON.stringify({ intro, introOne, zi, ann: introAnn.text.slice(0, 80) }));
  // (f) a server app polling, from its one address, tokens past their hour and tokens a member revoked
  const players = [];
  for (let i = 0; i < 3; i++) { const p = mkUser('__oi_player' + i + '__'); players.push((await exchange(CONF, await getCode(p, CONF, { scopes: ['send.handle'], tick: ['send.handle'] }))).j.access_token); }
  for (const t of players) db.prepare('UPDATE oauth_tokens SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1000, sha(t));
  const SERVER_IP = NET + '83';
  let dead = 0;
  for (const t of players) for (let i = 0; i < 100; i += 50) for (const r of await Promise.all(Array.from({ length: 50 }, () => userinfo(t, { ip: SERVER_IP })))) if (r.status === 401) dead++;
  for (let i = 0; i < 300; i += 50) for (const r of await Promise.all(Array.from({ length: 50 }, (_, j) => userinfo('revoked-' + i + '-' + j, { ip: SERVER_IP })))) if (r.status === 401) dead++;
  const livePlayer = (await exchange(CONF, await getCode(ann, CONF, { scopes: ['send.handle'], tick: ['send.handle'] }))).j;
  const lp = await userinfo(livePlayer.access_token, { ip: SERVER_IP });
  check('a server app polling 300 tokens past their hour and 300 it never had, from its one address, is answered 401 for each and its live player still gets 200: an expired token counts against its member\'s share, an unknown one against the address under a cap (4,000) above the app\'s budget',
    dead === 600 && lp.status === 200 && OL.LIMITS.uiRefused > OL.LIMITS.uiApp && OL.LIMITS.uiAddr > OL.LIMITS.uiRefused, dead + ' ' + lp.status + ' ' + JSON.stringify(lp.j).slice(0, 100));
  // (g) prompt=none and max_age: no silent oracle for when a member signed in
  reviewedSet(BURN, true);
  const pnAsk = async (u, ma) => { const r = await req('GET', authzPath(BURN, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'none', extra: ma == null ? {} : { max_age: String(ma) } }), { cookie: u.cookie }); const l = locOf(r); return { r, a: l ? (l.searchParams.get('error') || 'code') : String(r.status), code: l && l.searchParams.get('code') }; };
  const frank = mkUser('__oi_frank__', { sudo: false, ageMs: 5 * 36e5 + 17 * 60e3 + 23e3 });
  const fr = [];
  for (const ma of [0, 1, 60, 3600, 5 * 3600, 19000, 999999999, null]) fr.push((await pnAsk(frank, ma)).a);
  const frOut = (await pnAsk({ cookie: '' }, 60)).r, frAns = [];
  for (const ma of [0, 3600, null]) frAns.push(pnAns((await pnAsk(frank, ma)).r));
  check('prompt=none to a reviewed app the member has not let in answers login_required, exactly as for a signed-out visitor, whatever max_age says (and with none): no silent answer tells it when they signed in, or that they are signed in at all',
    fr.every((x) => x === 'login_required') && frAns.every((x) => x.split('|').slice(0, 2).join('|') === pnAns(frOut).split('|').slice(0, 2).join('|')) && !db.prepare('SELECT 1 FROM oauth_consents WHERE user_id = ?').get(frank.id) && !db.prepare('SELECT 1 FROM oauth_codes WHERE user_id = ?').get(frank.id), fr.join(' ') + ' / ' + frAns.join(' ; ') + ' / ' + pnAns(frOut));
  const gil = mkUser('__oi_gil__', { ageMs: 3 * 36e5 + 7 * 60e3 + 41e3 });
  await getCode(gil, BURN, { scopes: ['send.handle'], tick: ['send.handle'] });
  db.prepare('UPDATE sessions SET sudo_until = NULL, sudo_since = NULL WHERE token = ?').run(sha(gil.sid));
  const gS = Math.floor(db.prepare('SELECT created_at FROM sessions WHERE token = ?').get(sha(gil.sid)).created_at / 1000), gF = gS - (gS % 600);
  const T = Math.floor(Date.now() / 1000) - gF + 60;   // the max_age the ten-minute floor just meets
  const below = await pnAsk(gil, T - 5), above = await pnAsk(gil, T + 5), exactly = await pnAsk(gil, Math.floor(Date.now() / 1000) - gS + 60 + 5);
  const gPk = pkce(), gT = Math.floor(Date.now() / 1000), gR = await req('GET', authzPath(BURN, { scopes: ['send.handle'], challenge: gPk.challenge, prompt: 'none', extra: { max_age: String(T + 5) } }), { cookie: gil.cookie });
  const gTok = locOf(gR) ? (await tokenReq({ grant_type: 'authorization_code', code: locOf(gR).searchParams.get('code'), redirect_uri: BURN.redirect, code_verifier: gPk.verifier, client_id: BURN.clientId })).j : {};
  const gAt = gTok && gTok.id_token ? jwtParts(gTok.id_token).payload.auth_time : null;
  check('  ...and for a member who has: max_age is weighed against the sign-in floored to ten minutes, so a binary search on max_age finds that floor and never the second (a max_age the exact time meets but the floor does not is login_required) — and auth_time says only what the request did (the earliest time its max_age allows), never the floor or the second',
    below.a === 'login_required' && above.a === 'code' && (gS - gF < 15 || exactly.a === 'login_required') && Math.abs(gAt - (gT - (T + 5) + 60)) <= 3 && gAt <= gS && OL.AUTH_STEP_S === 600, JSON.stringify({ below: below.a, above: above.a, exactly: exactly.a, gAt, gF, gS }));
  // (h) a repeated parameter with a made-up name, sent to a reviewed app's callback, and every description inside RFC 6749's characters
  const weird = 'Your Send account was suspended — call +1 555 0100 "now" \\ ☎';
  const wq = authzPath(BURN, { scopes: ['send.handle'], challenge: pkce().challenge, state: 'w-1' }) + '&' + encodeURIComponent(weird) + '=1&' + encodeURIComponent(weird) + '=2';
  const wr = await req('GET', wq), wl = locOf(wr);
  const pq = await req('GET', authzPath(BURN, { scopes: ['send.handle'], challenge: pkce().challenge, state: 'w-2' }) + '&prompt=none&prompt=login'), pl2 = locOf(pq);
  const tw = await tokenReq(new URLSearchParams([['grant_type', 'refresh_token'], [weird, 'a'], [weird, 'b']]).toString(), { headers: {} });
  const RFC = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/;
  check('a repeated parameter is named only when it is one of the request\'s own: a made-up name never reaches the app\'s callback or the token answer, and every error_description keeps to RFC 6749\'s characters',
    wr.status === 302 && wl && wl.searchParams.get('error') === 'invalid_request' && wl.searchParams.get('error_description') === 'a parameter was sent more than once' && wl.searchParams.get('state') === 'w-1'
    && pl2 && pl2.searchParams.get('error_description') === 'prompt was sent more than once' && tw.status === 400 && tw.j.error_description === 'a parameter was sent more than once'
    && [wl.searchParams.get('error_description'), pl2.searchParams.get('error_description'), tw.j.error_description].every((d) => RFC.test(d)) && OL.rfcText('a "quoted" \\ thing — ☎ ok') === 'a quoted thing ok', JSON.stringify([wl && wl.searchParams.get('error_description'), tw.text]));
  // (i) a long state (Auth.js's encrypted one behind a preview deployment's proxy is about 550 characters)
  const st1500 = 'S'.repeat(1500), lsR = await req('GET', authzPath(BURN, { scopes: ['send.handle'], challenge: pkce().challenge, state: st1500 }), { cookie: ann.cookie });
  const lsBad = await req('GET', authzPath(BURN, { scopes: ['send.handle'], challenge: pkce().challenge, state: 'S'.repeat(2049) }), { cookie: ann.cookie });
  check('state may be up to 2,048 characters: a 1,500-character one comes back with the code, one longer is invalid_request (and not echoed)',
    lsR.status === 302 && locOf(lsR).searchParams.get('state') === st1500 && !!locOf(lsR).searchParams.get('code') && lsBad.status === 302 && locOf(lsBad).searchParams.get('error') === 'invalid_request' && !locOf(lsBad).searchParams.get('state') && OL.STATE_MAX === 2048 && OL.PARAM_MAX === 512,
    lsR.status + ' ' + lsBad.status + ' ' + (locOf(lsBad) && locOf(lsBad).searchParams.get('error_description')));
  // (j) a borrowed developer session cannot repoint an app, make it a new secret or delete it; a new host ends every member's grant
  const devG = mkUser('__oi_dev_g__', { sudo: false }); givePassword(devG.id, 'devg-password-1');
  const gApp = await mkApp(devG, { name: 'Repoint Kart', homepage: 'https://rk.example', redirectUris: ['https://rk.example/cb'], kind: 'confidential' }, nextIp());
  const RK = { clientId: gApp.j.app.clientId, redirect: 'https://rk.example/cb', secret: gApp.j.clientSecret };
  const annRk = (await exchange(RK, await getCode(ann, RK, { scopes: ['send.handle', 'offline_access'], tick: ['send.handle', 'offline_access'] }))).j;
  const rp1 = await api('/api/oauth/apps/' + RK.clientId, { method: 'PATCH', cookie: devG.cookie, body: { redirectUris: ['https://collector.example/cb'] } });
  const rh1 = await api('/api/oauth/apps/' + RK.clientId, { method: 'PATCH', cookie: devG.cookie, body: { homepage: 'https://collector.example' } });
  const rs1 = await api('/api/oauth/apps/' + RK.clientId + '/secret', { method: 'POST', cookie: devG.cookie });
  const rd1 = await api('/api/oauth/apps/' + RK.clientId, { method: 'DELETE', cookie: devG.cookie });
  const rn = await api('/api/oauth/apps/' + RK.clientId, { method: 'PATCH', cookie: devG.cookie, body: { name: 'Repoint Kart Two' } });
  const rkRow = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(RK.clientId);
  check('outside its "Confirm it\'s you" window, a developer\'s session cannot repoint an app\'s redirect addresses or homepage, make it a new secret or delete it (401 need_verify, nothing changed); a name change needs no proof',
    [rp1, rh1, rs1, rd1].every((r) => r.status === 401 && r.j.code === 'need_verify') && rkRow && rkRow.redirect_uris === JSON.stringify([RK.redirect]) && rkRow.homepage === 'https://rk.example' && rkRow.secret_hash === sha(RK.secret) && rn.status === 200 && rkRow.name === 'Repoint Kart Two',
    [rp1, rh1, rs1, rd1, rn].map((r) => r.status + ':' + (r.j && (r.j.code || r.j.error || '')).slice(0, 40)).join(' '));
  const rpSame = await api('/api/oauth/apps/' + RK.clientId, { method: 'PATCH', cookie: devG.cookie, body: { redirectUris: [RK.redirect, 'https://rk.example/cb2'], password: 'devg-password-1' } });
  const annStill = await userinfo(annRk.access_token);
  const rp2 = await api('/api/oauth/apps/' + RK.clientId, { method: 'PATCH', cookie: devG.cookie, body: { redirectUris: [RK.redirect, 'https://collector.example/cb'] } });
  const annAfter = await userinfo(annRk.access_token), annRf = await tokenReq({ grant_type: 'refresh_token', refresh_token: annRk.refresh_token, client_id: RK.clientId, client_secret: RK.secret });
  const annNew = await req('GET', authzPath({ clientId: RK.clientId, redirect: 'https://collector.example/cb' }, { scopes: ['send.handle'], challenge: pkce().challenge }), { cookie: ann.cookie });
  check('  ...with the proof it changes; an address on a host the app already had keeps every grant, one on a new host ends them all (the member is shown the consent page again, never sent there silently)',
    rpSame.status === 200 && rpSame.j.newHost === false && rpSame.j.grantsEnded === 0 && annStill.status === 200 && rp2.status === 200 && rp2.j.newHost === true && rp2.j.grantsEnded === 1
    && annAfter.status === 401 && annRf.status === 400 && !db.prepare('SELECT 1 FROM oauth_consents WHERE user_id = ? AND client_id = ?').get(ann.id, RK.clientId) && annNew.status === 200 && !annNew.loc && /data-mode="consent"/.test(annNew.text)
    && /grantsEnded/.test(readFileSync(path.join(ROOT, 'public', 'developers.js'), 'utf8')), [rpSame.status, rpSame.j && rpSame.j.grantsEnded, rp2.status, rp2.j && rp2.j.grantsEnded, annAfter.status, annNew.status].join(' '));
  // (k) the switched-off host, under another spelling, and as a homepage
  const devH = mkUser('__oi_dev_h__'), devI = mkUser('__oi_dev_i__');
  const claim = await mkApp(devH, { name: 'Free Claim Drop', homepage: 'https://claimer.example', redirectUris: ['https://claim-drop.example/cb'], kind: 'public' }, nextIp());
  await api('/api/admin/oauth/apps/' + claim.j.app.clientId, { method: 'POST', cookie: admin.cookie, body: { disabled: true, reason: 'phishing' } });
  const spellings = [];
  for (const [why, body] of [['a trailing dot', { redirectUris: ['https://claim-drop.example./cb'] }], ['a port', { redirectUris: ['https://claim-drop.example:8443/cb'] }], ['capitals', { redirectUris: ['https://CLAIM-DROP.example/cb'] }],
    ['www.', { redirectUris: ['https://www.claim-drop.example/cb'] }], ['the homepage', { homepage: 'https://claim-drop.example' }], ['the homepage with a dot and a port', { homepage: 'https://claim-drop.example.:444/' }]]) {
    const r = await mkApp(devI, { name: 'Claim Two', homepage: 'https://fine-claim.example', redirectUris: ['https://fine-claim.example/cb'], kind: 'public', ...body }, nextIp());
    if (r.status !== 400 || !/switched off/.test(r.j && r.j.error)) spellings.push(why + ' → ' + r.status);
  }
  const fineOne = await mkApp(devI, { name: 'Claim Two', homepage: 'https://claimer.example', redirectUris: ['https://fine-claim.example/cb'], kind: 'public' }, nextIp());
  check('a switched-off app\'s redirect host is not reusable under another spelling (a trailing dot, a port, capitals, www.) nor as a homepage — while its homepage, which could name anybody\'s site, does not block anyone',
    spellings.length === 0 && fineOne.status === 200, spellings.join(' | ') + ' / ' + fineOne.status);
  // (l) the probation sweep, and what the token endpoint tells an app about a restricted member
  const pat = mkUser('__oi_pat__'), quin = mkUser('__oi_quin__'), ros = mkUser('__oi_ros__');
  const patT = (await exchange(BURN, await getCode(pat, BURN, { scopes: ['offline_access'], tick: ['offline_access'] }))).j;
  const quinT = (await exchange(BURN, await getCode(quin, BURN, { scopes: ['offline_access'], tick: ['offline_access'] }))).j;
  await exchange(BURN, await getCode(ros, BURN, { scopes: ['send.handle'], tick: ['send.handle'] }));
  const rosCode = await getCode(ros, BURN, { scopes: ['send.handle'] });   // a code on its way to the app when the restriction lands
  // exactly the UPDATE checkProbation's timed branch makes (this suite calls no revocation)
  for (const u of [pat, ros]) db.prepare('UPDATE users SET restricted_until=?, restrict_reason=?, redeem_dur=?, redeem_hold_until=0, redeem_floor=0 WHERE id=?').run(Date.now() + 2 * 864e5, 'You sold your $SEND before the hold was up — read-only is back, and the timer is doubled.', 2 * 864e5, u.id);
  await api('/api/oauth/grants/' + BURN.clientId, { method: 'DELETE', cookie: quin.cookie });
  const pR = await tokenReq({ grant_type: 'refresh_token', refresh_token: patT.refresh_token, client_id: BURN.clientId }), qR = await tokenReq({ grant_type: 'refresh_token', refresh_token: quinT.refresh_token, client_id: BURN.clientId });
  const pC = await exchange(BURN, rosCode), uC = await tokenReq({ grant_type: 'authorization_code', code: 'nothing-of-ours', redirect_uri: BURN.redirect, code_verifier: 'v'.repeat(43), client_id: BURN.clientId });
  check('the token endpoint answers a restricted member exactly as one who revoked the app (a refresh) and as a code that is not ours (an exchange): no app learns a moderation status',
    pR.status === 400 && qR.status === 400 && pR.j.error_description === qR.j.error_description && pC.status === 400 && pC.j.error_description === uC.j.error_description && !/'this account cannot sign in to apps right now'/.test(LIB),
    [pR.text, qR.text, pC.text].join(' | '));
  const probation = SRC.slice(SRC.indexOf('function checkProbation('), SRC.indexOf('async function checkGateHold('));
  check('  ...and the probation sweep\'s re-restriction (a held buy-out sold early: permanent, or timed and doubled) ends every app\'s tokens at once, as flagUser and the admin\'s restriction do',
    (probation.match(/oidcRevokeUser\(userId\);/g) || []).length === 2 && /restricted_until=\?, restrict_reason=\?, redeem_dur=0[\s\S]*?oidcRevokeUser\(userId\);[\s\S]*?const newDur[\s\S]*?oidcRevokeUser\(userId\);/.test(probation), probation.length);
  // (m) one member keeps at most 20 sign-ins in one app (each chain's rows dated a second apart, so which one is oldest never rests on two exchanges landing in one millisecond)
  const cap = mkUser('__oi_cap__');
  const capFirst = (await exchange(BURN, await getCode(cap, BURN, { scopes: ['offline_access'], tick: ['offline_access'] }))).j;
  const capChains = [capFirst];
  for (let i = 1; i < OL.MAX_GRANTS; i++) capChains.push((await exchange(BURN, await getCode(cap, BURN, { scopes: ['offline_access'] }))).j);
  const capBase = Date.now() - 50 * 60e3;
  capChains.forEach((t, k) => db.prepare('UPDATE oauth_tokens SET created_at = ? WHERE grant_id = ?').run(capBase + k * 1000, t.refresh_token.split('.')[0]));
  await exchange(BURN, await getCode(cap, BURN, { scopes: ['offline_access'] }));   // the 21st
  const grantsNow = db.prepare('SELECT COUNT(DISTINCT grant_id) n FROM oauth_tokens WHERE user_id = ? AND client_id = ?').get(cap.id, BURN.clientId).n;
  const capOld = await tokenReq({ grant_type: 'refresh_token', refresh_token: capFirst.refresh_token, client_id: BURN.clientId });
  check('one member keeps at most 20 sign-ins (token chains) in one app: the 21st ends the one used longest ago, so signing in over and over cannot grow the table',
    OL.MAX_GRANTS === 20 && grantsNow === 20 && capOld.status === 400 && (await userinfo(capFirst.access_token)).status === 401 && (await userinfo(capChains[1].access_token)).status === 200, grantsNow + ' ' + capOld.status);
  // (n) the tables keep no order of writing
  const noRowid = ['oauth_codes', 'oauth_tokens'].every((t) => /WITHOUT\s+ROWID\s*$/i.test(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t).sql.trim()));
  let rowidErr = ''; try { db.prepare('SELECT rowid FROM oauth_tokens LIMIT 1').get(); } catch (e) { rowidErr = e.message; }
  const m2 = new DatabaseSync(':memory:');
  m2.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)'); m2.exec('INSERT INTO users (id) VALUES (1)');
  m2.exec('CREATE TABLE oauth_codes (code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, redirect_uri TEXT NOT NULL, scopes TEXT NOT NULL, challenge TEXT NOT NULL, nonce TEXT, auth_time INTEGER NOT NULL, grant_id TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)');
  m2.exec("CREATE TABLE oauth_tokens (token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, scopes TEXT NOT NULL, grant_id TEXT NOT NULL, auth_time INTEGER, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER                           -- a refresh token once rotated\n)");
  for (let i = 0; i < 3; i++) m2.prepare("INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, scopes, grant_id, created_at, expires_at, used_at) VALUES (?, 'refresh', 'sapp_x', 1, 'openid', 'g', 1, 9e15, ?)").run('h' + i, i ? 1 : null);
  m2.prepare("INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, scopes, challenge, auth_time, grant_id, expires_at) VALUES ('c1', 'sapp_x', 1, 'https://x.example/cb', 'openid', 'ch', 1, 'g', 9e15)").run();
  const fake = (d) => ({ db: d, now: () => Date.now(), encField: () => 'x', decField: () => null, hashToken: sha, parseCookies: () => ({}), getUser: () => null, rateLimit: () => true, rateHits: () => 0, clientIp: () => '192.0.2.1',
    send() {}, bad() {}, readBody: async () => ({}), blockSanctioned: () => false, isAdmin: () => false, ownershipRefusal: async () => null, verifyNeeds: () => ({}), origin: () => 'https://site.example', escHtml: (v) => String(v), assetVer: () => '',
    secHeaders: {}, levelForXp: () => 1, titleFor: () => 't', effectiveMult: () => ({ total: 1 }), restrictionOf: () => null, sendNoOf: () => 1, nameKey: (v) => String(v).toLowerCase(), reservedKeys: () => ['justsendit'], rotateDays: () => 0, log: () => {} });
  const mo2 = OL.createOidc(fake(m2));
  const m2sql = ['oauth_codes', 'oauth_tokens'].map((t) => m2.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t).sql.trim());
  const m2idx = m2.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('oauth_codes', 'oauth_tokens') AND name LIKE 'idx_%' ORDER BY name").all().map((r) => r.name).join(',');
  check('oauth_codes and oauth_tokens are WITHOUT ROWID (rows sit in the order of their random hashes, never in the order written): a table of an earlier build is rebuilt once with its rows and indexes',
    noRowid && /no such column/.test(rowidErr) && m2sql.every((x) => /WITHOUT ROWID$/.test(x)) && m2.prepare('SELECT COUNT(*) n FROM oauth_tokens').get().n === 3 && m2.prepare('SELECT used_at FROM oauth_tokens WHERE token_hash = ?').get('h1').used_at === 1
    && m2.prepare('SELECT COUNT(*) n FROM oauth_codes').get().n === 1 && m2idx === 'idx_oauth_codes_exp,idx_oauth_tokens_client,idx_oauth_tokens_exp,idx_oauth_tokens_grant,idx_oauth_tokens_user', JSON.stringify({ noRowid, rowidErr, m2idx }));
  // (o) the admin's "Mark not reviewed" on the first-party app survives a restart (a fresh seed)
  const seedSpec = { clientId: 'sendy.gg', name: 'Sendy\'s Metaverse', homepage: 'https://sendy.gg', redirect: 'https://sendy.gg/api/sendrh/callback', secretHash: sha('s1') };
  mo2.seedFirstParty(seedSpec);
  const firstReviewed = m2.prepare("SELECT reviewed_at FROM oauth_clients WHERE client_id = 'sendy.gg'").get().reviewed_at;
  m2.prepare("UPDATE oauth_clients SET reviewed_at = NULL, reviewed_by = NULL WHERE client_id = 'sendy.gg'").run();
  mo2.seedFirstParty(seedSpec); mo2.seedFirstParty({ ...seedSpec, description: 'changed', secretHash: sha('s2') });
  check('the first-party app is reviewed when its row is first made, and the admin\'s "Mark not reviewed" survives every restart after (a seed, even one that changes it, never restores the review)',
    firstReviewed > 0 && m2.prepare("SELECT reviewed_at FROM oauth_clients WHERE client_id = 'sendy.gg'").get().reviewed_at === null && m2.prepare("SELECT description FROM oauth_clients WHERE client_id = 'sendy.gg'").get().description === 'changed', String(firstReviewed));
  m2.close();
  // (p) the picture claim can be shown by the app's own page; every other upload stays same-origin
  const UPL = path.join(DATA_DIR, 'uploads'), PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b70000000049454e44ae426082', 'hex');
  mkdirSync(UPL, { recursive: true });
  for (const f of ['aaaaaaaaaaaaaaaaaaaaaaaa.png', 'cccccccccccccccccccccccc.png']) { writeFileSync(path.join(UPL, f), PNG); madeFiles.push(path.join(UPL, f)); }
  const upA = await req('GET', '/uploads/aaaaaaaaaaaaaaaaaaaaaaaa.png'), upC = await req('GET', '/uploads/cccccccccccccccccccccccc.png');
  check('a member\'s current picture (what the picture claim points at) is served with Cross-Origin-Resource-Policy: cross-origin, so an app\'s page can show it; any other upload stays same-origin',
    upA.status === 200 && upA.h.get('cross-origin-resource-policy') === 'cross-origin' && upC.status === 200 && upC.h.get('cross-origin-resource-policy') === 'same-origin' && /idx_users_avatar_img ON users\(avatar_img\)/.test(SRC),
    upA.status + ' ' + upA.h.get('cross-origin-resource-policy') + ' / ' + upC.status + ' ' + upC.h.get('cross-origin-resource-policy'));
  // (q) the consent page says only what is true for what THIS app asked
  const plain = await req('GET', authzPath(BURN, { scopes: ['send.handle', 'send.id'], challenge: pkce().challenge, prompt: 'consent' }), { cookie: ann.cookie });
  const onlyPower = await req('GET', authzPath(BURN, { scopes: ['send.power'], challenge: pkce().challenge, prompt: 'consent' }), { cookie: ann.cookie });
  const handleOnly = await req('GET', authzPath(BURN, { scopes: ['send.handle', 'send.verified'], challenge: pkce().challenge, prompt: 'consent' }), { cookie: ann.cookie });
  check('the consent page\'s "never shared" line names holdings, the OG tier and communities only for an app that did not ask for the Boost, says the Send Power (or picture) is public next to the handle whenever it is offered, and that the Send ID can lead back to it',
    /Never shared with any app:<\/b> your email, your wallets, your IP address, your sign-in history, your holdings, your OG tier and your communities\. Leaving your handle unticked keeps it out of what is sent, but your Send ID can lead back to it \(see its box\)\.<\/p>/.test(plain.text)
    && /your holdings, your OG tier and your communities\.<\/p>/.test(handleOnly.text) && !/Leaving your handle unticked/.test(handleOnly.text)
    && /your holdings, your OG tier and your communities\. Leaving your handle unticked keeps it out of what is sent, but your Send Power is public on your Send Wall next to it\./.test(onlyPower.text), plain.status + ' ' + onlyPower.status);
  reviewedSet(BURN, false);

  /* ═══ 36. review three: the fixes to review two, checked as they were broken ═══ */
  const devR1 = mkUser('__oi_dev_r1__'), devR2 = mkUser('__oi_dev_r2__'), devR3 = mkUser('__oi_dev_r3__');
  const r3 = async (dev, name, host, kind = 'public', extra = {}) => { const r = await mkApp(dev, { name, homepage: 'https://' + host, redirectUris: ['https://' + host + '/cb'], kind, ...extra }, nextIp()); return r.j && r.j.app ? { clientId: r.j.app.clientId, redirect: (extra.redirectUris || ['https://' + host + '/cb'])[0], secret: r.j.clientSecret } : null; };
  const DEVHTML = readFileSync(path.join(ROOT, 'public', 'developers.html'), 'utf8');
  // (a) MAX_GRANTS: what goes first is a sign-in that cannot stay up to date, then the one used longest ago — and only live ones count
  const CAPX = await r3(devR1, 'Cap Kart', 'capkart.example');
  const cpA = mkUser('__oi_cap_a__');
  const cpAdev = (await exchange(CAPX, await getCode(cpA, CAPX, { scopes: ['offline_access'], tick: ['offline_access'] }))).j;   // device A: thirty days
  for (let i = 0; i < OL.MAX_GRANTS; i++) await exchange(CAPX, await getCode(cpA, CAPX, { scopes: [] }));   // device B: openid alone, a full-page redirect each visit
  const cpAref = await tokenReq({ grant_type: 'refresh_token', refresh_token: cpAdev.refresh_token, client_id: CAPX.clientId });
  const cpALive = db.prepare('SELECT COUNT(DISTINCT grant_id) n FROM oauth_tokens WHERE user_id = ? AND client_id = ? AND expires_at > ?').get(cpA.id, CAPX.clientId, Date.now()).n;
  check('MAX_GRANTS ends a sign-in with no refresh token before one that has one: twenty openid-only sign-ins on one device leave the member\'s 30-day sign-in on another refreshing',
    cpAref.status === 200 && cpALive === OL.MAX_GRANTS, cpAref.status + ' ' + cpALive + ' ' + cpAref.text.slice(0, 120));
  const cpB = mkUser('__oi_cap_b__');
  const cpBdev = (await exchange(CAPX, await getCode(cpB, CAPX, { scopes: ['offline_access'], tick: ['offline_access'] }))).j;
  const shortOnes = [];
  for (let i = 0; i < OL.MAX_GRANTS - 1; i++) shortOnes.push((await exchange(CAPX, await getCode(cpB, CAPX, { scopes: [] }))).j.access_token);
  for (const t of shortOnes) db.prepare('UPDATE oauth_tokens SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1000, sha(t));   // past their hour, not yet pruned
  await exchange(CAPX, await getCode(cpB, CAPX, { scopes: ['offline_access'] }));
  const cpBref = await tokenReq({ grant_type: 'refresh_token', refresh_token: cpBdev.refresh_token, client_id: CAPX.clientId });
  check('  ...and a sign-in whose tokens have all expired (waiting for the pruner) is no sign-in: nineteen of them do not count, so one new sign-in ends nothing',
    cpBref.status === 200, cpBref.status + ' ' + cpBref.text.slice(0, 120));
  const cpC = mkUser('__oi_cap_c__');
  const cpCs = [(await exchange(CAPX, await getCode(cpC, CAPX, { scopes: ['offline_access'], tick: ['offline_access'] }))).j];
  for (let i = 1; i < OL.MAX_GRANTS; i++) cpCs.push((await exchange(CAPX, await getCode(cpC, CAPX, { scopes: ['offline_access'] }))).j);
  const cBase = Date.now() - 50 * 60e3;   // the chains a second apart, the first made first
  cpCs.forEach((t, k) => db.prepare('UPDATE oauth_tokens SET created_at = ? WHERE grant_id = ?').run(cBase + k * 1000, t.refresh_token.split('.')[0]));
  const cpCphone = await tokenReq({ grant_type: 'refresh_token', refresh_token: cpCs[0].refresh_token, client_id: CAPX.clientId });   // the first sign-in, in use a moment ago
  await exchange(CAPX, await getCode(cpC, CAPX, { scopes: ['offline_access'] }));   // the 21st
  const phoneAfter = await tokenReq({ grant_type: 'refresh_token', refresh_token: cpCphone.j && cpCphone.j.refresh_token, client_id: CAPX.clientId });
  const idle1 = await userinfo(cpCs[1].access_token), idle2 = await userinfo(cpCs[2].access_token);
  check('  ...and among sign-ins that stay up to date, the 21st ends the one used longest ago, not the first one made: a phone that refreshed a moment ago stays signed in, and the oldest idle sign-in goes',
    cpCphone.status === 200 && phoneAfter.status === 200 && idle1.status === 401 && idle2.status === 200, [cpCphone.status, phoneAfter.status, idle1.status, idle2.status].join(' '));

  // (b) a fresh proof (prompt=login, max_age) or which account (select_account) for an app the member has answered: the proof alone, and the answer on file stands
  const RA = await r3(devR1, 'Step Up Kart', 'stepup.example');
  const reA = mkUser('__oi_reauth__', { sudo: false, ageMs: 40 * 60e3 }); givePassword(reA.id, 'reauth-password-1');
  const raForm = (page, extra = []) => [['pending', field(page, 'pending')], ['csrf', field(page, 'csrf')], ['decision', 'allow'], ...extra];
  const raShut = () => db.prepare('UPDATE sessions SET sudo_until = NULL, sudo_since = NULL WHERE token = ?').run(sha(reA.sid));
  const RA_SCOPES = ['send.handle', 'send.power', 'offline_access'];
  const raPk = pkce(), ra0 = await req('GET', authzPath(RA, { scopes: RA_SCOPES, challenge: raPk.challenge }), { cookie: reA.cookie });
  const ra0ok = await post(raForm(ra0.text, [...RA_SCOPES.map((x) => ['scope', x]), ['password', 'reauth-password-1']]), { cookie: reA.cookie });
  const raDev = (await tokenReq({ grant_type: 'authorization_code', code: locOf(ra0ok) && locOf(ra0ok).searchParams.get('code'), redirect_uri: RA.redirect, code_verifier: raPk.verifier, client_id: RA.clientId })).j;   // device A
  const raCons = () => JSON.stringify(db.prepare('SELECT scopes, asked, updated_at FROM oauth_consents WHERE user_id = ? AND client_id = ?').get(reA.id, RA.clientId));
  const raConsBefore = raCons();
  const stepUp = async (o, proof) => {
    raShut(); const pk = pkce();
    const page = await req('GET', authzPath(RA, { scopes: RA_SCOPES, challenge: pk.challenge, ...o }), { cookie: reA.cookie });
    const ans = page.status === 200 ? await post(raForm(page.text, proof ? [['password', proof]] : []), { cookie: reA.cookie }) : page;
    const code = locOf(ans) && locOf(ans).searchParams.get('code');
    const tok = code ? (await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: RA.redirect, code_verifier: pk.verifier, client_id: RA.clientId })).j : null;
    return { page, ans, tok };
  };
  const noBoxes = (x) => x.page.status === 200 && /data-mode="reauth"/.test(x.page.text) && !/name="scope"/.test(x.page.text) && /Your handle: @__oi_reauth__/.test(x.page.text) && /gets what you allowed it before/.test(x.page.text) && /value="allow" data-tip="[^"]{8,}">Continue</.test(x.page.text);
  const raLogin = await stepUp({ prompt: 'login' }, 'reauth-password-1');
  const raDev1 = await tokenReq({ grant_type: 'refresh_token', refresh_token: raDev && raDev.refresh_token, client_id: RA.clientId });
  check('prompt=login for an app the member has answered asks for the proof alone, with no boxes, and Continue keeps the answer on file: the code carries all they allowed, the consent row is untouched, and their sign-in on another device still refreshes (OIDC Core 3.1.2.1 asks for a new sign-in, not a new consent)',
    !!raDev && noBoxes(raLogin) && /data-confirm="fresh"/.test(raLogin.page.text) && /name="password"/.test(confirmOf(raLogin.page.text) || '') && raLogin.tok && raLogin.tok.scope === 'openid send.handle send.power offline_access' && raCons() === raConsBefore && raDev1.status === 200,
    JSON.stringify({ p: raLogin.page.status, tok: raLogin.tok && raLogin.tok.scope, dev: raDev1.status, cons: raCons() === raConsBefore }));
  const raMa = await stepUp({ extra: { max_age: '300' } }, 'reauth-password-1');
  const raSel = await stepUp({ prompt: 'select_account' }, null);
  const raBad = await (async () => { raShut(); const r = await req('GET', authzPath(RA, { scopes: RA_SCOPES, challenge: pkce().challenge, prompt: 'login' }), { cookie: reA.cookie }); return post(raForm(r.text, [['password', 'not-it']]), { cookie: reA.cookie }); })();
  const raDev2 = await tokenReq({ grant_type: 'refresh_token', refresh_token: raDev1.j && raDev1.j.refresh_token, client_id: RA.clientId });
  check('  ...and the same for a max_age the sign-in is older than (with a fresh proof), and for prompt=select_account (no proof, the account named, "Use another account" offered); a wrong password is refused on that page with nothing given; the answer on file and the other device are untouched throughout',
    noBoxes(raMa) && /data-confirm="fresh"/.test(raMa.page.text) && raMa.tok && raMa.tok.scope === 'openid send.handle send.power offline_access'
    && noBoxes(raSel) && !/data-confirm=/.test(raSel.page.text) && /id="oa-switch"/.test(raSel.page.text) && raSel.tok && raSel.tok.scope === 'openid send.handle send.power offline_access'
    && raBad.status === 401 && /data-mode="reauth"/.test(raBad.text) && /class="oa-err" role="alert"/.test(raBad.text) && !raBad.loc && raCons() === raConsBefore && raDev2.status === 200,
    JSON.stringify({ ma: raMa.page.status, maTok: raMa.tok && raMa.tok.scope, sel: raSel.page.status, selTok: raSel.tok && raSel.tok.scope, bad: raBad.status, dev: raDev2.status }));

  // (c) a refresh that asks for less narrows that access token only; unknown and since-unticked scopes are not refusals
  const NAR = await r3(devR1, 'Narrow Kart', 'narrowkart.example');
  const nar = mkUser('__oi_narrow__');
  const n0 = (await exchange(NAR, await getCode(nar, NAR, { scopes: RA_SCOPES, tick: RA_SCOPES }))).j;
  const rf = (rt, scope) => tokenReq({ grant_type: 'refresh_token', refresh_token: rt, client_id: NAR.clientId, ...(scope === undefined ? {} : { scope }) });
  const n1 = await rf(n0.refresh_token, 'openid send.handle'), n1ui = n1.j ? await userinfo(n1.j.access_token) : { j: {} };
  const n2 = await rf(n1.j && n1.j.refresh_token), n3 = await rf(n2.j && n2.j.refresh_token, 'openid send.handle send.power offline_access');
  check('a refresh that asks for less narrows that access token only (RFC 6749 §6: the new refresh token keeps the sign-in\'s scope): the next refresh, asking nothing, gets the whole sign-in again, and asking for the narrowed scope back is no "adding"',
    n0.scope === 'openid send.handle send.power offline_access' && n1.status === 200 && n1.j.scope === 'openid send.handle offline_access' && !('send_power' in n1ui.j) && n2.status === 200 && n2.j.scope === n0.scope && n3.status === 200 && n3.j.scope === n0.scope,
    [n1.text, n2.text, n3.text].map((x) => x.slice(0, 90)).join(' | '));
  const n4 = await rf(n3.j && n3.j.refresh_token, 'openid profile email send.handle offline_access');
  await getCode(nar, NAR, { scopes: RA_SCOPES, prompt: 'consent', tick: ['send.handle', 'offline_access'] });   // on another device the member answers again, leaving the Send Power unticked
  const n5 = await rf(n4.j && n4.j.refresh_token, n0.scope);   // what oidc-client-ts sends: the scope of its last answer
  const n6 = await rf(n5.j && n5.j.refresh_token, 'openid send.picture');
  const n7 = await rf(n5.j && n5.j.refresh_token);
  check('  ...a scope this site does not know is left out (profile, email) rather than refused; one the member has since unticked is simply not given, so a library sending back its last scope keeps refreshing; one this sign-in was never granted is still invalid_scope, and the token still works after',
    n4.status === 200 && n4.j.scope === 'openid send.handle offline_access' && n5.status === 200 && n5.j.scope === 'openid send.handle offline_access' && n6.status === 400 && n6.j.error === 'invalid_scope' && n7.status === 200 && n7.j.scope === 'openid send.handle offline_access',
    [n4.text, n5.text, n6.text, n7.text].map((x) => x.slice(0, 90)).join(' | '));

  // (d) every 401 invalid_client carries a challenge
  const p6 = [await tokenReq({ grant_type: 'refresh_token', refresh_token: 'x', client_id: 'sapp_' + '0'.repeat(24) }), await tokenReq({ grant_type: 'refresh_token', refresh_token: 'x', client_id: CONF.clientId, client_secret: 'wrong' }),
    await tokenReq({ token: 'x', client_id: 'sapp_' + '1'.repeat(24) }, { path: '/oauth/revoke' }), await tokenReq({ token: 'x', client_id: CONF.clientId, client_secret: 'wrong' }, { path: '/oauth/introspect' })];
  check('every 401 invalid_client carries a challenge (RFC 9110 §15.5.2), however the app tried: an unknown client_id in the form and a wrong client_secret_post, at the token, revoke and introspection endpoints',
    p6.every((r) => r.status === 401 && r.j && r.j.error === 'invalid_client' && /^Basic realm="/.test(r.h.get('www-authenticate') || '')), p6.map((r) => r.status + ' ' + r.h.get('www-authenticate')).join(' | '));

  // (e) a switched-off app stays as the admin saw it, and its hosts stay blocked
  const devJ = mkUser('__oi_dev_j__'), devK = mkUser('__oi_dev_k__'), devL = mkUser('__oi_dev_l__'), devM = mkUser('__oi_dev_m__');
  const inn = await mkApp(devK, { name: 'Innocent Kart', homepage: 'https://shared-probe.example', redirectUris: ['https://shared-probe.example/cb'], kind: 'public', description: 'Karts.' }, nextIp());
  const offA = await mkApp(devJ, { name: 'Off Kart', homepage: 'https://offhome.example', redirectUris: ['https://off-probe.example/cb', 'https://shared-probe.example/x'], kind: 'confidential' }, nextIp());
  const offB = await mkApp(devL, { name: 'Off By Number', homepage: 'https://offnum.example', redirectUris: ['https://192.0.2.77/cb'], kind: 'public' }, nextIp());
  const OFF = offA.j.app.clientId, OFF2 = offB.j.app.clientId, INN = inn.j.app.clientId;
  for (const id of [OFF, OFF2]) await api('/api/admin/oauth/apps/' + id, { method: 'POST', cookie: admin.cookie, body: { disabled: true, reason: 'phishing' } });
  const offEdit = await api('/api/oauth/apps/' + OFF, { method: 'PATCH', cookie: devJ.cookie, body: { name: 'Harmless Thing', redirectUris: ['https://github.com/cb'] } });
  const offDesc = await api('/api/oauth/apps/' + OFF, { method: 'POST', cookie: devJ.cookie, body: { description: 'nothing to see' } });
  const offSecret = await api('/api/oauth/apps/' + OFF + '/secret', { method: 'POST', cookie: devJ.cookie });
  const offRow3 = db.prepare('SELECT name, description, redirect_uris, secret_hash FROM oauth_clients WHERE client_id = ?').get(OFF);
  check('a switched-off app cannot be edited by its developer, nor made a new secret (409, as a delete is): its name, addresses and secret stay as the admin saw them, so the record of where its codes went cannot be rewritten nor its block moved',
    [offEdit, offDesc, offSecret].every((r) => r.status === 409 && /switched this app off/.test(r.j && r.j.error)) && offRow3.name === 'Off Kart' && offRow3.description === '' && offRow3.redirect_uris === JSON.stringify(['https://off-probe.example/cb', 'https://shared-probe.example/x']) && offRow3.secret_hash === sha(offA.j.clientSecret)
    && /a\.disabled \? '' : editing === a\.clientId/.test(readFileSync(path.join(ROOT, 'public', 'developers.js'), 'utf8')), [offEdit, offDesc, offSecret].map((r) => r.status).join(' '));
  const tryHost = (body) => mkApp(devM, { name: 'Probe Kart', homepage: 'https://probekart.example', redirectUris: ['https://probekart.example/cb'], kind: 'public', ...body }, nextIp());
  const hostMiss = [];
  for (const [why, body] of [['the host itself', { redirectUris: ['https://off-probe.example/again'] }], ['a name under it', { redirectUris: ['https://login.off-probe.example/cb'] }], ['a homepage two names under it', { homepage: 'https://a.b.off-probe.example' }],
    ['an IPv4 address written as IPv6', { redirectUris: ['https://[::ffff:192.0.2.77]/cb'] }], ['the same in hex', { redirectUris: ['https://[::ffff:c000:24d]/cb'] }]]) {
    const r = await tryHost(body); if (r.status !== 400 || !/switched off/.test(r.j && r.j.error)) hostMiss.push(why + ' → ' + r.status);
  }
  check('  ...and its hosts stay blocked under any spelling: the host, a name under it (for any number of labels), an IPv4 address written as IPv6 (dotted or in hex)', hostMiss.length === 0, hostMiss.join(' | '));
  const innFull = await api('/api/oauth/apps/' + INN, { method: 'POST', cookie: devK.cookie, body: { name: 'Innocent Kart', homepage: 'https://shared-probe.example', redirectUris: ['https://shared-probe.example/cb'], description: 'Karts, now faster.' } });
  const innMore = await api('/api/oauth/apps/' + INN, { method: 'POST', cookie: devK.cookie, body: { name: 'Innocent Kart', homepage: 'https://shared-probe.example', redirectUris: ['https://shared-probe.example/cb', 'https://shared-probe.example/cb2'], description: 'Karts, now faster.' } });
  const innOther = await tryHost({ redirectUris: ['https://shared-probe.example/mine'] });
  check('  ...while an app that already had one of those hosts (a redirect host proves nobody owns it) still saves its own edits — the whole form /developers sends, and a second address on its own host — and only a new app is refused it',
    innFull.status === 200 && innMore.status === 200 && innOther.status === 400, [innFull.status + ' ' + (innFull.j && innFull.j.error), innMore.status, innOther.status].join(' / '));
  const delJ = await api('/api/account/delete', { method: 'POST', cookie: devJ.cookie, body: { confirm: 'DELETE' } });
  const afterDel = await tryHost({ redirectUris: ['https://off-probe.example/cb'] });
  const blockedNow = ((await api('/api/admin/oauth/apps', { cookie: admin.cookie })).j || {}).blockedHosts || [];
  const goneRows = blockedNow.filter((b) => b.clientId === OFF);
  check('  ...and deleting the developer\'s account deletes the app but not the block: its hosts stay blocked for every other app, and the admin sees them, the app named as gone',
    delJ.status === 200 && !db.prepare('SELECT 1 FROM oauth_clients WHERE client_id = ?').get(OFF) && afterDel.status === 400 && /switched off/.test(afterDel.j && afterDel.j.error) && goneRows.length === 2 && goneRows.every((b) => b.app === null) && goneRows.some((b) => b.host === 'off-probe.example'),
    delJ.status + ' ' + afterDel.status + ' ' + JSON.stringify(goneRows));
  const liftOne = await api('/api/admin/oauth/blocked-hosts', { method: 'POST', cookie: admin.cookie, body: { host: 'shared-probe.example', clientId: OFF, blocked: false } });
  const liftNot = await api('/api/admin/oauth/blocked-hosts', { method: 'POST', cookie: devM.cookie, body: { host: 'off-probe.example', clientId: OFF, blocked: false } });
  const lifted = await tryHost({ redirectUris: ['https://shared-probe.example/mine'] });
  await api('/api/admin/oauth/apps/' + OFF2, { method: 'POST', cookie: admin.cookie, body: { disabled: false } });
  const ipBack = await tryHost({ redirectUris: ['https://192.0.2.77/cb'] });
  check('  ...until the admin lifts one (a host the app listed but does not own: nobody else may) or switches the app back on: then other apps may use it again',
    liftOne.status === 200 && liftNot.status === 404 && lifted.status === 200 && ipBack.status === 200 && !db.prepare('SELECT 1 FROM oauth_blocked_hosts WHERE client_id = ?').get(OFF2) && !!db.prepare("SELECT 1 FROM oauth_blocked_hosts WHERE client_id = ? AND host = 'off-probe.example'").get(OFF),
    [liftOne.status, liftNot.status, lifted.status, ipBack.status].join(' '));

  // (f) a browser app has no shared minute anybody could fill
  const SYB = await r3(devR2, 'Crowd Kart', 'crowdkart.example');
  const syb = []; for (let i = 0; i < 25; i++) syb.push(mkUser('__oi_syb' + i + '__'));
  let sybOk = 0; const sybHeld = {}, sybTok = [];
  await Promise.all(syb.slice(0, 20).map(async (m, k) => {
    for (let ch = 0; ch < 3; ch++) {
      const t = await exchange(SYB, await getCode(m, SYB, { scopes: ['offline_access'], tick: ['offline_access'] }));
      if (t.status !== 200) { sybHeld[t.status + ' ' + (t.j && t.j.error_description)] = 1; continue; }
      sybOk++; let rt = t.j.refresh_token; sybTok[k] = t.j.access_token;
      for (let i = 0; i < 9; i++) { const r = await tokenReq({ grant_type: 'refresh_token', refresh_token: rt, client_id: SYB.clientId }); if (r.status === 200) { sybOk++; rt = r.j.refresh_token; sybTok[k] = r.j.access_token; } else sybHeld[r.status + ' ' + (r.j && r.j.error_description)] = 1; }
    }
  }));
  const late = mkUser('__oi_syb_late__');
  const lateX = await exchange(SYB, await getCode(late, SYB, { scopes: ['offline_access'], tick: ['offline_access'] }));
  check('a browser app has no shared minute anybody could fill: twenty accounts at their full share (600 exchanges and refreshes) leave another member\'s sign-in working',
    sybOk === 600 && lateX.status === 200 && !!lateX.j.access_token, sybOk + ' ' + JSON.stringify(sybHeld) + ' ' + lateX.status + ' ' + lateX.text.slice(0, 120));
  for (const m of syb.slice(20)) sybTok.push((await exchange(SYB, await getCode(m, SYB, { scopes: [] }))).j.access_token);
  let ui200 = 0;
  for (let i = 0; i < OL.LIMITS.uiMember; i += 10) await Promise.all(sybTok.flatMap((t) => Array.from({ length: 10 }, () => userinfo(t).then((r) => { if (r.status === 200) ui200++; }))));
  const lateUi = await userinfo(lateX.j && lateX.j.access_token);
  let in200 = 0;
  for (let i = 0; i < OL.LIMITS.introspectMember; i += 10) await Promise.all(sybTok.slice(0, 20).flatMap((t) => Array.from({ length: 10 }, () => tokenReq({ token: t, client_id: SYB.clientId }, { path: '/oauth/introspect' }).then((r) => { if (r.status === 200 && r.j.active) in200++; }))));
  const lateIn = await tokenReq({ token: lateX.j && lateX.j.access_token, client_id: SYB.clientId }, { path: '/oauth/introspect' });
  check('  ...nor of userinfo (25 accounts × 120 calls) or introspection (20 × 30): another member\'s token still reads and is still described',
    ui200 === 25 * OL.LIMITS.uiMember && lateUi.status === 200 && in200 === 20 * OL.LIMITS.introspectMember && lateIn.status === 200 && lateIn.j.active === true, [ui200, lateUi.status, in200, lateIn.status, lateIn.text.slice(0, 100)].join(' '));

  // (g) junk a stranger gets a server app to relay spends none of the budget its live members need
  const C2 = await r3(devR2, 'Server Kart', 'serverkart.example', 'confidential');
  const c2m = mkUser('__oi_c2m__');
  const c2tok = (await exchange(C2, await getCode(c2m, C2, { scopes: ['send.handle'], tick: ['send.handle'] }))).j;
  const rnd = () => b64url(crypto.randomBytes(32));
  let junkIn = 0;
  for (let i = 0; i < 650; i += 50) for (const r of await Promise.all(Array.from({ length: 50 }, () => tokenReq({ token: rnd() }, { path: '/oauth/introspect', basic: [C2.clientId, C2.secret], ip: NET + '50' })))) if (r.status === 200 && r.j.active === false) junkIn++;
  const liveIn = await tokenReq({ token: c2tok.access_token }, { path: '/oauth/introspect', basic: [C2.clientId, C2.secret], ip: NET + '50' });
  check('a server app checking junk tokens sent to its own API (as /developers says to) spends none of its introspection budget: 650 random ones are { active: false }, and its next live token is still answered',
    junkIn === 650 && liveIn.status === 200 && liveIn.j.active === true, junkIn + ' ' + liveIn.status + ' ' + liveIn.text.slice(0, 100));
  let junkUi = 0;
  for (let i = 0; i < OL.LIMITS.uiRefused; i += 100) for (const r of await Promise.all(Array.from({ length: 100 }, () => userinfo(rnd(), { ip: NET + '51' })))) if (r.status === 401) junkUi++;
  const liveUi = await userinfo(c2tok.access_token, { ip: NET + '51' }), junkMore = await userinfo(rnd(), { ip: NET + '51' });
  check('  ...4,000 junk tokens it relays to userinfo from its one address hold back only the junk: its next live token gets 200, the next junk one 429',
    junkUi === OL.LIMITS.uiRefused && liveUi.status === 200 && junkMore.status === 429, [junkUi, liveUi.status, junkMore.status].join(' '));
  let junkTok = 0;
  for (let i = 0; i < 650; i += 50) for (const r of await Promise.all(Array.from({ length: 50 }, () => tokenReq({ grant_type: 'authorization_code', code: rnd(), redirect_uri: C2.redirect, code_verifier: 'v'.repeat(43) }, { basic: [C2.clientId, C2.secret], ip: NET + '52' })))) if (r.status === 400) junkTok++;
  const c2c = await getCode(c2m, C2, { scopes: ['send.handle'] });
  const realX = await tokenReq({ grant_type: 'authorization_code', code: c2c.code, redirect_uri: C2.redirect, code_verifier: c2c.verifier }, { basic: [C2.clientId, C2.secret], ip: NET + '52' });
  check('  ...650 made-up codes it is got to relay (to its callback, say) are refused without touching its token budget: its next real exchange goes through',
    junkTok === 650 && realX.status === 200 && !!realX.j.access_token, junkTok + ' ' + realX.status + ' ' + realX.text.slice(0, 100));
  for (let i = 0; i < OL.LIMITS.tokenAddr; i += 100) await Promise.all(Array.from({ length: 100 }, () => tokenReq({ grant_type: 'refresh_token', refresh_token: 'x', client_id: SYB.clientId }, { ip: NET + '53' })));
  const overAddr = await tokenReq({ grant_type: 'refresh_token', refresh_token: 'x', client_id: SYB.clientId }, { ip: NET + '53' });
  const c2c2 = await getCode(c2m, C2, { scopes: ['send.handle'] });
  const provedSame = await tokenReq({ grant_type: 'authorization_code', code: c2c2.code, redirect_uri: C2.redirect, code_verifier: c2c2.verifier }, { basic: [C2.clientId, C2.secret], ip: NET + '53' });
  check('  ...and a request that proved a server app\'s secret never counts against its address: once 3,000 requests have filled one address\'s backstop, a server app calling from that address still gets its exchange',
    overAddr.status === 429 && /from this address/.test(overAddr.j && overAddr.j.error_description) && provedSame.status === 200, overAddr.status + ' ' + provedSame.status + ' ' + provedSame.text.slice(0, 100));

  // (h) a restriction ends grants exactly as the member's own revoke does
  const PVA = await r3(devR3, 'Quiet Kart', 'quietkart.example');
  reviewedSet(PVA, true);
  const pva = ['__oi_pv_a__', '__oi_pv_b__', '__oi_pv_c__'].map((n) => mkUser(n)), pvT = [];
  for (const m of pva) pvT.push((await exchange(PVA, await getCode(m, PVA, { scopes: ['send.handle', 'offline_access'], tick: ['send.handle', 'offline_access'] }))).j);
  const pvMembers = async () => (((await api('/api/oauth/apps', { cookie: devR3.cookie })).j || { apps: [] }).apps.find((a) => a.clientId === PVA.clientId) || {}).members;
  const pvm0 = await pvMembers();
  const pvRst = await api('/api/admin/restrict', { method: 'POST', cookie: admin.cookie, body: { userId: pva[0].id, days: 1, reason: 'review three' } });
  await api('/api/oauth/grants/' + PVA.clientId, { method: 'DELETE', cookie: pva[1].cookie });
  const pvm1 = await pvMembers();
  const pvRa = await tokenReq({ grant_type: 'refresh_token', refresh_token: pvT[0].refresh_token, client_id: PVA.clientId }), pvRb = await tokenReq({ grant_type: 'refresh_token', refresh_token: pvT[1].refresh_token, client_id: PVA.clientId });
  await api('/api/admin/restrict', { method: 'POST', cookie: admin.cookie, body: { userId: pva[0].id, lift: true } });
  const pvNa = await req('GET', authzPath(PVA, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'none', state: 'pv' }), { cookie: pva[0].cookie });
  const pvNb = await req('GET', authzPath(PVA, { scopes: ['send.handle'], challenge: pkce().challenge, prompt: 'none', state: 'pv' }), { cookie: pva[1].cookie });
  reviewedSet(PVA, false);
  check('a restriction ends an app\'s grant exactly as the member\'s own revoke does: the developer\'s count of members who allowed it drops for both, both refresh tokens fail alike, and after the lift prompt=none answers both alike (no silent sign-in) — so no app can tell a moderation from a choice',
    pvRst.status === 200 && pvm0 === 3 && pvm1 === 1 && pvRa.status === 400 && pvRa.j.error_description === pvRb.j.error_description && pnAns(pvNa) === pnAns(pvNb) && /^login_required\|/.test(pnAns(pvNa)) && !!db.prepare('SELECT 1 FROM oauth_subjects WHERE user_id = ? AND client_id = ?').get(pva[0].id, PVA.clientId),
    JSON.stringify({ pvm0, pvm1, a: pvRa.text.slice(0, 80), b: pvRb.text.slice(0, 80), na: pnAns(pvNa), nb: pnAns(pvNb) }));

  // (i) auth_time: nothing read off the session, so no two apps can match a member up by it
  const devS = mkUser('__oi_dev_s__'), devT = mkUser('__oi_dev_t__');
  const X1 = await r3(devS, 'Match Kart One', 'matchone.example'), X2 = await r3(devT, 'Match Kart Two', 'matchtwo.example');
  const five = [0, 1, 2, 3, 4].map((k) => mkUser('__oi_at' + k + '__', { ageMs: (k * 97 + 13) * 60e3 }));
  const atOf = async (m, X, extra) => { const pk = pkce(), r = await req('GET', authzPath(X, { scopes: ['send.handle'], challenge: pk.challenge, ...extra }), { cookie: m.cookie }); const code = locOf(r) && locOf(r).searchParams.get('code'); return code ? jwtParts((await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: X.redirect, code_verifier: pk.verifier, client_id: X.clientId })).j.id_token).payload.auth_time : 'no code ' + r.status; };
  const ats = [];
  for (const m of five) for (const X of [X1, X2]) {
    await getCode(m, X, { scopes: ['send.handle'], tick: ['send.handle'] });
    const t = Math.floor(Date.now() / 1000);
    ats.push({ plain: await atOf(m, X, {}), big: await atOf(m, X, { extra: { max_age: '999999999' } }), t });
  }
  check('auth_time is no value two apps could match a member up by: without max_age or prompt=login it is not sent at all, and with a huge max_age every member in every app gets the same request-made value (thirty days back), never their own session\'s',
    ats.every((x) => x.plain === undefined) && ats.every((x) => typeof x.big === 'number' && Math.abs(x.big - (x.t - 30 * 86400)) <= 3), JSON.stringify(ats.slice(0, 4)));
  const sw = five[0];
  db.prepare('UPDATE sessions SET sudo_until = ?, sudo_since = ? WHERE token = ?').run(Date.now() + 36e5, Date.now() - 25 * 60e3, sha(sw.sid));   // "Confirm it's you" made in Settings 25 minutes ago
  const swT = Math.floor(Date.now() / 1000), swAt = await atOf(sw, X2, { extra: { max_age: '86400' } });
  const pw = five[1]; givePassword(pw.id, 'five-password-1');
  const pwPk = pkce(), pwPage = await req('GET', authzPath(X1, { scopes: ['send.handle'], challenge: pwPk.challenge, prompt: 'login' }), { cookie: pw.cookie });
  const pwOk = await post([['pending', field(pwPage.text, 'pending')], ['csrf', field(pwPage.text, 'csrf')], ['decision', 'allow'], ['password', 'five-password-1']], { cookie: pw.cookie });
  const pwAt = locOf(pwOk) ? jwtParts((await tokenReq({ grant_type: 'authorization_code', code: locOf(pwOk).searchParams.get('code'), redirect_uri: X1.redirect, code_verifier: pwPk.verifier, client_id: X1.clientId })).j.id_token).payload.auth_time : null;
  const pwT = Math.floor(Date.now() / 1000), pwAt2 = await atOf(pw, X2, { extra: { max_age: '3600' } });
  check('  ...a "Confirm it\'s you" window opened in Settings, or a fresh proof made for another app, changes nothing another app is told: with max_age it is still the request\'s own value; only the app the proof was made for gets that proof\'s time',
    Math.abs(swAt - (swT - 86400 + 60)) <= 3 && typeof pwAt === 'number' && Math.abs(pwAt - pwT) <= 5 && Math.abs(pwAt2 - (pwT - 3600 + 60)) <= 3,
    JSON.stringify({ swAt, swT, pwAt, pwAt2, pwT }));

  // (j) the Send ID's box says it can lead back to the handle; /developers' max_age and new-address words match the code
  check('the Send ID\'s box, its plain words and its /developers row say Send IDs go in the order members joined, so the ID can narrow down or find the handle',
    /Send IDs go in the order members joined/.test(OL.SCOPES.find((x) => x.scope === 'send.id').plain) && /<tr data-scope="send\.id">[^\n]*order members joined[^\n]*<\/tr>/.test(DEVHTML)
    && /parts\.push\('your Send ID can lead back to it \(see its box\)'\)/.test(LIB));
  const PRT = await r3(devR3, 'Port Kart', 'portkart.example', 'public', { redirectUris: ['https://portkart.example/cb', 'http://localhost:5173/cb'] });
  const prm = mkUser('__oi_port__');
  const prmT = (await exchange(PRT, await getCode(prm, PRT, { scopes: ['send.handle'], tick: ['send.handle'] }))).j;
  const addPort = await api('/api/oauth/apps/' + PRT.clientId, { method: 'PATCH', cookie: devR3.cookie, body: { redirectUris: ['https://portkart.example/cb', 'http://localhost:5173/cb', 'http://localhost:5174/cb', 'http://127.0.0.1:5173/cb'] } });
  const prmStill = await userinfo(prmT.access_token);
  const addTls = await api('/api/oauth/apps/' + PRT.clientId, { method: 'PATCH', cookie: devR3.cookie, body: { redirectUris: ['https://portkart.example/cb', 'http://localhost:5173/cb', 'https://portkart.example:8443/cb'] } });
  check('another address on this device (a new localhost port, or 127.0.0.1) signs nobody out once the app has one — any program there could already take its codes — while a new origin on the web (another port) still ends every grant, and /developers says origin',
    addPort.status === 200 && addPort.j.newHost === false && addPort.j.grantsEnded === 0 && prmStill.status === 200 && addTls.status === 200 && addTls.j.newHost === true && addTls.j.grantsEnded === 1
    && /a scheme, host or port the app did not have/.test(DEVHTML), JSON.stringify([addPort.status, addPort.j && addPort.j.newHost, addPort.j && addPort.j.grantsEnded, prmStill.status, addTls.status, addTls.j && addTls.j.newHost, addTls.j && addTls.j.grantsEnded]));
  check('/developers says what max_age really does: one under about eleven minutes may ask for a fresh proof even right after one, one under a minute always does, and prompt=login is the way to force one',
    !/one under about eleven minutes always asks for a fresh proof/.test(DEVHTML) && /may ask for a fresh proof even right after one/.test(DEVHTML) && /under a minute it always does/.test(DEVHTML) && /to force one, use <code>prompt=login<\/code>/.test(DEVHTML));

  // (k) a database from before the blocked-hosts table: it starts with the hosts of the apps already switched off, once
  const m3 = new DatabaseSync(':memory:');
  m3.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)');
  OL.createOidc(fake(m3));
  m3.exec('DROP TABLE oauth_blocked_hosts');
  m3.prepare("INSERT INTO oauth_clients (client_id, owner_id, name, homepage, redirect_uris, kind, created_at, updated_at, disabled_at) VALUES ('sapp_bbbbbbbbbbbbbbbbbbbbbbbb', NULL, 'Was Off', 'https://wasoff.example', ?, 'public', 1, 1, 5)").run(JSON.stringify(['https://www.WasOff-Probe.example./cb', 'http://localhost:3000/cb']));
  m3.prepare("INSERT INTO oauth_clients (client_id, owner_id, name, homepage, redirect_uris, kind, created_at, updated_at) VALUES ('sapp_cccccccccccccccccccccccc', NULL, 'Still On', 'https://stillon.example', ?, 'public', 1, 1)").run(JSON.stringify(['https://stillon-probe.example/cb']));
  OL.createOidc(fake(m3));
  const filled = m3.prepare('SELECT host, client_id FROM oauth_blocked_hosts').all().map((r) => r.host + '@' + r.client_id).join(',');
  m3.prepare('DELETE FROM oauth_blocked_hosts').run();   // the admin lifts it
  OL.createOidc(fake(m3));
  const refilled = m3.prepare('SELECT COUNT(*) n FROM oauth_blocked_hosts').get().n;
  m3.close();
  check('a database from before the blocked-hosts table starts it, once, with the redirect hosts of the apps already switched off (as names: no www., case or trailing dot, never this device\'s), and a host the admin lifts afterwards stays lifted across restarts',
    filled === 'wasoff-probe.example@sapp_bbbbbbbbbbbbbbbbbbbbbbbb' && refilled === 0, filled + ' / ' + refilled);

  /* ═══ 34. the browser walk: the sign-in and consent pages at 320, 390 and 1280 px ═══ */
  await api('/api/oauth/grants/' + PUB.clientId, { method: 'DELETE', cookie: alice.cookie });   // so the walk's sign-in carries on to a consent page, not straight back
  const lee = mkUser('__oi_lee__', { sudo: false }); givePassword(lee.id, 'lee-password-1');   // never allowed PUB, no unlocked window: the page asks "Confirm it's you"
  const rex = mkUser('__oi_rex__'); givePassword(rex.id, 'rex-password-1');   // has allowed PUB: prompt=login asks only for the proof (the page without boxes)
  await getCode(rex, PUB, { scopes: ['send.handle', 'send.id', 'send.power'], tick: ['send.handle', 'send.id', 'send.power'] });
  await walk(alice, PUB, WALK_REDIRECT, lee, rex);
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  try { walkSrv.close(); } catch {}
  for (const f of madeFiles) { try { unlinkSync(f); } catch {} }
  for (const c of apps) for (const t of ['oauth_tokens', 'oauth_codes', 'oauth_consents', 'oauth_subjects', 'oauth_blocked_hosts', 'oauth_clients']) { try { db.prepare('DELETE FROM ' + t + ' WHERE client_id = ?').run(c); } catch {} }
  for (const t of ['oauth_tokens', 'oauth_codes', 'oauth_consents', 'oauth_subjects']) { try { db.prepare('DELETE FROM ' + t + " WHERE client_id = 'sendy.gg' AND user_id IN (" + made.map(Number).join(',') + ')').run(); } catch {} }
  for (const id of made) {
    for (const t of ['sessions', 'identities', 'notifications', 'points_events', 'oauth_tokens', 'oauth_codes', 'oauth_consents', 'oauth_subjects', 'data_history']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM oauth_clients WHERE owner_id = ?').run(id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_oi\\_%' ESCAPE '\\'").get().n;
  console.log('\ncleanup — users left:', left, '| apps left:', db.prepare("SELECT COUNT(*) n FROM oauth_clients").get().n);
  db.close();
}

/* ═══ the browser: headless Chrome, muted ═══ */
async function walk(member, app, redirect, asker, reauther) {
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
        if (el.matches('button, a.btn, label.oa-scope, input.oa-input') && r.height < 43.5) tiny.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.height));
        if (el.matches('button, a.btn') && (el.getAttribute('data-tip') || '').length < 8) untipped.push(el.id || el.textContent.trim());
      }
      return { floor, doc: document.documentElement.scrollWidth, iw: innerWidth, small: small.slice(0, 5), out: out.slice(0, 5), tiny: tiny.slice(0, 5), untipped };
    })()`;
    const looks = [], trouble = [];
    for (const w of [320, 390, 1280]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: w < 768 ? 740 : 900, deviceScaleFactor: 1, mobile: w < 768 });
      await cdp('Emulation.setTouchEmulationEnabled', w < 768 ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      for (const who of ['out', 'in', 'confirm', 'reauth']) {
        await cdp('Network.clearBrowserCookies');
        await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: BASE });
        if (who === 'in') await cdp('Network.setCookie', { name: 'sid', value: member.sid, url: BASE });
        if (who === 'confirm') await cdp('Network.setCookie', { name: 'sid', value: asker.sid, url: BASE });
        if (who === 'reauth') await cdp('Network.setCookie', { name: 'sid', value: reauther.sid, url: BASE });
        await cdp('Page.navigate', { url: BASE + (who === 'reauth' ? authzPath(W, { scopes: ['send.handle', 'send.id', 'send.power'], challenge: pkce().challenge, prompt: 'login' })
          : authzPath(W, { scopes: ['send.handle', 'send.id', 'send.power', 'send.boost', 'offline_access'], challenge: pkce().challenge, prompt: 'consent' })) });
        await until('document.readyState === "complete" && !!document.querySelector(".oa-card")');
        if (who === 'out') await until('window.AUTH && document.getElementById("auth-modal")', 6000);
        if (who === 'confirm' && !(await until('!!document.querySelector(\'#oa-confirm input[name="password"]\')', 4000))) trouble.push(w + ' confirm: no "Confirm it\'s you" on the page');
        if (who === 'reauth' && !(await until('!!document.querySelector(\'[data-mode="reauth"] #oa-confirm input[name="password"]\') && !document.querySelector(\'input[name="scope"]\')', 4000))) trouble.push(w + ' reauth: not the page without boxes, with its proof');
        await sleep(300);
        const L = await ev(LOOK);
        looks.push(w + who + ':' + L.floor);
        if (L.doc > L.iw || L.small.length || L.out.length || L.tiny.length || L.untipped.length) trouble.push(w + ' ' + who + ' ' + JSON.stringify(L));
      }
    }
    check('in a browser at 320, 390 and 1280 px, signed out, signed in, asked "Confirm it\'s you", and asked only for a fresh proof (the page without boxes): nothing sideways, no text under the floor, every button, field and tick row at least 44px tall and described', trouble.length === 0 && looks.length === 12, trouble.join(' || ') || looks.join(' '));
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
