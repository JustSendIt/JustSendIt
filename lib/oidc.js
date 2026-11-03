'use strict';
/* ===== Sign in with Send: OAuth 2.0 + OpenID Connect, run by this site's server (owner, 2026-11-03) ==================
   Owner: "make the Send Account Login something that other people who are building apps around Send can easily use for
   people to sign in and port over the handle send ID and send power level and Send Boost into their games as well so their
   is account consistency across everyone building around Send. Similar to how people are allowed to sign in with Facebook
   or X or Google accounts else where, people should be able to Sign In with their Send Account too in a similar more
   decentralised and secure and private fashion that does not data farm them like all these other platforms do."

   WHAT IT IS, IN PROTOCOL WORDS. The authorization-code flow with PKCE (S256, required of every app) and OpenID Connect on
   top, so any standard OIDC library signs a member in. It is run by this site's server: not a chain, not a federation.
   What an app receives is verifiable without asking us again: the id_token is an ES256 JWT signed with a key published at
   /.well-known/jwks.json, so an app checks it offline (a "Send Passport" in effect), and /oauth/userinfo is only for the
   CURRENT values (Send Power, level and Boost move).

   ENDPOINTS
     GET  /.well-known/openid-configuration   discovery (also at /.well-known/oauth-authorization-server); issuer = BASE_URL
     GET  /.well-known/jwks.json              the public signing keys (never a private part)
     GET  /oauth/authorize                    validates the app and its EXACT redirect_uri first (no redirect when either is
                                              bad), then the site's own sign-in (auth.js, 2FA and all) and the consent page
     POST /oauth/authorize                    the consent page's Allow / Cancel (CSRF token bound to the session AND the request)
     POST /oauth/token                        authorization_code (PKCE) and refresh_token (rotating); CORS: any origin, no credentials
     GET|POST /oauth/userinfo                 Bearer; the current values of the consented claims, with aud and client_id: the
                                              app the token was issued to, so a backend handed a token can tell; CORS
     POST /oauth/revoke                       RFC 7009; CORS
     POST /oauth/introspect                   RFC 7662, for an app's own tokens only (another app's is "active": false); CORS
     POST /oauth/handles                      reviewed apps only, client-authenticated: which of up to 50 @handles belong to
                                              accounts here (yes or no each, nothing more); no CORS (server to server)
     /api/oauth/*                             a member's own apps, the apps they have signed in to, and the admin's list (JSON)

   THE FIRST-PARTY APP (owner, 2026-11-03: one system, with the game sendy.gg its first app). seedFirstParty() keeps a
   reviewed, confidential client 'sendy.gg' ("Sendy's Metaverse"), owned by no member, from the environment (server.js:
   CONNECT_SENDY_SECRET_HASH, the SHA-256 of its secret, and CONNECT_SENDY_REDIRECT). Without the hash it cannot sign anyone
   in. The admin can still switch it off.

   WHO IS ASKED WHAT
     · a member's FIRST Allow for an app asks "Confirm it's you" — the site's own ownershipRefusal step (the password, the
       two-factor step, or a wallet old enough to vouch; a session inside its unlocked window passes) — so a browser left
       signed in, or a copied cookie, cannot connect an app to the account with one press;
     · max_age and prompt=login are honoured: a sign-in older than max_age (or any, for prompt=login) needs a fresh proof
       made for this request, or a fresh sign-in; prompt=none then answers login_required;
     · a password change, "end other sessions" and two-factor turned off end every app's grant and token (revokeAllGrants,
       called by server.js where it already resets the sessions and the data-key secret), as a restriction and a deletion do.

   THE PRIVACY RULES (each one a test in tests/oidc.mjs)
     · claims only for the scopes the member ticked, in the id_token and userinfo alike — never email, wallets, IPs, sign-in
       history, holdings, the OG tier or communities; the Boost as its total only (its parts reveal holdings and the OG tier);
     · sub is PAIRWISE: a random 256-bit id per (member, app), made at the first grant and STORED (oauth_subjects), so no key
       change can ever move it — two apps cannot link a member by it; the Send ID, which can, is shared only when ticked, and
       its box says so. A revoke keeps it (the app knows the member again if they come back); deleting the account, or the
       app, deletes it;
     · auth_time is the session's sign-in time floored to the UTC hour (never later than the real one), so it is not a
       per-session fingerprint two apps could match up; only when the app asks (max_age, prompt=login) is it finer — the
       coarsest that still answers max_age, or the exact time of a proof made for that very sign-in;
     · every box on the consent page starts unticked, every time, the earlier answer on file or not;
     · stored: the registrations, per member per app the consent (what was ticked and asked, when it was first given and when
       the answer last CHANGED), the private subject id, the hashed live codes and tokens until they expire (then pruned) —
       a spent refresh token is kept to its chain's end only as a hash and a "spent" flag, with the chain's start as its
       date, so a reuse is recognised without a timeline of refreshes — and the signing keys (private parts encrypted with the
       keyring, and dropped once a key retires). NOT stored: which app was used when, userinfo calls, IPs, devices — beyond the
       in-memory rate limits the whole site has (an hour at most). The pending sign-in requests live in memory for ten
       minutes and are never written down.
     · the pages under /oauth/ load nothing from anywhere else (their CSP names no other host — Cloudflare's beacon and
       Google's tag cannot load there), are never cached, never framed, and send the app nothing before Allow;
     · an app nobody here has reviewed is never sent an error automatically (that would make /oauth/authorize a redirector
       any member could aim anywhere): the member is shown the error and a link back to the app's own address. A reviewed
       app is answered at once, as RFC 6749 says, prompt=none included; a member refused for their account (restricted,
       system) is answered there exactly as a signed-out visitor is, so no app learns a moderation status.

   THE TABLES
     oauth_clients   one registered app: client_id (public), owner_id (NULL for the first-party app), name, description,
                     homepage, redirect_uris (JSON, exact strings), kind ('public' | 'confidential'), secret_hash (SHA-256 of
                     a 256-bit secret, shown once), reviewed_at/by, disabled_at/by/reason (the admin's two flags)
     oauth_consents  (user_id, client_id): scopes (what the member ticked), asked (every scope they have answered for),
                     granted_at, updated_at (when the answer last changed)
     oauth_subjects  (user_id, client_id) → sub: the member's private id in that app, random, made at the first grant
     oauth_codes     code_hash, the request it answers (client, redirect_uri, scopes, PKCE challenge, nonce, auth_time), 60 s,
                     used_at (a flag: single use, and a second use revokes everything issued from it), grant_id
     oauth_tokens    token_hash, kind ('access' 1 h | 'refresh' ≤ 30 days from the sign-in), client, user, scopes, grant_id (the
                     chain: one code and every refresh after it), used_at (a flag on a rotated refresh token, kept to the
                     chain's end so a reuse is recognised and revokes the chain; refresh rows all carry the chain's start)
     oauth_keys      kid (RFC 7638 thumbprint), public_jwk, private_enc (encField, re-encrypted by key rotation; NULL once
                     retired), created_at, active_from (a new key is published 24 h before it signs; a retired one stays in
                     the JWKS for 30 days) */
const crypto = require('node:crypto');

const ISS_PATHS = { authorize: '/oauth/authorize', token: '/oauth/token', userinfo: '/oauth/userinfo', revoke: '/oauth/revoke', introspect: '/oauth/introspect',
  handles: '/oauth/handles', jwks: '/.well-known/jwks.json' };
const CODE_TTL_MS = 60e3;                 // an authorization code lives a minute
const CODE_KEEP_MS = 10 * 60e3;           // ...and is kept (spent) ten more, so a second use is recognised and revokes what it issued
const ACCESS_TTL_MS = 60 * 60e3;          // an access token, an hour
const REFRESH_TTL_MS = 30 * 864e5;        // a refresh chain, thirty days from the sign-in (rotation never extends it)
const ID_TTL_S = 600;                     // an id_token, ten minutes
const PENDING_TTL_MS = 10 * 60e3;         // a sign-in request waiting for its member, ten minutes (memory only)
const PENDING_MAX = 5000;
const PENDING_PER_ADDR = 50;              // ...of which one address (an IPv6 /64) holds at most this many: past it, its own oldest goes
const PENDING_PER_NET = 200;              // ...and one IPv6 /48 at most this many (a /48 is hundreds of /64s, all one network)
/* The rate limits (per minute). Per APP first, as the spec asks: sendy.gg calls from ONE address behind Cloudflare, so a
   per-address limit lower than its own would cut it off — the per-address caps are generous backstops. A request refused
   for what it carried (an unknown code, a wrong verifier, a bad token) counts against its ADDRESS, never the app's budget,
   so nobody can spend a public app's budget with junk carrying its public client_id. */
const LIMITS = {
  tokenAddr: 3000,      // /oauth/token from one address, whatever it carries (the backstop)
  tokenRefused: 120,    // ...refused ones from one address (an authenticated server app's own mistakes count against the app)
  tokenApp: 600,        // ...for one app: its exchanges that got as far as a real code or refresh token of its own
  uiAddr: 3000,         // /oauth/userinfo from one address (the backstop)
  uiRefused: 300,       // ...with no token, or one that is not live, from one address
  uiApp: 3000,          // ...for one app's tokens
  uiToken: 120,         // ...with one token
  handlesApp: 120,      // /oauth/handles for one app (up to 50 handles a call)
  handlesAddr: 600,     // ...from one address (the backstop)
  introspectApp: 600, introspectAddr: 3000,
};
const FIRST_PARTY_IDS = new Set(['sendy.gg']);   // seeded by the operator (seedFirstParty), owned by no member
const KEY_PREPUBLISH_MS = 864e5;          // a new signing key is in the JWKS a day before it signs anything
const KEY_KEEP_MS = 30 * 864e5;           // ...and an old one stays there thirty days after it stopped
const MAX_APPS = 5, MAX_REDIRECTS = 5;
const PARAM_MAX = 512;                    // state, nonce: room for any library's value, not for a payload
const OPTIONAL = ['send.handle', 'send.picture', 'send.id', 'send.power', 'send.boost', 'send.verified', 'offline_access'];
const SCOPE_SET = new Set(['openid', ...OPTIONAL]);
const PENDING_COOKIE = 'jsi_oidc';
const CLIENT_ID_RE = /^(?:sapp_[0-9a-f]{24}|sendy\.gg)$/;
const CLIENT_ID_PART = '(sapp_[0-9a-f]{24}|sendy\\.gg)';   // the same, inside the /api/ routes' patterns
/* ASCII only, like the site's usernames: a name in other scripts can look exactly like "Just Send It" (a Cyrillic е or ѕ)
   while the lookalike folding below sees nothing of the site's name in it. */
const APP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 .\-_'&!?:+()]{2,39}$/;
// words that make an app read as the site itself, its staff or its own sign-in (whole words: "Supportive" is fine)
const APP_STAFF_WORDS = ['admin', 'administrator', 'moderator', 'official', 'support', 'staff', 'verified'];
// phrases (folded, spaces dropped) no app may carry: the button's own words, the account's, and the first-party app's
const APP_RESERVED_PHRASES = ['signinwithsend', 'sendaccount', 'sendlogin', 'sendy'];

/* What each scope shares, in the words the consent page and /developers use. `claims` are exactly the claims it adds —
   nothing else is ever put in a token or a userinfo answer. */
const SCOPES = [
  { scope: 'openid', claims: ['sub'], required: true, label: 'A private ID for you in this app alone',
    plain: 'Always shared: an ID for you that is different in every app, so apps cannot match you up by it.' },
  { scope: 'send.handle', claims: ['preferred_username', 'profile'], label: 'Your handle',
    plain: 'Your @handle and the link to your public Send Wall.' },
  { scope: 'send.picture', claims: ['picture'], label: 'Your profile picture',
    plain: 'The address of your public profile picture (nothing when you have none).' },
  { scope: 'send.id', claims: ['send_id'], label: 'Your Send ID',
    plain: 'Your Send ID number: the same number in every app you share it with, so apps can recognise you across each other.' },
  { scope: 'send.power', claims: ['send_power', 'send_level', 'send_title'], label: 'Your Send Power, level and title',
    plain: 'Your Send Power points, the level they make and its title.' },
  { scope: 'send.boost', claims: ['send_boost'], label: 'Your Send Boost',
    plain: 'The total multiplier every point is paid at, as one number: never what it is made of.' },
  { scope: 'send.verified', claims: ['send_verified'], label: 'Whether your wallet passed the holder check',
    plain: 'true or false: whether a wallet of yours passed the site\'s holder check. Not which wallet, not how much it holds.' },
  { scope: 'offline_access', claims: [], label: 'Stay up to date for 30 days',
    plain: 'A refresh token, so the app can read the values above again for up to 30 days without a new sign-in.' },
];
const SCOPE_BY = Object.fromEntries(SCOPES.map((s) => [s.scope, s]));

/* ---------- small pure helpers (exported for the tests and the docs) ---------- */
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64dec = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const sha256hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randTok = (n = 32) => b64url(crypto.randomBytes(n));   // 256 bits by default, 43 base64url characters
// RFC 7638: the SHA-256 of the required members, in lexicographic order, with no whitespace
const jwkThumbprint = (jwk) => b64url(crypto.createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest());
// PKCE S256 (RFC 7636 §4.2): BASE64URL(SHA256(ASCII(code_verifier)))
const pkceS256 = (verifier) => b64url(crypto.createHash('sha256').update(String(verifier), 'ascii').digest());
// constant time over equal-length digests, so neither the length nor the first wrong byte shows in the timing
function sameSecret(a, b) {
  const x = crypto.createHash('sha256').update(String(a == null ? '' : a)).digest(), y = crypto.createHash('sha256').update(String(b == null ? '' : b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function signJwt(payload, kid, privateKey) {
  const head = b64url(Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid })));   // the one algorithm: never 'none', never chosen by a caller
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return head + '.' + body + '.' + b64url(sig);
}
/* The reference verifier — what an app does with an id_token, offline. ES256 only (a token claiming any other algorithm,
   'none' included, is refused before a key is even looked at), the key found by kid in the JWKS the app fetched, iss and aud
   exact, and exp / iat checked with a clock-skew allowance (60 s by default) for an app whose clock is a little out. */
function verifyJwt(jwt, jwks, opts = {}) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) throw new Error('not a JWT');
  let head, payload;
  try { head = JSON.parse(b64dec(parts[0]).toString('utf8')); payload = JSON.parse(b64dec(parts[1]).toString('utf8')); } catch { throw new Error('not a JWT'); }
  if (!head || head.alg !== 'ES256') throw new Error('alg must be ES256');
  if (head.crit !== undefined || head.jku !== undefined || head.jwk !== undefined || head.x5u !== undefined) throw new Error('unsupported header');
  const jwk = ((jwks && jwks.keys) || []).find((k) => k && k.kid === head.kid && k.kty === 'EC' && k.crv === 'P-256');
  if (!jwk) throw new Error('unknown kid');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
  const sig = b64dec(parts[2]);
  if (sig.length !== 64 || !crypto.verify('sha256', Buffer.from(parts[0] + '.' + parts[1]), { key, dsaEncoding: 'ieee-p1363' }, sig)) throw new Error('bad signature');
  const t = Math.floor((opts.now || Date.now()) / 1000), skew = opts.skewS == null ? 60 : opts.skewS;
  if (opts.issuer !== undefined && payload.iss !== opts.issuer) throw new Error('wrong iss');
  if (opts.audience !== undefined && !(payload.aud === opts.audience || (Array.isArray(payload.aud) && payload.aud.includes(opts.audience)))) throw new Error('wrong aud');
  if (!(typeof payload.exp === 'number' && payload.exp + skew > t)) throw new Error('expired');
  if (!(typeof payload.iat === 'number' && payload.iat - skew <= t)) throw new Error('issued in the future');
  if (opts.nonce !== undefined && payload.nonce !== opts.nonce) throw new Error('wrong nonce');
  return payload;
}
/* A redirect URI an app may register: https anywhere, or http on this device (localhost / 127.0.0.1, any port) for
   development. Compared later as an EXACT string — so it is checked here for every trick a looser comparison would let
   through: no fragment, no userinfo, no wildcard, no dot segments (plain or encoded), no backslash, no whitespace or
   control characters. And plain printable ASCII only: the address goes out in a Location header exactly as registered
   (a header cannot carry 例え.jp or 路径), so an international domain is registered in its xn-- form and anything else
   percent-encoded. Returns null when it may be registered, or the reason it may not. */
const NOT_PLAIN_ASCII = /[^\x21-\x7e]/;
function redirectUriRefusal(s) {
  if (typeof s !== 'string' || !s) return 'a redirect URI is a full address, like https://your.app/callback';
  if (s.length > 500) return 'a redirect URI is at most 500 characters';
  if (/[\u0000- \u007f-\u009f\\]/.test(s)) return 'a redirect URI cannot contain spaces, control characters or backslashes';
  if (NOT_PLAIN_ASCII.test(s)) return 'a redirect URI is written in plain ASCII: put an international domain in its xn-- form and percent-encode the rest, exactly as your app will send it';
  if (s.includes('#')) return 'a redirect URI cannot have a #fragment';
  if (s.includes('*')) return 'a redirect URI is matched exactly: no wildcards';
  let u; try { u = new URL(s); } catch { return 'that redirect URI is not a full address, like https://your.app/callback'; }
  if (u.username || u.password || /^[a-z]+:\/\/[^/?]*@/i.test(s)) return 'a redirect URI cannot carry a user name or password';
  const path = s.replace(/^[a-z]+:\/\/[^/?]*/i, '').split('?')[0];
  if (/(^|\/)(\.|%2e){1,2}(\/|$)/i.test(path) || /%2f|%5c/i.test(path)) return 'a redirect URI cannot have . or .. segments or encoded slashes in its path';
  if (u.protocol === 'https:') { if (!u.hostname) return 'a redirect URI needs a host'; return null; }
  if (u.protocol === 'http:' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/|\?|$)/.test(s)) return null;
  return 'a redirect URI must be https, or http://localhost or http://127.0.0.1 (any port) while you develop';
}
function homepageRefusal(s) {
  if (typeof s !== 'string' || !s.trim()) return 'add the app\'s homepage, like https://your.app';
  if (s.length > 300) return 'the homepage address is at most 300 characters';
  if (/[\u0000- \u007f-\u009f\\]/.test(s)) return 'the homepage address cannot contain spaces or control characters';
  // plain ASCII, as a redirect URI: an address in other scripts can read as another site's (ѕendrh.com, a Cyrillic ѕ)
  if (NOT_PLAIN_ASCII.test(s)) return 'the homepage is written in plain ASCII: put an international domain in its xn-- form and percent-encode the rest';
  let u; try { u = new URL(s); } catch { return 'the homepage is a full https address'; }
  if (u.protocol !== 'https:') return 'the homepage must be an https address';
  if (u.username || u.password) return 'the homepage cannot carry a user name or password';
  return null;
}
// a request body as text, at most `limit` bytes
function readText(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false; const chunks = [];
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    const timer = setTimeout(() => { finish(reject, Object.assign(new Error('the request body took too long'), { status: 408 })); try { req.destroy(); } catch {} }, 15000);
    req.on('data', (c) => { size += c.length; if (size > limit) { finish(reject, Object.assign(new Error('the request is too large'), { status: 413 })); try { req.destroy(); } catch {} return; } chunks.push(c); });
    req.on('end', () => finish(resolve, Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(reject, Object.assign(new Error('the request stream failed'), { status: 400 })));
  });
}
// a form body (application/x-www-form-urlencoded), at most `limit` bytes
const readForm = async (req, limit = 16 * 1024) => new URLSearchParams(await readText(req, limit));
const isForm = (req) => /^application\/x-www-form-urlencoded\s*(;|$)/i.test(String(req.headers['content-type'] || ''));
const cleanLine = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const scopeList = (s) => String(s || '').split(' ').filter(Boolean);
const orderScopes = (arr) => OPTIONAL.filter((s) => arr.includes(s));

function createOidc(deps) {
  const { db, now } = deps;
  const origin = () => deps.origin();            // the issuer: BASE_URL, never the Host header
  const esc = (v) => deps.escHtml(v);
  const pending = new Map();                     // id -> a sign-in request waiting for its member (memory only)
  const keyCache = new Map();                    // kid -> KeyObject, so a private key is decrypted once

  /* ---------- the tables ---------- */
  function migrate() {
    db.exec(`
CREATE TABLE IF NOT EXISTS oauth_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL UNIQUE,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,   -- NULL: the first-party app the operator seeds (seedFirstParty)
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  homepage TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,              -- JSON array of the exact strings registered
  kind TEXT NOT NULL,                       -- 'public' (PKCE is its proof) | 'confidential' (and a secret)
  secret_hash TEXT,                         -- SHA-256 hex of the secret, which is shown once and never stored
  secret_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reviewed_at INTEGER, reviewed_by INTEGER, -- an admin looked at it ("Not reviewed by Just Send It" until then)
  disabled_at INTEGER, disabled_by INTEGER, disabled_reason TEXT   -- an admin switched it off: no new sign-ins, its tokens dead
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_owner ON oauth_clients(owner_id);
CREATE TABLE IF NOT EXISTS oauth_consents (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',          -- the optional scopes the member ticked (space-separated)
  asked TEXT NOT NULL DEFAULT '',           -- every optional scope they have answered for, ticked or not
  granted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_consents_client ON oauth_consents(client_id);
CREATE TABLE IF NOT EXISTS oauth_subjects (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  sub TEXT NOT NULL UNIQUE,                 -- random, 256 bits, base64url: the member's private id in that app alone
  PRIMARY KEY (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_subjects_client ON oauth_subjects(client_id);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,               -- SHA-256 hex: the code itself is never stored
  client_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scopes TEXT NOT NULL,
  challenge TEXT NOT NULL,                  -- PKCE S256
  nonce TEXT,
  auth_time INTEGER NOT NULL,
  grant_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_exp ON oauth_codes(expires_at);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,              -- SHA-256 hex: the token itself is never stored
  kind TEXT NOT NULL,                       -- 'access' | 'refresh'
  client_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes TEXT NOT NULL,
  grant_id TEXT NOT NULL,                   -- the chain: everything issued from one code
  auth_time INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER                           -- a refresh token once rotated (a second use revokes the chain)
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_grant ON oauth_tokens(grant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens(user_id, client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_client ON oauth_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_exp ON oauth_tokens(expires_at);
CREATE TABLE IF NOT EXISTS oauth_keys (
  kid TEXT PRIMARY KEY,                     -- RFC 7638 thumbprint of the public key
  public_jwk TEXT NOT NULL,
  private_enc TEXT,                         -- encField(the private JWK); NULL once the key has retired
  created_at INTEGER NOT NULL,
  active_from INTEGER NOT NULL              -- signs from here; published from created_at
);`);
    /* A table made before the first-party app existed has owner_id NOT NULL, which SQLite cannot drop in place: the table
       is rebuilt once, row for row, in one transaction (the same columns, so the copy is exact). */
    const owner = db.prepare('PRAGMA table_info(oauth_clients)').all().find((c) => c.name === 'owner_id');
    if (owner && owner.notnull) {
      const create = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'oauth_clients'").get().sql;
      db.exec('BEGIN');
      try {
        db.exec(create.replace(/^CREATE TABLE "?oauth_clients"?/, 'CREATE TABLE oauth_clients_rebuilt').replace(/owner_id INTEGER NOT NULL/, 'owner_id INTEGER'));
        db.exec('INSERT INTO oauth_clients_rebuilt SELECT * FROM oauth_clients');
        db.exec('DROP TABLE oauth_clients');
        db.exec('ALTER TABLE oauth_clients_rebuilt RENAME TO oauth_clients');
        db.exec('CREATE INDEX IF NOT EXISTS idx_oauth_clients_owner ON oauth_clients(owner_id)');
        db.exec('COMMIT');
      } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
    }
  }
  migrate();

  /* ---------- the pairwise subject ----------
     A random id per (member, app), made the first time the member is let in to that app and read back ever after: no key
     plays a part, so no key change can move it (owner, 2026-11-03), and it says nothing about the account it stands for. */
  function subFor(userId, clientId) {
    const have = db.prepare('SELECT sub FROM oauth_subjects WHERE user_id = ? AND client_id = ?').get(userId, clientId);
    if (have) return have.sub;
    db.prepare('INSERT OR IGNORE INTO oauth_subjects (user_id, client_id, sub) VALUES (?,?,?)').run(userId, clientId, randTok(32));
    return db.prepare('SELECT sub FROM oauth_subjects WHERE user_id = ? AND client_id = ?').get(userId, clientId).sub;
  }

  /* ---------- signing keys ---------- */
  const keyRows = () => db.prepare('SELECT * FROM oauth_keys ORDER BY active_from, created_at').all();
  function newKey(activeFrom) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const p = publicKey.export({ format: 'jwk' });
    const pub = { kty: 'EC', crv: 'P-256', x: p.x, y: p.y };
    const kid = jwkThumbprint(pub);
    db.prepare('INSERT INTO oauth_keys (kid, public_jwk, private_enc, created_at, active_from) VALUES (?,?,?,?,?)')
      .run(kid, JSON.stringify(pub), deps.encField(JSON.stringify(privateKey.export({ format: 'jwk' }))), now(), activeFrom);
    keyCache.set(kid, privateKey);
    return kid;
  }
  // [{ row, state: 'next' | 'signing' | 'retired', retiredAt }] in the order they sign
  function keyStates(t = now()) {
    const rows = keyRows();
    const cur = rows.filter((r) => r.active_from <= t).pop() || null;
    return rows.map((r, i) => {
      const next = rows.slice(i + 1).find((x) => x.active_from <= t);
      return { row: r, state: r.active_from > t ? 'next' : (cur && r.kid === cur.kid ? 'signing' : 'retired'), retiredAt: next ? next.active_from : null };
    });
  }
  function signingKey() {
    let st = keyStates(), cur = st.find((k) => k.state === 'signing');
    if (!cur) { newKey(now()); st = keyStates(); cur = st.find((k) => k.state === 'signing'); }
    // a retired key never signs again: its private part goes now, and only its public half stays (in the JWKS, for 30 days)
    for (const k of st) if (k.state === 'retired' && k.row.private_enc != null) { db.prepare('UPDATE oauth_keys SET private_enc = NULL WHERE kid = ?').run(k.row.kid); keyCache.delete(k.row.kid); }
    let key = keyCache.get(cur.row.kid);
    if (!key) {
      let jwk = null; try { jwk = JSON.parse(deps.decField(cur.row.private_enc) || 'null'); } catch {}
      if (!jwk || !jwk.d) {
        // no key here opens it (or it was dropped): a new one signs from now; the old public half stays published
        deps.log('🔑 Sign in with Send: the signing key ' + cur.row.kid.slice(0, 8) + ' could not be opened, so a new one signs from now');
        db.prepare('UPDATE oauth_keys SET private_enc = NULL WHERE kid = ?').run(cur.row.kid);
        const kid = newKey(now());
        return { kid, key: keyCache.get(kid) };
      }
      key = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
      keyCache.set(cur.row.kid, key);
    }
    return { kid: cur.row.kid, key };
  }
  // published: the next key (a day early), the signing one, and every retired one for 30 days after it stopped
  function jwks(t = now()) {
    const keys = keyStates(t).filter((k) => k.state !== 'retired' || (k.retiredAt && k.retiredAt + KEY_KEEP_MS > t))
      .map((k) => ({ ...JSON.parse(k.row.public_jwk), kid: k.row.kid, use: 'sig', alg: 'ES256' }));
    return { keys };
  }
  /* The rotation helper: a new key, published now and signing from KEY_PREPUBLISH_MS on (an app that cached the JWKS has a
     day to pick it up). Asking again while one is waiting changes nothing. */
  function rotateKey() {
    signingKey();   // there is always a signing key to rotate from
    const waiting = keyStates().find((k) => k.state === 'next');
    if (waiting) return { kid: waiting.row.kid, activeFrom: waiting.row.active_from, already: true };
    const kid = newKey(now() + KEY_PREPUBLISH_MS);
    return { kid, activeFrom: now() + KEY_PREPUBLISH_MS, already: false };
  }
  function keysView() {
    return keyStates().map((k) => ({ kid: k.row.kid, createdAt: k.row.created_at, activeFrom: k.row.active_from, state: k.state,
      retiredAt: k.retiredAt, publishedUntil: k.state === 'retired' && k.retiredAt ? k.retiredAt + KEY_KEEP_MS : null, hasPrivate: k.row.private_enc != null }));
  }

  /* ---------- registrations ---------- */
  // an app by its client ID; the first-party app only while the operator has given it a secret (seedFirstParty)
  const clientRow = (id) => {
    if (typeof id !== 'string' || !CLIENT_ID_RE.test(id)) return null;
    const c = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(id) || null;
    return c && FIRST_PARTY_IDS.has(c.client_id) && !c.secret_hash ? null : c;
  };
  const redirectsOf = (c) => { try { const a = JSON.parse(c.redirect_uris); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; } catch { return []; } };
  const membersOf = (clientId) => db.prepare('SELECT COUNT(*) n FROM oauth_consents WHERE client_id = ?').get(clientId).n;
  function appView(c) {
    return { clientId: c.client_id, name: c.name, description: c.description || '', homepage: c.homepage, redirectUris: redirectsOf(c), kind: c.kind,
      hasSecret: !!c.secret_hash, secretRotatedAt: c.secret_at || null, createdAt: c.created_at, updatedAt: c.updated_at,
      reviewed: !!c.reviewed_at, reviewedAt: c.reviewed_at || null, disabled: !!c.disabled_at, disabledAt: c.disabled_at || null,
      disabledReason: c.disabled_reason || null, members: membersOf(c.client_id) };
  }
  // everything an app's sign-ins left: consents, codes, tokens — and the requests waiting in memory
  function dropClientGrants(clientId) {
    db.prepare('DELETE FROM oauth_tokens WHERE client_id = ?').run(clientId);
    db.prepare('DELETE FROM oauth_codes WHERE client_id = ?').run(clientId);
    for (const [id, e] of pending) if (e.clientId === clientId) pending.delete(id);
  }
  function deleteClient(clientId) {
    dropClientGrants(clientId);
    db.prepare('DELETE FROM oauth_consents WHERE client_id = ?').run(clientId);
    db.prepare('DELETE FROM oauth_subjects WHERE client_id = ?').run(clientId);   // the app is gone: the ids it knew members by go too
    db.prepare('DELETE FROM oauth_clients WHERE client_id = ?').run(clientId);
  }
  /* What a member is shown about an app must not pass for this site: its name, its homepage, its description and the
     address it sends members back to. The site's own names (and their lookalikes), its staff and its own sign-in are
     nobody's app: an app called "JustSendIt Login", "Official Send Support" or "Sign in with Send" would pass for it. */
  const siteHost = () => hostOf(origin()).toLowerCase().split(':')[0];
  const folded = (w) => deps.nameKey(String(w).toLowerCase());
  function nameRefusal(name) {
    if (!APP_NAME_RE.test(name)) return 'the app\'s name is 3–40 characters: plain letters (A to Z), numbers, spaces and . - _ \' & ! ? : + ( ), starting with a letter or number';
    const key = folded(name.replace(/\s+/g, ''));
    if (deps.reservedKeys().some((k) => key.includes(k)) || APP_RESERVED_PHRASES.some((p) => key.includes(folded(p)))) return 'that name is too close to this site\'s own name — pick one that is clearly your app\'s';
    const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean).map(folded), staff = APP_STAFF_WORDS.map(folded);
    if (words.some((w) => staff.includes(w))) return 'an app\'s name cannot say it is the site\'s own, its staff or verified by it (admin, moderator, official, support, staff or verified) — pick one that is clearly your app\'s';
    return null;
  }
  // an address that is this site's, or reads as it: the site's own host or one under it, or one that spells the site's name
  function hostRefusal(host, what) {
    const h = String(host || '').toLowerCase().replace(/\.$/, ''), site = siteHost();
    if (site && (h === site || h.endsWith('.' + site))) return what + ' cannot be on this site\'s own address (' + site + ')';
    const key = folded(h.replace(/\./g, ''));
    if (deps.reservedKeys().some((k) => key.includes(k))) return what + ' cannot carry this site\'s name in its address';
    return null;
  }
  // a description may say anything about the app but that it is this site: none of the site's names as words, nor its address
  function descriptionRefusal(d) {
    const words = d.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(folded), keys = deps.reservedKeys(), plain = folded('JustSend');
    for (let i = 0; i < words.length; i++) {
      for (let n = 1; n <= 3 && i + n <= words.length; n++) {
        const k = words.slice(i, i + n).join('');
        if (keys.includes(k) && !(n > 1 && k === plain)) return 'the description cannot use this site\'s own name (Just Send It or SendRH): say what your app is in your own words';   // "just send" in a sentence is only English
      }
    }
    const site = siteHost();
    if (site && site.includes('.') && d.toLowerCase().includes(site)) return 'the description cannot name this site\'s own address';
    return null;
  }
  // the fields of a create or an edit, checked before anything is written. `have` is the app as it is (an edit)
  function appFields(b, have) {
    const out = {};
    if (!have || b.name !== undefined) {
      const name = cleanLine(b.name, 80);
      const r = nameRefusal(name); if (r) return { error: r };
      out.name = name;
    }
    if (!have || b.homepage !== undefined) {
      const hp = typeof b.homepage === 'string' ? b.homepage.trim() : b.homepage;
      const r = homepageRefusal(hp) || hostRefusal(new URL(hp).hostname, 'the homepage'); if (r) return { error: r };
      out.homepage = hp;
    }
    if (!have || b.redirectUris !== undefined) {
      const list = Array.isArray(b.redirectUris) ? b.redirectUris : (typeof b.redirectUris === 'string' ? b.redirectUris.split(/\s+/) : null);
      if (!list) return { error: 'redirectUris is a list of addresses' };
      const uris = [...new Set(list.map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== ''))];
      if (!uris.length) return { error: 'add at least one redirect URI: the address your app is sent back to after sign-in' };
      if (uris.length > MAX_REDIRECTS) return { error: 'at most ' + MAX_REDIRECTS + ' redirect URIs per app' };
      for (const u of uris) {
        const r = redirectUriRefusal(u) || (/^https:/i.test(u) ? hostRefusal(new URL(u).hostname, 'a redirect URI') : null) || disabledHostRefusal(u, have);
        if (r) return { error: r + ' (' + String(u).slice(0, 120) + ')' };
      }
      out.redirectUris = uris;
    }
    if (!have || b.description !== undefined) {
      const d = cleanLine(b.description, 1000);
      if (d.length > 300) return { error: 'the description is at most 300 characters' };
      const r = descriptionRefusal(d); if (r) return { error: r };
      out.description = d;
    }
    if (!have) {
      if (b.kind !== 'public' && b.kind !== 'confidential') return { error: 'kind is "public" (a browser or mobile app: no secret, PKCE is its proof) or "confidential" (a server that can keep a secret)' };
      out.kind = b.kind;
    } else if (b.kind !== undefined && b.kind !== have.kind) return { error: 'an app\'s kind cannot change — register a new app for the other kind' };
    return { fields: out };
  }
  const newSecret = () => 'ssec_' + randTok(32);
  // a redirect host that belongs to an app the admin switched off is not a fresh start for it under another name
  function disabledHostRefusal(u, have) {
    if (isLocal(u)) return null;
    const host = hostOf(u).toLowerCase();
    for (const c of db.prepare('SELECT client_id, redirect_uris FROM oauth_clients WHERE disabled_at IS NOT NULL').all()) {
      if (have && c.client_id === have.client_id) continue;
      if (redirectsOf(c).some((x) => !isLocal(x) && hostOf(x).toLowerCase() === host)) return 'that address\'s host belongs to an app Just Send It switched off';
    }
    return null;
  }

  /* ---------- the first-party app (owner, 2026-11-03: one system, with sendy.gg its first app) ----------
     Seeded at every start from what the operator set (server.js reads the environment): reviewed, confidential, owned by
     no member, its secret known here only as the SHA-256 the operator gave. Without a hash it is not seeded, and a row
     left from before loses its secret, so it signs nobody in (clientRow) while every member's answer for it is kept for
     when it comes back. The admin's switch-off stands whatever the operator sets. */
  function seedFirstParty(spec) {
    const id = spec && spec.clientId;
    if (!FIRST_PARTY_IDS.has(id)) throw new Error('not a first-party client ID: ' + id);
    const have = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(id);
    const hash = String((spec && spec.secretHash) || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      if (have && have.secret_hash) db.prepare('UPDATE oauth_clients SET secret_hash = NULL, updated_at = ? WHERE client_id = ?').run(now(), id);
      if (spec && spec.secretHash) deps.log('Sign in with Send: ' + id + ' is not set up — its secret hash must be 64 hex characters (the SHA-256 of the secret)');
      return { seeded: false };
    }
    const redirect = String(spec.redirect || '').trim();
    const r = redirectUriRefusal(redirect);
    if (r) { deps.log('Sign in with Send: ' + id + ' is not set up — ' + r); if (have && have.secret_hash) db.prepare('UPDATE oauth_clients SET secret_hash = NULL WHERE client_id = ?').run(id); return { seeded: false }; }
    const t = now(), uris = JSON.stringify([redirect]);
    if (!have) {
      db.prepare('INSERT INTO oauth_clients (client_id, owner_id, name, description, homepage, redirect_uris, kind, secret_hash, secret_at, created_at, updated_at, reviewed_at, reviewed_by) VALUES (?,NULL,?,?,?,?,?,?,?,?,?,?,NULL)')
        .run(id, spec.name, spec.description || '', spec.homepage, uris, 'confidential', hash, t, t, t, t);
    } else if (have.secret_hash !== hash || have.redirect_uris !== uris || have.name !== spec.name || have.homepage !== spec.homepage || (have.description || '') !== (spec.description || '') || !have.reviewed_at || have.owner_id != null) {
      db.prepare('UPDATE oauth_clients SET owner_id = NULL, name = ?, description = ?, homepage = ?, redirect_uris = ?, kind = ?, secret_hash = ?, secret_at = CASE WHEN secret_hash IS ? THEN secret_at ELSE ? END, updated_at = ?, reviewed_at = COALESCE(reviewed_at, ?) WHERE client_id = ?')
        .run(spec.name, spec.description || '', spec.homepage, uris, 'confidential', hash, hash, t, t, t, id);
      // a redirect address that changed: the sign-ins waiting to go to the old one go too
      for (const [pid, e] of pending) if (e.clientId === id && e.redirectUri !== redirect) pending.delete(pid);
    }
    return { seeded: true };
  }

  /* ---------- consents ---------- */
  function consentOf(userId, clientId) {
    const r = db.prepare('SELECT * FROM oauth_consents WHERE user_id = ? AND client_id = ?').get(userId, clientId);
    return r ? { ...r, scopes: scopeList(r.scopes), asked: scopeList(r.asked) } : null;
  }
  /* the member's answer for the scopes on this page replaces their earlier answer for those; the rest stands. updated_at
     moves only when the answer CHANGED: an unchanged answer (prompt=consent, the same boxes) writes nothing, so the row
     never turns into a "last signed in" time */
  function saveConsent(userId, clientId, asked, ticked) {
    const prev = consentOf(userId, clientId);
    const askedAll = orderScopes([...new Set([...(prev ? prev.asked : []), ...asked])]);
    const kept = (prev ? prev.scopes : []).filter((s) => !asked.includes(s));
    const scopes = orderScopes([...new Set([...kept, ...ticked])]);
    if (prev) {
      if (scopes.join(' ') !== prev.scopes.join(' ') || askedAll.join(' ') !== prev.asked.join(' '))
        db.prepare('UPDATE oauth_consents SET scopes = ?, asked = ?, updated_at = ? WHERE user_id = ? AND client_id = ?').run(scopes.join(' '), askedAll.join(' '), now(), userId, clientId);
    } else db.prepare('INSERT INTO oauth_consents (user_id, client_id, scopes, asked, granted_at, updated_at) VALUES (?,?,?,?,?,?)').run(userId, clientId, scopes.join(' '), askedAll.join(' '), now(), now());
  }
  function revokeGrant(userId, clientId) {
    const n = db.prepare('DELETE FROM oauth_consents WHERE user_id = ? AND client_id = ?').run(userId, clientId).changes;
    db.prepare('DELETE FROM oauth_tokens WHERE user_id = ? AND client_id = ?').run(userId, clientId);
    db.prepare('DELETE FROM oauth_codes WHERE user_id = ? AND client_id = ?').run(userId, clientId);
    return n > 0;
  }
  function grantsOf(userId) {
    return db.prepare('SELECT c.*, k.name, k.homepage, k.redirect_uris, k.reviewed_at, k.disabled_at FROM oauth_consents c JOIN oauth_clients k ON k.client_id = c.client_id WHERE c.user_id = ? ORDER BY c.updated_at DESC').all(userId).map((r) => {
      const scopes = ['openid', ...orderScopes(scopeList(r.scopes))];
      const live = db.prepare("SELECT MAX(expires_at) t FROM oauth_tokens WHERE user_id = ? AND client_id = ? AND used_at IS NULL AND expires_at > ?").get(userId, r.client_id, now()).t;
      return { clientId: r.client_id, name: r.name, homepage: r.homepage, redirectHosts: [...new Set(redirectsOf(r).map((u) => { try { return new URL(u).host; } catch { return ''; } }).filter(Boolean))],
        reviewed: !!r.reviewed_at, disabled: !!r.disabled_at, scopes, shares: scopes.map((s) => ({ scope: s, label: SCOPE_BY[s].label })),
        grantedAt: r.granted_at, updatedAt: r.updated_at, signedInUntil: live || null };
    });
  }

  /* ---------- who may sign in to an app ---------- */
  // null when they may; otherwise why not, in a sentence for the page
  function memberRefusal(u) {
    if (!u || u.deleted_at) return { code: 'gone', text: 'That account no longer exists.' };
    if (u.system) return { code: 'system', text: 'This is the site\'s own account, which does not sign in to apps.' };
    const r = deps.restrictionOf(u);
    if (r) return { code: 'restricted', until: r.permanent ? null : r.until, text: 'Your account is in read-only mode' + (r.permanent ? ' until a moderator lifts it' : ' until ' + new Date(r.until).toUTCString().replace(/:\d\d GMT$/, ' UTC')) + ', so it cannot sign in to other apps until then.' };
    return null;
  }
  const userRow = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  // every live code and token of the member (a restriction): the consents stay, for when it lifts
  function revokeUser(userId) {
    db.prepare('DELETE FROM oauth_tokens WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM oauth_codes WHERE user_id = ?').run(userId);
  }
  /* A change to how the account is proved — a password change, "end other sessions", two-factor turned off (server.js
     calls this where it resets the sessions and the data-key secret): every app's grant ends, the consents with the codes
     and tokens, and the sign-ins waiting for the member. Whoever held a session the member just shut out may have let an
     app in with it; the next sign-in to each app asks again, "Confirm it's you" included. The private ids the apps know
     the member by are kept (oauth_subjects), so each app still recognises them when they come back. Returns how many apps. */
  function revokeAllGrants(userId) {
    const n = db.prepare('DELETE FROM oauth_consents WHERE user_id = ?').run(userId).changes;
    revokeUser(userId);
    for (const [id, e] of pending) if (e.userId === userId) pending.delete(id);
    return n;
  }
  // an account being erased: everything it allowed, its private ids in every app, and every app it registered (with everyone's sign-ins to them)
  function forgetUser(userId) {
    for (const r of db.prepare('SELECT client_id FROM oauth_clients WHERE owner_id = ?').all(userId)) deleteClient(r.client_id);
    db.prepare('DELETE FROM oauth_consents WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM oauth_subjects WHERE user_id = ?').run(userId);
    revokeUser(userId);
    for (const [id, e] of pending) if (e.userId === userId) pending.delete(id);
  }

  /* ---------- the claims ---------- */
  const pictureOf = (u) => (u.avatar_img && /^[A-Za-z0-9._-]{1,120}$/.test(u.avatar_img) && /\.(?:jpe?g|png|webp|gif|avif)$/i.test(u.avatar_img)) ? origin() + '/uploads/' + u.avatar_img : null;
  function memberValues(u) {
    const points = Math.max(0, Math.floor(Number(u.points) || 0)), level = deps.levelForXp(points);
    return { username: u.username, profile: origin() + '/u/' + encodeURIComponent(u.username), picture: pictureOf(u), sendId: deps.sendNoOf(u) || null,
      points, level, title: deps.titleFor(level), boost: deps.effectiveMult(u.id).total, verified: u.holder_state === 'ok' };
  }
  function claimsFor(u, scopes) {
    const v = memberValues(u), has = (s) => scopes.includes(s), out = {};
    if (has('send.handle')) { out.preferred_username = v.username; out.profile = v.profile; }
    if (has('send.picture') && v.picture) out.picture = v.picture;
    if (has('send.id') && v.sendId) out.send_id = v.sendId;
    if (has('send.power')) { out.send_power = v.points; out.send_level = v.level; out.send_title = v.title; }
    if (has('send.boost')) out.send_boost = v.boost;
    if (has('send.verified')) out.send_verified = v.verified;
    return out;
  }
  function idToken(u, clientId, scopes, authTime, nonce, accessToken) {
    const t = Math.floor(now() / 1000), { kid, key } = signingKey();
    const payload = { iss: origin(), sub: subFor(u.id, clientId), aud: clientId, iat: t, exp: t + ID_TTL_S };
    if (authTime) payload.auth_time = authTime;
    if (nonce) payload.nonce = nonce;
    // at_hash: the left half of SHA-256(access_token), base64url (OIDC Core §3.3.2.11), so the token and the ID go together
    if (accessToken) payload.at_hash = b64url(crypto.createHash('sha256').update(accessToken, 'ascii').digest().subarray(0, 16));
    Object.assign(payload, claimsFor(u, scopes));
    return signJwt(payload, kid, key);
  }

  /* ---------- tokens ----------
     A refresh token carries the CHAIN's start as its date (chainStart: when the code was swapped), never its own issue
     time, and a spent one only a flag: kept to the chain's end so a reuse is recognised, without a timeline of refreshes. */
  function issue({ client, user, scopes, grantId, authTime, nonce, refreshUntil, chainStart }) {
    const access = randTok(32), t = now();
    db.prepare("INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, scopes, grant_id, auth_time, created_at, expires_at) VALUES (?,'access',?,?,?,?,?,?,?)")
      .run(sha256hex(access), client.client_id, user.id, scopes.join(' '), grantId, authTime || null, t, t + ACCESS_TTL_MS);
    const out = { access_token: access, token_type: 'Bearer', expires_in: Math.round(ACCESS_TTL_MS / 1000), id_token: idToken(user, client.client_id, scopes, authTime, nonce, access), scope: scopes.join(' ') };
    if (scopes.includes('offline_access')) {
      const refresh = randTok(32), start = chainStart || t;
      db.prepare("INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, scopes, grant_id, auth_time, created_at, expires_at) VALUES (?,'refresh',?,?,?,?,?,?,?)")
        .run(sha256hex(refresh), client.client_id, user.id, scopes.join(' '), grantId, authTime || null, start, refreshUntil || start + REFRESH_TTL_MS);
      out.refresh_token = refresh;
    }
    return out;
  }
  const revokeChain = (grantId) => db.prepare('DELETE FROM oauth_tokens WHERE grant_id = ?').run(grantId).changes;

  /* ---------- housekeeping ---------- */
  function prune() {
    const t = now();
    try {
      db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').run(t - CODE_KEEP_MS);
      db.prepare('DELETE FROM oauth_tokens WHERE expires_at < ?').run(t);
      for (const k of keyStates(t)) if (k.state === 'retired' && k.retiredAt && k.retiredAt + KEY_KEEP_MS <= t) { db.prepare('DELETE FROM oauth_keys WHERE kid = ?').run(k.row.kid); keyCache.delete(k.row.kid); }
      for (const [id, e] of pending) if (e.expiresAt <= t) pending.delete(id);
      // the automatic rotation (OIDC_KEY_ROTATE_DAYS, 90 by default; 0 = only by hand)
      const days = deps.rotateDays();
      if (days > 0) { const cur = keyStates(t).find((k) => k.state === 'signing'); if (cur && t - cur.row.active_from > days * 864e5) rotateKey(); }
    } catch (e) { deps.log('Sign in with Send: housekeeping failed — ' + (e && e.message)); }
  }
  const timer = setInterval(prune, 10 * 60e3); if (timer.unref) timer.unref();
  const first = setTimeout(prune, 60e3); if (first.unref) first.unref();   // a server restarted more often than every ten minutes prunes too

  /* ---------- the pending sign-in requests (memory only) ----------
     Each remembers the network it came from (the address as the rate limits key it — an IPv6 /64 — and its /48), in memory
     only, so that one network can fill only its own share: past PENDING_PER_ADDR (or PENDING_PER_NET for a /48) its OWN
     oldest request goes, and when the whole map is full the oldest request of the network holding the most goes. A flood
     from many addresses therefore pushes out its own requests, never a member's sign-in in progress. */
  function netsOf(req) {
    let ip = ''; try { ip = String(deps.clientIp(req) || ''); } catch {}
    if (!ip || ip === 'unknown') ip = 'unknown';
    return { addr: ip, net: ip.includes(':') ? ip.split(':').slice(0, 3).join(':') + '::/48' : ip };
  }
  function addPending(e, req) {
    const t = now();
    for (const [id, x] of pending) if (x.expiresAt <= t) pending.delete(id);
    const n = netsOf(req);
    const oldestOf = (key, v, cap) => { let first = null, count = 0; for (const x of pending.values()) if (x[key] === v) { count++; if (!first) first = x; } if (count >= cap && first) pending.delete(first.id); };
    oldestOf('addr', n.addr, PENDING_PER_ADDR);
    if (n.net !== n.addr) oldestOf('net', n.net, PENDING_PER_NET);
    while (pending.size >= PENDING_MAX) {
      const per = new Map(); for (const x of pending.values()) per.set(x.net, (per.get(x.net) || 0) + 1);
      let top = null, most = 0; for (const [k, v] of per) if (v > most) { most = v; top = k; }
      for (const x of pending.values()) if (x.net === top) { pending.delete(x.id); break; }
    }
    e.id = randTok(18); e.createdAt = t; e.expiresAt = t + PENDING_TTL_MS; e.csrf = null; e.sidHash = undefined; e.userId = null;
    e.addr = n.addr; e.net = n.net;
    pending.set(e.id, e);
    return e;
  }
  const livePending = (id) => { const e = typeof id === 'string' ? pending.get(id) : null; return e && e.expiresAt > now() ? e : null; };
  // where a social sign-in (Google, X …) comes back to when it was started from an app's sign-in: the request, by its id only
  function resumePath(req) {
    const id = deps.parseCookies(req.headers.cookie)[PENDING_COOKIE];
    return livePending(id) ? ISS_PATHS.authorize + '?pending=' + encodeURIComponent(id) : null;
  }

  /* ---------- answers ---------- */
  const secure = () => /^https:/i.test(origin()) ? '; Secure' : '';
  const pendingCookie = (id) => PENDING_COOKIE + '=' + id + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.round(PENDING_TTL_MS / 1000) + secure();
  const clearPendingCookie = () => PENDING_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + secure();
  const hsts = () => (deps.secHeaders['Strict-Transport-Security'] ? { 'Strict-Transport-Security': deps.secHeaders['Strict-Transport-Security'] } : {});
  const NO_STORE = { 'Cache-Control': 'no-store, no-transform', Pragma: 'no-cache', Expires: '0' };
  const FRAME = { 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'WWW-Authenticate', 'Access-Control-Max-Age': '600', 'Cross-Origin-Resource-Policy': 'cross-origin' };
  function json(res, code, obj, opts = {}) {
    const body = obj == null ? '' : JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...(opts.cache ? { 'Cache-Control': opts.cache } : NO_STORE), ...FRAME,
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer',
      ...(opts.cors ? CORS : { 'Cross-Origin-Resource-Policy': 'same-origin' }), ...hsts(), ...(opts.headers || {}), 'Content-Length': Buffer.byteLength(body) });
    res.end(opts.head ? undefined : body);
  }
  const oauthError = (res, code, error, description, opts = {}) => json(res, code, { error, error_description: description }, opts);
  // the pages: nothing from any other host, ever (no beacon, no tag, no font, no picture), never framed, never cached
  function pageCsp(formTargets) {
    return ["default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'",
      "manifest-src 'self'", "form-action 'self'" + (formTargets ? ' ' + formTargets : ''), "frame-ancestors 'none'", "frame-src 'none'", "base-uri 'none'", "object-src 'none'"].join('; ');
  }
  function html(res, code, body, opts = {}) {
    const headers = { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE, ...FRAME, 'Content-Security-Policy': pageCsp(opts.formTargets),
      'Referrer-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', ...hsts(), 'Content-Length': Buffer.byteLength(body) };
    if (opts.cookie) headers['Set-Cookie'] = opts.cookie;
    res.writeHead(code, headers);
    res.end(body);
  }
  // the app's address with the answer on it (RFC 6749 §4.1.2 / §4.1.2.1), with iss (RFC 9207) so the app knows who answered
  function appUrl(redirectUri, params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v));
    q.set('iss', origin());
    return redirectUri + (redirectUri.includes('?') ? '&' : '?') + q.toString();
  }
  // back to the app; the app is told nothing else
  function toApp(res, redirectUri, params) {
    res.writeHead(302, { Location: appUrl(redirectUri, params), ...NO_STORE, ...FRAME,
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Set-Cookie': clearPendingCookie(), ...hsts() });
    res.end();
  }
  /* An error for the app. A reviewed app is sent it at once (RFC 6749 §4.1.2.1, prompt=none's silent answer included). An
     app nobody here has looked at is not: any member can register one with any https address in seconds, so an automatic
     redirect would make this site's own address a way to bounce anyone anywhere (RFC 9700 §4.11.2). The member is shown
     the error and where the app wanted them back, and goes there only by pressing the link. */
  function appError(res, c, redirectUri, params, heading, reason) {
    if (c.reviewed_at) return toApp(res, redirectUri, params);
    const host = hostOf(redirectUri);
    const extra = '<div class="oa-actions"><a class="btn btn-primary" href="' + esc(appUrl(redirectUri, params)) + '" rel="noreferrer nofollow" data-tip="Goes back to ' + esc(host) + ', the address this app registered, and tells it what went wrong">Go back to ' + esc(host) + '</a></div>';
    const main = '<div class="oa-card" id="oa-root" data-mode="app-error">' + brand + '<h1 class="oa-h1">' + esc(heading) + '</h1><p class="oa-lead">' + esc(reason) + '</p>'
      + '<p class="oa-note">' + esc(c.name) + ' has not been reviewed by Just Send It, so this site does not send you back to it on its own. Nothing was shared with it.</p>' + extra
      + '<div class="oa-actions"><a class="btn btn-ghost" href="/" data-tip="Opens the Just Send It home page instead">Go to Just Send It</a></div></div>';
    return html(res, 400, shell(heading + ' — Just Send It', main), { cookie: clearPendingCookie() });
  }
  const ver = (f) => { const v = deps.assetVer(f); return '/' + f + (v ? '?v=' + v : ''); };
  function shell(title, main, { signIn = false, wallet = false } = {}) {
    const js = (f) => '<script src="' + ver(f) + '"></script>';
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
      + '<title>' + esc(title) + '</title>\n<meta name="robots" content="noindex, nofollow">\n<meta name="referrer" content="same-origin">\n<meta name="theme-color" content="#c6f000">\n'
      + '<link rel="icon" href="' + ver('assets/logo-128.png') + '">\n<link rel="apple-touch-icon" sizes="180x180" href="' + ver('assets/logo-180.png') + '">\n'
      + '<link rel="stylesheet" href="' + ver('fonts/fonts.css') + '">\n<link rel="stylesheet" href="' + ver('styles.css') + '">\n<link rel="stylesheet" href="' + ver('cursor.css') + '">\n'
      + js('cursor.js') + '\n' + (signIn ? js('agegate.js') + '\n' : '')
      + '<link rel="stylesheet" href="' + ver('responsive.css') + '">\n<link rel="stylesheet" href="' + ver('oauth.css') + '">\n</head>\n<body class="oa-page">\n'
      + '<a class="skip-link" href="#main">Skip to the sign-in</a>\n<main id="main" class="oa-main">\n' + main + '\n</main>\n'
      + (signIn ? ['app.js', 'tips.js', 'wallet.js', 'auth.js', 'oauth.js'] : wallet ? ['tips.js', 'wallet.js', 'oauth.js'] : ['tips.js', 'oauth.js']).map(js).join('\n') + '\n</body>\n</html>\n';
  }
  const brand = '<p class="oa-brand"><img src="' + ver('assets/logo-mark-sm.png') + '" alt="" width="42" height="42"><span class="display">Sign in with Send</span></p>';
  const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  function hostOf(u) { try { return new URL(u).host; } catch { return ''; } }
  const isLocal = (u) => /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|\?|$)/.test(u);
  function appFacts(c, redirectUri) {
    const review = c.reviewed_at
      ? '<p class="oa-review oa-review-yes">Reviewed by Just Send It on ' + esc(fmtDate(c.reviewed_at)) + ': a person here looked at it. It is still run by its own developer, not by this site.</p>'
      : '<p class="oa-review oa-review-no">Not reviewed by Just Send It. It is run by its own developer, not by this site.</p>';
    // the homepage as an address is read: its host as the browser would go to it (an xn-- name stays xn--), and its path
    let hp = ''; try { const u = new URL(c.homepage); hp = u.host + (u.pathname === '/' ? '' : u.pathname); } catch { hp = ''; }
    return '<div class="oa-facts">' + review + '<dl class="oa-dl">'
      + '<div><dt>Its website</dt><dd><a href="' + esc(c.homepage) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(hp) + '</a></dd></div>'
      + '<div><dt>Sends you back to</dt><dd><code>' + esc(hostOf(redirectUri)) + '</code>' + (isLocal(redirectUri) ? ' (this device: an app still being built)' : '') + '</dd></div>'
      + (c.description ? '<div><dt>Its developer says</dt><dd>' + esc(c.description) + '</dd></div>' : '')
      + '</dl></div>';
  }
  function errorPage(res, code, heading, reason, extra = '') {
    const main = '<div class="oa-card">' + brand + '<h1 class="oa-h1">' + esc(heading) + '</h1><p class="oa-lead">' + esc(reason) + '</p>'
      + '<p class="oa-note">Nothing was shared with any app, and you have not been sent anywhere.</p>' + extra
      + '<div class="oa-actions"><a class="btn btn-ghost" href="/" data-tip="Opens the Just Send It home page instead">Go to Just Send It</a></div></div>';
    return html(res, code, shell(heading + ' — Just Send It', main));
  }
  function ensureCsrf(e, me) {
    const sidHash = me ? deps.hashToken(me.sid) : null;
    if (!e.csrf || e.sidHash !== sidHash) { e.csrf = randTok(32); e.sidHash = sidHash; }
    if (me) e.userId = me.id;   // whose page it is: revokeAllGrants drops it with the rest
    return e.csrf;
  }
  const hidden = (e, csrf) => '<input type="hidden" name="pending" value="' + esc(e.id) + '"><input type="hidden" name="csrf" value="' + esc(csrf) + '">';
  function signInPage(res, e, c) {
    const csrf = ensureCsrf(e, null), name = esc(c.name);
    const main = '<div class="oa-card" id="oa-root" data-pending="' + esc(e.id) + '" data-mode="signin">' + brand
      + '<h1 class="oa-h1">Sign in with your Send account to continue to <b class="oa-app-name">' + name + '</b></h1>' + appFacts(c, e.redirectUri)
      + '<p class="oa-lead">You sign in here, on ' + esc(hostOf(origin())) + ', the way you always do. ' + name + ' never sees your password, your email, your wallet or its signature. After you sign in, you choose what ' + name + ' may see.</p>'
      + '<div class="oa-actions"><button class="btn btn-primary" type="button" id="oa-signin" data-tip="Opens the Just Send It sign-in: a wallet, a burn proof, or an email and password">Sign in</button>'
      + '<form class="oa-inline" method="post" action="' + ISS_PATHS.authorize + '">' + hidden(e, csrf)
      + '<button class="btn btn-ghost" type="submit" name="decision" value="cancel" data-tip="Goes back to ' + name + ' without signing in, and tells it you said no">Cancel</button></form></div>'
      + '<p class="oa-note">New to Send? Joining is by invite: Sign in also lets you make an account with an invite code.</p></div>';
    return html(res, 200, shell('Sign in to ' + c.name + ' with Send — Just Send It', main, { signIn: true }), { formTargets: originOf(e.redirectUri), cookie: pendingCookie(e.id) });
  }
  function refusalPage(res, e, c, me, why) {
    const csrf = ensureCsrf(e, me), name = esc(c.name);
    const main = '<div class="oa-card" id="oa-root" data-pending="' + esc(e.id) + '" data-mode="refused">' + brand
      + '<h1 class="oa-h1">Your Send account cannot sign in to ' + name + ' right now</h1><p class="oa-lead">' + esc(why.text) + ' ' + name + ' gets nothing from it.</p>'
      + '<form class="oa-actions" method="post" action="' + ISS_PATHS.authorize + '">' + hidden(e, csrf)
      + '<button class="btn btn-ghost" type="submit" name="decision" value="cancel" data-tip="Goes back to ' + name + ' and tells it the sign-in did not happen">Back to ' + name + '</button></form></div>';
    return html(res, 403, shell('Sign in with Send — Just Send It', main), { formTargets: originOf(e.redirectUri) });
  }
  function scopeBox(s, v, checked) {
    let head, sub;
    switch (s) {
      case 'send.handle': head = 'Your handle: @' + v.username; sub = 'and the link to your public Send Wall'; break;
      case 'send.picture': head = 'Your profile picture'; sub = v.picture ? 'the address of the picture on your Send Wall' : 'you have none, so nothing would be shared'; break;
      case 'send.id': head = 'Your Send ID: #' + (v.sendId || '?'); sub = 'the same number in every app you share it with, so apps can recognise you across each other'; break;
      case 'send.power': head = 'Your Send Power: ' + v.points.toLocaleString('en-US') + ' · level ' + v.level + ' · ' + v.title; sub = 'as they are now, and as they change'; break;
      case 'send.boost': head = 'Your Send Boost: ' + v.boost + '×'; sub = 'the total only, never what it is made of'; break;
      case 'send.verified': head = 'Whether your wallet passed the holder check: ' + (v.verified ? 'yes' : 'no'); sub = 'not which wallet, and not how much it holds'; break;
      case 'offline_access': head = 'Keep these up to date for 30 days'; sub = 'without asking you to sign in again; you can revoke it any time'; break;
      default: return '';
    }
    return '<label class="oa-scope"><input type="checkbox" name="scope" value="' + esc(s) + '"' + (checked ? ' checked' : '') + '><span class="oa-scope-text"><b>' + esc(head) + '</b><span class="oa-scope-sub">' + esc(sub) + '</span></span></label>';
  }
  /* "Confirm it's you" on the consent page: the site's own step (ownershipRefusal), in the fields the account needs —
     its password, its two-factor code, a signature from a wallet old enough to vouch, or signing in again when signing in
     is the only proof it has. A plain form for the first two; the wallet's signature is the one part that needs the page's
     script (oauth.js, with the site's wallet.js). */
  function confirmBox(e, c, me, confirm) {
    const need = deps.verifyNeeds(me), name = esc(c.name);
    const lead = confirm.kind === 'fresh'
      ? name + ' asked for a fresh sign-in, so confirm it\u2019s you before it lets you in.'
      : 'This is the first time you are letting ' + name + ' in, so confirm it\u2019s you. It stops anyone using a browser you left signed in, or a copy of your session, from connecting an app to your account.';
    const err = confirm.error ? String(confirm.error).replace(/^confirm it\u2019s you first\s*[\u2014-]\s*/i, '').replace(/to unlock security changes|to make this change/g, 'to let ' + c.name + ' in') : '';
    let rows = '';
    if (need.password) rows += '<label class="oa-field"><span class="oa-field-label">Your Just Send It password</span><input class="oa-input" type="password" name="password" autocomplete="current-password" maxlength="1024"></label>';
    if (need.code) rows += '<label class="oa-field"><span class="oa-field-label">The 6-digit code from your authenticator app</span><input class="oa-input" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"></label>';
    if (need.wallet) rows += '<div class="oa-field"><span class="oa-field-label">' + (need.wallet === 'twofa' ? 'A signature from your two-factor wallet' : 'A signature from the wallet you made this account with, or one linked more than a day ago') + '</span>'
      + '<button class="btn btn-ghost" type="button" id="oa-wallet" data-tip="Asks your wallet for a free signature that proves it is yours: it moves nothing and approves nothing">Sign with wallet</button>'
      + '<input type="hidden" name="address" value=""><input type="hidden" name="signature" value=""><span class="oa-note oa-wallet-status" id="oa-wallet-status" role="status" aria-live="polite"></span>'
      + '<noscript><span class="oa-note">Signing with a wallet needs this page\u2019s script: turn JavaScript on for this site.</span></noscript></div>';
    if (need.signInAgain) rows += '<div class="oa-field"><span class="oa-field-label">This account has no password, two-factor or wallet old enough to vouch for it, so signing in again is the proof.</span>'
      + '<button class="btn btn-ghost" type="button" id="oa-again" data-tip="Signs you out of Just Send It here and opens this sign-in again, so you can sign in afresh">Sign in again</button></div>';
    return '<fieldset class="oa-confirm" id="oa-confirm"><legend class="oa-h2">Confirm it\u2019s you</legend><p class="oa-note oa-confirm-lead">' + lead + '</p>'
      + (err ? '<p class="oa-err" role="alert">' + esc(err.charAt(0).toUpperCase() + err.slice(1)) + '</p>' : '') + rows
      + '<p class="oa-note">This goes to Just Send It only, never to ' + name + '.</p></fieldset>';
  }
  // opts.confirm: { kind: 'first' | 'fresh', error }: ask "Confirm it's you" with Allow; opts.ticked: this page's own boxes, kept through a refused confirm
  function consentPage(res, e, c, me, prev, opts = {}) {
    const csrf = ensureCsrf(e, me), name = esc(c.name), v = memberValues(me);
    // every box starts unticked, every time: an earlier answer on file is the member's to give again, not ours to give for them
    const boxes = e.scopes.map((s) => scopeBox(s, v, !!(opts.ticked && opts.ticked.includes(s)))).join('');
    const confirm = opts.confirm ? confirmBox(e, c, me, opts.confirm) : '';
    const main = '<div class="oa-card" id="oa-root" data-pending="' + esc(e.id) + '" data-mode="consent"' + (confirm ? ' data-confirm="' + esc(opts.confirm.kind) + '"' : '') + '>' + brand
      + '<h1 class="oa-h1">Sign in to <b class="oa-app-name">' + name + '</b> with your Send account</h1>' + appFacts(c, e.redirectUri)
      + '<div class="oa-who"><p>You are signed in here as <b>@' + esc(me.username) + '</b>.</p><button class="btn btn-ghost btn-sm" type="button" id="oa-switch" data-tip="Signs you out of Just Send It on this browser so you can sign in with a different Send account">Use another account</button></div>'
      + '<form class="oa-form" method="post" action="' + ISS_PATHS.authorize + '">' + hidden(e, csrf)
      + '<h2 class="oa-h2">' + name + ' always gets</h2><p class="oa-always">A private ID for you in this app alone. Every app gets a different one, so apps cannot match you up by it.</p>'
      + (e.scopes.length
        ? '<fieldset class="oa-scopes"><legend class="oa-h2">Tick what else ' + name + ' may see</legend><p class="oa-note">Nothing is ticked for you: whatever you leave unticked is not shared.</p>' + boxes
          + (e.scopes.length > 1 ? '<button class="btn btn-ghost btn-sm oa-tickall" type="button" id="oa-tickall" hidden data-tip="Ticks every box above; untick any you would rather keep to yourself">Tick all ' + e.scopes.length + '</button>' : '') + '</fieldset>'
        : '<p class="oa-note">' + name + ' asked for nothing else.</p>')
      + '<p class="oa-never"><b>Never shared with any app:</b> your email, your wallets, your IP address, your sign-in history, your holdings, your OG tier and your communities.</p>'
      + '<p class="oa-keep"><b>What Just Send It keeps:</b> that you allowed ' + name + ', what you ticked and when, until you revoke it; and the private ID above, so ' + name + ' knows you again if you come back (it goes when your account does). While ' + name + ' stays signed in, its keys, stored scrambled, each deleted when it expires. No log of when or how you use ' + name + '.</p>'
      + confirm
      + '<div class="oa-actions"><button class="btn btn-primary" type="submit" name="decision" value="allow" data-tip="Sends you back to ' + name + ' with a one-time code for the ID and whatever you ticked">Allow</button>'
      + '<button class="btn btn-ghost" type="submit" name="decision" value="cancel" data-tip="Goes back to ' + name + ' without sharing anything, and tells it you said no">Cancel</button></div>'
      + '<p class="oa-note">Nothing reaches ' + name + ' until you press Allow. You can revoke it any time in <a href="/profile#sec-apps">Settings, under Apps you\'ve signed in to</a>.</p></form>'
      + '<p class="oa-note oa-foot">Sign in with Send is run by this site\'s own server. What ' + name + ' receives is signed with the keys published at <a href="' + ISS_PATHS.jwks + '">' + ISS_PATHS.jwks + '</a>, so it can check it without asking us again. <a href="/developers">For developers</a></p></div>';
    const wallet = !!(opts.confirm && deps.verifyNeeds(me).wallet);
    return html(res, opts.status || 200, shell('Sign in to ' + c.name + ' with Send — Just Send It', main, { wallet }), { formTargets: originOf(e.redirectUri) });
  }
  const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };

  /* ---------- /oauth/authorize ---------- */
  /* When the member last proved who they are, as far as this request is concerned: their sign-in, a "Confirm it's you"
     window still open, or a proof made on this very request's page. A sign-in made after the request arrived, or a proof
     made for it, counts as made FOR it (prompt=login, max_age=0, and the first Allow's "Confirm it's you"). */
  const provedHere = (e, me) => (e.provedAt && e.provedSid === deps.hashToken(me.sid)) ? e.provedAt : 0;
  const signedInHere = (e, me) => (me.sid_at && me.sid_at >= e.createdAt) ? me.sid_at : 0;
  const lastAuthOf = (e, me) => Math.max(me.sid_at || 0, (me.sudo_until > now() && me.sudo_since) || 0, provedHere(e, me));
  // OIDC Core 3.1.2.1: prompt=login asks for a fresh proof; max_age, for one no older than it
  function freshNeed(e, me) {
    if (provedHere(e, me) || signedInHere(e, me)) return false;
    if (e.prompt.includes('login')) return true;
    return e.maxAge != null && now() - lastAuthOf(e, me) > e.maxAge * 1000;
  }
  // which "Confirm it's you" this Allow needs: 'fresh' (the app asked for it), 'first' (the member's first Allow for this app), or none
  function confirmKind(e, me, prev) {
    if (provedHere(e, me) || signedInHere(e, me)) return null;
    if (freshNeed(e, me)) return 'fresh';
    if (!prev && !(me.sudo_until > now())) return 'first';
    return null;
  }
  /* auth_time. The session's sign-in time to the second would be the same in every app signed in from this browser for a
     month: a fingerprint two apps could match a member up by, whatever their subs say. So it is floored to the UTC hour
     (never later than the truth, so no app is told of a sign-in fresher than it was) — unless the app asked (max_age,
     prompt=login): then the coarsest step (hour, ten minutes, minute) that still answers its max_age, and for a proof made
     for this very sign-in, its exact time (a proof no other app shares). */
  function authTimeFor(e, me) {
    const asked = e.prompt.includes('login') || e.maxAge != null, here = Math.max(provedHere(e, me), signedInHere(e, me));
    if (asked && here) return Math.floor(here / 1000);
    const t = Math.floor(lastAuthOf(e, me) / 1000), n = Math.floor(now() / 1000), slack = CODE_TTL_MS / 1000;
    for (const step of [3600, 600, 60]) { const f = t - (t % step); if (e.maxAge == null || n - f + slack <= e.maxAge) return f; }
    return t;
  }
  function issueCode(res, e, c, me, granted) {
    const code = randTok(32);
    subFor(me.id, c.client_id);   // the member's private id in this app: made at the first grant, the same ever after
    db.prepare('INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, scopes, challenge, nonce, auth_time, grant_id, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(sha256hex(code), c.client_id, me.id, e.redirectUri, ['openid', ...granted].join(' '), e.challenge, e.nonce || null, authTimeFor(e, me), randTok(18), now() + CODE_TTL_MS);
    pending.delete(e.id);
    return toApp(res, e.redirectUri, { code, state: e.state });
  }
  const NO_SESSION = 'no Just Send It sign-in came with this request';
  function proceed(req, res, e) {
    const c = clientRow(e.clientId);
    if (!c || c.disabled_at) { pending.delete(e.id); return errorPage(res, 400, 'This app cannot sign anyone in', c ? 'It has been switched off by Just Send It.' : 'It is no longer registered.'); }
    const me = deps.getUser(req), none = e.prompt.includes('none');
    // prompt=none's answer, shown nothing (a reviewed app) — or shown to the member with a link back (one nobody reviewed: appError)
    const silent = (error, description, heading, reason) => { pending.delete(e.id); return appError(res, c, e.redirectUri, { error, error_description: description, state: e.state }, heading, reason); };
    if (!me) {
      if (none) return silent('login_required', NO_SESSION, 'Sign in to Just Send It first', c.name + ' asked to sign you in without showing you anything, but you are not signed in to Just Send It on this browser.');
      return signInPage(res, e, c);
    }
    const why = memberRefusal(me);
    if (why) {
      // answered exactly as a signed-out visitor is: what moderation said about an account is nobody's business but its owner's
      if (none) return silent('login_required', NO_SESSION, 'Your Send account cannot sign in to apps right now', why.text);
      return refusalPage(res, e, c, me, why);
    }
    if (none && freshNeed(e, me)) return silent('login_required', 'the member signed in longer ago than max_age allows', 'Sign in again first', c.name + ' asked for a recent sign-in, without showing you anything.');
    const prev = consentOf(me.id, c.client_id);
    const covered = !!prev && e.scopes.every((s) => prev.asked.includes(s));
    const ask = e.prompt.includes('consent') || e.prompt.includes('select_account');
    if (covered && !ask && !freshNeed(e, me)) return issueCode(res, e, c, me, e.scopes.filter((s) => prev.scopes.includes(s)));
    if (none) return silent('consent_required', 'the member has not answered for these scopes yet', 'You have not allowed ' + c.name + ' yet', c.name + ' asked to sign you in without showing you anything, but you have not allowed it to see what it asked for.');
    const kind = confirmKind(e, me, prev);
    return consentPage(res, e, c, me, prev, kind ? { confirm: { kind } } : {});
  }
  function authorizeGet(req, res, url) {
    const q = url.searchParams, keys = [...new Set(q.keys())];
    // the way back after signing in: the request by its id, nothing else (twofa=1 is auth.js's own marker for a social sign-in's second step)
    if (keys.length && keys.every((k) => k === 'pending' || k === 'twofa')) {
      const e = q.getAll('pending').length === 1 ? livePending(q.get('pending')) : null;
      if (!e) return errorPage(res, 400, 'This sign-in request has expired', 'It was opened more than ten minutes ago, or it has already been answered. Go back to the app and start again.');
      return proceed(req, res, e);
    }
    // 1. the app, then its redirect URI, exactly: until both are right there is nowhere safe to send anyone, so nobody is sent
    const ids = q.getAll('client_id'), c = ids.length === 1 ? clientRow(ids[0]) : null;
    if (!c) return errorPage(res, 400, 'This sign-in link is not from a registered app', ids.length > 1 ? 'It names more than one app.' : ids.length ? 'No app is registered under the ID it carries.' : 'It carries no app ID at all.');
    if (c.disabled_at) return errorPage(res, 400, 'This app cannot sign anyone in', c.name + ' has been switched off by Just Send It.');
    const rus = q.getAll('redirect_uri'), redirectUri = rus.length === 1 ? rus[0] : null;
    if (!redirectUri || !redirectsOf(c).includes(redirectUri)) return errorPage(res, 400, 'This sign-in link sends you to an address the app never registered', c.name + ' asked to send you back to ' + (redirectUri ? 'an address' : 'no address') + ' it has not registered here, so you have not been sent anywhere.');
    // an address no answer can be written to (registered before only plain ASCII was allowed): nothing is saved, nobody is sent
    if (NOT_PLAIN_ASCII.test(redirectUri)) return errorPage(res, 400, 'This app\'s address cannot be used', c.name + ' registered an address this site cannot send you back to (it is not written in plain ASCII), so you have not been sent anywhere.');
    // 2. from here on, a problem goes back to the app (RFC 6749 §4.1.2.1), with its state when it sent one — at once for a reviewed app, by the member's own press for any other (appError)
    const stateArr = q.getAll('state'), state0 = stateArr.length === 1 ? stateArr[0] : null;
    const back = (error, description) => appError(res, c, redirectUri, { error, error_description: description, state: state0 && state0.length <= PARAM_MAX ? state0 : null },
      'This sign-in link has a mistake in it', c.name + ' sent a sign-in request this site cannot accept (' + description + '). Nothing was shared, and its developer can fix it.');
    for (const k of keys) if (q.getAll(k).length > 1) return back('invalid_request', k + ' was sent more than once');
    if (q.has('request')) return back('request_not_supported', 'request objects are not supported');
    if (q.has('request_uri')) return back('request_uri_not_supported', 'request_uri is not supported');
    if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'only response_type=code');
    if (q.has('response_mode') && q.get('response_mode') !== 'query') return back('invalid_request', 'only response_mode=query');
    const state = q.get('state');
    if (!state) return back('invalid_request', 'state is required');
    if (state.length > PARAM_MAX || /[\u0000-\u001f\u007f]/.test(state)) return back('invalid_request', 'state is at most ' + PARAM_MAX + ' printable characters');
    const cc = q.get('code_challenge'), ccm = q.get('code_challenge_method');
    if (!cc) return back('invalid_request', 'PKCE is required: send code_challenge with code_challenge_method=S256');
    if (ccm !== 'S256') return back('invalid_request', 'code_challenge_method must be S256 (plain is refused)');
    if (!/^[A-Za-z0-9_-]{43}$/.test(cc)) return back('invalid_request', 'code_challenge is the base64url SHA-256 of the code_verifier: 43 characters');
    const scopes = scopeList(q.get('scope'));
    if (!scopes.includes('openid')) return back('invalid_scope', 'the openid scope is required');
    const nonce = q.get('nonce');
    if (nonce != null && (nonce.length > PARAM_MAX || /[\u0000-\u001f\u007f]/.test(nonce))) return back('invalid_request', 'nonce is at most ' + PARAM_MAX + ' printable characters');
    const prompt = scopeList(q.get('prompt'));
    if (prompt.includes('none') && prompt.length > 1) return back('invalid_request', 'prompt=none cannot be combined with another prompt');
    const ma = q.get('max_age');
    if (ma != null && !/^\d{1,9}$/.test(ma)) return back('invalid_request', 'max_age is a whole number of seconds');
    // unknown scopes (profile, email …) are left out, never refused: the token's scope says what was granted
    const e = addPending({ clientId: c.client_id, redirectUri, state, nonce: nonce || null, challenge: cc, prompt, maxAge: ma == null ? null : Number(ma), scopes: orderScopes(scopes.filter((s) => SCOPE_SET.has(s))) }, req);
    return proceed(req, res, e);
  }
  function sameOriginPost(req) {
    const o = req.headers.origin;
    if (o) return o === originOf(origin());
    const r = req.headers.referer;
    if (r) return originOf(r) === originOf(origin());
    return false;   // a browser posting this form sends one of them; anything that sends neither is not the consent page
  }
  async function authorizePost(req, res) {
    if (!sameOriginPost(req)) return errorPage(res, 403, 'That answer did not come from this site', 'A sign-in can only be answered from its own page here.');
    if (!isForm(req)) return errorPage(res, 400, 'That answer could not be read', 'It was not sent by the sign-in page.');
    let f; try { f = await readForm(req, 16 * 1024); } catch (err) { return errorPage(res, err.status || 400, 'That answer could not be read', 'It was too large or did not arrive.'); }
    for (const k of ['pending', 'csrf', 'decision']) if (f.getAll(k).length !== 1) return errorPage(res, 400, 'That answer could not be read', 'It was not sent by the sign-in page.');
    for (const k of ['password', 'code', 'address', 'signature']) if (f.getAll(k).length > 1) return errorPage(res, 400, 'That answer could not be read', 'It was not sent by the sign-in page.');
    const e = livePending(f.get('pending'));
    if (!e) return errorPage(res, 400, 'This sign-in request has expired', 'It was opened more than ten minutes ago, or it has already been answered. Go back to the app and start again.');
    const me = deps.getUser(req), sidHash = me ? deps.hashToken(me.sid) : null;
    if (!e.csrf || e.sidHash !== sidHash || !sameSecret(f.get('csrf'), e.csrf)) {
      return errorPage(res, 400, 'This page is out of date', 'It was opened for a different sign-in, or you signed in or out since. Open it again to carry on.',
        '<div class="oa-actions"><a class="btn btn-primary" href="' + ISS_PATHS.authorize + '?pending=' + esc(encodeURIComponent(e.id)) + '" data-tip="Opens this sign-in again, as you are signed in now">Open it again</a></div>');
    }
    const c = clientRow(e.clientId);
    if (!c || c.disabled_at) { pending.delete(e.id); return errorPage(res, 400, 'This app cannot sign anyone in', c ? 'It has been switched off by Just Send It.' : 'It is no longer registered.'); }
    const decision = f.get('decision');
    if (decision === 'cancel') { pending.delete(e.id); return toApp(res, e.redirectUri, { error: 'access_denied', error_description: 'the member said no', state: e.state }); }
    if (decision !== 'allow' || !me) return proceed(req, res, e);
    const why = memberRefusal(me);
    if (why) return refusalPage(res, e, c, me, why);
    const ticked = e.scopes.filter((s) => f.getAll('scope').includes(s));   // only what the app asked for AND the member ticked
    /* "Confirm it's you" before anything is saved: the site's own ownershipRefusal, on the member's first Allow for this app
       (a session inside its unlocked window passes, as it does for every security change), and a FRESH proof when the app
       asked for one (prompt=login, max_age) — the open window does not count for that, only a proof made now. */
    const prev = consentOf(me.id, c.client_id), kind = confirmKind(e, me, prev);
    if (kind) {
      const proof = { password: f.get('password') || '', code: f.get('code') || '', address: f.get('address') || '', signature: f.get('signature') || '' };
      const err = await deps.ownershipRefusal(kind === 'fresh' ? { ...me, sudo_until: 0 } : me, proof);
      if (err) return consentPage(res, e, c, me, prev, { confirm: { kind, error: err }, ticked, status: 401 });
      e.provedAt = now(); e.provedSid = sidHash;
    }
    saveConsent(me.id, c.client_id, e.scopes, ticked);
    return issueCode(res, e, c, me, ticked);
  }

  /* ---------- client authentication (the token and revoke endpoints) ---------- */
  function clientAuth(req, f) {
    let basic = null;
    const h = String(req.headers.authorization || '');
    if (/^Basic\s+/i.test(h)) {
      const raw = Buffer.from(h.replace(/^Basic\s+/i, '').trim(), 'base64').toString('utf8'), i = raw.indexOf(':');
      const dec = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return null; } };
      basic = i < 0 ? { id: dec(raw), secret: '' } : { id: dec(raw.slice(0, i)), secret: dec(raw.slice(i + 1)) };
      if (basic.id == null || basic.secret == null) return { error: 'invalid_client', why: 'the Basic credentials could not be read', basic: true };
    }
    if (f.getAll('client_id').length > 1 || f.getAll('client_secret').length > 1) return { error: 'invalid_request', why: 'client_id or client_secret was sent more than once' };
    const postId = f.get('client_id'), postSecret = f.get('client_secret');
    if (basic && postSecret) return { error: 'invalid_request', why: 'use one way to authenticate: client_secret_basic or client_secret_post, not both' };
    if (basic && postId && postId !== basic.id) return { error: 'invalid_request', why: 'client_id does not match the Basic credentials' };
    const id = basic ? basic.id : postId, secret = basic ? basic.secret : postSecret;
    const c = clientRow(id);
    if (!c) { sameSecret(secret, 'x'); return { error: 'invalid_client', why: 'no app is registered under that client_id', basic: !!basic }; }
    if (c.disabled_at) return { error: 'invalid_client', why: 'this app has been switched off by Just Send It', basic: !!basic };
    if (c.kind === 'confidential') {
      // the secret is compared as its SHA-256 against the stored SHA-256, in constant time
      const got = secret ? crypto.createHash('sha256').update(String(secret)).digest() : null, want = c.secret_hash ? Buffer.from(c.secret_hash, 'hex') : null;
      if (!got || !want || want.length !== 32 || !crypto.timingSafeEqual(got, want)) return { error: 'invalid_client', why: 'the client secret is missing or wrong', basic: !!basic };
    } else if (secret) return { error: 'invalid_client', why: 'a public app has no secret: send client_id alone (PKCE is its proof)', basic: !!basic };
    return { client: c };
  }

  const basicChallenge = () => ({ 'WWW-Authenticate': 'Basic realm="' + hostOf(origin()) + '"' });
  // a refused client authentication, as RFC 6749 §5.2 has it: 401, and the Basic challenge when Basic was used
  const clientRefusal = (a) => ({ code: a.error === 'invalid_client' ? 401 : 400, headers: a.error === 'invalid_client' && a.basic ? basicChallenge() : {} });
  /* The token endpoint's limits, per APP with generous per-address backstops (LIMITS): a request refused for what it carried
     counts against its address — or, for a server app that proved its secret, against that app — and never spends a public
     app's budget, which only its requests that got as far as a real code or refresh token of its own can spend. */
  async function token(req, res) {
    const ip = deps.clientIp(req);
    const answer = (code, error, description, headers) => oauthError(res, code, error, description, { cors: true, headers: headers || {} });
    if (!deps.rateLimit('oa-token-ip:' + ip, LIMITS.tokenAddr, 60e3)) return answer(429, 'slow_down', 'too many requests from this address: wait a minute');
    let proved = null;   // the app, once it has proved its secret (its every request has spent its own budget by then)
    const refuse = (code, error, description, headers) => {
      if (!proved) deps.rateLimit('oa-token-bad:' + ip, Infinity, 60e3);
      return answer(code, error, description, headers);
    };
    const blocked = () => deps.rateHits('oa-token-bad:' + ip, 60e3) >= LIMITS.tokenRefused;
    const slow = () => answer(429, 'slow_down', 'too many refused token requests from this address: wait a minute');
    if (!isForm(req)) return blocked() ? slow() : refuse(400, 'invalid_request', 'send the request as application/x-www-form-urlencoded');
    let f; try { f = await readForm(req); } catch (err) { return blocked() ? slow() : refuse(err.status || 400, 'invalid_request', err.message); }
    for (const k of new Set(f.keys())) if (f.getAll(k).length > 1) return blocked() ? slow() : refuse(400, 'invalid_request', k + ' was sent more than once');
    const a = clientAuth(req, f);
    const confidential = !a.error && a.client.kind === 'confidential';
    if (!confidential && blocked()) return slow();
    if (a.error) { const r = clientRefusal(a); return refuse(r.code, a.error, a.why, r.headers); }
    const c = a.client;
    const spend = () => deps.rateLimit('oa-token-client:' + c.client_id, LIMITS.tokenApp, 60e3);
    const appSlow = () => answer(429, 'slow_down', 'too many token requests for this app: wait a minute');
    if (confidential) { proved = c; if (!spend()) return appSlow(); }   // only its own secret can spend a server app's budget
    const gt = f.get('grant_type');
    if (!gt) return refuse(400, 'invalid_request', 'grant_type is required: authorization_code or refresh_token');
    if (gt === 'authorization_code') {
      const code = f.get('code');
      if (!code) return refuse(400, 'invalid_request', 'code is required');
      const row = db.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').get(sha256hex(code));
      if (!row) return refuse(400, 'invalid_grant', 'that code is not one of ours, or it has expired');
      // a public app's budget, spent by a real code of its own — and before the code is spent, so a refused one still works a moment later
      if (!confidential && row.client_id === c.client_id && !spend()) return appSlow();
      // single use, and the first attempt spends it — a second presentation of a spent code revokes everything it issued
      if (db.prepare('UPDATE oauth_codes SET used_at = 1 WHERE code_hash = ? AND used_at IS NULL').run(row.code_hash).changes !== 1) {
        revokeChain(row.grant_id);
        return refuse(400, 'invalid_grant', 'that code was already used: everything issued from it has been revoked');
      }
      if (row.client_id !== c.client_id) return refuse(400, 'invalid_grant', 'that code was issued to another app');
      if (row.expires_at <= now()) return refuse(400, 'invalid_grant', 'that code has expired (they last 60 seconds)');
      if (f.get('redirect_uri') !== row.redirect_uri) return refuse(400, 'invalid_grant', 'redirect_uri must be exactly the one sent to /oauth/authorize');
      const v = f.get('code_verifier');
      if (!v || !/^[A-Za-z0-9\-._~]{43,128}$/.test(v) || !sameSecret(pkceS256(v), row.challenge)) return refuse(400, 'invalid_grant', 'the PKCE code_verifier does not match the code_challenge');
      const u = userRow(row.user_id);
      if (memberRefusal(u)) { revokeUser(row.user_id); return refuse(400, 'invalid_grant', 'this account cannot sign in to apps right now'); }
      const cons = consentOf(u.id, c.client_id);
      if (!cons) return refuse(400, 'invalid_grant', 'the member has revoked this app');
      const scopes = ['openid', ...orderScopes(scopeList(row.scopes).filter((s) => s !== 'openid' && cons.scopes.includes(s)))];
      return json(res, 200, issue({ client: c, user: u, scopes, grantId: row.grant_id, authTime: row.auth_time, nonce: row.nonce, chainStart: now() }), { cors: true });
    }
    if (gt === 'refresh_token') {
      const rt = f.get('refresh_token');
      if (!rt) return refuse(400, 'invalid_request', 'refresh_token is required');
      const row = db.prepare("SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'").get(sha256hex(rt));
      if (!row) return refuse(400, 'invalid_grant', 'that refresh token is not one of ours, or it has expired or been revoked');
      if (row.client_id !== c.client_id) { revokeChain(row.grant_id); return refuse(400, 'invalid_grant', 'that refresh token was issued to another app: its chain is revoked'); }
      if (!confidential && !spend()) return appSlow();
      const reused = () => { revokeChain(row.grant_id); return refuse(400, 'invalid_grant', 'that refresh token was already used: every token from this sign-in has been revoked (sign in again)'); };
      if (row.used_at != null) return reused();
      if (row.expires_at <= now()) return refuse(400, 'invalid_grant', 'this sign-in is more than 30 days old: sign in again');
      const u = userRow(row.user_id);
      if (memberRefusal(u)) { revokeUser(row.user_id); return refuse(400, 'invalid_grant', 'this account cannot sign in to apps right now'); }
      const cons = consentOf(u.id, c.client_id);
      if (!cons || !cons.scopes.includes('offline_access')) { revokeChain(row.grant_id); return refuse(400, 'invalid_grant', 'the member has revoked this app'); }
      let scopes = ['openid', ...orderScopes(scopeList(row.scopes).filter((s) => s !== 'openid' && cons.scopes.includes(s)))];
      if (f.has('scope')) {
        // checked before the token is spent: a request that asks for too much is refused and the token still works
        const want = scopeList(f.get('scope'));
        if (want.some((s) => !scopes.includes(s))) return refuse(400, 'invalid_scope', 'a refresh can only narrow the scopes, never add one');
        scopes = ['openid', ...orderScopes(want.filter((s) => s !== 'openid'))];
        if (!scopes.includes('offline_access')) scopes.push('offline_access');   // the chain goes on: dropping it is what /oauth/revoke is for
      }
      // rotation: this refresh token is spent now — a flag, no time (a second, racing use finds it spent and revokes the chain)
      if (db.prepare('UPDATE oauth_tokens SET used_at = 1 WHERE token_hash = ? AND used_at IS NULL').run(row.token_hash).changes !== 1) return reused();
      return json(res, 200, issue({ client: c, user: u, scopes, grantId: row.grant_id, authTime: row.auth_time, refreshUntil: row.expires_at, chainStart: row.created_at }), { cors: true });
    }
    return refuse(400, 'unsupported_grant_type', 'grant_type is authorization_code or refresh_token');
  }

  // a live access token, its member and what it may read — or null (and, when the account or the app has gone, its tokens with it)
  function bearer(req) {
    const m = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)\s*$/i.exec(String(req.headers.authorization || ''));
    if (!m) return null;
    const row = db.prepare("SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'").get(sha256hex(m[1]));
    if (!row || row.expires_at <= now()) return null;
    const c = clientRow(row.client_id);
    if (!c || c.disabled_at) { dropClientGrants(row.client_id); return null; }
    const u = userRow(row.user_id);
    if (memberRefusal(u)) { revokeUser(row.user_id); return null; }
    const cons = consentOf(u.id, c.client_id);
    if (!cons) { revokeGrant(u.id, c.client_id); return null; }
    return { row, client: c, user: u, scopes: ['openid', ...scopeList(row.scopes).filter((s) => s !== 'openid' && cons.scopes.includes(s))] };
  }
  /* userinfo: limited per app (and per token), with a generous per-address backstop; requests with no live token count
     against their address. The answer names the app the token was issued to (aud and client_id), so a backend handed an
     access token by a browser can tell another app's token for the same member from its own. */
  async function userinfo(req, res) {
    const ip = deps.clientIp(req);
    if (!deps.rateLimit('oa-ui-ip:' + ip, LIMITS.uiAddr, 60e3)) return oauthError(res, 429, 'slow_down', 'too many requests from this address: wait a minute', { cors: true });
    if (deps.rateHits('oa-ui-bad:' + ip, 60e3) >= LIMITS.uiRefused) return oauthError(res, 429, 'slow_down', 'too many requests without a live token from this address: wait a minute', { cors: true });
    if (req.method === 'POST') { try { if (isForm(req)) await readForm(req, 4096); } catch {} }
    const b = bearer(req);
    if (!b) {
      deps.rateLimit('oa-ui-bad:' + ip, Infinity, 60e3);
      // RFC 6750 §3.1: a request that carried no credentials at all is told to bring some, with no error code in the challenge
      const sent = !!req.headers.authorization;
      return json(res, 401, { error: 'invalid_token', error_description: 'send a live access token as Authorization: Bearer <token>' },
        { cors: true, headers: { 'WWW-Authenticate': 'Bearer realm="' + hostOf(origin()) + '"' + (sent ? ', error="invalid_token"' : '') } });
    }
    if (!deps.rateLimit('oa-ui-client:' + b.client.client_id, LIMITS.uiApp, 60e3)) return oauthError(res, 429, 'slow_down', 'too many userinfo requests for this app: wait a minute', { cors: true });
    if (!deps.rateLimit('oa-ui-tok:' + b.row.token_hash, LIMITS.uiToken, 60e3)) return oauthError(res, 429, 'slow_down', 'too many requests with this token: wait a minute', { cors: true });
    return json(res, 200, { sub: subFor(b.user.id, b.client.client_id), aud: b.client.client_id, client_id: b.client.client_id, ...claimsFor(b.user, b.scopes) }, { cors: true });
  }
  async function revoke(req, res) {
    if (!deps.rateLimit('oa-revoke-ip:' + deps.clientIp(req), 120, 60e3)) return oauthError(res, 429, 'slow_down', 'too many requests from this address: wait a minute', { cors: true });
    if (!isForm(req)) return oauthError(res, 400, 'invalid_request', 'send the request as application/x-www-form-urlencoded', { cors: true });
    let f; try { f = await readForm(req); } catch (err) { return oauthError(res, err.status || 400, 'invalid_request', err.message, { cors: true }); }
    const a = clientAuth(req, f);
    if (a.error) { const r = clientRefusal(a); return oauthError(res, r.code, a.error, a.why, { cors: true, headers: r.headers }); }
    const t = f.get('token');
    if (!t) return oauthError(res, 400, 'invalid_request', 'token is required', { cors: true });
    const row = db.prepare('SELECT * FROM oauth_tokens WHERE token_hash = ?').get(sha256hex(t));
    // RFC 7009: an unknown token, or another app's, is answered the same 200 — and nothing is done for another app
    if (row && row.client_id === a.client.client_id) {
      if (row.kind === 'refresh') revokeChain(row.grant_id);   // a refresh token takes its whole chain (the access tokens with it)
      else db.prepare('DELETE FROM oauth_tokens WHERE token_hash = ?').run(row.token_hash);
    }
    return json(res, 200, {}, { cors: true });
  }
  /* RFC 7662 introspection, for an app's OWN tokens: a token issued to another app is answered exactly as an unknown one
     ({ active: false }), so a backend that introspects what a browser handed it learns whether the token is its own, and
     never anything about another app's. Nothing beyond the token's own facts (no claims: those are userinfo's, by scope). */
  async function introspect(req, res) {
    const ip = deps.clientIp(req);
    if (!deps.rateLimit('oa-intro-ip:' + ip, LIMITS.introspectAddr, 60e3)) return oauthError(res, 429, 'slow_down', 'too many requests from this address: wait a minute', { cors: true });
    if (deps.rateHits('oa-intro-bad:' + ip, 60e3) >= LIMITS.tokenRefused) return oauthError(res, 429, 'slow_down', 'too many refused requests from this address: wait a minute', { cors: true });
    const refuse = (code, error, description, headers) => { deps.rateLimit('oa-intro-bad:' + ip, Infinity, 60e3); return oauthError(res, code, error, description, { cors: true, headers: headers || {} }); };
    if (!isForm(req)) return refuse(400, 'invalid_request', 'send the request as application/x-www-form-urlencoded');
    let f; try { f = await readForm(req); } catch (err) { return refuse(err.status || 400, 'invalid_request', err.message); }
    const a = clientAuth(req, f);
    if (a.error) { const r = clientRefusal(a); return refuse(r.code, a.error, a.why, r.headers); }
    const c = a.client;
    if (!deps.rateLimit('oa-intro-client:' + c.client_id, LIMITS.introspectApp, 60e3)) return oauthError(res, 429, 'slow_down', 'too many introspection requests for this app: wait a minute', { cors: true });
    const t = f.get('token');
    if (!t) return refuse(400, 'invalid_request', 'token is required');
    const row = db.prepare('SELECT * FROM oauth_tokens WHERE token_hash = ?').get(sha256hex(t));
    const inactive = () => json(res, 200, { active: false }, { cors: true });
    if (!row || row.client_id !== c.client_id || row.used_at != null || row.expires_at <= now()) return inactive();
    const u = userRow(row.user_id);
    if (memberRefusal(u)) { revokeUser(row.user_id); return inactive(); }
    const cons = consentOf(u.id, c.client_id);
    if (!cons) { revokeGrant(u.id, c.client_id); return inactive(); }
    const scopes = ['openid', ...orderScopes(scopeList(row.scopes).filter((s) => s !== 'openid' && cons.scopes.includes(s)))];
    return json(res, 200, { active: true, iss: origin(), client_id: c.client_id, aud: c.client_id, sub: subFor(u.id, c.client_id), scope: scopes.join(' '),
      token_type: row.kind === 'access' ? 'Bearer' : 'refresh_token', exp: Math.floor(row.expires_at / 1000), iat: Math.floor(row.created_at / 1000) }, { cors: true });
  }
  /* The handles check (owner, 2026-11-03: "SendRH.com members' handles are theirs in sendy.gg too"). A reviewed server app
     (it proves its secret) sends up to 50 @handles — JSON { handles: [...] }, or a form with handles repeated — and learns,
     for each, yes or no: whether it is an account's handle here. Nothing more about anyone: not who, not since when. Case
     does not matter; a deleted account's "deleted-<id>" name is never a yes. No CORS: it is for an app's server. */
  const DELETED_NAME_RE = /^deleted-\d+(-[0-9a-f]+)?$/i;
  async function handles(req, res) {
    const ip = deps.clientIp(req);
    const answer = (code, error, description, headers) => oauthError(res, code, error, description, { headers: headers || {} });
    if (!deps.rateLimit('oa-handles-ip:' + ip, LIMITS.handlesAddr, 60e3)) return answer(429, 'slow_down', 'too many requests from this address: wait a minute');
    if (deps.rateHits('oa-handles-bad:' + ip, 60e3) >= LIMITS.tokenRefused) return answer(429, 'slow_down', 'too many refused requests from this address: wait a minute');
    const refuse = (code, error, description, headers) => { deps.rateLimit('oa-handles-bad:' + ip, Infinity, 60e3); return answer(code, error, description, headers); };
    let f, list;
    if (/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) {
      let j; try { j = JSON.parse(await readText(req, 16 * 1024)); } catch (err) { return refuse(err.status || 400, 'invalid_request', 'the body is not JSON'); }
      if (!j || typeof j !== 'object' || Array.isArray(j)) return refuse(400, 'invalid_request', 'send { "handles": ["alice", "bob"] }');
      f = new URLSearchParams();
      for (const k of ['client_id', 'client_secret']) if (typeof j[k] === 'string') f.set(k, j[k]);
      list = j.handles;
    } else if (isForm(req)) {
      try { f = await readForm(req); } catch (err) { return refuse(err.status || 400, 'invalid_request', err.message); }
      list = f.getAll('handles').flatMap((v) => v.split(/[\s,]+/)).filter(Boolean);
    } else return refuse(400, 'invalid_request', 'send JSON { "handles": [...] } or a form');
    const a = clientAuth(req, f);
    if (a.error) { const r = clientRefusal(a); return refuse(r.code, a.error, a.why, r.headers); }
    const c = a.client;
    if (c.kind !== 'confidential' || !c.reviewed_at) return refuse(403, 'unauthorized_client', 'only a server app reviewed by Just Send It may check handles');
    if (!deps.rateLimit('oa-handles-client:' + c.client_id, LIMITS.handlesApp, 60e3)) return answer(429, 'slow_down', 'too many handle checks for this app: wait a minute');
    if (!Array.isArray(list) || !list.length || list.length > 50 || list.some((h) => typeof h !== 'string' || h.length > 64)) return answer(400, 'invalid_request', 'handles is a list of 1 to 50 @handles');
    const out = {}, taken = [];
    for (const h of list) {
      const name = h.trim().replace(/^@/, ''), k = name.toLowerCase();
      if (!k || Object.prototype.hasOwnProperty.call(out, k)) continue;
      const yes = /^[A-Za-z0-9_.-]{1,64}$/.test(name) && !DELETED_NAME_RE.test(name)
        && !!db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND deleted_at IS NULL').get(name);
      out[k] = yes; if (yes) taken.push(k);
    }
    return json(res, 200, { handles: out, taken });
  }

  function discovery() {
    const o = origin();
    return {
      issuer: o, authorization_endpoint: o + ISS_PATHS.authorize, token_endpoint: o + ISS_PATHS.token, userinfo_endpoint: o + ISS_PATHS.userinfo,
      jwks_uri: o + ISS_PATHS.jwks, revocation_endpoint: o + ISS_PATHS.revoke, introspection_endpoint: o + ISS_PATHS.introspect,
      response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code', 'refresh_token'],
      subject_types_supported: ['pairwise'], id_token_signing_alg_values_supported: ['ES256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      introspection_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      code_challenge_methods_supported: ['S256'], scopes_supported: SCOPES.map((s) => s.scope),
      claims_supported: ['iss', 'sub', 'aud', 'iat', 'exp', 'auth_time', 'nonce', 'at_hash', ...new Set(SCOPES.flatMap((s) => s.claims).filter((x) => x !== 'sub'))],
      prompt_values_supported: ['none', 'login', 'consent', 'select_account'],
      claims_parameter_supported: false, request_parameter_supported: false, request_uri_parameter_supported: false, require_request_uri_registration: false,
      authorization_response_iss_parameter_supported: true,
      service_documentation: o + '/developers', op_policy_uri: o + '/privacy', op_tos_uri: o + '/terms',
    };
  }

  /* ---------- the router for /oauth/* and /.well-known/* (true when it answered) ---------- */
  async function handle(req, res, url) {
    const p = url.pathname, m = req.method;
    const cors = p === '/.well-known/openid-configuration' || p === '/.well-known/oauth-authorization-server' || p === ISS_PATHS.jwks || p === ISS_PATHS.token || p === ISS_PATHS.userinfo || p === ISS_PATHS.revoke || p === ISS_PATHS.introspect;
    if (p === ISS_PATHS.handles) {   // an app's server only: no CORS, no preflight answered
      if (m !== 'POST') { json(res, 405, { error: 'method not allowed' }, { headers: { Allow: 'POST' } }); return true; }
      await handles(req, res); return true;
    }
    if (!cors && p !== ISS_PATHS.authorize) return false;
    if (m === 'OPTIONS' && cors) { res.writeHead(204, { ...CORS, ...NO_STORE, ...FRAME, 'Content-Length': 0 }); res.end(); return true; }
    if (p === '/.well-known/openid-configuration' || p === '/.well-known/oauth-authorization-server') {
      if (m !== 'GET' && m !== 'HEAD') { json(res, 405, { error: 'method not allowed' }, { cors: true, headers: { Allow: 'GET, HEAD, OPTIONS' } }); return true; }
      json(res, 200, discovery(), { cors: true, cache: 'public, max-age=3600', head: m === 'HEAD' }); return true;
    }
    if (p === ISS_PATHS.jwks) {
      if (m !== 'GET' && m !== 'HEAD') { json(res, 405, { error: 'method not allowed' }, { cors: true, headers: { Allow: 'GET, HEAD, OPTIONS' } }); return true; }
      signingKey();
      json(res, 200, jwks(), { cors: true, cache: 'public, max-age=3600', head: m === 'HEAD' }); return true;
    }
    if (p === ISS_PATHS.authorize) {
      if (!deps.rateLimit('oa-auth-ip:' + deps.clientIp(req), 120, 10 * 60e3)) { errorPage(res, 429, 'Too many sign-ins from this connection', 'Wait ten minutes, then try again.'); return true; }
      if (m === 'GET') { authorizeGet(req, res, url); return true; }
      if (m === 'POST') { await authorizePost(req, res); return true; }
      errorPage(res, 405, 'That is not how this page is opened', 'It is opened by a link from an app.'); return true;
    }
    if (m !== 'POST' && !(p === ISS_PATHS.userinfo && m === 'GET')) { json(res, 405, { error: 'method not allowed' }, { cors: true, headers: { Allow: (p === ISS_PATHS.userinfo ? 'GET, ' : '') + 'POST, OPTIONS' } }); return true; }
    if (p === ISS_PATHS.token) { await token(req, res); return true; }
    if (p === ISS_PATHS.userinfo) { await userinfo(req, res); return true; }
    if (p === ISS_PATHS.revoke) { await revoke(req, res); return true; }
    if (p === ISS_PATHS.introspect) { await introspect(req, res); return true; }
    return false;
  }

  /* ---------- the JSON the pages use (/api/oauth/*, /api/admin/oauth/*); true when it answered ---------- */
  async function api(req, res, p, me) {
    const { send, bad } = deps, m = req.method;
    if (p === '/api/oauth/scopes' && m === 'GET') {
      const o = origin();
      return send(res, 200, { issuer: o, discovery: o + '/.well-known/openid-configuration', endpoints: { authorize: o + ISS_PATHS.authorize, token: o + ISS_PATHS.token, userinfo: o + ISS_PATHS.userinfo, revoke: o + ISS_PATHS.revoke, jwks: o + ISS_PATHS.jwks },
        scopes: SCOPES.map((s) => ({ scope: s.scope, claims: s.claims, label: s.label, plain: s.plain, required: !!s.required })),
        limits: { appsPerMember: MAX_APPS, redirectUrisPerApp: MAX_REDIRECTS, codeSeconds: CODE_TTL_MS / 1000, accessTokenSeconds: ACCESS_TTL_MS / 1000, idTokenSeconds: ID_TTL_S, refreshDays: REFRESH_TTL_MS / 864e5 } }), true;
    }
    /* — a member's own apps — */
    if (p === '/api/oauth/apps' || p.startsWith('/api/oauth/apps/')) {
      if (!me) return bad(res, 'sign in first', 401), true;
      if (!deps.rateLimit('oa-apps:' + me.id, 120, 10 * 60e3)) return bad(res, 'slow down: try again in a few minutes', 429), true;
      if (p === '/api/oauth/apps' && m === 'GET') {
        return send(res, 200, { apps: db.prepare('SELECT * FROM oauth_clients WHERE owner_id = ? ORDER BY created_at').all(me.id).map(appView), max: MAX_APPS }), true;
      }
      if (p === '/api/oauth/apps' && m === 'POST') {
        if (deps.blockSanctioned(res, me)) return true;
        if (!deps.rateLimit('oa-appnew:' + me.id, 20, 36e5) || !deps.rateLimit('oa-appnew-ip:' + deps.clientIp(req), 40, 36e5)) return bad(res, 'too many new apps in an hour: try again later', 429), true;
        const b = await deps.readBody(req, 16 * 1024);
        // an app the admin switched off is not escaped by registering it again: its developer asks the admin instead
        if (db.prepare('SELECT 1 FROM oauth_clients WHERE owner_id = ? AND disabled_at IS NOT NULL').get(me.id)) return bad(res, 'one of your apps was switched off by Just Send It, so you cannot register another for now: ask the admin about it', 409), true;
        const r = appFields(b, null); if (r.error) return bad(res, r.error), true;
        if (db.prepare('SELECT COUNT(*) n FROM oauth_clients WHERE owner_id = ?').get(me.id).n >= MAX_APPS) return bad(res, MAX_APPS + ' apps per member is the limit: delete one first', 409), true;
        const clientId = 'sapp_' + crypto.randomBytes(12).toString('hex'), secret = r.fields.kind === 'confidential' ? newSecret() : null, t = now();
        db.prepare('INSERT INTO oauth_clients (client_id, owner_id, name, description, homepage, redirect_uris, kind, secret_hash, secret_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(clientId, me.id, r.fields.name, r.fields.description, r.fields.homepage, JSON.stringify(r.fields.redirectUris), r.fields.kind, secret ? sha256hex(secret) : null, secret ? t : null, t, t);
        return send(res, 200, { app: appView(clientRow(clientId)), ...(secret ? { clientSecret: secret, secretNote: 'Shown once: it is stored only as a hash. Rotate it to get a new one.' } : {}) }), true;
      }
      const am = new RegExp('^/api/oauth/apps/' + CLIENT_ID_PART + '(/secret)?$').exec(p);
      if (!am) return bad(res, 'not found', 404), true;
      const c = clientRow(am[1]);
      if (!c || c.owner_id !== me.id) return bad(res, 'no app of yours has that client ID', 404), true;
      if (am[2]) {
        if (m !== 'POST') return bad(res, 'not found', 404), true;
        if (c.kind !== 'confidential') return bad(res, 'a public app has no secret to rotate'), true;
        if (!deps.rateLimit('oa-secret:' + me.id, 20, 36e5)) return bad(res, 'too many rotations in an hour: try again later', 429), true;
        const secret = newSecret();
        db.prepare('UPDATE oauth_clients SET secret_hash = ?, secret_at = ?, updated_at = ? WHERE client_id = ?').run(sha256hex(secret), now(), now(), c.client_id);
        return send(res, 200, { app: appView(clientRow(c.client_id)), clientSecret: secret, secretNote: 'Shown once. The old secret stopped working just now.' }), true;
      }
      if (m === 'GET') return send(res, 200, { app: appView(c) }), true;
      if (m === 'POST' || m === 'PATCH') {
        if (deps.blockSanctioned(res, me)) return true;
        const b = await deps.readBody(req, 16 * 1024);
        const r = appFields(b, c); if (r.error) return bad(res, r.error), true;
        const f = r.fields, sets = [], vals = [];
        if (f.name !== undefined) { sets.push('name = ?'); vals.push(f.name); }
        if (f.homepage !== undefined) { sets.push('homepage = ?'); vals.push(f.homepage); }
        if (f.redirectUris !== undefined) { sets.push('redirect_uris = ?'); vals.push(JSON.stringify(f.redirectUris)); }
        if (f.description !== undefined) { sets.push('description = ?'); vals.push(f.description); }
        // what a member is shown about the app changed (its name, website, description or addresses): a review was of the app as it was, so it no longer stands
        const changed = (f.name !== undefined && f.name !== c.name) || (f.homepage !== undefined && f.homepage !== c.homepage) || (f.description !== undefined && f.description !== (c.description || ''))
          || (f.redirectUris !== undefined && JSON.stringify(f.redirectUris) !== JSON.stringify(redirectsOf(c)));
        if (changed) sets.push('reviewed_at = NULL, reviewed_by = NULL');
        if (sets.length) db.prepare('UPDATE oauth_clients SET ' + sets.join(', ') + ', updated_at = ? WHERE client_id = ?').run(...vals, now(), c.client_id);
        // a redirect URI taken off the list: the requests waiting to go there go too
        if (f.redirectUris !== undefined) for (const [id, e] of pending) if (e.clientId === c.client_id && !f.redirectUris.includes(e.redirectUri)) pending.delete(id);
        return send(res, 200, { app: appView(clientRow(c.client_id)), reviewCleared: !!(changed && c.reviewed_at) }), true;
      }
      if (m === 'DELETE') {
        // switched off by the admin: the app, its reason and its record stay for the admin, and the slot with them
        if (c.disabled_at) return bad(res, 'Just Send It switched this app off, so it stays listed until the admin decides: ask the admin about it', 409), true;
        db.exec('BEGIN');
        try { deleteClient(c.client_id); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
        return send(res, 200, { ok: true, deleted: c.client_id }), true;
      }
      return bad(res, 'not found', 404), true;
    }
    /* — the apps a member has signed in to — */
    if (p === '/api/oauth/grants' || p.startsWith('/api/oauth/grants/')) {
      if (!me) return bad(res, 'sign in first', 401), true;
      if (!deps.rateLimit('oa-grants:' + me.id, 120, 10 * 60e3)) return bad(res, 'slow down: try again in a few minutes', 429), true;
      if (p === '/api/oauth/grants' && m === 'GET') return send(res, 200, { grants: grantsOf(me.id) }), true;
      const gm = new RegExp('^/api/oauth/grants/' + CLIENT_ID_PART + '$').exec(p);
      if (gm && (m === 'DELETE' || m === 'POST')) {
        const had = revokeGrant(me.id, gm[1]);
        for (const [id, e] of pending) if (e.clientId === gm[1] && e.sidHash === deps.hashToken(me.sid)) pending.delete(id);
        if (!had) return bad(res, 'you have not signed in to that app', 404), true;
        return send(res, 200, { ok: true, revoked: gm[1], grants: grantsOf(me.id) }), true;
      }
      return bad(res, 'not found', 404), true;
    }
    /* — the admin's list: every app, marked reviewed or not, switched on or off — */
    if (p.startsWith('/api/admin/oauth/')) {
      if (!deps.isAdmin(me)) return bad(res, 'not found', 404), true;
      if (p === '/api/admin/oauth/apps' && m === 'GET') {
        const apps = db.prepare('SELECT * FROM oauth_clients ORDER BY created_at DESC').all().map((c) => {
          const o = db.prepare('SELECT id, username, send_no, deleted_at FROM users WHERE id = ?').get(c.owner_id);
          return { ...appView(c), owner: o ? { id: o.id, username: o.deleted_at ? null : o.username, sendId: o.send_no || null } : null,
            liveTokens: db.prepare('SELECT COUNT(*) n FROM oauth_tokens WHERE client_id = ? AND used_at IS NULL AND expires_at > ?').get(c.client_id, now()).n };
        });
        return send(res, 200, { apps, keys: keysView() }), true;
      }
      const xm = new RegExp('^/api/admin/oauth/apps/' + CLIENT_ID_PART + '$').exec(p);
      if (xm && m === 'POST') {
        const c = clientRow(xm[1]); if (!c) return bad(res, 'no app has that client ID', 404), true;
        const b = await deps.readBody(req, 4096);
        if (b.reviewed !== undefined) {
          if (typeof b.reviewed !== 'boolean') return bad(res, 'reviewed is true or false'), true;
          db.prepare('UPDATE oauth_clients SET reviewed_at = ?, reviewed_by = ? WHERE client_id = ?').run(b.reviewed ? now() : null, b.reviewed ? me.id : null, c.client_id);
        }
        if (b.disabled !== undefined) {
          if (typeof b.disabled !== 'boolean') return bad(res, 'disabled is true or false'), true;
          if (b.disabled) {
            db.prepare('UPDATE oauth_clients SET disabled_at = COALESCE(disabled_at, ?), disabled_by = ?, disabled_reason = ? WHERE client_id = ?').run(now(), me.id, cleanLine(b.reason, 200) || null, c.client_id);
            dropClientGrants(c.client_id);   // its tokens stop working now, and no sign-in it started can finish
          } else db.prepare('UPDATE oauth_clients SET disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE client_id = ?').run(c.client_id);
        }
        return send(res, 200, { app: appView(clientRow(c.client_id)) }), true;
      }
      if (p === '/api/admin/oauth/keys' && m === 'GET') { signingKey(); return send(res, 200, { keys: keysView() }), true; }
      if (p === '/api/admin/oauth/keys/rotate' && m === 'POST') { const r = rotateKey(); return send(res, 200, { rotated: r, keys: keysView() }), true; }
      return bad(res, 'not found', 404), true;
    }
    return false;
  }

  return { migrate, handle, api, prune, rotateKey, jwks, discovery, forgetUser, revokeUser, revokeAllGrants, seedFirstParty, grantsOf, resumePath, subFor, signingKey,
    appsOf: (uid) => db.prepare('SELECT * FROM oauth_clients WHERE owner_id = ? ORDER BY created_at').all(uid).map(appView),
    pendingCount: () => pending.size, PENDING_COOKIE };
}

module.exports = { createOidc, SCOPES, OPTIONAL, verifyJwt, signJwt, jwkThumbprint, pkceS256, redirectUriRefusal, homepageRefusal, b64url, b64dec,
  CODE_TTL_MS, ACCESS_TTL_MS, REFRESH_TTL_MS, ID_TTL_S, PENDING_TTL_MS, PENDING_MAX, PENDING_PER_ADDR, PENDING_PER_NET, KEY_PREPUBLISH_MS, KEY_KEEP_MS, MAX_APPS, MAX_REDIRECTS, PENDING_COOKIE, LIMITS };
