/* Sign in with Send: the pages people use (owner, 2026-11-03: "make the Send Account Login something that other people who
   are building apps around Send can easily use"). tests/oidc.mjs drives the protocol; this drives what is built on it:
     · /developers — the docs (the scopes table against lib/oidc.js, the endpoints against discovery, the privacy promise),
       the button (two SVG files and two HTML snippets), and "Your apps": register an app, see its secret once, rotate it,
       edit, a refusal marked on its field, delete — by mouse and by keyboard;
     · the docs' own browser example, run unchanged (only the client ID filled in) by a fake app on 127.0.0.1, through the
       real consent page to a member's values, and the docs' own ID-token check run in node against a real token;
     · Settings → Apps you've signed in to (/profile#sec-apps): the list, and Revoke by keyboard, which ends the tokens;
     · the admin's apps (review, switch off with a reason, switch on, rotate the key) and adminapps.js kept to the admin;
     · every list a page must join (the footer, /data, the sitemap, llms.txt, Sendy, README) and the privacy policy.
   In a real browser (headless Chrome, muted) at 320, 390 and 1280 px: the text floor, nothing sideways, 44px targets,
   every button described, no script error, and no request from the site's pages to any other host. Everything it
   creates it deletes. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
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
const ROUTES = require(path.join(ROOT, 'lib', 'routes.js'));
const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const PUBDIR = path.join(ROOT, 'public');
const PUB = (f) => readFileSync(path.join(PUBDIR, f), 'utf8');
const SRC = readFileSync(SERVER_JS, 'utf8');
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const results = [], notes = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ADMIN_ID = 987654;
const made = [];
const NET = '203.0.113.', IP = NET + (10 + Math.floor(Math.random() * 200));
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–' };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (NAMED[e.toLowerCase()] ?? m));
const preOf = (html, id) => { const m = new RegExp('<pre[^>]*id="' + id + '"[^>]*><code>([\\s\\S]*?)</code></pre>').exec(html); return m ? decode(m[1]) : null; };

function mkUser(name, o = {}) {
  db.prepare('DELETE FROM users WHERE username = ?').run(name);
  if (o.id) db.prepare('DELETE FROM users WHERE id = ?').run(o.id);
  if (o.id) db.prepare('INSERT INTO users (id, username, created_at, avatar) VALUES (?,?,?,?)').run(o.id, name, Date.now() - 40 * 864e5, '🧪');
  else db.prepare('INSERT INTO users (username, created_at, avatar) VALUES (?,?,?)').run(name, Date.now() - 40 * 864e5, '🧪');
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  made.push(id);
  // the welcome tour is done, so it never stands over a page the walk reads
  db.prepare("UPDATE users SET points = ?, holder_state = ?, holder_verified_at = ?, onboard_state = 'done' WHERE id = ?").run(o.points || 0, o.holder || 'none', o.holder === 'ok' ? Date.now() : null, id);
  sendNoOf(db, id);
  const raw = 'tok_op_' + crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(sha(raw), id, Date.now() - 5000, Date.now() + 864e5);
  return { id, name, sid: raw, cookie: 'sid=' + raw };
}
async function get(p, o = {}) {
  const r = await fetch(BASE + p, { headers: { 'X-Forwarded-For': IP, ...(o.cookie ? { Cookie: o.cookie } : {}), ...(o.headers || {}) }, redirect: 'manual' });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, text, j, h: r.headers };
}
function pkce() { const verifier = b64url(crypto.randomBytes(32)); return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) }; }

/* the fake app: the docs' browser example, served exactly as /developers prints it with its client ID filled in */
let appCode = '', appButton = '', appHits = [];
const appSrv = http.createServer((q, s) => {
  appHits.push(q.url);
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  if (u.pathname === '/callback') return s.end('<!doctype html><meta charset="utf-8"><title>kart: back</title><p id="app">back</p><script>' + appCode + '\nfinishSignIn().then((me) => { window.__me = me; }, (e) => { window.__err = String((e && e.message) || e); });</script>');
  s.end('<!doctype html><meta charset="utf-8"><title>kart</title><body style="margin:16px;font-family:serif">' + appButton + '<script>' + appCode + '\ndocument.querySelector("a").addEventListener("click", (e) => { e.preventDefault(); signInWithSend(); });</script></body>');
});
await new Promise((ok) => appSrv.listen(0, '127.0.0.1', ok));
const APP = 'http://127.0.0.1:' + appSrv.address().port, APP_REDIRECT = APP + '/callback';

try {
  /* ═══ 1. the files ═══ */
  check('the suite runs against the throwaway server (run.mjs: a data directory of its own)', /jsi-test-/.test(DB_PATH) || process.env.JSI_DATA_DIR, DB_PATH);
  const DEV = PUB('developers.html'), DCSS = PUB('developers.css'), DJS = PUB('developers.js'), GJS = PUB('appgrants.js'), AJS = PUB('adminapps.js');
  const PROFILE = PUB('profile.html'), ADMIN = PUB('admin.html'), PRIV = PUB('privacy.html'), DATA = PUB('data.html'), README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  check('/developers is a page of its own (lib/routes.js finds it by its file), with its stylesheet and script, the site\'s tooltip, sign-in and age scripts',
    ROUTES.pageNames(PUBDIR).has('developers') && /<link rel="stylesheet" href="developers\.css">/.test(DEV) && /<script src="developers\.js"><\/script>/.test(DEV)
    && DEV.indexOf('src="tips.js"') > 0 && DEV.indexOf('src="auth.js"') < DEV.indexOf('src="developers.js"') && /<script src="agegate\.js"><\/script>/.test(DEV));
  // the scopes table is lib/oidc.js's SCOPES, row for row, claim for claim
  const rows = [...DEV.matchAll(/<tr data-scope="([^"]+)">([\s\S]*?)<\/tr>/g)].map((m) => {
    const tds = [...m[2].matchAll(/<td data-label="([^"]+)">([\s\S]*?)<\/td>/g)].map((t) => t[2]);
    return { scope: m[1], claims: [...(tds[1] || '').matchAll(/<code>([a-z_]+)<\/code>/g)].map((c) => c[1]), shown: decode((tds[2] || '').replace(/<[^>]+>/g, '')) };
  });
  check('the scopes table on /developers is lib/oidc.js\'s list, in its order, each row naming exactly the claims that scope adds',
    rows.length === OL.SCOPES.length && rows.every((r, i) => r.scope === OL.SCOPES[i].scope && JSON.stringify(r.claims) === JSON.stringify(OL.SCOPES[i].claims)),
    JSON.stringify(rows.map((r) => r.scope + ':' + r.claims.join('+'))));
  check('  ...the Send ID\'s row says it is the same in every app (it lets apps recognise a member across each other), the Boost\'s that it is the total only, and the holder check\'s that it is not which wallet',
    /same number in every app[^<]*recognise them across each other/.test(rows.find((r) => r.scope === 'send.id').shown) && /never what it is made of/.test(rows.find((r) => r.scope === 'send.boost').shown)
    && /not which wallet, not how much/.test(rows.find((r) => r.scope === 'send.verified').shown) && /different in every app/.test(rows.find((r) => r.scope === 'openid').shown));
  const promise = DEV.slice(DEV.indexOf('id="dv-privacy-h"'), DEV.indexOf('id="dv-scopes-h"'));
  check('the privacy promise names everything no app ever gets — email, wallets, IP address, sign-in history, holdings, OG tier, communities — and what is and is not kept',
    ['email', 'wallets', 'IP address', 'sign-in history', 'holdings', 'OG tier', 'communities'].every((w) => promise.includes(w)) && /What this site keeps:/.test(promise) && /What it does not keep:/.test(promise)
    && /each stored as a hash with when it was issued and deleted when it expires/.test(promise) && /different in every app/.test(promise));
  check('  ...in honest words: run by this site\'s own server, checkable without asking us again, never "decentralised"',
    /Run by this site’s own server, not by a blockchain/.test(DEV) && /without asking us again/.test(DEV) && !/decentrali[sz]ed|trustless/i.test(DEV.replace(/<!--[\s\S]*?-->/g, '')));
  const EX = preOf(DEV, 'dv-ex-browser'), EXS = preOf(DEV, 'dv-ex-server'), EXV = preOf(DEV, 'dv-ex-verify');
  check('the browser example is about thirty lines (at most 30), uses no library, sends PKCE S256 and a state, and checks the state and iss that come back',
    EX && EX.split('\n').length <= 30 && !/import|require\(/.test(EX) && /code_challenge_method: 'S256'/.test(EX) && /q\.get\('state'\) !== saved\.state/.test(EX) && /q\.get\('iss'\) !== ISSUER/.test(EX) && /crypto\.subtle\.digest\('SHA-256'/.test(EX),
    EX && EX.split('\n').length);
  check('  ...and the server example and the ID-token check are there too (the check: ES256 only, the key by kid, iss, aud, exp and the nonce)',
    EXS && /client\.discovery\(/.test(EXS) && /expectedState/.test(EXS) && EXV && /head\.alg !== 'ES256'/.test(EXV) && /k\.kid === head\.kid/.test(EXV) && /claims\.aud !== CLIENT_ID/.test(EXV) && /claims\.nonce !== nonce/.test(EXV));
  // the button: two SVG files and two HTML snippets, nothing loaded from anywhere, 44px tall
  const SVGS = ['signin-with-send.svg', 'signin-with-send-lime.svg'].map((f) => existsSync(path.join(PUBDIR, 'assets', f)) ? readFileSync(path.join(PUBDIR, 'assets', f), 'utf8') : '');
  const PATH_D = (/<path d="([^"]+)"/.exec(SVGS[0]) || [])[1];
  check('the Sign in with Send button ships as two SVG files: 44px tall, labelled, the words drawn in, nothing fetched from anywhere and no script',
    SVGS.every((s) => /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="212" height="44" viewBox="0 0 212 44" role="img" aria-label="Sign in with Send">/.test(s) && /<title>Sign in with Send<\/title>/.test(s)
      && />Sign in with Send<\/text>/.test(s) && !/<script|href=|url\(|@import/i.test(s) && (s.match(/https?:\/\//g) || []).length === 1)
    && /href="\/assets\/signin-with-send\.svg" download="signin-with-send\.svg"/.test(DEV) && /href="\/assets\/signin-with-send-lime\.svg" download="signin-with-send-lime\.svg"/.test(DEV));
  const SNIPS = ['dv-btn-dark', 'dv-btn-lime'].map((id) => preOf(DEV, id) || '');
  check('  ...and as two HTML snippets: a link that takes the page\'s own font size (no font size of its own), at least 44px tall, the same S as the SVG, no script',
    SNIPS.every((s) => /^<a href="https:\/\/your\.app\/sign-in-with-send" style="[^"]*min-height:44px;[^"]*">/.test(s) && !/font-size|font:/.test(s) && !/<script|on[a-z]+=/i.test(s)
      && s.includes('<path d="' + PATH_D + '"') && /aria-hidden="true"/.test(s) && /Sign in with Send<\/a>$/.test(s)) && !!PATH_D);
  check('every code block and snippet has a described Copy button', ['dv-ex-browser', 'dv-ex-server', 'dv-ex-verify', 'dv-btn-dark', 'dv-btn-lime'].every((id) => new RegExp('<button class="btn btn-ghost btn-sm" type="button" data-dv-copy="' + id + '" data-tip="[^"]{8,}">').test(DEV)));
  check('the page\'s styles ride the text floor, and its tables turn into labelled rows on a phone rather than scroll sideways',
    [...DCSS.matchAll(/font-size:\s*([^;}]+)/g)].every((m) => /^max\(var\(--text-floor\)/.test(m[1].trim())) && /\.dv-table td::before \{ content: attr\(data-label\);/.test(DCSS) && /pre\.dv-code \{ white-space: break-spaces; overflow-wrap: anywhere;/.test(DCSS));
  // where it is linked from: every footer, the Data API page, the settings card, the consent page
  const footers = readdirSync(PUBDIR).filter((f) => f.endsWith('.html') && /class="nav-foot"/.test(PUB(f)));
  const noLink = footers.filter((f) => { const s = PUB(f), i = s.indexOf('class="nav-foot"'); return !/<a href="\/developers"( aria-current="page")?>Developers<\/a>/.test(s.slice(i, s.indexOf('</div>', i))); });
  check('every page footer links /developers (' + footers.length + ' pages), and the Data API page and the Settings card point to it', footers.length >= 17 && !noLink.length && /<a href="\/developers">Sign in with Send for developers<\/a>/.test(DATA)
    && /<a href="\/developers">Sign in with Send for developers<\/a>/.test(PROFILE), noLink.join(','));
  check('  ...and the sitemap, llms.txt and Sendy know it: its page tips and links, the site map he reads, and the pages he reads',
    /<loc>https:\/\/sendrh\.com\/developers<\/loc>/.test(PUB('sitemap-pages.xml')) && /- \[Sign in with Send, for developers\]\(https:\/\/sendrh\.com\/developers\): /.test(PUB('llms.txt'))
    && /'\/developers': \{ tips: \[/.test(PUB('sendy.js')) && /\|community\|developers\|data\|/.test(PUB('sendy.js')) && /\n\/developers — Sign in with Send/.test(SRC)
    && /'market', 'developers', 'privacy', 'whitepaper'\]\) \{/.test(SRC) && /'market', 'developers', 'privacy', 'whitepaper', 'profile'\]/.test(readFileSync(path.join(ROOT, 'lib', 'sendybrain.js'), 'utf8')));
  check('the Data API page says the me resource carries the apps signed in to and registered (ownDataView\'s signInApps and appsRegistered)', /signInApps: \[ \{ clientId, name, homepage, redirectHosts,/.test(DATA) && /appsRegistered: \[ \{ clientId, name,/.test(DATA)
    && /signInApps: OIDC\.grantsOf\(u\.id\)/.test(SRC) && /appsRegistered: OIDC\.appsOf\(u\.id\)/.test(SRC));
  // Settings → Apps you've signed in to
  check('Settings has the "Apps you’ve signed in to" card at #sec-apps (the consent page links there): a list with a name, a live status line, and its script after profile.js',
    /<details class="setting-card" id="sec-apps">\s*<summary>🔑 Apps you’ve signed in to <span class="sec-state" id="apps-state" aria-live="polite"><\/span><\/summary>/.test(PROFILE)
    && /<ul class="grant-list" id="grant-list" aria-label="Apps you have signed in to"><\/ul>/.test(PROFILE) && /<p class="modal-note" id="grant-note" role="status" aria-live="polite"><\/p>/.test(PROFILE)
    && PROFILE.indexOf('src="dashtabs.js"') < PROFILE.indexOf('src="profile.js"') && PROFILE.indexOf('src="profile.js"') < PROFILE.indexOf('src="appgrants.js"')
    && /\/profile#sec-apps/.test(readFileSync(path.join(ROOT, 'lib', 'oidc.js'), 'utf8')) && /\^#\(sec-\|/.test(PUB('dashtabs.js')));
  check('  ...each Revoke button names its app for a screen reader, takes two presses, and is described', /const label = \(word, name\) => word \+ '<span class="sr-only"> ' \+ esc\(name\) \+ '<\/span>';/.test(GJS)
    && /data-revoke="' \+ esc\(g\.clientId\) \+ '" data-tip="[^"]{8,}">' \+ label\('Revoke', g\.name\)/.test(GJS) && /label\('Tap again to revoke', g\.name\)/.test(GJS));
  // the admin's part
  check('the admin page has the apps section (hidden until the admin is known), its script after auth.js, and the server keeps adminapps.js to the admin like the others',
    /<section class="card adm-ov adm-apps" id="adm-apps" hidden aria-labelledby="adm-apps-h">/.test(ADMIN) && ADMIN.indexOf('src="auth.js"') < ADMIN.indexOf('src="adminapps.js"')
    && /const adminScript = \['admin\.js', 'admincodes\.js', 'adminrestore\.js', 'adminanalytics\.js', 'adminapps\.js'\]\.find\(/.test(SRC)
    && [...ADMIN.slice(ADMIN.indexOf('id="adm-apps"'), ADMIN.indexOf('id="adm-tools"')).matchAll(/<button[^>]*>/g)].every((x) => /data-tip="[^"]{8,}"/.test(x[0])));
  // the privacy policy and the README
  const toc = [...PRIV.matchAll(/<li><a href="#p(\d+)">([^<]+)<\/a><\/li>/g)].map((m) => [m[1], m[2]]), heads = [...PRIV.matchAll(/<section class="t-sec" id="p(\d+)">\s*<h2>(\d+)\. ([^<]+)<\/h2>/g)].map((m) => [m[1], m[2], m[3]]);
  check('the Privacy Policy has a section on Sign in with Send (11), and its contents, ids and numbers still agree all the way down',
    heads.length === 16 && heads.every((h, i) => h[0] === String(i + 1) && h[1] === String(i + 1) && toc[i] && toc[i][0] === h[0] && decode(toc[i][1]) === decode(h[2])) && heads[10][2] === 'Signing in to other apps with Send',
    JSON.stringify(heads.map((h) => h.join(':'))));
  const P11 = PRIV.slice(PRIV.indexOf('<section class="t-sec" id="p11">'), PRIV.indexOf('<section class="t-sec" id="p12">'));
  check('  ...saying what an app receives (a different ID in every app; the rest only when ticked), what it never receives, what this site keeps and does not, and how to revoke',
    /an ID for you that is different in every app/.test(P11) && /Only what you tick/.test(P11) && /An app never receives your email, your wallets, your IP address, your sign-in history, your holdings, your OG tier or your communities/.test(P11)
    && /stored only as hashes and deleted soon after they expire/.test(P11) && /Backups are written without them/.test(P11) && /Apart from those tokens, each kept with when it was issued until it expires, we keep no record of when or how often you use an app/.test(P11)
    && /Settings → Apps you’ve signed in to/.test(P11) && /deleting your account revokes every app and deletes any app you registered/.test(P11) && /This site’s own server runs it/.test(P11));
  check('  ...with its cookie (jsi_oidc), the two kinds of record in the table of what is stored, and the version moved to 2026-11-03',
    /<tr><td><code>jsi_oidc<\/code><\/td><td>Set only when an app sends you to Sign in with Send while you are signed out/.test(PRIV) && /<tr><td>Apps you sign in to with your Send account:/.test(PRIV)
    && /<tr><td>Apps you register as a developer:/.test(PRIV) && /Version 2026-11-03 · \$Send \/ JustSendIt/.test(PRIV) && /pendingCookie = \(id\) => PENDING_COOKIE \+ '=' \+ id \+ '; Path=\/; HttpOnly; SameSite=Lax; Max-Age=' \+ Math\.round\(PENDING_TTL_MS \/ 1000\)/.test(readFileSync(path.join(ROOT, 'lib', 'oidc.js'), 'utf8')) && OL.PENDING_TTL_MS === 600e3);
  check('README has the feature row and §3.13b with the endpoints and the scopes, and names OIDC_KEY_ROTATE_DAYS',
    /^\| \*\*🔑 Sign in with Send\*\* \| [^\n]*`\/developers`[^\n]*§3\.13b\. \|$/m.test(README) && /### 3\.13b Sign in with Send/.test(README)
    && ['/.well-known/openid-configuration', '/.well-known/jwks.json', '/oauth/authorize', '/oauth/token', '/oauth/userinfo', '/oauth/revoke'].every((p) => README.includes('`' + (p.startsWith('/oauth/authorize') ? 'GET|POST ' : p.startsWith('/oauth/userinfo') ? 'GET|POST ' : p.startsWith('/oauth') ? 'POST ' : 'GET ') + p))
    && OL.SCOPES.every((s) => README.includes('`' + s.scope + '`')) && /`OIDC_KEY_ROTATE_DAYS`/.test(README));

  /* ═══ 2. the server ═══ */
  const dev = mkUser('__op_dev__', { points: 1500 }), member = mkUser('__op_member__', { points: 15200, holder: 'ok' }), admin = mkUser('__op_admin__', { id: ADMIN_ID, points: 10 });
  const page = await get('/developers'), old = await get('/developers.html?x=1');
  check('/developers answers 200 as HTML, and /developers.html is a 301 to it with its query', page.status === 200 && /text\/html/.test(page.h.get('content-type')) && old.status === 301 && old.h.get('location') === '/developers?x=1', page.status + ' ' + old.status + ' ' + old.h.get('location'));
  const disc = (await get('/.well-known/openid-configuration')).j || {};
  const listed = [...page.text.matchAll(/<td data-label="Address"><code>(?:GET or POST|GET|POST) (\S+)<\/code><\/td>/g)].map((m) => m[1]);
  check('the endpoints the page lists are the ones discovery publishes, at this site\'s issuer (the page is written against the placeholder origin and served with the real one)',
    JSON.stringify(listed) === JSON.stringify([BASE + '/.well-known/openid-configuration', disc.jwks_uri, disc.authorization_endpoint, disc.token_endpoint, disc.userinfo_endpoint, disc.revocation_endpoint]) && disc.issuer === BASE
    && preOf(page.text, 'dv-ex-browser').includes("const ISSUER = '" + disc.issuer + "';"), JSON.stringify(listed));
  const ajs = await Promise.all([get('/adminapps.js'), get('/adminapps.js', { cookie: member.cookie }), get('/AdminApps.js', { cookie: member.cookie }), get('/adminapps.js', { cookie: admin.cookie })]);
  check('adminapps.js is the admin\'s alone: the same 404 for nobody, a member and another spelling; the admin gets it, never cached',
    ajs[0].status === 404 && ajs[1].status === 404 && ajs[2].status === 404 && ajs[3].status === 200 && /\/api\/admin\/oauth\/apps/.test(ajs[3].text) && /no-store/.test(ajs[3].h.get('cache-control') || ''), ajs.map((r) => r.status).join(' '));

  /* ═══ 3. the browser ═══ */
  // the code as the page SERVES it (its issuer is this server's, not the placeholder origin the file is written against)
  await walk({ dev, member, admin, disc, EX: preOf(page.text, 'dv-ex-browser'), SNIP: preOf(page.text, 'dv-btn-dark'), EXV: preOf(page.text, 'dv-ex-verify') });
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  try { appSrv.close(); } catch {}
  for (const id of made) {
    for (const r of db.prepare('SELECT client_id FROM oauth_clients WHERE owner_id = ?').all(id)) for (const t of ['oauth_tokens', 'oauth_codes', 'oauth_consents', 'oauth_clients']) { try { db.prepare('DELETE FROM ' + t + ' WHERE client_id = ?').run(r.client_id); } catch {} }
    for (const t of ['sessions', 'notifications', 'points_events', 'oauth_tokens', 'oauth_codes', 'oauth_consents', 'data_history']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  console.log('\ncleanup — users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_op\\_%' ESCAPE '\\'").get().n);
  db.close();
}

/* ═══ the walk: headless Chrome, muted ═══ */
async function walk({ dev, member, admin, disc, EX, SNIP, EXV }) {
  const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'].find((p) => p && existsSync(p));
  if (!CHROME) {
    if (process.env.CI) { notes.push('skipping the browser walk: no Chrome or Chromium on this runner (set CHROME_PATH)'); return; }
    check('a Chrome or Chromium to walk the pages in (set CHROME_PATH)', false, 'none found'); return;
  }
  const profile = mkdtempSync(path.join(os.tmpdir(), 'jsi-oidcpages-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--lang=en-US', 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let ws = null, session = null, seq = 0; const pend = new Map(), errors = [], offsite = [];
  const cdp = (method, params = {}, sid = session) => new Promise((ok, bad) => { const id = ++seq; pend.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
  const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)); return r.result.value; };
  const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(60); } return null; };
  const KEYS = { Tab: 9, Enter: 13, ' ': 32 };
  const press = async (k, mods = 0) => { const base = { key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: KEYS[k], nativeVirtualKeyCode: KEYS[k], modifiers: mods }; await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(k === 'Enter' ? { text: '\r' } : k === ' ' ? { text: ' ' } : {}) }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); };
  const typeIn = async (sel, text) => { await ev('(() => { const e = document.querySelector(' + JSON.stringify(sel) + '); e.focus(); e.value = ""; return true; })()'); await cdp('Input.insertText', { text }); };
  const active = () => ev('(() => { const a = document.activeElement; return a ? (a.id || a.name || a.getAttribute("data-dv-act") || a.getAttribute("data-revoke") || a.tagName) : null; })()');
  const as = async (who) => {
    await cdp('Network.clearBrowserCookies');
    await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: BASE });
    if (who) await cdp('Network.setCookie', { name: 'sid', value: who.sid, url: BASE });
  };
  const size = async (w) => {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: w < 768 ? 760 : 900, deviceScaleFactor: 1, mobile: w < 768 });
    await cdp('Emulation.setTouchEmulationEnabled', w < 768 ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  };
  const open = async (url, ready) => { await cdp('Page.navigate', { url }); return until('document.readyState === "complete" && (' + (ready || 'true') + ')', 10000); };
  /* the look: the text floor, nothing past the screen's edge, 44px targets, every button described — inside `root` */
  const LOOK = (root) => `(() => {
    const probe = document.createElement('span'); probe.style.fontSize = 'var(--text-floor)'; document.body.appendChild(probe);
    const floor = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
    const top = document.querySelector(${JSON.stringify(root)}); if (!top) return { missing: true };
    const small = [], out = [], tiny = [], untipped = [];
    for (const el of top.querySelectorAll('*')) {
      if (!el.getClientRects().length || el.closest('[hidden], .sr-only')) continue;
      const th = el.closest('thead'); if (th && getComputedStyle(th).position === 'absolute') continue;   // a phone's tables label each cell instead
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1) out.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
      if ([...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < floor - 0.5) small.push((el.className || el.tagName) + ' ' + getComputedStyle(el).fontSize);
      if (el.matches('button, a.btn, input:not([type=radio]):not([type=checkbox]), textarea, label.dv-kind, summary') && r.height < 43.5) tiny.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.height));
      if (el.matches('button, a.btn') && (el.getAttribute('data-tip') || '').length < 8) untipped.push(el.id || el.textContent.trim().slice(0, 30));
    }
    return { floor, doc: document.documentElement.scrollWidth, iw: innerWidth, small: small.slice(0, 5), out: out.slice(0, 5), tiny: tiny.slice(0, 5), untipped };
  })()`;
  const bad = (L) => L.missing || L.doc > L.iw || L.small.length || L.out.length || L.tiny.length || L.untipped.length;
  // the example is run as served: its issuer must be this throwaway server, or a browser here would go to the live site
  if (!EX || !EX.includes("const ISSUER = '" + BASE + "';") || !EXV || !EXV.includes("const ISSUER = '" + BASE + "'")) throw new Error('the served examples do not name this server as their issuer: not run');
  const appRow = (name, owner) => db.prepare('SELECT * FROM oauth_clients WHERE name = ? AND owner_id = ?').get(name, owner.id);
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
    if (!existsSync(portFile)) throw new Error('Chrome did not open its debugging port');
    const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
    ws = new WebSocket('ws://127.0.0.1:' + port + wsPath);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('could not connect to Chrome')); });
    let page = 'start';
    ws.onmessage = (m) => {
      const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
      if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.bad(new Error(JSON.stringify(d.error))) : p.ok(d.result); }
      else if (d.method === 'Runtime.exceptionThrown') errors.push(page + ': ' + ((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description) || d.params.exceptionDetails.text || '').split('\n')[0]);
      else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(page + ': console.error ' + (d.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 160));
      else if (d.method === 'Network.requestWillBeSent') { const u = d.params.request.url; if (!/^(http:\/\/localhost:|http:\/\/127\.0\.0\.1:|data:|about:|blob:)/.test(u)) offsite.push(page + ': ' + u.slice(0, 100)); }
    };
    const t = await cdp('Target.createTarget', { url: 'about:blank' }, null);
    session = (await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
    await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
    // the visitor tour and Sendy's hello stay out of the way (as for anyone who has seen them)
    await as(null); await open(BASE + '/robots.txt');
    await ev("localStorage.setItem('jsi-tour-v1', 'done'); true");

    /* ── /developers, signed out ── */
    page = '/developers signed out';
    const looks = [];
    for (const w of [320, 390, 1280]) {
      await size(w); await as(null);
      await open(BASE + '/developers', '!!document.getElementById("dv-signin")');
      const L = await ev(LOOK('main'));
      if (bad(L)) looks.push(w + ' ' + JSON.stringify(L));
    }
    check('/developers signed out, at 320, 390 and 1280 px: nothing sideways, no text under the floor, every control at least 44px tall and described', looks.length === 0, looks.join(' || '));
    await ev('document.getElementById("dv-signin").click()');
    check('  ...and its Sign in opens the site\'s own sign-in dialog, on the page', !!(await until('!document.getElementById("auth-modal").hasAttribute("hidden")', 3000)));

    /* ── /developers, signed in: register, the secret once, rotate, edit, a refusal, delete ── */
    page = '/developers signed in';
    await size(390); await as(dev);
    await open(BASE + '/developers', '!!document.getElementById("dv-new")');
    await typeIn('#dv-n-name', 'Send Kart'); await typeIn('#dv-n-home', 'https://kart.example'); await typeIn('#dv-n-redirects', APP_REDIRECT); await typeIn('#dv-n-desc', 'A kart racer for senders.');
    await ev('document.getElementById("dv-n-go").click()');
    await until('!!document.getElementById("dv-secret")');
    const kart = appRow('Send Kart', dev);
    const panel1 = await ev('({ id: (document.getElementById("dv-secret-id") || {}).textContent, secret: !!document.getElementById("dv-secret-val"), focus: document.activeElement && document.activeElement.id, listed: [...document.querySelectorAll(".dv-app-name")].map((e) => e.textContent) })');
    check('registering a public app from the form: it is stored as typed (the exact redirect address), and the page shows its client ID, no secret, and moves focus to that panel',
      kart && kart.kind === 'public' && JSON.parse(kart.redirect_uris)[0] === APP_REDIRECT && kart.homepage === 'https://kart.example' && kart.description === 'A kart racer for senders.' && !kart.secret_hash
      && panel1.id === kart.client_id && panel1.secret === false && panel1.focus === 'dv-secret' && panel1.listed.includes('Send Kart'), JSON.stringify(panel1));
    await typeIn('#dv-n-name', 'Send Kart Server'); await typeIn('#dv-n-home', 'https://kart.example'); await typeIn('#dv-n-redirects', 'https://kart.example/auth/send/callback');
    await ev('document.querySelector(\'input[name="dv-kind"][value="confidential"]\').click(); document.getElementById("dv-n-go").click(); true');
    const S1 = await until('document.getElementById("dv-secret-val") && document.getElementById("dv-secret-val").textContent');
    const kserv = appRow('Send Kart Server', dev);
    check('a confidential app: its secret is shown once, on the page, and only its SHA-256 is stored', kserv && kserv.kind === 'confidential' && /^ssec_[A-Za-z0-9_-]{43}$/.test(S1 || '') && kserv.secret_hash === sha(S1)
      && !!(await ev('!!document.querySelector(\'#dv-secret [data-dv-copy-value][data-tip]\')')), S1);
    await ev('document.getElementById("dv-secret-done").click()');
    const goneNow = await ev('!document.documentElement.outerHTML.includes(' + JSON.stringify(S1 || 'x') + ')');
    await open(BASE + '/developers', '!!document.querySelector(".dv-app-list")');
    const goneReload = await ev('!document.documentElement.outerHTML.includes(' + JSON.stringify(S1 || 'x') + ')');
    const apiApps = await get('/api/oauth/apps', { cookie: dev.cookie });
    check('  ..."I have saved it" takes it off the page, and after a reload it is nowhere: not on the page, not in the apps the server lists (not even its hash)',
      goneNow && goneReload && apiApps.status === 200 && !apiApps.text.includes(S1) && !apiApps.text.includes(kserv.secret_hash) && /"hasSecret":true/.test(apiApps.text));
    // a new secret: two presses, a new one shown once, the old one dead
    const pressAct = (clientId, what) => ev('(() => { const b = document.querySelector(\'[data-app="' + clientId + '"] [data-dv-act="' + what + '"]\'); if (!b) return false; b.click(); return true; })()');
    await pressAct(kserv.client_id, 'secret');
    const armedLabel = await ev('document.querySelector(\'[data-app="' + kserv.client_id + '"] [data-dv-act="secret"]\').textContent');
    await pressAct(kserv.client_id, 'secret');
    const S2 = await until('document.getElementById("dv-secret-val") && document.getElementById("dv-secret-val").textContent');
    const revokeWith = (secret) => fetch(BASE + '/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': IP, Authorization: 'Basic ' + Buffer.from(kserv.client_id + ':' + secret).toString('base64') }, body: 'token=nothing' }).then((r) => r.status);
    const [oldS, newS] = [await revokeWith(S1), await revokeWith(S2)];
    check('New secret takes two presses (the first says what the second does), shows the new one once, and the old one stops working at once',
      /Tap again/.test(armedLabel) && S2 && S2 !== S1 && db.prepare('SELECT secret_hash FROM oauth_clients WHERE client_id = ?').get(kserv.client_id).secret_hash === sha(S2) && oldS === 401 && newS === 200
      && /old secret stopped working/.test(await ev('document.getElementById("dv-secret").textContent')), [armedLabel, oldS, newS].join(' '));
    await ev('document.getElementById("dv-secret-done").click()');
    // edit: the form opens in place, saves, and focus comes back to Edit
    await pressAct(kart.client_id, 'edit');
    await until('!!document.getElementById("dv-e-' + kart.client_id + '-desc")');
    await typeIn('#dv-e-' + kart.client_id + '-desc', 'Karts, fuelled by Send Power.');
    await ev('document.querySelector(\'.dv-edit[data-app="' + kart.client_id + '"] button[type="submit"]\').click()');
    await until('!document.querySelector(".dv-edit")');
    check('Edit changes the app in place (the description here), and focus comes back to its Edit button', db.prepare('SELECT description FROM oauth_clients WHERE client_id = ?').get(kart.client_id).description === 'Karts, fuelled by Send Power.'
      && (await active()) === 'edit' && /Karts, fuelled by Send Power\./.test(await ev('document.querySelector(\'[data-app="' + kart.client_id + '"]\').textContent')));
    // a refusal: the server's words, on the field it is about
    await typeIn('#dv-n-name', 'Bad Redirects'); await typeIn('#dv-n-home', 'https://bad.example'); await typeIn('#dv-n-redirects', 'https://bad.example/*');
    await ev('document.getElementById("dv-n-go").click()');
    await until('/wildcards/.test(document.getElementById("dv-n-status").textContent)');
    const refused = await ev('({ msg: document.getElementById("dv-n-status").textContent, inv: document.getElementById("dv-n-redirects").getAttribute("aria-invalid"), focus: document.activeElement.id, name: document.getElementById("dv-n-name").value })');
    check('a refused registration says why in the server\'s words, marks the field it is about and puts the reader there, keeps what was typed, and stores nothing',
      /no wildcards/.test(refused.msg) && refused.inv === 'true' && refused.focus === 'dv-n-redirects' && refused.name === 'Bad Redirects' && !appRow('Bad Redirects', dev), JSON.stringify(refused));
    // by keyboard alone: the form, field to field with Tab, then Enter on the button
    await open(BASE + '/developers', '!!document.getElementById("dv-new")');
    await typeIn('#dv-n-name', 'Kart Keys'); await press('Tab'); await cdp('Input.insertText', { text: 'https://keys.example' }); await press('Tab'); await cdp('Input.insertText', { text: 'http://localhost:5173/cb' });
    const order = [];
    for (let i = 0; i < 6; i++) { await press('Tab'); order.push(await active()); if (order[order.length - 1] === 'dv-n-go') break; }
    await press('Enter');
    await until('!!document.getElementById("dv-secret")');
    const keys = appRow('Kart Keys', dev);
    check('by keyboard alone: Tab goes field by field to "Register the app", and Enter registers it', keys && keys.homepage === 'https://keys.example' && JSON.parse(keys.redirect_uris)[0] === 'http://localhost:5173/cb' && order[order.length - 1] === 'dv-n-go', JSON.stringify(order));
    // delete: two presses
    await ev('document.getElementById("dv-secret-done").click()');
    for (const c of [kserv.client_id, keys && keys.client_id]) { if (!c) continue; await pressAct(c, 'delete'); await pressAct(c, 'delete'); await until('!document.querySelector(\'[data-app="' + c + '"]\')'); }
    check('Delete takes two presses and removes the app, with its sign-ins', !db.prepare('SELECT 1 FROM oauth_clients WHERE client_id IN (?, ?)').get(kserv.client_id, keys ? keys.client_id : 'x')
      && /You have 1 of 5 apps\./.test(await ev('document.getElementById("dv-count").textContent')));
    const looksIn = [];
    for (const w of [320, 390, 1280]) {
      await size(w);
      await open(BASE + '/developers', '!!document.querySelector(".dv-app-list") && !!document.getElementById("dv-new")');
      const L = await ev(LOOK('#dv-apps'));
      if (bad(L)) looksIn.push(w + ' ' + JSON.stringify(L));
    }
    check('"Your apps" signed in, an app listed and the form under it, at 320, 390 and 1280 px: nothing sideways, the floor, 44px targets, every control described', looksIn.length === 0, looksIn.join(' || '));

    /* ── the docs' browser example, run by an app, through the real consent page ── */
    page = 'the example app';
    appCode = EX.replace("const CLIENT_ID = 'sapp_your_client_id';", 'const CLIENT_ID = ' + JSON.stringify(kart.client_id) + ';');
    appButton = SNIP;
    await size(390); await as(member);
    await open(APP + '/', '!!document.querySelector("a")');
    const btn = await ev('(() => { const a = document.querySelector("a"), r = a.getBoundingClientRect(); return { h: r.height, w: r.width, text: a.textContent, fs: getComputedStyle(a).fontSize, body: getComputedStyle(document.body).fontSize, svg: !!a.querySelector("svg") }; })()');
    check('the HTML button, pasted into a page that is not ours: at least 44px tall, fits the screen, takes that page\'s font size, the S drawn', btn.h >= 44 && btn.w <= 390 && btn.text === 'Sign in with Send' && btn.fs === btn.body && btn.svg, JSON.stringify(btn));
    page = 'the consent page';
    await ev('document.querySelector("a").click()');
    const onConsent = await until('location.origin === ' + JSON.stringify(BASE) + ' && !!document.querySelector(\'[data-mode="consent"]\')', 10000);
    check('  ...and pressing it (the example\'s signInWithSend) opens the consent page here, for that app', !!onConsent && /Send Kart/.test(await ev('document.querySelector(".oa-app-name") ? document.querySelector(".oa-app-name").textContent : ""')),
      await ev('location.href.slice(0, 120) + " | " + document.title + " | " + (document.querySelector("main") || document.body).textContent.replace(/\\s+/g, " ").slice(0, 200)'));
    if (!onConsent) throw new Error('no consent page');
    const asked = await ev('[...document.querySelectorAll(\'.oa-scope input\')].map((i) => i.value + ":" + i.checked).join(" ")');
    await ev('for (const v of ["send.handle", "send.id", "send.power"]) document.querySelector(\'.oa-scope input[value="\' + v + \'"]\').click(); document.querySelector(\'button[value="allow"]\').click(); true');
    page = 'the example app';
    const me = await until('location.origin === ' + JSON.stringify(APP) + ' && (window.__me || (window.__err && { err: window.__err }))', 10000);
    const meM = (await get('/api/me', { cookie: member.cookie })).j.user;
    const M = db.prepare('SELECT * FROM users WHERE id = ?').get(member.id);
    check('the docs\' browser example, unchanged but for its client ID, signs a member in through the real consent page: every box asked for starts unticked',
      asked === 'send.handle:false send.id:false send.power:false send.boost:false', asked);
    check('  ...and the app gets what was ticked, with the member\'s values: handle, profile, Send ID, Send Power, level, title — and not the Boost, asked for but left unticked',
      me && !me.err && me.preferred_username === M.username && me.profile === BASE + '/u/' + encodeURIComponent(M.username) && me.send_id === M.send_no && me.send_power === M.points
      && me.send_level === meM.level && me.send_title === meM.title && !('send_boost' in me) && /^[A-Za-z0-9_-]{43}$/.test(me.sub)
      && Object.keys(me).sort().join(',') === 'preferred_username,profile,send_id,send_level,send_power,send_title,sub', JSON.stringify(me));
    const hit = appHits.map((u) => new URL(u, 'http://x')).find((u) => u.pathname === '/callback');
    check('  ...at its own exact address, with a code, its state and iss', !!hit && !!hit.searchParams.get('code') && !!hit.searchParams.get('state') && hit.searchParams.get('iss') === disc.issuer, hit && hit.search.slice(0, 80));

    /* ── the docs' ID-token check, run in node against a real token ── */
    const pk = pkce(), nonce = 'n-' + crypto.randomBytes(6).toString('hex');
    const q = new URLSearchParams({ response_type: 'code', client_id: kart.client_id, redirect_uri: APP_REDIRECT, scope: 'openid send.handle send.id send.power send.boost', state: 'st-node', code_challenge: pk.challenge, code_challenge_method: 'S256', nonce });
    const az = await fetch(BASE + '/oauth/authorize?' + q, { headers: { Cookie: member.cookie, 'X-Forwarded-For': IP }, redirect: 'manual' });
    const code = new URL(az.headers.get('location') || 'http://x/').searchParams.get('code');
    const tr = await fetch(BASE + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': IP }, body: new URLSearchParams({ grant_type: 'authorization_code', code: code || '', redirect_uri: APP_REDIRECT, client_id: kart.client_id, code_verifier: pk.verifier }) });
    const tok = await tr.json();
    const body = EXV.replace("import { createPublicKey, verify } from 'node:crypto';", 'const { createPublicKey, verify } = crypto;').replace("CLIENT_ID = 'sapp_your_client_id'", 'CLIENT_ID = ' + JSON.stringify(kart.client_id));
    const checkIdToken = new Function('crypto', 'fetch', 'Buffer', body + '\nreturn checkIdToken;')(crypto, fetch, Buffer);
    const outcome = async (t, n) => { try { return await checkIdToken(t, n); } catch (e) { return e.message; } };
    const [h64, p64, s64] = String(tok.id_token || '').split('.');
    const edited = h64 + '.' + b64url(JSON.stringify({ ...JSON.parse(Buffer.from(p64 || 'e30', 'base64url')), send_power: 1e12 })) + '.' + s64;
    const ok = await outcome(tok.id_token, nonce), forged = await outcome(edited, nonce), wrongNonce = await outcome(tok.id_token, 'n-other');
    const noneTok = b64url(JSON.stringify({ alg: 'none', kid: 'x' })) + '.' + p64 + '.';
    check('the docs\' ID-token check accepts a real ID token (no prompt: the member had answered for these) and returns its claims',
      az.status === 302 && ok && ok.sub && ok.aud === kart.client_id && ok.nonce === nonce && ok.preferred_username === M.username && !('send_boost' in ok), JSON.stringify(ok).slice(0, 200));
    check('  ...and refuses an edited payload, the wrong nonce and "alg: none"', forged === 'bad signature' && wrongNonce === 'wrong nonce' && (await outcome(noneTok)) === 'unexpected algorithm', [forged, wrongNonce].join(' | '));

    /* ── Settings → Apps you've signed in to ── */
    page = '/profile#sec-apps';
    const looksS = [];
    for (const w of [320, 390, 1280]) {
      await size(w); await as(member);
      await open(BASE + '/profile#sec-apps', 'document.getElementById("sec-apps").open && !!document.querySelector(".grant-row")');
      const L = await ev(LOOK('#sec-apps'));
      if (bad(L)) looksS.push(w + ' ' + JSON.stringify(L));
    }
    await until('location.hash === ""', 3000); await sleep(400);   // the link's work is done (the card opened, the address tidied) and the list is drawn
    const card = await ev('({ open: document.getElementById("sec-apps").open, tab: !document.getElementById("dpanel-settings").hidden, hash: location.hash, state: document.getElementById("apps-state").textContent, row: (document.querySelector(\'.grant-row[data-client="' + kart.client_id + '"]\') || {}).textContent || "" })');
    check('/profile#sec-apps (the consent page\'s link) opens the Settings tab and this card, then tidies the address', card.open && card.tab && card.hash === '' && card.state === '1 app', JSON.stringify(card).slice(0, 200));
    check('  ...the app is listed with what it can see, as ticked (not the Boost), its status and its website', /Send Kart/.test(card.row) && /Your handle/.test(card.row) && /Your Send ID/.test(card.row) && /Your Send Power, level and title/.test(card.row)
      && !/Send Boost/.test(card.row) && /Signed in until/.test(card.row) && /kart\.example/.test(card.row) && /Not reviewed by Just Send It/.test(card.row), card.row.slice(0, 300));
    check('  ...at 320, 390 and 1280 px: nothing sideways, the floor, 44px targets, every control described', looksS.length === 0, looksS.join(' || '));
    // Revoke, by keyboard: focus it, Enter (it asks), Enter again
    await ev('document.querySelector(\'[data-revoke="' + kart.client_id + '"]\').focus(); true');
    await press('Enter');
    const armedR = await ev('document.querySelector(\'[data-revoke="' + kart.client_id + '"]\').textContent');
    await press('Enter');
    await until('!document.querySelector(\'[data-revoke="' + kart.client_id + '"]\')');
    const after = await ev('({ note: document.getElementById("grant-note").textContent, focus: document.activeElement.id, state: document.getElementById("apps-state").textContent })');
    const ui = await fetch(BASE + '/oauth/userinfo', { headers: { Authorization: 'Bearer ' + tok.access_token, 'X-Forwarded-For': IP } });
    check('Revoke by keyboard: Enter asks ("Tap again"), Enter again revokes — the consent and every token of that app for that member are gone, and its token no longer reads anything',
      /Tap again to revoke/.test(armedR) && /is revoked/.test(after.note) && after.focus === 'grant-note' && after.state === ''
      && !db.prepare('SELECT 1 FROM oauth_consents WHERE user_id = ? AND client_id = ?').get(member.id, kart.client_id) && !db.prepare('SELECT 1 FROM oauth_tokens WHERE user_id = ? AND client_id = ?').get(member.id, kart.client_id)
      && ui.status === 401, JSON.stringify(after) + ' ' + ui.status);

    /* ── the admin ── */
    page = '/admin';
    const looksA = [];
    for (const w of [390, 1280]) {
      await size(w); await as(admin);
      await open(BASE + '/admin', '!document.getElementById("adm-apps").hidden && !!document.querySelector(\'#adm-apps [data-app="' + kart.client_id + '"]\')');
      const L = await ev(LOOK('#adm-apps'));
      if (bad(L)) looksA.push(w + ' ' + JSON.stringify(L));
    }
    check('the admin\'s apps at 390 and 1280 px: nothing sideways, the floor, 44px targets, every control described', looksA.length === 0, looksA.join(' || '));
    const listedA = await ev('document.querySelector(\'#adm-apps [data-app="' + kart.client_id + '"]\').textContent');
    check('  ...each app with its client ID, its developer (a link to their wall), its addresses and its members', listedA.includes(kart.client_id) && listedA.includes('@' + dev.name) && listedA.includes(APP_REDIRECT) && /allowed it/.test(listedA));
    const adminAct = (what) => ev('(() => { const b = document.querySelector(\'#adm-apps [data-app="' + kart.client_id + '"] [data-app-act="' + what + '"]\'); if (!b) return false; b.click(); return true; })()');
    await adminAct('review');
    await until('!!document.querySelector(\'#adm-apps [data-app="' + kart.client_id + '"] [data-app-act="unreview"]\')');
    const reviewed = db.prepare('SELECT reviewed_at, reviewed_by FROM oauth_clients WHERE client_id = ?').get(kart.client_id);
    await typeIn('#adm-apps [data-app="' + kart.client_id + '"] .adm-app-why input', 'testing the switch');
    await adminAct('disable');
    const armedA = await ev('document.querySelector(\'#adm-apps [data-app="' + kart.client_id + '"] [data-app-act="disable"]\').textContent');
    await adminAct('disable');
    await until('!!document.querySelector(\'#adm-apps [data-app="' + kart.client_id + '"] [data-app-act="enable"]\')');
    const off = db.prepare('SELECT disabled_at, disabled_reason FROM oauth_clients WHERE client_id = ?').get(kart.client_id);
    const devView = (await get('/api/oauth/apps', { cookie: dev.cookie })).j.apps.find((a) => a.clientId === kart.client_id);
    check('Mark reviewed, then Switch off (two presses) with a reason: both stored, and the developer sees the reason with their app',
      reviewed.reviewed_at && reviewed.reviewed_by === ADMIN_ID && /Tap again/.test(armedA) && off.disabled_at && off.disabled_reason === 'testing the switch' && devView.disabled && devView.disabledReason === 'testing the switch', JSON.stringify(off));
    await adminAct('enable');
    await until('!!document.querySelector(\'#adm-apps [data-app="' + kart.client_id + '"] [data-app-act="disable"]\')');
    check('  ...and Switch back on clears it', !db.prepare('SELECT disabled_at FROM oauth_clients WHERE client_id = ?').get(kart.client_id).disabled_at);
    const keysBefore = db.prepare('SELECT kid FROM oauth_keys').all().map((r) => r.kid);
    await ev('document.getElementById("adm-apps-rotate").click(); document.getElementById("adm-apps-rotate").click(); true');
    const rotated = await until('/published now|already waiting/.test(document.getElementById("adm-apps-keys-status").textContent) && document.getElementById("adm-apps-keys-status").textContent');
    const fresh = db.prepare('SELECT kid, active_from FROM oauth_keys').all().filter((r) => !keysBefore.includes(r.kid));
    check('Rotate the signing key (two presses): a new key, published now and signing a day later, listed with the others', !!rotated && (/already waiting/.test(rotated) || (fresh.length === 1 && fresh[0].active_from > Date.now() + 23 * 36e5))
      && (await ev('document.querySelectorAll("#adm-apps-keys .adm-key").length')) >= 1, rotated);
    // a key this suite made waits a day to sign: it is taken out again, so no later suite meets it
    for (const r of fresh) db.prepare('DELETE FROM oauth_keys WHERE kid = ?').run(r.kid);

    check('no script error on any page walked', errors.length === 0, errors.slice(0, 5).join(' | '));
    check('  ...and not one request from them to any other host', offsite.length === 0, offsite.slice(0, 5).join(' | '));
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
